/**
 * 크레딧 컨트롤타워 편입 — 판정 한 벌(★ 2026-11-01 설계서 docs/2026-11-01-credit-control-tower-design.md §16-1 F17 · F18 · F19)
 *   옛: 「크레딧제 적용 회사인가」 다섯 벌 · 「걷힘인가」 두 벌 · 「크레딧 모자람」 두 벌(기준도 < 와 ≤ 로 갈림).
 */
import { describe, it, expect } from 'vitest';
import { creditApplies, outcomeSettled, resultSettled, isCreditLow } from '../ai-credit-calc';

describe('creditApplies — 크레딧제 적용 회사(월 크레딧 칸 있음 또는 구매분 남음)', () => {
  it('월 크레딧 칸이 있으면 0 이어도 적용(FREE = 0 · 차감 대상)', () => {
    expect(creditApplies({ plan_credits: 0, purchased: 0 })).toBe(true);
    expect(creditApplies({ plan_credits: 300, purchased: 0 })).toBe(true);
  });
  it('월 크레딧 칸이 없으면 구매분이 남아 있을 때만 적용', () => {
    expect(creditApplies({ plan_credits: null, purchased: 0 })).toBe(false);
    expect(creditApplies({ plan_credits: null, purchased: '0' })).toBe(false);
    expect(creditApplies({ plan_credits: null, purchased: 50 })).toBe(true);
  });
  it('행이 없으면 미적용', () => {
    expect(creditApplies(null)).toBe(false);
    expect(creditApplies(undefined)).toBe(false);
  });
});

describe('outcomeSettled · resultSettled — 걷힘 = 차감 · 같은 키 이미 걷음 · 크레딧제 미적용', () => {
  it('결과 글자', () => {
    expect(['deducted', 'duplicate', 'not_applicable'].map(outcomeSettled)).toEqual([true, true, true]);
    expect(['not_required', 'failed', '', null, undefined].map(outcomeSettled)).toEqual([false, false, false, false, false]);
  });
  it('차감 결과 꼴', () => {
    expect(resultSettled({ deducted: true })).toBe(true);
    expect(resultSettled({ deducted: false, skipReason: 'duplicate' })).toBe(true);
    expect(resultSettled({ deducted: false, skipReason: 'not_applicable' })).toBe(true);
    expect(resultSettled({ deducted: false, skipReason: 'no_credit_row' })).toBe(false);
    expect(resultSettled({ deducted: false })).toBe(false);
    expect(resultSettled(null)).toBe(false);
  });
});

describe('isCreditLow — 남은 크레딧 < 월 기본 × 20%(여정 담당자 안내 · 관리자 위험 회사 공용)', () => {
  it('월 기본 750 · 남은 149 = 모자람 · 150(정확히 20%) = 아님 · 151 = 아님', () => {
    expect(isCreditLow({ creditEnabled: true, planCredits: 750, total: 149 })).toBe(true);
    expect(isCreditLow({ creditEnabled: true, planCredits: 750, total: 150 })).toBe(false);
    expect(isCreditLow({ creditEnabled: true, planCredits: 750, total: 151 })).toBe(false);
  });
  it('마이너스 잔액 = 모자람', () => {
    expect(isCreditLow({ creditEnabled: true, planCredits: 300, total: -20 })).toBe(true);
  });
  it('크레딧제 미적용 · 월 기본 0(FREE) = 판정 안 함', () => {
    expect(isCreditLow({ creditEnabled: false, planCredits: 750, total: 0 })).toBe(false);
    expect(isCreditLow({ creditEnabled: true, planCredits: 0, total: 0 })).toBe(false);
  });
});
