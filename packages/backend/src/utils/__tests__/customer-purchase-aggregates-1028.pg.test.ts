// replaces: none
/**
 * 고객 누계 보호(P3) — 실 PostgreSQL 판(★ 2026-10-28 설계서 docs/2026-10-28-sync-value-check-summary-guard-design.md §4)
 *
 * 주장이 SQL 에 기댄다: keep 칸 = 고객 적재와 같은 규칙(구매횟수 · 최근구매일 = GREATEST · 누적금액 · 최근구매금액 · 매장 = 원장이 안 씀)
 *   · 나머지는 원장으로 다시 계산 · 새 칸 없는 요청 = 지금처럼 5칸 전부.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { updateCustomerPurchaseAggregates, parseCustomerSummaryFields } from '../customer-purchase-aggregates';

const CO = '00000000-0000-0000-0000-0000000010f3';
const C_KEEP = '00000000-0000-0000-0000-0000000010a1';
const C_ALL = '00000000-0000-0000-0000-0000000010a2';
const C_FULL_KEEP = '00000000-0000-0000-0000-0000000010a3';

const summary = async (id: string) =>
  (await query(
    `SELECT total_purchase_amount::int AS amt, purchase_count AS cnt, recent_purchase_date::text AS d,
            recent_purchase_amount::int AS ramt, recent_purchase_store AS store
       FROM customers WHERE id = $1::uuid`,
    [id],
  )).rows[0];

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  let n = 0;
  for (const id of [C_KEEP, C_ALL, C_FULL_KEEP]) {
    n++;
    await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${String(n).padStart(4, '0')}` });
    // 고객 원본(ERP 고객 마스터)이 준 누계
    await query(
      `UPDATE customers SET total_purchase_amount = 900000, purchase_count = 42, recent_purchase_date = '2026-10-20',
                            recent_purchase_amount = 70000, recent_purchase_store = '원본매장'
        WHERE id = $1::uuid`,
      [id],
    );
    // 구매 원장 = 일별 집계 두 줄
    for (const [day, amt] of [['2026-10-01', 10000], ['2026-10-05', 25000]] as const) {
      await insertMinimalRow(pool, 'purchases', {
        company_id: CO, customer_id: id, customer_phone: `0100000${String(n).padStart(4, '0')}`,
        purchase_date: `${day} 00:00:00`, total_amount: amt, store_name: '원장매장',
      });
    }
  }
});

describe('P3 원장 재계산이 고객 원본 요약 칸을 덮지 않는다', () => {
  it('keep 칸은 그대로 · 나머지 칸만 원장으로', async () => {
    const keep = parseCustomerSummaryFields(['total_purchase_amount', 'purchase_count', 'recent_purchase_date', 'recent_purchase_store']);
    expect(await updateCustomerPurchaseAggregates(CO, [C_KEEP], { keepColumns: keep })).toBe(1);
    expect(await summary(C_KEEP)).toEqual({ amt: 900000, cnt: 42, d: '2026-10-20', ramt: 25000, store: '원본매장' });
  });

  it('새 칸 없는 요청(지금 에이전트) = 5칸 전부 원장으로', async () => {
    expect(await updateCustomerPurchaseAggregates(CO, [C_ALL])).toBe(1);
    expect(await summary(C_ALL)).toEqual({ amt: 35000, cnt: 2, d: '2026-10-05', ramt: 25000, store: '원장매장' });
  });

  it('5칸 전부 keep · 원본 값이 있으면 값 불변', async () => {
    const keep = parseCustomerSummaryFields([
      'total_purchase_amount', 'purchase_count', 'recent_purchase_date', 'recent_purchase_amount', 'recent_purchase_store',
    ]);
    await updateCustomerPurchaseAggregates(CO, [C_FULL_KEEP], { keepColumns: keep });
    expect(await summary(C_FULL_KEEP)).toEqual({ amt: 900000, cnt: 42, d: '2026-10-20', ramt: 70000, store: '원본매장' });
  });

  it('keep 칸 규칙 = 고객 적재와 같다 · 큰 값 칸(구매횟수 · 최근구매일)은 원본이 비어도 원장이 채운다 · 원본 칸(누적금액)은 원장이 안 쓴다', async () => {
    await query(
      `UPDATE customers SET total_purchase_amount = NULL, recent_purchase_date = NULL WHERE id = $1::uuid`,
      [C_FULL_KEEP],
    );
    const keep = parseCustomerSummaryFields(['total_purchase_amount', 'purchase_count', 'recent_purchase_date']);
    expect(await updateCustomerPurchaseAggregates(CO, [C_FULL_KEEP], { keepColumns: keep })).toBe(1);
    expect(await summary(C_FULL_KEEP)).toEqual({ amt: null, cnt: 42, d: '2026-10-05', ramt: 25000, store: '원장매장' });
  });

  it('원장이 채운 값이 굳지 않는다 — 새 구매가 들어오면 최근구매일 · 구매횟수가 따라 올라간다(Codex 구현 1R)', async () => {
    await query(
      `UPDATE customers SET total_purchase_amount = NULL, purchase_count = NULL, recent_purchase_date = NULL WHERE id = $1::uuid`,
      [C_ALL],
    );
    const keep = parseCustomerSummaryFields(['purchase_count', 'recent_purchase_date']);
    await updateCustomerPurchaseAggregates(CO, [C_ALL], { keepColumns: keep });
    expect(await summary(C_ALL)).toMatchObject({ cnt: 2, d: '2026-10-05' });
    await insertMinimalRow(pool, 'purchases', {
      company_id: CO, customer_id: C_ALL, customer_phone: '01000000002', purchase_date: '2026-10-09 00:00:00', total_amount: 5000, store_name: '원장매장',
    });
    await updateCustomerPurchaseAggregates(CO, [C_ALL], { keepColumns: keep });
    expect(await summary(C_ALL)).toMatchObject({ cnt: 3, d: '2026-10-09' });
  });
});

describe('parseCustomerSummaryFields 허용 목록', () => {
  it('배열 아님 · 모르는 칸 · 글자 아님 = 버림 · 중복 제거', () => {
    expect(parseCustomerSummaryFields(undefined)).toEqual([]);
    expect(parseCustomerSummaryFields('purchase_count')).toEqual([]);
    expect(parseCustomerSummaryFields(['purchase_count', 'purchase_count', 'phone', 'x; DROP TABLE customers', 7])).toEqual(['purchase_count']);
  });
});
