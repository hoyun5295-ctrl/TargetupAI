/**
 * 여정 V2 0차 — 발송 쪽 결함 선결 (2026-09-29 · 설계서 docs/2026-09-29-journey-v2-master-design.md §9 0차)
 *
 * 못 박는 것(행동 테스트 · 회귀 주입으로 검출력 확인):
 *   ② 모르는 대상 조건은 저장 · 활성화에서 거부 / AI 초안에서는 빼고 "반영 안 됨"으로 알림
 *   ⑧⑩ 칸 수 초과 · 모르는 칸 종류는 자르지 않고 거부
 *   ⑪ 새 여정의 자동 종료 기본값 = 트리거 계약 · 명시값은 그대로
 *   ⑫ 새 포인트 여정의 목표 = 포인트 사용 · 그 밖 = 구매
 *   ④ 구매 스트림 쌍은 겹침/배타 중 하나(카탈로그 parity 는 journey-trigger-catalog-parity.test.ts)
 *   ③ 사건마다 받아야 하는 트리거는 재진입을 계약이 정한다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../company-data-profile', () => ({ getCompanyJourneyFacts: vi.fn() }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn() }));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: vi.fn() }));

import { query } from '../../config/database';
import { getCompanyJourneyFacts } from '../company-data-profile';
import {
  defaultGoalExitFor, goalKindForTrigger, contractReentryPolicy, storageTemplateCodeFor,
  aiSelectableTriggerEvents, formatTriggerMenuForAi, TRIGGER_CONTRACTS, laneForTrigger, triggerLabel,
} from '../journey-trigger-capability';
import { findCustomerConditionIssues, partitionCustomerConditions, applyCustomerConditions } from '../journey-target-extractor';
import { resolveStepType, assertStepCountWithinLimit, clampStepDelayHours, JourneyInputError, MAX_JOURNEY_STEPS } from '../journey-step-limits';
import { createJourneyFromTemplate, activateJourney } from '../journey-builder';
import { describeJourneyTarget, describeCustomerConditions } from '../journey-step-format';

const q = query as unknown as ReturnType<typeof vi.fn>;
const facts = getCompanyJourneyFacts as unknown as ReturnType<typeof vi.fn>;
const COMPANY = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const JOURNEY = '11111111-1111-1111-1111-111111111111';

const MSG = { stepOrder: 1, stepType: 'message' as const, delayHours: 0, channel: 'lms' as const, messageTemplate: '%고객명%님, 오랜만에 인사드립니다. 편하실 때 들러 주세요.', subject: '안부', isAd: true };

/** INSERT INTO journeys 파라미터를 잡는다. 그 밖 SQL 은 빈 결과. */
function captureInsert() {
  const cap: { journeyParams?: any[]; sql?: string } = {};
  q.mockImplementation(async (sql: string, params?: any[]) => {
    if (/INSERT INTO journeys \(/.test(sql)) { cap.journeyParams = params; cap.sql = sql; return { rows: [{ id: JOURNEY }] }; }
    if (/INSERT INTO journey_steps/.test(sql)) return { rows: [{ id: '44444444-4444-4444-4444-444444444444' }] };
    if (/FROM companies c/.test(sql)) return { rows: [{ company_name: '테스트' }] };
    return { rows: [], rowCount: 0 };
  });
  return cap;
}
/** INSERT 컬럼 이름 → 파라미터 값(열 순서가 바뀌어도 테스트가 따라간다). */
function insertValue(cap: { journeyParams?: any[]; sql?: string }, col: string): any {
  const sql = cap.sql || '';
  const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(') VALUES')).split(',').map((c) => c.trim());
  const vals = sql.slice(sql.indexOf('VALUES (') + 8, sql.lastIndexOf(') RETURNING')).split(',').map((v) => v.trim());
  const i = cols.indexOf(col);
  if (i < 0) throw new Error(`INSERT 에 ${col} 컬럼이 없다`);
  const m = vals[i].match(/^\$(\d+)/);
  if (!m) return vals[i];
  return cap.journeyParams![Number(m[1]) - 1];
}

beforeEach(() => { q.mockReset(); facts.mockReset(); });

describe('계약 파생 (⑪ ⑫ ③ · 저장 템플릿)', () => {
  it('자동 종료 기본값 = 종료 신호에 목표 사건이 있으면 켜짐', () => {
    expect(defaultGoalExitFor('customer.created')).toBe(true);        // 가입 → 첫 구매로 끝남(옛: 늘 꺼짐)
    expect(defaultGoalExitFor('purchase.first')).toBe(true);
    expect(defaultGoalExitFor('cdp.purchase')).toBe(true);
    expect(defaultGoalExitFor('customer.dormant')).toBe(true);
    expect(defaultGoalExitFor('customer.points_expiring')).toBe(true);
    expect(defaultGoalExitFor('customer.dormant_return')).toBe(false); // steps_done
    expect(defaultGoalExitFor('customer.birthday_approaching')).toBe(false);
    expect(defaultGoalExitFor('custom')).toBe(false);
    expect(defaultGoalExitFor('없는값')).toBe(false);
  });
  it('목표 종류 = 포인트 여정만 포인트 사용', () => {
    expect(goalKindForTrigger('customer.points_expiring')).toBe('points_used');
    expect(goalKindForTrigger('cdp.purchase')).toBe('purchase');
    expect(goalKindForTrigger('custom')).toBe('purchase');
  });
  it('사건마다 받는 트리거는 재진입 켜짐 + 계약 최소 쿨다운 · 그 밖은 계약이 정하지 않음', () => {
    expect(contractReentryPolicy('cdp.purchase')).toEqual({ allowReentry: true, cooldownDays: 0 });
    expect(contractReentryPolicy('customer.dormant_return')).toEqual({ allowReentry: true, cooldownDays: 0 });
    expect(contractReentryPolicy('customer.created')).toBeNull();
  });
  it('저장 템플릿 코드는 트리거에서 파생', () => {
    expect(storageTemplateCodeFor('purchase.first')).toBe('repeat');
    expect(storageTemplateCodeFor('customer.created')).toBe('onboarding');
    expect(storageTemplateCodeFor('customer.points_expiring')).toBe('points_expiring');
    expect(storageTemplateCodeFor('customer.grade_changed')).toBe('custom');
  });
  it('AI 가 고를 수 있는 시작 사건 = 구현 · 예약 제외 · 프롬프트 표와 같은 집합', () => {
    const sel = aiSelectableTriggerEvents();
    expect(sel).toContain('purchase.first');
    expect(sel).toContain('customer.dormant_return');
    expect(sel).toContain('custom');
    expect(sel).not.toContain('cdp.reservation_created');
    expect(sel).not.toContain('reservation.visit_dn');
    const menu = formatTriggerMenuForAi();
    for (const e of sel) expect(menu).toContain(`- ${e}:`);
    expect(menu).not.toContain('cdp.reservation_created');
  });
  it('모든 계약 트리거에 레인 · 이름이 있다', () => {
    for (const c of TRIGGER_CONTRACTS) {
      expect(laneForTrigger(c.event), c.event).toBeTruthy();
      expect(triggerLabel(c.event), c.event).toBeTruthy();
    }
  });
});

describe('대상 조건 (②)', () => {
  it('허용 목록 밖 필드 · 연산자 · 빈 값 · 묶음 방식을 잡는다', () => {
    expect(findCustomerConditionIssues([{ field: 'grade', op: '==', value: 'VIP' }], 'AND')).toEqual([]);
    expect(findCustomerConditionIssues(undefined)).toEqual([]);
    expect(findCustomerConditionIssues([])).toEqual([]);
    expect(findCustomerConditionIssues([{ field: 'product_code', op: '==', value: 'A1' }])[0].reason).toBe('unknown_field');
    expect(findCustomerConditionIssues([{ field: 'grade', op: 'LIKE', value: 'V%' }])[0].reason).toBe('unknown_op');
    expect(findCustomerConditionIssues([{ field: 'grade', op: '==', value: '' }])[0].reason).toBe('empty_value');
    expect(findCustomerConditionIssues([{ field: 'grade', op: 'in', value: [] }])[0].reason).toBe('empty_value');
    expect(findCustomerConditionIssues([{ field: 'grade', op: 'is_null' }])).toEqual([]);
    expect(findCustomerConditionIssues([], 'XOR')[0].reason).toBe('bad_logic');
    expect(findCustomerConditionIssues('grade=VIP')[0].reason).toBe('bad_shape');
  });
  it('검증기와 추출기는 같은 허용 목록이다 — 검증을 통과한 조건은 추출기에서 빠지지 않는다', () => {
    const ok = [{ field: 'store_name', op: '==', value: '송파가락점' }, { field: 'points', op: '>=', value: 100 }];
    expect(findCustomerConditionIssues(ok)).toEqual([]);
    const params: any[] = [];
    expect(applyCustomerConditions(ok, 'AND', params)).toBe('(c.store_name = $1 AND c.points >= $2)');
  });
  it('AI 초안: 쓸 수 없는 조건은 빼고 문구로 알린다(조용히 버리지 않는다)', () => {
    const r = partitionCustomerConditions({ customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }, { field: 'product_name', op: '==', value: '비누' }], logic: 'AND', recent_hours: 24 });
    expect(r.filters.customer_conditions).toEqual([{ field: 'grade', op: '==', value: 'VIP' }]);
    expect(r.filters.recent_hours).toBe(24);
    expect(r.droppedNotices).toHaveLength(1);
    expect(r.droppedNotices[0]).toContain('반영 안 됨');
  });
  it('계획 모달 "누구에게" 문장 — 조건 · 조건 없음(상시 = 전 고객)', () => {
    expect(describeCustomerConditions([{ field: 'grade', op: '==', value: 'VIP' }, { field: 'region', op: '==', value: '서울' }])).toBe('등급 VIP · 지역 서울');
    expect(describeJourneyTarget('custom', {})).toContain('전 고객');
    expect(describeJourneyTarget('purchase.first', {})).toContain('이 사건이 생긴 고객 전부');
  });
});

describe('칸 종류 · 개수 (⑧ ⑩)', () => {
  it('모르는 칸 종류는 거부 · 없으면 문자 · 아는 값은 그대로', () => {
    expect(resolveStepType(undefined, 't')).toBe('message');
    expect(resolveStepType('wait', 't')).toBe('wait');
    expect(() => resolveStepType('end', 't')).toThrow(JourneyInputError);
    expect(() => resolveStepType('MESSAGE', 't')).toThrow(JourneyInputError);
  });
  it('칸 수 초과는 자르지 않고 거부', () => {
    expect(() => assertStepCountWithinLimit(MAX_JOURNEY_STEPS, 't')).not.toThrow();
    expect(() => assertStepCountWithinLimit(MAX_JOURNEY_STEPS + 1, 't')).toThrow(JourneyInputError);
  });
  it('대기 상한 = 365일(옛 AI 경로 720시간 절단 없음)', () => {
    expect(clampStepDelayHours(1440)).toBe(1440);
    expect(clampStepDelayHours(99999)).toBe(8760);
    expect(clampStepDelayHours('x')).toBe(0);
  });
});

describe('저장 경로 (createJourneyFromTemplate)', () => {
  const base = { companyId: COMPANY, createdBy: USER, templateCode: 'repeat' as const, callbackNumber: '0212345678' };

  it('모르는 칸 종류를 거부한다(옛: 그대로 저장 → 실행기가 문자로 발송)', async () => {
    captureInsert();
    await expect(createJourneyFromTemplate({ ...base, steps: [{ ...MSG, stepType: 'end' as any }] })).rejects.toBeInstanceOf(JourneyInputError);
  });
  it('칸 8개를 거부한다(옛: 생성 경로엔 상한이 없었다)', async () => {
    captureInsert();
    const steps = Array.from({ length: 8 }, (_, i) => ({ ...MSG, stepOrder: i + 1 }));
    await expect(createJourneyFromTemplate({ ...base, steps })).rejects.toBeInstanceOf(JourneyInputError);
  });
  it('모르는 대상 조건을 거부한다(옛: 저장 뒤 추출기가 조용히 건너뛰어 전 고객)', async () => {
    captureInsert();
    await expect(createJourneyFromTemplate({
      ...base, steps: [MSG], triggerEvent: 'purchase.first',
      triggerFilters: { customer_conditions: [{ field: 'product_name', op: '==', value: '비누' }] },
    })).rejects.toBeInstanceOf(JourneyInputError);
  });
  it('보인 트리거 · 조건 = 저장값 (0차 ①)', async () => {
    const cap = captureInsert();
    await createJourneyFromTemplate({
      ...base, steps: [MSG], triggerEvent: 'purchase.first',
      triggerFilters: { customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }], logic: 'AND' },
    });
    expect(insertValue(cap, 'trigger_event')).toBe('purchase.first');
    expect(JSON.parse(insertValue(cap, 'trigger_filters'))).toEqual({ customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }], logic: 'AND' });
  });
  it('타이밍 필터는 옵션 PATCH 와 같은 범위로 정규화한다(AI 가 지은 휴면 0일 등)', async () => {
    const cap = captureInsert();
    await createJourneyFromTemplate({ ...base, templateCode: 'dormant', steps: [MSG], triggerEvent: 'customer.dormant', triggerFilters: { dormant_days: 0 } });
    expect(JSON.parse(insertValue(cap, 'trigger_filters')).dormant_days).toBe(1);
  });
  it('자동 종료: 미지정이면 계약 파생 · 명시값은 그대로 (⑪)', async () => {
    let cap = captureInsert();
    await createJourneyFromTemplate({ ...base, templateCode: 'onboarding', steps: [MSG], triggerEvent: 'customer.created' });
    expect(insertValue(cap, 'goal_exit_enabled')).toBe(true);
    cap = captureInsert();
    await createJourneyFromTemplate({ ...base, templateCode: 'onboarding', steps: [MSG], triggerEvent: 'customer.created', goalExitEnabled: false });
    expect(insertValue(cap, 'goal_exit_enabled')).toBe(false);
    cap = captureInsert();
    await createJourneyFromTemplate({ ...base, templateCode: 'custom', steps: [MSG], triggerEvent: 'custom' });
    expect(insertValue(cap, 'goal_exit_enabled')).toBe(false);
  });
  it('목표 종류: 포인트 여정 = points_used · 그 밖 = purchase (⑫)', async () => {
    let cap = captureInsert();
    await createJourneyFromTemplate({ ...base, templateCode: 'points_expiring', steps: [MSG], triggerEvent: 'customer.points_expiring', triggerFilters: { points_min: 100 } });
    expect(insertValue(cap, 'goal_kind')).toBe('points_used');
    cap = captureInsert();
    await createJourneyFromTemplate({ ...base, steps: [MSG], triggerEvent: 'cdp.purchase' });
    expect(insertValue(cap, 'goal_kind')).toBe('purchase');
  });
});

describe('활성화 게이트 (② 최종 문)', () => {
  it('저장된 대상 조건에 모르는 항목이 있으면 켜지 않는다', async () => {
    facts.mockResolvedValue({
      canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true, hasGrade: true, hasGradeOrder: true,
      hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true,
    });
    q.mockImplementation(async (sql: string) => {
      if (/FROM journeys j/.test(sql) && /json_agg/.test(sql)) {
        return { rows: [{
          callback_number: '0212345678', status: 'draft', start_kind: 'event', anchor_date: null,
          trigger_event: 'cdp.purchase', threshold_recipients_per_step: 100, allow_reentry: true, reentry_cooldown_days: 0,
          trigger_filters: { customer_conditions: [{ field: 'product_name', op: '==', value: '비누' }] },
          steps: [{ order: 1, type: 'message', channel: 'lms', message: '%고객명%님, 오랜만에 인사드립니다. 편하실 때 들러 주세요.', subject: '안부', delay: 0 }],
        }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const r = await activateJourney(COMPANY, JOURNEY, USER);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('새로 만들어야');
  });
});

describe('실행기 fail-closed (⑩)', () => {
  it('모르는 칸 종류 판정은 문자 발송 흐름보다 앞에 있고, 문자가 아니면 보내지 않고 끝낸다', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/utils/journey-executor.ts'), 'utf8');
    const guard = src.indexOf("if (step.step_type !== 'message') {");
    const msgFlow = src.indexOf('// ──────────── message step (기존 흐름) ────────────');
    const cond = src.indexOf("if (step.step_type === 'condition') {");
    expect(guard).toBeGreaterThan(cond);
    expect(msgFlow).toBeGreaterThan(guard);
    const block = src.slice(guard, msgFlow);
    expect(block).toContain("'unknown_step_type'");
    expect(block).toContain("status = 'ended'");
    expect(block).not.toMatch(/bulkInsert|deductCredit|insertSmsQueue/);
  });
});
