/**
 * automarketing-roi.ts — 자동마케팅 매출 귀속(ROI) (2026-07-02 3차, Harold 확정)
 *
 * "이번 기간 자동마케팅이 만든 매출 ₩X / 쓴 비용 ₩Y" — 서비스를 요금이 아니라 투자수익으로 증명.
 *
 * 귀속 규칙 (CT-69 campaign-response-attribution의 검증된 패턴을 자동마케팅 캠페인으로 한정):
 *  - 대상 캠페인 = operator_proposals(status='sent') → campaigns (sent_at 실측)
 *  - 매출 = 각 캠페인 sent_at 이후 7일 안 cdp_events purchase/order 의 properties.total_amount 합 (실측)
 *  - 비용 = 해당 제안 cost_estimate 합 (회사별 단가 × 수량 — 1단계에서 회사 단가로 교정된 값)
 *  - CDP 미연동 회사 = 매출 귀속 불가를 숨기지 않고 hasCdpData=false 로 정직하게 반환 (임의 추정 0)
 */

import { query } from '../config/database';

export interface AutoMarketingRoi {
  analysisPeriodDays: number;
  campaigns: number;          // 기간 안 자동마케팅 발송 캠페인 수
  totalSent: number;          // 발송 합 (campaigns.sent_count 실측)
  spendKrw: number;           // 비용 합 (proposals.cost_estimate)
  purchases7d: number;        // 발송 후 7일 안 구매 이벤트 수 (cdp 실측)
  revenue7dKrw: number;       // 발송 후 7일 안 귀속 매출 (cdp properties.total_amount 합)
  hasCdpData: boolean;
  source: string;
}

export async function buildAutoMarketingRoi(
  companyId: string,
  analysisPeriodDays: number = 30,
): Promise<AutoMarketingRoi> {
  const days = Math.max(1, Math.min(365, Math.floor(analysisPeriodDays) || 30));

  // 1) 기간 안 자동마케팅 발송 캠페인 + 비용 합
  const base = await query(
    `SELECT COUNT(*)::int AS campaigns,
            COALESCE(SUM(c.sent_count), 0)::int AS total_sent,
            COALESCE(SUM(p.cost_estimate), 0)::float AS spend
       FROM operator_proposals p
       JOIN campaigns c ON c.id = p.campaign_id
      WHERE p.company_id = $1::uuid
        AND p.status = 'sent'
        AND p.campaign_id IS NOT NULL
        AND c.sent_at IS NOT NULL
        AND c.sent_at > NOW() - ($2 || ' days')::interval`,
    [companyId, days],
  );
  const b = base.rows[0] || {};
  const campaigns = Number(b.campaigns) || 0;
  const totalSent = Number(b.total_sent) || 0;
  const spendKrw = Math.round(Number(b.spend) || 0);

  if (campaigns === 0) {
    return {
      analysisPeriodDays: days, campaigns: 0, totalSent: 0, spendKrw: 0,
      purchases7d: 0, revenue7dKrw: 0, hasCdpData: false,
      source: `${days}일 안 자동마케팅 발송 없음`,
    };
  }

  // 2) CDP 데이터 보유 여부 (귀속 가능성 — 미연동이면 매출 귀속 불가를 정직하게 표기)
  const cdpCheck = await query(
    `SELECT COUNT(*)::int AS cnt FROM cdp_events
      WHERE company_id = $1::uuid AND occurred_at > NOW() - ($2 || ' days')::interval`,
    [companyId, days + 30],
  );
  const hasCdpData = Number(cdpCheck.rows[0]?.cnt) > 0;

  let purchases7d = 0;
  let revenue7dKrw = 0;
  if (hasCdpData) {
    const rev = await query(
      `SELECT COUNT(*)::int AS purchase_count,
              COALESCE(SUM((e.properties->>'total_amount')::numeric), 0)::float AS revenue
         FROM cdp_events e
        WHERE e.company_id = $1::uuid
          AND e.event_name IN ('purchase', 'order')
          AND EXISTS (
            SELECT 1
              FROM operator_proposals p
              JOIN campaigns c ON c.id = p.campaign_id
             WHERE p.company_id = $1::uuid
               AND p.status = 'sent'
               AND p.campaign_id IS NOT NULL
               AND c.sent_at IS NOT NULL
               AND c.sent_at > NOW() - ($2 || ' days')::interval
               AND e.occurred_at >= c.sent_at
               AND e.occurred_at <= c.sent_at + INTERVAL '7 days'
          )`,
      [companyId, days],
    );
    purchases7d = Number(rev.rows[0]?.purchase_count) || 0;
    revenue7dKrw = Math.round(Number(rev.rows[0]?.revenue) || 0);
  }

  return {
    analysisPeriodDays: days,
    campaigns,
    totalSent,
    spendKrw,
    purchases7d,
    revenue7dKrw,
    hasCdpData,
    source: hasCdpData
      ? '자동마케팅 캠페인 sent_at + 7일 안 cdp_events purchase/order 귀속 (시간 윈도우 합집합)'
      : 'CDP 미연동 — 매출 귀속 불가 (비용·발송 실측만)',
  };
}
