// 다차원 비교 순수 로직 검증 (DB-free)
import assert from 'node:assert';
import { computeTypeComparison, computeNewVsExisting } from '../multidim-comparison';

// 1) 빈 입력 → 빈 배열
assert.deepEqual(computeTypeComparison([]), []);

// 2) send_type별 합산 + successRate + 한글 라벨
let t = computeTypeComparison([
  { sendType: 'manual', sent: 100, success: 90 },
  { sendType: 'manual', sent: 100, success: 80 },
  { sendType: 'ai', sent: 50, success: 45 },
]);
const manual = t.find((x) => x.rawType === 'manual')!;
assert.equal(manual.campaigns, 2);
assert.equal(manual.sent, 200);
assert.equal(manual.success, 170);
assert.ok(Math.abs(manual.successRate - 0.85) < 1e-9);
assert.equal(manual.label, '직접 발송');
const ai = t.find((x) => x.rawType === 'ai')!;
assert.equal(ai.label, 'AI 발송');

// 3) sent=0 → successRate 0 (나눗셈 방어)
t = computeTypeComparison([{ sendType: 'journey', sent: 0, success: 0 }]);
assert.equal(t[0].successRate, 0);
assert.equal(t[0].label, '여정');

// 4) 미지 타입 → label '기타', rawType 원본 보존
t = computeTypeComparison([{ sendType: 'weird', sent: 20, success: 10 }]);
assert.equal(t[0].rawType, 'weird');
assert.equal(t[0].label, '기타');

// 5) null 타입 → label '기타'
t = computeTypeComparison([{ sendType: null, sent: 10, success: 5 }]);
assert.equal(t[0].label, '기타');

// 6) 정렬 = 발송량 내림차순
t = computeTypeComparison([
  { sendType: 'ai', sent: 10, success: 5 },
  { sendType: 'manual', sent: 100, success: 50 },
]);
assert.equal(t[0].rawType, 'manual');

// 7) 신규 vs 기존 — created_at 기준 분류
const day = 86400000;
const now = 1000 * day;
const periodStart = now - 30 * day;
let nv = computeNewVsExisting(
  [
    { createdAtMs: now - 5 * day },   // 신규(기간 내 가입)
    { createdAtMs: now - 50 * day },  // 기존
    { createdAtMs: now - 60 * day },  // 기존
    { createdAtMs: null },            // 가입일 불명 → 기존
  ],
  periodStart,
);
assert.equal(nv.newCount, 1);
assert.equal(nv.existingCount, 3);
assert.equal(nv.total, 4);
assert.ok(Math.abs(nv.newPct - 25) < 1e-9);

// 8) 발송 반응(구매) 비교는 cdp 필요 → 데이터부족
assert.equal(nv.reactionAvailable, false);

// 9) 빈 고객 → 0 / 나눗셈 방어
nv = computeNewVsExisting([], periodStart);
assert.equal(nv.newCount, 0);
assert.equal(nv.existingCount, 0);
assert.equal(nv.total, 0);
assert.equal(nv.newPct, 0);

console.log('multidim-comparison pure: PASS');
