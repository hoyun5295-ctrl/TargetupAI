/**
 * 장바구니 금액 추정치 (sessionStorage 누적) — T2 cart_value 트리거 입력값.
 * hjl.track('cart_add'|'cart_remove') properties의 price·quantity로 추정 누적.
 * 정확한 장바구니 합계는 자사몰만 알 수 있으므로 어디까지나 추정치다 —
 * price가 없는 호출은 누적에 반영되지 않는다 (가이드에 정직한 한계로 명시).
 */

const CART_EST_KEY = 'hjl_cart_est';

export function readCartEstimate(): number {
  try {
    const v = Number(sessionStorage.getItem(CART_EST_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function updateCartEstimate(
  event: 'cart_add' | 'cart_remove',
  properties?: Record<string, unknown>,
): number {
  try {
    const price = Number((properties as any)?.price);
    if (!Number.isFinite(price) || price <= 0) return readCartEstimate();
    const qtyRaw = Number((properties as any)?.quantity);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
    const delta = price * qty * (event === 'cart_remove' ? -1 : 1);
    const next = Math.max(0, readCartEstimate() + delta);
    sessionStorage.setItem(CART_EST_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}
