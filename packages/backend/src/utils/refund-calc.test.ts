import { describe, it, expect } from 'vitest';
import { calcRefundDue, calcRefundParts, refundInvariantGap, resolveAlimtalkMix, calcAlimtalkUnitDiff } from './refund-calc';

/**
 * ★ 2026-07-27 (B-0727-2): 환불 항아리를 원인별로 나누면서 신설한 calcRefundParts 고정.
 * 핵심 계약 = parts.fail + parts.notLoaded === calcRefundDue (기존 산식과 항상 같다).
 */
describe('calcRefundParts', () => {
  const base = { deductedCount: 0, sentCount: 0, mysqlSuccess: 0, mysqlFail: 0, mysqlPending: 0 };

  it('실패와 미적재를 나눠 돌려준다', () => {
    // 차감 100, 적재 80(성공 70 + 실패 10), 미적재 20
    const p = { ...base, deductedCount: 100, sentCount: 80, mysqlSuccess: 70, mysqlFail: 10 };
    expect(calcRefundParts(p)).toEqual({ fail: 10, notLoaded: 20 });
  });

  it('합계는 기존 calcRefundDue와 항상 같다', () => {
    const cases = [
      { ...base, deductedCount: 100, sentCount: 80, mysqlSuccess: 70, mysqlFail: 10 },
      { ...base, deductedCount: 100, sentCount: 100, mysqlSuccess: 90, mysqlFail: 10 },
      { ...base, deductedCount: 100, sentCount: 0, mysqlSuccess: 0, mysqlFail: 0 },
      { ...base, deductedCount: 100, sentCount: 40, mysqlSuccess: 30, mysqlFail: 5, mysqlPending: 5 },
      { ...base, deductedCount: 50, sentCount: 90, mysqlSuccess: 80, mysqlFail: 10 },
    ];
    for (const c of cases) {
      const parts = calcRefundParts(c);
      expect(parts.fail + parts.notLoaded).toBe(calcRefundDue(c));
    }
  });

  it('처리수 0(집계 미도착)이면 미적재는 0 — 전량 미적재는 워커가 적재 시점에 처리한다', () => {
    const p = { ...base, deductedCount: 100 };
    expect(calcRefundParts(p)).toEqual({ fail: 0, notLoaded: 0 });
  });

  it('적재 실측이 sent_count보다 크면 그쪽을 처리수로 본다 (초과환불 차단)', () => {
    // sent_count 15271인데 실제 성공14790+실패610=15400
    const p = { deductedCount: 15400, sentCount: 15271, mysqlSuccess: 14790, mysqlFail: 610, mysqlPending: 0 };
    expect(calcRefundParts(p)).toEqual({ fail: 610, notLoaded: 0 });
  });

  it('대기분은 처리수에 포함 — 아직 안 나간 건을 미적재로 세지 않는다', () => {
    const p = { deductedCount: 100, sentCount: 0, mysqlSuccess: 40, mysqlFail: 10, mysqlPending: 50 };
    expect(calcRefundParts(p)).toEqual({ fail: 10, notLoaded: 0 });
  });

  it('상한에 걸리면 실패분(실측)을 먼저 채우고 남은 만큼만 미적재분에 준다', () => {
    // 차감 10인데 실패 10 + 미적재 5가 나오는 비정상 집계 — 합계가 차감을 넘으면 안 된다
    const p = { deductedCount: 10, sentCount: 5, mysqlSuccess: 0, mysqlFail: 10, mysqlPending: 0 };
    const parts = calcRefundParts(p);
    expect(parts.fail).toBe(10);
    expect(parts.notLoaded).toBe(0);
    expect(parts.fail + parts.notLoaded).toBeLessThanOrEqual(10);
  });

  it('음수·소수 입력은 정규화된다', () => {
    const p = { deductedCount: -5, sentCount: -1, mysqlSuccess: 1.9, mysqlFail: 2.9, mysqlPending: 0 };
    const parts = calcRefundParts(p);
    expect(parts.fail).toBeGreaterThanOrEqual(0);
    expect(parts.notLoaded).toBeGreaterThanOrEqual(0);
  });
});

describe('refundInvariantGap', () => {
  it('차감 = 성공 + 순환불이면 gap 0', () => {
    expect(refundInvariantGap({ deductedCount: 100, successCount: 90, netRefundedCount: 10 })).toBe(0);
  });

  it('gap 양수 = 미환불(고객이 떼임)', () => {
    expect(refundInvariantGap({ deductedCount: 100, successCount: 90, netRefundedCount: 0 })).toBe(10);
  });

  it('gap 음수 = 초과 환불 잔존', () => {
    expect(refundInvariantGap({ deductedCount: 100, successCount: 90, netRefundedCount: 20 })).toBe(-10);
  });
});

/**
 * ★ 2026-09-26 한줄로 V2 F01·F04 — 선불 알림톡 결과별 정산.
 * 차감은 대체 문자까지 덮는 문자 단가(U)로 하고, 결과가 나오면 성공 결과별 단가와의 차액을 돌려준다.
 * 후불 청구와 같은 결과: 알림톡 성공 = 알림톡 단가 · SMS 대체 = SMS 단가 · LMS 대체 = LMS 단가.
 */
describe('resolveAlimtalkMix — 성공을 결과별로 나눈다 (2026-09-26)', () => {
  const agg = (p: Partial<{ kakao: number; inRowSms: number; inRowLms: number; subSms: number; subLms: number; sub: number }>) =>
    ({ kakao: 0, inRowSms: 0, inRowLms: 0, subSms: 0, subLms: 0, sub: 0, ...p });

  it('알림톡 성공 · 대체 행(S/L) 성공 · 나머지 성공은 기타 (c617 운영 실측 모양: K 1800×4 · 7300×2 + 대체 L 1000×2)', () => {
    expect(resolveAlimtalkMix(agg({ kakao: 4, subLms: 2, sub: 2 }), 6)).toEqual({ mix: { kakao: 4, sms: 0, lms: 2, other: 0 }, ambiguous: false });
  });

  it('K행에 찍힌 대체 성공 코드(7830 SMS · 7831 LMS)도 대체로 센다', () => {
    expect(resolveAlimtalkMix(agg({ kakao: 1, inRowSms: 2, inRowLms: 3 }), 6)).toEqual({ mix: { kakao: 1, sms: 2, lms: 3, other: 0 }, ambiguous: false });
  });

  it('K행 대체 코드와 대체 행이 한 캠페인에 함께 있으면 판정 보류 — 한 수신자를 두 번 셀 수 있다', () => {
    expect(resolveAlimtalkMix(agg({ kakao: 1, inRowSms: 1, sub: 1, subSms: 1 }), 3).ambiguous).toBe(true);
  });

  it('집계가 없으면 전부 기타', () => {
    expect(resolveAlimtalkMix(undefined, 5)).toEqual({ mix: { kakao: 0, sms: 0, lms: 0, other: 5 }, ambiguous: false });
  });

  it('기타는 음수가 되지 않는다(두 집계 사이 시점 차)', () => {
    expect(resolveAlimtalkMix(agg({ kakao: 5 }), 3).mix.other).toBe(0);
  });
});

describe('calcAlimtalkUnitDiff — 결과별 단가 차액 (2026-09-26)', () => {
  const units = { KAKAO: 5.5, SMS: 11, LMS: 27.5 };
  const mix = (p: Partial<{ kakao: number; sms: number; lms: number; other: number }>) => ({ kakao: 0, sms: 0, lms: 0, other: 0, ...p });

  it('알림톡 성공 4 · LMS 대체 2 (LMS 27.5원 차감) → 4 × 22 = 88원', () => {
    expect(calcAlimtalkUnitDiff({ deductUnit: 27.5, units, mix: mix({ kakao: 4, lms: 2 }) })).toBe(88);
  });

  it('SMS 대체 성공은 SMS 단가와의 차액', () => {
    expect(calcAlimtalkUnitDiff({ deductUnit: 27.5, units, mix: mix({ sms: 3 }) })).toBe(49.5);
  });

  it('차감 단가보다 비싼 결과는 0 — 선불은 차감보다 더 받지 않는다(SMS로 차감한 자동발송의 LMS 대체)', () => {
    expect(calcAlimtalkUnitDiff({ deductUnit: 11, units, mix: mix({ kakao: 1, sms: 2, lms: 2 }) })).toBe(5.5);
  });

  it('기타 성공은 차액 0', () => {
    expect(calcAlimtalkUnitDiff({ deductUnit: 27.5, units, mix: mix({ other: 5 }) })).toBe(0);
  });

  it('무료 제공분은 차액이 작은 성공부터 덮는다(LMS 대체 → SMS 대체 → 알림톡) — 돈이 나간 성공만 차액을 받는다', () => {
    // 무료 3 = LMS 대체 1 + SMS 대체 1 + 알림톡 1 → 과금된 알림톡 3건만 22원씩
    expect(calcAlimtalkUnitDiff({ deductUnit: 27.5, units, mix: mix({ kakao: 4, sms: 1, lms: 1 }), freeCount: 3 })).toBe(66);
  });

  it('무료가 성공 이상이면 0 · 성공 0이면 0', () => {
    expect(calcAlimtalkUnitDiff({ deductUnit: 27.5, units, mix: mix({ kakao: 2 }), freeCount: 5 })).toBe(0);
    expect(calcAlimtalkUnitDiff({ deductUnit: 27.5, units, mix: mix({}) })).toBe(0);
  });

  it('소수 단가는 원 단위 둘째 자리로 맞춘다', () => {
    expect(calcAlimtalkUnitDiff({ deductUnit: 25.08, units: { KAKAO: 7.92, SMS: 9.9, LMS: 25.08 }, mix: mix({ kakao: 3 }) })).toBe(51.48);
  });
});

describe('refundInvariantGap — 알림톡 결과별 차액 (2026-09-26)', () => {
  it('차액은 정당 환불이다 — 순환불이 차액만큼 커도 균형(반올림 잡음 1건 미만)', () => {
    // 차감 6 · 성공 6 · 순환불 88원(=차액) ÷ 27.5 → 3건 · 차액 88 ÷ 27.5 = 3.2건
    expect(Math.abs(refundInvariantGap({ deductedCount: 6, successCount: 6, netRefundedCount: 3, unitDiffCount: 3.2 }))).toBeLessThan(1);
  });

  it('차액을 못 돌려줬으면 미환불로 드러난다', () => {
    expect(refundInvariantGap({ deductedCount: 6, successCount: 6, netRefundedCount: 0, unitDiffCount: 3.2 })).toBeCloseTo(3.2, 6);
  });

  it('차액을 안 넘기면 종전 식 그대로', () => {
    expect(refundInvariantGap({ deductedCount: 6, successCount: 6, netRefundedCount: 3 })).toBe(-3);
  });
});
