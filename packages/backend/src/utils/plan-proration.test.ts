import { describe, it, expect } from 'vitest';
import {
  buildPlanSegments, sumPlanSegments, prorateMonthlyAmount, daysInMonth,
  planChangeCreditDelta,
  shiftDayKey, daySpan, findPlanCoverageGap, evaluatePlanHistoryGate, planChangesFingerprint,
} from './plan-proration';

const ch = (effective_date: string, to_plan_code: string, to_monthly_price: number) =>
  ({ effective_date, to_plan_code, to_monthly_price });

describe('daysInMonth — 일할 분모 (2026-07-26)', () => {
  it('달마다 실제 일수', () => {
    expect(daysInMonth(2026, 7)).toBe(31);
    expect(daysInMonth(2026, 6)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29); // 윤년
  });
});

describe('prorateMonthlyAmount — 월정액 × 일수 ÷ 그 달 일수', () => {
  it('한 달 전체면 월정액 그대로', () => {
    expect(prorateMonthlyAmount(1000000, 31, 31)).toBe(1000000);
  });

  it('일할 계산 후 원 단위 반올림', () => {
    expect(prorateMonthlyAmount(1000000, 22, 31)).toBe(709677);
  });

  it('30일 고정이 아니라 그 달 일수로 나눈다 — 2월 과청구 차단', () => {
    expect(prorateMonthlyAmount(280000, 28, 28)).toBe(280000);
    expect(prorateMonthlyAmount(280000, 28, 30)).toBe(261333); // 30일 고정이면 이렇게 적게 나온다
  });

  it('0원 플랜(FREE·TRIAL)은 0', () => {
    expect(prorateMonthlyAmount(0, 15, 31)).toBe(0);
  });

  it('분모가 0이면 0 — NaN을 청구하지 않는다', () => {
    expect(prorateMonthlyAmount(1000000, 10, 0)).toBe(0);
  });
});

describe('buildPlanSegments — 청구 기간을 요금제 구간으로 (2026-07-26)', () => {
  it('변경이 없으면 한 구간, 월정액 전액', () => {
    const segs = buildPlanSegments([ch('2026-02-12', 'BASIC', 350000)], '2026-07-01', '2026-07-31');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ planCode: 'BASIC', from: '2026-07-01', to: '2026-07-31', days: 31, monthDays: 31 });
    expect(segs[0].amount).toBe(350000);
  });

  it('월 중간 변경 — 변경일 당일은 새 요금제', () => {
    const segs = buildPlanSegments(
      [ch('2026-02-12', 'BASIC', 350000), ch('2026-07-10', 'PRO', 1000000)],
      '2026-07-01', '2026-07-31',
    );
    expect(segs).toHaveLength(2);
    // 7/1~7/9 = 9일 BASIC, 7/10~7/31 = 22일 PRO (당일이 새 요금제)
    expect(segs[0]).toMatchObject({ planCode: 'BASIC', from: '2026-07-01', to: '2026-07-09', days: 9 });
    expect(segs[1]).toMatchObject({ planCode: 'PRO', from: '2026-07-10', to: '2026-07-31', days: 22 });
    expect(segs[0].amount).toBe(prorateMonthlyAmount(350000, 9, 31));
    expect(segs[1].amount).toBe(prorateMonthlyAmount(1000000, 22, 31));
  });

  it('같은 날 두 번 바뀌면 그 날은 마지막 요금제', () => {
    const segs = buildPlanSegments(
      [ch('2026-06-01', 'BASIC', 350000), ch('2026-07-10', 'PRO', 1000000), ch('2026-07-10', 'BUSINESS', 3000000)],
      '2026-07-01', '2026-07-31',
    );
    expect(segs.map((s) => s.planCode)).toEqual(['BASIC', 'BUSINESS']);
    expect(segs[1].from).toBe('2026-07-10');
  });

  it('월이 바뀌면 구간을 끊는다 — 분모가 달마다 다르다', () => {
    const segs = buildPlanSegments([ch('2026-01-01', 'BASIC', 350000)], '2026-06-01', '2026-07-31');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ from: '2026-06-01', to: '2026-06-30', days: 30, monthDays: 30 });
    expect(segs[1]).toMatchObject({ from: '2026-07-01', to: '2026-07-31', days: 31, monthDays: 31 });
    expect(sumPlanSegments(segs)).toBe(700000);
  });

  it('기간 이전 이력이 시작 시점 플랜을 정한다 — 안 넘기면 그 달이 통째로 빈다', () => {
    const segs = buildPlanSegments([ch('2026-04-22', 'ENTERPRISE', 5500000)], '2026-07-01', '2026-07-31');
    expect(segs).toHaveLength(1);
    expect(segs[0].planCode).toBe('ENTERPRISE');
  });

  it('이력이 아예 없으면 청구하지 않는다 — 추측해서 금액을 만들지 않는다', () => {
    expect(buildPlanSegments([], '2026-07-01', '2026-07-31')).toEqual([]);
  });

  it('이력 시작 전 날짜는 구간에 안 들어간다', () => {
    const segs = buildPlanSegments([ch('2026-07-15', 'PRO', 1000000)], '2026-07-01', '2026-07-31');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ from: '2026-07-15', to: '2026-07-31', days: 17 });
  });

  it('내려가는 변경도 같은 식으로 처리된다', () => {
    const segs = buildPlanSegments(
      [ch('2026-06-01', 'PRO', 1000000), ch('2026-07-10', 'BASIC', 350000)],
      '2026-07-01', '2026-07-31',
    );
    expect(segs.map((s) => s.planCode)).toEqual(['PRO', 'BASIC']);
    expect(segs[0].days).toBe(9);
    expect(segs[1].days).toBe(22);
  });

  it('0원 플랜(FREE)이면 금액 0 구간이 나온다 — 항목은 남기고 금액만 0', () => {
    const segs = buildPlanSegments([ch('2026-04-22', 'FREE', 0)], '2026-07-01', '2026-07-31');
    expect(segs[0].amount).toBe(0);
    expect(segs[0].planCode).toBe('FREE');
  });

  it('기간이 뒤집혀 있거나 깨진 값이면 빈 배열', () => {
    expect(buildPlanSegments([ch('2026-01-01', 'BASIC', 350000)], '2026-07-31', '2026-07-01')).toEqual([]);
    expect(buildPlanSegments([ch('2026-01-01', 'BASIC', 350000)], 'bad', '2026-07-31')).toEqual([]);
  });

  it('하루짜리 기간도 성립한다', () => {
    const segs = buildPlanSegments([ch('2026-01-01', 'BASIC', 350000)], '2026-07-15', '2026-07-15');
    expect(segs).toHaveLength(1);
    expect(segs[0].days).toBe(1);
    expect(segs[0].amount).toBe(prorateMonthlyAmount(350000, 1, 31));
  });
});

describe('planChangeCreditDelta — 요금제 바뀐 날 남은 기간 크레딧 (★1026 Harold)', () => {
  const base = { today: '2026-10-26', fromTrial: false, base: 0, carriesNegative: false };

  it('★ 제시뉴욕 실측 — 10/26 미가입(0) → 스타터(300) = 300 × 6/31 = 58', () => {
    const d = planChangeCreditDelta({ ...base, effectiveDate: '2026-10-26', fromCredits: 0, toCredits: 300 })!;
    expect(d.remainingDays).toBe(6);
    expect(d.monthDays).toBe(31);
    expect(d.delta).toBe(58);
    expect(d.newBase).toBe(58);
  });

  it('달 첫날이면 한 달치 그대로 — 11/1 미가입 → 스타터 = 300', () => {
    const d = planChangeCreditDelta({ ...base, today: '2026-11-01', effectiveDate: '2026-11-01', fromCredits: 0, toCredits: 300 })!;
    expect(d.delta).toBe(300);
  });

  it('업그레이드는 차액의 남은 기간 몫만 — 스타터(300) → 프로(2400) 10/26 = 2100 × 6/31 = 406', () => {
    const d = planChangeCreditDelta({ ...base, base: 120, effectiveDate: '2026-10-26', fromCredits: 300, toCredits: 2400 })!;
    expect(d.delta).toBe(406);
    expect(d.newBase).toBe(526);
  });

  it('내리면 같은 식으로 회수 — 프로 → 스타터 10/26 = −406 · 이미 다 썼으면 기본 칸이 음수로 남는다', () => {
    const d = planChangeCreditDelta({ ...base, base: 100, effectiveDate: '2026-10-26', fromCredits: 2400, toCredits: 300 })!;
    expect(d.delta).toBe(-406);
    expect(d.newBase).toBe(-306);
  });

  it('분모는 그 달 실제 일수 — 2027-02-15 = 300 × 14/28 = 150', () => {
    const d = planChangeCreditDelta({ ...base, today: '2027-02-15', effectiveDate: '2027-02-15', fromCredits: 0, toCredits: 300 })!;
    expect(d.monthDays).toBe(28);
    expect(d.remainingDays).toBe(14);
    expect(d.delta).toBe(150);
  });

  it('말일 하루 = 300 × 1/31 = 10', () => {
    const d = planChangeCreditDelta({ ...base, today: '2026-10-31', effectiveDate: '2026-10-31', fromCredits: 0, toCredits: 300 })!;
    expect(d.delta).toBe(10);
  });

  it('★ 체험 중 유료 전환 = 체험 남은 크레딧은 없애고 새 요금제 일할로 바꾼다(1026 Harold 승인)', () => {
    const d = planChangeCreditDelta({ ...base, fromTrial: true, base: 412, effectiveDate: '2026-10-26', fromCredits: 750, toCredits: 300 })!;
    expect(d.newBase).toBe(58);
    expect(d.delta).toBe(-354);
  });

  it('체험에서 바꿀 때 선불의 음수 상계분은 남긴다(월 리셋과 같은 규칙) · 후불은 안 남긴다', () => {
    const pre = planChangeCreditDelta({ ...base, fromTrial: true, base: -20, carriesNegative: true, effectiveDate: '2026-10-26', fromCredits: 750, toCredits: 300 })!;
    expect(pre.newBase).toBe(38);
    const post = planChangeCreditDelta({ ...base, fromTrial: true, base: -20, carriesNegative: false, effectiveDate: '2026-10-26', fromCredits: 750, toCredits: 300 })!;
    expect(post.newBase).toBe(58);
  });

  it('크레딧이 같은 요금제끼리면 조정 0', () => {
    const d = planChangeCreditDelta({ ...base, base: 33, effectiveDate: '2026-10-26', fromCredits: 300, toCredits: 300 })!;
    expect(d.delta).toBe(0);
    expect(d.newBase).toBe(33);
  });

  it('★ 변경일이 지난달이면 이번 달 1일부터 센다 — 잠금을 기다리다 달이 넘어간 변경(10/31 요청 → 11/1 처리 · Codex 1R)', () => {
    const d = planChangeCreditDelta({ ...base, today: '2026-11-01', effectiveDate: '2026-10-31', fromCredits: 0, toCredits: 300 })!;
    expect(d.remainingDays).toBe(30);
    expect(d.monthDays).toBe(30);
    expect(d.delta).toBe(300);
  });

  it('지난달 내림도 이번 달 전체를 회수 — 유료 한 달치가 남지 않는다', () => {
    const d = planChangeCreditDelta({ ...base, base: 300, today: '2026-11-01', effectiveDate: '2026-10-31', fromCredits: 300, toCredits: 0 })!;
    expect(d.delta).toBe(-300);
    expect(d.newBase).toBe(0);
  });

  it('변경일이 다음 달 이후면 null — 아직 오지 않은 달의 몫을 지금 주지 않는다', () => {
    expect(planChangeCreditDelta({ ...base, today: '2026-10-26', effectiveDate: '2026-11-01', fromCredits: 0, toCredits: 300 })).toBeNull();
  });

  it('못 읽는 날짜면 null — 추측해서 날짜를 만들지 않는다', () => {
    expect(planChangeCreditDelta({ ...base, effectiveDate: 'x', fromCredits: 0, toCredits: 300 })).toBeNull();
  });
});

// ============================================================
//  이력 공백 검사 (★ 2026-07-26 Codex 3차 HIGH)
// ============================================================

describe('shiftDayKey · daySpan — 날짜 산술 (2026-07-26)', () => {
  it('월 경계를 넘는다', () => {
    expect(shiftDayKey('2026-07-01', -1)).toBe('2026-06-30');
    expect(shiftDayKey('2026-07-31', 1)).toBe('2026-08-01');
    expect(shiftDayKey('2026-07-09', 0)).toBe('2026-07-09');
  });

  it('윤년 2월도 맞는다', () => {
    expect(shiftDayKey('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('못 읽는 값은 그대로 돌려준다 — 추측해서 날짜를 만들지 않는다', () => {
    expect(shiftDayKey('' as any, 1)).toBe('');
  });

  it('양끝 포함 일수', () => {
    expect(daySpan('2026-07-01', '2026-07-31')).toBe(31);
    expect(daySpan('2026-07-15', '2026-07-15')).toBe(1);
  });
});


describe('findPlanCoverageGap — 이력이 못 덮은 구간과 그 종류 (2026-07-26)', () => {
  const seg = (from: string, to: string) =>
    ({ planCode: 'BASIC', monthlyPrice: 350000, from, to, days: daySpan(from, to), monthDays: 31, amount: 1 });

  it('기간 전체를 덮으면 공백 없음', () => {
    expect(findPlanCoverageGap([seg('2026-07-01', '2026-07-31')], '2026-07-01', '2026-07-31')).toBeNull();
  });

  it('최초 이력이 기간 중간이면 앞 구간이 head 공백 — 요금제가 없던 기간이라는 사실이다', () => {
    const gap = findPlanCoverageGap([seg('2026-07-15', '2026-07-31')], '2026-07-01', '2026-07-31');
    expect(gap).toEqual({ from: '2026-07-01', to: '2026-07-14', days: 14, kind: 'head' });
  });

  it('이력이 아예 없으면 기간 전체가 head 공백', () => {
    expect(findPlanCoverageGap([], '2026-07-01', '2026-07-31'))
      .toEqual({ from: '2026-07-01', to: '2026-07-31', days: 31, kind: 'head' });
  });

  it('회사가 기간 중간에 생겼으면 그 날부터만 요구한다 — 기준선 effective_date = created_at::date', () => {
    expect(findPlanCoverageGap([seg('2026-07-15', '2026-07-31')], '2026-07-01', '2026-07-31', '2026-07-15')).toBeNull();
  });

  it('기간이 끝난 뒤 생긴 회사는 검사 대상이 아니다', () => {
    expect(findPlanCoverageGap([], '2026-07-01', '2026-07-31', '2026-08-02')).toBeNull();
  });

  it('중간이 끊기면 internal — 이력 손상 신호다', () => {
    const gap = findPlanCoverageGap(
      [seg('2026-07-01', '2026-07-10'), seg('2026-07-20', '2026-07-31')],
      '2026-07-01', '2026-07-31',
    );
    expect(gap).toEqual({ from: '2026-07-11', to: '2026-07-19', days: 9, kind: 'internal' });
  });

  it('기간 이전 이력만 있고 기간 안이 비면 trailing — 이력이 이미 시작된 뒤 끊긴 것이다', () => {
    const gap = findPlanCoverageGap([seg('2026-05-01', '2026-05-31')], '2026-07-01', '2026-07-31');
    expect(gap).toEqual({ from: '2026-07-01', to: '2026-07-31', days: 31, kind: 'trailing' });
  });

  it('뒤가 끊기면 trailing', () => {
    const gap = findPlanCoverageGap([seg('2026-07-01', '2026-07-20')], '2026-07-01', '2026-07-31');
    expect(gap).toEqual({ from: '2026-07-21', to: '2026-07-31', days: 11, kind: 'trailing' });
  });
});

describe('evaluatePlanHistoryGate — 발행 차단 판정 (2026-07-26 Codex 6차 반영)', () => {
  const paid = (from: string, to: string) =>
    ({ planCode: 'BASIC', monthlyPrice: 350000, from, to, days: daySpan(from, to), monthDays: 31, amount: 101613 });
  const free = (from: string, to: string) =>
    ({ planCode: 'FREE', monthlyPrice: 0, from, to, days: daySpan(from, to), monthDays: 31, amount: 0 });
  const gate = (segments: any[], extra: Record<string, any> = {}) => evaluatePlanHistoryGate({
    segments, billingStart: '2026-07-01', billingEnd: '2026-07-31', monthlyPrice: 350000, ...extra,
  });

  it('이력이 기간을 다 덮으면 통과', () => {
    const g = gate([paid('2026-07-01', '2026-07-31')]);
    expect(g.ok).toBe(true);
    expect(g.gap).toBeNull();
    expect(g.uncoveredHead).toBeNull();
  });

  // ★ 6차 ② — 여기서 막으면 정상 발행이 막힌다. 7/15 최초 배정은 7/15부터 17일분만 청구하는 게 맞다.
  it('기간 중 최초 배정(7/15)은 막지 않고 앞 구간을 uncoveredHead로 알린다', () => {
    const g = gate([paid('2026-07-15', '2026-07-31')]);
    expect(g.ok).toBe(true);
    expect(g.gap).toBeNull();
    expect(g.uncoveredHead).toEqual({ from: '2026-07-01', to: '2026-07-14', days: 14, kind: 'head' });
  });

  it('이력이 통째로 없어도 막지 않는다 — 플랜 미지정 회사·기간 후 최초 배정이 정상이다', () => {
    const g = gate([]);
    expect(g.ok).toBe(true);
    expect(g.uncoveredHead?.days).toBe(31);
  });

  it('중간이 끊긴 이력은 막는다 — 그 구간 구독료가 조용히 0원이 된다', () => {
    const g = gate([paid('2026-07-01', '2026-07-10'), paid('2026-07-20', '2026-07-31')]);
    expect(g.ok).toBe(false);
    expect(g.gap?.kind).toBe('internal');
  });

  it('기간 이전 이력만 있고 기간 안이 비면 막는다 — 이력이 시작된 회사의 공백은 손상이다', () => {
    const g = gate([paid('2026-05-01', '2026-05-31')]);
    expect(g.ok).toBe(false);
    expect(g.gap?.kind).toBe('trailing');
  });

  it('무료 플랜이어도 끊긴 이력은 막는다 — 공백 구간의 플랜을 모른다', () => {
    const g = gate([free('2026-07-01', '2026-07-10'), free('2026-07-20', '2026-07-31')], { monthlyPrice: 0 });
    expect(g.ok).toBe(false);
  });

  it('월 중간에 계약한 회사는 coverFrom이 생성일이라 공백 자체가 없다', () => {
    const g = gate([paid('2026-07-15', '2026-07-31')], { companyCreatedDay: '2026-07-15' });
    expect(g.ok).toBe(true);
    expect(g.uncoveredHead).toBeNull();
    expect(g.coverFrom).toBe('2026-07-15');
  });
});

// ============================================================
//  이력 0건 판정·기간 지문 (★ 2026-07-26 Codex 7차)
// ============================================================

describe('evaluatePlanHistoryGate — 이력 0건이 정상인지 손상인지 (2026-07-26 Codex 7차)', () => {
  const base = { segments: [] as any[], billingStart: '2026-07-01', billingEnd: '2026-07-31', monthlyPrice: 0 };

  it('플랜 배정 + 전 기간 이력 0건 = 차단 — 구독료가 조용히 빠지는 유일한 남은 구멍이었다', () => {
    const g = evaluatePlanHistoryGate({ ...base, planAssigned: true, historyTotal: 0 });
    expect(g.ok).toBe(false);
    expect(g.blockReason).toBe('history_absent');
  });

  it('플랜 미지정 + 이력 0건 = 통과 — 요금제를 쓰지 않는 회사다', () => {
    const g = evaluatePlanHistoryGate({ ...base, planAssigned: false, historyTotal: 0 });
    expect(g.ok).toBe(true);
    expect(g.blockReason).toBeNull();
  });

  it('8/1 최초 배정 회사의 7월분 = 통과 — 기간 안 이력만 0건이고 전 기간 이력은 1건이다', () => {
    const g = evaluatePlanHistoryGate({ ...base, planAssigned: true, historyTotal: 1 });
    expect(g.ok).toBe(true);
    expect(g.uncoveredHead?.days).toBe(31);
  });

  it('끊긴 이력은 이력 건수와 무관하게 차단된다', () => {
    const seg = (from: string, to: string) =>
      ({ planCode: 'BASIC', monthlyPrice: 350000, from, to, days: daySpan(from, to), monthDays: 31, amount: 1 });
    const g = evaluatePlanHistoryGate({
      ...base,
      segments: [seg('2026-07-01', '2026-07-10'), seg('2026-07-20', '2026-07-31')],
      planAssigned: true, historyTotal: 5,
    });
    expect(g.ok).toBe(false);
    expect(g.blockReason).toBe('history_damaged');
  });
});

describe('planChangesFingerprint — 기간에 걸리는 이력만 (2026-07-26)', () => {
  it('같은 이력이면 같은 지문', () => {
    const a = [ch('2026-07-01', 'BASIC', 350000)];
    const b = [ch('2026-07-01', 'BASIC', 350000)];
    expect(planChangesFingerprint(a)).toBe(planChangesFingerprint(b));
  });

  it('기간에 걸리는 변경이 추가되면 지문이 달라진다 — 발행 중 소급 변경을 잡는다', () => {
    const before = planChangesFingerprint([ch('2026-06-01', 'BASIC', 350000)]);
    const after = planChangesFingerprint([ch('2026-06-01', 'BASIC', 350000), ch('2026-07-10', 'PRO', 1000000)]);
    expect(after).not.toBe(before);
  });

  it('플랜 코드만 달라도 잡는다 — 같은 월정액이라 원장 지문으로는 안 걸린다', () => {
    const a = planChangesFingerprint([ch('2026-07-01', 'PLAN_A', 350000)]);
    const b = planChangesFingerprint([ch('2026-07-01', 'PLAN_B', 350000)]);
    expect(a).not.toBe(b);
  });

  it('Date 객체로 와도 같은 지문 — 드라이버가 date를 Date로 준다', () => {
    const s = planChangesFingerprint([ch('2026-07-01', 'BASIC', 350000)]);
    const d = planChangesFingerprint([{ effective_date: '2026-07-01T00:00:00.000Z' as any, to_plan_code: 'BASIC', to_monthly_price: 350000 }]);
    expect(d).toBe(s);
  });

  it('빈 이력은 빈 배열 지문', () => {
    expect(planChangesFingerprint([])).toBe('[]');
    expect(planChangesFingerprint(undefined as any)).toBe('[]');
  });
});
