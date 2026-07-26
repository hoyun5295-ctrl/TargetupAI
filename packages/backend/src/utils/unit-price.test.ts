import { describe, it, expect } from 'vitest';
import {
  normalizeUnitPriceBasis, toSupplyPrice, toVatIncludedPrice, vatOfUnitPrice,
  previewUnitPrice, resolveChargeUnitPrice, round2, DEFAULT_UNIT_PRICE_BASIS,
} from './unit-price';

describe('normalizeUnitPriceBasis — 모르는 값은 전환 전으로 (2026-07-26)', () => {
  it('vat_excluded만 전환 후로 인정한다', () => {
    expect(normalizeUnitPriceBasis('vat_excluded')).toBe('vat_excluded');
  });

  it('null·undefined·오타·빈값은 전부 vat_included — ÷1.1이 조용히 걸리면 청구액이 10% 줄어든다', () => {
    expect(DEFAULT_UNIT_PRICE_BASIS).toBe('vat_included');
    for (const v of [null, undefined, '', 'vat_exclusive', 'VAT_EXCLUDED', 0, {}]) {
      expect(normalizeUnitPriceBasis(v as any)).toBe('vat_included');
    }
  });
});

describe('toSupplyPrice — 청구서 공급가액 (2026-07-26)', () => {
  it('전환 후 회사는 저장값이 곧 공급가', () => {
    expect(toSupplyPrice(22.8, 'vat_excluded')).toBe(22.8);
    expect(toSupplyPrice(7.2, 'vat_excluded')).toBe(7.2);
  });

  it('전환 전 회사는 ÷1.1 — 실측 단가가 정확히 되돌아간다', () => {
    expect(toSupplyPrice(25.08, 'vat_included')).toBe(22.8);   // 금강제화 LMS
    expect(toSupplyPrice(7.92, 'vat_included')).toBe(7.2);     // 금강제화 SMS
    expect(toSupplyPrice(7.70, 'vat_included')).toBe(7);       // 최선어학원
    expect(toSupplyPrice(24.97, 'vat_included')).toBe(22.7);
    expect(toSupplyPrice(11.00, 'vat_included')).toBe(10);
    expect(toSupplyPrice(29.70, 'vat_included')).toBe(27);
  });

  it('미설정(null)은 null 그대로 — 0으로 바꾸면 "0원 계약"과 합쳐져 조용한 0원 청구가 된다', () => {
    expect(toSupplyPrice(null, 'vat_included')).toBeNull();
    expect(toSupplyPrice(null, 'vat_excluded')).toBeNull();
  });

  it('명시적 0원은 0원 그대로', () => {
    expect(toSupplyPrice(0, 'vat_included')).toBe(0);
    expect(toSupplyPrice(0, 'vat_excluded')).toBe(0);
  });
});

describe('toVatIncludedPrice — 선불 차감·화면 표시 (2026-07-26)', () => {
  it('전환 전 회사는 저장값 그대로 — 이 배선으로 차감액이 1원도 안 바뀐다', () => {
    expect(toVatIncludedPrice(25.08, 'vat_included')).toBe(25.08);
    expect(toVatIncludedPrice(8.8, 'vat_included')).toBe(8.8);
  });

  it('전환 후 회사는 ×1.1 — 전환 전과 같은 금액이 나온다', () => {
    expect(toVatIncludedPrice(22.8, 'vat_excluded')).toBe(25.08);
    expect(toVatIncludedPrice(8, 'vat_excluded')).toBe(8.8);
    expect(toVatIncludedPrice(25, 'vat_excluded')).toBe(27.5);
  });

  it('왕복이 성립한다 — 전환 전 값을 공급가로 바꾼 뒤 다시 포함가로 돌리면 원값', () => {
    for (const stored of [7.92, 25.08, 7.70, 24.97, 11.00, 29.70, 52.80, 4.62]) {
      const supply = toSupplyPrice(stored, 'vat_included')!;
      expect(toVatIncludedPrice(supply, 'vat_excluded')).toBe(stored);
    }
  });
});

describe('vatOfUnitPrice · previewUnitPrice — 입력 모달 표시값', () => {
  it('공급가 8.00 → VAT 0.80 · 포함 8.80', () => {
    expect(previewUnitPrice(8)).toEqual({ supply: 8, vat: 0.8, withVat: 8.8 });
    expect(vatOfUnitPrice(8)).toBe(0.8);
  });

  it('공급가 25.00 → VAT 2.50 · 포함 27.50 / 7.50 → 0.75 · 8.25', () => {
    expect(previewUnitPrice(25)).toEqual({ supply: 25, vat: 2.5, withVat: 27.5 });
    expect(previewUnitPrice(7.5)).toEqual({ supply: 7.5, vat: 0.75, withVat: 8.25 });
  });

  it('공급가 + VAT = 포함가가 항상 성립한다 (소수 둘째 자리)', () => {
    for (const v of [7, 7.2, 8.3, 22.7, 22.8, 45.45, 50, 60, 95]) {
      const p = previewUnitPrice(v);
      expect(round2(p.supply + p.vat)).toBe(p.withVat);
    }
  });

  it('빈값·0·음수는 0', () => {
    expect(previewUnitPrice('')).toEqual({ supply: 0, vat: 0, withVat: 0 });
    expect(vatOfUnitPrice(0)).toBe(0);
    expect(vatOfUnitPrice(-5)).toBe(0);
  });
});

describe('resolveChargeUnitPrice — 선불 차감·환불·회수가 쓰는 단일 진입점', () => {
  const co = (o: Record<string, any> = {}) => ({
    unit_price_basis: 'vat_included',
    cost_per_sms: 8.8, cost_per_lms: 27.5, cost_per_mms: 55, cost_per_kakao: 8.25, ...o,
  });

  it('전환 전/후가 같은 차감액을 낸다 — 전환은 고객 지불액을 바꾸지 않는다', () => {
    const before = co();
    const after = co({ unit_price_basis: 'vat_excluded', cost_per_sms: 8, cost_per_lms: 25, cost_per_mms: 50, cost_per_kakao: 7.5 });
    for (const t of ['SMS', 'LMS', 'MMS', 'KAKAO']) {
      expect(resolveChargeUnitPrice(after, t)).toBe(resolveChargeUnitPrice(before, t));
    }
  });

  it('유형 판정은 대소문자를 가리지 않고, 모르는 유형은 0', () => {
    expect(resolveChargeUnitPrice(co(), 'sms')).toBe(8.8);
    expect(resolveChargeUnitPrice(co(), 'KAKAO')).toBe(8.25);
    expect(resolveChargeUnitPrice(co(), 'RCS')).toBe(0);
    expect(resolveChargeUnitPrice(co(), '')).toBe(0);
  });

  it('basis 컬럼이 SELECT에서 빠지면 전환 전으로 해석한다 — 안전한 쪽', () => {
    const row: any = { cost_per_sms: 8.8 };
    expect(resolveChargeUnitPrice(row, 'SMS')).toBe(8.8);
  });

  it('미설정·빈값·비수치는 0 (차감 자체가 일어나지 않는다)', () => {
    expect(resolveChargeUnitPrice(co({ cost_per_sms: null }), 'SMS')).toBe(0);
    expect(resolveChargeUnitPrice(co({ cost_per_sms: '' }), 'SMS')).toBe(0);
    expect(resolveChargeUnitPrice(co({ cost_per_sms: 'abc' }), 'SMS')).toBe(0);
    expect(resolveChargeUnitPrice(null, 'SMS')).toBe(0);
  });

  it('PG numeric 문자열도 받는다', () => {
    expect(resolveChargeUnitPrice(co({ cost_per_lms: '27.50' }), 'LMS')).toBe(27.5);
  });
});

describe('부가세 이중과세 회귀 — 금강제화 7월 (2026-07-26)', () => {
  it('전환 전 회사의 공급가액은 저장값 그대로가 아니라 ÷1.1이다', () => {
    // 실측: LMS 성공 532,043건 · SMS 성공 6,795건, 저장 단가 25.08 / 7.92
    const supplyLms = toSupplyPrice(25.08, 'vat_included')!;
    const supplySms = toSupplyPrice(7.92, 'vat_included')!;
    const supply = Math.floor(532043 * supplyLms) + Math.floor(6795 * supplySms);
    const vat = Math.floor(supply * 0.1);

    // 옛 코드: 저장값을 공급가액으로 놓고 10%를 또 더했다
    const wrongSupply = 532043 * 25.08 + 6795 * 7.92;
    expect(wrongSupply).toBeGreaterThan(supply);

    // 정상 총액은 옛 코드의 "공급가액"과 사실상 같다(= 원래 받았어야 할 금액)
    expect(Math.abs((supply + vat) - wrongSupply)).toBeLessThan(10);
  });
});
