/**
 * ★ CT-23: 카페24 REST API 클라이언트 컨트롤타워 — D172-B (2026-05-19)
 *
 * 🎯 목적
 *   카페24 OAuth + REST API 통신 표준 wrapper.
 *   - OAuth 코드 교환 (authorize code → access_token + refresh_token)
 *   - access_token 자동 갱신 (token_expires_at + 5분 마진)
 *   - 표준 카페24 API 호출 (회원/주문/장바구니 fetch)
 *   - Webhook 서명 검증 (HMAC-SHA256)
 *
 * 📋 카페24 OAuth 표준 (mall_id 기반)
 *   - Authorize URL: https://{mall_id}.cafe24api.com/api/v2/oauth/authorize
 *   - Token URL: https://{mall_id}.cafe24api.com/api/v2/oauth/token
 *   - API base: https://{mall_id}.cafe24api.com/api/v2/admin/...
 *   - Access token TTL: 2시간 / Refresh token TTL: 14일
 *
 * 🔐 인증 정보 보관
 *   - company_integrations 테이블에 access_token/refresh_token 저장 (company_id + provider='cafe24' + mall_id UNIQUE)
 *
 * 📝 환경변수 (Harold .env)
 *   - CAFE24_CLIENT_ID: 한줄로AI 앱의 카페24 client_id
 *   - CAFE24_CLIENT_SECRET: client_secret
 *   - CAFE24_REDIRECT_URI: OAuth callback URL (예: https://app.hanjul.ai/api/cafe24/oauth/callback)
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
import { buildWebhookIdempotencyKey } from './cdp-idempotency';
import { buildCafe24AuthorizeUrl as buildCafe24Url } from './provider-oauth-url';
import { firstPositiveAmount } from './normalize';
import { resolveProviderOAuthCredentials, type ProviderOAuthCredentials } from './provider-credentials';
import { type MallProduct, normalizeCafe24Product } from './mall-product-normalize';

const CAFE24_CLIENT_ID = process.env.CAFE24_CLIENT_ID || '';
const CAFE24_CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET || '';
const CAFE24_REDIRECT_URI = process.env.CAFE24_REDIRECT_URI || '';

const DEFAULT_SCOPE = [
  'mall.read_customer',
  'mall.read_order',
  'mall.read_product',
  'mall.read_application',
  // ★ 2026-07-03 B-1: scripttags(SDK 자동삽입 — 행동 수집 개통)는 앱(Application) 쓰기 권한 필요.
  //   개발자센터 앱 권한은 이미 앱 읽기+쓰기 확보 상태 → scope만 추가. 기존 연동 몰은 재동의 필요.
  'mall.write_application',
].join(',');

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 만료 5분 전 갱신

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface Cafe24TokenResponse {
  access_token: string;
  expires_at: string;          // ISO datetime
  refresh_token: string;
  refresh_token_expires_at: string;
  client_id: string;
  mall_id: string;
  user_id?: string;
  scopes: string[];
  shop_no?: number;
  issued_at: string;
}

export interface Cafe24Integration {
  id: string;
  companyId: string;
  mallId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope: string;
  webhookSecret: string | null;
  status: string;
}

// ════════════════════════════════════════════════════════════════════
// OAuth — authorize URL + code 교환
// ════════════════════════════════════════════════════════════════════

/** env(한줄로 자체 앱) 카페24 자격 — 회사 자격 미입력 시 fallback. 셋 다 있어야 유효. */
function envCafe24Creds(): ProviderOAuthCredentials | null {
  if (!CAFE24_CLIENT_ID || !CAFE24_CLIENT_SECRET || !CAFE24_REDIRECT_URI) return null;
  return { clientId: CAFE24_CLIENT_ID, clientSecret: CAFE24_CLIENT_SECRET, redirectUri: CAFE24_REDIRECT_URI };
}

/**
 * 카페24 OAuth authorize URL 생성.
 * - mall_id는 사용자가 CdpSettingsPage에서 입력
 * - state는 CSRF 방지 + company_id 식별용 (서버 측 검증)
 * - creds 미전달 시 env(한줄로 자체 앱) 자격 fallback. 회사 BYO 자격은 호출부가 전달.
 */
export function buildCafe24AuthorizeUrl(
  mallId: string,
  state: string,
  scope: string = DEFAULT_SCOPE,
  creds?: ProviderOAuthCredentials,
): string {
  const c = creds ?? envCafe24Creds();
  if (!c) {
    throw new Error('CAFE24_CLIENT_ID / CAFE24_REDIRECT_URI 환경변수가 설정되지 않았습니다.');
  }
  return buildCafe24Url(c, mallId, state, scope);
}

/**
 * authorize code → access_token + refresh_token 교환.
 */
export async function exchangeCafe24Code(
  mallId: string,
  code: string,
  creds?: ProviderOAuthCredentials,
): Promise<Cafe24TokenResponse> {
  const c = creds ?? envCafe24Creds();
  if (!c) {
    throw new Error('카페24 OAuth 환경변수가 설정되지 않았습니다.');
  }
  const url = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
  const basicAuth = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await safeJsonText(res);
    throw new Error(`카페24 토큰 교환 실패 (${res.status}): ${errBody}`);
  }

  return (await res.json()) as Cafe24TokenResponse;
}

/**
 * refresh_token으로 access_token 갱신.
 */
export async function refreshCafe24Token(
  mallId: string,
  refreshToken: string,
  creds?: ProviderOAuthCredentials,
): Promise<Cafe24TokenResponse> {
  const c = creds ?? envCafe24Creds();
  if (!c) {
    throw new Error('카페24 OAuth 환경변수가 설정되지 않았습니다.');
  }
  const url = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
  const basicAuth = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await safeJsonText(res);
    throw new Error(`카페24 토큰 갱신 실패 (${res.status}): ${errBody}`);
  }

  return (await res.json()) as Cafe24TokenResponse;
}

// ════════════════════════════════════════════════════════════════════
// company_integrations 저장 / 조회 / 갱신
// ════════════════════════════════════════════════════════════════════

export async function saveCafe24Integration(
  companyId: string,
  mallId: string,
  tokenRes: Cafe24TokenResponse,
  webhookSecret: string | null = null
): Promise<void> {
  await query(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, 'cafe24', $2, $3, $4,
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
      mallId,
      tokenRes.access_token,
      tokenRes.refresh_token,
      new Date(tokenRes.expires_at),
      Array.isArray(tokenRes.scopes) ? tokenRes.scopes.join(',') : DEFAULT_SCOPE,
      JSON.stringify({
        user_id: tokenRes.user_id,
        shop_no: tokenRes.shop_no,
        issued_at: tokenRes.issued_at,
        refresh_token_expires_at: tokenRes.refresh_token_expires_at,
      }),
      webhookSecret,
    ]
  );
}

export async function getCafe24Integration(companyId: string, mallId?: string): Promise<Cafe24Integration | null> {
  const result = mallId
    ? await query(
        `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, scope, webhook_secret, status
         FROM company_integrations
         WHERE company_id = $1::uuid AND provider = 'cafe24' AND mall_id = $2
         LIMIT 1`,
        [companyId, mallId]
      )
    : await query(
        `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, scope, webhook_secret, status
         FROM company_integrations
         WHERE company_id = $1::uuid AND provider = 'cafe24'
         ORDER BY connected_at DESC NULLS LAST
         LIMIT 1`,
        [companyId]
      );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    companyId: r.company_id,
    mallId: r.mall_id,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    tokenExpiresAt: new Date(r.token_expires_at),
    scope: r.scope || '',
    webhookSecret: r.webhook_secret,
    status: r.status,
  };
}

/**
 * mall_id로 회사 식별 (Webhook receiver용).
 */
export async function getCafe24IntegrationByMallId(mallId: string): Promise<Cafe24Integration | null> {
  const result = await query(
    `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, scope, webhook_secret, status
     FROM company_integrations
     WHERE provider = 'cafe24' AND mall_id = $1 AND status = 'active'
     LIMIT 1`,
    [mallId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    companyId: r.company_id,
    mallId: r.mall_id,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    tokenExpiresAt: new Date(r.token_expires_at),
    scope: r.scope || '',
    webhookSecret: r.webhook_secret,
    status: r.status,
  };
}

// ════════════════════════════════════════════════════════════════════
// BYO(회사 self-app) 자격 저장 / 조회 — model B (고객이 자기 키 직접 입력)
// ════════════════════════════════════════════════════════════════════

const CAFE24_CALLBACK_REDIRECT = process.env.CAFE24_REDIRECT_URI || 'https://app.hanjul.ai/api/cafe24/oauth/callback';

/**
 * 회사가 입력한 self-app 자격(client_id/secret)을 company_integrations.meta에 저장.
 * OAuth 전이라 토큰 없음(status='pending_oauth'). 이후 callback이 토큰을 채우고 active로 전환.
 */
export async function saveCafe24ByoCredentials(companyId: string, mallId: string, clientId: string, clientSecret: string): Promise<void> {
  await query(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, 'cafe24', $2, '', '',
      NULL, '', $3::jsonb, NULL, NULL, 'pending_oauth', NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      meta = company_integrations.meta || EXCLUDED.meta,
      updated_at = NOW()`,
    [companyId, mallId, JSON.stringify({ app_client_id: clientId, app_client_secret: clientSecret })]
  );
}

/**
 * 저장된 회사 self-app 자격을 반환(없으면 undefined → 호출부가 env로 fallback).
 * redirect_uri는 우리 콜백 고정(고객 self-app에 이 주소를 등록).
 */
export async function getCafe24ByoCredentials(companyId: string, mallId: string): Promise<ProviderOAuthCredentials | undefined> {
  const r = await query(
    `SELECT meta FROM company_integrations WHERE company_id = $1::uuid AND provider = 'cafe24' AND mall_id = $2 LIMIT 1`,
    [companyId, mallId]
  );
  if (r.rows.length === 0) return undefined;
  const meta = (r.rows[0].meta || {}) as { app_client_id?: string; app_client_secret?: string };
  const resolved = resolveProviderOAuthCredentials(
    { app_client_id: meta.app_client_id, app_client_secret: meta.app_client_secret, app_redirect_uri: CAFE24_CALLBACK_REDIRECT },
    null,
  );
  return resolved.ok ? resolved.credentials : undefined;
}

/**
 * access_token이 만료 임박이면 자동 갱신.
 * - 만료 5분 전 + 만료 후 모두 갱신
 */
export async function ensureFreshCafe24Token(integration: Cafe24Integration, creds?: ProviderOAuthCredentials): Promise<Cafe24Integration> {
  const now = Date.now();
  const expiresAt = integration.tokenExpiresAt.getTime();
  if (expiresAt > now + TOKEN_REFRESH_MARGIN_MS) {
    return integration;
  }

  try {
    const refreshed = await refreshCafe24Token(integration.mallId, integration.refreshToken, creds);
    await saveCafe24Integration(integration.companyId, integration.mallId, refreshed);
    return {
      ...integration,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      tokenExpiresAt: new Date(refreshed.expires_at),
    };
  } catch (err) {
    await query(
      `UPDATE company_integrations
       SET status = 'token_expired', updated_at = NOW()
       WHERE id = $1::uuid`,
      [integration.id]
    );
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
// REST API 호출
// ════════════════════════════════════════════════════════════════════

/**
 * 카페24 admin API 호출.
 * - 자동 토큰 갱신 (만료 임박 시)
 * - 5xx 시 1회 retry
 */
export async function cafe24ApiCall<T = unknown>(
  integration: Cafe24Integration,
  path: string,
  options: { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  creds?: ProviderOAuthCredentials,
): Promise<T> {
  const fresh = await ensureFreshCafe24Token(integration, creds);

  const baseUrl = `https://${fresh.mallId}.cafe24api.com/api/v2/admin`;
  const qs = options.query
    ? '?' + new URLSearchParams(
        Object.fromEntries(
          Object.entries(options.query)
            .filter(([_, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)])
        )
      ).toString()
    : '';
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}${qs}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${fresh.accessToken}`,
    'Content-Type': 'application/json',
    // ★ 2026-07-03 실측 정정 — 앱 API 버전(개발자센터 설정)이 2026-03-01. 옛 2024-09-01은 이 앱에서 미제공(400).
    //   (gyunoo83 scripttags GET raw 응답: "2024-09-01 version ... not available. default ... 2026-03-01")
    'X-Cafe24-Api-Version': '2026-03-01',
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
    if (res.ok) {
      return (await res.json()) as T;
    }
    if (res.status >= 500 && attempt === 0) {
      lastErr = new Error(`카페24 API 5xx (${res.status}) — retry`);
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const errBody = await safeJsonText(res);
    throw new Error(`카페24 API 호출 실패 (${res.status}): ${errBody}`);
  }
  throw lastErr || new Error('카페24 API 호출 실패');
}

// ════════════════════════════════════════════════════════════════════
// 상품 조회 (DM 상품 슬라이드 자동 채우기 소스) — ★ 2026-07-08 신설
//   ⛔ 응답 스키마 추측 금지(영구 룰) — raw를 그대로 반환. /mall-products/preview 실측으로 구조 확정 후
//   정규화 매핑(이미지·정가·할인가·링크)은 후속. GET /products = product_no·product_code·product_name·
//   price(판매가)·retail_price(정가)·list_image/detail_image/small_image. scope=mall.read_product.
// ════════════════════════════════════════════════════════════════════

/** 상품 목록 raw — 스키마 실측용(매핑 전 raw 그대로). limit 1~100. */
export async function fetchCafe24ProductsRaw(
  integration: Cafe24Integration,
  opts: { limit?: number; offset?: number; productName?: string } = {},
  creds?: ProviderOAuthCredentials,
): Promise<unknown> {
  return cafe24ApiCall<unknown>(
    integration,
    '/products',
    {
      method: 'GET',
      query: {
        limit: Math.min(Math.max(opts.limit ?? 5, 1), 100),
        offset: Math.max(opts.offset ?? 0, 0),
        product_name: opts.productName,
      },
    },
    creds,
  );
}

/** 상품 목록 → 정규화 MallProduct[] (판매·전시중 + 품절 아님만). DM 상품 피커 소스. */
export async function fetchCafe24Products(
  integration: Cafe24Integration,
  opts: { q?: string; limit?: number; offset?: number } = {},
  creds?: ProviderOAuthCredentials,
): Promise<MallProduct[]> {
  const raw = (await fetchCafe24ProductsRaw(
    integration,
    { limit: opts.limit ?? 50, offset: opts.offset, productName: opts.q },
    creds,
  )) as { products?: any[] };
  const list = Array.isArray(raw?.products) ? raw.products : [];
  return list
    .map((p) => normalizeCafe24Product(p, integration.mallId))
    .filter((x): x is MallProduct => x !== null);
}

// ════════════════════════════════════════════════════════════════════
// Webhook 서명 검증 (HMAC-SHA256)
// ════════════════════════════════════════════════════════════════════

/**
 * 카페24 webhook 서명 검증.
 * - X-Cafe24-Hmac-Sha256 헤더 vs HMAC-SHA256(webhook_secret, raw_body) base64
 * - webhook_secret 미설정이면 검증 skip (Phase 2 강화 예정이던 부분)
 */
export function verifyCafe24WebhookSignature(rawBody: Buffer | string, signature: string, secret: string | null): boolean {
  // 2026-06-10 정정: secret 미설정 시 무조건 통과시키던 분기 제거.
  // mall_id는 공개 서브도메인이라 무검증이면 위조 POST로 고객 데이터 오염이 가능했다.
  // secret 미설정 = 검증 불가 = 거부. (카페24 연동 회사는 webhook 검증 키 저장 후 수신 시작)
  if (!secret) return false;
  if (!signature) return false;
  try {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const computed = createHmac('sha256', secret).update(body).digest('base64');
    return computed === signature;
  } catch {
    return false;
  }
}

/**
 * ★ 2026-07-03 실측 정정 — 카페24 WebHook 실제 인증 = X-API-Key 헤더 (공식 WebHook 안내 문서).
 * 개발자센터 [개발정보 관리]의 WebHook 인증정보 값이 X-API-Key로 그대로 전송된다.
 * 서버 .env CAFE24_WEBHOOK_API_KEY와 timing-safe 비교. env 미설정 = 검증 불가 = false.
 */
export function verifyCafe24WebhookApiKey(headerKey: string | undefined | null): boolean {
  const expected = process.env.CAFE24_WEBHOOK_API_KEY || '';
  if (!expected || !headerKey) return false;
  try {
    const a = Buffer.from(String(headerKey), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * ★ 2026-07-03 실측 정정 — 카페24 WebHook 본문은 { event_no, resource } 형식 (X-Cafe24-Event 헤더 없음).
 * 공식 "수신 가능 이벤트 및 필요 권한" 표의 이벤트 번호 → 내부 이벤트 문자열 매핑.
 * 등록 이벤트(2026-07-03): 90023/90025/90026/90029/90084 (주문·장바구니). 회원(90032/90080/90144)은
 * 개인정보(Privacy) 권한 확보 후 등록 예정 — 매핑은 미리 준비.
 */
const CAFE24_EVENT_NO_MAP: Record<number, string> = {
  // 회원
  90032: 'customer.created',   // 신규 회원 가입
  90080: 'customer.updated',   // 회원정보 변경
  90144: 'customer.updated',   // 회원 등급 변경
  // 주문
  90023: 'order.created',      // 주문 접수
  90024: 'order.updated',      // 배송상태 변경
  90071: 'order.updated',      // 배송상태 변경(일괄)
  90025: 'order.updated',      // 입금상태 변경
  90026: 'order.cancelled',    // 취소상태 변경
  90072: 'order.cancelled',    // 취소상태 변경(일괄)
  90029: 'order.refunded',     // 환불상태 변경
  90073: 'order.refunded',     // 환불상태 변경(일괄)
  // 장바구니
  90084: 'cart.added',         // 상품이 장바구니에 담긴 경우
};

export function mapCafe24EventNo(eventNo: unknown): string | null {
  const n = Number(eventNo);
  if (!isFinite(n)) return null;
  return CAFE24_EVENT_NO_MAP[n] || null;
}

// 금액 파싱은 공용 CT normalize.firstPositiveAmount 사용 — "0.00" 문자열 truthy 함정 방어
// (2026-07-03 gyunoo83 실주문 실측 — 순서: 실결제액 → 주문 총액(배송비 포함) → 상품 금액)

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

async function safeJsonText(res: Response): Promise<string> {
  try {
    return JSON.stringify(await res.json());
  } catch {
    try {
      return await res.text();
    } catch {
      return '<응답 본문 파싱 실패>';
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// IProviderAdapter 구현체 (D173) — Provider Registry에 자동 등록
// ════════════════════════════════════════════════════════════════════

const cafe24Capabilities: ProviderCapabilities = {
  oauth: true,
  webhook: true,
  webhookSignatureVerification: true,
  adminApi: true,
};

function toProviderTokenResponse(tokenRes: Cafe24TokenResponse): ProviderTokenResponse {
  return {
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token,
    expiresAt: new Date(tokenRes.expires_at),
    scope: Array.isArray(tokenRes.scopes) ? tokenRes.scopes.join(',') : '',
    metadata: {
      user_id: tokenRes.user_id,
      shop_no: tokenRes.shop_no,
      issued_at: tokenRes.issued_at,
      refresh_token_expires_at: tokenRes.refresh_token_expires_at,
    },
  };
}

export const cafe24Adapter: IProviderAdapter = {
  provider: 'cafe24',
  displayName: '카페24',
  capabilities: cafe24Capabilities,
  connectMethod: 'oauth',
  available: true,

  buildAuthorizeUrl(mallId: string, state: string, scope?: string): string {
    return buildCafe24AuthorizeUrl(mallId, state, scope);
  },

  async exchangeCode(mallId: string, code: string): Promise<ProviderTokenResponse> {
    const tokenRes = await exchangeCafe24Code(mallId, code);
    return toProviderTokenResponse(tokenRes);
  },

  async refreshToken(integration: ProviderIntegration): Promise<ProviderTokenResponse> {
    const tokenRes = await refreshCafe24Token(integration.mallId, integration.refreshToken);
    return toProviderTokenResponse(tokenRes);
  },

  verifyWebhookSignature(rawBody: Buffer | string, signature: string, secret: string | null): boolean {
    return verifyCafe24WebhookSignature(rawBody, signature, secret);
  },

  async processWebhookEvent(companyId: string, event: string, resource: Record<string, any>): Promise<void> {
    // routes/cafe24.ts processCafe24Event가 여기로 위임 — 단일 진실.
    switch (event) {
      case 'customer.created':
      case 'customer.updated':
        await identifyCustomer(companyId, {
          source: 'cafe24',
          externalId: String(resource.member_id || resource.customer_id || ''),
          email: resource.email,
          phone: resource.cellphone || resource.phone,
          name: resource.name,
          birthDate: resource.birthday,
          gender: resource.gender,
          grade: resource.group_no ? `group_${resource.group_no}` : undefined,
          address: [resource.address1, resource.address2].filter(Boolean).join(' '),
          customFields: {
            cafe24_group_no: resource.group_no,
            cafe24_member_grade: resource.member_grade,
            cafe24_join_date: resource.created_date,
          },
        });
        break;

      case 'order.created':
      case 'order.updated': {
        // ★ 2026-07-03 실측 정정(gyunoo83 실주문 payload) — 상품 목록은 items가 아니라 extra_info로 온다.
        const orderItems = Array.isArray(resource.items) ? resource.items
          : (Array.isArray(resource.extra_info) ? resource.extra_info : undefined);
        await syncOrder(companyId, {
          source: 'cafe24',
          orderId: String(resource.order_id || ''),
          externalId: String(resource.member_id || resource.customer_id || ''),
          email: resource.buyer_email,
          phone: resource.buyer_cellphone || resource.buyer_phone,
          name: resource.buyer_name,
          status: resource.order_status === 'completed' ? 'completed' : (resource.order_status || 'pending'),
          totalAmount: firstPositiveAmount(resource.actual_payment_amount, resource.initial_total_amount_due, resource.order_price_amount),
          itemCount: orderItems ? orderItems.length : undefined,
          items: orderItems ? orderItems.map((it: any) => ({
            productId: it.product_no ? String(it.product_no) : undefined,
            productName: it.product_name,
            price: it.product_price ? Number(it.product_price) : undefined,
            quantity: it.quantity ? Number(it.quantity) : undefined,
          })) : undefined,
          orderedAt: resource.order_date || new Date().toISOString(),
          currency: 'KRW',
        });
        break;
      }

      case 'order.cancelled':
      case 'order.refunded':
        // 매출 차감은 syncOrder가 담당 (CT-86 revenue_reversed 멱등 마커 — 반영된 주문만 차감)
        await syncOrder(companyId, {
          source: 'cafe24',
          orderId: String(resource.order_id || ''),
          externalId: String(resource.member_id || resource.customer_id || ''),
          email: resource.buyer_email,
          phone: resource.buyer_cellphone || resource.buyer_phone,
          name: resource.buyer_name,
          status: event === 'order.refunded' ? 'refunded' : 'cancelled',
          totalAmount: firstPositiveAmount(resource.actual_payment_amount, resource.initial_total_amount_due, resource.order_price_amount),
          orderedAt: resource.cancelled_date || resource.order_date || new Date().toISOString(),
          currency: 'KRW',
        });
        // 여정/캠페인 trigger용 취소 신호 이벤트는 기존대로 기록
        await trackEvent(companyId, {
          source: 'cafe24',
          eventName: 'custom_order_cancelled',
          externalId: String(resource.member_id || resource.customer_id || ''),
          properties: {
            order_id: resource.order_id,
            status: resource.order_status,
            cancelled_amount: resource.actual_payment_amount,
          },
          occurredAt: resource.cancelled_date || new Date().toISOString(),
        }).catch((err) => {
          console.log('[Cafe24 Adapter] 취소 신호 이벤트 기록 실패(차감은 완료):', err?.message || err);
        });
        break;

      case 'cart.added':
        // ★ 2026-07-03 — 장바구니 웹훅(90084). SDK 미설치 몰에서도 cart_add 신호 확보 (성과리포트 퍼널 축과 동일 이벤트명).
        // 비회원 장바구니(member_id 없음)는 고객 매칭 불가 — 기록 생략 (deliveries 원문은 이미 저장됨).
        {
          const cartExternalId = String(resource.member_id || resource.customer_id || '');
          if (!cartExternalId) {
            console.log('[Cafe24 Adapter] cart.added 비회원 — 고객 매칭 생략');
            break;
          }
          await trackEvent(companyId, {
            source: 'cafe24',
            eventName: 'cart_add',
            externalId: cartExternalId,
            properties: {
              product_no: resource.product_no,
              product_name: resource.product_name,
              quantity: resource.quantity,
            },
            occurredAt: resource.created_date || new Date().toISOString(),
          });
        }
        break;

      default:
        console.log(`[Cafe24 Adapter] 처리하지 않는 event: ${event}`);
    }
  },

  extractMallIdFromWebhook(headers, body): string | null {
    const fromHeader = headers['x-cafe24-mall-id'] || headers['X-Cafe24-Mall-Id'];
    if (fromHeader) return Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    return body?.resource?.mall_id || null;
  },

  extractEventFromWebhook(headers, body): string | null {
    // 구형(가정) 헤더 하위 호환 → 실제 형식(body.event_no) 순서로 식별 (2026-07-03 공식 문서 실측 정정)
    const fromHeader = headers['x-cafe24-event'] || headers['X-Cafe24-Event'];
    if (fromHeader) return Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    return mapCafe24EventNo(body?.event_no);
  },

  buildIdempotencyKey(event: string, resource: Record<string, any>, body: Record<string, any>): string {
    // CT-85 — event_no(전송 고유값) 우선 + 본문 해시. 이전 엔티티ID 단독 키는 두 번째 갱신부터 영구 duplicate가 되는 결함.
    return buildWebhookIdempotencyKey(event, resource, body);
  },
};

registerProvider(cafe24Adapter);
