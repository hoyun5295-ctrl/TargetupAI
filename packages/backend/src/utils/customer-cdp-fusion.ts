/**
 * ★ CT-72: Customer ↔ CDP Event Fusion 컨트롤타워 — D214+ (2026-05-24)
 *
 * 🎯 목적
 *   cdp_events 영역 안 cart_add / wishlist_add / page_view 영역 → customers union 매트릭스.
 *   - cdp-events.ts trackEvent 영역 안 호출 (이벤트 INSERT 후 즉시)
 *   - event_name별 customers 컬럼 매트릭스 GREATEST + increment 매트릭스
 *   - Predictive / AI Operator / 자동 마케팅 영역 안 = customer-level 영역 직접 활용 가능
 *
 * ⛔ 영구 원칙
 *   - customer_id NULL 영역 (비회원 영역) = skip (영향 X)
 *   - last_*_at = GREATEST 매트릭스 (이미 최신 영역 시 = 영향 X)
 *   - cart_add_count_30d / wishlist_add_count_30d = increment (매일 cron 영역 안 decay 정합)
 *   - 다른 event_name (page_view 외) = 영향 X 영역
 */

import { query } from '../config/database';

export type CdpFusableEvent = 'cart_add' | 'wishlist_add' | 'page_view';

/**
 * cdp_events 영역 안 event 발생 시 → customers 영역 union.
 * 이벤트 INSERT 직후 호출 의무 (cdp-events.ts trackEvent 영역 안).
 *
 * @param companyId - 회사 ID
 * @param customerId - 한줄로 customers.id (NULL 영역 = skip)
 * @param eventName - 표준 이벤트 영역 (cart_add / wishlist_add / page_view)
 * @param occurredAt - 이벤트 발생 시각
 */
export async function fuseEventToCustomer(
  companyId: string,
  customerId: string | null,
  eventName: string,
  occurredAt: Date
): Promise<void> {
  if (!customerId) return;  // 비회원 영역 = skip

  switch (eventName) {
    case 'cart_add':
      await query(
        `UPDATE customers SET
            last_cart_add_at = GREATEST(COALESCE(last_cart_add_at, $2::timestamptz), $2::timestamptz),
            cart_add_count_30d = COALESCE(cart_add_count_30d, 0) + 1,
            updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $3::uuid`,
        [customerId, occurredAt, companyId]
      );
      break;

    case 'wishlist_add':
      await query(
        `UPDATE customers SET
            last_wishlist_add_at = GREATEST(COALESCE(last_wishlist_add_at, $2::timestamptz), $2::timestamptz),
            wishlist_add_count_30d = COALESCE(wishlist_add_count_30d, 0) + 1,
            updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $3::uuid`,
        [customerId, occurredAt, companyId]
      );
      break;

    case 'page_view':
      await query(
        `UPDATE customers SET
            last_page_view_at = GREATEST(COALESCE(last_page_view_at, $2::timestamptz), $2::timestamptz),
            updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $3::uuid`,
        [customerId, occurredAt, companyId]
      );
      break;

    default:
      // 다른 event_name (cart_remove / cart_view / checkout_start / wishlist_remove / search / message_click / custom_*)
      // = customers 영역 union X (cdp_events 영역만 활용)
      break;
  }
}

/**
 * 회사 전체 customer 영역 cart/wishlist 30d 카운터 재계산 (매일 cron).
 * unified-customer-profile.ts 영역 안 recomputeEventCounters 영역 정합 본질 — 본 함수 = 단순 wrapper.
 *
 * @param companyId - 회사 ID
 */
export async function recomputeEventCounters30d(companyId: string): Promise<{ processed: number }> {
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

/**
 * 30일 경과 이벤트 영역 안 customer 영역 = 카운터 0 매트릭스 (decay 정합).
 * 매일 cron 영역 안 호출 의무.
 */
export async function decayInactiveCounters(companyId: string): Promise<{ processed: number }> {
  const result = await query(
    `UPDATE customers c SET
        cart_add_count_30d = 0,
        wishlist_add_count_30d = 0,
        updated_at = NOW()
      WHERE c.company_id = $1::uuid
        AND c.is_active = true
        AND (
          c.last_cart_add_at IS NULL OR c.last_cart_add_at < NOW() - INTERVAL '30 days'
        )
        AND (
          c.last_wishlist_add_at IS NULL OR c.last_wishlist_add_at < NOW() - INTERVAL '30 days'
        )
        AND (cart_add_count_30d > 0 OR wishlist_add_count_30d > 0)
      RETURNING c.id`,
    [companyId]
  );
  return { processed: result.rowCount || 0 };
}
