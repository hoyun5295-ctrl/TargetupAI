// replaces: none
/**
 * C104 · 같은 사실 = 같은 입력 — 실 PostgreSQL(★ 2026-11-05 설계서 docs/2026-11-05-c104-same-fact-same-input-design.md §6 실 PG)
 *
 *   G1 켜기 관문 = 나갈 판마다(기본 문안 채울 자리 + A/B 판 깨끗 = 막지 않음 · A/B 판 채울 자리 = 「1번째 칸 B안」)
 *   G7 점검 판 = 같은 칸 · 같은 판 · 같은 원인 한 줄
 *   G3 초안 A/B 칸 기본 문안 고침 = 409(초안 문구)
 *   G2 혜택 넣기 = 초안 A/B 판까지 · 켜진 여정 = 판 그대로 + 남은 판 수
 *   G4 지도 미리보기 = A/B 판
 *   G5 세기 입력 = 계보 · 재진입(실제 진입과 같은 수) · G6 이관 유예로 빠진 수
 * 고객 번호 = 010-0000-xxxx(도달 불가 대역).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';

vi.mock('../spam-test-queue', async (orig) => ({ ...(await orig<any>()), peekSpamCheck: async () => null, enqueueSpamTest: async () => ({ ok: true, testId: randomUUID() }) }));
vi.mock('../journey-message-render', async (orig) => ({
  ...(await orig<any>()),
  renderJourneySmsMessage: async (p: any) => ({ message: String(p.template || ''), subject: p.subject || '', msgType: p.channel === 'sms' ? 'SMS' : 'LMS' }),
  pickJourneySampleCustomer: async () => ({}),
}));

import { activationBlockIssue, updateJourneyStep, fillJourneyCopyFacts, JourneyStepGateError, AB_STEP_COPY_LOCKED_DRAFT_MESSAGE } from '../journey-builder';
import { checkJourney } from '../journey-check';
import { buildLifecycleMap } from '../journey-lifecycle-map';
import { journeyEntryInputs, countJourneyTargetsWithGrace, selectJourneyTargetCustomerIds, countJourneyTargets } from '../journey-target-extractor';
import { simulateJourney } from '../journey-simulator';
import { intakeGraceHeldText } from '../journey-intake-grace';
import { BENEFIT_PLACEHOLDER } from '../copy-benefit-detector';

const CO = randomUUID();
const OWNER = randomUUID();
const CB = '0212341105';
const JD = randomUUID();   // 초안 · A/B 칸
const SD = randomUUID();
const JA = randomUUID();   // 켜진 여정 · A/B 칸
const SA = randomUUID();
const LINE = randomUUID();
const JO = randomUUID();   // 옛 판(같은 계보)
const JN = randomUUID();   // 새 판
const VB = randomUUID();   // 초안 칸 B안 행 id
const OLD = Array.from({ length: 6 }, () => randomUUID());
const NEW = Array.from({ length: 4 }, () => randomUUID());

const ok = '반가워요. 오늘 매장에 들러 주시면 작은 선물을 드려요.';

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C89-DDL-1'));   // 사람 값 원장(journeys.copy_facts)
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C104 같은 입력 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1105', login_id: 't-1105-c104' });
  await insertMinimalRow(pool, 'sender_numbers', { id: randomUUID(), company_id: CO, phone_number: CB, is_active: true });

  await insertMinimalRow(pool, 'journeys', { id: JD, company_id: CO, created_by: OWNER, name: 'A/B 초안', status: 'draft', start_kind: 'event', trigger_event: 'custom', trigger_filters: { all_customers: true }, callback_number: CB });
  await insertMinimalRow(pool, 'journey_steps', { id: SD, journey_id: JD, step_order: 1, step_type: 'message', channel: 'lms', subject: '안내', message_template: `기본 문안 ${BENEFIT_PLACEHOLDER} 드려요`, delay_mode: 'relative', delay_hours: 0 });
  await insertMinimalRow(pool, 'journey_step_variants', { step_id: SD, variant_id: 'A', message_template: `A안 ${ok}`, subject: null });
  await insertMinimalRow(pool, 'journey_step_variants', { id: VB, step_id: SD, variant_id: 'B', message_template: `B안 ${ok}`, subject: 'B 제목' });

  await insertMinimalRow(pool, 'journeys', { id: JA, company_id: CO, created_by: OWNER, name: 'A/B 켜짐', status: 'active', start_kind: 'event', trigger_event: 'custom', trigger_filters: { all_customers: true }, callback_number: CB });
  await insertMinimalRow(pool, 'journey_steps', { id: SA, journey_id: JA, step_order: 1, step_type: 'message', channel: 'lms', subject: '안내', message_template: `기본 ${BENEFIT_PLACEHOLDER} 드려요`, delay_mode: 'relative', delay_hours: 0 });
  await insertMinimalRow(pool, 'journey_step_variants', { step_id: SA, variant_id: 'A', message_template: `A안 ${BENEFIT_PLACEHOLDER} 드려요`, subject: null });
  await insertMinimalRow(pool, 'journey_step_variants', { step_id: SA, variant_id: 'B', message_template: null, subject: null });   // 판 글 비면 칸 글

  // 계보 두 판 · 고른 고객에게(상시 대상) · 재진입 끔
  await insertMinimalRow(pool, 'journeys', { id: JO, company_id: CO, created_by: OWNER, name: '옛 판', status: 'ended', start_kind: 'event', trigger_event: 'custom', trigger_filters: {}, callback_number: CB, lineage_id: LINE, allow_reentry: false });
  await insertMinimalRow(pool, 'journeys', { id: JN, company_id: CO, created_by: OWNER, name: '새 판', status: 'draft', start_kind: 'event', trigger_event: 'custom', trigger_filters: {}, callback_number: CB, lineage_id: LINE, allow_reentry: false });
  let n = 0;
  for (const id of [...OLD, ...NEW]) {
    n += 1;
    await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${String(1100 + n)}`, is_active: true, sms_opt_in: true });
  }
  await pool.query(`UPDATE customers SET created_at = NOW() - INTERVAL '60 days' WHERE id = ANY($1::uuid[])`, [OLD]);
  await pool.query(`UPDATE customers SET created_at = NOW() - INTERVAL '3 days' WHERE id = ANY($1::uuid[])`, [NEW]);
  await insertMinimalRow(pool, 'journey_executions', { id: randomUUID(), journey_id: JO, customer_id: OLD[0], status: 'completed' });   // 옛 판에서 이미 받음
});

describe('G1 · G7 켜기 관문 = 나갈 판마다 · 점검 판 한 줄', () => {
  it('기본 문안에 채울 자리가 있어도 A/B 판이 깨끗하면 그 칸으로 막지 않는다(기본 문안은 안 나간다)', async () => {
    expect(await activationBlockIssue(CO, JD, { forCheck: true })).toBeNull();   // 관문 끝까지 지난다(빈 확인 0)
  });
  it('A/B 판에 채울 자리 = 「1번째 칸 B안」 · 원인 · 판 id', async () => {
    await pool.query(`UPDATE journey_step_variants SET message_template = $2 WHERE id = $1`, [VB, `B안 ${BENEFIT_PLACEHOLDER} 드려요`]);
    const issue = await activationBlockIssue(CO, JD, { forCheck: true });
    expect(issue).toEqual({ stepOrder: 1, variantId: VB, cause: 'placeholder_unedited', message: '1번째 칸 B안에 채울 자리 [...] 가 남아 있어요. A/B 창에서 고쳐 주세요.' });
  });
  it('점검 판 = 같은 칸 · 같은 판 · 같은 원인은 한 줄(켜기 검증 줄만)', async () => {
    const c = await checkJourney(CO, JD, OWNER);
    const fixB = (c.steps[SD] ?? []).filter((i) => i.level === 'fix' && i.variantId === VB);
    expect(fixB.map((i) => i.key)).toEqual([`placeholder_unedited:${VB}`]);
    expect((c.steps[SD] ?? []).some((i) => i.key === 'definition')).toBe(false);
  });
});

describe('G3 초안 · 멈춘 여정도 A/B 칸 기본 문안 고침 = 409', () => {
  it('초안 A/B 칸 본문 · 제목 고침 = AB_STEP_COPY_LOCKED · 초안 문구 · 저장 0', async () => {
    const err = await updateJourneyStep(CO, JD, SD, { messageTemplate: `새 기본 ${ok}` }).catch((e) => e);
    expect(err).toBeInstanceOf(JourneyStepGateError);
    expect(err.code).toBe('AB_STEP_COPY_LOCKED');
    expect(err.message).toBe(AB_STEP_COPY_LOCKED_DRAFT_MESSAGE);
    const sub = await updateJourneyStep(CO, JD, SD, { subject: '새 제목' }).catch((e) => e);
    expect(sub?.code).toBe('AB_STEP_COPY_LOCKED');
    expect((await pool.query(`SELECT message_template, subject FROM journey_steps WHERE id = $1`, [SD])).rows[0]).toEqual({ message_template: `기본 문안 ${BENEFIT_PLACEHOLDER} 드려요`, subject: '안내' });
  });
});

describe('G2 혜택 넣기', () => {
  it('초안 = 칸 글 + A/B 판까지 채운다 · 남은 판 0 · 그 뒤 켜기 관문이 그 칸을 막지 않는다', async () => {
    const out = await fillJourneyCopyFacts(CO, JD, { benefit: '첫 구매 10% 할인쿠폰' });
    expect(out?.variantsLeft).toBe(0);
    const v = (await pool.query(`SELECT variant_id, message_template FROM journey_step_variants WHERE step_id = $1 ORDER BY variant_id`, [SD])).rows;
    expect(v).toEqual([
      { variant_id: 'A', message_template: `A안 ${ok}` },
      { variant_id: 'B', message_template: 'B안 첫 구매 10% 할인쿠폰 드려요' },
    ]);
    expect((await pool.query(`SELECT message_template FROM journey_steps WHERE id = $1`, [SD])).rows[0].message_template).toBe('기본 문안 첫 구매 10% 할인쿠폰 드려요');
    expect(await activationBlockIssue(CO, JD, { forCheck: true })).toBeNull();
  });
  it('켜진 여정 = 칸 글만 채우고 A/B 판은 그대로 · 채울 자리가 남은 판 수(판 글이 비면 칸 글로 본다)', async () => {
    const out = await fillJourneyCopyFacts(CO, JA, { benefit: '첫 구매 10% 할인쿠폰' });
    expect(out?.variantsLeft).toBe(1);   // A안 = 자리 남음 · B안 = 비어 칸 글(채워짐)로 나감
    const v = (await pool.query(`SELECT variant_id, message_template FROM journey_step_variants WHERE step_id = $1 ORDER BY variant_id`, [SA])).rows;
    expect(v).toEqual([
      { variant_id: 'A', message_template: `A안 ${BENEFIT_PLACEHOLDER} 드려요` },
      { variant_id: 'B', message_template: null },
    ]);
    expect((await pool.query(`SELECT message_template FROM journey_steps WHERE id = $1`, [SA])).rows[0].message_template).toBe('기본 첫 구매 10% 할인쿠폰 드려요');
  });
});

describe('G4 지도 칸 미리보기 = 나갈 판', () => {
  it('A/B 칸 = 「A/B 2개 · 」 + A안 글', async () => {
    const map: any = await buildLifecycleMap(CO);
    const steps = JSON.parse(JSON.stringify(map)).journeys?.flatMap((j: any) => j.steps ?? []) ?? [];
    const s = steps.find((x: any) => x.stepId === SD);
    expect(s?.preview).toBe(`A/B 2개 · A안 ${ok}`.slice(0, `A/B 2개 · `.length + 60));
  });
});

describe('G5 · G6 대상 세기 = 실제 진입과 같은 입력 · 유예로 빠진 수', () => {
  it('진입 입력 CT = 계보 두 판 · 재진입 끔', async () => {
    const e = await journeyEntryInputs(CO, JN);
    expect([...e.reentry.lineageIds].sort()).toEqual([JO, JN].sort());
    expect(e.reentry.allowReentry).toBe(false);
  });
  it('지금 대상 = 옛 판에서 받은 1명 · 등록 7일 안 4명을 뺀 5명 = 실제 진입 목록 수 · 빠진 수 4', async () => {
    const e = await journeyEntryInputs(CO, JN);
    const g = await countJourneyTargetsWithGrace(CO, 'custom', {}, JN, e);
    expect(g.total).toBe(5);
    expect(g.graceHeld).toBe(4);
    expect(g.graceDays).toBe(7);
    const entered = await selectJourneyTargetCustomerIds(CO, 'custom', {}, 1000, JN, e.reentry, e.scopeSql, e.consent);
    expect(entered.length).toBe(5);
    expect(entered).not.toContain(OLD[0]);
    // 유예를 켠 원래 세기와 같은 수(같은 SQL · 같은 스냅숏)
    expect((await countJourneyTargets(CO, 'custom', {}, JN, e.scopeSql, e.consent, e.reentry)).total).toBe(5);
  });
  it('유예 0 = 빠짐 0 · 9명', async () => {
    const e = await journeyEntryInputs(CO, JN);
    const g = await countJourneyTargetsWithGrace(CO, 'custom', { intake_grace_days: 0 }, JN, e);
    expect(g).toMatchObject({ total: 9, graceHeld: 0, graceDays: 0 });
  });
  it('시뮬레이터 = 같은 수 · 실제 모드 · 유예 문구', async () => {
    const sim = await simulateJourney(JN, CO);
    expect(sim.matchedCustomers).toBe(5);
    expect(sim.approximate).toBe(false);
    expect(sim.warnings).toContain(intakeGraceHeldText(7, 4));
  });
});
