/**
 * 몰 수신부 정합 (2026-10-04 싱크·자사몰 전수점검 C5 · C6 · I2~I5 · W1)
 *
 * - C5 카페24 주문 상태 코드(공식 코드표) → 적재 CT 상태. 결제 뒤 진행(N10~N50) = paid · 취소완료 = cancelled · 반품완료 = refunded.
 * - C6 카페24 웹훅: 인증된 요청인데 표에 없는 이벤트 번호 = 200 무시(400 이면 카페24 실패 집계 → 수신 자동 차단).
 * - I2 아임웹 탈퇴 = 연결 고객 수신동의 철회 · I3 취소·환불 = 매출 차감 · I4 입금 완료 = paid · I5 장바구니 = 표준 cart_add.
 * - W1 처리 중 끊긴 'received' 행도 재처리 · 실패하면 failed 로 · 재처리를 다 쓰면 알림.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const q = vi.fn(async (..._a: any[]) => ({ rows: [] as any[], rowCount: 0 }));
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (q as any)(...a), pool: { connect: vi.fn() } }));
vi.mock('../cdp-identity', () => ({
  identifyCustomer: vi.fn(async () => ({ customerId: 'c', linkId: 'l', wasCreated: false, wasMerged: false })),
  withdrawMemberConsent: vi.fn(async () => 1),
}));
vi.mock('../cdp-orders', () => ({ syncOrder: vi.fn(async () => ({ customerId: 'c', linkId: 'l', wasCustomerCreated: false, rfmUpdated: true })) }));
vi.mock('../cdp-events', () => ({ trackEvent: vi.fn(async () => ({ eventId: 'e', identityLinkId: 'l', customerId: 'c' })) }));
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => true) }));
vi.mock('../../middlewares/auth', () => ({ authenticate: (_r: any, _s: any, n: any) => n() }));

import { mapCafe24OrderStatus } from '../cafe24-client';
import { imwebAdapter } from '../imweb-client';
import { withdrawMemberConsent } from '../cdp-identity';
import { syncOrder } from '../cdp-orders';
import { trackEvent } from '../cdp-events';
import { sendSystemAlert } from '../system-alert';
import { runCdpWebhookRetryPass } from '../cdp-webhook-retry-worker';
import * as registry from '../provider-registry';

const CO = '00000000-0000-0000-0000-0000000000c1';

beforeEach(() => {
  q.mockReset();
  q.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  vi.mocked(withdrawMemberConsent).mockClear();
  vi.mocked(syncOrder).mockClear();
  vi.mocked(trackEvent).mockClear();
  vi.mocked(sendSystemAlert).mockClear();
});

describe('C5 카페24 주문 상태 코드', () => {
  it('공식 코드표대로 옮긴다 · 모르는 값은 원문(= 매출 변화 없음)', () => {
    for (const c of ['N10', 'N20', 'N21', 'N22', 'N30', 'N40', 'N50', 'n10']) expect(mapCafe24OrderStatus(c), c).toBe('paid');
    for (const c of ['C40', 'C41', 'C42', 'C43', 'C47', 'C48', 'C49']) expect(mapCafe24OrderStatus(c), c).toBe('cancelled');
    for (const c of ['R40', 'R41', 'R42', 'R43']) expect(mapCafe24OrderStatus(c), c).toBe('refunded');
    expect(mapCafe24OrderStatus('N00')).toBe('N00'); // 입금전 = 매출 아님
    expect(mapCafe24OrderStatus('C00')).toBe('C00'); // 취소 신청(진행 중) = 아직 차감 아님
    expect(mapCafe24OrderStatus('E40')).toBe('E40'); // 교환 = 매출 그대로
    expect(mapCafe24OrderStatus('completed')).toBe('completed');
    expect(mapCafe24OrderStatus(undefined)).toBe('pending');
  });
});

describe('I2~I5 아임웹 수신부', () => {
  it('탈퇴 = 그 회원 연결 고객의 수신동의 철회 + 기록 이벤트', async () => {
    await imwebAdapter.processWebhookEvent!(CO, 'END_USER_WITHDRAWAL', { memberUid: 'u-1' });
    expect(withdrawMemberConsent).toHaveBeenCalledWith(CO, 'imweb', 'u-1');
  });
  it('장바구니 = 표준 이름 cart_add', async () => {
    await imwebAdapter.processWebhookEvent!(CO, 'END_USER_CART_ADD', { memberUid: 'u-1', prodNo: 'P1' });
    expect(vi.mocked(trackEvent).mock.calls[0][1]).toMatchObject({ eventName: 'cart_add' });
  });
  it('입금 완료 = paid', async () => {
    await imwebAdapter.processWebhookEvent!(CO, 'ORDER_DEPOSIT_COMPLETE', { orderNo: 'O1', memberUid: 'u-1', totalPrice: 1000, orderTime: '2026-10-04T10:00:00+09:00' });
    expect(vi.mocked(syncOrder).mock.calls[0][1]).toMatchObject({ status: 'paid', orderId: 'O1' });
  });
  it('취소 완료 = 매출 차감(cancelled) · 환불 = refunded · 같은 고객 식별 규칙', async () => {
    await imwebAdapter.processWebhookEvent!(CO, 'ORDER_CANCEL_COMPLETE', { orderNo: 'O1', memberUid: 'u-1' });
    await imwebAdapter.processWebhookEvent!(CO, 'ORDER_REFUND', { orderNo: 'O2', call: '01000000001' });
    expect(vi.mocked(syncOrder).mock.calls[0][1]).toMatchObject({ status: 'cancelled', orderId: 'O1', externalId: 'u-1' });
    expect(vi.mocked(syncOrder).mock.calls[1][1]).toMatchObject({ status: 'refunded', orderId: 'O2', externalId: 'guest:01000000001' });
  });
  it('회원도 번호도 없는 취소 = 고객을 지어내지 않는다(차감 생략 · 예외 없음)', async () => {
    await expect(imwebAdapter.processWebhookEvent!(CO, 'ORDER_CANCEL_COMPLETE', { orderNo: 'O3' })).resolves.toBeUndefined();
    expect(syncOrder).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe('W1 웹훅 재처리', () => {
  it("'received' 로 멈춘 행도 집는다 · 실패하면 failed 로 · 다 쓰면 알림", async () => {
    vi.spyOn(registry, 'getProvider').mockReturnValue({
      processWebhookEvent: vi.fn(async () => { throw new Error('boom'); }),
    } as any);
    q.mockImplementation(async (sql: string) => {
      if (/SELECT id, company_id, source, webhook_event, payload, retry_count/.test(sql)) {
        return { rows: [{ id: 'd1', company_id: CO, source: 'cafe24', webhook_event: 'order.created', payload: { resource: {} }, retry_count: 0 }], rowCount: 1 };
      }
      if (/COUNT\(\*\)::int AS n FROM cdp_webhook_deliveries/.test(sql)) return { rows: [{ n: 2 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await runCdpWebhookRetryPass();
    const select = q.mock.calls.find((c) => /SELECT id, company_id, source/.test(String(c[0])))![0] as string;
    expect(select).toMatch(/status = 'received' AND created_at < NOW\(\) - INTERVAL '10 minutes'/);
    const failUpdate = q.mock.calls.find((c) => /SET status = 'failed',\s*retry_count = retry_count \+ 1/.test(String(c[0])));
    expect(failUpdate).toBeTruthy();
    expect(sendSystemAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupKey: 'cdp-webhook-exhausted' }));
  });
});

describe('C6 카페24 웹훅 — 표에 없는 이벤트 번호', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    process.env.CAFE24_WEBHOOK_API_KEY = 'cafe24-test-key';
    const express = (await import('express')).default;
    const router = (await import('../../routes/cafe24')).default;
    const app = express();
    app.use('/api/cafe24', router);
    server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cafe24`;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  const send = (headers: Record<string, string>) => fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ event_no: 99999, resource: { mall_id: 'testmall' } }),
  });

  it('인증된 요청 = 200 무시(카페24 실패 집계에 쌓지 않는다)', async () => {
    const r = await send({ 'X-API-Key': 'cafe24-test-key' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ success: true, ignored: true });
  });
  it('인증 안 된 요청 = 400 (종전)', async () => {
    const r = await send({ 'X-API-Key': 'wrong' });
    expect(r.status).toBe(400);
  });
});
