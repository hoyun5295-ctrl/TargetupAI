/**
 * ★ CT-F20 — 전단AI 주문 생명주기 컨트롤타워
 *
 * Phase 3: 장바구니 → 주문 → 사장님 관리
 * - 주문 상태: pending → confirmed → ready → completed / cancelled
 * - 로그인 불필요 (고객): phone 기반 주문
 * - 인증 필요 (사장님): 주문 관리 + 상태 변경
 */

import { query } from '../../../config/database';
import { CartItem, clearCart, calculateCartTotal } from './flyer-carts';

// ============================================================
// 타입
// ============================================================
export type OrderStatus = 'pending' | 'confirmed' | 'ready' | 'completed' | 'cancelled';
export type PickupType = 'store_pickup' | 'delivery';

export interface CreateOrderParams {
  companyId: string;
  flyerId: string;
  phone: string;
  customerName?: string;
  items: CartItem[];
  pickupType?: PickupType;
  pickupTime?: string | null;
  note?: string;
}

export interface Order {
  id: string;
  companyId: string;
  flyerId: string;
  phone: string;
  customerName: string | null;
  items: CartItem[];
  totalAmount: number;
  pickupType: PickupType;
  pickupTime: string | null;
  status: OrderStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListResult {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================
// 주문 생성 (고객 — 공개 API)
// ============================================================
export async function createOrder(params: CreateOrderParams): Promise<Order> {
  const totalAmount = calculateCartTotal(params.items);

  const result = await query(
    `INSERT INTO flyer_orders
       (company_id, flyer_id, phone, customer_name, items, total_amount,
        pickup_type, pickup_time, status, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
     RETURNING *`,
    [
      params.companyId,
      params.flyerId,
      params.phone,
      params.customerName || null,
      JSON.stringify(params.items),
      totalAmount,
      params.pickupType || 'store_pickup',
      params.pickupTime || null,
      params.note || null,
    ]
  );

  // 주문 생성 후 장바구니 비우기
  await clearCart(params.flyerId, params.phone).catch(() => {});

  return parseOrderRow(result.rows[0]);
}

// ============================================================
// 주문 상태 변경 (사장님 — 인증 필요)
// ============================================================
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function updateOrderStatus(
  orderId: string,
  companyId: string,
  newStatus: OrderStatus,
): Promise<Order | null> {
  // 현재 상태 확인
  const current = await query(
    `SELECT status FROM flyer_orders WHERE id = $1 AND company_id = $2`,
    [orderId, companyId]
  );
  if (current.rows.length === 0) return null;

  const currentStatus = current.rows[0].status as OrderStatus;
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`상태 전환 불가: ${currentStatus} → ${newStatus}`);
  }

  const result = await query(
    `UPDATE flyer_orders SET status = $1, updated_at = NOW()
     WHERE id = $2 AND company_id = $3
     RETURNING *`,
    [newStatus, orderId, companyId]
  );

  return result.rows.length > 0 ? parseOrderRow(result.rows[0]) : null;
}

// ============================================================
// 주문 목록 조회 (사장님 — 인증 필요)
// ============================================================
export async function getOrdersByCompany(
  companyId: string,
  page = 1,
  pageSize = 20,
  statusFilter?: OrderStatus,
): Promise<OrderListResult> {
  const offset = (page - 1) * pageSize;
  const whereExtra = statusFilter ? ' AND status = $3' : '';
  const params: any[] = [companyId, pageSize, ...(statusFilter ? [statusFilter] : [])];

  const countResult = await query(
    `SELECT COUNT(*) FROM flyer_orders WHERE company_id = $1${whereExtra}`,
    statusFilter ? [companyId, statusFilter] : [companyId]
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const offsetParamIdx = statusFilter ? 4 : 3;
  const result = await query(
    `SELECT * FROM flyer_orders
     WHERE company_id = $1${whereExtra}
     ORDER BY
       CASE status
         WHEN 'pending' THEN 0
         WHEN 'confirmed' THEN 1
         WHEN 'ready' THEN 2
         WHEN 'completed' THEN 3
         WHEN 'cancelled' THEN 4
       END,
       created_at DESC
     LIMIT $2 OFFSET $${offsetParamIdx}`,
    statusFilter ? [companyId, pageSize, statusFilter, offset] : [companyId, pageSize, offset]
  );

  return {
    orders: result.rows.map(parseOrderRow),
    total,
    page,
    pageSize,
  };
}

// ============================================================
// 고객 본인 주문 조회 (공개 — phone 기반)
// ============================================================
export async function getOrdersByPhone(
  flyerId: string,
  phone: string,
): Promise<Order[]> {
  const result = await query(
    `SELECT * FROM flyer_orders
     WHERE flyer_id = $1 AND phone = $2
     ORDER BY created_at DESC`,
    [flyerId, phone]
  );
  return result.rows.map(parseOrderRow);
}

// ============================================================
// 주문 상세 (사장님 — 인증 필요)
// ============================================================
export async function getOrderDetail(
  orderId: string,
  companyId: string,
): Promise<Order | null> {
  const result = await query(
    `SELECT * FROM flyer_orders WHERE id = $1 AND company_id = $2`,
    [orderId, companyId]
  );
  return result.rows.length > 0 ? parseOrderRow(result.rows[0]) : null;
}

// ============================================================
// 주문 통계 (사장님 대시보드용)
// ============================================================
export interface OrderSummary {
  pending: number;
  confirmed: number;
  ready: number;
  completedToday: number;
  cancelledToday: number;
  totalAmountToday: number;
}

export async function getOrderSummary(companyId: string): Promise<OrderSummary> {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending') as pending,
       COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
       COUNT(*) FILTER (WHERE status = 'ready') as ready,
       COUNT(*) FILTER (WHERE status = 'completed' AND updated_at::date = CURRENT_DATE) as completed_today,
       COUNT(*) FILTER (WHERE status = 'cancelled' AND updated_at::date = CURRENT_DATE) as cancelled_today,
       COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed' AND updated_at::date = CURRENT_DATE), 0) as total_amount_today
     FROM flyer_orders WHERE company_id = $1`,
    [companyId]
  );
  const r = result.rows[0];
  return {
    pending: parseInt(r.pending, 10),
    confirmed: parseInt(r.confirmed, 10),
    ready: parseInt(r.ready, 10),
    completedToday: parseInt(r.completed_today, 10),
    cancelledToday: parseInt(r.cancelled_today, 10),
    totalAmountToday: parseInt(r.total_amount_today, 10),
  };
}

// ============================================================
// 내부 헬퍼
// ============================================================
function parseOrderRow(row: any): Order {
  return {
    id: row.id,
    companyId: row.company_id,
    flyerId: row.flyer_id,
    phone: row.phone,
    customerName: row.customer_name,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
    totalAmount: parseInt(row.total_amount, 10),
    pickupType: row.pickup_type || 'store_pickup',
    pickupTime: row.pickup_time,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
