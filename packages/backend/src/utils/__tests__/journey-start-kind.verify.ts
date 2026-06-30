/**
 * journey-start-kind.verify.ts — start_kind 분류·경로 판정 순수 가드 (DB import 0).
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-start-kind.verify.ts
 */
import assert from 'node:assert';
import {
  START_KINDS,
  isValidStartKind,
  normalizeStartKind,
  classifyStartKind,
  isWatcherDriven,
  isSingleStepKind,
} from '../journey-start-kind';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[journey-start-kind] 검증');

ok('START_KINDS 4종', () => assert.deepStrictEqual(START_KINDS, ['event', 'standing', 'date_anchor', 'one_shot']));

ok('isValidStartKind 통과', () => { for (const k of START_KINDS) assert.strictEqual(isValidStartKind(k), true); });
ok('isValidStartKind 거부(미지원/빈/숫자)', () => {
  assert.strictEqual(isValidStartKind('foo'), false);
  assert.strictEqual(isValidStartKind(''), false);
  assert.strictEqual(isValidStartKind(null), false);
  assert.strictEqual(isValidStartKind(3), false);
});

ok('normalizeStartKind — 유효 유지 / 그 외 event', () => {
  assert.strictEqual(normalizeStartKind('date_anchor'), 'date_anchor');
  assert.strictEqual(normalizeStartKind('garbage'), 'event');
  assert.strictEqual(normalizeStartKind(undefined), 'event');
});

// classifyStartKind — 마이그레이션/default 분류
ok('classify custom → standing', () => assert.strictEqual(classifyStartKind('custom'), 'standing'));
// points_expiring은 annual_date 포함 모두 event(기존 watcher 추출 경로 보존). date_anchor는 신규 빌더가 명시 지정.
ok('classify points_expiring(annual_date) → event(기존 경로 보존)', () =>
  assert.strictEqual(classifyStartKind('customer.points_expiring', { expiryMode: 'annual_date' }), 'event'));
ok('classify points_expiring(inactivity) → event', () =>
  assert.strictEqual(classifyStartKind('customer.points_expiring', { expiryMode: 'inactivity' }), 'event'));
ok('classify points_expiring(모드 없음) → event', () =>
  assert.strictEqual(classifyStartKind('customer.points_expiring'), 'event'));
ok('classify 나머지 트리거 → event', () => {
  for (const t of ['customer.created', 'cdp.purchase', 'customer.dormant', 'cdp.cart_abandon', 'customer.birthday_approaching', 'cdp.reservation_created', 'custom_order_shipped']) {
    assert.strictEqual(classifyStartKind(t), 'event');
  }
});

// 경로 판정
ok('isWatcherDriven — event/standing true, 그 외 false', () => {
  assert.strictEqual(isWatcherDriven('event'), true);
  assert.strictEqual(isWatcherDriven('standing'), true);
  assert.strictEqual(isWatcherDriven('date_anchor'), false);
  assert.strictEqual(isWatcherDriven('one_shot'), false);
  assert.strictEqual(isWatcherDriven('garbage'), true); // normalize→event
});
ok('isSingleStepKind — date_anchor/one_shot true, 그 외 false', () => {
  assert.strictEqual(isSingleStepKind('date_anchor'), true);
  assert.strictEqual(isSingleStepKind('one_shot'), true);
  assert.strictEqual(isSingleStepKind('event'), false);
  assert.strictEqual(isSingleStepKind('standing'), false);
});

console.log(`\n[journey-start-kind] ${passed} passed`);
