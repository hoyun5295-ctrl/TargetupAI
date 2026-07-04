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
 *  - 한줄로 운영 영향 0 (predictions 미사용 회사 영향 0)
 */

import { query } from '../config/database';
import { buildDiscoveredSegments, DiscoveredSegment } from './predictive-segments-core';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CustomerPredictions {
  clickScore: number;          // 0~1
  churnRisk: number;            // 0~1
  purchaseLikelihood: number;   // 0~1
  // ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): LTV + 7+ 영역 확장 예측
  ltv60d: number;              // 60일 예상 매출 (원)
  ltv90d: number;              // 90일 예상 매출 (원)
  ltv365d: number;             // 365일 예상 매출 (원)
  nextPurchaseDays: number | null;        // 다음 구매 예상 일수 (D+N)
  channelPreference: string | null;       // 'sms' / 'lms' / 'mms' / 'kakao'
  bestHour: number | null;                // 0~23 (최적 발송 시간대)
  tonePreference: string | null;          // '감성적' / '실용적' / '캐주얼'
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
  modelVersion?: string;  // ★ D210+ Phase 3 (2026-05-23): cold vs trained 표시 매트릭스
  // ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): LTV + 7+ 영역 확장 표시
  ltv60d?: number;
  ltv90d?: number;
  ltv365d?: number;
  nextPurchaseDays?: number | null;
  channelPreference?: string | null;
  bestHour?: number | null;
  tonePreference?: string | null;
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
// ★ 2026-07-03 Gap5 Layer1: cold-start가 실제 클릭 "횟수"를 반영하도록 공식 보정 → v1.1-cold.
//   (기존엔 클릭 최근성 ±0.10만 반영 — 클릭 20회와 1회가 같은 점수였음. trained 공식은 불변 = v1.0-trained 유지)
const COLD_START_VERSION = 'v1.1-cold';
const TRAINED_VERSION = 'v1.0-trained';
// cold-start 클릭 횟수 가산: 1회당 +0.02, 상한 +0.10 (등급 base 0.12~0.32 · 최근성 ±0.10과 동일 스케일의 보정 상수)
const COLD_CLICK_COUNT_STEP = 0.02;
const COLD_CLICK_COUNT_CAP = 0.10;
// cold-start 구매가능성 클릭 보너스: trained 분기의 clickBoost(0.08)와 동일 상수 재사용
const COLD_PURCHASE_CLICK_BOOST = 0.08;

// 등급별 평균 (cold start fallback)
const GRADE_AVG_CLICK: Record<string, number> = {
  'VIP': 0.32, 'Gold': 0.24, 'Silver': 0.18, '일반': 0.12, '신규': 0.20,
};
const GRADE_AVG_PURCHASE: Record<string, number> = {
  'VIP': 0.28, 'Gold': 0.18, 'Silver': 0.12, '일반': 0.08, '신규': 0.15,
};
// ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): 등급별 평균 객단가 (cold start fallback)
const GRADE_AVG_LTV: Record<string, number> = {
  'VIP': 150000, 'Gold': 80000, 'Silver': 45000, '일반': 30000, '신규': 25000,
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
         -- ★ 2026-07-03 Gap5 Layer2: 분모 = 여정 발송 + 고객별 발송 카운터(직접발송·DM·자동마케팅) 합산.
         --   두 소스는 배타적(여정은 카운터 미기록) — 중복 0. ⚠️ 벌크 SQL과 동일 합산 유지 의무.
         (SELECT COUNT(*) FROM journey_step_logs l
          JOIN journey_executions e ON e.id = l.execution_id
          WHERE e.customer_id = c.id AND l.status = 'sent')
         + COALESCE((SELECT s.total_sent FROM customer_send_stats s WHERE s.customer_id = c.id), 0) AS total_sent,
         -- ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): 채널 / 시간대 선호 영역
         (SELECT s.channel FROM journey_step_logs l
          JOIN journey_executions e ON e.id = l.execution_id
          JOIN journey_steps s ON s.id = l.step_id
          WHERE e.customer_id = c.id AND l.status = 'sent' AND s.channel IS NOT NULL
          GROUP BY s.channel
          ORDER BY COUNT(*) DESC
          LIMIT 1) AS preferred_channel,
         (SELECT EXTRACT(HOUR FROM (e.occurred_at AT TIME ZONE 'Asia/Seoul'))::int FROM cdp_events e
          WHERE e.customer_id = c.id AND e.event_name = 'message_click'
          GROUP BY EXTRACT(HOUR FROM (e.occurred_at AT TIME ZONE 'Asia/Seoul'))
          ORDER BY COUNT(*) DESC
          LIMIT 1) AS best_hour
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
      // ★ 2026-07-03 Gap5 Layer1: 클릭 "횟수" 가산 (1회당 +0.02, 상한 +0.10).
      //   발송 기록(total_sent)이 여정만 집계돼 cold에 머무는 직접발송 회사도, 이미 쌓인
      //   실제 클릭(cdp_events message_click — 전 채널 단축URL)만큼은 점수에 반영한다.
      //   ⚠️ 벌크 SQL(아래 UPSERT CTE)과 반드시 동일 공식 유지 — 한쪽만 수정 금지(이중 진실).
      const clickCountBonus = Math.min(COLD_CLICK_COUNT_STEP * totalClicks, COLD_CLICK_COUNT_CAP);
      clickScore = clip(base + adjust + clickCountBonus, 0, 1);
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
      // ★ 2026-07-03 Gap5 Layer1: 클릭 실측 보너스 — trained 분기 clickBoost(0.08)와 동일 상수.
      //   ⚠️ 벌크 SQL과 동일 공식 유지 의무.
      const coldClickBoost = totalClicks > 0 ? COLD_PURCHASE_CLICK_BOOST : 0;
      purchaseLikelihood = clip(base + recencyBoost + coldClickBoost, 0, 1);
    }

    // ━━━━ ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): LTV + 다음 구매 + 채널/시간/톤 선호 ━━━━
    const totalPurchaseAmount = Number(row.total_purchase_amount) || 0;
    const avgPurchaseAmount = purchaseCount > 0 ? totalPurchaseAmount / purchaseCount : GRADE_AVG_LTV[grade] || 30000;
    // LTV: avg × purchase_likelihood × periods
    //   60d  = avg × purchase_likelihood × (60/30)
    //   90d  = avg × purchase_likelihood × (90/30)
    //   365d = avg × purchase_likelihood × (365/30) × recency_factor
    const recencyFactor = daysSinceActivity <= 30 ? 1.1 : daysSinceActivity <= 90 ? 1.0 : 0.6;
    const ltv60d = Math.round(avgPurchaseAmount * purchaseLikelihood * 2 * recencyFactor);
    const ltv90d = Math.round(avgPurchaseAmount * purchaseLikelihood * 3 * recencyFactor);
    const ltv365d = Math.round(avgPurchaseAmount * purchaseLikelihood * 12 * recencyFactor);

    // 다음 구매 예상 일수 — 옛 구매 영역 평균 간격 영역
    let nextPurchaseDays: number | null = null;
    if (purchaseCount >= 2 && row.created_at) {
      const accountAgeDays = (Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const avgIntervalDays = accountAgeDays / purchaseCount;
      const sinceLast = daysSinceActivity;
      nextPurchaseDays = Math.max(0, Math.round(avgIntervalDays - sinceLast));
    } else if (hasEnoughData) {
      // 옛 평균 영역 = 60일 / cold start = null
      nextPurchaseDays = 60;
    }

    // 채널 / 시간 / 톤 선호 — 옛 journey_step_logs 영역 학습 (단순 영역 — 향후 진화)
    const channelPreference = row.preferred_channel || null;
    const bestHour = row.best_hour !== null && row.best_hour !== undefined ? Number(row.best_hour) : null;
    const tonePreference = null;  // 향후 진화 영역

    return {
      clickScore: round3(clickScore),
      churnRisk: round3(churnRisk),
      purchaseLikelihood: round3(purchaseLikelihood),
      ltv60d,
      ltv90d,
      ltv365d,
      nextPurchaseDays,
      channelPreference,
      bestHour,
      tonePreference,
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
      `SELECT click_score, churn_risk, purchase_likelihood,
              ltv_60d, ltv_90d, ltv_365d,
              next_purchase_days, channel_preference, best_hour, tone_preference,
              computed_at, model_version
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
          // ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): cache 안 LTV + 7+ 영역 통합
          ltv60d: Number(row.ltv_60d) || 0,
          ltv90d: Number(row.ltv_90d) || 0,
          ltv365d: Number(row.ltv_365d) || 0,
          nextPurchaseDays: row.next_purchase_days !== null ? Number(row.next_purchase_days) : null,
          channelPreference: row.channel_preference || null,
          bestHour: row.best_hour !== null && row.best_hour !== undefined ? Number(row.best_hour) : null,
          tonePreference: row.tone_preference || null,
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
         (customer_id, company_id, click_score, churn_risk, purchase_likelihood,
          ltv_60d, ltv_90d, ltv_365d, next_purchase_days, channel_preference, best_hour, tone_preference,
          computed_at, model_version)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (customer_id) DO UPDATE SET
         click_score = EXCLUDED.click_score,
         churn_risk = EXCLUDED.churn_risk,
         purchase_likelihood = EXCLUDED.purchase_likelihood,
         ltv_60d = EXCLUDED.ltv_60d,
         ltv_90d = EXCLUDED.ltv_90d,
         ltv_365d = EXCLUDED.ltv_365d,
         next_purchase_days = EXCLUDED.next_purchase_days,
         channel_preference = EXCLUDED.channel_preference,
         best_hour = EXCLUDED.best_hour,
         tone_preference = EXCLUDED.tone_preference,
         computed_at = EXCLUDED.computed_at,
         model_version = EXCLUDED.model_version`,
      [
        customerId, companyId,
        predictions.clickScore, predictions.churnRisk, predictions.purchaseLikelihood,
        predictions.ltv60d, predictions.ltv90d, predictions.ltv365d,
        predictions.nextPurchaseDays, predictions.channelPreference, predictions.bestHour, predictions.tonePreference,
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
            p.ltv_60d, p.ltv_90d, p.ltv_365d,
            p.next_purchase_days, p.channel_preference, p.best_hour, p.tone_preference,
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
            p.ltv_60d, p.ltv_90d, p.ltv_365d,
            p.next_purchase_days, p.channel_preference, p.best_hour, p.tone_preference,
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
    modelVersion: row.model_version || undefined,
    // ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): LTV + 7+ 영역 표시
    ltv60d: row.ltv_60d !== null && row.ltv_60d !== undefined ? Number(row.ltv_60d) : undefined,
    ltv90d: row.ltv_90d !== null && row.ltv_90d !== undefined ? Number(row.ltv_90d) : undefined,
    ltv365d: row.ltv_365d !== null && row.ltv_365d !== undefined ? Number(row.ltv_365d) : undefined,
    nextPurchaseDays: row.next_purchase_days !== null && row.next_purchase_days !== undefined ? Number(row.next_purchase_days) : null,
    channelPreference: row.channel_preference || null,
    bestHour: row.best_hour !== null && row.best_hour !== undefined ? Number(row.best_hour) : null,
    tonePreference: row.tone_preference || null,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. AI Operator 자율 추천 통합 진입점 (회사 점수 분포 요약)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CompanyPredictionSummary {
  totalCustomersInCompany: number;        // ★ D210+ Phase 3 (2026-05-23): 회사 전체 customers (cdp_customer_predictions 영역 X)
  totalCustomersInPredictions: number;    // ★ D210+ Phase 3: cdp_customer_predictions 누적 영역
  predictionCoverage: number;              // ★ D210+ Phase 3: predictions / company (0~1)
  coldStartCount: number;                  // ★ D210+ Phase 3: model_version = 'v1.0-cold'
  trainedCount: number;                    // ★ D210+ Phase 3: model_version = 'v1.0-trained'
  isAllColdStart: boolean;                 // ★ D210+ Phase 3: trainedCount = 0 영역 (UI 안내 카드 조건)
  lastComputedAt: Date | null;             // ★ D210+ Phase 3
  highRiskCount: number;                   // churn_risk > 0.7
  highPotentialCount: number;              // purchase_likelihood > 0.6
  avgClickScore: number;
  avgChurnRisk: number;
  avgPurchaseLikelihood: number;
  insightText: string;                     // AI 시스템 프롬프트 통합용
  // ★ 옛 영역 보존 (legacy 호환) — 옛 코드 (orchestrator 등) totalCustomers 사용 영역 정합
  totalCustomers: number;                  // = totalCustomersInCompany (회사 전체 영역)
  // ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): LTV + 다음 구매 + 채널 분포 통합
  avgLtv60d: number;                       // 회사 평균 60일 LTV
  avgLtv90d: number;                       // 회사 평균 90일 LTV
  avgLtv365d: number;                      // 회사 평균 365일 LTV
  totalProjectedLtv60d: number;            // 회사 전체 합산 60일 LTV
  totalProjectedLtv90d: number;            // 회사 전체 합산 90일 LTV
  totalProjectedLtv365d: number;           // 회사 전체 합산 365일 LTV
  highLtvCount: number;                    // ltv_365d > 평균 × 2 영역 (VIP 후보 영역)
  channelDistribution: Array<{ channel: string; count: number; pct: number }>;
  bestHourDistribution: Array<{ hour: number; count: number; pct: number }>;
  // ★ 2026-06-07: AI 발견 세그먼트 (이탈 / 구매 / VIP) — 근거 한 줄 포함 (메인 주인공)
  discoveredSegments: DiscoveredSegment[];
}

export async function getCompanyPredictionSummary(companyId: string): Promise<CompanyPredictionSummary> {
  try {
    // ★ D210+ Phase 3 (2026-05-23 Harold 명시): 회사 전체 customers + cdp_customer_predictions 영역 양쪽 카운트 정합 의무
    //   옛 매트릭스 = cdp_customer_predictions 카운트만 = 회사 admin 인지 사고 (29,997명 회사 영역 = 5,000명만 표시 사고)
    //   신규 매트릭스 = totalCustomersInCompany (customers 영역) + totalCustomersInPredictions (cdp_customer_predictions 영역) + coverage % 표시
    const companyRes = await query(
      `SELECT COUNT(*)::int AS total FROM customers WHERE company_id = $1::uuid`,
      [companyId]
    );
    const totalInCompany = Number(companyRes.rows[0]?.total) || 0;

    const r = await query(
      `SELECT
         COUNT(*) AS total,
         -- ★ 2026-07-03 Gap5 Layer1: cold 버전 bump(v1.1-cold) 대응 — 등호 대신 suffix 비교(버전 무관 영구 안전)
         COUNT(*) FILTER (WHERE model_version LIKE '%-cold') AS cold_count,
         COUNT(*) FILTER (WHERE model_version LIKE '%-trained') AS trained_count,
         COUNT(*) FILTER (WHERE churn_risk > 0.7) AS high_risk,
         COUNT(*) FILTER (WHERE purchase_likelihood > 0.6) AS high_potential,
         AVG(click_score) AS avg_click,
         AVG(churn_risk) AS avg_churn,
         AVG(purchase_likelihood) AS avg_purchase,
         -- ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): LTV 평균 + 합산 + 고LTV 영역
         AVG(ltv_60d) AS avg_ltv_60d,
         AVG(ltv_90d) AS avg_ltv_90d,
         AVG(ltv_365d) AS avg_ltv_365d,
         SUM(ltv_60d) AS total_ltv_60d,
         SUM(ltv_90d) AS total_ltv_90d,
         SUM(ltv_365d) AS total_ltv_365d,
         MAX(computed_at) AS last_computed
       FROM cdp_customer_predictions
       WHERE company_id = $1::uuid`,
      [companyId]
    );
    const row = r.rows[0] || {};
    const totalInPredictions = Number(row.total) || 0;
    const coldCount = Number(row.cold_count) || 0;
    const trainedCount = Number(row.trained_count) || 0;
    const highRisk = Number(row.high_risk) || 0;
    const highPotential = Number(row.high_potential) || 0;
    const avgClick = Number(row.avg_click) || 0.5;
    const avgChurn = Number(row.avg_churn) || 0.5;
    const avgPurchase = Number(row.avg_purchase) || 0.5;
    const avgLtv60d = Math.round(Number(row.avg_ltv_60d) || 0);
    const avgLtv90d = Math.round(Number(row.avg_ltv_90d) || 0);
    const avgLtv365d = Math.round(Number(row.avg_ltv_365d) || 0);
    const totalLtv60d = Math.round(Number(row.total_ltv_60d) || 0);
    const totalLtv90d = Math.round(Number(row.total_ltv_90d) || 0);
    const totalLtv365d = Math.round(Number(row.total_ltv_365d) || 0);
    const lastComputedAt = row.last_computed ? new Date(row.last_computed) : null;
    const predictionCoverage = totalInCompany > 0 ? totalInPredictions / totalInCompany : 0;
    const isAllColdStart = totalInPredictions > 0 && trainedCount === 0;

    // ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): 고 LTV count (avg × 2 영역)
    const highLtvThreshold = avgLtv365d * 2;
    const highLtvRes = await query(
      `SELECT COUNT(*)::int AS cnt FROM cdp_customer_predictions
       WHERE company_id = $1::uuid AND ltv_365d > $2::numeric`,
      [companyId, highLtvThreshold]
    );
    const highLtvCount = Number(highLtvRes.rows[0]?.cnt) || 0;

    // ★ 2026-06-07: 발견 세그먼트 6종 근거용 보조 실측 (신규 컬럼/테이블/JOIN 0 — 기존 컬럼 + INNER JOIN customers 재사용)
    //   첫구매 = customers.purchase_count 0 · 관심 = click_score>0.5 · 재구매 = next_purchase_days 0~14
    const segAuxRes = await query(
      `SELECT
         AVG(CASE WHEN p.churn_risk > 0.7
             THEN EXTRACT(EPOCH FROM (NOW() - c.recent_purchase_date)) / 86400 END) AS churn_avg_inactive_days,
         AVG(CASE WHEN p.purchase_likelihood > 0.6
             THEN p.next_purchase_days END) AS purchase_avg_next_days,
         COALESCE(SUM(CASE WHEN p.ltv_365d > $2::numeric THEN p.ltv_365d ELSE 0 END), 0) AS vip_sum_ltv,
         COUNT(*) FILTER (WHERE COALESCE(c.purchase_count, 0) = 0) AS first_purchase_count,
         COUNT(*) FILTER (WHERE p.click_score > 0.5) AS engagement_count,
         AVG(CASE WHEN p.click_score > 0.5 THEN p.click_score END) AS engagement_avg_click,
         COUNT(*) FILTER (WHERE p.next_purchase_days BETWEEN 0 AND 14) AS repurchase_count,
         AVG(CASE WHEN p.next_purchase_days BETWEEN 0 AND 14 THEN p.next_purchase_days END) AS repurchase_avg_days
       FROM cdp_customer_predictions p
       INNER JOIN customers c ON c.id = p.customer_id
       WHERE p.company_id = $1::uuid`,
      [companyId, highLtvThreshold]
    );
    const segRow = segAuxRes.rows[0] || {};
    const roundOrNull = (v: any): number | null =>
      v !== null && v !== undefined ? Math.round(Number(v)) : null;
    const churnAvgInactiveDays = roundOrNull(segRow.churn_avg_inactive_days);
    const purchaseAvgNextDays = roundOrNull(segRow.purchase_avg_next_days);
    const vipSumLtv = Math.round(Number(segRow.vip_sum_ltv) || 0);
    const firstPurchaseCount = Number(segRow.first_purchase_count) || 0;
    const engagementCount = Number(segRow.engagement_count) || 0;
    const engagementAvgClickPct = segRow.engagement_avg_click !== null && segRow.engagement_avg_click !== undefined
      ? Math.round(Number(segRow.engagement_avg_click) * 100) : null;
    const repurchaseCount = Number(segRow.repurchase_count) || 0;
    const repurchaseAvgDays = roundOrNull(segRow.repurchase_avg_days);
    const discoveredSegments = buildDiscoveredSegments({
      churn: { count: highRisk, avgInactiveDays: churnAvgInactiveDays },
      purchase: { count: highPotential, avgNextPurchaseDays: purchaseAvgNextDays },
      vip: { count: highLtvCount, sumLtv365d: vipSumLtv },
      firstPurchase: { count: firstPurchaseCount },
      engagement: { count: engagementCount, avgClickPct: engagementAvgClickPct },
      repurchase: { count: repurchaseCount, avgNextPurchaseDays: repurchaseAvgDays },
    });

    // ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): 채널 분포 + 시간대 분포
    const channelRes = await query(
      `SELECT channel_preference AS ch, COUNT(*)::int AS cnt
       FROM cdp_customer_predictions
       WHERE company_id = $1::uuid AND channel_preference IS NOT NULL
       GROUP BY channel_preference
       ORDER BY cnt DESC`,
      [companyId]
    );
    const channelTotal = channelRes.rows.reduce((sum: number, r: any) => sum + Number(r.cnt), 0);
    const channelDistribution = channelRes.rows.map((r: any) => ({
      channel: r.ch,
      count: Number(r.cnt),
      pct: channelTotal > 0 ? Number(r.cnt) / channelTotal : 0,
    }));

    const hourRes = await query(
      `SELECT best_hour AS hr, COUNT(*)::int AS cnt
       FROM cdp_customer_predictions
       WHERE company_id = $1::uuid AND best_hour IS NOT NULL
       GROUP BY best_hour
       ORDER BY cnt DESC
       LIMIT 5`,
      [companyId]
    );
    const hourTotal = hourRes.rows.reduce((sum: number, r: any) => sum + Number(r.cnt), 0);
    const bestHourDistribution = hourRes.rows.map((r: any) => ({
      hour: Number(r.hr),
      count: Number(r.cnt),
      pct: hourTotal > 0 ? Number(r.cnt) / hourTotal : 0,
    }));

    let insightText: string;
    if (totalInPredictions === 0) {
      insightText = '예측 점수 데이터가 아직 누적되지 않았습니다. 발송 시작 후 1시간 안에 자동 계산됩니다.';
    } else if (isAllColdStart) {
      insightText = `전체 ${totalInPredictions.toLocaleString()}명 모두 등급/활동 기반 추정치 (cold start). 실제 발송 누적 후 trained 모델로 자동 진화 — 정확도 시간 흐름과 함께 향상됩니다.`;
    } else {
      const parts: string[] = [];
      if (highRisk > 0) parts.push(`이탈 위험 70%+ 고객 ${highRisk.toLocaleString()}명 — 회복 캠페인 추천`);
      if (highPotential > 0) parts.push(`구매 가능성 60%+ 고객 ${highPotential.toLocaleString()}명 — 구매 유도 캠페인 추천`);
      if (parts.length === 0) parts.push(`평균 클릭 가능성 ${(avgClick * 100).toFixed(0)}% / 이탈 위험 ${(avgChurn * 100).toFixed(0)}% / 구매 가능성 ${(avgPurchase * 100).toFixed(0)}%`);
      insightText = parts.join(' · ');
    }

    return {
      totalCustomersInCompany: totalInCompany,
      totalCustomersInPredictions: totalInPredictions,
      predictionCoverage: round3(predictionCoverage),
      coldStartCount: coldCount,
      trainedCount,
      isAllColdStart,
      lastComputedAt,
      highRiskCount: highRisk,
      highPotentialCount: highPotential,
      avgClickScore: round3(avgClick),
      avgChurnRisk: round3(avgChurn),
      avgPurchaseLikelihood: round3(avgPurchase),
      insightText,
      totalCustomers: totalInCompany,  // legacy 호환
      // ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): LTV + 채널 + 시간대 영역
      avgLtv60d,
      avgLtv90d,
      avgLtv365d,
      totalProjectedLtv60d: totalLtv60d,
      totalProjectedLtv90d: totalLtv90d,
      totalProjectedLtv365d: totalLtv365d,
      highLtvCount,
      channelDistribution,
      bestHourDistribution,
      discoveredSegments,
    };
  } catch (err: any) {
    console.warn('[Predictive] getCompanyPredictionSummary 오류:', err?.message);
    return {
      totalCustomersInCompany: 0,
      totalCustomersInPredictions: 0,
      predictionCoverage: 0,
      coldStartCount: 0,
      trainedCount: 0,
      isAllColdStart: false,
      lastComputedAt: null,
      highRiskCount: 0,
      highPotentialCount: 0,
      avgClickScore: 0.5,
      avgChurnRisk: 0.5,
      avgPurchaseLikelihood: 0.5,
      insightText: '예측 점수 조회 오류 — 추후 자동 재계산됩니다.',
      totalCustomers: 0,
      avgLtv60d: 0,
      avgLtv90d: 0,
      avgLtv365d: 0,
      totalProjectedLtv60d: 0,
      totalProjectedLtv90d: 0,
      totalProjectedLtv365d: 0,
      highLtvCount: 0,
      channelDistribution: [],
      bestHourDistribution: [],
      discoveredSegments: [],
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. ★ D210+ Phase 3 (2026-05-23 Harold 명시): listCompanyPredictionCustomers
//    회사 전체 customer 영역 페이지네이션 + 검색 + 필터 + 정렬 매트릭스 (Top 50명 영역 폐기)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type PredictionFilterType = 'all' | 'high_risk' | 'high_potential' | 'high_click' | 'high_ltv' | 'first_purchase' | 'repurchase' | 'cold_start';
export type PredictionSortType =
  | 'churn_risk_desc'
  | 'purchase_likelihood_desc'
  | 'click_score_desc'
  | 'ltv_365d_desc'
  | 'last_activity_asc'
  | 'last_activity_desc';

export interface ListPredictionCustomersOptions {
  page?: number;       // 1-based (default 1)
  limit?: number;      // default 10
  search?: string;     // name / phone / grade / region ILIKE
  filter?: PredictionFilterType;
  sort?: PredictionSortType;
}

export interface ListPredictionCustomersResult {
  customers: PredictionCustomerRow[];
  totalCount: number;       // 회사 전체 cdp_customer_predictions 영역
  filteredCount: number;    // search + filter 적용 후 영역
  page: number;
  totalPages: number;
  limit: number;
}

export async function listCompanyPredictionCustomers(
  companyId: string,
  options: ListPredictionCustomersOptions = {},
): Promise<ListPredictionCustomersResult> {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
  const search = (options.search || '').trim();
  const filter: PredictionFilterType = options.filter || 'all';
  const sort: PredictionSortType = options.sort || 'churn_risk_desc';
  const offset = (page - 1) * limit;

  // 필터 WHERE 매트릭스
  const filterClause = (() => {
    switch (filter) {
      case 'high_risk': return 'AND p.churn_risk > 0.7';
      case 'high_potential': return 'AND p.purchase_likelihood > 0.6';
      case 'high_click': return 'AND p.click_score > 0.5';
      case 'high_ltv': return `AND p.ltv_365d > (SELECT COALESCE(AVG(ltv_365d), 0) * 2 FROM cdp_customer_predictions WHERE company_id = $1::uuid)`;
      case 'first_purchase': return 'AND COALESCE(c.purchase_count, 0) = 0';
      case 'repurchase': return 'AND p.next_purchase_days BETWEEN 0 AND 14';
      // ★ 2026-07-03 Gap5 Layer1: cold 버전 bump(v1.1-cold) 대응 — suffix 비교(버전 무관 영구 안전)
      case 'cold_start': return `AND p.model_version LIKE '%-cold'`;
      case 'all':
      default: return '';
    }
  })();

  // 정렬 ORDER BY 매트릭스
  const orderClause = (() => {
    switch (sort) {
      case 'purchase_likelihood_desc': return 'ORDER BY p.purchase_likelihood DESC, p.churn_risk DESC';
      case 'click_score_desc': return 'ORDER BY p.click_score DESC, p.churn_risk DESC';
      case 'ltv_365d_desc': return 'ORDER BY p.ltv_365d DESC NULLS LAST';
      case 'last_activity_asc': return 'ORDER BY c.recent_purchase_date ASC NULLS LAST';
      case 'last_activity_desc': return 'ORDER BY c.recent_purchase_date DESC NULLS LAST';
      case 'churn_risk_desc':
      default: return 'ORDER BY p.churn_risk DESC, c.recent_purchase_date ASC NULLS LAST';
    }
  })();

  // 검색 ILIKE 매트릭스 (4 영역 OR)
  const params: any[] = [companyId];
  let searchClause = '';
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    searchClause = `AND (
      c.name ILIKE $${idx}
      OR c.phone ILIKE $${idx}
      OR COALESCE(c.grade, '') ILIKE $${idx}
      OR COALESCE(c.region, '') ILIKE $${idx}
    )`;
  }

  // 전체 카운트 (회사 cdp_customer_predictions 영역 총합)
  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM cdp_customer_predictions p
     WHERE p.company_id = $1::uuid`,
    [companyId]
  );
  const totalCount = Number(totalRes.rows[0]?.total) || 0;

  // 필터 + 검색 적용 카운트
  const filteredRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM cdp_customer_predictions p
     INNER JOIN customers c ON c.id = p.customer_id
     WHERE p.company_id = $1::uuid
       ${filterClause}
       ${searchClause}`,
    params
  );
  const filteredCount = Number(filteredRes.rows[0]?.total) || 0;

  // 데이터 조회 (페이지네이션 적용)
  params.push(limit);
  params.push(offset);
  const dataRes = await query(
    `SELECT
       p.customer_id, c.name, c.phone, c.grade, c.region,
       p.click_score, p.churn_risk, p.purchase_likelihood, p.model_version,
       p.ltv_60d, p.ltv_90d, p.ltv_365d,
       p.next_purchase_days, p.channel_preference, p.best_hour, p.tone_preference,
       CASE WHEN c.recent_purchase_date IS NOT NULL THEN
         EXTRACT(EPOCH FROM (NOW() - c.recent_purchase_date)) / 86400
       ELSE NULL END AS last_activity_days
     FROM cdp_customer_predictions p
     INNER JOIN customers c ON c.id = p.customer_id
     WHERE p.company_id = $1::uuid
       ${filterClause}
       ${searchClause}
     ${orderClause}
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  const customers = dataRes.rows.map(rowToCustomer);
  const totalPages = filteredCount > 0 ? Math.ceil(filteredCount / limit) : 0;

  return {
    customers,
    totalCount,
    filteredCount,
    page,
    totalPages,
    limit,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 헬퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function neutralPredictions(): CustomerPredictions {
  return {
    clickScore: NEUTRAL_VALUE,
    churnRisk: NEUTRAL_VALUE,
    purchaseLikelihood: NEUTRAL_VALUE,
    // ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): 중립값 fallback
    ltv60d: 0,
    ltv90d: 0,
    ltv365d: 0,
    nextPurchaseDays: null,
    channelPreference: null,
    bestHour: null,
    tonePreference: null,
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. ★ D210+ Phase 3 (2026-05-23 Harold 명시): computeCompanyPredictionsBatch
//    회사 전체 customer 영역 1 joint SQL UPSERT 매트릭스 — limit 영역 영구 폐기
//
//    옛 매트릭스 한계:
//      - recomputeCompanyPredictions = 5,000 limit + 단일 customer 1 SQL × N (4 sub-SELECT)
//      - 29,997명 회사 영역 = 1 cron당 5,000명 / 6시간 전수 / 24h TTL cycle
//      - 큰 회사 영역 stable coverage X / Dashboard 회사 admin 인지 사고
//
//    신규 매트릭스:
//      - 회사 전체 customer 영역 1 SQL UPSERT (CTE + window function)
//      - 29,997명 영역 ≈ 3~10초 영역 (1 cron 진입 안 전수 갱신 완료)
//      - 회사 admin Dashboard 영역 회사 전체 영역 영구 표시 정합
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CompanyBatchResult {
  updated: number;
  trainedCount: number;
  coldCount: number;
}

export async function computeCompanyPredictionsBatch(
  companyId: string,
): Promise<CompanyBatchResult> {
  try {
    const r = await query(
      `WITH base_customers AS (
        SELECT
          c.id, c.grade, c.recent_purchase_date, c.purchase_count, c.created_at,
          COALESCE(c.total_purchase_amount, 0) AS total_purchase_amount
        FROM customers c
        WHERE c.company_id = $1::uuid
      ),
      click_events AS (
        SELECT
          customer_id,
          MAX(occurred_at) AS last_click_at,
          COUNT(*)::int AS total_clicks
        FROM cdp_events
        WHERE company_id = $1::uuid
          AND event_name = 'message_click'
          AND customer_id IS NOT NULL
        GROUP BY customer_id
      ),
      sent_logs AS (
        SELECT
          e.customer_id,
          COUNT(*)::int AS total_sent
        FROM journey_step_logs l
        JOIN journey_executions e ON e.id = l.execution_id
        WHERE l.status = 'sent'
          AND e.customer_id IN (SELECT id FROM base_customers)
        GROUP BY e.customer_id
      ),
      enriched AS (
        SELECT
          c.id,
          COALESCE(c.grade, '일반') AS grade,
          COALESCE(c.purchase_count, 0) AS purchase_count,
          c.total_purchase_amount,
          c.created_at,
          cl.last_click_at,
          COALESCE(cl.total_clicks, 0) AS total_clicks,
          -- ★ 2026-07-03 Gap5 Layer2: 분모 = 여정 발송 + 고객별 발송 카운터 합산 (TS computePredictions와 동일 의무)
          COALESCE(s.total_sent, 0) + COALESCE(css.total_sent, 0) AS total_sent,
          GREATEST(
            COALESCE(c.recent_purchase_date, '1970-01-01'::timestamptz),
            COALESCE(cl.last_click_at, '1970-01-01'::timestamptz),
            c.created_at
          ) AS last_activity_at,
          -- ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): 평균 객단가 영역
          CASE WHEN COALESCE(c.purchase_count, 0) > 0
            THEN c.total_purchase_amount / c.purchase_count
            ELSE (CASE COALESCE(c.grade, '일반')
              WHEN 'VIP' THEN 150000
              WHEN 'Gold' THEN 80000
              WHEN 'Silver' THEN 45000
              WHEN '신규' THEN 25000
              ELSE 30000
            END)
          END AS avg_purchase_amount
        FROM base_customers c
        LEFT JOIN click_events cl ON cl.customer_id = c.id
        LEFT JOIN sent_logs s ON s.customer_id = c.id
        -- ★ 2026-07-03 Gap5 Layer2: 고객별 발송 카운터 (PK JOIN — 비용 무시 수준)
        LEFT JOIN customer_send_stats css ON css.customer_id = c.id
      ),
      computed AS (
        SELECT
          id,
          total_sent,
          -- click_score: trained (Beta-Laplace smoothing) 또는 cold start (grade fallback + recency adjust)
          CASE
            WHEN total_sent >= 3 THEN
              GREATEST(0.0::numeric, LEAST(1.0::numeric,
                ((total_clicks + 1.0) / (total_sent + 2.0))::numeric
              ))
            ELSE
              GREATEST(0.0::numeric, LEAST(1.0::numeric, (
                (CASE grade
                  WHEN 'VIP' THEN 0.32
                  WHEN 'Gold' THEN 0.24
                  WHEN 'Silver' THEN 0.18
                  WHEN '신규' THEN 0.20
                  WHEN '일반' THEN 0.12
                  ELSE 0.15
                END)
                + (CASE
                    WHEN last_click_at IS NULL THEN 0
                    WHEN EXTRACT(EPOCH FROM (NOW() - last_click_at)) / 86400 <= 30 THEN 0.10
                    WHEN EXTRACT(EPOCH FROM (NOW() - last_click_at)) / 86400 >= 60 THEN -0.05
                    ELSE 0
                  END)
                -- ★ 2026-07-03 Gap5 Layer1: 클릭 횟수 가산 (1회당 +0.02, 상한 +0.10) — TS computePredictions와 동일 공식 의무
                + LEAST(0.02 * total_clicks, 0.10)
              )::numeric))
          END AS click_score,
          -- churn_risk = sigmoid((daysSinceActivity - 60) / 20) — 60일 0.5, 90일 0.78, 120일 0.95
          GREATEST(0.0::numeric, LEAST(1.0::numeric,
            (1.0 / (1.0 + EXP(-((EXTRACT(EPOCH FROM (NOW() - last_activity_at)) / 86400 - 60) / 20))))::numeric
          )) AS churn_risk,
          -- purchase_likelihood: trained (purchase_rate + recency + click + base) 또는 cold start (grade + recency)
          CASE
            WHEN total_sent >= 3 AND purchase_count > 0 THEN
              GREATEST(0.0::numeric, LEAST(1.0::numeric, (
                (LEAST(purchase_count::numeric / GREATEST(total_sent::numeric, 1.0), 1.0) * 0.6)
                + (CASE
                    WHEN EXTRACT(EPOCH FROM (NOW() - last_activity_at)) / 86400 <= 30 THEN 0.15
                    WHEN EXTRACT(EPOCH FROM (NOW() - last_activity_at)) / 86400 <= 90 THEN 0.05
                    ELSE -0.10
                  END)
                + (CASE WHEN total_clicks > 0 THEN 0.08 ELSE 0 END)
                + 0.20
              )::numeric))
            ELSE
              GREATEST(0.0::numeric, LEAST(1.0::numeric, (
                (CASE grade
                  WHEN 'VIP' THEN 0.28
                  WHEN 'Gold' THEN 0.18
                  WHEN 'Silver' THEN 0.12
                  WHEN '신규' THEN 0.15
                  ELSE 0.08
                END)
                + (CASE
                    WHEN EXTRACT(EPOCH FROM (NOW() - last_activity_at)) / 86400 <= 30 THEN 0.10
                    WHEN EXTRACT(EPOCH FROM (NOW() - last_activity_at)) / 86400 <= 90 THEN 0
                    ELSE -0.08
                  END)
                -- ★ 2026-07-03 Gap5 Layer1: 클릭 실측 보너스 (trained clickBoost 0.08 동일 상수) — TS와 동일 공식 의무
                + (CASE WHEN total_clicks > 0 THEN 0.08 ELSE 0 END)
              )::numeric))
          END AS purchase_likelihood,
          -- ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): recency_factor 영역
          (CASE
            WHEN EXTRACT(EPOCH FROM (NOW() - last_activity_at)) / 86400 <= 30 THEN 1.1
            WHEN EXTRACT(EPOCH FROM (NOW() - last_activity_at)) / 86400 <= 90 THEN 1.0
            ELSE 0.6
          END) AS recency_factor,
          avg_purchase_amount,
          -- ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): next_purchase_days 영역 (평균 영역 간격 - 마지막 활동 영역)
          CASE
            WHEN purchase_count >= 2 THEN
              GREATEST(0, ROUND(
                ((EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400) / GREATEST(purchase_count, 1))
                - (EXTRACT(EPOCH FROM (NOW() - last_activity_at)) / 86400)
              ))::int
            WHEN total_sent >= 3 THEN 60
            ELSE NULL
          END AS next_purchase_days
        FROM enriched
      )
      INSERT INTO cdp_customer_predictions
        (customer_id, company_id, click_score, churn_risk, purchase_likelihood,
         ltv_60d, ltv_90d, ltv_365d, next_purchase_days,
         computed_at, model_version)
      SELECT
        id, $1::uuid,
        ROUND(click_score, 3),
        ROUND(churn_risk, 3),
        ROUND(purchase_likelihood, 3),
        -- ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): LTV 60/90/365일 영역
        ROUND(avg_purchase_amount * purchase_likelihood * 2 * recency_factor)::int,
        ROUND(avg_purchase_amount * purchase_likelihood * 3 * recency_factor)::int,
        ROUND(avg_purchase_amount * purchase_likelihood * 12 * recency_factor)::int,
        next_purchase_days,
        NOW(),
        -- ★ 2026-07-03 Gap5 Layer1: cold 공식 보정 → v1.1-cold (TS COLD_START_VERSION과 동일 유지 의무)
        CASE WHEN total_sent >= 3 THEN 'v1.0-trained' ELSE 'v1.1-cold' END
      FROM computed
      ON CONFLICT (customer_id) DO UPDATE SET
        click_score = EXCLUDED.click_score,
        churn_risk = EXCLUDED.churn_risk,
        purchase_likelihood = EXCLUDED.purchase_likelihood,
        ltv_60d = EXCLUDED.ltv_60d,
        ltv_90d = EXCLUDED.ltv_90d,
        ltv_365d = EXCLUDED.ltv_365d,
        next_purchase_days = EXCLUDED.next_purchase_days,
        computed_at = EXCLUDED.computed_at,
        model_version = EXCLUDED.model_version
      RETURNING model_version`,
      [companyId]
    );

    let trainedCount = 0;
    let coldCount = 0;
    for (const row of r.rows) {
      if (row.model_version === 'v1.0-trained') trainedCount++;
      else coldCount++;
    }

    return {
      updated: r.rows.length,
      trainedCount,
      coldCount,
    };
  } catch (err: any) {
    console.error('[Predictive] computeCompanyPredictionsBatch 오류:', err?.message);
    throw err;
  }
}
