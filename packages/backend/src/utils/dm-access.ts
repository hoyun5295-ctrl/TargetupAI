/**
 * CT: DM 소유 가드 (★ 2026-09-27 한줄로 V2 R117 · 옛 routes/dm.ts 안의 canAccessDm을 그대로 옮겼다)
 *
 * ★ 2026-07-14 사용자별 소유 가드(서수란 신고) — 일반 사용자는 본인 생성 DM만 조회·수정·삭제·복제.
 *   관리자(company_admin/super_admin)=회사 전체. 0709 자동마케팅 선례 동일. created_by=createDm에서 항상 기록되는 기존 컬럼.
 * ★ 2026-09-27 R117 — 가드가 조회·수정 몇 곳에만 있고 발행·통계·대상 발송·추적·수신자 상세·문안 생성·테스트 발송·승인·검증·응답 등
 *   20개 라우트에는 없었다(같은 회사 다른 사용자의 DM을 발송·수정할 수 있었다) → 라우트 미들웨어로 붙인다.
 *   응답은 기존 가드와 같다(회사 없음 403 · id 형식 400 · 남의 DM 403).
 */
import type { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { isUuid } from './normalize';

export async function canAccessDm(dmId: string, companyId: string, userType?: string, userId?: string): Promise<boolean> {
  if (userType === 'company_admin' || userType === 'super_admin') {
    const r = await query(`SELECT 1 FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
    return r.rows.length > 0;
  }
  const r = await query(`SELECT 1 FROM dm_pages WHERE id = $1 AND company_id = $2 AND created_by = $3`, [dmId, companyId, userId || '']);
  return r.rows.length > 0;
}

/** `/:id` DM 라우트 앞에 붙이는 가드. 통과하면 next(). */
export async function requireDmAccess(req: Request, res: Response, next: NextFunction): Promise<any> {
  try {
    const user = (req as any).user;
    const companyId = user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!isUuid(req.params.id)) return res.status(400).json({ error: '올바르지 않은 DM ID입니다.' });
    if (!(await canAccessDm(req.params.id, companyId, user?.userType, user?.userId))) {
      return res.status(403).json({ error: '본인이 생성한 DM만 접근할 수 있습니다.' });
    }
    return next();
  } catch (err: any) {
    console.error('[DM 소유 가드] 오류:', err?.message || err);
    return res.status(500).json({ error: '서버 오류' });
  }
}
