import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { query } from '../config/database';
// 새코드
import { authenticate, generateToken, JwtPayload } from '../middlewares/auth';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { loginId, password, userType } = req.body;

    if (!loginId || !password) {
      return res.status(400).json({ error: 'ID and password required' });
    }

    // ===== 슈퍼관리자 로그인 (세션 관리 없음) =====
    if (userType === 'super_admin') {
      const result = await query(
        'SELECT * FROM super_admins WHERE login_id = $1 AND is_active = true',
        [loginId]
      );

      if (result.rows.length === 0) {
        await query(
          `INSERT INTO audit_logs (id, action, target_type, details, ip_address, user_agent, created_at)
           VALUES (gen_random_uuid(), 'login_fail', 'super_admin', $1, $2, $3, NOW())`,
          [JSON.stringify({ loginId, reason: 'user_not_found' }), req.ip, req.headers['user-agent'] || '']
        );
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const admin = result.rows[0];
      const validPassword = await bcrypt.compare(password, admin.password_hash);

      if (!validPassword) {
        await query(
          `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
           VALUES (gen_random_uuid(), $1, 'login_fail', 'super_admin', $2, $3, $4, NOW())`,
          [admin.id, JSON.stringify({ loginId, reason: 'invalid_password' }), req.ip, req.headers['user-agent'] || '']
        );
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_success', 'super_admin', $2, $3, $4, NOW())`,
        [admin.id, JSON.stringify({ loginId }), req.ip, req.headers['user-agent'] || '']
      );

      await query(
        'UPDATE super_admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
        [admin.id]
      );

      const payload: JwtPayload = {
        userId: admin.id,
        userType: 'super_admin',
        loginId: admin.login_id,
      };

      const token = generateToken(payload);

      return res.json({
        token,
        user: {
          id: admin.id,
          loginId: admin.login_id,
          name: admin.name,
          email: admin.email,
          userType: 'super_admin',
        },
        sessionTimeoutMinutes: 60,
      });
    }

    // ===== 고객사 사용자 로그인 =====
    const result = await query(
      `SELECT u.*, u.must_change_password, u.hidden_features, c.name as company_name, c.id as company_code, c.subscription_status
       FROM users u
       JOIN companies c ON u.company_id = c.id
       WHERE u.login_id = $1`,
      [loginId]
    );

    if (result.rows.length === 0) {
      await query(
        `INSERT INTO audit_logs (id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), 'login_fail', 'user', $1, $2, $3, NOW())`,
        [JSON.stringify({ loginId, reason: 'user_not_found' }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // ===== 계정 상태 체크 =====
    if (!user.is_active || user.status !== 'active') {
      const statusReason = !user.is_active ? 'account_disabled' : `account_${user.status}`;
      const statusMessages: Record<string, string> = {
        'account_locked': '계정이 잠금 상태입니다. 관리자에게 문의해주세요.',
        'account_dormant': '휴면 계정입니다. 관리자에게 문의해주세요.',
        'account_disabled': '비활성화된 계정입니다. 관리자에게 문의해주세요.',
      };
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_blocked', 'user', $2, $3, $4, NOW())`,
        [user.id, JSON.stringify({ loginId, reason: statusReason, status: user.status, companyName: user.company_name }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(403).json({ error: statusMessages[statusReason] || '로그인할 수 없는 계정입니다. 관리자에게 문의해주세요.' });
    }
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_fail', 'user', $2, $3, $4, NOW())`,
        [user.id, JSON.stringify({ loginId, reason: 'invalid_password', companyName: user.company_name }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // ===== 고객사 관리자 전용 접속 체크 =====
    const loginSource = req.body.loginSource;
    if (loginSource === 'company-admin' && user.user_type !== 'admin') {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_blocked', 'user', $2, $3, $4, NOW())`,
        [user.id, JSON.stringify({ loginId, reason: 'not_company_admin', companyName: user.company_name }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(403).json({ error: '고객사 관리자 권한이 없습니다.' });
    }

    // ===== 단일 세션 체크 =====
    const activeSessions = await query(
      `SELECT id, last_activity_at FROM user_sessions
       WHERE user_id = $1 AND is_active = true
       ORDER BY last_activity_at DESC`,
      [user.id]
    );

    if (activeSessions.rows.length > 0) {
      // 기존 세션 전부 무효화 (발송 중이어도 로그인 허용 — 발송은 백그라운드 처리)
      await query(
        `UPDATE user_sessions SET is_active = false WHERE user_id = $1`,
        [user.id]
      );
    }

    // ===== 새 세션 생성 =====
    const sessionId = crypto.randomUUID();

    const payload: JwtPayload = {
      userId: user.id,
      companyId: user.company_id,
      userType: user.user_type === 'admin' ? 'company_admin' : 'company_user',
      loginId: user.login_id,
      sessionId: sessionId,
    };

    const token = generateToken(payload);

    // 세션 레코드 저장
    await query(
      `INSERT INTO user_sessions (id, user_id, session_token, is_active, ip_address, user_agent, device_type, created_at, last_activity_at, expires_at)
       VALUES ($1, $2, $3, true, $4, $5, 'web', NOW(), NOW(), NOW() + INTERVAL '24 hours')`,
      [sessionId, user.id, token, req.ip || '', req.headers['user-agent'] || '']
    );

    // 로그인 기록
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'login_success', 'user', $2, $3, $4, NOW())`,
      [user.id, JSON.stringify({ loginId, companyName: user.company_name, userType: user.user_type }), req.ip, req.headers['user-agent'] || '']
    );

    // 로그인 시간 갱신
    await query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // 세션 타임아웃 조회
    const timeoutResult = await query(
      'SELECT session_timeout_minutes, kakao_enabled FROM companies WHERE id = $1',
      [user.company_id]
    );
    const sessionTimeoutMinutes = timeoutResult.rows[0]?.session_timeout_minutes || 30;
    const kakaoEnabled = timeoutResult.rows[0]?.kakao_enabled || false;

    return res.json({
      token,
      user: {
        id: user.id,
        loginId: user.login_id,
        name: user.name,
        email: user.email,
        userType: payload.userType,
        mustChangePassword: user.must_change_password || false,
        hiddenFeatures: user.hidden_features || [],
        storeCodes: user.store_codes || [],
        company: {
          id: user.company_id,
          name: user.company_name,
          code: user.company_code,
          kakaoEnabled,
          subscriptionStatus: user.subscription_status || 'trial',
        },
      },
      sessionTimeoutMinutes,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/register-super-admin', async (req: Request, res: Response) => {
  try {
    const { loginId, password, name, email } = req.body;

    const existing = await query('SELECT COUNT(*) FROM super_admins');

    if (parseInt(existing.rows[0].count) > 0) {
      return res.status(403).json({ error: 'Super admin already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO super_admins (login_id, password_hash, name, email, role)
       VALUES ($1, $2, $3, $4, 'super')
       RETURNING id, login_id, name, email`,
      [loginId, passwordHash, name, email]
    );

    return res.status(201).json({
      message: 'Super admin created',
      admin: result.rows[0],
    });
  } catch (error: any) {
    console.error('Register error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Login ID already exists' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

// 비밀번호 변경 (최초 로그인 시)
router.post('/change-password', async (req: Request, res: Response) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
    }

    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await query(
      'UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, userId]
    );

    return res.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (error) {
    console.error('비밀번호 변경 오류:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// 세션 연장
router.post('/extend-session', authenticate, async (req: any, res: Response) => {
  try {
    if (req.user?.sessionId) {
      const timeoutResult = await query(
        'SELECT c.session_timeout_minutes FROM companies c JOIN users u ON u.company_id = c.id WHERE u.id = $1',
        [req.user.userId]
      );
      const minutes = timeoutResult.rows[0]?.session_timeout_minutes || 30;

      await query(
        `UPDATE user_sessions SET last_activity_at = NOW(), expires_at = NOW() + INTERVAL '1 minute' * $2
         WHERE id = $1 AND is_active = true`,
        [req.user.sessionId, minutes]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('세션 연장 오류:', error);
    res.json({ success: true });
  }
});

router.get('/session-check', authenticate, async (req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
