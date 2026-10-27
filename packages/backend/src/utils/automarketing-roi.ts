/**
 * automarketing-roi.ts — 자동마케팅 매출 귀속(ROI) (2026-07-02 3차, Harold 확정)
 *
 * "이번 기간 자동마케팅이 만든 매출 ₩X / 쓴 비용 ₩Y" — 서비스를 요금이 아니라 투자수익으로 증명.
 *
 * 귀속 규칙 (CT-69 campaign-response-attribution의 검증된 패턴을 자동마케팅 캠페인으로 한정):
 *  - 대상 캠페인 = operator_proposals(status='sent') → campaigns (sent_at 실측)
 *  - 매출 = 각 캠페인 **실수신자**의 sent_at 이후 7일 안 cdp_events purchase/order 의 properties.total_amount 합 (실측 · ★ 2026-09-27 R165)
 *  - 비용 = 해당 제안 cost_estimate 합 (회사별 단가 × 수량 — 1단계에서 회사 단가로 교정된 값)
 *  - CDP 미연동 회사 = 매출 귀속 불가를 숨기지 않고 hasCdpData=false 로 정직하게 반환 (임의 추정 0)
 */

import { query } from '../config/database';
import { recipientPhonesOfCampaign } from './recipient-conversion';
import { netPurchaseSql } from './cdp-order-revenue';

/** 매출 귀속에서 훑는 캠페인 수 — 캠페인마다 발송 큐를 읽으므로 최근 것부터 이만큼만(넘으면 source에 표기). */
const ROI_CAMPAIGN_SCAN_LIMIT = 100;

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

/**
 * ★ 2026-10-25 원장 #30 · #31 — 한 캠페인의 실수신자 구매(발송 뒤 7일 · 결제 확정 · 미환불 · 같은 주문 한 번) → 주문 키 · 금액.
 *   ROI · 담당자 성과 문자 · A/B 밴딧 전환이 이 함수 하나로 센다(옛: 성과 문자 · 밴딧은 발송 뒤 7일의 회사 전체 구매를 셌다).
 *   until = 창 끝을 더 앞으로(밴딧 = 다음 자동마케팅 발송 전까지 · 한 구매를 두 제안에 귀속하지 않게) · null = 수신자를 확인하지 못함(세지 않는다).
 */
export async function campaignRecipientOrders(companyId: string, campaignId: string, until: Date | string | null = null): Promise<Map<string, number> | null> {
  const phones = await recipientPhonesOfCampaign(companyId, campaignId);
  if (phones === null) return null;
  const out = new Map<string, number>();
  if (phones.length === 0) return out;
  // 주문 단위로 판정한다(Codex 차수3 D 2R) — 같은 주문의 행 중 하나라도 환불 표식이면 그 주문 전체를 뺀다
  //   (재전송으로 행이 둘이면 환불 표식은 가장 오래된 한 행에만 남는다 · cdp-orders syncOrder).
  //   결제 확정 = CT-86 판정 조각 netPurchaseSql(★ 2026-10-27 자사몰 대비 K1-8 — 옛 「상태 없음 = 결제」 삭제 · 결제 전 주문은 성과가 아니다).
  const ev = await query(
    `SELECT x.order_key, MAX(x.amount) FILTER (WHERE x.paid) AS amount
       FROM (
         SELECT e.source || ':' || COALESCE(NULLIF(e.properties->>'order_id', ''), e.id::text) AS order_key,
                COALESCE((e.properties->>'total_amount')::numeric, 0)::float AS amount,
                COALESCE(e.properties->>'revenue_reversed', '') = 'true' AS reversed,
                COALESCE(${netPurchaseSql('e')}, false) AS paid
           FROM campaigns c
           JOIN cdp_events e ON e.company_id = $1::uuid
            AND e.event_name IN ('purchase', 'order')
            AND e.occurred_at >= c.sent_at
            AND e.occurred_at <= c.sent_at + INTERVAL '7 days'
            AND ($4::timestamptz IS NULL OR e.occurred_at < $4::timestamptz)
           JOIN customers cu ON cu.id = e.customer_id AND cu.company_id = $1::uuid
          WHERE c.id = $2::uuid
            AND regexp_replace(COALESCE(cu.phone, ''), '\\D', '', 'g') = ANY($3::text[])
       ) x
      GROUP BY x.order_key
     HAVING NOT bool_or(x.reversed) AND bool_or(x.paid)`,
    [companyId, campaignId, phones, until ? new Date(until).toISOString() : null],
  );
  for (const x of ev.rows) out.set(String(x.order_key), Number(x.amount) || 0);
  return out;
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
  // ★ 2026-09-27 한줄로 V2 R164 — 있는지만 본다(EXISTS · 옛: 기간 안 전 이벤트 COUNT)
  const cdpCheck = await query(
    `SELECT EXISTS (
       SELECT 1 FROM cdp_events
        WHERE company_id = $1::uuid AND occurred_at > NOW() - ($2 || ' days')::interval
     ) AS has_cdp`,
    [companyId, days + 30],
  );
  const hasCdpData = cdpCheck.rows[0]?.has_cdp === true;

  // ★ 2026-09-27 한줄로 V2 R165 — 실수신자(발송 성공 번호)의 구매만 자동마케팅 매출로 센다(CT recipient-conversion).
  //   옛: 발송 뒤 7일 창 안의 회사 전체 구매 합계 = '자동마케팅이 만든 매출'(수신자 무관)이라 부풀었다.
  //   같은 주문은 한 번만 센다(주문번호 · 없으면 이벤트 id) · 결제 확정·미환불 주문만 매출로 센다.
  let purchases7d = 0;
  let revenue7dKrw = 0;
  let unreadableCampaigns = 0;
  let scannedCampaigns = 0;
  if (hasCdpData) {
    const camps = await query(
      `SELECT c.id
         FROM operator_proposals p
         JOIN campaigns c ON c.id = p.campaign_id
        WHERE p.company_id = $1::uuid
          AND p.status = 'sent'
          AND p.campaign_id IS NOT NULL
          AND c.sent_at IS NOT NULL
          AND c.sent_at > NOW() - ($2 || ' days')::interval
        ORDER BY c.sent_at DESC
        LIMIT ${ROI_CAMPAIGN_SCAN_LIMIT}`,
      [companyId, days],
    );
    scannedCampaigns = camps.rows.length;
    const seenEvents = new Map<string, number>();
    for (const row of camps.rows) {
      const orders = await campaignRecipientOrders(companyId, String(row.id));
      if (orders === null) { unreadableCampaigns++; continue; }
      // 같은 주문(출처·주문번호)은 한 번 — 재전송으로 이벤트 행이 둘이어도, 창이 겹친 캠페인끼리도(Codex 차수3 D 1R)
      for (const [k, v] of orders) seenEvents.set(k, v);
    }
    purchases7d = seenEvents.size;
    revenue7dKrw = Math.round(Array.from(seenEvents.values()).reduce((a, b) => a + b, 0));
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
      ? '자동마케팅 캠페인 실수신자(발송 성공 번호)의 발송 후 7일 안 자사몰 구매 귀속'
        + (campaigns > scannedCampaigns ? ` · 최근 ${scannedCampaigns}개 캠페인 기준` : '')
        + (unreadableCampaigns > 0 ? ` · 수신자 확인 못 한 캠페인 ${unreadableCampaigns}개 제외` : '')
      : 'CDP 미연동: 매출 귀속 불가 (비용·발송 실측만)',
  };
}
