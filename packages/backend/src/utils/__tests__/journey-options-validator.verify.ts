/**
 * journey-options-validator.verify.ts — 여정 옵션 정규화 순수 검증 (Phase 9 Task 3)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-options-validator.verify.ts
 * (DB import 0 — 순수. 입력 계약(camelCase + trigger_filters 키)을 안전 범위로 정규화.)
 */
import assert from 'node:assert';
import { normalizeJourneyOptions } from '../journey-options-validator';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[journey-options-validator] triggerFilters');
ok('days_before 999 → 90 클램프', () =>
  assert.strictEqual(normalizeJourneyOptions({ days_before: 999 }).triggerFilters.days_before, 90));
ok('recent_hours 0 → 1 클램프', () =>
  assert.strictEqual(normalizeJourneyOptions({ recent_hours: 0 }).triggerFilters.recent_hours, 1));
ok('expiry_month_day 13-01(잘못) → 빈문자', () =>
  assert.strictEqual(normalizeJourneyOptions({ expiry_month_day: '13-01' }).triggerFilters.expiry_month_day, ''));
ok('expiry_month_day 03-15(정상) → 그대로', () =>
  assert.strictEqual(normalizeJourneyOptions({ expiry_month_day: '03-15' }).triggerFilters.expiry_month_day, '03-15'));
ok('expiry_mode weird → inactivity', () =>
  assert.strictEqual(normalizeJourneyOptions({ expiry_mode: 'weird' }).triggerFilters.expiry_mode, 'inactivity'));
ok('미지정 키는 triggerFilters에 없음', () =>
  assert.strictEqual('recent_hours' in normalizeJourneyOptions({ days_before: 7 }).triggerFilters, false));

console.log('[journey-options-validator] options');
ok('thresholdCost 음수 → null', () =>
  assert.strictEqual(normalizeJourneyOptions({ thresholdCost: -100 }).options.thresholdCost, null));
ok('thresholdRecipients 500 → 500', () =>
  assert.strictEqual(normalizeJourneyOptions({ thresholdRecipients: 500 }).options.thresholdRecipients, 500));
ok('thresholdRiskLevel extreme → low', () =>
  assert.strictEqual(normalizeJourneyOptions({ thresholdRiskLevel: 'extreme' }).options.thresholdRiskLevel, 'low'));
ok('reentryCooldownDays 9999 → 365', () =>
  assert.strictEqual(normalizeJourneyOptions({ reentryCooldownDays: 9999 }).options.reentryCooldownDays, 365));
ok('callbackMode weird → fixed', () =>
  assert.strictEqual(normalizeJourneyOptions({ callbackMode: 'weird' }).options.callbackMode, 'fixed'));
ok('callbackMode store → store', () =>
  assert.strictEqual(normalizeJourneyOptions({ callbackMode: 'store' }).options.callbackMode, 'store'));
// ★ 2026-07-10 목표 달성 시 자동 종료 — boolean 정규화(true/'true'만 true, 그 외 전부 false)
ok('goalExitEnabled true → true', () =>
  assert.strictEqual(normalizeJourneyOptions({ goalExitEnabled: true }).options.goalExitEnabled, true));
ok('goalExitEnabled "true" → true', () =>
  assert.strictEqual(normalizeJourneyOptions({ goalExitEnabled: 'true' }).options.goalExitEnabled, true));
ok('goalExitEnabled 미지정/이상값 → false', () => {
  assert.strictEqual(normalizeJourneyOptions({}).options.goalExitEnabled, false);
  assert.strictEqual(normalizeJourneyOptions({ goalExitEnabled: 1 }).options.goalExitEnabled, false);
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
