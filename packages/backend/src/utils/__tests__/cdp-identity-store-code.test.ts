/**
 * cdp-identity-store-code.test.ts — 자사몰 적재의 분류코드 기록 (설계서 docs/2026-09-18-mall-integration-user-scope-design.md §2-4 · §3-3)
 *
 * ① 현재 동작 캡처: storeCode 를 안 주면 SQL 순서·결과가 지금과 같고 customer_stores 를 건드리지 않는다
 *    (호출처 12곳 중 10곳은 인자를 주지 않는다 · 단일몰·무분류 회사 동작 불변).
 * ② storeCode 를 주면 고객이 확정되는 모든 경로(신규 · 전화 매칭 · 기존 연결 조기 반환)에서 linkCustomerStore 를 1회 부른다.
 * ③ 분류 기록이 실패해도 식별 결과는 그대로 돌려준다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn() }));
vi.mock('../unified-customer-profile', () => ({ recomputeProfile: vi.fn(async () => undefined) }));
vi.mock('../cdp-identity-review', () => ({ recordIdentityReview: vi.fn(async () => undefined) }));
vi.mock('../customer-store-link', () => ({ linkCustomerStore: vi.fn(async () => true) }));
vi.mock('../mall-consent', () => ({ upsertStoreConsent: vi.fn(async () => true) }));

import { query } from '../../config/database';
import { linkCustomerStore } from '../customer-store-link';
import { upsertStoreConsent } from '../mall-consent';
import { identifyCustomer } from '../cdp-identity';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const PHONE = '01000000000'; // 형식만 유효한 도달 불가 번호
const q = query as unknown as ReturnType<typeof vi.fn>;
const link = linkCustomerStore as unknown as ReturnType<typeof vi.fn>;
const consent = upsertStoreConsent as unknown as ReturnType<typeof vi.fn>;

interface Scenario { linkedCustomerId?: string | null; hasLink?: boolean; phoneHolderId?: string | null }

function db(s: Scenario = {}) {
  q.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO customers')) return { rows: [{ id: 'cust-new', was_inserted: true }] };
    if (sql.includes('INSERT INTO cdp_identity_links')) return { rows: [{ id: 'link-new' }] };
    if (sql.includes('FROM cdp_identity_links')) return { rows: s.hasLink ? [{ id: 'link-1', customer_id: s.linkedCustomerId ?? null }] : [] };
    if (sql.includes('SELECT phone FROM customers')) return { rows: [{ phone: PHONE }] };
    if (sql.includes('FROM customers')) return { rows: s.phoneHolderId ? [{ id: s.phoneHolderId }] : [] };
    return { rows: [], rowCount: 0 };
  });
}

/** SQL 첫머리(동사 + 표)만 뽑아 순서를 고정한다 */
function heads(): string[] {
  return q.mock.calls.map(([sql]: [string]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const m = s.match(/^(SELECT|INSERT INTO|UPDATE)\b.*?\b(?:FROM|INTO|UPDATE)?\s*(cdp_identity_links|customers|cdp_events)/i);
    return m ? `${m[1].toUpperCase()} ${m[2]}` : s.slice(0, 40);
  });
}

beforeEach(() => {
  q.mockReset();
  link.mockReset();
  link.mockResolvedValue(true);
  consent.mockReset();
  consent.mockResolvedValue(true);
});

describe('identifyCustomer · 현재 동작 캡처(storeCode 생략)', () => {
  it('신규 고객: SQL 순서가 그대로이고 customer_stores 를 건드리지 않는다', async () => {
    db();
    const r = await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'iroirotokyo.net:9', phone: PHONE, name: '테스트' });
    expect(r).toEqual({ customerId: 'cust-new', linkId: 'link-new', wasCreated: true, wasMerged: false });
    expect(heads()).toEqual(['SELECT cdp_identity_links', 'SELECT customers', 'INSERT INTO customers', 'INSERT INTO cdp_identity_links']);
    expect(link).not.toHaveBeenCalled();
  });

  it('기존 연결 조기 반환: 결과가 그대로이고 customer_stores 를 건드리지 않는다', async () => {
    db({ hasLink: true, linkedCustomerId: 'cust-linked' });
    const r = await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'iroirotokyo.net:9', phone: PHONE });
    expect(r).toEqual({ customerId: 'cust-linked', linkId: 'link-1', wasCreated: false, wasMerged: false });
    expect(link).not.toHaveBeenCalled();
  });
});

describe('identifyCustomer · storeCode 전달', () => {
  it('신규 고객을 그 분류코드에 기록한다', async () => {
    db();
    await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'iroirotokyo.net:9', phone: PHONE, storeCode: 'IROIRO' });
    expect(link).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledWith(COMPANY, 'cust-new', 'IROIRO');
  });

  it('전화번호로 기존 고객에 합쳐져도 그 고객을 분류코드에 기록한다(두 몰 회원 = 고객 1행 + 소속 2행)', async () => {
    db({ phoneHolderId: 'cust-old' });
    await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'iroirotokyo.net:9', phone: PHONE, storeCode: 'IROIRO' });
    expect(link).toHaveBeenCalledWith(COMPANY, 'cust-old', 'IROIRO');
  });

  it('기존 연결 조기 반환 경로에서도 기록한다', async () => {
    db({ hasLink: true, linkedCustomerId: 'cust-linked' });
    await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'iroirotokyo.net:9', phone: PHONE, storeCode: 'IROIRO' });
    expect(link).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledWith(COMPANY, 'cust-linked', 'IROIRO');
  });

  it('고객·연결 SQL 은 storeCode 유무와 무관하게 같다', async () => {
    db();
    await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'iroirotokyo.net:9', phone: PHONE, storeCode: 'IROIRO' });
    expect(heads()).toEqual(['SELECT cdp_identity_links', 'SELECT customers', 'INSERT INTO customers', 'INSERT INTO cdp_identity_links']);
  });

  it('분류 기록이 실패해도 식별 결과는 그대로다', async () => {
    db();
    link.mockRejectedValueOnce(new Error('boom'));
    const r = await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'iroirotokyo.net:9', phone: PHONE, storeCode: 'IROIRO' });
    expect(r.customerId).toBe('cust-new');
  });
});

// ★2026-09-22 설계서 docs/2026-09-22-mall-consent-isolation-design.md §4-2 — H2: 한 몰의 동의가 다른 몰의 동의를 덮지 않는다.
//   실측: 고객 1행의 sms_opt_in 을 "나중에 들어온 몰"이 덮고 있었다(이에스페이먼트 2몰 이상 소속 3,729명).
describe('identifyCustomer · 몰 수신동의는 소속 행에 · 고객 행 동의는 동결(storeCode 있을 때만)', () => {
  const insertParams = () => q.mock.calls.find(([sql]: [string]) => String(sql).includes('INSERT INTO customers'))![1] as any[];
  const updateParams = () => q.mock.calls.find(([sql]: [string]) => /UPDATE customers SET\s+name/.test(String(sql)))![1] as any[];

  it('storeCode 없음(기존 호출처 전부): 고객 행에 동의를 그대로 쓴다 · 소속 행 동의는 건드리지 않는다', async () => {
    db();
    await identifyCustomer(COMPANY, { source: 'cafe24', externalId: 'm:9', phone: PHONE, smsOptIn: true });
    expect(insertParams()[10]).toBe(true);
    expect(consent).not.toHaveBeenCalled();
  });
  it('storeCode 있음 · 신규: 고객 행 동의 자리는 null(INSERT 기본 false · 기존 값 불변) · 그 몰 소속 행에 동의를 쓴다(소속 기록 뒤에)', async () => {
    db();
    await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'ilbonimo.com:9', phone: PHONE, smsOptIn: true, storeCode: '일본이모' });
    expect(insertParams()[10]).toBeNull();
    expect(consent).toHaveBeenCalledWith(COMPANY, 'cust-new', '일본이모', true, 'woocommerce');
    expect(link.mock.invocationCallOrder[0]).toBeLessThan(consent.mock.invocationCallOrder[0]);
  });
  it('storeCode 있음 · 기존 연결 · 두 번째 몰의 **동의**: 고객 행을 올리지 않는다(앞선 몰의 미동의를 덮지 않는다) · 그 몰 소속 행에만 true', async () => {
    db({ hasLink: true, linkedCustomerId: 'cust-linked' });
    await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'ilbonimo.com:9', phone: PHONE, smsOptIn: true, storeCode: '일본이모' });
    expect(updateParams()[8]).toBeNull();
    expect(consent).toHaveBeenCalledWith(COMPANY, 'cust-linked', '일본이모', true, 'woocommerce');
  });
  it('storeCode 있음 · **철회(false)는 고객 행에도 내린다** — 몰 동의 읽기가 켜지기 전·관리자·여정은 아직 고객 행을 읽는다(Codex R1 · 덜 보내는 방향)', async () => {
    db({ hasLink: true, linkedCustomerId: 'cust-linked' });
    await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'ilbonimo.com:9', phone: PHONE, smsOptIn: false, storeCode: '일본이모' });
    expect(updateParams()[8]).toBe(false);
    expect(consent).toHaveBeenCalledWith(COMPANY, 'cust-linked', '일본이모', false, 'woocommerce');
  });
  it('동의 값이 없으면(주문 등) 소속 행 동의를 건드리지 않는다 — 모름은 모름으로 둔다', async () => {
    db();
    await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'ilbonimo.com:9', phone: PHONE, storeCode: '일본이모' });
    expect(consent).not.toHaveBeenCalled();
  });
  it('몰 동의 쓰기 실패는 삼키지 않는다 — 철회가 조용히 사라지면 거부한 사람에게 계속 나간다(웹훅은 재처리 · 가져오기는 그 건만 failed)', async () => {
    db();
    consent.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'ilbonimo.com:9', phone: PHONE, smsOptIn: false, storeCode: '일본이모' })).rejects.toThrow('connection terminated');
  });
  it('분류 기록(소속 행) 실패는 종전대로 식별을 막지 않고, 그 뒤 몰 동의 쓰기도 시도한다', async () => {
    db();
    link.mockRejectedValueOnce(new Error('boom'));
    const r = await identifyCustomer(COMPANY, { source: 'woocommerce', externalId: 'ilbonimo.com:9', phone: PHONE, smsOptIn: true, storeCode: '일본이모' });
    expect(r.customerId).toBe('cust-new');
    expect(consent).toHaveBeenCalledTimes(1);
  });
});
