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
import { query } from '../config/database';

export interface SyncActiveBlockError {
  error: string;
  code: 'SYNC_ACTIVE_BLOCK';
  syncActive: true;
}

/**
 * 싱크 사용 중인지 판정.
 * - companies.use_db_sync=true AND sync_agents.status='active' 하나 이상
 */
export async function isSyncActive(companyId: string): Promise<boolean> {
  if (!companyId) return false;
  const result = await query(
    `SELECT 1
     FROM companies c
     WHERE c.id = $1
       AND c.use_db_sync = true
       AND EXISTS (SELECT 1 FROM sync_agents sa WHERE sa.company_id = c.id AND sa.status = 'active')
     LIMIT 1`,
    [companyId]
  );
  return result.rows.length > 0;
}

/**
 * Express 미들웨어 — 싱크 사용 중이면 403 차단.
 * 차단 응답 프론트 모달(SyncActiveBlockModal)이 code='SYNC_ACTIVE_BLOCK'로 감지.
 */
export async function blockIfSyncActive(req: Request, res: Response, next: NextFunction) {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      // 회사 연결 없는 경로는 통과 (상위 authenticate에서 이미 체크)
      return next();
    }

    const active = await isSyncActive(companyId);
    if (active) {
      return res.status(403).json({
        error: '이 회사는 현재 싱크에이전트를 통해 고객사 DB 서버와 자동 동기화 중입니다. 고객 정보를 변경하려면 귀사의 DB 서버에서 직접 수정해주세요.',
        code: 'SYNC_ACTIVE_BLOCK',
        syncActive: true,
      });
    }
    return next();
  } catch (error) {
    console.error('[SyncActiveCheck] 차단 체크 실패:', error);
    // fail-open: 체크 실패 시 기본 통과 (기간계 보호 — 체크 오류로 기능 중단 방지)
    return next();
  }
}
