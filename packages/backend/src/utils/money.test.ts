import { describe, it, expect } from 'vitest';
import { floorWon, vatOfSupply, VAT_RATE } from './money';

describe('floorWon — 원 미만 절사 (2026-07-26)', () => {
  it('소수는 버린다', () => {
    expect(floorWon(53816.4)).toBe(53816);
    expect(floorWon(13343638.44)).toBe(13343638);
    expect(floorWon(0.99)).toBe(0);
    expect(floorWon(1.0)).toBe(1);
  });

  it('부동소수점 오차로 정수가 깎이지 않는다 — 절사 전에 소수 둘째 자리로 반올림한다', () => {
    // 0.1+0.2 계열의 오차. 그대로 Math.floor를 하면 5039가 된다.
    expect(floorWon(5040 - 1e-9)).toBe(5040);
    expect(floorWon(720 * 7.0000000000001)).toBe(5040);
    // 실제 단가 곱 — 22.8 × 532043
    expect(floorWon(532043 * 22.8)).toBe(12130580);
  });

  it('0·음수·비수치는 0', () => {
    expect(floorWon(0)).toBe(0);
    expect(floorWon(-0.4)).toBe(0);
    expect(floorWon(-100)).toBe(0);
    expect(floorWon(null)).toBe(0);
    expect(floorWon(undefined)).toBe(0);
    expect(floorWon('abc')).toBe(0);
    expect(floorWon(NaN)).toBe(0);
    expect(floorWon(Infinity)).toBe(0);
  });

  it('문자열 숫자(PG numeric)도 받는다', () => {
    expect(floorWon('101612.90')).toBe(101612);
    expect(floorWon('350000')).toBe(350000);
  });
});

describe('vatOfSupply — 부가세도 원 미만 절사', () => {
  it('세율은 10%', () => {
    expect(VAT_RATE).toBe(0.1);
    expect(vatOfSupply(1000)).toBe(100);
  });

  it('소수가 나오면 버린다 — 합계가 정수로 떨어진다', () => {
    expect(vatOfSupply(13397443)).toBe(1339744);   // 1,339,744.3 → 절사
    expect(vatOfSupply(101612)).toBe(10161);       // 10,161.2 → 절사
    expect(13397443 + vatOfSupply(13397443)).toBe(14737187);
  });

  it('0·빈값은 0', () => {
    expect(vatOfSupply(0)).toBe(0);
    expect(vatOfSupply(null)).toBe(0);
  });
});

describe('계층 정합 — 행 단위 절사면 모든 세로합이 정수 덧셈으로 성립한다', () => {
  it('행 절사 합 = 소계, 소계 + 부가세 = 합계', () => {
    // 실제 금강제화 7월 축(LMS 22.80 · SMS 7.20)에서 뽑은 형태의 행들
    const rows = [
      { success: 2758, price: 22.8 },
      { success: 48014, price: 22.8 },
      { success: 97151, price: 22.8 },
      { success: 6793, price: 7.2 },
      { success: 2, price: 7.2 },
    ];
    const amounts = rows.map((r) => floorWon(r.success * r.price));
    amounts.forEach((a) => expect(Number.isInteger(a)).toBe(true));

    const subtotal = amounts.reduce((s, a) => s + a, 0);
    const vat = vatOfSupply(subtotal);
    expect(Number.isInteger(subtotal)).toBe(true);
    expect(Number.isInteger(vat)).toBe(true);
    expect(Number.isInteger(subtotal + vat)).toBe(true);

    // 장으로 쪼개도 정수 덧셈이라 합이 정확히 같다(§1-8 묶음 합계 불변식)
    const sheetA = amounts.slice(0, 3).reduce((s, a) => s + a, 0);
    const sheetB = amounts.slice(3).reduce((s, a) => s + a, 0);
    expect(sheetA + sheetB).toBe(subtotal);
  });

  it('절사 오차는 행당 1원 미만이고 항상 고객에게 유리한 방향이다', () => {
    const rows = Array.from({ length: 31 }, (_, i) => ({ success: 1000 + i, price: 22.8 }));
    const exact = rows.reduce((s, r) => s + r.success * r.price, 0);
    const billed = rows.reduce((s, r) => s + floorWon(r.success * r.price), 0);
    expect(billed).toBeLessThanOrEqual(exact);
    expect(exact - billed).toBeLessThan(rows.length);
  });
});
