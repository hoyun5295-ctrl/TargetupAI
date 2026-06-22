import { describe, test, expect } from 'vitest';
import { planCdpCursorBatch, buildEntryPropsArray, resolveCdpCursorEventName } from './journey-cdp-cursor';

const winEnd = new Date('2026-06-22T10:00:00Z');

describe('planCdpCursorBatch — properties 보존 (ids/cursor 로직 불변)', () => {
  test('customerId별 첫 등장 properties를 propertiesByCustomer에 보존', () => {
    const rows = [
      { customerId: 'c1', occurredAt: new Date('2026-06-22T01:00:00Z'), properties: { order_no: 'A1' } },
      { customerId: 'c1', occurredAt: new Date('2026-06-22T02:00:00Z'), properties: { order_no: 'A2' } },
      { customerId: 'c2', occurredAt: new Date('2026-06-22T03:00:00Z'), properties: { order_no: 'B1' } },
    ];
    const r = planCdpCursorBatch(rows, 1000, winEnd);
    expect(r.ids).toEqual(['c1', 'c2']);
    expect(r.propertiesByCustomer).toEqual({ c1: { order_no: 'A1' }, c2: { order_no: 'B1' } });
  });

  test('properties 없는 행은 propertiesByCustomer에서 빠짐 (ids는 유지)', () => {
    const rows = [
      { customerId: 'c1', occurredAt: new Date('2026-06-22T01:00:00Z') },
    ];
    const r = planCdpCursorBatch(rows, 1000, winEnd);
    expect(r.ids).toEqual(['c1']);
    expect(r.propertiesByCustomer).toEqual({});
  });

  test('절단 시 ids는 chunk까지, 커서는 마지막 처리 이벤트 시각 (기존 로직 회귀)', () => {
    const rows = [
      { customerId: 'c1', occurredAt: new Date('2026-06-22T01:00:00Z'), properties: { order_no: 'A1' } },
      { customerId: 'c2', occurredAt: new Date('2026-06-22T02:00:00Z'), properties: { order_no: 'B1' } },
      { customerId: 'c3', occurredAt: new Date('2026-06-22T03:00:00Z'), properties: { order_no: 'C1' } },
    ];
    const r = planCdpCursorBatch(rows, 2, winEnd);
    expect(r.ids).toEqual(['c1', 'c2']);
    expect(r.truncated).toBe(true);
    expect(r.newCursor).toEqual(new Date('2026-06-22T02:00:00Z'));
    expect(r.propertiesByCustomer).toEqual({ c1: { order_no: 'A1' }, c2: { order_no: 'B1' } });
  });
});

describe('buildEntryPropsArray — 진입 properties를 customerId 순서에 정렬 (enqueue INSERT용)', () => {
  test('id 순서대로 정렬 — 있으면 JSON 문자열, 없으면 null', () => {
    const arr = buildEntryPropsArray(['c1', 'c2', 'c3'], {
      c1: { product_name: '원피스' },
      c3: { product_name: '코트' },
    });
    expect(arr).toEqual([JSON.stringify({ product_name: '원피스' }), null, JSON.stringify({ product_name: '코트' })]);
  });

  test('propsByCustomer 미전달(타 트리거) — 전부 null (기존 동작 불변)', () => {
    const arr = buildEntryPropsArray(['c1', 'c2']);
    expect(arr).toEqual([null, null]);
  });

  test('빈 객체 properties는 null 취급 (빈 봉투 동봉 회피)', () => {
    const arr = buildEntryPropsArray(['c1'], { c1: {} });
    expect(arr).toEqual([null]);
  });
});

describe('resolveCdpCursorEventName — 커서 경로 트리거 판정 (단일 출처)', () => {
  test('구매·예약·배송(custom_order_shipped)은 커서 경로 — cdp_events.event_name 반환', () => {
    expect(resolveCdpCursorEventName('cdp.purchase')).toBe('purchase');
    expect(resolveCdpCursorEventName('cdp.reservation_created')).toBe('reservation_created');
    expect(resolveCdpCursorEventName('custom_order_shipped')).toBe('custom_order_shipped');
  });

  test('그 외 트리거는 커서 경로 아님 — null (enqueueCandidates 경로)', () => {
    expect(resolveCdpCursorEventName('cdp.cart_abandon')).toBeNull();
    expect(resolveCdpCursorEventName('customer.created')).toBeNull();
    expect(resolveCdpCursorEventName('customer.dormant')).toBeNull();
    expect(resolveCdpCursorEventName('custom')).toBeNull();
    expect(resolveCdpCursorEventName('')).toBeNull();
  });
});
