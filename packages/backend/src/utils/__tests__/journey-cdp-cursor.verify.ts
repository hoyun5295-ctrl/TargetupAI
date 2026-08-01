/**
 * journey-cdp-cursor.verify.ts — cdp 커서 배치 플래너(순수) 검증
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/journey-cdp-cursor.verify.ts
 *
 * ★ 2026-08-01 §11-3 — 커서 축을 발생(occurred_at) → 도착(created_at)으로 전환.
 *   배치로 늦게 도착한 데이터(매장 구매)와 익명→회원 소급 연결분이 커서 뒤에 떨어져
 *   영영 안 잡히던 구멍을 닫는다. 커서는 (시각, 이벤트 id) 쌍이다 — 배치 적재는 한 묶음에 같은 시각을 찍는다.
 */
import assert from 'node:assert';
import { planCdpCursorBatch } from '../journey-cdp-cursor';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

const t = (s: string) => new Date(s);
const winEnd = t('2026-06-05T10:00:00Z');
/** 도착과 발생을 따로 준다 — 늦게 올라온 데이터를 표현하려면 둘이 달라야 한다. */
const row = (customerId: string, eventId: string, created: string, occurred: string, properties?: any) => ({
  customerId, eventId, createdAt: t(created), occurredAt: t(occurred), properties,
});

console.log('[planCdpCursorBatch] 전진 규칙 — 실제로 본 마지막 행까지만');
{
  const rows = [
    row('a', 'e1', '2026-06-05T09:00:00Z', '2026-06-03T09:00:00Z'),
    row('b', 'e2', '2026-06-05T09:30:00Z', '2026-06-02T09:30:00Z'),
  ];
  const r = planCdpCursorBatch(rows, 1000, winEnd);
  ok('truncated=false', () => assert.strictEqual(r.truncated, false));
  ok('ids = [a,b]', () => assert.deepStrictEqual(r.ids, ['a', 'b']));
  ok('커서 = 마지막 행(도착 시각 + 이벤트 id)', () =>
    assert.deepStrictEqual(r.newCursor, { at: t('2026-06-05T09:30:00Z'), eventId: 'e2' }));
}

console.log('[planCdpCursorBatch] 중복 고객 제거(순서 유지)');
{
  const rows = [
    row('a', 'e1', '2026-06-05T09:00:00Z', '2026-06-03T01:00:00Z', { order_no: 'A1' }),
    row('a', 'e2', '2026-06-05T09:10:00Z', '2026-06-03T02:00:00Z', { order_no: 'A2' }),
    row('b', 'e3', '2026-06-05T09:20:00Z', '2026-06-03T03:00:00Z', { order_no: 'B1' }),
  ];
  const r = planCdpCursorBatch(rows, 1000, winEnd);
  ok('ids = [a,b] (중복 a 1회)', () => assert.deepStrictEqual(r.ids, ['a', 'b']));
  ok('첫 등장 properties 보존', () =>
    assert.deepStrictEqual(r.propertiesByCustomer, { a: { order_no: 'A1' }, b: { order_no: 'B1' } }));
}

console.log('[planCdpCursorBatch] 절단 — chunk까지만, 커서=마지막 처리 행');
{
  const rows = [
    row('a', 'e1', '2026-06-05T09:00:00Z', '2026-06-03T01:00:00Z'),
    row('b', 'e2', '2026-06-05T09:01:00Z', '2026-06-03T02:00:00Z'),
    row('c', 'e3', '2026-06-05T09:02:00Z', '2026-06-03T03:00:00Z'),  // chunk(2) 초과 → 이번엔 미처리
  ];
  const r = planCdpCursorBatch(rows, 2, winEnd);
  ok('truncated=true', () => assert.strictEqual(r.truncated, true));
  ok('ids = [a,b] (chunk 2까지만)', () => assert.deepStrictEqual(r.ids, ['a', 'b']));
  ok('커서 = b 행(c는 다음 회차)', () =>
    assert.deepStrictEqual(r.newCursor, { at: t('2026-06-05T09:01:00Z'), eventId: 'e2' }));
}

console.log('[planCdpCursorBatch] 같은 도착 시각 — 이벤트 id로 이어진다');
{
  const same = '2026-06-05T09:05:00Z';
  const rows = [
    row('a', 'e1', same, '2026-06-03T01:00:00Z'),
    row('b', 'e2', same, '2026-06-03T02:00:00Z'),
    row('c', 'e3', same, '2026-06-03T03:00:00Z'),
  ];
  const r = planCdpCursorBatch(rows, 2, winEnd);
  ok('시각만으로는 못 가르는 나머지를 id가 잇는다', () =>
    assert.deepStrictEqual(r.newCursor, { at: t(same), eventId: 'e2' }));
}

console.log('[planCdpCursorBatch] 빈 윈도우 — 커서=windowEnd');
{
  const r = planCdpCursorBatch([], 1000, winEnd);
  ok('ids = []', () => assert.deepStrictEqual(r.ids, []));
  ok('truncated=false', () => assert.strictEqual(r.truncated, false));
  ok('커서 = windowEnd, 타이 보조 없음', () =>
    assert.deepStrictEqual(r.newCursor, { at: winEnd, eventId: null }));
}

console.log('[planCdpCursorBatch] 옛 축 호환 — 컬럼 미마이그레이션 환경');
{
  const r = planCdpCursorBatch(
    [row('a', 'e1', '2026-06-05T09:00:00Z', '2026-06-01T01:00:00Z')], 1000, winEnd, 'occurred_at',
  );
  ok('occurred_at 축이면 커서 값이 발생 시각', () =>
    assert.deepStrictEqual(r.newCursor.at, t('2026-06-01T01:00:00Z')));
}

console.log(`\n${passed} assertions passed`);
