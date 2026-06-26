import { describe, test, expect } from 'vitest';
import { deriveBanditArm } from './bandit-arm';

describe('deriveBanditArm — 실측 count에서 Beta(α,β) 도출 (단일 진실, 임의 상수 0)', () => {
  test('cold start (발송 0·클릭 0) → uniform prior α=1, β=1', () => {
    expect(deriveBanditArm(0, 0)).toEqual({ alpha: 1, beta: 1 });
  });

  test('발송만·클릭 0 → α=1, β=1+발송 (미클릭은 실패)', () => {
    expect(deriveBanditArm(10, 0)).toEqual({ alpha: 1, beta: 11 });
  });

  test('발송 10·클릭 3 → α=1+3=4, β=1+(10-3)=8', () => {
    expect(deriveBanditArm(10, 3)).toEqual({ alpha: 4, beta: 8 });
  });

  test('전부 클릭 (10·10) → α=11, β=1', () => {
    expect(deriveBanditArm(10, 10)).toEqual({ alpha: 11, beta: 1 });
  });

  test('클릭 > 발송 이상치 (5·7) → β는 1 미만으로 안 내려감(prior 보존)', () => {
    expect(deriveBanditArm(5, 7)).toEqual({ alpha: 8, beta: 1 });
  });

  test('음수/NaN → 0으로 보정', () => {
    expect(deriveBanditArm(-3, -2)).toEqual({ alpha: 1, beta: 1 });
    expect(deriveBanditArm(NaN, NaN)).toEqual({ alpha: 1, beta: 1 });
  });

  test('소수 입력은 floor', () => {
    expect(deriveBanditArm(10.9, 3.9)).toEqual({ alpha: 4, beta: 8 });
  });

  test('불변식: 클릭 ≤ 발송이면 (α+β-2) == 발송 (Bernoulli trials = 발송)', () => {
    for (const [sent, click] of [[0, 0], [1, 0], [1, 1], [100, 37], [50, 50]]) {
      const { alpha, beta } = deriveBanditArm(sent, click);
      expect(alpha + beta - 2).toBe(sent);
    }
  });
});
