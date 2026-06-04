/**
 * line-merge.verify.ts — 라인그룹 테이블 합집합 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/line-merge.verify.ts
 */
import assert from 'node:assert';
import { mergeLineTables } from '../sms-queue';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

ok('user+company 합집합 — 중복 제거', () => {
  assert.deepStrictEqual(
    mergeLineTables(['SMSQ_SEND_1', 'SMSQ_SEND_2', 'SMSQ_SEND_3'], ['SMSQ_SEND_7', 'SMSQ_SEND_8', 'SMSQ_SEND_9']),
    ['SMSQ_SEND_1', 'SMSQ_SEND_2', 'SMSQ_SEND_3', 'SMSQ_SEND_7', 'SMSQ_SEND_8', 'SMSQ_SEND_9']
  );
});
ok('겹치는 테이블 1번만', () => {
  assert.deepStrictEqual(mergeLineTables(['A', 'B'], ['B', 'C']), ['A', 'B', 'C']);
});
ok('한쪽 빈 배열', () => {
  assert.deepStrictEqual(mergeLineTables(['A'], []), ['A']);
  assert.deepStrictEqual(mergeLineTables([], ['B']), ['B']);
});
ok('양쪽 동일 → 그대로', () => {
  assert.deepStrictEqual(mergeLineTables(['A', 'B'], ['A', 'B']), ['A', 'B']);
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
