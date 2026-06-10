/**
 * cdp-order-revenue.verify.ts — CT-86 주문 매출 반영 판정 검증 (순수, DB import 0)
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/cdp-order-revenue.verify.ts
 * 핵심: pending→paid 전환 시 매출 반영(이전 결함: 영원히 미반영), 취소/환불은 반영분만 1회 차감.
 */
import assert from 'node:assert';
import { decideOrderRevenueAction, isRevenueApplied } from '../cdp-order-revenue';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[1] 첫 주문');
{
  ok('첫 paid = apply', () => assert.strictEqual(decideOrderRevenueAction(null, 'paid').action, 'apply'));
  ok('첫 completed = apply', () => assert.strictEqual(decideOrderRevenueAction(null, 'completed').action, 'apply'));
  ok('첫 pending = none (트래킹만)', () => assert.strictEqual(decideOrderRevenueAction(null, 'pending').action, 'none'));
  ok('반영 전 취소 = none (차감 없음)', () => assert.strictEqual(decideOrderRevenueAction(null, 'cancelled').action, 'none'));
}

console.log('[2] pending → paid 전환 (이전 결함 정정 핵심)');
{
  const pendingEvent = { properties: { order_id: 'O1', status: 'pending', total_amount: 10000 } };
  const d = decideOrderRevenueAction(pendingEvent, 'paid');
  ok('pending 기록 후 paid 도착 = apply', () => assert.strictEqual(d.action, 'apply'));
}

console.log('[3] 매출 멱등 — 같은 paid 재전송 차단');
{
  const appliedEvent = { properties: { order_id: 'O1', status: 'paid', total_amount: 10000, revenue_applied: true } };
  ok('이미 반영 = none', () => assert.strictEqual(decideOrderRevenueAction(appliedEvent, 'paid').action, 'none'));
  ok('completed 재전송도 none', () => assert.strictEqual(decideOrderRevenueAction(appliedEvent, 'completed').action, 'none'));
}

console.log('[4] 마커 없는 과거 행 호환 (마커 도입 전 = 기록 status로 판정)');
{
  const legacyPaid = { properties: { order_id: 'O2', status: 'paid', total_amount: 5000 } };
  ok('과거 paid 행 = 반영됨 간주', () => assert.strictEqual(isRevenueApplied(legacyPaid), true));
  ok('과거 paid에 paid 재전송 = none (이중 반영 차단)', () => assert.strictEqual(decideOrderRevenueAction(legacyPaid, 'paid').action, 'none'));
  const legacyPending = { properties: { order_id: 'O3', status: 'pending', total_amount: 5000 } };
  ok('과거 pending 행 = 미반영 간주', () => assert.strictEqual(isRevenueApplied(legacyPending), false));
}

console.log('[5] 취소/환불 차감');
{
  const applied = { properties: { order_id: 'O4', status: 'paid', total_amount: 30000, revenue_applied: true } };
  const d = decideOrderRevenueAction(applied, 'cancelled');
  ok('반영된 주문 취소 = reverse', () => assert.strictEqual(d.action, 'reverse'));
  ok('차감액 = 반영 시점 기록 금액', () => assert.strictEqual(d.reverseAmount, 30000));
  ok('refunded도 동일', () => assert.strictEqual(decideOrderRevenueAction(applied, 'refunded').action, 'reverse'));

  const reversed = { properties: { order_id: 'O4', status: 'cancelled', total_amount: 30000, revenue_applied: true, revenue_reversed: true } };
  ok('이미 차감된 주문 재취소 = none (이중 차감 차단)', () => assert.strictEqual(decideOrderRevenueAction(reversed, 'cancelled').action, 'none'));
  ok('차감 종료 주문에 paid 재전송 = none (좀비 재반영 차단)', () => assert.strictEqual(decideOrderRevenueAction(reversed, 'paid').action, 'none'));
}

console.log('[6] 상태 추적만 하는 갱신');
{
  const applied = { properties: { order_id: 'O5', status: 'paid', total_amount: 1000, revenue_applied: true } };
  ok('paid → shipping = none', () => assert.strictEqual(decideOrderRevenueAction(applied, 'shipping').action, 'none'));
}

console.log(`\n${passed} assertions passed — cdp-order-revenue`);
