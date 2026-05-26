/**
 * ★ D219+ Part 2 후속 (2026-05-27 신설) — 일일 인사이트 API endpoint
 *
 * 🎯 매일 9시 메일 발송 흐름 (CT-98 daily-insight-mailer) + PerformancePage 카드 양쪽 활용.
 *   사용자가 메일 X 영역 = 화면 안 즉시 확인 가능 흐름.
 *
 * 인증 = authenticate 단일 (요금제 게이팅 X — Performance 메뉴 사용 사용자 모두 활용 가능).
 *
 * 응답 형식 = { success, insight } 또는 { success, insight: null } (회사 정보 없음).
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { collectCompanyInsight } from '../utils/daily-insight-mailer';

const router = Router();
router.use(authenticate);

/**
 * GET /api/insight/daily
 * 응답: { success, insight: CompanyInsight | null }
 */
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const insight = await collectCompanyInsight(companyId);
    return res.json({ success: true, insight });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        code: 'DB_MIGRATION_PENDING',
        error: 'DB 마이그레이션이 필요합니다. 운영자에게 companies ALTER 실행을 요청하세요.',
      });
    }
    console.error('[insight/daily] 실패:', err);
    return res.status(500).json({ success: false, error: '일일 인사이트 조회 실패' });
  }
});

export default router;
