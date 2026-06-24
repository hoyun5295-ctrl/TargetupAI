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
 * 🔓 기능별 허용 매트릭스 (Harold님 확정)
 *   FREE        : 직접발송·수신거부·발송결과·예약(직접)·고객DB            (스팸필터 X)
 *   STARTER+    : FREE + 스팸필터테스트(수동)
 *   BASIC+      : STARTER + AI 메시지·AI 타겟·엑셀AI매핑
 *   PRO+        : BASIC + 자동발송·모바일DM·AI프리미엄·스팸자동화
 *
 *   ※ 판정은 plans 테이블 플래그가 진실의 원천. plan_code 하드코딩 금지.
 *   ※ plans 플래그 확정: FREE(customer_db=t, spam_filter=f), STARTER(+spam_filter=t),
 *     BASIC(+ai_messaging=t), PRO(+ai_premium=t, auto_campaign=t, auto_spam_test=t, mobile_dm=t).
 */
export type FeatureKey = 'basic_send' | 'customer_db' | 'target_send' | 'ai_mapping' | 'spam_filter' | 'ai_messaging' | 'ai_premium' | 'auto_campaign' | 'mobile_dm' | 'auto_spam_test';
/**
 * 구독 상태.
 *   ※ 네이밍 주의: companies.status('active'/'inactive'/'terminated')와 혼동 금지.
 *     여기 subscription_status는 구독 관점(유료 가입 여부)이며 'paid'로 통일.
 *     (2026-04-22 이전에는 'active'를 혼용했으나 네이밍 충돌로 'paid' 일원화)
 */
export type SubscriptionStatus = 'trial' | 'trial_expired' | 'paid' | 'expired' | 'suspended' | null;
export interface PlanContext {
    companyId: string;
    planCode: string;
    planName: string;
    subscriptionStatus: SubscriptionStatus;
    trialExpiresAt: Date | null;
    isTrialActive: boolean;
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
    };
    maxAutoCampaigns: number | null;
    autoCampaignOverride: number | null;
    directRecipientLimit: number | null;
}
export interface FeatureCheckResult {
    allowed: boolean;
    errorMsg?: string;
    errorCode?: string;
}
/**
 * 요금제·구독 상태를 한 번에 조회하는 SELECT 조각.
 * 호출부: `FROM companies c LEFT JOIN plans p ON c.plan_id = p.id` 형태에서 사용.
 */
export declare const PLAN_STATUS_SELECT_EXPR: string;
export declare function loadPlanContext(companyId: string): Promise<PlanContext | null>;
/** FREE plan = 요금제 미가입 상태 */
export declare function isUnsubscribed(ctx: PlanContext): boolean;
/**
 * 구독 자체가 막혔는지 판정.
 *   - 'expired' | 'suspended' 는 명시적 차단 상태.
 *   - 'trial_expired' 는 단순 마커 (Cron이 plan_id를 FREE로 이미 강등했으므로
 *     기능 판정은 FREE plan 플래그로 자연스럽게 동작. 여기서 차단하지 않음).
 *   - FREE(미가입) 자체는 차단하지 않음 — plans 플래그로 기능별 허용.
 */
export declare function isSubscriptionBlocked(ctx: PlanContext): {
    blocked: boolean;
    reason?: string;
};
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
export declare function canUseFeature(ctx: PlanContext, key: FeatureKey): FeatureCheckResult;
/** 오버라이드/플랜 설정을 종합한 최대 자동발송 수 (null = 무제한) */
export declare function resolveMaxAutoCampaigns(ctx: PlanContext): number | null;
/**
 * 직접발송 시 허용되는 주소록 최대 건수 (null = 무제한).
 *   - FREE(미가입): 99,999 — 직접발송 주소록 한정으로만 허용
 *   - STARTER 이상: null
 */
export declare function getDirectRecipientLimit(ctx: PlanContext): number | null;
/**
 * 직접발송 수신자 건수 검증 헬퍼.
 *   recipientCount가 한도를 넘으면 errorMsg 반환.
 */
export declare function checkDirectRecipientLimit(ctx: PlanContext, recipientCount: number): FeatureCheckResult;
import type { Request, Response, NextFunction } from 'express';
/**
 * 특정 기능 요금제 게이팅 미들웨어.
 * 요청 회사 컨텍스트에 companyId가 세팅되어 있다고 가정.
 */
export declare function requirePlanFeature(key: FeatureKey): (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=plan-guard.d.ts.map