// replaces: none
/**
 * C123 여정 재진입 대기 최솟값(뿌리 R87) — 실 PostgreSQL
 * (★ 2026-11-10 설계서 docs/2026-11-10-journey-reentry-floor-design.md §6 T4 · Codex 설계 1R #1 · #2)
 *
 * 저장된 대기일이 0 이어도 실행을 넣는 자리가 계약 최솟값을 건다:
 *   조각 = 끝난 지 최솟값 안이면 제외(상태 무관) · 진입 감시(휴면 전환 · 최솟값 7일) = 방금 끝난 고객 · 방금 정지한 고객은 다시 넣지 않는다
 *   · 자동 재진입 워커 = 재진입 허용 여정만 · 끝난 뒤 최솟값 · 목표 달성 자격은 저장값 그대로 · 최근 끝난 실행이 있으면 오래된 완료 이력으로 넣지 않는다.
 * 고객 번호 = 010-0000-xxxx(도달 불가 대역).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1, alertPassFailures: async () => undefined }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { buildReentryAntiJoin } from '../journey-safety-filter';
import { runJourneyTriggerWatcher } from '../journey-trigger-watcher';
import { runReentryBatch } from '../journey-reentry-worker';

const CO = randomUUID();
const OWNER = randomUUID();
const J_DORMANT = randomUUID();   // 진입 감시 · 휴면 전환(최솟값 7일) · 재진입 켬 · 저장 0일
const J_AUTO0 = randomUUID();     // 워커 · 주문 완료(자동 최솟값 1일) · 자동 켬 · 저장 0일
const J_AUTO3 = randomUUID();     // 워커 · 자동 켬 · 저장 3일
const J_OFF = randomUUID();       // 워커 · 자동 켬 · 재진입 꺼짐
const J_CUSTOM = randomUUID();    // 진입 감시 · 고른 고객에게(최솟값 0) · 템플릿 기본 = 재진입 켬 · 0일

const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(Date.now() - ms);
let seq = 7400;
/** dormant = 휴면 대상(60일 전 구매) · 거짓 = 오늘 구매(휴면 여정 대상 아님 = 워커 시험 고객이 휴면 여정에 섞이지 않게) */
async function customer(dormant = true): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${String(seq++)}`, is_active: true, sms_opt_in: true });
  await pool.query(`UPDATE customers SET created_at = NOW() - INTERVAL '90 days', recent_purchase_date = (NOW() AT TIME ZONE 'Asia/Seoul')::date - $2::int WHERE id = $1`, [id, dormant ? 60 : 0]);
  return id;
}
async function run(journeyId: string, customerId: string, status: string, enteredAgo: number, endedAgo: number | null): Promise<void> {
  await insertMinimalRow(pool, 'journey_executions', {
    id: randomUUID(), journey_id: journeyId, customer_id: customerId, current_step_order: 1, status,
    entered_at: ago(enteredAgo), ...(endedAgo == null ? {} : { completed_at: ago(endedAgo) }),
  });
}
async function journey(id: string, trigger: string, over: Record<string, unknown>): Promise<void> {
  await insertMinimalRow(pool, 'journeys', {
    id, company_id: CO, created_by: OWNER, name: `재진입 최솟값 ${trigger}`, status: 'active', start_kind: 'event', trigger_event: trigger,
    callback_number: '0212345678', ...over,
  });
  await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: id, step_order: 1, step_type: 'message', channel: 'sms', message_template: '안내', delay_mode: 'relative', delay_hours: 0 });
}
const activeOf = async (journeyId: string): Promise<string[]> =>
  (await pool.query(`SELECT customer_id FROM journey_executions WHERE journey_id = $1 AND status = 'active'`, [journeyId])).rows.map((x) => String(x.customer_id));

const c: Record<string, string> = {};

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '재진입 최솟값 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1110', login_id: 't-1110-reentry-floor' });

  // 진입 감시 — 휴면 전환 · 재진입 켬 · 저장 0일(옛 = 끝나는 대로 다시 들어왔다)
  await journey(J_DORMANT, 'customer.dormant', { trigger_filters: { dormant_days: 30, include_existing: true }, allow_reentry: true, reentry_cooldown_days: 0 });
  for (const k of ['dNew', 'dRecent', 'dOld', 'dStopped', 'dActive']) c[k] = await customer();
  await run(J_DORMANT, c.dRecent, 'completed', 2 * D, 1 * H);          // 1시간 전 완료
  await run(J_DORMANT, c.dOld, 'completed', 9 * D, 8 * D);             // 8일 전 완료(최솟값 7일 지남)
  await run(J_DORMANT, c.dStopped, 'completed', 31 * D, 30 * D);       // 오래된 완료 + 1시간 전 정지(ended)
  await run(J_DORMANT, c.dStopped, 'ended', 2 * H, 1 * H);
  await run(J_DORMANT, c.dActive, 'active', 1 * H, null);

  // 자동 재진입 워커 — 주문 완료(사건형 · 자동 최솟값 1일)
  await journey(J_AUTO0, 'cdp.purchase', { auto_reentry_enabled: true, allow_reentry: true, reentry_cooldown_days: 0 });
  for (const k of ['a1h', 'a2d', 'aGoal', 'aMix']) c[k] = await customer(false);
  await run(J_AUTO0, c.a1h, 'completed', 2 * D, 1 * H);                // 1시간 전 완료 = 아직
  await run(J_AUTO0, c.a2d, 'completed', 3 * D, 2 * D);                // 2일 전 완료 = 다시
  await run(J_AUTO0, c.aGoal, 'goal_met', 3 * D, 2 * D);               // 저장 0일 = 목표 달성 고객은 대상 아님(옛 그대로)
  await run(J_AUTO0, c.aMix, 'completed', 11 * D, 10 * D);             // 10일 전 완료 + 1시간 전 정지 = 아직
  await run(J_AUTO0, c.aMix, 'ended', 2 * H, 1 * H);

  await journey(J_AUTO3, 'cdp.purchase', { auto_reentry_enabled: true, allow_reentry: true, reentry_cooldown_days: 3 });
  c.gGoal = await customer(false);
  await run(J_AUTO3, c.gGoal, 'goal_met', 5 * D, 4 * D);               // 저장 3일 = 목표 달성 고객도 대기 뒤 다시(옛 그대로)

  // 고른 고객에게 — 재진입 켬 · 0일이어도 한 번만(끝난 지 오래된 실행이 있어도 다시 넣지 않는다 · ★ Codex 구현 2R)
  await journey(J_CUSTOM, 'custom', { trigger_filters: { all_customers: true }, allow_reentry: true, reentry_cooldown_days: 0 });
  c.cDone = await customer(false);
  await run(J_CUSTOM, c.cDone, 'completed', 31 * D, 30 * D);

  await journey(J_OFF, 'cdp.purchase', { auto_reentry_enabled: true, allow_reentry: false, reentry_cooldown_days: 0 });
  c.off = await customer(false);
  await run(J_OFF, c.off, 'completed', 6 * D, 5 * D);
});

describe('조각(실 PG) — 끝난 지 최솟값 안이면 제외', () => {
  const pick = async (floor: number): Promise<string[]> => {
    const ids = [c.dNew, c.dRecent, c.dOld, c.dStopped, c.dActive];
    const params: any[] = [CO, ids];
    const frag = buildReentryAntiJoin('c', params, J_DORMANT, true, 0, floor);
    const r = await pool.query(`SELECT c.id FROM customers c WHERE c.company_id = $1 AND c.id = ANY($2::uuid[]) ${frag}`, params);
    return r.rows.map((x) => String(x.id)).sort();
  };
  it('최솟값 7 = 실행 없음 · 8일 전 완료만 · 최솟값 0 = 진행 중만 제외(옛 그대로)', async () => {
    expect(await pick(7)).toEqual([c.dNew, c.dOld].sort());
    expect(await pick(0)).toEqual([c.dNew, c.dRecent, c.dOld, c.dStopped].sort());
  });
});

describe('진입 감시 — 휴면 전환 · 재진입 켬 · 저장 0일', () => {
  it('방금 끝난 고객 · 방금 정지한 고객은 다시 넣지 않는다 · 실행 없음 · 최솟값 지난 고객만 진입', async () => {
    await runJourneyTriggerWatcher();
    expect((await activeOf(J_DORMANT)).sort()).toEqual([c.dNew, c.dOld, c.dActive].sort());
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM journey_executions WHERE journey_id = $1 AND customer_id = ANY($2::uuid[])`, [J_DORMANT, [c.dRecent, c.dStopped]]);
    expect(Number(n.rows[0].n)).toBe(3);   // 처음 넣어 둔 3행 그대로(새 실행 0)
  });
  it('고른 고객에게 · 재진입 켬 · 0일 = 한 번만: 30일 전에 끝난 고객은 다시 넣지 않고 처음인 고객만 들어온다', async () => {
    const done = await pool.query(`SELECT status FROM journey_executions WHERE journey_id = $1 AND customer_id = $2`, [J_CUSTOM, c.cDone]);
    expect(done.rows.map((x) => String(x.status))).toEqual(['completed']);
    expect(await activeOf(J_CUSTOM)).toContain(c.dNew);   // 같은 회사의 처음인 고객은 들어왔다(위 회차)
  });
});

describe('자동 재진입 워커', () => {
  it('저장 0일 = 끝난 뒤 1일 전에는 넣지 않는다 · 목표 달성 고객 제외(옛 그대로) · 오래된 완료 + 방금 정지 = 넣지 않는다 · 재진입 꺼진 여정은 돌지 않는다', async () => {
    await runReentryBatch();
    expect(await activeOf(J_AUTO0)).toEqual([c.a2d]);
    expect(await activeOf(J_AUTO3)).toEqual([c.gGoal]);
    expect(await activeOf(J_OFF)).toEqual([]);
  });
});
