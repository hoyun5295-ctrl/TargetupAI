/**
 * ai-credit-calc.verify.ts — 순수 함수 단위 검증
 *
 * 실행: npx ts-node packages/backend/src/utils/__tests__/ai-credit-calc.verify.ts
 * (테스트 러너 미설치 프로젝트 — node:assert + ts-node 직접 실행. DB import 0 = 연결 불필요.)
 */
import assert from 'node:assert';
import {
  splitDeduction,
  needsMonthlyReset,
  buildIdempotencyKey,
  kstYearMonth,
  kstMonthTag,
  getCreditCost,
} from '../ai-credit-calc';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

console.log('[ai-credit-calc] splitDeduction (2버킷: base 먼저 → purchased)');
ok('base 충분 → base에서만', () =>
  assert.deepStrictEqual(splitDeduction(100, 50, 10), { fromBase: 10, fromPurchased: 0, shortfall: 0 }));
ok('base 부족 → purchased 보충', () =>
  assert.deepStrictEqual(splitDeduction(3, 50, 10), { fromBase: 3, fromPurchased: 7, shortfall: 0 }));
ok('base 0 → purchased에서만', () =>
  assert.deepStrictEqual(splitDeduction(0, 50, 10), { fromBase: 0, fromPurchased: 10, shortfall: 0 }));
ok('정확히 소진 (base+purchased=cost)', () =>
  assert.deepStrictEqual(splitDeduction(4, 6, 10), { fromBase: 4, fromPurchased: 6, shortfall: 0 }));
ok('둘 다 부족 → shortfall', () =>
  assert.deepStrictEqual(splitDeduction(3, 4, 10), { fromBase: 3, fromPurchased: 4, shortfall: 3 }));
ok('cost 0 → 차감 0', () =>
  assert.deepStrictEqual(splitDeduction(100, 100, 0), { fromBase: 0, fromPurchased: 0, shortfall: 0 }));
ok('음수·소수 입력 방어', () =>
  assert.deepStrictEqual(splitDeduction(-5, 10.9, 3.2), { fromBase: 0, fromPurchased: 3, shortfall: 0 }));

console.log('[ai-credit-calc] needsMonthlyReset (KST 월 기준)');
ok('resetAt 없음 → 리셋 필요', () =>
  assert.strictEqual(needsMonthlyReset(null, new Date('2026-05-31T00:00:00Z')), true));
ok('같은 KST 월 → 불필요', () =>
  assert.strictEqual(needsMonthlyReset(new Date('2026-05-01T00:00:00Z'), new Date('2026-05-31T10:00:00Z')), false));
ok('지난 달 → 필요', () =>
  assert.strictEqual(needsMonthlyReset(new Date('2026-03-15T00:00:00Z'), new Date('2026-05-01T00:00:00Z')), true));
ok('KST 월 경계 — UTC 4/30 15:00Z = KST 5/1 → 필요', () =>
  assert.strictEqual(needsMonthlyReset(new Date('2026-04-15T00:00:00Z'), new Date('2026-04-30T15:00:00Z')), true));
ok('KST 같은 달 — UTC 4/30 14:00Z = KST 4/30 23:00 → 불필요', () =>
  assert.strictEqual(needsMonthlyReset(new Date('2026-04-01T00:00:00Z'), new Date('2026-04-30T14:00:00Z')), false));

console.log('[ai-credit-calc] kstYearMonth / kstMonthTag');
ok('kstMonthTag — UTC 4/30 15:00Z = KST 202605', () =>
  assert.strictEqual(kstMonthTag(new Date('2026-04-30T15:00:00Z')), '202605'));
ok('kstMonthTag 일반', () =>
  assert.strictEqual(kstMonthTag(new Date('2026-05-15T03:00:00Z')), '202605'));
ok('kstYearMonth 월 경계 차이 = 1', () =>
  assert.strictEqual(
    kstYearMonth(new Date('2026-04-30T15:00:00Z')) - kstYearMonth(new Date('2026-03-31T15:00:00Z')), 1));

console.log('[ai-credit-calc] buildIdempotencyKey');
ok('aiCallLogId 있음 → source:id', () =>
  assert.strictEqual(buildIdempotencyKey('orchestrate', 'abc-123'), 'orchestrate:abc-123'));
ok('aiCallLogId 없음 → null', () => {
  assert.strictEqual(buildIdempotencyKey('orchestrate', null), null);
  assert.strictEqual(buildIdempotencyKey('orchestrate', undefined), null);
});

console.log('[ai-credit-calc] getCreditCost (source → 크레딧)');
ok('풀분석 orchestrate = 300', () => assert.strictEqual(getCreditCost('orchestrate'), 300));
ok('여정 journey-ai-generate = 150', () => assert.strictEqual(getCreditCost('journey-ai-generate'), 150));
ok('자동마케팅 continuous-operator = 200', () => assert.strictEqual(getCreditCost('continuous-operator'), 200));
ok('모바일DM dm-builder = 30', () => assert.strictEqual(getCreditCost('dm-builder'), 30));
ok('인앱 inapp-ai-generator = 15', () => assert.strictEqual(getCreditCost('inapp-ai-generator'), 15));
ok('문안·분석 generate-messages = 5', () => assert.strictEqual(getCreditCost('generate-messages'), 5));
ok('다듬기 journey-ai-refine = 1', () => assert.strictEqual(getCreditCost('journey-ai-refine'), 1));
ok('스팸 spam-filter-test = 0 (크레딧 비대상 — 현금/후불 청구)', () => assert.strictEqual(getCreditCost('spam-filter-test'), 0));
ok('미등록 source = 0', () => assert.strictEqual(getCreditCost('unknown'), 0));
ok('source 없음(null/undefined) = 0', () => {
  assert.strictEqual(getCreditCost(null), 0);
  assert.strictEqual(getCreditCost(undefined), 0);
});

console.log(`\n${passed} assertions passed`);
