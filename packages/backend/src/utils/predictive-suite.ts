/**
 * CT-52 utils/predictive-suite.ts (D197 2026-05-22)
 *
 * Phase B-2 Predictive Suite — AI 자율 판단의 핵심 무기
 *
 * 본질: AI가 사용자별 미래 행동을 예측 → Liquid 분기 자동 통합
 *  - 클릭률 (clickScore 0~1)
 *  - 이탈 위험 (churnRisk 0~1)
 *  - 구매 가능성 (purchaseLikelihood 0~1)
 *
 * 사용처:
 *  - journey-executor processExecution → enrichCustomerWithPredictions → Liquid context
 *  - messageUtils replaceVariables → customer 객체 통합
 *  - /predictive 대시보드 페이지 → getCompanyPredictionDistribution
 *  - journey-ai-generator AI 시스템 프롬프트 → 예측 점수 활용 가이드
 *
 * 영구 원칙 정합:
 *  - 회사 격리 (companyId 검증 의무)
 *  - cold start fallback (데이터 부족 신규 회사도 정합)
 *  - 안전 fallback (모델 오류 시 0.5 중립값 + 발송 차단 X)
 *  - caching (cdp_customer_predictions 24h TTL)
 *  - 6,000사+ 운영 영향 0 (predictions 미사용 회사 영향 0)
 */

import { query } from '../config/database';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CustomerPredictions {
  clickScore: number;          // 0~1
  churnRisk: number;            // 0~1
  purchaseLikelihood: number;   // 0~1
  computedAt: Date;
  modelVersion: string;
}

export interface PredictionDistribution {
  histogram: {
    clickScore: HistogramBin[];
    churnRisk: HistogramBin[];
    purchaseLikelihood: HistogramBin[];
  };
  topRiskCustomers: PredictionCustomerRow[];
  topPotentialCustomers: PredictionCustomerRow[];
  modelAccuracy: ModelAccuracy | null;
  totalCustomers: number;
  computedAt: Date | null;
}

export interface HistogramBin {
  range: string;   // '0.0-0.1' / '0.1-0.2' ...
  count: number;
  pct: number;
}

export interface PredictionCustomerRow {
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerGrade: string | null;
  customerRegion: string | null;
  clickScore: number;
  churnRisk: number;
  purchaseLikelihood: number;
  lastActivityDays: number | null;
}

export interface ModelAccuracy {
  clickPredicted: number;
  clickActual: number;
  clickAccuracy: number;        // 옛 예측 0.7+ 영역의 실 클릭률
  conversionPredicted: number;
  conversionActual: number;
  conversionAccuracy: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 안전 상수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NEUTRAL_VALUE = 0.5;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24h
const COLD_START_VERSION = 'v1.0-cold';
const TRAINED_VERSION = 'v1.0-trained';

// 등급별 평균 (cold start fallback)
const GRADE_AVG_CLICK: Record<string, number> = {
  'VIP': 0.32, 'Gold': 0.24, 'Silver': 0.18, '일반': 0.12, '신규': 0.20,
};
const GRADE_AVG_PURCHASE: Record<string, number> = {
  'VIP': 0.28, 'Gold': 0.18, 'Silver': 0.12, '일반': 0.08, '신규': 0.15,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. computePredictions — 단일 customer 예측 점수 계산
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function computePredictions(
  customerId: string,
  companyId: string,
): Promise<CustomerPredictions> {
  try {
    // 1) customer + 옛 활동 데이터 조회 (단일 SQL)
    const r = await query(
      `SELECT
         c.id, c.grade, c.region, c.age, c.purchase_count, c.recent_purchase_date,
         c.total_purchase_amount, c.created_at,
         (SELECT MAX(occurred_at) FROM cdp_events
          WHERE customer_id = c.id AND event_name = 'message_click') AS last_click_at,
         (SELECT COUNT(*) FROM cdp_events
          WHERE customer_id = c.id AND event_name = 'message_click') AS total_clicks,
         (SELECT COUNT(*) FROM cdp_events
          WHERE customer_id = c.id AND event_name IN ('order', 'purchase')) AS total_orders,
         (SELECT COUNT(*) FROM journey_step_logs l
          JOIN journey_executions e ON e.id = l.execution_id
          WHERE e.customer_id = c.id AND l.status = 'sent') AS total_sent
       FROM customers c
       WHERE c.id = $1::uuid AND c.company_id = $2::uuid`,
      [customerId, companyId]
    );

    if (r.rows.length === 0) {
      return neutralPredictions();
    }

    const row = r.rows[0];
    const grade = row.grade || '일반';
    const totalSent = Number(row.total_sent) || 0;
    const totalClicks = Number(row.total_clicks) || 0;
    const totalOrders = Number(row.total_orders) || 0;
    const purchaseCount = Number(row.purchase_count) || 0;

    // 데이터 충분 영역 (trained) vs cold start
    const hasEnoughData = totalSent >= 3;
    const modelVersion = hasEnoughData ? TRAINED_VERSION : COLD_START_VERSION;

    // ─── 클릭률 ─────────────────────────────────────
    let clickScore: number;
    if (hasEnoughData && totalSent > 0) {
      // 실 클릭률 (Beta posterior — Laplace smoothing)
      const alpha = totalClicks + 1;
      const beta = totalSent - totalClicks + 1;
      clickScore = alpha / (alpha + beta);
    } else {
      // Cold start: 등급별 평균 + 마지막 클릭 후 일수 보정
      const base = GRADE_AVG_CLICK[grade] ?? 0.15;
      const lastClickAt = row.last_click_at ? new Date(row.last_click_at) : null;
      const daysSinceClick = lastClickAt
        ? Math.floor((Date.now() - lastClickAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      // 최근 30일 이내 클릭 = 보정 +0.1, 옛 클릭 60일+ = 보정 -0.05
      let adjust = 0;
      if (daysSinceClick !== null) {
        if (daysSinceClick <= 30) adjust = 0.10;
        else if (daysSinceClick >= 60) adjust = -0.05;
      }
      clickScore = clip(base + adjust, 0, 1);
    }

    // ─── 이탈 위험 ─────────────────────────────────
    // Survival sigmoid — 마지막 활동 후 일수 기반
    const recentPurchaseAt = row.recent_purchase_date ? new Date(row.recent_purchase_date) : null;
    const lastClickAtForChurn = row.last_click_at ? new Date(row.last_click_at) : null;
    const lastActivityAt = maxDate(recentPurchaseAt, lastClickAtForChurn) || new Date(row.created_at);
    const daysSinceActivity = Math.floor((Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24));

    // sigmoid(x) = 1 / (1 + e^(-(x - 60)/20))
    // 60일 = 0.5, 90일 = 0.78, 120일 = 0.95
    const churnRisk = clip(sigmoid((daysSinceActivity - 60) / 20), 0, 1);

    // ─── 구매 가능성 ─────────────────────────────────
    let purchaseLikelihood: number;
    if (hasEnoughData && purchaseCount > 0) {
      // 옛 구매 빈도 + 마지막 구매 후 일수 + 직전 클릭 종합
      const purchaseRate = Math.min(purchaseCount / Math.max(totalSent, 1), 1);
      const recencyBoost = daysSinceActivity <= 30 ? 0.15 : daysSinceActivity <= 90 ? 0.05 : -0.10;
      const clickBoost = totalClicks > 0 ? 0.08 : 0;
      purchaseLikelihood = clip(purchaseRate * 0.6 + recencyBoost + clickBoost + 0.20, 0, 1);
    } else {
      // Cold start: 등급별 평균 + 마지막 활동 보정
      const base = GRADE_AVG_PURCHASE[grade] ?? 0.10;
      const recencyBoost = daysSinceActivity <= 30 ? 0.10 : daysSinceActivity <= 90 ? 0 : -0.08;
      purchaseLikelihood = clip(base + recencyBoost, 0, 1);
    }

    return {
      clickScore: round3(clickScore),
      churnRisk: round3(churnRisk),
      purchaseLikelihood: round3(purchaseLikelihood),
      computedAt: new Date(),
      modelVersion,
    };
  } catch (err: any) {
    console.warn('[Predictive] computePredictions 오류, 중립값 fallback:', err?.message);
    return neutralPredictions();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 캐싱 진입점 — cdp_customer_predictions 우선 조회 (없으면 즉시 계산 + 저장)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getOrComputePredictions(
  customerId: string,
  companyId: string,
): Promise<CustomerPredictions> {
  try {
    // 1) cache 조회
    const cacheRes = await query(
      `SELECT click_score, churn_risk, purchase_likelihood, computed_at, model_version
       FROM cdp_customer_predictions
       WHERE customer_id = $1::uuid AND company_id = $2::uuid`,
      [customerId, companyId]
    );

    if (cacheRes.rows.length > 0) {
      const row = cacheRes.rows[0];
      const computedAt = new Date(row.computed_at);
      const isFresh = (Date.now() - computedAt.getTime()) < CACHE_TTL_MS;
      if (isFresh) {
        return {
          clickScore: Number(row.click_score),
          churnRisk: Number(row.churn_risk),
          purchaseLikelihood: Number(row.purchase_likelihood),
          computedAt,
          modelVersion: row.model_version,
        };
      }
    }

    // 2) 즉시 계산 + UPSERT 저장
    const predictions = await computePredictions(customerId, companyId);
    await upsertPredictions(customerId, companyId, predictions);
    return predictions;
  } catch (err: any) {
    console.warn('[Predictive] getOrComputePredictions 오류, 즉시 계산 fallback:', err?.message);
    return computePredictions(customerId, companyId);
  }
}

async function upsertPredictions(
  customerId: string,
  companyId: string,
  predictions: CustomerPredictions,
): Promise<void> {
  try {
    await query(
      `INSERT INTO cdp_customer_predictions
         (customer_id, company_id, click_score, churn_risk, purchase_likelihood, computed_at, model_version)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
       ON CONFLICT (customer_id) DO UPDATE SET
         click_score = EXCLUDED.click_score,
         churn_risk = EXCLUDED.churn_risk,
         purchase_likelihood = EXCLUDED.purchase_likelihood,
         computed_at = EXCLUDED.computed_at,
         model_version = EXCLUDED.model_version`,
      [
        customerId, companyId,
        predictions.clickScore, predictions.churnRisk, predictions.purchaseLikelihood,
        predictions.computedAt, predictions.modelVersion,
      ]
    );
  } catch (err: any) {
    console.warn('[Predictive] upsertPredictions 오류, skip:', err?.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. enrichCustomerWithPredictions — Liquid context 통합 진입점
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function enrichCustomerWithPredictions(
  customer: Record<string, any>,
  companyId: string,
): Promise<Record<string, any>> {
  if (!customer || !customer.id) return customer;
  try {
    const predictions = await getOrComputePredictions(customer.id, companyId);
    return {
      ...customer,
      click_score: predictions.clickScore,
      churn_risk: predictions.churnRisk,
      purchase_likelihood: predictions.purchaseLikelihood,
    };
  } catch (err: any) {
    console.warn('[Predictive] enrichCustomerWithPredictions 오류, 원본 반환:', err?.message);
    return customer;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. 회사 분포 통계 (/predictive 대시보드)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getCompanyPredictionDistribution(
  companyId: string,
): Promise<PredictionDistribution> {
  // 1) 히스토그램 (10 bin)
  const histRes = await query(
    `SELECT
       width_bucket(click_score, 0, 1, 10) AS click_bin,
       width_bucket(churn_risk, 0, 1, 10) AS churn_bin,
       width_bucket(purchase_likelihood, 0, 1, 10) AS purchase_bin,
       COUNT(*) AS cnt
     FROM cdp_customer_predictions
     WHERE company_id = $1::uuid
     GROUP BY click_bin, churn_bin, purchase_bin`,
    [companyId]
  );

  const totalRes = await query(
    `SELECT COUNT(*) AS total, MAX(computed_at) AS last_computed
     FROM cdp_customer_predictions
     WHERE company_id = $1::uuid`,
    [companyId]
  );
  const total = Number(totalRes.rows[0]?.total) || 0;
  const lastComputed = totalRes.rows[0]?.last_computed ? new Date(totalRes.rows[0].last_computed) : null;

  const buildHistogram = (key: 'click_bin' | 'churn_bin' | 'purchase_bin'): HistogramBin[] => {
    const bins: number[] = new Array(11).fill(0);  // 0~10
    for (const row of histRes.rows) {
      const bin = Number(row[key]) || 0;
      bins[bin] = (bins[bin] || 0) + Number(row.cnt);
    }
    const result: HistogramBin[] = [];
    for (let i = 1; i <= 10; i++) {
      const lo = (i - 1) / 10;
      const hi = i / 10;
      const count = bins[i] || 0;
      result.push({
        range: `${lo.toFixed(1)}~${hi.toFixed(1)}`,
        count,
        pct: total > 0 ? count / total : 0,
      });
    }
    return result;
  };

  // 2) Top 위험 50명
  const topRiskRes = await query(
    `SELECT p.customer_id, c.name, c.phone, c.grade, c.region,
            p.click_score, p.churn_risk, p.purchase_likelihood,
            CASE WHEN c.recent_purchase_date IS NOT NULL THEN
              EXTRACT(EPOCH FROM (NOW() - c.recent_purchase_date)) / 86400
            ELSE NULL END AS last_activity_days
     FROM cdp_customer_predictions p
     INNER JOIN customers c ON c.id = p.customer_id
     WHERE p.company_id = $1::uuid
     ORDER BY p.churn_risk DESC, c.recent_purchase_date ASC NULLS LAST
     LIMIT 50`,
    [companyId]
  );

  // 3) Top 구매 가능성 50명
  const topPotentialRes = await query(
    `SELECT p.customer_id, c.name, c.phone, c.grade, c.region,
            p.click_score, p.churn_risk, p.purchase_likelihood,
            CASE WHEN c.recent_purchase_date IS NOT NULL THEN
              EXTRACT(EPOCH FROM (NOW() - c.recent_purchase_date)) / 86400
            ELSE NULL END AS last_activity_days
     FROM cdp_customer_predictions p
     INNER JOIN customers c ON c.id = p.customer_id
     WHERE p.company_id = $1::uuid
     ORDER BY p.purchase_likelihood DESC
     LIMIT 50`,
    [companyId]
  );

  // 4) 모델 정확도 (옛 예측 vs 실 결과)
  const accRes = await query(
    `SELECT
       AVG(CASE WHEN p.click_score >= 0.5 THEN 1 ELSE 0 END) AS click_predicted_rate,
       AVG(CASE WHEN EXISTS (
         SELECT 1 FROM cdp_events
         WHERE customer_id = p.customer_id
           AND event_name = 'message_click'
           AND occurred_at > p.computed_at
       ) THEN 1 ELSE 0 END) AS click_actual_rate,
       AVG(CASE WHEN p.purchase_likelihood >= 0.5 THEN 1 ELSE 0 END) AS purchase_predicted_rate,
       AVG(CASE WHEN EXISTS (
         SELECT 1 FROM cdp_events
         WHERE customer_id = p.customer_id
           AND event_name IN ('order', 'purchase')
           AND occurred_at > p.computed_at
       ) THEN 1 ELSE 0 END) AS purchase_actual_rate
     FROM cdp_customer_predictions p
     WHERE p.company_id = $1::uuid
       AND p.computed_at < NOW() - INTERVAL '1 day'`,
    [companyId]
  );

  let modelAccuracy: ModelAccuracy | null = null;
  if (accRes.rows.length > 0 && accRes.rows[0].click_predicted_rate !== null) {
    const a = accRes.rows[0];
    const clickPred = Number(a.click_predicted_rate) || 0;
    const clickAct = Number(a.click_actual_rate) || 0;
    const purchPred = Number(a.purchase_predicted_rate) || 0;
    const purchAct = Number(a.purchase_actual_rate) || 0;
    modelAccuracy = {
      clickPredicted: round3(clickPred),
      clickActual: round3(clickAct),
      clickAccuracy: clickPred > 0 ? round3(Math.min(clickAct / clickPred, 1)) : 0,
      conversionPredicted: round3(purchPred),
      conversionActual: round3(purchAct),
      conversionAccuracy: purchPred > 0 ? round3(Math.min(purchAct / purchPred, 1)) : 0,
    };
  }

  return {
    histogram: {
      clickScore: buildHistogram('click_bin'),
      churnRisk: buildHistogram('churn_bin'),
      purchaseLikelihood: buildHistogram('purchase_bin'),
    },
    topRiskCustomers: topRiskRes.rows.map(rowToCustomer),
    topPotentialCustomers: topPotentialRes.rows.map(rowToCustomer),
    modelAccuracy,
    totalCustomers: total,
    computedAt: lastComputed,
  };
}

function rowToCustomer(row: any): PredictionCustomerRow {
  return {
    customerId: row.customer_id,
    customerName: row.name,
    customerPhone: row.phone,
    customerGrade: row.grade,
    customerRegion: row.region,
    clickScore: Number(row.click_score) || 0,
    churnRisk: Number(row.churn_risk) || 0,
    purchaseLikelihood: Number(row.purchase_likelihood) || 0,
    lastActivityDays: row.last_activity_days !== null ? Math.floor(Number(row.last_activity_days)) : null,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. AI Operator 자율 추천 통합 진입점 (회사 점수 분포 요약)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CompanyPredictionSummary {
  totalCustomers: number;
  highRiskCount: number;          // churn_risk > 0.7
  highPotentialCount: number;     // purchase_likelihood > 0.6
  avgClickScore: number;
  avgChurnRisk: number;
  avgPurchaseLikelihood: number;
  insightText: string;            // AI 시스템 프롬프트 통합용
}

export async function getCompanyPredictionSummary(companyId: string): Promise<CompanyPredictionSummary> {
  try {
    const r = await query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE churn_risk > 0.7) AS high_risk,
         COUNT(*) FILTER (WHERE purchase_likelihood > 0.6) AS high_potential,
         AVG(click_score) AS avg_click,
         AVG(churn_risk) AS avg_churn,
         AVG(purchase_likelihood) AS avg_purchase
       FROM cdp_customer_predictions
       WHERE company_id = $1::uuid`,
      [companyId]
    );
    const row = r.rows[0] || {};
    const total = Number(row.total) || 0;
    const highRisk = Number(row.high_risk) || 0;
    const highPotential = Number(row.high_potential) || 0;
    const avgClick = Number(row.avg_click) || 0.5;
    const avgChurn = Number(row.avg_churn) || 0.5;
    const avgPurchase = Number(row.avg_purchase) || 0.5;

    let insightText: string;
    if (total === 0) {
      insightText = 'AI 예측 점수 데이터가 아직 누적되지 않았습니다. 발송 시작 후 1시간 안에 자동 계산됩니다.';
    } else {
      const parts: string[] = [];
      if (highRisk > 0) parts.push(`이탈 위험 70%+ 고객 ${highRisk.toLocaleString()}명 — 회복 캠페인 즉시 추천`);
      if (highPotential > 0) parts.push(`구매 가능성 60%+ 고객 ${highPotential.toLocaleString()}명 — 구매 유도 캠페인 추천`);
      if (parts.length === 0) parts.push(`평균 클릭 가능성 ${(avgClick * 100).toFixed(0)}% / 이탈 위험 ${(avgChurn * 100).toFixed(0)}% / 구매 가능성 ${(avgPurchase * 100).toFixed(0)}%`);
      insightText = parts.join(' · ');
    }

    return {
      totalCustomers: total,
      highRiskCount: highRisk,
      highPotentialCount: highPotential,
      avgClickScore: round3(avgClick),
      avgChurnRisk: round3(avgChurn),
      avgPurchaseLikelihood: round3(avgPurchase),
      insightText,
    };
  } catch (err: any) {
    console.warn('[Predictive] getCompanyPredictionSummary 오류:', err?.message);
    return {
      totalCustomers: 0,
      highRiskCount: 0,
      highPotentialCount: 0,
      avgClickScore: 0.5,
      avgChurnRisk: 0.5,
      avgPurchaseLikelihood: 0.5,
      insightText: '예측 점수 조회 오류 — 추후 자동 재계산됩니다.',
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 헬퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function neutralPredictions(): CustomerPredictions {
  return {
    clickScore: NEUTRAL_VALUE,
    churnRisk: NEUTRAL_VALUE,
    purchaseLikelihood: NEUTRAL_VALUE,
    computedAt: new Date(),
    modelVersion: COLD_START_VERSION,
  };
}

function clip(value: number, min: number, max: number): number {
  if (isNaN(value)) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. Batch 진입점 — cron worker가 회사 전체 customer 1시간 주기 갱신
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function recomputeCompanyPredictions(
  companyId: string,
  options: { limit?: number; staleAfterMs?: number } = {},
): Promise<{ updated: number; skipped: number }> {
  const limit = options.limit || 5000;
  const staleAfterMs = options.staleAfterMs || CACHE_TTL_MS;
  const staleCutoff = new Date(Date.now() - staleAfterMs);

  // active customer 우선 (옛 cache stale 영역 또는 cache X 영역)
  const r = await query(
    `SELECT c.id
     FROM customers c
     LEFT JOIN cdp_customer_predictions p ON p.customer_id = c.id
     WHERE c.company_id = $1::uuid
       AND (p.computed_at IS NULL OR p.computed_at < $2::timestamptz)
     ORDER BY p.computed_at ASC NULLS FIRST
     LIMIT $3`,
    [companyId, staleCutoff.toISOString(), limit]
  );

  let updated = 0;
  let skipped = 0;
  for (const row of r.rows) {
    try {
      const predictions = await computePredictions(row.id, companyId);
      await upsertPredictions(row.id, companyId, predictions);
      updated++;
    } catch (err: any) {
      console.warn('[Predictive] batch recompute skip:', row.id, err?.message);
      skipped++;
    }
  }

  return { updated, skipped };
}
