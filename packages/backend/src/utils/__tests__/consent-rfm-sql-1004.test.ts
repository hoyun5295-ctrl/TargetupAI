/**
 * 2026-10-04 싱크·자사몰 전수점검 — 바꾼 SQL 을 실제 SQL 엔진(pg-mem)으로 실행해 결과 행을 단정한다.
 *
 *   S15  수신동의 값을 못 알아본 신규 행 = 미동의 — buildSmsOptInUnknownDefault 를 기본 동의 백필보다 먼저 돌리면
 *        못 알아본 신규만 false · 값 없는 신규는 true · 기존 행은 그대로.
 *   O3   syncOrder 매출 반영: 옛 주문이 나중에 처리돼도 최근 구매 금액·마지막 구매일은 더 새 주문 값을 지킨다.
 *   I2   withdrawMemberConsent: 그 몰 회원과 연결된 고객만 수신동의를 내린다(다른 몰 · 다른 회사 · 미연결 무영향).
 *
 * 상관 하위 조회가 있는 SQL(싱크 수신거부 해제)은 pg-mem 이 못 풀어 여기서 다루지 않는다(reference_pg_mem_correlated_subquery_limit).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';

const holder: { client: any } = { client: null };
const captured: Array<{ sql: string; params: any[] }> = [];
let captureOnly = false;
vi.mock('../../config/database', () => ({
  query: async (sql: string, params: any[] = []) => {
    if (captureOnly) {
      captured.push({ sql, params });
      return { rows: /RETURNING id/.test(sql) ? [{ id: 'ev-1' }] : [], rowCount: 1 };
    }
    return holder.client.query(sql, params);
  },
}));
vi.mock('../cdp-identity', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    identifyCustomer: vi.fn(async () => ({ customerId: CUST, linkId: 'l', wasCreated: false, wasMerged: false })),
  };
});
vi.mock('../cdp-events', () => ({
  trackEvent: vi.fn(async () => ({ eventId: 'ev-new', identityLinkId: 'l', customerId: CUST })),
  validateProperties: () => ({ ok: true }),
}));

import { buildSmsOptInBackfill, buildSmsOptInUnknownDefault } from '../customer-upsert';
import { syncOrder } from '../cdp-orders';
import { withdrawMemberConsent } from '../cdp-identity';

const CO = '00000000-0000-0000-0000-0000000000c1';
const CO2 = '00000000-0000-0000-0000-0000000000c2';
const CUST = '00000000-0000-0000-0000-00000000a001';

function freshDb() {
  const db = newDb();
  db.public.none(`
    CREATE TABLE customers (
      id uuid PRIMARY KEY, company_id uuid, phone text, sms_opt_in boolean,
      total_purchase_amount numeric, total_purchase numeric, purchase_count integer,
      recent_purchase_date date, recent_purchase_amount numeric, last_purchase_date varchar(20),
      avg_order_value numeric, updated_at timestamp
    );
    CREATE TABLE cdp_identity_links (company_id uuid, source text, external_id text, customer_id uuid);
  `);
  // pg-mem 에는 GREATEST 가 없다 — PostgreSQL 과 같은 뜻(NULL 은 건너뛰고 큰 값)으로 날짜용만 등록한다(시험 전용)
  db.public.registerFunction({
    name: 'greatest',
    args: ['date' as any, 'date' as any],
    returns: 'date' as any,
    implementation: (a: any, b: any) => (a == null ? b : b == null ? a : (a > b ? a : b)),
  });
  db.public.registerFunction({
    name: 'to_char',
    args: ['date' as any, 'text' as any],
    returns: 'text' as any,
    implementation: (d: any, fmt: string) => {
      if (fmt !== 'YYYY-MM-DD') throw new Error(`시험용 to_char 는 YYYY-MM-DD 만: ${fmt}`);
      const x = d instanceof Date ? d : new Date(d);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
    },
  });
  const { Client } = db.adapters.createPg();
  const client = new Client();
  holder.client = client;
  return db;
}

beforeEach(() => { captured.length = 0; captureOnly = false; });

describe('S15 못 알아본 수신동의 = 신규 미동의 (기본 동의 백필보다 먼저)', () => {
  it('못 알아본 신규 false · 값 없는 신규 true · 기존 거부·동의 그대로', async () => {
    const db = freshDb();
    db.public.none(`
      INSERT INTO customers (id, company_id, phone, sms_opt_in) VALUES
        ('00000000-0000-0000-0000-000000000001', '${CO}', '01000000001', NULL),
        ('00000000-0000-0000-0000-000000000002', '${CO}', '01000000002', NULL),
        ('00000000-0000-0000-0000-000000000003', '${CO}', '01000000003', false),
        ('00000000-0000-0000-0000-000000000004', '${CO}', '01000000004', true);
    `);
    const unknown = buildSmsOptInUnknownDefault(CO, ['01000000001', '01000000003', '01000000004']);
    await holder.client.query(unknown.sql, unknown.values);
    const backfill = buildSmsOptInBackfill(CO, ['01000000001', '01000000002', '01000000003', '01000000004']);
    await holder.client.query(backfill.sql, backfill.values);
    const rows = db.public.many(`SELECT phone, sms_opt_in FROM customers ORDER BY phone`);
    expect(rows.map((r: any) => r.sms_opt_in)).toEqual([false, true, false, true]);
  });

  it('순서가 뒤집히면(백필 먼저) 못 알아본 신규가 동의로 들어간다 — 순서가 계약이다', async () => {
    const db = freshDb();
    db.public.none(`INSERT INTO customers (id, company_id, phone, sms_opt_in) VALUES ('00000000-0000-0000-0000-000000000001', '${CO}', '01000000001', NULL);`);
    const backfill = buildSmsOptInBackfill(CO, ['01000000001']);
    await holder.client.query(backfill.sql, backfill.values);
    const unknown = buildSmsOptInUnknownDefault(CO, ['01000000001']);
    await holder.client.query(unknown.sql, unknown.values);
    expect(db.public.one(`SELECT sms_opt_in FROM customers`).sms_opt_in).toBe(true);
  });
});

describe('O3 매출 반영 — 옛 주문이 늦게 와도 최근 값은 지킨다', () => {
  async function rfmUpdateFor(orderedAt: string, amount: number) {
    captured.length = 0;
    captureOnly = true;
    await syncOrder(CO, { source: 'cafe24', orderId: `O-${orderedAt}`, externalId: 'm1', status: 'PAID', totalAmount: amount, orderedAt });
    captureOnly = false;
    const u = captured.find((c) => /UPDATE customers SET\s+total_purchase_amount/.test(c.sql));
    expect(u, '매출 반영 UPDATE 를 못 찾음(상태 정규화가 빠졌으면 PAID 가 반영되지 않는다)').toBeTruthy();
    return u!;
  }

  it('옛 주문(09-01)은 횟수·합계만 · 최근 금액·마지막 구매일은 10-03 그대로 · 새 주문(10-05)은 전부 갱신', async () => {
    const db = freshDb();
    db.public.none(`
      INSERT INTO customers (id, company_id, total_purchase_amount, total_purchase, purchase_count, recent_purchase_date, recent_purchase_amount, last_purchase_date)
      VALUES ('${CUST}', '${CO}', 5000, 5000, 1, '2026-10-03', 5000, '2026-10-03');
    `);
    const old = await rfmUpdateFor('2026-09-01T10:00:00+09:00', 1000);
    await holder.client.query(old.sql, old.params);
    let r: any = db.public.one(`SELECT * FROM customers`);
    expect(Number(r.purchase_count)).toBe(2);
    expect(Number(r.total_purchase_amount)).toBe(6000);
    expect(String(r.recent_purchase_date instanceof Date ? r.recent_purchase_date.toISOString().slice(0, 10) : r.recent_purchase_date)).toBe('2026-10-03');
    expect(Number(r.recent_purchase_amount)).toBe(5000);
    expect(r.last_purchase_date).toBe('2026-10-03');

    const newer = await rfmUpdateFor('2026-10-05T10:00:00+09:00', 3000);
    await holder.client.query(newer.sql, newer.params);
    r = db.public.one(`SELECT * FROM customers`);
    expect(Number(r.recent_purchase_amount)).toBe(3000);
    expect(r.last_purchase_date).toBe('2026-10-05');
  });
});

describe('I2 탈퇴 = 연결된 고객만 수신동의 철회', () => {
  it('그 몰(source)·그 회원·그 회사만 false', async () => {
    const db = freshDb();
    db.public.none(`
      INSERT INTO customers (id, company_id, sms_opt_in) VALUES
        ('00000000-0000-0000-0000-00000000b001', '${CO}', true),
        ('00000000-0000-0000-0000-00000000b002', '${CO}', true),
        ('00000000-0000-0000-0000-00000000b003', '${CO2}', true);
      INSERT INTO cdp_identity_links (company_id, source, external_id, customer_id) VALUES
        ('${CO}', 'imweb', 'u-1', '00000000-0000-0000-0000-00000000b001'),
        ('${CO}', 'cafe24', 'u-1', '00000000-0000-0000-0000-00000000b002'),
        ('${CO2}', 'imweb', 'u-1', '00000000-0000-0000-0000-00000000b003');
    `);
    const n = await withdrawMemberConsent(CO, 'imweb', 'u-1');
    expect(n).toBe(1);
    const rows = db.public.many(`SELECT id, sms_opt_in FROM customers ORDER BY id`);
    expect(rows.map((r: any) => r.sms_opt_in)).toEqual([false, true, true]);
    expect(await withdrawMemberConsent(CO, 'imweb', 'nobody')).toBe(0);
  });
});
