/**
 * woocommerce-core.test.ts — 우커머스 순수 매핑 코어(W1 · 2026-09-14 우커머스 연동 설계안)
 *  우커머스 REST v3 회원·주문 JSON → 적재 CT 입력(IdentifyInput · OrderInput). DB·네트워크 0.
 *  픽스처 형태 = 우커머스 공식 REST v3 문서 예시(billing.phone · line_items · meta_data · date_*_gmt).
 *  ⛔ 실 raw(수신동의 메타키 · 웹훅 본문)는 게이트 ② 웹훅 1건 실측으로 확정한다(D217 규약) — 이 테스트는 형태 계약만 고정.
 */
import { describe, it, expect } from 'vitest';
import {
  WOO_SOURCE,
  mapWooOrderStatus,
  normalizeWooMallId,
  wooFullName,
  wooMetaValue,
  wooDateToIso,
  wooTopicKind,
  mapWooCustomerToCdp,
  mapWooOrderToCdp,
} from '../woocommerce-core';

const MALL = 'ilbonimo.com';

/** 공식 문서 예시 형태의 주문 1건(회원 주문 · processing) */
function order(over: Record<string, any> = {}): any {
  return {
    id: 727,
    number: '727',
    status: 'processing',
    currency: 'KRW',
    date_created: '2026-09-14T18:28:02',
    date_created_gmt: '2026-09-14T09:28:02',
    date_modified_gmt: '2026-09-14T09:28:08',
    total: '29350',
    customer_id: 25,
    billing: {
      first_name: '길동', last_name: '홍', company: '', address_1: '테헤란로 1', address_2: '2층',
      city: '', state: '', postcode: '06234', country: 'KR', email: 'hong@example.invalid', phone: '010-0000-0001',
    },
    shipping: { first_name: '길동', last_name: '홍', address_1: '테헤란로 1', address_2: '2층', phone: '' },
    meta_data: [
      { id: 1, key: '_download_permissions_granted', value: 'yes' },
      { id: 2, key: 'marketing_agree', value: 'Y' },
    ],
    line_items: [
      { id: 315, name: '원데이 렌즈 30p', product_id: 93, variation_id: 0, quantity: 2, total: '18000', price: 9000, sku: 'L-30' },
      { id: 316, name: '렌즈 케이스', product_id: 94, variation_id: 12, quantity: 1, total: '11350', price: 11350, sku: '' },
    ],
    ...over,
  };
}

/** 공식 문서 예시 형태의 회원 1건 */
function customer(over: Record<string, any> = {}): any {
  return {
    id: 25,
    date_created_gmt: '2026-09-01T00:00:00',
    email: 'hong@example.invalid',
    first_name: '길동',
    last_name: '홍',
    role: 'customer',
    username: 'hong',
    billing: { first_name: '길동', last_name: '홍', address_1: '테헤란로 1', address_2: '2층', postcode: '06234', country: 'KR', email: 'hong@example.invalid', phone: '010-0000-0001' },
    shipping: { phone: '' },
    is_paying_customer: true,
    meta_data: [{ id: 10, key: 'marketing_agree', value: 'true' }],
    ...over,
  };
}

describe('source 상수 — 기존 소비처(unified-customer-profile · cdp-diagnostics)가 아는 값과 같다', () => {
  it("WOO_SOURCE === 'woocommerce'", () => {
    expect(WOO_SOURCE).toBe('woocommerce');
  });
});

describe('mapWooOrderStatus — 우커머스 코어 상태 → syncOrder status(매출 반영은 paid·completed만)', () => {
  it('processing = 결제됨 → paid · completed → completed', () => {
    expect(mapWooOrderStatus('processing')).toBe('paid');
    expect(mapWooOrderStatus('completed')).toBe('completed');
  });
  it('pending · on-hold · failed · checkout-draft = 결제 전/실패 → pending(매출 미반영)', () => {
    for (const s of ['pending', 'on-hold', 'failed', 'checkout-draft']) expect(mapWooOrderStatus(s)).toBe('pending');
  });
  it('cancelled → cancelled · refunded → refunded', () => {
    expect(mapWooOrderStatus('cancelled')).toBe('cancelled');
    expect(mapWooOrderStatus('refunded')).toBe('refunded');
  });
  it("DB 접두 형태 'wc-processing' · 대문자 · 공백도 같은 결과", () => {
    expect(mapWooOrderStatus('wc-processing')).toBe('paid');
    expect(mapWooOrderStatus(' Completed ')).toBe('completed');
  });
  it('미지의 상태(플러그인 커스텀 · trash · 빈 값) → pending(매출 미반영이 안전)', () => {
    expect(mapWooOrderStatus('trash')).toBe('pending');
    expect(mapWooOrderStatus('wc-partially-shipped')).toBe('pending');
    expect(mapWooOrderStatus('')).toBe('pending');
    expect(mapWooOrderStatus(undefined as any)).toBe('pending');
  });
});

describe('normalizeWooMallId — 몰 주소 → 몰 식별자(호스트 · www 제거 · 소문자)', () => {
  it('고객사 4몰 주소가 각각 호스트 하나로 접힌다', () => {
    expect(normalizeWooMallId('https://www.ilbonimo.com/')).toBe('ilbonimo.com');
    expect(normalizeWooMallId('https://www.iroirotokyo.net/')).toBe('iroirotokyo.net');
    expect(normalizeWooMallId('https://www.lens007.net/')).toBe('lens007.net');
    expect(normalizeWooMallId('https://www.lensgogo.club/')).toBe('lensgogo.club');
  });
  it('프로토콜 없음 · 대문자 · 경로 · 쿼리 · 포트 · 공백은 같은 식별자', () => {
    expect(normalizeWooMallId('ilbonimo.com')).toBe('ilbonimo.com');
    expect(normalizeWooMallId('  HTTP://Lens007.NET:443/shop?x=1  ')).toBe('lens007.net');
    expect(normalizeWooMallId('https://www.ilbonimo.com/wp-json/wc/v3/orders')).toBe('ilbonimo.com');
  });
  it('빈 값 · 점 없는 호스트 · 허용 문자 밖 · 비문자열 → null', () => {
    expect(normalizeWooMallId('')).toBeNull();
    expect(normalizeWooMallId('localhost')).toBeNull();
    expect(normalizeWooMallId('http://')).toBeNull();
    expect(normalizeWooMallId('ilbonimo.com/;drop')).toBe('ilbonimo.com');
    expect(normalizeWooMallId(null as any)).toBeNull();
    expect(normalizeWooMallId(42 as any)).toBeNull();
  });
  it('IP 리터럴·IPv6 은 몰이 아니다(이 식별자로 서버가 https 요청을 만든다 · 내부망 차단)', () => {
    expect(normalizeWooMallId('http://10.0.0.1/')).toBeNull();
    expect(normalizeWooMallId('127.0.0.1')).toBeNull();
    expect(normalizeWooMallId('https://[::1]/')).toBeNull();
  });
  it('80자를 넘는 호스트는 거부한다(mall_id·webhook_event varchar(100) 안에 "{mall}:{topic}" 이 들어가야 한다)', () => {
    const long = `${'a'.repeat(70)}.${'b'.repeat(20)}.com`;
    expect(long.length).toBeGreaterThan(80);
    expect(normalizeWooMallId(long)).toBeNull();
    expect(normalizeWooMallId(`${'a'.repeat(60)}.com`)).toBe(`${'a'.repeat(60)}.com`);
  });
});

describe('wooFullName — 한글은 성+이름 붙여쓰기 · 그 밖은 first last', () => {
  it("한글 성·이름 → '홍길동'", () => {
    expect(wooFullName('길동', '홍')).toBe('홍길동');
  });
  it("영문 → 'John Doe' · 한쪽만 있으면 그것만 · 둘 다 비면 undefined", () => {
    expect(wooFullName('John', 'Doe')).toBe('John Doe');
    expect(wooFullName('', 'Doe')).toBe('Doe');
    expect(wooFullName('  길동 ', '')).toBe('길동');
    expect(wooFullName('', '')).toBeUndefined();
    expect(wooFullName(undefined, null)).toBeUndefined();
  });
});

describe('wooMetaValue — meta_data[] 키 조회(정확히 일치 · 첫 항목)', () => {
  it('키가 있으면 value 원문 · 없으면 undefined · 키 미설정이면 undefined', () => {
    const meta = [{ id: 1, key: 'a', value: 'Y' }, { id: 2, key: 'a', value: 'N' }, { id: 3, key: 'b', value: { x: 1 } }];
    expect(wooMetaValue(meta, 'a')).toBe('Y');
    expect(wooMetaValue(meta, 'b')).toEqual({ x: 1 });
    expect(wooMetaValue(meta, 'zzz')).toBeUndefined();
    expect(wooMetaValue(meta, '')).toBeUndefined();
    expect(wooMetaValue(meta, undefined)).toBeUndefined();
  });
  it('meta_data가 배열이 아니거나 항목이 깨져도 던지지 않는다', () => {
    expect(wooMetaValue(undefined, 'a')).toBeUndefined();
    expect(wooMetaValue('junk', 'a')).toBeUndefined();
    expect(wooMetaValue([null, 3, { key: 'a', value: '1' }], 'a')).toBe('1');
  });
});

describe('wooDateToIso — GMT 값 우선 · 시간대 표기 없으면 Z 부여', () => {
  it("date_created_gmt '2026-09-14T09:28:02' → '2026-09-14T09:28:02Z'", () => {
    expect(wooDateToIso('2026-09-14T09:28:02', '2026-09-14T18:28:02')).toBe('2026-09-14T09:28:02Z');
  });
  it('GMT가 없으면 로컬 값을 그대로(시간대 미상) · 둘 다 없거나 파싱 불가면 빈 문자열', () => {
    expect(wooDateToIso(undefined, '2026-09-14T18:28:02')).toBe('2026-09-14T18:28:02');
    expect(wooDateToIso('', '')).toBe('');
    expect(wooDateToIso('not-a-date', undefined)).toBe('');
    expect(wooDateToIso(null, null)).toBe('');
  });
  it('이미 Z나 오프셋이 붙어 있으면 덧붙이지 않는다', () => {
    expect(wooDateToIso('2026-09-14T09:28:02Z', undefined)).toBe('2026-09-14T09:28:02Z');
    expect(wooDateToIso('2026-09-14T18:28:02+09:00', undefined)).toBe('2026-09-14T18:28:02+09:00');
  });
});

describe('wooTopicKind — 웹훅 주제 문자열 → 자원·이벤트', () => {
  it('order.* · customer.* 만 인정한다', () => {
    expect(wooTopicKind('order.created')).toEqual({ resource: 'order', event: 'created' });
    expect(wooTopicKind('order.updated')).toEqual({ resource: 'order', event: 'updated' });
    expect(wooTopicKind('order.deleted')).toEqual({ resource: 'order', event: 'deleted' });
    expect(wooTopicKind('customer.created')).toEqual({ resource: 'customer', event: 'created' });
    expect(wooTopicKind('customer.updated')).toEqual({ resource: 'customer', event: 'updated' });
  });
  it('product.* · coupon.* · action.* · 형식 밖 → null', () => {
    expect(wooTopicKind('product.created')).toBeNull();
    expect(wooTopicKind('coupon.updated')).toBeNull();
    expect(wooTopicKind('action.woocommerce_add_to_cart')).toBeNull();
    expect(wooTopicKind('order')).toBeNull();
    expect(wooTopicKind('')).toBeNull();
    expect(wooTopicKind(undefined)).toBeNull();
  });
});

describe('mapWooCustomerToCdp — 회원 JSON → IdentifyInput(+ 수신동의 raw)', () => {
  // ★0921 iroirotokyo.net 실측: 회원 역할 = bronze_member(멤버십 등급) · 수신동의 = mssms_agreement_label "YES"/"NO"
  it('역할: 등급 역할(bronze_member)·customer·역할 없음은 회원 · 운영자 역할(대소문자 무관)은 null', () => {
    for (const role of ['bronze_member', 'customer', 'subscriber', '', undefined]) {
      expect(mapWooCustomerToCdp({ ...customer(), role }, { mallId: MALL })).not.toBeNull();
    }
    for (const role of ['administrator', 'shop_manager', 'editor', 'author', 'contributor', 'Administrator']) {
      expect(mapWooCustomerToCdp({ ...customer(), role }, { mallId: MALL })).toBeNull();
    }
  });
  it('수신동의 실측 값: mssms_agreement_label = "YES" / "NO" 가 raw 로 그대로 나온다', () => {
    const yes = mapWooCustomerToCdp({ ...customer(), meta_data: [{ id: 1, key: 'mssms_agreement', value: 'on' }, { id: 2, key: 'mssms_agreement_label', value: 'YES' }] }, { mallId: MALL, consentMetaKey: 'mssms_agreement_label' });
    const no = mapWooCustomerToCdp({ ...customer(), meta_data: [{ id: 1, key: 'mssms_agreement', value: '' }, { id: 2, key: 'mssms_agreement_label', value: 'NO' }] }, { mallId: MALL, consentMetaKey: 'mssms_agreement_label' });
    expect(yes!.consentRaw).toBe('YES');
    expect(no!.consentRaw).toBe('NO');
  });
  it('기본 매핑: source · externalId = 몰:id · email · phone(billing) · name(한글 성+이름) · address(billing 1+2)', () => {
    const r = mapWooCustomerToCdp(customer(), { mallId: MALL, consentMetaKey: 'marketing_agree' });
    expect(r).not.toBeNull();
    expect(r!.identify).toEqual({
      source: 'woocommerce',
      externalId: 'ilbonimo.com:25',
      email: 'hong@example.invalid',
      phone: '010-0000-0001',
      name: '홍길동',
      address: '테헤란로 1 2층',
    });
    expect(r!.consentRaw).toBe('true');
  });
  it('수신동의 메타키가 없으면(미설정) consentRaw = undefined → IO 층이 기존값 유지', () => {
    expect(mapWooCustomerToCdp(customer(), { mallId: MALL }).consentRaw).toBeUndefined();
    expect(mapWooCustomerToCdp(customer(), { mallId: MALL, consentMetaKey: 'no_such_key' }).consentRaw).toBeUndefined();
  });
  it('회원 email이 비면 billing.email · billing.phone이 비면 shipping.phone', () => {
    const r = mapWooCustomerToCdp(customer({ email: '', billing: { email: 'b@example.invalid', phone: '' }, shipping: { phone: '010-0000-0002' } }), { mallId: MALL });
    expect(r!.identify.email).toBe('b@example.invalid');
    expect(r!.identify.phone).toBe('010-0000-0002');
  });
  it('식별 수단(email·phone)이 하나도 없으면 null — 빈 고객을 만들지 않는다(삭제 웹훅 {id}만 오는 경우 포함)', () => {
    expect(mapWooCustomerToCdp({ id: 25 }, { mallId: MALL })).toBeNull();
    expect(mapWooCustomerToCdp(customer({ email: '', billing: {}, shipping: {} }), { mallId: MALL })).toBeNull();
  });
  it('id가 없거나 mallId가 비면 null', () => {
    expect(mapWooCustomerToCdp(customer({ id: undefined }), { mallId: MALL })).toBeNull();
    expect(mapWooCustomerToCdp(customer(), { mallId: '' })).toBeNull();
    expect(mapWooCustomerToCdp(null, { mallId: MALL })).toBeNull();
  });
  it('같은 id라도 몰이 다르면 externalId가 다르다(4몰 워드프레스 user id 충돌 차단)', () => {
    const a = mapWooCustomerToCdp(customer(), { mallId: 'ilbonimo.com' })!.identify.externalId;
    const b = mapWooCustomerToCdp(customer(), { mallId: 'lens007.net' })!.identify.externalId;
    expect(a).not.toBe(b);
  });
});

describe('mapWooOrderToCdp — 주문 JSON → OrderInput(+ 수신동의 raw)', () => {
  it('회원 주문 기본 매핑: orderId = 몰:id · externalId = 몰:customer_id · 금액 정수 · 품목 · GMT 주문시각 · 통화', () => {
    const r = mapWooOrderToCdp(order(), { mallId: MALL, consentMetaKey: 'marketing_agree' });
    expect(r).not.toBeNull();
    expect(r!.order).toEqual({
      source: 'woocommerce',
      orderId: 'ilbonimo.com:727',
      externalId: 'ilbonimo.com:25',
      email: 'hong@example.invalid',
      phone: '010-0000-0001',
      name: '홍길동',
      status: 'paid',
      totalAmount: 29350,
      itemCount: 2,
      items: [
        { productId: '93', productName: '원데이 렌즈 30p', price: 9000, quantity: 2 },
        { productId: '94', productName: '렌즈 케이스', price: 11350, quantity: 1 },
      ],
      orderedAt: '2026-09-14T09:28:02Z',
      currency: 'KRW',
    });
    expect(r!.consentRaw).toBe('Y');
  });
  it('비회원 주문(customer_id 0) → externalId = 몰:guest:정규화 휴대폰 · 휴대폰도 없으면 몰:order:id', () => {
    const g = mapWooOrderToCdp(order({ customer_id: 0 }), { mallId: MALL })!;
    expect(g.order.externalId).toBe('ilbonimo.com:guest:01000000001');
    const g2 = mapWooOrderToCdp(order({ customer_id: 0, billing: { ...order().billing, phone: '010 0000 0001' } }), { mallId: MALL })!;
    expect(g2.order.externalId).toBe(g.order.externalId);
    const n = mapWooOrderToCdp(order({ customer_id: 0, billing: { ...order().billing, phone: '' } }), { mallId: MALL })!;
    expect(n.order.externalId).toBe('ilbonimo.com:order:727');
    expect(n.order.phone).toBeUndefined();
  });
  it('품목 price가 없으면 total/quantity로 · quantity 0·누락은 undefined · 이름 없는 품목은 productName 생략', () => {
    const r = mapWooOrderToCdp(order({ line_items: [
      { id: 1, name: '', product_id: 5, quantity: 3, total: '3000' },
      { id: 2, name: '무료 증정', product_id: 0, quantity: 0, total: '0', price: 0 },
    ] }), { mallId: MALL })!;
    expect(r.order.items).toEqual([
      { productId: '5', price: 1000, quantity: 3 },
      { productName: '무료 증정', price: 0 },
    ]);
    expect(r.order.itemCount).toBe(2);
  });
  it('품목이 없으면 items·itemCount 생략 · total 문자열에 콤마·공백이 있어도 숫자 · 파싱 불가는 0', () => {
    const r = mapWooOrderToCdp(order({ line_items: [], total: ' 1,234 ' }), { mallId: MALL })!;
    expect(r.order.items).toBeUndefined();
    expect(r.order.itemCount).toBeUndefined();
    expect(r.order.totalAmount).toBe(1234);
    expect(mapWooOrderToCdp(order({ total: 'abc' }), { mallId: MALL })!.order.totalAmount).toBe(0);
  });
  it('currency가 비면 KRW', () => {
    expect(mapWooOrderToCdp(order({ currency: '' }), { mallId: MALL })!.order.currency).toBe('KRW');
    expect(mapWooOrderToCdp(order({ currency: 'JPY' }), { mallId: MALL })!.order.currency).toBe('JPY');
  });
  it('id 없음 · 주문시각 없음(삭제 웹훅 {id}만) · mallId 빈 값 · 비객체 → null(적재 불가)', () => {
    expect(mapWooOrderToCdp({ id: 727 }, { mallId: MALL })).toBeNull();
    expect(mapWooOrderToCdp(order({ id: undefined }), { mallId: MALL })).toBeNull();
    expect(mapWooOrderToCdp(order({ date_created_gmt: '', date_created: '' }), { mallId: MALL })).toBeNull();
    expect(mapWooOrderToCdp(order(), { mallId: '' })).toBeNull();
    expect(mapWooOrderToCdp('junk', { mallId: MALL })).toBeNull();
  });
  it('상태 매핑이 주문에도 적용된다(refunded · on-hold)', () => {
    expect(mapWooOrderToCdp(order({ status: 'refunded' }), { mallId: MALL })!.order.status).toBe('refunded');
    expect(mapWooOrderToCdp(order({ status: 'on-hold' }), { mallId: MALL })!.order.status).toBe('pending');
  });
  it('수신동의 메타키 미설정이면 consentRaw undefined', () => {
    expect(mapWooOrderToCdp(order(), { mallId: MALL }).consentRaw).toBeUndefined();
  });
  it('같은 주문 id라도 몰이 다르면 orderId가 다르다(멱등 키 충돌 차단)', () => {
    const a = mapWooOrderToCdp(order(), { mallId: 'ilbonimo.com' })!.order.orderId;
    const b = mapWooOrderToCdp(order(), { mallId: 'lensgogo.club' })!.order.orderId;
    expect(a).not.toBe(b);
  });
});
