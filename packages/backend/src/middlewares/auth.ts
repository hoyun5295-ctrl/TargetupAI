import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  companyId?: string;
  userType: 'super_admin' | 'company_admin' | 'company_user';
  loginId: string;
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

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as JwtPayload;
    req.user = decoded;
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
