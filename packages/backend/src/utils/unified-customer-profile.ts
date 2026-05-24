/**
 * ★ CT-71: Unified Customer Profile 컨트롤타워 — D214+ (2026-05-24)
 *
 * 🎯 목적
 *   모든 source 통합 매트릭스 = customer 영역 unified profile 본질.
 *   - 싱크에이전트 (POS / 고객사 DB) + 자사몰 (cafe24/shopify/naver/자체 등) + 파일 업로드 + 수동
 *   - last_activity_at + active_sources + primary_source + preferred_channel 자동 계산
 *   - 충돌 해결 = source_priority 매트릭스 정합
 *   - AI Operator / Predictive / 자동 마케팅 / Performance 영역 입력 본질
 *
 * ⛔ 영구 원칙
 *   - source_priority: 자체 SDK/호스팅(1) > cafe24/shopify(2) > naver(3) > sync(4) > upload(5) > manual(6)
 *   - last_activity_at = GREATEST (모든 source 최신)
 *   - preferred_channel = customer has_phone/has_email/has_cdp_active 매트릭스 정합
 *   - 5분 cron batch 재계산 (단일 customer = 이벤트 ingestion 시 즉시 재계산)
 */

import { query } from '../config/database';

export type CustomerSource =
  | 'custom_sdk' | 'cdp_self_hosted'      // priority 1 (자체)
  | 'cafe24' | 'shopify' | 'makeshop' | 'imweb' | 'sixshop' | 'woocommerce'  // priority 2 (외부 SaaS)
  | 'naver'                                 // priority 3 (네이버 — 제한적)
  | 'sync'                                  // priority 4 (싱크에이전트)
  | 'upload'                                // priority 5 (파일 업로드)
  | 'manual';                               // priority 6 (수동)

export const SOURCE_PRIORITY: Record<CustomerSource, number> = {
  custom_sdk: 1,
  cdp_self_hosted: 1,
  cafe24: 2,
  shopify: 2,
  makeshop: 2,
  imweb: 2,
  sixshop: 2,
  woocommerce: 2,
  naver: 3,
  sync: 4,
  upload: 5,
  manual: 6,
};

export type PreferredChannel = 'KAKAO' | 'LMS' | 'SMS' | 'EMAIL' | 'WEB_PUSH' | 'IN_APP' | 'NONE';

export interface UnifiedProfile {
  customerId: string;
  lastActivityAt: Date | null;
  activeSources: CustomerSource[];
  primarySource: CustomerSource | null;
  sourcePriorityResolved: CustomerSource | null;
  preferredChannel: PreferredChannel;
  hasPhone: boolean;
  hasEmail: boolean;
  hasCdpActive: boolean;
}

/**
 * 단일 customer unified profile 재계산 (이벤트 ingestion 시 즉시 호출).
 *
 * @param companyId - 회사 ID
 * @param customerId - 한줄로 customers.id
 */
export async function recomputeProfile(companyId: string, customerId: string): Promise<UnifiedProfile | null> {
  // 1) customer 조회 (기본 매트릭스 + source)
  const customerResult = await query(
    `SELECT c.id, c.phone, c.email, c.sms_opt_in, c.is_active, c.source, c.updated_at,
            c.recent_purchase_date, c.last_cart_add_at, c.last_wishlist_add_at, c.last_page_view_at
       FROM customers c
      WHERE c.id = $1::uuid AND c.company_id = $2::uuid AND c.is_active = true`,
    [customerId, companyId]
  );
  if (customerResult.rows.length === 0) return null;
  const c = customerResult.rows[0];

  const hasPhone = !!c.phone && c.sms_opt_in === true;
  const hasEmail = !!c.email;

  // 2) cdp_identity_links source 매트릭스
  const linkResult = await query(
    `SELECT DISTINCT source FROM cdp_identity_links
      WHERE company_id = $1::uuid AND customer_id = $2::uuid`,
    [companyId, customerId]
  );
  const cdpSources = linkResult.rows.map((r: any) => String(r.source) as CustomerSource);
  const baseSources = c.source ? [c.source as CustomerSource] : [];
  const allSources = Array.from(new Set([...cdpSources, ...baseSources]));

  // 3) cdp_events source별 카운트 (active 진단 + 가장 활성 영역)
  const eventCountResult = await query(
    `SELECT source, COUNT(*)::int AS cnt
       FROM cdp_events
      WHERE company_id = $1::uuid AND customer_id = $2::uuid
        AND occurred_at > NOW() - INTERVAL '30 days'
      GROUP BY source`,
    [companyId, customerId]
  );
  const eventCountBySource = new Map<string, number>();
  for (const r of eventCountResult.rows) {
    eventCountBySource.set(String(r.source), Number(r.cnt) || 0);
  }
  const totalCdpEvents30d = Array.from(eventCountBySource.values()).reduce((s, v) => s + v, 0);
  const hasCdpActive = totalCdpEvents30d > 0;

  // 4) primary_source (이벤트 가장 많은 source / 없으면 priority 가장 높은 영역)
  let primarySource: CustomerSource | null = null;
  if (eventCountBySource.size > 0) {
    let maxCount = 0;
    for (const [src, cnt] of eventCountBySource) {
      if (cnt > maxCount) {
        maxCount = cnt;
        primarySource = src as CustomerSource;
      }
    }
  } else if (allSources.length > 0) {
    primarySource = allSources.reduce((best, s) =>
      (SOURCE_PRIORITY[s] ?? 99) < (SOURCE_PRIORITY[best] ?? 99) ? s : best,
      allSources[0]
    );
  }

  // 5) source_priority_resolved (충돌 해결)
  const sourcePriorityResolved: CustomerSource | null = allSources.length > 0
    ? allSources.reduce((best, s) =>
        (SOURCE_PRIORITY[s] ?? 99) < (SOURCE_PRIORITY[best] ?? 99) ? s : best,
        allSources[0]
      )
    : null;

  // 6) last_activity_at (GREATEST 매트릭스 — JS 영역 안 reduce 정합)
  const activityCandidates: (Date | null)[] = [
    c.updated_at ? new Date(c.updated_at) : null,
    c.recent_purchase_date ? new Date(c.recent_purchase_date) : null,
    c.last_cart_add_at ? new Date(c.last_cart_add_at) : null,
    c.last_wishlist_add_at ? new Date(c.last_wishlist_add_at) : null,
    c.last_page_view_at ? new Date(c.last_page_view_at) : null,
  ];
  const lastActivityAt = activityCandidates
    .filter((d): d is Date => d !== null && !isNaN(d.getTime()))
    .reduce<Date | null>((best, d) => (best === null || d > best ? d : best), null);

  // 7) preferred_channel 매트릭스 (회사 KAKAO 활성 + customer 영역 매트릭스)
  const kakaoActiveResult = await query(
    `SELECT 1 FROM kakao_sender_profiles
      WHERE company_id = $1::uuid AND is_active = true AND status = 'NORMAL'
      LIMIT 1`,
    [companyId]
  );
  const companyKakaoActive = kakaoActiveResult.rows.length > 0;

  // Web Push 활성 여부 (cdp_push_subscriptions — D175-A 영역)
  let cdpPushActive = false;
  try {
    const pushResult = await query(
      `SELECT 1 FROM cdp_push_subscriptions
        WHERE company_id = $1::uuid AND customer_id = $2::uuid AND is_active = true
        LIMIT 1`,
      [companyId, customerId]
    );
    cdpPushActive = pushResult.rows.length > 0;
  } catch {
    cdpPushActive = false;
  }

  let preferredChannel: PreferredChannel = 'NONE';
  if (companyKakaoActive && hasPhone) preferredChannel = 'KAKAO';
  else if (hasPhone) preferredChannel = 'LMS';
  else if (hasEmail && hasCdpActive) preferredChannel = 'EMAIL';
  else if (cdpPushActive) preferredChannel = 'WEB_PUSH';
  else if (hasCdpActive) preferredChannel = 'IN_APP';

  // 8) customers UPDATE (5 컬럼)
  await query(
    `UPDATE customers SET
        last_activity_at = $2,
        active_sources = $3::jsonb,
        primary_source = $4,
        preferred_channel = $5,
        source_priority_resolved = $6,
        updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $7::uuid`,
    [
      customerId,
      lastActivityAt,
      JSON.stringify(allSources),
      primarySource,
      preferredChannel,
      sourcePriorityResolved,
      companyId,
    ]
  );

  return {
    customerId,
    lastActivityAt,
    activeSources: allSources,
    primarySource,
    sourcePriorityResolved,
    preferredChannel,
    hasPhone,
    hasEmail,
    hasCdpActive,
  };
}

/**
 * 회사 전체 customer unified profile 재계산 (5분 cron).
 * 최근 6분 안 변경된 customer 또는 last_activity_at NULL 영역만 batch 처리.
 *
 * @param companyId - 회사 ID
 * @param fullRecompute - true = 회사 전체 (옛 영역 1회만 활용)
 */
export async function recomputeProfileBatch(
  companyId: string,
  fullRecompute: boolean = false
): Promise<{ processed: number; failed: number }> {
  const whereClause = fullRecompute
    ? `c.company_id = $1::uuid AND c.is_active = true`
    : `c.company_id = $1::uuid AND c.is_active = true AND (c.updated_at >= NOW() - INTERVAL '6 minutes' OR c.last_activity_at IS NULL)`;
  const result = await query(
    `SELECT c.id FROM customers c WHERE ${whereClause} LIMIT 5000`,
    [companyId]
  );
  let processed = 0;
  let failed = 0;
  for (const r of result.rows) {
    try {
      await recomputeProfile(companyId, r.id);
      processed++;
    } catch (err) {
      console.error('[unified-profile] recompute 실패:', r.id, err);
      failed++;
    }
  }
  return { processed, failed };
}

/**
 * 회사 전체 cart_add_count_30d / wishlist_add_count_30d 재계산 (매일 cron).
 * cdp_events 30일 안 영역 → customers 영역 누적 매트릭스.
 */
export async function recomputeEventCounters(companyId: string): Promise<{ processed: number }> {
  const result = await query(
    `UPDATE customers c SET
        cart_add_count_30d = COALESCE(sub.cart_add_count, 0),
        wishlist_add_count_30d = COALESCE(sub.wishlist_count, 0),
        updated_at = NOW()
      FROM (
        SELECT customer_id,
               COUNT(*) FILTER (WHERE event_name = 'cart_add')::int AS cart_add_count,
               COUNT(*) FILTER (WHERE event_name = 'wishlist_add')::int AS wishlist_count
          FROM cdp_events
          WHERE company_id = $1::uuid
            AND customer_id IS NOT NULL
            AND occurred_at > NOW() - INTERVAL '30 days'
          GROUP BY customer_id
      ) sub
      WHERE c.id = sub.customer_id AND c.company_id = $1::uuid
      RETURNING c.id`,
    [companyId]
  );
  return { processed: result.rowCount || 0 };
}
