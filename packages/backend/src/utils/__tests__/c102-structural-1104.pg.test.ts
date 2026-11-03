// replaces: none
/**
 * C102 여정 · 자동마케팅 구조 결함 0 — 실 PostgreSQL(★ 2026-11-04 · 설계서 docs/2026-11-04-c102-structural-zero-design.md §4)
 *
 * G1 매장 원장 음수 금액 행(환불 · 반품) = 구매가 아니다(진입 커서 · 구매 있었나 · 상품 목록 · 성과 주문 · 같은 구매 그날 합계 · 요약 횟수 · 최근)
 *    · 요약 누계 = 순액(매장만 갈래 · 두 문 CT-D3).
 * G2 표식 없는 옛 결제(0610 전)가 배송 중으로 바뀌어도 결제 사실 그대로 · 뒤 취소 = 차감.
 * 기대값 = 손으로 계산한 숫자.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query, withTransaction } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';

vi.mock('../unified-customer-profile', () => ({ recomputeProfile: vi.fn(async () => undefined) }));
const recipients = vi.hoisted(() => ({ phones: [] as string[] }));
vi.mock('../recipient-conversion', () => ({ recipientPhonesOfCampaign: vi.fn(async () => recipients.phones) }));

import { syncOrder } from '../cdp-orders';
import { netPurchaseSql } from '../cdp-order-revenue';
import { selectPurchaseLedgerRowsForCursor } from '../journey-target-extractor';
import { lockCompanyPurchaseSummary, purchaseAfterSql, purchaseFactsSql } from '../two-door-purchase';
import { listObservedProductsByDoor } from '../journey-product';
import { PURCHASED_SINCE_ENTRY_ONE_SQL } from '../journey-goal-purchase';
import { campaignRecipientOrders, buildAutoMarketingRoi } from '../automarketing-roi';
import { applyLedgerIngestSummary } from '../customer-purchase-aggregates';
import { createCustomerUpsertBuilder } from '../customer-upsert';
import { runTwoDoorTransitionPass, resetTwoDoorTransitionState } from '../two-door-transition';

let seq = 0;
const phoneOf = () => `0100000${String(3100 + seq++).padStart(4, '0')}`;
const newCompany = async (): Promise<string> => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', { id });
  return id;
};
const sum = async (co: string, phone: string): Promise<any> =>
  (await query(
    `SELECT purchase_count AS cnt, total_purchase_amount::int AS total, recent_purchase_date::text AS d, recent_purchase_amount::int AS ramt
       FROM customers WHERE company_id = $1::uuid AND phone = $2`,
    [co, phone],
  )).rows[0];
const idOf = async (co: string, phone: string): Promise<string> =>
  (await query(`SELECT id FROM customers WHERE company_id = $1::uuid AND phone = $2`, [co, phone])).rows[0].id;
const mall = (co: string, phone: string, orderId: string, status: string, amount: number, paidAt: string, srcAt: string) =>
  syncOrder(co, { source: 'woocommerce', orderId, externalId: `w:${phone}`, phone, name: '몰 고객', status, totalAmount: amount, orderedAt: paidAt, paidAt, srcAt } as any);
const ledger = (co: string, phone: string, rows: Array<{ day: string; amount: number; code?: string }>) =>
  withTransaction(async (run) => {
    await lockCompanyPurchaseSummary(run, co);
    const cid = (await run(`SELECT id FROM customers WHERE company_id = $1::uuid AND phone = $2`, [co, phone])).rows[0].id;
    for (const r of rows) {
      await run(
        `INSERT INTO purchases (company_id, customer_id, customer_phone, purchase_date, total_amount, store_name, product_code, product_name)
         VALUES ($1::uuid, $2::uuid, $3, $4::timestamp, $5, '강남점', $6, $7)`,
        [co, cid, phone, `${r.day} 00:00:00`, r.amount, r.code ?? null, r.code ? `상품${r.code}` : null],
      );
    }
    await applyLedgerIngestSummary(run, co, [cid]);
  });
const upsert = (co: string, rows: Array<Record<string, any>>) =>
  withTransaction((run) => createCustomerUpsertBuilder({ source: 'sync', includeUploadedBy: false, skipUnchanged: true }).runBatch(run, co, rows));
const reachable = (co: string) => query(`UPDATE customers SET sms_opt_in = true, is_active = true WHERE company_id = $1::uuid`, [co]);
const kstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const FAR = new Date('2100-01-01T00:00:00Z');

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C98-DDL-2'));
  await pool.query(ledgerBlockSql('C99-DDL-1'));
  await pool.query(ledgerBlockSql('C99-DDL-2'));
}, 120_000);

describe('G1 매장 원장 음수 금액 행 = 구매 아님', () => {
  it('매장만 회사 요약: 10,000 구매 → 다음 날 −10,000 반품 = 횟수 1 · 최근 = 구매 날 · 금액 10,000 · 누계 순액 0', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '고객' }]);
    await ledger(co, p, [{ day: '2026-10-01', amount: 10000 }]);
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 10000, d: '2026-10-01', ramt: 10000 });
    await ledger(co, p, [{ day: '2026-10-02', amount: -10000 }]);
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 0, d: '2026-10-01', ramt: 10000 });
  });

  it('두 문 회사 요약(CT-D3): 몰 30,000 + 매장 5,000 + 매장 −5,000 = 횟수 2 · 누계 30,000 · 최근 = 구매 날(반품 날 아님)', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'G1-1', 'paid', 30000, '2026-10-05T03:00:00Z', '2026-10-05T03:00:00Z');
    await ledger(co, p, [{ day: '2026-10-06', amount: 5000 }, { day: '2026-10-09', amount: -5000 }]);
    expect(await sum(co, p)).toMatchObject({ cnt: 2, total: 30000, d: '2026-10-06', ramt: 5000 });
  });

  it('같은 구매(CT-D1) 그날 합계 = 구매 행만: 몰 30,000 = 매장 10,000 + 20,000(같은 날 −5,000 반품 줄 있음) → 같은 구매 한 번', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'G1-2', 'paid', 30000, '2026-10-10T03:00:00Z', '2026-10-10T03:00:00Z');
    await ledger(co, p, [{ day: '2026-10-10', amount: 10000 }, { day: '2026-10-10', amount: 20000 }, { day: '2026-10-10', amount: -5000 }]);
    const facts = (await query(`SELECT door FROM (${purchaseFactsSql({ companyRef: '$1::uuid' })}) f`, [co])).rows.map((r) => r.door);
    expect(facts).toEqual(['mall']);
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 25000 });   // 사실 30,000 + 반품 −5,000 = 순액
  });

  it('진입 커서 · 구매 있었나 · 상품 목록 · 성과 주문 = 반품 행을 구매로 보지 않는다', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '고객' }]);
    const d1 = kstDay(-1);
    await ledger(co, p, [{ day: d1, amount: -9000, code: 'R9' }]);
    await reachable(co);
    const cid = await idOf(co, p);
    const rows = await selectPurchaseLedgerRowsForCursor(co, {}, { at: '2000-01-01T00:00:00Z', rowId: null }, FAR, 100000, 100);
    expect(rows).toHaveLength(0);
    const after = await query(`SELECT ${purchaseAfterSql('$2::uuid', '$1::uuid', '$3::timestamptz')} AS hit`, [co, cid, '2026-01-01T00:00:00Z']);
    expect(after.rows[0].hit).toBe(false);
    expect((await listObservedProductsByDoor(co)).ledger).toBeNull();
    recipients.phones = [p];
    const camp = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: camp, company_id: co, status: 'completed', sent_at: new Date(Date.now() - 2 * 86_400_000) });
    const orders = await campaignRecipientOrders(co, camp);
    expect(orders!.size).toBe(0);
  });

  it('구매 행 = 금액 없는 행 · 0원 행은 그대로 구매(커서 2행)', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '고객' }]);
    const d1 = kstDay(-1);
    await ledger(co, p, [{ day: d1, amount: 0 }]);
    await query(`INSERT INTO purchases (company_id, customer_id, customer_phone, purchase_date, total_amount) VALUES ($1::uuid, $2::uuid, $3, $4::timestamp, NULL)`,
      [co, await idOf(co, p), p, `${d1} 00:00:00`]);
    await reachable(co);
    const rows = await selectPurchaseLedgerRowsForCursor(co, {}, { at: '2000-01-01T00:00:00Z', rowId: null }, FAR, 100000, 100);
    expect(rows).toHaveLength(2);
  });
});

describe('G2 표식 없는 옛 결제 → 배송 중 = 결제 사실 그대로 · 뒤 취소 = 차감', () => {
  it('몰만 회사: 결제 → (옛 행처럼 표식 지움) → 배송 중 = 표식 굳힘 · 사실 1 · 요약 그대로 → 취소 = 횟수 0 · 누계 0', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'L-1', 'paid', 12000, '2026-06-01T03:00:00Z', '2026-06-01T03:00:00Z');
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 12000 });
    await query(`UPDATE cdp_events SET properties = properties - 'revenue_applied' WHERE company_id = $1::uuid AND event_name = 'purchase'`, [co]);   // 0610 전 행 꼴
    await mall(co, p, 'L-1', 'shipping', 12000, '2026-06-01T03:00:00Z', '2026-06-02T03:00:00Z');
    const ev = (await query(`SELECT properties->>'status' AS st, properties->'revenue_applied' AS ra, ${netPurchaseSql('e')} AS net FROM cdp_events e WHERE e.company_id = $1::uuid AND e.event_name = 'purchase'`, [co])).rows[0];
    expect(ev).toMatchObject({ st: 'shipping', ra: true, net: true });
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 12000 });
    await mall(co, p, 'L-1', 'cancelled', 12000, '2026-06-01T03:00:00Z', '2026-06-03T03:00:00Z');
    expect(await sum(co, p)).toMatchObject({ cnt: 0, total: 0 });
  });

  it('결제 전 옛 행(표식 없음 · 결제 아님)은 표식을 받지 않는다', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'L-2', 'paid', 5000, '2026-06-01T03:00:00Z', '2026-06-01T03:00:00Z');
    await query(`UPDATE cdp_events SET properties = (properties - 'revenue_applied') || '{"status":"pending"}'::jsonb WHERE company_id = $1::uuid AND event_name = 'purchase'`, [co]);
    await mall(co, p, 'L-2', 'shipping', 5000, '2026-06-01T03:00:00Z', '2026-06-02T03:00:00Z');
    const ev = (await query(`SELECT properties ? 'revenue_applied' AS has FROM cdp_events WHERE company_id = $1::uuid AND event_name = 'purchase'`, [co])).rows[0];
    expect(ev.has).toBe(false);
  });
});

describe('G4 성과 응답 = 들어온 문(발송 0 이어도)', () => {
  it('매장만 회사 · 자동마케팅 발송 0 = hasCdpData 참 · purchaseDoors { mall: false, ledger: true }', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '고객' }]);
    await ledger(co, p, [{ day: kstDay(-2), amount: 4000 }]);
    const roi = await buildAutoMarketingRoi(co, 30);
    expect(roi).toMatchObject({ campaigns: 0, hasCdpData: true, purchaseDoors: { mall: false, ledger: true } });
    const none = await buildAutoMarketingRoi(await newCompany(), 30);
    expect(none).toMatchObject({ campaigns: 0, hasCdpData: false, purchaseDoors: { mall: false, ledger: false } });
  });
});

describe('Codex 1R — 옛 계산(반품을 구매로 셈)이 남긴 요약 = 원본 값으로 굳히지 않는다', () => {
  const oldStyle = (co: string, p: string, d: string) =>
    query(`UPDATE customers SET purchase_count = 2, total_purchase_amount = 0, recent_purchase_date = $3::date, recent_purchase_amount = -10000
            WHERE company_id = $1::uuid AND phone = $2`, [co, p, d]);

  it('매장만 → 두 문 전환: 반품 날(옛 칸 최근일)을 recent(legacy) 로 옮기지 않는다 · 최근일 = 구매 날', async () => {
    const co = await newCompany();
    const a = phoneOf();
    await upsert(co, [{ phone: a, name: 'A' }]);
    await ledger(co, a, [{ day: '2026-09-01', amount: 10000 }, { day: '2026-09-05', amount: -10000 }]);
    await oldStyle(co, a, '2026-09-05');
    const b = phoneOf();
    await mall(co, b, 'C1-1', 'paid', 7000, '2026-10-01T03:00:00Z', '2026-10-01T03:00:00Z');   // 회사 = 두 문
    resetTwoDoorTransitionState();
    await runTwoDoorTransitionPass();
    const s = await sum(co, a);
    expect(s).toMatchObject({ cnt: 1, total: 0, d: '2026-09-01', ramt: 10000 });
    const src = (await query(`SELECT summary_source FROM customers WHERE company_id = $1::uuid AND phone = $2`, [co, a])).rows[0].summary_source;
    expect(src?.recent).toBeUndefined();
  });
});

describe('구조체크 2회차 — G6 미래 날짜 원장 행 · G7 고객보다 먼저 온 매장 구매', () => {
  it('G6 미래 날짜 행 = 그 날까지 구매 아님(이 시각 뒤에 샀나 · 지난 N일 · 사실 · 요약)', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '고객' }]);
    await ledger(co, p, [{ day: '2026-09-01', amount: 3000 }, { day: kstDay(30), amount: 9000 }]);
    const cid = await idOf(co, p);
    const after = await query(`SELECT ${purchaseAfterSql('$2::uuid', '$1::uuid', '$3::timestamptz')} AS hit`, [co, cid, new Date().toISOString()]);
    expect(after.rows[0].hit).toBe(false);
    const facts = (await query(`SELECT kst_day::text AS d FROM (${purchaseFactsSql({ companyRef: '$1::uuid' })}) f`, [co])).rows.map((r) => r.d);
    expect(facts).toEqual(['2026-09-01']);
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 3000, d: '2026-09-01', ramt: 3000 });   // 누계도 미래 행 뺌(Codex 4R)
  });

  it('G7 고객 없이 먼저 온 원장 행 = 다음 원장 적재가 같은 번호 고객에 잇고 도착 시각 = 지금 · 요약에 든다', async () => {
    const co = await newCompany();
    const other = phoneOf();
    await upsert(co, [{ phone: other, name: '기존' }]);
    const b = phoneOf();
    const d1 = kstDay(-1);
    await query(`INSERT INTO purchases (company_id, customer_id, customer_phone, purchase_date, total_amount, store_name, created_at)
                 VALUES ($1::uuid, NULL, $2, $3::timestamp, 5000, '강남점', NOW() - INTERVAL '2 hours')`, [co, b, `${d1} 00:00:00`]);
    await upsert(co, [{ phone: b, name: '새 고객' }]);   // 고객이 뒤에 온다
    await ledger(co, other, [{ day: d1, amount: 1000 }]);   // 같은 회사 다음 원장 적재
    const row = (await query(`SELECT customer_id, created_at > NOW() - INTERVAL '1 minute' AS fresh FROM purchases WHERE company_id = $1::uuid AND customer_phone = $2`, [co, b])).rows[0];
    expect(row.customer_id).toBe(await idOf(co, b));
    expect(row.fresh).toBe(true);
    expect(await sum(co, b)).toMatchObject({ cnt: 1, total: 5000, d: d1 });
    await reachable(co);
    const rows = await selectPurchaseLedgerRowsForCursor(co, {}, { at: '2000-01-01T00:00:00Z', rowId: null }, FAR, 100000, 100);
    expect(rows.map((r: any) => r.customerId).filter((x: string) => x === row.customer_id)).toHaveLength(1);
  });
});

describe('Codex 4R — 미래 최근일 · 미래 원본 최근일 · 고객 잇기와 가입 묶음', () => {
  const goal = (co: string, cid: string, enteredAt: string, signup: boolean) =>
    query(PURCHASED_SINCE_ENTRY_ONE_SQL, [co, cid, enteredAt, signup]).then((r) => r.rows[0].hit);

  it('요약 최근일이 미래(옛 계산 · 원본 오타) = 구매 목표 「샀음」이 아니다', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '고객' }]);
    const cid = await idOf(co, p);
    await query(`UPDATE customers SET recent_purchase_date = $2::date WHERE id = $1::uuid`, [cid, kstDay(20)]);
    expect(await goal(co, cid, new Date().toISOString(), false)).toBe(false);
    await query(`UPDATE customers SET recent_purchase_date = $2::date WHERE id = $1::uuid`, [cid, kstDay(0)]);
    expect(await goal(co, cid, new Date(Date.now() - 3 * 86_400_000).toISOString(), false)).toBe(true);
  });

  it('두 문 전환 첫 CT-D3: 미래 칸 최근일을 recent(legacy)로 옮기지 않는다', async () => {
    const co = await newCompany();
    const a = phoneOf();
    await upsert(co, [{ phone: a, name: 'A' }]);
    await ledger(co, a, [{ day: '2026-09-01', amount: 4000 }]);
    await query(`UPDATE customers SET recent_purchase_date = $3::date WHERE company_id = $1::uuid AND phone = $2`, [co, a, kstDay(40)]);
    const b = phoneOf();
    await mall(co, b, 'F4-1', 'paid', 7000, '2026-10-01T03:00:00Z', '2026-10-01T03:00:00Z');
    resetTwoDoorTransitionState();
    await runTwoDoorTransitionPass();
    expect(await sum(co, a)).toMatchObject({ cnt: 1, d: '2026-09-01' });
    const src = (await query(`SELECT summary_source FROM customers WHERE company_id = $1::uuid AND phone = $2`, [co, a])).rows[0].summary_source;
    expect(src?.recent).toBeUndefined();
  });

  it('고객 잇기(G7)로 도착 시각이 바뀐 오래된 구매 = 가입 묶음 구매가 아니다 · 가입한 날 구매 = 맞다', async () => {
    const co = await newCompany();
    const other = phoneOf();
    await upsert(co, [{ phone: other, name: '기존' }]);
    const b = phoneOf();
    await query(`INSERT INTO purchases (company_id, customer_id, customer_phone, purchase_date, total_amount, created_at)
                 VALUES ($1::uuid, NULL, $2, $3::timestamp, 8000, NOW() - INTERVAL '2 hours')`, [co, b, `${kstDay(-30)} 00:00:00`]);
    await upsert(co, [{ phone: b, name: '새 고객' }]);
    await ledger(co, other, [{ day: kstDay(-1), amount: 1000 }]);
    const cid = await idOf(co, b);
    expect((await query(`SELECT customer_id FROM purchases WHERE company_id = $1::uuid AND customer_phone = $2`, [co, b])).rows[0].customer_id).toBe(cid);
    const enteredAt = new Date(Date.now() - 60_000).toISOString();
    expect(await goal(co, cid, enteredAt, true)).toBe(false);
    await query(`INSERT INTO purchases (company_id, customer_id, customer_phone, purchase_date, total_amount) VALUES ($1::uuid, $2::uuid, $3, $4::timestamp, 2000)`,
      [co, cid, b, `${kstDay(0)} 00:00:00`]);
    expect(await goal(co, cid, enteredAt, true)).toBe(true);
  });
});

describe('구조체크 3회차 — G9 몰 결제 시각이 미래', () => {
  it('신규 · 승격 · 요약 최근일 모두 지금으로(사건 기록 경로와 같은 규칙)', async () => {
    const co = await newCompany();
    const p = phoneOf();
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    await mall(co, p, 'G9-1', 'pending', 6000, future, new Date().toISOString());   // 결제 전 = order_placed
    await mall(co, p, 'G9-1', 'paid', 6000, future, new Date(Date.now() + 1000).toISOString());   // 승격
    const ev = (await query(`SELECT occurred_at <= NOW() + INTERVAL '5 minutes' AS ok FROM cdp_events WHERE company_id = $1::uuid AND event_name = 'purchase'`, [co])).rows[0];
    expect(ev.ok).toBe(true);
    expect((await sum(co, p)).d <= kstDay(0)).toBe(true);
    const q = phoneOf();
    await mall(co, q, 'G9-2', 'paid', 4000, future, new Date().toISOString());   // 처음부터 결제
    expect((await sum(co, q)).d <= kstDay(0)).toBe(true);
  });
});
