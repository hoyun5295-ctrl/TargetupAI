/**
 * journey-anchor-offsets.verify.ts — 자연어 목표에서 D-N 오프셋 파싱 가드.
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-anchor-offsets.verify.ts
 */
import assert from 'node:assert';
import { parseAnchorOffsets } from '../journey-ai-generator';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[journey-anchor-offsets] 검증');

ok('"7일전 3일전 당일" → [7,3,0]', () =>
  assert.deepStrictEqual(parseAnchorOffsets('포인트소멸임박고객에게 7일전 3일전 당일 구매독려'), [7, 3, 0]));
ok('"7일 전 1일 전" (공백) → [7,1]', () =>
  assert.deepStrictEqual(parseAnchorOffsets('7일 전 1일 전 안내'), [7, 1]));
ok('중복 제거 + 큰 것부터 정렬', () =>
  assert.deepStrictEqual(parseAnchorOffsets('3일전 7일전 3일전 당일'), [7, 3, 0]));
ok('"오늘"도 D-0', () =>
  assert.deepStrictEqual(parseAnchorOffsets('소멸 30일전 오늘'), [30, 0]));
ok('아무 시점 없으면 기본 [7,3,1,0]', () =>
  assert.deepStrictEqual(parseAnchorOffsets('포인트 사용 독려'), [7, 3, 1, 0]));
ok('최대 8스텝 제한', () =>
  assert.strictEqual(parseAnchorOffsets('10일전 9일전 8일전 7일전 6일전 5일전 4일전 3일전 2일전 1일전 당일').length, 8));
ok('"포인트소멸전"의 전은 오인 매칭 안 함', () =>
  assert.deepStrictEqual(parseAnchorOffsets('5일전 포인트소멸전 구매독려'), [5]));

console.log(`\n[journey-anchor-offsets] ${passed} passed`);
process.exit(0);
