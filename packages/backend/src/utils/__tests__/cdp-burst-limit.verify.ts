/**
 * cdp-burst-limit.verify.ts — 회사별 슬라이딩 윈도우 버스트 카운터 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/cdp-burst-limit.verify.ts
 * (DB import 0 — evaluateBurst 순수. 시간/타임스탬프는 인자 주입.)
 */
import assert from 'node:assert';
import { evaluateBurst } from '../cdp-burst-limit';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const WIN = 10_000; // 10s
const MAX = 3;

console.log('[cdp-burst-limit] evaluateBurst — windowMs 내 maxPerWindow 초과 차단');

ok('빈 상태 첫 호출 → 허용 + retained 1건', () => {
  const r = evaluateBurst({ timestamps: [] }, 1000, WIN, MAX);
  assert.strictEqual(r.allowed, true);
  assert.deepStrictEqual(r.retained, [1000]);
});

ok('윈도우 내 3건째까지 허용(max=3)', () => {
  let state = { timestamps: [] as number[] };
  let r = evaluateBurst(state, 1000, WIN, MAX); state = { timestamps: r.retained };
  r = evaluateBurst(state, 1100, WIN, MAX); state = { timestamps: r.retained };
  r = evaluateBurst(state, 1200, WIN, MAX);
  assert.strictEqual(r.allowed, true);
});

ok('윈도우 내 4건째 → 차단(allowed=false), retained는 push 안 함', () => {
  const r = evaluateBurst({ timestamps: [1000, 1100, 1200] }, 1300, WIN, MAX);
  assert.strictEqual(r.allowed, false);
  assert.deepStrictEqual(r.retained, [1000, 1100, 1200]);
});

ok('오래된 타임스탬프(윈도우 밖)는 만료 → 다시 허용', () => {
  const r = evaluateBurst({ timestamps: [1000, 1100, 1200] }, 12000, WIN, MAX);
  assert.strictEqual(r.allowed, true);
  assert.deepStrictEqual(r.retained, [12000]);
});

ok('경계: cutoff와 정확히 같은 시각은 만료(> cutoff만 유지)', () => {
  // now=11000, cutoff=1000 → t=1000 만료, t=1001/1002 유지
  const r = evaluateBurst({ timestamps: [1000, 1001, 1002] }, 11000, WIN, MAX);
  assert.strictEqual(r.retained.includes(1000), false);
});

console.log(`\n[cdp-burst-limit] ${passed}/5 passed`);
