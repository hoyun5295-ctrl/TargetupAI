/**
 * ★ 전단AI 주소록 라우트
 * 마운트: /api/flyer/address-books
 *
 * 한줄로 routes/address-books.ts와 완전 분리.
 * 전단AI 전용 주소록 — flyer_customers 기반 그룹 관리.
 * 현재는 간단한 그룹명 기반 태그 시스템으로 구현.
 *
 * TODO Phase 2: flyer_address_book_groups / flyer_address_book_entries 테이블 신설 시 확장
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=address-books.d.ts.map