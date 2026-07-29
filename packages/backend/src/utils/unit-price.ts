// utils/unit-price.ts
// ★ 컨트롤타워 — 발송 단가의 부가세 기준 해석. (2026-07-26 Harold 확정)
//
// 배경: `companies.cost_per_*`에 **부가세 포함** 금액이 들어가 있었는데(실측: 7.70=7×1.1 ·
// 25.08=22.8×1.1 · 24.97=22.7×1.1) 청구 코드는 그 값을 공급가액으로 놓고 10%를 또 더했다.
// 금강제화 7월 실측 +1,339,745원 과청구. 컬럼명에 포함 여부가 안 적혀 있어 tsc·테스트·금액 항등식
// 3중 검사가 전부 통과한다 — 코드로는 절대 안 잡히는 부류다.
//
// 결정: **단가는 부가세 별도(공급가)로 입력하고 시스템이 자동 합산한다.**
// 다만 전환은 회사마다 순차적으로 일어난다(직원 재입력). 배포 시점과 재입력 시점이 같을 수 없으므로,
// 회사별로 "이 값이 어느 기준인가"를 `companies.unit_price_basis`가 들고 있는다.
//
//   vat_included (전환 전) — 저장값 = 부가세 포함가. 공급가 = 저장값 ÷ 1.1
//   vat_excluded (전환 후) — 저장값 = 공급가.       포함가 = 저장값 × 1.1
//
// 두 상태 모두 **고객이 내는 최종 금액은 같다.** 전환 전 회사는 오늘과 동일하게 동작하고,
// 전환한 회사부터 청구서의 이중과세가 사라진다. 전 회사 전환이 끝나면 이 분기를 제거한다.
//
// 축 6개 기준 (2026-07-26 실측 확정 — 이 CT가 다루는 범위):
//   ① 웹 발송 `companies.cost_per_sms/lms/mms/kakao`      → 이 CT
//   ② 테스트   `companies.cost_per_test_sms/test_lms`      → 이 CT (미설정 시 ①을 상속)
//   ③ 스팸필터  전용 컬럼 없음, ①을 그대로 씀(D16)          → 이 CT
//   ④ 에이전트 `company_agent_ids.cost_per_*`               → 이 CT (회사 basis를 따른다)
//   ⑤ 요금제   `plans.monthly_price`                        → 이미 부가세 별도(고객 화면 "VAT 별도" 표기)
//   ⑥ AI 크레딧 `CREDIT_UNIT_PRICE`·`supply_amount`         → 이미 부가세 별도(supply/vat 분리 저장)
//
// ⑤⑥은 변환 대상이 아니므로 이 CT를 통과시키지 않는다.

import { VAT_RATE } from './money';

export type UnitPriceBasis = 'vat_included' | 'vat_excluded';

/** 아직 재입력하지 않은 회사의 기준. DB DEFAULT와 같아야 한다. */
export const DEFAULT_UNIT_PRICE_BASIS: UnitPriceBasis = 'vat_included';

/**
 * (순수) 단가 축의 정밀도 = 소수 둘째 자리.
 * `companies.cost_per_*`가 `numeric(6,2)`라 그보다 잘게 들고 있어도 저장에서 잘린다.
 */
export function round2(value: number | string | null | undefined): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/** (순수) 알 수 없는 값은 전환 전으로 본다 — 모르는 회사에 ÷1.1을 걸면 청구액이 조용히 10% 줄어든다. */
export function normalizeUnitPriceBasis(raw: any): UnitPriceBasis {
  return String(raw) === 'vat_excluded' ? 'vat_excluded' : DEFAULT_UNIT_PRICE_BASIS;
}

/**
 * (순수) 저장값 → **공급가(부가세 별도)**. 청구서 공급가액·`billing_items.unit_price`가 쓴다.
 * `null`(미설정)은 `null` 그대로 돌려준다 — 0으로 바꾸면 "미설정"과 "0원 계약"이 합쳐져
 * 조용한 0원 청구가 된다(MMS 308,043건 사고 계열).
 */
export function toSupplyPrice(stored: number | null, basis: UnitPriceBasis): number | null {
  if (stored === null || stored === undefined) return null;
  const v = Number(stored);
  if (!Number.isFinite(v)) return null;
  return basis === 'vat_excluded' ? round2(v) : round2(v / (1 + VAT_RATE));
}

/**
 * (순수) 저장값 → **부가세 포함가(고객이 실제로 지불하는 건별 금액)**.
 * 선불 잔액 차감·환불·회수, 잔액 화면의 발송 가능 건수, 발송결과·대시보드의 비용 표시가 쓴다.
 *
 * 선불 잔액은 고객이 입금한 현금(부가세 포함)이므로 차감도 포함가여야 한다.
 * 전환 전(`vat_included`)에는 저장값이 곧 포함가라 **오늘과 원 단위까지 동일하게 동작한다.**
 */
export function toVatIncludedPrice(stored: number | null, basis: UnitPriceBasis): number | null {
  if (stored === null || stored === undefined) return null;
  const v = Number(stored);
  if (!Number.isFinite(v)) return null;
  return basis === 'vat_excluded' ? round2(v * (1 + VAT_RATE)) : round2(v);
}

/** (순수) 공급가 → 건별 부가세. 화면에 `VAT 0.80원 · VAT 포함 8.80원`을 그대로 찍는 값. */
export function vatOfUnitPrice(supply: number | null | undefined): number {
  const v = Number(supply);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return round2(round2(v * (1 + VAT_RATE)) - round2(v));
}

/** 메시지 유형 → `companies` 단가 컬럼. 유형 판정을 세 군데서 따로 쓰던 것을 여기로 모은다. */
/**
 * 선불 차감·환불이 쓰는 유형 → 회사 단가 컬럼.
 *
 * ★ 청구 유형 축(`billing-types.ts`)과 **범위가 다르다** — 여기는 발송 시점에 잔액을 깎는 유형만이고
 *   테스트·스팸은 들어오지 않는다. 그래서 축에서 통째로 파생하지 않는다(파생하면 없던 유형이 차감 대상이 된다).
 *   대신 여기 있는 항목이 축의 회사 단가 컬럼과 어긋나지 않는지는 `unit-price.test.ts`가 잡는다.
 * ★ 2026-07-29 BRAND 추가. 없으면 브랜드 발송이 알림톡 단가로 깎인다.
 */
export const MESSAGE_TYPE_PRICE_COLUMN: Record<string, string> = {
  SMS: 'cost_per_sms', LMS: 'cost_per_lms', MMS: 'cost_per_mms', KAKAO: 'cost_per_kakao',
  BRAND: 'cost_per_brand',
};

/**
 * 회사 행 + 메시지 유형 → **고객이 실제로 차감·환불받는 건별 금액(부가세 포함)**.
 *
 * 선불 잔액은 고객이 입금한 현금이므로 부가세를 포함한 금액으로 깎여야 한다.
 * 전환 전(`vat_included`) 회사는 저장값이 곧 포함가라 **오늘과 동일한 금액**이 나온다 —
 * 즉 이 함수를 배선해도 전환 전까지 차감액은 1원도 안 바뀐다.
 *
 * 호출부의 SELECT에 `unit_price_basis`가 없으면 전환 전으로 해석된다(안전한 쪽).
 * 다만 전환한 회사에서 그러면 10% 덜 깎이므로, SELECT 누락은 아래 테스트가 아니라
 * `unit-price-invariants` 소스 스캔이 잡는다.
 */
export function resolveChargeUnitPrice(companyRow: any, messageType: string): number {
  return resolveChargeUnitPriceDetailed(companyRow, messageType).price;
}

export interface ChargeUnitPrice {
  /** 건별 부가세 포함 금액. 미설정이거나 유형을 모르면 0 */
  price: number;
  /**
   * **단가가 설정돼 있지 않다**(NULL·빈값). 명시적 0원 계약과는 다르다.
   * 선불 차감은 이 값이 참이면 발송을 막아야 한다 — 0원으로 통과시키면 그 회사는 공짜로 발송한다.
   */
  unset: boolean;
  /** 유형 자체를 모른다(단가 컬럼이 없는 유형). 이 경우는 막지 않고 경고만 남긴다 — 오탐이 발송을 세운다. */
  unknownType: boolean;
}

/**
 * (순수) 차감 단가 + **미설정 여부**. (★ 2026-07-26 Codex #2)
 *
 * 기존에는 미설정과 "0원 계약"이 똑같이 0으로 합쳐졌고, 선불 차감은 `총액 0 → 성공`으로 통과시켜
 * **단가가 비어 있는 선불 회사가 무제한 공짜 발송**을 할 수 있었다. 둘을 갈라 호출부가 막게 한다.
 *
 * 유형을 모르는 경우(`unknownType`)는 막지 않는다 — 예상 못 한 유형 하나 때문에 발송이 전부 서는 편이
 * 더 나쁘고, 그 상황은 경고 로그로 드러난다.
 */
export function resolveChargeUnitPriceDetailed(companyRow: any, messageType: string): ChargeUnitPrice {
  const col = MESSAGE_TYPE_PRICE_COLUMN[String(messageType || '').toUpperCase()];
  if (!col) return { price: 0, unset: false, unknownType: true };
  const raw = companyRow?.[col];
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { price: 0, unset: true, unknownType: false };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { price: 0, unset: true, unknownType: false };
  const price = toVatIncludedPrice(n, normalizeUnitPriceBasis(companyRow?.unit_price_basis)) ?? 0;
  return { price, unset: false, unknownType: false };
}

/** 단가 입력 모달이 한 칸마다 보여주는 세 값 */
export interface UnitPricePreview {
  supply: number;
  vat: number;
  withVat: number;
}

/** (순수) 공급가 입력값 → 모달 표시용 3종. 프론트와 백엔드가 같은 함수를 쓴다. */
export function previewUnitPrice(supplyInput: number | string | null | undefined): UnitPricePreview {
  const supply = round2(supplyInput);
  const withVat = round2(supply * (1 + VAT_RATE));
  return { supply, vat: round2(withVat - supply), withVat };
}
