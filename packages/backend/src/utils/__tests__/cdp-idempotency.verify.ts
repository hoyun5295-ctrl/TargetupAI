/**
 * cdp-idempotency.verify.ts — CT-85 webhook 멱등 키 검증 (순수, DB import 0)
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/cdp-idempotency.verify.ts
 * 핵심: 같은 전송의 재시도는 같은 키(차단), 주문 상태 전환·회원 갱신 같은 새 전송은 다른 키(통과).
 */
import assert from 'node:assert';
import { buildWebhookIdempotencyKey } from '../cdp-idempotency';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[1] 전송 고유값(event_id/event_no) 1순위');
{
  const k1 = buildWebhookIdempotencyKey('order.updated', { order_id: 'O100' }, { event_id: 'E1', resource: { order_id: 'O100' } });
  const k2 = buildWebhookIdempotencyKey('order.updated', { order_id: 'O100' }, { event_id: 'E2', resource: { order_id: 'O100' } });
  ok('event_id 다르면 키 다름 (상태 전환 통과)', () => assert.notStrictEqual(k1, k2));
  ok('event_id 같으면 키 같음 (재시도 차단)', () => assert.strictEqual(k1, buildWebhookIdempotencyKey('order.updated', { order_id: 'O100' }, { event_id: 'E1', resource: { order_id: 'O100' } })));
  ok('cafe24 event_no도 인정', () => assert.ok(buildWebhookIdempotencyKey('order.created', { order_id: 'O1' }, { event_no: 777 }).includes('evt:777')));
}

console.log('[2] 고유값 없으면 엔티티ID + 본문 해시');
{
  const bodyPaid = { resource: { order_id: 'O200', status: 'paid' } };
  const bodyShipping = { resource: { order_id: 'O200', status: 'shipping' } };
  const k1 = buildWebhookIdempotencyKey('order.updated', bodyPaid.resource, bodyPaid);
  const k1again = buildWebhookIdempotencyKey('order.updated', bodyPaid.resource, bodyPaid);
  const k2 = buildWebhookIdempotencyKey('order.updated', bodyShipping.resource, bodyShipping);
  ok('동일 내용 재전송 = 같은 키 (차단)', () => assert.strictEqual(k1, k1again));
  ok('내용 바뀐 갱신 = 다른 키 (통과 — 이전 결함 정정 핵심)', () => assert.notStrictEqual(k1, k2));
  ok('엔티티ID 포함', () => assert.ok(k1.startsWith('order.updated:O200:')));
}

console.log('[3] customer.updated — 같은 회원의 서로 다른 갱신이 통과');
{
  const b1 = { resource: { external_id: 'M1', grade: 'VIP' } };
  const b2 = { resource: { external_id: 'M1', grade: 'GOLD' } };
  const k1 = buildWebhookIdempotencyKey('customer.updated', b1.resource, b1);
  const k2 = buildWebhookIdempotencyKey('customer.updated', b2.resource, b2);
  ok('등급 변경 두 건 = 다른 키', () => assert.notStrictEqual(k1, k2));
}

console.log('[4] 경계 — id 전무 / 200자 한도');
{
  const k = buildWebhookIdempotencyKey('custom.event', {}, { foo: 'bar' });
  ok('id 전무 = noid + 해시 (결정적)', () => assert.strictEqual(k, buildWebhookIdempotencyKey('custom.event', {}, { foo: 'bar' })));
  const longId = 'X'.repeat(300);
  const kLong = buildWebhookIdempotencyKey('order.created', { order_id: longId }, { resource: { order_id: longId } });
  ok('varchar(200) 한도 준수', () => assert.ok(kLong.length <= 200));
  const kLong2 = buildWebhookIdempotencyKey('order.created', { order_id: longId }, { resource: { order_id: longId } });
  ok('축약 후에도 결정적', () => assert.strictEqual(kLong, kLong2));
}

console.log(`\n${passed} assertions passed — cdp-idempotency`);
