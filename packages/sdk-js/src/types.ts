/**
 * @hanjullo/sdk — 한줄로 CDP SDK 타입 정의
 *
 * Backend API: packages/backend/src/routes/cdp.ts
 * 매뉴얼: https://hanjul.ai/docs/cdp
 */

export interface HanjulloSDKConfig {
  /** 한줄로 CDP Public Key (hjl_*) — CdpSettingsPage 발급 */
  apiKey: string;
  /** 한줄로 CDP Secret Key (sk_*) — CdpSettingsPage 발급 시 1회 노출 */
  secret: string;
  /** 호출 base URL (default: https://app.hanjul.ai/api/cdp) */
  endpoint?: string;
  /** 자사몰 식별 source — 기본 'custom_sdk', 카페24/Shopify wrapper는 자체 박음 */
  source?: string;
  /** 네트워크 실패 시 재시도 횟수 (default 2) */
  retries?: number;
  /** 디버그 로그 (default false) */
  debug?: boolean;
}

// ────────────────────────────────────────────────────────────
// identify
// ────────────────────────────────────────────────────────────

export interface IdentifyParams {
  /** 자사몰 회원 ID (필수) */
  externalId: string;
  email?: string;
  phone?: string;
  name?: string;
  birthDate?: string;
  gender?: 'M' | 'F' | string;
  grade?: string;
  address?: string;
  /** 자사몰별 추가 필드 (custom_fields JSONB에 박힘) */
  customFields?: Record<string, unknown>;
}

export interface IdentifyResponse {
  success: boolean;
  customer_id?: string;
  link_id?: string;
  was_created?: boolean;
  was_merged?: boolean;
  error?: string;
}

// ────────────────────────────────────────────────────────────
// event (track)
// ────────────────────────────────────────────────────────────

export type StandardEventName =
  | 'page_view'
  | 'cart_add'
  | 'cart_remove'
  | 'cart_view'
  | 'checkout_start'
  | 'checkout_complete'
  | 'purchase'
  | 'wishlist_add'
  | 'wishlist_remove'
  | 'product_view'
  | 'search';

export interface TrackParams {
  /** 표준 이벤트 또는 'custom_*' */
  eventName: StandardEventName | `custom_${string}`;
  /** 회원 이벤트 (externalId 또는 anonymousId 중 하나 필수) */
  externalId?: string;
  /** 비회원 추적 ID (브라우저 cookie 등) */
  anonymousId?: string;
  /** 이벤트 데이터 (10KB 한도) */
  properties?: Record<string, unknown>;
  /** ISO datetime (미박힘 시 서버 NOW) */
  occurredAt?: string;
}

export interface TrackResponse {
  success: boolean;
  event_id?: string;
  link_id?: string;
  customer_id?: string | null;
  error?: string;
}

// ────────────────────────────────────────────────────────────
// order
// ────────────────────────────────────────────────────────────

export interface OrderParams {
  /** 자사몰 주문 번호 (idempotency key — 같은 order_id 두 번 박혀도 중복 갱신 X) */
  orderId: string;
  externalId: string;
  email?: string;
  phone?: string;
  name?: string;
  /** 'completed' / 'paid' = RFM 갱신 / 'cancelled' / 'refunded' = 트래킹만 */
  status: 'completed' | 'paid' | 'cancelled' | 'refunded' | 'pending' | 'shipping' | string;
  totalAmount: number;
  itemCount?: number;
  items?: Array<{
    productId?: string;
    productName?: string;
    price?: number;
    quantity?: number;
    categoryName?: string;
  }>;
  /** ISO datetime — 자사몰 주문 발생 시각 */
  orderedAt: string;
  currency?: string;
}

export interface OrderResponse {
  success: boolean;
  customer_id?: string;
  link_id?: string;
  was_customer_created?: boolean;
  rfm_updated?: boolean;
  error?: string;
}

// ────────────────────────────────────────────────────────────
// bulk-import
// ────────────────────────────────────────────────────────────

export interface BulkImportParams {
  /** 회원 마스터 일괄 박음 (최대 1,000건/요청) */
  customers?: IdentifyParams[];
  /** 주문 이력 일괄 박음 (최대 1,000건/요청) */
  orders?: OrderParams[];
}

export interface BulkImportResponse {
  success: boolean;
  customersImported?: number;
  customersFailed?: number;
  ordersImported?: number;
  ordersFailed?: number;
  failures?: Array<{ type: 'customer' | 'order'; externalId?: string; orderId?: string; error: string }>;
  error?: string;
}

// ────────────────────────────────────────────────────────────
// 공통
// ────────────────────────────────────────────────────────────

export interface SDKError extends Error {
  status?: number;
  code?: string;
  responseBody?: unknown;
}

// ────────────────────────────────────────────────────────────
// ★ D189 #4 (2026-05-22): Journey Step A/B/Bandit 트래킹
// ────────────────────────────────────────────────────────────

export interface VariantTrackParams {
  /** 회원 식별 (선택) */
  externalId?: string;
  /** 비회원 추적 ID (선택) */
  anonymousId?: string;
}

export interface VariantTrackResponse {
  success: boolean;
  error?: string;
}
