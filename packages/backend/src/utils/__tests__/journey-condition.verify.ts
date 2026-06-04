/**
 * journey-condition.verify.ts — 조건 평가 순수 로직 검증 (Phase 7 안전 분기)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-condition.verify.ts
 * (DB import 0 — 연결 불필요. 순수 함수만 검증.)
 *
 * Phase 7 핵심: "조건을 확인 못 함"은 "보내도 됨"이 아니다.
 *   빈 field / 미지원 operator = 미충족(false) = 발송 안 함.
 */
import assert from 'node:assert';
import { evaluateCustomerFieldCondition } from '../journey-condition';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

const cust: Record<string, any> = {
  grade: 'VIP',
  points: 1500,
  region: '서울',
  phone: '',
  custom_fields: { tier: 'gold' },
};

console.log('[journey-condition] customer_field 9 operator');
ok('== 일치 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ type: 'customer_field', field: 'grade', operator: '==', value: 'VIP' }, cust), true));
ok('== 불일치 → false', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'grade', operator: '==', value: 'GOLD' }, cust), false));
ok('!= 불일치 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'grade', operator: '!=', value: 'GOLD' }, cust), true));
ok('>= 충족 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'points', operator: '>=', value: 1000 }, cust), true));
ok('>= 미충족 → false', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'points', operator: '>=', value: 2000 }, cust), false));
ok('<= 충족 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'points', operator: '<=', value: 1500 }, cust), true));
ok('> 충족 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'points', operator: '>', value: 1000 }, cust), true));
ok('< 미충족 → false', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'points', operator: '<', value: 1000 }, cust), false));
ok('in 포함 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'grade', operator: 'in', value: ['VIP', 'GOLD'] }, cust), true));
ok('in 미포함 → false', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'grade', operator: 'in', value: ['GOLD'] }, cust), false));
ok('not_in 미포함 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'grade', operator: 'not_in', value: ['GOLD'] }, cust), true));
ok('is_null 빈값 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'phone', operator: 'is_null' }, cust), true));
ok('not_null 값있음 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'grade', operator: 'not_null' }, cust), true));

console.log('[journey-condition] custom_fields fallback');
ok('직접 컬럼 없으면 custom_fields 참조 → true', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'tier', operator: '==', value: 'gold' }, cust), true));

console.log('[journey-condition] 안전 분기 — 확인 불가 = 미충족(false)');
ok('빈 field → false (발송 안 함)', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: '', operator: '==', value: 'x' }, cust), false));
ok('미지원 operator → false (발송 안 함)', () =>
  assert.strictEqual(evaluateCustomerFieldCondition({ field: 'grade', operator: '~=', value: 'VIP' }, cust), false));

console.log(`\n${passed} assertions passed`);
