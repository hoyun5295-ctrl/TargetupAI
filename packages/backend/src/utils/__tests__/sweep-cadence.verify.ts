/**
 * sweep-cadence.verify.ts — sweep 차등 주기 판정 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/sweep-cadence.verify.ts
 * (DB import 0 — 발송 48h 이내 매 사이클 / 경과 60분 1회 판정만 검증.)
 * 2026-06-13: 30초 sweeper가 14일치 전체(IN 380건)를 매번 18개 이력 테이블 UNION으로
 * 실집계하던 10초 쿼리 상시 점유(슈퍼관리자 전반 지연)의 근본 fix.
 */
import assert from 'node:assert';
import { isSweepDue, SWEEP_HOT_AGE_MS, SWEEP_COLD_INTERVAL_MS } from '../sweep-cadence';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const NOW = 1_760_000_000_000; // 고정 기준 시각(ms)
const H = 60 * 60 * 1000;
const MIN = 60 * 1000;

console.log('[sweep-cadence] isSweepDue — 발송 48h 이내 매 사이클 / 경과 60분 1회');
ok('발송 직후(0h): 직전 사이클에 집계했어도 매 사이클 true', () =>
  assert.strictEqual(isSweepDue(NOW, NOW - 30 * 1000, NOW), true));
ok('발송 47h: 마커 무관 true (집계 구간)', () =>
  assert.strictEqual(isSweepDue(NOW - 47 * H, NOW - 30 * 1000, NOW), true));
ok('발송 정확히 48h: 경계 포함 true', () =>
  assert.strictEqual(isSweepDue(NOW - SWEEP_HOT_AGE_MS, NOW, NOW), true));
ok('발송 49h + 마커 없음(재시작 직후): true — 첫 사이클 전수 1회', () =>
  assert.strictEqual(isSweepDue(NOW - 49 * H, undefined, NOW), true));
ok('발송 49h + 30분 전 집계: false — 휴면 skip', () =>
  assert.strictEqual(isSweepDue(NOW - 49 * H, NOW - 30 * MIN, NOW), false));
ok('발송 49h + 정확히 60분 전 집계: true — 시간당 1회 차례', () =>
  assert.strictEqual(isSweepDue(NOW - 49 * H, NOW - SWEEP_COLD_INTERVAL_MS, NOW), true));
ok('발송 13일 + 61분 전 집계: true — 14일 윈도우 내내 시간당 재확인 유지', () =>
  assert.strictEqual(isSweepDue(NOW - 13 * 24 * H, NOW - 61 * MIN, NOW), true));
ok('발송시각 불명(0/null): 항상 true — 보수적 default', () => {
  assert.strictEqual(isSweepDue(0, NOW - 1 * MIN, NOW), true);
  assert.strictEqual(isSweepDue(null, NOW - 1 * MIN, NOW), true);
});
ok('마커 NaN 혼입 방어: 마커 없음으로 취급 true', () =>
  assert.strictEqual(isSweepDue(NOW - 49 * H, Number.NaN, NOW), true));

console.log(`\n[sweep-cadence] ${passed}/9 passed`);
