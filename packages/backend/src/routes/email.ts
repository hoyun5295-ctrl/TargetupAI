/**
 * ★ Email 채널 routes — D180 (2026-05-19)
 *
 * Endpoint:
 *   - GET    /api/email/campaigns           : 회사 admin 캠페인 목록
 *   - POST   /api/email/campaigns           : 캠페인 신설 (draft)
 *   - GET    /api/email/campaigns/:id       : 단일 캠페인 + 통계
 *   - POST   /api/email/campaigns/:id/send  : 발송 (recipients 박음)
 *   - GET    /api/email/status              : SendGrid 환경변수 박힘 상태
 *   - POST   /api/email/webhook             : SendGrid Event Webhook (open/click/bounce/unsubscribe)
 *
 * ⛔ 영구 원칙 정합
 *   - 발송 시점 안전장치 — 미래 1분+ / 즉시 confirm (frontend 박음)
 *   - Zero-Count — recipients 0건 시 발송 차단 (utils 박음)
 *   - 모델명 노출 X — UI 안내 박지 X
 */

import { Router, Request, Response, json } from 'express';
import { authenticate } from '../middlewares/auth';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';
import {
  createEmailCampaign,
  listEmailCampaigns,
  getEmailCampaign,
  sendEmailCampaign,
  recordEmailEvent,
} from '../utils/email-channel';
import { isSendGridConfigured, getSendGridFromDomain } from '../utils/sendgrid-client';

const router = Router();

// ════════════════════════════════════════════════════════════════════
// SendGrid Event Webhook (인증 미들웨어 전 — SendGrid public key 박힌 영역 검증)
// ════════════════════════════════════════════════════════════════════

router.post(
  '/webhook',
  json({ limit: '2mb' }),
  async (req: Request, res: Response) => {
    try {
      // SendGrid Event Webhook은 배열로 박음 (open/click/bounce 등 batch 박힘)
      const events = Array.isArray(req.body) ? req.body : [req.body];
      for (const ev of events) {
        if (!ev?.email || !ev?.event) continue;
        const campaignId = ev.campaign_id || ev.custom_args?.campaign_id;
        if (!campaignId) continue;
        try {
          await recordEmailEvent({
            campaignId: String(campaignId),
            email: String(ev.email),
            eventType: String(ev.event) as any,
            url: ev.url ? String(ev.url) : undefined,
            reason: ev.reason ? String(ev.reason) : undefined,
            occurredAt: ev.timestamp ? new Date(ev.timestamp * 1000) : new Date(),
          });
        } catch (innerErr: any) {
          console.warn('[Email Webhook] 이벤트 박음 실패:', innerErr?.message);
        }
      }
      return res.status(200).json({ success: true, processed: events.length });
    } catch (err: any) {
      console.error('[Email /webhook] 오류:', err);
      return res.status(500).json({ success: false, error: err?.message || 'webhook 처리 실패' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// 회사 admin endpoint (authenticate)
// ════════════════════════════════════════════════════════════════════

router.use(authenticate);

router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    return res.json({
      success: true,
      sendgrid_configured: isSendGridConfigured(),
      from_domain: getSendGridFromDomain() || null,
    });
  } catch (err: any) {
    console.error('[Email /status] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const campaigns = await listEmailCampaigns(companyId, limit);
    return res.json({ success: true, campaigns });
  } catch (err: any) {
    console.error('[Email /campaigns GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.get('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const campaign = await getEmailCampaign(companyId, req.params.id);
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    return res.json({ success: true, campaign });
  } catch (err: any) {
    console.error('[Email /campaigns/:id] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.post('/campaigns', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: 'Email 캠페인 신설은 회사 관리자만 가능합니다.' });
    }
    const cdpEnabled = await isCdpEnabledForPlan(companyId);
    if (!cdpEnabled) {
      return res.status(403).json({ success: false, error: 'Email 캠페인은 비즈니스 요금제부터 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
    }

    const { name, subject, html_body, text_body, from_name, from_email, is_ad, scheduled_at } = req.body;
    if (!name || !subject || !html_body) {
      return res.status(400).json({ success: false, error: 'name, subject, html_body는 필수입니다.' });
    }
    const campaign = await createEmailCampaign({
      companyId,
      createdBy: userId,
      name: String(name),
      subject: String(subject),
      htmlBody: String(html_body),
      textBody: text_body ? String(text_body) : undefined,
      fromName: from_name ? String(from_name) : undefined,
      fromEmail: from_email ? String(from_email) : undefined,
      isAd: !!is_ad,
      scheduledAt: scheduled_at ? new Date(scheduled_at) : undefined,
    });
    return res.json({ success: true, campaign });
  } catch (err: any) {
    console.error('[Email /campaigns POST] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '캠페인 신설 실패' });
  }
});

router.post('/campaigns/:id/send', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '발송은 회사 관리자만 가능합니다.' });
    }

    // 권한 검증 — 캠페인 소유
    const campaign = await getEmailCampaign(companyId, req.params.id);
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });

    const { recipients, immediate } = req.body;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'recipients 배열은 1건 이상이어야 합니다.' });
    }

    const result = await sendEmailCampaign({
      campaignId: req.params.id,
      recipients: recipients.map((r: any) => ({
        email: String(r.email || ''),
        name: r.name ? String(r.name) : undefined,
        substitutions: r.substitutions || undefined,
      })).filter((r: any) => r.email),
      immediate: !!immediate,
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/send] 오류:', err);
    const status = err?.message?.includes('0건') || err?.message?.includes('필수') ? 400 : 500;
    return res.status(status).json({ success: false, error: err?.message || '발송 실패' });
  }
});

export default router;
