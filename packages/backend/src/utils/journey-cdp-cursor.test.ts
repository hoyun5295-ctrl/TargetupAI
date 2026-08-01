import { describe, test, expect } from 'vitest';
import { planCdpCursorBatch, buildEntryPropsArray, resolveCdpCursorEventName } from './journey-cdp-cursor';

const winEnd = new Date('2026-06-22T10:00:00Z');

/** 도착 시각과 발생 시각을 따로 준다 — 배치로 늦게 올라온 데이터를 표현하려면 둘이 달라야 한다. */
const row = (customerId: string, eventId: string, created: string, occurred: string, properties?: any) => ({
  customerId, eventId, createdAt: new Date(created), occurredAt: new Date(occurred), properties,
});

describe('planCdpCursorBatch — properties 보존', () => {
  test('customerId별 첫 등장 properties를 propertiesByCustomer에 보존', () => {
    const rows = [
      row('c1', 'e1', '2026-06-22T01:00:00Z', '2026-06-21T01:00:00Z', { order_no: 'A1' }),
      row('c1', 'e2', '2026-06-22T02:00:00Z', '2026-06-21T02:00:00Z', { order_no: 'A2' }),
      row('c2', 'e3', '2026-06-22T03:00:00Z', '2026-06-21T03:00:00Z', { order_no: 'B1' }),
    ];
    const r = planCdpCursorBatch(rows, 1000, winEnd);
    expect(r.ids).toEqual(['c1', 'c2']);
    expect(r.propertiesByCustomer).toEqual({ c1: { order_no: 'A1' }, c2: { order_no: 'B1' } });
  });

  test('properties 없는 행은 propertiesByCustomer에서 빠짐 (ids는 유지)', () => {
    const r = planCdpCursorBatch([row('c1', 'e1', '2026-06-22T01:00:00Z', '2026-06-21T01:00:00Z')], 1000, winEnd);
    expect(r.ids).toEqual(['c1']);
    expect(r.propertiesByCustomer).toEqual({});
  });
});

// ★ 2026-08-01 §11-3 — 커서 축을 도착(created_at)으로 옮겼다. 커서는 (시각, 이벤트 id) 쌍이다.
describe('planCdpCursorBatch — 커서 전진', () => {
  test('절단 시 chunk까지만 처리하고 마지막 처리 행에서 멈춘다', () => {
    const rows = [
      row('c1', 'e1', '2026-06-22T01:00:00Z', '2026-06-21T01:00:00Z', { order_no: 'A1' }),
      row('c2', 'e2', '2026-06-22T02:00:00Z', '2026-06-21T02:00:00Z', { order_no: 'B1' }),
      row('c3', 'e3', '2026-06-22T03:00:00Z', '2026-06-21T03:00:00Z', { order_no: 'C1' }),
    ];
    const r = planCdpCursorBatch(rows, 2, winEnd);
    expect(r.ids).toEqual(['c1', 'c2']);
    expect(r.truncated).toBe(true);
    expect(r.newCursor).toEqual({ at: new Date('2026-06-22T02:00:00Z'), eventId: 'e2' });
  });

  test('절단이 없어도 실제로 본 마지막 행까지만 전진한다 — 못 본 구간을 건너뛰지 않는다', () => {
    const rows = [row('c1', 'e1', '2026-06-22T01:00:00Z', '2026-06-21T01:00:00Z')];
    const r = planCdpCursorBatch(rows, 1000, winEnd);
    expect(r.truncated).toBe(false);
    expect(r.newCursor).toEqual({ at: new Date('2026-06-22T01:00:00Z'), eventId: 'e1' });
  });

  test('행이 없으면 그 창을 다 소비한 것이므로 windowEnd로 전진한다', () => {
    const r = planCdpCursorBatch([], 1000, winEnd);
    expect(r.ids).toEqual([]);
    expect(r.newCursor).toEqual({ at: winEnd, eventId: null });
  });

  test('도착 시각이 같아도 이벤트 id로 이어진다 — 배치 적재는 한 묶음에 같은 시각을 찍는다', () => {
    const same = '2026-06-22T05:00:00Z';
    const rows = [
      row('c1', 'e1', same, '2026-06-21T01:00:00Z'),
      row('c2', 'e2', same, '2026-06-21T02:00:00Z'),
      row('c3', 'e3', same, '2026-06-21T03:00:00Z'),
    ];
    const r = planCdpCursorBatch(rows, 2, winEnd);
    // 시각만으로는 남은 e3를 가릴 수 없다. 커서가 e2를 들고 있어야 다음 회차가 e3부터 잇는다.
    expect(r.newCursor).toEqual({ at: new Date(same), eventId: 'e2' });
  });

  test('옛 축(occurred_at)에서는 커서 값이 발생 시각이다 — 컬럼 미마이그레이션 환경 호환', () => {
    const rows = [row('c1', 'e1', '2026-06-22T09:00:00Z', '2026-06-20T01:00:00Z')];
    const r = planCdpCursorBatch(rows, 1000, winEnd, 'occurred_at');
    expect(r.newCursor.at).toEqual(new Date('2026-06-20T01:00:00Z'));
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
