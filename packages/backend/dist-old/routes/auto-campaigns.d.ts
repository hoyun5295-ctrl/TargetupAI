/**
 * ★ D69: 자동발송 CRUD API
 *
 * 마운트: /api/auto-campaigns
 * 권한: company_admin + company_user (store_code 범위 내)
 * 게이팅: plans.auto_campaign_enabled (프로 이상)
 * 제한: plans.max_auto_campaigns (PRO: 5, BUSINESS: 10, ENTERPRISE: 무제한)
 *
 * 기존 컨트롤타워 100% 재활용:
 * - store-scope.ts → 브랜드 격리
 * - customer-filter.ts → 타겟 필터링 (preview)
 * - unsubscribe-helper.ts → 수신거부 제외 (preview)
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=auto-campaigns.d.ts.map