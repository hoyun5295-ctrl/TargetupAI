/**
 * journey-trigger-class.verify.ts — 여정 트리거 이벤트성/상태성 분류 + 커서 경로 정합 가드
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-trigger-class.verify.ts
 * (DB import 0. 새 이벤트성 트리거가 커서 경로 밖에 추가되면 이 테스트가 깨져 누락을 알린다 — 회귀 가드.)
 */
import assert from 'node:assert';
import { classifyJourneyTrigger, resolveCdpCursorEventName } from '../journey-cdp-cursor';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[journey-trigger-class] classifyJourneyTrigger — 9 트리거 전수 분류');

ok('cdp.purchase → event_cursor', () => assert.strictEqual(classifyJourneyTrigger('cdp.purchase'), 'event_cursor'));
ok('cdp.reservation_created → event_cursor', () => assert.strictEqual(classifyJourneyTrigger('cdp.reservation_created'), 'event_cursor'));
ok('custom_order_shipped → event_cursor', () => assert.strictEqual(classifyJourneyTrigger('custom_order_shipped'), 'event_cursor'));
ok('cdp.cart_abandon → event_special(별도 properties 동봉)', () => assert.strictEqual(classifyJourneyTrigger('cdp.cart_abandon'), 'event_special'));
ok('customer.created → state', () => assert.strictEqual(classifyJourneyTrigger('customer.created'), 'state'));
ok('customer.dormant → state', () => assert.strictEqual(classifyJourneyTrigger('customer.dormant'), 'state'));
ok('customer.birthday_approaching → state', () => assert.strictEqual(classifyJourneyTrigger('customer.birthday_approaching'), 'state'));
ok('customer.points_expiring → state', () => assert.strictEqual(classifyJourneyTrigger('customer.points_expiring'), 'state'));
ok('custom → state', () => assert.strictEqual(classifyJourneyTrigger('custom'), 'state'));

// ★ 회귀 가드: event_cursor로 분류된 트리거는 반드시 resolveCdpCursorEventName이 non-null이어야 한다.
const EVENT_CURSOR = ['cdp.purchase', 'cdp.reservation_created', 'custom_order_shipped'];
ok('event_cursor 트리거 ↔ resolveCdpCursorEventName non-null 정합', () => {
  for (const t of EVENT_CURSOR) {
    assert.strictEqual(classifyJourneyTrigger(t), 'event_cursor');
    assert.notStrictEqual(resolveCdpCursorEventName(t), null);
  }
});
ok('state 트리거는 resolveCdpCursorEventName null', () =>
  assert.strictEqual(resolveCdpCursorEventName('customer.dormant'), null));

console.log(`\n[journey-trigger-class] ${passed}/11 passed`);
