/**
 * ★ 전단AI 발신번호 등록 라우트
 * 마운트: /api/flyer/companies/sender-registration
 *
 * 한줄로 routes/sender-registration.ts와 완전 분리.
 * 전단AI는 flyer_callback_numbers 기반 발신번호 관리.
 * 현재는 간단한 CRUD (한줄로의 승인 플로우 없이 즉시 등록).
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=sender-registration.d.ts.map