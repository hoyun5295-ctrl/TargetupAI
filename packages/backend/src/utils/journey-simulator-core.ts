/**
 * journey-simulator-core.ts — 시뮬레이터 순수 계산 코어 (Phase 9)
 *   DB import 0 — 순수. 등급 분포 셰이핑 + (Task 5) 실데이터 예측 계산.
 *   DB 조회(매칭·평균)는 journey-simulator.ts / journey-target-extractor.ts에서, 계산만 여기서.
 */

export interface SegmentBreakdown {
  segment: string;
  count: number;
  pct: number; // 0~1
}

/** 등급별 count 행(SQL GROUP BY 결과)을 total + pct + 내림차순 정렬로 셰이핑. */
export function buildSegmentBreakdown(
  rows: Array<{ segment: string; cnt: number | string }>,
): { total: number; segments: SegmentBreakdown[] } {
  let total = 0;
  const segments: SegmentBreakdown[] = [];
  for (const row of rows) {
    const count = Number(row.cnt) || 0;
    total += count;
    segments.push({ segment: row.segment, count, pct: 0 });
  }
  for (const s of segments) s.pct = total > 0 ? s.count / total : 0;
  segments.sort((a, b) => b.count - a.count);
  return { total, segments };
}

// ─────────────────────────────────────────────────────────────
// 예측 = 실데이터 또는 정직 표기 (임의 상수 없음)
//   단가·객단가·전환·클릭은 호출부가 그 회사 실데이터로 채워 넣는다(여기서는 계산만).
//   조건 step 하류 메시지 = "조건 통과분(실행 후 확정)" = null(가짜 잔존율 안 씀).
// ─────────────────────────────────────────────────────────────

export interface ProjectionStep {
  stepOrder: number;
  channel: string | null;
  expectedSends: number | null; // null = 조건 통과분(실행 후 확정)
  expectedCost: number | null;
}

export interface JourneyProjection {
  steps: ProjectionStep[];
  totalEstimatedSends: number;
  totalEstimatedCost: number;
  estimatedClickRate: number | null;
  estimatedConversionRate: number | null;
  estimatedRevenue: number | null;
  hasGatedSteps: boolean;     // 조건 하류 변동 step 존재
  dataNote: string | null;    // 데이터 부족 안내(없으면 null)
}

export function buildProjection(input: {
  matched: number;
  steps: Array<{ stepType: string; channel: string | null; stepOrder: number }>;
  avgOrderValue: number | null;
  avgConversion: number | null;
  avgClick: number | null;
  channelCost: Record<string, number>;
}): JourneyProjection {
  const { matched, steps, avgOrderValue, avgConversion, avgClick, channelCost } = input;

  const projSteps: ProjectionStep[] = [];
  let gated = false;
  let totalEstimatedSends = 0;
  let totalEstimatedCost = 0;
  let hasGatedSteps = false;

  for (const s of steps) {
    if (s.stepType === 'condition') { gated = true; continue; }
    if (s.stepType !== 'message') continue; // wait 등 = 발송 없음
    if (gated) {
      projSteps.push({ stepOrder: s.stepOrder, channel: s.channel, expectedSends: null, expectedCost: null });
      hasGatedSteps = true;
    } else {
      const sends = matched;
      const unit = channelCost[s.channel || 'sms'] ?? 0;
      const cost = sends * unit;
      projSteps.push({ stepOrder: s.stepOrder, channel: s.channel, expectedSends: sends, expectedCost: cost });
      totalEstimatedSends += sends;
      totalEstimatedCost += cost;
    }
  }

  const estimatedRevenue =
    avgConversion != null && avgOrderValue != null
      ? Math.round(matched * avgConversion * avgOrderValue)
      : null;

  const missing: string[] = [];
  if (avgConversion == null) missing.push('전환 예측');
  if (avgOrderValue == null) missing.push('객단가');
  const dataNote = missing.length > 0 ? `${missing.join('·')} 데이터가 부족해 매출 추정을 생략했습니다.` : null;

  return {
    steps: projSteps,
    totalEstimatedSends,
    totalEstimatedCost,
    estimatedClickRate: avgClick,
    estimatedConversionRate: avgConversion,
    estimatedRevenue,
    hasGatedSteps,
    dataNote,
  };
}
