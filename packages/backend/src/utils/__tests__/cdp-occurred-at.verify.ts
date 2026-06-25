/**
 * cdp-occurred-at.verify.ts — 자사몰 전송 occurred_at 클램프 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/cdp-occurred-at.verify.ts
 * (DB import 0 — clampOccurredAt 순수. 미래만 클램프(시계 오차 5분 허용), 과거는 마이그레이션 정상이라 통과.)
 */
import assert from 'node:assert';
import { clampOccurredAt } from '../cdp-occurred-at';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const NOW = new Date('2026-06-25T00:00:00.000Z');
const MIN = 60 * 1000;

console.log('[cdp-occurred-at] clampOccurredAt — 미래 클램프 / 파싱실패 now / 과거 통과');

ok('정상 과거 시각 → 그대로', () =>
  assert.strictEqual(clampOccurredAt('2026-06-24T12:00:00.000Z', NOW).toISOString(), '2026-06-24T12:00:00.000Z'));

ok('미래 10분 → now로 클램프', () =>
  assert.strictEqual(clampOccurredAt(new Date(NOW.getTime() + 10 * MIN), NOW).getTime(), NOW.getTime()));

ok('미래 3분(5분 이내 시계오차) → 그대로 통과', () =>
  assert.strictEqual(clampOccurredAt(new Date(NOW.getTime() + 3 * MIN), NOW).getTime(), NOW.getTime() + 3 * MIN));

ok('정확히 now+5분 경계 → 그대로(> 비교)', () =>
  assert.strictEqual(clampOccurredAt(new Date(NOW.getTime() + 5 * MIN), NOW).getTime(), NOW.getTime() + 5 * MIN));

ok('파싱 실패 문자열 → now', () =>
  assert.strictEqual(clampOccurredAt('not-a-date', NOW).getTime(), NOW.getTime()));

ok('undefined → now', () =>
  assert.strictEqual(clampOccurredAt(undefined, NOW).getTime(), NOW.getTime()));

ok('null → now', () =>
  assert.strictEqual(clampOccurredAt(null, NOW).getTime(), NOW.getTime()));

ok('먼 과거(2년 전) → 그대로(마이그레이션 정상)', () =>
  assert.strictEqual(clampOccurredAt('2024-06-25T00:00:00.000Z', NOW).toISOString(), '2024-06-25T00:00:00.000Z'));

console.log(`\n[cdp-occurred-at] ${passed}/8 passed`);
