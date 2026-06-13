/**
 * ai-memory-customer-insight — 등급별 고객 인사이트 생성 (순수 함수, DB import 0)
 *
 * customers 등급 집계(평균 구매액·구매 빈도·LTV)를 전체 평균과 상대 비교해
 * customer_insight 메모리 문장을 만든다. 모든 수치는 실측 집계에서만 도출 — 임의 상수 0.
 * 표본 미달 등급은 제외(가짜 인사이트 방지). DB 집계 쿼리는 accumulator 워커가 수행해 rows를 주입.
 */

export interface GradeAggregate {
  grade: string;
  customerCount: number;
  avgPurchaseAmount: number;
  avgPurchaseCount: number;
  avgLtvScore: number;
}

export interface CustomerInsightInput {
  grades: GradeAggregate[];
  overallAvgPurchaseAmount: number;
  overallAvgPurchaseCount: number;
  minSample: number;
}

export interface CustomerInsight {
  grade: string;
  memoryKey: string;
  memoryValue: string;
  importance: number;
  customerCount: number;
}

function comma(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 등급별 집계 rows → 인사이트 배열.
 * - customerCount < minSample 등급은 제외(표본 부족 = 가짜 인사이트 방지).
 * - 구매액은 전체 평균 대비 실측 배수로 표현(임의 임계·상수 없음).
 * - importance: 전체 평균 이상 등급(배수 ≥ 1)을 더 높게 — 자연 경계 1.0 기준.
 */
export function buildCustomerInsights(input: CustomerInsightInput): CustomerInsight[] {
  const out: CustomerInsight[] = [];
  for (const g of input.grades) {
    if (g.customerCount < input.minSample) continue;
    const amountRatio = input.overallAvgPurchaseAmount > 0
      ? g.avgPurchaseAmount / input.overallAvgPurchaseAmount
      : 1;
    const memoryValue =
      `${g.grade} 등급 (${g.customerCount}명) — 평균 구매액 ₩${comma(g.avgPurchaseAmount)}`
      + ` (전체 평균의 ${amountRatio.toFixed(1)}배), 평균 구매 ${g.avgPurchaseCount.toFixed(1)}회, LTV ${comma(g.avgLtvScore)}점`;
    out.push({
      grade: g.grade,
      memoryKey: `grade_${g.grade}`,
      memoryValue,
      importance: amountRatio >= 1 ? 7 : 5,
      customerCount: g.customerCount,
    });
  }
  return out;
}
