/**
 * journey-simulator-core.verify.ts — 시뮬레이터 순수 코어 검증 (Phase 9 Task 3·5)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-simulator-core.verify.ts
 * (DB import 0 — 등급 분포 셰이핑 + 예측 계산 순수 함수.)
 */
import assert from 'node:assert';
import { buildSegmentBreakdown, buildProjection } from '../journey-simulator-core';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[journey-simulator-core] buildSegmentBreakdown');
ok('total + pct + 내림차순 정렬', () => {
  const r = buildSegmentBreakdown([{ segment: 'VIP', cnt: 30 }, { segment: '일반', cnt: 70 }]);
  assert.strictEqual(r.total, 100);
  assert.strictEqual(r.segments[0].segment, '일반');
  assert.strictEqual(r.segments[0].count, 70);
  assert.ok(Math.abs(r.segments[0].pct - 0.7) < 1e-9);
  assert.strictEqual(r.segments[1].segment, 'VIP');
});
ok('빈 입력 → total 0, segments []', () => {
  const r = buildSegmentBreakdown([]);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.segments.length, 0);
});
ok('cnt 문자열도 숫자 처리', () => {
  const r = buildSegmentBreakdown([{ segment: 'A', cnt: '5' as any }]);
  assert.strictEqual(r.total, 5);
});

console.log('[journey-simulator-core] buildProjection');
ok('단일 메시지 — 실데이터 매출', () => {
  const p = buildProjection({
    matched: 100,
    steps: [{ stepType: 'message', channel: 'sms', stepOrder: 1 }],
    avgOrderValue: 50000, avgConversion: 0.1, avgClick: 0.2,
    channelCost: { sms: 9 },
  });
  assert.strictEqual(p.steps[0].expectedSends, 100);
  assert.strictEqual(p.steps[0].expectedCost, 900);
  assert.strictEqual(p.totalEstimatedSends, 100);
  assert.strictEqual(p.totalEstimatedCost, 900);
  assert.ok(Math.abs((p.estimatedConversionRate ?? 0) - 0.1) < 1e-9);
  assert.strictEqual(p.estimatedRevenue, 500000); // 100*0.1*50000
  assert.strictEqual(p.hasGatedSteps, false);
  assert.strictEqual(p.dataNote, null);
});
ok('조건 step 하류 메시지 = 변동(null) + 데이터 부족 매출 생략', () => {
  const p = buildProjection({
    matched: 100,
    steps: [
      { stepType: 'message', channel: 'sms', stepOrder: 1 },
      { stepType: 'condition', channel: null, stepOrder: 2 },
      { stepType: 'message', channel: 'lms', stepOrder: 3 },
    ],
    avgOrderValue: null, avgConversion: null, avgClick: null,
    channelCost: { sms: 9, lms: 30 },
  });
  assert.strictEqual(p.steps.length, 2);              // message 2건만(condition 제외)
  assert.strictEqual(p.steps[0].expectedSends, 100);  // 조건 전
  assert.strictEqual(p.steps[1].expectedSends, null); // 조건 후 = 변동
  assert.strictEqual(p.totalEstimatedSends, 100);     // 조건 전만 합산
  assert.strictEqual(p.hasGatedSteps, true);
  assert.strictEqual(p.estimatedRevenue, null);
  assert.strictEqual(p.estimatedConversionRate, null);
  assert.ok(p.dataNote !== null);
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
