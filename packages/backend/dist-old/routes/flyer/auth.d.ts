/**
 * ★ 전단AI 전용 인증 라우트
 * 마운트: /api/flyer/auth
 *
 * 한줄로 routes/auth.ts와 완전 분리.
 * - flyer_users 테이블만 조회
 * - flyer_companies 결제 상태 확인
 * - flyer JWT 발급 (service='flyer' 강제)
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=auth.d.ts.map