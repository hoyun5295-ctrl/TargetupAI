/**
 * ★ 성과리포트 블렌디드 ROAS 순수 산출 — DB-free (TDD 대상).
 *
 * 헤드라인 ROAS 카드(현재/이전/격차)용. snapshot-v2가 호출.
 * 임의상수 0 — 기간 실매출(cdp_events)·실비용(success × 단가)만으로 계산.
 * 블렌디드 = 채널 합산 매출 ÷ 채널 합산 비용 (개별 채널 평균 아님).
 */

export interface RoasMetric {
  current: number;    // 현재 기간 블렌디드 ROAS (매출/비용). 비용 0 → 0
  previous: number;   // 직전 기간 블렌디드 ROAS
  diffPct: number;    // (current - previous) / previous × 100
  betterThan: boolean;
}

/** 매출 ÷ 비용. 0 나눗셈·NaN·Infinity 가드 → 0 */
export function computeBlendedRoas(revenue: number, cost: number): number {
  if (!isFinite(revenue) || !isFinite(cost) || cost <= 0 || revenue <= 0) return 0;
  const roas = revenue / cost;
  return isFinite(roas) ? roas : 0;
}

/** current/previous 매출·비용 → ROAS 지표(격차 포함). diffPct 규칙은 snapshot calcDiffPct와 동일 */
export function computeRoasMetric(
  currentRevenue: number,
  currentCost: number,
  previousRevenue: number,
  previousCost: number,
): RoasMetric {
  const current = computeBlendedRoas(currentRevenue, currentCost);
  const previous = computeBlendedRoas(previousRevenue, previousCost);
  const diffPct = previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;
  return { current, previous, diffPct, betterThan: current > previous };
}
