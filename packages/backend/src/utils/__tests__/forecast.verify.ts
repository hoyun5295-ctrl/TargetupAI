// 예측·기회 순수 로직 검증 (DB-free)
import assert from 'node:assert';
import { computeSendTrendForecast, computeMissedOpportunity } from '../forecast';

// 1) 데이터 부족(3일 미만) → available false
let f = computeSendTrendForecast([]);
assert.equal(f.available, false);
assert.equal(f.projectedNextPeriod, null);
f = computeSendTrendForecast([10, 20]);
assert.equal(f.available, false);

// 2) 증가 추세 → up, slope>0, 매출 예측은 데이터부족
f = computeSendTrendForecast([10, 20, 30, 40]);
assert.equal(f.available, true);
assert.ok(f.slopePerDay > 0);
assert.equal(f.direction, 'up');
assert.equal(f.revenueAvailable, false);

// 3) 감소 추세 → down, slope<0
f = computeSendTrendForecast([40, 30, 20, 10]);
assert.equal(f.direction, 'down');
assert.ok(f.slopePerDay < 0);

// 4) 평평 → flat, slope 0
f = computeSendTrendForecast([10, 10, 10]);
assert.equal(f.direction, 'flat');
assert.ok(Math.abs(f.slopePerDay) < 1e-9);

// 5) 급감 → 다음 기간 예측 음수 floor 0
f = computeSendTrendForecast([5, 4, 3, 2, 1]);
assert.ok(f.projectedNextPeriod !== null);
assert.ok((f.projectedNextPeriod as number) >= 0);

// 6) 증가 추세 다음 기간 예측 = 추세 반영 합
f = computeSendTrendForecast([10, 20, 30, 40]);
assert.equal(f.projectedNextPeriod, 50 + 60 + 70 + 80);

// 7) recentAvg = 시계열 평균
f = computeSendTrendForecast([10, 20, 30]);
assert.ok(Math.abs(f.recentAvg - 20) < 1e-9);

// 8) 놓친 기회 — 이탈위험/휴면 규모, 잠재매출 데이터부족(null)
const mo = computeMissedOpportunity([
  { label: '이탈 위험', count: 50, pct: 25, avgMonetary: 30000 },
  { label: '휴면', count: 30, pct: 15, avgMonetary: 10000 },
  { label: '충성 우수', count: 20, pct: 10, avgMonetary: 200000 },
]);
assert.equal(mo.atRiskCount, 50);
assert.equal(mo.dormantCount, 30);
assert.equal(mo.potentialRevenue, null);

// 9) 빈 세그먼트 → 0
const mo2 = computeMissedOpportunity([]);
assert.equal(mo2.atRiskCount, 0);
assert.equal(mo2.dormantCount, 0);

console.log('forecast pure: PASS');
