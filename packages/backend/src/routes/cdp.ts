/**
 * ★ 한줄로 CDP (Customer Data Platform) API — D172 (2026-05-19)
 *
 * 자사몰 → 한줄로AI sync endpoint.
 * - 인증: X-Hanjullo-Key + X-Hanjullo-Secret 헤더 (requireCdpApiKey CT-19)
 * - 요금제: BUSINESS+ + cdp_events_per_month 한도 (CT-19에서 자동 게이팅)
 *
 * 운영 endpoint:
 *   POST /api/cdp/identify       — 회원 식별/upsert
 *   POST /api/cdp/event          — 행동 이벤트 기록
 *   POST /api/cdp/order          — 주문 sync + RFM 자동 갱신
 *   POST /api/cdp/bulk-import    — 초기 마이그레이션 (최대 1,000건/요청)
 *
 * 운영 모니터링 endpoint (회사 사용자 인증, 별도):
 *   GET  /api/cdp/recent-events  — 최근 이벤트 50건 (CdpSettingsPage 표시)
 *   GET  /api/cdp/usage          — 이번 달 API 호출 누적 + 한도
 *   POST /api/cdp/issue-key      — public/secret key 발급 또는 재발급 (raw 1회 노출)
 */

import { Router, Request, Response, json } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middlewares/auth';
import { resolveOwnerScope } from '../utils/owner-scope';
import { requireCdpApiKey, requireCdpBrowserOrigin, requireCdpKeyOrBrowserOrigin, recordCdpApiCall, issueCdpKeyPair, isCdpEnabledForPlan } from '../utils/cdp-auth';
import { isValidBundleId } from '../utils/cdp-app-id';
import { identifyCustomer, parseConsentValue } from '../utils/cdp-identity';
import { trackEvent, getRecentEvents, ingestBrowserEvents } from '../utils/cdp-events';
import { syncOrder, bulkImport } from '../utils/cdp-orders';
// ★ D214+ (2026-05-24) CDP 진단 + multi-source 융합 신규 CT 6건
// (query import = line 67 영역에서 단일 등록 — duplicate import X)
import { buildCdpDiagnostics, buildCdpFunnel, buildCdpTimeline24h } from '../utils/cdp-diagnostics';
import { buildCdpActiveCustomers } from '../utils/cdp-active-customers';
import { groupCustomersByChannel, getCompanyChannelCapabilities } from '../utils/source-aware-channel-selector';
import { explainCdpDiagnostics } from '../utils/cdp-fusion-explainer';
import { recomputeProfileBatch } from '../utils/unified-customer-profile';
// ★ D189 #4 (2026-05-22): Journey Step A/B/Bandit 트래킹 — SDK 호출용 endpoint
import { recordJourneyStepVariantReward } from '../utils/bandit-optimizer';
import { listProvidersForUI } from '../utils/provider-registry';
// ★ 2026-06-25 (gap 6): 회사별 버스트 rate limit — write 경로 폭주 1차 방어
import { cdpBurstLimit } from '../utils/cdp-burst-limit';
// ★ 2026-06-25 (gap 7): provider 등록은 app.ts registerAllProviders() 단일 출처로 이전
//   (기존 cafe24-client / naver-commerce-client side-effect import 제거 — 로드 순서 취약성 차단)
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
  isInAppMessageOwned,
  getActiveMessagesForCustomer,
  getActiveMessagesForCustomerV2,
  trackImpression,
  getMessageStats,
  getCompanyInAppStats,
  setInAppAudienceFilter,
  sanitizeAppMessageColors,
  sanitizeActionUrl,
  sanitizeButtonsActionUrls,
  sanitizePosterSlidesActionUrls,
} from '../utils/inapp-message';
// ★ 2026-07-18 P3 에셋 라이브러리 — 업로드 자동 등재 + 플랜별 용량 한도
import { registerAsset, getStorageUsage, isAssetsTableMissing } from '../utils/assets';
// ★ D215+ (2026-05-25) 인앱 메시지 압도적 강화 CT-77~84
import { generateInAppMessagePackage, listQuickStartCards } from '../utils/inapp-ai-generator';
// ★ 2026-07-06 인앱 표시 가능성 게이트 — 표시할 곳 없는 고객의 크레딧 낭비 차단 (네이버 단독 등)
import { getInAppDisplayEligibility } from '../utils/inapp-display-eligibility';
import { countSegment, describeSegment } from '../utils/inapp-segment-matcher';
import { buildPreviewCustomers, buildEditorPreviewCustomers, renderInAppMessage, listAvailableVariables, extractUsedInAppVariables, getInAppCustomerForBrowser, renderTextForCustomer, renderBlocksForCustomer } from '../utils/inapp-personalization';
import { getCompanyBrandKitRaw } from '../utils/dm/dm-brand-kit';
import { createVariant, listVariantsWithStats, declareWinnerIfReady } from '../utils/inapp-variant-optimizer';
import { explainInAppMessage } from '../utils/inapp-explainer';
import {
  buildInAppFunnel,
  buildHourlyDistribution,
  buildHeatmap,
  buildDeviceBreakdown,
  buildTopMessages,
  buildInAppOverview,
  buildIdentifiedViewers,
} from '../utils/inapp-funnel-stats';
import {
  quickActionAIRefine,
  quickActionTimeOptimize,
  quickActionSegmentRefine,
} from '../utils/inapp-quick-action';
import { query } from '../config/database';
import { checkCredit, deductCreditSafe, InsufficientCreditError } from '../utils/ai-credit';
import { getCreditCost } from '../utils/ai-credit-calc';

const router = Router();

// ★ 2026-06-25 (gap 6): CDP write 버스트 한도 — 회사당 50req/10초(보수적). bulk-import는 제외(월 한도+1000건 캡).
const cdpWriteBurst = cdpBurstLimit(50, 10_000);

// ════════════════════════════════════════════════════════════════════
// 외부 API (X-Hanjullo-Key + X-Hanjullo-Secret 인증)
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// ★ D226+ (2026-05-29) v0.3.5-a — Auto-Capture batch ingestion endpoint
// §12 #5 — schema_version 'v1' 의무 + 7 분류 PII masking 자동 (이중 안전망)
// ════════════════════════════════════════════════════════════════════

router.post('/ingest', requireCdpBrowserOrigin, cdpWriteBurst, async (req: Request, res: Response) => {
  try {
    const { schema_version, anonymous_id, session_id, sent_at, events } = req.body || {};

    if (schema_version !== 'v1') {
      return res.status(400).json({
        success: false,
        error: `schema_version 'v1' 의무 — 옛 값 = ${schema_version || '(누락)'}`,
        code: 'INVALID_SCHEMA_VERSION',
      });
    }

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'events 배열 비어 있음',
        code: 'EMPTY_EVENTS',
      });
    }

    if (events.length > 100) {
      return res.status(413).json({
        success: false,
        error: 'events 최대 100건/batch 한도 초과',
        code: 'BATCH_TOO_LARGE',
      });
    }

    const companyId = (req as any).cdpAuth?.companyId || (req as any).cdp?.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        error: 'CDP API key 인증 실패',
        code: 'AUTH_FAILED',
      });
    }

    // ★ 정규화 적재 (CT-21 ingestBrowserEvents) — SDK type → 표준 event_name +
    //   identify 식별 + 익명→회원 소급. PII masking 2차 안전망은 함수 내부 normalizeBrowserEvent에서 수행.
    //   옛 inline INSERT는 없는 event_type/payload 컬럼 참조로 항상 503이었음.
    const ingestResult = await ingestBrowserEvents(companyId, {
      anonymousId: anonymous_id || null,
      sessionId: session_id || null,
      schemaVersion: schema_version,
      sentAt: sent_at || null,
      events: events as Array<Record<string, any>>,
    });

    return res.json({
      success: true,
      accepted: ingestResult.accepted,
      schema_version,
    });
  } catch (err: any) {
    // 월간 호출 한도 초과 — 429 (다른 endpoint와 동일 코드)
    if (err?.code === 'MONTHLY_LIMIT_EXCEEDED') {
      return res.status(429).json({
        success: false,
        error: '이번 달 CDP 호출 한도를 초과했습니다.',
        code: 'MONTHLY_LIMIT_EXCEEDED',
      });
    }
    // ★ db_alter_safety_net 룰 정합 — column / relation does not exist 분기
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 의무 — 운영자에게 cdp_events ALTER 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'cdp_events 테이블 X — DB 마이그레이션 의무',
        code: 'DB_TABLE_MISSING',
      });
    }
    console.error('[CDP /ingest] 오류:', err);
    return res.status(500).json({
      success: false,
      error: '서버 오류 — 잠시 후 재시도',
      code: 'INTERNAL_ERROR',
    });
  }
});

// POST /api/cdp/identify — 회원 식별 / upsert
router.post('/identify', requireCdpApiKey, cdpWriteBurst, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { external_id, email, phone, name, birth_date, gender, grade, address, custom_fields, sms_opt_in, marketing_consent } = req.body;
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
      // 마케팅 수신동의 — 자사몰이 보낸 명시값만 반영 (미전달 시 기존값 유지·신규는 false)
      smsOptIn: parseConsentValue(sms_opt_in ?? marketing_consent),
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
router.post('/event', requireCdpApiKey, cdpWriteBurst, async (req: Request, res: Response) => {
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
router.post('/order', requireCdpApiKey, cdpWriteBurst, async (req: Request, res: Response) => {
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
// ★ D189 #4 (2026-05-22): Journey Step A/B/Bandit 트래킹 endpoint (SDK 호출용)
//   - cdpAuth (X-Hanjullo-Key + X-Hanjullo-Secret) 인증
//   - body: { clicked: 0|1, converted: 0|1 }
//   - 회사 격리: variant → step → journey → company_id 검증
//   - 기존 회사 admin 인증 endpoint(/api/ai/operator/journeys/variants/:variantId/track)와 별도
// ════════════════════════════════════════════════════════════════════

router.post('/journey-variants/:variantId/track', requireCdpKeyOrBrowserOrigin, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { variantId } = req.params;
    if (!variantId || !/^[a-f0-9-]{36}$/i.test(variantId)) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 400);
      return res.status(400).json({ success: false, error: 'variantId 형식이 올바르지 않습니다.' });
    }

    // 회사 격리 검증 — variant → step → journey → company_id
    const own = await query(
      `SELECT 1 FROM journey_step_variants v
       JOIN journey_steps s ON v.step_id = s.id
       JOIN journeys j ON s.journey_id = j.id
       WHERE v.id = $1::uuid AND j.company_id = $2::uuid`,
      [variantId, cdpAuth.companyId]
    );
    if (own.rows.length === 0) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 404);
      return res.status(404).json({ success: false, error: 'variant를 찾을 수 없습니다.' });
    }

    const { clicked, converted } = req.body || {};
    const clickedN = Math.max(0, Math.min(1, Number(clicked) || 0));
    const convertedN = Math.max(0, Math.min(1, Number(converted) || 0));
    if (clickedN === 0 && convertedN === 0) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 400);
      return res.status(400).json({ success: false, error: 'clicked 또는 converted 중 최소 1건은 필수입니다.' });
    }

    await recordJourneyStepVariantReward(variantId, 0, clickedN, convertedN);
    await recordCdpApiCall(cdpAuth.companyId, 'event', 200);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[CDP /journey-variants/track] 오류:', err);
    await recordCdpApiCall(cdpAuth.companyId, 'event', 500);
    return res.status(500).json({ success: false, error: err?.message || 'track 처리 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D178 (2026-05-19) — 자체 호스팅 자사몰 Webhook (HMAC-SHA256 서명 인증)
//   Harold 명시 — "카페24보다 자체 호스팅 자사몰 위주". 회사 자체 자사몰이 webhook_secret 발급 후 POST 호출.
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
          error: 'webhook_secret이 발급되지 않은 회사입니다. 한줄로 관리자 → 자사몰 연동(CDP)에서 발급받아주세요.',
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
        // 2026-06-10 정정: updated_at은 cdp_webhook_deliveries에 없는 컬럼(실측) — 포함 시 중복 응답이 전부 500
        await query(
          `UPDATE cdp_webhook_deliveries
           SET status = 'duplicate', processed_at = NOW()
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

// GET /api/cdp/push/vapid-public-key — SDK가 구독 진행 시 활용 (인증 불요, 공개 키)
router.get('/push/vapid-public-key', (_req: Request, res: Response) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ success: false, error: 'VAPID 환경변수가 설정되지 않았습니다.' });
  return res.json({ success: true, vapid_public_key: key });
});

// POST /api/cdp/push/subscribe — SDK가 사용자 구독 등록
router.post('/push/subscribe', requireCdpKeyOrBrowserOrigin, async (req: Request, res: Response) => {
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
router.post('/push/unsubscribe', requireCdpKeyOrBrowserOrigin, async (req: Request, res: Response) => {
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
// ★ D215+ V2 (2026-05-25) — 시간대 + 세그먼트 + variant 통합 검증 (CT-78 + CT-80 + CT-82)
// 인앱 이미지 저장 경로 (공개 서빙 + 인증 업로드 양쪽에서 참조)
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');
const INAPP_IMAGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/cdp/inapp/image/:companyId/:filename — 인앱 이미지 공개 서빙 (자사몰 방문자 img 직접 GET, 인증 X)
//   ★ /uploads 정적 서빙이 없어 저장 URL이 404로 깨지던 문제 차단. mms-images.ts GET 서빙 패턴.
router.get('/inapp/image/:companyId/:filename', (req: any, res: any) => {
  const { companyId, filename } = req.params;
  if (!INAPP_IMAGE_UUID.test(companyId)) return res.status(400).json({ success: false, error: '잘못된 요청' });
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ success: false, error: '잘못된 파일명' });
  }
  const filePath = path.join(INAPP_IMAGE_BASE, companyId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: '이미지를 찾을 수 없습니다.' });
  const ext = path.extname(filename).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  // 자사몰(타 도메인)의 <img>로 로드 — helmet 기본 Cross-Origin-Resource-Policy: same-origin이 cross-origin 이미지를 막으므로 명시 허용
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(path.resolve(filePath));
});

router.get('/inapp/active', requireCdpKeyOrBrowserOrigin, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const trigger = String(req.query.trigger || 'page_load');
    const externalId = req.query.external_id ? String(req.query.external_id) : undefined;
    const anonymousId = req.query.anonymous_id ? String(req.query.anonymous_id) : undefined;
    const seenRaw = req.query.seen ? String(req.query.seen) : '';
    const seenMessageIds = seenRaw ? seenRaw.split(',').filter(Boolean) : [];

    const reqChannel = req.query.channel === 'app' ? 'app' : 'web';
    const messages = await getActiveMessagesForCustomerV2({
      companyId: cdpAuth.companyId,
      triggerEvent: trigger,
      externalId,
      anonymousId,
      // ★ 2026-07-16 (Codex 1R) — opt_out 억제의 identity_link 조회를 source로 한정 (/inapp/track과 동일 축)
      source: cdpAuth.source,
      seenMessageIds,
      channel: reqChannel,
    });

    // ★ 2026-07-17 CTA URL 서빙 정규화(전 채널) — 프로토콜 없는 도메인(www.xxx)을 https://로 보정.
    //   빠지면 SDK가 상대경로로 해석해 "몰도메인/www.poppon.co.kr"(404)로 이동 → CTA가 "안 가던" 근본.
    //   기존 메시지도 재저장 없이 즉시 복구(저장 sanitizeActionUrl과 동일 로직 재사용, DB 무변경).
    for (const m of messages as any[]) {
      if (m.actionUrl) m.actionUrl = sanitizeActionUrl(m.actionUrl);
      if (Array.isArray(m.buttons)) m.buttons = sanitizeButtonsActionUrls(m.buttons);
      // ★ 2026-07-21 포스터 캐러셀 슬라이드 CTA URL도 서빙 정규화(프로토콜 없는 도메인→https) — 2026-07-31 슬라이드 link_url 포함
      if (Array.isArray(m.posterSlides)) m.posterSlides = sanitizePosterSlidesActionUrls(m.posterSlides);
      // ★ 2026-07-31 이미지 클릭 링크도 동일 정규화
      if (m.imageLinkUrl) m.imageLinkUrl = sanitizeActionUrl(m.imageLinkUrl);
    }

    // web 채널 허용 형태 — 그 밖 형태(옛 배너 등)는 모달로 보정. 기존 메시지 포함, DB 무변경.
    // ★ 2026-07-18 P1: full_image(포스터형) 등재 — 빠지면 B형이 center_modal로 강제 변환돼 렌더가 어긋난다.
    if (reqChannel === 'web') {
      const WEB_OK = new Set(['center_modal', 'slide_in', 'toast', 'floating_button', 'full_image']);
      for (const m of messages as any[]) {
        const t = m.template || m.position;
        if (t && !WEB_OK.has(t)) m.template = 'center_modal';
      }
    }

    // ★ 2026-07-17 app 채널은 색상 필드를 단색 hex로 보정 — 네이티브 앱(Android/iOS) Color 파서가
    //   CSS 그라데이션(linear-gradient)에서 예외로 앱이 강제종료되던 근본 차단. 웹은 그라데이션 유지(DB 무변경).
    if (reqChannel === 'app') {
      for (const m of messages as any[]) sanitizeAppMessageColors(m);
    }

    // T3 (2026-06-11) — 자동 기동 개인화: 메시지들이 실제 쓰는 변수만 customer로 동봉 (식별 회원 한정)
    let customer: Record<string, any> | null = null;
    if (externalId && messages.length > 0) {
      const usedVars = extractUsedInAppVariables(messages);
      if (usedVars.length > 0) {
        customer = await getInAppCustomerForBrowser(cdpAuth.companyId, externalId, usedVars).catch(() => null);
      }
    }

    // ★ 2026-07-08 서버 사전 치환 — 익명·미식별 방문자도 변수 공백("님,"/"회원님")이 안 나오게.
    //   이름 없으면 "고객", 빈 변수는 공백 정리. 식별 회원은 실제 값 그대로(회귀 0). SDK는 치환된 텍스트를 그대로 표시.
    if (messages.length > 0) {
      const renderCustomer: Record<string, any> = { ...(customer || {}) };
      if (!renderCustomer.name) renderCustomer.name = '고객';
      for (const m of messages as any[]) {
        if (typeof m.title === 'string') m.title = renderTextForCustomer(m.title, renderCustomer).rendered;
        if (typeof m.body === 'string') m.body = renderTextForCustomer(m.body, renderCustomer).rendered;
        if (Array.isArray(m.buttons)) {
          m.buttons = m.buttons.map((b: any) =>
            b && typeof b.label === 'string' ? { ...b, label: renderTextForCustomer(b.label, renderCustomer).rendered } : b,
          );
        }
        const blocksRaw = m.contentBlocks ?? m.content_blocks;
        if (blocksRaw != null) {
          const rendered = renderBlocksForCustomer(blocksRaw, renderCustomer);
          if ('contentBlocks' in m) m.contentBlocks = rendered;
          if ('content_blocks' in m) m.content_blocks = rendered;
        }
        // ★ 2026-07-21 포스터 캐러셀 슬라이드 개인화 (제목/본문/CTA 라벨) — 익명 폴백·식별 치환 동일 기준
        if (Array.isArray(m.posterSlides)) {
          m.posterSlides = m.posterSlides.map((s: any) => {
            if (!s || typeof s !== 'object') return s;
            const out: any = { ...s };
            if (typeof s.title === 'string') out.title = renderTextForCustomer(s.title, renderCustomer).rendered;
            if (typeof s.body === 'string') out.body = renderTextForCustomer(s.body, renderCustomer).rendered;
            if (s.cta && typeof s.cta === 'object' && typeof s.cta.label === 'string') {
              out.cta = { ...s.cta, label: renderTextForCustomer(s.cta.label, renderCustomer).rendered };
            }
            return out;
          });
        }
      }
    }

    await recordCdpApiCall(cdpAuth.companyId, 'event', 200);
    return res.json({ success: true, messages, ...(customer ? { customer } : {}) });
  } catch (err: any) {
    console.error('[CDP /inapp/active] 오류:', err);
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 503);
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 cdp_inapp_messages ALTER 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    await recordCdpApiCall(cdpAuth.companyId, 'event', 500);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// POST /api/cdp/inapp/track — SDK가 impression/click/dismiss/opt_out 기록
// ★ D215+ (2026-05-25) — button_id / dwell_seconds 신규 컬럼 처리 + 503 안전망
// ★ 2026-07-16 — opt_out("다시 보지 않기") 추가: getActiveMessagesForCustomerV2가 영구 억제 근거로 사용
router.post('/inapp/track', requireCdpKeyOrBrowserOrigin, async (req: Request, res: Response) => {
  const cdpAuth = req.cdpAuth!;
  try {
    const { message_id, event_type, external_id, anonymous_id, button_id, dwell_seconds } = req.body;
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
      buttonId: button_id ? String(button_id).slice(0, 50) : null,
      dwellSeconds: typeof dwell_seconds === 'number' && dwell_seconds >= 0 ? Math.floor(dwell_seconds) : null,
    });
    await recordCdpApiCall(cdpAuth.companyId, 'event', 200);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[CDP /inapp/track] 오류:', err);
    const msg = err?.message || '';
    // ★ P0-3 (2026-07-12) — message 소유 불일치(타사/임의 uuid) = 400 (trackImpression CT 소유 검증 throw 매핑)
    if (msg.includes('메시지를 찾을 수 없습니다')) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 400);
      return res.status(400).json({ success: false, error: msg });
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      await recordCdpApiCall(cdpAuth.companyId, 'event', 503);
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 cdp_inapp_impressions ALTER 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
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
        smsOptIn: parseConsentValue(c.sms_opt_in ?? c.marketing_consent),
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
          c.cdp_api_key AS public_key,
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
      public_key: row.public_key || null,
      issued_at: row.issued_at,
      monthly_limit: row.monthly_limit,           // NULL = 무제한
      used: parseInt(row.used || '0'),
    });
  } catch (err: any) {
    console.error('[CDP /usage] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// GET /api/cdp/install-status — SDK 설치 후 첫 이벤트 수신 진단 (v0.3.5-b)
//   heartbeat 5단계는 SDK 클라이언트 로컬 mark(서버 미전송)라, 서버 관측 신호(수신 이벤트 타입)로 진단한다.
router.get('/install-status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const keyRow = await query(
      `SELECT cdp_api_key_issued_at FROM companies WHERE id = $1::uuid`,
      [companyId],
    );
    const keyIssuedAt = keyRow.rows[0]?.cdp_api_key_issued_at || null;

    const ev = await query(
      `SELECT
         MIN(received_at) AS first_event_at,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours') AS count_24h,
         BOOL_OR(event_name = 'page_view') AS has_pageview,
         BOOL_OR(event_name = 'identify')  AS has_identify,
         BOOL_OR(event_name = 'consent')   AS has_consent,
         BOOL_OR(event_name = 'click')     AS has_click
       FROM cdp_events
       WHERE company_id = $1::uuid`,
      [companyId],
    );
    const row = ev.rows[0] || {};

    // ★ 2026-08-10 Phase 0 — 자사몰(source)별 분리 집계 추가.
    //   기존 쿼리·응답 키는 그대로 둔다(additive) — 회사 단위 값을 보는 기존 소비처 무파손.
    //   연동 현황판이 몰 카드별 배지를 그리려면 회사 합계가 아니라 source별 실적이 필요하다(설계서 §2-3-1·§6).
    //   source는 trackEvent 필수 인자라 정상 적재분에는 항상 있다. 옛 행 대비 NULL은 'unknown'으로 묶는다.
    const bySourceRows = await query(
      `SELECT
         COALESCE(source, 'unknown') AS source,
         MIN(received_at) AS first_event_at,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours') AS count_24h,
         MAX(received_at) AS last_event_at,
         BOOL_OR(event_name = 'page_view') AS has_pageview,
         BOOL_OR(event_name = 'identify')  AS has_identify,
         BOOL_OR(event_name = 'consent')   AS has_consent,
         BOOL_OR(event_name = 'click')     AS has_click
       FROM cdp_events
       WHERE company_id = $1::uuid
       GROUP BY COALESCE(source, 'unknown')`,
      [companyId],
    );
    const bySource: Record<string, {
      firstEventAt: string | null; lastEventAt: string | null;
      total: number; count24h: number;
      signals: { pageview: boolean; identify: boolean; consent: boolean; click: boolean };
    }> = {};
    for (const r of bySourceRows.rows) {
      bySource[String(r.source)] = {
        firstEventAt: r.first_event_at || null,
        lastEventAt: r.last_event_at || null,
        total: parseInt(r.total || '0'),
        count24h: parseInt(r.count_24h || '0'),
        signals: {
          pageview: !!r.has_pageview,
          identify: !!r.has_identify,
          consent: !!r.has_consent,
          click: !!r.has_click,
        },
      };
    }

    return res.json({
      success: true,
      keyIssuedAt,
      firstEventAt: row.first_event_at || null,
      total: parseInt(row.total || '0'),
      count24h: parseInt(row.count_24h || '0'),
      signals: {
        pageview: !!row.has_pageview,
        identify: !!row.has_identify,
        consent: !!row.has_consent,
        click: !!row.has_click,
      },
      bySource,
    });
  } catch (err: any) {
    // db_alter_safety_net — cdp_events 신규 컬럼 미마이그레이션 시 503
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 cdp_events ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /install-status] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// GET /api/cdp/allowed-origins — 브라우저 SDK 수집 허용 도메인 목록 (Origin allowlist)
router.get('/allowed-origins', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const r = await query(`SELECT cdp_allowed_origins FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, origins: r.rows[0]?.cdp_allowed_origins || [] });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_origins ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /allowed-origins GET] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/cdp/allowed-origins — 도메인 추가 (회사 관리자) body { origin }
router.post('/allowed-origins', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '도메인 등록은 회사 관리자만 가능합니다.' });
    }
    const origin = String(req.body?.origin || '').trim().toLowerCase().replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)) {
      return res.status(400).json({ success: false, error: 'https:// 도메인 형식만 허용됩니다. (예: https://www.example.com)' });
    }
    await query(
      `UPDATE companies
         SET cdp_allowed_origins = ARRAY(SELECT DISTINCT unnest(COALESCE(cdp_allowed_origins, '{}'::text[]) || $2::text[])),
             updated_at = NOW()
       WHERE id = $1::uuid`,
      [companyId, [origin]],
    );
    const r = await query(`SELECT cdp_allowed_origins FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, origins: r.rows[0]?.cdp_allowed_origins || [] });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_origins ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /allowed-origins POST] 오류:', err);
    return res.status(500).json({ success: false, error: '등록 실패' });
  }
});

// DELETE /api/cdp/allowed-origins — 도메인 삭제 (회사 관리자) body { origin }
router.delete('/allowed-origins', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '도메인 삭제는 회사 관리자만 가능합니다.' });
    }
    const origin = String(req.body?.origin || '').trim().toLowerCase().replace(/\/+$/, '');
    await query(
      `UPDATE companies SET cdp_allowed_origins = array_remove(COALESCE(cdp_allowed_origins, '{}'::text[]), $2), updated_at = NOW()
       WHERE id = $1::uuid`,
      [companyId, origin],
    );
    const r = await query(`SELECT cdp_allowed_origins FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, origins: r.rows[0]?.cdp_allowed_origins || [] });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_origins ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /allowed-origins DELETE] 오류:', err);
    return res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

// ═══════════════════════════════════════════════════════════
// 네이티브 앱 등록 (cdp_allowed_app_ids) — allowed-origins의 앱 버전
//   앱은 시크릿·Origin 없이 public key + 등록 번들ID로 인증(requireCdpAppId).
// ═══════════════════════════════════════════════════════════

// GET /api/cdp/allowed-app-ids — 네이티브 앱 키 인증 허용 번들ID 목록
router.get('/allowed-app-ids', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const r = await query(`SELECT cdp_allowed_app_ids FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, appIds: r.rows[0]?.cdp_allowed_app_ids || [] });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_app_ids ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /allowed-app-ids GET] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/cdp/allowed-app-ids — 번들ID 추가 (회사 관리자) body { appId }
router.post('/allowed-app-ids', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (req.user?.userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '앱 등록은 회사 관리자만 가능합니다.' });
    }
    const appId = String(req.body?.appId || '').trim().toLowerCase();
    if (!isValidBundleId(appId)) {
      return res.status(400).json({ success: false, error: '번들ID 형식만 허용됩니다. (예: kr.poppon.app)' });
    }
    await query(
      `UPDATE companies
         SET cdp_allowed_app_ids = ARRAY(SELECT DISTINCT unnest(COALESCE(cdp_allowed_app_ids, '{}'::text[]) || $2::text[])),
             updated_at = NOW()
       WHERE id = $1::uuid`,
      [companyId, [appId]],
    );
    const r = await query(`SELECT cdp_allowed_app_ids FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, appIds: r.rows[0]?.cdp_allowed_app_ids || [] });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_app_ids ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /allowed-app-ids POST] 오류:', err);
    return res.status(500).json({ success: false, error: '등록 실패' });
  }
});

// DELETE /api/cdp/allowed-app-ids — 번들ID 삭제 (회사 관리자) body { appId }
router.delete('/allowed-app-ids', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (req.user?.userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '앱 삭제는 회사 관리자만 가능합니다.' });
    }
    const appId = String(req.body?.appId || '').trim().toLowerCase();
    await query(
      `UPDATE companies SET cdp_allowed_app_ids = array_remove(COALESCE(cdp_allowed_app_ids, '{}'::text[]), $2), updated_at = NOW()
       WHERE id = $1::uuid`,
      [companyId, appId],
    );
    const r = await query(`SELECT cdp_allowed_app_ids FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, appIds: r.rows[0]?.cdp_allowed_app_ids || [] });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_app_ids ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /allowed-app-ids DELETE] 오류:', err);
    return res.status(500).json({ success: false, error: '삭제 실패' });
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
      return res.status(403).json({ success: false, error: 'Web Push는 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
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
    if (resolveOwnerScope(req)) return res.status(403).json({ success: false, error: '인앱 메시지는 회사 관리자만 이용할 수 있습니다.' });
    const channelRaw = req.query.channel ? String(req.query.channel) : undefined;
    const channel = channelRaw === 'web' || channelRaw === 'app' ? channelRaw : undefined;
    const messages = await listInAppMessages(companyId, channel, resolveOwnerScope(req));
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

// ★ D210+ Phase 3 B-4 (2026-05-23 Harold 명시): 회사 전체 인앱 메시지 통계 (CTR + funnel)
//   GET /api/cdp/inapp/stats — 메시지별 impression / click / dismiss / CTR / dismissRate / 고유 인상
router.get('/inapp/stats', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // 회사 전체 집계 = 관리자 조회 영역 (담당자는 본인 메시지 목록/개별 통계로 확인)
    if (resolveOwnerScope(req)) return res.status(403).json({ success: false, error: '회사 전체 통계는 관리자만 조회할 수 있습니다.' });
    const ch = req.query.channel === 'web' || req.query.channel === 'app' ? req.query.channel : undefined;
    const stats = await getCompanyInAppStats(companyId, ch);
    return res.json({ success: true, stats });
  } catch (err: any) {
    console.error('[CDP /inapp/stats] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '통계 조회 실패' });
  }
});

// ★ 2026-07-06 인앱 표시 가능성 조회 — 상태 패널 + 프론트 생성 가드 (연동 플랫폼별 지원 + SDK 신호)
router.get('/inapp/display-eligibility', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (resolveOwnerScope(req)) return res.status(403).json({ success: false, error: '인앱 메시지는 회사 관리자만 이용할 수 있습니다.' });
    const eligibility = await getInAppDisplayEligibility(companyId);
    return res.json({ success: true, eligibility });
  } catch (err: any) {
    console.error('[CDP /inapp/display-eligibility] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.post('/inapp', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (resolveOwnerScope(req)) return res.status(403).json({ success: false, error: '인앱 메시지는 회사 관리자만 이용할 수 있습니다.' });
    const cdpEnabled = await isCdpEnabledForPlan(companyId);
    if (!cdpEnabled) {
      return res.status(403).json({ success: false, error: 'In-app 메시지는 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
    }

    // ★ 종량제: 인앱 게시(확정) = 15, status=active 저장 시 최초 1회(멱등 inapp-publish:messageId). paused/archived 저장은 미과금.
    const willPublish = (req.body?.status ?? 'active') === 'active';
    // ★ 2026-07-06 표시 가능성 게이트 — 표시할 곳 없는 웹 인앱 게시 = 크레딧 차감 전 차단 (돈 낭비 방지, Harold 확정)
    //   channel 판정은 createInAppMessage와 동일('app' 외 전부 'web'). 게이트 실패는 격리 — 판정 오류로 게시 자체를 막지 않는다.
    if (willPublish && (req.body?.channel === 'app' ? 'app' : 'web') === 'web') {
      const elig = await getInAppDisplayEligibility(companyId).catch(() => null);
      if (elig && !elig.canCreateWeb) {
        return res.status(400).json({ success: false, error: elig.blockReasonWeb, code: 'INAPP_DISPLAY_UNAVAILABLE' });
      }
    }
    if (willPublish) await checkCredit(companyId, getCreditCost('inapp-publish'));
    const message = await createInAppMessage(companyId, userId, req.body);
    if (message?.status === 'active') {
      await deductCreditSafe({
        companyId, cost: getCreditCost('inapp-publish'), source: 'inapp-publish', createdBy: userId,
        idempotencyKey: `inapp-publish:${message.id}`,
      });
    }
    return res.json({ success: true, message });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    const msg = err?.message || '';
    if (msg.startsWith('BENEFIT_PLACEHOLDER_UNEDITED')) {
      return res.status(400).json({ success: false, error: msg.replace(/^BENEFIT_PLACEHOLDER_UNEDITED:\s*/, ''), code: 'BENEFIT_PLACEHOLDER_UNEDITED' });
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 cdp_inapp_messages ALTER(badge_text) 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /inapp POST] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '생성 실패' });
  }
});

router.put('/inapp/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const ownerId = resolveOwnerScope(req);
    if (ownerId) return res.status(403).json({ success: false, error: '인앱 메시지는 회사 관리자만 이용할 수 있습니다.' });
    if (!(await isInAppMessageOwned(companyId, req.params.id, ownerId))) {
      return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    }
    // ★ 2026-07-06 표시 가능성 게이트 — 웹 메시지를 active로 저장(게시/재개)할 때만.
    //   paused/archived 저장은 통과(중단은 언제나 허용). 판정 오류는 격리(수정 자체를 막지 않음).
    if (req.body?.status === 'active') {
      const chRes = await query(
        `SELECT channel FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid`,
        [req.params.id, companyId],
      ).catch(() => null);
      const msgChannel = chRes?.rows?.[0]?.channel === 'app' ? 'app' : 'web';
      if (msgChannel === 'web') {
        const elig = await getInAppDisplayEligibility(companyId).catch(() => null);
        if (elig && !elig.canCreateWeb) {
          return res.status(400).json({ success: false, error: elig.blockReasonWeb, code: 'INAPP_DISPLAY_UNAVAILABLE' });
        }
      }
    }
    const message = await updateInAppMessage(companyId, req.params.id, req.body, ownerId);
    if (!message) return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    // ★ 종량제: paused→active 게시 시 15(멱등 inapp-publish:messageId — POST에서 이미 과금됐으면 0).
    if (message.status === 'active') {
      await deductCreditSafe({
        companyId, cost: getCreditCost('inapp-publish'), source: 'inapp-publish', createdBy: req.user?.userId,
        idempotencyKey: `inapp-publish:${message.id}`,
      });
    }
    return res.json({ success: true, message });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.startsWith('BENEFIT_PLACEHOLDER_UNEDITED')) {
      return res.status(400).json({ success: false, error: msg.replace(/^BENEFIT_PLACEHOLDER_UNEDITED:\s*/, ''), code: 'BENEFIT_PLACEHOLDER_UNEDITED' });
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 cdp_inapp_messages ALTER(badge_text) 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /inapp PUT] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '수정 실패' });
  }
});

// 타겟 추출 filter를 인앱 메시지 표시 대상으로 저장 (P3 — 비-문자 타겟추출)
router.put('/inapp/:id/audience-filter', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const ownerId = resolveOwnerScope(req);
    if (ownerId) return res.status(403).json({ success: false, error: '인앱 메시지는 회사 관리자만 이용할 수 있습니다.' });
    const raw = req.body?.filter;
    const filter = raw && typeof raw === 'object' && Object.keys(raw).length > 0 ? raw : null;
    const ok = await setInAppAudienceFilter(companyId, req.params.id, filter, ownerId);
    if (!ok) return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 cdp_inapp_messages ALTER(audience_filter) 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /inapp audience-filter] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '저장 실패' });
  }
});

router.delete('/inapp/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const ownerId = resolveOwnerScope(req);
    if (ownerId) return res.status(403).json({ success: false, error: '인앱 메시지는 회사 관리자만 이용할 수 있습니다.' });
    const ok = await deleteInAppMessage(companyId, req.params.id, ownerId);
    if (!ok) return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[CDP /inapp DELETE] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '삭제 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D215+ (2026-05-25) 인앱 메시지 압도적 강화 — 신규 endpoint 12건
//   설계서 §5 명시 8건 + Frontend 통합 보조 4건 (overview / top-messages / quick-start-cards / available-variables)
//   모든 endpoint = 회사 admin 권한 + BUSINESS+ 게이팅 + DB ALTER 503 안전망
// ════════════════════════════════════════════════════════════════════

// 인앱 이미지 업로드 multer setup (INAPP_IMAGE_BASE = 상단 공개 서빙 영역에 정의)
const inappImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB (인앱 이미지 = MMS 대비 크기 여유)
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedExts.includes(ext) && allowedMimes.includes(mime)) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일 (jpg/png/gif/webp)만 업로드 가능합니다.'));
    }
  },
});

// 인앱메시지 접근 = 회사 관리자 전용(공유 화면 특성) + 유료 플랜 게이팅 공통 헬퍼
async function ensureInAppAccess(req: Request, res: Response): Promise<{ companyId: string; userId: string; ownerId: string | null } | null> {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  const userType = req.user?.userType;
  if (!companyId || !userId) {
    res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    return null;
  }
  // ★ 인앱메시지 = 회사 관리자 전용 (담당자 다중 발행 시 공유 화면 겹침 — Harold 확정). 사용자 접근 차단.
  if (userType !== 'company_admin' && userType !== 'super_admin') {
    res.status(403).json({ success: false, error: '인앱 메시지는 회사 관리자만 이용할 수 있습니다.' });
    return null;
  }
  const cdpEnabled = await isCdpEnabledForPlan(companyId);
  if (!cdpEnabled) {
    res.status(403).json({ success: false, error: '인앱 메시지는 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
    return null;
  }
  const isAdmin = userType === 'company_admin' || userType === 'super_admin';
  return { companyId, userId, ownerId: isAdmin ? null : userId };
}

// DB ALTER 503 분기 공통 헬퍼 (db_alter_safety_net 룰)
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

// ─────────────────────────────────────────────────────────────────────
// 1. POST /api/cdp/inapp/ai-generate — 자연어 → 완전 메시지 자동 생성 (CT-77)
// ─────────────────────────────────────────────────────────────────────
router.post('/inapp/ai-generate', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    // ★ 2026-07-06 표시 가능성 게이트 — AI 생성도 크레딧 소모라, 표시할 곳이 전혀 없으면(SDK 신호 0 + 표시 지원 연동 0) 차단.
    //   앱 SDK·자체몰 설치 회사는 SDK 신호로 통과. 판정 오류는 격리(생성을 막지 않음).
    const elig = await getInAppDisplayEligibility(auth.companyId).catch(() => null);
    if (elig && !elig.canCreateWeb) {
      return res.status(400).json({ success: false, error: elig.blockReasonWeb, code: 'INAPP_DISPLAY_UNAVAILABLE' });
    }
    const { objective, templateHint, event_text } = req.body;
    const pkg = await generateInAppMessagePackage({
      companyId: auth.companyId,
      createdBy: auth.userId,
      objective,
      templateHint,
      // ★ 2026-07-07(4) 행사 캠페인 — 행사 원문 기반 생성 (기재 혜택만 원문 그대로 통과)
      eventText: typeof event_text === 'string' ? event_text : undefined,
    });
    return res.json({ success: true, package: pkg });
  } catch (err: any) {
    console.error('[CDP /inapp/ai-generate] 오류:', err);
    if (handleDbMigrationError(err, res, 'cdp_inapp_messages')) return;
    return res.status(500).json({ success: false, error: err?.message || 'AI 생성 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 2. POST /api/cdp/inapp/explain — CTR 영향 요인 + 개선 추천 (CT-81)
// ─────────────────────────────────────────────────────────────────────
router.post('/inapp/explain', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    const { message_id } = req.body;
    if (!message_id) return res.status(400).json({ success: false, error: 'message_id 필수' });
    if (!(await isInAppMessageOwned(auth.companyId, String(message_id), auth.ownerId))) {
      return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    }
    const result = await explainInAppMessage(auth.companyId, String(message_id));
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[CDP /inapp/explain] 오류:', err);
    if (handleDbMigrationError(err, res, 'cdp_inapp_messages')) return;
    return res.status(500).json({ success: false, error: err?.message || 'Explain 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 3. POST /api/cdp/inapp/quick-action — 1-click 액션 (CT-84)
// ─────────────────────────────────────────────────────────────────────
router.post('/inapp/quick-action', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    const { message_id, action_type } = req.body;
    if (!message_id || !action_type) {
      return res.status(400).json({ success: false, error: 'message_id + action_type 필수' });
    }
    if (!(await isInAppMessageOwned(auth.companyId, String(message_id), auth.ownerId))) {
      return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    }
    let result;
    if (action_type === 'ai_refine') {
      result = await quickActionAIRefine(auth.companyId, String(message_id), auth.userId);
    } else if (action_type === 'time_optimize') {
      result = await quickActionTimeOptimize(auth.companyId, String(message_id));
    } else if (action_type === 'segment_refine') {
      result = await quickActionSegmentRefine(auth.companyId, String(message_id));
    } else {
      return res.status(400).json({ success: false, error: `허용되지 않는 action_type: ${action_type}` });
    }
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[CDP /inapp/quick-action] 오류:', err);
    if (handleDbMigrationError(err, res, 'cdp_inapp_messages')) return;
    return res.status(500).json({ success: false, error: err?.message || 'Quick action 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 4. GET /api/cdp/inapp/preview/:id — 실시간 미리보기 (CT-79 + Liquid 치환)
// ─────────────────────────────────────────────────────────────────────
router.get('/inapp/preview/:id', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    const messageId = req.params.id;
    if (!(await isInAppMessageOwned(auth.companyId, messageId, auth.ownerId))) {
      return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    }
    const msgR = await query(
      `SELECT id, title, body, action_url, action_label, position, background_color, text_color,
              trigger_event, display_frequency, start_at, end_at, status,
              template, image_url, buttons, segment_conditions, trigger_conditions,
              personalization_vars, parent_message_id, variant_weight,
              auto_dismiss_seconds, max_displays_per_user,
              send_start_hour, send_end_hour, allowed_weekdays, locale_variants, animation
       FROM cdp_inapp_messages
       WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
      [messageId, auth.companyId]
    );
    if (msgR.rows.length === 0) return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    const row = msgR.rows[0];

    const previewCustomers = await buildPreviewCustomers(auth.companyId);

    // 각 customer별 Liquid 변수 치환 렌더링
    const renderedPreviews = previewCustomers.map((pc) => {
      const generatedMessage = {
        title: row.title,
        body: row.body,
        template: row.template || row.position || 'top_banner',
        image_url: row.image_url,
        buttons: Array.isArray(row.buttons) ? row.buttons : [],
        background_color: row.background_color,
        text_color: row.text_color,
        segment_conditions: row.segment_conditions || {},
        trigger_conditions: row.trigger_conditions || { event: 'page_load' },
        personalization_vars: row.personalization_vars || [],
        display_frequency: row.display_frequency,
        auto_dismiss_seconds: row.auto_dismiss_seconds,
        max_displays_per_user: row.max_displays_per_user,
        send_start_hour: row.send_start_hour,
        send_end_hour: row.send_end_hour,
        allowed_weekdays: row.allowed_weekdays || [0, 1, 2, 3, 4, 5, 6],
        animation: row.animation || 'fade',
        is_ad: false,
      };
      const rendered = renderInAppMessage(generatedMessage as any, pc.customer);
      return {
        customerLabel: pc.label,
        customerSample: pc.customer,
        rendered,
      };
    });

    return res.json({
      success: true,
      message: row,
      previews: renderedPreviews,
      // ★ 2026-07-02 회사 실데이터 필드만 노출 (CT-58 필터)
      availableVariables: await listAvailableVariables(auth.companyId),
    });
  } catch (err: any) {
    console.error('[CDP /inapp/preview] 오류:', err);
    if (handleDbMigrationError(err, res, 'cdp_inapp_messages')) return;
    return res.status(500).json({ success: false, error: err?.message || '미리보기 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 5. GET /api/cdp/inapp/funnel-stats/:id — funnel + 시간대 + 히트맵 + 디바이스 (CT-83)
// ─────────────────────────────────────────────────────────────────────
router.get('/inapp/funnel-stats/:id', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    const messageId = req.params.id;
    if (!(await isInAppMessageOwned(auth.companyId, messageId, auth.ownerId))) {
      return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    }
    const [funnel, hourly, heatmap, device] = await Promise.all([
      buildInAppFunnel(auth.companyId, messageId),
      buildHourlyDistribution(auth.companyId, messageId),
      buildHeatmap(auth.companyId, messageId),
      buildDeviceBreakdown(auth.companyId, messageId),
    ]);
    return res.json({
      success: true,
      funnel,
      hourly,
      heatmap,
      device,
    });
  } catch (err: any) {
    console.error('[CDP /inapp/funnel-stats] 오류:', err);
    if (handleDbMigrationError(err, res, 'cdp_inapp_impressions')) return;
    return res.status(500).json({ success: false, error: err?.message || 'Funnel 통계 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 5-1. GET /api/cdp/inapp/viewers/:id — ★ 2026-07-06 식별 고객 열람 목록 + 익명 합산 (Harold 확정 절충안)
//   인앱은 익명 다수라 DM식 전 명단 불가 — 식별분만 목록, 나머지는 익명 N명 정직 합산.
// ─────────────────────────────────────────────────────────────────────
router.get('/inapp/viewers/:id', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    if (!(await isInAppMessageOwned(auth.companyId, req.params.id, auth.ownerId))) {
      return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    }
    const result = await buildIdentifiedViewers(auth.companyId, req.params.id);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[CDP /inapp/viewers] 오류:', err);
    if (handleDbMigrationError(err, res, 'cdp_inapp_impressions')) return;
    return res.status(500).json({ success: false, error: err?.message || '열람 고객 조회 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 6. POST /api/cdp/inapp/segment-preview — 세그먼트 매칭 customer 수 (CT-78)
// ─────────────────────────────────────────────────────────────────────
router.post('/inapp/segment-preview', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    const { segment_conditions } = req.body;
    if (!segment_conditions || typeof segment_conditions !== 'object') {
      return res.status(400).json({ success: false, error: 'segment_conditions 필수 (object)' });
    }
    const count = await countSegment(auth.companyId, segment_conditions);
    const description = describeSegment(segment_conditions);
    return res.json({ success: true, count, description });
  } catch (err: any) {
    console.error('[CDP /inapp/segment-preview] 오류:', err);
    if (handleDbMigrationError(err, res, 'customers')) return;
    return res.status(500).json({ success: false, error: err?.message || '세그먼트 카운트 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 6-b. POST /api/cdp/inapp/preview-customers — 편집 미리보기 실고객 샘플 (CT-79)
//   2026-07-07(2): 하드코딩 샘플 영구 대체 — 타겟 최상단 실고객 + 등급별 실고객.
//   brand_accent = 회사 brand_kit 실설정 강조색 (미설정 = null) — 신규 메시지 기본 강조색용.
// ─────────────────────────────────────────────────────────────────────
router.post('/inapp/preview-customers', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    const raw = req.body?.segment_conditions;
    const segment = raw && typeof raw === 'object' ? raw : undefined;
    const customers = await buildEditorPreviewCustomers(auth.companyId, segment);
    const brandKit = await getCompanyBrandKitRaw(auth.companyId).catch(() => null);
    const brandAccent = typeof brandKit?.accent_color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(brandKit.accent_color.trim())
      ? brandKit.accent_color.trim()
      : null;
    return res.json({ success: true, customers, brand_accent: brandAccent });
  } catch (err: any) {
    console.error('[CDP /inapp/preview-customers] 오류:', err);
    if (handleDbMigrationError(err, res, 'customers')) return;
    return res.status(500).json({ success: false, error: err?.message || '미리보기 샘플 조회 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 7. POST /api/cdp/inapp/variant — A/B variant 생성 / 목록 / Winner 자동 판정 (CT-80)
// ─────────────────────────────────────────────────────────────────────
router.post('/inapp/variant', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    const { action, parent_message_id, ...variantData } = req.body;
    if (parent_message_id && !(await isInAppMessageOwned(auth.companyId, String(parent_message_id), auth.ownerId))) {
      return res.status(404).json({ success: false, error: '메시지를 찾을 수 없습니다.' });
    }
    if (action === 'create') {
      if (!parent_message_id || !variantData.title || !variantData.body) {
        return res.status(400).json({ success: false, error: 'parent_message_id + title + body 필수' });
      }
      const newId = await createVariant(auth.companyId, auth.userId, {
        parentMessageId: String(parent_message_id),
        title: String(variantData.title),
        body: String(variantData.body),
        template: variantData.template,
        image_url: variantData.image_url,
        buttons: variantData.buttons,
        background_color: variantData.background_color,
        text_color: variantData.text_color,
        animation: variantData.animation,
        variant_weight: variantData.variant_weight,
      });
      return res.json({ success: true, variantId: newId });
    } else if (action === 'list') {
      if (!parent_message_id) return res.status(400).json({ success: false, error: 'parent_message_id 필수' });
      const stats = await listVariantsWithStats(auth.companyId, String(parent_message_id));
      return res.json({ success: true, variants: stats });
    } else if (action === 'declare_winner') {
      if (!parent_message_id) return res.status(400).json({ success: false, error: 'parent_message_id 필수' });
      const result = await declareWinnerIfReady(auth.companyId, String(parent_message_id));
      return res.json({ success: true, result });
    } else {
      return res.status(400).json({ success: false, error: `허용되지 않는 action: ${action}` });
    }
  } catch (err: any) {
    console.error('[CDP /inapp/variant] 오류:', err);
    if (handleDbMigrationError(err, res, 'cdp_inapp_messages')) return;
    return res.status(500).json({ success: false, error: err?.message || 'Variant 처리 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 8. POST /api/cdp/inapp/upload-image — 이미지 업로드 (multer)
// ─────────────────────────────────────────────────────────────────────
router.post('/inapp/upload-image', (req: any, res: any) => {
  const uploadHandler = inappImageUpload.single('image');
  uploadHandler(req, res, async (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: '이미지 크기는 2MB 이하여야 합니다.' });
      }
      return res.status(400).json({ success: false, error: err.message || '이미지 업로드 실패' });
    }
    const auth = await ensureInAppAccess(req, res);
    if (!auth) return;
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, error: '이미지 파일 필수' });
    try {
      // ★ 2026-07-18 P3 — 플랜별 라이브러리 용량 한도 (테이블 미생성 환경 = 사용량 조회 실패 → 한도 검사 건너뜀, 업로드 무중단)
      try {
        const usage = await getStorageUsage(auth.companyId);
        if (usage.usedBytes + file.size > usage.limitBytes) {
          return res.status(400).json({
            success: false,
            error: `저장 공간이 가득 찼습니다 (${(usage.usedBytes / 1024 / 1024).toFixed(0)}MB / ${(usage.limitBytes / 1024 / 1024).toFixed(0)}MB). 라이브러리에서 안 쓰는 소재를 정리하거나 플랜을 올려주세요.`,
            code: 'ASSET_STORAGE_FULL',
          });
        }
      } catch (usageErr: any) {
        // cdp_assets 미생성 = 조용히 생략. 그 외 실패는 흔적을 남기되 업로드는 계속(무중단 원칙 — Codex A1)
        if (!isAssetsTableMissing(usageErr)) console.warn('[CDP /inapp/upload-image] 용량 확인 실패 — 한도 검사 생략:', usageErr?.message);
      }
      const companyDir = path.join(INAPP_IMAGE_BASE, auth.companyId);
      if (!fs.existsSync(companyDir)) fs.mkdirSync(companyDir, { recursive: true });
      const ext = path.extname(file.originalname).toLowerCase();
      const filename = `${uuidv4()}${ext}`;
      const filepath = path.join(companyDir, filename);
      fs.writeFileSync(filepath, file.buffer);
      const publicUrl = `/api/cdp/inapp/image/${auth.companyId}/${filename}`;
      // ★ 2026-07-18 P3 — 에셋 라이브러리 자동 등재 (부가 흐름 — 실패해도 업로드 성공 유지)
      registerAsset({
        companyId: auth.companyId,
        createdBy: auth.userId,
        kind: 'uploaded',
        origin: 'inapp',
        url: publicUrl,
        filename: file.originalname,
        bytes: file.size,
        format: ext.replace('.', '') || null,
      }).catch(() => {});
      return res.json({ success: true, url: publicUrl, filename, size: file.size });
    } catch (e: any) {
      console.error('[CDP /inapp/upload-image] 오류:', e);
      return res.status(500).json({ success: false, error: e?.message || '이미지 저장 실패' });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. GET /api/cdp/inapp/quick-start-cards — 빠른 시작 7 시나리오 (CT-77)
// ─────────────────────────────────────────────────────────────────────
router.get('/inapp/quick-start-cards', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    const cards = listQuickStartCards();
    return res.json({ success: true, cards });
  } catch (err: any) {
    console.error('[CDP /inapp/quick-start-cards] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '빠른 시작 카드 조회 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 10. GET /api/cdp/inapp/available-variables — Liquid 변수 드롭다운 (CT-79)
// ─────────────────────────────────────────────────────────────────────
router.get('/inapp/available-variables', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  try {
    // ★ 2026-07-02 회사 실데이터 필드만 노출 (CT-58 필터)
    const variables = await listAvailableVariables(auth.companyId);
    return res.json({ success: true, variables });
  } catch (err: any) {
    console.error('[CDP /inapp/available-variables] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '변수 목록 조회 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 11. GET /api/cdp/inapp/overview — 회사 전체 요약 5 metric + 격차 (CT-83)
// ─────────────────────────────────────────────────────────────────────
router.get('/inapp/overview', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  // 회사 전체 개요 집계 = 관리자 조회 영역
  if (auth.ownerId) return res.status(403).json({ success: false, error: '회사 전체 개요는 관리자만 조회할 수 있습니다.' });
  try {
    const ch = req.query.channel === 'web' || req.query.channel === 'app' ? req.query.channel : undefined;
    const overview = await buildInAppOverview(auth.companyId, ch);
    return res.json({ success: true, overview });
  } catch (err: any) {
    console.error('[CDP /inapp/overview] 오류:', err);
    if (handleDbMigrationError(err, res, 'cdp_inapp_messages')) return;
    return res.status(500).json({ success: false, error: err?.message || 'Overview 조회 실패' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 12. GET /api/cdp/inapp/top-messages — Top CTR 메시지 (CT-83)
// ─────────────────────────────────────────────────────────────────────
router.get('/inapp/top-messages', async (req: Request, res: Response) => {
  const auth = await ensureInAppAccess(req, res);
  if (!auth) return;
  // 회사 전체 상위 메시지 집계 = 관리자 조회 영역
  if (auth.ownerId) return res.status(403).json({ success: false, error: '회사 전체 순위는 관리자만 조회할 수 있습니다.' });
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '10'), 10) || 10, 1), 50);
    const ch = req.query.channel === 'web' || req.query.channel === 'app' ? req.query.channel : undefined;
    const top = await buildTopMessages(auth.companyId, limit, ch);
    return res.json({ success: true, messages: top });
  } catch (err: any) {
    console.error('[CDP /inapp/top-messages] 오류:', err);
    if (handleDbMigrationError(err, res, 'cdp_inapp_messages')) return;
    return res.status(500).json({ success: false, error: err?.message || 'Top 메시지 조회 실패' });
  }
});

// GET /api/cdp/providers — 자사몰 wrapper 등록 목록 (CdpSettingsPage 표시용)
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
        error: '자체 호스팅 자사몰 연동은 유료 요금제 가입 후 이용 가능합니다.',
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

// GET /api/cdp/custom/deliveries — 최근 webhook 수신 로그 (연결 검증 — CdpSettingsPage "최근 수신 확인")
router.get('/custom/deliveries', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const r = await query(
      `SELECT webhook_event, status, error_message, created_at, processed_at
       FROM cdp_webhook_deliveries
       WHERE company_id = $1::uuid AND source = 'custom'
       ORDER BY created_at DESC
       LIMIT $2`,
      [companyId, limit]
    );
    const deliveries = r.rows.map((row: any) => ({
      event: row.webhook_event,
      status: row.status,
      errorMessage: row.error_message || null,
      receivedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
    }));
    return res.json({ success: true, deliveries, total: deliveries.length });
  } catch (err: any) {
    console.error('[CDP /custom/deliveries] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '수신 로그 조회 실패' });
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
        error: '한줄로 CDP는 유료 요금제 가입 후 이용 가능합니다.',
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

// ============================================================
// ★ D214+ (2026-05-24) 5번 메뉴 자사몰 연동 + 데이터 융합 신규 endpoint 7건
//   - GET  /diagnostics — 자사몰 진단 (매핑률 + 이벤트 + Webhook + multi-source)
//   - GET  /funnel — 자사몰 이벤트 funnel (page_view → cart → checkout → purchase)
//   - GET  /timeline — 24h hourly bucket
//   - GET  /active-customers — 자사몰 활성 customer top N
//   - GET  /channel-distribution — channel별 customer 분포 + 회사 channel capabilities
//   - POST /explain — Opus 4.7 AI 진단
//   - POST /recompute-profile — unified profile 재계산 (회사 전체 batch)
// ============================================================

// 1) GET /cdp/diagnostics
router.get('/diagnostics', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const result = await buildCdpDiagnostics(companyId);
    return res.json({ success: true, diagnostics: result });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 customers ALTER 10건 (active_sources / preferred_channel / last_cart_add_at 등) 실행 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /diagnostics] 오류:', err);
    return res.status(500).json({ success: false, error: msg || '진단 조회 실패' });
  }
});

// 2) GET /cdp/funnel
router.get('/funnel', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const days = Math.max(7, Math.min(90, parseInt(String(req.query.days || '30'), 10) || 30));
    const result = await buildCdpFunnel(companyId, days);
    return res.json({ success: true, funnel: result });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — customers ALTER 10건 실행 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /funnel] 오류:', err);
    return res.status(500).json({ success: false, error: msg || 'funnel 조회 실패' });
  }
});

// 3) GET /cdp/timeline
router.get('/timeline', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const result = await buildCdpTimeline24h(companyId);
    return res.json({ success: true, timeline: result });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — customers ALTER 10건 실행 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /timeline] 오류:', err);
    return res.status(500).json({ success: false, error: msg || 'timeline 조회 실패' });
  }
});

// 4) GET /cdp/active-customers
router.get('/active-customers', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit || '10'), 10) || 10));
    const result = await buildCdpActiveCustomers(companyId, limit);
    return res.json({ success: true, activeCustomers: result });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — customers ALTER 10건 실행 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /active-customers] 오류:', err);
    return res.status(500).json({ success: false, error: msg || '활성 customer 조회 실패' });
  }
});

// 5) GET /cdp/channel-distribution
router.get('/channel-distribution', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const [distribution, capabilities] = await Promise.all([
      groupCustomersByChannel(companyId),
      getCompanyChannelCapabilities(companyId),
    ]);
    return res.json({ success: true, distribution, capabilities });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — customers ALTER 10건 실행 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /channel-distribution] 오류:', err);
    return res.status(500).json({ success: false, error: msg || 'channel distribution 조회 실패' });
  }
});

// 6) POST /cdp/explain (Opus 4.7 AI 진단)
router.post('/explain', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: 'AI 진단은 회사 관리자만 가능합니다.' });
    }
    const companyResult = await query(
      `SELECT company_name, business_type, brand_name FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    const diagnostics = await buildCdpDiagnostics(companyId);
    const explanation = await explainCdpDiagnostics(companyId, diagnostics, companyInfo);
    return res.json({ success: true, explanation });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — customers ALTER 10건 실행 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /explain] 오류:', err);
    return res.status(500).json({ success: false, error: msg || 'AI 진단 실패' });
  }
});

// 7) POST /cdp/recompute-profile — unified profile 재계산 (회사 admin only)
router.post('/recompute-profile', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: 'profile 재계산은 회사 관리자만 가능합니다.' });
    }
    const fullRecompute = req.body.fullRecompute === true;
    const result = await recomputeProfileBatch(companyId, fullRecompute);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — customers ALTER 10건 실행 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /recompute-profile] 오류:', err);
    return res.status(500).json({ success: false, error: msg || '재계산 실패' });
  }
});

export default router;
