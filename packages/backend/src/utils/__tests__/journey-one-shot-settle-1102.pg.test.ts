// replaces: none
/**
 * 한 번 보내기 = 정산 뒤에만 넣는다 · 실패해도 저절로 회복 · 되돌리기는 이번 시도만 — 실 PostgreSQL 판
 * (★ 2026-11-02 엔진 재설계 E1-2 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md · 원장 C93-DDL-1)
 *
 * 운영 문장을 글자 그대로 돌린다(켜기 커밋 · 잠금 · 원장 조회 · 되돌리기 · 적재 · 회복). 바깥(차감 함수 · 운영 경보)만 시험이 쥔다 —
 * 차감 = 원장 줄 하나를 넣는 가짜(같은 키 두 번 = 중복) · 잔액 부족은 주입.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({
  deduct: 'deducted' as 'deducted' | 'insufficient' | 'failed',
  deductCalls: [] as string[],
  alerts: [] as string[],
}));

vi.mock('../ai-credit', async (orig) => {
  const real: any = await orig();
  const { pool } = await import('../../config/database');
  return {
    ...real,
    deductCreditOutcome: async (o: any) => {
      ctl.deductCalls.push(String(o.idempotencyKey));
      if (ctl.deduct === 'insufficient') throw new real.InsufficientCreditError(o.cost, 0);
      if (ctl.deduct === 'failed') return 'failed';
      const dup = await pool.query(`SELECT 1 FROM ai_credit_transactions WHERE company_id = $1::uuid AND idempotency_key = $2`, [o.companyId, o.idempotencyKey]);
      if (dup.rows.length > 0) return 'duplicate';
      const { insertMinimalRow } = await import('./pg/fixtures');
      await insertMinimalRow(pool, 'ai_credit_transactions', { company_id: o.companyId, idempotency_key: o.idempotencyKey });
      return 'deducted';
    },
  };
});
vi.mock('../system-alert', () => ({ sendSystemAlert: async (p: any) => { ctl.alerts.push(String(p.dedupKey)); return 1; } }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { activateJourney } from '../journey-builder';
import { settleAndDispatchOneShot, recoverPendingOneShots, withOneShotLock, resetOneShotRecoveryCursor, ONE_SHOT_RECOVERY_LIMIT } from '../journey-anchor-scheduler';

const CO = randomUUID();
const EMPTY_CO = randomUUID();
const OWNER = randomUUID();
const EMPTY_OWNER = randomUUID();
const CUSTS = Array.from({ length: 3 }, () => randomUUID());

const row = async (id: string) => (await pool.query(
  `SELECT status, approved_at::text AS token, one_shot_dispatch_pending_at IS NOT NULL AS pending, one_shot_dispatched_at IS NOT NULL AS dispatched
     FROM journeys WHERE id = $1::uuid`, [id])).rows[0];
const execCount = async (id: string) => Number((await pool.query(`SELECT count(*)::int AS n FROM journey_executions WHERE journey_id = $1::uuid`, [id])).rows[0].n);
const ledgerCount = async (id: string, co = CO) => Number((await pool.query(
  `SELECT count(*)::int AS n FROM ai_credit_transactions WHERE company_id = $1::uuid AND idempotency_key = $2`, [co, `journey-activate:${id}`])).rows[0].n);

/** 한 번 보내기 여정 하나(칸 하나 · 사전검사 통과 표식) */
async function oneShot(opts: { status?: string; company?: string; owner?: string; lineageOf?: string; pendingAgo?: string | null; approvedAgo?: string } = {}): Promise<string> {
  const id = randomUUID();
  const co = opts.company ?? CO;
  await insertMinimalRow(pool, 'journeys', {
    id, company_id: co, created_by: opts.owner ?? OWNER, name: '한 번 보내기', status: opts.status ?? 'draft',
    start_kind: 'one_shot', trigger_event: 'custom', trigger_filters: {}, callback_number: '0212345678',
    last_pretest_passed_at: new Date(),
  });
  await insertMinimalRow(pool, 'journey_steps', {
    id: randomUUID(), journey_id: id, step_order: 1, step_type: 'message', channel: 'sms',
    message_template: '고객님 이번 주 안내를 드립니다. 확인해 주세요.', delay_mode: 'relative', delay_hours: 0,
  });
  if (opts.lineageOf) await pool.query(`UPDATE journeys SET lineage_id = $2::uuid WHERE id = $1::uuid`, [id, opts.lineageOf]);
  if (opts.status === 'active') {
    await pool.query(
      `UPDATE journeys SET approved_by = $2::uuid, approved_at = NOW() - $3::interval,
              one_shot_dispatch_pending_at = CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() - $4::interval END
        WHERE id = $1::uuid`,
      [id, opts.owner ?? OWNER, opts.approvedAgo ?? '0 minutes', opts.pendingAgo ?? null]);
  }
  return id;
}

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C93-DDL-1'));
  for (const [co, owner, login] of [[CO, OWNER, 't-1102-os'], [EMPTY_CO, EMPTY_OWNER, 't-1102-os-empty']]) {
    await insertMinimalRow(pool, 'companies', { id: co });
    await insertMinimalRow(pool, 'users', { id: owner, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: login });
  }
  for (const [i, id] of CUSTS.entries()) {
    await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${7200 + i}`, is_active: true, sms_opt_in: true });
  }
});

beforeEach(() => {
  Object.assign(ctl, { deduct: 'deducted', deductCalls: [], alerts: [] });
});

describe('E1-2 켜기 커밋 = 넣기 대기 + 이번 시도 토큰(실 PG)', () => {
  it('한 번 보내기 · 안 넣은 판 = 같은 UPDATE 에서 넣기 대기 · 토큰 = approved_at 글자(마이크로초) · 이미 넣은 판 = dispatched', async () => {
    const id = await oneShot();
    const r = await activateJourney(CO, id, OWNER);
    expect(r).toMatchObject({ ok: true, oneShot: 'pending' });
    const now = await row(id);
    expect(now).toMatchObject({ status: 'active', pending: true, dispatched: false });
    expect(r.attemptToken).toBe(now.token);
    expect(String(r.attemptToken)).toMatch(/\.\d{1,6}/);
    await pool.query(`UPDATE journeys SET status = 'paused', one_shot_dispatched_at = NOW(), one_shot_dispatch_pending_at = NULL WHERE id = $1::uuid`, [id]);
    const again = await activateJourney(CO, id, OWNER);
    expect(again).toMatchObject({ ok: true, oneShot: 'dispatched' });
    expect((await row(id)).pending).toBe(false);
  });
});

describe('E1-2 켜기 경로 = 여정 잠금 안 정산 → 적재(실 PG)', () => {
  it('첫 켜기 · 원장 줄 없음 = 같은 키로 차감 → 전원 적재 · 넣기 완료 · 대기 지움 · charged', async () => {
    const id = await oneShot();
    const a = await activateJourney(CO, id, OWNER);
    const r = await settleAndDispatchOneShot(CO, id, OWNER, { token: a.attemptToken!, firstActivation: true });
    expect(r).toEqual({ ok: true, charged: true, dispatchPending: false });
    expect(ctl.deductCalls).toEqual([`journey-activate:${id}`]);
    expect(await ledgerCount(id)).toBe(1);
    expect(await execCount(id)).toBe(CUSTS.length);
    expect(await row(id)).toMatchObject({ status: 'active', pending: false, dispatched: true });
  });
  it('잔액 부족 = 이번 시도만 초안으로(승인 · 넣기 대기 비움) · 실행 0 · INSUFFICIENT_CREDIT', async () => {
    const id = await oneShot();
    const a = await activateJourney(CO, id, OWNER);
    ctl.deduct = 'insufficient';
    const r = await settleAndDispatchOneShot(CO, id, OWNER, { token: a.attemptToken!, firstActivation: true });
    expect(r).toMatchObject({ ok: false, code: 'INSUFFICIENT_CREDIT' });
    expect(await row(id)).toMatchObject({ status: 'draft', token: null, pending: false, dispatched: false });
    expect(await execCount(id)).toBe(0);
  });
  it('다시 켜기 · 정산 실패 = 멈춤으로(사유) · 첫 켜기 원장이 이미 있으면 차감 0 · charged 0', async () => {
    const id = await oneShot({ status: 'paused' });
    const a = await activateJourney(CO, id, OWNER);
    ctl.deduct = 'failed';
    expect(await settleAndDispatchOneShot(CO, id, OWNER, { token: a.attemptToken!, firstActivation: false })).toMatchObject({ ok: false, code: 'CREDIT_SETTLE_FAILED' });
    const st = (await pool.query(`SELECT status, pause_reason FROM journeys WHERE id = $1::uuid`, [id])).rows[0];
    expect(st.status).toBe('paused');
    expect(String(st.pause_reason)).toMatch(/크레딧/);
    await insertMinimalRow(pool, 'ai_credit_transactions', { company_id: CO, idempotency_key: `journey-activate:${id}` });
    ctl.deduct = 'deducted';
    ctl.deductCalls = [];
    const b = await activateJourney(CO, id, OWNER);
    expect(await settleAndDispatchOneShot(CO, id, OWNER, { token: b.attemptToken!, firstActivation: false })).toEqual({ ok: true, charged: false, dispatchPending: false });
    expect(ctl.deductCalls).toEqual([]);
    expect(await execCount(id)).toBe(CUSTS.length);
  });
  it('토큰이 다름(그 뒤 다른 요청이 다시 켬) = 아무것도 안 함(차감 0 · 되돌리기 0 · 적재 0)', async () => {
    const id = await oneShot();
    await activateJourney(CO, id, OWNER);
    ctl.deduct = 'insufficient';
    const r = await settleAndDispatchOneShot(CO, id, OWNER, { token: '2000-01-01 00:00:00+00', firstActivation: true });
    expect(r).toEqual({ ok: true, charged: false, dispatchPending: false });
    expect(ctl.deductCalls).toEqual([]);
    expect(await row(id)).toMatchObject({ status: 'active', pending: true, dispatched: false });
  });
  it('새 판(계보 뿌리 아님) = 차감 0 · 적재', async () => {
    const root = await oneShot({ status: 'active', pendingAgo: null });
    const id = await oneShot({ lineageOf: root });
    const a = await activateJourney(CO, id, OWNER);
    expect(await settleAndDispatchOneShot(CO, id, OWNER, { token: a.attemptToken!, firstActivation: true })).toEqual({ ok: true, charged: false, dispatchPending: false });
    expect(ctl.deductCalls).toEqual([]);
    expect(await execCount(id)).toBe(CUSTS.length);
  });
  it('대상 0 = 실행 0 이어도 「넣음」 표식(켤 때 대상 1회) · 회복이 다시 보지 않는다', async () => {
    const id = await oneShot({ company: EMPTY_CO, owner: EMPTY_OWNER });
    const a = await activateJourney(EMPTY_CO, id, EMPTY_OWNER);
    expect((await settleAndDispatchOneShot(EMPTY_CO, id, EMPTY_OWNER, { token: a.attemptToken!, firstActivation: true })).ok).toBe(true);
    expect(await execCount(id)).toBe(0);
    expect(await row(id)).toMatchObject({ pending: false, dispatched: true });
  });
  it('적재가 던져도 켜기는 유지 · dispatchPending · 넣기 대기 남음 → 회복이 2분 뒤 넣는다(정산은 원장 = 다시 차감 0)', async () => {
    const id = await oneShot();
    const a = await activateJourney(CO, id, OWNER);
    await pool.query(`CREATE OR REPLACE FUNCTION t1102_block() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'block'; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER t1102_block BEFORE INSERT ON journey_executions FOR EACH ROW EXECUTE FUNCTION t1102_block()`);
    let r;
    try {
      r = await settleAndDispatchOneShot(CO, id, OWNER, { token: a.attemptToken!, firstActivation: true });
    } finally {
      await pool.query(`DROP TRIGGER t1102_block ON journey_executions`);
    }
    expect(r).toEqual({ ok: true, charged: true, dispatchPending: true });
    expect(await row(id)).toMatchObject({ status: 'active', pending: true, dispatched: false });
    await recoverPendingOneShots();
    expect(await execCount(id)).toBe(0);   // 2분 안 = 켜기 요청과 겹침을 피한다
    await pool.query(`UPDATE journeys SET one_shot_dispatch_pending_at = NOW() - INTERVAL '3 minutes' WHERE id = $1::uuid`, [id]);
    ctl.deductCalls = [];
    await recoverPendingOneShots();
    expect(ctl.deductCalls).toEqual([]);
    expect(await execCount(id)).toBe(CUSTS.length);
    expect(await row(id)).toMatchObject({ pending: false, dispatched: true });
  });
  it('같은 시도 동시 두 번 = 잠금으로 한 줄 · 차감 1 · 실행 = 대상 수', async () => {
    const id = await oneShot();
    const a = await activateJourney(CO, id, OWNER);
    const at = { token: a.attemptToken!, firstActivation: true };
    const [x, y] = await Promise.all([settleAndDispatchOneShot(CO, id, OWNER, at), settleAndDispatchOneShot(CO, id, OWNER, at)]);
    expect([x.ok, y.ok]).toEqual([true, true]);
    expect(await ledgerCount(id)).toBe(1);
    expect(await execCount(id)).toBe(CUSTS.length);
  });
});

describe('E1-2 회복 = 커밋 뒤 정산 전에 죽은 판도 원장으로 정산 · 적재(실 PG)', () => {
  it('넣기 대기 · 2분 지남 · 원장 없음 = 같은 키 차감 → 적재 / 잔액 부족 = 넘김 + 여정 경보 · 대기 그대로', async () => {
    const ok = await oneShot({ status: 'active', pendingAgo: '5 minutes' });
    const poor = await oneShot({ status: 'active', pendingAgo: '5 minutes' });
    ctl.deduct = 'insufficient';
    await recoverPendingOneShots();
    expect(ctl.alerts).toEqual(expect.arrayContaining([`journey-one-shot-settle:${ok}`, `journey-one-shot-settle:${poor}`]));
    expect(await row(poor)).toMatchObject({ status: 'active', pending: true, dispatched: false });
    ctl.deduct = 'deducted';
    await recoverPendingOneShots();
    expect(await execCount(ok)).toBe(CUSTS.length);
    expect(await ledgerCount(ok)).toBe(1);
    expect(await row(ok)).toMatchObject({ pending: false, dispatched: true });
  });
  it('잠금을 다른 손이 쥐고 있으면 그 판은 이번 회차 넘김(기다리지 않음)', async () => {
    const id = await oneShot({ status: 'active', pendingAgo: '5 minutes' });
    let inner: unknown;
    await withOneShotLock(id, true, async () => { inner = await recoverPendingOneShots(); });
    expect(await execCount(id)).toBe(0);
    expect(inner).toMatchObject({ dispatched: expect.any(Number) });
    await recoverPendingOneShots();
    expect(await execCount(id)).toBe(CUSTS.length);
  });
  it('★ Codex 구현 1R(R12) 정산 못 하는 앞 50건이 뒤의 판을 영구히 막지 않는다(회전 커서 · 두 회차 안)', async () => {
    resetOneShotRecoveryCursor();
    await pool.query(`UPDATE journeys SET status = 'ended' WHERE company_id = $1::uuid AND start_kind = 'one_shot' AND status = 'active'`, [CO]);
    const poorCo = randomUUID();
    const poorOwner = randomUUID();
    await insertMinimalRow(pool, 'companies', { id: poorCo });
    await insertMinimalRow(pool, 'users', { id: poorOwner, company_id: poorCo, user_type: 'admin', is_active: true, phone: '010-0000-1108', login_id: 't-1102-os-poor' });
    for (let i = 0; i < ONE_SHOT_RECOVERY_LIMIT; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await insertMinimalRow(pool, 'journeys', { id, company_id: poorCo, created_by: poorOwner, name: '잔액 부족', status: 'active', start_kind: 'one_shot', trigger_event: 'custom', trigger_filters: {}, callback_number: '0212345678', last_pretest_passed_at: new Date() });
      await pool.query(`UPDATE journeys SET approved_at = NOW(), one_shot_dispatch_pending_at = NOW() - INTERVAL '5 minutes' WHERE id = $1::uuid`, [id]);
    }
    const good = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await insertMinimalRow(pool, 'journeys', { id: good, company_id: CO, created_by: OWNER, name: '뒤 판', status: 'active', start_kind: 'one_shot', trigger_event: 'custom', trigger_filters: {}, callback_number: '0212345678', last_pretest_passed_at: new Date() });
    await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: good, step_order: 1, step_type: 'message', channel: 'sms', message_template: '고객님 안내드립니다. 확인해 주세요.', delay_mode: 'relative', delay_hours: 0 });
    await insertMinimalRow(pool, 'ai_credit_transactions', { company_id: CO, idempotency_key: `journey-activate:${good}` });
    await pool.query(`UPDATE journeys SET approved_at = NOW(), one_shot_dispatch_pending_at = NOW() - INTERVAL '5 minutes' WHERE id = $1::uuid`, [good]);
    ctl.deduct = 'insufficient';
    await recoverPendingOneShots();
    expect(await execCount(good)).toBe(0);
    await recoverPendingOneShots();
    expect(await execCount(good)).toBe(CUSTS.length);
    await pool.query(`UPDATE journeys SET status = 'ended' WHERE company_id = $1::uuid`, [poorCo]);
  });
  it('옛 코드 판(넣기 대기 없음 · 실행 0 · 켠 지 10분 넘음) = 자동 적재 0 · 원인 하나 경보', async () => {
    const id = await oneShot({ status: 'active', pendingAgo: null, approvedAgo: '20 minutes' });
    await recoverPendingOneShots();
    expect(await execCount(id)).toBe(0);
    expect(ctl.alerts).toContain('journey-one-shot-legacy-undispatched');
    await pool.query(`UPDATE journeys SET status = 'ended' WHERE id = $1::uuid`, [id]);
  });
});
