/**
 * 고도몰 순수 함수 검증 (TDD) — 2026-06-18
 * 실행: node packages/backend/node_modules/ts-node/dist/bin.js --transpile-only -P packages/backend/tsconfig.json packages/backend/src/utils/godo-parse.verify.ts
 * 외부 키·IP 전이라 HTTP/백필은 실측 대상 — 본 검증은 파서·상태매핑·필드매핑(순수, DB-free)만.
 */

import assert from 'assert';
import { parseGodoOrderResponse, mapGodoOrderStatus, mapGodoOrderToCdp } from './godo-parse';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log('PASS', name);
}

// ── 주문상태코드 매핑 ──────────────────────────────────────────────
check('status p1 → paid', () => assert.strictEqual(mapGodoOrderStatus('p1'), 'paid'));
check('status g1 → paid', () => assert.strictEqual(mapGodoOrderStatus('g1'), 'paid'));
check('status s1 → completed', () => assert.strictEqual(mapGodoOrderStatus('s1'), 'completed'));
check('status d2 → completed', () => assert.strictEqual(mapGodoOrderStatus('d2'), 'completed'));
check('status d1 → shipping', () => assert.strictEqual(mapGodoOrderStatus('d1'), 'shipping'));
check('status o1 → pending', () => assert.strictEqual(mapGodoOrderStatus('o1'), 'pending'));
check('status c3 → cancelled', () => assert.strictEqual(mapGodoOrderStatus('c3'), 'cancelled'));
check('status r1 → refunded', () => assert.strictEqual(mapGodoOrderStatus('r1'), 'refunded'));
check('status b1(반품) → refunded', () => assert.strictEqual(mapGodoOrderStatus('b1'), 'refunded'));
check('status 대문자 P1 → paid', () => assert.strictEqual(mapGodoOrderStatus('P1'), 'paid'));
check('status 미지 코드 → pending', () => assert.strictEqual(mapGodoOrderStatus('xx'), 'pending'));

// ── XML 파서 ───────────────────────────────────────────────────────
const SINGLE_ORDER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<data>
  <header><code>000</code><msg>성공</msg><lastOrder>true</lastOrder></header>
  <return>
    <order_data>
      <orderNo>2501151716000289</orderNo>
      <memId>hong</memId>
      <orderStatus>p1</orderStatus>
      <orderDate>2025-01-15 17:16:00</orderDate>
      <settlePrice>32000</settlePrice>
      <orderInfoData>
        <orderInfoCd>1</orderInfoCd>
        <orderName>홍길동</orderName>
        <orderCellPhone>010-1234-5678</orderCellPhone>
        <orderEmail>hong@test.com</orderEmail>
        <smsFl>y</smsFl>
      </orderInfoData>
      <orderGoodsData>
        <goodsNo>1001</goodsNo><goodsNm>티셔츠</goodsNm><goodsPrice>16000</goodsPrice><goodsCnt>2</goodsCnt>
      </orderGoodsData>
    </order_data>
  </return>
</data>`;

check('parse: 단일 order_data → 배열 1건', () => {
  const r = parseGodoOrderResponse(SINGLE_ORDER_XML);
  assert.strictEqual(r.code, '000');
  assert.strictEqual(r.hasNext, true);
  assert.strictEqual(r.orders.length, 1);
  assert.strictEqual(r.lastOrderNo, '2501151716000289');
});

const MULTI_ORDER_XML = `<data>
  <header><code>000</code><msg>성공</msg><lastOrder>false</lastOrder></header>
  <return>
    <order_data><orderNo>A1</orderNo><orderStatus>p1</orderStatus><orderDate>2025-01-10 10:00:00</orderDate></order_data>
    <order_data><orderNo>A2</orderNo><orderStatus>c1</orderStatus><orderDate>2025-01-11 11:00:00</orderDate></order_data>
  </return>
</data>`;

check('parse: 복수 order_data → 배열 2건 + hasNext false + 마지막 커서', () => {
  const r = parseGodoOrderResponse(MULTI_ORDER_XML);
  assert.strictEqual(r.orders.length, 2);
  assert.strictEqual(r.hasNext, false);
  assert.strictEqual(r.lastOrderNo, 'A2');
});

check('parse: 주문 없음(빈 return)', () => {
  const r = parseGodoOrderResponse('<data><header><code>204</code><msg>주문정보가 없습니다.</msg></header><return></return></data>');
  assert.strictEqual(r.code, '204');
  assert.strictEqual(r.orders.length, 0);
  assert.strictEqual(r.lastOrderNo, null);
});

// ── 주문 → CDP 매핑 ────────────────────────────────────────────────
check('map: 회원 주문 — memId=externalId, 필드/품목/금액/동의raw', () => {
  const r = parseGodoOrderResponse(SINGLE_ORDER_XML);
  const m = mapGodoOrderToCdp(r.orders[0]);
  assert.ok(m);
  assert.strictEqual(m!.order.orderId, '2501151716000289');
  assert.strictEqual(m!.order.externalId, 'hong');
  assert.strictEqual(m!.order.phone, '010-1234-5678');
  assert.strictEqual(m!.order.name, '홍길동');
  assert.strictEqual(m!.order.email, 'hong@test.com');
  assert.strictEqual(m!.order.status, 'paid');
  assert.strictEqual(m!.order.totalAmount, 32000);
  assert.strictEqual(m!.order.source, 'godo');
  assert.strictEqual(m!.order.items?.length, 1);
  assert.strictEqual(m!.order.items?.[0].productName, '티셔츠');
  assert.strictEqual(m!.order.items?.[0].price, 16000);
  assert.strictEqual(m!.order.items?.[0].quantity, 2);
  assert.strictEqual(m!.smsRaw, 'y');
});

check('map: 비회원 주문 — externalId=guest:{휴대폰}, 동의raw=n', () => {
  const xml = `<data><header><code>000</code></header><return><order_data>
    <orderNo>G1</orderNo><orderStatus>p1</orderStatus><orderDate>2025-02-01 09:00:00</orderDate>
    <orderInfoData><orderInfoCd>1</orderInfoCd><orderCellPhone>010-9999-0000</orderCellPhone><smsFl>n</smsFl></orderInfoData>
  </order_data></return></data>`;
  const m = mapGodoOrderToCdp(parseGodoOrderResponse(xml).orders[0]);
  assert.strictEqual(m!.order.externalId, 'guest:010-9999-0000');
  assert.strictEqual(m!.smsRaw, 'n');
});

check('map: settlePrice 없으면 상품금액+배송비 fallback', () => {
  const xml = `<data><header><code>000</code></header><return><order_data>
    <orderNo>P1</orderNo><orderStatus>d2</orderStatus><orderDate>2025-02-02 09:00:00</orderDate>
    <totalGoodsPrice>10000</totalGoodsPrice><totalDeliveryCharge>2500</totalDeliveryCharge>
  </order_data></return></data>`;
  const m = mapGodoOrderToCdp(parseGodoOrderResponse(xml).orders[0]);
  assert.strictEqual(m!.order.totalAmount, 12500);
  assert.strictEqual(m!.order.status, 'completed');
});

check('map: 콤마 포함 금액 정규화', () => {
  const xml = `<data><header><code>000</code></header><return><order_data>
    <orderNo>P2</orderNo><orderStatus>p1</orderStatus><orderDate>2025-02-03 09:00:00</orderDate>
    <settlePrice>1,250,000</settlePrice>
  </order_data></return></data>`;
  const m = mapGodoOrderToCdp(parseGodoOrderResponse(xml).orders[0]);
  assert.strictEqual(m!.order.totalAmount, 1250000);
});

check('map: 주문번호 없으면 null', () => {
  const m = mapGodoOrderToCdp({ orderStatus: 'p1', orderDate: '2025-01-01 00:00:00' });
  assert.strictEqual(m, null);
});

check('map: 주문일자 없으면 null', () => {
  const m = mapGodoOrderToCdp({ orderNo: 'X1', orderStatus: 'p1' });
  assert.strictEqual(m, null);
});

check('map: smsFl 미전달 → smsRaw undefined', () => {
  const xml = `<data><header><code>000</code></header><return><order_data>
    <orderNo>S1</orderNo><orderStatus>p1</orderStatus><orderDate>2025-02-04 09:00:00</orderDate>
    <orderInfoData><orderInfoCd>1</orderInfoCd><orderName>김</orderName></orderInfoData>
  </order_data></return></data>`;
  const m = mapGodoOrderToCdp(parseGodoOrderResponse(xml).orders[0]);
  assert.strictEqual(m!.smsRaw, undefined);
});

console.log(`\nALL PASS — ${passed} checks`);
process.exit(0);
