/**
 * ★ CT-66: 요금제별 벤치마크 컨트롤타워 — D213+ (2026-05-24)
 *
 * 🎯 목적
 *   회사 vs 같은 요금제 다른 회사 평균 격차 매트릭스.
 *   - 4번 메뉴 성과리포트 "회사 vs 업계 평균 벤치마크" 영역 진정 데이터 source
 *   - 회사 본 영역 + 같은 plan 다른 회사 평균 영역 격차 (±%)
 *
 * ⛔ 영구 원칙
 *   - 다른 회사 데이터 = anonymized 평균만 (개별 회사 노출 절대 X)
 *   - 벤치마크 = 상대 비교 본질 — PG campaigns 단순 집계 활용 정합
 *   - 정확한 카운트 = MySQL 큐 매월 사전 계산 = 다음 phase 본질
 *   - Source caption 의무 (feedback_no_mock_data_in_production)
 */

import { query } from '../config/database';

export interface BenchmarkMetric {
  label: string;
  companyValue: number;
  industryAvg: number;
  diffPct: number;            // (company - industry) / industry × 100
  betterThan: boolean;        // company > industry = 우위 (성공률/매출/활성 매트릭스)
  source: string;
}

export interface BenchmarkResult {
  planCode: string;
  planName: string;
  peerCompanyCount: number;   // 같은 plan 다른 회사 수
  metrics: BenchmarkMetric[];
  computedAt: string;
  source: string;
}

/**
 * 회사 vs 같은 요금제 다른 회사 평균 벤치마크 매트릭스.
 *
 * @param companyId - 회사 ID
 * @param days - 분석 기간 (default 30일)
 */
export async function buildBenchmark(companyId: string, days: number = 30): Promise<BenchmarkResult> {
  // 1) 회사 plan_id + plan_code 조회
  const planResult = await query(
    `SELECT c.plan_id, p.plan_code, p.plan_name
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1::uuid`,
    [companyId]
  );

  const planRow = planResult.rows[0] || {};
  const planId = planRow.plan_id;
  const planCode = String(planRow.plan_code || 'UNKNOWN');
  const planName = String(planRow.plan_name || planCode);

  if (!planId) {
    return {
      planCode,
      planName,
      peerCompanyCount: 0,
      metrics: [],
      computedAt: new Date().toISOString(),
      source: '회사 요금제 미등록 — 벤치마크 비활성',
    };
  }

  // 2) 같은 plan 회사 수 (회사 본인 제외)
  const peerCountResult = await query(
    `SELECT COUNT(*)::int AS cnt
       FROM companies
      WHERE plan_id = $1::uuid
        AND id != $2::uuid
        AND status = 'active'`,
    [planId, companyId]
  );
  const peerCompanyCount = Number(peerCountResult.rows[0]?.cnt) || 0;

  // 3) 회사 본인 매트릭스 (campaigns 30일)
  const companyMetricsResult = await query(
    `SELECT
        COUNT(*)::int AS total_campaigns,
        COALESCE(SUM(sent_count), 0)::bigint AS total_sent,
        COALESCE(SUM(success_count), 0)::bigint AS total_success,
        CASE WHEN SUM(sent_count) > 0
          THEN SUM(success_count)::float / SUM(sent_count)
          ELSE 0
        END AS success_rate
      FROM campaigns
      WHERE company_id = $1::uuid
        AND status = 'completed'
        AND sent_at > NOW() - ($2 || ' days')::interval`,
    [companyId, days]
  );

  const companyActiveCustomersResult = await query(
    `SELECT COUNT(*)::int AS cnt
       FROM customers
      WHERE company_id = $1::uuid
        AND is_active = true
        AND sms_opt_in = true`,
    [companyId]
  );

  const companyCampaigns = Number(companyMetricsResult.rows[0]?.total_campaigns) || 0;
  const companySent = Number(companyMetricsResult.rows[0]?.total_sent) || 0;
  const companySuccessRate = Number(companyMetricsResult.rows[0]?.success_rate) || 0;
  const companyActive = Number(companyActiveCustomersResult.rows[0]?.cnt) || 0;

  // 4) peer 회사 평균 매트릭스
  if (peerCompanyCount === 0) {
    return {
      planCode,
      planName,
      peerCompanyCount: 0,
      metrics: [],
      computedAt: new Date().toISOString(),
      source: '같은 요금제 다른 회사 X — 벤치마크 비활성',
    };
  }

  const peerMetricsResult = await query(
    `SELECT
        AVG(metrics.total_campaigns)::float AS avg_campaigns,
        AVG(metrics.total_sent)::float AS avg_sent,
        AVG(metrics.success_rate)::float AS avg_success_rate
       FROM (
         SELECT
           c.company_id,
           COUNT(*)::int AS total_campaigns,
           COALESCE(SUM(c.sent_count), 0)::bigint AS total_sent,
           CASE WHEN SUM(c.sent_count) > 0
             THEN SUM(c.success_count)::float / SUM(c.sent_count)
             ELSE 0
           END AS success_rate
         FROM campaigns c
         JOIN companies co ON c.company_id = co.id
         WHERE co.plan_id = $1::uuid
           AND co.id != $2::uuid
           AND co.status = 'active'
           AND c.status = 'completed'
           AND c.sent_at > NOW() - ($3 || ' days')::interval
         GROUP BY c.company_id
       ) metrics`,
    [planId, companyId, days]
  );

  const peerAvgCampaigns = Number(peerMetricsResult.rows[0]?.avg_campaigns) || 0;
  const peerAvgSent = Number(peerMetricsResult.rows[0]?.avg_sent) || 0;
  const peerAvgSuccessRate = Number(peerMetricsResult.rows[0]?.avg_success_rate) || 0;

  const peerActiveResult = await query(
    `SELECT AVG(cnt)::float AS avg_active
       FROM (
         SELECT cu.company_id, COUNT(*)::int AS cnt
           FROM customers cu
           JOIN companies co ON cu.company_id = co.id
          WHERE co.plan_id = $1::uuid
            AND co.id != $2::uuid
            AND co.status = 'active'
            AND cu.is_active = true
            AND cu.sms_opt_in = true
          GROUP BY cu.company_id
       ) sub`,
    [planId, companyId]
  );
  const peerAvgActive = Number(peerActiveResult.rows[0]?.avg_active) || 0;

  // 5) 격차 계산
  const calcDiff = (company: number, industry: number): number =>
    industry > 0 ? ((company - industry) / industry) * 100 : 0;

  const metrics: BenchmarkMetric[] = [
    {
      label: '월 발송 캠페인 수',
      companyValue: companyCampaigns,
      industryAvg: peerAvgCampaigns,
      diffPct: calcDiff(companyCampaigns, peerAvgCampaigns),
      betterThan: companyCampaigns > peerAvgCampaigns,
      source: 'campaigns (30일 완료 기준)',
    },
    {
      label: '월 발송 건수',
      companyValue: companySent,
      industryAvg: peerAvgSent,
      diffPct: calcDiff(companySent, peerAvgSent),
      betterThan: companySent > peerAvgSent,
      source: 'campaigns.sent_count (D144 PG 캐시 — 향후 MySQL 큐 사전 계산 강화)',
    },
    {
      label: '발송 성공률',
      companyValue: companySuccessRate,
      industryAvg: peerAvgSuccessRate,
      diffPct: calcDiff(companySuccessRate, peerAvgSuccessRate),
      betterThan: companySuccessRate > peerAvgSuccessRate,
      source: 'campaigns.success_count / sent_count (D144 PG 캐시)',
    },
    {
      label: '활성 고객 수',
      companyValue: companyActive,
      industryAvg: peerAvgActive,
      diffPct: calcDiff(companyActive, peerAvgActive),
      betterThan: companyActive > peerAvgActive,
      source: 'customers WHERE is_active=true AND sms_opt_in=true',
    },
  ];

  return {
    planCode,
    planName,
    peerCompanyCount,
    metrics,
    computedAt: new Date().toISOString(),
    source: `같은 요금제(${planCode}) ${peerCompanyCount}개 회사 평균 (anonymized — 개별 회사 노출 X)`,
  };
}
