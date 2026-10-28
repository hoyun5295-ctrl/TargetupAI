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

import { query, type TxRun } from '../config/database';
import { saveIntegrationRowGuarded } from './integration-scope';   // ★ 2026-10-27 자사몰 대비 K9 SC1 — 연동 행 저장 = 회사 모드 잠금 → 판정 → 저장(한 트랜잭션)
import { TIMEOUTS } from '../config/defaults';
import { joinInflight } from './inflight-lock';
// ★ 2026-09-26 한줄로 V2 R1-31 — 토큰 요청 실패 판정 CT(제공자 거절일 때만 연동 만료)
import { tokenHttpError, reconnectRequiredError, isDefinitiveTokenRejection } from './integration-token-error';
import { markTokenRejected, receiveEligibleSql, saveRefreshedToken, reReadAfterLostRefresh } from './integration-token';
import { createIntegrationRow } from './integration-row';   // ★ 1028 K9 — 연동 행 INSERT = CT 하나(몰 접두 고정)
import { timingSafeEqual } from 'crypto';
import {
  IProviderAdapter,
  ProviderCapabilities,
  ProviderTokenResponse,
  ProviderIntegration,
  registerProvider,
} from './provider-registry';
import { identifyCustomer, withdrawMemberConsent } from './cdp-identity';
import { syncOrder } from './cdp-orders';
import { isKnownOrderStatus } from './cdp-order-revenue';
import { mallScopedIds } from './integration-row';
import { openSecret } from './secret-box';   // ★1028 K8 자격 읽기 이중(암호문 · 평문)
import type { WebhookCtx } from './cdp-webhook-delivery';
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
  /** ★ 1028 K6 — token_expires_at DB 원문(만료 표시 CAS · markTokenRejected) */
  tokenExpiresAtRaw: string | null;
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
    signal: AbortSignal.timeout(TIMEOUTS.integrationApi),
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
    throw tokenHttpError(`아임웹 토큰 교환 실패 (${res.status}): ${errBody}`, res.status);
  }
  return normalizeTokenResponse((await res.json()) as ImwebTokenResponse);
}

export async function refreshImwebToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; scope: string }> {
  if (!envReady()) throw new Error('아임웹 OAuth 환경변수가 설정되지 않았습니다.');
  const res = await fetch(IMWEB_TOKEN_URL, {
    signal: AbortSignal.timeout(TIMEOUTS.integrationApi),
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
    throw tokenHttpError(`아임웹 토큰 갱신 실패 (${res.status}): ${errBody}`, res.status);
  }
  return normalizeTokenResponse((await res.json()) as ImwebTokenResponse);
}

// ════════════════════════════════════════════════════════════════════
// company_integrations 저장 / 조회 / 갱신 (provider='imweb', mall_id=siteCode)
// ════════════════════════════════════════════════════════════════════

/** 아임웹 접근 토큰 수명(초) — 저장 · 갱신이 같은 값 */
const IMWEB_ACCESS_TOKEN_SEC = 2 * 60 * 60;

export async function saveImwebIntegration(
  companyId: string,
  siteCode: string,
  token: { accessToken: string; refreshToken: string; scope: string },
  expiresInSec: number = IMWEB_ACCESS_TOKEN_SEC, // Access Token 2시간
  /** ★1028 N6 연결 때 고른 분류코드(토큰 갱신 = 없음 · 그대로) */
  storeCode: string | null = null,
  /** ★1028 Codex R2 #1 바깥 트랜잭션(승인 확정) */
  outer?: TxRun,
): Promise<Date> {
  const expiresAt = new Date(Date.now() + expiresInSec * 1000);
  await saveIntegrationRowGuarded(companyId, 'imweb', siteCode, storeCode, (run) => createIntegrationRow(run, {
    companyId, provider: 'imweb', mallId: siteCode,
    accessToken: { v: token.accessToken },
    refreshToken: { v: token.refreshToken },
    tokenExpiresAt: { v: expiresAt },
    scope: { v: token.scope || DEFAULT_SCOPE },
    meta: { ...(storeCode ? { store_code: storeCode } : {}) },
    webhookSecret: { v: IMWEB_WEBHOOK_SECRET || null },
    connectedAt: { sql: 'NOW()' },
    status: { sql: "'active'" },
    // 옛 문장은 다시 저장 때 meta 를 건드리지 않았다(들어온 meta = 빈 객체 · 합쳐도 같다)
    onConflict: [
      'access_token = EXCLUDED.access_token',
      'refresh_token = EXCLUDED.refresh_token',
      'token_expires_at = EXCLUDED.token_expires_at',
      'scope = EXCLUDED.scope',
      'webhook_secret = COALESCE(EXCLUDED.webhook_secret, company_integrations.webhook_secret)',
      "status = 'active'",
      'connected_at = COALESCE(company_integrations.connected_at, NOW())',
    ],
  }), outer);
  return expiresAt;   // ★ 1028 K6 — 저장한 토큰판(호출부가 든 행의 원문을 맞춘다)
}

function rowToIntegration(r: any): ImwebIntegration {
  return {
    id: r.id,
    companyId: r.company_id,
    siteCode: r.mall_id,
    accessToken: openSecret(r.access_token),
    refreshToken: openSecret(r.refresh_token),
    tokenExpiresAt: new Date(r.token_expires_at),
    tokenExpiresAtRaw: r.token_expires_at_raw ?? null,
    scope: r.scope || DEFAULT_SCOPE,
    status: r.status,
  };
}

export async function getImwebIntegration(companyId: string, siteCode?: string): Promise<ImwebIntegration | null> {
  const result = siteCode
    ? await query(
        `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, token_expires_at::text AS token_expires_at_raw, scope, status
         FROM company_integrations
         WHERE company_id = $1::uuid AND provider = 'imweb' AND mall_id = $2 LIMIT 1`,
        [companyId, siteCode]
      )
    : await query(
        `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, token_expires_at::text AS token_expires_at_raw, scope, status
         FROM company_integrations
         WHERE company_id = $1::uuid AND provider = 'imweb'
         ORDER BY connected_at DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
  return result.rows.length ? rowToIntegration(result.rows[0]) : null;
}

/** ★ 2026-09-27 한줄로 V2 R244 — 같은 사이트가 여러 회사에 연동돼 있으면 전부(웹훅은 회사마다 전달 · R098과 같은 뿌리). */
export async function getImwebIntegrationsBySiteCode(siteCode: string): Promise<ImwebIntegration[]> {
  const result = await query(
    `SELECT id, company_id, mall_id, access_token, refresh_token, token_expires_at, token_expires_at::text AS token_expires_at_raw, scope, status
     FROM company_integrations
     WHERE provider = 'imweb' AND mall_id = $1 AND ${receiveEligibleSql('imweb')}
     ORDER BY connected_at DESC NULLS LAST`,
    [siteCode]
  );
  return result.rows.map(rowToIntegration);
}

export async function ensureFreshImwebToken(integration: ImwebIntegration): Promise<ImwebIntegration> {
  if (integration.tokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS) return integration;
  // ★ 2026-10-19 B-1010-5 — 카페24 와 같다(같은 연동 갱신 한 번 · DB 새 값 재사용 · 옛 refresh_token 재사용 거절 → 「만료」 표시 방지)
  return joinInflight(`imweb-token:${integration.id}`, () => refreshImwebOnce(integration));
}

async function refreshImwebOnce(held: ImwebIntegration): Promise<ImwebIntegration> {
  const latest = await getImwebIntegration(held.companyId, held.siteCode).catch(() => null);
  const integration = latest && latest.id === held.id ? latest : held;
  if (integration.tokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS) return integration;
  try {
    const refreshed = await refreshImwebToken(integration.refreshToken);
    // ★ 1028 Codex R1 #2 — 갱신 저장 = 그 토큰판 · 해제 아닌 행일 때만(재연결 upsert 를 쓰지 않는다)
    const savedExpiry = new Date(Date.now() + IMWEB_ACCESS_TOKEN_SEC * 1000);
    const saved = await saveRefreshedToken({ id: integration.id, tokenExpiresAtRaw: integration.tokenExpiresAtRaw, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, tokenExpiresAt: savedExpiry });
    if (!saved) return reReadAfterLostRefresh(await getImwebIntegration(integration.companyId, integration.siteCode).catch(() => null), integration.id);
    return { ...integration, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, tokenExpiresAt: savedExpiry, tokenExpiresAtRaw: savedExpiry.toISOString() };
  } catch (err) {
    // ★ 2026-09-26 R1-31 — 제공자가 거절했을 때만 만료로 표시한다(일시 장애 한 번에 연동이 끊겨 웹훅이 유실됐다)
    // ★ 1028 K6 — 그 요청에 쓴 토큰판일 때만 · 유예 시계 같은 문장(markTokenRejected)
    if (isDefinitiveTokenRejection(err)) await markTokenRejected(integration);
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
    const res = await fetch(url, { ...fetchOpts, signal: AbortSignal.timeout(TIMEOUTS.integrationApi) });
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

/** 아임웹 주문의 고객 열쇠 · 주문 번호(★ 1028 K9 — 그 연동 행의 몰 접두 · mallScopedIds 반환값) */
function imwebOrderIds(ctx: WebhookCtx, memberUid: unknown, phone: unknown, orderNo: unknown): { orderId: string; externalId: string } {
  const ids = mallScopedIds(ctx.idScope, { memberId: memberUid, phone, orderId: orderNo });
  return { orderId: ids.orderId, externalId: ids.externalId };
}

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

  async processWebhookEvent(companyId, event, resource, ctx) {
    // ★ 2026-10-27 자사몰 대비 K1-3 · K1-6 — 원천 시각이 없으면 받은 시각(ctx.observedAt) · 옛 스냅숏 = 'stale'
    switch (event) {
      // 회원 — 생성/수정/동의수정/등급변경/일괄등록 → identify
      case 'END_USER_SIGN_UP':
      case 'END_USER_SIGN_UP_BULK':
      case 'END_USER_INFO_UPDATE':
      case 'END_USER_AGREE_INFO_UPDATE':
      case 'END_USER_GRADE_UPDATE':
        await identifyCustomer(companyId, {
          ...(ctx.storeCode ? { storeCode: ctx.storeCode } : {}),   // ★ 1027 K9 — 연동 행 분류코드(소속 행 · 몰 동의)
          source: 'imweb',
          externalId: mallScopedIds(ctx.idScope, { memberId: resource.memberUid || resource.member_uid || resource.memberCode }).memberExternalId,
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

      // 탈퇴 → 광고 수신 철회 + 기록 이벤트
      // ★ 2026-10-04 옛: 이벤트만 남기고 그 이벤트를 읽는 곳이 없어(주석의 "발송 제외"가 실제로 일어나지 않음) 탈퇴 회원이 계속 발송 대상이었다.
      //   이제 연결된 고객의 수신동의를 내린다(withdrawMemberConsent · 영구 수신거부 표로는 옮기지 않는다 = D93).
      case 'END_USER_WITHDRAWAL': {
        const withdrawnId = mallScopedIds(ctx.idScope, { memberId: resource.memberUid || resource.member_uid }).memberExternalId;
        await withdrawMemberConsent(companyId, 'imweb', withdrawnId, String(resource.occurredAt || ctx.observedAt), ctx.storeCode);   // ★1028 K5 분류코드 몰 = 그 몰 소속 행
        await trackEvent(companyId, {
          source: 'imweb',
          eventName: 'custom_member_withdrawn',
          externalId: withdrawnId,
          properties: { imweb_member_uid: resource.memberUid },
          occurredAt: String(resource.occurredAt || ctx.observedAt),
        });
        break;
      }

      // 장바구니 담기 → 장바구니 이탈 여정
      case 'END_USER_CART_ADD':
        await trackEvent(companyId, {
          source: 'imweb',
          // ★ 2026-10-04 표준 이름 — 장바구니 이탈 여정·인앱 트리거는 'cart_add' 만 본다(옛 'custom_cart_add' 는 읽는 곳 0)
          eventName: 'cart_add',
          externalId: mallScopedIds(ctx.idScope, { memberId: resource.memberUid || resource.member_uid }).memberExternalId,
          properties: {
            product_no: resource.prodNo || resource.productNo,
            product_name: resource.prodName || resource.productName,
          },
          occurredAt: String(resource.occurredAt || ctx.observedAt),
        });
        break;

      // 주문 — 생성/입금완료 → 구매이력 동기화
      case 'ORDER_CREATE':
      case 'ORDER_DEPOSIT_COMPLETE': {
        const imwebStatus = event === 'ORDER_DEPOSIT_COMPLETE' ? 'paid' : String(resource.orderStatus || event);
        const placed = await syncOrder(companyId, {
          ...(ctx.storeCode ? { storeCode: ctx.storeCode } : {}),   // ★ 1027 K9 — 연동 행 분류코드(소속 행 · 몰 동의)
          source: 'imweb',
          ...imwebOrderIds(ctx, resource.memberUid || resource.member_uid, resource.call || resource.mobile || resource.phone, resource.orderNo || resource.order_no),
          // ★ 2026-09-27 한줄로 V2 R245 — 비회원 주문도 적재(주문 외부 id CT)
          email: resource.email,
          phone: resource.call || resource.mobile || resource.phone,
          name: resource.name || resource.ordererName,
          // ★ 2026-10-04 입금 완료 웹훅은 그 자체가 결제 사실이다 → 'paid'(옛: 이벤트 이름이 상태로 들어가 매출이 반영되지 않았다).
          //   주문 생성의 몰 상태 값은 아직 원문 미확인이라 그대로 둔다(모르는 값 = 매출 변화 없음).
          status: imwebStatus,
          statusKnown: isKnownOrderStatus(imwebStatus),
          totalAmount: firstPositiveAmount(resource.totalPrice, resource.paidPrice, resource.totalRefundPrice),
          orderedAt: String(resource.orderTime || resource.orderedAt || ctx.observedAt),
          srcAt: ctx.observedAt,
          currency: 'KRW',
        });
        if (placed.stale) return 'stale';
        break;
      }

      // 배송 상태 변화 → 배송 여정 트리거(발송 알림·배송완료 후기/재구매)
      case 'ORDER_SHIPPING_READY':
      case 'ORDER_SHIPPING':
      case 'ORDER_SHIPPING_COMPLETE':
      case 'ORDER_INVOICE_REGISTERED':
        await trackEvent(companyId, {
          source: 'imweb',
          eventName: `custom_${event.toLowerCase()}`,
          externalId: mallScopedIds(ctx.idScope, { memberId: resource.memberUid || resource.member_uid }).memberExternalId,
          properties: {
            order_no: resource.orderNo,
            section_code: resource.orderSectionCode,
            invoice_no: resource.invoiceNo,
          },
          occurredAt: String(resource.occurredAt || ctx.observedAt),
        });
        break;

      // 취소/반품/환불 → 매출 차감(결제로 반영된 주문만 · CT-86 표식) + 상태 이벤트
      // ★ 2026-10-04 옛: 이벤트만 남겨 취소·환불된 주문의 매출이 고객 요약(RFM)에 그대로 남았다(카페24 수신부는 syncOrder 로 차감).
      case 'ORDER_CANCEL_COMPLETE':
      case 'ORDER_RETURN_COMPLETE':
      case 'ORDER_REFUND': {
        const memberUid = resource.memberUid || resource.member_uid;
        const phone = resource.call || resource.mobile || resource.phone;
        const orderNo = resource.orderNo || resource.order_no;
        // 주문 생성 때와 같은 고객 식별 규칙(mallScopedIds) · 회원도 번호도 없으면 고객을 지어내지 않는다(차감 생략 · 로그)
        if (orderNo && (memberUid || phone)) {
          const reversed = await syncOrder(companyId, {
            ...(ctx.storeCode ? { storeCode: ctx.storeCode } : {}),   // ★ 1027 K9 — 연동 행 분류코드(소속 행 · 몰 동의)
            source: 'imweb',
            ...imwebOrderIds(ctx, memberUid, phone, orderNo),
            email: resource.email,
            phone,
            name: resource.name || resource.ordererName,
            status: event === 'ORDER_CANCEL_COMPLETE' ? 'cancelled' : 'refunded',
            totalAmount: firstPositiveAmount(resource.totalPrice, resource.paidPrice, resource.totalRefundPrice),
            orderedAt: String(resource.orderTime || resource.orderedAt || resource.occurredAt || ctx.observedAt),
            srcAt: ctx.observedAt,
            currency: 'KRW',
          });
          if (reversed.stale) return 'stale';
        } else {
          console.log(`[Imweb Adapter] ${event} — 주문번호·고객 식별값 없음, 매출 차감 생략 (order=${orderNo || '-'})`);
        }
        if (memberUid) {
          await trackEvent(companyId, {
            source: 'imweb',
            eventName: 'custom_order_cancelled',
            externalId: mallScopedIds(ctx.idScope, { memberId: memberUid }).memberExternalId,
            properties: { order_no: orderNo, status: event },
            occurredAt: String(resource.occurredAt || ctx.observedAt),
          });
        }
        break;
      }

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
