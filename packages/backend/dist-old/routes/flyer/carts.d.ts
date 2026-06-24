/**
 * ★ 전단AI: 장바구니 공개 API
 *
 * 마운트: /api/flyer/cart (공개 — 인증 불필요)
 * phone 기반 식별 (tracking URL에서 서버가 조회한 값)
 *
 * ⚠️ 보안: phone은 short_urls 테이블에서 서버가 조회한 값만 사용.
 *         클라이언트가 직접 phone을 조작하더라도 장바구니/주문 정도의 리스크.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=carts.d.ts.map