// replaces: none
/**
 * C126 여정 재점검 — 실 PostgreSQL(★ 2026-11-11 · 설계서 docs/2026-11-11-journey-recheck-design.md §6 T4)
 *
 *   D1 멈춘 실행 = 미완료(상태형 뽑기 · 넣기 · 자동 재진입 · 다른 판 검사 · 진입 교체는 ended 로 닫아 뒤 여정으로 넘기지 않는다)
 *   D2 자동 재진입 워커 = 여정 값을 잠금 안에서 읽는다(끼어들기: 목록을 읽은 뒤 바뀐 대기일 · 시작 사건 · 하루 몫 · 첫 칸)
 *   D3 「고른 고객에게」 넣기 가드 = 실행이 하나라도 있으면 넣지 않는다(뽑은 뒤 대조군 실행이 끼어든 경합)
 *   D4 대기일 = 끝난 뒤 max(계약 최솟값, 저장 대기일) · 365 를 넘는 저장값 그대로 · 사건 커서 = 계보 전체
 * 끼어들기 = 시험이 다른 연결로 그 여정의 계보 잠금(journey-entry)을 쥔 채 워커 · 감시를 띄우고, 잠금에서 기다리는 것을 pg_locks 로 확인한 뒤
 *   설정을 바꿔 커밋하고 잠금을 놓는다(시험용 훅 없음 · 운영과 같은 순서).
 * 고객 번호 = 010-0000-xxxx(도달 불가 대역).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1, alertPassFailures: async () => undefined }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { buildReentryAntiJoin } from '../journey-safety-filter';
import { runJourneyTriggerWatcher, checkCooldown } from '../journey-trigger-watcher';
import { runReentryBatch } from '../journey-reentry-worker';
import { CLOSE_ACTIVE_FOR_REPLACEMENT_SQL, CLOSE_PAUSED_FOR_REPLACEMENT_SQL } from '../journey-entry-replace';
import { selectAfterJourneyCandidates } from '../journey-target-extractor';

const CO = randomUUID();
const OWNER = randomUUID();
const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(Date.now() - ms);
let seq = 8600;

/** dormant = 휴면 대상(60일 전 구매) · 거짓 = 오늘 구매(휴면 여정 대상 아님) */
async function customer(dormant = false): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${String(seq++)}`, is_active: true, sms_opt_in: true });
  await pool.query(`UPDATE customers SET created_at = NOW() - INTERVAL '900 days', recent_purchase_date = (NOW() AT TIME ZONE 'Asia/Seoul')::date - $2::int WHERE id = $1`, [id, dormant ? 60 : 0]);
  return id;
}
async function run(journeyId: string, customerId: string, status: string, enteredAgo: number, endedAgo: number | null): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'journey_executions', {
    id, journey_id: journeyId, customer_id: customerId, current_step_order: 1, status,
    entered_at: ago(enteredAgo), ...(endedAgo == null ? {} : { completed_at: ago(endedAgo) }),
  });
  return id;
}
async function journey(trigger: string, over: Record<string, unknown>, firstDelayHours = 0): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'journeys', {
    id, company_id: CO, created_by: OWNER, name: `재점검 ${trigger}`, status: 'active', start_kind: 'event', trigger_event: trigger,
    callback_number: '0212345678', ...over,
  });
  await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: id, step_order: 1, step_type: 'message', channel: 'sms', message_template: '안내', delay_mode: 'relative', delay_hours: firstDelayHours });
  return id;
}
const rowsOf = async (journeyId: string, customerId: string): Promise<Array<{ status: string; next_run_at: Date | null; entered_at: Date }>> =>
  (await pool.query(`SELECT status, next_run_at, entered_at FROM journey_executions WHERE journey_id = $1 AND customer_id = $2 ORDER BY entered_at`, [journeyId, customerId])).rows;
const activeOf = async (journeyId: string): Promise<string[]> =>
  (await pool.query(`SELECT customer_id FROM journey_executions WHERE journey_id = $1 AND status = 'active' ORDER BY customer_id`, [journeyId])).rows.map((x) => String(x.customer_id));

/** 그 여정들의 계보 잠금을 다른 연결이 쥔 채 work 를 띄운다 → work 가 잠금에서 기다리는 것을 확인 → change(다른 연결 · 커밋) → 잠금 해제 → work 끝 */
async function interleave(journeyIds: string[], work: () => Promise<unknown>, change: () => Promise<void>): Promise<void> {
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    for (const id of journeyIds) {
      await holder.query(`SELECT pg_advisory_xact_lock(hashtext('journey-entry'), hashtext((COALESCE(lineage_id, id))::text)) FROM journeys WHERE id = $1::uuid`, [id]);
    }
    const running = work();
    let waiting = 0;
    for (let i = 0; i < 400 && waiting === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const w = await pool.query(
        `SELECT COUNT(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND NOT l.granted AND a.query ILIKE '%journey-entry%' AND a.pid <> $1`, [(holder as any).processID]);
      waiting = Number(w.rows[0].n);
    }
    expect(waiting, 'work 가 계보 잠금에서 기다려야 끼어들기가 성립한다').toBeGreaterThan(0);
    await change();
    await holder.query('COMMIT');
    await running;
  } catch (e) {
    await holder.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    holder.release();
  }
}

const c: Record<string, string> = {};
const J: Record<string, string> = {};

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '여정 재점검 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1111', login_id: 't-1111-journey-recheck' });

  // ── 상태형(휴면 전환 · 최솟값 7일) · 재진입 켬
  J.dorm0 = await journey('customer.dormant', { trigger_filters: { dormant_days: 30, include_existing: true }, allow_reentry: true, reentry_cooldown_days: 0 });
  c.paused = await customer(true);   await run(J.dorm0, c.paused, 'paused', 8 * D, null);            // ① 8일 전 들어와 멈춘 실행(끝난 시각 없음)
  c.fresh = await customer(true);                                                                   // 실행 없음 = 들어온다(대조)
  J.dorm30 = await journey('customer.dormant', { trigger_filters: { dormant_days: 30, include_existing: true }, allow_reentry: true, reentry_cooldown_days: 30 });
  c.end16 = await customer(true);    await run(J.dorm30, c.end16, 'completed', 30 * D + H, 16 * D);  // ② 30일 넘게 전 들어와 16일 전 끝남 = 아직(옛: 들어온 시각 기준이라 들어왔다)
  c.end31 = await customer(true);    await run(J.dorm30, c.end31, 'completed', 45 * D, 31 * D);      // ② 31일 전 끝남 = 다시
  J.dorm730 = await journey('customer.dormant', { trigger_filters: { dormant_days: 30, include_existing: true }, allow_reentry: true, reentry_cooldown_days: 730 });
  c.end400 = await customer(true);   await run(J.dorm730, c.end400, 'completed', 800 * D, 400 * D);  // ③ 저장 730일 = 줄지 않는다(365 로 자르면 통과했을 고객)

  // ── 고른 고객에게 · 재진입 켬(템플릿 기본) · 대조군 경합
  J.custom = await journey('custom', { trigger_filters: { customer_conditions: [{ field: 'grade', op: '==', value: '재점검7' }] }, allow_reentry: true, reentry_cooldown_days: 0 });
  c.race = await customer(false);
  await pool.query(`UPDATE customers SET grade = '재점검7' WHERE id = $1`, [c.race]);

  // ── 자동 재진입 워커(주문 완료 · 자동 최솟값 1일)
  J.auto0 = await journey('cdp.purchase', { auto_reentry_enabled: true, allow_reentry: true, reentry_cooldown_days: 0 });
  c.wPaused = await customer();      await run(J.auto0, c.wPaused, 'completed', 11 * D, 10 * D); await run(J.auto0, c.wPaused, 'paused', 8 * D, null);   // ① 멈춘 실행이 있으면 넣지 않는다
  c.wOk = await customer();          await run(J.auto0, c.wOk, 'completed', 3 * D, 2 * D);           // 대조 = 다시 들어온다
  J.auto30 = await journey('cdp.purchase', { auto_reentry_enabled: true, allow_reentry: true, reentry_cooldown_days: 30 });
  c.wEnded8 = await customer();      await run(J.auto30, c.wEnded8, 'completed', 51 * D, 50 * D); await run(J.auto30, c.wEnded8, 'ended', 20 * D, 8 * D);   // ⑧ 완료 50일 전 + 끝냄 8일 전 · 대기 30 = 아직
  c.wEnded40 = await customer();     await run(J.auto30, c.wEnded40, 'completed', 91 * D, 90 * D); await run(J.auto30, c.wEnded40, 'ended', 50 * D, 40 * D); // 끝냄 40일 전 = 다시

  // ── 워커 끼어들기(⑨) — 목록을 읽은 뒤 바뀌는 여정 넷
  J.i9a = await journey('cdp.purchase', { auto_reentry_enabled: true, allow_reentry: true, reentry_cooldown_days: 0 });
  c.i9a = await customer();          await run(J.i9a, c.i9a, 'completed', 4 * D, 3 * D);
  J.i9b = await journey('cdp.purchase', { auto_reentry_enabled: true, allow_reentry: true, reentry_cooldown_days: 0 });
  c.i9b = await customer();          await run(J.i9b, c.i9b, 'completed', 4 * D, 3 * D);
  J.i9c = await journey('custom', { trigger_filters: { customer_conditions: [{ field: 'grade', op: '==', value: '재점검9c' }], backfill_per_day: 1000 }, auto_reentry_enabled: true, allow_reentry: true, reentry_cooldown_days: 0 });
  for (const k of ['i9c1', 'i9c2', 'i9c3']) { c[k] = await customer(); await run(J.i9c, c[k], 'completed', 4 * D, 3 * D); }
  J.i9d = await journey('cdp.purchase', { auto_reentry_enabled: true, allow_reentry: true, reentry_cooldown_days: 0 });
  c.i9d = await customer();          await run(J.i9d, c.i9d, 'completed', 4 * D, 3 * D);
  J.i9e = await journey('cdp.purchase', { auto_reentry_enabled: true, allow_reentry: true, reentry_cooldown_days: 0 });
  c.i9e = await customer();          await run(J.i9e, c.i9e, 'completed', 4 * D, 3 * D);
});

describe('D1 · D4 조각(실 PG) — 멈춘 실행 = 미완료 · 대기일 = 끝난 뒤 max(최솟값, 저장 대기일)', () => {
  const pick = async (journeyId: string, ids: string[], cooldown: number, floor: number): Promise<string[]> => {
    const params: any[] = [CO, ids];
    const frag = buildReentryAntiJoin('c', params, journeyId, true, cooldown, floor);
    const r = await pool.query(`SELECT c.id FROM customers c WHERE c.company_id = $1 AND c.id = ANY($2::uuid[]) ${frag}`, params);
    return r.rows.map((x) => String(x.id)).sort();
  };
  it('① 8일 전 들어와 멈춘 실행 = 최솟값 7 · 0 어느 쪽이든 빠진다(옛: 들어온 시각으로 읽혀 통과)', async () => {
    expect(await pick(J.dorm0, [c.paused, c.fresh], 0, 7)).toEqual([c.fresh]);
    expect(await pick(J.dorm0, [c.paused, c.fresh], 0, 0)).toEqual([c.fresh]);
  });
  it('② 대기 30: 16일 전 끝남 = 빠짐 · 31일 전 끝남 = 대상 ③ 대기 730: 400일 전 끝남 = 빠짐(줄지 않는다)', async () => {
    expect(await pick(J.dorm30, [c.end16, c.end31], 30, 7)).toEqual([c.end31]);
    expect(await pick(J.dorm730, [c.end400], 730, 7)).toEqual([]);
    expect(await pick(J.dorm730, [c.end400], 365, 7)).toEqual([c.end400]);   // 365 로 잘랐다면 통과했을 고객(대조)
  });
});

describe('진입 감시 한 회차 — 상태형 ① ② ③ + 「고른 고객에게」 대조군 경합 ⑦', () => {
  it('⑦ 뽑은 뒤 대조군 실행이 끼어들어도 두 번째 실행을 넣지 않는다 · ① 멈춘 고객 새 실행 0 · ② ③ 끝난 뒤 대기일', async () => {
    await interleave([J.custom], () => runJourneyTriggerWatcher(), async () => {
      await insertMinimalRow(pool, 'journey_executions', { id: randomUUID(), journey_id: J.custom, customer_id: c.race, current_step_order: 0, status: 'holdout', entered_at: new Date() });
    });
    // ⑦ 고른 고객에게: 대조군 실행 하나뿐(옛 가드 = 진행 중만 빼서 두 번째 대조군 행이 생겼다)
    expect((await rowsOf(J.custom, c.race)).map((x) => x.status)).toEqual(['holdout']);
    // ① 휴면 · 재진입 0일: 멈춘 고객은 그대로 한 행 · 실행 없던 고객은 들어왔다
    expect((await rowsOf(J.dorm0, c.paused)).map((x) => x.status)).toEqual(['paused']);
    expect(await activeOf(J.dorm0)).toContain(c.fresh);          // (같은 회사의 다른 휴면 고객도 이 여정에 처음 들어온다)
    expect(await activeOf(J.dorm0)).not.toContain(c.paused);
    // ② 대기 30
    expect((await rowsOf(J.dorm30, c.end16)).map((x) => x.status)).toEqual(['completed']);
    expect((await rowsOf(J.dorm30, c.end31)).map((x) => x.status)).toEqual(['completed', 'active']);
    // ③ 대기 730
    expect((await rowsOf(J.dorm730, c.end400)).map((x) => x.status)).toEqual(['completed']);
  });
});

describe('D4 · D1 사건 커서 쿨다운 — 계보 전체 · 끝난 뒤 기준 · 다른 판의 멈춘 실행', () => {
  it('④ 대기 30: 40일 전 들어와 어제 끝난 실행 + 35일 전 들어온 대조군 = 아직(옛: 가장 늦게 들어온 대조군의 들어온 시각만 봐 통과)', async () => {
    const jid = await journey('cdp.purchase', { allow_reentry: true, reentry_cooldown_days: 30 });
    const cust = await customer();
    await run(jid, cust, 'completed', 40 * D, 1 * D);
    await run(jid, cust, 'holdout', 35 * D, null);
    const j: any = { id: jid, company_id: CO, allow_reentry: true, reentry_cooldown_days: 30, lineageIds: [jid] };
    expect(await checkCooldown(j, cust)).toBe(false);
    const later = await customer();
    await run(jid, later, 'completed', 80 * D, 31 * D);
    expect(await checkCooldown(j, later)).toBe(true);                       // 31일 전 끝남 = 지났다
    const active = await customer();
    await run(jid, active, 'active', 40 * D, null);
    expect(await checkCooldown(j, active)).toBe(true);                      // 진행 중 = 들어온 시각(40일 전)으로 읽는다 = 옛과 같음(사건마다 실행 · 교체 순서 유지)
    expect(await checkCooldown({ ...j, reentry_cooldown_days: 0 }, cust)).toBe(true);   // 대기 0 = 늘 참
  });
  it('⑥ 계보의 다른 판에 멈춘 실행이 있으면 넣지 않는다', async () => {
    const jid = await journey('cdp.purchase', { allow_reentry: true, reentry_cooldown_days: 0 });
    const old = await journey('cdp.purchase', { allow_reentry: true, reentry_cooldown_days: 0 });
    const cust = await customer();
    await run(old, cust, 'paused', 9 * D, null);
    const j: any = { id: jid, company_id: CO, allow_reentry: true, reentry_cooldown_days: 0, lineageIds: [jid, old] };
    expect(await checkCooldown(j, cust)).toBe(false);
    const free = await customer();
    await run(old, free, 'completed', 9 * D, 8 * D);
    expect(await checkCooldown(j, free)).toBe(true);
  });
});

describe('D1 진입 교체 — 멈춘 옛 주기는 ended 로 닫는다(뒤 여정으로 넘어가지 않는다)', () => {
  it('⑤ 진행 중 = goal_met(옛 그대로 · 뒤 여정 후보) · 멈춤 = ended(뒤 여정 후보 아님 · 되살릴 실행 0)', async () => {
    const a = await journey('cdp.purchase', { allow_reentry: true, reentry_cooldown_days: 0, trigger_filters: { entry_replace: true } });
    const b = await journey('journey.after', { trigger_filters: { after_root: a, after_outcome: 'any' } });
    const cPaused = await customer();
    const cActive = await customer();
    await run(a, cPaused, 'paused', 5 * D, null);
    await run(a, cActive, 'active', 5 * D, null);
    const since = new Date(Date.now() - H).toISOString();
    for (const cust of [cPaused, cActive]) {
      await pool.query(CLOSE_ACTIVE_FOR_REPLACEMENT_SQL, [a, cust]);
      await pool.query(CLOSE_PAUSED_FOR_REPLACEMENT_SQL, [a, cust]);
    }
    const st = async (cust: string) => (await pool.query(`SELECT status, completed_at IS NOT NULL AS ended FROM journey_executions WHERE journey_id = $1 AND customer_id = $2`, [a, cust])).rows[0];
    expect(await st(cPaused)).toEqual({ status: 'ended', ended: true });
    expect(await st(cActive)).toEqual({ status: 'goal_met', ended: true });
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM journey_executions WHERE journey_id = $1 AND status = 'paused'`, [a])).rows[0].n).toBe(0);
    const cand = await selectAfterJourneyCandidates(CO, { after_root: a, after_outcome: 'any' }, 100, b, { allowReentry: false, cooldownDays: 0, floorDays: 0, lineageIds: [b] }, '', undefined, since);
    const ids = cand.map((x) => x.customerId);
    expect(ids).toContain(cActive);          // 옛 그대로: 교체로 닫힌 진행 중 실행 = 마친 고객
    expect(ids).not.toContain(cPaused);      // 멈춰 있던 고객에게 뒤 여정 문자가 새로 나가지 않는다
  });
});

describe('D1 · D4 자동 재진입 워커 + D2 끼어들기(목록을 읽은 뒤 바뀐 여정 값)', () => {
  it('⑨ 잠금에서 기다리는 사이 바뀐 대기일 · 시작 사건 · 하루 몫 · 첫 칸 · 재진입 허용으로 판정한다 · ① 멈춘 실행 · ⑧ 최근 끝낸 실행 + 저장 대기일', async () => {
    await interleave([J.i9a, J.i9b, J.i9c, J.i9d, J.i9e], () => runReentryBatch(), async () => {
      await pool.query(`UPDATE journeys SET allow_reentry = false WHERE id = $1`, [J.i9e]);                                         // 재진입 허용 켬 → 끔(자동 켬은 그대로)
      await pool.query(`UPDATE journeys SET reentry_cooldown_days = 10 WHERE id = $1`, [J.i9a]);                                  // 대기일 0 → 10
      await pool.query(`UPDATE journeys SET trigger_event = 'customer.dormant' WHERE id = $1`, [J.i9b]);                           // 주문 완료(자동 최솟값 1) → 휴면 전환(7)
      await pool.query(`UPDATE journeys SET trigger_filters = trigger_filters || '{"backfill_per_day": 1}'::jsonb WHERE id = $1`, [J.i9c]);   // 하루 몫 1000 → 1
      await pool.query(`UPDATE journey_steps SET delay_hours = 168 WHERE journey_id = $1 AND step_order = 1`, [J.i9d]);             // 첫 칸 대기 0 → 168시간
    });
    // 끼어들기 넷 — 전부 새 값 기준
    expect(await activeOf(J.i9a)).toEqual([]);                                   // 3일 전 완료 · 새 대기일 10 = 아직(옛 값 0 이면 들어왔다)
    expect(await activeOf(J.i9b)).toEqual([]);                                   // 새 시작 사건의 최솟값 7 = 아직(옛 값 1 이면 들어왔다)
    expect((await activeOf(J.i9c)).length).toBe(1);                              // 새 하루 몫 1(옛 값 1000 이면 셋)
    const d = (await rowsOf(J.i9d, c.i9d)).filter((x) => x.status === 'active');
    expect(d).toHaveLength(1);
    expect(new Date(d[0].next_run_at as Date).getTime() - Date.now()).toBeGreaterThan(100 * H);   // 새 첫 칸 대기 168시간(옛 값이면 지금)
    expect(await activeOf(J.i9e)).toEqual([]);                                   // 재진입 허용을 끈 여정 = 넣지 않는다(목록을 읽을 때는 켜져 있었다)
    // ① 멈춘 실행이 있으면 넣지 않는다 · 대조 = 들어온다
    expect(await activeOf(J.auto0)).toEqual([c.wOk]);
    expect((await rowsOf(J.auto0, c.wPaused)).map((x) => x.status)).toEqual(['completed', 'paused']);
    // ⑧ 저장 대기일 30: 끝낸 지 8일 = 아직 · 40일 = 다시(옛: 최솟값 1일만 지나면 다시 넣었다)
    expect(await activeOf(J.auto30)).toEqual([c.wEnded40]);
  });
});

describe('배포 실측 문장(설계서 §8 P1 · S1) — 실제 표에서 오류 없이 돈다', () => {
  it('읽기 문장 넷', async () => {
    const doc = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'docs', '2026-11-11-journey-recheck-design.md'), 'utf8');
    const block = /```sql\r?\n([\s\S]*?)```/.exec(doc);
    expect(block).not.toBeNull();
    const stmts = block![1].split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('--'));
    expect(stmts).toHaveLength(4);
    for (const sql of stmts) {
      expect(sql).toMatch(/^SELECT /);
      await pool.query(sql);
    }
  });
});
