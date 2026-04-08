import bcrypt from 'bcryptjs';
import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { TIMEOUTS } from '../config/defaults';
import { authenticate, generateToken, JwtPayload } from '../middlewares/auth';
import { rotateUserSession, normalizeAppSource, newSessionId } from '../utils/session-manager';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { loginId, password, userType } = req.body;
    // ★ D111 P0: app_source 기반 단일 세션 — 'hanjul' | 'flyer' | 'super'
    //   - 한줄로 메인(hanjul.ai) + 고객사관리자(app.hanjul.ai) 전부 'hanjul'로 묶음
    //   - 전단AI(flyer-frontend)는 'flyer' → 한줄로와 별개 공존
    //   - 슈퍼관리자 경로는 자동으로 'super'로 덮어씀 (아래)
    const appSource = normalizeAppSource(req.body.appSource);

    if (!loginId || !password) {
      return res.status(400).json({ error: 'ID and password required' });
    }

    // ===== 슈퍼관리자 로그인 (★ 보안: 세션 관리 적용) =====
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

      // ★ D111 P0: 슈퍼관리자는 app_source='super' 단일 세션 (D100의 5개 허용 폐기)
      //   같은 super 세션이 있으면 이전 것은 무효화 → 다음 API 호출 때 401 → 재로그인
      //   단, 다른 app_source(hanjul/flyer)는 그대로 유지
      const sessionTimeoutMinutes = TIMEOUTS.superAdminSessionMinutes;

      const sessionId = newSessionId();
      const payload: JwtPayload = {
        userId: admin.id,
        userType: 'super_admin',
        loginId: admin.login_id,
        sessionId,
      };

      const token = generateToken(payload);

      // ★ 컨트롤타워 rotateUserSession — invalidate + create 통합. 인라인 세션 SQL 금지.
      await rotateUserSession({
        sessionId,
        userId: admin.id,
        token,
        appSource: 'super',
        req,
        expiresInMinutes: sessionTimeoutMinutes,
      });

      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_success', 'super_admin', $2, $3, $4, NOW())`,
        [admin.id, JSON.stringify({ loginId }), req.ip, req.headers['user-agent'] || '']
      );

      await query(
        'UPDATE super_admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
        [admin.id]
      );

      return res.json({
        token,
        user: {
          id: admin.id,
          loginId: admin.login_id,
          name: admin.name,
          email: admin.email,
          userType: 'super_admin',
        },
        sessionTimeoutMinutes,
      });
    }

    // ===== 고객사 사용자 로그인 =====
    const result = await query(
      `SELECT u.*, u.must_change_password, u.hidden_features, c.company_name as company_name, c.id as company_code, c.subscription_status
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

    // ===== ★ D111 P0: app_source 단위 단일 세션 =====
    //   D100에서 "5개 허용"으로 풀었던 로직 완전 제거.
    //   같은 app_source(hanjul/flyer) 내에서는 1세션만 — 2번째 로그인 시 이전 세션 무효화.
    //   app_source가 다르면 공존 → 한줄로(hanjul) + 전단AI(flyer) 동시 사용 가능.
    //   컨트롤타워: utils/session-manager.ts (rotateUserSession)
    const sessionId = newSessionId();
    const payload: JwtPayload = {
      userId: user.id,
      companyId: user.company_id,
      userType: user.user_type === 'admin' ? 'company_admin' : 'company_user',
      loginId: user.login_id,
      sessionId,
    };

    const token = generateToken(payload);

    await rotateUserSession({
      sessionId,
      userId: user.id,
      token,
      appSource,
      req,
      expiresInMinutes: 24 * 60, // 24시간
    });

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

// 세션 연장 (슈퍼관리자 + 일반사용자 공용)
router.post('/extend-session', authenticate, async (req: any, res: Response) => {
  try {
    if (req.user?.sessionId) {
      let minutes: number;

      if (req.user.userType === 'super_admin') {
        minutes = TIMEOUTS.superAdminSessionMinutes;
      } else {
        const timeoutResult = await query(
          'SELECT c.session_timeout_minutes FROM companies c JOIN users u ON u.company_id = c.id WHERE u.id = $1',
          [req.user.userId]
        );
        minutes = timeoutResult.rows[0]?.session_timeout_minutes || 30;
      }

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
