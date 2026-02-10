import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';

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

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });
};

// last_activity_at 갱신 주기 (5분)
const ACTIVITY_UPDATE_INTERVAL = 5 * 60 * 1000;

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as JwtPayload;
    req.user = decoded;

    // 슈퍼관리자는 세션 체크 건너뜀
    if (decoded.userType === 'super_admin') {
      return next();
    }

    // sessionId 없는 기존 토큰은 통과 (배포 후 자연 만료)
    if (!decoded.sessionId) {
      return next();
    }

    // 세션 유효성 체크
    const sessionResult = await query(
      'SELECT id, last_activity_at FROM user_sessions WHERE id = $1 AND user_id = $2 AND is_active = true',
      [decoded.sessionId, decoded.userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({
        error: '다른 곳에서 로그인되어 현재 세션이 종료되었습니다.',
        forceLogout: true
      });
    }

    // last_activity_at 갱신 (5분 간격 — DB 부하 최소화)
    const lastActivity = new Date(sessionResult.rows[0].last_activity_at);
    const now = new Date();
    if (now.getTime() - lastActivity.getTime() > ACTIVITY_UPDATE_INTERVAL) {
      // 비동기로 갱신 (응답 지연 없음)
      query(
        'UPDATE user_sessions SET last_activity_at = NOW() WHERE id = $1',
        [decoded.sessionId]
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

export default { authenticate, requireSuperAdmin, requireCompanyAdmin, generateToken };
