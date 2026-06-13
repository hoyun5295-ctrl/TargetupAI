/**
 * ai-memory-customer-insight.verify.ts — 등급별 고객 인사이트 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/ai-memory-customer-insight.verify.ts
 * (DB import 0 — 등급 집계 rows → 인사이트 문장. 표본 미달 제외 + 전체 평균 대비 배수 + 임의 상수 0.)
 */
import assert from 'node:assert';
import { buildCustomerInsights } from '../ai-memory-customer-insight';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const input = {
  grades: [
    { grade: 'VVIP', customerCount: 50, avgPurchaseAmount: 300000, avgPurchaseCount: 8, avgLtvScore: 90 },
    { grade: 'GENERAL', customerCount: 500, avgPurchaseAmount: 50000, avgPurchaseCount: 1.2, avgLtvScore: 30 },
    { grade: 'NEW', customerCount: 5, avgPurchaseAmount: 0, avgPurchaseCount: 0, avgLtvScore: 10 },
  ],
  overallAvgPurchaseAmount: 100000,
  overallAvgPurchaseCount: 2,
  minSample: 10,
};

console.log('[ai-memory-customer-insight] buildCustomerInsights — 실측만, 표본 미달 제외, 임의 상수 0');

ok('표본 미달 등급(NEW 5명) 제외', () => {
  const out = buildCustomerInsights(input);
  assert.ok(!out.some((i) => i.grade === 'NEW'), JSON.stringify(out));
});
ok('표본 충분 등급만 생성 (2건)', () =>
  assert.strictEqual(buildCustomerInsights(input).length, 2));
ok('VVIP — 실측 구매액 + 전체 평균 대비 배수 + 인원', () => {
  const vvip = buildCustomerInsights(input).find((i) => i.grade === 'VVIP')!;
  assert.strictEqual(vvip.memoryKey, 'grade_VVIP');
  assert.ok(vvip.memoryValue.includes('300,000'), vvip.memoryValue);
  assert.ok(vvip.memoryValue.includes('3.0배'), vvip.memoryValue);
  assert.ok(vvip.memoryValue.includes('50명'), vvip.memoryValue);
});
ok('평균 이상 등급 importance > 평균 이하 등급', () => {
  const out = buildCustomerInsights(input);
  const vvip = out.find((i) => i.grade === 'VVIP')!;
  const gen = out.find((i) => i.grade === 'GENERAL')!;
  assert.ok(vvip.importance > gen.importance, `${vvip.importance} vs ${gen.importance}`);
});
ok('전체 평균 0 → 배수 1.0 (0 나눗셈 방어)', () => {
  const out = buildCustomerInsights({
    grades: [{ grade: 'A', customerCount: 20, avgPurchaseAmount: 0, avgPurchaseCount: 0, avgLtvScore: 0 }],
    overallAvgPurchaseAmount: 0, overallAvgPurchaseCount: 0, minSample: 10,
  });
  assert.ok(out[0].memoryValue.includes('1.0배'), out[0].memoryValue);
});
ok('빈 등급 → 빈 배열', () =>
  assert.deepStrictEqual(
    buildCustomerInsights({ grades: [], overallAvgPurchaseAmount: 0, overallAvgPurchaseCount: 0, minSample: 10 }), []));

console.log(`\n[ai-memory-customer-insight] ${passed} passed`);
