/**
 * ★ D112: 슈퍼관리자 서비스 전환 엔드포인트
 * 마운트: /api/admin/switch-service
 *
 * JWT를 재발급하여 currentService = 'hanjullo' | 'flyer' 변경.
 */

import { Request, Response, Router } from 'express';
import { authenticate, generateToken, JwtPayload } from '../../middlewares/auth';
import { ServiceType } from '../../middlewares/super-service-guard';

const router = Router();

router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user || user.userType !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin only' });
    }

    const { to } = req.body as { to: ServiceType };
    if (to !== 'hanjullo' && to !== 'flyer') {
      return res.status(400).json({ error: 'to must be "hanjullo" or "flyer"' });
    }

    // 새 JWT 발급 (currentService 포함)
    const newPayload: any = {
      userId: user.userId,
      userType: user.userType,
      loginId: user.loginId,
      sessionId: user.sessionId,
      currentService: to,
    };
    const token = generateToken(newPayload as JwtPayload);

    return res.json({
      token,
      currentService: to,
      redirectTo: to === 'flyer' ? '/flyer/dashboard' : '/hanjullo/dashboard',
    });
  } catch (error: any) {
    console.error('[admin/switch-service] error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
