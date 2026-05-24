/**
 * ★ CT-69: 캠페인 진행 후 반응 attribution 컨트롤타워 — D213+ (2026-05-24)
 *
 * 🎯 목적
 *   캠페인 발송 후 24h / 7d / 30d 안 회사 전체 반응 매트릭스.
 *   - 4번 메뉴 성과리포트 "캠페인 반응 매트릭스" 영역 진정 데이터 source
 *   - Harold 명시 D213+ "캠페인 진행 후 반응 등 다양한 지표 연결"
 *
 * source 우선순위:
 *   1. cdp_events.purchase / order (CDP 연동 회사 — 정확한 매출)
 *   2. customers.recent_purchase_date (CDP 미연동 회사 fallback — 간접 attribution)
 *   3. campaigns.success_count (모든 회사 — 발송 성공률만)
 *
 * ⛔ 영구 원칙
 *   - 회사 전체 시간 윈도우 합집합 매트릭스 (캠페인별 정확 attribution = 다음 phase)
 *   - CDP 미연동 회사 = 정상 작동 의무 (fallback 정합)
 *   - Source caption 의무 (feedback_no_mock_data_in_production)
 *   - short_urls 영역 활용 X (전단AI 전용 — 한줄로 SMS/LMS/MMS 영역 X)
 */

import { query } from '../config/database';

export interface AttributionWindow {
  windowLabel: string;             // '24h' / '7d' / '30d'
  windowHours: number;
  cdpPurchaseCount: number;        // CDP purchase 이벤트 카운트
  cdpRevenue: number;              // CDP properties.total_amount SUM
  customerPurchaseCount: number;   // recent_purchase_date 갱신 customer 카운트
  source: string;
}

export interface AttributionResult {
  totalCampaigns: number;
  totalSent: number;
  totalSuccess: number;
  windows: AttributionWindow[];
  hasCdpData: boolean;
  analysisPeriodDays: number;
  computedAt: string;
  source: string;
}

/**
 * 회사 전체 N일 안 캠페인 발송 후 반응 매트릭스.
 *
 * @param companyId - 회사 ID
 * @param analysisPeriodDays - 분석 기간 (default 30일 — 이 기간 안 캠페인 모음)
 */
export async function buildCampaignAttribution(
  companyId: string,
  analysisPeriodDays: number = 30
): Promise<AttributionResult> {
  // 1) 분석 기간 안 캠페인 통계 + sent_at 모음
  const campaignsResult = await query(
    `SELECT
        id, sent_at, sent_count, success_count, message_type
      FROM campaigns
      WHERE company_id = $1::uuid
        AND status = 'completed'
        AND sent_at IS NOT NULL
        AND sent_at > NOW() - ($2 || ' days')::interval`,
    [companyId, analysisPeriodDays]
  );

  const campaigns = campaignsResult.rows;
  const totalCampaigns = campaigns.length;
  const totalSent = campaigns.reduce((s: number, c: any) => s + Number(c.sent_count || 0), 0);
  const totalSuccess = campaigns.reduce((s: number, c: any) => s + Number(c.success_count || 0), 0);

  if (totalCampaigns === 0) {
    return {
      totalCampaigns: 0,
      totalSent: 0,
      totalSuccess: 0,
      windows: [],
      hasCdpData: false,
      analysisPeriodDays,
      computedAt: new Date().toISOString(),
      source: '발송 캠페인 X — N일 안 발송 누적 후 활성',
    };
  }

  // 2) CDP 데이터 영역 확인 (analysisPeriod + 30일 lookahead)
  const cdpCheckResult = await query(
    `SELECT COUNT(*)::int AS cnt
       FROM cdp_events
      WHERE company_id = $1::uuid
        AND occurred_at > NOW() - ($2 || ' days')::interval`,
    [companyId, analysisPeriodDays + 30]
  );
  const hasCdpData = Number(cdpCheckResult.rows[0]?.cnt) > 0;

  // 3) 윈도우별 매트릭스 계산
  const windows: AttributionWindow[] = [];
  const windowDefs = [
    { label: '24h', hours: 24 },
    { label: '7d', hours: 168 },
    { label: '30d', hours: 720 },
  ];

  for (const w of windowDefs) {
    let cdpPurchaseCount = 0;
    let cdpRevenue = 0;

    if (hasCdpData) {
      // 캠페인 발송 후 N시간 안 cdp_events purchase/order 합집합 영역
      const cdpResult = await query(
        `SELECT
            COUNT(*)::int AS purchase_count,
            COALESCE(SUM((properties->>'total_amount')::numeric), 0)::float AS revenue
          FROM cdp_events e
          WHERE e.company_id = $1::uuid
            AND e.event_name IN ('purchase', 'order')
            AND EXISTS (
              SELECT 1
                FROM campaigns c
               WHERE c.company_id = $1::uuid
                 AND c.status = 'completed'
                 AND c.sent_at > NOW() - ($2 || ' days')::interval
                 AND e.occurred_at >= c.sent_at
                 AND e.occurred_at <= c.sent_at + ($3 || ' hours')::interval
            )`,
        [companyId, analysisPeriodDays, w.hours]
      );
      cdpPurchaseCount = Number(cdpResult.rows[0]?.purchase_count) || 0;
      cdpRevenue = Number(cdpResult.rows[0]?.revenue) || 0;
    }

    // customers.recent_purchase_date 갱신 카운트 (fallback)
    const customerResult = await query(
      `SELECT COUNT(DISTINCT cu.id)::int AS customer_count
         FROM customers cu
        WHERE cu.company_id = $1::uuid
          AND cu.recent_purchase_date IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM campaigns c
             WHERE c.company_id = $1::uuid
               AND c.status = 'completed'
               AND c.sent_at > NOW() - ($2 || ' days')::interval
               AND cu.recent_purchase_date >= (c.sent_at AT TIME ZONE 'Asia/Seoul')::date
               AND cu.recent_purchase_date <= ((c.sent_at + ($3 || ' hours')::interval) AT TIME ZONE 'Asia/Seoul')::date
          )`,
      [companyId, analysisPeriodDays, w.hours]
    );
    const customerPurchaseCount = Number(customerResult.rows[0]?.customer_count) || 0;

    windows.push({
      windowLabel: w.label,
      windowHours: w.hours,
      cdpPurchaseCount,
      cdpRevenue,
      customerPurchaseCount,
      source: hasCdpData
        ? 'cdp_events.purchase|order EXISTS (정확 매출) + customers.recent_purchase_date (fallback)'
        : 'customers.recent_purchase_date 간접 attribution (CDP 미연동)',
    });
  }

  return {
    totalCampaigns,
    totalSent,
    totalSuccess,
    windows,
    hasCdpData,
    analysisPeriodDays,
    computedAt: new Date().toISOString(),
    source: hasCdpData
      ? '캠페인 sent_at + N시간 안 cdp_events EXISTS 합집합 (회사 전체 시간 윈도우)'
      : 'CDP 미연동 — customers.recent_purchase_date 간접 attribution 영역만',
  };
}
