/**
 * ★ D112: 슈퍼관리자 서비스 모드 가드 미들웨어
 *
 * JWT payload의 current_service 필드로 한줄로/전단AI 접근을 분리.
 * - /api/admin/flyer/* → requireService('flyer')
 * - /api/admin/hanjullo/* → requireService('hanjullo')
 *
 * 참조: FLYER-SUPERADMIN.md § 3.3
 */

import { Request, Response, NextFunction } from 'express';

export type ServiceType = 'hanjullo' | 'flyer';

/**
 * 특정 서비스 모드에서만 접근 허용하는 가드.
 * JWT의 current_service 필드를 확인.
 *
 * ⚠️ 현재는 슈퍼관리자이고 올바른 서비스 모드인지만 확인.
 * switch-service API로 토큰을 교체해야 모드가 바뀜.
 */
export function requireService(expected: ServiceType) {
  return (req: Request, res: Response, next: NextFunction) => {
    // req.user는 기존 한줄로 authenticate 미들웨어가 설정
    const user = req.user;
    if (!user || user.userType !== 'super_admin') {
      return res.status(401).json({ error: 'Super admin access required' });
    }

    // JWT에 currentService 필드가 없으면 기본 'hanjullo' (하위 호환)
    const currentService = (user as any).currentService || 'hanjullo';
    if (currentService !== expected) {
      return res.status(403).json({
        error: `${expected === 'flyer' ? '전단AI' : '한줄로AI'} 모드에서만 접근 가능합니다`,
        currentService,
        expectedService: expected,
      });
    }

    next();
  };
}
