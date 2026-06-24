/**
 * 알림톡/브랜드메시지 관련 배치 작업
 *
 * ALIMTALK-DESIGN.md §5-7 기준. 스케줄러 3종.
 *
 *   1) syncCategoriesJob       — 매일 03:00 KST, 발신프로필/템플릿 카테고리 캐시 갱신
 *   2) syncPendingTemplatesJob — 5분 주기, 검수중/승인대기 상태 폴링 (웹훅 누락 시 fallback)
 *   3) syncSenderStatusJob     — 1시간 주기, 발신프로필 상태 폴링
 *
 * 운영 원칙:
 *   - IMC env(API_KEY/BASE_URL) 미설정 시 전부 no-op (Phase 0 대응)
 *   - 개별 호출 실패는 로그만 남기고 다음 주기 계속 (배치 전체가 중단되지 않도록)
 *   - 기존 `auto-campaign-worker.ts` / `spam-test-queue.ts` 패턴(setInterval 기반) 준수
 */
export declare function syncCategoriesJob(): Promise<void>;
export declare function syncPendingTemplatesJob(): Promise<void>;
export declare function syncSenderStatusJob(): Promise<void>;
/**
 * 알림톡 배치 스케줄러 시작. app.ts listen 콜백에서 1회 호출.
 */
export declare function startAlimtalkScheduler(): void;
/** 테스트/재시작용 */
export declare function stopAlimtalkScheduler(): void;
//# sourceMappingURL=alimtalk-jobs.d.ts.map