/**
 * ★ CT-73: CDP Diagnostics 컨트롤타워 — D214+ (2026-05-24)
 *
 * 🎯 목적
 *   자사몰 영역 진단 매트릭스 = 매핑률 + 이벤트 누적 + Webhook 신뢰성 + multi-source 진단.
 *   - 5번 메뉴 자사몰 연동 페이지 "데이터 부족 안내" + "POS ↔ CDP 격차" 영역 진정 source
 *   - 회사 admin 영역 자사몰 영역 상태 영역 즉시 파악 본질
 *
 * ⛔ 영구 원칙
 *   - 다른 회사 데이터 X (회사별 격리)
 *   - Source caption 의무 (feedback_no_mock_data_in_production)
 *   - 진단 결과 = 회사 admin 액션 영역 안 활용 (안내 메시지 + 진입 경로 명시)
 */

import { query } from '../config/database';

export interface CdpProviderStats {
  source: string;             // 'cafe24' / 'naver' / 'shopify' / 'custom_sdk' / 'cdp_self_hosted' 등
  totalLinks: number;
  mappedLinks: number;        // customer_id NOT NULL
  mappingRate: number;
  events30d: number;
}

export interface WebhookReliability {
  source: string;
  totalDeliveries: number;
  successCount: number;       // status = 'processed'
  failedCount: number;        // status = 'failed'
  duplicateCount: number;     // status = 'duplicate'
  successRate: number;
}

export interface SourceConflictBucket {
  activeSourceCount: number;  // 0, 1, 2, 3+ source 영역 안 customer 수
  customerCount: number;
}

export interface CdpDiagnosticsResult {
  // 회사 전체 매트릭스
  totalCustomers: number;
  totalIdentityLinks: number;
  mappedLinks: number;
  overallMappingRate: number;
  // 이벤트 누적
  events24h: number;
  events7d: number;
  events30d: number;
  // POS ↔ CDP 격차
  posOnlyCustomers: number;   // active_sources 영역 안 sync/upload/manual 영역만
  cdpOnlyCustomers: number;   // active_sources 영역 안 자사몰 영역만 (POS X)
  fusedCustomers: number;     // 양쪽 영역 융합 (POS + 자사몰)
  // Provider별 매트릭스
  byProvider: CdpProviderStats[];
  // Webhook 신뢰성
  webhookReliability: WebhookReliability[];
  // 충돌 진단 (active_sources 영역 길이 분포)
  sourceConflicts: SourceConflictBucket[];
  computedAt: string;
  source: string;
}

export async function buildCdpDiagnostics(companyId: string): Promise<CdpDiagnosticsResult> {
  // 1) 회사 전체 customer 수
  const totalCustomersResult = await query(
    `SELECT COUNT(*)::int AS cnt FROM customers WHERE company_id = $1::uuid AND is_active = true`,
    [companyId]
  );
  const totalCustomers = Number(totalCustomersResult.rows[0]?.cnt) || 0;

  // 2) cdp_identity_links 전체 + 매핑된 영역
  const linksResult = await query(
    `SELECT
        COUNT(*)::int AS total_links,
        COUNT(*) FILTER (WHERE customer_id IS NOT NULL)::int AS mapped_links
       FROM cdp_identity_links
      WHERE company_id = $1::uuid`,
    [companyId]
  );
  const totalIdentityLinks = Number(linksResult.rows[0]?.total_links) || 0;
  const mappedLinks = Number(linksResult.rows[0]?.mapped_links) || 0;
  const overallMappingRate = totalIdentityLinks > 0 ? mappedLinks / totalIdentityLinks : 0;

  // 3) cdp_events 누적 (24h / 7d / 30d)
  const eventCountResult = await query(
    `SELECT
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '24 hours')::int AS h24,
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '7 days')::int AS d7,
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '30 days')::int AS d30
       FROM cdp_events
      WHERE company_id = $1::uuid`,
    [companyId]
  );
  const events24h = Number(eventCountResult.rows[0]?.h24) || 0;
  const events7d = Number(eventCountResult.rows[0]?.d7) || 0;
  const events30d = Number(eventCountResult.rows[0]?.d30) || 0;

  // 4) POS ↔ CDP 융합 격차 — active_sources 영역 활용
  // POS only = active_sources 안 'sync'/'upload'/'manual' 영역만
  // CDP only = active_sources 안 자사몰 영역만 (POS source 영역 X)
  // fused = 양쪽 영역
  const fusionResult = await query(
    `SELECT
        COUNT(*) FILTER (
          WHERE active_sources ?| array['sync','upload','manual']
            AND NOT (active_sources ?| array['cafe24','shopify','makeshop','imweb','sixshop','woocommerce','naver','custom_sdk','cdp_self_hosted'])
        )::int AS pos_only,
        COUNT(*) FILTER (
          WHERE active_sources ?| array['cafe24','shopify','makeshop','imweb','sixshop','woocommerce','naver','custom_sdk','cdp_self_hosted']
            AND NOT (active_sources ?| array['sync','upload','manual'])
        )::int AS cdp_only,
        COUNT(*) FILTER (
          WHERE active_sources ?| array['sync','upload','manual']
            AND active_sources ?| array['cafe24','shopify','makeshop','imweb','sixshop','woocommerce','naver','custom_sdk','cdp_self_hosted']
        )::int AS fused
       FROM customers
      WHERE company_id = $1::uuid AND is_active = true`,
    [companyId]
  );
  const posOnlyCustomers = Number(fusionResult.rows[0]?.pos_only) || 0;
  const cdpOnlyCustomers = Number(fusionResult.rows[0]?.cdp_only) || 0;
  const fusedCustomers = Number(fusionResult.rows[0]?.fused) || 0;

  // 5) Provider별 매트릭스
  const byProviderResult = await query(
    `SELECT
        l.source,
        COUNT(*)::int AS total_links,
        COUNT(*) FILTER (WHERE l.customer_id IS NOT NULL)::int AS mapped_links,
        COALESCE((
          SELECT COUNT(*)::int FROM cdp_events e
           WHERE e.company_id = l.company_id
             AND e.source = l.source
             AND e.occurred_at > NOW() - INTERVAL '30 days'
        ), 0) AS events_30d
       FROM cdp_identity_links l
      WHERE l.company_id = $1::uuid
      GROUP BY l.source, l.company_id
      ORDER BY total_links DESC`,
    [companyId]
  );
  const byProvider: CdpProviderStats[] = byProviderResult.rows.map((r: any) => {
    const total = Number(r.total_links) || 0;
    const mapped = Number(r.mapped_links) || 0;
    return {
      source: String(r.source),
      totalLinks: total,
      mappedLinks: mapped,
      mappingRate: total > 0 ? mapped / total : 0,
      events30d: Number(r.events_30d) || 0,
    };
  });

  // 6) Webhook 신뢰성 (cdp_webhook_deliveries — 30일)
  let webhookReliability: WebhookReliability[] = [];
  try {
    const webhookResult = await query(
      `SELECT
          source,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'processed')::int AS success_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
          COUNT(*) FILTER (WHERE status = 'duplicate')::int AS duplicate_count
         FROM cdp_webhook_deliveries
        WHERE company_id = $1::uuid
          AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY source
        ORDER BY total DESC`,
      [companyId]
    );
    webhookReliability = webhookResult.rows.map((r: any) => {
      const total = Number(r.total) || 0;
      const success = Number(r.success_count) || 0;
      return {
        source: String(r.source),
        totalDeliveries: total,
        successCount: success,
        failedCount: Number(r.failed_count) || 0,
        duplicateCount: Number(r.duplicate_count) || 0,
        successRate: total > 0 ? success / total : 0,
      };
    });
  } catch {
    webhookReliability = [];
  }

  // 7) 충돌 진단 (active_sources 영역 길이 분포)
  const conflictResult = await query(
    `SELECT
        CASE
          WHEN jsonb_array_length(COALESCE(active_sources, '[]'::jsonb)) = 0 THEN 0
          WHEN jsonb_array_length(active_sources) = 1 THEN 1
          WHEN jsonb_array_length(active_sources) = 2 THEN 2
          ELSE 3
        END AS bucket,
        COUNT(*)::int AS cnt
       FROM customers
      WHERE company_id = $1::uuid AND is_active = true
      GROUP BY bucket
      ORDER BY bucket`,
    [companyId]
  );
  const sourceConflicts: SourceConflictBucket[] = conflictResult.rows.map((r: any) => ({
    activeSourceCount: Number(r.bucket) || 0,
    customerCount: Number(r.cnt) || 0,
  }));

  return {
    totalCustomers,
    totalIdentityLinks,
    mappedLinks,
    overallMappingRate,
    events24h,
    events7d,
    events30d,
    posOnlyCustomers,
    cdpOnlyCustomers,
    fusedCustomers,
    byProvider,
    webhookReliability,
    sourceConflicts,
    computedAt: new Date().toISOString(),
    source: 'customers.active_sources + cdp_identity_links + cdp_events + cdp_webhook_deliveries (회사 격리)',
  };
}

/**
 * 자사몰 이벤트 funnel (page_view → cart_add → checkout_start → purchase).
 *
 * @param companyId - 회사 ID
 * @param days - 분석 기간 (default 30)
 */
export interface CdpFunnelResult {
  pageViewCount: number;
  cartAddCount: number;
  checkoutStartCount: number;
  purchaseCount: number;
  cartConversionRate: number;
  checkoutConversionRate: number;
  purchaseConversionRate: number;
  cartToPurchaseRate: number;
  computedAt: string;
  source: string;
}

export async function buildCdpFunnel(companyId: string, days: number = 30): Promise<CdpFunnelResult> {
  const result = await query(
    `SELECT
        COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS pv,
        COUNT(*) FILTER (WHERE event_name = 'cart_add')::int AS cart,
        COUNT(*) FILTER (WHERE event_name = 'checkout_start')::int AS checkout,
        COUNT(*) FILTER (WHERE event_name IN ('purchase', 'order'))::int AS purchase
       FROM cdp_events
      WHERE company_id = $1::uuid
        AND occurred_at > NOW() - ($2 || ' days')::interval`,
    [companyId, days]
  );
  const row = result.rows[0] || {};
  const pageViewCount = Number(row.pv) || 0;
  const cartAddCount = Number(row.cart) || 0;
  const checkoutStartCount = Number(row.checkout) || 0;
  const purchaseCount = Number(row.purchase) || 0;
  return {
    pageViewCount,
    cartAddCount,
    checkoutStartCount,
    purchaseCount,
    cartConversionRate: pageViewCount > 0 ? cartAddCount / pageViewCount : 0,
    checkoutConversionRate: cartAddCount > 0 ? checkoutStartCount / cartAddCount : 0,
    purchaseConversionRate: pageViewCount > 0 ? purchaseCount / pageViewCount : 0,
    cartToPurchaseRate: cartAddCount > 0 ? purchaseCount / cartAddCount : 0,
    computedAt: new Date().toISOString(),
    source: 'cdp_events (page_view → cart_add → checkout_start → purchase|order)',
  };
}

/**
 * 자사몰 이벤트 timeline (24h 영역 안 hourly bucket).
 */
export interface CdpTimelineBucket {
  hour: number;             // KST 0~23
  count: number;
  byEvent: Record<string, number>;
}

export async function buildCdpTimeline24h(companyId: string): Promise<CdpTimelineBucket[]> {
  const result = await query(
    `SELECT
        EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Asia/Seoul')::int AS hour,
        event_name,
        COUNT(*)::int AS cnt
       FROM cdp_events
      WHERE company_id = $1::uuid
        AND occurred_at > NOW() - INTERVAL '24 hours'
      GROUP BY hour, event_name
      ORDER BY hour`,
    [companyId]
  );

  const bucketMap = new Map<number, CdpTimelineBucket>();
  for (let h = 0; h < 24; h++) {
    bucketMap.set(h, { hour: h, count: 0, byEvent: {} });
  }
  for (const r of result.rows) {
    const hour = Number(r.hour) || 0;
    const eventName = String(r.event_name);
    const cnt = Number(r.cnt) || 0;
    const bucket = bucketMap.get(hour)!;
    bucket.count += cnt;
    bucket.byEvent[eventName] = (bucket.byEvent[eventName] || 0) + cnt;
  }
  return Array.from(bucketMap.values());
}
