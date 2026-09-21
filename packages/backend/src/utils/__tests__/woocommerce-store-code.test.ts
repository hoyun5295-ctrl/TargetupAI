/**
 * woocommerce-store-code.test.ts — 우커머스 몰 행의 분류코드 (설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-1 · §3-4)
 *
 * 몰 1행 = 분류코드 1개(company_integrations.meta.store_code · DDL 0). 웹훅·주기 수집·연결 백필이 전부 지나는
 * processWooResource 가 그 값을 식별·주문 적재로 넘긴다. 분류코드가 없는 몰(기존 단일몰 회사)은 지금과 같다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('axios', () => ({ default: { get: vi.fn(), request: vi.fn() } }));
vi.mock('../cdp-identity', async (orig) => ({ ...(await orig<any>()), identifyCustomer: vi.fn(async () => ({ customerId: 'c', linkId: 'l', wasCreated: true, wasMerged: false })) }));
vi.mock('../cdp-orders', async (orig) => ({ ...(await orig<any>()), syncOrder: vi.fn(async () => ({ customerId: 'c', linkId: 'l', wasCustomerCreated: false, rfmUpdated: true })) }));

import axios from 'axios';
import { query } from '../../config/database';
import { identifyCustomer } from '../cdp-identity';
import { syncOrder } from '../cdp-orders';
import { saveWooCredentials, getWooIntegration, getWooStatus, processWooResource, runWooBackfill } from '../woocommerce-client';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MALL = 'iroirotokyo.net';
const q = query as unknown as ReturnType<typeof vi.fn>;
const request = (axios as any).request as ReturnType<typeof vi.fn>;
const get = (axios as any).get as ReturnType<typeof vi.fn>;
const identify = identifyCustomer as unknown as ReturnType<typeof vi.fn>;
const sync = syncOrder as unknown as ReturnType<typeof vi.fn>;

function row(meta: Record<string, any> = {}) {
  return {
    id: 'row-1', company_id: COMPANY, mall_id: MALL, status: 'active', connected_at: new Date('2026-09-01T00:00:00Z'), last_synced_at: null,
    webhook_secret: 'a'.repeat(64),
    meta: { woo_site_url: 'https://www.iroirotokyo.net/', woo_consumer_key: 'ck_x', woo_consumer_secret: 'cs_y', woo_consent_meta_key: 'mssms_agreement', ...meta },
  };
}
const customer = { id: 25, email: 'h@example.invalid', first_name: '길동', last_name: '홍', billing: { phone: '010-0000-0001' }, meta_data: [{ key: 'mssms_agreement', value: 'Y' }] };
const order = {
  id: 727, status: 'processing', currency: 'KRW', date_created_gmt: '2026-09-14T09:28:02', total: '1000', customer_id: 25,
  billing: { first_name: '길동', last_name: '홍', email: 'h@example.invalid', phone: '010-0000-0001' },
  meta_data: [{ id: 1, key: 'mssms_agreement', value: 'Y' }],
  line_items: [{ id: 1, name: '상품', product_id: 93, quantity: 1, total: '1000', price: 1000 }],
};

beforeEach(() => {
  q.mockReset();
  q.mockImplementation(async () => ({ rows: [] }));
  request.mockReset();
  get.mockReset();
  identify.mockClear();
  sync.mockClear();
});

describe('몰 행 ↔ 분류코드', () => {
  it('meta.store_code → storeCode · 없으면 null', async () => {
    q.mockImplementation(async () => ({ rows: [row({ store_code: 'IROIRO' })] }));
    expect((await getWooIntegration(COMPANY, MALL))?.storeCode).toBe('IROIRO');
    q.mockImplementation(async () => ({ rows: [row()] }));
    expect((await getWooIntegration(COMPANY, MALL))?.storeCode).toBeNull();
  });

  it('상태 응답의 몰 줄에 분류코드가 실린다(관리자 화면에서 어느 몰이 누구 것인지)', async () => {
    q.mockImplementation(async () => ({ rows: [row({ store_code: 'IROIRO' })] }));
    expect((await getWooStatus(COMPANY)).malls[0]).toMatchObject({ mallId: MALL, storeCode: 'IROIRO' });
  });
});

describe('saveWooCredentials — 분류코드 저장', () => {
  const insertMeta = () => {
    const call = q.mock.calls.find(([sql]: [string]) => String(sql).includes('INSERT INTO company_integrations'));
    return JSON.parse(call![1][2]);
  };

  it('storeCode 를 주면 행 meta 에 store_code 로 저장한다', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('INSERT INTO company_integrations') ? { rows: [{ webhook_secret: 'b'.repeat(64) }] } : { rows: [] }));
    await saveWooCredentials(COMPANY, { siteUrl: 'https://www.iroirotokyo.net/', consumerKey: '', consumerSecret: '', consentMetaKey: 'mssms_agreement', storeCode: 'IROIRO' });
    expect(insertMeta()).toMatchObject({ store_code: 'IROIRO', woo_consent_meta_key: 'mssms_agreement' });
  });

  it('storeCode 를 안 주면 meta 에 store_code 키가 없다(지금과 같은 저장 · 기존 몰의 분류코드를 덮지 않는다)', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('INSERT INTO company_integrations') ? { rows: [{ webhook_secret: 'b'.repeat(64) }] } : { rows: [] }));
    await saveWooCredentials(COMPANY, { siteUrl: 'https://www.iroirotokyo.net/', consumerKey: '', consumerSecret: '', consentMetaKey: '' });
    expect('store_code' in insertMeta()).toBe(false);
  });
});

describe('processWooResource — 분류코드를 적재로 넘긴다', () => {
  it('회원: identify 입력에 storeCode', async () => {
    await processWooResource(COMPANY, MALL, 'customer', customer, 'mssms_agreement', 'IROIRO');
    expect(identify.mock.calls[0][1]).toMatchObject({ externalId: 'iroirotokyo.net:25', storeCode: 'IROIRO' });
  });

  it('주문: 수신동의 identify 와 syncOrder 양쪽에 storeCode', async () => {
    await processWooResource(COMPANY, MALL, 'order', order, 'mssms_agreement', 'IROIRO');
    expect(identify.mock.calls[0][1]).toMatchObject({ storeCode: 'IROIRO' });
    expect(sync.mock.calls[0][1]).toMatchObject({ orderId: 'iroirotokyo.net:727', storeCode: 'IROIRO' });
  });

  it('분류코드 없는 몰: identify·syncOrder 입력에 storeCode 키가 없다(현재 동작 캡처)', async () => {
    await processWooResource(COMPANY, MALL, 'order', order, 'mssms_agreement');
    expect('storeCode' in identify.mock.calls[0][1]).toBe(false);
    expect('storeCode' in sync.mock.calls[0][1]).toBe(false);
    await processWooResource(COMPANY, MALL, 'customer', customer, 'mssms_agreement', null);
    expect('storeCode' in identify.mock.calls[1][1]).toBe(false);
  });
});

describe('백필 — 몰 행의 분류코드가 그대로 따라간다', () => {
  it('runWooBackfill(회원 단계): 행 meta.store_code → identify 입력', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('FROM company_integrations') ? { rows: [row({ store_code: 'IROIRO' })] } : { rows: [] }));
    const page = { status: 200, data: [customer], headers: { 'x-wp-totalpages': '1' } };
    request.mockResolvedValue(page);
    get.mockResolvedValueOnce(page);                                                              // 회원 1페이지
    get.mockResolvedValue({ status: 200, data: [], headers: { 'x-wp-totalpages': '1' } });        // 주문 0건
    const r = await runWooBackfill(COMPANY, MALL);
    expect(r.customers_imported).toBe(1);
    expect(identify.mock.calls[0][1]).toMatchObject({ storeCode: 'IROIRO' });
  });
});
