/**
 * Team 한줄로 다리 라우트(한줄로AI 쪽) — 2026-11-26 · 판정은 CT utils/team-bridge.ts 가 한다.
 *   다리 문   GET /internal/team-bridge/v1/companies  (같은 서버의 Team 서버만 · 서비스 키)
 *   슈퍼관리자 GET /api/admin/team-bridge/companies · PUT /api/admin/team-bridge/companies/:id  { enabled }
 * 기존 라우트 · 발송 · 정산 경로와 무관(새 표 team_bridge_companies 만 읽고 쓴다).
 */
import { Router, Request, Response } from 'express';
import { authenticate, requireSuperAdmin, requireUuidId } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { recordAuditLog } from '../utils/audit-log';
import {
  isTeamBridgeCallerAllowed,
  teamBridgeKeyOk,
  listTeamEnabledCompanies,
  listTeamEnabledIds,
  setTeamBridge,
} from '../utils/team-bridge';

export const teamBridgeInternalRoutes = Router();

teamBridgeInternalRoutes.get('/v1/companies', async (req: Request, res: Response) => {
  if (!isTeamBridgeCallerAllowed(req.ip)) return res.status(403).json({ error: 'Forbidden' });
  if (!teamBridgeKeyOk(req.get('x-team-bridge-key'))) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ companies: await listTeamEnabledCompanies() });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'team_bridge_companies')) return;
    console.error('[team-bridge] 목록 실패', err);
    res.status(500).json({ error: 'internal' });
  }
});

export const teamBridgeAdminRoutes = Router();
teamBridgeAdminRoutes.use(authenticate, requireSuperAdmin);

teamBridgeAdminRoutes.get('/companies', async (_req: Request, res: Response) => {
  try {
    res.json({ companyIds: await listTeamEnabledIds() });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'team_bridge_companies')) return;
    console.error('[team-bridge] 켠 회사 읽기 실패', err);
    res.status(500).json({ error: 'Team 연동 상태를 읽지 못했습니다.' });
  }
});

teamBridgeAdminRoutes.put('/companies/:id', requireUuidId, async (req: Request, res: Response) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled 값이 필요합니다.' });
  try {
    const enabled = await setTeamBridge(req.params.id, req.body.enabled, req.user?.userId ?? null);
    if (enabled === null) return res.status(404).json({ error: '회사를 찾을 수 없거나 해지된 회사입니다.' });
    await recordAuditLog({
      actorUserId: req.user?.userId ?? null,
      action: 'team_bridge_set',
      targetType: 'company',
      targetId: req.params.id,
      details: { enabled },
      req,
    });
    res.json({ ok: true, enabled });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'team_bridge_companies')) return;
    console.error('[team-bridge] 스위치 실패', err);
    res.status(500).json({ error: 'Team 연동 상태를 바꾸지 못했습니다.' });
  }
});
