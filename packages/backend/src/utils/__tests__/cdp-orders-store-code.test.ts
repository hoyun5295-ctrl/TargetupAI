/**
 * cdp-orders-store-code.test.ts — 주문 적재가 분류코드를 식별 단계로 넘긴다 (설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-3)
 *  storeCode 생략 = 식별 입력이 지금과 같다(캡처) · 전달 = 그대로 identifyCustomer 로.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }));
vi.mock('../cdp-identity', () => ({ identifyCustomer: vi.fn(async () => ({ customerId: 'c1', linkId: 'l1', wasCreated: false, wasMerged: false })) }));
// ★ 2026-09-26 R1-34 — 주문 CT가 이벤트 속성 검증(validateProperties)을 함께 쓴다: 실제 함수 + trackEvent만 목
vi.mock('../cdp-events', async (importOriginal) => ({ ...(await importOriginal<any>()), trackEvent: vi.fn(async () => ({})) }));

import { identifyCustomer } from '../cdp-identity';
import { syncOrder } from '../cdp-orders';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const identify = identifyCustomer as unknown as ReturnType<typeof vi.fn>;
const base = {
  source: 'woocommerce', orderId: 'iroirotokyo.net:100', externalId: 'iroirotokyo.net:9',
  phone: '01000000000', status: 'paid', totalAmount: 1000, orderedAt: '2026-09-18T01:00:00.000Z',
};

beforeEach(() => { identify.mockClear(); });

describe('syncOrder · 분류코드 전달', () => {
  it('storeCode 생략: 식별 입력이 지금과 같다(storeCode 키 없음)', async () => {
    await syncOrder(COMPANY, base as any);
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify.mock.calls[0][1]).toEqual({ source: 'woocommerce', externalId: 'iroirotokyo.net:9', email: undefined, phone: '01000000000', name: undefined });
    expect('storeCode' in identify.mock.calls[0][1]).toBe(false);
  });

  it('storeCode 전달: 식별 단계로 그대로 넘긴다', async () => {
    await syncOrder(COMPANY, { ...base, storeCode: 'IROIRO' } as any);
    expect(identify.mock.calls[0][1]).toMatchObject({ storeCode: 'IROIRO', externalId: 'iroirotokyo.net:9' });
  });
});
