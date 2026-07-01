/**
 * CT-17: 요금제·트라이얼·기능 게이팅 컨트롤타워 (2026-04-22 신설)
 *
 * 🎯 목적
 *   요금제 기반 기능 접근 판정의 유일한 진입점.
 *   - ai.ts 5곳, auto-campaigns.ts 2곳 등에 산재한 인라인 게이팅을 여기로 통합.
 *   - plans 테이블 플래그가 진실의 원천 — plan_code 하드코딩 금지.
 *
 * 🧭 2단계 상태 (Harold님 2026-04-22 확정)
 *   1) 요금제 미가입 (plan_code='FREE') — 레거시 이관 고객 중 유료 가입 안 한 상태.
 *      직접발송·수신거부·발송결과·예약(직접)·고객DB 는 사용 가능.
 *      스팸필터테스트·AI·자동화·모바일DM 은 잠금.
 *   2) 30일 무료체험 (plan_id=PRO + subscription_status='trial' + trial_expires_at)
 *      — 슈퍼관리자가 grant-trial로 부여. 30일 후 Cron이 FREE로 강등.
 *
 *   + 정식 가입 (STARTER/BASIC/PRO/BUSINESS/ENTERPRISE) — plans 플래그대로
 *
 * 🔓 기능별 허용 표 (종량제 전환 Phase 3 — Harold님 확정 2026-06-02)
 *   FREE        : 직접발송·수신거부·발송결과·예약(직접)·고객DB            (스팸필터 X, AI X)
 *   STARTER+    : 위 + 스팸필터테스트 + AI 전 기능(크레딧 잔액으로 통제)
 *
 *   ※ 종량제 = AI 기능(ai_messaging/ai_premium/mobile_dm/auto_campaign/ai_cdp)을
 *     요금제로 잠그지 않고 전 유료 플랜 개방 + AI 크레딧으로만 통제(checkCredit이 차단).
 *     plan-guard는 FREE(미가입)만 차단. 실제 사용량 차단은 callAIWithFallback.
 *   ※ 스팸(spam_filter/auto_spam_test) = 크레딧 무관(현금/후불) → 플래그 기반 그대로 유지.
 *   ※ 규모 제약(max_customers·max_auto_campaigns)·비-AI 게이트(customer_db 등) = 유지.
 *   ※ 판정은 plans 플래그가 진실의 원천. plan_code 하드코딩 금지(예외: isUnsubscribed=FREE).
 */

import { query } from '../config/database';

// ═══════════════════════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════════════════════

export type FeatureKey =
  | 'basic_send'        // 직접발송/수신거부/발송결과/예약(직접)  — FREE 포함 전 플랜 허용
  | 'customer_db'       // 한줄로 고객DB (업로드·관리·필터·조회)  — STARTER+
  | 'target_send'       // 직접타겟발송 (필터로 추출 후 발송)      — STARTER+
  | 'ai_mapping'        // 엑셀 업로드 AI 자동매핑                — STARTER+
  | 'spam_filter'       // 스팸필터 수동 테스트                    — STARTER+
  | 'ai_messaging'      // AI 메시지 생성/AI 타겟 추천            — BASIC+
  | 'ai_premium'        // 추천캠페인/AI 문안생성                  — PRO+ (D171: auto-relax 영구 제거)
  | 'auto_campaign'     // 자동발송                                — PRO+
  | 'mobile_dm'         // 모바일 DM 빌더                          — PRO+
  | 'auto_spam_test'    // 스팸테스트 자동화                       — PRO+
  | 'ai_cdp';           // ★ D172: 한줄로 CDP (자사몰 sync API)    — BUSINESS+

/**
 * 구독 상태.
 *   ※ 네이밍 주의: companies.status('active'/'inactive'/'terminated')와 혼동 금지.
 *     여기 subscription_status는 구독 관점(유료 가입 여부)이며 'paid'로 통일.
 *     (2026-04-22 이전에는 'active'를 혼용했으나 네이밍 충돌로 'paid' 일원화)
 */
export type SubscriptionStatus =
  | 'trial'           // 30일 PRO 체험 중
  | 'trial_expired'   // 체험 만료 (FREE 강등 후 마커)
  | 'paid'            // 정식 구독 (과거 'active' 대체)
  | 'expired'         // 구독 만료
  | 'suspended'       // 정지
  | null;

export interface PlanContext {
  companyId: string;
  planCode: string;                 // 'FREE' | 'STARTER' | 'BASIC' | 'PRO' | 'BUSINESS' | 'ENTERPRISE'
  planName: string;
  subscriptionStatus: SubscriptionStatus;
  trialExpiresAt: Date | null;
  isTrialActive: boolean;           // trial 중이고 아직 만료 안 됨
  features: {
    customer_db_enabled: boolean;
    target_send_enabled: boolean;
    ai_mapping_enabled: boolean;
    ai_messaging_enabled: boolean;
    ai_premium_enabled: boolean;
    auto_campaign_enabled: boolean;
    spam_filter_enabled: boolean;
    auto_spam_test_enabled: boolean;
    mobile_dm_enabled: boolean;
    cdp_enabled: boolean;                // ★ D172
  };
  cdpEventsPerMonth: number | null;      // ★ D172: NULL = 무제한(ENTERPRISE)
  maxAutoCampaigns: number | null;       // NULL = 무제한(ENTERPRISE)
  autoCampaignOverride: number | null;   // 회사별 오버라이드 (D76)
  directRecipientLimit: number | null;   // 직접발송 주소록 최대 건수 (FREE=99,999, 나머지 NULL=무제한)
  legacyGrandfathered: boolean;          // ★ D209+ (Harold 명시 2026-05-23): 기존 고객사 영역 (PRO + AI Operator 진입 허용 — 레퍼런스 확보 본질)
  // ★ D219+ Part 2 (2026-05-27): AI 오퍼레이션 30일 무료체험 별도 컬럼.
  //   기존 plan_id(TRIAL) + trial_expires_at = 전체 PRO 기능 무료 흐름과 분리.
  //   본 2 컬럼 = AI 오퍼레이션 메뉴만 무료체험 부여 (BASIC 사용자도 부여 가능).
  aiOperatorTrialStartedAt: Date | null;
  aiOperatorTrialUntil: Date | null;
  isAiOperatorTrialActive: boolean;      // ai_operator_trial_until > NOW()
}

export interface FeatureCheckResult {
  allowed: boolean;
  errorMsg?: string;
  errorCode?: string;
}

// ═══════════════════════════════════════════════════════════
// SQL SELECT 조각 — 기존 SELECT에 import하여 사용
// ═══════════════════════════════════════════════════════════

/**
 * 요금제·구독 상태를 한 번에 조회하는 SELECT 조각.
 * 호출부: `FROM companies c LEFT JOIN plans p ON c.plan_id = p.id` 형태에서 사용.
 */
export const PLAN_STATUS_SELECT_EXPR = `
  p.plan_code, p.plan_name, p.monthly_price, p.max_customers,
  p.customer_db_enabled,
  COALESCE(p.target_send_enabled, false) AS target_send_enabled,
  COALESCE(p.ai_mapping_enabled, false)  AS ai_mapping_enabled,
  p.ai_messaging_enabled, p.ai_premium_enabled,
  p.auto_campaign_enabled, p.max_auto_campaigns,
  p.spam_filter_enabled, p.auto_spam_test_enabled,
  COALESCE(p.mobile_dm_enabled, false) AS mobile_dm_enabled,
  COALESCE(p.cdp_enabled, false) AS cdp_enabled,
  p.cdp_events_per_month,
  p.direct_recipient_limit,
  c.auto_campaign_override, c.subscription_status, c.trial_expires_at,
  COALESCE(c.legacy_grandfathered, false) AS legacy_grandfathered,
  c.ai_operator_trial_started_at, c.ai_operator_trial_until
`.trim();

/**
 * 요금제 가입(유료) + 구독 정상 회사 판정 SQL 조각 — 일일 DB 분석·과금 같은 배치 대상 선별용.
 *   `FROM companies c JOIN plans p ON c.plan_id = p.id` 형태의 WHERE에서 사용.
 *   기준 = 미가입(FREE) 제외 + 구독 만료/정지 제외 (isUnsubscribed·isSubscriptionBlocked와 동일 기준, 단일 소스).
 *   TRIAL(무료체험) 포함 — plan_code 기준 FREE만 제외한다(TRIAL 제외를 원하면 조건 한 줄만 추가).
 *   subscription_status NULL(미설정)은 정상으로 취급(COALESCE '').
 */
export const ACTIVE_PAID_PLAN_WHERE =
  `p.plan_code <> 'FREE' AND COALESCE(c.subscription_status, '') NOT IN ('expired', 'suspended')`;

// ═══════════════════════════════════════════════════════════
// 통합 조회 — loadPlanContext
// ═══════════════════════════════════════════════════════════

export async function loadPlanContext(companyId: string): Promise<PlanContext | null> {
  const result = await query(
    `SELECT ${PLAN_STATUS_SELECT_EXPR}
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1`,
    [companyId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  const planCode = String(row.plan_code || 'FREE').toUpperCase();
  const subscriptionStatus: SubscriptionStatus = (row.subscription_status || null) as SubscriptionStatus;
  const trialExpiresAt: Date | null = row.trial_expires_at ? new Date(row.trial_expires_at) : null;
  const now = Date.now();
  // ★ isTrialActive 판정은 plan_code='TRIAL'을 진실의 원천으로 사용.
  //   subscription_status는 admin.ts 요금제 수정 등 경로에서 'paid'로 덮어써질 수 있어 견고하지 않음.
  const isTrialActive =
    planCode === 'TRIAL' &&
    trialExpiresAt !== null &&
    trialExpiresAt.getTime() > now;

  // ★ D219+ Part 2 (2026-05-27): AI 오퍼레이션 30일 무료체험 별도 흐름.
  //   기존 PRO 무료체험과 완전히 분리. plan_code 무관하게 ai_operator_trial_until 컬럼만 검사.
  const aiOperatorTrialStartedAt: Date | null = row.ai_operator_trial_started_at
    ? new Date(row.ai_operator_trial_started_at)
    : null;
  const aiOperatorTrialUntil: Date | null = row.ai_operator_trial_until
    ? new Date(row.ai_operator_trial_until)
    : null;
  const isAiOperatorTrialActive =
    aiOperatorTrialUntil !== null && aiOperatorTrialUntil.getTime() > now;

  return {
    companyId,
    planCode,
    planName: row.plan_name || '',
    subscriptionStatus,
    trialExpiresAt,
    isTrialActive,
    features: {
      customer_db_enabled: !!row.customer_db_enabled,
      target_send_enabled: !!row.target_send_enabled,
      ai_mapping_enabled: !!row.ai_mapping_enabled,
      ai_messaging_enabled: !!row.ai_messaging_enabled,
      ai_premium_enabled: !!row.ai_premium_enabled,
      auto_campaign_enabled: !!row.auto_campaign_enabled,
      spam_filter_enabled: !!row.spam_filter_enabled,
      auto_spam_test_enabled: !!row.auto_spam_test_enabled,
      mobile_dm_enabled: !!row.mobile_dm_enabled,
      cdp_enabled: !!row.cdp_enabled,
    },
    cdpEventsPerMonth: row.cdp_events_per_month != null ? Number(row.cdp_events_per_month) : null,
    maxAutoCampaigns: row.max_auto_campaigns != null ? Number(row.max_auto_campaigns) : null,
    autoCampaignOverride: row.auto_campaign_override != null ? Number(row.auto_campaign_override) : null,
    directRecipientLimit: row.direct_recipient_limit != null ? Number(row.direct_recipient_limit) : null,
    legacyGrandfathered: !!row.legacy_grandfathered,
    aiOperatorTrialStartedAt,
    aiOperatorTrialUntil,
    isAiOperatorTrialActive,
  };
}

// ═══════════════════════════════════════════════════════════
// 미가입 / 구독 상태 헬퍼
// ═══════════════════════════════════════════════════════════

/** FREE plan = 요금제 미가입 상태 */
export function isUnsubscribed(ctx: PlanContext): boolean {
  return ctx.planCode === 'FREE';
}

/**
 * 구독 자체가 막혔는지 판정.
 *   - 'expired' | 'suspended' 는 명시적 차단 상태.
 *   - 'trial_expired' 는 단순 마커 (Cron이 plan_id를 FREE로 이미 강등했으므로
 *     기능 판정은 FREE plan 플래그로 자연스럽게 동작. 여기서 차단하지 않음).
 *   - FREE(미가입) 자체는 차단하지 않음 — plans 플래그로 기능별 허용.
 */
export function isSubscriptionBlocked(ctx: PlanContext): { blocked: boolean; reason?: string } {
  if (ctx.subscriptionStatus === 'expired' || ctx.subscriptionStatus === 'suspended') {
    return { blocked: true, reason: '구독이 만료되었습니다. 요금제를 갱신해주세요.' };
  }
  return { blocked: false };
}

// ═══════════════════════════════════════════════════════════
// 베타 기능 접근 판정 (D163 신설 — Braze급 SaaS 9 세션 분할)
// ═══════════════════════════════════════════════════════════

/**
 * Braze급 베타 기능 접근 허용 여부.
 *
 * 정책 (D162-5 Harold님 확정):
 *   - ENTERPRISE / BUSINESS = 베타 기능 실제 진입 허용
 *   - 그 외 (TRIAL/FREE/STARTER/BASIC/PRO) = BetaFeatureModal 표시
 *
 * 안정성 검증 후 단계적 확장 예정 (PRO → BASIC).
 */
export function isBetaAccessAllowed(ctx: PlanContext): boolean {
  return ctx.planCode === 'ENTERPRISE' || ctx.planCode === 'BUSINESS';
}

/**
 * ★ D178 (2026-05-19) + D209+ (2026-05-23) + D219+ Part 2 (2026-05-27 Harold 명시) — AI Operator 진입 게이팅:
 *
 *   [4분기 확장 표 — D219+ Part 2 (2026-05-27)]
 *   1. user.userType === 'super_admin' → true (슈퍼관리자 진입 허용 — 디버깅/검증)
 *   2. ENV `AI_OPERATOR_ALLOWED_USERS` 설정 + 본 list 사용자 → true (베타/디버깅 화이트리스트)
 *   3. 전 유료 플랜(FREE 아님) → true (종량제 전환 Phase 3 — 기존 ENTERPRISE 전용 폐지)
 *   4. ai_operator_trial_until > NOW() → true (FREE라도 1-click 부여한 30일 무료체험)
 *   그 외(FREE + 체험 없음) → false (BetaFeatureModal 표시)
 *
 *   ※ 기존 PRO 무료체험(plan_code='TRIAL' + trial_expires_at) = 본 함수 무관.
 *     TRIAL 플랜은 PRO 기능 전체 무료 + AI 오퍼레이션은 별도 부여 흐름.
 *
 *   ※ 종량제 전환(Phase 3)으로 legacy_grandfathered + PRO 등 전 유료 플랜 진입 허용
 *     (D209+ ENTERPRISE 전용 제한 해제). 사용량 통제는 크레딧.
 *
 * @param ctx loadPlanContext 결과
 * @param user req.user (auth 미들웨어 처리 영역 — JwtPayload = loginId + userId + userType 포함)
 */
export function isAiOperatorAllowed(
  ctx: PlanContext,
  user: { loginId?: string; userId?: string; userType?: string } | null | undefined,
): boolean {
  // 1. 슈퍼관리자 = 자동 진입 (디버깅/검증 영역)
  if (user?.userType === 'super_admin') return true;

  // 2. ENV 화이트리스트 (베타/디버깅) — 설정된 경우만 적용, 미설정 시 skip
  const raw = process.env.AI_OPERATOR_ALLOWED_USERS || '';
  const allowedList = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowedList.length > 0) {
    const loginId = (user?.loginId || '').toLowerCase();
    const userId = (user?.userId || '').toLowerCase();
    if (allowedList.some((entry) => entry === loginId || entry === userId)) {
      return true;
    }
  }

  // 3. 종량제 전환(Phase 3): 전 유료 플랜 개방 (기존 ENTERPRISE 전용 게이팅 폐지).
  //    AI Operator 사용량 통제는 크레딧(checkCredit). FREE(미가입)만 아래 체험 분기로.
  if (!isUnsubscribed(ctx)) return true;

  // 4. AI 오퍼레이션 30일 무료체험 부여 + 미만료 = 진입 허용 (D219+ Part 2 신규)
  if (ctx.isAiOperatorTrialActive) return true;

  return false;
}

// ═══════════════════════════════════════════════════════════
// 기능별 체크 — canUseFeature
// ═══════════════════════════════════════════════════════════

/**
 * 요청한 기능 사용 가능 여부.
 *
 * 원칙:
 *   - 구독이 명시적으로 막힌 상태(expired/suspended)는 전 기능 차단.
 *   - 그 외는 plans 플래그를 진실의 원천으로 사용 (plan_code 하드코딩 없음).
 *   - FREE 도 기본 발송은 허용 (레거시 이관 무료 고객 대응).
 *   - 'basic_send'(직접발송/수신거부/발송결과/예약(직접))는 plans 별도 플래그 없이
 *     구독 막힘만 없으면 허용.
 */
export function canUseFeature(ctx: PlanContext, key: FeatureKey): FeatureCheckResult {
  // 구독 만료/정지 → 전부 차단 (FREE/trial_expired 는 여기서 막지 않음)
  const sub = isSubscriptionBlocked(ctx);
  if (sub.blocked) {
    return { allowed: false, errorMsg: sub.reason, errorCode: 'SUBSCRIPTION_BLOCKED' };
  }

  switch (key) {
    case 'basic_send':
      // FREE 포함 모든 활성 플랜 허용 (레거시 이관 미가입자도 기본 발송 가능)
      return { allowed: true };

    case 'customer_db':
      return ctx.features.customer_db_enabled
        ? { allowed: true }
        : { allowed: false, errorMsg: '고객DB는 스타터 요금제부터 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' };

    case 'target_send':
      return ctx.features.target_send_enabled
        ? { allowed: true }
        : { allowed: false, errorMsg: '직접타겟발송은 스타터 요금제부터 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' };

    case 'ai_mapping':
      return ctx.features.ai_mapping_enabled
        ? { allowed: true }
        : { allowed: false, errorMsg: 'AI 자동매핑은 스타터 요금제부터 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' };

    case 'spam_filter':
      return ctx.features.spam_filter_enabled
        ? { allowed: true }
        : { allowed: false, errorMsg: '스팸필터 테스트는 스타터 요금제부터 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' };

    // 종량제 전환(Phase 3): AI 기능 잠금 해제 → 전 유료 플랜 개방. 사용량 통제는
    //   callAIWithFallback의 checkCredit(크레딧 잔액). FREE(미가입)만 차단.
    case 'ai_messaging':
      return isUnsubscribed(ctx)
        ? { allowed: false, errorMsg: 'AI 기능은 유료 요금제 가입 후 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' }
        : { allowed: true };

    case 'ai_premium':
      return isUnsubscribed(ctx)
        ? { allowed: false, errorMsg: 'AI 기능은 유료 요금제 가입 후 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' }
        : { allowed: true };

    case 'auto_campaign':
      // 회사별 오버라이드(D76)가 있으면 그 값 우선 (관리자 비활성 = 0 이하 → 차단 유지)
      if (ctx.autoCampaignOverride != null) {
        if (ctx.autoCampaignOverride <= 0) {
          return { allowed: false, errorMsg: '자동발송이 비활성화되어 있습니다.', errorCode: 'PLAN_FEATURE_LOCKED' };
        }
        return { allowed: true };
      }
      // 종량제 전환(Phase 3): 플랜 잠금 해제 → 전 유료 개방. 건수 한도는 max_auto_campaigns 유지.
      return isUnsubscribed(ctx)
        ? { allowed: false, errorMsg: '자동발송은 유료 요금제 가입 후 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' }
        : { allowed: true };

    case 'mobile_dm':
      // 종량제 전환(Phase 3): 잠금 해제 → 전 유료 개방. 사용량은 크레딧(checkCredit).
      return isUnsubscribed(ctx)
        ? { allowed: false, errorMsg: '모바일 DM 제작은 유료 요금제 가입 후 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' }
        : { allowed: true };

    case 'auto_spam_test':
      return ctx.features.auto_spam_test_enabled
        ? { allowed: true }
        : { allowed: false, errorMsg: '스팸테스트 자동화는 프로 요금제 이상에서 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' };

    case 'ai_cdp':
      // 종량제 전환(Phase 3): 전 유료 개방. ※ 런타임 실 게이트는 cdp-auth.ts isCdpEnabledForPlan
      //   (자사몰/이메일/네이버 연동 경유). 여기는 plan-guard 일관성용 — FREE만 차단.
      return isUnsubscribed(ctx)
        ? { allowed: false, errorMsg: '한줄로 CDP는 유료 요금제 가입 후 이용 가능합니다.', errorCode: 'PLAN_FEATURE_LOCKED' }
        : { allowed: true };

    default: {
      const _exhaustive: never = key;
      return { allowed: false, errorMsg: `알 수 없는 기능 키: ${_exhaustive}`, errorCode: 'UNKNOWN_FEATURE' };
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 자동발송 한도 (auto-campaign 전용 보조)
// ═══════════════════════════════════════════════════════════

/** 오버라이드/플랜 설정을 종합한 최대 자동발송 수 (null = 무제한) */
export function resolveMaxAutoCampaigns(ctx: PlanContext): number | null {
  if (ctx.autoCampaignOverride != null && ctx.autoCampaignOverride > 0) {
    return ctx.autoCampaignOverride;
  }
  return ctx.maxAutoCampaigns;
}

/**
 * 직접발송 시 허용되는 주소록 최대 건수 (null = 무제한).
 *   - FREE(미가입): 99,999 — 직접발송 주소록 한정으로만 허용
 *   - STARTER 이상: null
 */
export function getDirectRecipientLimit(ctx: PlanContext): number | null {
  return ctx.directRecipientLimit;
}

/**
 * 직접발송 수신자 건수 검증 헬퍼.
 *   recipientCount가 한도를 넘으면 errorMsg 반환.
 */
export function checkDirectRecipientLimit(ctx: PlanContext, recipientCount: number): FeatureCheckResult {
  const limit = getDirectRecipientLimit(ctx);
  if (limit == null) return { allowed: true }; // 무제한
  if (recipientCount > limit) {
    return {
      allowed: false,
      errorMsg: `현재 요금제는 직접발송 시 수신자 ${limit.toLocaleString()}건까지 가능합니다. (요청: ${recipientCount.toLocaleString()}건)`,
      errorCode: 'DIRECT_RECIPIENT_LIMIT_EXCEEDED',
    };
  }
  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════
// Express 미들웨어 팩토리
// ═══════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';

/**
 * 특정 기능 요금제 게이팅 미들웨어.
 * 요청 회사 컨텍스트에 companyId가 세팅되어 있다고 가정.
 */
export function requirePlanFeature(key: FeatureKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }
    try {
      const ctx = await loadPlanContext(companyId);
      if (!ctx) {
        return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
      }
      const check = canUseFeature(ctx, key);
      if (!check.allowed) {
        return res.status(403).json({
          success: false,
          error: check.errorMsg,
          code: check.errorCode || 'PLAN_FEATURE_LOCKED',
        });
      }
      // 필요 시 핸들러에서 재사용하도록 context 주입
      (req as any).planContext = ctx;
      next();
    } catch (err) {
      console.error('[plan-guard] requirePlanFeature error:', err);
      return res.status(500).json({ success: false, error: '요금제 검증 실패' });
    }
  };
}
