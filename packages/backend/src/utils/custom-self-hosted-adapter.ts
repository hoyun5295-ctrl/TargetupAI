/**
 * ★ CT-29: 자체 호스팅 자사몰 Adapter — D178 (2026-05-19)
 *
 * 🎯 목적
 *   Harold 명시 — "카페24보다 자체 호스팅 자사몰 위주". 회사가 자체 서버(Next.js/Node/Django/PHP)에서 운영하는 자사몰을
 *   한줄로 CDP에 표준 Webhook + HMAC-SHA256 서명 박는 wrapper.
 *
 * 📋 카페24와의 차이
 *   - OAuth 흐름 X (회사가 직접 webhook_secret 발급받아 박음)
 *   - mall_id 박지 X (X-Hanjullo-Company-Id 헤더로 식별)
 *   - 표준 이벤트 매트릭스만 박음 (customer.created/updated + order.created/updated/cancelled/refunded)
 *
 * 🔐 인증 흐름
 *   1. 회사 admin이 CdpSettingsPage에서 webhook_secret 발급 (POST /api/cdp/custom/issue-secret)
 *   2. 회사가 자체 자사몰 코드에 webhook_secret + 표준 endpoint URL 박음
 *   3. 자사몰 이벤트 발화 시점 → POST https://app.hanjul.ai/api/cdp/webhook/custom
 *      - 헤더: X-Hanjullo-Company-Id (회사 UUID) + X-Hanjullo-Event (이벤트명) + X-Hanjullo-Signature (HMAC-SHA256)
 *      - body: { event, resource } JSON 표준
 *
 * ⛔ 영구 원칙 정합
 *   - webhook_secret 미박힘 시 401 차단 (cafe24와 달리 secret 박지 X 시 모든 webhook 차단)
 *   - idempotency_key = `${event}:${resource.order_id || resource.external_id || event_id}`
 *   - 동일 key 중복 시 duplicate 박음 (cdp_webhook_deliveries UNIQUE)
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  IProviderAdapter,
  ProviderCapabilities,
  ProviderTokenResponse,
  registerProvider,
} from './provider-registry';
import { identifyCustomer, parseConsentValue } from './cdp-identity';
import { syncOrder } from './cdp-orders';
import { trackEvent } from './cdp-events';
import { buildWebhookIdempotencyKey } from './cdp-idempotency';
import { query } from '../config/database';

const customCapabilities: ProviderCapabilities = {
  oauth: false,
  webhook: true,
  webhookSignatureVerification: true,
  adminApi: false,
};

// ════════════════════════════════════════════════════════════════════
// IProviderAdapter 구현체
// ════════════════════════════════════════════════════════════════════

export const customSelfHostedAdapter: IProviderAdapter = {
  provider: 'custom',
  displayName: '자체 호스팅 자사몰',
  capabilities: customCapabilities,

  buildAuthorizeUrl(): string {
    throw new Error('자체 호스팅 자사몰은 OAuth 흐름이 없습니다. 한줄로 관리자 → 자사몰 연동(CDP)에서 webhook_secret을 발급받아 저장해주세요.');
  },

  async exchangeCode(): Promise<ProviderTokenResponse> {
    throw new Error('자체 호스팅 자사몰은 OAuth code 교환이 없습니다.');
  },

  async refreshToken(): Promise<ProviderTokenResponse> {
    throw new Error('자체 호스팅 자사몰은 token refresh가 없습니다. Webhook + SDK 직접 호출 흐름입니다.');
  },

  verifyWebhookSignature(rawBody, signature, secret): boolean {
    if (!secret) return false;
    if (!signature) return false;
    try {
      const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      // hex 또는 base64 둘 다 박음 (자체 호스팅 회사 구현 다양성 정합)
      const hex = createHmac('sha256', secret).update(body).digest('hex');
      const b64 = createHmac('sha256', secret).update(body).digest('base64');
      const sig = signature.trim();
      // timingSafeEqual로 타이밍 공격 차단
      const hexBuf = Buffer.from(hex);
      const b64Buf = Buffer.from(b64);
      const sigBuf = Buffer.from(sig);
      if (sigBuf.length === hexBuf.length && timingSafeEqual(sigBuf, hexBuf)) return true;
      if (sigBuf.length === b64Buf.length && timingSafeEqual(sigBuf, b64Buf)) return true;
      return false;
    } catch {
      return false;
    }
  },

  async processWebhookEvent(companyId, event, resource): Promise<void> {
    switch (event) {
      case 'customer.created':
      case 'customer.updated':
        await identifyCustomer(companyId, {
          source: 'custom',
          externalId: String(resource.external_id || resource.customer_id || ''),
          email: resource.email,
          phone: resource.phone,
          name: resource.name,
          birthDate: resource.birth_date,
          gender: resource.gender,
          grade: resource.grade,
          address: resource.address,
          customFields: resource.custom_fields || {},
          // 마케팅 수신동의 — 자사몰이 보낸 명시값만 반영, 미전달 시 undefined(기존값 유지·신규는 false)
          smsOptIn: parseConsentValue(resource.sms_opt_in ?? resource.marketing_consent),
        });
        break;

      case 'order.created':
      case 'order.updated':
        await syncOrder(companyId, {
          source: 'custom',
          orderId: String(resource.order_id || ''),
          externalId: String(resource.external_id || resource.customer_id || ''),
          email: resource.email,
          phone: resource.phone,
          name: resource.name,
          status: String(resource.status || 'pending'),
          totalAmount: Number(resource.total_amount || 0),
          itemCount: Array.isArray(resource.items) ? resource.items.length : undefined,
          items: Array.isArray(resource.items) ? resource.items.map((it: any) => ({
            productId: it.product_id ? String(it.product_id) : undefined,
            productName: it.product_name,
            price: it.price != null ? Number(it.price) : undefined,
            quantity: it.quantity != null ? Number(it.quantity) : undefined,
          })) : undefined,
          orderedAt: String(resource.ordered_at || new Date().toISOString()),
          currency: String(resource.currency || 'KRW'),
        });
        break;

      case 'order.cancelled':
      case 'order.refunded':
        // 매출 차감은 syncOrder가 담당 (CT-86 revenue_reversed 멱등 마커 — 반영된 주문만 차감)
        await syncOrder(companyId, {
          source: 'custom',
          orderId: String(resource.order_id || ''),
          externalId: String(resource.external_id || resource.customer_id || ''),
          email: resource.email,
          phone: resource.phone,
          name: resource.name,
          status: event === 'order.refunded' ? 'refunded' : 'cancelled',
          totalAmount: Number(resource.total_amount || 0),
          orderedAt: String(resource.cancelled_at || resource.ordered_at || new Date().toISOString()),
          currency: String(resource.currency || 'KRW'),
        });
        // 여정/캠페인 trigger용 취소 신호 이벤트는 기존대로 기록 (실패해도 차감 결과는 유지)
        await trackEvent(companyId, {
          source: 'custom',
          eventName: 'custom_order_cancelled',
          externalId: String(resource.external_id || resource.customer_id || ''),
          properties: {
            order_id: resource.order_id,
            status: resource.status,
            cancelled_amount: resource.total_amount,
          },
          occurredAt: String(resource.cancelled_at || new Date().toISOString()),
        }).catch((err) => {
          console.log('[Custom Self-Hosted Adapter] 취소 신호 이벤트 기록 실패(차감은 완료):', err?.message || err);
        });
        break;

      default:
        console.log(`[Custom Self-Hosted Adapter] 처리하지 않는 event: ${event}`);
    }
  },

  extractMallIdFromWebhook(headers, _body): string | null {
    // 자체 호스팅 = mall_id 박지 X. company_id로 식별 (단, IProviderAdapter 표준 호환을 위해 company_id 박음)
    const fromHeader = headers['x-hanjullo-company-id'] || headers['X-Hanjullo-Company-Id'];
    if (fromHeader) return Array.isArray(fromHeader) ? fromHeader[0] : String(fromHeader);
    return null;
  },

  extractEventFromWebhook(headers, body): string | null {
    const fromHeader = headers['x-hanjullo-event'] || headers['X-Hanjullo-Event'];
    if (fromHeader) return Array.isArray(fromHeader) ? fromHeader[0] : String(fromHeader);
    return body?.event || null;
  },

  buildIdempotencyKey(event, resource, body): string {
    // CT-85 — 전송 고유값 우선 + 본문 해시. 이전 엔티티ID 단독 키는 두 번째 갱신부터 영구 duplicate가 되는 결함.
    return buildWebhookIdempotencyKey(event, resource, body);
  },
};

registerProvider(customSelfHostedAdapter);

// ════════════════════════════════════════════════════════════════════
// 회사별 webhook_secret 발급 / 조회
// ════════════════════════════════════════════════════════════════════

export interface CustomWebhookInfo {
  hasSecret: boolean;
  webhookUrl: string;
  issuedAt: Date | null;
}

function buildWebhookUrl(): string {
  const base = process.env.APP_BASE_URL || 'https://app.hanjul.ai';
  return `${base.replace(/\/$/, '')}/api/cdp/webhook/custom`;
}

/**
 * 자체 호스팅 자사몰 webhook_secret 발급/재발급.
 * - 64자 hex secret 박음 (raw는 본 함수 반환에만 1회 노출 — caller가 즉시 회사 admin에게 전달)
 * - company_integrations에 provider='custom' + mall_id='self' UNIQUE 박음 (재발급 시 옛 secret 폐기)
 */
export async function issueCustomWebhookSecret(companyId: string): Promise<{ secret: string; webhookUrl: string; issuedAt: Date }> {
  const secret = randomBytes(32).toString('hex');
  const now = new Date();
  await query(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, 'custom', 'self', '', '',
      NOW() + INTERVAL '100 years', '', '{}'::jsonb, $2, NOW(), 'active',
      NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      webhook_secret = EXCLUDED.webhook_secret,
      connected_at = NOW(),
      status = 'active',
      updated_at = NOW()`,
    [companyId, secret]
  );
  return { secret, webhookUrl: buildWebhookUrl(), issuedAt: now };
}

export async function getCustomWebhookInfo(companyId: string): Promise<CustomWebhookInfo> {
  const result = await query(
    `SELECT webhook_secret, connected_at FROM company_integrations
     WHERE company_id = $1::uuid AND provider = 'custom' AND mall_id = 'self' AND status = 'active'
     LIMIT 1`,
    [companyId]
  );
  const hasSecret = result.rows.length > 0 && !!result.rows[0].webhook_secret;
  return {
    hasSecret,
    webhookUrl: buildWebhookUrl(),
    issuedAt: hasSecret ? new Date(result.rows[0].connected_at) : null,
  };
}

export async function getCustomIntegrationByCompanyId(
  companyId: string
): Promise<{ webhookSecret: string | null } | null> {
  const result = await query(
    `SELECT webhook_secret FROM company_integrations
     WHERE company_id = $1::uuid AND provider = 'custom' AND mall_id = 'self' AND status = 'active'
     LIMIT 1`,
    [companyId]
  );
  if (result.rows.length === 0) return null;
  return { webhookSecret: result.rows[0].webhook_secret };
}

export async function revokeCustomWebhookSecret(companyId: string): Promise<boolean> {
  const result = await query(
    `UPDATE company_integrations
     SET status = 'revoked', updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'custom' AND mall_id = 'self'
     RETURNING id`,
    [companyId]
  );
  return result.rows.length > 0;
}
