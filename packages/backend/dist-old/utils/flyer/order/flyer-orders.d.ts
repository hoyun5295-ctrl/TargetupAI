/**
 * ★ CT-F20 — 전단AI 주문 생명주기 컨트롤타워
 *
 * Phase 3: 장바구니 → 주문 → 사장님 관리
 * - 주문 상태: pending → confirmed → ready → completed / cancelled
 * - 로그인 불필요 (고객): phone 기반 주문
 * - 인증 필요 (사장님): 주문 관리 + 상태 변경
 */
import { CartItem } from './flyer-carts';
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
export declare function createOrder(params: CreateOrderParams): Promise<Order>;
export declare function updateOrderStatus(orderId: string, companyId: string, newStatus: OrderStatus): Promise<Order | null>;
export declare function getOrdersByCompany(companyId: string, page?: number, pageSize?: number, statusFilter?: OrderStatus): Promise<OrderListResult>;
export declare function getOrdersByPhone(flyerId: string, phone: string): Promise<Order[]>;
export declare function getOrderDetail(orderId: string, companyId: string): Promise<Order | null>;
export interface OrderSummary {
    pending: number;
    confirmed: number;
    ready: number;
    completedToday: number;
    cancelledToday: number;
    totalAmountToday: number;
}
export declare function getOrderSummary(companyId: string): Promise<OrderSummary>;
//# sourceMappingURL=flyer-orders.d.ts.map