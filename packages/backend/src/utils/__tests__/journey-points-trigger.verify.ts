/**
 * journey-points-trigger.verify.ts — 포인트 소멸 trigger 설정 정규화 순수 검증 (Phase 8)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-points-trigger.verify.ts
 * (DB import 0 — 연결 불필요.)
 *
 * resolvePointsExpiringConfig: trigger_filters를 안전하게 정규화.
 *   2모드 — inactivity(미사용) / annual_date(연 단위 소멸일 D-N).
 */
import assert from 'node:assert';
import { resolvePointsExpiringConfig } from '../journey-points-trigger';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[journey-points-trigger] points_min');
ok('숫자 문자열 파싱', () => assert.strictEqual(resolvePointsExpiringConfig({ points_min: '5000' }).pointsMin, 5000));
ok('음수 → 0', () => assert.strictEqual(resolvePointsExpiringConfig({ points_min: -10 }).pointsMin, 0));
ok('미설정 → 0', () => assert.strictEqual(resolvePointsExpiringConfig({}).pointsMin, 0));

console.log('[journey-points-trigger] mode');
ok('annual_date 명시', () => assert.strictEqual(resolvePointsExpiringConfig({ expiry_mode: 'annual_date' }).mode, 'annual_date'));
ok('미설정 → inactivity', () => assert.strictEqual(resolvePointsExpiringConfig({}).mode, 'inactivity'));
ok('이상한 값 → inactivity', () => assert.strictEqual(resolvePointsExpiringConfig({ expiry_mode: 'xyz' }).mode, 'inactivity'));

console.log('[journey-points-trigger] inactive_days / days_before');
ok('inactive_days 미설정 → 180', () => assert.strictEqual(resolvePointsExpiringConfig({}).inactiveDays, 180));
ok('inactive_days 0 이하 → 1로 클램프', () => assert.strictEqual(resolvePointsExpiringConfig({ inactive_days: 0 }).inactiveDays, 1));
ok('days_before 미설정 → 14', () => assert.strictEqual(resolvePointsExpiringConfig({}).daysBefore, 14));
ok('days_before 상한 90 클램프', () => assert.strictEqual(resolvePointsExpiringConfig({ days_before: 999 }).daysBefore, 90));
ok('days_before 음수 → 0', () => assert.strictEqual(resolvePointsExpiringConfig({ days_before: -5 }).daysBefore, 0));
ok('days_before 0 → 0 (D-Day 당일, 미설정과 구분)', () => assert.strictEqual(resolvePointsExpiringConfig({ days_before: 0 }).daysBefore, 0));

console.log('[journey-points-trigger] expiry_month_day (MM-DD 검증)');
ok('정상 12-31', () => assert.strictEqual(resolvePointsExpiringConfig({ expiry_month_day: '12-31' }).expiryMonthDay, '12-31'));
ok('잘못된 월 13-01 → 빈값', () => assert.strictEqual(resolvePointsExpiringConfig({ expiry_month_day: '13-01' }).expiryMonthDay, ''));
ok('형식 오류 → 빈값', () => assert.strictEqual(resolvePointsExpiringConfig({ expiry_month_day: 'abc' }).expiryMonthDay, ''));
ok('미설정 → 빈값', () => assert.strictEqual(resolvePointsExpiringConfig({}).expiryMonthDay, ''));

console.log(`\n${passed} assertions passed`);
process.exit(0);
