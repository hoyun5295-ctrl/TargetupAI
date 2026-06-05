/**
 * journey-cdp-cursor.verify.ts — cdp 커서 배치 플래너(순수) 검증
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/journey-cdp-cursor.verify.ts
 * (DB import 0. 한 윈도우 이벤트가 chunk를 넘으면 절단하되, 커서를 마지막 처리 이벤트 시각까지만 전진시켜
 *  나머지를 다음 회차에 빠짐없이 처리하는지 검증 — LIMIT로 이벤트를 영구 누락하던 문제 정정.)
 */
import assert from 'node:assert';
import { planCdpCursorBatch } from '../journey-cdp-cursor';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

const t = (s: string) => new Date(s);
const winEnd = t('2026-06-05T10:00:00Z');

console.log('[planCdpCursorBatch] 절단 없음 — 전체 처리 + 커서=windowEnd');
{
  const rows = [
    { customerId: 'a', occurredAt: t('2026-06-05T09:00:00Z') },
    { customerId: 'b', occurredAt: t('2026-06-05T09:30:00Z') },
  ];
  const r = planCdpCursorBatch(rows, 1000, winEnd);
  ok('truncated=false', () => assert.strictEqual(r.truncated, false));
  ok('ids = [a,b]', () => assert.deepStrictEqual(r.ids, ['a', 'b']));
  ok('커서 = windowEnd(창 전체 처리)', () => assert.strictEqual(r.newCursor.getTime(), winEnd.getTime()));
}

console.log('[planCdpCursorBatch] 중복 고객 제거(순서 유지)');
{
  const rows = [
    { customerId: 'a', occurredAt: t('2026-06-05T09:00:00Z') },
    { customerId: 'a', occurredAt: t('2026-06-05T09:10:00Z') },
    { customerId: 'b', occurredAt: t('2026-06-05T09:20:00Z') },
  ];
  const r = planCdpCursorBatch(rows, 1000, winEnd);
  ok('ids = [a,b] (중복 a 1회)', () => assert.deepStrictEqual(r.ids, ['a', 'b']));
}

console.log('[planCdpCursorBatch] 절단 — chunk까지만, 커서=마지막 처리 이벤트 시각');
{
  const rows = [
    { customerId: 'a', occurredAt: t('2026-06-05T09:00:00Z') },
    { customerId: 'b', occurredAt: t('2026-06-05T09:01:00Z') },
    { customerId: 'c', occurredAt: t('2026-06-05T09:02:00Z') },  // chunk(2) 초과 → 이번엔 미처리
  ];
  const r = planCdpCursorBatch(rows, 2, winEnd);
  ok('truncated=true', () => assert.strictEqual(r.truncated, true));
  ok('ids = [a,b] (chunk 2까지만)', () => assert.deepStrictEqual(r.ids, ['a', 'b']));
  ok('커서 = b 시각(windowEnd 아님 → c는 다음 회차)', () =>
    assert.strictEqual(r.newCursor.getTime(), t('2026-06-05T09:01:00Z').getTime()));
}

console.log('[planCdpCursorBatch] 빈 윈도우 — 커서=windowEnd');
{
  const r = planCdpCursorBatch([], 1000, winEnd);
  ok('ids = []', () => assert.deepStrictEqual(r.ids, []));
  ok('truncated=false', () => assert.strictEqual(r.truncated, false));
  ok('커서 = windowEnd', () => assert.strictEqual(r.newCursor.getTime(), winEnd.getTime()));
}

console.log(`\n${passed} assertions passed`);
