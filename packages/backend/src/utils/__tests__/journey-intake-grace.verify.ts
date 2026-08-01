/**
 * journey-intake-grace.verify.ts — 이관 유예 CT(순수) 검증 (2026-08-01)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-intake-grace.verify.ts
 *
 * 못 박는 것:
 *   1. 신규가입은 유예를 받지 않는다 — 진짜 신규를 며칠 늦게 보내면 기능이 죽는다.
 *   2. 휴면·포인트·상시는 유예를 받는다 — 이관 배치가 통째로 발화하던 경로다.
 *   3. 유예 0(회사가 끔)이면 조각도 파라미터도 만들지 않는다.
 */
import assert from 'node:assert';
import {
  isBulkStateTrigger,
  resolveIntakeGraceDays,
  buildIntakeGraceClause,
  DEFAULT_INTAKE_GRACE_DAYS,
} from '../journey-intake-grace';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[journey-intake-grace] 대상 트리거');
ok('휴면·포인트·상시는 유예를 받는다', () => {
  assert.strictEqual(isBulkStateTrigger('customer.dormant'), true);
  assert.strictEqual(isBulkStateTrigger('customer.points_expiring'), true);
  assert.strictEqual(isBulkStateTrigger('custom'), true);
});

ok('신규가입은 유예를 받지 않는다 — 즉시 발송이 목적, 이관 오인은 판정 근거가 막는다', () => {
  assert.strictEqual(isBulkStateTrigger('customer.created'), false);
});

ok('생일은 유예를 받지 않는다 — 실제 날짜라 적재 시점과 무관', () => {
  assert.strictEqual(isBulkStateTrigger('customer.birthday_approaching'), false);
});

ok('커서 계열은 유예를 받지 않는다 — 과거 이벤트 소급이 없다', () => {
  for (const t of ['cdp.purchase', 'cdp.reservation_created', 'custom_order_shipped', 'cdp.cart_abandon']) {
    assert.strictEqual(isBulkStateTrigger(t), false, t);
  }
});

ok('모르는 트리거는 유예 대상이 아니다(기본 false)', () => {
  assert.strictEqual(isBulkStateTrigger('customer.unknown_thing'), false);
});

console.log('[journey-intake-grace] 유예 일수');
ok('미설정이면 기본값', () => {
  assert.strictEqual(resolveIntakeGraceDays({}), DEFAULT_INTAKE_GRACE_DAYS);
  assert.strictEqual(resolveIntakeGraceDays(null), DEFAULT_INTAKE_GRACE_DAYS);
  assert.strictEqual(resolveIntakeGraceDays({ intake_grace_days: '' }), DEFAULT_INTAKE_GRACE_DAYS);
  assert.strictEqual(resolveIntakeGraceDays({ intake_grace_days: 'abc' }), DEFAULT_INTAKE_GRACE_DAYS);
});

ok('0은 유효한 설정이다 — 회사가 명시적으로 껐다', () => {
  assert.strictEqual(resolveIntakeGraceDays({ intake_grace_days: 0 }), 0);
});

ok('음수는 0으로, 상한은 90으로 클램프', () => {
  assert.strictEqual(resolveIntakeGraceDays({ intake_grace_days: -5 }), 0);
  assert.strictEqual(resolveIntakeGraceDays({ intake_grace_days: 9999 }), 90);
});

console.log('[journey-intake-grace] SQL 조각');
ok('유예 0이면 조각도 파라미터도 없다', () => {
  const p: any[] = [];
  assert.strictEqual(buildIntakeGraceClause('c', p, 0), null);
  assert.strictEqual(p.length, 0);
});

ok('정상 유예는 created_at 비교 + 파라미터 1개', () => {
  const p: any[] = [];
  const frag = buildIntakeGraceClause('c', p, 7)!;
  assert.ok(/c\.created_at <= NOW\(\) - \(\$1 \|\| ' days'\)::interval/.test(frag));
  assert.deepStrictEqual(p, ['7']);
});

ok('파라미터 인덱스는 기존 배열을 이어받는다', () => {
  const p: any[] = ['a', 'b', 'c'];
  const frag = buildIntakeGraceClause('c', p, 30)!;
  assert.ok(/\$4/.test(frag));
  assert.strictEqual(p[3], '30');
});

ok('alias 치환', () => {
  const frag = buildIntakeGraceClause('x', [], 7)!;
  assert.ok(/x\.created_at/.test(frag));
});

ok('안전하지 않은 alias는 throw', () => {
  assert.throws(() => buildIntakeGraceClause('c; DROP TABLE customers; --', [], 7));
});

ok('조각에 리터럴 숫자를 결합하지 않는다(주입 표면 0)', () => {
  const frag = buildIntakeGraceClause('c', [], 30)!;
  assert.ok(!/30/.test(frag));
});

console.log(`\n${passed} assertions passed`);
