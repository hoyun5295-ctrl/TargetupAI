/**
 * journey-anchor-time.verify.ts — 날짜축 여정 절대 타이밍·반복 순수 함수 가드 (DB import 0).
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-anchor-time.verify.ts
 */
import assert from 'node:assert';
import { computeAnchorStepRunAt, computeNextAnchor, isAnchorCycleComplete } from '../send-time-util';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const kstHourOf = (d: Date) => new Date(d.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
const kstDateStr = (d: Date) => new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

console.log('[journey-anchor-time] 검증');

// computeAnchorStepRunAt — (anchor − offset)일 hourKst시 KST
ok('D-7 10시 = 앵커 7일 전 10시 KST', () => {
  const anchor = new Date(Date.UTC(2026, 5, 30)); // 2026-06-30
  const r = computeAnchorStepRunAt(anchor, 7, 10);
  assert.strictEqual(r.toISOString(), '2026-06-23T01:00:00.000Z'); // KST 06-23 10:00
  assert.strictEqual(kstHourOf(r), 10);
  assert.strictEqual(kstDateStr(r), '2026-06-23');
});
ok('D-0 = 앵커 당일 hourKst시', () => {
  const anchor = new Date(Date.UTC(2026, 5, 30));
  const r = computeAnchorStepRunAt(anchor, 0, 10);
  assert.strictEqual(kstDateStr(r), '2026-06-30');
  assert.strictEqual(kstHourOf(r), 10);
});
ok('월 경계 롤오버 (07-02 D-3 → 06-29)', () => {
  const anchor = new Date(Date.UTC(2026, 6, 2)); // 2026-07-02
  const r = computeAnchorStepRunAt(anchor, 3, 10);
  assert.strictEqual(kstDateStr(r), '2026-06-29');
});
ok('야간(03시) → 발송가능 09시 KST로 가드', () => {
  const anchor = new Date(Date.UTC(2026, 5, 30));
  const r = computeAnchorStepRunAt(anchor, 0, 3);
  assert.strictEqual(kstHourOf(r), 9); // shiftToSendableHour ARRIVE_HOUR
});

// computeNextAnchor
ok('none → null', () => assert.strictEqual(computeNextAnchor('none', null, new Date(Date.UTC(2026, 5, 30))), null));
ok('monthly_day 15 → 다음 달 15일', () => {
  const r = computeNextAnchor('monthly_day', 15, new Date(Date.UTC(2026, 5, 30)))!;
  assert.strictEqual(r.toISOString(), '2026-07-15T00:00:00.000Z');
});
ok('monthly_day 31 → 2월은 말일로 클램프(28)', () => {
  const r = computeNextAnchor('monthly_day', 31, new Date(Date.UTC(2026, 0, 31)))!; // 2026-01-31 → Feb
  assert.strictEqual(r.toISOString(), '2026-02-28T00:00:00.000Z');
});
ok('monthly_last → 다음 달 말일', () => {
  const r = computeNextAnchor('monthly_last', null, new Date(Date.UTC(2026, 5, 30)))!; // June last → July 31
  assert.strictEqual(r.toISOString(), '2026-07-31T00:00:00.000Z');
});
ok('yearly → 내년 같은 날', () => {
  const r = computeNextAnchor('yearly', null, new Date(Date.UTC(2026, 5, 30)))!;
  assert.strictEqual(r.toISOString(), '2027-06-30T00:00:00.000Z');
});

// isAnchorCycleComplete — D-0(최소 offset) 발송일 지났는가
ok('D-0 당일 = 아직 미완(false → 그날 D-0 발송)', () => {
  const anchor = new Date(Date.UTC(2026, 5, 30));
  const now = new Date(Date.UTC(2026, 5, 30, 3, 0, 0)); // KST 06-30 12:00
  assert.strictEqual(isAnchorCycleComplete(0, anchor, now), false);
});
ok('D-0 다음날 = 완료(true)', () => {
  const anchor = new Date(Date.UTC(2026, 5, 30));
  const now = new Date(Date.UTC(2026, 6, 1, 3, 0, 0)); // KST 07-01
  assert.strictEqual(isAnchorCycleComplete(0, anchor, now), true);
});
ok('D-0 이전 = 미완(false)', () => {
  const anchor = new Date(Date.UTC(2026, 5, 30));
  const now = new Date(Date.UTC(2026, 5, 29, 3, 0, 0)); // KST 06-29
  assert.strictEqual(isAnchorCycleComplete(0, anchor, now), false);
});

console.log(`\n[journey-anchor-time] ${passed} passed`);
process.exit(0); // send-time-util → config/defaults 가 Redis 클라이언트를 띄워 종료가 막힘 — 명시 종료.
