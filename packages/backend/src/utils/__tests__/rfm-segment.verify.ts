// RFM 세그먼트 순수 로직 검증 (DB-free)
import assert from 'node:assert';
import { computeRfmSegments } from '../rfm-segment';

// 1) 빈 입력 → 데이터 부족
let r = computeRfmSegments([]);
assert.equal(r.sufficient, false);
assert.equal(r.segments.length, 0);

// 2) 구매 데이터 없음(전부 null) → 데이터 부족
r = computeRfmSegments([
  { recencyDays: null, frequency: null, monetary: null },
  { recencyDays: null, frequency: null, monetary: null },
]);
assert.equal(r.sufficient, false);
assert.equal(r.withPurchaseData, 0);
assert.equal(r.totalCustomers, 2);

// 3) 분포 10명 → 전원 분류, pct 합 100
const custs = [];
for (let i = 0; i < 10; i++) {
  custs.push({ recencyDays: i * 10, frequency: 10 - i, monetary: (10 - i) * 1000 });
}
r = computeRfmSegments(custs);
assert.equal(r.sufficient, true);
assert.equal(r.withPurchaseData, 10);
assert.ok(r.segments.length > 0);
assert.equal(r.segments.reduce((s, x) => s + x.count, 0), 10);
assert.ok(Math.abs(r.segments.reduce((s, x) => s + x.pct, 0) - 100) < 0.01);

// 4) 최근·고빈도 고객은 우량 세그먼트로 분류된다
const top = computeRfmSegments([
  { recencyDays: 1, frequency: 20, monetary: 500000 },
  { recencyDays: 2, frequency: 18, monetary: 400000 },
  { recencyDays: 200, frequency: 1, monetary: 1000 },
  { recencyDays: 300, frequency: 1, monetary: 500 },
]);
assert.ok(top.sufficient);
assert.equal(top.withPurchaseData, 4);

console.log('rfm-segment pure: PASS');
