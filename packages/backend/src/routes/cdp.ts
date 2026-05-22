/**
 * ★ 한줄로 CDP (Customer Data Platform) API — D172 (2026-05-19)
 *
 * 자사몰 → 한줄로AI sync endpoint.
 * - 인증: X-Hanjullo-Key + X-Hanjullo-Secret 헤더 (requireCdpApiKey CT-19)
 * - 요금제: BUSINESS+ + cdp_events_per_month 한도 (CT-19에서 자동 게이팅)
 *
 * 운영 endpoint:
 *   POST /api/cdp/identify       — 회원 식별/upsert
 *   POST /api/cdp/event          — 행동 이벤트 박음
 *   POST /api/cdp/order          — 주문 sync + RFM 자동 갱신
 *   POST /api/cdp/bulk-import    — 초기 마이그레이션 (최대 1,000건/요청)
 *
 * 운영 모니터링 endpoint (회사 사용자 인증, 별도):
 *   GET  /api/cdp/recent-events  — 최근 이벤트 50건 (CdpSettingsPage 표시)
 *   GET  /api/cdp/usage          — 이번 달 API 호출 누적 + 한도
 *   POST /api/cdp/issue-key      — public/secret key 발급 또는 재발급 (raw 1회 노출)
 */

import { Router, Request, Response, json } from 'express';
import { authenticate } from '../middlewares/auth';
import { requireCdpApiKey, recordCdpApiCall, issueCdpKeyPair, isCdpEnabledForPlan } from '../utils/cdp-auth';
import { identifyCustomer } from '../utils/cdp-identity';
import { trackEvent, getRecentEvents } from '../utils/cdp-events';
import { syncOrder, bulkImport } from '../utils/cdp-orders';
import { listProvidersForUI } from '../utils/provider-registry';
// ★ D173 (2026-05-19): cafe24Adapter import 부수 효과로 cafe24 provider 등록
import '../utils/cafe24-client';
// ★ D178 (2026-05-19): naverSmartStoreAdapter import 부수 효과로 네이버 스마트스토어 provider 등록
import '../utils/naver-commerce-client';
// ★ D178 (2026-05-19): 자체 호스팅 자사몰 Adapter (Harold 명시 — 카페24보다 자체 호스팅 위주)
import {
  customSelfHostedAdapter,
  issueCustomWebhookSecret,
  getCustomWebhookInfo,
  getCustomIntegrationByCompanyId,
  revokeCustomWebhookSecret,
} from '../utils/custom-self-hosted-adapter';
// ★ D175-A (2026-05-19): Web Push + In-app Message 채널
import {
  getVapidPublicKey,
  saveSubscription,
  revokeSubscription,
  sendPushCampaign,
  countActiveSubscriptions,
  listPushCampaigns,
} from '../utils/web-push';
import {
  createInAppMessage,
  listInAppMessages,
  updateInAppMessage,
  deleteInAppMessage,
  getActiveMessagesForCustomer,
  trackImpression,
  getMessageStats,
} from '../utils/inapp-message';
import { query } from '../config/database';

const router = Router();

// ════════════════════════════════════════════════════════════════════
// 외부 API (X-Hanjullo-Key + X-Hanjullo-Secret 인증)
// ════════════════════════════════════════════════════════════════════

// POST /api/cdp/identify — 회원 식별 / upsert
router.post('/identify', requireCdpApiKey, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { external_id, email, phone, name, birth_date, gender, grade, address, custom_fields } = req.body;
    if (!external_id) {
      await recordCdpApiCall(cdpAuth.companyId, 'identify', 400);
      return res.status(400).json({ success: false, error: 'external_id는 필수입니다.' });
    }

    const result = await identifyCustomer(cdpAuth.companyId, {
      source: cdpAuth.source,
      externalId: String(external_id),
      email,
      phone,
      name,
      birthDate: birth_date,
      gender,
      grade,
      address,
      customFields: custom_fields || {},
    });

    await recordCdpApiCall(cdpAuth.companyId, 'identify', 200);
    return res.json({
      success: true,
      customer_id: result.customerId,
      link_id: result.linkId,
      was_created: result.wasCreated,
      was_merged: result.wasMerged,
    });
  } catch (err: any) {
    console.error('[CDP /identify] 오류:', err);
    await recordCdpApiCall(cdpAuth.companyId, 'identify', 500);
    return res.status(500).json({ success: false, error: err?.message || 'identify 처리 실패' });
  }
});

// POST /api/cdp/event — 행동 이벤트
router.post('/event', requireCdpApiKey, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { event_name, external_id, anonymous_id, properties, occurred_at } = req.body;
    if (!event_name) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 400);
      return res.status(400).json({ success: false, error: 'event_name은 필수입니다.' });
    }

    const result = await trackEvent(cdpAuth.companyId, {
      source: cdpAuth.source,
      eventName: String(event_name),
      externalId: external_id ? String(external_id) : undefined,
      anonymousId: anonymous_id ? String(anonymous_id) : undefined,
      properties: properties || {},
      occurredAt: occurred_at,
    });

    await recordCdpApiCall(cdpAuth.companyId, 'event', 200);
    return res.json({
      success: true,
      event_id: result.eventId,
      link_id: result.identityLinkId,
      customer_id: result.customerId,
    });
  } catch (err: any) {
    console.error('[CDP /event] 오류:', err);
    const status = err?.message?.includes('필수') || err?.message?.includes('허용') || err?.message?.includes('초과') ? 400 : 500;
    await recordCdpApiCall(cdpAuth.companyId, 'event', status);
    return res.status(status).json({ success: false, error: err?.message || 'event 처리 실패' });
  }
});

// POST /api/cdp/order — 주문 sync + RFM 갱신
router.post('/order', requireCdpApiKey, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { order_id, external_id, email, phone, name, status, total_amount, item_count, items, ordered_at, currency } = req.body;
    if (!order_id || !external_id || !status || total_amount === undefined || !ordered_at) {
      await recordCdpApiCall(cdpAuth.companyId, 'order', 400);
      return res.status(400).json({
        success: false,
        error: 'order_id, external_id, status, total_amount, ordered_at은 필수입니다.',
      });
    }

    const result = await syncOrder(cdpAuth.companyId, {
      source: cdpAuth.source,
      orderId: String(order_id),
      externalId: String(external_id),
      email,
      phone,
      name,
      status: String(status),
      totalAmount: Number(total_amount),
      itemCount: item_count ? Number(item_count) : undefined,
      items,
      orderedAt: String(ordered_at),
      currency: currency || 'KRW',
    });

    await recordCdpApiCall(cdpAuth.companyId, 'order', 200);
    return res.json({
      success: true,
      customer_id: result.customerId,
      link_id: result.linkId,
      was_customer_created: result.wasCustomerCreated,
      rfm_updated: result.rfmUpdated,
    });
  } catch (err: any) {
    console.error('[CDP /order] 오류:', err);
    const status = err?.message?.includes('필수') || err?.message?.includes('올바르지') ? 400 : 500;
    await recordCdpApiCall(cdpAuth.companyId, 'order', status);
    return res.status(status).json({ success: false, error: err?.message || 'order 처리 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D178 (2026-05-19) — 자체 호스팅 자사몰 Webhook (HMAC-SHA256 서명 인증)
//   Harold 명시 — "카페24보다 자체 호스팅 자사몰 위주". 회사 자체 자사몰이 webhook_secret 박고 POST 박음.
//   인증: X-Hanjullo-Company-Id 헤더 + X-Hanjullo-Signature (HMAC-SHA256 hex/base64)
// ════════════════════════════════════════════════════════════════════

router.post(
  '/webhook/custom',
  json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }),
  async (req: Request, res: Response) => {
    try {
      const companyIdHeader = req.headers['x-hanjullo-company-id'];
      const eventHeader = req.headers['x-hanjullo-event'];
      const signatureHeader = req.headers['x-hanjullo-signature'];

      const companyId = Array.isArray(companyIdHeader) ? companyIdHeader[0] : companyIdHeader;
      const event = Array.isArray(eventHeader) ? eventHeader[0] : (eventHeader || req.body?.event);
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      if (!companyId || !event) {
        return res.status(400).json({ success: false, error: 'X-Hanjullo-Company-Id와 X-Hanjullo-Event 헤더는 필수입니다.' });
      }
      if (!/^[a-f0-9-]{36}$/i.test(String(companyId))) {
        return res.status(400).json({ success: false, error: 'X-Hanjullo-Company-Id 형식이 올바르지 않습니다.' });
      }

      // webhook_secret 조회 + 서명 검증
      const integration = await getCustomIntegrationByCompanyId(String(companyId));
      if (!integration || !integration.webhookSecret) {
        return res.status(401).json({
          success: false,
          error: 'webhook_secret이 발급되지 않은 회사입니다. CdpSettingsPage에서 발급받아주세요.',
        });
      }
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const isValid = customSelfHostedAdapter.verifyWebhookSignature(
        rawBody,
        String(signature || ''),
        integration.webhookSecret
      );
      if (!isValid) {
        console.warn('[Custom Webhook] 서명 검증 실패, company=', companyId, 'event=', event);
        return res.status(401).json({ success: false, error: 'X-Hanjullo-Signature 서명 검증에 실패했습니다.' });
      }

      // idempotency_key
      const resource = req.body?.resource || req.body || {};
      const idempotencyKey = customSelfHostedAdapter.buildIdempotencyKey(String(event), resource, req.body || {});

      // 중복 차단 + 처리 row INSERT
      const insertRes = await query(
        `INSERT INTO cdp_webhook_deliveries (
          id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, created_at
        ) VALUES (
          gen_random_uuid(), $1::uuid, 'custom', $2, $3, $4::jsonb, 'received', 0, NOW()
        )
        ON CONFLICT (company_id, source, idempotency_key) DO NOTHING
        RETURNING id`,
        [companyId, event, idempotencyKey, JSON.stringify(req.body || {})]
      );

      if (insertRes.rows.length === 0) {
        await query(
          `UPDATE cdp_webhook_deliveries
           SET status = 'duplicate', processed_at = NOW(), updated_at = NOW()
           WHERE company_id = $1::uuid AND source = 'custom' AND idempotency_key = $2`,
          [companyId, idempotencyKey]
        );
        return res.json({ success: true, duplicate: true });
      }

      const deliveryId = insertRes.rows[0].id;

      try {
        await customSelfHostedAdapter.processWebhookEvent(String(companyId), String(event), resource);
        await query(
          `UPDATE cdp_webhook_deliveries SET status = 'processed', processed_at = NOW() WHERE id = $1::uuid`,
          [deliveryId]
        );
        return res.json({ success: true });
      } catch (processErr: any) {
        console.error('[Custom Webhook] 이벤트 처리 실패:', processErr);
        await query(
          `UPDATE cdp_webhook_deliveries
           SET status = 'failed', error_message = $2, processed_at = NOW()
           WHERE id = $1::uuid`,
          [deliveryId, String(processErr?.message || 'unknown').slice(0, 1000)]
        );
        return res.json({ success: false, error: '이벤트 처리 실패' });
      }
    } catch (err: any) {
      console.error('[Custom Webhook] 오류:', err);
      return res.status(500).json({ success: false, error: err?.message || 'webhook 처리 실패' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// ★ D175-A — Web Push 외부 API (SDK 호출, requireCdpApiKey 인증)
// ════════════════════════════════════════════════════════════════════

// GET /api/cdp/push/vapid-public-key — SDK가 구독 박을 때 활용 (인증 불요, 공개 키)
router.get('/push/vapid-public-key', (_req: Request, res: Response) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ success: false, error: 'VAPID 환경변수가 설정되지 않았습니다.' });
  return res.json({ success: true, vapid_public_key: key });
});

// POST /api/cdp/push/subscribe — SDK가 사용자 구독 박음
router.post('/push/subscribe', requireCdpApiKey, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { subscription, external_id, anonymous_id, user_agent } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 400);
      return res.status(400).json({ success: false, error: 'subscription 형식이 올바르지 않습니다.' });
    }

    // customer 식별 (external_id 또는 anonymous_id)
    let customerId: string | null = null;
    let identityLinkId: string | null = null;
    if (external_id) {
      const linkRow = await query(
        `SELECT id, customer_id FROM cdp_identity_links
         WHERE company_id = $1::uuid AND source = $2 AND external_id = $3 LIMIT 1`,
        [cdpAuth.companyId, cdpAuth.source, String(external_id)]
      );
      if (linkRow.rows.length > 0) {
        identityLinkId = linkRow.rows[0].id;
        customerId = linkRow.rows[0].customer_id;
      }
    }

    const result = await saveSubscription({
      companyId: cdpAuth.companyId,
      customerId,
      identityLinkId,
      subscription,
      userAgent: user_agent,
    });
    await recordCdpApiCall(cdpAuth.companyId, 'event', 200);
    return res.json({ success: true, subscription_id: result.id, is_new: result.isNew });
  } catch (err: any) {
    console.error('[CDP /push/subscribe] 오류:', err);
    await recordCdpApiCall(cdpAuth.companyId, 'event', 500);
    return res.status(500).json({ success: false, error: err?.message || 'subscribe 처리 실패' });
  }
});

// POST /api/cdp/push/unsubscribe — SDK가 사용자 구독 해제
router.post('/push/unsubscribe', requireCdpApiKey, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 400);
      return res.status(400).json({ success: false, error: 'endpoint는 필수입니다.' });
    }
    await revokeSubscription(cdpAuth.companyId, String(endpoint));
    await recordCdpApiCall(cdpAuth.companyId, 'event', 200);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[CDP /push/unsubscribe] 오류:', err);
    await recordCdpApiCall(cdpAuth.companyId, 'event', 500);
    return res.status(500).json({ success: false, error: err?.message || 'unsubscribe 처리 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D175-A — In-app Message SDK API (requireCdpApiKey)
// ════════════════════════════════════════════════════════════════════

// GET /api/cdp/inapp/active — SDK가 페이지 로드 시 호출, 현재 사용자에게 표시할 메시지 반환
router.get('/inapp/active', requireCdpApiKey, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const trigger = String(req.query.trigger || 'page_load');
    const externalId = req.query.external_id ? String(req.query.external_id) : undefined;
    const anonymousId = req.query.anonymous_id ? String(req.query.anonymous_id) : undefined;
    const seenRaw = req.query.seen ? String(req.query.seen) : '';
    const seenMessageIds = seenRaw ? seenRaw.split(',').filter(Boolean) : [];

    const messages = await getActiveMessagesForCustomer({
      companyId: cdpAuth.companyId,
      triggerEvent: trigger,
      externalId,
      anonymousId,
      seenMessageIds,
    });
    await recordCdpApiCall(cdpAuth.companyId, 'event', 200);
    return res.json({ success: true, messages });
  } catch (err: any) {
    console.error('[CDP /inapp/active] 오류:', err);
    await recordCdpApiCall(cdpAuth.companyId, 'event', 500);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// POST /api/cdp/inapp/track — SDK가 impression/click/dismiss 박음
router.post('/inapp/track', requireCdpApiKey, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { message_id, event_type, external_id, anonymous_id } = req.body;
    if (!message_id || !event_type) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 400);
      return res.status(400).json({ success: false, error: 'message_id와 event_type은 필수입니다.' });
    }
    let identityLinkId: string | null = null;
    let customerId: string | null = null;
    if (external_id) {
      const linkRow = await query(
        `SELECT id, customer_id FROM cdp_identity_links
         WHERE company_id = $1::uuid AND source = $2 AND external_id = $3 LIMIT 1`,
        [cdpAuth.companyId, cdpAuth.source, String(external_id)]
      );
      if (linkRow.rows.length > 0) {
        identityLinkId = linkRow.rows[0].id;
        customerId = linkRow.rows[0].customer_id;
      }
    }
    await trackImpression({
      companyId: cdpAuth.companyId,
      messageId: String(message_id),
      eventType: event_type,
      customerId,
      identityLinkId,
      anonymousId: anonymous_id || null,
    });
    await recordCdpApiCall(cdpAuth.companyId, 'event', 200);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[CDP /inapp/track] 오류:', err);
    await recordCdpApiCall(cdpAuth.companyId, 'event', 500);
    return res.status(500).json({ success: false, error: err?.message || 'track 처리 실패' });
  }
});

// POST /api/cdp/bulk-import — 초기 마이그레이션 (최대 1,000건/요청)
router.post('/bulk-import', requireCdpApiKey, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { customers, orders } = req.body;
    if (!Array.isArray(customers) && !Array.isArray(orders)) {
      await recordCdpApiCall(cdpAuth.companyId, 'bulk-import', 400);
      return res.status(400).json({ success: false, error: 'customers 또는 orders 배열 중 하나는 필수입니다.' });
    }

    const result = await bulkImport(cdpAuth.companyId, {
      source: cdpAuth.source,
      customers: Array.isArray(customers) ? customers.map((c: any) => ({
        source: c.source || cdpAuth.source,
        externalId: String(c.external_id || ''),
        email: c.email,
        phone: c.phone,
        name: c.name,
        birthDate: c.birth_date,
        gender: c.gender,
        grade: c.grade,
        address: c.address,
        customFields: c.custom_fields || {},
      })) : undefined,
      orders: Array.isArray(orders) ? orders.map((o: any) => ({
        source: o.source || cdpAuth.source,
        orderId: String(o.order_id || ''),
        externalId: String(o.external_id || ''),
        email: o.email,
        phone: o.phone,
        name: o.name,
        status: String(o.status || ''),
        totalAmount: Number(o.total_amount || 0),
        itemCount: o.item_count,
        items: o.items,
        orderedAt: String(o.ordered_at || ''),
        currency: o.currency || 'KRW',
      })) : undefined,
    });

    const totalCount = result.customersImported + result.ordersImported;
    await recordCdpApiCall(cdpAuth.companyId, 'bulk-import', 200, Math.max(totalCount, 1));
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[CDP /bulk-import] 오류:', err);
    await recordCdpApiCall(cdpAuth.companyId, 'bulk-import', 500);
    return res.status(500).json({ success: false, error: err?.message || 'bulk-import 처리 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 운영 모니터링 endpoint (회사 사용자 일반 인증 — authenticate 미들웨어)
// ════════════════════════════════════════════════════════════════════

router.use(authenticate);

// GET /api/cdp/recent-events — 최근 이벤트 50건 (CdpSettingsPage 디버깅)
router.get('/recent-events', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const offset = parseInt(String(req.query.offset || '0')) || 0;
    const result = await getRecentEvents(companyId, limit, offset);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[CDP /recent-events] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// GET /api/cdp/usage — 이번 달 API 호출 누적 + 한도
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const result = await query(
      `SELECT
          p.cdp_events_per_month AS monthly_limit,
          COALESCE((
            SELECT SUM(call_count) FROM cdp_api_call_log
            WHERE company_id = c.id
              AND occurred_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
          ), 0) AS used,
          c.cdp_api_key IS NOT NULL AS has_key,
          c.cdp_api_key_issued_at AS issued_at,
          COALESCE(p.cdp_enabled, false) AS cdp_enabled,
          p.plan_code,
          p.plan_name
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       WHERE c.id = $1::uuid`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    }
    const row = result.rows[0];
    return res.json({
      success: true,
      cdp_enabled: !!row.cdp_enabled,
      plan_code: row.plan_code,
      plan_name: row.plan_name,
      has_key: !!row.has_key,
      issued_at: row.issued_at,
      monthly_limit: row.monthly_limit,           // NULL = 무제한
      used: parseInt(row.used || '0'),
    });
  } catch (err: any) {
    console.error('[CDP /usage] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D175-A — Web Push 회사 admin 운영 endpoint
// ════════════════════════════════════════════════════════════════════

// GET /api/cdp/push/stats — 구독자 수 + 최근 발송 캠페인 이력
router.get('/push/stats', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const stats = await countActiveSubscriptions(companyId);
    const campaigns = await listPushCampaigns(companyId, 20);
    return res.json({ success: true, stats, campaigns });
  } catch (err: any) {
    console.error('[CDP /push/stats] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// POST /api/cdp/push/send — 회사 admin이 Web Push 발송 (BUSINESS+ 자동 게이팅, isCdpEnabledForPlan)
router.post('/push/send', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: 'Web Push 발송은 회사 관리자만 가능합니다.' });
    }
    const cdpEnabled = await isCdpEnabledForPlan(companyId);
    if (!cdpEnabled) {
      return res.status(403).json({ success: false, error: 'Web Push는 비즈니스 요금제부터 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
    }

    const { title, body, url, icon, badge } = req.body;
    if (!title || !body) return res.status(400).json({ success: false, error: 'title과 body는 필수입니다.' });
    const result = await sendPushCampaign(
      companyId,
      { title: String(title), body: String(body), url: url ? String(url) : undefined, icon: icon ? String(icon) : undefined, badge: badge ? String(badge) : undefined },
      userId || null
    );
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[CDP /push/send] 오류:', err);
    const status = err?.message?.includes('0건') ? 400 : 500;
    return res.status(status).json({ success: false, error: err?.message || 'Push 발송 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D175-A — In-app Message 회사 admin CRUD
// ════════════════════════════════════════════════════════════════════

router.get('/inapp', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const messages = await listInAppMessages(companyId);
    // 메시지별 통계 추가
    const withStats = await Promise.all(
      messages.map(async (m) => ({
        ...m,
        stats: await getMessageStats(companyId, m.id),
      }))
    );
    return res.json({ success: true, messages: withStats });
  } catch (err: any) {
    console.error('[CDP /inapp GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.post('/inapp', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: 'In-app 메시지 신설은 회사 관리자만 가능합니다.' });
    }
    const cdpEnabled = await isCdpEnabledForPlan(companyId);
    if (!cdpEnabled) {
      return res.status(403).json({ success: false, error: 'In-app 메시지는 비즈니스 요금제부터 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
    }

    const message = await createInAppMessage(companyId, userId, req.body);
    return res.json({ success: true, message });
  } catch (err: any) {
    console.error('[CDP /inapp POST] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '생성 실패' });
  }
});

router.put('/inapp/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '수정은 회사 관리자만 가능합니다.' });
    }
    const message = await updateInAppMessage(companyId, req.params.id, req.body);
    if (!message) return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    return res.json({ success: true, message });
  } catch (err: any) {
    console.error('[CDP /inapp PUT] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '수정 실패' });
  }
});

router.delete('/inapp/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '삭제는 회사 관리자만 가능합니다.' });
    }
    const ok = await deleteInAppMessage(companyId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[CDP /inapp DELETE] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '삭제 실패' });
  }
});

// GET /api/cdp/providers — 자사몰 wrapper 등록 매트릭스 (CdpSettingsPage 표시용)
router.get('/providers', async (_req: Request, res: Response) => {
  try {
    const providers = listProvidersForUI();
    return res.json({ success: true, providers });
  } catch (err: any) {
    console.error('[CDP /providers] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D178 (2026-05-19) — 자체 호스팅 자사몰 webhook_secret 회사 admin endpoint
// ════════════════════════════════════════════════════════════════════

// GET /api/cdp/custom/info — 현재 회사 webhook_secret 발급 상태 (CdpSettingsPage 표시)
router.get('/custom/info', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const info = await getCustomWebhookInfo(companyId);
    return res.json({ success: true, ...info, companyId });
  } catch (err: any) {
    console.error('[CDP /custom/info] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// POST /api/cdp/custom/issue-secret — webhook_secret 발급/재발급 (raw secret 1회만 응답)
router.post('/custom/issue-secret', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: 'webhook_secret 발급은 회사 관리자만 가능합니다.' });
    }
    const cdpEnabled = await isCdpEnabledForPlan(companyId);
    if (!cdpEnabled) {
      return res.status(403).json({
        success: false,
        error: '자체 호스팅 자사몰 연동은 비즈니스 요금제부터 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED',
      });
    }
    const result = await issueCustomWebhookSecret(companyId);
    return res.json({
      success: true,
      webhook_secret: result.secret,  // ★ raw secret — 본 응답에서만 1회 노출, 재발급 시 옛 secret은 폐기
      webhook_url: result.webhookUrl,
      company_id: companyId,
      issued_at: result.issuedAt,
      message: 'webhook_secret은 본 응답에서만 1회 노출됩니다. 자사몰 자체 서버에 즉시 저장해주세요. 재발급 시 기존 secret은 즉시 폐기됩니다.',
    });
  } catch (err: any) {
    console.error('[CDP /custom/issue-secret] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'webhook_secret 발급 실패' });
  }
});

// DELETE /api/cdp/custom/revoke — 자체 호스팅 자사몰 연동 해제
router.delete('/custom/revoke', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '연동 해제는 회사 관리자만 가능합니다.' });
    }
    const ok = await revokeCustomWebhookSecret(companyId);
    return res.json({ success: ok });
  } catch (err: any) {
    console.error('[CDP /custom/revoke] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '연동 해제 실패' });
  }
});

// POST /api/cdp/issue-key — public/secret key 발급 (raw secret 1회만 응답)
router.post('/issue-key', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: 'CDP 키 발급은 회사 관리자만 가능합니다.' });
    }

    const cdpEnabled = await isCdpEnabledForPlan(companyId);
    if (!cdpEnabled) {
      return res.status(403).json({
        success: false,
        error: '한줄로 CDP는 비즈니스 요금제부터 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED',
      });
    }

    const pair = await issueCdpKeyPair(companyId);
    return res.json({
      success: true,
      cdp_api_key: pair.cdpApiKey,
      cdp_api_secret: pair.cdpApiSecret,  // ★ raw secret — 본 응답에서만 1회 노출, 재발급 시 옛 secret은 폐기
      issued_at: pair.issuedAt,
      message: '비밀 키(secret)는 본 응답에서만 1회 노출됩니다. 자사몰에 즉시 저장해주세요. 재발급 시 기존 키는 즉시 폐기됩니다.',
    });
  } catch (err: any) {
    console.error('[CDP /issue-key] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '키 발급 실패' });
  }
});

export default router;
