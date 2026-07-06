/**
 * ★ CT-30: 네이버 스마트스토어 (커머스 API) 클라이언트 — D178 신설 / ★ 2026-07-06 인증 전면 재작성
 *
 * 🎯 목적
 *   Harold 명시 — "네이버스토어를 자사몰처럼 쓰는 회사들 많음". 커머스 API 인증 + 주문 조회 + Webhook 표준 wrapper.
 *
 * 🔐 인증 (2026-07-06 서버 실측으로 확정 — 옛 authorization_code OAuth 전면 폐기)
 *   실제 커머스 API = OAuth2 client_credentials + bcrypt 전자서명. authorize/callback/refresh_token 개념 없음.
 *   - POST https://api.commerce.naver.com/external/v1/oauth2/token (x-www-form-urlencoded)
 *     client_id · timestamp(ms, 5분 유효) · grant_type=client_credentials
 *     · client_secret_sign = Base64(bcrypt(client_id + "_" + timestamp, client_secret)) · type=SELF
 *   - 응답 { access_token, expires_in(10800=3h), token_type } — 남은 30분 미만이면 재호출 시 새 토큰.
 *   - 사전조건: 커머스 API센터 앱의 "API 호출 IP"에 서버 egress IP(58.227.193.62) 등록.
 *   실측: 2026-07-06 서버에서 발급 성공(expires_in 10799) — 스펙·자격·IP 확정.
 *
 * 🔐 자격 보관 — company_integrations.meta { app_client_id, app_client_secret } (회사별) → env fallback
 *   - NAVER_COMMERCE_CLIENT_ID / NAVER_COMMERCE_CLIENT_SECRET (한줄로 자체 스토어용)
 *
 * ⛔ 주문 조회 응답 스키마는 추측 금지(영구 룰) — fetch 함수는 raw를 함께 반환하고,
 *   /orders/preview 실측으로 구조 확인 후 CDP 매핑(identify/syncOrder 연결)을 후속 작업으로 붙인다.
 */

import { query } from '../config/database';
import { createHmac, timingSafeEqual } from 'crypto';
import { buildNaverCommerceSignature } from './naver-commerce-signature-core';
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
import { buildWebhookIdempotencyKey } from './cdp-idempotency';
import { firstPositiveAmount } from './normalize';

const NAVER_COMMERCE_CLIENT_ID = process.env.NAVER_COMMERCE_CLIENT_ID || '';
const NAVER_COMMERCE_CLIENT_SECRET = process.env.NAVER_COMMERCE_CLIENT_SECRET || '';

const NAVER_TOKEN_URL = 'https://api.commerce.naver.com/external/v1/oauth2/token';
const NAVER_API_BASE = 'https://api.commerce.naver.com/external/v1';

const TOKEN_REFRESH_MARGIN_MS = 30 * 60 * 1000; // 만료 30분 전 재발급 (네이버 정책: 30분 미만 시 새 토큰 발급)

/** client_credentials 자격 — OAuth(redirectUri) 개념이 없어 공용 ProviderOAuthCredentials 대신 전용 타입 */
export interface NaverCommerceCredentials {
  clientId: string;
  clientSecret: string;
}

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface NaverCommerceTokenResponse {
  access_token: string;
  expires_in: number;       // 초 단위 (3시간 = 10800). refresh_token 없음 — 만료 임박 시 재발급.
  token_type: string;       // Bearer
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

/** env(한줄로 자체 앱) 네이버 커머스 자격 — 회사 자격 미입력 시 fallback. 둘 다 있어야 유효. */
function envNaverCreds(): NaverCommerceCredentials | null {
  if (!NAVER_COMMERCE_CLIENT_ID || !NAVER_COMMERCE_CLIENT_SECRET) return null;
  return { clientId: NAVER_COMMERCE_CLIENT_ID, clientSecret: NAVER_COMMERCE_CLIENT_SECRET };
}

// 전자서명(순수)은 naver-commerce-signature-core.ts로 분리 — 테스트가 side-effect 없이 검증.
export { buildNaverCommerceSignature };

/**
 * 인증 토큰 발급 (client_credentials + 전자서명, type=SELF).
 * refresh 개념 없음 — 만료 임박 시 이 함수를 다시 호출한다(네이버가 유효 토큰 재사용/재발급을 알아서 결정).
 */
export async function issueNaverCommerceToken(creds: NaverCommerceCredentials): Promise<NaverCommerceTokenResponse> {
  const timestamp = Date.now();
  const body = new URLSearchParams({
    client_id: creds.clientId,
    timestamp: String(timestamp),
    grant_type: 'client_credentials',
    client_secret_sign: buildNaverCommerceSignature(creds.clientId, creds.clientSecret, timestamp),
    type: 'SELF',
  });
  const res = await fetch(NAVER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const errBody = await safeJsonText(res);
    throw new Error(`네이버 커머스 토큰 발급 실패 (${res.status}): ${errBody}`);
  }
  const json = (await res.json()) as NaverCommerceTokenResponse;
  if (!json?.access_token) {
    throw new Error(`네이버 커머스 토큰 발급 응답에 access_token 없음: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

// ════════════════════════════════════════════════════════════════════
// company_integrations 저장 / 조회 / 갱신
// ════════════════════════════════════════════════════════════════════

export async function saveNaverCommerceIntegration(
  companyId: string,
  storeId: string,
  tokenRes: NaverCommerceTokenResponse,
  creds?: NaverCommerceCredentials,
  webhookSecret: string | null = null
): Promise<void> {
  const expiresAt = new Date(Date.now() + (tokenRes.expires_in || 10800) * 1000);
  // client_credentials — refresh_token 없음(''), scope 개념 없음(''). 자격은 meta에 보관(만료 시 자동 재발급용).
  const meta: Record<string, unknown> = {
    token_type: tokenRes.token_type,
    expires_in: tokenRes.expires_in,
    auth_model: 'client_credentials',
  };
  if (creds) {
    meta.app_client_id = creds.clientId;
    meta.app_client_secret = creds.clientSecret;
  }
  await query(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, 'naver_smart_store', $2, $3, '',
      $4, '', $5::jsonb, $6, NOW(), 'active',
      NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = '',
      token_expires_at = EXCLUDED.token_expires_at,
      scope = '',
      meta = company_integrations.meta || EXCLUDED.meta,
      webhook_secret = COALESCE(EXCLUDED.webhook_secret, company_integrations.webhook_secret),
      status = 'active',
      connected_at = NOW(),
      updated_at = NOW()`,
    [
      companyId,
      storeId,
      tokenRes.access_token,
      expiresAt,
      JSON.stringify(meta),
      webhookSecret,
    ]
  );
}

/**
 * ★ 2026-07-06 연동 진입점 — 자격으로 토큰 발급을 "실제 검증"한 뒤에만 active 저장 (6원칙 ②: 검증 없는 성공 표시 금지).
 * 발급 실패 시 그대로 throw — 저장/상태 변경 0 (고도몰 verify-then-active 선례 미러).
 */
export async function connectNaverCommerce(
  companyId: string,
  storeId: string,
  creds: NaverCommerceCredentials,
): Promise<{ tokenExpiresAt: Date }> {
  const tokenRes = await issueNaverCommerceToken(creds); // 실패 = throw (IP 미등록/자격 오류 등 네이버 메시지 그대로)
  await saveNaverCommerceIntegration(companyId, storeId, tokenRes, creds);
  return { tokenExpiresAt: new Date(Date.now() + (tokenRes.expires_in || 10800) * 1000) };
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
    scope: r.scope || '',
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
    scope: r.scope || '',
    webhookSecret: r.webhook_secret,
    status: r.status,
  };
}

export async function ensureFreshNaverCommerceToken(
  integration: NaverCommerceIntegration,
  creds?: NaverCommerceCredentials,
): Promise<NaverCommerceIntegration> {
  const now = Date.now();
  if (integration.tokenExpiresAt.getTime() > now + TOKEN_REFRESH_MARGIN_MS) {
    return integration;
  }
  try {
    // refresh_token 없음 — 저장된 자격(meta) → env 순으로 해석해 재발급.
    const c = creds
      ?? (await getNaverCommerceCredentials(integration.companyId, integration.storeId))
      ?? envNaverCreds();
    if (!c) {
      throw new Error('네이버 커머스 자격(client_id/secret)이 없습니다 — 연동 화면에서 다시 연결해주세요.');
    }
    const reissued = await issueNaverCommerceToken(c);
    await saveNaverCommerceIntegration(integration.companyId, integration.storeId, reissued, c);
    return {
      ...integration,
      accessToken: reissued.access_token,
      refreshToken: '',
      tokenExpiresAt: new Date(Date.now() + (reissued.expires_in || 10800) * 1000),
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

// ════════════════════════════════════════════════════════════════════
// 자격 조회 — 회사 meta(연동 시 저장) 우선 → env(한줄로 자체 스토어) fallback
// ════════════════════════════════════════════════════════════════════

export async function getNaverCommerceCredentials(companyId: string, storeId?: string): Promise<NaverCommerceCredentials | null> {
  const r = storeId
    ? await query(
        `SELECT meta FROM company_integrations WHERE company_id = $1::uuid AND provider = 'naver_smart_store' AND mall_id = $2 LIMIT 1`,
        [companyId, storeId]
      )
    : await query(
        `SELECT meta FROM company_integrations WHERE company_id = $1::uuid AND provider = 'naver_smart_store' ORDER BY connected_at DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
  const meta = (r.rows[0]?.meta || {}) as { app_client_id?: string; app_client_secret?: string };
  const id = String(meta.app_client_id || '').trim();
  const secret = String(meta.app_client_secret || '').trim();
  if (id && secret) return { clientId: id, clientSecret: secret };
  return envNaverCreds();
}

export async function naverCommerceApiCall<T = unknown>(
  integration: NaverCommerceIntegration,
  path: string,
  options: { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  creds?: NaverCommerceCredentials,
): Promise<T> {
  const fresh = await ensureFreshNaverCommerceToken(integration, creds);
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
// 주문 조회 (마케팅 타겟 소스) — ★ 2026-07-06 신설
//   ⛔ 응답 스키마 추측 금지(영구 룰) — raw를 함께 반환. /orders/preview 실측으로 구조 확정 후
//   CDP 매핑(identifyCustomer/syncOrder 연결)은 후속 작업으로 붙인다.
//   제약(공식): 조회창 24시간 · 초당 2회 — 호출부는 hours ≤ 24 로 자른다.
// ════════════════════════════════════════════════════════════════════

/** 변경 상품주문 내역 — lastChangedFrom(ISO) 이후 변경분. productOrderId 방어적 수집 + raw 동반 반환. */
export async function fetchNaverLastChangedProductOrders(
  integration: NaverCommerceIntegration,
  fromIso: string,
): Promise<{ productOrderIds: string[]; raw: unknown }> {
  const raw = await naverCommerceApiCall<any>(integration, '/pay-order/seller/product-orders/last-changed-statuses', {
    method: 'GET',
    query: { lastChangedFrom: fromIso },
  });
  const list: any[] = Array.isArray(raw?.data?.lastChangeStatuses) ? raw.data.lastChangeStatuses
    : Array.isArray(raw?.lastChangeStatuses) ? raw.lastChangeStatuses
    : [];
  const productOrderIds = list
    .map((it: any) => String(it?.productOrderId || '').trim())
    .filter((id: string) => id.length > 0);
  return { productOrderIds, raw };
}

/** 상품주문 상세 조회 — 구매자 성명·휴대폰이 담기는 상세. raw 그대로 반환(스키마 실측 전 매핑 금지). */
export async function fetchNaverProductOrderDetails(
  integration: NaverCommerceIntegration,
  productOrderIds: string[],
): Promise<unknown> {
  if (productOrderIds.length === 0) return { data: [] };
  return naverCommerceApiCall<unknown>(integration, '/pay-order/seller/product-orders/query', {
    method: 'POST',
    body: { productOrderIds: productOrderIds.slice(0, 300) },
  });
}

/** 최근 N시간 주문 미리보기 — 연동 검증·스키마 실측용 (preview 라우트 전용). */
export async function fetchRecentNaverOrdersPreview(
  integration: NaverCommerceIntegration,
  hours: number,
): Promise<{ from: string; idCount: number; productOrderIds: string[]; changedRaw: unknown; detailsRaw: unknown }> {
  const clamped = Math.min(Math.max(hours, 1), 24); // 공식 조회창 24h
  const from = new Date(Date.now() - clamped * 60 * 60 * 1000).toISOString();
  const changed = await fetchNaverLastChangedProductOrders(integration, from);
  const detailsRaw = await fetchNaverProductOrderDetails(integration, changed.productOrderIds.slice(0, 20));
  return { from, idCount: changed.productOrderIds.length, productOrderIds: changed.productOrderIds, changedRaw: changed.raw, detailsRaw };
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
  oauth: false, // ★ 2026-07-06 — 커머스 API는 client_credentials(자격 입력형). OAuth 리다이렉트 없음.
  webhook: true,
  webhookSignatureVerification: true,
  adminApi: true,
};

function toProviderTokenResponse(tokenRes: NaverCommerceTokenResponse): ProviderTokenResponse {
  return {
    accessToken: tokenRes.access_token,
    refreshToken: '', // client_credentials — refresh 개념 없음(만료 임박 시 재발급)
    expiresAt: new Date(Date.now() + (tokenRes.expires_in || 10800) * 1000),
    scope: '',
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
  connectMethod: 'polling', // 자격 입력 + 주문 당겨오기 — 고도몰과 동일 모델
  available: true,

  buildAuthorizeUrl() {
    throw new Error('네이버 스마트스토어는 OAuth 리다이렉트가 아니라 애플리케이션 자격(client_id/secret) 입력으로 연동합니다. POST /api/naver-commerce/connect 를 사용하세요.');
  },

  async exchangeCode(): Promise<ProviderTokenResponse> {
    throw new Error('네이버 스마트스토어는 authorize code 교환을 지원하지 않습니다 (client_credentials 방식).');
  },

  async refreshToken(integration: ProviderIntegration) {
    // refresh_token 없음 — 저장 자격(meta) → env 순으로 재발급.
    const creds = (await getNaverCommerceCredentials(integration.companyId, integration.mallId)) ?? envNaverCreds();
    if (!creds) throw new Error('네이버 커머스 자격(client_id/secret)이 없습니다 — 연동 화면에서 다시 연결해주세요.');
    const tokenRes = await issueNaverCommerceToken(creds);
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
          // "0.00" 문자열 truthy 함정 방어 — 공용 CT firstPositiveAmount (2026-07-03 카페24 실측 교훈 동반 적용)
          totalAmount: firstPositiveAmount(resource.total_payment_amount, resource.total_amount),
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
    // CT-85 — 전송 고유값 우선 + 본문 해시. 이전 엔티티ID 단독 키는 두 번째 갱신부터 영구 duplicate가 되는 결함.
    return buildWebhookIdempotencyKey(event, resource, body);
  },
};

registerProvider(naverSmartStoreAdapter);
