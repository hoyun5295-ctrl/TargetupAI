/**
 * woocommerce-adapter.test.ts — 우커머스 IProviderAdapter(W2 · 설계서 §3 어댑터 층)
 *  서명(HMAC-SHA256 · base64/hex 둘 다 · timingSafe) · 몰 식별(발신 헤더) · 주제 헤더 · 멱등키(몰 접두 · 전송 고유값 우선) ·
 *  processWebhookEvent(event = "{mall}:{topic}" → 행 meta 의 수신동의 메타키 → processWooResource). 재처리 워커 경로와 같은 시그니처.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../cdp-identity', async (orig) => ({ ...(await orig<any>()), identifyCustomer: vi.fn(async () => ({})) }));
vi.mock('../cdp-orders', async (orig) => ({ ...(await orig<any>()), syncOrder: vi.fn(async () => ({})) }));

import { query } from '../../config/database';
import { identifyCustomer } from '../cdp-identity';
import { syncOrder } from '../cdp-orders';
import { woocommerceAdapter, parseWooEvent } from '../woocommerce-adapter';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MALL = 'ilbonimo.com';
const SECRET = 's3cr3t';
const q = query as unknown as ReturnType<typeof vi.fn>;

const integrationRow = {
  id: 'row-1', company_id: COMPANY, mall_id: MALL, status: 'active', connected_at: new Date(), last_synced_at: null, webhook_secret: SECRET,
  meta: { woo_site_url: 'https://www.ilbonimo.com/', woo_consent_meta_key: 'marketing_agree' },
};

beforeEach(() => {
  q.mockReset();
  q.mockImplementation(async () => ({ rows: [integrationRow] }));
  (identifyCustomer as any).mockClear();
  (syncOrder as any).mockClear();
});

describe('선언', () => {
  it("provider woocommerce · polling(REST 주기 수집 + 웹훅 가속) · webhook·서명·adminApi true · available", () => {
    expect(woocommerceAdapter.provider).toBe('woocommerce');
    expect(woocommerceAdapter.connectMethod).toBe('polling');
    expect(woocommerceAdapter.available).toBe(true);
    expect(woocommerceAdapter.capabilities).toEqual({ oauth: false, webhook: true, webhookSignatureVerification: true, adminApi: true });
    expect(() => woocommerceAdapter.buildAuthorizeUrl('m', 's')).toThrow();
  });
});

describe('verifyWebhookSignature — 원본 바이트 HMAC-SHA256 · base64(우커머스 기본 추정) 와 hex 둘 다 · secret 없으면 거부', () => {
  const body = Buffer.from('{"id":727,"status":"processing"}');
  it('base64 일치 → true · hex 일치 → true', () => {
    const b64 = createHmac('sha256', SECRET).update(body).digest('base64');
    const hex = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(woocommerceAdapter.verifyWebhookSignature(body, b64, SECRET)).toBe(true);
    expect(woocommerceAdapter.verifyWebhookSignature(body, hex, SECRET)).toBe(true);
    expect(woocommerceAdapter.verifyWebhookSignature(body.toString('utf8'), b64, SECRET)).toBe(true);
  });
  it('다른 secret · 변조 본문 · 빈 서명 · secret null → false', () => {
    const b64 = createHmac('sha256', SECRET).update(body).digest('base64');
    expect(woocommerceAdapter.verifyWebhookSignature(body, b64, 'other')).toBe(false);
    expect(woocommerceAdapter.verifyWebhookSignature(Buffer.from('{"id":728}'), b64, SECRET)).toBe(false);
    expect(woocommerceAdapter.verifyWebhookSignature(body, '', SECRET)).toBe(false);
    expect(woocommerceAdapter.verifyWebhookSignature(body, b64, null)).toBe(false);
  });
});

describe('헤더 추출 — 몰 = X-WC-Webhook-Source(정규화) · 주제 = X-WC-Webhook-Topic', () => {
  it('발신 주소 → 몰 식별자 · 없으면 null', () => {
    expect(woocommerceAdapter.extractMallIdFromWebhook({ 'x-wc-webhook-source': 'https://www.ilbonimo.com/' }, {})).toBe(MALL);
    expect(woocommerceAdapter.extractMallIdFromWebhook({ 'x-wc-webhook-source': ['https://www.lens007.net/'] }, {})).toBe('lens007.net');
    expect(woocommerceAdapter.extractMallIdFromWebhook({}, {})).toBeNull();
  });
  it('주제 헤더 → 소문자 trim · 없으면 null', () => {
    expect(woocommerceAdapter.extractEventFromWebhook({ 'x-wc-webhook-topic': ' Order.Created ' }, {})).toBe('order.created');
    expect(woocommerceAdapter.extractEventFromWebhook({}, {})).toBeNull();
  });
});

describe('멱등키 — 몰 접두 event 그대로 · 전송 고유값(delivery_id) 우선 · 자원 id 를 엔티티로', () => {
  it('delivery_id 있으면 {mall}:{topic}:evt:{id}', () => {
    const k = woocommerceAdapter.buildIdempotencyKey('ilbonimo.com:order.created', { id: 727 }, { delivery_id: '57' });
    expect(k).toBe('ilbonimo.com:order.created:evt:57');
  });
  it('없으면 {mall}:{topic}:{자원 id}:{본문 해시} · 본문이 바뀌면 키가 바뀐다(갱신은 통과) · 같은 본문은 같은 키', () => {
    const a = woocommerceAdapter.buildIdempotencyKey('ilbonimo.com:order.updated', { id: 727, status: 'processing' }, { id: 727, status: 'processing' });
    const b = woocommerceAdapter.buildIdempotencyKey('ilbonimo.com:order.updated', { id: 727, status: 'completed' }, { id: 727, status: 'completed' });
    const a2 = woocommerceAdapter.buildIdempotencyKey('ilbonimo.com:order.updated', { id: 727, status: 'processing' }, { id: 727, status: 'processing' });
    expect(a).toMatch(/^ilbonimo\.com:order\.updated:727:[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(a).toBe(a2);
    // 같은 주문 id 라도 몰이 다르면 다른 키
    expect(woocommerceAdapter.buildIdempotencyKey('lens007.net:order.updated', { id: 727, status: 'processing' }, { id: 727, status: 'processing' })).not.toBe(a);
  });
  it('회원 자원도 id 로 엔티티를 잡는다', () => {
    expect(woocommerceAdapter.buildIdempotencyKey('ilbonimo.com:customer.updated', { id: 25 }, { id: 25 })).toMatch(/^ilbonimo\.com:customer\.updated:25:/);
  });
});

describe('parseWooEvent — "{mall}:{topic}" 분해', () => {
  it('정상 · 몰 없음 · 주제 밖 → null', () => {
    expect(parseWooEvent('ilbonimo.com:order.created')).toEqual({ mallId: MALL, topic: 'order.created', kind: { resource: 'order', event: 'created' } });
    expect(parseWooEvent('order.created')).toBeNull();
    expect(parseWooEvent('ilbonimo.com:product.created')).toBeNull();
    expect(parseWooEvent('')).toBeNull();
  });
});

describe('processWebhookEvent — 재처리 워커와 같은 시그니처(companyId, event, resource)', () => {
  const order = { id: 727, status: 'processing', currency: 'KRW', date_created_gmt: '2026-09-14T09:28:02', total: '1000', customer_id: 25, billing: { first_name: '길동', last_name: '홍', email: 'h@example.invalid', phone: '010-0000-0001' }, meta_data: [{ key: 'marketing_agree', value: 'Y' }], line_items: [] };
  it('주문 생성: 행 meta 의 수신동의 메타키로 identify(smsOptIn) → syncOrder(orderId 몰 접두)', async () => {
    await woocommerceAdapter.processWebhookEvent(COMPANY, 'ilbonimo.com:order.created', order);
    expect((identifyCustomer as any).mock.calls[0][1]).toMatchObject({ source: 'woocommerce', externalId: 'ilbonimo.com:25', smsOptIn: true });
    expect((syncOrder as any).mock.calls[0][1]).toMatchObject({ source: 'woocommerce', orderId: 'ilbonimo.com:727', status: 'paid' });
    // 행 조회는 회사 + 몰 둘로 좁힌다(타사 몰 오적재 차단)
    const sel = q.mock.calls.find((c: any[]) => String(c[0]).includes('SELECT'));
    expect(sel![1]).toEqual([COMPANY, MALL]);
  });
  it('회원 갱신: identify 만', async () => {
    await woocommerceAdapter.processWebhookEvent(COMPANY, 'ilbonimo.com:customer.updated', { id: 25, email: 'h@example.invalid', first_name: '길동', last_name: '홍', billing: { phone: '010-0000-0001' }, meta_data: [] });
    expect(identifyCustomer).toHaveBeenCalledTimes(1);
    expect(syncOrder).not.toHaveBeenCalled();
  });
  it('삭제 주제({id}만) · 미지 주제 → 적재 0 · 던지지 않는다', async () => {
    await woocommerceAdapter.processWebhookEvent(COMPANY, 'ilbonimo.com:order.deleted', { id: 727 });
    await woocommerceAdapter.processWebhookEvent(COMPANY, 'ilbonimo.com:product.created', { id: 1 });
    expect(identifyCustomer).not.toHaveBeenCalled();
    expect(syncOrder).not.toHaveBeenCalled();
  });
  it('회사에 그 몰 행이 없으면 던진다(재처리 워커가 failed 로 남긴다 · 조용히 성공 처리하지 않는다)', async () => {
    q.mockImplementation(async () => ({ rows: [] }));
    await expect(woocommerceAdapter.processWebhookEvent(COMPANY, 'lens007.net:order.created', order)).rejects.toThrow(/연동/);
    expect(syncOrder).not.toHaveBeenCalled();
  });
});
