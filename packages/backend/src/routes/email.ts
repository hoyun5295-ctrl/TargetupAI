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
// ★ D225+ (2026-05-28): Email 캠페인 events 이력 조회 endpoint 신설 — email_events 직접 SELECT
import { query } from '../config/database';
import {
  createEmailCampaign,
  listEmailCampaigns,
  getEmailCampaign,
  updateEmailCampaign,
  deleteEmailCampaign,
  sendEmailCampaign,
  recordEmailEvent,
  resolveCustomerRecipients,
  resolveCustomerRecipientsByFilter,
  previewCustomerRecipients,
  listCustomerGrades,
  scheduleCampaign,
  getCampaignPerformanceStats,
  getCompanyOpenHourDistribution,
  getCampaignNonOpeners,
  getCampaignResendRecipients,
  countResendChildren,
  createResendChildCampaign,
  listEmailPersonalizationVars,
  type EmailRecipient,
  type EmailTargetSpec,
} from '../utils/email-channel';
import {
  saveSmtpConfig,
  getSmtpConfigPublic,
  clearSmtpConfig,
  sendTestEmail,
  isSmtpConfigured,
} from '../utils/company-smtp-client';
import {
  verifyTrackingToken,
  TRACKING_PIXEL_GIF,
} from '../utils/email-tracking';
import {
  generateEmailOneShot,
  generateEmailSections,
  refineEmail,
  refineEmailSections,
  analyzeSpamRisk,
  runEmailCodeChecks,
  buildPerformanceInsight,
  buildEmailAccountInsight,
  recommendSendTime,
  binOpenHours,
  findUneditedPlaceholder,
  SEND_TIME_MIN_SAMPLE,
  EMAIL_SCENARIO_PRESETS,
  type EmailScenarioKey,
} from '../utils/email-ai';
// 비주얼 빌더: DM Section[] → 이메일 안전 HTML 렌더 + 회사 브랜드킷
import { renderEmailSections, extractEmailText } from '../utils/email/email-section-renderer';
import { resolveEmailSectionsForCustomer } from '../utils/email/email-personalization';
import { rate, relativeDelta, pointDelta } from '../utils/email/email-analytics-calc';
import { buildPreviewCustomers } from '../utils/inapp-personalization';
import { getCompanyBrandKit } from '../utils/dm/dm-brand-kit';
import { normalizeEventText } from '../utils/event-brief';
import { industryLabel } from '../utils/industry-codes';
import type { Section } from '../utils/dm/dm-section-registry';
import { checkCredit, deductCreditSafe, InsufficientCreditError } from '../utils/ai-credit';
import { getCreditCost } from '../utils/ai-credit-calc';

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

/** 수신거부 공개 페이지 HTML — 이 라우트 전용 표현 헬퍼 (다크 톤 + violet 액센트). */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function renderUnsubPage(mode: 'confirm' | 'done' | 'invalid' | 'error', token: string, email?: string): string {
  const safeEmail = email ? escapeHtml(email) : '';
  const safeToken = escapeHtml(token);
  let inner = '';
  if (mode === 'confirm') {
    inner = `
      <h1>수신거부</h1>
      <p>아래 주소로 더 이상 마케팅 이메일을 받지 않으시려면 수신거부를 눌러주세요.</p>
      <div class="email">${safeEmail}</div>
      <form method="POST" action="/api/email/u/${safeToken}">
        <button type="submit" class="btn">수신거부 처리</button>
      </form>`;
  } else if (mode === 'done') {
    inner = `
      <h1>수신거부 완료</h1>
      <p><span class="email">${safeEmail}</span> 주소의 마케팅 이메일 수신이 중지되었습니다.</p>
      <p class="muted">처리에 시간이 걸려 이미 발송 중인 메일은 도착할 수 있습니다.</p>`;
  } else if (mode === 'invalid') {
    inner = `
      <h1>유효하지 않은 링크</h1>
      <p class="muted">링크가 만료되었거나 올바르지 않습니다. 메일의 수신거부 링크를 다시 눌러주세요.</p>`;
  } else {
    inner = `
      <h1>처리 중 오류</h1>
      <p class="muted">잠시 후 다시 시도해주세요.</p>`;
  }
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>수신거부</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    background:#0f172a;color:#e2e8f0;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
  .card{width:100%;max-width:420px;background:#1e293b;border:1px solid rgba(255,255,255,.1);
    border-radius:18px;padding:32px;box-shadow:0 20px 50px rgba(0,0,0,.4);text-align:center}
  h1{font-size:20px;margin:0 0 12px;color:#fff}
  p{font-size:14px;line-height:1.6;color:#cbd5e1;margin:8px 0}
  .muted{color:#94a3b8;font-size:13px}
  .email{display:inline-block;margin:14px 0;padding:8px 14px;border-radius:10px;
    background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.35);color:#c4b5fd;font-weight:600;word-break:break-all}
  .btn{margin-top:18px;width:100%;padding:12px;border:0;border-radius:12px;cursor:pointer;
    background:linear-gradient(90deg,#8b5cf6,#d946ef);color:#fff;font-size:14px;font-weight:700}
  .btn:hover{opacity:.92}
</style></head>
<body><div class="card">${inner}</div></body></html>`;
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
// 자체 트래킹 공개 endpoint (인증 X — 수신자가 메일에서 직접 호출)
//   오픈 픽셀 / 클릭 리다이렉트 / 개인 토큰 수신거부. 토큰 검증 실패 = 이벤트 기록 X.
// ════════════════════════════════════════════════════════════════════

// 오픈 픽셀 — 항상 1x1 GIF 응답 (토큰 무효여도 깨진 이미지 노출 X)
router.get('/t/o/:token', async (req: Request, res: Response) => {
  try {
    const payload = verifyTrackingToken(req.params.token);
    if (payload) {
      await recordEmailEvent({
        campaignId: payload.c,
        email: payload.e,
        eventType: 'open',
        occurredAt: new Date(),
      }).catch((e: any) => console.warn('[Email /t/o] 오픈 기록 실패:', e?.message));
    }
  } catch (e: any) {
    console.warn('[Email /t/o] 오류:', e?.message);
  }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  return res.status(200).send(TRACKING_PIXEL_GIF);
});

// 클릭 리다이렉트 — 토큰 안 서명된 원본 URL로만 302 (open redirect 차단)
router.get('/t/c/:token', async (req: Request, res: Response) => {
  const payload = verifyTrackingToken(req.params.token);
  if (!payload || !payload.u || !/^https?:\/\//i.test(payload.u)) {
    return res.status(400).send('유효하지 않은 링크입니다.');
  }
  try {
    await recordEmailEvent({
      campaignId: payload.c,
      email: payload.e,
      eventType: 'click',
      url: payload.u,
      occurredAt: new Date(),
    }).catch((e: any) => console.warn('[Email /t/c] 클릭 기록 실패:', e?.message));
  } catch (e: any) {
    console.warn('[Email /t/c] 오류:', e?.message);
  }
  return res.redirect(302, payload.u);
});

// 수신거부 확인 페이지 (GET) + 처리 (POST) — 다크 톤 단일 HTML
router.get('/u/:token', (req: Request, res: Response) => {
  const payload = verifyTrackingToken(req.params.token);
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (!payload) {
    return res.status(400).send(renderUnsubPage('invalid', req.params.token));
  }
  return res.status(200).send(renderUnsubPage('confirm', req.params.token, payload.e));
});

router.post('/u/:token', async (req: Request, res: Response) => {
  const payload = verifyTrackingToken(req.params.token);
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (!payload) return res.status(400).send(renderUnsubPage('invalid', req.params.token));
  try {
    await recordEmailEvent({
      campaignId: payload.c,
      email: payload.e,
      eventType: 'unsubscribe',
      occurredAt: new Date(),
    });
    return res.status(200).send(renderUnsubPage('done', req.params.token, payload.e));
  } catch (e: any) {
    console.error('[Email /u POST] 오류:', e?.message);
    return res.status(500).send(renderUnsubPage('error', req.params.token, payload.e));
  }
});

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
    res.status(403).json({ success: false, error: 'Email 캠페인은 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
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

// ★ 2026-07-02 캠페인 완성 여부 — 크레딧 거래 멱등키 존재로 판정 (DB ALTER 0).
//   신 키 email-campaign-complete:ID + 구 키 email-ai-publish:ID(과거 발송 확정 시 50 납부분) 모두 인정 = 이중과금 0.
async function isEmailCampaignCompleted(companyId: string, campaignId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM ai_credit_transactions
     WHERE company_id = $1::uuid AND idempotency_key = ANY($2)
     LIMIT 1`,
    [companyId, [`email-campaign-complete:${campaignId}`, `email-ai-publish:${campaignId}`]],
  );
  return r.rows.length > 0;
}

// ★ 2026-07-02 개인화 변수 목록 — 하드코딩 금지(Harold 지시). CT-58 실측 프로필에서 데이터 있는(70%+) 필드만.
router.get('/personalization-vars', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const vars = await listEmailPersonalizationVars(companyId);
    return res.json({ success: true, vars });
  } catch (err: any) {
    console.error('[Email personalization-vars] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const campaigns = await listEmailCampaigns(companyId, limit);
    // ★ 2026-07-02 완성 여부 플래그 — 프론트 발송/PC 미리보기 잠금 판단용 (신·구 멱등키 인정)
    try {
      const keysRes = await query(
        `SELECT idempotency_key FROM ai_credit_transactions
         WHERE company_id = $1::uuid
           AND (idempotency_key LIKE 'email-campaign-complete:%' OR idempotency_key LIKE 'email-ai-publish:%')`,
        [companyId],
      );
      const paidIds = new Set<string>(
        keysRes.rows.map((r: any) => String(r.idempotency_key || '').split(':')[1]).filter(Boolean),
      );
      for (const c of campaigns as any[]) {
        c.completed = paidIds.has(String(c.id));
      }
    } catch (flagErr: any) {
      console.log('[Email campaigns GET] completed 플래그 계산 오류 — 플래그 없이 반환:', flagErr?.message);
    }
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

// ★ 2026-07-02 캠페인 완성 (Harold 확정 크레딧 모델)
//   완성 = 50크레딧 캠페인당 1회(멱등) — AI/수동/템플릿 불문. 완성 후 수정·재저장·발송·이력 전부 추가 차감 0.
//   임시저장(draft)은 무료·무제한이되 발송/PC 미리보기가 잠기고, 이 endpoint가 해금한다. 환불 없음.
router.post('/campaigns/:id/complete', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const campaign = await getEmailCampaign(auth.companyId, req.params.id);
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });

    if (await isEmailCampaignCompleted(auth.companyId, campaign.id)) {
      return res.json({ success: true, completed: true, alreadyCompleted: true });
    }

    const cost = getCreditCost('email-campaign-complete'); // 50
    await checkCredit(auth.companyId, cost);
    await deductCreditSafe({
      companyId: auth.companyId, cost, source: 'email-campaign-complete',
      createdBy: auth.userId, idempotencyKey: `email-campaign-complete:${campaign.id}`,
    });
    return res.json({ success: true, completed: true, alreadyCompleted: false, cost });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/complete] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || '완성 처리 실패' });
  }
});

router.post('/campaigns', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const { name, subject, html_body, text_body, from_name, from_email, is_ad, scheduled_at, ai_generated, sections } = req.body;
    if (!name || !subject) {
      return res.status(400).json({ success: false, error: 'name, subject는 필수입니다.' });
    }
    // 비주얼 빌더: sections 있으면 이메일 HTML 렌더 → html_body (없으면 클라이언트 html_body 직접 흐름 보존)
    let finalHtml = html_body ? String(html_body) : '';
    let finalText = text_body ? String(text_body) : undefined;
    let finalSections: unknown[] | null = null;
    if (Array.isArray(sections) && sections.length > 0) {
      const brandKit = await getCompanyBrandKit(auth.companyId);
      finalHtml = renderEmailSections(sections as Section[], { brandKit, publicBase: process.env.PUBLIC_BASE_URL });
      finalText = extractEmailText(sections as Section[]);
      finalSections = sections;
    }
    if (!finalHtml) {
      return res.status(400).json({ success: false, error: 'html_body 또는 sections는 필수입니다.' });
    }
    const campaign = await createEmailCampaign({
      companyId: auth.companyId,
      createdBy: auth.userId,
      name: String(name),
      subject: String(subject),
      htmlBody: finalHtml,
      textBody: finalText,
      fromName: from_name ? String(from_name) : undefined,
      fromEmail: from_email ? String(from_email) : undefined,
      isAd: !!is_ad,
      aiGenerated: !!ai_generated,
      sections: finalSections,
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
    // 비주얼 빌더: sections 수정 시 html_body·text_body 재렌더
    if (Array.isArray(req.body.sections)) {
      patch.sections = req.body.sections;
      if (req.body.sections.length > 0) {
        const brandKit = await getCompanyBrandKit(auth.companyId);
        patch.htmlBody = renderEmailSections(req.body.sections as Section[], { brandKit, publicBase: process.env.PUBLIC_BASE_URL });
        patch.textBody = extractEmailText(req.body.sections as Section[]);
      }
    }

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

    // 이중 발송 가드 — 이미 발송 중이면 차단
    if (campaign.status === 'sending') {
      return res.status(409).json({ success: false, error: '이미 발송이 진행 중입니다.' });
    }

    // placeholder 잔존(미입력 자리) = 발송 차단 (AI 임의 혜택 영구 룰). 위치·샘플을 함께 안내해 즉시 수정 가능하게.
    const ph = findUneditedPlaceholder(campaign.subject, campaign.htmlBody, campaign.textBody);
    if (ph) {
      return res.status(400).json({
        success: false,
        error: `${ph.where}에 직접 입력이 필요한 자리 "${ph.sample}"가 남아 있습니다. 편집에서 그 자리를 채운 뒤 발송해주세요.`,
        code: 'UNEDITED_PLACEHOLDER',
      });
    }

    const { recipients, target, mode, scheduled_at } = req.body;
    const sendMode: 'immediate' | 'scheduled' = mode === 'scheduled' ? 'scheduled' : 'immediate';

    // 수신자 명세 해석 — 명시 recipients(직접 입력) 또는 target(고객DB)
    let resolved: EmailRecipient[] = [];
    let targetSpec: EmailTargetSpec | null = null;
    if (Array.isArray(recipients) && recipients.length > 0) {
      resolved = recipients
        .map((r: any) => ({
          email: String(r.email || '').trim(),
          name: r.name ? String(r.name) : undefined,
          substitutions: r.substitutions || undefined,
        }))
        .filter((r: EmailRecipient) => r.email.includes('@'));
      targetSpec = { type: 'list', recipients: resolved.map((r) => ({ email: r.email, name: r.name })) };
    } else if (target && target.type === 'customers') {
      const grades = Array.isArray(target.grades) ? target.grades.map((g: any) => String(g)) : undefined;
      targetSpec = { type: 'customers', grades };
      resolved = await resolveCustomerRecipients(auth.companyId, grades);
    } else if (target && target.type === 'filter' && target.filter && typeof target.filter === 'object') {
      // 타겟 추출(/api/targets/extract)로 확정한 filter → 이메일 발송 대상 결합.
      // ★ 2026-07-02(3) 빈 filter {} = "전체 고객"(isAll) — 조건 없음 = 이메일 자격자 전체 (명시적 type:'filter' 확정분만 도달)
      targetSpec = { type: 'filter', filter: target.filter };
      resolved = await resolveCustomerRecipientsByFilter(auth.companyId, target.filter);
    } else {
      return res.status(400).json({ success: false, error: '발송 대상을 지정해주세요 (recipients 또는 target).' });
    }

    // Zero-Count 영구 원칙
    if (resolved.length === 0) {
      return res.status(400).json({ success: false, error: '발송 대상이 0건입니다. 조건을 조정해주세요.', code: 'ZERO_COUNT' });
    }

    // ★ 2026-07-02 Harold 확정 — 발송 시 크레딧 차감 제거(발송 = 무료, 고객 SMTP).
    //   대신 완성(50크레딧, /complete) 안 된 캠페인은 발송 차단. 예약 취소/삭제 크레딧 소멸 구멍도 구조상 소멸.
    if (!(await isEmailCampaignCompleted(auth.companyId, campaign.id))) {
      return res.status(400).json({
        success: false,
        error: '완성 저장(50크레딧) 후 발송할 수 있습니다. 편집기에서 [완성 저장]을 눌러주세요.',
        code: 'CAMPAIGN_NOT_COMPLETED',
      });
    }

    // 예약 발송 — target_spec 저장 + status='scheduled'. sweeper가 도래 시 발송.
    if (sendMode === 'scheduled') {
      const when = scheduled_at ? new Date(scheduled_at) : null;
      if (!when || isNaN(when.getTime()) || when.getTime() < Date.now() + 60 * 1000) {
        return res.status(400).json({ success: false, error: '예약 시각은 현재보다 1분 이상 이후여야 합니다.' });
      }
      const updated = await scheduleCampaign(auth.companyId, campaign.id, targetSpec, when);
      return res.json({ success: true, scheduled: true, total: resolved.length, scheduledAt: updated?.scheduledAt });
    }

    // 즉시 발송 — status='sending' 선점 후 응답, 실제 SMTP 루프는 백그라운드(타임아웃 차단)
    await query(
      `UPDATE email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
      [campaign.id, auth.companyId],
    );
    setImmediate(() => {
      sendEmailCampaign({ campaignId: campaign.id, recipients: resolved, immediate: true })
        .catch((e: any) => console.error(`[Email /send] 백그라운드 발송 실패 (campaign ${campaign.id}):`, e?.message));
    });
    return res.json({ success: true, queued: true, total: resolved.length });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/send] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (handleEncryptionKeyError(err, res)) return;
    const status = err?.message?.includes('0건') || err?.message?.includes('필수') || err?.message?.includes('미완료') ? 400 : 500;
    return res.status(status).json({ success: false, error: err?.message || '발송 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D225+ (2026-05-28 Harold 명시): Email 캠페인 발송 이력 조회 endpoint 신설
//   - GET /api/email/campaigns/:id/events — 수신자별 매트릭스 (delivered/open/click/bounce/unsubscribe)
//   - 옛 흐름 = email_events 테이블 누적 + 조회 endpoint X 사고 = 사용자 이력 확인 불가
//   - Harold 기대 = 캠페인 카드 안 [이력 보기] → 모달 안 수신자별 매트릭스 + 이벤트 목록 표시
// ════════════════════════════════════════════════════════════════════
router.get('/campaigns/:id/events', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const campaignId = req.params.id;
    const limit = Math.min(parseInt(String(req.query.limit || '100')) || 100, 500);
    const offset = Math.max(parseInt(String(req.query.offset || '0')) || 0, 0);
    const eventType = req.query.event_type ? String(req.query.event_type) : null;

    // 캠페인 권한 검증 (회사 격리)
    const campaign = await getEmailCampaign(companyId, campaignId);
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });

    // 1. 수신자별 매트릭스 — email 안 events 영역 GROUP
    const recipientResult = await query(
      `SELECT email,
              MIN(CASE WHEN event_type IN ('delivered','processed','sent') THEN occurred_at END) AS delivered_at,
              MIN(CASE WHEN event_type = 'open' THEN occurred_at END) AS opened_at,
              MIN(CASE WHEN event_type = 'click' THEN occurred_at END) AS clicked_at,
              MIN(CASE WHEN event_type IN ('bounce','dropped','spamreport') THEN occurred_at END) AS bounced_at,
              MIN(CASE WHEN event_type = 'unsubscribe' THEN occurred_at END) AS unsubscribed_at,
              COUNT(*) FILTER (WHERE event_type = 'click') AS click_count,
              COUNT(*) FILTER (WHERE event_type = 'open') AS open_count,
              MAX(occurred_at) AS last_event_at
       FROM email_events
       WHERE campaign_id = $1::uuid
       GROUP BY email
       ORDER BY MAX(occurred_at) DESC
       LIMIT $2 OFFSET $3`,
      [campaignId, limit, offset],
    );

    const recipientTotalResult = await query(
      `SELECT COUNT(DISTINCT email)::int AS total FROM email_events WHERE campaign_id = $1::uuid`,
      [campaignId],
    );

    // 2. raw events 목록 — 옵션 (event_type 필터)
    let eventsWhere = 'campaign_id = $1::uuid';
    const eventsParams: any[] = [campaignId];
    if (eventType) {
      eventsWhere += ' AND event_type = $2';
      eventsParams.push(eventType);
    }
    const eventsResult = await query(
      `SELECT id, email, event_type, url, reason, occurred_at
       FROM email_events
       WHERE ${eventsWhere}
       ORDER BY occurred_at DESC
       LIMIT $${eventsParams.length + 1} OFFSET $${eventsParams.length + 2}`,
      [...eventsParams, limit, offset],
    );

    return res.json({
      success: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        subject: campaign.subject,
        sentCount: campaign.sentCount,
        openCount: campaign.openCount,
        clickCount: campaign.clickCount,
        bounceCount: campaign.bounceCount,
        unsubscribeCount: campaign.unsubscribeCount,
        sentAt: campaign.sentAt,
      },
      recipients: recipientResult.rows.map((r: any) => ({
        email: r.email,
        deliveredAt: r.delivered_at,
        openedAt: r.opened_at,
        clickedAt: r.clicked_at,
        bouncedAt: r.bounced_at,
        unsubscribedAt: r.unsubscribed_at,
        openCount: Number(r.open_count) || 0,
        clickCount: Number(r.click_count) || 0,
        lastEventAt: r.last_event_at,
      })),
      recipients_total: recipientTotalResult.rows[0]?.total || 0,
      events: eventsResult.rows.map((e: any) => ({
        id: e.id,
        email: e.email,
        eventType: e.event_type,
        url: e.url,
        reason: e.reason,
        occurredAt: e.occurred_at,
      })),
      pagination: { limit, offset },
    });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/events] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_events')) return;
    return res.status(500).json({ success: false, error: err?.message || '이력 조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 수신자 — 고객DB 연동 (RecipientsModal 고객DB 탭)
// ════════════════════════════════════════════════════════════════════

router.get('/recipients/grades', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const grades = await listCustomerGrades(companyId);
    return res.json({ success: true, grades });
  } catch (err: any) {
    console.error('[Email /recipients/grades] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '등급 조회 실패' });
  }
});

router.post('/recipients/preview', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const grades = Array.isArray(req.body?.grades) ? req.body.grades.map((g: any) => String(g)) : undefined;
    const preview = await previewCustomerRecipients(companyId, grades);
    return res.json({ success: true, ...preview });
  } catch (err: any) {
    console.error('[Email /recipients/preview] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '대상 미리보기 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// AI — 원샷 생성(3) / 다듬기(1) / 발송 전 진단(1) / 발송 후 성과(5) / 발송 시간(5)
//   차감 = checkCredit → 작업 성공 → deductCreditSafe (실패 시 차감 0). 내부 callAIWithFallback은 creditCost:0.
// ════════════════════════════════════════════════════════════════════

router.get('/ai/scenarios', async (_req: Request, res: Response) => {
  const scenarios = Object.entries(EMAIL_SCENARIO_PRESETS).map(([key, v]) => ({ key, label: v.label }));
  return res.json({ success: true, scenarios });
});

router.post('/ai/generate', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const prompt = req.body?.prompt ? String(req.body.prompt).trim() : '';
    const scenario = req.body?.scenario ? String(req.body.scenario) as EmailScenarioKey : undefined;
    const isAd = !!req.body?.is_ad;
    if (!prompt && !scenario) {
      return res.status(400).json({ success: false, error: '요청 내용 또는 시나리오를 입력해주세요.' });
    }
    if (prompt.length > 2000) {
      return res.status(400).json({ success: false, error: '요청은 2000자 이내로 입력해주세요.' });
    }
    if (scenario && !EMAIL_SCENARIO_PRESETS[scenario]) {
      return res.status(400).json({ success: false, error: '알 수 없는 시나리오입니다.' });
    }

    const cost = getCreditCost('email-ai-generate'); // 3
    await checkCredit(auth.companyId, cost);
    const result = await generateEmailOneShot({ companyId: auth.companyId, userId: auth.userId, prompt, scenario, isAd });
    await deductCreditSafe({ companyId: auth.companyId, cost, source: 'email-ai-generate', createdBy: auth.userId });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[Email /ai/generate] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    return res.status(500).json({ success: false, error: err?.message || 'AI 생성 실패' });
  }
});

// 비주얼 빌더 — AI가 이메일 블록 Section[]을 생성(이미지·혜택은 빈 자리). 크레딧 3.
router.post('/ai/generate-sections', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const prompt = req.body?.prompt ? String(req.body.prompt).trim() : '';
    const scenario = req.body?.scenario ? String(req.body.scenario) as EmailScenarioKey : undefined;
    const isAd = !!req.body?.is_ad;
    // ★ 2026-07-07(4) 행사 캠페인 — 행사 원문 단독 입력도 생성 가능 (기재 혜택만 원문 그대로)
    const eventText = req.body?.event_text ? normalizeEventText(req.body.event_text) : '';
    if (!prompt && !scenario && !eventText) {
      return res.status(400).json({ success: false, error: '요청 내용 또는 시나리오를 입력해주세요.' });
    }
    if (prompt.length > 2000) {
      return res.status(400).json({ success: false, error: '요청은 2000자 이내로 입력해주세요.' });
    }
    if (scenario && !EMAIL_SCENARIO_PRESETS[scenario]) {
      return res.status(400).json({ success: false, error: '알 수 없는 시나리오입니다.' });
    }
    const cost = getCreditCost('email-ai-generate'); // 3
    await checkCredit(auth.companyId, cost);
    const result = await generateEmailSections({ companyId: auth.companyId, userId: auth.userId, prompt, scenario, isAd, eventText });
    await deductCreditSafe({ companyId: auth.companyId, cost, source: 'email-ai-generate', createdBy: auth.userId });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[Email /ai/generate-sections] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    return res.status(500).json({ success: false, error: err?.message || 'AI 비주얼 생성 실패' });
  }
});

// 비주얼 에디터 실시간 미리보기 — sections → 이메일 HTML (크레딧·저장 없음).
router.post('/render-preview', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const brandKit = await getCompanyBrandKit(auth.companyId);
    // 샘플 고객 동봉 시 수신자별 개인화(변수 치환 + 조건부 표시) 후 렌더 — 미리보기 전용(발송·저장 무관).
    const sampleCustomer = req.body?.sampleCustomer && typeof req.body.sampleCustomer === 'object' ? req.body.sampleCustomer : null;
    const renderSections = sampleCustomer
      ? resolveEmailSectionsForCustomer(sections as Section[], sampleCustomer)
      : (sections as Section[]);
    const html = renderEmailSections(renderSections, { brandKit, publicBase: process.env.PUBLIC_BASE_URL });
    return res.json({ success: true, html });
  } catch (err: any) {
    console.error('[Email /render-preview] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '미리보기 렌더 실패' });
  }
});

// 미리보기용 샘플 고객 3건(VIP/일반/신규) — 개인화 미리보기 토글. 회사 격리(inapp CT 재사용).
router.get('/preview-customers', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const customers = await buildPreviewCustomers(auth.companyId);
    return res.json({ success: true, customers });
  } catch (err: any) {
    console.error('[Email /preview-customers] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '샘플 고객 조회 실패' });
  }
});

// 템플릿 추천용 회사 업종 신호(companies.industry_code — 기존 컬럼). 미설정/실패 시 null → 갤러리는 전체만 노출(추측 추천 0).
router.get('/brand-signal', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const r = await query('SELECT industry_code FROM companies WHERE id = $1', [auth.companyId]);
    const code = r.rows[0]?.industry_code || null;
    return res.json({ success: true, industry_code: code, industry_label: code ? industryLabel(code) : null });
  } catch (err: any) {
    console.error('[Email /brand-signal] 오류:', err);
    return res.json({ success: true, industry_code: null, industry_label: null });
  }
});

// 분석 대시보드 — 계정 성과 집계(읽기 전용·무과금·회사 격리). 신규 컬럼 0(전부 기존 컬럼).
router.get('/analytics', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const daysRaw = parseInt(String(req.query.days || '30'), 10);
    const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;

    // 현재/이전 동기간 캠페인 집계 (sent_at 기준)
    const sumRes = await query(
      `SELECT
         CASE WHEN sent_at >= NOW() - make_interval(days => $2) THEN 'current' ELSE 'previous' END AS bucket,
         COUNT(*)::int AS campaigns,
         COALESCE(SUM(sent_count),0)::int AS sent,
         COALESCE(SUM(open_count),0)::int AS opens,
         COALESCE(SUM(click_count),0)::int AS clicks,
         COALESCE(SUM(bounce_count),0)::int AS bounces,
         COALESCE(SUM(unsubscribe_count),0)::int AS unsubs
       FROM email_campaigns
       WHERE company_id = $1 AND sent_at IS NOT NULL
         AND sent_at >= NOW() - make_interval(days => $2 * 2)
       GROUP BY bucket`,
      [auth.companyId, days],
    );

    // 일자별 오픈/클릭 (events, KST)
    const evRes = await query(
      `SELECT (e.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS d,
              COUNT(*) FILTER (WHERE e.event_type = 'open')::int AS opens,
              COUNT(*) FILTER (WHERE e.event_type = 'click')::int AS clicks
         FROM email_events e
         JOIN email_campaigns c ON c.id = e.campaign_id
        WHERE c.company_id = $1 AND e.occurred_at >= NOW() - make_interval(days => $2)
        GROUP BY d ORDER BY d`,
      [auth.companyId, days],
    );
    // 일자별 발송 (campaigns.sent_at, KST)
    const sentRes = await query(
      `SELECT (sent_at AT TIME ZONE 'Asia/Seoul')::date AS d, COALESCE(SUM(sent_count),0)::int AS sent
         FROM email_campaigns
        WHERE company_id = $1 AND sent_at IS NOT NULL AND sent_at >= NOW() - make_interval(days => $2)
        GROUP BY d ORDER BY d`,
      [auth.companyId, days],
    );

    const normDate = (d: any): string => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
    const trendMap = new Map<string, { date: string; sent: number; open: number; click: number }>();
    for (const r of sentRes.rows) {
      const d = normDate(r.d);
      trendMap.set(d, { date: d, sent: Number(r.sent) || 0, open: 0, click: 0 });
    }
    for (const r of evRes.rows) {
      const d = normDate(r.d);
      const cur = trendMap.get(d) || { date: d, sent: 0, open: 0, click: 0 };
      cur.open = Number(r.opens) || 0;
      cur.click = Number(r.clicks) || 0;
      trendMap.set(d, cur);
    }
    const trend = Array.from(trendMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

    const find = (b: string): any =>
      sumRes.rows.find((r: any) => r.bucket === b) || { campaigns: 0, sent: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 };
    const mk = (x: any) => {
      const sent = Number(x.sent) || 0;
      return {
        campaigns: Number(x.campaigns) || 0,
        sent,
        open: Number(x.opens) || 0,
        click: Number(x.clicks) || 0,
        bounce: Number(x.bounces) || 0,
        unsub: Number(x.unsubs) || 0,
        openRate: rate(Number(x.opens) || 0, sent),
        clickRate: rate(Number(x.clicks) || 0, sent),
        bounceRate: rate(Number(x.bounces) || 0, sent),
        unsubRate: rate(Number(x.unsubs) || 0, sent),
      };
    };
    const current = mk(find('current'));
    const previous = mk(find('previous'));
    const deltas = {
      sent: relativeDelta(current.sent, previous.sent),
      openRate: pointDelta(current.openRate, previous.openRate),
      clickRate: pointDelta(current.clickRate, previous.clickRate),
      bounceRate: pointDelta(current.bounceRate, previous.bounceRate),
      unsubRate: pointDelta(current.unsubRate, previous.unsubRate),
    };
    return res.json({ success: true, days, summary: { current, previous, deltas }, trend });
  } catch (err: any) {
    console.error('[Email /analytics] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || '분석 조회 실패' });
  }
});

// 분석 대시보드 — AI 종합 진단(on-demand 5크레딧). 집계 실측만 근거·임의 혜택 0. 발송 데이터 0이면 무과금.
router.post('/ai/account-insight', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const daysRaw = parseInt(String(req.body?.days || '30'), 10);
    const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;

    const sumRes = await query(
      `SELECT COUNT(*)::int AS campaigns, COALESCE(SUM(sent_count),0)::int AS sent,
              COALESCE(SUM(open_count),0)::int AS opens, COALESCE(SUM(click_count),0)::int AS clicks,
              COALESCE(SUM(bounce_count),0)::int AS bounces, COALESCE(SUM(unsubscribe_count),0)::int AS unsubs
         FROM email_campaigns
        WHERE company_id = $1 AND sent_at IS NOT NULL AND sent_at >= NOW() - make_interval(days => $2)`,
      [auth.companyId, days],
    );
    const s = sumRes.rows[0] || {};
    const sent = Number(s.sent) || 0;
    if (sent <= 0) {
      return res.json({ success: true, insufficientData: true, message: `최근 ${days}일 발송 데이터가 없어 진단할 수 없습니다.` });
    }

    const prevRes = await query(
      `SELECT COALESCE(SUM(sent_count),0)::int AS sent, COALESCE(SUM(open_count),0)::int AS opens, COALESCE(SUM(click_count),0)::int AS clicks
         FROM email_campaigns
        WHERE company_id = $1 AND sent_at IS NOT NULL
          AND sent_at >= NOW() - make_interval(days => $2 * 2) AND sent_at < NOW() - make_interval(days => $2)`,
      [auth.companyId, days],
    );
    const p = prevRes.rows[0] || {};
    const prevSent = Number(p.sent) || 0;

    const bwRes = await query(
      `SELECT name, sent_count, open_count
         FROM email_campaigns
        WHERE company_id = $1 AND sent_at IS NOT NULL AND sent_at >= NOW() - make_interval(days => $2) AND sent_count > 0`,
      [auth.companyId, days],
    );
    const ranked = bwRes.rows
      .map((r: any) => ({ name: String(r.name), openRatePct: rate(Number(r.open_count) || 0, Number(r.sent_count) || 0) }))
      .sort((a, b) => b.openRatePct - a.openRatePct);

    const cost = getCreditCost('email-performance-insight'); // 5
    await checkCredit(auth.companyId, cost);
    const insight = await buildEmailAccountInsight({
      companyId: auth.companyId, userId: auth.userId, days,
      stats: {
        campaignCount: Number(s.campaigns) || 0,
        sentCount: sent,
        openRatePct: rate(Number(s.opens) || 0, sent),
        clickRatePct: rate(Number(s.clicks) || 0, sent),
        bounceRatePct: rate(Number(s.bounces) || 0, sent),
        unsubRatePct: rate(Number(s.unsubs) || 0, sent),
        prevOpenRatePct: prevSent > 0 ? rate(Number(p.opens) || 0, prevSent) : null,
        prevClickRatePct: prevSent > 0 ? rate(Number(p.clicks) || 0, prevSent) : null,
        best: ranked.length ? ranked[0] : null,
        worst: ranked.length ? ranked[ranked.length - 1] : null,
      },
    });
    await deductCreditSafe({ companyId: auth.companyId, cost, source: 'email-performance-insight', createdBy: auth.userId });
    return res.json({ success: true, insight });
  } catch (err: any) {
    console.error('[Email /ai/account-insight] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || 'AI 진단 실패' });
  }
});

router.post('/ai/refine', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const subject = String(req.body?.subject || '').trim();
    const htmlBody = String(req.body?.html_body || '').trim();
    const instruction = String(req.body?.instruction || '').trim();
    if (!subject || !htmlBody || !instruction) {
      return res.status(400).json({ success: false, error: 'subject, html_body, instruction은 필수입니다.' });
    }
    const cost = getCreditCost('email-refine'); // 1
    await checkCredit(auth.companyId, cost);
    const result = await refineEmail({ companyId: auth.companyId, userId: auth.userId, subject, htmlBody, instruction });
    await deductCreditSafe({ companyId: auth.companyId, cost, source: 'email-refine', createdBy: auth.userId });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[Email /ai/refine] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    return res.status(500).json({ success: false, error: err?.message || 'AI 다듬기 실패' });
  }
});

// 비주얼 에디터 "AI로 개선" — 블록 카피만 다듬어 Section[] 반환(사실·혜택·변수 보존). 다듬을 텍스트 0이면 무차감.
router.post('/ai/refine-sections', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const sections = Array.isArray(req.body?.sections) ? (req.body.sections as Section[]) : null;
    const instruction = req.body?.instruction ? String(req.body.instruction) : undefined;
    if (!sections || sections.length === 0) {
      return res.status(400).json({ success: false, error: '다듬을 블록이 없습니다.' });
    }
    const cost = getCreditCost('email-refine'); // 1
    await checkCredit(auth.companyId, cost);
    const result = await refineEmailSections({ companyId: auth.companyId, userId: auth.userId, sections, instruction });
    if (result.changed) {
      await deductCreditSafe({ companyId: auth.companyId, cost, source: 'email-refine', createdBy: auth.userId });
    }
    return res.json({ success: true, data: { sections: result.sections }, changed: result.changed });
  } catch (err: any) {
    console.error('[Email /ai/refine-sections] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    return res.status(500).json({ success: false, error: err?.message || 'AI 개선 실패' });
  }
});

router.post('/ai/precheck', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const campaign = await getEmailCampaign(auth.companyId, String(req.body?.campaign_id || ''));
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });

    // 기계 체크 = 코드(무료, 즉시)
    const codeChecks = runEmailCodeChecks({
      subject: campaign.subject,
      htmlBody: campaign.htmlBody,
      textBody: campaign.textBody,
      isAd: campaign.isAd,
    });

    // 스팸 위험 분석 = AI(1크레딧)
    const cost = getCreditCost('email-precheck'); // 1
    await checkCredit(auth.companyId, cost);
    const spamRisk = await analyzeSpamRisk({
      companyId: auth.companyId, userId: auth.userId,
      subject: campaign.subject, htmlBody: campaign.htmlBody, isAd: campaign.isAd,
    });
    await deductCreditSafe({ companyId: auth.companyId, cost, source: 'email-precheck', createdBy: auth.userId });
    return res.json({ success: true, codeChecks, spamRisk });
  } catch (err: any) {
    console.error('[Email /ai/precheck] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || '발송 전 진단 실패' });
  }
});

router.post('/ai/insight', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const campaign = await getEmailCampaign(auth.companyId, String(req.body?.campaign_id || ''));
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });

    const stats = await getCampaignPerformanceStats(campaign.id);
    // 발송·이벤트 0건 = AI 호출 차단 + 차감 0
    if (stats.sentCount === 0 && stats.uniqueOpeners === 0 && stats.uniqueClickers === 0) {
      return res.status(400).json({ success: false, error: '집계할 발송·이벤트 데이터가 없습니다.', code: 'NO_DATA' });
    }

    const cost = getCreditCost('email-performance-insight'); // 5
    await checkCredit(auth.companyId, cost);
    const insight = await buildPerformanceInsight({
      companyId: auth.companyId, userId: auth.userId, campaignName: campaign.name,
      stats: {
        sentCount: stats.sentCount,
        uniqueOpeners: stats.uniqueOpeners,
        uniqueClickers: stats.uniqueClickers,
        bounceCount: stats.bounceCount,
        unsubscribeCount: stats.unsubscribeCount,
        openRatePct: stats.openRatePct,
        clickRatePct: stats.clickRatePct,
        topOpenHours: binOpenHours(stats.topOpenHours).top,
      },
    });
    await deductCreditSafe({ companyId: auth.companyId, cost, source: 'email-performance-insight', createdBy: auth.userId });
    return res.json({ success: true, stats, insight });
  } catch (err: any) {
    console.error('[Email /ai/insight] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || '성과 진단 실패' });
  }
});

router.post('/ai/send-time', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const dist = await getCompanyOpenHourDistribution(auth.companyId);
    const binned = binOpenHours(dist);
    // 표본 부족 = AI 호출 생략 + 차감 0 (임의 상수 금지 — 실데이터만)
    if (binned.total < SEND_TIME_MIN_SAMPLE) {
      return res.json({
        success: true,
        insufficientData: true,
        sampleSize: binned.total,
        minSample: SEND_TIME_MIN_SAMPLE,
        message: `오픈 데이터가 ${binned.total}건으로 부족합니다 (최소 ${SEND_TIME_MIN_SAMPLE}건). 발송이 쌓이면 추천이 가능합니다.`,
      });
    }
    const cost = getCreditCost('email-send-time-recommend'); // 5
    await checkCredit(auth.companyId, cost);
    const rec = await recommendSendTime({ companyId: auth.companyId, userId: auth.userId, total: binned.total, top: binned.top });
    await deductCreditSafe({ companyId: auth.companyId, cost, source: 'email-send-time-recommend', createdBy: auth.userId });
    return res.json({ success: true, insufficientData: false, sampleSize: binned.total, top: binned.top, ...rec });
  } catch (err: any) {
    console.error('[Email /ai/send-time] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    return res.status(500).json({ success: false, error: err?.message || '발송 시간 추천 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 미오픈자 SMS 크로스 채널 — delivered 있고 open 없는 수신자 → phone 매칭 (AI 호출 0 = 차감 0)
// ════════════════════════════════════════════════════════════════════

router.get('/campaigns/:id/non-openers', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const campaign = await getEmailCampaign(companyId, req.params.id);
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    const smsResult = await getCampaignNonOpeners(companyId, req.params.id);              // SMS 크로스채널(전화 매칭) — 유료 상위 옵션
    const resendRecipients = await getCampaignResendRecipients(companyId, req.params.id); // 이메일 재발송 대상(무료·주)
    const childCount = await countResendChildren(companyId, req.params.id);               // 재발송 1회 한도
    const isChild = campaign.resendGeneration > 0;
    const resendable = !isChild && childCount === 0 && resendRecipients.length > 0;
    const resendBlockReason = isChild
      ? '재발송본은 다시 재발송할 수 없습니다.'
      : childCount > 0
        ? '이미 재발송한 캠페인입니다 (재발송 1회 한도).'
        : resendRecipients.length === 0
          ? '재발송할 미오픈 대상이 없습니다.'
          : null;
    return res.json({
      success: true,
      ...smsResult,
      subject: campaign.subject,
      resendEligible: resendRecipients.length,
      resendable,
      resendBlockReason,
    });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/non-openers] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: err?.message || '미오픈자 조회 실패' });
  }
});

// ★ 2026-07-06 미수신자 재발송 — 미오픈자에게 같은 콘텐츠를 이메일로 다시 발송(무료).
//   자식 캠페인 1건 생성(원본 통계 무손상) + 재발송 1회 한도 + 발신 도메인 평판 보호. 완성 크레딧 재부과 없음(콘텐츠 재사용).
router.post('/campaigns/:id/resend-non-openers', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const parent = await getEmailCampaign(auth.companyId, req.params.id);
    if (!parent) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    if (parent.status !== 'completed' || parent.sentCount <= 0) {
      return res.status(400).json({ success: false, error: '발송 완료된 캠페인만 재발송할 수 있습니다.' });
    }
    // 재발송 세대 한도 1회 — 재발송본 재발송 차단 + 원본당 1회
    if (parent.resendGeneration > 0) {
      return res.status(400).json({ success: false, error: '재발송본은 다시 재발송할 수 없습니다.', code: 'RESEND_LIMIT' });
    }
    if ((await countResendChildren(auth.companyId, parent.id)) > 0) {
      return res.status(400).json({ success: false, error: '이미 재발송한 캠페인입니다 (재발송 1회 한도 — 발신 도메인 평판 보호).', code: 'RESEND_LIMIT' });
    }
    if (!(await isSmtpConfigured(auth.companyId))) {
      return res.status(400).json({ success: false, error: '회사 SMTP 설정 후 재발송할 수 있습니다.' });
    }
    // 미오픈 이메일 산출(수신거부·반송·스팸·오픈 제외)
    const recipients = await getCampaignResendRecipients(auth.companyId, parent.id);
    if (recipients.length === 0) {
      return res.status(400).json({ success: false, error: '재발송할 미오픈 대상이 0건입니다.', code: 'ZERO_COUNT' });
    }
    const subjectOverride = typeof req.body?.subject === 'string' ? req.body.subject : undefined;
    // 자식 캠페인 생성(콘텐츠 재사용 = 무료, 완성 게이트 우회하도록 sendEmailCampaign 직접 호출)
    const child = await createResendChildCampaign(parent, auth.userId, subjectOverride);
    // 즉시 발송 — status='sending' 선점 후 응답, 실제 SMTP 루프는 백그라운드(타임아웃 차단)
    await query(
      `UPDATE email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
      [child.id, auth.companyId],
    );
    setImmediate(() => {
      sendEmailCampaign({ campaignId: child.id, recipients, immediate: true })
        .catch((e: any) => console.error(`[Email /resend-non-openers] 백그라운드 발송 실패 (child ${child.id}):`, e?.message));
    });
    return res.json({ success: true, queued: true, childId: child.id, total: recipients.length });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/resend-non-openers] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (handleEncryptionKeyError(err, res)) return;
    return res.status(500).json({ success: false, error: err?.message || '재발송 실패' });
  }
});

export default router;
