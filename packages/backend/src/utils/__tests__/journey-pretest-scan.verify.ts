/**
 * journey-pretest-scan.verify.ts — 발송 2시간 전 스캔 순수 코어 검증 (Phase 6B)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-pretest-scan.verify.ts
 * (DB import 0 — 연결 불필요.)
 *
 * groupPretestBundles: 임박 발송 execution들을 (journey, step, KST날짜)당 1 bundle로 묶고,
 *   가장 이른 발송시각 + 담당자 알림 여부(첫/마지막 ON, 중간 OFF default)를 결정.
 */
import assert from 'node:assert';
import { groupPretestBundles, kstDateOf } from '../journey-pretest-scan';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

function row(over: Record<string, any> = {}): any {
  return {
    execution_id: 'e1', journey_id: 'j1', company_id: 'c1', created_by: null,
    next_run_at: new Date('2026-06-04T03:00:00Z'), // 12:00 KST
    step_id: 's1', channel: 'sms', is_ad: true, subject: null,
    notify_manager_on_pretest: null, step_order: 1, total_steps: 3,
    ...over,
  };
}

console.log('[journey-pretest-scan] kstDateOf');
ok('UTC 15:30 → KST 다음날 날짜', () =>
  assert.strictEqual(kstDateOf(new Date('2026-06-04T15:30:00Z')), '2026-06-05'));
ok('UTC 03:00 → KST 같은 날', () =>
  assert.strictEqual(kstDateOf(new Date('2026-06-04T03:00:00Z')), '2026-06-04'));

console.log('[journey-pretest-scan] dedup');
ok('같은 journey·step·날짜 = 1 bundle (가장 이른 시각)', () => {
  const b = groupPretestBundles([
    row({ execution_id: 'e1', next_run_at: new Date('2026-06-04T03:00:00Z') }),
    row({ execution_id: 'e2', next_run_at: new Date('2026-06-04T02:00:00Z') }),
  ]);
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].executionId, 'e2');
  assert.strictEqual(b[0].scheduledSendAt.toISOString(), '2026-06-04T02:00:00.000Z');
});
ok('다른 step = 다른 bundle', () =>
  assert.strictEqual(groupPretestBundles([row({ step_id: 's1' }), row({ step_id: 's2' })]).length, 2));
ok('다른 KST 날짜 = 다른 bundle', () =>
  assert.strictEqual(groupPretestBundles([
    row({ next_run_at: new Date('2026-06-04T03:00:00Z') }),
    row({ next_run_at: new Date('2026-06-04T15:30:00Z') }),
  ]).length, 2));

console.log('[journey-pretest-scan] notify 판정 (첫/마지막 ON, 중간 OFF)');
ok('explicit true → notify', () =>
  assert.strictEqual(groupPretestBundles([row({ notify_manager_on_pretest: true, step_order: 2 })])[0].notifyManager, true));
ok('explicit false → no notify', () =>
  assert.strictEqual(groupPretestBundles([row({ notify_manager_on_pretest: false, step_order: 1 })])[0].notifyManager, false));
ok('null + 첫 step → notify', () =>
  assert.strictEqual(groupPretestBundles([row({ notify_manager_on_pretest: null, step_order: 1, total_steps: 3 })])[0].notifyManager, true));
ok('null + 중간 step → no notify', () =>
  assert.strictEqual(groupPretestBundles([row({ notify_manager_on_pretest: null, step_order: 2, total_steps: 3 })])[0].notifyManager, false));
ok('null + 마지막 step → notify', () =>
  assert.strictEqual(groupPretestBundles([row({ notify_manager_on_pretest: null, step_order: 3, total_steps: 3 })])[0].notifyManager, true));

console.log(`\n${passed} assertions passed`);
process.exit(0);
