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
import { isPlanControlRequest } from './plan-guard';

/**
 * ★ 2026-10-24 세 채널 구조체크 ③ — DM 끄기 요청 = 공용 끄기 판정 + A/B 종료 + 단축 링크 끄기. DM 라우터 머리 요금제 문이 이 요청은 연다.
 *   (A/B 종료는 결과만 고정한다 · 단축 링크는 켜기(isActive true)만 문을 지난다)
 */
export function isDmControlRequest(req: { method: string; path: string; body?: any }): boolean {
  return isPlanControlRequest(req)
    || (req.method === 'POST' && /^\/ab-tests\/[^/]+\/complete$/.test(req.path))
    || (req.method === 'PATCH' && /^\/short-links\/[^/]+$/.test(req.path) && req.body?.isActive !== true);
}

export async function canAccessDm(dmId: string, companyId: string, userType?: string, userId?: string): Promise<boolean> {
  if (userType === 'company_admin' || userType === 'super_admin') {
    const r = await query(`SELECT 1 FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
    return r.rows.length > 0;
  }
  const r = await query(`SELECT 1 FROM dm_pages WHERE id = $1 AND company_id = $2 AND created_by = $3`, [dmId, companyId, userId || '']);
  return r.rows.length > 0;
}

/**
 * ★ 2026-10-24 세 채널 구조체크 ⑫ — A/B 테스트도 DM 과 같은 소유 규칙(담당자 = 본인이 만든 것 · 관리자 = 회사 전체 · 작성자가 빈 행은 담당자에게 닫는다).
 *   `/ab-tests/:id` 라우트 앞에 붙인다. 응답은 DM 가드와 같다(회사 없음 403 · id 형식 400 · 남의 것 403).
 */
export async function requireAbTestAccess(req: Request, res: Response, next: NextFunction): Promise<any> {
  try {
    const user = (req as any).user;
    const companyId = user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!isUuid(req.params.id)) return res.status(400).json({ error: '올바르지 않은 테스트 ID입니다.' });
    const admin = user?.userType === 'company_admin' || user?.userType === 'super_admin';
    const r = admin
      ? await query(`SELECT 1 FROM dm_ab_tests WHERE id = $1 AND company_id = $2`, [req.params.id, companyId])
      : await query(`SELECT 1 FROM dm_ab_tests WHERE id = $1 AND company_id = $2 AND created_by = $3`, [req.params.id, companyId, user?.userId || '00000000-0000-0000-0000-000000000000']);
    if (r.rows.length === 0) return res.status(403).json({ error: '본인이 만든 테스트만 접근할 수 있습니다.' });
    return next();
  } catch (err: any) {
    console.error('[A/B 소유 가드] 오류:', err?.message || err);
    return res.status(500).json({ error: '서버 오류' });
  }
}

/** ★ 2026-10-24 ⑫ — 여러 DM 을 모두 볼 수 있는가(A/B 비교 대상 · 빈 값은 건너뛴다 · 판정 = canAccessDm) */
export async function canAccessEveryDm(ids: unknown[], companyId: string, userType?: string, userId?: string): Promise<boolean> {
  for (const id of ids.filter(Boolean)) {
    if (!isUuid(String(id)) || !(await canAccessDm(String(id), companyId, userType, userId))) return false;
  }
  return true;
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
