/**
 * performance-roas-core 순수 로직 테스트 — ts-node 단독 실행.
 * 실행: npx ts-node src/utils/__tests__/performance-roas-core.manual-test.ts
 *
 * 블렌디드 ROAS = 기간 전체 매출 ÷ 기간 전체 비용. current/previous/diff 산출.
 * 임의상수 0 — 입력(실매출·실비용)만으로 계산. cost 0 / previous 0 가드 검증.
 */
import { computeBlendedRoas, computeRoasMetric } from '../performance-roas-core';

let pass = 0;
let fail = 0;
function check(n: string, f: () => void) {
  try { f(); pass++; console.log('  PASS:', n); }
  catch (e: any) { fail++; console.log('  FAIL:', n, '—', e?.message); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function near(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) < eps; }

check('정상 ROAS = 매출/비용', () => {
  assert(near(computeBlendedRoas(300000, 100000), 3), '300000/100000 = 3');
});

check('비용 0 → ROAS 0 (0 나눗셈 가드)', () => {
  assert(computeBlendedRoas(300000, 0) === 0, 'cost 0 → 0');
});

check('매출 0 → ROAS 0', () => {
  assert(computeBlendedRoas(0, 100000) === 0, 'revenue 0 → 0');
});

check('NaN/Infinity 입력 → 0', () => {
  assert(computeBlendedRoas(NaN, 100) === 0, 'NaN → 0');
  assert(computeBlendedRoas(Infinity, 0) === 0, 'Inf/0 → 0');
});

check('metric: current/previous/diffPct/betterThan', () => {
  // current ROAS = 2 (200000/100000), previous ROAS = 1 (100000/100000)
  const m = computeRoasMetric(200000, 100000, 100000, 100000);
  assert(near(m.current, 2), 'current 2');
  assert(near(m.previous, 1), 'previous 1');
  assert(near(m.diffPct, 100), 'diff +100%');
  assert(m.betterThan === true, 'better true');
});

check('previous ROAS 0 → diffPct 100(current>0) 또는 0', () => {
  const m1 = computeRoasMetric(200000, 100000, 0, 0);
  assert(m1.previous === 0 && near(m1.diffPct, 100), 'prev 0, current>0 → +100');
  const m2 = computeRoasMetric(0, 100000, 0, 0);
  assert(m2.current === 0 && m2.diffPct === 0, 'both 0 → diff 0');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
