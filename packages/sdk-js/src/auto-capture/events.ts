/**
 * 표준 이벤트명 — 백엔드 cdp-events.ts STANDARD_EVENT_NAMES와 1:1 동일.
 * hjl.track(eventName, ...) 호출 시 오타/비표준 이름 사전 차단 → 장바구니 리커버리
 * 엔진(matchCartAbandon)이 기대하는 event_name 정확도 보장.
 */

export const STANDARD_EVENT_NAMES = [
  'page_view',
  'cart_add',
  'cart_remove',
  'cart_view',
  'checkout_start',
  'checkout_complete',
  'purchase',
  'wishlist_add',
  'wishlist_remove',
  'product_view',
  'search',
  'message_click',
] as const;

export type StandardEventName = (typeof STANDARD_EVENT_NAMES)[number];

/**
 * 인앱 트리거 브리지 대상 — hjl.track() 전송 성공 직후 같은 이름의 인앱 트리거를 자동 호출.
 * 백엔드 cdp_inapp_messages.trigger_event가 매칭하는 커머스 이벤트만 (2026-06-11 배선 설계서 T2).
 */
export const INAPP_BRIDGE_EVENT_NAMES = ['cart_add', 'cart_view', 'checkout_start'] as const;

const STANDARD_SET = new Set<string>(STANDARD_EVENT_NAMES);

/**
 * 표준 이벤트명 또는 custom_ 접두사(소문자/숫자/언더스코어, 50자 이하)인지 검증.
 * 백엔드 validateEventName과 동일 규칙.
 */
export function isValidEventName(eventName: string): boolean {
  if (!eventName || typeof eventName !== 'string') return false;
  if (eventName.length > 50) return false;
  if (STANDARD_SET.has(eventName)) return true;
  return /^custom_[a-z0-9_]+$/.test(eventName);
}
