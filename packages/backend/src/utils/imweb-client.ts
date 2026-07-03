/**
 * ★ 아임웹(imweb) Open API 클라이언트 — 2026-07-04
 *
 * 🎯 목적
 *   아임웹 Ground API v2 OAuth 2.0 + Webhook + REST 표준 wrapper.
 *   naver-commerce-client.ts(CT-30) 미러 패턴 + imwebAdapter 등록(Provider Registry).
 *
 * 📋 공식 계약 (developers-docs.imweb.me / Reference 실측 확정 2026-07-04)
 *   - API base:   https://openapi.imweb.me
 *   - authorize:  GET  /oauth2/authorize  (camelCase 파라미터 + siteCode 필수)
 *   - token:      POST /oauth2/token       (grantType=authorization_code, 응답 {statusCode, data:{accessToken,refreshToken,scope}})
 *   - refresh:    POST /oauth2/token       (grantType=refresh_token)
 *   - 연동완료:   PATCH /site-info/integration-complete       (OAuth 직후 필수 호출 — '연동중'→'연동완료', 안 하면 다른 API 차단)
 *   - 연동해제:   PATCH /site-info/integration-cancellation
 *   - 회원 목록:  GET  /member-info/members (+ /cursor)
 *   - 주문 목록:  GET  /orders  (v2 3-depth: 주문→섹션→섹션아이템)
 *   - Access 2h / Refresh 90일. Rate: 버킷 25·초당 2 회복·429.
 *
 * 🔐 환경변수 (Harold .env — 앱 레벨 단일 공식 앱, BYO 아님)
 *   - IMWEB_CLIENT_ID / IMWEB_CLIENT_SECRET / IMWEB_REDIRECT_URI / IMWEB_WEBHOOK_SECRET
 *
 * 🧩 imweb 고유 (카페24/네이버와 다름)
 *   - siteCode = 몰 식별자(=mall_id). 몰이 앱 추가 시 서비스 URL로 ?siteCode=S... 리다이렉트되는 값.
 *   - OAuth 후 반드시 integration-complete 호출해야 API 열림.
 *
 * ⛔ 실측 검증 잔여 (배포 후 실 토큰으로 확정 — 아임웹은 승인 없이 테스트 가능)
 *   - token POST 본문 포맷(JSON vs form-urlencoded): 공식 예제가 모순 → JSON 우선, 400이면 form 전환.
 *   - 웹훅 인증 토큰(IMWEB_WEBHOOK_SECRET) 전달 헤더명: '테스트 내보내기' 샘플로 확정.
 *   - integration-complete가 site-info scope를 요구하는지: 요구 시 앱 설정에서 Site-Info 활성 필요.
 */

import { query } from '../config/database';
import { timingSafeEqual } from 'crypto';
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

const IMWEB_CLIENT_ID = process.env.IMWEB_CLIENT_ID || '';
const IMWEB_CLIENT_SECRET = process.env.IMWEB_CLIENT_SECRET || '';
const IMWEB_REDIRECT_URI = process.env.IMWEB_REDIRECT_URI || 'https://app.hanjul.ai/api/imweb/oauth/callback';
const IMWEB_WEBHOOK_SECRET = process.env.IMWEB_WEBHOOK_SECRET || '';

const IMWEB_API_BASE = 'https://openapi.imweb.me';
const IMWEB_AUTHORIZE_URL = `${IMWEB_API_BASE}/oauth2/authorize`;
const IMWEB_TOKEN_URL = `${IMWEB_API_BASE}/oauth2/token`;

// 공백 구분 · 콜론 형식(문서 확정). 읽기 전용만.
const DEFAULT_SCOPE = 'member-info:read order:read product:read';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 만료 5분 전 갱신

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

interface ImwebTokenData {
  accessToken: string;
  refreshToken: string;
  scope: string | string[];
}
interface ImwebTokenResponse {
  statusCode?: number;
  data?: ImwebTokenData;
  // 일부 응답이 data 래핑 없이 최상위로 올 가능성 대비(실측 후 정리)
  accessToken?: string;
  refreshToken?: string;
  scope?: string | string[];
}

export interface ImwebIntegration {
  id: string;
  companyId: string;
  siteCode: string;         // 아임웹 사이트 코드(=mall_id)
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope: string;
  status: string;
}

// 응답에서 토큰 3종 정규화(래핑 유무 모두 대응)
function normalizeTokenResponse(raw: ImwebTokenResponse): { accessToken: string; refreshToken: string; scope: string } {
  const d = raw?.data ?? raw;
  const scope = Array.isArray(d?.scope) ? d!.scope.join(' ') : (d?.scope || DEFAULT_SCOPE);
  return {
    accessToken: String(d?.accessToken || ''),
    refreshToken: String(d?.refreshToken || ''),
    scope,
  };
}

// ════════════════════════════════════════════════════════════════════
// OAuth
// ════════════════════════════════════════════════════════════════════

function envReady(): boolean {
  return !!(IMWEB_CLIENT_ID && IMWEB_CLIENT_SECRET && IMWEB_REDIRECT_URI);
}

/** authorize URL — 아임웹은 camelCase 파라미터 + siteCode 필수. */
export function buildImwebAuthorizeUrl(siteCode: string, state: string, scope: string = DEFAULT_SCOPE): string {
  if (!envReady()) throw new Error('IMWEB_CLIENT_ID / IMWEB_REDIRECT_URI 환경변수가 설정되지 않았습니다.');
  const params = new URLSearchParams({
    responseType: 'code',
    clientId: IMWEB_CLIENT_ID,
    redirectUri: IMWEB_REDIRECT_URI,
    scope,
    state,
    siteCode,
  });
  return `${IMWEB_AUTHORIZE_URL}?${params.toString()}`;
}

/** 인가코드 → 토큰. imweb: POST /oauth2/token (JSON 본문 우선 — 실측 후 form 전환 가능). */
export async function exchangeImwebCode(code: string): Promise<{ accessToken: string; refreshToken: string; scope: string }> {
  if (!envReady()) throw new Error('아임웹 OAuth 환경변수가 설정되지 않았습니다.');
  const res = await fetch(IMWEB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'authorization_code',
      clientId: IMWEB_CLIENT_ID,
      clientSecret: IMWEB_CLIENT_SECRET,
      redirectUri: IMWEB_REDIRECT_URI,
      code,
    }),
  });
  if (!res.ok) {
    const errBody = await safeJsonText(res);
    throw new Error(`아임웹 토큰 교환 실패 (${res.status}): ${errBody}`);
  }
  return normalizeTokenResponse((await res.json()) as ImwebTokenResponse);
}

export async function refreshImwebToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; scope: string }> {
  if (!envReady()) throw new Error('아임웹 OAuth 환경변수가 설정되지 않았습니다.');
  const res = await fetch(IMWEB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'refresh_token',
      clientId: IMWEB_CLIENT_ID,
      clientSecret: IMWEB_CLIENT_SECRET,
      refreshToken,
    }),
  });
  if (!res.ok) {
    const errBody = await safeJsonText(res);
    throw new Error(`아임웹 토큰 갱신 실패 (${res.status}): ${errBody}`);
  }
  return normalizeTokenResponse((await res.json()) as ImwebTokenResponse);
}

// ════════════════════════════════════════════════════════════════════
// company_integrations 저장 / 조회 / 갱신 (provider='imweb', mall_id=siteCode)
// ════════════════════════════════════════════════════════════════════

export async function saveImwebIntegration(
  companyId: string,
  siteCode: string,
  token: { accessToken: string; refreshToken: string; scope: string },
  expiresInSec: number = 2 * 60 * 60, // Access Token 2시간
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresInSec * 1000);
  await query(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, 'imweb', $2, $3, $4,
      $5, $6, '{}'::jsonb, $7, NOW(), 'active',
      NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expires_at = EXCLUDED.token_expires_at,
      scope = EXCLUDED.scope,
      webhook_secret = COALESCE(EXCLUDED.webhook_secret, company_integrations.webhook_secret),
      status = 'active',
      connected_at = COALESCE(company_integrations.connected_at, NOW()),
      updated_at = NOW()`,
    [companyId, siteCode, token.accessToken, token.refreshToken, expiresAt, token.scope || DEFAULT_SCOPE, IMWEB_WEBHOOK_SECRET || null]
  );
}

function rowToIntegration(r: any): ImwebIntegration {
  return {
    id: r.id,
    companyId: r.company_id,
    siteCode: r.mall_id,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    tokenExpiresAt: new Date(r.token_expires_at),
    scope: r.scope || DEFAULT_SCOPE,
    status: r.status,
  };
}

export async function getImwebIntegration(companyId: string, siteCode?: string): Promise<ImwebIntegration | null> {
  const result = siteCode
    ? await query(
        `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, scope, status
         FROM company_integrations
         WHERE company_id = $1::uuid AND provider = 'imweb' AND mall_id = $2 LIMIT 1`,
        [companyId, siteCode]
      )
    : await query(
        `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, scope, status
         FROM company_integrations
         WHERE company_id = $1::uuid AND provider = 'imweb'
         ORDER BY connected_at DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
  return result.rows.length ? rowToIntegration(result.rows[0]) : null;
}

export async function getImwebIntegrationBySiteCode(siteCode: string): Promise<ImwebIntegration | null> {
  const result = await query(
    `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, scope, status
     FROM company_integrations
     WHERE provider = 'imweb' AND mall_id = $1 AND status = 'active' LIMIT 1`,
    [siteCode]
  );
  return result.rows.length ? rowToIntegration(result.rows[0]) : null;
}

export async function ensureFreshImwebToken(integration: ImwebIntegration): Promise<ImwebIntegration> {
  if (integration.tokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS) return integration;
  try {
    const refreshed = await refreshImwebToken(integration.refreshToken);
    await saveImwebIntegration(integration.companyId, integration.siteCode, refreshed);
    return { ...integration, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) };
  } catch (err) {
    await query(`UPDATE company_integrations SET status = 'token_expired', updated_at = NOW() WHERE id = $1::uuid`, [integration.id]);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
// REST API 호출 (Bearer + 429 백오프)
// ════════════════════════════════════════════════════════════════════

export async function imwebApiCall<T = unknown>(
  integration: ImwebIntegration,
  path: string,
  options: { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
): Promise<T> {
  const fresh = await ensureFreshImwebToken(integration);
  const qs = options.query
    ? '?' + new URLSearchParams(
        Object.fromEntries(
          Object.entries(options.query).filter(([_, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
        )
      ).toString()
    : '';
  const url = `${IMWEB_API_BASE}${path.startsWith('/') ? path : `/${path}`}${qs}`;
  const fetchOpts: RequestInit = {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${fresh.accessToken}`, 'Content-Type': 'application/json' },
  };
  if (options.body !== undefined) fetchOpts.body = JSON.stringify(options.body);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, fetchOpts);
    if (res.ok) return (await res.json()) as T;
    // 429(rate limit) 또는 5xx 재시도
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    const errBody = await safeJsonText(res);
    throw new Error(`아임웹 API 호출 실패 (${res.status}): ${errBody}`);
  }
  throw new Error('아임웹 API 호출 실패(재시도 소진)');
}

/** ★ 연동완료처리 — OAuth 직후 필수. '연동중'에서 이 호출을 해야 다른 API가 열린다. */
export async function completeImwebIntegration(integration: ImwebIntegration): Promise<void> {
  await imwebApiCall(integration, '/site-info/integration-complete', { method: 'PATCH' });
}

/** 연동해제처리 — 해제 시 아임웹 측 토큰 삭제. */
export async function cancelImwebIntegration(integration: ImwebIntegration): Promise<void> {
  await imwebApiCall(integration, '/site-info/integration-cancellation', { method: 'PATCH' });
}

// ════════════════════════════════════════════════════════════════════
// Webhook 검증 — imweb은 '인증 정보'(공유 토큰)를 이벤트와 함께 전달.
//   전달 헤더명은 '테스트 내보내기'로 실측 확정 필요. 아래는 후보 헤더 다중 대조.
// ════════════════════════════════════════════════════════════════════

export function verifyImwebWebhook(headers: Record<string, string | string[] | undefined>, secret: string | null): boolean {
  const expected = secret || IMWEB_WEBHOOK_SECRET;
  if (!expected) return false;
  const candidates = [
    headers['x-imweb-signature'], headers['x-imweb-secret'], headers['x-imweb-token'],
    headers['imweb-signature'], headers['authorization'],
  ];
  for (const c of candidates) {
    const v = Array.isArray(c) ? c[0] : c;
    if (!v) continue;
    const got = String(v).replace(/^Bearer\s+/i, '').trim();
    try {
      const a = Buffer.from(got);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch { /* 무시 */ }
  }
  return false;
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
// IProviderAdapter 구현체 — Provider Registry 등록
// ════════════════════════════════════════════════════════════════════

const imwebCapabilities: ProviderCapabilities = {
  oauth: true,
  webhook: true,
  webhookSignatureVerification: true,
  adminApi: true,
};

export const imwebAdapter: IProviderAdapter = {
  provider: 'imweb',
  displayName: '아임웹',
  capabilities: imwebCapabilities,
  connectMethod: 'oauth',
  available: true,

  buildAuthorizeUrl(mallId, state, scope) {
    return buildImwebAuthorizeUrl(mallId, state, scope);
  },

  async exchangeCode(_mallId, code) {
    const t = await exchangeImwebCode(code);
    return {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      scope: t.scope,
      metadata: {},
    } as ProviderTokenResponse;
  },

  async refreshToken(integration: ProviderIntegration) {
    const t = await refreshImwebToken(integration.refreshToken);
    return {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      scope: t.scope,
      metadata: {},
    } as ProviderTokenResponse;
  },

  verifyWebhookSignature(_rawBody, _signature, secret) {
    // imweb은 공유 토큰을 헤더로 전달 — rawBody HMAC이 아님. 라우트에서 헤더 기반 verifyImwebWebhook 사용.
    // registry 인터페이스 호환용: secret 존재 여부만 확인(실검증은 라우트).
    return !!(secret || IMWEB_WEBHOOK_SECRET);
  },

  async processWebhookEvent(companyId, event, resource) {
    switch (event) {
      // 회원 — 생성/수정/동의수정/등급변경/일괄등록 → identify
      case 'END_USER_SIGN_UP':
      case 'END_USER_SIGN_UP_BULK':
      case 'END_USER_INFO_UPDATE':
      case 'END_USER_AGREE_INFO_UPDATE':
      case 'END_USER_GRADE_UPDATE':
        await identifyCustomer(companyId, {
          source: 'imweb',
          externalId: String(resource.memberUid || resource.member_uid || resource.memberCode || ''),
          email: resource.email,
          phone: resource.call || resource.mobile || resource.phone,
          name: resource.name || resource.memberName,
          gender: resource.gender,
          grade: resource.grade || resource.memberGrade,
          customFields: {
            imweb_member_uid: resource.memberUid,
            imweb_site_code: resource.siteCode,
          },
        });
        break;

      // 탈퇴 → 발송 제외 이벤트
      case 'END_USER_WITHDRAWAL':
        await trackEvent(companyId, {
          source: 'imweb',
          eventName: 'custom_member_withdrawn',
          externalId: String(resource.memberUid || resource.member_uid || ''),
          properties: { imweb_member_uid: resource.memberUid },
          occurredAt: String(resource.occurredAt || new Date().toISOString()),
        });
        break;

      // 장바구니 담기 → 장바구니 이탈 여정
      case 'END_USER_CART_ADD':
        await trackEvent(companyId, {
          source: 'imweb',
          eventName: 'custom_cart_add',
          externalId: String(resource.memberUid || resource.member_uid || ''),
          properties: {
            product_no: resource.prodNo || resource.productNo,
            product_name: resource.prodName || resource.productName,
          },
          occurredAt: String(resource.occurredAt || new Date().toISOString()),
        });
        break;

      // 주문 — 생성/입금완료 → 구매이력 동기화
      case 'ORDER_CREATE':
      case 'ORDER_DEPOSIT_COMPLETE':
        await syncOrder(companyId, {
          source: 'imweb',
          orderId: String(resource.orderNo || resource.order_no || ''),
          externalId: String(resource.memberUid || resource.member_uid || ''),
          email: resource.email,
          phone: resource.call || resource.mobile || resource.phone,
          name: resource.name || resource.ordererName,
          status: String(resource.orderStatus || event),
          totalAmount: firstPositiveAmount(resource.totalPrice, resource.paidPrice, resource.totalRefundPrice),
          orderedAt: String(resource.orderTime || resource.orderedAt || new Date().toISOString()),
          currency: 'KRW',
        });
        break;

      // 배송 상태 변화 → 배송 여정 트리거(발송 알림·배송완료 후기/재구매)
      case 'ORDER_SHIPPING_READY':
      case 'ORDER_SHIPPING':
      case 'ORDER_SHIPPING_COMPLETE':
      case 'ORDER_INVOICE_REGISTERED':
        await trackEvent(companyId, {
          source: 'imweb',
          eventName: `custom_${event.toLowerCase()}`,
          externalId: String(resource.memberUid || resource.member_uid || ''),
          properties: {
            order_no: resource.orderNo,
            section_code: resource.orderSectionCode,
            invoice_no: resource.invoiceNo,
          },
          occurredAt: String(resource.occurredAt || new Date().toISOString()),
        });
        break;

      // 취소/반품/환불 → 상태 이벤트
      case 'ORDER_CANCEL_COMPLETE':
      case 'ORDER_RETURN_COMPLETE':
      case 'ORDER_REFUND':
        await trackEvent(companyId, {
          source: 'imweb',
          eventName: 'custom_order_cancelled',
          externalId: String(resource.memberUid || resource.member_uid || ''),
          properties: { order_no: resource.orderNo, status: event },
          occurredAt: String(resource.occurredAt || new Date().toISOString()),
        });
        break;

      default:
        console.log(`[Imweb Adapter] 처리하지 않는 event: ${event}`);
    }
  },

  extractMallIdFromWebhook(headers, body) {
    const fromHeader = headers['x-imweb-site-code'] || headers['X-Imweb-Site-Code'];
    if (fromHeader) return Array.isArray(fromHeader) ? fromHeader[0] : String(fromHeader);
    return body?.siteCode || body?.site_code || body?.data?.siteCode || null;
  },

  extractEventFromWebhook(headers, body) {
    const fromHeader = headers['x-imweb-event'] || headers['X-Imweb-Event'];
    if (fromHeader) return Array.isArray(fromHeader) ? fromHeader[0] : String(fromHeader);
    return body?.eventType || body?.event || body?.type || null;
  },

  buildIdempotencyKey(event, resource, body) {
    return buildWebhookIdempotencyKey(event, resource, body);
  },
};

registerProvider(imwebAdapter);
