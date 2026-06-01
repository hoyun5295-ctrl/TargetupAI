/**
 * ★ 네이버 스마트스토어 (커머스 API) OAuth + Webhook receiver — D178 (2026-05-19)
 *
 * Endpoint:
 *   - GET  /api/naver-commerce/oauth/authorize  : authorize URL 생성 (회사 admin 인증)
 *   - GET  /api/naver-commerce/oauth/callback   : OAuth callback (별도 라우터, authenticate 우회)
 *   - GET  /api/naver-commerce/status           : 현재 회사 네이버 스마트스토어 연동 상태
 *   - DELETE /api/naver-commerce/disconnect     : 연동 해제
 *   - POST /api/naver-commerce/webhook          : 네이버 표준 webhook 수신 (HMAC-SHA256 서명 + idempotency_key)
 *
 * 보안:
 *   - authorize/callback/status/disconnect: 회사 admin 인증
 *   - webhook: X-Naver-Signature 서명 검증 (webhook_secret 박힘 시)
 *
 * idempotency:
 *   - cdp_webhook_deliveries (company_id, source='naver_smart_store', idempotency_key) 중복 차단
 */

import { Router, Request, Response, json } from 'express';
import { randomBytes } from 'crypto';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';
import {
  buildNaverCommerceAuthorizeUrl,
  exchangeNaverCommerceCode,
  saveNaverCommerceIntegration,
  getNaverCommerceIntegration,
  getNaverCommerceIntegrationByStoreId,
  verifyNaverCommerceWebhookSignature,
  naverSmartStoreAdapter,
} from '../utils/naver-commerce-client';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';

const router = Router();

// ════════════════════════════════════════════════════════════════════
// Webhook receiver (인증 미들웨어 전 — 서명 + idempotency_key로 자체 검증)
// ════════════════════════════════════════════════════════════════════

router.post(
  '/webhook',
  json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }),
  async (req: Request, res: Response) => {
    try {
      const event = (req.headers['x-naver-event']) as string | undefined;
      const signature = (req.headers['x-naver-signature']) as string | undefined;
      const storeId = (req.headers['x-naver-store-id'] || req.body?.store_id || req.body?.resource?.store_id) as string | undefined;

      if (!event || !storeId) {
        return res.status(400).json({ success: false, error: 'X-Naver-Event 또는 store_id가 누락되었습니다.' });
      }

      const integration = await getNaverCommerceIntegrationByStoreId(String(storeId));
      if (!integration) {
        console.warn('[NaverCommerce Webhook] 미연동 store_id, 무시:', storeId);
        return res.status(404).json({ success: false, error: '연동된 store_id가 없습니다.' });
      }

      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const isValid = verifyNaverCommerceWebhookSignature(rawBody, signature || '', integration.webhookSecret);
      if (!isValid) {
        console.warn('[NaverCommerce Webhook] 서명 검증 실패, store=', storeId);
        return res.status(401).json({ success: false, error: '서명 검증에 실패했습니다.' });
      }

      const resource = req.body?.resource || req.body || {};
      const idempotencyKey = naverSmartStoreAdapter.buildIdempotencyKey(event, resource, req.body || {});

      const insertRes = await query(
        `INSERT INTO cdp_webhook_deliveries (
          id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, created_at
        ) VALUES (
          gen_random_uuid(), $1::uuid, 'naver_smart_store', $2, $3, $4::jsonb, 'received', 0, NOW()
        )
        ON CONFLICT (company_id, source, idempotency_key) DO NOTHING
        RETURNING id`,
        [integration.companyId, event, idempotencyKey, JSON.stringify(req.body || {})]
      );

      if (insertRes.rows.length === 0) {
        await query(
          `UPDATE cdp_webhook_deliveries
           SET status = 'duplicate', processed_at = NOW(), updated_at = NOW()
           WHERE company_id = $1::uuid AND source = 'naver_smart_store' AND idempotency_key = $2`,
          [integration.companyId, idempotencyKey]
        );
        return res.json({ success: true, duplicate: true });
      }

      const deliveryId = insertRes.rows[0].id;

      try {
        await naverSmartStoreAdapter.processWebhookEvent(integration.companyId, event, resource);
        await query(
          `UPDATE cdp_webhook_deliveries SET status = 'processed', processed_at = NOW() WHERE id = $1::uuid`,
          [deliveryId]
        );
        return res.json({ success: true });
      } catch (processErr: any) {
        console.error('[NaverCommerce Webhook] 이벤트 처리 실패:', processErr);
        await query(
          `UPDATE cdp_webhook_deliveries
           SET status = 'failed', error_message = $2, processed_at = NOW()
           WHERE id = $1::uuid`,
          [deliveryId, String(processErr?.message || 'unknown').slice(0, 1000)]
        );
        return res.json({ success: false, error: '이벤트 처리 실패' });
      }
    } catch (err: any) {
      console.error('[NaverCommerce Webhook] 오류:', err);
      return res.status(500).json({ success: false, error: err?.message || 'webhook 처리 실패' });
    }
  }
);

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
      return res.status(403).json({ success: false, error: '네이버 스마트스토어 연동은 회사 관리자만 가능합니다.' });
    }
    const cdpEnabled = await isCdpEnabledForPlan(companyId);
    if (!cdpEnabled) {
      return res.status(403).json({
        success: false,
        error: '네이버 스마트스토어 연동은 유료 요금제 가입 후 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED',
      });
    }

    const storeId = String(req.query.store_id || '').trim();
    if (!storeId) {
      return res.status(400).json({ success: false, error: 'store_id는 필수입니다.' });
    }

    const csrfNonce = randomBytes(16).toString('hex');
    await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'naver_smart_store', 'oauth_state', $2, $3::jsonb, 'received', NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        created_at = NOW()`,
      [companyId, `state:${csrfNonce}`, JSON.stringify({ store_id: storeId, nonce: csrfNonce })]
    );

    const state = Buffer.from(JSON.stringify({ company_id: companyId, nonce: csrfNonce, ts: Date.now() })).toString('base64url');
    const authorizeUrl = buildNaverCommerceAuthorizeUrl(storeId, state);
    return res.json({ success: true, authorize_url: authorizeUrl });
  } catch (err: any) {
    console.error('[NaverCommerce /oauth/authorize] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'authorize URL 생성 실패' });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const integration = await getNaverCommerceIntegration(companyId);
    if (!integration) return res.json({ success: true, connected: false });
    return res.json({
      success: true,
      connected: true,
      store_id: integration.storeId,
      status: integration.status,
      token_expires_at: integration.tokenExpiresAt,
      scope: integration.scope,
    });
  } catch (err: any) {
    console.error('[NaverCommerce /status] 오류:', err);
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
    await query(
      `UPDATE company_integrations
       SET status = 'revoked', updated_at = NOW()
       WHERE company_id = $1::uuid AND provider = 'naver_smart_store'`,
      [companyId]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[NaverCommerce /disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '연동 해제 실패' });
  }
});

export default router;

// ════════════════════════════════════════════════════════════════════
// 별도 callback 라우터 (authenticate 우회)
// ════════════════════════════════════════════════════════════════════

export const naverCommerceCallbackRouter = Router();

naverCommerceCallbackRouter.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code || '');
    const stateRaw = String(req.query.state || '');
    if (!code || !stateRaw) {
      return res.status(400).send(renderCallbackHtml('error', '네이버가 보낸 응답에 code 또는 state가 누락되었습니다.'));
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
       WHERE company_id = $1::uuid AND source = 'naver_smart_store'
         AND webhook_event = 'oauth_state' AND idempotency_key = $2 LIMIT 1`,
      [parsed.company_id, `state:${parsed.nonce}`]
    );
    if (stateRow.rows.length === 0) {
      return res.status(400).send(renderCallbackHtml('error', 'state 검증 실패 (재시도 또는 변조 의심).'));
    }
    const payload = stateRow.rows[0].payload as { store_id?: string };
    const storeId = payload?.store_id;
    if (!storeId) {
      return res.status(400).send(renderCallbackHtml('error', 'state에 store_id가 누락되었습니다.'));
    }

    const tokenRes = await exchangeNaverCommerceCode(code);
    await saveNaverCommerceIntegration(parsed.company_id, storeId, tokenRes);

    await query(
      `DELETE FROM cdp_webhook_deliveries
       WHERE company_id = $1::uuid AND source = 'naver_smart_store'
         AND webhook_event = 'oauth_state' AND idempotency_key = $2`,
      [parsed.company_id, `state:${parsed.nonce}`]
    );

    return res.send(renderCallbackHtml('ok', `${storeId} 네이버 스마트스토어 연동이 완료되었습니다. 본 창을 닫고 한줄로AI로 돌아가주세요.`));
  } catch (err: any) {
    console.error('[NaverCommerce callback] 오류:', err);
    return res.status(500).send(renderCallbackHtml('error', err?.message || '네이버 스마트스토어 연동 처리 중 오류가 발생했습니다.'));
  }
});

function renderCallbackHtml(status: 'ok' | 'error', message: string): string {
  const color = status === 'ok' ? '#059669' : '#dc2626';
  const icon = status === 'ok' ? '✓' : '✕';
  const title = status === 'ok' ? '네이버 스마트스토어 연동 완료' : '네이버 스마트스토어 연동 실패';
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
