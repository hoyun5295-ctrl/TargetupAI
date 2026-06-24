/**
 * ★ 전단AI: 단축URL 리다이렉트 + 전단지 공개 페이지 렌더링
 *
 * 마운트: /api/flyer/p (공개 — 인증 불필요)
 * - GET /api/flyer/p/:code — 전단지 공개 페이지 렌더링 (hanjul-flyer.kr/:code 에서 프록시)
 *
 * ⚠️ 이 라우트는 인증 없이 공개 접근 가능 (고객이 SMS 링크로 접근)
 */
declare const router: import("express-serve-static-core").Router;
export declare function renderFlyerPage(flyer: any, trackingPhone?: string | null): Promise<string>;
export default router;
//# sourceMappingURL=short-urls.d.ts.map