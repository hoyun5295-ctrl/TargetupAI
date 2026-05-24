/**
 * ★ CT-65: 가입월별 Retention Curve 컨트롤타워 — D213+ (2026-05-24)
 *
 * 🎯 목적
 *   회사 customers 가입월별 cohort + N개월 안 active retention curve 매트릭스.
 *   - 4번 메뉴 성과리포트 "코호트 retention" 영역 진정 데이터 영역 source
 *   - 데이터 source = customers.recent_purchase_date (CDP 미연동 회사 fallback 정합)
 *   - 향후 강화 = cdp_events.purchase 영역 통합 (CDP 연동 회사 정확도 향상)
 *
 * ⛔ 영구 원칙
 *   - CDP 미연동 회사 = 정상 작동 의무 (recent_purchase_date 영역 fallback)
 *   - 가입 기간 12개월 + retention 4 단계 (M1 / M2 / M3 / M6) — 시인성 정합
 *   - Source caption 의무 (feedback_no_mock_data_in_production)
 *   - PG 캐시 X (D144) — customers 영역 직접 SELECT 정합
 */

import { query } from '../config/database';

export interface CohortRow {
  cohortMonth: string;        // 'YYYY-MM'
  totalCustomers: number;
  m1Active: number;            // 가입 후 30일 안 구매
  m2Active: number;            // 60일
  m3Active: number;            // 90일
  m6Active: number;            // 180일
  m1Rate: number;
  m2Rate: number;
  m3Rate: number;
  m6Rate: number;
}

export interface CohortResult {
  cohorts: CohortRow[];
  totalCohortCustomers: number;
  avgM1Rate: number;
  avgM3Rate: number;
  source: string;
  computedAt: string;
}

/**
 * 가입월별 Retention Curve 매트릭스.
 *
 * 가입 후 N일 안 recent_purchase_date 갱신 영역 = active 정의.
 * CDP 미연동 회사 영역 정합 (recent_purchase_date 영역 = 자사몰 sync agent 또는 매장 직접 update).
 *
 * @param companyId - 회사 ID
 * @param months - 최근 N개월 cohort (default 12)
 */
export async function buildCohortRetention(companyId: string, months: number = 12): Promise<CohortResult> {
  const result = await query(
    `WITH cohort_data AS (
       SELECT
         TO_CHAR(c.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS cohort_month,
         c.id AS customer_id,
         (c.created_at AT TIME ZONE 'Asia/Seoul')::date AS signup_date,
         c.recent_purchase_date
       FROM customers c
       WHERE c.company_id = $1::uuid
         AND c.created_at > NOW() - ($2 || ' months')::interval
     )
     SELECT
       cohort_month,
       COUNT(DISTINCT customer_id)::int AS total_customers,
       COUNT(DISTINCT customer_id) FILTER (
         WHERE recent_purchase_date IS NOT NULL
           AND recent_purchase_date >= signup_date
           AND recent_purchase_date < signup_date + INTERVAL '30 days'
       )::int AS m1_active,
       COUNT(DISTINCT customer_id) FILTER (
         WHERE recent_purchase_date IS NOT NULL
           AND recent_purchase_date >= signup_date
           AND recent_purchase_date < signup_date + INTERVAL '60 days'
       )::int AS m2_active,
       COUNT(DISTINCT customer_id) FILTER (
         WHERE recent_purchase_date IS NOT NULL
           AND recent_purchase_date >= signup_date
           AND recent_purchase_date < signup_date + INTERVAL '90 days'
       )::int AS m3_active,
       COUNT(DISTINCT customer_id) FILTER (
         WHERE recent_purchase_date IS NOT NULL
           AND recent_purchase_date >= signup_date
           AND recent_purchase_date < signup_date + INTERVAL '180 days'
       )::int AS m6_active
     FROM cohort_data
     GROUP BY cohort_month
     ORDER BY cohort_month DESC`,
    [companyId, months]
  );

  const cohorts: CohortRow[] = result.rows.map((r: any) => {
    const total = Number(r.total_customers) || 0;
    const m1 = Number(r.m1_active) || 0;
    const m2 = Number(r.m2_active) || 0;
    const m3 = Number(r.m3_active) || 0;
    const m6 = Number(r.m6_active) || 0;
    return {
      cohortMonth: String(r.cohort_month),
      totalCustomers: total,
      m1Active: m1,
      m2Active: m2,
      m3Active: m3,
      m6Active: m6,
      m1Rate: total > 0 ? m1 / total : 0,
      m2Rate: total > 0 ? m2 / total : 0,
      m3Rate: total > 0 ? m3 / total : 0,
      m6Rate: total > 0 ? m6 / total : 0,
    };
  });

  const totalCohortCustomers = cohorts.reduce((sum, c) => sum + c.totalCustomers, 0);
  const weightedM1 = cohorts.reduce((sum, c) => sum + c.m1Active, 0);
  const weightedM3 = cohorts.reduce((sum, c) => sum + c.m3Active, 0);

  return {
    cohorts,
    totalCohortCustomers,
    avgM1Rate: totalCohortCustomers > 0 ? weightedM1 / totalCohortCustomers : 0,
    avgM3Rate: totalCohortCustomers > 0 ? weightedM3 / totalCohortCustomers : 0,
    source: 'customers.created_at + customers.recent_purchase_date (CDP 미연동 회사 fallback — 향후 cdp_events.purchase 강화)',
    computedAt: new Date().toISOString(),
  };
}
