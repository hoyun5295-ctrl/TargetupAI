/**
 * 이커머스 자동수집 — GA4 dataLayer 매핑 + 명시 헬퍼 (2026-06-18).
 *
 * 감지한 이벤트를 track(event, properties)로 흘림 → index.ts hjl.track가 적재(/ingest 'track' 경로) +
 * 인앱 트리거(T2 브리지: cart_add/checkout_start 등) 자동 실행. 웹 + 웹뷰앱(platform) 공용.
 *
 * GA4 표준 이커머스 dataLayer(window.dataLayer.push({event, ecommerce:{...}}))를 우리 표준 event_name으로 매핑.
 * GTM/GA4를 쓰는 몰은 코딩 0, 안 쓰는 몰은 window.hjl.ecommerce.* 헬퍼 한 줄.
 */

export interface MappedEcommerceEvent {
  event: string;
  properties: Record<string, unknown>;
}

// GA4 이벤트명 → 한줄로 표준 event_name (types.ts StandardEventName 정합)
const GA4_TO_STANDARD: Record<string, string> = {
  view_item: 'product_view',
  add_to_cart: 'cart_add',
  remove_from_cart: 'cart_remove',
  view_cart: 'cart_view',
  begin_checkout: 'checkout_start',
  add_to_wishlist: 'wishlist_add',
  purchase: 'purchase',
  search: 'search',
};

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function mapItem(it: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (it?.item_id != null && String(it.item_id) !== '') out.product_id = String(it.item_id);
  if (it?.item_name != null && String(it.item_name) !== '') out.product_name = String(it.item_name);
  const price = toNum(it?.price);
  if (price !== undefined) out.price = price;
  const qty = toNum(it?.quantity);
  if (qty !== undefined) out.quantity = qty;
  if (it?.item_category != null && String(it.item_category) !== '') out.category = String(it.item_category);
  return out;
}

/** GA4 dataLayer push 1건 → 한줄로 표준 이벤트. 미지원 event = null. (순수) */
export function mapGa4EcommerceEvent(push: any): MappedEcommerceEvent | null {
  const event = GA4_TO_STANDARD[String(push?.event ?? '')];
  if (!event) return null;

  const ec = (push && typeof push.ecommerce === 'object' && push.ecommerce) || {};
  const props: Record<string, unknown> = {};

  if (ec.currency != null && String(ec.currency) !== '') props.currency = String(ec.currency);
  const value = toNum(ec.value);
  if (value !== undefined) props.value = value;
  if (event === 'purchase' && ec.transaction_id != null && String(ec.transaction_id) !== '') {
    props.order_id = String(ec.transaction_id);
  }
  if (event === 'search') {
    const term = push?.search_term ?? ec.search_term;
    if (term != null && String(term) !== '') props.search_term = String(term);
  }
  if (Array.isArray(ec.items) && ec.items.length) {
    props.items = ec.items.map(mapItem);
  }

  return { event, properties: props };
}

export interface EcommerceHelpers {
  viewProduct: (props?: Record<string, unknown>) => void;
  addToCart: (props?: Record<string, unknown>) => void;
  removeFromCart: (props?: Record<string, unknown>) => void;
  viewCart: (props?: Record<string, unknown>) => void;
  checkout: (props?: Record<string, unknown>) => void;
  purchase: (props?: Record<string, unknown>) => void;
  addWishlist: (props?: Record<string, unknown>) => void;
  search: (term: string, props?: Record<string, unknown>) => void;
}

export interface EcommerceSetup {
  ecommerce: EcommerceHelpers;
  restore: () => void;
}

/**
 * window.dataLayer.push 후킹(GA4 이커머스 자동수집) + 명시 헬퍼.
 * @param track index.ts hjl.track 위임 — (event, properties) => void.
 */
export function setupEcommerceTracking(
  track: (event: string, properties?: Record<string, unknown>) => void,
): EcommerceSetup {
  const helpers: EcommerceHelpers = {
    viewProduct: (p) => track('product_view', p || {}),
    addToCart: (p) => track('cart_add', p || {}),
    removeFromCart: (p) => track('cart_remove', p || {}),
    viewCart: (p) => track('cart_view', p || {}),
    checkout: (p) => track('checkout_start', p || {}),
    purchase: (p) => track('purchase', p || {}),
    addWishlist: (p) => track('wishlist_add', p || {}),
    search: (term, p) => track('search', { search_term: term, ...(p || {}) }),
  };

  if (typeof window === 'undefined') {
    return { ecommerce: helpers, restore: () => {} };
  }

  const w = window as any;
  const dl: any[] = (w.dataLayer = w.dataLayer || []);

  const handle = (entry: any) => {
    try {
      const m = mapGa4EcommerceEvent(entry);
      if (m) track(m.event, m.properties);
    } catch {
      // 단순 무시 (한 이벤트 매핑 실패가 전체를 막지 않게)
    }
  };

  // init 전 쌓인 dataLayer 엔트리 replay (GA4가 SDK보다 먼저 push한 경우 흡수)
  for (const e of dl.slice()) handle(e);

  const originalPush = dl.push.bind(dl);
  dl.push = function (...args: any[]) {
    for (const a of args) handle(a);
    return originalPush(...args);
  };

  return {
    ecommerce: helpers,
    restore: () => {
      dl.push = originalPush;
    },
  };
}
