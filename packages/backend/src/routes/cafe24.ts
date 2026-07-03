/**
 * ★ 카페24 OAuth + Webhook receiver — D172-B (2026-05-19)
 *
 * Endpoint:
 *   - GET  /api/cafe24/oauth/authorize  : authorize URL 생성 (회사 admin 인증)
 *   - GET  /api/cafe24/oauth/callback   : OAuth callback (카페24 → 한줄로, state 검증 후 토큰 교환)
 *   - GET  /api/cafe24/status           : 현재 회사 카페24 연동 상태 조회 (CdpSettingsPage)
 *   - DELETE /api/cafe24/disconnect     : 연동 해제 (token revoke + DB row status='revoked')
 *   - POST /api/cafe24/webhook          : 카페24 표준 webhook 수신 (idempotency_key + cdp-* CT 자동 호출)
 *
 * 보안:
 *   - authorize/callback/status/disconnect: 회사 admin 인증 (authenticate)
 *   - webhook: X-API-Key 인증(2026-07-03 실측 정정) + 구형 HMAC 하위 호환
 *
 * idempotency:
 *   - 모든 webhook은 cdp_webhook_deliveries 테이블의 (company_id, source, idempotency_key)로 중복 차단
 *   - idempotency_key = `${webhook_event}:${order_id || customer_id || timestamp}` 적용
 */

import { Router, Request, Response, json } from 'express';
import { randomBytes } from 'crypto';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';
import {
  buildCafe24AuthorizeUrl,
  exchangeCafe24Code,
  saveCafe24Integration,
  getCafe24Integration,
  getCafe24IntegrationByMallId,
  verifyCafe24WebhookSignature,
  verifyCafe24WebhookApiKey,
  cafe24Adapter,
  saveCafe24ByoCredentials,
  getCafe24ByoCredentials,
} from '../utils/cafe24-client';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';

const router = Router();

// ════════════════════════════════════════════════════════════════════
// Webhook receiver (인증 미들웨어 전 — 카페24 서명 + idempotency_key로 자체 검증)
// ════════════════════════════════════════════════════════════════════

/**
 * 카페24가 표준 webhook 발화 시점:
 *   - order.created / order.updated / order.cancelled
 *   - customer.created / customer.updated
 *   - product.created (Phase 2)
 *
 * Request body 표준 (카페24):
 *   {
 *     event_no: 12345,
 *     resource: { mall_id, order_id?, member_id?, ... }
 *   }
 */
router.post('/webhook', json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }), async (req: Request, res: Response) => {
  try {
    // ★ 2026-07-03 공식 문서 실측 정정 — 실제 형식: X-API-Key 헤더 인증 + 본문 { event_no, resource }.
    //   이벤트 식별: (구형 가정) X-Cafe24-Event 헤더 하위 호환 → body.event_no 매핑 (CT mapCafe24EventNo).
    const event = cafe24Adapter.extractEventFromWebhook(req.headers as any, req.body || {});
    const mallId = cafe24Adapter.extractMallIdFromWebhook(req.headers as any, req.body || {});

    if (!event || !mallId) {
      console.warn('[Cafe24 Webhook] event/mall_id 식별 실패 — event_no:', req.body?.event_no, 'mall_id:', mallId);
      return res.status(400).json({ success: false, error: 'event 또는 mall_id를 식별할 수 없습니다.' });
    }

    // 인증 — X-API-Key(실제 방식, .env CAFE24_WEBHOOK_API_KEY) 우선, 구형 HMAC 서명 하위 호환
    const apiKeyHeader = (req.headers['x-api-key'] || req.headers['X-API-Key']) as string | undefined;
    const apiKeyOk = verifyCafe24WebhookApiKey(apiKeyHeader);

    // 회사 식별 (mall_id → company_integrations)
    const integration = await getCafe24IntegrationByMallId(mallId);

    if (!apiKeyOk) {
      // 구형 HMAC 경로 — integration의 webhook_secret 필요
      const signature = (req.headers['x-cafe24-hmac-sha256'] || req.headers['X-Cafe24-Hmac-Sha256']) as string | undefined;
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const hmacOk = integration
        ? verifyCafe24WebhookSignature(rawBody, signature || '', integration.webhookSecret)
        : false;
      if (!hmacOk) {
        console.warn('[Cafe24 Webhook] 인증 실패 (X-API-Key/서명 모두 불일치), mall_id=', mallId);
        return res.status(401).json({ success: false, error: '웹훅 인증에 실패했습니다.' });
      }
    }

    if (!integration) {
      // 인증은 통과(카페24 발신 확인)했으나 미연동 몰 — 개발자센터 TEST(샘플 몰ID)·연동 해제 몰 이벤트가 여기 해당.
      // 404로 거부하면 카페24 실패 집계에 쌓여 "실패 100건+성공률 10% 미만 = 수신 자동 차단" 정책에 걸린다 → 200 무시.
      console.log('[Cafe24 Webhook] 미연동 mall_id — 인증된 요청이라 200 무시:', mallId, 'event:', event);
      return res.json({ success: true, ignored: true });
    }

    // idempotency_key — CT-85 단일 진입점 (event_no 전송 고유값 우선 + 본문 해시)
    const resource = req.body?.resource || {};
    const idempotencyKey = cafe24Adapter.buildIdempotencyKey(event, resource, req.body || {});

    // 중복 차단 + 처리 row INSERT
    const insertRes = await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'cafe24', $2, $3, $4::jsonb, 'received', 0, NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO NOTHING
      RETURNING id`,
      [integration.companyId, event, idempotencyKey, JSON.stringify(req.body || {})]
    );

    if (insertRes.rows.length === 0) {
      // 중복 webhook — duplicate 마커 갱신
      // 2026-06-10 정정: updated_at은 cdp_webhook_deliveries에 없는 컬럼(실측) — 포함 시 중복 응답이 전부 500
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'duplicate', processed_at = NOW()
         WHERE company_id = $1::uuid AND source = 'cafe24' AND idempotency_key = $2`,
        [integration.companyId, idempotencyKey]
      );
      return res.json({ success: true, duplicate: true });
    }

    const deliveryId = insertRes.rows[0].id;

    // ★ 이벤트별 처리 (cdp-* CT 자동 호출)
    try {
      await processCafe24Event(integration.companyId, event, resource);
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'processed', processed_at = NOW()
         WHERE id = $1::uuid`,
        [deliveryId]
      );
      return res.json({ success: true });
    } catch (processErr: any) {
      console.error('[Cafe24 Webhook] 이벤트 처리 실패:', processErr);
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'failed', error_message = $2, processed_at = NOW()
         WHERE id = $1::uuid`,
        [deliveryId, String(processErr?.message || 'unknown').slice(0, 1000)]
      );
      // 카페24는 200 반환해야 retry 안 일어남 — 한줄로 측 retry는 별도 cron 검토 (Phase 2)
      return res.json({ success: false, error: '이벤트 처리 실패, 한줄로 측에서 재처리 예약됩니다.' });
    }
  } catch (err: any) {
    console.error('[Cafe24 Webhook] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'webhook 처리 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 회사 admin 인증 — authorize / callback / status / disconnect
// ════════════════════════════════════════════════════════════════════

router.use(authenticate);

/**
 * GET /api/cafe24/oauth/authorize?mall_id=...
 * → CdpSettingsPage가 새 창으로 열어 사용자가 카페24 인증.
 * state = base64(JSON({ company_id, csrf_nonce, ts })) — callback에서 검증.
 */
router.get('/oauth/authorize', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') return res.status(403).json({ success: false, error: '카페24 연동은 회사 관리자만 가능합니다.' });

    const cdpEnabled = await isCdpEnabledForPlan(companyId);
    if (!cdpEnabled) {
      return res.status(403).json({
        success: false,
        error: '카페24 연동은 유료 요금제 가입 후 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED',
      });
    }

    const mallId = String(req.query.mall_id || '').trim().toLowerCase();
    if (!mallId || !/^[a-z0-9_-]+$/i.test(mallId)) {
      return res.status(400).json({ success: false, error: 'mall_id 형식이 올바르지 않습니다.' });
    }

    const csrfNonce = randomBytes(16).toString('hex');
    // state 저장 (10분 TTL — Phase 2에서 Redis 검토)
    await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'cafe24', 'oauth_state', $2, $3::jsonb, 'received', NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        created_at = NOW()`,
      [companyId, `state:${csrfNonce}`, JSON.stringify({ mall_id: mallId, nonce: csrfNonce })]
    );

    const state = Buffer.from(JSON.stringify({ company_id: companyId, nonce: csrfNonce, ts: Date.now() })).toString('base64url');
    const byoCreds = await getCafe24ByoCredentials(companyId, mallId);
    const authorizeUrl = buildCafe24AuthorizeUrl(mallId, state, undefined, byoCreds);
    return res.json({ success: true, authorize_url: authorizeUrl });
  } catch (err: any) {
    console.error('[Cafe24 /oauth/authorize] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'authorize URL 생성 실패' });
  }
});

/**
 * GET /api/cafe24/oauth/callback?code=...&state=...
 * → 카페24가 redirect_uri로 호출. state 검증 후 토큰 교환 + DB 저장 + 종료 페이지 HTML 응답.
 *
 * NOTE: 본 endpoint는 카페24가 호출 (사용자 브라우저 redirect)이므로 authenticate 우회.
 * authenticate 미들웨어가 위에 걸려 있어 이 endpoint는 ★ authenticate 통과 못 함 — 별도 라우터 분리 필요.
 * → 해결: callback은 이 라우터 등록 전에 별도 endpoint로 둠 (아래 보조 라우터가 담당).
 */
router.get('/oauth/callback', (_req: Request, res: Response) => {
  // 이 경로는 callbackRouter (아래)가 먼저 매칭되어야 정합.
  // 만약 본 핸들러에 도달했다면 라우터 등록 순서 오류.
  return res.status(500).send('카페24 OAuth callback 라우터 등록 순서 오류 — 운영 점검 필요.');
});

/**
 * POST /api/cafe24/byo-credentials
 * → 고객이 입력한 self-app client_id/secret/mall_id 저장(OAuth 전). 이후 /oauth/authorize로 연결.
 */
router.post('/byo-credentials', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') return res.status(403).json({ success: false, error: '카페24 연동은 회사 관리자만 가능합니다.' });

    const mallId = String(req.body?.mall_id || '').trim().toLowerCase();
    const clientId = String(req.body?.client_id || '').trim();
    const clientSecret = String(req.body?.client_secret || '').trim();
    if (!mallId || !/^[a-z0-9_-]+$/i.test(mallId)) {
      return res.status(400).json({ success: false, error: 'mall_id 형식이 올바르지 않습니다.' });
    }
    if (!clientId || !clientSecret) {
      return res.status(400).json({ success: false, error: 'client_id / client_secret을 모두 입력해주세요.' });
    }

    await saveCafe24ByoCredentials(companyId, mallId, clientId, clientSecret);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Cafe24 /byo-credentials] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'self-app 자격 저장 실패' });
  }
});

/**
 * GET /api/cafe24/status
 * → 현재 회사 카페24 연동 상태 (CdpSettingsPage 표시).
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const integration = await getCafe24Integration(companyId);
    if (!integration) {
      return res.json({ success: true, connected: false });
    }
    return res.json({
      success: true,
      connected: true,
      mall_id: integration.mallId,
      status: integration.status,
      token_expires_at: integration.tokenExpiresAt,
      scope: integration.scope,
    });
  } catch (err: any) {
    console.error('[Cafe24 /status] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

/**
 * DELETE /api/cafe24/disconnect
 * → 연동 해제 (회사 admin). DB row status='revoked'. 카페24 측 revoke API는 Phase 2.
 */
router.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') return res.status(403).json({ success: false, error: '연동 해제는 회사 관리자만 가능합니다.' });

    await query(
      `UPDATE company_integrations
       SET status = 'revoked', updated_at = NOW()
       WHERE company_id = $1::uuid AND provider = 'cafe24'`,
      [companyId]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Cafe24 /disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '연동 해제 실패' });
  }
});

export default router;

// ════════════════════════════════════════════════════════════════════
// 별도 callback 라우터 — authenticate 우회 (카페24가 브라우저 redirect로 호출)
// app.ts에 router보다 먼저 등록
// ════════════════════════════════════════════════════════════════════

export const cafe24CallbackRouter = Router();

cafe24CallbackRouter.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code || '');
    const stateRaw = String(req.query.state || '');
    if (!code || !stateRaw) {
      return res.status(400).send(renderCafe24CallbackHtml('error', '카페24가 보낸 응답에 code 또는 state가 누락되었습니다.'));
    }

    let parsed: { company_id?: string; nonce?: string; ts?: number };
    try {
      parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
    } catch {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'state 검증 실패 (변조 의심).'));
    }
    if (!parsed.company_id || !parsed.nonce) {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'state 형식이 올바르지 않습니다.'));
    }
    // state TTL 10분
    if (!parsed.ts || Date.now() - parsed.ts > 10 * 60 * 1000) {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'OAuth 세션이 만료되었습니다. 다시 시도해주세요.'));
    }

    // DB에 저장된 nonce 확인
    const stateRow = await query(
      `SELECT payload FROM cdp_webhook_deliveries
       WHERE company_id = $1::uuid AND source = 'cafe24'
         AND webhook_event = 'oauth_state' AND idempotency_key = $2
       LIMIT 1`,
      [parsed.company_id, `state:${parsed.nonce}`]
    );
    if (stateRow.rows.length === 0) {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'state 검증 실패 (재시도 또는 변조 의심).'));
    }
    const payload = stateRow.rows[0].payload as { mall_id?: string };
    const mallId = payload?.mall_id;
    if (!mallId) {
      return res.status(400).send(renderCafe24CallbackHtml('error', 'state에 mall_id가 누락되었습니다.'));
    }

    // 토큰 교환 — 회사 self-app 자격(없으면 env)으로
    const byoCreds = await getCafe24ByoCredentials(parsed.company_id, mallId);
    const tokenRes = await exchangeCafe24Code(mallId, code, byoCreds);
    await saveCafe24Integration(parsed.company_id, mallId, tokenRes);

    // state 정리
    await query(
      `DELETE FROM cdp_webhook_deliveries
       WHERE company_id = $1::uuid AND source = 'cafe24'
         AND webhook_event = 'oauth_state' AND idempotency_key = $2`,
      [parsed.company_id, `state:${parsed.nonce}`]
    );

    return res.send(renderCafe24CallbackHtml('ok', `${mallId} 카페24 연동이 완료되었습니다. 본 창을 닫고 한줄로AI로 돌아가주세요.`));
  } catch (err: any) {
    console.error('[Cafe24 callback] 오류:', err);
    return res.status(500).send(renderCafe24CallbackHtml('error', err?.message || '카페24 연동 처리 중 오류가 발생했습니다.'));
  }
});

// ════════════════════════════════════════════════════════════════════
// 이벤트 처리 디스패처 — D173 cafe24Adapter.processWebhookEvent로 위임 (단일 진실)
// ════════════════════════════════════════════════════════════════════

async function processCafe24Event(companyId: string, event: string, resource: any): Promise<void> {
  return cafe24Adapter.processWebhookEvent(companyId, event, resource);
}

// ════════════════════════════════════════════════════════════════════
// callback HTML 응답 (사용자가 새 창에서 보는 화면)
// ════════════════════════════════════════════════════════════════════

function renderCafe24CallbackHtml(status: 'ok' | 'error', message: string): string {
  const color = status === 'ok' ? '#059669' : '#dc2626';
  const icon = status === 'ok' ? '✓' : '✕';
  const title = status === 'ok' ? '카페24 연동 완료' : '카페24 연동 실패';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>한줄로 — ${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 60px 20px; }
  .card { max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); text-align: center; }
  .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
  h1 { color: #111827; font-size: 20px; margin: 0 0 12px; }
  p { color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; }
  .footer { margin-top: 24px; font-size: 12px; color: #9ca3af; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${escapeHtml(message)}</p>
  <div class="footer">본 창을 닫으시면 한줄로AI로 돌아가실 수 있습니다.</div>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
