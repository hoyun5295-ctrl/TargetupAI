/**
 * utils/unitPrice.ts — 단가 부가세 계산 (★ 2026-07-26)
 *
 * 백엔드 `utils/unit-price.ts`의 `previewUnitPrice`와 **같은 규칙**이다.
 * 화면이 보여주는 `VAT 0.80원 · VAT 포함 8.80원`과 실제 차감·청구 금액이 어긋나면
 * 고객이 가장 먼저 검산하는 자리에서 신뢰를 잃는다.
 *
 * 규칙: 입력값 = 부가세 별도 공급가. 건별 VAT = 공급가 × 10%를 소수 둘째 자리 반올림.
 */

export const VAT_RATE = 0.1;

/** 단가 축의 정밀도 = 소수 둘째 자리 (`companies.cost_per_*`가 numeric(6,2)) */
export function round2(value: number | string | null | undefined): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

export interface UnitPricePreview {
  supply: number;
  vat: number;
  withVat: number;
}

/** 공급가 입력값 → 화면 표시용 3종 */
export function previewUnitPrice(supplyInput: number | string | null | undefined): UnitPricePreview {
  const supply = round2(supplyInput);
  const withVat = round2(supply * (1 + VAT_RATE));
  return { supply, vat: round2(withVat - supply), withVat };
}

/** 소수 뒤 불필요한 0을 떼고 표시 (8.80 → 8.8 · 8.00 → 8) */
export function fmtPrice(value: number): string {
  return String(round2(value));
}

/**
 * 회사 행 → 단가 입력칸 값(**VAT 별도 공급가**). (★ 2026-07-26 Codex #1)
 *
 * 전환 전(`vat_included`) 회사의 저장값은 VAT 포함가다. 그 숫자를 "VAT 별도" 칸에 그대로 채우면
 * 운영자가 아무것도 수정하지 않고 저장만 해도 그 값이 공급가로 재해석돼 **10% 과청구**가 된다.
 * 그래서 공급가 상당액(÷1.1)으로 환산해 채운다 — 그대로 저장해도 고객 지불액은 변하지 않는다.
 *
 * 미설정(NULL)은 빈 문자열로 둔다. 기본 상수로 채우면 계약과 다른 단가가 조용히 굳는다.
 */
export function toSupplyInputs(company: Record<string, any> | null | undefined) {
  const excluded = String(company?.unit_price_basis) === 'vat_excluded';
  const conv = (raw: any): string | number => {
    if (raw === null || raw === undefined || String(raw).trim() === '') return '';
    const v = Number(raw);
    if (!Number.isFinite(v)) return '';
    return excluded ? round2(v) : round2(v / (1 + VAT_RATE));
  };
  return {
    costPerSms: conv(company?.cost_per_sms),
    costPerLms: conv(company?.cost_per_lms),
    costPerMms: conv(company?.cost_per_mms),
    costPerKakao: conv(company?.cost_per_kakao),
    costPerBrand: conv(company?.cost_per_brand),
    costPerTestSms: conv(company?.cost_per_test_sms),
    costPerTestLms: conv(company?.cost_per_test_lms),
  };
}
