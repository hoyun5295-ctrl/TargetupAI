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

import { aiZonePlanBlocked } from '../utils/plan-guard';
import { Router, Request, Response, json } from 'express';
// ★ 2026-09-27 한줄로 V2 R123 — 미오픈 재발송 원본 단위 잠금
import { withKeyedLock } from '../utils/keyed-lock';
import { authenticate } from '../middlewares/auth';
import { resolveOwnerScope } from '../utils/owner-scope';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';
// ★ D225+ (2026-05-28): Email 캠페인 events 이력 조회 endpoint 신설 — email_events 직접 SELECT
import { query } from '../config/database';
// ★ 2026-09-27 만들기 개편 S2·S3 — 완성 판정·완성/발송 잠금은 CT 가 소유(라우트 인라인 0)
import { isEmailCampaignCompleted, emailCompletionContextOf } from '../utils/email/email-completion';
import { emailContentBlocker, emailSmtpBlocker } from '../utils/email/email-send-gate';
import { completeEmailCampaignCore } from '../utils/email/email-complete-core';
import { createEmailCampaign, listEmailCampaigns, emailCampaignTotals, deliveredEmailsOf, composeCampaignShell, resolveEmailSender, buildEmailAdFooter, EMAIL_PREVIEW_UNSUB_HREF, getEmailCampaign, updateEmailCampaign, deleteEmailCampaign, sendEmailCampaign, recordEmailEvent, resolveCustomerRecipients, resolveCustomerRecipientsByFilter, previewCustomerRecipients, listCustomerGrades, scheduleCampaign, getCampaignPerformanceStats, getCampaignNonOpeners, getCampaignResendRecipients, countResendChildren, createResendChildCampaign, listEmailPersonalizationVars, excludeOptedOutEmails, filterEmailSuppressed, withEmailPreviewAdFooter, type EmailRecipient, type EmailTargetSpec } from '../utils/email-channel';
import {
  saveSmtpConfig,
  getSmtpConfigPublic,
  clearSmtpConfig,
  sendTestEmail,
  sendEmail,
  isSmtpConfigured, SmtpKeyMissingError } from '../utils/company-smtp-client';
import { verifyTrackingToken, TRACKING_PIXEL_GIF, UNSUB_URL_MARKER } from '../utils/email-tracking';
import { efficacyNote } from '../utils/copy-benefit-detector';
import { generateEmailSections, refineEmail, refineEmailSections, analyzeSpamRisk, runEmailCodeChecks, buildPerformanceInsight, buildEmailAccountInsight, binOpenHours, EMAIL_SCENARIO_PRESETS, type EmailScenarioKey } from '../utils/email-ai';
// 비주얼 빌더: DM Section[] → 이메일 안전 HTML 렌더 + 회사 브랜드킷
import { renderEmailSections, extractEmailText, EMAIL_FOOTER_SLOT } from '../utils/email/email-section-renderer';
// ★ 2026-07-13 디자인 3.0 — 캠페인 단위 design(테마·아트디렉션·프리헤더) 입력 정규화(단일 지점)
import { normalizeEmailDesign } from '../utils/email/email-tokens';
import { resolveEmailSectionsForCustomer } from '../utils/email/email-personalization';
import { rate, relativeDelta, pointDelta } from '../utils/email/email-analytics-calc';
import { buildPreviewCustomers } from '../utils/inapp-personalization';
import { getCompanyBrandKit, getCompanyBrandKitRaw } from '../utils/dm/dm-brand-kit';
import { normalizeEventText } from '../utils/event-brief';
// ★ 2026-07-08 연동 몰 상품 자동 첨부 (이메일 상품 블록 항목명 → 몰 이름매칭 이미지·링크)
import { attachMallImagesToProductCarousels } from '../utils/mall-product-match';
import type { Section } from '../utils/dm/dm-section-registry';
import { checkCredit, InsufficientCreditError, settleCreditAfterSuccess } from '../utils/ai-credit';
import { isValidAttemptToken, oneLineInflightKey, sanitizeLineProducts, lineProductsKey, sanitizeLineReads, applyLineReads } from '../utils/one-line-facts';   // ★ 2026-10-05 한줄로 시그니처 · ★1010 혜택 답 · 몰 상품 확정
import { placeLineMallCards, linePriceNotes, linePinnedPrimary, lineEmailDesign, type LineMallCard } from '../utils/line-mall-cards';   // ★ 2026-10-10 한 줄 이메일 강화
import { resolveIntegrationActor } from '../utils/integration-scope';
// ★ 2026-10-17 한 줄 단계 모달(설계서 docs/2026-10-17-oneline-steps-modal-design.md §3 · §4-3) — 단계 답 · 직접 상품 · 대표 사진 · 버튼 주소 · 한 줄 완성 금액
import { buildLineStepsEventText } from '../utils/one-line-steps';
import { getLineTemplate } from '../utils/design-core/line-templates';   // ★ 2026-10-17 템플릿 캠페인
import { lineTemplateBrand, LineTemplateError } from '../utils/line-template-run';
import { getLineComposition, draftLineCook, buildLineCookEmail, lineCookManual, listenLine } from '../utils/one-line-ct';   // ★ 2026-10-22 한줄 CT 구성 5종
import { runLineCookOrder } from '../utils/one-line-ct/order';   // ★ 2026-10-23 돈 순서 한 곳
import { prepareLineStepsRequest, isLineStepsReqError, resolveLineStepsDelivery } from '../utils/line-steps-context';
import { placeLineHero, placeLineLink } from '../utils/line-materials';
import { getBrandBasicInfo } from '../utils/brand-basic-info';
import { createSection } from '../utils/dm/dm-section-registry';
import { randomUUID } from 'crypto';
import { getCreditCost } from '../utils/ai-credit-calc';
// ★ 2026-09-06 S6 재료 입구(이미지·행사 텍스트 → 아웃리치 브랜드 이메일 시안 경로)
import { generateFromBuildMaterials, buildGenerateResponse } from '../utils/campaign-quick';
// ★ 2026-09-14 T4 AI 자동제작 v1(materials.version === 1) — 신규 ENV 게이트 · 회사 단위 in-flight 잠금 · 오류 status 매핑
import { isBuildMaterialsV1, aiAutoBuildEnabled, aiAutoBuildErrorResponse, buildInflightKey } from '../utils/ai-auto-build-materials';
import { tryAcquireInflight, releaseInflight, singleFlight } from '../utils/inflight-lock';
import { handleDmImageUpload } from '../utils/dm/dm-image-upload';

import { publicErrorText, respondUserError } from '../utils/http-error';
const router = Router();

// ════════════════════════════════════════════════════════════════════
// DB ALTER 503 분기 공통 헬퍼 (db_alter_safety_net 룰)
// ════════════════════════════════════════════════════════════════════

function handleDbMigrationError(err: any, res: Response, tableName: string): boolean {
  const msg = err?.message || '';
  if (msg.includes('column') && msg.includes('does not exist')) {
    res.status(503).json({
      success: false,
      error: `DB 마이그레이션 필요: 운영자에게 ${tableName} ALTER 실행 요청 의무`,
      code: 'DB_MIGRATION_PENDING',
    });
    return true;
  }
  return false;
}

function handleEncryptionKeyError(err: any, res: Response): boolean {
  if (err instanceof SmtpKeyMissingError) {   // ★ 2026-10-25 판정 = 오류 종류(옛: 문장 글자)
    res.status(503).json({
      success: false,
      error: '메일 연결 정보를 지금 저장할 수 없어요. 고객센터에 알려 주세요.',
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
// 외부 Webhook — ★ 2026-07-12 영구 폐기(410)
//   옛 SendGrid 잔재. 자체 픽셀/링크 추적(HMAC 토큰 검증) 전환 후 소비처 0인데,
//   인증 없이 임의 email에 unsubscribe/bounce 이벤트를 넣을 수 있어(추적 토큰 payload가
//   base64url 평문이라 수신자가 campaign uuid 추출 가능) 통계 오염·타인 수신거부 위조 표면이었다.
//   이벤트 적재는 서명 검증을 거치는 /t/o·/t/c·/u 경로만 유지.
// ════════════════════════════════════════════════════════════════════

router.post('/webhook', json({ limit: '16kb' }), (_req: Request, res: Response) => {
  return res.status(410).json({ success: false, error: '더 이상 쓰지 않는 기능이에요. 화면을 새로 고쳐 주세요.' });
});

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
    if (respondUserError(res, e)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
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

async function ensureEmailAdmin(req: Request, res: Response, opts: { plan: boolean } = { plan: true }): Promise<{ companyId: string; userId: string } | null> {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  const userType = req.user?.userType;
  if (!companyId || !userId) {
    res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    return null;
  }
  if (userType !== 'company_admin' && userType !== 'super_admin') {
    res.status(403).json({ success: false, error: '회사 관리자 권한이 필요합니다.' });
    return null;
  }
  // ★ 2026-10-24 R2 — 요금제 판정(유료 요금제 · 이용 기간)은 plan 표시일 때만. 예약 취소 · 지우기는 미가입 · 만료 뒤에도 연다(Codex 1024 2R) · 회사 · 관리자 · 소유자 검사는 늘
  if (opts.plan) {
    // ★ 2026-09-26 한줄로 V2 R285(같은 뿌리) — Express 4는 async 핸들러의 거절을 받지 않는다. 이 조회가 던지면 응답 없이 매달렸다 → JSON 500.
    let cdpEnabled = false;
    try {
      cdpEnabled = await isCdpEnabledForPlan(companyId);
    } catch (err: any) {
      console.error('[email] 자격 확인 조회 실패:', err?.message || err);
      if (respondUserError(res, err)) return null;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
      res.status(500).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
      return null;
    }
    if (!cdpEnabled) {
      res.status(403).json({ success: false, error: 'Email 캠페인은 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
      return null;
    }
  }
  // ★ 2026-10-24 R2 — 화면 PlanGate 와 같은 서버 문(구독 만료 · 정지 = 잠김 · 옛: 요금제 코드 FREE 만 봤다)
  if (opts.plan && (await aiZonePlanBlocked(req, res))) return null;
  return { companyId, userId };
}

// 캠페인 기능 접근 — 회사 구성원(담당자 포함) + 유료 플랜. ownerId = 담당자면 본인 id(격리), 관리자·슈퍼면 null(전체).
async function ensureEmailAccess(req: Request, res: Response, opts: { plan: boolean } = { plan: true }): Promise<{ companyId: string; userId: string; ownerId: string | null } | null> {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  const userType = req.user?.userType;
  if (!companyId || !userId) {
    res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    return null;
  }
  // ★ 2026-10-24 R2 — 요금제 판정(유료 요금제 · 이용 기간)은 plan 표시일 때만. 예약 취소 · 지우기는 미가입 · 만료 뒤에도 연다(Codex 1024 2R) · 회사 · 관리자 · 소유자 검사는 늘
  if (opts.plan) {
    // ★ 2026-09-26 한줄로 V2 R285(같은 뿌리) — Express 4는 async 핸들러의 거절을 받지 않는다. 이 조회가 던지면 응답 없이 매달렸다 → JSON 500.
    let cdpEnabled = false;
    try {
      cdpEnabled = await isCdpEnabledForPlan(companyId);
    } catch (err: any) {
      console.error('[email] 자격 확인 조회 실패:', err?.message || err);
      if (respondUserError(res, err)) return null;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
      res.status(500).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
      return null;
    }
    if (!cdpEnabled) {
      res.status(403).json({ success: false, error: 'Email 캠페인은 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
      return null;
    }
  }
  if (opts.plan && (await aiZonePlanBlocked(req, res))) return null;   // ★ 2026-10-24 R2 — 위와 같은 서버 문
  const isAdmin = userType === 'company_admin' || userType === 'super_admin';
  return { companyId, userId, ownerId: isAdmin ? null : userId };
}

// ─────────────────────────────────────────────────────────────────────
// SMTP 설정 (회사 admin 본인 정보 등록 / 조회 / 삭제 / 테스트 발송)
// ─────────────────────────────────────────────────────────────────────

// ★ 2026-10-19 B-1017-1④ — 이메일 편집기 사진 업로드(이메일 요금제 문 · 처리기는 DM 과 공용 · 저장 · 주소 같다)
router.post('/upload-image', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  handleDmImageUpload(req, res);
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const configured = await isSmtpConfigured(companyId);
    // ★ 2026-10-03 보내기 창의 연결 판정 원천(남지현 접수 「회사 메일 연결하기」 무반응). 담당자도 읽는 경로라
    //   공개 값(보내는 주소·이름)과 관리 권한만 싣는다 — 서버 주소·계정·비밀번호는 관리자 전용 /smtp-config 에만 있다.
    const pub = configured ? await getSmtpConfigPublic(companyId) : null;
    const userType = req.user?.userType;
    return res.json({
      success: true,
      smtp_configured: configured,
      from_email: pub?.fromEmail || '',
      from_name: pub?.fromName || '',
      can_manage: userType === 'company_admin' || userType === 'super_admin',
    });
  } catch (err: any) {
    console.error('[Email /status] 오류:', err);
    if (handleDbMigrationError(err, res, 'companies')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
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
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

router.put('/smtp-config', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const { host, port, user, password, secure, from_email, from_name } = req.body;
    if (!host || !port || !user || !password || !from_email) {
      return res.status(400).json({ success: false, error: '메일 서버 주소 · 포트 · 아이디 · 비밀번호 · 보내는 주소를 모두 넣어 주세요.' });
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
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, 'SMTP 설정 저장 실패') });
  }
});

router.delete('/smtp-config', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res, { plan: false });
  if (!auth) return;
  try {
    await clearSmtpConfig(auth.companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Email /smtp-config DELETE] 오류:', err);
    if (handleDbMigrationError(err, res, 'companies')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, 'SMTP 설정 삭제 실패') });
  }
});

router.post('/smtp-test', async (req: Request, res: Response) => {
  const auth = await ensureEmailAdmin(req, res);
  if (!auth) return;
  try {
    const { to_email } = req.body;
    if (!to_email) {
      return res.status(400).json({ success: false, error: '테스트 메일을 받을 주소를 넣어 주세요.' });
    }
    const result = await sendTestEmail(auth.companyId, String(to_email));
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[Email /smtp-test] 오류:', err);
    if (handleDbMigrationError(err, res, 'companies')) return;
    if (handleEncryptionKeyError(err, res)) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '테스트 발송 실패') });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 캠페인 CRUD
// ─────────────────────────────────────────────────────────────────────

// ★ 2026-07-02 캠페인 완성 여부 = 완성 크레딧 멱등 원장 행(신·구 키) · ★ 2026-09-27 만들기 개편 S2 — 판정은 CT
//   `utils/email/email-completion.ts`가 소유한다(크레딧제 미적용 회사 = 완성 · 조회 실패 = throw).

// ★ 2026-07-02 개인화 변수 목록 — 하드코딩 금지(Harold 지시). CT-58 실측 프로필에서 데이터 있는(70%+) 필드만.
router.get('/personalization-vars', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const vars = await listEmailPersonalizationVars(companyId);
    return res.json({ success: true, vars });
  } catch (err: any) {
    console.error('[Email personalization-vars] 오류:', err);
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    // ★ 2026-10-25 원장 #86 — 다음 쪽(before = 만든 시각 원문 · before_id) · 첫 쪽에는 전체 지표를 함께 준다
    const before = typeof req.query.before === 'string' ? req.query.before : '';
    const beforeId = typeof req.query.before_id === 'string' ? req.query.before_id : '';
    const cursor = before && /^[0-9a-f-]{36}$/i.test(beforeId) && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$/.test(before) ? { before, beforeId } : null;
    const owner = resolveOwnerScope(req);
    const page = await listEmailCampaigns(companyId, limit, owner, cursor);
    const campaigns = page.rows;
    const totals = cursor ? null : await emailCampaignTotals(companyId, owner);
    // ★ 2026-07-02 완성 여부 플래그 — 프론트 발송/PC 미리보기 잠금 판단용 (신·구 멱등키 인정)
    try {
      // ★ 2026-09-27 S2 — 발송 게이트와 같은 판정(크레딧제 미적용 회사 = 전부 완성)
      const { notApplicable, paidIds } = await emailCompletionContextOf(companyId, (campaigns as any[]).map((c) => String(c.id))); // ★ R122 목록 id 만
      for (const c of campaigns as any[]) {
        c.completed = notApplicable || paidIds.has(String(c.id));
      }
    } catch (flagErr: any) {
      console.log('[Email campaigns GET] completed 플래그 계산 오류 — 플래그 없이 반환:', flagErr?.message);
    }
    return res.json({ success: true, campaigns, hasMore: page.hasMore, next: page.next, ...(totals ? { totals } : {}) });
  } catch (err: any) {
    console.error('[Email /campaigns GET] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

router.get('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const campaign = await getEmailCampaign(companyId, req.params.id, resolveOwnerScope(req));
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    return res.json({ success: true, campaign });
  } catch (err: any) {
    console.error('[Email /campaigns/:id] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

// ★ 2026-07-02 캠페인 완성 (Harold 확정 크레딧 모델)
//   완성 = 50크레딧 캠페인당 1회(멱등) — AI/수동/템플릿 불문. 완성 후 수정·재저장·발송·이력 전부 추가 차감 0.
//   임시저장(draft)은 무료·무제한이되 발송/PC 미리보기가 잠기고, 이 endpoint가 해금한다. 환불 없음.
router.post('/campaigns/:id/complete', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const campaign = await getEmailCampaign(auth.companyId, req.params.id, auth.ownerId);
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    // ★ 2026-10-04 플래너 보강 B4 — 본문은 완성 코어 CT(utils/email/email-complete-core.ts)로 옮겼다(동작 무변경).
    //   완성의 문이 둘(편집기 [완성] · 플래너 행사 승인)이라 이미 완성 판정 · 발신 설정·본문 잠금 · 차감을 한 함수가 소유한다.
    const r = await completeEmailCampaignCore({ companyId: auth.companyId, userId: auth.userId, campaign });
    if (!r.ok) return res.status(r.status).json({ success: false, error: r.error, code: r.code });
    if (r.alreadyCompleted) return res.json({ success: true, completed: true, alreadyCompleted: true });
    return res.json({ success: true, completed: true, alreadyCompleted: false, cost: r.cost });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/complete] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (respondUserError(res, err)) return;
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: publicErrorText(err, '완성 처리 실패') });
  }
});

router.post('/campaigns', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const { name, subject, html_body, text_body, from_name, from_email, is_ad, scheduled_at, ai_generated, sections } = req.body;
    if (!name || !subject) {
      return res.status(400).json({ success: false, error: '캠페인 이름과 메일 제목을 넣어 주세요.' });
    }
    // 비주얼 빌더: sections 있으면 이메일 HTML 렌더 → html_body (없으면 클라이언트 html_body 직접 흐름 보존)
    // ★ 2026-07-13 디자인 3.0 — design(테마·아트디렉션·프리헤더) 정규화 후 렌더·저장 동승
    const design = normalizeEmailDesign(req.body.design);
    let finalHtml = html_body ? String(html_body) : '';
    let finalText = text_body ? String(text_body) : undefined;
    let finalSections: unknown[] | null = null;
    if (Array.isArray(sections) && sections.length > 0) {
      const brandKit = await getCompanyBrandKit(auth.companyId);
      finalHtml = renderEmailSections(sections as Section[], { brandKit, design, publicBase: process.env.PUBLIC_BASE_URL });
      finalText = extractEmailText(sections as Section[]);
      finalSections = sections;
    }
    if (!finalHtml) {
      return res.status(400).json({ success: false, error: '메일 내용이 비어 있어요. 블록을 하나 이상 넣어 주세요.' });
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
      design,
      scheduledAt: scheduled_at ? new Date(scheduled_at) : undefined,
    });
    return res.json({ success: true, campaign });
  } catch (err: any) {
    console.error('[Email /campaigns POST] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '캠페인 신설 실패') });
  }
});

// ★ 2026-09-27 만들기 개편 S11 — POST /campaigns/:id/clone — 이메일 복제(초안 · 차감 0).
//   원본은 소유 범위(담당자 = 본인 것)에서 읽고, 새 행은 기존 생성 CT(createEmailCampaign)로 만든다(신규 SQL 0).
//   완성 원장은 캠페인 id 기준이라 복제본은 "완성 전"으로 시작한다(돈 축 무변경) · 발송 이력·예약·재발송 표식은 옮기지 않는다.
router.post('/campaigns/:id/clone', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const src = await getEmailCampaign(auth.companyId, req.params.id, auth.ownerId);
    if (!src) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    const campaign = await createEmailCampaign({
      companyId: auth.companyId,
      createdBy: auth.userId,
      name: `${src.name} 복사본`.slice(0, 200),
      subject: src.subject,
      htmlBody: src.htmlBody,
      textBody: src.textBody || undefined,
      fromName: src.fromName || undefined,
      fromEmail: src.fromEmail || undefined,
      isAd: src.isAd,
      aiGenerated: src.aiGenerated,
      sections: Array.isArray(src.sections) ? src.sections : null,
      design: src.design || null,
    });
    return res.json({ success: true, campaign });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/clone] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '복제 실패') });
  }
});

router.patch('/campaigns/:id', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
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
    // ★ 2026-07-13 디자인 3.0 — design 명시 전달 시 정규화 저장(null = 기본 룩 초기화)
    if (req.body.design !== undefined) patch.design = normalizeEmailDesign(req.body.design);
    // 비주얼 빌더: sections 수정 시 html_body·text_body 재렌더
    if (Array.isArray(req.body.sections)) {
      patch.sections = req.body.sections;
      if (req.body.sections.length > 0) {
        const brandKit = await getCompanyBrandKit(auth.companyId);
        // 재렌더 design = 이번 요청 우선, 미전달이면 저장된 캠페인 design 유지(테마 유실 방지)
        let renderDesign = patch.design ?? null;
        if (req.body.design === undefined) {
          const existing = await getEmailCampaign(auth.companyId, req.params.id, auth.ownerId);
          renderDesign = existing?.design ?? null;
        }
        patch.htmlBody = renderEmailSections(req.body.sections as Section[], { brandKit, design: renderDesign, publicBase: process.env.PUBLIC_BASE_URL });
        patch.textBody = extractEmailText(req.body.sections as Section[]);
      }
    }

    const updated = await updateEmailCampaign(auth.companyId, req.params.id, patch, auth.ownerId);
    if (!updated) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    return res.json({ success: true, campaign: updated });
  } catch (err: any) {
    console.error('[Email /campaigns PATCH] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '캠페인 수정 실패') });
  }
});

router.delete('/campaigns/:id', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res, { plan: false });
  if (!auth) return;
  try {
    const ok = await deleteEmailCampaign(auth.companyId, req.params.id, auth.ownerId);
    if (!ok) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Email /campaigns DELETE] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '캠페인 삭제 실패') });
  }
});

router.post('/campaigns/:id/send', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const campaign = await getEmailCampaign(auth.companyId, req.params.id, auth.ownerId);
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });

    // 이중 발송 가드 — 이미 발송 중이면 차단
    if (campaign.status === 'sending') {
      return res.status(409).json({ success: false, error: '이미 발송이 진행 중입니다.' });
    }

    // placeholder 잔존(미입력 자리) · ★2026-09-22 링크 결함 = 발송 차단 — ★ 2026-09-27 만들기 개편 S3 판정은 CT(`email-send-gate`)가 소유
    //   (완성 `/complete` 도 같은 CT 를 차감 앞에서 부른다). 문구·코드는 옛 인라인과 같다.
    const contentBlock = emailContentBlocker(campaign);
    if (contentBlock) {
      return res.status(contentBlock.status).json({ success: false, error: contentBlock.error, code: contentBlock.code });
    }
    // ★ 2026-09-27 만들기 개편 S5 — 발신 설정(SMTP) 확인은 **선점 앞**(옛: 'sending' 선점 뒤 백그라운드에서 failed 로 떨어져
    //   화면은 "발송 시작"을 보고 결과는 실패였다). 예약도 같은 자리에서 막는다(sweeper 가 나중에 실패하지 않게).
    const smtpBlock = await emailSmtpBlocker(auth.companyId);
    if (smtpBlock) {
      return res.status(smtpBlock.status).json({ success: false, error: smtpBlock.error, code: smtpBlock.code });
    }

    const { recipients, target, mode, scheduled_at } = req.body;
    const sendMode: 'immediate' | 'scheduled' = mode === 'scheduled' ? 'scheduled' : 'immediate';

    // 수신자 명세 해석 — 명시 recipients(직접 입력) 또는 target(고객DB)
    let resolved: EmailRecipient[] = [];
    let targetSpec: EmailTargetSpec | null = null;
    let excludedOptOut = 0;
    if (Array.isArray(recipients) && recipients.length > 0) {
      resolved = recipients
        .map((r: any) => ({
          email: String(r.email || '').trim(),
          name: r.name ? String(r.name) : undefined,
          substitutions: r.substitutions || undefined,
        }))
        .filter((r: EmailRecipient) => r.email.includes('@'));
      // ★ 2026-07-12 직접 입력도 수신거부·반송·무효 이력 제외 — 고객DB 경로(RECIPIENT_SAFETY_WHERE)와 동일 보호
      const filtered = await excludeOptedOutEmails(auth.companyId, resolved);
      resolved = filtered.recipients;
      excludedOptOut = filtered.excludedCount;
      targetSpec = { type: 'list', recipients: resolved.map((r) => ({ email: r.email, name: r.name })) };
    } else if (target && target.type === 'customers') {
      const grades = Array.isArray(target.grades) ? target.grades.map((g: any) => String(g)) : undefined;
      targetSpec = { type: 'customers', grades };
      // ★ 2026-09-27 한줄로 V2 S5-04 — 담당자면 자기 분류 고객만(ownerId = 담당자 본인 · 관리자 null)
      resolved = await resolveCustomerRecipients(auth.companyId, grades, auth.ownerId);
    } else if (target && target.type === 'filter' && target.filter && typeof target.filter === 'object') {
      // 타겟 추출(/api/targets/extract)로 확정한 filter → 이메일 발송 대상 결합.
      // ★ 2026-07-02(3) 빈 filter {} = "전체 고객"(isAll) — 조건 없음 = 이메일 자격자 전체 (명시적 type:'filter' 확정분만 도달)
      targetSpec = { type: 'filter', filter: target.filter };
      resolved = await resolveCustomerRecipientsByFilter(auth.companyId, target.filter, auth.ownerId);
    } else {
      return res.status(400).json({ success: false, error: '받는 사람을 골라 주세요.' });
    }
    // ★ 2026-10-24 세 채널 구조체크 ① — 거부 신호 주소 제외(엔진과 같은 판정 · 화면에 보일 수와 실제 발송 수가 같게)
    const suppressed = await filterEmailSuppressed(auth.companyId, resolved);
    resolved = suppressed.recipients;
    excludedOptOut += suppressed.excludedCount;

    // Zero-Count 영구 원칙
    if (resolved.length === 0) {
      return res.status(400).json({
        success: false,
        error: excludedOptOut > 0
          ? `수신거부·반송 이력 ${excludedOptOut}건을 제외하면 발송 대상이 0건입니다.`
          : '발송 대상이 0건입니다. 조건을 조정해주세요.',
        code: 'ZERO_COUNT',
      });
    }

    // ★ 2026-07-02 Harold 확정 — 발송 시 크레딧 차감 제거(발송 = 무료, 고객 SMTP).
    //   대신 완성(50크레딧, /complete) 안 된 캠페인은 발송 차단. 예약 취소/삭제 크레딧 소멸 구멍도 구조상 소멸.
    if (!(await isEmailCampaignCompleted(auth.companyId, campaign.id))) {
      return res.status(400).json({
        success: false,
        error: `완성 저장(${getCreditCost('email-campaign-complete')}크레딧) 후 발송할 수 있습니다. 편집기에서 [완성 저장]을 눌러주세요.`,
        code: 'CAMPAIGN_NOT_COMPLETED',
      });
    }

    // ★ 2026-10-25 원장 #83 — 새로 나갈 수 = 이미 받은 분을 뺀 수(발송 엔진과 같은 함수) · 다 받았으면 보내지 않는다
    const delivered = await deliveredEmailsOf(campaign.id).catch(() => new Set<string>());
    const freshCount = resolved.filter((r: any) => !delivered.has(String(r.email || '').toLowerCase())).length;
    const alreadyDelivered = resolved.length - freshCount;
    if (resolved.length > 0 && freshCount === 0) {
      return res.status(409).json({ success: false, error: '고른 분들이 이 메일을 이미 모두 받았어요. 새로 보낼 사람이 없어요.', code: 'ALL_ALREADY_SENT' });
    }

    // 예약 발송 — target_spec 저장 + status='scheduled'. sweeper가 도래 시 발송.
    if (sendMode === 'scheduled') {
      const when = scheduled_at ? new Date(scheduled_at) : null;
      if (!when || isNaN(when.getTime()) || when.getTime() < Date.now() + 60 * 1000) {
        return res.status(400).json({ success: false, error: '예약 시각은 현재보다 1분 이상 이후여야 합니다.' });
      }
      const updated = await scheduleCampaign(auth.companyId, campaign.id, targetSpec, when);
      return res.json({ success: true, scheduled: true, total: freshCount, alreadyDelivered, excludedOptOut, scheduledAt: updated?.scheduledAt });
    }

    // 즉시 발송 — status='sending' 선점 후 응답, 실제 SMTP 루프는 백그라운드(타임아웃 차단)
    // ★ 2026-09-27 한줄로 V2 R123 — 선점은 조건부(발송 중이 아닐 때만) · 못 잡으면 409. 옛: 위 상태 확인 뒤 id만으로 덮어
    //   동시 요청 둘이 함께 통과해 같은 메일이 두 번 나갔다.
    const claimed = await query(
      `UPDATE email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status <> 'sending'
       RETURNING id`,
      [campaign.id, auth.companyId],
    );
    if (claimed.rows.length === 0) {
      return res.status(409).json({ success: false, error: '이미 발송 중입니다.', code: 'ALREADY_SENDING' });
    }
    setImmediate(() => {
      sendEmailCampaign({ campaignId: campaign.id, recipients: resolved, immediate: true })
        .catch(async (e: any) => {
          console.error(`[Email /send] 백그라운드 발송 실패 (campaign ${campaign.id}):`, e?.message);
          // 발송 엔진 초입 throw(SMTP 미설정 등)는 status를 못 바꾸므로 즉시 failed — 30분 정체 대기 제거
          try {
            await query(
              `UPDATE email_campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1::uuid AND status = 'sending'`,
              [campaign.id],
            );
          } catch { /* 상태 복구 실패는 sweeper 정체 복구가 후위 안전망 */ }
        });
    });
    return res.json({ success: true, queued: true, total: freshCount, alreadyDelivered, excludedOptOut });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/send] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (respondUserError(res, err)) return;
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (handleEncryptionKeyError(err, res)) return;
    // ★ 2026-10-25 R10 — 글자 짐작(0건 · 필수 · 미완료) 0 · 사용자 조건은 오류 종류가 위 respondUserError 로 나간다
    return res.status(500).json({ success: false, error: publicErrorText(err, '발송 실패') });
  }
});

// ★ 2026-07-22 테스트발송 — 완성된 캠페인을 직접 입력 최대 3개 주소로 발송(영업/자체 점검용).
//   실발송 엔진(sendEmailCampaign)을 안 거쳐 (광고)·수신거부 footer·추적·통계 미반영. 저수준 sendEmail 재사용.
//   완성(50크레딧) 게이트는 실발송과 동일 — 발송 자체는 무과금(크레딧은 완성 시점에 이미 차감).
//   신규 DB 컬럼/JOIN 없음(기존 getEmailCampaign·isEmailCampaignCompleted·isSmtpConfigured 재사용).
router.post('/campaigns/:id/test-send', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    // SMTP 연동 필수 — 회사 SMTP로 발송
    if (!(await isSmtpConfigured(auth.companyId))) {
      return res.status(400).json({ success: false, error: '회사 SMTP를 먼저 설정해주세요.', code: 'SMTP_NOT_CONFIGURED' });
    }

    const campaign = await getEmailCampaign(auth.companyId, req.params.id, auth.ownerId);
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });

    // 완성 저장 후에만 — 실발송과 동일 게이트(방어). 미완성이면 안내.
    if (!(await isEmailCampaignCompleted(auth.companyId, campaign.id))) {
      return res.status(400).json({
        success: false,
        error: `완성 저장(${getCreditCost('email-campaign-complete')}크레딧) 후 테스트발송할 수 있습니다. 편집기에서 [완성 저장]을 눌러주세요.`,
        code: 'CAMPAIGN_NOT_COMPLETED',
      });
    }

    // 직접 입력 수신 주소 최대 3개 (중복·형식 정리)
    const rawList = Array.isArray(req.body?.emails) ? req.body.emails : [];
    if (rawList.length > 3) {
      return res.status(400).json({ success: false, error: '테스트발송은 최대 3개 주소까지 가능합니다.' });
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emails = Array.from(new Set(
      rawList.map((e: any) => String(e || '').trim().toLowerCase()).filter((e: string) => emailPattern.test(e)),
    )).slice(0, 3) as string[];
    if (emails.length === 0) {
      return res.status(400).json({ success: false, error: '유효한 이메일 주소를 1개 이상 입력해주세요 (최대 3개).' });
    }

    // ★ 2026-10-25 원장 #88 — 테스트 메일 = 실발송과 같은 껍데기((광고) 제목 · 수신거부 꼬리 · composeCampaignShell).
    //   테스트 받는 분은 고객이 아니라 수신거부 링크만 미리보기 주소로 둔다 · 추적 픽셀 · 통계 미반영(그대로).
    const sender = await resolveEmailSender(auth.companyId, campaign);
    const shell = composeCampaignShell(campaign, buildEmailAdFooter(sender.name, sender.email, EMAIL_PREVIEW_UNSUB_HREF));
    const html = shell.html.split(UNSUB_URL_MARKER).join(EMAIL_PREVIEW_UNSUB_HREF);
    const subject = shell.subject;

    let lastErr: any = null;
    const results: Array<{ email: string; ok: boolean }> = [];
    for (const email of emails) {
      try {
        await sendEmail({ companyId: auth.companyId, to: email, subject, htmlBody: html, textBody: campaign.textBody || undefined });
        results.push({ email, ok: true });
      } catch (e: any) {
        lastErr = e;
        console.error(`[Email /test-send] 발송 실패 (${email}):`, e?.message);
        results.push({ email, ok: false });
      }
    }
    const sent = results.filter((r) => r.ok).length;
    // 감사 로그 — 영업용 테스트발송 추적(누가/어떤 캠페인/몇 건). 반복 발송 모니터링용.
    console.log(`[Email /test-send] company=${auth.companyId} user=${auth.userId} campaign=${campaign.id} sent=${sent}/${emails.length}`);
    if (sent === 0) {
      // 전량 실패가 SMTP 암호화 키/마이그레이션 문제면 실발송과 동일하게 분류(503) — 일반 502로 뭉개지 않게(Codex M2).
      if (lastErr && handleEncryptionKeyError(lastErr, res)) return;
      if (lastErr && handleDbMigrationError(lastErr, res, 'companies')) return;
      return res.status(502).json({ success: false, error: '테스트발송에 실패했습니다. SMTP 설정을 확인해주세요.', results });
    }
    return res.json({ success: true, sent, total: emails.length, results });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/test-send] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (handleEncryptionKeyError(err, res)) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '테스트발송 실패') });
  }
});

// ★ 2026-07-22 완성 이메일 HTML 내보내기 — 저장 산출물을 .html 파일로 다운로드(재사용·보관용).
//   완성(50크레딧 차감) 후에만 — 크레딧 없이 완성 HTML을 빼가는 우회 방어(서버 게이트, 버튼 숨김만으론 부족).
//   추적 픽셀·(광고)·수신거부 미포함(순수 산출물). 신규 DB 컬럼/JOIN 0(기존 getEmailCampaign·isEmailCampaignCompleted 재사용).
router.get('/campaigns/:id/export-html', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const campaign = await getEmailCampaign(auth.companyId, req.params.id, auth.ownerId);
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });

    // 완성(50크레딧) 후에만 — 크레딧 없이 산출물 추출 방어(서버 게이트, UI 숨김만으론 우회 가능).
    if (!(await isEmailCampaignCompleted(auth.companyId, campaign.id))) {
      return res.status(400).json({
        success: false,
        error: `완성 저장(${getCreditCost('email-campaign-complete')}크레딧) 후 HTML로 저장할 수 있습니다. 편집기에서 [완성 저장]을 눌러주세요.`,
        code: 'CAMPAIGN_NOT_COMPLETED',
      });
    }

    // 저장 HTML → 광고 footer 슬롯 마커 제거 + 남은 루트상대 src/href를 절대경로화(파일을 어디서 열어도 이미지·링크 로드).
    //   렌더러(emailImg)가 대부분 이미 절대화하나, 수동 html_body 등 잔여분 방어. //·http·#·data:·mailto: 는 미접촉.
    const base = (process.env.PUBLIC_BASE_URL || 'https://hanjul.ai').replace(/\/$/, '');
    let html = String(campaign.htmlBody || '').split(EMAIL_FOOTER_SLOT).join('');
    // 루트상대 src/href 절대화 — 대소문자·따옴표·공백 변형 포함(Codex L). //·http·#·data:·mailto: 는 미접촉.
    html = html.replace(/(\b(?:src|href)\s*=\s*["'])\/(?!\/)/gi, `$1${base}/`);

    const safeName = (campaign.name || 'email').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'email';
    // ASCII fallback(비ASCII·제어문자 제거) + RFC 5987 UTF-8 파일명 병기 — 구형 클라 파일명 깨짐 방어(Codex L).
    const asciiName = (safeName.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '').trim()) || 'email';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}.html"; filename*=UTF-8''${encodeURIComponent(safeName)}.html`);
    return res.send(html);
  } catch (err: any) {
    console.error('[Email /campaigns/:id/export-html] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, 'HTML 내보내기 실패') });
  }
});

// ★ 2026-07-12 예약 발송 취소 — scheduled → draft 복귀 (취소 수단 부재 봉합).
//   WHERE status='scheduled' 원자 조건이라 sweeper의 sending 선점과 경합해도 한쪽만 성립(이중 처리 0).
//   완성(50크레딧)은 캠페인에 남아 있으므로 취소 후 재발송·재예약 자유.
router.post('/campaigns/:id/cancel-schedule', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res, { plan: false });
  if (!auth) return;
  try {
    const ownerClause = auth.ownerId ? ' AND created_by = $3::uuid' : '';
    const params: any[] = [req.params.id, auth.companyId];
    if (auth.ownerId) params.push(auth.ownerId);
    const r = await query(
      `UPDATE email_campaigns
         SET status = 'draft', scheduled_at = NULL, target_spec = NULL, updated_at = NOW()
       WHERE id = $1::uuid AND company_id = $2::uuid${ownerClause} AND status = 'scheduled'
       RETURNING id`,
      params,
    );
    if (r.rows.length === 0) {
      return res.status(400).json({ success: false, error: '예약 상태 캠페인이 아닙니다. 이미 발송이 시작되었거나 취소된 상태입니다.', code: 'NOT_SCHEDULED' });
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/cancel-schedule] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '예약 취소 실패') });
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

    // 캠페인 권한 검증 (회사 격리 + 담당자 소유 격리)
    const campaign = await getEmailCampaign(companyId, campaignId, resolveOwnerScope(req));
    if (!campaign) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });

    // 1. 수신자별 매트릭스 — email 안 events 영역 GROUP
    const recipientResult = await query(
      `SELECT email,
              MIN(CASE WHEN event_type IN ('delivered','processed','sent') THEN occurred_at END) AS delivered_at,
              MIN(CASE WHEN event_type = 'open' THEN occurred_at END) AS opened_at,
              MIN(CASE WHEN event_type = 'click' THEN occurred_at END) AS clicked_at,
              MIN(CASE WHEN event_type IN ('bounce','dropped','spam_report') THEN occurred_at END) AS bounced_at,
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
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '이력 조회 실패') });
  }
});

// ════════════════════════════════════════════════════════════════════
// 수신자 — 고객DB 연동 (RecipientsModal 고객DB 탭)
// ════════════════════════════════════════════════════════════════════

router.get('/recipients/grades', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const grades = await listCustomerGrades(companyId, resolveOwnerScope(req));
    return res.json({ success: true, grades });
  } catch (err: any) {
    console.error('[Email /recipients/grades] 오류:', err);
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '등급 조회 실패') });
  }
});

router.post('/recipients/preview', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const grades = Array.isArray(req.body?.grades) ? req.body.grades.map((g: any) => String(g)) : undefined;
    const preview = await previewCustomerRecipients(companyId, grades, resolveOwnerScope(req));
    return res.json({ success: true, ...preview });
  } catch (err: any) {
    console.error('[Email /recipients/preview] 오류:', err);
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '대상 미리보기 실패') });
  }
});

// ════════════════════════════════════════════════════════════════════
// AI — 원샷 생성(3) / 다듬기(1) / 발송 전 진단(1) / 발송 후 성과(5) / 발송 시간(5)
//   차감 = checkCredit → 작업 성공 → settleCreditAfterSuccess(실패 시 차감 0 · ★1025 동시 소진 402 · 원장 실패 503 = 결과 안 줌). 내부 callAIWithFallback은 creditCost:0.
// ════════════════════════════════════════════════════════════════════

// 비주얼 빌더 — AI가 이메일 블록 Section[]을 생성(이미지·혜택은 빈 자리). 크레딧 3.
// ★ 2026-10-10 한 줄 묻기(설계서 docs/2026-10-10-oneline-ask-design.md §3-2) — 이메일 한 줄 질문의 답(AI 0 · 차감 0). 문 = ensureEmailAccess.
router.post('/one-line/ask', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const { oneLineAskEnabled } = await import('../utils/one-line-facts');
    const { buildContentAsk, parseAskLine, LINE_ASK_DISABLED } = await import('../utils/one-line-ask');
    if (!oneLineAskEnabled(auth.companyId)) return res.status(404).json(LINE_ASK_DISABLED);
    if (!parseAskLine(req.body)) return res.status(400).json({ success: false, error: '물어볼 내용을 한 줄로 적어 주세요.' });
    return res.json({ success: true, answer: await buildContentAsk(auth.companyId, auth.userId, 'email', auth.ownerId) });
  } catch (err: any) {
    console.error('[Email one-line ask] 오류:', err);
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: '답을 준비하지 못했어요. 잠시 뒤 다시 물어봐 주세요.' });
  }
});

router.post('/ai/generate-sections', singleFlight('email-generate', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const prompt = req.body?.prompt ? String(req.body.prompt).trim() : '';
    const scenario = req.body?.scenario ? String(req.body.scenario) as EmailScenarioKey : undefined;
    const isAd = !!req.body?.is_ad;
    // ★ 2026-07-07(4) 행사 캠페인 — 행사 원문 단독 입력도 생성 가능 (기재 혜택만 원문 그대로)
    const eventText = req.body?.event_text ? normalizeEventText(req.body.event_text) : '';
    // ★ 2026-09-14 T4 AI 자동제작 v1(materials.version === 1 · 설계서 §6-5 · §6-6 · §6-7) — 신규 ENV AND · 회사 단위 in-flight 409 · SMTP 게이트·is_ad·멱등키·eventCards·제목 산출은 오케스트레이터 ·
    //   결과 = draft 행(campaign_id) · 오류는 AiAutoBuildError.status 그대로 → 402 잔액 → 503 마이그레이션(email_campaigns) → 500 · v0 경로는 아래 그대로.
    if (req.body?.materials && isBuildMaterialsV1(req.body.materials)) {
      if (!aiAutoBuildEnabled(auth.companyId)) return res.status(403).json({ success: false, error: '이 기능은 아직 열리지 않았습니다.', code: 'FEATURE_DISABLED' });
      const lockKey = buildInflightKey(auth.companyId);
      if (!tryAcquireInflight(lockKey)) return res.status(409).json({ success: false, error: '지금 만드는 중이에요. 완성되면 이어서 진행해 주세요.', code: 'IN_FLIGHT' });
      try {
        const r = await generateFromBuildMaterials({ companyId: auth.companyId, userId: auth.userId, materials: req.body.materials, industry: typeof req.body?.industry === 'string' ? req.body.industry : null, channel: 'email' });
        return res.json({ success: true, data: buildGenerateResponse(r) });
      } catch (err: any) {
        const mapped = aiAutoBuildErrorResponse(err);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        if (respondUserError(res, err)) return;   // ★ 2026-10-25 원장 쓰기 실패 = 503(성공 뒤 차감 한 규칙)
        if (err instanceof InsufficientCreditError) return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
        if (handleDbMigrationError(err, res, 'email_campaigns')) return;
        console.error('[Email /ai/generate-sections build-v1] 오류:', err?.message);
        return res.status(500).json({ success: false, error: '재료로 이메일을 만들지 못했습니다. 잠시 후 다시 시도해주세요.' });
      } finally { releaseInflight(lockKey); }
    }

    // ★ 2026-10-25 원장 #104 — 재료로 만들기 = v1 한 길. 옛 v0 갈래(영업용 이메일 시안 · 차감 멱등키 0)는 지웠다 · 열린 옛 화면 = 400
    if (req.body?.materials) return res.status(400).json({ success: false, error: '화면을 새로 고친 뒤 다시 만들어 주세요.', code: 'MATERIALS_INVALID' });
    if (!prompt && !scenario && !eventText) {
      return res.status(400).json({ success: false, error: '요청 내용 또는 시나리오를 입력해주세요.' });
    }
    if (prompt.length > 2000) {
      return res.status(400).json({ success: false, error: '요청은 2000자 이내로 입력해주세요.' });
    }
    if (scenario && !EMAIL_SCENARIO_PRESETS[scenario]) {
      return res.status(400).json({ success: false, error: '알 수 없는 시나리오입니다.' });
    }
    // ★ 2026-10-05 한줄로 시그니처(설계서 §3-7) — 한 줄 입구(one_line:true) + 스위치 켠 회사 + 시도 토큰이 온 요청만 멱등. 그 밖 요청 = 지금 동작 그대로.
    //   이메일은 요청 글이 이미 혜택 근거다(email-ai generateEmailSections 의 근거 = 요청 · 원문) → 원문 자리는 옮기지 않는다.
    //   빠진 혜택 · 기간은 생성기가 남긴 자리에서 화면이 0크레딧으로 채운다.
    const lineOn = req.body?.one_line === true;
    // ★ 2026-10-10 한 줄 이메일 강화(설계서 docs/2026-10-10-oneline-dm-email-design.md §3) — 생성 전 묻는 창의 답(혜택) · 사람이 고른 몰 상품(provider + 상품번호만).
    //   이메일은 요청 글이 혜택 근거라 혜택 답은 요청 글에 [혜택] 줄로 붙인다(원문 자리로 옮기지 않는다 · 시그니처 §5). 스위치 밖인데 오면 400.
    const oneLineReq = req.body?.one_line === true;
    // ★ 2026-10-17 한 줄 단계 모달 — `steps` 칸이 온 요청만(스위치 = 한 줄 보강 스위치 안에서만) · 혜택은 단계 답에서 읽는다
    const stepsNow = Date.now();
    const stepsReads = oneLineReq ? sanitizeLineReads(req.body?.read_texts) : undefined;
    const steps = oneLineReq
      ? prepareLineStepsRequest(req.body, auth.companyId, prompt, stepsReads === 'invalid' ? undefined : stepsReads, stepsNow, lineOn)
      : undefined;
    if (isLineStepsReqError(steps)) return res.status(steps.status).json({ success: false, error: steps.error, code: steps.code });
    // ★ 2026-10-24 세 채널 구조체크 ⑧ — 한 줄 요청은 단계(한줄 CT 요리 주문 runLineCookOrder) 한 길이다. 옛 1005 · 1010 갈래(묻는 창 · 시도 토큰 돈 순서)는 지웠다
    //   (그 갈래 결과는 구성 · 재료 판 · 질문표 · 효능 판정을 안 지났다). 열린 옛 화면 = 400 · 새로 고치면 단계로 간다.
    if (oneLineReq && !steps) return res.status(400).json({ success: false, error: '화면을 새로 고친 뒤 한 줄을 다시 넣어 주세요.', code: 'LINE_STEPS_REQUIRED' });
    // ★ 2026-10-17 템플릿 캠페인 — 템플릿 칸이 온 단계 요청만(스위치 밖인데 오면 400)
    const tplSel = steps && steps.body.template ? steps.body.template : null;
    const tplDef = tplSel ? getLineTemplate(tplSel.id) : null;
    // ★ 2026-10-22 한줄 CT — 구성 5종 id 가 오면 구성 조립(같은 돈 순서)
    const compDef = tplSel && !tplDef ? getLineComposition(tplSel.id) : null;
    const lineFacts = steps && steps.body.facts.benefit !== undefined ? { benefit: steps.body.facts.benefit } : undefined;
    const lineProducts = oneLineReq ? sanitizeLineProducts(req.body?.products) : undefined;
    if (lineProducts === 'invalid') {
      return res.status(400).json({ success: false, error: '고른 상품을 다시 확인해 주세요.', code: 'LINE_PRODUCTS_INVALID' });
    }
    // ★ 2026-10-10 Harold 결정 H3 — 사진에서 읽은 글 조각은 체크가 없으면 숫자 값을 지우고 쓴다(면허 아님)
    const lineReads = oneLineReq ? sanitizeLineReads(req.body?.read_texts) : undefined;
    if (lineReads === 'invalid') {
      return res.status(400).json({ success: false, error: '사진에서 읽은 글을 다시 확인해 주세요.', code: 'LINE_READS_INVALID' });
    }
    if ((lineFacts !== undefined || lineProducts !== undefined || lineReads !== undefined) && !lineOn) {
      return res.status(400).json({ success: false, error: '이 기능은 아직 열리지 않았습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.', code: 'FEATURE_DISABLED' });
    }
    const linePrompt = lineOn ? applyLineReads(prompt, lineReads, req.body?.read_licensed === true) : prompt;
    // ★ 2026-10-17 단계 답 = [혜택] · [기간](날짜를 친 것과 같게) · [상품](글로만 소개할 직접 상품) 줄
    const genPrompt = steps
      ? buildLineStepsEventText(linePrompt, { benefit: lineFacts ? lineFacts.benefit : null, periodEnd: steps.body.facts.periodEnd ?? null, textProducts: steps.textProducts })
      : linePrompt;
    const attemptToken = lineOn && isValidAttemptToken(req.body?.attempt_token) ? String(req.body.attempt_token) : null;
    // ★ 2026-10-17 단계 요청 = 한 줄 완성 원장 키 · 생성 입력 전부를 지문에(직접 상품 전부 · 대표 사진 · 주소 답)
    // ★ 템플릿 요청 = 템플릿 · 배치 · 페이지도 지문에(1017 요청 키는 그대로)
    const stepsPayload = steps
      ? { prompt: genPrompt, scenario: scenario || null, isAd, eventText, products: lineProductsKey(lineProducts || []), manual: steps.body.manual, hero: steps.hero, ...(steps.heroAsIs ? { heroAsIs: true } : {}), ...(steps.body.proof.length > 0 ? { proof: steps.body.proof } : {}), link: steps.body.facts.link ?? null, ...(tplSel ? { template: tplSel, page: steps.body.page } : {}), ...(compDef ? { rich: steps.body.rich } : {}) }
      : null;

    // ★ 2026-10-23 단계 요청 = 한줄 CT 요리 주문 하나(설계서 docs/2026-10-23-oneline-ct-complete-design.md A2 · A3).
    //   돈 순서는 runLineCookOrder 가 소유한다 · 여기는 만들기 · 응답만 · 옛 템플릿 4종 id = 400(열린 옛 탭).
    if (steps) {
      if (!stepsPayload || !attemptToken) return res.status(400).json({ success: false, error: '단계에서 받은 답을 다시 확인해 주세요.', code: 'LINE_STEPS_INVALID' });
      if (tplSel && !compDef) return res.status(400).json({ success: false, error: '고른 모양을 지금은 쓸 수 없어요. 화면을 새로 고친 뒤 구성을 다시 골라 주세요.', code: 'LINE_TEMPLATE_RETIRED' });
      const lineActor = await resolveIntegrationActor(req.user);
      const kitRaw = (await getCompanyBrandKitRaw(auth.companyId).catch(() => null)) as Record<string, unknown> | null;
      const brand = compDef ? await lineTemplateBrand(auth.companyId, kitRaw) : null;
      const compManual = compDef ? lineCookManual(steps.body.manual, steps.body.rich.categories) : null;
      const order = await runLineCookOrder({
        companyId: auth.companyId, userId: auth.userId, channel: 'email', steps, payload: stepsPayload,
        attemptLockKey: oneLineInflightKey(auth.companyId, 'email', attemptToken),
        products: lineProducts, actor: lineActor, pageCheck: !!compDef, nowMs: stepsNow,
        cook: async ({ cards, page }) => {
          if (compDef) {
            // ★ 2026-10-22 구성 = 한줄 CT 요리(문구 AI 1회 · 묶음 안 · 값 = 코드) · 상품 · 사진 · 주소는 구성 조립이 놓는다(1017 끼우기 · 몰 이름 첨부 0)
            const tplCards: LineMallCard[] = [...cards, ...compManual!.cards];
            const delivery = await resolveLineStepsDelivery(auth.companyId, lineActor, steps, { channel: 'email', line: linePrompt, cards: tplCards, companyKitRaw: kitRaw });
            const cook = await draftLineCook({
              composition: compDef, channel: 'email', companyId: auth.companyId, line: linePrompt, ...brand!,
              pinnedPrimary: linePinnedPrimary(kitRaw), cards: tplCards, cardCategories: [...cards.map(() => null), ...compManual!.categories],
              heroUpload: steps.hero, heroAsIs: steps.heroAsIs, proof: steps.body.proof, page,
              benefitAnswer: steps.body.facts.benefit, periodEnd: steps.body.facts.periodEnd ?? null, link: steps.body.facts.link ?? page?.url ?? delivery.link ?? null, rich: steps.body.rich,
            }, { userId: auth.userId, source: 'email-ai-generate' });
            const r = buildLineCookEmail(cook);
            // 제목 앞에 사람이 확인한 혜택 원문(40자 안일 때만 · 템플릿과 같은 규칙)
            const benefit = String(cook.materials.benefit || '').trim();
            const withBenefit = benefit ? `[${benefit}] ${r.subject}`.trim() : r.subject;
            return { kind: 'comp' as const, em: { ...r, subject: withBenefit.length <= 40 ? withBenefit : r.subject }, primary: cook.comp.primary, label: compDef.label, id: compDef.id as string };
          }
          const result = await generateEmailSections({ companyId: auth.companyId, userId: auth.userId, prompt: genPrompt, scenario, isAd, eventText });
          // ★ 2026-10-17 확정 카드 = 몰 상품(재조회 ok) + 직접 넣은 상품(사진 + 가격)
          const allCards: LineMallCard[] = [...cards, ...steps.manualCards];
          if (lineProducts === undefined) {
            // ★ 2026-07-08 연동 몰 상품 자동 첨부 — 상품 슬라이드 항목명 이름매칭 → 이미지·링크·정가·할인가(빈 값만, 실패 skip). 발송 코어 무관(생성 결과 후처리).
            try { await attachMallImagesToProductCarousels(auth.companyId, (result as any)?.sections, lineActor); } catch { /* best-effort */ }
          } else if (allCards.length > 0 && Array.isArray((result as any)?.sections)) {
            // ★ 2026-10-10 확정 카드 = 첫 상품 슬라이드 통째 교체 · 다른 상품 슬라이드 제거(AI 가 쓴 상품 · 가격이 나가지 않게) · 없으면 히어로 뒤
            (result as any).sections = placeLineMallCards((result as any).sections, allCards, { newId: () => randomUUID(), makeCarousel: (order) => createSection('product_carousel', randomUUID(), order) });
          }
          // ★ 2026-10-17 대표 사진(메일 맨 위 · 직접 올린 사진만 · 몰 사진은 외부 주소라 쓰지 않는다) · 버튼 주소(생성기가 늘 비운다 → 코드가 채운다)
          let stepsHero = false;
          if (Array.isArray((result as any)?.sections)) {
            const delivery = await resolveLineStepsDelivery(auth.companyId, lineActor, steps, { channel: 'email', line: linePrompt, cards: allCards });
            (result as any).sections = placeLineLink(placeLineHero((result as any).sections, delivery.hero, (order) => createSection('hero', randomUUID(), order)), delivery.link);
            stepsHero = !!delivery.hero;
          }
          return { kind: 'generic' as const, result, stepsHero };
        },
        adapter: { kind: 'return' },
      });
      if (order.kind === 'refused') return res.status(order.status).json({ success: false, error: order.error, code: order.code, ...(order.extra || {}) });
      if (order.kind !== 'made') return res.status(409).json({ success: false, error: '이 요청은 이미 처리됐어요. 다시 만들려면 [만들기]를 한 번 더 눌러 주세요.', code: 'ALREADY_DONE' });
      const made = order.result;
      // ★ 2026-10-24 ② 결과 안내 = 뺀 상품 · 값 차이 · 뺀 효능(서버 문장)
      const effNote = made.kind === 'generic' ? efficacyNote('generate', made.result.efficacyDropped) : null;
      const notes = [...order.excluded.map((e) => `상품${e.name ? ` "${e.name}"` : ''} 제외: ${e.reason}`), ...linePriceNotes(genPrompt, order.cards), ...(effNote ? [effNote] : [])];
      const basic = await getBrandBasicInfo(auth.companyId).catch(() => null);
      const industry = String((basic as any)?.industry_code || '').trim() || null;
      if (made.kind === 'comp') {
        console.log(`[one-line steps] email company=${auth.companyId} cost=${order.cost} completion=${order.completionDue} shown=${steps.body.meta.shown.join(',')} answered=${steps.body.meta.answered.join(',')} skipped=${steps.body.meta.skipped.join(',')} manual_cards=${compManual!.cards.length} hero=${steps.hero ? 1 : 0} template=${made.id} page=${steps.body.page ? 1 : 0}`);
        const tplDesign = lineEmailDesign({ pinned: made.primary, companyArtDirection: kitRaw?.art_direction ?? null, industry, preheader: made.em.preheader.slice(0, 90) });
        return res.json({
          success: true,
          data: {
            sections: made.em.sections, subjects: [made.em.subject], preheader: made.em.preheader,
            name: (brand!.brandName ? `${brand!.brandName} ${made.label}` : made.label).slice(0, 40),
            ...(tplDesign ? { design: tplDesign } : {}),
            one_line: {
              enabled: true, gaps: listenLine(linePrompt).gaps, notes, mall_cards: order.cards.length,
              steps: { cost: order.cost, completion: order.completionDue },
              template: { id: made.id, layout: 'page' },
            },
          },
        });
      }
      console.log(`[one-line steps] email company=${auth.companyId} cost=${order.cost} completion=${order.completionDue} shown=${steps.body.meta.shown.join(',')} answered=${steps.body.meta.answered.join(',')} skipped=${steps.body.meta.skipped.join(',')} manual_cards=${steps.manualCards.length} hero=${made.stepsHero ? 1 : 0}`);
      // ★ 2026-10-10 회사 디자인(저장 주색 · 회사 또는 업종 아트디렉션 · 프리헤더) · 결과 안내(뺀 상품 · 한 줄 값과 몰 값이 다를 때)
      const design = lineEmailDesign({
        pinned: linePinnedPrimary(kitRaw),
        companyArtDirection: kitRaw?.art_direction ?? null,
        industry,
        preheader: typeof (made.result as any)?.preheader === 'string' ? String((made.result as any).preheader).slice(0, 90) : null,
      });
      const { efficacyDropped: _effDropped, ...madeEmail } = made.result;
      return res.json({
        success: true,
        data: {
          ...madeEmail,
          ...(design ? { design } : {}),
          one_line: { enabled: true, gaps: listenLine(linePrompt).gaps, notes, mall_cards: order.cards.length, steps: { cost: order.cost, completion: order.completionDue } },
        },
      });
    }

    // ─── 아래 = 한 줄이 아닌 일반 생성(빠른 시작 · 행사 원문 · 편집기 요청) ───
    // ★ 2026-10-24 ⑧ — 옛 한 줄 갈래(시도 토큰 멱등 · 고른 몰 상품 재조회 · 한 줄 디자인)는 위에서 400 으로 닫혀 여기 오지 않는다 → 그 코드를 지웠다.
    //   돈 순서는 지금 그대로(잔액 확인 → 만들기 → 차감).
    const cost = getCreditCost('email-ai-generate'); // 3
    await checkCredit(auth.companyId, cost);
    const result = await generateEmailSections({ companyId: auth.companyId, userId: auth.userId, prompt: genPrompt, scenario, isAd, eventText });
    await settleCreditAfterSuccess({ companyId: auth.companyId, cost, source: 'email-ai-generate', createdBy: auth.userId, idempotencyKey: `email-ai-generate:${randomUUID()}` });
    // ★ 2026-07-08 연동 몰 상품 자동 첨부 — 상품 슬라이드 항목명 이름매칭 → 이미지·링크·정가·할인가(빈 값만, 실패 skip). 발송 코어 무관(생성 결과 후처리).
    try { await attachMallImagesToProductCarousels(auth.companyId, (result as any)?.sections, await resolveIntegrationActor(req.user)); } catch { /* best-effort */ }
    // ★ 2026-10-24 ② 결과 안내(서버 문장 · 근거 없는 효능을 뺀 수)
    const { efficacyDropped, ...emailOut } = result;
    const effNote = efficacyNote('generate', efficacyDropped);
    return res.json({ success: true, data: { ...emailOut, ...(effNote ? { notes: [effNote] } : {}) } });
  } catch (err: any) {
    // ★ 2026-10-17 템플릿 생성 실패 = 정해 둔 상태 · 문장(차감 전 · 영어 코드 노출 0)
    if (err instanceof LineTemplateError) {
      console.error(`[Email template] ${err.code} ${err.detail}`);
      return res.status(err.status).json({ success: false, error: err.message, code: err.code, ...(err.missing.length > 0 ? { missing: err.missing } : {}) });
    }
    console.error('[Email /ai/generate-sections] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (respondUserError(res, err)) return;
    return res.status(500).json({ success: false, error: publicErrorText(err, 'AI 비주얼 생성 실패') });
  }
}));

// 비주얼 에디터 실시간 미리보기 — sections → 이메일 HTML (크레딧·저장 없음).
router.post('/render-preview', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const brandKit = await getCompanyBrandKit(auth.companyId);
    // ★ 2026-07-13 디자인 3.0 — 편집기 design 동승 렌더(편집 화면 = 발송물)
    const design = normalizeEmailDesign(req.body?.design);
    // 샘플 고객 동봉 시 수신자별 개인화(변수 치환 + 조건부 표시) 후 렌더 — 미리보기 전용(발송·저장 무관).
    const sampleCustomer = req.body?.sampleCustomer && typeof req.body.sampleCustomer === 'object' ? req.body.sampleCustomer : null;
    const renderSections = sampleCustomer
      ? resolveEmailSectionsForCustomer(sections as Section[], sampleCustomer)
      : (sections as Section[]);
    const html = renderEmailSections(renderSections, { brandKit, design, publicBase: process.env.PUBLIC_BASE_URL });
    // ★ 2026-09-16 (임은지 접수 cmu3m2hey03nsjnludt2b1zv6) "수신거부 링크 표시를 켜고 꺼도 달라지는 게 없다" —
    //   이메일 수신거부는 편집기가 아니라 발송 엔진이 소유한다: 광고성이면 정보통신망법 §50④ footer가
    //   항상 자동으로 붙고 비광고성이면 안 붙는다(사람이 끌 수 있는 값이 아니라 토글은 감췄다).
    //   그래서 미리보기가 **실제로 붙을 문구 그대로**를 보여 준다 — 그러면 "무엇이 어디에 붙는지"가 보이고,
    //   법정 문구를 못 보는 채로 발송하는 일이 없어진다.
    // ⛔ 여기서 채우는 것은 **응답 HTML뿐**이다(저장·발송 HTML 무관 — 슬롯은 그 경로에서 그대로 치환된다).
    // ⛔ 수신거부 href 는 마커가 아니라 자리 표시(`#`)다. 마커를 넣으면 hasUnsubLink 판정이 참이 되어
    //   실제 발송에서 법정 footer가 통째로 생략된다(전송자 명칭·연락처까지 사라진다).
    // 저장된 캠페인이면 **그 캠페인이 실제로 쓸 발신자**로 문구를 만든다(회사·소유자 격리는 조회 함수가 한다).
    //   신규 작성 중(id 없음)이면 생성 경로와 같은 기본값 규칙을 따른다.
    const previewCampaignId = typeof req.body?.campaign_id === 'string' ? req.body.campaign_id : '';
    const previewCampaign = previewCampaignId
      ? await getEmailCampaign(auth.companyId, previewCampaignId, auth.ownerId)
      : null;
    const previewHtml = await withEmailPreviewAdFooter(html, auth.companyId, req.body?.is_ad !== false, previewCampaign);
    return res.json({ success: true, html: previewHtml });
  } catch (err: any) {
    console.error('[Email /render-preview] 오류:', err);
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '미리보기 렌더 실패') });
  }
});

// 미리보기용 샘플 고객 3건(VIP/일반/신규) — 개인화 미리보기 토글. 회사 격리(inapp CT 재사용).
router.get('/preview-customers', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const customers = await buildPreviewCustomers(auth.companyId, auth.ownerId);
    return res.json({ success: true, customers });
  } catch (err: any) {
    console.error('[Email /preview-customers] 오류:', err);
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '샘플 고객 조회 실패') });
  }
});

// 분석 대시보드 — 계정 성과 집계(읽기 전용·무과금·회사 격리). 신규 컬럼 0(전부 기존 컬럼).
router.get('/analytics', async (req: Request, res: Response) => {
  // 회사 전체 이메일 집계 = 관리자 조회 영역 (담당자는 본인 캠페인 이력=events/non-openers로 확인)
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
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '분석 조회 실패') });
  }
});

// 분석 대시보드 — AI 종합 진단(on-demand 5크레딧). 집계 실측만 근거·임의 혜택 0. 발송 데이터 0이면 무과금.
router.post('/ai/account-insight', async (req: Request, res: Response) => {
  // 회사 전체 계정 인사이트 = 관리자 조회 영역
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
    await settleCreditAfterSuccess({ companyId: auth.companyId, cost, source: 'email-performance-insight', createdBy: auth.userId, idempotencyKey: `email-performance-insight:${randomUUID()}` });
    return res.json({ success: true, insight });
  } catch (err: any) {
    console.error('[Email /ai/account-insight] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (respondUserError(res, err)) return;
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: publicErrorText(err, 'AI 진단 실패') });
  }
});

router.post('/ai/refine', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const subject = String(req.body?.subject || '').trim();
    const htmlBody = String(req.body?.html_body || '').trim();
    const instruction = String(req.body?.instruction || '').trim();
    if (!subject || !htmlBody || !instruction) {
      return res.status(400).json({ success: false, error: '제목 · 내용 · 다듬을 방향을 모두 넣어 주세요.' });
    }
    const cost = getCreditCost('email-refine'); // 1
    await checkCredit(auth.companyId, cost);
    const result = await refineEmail({ companyId: auth.companyId, userId: auth.userId, subject, htmlBody, instruction });
    // ★ 2026-10-25 #87 — 블록 다듬기와 같은 규칙: 제목 · 본문이 실제로 바뀐 때만 1크레딧(옛: 바뀐 것이 없어도 걷었다)
    const changed = result.subject !== subject || result.htmlBody !== htmlBody;
    if (changed) {
      await settleCreditAfterSuccess({ companyId: auth.companyId, cost, source: 'email-refine', createdBy: auth.userId, idempotencyKey: `email-refine:${randomUUID()}` });
    }
    return res.json({ success: true, data: result, changed });
  } catch (err: any) {
    console.error('[Email /ai/refine] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (respondUserError(res, err)) return;
    return res.status(500).json({ success: false, error: publicErrorText(err, 'AI 다듬기 실패') });
  }
});

// 비주얼 에디터 "AI로 개선" — 블록 카피만 다듬어 Section[] 반환(사실·혜택·변수 보존). 다듬을 텍스트 0이면 무차감.
router.post('/ai/refine-sections', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
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
      await settleCreditAfterSuccess({ companyId: auth.companyId, cost, source: 'email-refine', createdBy: auth.userId, idempotencyKey: `email-refine:${randomUUID()}` });
    }
    // ★ 2026-10-24 ② 원래 글로 둔 조각 수 = 서버 문장(화면은 그대로 그린다)
    const note = efficacyNote('rewrite', result.rejected);
    return res.json({ success: true, data: { sections: result.sections }, changed: result.changed, ...(note ? { notes: [note] } : {}) });
  } catch (err: any) {
    console.error('[Email /ai/refine-sections] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (respondUserError(res, err)) return;
    return res.status(500).json({ success: false, error: publicErrorText(err, 'AI 개선 실패') });
  }
});

router.post('/ai/precheck', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const campaign = await getEmailCampaign(auth.companyId, String(req.body?.campaign_id || ''), auth.ownerId);
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
    await settleCreditAfterSuccess({ companyId: auth.companyId, cost, source: 'email-precheck', createdBy: auth.userId, idempotencyKey: `email-precheck:${randomUUID()}` });
    return res.json({ success: true, codeChecks, spamRisk });
  } catch (err: any) {
    console.error('[Email /ai/precheck] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (respondUserError(res, err)) return;
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: publicErrorText(err, '발송 전 진단 실패') });
  }
});

router.post('/ai/insight', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const campaign = await getEmailCampaign(auth.companyId, String(req.body?.campaign_id || ''), auth.ownerId);
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
    await settleCreditAfterSuccess({ companyId: auth.companyId, cost, source: 'email-performance-insight', createdBy: auth.userId, idempotencyKey: `email-performance-insight:${randomUUID()}` });
    return res.json({ success: true, stats, insight });
  } catch (err: any) {
    console.error('[Email /ai/insight] 오류:', err);
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    if (respondUserError(res, err)) return;
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    return res.status(500).json({ success: false, error: publicErrorText(err, '성과 진단 실패') });
  }
});

// ════════════════════════════════════════════════════════════════════
// 미오픈자 SMS 크로스 채널 — delivered 있고 open 없는 수신자 → phone 매칭 (AI 호출 0 = 차감 0)
// ════════════════════════════════════════════════════════════════════

router.get('/campaigns/:id/non-openers', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const campaign = await getEmailCampaign(companyId, req.params.id, resolveOwnerScope(req));
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
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '미오픈자 조회 실패') });
  }
});

// ★ 2026-07-06 미수신자 재발송 — 미오픈자에게 같은 콘텐츠를 이메일로 다시 발송(무료).
//   자식 캠페인 1건 생성(원본 통계 무손상) + 재발송 1회 한도 + 발신 도메인 평판 보호. 완성 크레딧 재부과 없음(콘텐츠 재사용).
router.post('/campaigns/:id/resend-non-openers', async (req: Request, res: Response) => {
  const auth = await ensureEmailAccess(req, res);
  if (!auth) return;
  try {
    const parent = await getEmailCampaign(auth.companyId, req.params.id, auth.ownerId);
    if (!parent) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    if (parent.status !== 'completed' || parent.sentCount <= 0) {
      return res.status(400).json({ success: false, error: '발송 완료된 캠페인만 재발송할 수 있습니다.' });
    }
    // 재발송 세대 한도 1회 — 재발송본 재발송 차단 + 원본당 1회
    if (parent.resendGeneration > 0) {
      return res.status(400).json({ success: false, error: '재발송본은 다시 재발송할 수 없습니다.', code: 'RESEND_LIMIT' });
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
    // ★ 2026-07-12 재발송 제목에 미입력 자리 유입 차단 — 엔진 가드(sendEmailCampaign)가 최종 방어선이나 즉시 안내가 낫다
    // ★ 2026-10-24 세 채널 구조체크 ⑥ · Codex 1R — 보낼 모습(최종 제목 + 원본 본문)을 엔진과 같은 잠금(채울 자리 + 링크 결함)으로 자식 생성 **앞**에서 본다.
    //   옛: 제목만 봐서 원본 본문(완료 뒤 PATCH)의 깨진 링크는 자식을 만든 뒤 엔진에서 실패했고, 실패한 자식이 재발송 1회 한도를 써 버렸다.
    const resendBlock = emailContentBlocker({
      subject: subjectOverride && subjectOverride.trim() ? subjectOverride.trim() : parent.subject,
      htmlBody: parent.htmlBody, textBody: parent.textBody,
    });
    if (resendBlock) return res.status(resendBlock.status).json({ success: false, error: resendBlock.error, code: resendBlock.code });
    // 자식 캠페인 생성(콘텐츠 재사용 = 무료, 완성 게이트 우회하도록 sendEmailCampaign 직접 호출)
    // ★ 2026-09-27 한줄로 V2 R123 — 원본당 1회 검사와 자식 생성을 **원본 단위 잠금** 안에서 한다. 옛: 동시 요청 둘이 함께 0건을 보고
    //   자식을 둘 만들어 미오픈자에게 같은 메일이 두 번 나갔다(단일 프로세스 기동 · keyed-lock CT).
    const child = await withKeyedLock('email-resend', parent.id, async () => {
      if ((await countResendChildren(auth.companyId, parent.id)) > 0) return null;
      return createResendChildCampaign(parent, auth.userId, subjectOverride);
    });
    if (!child) {
      return res.status(400).json({ success: false, error: '이미 재발송한 캠페인입니다 (재발송 1회 한도, 발신 도메인 평판 보호).', code: 'RESEND_LIMIT' });
    }
    // 즉시 발송 — status='sending' 선점 후 응답, 실제 SMTP 루프는 백그라운드(타임아웃 차단)
    await query(
      `UPDATE email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
      [child.id, auth.companyId],
    );
    setImmediate(() => {
      sendEmailCampaign({ campaignId: child.id, recipients, immediate: true })
        .catch(async (e: any) => {
          console.error(`[Email /resend-non-openers] 백그라운드 발송 실패 (child ${child.id}):`, e?.message);
          try {
            await query(
              `UPDATE email_campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1::uuid AND status = 'sending'`,
              [child.id],
            );
          } catch { /* sweeper 정체 복구가 후위 안전망 */ }
        });
    });
    return res.json({ success: true, queued: true, childId: child.id, total: recipients.length });
  } catch (err: any) {
    console.error('[Email /campaigns/:id/resend-non-openers] 오류:', err);
    if (handleDbMigrationError(err, res, 'email_campaigns')) return;
    if (handleEncryptionKeyError(err, res)) return;
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: publicErrorText(err, '재발송 실패') });
  }
});

export default router;
