/**
 * journey-step-format.verify.ts — 발송 시점·조건 칩 순수 포맷터 검증 (Phase 9 Task 2)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-step-format.verify.ts
 * (DB import 0 — 순수 함수만. 저장 여정 상세/타임라인 라벨 단일 출처.)
 */
import assert from 'node:assert';
import { formatStepTiming, formatConditionChip } from '../journey-step-format';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[journey-step-format] formatStepTiming');
ok('relative_at_hour 3일+9시 step1', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'relative_at_hour', delayHours: 72, targetHourKst: 9 }, true), '트리거 후 3일 뒤 · 09시'));
ok('relative 일 단위 step2', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'relative', delayHours: 48, targetHourKst: null }, false), '직전 단계 후 2일 뒤'));
ok('relative 시간 단위(24h 미만)', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'relative', delayHours: 2, targetHourKst: null }, false), '직전 단계 후 2시간 뒤'));
ok('specific_hour', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'specific_hour', delayHours: 0, targetHourKst: 10 }, false), '다음 10시에 발송'));
ok('next_business_day', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'next_business_day', delayHours: 0, targetHourKst: null }, false), '다음 평일 09시'));

console.log('[journey-step-format] formatConditionChip');
ok('customer_field 숫자 비교', () =>
  assert.strictEqual(formatConditionChip({ type: 'customer_field', field: 'recent_purchase_amount', operator: '>=', value: 100000 }), '최근구매금액 ≥ 100,000'));
ok('customer_field not_null', () =>
  assert.strictEqual(formatConditionChip({ type: 'customer_field', field: 'points', operator: 'not_null', value: null }), '포인트 값있음'));
ok('cdp_event_exists not_exists', () =>
  assert.strictEqual(formatConditionChip({ type: 'cdp_event_exists', event_name: 'purchase', within_days: 7, presence: 'not_exists' }), '7일 내 구매 없음'));
ok('journey_step_clicked false', () =>
  assert.strictEqual(formatConditionChip({ type: 'journey_step_clicked', step_order: 1, within_days: 5, clicked: false }), 'Step 1 미클릭'));

console.log(`\n${passed} assertions passed`);
process.exit(0);
