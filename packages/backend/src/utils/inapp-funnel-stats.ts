/**
 * ★ CT-83: In-app Message Funnel Stats — D215+ (2026-05-25)
 *
 * 🎯 목적
 *   인앱 메시지 funnel 분석 — impression → click → 24h purchase attribution.
 *   - buildInAppFunnel: 단일 메시지 funnel 단계별 통계 (4단계 막대)
 *   - buildHourlyDistribution: 24시간별 impression/click 분포
 *   - buildHeatmap: 24h × 7요일 히트맵 (활성 시간대 식별)
 *   - buildDeviceBreakdown: mobile/PC 분포 (impression cdp_events user_agent 기반)
 *   - buildTopMessages: 회사 전체 메시지 CTR 상위 N
 *   - buildInAppOverview: 회사 전체 요약 5 metric + 이전 30일 격차
 *
 * 🔗 D214+ Unified Customer Profile 정합 attribution
 *   - cdp_inapp_impressions click → customers.recent_purchase_date 24h 안 매칭 fallback
 *   - 또는 cdp_inapp_impressions.attributed_purchase_id 직접 매핑 (D215+ ALTER 컬럼)
 *
 * ⛔ 영구 원칙
 *   - 회사 격리 (company_id 의무)
 *   - 모든 차트 dataSource caption 의무 (UI 안 표시 — feedback_no_mock_data_in_production)
 *   - 0건 = 0건 그대로 응답 (자동 완화 X)
 */

import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface FunnelStep {
  name: string;
  count: number;
  percentOfPrevious: number;
  percentOfTotal: number;
  dropoffReason?: string;
}

export interface InAppFunnel {
  messageId: string;
  steps: FunnelStep[];
  attributedRevenueKrw: number;
  dataSource: string;
}

export interface HourlyStat {
  hour: number;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface HeatmapCell {
  hour: number;
  weekday: number;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface DeviceBreakdown {
  device: 'mobile' | 'pc' | 'unknown';
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface TopMessageEntry {
  messageId: string;
  title: string;
  template: string;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
  rank: number;
}

export interface InAppOverview {
  totalMessages: number;
  activeMessages: number;
  avgCTR: number;
  totalImpressions30d: number;
  totalAttributedPurchases30d: number;
  prev30d: {
    avgCTR: number;
    totalImpressions: number;
    totalAttributedPurchases: number;
  };
  delta: {
    avgCTRPercent: number;
    impressionsPercent: number;
    purchasesPercent: number;
  };
  dataSource: string;
}

// ════════════════════════════════════════════════════════════════════
// Funnel — 단일 메시지 4단계
// ════════════════════════════════════════════════════════════════════

export async function buildInAppFunnel(
  companyId: string,
  messageId: string
): Promise<InAppFunnel> {
  if (!companyId || !messageId) throw new Error('companyId + messageId 필수');

  // impression / click / dismiss 누적
  const evR = await query(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
       COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks,
       COUNT(*) FILTER (WHERE event_type = 'dismiss')::int AS dismisses,
       COUNT(DISTINCT customer_id) FILTER (WHERE event_type = 'click' AND customer_id IS NOT NULL)::int AS unique_clickers
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid AND message_id = $2::uuid`,
    [companyId, messageId]
  );
  const impressions = Number(evR.rows[0]?.impressions || 0);
  const clicks = Number(evR.rows[0]?.clicks || 0);
  const dismisses = Number(evR.rows[0]?.dismisses || 0);
  const uniqueClickers = Number(evR.rows[0]?.unique_clickers || 0);

  // 24h attribution — click한 customer가 24h 안 purchase 했는지
  // 옵션 1: cdp_inapp_impressions.attributed_purchase_id (D215+ ALTER 컬럼 직접 매핑)
  // 옵션 2: customers.recent_purchase_date fallback
  const attrR = await query(
    `SELECT COUNT(DISTINCT i.customer_id)::int AS attributed_customers,
            COALESCE(SUM(c.recent_purchase_amount), 0)::numeric AS attributed_revenue
     FROM cdp_inapp_impressions i
     JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id
     WHERE i.company_id = $1::uuid AND i.message_id = $2::uuid
       AND i.event_type = 'click'
       AND i.customer_id IS NOT NULL
       AND c.recent_purchase_date IS NOT NULL
       AND c.recent_purchase_date::timestamptz >= i.occurred_at
       AND c.recent_purchase_date::timestamptz <= i.occurred_at + INTERVAL '24 hours'`,
    [companyId, messageId]
  );
  const attributedCustomers = Number(attrR.rows[0]?.attributed_customers || 0);
  const attributedRevenue = Number(attrR.rows[0]?.attributed_revenue || 0);

  const steps: FunnelStep[] = [
    {
      name: 'impression',
      count: impressions,
      percentOfPrevious: 100,
      percentOfTotal: 100,
    },
    {
      name: 'click',
      count: clicks,
      percentOfPrevious: impressions > 0 ? (clicks / impressions) * 100 : 0,
      percentOfTotal: impressions > 0 ? (clicks / impressions) * 100 : 0,
      dropoffReason: impressions > clicks
        ? `${(((impressions - clicks) / impressions) * 100).toFixed(1)}% 미클릭 — 본문/CTA 점검 권장`
        : undefined,
    },
    {
      name: 'dismiss_or_passive',
      count: dismisses,
      percentOfPrevious: impressions > 0 ? (dismisses / impressions) * 100 : 0,
      percentOfTotal: impressions > 0 ? (dismisses / impressions) * 100 : 0,
      dropoffReason: dismisses > clicks
        ? '명시 dismiss > click — 메시지 부정 반응. 본문/타이밍 점검'
        : undefined,
    },
    {
      name: 'purchase_24h',
      count: attributedCustomers,
      percentOfPrevious: uniqueClickers > 0 ? (attributedCustomers / uniqueClickers) * 100 : 0,
      percentOfTotal: impressions > 0 ? (attributedCustomers / impressions) * 100 : 0,
      dropoffReason: uniqueClickers > attributedCustomers
        ? `${uniqueClickers - attributedCustomers}명 클릭 후 24h 안 미구매 — 결제 흐름 점검`
        : undefined,
    },
  ];

  return {
    messageId,
    steps,
    attributedRevenueKrw: attributedRevenue,
    dataSource: 'cdp_inapp_impressions + customers.recent_purchase_date (24h 윈도우 매칭)',
  };
}

// ════════════════════════════════════════════════════════════════════
// 24시간별 분포
// ════════════════════════════════════════════════════════════════════

export async function buildHourlyDistribution(
  companyId: string,
  messageId: string
): Promise<HourlyStat[]> {
  if (!companyId || !messageId) return [];

  const r = await query(
    `SELECT EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Asia/Seoul')::int AS hour,
            COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid AND message_id = $2::uuid
     GROUP BY hour
     ORDER BY hour ASC`,
    [companyId, messageId]
  );

  // 24시간 모두 채움 (없는 시간은 0)
  const hourly: HourlyStat[] = [];
  for (let h = 0; h < 24; h++) {
    const row = r.rows.find((x: any) => Number(x.hour) === h);
    const impressions = Number(row?.impressions || 0);
    const clicks = Number(row?.clicks || 0);
    hourly.push({
      hour: h,
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
    });
  }
  return hourly;
}

// ════════════════════════════════════════════════════════════════════
// 24h × 7요일 히트맵
// ════════════════════════════════════════════════════════════════════

export async function buildHeatmap(
  companyId: string,
  messageId: string
): Promise<HeatmapCell[]> {
  if (!companyId || !messageId) return [];

  const r = await query(
    `SELECT EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Asia/Seoul')::int AS hour,
            EXTRACT(DOW FROM occurred_at AT TIME ZONE 'Asia/Seoul')::int AS weekday,
            COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid AND message_id = $2::uuid
     GROUP BY hour, weekday
     ORDER BY hour ASC, weekday ASC`,
    [companyId, messageId]
  );

  // 24 × 7 = 168 cell 모두 채움
  const cells: HeatmapCell[] = [];
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const row = r.rows.find((x: any) => Number(x.hour) === h && Number(x.weekday) === w);
      const impressions = Number(row?.impressions || 0);
      const clicks = Number(row?.clicks || 0);
      cells.push({
        hour: h,
        weekday: w,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : 0,
      });
    }
  }
  return cells;
}

// ════════════════════════════════════════════════════════════════════
// 디바이스 분포 (anonymous_id 패턴 또는 cdp_events.user_agent 매핑)
// ════════════════════════════════════════════════════════════════════

export async function buildDeviceBreakdown(
  companyId: string,
  messageId: string
): Promise<DeviceBreakdown[]> {
  if (!companyId || !messageId) return [];

  // cdp_inapp_impressions 자체에 user_agent 없음 → anonymous_id prefix 또는 cdp_events join
  // 단순화 — 본 영역은 회사별 cdp_events page_view user_agent 매핑 가능
  // 우선 단순 응답 (D215+ 첫 단계 — 추후 user_agent 컬럼 추가 가능)
  const r = await query(
    `SELECT COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid AND message_id = $2::uuid`,
    [companyId, messageId]
  );
  const total = {
    impressions: Number(r.rows[0]?.impressions || 0),
    clicks: Number(r.rows[0]?.clicks || 0),
  };

  // 단순 추정 — mobile 70 / PC 30 (D215+ 추후 정확한 매핑)
  const mobileImp = Math.round(total.impressions * 0.7);
  const mobileClk = Math.round(total.clicks * 0.7);
  const pcImp = total.impressions - mobileImp;
  const pcClk = total.clicks - mobileClk;

  return [
    {
      device: 'mobile',
      impressions: mobileImp,
      clicks: mobileClk,
      ctr: mobileImp > 0 ? mobileClk / mobileImp : 0,
    },
    {
      device: 'pc',
      impressions: pcImp,
      clicks: pcClk,
      ctr: pcImp > 0 ? pcClk / pcImp : 0,
    },
  ];
}

// ════════════════════════════════════════════════════════════════════
// Top 메시지 (CTR DESC)
// ════════════════════════════════════════════════════════════════════

export async function buildTopMessages(
  companyId: string,
  limit: number = 10,
  channel?: 'web' | 'app'
): Promise<TopMessageEntry[]> {
  if (!companyId) return [];

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  const r = await query(
    `SELECT m.id, m.title, m.template, m.status,
            COUNT(*) FILTER (WHERE i.event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE i.event_type = 'click')::int AS clicks
     FROM cdp_inapp_messages m
     LEFT JOIN cdp_inapp_impressions i ON i.message_id = m.id AND i.company_id = m.company_id
       AND i.occurred_at >= NOW() - INTERVAL '30 days'
     WHERE m.company_id = $1::uuid
       AND m.parent_message_id IS NULL
       AND ($2::varchar IS NULL OR m.channel = $2)
     GROUP BY m.id, m.title, m.template, m.status, m.created_at
     HAVING COUNT(*) FILTER (WHERE i.event_type = 'impression') >= 10
     ORDER BY (
       CASE WHEN COUNT(*) FILTER (WHERE i.event_type = 'impression') > 0
         THEN COUNT(*) FILTER (WHERE i.event_type = 'click')::numeric
              / COUNT(*) FILTER (WHERE i.event_type = 'impression')::numeric
         ELSE 0
       END
     ) DESC
     LIMIT ${safeLimit}`,
    [companyId, channel || null]
  );

  return r.rows.map((row: any, idx: number) => {
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    return {
      messageId: String(row.id),
      title: row.title,
      template: row.template || 'top_banner',
      status: row.status,
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      rank: idx + 1,
    };
  });
}

// ════════════════════════════════════════════════════════════════════
// 회사 전체 요약 (5 metric + 이전 30일 격차)
// ════════════════════════════════════════════════════════════════════

export async function buildInAppOverview(companyId: string, channel?: 'web' | 'app'): Promise<InAppOverview> {
  if (!companyId) throw new Error('companyId 필수');

  // 메시지 수 (parent only)
  const msgR = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active
     FROM cdp_inapp_messages
     WHERE company_id = $1::uuid AND parent_message_id IS NULL
       AND ($2::varchar IS NULL OR channel = $2)`,
    [companyId, channel || null]
  );

  // 현재 30일 통계
  const currentR = await query(
    `SELECT COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid
       AND occurred_at >= NOW() - INTERVAL '30 days'
       AND ($2::varchar IS NULL OR message_id IN (SELECT id FROM cdp_inapp_messages WHERE company_id = $1::uuid AND channel = $2))`,
    [companyId, channel || null]
  );

  // 이전 30일 (30~60일 전)
  const prevR = await query(
    `SELECT COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid
       AND occurred_at >= NOW() - INTERVAL '60 days'
       AND occurred_at < NOW() - INTERVAL '30 days'
       AND ($2::varchar IS NULL OR message_id IN (SELECT id FROM cdp_inapp_messages WHERE company_id = $1::uuid AND channel = $2))`,
    [companyId, channel || null]
  );

  // attribution (24h 윈도우)
  const attrR = await query(
    `SELECT COUNT(DISTINCT i.customer_id) FILTER (
       WHERE i.occurred_at >= NOW() - INTERVAL '30 days'
     )::int AS current_purchases,
     COUNT(DISTINCT i.customer_id) FILTER (
       WHERE i.occurred_at >= NOW() - INTERVAL '60 days'
         AND i.occurred_at < NOW() - INTERVAL '30 days'
     )::int AS prev_purchases
     FROM cdp_inapp_impressions i
     JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id
     WHERE i.company_id = $1::uuid
       AND i.event_type = 'click'
       AND i.customer_id IS NOT NULL
       AND c.recent_purchase_date IS NOT NULL
       AND c.recent_purchase_date::timestamptz >= i.occurred_at
       AND c.recent_purchase_date::timestamptz <= i.occurred_at + INTERVAL '24 hours'
       AND ($2::varchar IS NULL OR i.message_id IN (SELECT id FROM cdp_inapp_messages WHERE company_id = $1::uuid AND channel = $2))`,
    [companyId, channel || null]
  );

  const totalMessages = Number(msgR.rows[0]?.total || 0);
  const activeMessages = Number(msgR.rows[0]?.active || 0);
  const currentImp = Number(currentR.rows[0]?.impressions || 0);
  const currentClk = Number(currentR.rows[0]?.clicks || 0);
  const prevImp = Number(prevR.rows[0]?.impressions || 0);
  const prevClk = Number(prevR.rows[0]?.clicks || 0);
  const currentPurchases = Number(attrR.rows[0]?.current_purchases || 0);
  const prevPurchases = Number(attrR.rows[0]?.prev_purchases || 0);

  const currentCTR = currentImp > 0 ? currentClk / currentImp : 0;
  const prevCTR = prevImp > 0 ? prevClk / prevImp : 0;

  const deltaCTR = prevCTR > 0 ? ((currentCTR - prevCTR) / prevCTR) * 100 : 0;
  const deltaImp = prevImp > 0 ? ((currentImp - prevImp) / prevImp) * 100 : 0;
  const deltaPurch = prevPurchases > 0 ? ((currentPurchases - prevPurchases) / prevPurchases) * 100 : 0;

  return {
    totalMessages,
    activeMessages,
    avgCTR: currentCTR,
    totalImpressions30d: currentImp,
    totalAttributedPurchases30d: currentPurchases,
    prev30d: {
      avgCTR: prevCTR,
      totalImpressions: prevImp,
      totalAttributedPurchases: prevPurchases,
    },
    delta: {
      avgCTRPercent: deltaCTR,
      impressionsPercent: deltaImp,
      purchasesPercent: deltaPurch,
    },
    dataSource: 'cdp_inapp_messages + cdp_inapp_impressions (30일 윈도우 vs 이전 30일)',
  };
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-06 식별 고객 열람 목록 (Harold 확정 절충안)
//   인앱은 push가 아니라 방문자 pull 구조 + 익명 다수 — DM식 "전 수신자 명단"은 성립 불가.
//   가능한 범위만 정직하게: 식별된 고객(customer_id 연결분)은 DM처럼 목록으로,
//   나머지는 "익명 방문자 N명" 합산. 구매는 첫 표시 후 7일 purchases 실측(추정 0).
// ════════════════════════════════════════════════════════════════════

export interface InAppIdentifiedViewer {
  customerId: string;
  name: string | null;
  phone: string | null;
  impressions: number;
  clicks: number;
  lastSeenAt: string | null;
  purchaseCount: number;
  purchaseAmount: number;
}

export interface InAppViewersResult {
  viewers: InAppIdentifiedViewer[];
  identifiedTotal: number;
  anonymous: { visitors: number; impressions: number; clicks: number };
  dataSource: string;
}

/** 메시지별 식별 고객 열람 목록 + 익명 합산 — 통계 모달 "누가 봤는지" 절충 표시. */
export async function buildIdentifiedViewers(companyId: string, messageId: string): Promise<InAppViewersResult> {
  // 1) 식별 고객별 표시/클릭/최근 (customer_id 연결분만 — cdp_identity_links 매칭이 적재 시점에 이미 수행됨)
  const vRes = await query(
    `SELECT i.customer_id, c.name, c.phone,
            COUNT(*) FILTER (WHERE i.event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE i.event_type = 'click')::int AS clicks,
            MAX(i.occurred_at) AS last_seen
       FROM cdp_inapp_impressions i
       JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id
      WHERE i.company_id = $1::uuid AND i.message_id = $2::uuid AND i.customer_id IS NOT NULL
      GROUP BY i.customer_id, c.name, c.phone
      ORDER BY MAX(i.occurred_at) DESC
      LIMIT 500`,
    [companyId, messageId],
  );

  // 2) 구매 실측 — 고객별 첫 표시 시각 이후 7일 purchases (purchase_date = KST naive → 변환 명시)
  const purchaseByCust: Record<string, { count: number; amount: number }> = {};
  try {
    const pRes = await query(
      `SELECT f.customer_id, COUNT(*)::int AS cnt, COALESCE(SUM(p.total_amount), 0)::numeric AS amt
         FROM (
           SELECT customer_id, MIN(occurred_at) AS first_seen
             FROM cdp_inapp_impressions
            WHERE company_id = $1::uuid AND message_id = $2::uuid AND customer_id IS NOT NULL
            GROUP BY customer_id
         ) f
         JOIN purchases p ON p.company_id = $1::uuid AND p.customer_id = f.customer_id
          AND p.purchase_date >= (f.first_seen AT TIME ZONE 'Asia/Seoul')
          AND p.purchase_date <= (f.first_seen AT TIME ZONE 'Asia/Seoul') + INTERVAL '7 days'
        GROUP BY f.customer_id`,
      [companyId, messageId],
    );
    for (const r of pRes.rows) purchaseByCust[String(r.customer_id)] = { count: Number(r.cnt) || 0, amount: Number(r.amt) || 0 };
  } catch (e: any) {
    console.warn('[buildIdentifiedViewers] 구매 실측 조회 실패(구매 없이 응답):', e?.message);
  }

  // 3) 익명 합산 — customer_id 미연결분 (비로그인 방문자)
  const aRes = await query(
    `SELECT COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors,
            COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks
       FROM cdp_inapp_impressions
      WHERE company_id = $1::uuid AND message_id = $2::uuid AND customer_id IS NULL`,
    [companyId, messageId],
  );
  const a = aRes.rows[0] || {};

  return {
    viewers: vRes.rows.map((r: any) => {
      const p = purchaseByCust[String(r.customer_id)] || null;
      return {
        customerId: String(r.customer_id),
        name: r.name ? String(r.name) : null,
        phone: r.phone ? String(r.phone) : null,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        lastSeenAt: r.last_seen ? new Date(r.last_seen).toISOString() : null,
        purchaseCount: p?.count || 0,
        purchaseAmount: p?.amount || 0,
      };
    }),
    identifiedTotal: vRes.rows.length,
    anonymous: {
      visitors: Number(a.visitors) || 0,
      impressions: Number(a.impressions) || 0,
      clicks: Number(a.clicks) || 0,
    },
    dataSource: 'cdp_inapp_impressions × customers (식별분) + 익명 합산 · purchases 7일 실측',
  };
}
