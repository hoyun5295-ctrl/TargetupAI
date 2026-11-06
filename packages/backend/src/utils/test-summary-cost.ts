/**
 * ★ 2026-11-06 C108(C107F ④ · 뿌리 R67 · 한줄로 Codex 구현 1R) — 관리 발송 통계의 「시험 발송 요약 비용」 CT(순수).
 *
 * 옛 식(manage-stats.ts)은 정산서와 축이 달랐다:
 *   ① 건수 = 시험 SMS 전 행 − **모든 채널 · 스팸 검사의 대기 합** · 시험 LMS 전 행(실패 · 대기 포함) → 대기 104 를 바로 세자 MMS 시험만 있는 기간이 음수 비용
 *   ② 유형 = SMS · LMS 두 가지 → 시험 MMS · 시험 브랜드는 비용 0 · 대체 문자(KS · KL)는 LMS 로
 * 이제 = 청구 수량(성공) × 그 청구 유형 단가 · 유형 = 정산서와 같은 판정(청구 식 billingMsgTypeSql → testBillingTypeKey) ·
 *   스팸 검사 = 청구 판정 행(spamBilledResultSql)을 그 유형 일반 단가로(D16).
 * 단가 = 이 화면의 다른 비용과 같은 표시 기준(부가세 포함 · getCompanyCosts) · 시험 SMS · LMS 전용 칸은 비면 일반 단가(정산서와 같은 상속).
 */
import { getCompanyCosts } from '../config/defaults';
import { normalizeUnitPriceBasis, toVatIncludedPrice } from './unit-price';
import { testBillingTypeKey } from './billing-types';

export interface TestSummaryUnitPrices { SMS: number; LMS: number; TEST_SMS: number; TEST_LMS: number; TEST_MMS: number; TEST_BRAND: number }

/** (순수) 회사 단가 행 → 시험 발송 요약 단가(표시 · 부가세 포함) */
export function testSummaryUnitPrices(co: Record<string, any>): TestSummaryUnitPrices {
  const c = getCompanyCosts(co || {});
  const basis = normalizeUnitPriceBasis(co?.unit_price_basis);
  const own = (raw: any, inherit: number): number => {
    if (raw === null || raw === undefined || String(raw).trim() === '') return inherit;
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return inherit;
    return toVatIncludedPrice(v, basis) ?? inherit;
  };
  return {
    SMS: c.sms,
    LMS: c.lms,
    TEST_SMS: own(co?.cost_per_test_sms, c.sms),
    TEST_LMS: own(co?.cost_per_test_lms, c.lms),
    TEST_MMS: c.mms,
    TEST_BRAND: c.brand,
  };
}

/**
 * (순수) 시험 발송 요약 비용(원 · 소수 한 자리).
 * @param testRows 시험 라인 행의 청구 유형(청구 식 값)별 청구 수량(성공) — 대기 · 실패는 넣지 않는다
 * @param spamBilled 스팸 검사 청구 판정 행 수(유형별)
 */
export function testSummaryCost(
  testRows: Array<{ msgType: string; billed: number }>,
  spamBilled: { sms: number; lms: number },
  prices: TestSummaryUnitPrices,
): number {
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  let sum = 0;
  for (const r of testRows) sum += n(r.billed) * prices[testBillingTypeKey(String(r.msgType))];
  sum += n(spamBilled.sms) * prices.SMS + n(spamBilled.lms) * prices.LMS;
  return Math.round(sum * 10) / 10;
}
