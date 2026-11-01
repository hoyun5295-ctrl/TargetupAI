/**
 * 크레딧 컨트롤타워 순수 계산(★ 2026-11-01 설계서 docs/2026-11-01-credit-control-tower-design.md §5 4판 · §8)
 *
 * 기대값은 손으로 계산한 예시다(설계서 §4 P7 · P14 · Codex 1R 반례). 코드의 식으로 기대값을 다시 만들지 않는다.
 *  - monthEntitlementFrom = 그 달 권리 E(M) = round(Σ 날짜별 월분 ÷ 그 달 일수) 한 번(I5)
 *  - simulateClose = 한 달씩 마감(맞춤 U · 소멸 · 다음 달 지급 · I8 · I10 · C3)
 *  - creditTxDelta = 원장 줄 종류별 변동(§5-2)
 */
import { describe, it, expect } from 'vitest';
import { monthEntitlementFrom, simulateClose, monthKeyOf, addMonths, monthLastDay, billedMonthly } from '../ai-credit-month';
import { creditTxDelta, CREDIT_TX_TYPES } from '../ai-credit-calc';

const CREDITS: Record<string, number> = { FREE: 0, TRIAL: 750, STARTER: 300, BASIC: 750, PRO: 2400 };
const creditsOf = (code: string) => CREDITS[code] ?? 0;
const ch = (effective_date: string, from_plan_code: string | null, to_plan_code: string) => ({ effective_date, from_plan_code, to_plan_code });

describe('월 키 도우미', () => {
  it('KST 기준 달 · 더하기 · 말일', () => {
    expect(monthKeyOf(new Date('2026-10-31T15:30:00Z'))).toBe('2026-11');   // KST 11/1 00:30
    expect(monthKeyOf(new Date('2026-10-31T14:59:59Z'))).toBe('2026-10');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthLastDay('2028-02')).toBe('2028-02-29');
  });
});

describe('monthEntitlementFrom — 그 달 권리 E(M) 한 번 반올림', () => {
  it('P7 · 31일 달 14일 미가입→베이직 · 30일 베이직→프로 = 542(변경마다 반올림 541 이 아니다)', () => {
    // 1~13 FREE 0 · 14~29 BASIC 16일 × 750 = 12,000 · 30~31 PRO 2일 × 2,400 = 4,800 → 16,800 ÷ 31 = 541.93 → 542
    const e = monthEntitlementFrom({
      month: '2026-12', creditsOf, currentPlanCode: 'PRO',
      changes: [ch('2026-01-05', null, 'FREE'), ch('2026-12-14', 'FREE', 'BASIC'), ch('2026-12-30', 'BASIC', 'PRO')],
    });
    expect(e).toBe(542);
  });

  it('P14 · 30일 달 1~15 스타터(그 달 고정 300) · 16~30 베이직 750 = 525', () => {
    const e = monthEntitlementFrom({
      month: '2026-11', creditsOf, currentPlanCode: 'BASIC',
      changes: [ch('2026-10-04', null, 'STARTER'), ch('2026-11-16', 'STARTER', 'BASIC')],
    });
    expect(e).toBe(525);
  });

  it('31일 달 1~14 스타터 · 15~31 베이직 = 547(Codex 1R 반례 시간표)', () => {
    const e = monthEntitlementFrom({
      month: '2026-12', creditsOf, currentPlanCode: 'BASIC',
      changes: [ch('2026-10-04', null, 'STARTER'), ch('2026-12-15', 'STARTER', 'BASIC')],
    });
    expect(e).toBe(547);
  });

  it('체험(TRIAL) 날은 0 · 체험 크레딧은 따로 준다(I7)', () => {
    // 1~9 FREE 0 · 10~16 TRIAL 0 · 17~30 BASIC 14일 × 750 = 10,500 → ÷ 30 = 350
    const e = monthEntitlementFrom({
      month: '2026-11', creditsOf, currentPlanCode: 'BASIC',
      changes: [ch('2026-09-01', null, 'FREE'), ch('2026-11-10', 'FREE', 'TRIAL'), ch('2026-11-17', 'TRIAL', 'BASIC')],
    });
    expect(e).toBe(350);
  });

  it('첫 이력 전 날짜 = 첫 이력의 from_plan · 처음 생긴 회사(from 없음)는 그 전 0', () => {
    // 1~9 STARTER 9 × 300 = 2,700 · 10~30 BASIC 21 × 750 = 15,750 → 18,450 ÷ 30 = 615
    expect(monthEntitlementFrom({ month: '2026-11', creditsOf, currentPlanCode: 'BASIC', changes: [ch('2026-11-10', 'STARTER', 'BASIC')] })).toBe(615);
    // 1~9 0 · 10~30 STARTER 21 × 300 = 6,300 → ÷ 30 = 210
    expect(monthEntitlementFrom({ month: '2026-11', creditsOf, currentPlanCode: 'STARTER', changes: [ch('2026-11-10', null, 'STARTER')] })).toBe(210);
  });

  it('이력이 하나도 없으면 지금 요금제가 그 달 내내(지금 lazy 리셋과 같은 값)', () => {
    expect(monthEntitlementFrom({ month: '2026-11', creditsOf, currentPlanCode: 'STARTER', changes: [] })).toBe(300);
    expect(monthEntitlementFrom({ month: '2026-11', creditsOf, currentPlanCode: null, changes: [] })).toBe(0);
  });

  it('같은 날 두 번 바뀌면 나중 기록', () => {
    // 1~14 STARTER 14 × 300 = 4,200 · 15~30 PRO 16 × 2,400 = 38,400 → 42,600 ÷ 30 = 1,420
    const e = monthEntitlementFrom({
      month: '2026-11', creditsOf, currentPlanCode: 'PRO',
      changes: [ch('2026-10-01', null, 'STARTER'), ch('2026-11-15', 'STARTER', 'BASIC'), ch('2026-11-15', 'BASIC', 'PRO')],
    });
    expect(e).toBe(1420);
  });
});

describe('simulateClose — 한 달씩 마감(C2 · C8 · C3)', () => {
  it('이에스 11월(선불 · 남은 654 · 11월 E 300) = 소멸 −654 · 지급 +300 → 300', () => {
    const r = simulateClose({ base: 654, billingType: 'prepaid', months: [{ month: '2026-10', trialAtEnd: false, nextEntitlement: 300, overageRecorded: 0 }] });
    expect(r.steps).toEqual([{ month: '2026-10', settle: 0, expire: -654, grant: 300 }]);
    expect(r.base).toBe(300);
  });

  it('선불 음수는 넘긴다(소멸 없음) · 다음 달 지급에서 상계', () => {
    const r = simulateClose({ base: -30, billingType: 'prepaid', months: [{ month: '2026-08', trialAtEnd: false, nextEntitlement: 100, overageRecorded: 0 }] });
    expect(r.steps[0]).toEqual({ month: '2026-08', settle: 0, expire: 0, grant: 100 });
    expect(r.base).toBe(70);
  });

  it('후불 −100 · 그 주기 초과 100 이 이미 적힘(청구 여부 무관) = 맞춤 0 · 정리 +100 · 지급 → 이중 청구 0(1R-1 반례)', () => {
    const r = simulateClose({ base: -100, billingType: 'postpaid', months: [{ month: '2026-11', trialAtEnd: false, nextEntitlement: 300, overageRecorded: 100 }] });
    expect(r.steps[0]).toEqual({ month: '2026-11', settle: 0, expire: 100, grant: 300 });
    expect(r.base).toBe(300);
  });

  it('후불 내림 회수로 −305 · 적힌 초과 0 = 맞춤 305(P8 ①)', () => {
    const r = simulateClose({ base: -305, billingType: 'postpaid', months: [{ month: '2026-11', trialAtEnd: false, nextEntitlement: 300, overageRecorded: 0 }] });
    expect(r.steps[0].settle).toBe(305);
    expect(r.steps[0].expire).toBe(305);
  });

  it('후불 올림으로 +50 인데 적힌 초과 50 = 맞춤 −50(미청구 초과를 줄인다 · P8 ②)', () => {
    const r = simulateClose({ base: 50, billingType: 'postpaid', months: [{ month: '2026-11', trialAtEnd: false, nextEntitlement: 300, overageRecorded: 50 }] });
    expect(r.steps[0]).toEqual({ month: '2026-11', settle: -50, expire: -50, grant: 300 });
  });

  it('billing_type 이 비어 있어도 월 정산 청구 대상 = 후불과 같다(음수를 다음 달에서 상계하지 않는다 · billing-issue 는 선불만 막는다 · 옛 C-08)', () => {
    for (const bt of [null, '', 'postpaid']) {
      const r = simulateClose({ base: -30, billingType: bt as any, months: [{ month: '2026-08', trialAtEnd: false, nextEntitlement: 100, overageRecorded: 30 }] });
      expect(r.steps[0]).toEqual({ month: '2026-08', settle: 0, expire: 30, grant: 100 });
      expect(r.base).toBe(100);
    }
    expect(billedMonthly('prepaid')).toBe(false);
    expect(billedMonthly(null)).toBe(true);
  });

  it('달 경계 요금제가 체험이면 양수 잔액을 남긴다 · 다음 달 E 0', () => {
    const r = simulateClose({ base: 200, billingType: 'prepaid', months: [{ month: '2026-11', trialAtEnd: true, nextEntitlement: 0, overageRecorded: 0 }] });
    expect(r.steps[0]).toEqual({ month: '2026-11', settle: 0, expire: 0, grant: 0 });
    expect(r.base).toBe(200);
  });

  it('밀린 두 달은 한 달씩: 선불 −30 → 10월 마감(넘김 · +100 = 70) → 11월 마감(소멸 −70 · +100) = 100', () => {
    const r = simulateClose({
      base: -30, billingType: 'prepaid',
      months: [
        { month: '2026-10', trialAtEnd: false, nextEntitlement: 100, overageRecorded: 0 },
        { month: '2026-11', trialAtEnd: false, nextEntitlement: 100, overageRecorded: 0 },
      ],
    });
    expect(r.steps).toEqual([
      { month: '2026-10', settle: 0, expire: 0, grant: 100 },
      { month: '2026-11', settle: 0, expire: -70, grant: 100 },
    ]);
    expect(r.base).toBe(100);
  });

  it('후불 밀린 두 달(R2-3 반례): 11월 −100(적힌 초과 0) → 11월 맞춤 100 · 12월은 지급분 소멸 · 1월 지급', () => {
    const r = simulateClose({
      base: -100, billingType: 'postpaid',
      months: [
        { month: '2026-11', trialAtEnd: false, nextEntitlement: 300, overageRecorded: 0 },
        { month: '2026-12', trialAtEnd: false, nextEntitlement: 300, overageRecorded: 0 },
      ],
    });
    expect(r.steps).toEqual([
      { month: '2026-11', settle: 100, expire: 100, grant: 300 },
      { month: '2026-12', settle: 0, expire: -300, grant: 300 },
    ]);
    expect(r.base).toBe(300);
  });
});

describe('creditTxDelta — 원장 줄 종류별 변동(§5-2)', () => {
  it('기본분 줄', () => {
    expect(creditTxDelta({ type: 'reset', amount: 300 })).toEqual({ bucket: 'base', delta: 300 });
    expect(creditTxDelta({ type: 'expire', amount: -654 })).toEqual({ bucket: 'base', delta: -654 });
    expect(creditTxDelta({ type: 'expire', amount: 100 })).toEqual({ bucket: 'base', delta: 100 });
    expect(creditTxDelta({ type: 'trial_credit', amount: 300 })).toEqual({ bucket: 'base', delta: 300 });
    expect(creditTxDelta({ type: 'plan_prorate', amount: -96 })).toEqual({ bucket: 'base', delta: -96 });
  });
  it('구매분 줄', () => {
    expect(creditTxDelta({ type: 'grant', amount: 40 })).toEqual({ bucket: 'purchased', delta: 40 });
    expect(creditTxDelta({ type: 'purchase', amount: 100 })).toEqual({ bucket: 'purchased', delta: 100 });
    expect(creditTxDelta({ type: 'postpaid_grant', amount: 100 })).toEqual({ bucket: 'purchased', delta: 100 });
    expect(creditTxDelta({ type: 'admin_deduct', amount: 20 })).toEqual({ bucket: 'purchased', delta: -20 });
  });
  it('차감 · 환불 = 두 항아리 합 · 맞춤 줄(amount 0) = 0 · 환불은 부채 취소분을 뺀다', () => {
    expect(creditTxDelta({ type: 'deduct', amount: 9 })).toEqual({ bucket: 'split', delta: -9 });
    expect(creditTxDelta({ type: 'deduct', amount: 0, overage_credits: 60 })).toEqual({ bucket: 'split', delta: 0 });
    expect(creditTxDelta({ type: 'refund', amount: 100, overage_credits: 0 })).toEqual({ bucket: 'split', delta: 100 });
    expect(creditTxDelta({ type: 'refund', amount: 100, overage_credits: 30 })).toEqual({ bucket: 'split', delta: 70 });
  });
  it('모르는 type 은 null(원장에 넣는 type 은 이 표에 다 있어야 한다)', () => {
    expect(creditTxDelta({ type: 'mystery', amount: 1 })).toBeNull();
    expect([...CREDIT_TX_TYPES].sort()).toEqual(
      ['admin_deduct', 'deduct', 'expire', 'grant', 'plan_prorate', 'postpaid_grant', 'purchase', 'refund', 'reset', 'trial_credit'],
    );
  });
});
