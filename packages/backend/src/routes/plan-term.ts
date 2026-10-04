/**
 * routes/plan-term.ts — 선불 요금제 이용 기간 API (★2026-10-04 · docs/2026-10-04-prepaid-plan-term-design.md §6)
 *
 * 고객  = /api/companies/plan-term       (이력 · 견적 · 1개월 연장 · 자동 연장 스위치)
 * 관리자 = /api/admin/companies/:id/plan-term (상태 · 시작 · 만료일 조정 · 스위치 · 관리 종료)
 * 판정·쓰기는 전부 utils/plan-term.ts(CT)가 한다. 여기는 입력 검사와 오류 응답만.
 */

import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate, requireCompanyAdmin, requireSuperAdmin } from '../middlewares/auth';
import {
  PlanTermError, migrationPendingError, type TermActor,
  getPlanTermQuote, extendPlanTerm, setPlanTermAutoRenew, listPlanTermEvents,
  getAdminPlanTermState, adminStartPlanTerm, adminAdjustPlanTermExpires, adminEndPlanTerm,
} from '../utils/plan-term';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sendError(res: Response, err: any, tag: string) {
  if (err instanceof PlanTermError) return res.status(err.status).json({ success: false, ...err.body });
  const msg = String(err?.message || '');
  // db_alter_safety_net — 새 칸·표를 쓰는 경로라 DDL 전 실패를 500으로 내보내지 않는다
  if (String(err?.code) === '42P01' || String(err?.code) === '42703' || (msg.includes('does not exist') && /(column|relation)/.test(msg))) {
    return res.status(503).json({ success: false, ...migrationPendingError().body });
  }
  console.error(`[plan-term] ${tag} 실패:`, msg || err);
  return res.status(500).json({ success: false, error: '처리 중 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.' });
}

/** 이력에 남길 실행자 — 고객은 사용자 이름, 슈퍼관리자는 이름(고객 화면에는 '한줄로 담당자'로 바뀐다) */
async function actorOf(req: Request): Promise<TermActor> {
  const u = req.user!;
  const isSuper = u.userType === 'super_admin';
  const r = await query(
    isSuper
      ? `SELECT COALESCE(NULLIF(name, ''), login_id) AS label FROM super_admins WHERE id = $1::uuid`
      : `SELECT COALESCE(NULLIF(name, ''), login_id) AS label FROM users WHERE id = $1::uuid`,
    [u.userId],
  ).catch(() => ({ rows: [] as any[] }));
  return {
    type: isSuper ? 'super_admin' : 'company_user',
    id: u.userId,
    label: r.rows[0]?.label || null,
    ip: req.ip || null,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
  };
}

// ════════════════════════════════════════════════════════════
// 고객
// ════════════════════════════════════════════════════════════

export const customerRouter = Router();
customerRouter.use(authenticate);

function companyIdOf(req: Request, res: Response): string | null {
  const id = req.user?.companyId;
  if (!id) { res.status(403).json({ success: false, error: '고객사 권한이 필요합니다.' }); return null; }
  return id;
}

customerRouter.get('/events', async (req: Request, res: Response) => {
  const companyId = companyIdOf(req, res); if (!companyId) return;
  try {
    const r = await listPlanTermEvents(companyId, { offset: Number(req.query.offset) || 0, limit: Number(req.query.limit) || 5, audience: 'customer' });
    if (!r) return res.status(503).json({ success: false, ...migrationPendingError().body });
    return res.json({ success: true, ...r });
  } catch (err) { return sendError(res, err, 'events'); }
});

customerRouter.get('/quote', requireCompanyAdmin, async (req: Request, res: Response) => {
  const companyId = companyIdOf(req, res); if (!companyId) return;
  try {
    return res.json({ success: true, quote: await getPlanTermQuote(companyId) });
  } catch (err) { return sendError(res, err, 'quote'); }
});

customerRouter.post('/extend', requireCompanyAdmin, async (req: Request, res: Response) => {
  const companyId = companyIdOf(req, res); if (!companyId) return;
  const { requestId, version, total } = req.body || {};
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId) || !Number.isInteger(Number(version)) || !Number.isFinite(Number(total))) {
    return res.status(400).json({ success: false, error: '요청 값이 올바르지 않습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.' });
  }
  try {
    const out = await extendPlanTerm(companyId, { requestId, version: Number(version), total: Number(total) }, await actorOf(req));
    if ('conflict' in out) return res.status(out.conflict.status).json({ success: false, ...out.conflict.body });
    return res.json({ success: true, ...out });
  } catch (err) { return sendError(res, err, 'extend'); }
});

customerRouter.patch('/auto-renew', requireCompanyAdmin, async (req: Request, res: Response) => {
  const companyId = companyIdOf(req, res); if (!companyId) return;
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ success: false, error: 'enabled 값이 필요합니다.' });
  try {
    return res.json({ success: true, ...(await setPlanTermAutoRenew(companyId, req.body.enabled, await actorOf(req))) });
  } catch (err) { return sendError(res, err, 'auto-renew'); }
});

// ════════════════════════════════════════════════════════════
// 슈퍼관리자 — /api/admin/companies/:id/plan-term
// ════════════════════════════════════════════════════════════

export const adminRouter = Router({ mergeParams: true });
adminRouter.use(authenticate, requireSuperAdmin);

function targetIdOf(req: Request, res: Response): string | null {
  const id = String((req.params as any).id || '');
  if (!UUID_RE.test(id)) { res.status(400).json({ success: false, error: '회사 ID가 올바르지 않습니다.' }); return null; }
  return id;
}

function reasonOf(req: Request, res: Response): string | null {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) { res.status(400).json({ success: false, error: '사유를 입력해 주세요.' }); return null; }
  return reason.slice(0, 500);
}

adminRouter.get('/', async (req: Request, res: Response) => {
  const id = targetIdOf(req, res); if (!id) return;
  try {
    const state = await getAdminPlanTermState(id);
    if (!state) return res.status(404).json({ success: false, error: '회사를 찾을 수 없습니다.' });
    const events = state.ready ? await listPlanTermEvents(id, { limit: 30, audience: 'admin' }) : null;
    return res.json({ success: true, ...state, events: events?.rows || [] });
  } catch (err) { return sendError(res, err, 'admin-get'); }
});

adminRouter.post('/start', async (req: Request, res: Response) => {
  const id = targetIdOf(req, res); if (!id) return;
  const reason = reasonOf(req, res); if (!reason) return;
  try {
    return res.json({ success: true, ...(await adminStartPlanTerm(id, { expiresOn: String(req.body?.expiresOn || ''), reason }, await actorOf(req))) });
  } catch (err) { return sendError(res, err, 'admin-start'); }
});

adminRouter.patch('/expires', async (req: Request, res: Response) => {
  const id = targetIdOf(req, res); if (!id) return;
  const reason = reasonOf(req, res); if (!reason) return;
  try {
    return res.json({ success: true, ...(await adminAdjustPlanTermExpires(id, {
      expiresOn: String(req.body?.expiresOn || ''), reason, version: Number(req.body?.version),
    }, await actorOf(req))) });
  } catch (err) { return sendError(res, err, 'admin-expires'); }
});

adminRouter.patch('/auto-renew', async (req: Request, res: Response) => {
  const id = targetIdOf(req, res); if (!id) return;
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ success: false, error: 'enabled 값이 필요합니다.' });
  try {
    return res.json({ success: true, ...(await setPlanTermAutoRenew(id, req.body.enabled, await actorOf(req))) });
  } catch (err) { return sendError(res, err, 'admin-auto-renew'); }
});

adminRouter.post('/end', async (req: Request, res: Response) => {
  const id = targetIdOf(req, res); if (!id) return;
  const reason = reasonOf(req, res); if (!reason) return;
  try {
    return res.json({ success: true, ...(await adminEndPlanTerm(id, { reason, version: Number(req.body?.version) }, await actorOf(req))) });
  } catch (err) { return sendError(res, err, 'admin-end'); }
});
