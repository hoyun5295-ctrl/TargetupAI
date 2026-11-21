// replaces: none
/**
 * C150 스팸 검사 통신사 늦은 전달 판정 + 재검사 대기 — 실 PostgreSQL 판(★ 2026-11-21 · 설계서 docs/2026-11-21-c150-spam-carrier-delay-retest-design.md §5)
 *   K-PG1 고칠 수 있는 때(§10 · 그 단말 줄) · K-PG2 lateOpen(줄 최댓값) · K-PG3 확인 문자 시작(자동 1분 · 사람 10분) · K-PG4 보류 묶음 읽기 · 보류 감시.
 *   새 칸 · 새 표 0. 바깥(테스트 문자 적재 · 운영 경보)만 시험이 쥔다.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({ sms: [] as Array<{ phone: string; text: string; ref: string }> }));
vi.mock('../sms-queue', async (orig) => {
  const real: any = await orig();
  return { ...real, insertTestSmsQueue: async (phone: string, _cb: string, text: string, _t: string, ref: string) => { ctl.sms.push({ phone, text, ref }); } };
});
vi.mock('../system-alert', async (orig) => ({ ...(await orig() as any), sendSystemAlert: async () => 1 }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { SPAM_REPORT_TEXT_MATCH_SQL, readSpamTestOutcome, resetSpamStampCache } from '../spam-test-queue';
import { runSpamProbeCycle, resetSpamProbeSchemaCache } from '../spam-probe';
import { heldSpamBatch, wakeResolvedSpamHolds, SPAM_HOLD_EVENT, FINAL_STAGE_CLAIM_SQL } from '../agency-send-worker';

const CO = randomUUID();
const US = randomUUID();
const CB = '0215440150';
const LG = '01000001501';   // 확인 문자 대상 단말(본문 보고 신선)

/** 닫힌 검사 하나(출처 · 닫힌 지 몇 분 · 줄마다 결과) */
async function closedTest(o: { source: string; minutesAgo: number; rows: Array<{ carrier: string; phone: string; result: string | null }>; hash?: string; batchId?: string | null; status?: string }): Promise<{ id: string; hash: string }> {
  const id = randomUUID();
  const hash = o.hash ?? `h-${id.slice(0, 12)}`;
  await pool.query(
    `INSERT INTO spam_filter_tests (id, company_id, user_id, callback_number, message_content_sms, message_hash, status, source, batch_id, created_at, completed_at)
     VALUES ($1, $2, $3, $4, '본문', $5, $6::varchar, $7, $8, NOW() - (($9::int + 1) * INTERVAL '1 minute'), CASE WHEN $6::varchar = 'completed' THEN NOW() - ($9::int * INTERVAL '1 minute') END)`,
    [id, CO, US, CB, hash, o.status ?? 'completed', o.source, o.batchId ?? null, o.minutesAgo],
  );
  for (const r of o.rows) {
    await pool.query(
      `INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone, received, result) VALUES ($1, $2, 'SMS', $3, false, $4)`,
      [id, r.carrier, r.phone, r.result],
    );
  }
  return { id, hash };
}
const correctable = async (hash: string, phone: string, carrier: string) =>
  (await pool.query(SPAM_REPORT_TEXT_MATCH_SQL, [CB, hash, phone, carrier, 'SMS', Date.now()])).rows[0]?.correctable;

beforeAll(async () => {
  for (const id of ['C89-DDL-1', 'C89-DDL-2', 'C89-DDL-3', 'C89-DDL-4', 'C89-DDL-5']) await pool.query(ledgerBlockSql(id));
  resetSpamStampCache();
  resetSpamProbeSchemaCache();
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: US, company_id: CO, user_type: 'user', is_active: true, login_id: `t-1121-c150-${US.slice(0, 8)}` });
  await pool.query(
    `INSERT INTO spam_filter_devices (device_id, carrier, phone, is_active, last_body_report_at) VALUES ('dev-c150-lg', 'LGU', $1, true, NOW() - INTERVAL '1 day')`,
    [LG],
  );
});
beforeEach(() => { ctl.sms.length = 0; });

describe('K-PG1 고칠 수 있는 때 = 그 단말 줄의 §10 칸', () => {
  it('자동 · 시간 초과 줄 15분 = 고침 · 35분 = 못 고침(통신사 지연 칸 30분)', async () => {
    const a = await closedTest({ source: 'auto_ai_free', minutesAgo: 15, rows: [{ carrier: 'KT', phone: '01000001502', result: 'pass' }, { carrier: 'LGU', phone: '01000001503', result: 'timeout' }] });
    expect(await correctable(a.hash, '01000001503', 'LGU')).toBe(true);
    const b = await closedTest({ source: 'auto_ai', minutesAgo: 35, rows: [{ carrier: 'LGU', phone: '01000001503', result: 'timeout' }] });
    expect(await correctable(b.hash, '01000001503', 'LGU')).toBe(false);
  });
  it('자동 · 차단 줄 = 앱 보고 보관 칸 10분(5분 = 고침 · 15분 = 못 고침) · 같은 검사의 다른 단말 시간 초과 줄은 그 단말 칸', async () => {
    const a = await closedTest({ source: 'auto_ai', minutesAgo: 5, rows: [{ carrier: 'LGU', phone: '01000001504', result: 'blocked' }] });
    expect(await correctable(a.hash, '01000001504', 'LGU')).toBe(true);
    const b = await closedTest({ source: 'auto_ai', minutesAgo: 15, rows: [{ carrier: 'LGU', phone: '01000001504', result: 'blocked' }, { carrier: 'KT', phone: '01000001505', result: 'timeout' }] });
    expect(await correctable(b.hash, '01000001504', 'LGU')).toBe(false);
    expect(await correctable(b.hash, '01000001505', 'KT')).toBe(true);
  });
  it('미가입 0 — 사람 검사(manual · trial · NULL) 시간 초과 줄 = 10분 그대로(5분 = 고침 · 15분 = 못 고침)', async () => {
    for (const source of ['manual', 'trial']) {
      const ok = await closedTest({ source, minutesAgo: 5, rows: [{ carrier: 'LGU', phone: '01000001506', result: 'timeout' }] });
      expect(await correctable(ok.hash, '01000001506', 'LGU')).toBe(true);
      const late = await closedTest({ source, minutesAgo: 15, rows: [{ carrier: 'LGU', phone: '01000001506', result: 'timeout' }] });
      expect(await correctable(late.hash, '01000001506', 'LGU')).toBe(false);
    }
    const legacy = await closedTest({ source: 'manual', minutesAgo: 15, rows: [{ carrier: 'LGU', phone: '01000001507', result: 'timeout' }] });
    await pool.query(`UPDATE spam_filter_tests SET source = NULL WHERE id = $1`, [legacy.id]);
    expect(await correctable(legacy.hash, '01000001507', 'LGU')).toBe(false);
  });
});

describe('K-PG2 lateOpen = 그 검사 줄 칸의 최댓값', () => {
  it('자동 + 시간 초과 줄 하나라도 = 30분 · 차단만 = 10분 · 사람 = 10분 · 진행 중 = 거짓', async () => {
    const t15 = await closedTest({ source: 'auto_ai', minutesAgo: 15, rows: [{ carrier: 'KT', phone: '01000001511', result: 'pass' }, { carrier: 'LGU', phone: '01000001512', result: 'timeout' }] });
    expect((await readSpamTestOutcome(t15.id)).lateOpen).toBe(true);
    const t35 = await closedTest({ source: 'auto_ai', minutesAgo: 35, rows: [{ carrier: 'LGU', phone: '01000001512', result: 'timeout' }] });
    expect((await readSpamTestOutcome(t35.id)).lateOpen).toBe(false);
    const b5 = await closedTest({ source: 'auto_ai', minutesAgo: 5, rows: [{ carrier: 'LGU', phone: '01000001512', result: 'blocked' }] });
    expect((await readSpamTestOutcome(b5.id)).lateOpen).toBe(true);
    const b15 = await closedTest({ source: 'auto_ai', minutesAgo: 15, rows: [{ carrier: 'LGU', phone: '01000001512', result: 'blocked' }] });
    expect((await readSpamTestOutcome(b15.id)).lateOpen).toBe(false);
    const m15 = await closedTest({ source: 'manual', minutesAgo: 15, rows: [{ carrier: 'LGU', phone: '01000001512', result: 'timeout' }] });
    expect((await readSpamTestOutcome(m15.id)).lateOpen).toBe(false);
    const act = await closedTest({ source: 'auto_ai', minutesAgo: 0, status: 'active', rows: [{ carrier: 'LGU', phone: '01000001512', result: null }] });
    const r = await readSpamTestOutcome(act.id);
    expect([r.outcome, r.lateOpen]).toEqual(['pending', false]);
    const empty = await closedTest({ source: 'auto_ai', minutesAgo: 5, rows: [] });
    expect((await readSpamTestOutcome(empty.id)).lateOpen).toBe(true);   // 줄 없음 = 기본 10분
  });
});

describe('K-PG3 확인 문자 시작 = 자동 닫힌 뒤 1분 · 사람 10분', () => {
  it('자동 확인 중 2분 = 보냄 · 사람 2분 = 안 보냄 · 사람 11분 = 보냄', async () => {
    const auto2 = await closedTest({ source: 'auto_ai_free', minutesAgo: 2, rows: [{ carrier: 'LGU', phone: LG, result: 'unconfirmed' }] });
    const man2 = await closedTest({ source: 'manual', minutesAgo: 2, rows: [{ carrier: 'LGU', phone: LG, result: 'unconfirmed' }] });
    const man11 = await closedTest({ source: 'manual', minutesAgo: 11, rows: [{ carrier: 'LGU', phone: LG, result: 'unconfirmed' }] });
    await runSpamProbeCycle();
    const probed = async (testId: string) => Number((await pool.query(
      `SELECT COUNT(*)::int AS n FROM spam_test_probes p JOIN spam_filter_test_results r ON r.id = p.result_id WHERE r.test_id = $1`, [testId])).rows[0].n);
    expect(await probed(auto2.id)).toBe(1);
    expect(await probed(man2.id)).toBe(0);
    expect(await probed(man11.id)).toBe(1);
    const auto0 = await closedTest({ source: 'auto_ai', minutesAgo: 0, rows: [{ carrier: 'LGU', phone: LG, result: 'unconfirmed' }] });
    await runSpamProbeCycle();
    expect(await probed(auto0.id)).toBe(0);   // 닫힌 지 1분 안 = 아직
  });
});

describe('K-PG4 보류 묶음 읽기 · 보류 감시', () => {
  const request = async (status = 'received', version = 1) => {
    const id = randomUUID();
    await insertMinimalRow(pool, 'agency_send_requests', { id, company_id: CO, current_content: '세일 안내', original_content: '세일 안내' });
    await pool.query(`UPDATE agency_send_requests SET status = $2, content_version = $3, updated_at = NOW() WHERE id = $1::uuid`, [id, status, version]);
    return id;
  };
  const holdEvent = async (requestId: string, payload: Record<string, unknown>) => {
    await pool.query(`INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, $2, $3::jsonb)`, [requestId, SPAM_HOLD_EVENT, JSON.stringify(payload)]);
  };

  it('이어 본 검사(검사 batch_id ≠ 사건 batchId) = 사건 testIds 로 찾음 · 돌려주는 batchId = 검사의 batch_id · 결과 = 판정 읽기', async () => {
    const firstBatch = randomUUID();
    const t = await closedTest({ source: 'auto_ai_free', minutesAgo: 3, batchId: firstBatch, rows: [{ carrier: 'LGU', phone: '01000001521', result: 'unconfirmed' }] });
    const req = await request();
    await holdEvent(req, { phase: 'first', verdict: 'unconfirmed', version: 1, batchId: randomUUID(), held: false, testIds: [t.id] });
    expect(await heldSpamBatch(req, 1)).toEqual({ batchId: firstBatch, verdict: 'unconfirmed' });
    // 확인 중인 동안 감시 = 깨우지 않음
    const kicked: string[][] = [];
    expect(await wakeResolvedSpamHolds((ids) => { kicked.push(ids); })).not.toContain(req);
    // 확인 문자로 차단 확정 → 감시가 깨움
    await pool.query(`UPDATE spam_filter_test_results SET result = 'blocked' WHERE test_id = $1`, [t.id]);
    expect(await heldSpamBatch(req, 1)).toEqual({ batchId: firstBatch, verdict: 'blocked' });
    expect(await wakeResolvedSpamHolds((ids) => { kicked.push(ids); })).toContain(req);
    expect(kicked.flat()).toContain(req);
  });
  it('장애로 굳음 = error(감시가 깨우고 runSpamRound 첫머리가 장애 마감) · 통과 = pass', async () => {
    const b = randomUUID();
    const t = await closedTest({ source: 'auto_ai', minutesAgo: 8, batchId: b, rows: [{ carrier: 'LGU', phone: '01000001522', result: 'error' }] });
    const req = await request();
    await holdEvent(req, { phase: 'first', verdict: 'unconfirmed', version: 1, batchId: b, testIds: [t.id] });
    expect(await heldSpamBatch(req, 1)).toEqual({ batchId: b, verdict: 'error' });
    expect(await wakeResolvedSpamHolds(() => undefined)).toContain(req);
    await pool.query(`UPDATE spam_filter_test_results SET result = 'pass', received = true WHERE test_id = $1`, [t.id]);
    expect((await heldSpamBatch(req, 1))?.verdict).toBe('pass');
  });
  it('옛 사건(testIds 없음) = batchId 의 검사 · 버전 다름 = null · 보류 뒤 다른 사건 = null · testing = 감시가 안 고름', async () => {
    const b = randomUUID();
    await closedTest({ source: 'auto_ai', minutesAgo: 3, batchId: b, rows: [{ carrier: 'LGU', phone: '01000001523', result: 'pass' }] });
    const legacy = await request();
    await holdEvent(legacy, { phase: 'first', verdict: 'pending', version: 1, batchId: b });
    expect(await heldSpamBatch(legacy, 1)).toEqual({ batchId: b, verdict: 'pass' });
    // 문안 버전이 바뀌었다(담당자가 고침) = 그 보류는 지난 일
    expect(await heldSpamBatch(legacy, 2)).toBeNull();
    // 보류 뒤 다른 사건 = 이미 다음 일이 일어났다
    const moved = await request();
    await holdEvent(moved, { phase: 'first', verdict: 'pending', version: 1, batchId: b });
    await pool.query(`INSERT INTO agency_send_events (request_id, kind, payload, created_at) VALUES ($1::uuid, 'spam_blocked', '{}'::jsonb, NOW() + INTERVAL '1 second')`, [moved]);
    expect(await heldSpamBatch(moved, 1)).toBeNull();
    expect(await wakeResolvedSpamHolds(() => undefined)).not.toContain(moved);
    // 잡혀 있는 접수(testing) = 감시가 고르지 않는다
    const busy = await request('testing');
    await holdEvent(busy, { phase: 'first', verdict: 'pending', version: 1, batchId: b });
    expect(await wakeResolvedSpamHolds(() => undefined)).not.toContain(busy);
    // 보류 사건만 있고 검사를 못 찾음 = null(감시 = 깨우지 않음 · 옛 주기가 맡는다)
    const lost = await request();
    await holdEvent(lost, { phase: 'first', verdict: 'pending', version: 1, batchId: randomUUID() });
    expect(await heldSpamBatch(lost, 1)).toBeNull();
  });
});

describe('★ Codex 구현 1R #1 — 발송 직전 단계 선점 = 후보를 읽을 때의 revision', () => {
  it('후보를 읽은 뒤 장애 마감으로 승인 상태에 돌아온 행(revision 오름) = 옛 값으로 못 잡음 · 새로 읽은 값 = 잡음', async () => {
    const id = randomUUID();
    await insertMinimalRow(pool, 'agency_send_requests', { id, company_id: CO, current_content: '세일 안내', original_content: '세일 안내' });
    await pool.query(`UPDATE agency_send_requests SET status = 'approved' WHERE id = $1::uuid`, [id]);
    const read = (await pool.query(`SELECT revision FROM agency_send_requests WHERE id = $1::uuid`, [id])).rows[0];
    // 그 사이 감시가 잡아 장애 마감 → 승인 상태로 되돌림(setStatus = revision + 1 두 번)
    await pool.query(`UPDATE agency_send_requests SET status = 'final_testing', revision = revision + 1 WHERE id = $1::uuid`, [id]);
    await pool.query(`UPDATE agency_send_requests SET status = 'approved', revision = revision + 1 WHERE id = $1::uuid`, [id]);
    expect((await pool.query(FINAL_STAGE_CLAIM_SQL, [id, Number(read.revision)])).rowCount).toBe(0);
    const fresh = (await pool.query(`SELECT revision FROM agency_send_requests WHERE id = $1::uuid`, [id])).rows[0];
    const got = await pool.query(FINAL_STAGE_CLAIM_SQL, [id, Number(fresh.revision)]);
    expect(got.rowCount).toBe(1);
    expect(got.rows[0].status).toBe('final_testing');
    expect(Number(got.rows[0].revision)).toBe(Number(fresh.revision) + 1);
  });
});
