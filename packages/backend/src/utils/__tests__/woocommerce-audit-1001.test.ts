/**
 * ★ 2026-10-01 우커머스 전수점검(운영 4몰 실측 · 이에스페이먼트) — 결함 3종
 *   W-1 몰 도메인 이전: lensgogo.info → www.lensgogo.net · lens007.net → lens007.store. 인증 호출이 이동을 안 따라가 주기 수집이 9일간 실패.
 *       처방 = 서명 검증된 웹훅 본문이 말한 주소(_links.self)만 그 몰의 증명된 주소로 적고, 이동 대상이 그 주소(또는 www 만 다른 같은 몰)일 때만 따라간다.
 *   W-2 몰 고유 주문 상태(shipping · delayed · hold-shipping · cancel-request)를 전부 결제 전으로 처리 → 결제 완료 시각(date_paid)으로 판정.
 *   W-3 꺼진(disabled) 웹훅을 다시 켜지 않는다(일본이모 주문 수정 웹훅 7일 0건) → 주기 워커가 회차마다 점검.
 *   W-4 W-2 를 고쳐도 이미 결제 전으로 적재된 주문은 그대로다 → 끝난 가져오기의 주문 단계만 한 번 다시 읽는다(배포만으로 · 재연결·재설치 없음).
 *   W-7 주기 수집이 한 회차 상한에 닿으면 남은 주문을 조용히 버리고 커서를 전진시켰다 → 닿음을 돌려주고 주문 다시 읽기로 넘긴다(하루 한 번).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => {
  // 잠금(트랜잭션) 안 쿼리도 같은 모의로 잡는다 — pool.connect() 의 client.query = query
  const query = vi.fn(async () => ({ rows: [] }));
  return { query, pool: { connect: async () => ({ query, release: () => undefined }) } };
});
vi.mock('axios', () => ({ default: { get: vi.fn(), request: vi.fn() } }));
vi.mock('../cdp-identity', async (orig) => ({ ...(await orig<any>()), identifyCustomer: vi.fn(async () => ({ customerId: 'c', linkId: 'l', wasCreated: true, wasMerged: false })) }));
vi.mock('../cdp-orders', async (orig) => ({ ...(await orig<any>()), syncOrder: vi.fn(async () => ({ customerId: 'c', linkId: 'l', wasCustomerCreated: false, rfmUpdated: true })) }));

import axios from 'axios';
import { query } from '../../config/database';
import { mapWooOrderStatus, mapWooOrderToCdp, wooSelfHost } from '../woocommerce-core';
import {
  WooApiError, wooRedirectOrigin, noteWooSeenHost, WOO_SEEN_HOSTS_MAX, syncWooOrdersSince, ensureWooWebhooks,
  saveWooCredentials, resolveWooMallIdForSave, fetchWooStoreProducts, getWooIntegration, buildWooWebhookUrl, type WooIntegration,
  wooOrderRereadDue, startWooOrderReread, runWooBackfill, wooBackfillIdle, removeWooWebhooks, resetWooSeenHostRefusals,
  listWooWebhookCleanupTargets, WOO_WEBHOOK_CLEANUP_DAYS, disconnectWoo,
  WOO_ORDER_RULE_VERSION, WOO_REREAD_MIN_GAP_MS, MAX_SYNC_ORDERS, PAGE_SIZE,
} from '../woocommerce-client';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MALL = 'lensgogo.info';
const q = query as unknown as ReturnType<typeof vi.fn>;
const get = (axios as any).get as ReturnType<typeof vi.fn>;
const request = (axios as any).request as ReturnType<typeof vi.fn>;
const SRC = resolve(__dirname, '../..');

function row(meta: Record<string, any> = {}, over: Record<string, any> = {}) {
  return {
    id: 'row-1', company_id: COMPANY, mall_id: MALL, status: 'active', connected_at: new Date('2026-09-21T00:00:00Z'), last_synced_at: null,
    webhook_secret: 'a'.repeat(64),
    meta: { woo_site_url: 'https://www.lensgogo.info/', woo_consumer_key: 'ck_x', woo_consumer_secret: 'cs_y', woo_key_permissions: 'read_write', ...meta },
    ...over,
  };
}
const integ = async (meta: Record<string, any> = {}): Promise<WooIntegration> => {
  q.mockImplementationOnce(async () => ({ rows: [row(meta)] }));
  return (await getWooIntegration(COMPANY, MALL))!;
};

beforeEach(() => { q.mockReset(); q.mockImplementation(async () => ({ rows: [] })); get.mockReset(); request.mockReset(); resetWooSeenHostRefusals(); });

describe('W-2 주문 상태 — 모르는 상태는 결제 완료 시각으로 판정', () => {
  it('코어 상태는 종전 그대로(결제 시각과 무관)', () => {
    expect(mapWooOrderStatus('processing')).toBe('paid');
    expect(mapWooOrderStatus('wc-completed')).toBe('completed');
    expect(mapWooOrderStatus('cancelled', '2026-10-01T00:00:00')).toBe('cancelled');
    expect(mapWooOrderStatus('refunded', '2026-10-01T00:00:00')).toBe('refunded');
    expect(mapWooOrderStatus('pending', '2026-10-01T00:00:00')).toBe('pending');
    expect(mapWooOrderStatus('on-hold')).toBe('pending');
    expect(mapWooOrderStatus('failed')).toBe('pending');
  });
  it('몰 고유 상태: 세 근거(결제 시각 · 환불 기록 없음 · 이행 중 이름)가 모두 맞을 때만 paid — 운영 실측 shipping · delayed · hold-shipping', () => {
    for (const s of ['shipping', 'delayed', 'hold-shipping', 'wc-shipping', 'out-for-delivery', 'preparing']) {
      expect(mapWooOrderStatus(s, '2026-09-30T03:10:00'), s).toBe('paid');
      expect(mapWooOrderStatus(s, '2026-09-30T03:10:00', false), s).toBe('paid');
      expect(mapWooOrderStatus(s, null), s).toBe('pending');
      expect(mapWooOrderStatus(s, ''), s).toBe('pending');
      expect(mapWooOrderStatus(s), s).toBe('pending');
      // 환불 기록이 하나라도 있으면 올리지 않는다(Codex R1 — 환불 끝난 주문이 새 매출로 붙으면 안 된다)
      expect(mapWooOrderStatus(s, '2026-09-30T03:10:00', true), s).toBe('pending');
    }
  });
  it('환불·취소·반품 계열 이름과 뜻을 모르는 이름은 결제 시각이 있어도 종전처럼 결제 전(운영 실측 cancel-request 포함)', () => {
    for (const s of ['cancel-request', 'refund-complete', 'refund-request', 'return-shipping', 'exchange-shipping', 'delivery-failed', 'custom-xyz', 'vip', '']) {
      expect(mapWooOrderStatus(s, '2026-09-30T03:10:00', false), s).toBe('pending');
    }
  });
  it('지운 주문·임시 저장은 결제 시각이 있어도 매출로 올리지 않는다', () => {
    for (const s of ['trash', 'draft', 'auto-draft', 'checkout-draft']) expect(mapWooOrderStatus(s, '2026-09-30T03:10:00'), s).toBe('pending');
  });
  it('주문 매핑이 date_paid_gmt(없으면 date_paid)를 판정에 넘긴다', () => {
    const base = { id: 9, currency: 'KRW', date_created_gmt: '2026-09-29T01:00:00', total: '1000', customer_id: 3, billing: { phone: '010-0000-0001' }, line_items: [] };
    expect(mapWooOrderToCdp({ ...base, status: 'shipping', date_paid_gmt: '2026-09-29T01:05:00' }, { mallId: MALL })!.order.status).toBe('paid');
    expect(mapWooOrderToCdp({ ...base, status: 'shipping', date_paid_gmt: null, date_paid: '2026-09-29T10:05:00' }, { mallId: MALL })!.order.status).toBe('paid');
    expect(mapWooOrderToCdp({ ...base, status: 'shipping', date_paid_gmt: null, date_paid: null }, { mallId: MALL })!.order.status).toBe('pending');
    // 환불 기록(refunds[])도 판정에 넘긴다
    expect(mapWooOrderToCdp({ ...base, status: 'shipping', date_paid_gmt: '2026-09-29T01:05:00', refunds: [{ id: 1, total: '-1000' }] }, { mallId: MALL })!.order.status).toBe('pending');
    expect(mapWooOrderToCdp({ ...base, status: 'shipping', date_paid_gmt: '2026-09-29T01:05:00', refunds: [] }, { mallId: MALL })!.order.status).toBe('paid');
  });
});

describe('W-1 몰 주소 — 서명 검증된 본문이 증명한 주소로만 따라간다', () => {
  it('본문의 몰 주소 = _links.self[0].href 의 호스트(www 뗀 값 · https 만)', () => {
    expect(wooSelfHost({ _links: { self: [{ href: 'https://www.lensgogo.net/wp-json/wc/v3/orders/12' }] } })).toBe('lensgogo.net');
    expect(wooSelfHost({ _links: { self: [{ href: 'http://www.lensgogo.net/wp-json/wc/v3/orders/12' }] } })).toBeNull();
    expect(wooSelfHost({ _links: {} })).toBeNull();
    expect(wooSelfHost(null)).toBeNull();
  });
  it('이동 대상 판정: 같은 몰(www 만 다름) · 증명된 주소만 통과 — 모르는 호스트 · http · 같은 origin 은 null', () => {
    const me = { mallId: MALL, seenHosts: ['lensgogo.net'] };
    expect(wooRedirectOrigin(me, 'https://www.lensgogo.info', 'https://www.lensgogo.net/wp-json/wc/v3/orders?per_page=20')).toBe('https://www.lensgogo.net');
    expect(wooRedirectOrigin(me, 'https://lensgogo.info', 'https://www.lensgogo.info/wp-json/wc/v3/orders')).toBe('https://www.lensgogo.info');
    expect(wooRedirectOrigin(me, 'https://www.lensgogo.info', 'https://evil.example/wp-json/wc/v3/orders')).toBeNull();
    expect(wooRedirectOrigin(me, 'https://www.lensgogo.info', 'http://www.lensgogo.net/wp-json/wc/v3/orders')).toBeNull();
    expect(wooRedirectOrigin(me, 'https://www.lensgogo.info', '/wp-json/wc/v3/orders/')).toBeNull();
    expect(wooRedirectOrigin({ mallId: MALL, seenHosts: [] }, 'https://www.lensgogo.info', 'https://www.lensgogo.net/x')).toBeNull();
    expect(wooRedirectOrigin(me, 'https://www.lensgogo.info', undefined)).toBeNull();
  });
  it('증명 기록: 새 호스트일 때만 쓰고(최대 8) 수집 허용 도메인에도 넣는다 · 자기 주소·이미 아는 주소는 쓰지 않는다 · 회사 잠금 안에서 한 문장', async () => {
    const i = await integ();
    q.mockReset();
    q.mockImplementation(async (sql: string) => (String(sql).includes("RETURNING t.meta->'woo_seen_hosts' AS hosts") ? { rows: [{ hosts: ['lensgogo.net'] }] } : { rows: [] }));
    expect(await noteWooSeenHost(i, { _links: { self: [{ href: 'https://www.lensgogo.net/wp-json/wc/v3/orders/1' }] } })).toBe(true);
    const sqls = q.mock.calls.map((c: any[]) => String(c[0]));
    const upd = q.mock.calls.find((c: any[]) => String(c[0]).includes("RETURNING t.meta->'woo_seen_hosts' AS hosts"))!;
    expect(upd[1]).toEqual([COMPANY, MALL, 'lensgogo.net', WOO_SEEN_HOSTS_MAX]);
    // 잠금 → 쓰기 → 커밋 순서(판정과 쓰기가 같은 트랜잭션)
    const at = (needle: string) => sqls.findIndex((s) => s.includes(needle));
    expect(at('BEGIN')).toBeGreaterThan(-1);
    expect(at('pg_advisory_xact_lock(hashtext($1))')).toBeGreaterThan(at('BEGIN'));
    expect(at("RETURNING t.meta->'woo_seen_hosts' AS hosts")).toBeGreaterThan(at('pg_advisory_xact_lock'));
    expect(at('COMMIT')).toBeGreaterThan(at("RETURNING t.meta->'woo_seen_hosts' AS hosts"));
    expect(q.mock.calls.find((c: any[]) => String(c[0]).includes('pg_advisory_xact_lock'))![1]).toEqual([`woo-identity:${COMPANY}`]);
    // 같은 회사의 다른 몰이 가진 호스트(몰 식별자 · 증명 주소) · 이미 있는 값 · 상한 · 해제된 행 = 그 문장이 거른다
    expect(upd[0]).toContain("AND t.status <> 'revoked'");
    expect(upd[0]).toContain("AND NOT (COALESCE(t.meta->'woo_seen_hosts', '[]'::jsonb) ? $3)");
    expect(upd[0]).toContain("AND jsonb_array_length(COALESCE(t.meta->'woo_seen_hosts', '[]'::jsonb)) < $4");
    expect(upd[0]).toContain("o.company_id = t.company_id AND o.provider = 'woocommerce' AND o.id <> t.id AND o.status <> 'revoked'");
    expect(upd[0]).toContain("AND (o.mall_id = $3 OR (o.meta->'woo_seen_hosts') ? $3))");
    const allow = q.mock.calls.find((c: any[]) => String(c[0]).includes('cdp_allowed_origins'))!;
    expect(allow[1][1]).toEqual(['https://lensgogo.net', 'https://www.lensgogo.net']);
    expect(i.seenHosts).toEqual(['lensgogo.net']);
    q.mockClear();
    expect(await noteWooSeenHost(i, { _links: { self: [{ href: 'https://www.lensgogo.net/wp-json/wc/v3/orders/2' }] } })).toBe(false);
    expect(await noteWooSeenHost(i, { _links: { self: [{ href: 'https://www.lensgogo.info/wp-json/wc/v3/orders/3' }] } })).toBe(false);
    expect(await noteWooSeenHost(i, { id: 3 })).toBe(false);
    expect(q).not.toHaveBeenCalled();
    expect(WOO_SEEN_HOSTS_MAX).toBe(8);
  });
  it('같은 회사의 다른 몰이 가진 주소는 적지 않는다(Codex R1) — 못 적으면 허용 도메인도 안 건드리고 한동안 다시 묻지 않는다', async () => {
    const i = await integ();
    q.mockReset();
    q.mockImplementation(async () => ({ rows: [] }));   // 조건에 걸려 0행
    const body = { _links: { self: [{ href: 'https://ilbonimo.com/wp-json/wc/v3/orders/1' }] } };
    expect(await noteWooSeenHost(i, body)).toBe(false);
    expect(i.seenHosts).toEqual([]);
    expect(q.mock.calls.some((c: any[]) => String(c[0]).includes('cdp_allowed_origins'))).toBe(false);
    q.mockClear();
    expect(await noteWooSeenHost(i, body)).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
  it('주기 수집: 301 이 증명된 주소로 가면 한 번 따라가고 그 주소를 기준 주소로 굳힌다(인증 헤더는 그 주소로만)', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_seen_hosts: ['lensgogo.net'] })] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 301, headers: { location: 'https://www.lensgogo.net/wp-json/wc/v3/orders?per_page=20' }, data: '' });
    get.mockResolvedValueOnce({ status: 200, headers: { 'x-wp-totalpages': '1' }, data: [] });
    await syncWooOrdersSince(COMPANY, MALL, new Date('2026-09-22T00:00:00Z'));
    expect(get).toHaveBeenCalledTimes(2);
    expect(String(get.mock.calls[0][0])).toMatch(/^https:\/\/www\.lensgogo\.info\/wp-json\/wc\/v3\/orders\?/);
    expect(String(get.mock.calls[1][0])).toMatch(/^https:\/\/www\.lensgogo\.net\/wp-json\/wc\/v3\/orders\?/);
    expect(new URL(get.mock.calls[1][0]).search).toBe(new URL(get.mock.calls[0][0]).search);
    expect(get.mock.calls[1][1].maxRedirects).toBe(0);
    const adopt = q.mock.calls.find((c: any[]) => String(c[1]?.[2] || '').includes('woo_rest_origin'))!;
    expect(JSON.parse(adopt[1][2])).toEqual({ woo_rest_origin: 'https://www.lensgogo.net' });
  });
  it('증명 안 된 주소로 가는 301 은 따라가지 않는다 = 종전과 같은 redirect 오류 · 두 번째 호출 0', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row()] } : { rows: [] }));
    get.mockResolvedValue({ status: 301, headers: { location: 'https://www.lensgogo.net/wp-json/wc/v3/orders' }, data: '' });
    await expect(syncWooOrdersSince(COMPANY, MALL, new Date('2026-09-22T00:00:00Z'))).rejects.toMatchObject({ code: 'redirect' });
    for (const c of get.mock.calls) expect(String(c[0])).toMatch(/^https:\/\/www\.lensgogo\.info\//);
  });
  it('굳힌 기준 주소가 있으면 곧장 그 주소로 부른다 · 증명 목록에서 빠지면 저장 주소로 돌아간다', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_seen_hosts: ['lensgogo.net'], woo_rest_origin: 'https://www.lensgogo.net' })] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 200, headers: { 'x-wp-totalpages': '1' }, data: [] });
    await syncWooOrdersSince(COMPANY, MALL, new Date('2026-09-22T00:00:00Z'));
    expect(String(get.mock.calls[0][0])).toMatch(/^https:\/\/www\.lensgogo\.net\//);
    get.mockReset();
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_rest_origin: 'https://evil.example' })] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 200, headers: { 'x-wp-totalpages': '1' }, data: [] });
    await syncWooOrdersSince(COMPANY, MALL, new Date('2026-09-22T00:00:00Z'));
    expect(String(get.mock.calls[0][0])).toMatch(/^https:\/\/www\.lensgogo\.info\//);
  });
  it('새 주소로 다시 저장해도 행이 둘로 갈리지 않는다 — 증명된 주소면 기존 몰 행에 쓴다(주문번호 접두 유지)', async () => {
    q.mockImplementation(async (sql: string) => {
      if (String(sql).includes("(meta->'woo_seen_hosts') ? $2")) return { rows: [{ mall_id: MALL }] };
      if (String(sql).includes('INSERT INTO company_integrations')) return { rows: [{ webhook_secret: 's'.repeat(64) }] };
      return { rows: [] };
    });
    const r = await saveWooCredentials(COMPANY, { siteUrl: 'https://www.lensgogo.net/', consumerKey: '', consumerSecret: '', consentMetaKey: '' });
    expect(r.mallId).toBe(MALL);
    expect(r.webhookUrl).toBe(buildWooWebhookUrl(MALL));
    const ins = q.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO company_integrations'))!;
    expect(ins[1][1]).toBe(MALL);
    expect(JSON.parse(ins[1][2]).woo_site_url).toBe('https://www.lensgogo.net/');
  });
  it('저장 대상 행 판정: 같은 식별자 행 먼저 · 없으면 증명 주소 행 · 해제된 행은 보지 않는다', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes("(meta->'woo_seen_hosts') ? $2") ? { rows: [{ mall_id: MALL }] } : { rows: [] }));
    expect(await resolveWooMallIdForSave(COMPANY, 'https://www.lensgogo.net/shop')).toBe(MALL);
    q.mockImplementation(async () => ({ rows: [] }));
    expect(await resolveWooMallIdForSave(COMPANY, 'https://www.lensgogo.net/')).toBe('lensgogo.net');
    expect(await resolveWooMallIdForSave(COMPANY, 'not a url')).toBeNull();
    const client = readFileSync(resolve(SRC, 'utils/woocommerce-client.ts'), 'utf8');
    expect(client).toContain("WHERE company_id = $1::uuid AND provider = 'woocommerce' AND status <> 'revoked'\n        AND (mall_id = $2 OR (meta->'woo_seen_hosts') ? $2)\n      ORDER BY (mall_id = $2) DESC, created_at ASC LIMIT 1");
  });
  it('권한 게이트는 저장이 쓸 행이 정해진 뒤 같은 잠금 안에서 돈다(Codex R1) — 판정과 쓰기 사이에 대상이 바뀌지 않는다 · 거부하면 쓰지 않고 되돌린다', async () => {
    // 입력 주소(lensgogo.net)가 다른 담당자 몰(lensgogo.info · 분류코드 렌즈고고)의 증명 주소인 상황
    const other = row({ store_code: '렌즈고고', woo_seen_hosts: ['lensgogo.net'] });
    q.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("(meta->'woo_seen_hosts') ? $2")) return { rows: [{ mall_id: MALL }] };
      if (s.includes('FOR UPDATE')) return { rows: [other] };
      if (s.includes('INSERT INTO company_integrations')) return { rows: [{ webhook_secret: 's'.repeat(64) }] };
      return { rows: [] };
    });
    const seen: any[] = [];
    class Rejected extends Error {}
    await expect(saveWooCredentials(COMPANY, {
      siteUrl: 'https://www.lensgogo.net/', consumerKey: 'ck_new', consumerSecret: 'cs_new', consentMetaKey: '',
      decide: (existing) => { seen.push(existing); throw new Rejected('MALL_OWNED_BY_OTHER_STORE'); },
    })).rejects.toBeInstanceOf(Rejected);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ mallId: MALL, storeCode: '렌즈고고' });
    const sqls = q.mock.calls.map((c: any[]) => String(c[0]));
    const at = (needle: string) => sqls.findIndex((s) => s.includes(needle));
    const lastAt = (needle: string) => sqls.map((s) => s.includes(needle)).lastIndexOf(true);
    expect(at('pg_advisory_xact_lock(hashtext($1))')).toBeGreaterThan(at('BEGIN'));
    // 대상 행 판정은 두 번 — 줄에 서기 전(어느 몰의 줄에 설지) · 잠금 안(쓸 행 확정). 게이트는 잠금 안 판정 뒤에 돈다.
    expect(at("(meta->'woo_seen_hosts') ? $2")).toBeLessThan(at('BEGIN'));
    expect(lastAt("(meta->'woo_seen_hosts') ? $2")).toBeGreaterThan(at('pg_advisory_xact_lock'));
    expect(at('FOR UPDATE')).toBeGreaterThan(lastAt("(meta->'woo_seen_hosts') ? $2"));
    expect(q.mock.calls.find((c: any[]) => String(c[0]).includes('FOR UPDATE'))![1]).toEqual([COMPANY, MALL]);
    expect(at('INSERT INTO company_integrations')).toBe(-1);
    expect(at('ROLLBACK')).toBeGreaterThan(at('FOR UPDATE'));
    expect(at('COMMIT')).toBe(-1);
    expect(sqls.some((s) => s.includes('cdp_allowed_origins'))).toBe(false);

    // 통과하면 게이트가 준 분류코드로 쓴다(기존 행 = undefined 반환 → 분류코드 키를 싣지 않는다) · 해제된 행·없는 행 = null 로 불린다
    q.mockClear();
    const r = await saveWooCredentials(COMPANY, { siteUrl: 'https://www.lensgogo.net/', consumerKey: '', consumerSecret: '', consentMetaKey: '', storeCode: '덮어쓰면안됨', decide: () => ({ storeCode: undefined }) });
    expect(r.mallId).toBe(MALL);
    const ins = q.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO company_integrations'))!;
    expect(JSON.parse(ins[1][2])).not.toHaveProperty('store_code');
    const order = q.mock.calls.map((c: any[]) => String(c[0]));
    expect(order.findIndex((s) => s.includes('COMMIT'))).toBeGreaterThan(order.findIndex((s) => s.includes('INSERT INTO company_integrations')));
    for (const cur of [[{ ...other, status: 'revoked' }], []]) {
      q.mockImplementation(async (sql: string) => (String(sql).includes('FOR UPDATE') ? { rows: cur } : String(sql).includes('INSERT INTO') ? { rows: [{ webhook_secret: 's'.repeat(64) }] } : { rows: [] }));
      let got: any = 'unset';
      await saveWooCredentials(COMPANY, { siteUrl: 'https://new-mall.example/', consumerKey: '', consumerSecret: '', consentMetaKey: '', decide: (e) => { got = e; return { storeCode: '새코드' }; } });
      expect(got).toBeNull();
      const last = q.mock.calls.filter((c: any[]) => String(c[0]).includes('INSERT INTO company_integrations')).pop()!;
      expect(JSON.parse(last[1][2]).store_code).toBe('새코드');
    }
  });
  it('라우트: 화면 저장 2곳은 게이트를 저장 CT 에 넘긴다(먼저 행을 찾아 판정하지 않는다) · 거부는 사유 문장으로 답한다(소스 계약)', () => {
    const route = readFileSync(resolve(SRC, 'routes/woocommerce.ts'), 'utf8');
    const gate = route.slice(route.indexOf('async function decideStoreCode('), route.indexOf('/** WooApiError → 상태코드.'));
    expect(gate).not.toMatch(/getWooIntegration\(|resolveWooMallIdForSave\(|normalizeWooMallId\(/);
    expect(gate).toContain("if (!canTouchIntegration(actor, existing.storeCode)) throw new WooSaveRejected(409, 'MALL_OWNED_BY_OTHER_STORE');");
    expect(gate).toContain("throw new WooSaveRejected(409, 'STORE_CODE_CHANGE_NOT_SUPPORTED');");
    expect(gate).toContain('return { storeCode: existing ? undefined : pick.storeCode };');
    expect((route.match(/decide: decided\.decide/g) || []).length).toBe(2);
    expect(route).not.toMatch(/storeCode: decided\.storeCode/);
    expect(route).toContain('if (err instanceof WooSaveRejected) {');
    expect(route).toContain('res.status(err.httpStatus).json({ success: false, error: integrationLockMessage(err.lockCode), code: err.lockCode });');
  });
  it('해제된 행은 주소를 갖지 않는다(Codex R2) — 되살릴 때 옛 증명 주소·굳힌 기준 주소를 버리고, 해제된 행을 연결로 되돌리는 자리는 저장 하나', () => {
    const client = readFileSync(resolve(SRC, 'utils/woocommerce-client.ts'), 'utf8');
    // 저장 upsert: 해제됐던 행이면 두 키를 뺀 meta 에 덧쓴다(해제된 동안 그 주소를 다른 몰이 가져갔을 수 있다) · 살아 있는 행은 그대로
    expect(client).toContain("meta = (CASE WHEN company_integrations.status = 'revoked'\n                   THEN company_integrations.meta - 'woo_seen_hosts' - 'woo_rest_origin' - 'woo_webhook_cleanup'\n                   ELSE company_integrations.meta END) || EXCLUDED.meta,");
    expect(client).not.toContain('meta = company_integrations.meta || EXCLUDED.meta,');
    // 연결 표시는 해제된 행을 건드리지 않는다(도는 중이던 가져오기·수신이 해제 뒤에 끝나도 되살리지 않는다)
    const mark = client.slice(client.indexOf('export async function markWooConnected('), client.indexOf('export async function disconnectWoo('));
    expect(mark).toContain("WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 AND status <> 'revoked'`");
    // 해제 행을 pending 으로 바꾸는 문장은 저장 upsert 한 곳
    expect((client.match(/status = 'revoked' THEN 'pending'/g) || []).length).toBe(1);
    expect((client.match(/SET status = 'active'/g) || []).length).toBe(1);
  });
  it('상품 조회 결과의 몰 표기 = 연동 행의 몰 식별자(새 주소로 다시 저장한 몰도 provider 가 갈리지 않는다)', async () => {
    const item = { id: 77, name: '원데이 렌즈', permalink: 'https://www.lensgogo.net/product/77', is_purchasable: true, is_in_stock: true, prices: { price: '12000', currency_minor_unit: 0 }, images: [] };
    get.mockResolvedValue({ status: 200, headers: {}, data: [item] });
    const moved = await fetchWooStoreProducts('https://www.lensgogo.net/', { q: '렌즈' }, MALL);
    expect(moved).toHaveLength(1);
    expect(moved[0].provider).toBe(`woocommerce:${MALL}`);
    expect(String(get.mock.calls[0][0])).toMatch(/^https:\/\/www\.lensgogo\.net\/wp-json\/wc\/store\/v1\/products\?/);
    const plain = await fetchWooStoreProducts('https://www.lensgogo.info/', { q: '렌즈' });
    expect(plain[0].provider).toBe(`woocommerce:${MALL}`);
    for (const f of ['routes/mall-products.ts', 'utils/mall-product-match.ts']) {
      const src = readFileSync(resolve(SRC, f), 'utf8');
      expect(src, f).toMatch(/fetchWooStoreProducts\(integ\.siteUrl, \{[^}]*\}, integ\.mallId\)/);
      expect(src, f).not.toMatch(/fetchWooStoreProducts\(integ\.siteUrl, \{[^}]*\}\)/);
    }
  });
  it('수신·SDK 몰 판정도 증명된 주소를 같은 몰로 본다(소스 계약) · 주소 기록은 서명 검증 뒤에만', () => {
    const client = readFileSync(resolve(SRC, 'utils/woocommerce-client.ts'), 'utf8');
    expect(client).toContain("AND (mall_id = $1 OR (meta->'woo_seen_hosts') ? $1) AND status IN ('active', 'pending')");
    const scope = readFileSync(resolve(SRC, 'utils/integration-scope.ts'), 'utf8');
    expect(scope).toContain("AND (mall_id = $2 OR (meta->'woo_seen_hosts') ? $2) AND status <> 'revoked'");
    const route = readFileSync(resolve(SRC, 'routes/woocommerce.ts'), 'utf8');
    const verify = route.indexOf('woocommerceAdapter.verifyWebhookSignature(rawBody, signature, c.webhookSecret)');
    const reject = route.indexOf("return res.status(401).json({ success: false, error: '웹훅 서명 검증에 실패했습니다.' });");
    const note = route.indexOf('await noteWooSeenHost(integ, body)');
    expect(verify).toBeGreaterThan(-1);
    expect(reject).toBeGreaterThan(verify);
    expect(note).toBeGreaterThan(reject);
    expect((route.match(/noteWooSeenHost\(/g) || []).length).toBe(1);
  });
  it('서명이 맞은 뒤에는 그 행의 몰 식별자만 쓴다 — 요청 주소(증명 주소일 수 있다)로 이벤트·기록을 만들지 않는다(주문번호 접두가 갈리면 이중 매출)', () => {
    const route = readFileSync(resolve(SRC, 'routes/woocommerce.ts'), 'utf8');
    const hook = route.slice(route.indexOf("router.post(['/webhook/:mallId', '/webhook']"), route.indexOf('// 앱 인증(wc-auth) 콜백'));
    const after = hook.slice(hook.indexOf("return res.status(401).json({ success: false, error: '웹훅 서명 검증에 실패했습니다.' });"));
    expect(after).toContain('const event = buildWooEvent(integ.mallId, topic);');
    expect(after).toContain('JSON.stringify({ mall_id: integ.mallId, topic, delivery_id: deliveryId, resource: body })');
    expect(after).toContain('await markWooConnected(integ.companyId, integ.mallId);');
    expect(after).not.toMatch(/buildWooEvent\(mallId|mall_id: mallId|markWooConnected\(integ\.companyId, mallId\)/);
  });
});

describe('W-3 꺼진 웹훅 다시 켜기', () => {
  it('disabled 인 우리 웹훅은 PUT status active 로 다시 켠다 · paused·active 는 건드리지 않는다 · 없는 주제만 만든다', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') || String(sql).includes('RETURNING id') ? { rows: [row({ woo_webhook_ids: [1, 2, 3] })] } : { rows: [] }));
    const url = buildWooWebhookUrl(MALL);
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: [
      { id: 1, topic: 'order.created', delivery_url: url, status: 'active' },
      { id: 2, topic: 'order.updated', delivery_url: url, status: 'disabled' },
      { id: 3, topic: 'customer.created', delivery_url: url, status: 'paused' },
    ] });
    request.mockImplementation(async (cfg: any) => ({ status: cfg.method === 'PUT' ? 200 : 201, headers: {}, data: { id: 4 } }));
    const r = await ensureWooWebhooks(COMPANY, MALL);
    expect(r).toEqual({ created: 1, existing: 3, reactivated: 1, ids: [1, 2, 3, 4] });
    const put = request.mock.calls.map((c: any[]) => c[0]).filter((c: any) => c.method === 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0].url).toBe('https://www.lensgogo.info/wp-json/wc/v3/webhooks/2');
    expect(JSON.parse(put[0].data)).toEqual({ status: 'active' });
  });
  it('바뀐 것이 없으면 연동 행을 다시 쓰지 않는다(주기 워커가 회차마다 부른다)', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [1, 2, 3, 4] })] } : { rows: [] }));
    const url = buildWooWebhookUrl(MALL);
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: ['order.created', 'order.updated', 'customer.created', 'customer.updated'].map((topic, n) => ({ id: n + 1, topic, delivery_url: url, status: 'active' })) });
    const r = await ensureWooWebhooks(COMPANY, MALL);
    expect(r).toEqual({ created: 0, existing: 4, reactivated: 0, ids: [1, 2, 3, 4] });
    expect(q.mock.calls.some((c: any[]) => String(c[0]).includes('UPDATE company_integrations'))).toBe(false);
  });
  it('우리 웹훅 식별: 몰이 수신 주소 표기를 바꿔 돌려줘도 우리가 만든 id 면 우리 것 — 회차마다 새로 만들지 않는다', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [11, 12, 13, 14] })] } : { rows: [] }));
    const other = buildWooWebhookUrl(MALL) + '/';
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: ['order.created', 'order.updated', 'customer.created', 'customer.updated'].map((topic, n) => ({ id: 11 + n, topic, delivery_url: other, status: 'active' })) });
    const r = await ensureWooWebhooks(COMPANY, MALL);
    expect(r).toEqual({ created: 0, existing: 4, reactivated: 0, ids: [11, 12, 13, 14] });
    expect(request).not.toHaveBeenCalled();
  });
  it('웹훅이 100개 넘는 몰: 뒤 쪽까지 읽어 우리 것을 찾는다(한 쪽만 보고 또 만들지 않는다)', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [501, 502, 503, 504] })] } : { rows: [] }));
    const url = buildWooWebhookUrl(MALL);
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: Array.from({ length: 100 }, (_, n) => ({ id: n + 1, topic: 'order.created', delivery_url: 'https://other.example/hook', status: 'active' })) });
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: ['order.created', 'order.updated', 'customer.created', 'customer.updated'].map((topic, n) => ({ id: 501 + n, topic, delivery_url: url, status: 'active' })) });
    const r = await ensureWooWebhooks(COMPANY, MALL);
    expect(r).toEqual({ created: 0, existing: 4, reactivated: 0, ids: [501, 502, 503, 504] });
    expect(get).toHaveBeenCalledTimes(2);
    expect(new URL(get.mock.calls[1][0]).searchParams.get('page')).toBe('2');
    expect(request).not.toHaveBeenCalled();
  });
  it('목록 끝을 확인 못 하면(쪽수 상한) 만들지 않고 연동 행의 id 목록도 줄여 쓰지 않는다', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [9001, 9002, 9003, 9004] })] } : { rows: [] }));
    get.mockResolvedValue({ status: 200, headers: {}, data: Array.from({ length: 100 }, (_, n) => ({ id: n + 1, topic: 'order.created', delivery_url: 'https://other.example/hook', status: 'active' })) });
    const r = await ensureWooWebhooks(COMPANY, MALL);
    expect(r).toEqual({ created: 0, existing: 0, reactivated: 0, ids: [] });
    expect(get).toHaveBeenCalledTimes(10);
    expect(request).not.toHaveBeenCalled();
    expect(q.mock.calls.some((c: any[]) => String(c[0]).includes('UPDATE company_integrations'))).toBe(false);
  });
  it('목록 응답이 배열이 아니면 중단한다(Codex R1) — 빈 목록으로 읽어 회차마다 4개씩 만들지 않는다', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [1, 2, 3, 4] })] } : { rows: [] }));
    for (const data of [{ code: 'rest_forbidden' }, '<html>차단</html>', null]) {
      get.mockReset(); request.mockReset();
      get.mockResolvedValue({ status: 200, headers: {}, data });
      await expect(ensureWooWebhooks(COMPANY, MALL)).rejects.toMatchObject({ code: 'bad_response' });
      expect(request).not.toHaveBeenCalled();
    }
    expect(q.mock.calls.some((c: any[]) => String(c[0]).includes('UPDATE company_integrations'))).toBe(false);
  });
  describe('같은 몰의 웹훅을 다루는 실행은 한 줄로 선다(Codex R1~R3 — 교차 순서마다 보상을 덧대지 않고 교차를 없앤다)', () => {
    const idWrites = () => q.mock.calls.filter((c: any[]) => String(c[1]?.[2] || '').includes('woo_webhook_ids'));
    const methods = () => request.mock.calls.map((c: any[]) => c[0].method);
    const tick = () => new Promise<void>((r) => setImmediate(r));

    it('해제된 몰이면 아무것도 만들지 않는다 — 줄 안에서 행을 새로 읽는다(몰 서버 호출 0)', async () => {
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({}, { status: 'revoked' })] } : { rows: [] }));
      await expect(ensureWooWebhooks(COMPANY, MALL)).rejects.toMatchObject({ code: 'no_integration' });
      expect(get).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });
    it('점검이 도는 중에 해제되면: 제거는 점검 뒤에 서서, 점검이 적어 둔 id 로 지운다(해제 뒤 웹훅 잔존 0)', async () => {
      // 행 상태를 흉내 낸다 — id 쓰기·비우기가 다음 조회에 반영된다
      const state: { meta: Record<string, any>; status: string } = { meta: {}, status: 'active' };
      q.mockImplementation(async (sql: string, params?: any[]) => {
        const s = String(sql);
        if (s.includes('SELECT')) return { rows: [row(state.meta, { status: state.status })] };
        if (s.includes("- 'woo_webhook_ids'")) { delete state.meta.woo_webhook_ids; return { rows: [] }; }
        if (String(params?.[2] || '').includes('woo_webhook_ids')) Object.assign(state.meta, JSON.parse(params![2]));
        return { rows: [] };
      });
      let releaseList!: (v: any) => void;
      get.mockReturnValueOnce(new Promise((r) => { releaseList = r; }));          // 점검이 목록 조회에서 멈춰 있다
      // 그다음 목록 조회 = 제거의 재확인(점검이 만든 4개가 몰에 있다)
      get.mockImplementation(async () => ({ status: 200, headers: {}, data: [700, 701, 702, 703].map((id, n) => ({ id, topic: ['order.created', 'order.updated', 'customer.created', 'customer.updated'][n], delivery_url: buildWooWebhookUrl(MALL), status: 'active' })) }));
      let nextId = 700;
      request.mockImplementation(async (cfg: any) => (cfg.method === 'DELETE' ? { status: 200, headers: {}, data: {} } : { status: 201, headers: {}, data: { id: nextId++ } }));

      const ensuring = ensureWooWebhooks(COMPANY, MALL);
      await tick(); await tick();
      state.status = 'revoked';                                                     // 그 사이 해제(행을 먼저 끊는다)
      const removing = removeWooWebhooks(COMPANY, MALL);                            // 제거는 줄에 선다
      await tick(); await tick();
      expect(request).not.toHaveBeenCalled();                                       // 점검이 안 끝났으니 제거도 아직
      releaseList({ status: 200, headers: {}, data: [] });

      expect(await ensuring).toMatchObject({ created: 4, ids: [700, 701, 702, 703] });
      expect(await removing).toBe(4);
      expect(methods()).toEqual(['POST', 'POST', 'POST', 'POST', 'DELETE', 'DELETE', 'DELETE', 'DELETE']);
      expect(request.mock.calls.slice(4).map((c: any[]) => c[0].url)).toEqual([700, 701, 702, 703].map((id) => `https://www.lensgogo.info/wp-json/wc/v3/webhooks/${id}?force=true`));
      expect(state.meta.woo_webhook_ids).toBeUndefined();
    });
    it('id 는 추적값이라 행 상태와 무관하게 적는다(해제 직후 끝난 점검이 만든 것도 제거가 찾는다)', () => {
      const client = readFileSync(resolve(SRC, 'utils/woocommerce-client.ts'), 'utf8');
      const save = client.slice(client.indexOf('async function saveWooWebhookIds('), client.indexOf('export function removeWooWebhooks('));
      expect(save).toContain("WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,");
      expect(save).not.toContain("status <> 'revoked'");
      // 점검·제거 둘 다 같은 줄(몰 단위)에 선다 · 보상 삭제 장치는 없다
      expect(client).toContain('return runSerial(wooWebhookLine(companyId, mallId), () => ensureWooWebhooksInLine(companyId, mallId));');
      expect(client).toContain('return runSerial(wooWebhookLine(companyId, mallId), () => removeWooWebhooksInLine(companyId, mallId));');
      expect(client).toContain('const wooWebhookLine = (companyId: string, mallId: string): string => `woo-webhooks:${companyId}:${mallId}`;');
      expect(client).not.toContain('settleCreatedWooWebhooks');
    });
    it('만들다 실패하면 기존 id 를 잃지 않게 합쳐 적는다 · 몰에서 지우지 않는다(다음 회차가 이어 만든다)', async () => {
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [3, 4] })] } : { rows: [] }));
      const url = buildWooWebhookUrl(MALL);
      get.mockResolvedValueOnce({ status: 200, headers: {}, data: [
        { id: 3, topic: 'customer.created', delivery_url: url, status: 'active' },
        { id: 4, topic: 'customer.updated', delivery_url: url, status: 'active' },
      ] });
      let n = 0;
      request.mockImplementation(async () => (++n === 1 ? { status: 201, headers: {}, data: { id: 700 } } : { status: 429, headers: {}, data: {} }));
      await expect(ensureWooWebhooks(COMPANY, MALL)).rejects.toMatchObject({ code: 'rate_limited' });
      expect(methods()).toEqual(['POST', 'POST']);
      expect(idWrites()).toHaveLength(1);
      expect(JSON.parse(idWrites()[0][1][2])).toEqual({ woo_webhook_ids: [3, 4, 700] });
    });
    it('아무것도 만들지 못하고 실패하면 행을 쓰지 않는다', async () => {
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [3, 4] })] } : { rows: [] }));
      get.mockResolvedValueOnce({ status: 200, headers: {}, data: [] });
      request.mockResolvedValue({ status: 429, headers: {}, data: {} });
      await expect(ensureWooWebhooks(COMPANY, MALL)).rejects.toMatchObject({ code: 'rate_limited' });
      expect(idWrites()).toHaveLength(0);
      expect(methods()).toEqual(['POST']);
    });
    it('제거는 몰의 실제 목록에서 우리 웹훅을 찾는다(Codex R4) — 생성 응답이 유실돼 id 를 못 적은 웹훅도 지운다 · 남의 웹훅은 안 건드린다', async () => {
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({}, { status: 'revoked' })] } : { rows: [] }));   // 기록된 id 0
      get.mockResolvedValueOnce({ status: 200, headers: {}, data: [
        { id: 900, topic: 'order.created', delivery_url: buildWooWebhookUrl(MALL), status: 'active' },      // 응답 유실로 기록에 없는 우리 웹훅
        { id: 901, topic: 'order.created', delivery_url: 'https://other.example/hook', status: 'active' },   // 남의 웹훅
      ] });
      request.mockResolvedValue({ status: 200, headers: {}, data: {} });
      expect(await removeWooWebhooks(COMPANY, MALL)).toBe(1);
      expect(request.mock.calls.map((c: any[]) => c[0].url)).toEqual(['https://www.lensgogo.info/wp-json/wc/v3/webhooks/900?force=true']);
      const done = q.mock.calls.find((c: any[]) => String(c[0]).includes("- 'woo_webhook_ids' - 'woo_webhook_cleanup'"))!;
      expect(JSON.parse(done[1][2])).toEqual({});                       // 다 지웠다 = 기록·미완료 표시 비움
      expect(done[0]).toContain("AND status = 'revoked'");
    });
    it('끝까지 읽은 목록이 진실이다 — 기록에만 있고 몰에 없는 id 는 지우러 가지 않는다 · 못 지운 id 는 남기고 정리 미완료를 적는다', async () => {
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [5, 6, 7, 8] }, { status: 'revoked' })] } : { rows: [] }));
      const url = buildWooWebhookUrl(MALL);
      get.mockResolvedValueOnce({ status: 200, headers: {}, data: [5, 6, 7].map((id) => ({ id, topic: 'order.created', delivery_url: url, status: 'active' })) });   // 8 은 몰에 없다
      request.mockImplementation(async (cfg: any) => ({ status: String(cfg.url).includes('/6?') ? 404 : String(cfg.url).includes('/7?') ? 500 : 200, headers: {}, data: {} }));
      expect(await removeWooWebhooks(COMPANY, MALL)).toBe(1);
      expect(request.mock.calls.map((c: any[]) => c[0].url.match(/webhooks\/(\d+)/)![1])).toEqual(['5', '6', '7']);
      const done = q.mock.calls.find((c: any[]) => String(c[0]).includes("- 'woo_webhook_ids' - 'woo_webhook_cleanup'"))!;
      const patch = JSON.parse(done[1][2]);
      expect(patch.woo_webhook_ids).toEqual([7]);
      expect(Number.isFinite(Date.parse(patch.woo_webhook_cleanup))).toBe(true);
    });
    it('몰 목록을 못 읽으면: 기록의 id 로 지우고 정리 미완료를 남긴다(처음 남긴 시각은 유지) · 읽기 전용 키 몰은 목록을 읽지 않는다', async () => {
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [5], woo_webhook_cleanup: '2026-09-30T00:00:00.000Z' }, { status: 'revoked' })] } : { rows: [] }));
      get.mockResolvedValue({ status: 200, headers: {}, data: { code: 'rest_forbidden' } });   // 배열이 아닌 응답 = 모름
      request.mockResolvedValue({ status: 200, headers: {}, data: {} });
      expect(await removeWooWebhooks(COMPANY, MALL)).toBe(1);
      const done = q.mock.calls.find((c: any[]) => String(c[0]).includes("- 'woo_webhook_ids' - 'woo_webhook_cleanup'"))!;
      expect(JSON.parse(done[1][2])).toEqual({ woo_webhook_cleanup: '2026-09-30T00:00:00.000Z' });

      q.mockClear(); get.mockReset(); request.mockReset();
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [5], woo_key_permissions: 'read' }, { status: 'revoked' })] } : { rows: [] }));
      request.mockResolvedValue({ status: 200, headers: {}, data: {} });
      expect(await removeWooWebhooks(COMPANY, MALL)).toBe(1);
      expect(get).not.toHaveBeenCalled();
    });
    it('제거는 해제된 행에만 한다 — 그 사이 다시 연결된 몰이면 몰 서버를 부르지 않는다', async () => {
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [5, 6] })] } : { rows: [] }));
      expect(await removeWooWebhooks(COMPANY, MALL)).toBe(0);
      expect(get).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });
    it('해제는 행을 끊는 같은 문장에서 정리 미완료를 적는다(Codex R5) — 정리 전에 죽어도 주기 워커가 이어 간다 · 정리가 끝난 것이 확인될 때만 비운다', async () => {
      q.mockImplementation(async (sql: string) => (String(sql).includes('RETURNING id') ? { rows: [{ id: 'row-1' }] } : String(sql).includes('FOR UPDATE') ? { rows: [row()] } : { rows: [] }));
      expect(await disconnectWoo(COMPANY, MALL)).toBe(true);
      const call = q.mock.calls.find((c: any[]) => String(c[0]).includes("SET status = 'revoked'"))!;
      expect(call[0]).toContain("SET status = 'revoked', meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb, updated_at = NOW()");
      expect(call[0]).toContain("AND status <> 'revoked'");
      expect(Object.keys(JSON.parse(call[1][2]))).toEqual(['woo_webhook_cleanup']);
      expect(Number.isFinite(Date.parse(JSON.parse(call[1][2]).woo_webhook_cleanup))).toBe(true);
      // 키 없는 몰(지울 수단 없음) = 정리 끝 → 표시를 비운다 · 몰 서버를 부르지 않는다
      q.mockReset();
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_consumer_key: '', woo_consumer_secret: '', woo_webhook_cleanup: '2026-10-01T00:00:00.000Z' }, { status: 'revoked' })] } : { rows: [] }));
      expect(await removeWooWebhooks(COMPANY, MALL)).toBe(0);
      const done = q.mock.calls.find((c: any[]) => String(c[0]).includes("- 'woo_webhook_ids' - 'woo_webhook_cleanup'"))!;
      expect(JSON.parse(done[1][2])).toEqual({});
      expect(get).not.toHaveBeenCalled();
    });
    // 해제 라우트가 하는 일 그대로: 행 끊기(즉시) → 웹훅 제거(줄)
    const leave = async () => { const ok = await disconnectWoo(COMPANY, MALL); const removed = await removeWooWebhooks(COMPANY, MALL).catch(() => 0); return { ok, removed }; };
    const liveRow = (state: { meta: Record<string, any>; status: string }, log: string[]) => async (sql: string, params?: any[]) => {
      const s = String(sql);
      if (s.includes("SET status = 'revoked'")) {
        if (state.status === 'revoked') return { rows: [] };                         // 이미 끊긴 행 = 아무 일도 없다
        log.push('행 끊기'); state.status = 'revoked'; Object.assign(state.meta, JSON.parse(params![2])); return { rows: [{ id: 'row-1' }] };
      }
      if (s.includes('INSERT INTO company_integrations')) { log.push('되살리기'); state.status = 'pending'; delete state.meta.woo_webhook_cleanup; return { rows: [{ webhook_secret: 'a'.repeat(64) }] }; }
      if (s.includes("- 'woo_webhook_ids' - 'woo_webhook_cleanup'")) {
        if (state.status !== 'revoked') return { rows: [] };                         // 정리 결과는 해제된 행에만 적힌다
        log.push('정리 결과 기록'); delete state.meta.woo_webhook_ids; delete state.meta.woo_webhook_cleanup; Object.assign(state.meta, JSON.parse(params![2])); return { rows: [] };
      }
      if (s.includes('FROM company_integrations') && s.includes('SELECT id, company_id')) return { rows: [row(state.meta, { status: state.status })] };
      return { rows: [] };
    };
    const tick3 = async () => { for (let i = 0; i < 3; i++) await new Promise<void>((res) => setImmediate(res)); };

    it('해제의 권한 판정은 행을 잠근 같은 잠금 안에서 지금의 행으로 한다(Codex R7) — 조회와 끊기 사이에 다른 담당자가 되살린 연결을 끊지 않는다', async () => {
      // 중복 해제가 들어온 시점: 다른 담당자(분류코드 B)가 이미 되살려 놓은 행
      const revived = row({ store_code: 'B몰' }, { status: 'pending' });
      q.mockImplementation(async (sql: string) => (String(sql).includes('FOR UPDATE') ? { rows: [revived] } : String(sql).includes('RETURNING id') ? { rows: [{ id: 'row-1' }] } : { rows: [] }));
      class Denied extends Error {}
      const seen: any[] = [];
      await expect(disconnectWoo(COMPANY, MALL, (existing) => { seen.push(existing); if (existing.storeCode !== 'A몰') throw new Denied(); })).rejects.toBeInstanceOf(Denied);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ mallId: MALL, storeCode: 'B몰', status: 'pending' });
      const sqls = q.mock.calls.map((c: any[]) => String(c[0]));
      const at = (needle: string) => sqls.findIndex((s) => s.includes(needle));
      expect(at('pg_advisory_xact_lock(hashtext($1))')).toBeGreaterThan(at('BEGIN'));
      expect(at('FOR UPDATE')).toBeGreaterThan(at('pg_advisory_xact_lock'));
      expect(at("SET status = 'revoked'")).toBe(-1);                                 // 끊지 않았다
      expect(at('ROLLBACK')).toBeGreaterThan(at('FOR UPDATE'));
      // 자기 몰이면 끊는다 · 게이트는 잠금 안에서 불린다
      q.mockClear();
      expect(await disconnectWoo(COMPANY, MALL, () => undefined)).toBe(true);
      const order = q.mock.calls.map((c: any[]) => String(c[0]));
      expect(order.findIndex((s) => s.includes("SET status = 'revoked'"))).toBeGreaterThan(order.findIndex((s) => s.includes('FOR UPDATE')));
      expect(order.findIndex((s) => s.includes('COMMIT'))).toBeGreaterThan(order.findIndex((s) => s.includes("SET status = 'revoked'")));
      // 행이 없거나 이미 끊겨 있으면 게이트를 부르지 않고 false(끊지 않는다)
      for (const rows of [[], [row({}, { status: 'revoked' })]]) {
        q.mockReset();
        q.mockImplementation(async (sql: string) => (String(sql).includes('FOR UPDATE') ? { rows } : { rows: [] }));
        let called = false;
        expect(await disconnectWoo(COMPANY, MALL, () => { called = true; })).toBe(false);
        expect(called).toBe(false);
        expect(q.mock.calls.some((c: any[]) => String(c[0]).includes("SET status = 'revoked'"))).toBe(false);
      }
    });
    it('해제의 웹훅 정리가 도는 중에 온 재연결(저장)은 정리가 끝난 뒤에 되살린다(Codex R5 — 정리 도중 되살아난 몰의 웹훅을 지우지 않는다)', async () => {
      const state = { meta: { woo_webhook_ids: [5, 6] } as Record<string, any>, status: 'active' };
      const log: string[] = [];
      q.mockImplementation(liveRow(state, log));
      let releaseList!: (v: any) => void;
      get.mockReturnValueOnce(new Promise((res) => { releaseList = res; }));        // 정리의 목록 조회가 멈춰 있다
      request.mockImplementation(async (cfg: any) => { log.push(`${cfg.method} ${String(cfg.url).match(/webhooks\/(\d+)/)?.[1]}`); return { status: 200, headers: {}, data: {} }; });

      const leaving = leave();
      await tick3();
      expect(log).toEqual(['행 끊기']);                                             // 행 끊기는 기다리지 않는다
      const rejoining = saveWooCredentials(COMPANY, { siteUrl: 'https://www.lensgogo.info/', consumerKey: '', consumerSecret: '', consentMetaKey: '' });   // 그 사이 재연결
      await tick3();
      expect(log).toEqual(['행 끊기']);                                             // 정리가 안 끝났으니 되살리기도 아직
      releaseList({ status: 200, headers: {}, data: [5, 6].map((id) => ({ id, topic: 'order.created', delivery_url: buildWooWebhookUrl(MALL), status: 'active' })) });

      expect(await leaving).toEqual({ ok: true, removed: 2 });
      expect((await rejoining).mallId).toBe(MALL);
      expect(log).toEqual(['행 끊기', 'DELETE 5', 'DELETE 6', '정리 결과 기록', '되살리기']);
      expect(state.status).toBe('pending');
    });
    it('기다리던 중복 해제는 그 사이 되살아난 연결을 끊지도 지우지도 못한다(Codex R6 — 행 끊기는 요청 시점에만 · 제거는 해제된 행에만)', async () => {
      const state = { meta: { woo_webhook_ids: [5, 6] } as Record<string, any>, status: 'active' };
      const log: string[] = [];
      q.mockImplementation(liveRow(state, log));
      let releaseList!: (v: any) => void;
      get.mockReturnValueOnce(new Promise((res) => { releaseList = res; }));
      get.mockImplementation(async () => { log.push('목록 조회(두 번째 제거)'); return { status: 200, headers: {}, data: [] }; });
      request.mockImplementation(async (cfg: any) => { log.push(`${cfg.method} ${String(cfg.url).match(/webhooks\/(\d+)/)?.[1]}`); return { status: 200, headers: {}, data: {} }; });

      const first = leave();                                                        // 첫 해제 — 정리가 목록 조회에서 멈춤
      await tick3();
      const rejoining = saveWooCredentials(COMPANY, { siteUrl: 'https://www.lensgogo.info/', consumerKey: '', consumerSecret: '', consentMetaKey: '' });   // 다른 담당자의 재연결(줄에서 대기)
      await tick3();
      const duplicate = leave();                                                    // 중복 해제 — 행은 이미 끊겨 있다(아무 일도 없다) · 제거는 재연결 뒤에 선다
      await tick3();
      releaseList({ status: 200, headers: {}, data: [5, 6].map((id) => ({ id, topic: 'order.created', delivery_url: buildWooWebhookUrl(MALL), status: 'active' })) });

      expect(await first).toEqual({ ok: true, removed: 2 });
      await rejoining;
      expect(await duplicate).toEqual({ ok: false, removed: 0 });
      expect(log).toEqual(['행 끊기', 'DELETE 5', 'DELETE 6', '정리 결과 기록', '되살리기']);   // 되살린 뒤에는 끊기·삭제·목록 조회 0
      expect(state.status).toBe('pending');
    });
    it('저장은 저장이 쓸 몰의 줄에 선다 — 줄을 기다리는 사이 대상이 바뀌면 쓰지 않고 그 몰의 줄에 다시 선다', async () => {
      // 처음 판정 = 입력 주소 그대로(새 몰) · 잠금 안 판정 = 그 주소가 기존 몰의 증명 주소가 됨 → 기존 몰로 다시
      let resolves = 0;
      q.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("(meta->'woo_seen_hosts') ? $2")) { resolves++; return resolves === 1 ? { rows: [] } : { rows: [{ mall_id: MALL }] }; }
        if (s.includes('INSERT INTO company_integrations')) return { rows: [{ webhook_secret: 's'.repeat(64) }] };
        return { rows: [] };
      });
      const saved = await saveWooCredentials(COMPANY, { siteUrl: 'https://www.lensgogo.net/', consumerKey: '', consumerSecret: '', consentMetaKey: '' });
      expect(saved.mallId).toBe(MALL);
      const inserts = q.mock.calls.filter((c: any[]) => String(c[0]).includes('INSERT INTO company_integrations'));
      expect(inserts).toHaveLength(1);                                               // 어긋난 첫 시도는 쓰지 않았다
      expect(inserts[0][1][1]).toBe(MALL);
      expect(resolves).toBe(3);                                                      // 줄 고르기 1 · 어긋남 확인 1 · 다시 선 줄 안 1
      const client = readFileSync(resolve(SRC, 'utils/woocommerce-client.ts'), 'utf8');
      expect(client).toContain('const out = await runSerial(wooWebhookLine(companyId, mall), () => saveWooCredentialsInLine(companyId, input, typedMallId, mall));');
    });
    it('대상 확인은 언제나 한다(Codex R6) — 계속 어긋나면 한 번도 쓰지 않고 busy 로 끝낸다(선 줄과 쓰는 몰이 다른 채로 되살리지 않는다)', async () => {
      let resolves = 0;
      q.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("(meta->'woo_seen_hosts') ? $2")) { resolves++; return { rows: [{ mall_id: `moving-${resolves}.example` }] }; }   // 볼 때마다 대상이 바뀐다
        if (s.includes('INSERT INTO company_integrations')) return { rows: [{ webhook_secret: 's'.repeat(64) }] };
        return { rows: [] };
      });
      await expect(saveWooCredentials(COMPANY, { siteUrl: 'https://www.lensgogo.net/', consumerKey: '', consumerSecret: '', consentMetaKey: '' })).rejects.toMatchObject({ code: 'busy' });
      expect(q.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO company_integrations'))).toBe(false);
      expect(resolves).toBe(4);                                                      // 줄 고르기 1 + 줄 안 확인 3
      const route = readFileSync(resolve(SRC, 'routes/woocommerce.ts'), 'utf8');
      expect(route).toContain("res.status(upstream ? 502 : err.code === 'busy' ? 409 : 400)");
    });
    it('정리 미완료 대상 = 해제 상태 + 처음 남긴 지 7일 이내 · 주기 워커가 회차 끝에 이어서 정리한다(소스 계약)', async () => {
      expect(WOO_WEBHOOK_CLEANUP_DAYS).toBe(7);
      q.mockImplementation(async () => ({ rows: [{ company_id: COMPANY, mall_id: MALL }] }));
      const before = Date.now();
      expect(await listWooWebhookCleanupTargets()).toEqual([{ companyId: COMPANY, mallId: MALL }]);
      const call = q.mock.calls[0];
      expect(call[0]).toContain("WHERE provider = 'woocommerce' AND status = 'revoked' AND (meta->>'woo_webhook_cleanup') > $1");
      const cutoff = Date.parse(call[1][0]);
      expect(before - cutoff).toBeGreaterThanOrEqual(7 * 24 * 3600 * 1000 - 5);
      expect(before - cutoff).toBeLessThan(7 * 24 * 3600 * 1000 + 5000);
      const w = readFileSync(resolve(SRC, 'utils/woocommerce-sync-worker.ts'), 'utf8');
      const sweep = w.indexOf('for (const t of await listWooWebhookCleanupTargets().catch(() => [])) {');
      expect(sweep).toBeGreaterThan(w.indexOf('for (const row of targets.rows'));
      expect(w.slice(sweep, sweep + 300)).toContain('await removeWooWebhooks(t.companyId, t.mallId).catch(');
    });
  });
  it('해제된 행의 웹훅도 지운다 — 해제는 행을 먼저 끊고 웹훅을 지운다(해제된 행을 못 읽으면 0개를 지우고 끝난다)', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_webhook_ids: [5, 6] }, { status: 'revoked' })] } : { rows: [] }));
    get.mockResolvedValueOnce({ status: 200, headers: {}, data: [5, 6].map((id) => ({ id, topic: 'order.created', delivery_url: buildWooWebhookUrl(MALL), status: 'active' })) });
    request.mockResolvedValue({ status: 200, headers: {}, data: {} });
    expect(await removeWooWebhooks(COMPANY, MALL)).toBe(2);
    expect(request.mock.calls.map((c: any[]) => c[0].url)).toEqual([5, 6].map((id) => `https://www.lensgogo.info/wp-json/wc/v3/webhooks/${id}?force=true`));
  });
  it('주기 워커가 수집 성공 뒤 쓰기 권한 키 몰만 점검하고 그 실패는 수집 성공을 뒤집지 않는다(소스 계약)', () => {
    const w = readFileSync(resolve(SRC, 'utils/woocommerce-sync-worker.ts'), 'utf8');
    const ok = w.indexOf('await markSuccess(row.company_id, row.mall_id);');
    const check = w.indexOf("if (String(row.meta?.woo_key_permissions || '').includes('write')) {");
    const call = w.indexOf('const wh = await ensureWooWebhooks(row.company_id, row.mall_id);');
    expect(ok).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(ok);
    expect(call).toBeGreaterThan(check);
    expect(w.slice(call, call + 700)).toContain('웹훅 점검 실패(수집은 성공)');
  });
});

describe('W-4 이미 읽은 주문을 새 상태 규칙으로 한 번 다시 읽기', () => {
  const NOW = Date.parse('2026-10-01T10:00:00Z');
  const done = (over: Record<string, any> = {}) => ({
    stage: 'done', customers_page: 4747, orders_page: 310, orders_after: '2026-06-23T00:00:00',
    customers_imported: 94903, orders_imported: 6197, customers_no_phone: 19635, orders_no_phone: 12, failed: 3, truncated: false,
    requested: true, started_at: '2026-09-21T01:00:00.000Z', updated_at: '2026-09-21T05:00:00.000Z', done_at: '2026-09-21T05:00:00.000Z', ...over,
  });
  const savedStates = () => q.mock.calls.filter((c: any[]) => String(c[0]).includes("jsonb_build_object('woo_backfill'")).map((c: any[]) => JSON.parse(c[1][2]));

  it('판정(순수): 끝난 가져오기만 · 규칙 판이 낮을 때만 · 상한 닿음은 하루 한 번', () => {
    expect(WOO_ORDER_RULE_VERSION).toBe(2);
    expect(wooOrderRereadDue({ stage: 'done', order_rule: 1, started_at: '' }, 'rule', NOW)).toBe(true);
    expect(wooOrderRereadDue({ stage: 'done', order_rule: 2, started_at: '' }, 'rule', NOW)).toBe(false);
    expect(wooOrderRereadDue({ stage: 'orders', order_rule: 1, started_at: '' }, 'rule', NOW)).toBe(false);
    expect(wooOrderRereadDue({ stage: 'customers', order_rule: 1, started_at: '' }, 'rule', NOW)).toBe(false);
    expect(wooOrderRereadDue(null, 'rule', NOW)).toBe(false);
    const ago = (ms: number) => new Date(NOW - ms).toISOString();
    expect(wooOrderRereadDue({ stage: 'done', order_rule: 2, started_at: ago(WOO_REREAD_MIN_GAP_MS) }, 'truncated', NOW)).toBe(true);
    expect(wooOrderRereadDue({ stage: 'done', order_rule: 2, started_at: ago(WOO_REREAD_MIN_GAP_MS - 1) }, 'truncated', NOW)).toBe(false);
    expect(wooOrderRereadDue({ stage: 'orders', order_rule: 2, started_at: ago(WOO_REREAD_MIN_GAP_MS * 3) }, 'truncated', NOW)).toBe(false);
    expect(wooOrderRereadDue(null, 'truncated', NOW)).toBe(false);
  });
  it('옛 규칙으로 끝난 몰: 주문 단계만 1쪽부터 다시 줄 세운다 — 회원 집계 보존 · 판 올림 · 이어 가기 표시(requested)', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row({ woo_backfill: done({ requested: false }) })] } : { rows: [] }));
    expect(await startWooOrderReread(COMPANY, MALL, 'rule')).toBe(true);
    await wooBackfillIdle();
    const st = savedStates()[0];
    expect(st).toMatchObject({
      stage: 'orders', orders_page: 1, orders_imported: 0, orders_no_phone: 0, truncated: false, requested: true, order_rule: 2, done_at: null,
      customers_page: 4747, customers_imported: 94903, customers_no_phone: 19635,
    });
    expect(st.orders_after).not.toBe('2026-06-23T00:00:00');
    expect(Date.parse(st.started_at)).toBeGreaterThan(Date.parse('2026-09-21T01:00:00.000Z'));
  });
  it('다시 읽지 않는 경우: 이미 새 규칙 · 도는 중 · 가져온 적 없음 · 키 없음 → 쓰기 0', async () => {
    for (const meta of [
      { woo_backfill: done({ order_rule: 2 }) },
      { woo_backfill: done({ stage: 'orders', done_at: null }) },
      {},
      { woo_backfill: done(), woo_consumer_key: '', woo_consumer_secret: '' },
    ]) {
      q.mockReset();
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row(meta)] } : { rows: [] }));
      expect(await startWooOrderReread(COMPANY, MALL, 'rule'), JSON.stringify(meta).slice(0, 60)).toBe(false);
      expect(savedStates()).toHaveLength(0);
    }
    await wooBackfillIdle();
  });
  it('가져오기가 적는 판: 새 시작·회원 단계에서 이어 가기 = 지금 판 · 주문 단계 도중에서 이어 가기 = 옛 판 그대로(끝난 뒤 다시 읽힌다)', async () => {
    const run = async (meta: Record<string, any>) => {
      q.mockReset();
      q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row(meta)] } : { rows: [] }));
      get.mockReset();
      get.mockResolvedValue({ status: 200, headers: { 'x-wp-totalpages': '1' }, data: [] });
      await runWooBackfill(COMPANY, MALL);
      return savedStates()[0];
    };
    expect((await run({})).order_rule).toBe(2);
    expect((await run({ woo_backfill: done({ stage: 'customers', done_at: null, customers_page: 7 }) })).order_rule).toBe(2);
    expect((await run({ woo_backfill: done({ stage: 'orders', done_at: null, orders_page: 9 }) })).order_rule).toBe(1);
    expect((await run({ woo_backfill: done({ stage: 'orders', done_at: null, orders_page: 9, order_rule: 2 }) })).order_rule).toBe(2);
  });
  it('주기 워커: 미완료 가져오기 이어 가기 뒤 · 주기 수집 앞에서 판정하고 그 회차 주기 수집은 건너뛴다(소스 계약)', () => {
    const w = readFileSync(resolve(SRC, 'utils/woocommerce-sync-worker.ts'), 'utf8');
    const loop = w.slice(w.indexOf('for (const row of'));
    const cont = loop.indexOf("if (bf && bf.requested === true && bf.stage !== 'done')");
    const reread = loop.indexOf("if (await startWooOrderReread(row.company_id, row.mall_id, 'rule')) {");
    const sync = loop.indexOf('syncWooOrdersSince(');
    expect(cont).toBeGreaterThan(-1);
    expect(reread).toBeGreaterThan(cont);
    expect(sync).toBeGreaterThan(reread);
    expect(loop.slice(reread, sync)).toContain('continue;');
    expect(reread).toBeGreaterThan(loop.indexOf('isCdpEnabledForPlan('));
  });
});

describe('W-7 주기 수집 한 회차 상한', () => {
  it('상한에 닿으면 truncated 를 돌려준다(조용히 버리지 않는다) · 안 닿으면 false', async () => {
    q.mockImplementation(async (sql: string) => (String(sql).includes('SELECT') ? { rows: [row()] } : { rows: [] }));
    get.mockResolvedValue({ status: 200, headers: { 'x-wp-totalpages': '9999' }, data: [{ id: 1 }] });
    const r = await syncWooOrdersSince(COMPANY, MALL, new Date('2026-09-22T00:00:00Z'));
    expect(r.truncated).toBe(true);
    expect(r.pages).toBe(MAX_SYNC_ORDERS / PAGE_SIZE);
    get.mockReset();
    get.mockResolvedValue({ status: 200, headers: { 'x-wp-totalpages': '1' }, data: [] });
    expect((await syncWooOrdersSince(COMPANY, MALL, new Date('2026-09-22T00:00:00Z'))).truncated).toBe(false);
  });
  it('주기 워커: 닿았는데 주문 다시 읽기로 못 넘기면 커서를 전진시키지 않는다(Codex R1 — 남은 주문이 겹침 창 밖으로 밀려 사라진다) · 넘겼을 때만 전진(소스 계약)', () => {
    const w = readFileSync(resolve(SRC, 'utils/woocommerce-sync-worker.ts'), 'utf8');
    const loop = w.slice(w.indexOf('for (const row of'));
    const sync = loop.indexOf('const r = await syncWooOrdersSince(row.company_id, row.mall_id, since);');
    const keep = loop.indexOf("if (r.truncated && !(await startWooOrderReread(row.company_id, row.mall_id, 'truncated').catch(() => false))) {");
    const ok = loop.indexOf('await markSuccess(row.company_id, row.mall_id);');
    expect(sync).toBeGreaterThan(-1);
    expect(keep).toBeGreaterThan(sync);
    expect(ok).toBeGreaterThan(keep);
    const branch = loop.slice(keep, ok);
    expect(branch).toContain("await markFailure(row.company_id, row.mall_id, 'truncated', TRUNCATED_MESSAGE)");
    expect(branch).toContain('result.failed++;');
    expect(branch).toContain('continue;');
    // 커서 전진(성공 기록)은 여전히 한 곳
    expect((w.match(/await markSuccess\(/g) || []).length).toBe(1);
    // 사유 문장은 고객이 읽는 말(내부 낱말·모델명 0)
    expect(w).toContain("const TRUNCATED_MESSAGE = '주문이 한 번에 읽을 수 있는 양보다 많아 수집이 밀려 있습니다. 자동으로 이어서 읽습니다.';");
  });
});

describe('오류 형식', () => {
  it('WooApiError 는 코드로 구분된다', () => { expect(new WooApiError('redirect').code).toBe('redirect'); });
});
