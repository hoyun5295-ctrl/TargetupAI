import bcrypt from 'bcryptjs';
import { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { TIMEOUTS } from '../config/defaults';
import { authenticate, generateToken, JwtPayload } from '../middlewares/auth';
import { rotateUserSession, normalizeAppSource, newSessionId } from '../utils/session-manager';
import { isBlocked, recordFailureAndMaybeBlock, clearBlocksOnSuccess } from '../utils/login-block';
import {
  generateTotpSecret,
  buildOtpAuthUrl,
  generateQrDataUrl,
  verifyTotpCode,
  generateBackupCodesPlain,
  hashBackupCodes,
  verifyBackupCode,
  signEnrollToken,
  verifyEnrollToken,
  BackupCodeRecord,
} from '../utils/totp';

const router = Router();

// 로그인 brute-force 방어: IP당 1분 최대 10회 실패. 성공 요청은 카운트 제외.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    // ★ loginId 앞뒤 공백 제거 — frontend trim 누락 또는 다른 클라이언트 방어선
    const loginId: string = String(req.body.loginId || '').trim();
    const { password, userType } = req.body;
    // ★ D111 P0: app_source 기반 단일 세션 — 'hanjul' | 'flyer' | 'super'
    //   - 한줄로 메인(hanjul.ai) + 고객사관리자(app.hanjul.ai) 전부 'hanjul'로 묶음
    //   - 전단AI(flyer-frontend)는 'flyer' → 한줄로와 별개 공존
    //   - 슈퍼관리자 경로는 자동으로 'super'로 덮어씀 (아래)
    const appSource = normalizeAppSource(req.body.appSource);

    if (!loginId || !password) {
      return res.status(400).json({ error: 'ID and password required' });
    }

    // ★ D145 P0 (2026-05-07): 어플리케이션 레벨 차단 — (IP, loginId) 쌍 단위
    //   같은 (ip, loginId)에서 5회 실패 / 10분 윈도우 → 30분 자동 차단.
    //   다른 IP의 같은 loginId, 다른 loginId의 같은 IP는 영향 없음(정상 사용자 보호).
    const ipForBlock = req.ip || '';
    const blocked = await isBlocked(ipForBlock, loginId);
    if (blocked) {
      const remainSec = Math.max(0, Math.floor((new Date(blocked.expires_at).getTime() - Date.now()) / 1000));
      const remainMin = Math.ceil(remainSec / 60);
      return res.status(403).json({
        error: `로그인 시도 5회 초과로 임시 차단되었습니다. ${remainMin}분 후 자동 해제 또는 관리자에게 문의하세요.`,
        code: 'LOGIN_BLOCKED',
        remainingSeconds: remainSec,
      });
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
        await recordFailureAndMaybeBlock(ipForBlock, loginId);
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
        await recordFailureAndMaybeBlock(ipForBlock, loginId);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // ★ 2026-05-11: 슈퍼관리자 2FA(TOTP) 게이트 — utils/totp.ts CT
      //   - totp_enabled=false → enrollment 모드: QR + 백업 코드 발급, enrollToken 응답 (JWT 미발급)
      //   - totp_enabled=true → totpCode 6자리 또는 백업 코드 8자(hex) 검증 통과해야 JWT 발급
      if (!admin.totp_enabled) {
        const newSecret = generateTotpSecret();
        const plainBackupCodes = generateBackupCodesPlain();
        const hashedBackupCodes = await hashBackupCodes(plainBackupCodes);
        await query(
          'UPDATE super_admins SET totp_secret = $1, backup_codes = $2 WHERE id = $3',
          [newSecret, JSON.stringify(hashedBackupCodes), admin.id]
        );
        const otpAuthUrl = buildOtpAuthUrl(admin.login_id, newSecret);
        const qrDataUrl = await generateQrDataUrl(otpAuthUrl);
        const enrollToken = signEnrollToken(admin.id);
        await query(
          `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
           VALUES (gen_random_uuid(), $1, 'totp_enroll_start', 'super_admin', $2, $3, $4, NOW())`,
          [admin.id, JSON.stringify({ loginId }), req.ip, req.headers['user-agent'] || '']
        );
        return res.json({
          enrollmentRequired: true,
          enrollToken,
          qrDataUrl,
          backupCodes: plainBackupCodes,
          loginId: admin.login_id,
        });
      }

      const totpCodeRaw = String(req.body.totpCode || '').trim();
      if (!totpCodeRaw) {
        return res.status(401).json({ error: 'OTP 코드가 필요합니다.', needTotp: true });
      }
      let totpValid = verifyTotpCode(admin.totp_secret, totpCodeRaw);
      let usedBackup = false;
      let updatedBackupCodes: BackupCodeRecord[] = Array.isArray(admin.backup_codes) ? admin.backup_codes : [];
      if (!totpValid) {
        const br = await verifyBackupCode(updatedBackupCodes, totpCodeRaw);
        if (br.matched) {
          totpValid = true;
          usedBackup = true;
          updatedBackupCodes = br.updatedCodes;
        }
      }
      if (!totpValid) {
        await query(
          `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
           VALUES (gen_random_uuid(), $1, 'login_fail', 'super_admin', $2, $3, $4, NOW())`,
          [admin.id, JSON.stringify({ loginId, reason: 'invalid_totp' }), req.ip, req.headers['user-agent'] || '']
        );
        await recordFailureAndMaybeBlock(ipForBlock, loginId);
        return res.status(401).json({ error: 'OTP 코드가 일치하지 않습니다.', needTotp: true });
      }
      if (usedBackup) {
        await query(
          'UPDATE super_admins SET backup_codes = $1 WHERE id = $2',
          [JSON.stringify(updatedBackupCodes), admin.id]
        );
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

      // ★ D145: 성공 시 같은 (ip, loginId)의 미만료 차단 자동 해제
      await clearBlocksOnSuccess(ipForBlock, loginId, admin.id);

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
      `SELECT u.*, u.must_change_password, u.hidden_features, c.company_name as company_name, c.id as company_code, c.subscription_status, c.usage_type
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
      await recordFailureAndMaybeBlock(ipForBlock, loginId);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // ===== SyncAgent v1.5.0: is_system 계정 로그인 차단 =====
    // 시스템 가상 user (싱크에이전트 uploaded_by 기록용)는 로그인 불가.
    if (user.is_system === true) {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_blocked', 'user', $2, $3, $4, NOW())`,
        [user.id, JSON.stringify({ loginId, reason: 'system_account' }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(403).json({ error: '시스템 계정은 로그인할 수 없습니다.' });
    }

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
      await recordFailureAndMaybeBlock(ipForBlock, loginId);
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

    // ===== ★ 2026-07-03 에이전트(QTmsg) 전용 회사 — 고객사 관리자 페이지(app) 접속 차단 =====
    //   에이전트 전용 계정 허용 화면 = hanjul.ai 카카오 템플릿 관리만. 발송통계/고객DB 노출 차단.
    if (loginSource === 'company-admin' && (user.usage_type || 'web') === 'agent') {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_blocked', 'user', $2, $3, $4, NOW())`,
        [user.id, JSON.stringify({ loginId, reason: 'agent_only_company', companyName: user.company_name }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(403).json({ error: '에이전트 전용 계정은 이 페이지를 사용할 수 없습니다.' });
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

    // ★ D145: 성공 시 같은 (ip, loginId)의 미만료 차단 자동 해제
    await clearBlocksOnSuccess(ipForBlock, loginId, user.id);

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
          // ★ 2026-07-03 사용구분: web(웹발송) / agent(QTmsg 에이전트 전용 — 메뉴 게이팅) / both
          usageType: user.usage_type || 'web',
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

// ===========================================================================
// 슈퍼관리자 TOTP 등록 확정 (★ 2026-05-11)
// - enrollToken(5분 JWT)으로 admin 식별 → DB에 임시 저장된 totp_secret로 첫 6자리 검증
// - 성공 시 totp_enabled=true UPDATE + 정상 JWT 발급 (자동 로그인)
// ===========================================================================
router.post('/super/confirm-totp', async (req: Request, res: Response) => {
  try {
    const enrollToken = String(req.body.enrollToken || '');
    const code = String(req.body.code || '').trim();
    const adminId = verifyEnrollToken(enrollToken);
    if (!adminId) {
      return res.status(401).json({ error: '등록 토큰이 만료되었습니다. 다시 로그인해주세요.' });
    }
    const r = await query(
      'SELECT * FROM super_admins WHERE id = $1 AND is_active = true',
      [adminId]
    );
    if (r.rows.length === 0) {
      return res.status(401).json({ error: '관리자 계정을 찾을 수 없습니다.' });
    }
    const admin = r.rows[0];
    if (!admin.totp_secret) {
      return res.status(400).json({ error: '등록 절차를 다시 시작해주세요.' });
    }
    if (!verifyTotpCode(admin.totp_secret, code)) {
      return res.status(401).json({ error: 'OTP 코드가 일치하지 않습니다.' });
    }
    await query('UPDATE super_admins SET totp_enabled = TRUE WHERE id = $1', [admin.id]);

    const sessionTimeoutMinutes = TIMEOUTS.superAdminSessionMinutes;
    const sessionId = newSessionId();
    const payload: JwtPayload = {
      userId: admin.id,
      userType: 'super_admin',
      loginId: admin.login_id,
      sessionId,
    };
    const token = generateToken(payload);
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
       VALUES (gen_random_uuid(), $1, 'totp_enrolled', 'super_admin', $2, $3, $4, NOW())`,
      [admin.id, JSON.stringify({ loginId: admin.login_id }), req.ip, req.headers['user-agent'] || '']
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
  } catch (err: any) {
    console.error('[super/confirm-totp]', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
