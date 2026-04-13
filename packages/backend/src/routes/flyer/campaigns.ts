/**
 * ★ 전단AI 발송 라우트
 * 마운트: /api/flyer/campaigns
 *
 * 한줄로 campaigns.ts 5경로 → 전단AI 1경로 (CT-F08 sendFlyerCampaign)
 * 모든 발송 로직은 CT-F08에 통합. 라우트는 입력 검증 + CT 호출 only.
 */

import { Request, Response, Router } from 'express';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
import {
  sendFlyerCampaign,
  FlyerSendParams,
} from '../../utils/flyer';
import {
  getAutoPurgeSettings,
  updateAutoPurgeSettings,
  setCampaignAutoPurge,
} from '../../utils/flyer/config/flyer-settings';

const router = Router();
router.use(flyerAuthenticate);

/**
 * POST /send — 즉시 발송 (전단AI 유일한 발송 엔드포인트)
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { companyId, userId } = req.flyerUser!;
    const {
      message_type, message_content, is_ad,
      callback_number, mms_image_paths, subject,
      recipients, flyer_id, short_url_id,
    } = req.body;

    if (!message_content) return res.status(400).json({ error: '메시지 내용이 필요합니다' });
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: '수신자가 없습니다' });
    }

    const params: FlyerSendParams = {
      companyId,
      userId,
      messageType: message_type || 'SMS',
      messageTemplate: message_content,
      isAd: is_ad !== false,
      requestedCallback: callback_number,
      mmsImagePaths: mms_image_paths,
      subject,
      recipients,
      flyerId: flyer_id,
      shortUrlId: short_url_id,
    };

    const result = await sendFlyerCampaign(params);

    if (!result.ok) {
      return res.status(400).json({
        error: result.error,
        ...result,
      });
    }

    return res.json(result);
  } catch (error: any) {
    console.error('[flyer/campaigns] send error:', error);
    return res.status(500).json({ error: 'Server error', detail: error?.message });
  }
});

// ============================================================
// POST /:id/auto-purge — 캠페인별 자동 파기 설정 (CT: config/flyer-settings)
// ============================================================
router.post('/:id/auto-purge', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { purge_days } = req.body;
    if (purge_days != null && (purge_days < 0 || purge_days > 365)) {
      return res.status(400).json({ error: '파기 기간은 0~365일 사이여야 합니다.' });
    }
    await setCampaignAutoPurge(req.params.id, companyId, purge_days || 0);
    return res.json({ ok: true, purge_days: purge_days || 0 });
  } catch (error: any) {
    console.error('[flyer/campaigns] auto-purge error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// GET/POST /purge-settings — 회사 전체 자동 파기 설정 (CT: config/flyer-settings)
// ============================================================
router.get('/purge-settings', async (req: Request, res: Response) => {
  try {
    const result = await getAutoPurgeSettings(req.flyerUser!.companyId);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/purge-settings', async (req: Request, res: Response) => {
  try {
    await updateAutoPurgeSettings(req.flyerUser!.companyId, req.body.auto_purge_days || 0);
    return res.json({ ok: true, auto_purge_days: req.body.auto_purge_days || 0 });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
