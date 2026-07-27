import { describe, it, expect } from 'vitest';
import { calcRefundDue, calcRefundParts, refundInvariantGap } from './refund-calc';

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
