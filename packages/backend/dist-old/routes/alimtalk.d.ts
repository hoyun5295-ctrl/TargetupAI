/**
 * /api/alimtalk/* — 휴머스온 IMC 연동 라우트
 *
 * ALIMTALK-DESIGN.md §5-5 기준. 총 33개 엔드포인트.
 *
 * 기존 `/api/companies/kakao-profiles`, `/api/companies/kakao-templates` 라우트는
 * 로컬 DB CRUD 호환용으로 유지. 본 라우트는 IMC 직접 연동 전용.
 *
 * 권한 정책:
 *   - 발신프로필 CRUD         → super_admin
 *   - 카테고리 동기화         → super_admin
 *   - 카테고리 조회           → 로그인 사용자 전원
 *   - 템플릿/알림수신자/이미지 → company_admin 또는 super_admin
 *   - 웹훅                    → 공개 (HMAC + IP 화이트리스트)
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=alimtalk.d.ts.map