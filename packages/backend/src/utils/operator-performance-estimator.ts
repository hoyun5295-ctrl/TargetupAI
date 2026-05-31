/**
 * ★ CT: AI Operator 성과 추정 — 타겟 실데이터 + 과거 캠페인 실측 기반 (D227+ 2026-05-31)
 *
 * 사고 배경
 *   옛 ai-orchestrator.ts calculateCostROI = 전 회사·전 타겟 동일 하드코딩
 *   (클릭 3% × 전환 0.8% × 객단가 5만원). VIP(누적구매 수천만원) 타겟에 "매출 50만원"
 *   같은 비현실 수치 노출 → 돈 내는 AI Operator가 진단값을 못 함.
 *
 * 본 컨트롤타워
 *   1. 객단가 = 타겟 filters 매칭 고객의 실제 avg_order_value 평균 (fetchTargetProfile)
 *   2. 전환율 = 3단계: 과거 캠페인 실측 → 타겟 구매성향 보정 → 보수적 하한
 *   3. 추정 근거(basis) + 신뢰도 노출 → 깡통 숫자 X
 *
 * 영구 원칙
 *   - 등급 하드코딩(VIP=×3) 금지 — 타겟군 실제 구매빈도/최근성 지표로 산출
 *   - 회사 격리(company_id) + 기존 함수 재사용(buildFilterWhereClauseCompat / buildCampaignAttribution)
 */

import { query } from '../config/database';
import { buildFilterWhereClauseCompat } from './customer-filter';
import { buildCampaignAttribution } from './campaign-response-attribution';

export type EstimateBasisLevel = 'campaign_actual' | 'target_profile' | 'low_data';

export interface PerformanceEstimate {
  cost: { estimated: number; unitCost: number; breakdown: string };
  performance: {
    expectedClicks: number;
    expectedConversions: number;
    expectedRevenue: number;
    clickRate: number;
    conversionRate: number;
    avgRevenue: number;
    roi: number;
  };
  basis: {
    level: EstimateBasisLevel;
    label: string;
    confidence: 'high' | 'medium' | 'low';
    notes: string[];
  };
}

// 보수적 하한 — campaign_actual 실측이 없을 때만 base로 사용. 실측이 쌓이면 자동 1단계 승급.
const BASE_CLICK_RATE = 0.02;
const BASE_CONVERSION_RATE = 0.005;
const ACTUAL_MIN_SENT = 100; // 과거 실측 신뢰 임계 발송수
const MAX_ACTUAL_CVR = 0.5;  // 실측 전환율 상한 (이상치 방어)
const MAX_PROFILE_CVR = 0.3; // 보정 전환율 상한

export interface ComputeInput {
  count: number;
  unitCost: number;
  avgRevenue: number; // 타겟 실제 객단가 (fetchTargetProfile)
  actual: {
    totalSent: number;
    purchase7d: number;
    revenuePerMsg: number;
    totalCampaigns: number;
    hasCdpData: boolean;
  } | null;
  targetProfile: { avgPurchaseCount: number; activeRatio: number } | null;
}

/**
 * 순수 계산 — DB 무관. 입력만으로 성과 추정 + 근거 산출.
 */
export function computeEstimate(input: ComputeInput): PerformanceEstimate {
  const { count, unitCost, avgRevenue, actual, targetProfile } = input;
  const estimatedCost = Math.round(count * unitCost);

  let clickRate = BASE_CLICK_RATE;
  let conversionRate = BASE_CONVERSION_RATE;
  let level: EstimateBasisLevel = 'low_data';
  let label = '데이터 부족 — 보수적 추정';
  let confidence: 'high' | 'medium' | 'low' = 'low';
  const notes: string[] = [];

  if (actual && actual.totalSent >= ACTUAL_MIN_SENT && actual.totalCampaigns >= 1) {
    // 1단계: 과거 실측 (가장 정확)
    conversionRate = Math.min(MAX_ACTUAL_CVR, actual.purchase7d / actual.totalSent);
    clickRate = Math.max(conversionRate * 3, BASE_CLICK_RATE); // 클릭 실측 없음 → 전환의 3배 추정
    level = 'campaign_actual';
    label = `과거 ${actual.totalCampaigns}개 캠페인 실측 기반`;
    confidence = 'high';
    notes.push(`최근 발송 ${actual.totalSent.toLocaleString()}건 중 7일 내 구매 ${actual.purchase7d.toLocaleString()}건`);
  } else if (targetProfile) {
    // 2단계: 타겟 구매성향 보정 (등급 하드코딩 X — 실제 지표 기반)
    const repeatFactor = Math.min(3, 1 + (targetProfile.avgPurchaseCount - 1) * 0.5); // 1회=1.0 / 3회=2.0 / 5회=3.0(cap)
    const activeFactor = 0.5 + targetProfile.activeRatio;                              // 활성 0%=0.5 / 100%=1.5
    conversionRate = Math.min(MAX_PROFILE_CVR, BASE_CONVERSION_RATE * repeatFactor * activeFactor);
    clickRate = Math.max(conversionRate * 3, BASE_CLICK_RATE);
    level = 'target_profile';
    label = '타겟 고객 구매성향 기반 추정';
    confidence = 'medium';
    notes.push(`타겟 평균 구매 ${targetProfile.avgPurchaseCount.toFixed(1)}회 · 최근 활성 ${Math.round(targetProfile.activeRatio * 100)}%`);
  } else {
    notes.push('과거 캠페인·타겟 구매 데이터 부족 — 발송이 쌓이면 정확해집니다');
  }

  const expectedClicks = Math.round(count * clickRate);
  const expectedConversions = Math.round(count * conversionRate);
  // 매출 = 실측 매출/건(CDP 연동)이 있으면 우선, 없으면 전환수 × 타겟 객단가
  const expectedRevenue = actual && actual.hasCdpData && actual.revenuePerMsg > 0
    ? Math.round(count * actual.revenuePerMsg)
    : Math.round(expectedConversions * avgRevenue);
  const roi = estimatedCost > 0 ? Math.round((expectedRevenue / estimatedCost) * 100) : 0;

  return {
    cost: {
      estimated: estimatedCost,
      unitCost,
      breakdown: `${count.toLocaleString()}건 × ${unitCost.toLocaleString()}원`,
    },
    performance: {
      expectedClicks,
      expectedConversions,
      expectedRevenue,
      clickRate,
      conversionRate,
      avgRevenue,
      roi,
    },
    basis: { level, label, confidence, notes },
  };
}

// ═══════════════════════════════════════════════════════════
// DB 연동 — 타겟 객단가 + 구매성향 (컬럼 검증 완료: avg_order_value/total_purchase_amount/purchase_count/recent_purchase_date)
// ═══════════════════════════════════════════════════════════

interface TargetProfileResult {
  avgRevenue: number;        // 타겟 실제 객단가
  avgPurchaseCount: number;  // 타겟 평균 구매횟수
  activeRatio: number;       // 최근 90일 구매 비율 (0~1)
}

/**
 * 타겟 filters로 매칭된 고객의 실제 객단가 + 구매성향 조회.
 * - 객단가: AVG(avg_order_value) 우선, 비어있으면 AVG(total_purchase_amount/purchase_count) fallback
 * - buildFilterWhereClauseCompat로 타겟 WHERE 재사용 ($1=companyId, filters는 $2부터)
 */
export async function fetchTargetProfile(
  companyId: string,
  filters: Record<string, any>,
): Promise<TargetProfileResult> {
  const { sql: filterWhere, params: filterParams } = buildFilterWhereClauseCompat(filters, 2);
  const r = await query(
    `SELECT
        AVG(NULLIF(c.avg_order_value, 0))                                              AS aov,
        AVG(CASE WHEN COALESCE(c.purchase_count, 0) > 0
                 THEN c.total_purchase_amount / c.purchase_count END)                  AS aov_fallback,
        AVG(COALESCE(c.purchase_count, 0))::float                                      AS avg_pc,
        AVG(CASE WHEN c.recent_purchase_date >= CURRENT_DATE - INTERVAL '90 days'
                 THEN 1.0 ELSE 0.0 END)::float                                         AS active_ratio
      FROM customers c
      WHERE c.company_id = $1::uuid AND c.is_active = true ${filterWhere}`,
    [companyId, ...filterParams],
  );
  const row = r.rows[0] || {};
  const aov = Number(row.aov) > 0 ? Number(row.aov) : (Number(row.aov_fallback) || 0);
  return {
    avgRevenue: Math.round(aov),
    avgPurchaseCount: Number(row.avg_pc) || 0,
    activeRatio: Number(row.active_ratio) || 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 메인 진입점 — 타겟 프로필 + 과거 실측 조합 → computeEstimate
// ═══════════════════════════════════════════════════════════

export interface EstimateInput {
  companyId: string;
  filters: Record<string, any>;
  count: number;
  channel: string;
  unitCost: number;
  fallbackAvgRevenue: number; // 전체 고객 평균 (customerStats.avg_total_spent)
}

/**
 * AI Operator 성과 추정 메인. orchestrate/orchestrateWithAI가 calculateCostROI 대신 호출.
 * 실패 시 부분 데이터로 graceful degrade (발송 차단 X — 추정은 보조 정보).
 */
export async function estimatePerformance(input: EstimateInput): Promise<PerformanceEstimate> {
  const { companyId, filters, count, unitCost, fallbackAvgRevenue } = input;

  // 1) 타겟 프로필 (객단가 + 구매성향)
  let profile: TargetProfileResult | null = null;
  try {
    profile = await fetchTargetProfile(companyId, filters);
  } catch (e: any) {
    console.log('[estimator] fetchTargetProfile skip:', e?.message || e);
  }

  const avgRevenue = (profile && profile.avgRevenue > 0) ? profile.avgRevenue : (fallbackAvgRevenue || 0);

  // 2) 과거 실측 (90일)
  let actual: ComputeInput['actual'] = null;
  try {
    const attr = await buildCampaignAttribution(companyId, 90);
    if (attr.totalCampaigns >= 1 && attr.totalSent > 0) {
      const w7 = attr.windows.find((w) => w.windowLabel === '7d');
      const purchase7d = w7 ? (attr.hasCdpData ? w7.cdpPurchaseCount : w7.customerPurchaseCount) : 0;
      const revenuePerMsg = (attr.hasCdpData && w7 && attr.totalSent > 0) ? (w7.cdpRevenue / attr.totalSent) : 0;
      actual = {
        totalSent: attr.totalSent,
        purchase7d,
        revenuePerMsg,
        totalCampaigns: attr.totalCampaigns,
        hasCdpData: attr.hasCdpData,
      };
    }
  } catch (e: any) {
    console.log('[estimator] buildCampaignAttribution skip:', e?.message || e);
  }

  // 3) 순수 계산
  const targetProfile = profile
    ? { avgPurchaseCount: profile.avgPurchaseCount, activeRatio: profile.activeRatio }
    : null;
  return computeEstimate({ count, unitCost, avgRevenue, actual, targetProfile });
}
