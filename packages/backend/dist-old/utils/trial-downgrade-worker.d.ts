/**
 * CT-17 보조: 30일 PRO 무료체험 자동 강등 Cron Worker (2026-04-22)
 *
 * 🎯 목적
 *   슈퍼관리자가 grant-trial로 부여한 30일 PRO 체험이 만료되면
 *   자동으로 plan_id=FREE(미가입) + subscription_status='trial_expired' 로 전환.
 *   → plan-guard.canUseFeature가 FREE plan 플래그를 기준으로 판정하므로
 *      별도 코드 수정 없이 AI/자동발송/모바일DM 등 자동 잠금.
 *   → customers/campaigns/templates 등 데이터는 유지. 직접발송·기본 기능은 계속 사용 가능.
 *
 * 🕓 실행 주기
 *   매일 04:00 KST (기존 Tomcat 주간 재시작 04시와 겹치지만 PG 작업이라 무관)
 *   ↳ 기준 설계: auto-campaign-worker.ts / alimtalk-jobs.ts 의 setInterval 패턴 준수.
 *
 * 🔒 대상 회사 조건
 *   - plan_code = 'TRIAL' (무료체험 plan)
 *   - trial_expires_at IS NOT NULL AND trial_expires_at < NOW()
 *   ※ subscription_status 조건은 의도적으로 제거 — admin.ts 요금제 승인 등 다른 경로가 'paid'로 덮어쓰는 케이스가 있어
 *     'trial'만 검사하면 체험이 영원히 강등 안 되는 치명 버그 발생. plan_code='TRIAL'은 grant/revoke/Cron 3곳에서만 바뀌므로 견고함.
 *   ※ 정식 구독은 plan_code가 STARTER/BASIC/PRO/BUSINESS/ENTERPRISE로 바뀌므로 자동 제외됨.
 */
export declare function runTrialDowngradeJob(): Promise<{
    downgraded: number;
}>;
export declare function startTrialDowngradeWorker(): void;
export declare function stopTrialDowngradeWorker(): void;
//# sourceMappingURL=trial-downgrade-worker.d.ts.map