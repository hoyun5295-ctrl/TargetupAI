/**
 * ★ CT-30: 네이버 스마트스토어 (커머스 API) 클라이언트 — D178 (2026-05-19)
 *
 * 🎯 목적
 *   Harold 명시 — "네이버스토어를 자사몰처럼 쓰는 회사들 많음". 네이버 커머스 API OAuth + Webhook + REST 표준 wrapper.
 *   cafe24-client.ts (CT-23) 미러 패턴 + naverSmartStoreAdapter 박음 (Provider Registry 자동 등록).
 *
 * 📋 네이버 커머스 API 표준 (Application 등록 후)
 *   - Authorize URL: https://api.commerce.naver.com/oauth2/authorize
 *   - Token URL:     https://api.commerce.naver.com/oauth2/token (POST x-www-form-urlencoded)
 *   - API base:      https://api.commerce.naver.com/external/v1
 *
 * 🔐 환경변수 (Harold .env)
 *   - NAVER_COMMERCE_CLIENT_ID
 *   - NAVER_COMMERCE_CLIENT_SECRET
 *   - NAVER_COMMERCE_REDIRECT_URI (예: https://app.hanjul.ai/api/naver-commerce/oauth/callback)
 *
 * ⛔ 외부 API 실 endpoint URL + scope + 토큰 TTL은 Harold 박은 네이버 커머스 콘솔에서 최종 검증 필요.
 *   본 wrapper는 cafe24와 동일한 표준 OAuth 2.0 흐름 + HMAC-SHA256 Webhook 서명 박음.
 */

import { query } from '../config/database';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  IProviderAdapter,
  ProviderCapabilities,
  ProviderTokenResponse,
  ProviderIntegration,
  registerProvider,
} from './provider-registry';
import { identifyCustomer } from './cdp-identity';
import { syncOrder } from './cdp-orders';
import { trackEvent } from './cdp-events';

const NAVER_COMMERCE_CLIENT_ID = process.env.NAVER_COMMERCE_CLIENT_ID || '';
const NAVER_COMMERCE_CLIENT_SECRET = process.env.NAVER_COMMERCE_CLIENT_SECRET || '';
const NAVER_COMMERCE_REDIRECT_URI = process.env.NAVER_COMMERCE_REDIRECT_URI || '';

const NAVER_AUTHORIZE_URL = 'https://api.commerce.naver.com/oauth2/authorize';
const NAVER_TOKEN_URL = 'https://api.commerce.naver.com/oauth2/token';
const NAVER_API_BASE = 'https://api.commerce.naver.com/external/v1';

const DEFAULT_SCOPE = 'commerce.product.read commerce.order.read commerce.customer.read';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 만료 5분 전 갱신

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface NaverCommerceTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;       // 초 단위 (만료까지 남은 시간)
  token_type: string;       // Bearer
  scope?: string;
}

export interface NaverCommerceIntegration {
  id: string;
  companyId: string;
  storeId: string;         // 네이버 스마트스토어 식별자
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope: string;
  webhookSecret: string | null;
  status: string;
}

// ════════════════════════════════════════════════════════════════════
// OAuth
// ════════════════════════════════════════════════════════════════════

export function buildNaverCommerceAuthorizeUrl(storeId: string, state: string, scope: string = DEFAULT_SCOPE): string {
  if (!NAVER_COMMERCE_CLIENT_ID || !NAVER_COMMERCE_REDIRECT_URI) {
    throw new Error('NAVER_COMMERCE_CLIENT_ID / NAVER_COMMERCE_REDIRECT_URI 환경변수가 설정되지 않았습니다.');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: NAVER_COMMERCE_CLIENT_ID,
    state,
    redirect_uri: NAVER_COMMERCE_REDIRECT_URI,
    scope,
    store_id: storeId,
  });
  return `${NAVER_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeNaverCommerceCode(code: string): Promise<NaverCommerceTokenResponse> {
  if (!NAVER_COMMERCE_CLIENT_ID || !NAVER_COMMERCE_CLIENT_SECRET || !NAVER_COMMERCE_REDIRECT_URI) {
    throw new Error('네이버 커머스 OAuth 환경변수가 설정되지 않았습니다.');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: NAVER_COMMERCE_CLIENT_ID,
    client_secret: NAVER_COMMERCE_CLIENT_SECRET,
    code,
    redirect_uri: NAVER_COMMERCE_REDIRECT_URI,
  });
  const res = await fetch(NAVER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const errBody = await safeJsonText(res);
    throw new Error(`네이버 커머스 토큰 교환 실패 (${res.status}): ${errBody}`);
  }
  return (await res.json()) as NaverCommerceTokenResponse;
}

export async function refreshNaverCommerceToken(refreshToken: string): Promise<NaverCommerceTokenResponse> {
  if (!NAVER_COMMERCE_CLIENT_ID || !NAVER_COMMERCE_CLIENT_SECRET) {
    throw new Error('네이버 커머스 OAuth 환경변수가 설정되지 않았습니다.');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: NAVER_COMMERCE_CLIENT_ID,
    client_secret: NAVER_COMMERCE_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  const res = await fetch(NAVER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const errBody = await safeJsonText(res);
    throw new Error(`네이버 커머스 토큰 갱신 실패 (${res.status}): ${errBody}`);
  }
  return (await res.json()) as NaverCommerceTokenResponse;
}

// ════════════════════════════════════════════════════════════════════
// company_integrations 저장 / 조회 / 갱신
// ════════════════════════════════════════════════════════════════════

export async function saveNaverCommerceIntegration(
  companyId: string,
  storeId: string,
  tokenRes: NaverCommerceTokenResponse,
  webhookSecret: string | null = null
): Promise<void> {
  const expiresAt = new Date(Date.now() + (tokenRes.expires_in || 3600) * 1000);
  await query(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, 'naver_smart_store', $2, $3, $4,
      $5, $6, $7::jsonb, $8, NOW(), 'active',
      NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expires_at = EXCLUDED.token_expires_at,
      scope = EXCLUDED.scope,
      meta = company_integrations.meta || EXCLUDED.meta,
      webhook_secret = COALESCE(EXCLUDED.webhook_secret, company_integrations.webhook_secret),
      status = 'active',
      updated_at = NOW()`,
    [
      companyId,
      storeId,
      tokenRes.access_token,
      tokenRes.refresh_token,
      expiresAt,
      tokenRes.scope || DEFAULT_SCOPE,
      JSON.stringify({
        token_type: tokenRes.token_type,
        expires_in: tokenRes.expires_in,
      }),
      webhookSecret,
    ]
  );
}

export async function getNaverCommerceIntegration(
  companyId: string,
  storeId?: string
): Promise<NaverCommerceIntegration | null> {
  const result = storeId
    ? await query(
        `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, scope, webhook_secret, status
         FROM company_integrations
         WHERE company_id = $1::uuid AND provider = 'naver_smart_store' AND mall_id = $2 LIMIT 1`,
        [companyId, storeId]
      )
    : await query(
        `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, scope, webhook_secret, status
         FROM company_integrations
         WHERE company_id = $1::uuid AND provider = 'naver_smart_store'
         ORDER BY connected_at DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    companyId: r.company_id,
    storeId: r.mall_id,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    tokenExpiresAt: new Date(r.token_expires_at),
    scope: r.scope || DEFAULT_SCOPE,
    webhookSecret: r.webhook_secret,
    status: r.status,
  };
}

export async function getNaverCommerceIntegrationByStoreId(storeId: string): Promise<NaverCommerceIntegration | null> {
  const result = await query(
    `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, scope, webhook_secret, status
     FROM company_integrations
     WHERE provider = 'naver_smart_store' AND mall_id = $1 AND status = 'active' LIMIT 1`,
    [storeId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    companyId: r.company_id,
    storeId: r.mall_id,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    tokenExpiresAt: new Date(r.token_expires_at),
    scope: r.scope || DEFAULT_SCOPE,
    webhookSecret: r.webhook_secret,
    status: r.status,
  };
}

export async function ensureFreshNaverCommerceToken(
  integration: NaverCommerceIntegration
): Promise<NaverCommerceIntegration> {
  const now = Date.now();
  if (integration.tokenExpiresAt.getTime() > now + TOKEN_REFRESH_MARGIN_MS) {
    return integration;
  }
  try {
    const refreshed = await refreshNaverCommerceToken(integration.refreshToken);
    await saveNaverCommerceIntegration(integration.companyId, integration.storeId, refreshed);
    return {
      ...integration,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      tokenExpiresAt: new Date(Date.now() + (refreshed.expires_in || 3600) * 1000),
    };
  } catch (err) {
    await query(
      `UPDATE company_integrations SET status = 'token_expired', updated_at = NOW() WHERE id = $1::uuid`,
      [integration.id]
    );
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
// REST API
// ════════════════════════════════════════════════════════════════════

export async function naverCommerceApiCall<T = unknown>(
  integration: NaverCommerceIntegration,
  path: string,
  options: { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {}
): Promise<T> {
  const fresh = await ensureFreshNaverCommerceToken(integration);
  const qs = options.query
    ? '?' + new URLSearchParams(
        Object.fromEntries(
          Object.entries(options.query)
            .filter(([_, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)])
        )
      ).toString()
    : '';
  const url = `${NAVER_API_BASE}${path.startsWith('/') ? path : `/${path}`}${qs}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${fresh.accessToken}`,
    'Content-Type': 'application/json',
  };
  const fetchOpts: RequestInit = {
    method: options.method || 'GET',
    headers,
  };
  if (options.body !== undefined) {
    fetchOpts.body = JSON.stringify(options.body);
  }

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, fetchOpts);
    if (res.ok) return (await res.json()) as T;
    if (res.status >= 500 && attempt === 0) {
      lastErr = new Error(`네이버 커머스 API 5xx (${res.status}) — retry`);
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const errBody = await safeJsonText(res);
    throw new Error(`네이버 커머스 API 호출 실패 (${res.status}): ${errBody}`);
  }
  throw lastErr || new Error('네이버 커머스 API 호출 실패');
}

// ════════════════════════════════════════════════════════════════════
// Webhook 서명 검증
// ════════════════════════════════════════════════════════════════════

export function verifyNaverCommerceWebhookSignature(rawBody: Buffer | string, signature: string, secret: string | null): boolean {
  if (!secret) return false;
  if (!signature) return false;
  try {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const hex = createHmac('sha256', secret).update(body).digest('hex');
    const b64 = createHmac('sha256', secret).update(body).digest('base64');
    const sig = signature.trim();
    const hexBuf = Buffer.from(hex);
    const b64Buf = Buffer.from(b64);
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === hexBuf.length && timingSafeEqual(sigBuf, hexBuf)) return true;
    if (sigBuf.length === b64Buf.length && timingSafeEqual(sigBuf, b64Buf)) return true;
    return false;
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

async function safeJsonText(res: Response): Promise<string> {
  try { return JSON.stringify(await res.json()); }
  catch {
    try { return await res.text(); }
    catch { return '<응답 본문 파싱 실패>'; }
  }
}

// ════════════════════════════════════════════════════════════════════
// IProviderAdapter 구현체 — Provider Registry 자동 등록
// ════════════════════════════════════════════════════════════════════

const naverCapabilities: ProviderCapabilities = {
  oauth: true,
  webhook: true,
  webhookSignatureVerification: true,
  adminApi: true,
};

function toProviderTokenResponse(tokenRes: NaverCommerceTokenResponse): ProviderTokenResponse {
  return {
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token,
    expiresAt: new Date(Date.now() + (tokenRes.expires_in || 3600) * 1000),
    scope: tokenRes.scope || DEFAULT_SCOPE,
    metadata: {
      token_type: tokenRes.token_type,
      expires_in: tokenRes.expires_in,
    },
  };
}

export const naverSmartStoreAdapter: IProviderAdapter = {
  provider: 'naver_smart_store',
  displayName: '네이버 스마트스토어',
  capabilities: naverCapabilities,

  buildAuthorizeUrl(storeId, state, scope) {
    return buildNaverCommerceAuthorizeUrl(storeId, state, scope);
  },

  async exchangeCode(_storeId, code) {
    const tokenRes = await exchangeNaverCommerceCode(code);
    return toProviderTokenResponse(tokenRes);
  },

  async refreshToken(integration: ProviderIntegration) {
    const tokenRes = await refreshNaverCommerceToken(integration.refreshToken);
    return toProviderTokenResponse(tokenRes);
  },

  verifyWebhookSignature(rawBody, signature, secret) {
    return verifyNaverCommerceWebhookSignature(rawBody, signature, secret);
  },

  async processWebhookEvent(companyId, event, resource) {
    // 네이버 커머스 표준 이벤트 매트릭스 (외부 API 검증 후 정정 가능)
    switch (event) {
      case 'customer.created':
      case 'customer.updated':
      case 'member.joined':
        await identifyCustomer(companyId, {
          source: 'naver_smart_store',
          externalId: String(resource.member_id || resource.customer_id || resource.external_id || ''),
          email: resource.email,
          phone: resource.cellphone || resource.phone,
          name: resource.name,
          birthDate: resource.birth_date || resource.birthday,
          gender: resource.gender,
          grade: resource.grade,
          customFields: {
            naver_member_id: resource.member_id,
            naver_join_date: resource.created_at,
          },
        });
        break;

      case 'order.placed':
      case 'order.created':
      case 'order.completed':
        await syncOrder(companyId, {
          source: 'naver_smart_store',
          orderId: String(resource.order_id || resource.product_order_id || ''),
          externalId: String(resource.member_id || resource.customer_id || ''),
          email: resource.buyer_email || resource.email,
          phone: resource.buyer_cellphone || resource.phone,
          name: resource.buyer_name || resource.name,
          status: String(resource.status || 'pending'),
          totalAmount: Number(resource.total_payment_amount || resource.total_amount || 0),
          itemCount: Array.isArray(resource.items) ? resource.items.length : undefined,
          items: Array.isArray(resource.items) ? resource.items.map((it: any) => ({
            productId: it.product_id ? String(it.product_id) : undefined,
            productName: it.product_name,
            price: it.price != null ? Number(it.price) : undefined,
            quantity: it.quantity != null ? Number(it.quantity) : undefined,
          })) : undefined,
          orderedAt: String(resource.ordered_at || resource.order_date || new Date().toISOString()),
          currency: 'KRW',
        });
        break;

      case 'order.cancelled':
      case 'order.refunded':
        await trackEvent(companyId, {
          source: 'naver_smart_store',
          eventName: 'custom_order_cancelled',
          externalId: String(resource.member_id || resource.customer_id || ''),
          properties: {
            order_id: resource.order_id,
            status: resource.status,
            cancelled_amount: resource.total_payment_amount,
          },
          occurredAt: String(resource.cancelled_at || new Date().toISOString()),
        });
        break;

      default:
        console.log(`[Naver SmartStore Adapter] 처리하지 않는 event: ${event}`);
    }
  },

  extractMallIdFromWebhook(headers, body) {
    const fromHeader = headers['x-naver-store-id'] || headers['X-Naver-Store-Id'];
    if (fromHeader) return Array.isArray(fromHeader) ? fromHeader[0] : String(fromHeader);
    return body?.store_id || body?.resource?.store_id || null;
  },

  extractEventFromWebhook(headers, body) {
    const fromHeader = headers['x-naver-event'] || headers['X-Naver-Event'];
    if (fromHeader) return Array.isArray(fromHeader) ? fromHeader[0] : String(fromHeader);
    return body?.event || null;
  },

  buildIdempotencyKey(event, resource, body) {
    const id = resource?.order_id || resource?.product_order_id || resource?.member_id || body?.event_id || Date.now();
    return `${event}:${id}`;
  },
};

registerProvider(naverSmartStoreAdapter);
