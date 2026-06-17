/**
 * 고도몰 응답 파싱·매핑 — 순수 함수 (DB/IO 무관, TDD 대상) — 2026-06-18
 *
 * 공식 스펙 정의서(godo_spec_extract.txt v1.0) 필드 기준.
 * ⛔ XML 실제 중첩·orderDate 타임존은 partner_key·IP 도착 후 실 raw 1건으로 최종 확인(D217).
 *
 * 수신동의는 raw(smsFl 문자열)만 반환하고, parseConsentValue 적용은 IO 계층(godo-client)에서 한다
 * (parseConsentValue는 cdp-identity 소속 = DB 모듈이라, 순수 모듈은 import하지 않음).
 */

import { XMLParser } from 'fast-xml-parser';
import type { OrderInput } from './cdp-orders';

export const GODO_SOURCE = 'godo';

// ════════════════════════════════════════════════════════════════════
// 주문상태코드(§7.1) → syncOrder status enum
// ════════════════════════════════════════════════════════════════════

const STATUS_MAP: Record<string, OrderInput['status']> = {
  // 결제됨(매출 반영) — 결제완료·상품준비/발주/입고/출고·교환·추가결제완료
  p1: 'paid', g1: 'paid', g2: 'paid', g3: 'paid', g4: 'paid',
  e1: 'paid', e2: 'paid', e3: 'paid', e4: 'paid', e5: 'paid', z2: 'paid',
  // 배송중
  d1: 'shipping', z3: 'shipping',
  // 완료(배송완료·구매확정·추가배송완료·교환추가완료)
  d2: 'completed', s1: 'completed', z4: 'completed', z5: 'completed',
  // 결제 전/실패/추가입금대기
  o1: 'pending', f1: 'pending', f2: 'pending', f3: 'pending', f4: 'pending', z1: 'pending',
  // 취소
  c1: 'cancelled', c2: 'cancelled', c3: 'cancelled', c4: 'cancelled',
  // 환불·반품(반품=환불 예정)
  r1: 'refunded', r2: 'refunded', r3: 'refunded',
  b1: 'refunded', b2: 'refunded', b3: 'refunded', b4: 'refunded',
};

/** 고도몰 주문상태코드 → syncOrder status. 미지의 코드는 'pending'(매출 미반영 안전). */
export function mapGodoOrderStatus(code: string): OrderInput['status'] {
  const c = (code || '').trim().toLowerCase();
  return STATUS_MAP[c] ?? 'pending';
}

// ════════════════════════════════════════════════════════════════════
// XML 파서
// ════════════════════════════════════════════════════════════════════

const REPEATED_TAGS = new Set([
  'order_data', 'orderGoodsData', 'orderInfoData', 'orderDeliveryData',
  'claimData', 'addGoodsData', 'giftData',
]);

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,   // orderNo 등 큰 수를 문자열로 보존(정밀도 손실 방지)
  trimValues: true,
  isArray: (tagName: string) => REPEATED_TAGS.has(tagName),
});

export interface GodoParsedResponse {
  code: string;               // RETURN 코드 (000 성공)
  msg: string;
  hasNext: boolean;           // header.lastOrder === 'true'
  lastOrderNo: string | null; // 다음 페이지 커서 = 이번 응답 마지막 주문번호
  orders: any[];              // raw order_data 객체 배열
}

/** 고도몰 응답 XML → 구조화. */
export function parseGodoOrderResponse(xml: string): GodoParsedResponse {
  const root = xmlParser.parse(xml || '');
  const data = root?.data ?? {};
  const header = data.header ?? {};
  const ret = data.return ?? {};
  const orders: any[] = Array.isArray(ret.order_data)
    ? ret.order_data
    : ret.order_data
      ? [ret.order_data]
      : [];
  const code = String(header.code ?? '').trim();
  const hasNext = String(header.lastOrder ?? '').trim().toLowerCase() === 'true';
  const lastOrderNo = orders.length ? String(orders[orders.length - 1]?.orderNo ?? '') || null : null;
  return { code, msg: String(header.msg ?? '').trim(), hasNext, lastOrderNo, orders };
}

// ════════════════════════════════════════════════════════════════════
// 주문 → CDP 매핑
// ════════════════════════════════════════════════════════════════════

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 고도몰 orderDate("2016-02-19 05:30:00") → ISO 유사 문자열. 파싱 불가 시 ''. */
function normalizeGodoDate(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : iso;
}

/** 주문의 주문자/배송지 정보(orderInfoData) 중 기본(orderInfoCd='1') 우선 선택. */
function pickOrderInfo(order: any): any {
  const arr: any[] = Array.isArray(order?.orderInfoData)
    ? order.orderInfoData
    : order?.orderInfoData
      ? [order.orderInfoData]
      : [];
  return arr.find((i) => String(i?.orderInfoCd ?? '') === '1') ?? arr[0] ?? {};
}

export interface GodoMappedOrder {
  order: OrderInput;
  smsRaw?: string; // orderInfoData.smsFl 원본(IO 계층에서 parseConsentValue 적용)
}

/**
 * raw order_data 1건 → syncOrder 입력 + 수신동의 raw.
 * - externalId: memId(회원) → guest:{휴대폰}(비회원) → order:{주문번호}
 * - 금액: settlePrice(>0) → 아니면 상품금액+배송비
 * - 반환 null: 주문번호/주문일자 누락(적재 불가)
 */
export function mapGodoOrderToCdp(order: any): GodoMappedOrder | null {
  const orderId = String(order?.orderNo ?? '').trim();
  if (!orderId) return null;
  const orderedAt = normalizeGodoDate(order?.orderDate);
  if (!orderedAt) return null;

  const info = pickOrderInfo(order);
  const memId = String(order?.memId ?? '').trim();
  const orderCell = String(info?.orderCellPhone ?? '').trim();
  const orderPhone = String(info?.orderPhone ?? '').trim();
  const phone = orderCell || orderPhone || undefined;
  const name = String(info?.orderName ?? '').trim() || undefined;
  const email = String(info?.orderEmail ?? '').trim() || undefined;

  const externalId = memId || (phone ? `guest:${phone}` : `order:${orderId}`);

  const goodsArr: any[] = Array.isArray(order?.orderGoodsData)
    ? order.orderGoodsData
    : order?.orderGoodsData
      ? [order.orderGoodsData]
      : [];
  const items = goodsArr.map((g) => ({
    productId: g?.goodsNo != null && String(g.goodsNo).trim() ? String(g.goodsNo).trim() : undefined,
    productName: g?.goodsNm != null && String(g.goodsNm).trim() ? String(g.goodsNm).trim() : undefined,
    price: toNumber(g?.goodsPrice),
    quantity: toNumber(g?.goodsCnt) || undefined,
  }));

  const settle = toNumber(order?.settlePrice);
  const totalAmount = settle > 0 ? settle : toNumber(order?.totalGoodsPrice) + toNumber(order?.totalDeliveryCharge);

  const orderInput: OrderInput = {
    source: GODO_SOURCE,
    orderId,
    externalId,
    phone,
    name,
    email,
    status: mapGodoOrderStatus(String(order?.orderStatus ?? '')),
    totalAmount,
    itemCount: items.length || undefined,
    items: items.length ? items : undefined,
    orderedAt,
    currency: 'KRW',
  };

  const smsRawVal = String(info?.smsFl ?? '').trim();
  return { order: orderInput, smsRaw: smsRawVal || undefined };
}
