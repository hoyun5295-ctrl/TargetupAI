/**
 * plan-guard.verify.ts — 종량제 전환(Phase 3) 게이팅 순수 함수 단위 검증
 *
 * 실행: npx ts-node packages/backend/src/utils/__tests__/plan-guard.verify.ts
 * (DB import 0 = 연결 불필요. canUseFeature / isAiOperatorAllowed 순수 함수만.)
 *
 * 핵심: AI 기능 중 plan-guard가 실제 게이트인 5개(ai_messaging/ai_premium/
 *       mobile_dm/auto_campaign/ai_cdp) = 전 유료 플랜 개방. 사용량 통제는
 *       크레딧(callAIWithFallback의 checkCredit). FREE(미가입)만 차단.
 *       스팸(spam_filter/auto_spam_test) = 플래그 기반 그대로 유지(크레딧 무관·현금).
 *       ※ ai_cdp 런타임 실 게이트는 cdp-auth.ts isCdpEnabledForPlan(별도 검증).
 */
import assert from 'node:assert';
import { canUseFeature, isAiOperatorAllowed, type PlanContext } from '../plan-guard';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

function mkCtx(
  planCode: string,
  features: Partial<PlanContext['features']> = {},
  extra: Partial<PlanContext> = {},
): PlanContext {
  return {
    companyId: 'test-co',
    planCode,
    planName: planCode,
    subscriptionStatus: 'paid',
    trialExpiresAt: null,
    isTrialActive: false,
    features: {
      customer_db_enabled: false,
      target_send_enabled: false,
      ai_mapping_enabled: false,
      ai_messaging_enabled: false,
      ai_premium_enabled: false,
      auto_campaign_enabled: false,
      spam_filter_enabled: false,
      auto_spam_test_enabled: false,
      mobile_dm_enabled: false,
      cdp_enabled: false,
      ...features,
    },
    cdpEventsPerMonth: null,
    maxAutoCampaigns: null,
    autoCampaignOverride: null,
    directRecipientLimit: null,
    legacyGrandfathered: false,
    aiOperatorTrialStartedAt: null,
    aiOperatorTrialUntil: null,
    isAiOperatorTrialActive: false,
    ...extra,
  };
}

console.log('[plan-guard] canUseFeature — AI 5종 전 유료 개방 (플래그 무관, 크레딧 통제)');
ok('STARTER ai_messaging = 허용 (플래그 false여도 — 종량제 개방)', () =>
  assert.strictEqual(canUseFeature(mkCtx('STARTER'), 'ai_messaging').allowed, true));
ok('STARTER ai_premium = 허용', () =>
  assert.strictEqual(canUseFeature(mkCtx('STARTER'), 'ai_premium').allowed, true));
ok('STARTER mobile_dm = 허용', () =>
  assert.strictEqual(canUseFeature(mkCtx('STARTER'), 'mobile_dm').allowed, true));
ok('STARTER auto_campaign = 허용', () =>
  assert.strictEqual(canUseFeature(mkCtx('STARTER'), 'auto_campaign').allowed, true));
ok('STARTER ai_cdp = 허용 (실 게이트는 cdp-auth.ts — 여기는 일관성용)', () =>
  assert.strictEqual(canUseFeature(mkCtx('STARTER'), 'ai_cdp').allowed, true));
ok('BASIC ai_messaging = 허용', () =>
  assert.strictEqual(canUseFeature(mkCtx('BASIC'), 'ai_messaging').allowed, true));
ok('TRIAL ai_premium = 허용', () =>
  assert.strictEqual(canUseFeature(mkCtx('TRIAL'), 'ai_premium').allowed, true));

console.log('[plan-guard] canUseFeature — FREE(미가입)는 AI 차단');
ok('FREE ai_messaging = 차단', () =>
  assert.strictEqual(canUseFeature(mkCtx('FREE'), 'ai_messaging').allowed, false));
ok('FREE ai_premium = 차단', () =>
  assert.strictEqual(canUseFeature(mkCtx('FREE'), 'ai_premium').allowed, false));
ok('FREE mobile_dm = 차단', () =>
  assert.strictEqual(canUseFeature(mkCtx('FREE'), 'mobile_dm').allowed, false));
ok('FREE auto_campaign = 차단', () =>
  assert.strictEqual(canUseFeature(mkCtx('FREE'), 'auto_campaign').allowed, false));
ok('FREE ai_cdp = 차단', () =>
  assert.strictEqual(canUseFeature(mkCtx('FREE'), 'ai_cdp').allowed, false));

console.log('[plan-guard] canUseFeature — 구독 만료/정지는 전부 차단(우선순위)');
ok('STARTER expired → ai_messaging 차단', () =>
  assert.strictEqual(
    canUseFeature(mkCtx('STARTER', {}, { subscriptionStatus: 'expired' }), 'ai_messaging').allowed,
    false,
  ));
ok('STARTER suspended → auto_campaign 차단', () =>
  assert.strictEqual(
    canUseFeature(mkCtx('STARTER', {}, { subscriptionStatus: 'suspended' }), 'auto_campaign').allowed,
    false,
  ));

console.log('[plan-guard] canUseFeature — auto_campaign 회사별 override 보존');
ok('override 0 → 차단 (관리자 비활성 유지)', () =>
  assert.strictEqual(
    canUseFeature(mkCtx('PRO', {}, { autoCampaignOverride: 0 }), 'auto_campaign').allowed,
    false,
  ));
ok('override 5 → 허용', () =>
  assert.strictEqual(
    canUseFeature(mkCtx('STARTER', {}, { autoCampaignOverride: 5 }), 'auto_campaign').allowed,
    true,
  ));

console.log('[plan-guard] canUseFeature — 스팸은 플래그 기반 유지 (크레딧 무관·현금)');
ok('spam_filter 플래그 true → 허용', () =>
  assert.strictEqual(canUseFeature(mkCtx('STARTER', { spam_filter_enabled: true }), 'spam_filter').allowed, true));
ok('spam_filter 플래그 false → 차단 (개방 안 됨)', () =>
  assert.strictEqual(canUseFeature(mkCtx('STARTER', { spam_filter_enabled: false }), 'spam_filter').allowed, false));
ok('auto_spam_test 플래그 false → 차단 (개방 안 됨)', () =>
  assert.strictEqual(canUseFeature(mkCtx('STARTER', { auto_spam_test_enabled: false }), 'auto_spam_test').allowed, false));
ok('auto_spam_test 플래그 true → 허용', () =>
  assert.strictEqual(canUseFeature(mkCtx('PRO', { auto_spam_test_enabled: true }), 'auto_spam_test').allowed, true));

console.log('[plan-guard] canUseFeature — 비-AI 게이트 유지');
ok('basic_send 항상 허용', () =>
  assert.strictEqual(canUseFeature(mkCtx('FREE'), 'basic_send').allowed, true));
ok('customer_db 플래그 false → 차단', () =>
  assert.strictEqual(canUseFeature(mkCtx('FREE'), 'customer_db').allowed, false));
ok('ai_mapping 플래그 false → 차단 (STARTER+ 유지)', () =>
  assert.strictEqual(canUseFeature(mkCtx('FREE'), 'ai_mapping').allowed, false));
ok('customer_db 플래그 true → 허용', () =>
  assert.strictEqual(canUseFeature(mkCtx('STARTER', { customer_db_enabled: true }), 'customer_db').allowed, true));

console.log('[plan-guard] isAiOperatorAllowed — 전 유료 플랜 개방 (ENTERPRISE 전용 폐지)');
ok('super_admin → 허용 (FREE라도)', () =>
  assert.strictEqual(isAiOperatorAllowed(mkCtx('FREE'), { userType: 'super_admin' }), true));
ok('STARTER → 허용 (종량제 개방)', () =>
  assert.strictEqual(isAiOperatorAllowed(mkCtx('STARTER'), { userType: 'company' }), true));
ok('PRO → 허용', () =>
  assert.strictEqual(isAiOperatorAllowed(mkCtx('PRO'), { userType: 'company' }), true));
ok('ENTERPRISE → 허용 (유지)', () =>
  assert.strictEqual(isAiOperatorAllowed(mkCtx('ENTERPRISE'), { userType: 'company' }), true));
ok('TRIAL → 허용', () =>
  assert.strictEqual(isAiOperatorAllowed(mkCtx('TRIAL'), { userType: 'company' }), true));
ok('FREE + 체험 없음 → 차단', () =>
  assert.strictEqual(isAiOperatorAllowed(mkCtx('FREE'), { userType: 'company' }), false));
ok('FREE + AI 오퍼레이션 30일 체험 → 허용', () =>
  assert.strictEqual(
    isAiOperatorAllowed(mkCtx('FREE', {}, { isAiOperatorTrialActive: true }), { userType: 'company' }),
    true,
  ));

console.log(`\n${passed} assertions passed`);
