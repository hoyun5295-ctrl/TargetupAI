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
 *   - 관리자 라우트는 authenticate + company_admin · 회사 식별자는 세션에서만(본문·쿼리의 companyId 를 읽지 않는다)
 *   - 몰 식별자는 normalizeWooMallId 한 함수(경로 파라미터 · 발신 헤더 · 폼 입력 전부)
 *
 * ⛔ 우커머스 웹훅 헤더명·서명 인코딩·최초 ping 본문은 게이트 ② 실측 전까지 미검증 — 주제 헤더가 없는 요청은 200 으로 받아 활성화가 막히지 않게 한다.
 */

import { Router, Request, Response, json } from 'express';
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
} from '../utils/woocommerce-client';

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
// 회사 admin 인증 — credentials / connect / rotate-secret / status / disconnect
// ════════════════════════════════════════════════════════════════════

router.use(authenticate);

/** 회사 admin 게이트 — 통과 시 companyId 반환, 아니면 응답 전송 후 null(고도몰 라우트와 같은 형태). */
function gateAdmin(req: Request, res: Response): string | null {
  const companyId = req.user?.companyId;
  const userType = req.user?.userType;
  if (!companyId) {
    res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    return null;
  }
  if (userType !== 'company_admin') {
    res.status(403).json({ success: false, error: '우커머스 연동은 회사 관리자만 가능합니다.' });
    return null;
  }
  return companyId;
}

/** WooApiError → 상태코드. 몰 서버 쪽 문제(network·rate_limited·http)는 502, 입력·권한 문제는 400. */
function sendWooError(res: Response, err: unknown): void {
  if (err instanceof WooApiError) {
    const upstream = err.code === 'network' || err.code === 'rate_limited' || err.code === 'http';
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
    const companyId = gateAdmin(req, res);
    if (!companyId) return;
    if (!(await isCdpEnabledForPlan(companyId))) return res.status(403).json(PLAN_LOCKED);
    const siteUrl = String(req.body?.site_url || '').trim();
    if (!siteUrl) return res.status(400).json({ success: false, error: '쇼핑몰 주소(site_url)를 입력해주세요.' });
    const r = await saveWooCredentials(companyId, {
      siteUrl,
      consumerKey: String(req.body?.consumer_key || ''),
      consumerSecret: String(req.body?.consumer_secret || ''),
      consentMetaKey: String(req.body?.consent_meta_key || ''),
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
    const companyId = gateAdmin(req, res);
    if (!companyId) return;
    if (!(await isCdpEnabledForPlan(companyId))) return res.status(403).json(PLAN_LOCKED);
    const mallId = normalizeWooMallId(String(req.body?.mall_id || ''));
    if (!mallId) return res.status(400).json({ success: false, error: '몰 식별자(mall_id)가 올바르지 않습니다.' });
    const integ = await getWooIntegration(companyId, mallId);
    if (!integ) return res.status(400).json({ success: false, error: '먼저 몰 주소와 REST 키를 저장해주세요.' });

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
 * POST /api/woocommerce/rotate-secret
 * body: { mall_id } → 웹훅 secret 재발급(옛 secret 즉시 폐기 · 고객사가 우커머스 웹훅 설정을 갱신해야 다시 받는다).
 */
router.post('/rotate-secret', async (req: Request, res: Response) => {
  try {
    const companyId = gateAdmin(req, res);
    if (!companyId) return;
    const mallId = normalizeWooMallId(String(req.body?.mall_id || ''));
    if (!mallId) return res.status(400).json({ success: false, error: '몰 식별자(mall_id)가 올바르지 않습니다.' });
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
    const status = await getWooStatus(companyId);
    return res.json({ success: true, ...status });
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
    const companyId = gateAdmin(req, res);
    if (!companyId) return;
    const mallId = normalizeWooMallId(String(req.query?.mall_id || ''));
    if (!mallId) return res.status(400).json({ success: false, error: '몰 식별자(mall_id)가 올바르지 않습니다.' });
    const ok = await disconnectWoo(companyId, mallId);
    return res.json({ success: ok });
  } catch (err: any) {
    console.error('[WooCommerce /disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '연동 해제 실패' });
  }
});

export default router;
