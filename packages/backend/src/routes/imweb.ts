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
import {
  buildImwebAuthorizeUrl,
  exchangeImwebCode,
  saveImwebIntegration,
  getImwebIntegration,
  getImwebIntegrationBySiteCode,
  completeImwebIntegration,
  cancelImwebIntegration,
  verifyImwebWebhook,
  imwebAdapter,
} from '../utils/imweb-client';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';

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

    const integration = await getImwebIntegrationBySiteCode(String(siteCode));
    if (!integration) {
      console.warn('[Imweb Webhook] 미연동 siteCode, 무시:', siteCode);
      return res.status(404).json({ success: false, error: '연동된 siteCode가 없습니다.' });
    }

    // 공유 토큰(헤더) 검증 — env IMWEB_WEBHOOK_SECRET 기준
    if (!verifyImwebWebhook(req.headers, null)) {
      console.warn('[Imweb Webhook] 인증 토큰 검증 실패, siteCode=', siteCode);
      return res.status(401).json({ success: false, error: '웹훅 인증에 실패했습니다.' });
    }

    const resource = req.body?.data || req.body?.resource || req.body || {};
    const idempotencyKey = imwebAdapter.buildIdempotencyKey(event, resource, req.body || {});

    const insertRes = await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'imweb', $2, $3, $4::jsonb, 'received', 0, NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO NOTHING
      RETURNING id`,
      [integration.companyId, event, idempotencyKey, JSON.stringify(req.body || {})]
    );

    if (insertRes.rows.length === 0) {
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'duplicate', processed_at = NOW()
         WHERE company_id = $1::uuid AND source = 'imweb' AND idempotency_key = $2`,
        [integration.companyId, idempotencyKey]
      );
      return res.json({ success: true, duplicate: true });
    }

    const deliveryId = insertRes.rows[0].id;
    try {
      await imwebAdapter.processWebhookEvent(integration.companyId, event, resource);
      await query(
        `UPDATE cdp_webhook_deliveries SET status = 'processed', processed_at = NOW() WHERE id = $1::uuid`,
        [deliveryId]
      );
      return res.json({ success: true });
    } catch (processErr: any) {
      console.error('[Imweb Webhook] 이벤트 처리 실패:', processErr);
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'failed', error_message = $2, processed_at = NOW()
         WHERE id = $1::uuid`,
        [deliveryId, String(processErr?.message || 'unknown').slice(0, 1000)]
      );
      return res.json({ success: false, error: '이벤트 처리 실패' });
    }
  } catch (err: any) {
    console.error('[Imweb Webhook] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'webhook 처리 실패' });
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
      [companyId, `state:${csrfNonce}`, JSON.stringify({ site_code: siteCode, nonce: csrfNonce })]
    );

    const state = Buffer.from(JSON.stringify({ company_id: companyId, nonce: csrfNonce, ts: Date.now() })).toString('base64url');
    const authorizeUrl = buildImwebAuthorizeUrl(siteCode, state);
    return res.json({ success: true, authorize_url: authorizeUrl });
  } catch (err: any) {
    console.error('[Imweb /oauth/authorize] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'authorize URL 생성 실패' });
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
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
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
    return res.status(500).json({ success: false, error: err?.message || '연동 해제 실패' });
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

    // 인가코드 → 토큰 → 저장
    const token = await exchangeImwebCode(code);
    await saveImwebIntegration(parsed.company_id, siteCode, token);

    // ★ 연동완료처리 — 이 호출이 성공해야 실제 API가 열린다(6원칙② 실효 검증)
    const integration = await getImwebIntegration(parsed.company_id, siteCode);
    let completeOk = false;
    if (integration) {
      try { await completeImwebIntegration(integration); completeOk = true; }
      catch (e: any) { console.error('[Imweb callback] integration-complete 실패:', e); }
    }

    // state 1회성 정리
    await query(
      `DELETE FROM cdp_webhook_deliveries
       WHERE company_id = $1::uuid AND source = 'imweb'
         AND webhook_event = 'oauth_state' AND idempotency_key = $2`,
      [parsed.company_id, `state:${parsed.nonce}`]
    );

    if (!completeOk) {
      await query(
        `UPDATE company_integrations SET status = 'pending_complete', updated_at = NOW()
         WHERE company_id = $1::uuid AND provider = 'imweb' AND mall_id = $2`,
        [parsed.company_id, siteCode]
      );
      return res.status(502).send(renderCallbackHtml('error', '토큰은 발급됐으나 아임웹 연동완료처리에 실패했습니다. 잠시 후 다시 연동을 시도해주세요.'));
    }

    return res.send(renderCallbackHtml('ok', `아임웹(${siteCode}) 연동이 완료되었습니다. 본 창을 닫고 한줄로AI로 돌아가주세요.`));
  } catch (err: any) {
    console.error('[Imweb callback] 오류:', err);
    return res.status(500).send(renderCallbackHtml('error', err?.message || '아임웹 연동 처리 중 오류가 발생했습니다.'));
  }
});

function renderCallbackHtml(status: 'ok' | 'error', message: string): string {
  const color = status === 'ok' ? '#059669' : '#dc2626';
  const icon = status === 'ok' ? '✓' : '✕';
  const title = status === 'ok' ? '아임웹 연동 완료' : '아임웹 연동 실패';
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>한줄로 — ${title}</title>
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
