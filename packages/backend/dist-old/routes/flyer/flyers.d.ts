/**
 * ★ 전단AI: 전단지 CRUD API
 *
 * 마운트: /api/flyer/flyers
 * 권한: flyer_admin + flyer_staff (flyerAuthenticate 미들웨어)
 * ★ D112: 한줄로 authenticate → flyerAuthenticate 전환. store-scope 제거(전단AI는 회사 단위).
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=flyers.d.ts.map