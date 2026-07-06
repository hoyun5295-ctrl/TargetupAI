/**
 * ★ CT: 메이크샵 (커넥트웨이브 파트너센터 커머스 API) 클라이언트 — 2026-07-06 신설 (서버 실측 확정)
 *
 * 🔐 인증 — OAuth2 client_credentials + Basic 헤더 (네이버와 달리 서명 없음). 토큰 5분(300초).
 *   POST https://connect.makeshop.co.kr/oauth/token
 *     Authorization: Basic base64(client_id:client_secret)
 *     Content-Type: application/x-www-form-urlencoded
 *     body: grant_type=client_credentials & shop_uid={상점ID}
 *   응답 { success, data: { access_token, token_type:'Bearer', expires_in:300 } }
 *   제한: shop_uid+IP 조합당 1분 5회. IP 화이트리스트 아님(2026-07-06 서버 실측 — 등록 없이 발급 성공).
 *   실측: gyunoo83로 토큰 발급 + 회원 조회 return_code '0000' 확정.
 *
 * 📦 데이터 API (Bearer): base https://connect.makeshop.co.kr/api/v1/:shopId
 *   회원 GET /user  (hname·mobile·sms_receive·grade·birth_day·email·order_count·reg_date) — 조회 30일·limit MAX 5000
 *   주문 GET /order/2 (sender·mobile·pay_price·product[]) — 조회 30일
 *
 * ⛔ webhook 없음 → polling(수동/배치 조회). 자격 = company_integrations.meta{app_client_id,app_client_secret}, mall_id=shop_uid.
 * ⛔ 회원 list 내부 필드는 문서 스키마 기반 매핑 — 테스트몰 회원 0건이라 실데이터 미확인. preview raw로 실고객사 데이터 최종 검증.
 */

import { query } from '../config/database';
import {
  IProviderAdapter,
  ProviderCapabilities,
  ProviderTokenResponse,
  ProviderIntegration,
  registerProvider,
} from './provider-registry';

const MAKESHOP_CLIENT_ID = process.env.MAKESHOP_CLIENT_ID || '';
const MAKESHOP_CLIENT_SECRET = process.env.MAKESHOP_CLIENT_SECRET || '';

const MAKESHOP_TOKEN_URL = 'https://connect.makeshop.co.kr/oauth/token';
const MAKESHOP_API_BASE = 'https://connect.makeshop.co.kr/api/v1';
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000; // 토큰 5분 — 1분 전 재발급

export interface MakeshopCredentials {
  clientId: string;
  clientSecret: string;
}

export interface MakeshopTokenResponse {
  access_token: string;
  token_type: string;   // Bearer
  expires_in: number;   // 초 (300 = 5분). refresh_token 없음 — 만료 임박 시 재발급.
}

export interface MakeshopIntegration {
  id: string;
  companyId: string;
  shopUid: string;      // 상점 ID (mall_id로 저장)
  accessToken: string;
  tokenExpiresAt: Date;
  status: string;
}

// ════════════════════════════════════════════════════════════════════
// 인증
// ════════════════════════════════════════════════════════════════════

function envMakeshopCreds(): MakeshopCredentials | null {
  if (!MAKESHOP_CLIENT_ID || !MAKESHOP_CLIENT_SECRET) return null;
  return { clientId: MAKESHOP_CLIENT_ID, clientSecret: MAKESHOP_CLIENT_SECRET };
}

function basicAuthHeader(creds: MakeshopCredentials): string {
  return 'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
}

/** 액세스 토큰 발급 (client_credentials + Basic, 5분). refresh 없음 — 만료 임박 시 재호출. */
export async function issueMakeshopToken(creds: MakeshopCredentials, shopUid: string): Promise<MakeshopTokenResponse> {
  const res = await fetch(MAKESHOP_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(creds), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', shop_uid: shopUid }).toString(),
  });
  if (!res.ok) {
    const errBody = await safeJsonText(res);
    throw new Error(`메이크샵 토큰 발급 실패 (${res.status}): ${errBody}`);
  }
  const json = (await res.json()) as { success?: boolean; data?: { access_token?: string; token_type?: string; expires_in?: number }; error?: string; error_description?: string };
  const token = json?.data?.access_token;
  if (!token) {
    throw new Error(`메이크샵 토큰 발급 응답에 access_token 없음: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return {
    access_token: token,
    token_type: json.data?.token_type || 'Bearer',
    expires_in: Number(json.data?.expires_in) || 300,
  };
}

// ════════════════════════════════════════════════════════════════════
// company_integrations 저장 / 조회
// ════════════════════════════════════════════════════════════════════

export async function saveMakeshopIntegration(
  companyId: string,
  shopUid: string,
  tokenRes: MakeshopTokenResponse,
  creds?: MakeshopCredentials,
): Promise<void> {
  const expiresAt = new Date(Date.now() + (tokenRes.expires_in || 300) * 1000);
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
      gen_random_uuid(), $1::uuid, 'makeshop', $2, $3, '',
      $4, '', $5::jsonb, NULL, NOW(), 'active',
      NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = '',
      token_expires_at = EXCLUDED.token_expires_at,
      scope = '',
      meta = company_integrations.meta || EXCLUDED.meta,
      status = 'active',
      connected_at = NOW(),
      updated_at = NOW()`,
    [companyId, shopUid, tokenRes.access_token, expiresAt, JSON.stringify(meta)],
  );
}

function rowToIntegration(r: any): MakeshopIntegration {
  return {
    id: r.id,
    companyId: r.company_id,
    shopUid: r.mall_id,
    accessToken: r.access_token,
    tokenExpiresAt: new Date(r.token_expires_at),
    status: r.status,
  };
}

export async function getMakeshopIntegration(companyId: string, shopUid?: string): Promise<MakeshopIntegration | null> {
  const r = shopUid
    ? await query(
        `SELECT id, company_id, mall_id, access_token, token_expires_at, status
         FROM company_integrations WHERE company_id = $1::uuid AND provider = 'makeshop' AND mall_id = $2 LIMIT 1`,
        [companyId, shopUid],
      )
    : await query(
        `SELECT id, company_id, mall_id, access_token, token_expires_at, status
         FROM company_integrations WHERE company_id = $1::uuid AND provider = 'makeshop'
         ORDER BY connected_at DESC NULLS LAST LIMIT 1`,
        [companyId],
      );
  if (r.rows.length === 0) return null;
  return rowToIntegration(r.rows[0]);
}

export async function getMakeshopCredentials(companyId: string, shopUid?: string): Promise<MakeshopCredentials | null> {
  const r = shopUid
    ? await query(`SELECT meta FROM company_integrations WHERE company_id = $1::uuid AND provider = 'makeshop' AND mall_id = $2 LIMIT 1`, [companyId, shopUid])
    : await query(`SELECT meta FROM company_integrations WHERE company_id = $1::uuid AND provider = 'makeshop' ORDER BY connected_at DESC NULLS LAST LIMIT 1`, [companyId]);
  const meta = (r.rows[0]?.meta || {}) as { app_client_id?: string; app_client_secret?: string };
  const id = String(meta.app_client_id || '').trim();
  const secret = String(meta.app_client_secret || '').trim();
  if (id && secret) return { clientId: id, clientSecret: secret };
  return envMakeshopCreds();
}

export async function ensureFreshMakeshopToken(integration: MakeshopIntegration, creds?: MakeshopCredentials): Promise<MakeshopIntegration> {
  if (integration.tokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return integration;
  }
  try {
    const c = creds ?? (await getMakeshopCredentials(integration.companyId, integration.shopUid)) ?? envMakeshopCreds();
    if (!c) throw new Error('메이크샵 자격(client_id/secret)이 없습니다 — 연동 화면에서 다시 연결해주세요.');
    const reissued = await issueMakeshopToken(c, integration.shopUid);
    await saveMakeshopIntegration(integration.companyId, integration.shopUid, reissued, c);
    return { ...integration, accessToken: reissued.access_token, tokenExpiresAt: new Date(Date.now() + (reissued.expires_in || 300) * 1000) };
  } catch (err) {
    await query(`UPDATE company_integrations SET status = 'token_expired', updated_at = NOW() WHERE id = $1::uuid`, [integration.id]);
    throw err;
  }
}

/**
 * ★ 연동 진입점 — 자격+shop_uid로 토큰 발급을 "실제 검증"한 뒤에만 active 저장 (6원칙 ②).
 * 발급 실패 시 그대로 throw — 저장/상태 변경 0.
 */
export async function connectMakeshop(companyId: string, shopUid: string, creds: MakeshopCredentials): Promise<{ tokenExpiresAt: Date }> {
  const tokenRes = await issueMakeshopToken(creds, shopUid);
  await saveMakeshopIntegration(companyId, shopUid, tokenRes, creds);
  return { tokenExpiresAt: new Date(Date.now() + (tokenRes.expires_in || 300) * 1000) };
}

// ════════════════════════════════════════════════════════════════════
// 데이터 조회 (Bearer)
// ════════════════════════════════════════════════════════════════════

async function makeshopApiCall<T = unknown>(
  integration: MakeshopIntegration,
  path: string,
  query_: Record<string, string | number | undefined> = {},
  creds?: MakeshopCredentials,
): Promise<T> {
  const fresh = await ensureFreshMakeshopToken(integration, creds);
  const qs = Object.entries(query_).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const url = `${MAKESHOP_API_BASE}/${fresh.shopUid}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${fresh.accessToken}`, Accept: 'application/json' } });
  if (!res.ok) {
    const errBody = await safeJsonText(res);
    throw new Error(`메이크샵 API 호출 실패 (${res.status}): ${errBody}`);
  }
  return (await res.json()) as T;
}

/** 최근 N일 회원 조회 (raw 반환) — 조회 30일 제한, limit MAX 5000. */
export async function fetchMakeshopMembers(integration: MakeshopIntegration, days: number, limit = 100): Promise<unknown> {
  const clamped = Math.min(Math.max(days, 1), 30);
  const from = toMakeshopDate(new Date(Date.now() - clamped * 24 * 60 * 60 * 1000));
  const to = toMakeshopDate(new Date());
  return makeshopApiCall(integration, '/user', { InquiryTimeFrom: from, InquiryTimeTo: to, limit: Math.min(limit, 5000) });
}

/** 최근 N일 주문 2.0 조회 (raw 반환) — 조회 30일 제한. */
export async function fetchMakeshopOrders(integration: MakeshopIntegration, days: number, limit = 100): Promise<unknown> {
  const clamped = Math.min(Math.max(days, 1), 30);
  const from = toMakeshopDate(new Date(Date.now() - clamped * 24 * 60 * 60 * 1000));
  const to = toMakeshopDate(new Date());
  return makeshopApiCall(integration, '/order/2', { InquiryTimeFrom: from, InquiryTimeTo: to, limit: Math.min(limit, 5000) });
}

/** 연동 검증·스키마 실측용 미리보기 — 회원+주문 raw 동시 반환. */
export async function fetchMakeshopPreview(integration: MakeshopIntegration, days: number): Promise<{ from: string; membersRaw: unknown; ordersRaw: unknown }> {
  const clamped = Math.min(Math.max(days, 1), 30);
  const from = toMakeshopDate(new Date(Date.now() - clamped * 24 * 60 * 60 * 1000));
  const membersRaw = await fetchMakeshopMembers(integration, clamped, 20);
  const ordersRaw = await fetchMakeshopOrders(integration, clamped, 20);
  return { from, membersRaw, ordersRaw };
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

/** 메이크샵 날짜 포맷 0000-00-00 00:00:00 (KST). */
function toMakeshopDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}:${p(kst.getUTCSeconds())}`;
}

async function safeJsonText(res: Response): Promise<string> {
  try { return JSON.stringify(await res.json()); }
  catch {
    try { return await res.text(); }
    catch { return '<응답 본문 파싱 실패>'; }
  }
}

// ════════════════════════════════════════════════════════════════════
// IProviderAdapter — polling (webhook 미지원)
// ════════════════════════════════════════════════════════════════════

const makeshopCapabilities: ProviderCapabilities = {
  oauth: false,       // client_credentials(자격 입력) — OAuth 리다이렉트 없음
  webhook: false,     // webhook 미제공 — polling
  webhookSignatureVerification: false,
  adminApi: true,
};

export const makeshopAdapter: IProviderAdapter = {
  provider: 'makeshop',
  displayName: '메이크샵',
  capabilities: makeshopCapabilities,
  connectMethod: 'polling', // 자격 입력 + 조회형 — 고도몰과 동일 모델
  available: true,

  buildAuthorizeUrl(): string {
    throw new Error('메이크샵은 OAuth 리다이렉트가 아니라 애플리케이션 자격(client_id/secret) + 상점ID 입력으로 연동합니다. POST /api/makeshop/connect 를 사용하세요.');
  },
  async exchangeCode(): Promise<ProviderTokenResponse> {
    throw new Error('메이크샵은 authorize code 교환을 지원하지 않습니다 (client_credentials 방식).');
  },
  async refreshToken(integration: ProviderIntegration) {
    const creds = (await getMakeshopCredentials(integration.companyId, integration.mallId)) ?? envMakeshopCreds();
    if (!creds) throw new Error('메이크샵 자격(client_id/secret)이 없습니다 — 연동 화면에서 다시 연결해주세요.');
    const tokenRes = await issueMakeshopToken(creds, integration.mallId);
    return {
      accessToken: tokenRes.access_token,
      refreshToken: '',
      expiresAt: new Date(Date.now() + (tokenRes.expires_in || 300) * 1000),
      scope: '',
      metadata: { token_type: tokenRes.token_type, expires_in: tokenRes.expires_in },
    };
  },
  verifyWebhookSignature(): boolean {
    return false; // webhook 미지원
  },
  async processWebhookEvent(): Promise<void> {
    // webhook 미제공 — polling으로만 동기화
  },
  extractMallIdFromWebhook(): string | null {
    return null;
  },
  extractEventFromWebhook(): string | null {
    return null;
  },
  buildIdempotencyKey(event: string): string {
    return `${event}:makeshop`;
  },
};

registerProvider(makeshopAdapter);
