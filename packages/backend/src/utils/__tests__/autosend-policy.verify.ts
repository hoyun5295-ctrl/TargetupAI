/**
 * autosend-policy.verify.ts — 자동마케팅 자율 발송 순수 정책 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/autosend-policy.verify.ts
 * (DB import 0 — 순수 로직만.)
 */
import assert from 'node:assert';
import { resolveAutoSendLeadMinutes, computeScheduledSendAt, decideSendOutcome } from '../autosend-policy';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[autosend-policy] resolveAutoSendLeadMinutes — null→120, clamp 1..1440');
ok('null → 120', () => assert.strictEqual(resolveAutoSendLeadMinutes(null), 120));
ok('undefined → 120', () => assert.strictEqual(resolveAutoSendLeadMinutes(undefined), 120));
ok('0/음수 → 120', () => { assert.strictEqual(resolveAutoSendLeadMinutes(0), 120); assert.strictEqual(resolveAutoSendLeadMinutes(-5), 120); });
ok('정상값 유지', () => assert.strictEqual(resolveAutoSendLeadMinutes(30), 30));
ok('상한 1440 clamp', () => assert.strictEqual(resolveAutoSendLeadMinutes(99999), 1440));

console.log('[autosend-policy] computeScheduledSendAt — now + lead분(준비 시각 + 정지 창)');
ok('now + 120분', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  assert.strictEqual(computeScheduledSendAt(now, 120).getTime(), now.getTime() + 120 * 60 * 1000);
});
ok('now + 30분', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  assert.strictEqual(computeScheduledSendAt(now, 30).getTime(), now.getTime() + 30 * 60 * 1000);
});

console.log('[autosend-policy] decideSendOutcome — 0건/잔액 → skip+notify, 정상 → send');
ok('0건 → skip + notify', () => {
  const o = decideSendOutcome({ recipientCount: 0, balanceOk: true });
  assert.strictEqual(o.action, 'skip'); assert.strictEqual(o.notify, true);
});
ok('잔액 부족 → skip + notify', () => {
  const o = decideSendOutcome({ recipientCount: 10, balanceOk: false });
  assert.strictEqual(o.action, 'skip'); assert.strictEqual(o.notify, true);
});
ok('정상 → send', () => {
  const o = decideSendOutcome({ recipientCount: 10, balanceOk: true });
  assert.strictEqual(o.action, 'send'); assert.strictEqual(o.notify, false);
});

console.log(`\n${passed} assertions passed`);
