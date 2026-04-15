/**
 * ★ 전단AI 전용 인증 라우트
 * 마운트: /api/flyer/auth
 *
 * 한줄로 routes/auth.ts와 완전 분리.
 * - flyer_users 테이블만 조회
 * - flyer_companies 결제 상태 확인
 * - flyer JWT 발급 (service='flyer' 강제)
 */

import bcrypt from 'bcryptjs';
import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import {
  flyerAuthenticate,
  generateFlyerToken,
  FlyerJwtPayload,
} from '../../middlewares/flyer-auth';
import { logFlyerAudit } from '../../utils/flyer/audit/flyer-audit-log';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { login_id, password } = req.body;
    if (!login_id || !password) {
      return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요' });
    }

    const result = await query(
      `SELECT u.*, c.company_name, c.payment_status, c.plan_expires_at, c.deleted_at AS company_deleted
       FROM flyer_users u
       JOIN flyer_companies c ON c.id = u.company_id
       WHERE u.login_id = $1 AND u.deleted_at IS NULL`,
      [login_id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 잘못되었습니다' });
    }

    const user = result.rows[0];
    if (user.company_deleted) {
      return res.status(403).json({ error: '회사 계정이 삭제되었습니다' });
    }
    if (user.payment_status === 'suspended') {
      return res.status(403).json({ error: '구독이 정지되었습니다. 관리자에게 문의해주세요' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 잘못되었습니다' });
    }

    const payload: Omit<FlyerJwtPayload, 'service'> = {
      userId: user.id,
      companyId: user.company_id,
      role: user.role || 'flyer_admin',
      loginId: user.login_id,
      businessType: user.business_type || 'mart', // D113: 업종
    };
    const token = generateFlyerToken(payload);

    await query(
      `UPDATE flyer_users SET last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    // ★ 감사로그 기록 (비동기 — 실패해도 로그인 영향 없음)
    logFlyerAudit({
      userId: user.id,
      companyId: user.company_id,
      action: 'login',
      details: { login_id: user.login_id, store_name: user.store_name },
      ipAddress: req.ip || req.socket?.remoteAddress || null,
      userAgent: req.headers['user-agent'] || null,
    }).catch(() => {});

    return res.json({
      token,
      user: {
        id: user.id,
        loginId: user.login_id,
        name: user.name,
        role: user.role,
        businessType: user.business_type || 'mart', // D113: 업종
        storeName: user.store_name || user.name,     // D113: 매장명
        company: {
          id: user.company_id,
          name: user.company_name,
          paymentStatus: user.payment_status,
          planExpiresAt: user.plan_expires_at,
        },
      },
    });
  } catch (error: any) {
    console.error('[flyer/auth] login error:', error);
    return res.status(500).json({ error: 'Server error', detail: error?.message });
  }
});

/**
 * 세션 확인 (프론트에서 토큰 유효성 검사용).
 */
router.get('/session-check', flyerAuthenticate, async (req: Request, res: Response) => {
  res.json({ ok: true, user: req.flyerUser });
});

/**
 * 비밀번호 변경.
 */
router.post('/change-password', flyerAuthenticate, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다' });
    }
    const userId = req.flyerUser!.userId;

    const result = await query(`SELECT password_hash FROM flyer_users WHERE id = $1`, [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE flyer_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, userId]
    );

    return res.json({ message: '비밀번호가 변경되었습니다' });
  } catch (error: any) {
    console.error('[flyer/auth] change-password error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
