/**
 * 여정 V2 4차 — 끝 칸 · 갈림 · 새 조건 2종 · 칸 한도(문자 7 + 전체 12) (2026-09-30 · 설계서 §7)
 *
 * 못 박는 것:
 *   - 끝 칸 쓰기는 스위치(JOURNEY_END_CHIP_ENABLED)가 켜졌을 때만 · 읽는 쪽(실행기 · 그림 · 활성화)은 늘 안다
 *   - 칸 한도: 문자 8 = 거부 · 문자 7 + 대기/조건/끝 = 전체 12까지
 *   - 그림: 끝 칸은 나가는 간선이 없다 · 끝 뒤 칸은 "아니면" 갈래로만 닿는다 · 닿지 않는 칸 = 켜기 거부 · 갈래별 D+N
 *   - 저장: 첫 칸 끝 = 거부 · 끝 칸 대기 0 고정 · 링크 클릭 조건의 칸 번호 → 칸 id 변환 · 잘못된 번호 거부
 *   - 활성화: 닿지 않는 칸 · 링크 조건 대상 · 들어온 뒤 구매 조건 검증
 *   - 실행기(원문): 끝 칸 = 발송 0 · 완료 · 다음 칸이 끝이면 기다리지 않고 완료 · 새 조건은 오류 = 보류(error)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../company-data-profile', () => ({ getCompanyJourneyFacts: vi.fn() }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(), getKoreanCalendar: vi.fn(() => '') }));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: vi.fn() }));

import { query } from '../../config/database';
import { getCompanyJourneyFacts } from '../company-data-profile';
import { isKnownStepType, resolveStepType, assertStepsWithinLimit, JourneyInputError, MAX_MESSAGE_STEPS, MAX_JOURNEY_STEPS } from '../journey-step-limits';
import { buildJourneyGraph } from '../journey-graph';
import { createJourneyFromTemplate, activateJourney } from '../journey-builder';

const q = query as unknown as ReturnType<typeof vi.fn>;
const facts = getCompanyJourneyFacts as unknown as ReturnType<typeof vi.fn>;
const COMPANY = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const JOURNEY = '11111111-1111-1111-1111-111111111111';
const MSG = (order: number, over: Record<string, any> = {}) => ({ stepOrder: order, stepType: 'message', delayHours: 24, channel: 'lms', messageTemplate: '%고객명%님, 오랜만에 인사드립니다. 편하실 때 들러 주세요.', subject: '안부', isAd: true, ...over });
const g = (order: number, type: string, over: Record<string, any> = {}) => ({ id: `s${order}`, step_order: order, step_type: type, delay_hours: 24, ...over });
const SRC = (f: string) => readFileSync(resolve(process.cwd(), 'src/utils', f), 'utf8');

const ENV = process.env.JOURNEY_END_CHIP_ENABLED;
beforeEach(() => { q.mockReset(); facts.mockReset(); delete process.env.JOURNEY_END_CHIP_ENABLED; });
afterEach(() => { if (ENV === undefined) delete process.env.JOURNEY_END_CHIP_ENABLED; else process.env.JOURNEY_END_CHIP_ENABLED = ENV; });

describe('끝 칸 스위치 · 칸 한도', () => {
  it('스위치가 꺼져 있으면 끝 칸을 저장하지 않는다 · 켜면 받는다', () => {
    expect(isKnownStepType('end')).toBe(false);
    expect(() => resolveStepType('end', '1번째 칸')).toThrow(JourneyInputError);
    process.env.JOURNEY_END_CHIP_ENABLED = 'true';
    expect(isKnownStepType('end')).toBe(true);
    expect(resolveStepType('end', '1번째 칸')).toBe('end');
  });
  it('문자 8 = 거부 · 문자 7 + 그 밖 5 = 12 까지 · 13 = 거부', () => {
    expect(MAX_MESSAGE_STEPS).toBe(7);
    expect(MAX_JOURNEY_STEPS).toBe(12);
    expect(() => assertStepsWithinLimit(Array.from({ length: 8 }, () => ({ stepType: 'message' })), 't')).toThrow(JourneyInputError);
    expect(() => assertStepsWithinLimit(Array.from({ length: 8 }, () => ({})), 't')).toThrow(JourneyInputError);
    expect(() => assertStepsWithinLimit([...Array.from({ length: 7 }, () => ({ stepType: 'message' })), ...Array.from({ length: 5 }, () => ({ stepType: 'wait' }))], 't')).not.toThrow();
    expect(() => assertStepsWithinLimit(Array.from({ length: 13 }, () => ({ stepType: 'wait' })), 't')).toThrow(JourneyInputError);
  });
});

describe('그림 = 실행기 규칙(갈림)', () => {
  // [조건(아니면 4)] → 2 문자 → 3 끝 → 4 문자 → 5 문자
  const branch = [g(1, 'condition', { delay_hours: 0, not_met_goto: 4 }), g(2, 'message', { delay_hours: 24 }), g(3, 'end'), g(4, 'message', { delay_hours: 72 }), g(5, 'message', { delay_hours: 48 })];
  it('끝 칸은 나가는 간선이 없고 끝 뒤 칸은 "아니면" 갈래로만 닿는다', () => {
    const graph = buildJourneyGraph(branch, { goalExitEnabled: false });
    expect(graph.edges.filter((e) => e.from === 3)).toEqual([]);
    expect(graph.edges).toContainEqual({ from: 1, to: 4, kind: 'not_met' });
    expect(graph.nodes.every((n) => n.reachable)).toBe(true);
    expect(graph.blockingIssues).toEqual([]);
  });
  it('갈래별 D+N — 끝 뒤 칸은 조건 시점 + 자기 대기(줄 순서 누적이 아니다)', () => {
    const graph = buildJourneyGraph(branch, { goalExitEnabled: false });
    expect(graph.nodes.find((n) => n.order === 2)!.timingLabel).toBe('D+1');
    expect(graph.nodes.find((n) => n.order === 3)!.timingLabel).toBe('여기서 끝');
    expect(graph.nodes.find((n) => n.order === 4)!.timingLabel).toBe('D+3');
    expect(graph.nodes.find((n) => n.order === 5)!.timingLabel).toBe('D+5');
  });
  it('끝 뒤 칸을 아무 갈래도 가리키지 않으면 닿지 않음 = 켜기를 막는 결함 · 첫 칸 끝도 막는다', () => {
    const orphan = [g(1, 'message', { delay_hours: 0 }), g(2, 'end'), g(3, 'message')];
    const graph = buildJourneyGraph(orphan, { goalExitEnabled: false });
    expect(graph.nodes.find((n) => n.order === 3)!.reachable).toBe(false);
    expect(graph.blockingIssues[0]).toContain('3번째 칸은 어느 갈래에서도 닿지 않아요');
    expect(buildJourneyGraph([g(1, 'end'), g(2, 'message')], { goalExitEnabled: false }).blockingIssues[0]).toContain('첫 칸이 끝 칸');
  });
  it('목표 출구는 끝 칸 앞뒤에 없다 · 갈림이 없으면 옛 규칙 그대로', () => {
    expect(buildJourneyGraph(branch, { goalExitEnabled: true }).exitSlots).toEqual([0, 1, 4]);
    expect(buildJourneyGraph([g(1, 'message'), g(2, 'message'), g(3, 'message')], { goalExitEnabled: true }).exitSlots).toEqual([0, 1, 2]);
  });
});

describe('저장 경로', () => {
  function capture() {
    const cap: { updates: any[][] } = { updates: [] };
    let n = 0;
    q.mockImplementation(async (sql: string, params?: any[]) => {
      if (/INSERT INTO journeys \(/.test(sql)) return { rows: [{ id: JOURNEY }] };
      if (/INSERT INTO journey_steps/.test(sql)) { n += 1; return { rows: [{ id: `step-${n}` }] }; }
      if (/UPDATE journey_steps SET condition_jsonb/.test(sql)) { cap.updates.push(params || []); return { rows: [] }; }
      return { rows: [], rowCount: 0 };
    });
    return cap;
  }
  const base = { companyId: COMPANY, createdBy: USER, templateCode: 'repeat', callbackNumber: '0200000000', triggerEvent: 'cdp.purchase', triggerFilters: {} } as any;
  it('첫 칸 끝 = 거부 · 끝 칸 대기는 0으로 고정', async () => {
    process.env.JOURNEY_END_CHIP_ENABLED = 'true';
    capture();
    await expect(createJourneyFromTemplate({ ...base, steps: [{ stepOrder: 1, stepType: 'end', delayHours: 0 }, MSG(2)] })).rejects.toBeInstanceOf(JourneyInputError);
    const inserts: any[] = [];
    q.mockImplementation(async (sql: string, params?: any[]) => {
      if (/INSERT INTO journeys \(/.test(sql)) return { rows: [{ id: JOURNEY }] };
      if (/INSERT INTO journey_steps/.test(sql)) { inserts.push({ sql, params }); return { rows: [{ id: `step-${inserts.length}` }] }; }
      return { rows: [], rowCount: 0 };
    });
    await createJourneyFromTemplate({ ...base, steps: [MSG(1), { stepOrder: 2, stepType: 'end', delayHours: 99 }] });
    const endInsert = inserts[1];
    const sql: string = endInsert.sql;
    const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(') VALUES')).split(',').map((c: string) => c.trim());
    const vals = sql.slice(sql.indexOf('VALUES (') + 8, sql.lastIndexOf(')')).split(',').map((v: string) => v.trim());
    const m = vals[cols.indexOf('delay_hours')].match(/^\$(\d+)/);
    expect(endInsert.params[Number(m![1]) - 1]).toBe(0);
  });
  it('링크 클릭 조건: 칸 번호 → 저장 뒤 칸 id 로 바꾼다 · 앞쪽 문자 칸이 아니면 거부', async () => {
    const cap = capture();
    await createJourneyFromTemplate({ ...base, steps: [MSG(1), { stepOrder: 2, stepType: 'condition', delayHours: 72, conditionJsonb: { type: 'step_link_clicked', step_ref_order: 1, clicked: false } }, MSG(3)] });
    expect(cap.updates).toHaveLength(1);
    expect(cap.updates[0][0]).toBe('step-2');
    expect(JSON.parse(cap.updates[0][1])).toEqual({ type: 'step_link_clicked', step_id: 'step-1', clicked: false });
    capture();
    await expect(createJourneyFromTemplate({ ...base, steps: [MSG(1), { stepOrder: 2, stepType: 'condition', delayHours: 0, conditionJsonb: { type: 'step_link_clicked', step_ref_order: 3, clicked: true } }, MSG(3)] }))
      .rejects.toBeInstanceOf(JourneyInputError);
  });
});

describe('활성화 게이트', () => {
  const FACTS = { canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true, hasGrade: true, hasGradeOrder: true, hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true };
  const LINE = '%고객명%님, 오랜만에 인사드립니다. 편하실 때 들러 주세요.';
  function mockJourney(steps: any[]) {
    facts.mockResolvedValue(FACTS);
    q.mockImplementation(async (sql: string) => {
      if (/FROM journeys j/.test(sql) && /json_agg/.test(sql)) {
        return { rows: [{ callback_number: '0212345678', status: 'draft', start_kind: 'event', anchor_date: null, trigger_event: 'cdp.purchase', threshold_recipients_per_step: 100, allow_reentry: true, reentry_cooldown_days: 0, trigger_filters: {}, steps }] };
      }
      return { rows: [], rowCount: 0 };
    });
  }
  it('끝 뒤 칸이 어느 갈래에서도 닿지 않으면 켜지 않는다', async () => {
    mockJourney([
      { id: 'a', order: 1, type: 'message', channel: 'lms', message: LINE, subject: '안부', delay: 0 },
      { id: 'b', order: 2, type: 'end', delay: 0 },
      { id: 'c', order: 3, type: 'message', channel: 'lms', message: LINE, subject: '안부', delay: 24 },
    ]);
    const r = await activateJourney(COMPANY, JOURNEY, USER);
    expect(r).toMatchObject({ ok: false });
    expect(r.reason).toContain('닿지 않아요');
  });
  it('링크 클릭 조건은 앞쪽 문자 칸 · 눌렀음 여부가 있어야 켠다', async () => {
    mockJourney([
      { id: 'a', order: 1, type: 'message', channel: 'lms', message: LINE, subject: '안부', delay: 0 },
      { id: 'b', order: 2, type: 'condition', delay: 72, condition: { type: 'step_link_clicked', step_id: 'zzz', clicked: true } },
      { id: 'c', order: 3, type: 'message', channel: 'lms', message: LINE, subject: '안부', delay: 0 },
    ]);
    expect((await activateJourney(COMPANY, JOURNEY, USER)).reason).toContain('링크 클릭');
    mockJourney([
      { id: 'a', order: 1, type: 'message', channel: 'lms', message: LINE, subject: '안부', delay: 0 },
      { id: 'b', order: 2, type: 'condition', delay: 72, condition: { type: 'purchase_since_entry', purchased: 'yes' } },
      { id: 'c', order: 3, type: 'message', channel: 'lms', message: LINE, subject: '안부', delay: 0 },
    ]);
    expect((await activateJourney(COMPANY, JOURNEY, USER)).reason).toContain('들어온 뒤 구매');
  });
});

describe('실행기 배선(원문)', () => {
  const src = SRC('journey-executor.ts');
  it('끝 칸 = 발송 흐름보다 앞에서 완료(발송 · 차감 코드 없음)', () => {
    const endAt = src.indexOf("if (step.step_type === 'end') {");
    const waitAt = src.indexOf("if (step.step_type === 'wait') {");
    expect(endAt).toBeGreaterThan(-1);
    expect(endAt).toBeLessThan(waitAt);
    const helper = src.slice(src.indexOf('async function completeAtEndStep'), src.indexOf('async function hasPurchasedSinceEntry'));
    // ★ 0930 Codex 1R — 완료 전환은 진행 중일 때만(CASE) · 발송비는 상태와 무관하게(codex-r1 테스트가 소유).
    expect(helper).toContain("THEN 'completed'");
    expect(helper).toContain("prev.status = 'active'");
    expect(helper).not.toMatch(/bulkInsert|deductCredit|prepaidDeduct|insertSmsQueue/);
  });
  it('다음 칸이 끝이면 기다리지 않고 완료한다', () => {
    const adv = src.slice(src.indexOf('async function advanceOrComplete'), src.indexOf('// calculateNextRunAt'));
    expect(adv).toMatch(/String\(nextRes\.rows\[0\]\.step_type\) === 'end'/);
    expect(adv).toContain('completeAtEndStep(');
  });
  it('목표 판정 · 들어온 뒤 구매 조건은 같은 판정 함수를 쓴다 · 새 조건 DB 오류 = 보류', () => {
    const goal = src.slice(src.indexOf('async function isGoalConvertedSinceEntry'), src.indexOf('async function completeAtEndStep'));
    expect(goal).toContain('hasPurchasedSinceEntry(exec.company_id, exec.customer_id, exec.entered_at)');
    const cond = src.slice(src.indexOf('async function evaluateCondition'), src.indexOf('async function evaluateCdpEventExistsCondition'));
    expect(cond).toContain("type === 'purchase_since_entry'");
    expect(cond).toContain("type === 'step_link_clicked'");
    expect((cond.match(/return 'error';/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(cond).toContain("ce.properties->>'step_id' = $2::text");
  });
});
