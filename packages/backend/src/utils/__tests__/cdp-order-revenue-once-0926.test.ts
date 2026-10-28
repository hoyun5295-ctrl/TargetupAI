/**
 * 주문 매출(RFM)은 한 주문에 한 번만 더하고 한 번만 뺀다 (★2026-09-26 한줄로 V2 R1-34)
 *
 * 옛: 매출을 먼저 더하고 표식(purchase 이벤트 revenue_applied)을 뒤에 남겼으며 그 기록 실패를 삼켰다.
 *     표식이 안 남으면 같은 주문의 상태 변경 웹훅이 다시 "처음 결제"로 판정해 매출이 두 번 더해졌다.
 *     같은 주문 웹훅 두 개가 동시에 오면 둘 다 기존 이벤트를 못 보고 둘 다 더할 수 있었다.
 * 처방: 표식 먼저(선점) → 매출 반영. 기존 이벤트 표식은 조건부 UPDATE로 선점한다(이미 표식이 있으면 0행 = 더하지 않는다).
 *   새 주문은 표식을 실은 이벤트 기록이 먼저다(기록 실패 = 매출 미반영 + 오류 → 웹훅 재시도). 같은 주문은 공용 잠금 CT로 한 줄로 선다.
 * ★ 2026-10-27 자사몰 대비 K1-2 — 표식 · 사건 · 고객 요약 = 한 트랜잭션. 매출 반영이 실패하면 표식 되돌림(옛 releaseMarker) 대신 롤백한다
 *   (옛: 표식 선점 뒤 프로세스가 끝나면 되돌림 catch 가 돌지 않아 표식만 남고 재처리가 「이미 반영」으로 건너뛰었다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
let rolledBack = false;
vi.mock('../../config/database', () => ({
  query: (...a: any[]) => queryMock(...a),
  withTransaction: async (work: any) => {
    try { return await work((q: string, p: any[]) => queryMock(q, p)); } catch (e) { rolledBack = true; throw e; }
  },
}));
vi.mock('../cdp-identity', () => ({ identifyCustomer: vi.fn(async () => ({ customerId: 'c1', linkId: 'l1', wasCreated: false, wasMerged: false })) }));
const trackMock = vi.fn();
vi.mock('../cdp-events', async (importOriginal) => ({ ...(await importOriginal<any>()), trackOrderEvent: (...a: any[]) => trackMock(...a) }));

import { syncOrder } from '../cdp-orders';

const CO = '11111111-1111-4111-8111-111111111111';
const base = { source: 'woocommerce', orderId: 'shop.example:1', externalId: 'shop.example:9', phone: '01000000000', totalAmount: 1000, orderedAt: '2026-09-18T01:00:00.000Z' };

type Handler = (sql: string, params: any[]) => any;
function setDb(h: Handler) {
  queryMock.mockImplementation(async (q: any, p: any[]) => h(String(q), p || []));
}
const texts = () => queryMock.mock.calls.map((c) => String(c[0]));
const idx = (re: RegExp) => texts().findIndex((t) => re.test(t));
const RFM_ADD = /UPDATE customers SET\s+total_purchase_amount = COALESCE\(total_purchase_amount, 0\) \+ \$2/;
const RFM_SUB = /UPDATE customers c SET\s+total_purchase_amount = GREATEST\(COALESCE\(c\.total_purchase_amount, 0\) - \$2, 0\)/;   // ★1028 M21 되돌림 = 최근 구매 칸도 같은 문장
const SELECT_EXISTING = (sql: string) => sql.startsWith('SELECT') && sql.includes("event_name IN ('purchase', 'order_placed')");

beforeEach(() => { queryMock.mockReset(); trackMock.mockReset(); rolledBack = false; });

describe('새 주문 결제 확정', () => {
  it('표식을 실은 purchase 기록이 매출 반영보다 먼저다(같은 트랜잭션 연결)', async () => {
    const order: string[] = [];
    trackMock.mockImplementation(async (_run: any, _c: string, input: any) => { order.push('track'); expect(input.name).toBe('purchase'); expect(input.properties.revenue_applied).toBe(true); return { eventId: 'e-new' }; });
    setDb((sql) => { if (RFM_ADD.test(sql)) order.push('rfm'); return { rows: [], rowCount: 1 }; });
    await syncOrder(CO, { ...base, status: 'paid' } as any);
    expect(order).toEqual(['track', 'rfm']);
  });

  it('이벤트 기록이 실패하면 매출을 더하지 않고 오류를 올린다(웹훅 재시도)', async () => {
    trackMock.mockRejectedValue(new Error('insert failed'));
    setDb(() => ({ rows: [], rowCount: 1 }));
    await expect(syncOrder(CO, { ...base, status: 'paid' } as any)).rejects.toThrow();
    expect(idx(RFM_ADD)).toBe(-1);
  });

  it('매출 반영이 실패하면 트랜잭션이 롤백된다(표식 되돌림 문장 0 · 오류를 올린다)', async () => {
    trackMock.mockResolvedValue({ eventId: 'e-new' });
    setDb((sql) => { if (RFM_ADD.test(sql)) throw new Error('rfm failed'); return { rows: [], rowCount: 1 }; });
    await expect(syncOrder(CO, { ...base, status: 'paid' } as any)).rejects.toThrow('rfm failed');
    expect(rolledBack).toBe(true);
    expect(texts().some((t) => t.includes("jsonb_build_object('revenue_applied', false)"))).toBe(false);
  });
});

describe('큰 주문(상품 목록이 이벤트 속성 한도를 넘음)', () => {
  it('상품 목록을 빼고 표식을 실어 기록한다(기록이 매번 실패해 매출이 영영 안 들어가는 것 방지)', async () => {
    const items = Array.from({ length: 400 }, (_, i) => ({ productId: `p${i}`, productName: '가'.repeat(20), price: 1000, quantity: 1 }));
    trackMock.mockResolvedValue({ eventId: 'e-big' });
    setDb(() => ({ rows: [], rowCount: 1 }));
    await syncOrder(CO, { ...base, status: 'paid', items, itemCount: 400 } as any);
    const props = trackMock.mock.calls[0][2].properties;
    expect(props.items).toBeUndefined();
    expect(props.item_count).toBe(400);
    expect(props.revenue_applied).toBe(true);
    expect(props.items_omitted).toBe(true);
    expect(idx(RFM_ADD)).toBeGreaterThan(-1);
  });

  it('작은 주문은 상품 목록을 그대로 싣는다', async () => {
    trackMock.mockResolvedValue({ eventId: 'e-s' });
    setDb(() => ({ rows: [], rowCount: 1 }));
    await syncOrder(CO, { ...base, status: 'paid', items: [{ productId: 'p1', quantity: 1 }] } as any);
    expect(trackMock.mock.calls[0][2].properties.items).toEqual([{ productId: 'p1', quantity: 1 }]);
  });
});

describe('기존 이벤트(보류 → 결제)', () => {
  const pending = { id: 'e1', event_name: 'order_placed', properties: { order_id: 'shop.example:1', status: 'pending', total_amount: 1000, src_at: '2026-09-18T01:00:00.000Z' } };
  const later = { ...base, srcAt: '2026-09-18T02:00:00.000Z' };

  it('조건부 선점이 매출 반영보다 먼저이고, 선점 0행이면 더하지 않는다(= 옛 스냅숏 · stale)', async () => {
    setDb((sql) => {
      if (SELECT_EXISTING(sql)) return { rows: [pending] };
      if (sql.includes("jsonb_build_object('revenue_applied', true")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const r = await syncOrder(CO, { ...later, status: 'paid' } as any);
    const claim = idx(/jsonb_build_object\('revenue_applied', true/);
    expect(claim).toBeGreaterThan(-1);
    expect(texts()[claim]).toContain("COALESCE(properties->>'revenue_applied', '') <> 'true'");
    expect(texts()[claim]).toContain('RETURNING id');
    expect(idx(RFM_ADD)).toBe(-1);
    expect(r.stale).toBe(true);
  });

  it('선점하면 그 뒤에 더한다', async () => {
    setDb((sql) => {
      if (SELECT_EXISTING(sql)) return { rows: [pending] };
      if (sql.includes("jsonb_build_object('revenue_applied', true")) return { rows: [{ id: 'e1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await syncOrder(CO, { ...later, status: 'paid' } as any);
    expect(idx(RFM_ADD)).toBeGreaterThan(idx(/jsonb_build_object\('revenue_applied', true/));
  });
});

describe('취소 차감', () => {
  const applied = { id: 'e2', event_name: 'purchase', properties: { order_id: 'shop.example:1', status: 'paid', total_amount: 1000, revenue_applied: true, src_at: '2026-09-18T01:00:00.000Z' } };
  const later = { ...base, srcAt: '2026-09-18T02:00:00.000Z' };

  it('차감 표식 선점이 차감보다 먼저 · 0행이면 빼지 않는다', async () => {
    setDb((sql) => {
      if (SELECT_EXISTING(sql)) return { rows: [applied] };
      if (sql.includes("jsonb_build_object('revenue_reversed', true")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    await syncOrder(CO, { ...later, status: 'cancelled' } as any);
    expect(texts()[idx(/jsonb_build_object\('revenue_reversed', true/)]).toContain("COALESCE(properties->>'revenue_reversed', '') <> 'true'");
    expect(idx(RFM_SUB)).toBe(-1);
  });

  it('차감이 실패하면 트랜잭션이 롤백된다(차감 표식 되돌림 문장 0)', async () => {
    setDb((sql) => {
      if (SELECT_EXISTING(sql)) return { rows: [applied] };
      if (sql.includes("jsonb_build_object('revenue_reversed', true")) return { rows: [{ id: 'e2' }], rowCount: 1 };
      if (RFM_SUB.test(sql)) throw new Error('sub failed');
      return { rows: [], rowCount: 1 };
    });
    await expect(syncOrder(CO, { ...later, status: 'cancelled' } as any)).rejects.toThrow('sub failed');
    expect(rolledBack).toBe(true);
    expect(idx(/jsonb_build_object\('revenue_reversed', false\)/)).toBe(-1);
  });
});

describe('같은 주문 직렬화', () => {
  it('주문 단위 공용 잠금 안에서 · 한 트랜잭션으로 조회·판정·반영한다', () => {
    const src = readFileSync(join(__dirname, '..', 'cdp-orders.ts'), 'utf8');
    const iLock = src.indexOf("withKeyedLock('cdp-order',");
    expect(iLock).toBeGreaterThan(-1);
    expect(src.indexOf('withTransaction(', iLock)).toBeGreaterThan(iLock);
    expect(iLock).toBeLessThan(src.indexOf('const existingRes = await run('));
    expect(src).not.toContain('releaseMarker');
  });
});
