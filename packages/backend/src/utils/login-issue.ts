/**
 * login-issue.ts — 고객사 사용자 로그인 세션 발급·응답 조립 컨트롤타워 (★2026-08-18)
 *
 * 왜 뽑았나
 *   MFA 도입으로 세션 발급 지점이 둘이 됐다 — `/auth/login`(인증 면제·신뢰 기기)과 `/auth/mfa/verify`(코드 통과).
 *   응답 조립이 두 벌이 되면 한쪽만 고쳐지는 날이 온다(회사 정보·권한 필드가 화면 게이팅의 입력이라 조용히 갈린다).
 *   **본문은 기존 `/auth/login` 코드를 그대로 옮긴 것이다** — 기억으로 다시 쓰지 않았다.
 *
 * 호출부는 이 함수만 부르고 자체 세션 SQL·응답 조립을 작성하지 않는다.
 */

import type { Request } from 'express';
import { query } from '../config/database';
import { generateToken, JwtPayload } from '../middlewares/auth';
import { rotateUserSession, newSessionId, SessionConflict } from './session-manager';
import { clearBlocksOnSuccess } from './login-block';

export type LoginIssueResult =
  | { status: 'ok'; body: any }
  | { status: 'conflict'; conflict: SessionConflict };

/**
 * 세션을 발급하고 로그인 응답 본문을 만든다.
 * 기존 접속이 살아 있고 인계 동의가 없으면 세션을 만들지 않고 conflict를 돌려준다.
 */
export async function issueUserLogin(params: {
  user: any;
  loginId: string;
  appSource: string;
  req: Request;
  takeoverTicket?: any;
  /** (ip, loginId) 차단 해제용 — 원 로그인 경로가 쓰던 값 그대로 */
  ipForBlock: string;
  /** MFA를 막 통과했으면 클라이언트가 보관할 신뢰 기기 토큰 */
  mfaDeviceToken?: string;
}): Promise<LoginIssueResult> {
  const { user, loginId, appSource, req, takeoverTicket, ipForBlock, mfaDeviceToken } = params;

  const sessionId = newSessionId();
  const payload: JwtPayload = {
    userId: user.id,
    companyId: user.company_id,
    userType: user.user_type === 'admin' ? 'company_admin' : 'company_user',
    loginId: user.login_id,
    sessionId,
  };

  const token = generateToken(payload);

  const rotate = await rotateUserSession({
    sessionId,
    userId: user.id,
    token,
    appSource,
    req,
    expiresInMinutes: 24 * 60, // 24시간
    takeoverTicket,
  });

  if (rotate.status === 'conflict') {
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'login_session_conflict', 'user', $2, $3, $4, NOW())`,
      [user.id, JSON.stringify({ loginId, companyName: user.company_name }), req.ip, req.headers['user-agent'] || '']
    );
    return { status: 'conflict', conflict: rotate.conflict };
  }

  if (rotate.takeover) {
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'login_takeover', 'user', $2, $3, $4, NOW())`,
      [user.id, JSON.stringify({ loginId, companyName: user.company_name }), req.ip, req.headers['user-agent'] || '']
    );
  }

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

  return {
    status: 'ok',
    body: {
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
      ...(mfaDeviceToken ? { mfaDeviceToken } : {}),
    },
  };
}
