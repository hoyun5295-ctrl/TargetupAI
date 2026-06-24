/**
 * middlewares/sync-active-check.ts
 * ================================
 * SyncAgent v1.5.0 — 싱크 사용 중 회사의 고객 DB 직접 변경 차단 미들웨어 (설계서 §4-4)
 *
 * 차단 조건:
 *   companies.use_db_sync = true
 *   AND EXISTS (SELECT 1 FROM sync_agents WHERE company_id = $1 AND status = 'active')
 *
 * 적용 대상 (수동 고객 DB 변경 경로):
 *   - POST/PUT/DELETE /api/customers (개별 추가/수정/삭제)
 *   - POST /api/upload/save (엑셀 업로드)
 *   - DELETE /api/customers/bulk (전체 삭제)
 *
 * 적용 제외 (허용):
 *   - 직접발송 수신자 엑셀 (일회성 발송 목록)
 *   - 수신거부 엑셀 업로드 (unsubscribes 독립 테이블)
 *   - AI 분석 / 발송 / 조회
 *
 * ⚠️ 이 미들웨어는 반드시 authenticate() 뒤에 적용. req.user?.companyId 필요.
 */
import { Request, Response, NextFunction } from 'express';
export interface SyncActiveBlockError {
    error: string;
    code: 'SYNC_ACTIVE_BLOCK';
    syncActive: true;
}
/**
 * 싱크 사용 중인지 판정.
 * - companies.use_db_sync=true AND sync_agents.status='active' 하나 이상
 */
export declare function isSyncActive(companyId: string): Promise<boolean>;
/**
 * Express 미들웨어 — 싱크 사용 중이면 403 차단.
 * 차단 응답 프론트 모달(SyncActiveBlockModal)이 code='SYNC_ACTIVE_BLOCK'로 감지.
 */
export declare function blockIfSyncActive(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
//# sourceMappingURL=sync-active-check.d.ts.map