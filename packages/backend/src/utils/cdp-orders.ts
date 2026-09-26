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
import { trackEvent, validateProperties } from './cdp-events';
import { decideOrderRevenueAction } from './cdp-order-revenue';
// ★ 2026-09-26 한줄로 V2 R1-34 — 같은 주문 웹훅 직렬화(공용 잠금 CT)
import { withKeyedLock } from './keyed-lock';

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
  /**
   * 분류코드 (2026-09-18 · 설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-3)
   * 이 주문이 들어온 몰의 분류코드. 식별 단계(identifyCustomer)로 그대로 넘겨 고객을 그 분류에 기록한다.
   * 생략 = 식별 입력이 지금과 같다. ⛔ 호출부가 연동 행에서 읽은 값만 넣는다(요청 본문 값 금지).
   */
  storeCode?: string;
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
 * ★ 2026-09-26 한줄로 V2 R1-34 — purchase 이벤트 속성. 이벤트 속성 한도(10KB)를 넘으면 상품 목록만 뺀다(item_count는 유지).
 * 표식(revenue_applied)을 실은 이벤트 기록이 매출 반영의 전제라, 큰 주문이 매번 한도로 실패하면 그 주문 매출이 영영 안 들어간다.
 */
function purchaseEventProperties(input: OrderInput, extra: Record<string, unknown>): Record<string, unknown> {
  const full: Record<string, unknown> = {
    order_id: input.orderId,
    status: input.status,
    total_amount: input.totalAmount,
    item_count: input.itemCount,
    items: input.items,
    currency: input.currency || 'KRW',
    ...extra,
  };
  if (validateProperties(full).ok) return full;
  const { items: _omitted, ...rest } = full;
  return { ...rest, items_omitted: true };
}

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
    // ★ 2026-09-18: 분류코드가 있을 때만 키를 싣는다(생략 시 식별 입력 불변 = 계약 테스트 cdp-orders-store-code)
    ...(input.storeCode ? { storeCode: input.storeCode } : {}),
  };
  const idResult = await identifyCustomer(companyId, identifyInput);

  if (!idResult.customerId) {
    // identify 정정(2026-06-10) 후에는 도달 불가 경로지만, null로 0행 UPDATE를 침묵 진행하지 않도록 명시 차단
    throw new Error('주문 처리 중 고객 식별에 실패했습니다. phone 또는 email을 포함해 다시 호출해주세요.');
  }

  // ★ 2026-09-26 한줄로 V2 R1-34 — 같은 주문의 웹훅은 한 줄로 선다(조회 → 판정 → 반영 사이 끼어들기 금지).
  //   옛: 둘이 동시에 오면 둘 다 기존 이벤트를 못 보고 둘 다 매출을 더할 수 있었다. PM2 fork 단일 프로세스 전제(공용 잠금 CT).
  //   프로세스를 넘는 경합은 아래 표식 선점(조건부 UPDATE)이 막는다.
  const rfmUpdated = await withKeyedLock('cdp-order', `${companyId}:${input.source}:${input.orderId}`, async () => {
  // 2. 같은 order_id의 기존 purchase 이벤트 조회 — 매출 반영 여부는 CT-86 마커(revenue_applied)로 판정
  //    (2026-06-10 정정: 이벤트 존재 = 무조건 중복이라 pending→paid 전환 매출이 영원히 빠지던 결함 +
  //     cancelled/refunded 차감 미구현 결함을 함께 해소)
  const existingRes = await query(
    `SELECT id, properties FROM cdp_events
     WHERE company_id = $1::uuid
       AND event_name = 'purchase'
       AND source = $2
       AND properties->>'order_id' = $3
     ORDER BY occurred_at ASC, id ASC
     LIMIT 1`,
    [companyId, input.source, input.orderId]
  );
  const existing = existingRes.rows.length > 0 ? existingRes.rows[0] : null;
  const decision = decideOrderRevenueAction(
    existing ? { properties: existing.properties || null } : null,
    input.status
  );

  // ★ 2026-09-26 한줄로 V2 R1-34 — **표식 먼저, 매출 나중.**
  //   옛: 매출을 먼저 더하고 표식을 뒤에 남기며 그 실패를 삼켰다 → 표식이 없으면 같은 주문의 다음 웹훅이 다시 더했다.
  //   표식 되돌림은 키 삭제가 아니라 명시 false다(키가 없으면 옛 데이터 호환 규칙이 "결제 상태 = 반영됨"으로 읽는다).
  const releaseMarker = async (eventId: string | null | undefined, marker: 'revenue_applied' | 'revenue_reversed') => {
    if (!eventId) {
      console.error(`[CDP Orders] 매출 반영 실패 뒤 되돌릴 이벤트 id 없음(수동 확인) order=${input.orderId} marker=${marker}`);
      return;
    }
    await query(
      `UPDATE cdp_events
       SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('${marker}', false)
       WHERE id = $1::uuid`,
      [eventId]
    ).catch((relErr: any) => {
      console.error(`[CDP Orders] 매출 표식 되돌림 실패(재시도 시 누락 가능 · 수동 확인) event=${eventId} marker=${marker}:`, relErr?.message || relErr);
    });
  };

  // 3-A. 결제 확정 — 매출 더하기 (마커 없는 주문만 1회)
  if (decision.action === 'apply') {
    let markedEventId: string | null = null;
    if (existing) {
      // pending으로 먼저 기록됐던 이벤트 → 반영 표식 선점(이미 표식이 있으면 0행 = 더하지 않는다) + 확정 상태/금액 갱신
      const claim = await query(
        `UPDATE cdp_events
         SET properties = COALESCE(properties, '{}'::jsonb)
           || jsonb_build_object('revenue_applied', true, 'status', $2::text, 'total_amount', $3::numeric)
         WHERE id = $1::uuid
           AND COALESCE(properties->>'revenue_applied', '') <> 'true'
           AND COALESCE(properties->>'revenue_reversed', '') <> 'true'
         RETURNING id`,
        [existing.id, input.status, input.totalAmount]
      );
      if (claim.rows.length === 0) return false;
      markedEventId = String(existing.id);
    } else {
      // 새 주문 — 표식을 실은 이벤트 기록이 먼저다. 실패하면 매출을 더하지 않고 오류를 올린다(웹훅 재시도).
      const tracked = await trackEvent(companyId, {
        source: input.source,
        eventName: 'purchase',
        externalId: input.externalId,
        properties: purchaseEventProperties(input, { revenue_applied: true }),
        occurredAt: input.orderedAt,
      });
      markedEventId = tracked?.eventId || null;
    }
    const orderedDate = new Date(input.orderedAt);
    try {
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
    } catch (rfmErr) {
      await releaseMarker(markedEventId, 'revenue_applied');
      throw rfmErr;
    }
    return true;
  }

  // 3-B. 취소/환불 — 반영된 주문만 1회 차감 (차감액 = 반영 시점 기록 금액)
  if (decision.action === 'reverse') {
    if (!existing) return false;
    // 차감 표식 선점(이미 차감됐으면 0행 = 빼지 않는다)
    const claim = await query(
      `UPDATE cdp_events
       SET properties = COALESCE(properties, '{}'::jsonb)
         || jsonb_build_object('revenue_reversed', true, 'status', $2::text)
       WHERE id = $1::uuid
         AND COALESCE(properties->>'revenue_reversed', '') <> 'true'
       RETURNING id`,
      [existing.id, input.status]
    );
    if (claim.rows.length === 0) return false;
    const reverseAmount = decision.reverseAmount ?? input.totalAmount;
    try {
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
    } catch (rfmErr) {
      await releaseMarker(String(existing.id), 'revenue_reversed');
      throw rfmErr;
    }
    return true;
  }

  // 3-C. 매출 변화 없는 상태 갱신 (pending→shipping 등) — 이벤트 status만 추적
  if (existing) {
    await query(
      `UPDATE cdp_events
       SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('status', $2::text)
       WHERE id = $1::uuid`,
      [existing.id, input.status]
    );
    return false;
  }

  // 4. 기존 이벤트가 없으면 'purchase' 이벤트 신규 기록 (trigger campaign용 · 매출 변화 없는 호출)
  try {
    await trackEvent(companyId, {
      source: input.source,
      eventName: 'purchase',
      externalId: input.externalId,
      properties: purchaseEventProperties(input, {}),
      occurredAt: input.orderedAt,
    });
  } catch (eventErr) {
    console.warn('[CDP Orders] purchase 이벤트 기록 실패 (매출 변화 없는 호출):', eventErr);
  }
  return false;
  });

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
