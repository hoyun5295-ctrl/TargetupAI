import { describe, it, expect } from 'vitest';
import { rate, relativeDelta, pointDelta } from '../email-analytics-calc';

describe('rate', () => {
  it('분모 0/음수는 0', () => {
    expect(rate(5, 0)).toBe(0);
    expect(rate(5, -1)).toBe(0);
  });
  it('소수 1자리 비율 %', () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(20, 100)).toBe(20);
    expect(rate(0, 100)).toBe(0);
  });
});

describe('relativeDelta', () => {
  it('이전 값 0/음수면 null', () => {
    expect(relativeDelta(10, 0)).toBeNull();
    expect(relativeDelta(10, -5)).toBeNull();
  });
  it('상대 증감 %', () => {
    expect(relativeDelta(120, 100)).toBe(20);
    expect(relativeDelta(80, 100)).toBe(-20);
    expect(relativeDelta(100, 100)).toBe(0);
  });
});

describe('pointDelta', () => {
  it('포인트(pp) 차이', () => {
    expect(pointDelta(20, 15)).toBe(5);
    expect(pointDelta(10, 12.5)).toBe(-2.5);
    expect(pointDelta(20, 20)).toBe(0);
  });
});
