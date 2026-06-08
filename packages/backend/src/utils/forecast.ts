// 예측·기회 — 순수 코어(DB-free). 임의 상수 0: 추세는 실측 발송 시계열 선형회귀에서만 도출.
// 매출 예측은 cdp 매출이 없으면 revenueAvailable=false(데이터부족). 잠재매출도 임의 추정 금지 → null.
// campaigns 일별 발송 SELECT·세그먼트 결과 전달은 호출부(buildForecast) 담당.
import type { RfmSegment } from './rfm-segment';

export interface TrendForecast {
  available: boolean;
  slopePerDay: number;
  recentAvg: number;
  direction: 'up' | 'down' | 'flat';
  projectedNextPeriod: number | null; // 다음 동일 기간 발송 예측 합(추세 반영, 음수 floor 0)
  revenueAvailable: boolean; // 매출 예측 = cdp 매출 필요 → false
}

export interface MissedOpportunity {
  atRiskCount: number;
  dormantCount: number;
  potentialRevenue: number | null; // 잠재 회복 매출 = 임의 추정 금지 → null(데이터부족)
}

const MIN_POINTS = 3; // 추세 산출에 필요한 최소 일수(통계 최소 — 비즈니스 상수 아님)

/** 일별 발송량 시계열 → 선형회귀 추세 + 다음 동일 기간 예측. 매출 예측은 데이터부족. */
export function computeSendTrendForecast(dailySeries: number[]): TrendForecast {
  const n = dailySeries.length;
  if (n < MIN_POINTS) {
    return { available: false, slopePerDay: 0, recentAvg: 0, direction: 'flat', projectedNextPeriod: null, revenueAvailable: false };
  }
  const ys = dailySeries.map((v) => Number(v) || 0);
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (ys[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;
  // 다음 동일 기간(n일, x=n..2n-1) 예측 합 — 음수는 0으로 floor(발송량 음수 불가)
  let proj = 0;
  for (let i = n; i < 2 * n; i++) proj += Math.max(0, intercept + slope * i);
  const direction = slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat';
  return { available: true, slopePerDay: slope, recentAvg: yMean, direction, projectedNextPeriod: proj, revenueAvailable: false };
}

/** RFM 세그먼트에서 이탈위험·휴면 규모 추출. 잠재매출은 임의 추정 금지 → null. */
export function computeMissedOpportunity(rfmSegments: RfmSegment[]): MissedOpportunity {
  let atRisk = 0;
  let dormant = 0;
  for (const s of rfmSegments) {
    if (s.label === '이탈 위험') atRisk += s.count;
    else if (s.label === '휴면') dormant += s.count;
  }
  return { atRiskCount: atRisk, dormantCount: dormant, potentialRevenue: null };
}
