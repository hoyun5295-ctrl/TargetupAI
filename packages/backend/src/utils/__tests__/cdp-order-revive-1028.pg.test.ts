// replaces: none
/**
 * 취소 뒤 되살림(M22) · 취소 때 최근 구매일 되돌림(M21) — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 묶음 B · K1-5 · K1-6 종결 규칙)
 *
 * 주장이 SQL 에 기댄다: 표식 jsonb 갱신 · 조건부 UPDATE(판정 CAS) · UPDATE … FROM LATERAL 의 남은 구매 MAX(자사몰 순매출 + 싱크 원장) · KST 날짜.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

vi.mock('../unified-customer-profile', () => ({ recomputeProfile: vi.fn(async () => undefined) }));

import { syncOrder } from '../cdp-orders';

const CO = '00000000-0000-0000-0000-0000000000c4';
let n = 0;
/** phone = 고객 꼬리 번호(두 자리 → 0100000 + 4자리) · 나머지는 주문 입력 그대로 */
const order = ({ phone = '1', ...o }: { orderId: string; status: string; srcAt: string; phone?: string; [k: string]: any }) =>
  syncOrder(CO, {
    source: 'woocommerce',
    totalAmount: 10000,
    orderedAt: '2026-10-01T03:00:00Z',
    ...o,
    externalId: `m4:${phone}`,
    phone: `0100000${phone.padStart(4, '0')}`,
  } as any);
const cust = async (phone: string): Promise<any> =>
  (await query(`SELECT total_purchase_amount::int AS total, purchase_count, recent_purchase_date::text AS recent, recent_purchase_amount::int AS recent_amt, last_purchase_date AS last
                  FROM customers WHERE company_id = $1::uuid AND phone = $2`, [CO, phone])).rows[0];
const ev = async (orderId: string): Promise<any> =>
  (await query(`SELECT event_name, properties FROM cdp_events WHERE company_id = $1::uuid AND properties->>'order_id' = $2`, [CO, orderId])).rows[0];

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
});

describe('M22 취소 뒤 몰에서 다시 결제', () => {
  it('source 종류(우커머스): 결제 → 취소(차감) → 취소보다 늦은 결제 = 다시 더한다 · 표식 걷힘 · 다시 취소하면 다시 뺀다', async () => {
    n += 1;
    const id = `R-${n}`;
    await order({ orderId: id, status: 'paid', srcAt: '2026-10-01T03:00:00Z', phone: '11' });
    await order({ orderId: id, status: 'cancelled', srcAt: '2026-10-02T03:00:00Z', phone: '11' });
    expect((await cust('01000000011')).total).toBe(0);
    const r = await order({ orderId: id, status: 'paid', srcAt: '2026-10-03T03:00:00Z', phone: '11' });
    expect(r.rfmUpdated).toBe(true);
    expect((await cust('01000000011'))).toMatchObject({ total: 10000, purchase_count: 1 });
    const e = await ev(id);
    expect(e.properties.revenue_reversed).toBeUndefined();
    expect(e.properties).toMatchObject({ revenue_applied: true, revived_at: '2026-10-03T03:00:00.000Z' });
    await order({ orderId: id, status: 'refunded', srcAt: '2026-10-04T03:00:00Z', phone: '11' });
    expect((await cust('01000000011'))).toMatchObject({ total: 0, purchase_count: 0 });
  });

  it('취소보다 앞선 옛 결제 본문이 늦게 와도 되살리지 않는다(stale)', async () => {
    n += 1;
    const id = `R-${n}`;
    await order({ orderId: id, status: 'paid', srcAt: '2026-10-01T03:00:00Z', phone: '12' });
    await order({ orderId: id, status: 'cancelled', srcAt: '2026-10-02T03:00:00Z', phone: '12' });
    const r = await order({ orderId: id, status: 'paid', srcAt: '2026-10-01T09:00:00Z', phone: '12' });
    expect(r.stale).toBe(true);
    expect((await cust('01000000012')).total).toBe(0);
  });

  it('받은 시각뿐인 provider(카페24) = 취소 뒤 결제 본문으로 되살리지 않는다(안전 방향 · 늦게 다시 온 옛 본문과 구분 못 함)', async () => {
    n += 1;
    const id = `R-${n}`;
    await order({ source: 'cafe24', orderId: id, status: 'paid', srcAt: '2026-10-01T03:00:00Z', phone: '13' });
    await order({ source: 'cafe24', orderId: id, status: 'cancelled', srcAt: '2026-10-02T03:00:00Z', phone: '13' });
    await order({ source: 'cafe24', orderId: id, status: 'paid', srcAt: '2026-10-03T03:00:00Z', phone: '13' });
    expect((await cust('01000000013')).total).toBe(0);
    expect((await ev(id)).properties.revenue_reversed).toBe(true);
  });
});

describe('M21 취소 · 환불 때 최근 구매일 되돌림', () => {
  it('가장 최근 주문을 취소하면 최근 구매일 · 금액 · 마지막 구매일이 남은 결제 구매(가장 늦은 날)로 돌아간다', async () => {
    await order({ orderId: 'A-21', status: 'paid', srcAt: '2026-10-05T03:00:00Z', orderedAt: '2026-10-05T03:00:00Z', totalAmount: 20000, phone: '21' } as any);
    await order({ orderId: 'B-21', status: 'paid', srcAt: '2026-10-09T03:00:00Z', orderedAt: '2026-10-09T03:00:00Z', totalAmount: 30000, phone: '21' } as any);
    expect(await cust('01000000021')).toMatchObject({ recent: '2026-10-09', recent_amt: 30000, last: '2026-10-09', purchase_count: 2 });
    await order({ orderId: 'B-21', status: 'cancelled', srcAt: '2026-10-10T03:00:00Z', orderedAt: '2026-10-09T03:00:00Z', totalAmount: 30000, phone: '21' } as any);
    expect(await cust('01000000021')).toMatchObject({ recent: '2026-10-05', recent_amt: 20000, last: '2026-10-05', purchase_count: 1, total: 20000 });
  });

  it('싱크 원장 구매가 더 늦으면 그 날로(두 문 합산) · 최근이 아닌 주문 취소는 날짜를 바꾸지 않는다', async () => {
    await order({ orderId: 'C-22', status: 'paid', srcAt: '2026-10-05T03:00:00Z', orderedAt: '2026-10-05T03:00:00Z', totalAmount: 5000, phone: '22' } as any);
    await order({ orderId: 'D-22', status: 'paid', srcAt: '2026-10-12T03:00:00Z', orderedAt: '2026-10-12T03:00:00Z', totalAmount: 7000, phone: '22' } as any);
    const cid = (await query(`SELECT id FROM customers WHERE company_id = $1::uuid AND phone = '01000000022'`, [CO])).rows[0].id;
    await insertMinimalRow(pool, 'purchases', { company_id: CO, customer_id: cid, purchase_date: '2026-10-08 00:00:00', total_amount: 4000 });
    await order({ orderId: 'C-22', status: 'refunded', srcAt: '2026-10-13T03:00:00Z', orderedAt: '2026-10-05T03:00:00Z', totalAmount: 5000, phone: '22' } as any);
    expect(await cust('01000000022')).toMatchObject({ recent: '2026-10-12', last: '2026-10-12' });
    await order({ orderId: 'D-22', status: 'refunded', srcAt: '2026-10-14T03:00:00Z', orderedAt: '2026-10-12T03:00:00Z', totalAmount: 7000, phone: '22' } as any);
    expect(await cust('01000000022')).toMatchObject({ recent: '2026-10-08', recent_amt: 4000, last: '2026-10-08' });
  });

  it('남은 결제 구매가 없으면 최근 구매일 · 금액 · 마지막 구매일을 비운다', async () => {
    await order({ orderId: 'E-23', status: 'paid', srcAt: '2026-10-05T03:00:00Z', orderedAt: '2026-10-05T03:00:00Z', phone: '23' } as any);
    await order({ orderId: 'E-23', status: 'cancelled', srcAt: '2026-10-06T03:00:00Z', orderedAt: '2026-10-05T03:00:00Z', phone: '23' } as any);
    expect(await cust('01000000023')).toMatchObject({ recent: null, recent_amt: null, last: null });
  });
});
