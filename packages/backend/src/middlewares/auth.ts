import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// JWT 페이로드 타입
export interface JwtPayload {
  userId: string;
  companyId?: string;
  userType: 'super_admin' | 'company_admin' | 'company_user';
  loginId: string;
}

// Request에 user 추가
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// JWT 검증 미들웨어
export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: '인증 토큰이 필요합니다.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'default-secret';

    const decoded = jwt.verify(token, secret) as JwtPayload;
    req.user = decoded;

    next();
  } catch (error) {
    res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
};

// 슈퍼관리자 권한 확인
export const requireSuperAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: '인증이 필요합니다.' });
    return;
  }

  if (req.user.userType !== 'super_admin') {
    res.status(403).json({ error: '슈퍼관리자 권한이 필요합니다.' });
    return;
  }

  next();
};

// 토큰 생성
export const generateToken = (payload: JwtPayload): string => {
  const secret = process.env.JWT_SECRET || 'default-secret';
  return jwt.sign(payload, secret, { expiresIn: '24h' });
};
