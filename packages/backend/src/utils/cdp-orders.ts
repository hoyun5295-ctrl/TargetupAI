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
 * 💵 status (자사몰 표준)
 *   - 'completed' / 'paid': 정상 주문 → RFM 갱신
 *   - 'cancelled' / 'refunded': 취소/환불 → RFM 차감 (별건 호출 시)
 *   - 'pending' / 'shipping' 등: 트래킹만, RFM 영향 X
 *
 * ⛔ 영구 원칙
 *   - 자사몰이 박은 order_id는 idempotency key — 같은 order_id 두 번 박혀도 중복 갱신 X
 *   - phone 정규화는 identifyCustomer 경유 (직접 customers 박지 X)
 *   - 타겟 자동완화 X (D171 영구 원칙)
 */

import { query } from '../config/database';
import { identifyCustomer, IdentifyInput } from './cdp-identity';
import { trackEvent } from './cdp-events';

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

  // 2. 중복 주문 idempotency 확인 (cdp_events에 같은 order_id로 박힌 'purchase' 이벤트 있는지)
  const dupCheck = await query(
    `SELECT id FROM cdp_events
     WHERE company_id = $1::uuid
       AND event_name = 'purchase'
       AND source = $2
       AND properties->>'order_id' = $3
     LIMIT 1`,
    [companyId, input.source, input.orderId]
  );
  const isDuplicate = dupCheck.rows.length > 0;

  let rfmUpdated = false;

  // 3. 'completed'/'paid' 주문만 RFM 갱신 (중복 아닐 때만)
  const isRevenueStatus = input.status === 'completed' || input.status === 'paid';
  if (isRevenueStatus && !isDuplicate) {
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
  }

  // 4. cdp_events에 'purchase' 이벤트 박음 (trigger campaign용)
  if (!isDuplicate) {
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
        },
        occurredAt: input.orderedAt,
      });
    } catch (eventErr) {
      console.warn('[CDP Orders] purchase 이벤트 박기 실패 (RFM은 이미 박힘):', eventErr);
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
  const customerList = (input.customers || []).slice(0, BULK_IMPORT_MAX_ROWS);
  const orderList = (input.orders || []).slice(0, BULK_IMPORT_MAX_ROWS);

  const result: BulkImportResult = {
    customersImported: 0,
    customersFailed: 0,
    ordersImported: 0,
    ordersFailed: 0,
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

  return result;
}
