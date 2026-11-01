// replaces: none
/**
 * 자동마케팅 검사 보류 회차 회복 — 실 PostgreSQL 판(★ 2026-11-02 엔진 재설계 E3-6 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 * 운영 문장을 글자 그대로 돌린다(후보 고르기 · 검사 결과 다시 읽기 · 운영자 FOR UPDATE · 회사 FOR SHARE OF · 되돌리기 · 종결 표식).
 * 바깥(담당자 문자 적재 · 운영 경보)만 시험이 쥔다.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({ notices: [] as string[], enqueueResult: 1 }));
vi.mock('../sms-queue', async (orig) => ({
  ...(await orig() as any),
  getAuthSmsTable: async () => 'SMSQ_TEST',
  bulkInsertSmsQueue: async (_t: string[], rows: any[][]) => { ctl.notices.push(String(rows[0][4] || rows[0][2])); return ctl.enqueueResult; },
}));
vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  return { ...real, withBoundedMysql: async (_ms: number, work: any) => work(async () => []) };
});
vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1 }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { recoverHeldProposals, deliverRecoveryNotices, resetHeldRecoveryCursor, HELD_RECOVERY_GIVEUP_HOURS, HELD_RECOVERY_BATCH } from '../continuous-operator';

const CO = randomUUID();
const OWNER = randomUUID();

const proposal = async (op: string, results: any[], opts: { ageHours?: number; heldSendAt?: Date | null } = {}) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'operator_proposals', {
    id, operator_id: op, company_id: CO, status: 'admin_review', spam_test_status: 'pending',
    proposal_json: { messages: [{ body: '안내' }], spamCheck: { passedIndex: null, results, heldSendAt: opts.heldSendAt === undefined ? new Date(Date.now() + 3600_000).toISOString() : opts.heldSendAt } },
  });
  if (opts.ageHours) await pool.query(`UPDATE operator_proposals SET created_at = NOW() - $2::interval WHERE id = $1::uuid`, [id, `${opts.ageHours} hours`]);
  return id;
};
const spamTest = async (status: string, results: string[]) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'spam_filter_tests', { id, company_id: CO, user_id: OWNER, callback_number: '0212345678', status, source: 'auto_ai' });
  for (const [i, r] of results.entries()) {
    await insertMinimalRow(pool, 'spam_filter_test_results', { test_id: id, carrier: ['SKT', 'KT', 'LGU'][i] ?? 'SKT', message_type: 'SMS', result: r });
  }
  return id;
};
const operator = async (approved: boolean) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'continuous_operators', { id, company_id: CO, status: 'active', created_by: OWNER, name: '시험 자동마케팅' });
  if (approved) {
    await pool.query(
      `UPDATE continuous_operators SET approved_until = NOW() + INTERVAL '7 days', approval_meta = jsonb_build_object('windowStart', (NOW() - INTERVAL '1 day')::text) WHERE id = $1::uuid`,
      [id]);
  }
  return id;
};
const row = async (id: string) => (await pool.query(
  `SELECT status, scheduled_send_at, spam_test_status, proposal_json->'spamCheck' AS sc FROM operator_proposals WHERE id = $1::uuid`, [id])).rows[0];

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1104', login_id: 't-1102-held' });
});
beforeEach(() => { ctl.notices = []; ctl.enqueueResult = 1; resetHeldRecoveryCursor(); });

describe('E3-6 보류 회차 회복(실 PG)', () => {
  it('기다린 검사가 통과 · 승인 기간 안 = 예약으로 되돌림(보류 전 시각 · 통과 안 · 지문 · restoredAt) · 안내 1', async () => {
    const op = await operator(true);
    const t = await spamTest('completed', ['pass', 'pass', 'pass']);
    const held = new Date(Date.now() + 3600_000);
    const id = await proposal(op, [{ index: 0, result: 'pending', testId: t, fp: 'fp-a' }], { heldSendAt: held });
    const r = await recoverHeldProposals();
    expect(r.restored).toBeGreaterThanOrEqual(1);
    const now = await row(id);
    expect(now.status).toBe('scheduled');
    expect(now.spam_test_status).toBe('pass');
    expect(new Date(now.scheduled_send_at).getTime()).toBe(held.getTime());
    expect(now.sc).toMatchObject({ passedIndex: 0, fp: 'fp-a', recovery: { result: 'restored' } });
    expect(now.sc.restoredAt).toBeTruthy();
  });
  it('통과지만 승인 기간 · 회사 자율 아님 = 검토 그대로 · 통과 안 · 지문만 · 다시 보지 않음', async () => {
    const op = await operator(false);
    const t = await spamTest('completed', ['pass']);
    const id = await proposal(op, [{ index: 1, result: 'pending', testId: t, fp: 'fp-b' }]);
    await recoverHeldProposals();
    const now = await row(id);
    expect(now.status).toBe('admin_review');
    expect(now.sc).toMatchObject({ passedIndex: 1, fp: 'fp-b', recovery: { result: 'pass_review' } });
    expect(now.sc.restoredAt).toBeUndefined();
  });
  it('이미 다음 회차가 예약됨 = 운영자당 예약 1건 계약 안 = 검토 그대로', async () => {
    const op = await operator(true);
    const other = randomUUID();
    await insertMinimalRow(pool, 'operator_proposals', { id: other, operator_id: op, company_id: CO, status: 'scheduled', proposal_json: {} });
    const t = await spamTest('completed', ['pass']);
    const id = await proposal(op, [{ index: 0, result: 'pending', testId: t, fp: 'fp-c' }]);
    await recoverHeldProposals();
    expect((await row(id)).status).toBe('admin_review');
    expect((await row(id)).sc.recovery.result).toBe('pass_review');
  });
  it('아직 검사 중 = 그대로 기다림(표식 0) · 6시간 넘으면 검토 그대로 + 종결 표식', async () => {
    const op = await operator(true);
    const t = await spamTest('active', []);
    const fresh = await proposal(op, [{ index: 0, result: 'pending', testId: t, fp: 'fp-d' }]);
    await recoverHeldProposals();
    expect((await row(fresh)).sc.recovery).toBeUndefined();
    await pool.query(`UPDATE operator_proposals SET created_at = NOW() - $2::interval WHERE id = $1::uuid`, [fresh, `${HELD_RECOVERY_GIVEUP_HOURS + 1} hours`]);
    await recoverHeldProposals();
    expect((await row(fresh)).sc.recovery.result).toBe('late');
    expect((await row(fresh)).status).toBe('admin_review');
  });
  it('막힘 = 검토 그대로 + 종결 표식 · 옛 회차(검사 id 없음) = 안내 없이 종결', async () => {
    const op = await operator(true);
    const t = await spamTest('completed', ['blocked']);
    const blocked = await proposal(op, [{ index: 0, result: 'pending', testId: t, fp: 'fp-e' }]);
    const legacy = await proposal(op, [{ index: 0, result: 'pending' }]);
    await recoverHeldProposals();
    expect((await row(blocked)).sc.recovery.result).toBe('blocked');
    expect((await row(legacy)).sc.recovery.result).toBe('legacy');
  });
  it('★ Codex 구현 1R(R12) 결과를 기다리는 앞 50건이 뒤에서 통과한 회차를 막지 않는다(회전 커서 · 두 회차 안)', async () => {
    const op = await operator(true);
    const waitT = await spamTest('active', []);
    for (let i = 0; i < HELD_RECOVERY_BATCH; i++) {
      const id = `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`;
      await insertMinimalRow(pool, 'operator_proposals', {
        id, operator_id: op, company_id: CO, status: 'admin_review', spam_test_status: 'pending',
        proposal_json: { messages: [{ body: '안내' }], spamCheck: { results: [{ index: 0, testId: waitT, fp: 'w' }] } },
      });
    }
    const op2 = await operator(true);
    const t = await spamTest('completed', ['pass']);
    const last = 'ffffffff-ffff-4fff-9fff-ffffffffffff';
    await insertMinimalRow(pool, 'operator_proposals', {
      id: last, operator_id: op2, company_id: CO, status: 'admin_review', spam_test_status: 'pending',
      proposal_json: { messages: [{ body: '안내' }], spamCheck: { results: [{ index: 0, testId: t, fp: 'fp-last' }], heldSendAt: new Date(Date.now() + 3600_000).toISOString() } },
    });
    await recoverHeldProposals();
    expect((await row(last)).status).toBe('admin_review');
    await recoverHeldProposals();
    expect((await row(last)).status).toBe('scheduled');
    await pool.query(`UPDATE operator_proposals SET status = 'expired' WHERE operator_id = $1::uuid`, [op]);
  });
  it('★ Codex 구현 1R(R14) 회복 안내 = 결말과 같은 문장의 원장 · 적재 실패 = 다음 패스에 다시 · 성공 = 한 번', async () => {
    const op = await operator(true);
    const t = await spamTest('completed', ['blocked']);
    const id = await proposal(op, [{ index: 0, result: 'pending', testId: t, fp: 'fp-n' }]);
    await recoverHeldProposals();
    expect((await row(id)).sc.recovery.notice).toMatchObject({ attempts: 0 });
    ctl.enqueueResult = 0;
    await deliverRecoveryNotices();
    expect((await row(id)).sc.recovery.notice).toMatchObject({ attempts: 1 });
    expect((await row(id)).sc.recovery.notice.sentAt).toBeUndefined();
    ctl.enqueueResult = 1;
    await deliverRecoveryNotices();
    expect((await row(id)).sc.recovery.notice.sentAt).toBeTruthy();
    const before = ctl.notices.length;
    await deliverRecoveryNotices();
    expect(ctl.notices.length).toBe(before);
  });
  it('★ Codex 구현 2R(R18) 만든 지 5일 지난 회차도 회복 안내가 나간다(안내 원장 = 자기 상태만 본다)', async () => {
    const op = await operator(true);
    const t = await spamTest('completed', ['blocked']);
    const id = await proposal(op, [{ index: 0, result: 'pending', testId: t, fp: 'fp-old' }], { ageHours: 120 });
    await recoverHeldProposals();
    expect((await row(id)).sc.recovery).toMatchObject({ result: 'blocked', notice: { attempts: 0 } });
    const before = ctl.notices.length;
    await deliverRecoveryNotices();
    expect(ctl.notices.length).toBe(before + 1);
    expect((await row(id)).sc.recovery.notice.sentAt).toBeTruthy();
  });
  it('사람이 손댄 회차(reviewed_at) = 건드리지 않음', async () => {
    const op = await operator(true);
    const t = await spamTest('completed', ['pass']);
    const id = await proposal(op, [{ index: 0, result: 'pending', testId: t, fp: 'fp-f' }]);
    await pool.query(`UPDATE operator_proposals SET reviewed_at = NOW() WHERE id = $1::uuid`, [id]);
    await recoverHeldProposals();
    expect((await row(id)).sc.recovery).toBeUndefined();
    expect((await row(id)).status).toBe('admin_review');
  });
});
