/**
 * journey-send-time.verify.ts — calculateNextRunAt 순수 검증 (Phase 6A step1 시점)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-send-time.verify.ts
 * (DB import 0 — 연결 불필요. now를 고정 인자로 주입해 결정적으로 검증.)
 *
 * delay_mode 3종: relative / specific_hour / next_business_day + 야간가드(09시 KST).
 */
import assert from 'node:assert';
import { calculateNextRunAt } from '../send-time-util';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

// 기준 now = 2026-06-04 02:00Z = 11:00 KST (발송 가능 시간 [08,21) 안)
const noonKst = new Date('2026-06-04T02:00:00Z');
// 야간 now = 2026-06-04 15:00Z = 다음날 00:00 KST (발송 불가)
const midnightKst = new Date('2026-06-04T15:00:00Z');

console.log('[journey-send-time] relative');
ok('relative +2h, 주간 → now+2h 그대로', () =>
  assert.strictEqual(calculateNextRunAt('relative', 2, null, noonKst).toISOString(), '2026-06-04T04:00:00.000Z'));
ok('relative 야간 진입 → 다음 09시 KST(00:00Z)', () =>
  assert.strictEqual(calculateNextRunAt('relative', 0, null, midnightKst).toISOString(), '2026-06-05T00:00:00.000Z'));

console.log('[journey-send-time] specific_hour');
ok('target 15시, 현재 11시 → 오늘 15시 KST(06:00Z)', () =>
  assert.strictEqual(calculateNextRunAt('specific_hour', 0, 15, noonKst).toISOString(), '2026-06-04T06:00:00.000Z'));
ok('target 09시, 현재 11시(이미 지남) → 내일 09시 KST(00:00Z)', () =>
  assert.strictEqual(calculateNextRunAt('specific_hour', 0, 9, noonKst).toISOString(), '2026-06-05T00:00:00.000Z'));

console.log('[journey-send-time] next_business_day');
ok('다음 평일 09시 KST (UTC 00시 + 평일)', () => {
  const r = calculateNextRunAt('next_business_day', 0, null, noonKst);
  assert.strictEqual(r.getUTCHours(), 0);                 // KST 09시 = UTC 00시
  const kstDay = new Date(r.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
  assert.ok(kstDay >= 1 && kstDay <= 5);                  // 월~금
});

console.log('[journey-send-time] relative_at_hour');
ok('3일(72h) 후 09시 → 6/7 09시 KST(6/7 00:00Z)', () =>
  assert.strictEqual(calculateNextRunAt('relative_at_hour', 72, 9, noonKst).toISOString(), '2026-06-07T00:00:00.000Z'));
ok('0일 후 09시(오늘 09시 이미 지남, 현재 11시) → 내일 09시(6/5 00:00Z)', () =>
  assert.strictEqual(calculateNextRunAt('relative_at_hour', 0, 9, noonKst).toISOString(), '2026-06-05T00:00:00.000Z'));
ok('1일(24h) 후 15시 → 6/5 15시 KST(6/5 06:00Z)', () =>
  assert.strictEqual(calculateNextRunAt('relative_at_hour', 24, 15, noonKst).toISOString(), '2026-06-05T06:00:00.000Z'));
ok('target null이면 relative로 폴백(+2h)', () =>
  assert.strictEqual(calculateNextRunAt('relative_at_hour', 2, null, noonKst).toISOString(), '2026-06-04T04:00:00.000Z'));

console.log(`\n${passed} assertions passed`);
process.exit(0);  // send-time-util → config/defaults 측 비동기 핸들(Redis 재시도) 정리용 — 검증 완료 후 즉시 종료
