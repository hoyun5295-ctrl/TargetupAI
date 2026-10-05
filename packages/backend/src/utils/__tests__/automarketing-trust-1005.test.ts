/**
 * 자동 마케팅 신뢰 설계 (★ 2026-10-05 · docs/2026-10-05-automarketing-trust-design.md)
 *   접수 = 「매일 생일인 날 30% 쿠폰」이 생일 데이터가 없는데 전체 고객 6명 전원으로 잡혔다(매칭 6 / 전체 7).
 *   규칙: 대상은 계약만 · 목표가 요구하는 칸이 없으면 넓히지 않고 멈춘다 · 생일 = 회차 기간 · 매일 · 매주 + 상태 조건 = 반복이라 막는다 ·
 *         승인 1회 = 다음 회차부터 7일.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const suggestMock = vi.fn();
const conditionsAiMock = vi.fn();
const activeFieldsMock = vi.fn();
const availabilityMock = vi.fn();

// 회사 전용 칸 값 있는 고객 수 = 1,240명(그 밖 집계 = 빈 행)
vi.mock('../../config/database', () => ({ query: vi.fn(async (sql: string) => ({ rows: [String(sql).includes('"c0"') ? { c0: 1240 } : {}] })) }));
vi.mock('../../services/ai', () => ({
  detectActiveFields: (...a: any[]) => activeFieldsMock(...a),
  suggestSegmentForObjective: (...a: any[]) => suggestMock(...a),
  translateObjectiveToConditions: (...a: any[]) => conditionsAiMock(...a),
}));
vi.mock('../operator-audience', () => ({
  listSegmentAvailability: (...a: any[]) => availabilityMock(...a),
  countOperatorAudienceFor: vi.fn(async () => ({ count: 0 })),
  resolveOperatorStoreScope: vi.fn(async () => ({ storeFilter: '', baseParams: ['c'], blocked: false })),
}));

import { buildSegmentPredicate, kstMonthDays, checkSchedulePairing, schedulePeriod } from '../automarketing-segment';
import { computeApprovalWindow, buildRenewalNoticeBody, countEmptyRounds, parseScheduleFromText, isWithinApprovalWindow } from '../autosend-policy';
import { translateAudience, conditionsToFilters, describeConditions, validateCondition, AudienceConditionError } from '../audience-translate';

const AXES = [
  { key: 'all', label: '전체 고객', available: true, reason: '', params: [] },
  { key: 'dormant', label: '휴면 고객', available: true, reason: '', params: [] },
  { key: 'birthday', label: '생일 고객', available: false, reason: '고객 생일 정보가 아직 없어요. 생일이 들어오면 열립니다.', params: [] },
  { key: 'went_quiet', label: '발길이 끊긴 고객', available: true, reason: '', params: [] },
];
const ACTIVE = {
  activeColumnFields: [{ fieldKey: 'grade', displayName: '등급', dataType: 'string', columnName: 'grade', storageType: 'column' }],
  customFieldLabels: { custom_3: '잔여멤버쉽' },
  distinctValues: { grade: ['VIP', 'GOLD'], 'custom_fields.custom_3': ['3000', '12500', '800'] },
  fillCounts: { grade: 2910, points: 0 },
};

beforeEach(() => {
  [suggestMock, conditionsAiMock, activeFieldsMock, availabilityMock].forEach((m) => m.mockReset());
  availabilityMock.mockResolvedValue(AXES);
  activeFieldsMock.mockResolvedValue(ACTIVE);
  suggestMock.mockResolvedValue(null);
});

describe('1. 생일 = 회차 기간 · 월일 칸 또는 생년월일 · 2/29', () => {
  const NOW = new Date('2026-10-06T00:00:00.000Z');   // KST 10/6 09:00
  it('매일 = 오늘 월일만 · 두 칸(월일 · 생년월일)을 같이 본다', () => {
    const params: any[] = ['c'];
    const sql = buildSegmentPredicate('birthday', null, params, { now: NOW, period: 'day' });
    expect(params[1]).toEqual(['10-06']);
    expect(sql).toContain("TO_CHAR(c.birth_date, 'MM-DD') = ANY($2::text[])");
    expect(sql).toContain('c.birth_month_day = ANY($2::text[])');
  });
  it('매주 = 발송일부터 7일(달을 넘어도)', () => {
    const params: any[] = ['c'];
    buildSegmentPredicate('birthday', null, params, { now: new Date('2026-10-28T00:00:00.000Z'), period: 'week' });
    expect(params[1]).toEqual(['10-28', '10-29', '10-30', '10-31', '11-01', '11-02', '11-03']);
  });
  it('매월 · 기간 없음 = 이번 달(옛 동작) + 월일 칸', () => {
    const params: any[] = ['c'];
    const sql = buildSegmentPredicate('birthday', null, params, { now: NOW });
    expect(params[1]).toBe(10);
    expect(sql).toContain("LEFT(c.birth_month_day, 3) = LPAD($2::text, 2, '0') || '-'");
    expect(sql).not.toContain('birth_month_day, 2)::int');
  });
  it('2/29생 = 평년엔 2/28에 · 윤년엔 그날', () => {
    expect(kstMonthDays(new Date('2027-02-28T00:00:00.000Z'), 1)).toEqual(['02-28', '02-29']);
    expect(kstMonthDays(new Date('2028-02-28T00:00:00.000Z'), 1)).toEqual(['02-28']);
    expect(kstMonthDays(new Date('2028-02-28T00:00:00.000Z'), 2)).toEqual(['02-28', '02-29']);
  });
  it('주기 → 기간', () => {
    expect(schedulePeriod('daily')).toBe('day');
    expect(schedulePeriod('weekly')).toBe('week');
    expect(schedulePeriod('monthly')).toBe('month');
    expect(schedulePeriod('yearly')).toBe('month');
  });
});

describe('2. 주기 · 대상 짝 (Q9)', () => {
  it('매일 · 매주 + 상태 축 = 막는다 · 짝이 있는 축은 변화 축을 권한다', () => {
    const r = checkSchedulePairing('weekly', { segmentKey: 'dormant' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.suggestKey).toBe('went_quiet'); expect(r.reason).toContain('발길이 끊긴 고객'); }
    expect(checkSchedulePairing('daily', { segmentKey: 'all' }).ok).toBe(false);
    expect(checkSchedulePairing('daily', { hasConditions: true }).ok).toBe(false);
  });
  it('생일(회차 기간) · 변화 축 · 매월은 통과', () => {
    expect(checkSchedulePairing('daily', { segmentKey: 'birthday' }).ok).toBe(true);
    expect(checkSchedulePairing('daily', { segmentKey: 'went_quiet' }).ok).toBe(true);
    expect(checkSchedulePairing('monthly', { segmentKey: 'dormant' }).ok).toBe(true);
    expect(checkSchedulePairing('monthly', { hasConditions: true }).ok).toBe(true);
  });
});

describe('3. 대상 번역 — 넓히지 않는다', () => {
  it('목표가 잠긴 축(생일 · 데이터 없음)을 가리키면 그 사유로 막는다 · 칸 번역 AI 를 부르지 않는다', async () => {
    suggestMock.mockResolvedValueOnce({ key: 'birthday', params: {} });
    const tr = await translateAudience({ companyId: 'c', userId: 'u', objective: '매일 생일인 고객에게 쿠폰', schedule: 'daily' });
    expect(tr).toMatchObject({ kind: 'blocked', code: 'DATA_MISSING' });
    if (tr.kind === 'blocked') expect(tr.reason).toContain('고객 생일 정보가 아직 없어요');
    expect(suggestMock.mock.calls[0][3]).toBe(AXES);   // 잠긴 축도 매핑 후보로 넘긴다(옛: 열린 축만)
    expect(conditionsAiMock).not.toHaveBeenCalled();
  });

  it('칸으로 못 옮긴 말 = 빼지 않고 고르기 필요 · 목록 밖 칸을 고른 AI 도 고르기로', async () => {
    conditionsAiMock.mockResolvedValueOnce({
      conditions: [{ term: '등급', field: 'grade', operator: 'eq', value: 'VIP' }, { term: '나이', field: 'age', operator: 'between', value: [30, 39] }],
      unexpressed: [{ term: '포인트', operator: 'gte', value: 1 }],
      everyone: false,
    });
    const tr = await translateAudience({ companyId: 'c', userId: 'u', objective: '포인트 있는 30대 VIP 매월', schedule: 'monthly' });
    expect(tr.kind).toBe('needs_choice');
    if (tr.kind === 'needs_choice') {
      expect(tr.conditions.map((c) => c.field)).toEqual(['grade']);
      expect(tr.unresolved.map((u) => u.term)).toEqual(['포인트', '나이']);
      expect(tr.options.some((o) => o.field === 'custom_fields.custom_3' && o.label === '잔여멤버쉽')).toBe(true);
    }
  });

  it('조건이 없는 목표 = 「전체 고객」을 고르게 막는다(빈 조건 = 전체 금지)', async () => {
    conditionsAiMock.mockResolvedValueOnce({ conditions: [], unexpressed: [], everyone: true });
    const tr = await translateAudience({ companyId: 'c', userId: 'u', objective: '신상품 소식 보내줘 매월', schedule: 'monthly' });
    expect(tr).toMatchObject({ kind: 'blocked', code: 'NO_CONDITION' });
  });

  it('번역 AI 실패 = 막힘(자유 해석으로 떨어지지 않는다)', async () => {
    conditionsAiMock.mockResolvedValueOnce(null);
    const tr = await translateAudience({ companyId: 'c', userId: 'u', objective: '좋은 고객에게 매월 감사 인사', schedule: 'monthly' });
    expect(tr).toMatchObject({ kind: 'blocked', code: 'TRANSLATE_FAILED' });
  });

  it('매일 · 매주 + 칸 조건 = 짝 불가로 막는다(AI 칸 번역 전에)', async () => {
    const tr = await translateAudience({ companyId: 'c', userId: 'u', objective: 'VIP 고객에게 매일', schedule: 'daily', conditions: [{ field: 'grade', operator: 'eq', value: 'VIP' }] });
    expect(tr).toMatchObject({ kind: 'blocked', code: 'PAIRING' });
  });

  it('사람이 고른 칸 = 값 있는 칸만 · 아니면 400', async () => {
    const ok = await translateAudience({ companyId: 'c', userId: 'u', objective: '포인트 독려 매월', schedule: 'monthly', conditions: [{ term: '포인트', field: 'custom_fields.custom_3', operator: 'gte', value: '1,000' }] });
    expect(ok).toMatchObject({ kind: 'filters', conditions: [{ field: 'custom_fields.custom_3', label: '잔여멤버쉽', operator: 'gte', value: 1000, source: 'user', fillCount: 1240 }] });
    await expect(translateAudience({ companyId: 'c', userId: 'u', objective: '포인트 독려 매월', schedule: 'monthly', conditions: [{ field: 'points', operator: 'gte', value: 1 }] }))
      .rejects.toBeInstanceOf(AudienceConditionError);
  });

  it('AI 조건이 앞 조건과 겹치면 = 빼지 않고 고르기 필요(덮어써서 넓어지지 않는다 · Codex 1R)', async () => {
    conditionsAiMock.mockResolvedValueOnce({
      conditions: [{ term: 'VIP', field: 'grade', operator: 'eq', value: 'VIP' }, { term: '골드', field: 'grade', operator: 'eq', value: 'GOLD' }],
      unexpressed: [], everyone: false,
    });
    const tr = await translateAudience({ companyId: 'c', userId: 'u', objective: 'VIP 와 골드 고객에게 매월', schedule: 'monthly' });
    expect(tr).toMatchObject({ kind: 'needs_choice', conditions: [{ field: 'grade', value: 'VIP' }], unresolved: [{ term: '골드' }] });
  });

  it('창의 말(term)은 빠지지 않는다 — 못 정한 말이 남으면 계속 고르기 · 정한 말이 빠지면 400 · 9개 이상 = 400(Codex 2R)', async () => {
    const opt = { field: 'custom_fields.custom_3', label: '잔여멤버쉽', kind: 'custom', dataType: 'number', fillCount: 1240, samples: [] };
    const A = { term: '등급', field: 'grade', label: '등급', operator: 'eq', value: 'VIP', source: 'ai' as const };
    const carry = { kind: 'needs_choice' as const, conditions: [A], unresolved: [{ term: '포인트' }, { term: '생일' }], options: [opt as any] };
    const B = { term: '포인트', field: 'custom_fields.custom_3', operator: 'gte', value: 1000 };
    const partial = await translateAudience({ companyId: 'c', userId: 'u', objective: '포인트 있는 VIP 생일 매월', schedule: 'monthly', conditions: [A, B], carry });
    expect(partial).toMatchObject({ kind: 'needs_choice', unresolved: [{ term: '생일' }] });
    if (partial.kind === 'needs_choice') expect(partial.conditions.map((c) => c.term)).toEqual(['등급', '포인트']);
    const filled = { kind: 'filters' as const, conditions: [A, { ...B, label: '잔여멤버쉽', source: 'user' as const }] };
    await expect(translateAudience({ companyId: 'c', userId: 'u', objective: '포인트 있는 VIP 매월', schedule: 'monthly', conditions: [B], carry: filled }))
      .rejects.toThrow('「등급」 조건이 빠졌어요');
    const nine = Array.from({ length: 9 }, () => B);
    await expect(translateAudience({ companyId: 'c', userId: 'u', objective: '포인트 매월', schedule: 'monthly', conditions: nine })).rejects.toThrow('8개까지');
  });

  it('같은 말의 조건 둘(하한 · 상한)은 말을 나눠 각각 고른다 — 하나 고를 때 다른 하나가 빠지지 않는다(Codex 3R)', async () => {
    conditionsAiMock.mockResolvedValueOnce({
      conditions: [{ term: '금액', field: 'spend', operator: 'gte', value: 100000 }, { term: '금액', field: 'spend', operator: 'lte', value: 500000 }],
      unexpressed: [{}, {}].map(() => ({ term: '' })), everyone: false,
    });
    const tr = await translateAudience({ companyId: 'c', userId: 'u', objective: '10만~50만원 쓴 고객 매월', schedule: 'monthly' });
    expect(tr.kind).toBe('needs_choice');
    if (tr.kind !== 'needs_choice') return;
    expect(tr.unresolved.map((u) => u.term)).toEqual(['대상 조건', '대상 조건 (2)', '금액', '금액 (2)']);
    const pick = { term: '금액', field: 'custom_fields.custom_3', operator: 'gte', value: 100000 };
    const after = await translateAudience({ companyId: 'c', userId: 'u', objective: 'x 매월', schedule: 'monthly', conditions: [pick], carry: tr });
    expect(after.kind).toBe('needs_choice');
    if (after.kind === 'needs_choice') expect(after.unresolved.map((u) => u.term)).toContain('금액 (2)');
  });

  it('사람이 고른 칸이 겹치면 = 400(저장 전에)', async () => {
    await expect(translateAudience({
      companyId: 'c', userId: 'u', objective: '등급 고객 매월', schedule: 'monthly',
      conditions: [{ field: 'grade', operator: 'eq', value: 'VIP' }, { field: 'grade', operator: 'eq', value: 'GOLD' }],
    })).rejects.toBeInstanceOf(AudienceConditionError);
  });

  it('옛 축 힌트 = 같은 이름의 축(AI 0)', async () => {
    const tr = await translateAudience({ companyId: 'c', userId: 'u', objective: '휴면 고객 다시 부르기', schedule: 'monthly', targetHint: 'dormant' });
    expect(tr).toMatchObject({ kind: 'axis', segmentKey: 'dormant', mapped: false });
    expect(suggestMock).not.toHaveBeenCalled();
  });
});

describe('4. 칸 조건 모양', () => {
  const opts = [{ field: 'custom_fields.custom_3', label: '잔여멤버쉽', kind: 'custom' as const, dataType: 'number' as const, fillCount: 5, samples: [] }];
  it('검증 = 칸 · 연산자 · 값', () => {
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'gte', value: '1,000' }, opts, 'ai')).toMatchObject({ value: 1000 });
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'drop', value: 1 }, opts, 'ai')).toBeNull();
    expect(validateCondition({ field: 'custom_fields.custom_9', operator: 'gte', value: 1 }, opts, 'ai')).toBeNull();
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'between', value: [1, 'x'] }, opts, 'ai')).toBeNull();
    // 값이 비면 조건이 아니다 — 0 으로 바뀌어 「0 이상 = 전원」이 되지 않게(Codex 2R)
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'gte', value: undefined }, opts, 'ai')).toBeNull();
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'gte', value: ' ' }, opts, 'ai')).toBeNull();
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'between', value: ['', 5] }, opts, 'ai')).toBeNull();
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'in', value: ['', 'A'] }, opts, 'ai')).toBeNull();
    // 쉼표만 · 숫자 아닌 글자 = 조건 아님(Codex 3R) · 「1,000」 은 1000
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'gte', value: ' , ' }, opts, 'user')).toBeNull();
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'between', value: [',', 100] }, opts, 'user')).toBeNull();
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'gte', value: '1e3' }, opts, 'user')).toBeNull();
    expect(validateCondition({ field: 'custom_fields.custom_3', operator: 'gte', value: '1,000' }, opts, 'user')).toMatchObject({ value: 1000 });
  });
  it('같은 칸 이상 + 이하 = 사이 · 사람 말 한 줄', () => {
    expect(conditionsToFilters([
      { field: 'custom_fields.custom_3', operator: 'gte', value: 1000 },
      { field: 'custom_fields.custom_3', operator: 'lte', value: 5000 },
    ])).toEqual({ 'custom_fields.custom_3': { operator: 'between', value: [1000, 5000] } });
    expect(describeConditions([{ label: '잔여멤버쉽', operator: 'gte', value: 1000 }, { label: '등급', operator: 'eq', value: 'VIP' }]))
      .toBe('잔여멤버쉽 1,000 이상 · 등급 VIP');
  });
  it('조건이 사라지는 입력 = 거절(Codex 1R) — 같은 칸 겹침 · SQL 로 안 나오는 칸(매장 코드는 컴파일러가 건너뛴다)', () => {
    expect(() => conditionsToFilters([
      { field: 'address', operator: 'contains', value: '서울' }, { field: 'address', operator: 'contains', value: '중구' },
    ])).toThrow(AudienceConditionError);
    expect(() => conditionsToFilters([
      { field: 'custom_fields.custom_3', operator: 'gte', value: 1 }, { field: 'custom_fields.custom_3', operator: 'lte', value: 9 }, { field: 'custom_fields.custom_3', operator: 'gte', value: 5 },
    ])).toThrow(AudienceConditionError);
    expect(() => conditionsToFilters([
      { field: 'store_code', operator: 'eq', value: 'A', label: '매장' }, { field: 'grade', operator: 'eq', value: 'VIP' },
    ])).toThrow('「매장」');
    expect(conditionsToFilters([{ field: 'grade', operator: 'eq', value: 'VIP' }])).toEqual({ grade: { operator: 'eq', value: 'VIP' } });
  });
});

describe('6. 한 줄에서 주기 읽기(AI 0)', () => {
  it('Harold 접수 문장 = 「매달」이 있어도 생일인 날 = 매일', () => {
    expect(parseScheduleFromText('매달 생일자에게 생일인날 생일축하 문자를 보내주고싶어 혜택은 생일고객 30% 할인쿠폰이고')?.schedule).toBe('daily');
    expect(parseScheduleFromText('매일 생일인 고객에게 생일 축하 30% 쿠폰 보내줘')?.schedule).toBe('daily');
  });
  it('매월 초 · 매월 15일 · 매주 월요일 · 매달 · 시각', () => {
    expect(parseScheduleFromText('포인트 독려 문자를 매월 초에 보내줘')).toEqual({ schedule: 'monthly', scheduleDayOfWeek: null, scheduleDayOfMonth: 1, scheduleTime: null });
    expect(parseScheduleFromText('매월 15일 오후 2시 반에 VIP 감사 문자')).toEqual({ schedule: 'monthly', scheduleDayOfWeek: null, scheduleDayOfMonth: 15, scheduleTime: '14:30' });
    expect(parseScheduleFromText('발길 끊긴 고객 매주 월요일 오전 10시')).toEqual({ schedule: 'weekly', scheduleDayOfWeek: 1, scheduleDayOfMonth: null, scheduleTime: '10:00' });
    expect(parseScheduleFromText('매달 신상 소식')?.schedule).toBe('monthly');
  });
  it('주기 말 없음 = null · 「3시간 특가」는 시각이 아니다', () => {
    expect(parseScheduleFromText('90일 넘게 안 산 고객 다시 불러와줘')).toBeNull();
    expect(parseScheduleFromText('매월 초 3시간 특가 안내')?.scheduleTime).toBeNull();
  });
});

describe('5. 승인 기간 · 요약', () => {
  it('매일 = 다음 회차부터 7회 · 끝 = 시작일 + 6일 밤 12시(KST)', () => {
    const w = computeApprovalWindow({ schedule: 'daily', scheduleTime: '09:00', scheduleDayOfWeek: null, scheduleDayOfMonth: null, scheduleMonth: null }, new Date('2026-10-05T03:00:00.000Z'));
    expect(w.startAt.toISOString()).toBe('2026-10-06T00:00:00.000Z');   // 10/5 12시 KST = 오늘 9시 지남 → 내일
    expect(w.until.toISOString()).toBe('2026-10-12T14:59:59.999Z');
    expect(w.rounds).toHaveLength(7);
  });
  it('매월 = 다음 회차 1회분', () => {
    const w = computeApprovalWindow({ schedule: 'monthly', scheduleTime: '10:00', scheduleDayOfWeek: null, scheduleDayOfMonth: 1, scheduleMonth: null }, new Date('2026-10-05T03:00:00.000Z'));
    expect(w.rounds).toHaveLength(1);
    expect(w.startAt.toISOString()).toBe('2026-11-01T01:00:00.000Z');
  });
  it('승인 기간 = 첫 승인 회차의 날(KST 0시)부터 끝까지 · 시작을 모르면 아니다(Codex 1R)', () => {
    const until = new Date('2026-11-07T14:59:59.999Z');
    const start = '2026-11-01T00:00:00.000Z';   // KST 11/1 09:00(매월 1일 운영자를 10/5 에 승인)
    expect(isWithinApprovalWindow(until, start, new Date('2026-10-05T05:00:00.000Z'))).toBe(false);   // 승인 전 회차(최적 시각 = 오늘)
    expect(isWithinApprovalWindow(until, start, new Date('2026-10-31T14:59:00.000Z'))).toBe(false);   // KST 10/31 23:59
    expect(isWithinApprovalWindow(until, start, new Date('2026-10-31T15:30:00.000Z'))).toBe(true);    // KST 11/1 00:30(첫날)
    expect(isWithinApprovalWindow(until, start, until)).toBe(true);
    expect(isWithinApprovalWindow(until, start, new Date('2026-11-07T15:00:00.000Z'))).toBe(false);
    expect(isWithinApprovalWindow(until, null, new Date('2026-11-02T00:00:00.000Z'))).toBe(false);
    expect(isWithinApprovalWindow(null, start, new Date('2026-11-02T00:00:00.000Z'))).toBe(false);
  });
  it('요약 문자 = 보낸 날 · 사람 · 대상 없는 날 · 멈춘 회차 · 다음 승인 안내(줄표 없음)', () => {
    const body = buildRenewalNoticeBody({ name: '생일 축하', untilLabel: '10월 12일', sentRounds: 5, people: 12, emptyDays: 2, held: 0 });
    expect(body).toBe("'생일 축하' 승인 기간이 10월 12일에 끝나요. 지난 회차: 보낸 날 5일 · 12명 · 대상 없는 날 2일. 이어서 보내려면 한줄로 자동 마케팅 실행 중 목록에서 [다음 승인]을 눌러 주세요.");
    expect(body).not.toContain('—');
    expect(countEmptyRounds([
      { at: '2026-10-06T00:00:00.000Z', outcome: 'empty' }, { at: '2026-10-01T00:00:00.000Z', outcome: 'empty' }, { at: '2026-10-07T00:00:00.000Z', outcome: 'scheduled' },
    ], new Date('2026-10-05T00:00:00.000Z'))).toBe(1);
  });
});
