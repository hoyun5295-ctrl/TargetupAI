/**
 * ★ 아임웹(imweb) OAuth + Webhook receiver — 2026-07-04
 *
 * Endpoint:
 *   - GET    /api/imweb/oauth/authorize  : authorize URL 생성 (회사 admin 인증, siteCode 입력)
 *   - GET    /api/imweb/oauth/callback   : OAuth callback (별도 라우터, authenticate 우회) → 토큰 저장 + 연동완료처리
 *   - GET    /api/imweb/status           : 현재 회사 아임웹 연동 상태
 *   - DELETE /api/imweb/disconnect       : 연동 해제(아임웹 integration-cancellation 동반)
 *   - POST   /api/imweb/webhook          : 아임웹 webhook 수신 (공유 토큰 헤더 검증 + idempotency_key)
 *
 * imweb 고유:
 *   - 단일 공식 앱(env 자격) — BYO 없음. siteCode = 몰 식별자(mall_id).
 *   - callback에서 반드시 integration-complete 호출('연동중'→'연동완료', 안 하면 다른 API 차단). 6원칙② 실효 검증.
 *   - webhook 인증 = 공유 토큰(IMWEB_WEBHOOK_SECRET)을 헤더로 전달(HMAC 아님).
 */

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';
import { deliverWebhookToCompanies, extractWebhookResource } from '../utils/cdp-webhook-delivery';
import {
  buildImwebAuthorizeUrl,
  exchangeImwebCode,
  saveImwebIntegration,
  getImwebIntegration,
  getImwebIntegrationsBySiteCode,
  completeImwebIntegration,
  cancelImwebIntegration,
  verifyImwebWebhook,
  imwebAdapter,
} from '../utils/imweb-client';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';

import { publicErrorText, respondUserError, UserFacingError } from '../utils/http-error';
import { stashPendingApproval, confirmPendingApproval, approvalConfirmUrl } from '../utils/oauth-pending';   // ★1028 M24
import { storeCodeForConnect } from '../utils/integration-scope';   // ★1028 N6 연결 분류코드
const router = Router();

// ════════════════════════════════════════════════════════════════════
// Webhook receiver (인증 전 — 공유 토큰 헤더 + idempotency_key 자체 검증)
//   전역 express.json() 뒤에 마운트되므로 req.body 정상. imweb은 rawBody 불필요(HMAC 아님).
// ════════════════════════════════════════════════════════════════════

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const event = imwebAdapter.extractEventFromWebhook(req.headers, req.body || {});
    const siteCode = imwebAdapter.extractMallIdFromWebhook(req.headers, req.body || {});
    if (!event || !siteCode) {
      return res.status(400).json({ success: false, error: 'imweb event 또는 siteCode가 누락되었습니다.' });
    }

    // 공유 토큰(헤더) 검증 — env IMWEB_WEBHOOK_SECRET 기준
    // ★ 2026-10-27 자사몰 대비 K2-5(SC3) — 인증을 연동 조회보다 먼저 본다(인증 실패 = 401 그대로 · 인증 통과 + 연동 없음 = 200).
    if (!verifyImwebWebhook(req.headers, null)) {
      console.warn('[Imweb Webhook] 인증 토큰 검증 실패, siteCode=', siteCode);
      return res.status(401).json({ success: false, error: '웹훅 인증에 실패했습니다.' });
    }

    // ★ 2026-09-27 한줄로 V2 R244 — 같은 사이트가 여러 회사에 연동돼 있으면 전부에게 전달한다(옛: LIMIT 1 임의 한 회사).
    const integrations = await getImwebIntegrationsBySiteCode(String(siteCode));
    if (integrations.length === 0) {
      // ★ 1027 — 시험 사이트를 지운 뒤 · 해제 뒤 404 실패가 쌓이면 몰 쪽이 웹훅을 끌 수 있어 카페24 와 같은 꼴(200 · 기록 0 · 로그 1줄)
      console.log('[Imweb Webhook] 미연동 siteCode — 인증된 요청이라 200 무시:', siteCode, 'event:', event);
      return res.json({ success: true, ignored: true });
    }

    const resource = extractWebhookResource('imweb', req.body || {});
    const idempotencyKey = imwebAdapter.buildIdempotencyKey(event, resource, req.body || {});

    // 기록 → 즉시 200 → 처리는 뒤(★ 1027 K2-5)
    const outcome = await deliverWebhookToCompanies({
      source: 'imweb',
      companyIds: integrations.map((i) => i.companyId),
      event,
      idempotencyKey,
      payload: req.body || {},
      mallId: String(siteCode),
      logTag: 'Imweb',
    });
    if (outcome.recorded === 0 && outcome.duplicate > 0) return res.json({ success: true, duplicate: true });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Imweb Webhook] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, 'webhook 처리 실패') });
  }
});

// ════════════════════════════════════════════════════════════════════
// 회사 admin 인증 endpoint
// ════════════════════════════════════════════════════════════════════

router.use(authenticate);

router.get('/oauth/authorize', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '아임웹 연동은 회사 관리자만 가능합니다.' });
    }
    const cdpEnabled = await isCdpEnabledForPlan(companyId);
    if (!cdpEnabled) {
      return res.status(403).json({
        success: false,
        error: '아임웹 연동은 유료 요금제 가입 후 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED',
      });
    }

    const siteCode = String(req.query.site_code || '').trim();
    if (!siteCode) {
      return res.status(400).json({ success: false, error: 'site_code는 필수입니다.' });
    }

    const storeCode = await storeCodeForConnect(req.user, req.query.store_code);   // ★1028 N6 분류코드(확정 때 그 값으로 저장)
    const csrfNonce = randomBytes(16).toString('hex');
    await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'imweb', 'oauth_state', $2, $3::jsonb, 'received', NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        created_at = NOW()`,
      [companyId, `state:${csrfNonce}`, JSON.stringify({ site_code: siteCode, nonce: csrfNonce, store_code: storeCode })]
    );

    const state = Buffer.from(JSON.stringify({ company_id: companyId, nonce: csrfNonce, ts: Date.now() })).toString('base64url');
    const authorizeUrl = buildImwebAuthorizeUrl(siteCode, state);
    return res.json({ success: true, authorize_url: authorizeUrl });
  } catch (err: any) {
    console.error('[Imweb /oauth/authorize] 오류:', err);
    if (respondUserError(res, err)) return;   // ★1028 N6 분류코드 거절(고객 문장)
    return res.status(500).json({ success: false, error: publicErrorText(err, 'authorize URL 생성 실패') });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const integration = await getImwebIntegration(companyId);
    if (!integration) return res.json({ success: true, connected: false });
    return res.json({
      success: true,
      connected: integration.status === 'active',
      site_code: integration.siteCode,
      status: integration.status,
      token_expires_at: integration.tokenExpiresAt,
      scope: integration.scope,
    });
  } catch (err: any) {
    console.error('[Imweb /status] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

/**
 * POST /api/imweb/oauth/confirm  body { confirm }
 * ★ 2026-10-28 자사몰 대비 M24 — 승인 콜백이 담아 둔 미확정 토큰을 로그인된 회사 관리자가 확정 → 저장 → 연동완료처리(이 호출이 성공해야 API 가 열린다 · 6원칙②).
 */
router.post('/oauth/confirm', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (req.user?.userType !== 'company_admin') return res.status(403).json({ success: false, error: '아임웹 연동은 회사 관리자만 가능합니다.' });
    // 승인 행 잠금 → 풀기 → 연동 저장 → 승인 행 지우기(한 트랜잭션 · 저장이 실패하면 승인 행이 남아 다시 확정할 수 있다)
    const done = await confirmPendingApproval(companyId, 'imweb', String(req.body?.confirm || ''), async (state, pending, run) => {
      const site = String(state.site_code || '');
      if (!site) throw new UserFacingError(400, 'OAUTH_CONFIRM_INVALID', '승인 상태가 올바르지 않아요. 자사몰 연동에서 다시 연결해 주세요.');
      await saveImwebIntegration(companyId, site, pending, undefined, typeof state.store_code === 'string' ? state.store_code : null, run);
      return site;
    });
    if (!done) return res.status(400).json({ success: false, error: '승인 확인 시간이 지났거나 이 계정이 시작한 연결이 아니에요. 자사몰 연동에서 다시 연결해 주세요.', code: 'OAUTH_CONFIRM_INVALID' });
    const siteCode = done.result;
    // 연동완료처리 = 저장이 확정된 뒤(실패해도 토큰은 남고 pending_complete 로 다시 시도)
    const integration = await getImwebIntegration(companyId, siteCode);
    let completeOk = false;
    if (integration) {
      try { await completeImwebIntegration(integration); completeOk = true; }
      catch (e: any) { console.error('[Imweb confirm] integration-complete 실패:', e); }
    }
    if (!completeOk) {
      await query(
        `UPDATE company_integrations SET status = 'pending_complete', updated_at = NOW()
         WHERE company_id = $1::uuid AND provider = 'imweb' AND mall_id = $2`,
        [companyId, siteCode]
      );
      return res.status(502).json({ success: false, error: '토큰은 발급됐으나 아임웹 연동완료처리에 실패했습니다. 잠시 후 다시 연동을 시도해주세요.' });
    }
    return res.json({ success: true, site_code: siteCode });
  } catch (err: any) {
    console.error('[Imweb /oauth/confirm] 오류:', err);
    if (respondUserError(res, err)) return;   // 분류코드 모드 거절(409 · 고객 문장)
    return res.status(500).json({ success: false, error: publicErrorText(err, '아임웹 연결 확정 실패') });
  }
});

router.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '연동 해제는 회사 관리자만 가능합니다.' });
    }
    // 아임웹 측 연동해제처리(best-effort) — 실패해도 우리 DB는 해제
    const integration = await getImwebIntegration(companyId);
    if (integration) {
      try { await cancelImwebIntegration(integration); }
      catch (e) { console.error('[Imweb /disconnect] integration-cancellation 실패(무시):', e); }
    }
    await query(
      `UPDATE company_integrations
       SET status = 'revoked', updated_at = NOW()
       WHERE company_id = $1::uuid AND provider = 'imweb'`,
      [companyId]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Imweb /disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '연동 해제 실패') });
  }
});

export default router;

// ════════════════════════════════════════════════════════════════════
// 별도 callback 라우터 (authenticate 우회 — 아임웹이 브라우저 redirect로 호출)
// ════════════════════════════════════════════════════════════════════

export const imwebCallbackRouter = Router();

imwebCallbackRouter.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code || '');
    const stateRaw = String(req.query.state || '');
    if (!code || !stateRaw) {
      return res.status(400).send(renderCallbackHtml('error', '아임웹이 보낸 응답에 code 또는 state가 누락되었습니다.'));
    }

    let parsed: { company_id?: string; nonce?: string; ts?: number };
    try {
      parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
    } catch {
      return res.status(400).send(renderCallbackHtml('error', 'state 검증 실패 (변조 의심).'));
    }
    if (!parsed.company_id || !parsed.nonce) {
      return res.status(400).send(renderCallbackHtml('error', 'state 형식이 올바르지 않습니다.'));
    }
    if (!parsed.ts || Date.now() - parsed.ts > 10 * 60 * 1000) {
      return res.status(400).send(renderCallbackHtml('error', 'OAuth 세션이 만료되었습니다. 다시 시도해주세요.'));
    }

    const stateRow = await query(
      `SELECT payload FROM cdp_webhook_deliveries
       WHERE company_id = $1::uuid AND source = 'imweb'
         AND webhook_event = 'oauth_state' AND idempotency_key = $2 LIMIT 1`,
      [parsed.company_id, `state:${parsed.nonce}`]
    );
    if (stateRow.rows.length === 0) {
      return res.status(400).send(renderCallbackHtml('error', 'state 검증 실패 (재시도 또는 변조 의심).'));
    }
    const payload = stateRow.rows[0].payload as { site_code?: string };
    const siteCode = payload?.site_code;
    if (!siteCode) {
      return res.status(400).send(renderCallbackHtml('error', 'state에 siteCode가 누락되었습니다.'));
    }

    // 인가코드 → 토큰
    const token = await exchangeImwebCode(code);

    // ★ 2026-10-28 자사몰 대비 M24 — 연동 행에 바로 넣지 않는다(콜백엔 로그인 정보가 없다 · 남이 시작한 승인 링크를 몰 주인이 누르면 그 몰이 남의 회사에 묶였다).
    //   미확정으로 담고(암호문 · 그 승인 행) 로그인된 화면으로 → 화면이 그 회사 관리자로 확정해야 저장 · 연동완료처리(POST /oauth/confirm).
    const confirm = await stashPendingApproval(parsed.company_id, 'imweb', parsed.nonce, token);
    return res.redirect(302, approvalConfirmUrl('imweb', confirm));
  } catch (err: any) {
    console.error('[Imweb callback] 오류:', err);
    return res.status(500).send(renderCallbackHtml('error', publicErrorText(err, '아임웹 연동 처리 중 오류가 발생했습니다.')));
  }
});

function renderCallbackHtml(status: 'ok' | 'error', message: string): string {
  const color = status === 'ok' ? '#059669' : '#dc2626';
  const icon = status === 'ok' ? '✓' : '✕';
  const title = status === 'ok' ? '아임웹 연동 완료' : '아임웹 연동 실패';
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>한줄로 · ${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 60px 20px; }
  .card { max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); text-align: center; }
  .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
  h1 { color: #111827; font-size: 20px; margin: 0 0 12px; }
  p { color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; }
  .footer { margin-top: 24px; font-size: 12px; color: #9ca3af; }
</style></head>
<body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1><p>${escapeHtml(message)}</p><div class="footer">본 창을 닫으시면 한줄로AI로 돌아가실 수 있습니다.</div></div></body></html>`;
}

function escapeHtml(str: string): string {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
