/**
 * CT-60: Journey Simulator — 활성화 직전 가상 실행 (Phase 9 재작성)
 *
 * 미리보기·시뮬레이션·실발송이 같은 추출 함수(selectJourneyTargetCustomerIds)를 쓴다.
 *   - 매칭 수·등급 분포 = 발송과 동일 기준(count 헬퍼 재사용).
 *   - 예측은 그 회사 실데이터에서만 — 객단가(customers.avg_order_value),
 *     전환·클릭(cdp_customer_predictions), 비용(companies.cost_per_*).
 *   - 임의 상수 없음. 데이터 없으면 추정 생략(정직 표기). 조건 step 하류는 "변동".
 *
 * 영구 룰: 회사 격리 의무 · 모델 호출 0(Read-only SQL) · 0건이면 빈 결과 + 안내(자동완화 없음).
 * 사용처: GET /operator/journeys/:id/simulate.
 * 검증 컬럼(information_schema 2026-06-04~05): customers.avg_order_value,
 *   cdp_customer_predictions.purchase_likelihood/click_score, companies.cost_per_sms/lms/mms/kakao.
 */

import { query } from '../config/database';
import {
  selectJourneyTargetCustomerIds,
  gradeBreakdownForIds,
  averageScoresForIds,
  JOURNEY_COUNT_CAP,
} from './journey-target-extractor';
import { buildProjection, SegmentBreakdown, ProjectionStep } from './journey-simulator-core';

export interface JourneySimulationResult {
  journeyId: string;
  simulatedAt: Date;
  triggerEvent: string;
  matchedCustomers: number;
  capped: boolean;
  customerSegments: SegmentBreakdown[];
  steps: ProjectionStep[];
  totalEstimatedSends: number;
  totalEstimatedCost: number;
  estimatedClickRate: number | null;
  estimatedConversionRate: number | null;
  estimatedRevenue: number | null;
  hasGatedSteps: boolean;
  dataNote: string | null;
  reasoning: string;
  warnings: string[];
}

export async function simulateJourney(
  journeyId: string,
  companyId: string,
): Promise<JourneySimulationResult> {
  // 회사 격리 + 여정 조회
  const jRes = await query(
    `SELECT id, trigger_event, trigger_filters FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId],
  );
  if (jRes.rows.length === 0) throw new Error('여정 접근 권한이 없습니다 (회사 격리).');
  const journey = jRes.rows[0];

  const stepsRes = await query(
    `SELECT step_order, step_type, channel FROM journey_steps WHERE journey_id = $1::uuid ORDER BY step_order ASC`,
    [journeyId],
  );
  const steps = stepsRes.rows;

  // 회사 실 단가(원/건) — 임의 상수 대신 그 회사 설정값.
  const costRes = await query(
    `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1::uuid`,
    [companyId],
  );
  const c = costRes.rows[0] || {};
  const channelCost: Record<string, number> = {
    sms: Number(c.cost_per_sms) || 0,
    lms: Number(c.cost_per_lms) || 0,
    mms: Number(c.cost_per_mms) || 0,
    kakao: Number(c.cost_per_kakao) || 0,
  };

  // 발송과 동일 함수로 매칭 ID 1회 추출 → 등급 분포 + 실데이터 평균(객단가·전환·클릭).
  const ids = await selectJourneyTargetCustomerIds(
    companyId, journey.trigger_event, journey.trigger_filters || {}, JOURNEY_COUNT_CAP, journeyId,
  );
  const capped = ids.length >= JOURNEY_COUNT_CAP;
  const { total: matched, segments } = await gradeBreakdownForIds(companyId, ids);
  const { avgOrderValue, avgConversion, avgClick } = await averageScoresForIds(companyId, ids);

  const projection = buildProjection({
    matched,
    steps: steps.map((s: any) => ({ stepType: s.step_type, channel: s.channel, stepOrder: s.step_order })),
    avgOrderValue,
    avgConversion,
    avgClick,
    channelCost,
  });

  const warnings: string[] = [];
  if (matched === 0) warnings.push('트리거 조건에 맞는 고객이 0명입니다. 활성화해도 즉시 보낼 대상이 없으니 조건을 확인해 주세요.');
  if (steps.length === 0) warnings.push('단계가 없어 보낼 메시지가 없습니다.');
  if (capped) warnings.push(`대상이 ${JOURNEY_COUNT_CAP.toLocaleString()}명을 넘어 그만큼까지만 집계했습니다. 실제 발송 때는 전체가 대상입니다.`);
  if (projection.dataNote) warnings.push(projection.dataNote);

  return {
    journeyId,
    simulatedAt: new Date(),
    triggerEvent: journey.trigger_event,
    matchedCustomers: matched,
    capped,
    customerSegments: segments,
    steps: projection.steps,
    totalEstimatedSends: projection.totalEstimatedSends,
    totalEstimatedCost: projection.totalEstimatedCost,
    estimatedClickRate: projection.estimatedClickRate,
    estimatedConversionRate: projection.estimatedConversionRate,
    estimatedRevenue: projection.estimatedRevenue,
    hasGatedSteps: projection.hasGatedSteps,
    dataNote: projection.dataNote,
    reasoning: buildReasoning(matched, segments, projection, capped),
    warnings,
  };
}

function buildReasoning(
  matched: number,
  segments: SegmentBreakdown[],
  projection: { totalEstimatedSends: number; totalEstimatedCost: number; estimatedRevenue: number | null },
  capped: boolean,
): string {
  if (matched === 0) return '트리거 조건에 맞는 고객이 0명입니다. 조건을 조정한 뒤 다시 확인해 주세요.';
  const top = segments[0];
  const segText = top ? ` (최다 ${top.segment} ${top.count.toLocaleString()}명, ${Math.round(top.pct * 100)}%)` : '';
  const cntText = capped ? `${matched.toLocaleString()}명 이상` : `${matched.toLocaleString()}명`;
  const parts = [
    `트리거 매칭 ${cntText}${segText}`,
    `예상 발송 ${projection.totalEstimatedSends.toLocaleString()}건`,
    `예상 비용 ${projection.totalEstimatedCost.toLocaleString()}원`,
  ];
  if (projection.estimatedRevenue != null) parts.push(`예상 매출 ${projection.estimatedRevenue.toLocaleString()}원`);
  return parts.join(' · ');
}
