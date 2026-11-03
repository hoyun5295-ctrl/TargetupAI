// replaces: none
/**
 * 두 문 회사(자사몰 + 매장 싱크) 구매 처방 — 실 PostgreSQL(★ 2026-11-04 C99 · 설계서 docs/2026-11-03-two-door-purchase-design.md §7)
 *
 * 주장이 SQL 에 기댄다: 같은 구매 판정(CT-D1 · KST 날짜 · 행 금액 또는 그날 합계) · 두 문 사실(CT-D2) · 요약 칸 재계산(CT-D3 · UPDATE … FROM
 *   LEFT JOIN · 바뀐 행만) · 회사 갈래(two_door_since 한 번만) · 원본 요약 값 칸(summary_source jsonb).
 * 기대값 = 손으로 계산한 직원 시트 19(설계서 §8)와 같은 숫자.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query, withTransaction } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';

vi.mock('../unified-customer-profile', () => ({ recomputeProfile: vi.fn(async () => undefined) }));
// 실수신자 번호(QTmsg 발송 결과)는 이 시험 밖 — 귀속 SQL 만 실 PG 로 돈다
const recipients = vi.hoisted(() => ({ phones: [] as string[] }));
vi.mock('../recipient-conversion', () => ({ recipientPhonesOfCampaign: vi.fn(async () => recipients.phones) }));

import { syncOrder } from '../cdp-orders';
import { selectCdpEventRowsForCursor, selectPurchaseLedgerRowsForCursor, selectLastPriorPurchase, buildJourneyTargetQuery } from '../journey-target-extractor';
import { crossDoorEntryOwnedSql, purchaseAfterSql, purchaseWithinDaysSql } from '../two-door-purchase';
import { PURCHASED_SINCE_ENTRY_ONE_SQL } from '../journey-goal-purchase';
import { PRODUCT_REPURCHASE_SINCE_ENTRY_SQL, listObservedProductsByDoor, loadPurchaseRhythm, loadProductCycles } from '../journey-product';
import { campaignRecipientOrders } from '../automarketing-roi';
import { buildCampaignAttribution } from '../campaign-response-attribution';
import { joinedAtEvidence } from '../customer-joined-at';
import { purchaseHistorySourceSql } from '../purchase-history-source';
import { getPurchaseDoorStatus } from '../journey-purchase-ledger';
import { createCustomerUpsertBuilder } from '../customer-upsert';
import { applyLedgerIngestSummary } from '../customer-purchase-aggregates';
import { lockCompanyPurchaseSummary, resolvePurchaseSummaryBranch } from '../two-door-purchase';
import { runTwoDoorTransitionPass, resetTwoDoorTransitionState } from '../two-door-transition';

let seq = 0;
const phoneOf = () => `0100000${String(2100 + seq++).padStart(4, '0')}`;
const newCompany = async (): Promise<string> => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', { id });
  return id;
};
const sum = async (co: string, phone: string): Promise<any> =>
  (await query(
    `SELECT purchase_count AS cnt, total_purchase_amount::int AS total, total_purchase::int AS tp, recent_purchase_date::text AS d,
            recent_purchase_amount::int AS ramt, recent_purchase_store AS store, last_purchase_date AS last, summary_source AS src
       FROM customers WHERE company_id = $1::uuid AND phone = $2`,
    [co, phone],
  )).rows[0];
const idOf = async (co: string, phone: string): Promise<string> =>
  (await query(`SELECT id FROM customers WHERE company_id = $1::uuid AND phone = $2`, [co, phone])).rows[0].id;

/** 자사몰 주문 = 주문 CT 그대로(회사 잠금 · 갈래 · 증분 또는 CT-D3) */
const mall = (co: string, phone: string, orderId: string, status: string, amount: number, paidAt: string, srcAt: string) =>
  syncOrder(co, { source: 'woocommerce', orderId, externalId: `w:${phone}`, phone, name: '몰 고객', status, totalAmount: amount, orderedAt: paidAt, paidAt, srcAt } as any);

/** 싱크 원장 적재 = 적재 트랜잭션과 같은 길(회사 잠금 → 행 넣기 → 갈래 → 요약) */
const ledger = (co: string, phone: string, rows: Array<{ day: string; amount: number; store?: string }>) =>
  withTransaction(async (run) => {
    await lockCompanyPurchaseSummary(run, co);
    const cid = (await run(`SELECT id FROM customers WHERE company_id = $1::uuid AND phone = $2`, [co, phone])).rows[0].id;
    for (const r of rows) {
      await run(
        `INSERT INTO purchases (company_id, customer_id, customer_phone, purchase_date, total_amount, store_name)
         VALUES ($1::uuid, $2::uuid, $3, $4::timestamp, $5, $6)`,
        [co, cid, phone, `${r.day} 00:00:00`, r.amount, r.store ?? '강남점'],
      );
    }
    await applyLedgerIngestSummary(run, co, [cid]);
  });

/** 고객 적재(싱크 · 엑셀 · 화면) = 빌더 runBatch 그대로 */
const upsert = (co: string, rows: Array<Record<string, any>>) =>
  withTransaction((run) => createCustomerUpsertBuilder({ source: 'sync', includeUploadedBy: false, skipUnchanged: true }).runBatch(run, co, rows));

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C98-DDL-2'));
  await pool.query(ledgerBlockSql('C99-DDL-1'));
  await pool.query(ledgerBlockSql('C99-DDL-2'));
}, 120_000);

describe('T1 고객 구매 요약 칸 — 두 문 회사 = 두 문 사실(같은 구매 한 번)', () => {
  it('직원 시트 19: 몰 30,000 + 같은 날 매장 두 줄(10,000 · 20,000 = 그날 합계) = 1회 30,000 → 다음 날 매장 7,000 = 2회 37,000 → 몰 취소 = 매장 세 줄 3회 37,000', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'O-1', 'paid', 30000, '2026-10-10T03:00:00Z', '2026-10-10T03:00:00Z');   // KST 10-10 12:00
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 30000 });   // 아직 몰만 = 증분
    await ledger(co, p, [{ day: '2026-10-10', amount: 10000 }, { day: '2026-10-10', amount: 20000 }]);
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 30000, tp: 30000, d: '2026-10-10', ramt: 30000, last: '2026-10-10' });
    await ledger(co, p, [{ day: '2026-10-11', amount: 7000, store: '역삼점' }]);
    expect(await sum(co, p)).toMatchObject({ cnt: 2, total: 37000, d: '2026-10-11', ramt: 7000, store: '역삼점' });
    await mall(co, p, 'O-1', 'cancelled', 30000, '2026-10-10T03:00:00Z', '2026-10-12T03:00:00Z');
    expect(await sum(co, p)).toMatchObject({ cnt: 3, total: 37000, d: '2026-10-11', ramt: 7000 });
    expect((await sum(co, p)).src.d2).toBeTruthy();
  });

  it('금액이 다른 같은 날 매장 구매 = 따로 센다 · 같은 날 몰이 가장 늦으면 금액 = 몰 · 매장 = 그날 원장 사실', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'O-2', 'paid', 50000, '2026-10-10T05:00:00Z', '2026-10-10T05:00:00Z');
    await ledger(co, p, [{ day: '2026-10-10', amount: 8000, store: '홍대점' }]);
    expect(await sum(co, p)).toMatchObject({ cnt: 2, total: 58000, d: '2026-10-10', ramt: 50000, store: '홍대점' });
  });

  it('회사 갈래: 몰만 = 증분 · 매장만 = 원장 재계산 · 두 문 = two_door_since 한 번 · 원장을 다 지워도 두 문 그대로', async () => {
    const co = await newCompany();
    const run = (sql: string, params?: any[]) => pool.query(sql, params);
    expect(await resolvePurchaseSummaryBranch(run, co)).toBe('none');
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '고객' }]);
    await ledger(co, p, [{ day: '2026-09-01', amount: 4000 }]);
    expect(await resolvePurchaseSummaryBranch(run, co)).toBe('store');
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 4000, d: '2026-09-01' });
    await mall(co, p, 'O-3', 'paid', 9000, '2026-10-01T03:00:00Z', '2026-10-01T03:00:00Z');
    const since1 = (await query(`SELECT two_door_since FROM companies WHERE id = $1::uuid`, [co])).rows[0].two_door_since;
    expect(since1).not.toBeNull();
    expect(await sum(co, p)).toMatchObject({ cnt: 2, total: 13000, d: '2026-10-01', ramt: 9000 });
    await query(`DELETE FROM purchases WHERE company_id = $1::uuid`, [co]);
    expect(await resolvePurchaseSummaryBranch(run, co)).toBe('two_door');
    const since2 = (await query(`SELECT two_door_since FROM companies WHERE id = $1::uuid`, [co])).rows[0].two_door_since;
    expect(new Date(since2).getTime()).toBe(new Date(since1).getTime());
  });

  it('두 문 회사 업서트 = 원본 요약 칸을 직접 쓰지 않는다 · summary_source 에 남는다 · 원본 최근일이 사실보다 늦으면 그 날짜 · 그 묶음 금액 · 매장', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'O-4', 'paid', 20000, '2026-10-05T03:00:00Z', '2026-10-05T03:00:00Z');
    await ledger(co, p, [{ day: '2026-10-03', amount: 6000 }]);
    expect(await sum(co, p)).toMatchObject({ cnt: 2, total: 26000, d: '2026-10-05' });
    await upsert(co, [{ phone: p, purchase_count: 99, total_purchase_amount: 999999, recent_purchase_date: '2026-10-20', recent_purchase_amount: 12345, recent_purchase_store: '원본점' }]);
    const s = await sum(co, p);
    expect(s).toMatchObject({ cnt: 2, total: 26000, d: '2026-10-20', ramt: 12345, store: '원본점', last: '2026-10-20' });
    expect(s.src.totals).toMatchObject({ purchase_count: 99, total_purchase_amount: 999999 });
    expect(s.src.recent).toMatchObject({ date: '2026-10-20', amount: 12345, store: '원본점' });
    // 원본이 날짜 없이 금액만 = 묶음 그대로 · 날짜만 다시 주면 묶음 통째 교체(금액 · 매장 키 없음 = 비움)
    await upsert(co, [{ phone: p, recent_purchase_amount: 1 }]);
    expect((await sum(co, p)).src.recent).toMatchObject({ date: '2026-10-20', amount: 12345 });
    await upsert(co, [{ phone: p, recent_purchase_date: '2026-10-21' }]);
    expect(await sum(co, p)).toMatchObject({ d: '2026-10-21', ramt: null, store: null });
    // 요약 키가 없는 입력(화면 정보 수정) = 원본 칸 그대로
    await upsert(co, [{ phone: p, name: '이름만' }]);
    expect((await sum(co, p)).src.totals).toMatchObject({ purchase_count: 99 });
  });

  it('처음 세는 고객 = 지금 칸 최근 구매일을 옛 값으로 옮겨 큰 값 비교에 쓴다(사실이 더 이르면 옛 날짜 그대로) · 한 번만', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '옛 고객' }]);
    await query(`UPDATE customers SET recent_purchase_date = '2026-09-30', recent_purchase_amount = 777, recent_purchase_store = '옛점' WHERE company_id = $1::uuid AND phone = $2`, [co, p]);
    await mall(co, p, 'O-5', 'paid', 1000, '2026-09-01T03:00:00Z', '2026-09-01T03:00:00Z');   // 몰만 = 증분(최근일은 큰 값이라 9-30 그대로)
    await ledger(co, p, [{ day: '2026-09-02', amount: 2000 }]);   // 두 문 = CT-D3 첫 회
    const s = await sum(co, p);
    expect(s).toMatchObject({ cnt: 2, total: 3000, d: '2026-09-30', ramt: 777, store: '옛점' });
    expect(s.src.recent).toMatchObject({ date: '2026-09-30', legacy: true });
    expect(s.src.d2).toBeTruthy();
  });

  it('두 문 전환 패스: 쓰기가 없던 고객(사실 0 · 옛 원본 누계)도 한 번씩 센다 · 한 문 회사는 건드리지 않는다 · 다시 돌려도 그대로', async () => {
    resetTwoDoorTransitionState();
    const co = await newCompany();
    const [a, b] = [phoneOf(), phoneOf()];
    await upsert(co, [{ phone: a, purchase_count: 42, total_purchase_amount: 500000, recent_purchase_date: '2026-08-01' }, { phone: b, name: '나' }]);
    expect(await sum(co, a)).toMatchObject({ cnt: 42, total: 500000 });   // 아직 한 문도 아님 = 원본 그대로
    const store = await newCompany();
    const s = phoneOf();
    await upsert(store, [{ phone: s, purchase_count: 7 }]);
    await ledger(store, s, [{ day: '2026-10-01', amount: 100 }]);
    await mall(co, b, 'O-7', 'paid', 3000, '2026-10-01T03:00:00Z', '2026-10-01T03:00:00Z');
    await ledger(co, b, [{ day: '2026-10-02', amount: 4000 }]);   // 여기서 두 문(b 만 CT-D3)
    expect(await sum(co, a)).toMatchObject({ cnt: 42, total: 500000 });
    const r = await runTwoDoorTransitionPass();
    expect(r.failed).toBe(0);
    expect(await sum(co, a)).toMatchObject({ cnt: 0, total: 0, d: '2026-08-01' });   // 원본 누계 = 계산에 안 씀 · 최근일 = 원본(큰 값)
    expect((await sum(co, a)).src.d2).toBeTruthy();
    const left = (await query(`SELECT COUNT(*)::int AS n FROM customers WHERE company_id = $1::uuid AND NOT (COALESCE(summary_source, '{}'::jsonb) ? 'd2')`, [co])).rows[0].n;
    expect(left).toBe(0);
    expect((await sum(store, s)).src?.d2).toBeUndefined();   // 매장만 회사 = 대상 아님
    const again = await runTwoDoorTransitionPass();
    expect(await sum(co, a)).toMatchObject({ cnt: 0, total: 0, d: '2026-08-01' });
    expect(again.failed).toBe(0);
  });

  it('Codex 구현 1R #1 — 아직 안 센 고객의 첫 계산이 몰 취소면 표식 전에 센다(취소된 주문의 날이 옛 값으로 굳지 않는다)', async () => {
    const co = await newCompany();
    const [a, b] = [phoneOf(), phoneOf()];
    await mall(co, a, 'A-1', 'paid', 1000, '2026-10-01T03:00:00Z', '2026-10-01T03:00:00Z');
    await mall(co, a, 'A-2', 'paid', 2000, '2026-10-05T03:00:00Z', '2026-10-05T03:00:00Z');
    expect(await sum(co, a)).toMatchObject({ cnt: 2, d: '2026-10-05' });   // 몰만 = 증분
    await mall(co, b, 'B-1', 'paid', 3000, '2026-10-06T03:00:00Z', '2026-10-06T03:00:00Z');
    await ledger(co, b, [{ day: '2026-10-07', amount: 500 }]);   // 여기서 두 문(b 만 셈 · a 는 아직 d2 없음)
    expect((await sum(co, a)).src?.d2).toBeUndefined();
    await mall(co, a, 'A-2', 'cancelled', 2000, '2026-10-05T03:00:00Z', '2026-10-08T03:00:00Z');
    const s = await sum(co, a);
    expect(s).toMatchObject({ cnt: 1, total: 1000, d: '2026-10-01', ramt: 1000, last: '2026-10-01' });
    expect(s.src.recent).toBeUndefined();   // 옮긴 옛 값 0(그 날은 그때 사실에 있었다)
    expect(s.src.d2).toBeTruthy();
  });

  it('Codex 구현 2R — 원장 + 표식 없는 옛 결제(마커 도입 전)만 있는 회사 = 처음부터 두 문(갈래 = 사실과 같은 판정) · 첫 취소 = 남은 원장으로(0 이 아니다)', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '옛 몰 고객' }]);
    const cid = await idOf(co, p);
    await insertMinimalRow(pool, 'cdp_events', {
      id: randomUUID(), company_id: co, customer_id: cid, event_name: 'purchase', source: 'woocommerce', occurred_at: new Date('2026-09-10T03:00:00Z'),
      properties: { order_id: 'LEG-1', status: 'paid', total_amount: 30000, src_at: '2026-09-10T03:00:00Z' },
    });
    await ledger(co, p, [{ day: '2026-09-10', amount: 30000 }]);
    expect(await resolvePurchaseSummaryBranch((t, v) => pool.query(t, v), co)).toBe('two_door');
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 30000 });   // 같은 구매 한 번
    await mall(co, p, 'LEG-1', 'cancelled', 30000, '2026-09-10T03:00:00Z', '2026-09-12T03:00:00Z');
    expect(await sum(co, p)).toMatchObject({ cnt: 1, total: 30000, d: '2026-09-10' });   // 몰 취소 = 원장 줄이 이제 따로 · 단순 차감 0 이 아니다
  });

  it('값이 같으면 다시 쓰지 않는다(updated_at 그대로 · full 싱크마다 전 행 재작성 금지)', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'O-6', 'paid', 5000, '2026-10-01T03:00:00Z', '2026-10-01T03:00:00Z');
    await ledger(co, p, [{ day: '2026-10-02', amount: 1000 }]);
    const before = (await query(`SELECT updated_at FROM customers WHERE company_id = $1::uuid AND phone = $2`, [co, p])).rows[0].updated_at;
    const cid = await idOf(co, p);
    const n = await withTransaction(async (run) => { await lockCompanyPurchaseSummary(run, co); return applyLedgerIngestSummary(run, co, [cid]); });
    expect(n).toBe(0);
    const after = (await query(`SELECT updated_at FROM customers WHERE company_id = $1::uuid AND phone = $2`, [co, p])).rows[0].updated_at;
    expect(new Date(after).getTime()).toBe(new Date(before).getTime());
  });
});


/** 회사 + 담당자(여정 만든 계정) + 여정 하나 · 고객을 받을 수 있게(안전 필터 = 동의 · 활성) */
async function journeyOf(co: string, trigger = 'cdp.purchase'): Promise<string> {
  const owner = randomUUID();
  await insertMinimalRow(pool, 'users', { id: owner, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-1103', login_id: `t-1103-td-${owner.slice(0, 8)}` });
  const j = randomUUID();
  await insertMinimalRow(pool, 'journeys', { id: j, company_id: co, created_by: owner, name: '두 문 시험 여정', status: 'active', start_kind: 'event', trigger_event: trigger });
  return j;
}
const reachable = (co: string) => query(`UPDATE customers SET sms_opt_in = true, is_active = true WHERE company_id = $1::uuid`, [co]);
const entered = (j: string, cid: string, door: 'mall' | 'ledger', day: string) =>
  insertMinimalRow(pool, 'journey_executions', { id: randomUUID(), journey_id: j, customer_id: cid, status: 'active', entry_event_properties: { __entry: { src: 'trigger', key: randomUUID(), door, day } } });
const kstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const FAR = new Date('2100-01-01T00:00:00Z');

describe('T3 · S9 · T4 · T5 · T7 · T8 · T9 · T10 · S12 — 새 SQL 이 실 PG 에서 뜻대로 돈다', () => {
  it('T3 CT-D5 진입 소유: 같은 날 다른 문 진입이 있는 행 = 커서 후보 아님(원장 · 사건 두 쪽) · 다른 날 = 후보 · 넣기 반복문 조각 같은 판정', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'E-1', 'paid', 30000, '2026-10-20T03:00:00Z', '2026-10-20T03:00:00Z');
    await mall(co, p, 'E-2', 'paid', 9000, '2026-10-22T03:00:00Z', '2026-10-22T03:00:00Z');
    await ledger(co, p, [{ day: '2026-10-20', amount: 30000 }, { day: '2026-10-21', amount: 5000 }]);
    await reachable(co);
    const cid = await idOf(co, p);
    const j = await journeyOf(co);
    await entered(j, cid, 'mall', '2026-10-20');
    await entered(j, cid, 'ledger', '2026-10-22');
    const lrows = await selectPurchaseLedgerRowsForCursor(co, {}, { at: '2000-01-01T00:00:00Z', rowId: null }, FAR, 100000, 100, '', undefined, [j]);
    expect(lrows.map((r) => r.entryDay)).toEqual(['2026-10-21']);   // 10-20 = 그날 자사몰이 가졌다
    const lall = await selectPurchaseLedgerRowsForCursor(co, {}, { at: '2000-01-01T00:00:00Z', rowId: null }, FAR, 100000, 100);
    expect(lall.map((r) => r.entryDay).sort()).toEqual(['2026-10-20', '2026-10-21']);
    const cur = { at: '2000-01-01T00:00:00Z', eventId: null, axis: 'created_at' as const };
    const erows = await selectCdpEventRowsForCursor(co, 'purchase', {}, cur, FAR, 100000, 100, '', undefined, [j], true);
    expect(erows.map((r) => r.entryDay)).toEqual(['2026-10-20']);   // 10-22 = 그날 매장이 가졌다 · 10-20 = 같은 문(자사몰) 표식은 거르지 않는다
    const eall = await selectCdpEventRowsForCursor(co, 'purchase', {}, cur, FAR, 100000, 100, '', undefined, [j], false);
    expect(eall).toHaveLength(2);
    const owned = (door: string, day: string) => query(`SELECT ${crossDoorEntryOwnedSql('$1', '$2::uuid', '$3::text', '$4::text')} AS owned`, [[j], cid, door, day]).then((r) => r.rows[0].owned);
    expect(await owned('ledger', '2026-10-20')).toBe(true);
    expect(await owned('mall', '2026-10-20')).toBe(false);
    expect(await owned('ledger', '2026-10-21')).toBe(false);
  });

  it('S9 이전 구매 = 두 문 사실: 몰 주문과 같은 구매인 매장 줄은 「이전 구매」가 아니다(휴면 복귀 · 첫 구매가 막히지 않는다)', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'P-1', 'paid', 30000, '2026-10-10T05:00:00Z', '2026-10-10T05:00:00Z');
    await ledger(co, p, [{ day: '2026-10-10', amount: 30000 }]);
    const cid = await idOf(co, p);
    const prior = await selectLastPriorPurchase(co, [{ customerId: cid, enteredAt: '2026-10-10T05:00:00Z' }]);
    expect(prior.has(cid)).toBe(false);
    const later = await selectLastPriorPurchase(co, [{ customerId: cid, enteredAt: '2026-10-15T00:00:00Z' }]);
    expect(new Date(later.get(cid)!).toISOString()).toBe('2026-10-10T05:00:00.000Z');
  });

  it('T4 구매 미리보기 = 최근 7일 두 문 사실 고객(매장만 산 고객도 · 같은 주문 = 한 명)', async () => {
    const co = await newCompany();
    const [a, b] = [phoneOf(), phoneOf()];
    await upsert(co, [{ phone: a, name: '매장만' }, { phone: b, name: '두 문' }]);
    await ledger(co, a, [{ day: kstDay(-1), amount: 1000 }]);
    await reachable(co);
    const q = await buildJourneyTargetQuery(co, 'cdp.purchase', {}, 100);
    const ids = (await pool.query(q!.sql, q!.params)).rows.map((r) => String(r.customer_id));
    expect(ids).toEqual([await idOf(co, a)]);
  });

  it('T5 CT-D4: 매장 구매 = 기준 날 다음 날부터 「샀음」 · 지난 N일 = KST 오늘 − N일 · 목표 판정도 같은 조각', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await upsert(co, [{ phone: p, name: '고객' }]);
    await ledger(co, p, [{ day: kstDay(0), amount: 4000 }]);
    const cid = await idOf(co, p);
    const after = (at: string) => query(`SELECT ${purchaseAfterSql('$2::uuid', '$1::uuid', '$3::timestamptz')} AS hit`, [co, cid, at]).then((r) => r.rows[0].hit);
    const y = new Date(Date.now() - 86_400_000).toISOString();
    expect(await after(y)).toBe(true);                                   // 어제 들어온 실행 → 오늘 매장 구매 = 샀음
    expect(await after(new Date().toISOString())).toBe(false);           // 오늘 들어온 실행 → 같은 날 매장 구매 = 날짜만이라 아님
    const within = (d: number) => query(`SELECT ${purchaseWithinDaysSql('$2::uuid', '$1::uuid', '$3')} AS hit`, [co, cid, d]).then((r) => r.rows[0].hit);
    expect(await within(1)).toBe(true);
    const goal = await query(PURCHASED_SINCE_ENTRY_ONE_SQL, [co, cid, y, false]);
    expect(goal.rows[0].hit).toBe(true);
    // 기다리기 칸 · 조건 칸 문장 모양 그대로(journey-executor · 실행 행 + 앵커 배열 · 고객 배열 + 일수)
    const j = await journeyOf(co);
    const ex = randomUUID();
    await insertMinimalRow(pool, 'journey_executions', { id: ex, journey_id: j, customer_id: cid, status: 'active' });
    const wait = await query(
      `SELECT e.id FROM journey_executions e
         JOIN unnest($1::uuid[], $2::timestamptz[]) AS a(id, at) ON a.id = e.id
        WHERE ${purchaseAfterSql('e.customer_id', '$3::uuid', 'a.at')}`,
      [[ex], [y], co],
    );
    expect(wait.rows.map((r) => r.id)).toEqual([ex]);
    const cond = await query(`SELECT c.id AS customer_id FROM unnest($1::uuid[]) AS c(id) WHERE ${purchaseWithinDaysSql('c.id', '$2::uuid', '$3')}`, [[cid], co, 7]);
    expect(cond.rows.map((r) => r.customer_id)).toEqual([cid]);
  });

  it('구매 주기 이탈 = 두 문 사실 이력(같은 구매 한 번 · 세 건 이상 · 평균 간격 × 계수 넘김)', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'CY-1', 'paid', 1000, '2026-06-01T03:00:00Z', '2026-06-01T03:00:00Z');
    await ledger(co, p, [{ day: '2026-06-01', amount: 1000 }, { day: '2026-06-11', amount: 2000 }, { day: '2026-06-21', amount: 3000 }]);
    await reachable(co);
    await query(`UPDATE customers SET created_at = NOW() - INTERVAL '60 days' WHERE company_id = $1::uuid`, [co]);   // 이관 유예(방금 들어온 고객) 밖
    const q = await buildJourneyTargetQuery(co, 'customer.cycle_lapsed', { cycle_factor: 1.5 }, 100);
    const ids = (await pool.query(q!.sql, q!.params)).rows.map((r) => String(r.customer_id));
    expect(ids).toEqual([await idOf(co, p)]);   // 06-01(몰 = 매장 같은 구매 한 번) · 06-11 · 06-21 = 세 건 · 간격 10일 × 1.5 를 오래 넘김
  });

  it('T7 상품 = (문, 키): 같은 키라도 다른 문 구매로 목표 달성 아님 · 목록 두 묶음 · 리듬 = 두 문', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await syncOrder(co, { source: 'woocommerce', orderId: 'PR-1', externalId: `w:${p}`, phone: p, name: '몰', status: 'paid', totalAmount: 7000,
      orderedAt: '2026-10-05T03:00:00Z', paidAt: '2026-10-05T03:00:00Z', srcAt: '2026-10-05T03:00:00Z', items: [{ productId: '123', productName: '수건' }] } as any);
    const cid = await idOf(co, p);
    await query(`INSERT INTO purchases (company_id, customer_id, customer_phone, purchase_date, total_amount, product_code, product_name)
                 VALUES ($1::uuid, $2::uuid, $3, (NOW() AT TIME ZONE 'Asia/Seoul')::date - 3, 3000, '777', '샴푸')`, [co, cid, p]);
    const hit = (keys: string[], door: string) => query(PRODUCT_REPURCHASE_SINCE_ENTRY_SQL, [co, cid, '2026-10-01T00:00:00Z', keys, door]).then((r) => r.rows.length > 0);
    expect(await hit(['123'], 'mall')).toBe(true);
    expect(await hit(['123'], 'ledger')).toBe(false);   // 매장 코드 123 여정이 몰 상품 123 구매로 끝나지 않는다
    expect(await hit(['777'], 'ledger')).toBe(true);
    const byDoor = await listObservedProductsByDoor(co);
    expect(byDoor.mall?.products.map((x) => x.key)).toEqual(['123']);
    expect(byDoor.ledger?.products.map((x) => x.key)).toEqual(['777']);
    const rhythm = await loadPurchaseRhythm(co);
    expect(rhythm.doors.sort()).toEqual(['ledger', 'mall']);
    expect(rhythm.buyers).toBe(1);
    await expect(loadProductCycles(co)).resolves.toEqual([]);   // 표본 미달 = 권하지 않음(문장은 돈다)
    const empty = await newCompany();
    expect(await listObservedProductsByDoor(empty)).toEqual({ mall: null, ledger: null });
  });

  it('T9 귀속: 실수신자 매장 구매 = 원장 행 단위 · 몰 주문과 같은 구매인 줄 = 뺀다 · 캠페인 반응 = 두 문 사실', async () => {
    const co = await newCompany();
    const p = phoneOf();
    recipients.phones = [p];
    const camp = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { id: camp, company_id: co, status: 'completed', sent_at: new Date(Date.now() - 2 * 86_400_000) });
    const d1 = kstDay(-1);
    await mall(co, p, 'R-1', 'paid', 30000, `${d1}T03:00:00+09:00`, `${d1}T03:00:00+09:00`);
    await ledger(co, p, [{ day: d1, amount: 30000 }, { day: d1, amount: 0 }, { day: kstDay(0), amount: 6000 }]);   // 30,000 = 몰과 같은 구매(행 금액) · 0원 줄도 그날 합계 = 몰 금액이라 같은 구매 · 오늘 6,000
    const orders = await campaignRecipientOrders(co, camp);
    expect([...orders!.values()].reduce((a, b) => a + b, 0)).toBe(36000);   // 몰 30,000 + 매장 6,000(그날 같은 구매 줄 두 개 뺌)
    expect([...orders!.keys()].filter((k) => k.startsWith('ledger:'))).toHaveLength(1);
    const att = await buildCampaignAttribution(co, 30);
    expect(att.hasCdpData).toBe(true);
    const w7 = att.windows.find((w) => w.windowLabel === '7d')!;
    expect(w7).toMatchObject({ cdpPurchaseCount: 2, cdpRevenue: 36000 });
  });

  it('T10 가입 근거 = 행 · 카페24 회원 연동 켜짐 · 싱크 incremental 정상 완료 · full 만 = 없음', async () => {
    const none = await newCompany();
    expect(await joinedAtEvidence(none)).toEqual({ ok: false, via: null });
    const c24 = await newCompany();
    await insertMinimalRow(pool, 'company_integrations', { id: randomUUID(), company_id: c24, provider: 'cafe24', status: 'active', mall_id: `m-${c24.slice(0, 6)}` });
    expect(await joinedAtEvidence(c24)).toEqual({ ok: true, via: 'cafe24' });
    const full = await newCompany();
    await insertMinimalRow(pool, 'sync_logs', { id: randomUUID(), company_id: full, sync_type: 'customers', mode: 'full', completed_at: new Date(), success_count: 5, total_count: 5 });
    expect(await joinedAtEvidence(full)).toEqual({ ok: false, via: null });
    await insertMinimalRow(pool, 'sync_logs', { id: randomUUID(), company_id: full, sync_type: 'customers', mode: 'incremental', completed_at: new Date(), success_count: 0, total_count: 3, error_message: '연결 실패' });
    expect(await joinedAtEvidence(full)).toEqual({ ok: false, via: null });   // 실패 기록 = 길 아님
    await insertMinimalRow(pool, 'sync_logs', { id: randomUUID(), company_id: full, sync_type: 'customers', mode: 'incremental', completed_at: new Date(), success_count: 0, total_count: 0 });
    expect(await joinedAtEvidence(full)).toEqual({ ok: true, via: 'sync_incremental' });   // 정상 빈 회차 = 길이 열려 있다
  });

  it('S12 구매 이력 = 원장 우선 · 그날 원장 합계가 몰 금액과 같으면 몰 줄을 숨긴다 · T8 문 안내 = 두 문', async () => {
    const co = await newCompany();
    const p = phoneOf();
    await mall(co, p, 'H-1', 'paid', 30000, '2026-10-10T03:00:00Z', '2026-10-10T03:00:00Z');
    await mall(co, p, 'H-2', 'paid', 4000, '2026-10-12T03:00:00Z', '2026-10-12T03:00:00Z');
    await ledger(co, p, [{ day: '2026-10-10', amount: 10000 }, { day: '2026-10-10', amount: 20000 }]);
    const rows = (await pool.query(`SELECT p.origin, p.total_amount::int AS amt FROM ${purchaseHistorySourceSql('$1')} ORDER BY p.purchase_date, p.total_amount`, [co])).rows;
    expect(rows).toEqual([{ origin: 'ledger', amt: 10000 }, { origin: 'ledger', amt: 20000 }, { origin: 'mall', amt: 4000 }]);
    const st = await getPurchaseDoorStatus(co);
    expect(st.mall?.lastArrivalAt).toBeTruthy();
    expect(st.ledger?.lastArrivalAt).toBeTruthy();
    expect(await getPurchaseDoorStatus(await newCompany())).toEqual({ mall: null, ledger: null });
  });
});
