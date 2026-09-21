/**
 * 우커머스(WooCommerce · 워드프레스) 연동 라우트 — 2026-09-14 W2
 * 설계서 = docs/2026-09-14-woocommerce-integration-design.md (§3 라우트 층)
 *
 * Endpoint:
 *   - POST   /api/woocommerce/webhook/:mallId  : 공개 · 우커머스 기본 웹훅 수신(원본 바이트 서명 · cdp_webhook_deliveries 멱등)
 *   - POST   /api/woocommerce/credentials      : 몰 자격 저장(site_url · consumer_key · consumer_secret · consent_meta_key) → 웹훅 URL·secret 1회 응답
 *   - POST   /api/woocommerce/connect          : { mall_id } 연결 검증 1콜 → 백필(회원 → 주문 90일) 백그라운드
 *   - POST   /api/woocommerce/rotate-secret    : { mall_id } 웹훅 secret 재발급(옛 secret 즉시 폐기)
 *   - GET    /api/woocommerce/status           : 몰 목록·상태(키·secret 값 없음)
 *   - DELETE /api/woocommerce/disconnect?mall_id= : 해제(status='revoked')
 *
 * 보안:
 *   - webhook 은 인증 미들웨어 앞 — 몰 후보 행마다 webhook_secret 으로 서명 대조(같은 몰 주소를 두 회사가 적어도 secret 이 가른다)
 *   - 인증 라우트는 authenticate + 권한 CT(utils/integration-scope.ts) · 회사 식별자는 세션에서만(본문·쿼리의 companyId 를 읽지 않는다)
 *     ★2026-09-18(설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-5): 관리자는 회사 전체 몰 ·
 *     분류코드가 배정된 사용자는 자기 분류코드로 자기 몰만 연결·조회·해제. 분류코드는 본문이 아니라 세션 사용자에서 정한다.
 *   - 몰 식별자는 normalizeWooMallId 한 함수(경로 파라미터 · 발신 헤더 · 폼 입력 전부)
 *
 * ⛔ 우커머스 웹훅 헤더명·서명 인코딩·최초 ping 본문은 게이트 ② 실측 전까지 미검증 — 주제 헤더가 없는 요청은 200 으로 받아 활성화가 막히지 않게 한다.
 */

import { Router, Request, Response, json } from 'express';
import { randomBytes } from 'crypto';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';
import { normalizeWooMallId, wooTopicKind } from '../utils/woocommerce-core';
import { woocommerceAdapter, buildWooEvent, wooHeader } from '../utils/woocommerce-adapter';
import {
  WooApiError,
  saveWooCredentials,
  rotateWooWebhookSecret,
  getWooIntegration,
  listWooIntegrationsByMallId,
  markWooConnected,
  verifyWooConnection,
  backfillWooCustomers,
  backfillWooOrders,
  getWooStatus,
  disconnectWoo,
  saveWooRestKeysFromAuth,
  ensureWooWebhooks,
  removeWooWebhooks,
  recordWooSetupError,
} from '../utils/woocommerce-client';
// ★ ① 1클릭 연결 — 우커머스 내장 앱 인증(/wc-auth/v1/authorize) · state 서명 CT · 플러그인 zip
import { signWooAuthState, verifyWooAuthState, buildWooAuthorizeUrl } from '../utils/woocommerce-auth-state';
import { buildWooPluginZip, WOO_PLUGIN_ZIP_NAME } from '../utils/woocommerce-plugin-zip';
// ★ 2026-09-18 권한·범위 CT — 관리자 전체 · 사용자는 분류코드로 자기 것만(상시 원칙)
import {
  resolveIntegrationActor,
  canTouchIntegration,
  pickStoreCodeForConnect,
  listCompanyStoreCodes,
  integrationLockMessage,
  type IntegrationActor,
} from '../utils/integration-scope';

const router = Router();

// ════════════════════════════════════════════════════════════════════
// Webhook receiver (인증 미들웨어 전 — 서명 + idempotency_key 로 자체 검증)
// ════════════════════════════════════════════════════════════════════

router.post(['/webhook/:mallId', '/webhook'], json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }), async (req: Request, res: Response) => {
  try {
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const topic = woocommerceAdapter.extractEventFromWebhook(headers, body);
    const mallId = normalizeWooMallId(String(req.params?.mallId || '')) || woocommerceAdapter.extractMallIdFromWebhook(headers, body);

    // 최초 ping(웹훅 활성화 확인 · 주제 헤더 없음) — 200 으로 받는다. 400 을 돌려주면 우커머스가 웹훅을 비활성화할 수 있다.
    if (!topic) {
      console.log('[WooCommerce Webhook] 주제 헤더 없음 — ping 으로 보고 200 무시. mall=', mallId, 'keys=', Object.keys(body).slice(0, 5).join(','));
      return res.json({ success: true, ignored: true, reason: 'no_topic' });
    }
    if (!mallId) {
      console.warn('[WooCommerce Webhook] 몰 식별 실패 — 경로·발신 헤더 모두 없음. topic=', topic);
      return res.status(400).json({ success: false, error: '몰을 식별할 수 없습니다.' });
    }
    if (!wooTopicKind(topic)) {
      return res.json({ success: true, ignored: true, reason: 'topic_not_handled' });
    }

    // 몰 후보 행(active·pending) — 서명이 맞는 행이 곧 그 회사다
    const candidates = await listWooIntegrationsByMallId(mallId);
    if (candidates.length === 0) {
      // 미연동 몰 — 실패로 응답하면 발신 측 실패 집계가 쌓여 웹훅이 꺼질 수 있어 200 무시(카페24 선례)
      console.log('[WooCommerce Webhook] 미연동 몰 — 200 무시:', mallId, 'topic:', topic);
      return res.json({ success: true, ignored: true, reason: 'unknown_mall' });
    }
    const rawBody: Buffer | string = (req as any).rawBody || '';
    const signature = wooHeader(headers, 'x-wc-webhook-signature') || '';
    const integ = candidates.find((c) => woocommerceAdapter.verifyWebhookSignature(rawBody, signature, c.webhookSecret));
    if (!integ) {
      console.warn('[WooCommerce Webhook] 서명 검증 실패 mall=', mallId, 'topic=', topic, 'sigLen=', signature.length);
      return res.status(401).json({ success: false, error: '웹훅 서명 검증에 실패했습니다.' });
    }

    // 첫 서명 통과 = 연결 신호(REST 키 없이 웹훅만 붙인 몰도 여기서 active 가 된다)
    if (integ.status !== 'active' || !integ.connectedAt) await markWooConnected(integ.companyId, mallId);

    const event = buildWooEvent(mallId, topic);
    const deliveryId = wooHeader(headers, 'x-wc-webhook-delivery-id');
    const idempotencyKey = woocommerceAdapter.buildIdempotencyKey(event, body, { ...body, ...(deliveryId ? { delivery_id: deliveryId } : {}) });

    const insertRes = await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'woocommerce', $2, $3, $4::jsonb, 'received', 0, NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO NOTHING
      RETURNING id`,
      [integ.companyId, event, idempotencyKey, JSON.stringify({ mall_id: mallId, topic, delivery_id: deliveryId, resource: body })],
    );

    if (insertRes.rows.length === 0) {
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'duplicate', processed_at = NOW()
         WHERE company_id = $1::uuid AND source = 'woocommerce' AND idempotency_key = $2`,
        [integ.companyId, idempotencyKey],
      );
      return res.json({ success: true, duplicate: true });
    }
    const deliveryRowId = insertRes.rows[0].id;

    try {
      await woocommerceAdapter.processWebhookEvent(integ.companyId, event, body);
      await query(`UPDATE cdp_webhook_deliveries SET status = 'processed', processed_at = NOW() WHERE id = $1::uuid`, [deliveryRowId]);
      return res.json({ success: true });
    } catch (processErr: any) {
      console.error('[WooCommerce Webhook] 이벤트 처리 실패:', processErr?.message || processErr);
      await query(
        `UPDATE cdp_webhook_deliveries SET status = 'failed', error_message = $2, processed_at = NOW() WHERE id = $1::uuid`,
        [deliveryRowId, String(processErr?.message || 'unknown').slice(0, 1000)],
      );
      // 발신 측 재시도 대신 한줄로 재처리 워커(cdp-webhook-retry-worker)가 맡는다 — 200 계열로 닫는다
      return res.json({ success: false, error: '이벤트 처리 실패, 한줄로 측에서 재처리합니다.' });
    }
  } catch (err: any) {
    console.error('[WooCommerce Webhook] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'webhook 처리 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 앱 인증(wc-auth) 콜백 · 되돌아오는 화면 · 플러그인 zip — 공개(인증 미들웨어 앞)
// ════════════════════════════════════════════════════════════════════

/**
 * POST /api/woocommerce/auth-callback  (우커머스 서버가 JSON POST — 관리자가 승인한 직후)
 * body: { key_id, user_id(=우리 state), consumer_key, consumer_secret, key_permissions }
 * → state 서명 검증 → 1회용 state 행 삭제 → 키 저장 → 즉시 200(우커머스가 200 을 받아야 승인 화면이 끝난다)
 * → 뒤에서 검증 1콜 · 웹훅 4개 자동 생성 · 회원·주문 백필. 실패는 meta.woo_sync_error(화면 "조치 필요").
 */
router.post('/auth-callback', async (req: Request, res: Response) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const st = verifyWooAuthState(String(body.user_id || ''));
    if (!st) {
      console.warn('[WooCommerce auth-callback] state 검증 실패 — 위조·만료 가능. keys=', Object.keys(body).slice(0, 6).join(','));
      return res.status(400).json({ success: false, error: 'state 검증 실패' });
    }
    const consumed = await query(
      `DELETE FROM cdp_webhook_deliveries
       WHERE company_id = $1::uuid AND source = 'woocommerce' AND webhook_event = 'oauth_state' AND idempotency_key = $2
       RETURNING id`,
      [st.companyId, `state:${st.nonce}`],
    );
    if (consumed.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'state 가 이미 사용됐거나 발급되지 않았습니다.' });
    }
    const consumerKey = String(body.consumer_key || '').trim();
    const consumerSecret = String(body.consumer_secret || '').trim();
    if (!consumerKey || !consumerSecret) {
      return res.status(400).json({ success: false, error: 'consumer_key 또는 consumer_secret 이 없습니다.' });
    }
    const ok = await saveWooRestKeysFromAuth(st.companyId, st.mallId, { consumerKey, consumerSecret, permissions: String(body.key_permissions || '') });
    if (!ok) return res.status(400).json({ success: false, error: '연동 행이 없습니다(해제됐거나 저장 전).' });
    console.log(`[WooCommerce auth-callback] 키 수신 company=${st.companyId} mall=${st.mallId} permissions=${String(body.key_permissions || '')}`);
    res.json({ success: true });

    // 무거운 일은 응답 뒤 — 검증 1콜(active) → 웹훅 4개 → 회원 → 주문
    void (async () => {
      try {
        await verifyWooConnection(st.companyId, st.mallId);
        const w = await ensureWooWebhooks(st.companyId, st.mallId);
        const c = await backfillWooCustomers(st.companyId, st.mallId);
        const o = await backfillWooOrders(st.companyId, st.mallId);
        console.log(`[WooCommerce auth-callback] 자동 설정 완료 mall=${st.mallId} webhooks +${w.created}/=${w.existing} customers=${c.imported}${c.truncated ? '(truncated)' : ''} orders=${o.imported}`);
      } catch (e: any) {
        const code = e instanceof WooApiError ? e.code : 'unknown';
        await recordWooSetupError(st.companyId, st.mallId, code, String(e?.message || 'unknown')).catch(() => undefined);
        console.error(`[WooCommerce auth-callback] 자동 설정 실패 mall=${st.mallId} code=${code} — ${e?.message || e}`);
      }
    })();
    return;
  } catch (err: any) {
    console.error('[WooCommerce auth-callback] 오류:', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err?.message || '콜백 처리 실패' });
    return;
  }
});

/**
 * GET /api/woocommerce/auth-return?success=1&user_id=<state>  (관리자 브라우저 — 승인 뒤 돌아오는 창)
 * → DB 쓰기 없음. 서명만 보고 안내 HTML(부모 창에 postMessage · 자동 닫기). success=0 = 승인 취소.
 */
router.get('/auth-return', (req: Request, res: Response) => {
  const st = verifyWooAuthState(String(req.query?.user_id || ''));
  const success = String(req.query?.success || '') === '1';
  if (!st) {
    return res.status(400).send(renderWooReturnHtml('error', '연결 정보를 확인할 수 없습니다. 한줄로 화면에서 다시 시도해주세요.', null, false));
  }
  if (!success) {
    return res.send(renderWooReturnHtml('error', `${st.mallId} 연결 승인이 취소되었습니다. 이 창을 닫고 다시 시도해주세요.`, st.mallId, false));
  }
  return res.send(renderWooReturnHtml('ok', `${st.mallId} 우커머스 관리자 승인이 완료되었습니다. 주문·회원을 가져오는 중입니다. 이 창은 자동으로 닫힙니다.`, st.mallId, true));
});

/**
 * GET /api/woocommerce/plugin.zip  (공개 · 비밀값 없음)
 * → 한줄로 우커머스 플러그인(수집 스크립트 자동 삽입 · 회원 식별 · 수신동의 REST 노출). 워드프레스 "플러그인 업로드"에 그대로.
 */
router.get('/plugin.zip', (_req: Request, res: Response) => {
  try {
    const zip = buildWooPluginZip();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${WOO_PLUGIN_ZIP_NAME}"`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(zip);
  } catch (err: any) {
    console.error('[WooCommerce plugin.zip] 오류:', err);
    return res.status(500).json({ success: false, error: '플러그인 파일을 준비하지 못했습니다.' });
  }
});

/** 승인 뒤 돌아오는 창(카페24 콜백 HTML 과 같은 형태). 부모 창(한줄로 관리)에 완료 신호를 보내고 성공이면 닫는다. */
function renderWooReturnHtml(status: 'ok' | 'error', message: string, mallId: string | null, success: boolean): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const color = status === 'ok' ? '#059669' : '#dc2626';
  const icon = status === 'ok' ? '✓' : '✕';
  const title = status === 'ok' ? '우커머스 연결 완료' : '우커머스 연결 실패';
  const payload = JSON.stringify({ type: 'hanjullo:woocommerce', mallId, success });
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>한줄로 · ${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 60px 20px; }
  .card { max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); text-align: center; }
  .icon { width: 56px; height: 56px; border-radius: 50%; background: ${color}; color: white; font-size: 28px; line-height: 56px; margin: 0 auto 20px; }
  h1 { font-size: 20px; margin: 0 0 12px; color: #111827; }
  p { color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
  </div>
  <script>
    try { if (window.opener) { window.opener.postMessage(${payload}, '*'); } } catch (e) {}
    ${success ? 'setTimeout(function () { window.close(); }, 1500);' : ''}
  </script>
</body>
</html>`;
}

// ════════════════════════════════════════════════════════════════════
// 회사 admin 인증 — connect-url / credentials / connect / rotate-secret / status / disconnect
// ════════════════════════════════════════════════════════════════════

router.use(authenticate);

/**
 * 권한 게이트(★2026-09-18) — 연동을 다룰 수 있는 주체(관리자 전체 · 분류코드 배정 사용자 자기 것)면 { companyId, actor },
 * 아니면 사유(CT 문장)로 403 을 보내고 null. 옛 회사 관리자 한정 게이트를 대체한다.
 */
async function gateActor(req: Request, res: Response): Promise<{ companyId: string; actor: IntegrationActor } | null> {
  const actor = await resolveIntegrationActor(req.user);
  if (actor.kind === 'blocked') {
    res.status(403).json({ success: false, error: integrationLockMessage(actor.reason), code: actor.reason });
    return null;
  }
  return { companyId: actor.companyId, actor };
}

/** 이 주체가 그 몰을 다룰 수 있는가 — 아니면 403(사유 = 다른 담당자의 분류코드 몰) 을 보내고 false. */
function gateMall(res: Response, actor: IntegrationActor, storeCode: string | null | undefined): boolean {
  if (canTouchIntegration(actor, storeCode)) return true;
  res.status(403).json({ success: false, error: integrationLockMessage('MALL_OWNED_BY_OTHER_STORE'), code: 'MALL_OWNED_BY_OTHER_STORE' });
  return false;
}

/**
 * 새로 저장하는 몰의 분류코드를 정한다(권한 CT) + 이미 있는 몰이면 소유·변경 규칙을 건다.
 * 반환 = 저장에 넘길 storeCode(undefined = 기존 행 값 유지) · 거부면 응답을 보내고 null.
 */
async function decideStoreCode(req: Request, res: Response, actor: IntegrationActor, companyId: string, siteUrl: string): Promise<{ storeCode: string | null | undefined } | null> {
  const pick = await pickStoreCodeForConnect(actor, req.body?.store_code);
  if (!pick.ok) {
    res.status(400).json({ success: false, error: integrationLockMessage(pick.code), code: pick.code });
    return null;
  }
  const mallId = normalizeWooMallId(siteUrl);
  const existing = mallId ? await getWooIntegration(companyId, mallId) : undefined;
  if (existing) {
    if (!canTouchIntegration(actor, existing.storeCode)) {
      res.status(409).json({ success: false, error: integrationLockMessage('MALL_OWNED_BY_OTHER_STORE'), code: 'MALL_OWNED_BY_OTHER_STORE' });
      return null;
    }
    // 몰 1행 = 분류코드 1개. 관리자가 다른 코드로 다시 저장하려 하면 거부(해제 뒤 재연결이 길이다).
    if (actor.kind === 'admin' && pick.storeCode !== null && pick.storeCode !== existing.storeCode) {
      res.status(409).json({ success: false, error: integrationLockMessage('STORE_CODE_CHANGE_NOT_SUPPORTED'), code: 'STORE_CODE_CHANGE_NOT_SUPPORTED' });
      return null;
    }
  }
  return { storeCode: existing ? undefined : pick.storeCode };
}

/** WooApiError → 상태코드. 몰 서버 쪽 문제(network·rate_limited·http·header_overflow)는 502, 입력·권한 문제는 400. */
function sendWooError(res: Response, err: unknown): void {
  if (err instanceof WooApiError) {
    const upstream = err.code === 'network' || err.code === 'rate_limited' || err.code === 'http' || err.code === 'header_overflow';
    res.status(upstream ? 502 : 400).json({ success: false, error: err.message, code: `WOO_${err.code}` });
    return;
  }
  res.status(500).json({ success: false, error: (err as any)?.message || '우커머스 처리 중 오류가 발생했습니다.' });
}

const PLAN_LOCKED = { success: false, error: '우커머스 연동은 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' };

/**
 * POST /api/woocommerce/credentials
 * body: { site_url, consumer_key?, consumer_secret?, consent_meta_key? }
 * → 몰 행 저장(pending) + 웹훅 URL·secret 응답(secret 은 이 응답에서만 1회).
 */
router.post('/credentials', async (req: Request, res: Response) => {
  try {
    const g = await gateActor(req, res);
    if (!g) return;
    const { companyId, actor } = g;
    if (!(await isCdpEnabledForPlan(companyId))) return res.status(403).json(PLAN_LOCKED);
    const siteUrl = String(req.body?.site_url || '').trim();
    if (!siteUrl) return res.status(400).json({ success: false, error: '쇼핑몰 주소(site_url)를 입력해주세요.' });
    const decided = await decideStoreCode(req, res, actor, companyId, siteUrl);
    if (!decided) return;
    const r = await saveWooCredentials(companyId, {
      siteUrl,
      consumerKey: String(req.body?.consumer_key || ''),
      consumerSecret: String(req.body?.consumer_secret || ''),
      consentMetaKey: String(req.body?.consent_meta_key || ''),
      storeCode: decided.storeCode,
    });
    return res.json({
      success: true,
      mall_id: r.mallId,
      webhook_url: r.webhookUrl,
      webhook_secret: r.webhookSecret,   // ★ 1회 노출 — 화면이 즉시 담당자에게 전달
      message: '몰을 저장했습니다. 웹훅 secret 은 이 응답에서만 표시됩니다.',
    });
  } catch (err) {
    console.error('[WooCommerce /credentials] 오류:', err);
    return sendWooError(res, err);
  }
});

/**
 * POST /api/woocommerce/connect
 * body: { mall_id }
 * → REST 키가 있으면 연결 검증 1콜(성공 시 active) 뒤 백필(회원 → 주문)을 백그라운드로. 키가 없으면 안내(웹훅 첫 수신이 연결).
 */
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const g = await gateActor(req, res);
    if (!g) return;
    const { companyId, actor } = g;
    if (!(await isCdpEnabledForPlan(companyId))) return res.status(403).json(PLAN_LOCKED);
    const mallId = normalizeWooMallId(String(req.body?.mall_id || ''));
    if (!mallId) return res.status(400).json({ success: false, error: '몰 식별자(mall_id)가 올바르지 않습니다.' });
    const integ = await getWooIntegration(companyId, mallId);
    if (!integ) return res.status(400).json({ success: false, error: '먼저 몰 주소와 REST 키를 저장해주세요.' });
    if (!gateMall(res, actor, integ.storeCode)) return;

    try {
      await verifyWooConnection(companyId, mallId);
    } catch (err) {
      if (err instanceof WooApiError && err.code === 'no_keys') {
        return res.json({ success: true, verified: false, code: 'WOO_no_keys', message: err.message });
      }
      throw err;
    }

    // 백필은 시간이 걸려 백그라운드로(회원 → 주문). 실패는 로그.
    void (async () => {
      try {
        const c = await backfillWooCustomers(companyId, mallId);
        const o = await backfillWooOrders(companyId, mallId);
        console.log(`[WooCommerce backfill] company=${companyId} mall=${mallId} customers=${c.imported}(pages ${c.pages}${c.truncated ? ' · truncated' : ''}) orders=${o.imported}(pages ${o.pages})`);
      } catch (e: any) {
        console.error('[WooCommerce backfill]', mallId, e?.message || e);
      }
    })();

    return res.json({ success: true, verified: true, message: '연동 확인 완료. 회원·주문을 가져오는 중입니다. 잠시 후 상태를 확인해주세요.' });
  } catch (err) {
    console.error('[WooCommerce /connect] 오류:', err);
    return sendWooError(res, err);
  }
});

/**
 * POST /api/woocommerce/connect-url   (★ ① 1클릭 연결 시작)
 * body: { site_url, consent_meta_key? }
 * → 몰 행 저장(pending · 키 없이) → 서명 state + 1회용 state 행 → 몰의 앱 인증 URL(관리자가 새 창에서 승인).
 *   authorize URL 은 저장된 몰 주소로만 만든다(입력값을 그대로 리다이렉트하지 않는다 · 오픈 리다이렉트 차단).
 */
router.post('/connect-url', async (req: Request, res: Response) => {
  try {
    const g = await gateActor(req, res);
    if (!g) return;
    const { companyId, actor } = g;
    if (!(await isCdpEnabledForPlan(companyId))) return res.status(403).json(PLAN_LOCKED);
    const siteUrl = String(req.body?.site_url || '').trim();
    if (!siteUrl) return res.status(400).json({ success: false, error: '쇼핑몰 주소(site_url)를 입력해주세요.' });
    // ★ 분류코드는 여기(세션으로 몰 행을 만드는 시점)에서 정한다. 승인 콜백은 이미 있는 행에 키만 얹으므로 state 에 실을 필요가 없다.
    const decided = await decideStoreCode(req, res, actor, companyId, siteUrl);
    if (!decided) return;
    const saved = await saveWooCredentials(companyId, { siteUrl, consumerKey: '', consumerSecret: '', consentMetaKey: String(req.body?.consent_meta_key || ''), storeCode: decided.storeCode });
    const integ = await getWooIntegration(companyId, saved.mallId);
    if (!integ) return res.status(500).json({ success: false, error: '몰 저장 뒤 조회에 실패했습니다.' });

    const nonce = randomBytes(16).toString('hex');
    await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'woocommerce', 'oauth_state', $2, $3::jsonb, 'received', NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO UPDATE SET payload = EXCLUDED.payload, created_at = NOW()`,
      [companyId, `state:${nonce}`, JSON.stringify({ mall_id: saved.mallId })],
    );
    const state = signWooAuthState({ companyId, mallId: saved.mallId, nonce, ts: Date.now() });
    return res.json({
      success: true,
      mall_id: saved.mallId,
      authorize_url: buildWooAuthorizeUrl(integ.siteUrl, state),
      webhook_url: saved.webhookUrl,
    });
  } catch (err) {
    console.error('[WooCommerce /connect-url] 오류:', err);
    return sendWooError(res, err);
  }
});

/**
 * POST /api/woocommerce/rotate-secret
 * body: { mall_id } → 웹훅 secret 재발급(옛 secret 즉시 폐기 · 고객사가 우커머스 웹훅 설정을 갱신해야 다시 받는다).
 */
router.post('/rotate-secret', async (req: Request, res: Response) => {
  try {
    const g = await gateActor(req, res);
    if (!g) return;
    const { companyId, actor } = g;
    const mallId = normalizeWooMallId(String(req.body?.mall_id || ''));
    if (!mallId) return res.status(400).json({ success: false, error: '몰 식별자(mall_id)가 올바르지 않습니다.' });
    const owned = await getWooIntegration(companyId, mallId);
    if (owned && !gateMall(res, actor, owned.storeCode)) return;
    const r = await rotateWooWebhookSecret(companyId, mallId);
    return res.json({ success: true, mall_id: mallId, webhook_url: r.webhookUrl, webhook_secret: r.webhookSecret });
  } catch (err) {
    console.error('[WooCommerce /rotate-secret] 오류:', err);
    return sendWooError(res, err);
  }
});

/**
 * GET /api/woocommerce/status
 * → 몰 목록·연결 상태(CdpSettingsPage 표시). 키·secret 값은 없다.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // ★ 2026-09-18 주체 범위 — 관리자 = 전체 · 사용자 = 자기 분류코드 몰만 · 잠긴 계정 = 빈 목록 + 사유.
    //   화면은 can_connect·connect_store_codes·store_code_options 를 그리기만 한다(권한을 다시 계산하지 않는다).
    const actor = await resolveIntegrationActor(req.user);
    const status = await getWooStatus(companyId);
    const malls = actor.kind === 'blocked' ? [] : status.malls.filter((m) => canTouchIntegration(actor, m.storeCode));
    const storeCodeOptions = actor.kind === 'admin' ? await listCompanyStoreCodes(companyId) : [];
    return res.json({
      success: true,
      connected: malls.some((m) => m.connected),
      malls,
      can_connect: actor.kind !== 'blocked',
      lock_reason: actor.kind === 'blocked' ? actor.reason : null,
      lock_message: actor.kind === 'blocked' ? integrationLockMessage(actor.reason) : null,
      connect_store_codes: actor.kind === 'user' ? actor.storeCodes : [],
      store_code_options: storeCodeOptions,
    });
  } catch (err: any) {
    console.error('[WooCommerce /status] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '상태 조회 실패' });
  }
});

/**
 * DELETE /api/woocommerce/disconnect?mall_id=
 * → 해제(status='revoked'). 그 몰의 웹훅은 이후 401(후보 행 없음이면 200 무시).
 */
router.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const g = await gateActor(req, res);
    if (!g) return;
    const { companyId, actor } = g;
    const mallId = normalizeWooMallId(String(req.query?.mall_id || ''));
    if (!mallId) return res.status(400).json({ success: false, error: '몰 식별자(mall_id)가 올바르지 않습니다.' });
    const owned = await getWooIntegration(companyId, mallId);
    if (owned && !gateMall(res, actor, owned.storeCode)) return;
    // 1클릭 연결이 만든 웹훅은 몰에서도 지운다(최선 노력 · 실패해도 해제는 진행)
    const removed = await removeWooWebhooks(companyId, mallId).catch(() => 0);
    if (removed > 0) console.log(`[WooCommerce /disconnect] 웹훅 ${removed}개 제거 mall=${mallId}`);
    const ok = await disconnectWoo(companyId, mallId);
    return res.json({ success: ok });
  } catch (err: any) {
    console.error('[WooCommerce /disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '연동 해제 실패' });
  }
});

export default router;
