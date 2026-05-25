/**
 * ★ Email 채널 routes — D215+ 전면 재작성 (2026-05-25)
 *
 * D215+ 정정: 옛 SendGrid 한줄로 마스터 흐름 영구 폐기 → 회사 admin SMTP relay 활용 흐름 전환.
 *
 * Endpoint:
 *   - GET    /api/email/status                   : 회사 SMTP 설정 완료 여부
 *   - GET    /api/email/smtp-config              : 회사 SMTP 설정 조회 (비밀번호 마스킹)
 *   - PUT    /api/email/smtp-config              : SMTP 설정 저장 (host/port/user/password/from)
 *   - DELETE /api/email/smtp-config              : SMTP 설정 영구 제거
 *   - POST   /api/email/smtp-test                : 테스트 발송 (회사 admin 본인 이메일)
 *   - GET    /api/email/campaigns                : 회사 admin 캠페인 목록
 *   - POST   /api/email/campaigns                : 캠페인 신설 (draft)
 *   - GET    /api/email/campaigns/:id            : 단일 캠페인 + 통계
 *   - PATCH  /api/email/campaigns/:id            : 캠페인 수정
 *   - DELETE /api/email/campaigns/:id            : 캠페인 삭제
 *   - POST   /api/email/campaigns/:id/send       : 발송 (recipients)
 *   - POST   /api/email/webhook                  : 외부 webhook (옛 호환 — 향후 자체 트래킹 영역 확장)
 *
 * ⛔ 영구 원칙
 *   - 발송 시점 안전장치 — 미래 1분+ / 즉시 confirm
 *   - Zero-Count — recipients 0건 시 발송 차단
 *   - 모델명 노출 X
 *   - 비밀번호 평문 응답 절대 X (마스킹 의무)
 *   - DB ALTER 503 분기 (db_alter_safety_net 룰)
 */

import { Router, Request, Response, json } from 'express';
import { authenticate } from '../middlewares/auth';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';
import {
  createEmailCampaign,
  listEmailCampaigns,
  getEmailCampaign,
  updateEmailCampaign,
  deleteEmailCampaign,
  sendEmailCampaign,
  recordEmailEvent,
} from '../utils/email-channel';
import {
  saveSmtpConfig,
  getSmtpConfigPublic,
  clearSmtpConfig,
  sendTestEmail,
  isSmtpConfigured,
} from '../utils/company-smtp-client';

const router = Router();

// ════════════════════════════════════════════════════════════════════
// DB ALTER 503 분기 공통 헬퍼 (db_alter_safety_net 룰)
// ════════════════════════════════════════════════════════════════════

function handleDbMigrationError(err: any, res: Response, tableName: string): boolean {
  const msg = err?.message || '';
  if (msg.includes('column') && msg.includes('does not exist')) {
    res.status(503).json({
      success: false,
      error: `DB 마이그레이션 필요 — 운영자에게 ${tableName} ALTER 실행 요청 의무`,
      code: 'DB_MIGRATION_PENDING',
    });
    return true;
  }
  return false;
}

function handleEncryptionKeyError(err: any, res: Response): boolean {
  const msg = err?.message || '';
  if (msg.includes('SMTP_ENCRYPTION_KEY 미설정')) {
    res.status(503).json({
      success: false,
      error: 'SMTP 암호화 키 미설정 — 운영자에게 .env SMTP_ENCRYPTION_KEY 등록 요청 의무',
      code: 'SMTP_ENCRYPTION_KEY_MISSING',
    });
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════
// 외부 Webhook (인증 X — 향후 자체 픽셀/링크 트래킹 또는 외부 SMTP relay webhook 통합 영역)
//   D215+ 정정: 옛 SendGrid 특화 흐름 영구 폐기 → 일반 webhook 흐름 (recordEmailEvent 보존)
// ════════════════════════════════════════════════════════════════════

router.post(
  '/webhook',
  json({ limit: '2mb' }),
  async (req: Request, res: Response) => {
    try {
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
          console.warn('[Email Webhook] 이벤트 기록 실패:', innerErr?.message);
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

// ─────────────────────────────────────────────────────────────────────
// 공통 헬퍼 — 회사 admin 권한 + BUSINESS+ 게이팅
// ─────────────────────────────────────────────────────────────────────

async function ensureEmailAdmin(req: Request, res: Response): Promise<{ companyId: string; userId: string } | null> {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  const userType = req.user?.userType;
  if (!companyId || !userId) {
    res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    return null;
  }
  if (userType !== 'company_admin') {
    res.status(403).json({ success: false, error: '회사 관리자 권한이 필요합니다.' });
    return null;
  }
  const cdpEnabled = await isCdpEnabledForPlan(companyId);
  if (!cdpEnabled) {
    res.status(403).json({ success: false, error: 'Email 캠페인은 비즈니스 요금제부터 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
    return null;
  }
  return { companyId, userId };
}

// ─────────────────────────────────────────────────────────────────────
// SMTP 설정 (회사 admin 본인 정보 등록 / 조회 / 삭제 / 테스트 발송)
// ─────────────────────────────────────────────────────────────────────

router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const configured = await isSmtpConfigured(companyId);
    return res.json({ success: true, smtp_configured: configured });
  } catch (err: any) {
    console.error('[Email /status] 오류:', err);
    if (handleDbMigrationError(err, res, 'companies')) return;
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.get('/smtp-config', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const config = await getSmtpConfigPublic(auth.companyId);
    return res.json({ success: true, config });
  } catch (err: any) {
    console.error('[Email /smtp-config GET] 오류:', err);
    if (handleDbMigrationError(err, res, 'companies')) return;
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.put('/smtp-config', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const { host, port, user, password, secure, from_email, from_name } = req.body;
    if (!host || !port || !user || !password || !from_email) {
      return res.status(400).json({ success: false, error: 'host / port / user / password / from_email 필수' });
    }
    await saveSmtpConfig(auth.companyId, {
      host: String(host),
      port: Number(port),
      user: String(user),
      password: String(password),
      secure: Boolean(secure),
      fromEmail: String(from_email),
      fromName: from_name ? String(from_name) : null,
    });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Email /smtp-config PUT] 오류:', err);
    if (handleDbMigrationError(err, res, 'companies')) return;
    if (handleEncryptionKeyError(err, res)) return;
    return res.status(500).json({ success: false, error: err?.message || 'SMTP 설정 저장 실패' });
  }
});

router.delete('/smtp-config', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    await clearSmtpConfig(auth.companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Email /smtp-config DELETE] 오류:', err);
    if (handleDbMigrationError(err, res, 'companies')) return;
    return res.status(500).json({ success: false, error: err?.message || 'SMTP 설정 삭제 실패' });
  }
});

router.post('/smtp-test', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const { to_email } = req.body;
    if (!to_email) {
      return res.status(400).json({ success: false, error: 'to_email 필수 (테스트 발송 수신 이메일)' });
    }
    const result = await sendTestEmail(auth.companyId, String(to_email));
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[Email /smtp-test] 오류:', err);
    if (handleDbMigrationError(err, res, 'companies')) return;
    if (handleEncryptionKeyError(err, res)) return;
    return res.status(500).json({ success: false, error: err?.message || '테스트 발송 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 캠페인 CRUD
// ─────────────────────────────────────────────────────────────────────

router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const campaigns = await listEmailCampaigns(companyId, limit);
    return res.json({ success: true, campaigns });
  } catch (err: any) {
    console.error('[Email /campaigns GET] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
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
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.post('/campaigns', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const { name, subject, html_body, text_body, from_name, from_email, is_ad, scheduled_at } = req.body;
    if (!name || !subject || !html_body) {
      return res.status(400).json({ success: false, error: 'name, subject, html_body는 필수입니다.' });
    }
    const campaign = await createEmailCampaign({
      companyId: auth.companyId,
      createdBy: auth.userId,
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
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || '캠페인 신설 실패' });
  }
});

router.patch('/campaigns/:id', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const patch: any = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name);
    if (req.body.subject !== undefined) patch.subject = String(req.body.subject);
    if (req.body.html_body !== undefined) patch.htmlBody = String(req.body.html_body);
    if (req.body.text_body !== undefined) patch.textBody = req.body.text_body ? String(req.body.text_body) : null;
    if (req.body.from_name !== undefined) patch.fromName = req.body.from_name ? String(req.body.from_name) : null;
    if (req.body.from_email !== undefined) patch.fromEmail = req.body.from_email ? String(req.body.from_email) : null;
    if (req.body.is_ad !== undefined) patch.isAd = !!req.body.is_ad;
    if (req.body.scheduled_at !== undefined) patch.scheduledAt = req.body.scheduled_at ? new Date(req.body.scheduled_at) : null;

    const updated = await updateEmailCampaign(auth.companyId, req.params.id, patch);
    if (!updated) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    return res.json({ success: true, campaign: updated });
  } catch (err: any) {
    console.error('[Email /campaigns PATCH] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || '캠페인 수정 실패' });
  }
});

router.delete('/campaigns/:id', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const ok = await deleteEmailCampaign(auth.companyId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Email /campaigns DELETE] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || '캠페인 삭제 실패' });
  }
});

router.post('/campaigns/:id/send', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const campaign = await getEmailCampaign(auth.companyId, req.params.id);
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
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (handleEncryptionKeyError(err, res)) return;
    const status = err?.message?.includes('0건') || err?.message?.includes('필수') || err?.message?.includes('미완료') ? 400 : 500;
    return res.status(status).json({ success: false, error: err?.message || '발송 실패' });
  }
});

export default router;
