/**
 * ★ 전단AI 대시보드 통계 라우트
 * 마운트: /api/flyer/stats
 * CT: CT-F09 flyer-stats.ts
 */

import { Request, Response, Router } from 'express';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
import { getFlyerDashboardStats, getFlyerCampaignResults } from '../../utils/flyer';
import { getTrackingStats } from '../../utils/flyer/send/flyer-short-code';

const router = Router();
router.use(flyerAuthenticate);

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const stats = await getFlyerDashboardStats(companyId);
    return res.json(stats);
  } catch (error: any) {
    console.error('[flyer/stats] dashboard error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/results', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const page = parseInt(String(req.query.page || '1'), 10);
    const pageSize = parseInt(String(req.query.pageSize || '20'), 10);
    const result = await getFlyerCampaignResults(companyId, page, pageSize);
    return res.json(result);
  } catch (error: any) {
    console.error('[flyer/stats] results error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /results/:id/recipients — 개별 캠페인 수신자 상세 (ResultsPage 모달용)
 */
router.get('/results/:id/recipients', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { id } = req.params;
    const limit = Math.min(500, parseInt(String(req.query.limit || '100'), 10));

    // flyer_campaigns에서 해당 캠페인의 발송 대상 phone 목록은
    // MySQL QTmsg 큐에서 조회해야 하나, 현재는 간단히 캠페인 정보만 반환
    const campaign = await (await import('../../config/database')).query(
      `SELECT id, campaign_name, message_type, message_content, total_recipients,
              sent_count, success_count, fail_count, status, sent_at
       FROM flyer_campaigns
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    if (campaign.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });

    // TODO: Phase 2에서 MySQL 큐 결과 조회 연동 (CT-F01 smsSelectAll 활용)
    return res.json({
      campaign: campaign.rows[0],
      recipients: [],
      total: 0,
      note: 'MySQL 큐 결과 조회는 Phase 2에서 구현 예정',
    });
  } catch (error: any) {
    console.error('[flyer/stats] recipients error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * ★ Phase 1: GET /tracking/:flyerId — 수신자별 클릭 추적 통계
 * 응답: { totalSent, totalClicked, clickRate, clickedList, notClickedList }
 */
router.get('/tracking/:flyerId', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { flyerId } = req.params;
    const campaignId = req.query.campaignId as string | undefined;

    // 해당 회사의 전단지인지 확인
    const flyerCheck = await (await import('../../config/database')).query(
      `SELECT id FROM flyers WHERE id = $1 AND company_id = $2`,
      [flyerId, companyId]
    );
    if (flyerCheck.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다' });
    }

    const stats = await getTrackingStats(flyerId, campaignId);
    return res.json(stats);
  } catch (error: any) {
    console.error('[flyer/stats] tracking error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
