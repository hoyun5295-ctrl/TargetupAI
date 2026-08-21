/**
 * ★ CT-74: CDP 활성 Customer Top N 컨트롤타워 — D214+ (2026-05-24)
 *
 * 🎯 목적
 *   자사몰 영역 안 30일 가장 활성 customer top N 매트릭스.
 *   - 5번 메뉴 자사몰 연동 페이지 "자사몰 활성 customer top 10" 영역 진정 source
 *   - 이벤트 카운트 + event_name 분포 + 30일 매출 + active_sources + preferred_channel 매트릭스
 *
 * ⛔ 영구 원칙
 *   - 매핑된 customer 영역만 (customer_id NOT NULL)
 *   - 비회원 영역 (anonymous link) = anonymized 매트릭스 (별도 영역)
 *   - Source caption 의무 (feedback_no_mock_data_in_production)
 */

import { query } from '../config/database';

export interface CdpActiveCustomer {
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerGrade: string | null;
  events30d: number;
  eventsByName: Record<string, number>;
  revenue30d: number;
  activeSources: string[];
  primarySource: string | null;
  preferredChannel: string | null;
  lastActivityAt: string | null;
}

export interface CdpActiveCustomersResult {
  topCustomers: CdpActiveCustomer[];
  totalActiveCustomers: number;     // 30일 안 1건+ 이벤트 영역 customer 수
  anonymousEventCount: number;      // 비회원 이벤트 30일 영역
  computedAt: string;
  source: string;
}

export async function buildCdpActiveCustomers(
  companyId: string,
  limit: number = 10
): Promise<CdpActiveCustomersResult> {
  // 1) 30일 안 활성 customer 카운트 + 비회원 이벤트
  const summaryResult = await query(
    `SELECT
        COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL)::int AS active_customers,
        COUNT(*) FILTER (WHERE customer_id IS NULL)::int AS anonymous_events
       FROM cdp_events
      WHERE company_id = $1::uuid
        AND occurred_at > NOW() - INTERVAL '30 days'`,
    [companyId]
  );
  const totalActiveCustomers = Number(summaryResult.rows[0]?.active_customers) || 0;
  const anonymousEventCount = Number(summaryResult.rows[0]?.anonymous_events) || 0;

  // 2) Top N 활성 customer (이벤트 카운트 정렬)
  const topResult = await query(
    `SELECT
        e.customer_id,
        c.name AS customer_name,
        c.phone AS customer_phone,
        c.grade AS customer_grade,
        c.active_sources,
        c.primary_source,
        c.preferred_channel,
        c.last_activity_at,
        COUNT(*)::int AS events_30d,
        COALESCE(SUM(
          CASE WHEN e.event_name IN ('purchase','order')
            THEN COALESCE((e.properties->>'total_amount')::numeric, 0)
            ELSE 0 END
        ), 0)::float AS revenue_30d
       FROM cdp_events e
       JOIN customers c ON c.id = e.customer_id
      WHERE e.company_id = $1::uuid
        AND e.customer_id IS NOT NULL
        AND e.occurred_at > NOW() - INTERVAL '30 days'
        AND c.is_active = true
      GROUP BY e.customer_id, c.name, c.phone, c.grade, c.active_sources, c.primary_source, c.preferred_channel, c.last_activity_at
      ORDER BY events_30d DESC
      LIMIT $2`,
    [companyId, Math.min(limit, 100)]
  );

  // 3) Top customer 영역 안 event_name 분포 매트릭스
  const customerIds = topResult.rows.map((r: any) => r.customer_id);
  const eventDistMap = new Map<string, Record<string, number>>();
  if (customerIds.length > 0) {
    const distResult = await query(
      `SELECT customer_id, event_name, COUNT(*)::int AS cnt
         FROM cdp_events
        WHERE company_id = $1::uuid
          AND customer_id = ANY($2::uuid[])
          AND occurred_at > NOW() - INTERVAL '30 days'
        GROUP BY customer_id, event_name`,
      [companyId, customerIds]
    );
    for (const r of distResult.rows) {
      const cid = String(r.customer_id);
      if (!eventDistMap.has(cid)) eventDistMap.set(cid, {});
      eventDistMap.get(cid)![String(r.event_name)] = Number(r.cnt) || 0;
    }
  }

  const topCustomers: CdpActiveCustomer[] = topResult.rows.map((r: any) => ({
    customerId: String(r.customer_id),
    customerName: r.customer_name || null,
    customerPhone: r.customer_phone || null,
    customerGrade: r.customer_grade || null,
    events30d: Number(r.events_30d) || 0,
    eventsByName: eventDistMap.get(String(r.customer_id)) || {},
    revenue30d: Number(r.revenue_30d) || 0,
    activeSources: Array.isArray(r.active_sources) ? r.active_sources : [],
    primarySource: r.primary_source || null,
    preferredChannel: r.preferred_channel || null,
    lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
  }));

  return {
    topCustomers,
    totalActiveCustomers,
    anonymousEventCount,
    computedAt: new Date().toISOString(),
    source: 'cdp_events JOIN customers (회원 매핑된 영역만, 비회원 영역 = anonymized 매트릭스 별도)',
  };
}
