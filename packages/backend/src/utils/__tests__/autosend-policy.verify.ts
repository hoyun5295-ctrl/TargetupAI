/**
 * autosend-policy.verify.ts — 자동마케팅 자율 발송 순수 정책 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/autosend-policy.verify.ts
 * (DB import 0 — 순수 로직만.)
 */
import assert from 'node:assert';
import { resolveAutoSendLeadMinutes, computeScheduledSendAt, decideSendOutcome, decideStuckSendingRecovery, normalizeCdpAutoExecuteGate, decideBudgetGuard } from '../autosend-policy';

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

console.log('[autosend-policy] decideStuckSendingRecovery — sending 정지 복구 판정');
ok('campaign_id 있음 → mark_sent (이미 커밋, 시각 무관)', () => {
  const now = new Date('2026-12-01T01:00:00Z');
  assert.strictEqual(
    decideStuckSendingRecovery({ campaignId: 'c1', reviewedAt: new Date('2026-12-01T00:59:50Z') }, now),
    'mark_sent',
  );
});
ok('campaign_id null + 노후(>=30분) → demote_admin_review', () => {
  const now = new Date('2026-12-01T01:00:00Z');
  assert.strictEqual(
    decideStuckSendingRecovery({ campaignId: null, reviewedAt: new Date('2026-12-01T00:25:00Z') }, now),
    'demote_admin_review',
  );
});
ok('campaign_id null + 최근(<30분) → keep', () => {
  const now = new Date('2026-12-01T01:00:00Z');
  assert.strictEqual(
    decideStuckSendingRecovery({ campaignId: null, reviewedAt: new Date('2026-12-01T00:40:00Z') }, now),
    'keep',
  );
});
ok('campaign_id null + reviewedAt null → keep (시각 모르면 손대지 X)', () => {
  const now = new Date('2026-12-01T01:00:00Z');
  assert.strictEqual(decideStuckSendingRecovery({ campaignId: null, reviewedAt: null }, now), 'keep');
});
ok('staleMinutes 커스텀 경계', () => {
  const now = new Date('2026-12-01T01:00:00Z');
  assert.strictEqual(
    decideStuckSendingRecovery({ campaignId: null, reviewedAt: new Date('2026-12-01T00:50:00Z') }, now, 10),
    'demote_admin_review',
  );
});

console.log('[autosend-policy] normalizeCdpAutoExecuteGate — 슈퍼관리자 게이트 입력 정규화');
ok('enabled — boolean true만 ON', () => {
  assert.strictEqual(normalizeCdpAutoExecuteGate({ enabled: true }).enabled, true);
  assert.strictEqual(normalizeCdpAutoExecuteGate({ enabled: 'true' }).enabled, false);
  assert.strictEqual(normalizeCdpAutoExecuteGate({ enabled: 1 }).enabled, false);
  assert.strictEqual(normalizeCdpAutoExecuteGate({}).enabled, false);
});
ok('maxRecipients — 미설정 1000, clamp [1, 1000000]', () => {
  assert.strictEqual(normalizeCdpAutoExecuteGate({}).maxRecipients, 1000);
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxRecipients: 0 }).maxRecipients, 1);
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxRecipients: 9_000_000 }).maxRecipients, 1_000_000);
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxRecipients: 500 }).maxRecipients, 500);
});
ok('maxCostKrw — 미설정 50000, clamp [1, 100000000]', () => {
  assert.strictEqual(normalizeCdpAutoExecuteGate({}).maxCostKrw, 50000);
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxCostKrw: 0 }).maxCostKrw, 1);
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxCostKrw: 999_999_999 }).maxCostKrw, 100_000_000);
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxCostKrw: 30000 }).maxCostKrw, 30000);
});
ok('maxRisk — 화이트리스트, 그 외 low', () => {
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxRisk: 'high' }).maxRisk, 'high');
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxRisk: 'medium' }).maxRisk, 'medium');
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxRisk: 'low' }).maxRisk, 'low');
  assert.strictEqual(normalizeCdpAutoExecuteGate({ maxRisk: 'extreme' }).maxRisk, 'low');
  assert.strictEqual(normalizeCdpAutoExecuteGate({}).maxRisk, 'low');
});

console.log('[autosend-policy] decideBudgetGuard — 자율 발송 직전 월/일 예산 재검증 (당월 로그 SUM, 누적 컬럼 X)');
ok('예산 둘 다 null → 무제한, over=false', () => {
  const r = decideBudgetGuard({ budgetMonthly: null, budgetDaily: null, spentMonth: 999999, spentToday: 999999, pendingCost: 50000 });
  assert.strictEqual(r.over, false); assert.strictEqual(r.scope, null);
});
ok('월: spent+pending > 한도 → over month', () => {
  const r = decideBudgetGuard({ budgetMonthly: 100000, budgetDaily: null, spentMonth: 90000, spentToday: 0, pendingCost: 20000 });
  assert.strictEqual(r.over, true); assert.strictEqual(r.scope, 'month');
});
ok('월: spent+pending == 한도 → over=false (정확히 한도 허용)', () => {
  const r = decideBudgetGuard({ budgetMonthly: 100000, budgetDaily: null, spentMonth: 90000, spentToday: 0, pendingCost: 10000 });
  assert.strictEqual(r.over, false); assert.strictEqual(r.scope, null);
});
ok('월: spent+pending < 한도 → over=false', () => {
  const r = decideBudgetGuard({ budgetMonthly: 100000, budgetDaily: null, spentMonth: 50000, spentToday: 0, pendingCost: 10000 });
  assert.strictEqual(r.over, false);
});
ok('일: month null + spent+pending > 일한도 → over day', () => {
  const r = decideBudgetGuard({ budgetMonthly: null, budgetDaily: 30000, spentMonth: 0, spentToday: 25000, pendingCost: 10000 });
  assert.strictEqual(r.over, true); assert.strictEqual(r.scope, 'day');
});
ok('월·일 둘 다 초과 → month 우선', () => {
  const r = decideBudgetGuard({ budgetMonthly: 100000, budgetDaily: 30000, spentMonth: 95000, spentToday: 25000, pendingCost: 10000 });
  assert.strictEqual(r.over, true); assert.strictEqual(r.scope, 'month');
});
ok('월 한도 OK + 일 한도 초과 → over day', () => {
  const r = decideBudgetGuard({ budgetMonthly: 1000000, budgetDaily: 30000, spentMonth: 50000, spentToday: 25000, pendingCost: 10000 });
  assert.strictEqual(r.over, true); assert.strictEqual(r.scope, 'day');
});
ok('pendingCost 음수/NaN → 0으로 보정(spent만으로 판정)', () => {
  const neg = decideBudgetGuard({ budgetMonthly: 100000, budgetDaily: null, spentMonth: 100000, spentToday: 0, pendingCost: -5000 });
  assert.strictEqual(neg.over, false); // 100000 + 0 == 100000, 초과 아님
  const nan = decideBudgetGuard({ budgetMonthly: 100000, budgetDaily: null, spentMonth: 100001, spentToday: 0, pendingCost: NaN });
  assert.strictEqual(nan.over, true); assert.strictEqual(nan.scope, 'month'); // 이미 한도 초과 상태
});
ok('over 시 reason 비어있지 않음', () => {
  const r = decideBudgetGuard({ budgetMonthly: 100000, budgetDaily: null, spentMonth: 90000, spentToday: 0, pendingCost: 20000 });
  assert.ok(r.reason.length > 0);
});

console.log(`\n${passed} assertions passed`);
