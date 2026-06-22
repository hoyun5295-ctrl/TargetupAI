import { describe, test, expect } from 'vitest';
import { planCdpCursorBatch } from './journey-cdp-cursor';

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
