/**
 * ★ CT: AI Operator 성과 추정 — 완전 데이터 기반 3계층 엔진 (D227+ 2026-05-31, 전면 재설계)
 *
 * 사고 배경 (임의 상수 3회 반복 투입)
 *   1차: 전 회사 동일 하드코딩(전환 0.8% × 객단가 5만) → "VIP 50만" 사고.
 *   2차: CVR 상한 0.5 + CTR=전환×3 → "1300발송 클릭 1900"(CTR 150%) 사고.
 *   3차: 구매력 모델 CVR 상한 10% + uplift 1.4 + window 3일 → 월2회+ 전부 상한 포화 + ROI 38950%.
 *   = 매번 "보수적 하한"이라며 임의 상수를 넣은 게 근본 위반.
 *
 * 본 재설계 — 임의 상수 0. 그 회사 실제 고객 데이터에서 도출.
 *   Layer 1: 등급별 cdp 실측 (grade-conversion-stats — 발송 후 구매 실측 전환율, 표본 충분 시)
 *   Layer 2: 등급별 구매주기 (created_at ÷ purchase_count → 포아송 자연구매확률, 실측 부족 시 주력)
 *   Layer 3: insufficient_data (둘 다 부족 → 가짜 숫자 X, "데이터 필요" 정직 안내)
 *
 * 상수 정책
 *   - 전환율/클릭률/uplift 임의 상수 전부 제거.
 *   - window = 사용자 행사기간 입력 / 없으면 7일(attribution 표준 측정 정의).
 *   - uplift = 등급 실측 cvr ÷ 자연구매율로 도출 / 도출 불가 시 1.0(자연구매확률 하한, 정직).
 *   - HARD_RATE_GUARD = 이상치 방어 최후 게이트(0.6) — 정상 흐름 미개입(상한 포화 = 산식 결함).
 *   - 클릭 추적(단축URL) 미연동 → 클릭률 = 전환율 하한(전환 ≤ 클릭 물리법칙 보장).
 *
 * 영구 원칙: 등급 차등 1급 차원 + 회사 격리(company_id) + 기존 CT 재사용.
 */

export type EstimateBasisLevel = 'grade_actual' | 'purchase_cycle' | 'campaign_actual' | 'insufficient_data';

// ───────────────────────────────────────────────────────────
// 측정 정의 + 이상치 방어 (임의 전환 계수 아님)
// ───────────────────────────────────────────────────────────
const DEFAULT_EVENT_WINDOW_DAYS = 7;       // 행사기간 미입력 시 — attribution 표준 측정 윈도우
const HARD_RATE_GUARD = 0.6;               // 이상치 방어 최후 게이트 (정상 흐름은 근처에 가지 않음)
const CAMPAIGN_ACTUAL_MIN_SENT = 1000;     // 회사 전체 실측 표본 신뢰 기준 (발송 누적)
const CAMPAIGN_ACTUAL_MIN_CAMPAIGNS = 3;   // 회사 전체 실측 표본 신뢰 기준 (캠페인 수)
const CYCLE_COVERAGE_MEDIUM = 0.7;         // 구매주기 데이터 커버리지 medium 기준

export interface GradeStat {
  grade: string;
  count: number;               // 타겟 중 이 등급 수
  avgCycleDays: number | null; // 평균 구매주기(일) = 생애일수 ÷ 구매횟수. null = 구매 데이터 없음
  activeRatio: number;         // 최근 90일 구매 비율 (0~1)
  aov: number;                 // 등급 평균 객단가
  actualCvr: number | null;    // 등급별 cdp 실측 전환율 (Layer 1). null = 표본 부족
  actualSampleOk: boolean;     // cdp 실측 표본 충분 여부
}

export interface GradeBreakdown {
  grade: string;
  count: number;
  conversionRate: number;
  expectedConversions: number;
  expectedRevenue: number;
  source: 'actual' | 'cycle';
}

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
    eventWindowDays: number;
    gradeBreakdown?: GradeBreakdown[];
  };
}

export interface ComputeInput {
  count: number;
  unitCost: number;
  eventWindowDays: number | null;  // 사용자 행사기간 — null = 기본 7일
  uplift: number | null;           // 실측 도출 uplift — null = 1.0 (자연구매확률 하한)
  gradeStats: GradeStat[];         // 등급별 분리 통계 (Layer 1/2)
  companyActual: {                 // 회사 전체 발송 실측 (Layer 3 campaign_actual)
    totalSent: number;
    purchase7d: number;
    revenuePerMsg: number;
    totalCampaigns: number;
    hasCdpData: boolean;
  } | null;
  fallbackAvgRevenue: number;      // 등급 객단가 비었을 때 표시용 fallback
}

/** 0~max 범위로 clamp (NaN/Infinity 방어) */
function clamp(v: number, min: number, max: number): number {
  if (!isFinite(v) || isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * 순수 계산 — DB 무관. 입력만으로 3계층 성과 추정 + 근거 산출.
 * 물리 법칙(전환 ≤ 클릭 ≤ 발송, 비율 ≤ 이상치 가드)을 마지막에 강제.
 */
export function computeEstimate(input: ComputeInput): PerformanceEstimate {
  const { count, unitCost, gradeStats, companyActual, fallbackAvgRevenue } = input;
  const estimatedCost = Math.round(count * unitCost);
  const eventWindowDays = (input.eventWindowDays && input.eventWindowDays > 0)
    ? input.eventWindowDays : DEFAULT_EVENT_WINDOW_DAYS;
  const upliftFactor = (input.uplift && input.uplift > 0) ? input.uplift : 1.0;

  const notes: string[] = [];

  // ── 등급별 cvr 계산 (Layer 1 실측 우선 → Layer 2 구매주기) ──
  let hasActual = false;
  let dataCount = 0;        // 추정 가능(데이터 있는) 등급의 타겟 합
  let totalGradeCount = 0;  // 전 등급 타겟 합
  const breakdown: GradeBreakdown[] = [];

  for (const g of gradeStats || []) {
    if (!g || g.count <= 0) continue;
    totalGradeCount += g.count;

    let cvr: number | null = null;
    let source: 'actual' | 'cycle' | null = null;

    if (g.actualCvr != null && isFinite(g.actualCvr) && g.actualCvr >= 0 && g.actualSampleOk) {
      // Layer 1 — 등급별 발송 후 구매 실측 (상수 0)
      cvr = g.actualCvr;
      source = 'actual';
      hasActual = true;
    } else if (g.avgCycleDays != null && isFinite(g.avgCycleDays) && g.avgCycleDays > 0) {
      // Layer 2 — 구매주기 포아송: 행사기간 내 1회 이상 자연 구매 확률 × 최근 활성도 × uplift
      const lambda = eventWindowDays / g.avgCycleDays;
      const naturalProb = 1 - Math.exp(-lambda);
      const activeRatio = clamp(g.activeRatio, 0, 1);
      cvr = naturalProb * activeRatio * upliftFactor;
      source = 'cycle';
    }

    if (cvr == null || source == null) continue; // 데이터 없는 등급 — 추정 제외 (가짜 숫자 X)

    cvr = clamp(cvr, 0, HARD_RATE_GUARD);
    const conv = Math.min(g.count, Math.round(g.count * cvr));
    const aov = g.aov > 0 ? g.aov : (fallbackAvgRevenue || 0);
    const revenue = Math.round(conv * aov);
    dataCount += g.count;
    breakdown.push({ grade: g.grade, count: g.count, conversionRate: cvr, expectedConversions: conv, expectedRevenue: revenue, source });
  }

  // ── basis 판정 + 전체 집계 ──
  let level: EstimateBasisLevel;
  let label: string;
  let confidence: 'high' | 'medium' | 'low';
  let conversionRate = 0;
  let expectedConversions = 0;
  let expectedRevenue = 0;

  if (breakdown.length > 0 && dataCount > 0) {
    expectedConversions = breakdown.reduce((s, b) => s + b.expectedConversions, 0);
    expectedRevenue = breakdown.reduce((s, b) => s + b.expectedRevenue, 0);
    conversionRate = count > 0 ? expectedConversions / count : 0;

    const actualWeight = breakdown.filter((b) => b.source === 'actual').reduce((s, b) => s + b.count, 0);
    if (hasActual && actualWeight >= dataCount * 0.5) {
      level = 'grade_actual';
      label = '등급별 발송 후 구매 실측 기반';
      confidence = 'high';
      const ag = breakdown.filter((b) => b.source === 'actual').map((b) => b.grade).join('·');
      notes.push(`${ag} 등급 과거 발송 후 ${eventWindowDays}일 내 실측 전환율 적용`);
    } else {
      level = 'purchase_cycle';
      label = '등급별 구매주기 기반 추정';
      const coverage = totalGradeCount > 0 ? dataCount / totalGradeCount : 0;
      confidence = coverage >= CYCLE_COVERAGE_MEDIUM ? 'medium' : 'low';
      notes.push(`등급별 평균 구매주기로 ${eventWindowDays}일 행사기간 내 구매 확률 산출 (${breakdown.length}개 등급)`);
      if (upliftFactor === 1.0) {
        notes.push('메시지 증분 효과(uplift)는 발송 후 구매 데이터(CDP)가 쌓이면 자동 반영됩니다');
      }
    }
    if (dataCount < totalGradeCount) {
      notes.push(`타겟 ${totalGradeCount.toLocaleString()}명 중 ${dataCount.toLocaleString()}명만 구매 데이터 보유 — 나머지는 추정에서 제외`);
    }
  } else if (
    companyActual &&
    companyActual.totalSent >= CAMPAIGN_ACTUAL_MIN_SENT &&
    companyActual.totalCampaigns >= CAMPAIGN_ACTUAL_MIN_CAMPAIGNS
  ) {
    const rawCvr = companyActual.purchase7d / companyActual.totalSent;
    if (isFinite(rawCvr) && rawCvr >= 0 && rawCvr <= HARD_RATE_GUARD) {
      level = 'campaign_actual';
      label = `과거 ${companyActual.totalCampaigns}개 캠페인 발송 실측 기반`;
      confidence = 'high';
      conversionRate = rawCvr;
      expectedConversions = Math.min(count, Math.round(count * rawCvr));
      expectedRevenue = Math.round(expectedConversions * (fallbackAvgRevenue || 0));
      notes.push(`최근 발송 ${companyActual.totalSent.toLocaleString()}건 중 ${eventWindowDays}일 내 구매 ${companyActual.purchase7d.toLocaleString()}건 (전환율 ${(rawCvr * 100).toFixed(1)}%)`);
      notes.push('회사 전체 평균 — 등급별 구매 데이터가 쌓이면 등급 차등 예측이 가능합니다');
    } else {
      level = 'insufficient_data';
      label = '정확한 예측을 위해 고객 구매 데이터(구매횟수·구매일·등급)가 필요합니다';
      confidence = 'low';
      notes.push('과거 실측 전환율이 비현실 범위(오염)로 자동 폐기되었습니다');
    }
  } else {
    level = 'insufficient_data';
    label = '정확한 예측을 위해 고객 구매 데이터(구매횟수·구매일·등급)가 필요합니다';
    confidence = 'low';
    notes.push('타겟 고객의 구매횟수·구매일·등급 데이터가 부족해 정량 추정을 생략했습니다');
    notes.push('CDP 연동 또는 고객 구매 데이터 입력 시 등급별 정밀 예측이 활성화됩니다');
  }

  // ── 매출 보정 (cdp 실측 매출/건 — 등급 추정치의 ±3배 범위 내일 때만 채택, 폭주 방지) ──
  if (level !== 'insufficient_data' && companyActual && companyActual.hasCdpData && companyActual.revenuePerMsg > 0) {
    const cdpRevenue = Math.round(count * companyActual.revenuePerMsg);
    if (expectedRevenue > 0 && cdpRevenue <= expectedRevenue * 3 && cdpRevenue >= Math.round(expectedRevenue / 3)) {
      expectedRevenue = cdpRevenue;
    }
  }

  // ── 물리 법칙 강제 (최후 게이트) ──
  conversionRate = clamp(conversionRate, 0, HARD_RATE_GUARD);
  const clickRate = conversionRate; // 단축URL 클릭 추적 미연동 → 클릭률 = 전환율 하한 (전환 ≤ 클릭 보장)
  const expectedClicks = Math.min(count, Math.round(count * clickRate));
  expectedConversions = Math.min(expectedClicks, expectedConversions);
  if (level === 'insufficient_data') {
    expectedConversions = 0;
    expectedRevenue = 0;
  }

  // ── 표시용 평균 객단가 (등급 가중 또는 fallback) ──
  let avgRevenue = fallbackAvgRevenue || 0;
  if (breakdown.length > 0) {
    const totalConv = breakdown.reduce((s, b) => s + b.expectedConversions, 0);
    const totalRev = breakdown.reduce((s, b) => s + b.expectedRevenue, 0);
    avgRevenue = totalConv > 0 ? Math.round(totalRev / totalConv) : (fallbackAvgRevenue || 0);
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
    basis: {
      level,
      label,
      confidence,
      notes,
      eventWindowDays,
      gradeBreakdown: breakdown.length > 0 ? breakdown : undefined,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// DB 연동 — 등급별 타겟 프로필 (구매주기 + 객단가 + 활성도)
// 컬럼 검증 완료(information_schema): grade/avg_order_value/total_purchase_amount/purchase_count/recent_purchase_date/created_at/is_active/company_id
// ═══════════════════════════════════════════════════════════

import { query } from '../config/database';
import { buildFilterWhereClauseCompat } from './customer-filter';
import { buildCampaignAttribution } from './campaign-response-attribution';
import { fetchGradeConversionStats, GradeConversionStat } from './grade-conversion-stats';

export interface GradeProfileRow {
  grade: string;
  count: number;
  aov: number;                 // 등급 평균 객단가
  avgCycleDays: number | null; // 생애일수 ÷ 구매횟수 (구매이력 있는 고객 평균). null = 구매 데이터 없음
  activeRatio: number;         // 최근 90일 구매 비율
}

/**
 * 타겟 filters로 매칭된 고객을 등급별로 분리 집계 (Layer 2 구매주기 데이터).
 * - 구매주기: AVG(생애일수 ÷ purchase_count) — purchase_count>0 인 고객만 평균 (구매이력 없으면 주기 정의 불가)
 * - 객단가: AVG(avg_order_value) 우선, 없으면 AVG(total_purchase_amount ÷ purchase_count)
 * - 활성도: 최근 90일 구매 비율 (등급 전체 기준 — 구매이력 없는 고객 자연 하향)
 * - 빈 grade는 '(미분류)'로 묶음. buildFilterWhereClauseCompat 재사용($1=companyId, filters는 $2부터)
 */
export async function fetchTargetProfileByGrade(
  companyId: string,
  filters: Record<string, any>,
  // ⛔ 2026-08-03 3R 정정: 계약(세그먼트) 제안은 filters가 비어 있다. 그대로 두면 등급·객단가 프로파일이
  //   전체 활성 고객 기준으로 잡혀 "대상 수는 VIP 20명인데 기대 성과는 1만명 기준"이 된다.
  //   컴파일된 조건을 받으면 그것을 쓴다($1=companyId 전제로 이미 $2부터 매겨져 있어 배치가 같다).
  targetWhere?: { sql: string; params: any[] } | null,
): Promise<GradeProfileRow[]> {
  const compiled = targetWhere && typeof targetWhere.sql === 'string'
    ? { sql: targetWhere.sql, params: targetWhere.params || [] }
    : buildFilterWhereClauseCompat(filters, 2);
  const { sql: filterWhere, params: filterParams } = compiled;
  const r = await query(
    `SELECT
        COALESCE(NULLIF(TRIM(c.grade), ''), '(미분류)')                                AS grade,
        COUNT(*)::int                                                                  AS n,
        COALESCE(
          AVG(NULLIF(c.avg_order_value, 0)),
          AVG(CASE WHEN COALESCE(c.purchase_count, 0) > 0
                   THEN c.total_purchase_amount / c.purchase_count END),
          0
        )::float                                                                       AS aov,
        AVG(CASE WHEN COALESCE(c.purchase_count, 0) > 0 AND c.created_at IS NOT NULL
                 THEN GREATEST(1.0, EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 86400.0) / c.purchase_count
            END)::float                                                                AS avg_cycle_days,
        AVG(CASE WHEN c.recent_purchase_date >= CURRENT_DATE - INTERVAL '90 days'
                 THEN 1.0 ELSE 0.0 END)::float                                          AS active_ratio
      FROM customers c
      WHERE ${targetWhere ? filterWhere : `c.company_id = $1::uuid AND c.is_active = true ${filterWhere}`}
      GROUP BY COALESCE(NULLIF(TRIM(c.grade), ''), '(미분류)')`,
    [companyId, ...filterParams],
  );
  return r.rows.map((row: any) => ({
    grade: String(row.grade),
    count: Number(row.n) || 0,
    aov: Math.round(Number(row.aov) || 0),
    avgCycleDays: row.avg_cycle_days != null ? Number(row.avg_cycle_days) : null,
    activeRatio: Number(row.active_ratio) || 0,
  }));
}

// ═══════════════════════════════════════════════════════════
// 메인 진입점 — 등급별 프로필 + 등급 실측 + 회사 전체 실측 조합 → computeEstimate
// ═══════════════════════════════════════════════════════════

export interface EstimateInput {
  companyId: string;
  filters: Record<string, any>;
  count: number;
  channel: string;
  unitCost: number;
  fallbackAvgRevenue: number;      // 전체 고객 평균 (customerStats.avg_total_spent)
  eventWindowDays?: number | null; // 사용자 행사기간 (옵션 — 없으면 7일)
  /**
   * ⛔ 2026-08-03 3R 정정: 세그먼트 계약으로 뽑은 제안은 filters가 비어 있다. 대상 수와 기대 성과의
   * 근거가 갈리지 않도록, 대상 판정에 실제로 쓰인 조건을 그대로 받는다(미전달 = filters 사용, 종전 동작).
   */
  targetWhere?: { sql: string; params: any[] } | null;
}

/**
 * AI Operator 성과 추정 메인. orchestrate/orchestrateWithAI가 호출.
 * 실패 시 부분 데이터로 graceful degrade (발송 차단 X — 추정은 보조 정보).
 */
export async function estimatePerformance(input: EstimateInput): Promise<PerformanceEstimate> {
  const { companyId, filters, count, unitCost, fallbackAvgRevenue } = input;
  const windowDays = (input.eventWindowDays && input.eventWindowDays > 0) ? input.eventWindowDays : DEFAULT_EVENT_WINDOW_DAYS;

  // 1) 등급별 타겟 프로필 (구매주기 + 객단가 + 활성도)
  let gradeProfiles: GradeProfileRow[] = [];
  try {
    gradeProfiles = await fetchTargetProfileByGrade(companyId, filters, input.targetWhere);
  } catch (e: any) {
    console.log('[estimator] fetchTargetProfileByGrade skip:', e?.message || e);
  }

  // 2) 등급별 cdp 실측 (Layer 1 — 표본 충분 시. cdp purchase 0이면 자동 강등)
  const targetGrades = gradeProfiles.map((g) => g.grade).filter((g) => g && g !== '(미분류)');
  let gradeActual = new Map<string, GradeConversionStat>();
  if (targetGrades.length > 0) {
    try {
      gradeActual = await fetchGradeConversionStats(companyId, targetGrades, windowDays);
    } catch (e: any) {
      console.log('[estimator] fetchGradeConversionStats skip:', e?.message || e);
    }
  }

  // 3) uplift 자동 도출 — 등급 실측 cvr ÷ 그 등급 자연구매율. 도출 불가 시 null → computeEstimate 1.0
  const upliftSamples: number[] = [];
  for (const gp of gradeProfiles) {
    const act = gradeActual.get(gp.grade);
    if (act && act.sampleOk && gp.avgCycleDays && gp.avgCycleDays > 0) {
      const lambda = windowDays / gp.avgCycleDays;
      const natural = (1 - Math.exp(-lambda)) * clamp(gp.activeRatio, 0, 1);
      if (natural > 0 && act.cvr > 0) upliftSamples.push(act.cvr / natural);
    }
  }
  const uplift = upliftSamples.length > 0
    ? upliftSamples.reduce((s, v) => s + v, 0) / upliftSamples.length
    : null;

  // 4) gradeStats 조립 (구매주기 + 등급 실측 병합)
  const gradeStats: GradeStat[] = gradeProfiles.map((gp) => {
    const act = gradeActual.get(gp.grade);
    return {
      grade: gp.grade,
      count: gp.count,
      avgCycleDays: gp.avgCycleDays,
      activeRatio: gp.activeRatio,
      aov: gp.aov,
      actualCvr: act ? act.cvr : null,
      actualSampleOk: act ? act.sampleOk : false,
    };
  });

  // 5) 회사 전체 발송 실측 (Layer 3 fallback — 등급/구매주기 둘 다 부족할 때만 사용)
  let companyActual: ComputeInput['companyActual'] = null;
  try {
    const attr = await buildCampaignAttribution(companyId, 90);
    if (attr.totalCampaigns >= 1 && attr.totalSent > 0) {
      const w7 = attr.windows.find((w) => w.windowLabel === '7d');
      const purchase7d = w7 ? (attr.hasCdpData ? w7.cdpPurchaseCount : w7.customerPurchaseCount) : 0;
      const revenuePerMsg = (attr.hasCdpData && w7 && attr.totalSent > 0) ? (w7.cdpRevenue / attr.totalSent) : 0;
      companyActual = {
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

  return computeEstimate({
    count,
    unitCost,
    eventWindowDays: input.eventWindowDays ?? null,
    uplift,
    gradeStats,
    companyActual,
    fallbackAvgRevenue: fallbackAvgRevenue || 0,
  });
}
