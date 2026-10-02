/**
 * 우커머스(WooCommerce) 응답 매핑 — 순수 함수 (DB/IO 무관, TDD 대상) — 2026-09-14 W1
 *
 * 우커머스 REST v3(`/wp-json/wc/v3/`) 회원·주문 JSON → 적재 CT 입력(IdentifyInput · OrderInput).
 * 필드 형태 = 공식 REST v3 문서(billing.phone · line_items · meta_data[] · date_*_gmt).
 * ⛔ 실 raw(수신동의 메타키 · 웹훅 본문·헤더)는 게이트 ② 웹훅 1건 실측으로 최종 확인(D217 규약).
 *
 * 다몰 규약: 한 회사가 워드프레스 여러 개(고객사 4몰)를 붙이면 user id·주문 id가 몰마다 1부터 겹친다.
 *   → externalId·orderId를 `{mallId}:{id}` 로 접두한다(카페24·고도몰은 몰 1개라 접두 없음).
 *   mallId = normalizeWooMallId(몰 주소) = 호스트(www 제거 · 소문자). company_integrations.mall_id 에 그대로 쓴다.
 *
 * 수신동의는 raw(meta_data 값)만 반환하고 parseConsentValue 적용은 IO 계층(어댑터)에서 한다
 * (parseConsentValue는 cdp-identity 소속 = DB 모듈이라, 순수 모듈은 import하지 않음 — godo-parse 선례).
 */

import type { IdentifyInput } from './cdp-identity';
import type { OrderInput } from './cdp-orders';
import { normalizePhone } from './normalize';

export const WOO_SOURCE = 'woocommerce';

// ════════════════════════════════════════════════════════════════════
// 주문 상태 → syncOrder status
// ════════════════════════════════════════════════════════════════════

/**
 * 우커머스 코어 상태 → syncOrder status. 매출 반영(CT-86)은 paid·completed 만.
 * processing = 결제 완료·출고 대기 → paid. on-hold·pending·failed·checkout-draft = 결제 전/실패 → pending.
 * 미지의 상태(플러그인 커스텀) → ★2026-10-01 **결제 완료 시각(date_paid) 있음 + 환불 기록 없음 + 이행 중 이름**이면 paid · 아니면 pending.
 *   운영 4몰 실측: 코드엠샵이 `shipping`(배송중 · 이로이로도쿄 7일 729건) · `delayed` · `hold-shipping` · `cancel-request` 를 쓴다.
 *   옛 규칙(미지 = pending)에서는 배송 단계의 결제 완료 주문이 그 상태로 처음 들어오면 매출에 반영되지 않았다.
 *   상태 이름을 추측해 표에 넣지 않는다 — 몰마다 플러그인이 달라 이름으로는 못 가른다. 결제 여부는 우커머스가 직접 찍는 시각으로 본다.
 *   trash·draft 는 결제 시각이 있어도 매출로 올리지 않는다(지운 주문 · 임시 저장).
 */
const STATUS_MAP: Record<string, OrderInput['status']> = {
  'processing': 'paid',
  'completed': 'completed',
  'cancelled': 'cancelled',
  'refunded': 'refunded',
  'pending': 'pending',
  'on-hold': 'pending',
  'failed': 'pending',
  'checkout-draft': 'pending',
  'trash': 'pending',
  'draft': 'pending',
  'auto-draft': 'pending',
};

/** 몰 고유 상태 이름이 "결제는 끝났고 이행 중"을 뜻하는 낱말(허용 목록) — 운영 실측: shipping · delayed · hold-shipping */
const WOO_FULFILLMENT_STATUS_RE = /(ship|deliver|delay|pack|prepar|transit)/;
/** 환불·취소·반품·교환·실패 계열 이름 — 이행 낱말이 함께 있어도 매출로 올리지 않는다(예 return-shipping · 운영 실측 cancel-request) */
const WOO_REVERSAL_STATUS_RE = /(refund|return|cancel|exchang|fail)/;

/**
 * @param paidAt 우커머스 주문의 date_paid_gmt(없으면 date_paid) — 결제가 끝난 주문에만 값이 있다
 * @param hasRefund 그 주문에 환불 기록(refunds[])이 하나라도 있는가
 */
export function mapWooOrderStatus(status: unknown, paidAt?: unknown, hasRefund?: boolean): OrderInput['status'] {
  const s = String(status ?? '').trim().toLowerCase().replace(/^wc-/, '');
  const known = STATUS_MAP[s];
  if (known) return known;
  // 표에 없는 상태를 매출로 올리려면 세 근거가 모두 맞아야 한다(Codex 1001 R1 — 결제 시각 하나로는 환불 끝난 주문까지 올린다):
  //   결제 완료 시각 있음 · 환불 기록 없음 · 이름이 이행 중을 뜻함(허용 목록)이고 환불·취소 계열이 아님. 하나라도 아니면 종전처럼 결제 전.
  const paid = !!String(paidAt ?? '').trim();
  return paid && !hasRefund && WOO_FULFILLMENT_STATUS_RE.test(s) && !WOO_REVERSAL_STATUS_RE.test(s) ? 'paid' : 'pending';
}

// ════════════════════════════════════════════════════════════════════
// 몰 식별자
// ════════════════════════════════════════════════════════════════════

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
/** 몰 식별자 최대 길이 — "{mall}:{topic}"(최장 customer.restored 18자) 이 varchar(100) 에 들어가야 한다 */
export const MALL_ID_MAX = 80;

/**
 * 몰 주소 → 몰 식별자(호스트). 'https://www.ilbonimo.com/' → 'ilbonimo.com'.
 * 프로토콜·경로·쿼리·포트·대소문자·앞 www 는 무시. 점 없는 호스트·허용 문자 밖·비문자열 → null.
 * 웹훅 발신 주소(X-WC-Webhook-Source)와 연결 폼 입력 둘 다 이 함수를 지나 같은 행을 가리킨다.
 */
export function normalizeWooMallId(siteUrl: unknown): string | null {
  if (typeof siteUrl !== 'string') return null;
  const raw = siteUrl.trim();
  if (!raw) return null;
  let host = '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '');
  // IP 리터럴(10.0.0.1 등)은 몰이 아니다 — 이 식별자로 서버가 https 요청을 만들므로 내부망 주소를 막는다(SSRF).
  if (/^\d+(\.\d+)*$/.test(host)) return null;
  // company_integrations.mall_id varchar(100) · cdp_webhook_deliveries.webhook_event varchar(100)("{mall}:{topic}") 안에 들어가야 한다
  if (host.length > MALL_ID_MAX) return null;
  return HOST_RE.test(host) ? host : null;
}

/**
 * 요청 기준 주소(origin). 몰 주소(URL)면 그 호스트를 https 로, 호스트만 오면 https://{host}.
 * 저장된 몰 주소(www 포함)를 그대로 쓰는 이유: 식별자는 www 를 뗀 값이라 그리로 보내면 301 → Authorization 헤더가 리다이렉트에 묻힌다.
 */
export function wooSiteOrigin(siteOrHost: string): string {
  const s = String(siteOrHost || '').trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try { return `https://${new URL(s).hostname.toLowerCase()}`; } catch { /* 아래 폴백 */ }
  }
  return `https://${s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()}`;
}

// ════════════════════════════════════════════════════════════════════
// 필드 도우미
// ════════════════════════════════════════════════════════════════════

const HANGUL_ONLY_RE = /^[가-힣\s]+$/;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** 우커머스 first_name/last_name → 표시 이름. 둘 다 한글이면 성+이름 붙여쓰기('홍길동'), 그 밖은 'first last'. */
export function wooFullName(first: unknown, last: unknown): string | undefined {
  const f = str(first);
  const l = str(last);
  if (!f && !l) return undefined;
  if (!f) return l;
  if (!l) return f;
  if (HANGUL_ONLY_RE.test(f) && HANGUL_ONLY_RE.test(l)) return `${l}${f}`;
  return `${f} ${l}`;
}

/** meta_data[{key,value}] 에서 키가 정확히 일치하는 첫 항목의 value 원문. 없음·키 미설정·형태 이상 = undefined. */
export function wooMetaValue(meta: unknown, key: unknown): unknown {
  const k = str(key);
  if (!k || !Array.isArray(meta)) return undefined;
  for (const m of meta) {
    if (m && typeof m === 'object' && str((m as any).key) === k) return (m as any).value;
  }
  return undefined;
}

/**
 * ★2026-10-02 이 자원에서 동의 값을 **읽을 수 있었는가** — 동의 키가 설정돼 있고 메타 목록(배열)을 실제로 받았을 때만 true.
 *   wooMetaValue 의 undefined 는 셋을 가리지 못한다(키 미설정 · 메타 목록이 안 실림 · 목록에 그 키가 없음).
 *   「회원 정보에 동의 값이 없다」는 마지막 하나뿐이다 — 앞의 둘은 읽지 못한 것이지 값이 없는 것이 아니다.
 */
export function wooConsentReadable(meta: unknown, key: unknown): boolean {
  return !!str(key) && Array.isArray(meta);
}

const TZ_SUFFIX_RE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * 우커머스 날짜 → ISO 문자열. GMT 값(date_*_gmt · 시간대 표기 없음) 우선 → 'Z' 부여.
 * GMT가 없으면 로컬 값 그대로(시간대 미상). 둘 다 없거나 파싱 불가 → ''.
 */
export function wooDateToIso(gmt: unknown, local?: unknown): string {
  const g = str(gmt);
  if (g) {
    const iso = TZ_SUFFIX_RE.test(g) ? g : `${g}Z`;
    return isNaN(new Date(iso).getTime()) ? '' : iso;
  }
  const l = str(local);
  if (!l) return '';
  return isNaN(new Date(l).getTime()) ? '' : l;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// ════════════════════════════════════════════════════════════════════
// 웹훅 주제
// ════════════════════════════════════════════════════════════════════

export type WooTopicResource = 'order' | 'customer';
export type WooTopicEvent = 'created' | 'updated' | 'deleted' | 'restored';

const TOPIC_RE = /^(order|customer)\.(created|updated|deleted|restored)$/;

/** 'order.created' 같은 웹훅 주제 → {resource, event}. order·customer 밖(product·coupon·action) → null. */
export function wooTopicKind(topic: unknown): { resource: WooTopicResource; event: WooTopicEvent } | null {
  const m = TOPIC_RE.exec(str(topic).toLowerCase());
  if (!m) return null;
  return { resource: m[1] as WooTopicResource, event: m[2] as WooTopicEvent };
}

// ════════════════════════════════════════════════════════════════════
// 회원 → IdentifyInput
// ════════════════════════════════════════════════════════════════════

export interface WooMapOptions {
  /** normalizeWooMallId 결과. 비면 매핑 불가(null). */
  mallId: string;
  /** 수신동의가 든 meta_data 키(고객사가 연결 폼에 적음). 미설정 = consentRaw undefined(기존값 유지). */
  consentMetaKey?: string | null;
}

export interface WooMappedCustomer {
  identify: IdentifyInput;
  consentRaw?: unknown;
}

function pickAddress(billing: any): string | undefined {
  const a = [str(billing?.address_1), str(billing?.address_2)].filter(Boolean).join(' ');
  return a || undefined;
}

/**
 * 몰 운영자 역할(워드프레스·우커머스 고정값) — 회원이 아니라 적재하지 않는다(★0921).
 * 회원 역할은 몰마다 다르다(iroirotokyo.net 실측 = 멤버십 등급 역할 `bronze_member` · 우커머스 기본 `customer` 가 아님) →
 * 회원 조회는 role=all 로 하고, 허용 목록을 만들 수 없으니 고정된 운영자 역할만 뺀다. 회원 백필·회원 웹훅이 같은 규칙을 탄다.
 */
export const WOO_STAFF_ROLES: ReadonlySet<string> = new Set(['administrator', 'shop_manager', 'editor', 'author', 'contributor']);

/**
 * ★2026-10-02 이 몰의 **회원** 연결 식별자 모양 — `{mallId}:` 뒤가 숫자뿐(아래 mapWooCustomerToCdp · mapWooOrderToCdp 의 회원 식별자).
 *   비회원은 `{mallId}:guest:{휴대폰}` · `{mallId}:order:{주문번호}` 라 이 모양에 안 걸린다.
 *   「회원 정보에 동의 값이 없으면 동의」 규칙(CT mall-consent)이 "그 고객에게 이 몰의 다른 회원 연결이 있는가"를 볼 때 쓴다.
 *   ⛔ 식별자 모양을 바꾸면 여기도 같이 바꾼다(계약 테스트가 두 매핑의 실제 출력과 이 모양을 대조한다).
 */
export function wooMemberIdFormat(mallId: string): { memberIdPrefix: string; memberIdRestPattern: string } {
  return { memberIdPrefix: `${str(mallId)}:`, memberIdRestPattern: '^[0-9]+$' };
}

/**
 * 회원 JSON 1건 → identifyCustomer 입력 + 수신동의 raw.
 * - 운영자 역할(WOO_STAFF_ROLES)은 null
 * - externalId = `{mallId}:{id}`
 * - email: 회원 email → billing.email · phone: billing.phone → shipping.phone
 * - 반환 null: id·mallId 누락, 또는 email·phone 둘 다 없음(빈 고객 생성 차단 · 삭제 웹훅 {id} 포함)
 */
export function mapWooCustomerToCdp(raw: any, opts: WooMapOptions): WooMappedCustomer | null {
  if (!raw || typeof raw !== 'object') return null;
  const mallId = str(opts?.mallId);
  const id = str(raw.id);
  if (!mallId || !id) return null;
  if (WOO_STAFF_ROLES.has(str(raw.role).toLowerCase())) return null;

  const billing = raw.billing ?? {};
  const email = str(raw.email) || str(billing.email) || undefined;
  const phone = str(billing.phone) || str(raw.shipping?.phone) || undefined;
  if (!email && !phone) return null;

  const identify: IdentifyInput = {
    source: WOO_SOURCE,
    externalId: `${mallId}:${id}`,
    email,
    phone,
    name: wooFullName(raw.first_name || billing.first_name, raw.last_name || billing.last_name),
    address: pickAddress(billing),
  };
  return { identify, consentRaw: wooMetaValue(raw.meta_data, opts.consentMetaKey) };
}

// ════════════════════════════════════════════════════════════════════
// 주문 → OrderInput
// ════════════════════════════════════════════════════════════════════

export interface WooMappedOrder {
  order: OrderInput;
  consentRaw?: unknown;
}

function mapLineItem(li: any): NonNullable<OrderInput['items']>[number] {
  const quantity = toNumber(li?.quantity) || undefined;
  const unit = li?.price !== undefined && li?.price !== null && str(li.price) !== ''
    ? toNumber(li.price)
    : quantity ? toNumber(li?.total) / quantity : toNumber(li?.total);
  const productId = str(li?.product_id);
  const productName = str(li?.name);
  return {
    ...(productId && productId !== '0' ? { productId } : {}),
    ...(productName ? { productName } : {}),
    price: unit,
    ...(quantity ? { quantity } : {}),
  };
}

/**
 * ★ 2026-10-01 서명이 검증된 자원 본문이 말하는 몰 자신의 주소 → 몰 식별 형태의 호스트(www 뗀 값 · https 만 · 못 읽으면 null).
 *   우커머스는 REST 자원에 `_links.self[0].href`(그 몰의 주소)를 싣는다. 웹훅 비밀키를 아는 진짜 몰만 만들 수 있는 값이라
 *   **도메인 이전·다중 도메인의 증명**으로 쓴다(운영 실측: lensgogo.info → www.lensgogo.net · lens007.net → www.lens007.store).
 */
export function wooSelfHost(resource: any): string | null {
  const href = resource?._links?.self?.[0]?.href;
  if (typeof href !== 'string' || !/^https:\/\//i.test(href.trim())) return null;
  return normalizeWooMallId(href);
}

/**
 * 주문 JSON 1건 → syncOrder 입력 + 수신동의 raw.
 * - orderId = `{mallId}:{id}` · externalId = `{mallId}:{customer_id}`(회원) → `{mallId}:guest:{정규화 휴대폰}`(비회원) → `{mallId}:order:{id}`
 * - 금액 = total(문자열) → 숫자 · 주문시각 = date_created_gmt(Z) → date_created
 * - 반환 null: id·mallId·주문시각 누락(삭제 웹훅 {id}만 오는 경우 포함 = 적재 불가)
 */
export function mapWooOrderToCdp(raw: any, opts: WooMapOptions): WooMappedOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const mallId = str(opts?.mallId);
  const id = str(raw.id);
  if (!mallId || !id) return null;
  const orderedAt = wooDateToIso(raw.date_created_gmt, raw.date_created);
  if (!orderedAt) return null;

  const billing = raw.billing ?? {};
  const phone = str(billing.phone) || str(raw.shipping?.phone) || undefined;
  const email = str(billing.email) || undefined;
  const name = wooFullName(billing.first_name, billing.last_name);

  const customerId = toNumber(raw.customer_id);
  const guestPhone = phone ? normalizePhone(phone) : null;
  const externalId = customerId > 0
    ? `${mallId}:${customerId}`
    : guestPhone
      ? `${mallId}:guest:${guestPhone}`
      : `${mallId}:order:${id}`;

  const lineItems: any[] = Array.isArray(raw.line_items) ? raw.line_items : [];
  const items = lineItems.map(mapLineItem);

  const order: OrderInput = {
    source: WOO_SOURCE,
    orderId: `${mallId}:${id}`,
    externalId,
    email,
    phone,
    name,
    status: mapWooOrderStatus(raw.status, raw.date_paid_gmt ?? raw.date_paid, Array.isArray(raw.refunds) && raw.refunds.length > 0),
    totalAmount: toNumber(raw.total),
    itemCount: items.length || undefined,
    items: items.length ? items : undefined,
    orderedAt,
    currency: str(raw.currency) || 'KRW',
  };
  return { order, consentRaw: wooMetaValue(raw.meta_data, opts.consentMetaKey) };
}
