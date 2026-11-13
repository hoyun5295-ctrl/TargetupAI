// replaces: none
/**
 * C133 배포 B — 무료 추정 · 실 PostgreSQL 판(★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §3-1 4 ~ 6번)
 *   시뮬레이터(모델 호출 0 · 차감 0)가 켜기 창에 주는 값: 켜면 바로 멈추는가 · 그 판정에 쓴 최대 인원 · 선불 잔액.
 *   1. 저장된 최대 인원으로 판정(종전) · 화면이 물은 값(저장 전)으로 판정 · 비움으로 판정 — 저장된 값은 바뀌지 않는다
 *   2. 선불 회사 = 잔액 · 후불 회사 = null
 *   3. 진단 = 단계가 열린 회사만 순간 칸 셋 · 닫힌 회사는 다섯 칸
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { simulateJourney } from '../journey-simulator';
import { buildJourneyDiagnosis, clearDiagnosisCache } from '../journey-opportunities';

const PRE = randomUUID();          // 선불 회사
const POST = randomUUID();         // 후불 회사
const PLAN = randomUUID();
const OWNER = randomUUID();
const J = randomUUID();            // 상시 대상(고른 고객에게) · 최대 인원 3 · 대상 5명
const J_POST = randomUUID();
const CB = '0212341113';

const savedEnv = process.env.V3_STAGE_JOURNEY_PACK;
beforeAll(async () => {
  delete process.env.V3_STAGE_JOURNEY_PACK;
  await insertMinimalRow(pool, 'plans', { id: PLAN, plan_code: 'C133B', plan_name: '유료', is_active: true });
  await insertMinimalRow(pool, 'companies', { id: PRE, company_name: 'C133 선불', plan_id: PLAN, billing_type: 'prepaid', balance: 12345 });
  await insertMinimalRow(pool, 'companies', { id: POST, company_name: 'C133 후불', plan_id: PLAN, billing_type: 'postpaid', balance: 0 });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: PRE, user_type: 'admin', is_active: true, login_id: 't-c133b' });
  await insertMinimalRow(pool, 'sender_numbers', { id: randomUUID(), company_id: PRE, phone_number: CB, is_active: true });
  await insertMinimalRow(pool, 'journeys', {
    id: J, company_id: PRE, created_by: OWNER, name: '상시 대상', status: 'draft', start_kind: 'event', trigger_event: 'custom',
    trigger_filters: { all_customers: true, intake_grace_days: 0 }, callback_number: CB, threshold_recipients_per_step: 3,
  });
  await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: J, step_order: 1, step_type: 'message', channel: 'sms', message_template: '안녕하세요', delay_mode: 'relative', delay_hours: 0 });
  for (let i = 0; i < 5; i += 1) {
    await insertMinimalRow(pool, 'customers', { id: randomUUID(), company_id: PRE, phone: `0100000${String(1330 + i)}`, is_active: true, sms_opt_in: true });
  }
  await insertMinimalRow(pool, 'journeys', {
    id: J_POST, company_id: POST, name: '후불 여정', status: 'draft', start_kind: 'event', trigger_event: 'custom',
    trigger_filters: { all_customers: true, intake_grace_days: 0 }, callback_number: CB,
  });
});
afterAll(() => {
  if (savedEnv === undefined) delete process.env.V3_STAGE_JOURNEY_PACK; else process.env.V3_STAGE_JOURNEY_PACK = savedEnv;
});

const storedCap = async () => (await query('SELECT threshold_recipients_per_step AS cap FROM journeys WHERE id = $1::uuid', [J])).rows[0].cap;

describe('켜면 바로 멈추는가 — 저장된 값 · 화면이 물은 값(실 PG)', () => {
  it('저장된 최대 인원 3 · 대상 5명 = 켜면 바로 멈춘다(경고 문장과 같은 판정)', async () => {
    const sim = await simulateJourney(J, PRE);
    expect(sim.matchedCustomers).toBe(5);
    expect(sim).toMatchObject({ firstRoundCapExceeded: true, capUsed: 3 });
    expect(sim.warnings.some((w) => w.includes('켜면 바로 멈춰요'))).toBe(true);
  });

  it('화면이 칸에 적은 값으로 다시 물으면 그 값으로 판정한다 · 저장된 값은 그대로', async () => {
    const more = await simulateJourney(J, PRE, { cap: 5 });
    expect(more).toMatchObject({ firstRoundCapExceeded: false, capUsed: 5 });
    expect(more.warnings.some((w) => w.includes('켜면 바로 멈춰요'))).toBe(false);
    expect(await simulateJourney(J, PRE, { cap: 4 })).toMatchObject({ firstRoundCapExceeded: true, capUsed: 4 });
    expect(await simulateJourney(J, PRE, { cap: null })).toMatchObject({ firstRoundCapExceeded: false, capUsed: null });   // 비움 = 제한 없음
    expect(Number(await storedCap())).toBe(3);
    expect(await simulateJourney(J, PRE)).toMatchObject({ firstRoundCapExceeded: true, capUsed: 3 });
  });

  it('추정 값(대상 · 발송 · 비용)은 최대 인원을 어떻게 묻든 같다(판정 칸만 달라진다)', async () => {
    const a = await simulateJourney(J, PRE);
    const b = await simulateJourney(J, PRE, { cap: 1000 });
    expect([b.matchedCustomers, b.totalEstimatedSends, b.totalEstimatedCost]).toEqual([a.matchedCustomers, a.totalEstimatedSends, a.totalEstimatedCost]);
  });
});

describe('선불 잔액(실 PG)', () => {
  it('선불 회사 = 지금 잔액 · 후불 회사 = null', async () => {
    expect((await simulateJourney(J, PRE)).prepaidBalance).toBe(12345);
    expect((await simulateJourney(J_POST, POST)).prepaidBalance).toBeNull();
  });
  it('피로도 상한 = 켜짐 · 꺼짐을 가른다(꺼졌을 때만 켜기 창이 안내한다)', async () => {
    expect((await simulateJourney(J, PRE)).fatigueCap).toBe('off');
    await query('UPDATE companies SET fatigue_cap_days = 7, fatigue_cap_max = 3 WHERE id = $1::uuid', [PRE]);
    expect((await simulateJourney(J, PRE)).fatigueCap).toBe('on');
    await query('UPDATE companies SET fatigue_cap_days = 7, fatigue_cap_max = NULL WHERE id = $1::uuid', [PRE]);   // 둘 다 있어야 켜진 것(게이트와 같은 판정)
    expect((await simulateJourney(J, PRE)).fatigueCap).toBe('off');
    expect((await simulateJourney(J_POST, POST)).fatigueCap).toBe('off');
  });
  it('다른 회사의 여정은 읽지 못한다', async () => {
    await expect(simulateJourney(J, POST)).rejects.toMatchObject({ status: 404 });
  });
});

describe('진단 — 단계 개방(실 PG)', () => {
  it('닫힌 회사 = 다섯 칸 · pack false / 명단에 든 유료 회사 = 여덟 칸 · pack true', async () => {
    clearDiagnosisCache();
    const off = await buildJourneyDiagnosis(PRE, OWNER);
    expect(off.pack).toBe(false);
    expect(off.flowPlan).toHaveLength(5);
    process.env.V3_STAGE_JOURNEY_PACK = PRE;
    const on = await buildJourneyDiagnosis(PRE, OWNER);
    expect(on.pack).toBe(true);
    expect(on.flowPlan.map((p) => p.key)).toEqual(['signup', 'first_purchase', 'repurchase', 'dormant', 'dormant_return', 'cart', 'browse', 'birthday']);
    expect(on.flowPlan.slice(0, 5)).toEqual(off.flowPlan);
    // 다른 회사는 명단에 없어 그대로 다섯 칸
    expect((await buildJourneyDiagnosis(POST, null)).flowPlan).toHaveLength(5);
  });
});
