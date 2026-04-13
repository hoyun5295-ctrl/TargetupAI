/**
 * ★ CT-F09 — 전단AI 대시보드 통계 집계 컨트롤타워
 *
 * 한줄로 utils/stats-aggregation.ts와 완전 분리.
 * - flyer_campaigns 기반 발송 통계
 * - url_clicks 기반 클릭 추적
 * - flyer_customers 기반 고객 통계
 * - Phase B: flyer_pos_sales 기반 ROI 집계
 */

import { query } from '../../../config/database';

export interface FlyerDashboardStats {
  totalCustomers: number;
  totalCampaigns: number;
  totalSent: number;
  totalSuccess: number;
  totalClicks: number;
  monthlyStats: { month: string; campaigns: number; sent: number; success: number; clicks: number }[];
}

/**
 * 전단AI 대시보드 상단 카드 + 월별 추이.
 */
export async function getFlyerDashboardStats(companyId: string): Promise<FlyerDashboardStats> {
  // 고객 수
  const custResult = await query(
    `SELECT COUNT(*)::int AS cnt FROM flyer_customers WHERE company_id = $1 AND deleted_at IS NULL`,
    [companyId]
  );

  // 캠페인 집계
  const campaignResult = await query(
    `SELECT
       COUNT(*)::int AS total_campaigns,
       COALESCE(SUM(sent_count), 0)::int AS total_sent,
       COALESCE(SUM(success_count), 0)::int AS total_success
     FROM flyer_campaigns
     WHERE company_id = $1 AND status IN ('completed', 'sending')`,
    [companyId]
  );

  // 클릭 수 (URL 클릭 추적 — short_urls + url_clicks 기반)
  const clickResult = await query(
    `SELECT COUNT(*)::int AS cnt
     FROM url_clicks uc
     JOIN short_urls su ON su.id = uc.short_url_id
     WHERE su.company_id = $1`,
    [companyId]
  );

  // 최근 6개월 월별 추이
  const monthlyResult = await query(
    `SELECT
       TO_CHAR(sent_at, 'YYYY-MM') AS month,
       COUNT(*)::int AS campaigns,
       COALESCE(SUM(sent_count), 0)::int AS sent,
       COALESCE(SUM(success_count), 0)::int AS success
     FROM flyer_campaigns
     WHERE company_id = $1 AND sent_at IS NOT NULL
       AND sent_at >= NOW() - INTERVAL '6 months'
     GROUP BY TO_CHAR(sent_at, 'YYYY-MM')
     ORDER BY month DESC`,
    [companyId]
  );

  // 월별 클릭 (매칭)
  const monthlyClicks = await query(
    `SELECT
       TO_CHAR(uc.clicked_at, 'YYYY-MM') AS month,
       COUNT(*)::int AS clicks
     FROM url_clicks uc
     JOIN short_urls su ON su.id = uc.short_url_id
     WHERE su.company_id = $1
       AND uc.clicked_at >= NOW() - INTERVAL '6 months'
     GROUP BY TO_CHAR(uc.clicked_at, 'YYYY-MM')`,
    [companyId]
  );
  const clickMap = new Map(monthlyClicks.rows.map((r: any) => [r.month, r.clicks]));

  return {
    totalCustomers: custResult.rows[0]?.cnt || 0,
    totalCampaigns: campaignResult.rows[0]?.total_campaigns || 0,
    totalSent: campaignResult.rows[0]?.total_sent || 0,
    totalSuccess: campaignResult.rows[0]?.total_success || 0,
    totalClicks: clickResult.rows[0]?.cnt || 0,
    monthlyStats: monthlyResult.rows.map((r: any) => ({
      month: r.month,
      campaigns: r.campaigns,
      sent: r.sent,
      success: r.success,
      clicks: clickMap.get(r.month) || 0,
    })),
  };
}

/**
 * 개별 캠페인 발송 결과 상세 (ResultsPage용).
 */
export async function getFlyerCampaignResults(
  companyId: string,
  page: number = 1,
  pageSize: number = 20,
): Promise<{ items: any[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * pageSize;

  const countResult = await query(
    `SELECT COUNT(*)::int AS cnt FROM flyer_campaigns WHERE company_id = $1`,
    [companyId]
  );

  const listResult = await query(
    `SELECT fc.id, fc.message_type, fc.message_content, fc.is_ad,
            fc.callback_number, fc.total_recipients, fc.sent_count,
            fc.success_count, fc.fail_count, fc.status, fc.sent_at, fc.created_at,
            f.title AS flyer_title,
            su.code AS short_url_code,
            (SELECT COUNT(*)::int FROM url_clicks uc WHERE uc.short_url_id = fc.short_url_id) AS click_count
     FROM flyer_campaigns fc
     LEFT JOIN flyers f ON f.id = fc.flyer_id
     LEFT JOIN short_urls su ON su.id = fc.short_url_id
     WHERE fc.company_id = $1
     ORDER BY fc.created_at DESC
     LIMIT $2 OFFSET $3`,
    [companyId, pageSize, offset]
  );

  return { items: listResult.rows, total: countResult.rows[0]?.cnt || 0 };
}
