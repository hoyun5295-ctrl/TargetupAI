/**
 * 선불 요금제 이용 기간 — 순수 계산 계약 (★2026-10-04 · docs/2026-10-04-prepaid-plan-term-design.md §3)
 *
 * 못 박는 것
 *   1. 1개월 = 달력 기준(다음 달 같은 날 −1일, 그날이 없으면 다음 달 말일) — D1 벡터 표 그대로.
 *   2. 1개월 금액 = 월정액(부가세 별도) 절사 + 부가세 절사.
 *   3. 올림 차액 = 그날 요금제가 목표와 다른 날만 · 하루치 = (목표가 − 그날 가격) ÷ 그날을 산 구매 구간 일수 · 합계에서 1회 절사.
 *   4. 만료 정산 순서 = 0원 요금제 → 자동 결제 → 잠금.
 *   5. 신청 승인 판정표(§5-2).
 */
import { describe, it, expect } from 'vitest';
import {
  periodEnd, monthlyCharge, planOfDay, denomOfDay, upgradeCharge, upgradeRuns, currentTermEvents, lastPlanSetterPlanId,
  daysLeft, decideSettle, decidePlanRequest, firstTermEnd, proratedCharge, type TermEvent,
} from '../plan-term-calc';

describe('periodEnd — 달력 기준 1개월(D1)', () => {
  const vectors: Array<[string, string]> = [
    ['2026-10-04', '2026-11-03'],
    ['2027-01-31', '2027-02-28'],
    ['2028-01-31', '2028-02-29'],
    ['2027-01-30', '2027-02-28'],
    ['2027-01-29', '2027-02-28'],
    ['2028-01-29', '2028-02-28'],
    ['2027-01-28', '2027-02-27'],
    ['2027-03-31', '2027-04-30'],
    ['2026-12-31', '2027-01-30'],
    ['2027-02-28', '2027-03-27'],
    ['2027-04-30', '2027-05-29'],
    ['2026-12-01', '2026-12-31'],
  ];
  for (const [s, e] of vectors) {
    it(`${s} → ${e}`, () => expect(periodEnd(s)).toBe(e));
  }
  it('형식이 아니면 null — 추측해서 날짜를 만들지 않는다', () => {
    expect(periodEnd('2026-13-01')).toBeNull();
    expect(periodEnd('')).toBeNull();
  });
});

describe('monthlyCharge — 공급가 + 부가세(D6)', () => {
  it('150,000 → 150,000 + 15,000', () => expect(monthlyCharge(150000)).toEqual({ supply: 150000, vat: 15000, total: 165000 }));
  it('소수 월정액은 공급가에서 절사', () => expect(monthlyCharge('99999.99')).toEqual({ supply: 99999, vat: 9999, total: 109998 }));
  it('0원 = 0', () => expect(monthlyCharge(0)).toEqual({ supply: 0, vat: 0, total: 0 }));
});

const ev = (v: number, type: string, plan: string, price: number, from: string | null, to: string | null): TermEvent =>
  ({ term_version: v, event_type: type, plan_id: plan, monthly_price: price, covers_from: from, covers_to: to });

describe('planOfDay · denomOfDay — 원장이 날짜별 요금제를 정한다', () => {
  const events = [
    ev(1, 'start', 'PRO', 1000000, '2026-10-04', '2026-11-03'),
    ev(2, 'extend', 'BASIC', 350000, '2026-11-04', '2026-12-03'),
  ];
  it('그날을 덮는 회차 최대 행', () => {
    expect(planOfDay(events, '2026-10-10')?.planId).toBe('PRO');
    expect(planOfDay(events, '2026-11-04')?.planId).toBe('BASIC');
    expect(planOfDay(events, '2026-12-04')).toBeNull();
  });
  it('분모 = 구매 구간 일수, 구매가 아닌 구간은 그 달 일수', () => {
    expect(denomOfDay(events, '2026-11-10')).toBe(30); // 11/4~12/3
    expect(denomOfDay(events, '2026-10-10')).toBe(31); // start 구간 → 10월 일수
  });
});

describe('upgradeCharge — 남은 기간 일할 차액(D3)', () => {
  it('구매 구간 첫날 올림 = 정확히 한 달 차액', () => {
    const events = [ev(1, 'renew', 'BASIC', 350000, '2026-11-04', '2026-12-03')];
    const c = upgradeCharge(events, '2026-11-04', '2026-12-03', { planId: 'PRO', price: 1000000 });
    expect(c).toEqual({ supply: 650000, vat: 65000, total: 715000 });
  });
  it('반쯤 쓴 뒤 올림 = 남은 일수 비례(오늘 포함)', () => {
    const events = [ev(1, 'renew', 'BASIC', 350000, '2026-11-04', '2026-12-03')];
    // 11/19~12/3 = 15일 / 30일
    const c = upgradeCharge(events, '2026-11-19', '2026-12-03', { planId: 'PRO', price: 1000000 });
    expect(c.supply).toBe(325000);
  });
  it('두 번 연속 올림은 이중으로 받지 않는다', () => {
    const events = [
      ev(1, 'renew', 'BASIC', 350000, '2026-11-04', '2026-12-03'),
      ev(2, 'upgrade', 'PRO', 1000000, '2026-11-04', '2026-12-03'),
    ];
    const again = upgradeCharge(events, '2026-11-04', '2026-12-03', { planId: 'PRO', price: 1000000 });
    expect(again.total).toBe(0);
    const higher = upgradeCharge(events, '2026-11-04', '2026-12-03', { planId: 'BUSINESS', price: 3000000 });
    expect(higher.supply).toBe(2000000); // 3,000,000 − 1,000,000 (BASIC 기준으로 다시 받지 않는다)
  });
  it('내림 예약 → 싼 값으로 미리 연장 → 같은 요금제 재신청 = 미리 산 달의 차액만', () => {
    const events = [
      ev(1, 'renew', 'PRO', 1000000, '2026-10-04', '2026-11-03'),
      ev(2, 'extend', 'BASIC', 350000, '2026-11-04', '2026-12-03'),
    ];
    const c = upgradeCharge(events, '2026-10-20', '2026-12-03', { planId: 'PRO', price: 1000000 });
    expect(c.supply).toBe(650000); // 10월 PRO 일수는 0원, 11월분 30일 전부
  });
  it('같은 요금제인 날은 가격이 올랐어도 0원', () => {
    const events = [ev(1, 'renew', 'PRO', 900000, '2026-11-04', '2026-12-03')];
    expect(upgradeCharge(events, '2026-11-10', '2026-12-03', { planId: 'PRO', price: 1000000 }).total).toBe(0);
  });
  it('구매가 아닌 구간(start)은 그 달 일수로 나눈다', () => {
    const events = [ev(1, 'start', 'BASIC', 310000, '2026-10-04', '2026-10-31')];
    // 10/22~10/31 = 10일, 10월 31일 → (620000−310000)×10/31 = 100000
    expect(upgradeCharge(events, '2026-10-22', '2026-10-31', { planId: 'PRO', price: 620000 }).supply).toBe(100000);
  });
  it('합계에서 한 번만 절사', () => {
    const events = [ev(1, 'renew', 'BASIC', 0, '2026-11-04', '2026-12-03')];
    // 하루 100/30 = 3.333… × 2일 = 6.66 → 6
    expect(upgradeCharge(events, '2026-12-02', '2026-12-03', { planId: 'PRO', price: 100 }).supply).toBe(6);
  });
  it('덮이지 않은 날은 받지 않는다(가격 근거 없음)', () => {
    expect(upgradeCharge([], '2026-11-04', '2026-11-10', { planId: 'PRO', price: 1000000 }).total).toBe(0);
  });
});

describe('upgradeRuns · currentTermEvents (Codex 1R high 2건)', () => {
  it('더 비싼 요금제로 이미 산 구간은 바꾸지 않는다 — 차액을 세는 날 = 바꾸는 날', () => {
    const events = [
      ev(1, 'renew', 'C10', 100000, '2026-11-04', '2026-12-03'),
      ev(2, 'extend', 'C20', 200000, '2026-12-04', '2027-01-03'),
    ];
    const target = { planId: 'C15', price: 150000 };
    expect(upgradeRuns(events, '2026-11-04', '2027-01-03', target)).toEqual([{ from: '2026-11-04', to: '2026-12-03' }]);
    expect(upgradeCharge(events, '2026-11-04', '2027-01-03', target).supply).toBe(50000);
  });
  it('같은 가격·다른 요금제인 날은 0원으로 바꾼다 · 목표 요금제인 날은 제외', () => {
    const events = [
      ev(1, 'renew', 'A', 100000, '2026-11-04', '2026-11-10'),
      ev(2, 'extend', 'T', 100000, '2026-11-11', '2026-11-20'),
      ev(3, 'extend', 'B', 100000, '2026-11-21', '2026-11-30'),
    ];
    expect(upgradeRuns(events, '2026-11-04', '2026-11-30', { planId: 'T', price: 100000 }))
      .toEqual([{ from: '2026-11-04', to: '2026-11-10' }, { from: '2026-11-21', to: '2026-11-30' }]);
  });
  it('현재 관리 기간 = 마지막 종료(end·expire_free) 이후만', () => {
    const events = [
      ev(1, 'start', 'A', 1, '2026-10-04', '2026-11-03'),
      ev(2, 'end', 'A', 1, null, null),
      ev(3, 'start', 'B', 1, null, null),
    ];
    expect(currentTermEvents(events).map((e) => e.term_version)).toEqual([3]);
    expect(currentTermEvents(events.slice(0, 1)).map((e) => e.term_version)).toEqual([1]);
  });
});

describe('lastPlanSetterPlanId · daysLeft', () => {
  it('요금제를 정한 마지막 이벤트(start·first_charge·restore·upgrade·align)', () => {
    const events = [
      ev(1, 'start', 'PRO', 1, '2026-10-04', '2026-11-03'),
      ev(2, 'extend', 'BASIC', 1, '2026-11-04', '2026-12-03'),
      ev(3, 'auto_off', 'PRO', 1, null, null),
    ];
    expect(lastPlanSetterPlanId(events)).toBe('PRO');
    expect(lastPlanSetterPlanId([...events, ev(4, 'align', 'BASIC', 1, null, null)])).toBe('BASIC');
  });
  it('올림 행은 오늘 plan_id를 실제로 바꾼 것만 센다(Codex 2R high)', () => {
    const base = [ev(1, 'start', 'A', 1, '2026-10-04', '2026-11-03')];
    expect(lastPlanSetterPlanId([...base, { ...ev(2, 'upgrade', 'B', 1, '2026-12-04', '2027-01-03'), detail: { sets_plan: false } }])).toBe('A');
    expect(lastPlanSetterPlanId([...base, { ...ev(2, 'upgrade', 'B', 1, '2026-10-10', '2026-11-03'), detail: { sets_plan: true } }])).toBe('B');
  });
  it('남은 날 = 오늘 포함, 지났으면 0', () => {
    expect(daysLeft('2026-10-10', '2026-11-03')).toBe(25);
    expect(daysLeft('2026-11-03', '2026-11-03')).toBe(1);
    expect(daysLeft('2026-11-04', '2026-11-03')).toBe(0);
  });
});

describe('decideSettle — 만료 정산 순서(회의론자 최종 #1)', () => {
  const base = { blocked: false, expiresOn: '2026-11-03', today: '2026-11-04', autoRenew: true, balance: 200000,
    nextPlan: { code: 'PRO', price: 150000 } };
  it('만료 전이면 할 일 없음', () => expect(decideSettle({ ...base, today: '2026-11-03' })).toBe('none'));
  it('잠김이면 할 일 없음(재시도 없음)', () => expect(decideSettle({ ...base, blocked: true })).toBe('none'));
  it('다음 구매가 FREE면 잔액·스위치와 무관하게 FREE로 끝낸다', () => {
    expect(decideSettle({ ...base, nextPlan: { code: 'FREE', price: 0 } })).toBe('expire_free');
  });
  it('0원인데 FREE가 아니면 손대지 않고 알림', () => {
    expect(decideSettle({ ...base, nextPlan: { code: 'STAFF', price: 0 } })).toBe('alert');
  });
  it('자동 켬 + 잔액 충분 = 자동 결제', () => expect(decideSettle(base)).toBe('renew'));
  it('잔액 부족 = 잠금', () => expect(decideSettle({ ...base, balance: 164999 })).toBe('block'));
  it('자동 끔 = 잠금', () => expect(decideSettle({ ...base, autoRenew: false })).toBe('block'));
});

describe('decidePlanRequest — 신청 승인 판정표(§5-2)', () => {
  const pro = { id: 'PRO', code: 'PRO', price: 1000000 };
  const basic = { id: 'BASIC', code: 'BASIC', price: 350000 };
  const free = { id: 'FREE', code: 'FREE', price: 0 };
  const staff = { id: 'STAFF', code: 'STAFF', price: 0 };
  const active = { ready: true, prepaid: true, managed: true, blocked: false, trialRequest: false,
    todayPlan: { id: 'BASIC', price: 350000 }, nextPlanId: null as string | null, upgradeTotal: 0 };

  it('준비 안 됨·후불은 미처리', () => {
    expect(decidePlanRequest({ ...active, ready: false, target: pro }).kind).toBe('unhandled');
    expect(decidePlanRequest({ ...active, prepaid: false, target: pro }).kind).toBe('unhandled');
  });
  it('관리 중 체험 신청은 409', () => {
    expect(decidePlanRequest({ ...active, trialRequest: true, target: pro }).kind).toBe('reject');
    expect(decidePlanRequest({ ...active, target: { id: 'TRIAL', code: 'TRIAL', price: 0 } }).kind).toBe('reject');
  });
  it('미관리 체험 신청은 미처리(기존 경로)', () => {
    expect(decidePlanRequest({ ...active, managed: false, trialRequest: true, target: pro }).kind).toBe('unhandled');
  });
  it('잠김: 유료 = 복구 · FREE = 종료 · 0원 비FREE = 거절', () => {
    const b = { ...active, blocked: true };
    expect(decidePlanRequest({ ...b, target: pro }).kind).toBe('restore');
    expect(decidePlanRequest({ ...b, target: free }).kind).toBe('end');
    expect(decidePlanRequest({ ...b, target: staff }).kind).toBe('reject');
  });
  it('활성: 비싼 요금제 = 올림 · 싼 요금제 = 예약 · FREE = 예약', () => {
    expect(decidePlanRequest({ ...active, target: pro, upgradeTotal: 500 }).kind).toBe('upgrade');
    expect(decidePlanRequest({ ...active, todayPlan: { id: 'PRO', price: 1000000 }, target: basic }).kind).toBe('reserve');
    expect(decidePlanRequest({ ...active, target: free }).kind).toBe('reserve');
    expect(decidePlanRequest({ ...active, target: staff }).kind).toBe('reject');
  });
  it('활성: 같은 요금제 = 차액 있으면 올림 · 예약 있으면 취소 · 둘 다 없으면 무변화', () => {
    expect(decidePlanRequest({ ...active, target: basic, upgradeTotal: 1000 }).kind).toBe('upgrade');
    expect(decidePlanRequest({ ...active, target: basic, nextPlanId: 'FREE' }).kind).toBe('reserve_cancel');
    expect(decidePlanRequest({ ...active, target: basic }).kind).toBe('noop');
  });
  it('미관리 선불: 유료 = 첫 결제로 시작 · FREE = 미처리', () => {
    const u = { ...active, managed: false };
    expect(decidePlanRequest({ ...u, target: pro }).kind).toBe('first_charge');
    expect(decidePlanRequest({ ...u, target: free }).kind).toBe('unhandled');
  });
});

// ★ 2026-11-01 크레딧 컨트롤타워 C11(Harold 「새 회사만 1일 맞춤」) — 첫 결제 · 다시 열기 = 오늘 ~ 그달 말일 일할 → 다음 연장부터 1일
describe('firstTermEnd · proratedCharge — 새 회사 첫 결제는 그달 말일까지 일할(C11)', () => {
  it('끝 = 그달 말일', () => {
    expect(firstTermEnd('2026-11-15')).toBe('2026-11-30');
    expect(firstTermEnd('2026-11-01')).toBe('2026-11-30');
    expect(firstTermEnd('2028-02-10')).toBe('2028-02-29');
    expect(firstTermEnd('2026-13-01')).toBeNull();
  });
  it('1일 시작이면 한 달 값 = monthlyCharge 와 같다', () => {
    expect(proratedCharge(150000, '2026-11-01', '2026-11-30')).toEqual({ supply: 150000, vat: 15000, total: 165000 });
  });
  it('11/15 ~ 11/30 = 16일 ÷ 30 → 80,000 + 8,000', () => {
    expect(proratedCharge(150000, '2026-11-15', '2026-11-30')).toEqual({ supply: 80000, vat: 8000, total: 88000 });
  });
  it('말일 하루 = 5,000 + 500 · 2월(28일) 14일 = 75,000 + 7,500', () => {
    expect(proratedCharge(150000, '2026-11-30', '2026-11-30')).toEqual({ supply: 5000, vat: 500, total: 5500 });
    expect(proratedCharge(150000, '2026-02-15', '2026-02-28')).toEqual({ supply: 75000, vat: 7500, total: 82500 });
  });
  it('소수 월정액은 일할 뒤 원 미만 절사(99,999.99 × 16 ÷ 30 = 53,333.33 → 53,333 + 5,333)', () => {
    expect(proratedCharge('99999.99', '2026-11-15', '2026-11-30')).toEqual({ supply: 53333, vat: 5333, total: 58666 });
  });
  it('구간이 달을 넘거나 거꾸로면 0(일할 결제는 한 달 안에서만)', () => {
    expect(proratedCharge(150000, '2026-11-15', '2026-12-14')).toEqual({ supply: 0, vat: 0, total: 0 });
    expect(proratedCharge(150000, '2026-11-20', '2026-11-15')).toEqual({ supply: 0, vat: 0, total: 0 });
  });
});

describe('denomOfDay — 일할로 산 구간의 하루치 = 월 요금 ÷ 그 달 일수(C11 · SC32)', () => {
  const events = [ev(1, 'first_charge', 'STARTER', 150000, '2026-11-15', '2026-11-30')];
  it('같은 달 안 · 말일까지인 구매의 분모 = 그 달 일수(구간 일수 16 이 아니다)', () => {
    expect(denomOfDay(events, '2026-11-20')).toBe(30);
  });
  it('그 구간 안 올림 차액 = 200,000 × 11 ÷ 30 = 73,333 + 7,333', () => {
    expect(upgradeCharge(events, '2026-11-20', '2026-11-30', { planId: 'BASIC', price: 350000 })).toEqual({ supply: 73333, vat: 7333, total: 80666 });
  });
  it('1일 ~ 말일 구매 · 결제일 기준 구매는 지금 그대로(구간 일수)', () => {
    const full = [ev(1, 'renew', 'STARTER', 150000, '2026-12-01', '2026-12-31')];
    expect(denomOfDay(full, '2026-12-10')).toBe(31);
    const anniversary = [ev(1, 'renew', 'STARTER', 150000, '2026-11-02', '2026-12-01')];
    expect(denomOfDay(anniversary, '2026-11-10')).toBe(30);
  });
});
