/**
 * ★ CT: AI Operator 성과 추정 — 마케팅 퍼널 모델 (D227+ 2026-05-31, 산식 재설계)
 *
 * 사고 배경
 *   1차 사고: 옛 calculateCostROI = 전 회사·전 타겟 동일 하드코딩(전환 0.8% × 객단가 5만원).
 *   2차 사고: 1차 fix가 buildCampaignAttribution의 purchase_count(발송 인과 무관 그 기간 전체
 *             구매 이벤트 COUNT)를 totalSent로 나눠 "전환율"로 오해. 테스트 계정(발송 적은데
 *             구매 카운트 큼)에서 CVR 50% cap + CTR 150%(전환의 3배) 사고 → 1300발송에 클릭 1900.
 *
 * 본 재설계 — 마케팅 퍼널 물리 법칙
 *   발송(count) → 도달 → 클릭(CTR) → 전환(CVR). 각 단계는 이전 단계의 부분집합.
 *   불변 제약(어떤 입력에도 절대 위반 불가):
 *     · 0 ≤ clickRate ≤ CTR_REALISTIC_MAX (≤ 1)
 *     · 0 ≤ conversionRate ≤ clickRate   (전환은 클릭 부분집합)
 *     · expectedConversions ≤ expectedClicks ≤ count
 *   과거 실측은 "현실 범위"일 때만 신뢰. 오염(구매>발송 등 비현실)이면 버리고 target_profile 강등.
 *
 * 영구 원칙
 *   - 등급 하드코딩 금지 — 타겟군 실제 구매빈도/최근성 지표 기반
 *   - 회사 격리(company_id) + 기존 함수 재사용
 */

export type EstimateBasisLevel = 'campaign_actual' | 'target_profile' | 'low_data';

// ───────────────────────────────────────────────────────────
// 마케팅 현실 상한 (SMS/LMS 단축URL 기준 — 이 범위를 넘는 실측은 오염으로 간주)
// ───────────────────────────────────────────────────────────
export const CTR_REALISTIC_MAX = 0.15;  // 클릭률 현실 상한 15%
export const CVR_REALISTIC_MAX = 0.10;  // 전환율 현실 상한 10%

// 보수적 하한 — 실측/프로필 데이터 없을 때 base
const BASE_CLICK_RATE = 0.02;
const BASE_CONVERSION_RATE = 0.004;

// 클릭 대비 전환 비율 (구매한 사람은 보통 클릭의 일부) — 클릭 실측이 없을 때 전환율 = 클릭률 × 이 비율
const CONV_PER_CLICK = 0.25;

// 과거 실측 신뢰 조건 (둘 다 충족해야 campaign_actual 채택)
const ACTUAL_MIN_SENT = 1000;       // 누적 발송 1000건+ (표본 신뢰)
const ACTUAL_MIN_CAMPAIGNS = 3;     // 캠페인 3건+

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

export interface ComputeInput {
  count: number;
  unitCost: number;
  avgRevenue: number; // 타겟 실제 객단가 (fetchTargetProfile)
  actual: {
    totalSent: number;
    purchase7d: number;   // 발송 후 7일 내 구매 이벤트 COUNT (발송 인과 보장 X — 검증 필요)
    revenuePerMsg: number;
    totalCampaigns: number;
    hasCdpData: boolean;
  } | null;
  targetProfile: { avgPurchaseCount: number; activeRatio: number } | null;
}

/** 0~max 범위로 clamp */
function clamp(v: number, min: number, max: number): number {
  if (!isFinite(v) || isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * 순수 계산 — DB 무관. 입력만으로 퍼널 모델 성과 추정 + 근거 산출.
 * 물리 법칙(CTR/CVR 현실 상한, 전환 ≤ 클릭)을 마지막에 강제 적용.
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

  // ── 과거 실측 신뢰 판정 ──
  // 실측 전환율(발송 대비) 후보. 단 purchase_count는 발송 인과 보장 X →
  //   현실 범위(≤ CVR_REALISTIC_MAX)일 때만 신뢰. 넘으면 오염으로 보고 버림.
  let actualUsable = false;
  if (actual && actual.totalSent >= ACTUAL_MIN_SENT && actual.totalCampaigns >= ACTUAL_MIN_CAMPAIGNS) {
    const rawCvr = actual.purchase7d / actual.totalSent;
    if (isFinite(rawCvr) && rawCvr >= 0 && rawCvr <= CVR_REALISTIC_MAX) {
      actualUsable = true;
      conversionRate = rawCvr;
      // 클릭 실측 없음 → 전환은 클릭의 일부라는 역산: clickRate = CVR / CONV_PER_CLICK
      clickRate = conversionRate / CONV_PER_CLICK;
      level = 'campaign_actual';
      label = `과거 ${actual.totalCampaigns}개 캠페인 실측 기반`;
      confidence = 'high';
      notes.push(`최근 발송 ${actual.totalSent.toLocaleString()}건 중 7일 내 구매 ${actual.purchase7d.toLocaleString()}건 (전환율 ${(rawCvr * 100).toFixed(1)}%)`);
    }
  }

  if (!actualUsable && targetProfile) {
    // 2단계: 타겟 구매성향 보정 (등급 하드코딩 X — 실제 지표 기반)
    // 클릭률을 먼저 추정하고, 전환율 = 클릭률 × CONV_PER_CLICK (퍼널 순서 보장)
    const repeatFactor = clamp(1 + (targetProfile.avgPurchaseCount - 1) * 0.3, 1, 2.5); // 1회=1.0 / 6회=2.5(cap)
    const activeFactor = clamp(0.5 + targetProfile.activeRatio, 0.5, 1.5);              // 활성 0%=0.5 / 100%=1.5
    clickRate = BASE_CLICK_RATE * repeatFactor * activeFactor;
    conversionRate = clickRate * CONV_PER_CLICK;
    level = 'target_profile';
    label = '타겟 고객 구매성향 기반 추정';
    confidence = 'medium';
    notes.push(`타겟 평균 구매 ${targetProfile.avgPurchaseCount.toFixed(1)}회 · 최근 활성 ${Math.round(targetProfile.activeRatio * 100)}%`);
  } else if (!actualUsable && !targetProfile) {
    clickRate = BASE_CLICK_RATE;
    conversionRate = BASE_CONVERSION_RATE;
    notes.push('과거 캠페인·타겟 구매 데이터 부족 — 발송이 쌓이면 정확해집니다');
  }

  // ── 물리 법칙 강제 (어떤 경로든 마지막 게이트) ──
  clickRate = clamp(clickRate, 0, CTR_REALISTIC_MAX);            // 0 ≤ CTR ≤ 현실상한
  conversionRate = clamp(conversionRate, 0, clickRate);          // 0 ≤ CVR ≤ CTR (전환은 클릭 부분집합)
  conversionRate = Math.min(conversionRate, CVR_REALISTIC_MAX);  // CVR 현실상한

  const expectedClicks = Math.min(count, Math.round(count * clickRate));
  const expectedConversions = Math.min(expectedClicks, Math.round(count * conversionRate));

  // 매출 = 전환수 × 타겟 객단가. CDP 실측 매출/건이 현실적이면 우선(단 전환수×객단가 상한 내).
  let expectedRevenue = Math.round(expectedConversions * avgRevenue);
  if (actualUsable && actual && actual.hasCdpData && actual.revenuePerMsg > 0) {
    const cdpRevenue = Math.round(count * actual.revenuePerMsg);
    // CDP 실측 매출이 전환수×객단가의 합리적 범위(±) 안일 때만 채택, 폭주 방지
    if (avgRevenue > 0 && cdpRevenue <= expectedConversions * avgRevenue * 3) {
      expectedRevenue = cdpRevenue;
    }
  }
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

import { query } from '../config/database';
import { buildFilterWhereClauseCompat } from './customer-filter';
import { buildCampaignAttribution } from './campaign-response-attribution';

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
