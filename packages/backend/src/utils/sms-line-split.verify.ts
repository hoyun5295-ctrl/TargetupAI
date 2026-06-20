/**
 * MMS/문자 라인 분리 결정 — 순수 함수 검증 (TDD) — 2026-06-20
 * 실행: node packages/backend/node_modules/ts-node/dist/bin.js --transpile-only -P packages/backend/tsconfig.json packages/backend/src/utils/sms-line-split.verify.ts
 * DB-free 순수 로직(라인 분리 규칙)만 검증. 적재/INSERT는 bulkInsertSmsQueue(DB) 실측 대상.
 */

import assert from 'assert';
import { splitLinesByMsgType } from './sms-line-split';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log('PASS', name);
}

const T3 = ['SMSQ_SEND_7', 'SMSQ_SEND_8', 'SMSQ_SEND_9'];

// ── 혼합(MMS+문자) — 서로 겹치지 않는 라인으로 분리 ─────────────────
check('3라인 혼합 → MMS 1 / 문자 2', () => {
  const r = splitLinesByMsgType(T3, true, true);
  assert.deepStrictEqual(r.mmsLines, ['SMSQ_SEND_7']);
  assert.deepStrictEqual(r.textLines, ['SMSQ_SEND_8', 'SMSQ_SEND_9']);
});

check('3라인 혼합 → MMS·문자 라인 교집합 0(disjoint)', () => {
  const r = splitLinesByMsgType(T3, true, true);
  const overlap = r.mmsLines.filter((t) => r.textLines.includes(t));
  assert.deepStrictEqual(overlap, []);
});

check('2라인 혼합 → MMS 1 / 문자 1', () => {
  const r = splitLinesByMsgType(['SMSQ_SEND_7', 'SMSQ_SEND_8'], true, true);
  assert.deepStrictEqual(r.mmsLines, ['SMSQ_SEND_7']);
  assert.deepStrictEqual(r.textLines, ['SMSQ_SEND_8']);
});

// ── 분리 불가/불필요 — 전 라인 공유 ────────────────────────────────
check('1라인 혼합 → 분리 불가, 둘 다 그 라인', () => {
  const r = splitLinesByMsgType(['SMSQ_SEND_7'], true, true);
  assert.deepStrictEqual(r.mmsLines, ['SMSQ_SEND_7']);
  assert.deepStrictEqual(r.textLines, ['SMSQ_SEND_7']);
});

check('MMS만(문자 없음) → MMS가 전 라인 사용', () => {
  const r = splitLinesByMsgType(T3, true, false);
  assert.deepStrictEqual(r.mmsLines, T3);
});

check('문자만(MMS 없음) → 문자가 전 라인 사용', () => {
  const r = splitLinesByMsgType(T3, false, true);
  assert.deepStrictEqual(r.textLines, T3);
});

// ── 엣지 ───────────────────────────────────────────────────────────
check('빈 라인 → 빈 풀(호출부가 rows 0 가드)', () => {
  const r = splitLinesByMsgType([], true, true);
  assert.deepStrictEqual(r.mmsLines, []);
  assert.deepStrictEqual(r.textLines, []);
});

console.log(`\n${passed} passed`);
