/**
 * woocommerce-client.test.ts — 우커머스 IO 클라이언트(W2 · 설계서 docs/2026-09-14-woocommerce-integration-design.md §3)
 *  REST v3 URL·Basic 인증(순수) · 자격 저장(pending · 웹훅 secret 발급) · 연결 검증 1콜 · 백필(페이지 순회 · identify/syncOrder) · 상태.
 *  DB·HTTP는 mock — 적재 CT 호출 인자로 계약을 고정한다. 실 응답 형태는 게이트 ② 실측으로 확정.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('axios', () => ({ default: { get: vi.fn(), request: vi.fn() } }));
vi.mock('../cdp-identity', async (orig) => ({ ...(await orig<any>()), identifyCustomer: vi.fn(async () => ({ customerId: 'c', linkId: 'l', wasCreated: true, wasMerged: false })) }));
vi.mock('../cdp-orders', async (orig) => ({ ...(await orig<any>()), syncOrder: vi.fn(async () => ({ customerId: 'c', linkId: 'l', wasCustomerCreated: false, rfmUpdated: true })) }));

import axios from 'axios';
import { query } from '../../config/database';
import { identifyCustomer, CdpPhoneRequiredError } from '../cdp-identity';
import { syncOrder } from '../cdp-orders';
import {
  WOO_PROVIDER,
  DEFAULT_BACKFILL_DAYS,
  PAGE_SIZE,
  WooApiError,
  wooRestUrl,
  wooStoreUrl,
  wooSiteOrigin,
  wooBasicAuth,
  buildWooWebhookUrl,
  saveWooCredentials,
  getWooIntegration,
  listWooIntegrationsByMallId,
  verifyWooConnection,
  runWooBackfill,
  enqueueWooBackfill,
  wooBackfillIdle,
  wooTuning,
  MAX_BACKFILL_CUSTOMERS,
  MAX_BACKFILL_ORDERS,
  MAX_SYNC_ORDERS,
  WOO_MAX_CONSECUTIVE_FAILURES,
  syncWooOrdersSince,
  processWooResource,
  getWooStatus,
  fetchWooStoreProducts,
  fetchWooStoreProductsRaw,
  WOO_WEBHOOK_TOPICS,
  saveWooRestKeysFromAuth,
  ensureWooWebhooks,
  removeWooWebhooks,
  recordWooSetupError,
  wooWideHeaderTransport,
} from '../woocommerce-client';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MALL = 'ilbonimo.com';
const q = query as unknown as ReturnType<typeof vi.fn>;
const get = (axios as any).get as ReturnType<typeof vi.fn>;

function row(over: Record<string, any> = {}) {
  return {
    id: 'row-1', company_id: COMPANY, mall_id: MALL, status: 'active', connected_at: new Date('2026-09-01T00:00:00Z'), last_synced_at: null,
    webhook_secret: 'a'.repeat(64),
    meta: { woo_site_url: 'https://www.ilbonimo.com/', woo_consumer_key: 'ck_x', woo_consumer_secret: 'cs_y', woo_consent_meta_key: 'marketing_agree' },
    ...over,
  };
}

function order(id: number, over: Record<string, any> = {}) {
  return {
    id, status: 'processing', currency: 'KRW', date_created_gmt: '2026-09-14T09:28:02', total: '1000', customer_id: 25,
    billing: { first_name: '길동', last_name: '홍', email: 'h@example.invalid', phone: '010-0000-0001' },
    meta_data: [{ id: 1, key: 'marketing_agree', value: 'Y' }],
    line_items: [{ id: 1, name: '상품', product_id: 93, quantity: 1, total: '1000', price: 1000 }],
    ...over,
  };
}

beforeEach(() => {
  q.mockReset();
  q.mockImplementation(async () => ({ rows: [] }));
  get.mockReset();
  (identifyCustomer as any).mockClear();
  (syncOrder as any).mockClear();
});

describe('순수 — URL · 인증 헤더 · 웹훅 URL', () => {
  it("WOO_PROVIDER = 'woocommerce' · 백필 90일 · 페이지 20(★0921 의도 변경 — 100 은 실측 13.8초로 제한 20초에 걸린다)", () => {
    expect(WOO_PROVIDER).toBe('woocommerce');
    expect(DEFAULT_BACKFILL_DAYS).toBe(90);
    expect(PAGE_SIZE).toBe(20);
  });
  it('REST v3 URL = https://{mall}/wp-json/wc/v3/{자원}?params(undefined 생략 · 인코딩)', () => {
    expect(wooRestUrl(MALL, 'orders', { per_page: 100, page: 2, after: '2026-06-16T00:00:00Z', modified_after: undefined }))
      .toBe('https://ilbonimo.com/wp-json/wc/v3/orders?per_page=100&page=2&after=2026-06-16T00%3A00%3A00Z');
    expect(wooRestUrl(MALL, 'customers', {})).toBe('https://ilbonimo.com/wp-json/wc/v3/customers');
  });
  it('Store API URL = /wp-json/wc/store/v1/products(공개 · 키 없음) · include 는 콤마 목록', () => {
    expect(wooStoreUrl(MALL, { search: '렌즈', per_page: 20 })).toBe('https://ilbonimo.com/wp-json/wc/store/v1/products?search=%EB%A0%8C%EC%A6%88&per_page=20');
    expect(wooStoreUrl(MALL, { include: ['93', '94'] })).toBe('https://ilbonimo.com/wp-json/wc/store/v1/products?include=93%2C94');
  });
  it('Basic 인증 = base64(consumer_key:consumer_secret) · 비밀은 URL 에 싣지 않는다', () => {
    expect(wooBasicAuth('ck_x', 'cs_y')).toBe('Basic ' + Buffer.from('ck_x:cs_y').toString('base64'));
    expect(wooRestUrl(MALL, 'orders', { per_page: 1 })).not.toMatch(/consumer_/);
  });
  it('요청 기준 주소: 몰 주소(URL)면 그 호스트를 https 로 · 호스트만이면 https://{host} · 저장 주소의 호스트가 식별자 밖이면 https://{mallId}', () => {
    expect(wooSiteOrigin('https://www.ilbonimo.com/')).toBe('https://www.ilbonimo.com');
    expect(wooSiteOrigin('http://www.ilbonimo.com/shop')).toBe('https://www.ilbonimo.com');
    expect(wooSiteOrigin('ilbonimo.com')).toBe('https://ilbonimo.com');
    expect(wooRestUrl('https://www.ilbonimo.com/', 'orders', { per_page: 1 })).toBe('https://www.ilbonimo.com/wp-json/wc/v3/orders?per_page=1');
  });
  it('몰별 웹훅 URL = {APP_BASE_URL}/api/woocommerce/webhook/{mallId}', () => {
    expect(buildWooWebhookUrl(MALL, 'https://app.hanjul.ai/')).toBe('https://app.hanjul.ai/api/woocommerce/webhook/ilbonimo.com');
  });
});

describe('자격 저장 — 몰 1개 = 행 1개 · pending · 웹훅 secret 은 우리가 발급(1회 노출)', () => {
  it('저장 = INSERT ... ON CONFLICT (company_id, provider, mall_id) · status pending · meta 에 키·수신동의 메타키 · webhook_secret 64 hex', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('INSERT INTO company_integrations') ? { rows: [{ webhook_secret: 'b'.repeat(64), created: true }] } : { rows: [] }));
    const r = await saveWooCredentials(COMPANY, { siteUrl: 'https://www.ilbonimo.com/', consumerKey: 'ck_x', consumerSecret: 'cs_y', consentMetaKey: 'marketing_agree' });
    expect(r.mallId).toBe(MALL);
    expect(r.webhookUrl).toContain('/api/woocommerce/webhook/ilbonimo.com');
    expect(r.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    const insert = q.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO company_integrations'));
    expect(insert).toBeDefined();
    expect(insert![0]).toContain("'woocommerce'");
    expect(insert![0]).toContain('ON CONFLICT (company_id, provider, mall_id)');
    expect(insert![0]).toContain("'pending'");
    const meta = JSON.parse(insert![1][2]);
    expect(meta).toMatchObject({ woo_site_url: 'https://www.ilbonimo.com/', woo_consumer_key: 'ck_x', woo_consumer_secret: 'cs_y', woo_consent_meta_key: 'marketing_agree' });
    expect(insert![1][1]).toBe(MALL);
  });
  it('저장 시 몰 도메인을 수집 허용 도메인(companies.cdp_allowed_origins)에 등록한다(https://{mall} · https://www.{mall}) · 그 실패는 저장을 막지 않는다', async () => {
    q.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO company_integrations')) return { rows: [{ webhook_secret: 'b'.repeat(64) }] };
      if (sql.includes('cdp_allowed_origins')) throw new Error('column "cdp_allowed_origins" does not exist');
      return { rows: [] };
    });
    const r = await saveWooCredentials(COMPANY, { siteUrl: 'https://www.ilbonimo.com/', consumerKey: '', consumerSecret: '', consentMetaKey: '' });
    expect(r.mallId).toBe(MALL);
    const upd = q.mock.calls.find((c: any[]) => String(c[0]).includes('cdp_allowed_origins'));
    expect(upd).toBeDefined();
    expect(upd![0]).toContain('UPDATE companies');
    expect(upd![1]).toEqual([COMPANY, ['https://ilbonimo.com', 'https://www.ilbonimo.com']]);
  });
  it('몰 주소가 식별자로 접히지 않으면 WooApiError(invalid_site)', async () => {
    await expect(saveWooCredentials(COMPANY, { siteUrl: 'localhost', consumerKey: '', consumerSecret: '', consentMetaKey: '' })).rejects.toBeInstanceOf(WooApiError);
    expect(q).not.toHaveBeenCalled();
  });
  it('조회는 revoked 를 제외하고 meta 를 필드로 푼다', async () => {
    q.mockImplementation(async () => ({ rows: [row()] }));
    const r = await getWooIntegration(COMPANY, MALL);
    expect(r).toMatchObject({ companyId: COMPANY, mallId: MALL, status: 'active', consumerKey: 'ck_x', consumerSecret: 'cs_y', consentMetaKey: 'marketing_agree', webhookSecret: 'a'.repeat(64) });
    q.mockImplementation(async () => ({ rows: [row({ status: 'revoked' })] }));
    expect(await getWooIntegration(COMPANY, MALL)).toBeUndefined();
  });
  it('웹훅 수신용 몰 조회는 pending 도 포함한다(REST 키 없이 웹훅만 붙인 몰의 첫 수신이 검증 신호) · revoked 제외', async () => {
    q.mockImplementation(async (sql: string) => {
      expect(sql).toMatch(/status IN \('active', 'pending'\)/);
      return { rows: [row(), row({ id: 'row-2', company_id: '22222222-2222-4222-8222-222222222222', status: 'pending' })] };
    });
    const rows = await listWooIntegrationsByMallId(MALL);
    expect(rows).toHaveLength(2);
  });
});

describe('연결 검증 1콜 — 주문 1건 읽기 · 실패 코드 매핑 · 성공 시에만 active + connected_at', () => {
  it('200 → active 갱신 UPDATE 1회(connected_at COALESCE)', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row({ status: 'pending', connected_at: null })] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 200, headers: { 'x-wp-totalpages': '1' }, data: [order(1)] });
    await verifyWooConnection(COMPANY, MALL);
    const upd = q.mock.calls.filter((c: any[]) => String(c[0]).includes("status = 'active'"));
    expect(upd).toHaveLength(1);
    expect(upd[0][0]).toContain('connected_at = COALESCE(connected_at, NOW())');
    const call = get.mock.calls[0];
    // 기준 주소 = 저장된 몰 주소(www 포함) — 식별자(www 뗀 값)로 보내면 301 에 Authorization 이 묻힌다(리다이렉트 0)
    expect(call[0]).toBe('https://www.ilbonimo.com/wp-json/wc/v3/orders?per_page=1');
    expect(call[1].headers.Authorization).toBe(wooBasicAuth('ck_x', 'cs_y'));
    expect(call[1].maxRedirects).toBe(0);
  });
  it('401 → unauthorized · 404 → not_found · 비배열 200 → bad_response · 네트워크 → network · active 갱신 0', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row({ status: 'pending' })] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 401, headers: {}, data: { code: 'woocommerce_rest_cannot_view' } });
    await expect(verifyWooConnection(COMPANY, MALL)).rejects.toMatchObject({ code: 'unauthorized' });
    get.mockResolvedValueOnce({ status: 404, headers: {}, data: { code: 'rest_no_route' } });
    await expect(verifyWooConnection(COMPANY, MALL)).rejects.toMatchObject({ code: 'not_found' });
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: '<html>' });
    await expect(verifyWooConnection(COMPANY, MALL)).rejects.toMatchObject({ code: 'bad_response' });
    get.mockRejectedValueOnce(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    await expect(verifyWooConnection(COMPANY, MALL)).rejects.toMatchObject({ code: 'network' });
    // 301(www 유무·http→https) 은 따라가지 않고 주소를 고쳐 달라고 말한다 — Authorization 이 리다이렉트에 묻히지 않게
    get.mockResolvedValueOnce({ status: 301, headers: { location: 'https://www.ilbonimo.com/' }, data: '' });
    await expect(verifyWooConnection(COMPANY, MALL)).rejects.toMatchObject({ code: 'redirect' });
    expect(q.mock.calls.filter((c: any[]) => String(c[0]).includes("status = 'active'"))).toHaveLength(0);
  });
  it('REST 키가 없는 몰은 no_keys(웹훅 수신으로만 연결되는 몰)', async () => {
    q.mockImplementation(async () => ({ rows: [row({ meta: { woo_site_url: 'https://www.ilbonimo.com/' } })] }));
    await expect(verifyWooConnection(COMPANY, MALL)).rejects.toMatchObject({ code: 'no_keys' });
    expect(get).not.toHaveBeenCalled();
  });
  // ★0921 운영 실측(iroirotokyo.net): 몰에 연결은 됐는데 인증 응답 헤더 21,494 bytes 가 Node 기본 상한 16,384 를 넘어
  //   axios 가 code='HPE_HEADER_OVERFLOW' 로 던졌고, 화면엔 "몰 서버에 연결할 수 없습니다"로 나갔다(원인과 다른 안내).
  it('HPE_HEADER_OVERFLOW → header_overflow(연결 실패 문구 아님) · active 갱신 0', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row({ status: 'pending' })] } : { rows: [] }));
    get.mockRejectedValueOnce(Object.assign(new Error('Parse Error: Header overflow'), { code: 'HPE_HEADER_OVERFLOW' }));
    const err: any = await verifyWooConnection(COMPANY, MALL).catch((e) => e);
    expect(err).toBeInstanceOf(WooApiError);
    expect(err.code).toBe('header_overflow');
    expect(err.message).not.toContain('연결할 수 없습니다');
    expect(err.message).toContain('헤더');
    expect(q.mock.calls.filter((c: any[]) => String(c[0]).includes("status = 'active'"))).toHaveLength(0);
  });
  it('인증 호출(리다이렉트 0)은 넓은 헤더 상한 transport 를 싣는다 · 공개 Store API(리다이렉트 3)는 싣지 않는다', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row()] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 200, headers: { 'x-wp-totalpages': '1' }, data: [order(1)] });
    await verifyWooConnection(COMPANY, MALL);
    expect(get.mock.calls[0][1].transport).toBe(wooWideHeaderTransport);
    expect(typeof wooWideHeaderTransport.request).toBe('function');
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: [] });
    await fetchWooStoreProductsRaw(MALL, {});
    // transport 를 주면 axios 가 리다이렉트를 따라가지 않는다 — 공개 상품 조회는 지금처럼 따라가야 한다
    expect(get.mock.calls[1][1].maxRedirects).toBe(3);
    expect(get.mock.calls[1][1].transport).toBeUndefined();
  });
});

describe('processWooResource — 매핑 → identify(수신동의 있을 때) → syncOrder · 회원은 identify 만', () => {
  it('주문: 수신동의 Y → identifyCustomer(smsOptIn true) 뒤 syncOrder(orderId 몰 접두)', async () => {
    const r = await processWooResource(COMPANY, MALL, 'order', order(727), 'marketing_agree');
    expect(r).toBe('synced');
    expect(identifyCustomer).toHaveBeenCalledTimes(1);
    expect((identifyCustomer as any).mock.calls[0][1]).toMatchObject({ source: 'woocommerce', externalId: 'ilbonimo.com:25', phone: '010-0000-0001', smsOptIn: true });
    expect((syncOrder as any).mock.calls[0][1]).toMatchObject({ source: 'woocommerce', orderId: 'ilbonimo.com:727', status: 'paid', totalAmount: 1000 });
  });
  it('주문: 수신동의 메타키 미설정 → identify 0 · syncOrder 1(식별은 syncOrder 가 한다)', async () => {
    await processWooResource(COMPANY, MALL, 'order', order(727), null);
    expect(identifyCustomer).not.toHaveBeenCalled();
    expect(syncOrder).toHaveBeenCalledTimes(1);
  });
  it('회원: identify 1 · syncOrder 0 · 식별 수단 없는 회원({id}) 은 skipped', async () => {
    const c = { id: 25, email: 'h@example.invalid', first_name: '길동', last_name: '홍', billing: { phone: '010-0000-0001' }, meta_data: [{ key: 'marketing_agree', value: 'N' }] };
    expect(await processWooResource(COMPANY, MALL, 'customer', c, 'marketing_agree')).toBe('synced');
    expect((identifyCustomer as any).mock.calls[0][1]).toMatchObject({ externalId: 'ilbonimo.com:25', smsOptIn: false });
    expect(syncOrder).not.toHaveBeenCalled();
    expect(await processWooResource(COMPANY, MALL, 'customer', { id: 26 }, 'marketing_agree')).toBe('skipped');
  });
  it('삭제 페이로드({id}만) 주문은 skipped(적재 불가 · 던지지 않는다)', async () => {
    expect(await processWooResource(COMPANY, MALL, 'order', { id: 727 }, null)).toBe('skipped');
    expect(syncOrder).not.toHaveBeenCalled();
  });
});

// ★0921 iroirotokyo.net 실측: 90일 주문 20,267건 · per_page=100 이 13.8초(제한 20초) → ECONNABORTED 한 번에 가져오기 전체가 중단되고
//   다시 도는 경로가 없었다. 회원은 역할 기본값(customer) 때문에 0명(그 몰 회원 역할 = bronze_member). 옛 상한 = 회원 5,000명.
describe('가져오기(runWooBackfill) — 회원 → 주문 · 20건 단위 · 페이지 재시도 · 이어서 가져오기 · 상한은 건수', () => {
  const cust = (id: number, over: Record<string, any> = {}) => ({ id, role: 'bronze_member', email: `u${id}@example.invalid`, first_name: 'A', last_name: 'B', billing: { phone: '' }, meta_data: [], ...over });
  const page = (data: any[], totalPages = 1) => ({ status: 200, headers: { 'x-wp-totalpages': String(totalPages) }, data });
  const savedStates = () => q.mock.calls.filter((c: any[]) => String(c[0]).includes("'woo_backfill'")).map((c: any[]) => JSON.parse(c[1][2]));
  const withRow = (meta: Record<string, any> = {}) =>
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row({ meta: { ...row().meta, ...meta } })] } : { rows: [] }));
  beforeEach(() => { wooTuning.retryDelaysMs = [0, 0]; });

  it('상수: 페이지 20 · 상한은 건수(회원 50만 · 주문 20만 · 주기 5천) — 옛 5,000명 상한 없음', () => {
    expect(PAGE_SIZE).toBe(20);
    expect(MAX_BACKFILL_CUSTOMERS).toBeGreaterThanOrEqual(500_000);
    expect(MAX_BACKFILL_ORDERS).toBeGreaterThanOrEqual(200_000);
    expect(MAX_SYNC_ORDERS).toBe(5_000);
  });
  it('회원(role=all · id 오름차순) 2페이지 → 주문(after 90일 · date 오름차순) 2페이지 · 끝나면 done + active · 시작할 때 옛 오류를 지운다', async () => {
    withRow();
    get.mockResolvedValueOnce(page([cust(1), cust(2)], 2));
    get.mockResolvedValueOnce(page([cust(3)], 2));
    get.mockResolvedValueOnce(page([order(1), order(2)], 2));
    get.mockResolvedValueOnce(page([order(3)], 2));
    const st = await runWooBackfill(COMPANY, MALL);
    expect(st).toMatchObject({ stage: 'done', customers_imported: 3, orders_imported: 3, truncated: false });
    expect(st.done_at).toBeTruthy();
    expect(identifyCustomer).toHaveBeenCalled();
    expect(syncOrder).toHaveBeenCalledTimes(3);
    const c1 = new URL(get.mock.calls[0][0]);
    expect(c1.pathname).toBe('/wp-json/wc/v3/customers');
    expect(c1.searchParams.get('role')).toBe('all');
    expect(c1.searchParams.get('orderby')).toBe('id');
    expect(c1.searchParams.get('order')).toBe('asc');
    expect(c1.searchParams.get('per_page')).toBe('20');
    expect(new URL(get.mock.calls[1][0]).searchParams.get('page')).toBe('2');
    const o1 = new URL(get.mock.calls[2][0]);
    expect(o1.pathname).toBe('/wp-json/wc/v3/orders');
    expect(o1.searchParams.get('per_page')).toBe('20');
    expect(o1.searchParams.get('orderby')).toBe('date');
    expect(o1.searchParams.get('order')).toBe('asc');
    expect(o1.searchParams.get('dates_are_gmt')).toBe('true');
    expect(Math.round((Date.now() - new Date(o1.searchParams.get('after')!).getTime()) / 86400000)).toBe(90);
    // 기준일은 시작할 때 한 번 정해 저장한다 — 창이 밀리면 페이지가 밀려 건너뛴다
    expect(new URL(get.mock.calls[3][0]).searchParams.get('after')).toBe(o1.searchParams.get('after'));
    expect(q.mock.calls.filter((c: any[]) => String(c[0]).includes("status = 'active'"))).toHaveLength(1);
    expect(q.mock.calls.some((c: any[]) => String(c[0]).includes("- 'woo_sync_error'"))).toBe(true);
    // 페이지마다 진행 상태를 저장한다(재시작·실패 뒤 이어 가기 위한 자리)
    const states = savedStates();
    expect(states.length).toBeGreaterThanOrEqual(4);
    expect(states[states.length - 1].stage).toBe('done');
  });
  it('운영자 역할(administrator·shop_manager)은 회원으로 넣지 않는다', async () => {
    withRow();
    get.mockResolvedValueOnce(page([cust(1, { role: 'administrator' }), cust(2, { role: 'shop_manager' }), cust(3)]));
    get.mockResolvedValueOnce(page([]));
    const st = await runWooBackfill(COMPANY, MALL);
    expect(st.customers_imported).toBe(1);
    expect(identifyCustomer).toHaveBeenCalledTimes(1);
  });
  it('수신동의 실측 값(mssms_agreement_label = "YES"/"NO") → smsOptIn true/false 로 들어간다', async () => {
    const meta = (v: string) => [{ id: 1, key: 'mssms_agreement_label', value: v }];
    await processWooResource(COMPANY, MALL, 'customer', cust(1, { meta_data: meta('YES') }), 'mssms_agreement_label');
    await processWooResource(COMPANY, MALL, 'customer', cust(2, { meta_data: meta('NO') }), 'mssms_agreement_label');
    expect((identifyCustomer as any).mock.calls[0][1]).toMatchObject({ smsOptIn: true });
    expect((identifyCustomer as any).mock.calls[1][1]).toMatchObject({ smsOptIn: false });
  });
  // ★0921 배포 직후 운영 실측: 4몰 전부 회원 단계에서 "신규 회원 생성 시 phone은 필수입니다"로 즉시 중단
  //   (iroirotokyo 1페이지 0명 · ilbonimo 35페이지 679명에서). 한 건의 적재 불가가 가져오기 전체를 죽였다.
  it('전화번호 없는 회원·주문은 건너뛰고 계속 간다(no_phone 집계) — 한 건이 전체를 죽이지 않는다', async () => {
    withRow();
    (identifyCustomer as any).mockImplementationOnce(async () => { throw new CdpPhoneRequiredError(); });
    get.mockResolvedValueOnce(page([cust(1), cust(2), cust(3)]));
    (syncOrder as any).mockImplementationOnce(async () => { throw new CdpPhoneRequiredError(); });
    get.mockResolvedValueOnce(page([order(1, { meta_data: [] }), order(2, { meta_data: [] })]));
    const st = await runWooBackfill(COMPANY, MALL);
    expect(st).toMatchObject({ stage: 'done', customers_imported: 2, customers_no_phone: 1, orders_imported: 1, orders_no_phone: 1, failed: 0 });
    expect(q.mock.calls.some((c: any[]) => String(c[0]).includes("'woo_sync_error', $3"))).toBe(false);
  });
  it('예상 못 한 한 건 실패(컬럼 길이 등)도 그 건만 failed 로 세고 계속 간다', async () => {
    withRow();
    (identifyCustomer as any).mockImplementationOnce(async () => { throw new Error('value too long for type character varying(100)'); });
    get.mockResolvedValueOnce(page([cust(1), cust(2)]));
    get.mockResolvedValueOnce(page([]));
    const st = await runWooBackfill(COMPANY, MALL);
    expect(st).toMatchObject({ stage: 'done', customers_imported: 1, failed: 1 });
  });
  it('연속 실패는 데이터 문제가 아니라 장애다 — WOO_MAX_CONSECUTIVE_FAILURES 에서 멈추고 그 페이지에 남는다(전부 실패한 채 done 이 되지 않는다)', async () => {
    withRow();
    (identifyCustomer as any).mockImplementation(async () => { throw new Error('connection terminated'); });
    get.mockResolvedValue(page(Array.from({ length: 20 }, (_, i) => cust(i + 1)), 5));
    await expect(runWooBackfill(COMPANY, MALL)).rejects.toThrow('connection terminated');
    expect((identifyCustomer as any).mock.calls.length).toBe(WOO_MAX_CONSECUTIVE_FAILURES);
    const last = savedStates().pop();
    expect(last).toMatchObject({ stage: 'customers', customers_page: 1 });
    (identifyCustomer as any).mockImplementation(async () => ({ customerId: 'c', linkId: 'l', wasCreated: true, wasMerged: false }));
  });
  it('웹훅·재처리 경로(processWooResource): 전화번호 없음은 no_phone 으로 돌려주고 던지지 않는다 · 그 밖의 오류는 그대로 던진다', async () => {
    (identifyCustomer as any).mockImplementationOnce(async () => { throw new CdpPhoneRequiredError(); });
    expect(await processWooResource(COMPANY, MALL, 'customer', cust(1), null)).toBe('no_phone');
    (syncOrder as any).mockImplementationOnce(async () => { throw new CdpPhoneRequiredError(); });
    expect(await processWooResource(COMPANY, MALL, 'order', order(1, { meta_data: [] }), null)).toBe('no_phone');
    (identifyCustomer as any).mockImplementationOnce(async () => { throw new Error('db down'); });
    await expect(processWooResource(COMPANY, MALL, 'customer', cust(1), null)).rejects.toThrow('db down');
  });
  it('주기 수집도 한 건 실패로 회차 전체가 죽지 않는다(죽으면 커서가 안 나가 같은 건에서 영원히 실패한다)', async () => {
    withRow();
    (syncOrder as any).mockImplementationOnce(async () => { throw new CdpPhoneRequiredError(); });
    get.mockResolvedValueOnce(page([order(1, { meta_data: [] }), order(2, { meta_data: [] })]));
    const r = await syncWooOrdersSince(COMPANY, MALL, new Date(Date.now() - 3600 * 1000));
    expect(r.imported).toBe(1);
  });
  it('시간 초과(ECONNABORTED)는 같은 페이지를 다시 시도한다 — 두 번 실패 뒤 성공하면 끝까지 간다', async () => {
    withRow();
    get.mockResolvedValueOnce(page([]));                                                         // 회원 0
    get.mockRejectedValueOnce(Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' }));
    get.mockRejectedValueOnce(Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' }));
    get.mockResolvedValueOnce(page([order(1)]));
    const st = await runWooBackfill(COMPANY, MALL);
    expect(st.stage).toBe('done');
    expect(get).toHaveBeenCalledTimes(4);
    expect(new URL(get.mock.calls[3][0]).searchParams.get('page')).toBe('1');
  });
  it('재시도를 다 써도 실패하면 오류를 남기고 던진다 · 진행 상태는 그 페이지에 남는다(다음 회차가 이어 간다)', async () => {
    withRow();
    get.mockResolvedValueOnce(page([]));
    get.mockResolvedValueOnce(page([order(1)], 3));
    get.mockRejectedValue(Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' }));
    await expect(runWooBackfill(COMPANY, MALL)).rejects.toMatchObject({ code: 'network' });
    expect(get).toHaveBeenCalledTimes(2 + 3);
    const last = savedStates().pop();
    expect(last).toMatchObject({ stage: 'orders', orders_page: 2, orders_imported: 1 });
    const rec = q.mock.calls.find((c: any[]) => String(c[0]).includes("'woo_sync_error', $3"));
    expect(rec?.[1][3]).toBe('network');
  });
  it('401 은 재시도하지 않는다(키 문제는 기다려도 안 풀린다)', async () => {
    withRow();
    get.mockResolvedValueOnce({ status: 401, headers: {}, data: {} });
    await expect(runWooBackfill(COMPANY, MALL)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('이어서 가져오기: 저장된 단계·페이지의 한 페이지 앞에서 · 저장된 기준일 그대로 · 회원 단계는 다시 안 돈다', async () => {
    withRow({ woo_backfill: { stage: 'orders', customers_page: 9, orders_page: 5, orders_after: '2026-06-23T00:00:00', customers_imported: 160, orders_imported: 80, truncated: false, started_at: '2026-09-21T07:00:00.000Z', updated_at: '2026-09-21T07:10:00.000Z', done_at: null } });
    get.mockResolvedValueOnce(page([order(1)], 4));
    const st = await runWooBackfill(COMPANY, MALL);
    const u = new URL(get.mock.calls[0][0]);
    expect(u.pathname).toBe('/wp-json/wc/v3/orders');
    expect(u.searchParams.get('page')).toBe('4');
    expect(u.searchParams.get('after')).toBe('2026-06-23T00:00:00');
    expect(st).toMatchObject({ stage: 'done', customers_imported: 160, orders_imported: 81, started_at: '2026-09-21T07:00:00.000Z' });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('끝난 몰: 워커 경로(restartIfDone 없음)는 아무것도 안 부른다 · 재승인 경로(restartIfDone)는 처음부터 다시', async () => {
    const done = { stage: 'done', customers_page: 3, orders_page: 9, orders_after: '2026-06-23T00:00:00', customers_imported: 40, orders_imported: 160, truncated: false, started_at: 'x', updated_at: 'x', done_at: '2026-09-21T08:00:00.000Z' };
    withRow({ woo_backfill: done });
    const same = await runWooBackfill(COMPANY, MALL);
    expect(same.done_at).toBe('2026-09-21T08:00:00.000Z');
    expect(get).not.toHaveBeenCalled();
    get.mockResolvedValue(page([]));
    const again = await runWooBackfill(COMPANY, MALL, { restartIfDone: true });
    expect(new URL(get.mock.calls[0][0]).pathname).toBe('/wp-json/wc/v3/customers');
    expect(new URL(get.mock.calls[0][0]).searchParams.get('page')).toBe('1');
    expect(again).toMatchObject({ stage: 'done', customers_imported: 0, orders_imported: 0 });
  });
  it('enqueueWooBackfill: 같은 몰은 도는 동안 한 번만 줄 세운다(콜백·워커 동시 실행 방지)', async () => {
    withRow();
    get.mockResolvedValue(page([]));
    expect(enqueueWooBackfill(COMPANY, MALL)).toBe(true);
    expect(enqueueWooBackfill(COMPANY, MALL)).toBe(false);
    await wooBackfillIdle();
    expect(enqueueWooBackfill(COMPANY, MALL)).toBe(true);
    await wooBackfillIdle();
  });
  it('주기 수집(syncWooOrdersSince): modified_after = since · after = 90일 바닥(미지 파라미터 무시돼도 범위가 묶인다)', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row()] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 200, headers: { 'x-wp-totalpages': '1' }, data: [order(9, { status: 'completed' })] });
    const since = new Date(Date.now() - 2 * 3600 * 1000);
    const r = await syncWooOrdersSince(COMPANY, MALL, since);
    expect(r.imported).toBe(1);
    const u = new URL(get.mock.calls[0][0]);
    expect(u.searchParams.get('modified_after')).toBe(since.toISOString().replace(/\.\d{3}Z$/, ''));
    expect(u.searchParams.get('after')).not.toBeNull();
    expect(u.searchParams.get('dates_are_gmt')).toBe('true');
    expect(u.searchParams.get('orderby')).toBe('date');
    // 주기 수집은 연결 상태를 건드리지 않는다(active 갱신은 연결 검증·백필 몫)
    expect(q.mock.calls.filter((c: any[]) => String(c[0]).includes("status = 'active'"))).toHaveLength(0);
  });
  it('주기 수집도 20건 단위 · 시간 초과는 같은 페이지 재시도', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row()] } : { rows: [] }));
    get.mockRejectedValueOnce(Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' }));
    get.mockResolvedValueOnce({ status: 200, headers: { 'x-wp-totalpages': '1' }, data: [order(9)] });
    const r = await syncWooOrdersSince(COMPANY, MALL, new Date(Date.now() - 3600 * 1000));
    expect(r.imported).toBe(1);
    expect(get).toHaveBeenCalledTimes(2);
    expect(new URL(get.mock.calls[1][0]).searchParams.get('per_page')).toBe('20');
  });
});

describe('getWooStatus — 몰 목록 · connected = active+connected_at 인 몰이 하나라도 · 수집 실패 사유 · 비밀값 0', () => {
  it('두 몰(active·pending) → connected true · 몰별 webhookUrl · hasRestKeys · consentMetaKey · syncError · 키·secret 값은 없다', async () => {
    q.mockImplementation(async () => ({ rows: [
      row({ meta: { ...row().meta, woo_sync_error: '401', woo_sync_error_code: 'unauthorized', woo_sync_error_at: '2026-09-14T10:00:00' } }),
      row({ id: 'row-2', mall_id: 'lens007.net', status: 'pending', connected_at: null, meta: { woo_site_url: 'https://www.lens007.net/' } }),
    ] }));
    const s = await getWooStatus(COMPANY);
    expect(s.connected).toBe(true);
    expect(s.malls).toHaveLength(2);
    expect(s.malls[0]).toMatchObject({ mallId: MALL, status: 'active', connected: true, hasRestKeys: true, consentMetaKey: 'marketing_agree', syncError: { code: 'unauthorized' } });
    expect(s.malls[0].webhookUrl).toContain('/api/woocommerce/webhook/ilbonimo.com');
    expect(s.malls[1]).toMatchObject({ mallId: 'lens007.net', status: 'pending', connected: false, hasRestKeys: false, syncError: null });
    expect(JSON.stringify(s)).not.toMatch(/ck_x|cs_y|aaaaaaaa/);
  });
  it('가져오기 진행 상태(backfill)를 화면에 준다 — 없으면 null', async () => {
    q.mockImplementation(async () => ({ rows: [
      row({ meta: { ...row().meta, woo_backfill: { stage: 'orders', customers_page: 9, orders_page: 5, orders_after: '2026-06-23T00:00:00', customers_imported: 160, orders_imported: 80, truncated: false, started_at: 'a', updated_at: 'b', done_at: null } } }),
      row({ id: 'row-2', mall_id: 'lens007.net' }),
    ] }));
    const s = await getWooStatus(COMPANY);
    // 옛 상태(0921 첫 배포분 · no_phone·failed 키 없음)도 0 으로 읽힌다
    expect(s.malls[0].backfill).toEqual({ stage: 'orders', customersImported: 160, ordersImported: 80, noPhone: 0, failed: 0, truncated: false, doneAt: null });
    expect(s.malls[1].backfill).toBeNull();
  });
  it('행이 없으면 connected false · malls []', async () => {
    expect(await getWooStatus(COMPANY)).toEqual({ connected: false, malls: [] });
  });
});

describe('Store API 상품(공개 · 키 없음) — fetchWooStoreProducts / fetchWooStoreProductsRaw (W5 · AI 자동제작 접점)', () => {
  const product = (id: number, over: Record<string, any> = {}) => ({
    id, name: `상품 ${id}`, permalink: `https://www.ilbonimo.com/product/p${id}/`,
    prices: { price: '1000', regular_price: '1000', sale_price: '1000', currency_minor_unit: 0 },
    images: [{ src: `https://www.ilbonimo.com/u/${id}.jpg` }], is_purchasable: true, is_in_stock: true, ...over,
  });
  it('검색: search·per_page 로 Store API 호출 · Authorization 헤더 없음 · 정규화 MallProduct(provider woocommerce:{mall}) · 품절 제외', async () => {
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: [product(1), product(2, { is_in_stock: false })] });
    const list = await fetchWooStoreProducts(MALL, { q: '렌즈', limit: 20 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ provider: 'woocommerce:ilbonimo.com', code: '1', salePrice: 1000 });
    const [url, opts] = get.mock.calls[0];
    const u = new URL(url);
    expect(u.pathname).toBe('/wp-json/wc/store/v1/products');
    expect(u.searchParams.get('search')).toBe('렌즈');
    expect(u.searchParams.get('per_page')).toBe('20');
    expect(opts.headers.Authorization).toBeUndefined();
  });
  it('상품번호 재조회: include=ids · raw 그대로(가용성 판정은 호출부)', async () => {
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: [product(93), product(94, { is_purchasable: false })] });
    const raw = await fetchWooStoreProductsRaw(MALL, { ids: ['93', '94'] });
    expect(raw).toHaveLength(2);
    expect(new URL(get.mock.calls[0][0]).searchParams.get('include')).toBe('93,94');
  });
  it('per_page 상한 100 · 비배열 응답 bad_response · 404 not_found', async () => {
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: [] });
    await fetchWooStoreProducts(MALL, { limit: 500 });
    expect(new URL(get.mock.calls[0][0]).searchParams.get('per_page')).toBe('100');
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: { code: 'x' } });
    await expect(fetchWooStoreProducts(MALL, {})).rejects.toMatchObject({ code: 'bad_response' });
    get.mockResolvedValueOnce({ status: 404, headers: {}, data: {} });
    await expect(fetchWooStoreProducts(MALL, {})).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('① 1클릭 연결 — 앱 인증 콜백 키 저장 · 웹훅 자동 생성(REST) · 해제 시 웹훅 제거', () => {
  const request = (axios as any).request as ReturnType<typeof vi.fn>;
  beforeEach(() => { request.mockReset(); });

  it('saveWooRestKeysFromAuth: 해제 아닌 행의 meta 에 키·권한 병합(UPDATE ... RETURNING) · 행 없으면 false', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('UPDATE company_integrations') ? { rows: [{ id: 'row-1' }] } : { rows: [] }));
    expect(await saveWooRestKeysFromAuth(COMPANY, MALL, { consumerKey: 'ck_a', consumerSecret: 'cs_b', permissions: 'read_write' })).toBe(true);
    const upd = q.mock.calls.find((c: any[]) => String(c[0]).includes('UPDATE company_integrations'));
    expect(upd![0]).toMatch(/status <> 'revoked'/);
    expect(JSON.parse(upd![1][2])).toEqual({ woo_consumer_key: 'ck_a', woo_consumer_secret: 'cs_b', woo_key_permissions: 'read_write' });
    q.mockImplementation(async () => ({ rows: [] }));
    expect(await saveWooRestKeysFromAuth(COMPANY, MALL, { consumerKey: 'ck', consumerSecret: 'cs', permissions: 'read' })).toBe(false);
  });

  it('ensureWooWebhooks: 목록에 없으면 주제 4개를 POST 로 만든다(delivery_url = 몰별 수신 주소 · secret = 행 webhook_secret · active · wp_api_v3) · id 를 meta 에 기록', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row()] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: [] });
    let nextId = 100;
    request.mockImplementation(async (cfg: any) => ({ status: 201, headers: {}, data: { id: nextId++, topic: JSON.parse(cfg.data).topic, status: 'active' } }));
    const r = await ensureWooWebhooks(COMPANY, MALL);
    expect(r).toEqual({ created: 4, existing: 0, ids: [100, 101, 102, 103] });
    expect(request).toHaveBeenCalledTimes(4);
    const bodies = request.mock.calls.map((c: any[]) => JSON.parse(c[0].data));
    expect(bodies.map((b: any) => b.topic)).toEqual(WOO_WEBHOOK_TOPICS);
    for (const b of bodies) {
      expect(b.delivery_url).toBe(buildWooWebhookUrl(MALL));
      expect(b.secret).toBe('a'.repeat(64));
      expect(b.status).toBe('active');
      expect(b.api_version).toBe('wp_api_v3');
      expect(b.name).toContain('한줄로');
    }
    const cfg = request.mock.calls[0][0];
    expect(cfg.method).toBe('POST');
    expect(cfg.url).toBe('https://www.ilbonimo.com/wp-json/wc/v3/webhooks');
    expect(cfg.headers.Authorization).toBe(wooBasicAuth('ck_x', 'cs_y'));
    expect(cfg.maxRedirects).toBe(0);
    // id 목록은 jsonb 파라미터($3)로 병합된다 — SQL 문자열이 아니라 인자에서 찾는다
    const upd = q.mock.calls.find((c: any[]) => String(c[0]).includes('UPDATE company_integrations') && String(c[1]?.[2] || '').includes('woo_webhook_ids'));
    expect(upd).toBeDefined();
    expect(JSON.parse(upd![1][2])).toEqual({ woo_webhook_ids: [100, 101, 102, 103] });
  });

  it('ensureWooWebhooks: 같은 수신 주소·주제가 이미 있으면 만들지 않고 셈(재연결 멱등) · 목록 조회는 per_page 100', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row()] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: [
      { id: 7, topic: 'order.created', delivery_url: buildWooWebhookUrl(MALL), status: 'active' },
      { id: 8, topic: 'order.created', delivery_url: 'https://other.example/hook', status: 'active' },
    ] });
    request.mockImplementation(async (cfg: any) => ({ status: 201, headers: {}, data: { id: 200, topic: JSON.parse(cfg.data).topic } }));
    const r = await ensureWooWebhooks(COMPANY, MALL);
    expect(r.created).toBe(3);
    expect(r.existing).toBe(1);
    expect(r.ids).toContain(7);
    expect(new URL(get.mock.calls[0][0]).searchParams.get('per_page')).toBe('100');
  });

  it('ensureWooWebhooks: 쓰기 권한 없는 키(401/403) → WooApiError · REST 키 없는 몰 → no_keys', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row()] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 403, headers: {}, data: { code: 'woocommerce_rest_cannot_view' } });
    await expect(ensureWooWebhooks(COMPANY, MALL)).rejects.toMatchObject({ code: 'forbidden' });
    q.mockImplementation(async () => ({ rows: [row({ meta: { woo_site_url: 'https://www.ilbonimo.com/' } })] }));
    await expect(ensureWooWebhooks(COMPANY, MALL)).rejects.toMatchObject({ code: 'no_keys' });
  });

  it('removeWooWebhooks: meta 의 id 마다 DELETE ?force=true · 실패는 건너뛰고 개수만 · 키 없으면 0', async () => {
    q.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? { rows: [row({ meta: { ...row().meta, woo_webhook_ids: [100, 101] } })] } : { rows: [] }));
    request.mockResolvedValueOnce({ status: 200, headers: {}, data: { id: 100 } });
    request.mockResolvedValueOnce({ status: 404, headers: {}, data: {} });
    const n = await removeWooWebhooks(COMPANY, MALL);
    expect(n).toBe(1);
    expect(request.mock.calls[0][0].method).toBe('DELETE');
    expect(request.mock.calls[0][0].url).toBe('https://www.ilbonimo.com/wp-json/wc/v3/webhooks/100?force=true');
    q.mockImplementation(async () => ({ rows: [row({ meta: { woo_site_url: 'https://www.ilbonimo.com/', woo_webhook_ids: [1] } })] }));
    expect(await removeWooWebhooks(COMPANY, MALL)).toBe(0);
  });

  it('recordWooSetupError: 자동 설정 실패 사유를 수집 실패와 같은 meta 키(woo_sync_error*)에 남긴다 → 화면 "조치 필요" 한 경로', async () => {
    await recordWooSetupError(COMPANY, MALL, 'forbidden', '쓰기 권한 없음');
    const upd = q.mock.calls.find((c: any[]) => String(c[0]).includes('woo_sync_error'));
    expect(upd).toBeDefined();
    expect(upd![1]).toEqual([COMPANY, MALL, '쓰기 권한 없음', 'forbidden']);
  });
});
