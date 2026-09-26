/**
 * 카페24 웹훅 멱등 키 계약 (★2026-09-25 한줄로 전수점검 C-12)
 *
 * 카페24 본문 { event_no, resource }의 event_no는 이벤트 **종류** 번호다(90023 = 주문 접수).
 * 이를 전송 고유값으로 쓰면 키가 늘 `order.created:evt:90023`이라 회사마다 종류별 첫 1건만 처리되고 나머지가 버려졌다.
 */
import { describe, it, expect } from 'vitest';
import { buildWebhookIdempotencyKey } from '../cdp-idempotency';

const body = (orderId: string, extra: Record<string, any> = {}) => ({ event_no: 90023, resource: { mall_id: 'm', order_id: orderId, ...extra } });

describe('카페24 웹훅 멱등 키', () => {
  it('같은 종류의 다른 주문은 다른 키', () => {
    const a = buildWebhookIdempotencyKey('order.created', body('O1').resource, body('O1'));
    const b = buildWebhookIdempotencyKey('order.created', body('O2').resource, body('O2'));
    expect(a).not.toBe(b);
    expect(a).not.toContain('evt:90023');
  });

  it('같은 주문의 상태가 바뀐 갱신은 다른 키', () => {
    const a = buildWebhookIdempotencyKey('order.updated', body('O1', { status: 'N10' }).resource, body('O1', { status: 'N10' }));
    const b = buildWebhookIdempotencyKey('order.updated', body('O1', { status: 'N20' }).resource, body('O1', { status: 'N20' }));
    expect(a).not.toBe(b);
  });

  it('똑같은 재전송은 같은 키(재시도 차단은 유지)', () => {
    const a = buildWebhookIdempotencyKey('order.created', body('O1').resource, body('O1'));
    const b = buildWebhookIdempotencyKey('order.created', body('O1').resource, body('O1'));
    expect(a).toBe(b);
  });

  it('진짜 전송 고유값(event_id)은 여전히 1순위', () => {
    expect(buildWebhookIdempotencyKey('order.created', { order_id: 'O1' }, { event_id: 'E-77' })).toBe('order.created:evt:E-77');
  });
});
