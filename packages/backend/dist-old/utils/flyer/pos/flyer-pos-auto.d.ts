/**
 * ★ CT-F22 — POS 자동 전단 생성 워커
 *
 * Phase 4: POS에 할인 등록 → Agent sync → 서버 감지 → 전단 자동 생성
 *
 * 흐름:
 *   1. flyer_pos_promotions에서 is_processed=false 건 조회
 *   2. 회사별 그룹핑
 *   3. 상품별: 카탈로그 이미지 매칭 → AI 카테고리 분류 → AI 문구 생성
 *   4. flyers 테이블에 status='auto_draft'로 INSERT
 *   5. is_processed=true 마킹
 *   6. 사장님에게 알림 SMS
 *
 * 워커: app.ts에서 5분 간격 setInterval로 실행
 * ⚠️ try-catch 격리: 실패해도 기존 서비스에 영향 없음
 */
/**
 * ★ 워커 시작 (app.ts listen 콜백에서 호출)
 */
export declare function startAutoFlyerWorker(): void;
/**
 * 워커 정지
 */
export declare function stopAutoFlyerWorker(): void;
/**
 * ★ 메인 로직: 미처리 할인 건 감지 → 전단 자동 생성
 */
export declare function checkAndGenerateAutoFlyers(): Promise<void>;
//# sourceMappingURL=flyer-pos-auto.d.ts.map