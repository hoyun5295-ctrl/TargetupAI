// replaces: none
/**
 * 날짜 기준 칸 · 한 번 보내기 = 대상 전원이 한 번 들어간다 — 실 PostgreSQL 판(★ 2026-11-01 B-1101-7 ①② · 뿌리 R40 · Codex C92 2R)
 *
 * 옛: 상한을 비운 여정은 한 번에 JOURNEY_COUNT_CAP(10만)까지만 뽑고 그날 「뽑음」으로 남아(날짜 기준) · 실행이 생겨(한 번 보내기)
 *   나머지가 조용히 빠졌다. 시험은 상수를 3 으로 줄여(옛 코드면 7명 중 3명) 고객 7명이 모두 들어가는지 본다.
 *   넣기는 한 문장(한 시점의 대상 전원) · 한 번 보내기의 멱등은 계보 잠금 안에서 다시 본다(동시 두 번 = 한 번).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

vi.mock('../journey-target-extractor', async (orig) => ({ ...(await orig() as any), JOURNEY_COUNT_CAP: 3 }));

import { dispatchOneShotJourney, dispatchAnchorStep } from '../journey-anchor-scheduler';

const CO = randomUUID();
const OWNER = randomUUID();
const CUSTS = Array.from({ length: 7 }, () => randomUUID()).sort();
const J1 = randomUUID();   // 한 번 보내기 · 상한 없음
const J1S = randomUUID();
const J2 = randomUUID();   // 날짜 기준 · 상한 없음
const J2S = randomUUID();
const J3 = randomUUID();   // 한 번 보내기 · 상한 5(넘음 = 멈춤 · 옛 그대로)
const J3S = randomUUID();
const J4 = randomUUID();   // 한 번 보내기 · 동시 두 번
const J4S = randomUUID();
const J5 = randomUUID();   // 한 번 보내기 · 상한 10(안 넘음 = 센 id 그대로 넣기)
const J5S = randomUUID();

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1107', login_id: 't-1101-paging' });
  for (const [i, id] of CUSTS.entries()) {
    await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${String(7100 + i)}`, is_active: true, sms_opt_in: true });
  }
  const base = { company_id: CO, created_by: OWNER, status: 'active', trigger_event: 'custom', trigger_filters: {}, callback_number: '0212345678' };
  const step = (id: string, journeyId: string) => insertMinimalRow(pool, 'journey_steps', { id, journey_id: journeyId, step_order: 1, step_type: 'message', channel: 'sms', message_template: '안내', delay_mode: 'relative', delay_hours: 0 });
  await insertMinimalRow(pool, 'journeys', { ...base, id: J1, name: '한 번 전원', start_kind: 'one_shot' });
  await step(J1S, J1);
  await insertMinimalRow(pool, 'journeys', { ...base, id: J2, name: '날짜 전원', start_kind: 'date_anchor', anchor_date: '2026-11-02' });
  await step(J2S, J2);
  await insertMinimalRow(pool, 'journeys', { ...base, id: J3, name: '한 번 상한 넘음', start_kind: 'one_shot', threshold_recipients_per_step: 5 });
  await step(J3S, J3);
  await insertMinimalRow(pool, 'journeys', { ...base, id: J4, name: '한 번 동시', start_kind: 'one_shot' });
  await step(J4S, J4);
  await insertMinimalRow(pool, 'journeys', { ...base, id: J5, name: '한 번 상한 안', start_kind: 'one_shot', threshold_recipients_per_step: 10 });
  await step(J5S, J5);
});

const execCount = async (j: string) => Number((await pool.query(`SELECT count(*)::int AS n FROM journey_executions WHERE journey_id = $1::uuid`, [j])).rows[0].n);
const AT = new Date('2026-11-02T01:00:00Z');

describe('R40 날짜 기준 · 한 번 보내기 = 대상 전원 한 번(실 PG)', () => {
  it('한 번 보내기 · 상한 없음 = 상수(3)를 넘는 7명 모두 실행 · 여정 들어온 수 7', async () => {
    const r = await dispatchOneShotJourney(CO, J1, AT);
    expect(r.enqueued).toBe(7);
    expect(await execCount(J1)).toBe(7);
    const s = await pool.query(`SELECT stats_total_entered FROM journeys WHERE id = $1::uuid`, [J1]);
    expect(Number(s.rows[0].stats_total_entered)).toBe(7);
  });

  it('날짜 기준 칸 · 상한 없음 = 7명 모두 (여정 · 칸 · 날) 표식 + 실행 · 같은 날 다시 = 0', async () => {
    const j = { id: J2, company_id: CO, anchor_day: '2026-11-02', anchor_recurrence: null, anchor_recurrence_day: null, anchor_hour_kst: 10, trigger_filters: {}, threshold_recipients_per_step: null };
    const s = { id: J2S, step_order: 1, anchor_offset_days: 0, target_hour_kst: 10 };
    expect(await dispatchAnchorStep(j, s, AT, '2026-11-02', AT)).toEqual({ kind: 'dispatched', enqueued: 7 });
    const d = await pool.query(`SELECT count(*)::int AS n FROM journey_anchor_dispatch WHERE journey_id = $1::uuid AND step_id = $2::uuid AND send_date = '2026-11-02'`, [J2, J2S]);
    expect(d.rows[0].n).toBe(7);
    expect(await execCount(J2)).toBe(7);
    expect(await dispatchAnchorStep(j, s, AT, '2026-11-02', AT)).toEqual({ kind: 'dispatched', enqueued: 0 });
    expect(await execCount(J2)).toBe(7);
  });

  it('상한을 정한 여정 = 옛 그대로(상한 + 1 까지 세어 넘으면 멈춤 · 넣기 0 / 안 넘으면 센 7명)', async () => {
    expect(await dispatchOneShotJourney(CO, J3, AT)).toEqual({ enqueued: 0, reason: 'threshold_exceeded' });
    expect(await execCount(J3)).toBe(0);
    expect((await pool.query(`SELECT status FROM journeys WHERE id = $1::uuid`, [J3])).rows[0].status).toBe('paused');
    expect((await dispatchOneShotJourney(CO, J5, AT)).enqueued).toBe(7);
    expect(await execCount(J5)).toBe(7);
  });

  it('한 번 보내기 · 동시에 두 번 = 한 번만 넣는다(잠금 안 멱등 · Codex C92 2R)', async () => {
    const [a, b] = await Promise.all([dispatchOneShotJourney(CO, J4, AT), dispatchOneShotJourney(CO, J4, AT)]);
    expect([a.enqueued, b.enqueued].sort()).toEqual([0, 7]);
    expect([a.reason, b.reason].filter(Boolean)).toEqual(['already_dispatched']);
    expect(await execCount(J4)).toBe(7);
  });
});

// ★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-17 · §7 — (여정 · 칸 · 날) 뽑기 = 잠금 안 한 번 · 상한 멈춤도 잠금 안
describe('3-17 날짜 기준 뽑기 한 번 · 상한 멈춤 = 잠금 안(실 PG)', () => {
  const anchorJourney = async (o: { threshold?: number | null; steps?: number } = {}) => {
    const j = randomUUID();
    const steps = Array.from({ length: o.steps ?? 1 }, () => randomUUID());
    await insertMinimalRow(pool, 'journeys', {
      id: j, company_id: CO, created_by: OWNER, status: 'active', trigger_event: 'custom', trigger_filters: {}, callback_number: '0212345678',
      name: '날짜 기준 3-17', start_kind: 'date_anchor', anchor_date: '2026-11-02', threshold_recipients_per_step: o.threshold ?? null,
    });
    for (const [i, s2] of steps.entries()) {
      await insertMinimalRow(pool, 'journey_steps', { id: s2, journey_id: j, step_order: i + 1, step_type: 'message', channel: 'sms', message_template: '안내', delay_mode: 'relative', delay_hours: 0 });
    }
    return {
      j: { id: j, company_id: CO, anchor_day: '2026-11-02', anchor_recurrence: null, anchor_recurrence_day: null, anchor_hour_kst: 10, trigger_filters: {}, threshold_recipients_per_step: o.threshold ?? null },
      steps: steps.map((id, i) => ({ id, step_order: i + 1, anchor_offset_days: i, target_hour_kst: 10 })),
    };
  };
  const status = async (j: string) => (await pool.query(`SELECT status FROM journeys WHERE id = $1::uuid`, [j])).rows[0].status;

  it('두 연결이 같은 (칸 · 날)을 함께 뽑음 = 한 번만(7명 · 다른 쪽 0)', async () => {
    const { j, steps } = await anchorJourney();
    const [a, b] = await Promise.all([dispatchAnchorStep(j, steps[0], AT, '2026-11-02', AT), dispatchAnchorStep(j, steps[0], AT, '2026-11-02', AT)]);
    expect([a.enqueued, b.enqueued].sort()).toEqual([0, 7]);
    expect(await execCount(j.id)).toBe(7);
  });

  it('뽑은 뒤 대상이 상한을 넘게 늘어도 같은 날 다시 = 아무것도 안 함(멈춤 0 · 이미 넣은 발송 그대로)', async () => {
    const { j, steps } = await anchorJourney({ threshold: 7 });
    expect((await dispatchAnchorStep(j, steps[0], AT, '2026-11-02', AT)).enqueued).toBe(7);
    const extra = [randomUUID(), randomUUID()];
    for (const [i, id] of extra.entries()) await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${String(7200 + i)}`, is_active: true, sms_opt_in: true });
    try {
      expect((await dispatchAnchorStep(j, steps[0], AT, '2026-11-02', AT)).enqueued).toBe(0);
      expect(await status(j.id)).toBe('active');
    } finally {
      await pool.query(`UPDATE customers SET is_active = false WHERE id = ANY($1::uuid[])`, [extra]);   // 이 파일 뒤 시험의 대상 수(7) 그대로
    }
  });

  it('2칸 여정 · 1칸 실행이 아직 진행 중인데 2칸 날이 옴 = 2칸 실행도 생김(같은 고객 진행 중 실행이 여럿 = 정상)', async () => {
    const { j, steps } = await anchorJourney({ steps: 2 });
    expect((await dispatchAnchorStep(j, steps[0], AT, '2026-11-02', AT)).enqueued).toBe(7);
    expect((await dispatchAnchorStep(j, steps[1], AT, '2026-11-03', AT)).enqueued).toBe(7);
    expect(await execCount(j.id)).toBe(14);
  });
});
