// routes/admin/login-blocks.ts
// ★ D145 P0 (2026-05-07): 슈퍼관리자 로그인 차단 관리 API
// 컨트롤타워: utils/login-block.ts
// 권한: super_admin 전용

import { Router, Request, Response } from 'express';
import { authenticate } from '../../middlewares/auth';
import {
  getActiveBlocks,
  getBlockHistory,
  manualBlock,
  unblock,
} from '../../utils/login-block';

const router = Router();

// 모든 라우트 인증 필요 + super_admin 권한 체크
router.use(authenticate);
router.use((req: any, res: Response, next) => {
  if (req.user?.userType !== 'super_admin') {
    return res.status(403).json({ error: '슈퍼관리자 권한이 필요합니다.' });
  }
  return next();
});

// GET /api/admin/login-blocks/active — 현재 활성 차단 목록
router.get('/active', async (req: Request, res: Response) => {
  try {
    const ipLike = req.query.ip ? String(req.query.ip) : undefined;
    const loginIdLike = req.query.loginId ? String(req.query.loginId) : undefined;
    const rows = await getActiveBlocks({ ipLike, loginIdLike });
    return res.json({ success: true, blocks: rows });
  } catch (error: any) {
    console.error('[admin/login-blocks] active 조회 에러:', error);
    return res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

// GET /api/admin/login-blocks/history — 차단 이력 (페이지네이션)
router.get('/history', async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    const ipLike = req.query.ip ? String(req.query.ip) : undefined;
    const loginIdLike = req.query.loginId ? String(req.query.loginId) : undefined;
    const reason = req.query.reason ? String(req.query.reason) : undefined;
    const result = await getBlockHistory({ page, limit, ipLike, loginIdLike, reason });
    return res.json({
      success: true,
      blocks: result.rows,
      pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) },
    });
  } catch (error: any) {
    console.error('[admin/login-blocks] history 조회 에러:', error);
    return res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/admin/login-blocks — 수동 차단 추가
router.post('/', async (req: any, res: Response) => {
  try {
    const { ipAddress, loginId, durationMinutes, reason } = req.body;
    if (!ipAddress || !loginId) {
      return res.status(400).json({ error: 'ipAddress와 loginId가 필요합니다.' });
    }
    const dur = Number(durationMinutes);
    if (!Number.isFinite(dur) || dur <= 0 || dur > 60 * 24 * 365) {
      return res.status(400).json({ error: 'durationMinutes는 1 이상 365일 이내여야 합니다.' });
    }
    const result = await manualBlock({
      ipAddress,
      loginId,
      blockedBy: req.user.userId,
      durationMinutes: dur,
      reason: reason ? String(reason).slice(0, 200) : undefined,
    });
    return res.json({ success: true, id: result.id });
  } catch (error: any) {
    console.error('[admin/login-blocks] 수동 차단 에러:', error);
    return res.status(500).json({ error: '수동 차단 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/admin/login-blocks/:id — 차단 즉시 해제
router.delete('/:id', async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 200) : 'admin_unblock';
    const result = await unblock({ blockId: id, unblockedBy: req.user.userId, reason });
    if (!result.ok) {
      return res.status(404).json({ error: '차단을 찾을 수 없거나 이미 해제됨.' });
    }
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[admin/login-blocks] 해제 에러:', error);
    return res.status(500).json({ error: '해제 중 오류가 발생했습니다.' });
  }
});

export default router;
