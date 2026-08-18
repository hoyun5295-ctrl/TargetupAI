import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { TIMEOUTS, LIMITS } from '../config/defaults';
import { requestContext } from '../utils/request-context';

export interface JwtPayload {
  userId: string;
  companyId?: string;
  userType: 'super_admin' | 'company_admin' | 'company_user';
  loginId: string;
  sessionId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// ★ 보안: JWT_SECRET 미설정 시 서버 기동 차단 (fail-fast)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ [FATAL] JWT_SECRET 환경변수가 설정되지 않았습니다. 서버를 시작할 수 없습니다.');
  process.exit(1);
}

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload as object, JWT_SECRET, { expiresIn: LIMITS.jwtExpiry } as any);
};

// last_activity_at 갱신 주기 (5분)
const ACTIVITY_UPDATE_INTERVAL = TIMEOUTS.activityUpdate;

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // ★ 2026-08-18: 같은 비밀키로 서명되지만 API 인증용이 아닌 단명 토큰들(접속 인계 동의 티켓,
    //   슈퍼관리자 2FA 등록 토큰)이 Bearer로 재사용되는 것을 막는다.
    //   아래에 "sessionId 없는 토큰은 통과"시키는 분기가 있어, 가드가 없으면 그대로 인증을 통과한다.
    //   토큰 종류를 하나씩 나열하지 않고, API 인증 토큰이 반드시 갖는 값(userId + userType)으로 판정한다.
    if (!decoded.userId || !decoded.userType) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = decoded;
    // 이후 호출 체인(callAIWithFallback 등)이 현재 사용자 ID를 인자 없이 읽도록 컨텍스트 저장
    requestContext.enterWith({ userId: decoded.userId, companyId: decoded.companyId, userType: decoded.userType });

    // sessionId 없는 기존 토큰은 통과 (배포 후 자연 만료)
    if (!decoded.sessionId) {
      return next();
    }

    // ★ 세션 유효성 체크 — is_active + expires_at 만료 여부
    const sessionResult = await query(
      'SELECT id, last_activity_at, expires_at FROM user_sessions WHERE id = $1 AND user_id = $2 AND is_active = true',
      [decoded.sessionId, decoded.userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({
        error: '다른 곳에서 로그인되어 현재 세션이 종료되었습니다.',
        forceLogout: true
      });
    }

    // ★ 보안: expires_at 지났으면 세션 만료 처리 (브라우저 닫았다 열어도 서버가 차단)
    const expiresAt = new Date(sessionResult.rows[0].expires_at);
    const now = new Date();
    if (now > expiresAt) {
      // 세션 비활성화
      query(
        'UPDATE user_sessions SET is_active = false WHERE id = $1',
        [decoded.sessionId]
      ).catch(() => {});
      return res.status(401).json({
        error: '세션이 만료되었습니다. 다시 로그인해주세요.',
        forceLogout: true
      });
    }

    // last_activity_at + expires_at 갱신 (5분 간격 — DB 부하 최소화)
    const lastActivity = new Date(sessionResult.rows[0].last_activity_at);
    if (now.getTime() - lastActivity.getTime() > ACTIVITY_UPDATE_INTERVAL) {
      // 활동이 있으면 expires_at도 연장
      const timeoutMinutes = decoded.userType === 'super_admin'
        ? TIMEOUTS.superAdminSessionMinutes
        : 30; // 기본값, extend-session에서 정확한 값으로 갱신
      query(
        `UPDATE user_sessions SET last_activity_at = NOW(), expires_at = NOW() + INTERVAL '1 minute' * $2 WHERE id = $1`,
        [decoded.sessionId, timeoutMinutes]
      ).catch(err => console.error('세션 활동 갱신 실패:', err));
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.userType !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
};

export const requireCompanyAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || (req.user.userType !== 'company_admin' && req.user.userType !== 'super_admin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ★ D162-4 (2026-05-15) PDF 0515 알림톡 #3 root cause fix:
//   `/:id` 라우트가 같은 파일 뒤의 명시 path 라우트(`/kakao-templates` 등)를 가로채는 사고 방지.
//   req.params.id가 UUID 형식이 아니면 next('route')로 다음 라우트 매칭으로 진행 → 명시 path 라우트 정확 매칭 보장.
//   path-to-regexp regex 패턴 (`/:id([0-9a-f-]{36})`)이 Express 4/5 path-to-regexp 버전 차이로 의도대로 작동 안 할 우려 100% 제거.
//   Express 버전 무관 작동 보장.
export const requireUuidId = (req: Request, _res: Response, next: NextFunction) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id || '')) return next('route');
  next();
};

export default { authenticate, requireSuperAdmin, requireCompanyAdmin, requireUuidId, generateToken };
