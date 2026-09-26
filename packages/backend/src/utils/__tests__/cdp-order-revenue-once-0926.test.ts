/**
 * 주문 매출(RFM)은 한 주문에 한 번만 더하고 한 번만 뺀다 (★2026-09-26 한줄로 V2 R1-34)
 *
 * 옛: 매출을 먼저 더하고 표식(purchase 이벤트 revenue_applied)을 뒤에 남겼으며 그 기록 실패를 삼켰다.
 *     표식이 안 남으면 같은 주문의 상태 변경 웹훅이 다시 "처음 결제"로 판정해 매출이 두 번 더해졌다.
 *     같은 주문 웹훅 두 개가 동시에 오면 둘 다 기존 이벤트를 못 보고 둘 다 더할 수 있었다.
 * 처방: 표식 먼저(선점) → 매출 반영. 매출 반영이 실패하면 표식을 명시적으로 되돌리고(false) 오류를 올린다(재시도 가능).
 *   기존 이벤트 표식은 조건부 UPDATE로 선점한다(이미 표식이 있으면 0행 = 더하지 않는다).
 *   새 주문은 표식을 실은 이벤트 기록이 먼저다(기록 실패 = 매출 미반영 + 오류 → 웹훅 재시도).
 *   같은 주문은 공용 잠금 CT로 한 줄로 선다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('../../config/database', () => ({ query: (...a: any[]) => queryMock(...a) }));
vi.mock('../cdp-identity', () => ({ identifyCustomer: vi.fn(async () => ({ customerId: 'c1', linkId: 'l1', wasCreated: false, wasMerged: false })) }));
const trackMock = vi.fn();
vi.mock('../cdp-events', async (importOriginal) => ({ ...(await importOriginal<any>()), trackEvent: (...a: any[]) => trackMock(...a) }));

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
const RFM_SUB = /UPDATE customers SET\s+total_purchase_amount = GREATEST\(COALESCE\(total_purchase_amount, 0\) - \$2, 0\)/;

beforeEach(() => { queryMock.mockReset(); trackMock.mockReset(); });

describe('새 주문 결제 확정', () => {
  it('표식을 실은 이벤트 기록이 매출 반영보다 먼저다', async () => {
    const order: string[] = [];
    trackMock.mockImplementation(async (_c: string, input: any) => { order.push('track'); expect(input.properties.revenue_applied).toBe(true); return { eventId: 'e-new' }; });
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

  it('매출 반영이 실패하면 새 이벤트 표식을 false로 되돌리고 오류를 올린다', async () => {
    trackMock.mockResolvedValue({ eventId: 'e-new' });
    setDb((sql) => { if (RFM_ADD.test(sql)) throw new Error('rfm failed'); return { rows: [], rowCount: 1 }; });
    await expect(syncOrder(CO, { ...base, status: 'paid' } as any)).rejects.toThrow('rfm failed');
    const rel = queryMock.mock.calls.find((c) => String(c[0]).includes("jsonb_build_object('revenue_applied', false)"));
    expect(rel).toBeTruthy();
    expect(rel![1][0]).toBe('e-new');
  });
});

describe('큰 주문(상품 목록이 이벤트 속성 한도를 넘음)', () => {
  it('상품 목록을 빼고 표식을 실어 기록한다(기록이 매번 실패해 매출이 영영 안 들어가는 것 방지)', async () => {
    const items = Array.from({ length: 400 }, (_, i) => ({ productId: `p${i}`, productName: '가'.repeat(20), price: 1000, quantity: 1 }));
    trackMock.mockResolvedValue({ eventId: 'e-big' });
    setDb(() => ({ rows: [], rowCount: 1 }));
    await syncOrder(CO, { ...base, status: 'paid', items, itemCount: 400 } as any);
    const props = trackMock.mock.calls[0][1].properties;
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
    expect(trackMock.mock.calls[0][1].properties.items).toEqual([{ productId: 'p1', quantity: 1 }]);
  });
});

describe('기존 이벤트(보류 → 결제)', () => {
  const pending = { id: 'e1', properties: { order_id: 'shop.example:1', status: 'pending', total_amount: 1000 } };

  it('조건부 선점이 매출 반영보다 먼저이고, 선점 0행이면 더하지 않는다', async () => {
    setDb((sql) => {
      if (sql.includes("event_name = 'purchase'") && sql.startsWith('SELECT')) return { rows: [pending] };
      if (sql.includes("jsonb_build_object('revenue_applied', true")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    await syncOrder(CO, { ...base, status: 'paid' } as any);
    const claim = idx(/jsonb_build_object\('revenue_applied', true/);
    expect(claim).toBeGreaterThan(-1);
    expect(texts()[claim]).toContain("COALESCE(properties->>'revenue_applied', '') <> 'true'");
    expect(texts()[claim]).toContain('RETURNING id');
    expect(idx(RFM_ADD)).toBe(-1);
  });

  it('선점하면 그 뒤에 더한다', async () => {
    setDb((sql) => {
      if (sql.includes("event_name = 'purchase'") && sql.startsWith('SELECT')) return { rows: [pending] };
      if (sql.includes("jsonb_build_object('revenue_applied', true")) return { rows: [{ id: 'e1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await syncOrder(CO, { ...base, status: 'paid' } as any);
    expect(idx(RFM_ADD)).toBeGreaterThan(idx(/jsonb_build_object\('revenue_applied', true/));
  });
});

describe('취소 차감', () => {
  const applied = { id: 'e2', properties: { order_id: 'shop.example:1', status: 'paid', total_amount: 1000, revenue_applied: true } };

  it('차감 표식 선점이 차감보다 먼저 · 0행이면 빼지 않는다', async () => {
    setDb((sql) => {
      if (sql.includes("event_name = 'purchase'") && sql.startsWith('SELECT')) return { rows: [applied] };
      if (sql.includes("jsonb_build_object('revenue_reversed', true")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    await syncOrder(CO, { ...base, status: 'cancelled' } as any);
    expect(texts()[idx(/jsonb_build_object\('revenue_reversed', true/)]).toContain("COALESCE(properties->>'revenue_reversed', '') <> 'true'");
    expect(idx(RFM_SUB)).toBe(-1);
  });

  it('차감이 실패하면 차감 표식을 false로 되돌린다', async () => {
    setDb((sql) => {
      if (sql.includes("event_name = 'purchase'") && sql.startsWith('SELECT')) return { rows: [applied] };
      if (sql.includes("jsonb_build_object('revenue_reversed', true")) return { rows: [{ id: 'e2' }], rowCount: 1 };
      if (RFM_SUB.test(sql)) throw new Error('sub failed');
      return { rows: [], rowCount: 1 };
    });
    await expect(syncOrder(CO, { ...base, status: 'cancelled' } as any)).rejects.toThrow('sub failed');
    expect(idx(/jsonb_build_object\('revenue_reversed', false\)/)).toBeGreaterThan(-1);
  });
});

describe('같은 주문 직렬화', () => {
  it('주문 단위 공용 잠금 안에서 조회·판정·반영한다', () => {
    const src = readFileSync(join(__dirname, '..', 'cdp-orders.ts'), 'utf8');
    const iLock = src.indexOf("withKeyedLock('cdp-order',");
    expect(iLock).toBeGreaterThan(-1);
    expect(iLock).toBeLessThan(src.indexOf('const existingRes = await query('));
  });
});
