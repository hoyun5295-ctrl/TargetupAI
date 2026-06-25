/**
 * system-alert-cooldown.verify.ts — 시스템 알림 쿨다운 판단 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/system-alert-cooldown.verify.ts
 * (DB import 0 — isAlertOnCooldown 순수 함수만 검증.)
 *
 * 2026-06-25: 쿨다운이 프로세스 메모리라 pm2 재시작마다 초기화 → 싱크에이전트 중단 알림 종일 재발송.
 *   상태를 PG(system_alert_state)에 영속화. 쿨다운 판단 자체는 이 순수 함수로 분리해 검증.
 */
import assert from 'node:assert';
import { isAlertOnCooldown } from '../system-alert-cooldown';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const H = 60 * 60 * 1000;
const COOLDOWN = 12 * H;
const NOW = 1_000_000_000_000;

console.log('[system-alert-cooldown] isAlertOnCooldown — 발송 전 last_sent_at 기준 쿨다운 판단');

ok('첫 발송(last_sent_at 없음) → 쿨다운 아님(발송 허용)', () =>
  assert.strictEqual(isAlertOnCooldown(null, COOLDOWN, NOW), false));

ok('직전 발송 1시간 전(12h 쿨다운) → 쿨다운 중(skip)', () =>
  assert.strictEqual(isAlertOnCooldown(NOW - 1 * H, COOLDOWN, NOW), true));

ok('직전 발송 13시간 전(12h 쿨다운) → 쿨다운 경과(발송 허용)', () =>
  assert.strictEqual(isAlertOnCooldown(NOW - 13 * H, COOLDOWN, NOW), false));

ok('정확히 12시간 전 = 경계 → 발송 허용(< 비교)', () =>
  assert.strictEqual(isAlertOnCooldown(NOW - 12 * H, COOLDOWN, NOW), false));

ok('하루 2번 시나리오: 09시 발송 후 14시(5h) → skip', () =>
  assert.strictEqual(isAlertOnCooldown(NOW - 5 * H, COOLDOWN, NOW), true));

ok('하루 2번 시나리오: 09시 발송 후 21시(12h) → 발송 허용(= 2번째)', () =>
  assert.strictEqual(isAlertOnCooldown(NOW - 12 * H, COOLDOWN, NOW), false));

ok('undefined(미조회)도 발송 허용으로 취급', () =>
  assert.strictEqual(isAlertOnCooldown(undefined, COOLDOWN, NOW), false));

console.log(`\n[system-alert-cooldown] ${passed}/7 passed`);
