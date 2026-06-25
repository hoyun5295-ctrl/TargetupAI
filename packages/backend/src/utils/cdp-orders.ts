/**
 * ★ CT-22: 한줄로 CDP 주문 sync 컨트롤타워 — D172 (2026-05-19)
 *
 * 🎯 목적
 *   자사몰 → 한줄로AI 주문 이력 동기화 + customer RFM(recent/total/count) 자동 갱신.
 *   - identifyCustomer 경유 (customer + link 보장)
 *   - customers.recent_purchase_date / total_purchase_amount / purchase_count 갱신
 *   - customers.last_purchase_date도 자사몰 정합
 *   - 'purchase' 이벤트 자동 박음 (cdp_events 박혀서 trigger campaign 활용 가능)
 *
 * 💵 status (자사몰 표준) — 2026-06-10 CT-86 마커 기반으로 정정
 *   - 'completed' / 'paid': 매출 미반영 주문만 1회 반영 (revenue_applied 마커)
 *   - 'cancelled' / 'refunded': 반영된 주문만 1회 차감 (revenue_reversed 마커, 차감액 = 반영 시점 기록 금액)
 *   - 'pending' / 'shipping' 등: 트래킹만 — 이후 paid가 오면 그때 매출 반영 (전환 누락 결함 정정)
 *
 * ⛔ 영구 원칙
 *   - 매출 멱등 = revenue_applied/revenue_reversed 마커 (이벤트 존재 여부 아님 — 상태 전환 통과)
 *   - phone 정규화는 identifyCustomer 경유 (customers 직접 수정 금지)
 *   - 타겟 자동완화 X (D171 영구 원칙)
 */

import { query } from '../config/database';
import { identifyCustomer, IdentifyInput } from './cdp-identity';
import { trackEvent } from './cdp-events';
import { decideOrderRevenueAction } from './cdp-order-revenue';

// ═══════════════════════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════════════════════

export interface OrderInput {
  source: string;
  orderId: string;                          // 자사몰 주문 번호 (idempotency)
  // 회원 식별 (identifyCustomer로 위임)
  externalId: string;
  email?: string;
  phone?: string;
  name?: string;
  // 주문 데이터
  status: 'completed' | 'paid' | 'cancelled' | 'refunded' | 'pending' | 'shipping' | string;
  totalAmount: number;
  itemCount?: number;
  items?: Array<{ productId?: string; productName?: string; price?: number; quantity?: number; categoryName?: string }>;
  orderedAt: string;                        // ISO datetime
  currency?: string;                        // 기본 KRW
}

export interface OrderResult {
  customerId: string;
  linkId: string;
  wasCustomerCreated: boolean;
  rfmUpdated: boolean;
}

// ═══════════════════════════════════════════════════════════
// 메인 — syncOrder
// ═══════════════════════════════════════════════════════════

/**
 * 자사몰 주문 1건 → customer upsert + RFM 갱신 + cdp_events 'purchase' 이벤트 박음.
 * - status가 completed/paid일 때만 RFM 갱신
 * - 같은 order_id 두 번 호출되어도 customers RFM은 한 번만 박힘 (cdp_events properties.order_id 검증)
 */
export async function syncOrder(
  companyId: string,
  input: OrderInput
): Promise<OrderResult> {
  if (!input.source || !input.orderId || !input.externalId) {
    throw new Error('source, orderId, externalId는 필수입니다.');
  }
  if (!input.orderedAt || isNaN(new Date(input.orderedAt).getTime())) {
    throw new Error('orderedAt 형식이 올바르지 않습니다 (ISO datetime).');
  }

  // 1. customer + link 보장
  const identifyInput: IdentifyInput = {
    source: input.source,
    externalId: input.externalId,
    email: input.email,
    phone: input.phone,
    name: input.name,
  };
  const idResult = await identifyCustomer(companyId, identifyInput);

  if (!idResult.customerId) {
    // identify 정정(2026-06-10) 후에는 도달 불가 경로지만, null로 0행 UPDATE를 침묵 진행하지 않도록 명시 차단
    throw new Error('주문 처리 중 고객 식별에 실패했습니다. phone 또는 email을 포함해 다시 호출해주세요.');
  }

  // 2. 같은 order_id의 기존 purchase 이벤트 조회 — 매출 반영 여부는 CT-86 마커(revenue_applied)로 판정
  //    (2026-06-10 정정: 이벤트 존재 = 무조건 중복이라 pending→paid 전환 매출이 영원히 빠지던 결함 +
  //     cancelled/refunded 차감 미구현 결함을 함께 해소)
  const existingRes = await query(
    `SELECT id, properties FROM cdp_events
     WHERE company_id = $1::uuid
       AND event_name = 'purchase'
       AND source = $2
       AND properties->>'order_id' = $3
     ORDER BY created_at ASC
     LIMIT 1`,
    [companyId, input.source, input.orderId]
  );
  const existing = existingRes.rows.length > 0 ? existingRes.rows[0] : null;
  const decision = decideOrderRevenueAction(
    existing ? { properties: existing.properties || null } : null,
    input.status
  );

  let rfmUpdated = false;

  // 3-A. 결제 확정 — 매출 더하기 (마커 없는 주문만 1회)
  if (decision.action === 'apply') {
    const orderedDate = new Date(input.orderedAt);
    await query(
      `UPDATE customers SET
        total_purchase_amount = COALESCE(total_purchase_amount, 0) + $2,
        total_purchase = COALESCE(total_purchase, 0) + $2,
        purchase_count = COALESCE(purchase_count, 0) + 1,
        recent_purchase_date = GREATEST(COALESCE(recent_purchase_date, $3::date), $3::date),
        recent_purchase_amount = $2,
        last_purchase_date = TO_CHAR($3::date, 'YYYY-MM-DD'),
        avg_order_value = (COALESCE(total_purchase_amount, 0) + $2) / GREATEST(COALESCE(purchase_count, 0) + 1, 1),
        updated_at = NOW()
      WHERE id = $1::uuid`,
      [idResult.customerId, input.totalAmount, orderedDate]
    );
    rfmUpdated = true;
    if (existing) {
      // pending으로 먼저 기록됐던 이벤트 → 반영 마커 + 확정 상태/금액 갱신
      await query(
        `UPDATE cdp_events
         SET properties = COALESCE(properties, '{}'::jsonb)
           || jsonb_build_object('revenue_applied', true, 'status', $2::text, 'total_amount', $3::numeric)
         WHERE id = $1::uuid`,
        [existing.id, input.status, input.totalAmount]
      );
    }
  }

  // 3-B. 취소/환불 — 반영된 주문만 1회 차감 (차감액 = 반영 시점 기록 금액)
  if (decision.action === 'reverse') {
    const reverseAmount = decision.reverseAmount ?? input.totalAmount;
    await query(
      `UPDATE customers SET
        total_purchase_amount = GREATEST(COALESCE(total_purchase_amount, 0) - $2, 0),
        total_purchase = GREATEST(COALESCE(total_purchase, 0) - $2, 0),
        purchase_count = GREATEST(COALESCE(purchase_count, 0) - 1, 0),
        avg_order_value = CASE
          WHEN COALESCE(purchase_count, 0) - 1 > 0
            THEN GREATEST(COALESCE(total_purchase_amount, 0) - $2, 0) / (COALESCE(purchase_count, 0) - 1)
          ELSE 0
        END,
        updated_at = NOW()
      WHERE id = $1::uuid`,
      [idResult.customerId, reverseAmount]
    );
    rfmUpdated = true;
    if (existing) {
      await query(
        `UPDATE cdp_events
         SET properties = COALESCE(properties, '{}'::jsonb)
           || jsonb_build_object('revenue_reversed', true, 'status', $2::text)
         WHERE id = $1::uuid`,
        [existing.id, input.status]
      );
    }
  }

  // 3-C. 매출 변화 없는 상태 갱신 (pending→shipping 등) — 이벤트 status만 추적
  if (decision.action === 'none' && existing) {
    await query(
      `UPDATE cdp_events
       SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('status', $2::text)
       WHERE id = $1::uuid`,
      [existing.id, input.status]
    );
  }

  // 4. 기존 이벤트가 없으면 'purchase' 이벤트 신규 기록 (trigger campaign용)
  //    매출을 반영한 호출이면 revenue_applied 마커 동봉
  if (!existing) {
    try {
      await trackEvent(companyId, {
        source: input.source,
        eventName: 'purchase',
        externalId: input.externalId,
        properties: {
          order_id: input.orderId,
          status: input.status,
          total_amount: input.totalAmount,
          item_count: input.itemCount,
          items: input.items,
          currency: input.currency || 'KRW',
          ...(decision.action === 'apply' ? { revenue_applied: true } : {}),
        },
        occurredAt: input.orderedAt,
      });
    } catch (eventErr) {
      console.warn('[CDP Orders] purchase 이벤트 기록 실패 (RFM 처리 결과는 유지):', eventErr);
    }
  }

  return {
    customerId: idResult.customerId,
    linkId: idResult.linkId,
    wasCustomerCreated: idResult.wasCreated,
    rfmUpdated,
  };
}

// ═══════════════════════════════════════════════════════════
// bulk-import — 초기 마이그레이션
// ═══════════════════════════════════════════════════════════

export interface BulkImportInput {
  source: string;
  customers?: IdentifyInput[];              // 회원 마스터 일괄 박음
  orders?: OrderInput[];                    // 주문 이력 일괄 박음
}

export interface BulkImportResult {
  customersImported: number;
  customersFailed: number;
  ordersImported: number;
  ordersFailed: number;
  // ★ 2026-06-25 (gap 8): silent drop 폐기 — 1,000건 초과분을 경고로 노출
  customersTruncated: boolean;
  ordersTruncated: boolean;
  droppedCustomers: number;
  droppedOrders: number;
  warning?: string;
  failures: Array<{ type: 'customer' | 'order'; externalId?: string; orderId?: string; error: string }>;
}

const BULK_IMPORT_MAX_ROWS = 1000;

/**
 * 자사몰 admin이 한줄로 대시보드에서 1회성 일괄 import.
 * - customers + orders 최대 각각 1,000건/요청
 * - 실패한 row는 failures 배열에 박음, 성공한 row는 진행
 * - 더 큰 import는 페이지네이션 호출 권장
 */
export async function bulkImport(
  companyId: string,
  input: BulkImportInput
): Promise<BulkImportResult> {
  if (!input.source) throw new Error('source는 필수입니다.');
  const customersInput = input.customers || [];
  const ordersInput = input.orders || [];
  const customerList = customersInput.slice(0, BULK_IMPORT_MAX_ROWS);
  const orderList = ordersInput.slice(0, BULK_IMPORT_MAX_ROWS);
  const droppedCustomers = Math.max(0, customersInput.length - customerList.length);
  const droppedOrders = Math.max(0, ordersInput.length - orderList.length);

  const result: BulkImportResult = {
    customersImported: 0,
    customersFailed: 0,
    ordersImported: 0,
    ordersFailed: 0,
    customersTruncated: droppedCustomers > 0,
    ordersTruncated: droppedOrders > 0,
    droppedCustomers,
    droppedOrders,
    failures: [],
  };

  for (const c of customerList) {
    try {
      await identifyCustomer(companyId, { ...c, source: c.source || input.source });
      result.customersImported++;
    } catch (err: any) {
      result.customersFailed++;
      result.failures.push({ type: 'customer', externalId: c.externalId, error: err?.message || 'unknown' });
    }
  }

  for (const o of orderList) {
    try {
      await syncOrder(companyId, { ...o, source: o.source || input.source });
      result.ordersImported++;
    } catch (err: any) {
      result.ordersFailed++;
      result.failures.push({ type: 'order', orderId: o.orderId, externalId: o.externalId, error: err?.message || 'unknown' });
    }
  }

  if (droppedCustomers > 0 || droppedOrders > 0) {
    result.warning = `요청 1건당 최대 ${BULK_IMPORT_MAX_ROWS}건까지만 처리됩니다. 초과분(고객 ${droppedCustomers}건 / 주문 ${droppedOrders}건)은 처리되지 않았습니다. 페이지네이션으로 나눠 호출해주세요.`;
    console.log(`[CDP bulkImport] truncation — droppedCustomers=${droppedCustomers} droppedOrders=${droppedOrders} (company=${companyId})`);
  }

  return result;
}
