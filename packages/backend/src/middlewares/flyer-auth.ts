/**
 * ★ 전단AI 전용 인증 미들웨어 (CT-F)
 *
 * 한줄로 middlewares/auth.ts와 완전 분리.
 * - flyer_users 테이블 기반 사용자 인증
 * - JWT payload에 service='flyer' 강제 주입 → 한줄로 토큰 교차 사용 차단
 * - flyer_companies 기반 회사 격리
 *
 * 참조 문서: FLYER-MIGRATION-PLAN.md, FLYER-SUPERADMIN.md
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';

export interface FlyerJwtPayload {
  service: 'flyer';
  userId: string;
  companyId: string;
  role: 'flyer_admin' | 'flyer_staff';
  loginId: string;
  businessType: string; // D113: 업종 (mart/butcher 등)
  sessionId?: string;
}

declare global {
  namespace Express {
    interface Request {
      flyerUser?: FlyerJwtPayload;
    }
  }
}

// 전단AI 전용 JWT 시크릿. 미설정 시 메인 JWT_SECRET 재사용(서버 기동 시 자동 fallback)
const FLYER_JWT_SECRET = process.env.FLYER_JWT_SECRET || process.env.JWT_SECRET;
if (!FLYER_JWT_SECRET) {
  console.error('❌ [FATAL] FLYER_JWT_SECRET(또는 JWT_SECRET) 미설정. 서버 기동 불가.');
  process.exit(1);
}

const FLYER_JWT_EXPIRY = process.env.FLYER_JWT_EXPIRY || '24h';

export const generateFlyerToken = (payload: Omit<FlyerJwtPayload, 'service'>): string => {
  const full: FlyerJwtPayload = { ...payload, service: 'flyer' };
  return jwt.sign(full as object, FLYER_JWT_SECRET, { expiresIn: FLYER_JWT_EXPIRY } as any);
};

export const verifyFlyerToken = (token: string): FlyerJwtPayload => {
  const decoded = jwt.verify(token, FLYER_JWT_SECRET) as FlyerJwtPayload;
  if (decoded.service !== 'flyer') {
    throw new Error('Not a flyer token');
  }
  return decoded;
};

/**
 * 전단AI 전용 인증 미들웨어.
 * 한줄로 authenticate와 엄격히 분리. 한줄로 토큰은 service 필드 없어서 거부됨.
 */
export const flyerAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyFlyerToken(token);
    req.flyerUser = decoded;

    // 회사 결제 상태 확인 (suspended면 접근 차단)
    const companyCheck = await query(
      `SELECT payment_status, deleted_at FROM flyer_companies WHERE id = $1`,
      [decoded.companyId]
    );
    if (companyCheck.rows.length === 0 || companyCheck.rows[0].deleted_at) {
      return res.status(401).json({ error: 'Company not found or deleted' });
    }
    if (companyCheck.rows[0].payment_status === 'suspended') {
      return res.status(403).json({ error: '구독이 정지되었습니다. 관리자에게 문의해주세요.' });
    }

    // 사용자 활성 + 매장별 과금 확인
    const userCheck = await query(
      `SELECT deleted_at, payment_status, plan_expires_at, business_type FROM flyer_users WHERE id = $1 AND company_id = $2`,
      [decoded.userId, decoded.companyId]
    );
    if (userCheck.rows.length === 0 || userCheck.rows[0].deleted_at) {
      return res.status(401).json({ error: 'User not found or disabled' });
    }

    const u = userCheck.rows[0];
    // D113: 매장별 과금 체크
    if (u.payment_status === 'suspended') {
      return res.status(403).json({ error: '매장 구독이 정지되었습니다. 관리자에게 문의해주세요.' });
    }
    if (u.plan_expires_at && new Date(u.plan_expires_at) < new Date()) {
      return res.status(403).json({ error: '매장 구독 기간이 만료되었습니다.' });
    }

    // D113: JWT에 businessType 없으면 DB에서 보정 (기존 토큰 하위호환)
    if (!decoded.businessType) {
      decoded.businessType = u.business_type || 'mart';
      req.flyerUser = decoded;
    }

    next();
  } catch (error: any) {
    return res.status(401).json({ error: 'Invalid token', detail: error?.message });
  }
};

/**
 * flyer_admin 권한 전용 가드 (사장님). flyer_staff(직원) 차단.
 */
export const requireFlyerAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.flyerUser || req.flyerUser.role !== 'flyer_admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다' });
  }
  next();
};

export default { flyerAuthenticate, requireFlyerAdmin, generateFlyerToken, verifyFlyerToken };
