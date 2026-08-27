import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { TIMEOUTS } from '../config/defaults';
import { authenticate, generateToken, JwtPayload } from '../middlewares/auth';
import { rotateUserSession, normalizeAppSource, newSessionId, verifyPasswordChangeToken } from '../utils/session-manager';
import { resolveCompanyAccessDenial } from '../utils/company-access';
import { issueUserLogin } from '../utils/login-issue';
import {
  isMfaEnforced, isMfaSchemaMissing, isTrustedDevice, issueMfaChallenge, issueMfaTicket,
  verifyMfaTicket, verifyMfaChallenge, registerTrustedDevice, lockAccountForMfaFailure,
  MFA_CODE_TTL_MINUTES,
} from '../utils/mfa';
import { isBlocked, recordFailureAndMaybeBlock, clearBlocksOnSuccess } from '../utils/login-block';
import { evaluateLoginOrigin } from '../utils/geo-access';
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
  // ★ 2026-08-18: 409(이미 접속 중 안내)는 인증 실패가 아니다 — brute-force 카운트에서 제외.
  //   제외하지 않으면 모달을 몇 번 보는 것만으로 정상 사용자가 차단된다(사무실 공용 IP는 더 빨리).
  requestWasSuccessful: (_req: Request, res: Response) => res.statusCode < 400 || res.statusCode === 409,
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
      //   ★ 2026-08-18: 기존 접속이 살아 있으면 여기서 세션을 만들지 않고 인계 동의부터 받는다.
      const superRotate = await rotateUserSession({
        sessionId,
        userId: admin.id,
        token,
        appSource: 'super',
        req,
        expiresInMinutes: sessionTimeoutMinutes,
        takeoverTicket: req.body.takeoverTicket,
      });

      if (superRotate.status === 'geo_blocked') {
        return res.status(403).json({ error: superRotate.message });
      }
      // ★ 2026-08-27 초기 비밀번호 미변경 — **JWT를 주지 않는다**(전송자격인증 3.2·3.3).
      //   화면에서 가리는 방식이면 그 토큰으로 다른 API를 부를 수 있다. 변경 전용 단명 토큰만 준다.
      if (superRotate.status === 'password_change_required') {
        return res.json({
          passwordChangeRequired: true,
          changeToken: superRotate.changeToken,
          loginId: superRotate.loginId,
        });
      }
      if (superRotate.status === 'conflict') {
        await query(
          `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
           VALUES (gen_random_uuid(), $1, 'login_session_conflict', 'super_admin', $2, $3, $4, NOW())`,
          [admin.id, JSON.stringify({ loginId }), req.ip, req.headers['user-agent'] || '']
        );
        return res.status(409).json(superRotate.conflict);
      }

      if (superRotate.takeover) {
        await query(
          `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
           VALUES (gen_random_uuid(), $1, 'login_takeover', 'super_admin', $2, $3, $4, NOW())`,
          [admin.id, JSON.stringify({ loginId }), req.ip, req.headers['user-agent'] || '']
        );
      }

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
      // ★ 2026-08-18 c.status 추가 — 반드시 별칭 `company_status`.
      //   `u.*`가 이미 `status`(계정 상태)를 싣고 있어 별칭 없이 넣으면 **계정 상태가 회사 상태로 덮인다**
      //   (같은 컬럼명이 둘이면 뒤엣것이 이긴다) → 아래 계정 상태 게이트가 통째로 오작동한다.
      `SELECT u.*, u.must_change_password, u.hidden_features, c.company_name as company_name, c.id as company_code, c.subscription_status, c.usage_type, c.status AS company_status
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

    // ===== ★ 2026-08-18 회사 상태 체크 — 계정 상태보다 먼저 =====
    //   계약이 끝난 고객사는 계정 상태와 무관하게 못 들어온다.
    //   [왜 계정 축이 아니라 회사 축인가] 해지 라우트가 소속 계정을 dormant로 바꾸긴 하지만 그 전파는
    //   경로마다 달라 샌다(실측 0818 — 해지 14곳 중 1곳은 계정이 active, 정지 4곳은 전파 코드 자체가 없다).
    //   전파에 기대지 않고 회사 상태 하나로 닫는다.
    //   판정 소유 = utils/company-access.ts (NULL 취급·긍정 비교 근거는 그쪽 주석)
    const companyDenial = resolveCompanyAccessDenial(user.company_status);
    if (companyDenial) {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_blocked', 'user', $2, $3, $4, NOW())`,
        [user.id, JSON.stringify({ loginId, reason: companyDenial.reason, companyName: user.company_name }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(403).json({ error: companyDenial.message });
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

    // ===== ★ 2026-08-18 다중 인증(MFA) — 전송자격인증 3.4 =====
    //   [시행일] `MFA_ENFORCE_FROM` 이전에는 번호가 등록돼 있어도 묻지 않는다 — 사전 고지 기간(Harold 확정: 9/1 시행).
    //   [전환기] 주 인증번호가 등록된 계정만 태운다. 전면 적용하면 시행 즉시 전 고객이 못 들어온다.
    //   [면제] 이 기기·IP 대역이 24시간 신뢰 안이면 코드를 묻지 않는다.
    //   컨트롤타워 = utils/mfa.ts
    if (user.mfa_phone && isMfaEnforced()) {
      const trusted = await isTrustedDevice(user.id, req.body.mfaDeviceToken, req);
      if (!trusted) {
        const issued = await issueMfaChallenge(user.id, user.mfa_phone, req);
        await query(
          `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
           VALUES (gen_random_uuid(), $1, 'mfa_challenge', 'user', $2, $3, $4, NOW())`,
          [user.id, JSON.stringify({ loginId, delivery: issued.status }), req.ip, req.headers['user-agent'] || '']
        );
        // 인증 통과 전에는 로그인 토큰을 주지 않는다 — 티켓만 나간다
        return res.status(401).json({
          mfaRequired: true,
          mfaTicket: issueMfaTicket(user.id, issued.challengeId),
          maskedPhone: issued.maskedPhone,
          expiresInMinutes: MFA_CODE_TTL_MINUTES,
          ...(issued.status === 'reused' ? { resent: false, retryAfterSeconds: issued.retryAfterSeconds } : {}),
        });
      }
    }

    // ===== ★ D111 P0: app_source 단위 단일 세션 =====
    //   같은 app_source(hanjul/flyer) 내에서는 1세션만 — 2번째 로그인 시 인계 동의를 받는다.
    //   세션 발급·응답 조립 컨트롤타워 = utils/login-issue.ts (MFA 통과 경로와 같은 것을 쓴다)
    const issue = await issueUserLogin({
      user,
      loginId,
      appSource,
      req,
      takeoverTicket: req.body.takeoverTicket,
      ipForBlock,
    });

    if (issue.status === 'conflict') {
      return res.status(409).json(issue.conflict);
    }
    if (issue.status === 'geo_blocked') {
      return res.status(403).json({ error: issue.message });
    }

    return res.json(issue.body);
  } catch (error) {
    if (isMfaSchemaMissing(error)) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요: users.mfa_phone · mfa_challenges · mfa_trusted_devices 생성 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// ★ 2026-08-18(2) 로그아웃 — 서버 세션을 실제로 끊는다
//   [경위] 종전에는 endpoint 자체가 없어 클라이언트가 localStorage만 지웠다. 서버 행은 is_active=true로
//   남았고, 접속 인계가 그 유령 세션을 "접속 중"으로 읽어 **본인이 자기 세션 때문에 인계 안내를 받았다**.
//   [설계] 토큰이 만료·무효여도 200으로 끝낸다 — 로그아웃은 실패하면 안 되는 동작이다.
//   authenticate를 걸면 만료 토큰이 401로 막혀 세션이 영영 안 끊긴다.
// ============================================================
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : String(req.body?.token || '');
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
        if (decoded?.sessionId && decoded?.userId) {
          await query(
            'UPDATE user_sessions SET is_active = false WHERE id = $1 AND user_id = $2',
            [decoded.sessionId, decoded.userId]
          );
          await query(
            `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
             VALUES (gen_random_uuid(), $1, 'logout', 'user', $2, $3, $4, NOW())`,
            [decoded.userId, JSON.stringify({ loginId: decoded.loginId }), req.ip, req.headers['user-agent'] || '']
          ).catch(() => {});
        }
      } catch {
        // 만료·위조 토큰 — 끊을 세션을 특정할 수 없을 뿐, 로그아웃은 성공으로 끝낸다
      }
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('[logout]', error);
    return res.json({ success: true });
  }
});

// ============================================================
// ★ 2026-08-18 MFA — 인증번호 검증 / 재발송 (전송자격인증 3.4)
// ============================================================

/** 티켓 → 사용자 행. 티켓이 죽었으면 처음부터 다시 로그인시킨다 */
async function loadMfaUser(ticket: any) {
  const parsed = verifyMfaTicket(ticket);
  if (!parsed) return null;
  const result = await query(
    `SELECT u.*, u.must_change_password, u.hidden_features, c.company_name as company_name, c.id as company_code, c.subscription_status, c.usage_type, c.status AS company_status
       FROM users u JOIN companies c ON u.company_id = c.id
      WHERE u.id = $1`,
    [parsed.userId]
  );
  if (result.rows.length === 0) return null;
  return { user: result.rows[0], challengeId: parsed.challengeId };
}

router.post('/mfa/verify', loginLimiter, async (req: Request, res: Response) => {
  try {
    const loaded = await loadMfaUser(req.body.mfaTicket);
    if (!loaded) {
      return res.status(401).json({ error: '인증 시간이 만료되었습니다. 다시 로그인해주세요.', code: 'MFA_TICKET_INVALID' });
    }
    const { user, challengeId } = loaded;

    // 티켓 발급 이후 회사·계정 상태가 바뀌었을 수 있다 — 통과 직전에 다시 본다
    const denial = resolveCompanyAccessDenial(user.company_status);
    if (denial) return res.status(403).json({ error: denial.message });
    if (!user.is_active || user.status !== 'active') {
      return res.status(403).json({ error: '로그인할 수 없는 계정입니다. 관리자에게 문의해주세요.' });
    }

    const verdict = await verifyMfaChallenge(challengeId, user.id, req.body.code);

    if (verdict.status === 'locked') {
      await lockAccountForMfaFailure(user.id, req);
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'mfa_locked', 'user', $2, $3, $4, NOW())`,
        [user.id, JSON.stringify({ loginId: user.login_id }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(423).json({
        error: '인증번호를 여러 번 잘못 입력해 계정이 잠겼습니다. 담당자에게 문의해주세요.',
        code: 'ACCOUNT_LOCKED',
      });
    }
    if (verdict.status === 'expired') {
      return res.status(401).json({ error: '인증번호가 만료되었습니다. 다시 받아주세요.', code: 'MFA_EXPIRED' });
    }
    if (verdict.status === 'wrong') {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'mfa_fail', 'user', $2, $3, $4, NOW())`,
        [user.id, JSON.stringify({ loginId: user.login_id, remainingAttempts: verdict.remainingAttempts }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(401).json({
        error: `인증번호가 일치하지 않습니다. (남은 횟수 ${verdict.remainingAttempts}회)`,
        code: 'MFA_WRONG',
        remainingAttempts: verdict.remainingAttempts,
      });
    }

    // 통과 — 이 기기를 24시간 신뢰하고 로그인 세션을 발급한다
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'mfa_success', 'user', $2, $3, $4, NOW())`,
      [user.id, JSON.stringify({ loginId: user.login_id }), req.ip, req.headers['user-agent'] || '']
    );
    const mfaDeviceToken = await registerTrustedDevice(user.id, req);

    const issue = await issueUserLogin({
      user,
      loginId: user.login_id,
      appSource: normalizeAppSource(req.body.appSource),
      req,
      takeoverTicket: req.body.takeoverTicket,
      ipForBlock: req.ip || '',
      mfaDeviceToken,
    });
    if (issue.status === 'conflict') return res.status(409).json(issue.conflict);
    if (issue.status === 'geo_blocked') return res.status(403).json({ error: issue.message });
    return res.json(issue.body);
  } catch (error) {
    if (isMfaSchemaMissing(error)) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요: users.mfa_phone · mfa_challenges · mfa_trusted_devices 생성 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[mfa/verify]', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/mfa/resend', loginLimiter, async (req: Request, res: Response) => {
  try {
    const loaded = await loadMfaUser(req.body.mfaTicket);
    if (!loaded) {
      return res.status(401).json({ error: '인증 시간이 만료되었습니다. 다시 로그인해주세요.', code: 'MFA_TICKET_INVALID' });
    }
    const { user } = loaded;
    if (!user.mfa_phone) {
      return res.status(400).json({ error: '등록된 인증번호가 없습니다. 담당자에게 문의해주세요.' });
    }

    const issued = await issueMfaChallenge(user.id, user.mfa_phone, req);
    if (issued.status === 'reused') {
      return res.status(429).json({
        error: `${issued.retryAfterSeconds}초 후에 다시 받을 수 있습니다.`,
        code: 'MFA_COOLDOWN',
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'mfa_challenge', 'user', $2, $3, $4, NOW())`,
      [user.id, JSON.stringify({ loginId: user.login_id, delivery: 'resend' }), req.ip, req.headers['user-agent'] || '']
    );
    // 챌린지가 새로 생겼으므로 티켓도 새로 발급한다(옛 티켓은 옛 챌린지를 가리킨다)
    return res.json({
      mfaTicket: issueMfaTicket(user.id, issued.challengeId),
      maskedPhone: issued.maskedPhone,
      expiresInMinutes: MFA_CODE_TTL_MINUTES,
    });
  } catch (error) {
    if (isMfaSchemaMissing(error)) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요: users.mfa_phone · mfa_challenges · mfa_trusted_devices 생성 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[mfa/resend]', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
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
    // ★ 2026-08-18: 등록 확정(totp_enabled)은 이미 끝났고, 남은 건 세션뿐이다.
    //   기존 접속이 살아 있으면 세션을 만들지 않고 인계 동의부터 받는다.
    const enrollRotate = await rotateUserSession({
      sessionId,
      userId: admin.id,
      token,
      appSource: 'super',
      req,
      expiresInMinutes: sessionTimeoutMinutes,
      takeoverTicket: req.body.takeoverTicket,
    });

    // ★ 0819 Codex 2R — TOTP 최초 등록 확정도 슈퍼관리자 세션을 만든다. 여기도 게이트를 지난다
    if (enrollRotate.status === 'geo_blocked') {
      return res.status(403).json({ error: enrollRotate.message });
    }
    if (enrollRotate.status === 'conflict') {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_session_conflict', 'super_admin', $2, $3, $4, NOW())`,
        [admin.id, JSON.stringify({ loginId: admin.login_id, step: 'totp_enroll' }), req.ip, req.headers['user-agent'] || '']
      );
      return res.status(409).json(enrollRotate.conflict);
    }
    // ★ 2026-08-27 초기 비밀번호 미변경 — JWT만 막는다.
    //   ⚠ TOTP 등록은 이미 확정됐다(`totp_enabled = TRUE`가 위에서 커밋됐다). **그 사실은 기록한다** —
    //     실제로 일어난 일을 안 남기면 감사 기록이 사실과 어긋난다.
    if (enrollRotate.status === 'password_change_required') {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'totp_enrolled', 'super_admin', $2, $3, $4, NOW())`,
        [admin.id, JSON.stringify({ loginId: admin.login_id }), req.ip, req.headers['user-agent'] || '']
      ).catch(() => {});
      return res.json({
        passwordChangeRequired: true,
        changeToken: enrollRotate.changeToken,
        loginId: enrollRotate.loginId,
      });
    }

    if (enrollRotate.takeover) {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_takeover', 'super_admin', $2, $3, $4, NOW())`,
        [admin.id, JSON.stringify({ loginId: admin.login_id, step: 'totp_enroll' }), req.ip, req.headers['user-agent'] || '']
      );
    }

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

/**
 * 슈퍼관리자 초기 비밀번호 변경 (★2026-08-27 전송자격인증 3.2·3.3).
 *
 * ⛔ 이 경로는 **JWT를 요구하지 않는다.** 초기 비밀번호 상태에서는 세션 자체를 안 만들기 때문이다.
 *   대신 로그인 응답이 준 변경 전용 단명 토큰(10분)만 받는다 — 이 토큰으로 다른 API는 못 부른다.
 * ⛔ 토큰만으로 바꾸지 않는다. **현재 비밀번호를 다시 확인**한다 — 토큰이 새면 계정이 넘어간다.
 * ⛔ 변경 후 세션을 발급하지 않는다. 새 비밀번호로 다시 로그인하게 한다(TOTP도 다시 지난다).
 */
router.post('/super/change-initial-password', async (req: Request, res: Response) => {
  try {
    const adminId = verifyPasswordChangeToken(req.body?.changeToken);
    if (!adminId) {
      return res.status(401).json({ error: '변경 시간이 지났습니다. 다시 로그인해주세요.' });
    }
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
    }
    if (newPassword.length < 10) {
      return res.status(400).json({ error: '새 비밀번호는 10자 이상이어야 합니다.' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: '초기 비밀번호와 다른 값으로 바꿔주세요.' });
    }

    const result = await query('SELECT id, login_id, password_hash FROM super_admins WHERE id = $1 AND is_active = true', [adminId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
    }
    const admin = result.rows[0];
    if (!(await bcrypt.compare(currentPassword, admin.password_hash))) {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'login_fail', 'super_admin', $2, $3, $4, NOW())`,
        [admin.id, JSON.stringify({ loginId: admin.login_id, reason: 'invalid_password', step: 'initial_password_change' }), req.ip, req.headers['user-agent'] || '']
      ).catch(() => {});
      return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await query(
      'UPDATE super_admins SET password_hash = $1, must_change_password = false WHERE id = $2',
      [newHash, admin.id]
    );
    // ⛔ 비밀번호는 어떤 형태로도 details에 넣지 않는다(감사 로그는 열람 대상이다)
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'admin_password_changed', 'super_admin', $1, $2, $3, $4, NOW())`,
      [admin.id, JSON.stringify({ loginId: admin.login_id, reason: 'initial_password' }), req.ip, req.headers['user-agent'] || '']
    ).catch(() => {});

    return res.json({ success: true, message: '비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해주세요.' });
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요: super_admins ALTER 실행 요청 (must_change_password)',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[super/change-initial-password]', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
