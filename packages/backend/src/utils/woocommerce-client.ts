/**
 * 우커머스(WooCommerce · 워드프레스) REST 커넥터 — IO 계층 — 2026-09-14 W2
 * 설계서 = docs/2026-09-14-woocommerce-integration-design.md (§2 불변 9 · §3 구조)
 *
 * BYO-키 방식(몰별):
 *   - consumer key / consumer secret = 고객사가 우커머스 관리자(WooCommerce → 설정 → 고급 → REST API)에서 읽기 권한으로 발급
 *   - HTTPS Basic 헤더로만 보낸다(쿼리스트링 인증 금지 — 비밀이 URL·로그에 남는다)
 *   - 저장 자리 = company_integrations.meta(woo_consumer_key · woo_consumer_secret · woo_consent_meta_key · woo_site_url)
 *   - 행 1개 = 몰 1개(mall_id = normalizeWooMallId(몰 주소) · UNIQUE(company_id, provider, mall_id)) — 한 회사가 몰 4개를 붙인다
 *   - 웹훅 secret 은 우리가 발급(webhook_secret 컬럼 · 64 hex) → 고객사가 우커머스 웹훅 생성 시 입력
 *
 * 흐름: 자격 저장(pending) → 연결 검증 1콜(주문 1건 읽기) 성공 시에만 active + connected_at → 백필(회원 · 주문 90일) →
 *       주기 수집(woocommerce-sync-worker · modified_after) + 웹훅 수신(routes/woocommerce.ts → woocommerce-adapter).
 * 순수 매핑은 woocommerce-core.ts(DB-free · TDD). 이 파일은 언제·누구를·얼마나 만 정한다.
 *
 * ⛔ 실 응답 형태(date_*_gmt 형식 · meta_data 위치 · modified_after 지원 여부)는 게이트 ② 실측으로 최종 확인(D217).
 *    modified_after 를 서버가 모르면 무시된다 — 그래서 after(생성일 바닥 90일)를 항상 함께 보내 범위를 묶는다.
 */

import axios from 'axios';
import { randomBytes } from 'crypto';
import { query } from '../config/database';
import { syncOrder } from './cdp-orders';
import { identifyCustomer, parseConsentValue } from './cdp-identity';
import { WOO_SOURCE, normalizeWooMallId, wooSiteOrigin, mapWooCustomerToCdp, mapWooOrderToCdp, type WooTopicResource } from './woocommerce-core';
export { wooSiteOrigin };
import { normalizeWooStoreProduct, type MallProduct } from './mall-product-normalize';

// ════════════════════════════════════════════════════════════════════
// 상수
// ════════════════════════════════════════════════════════════════════

export const WOO_PROVIDER = WOO_SOURCE;            // company_integrations.provider = cdp_events.source = 'woocommerce'
export const DEFAULT_BACKFILL_DAYS = 90;
export const PAGE_SIZE = 100;                       // 우커머스 REST per_page 상한
export const MAX_CUSTOMER_PAGES = 50;               // 회원 백필 상한(5,000명) — 넘으면 truncated 로 알린다
export const MAX_ORDER_PAGES = 400;          // 연결 시 백필 주문 상한(40,000건)
export const MAX_SYNC_PAGES = 50;            // 주기 수집 한 회차 상한(5,000건) — modified_after 를 서버가 모를 때 90일치가 통째로 오는 것을 막는다
export const STORE_PAGE_MAX = 100;                  // Store API per_page 상한
/** 우리가 받는 웹훅 주제 4종 — 1클릭 연결이 REST 로 자동 생성한다(화면 안내 문안과 같은 목록) */
export const WOO_WEBHOOK_TOPICS = ['order.created', 'order.updated', 'customer.created', 'customer.updated'] as const;
const HTTP_TIMEOUT_MS = 20000;
const USER_AGENT = 'Hanjullo-CDP/1.0';

export type WooApiErrorCode =
  | 'invalid_site' | 'no_integration' | 'no_keys'
  | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'redirect' | 'http' | 'bad_response' | 'network';

const ERROR_MESSAGE: Record<WooApiErrorCode, string> = {
  invalid_site: '몰 주소를 인식할 수 없습니다. https://로 시작하는 쇼핑몰 주소를 입력해주세요.',
  no_integration: '저장된 우커머스 몰이 없습니다. 먼저 몰 주소와 REST 키를 저장해주세요.',
  no_keys: 'REST API 키가 없어 연결 확인을 건너뜁니다. 웹훅이 처음 들어오면 자동으로 연결됩니다.',
  unauthorized: 'REST API 키가 맞지 않거나 읽기 권한이 없습니다. 호스팅이 Authorization 헤더를 막는 경우도 있습니다.',
  forbidden: 'REST API 접근이 거부되었습니다(403). 키 권한 또는 보안 플러그인 설정을 확인해주세요.',
  not_found: '우커머스 REST API 주소를 찾을 수 없습니다(404). 몰 주소와 우커머스 설치 여부를 확인해주세요.',
  rate_limited: '몰 서버가 요청을 제한했습니다(429). 잠시 후 다시 시도해주세요.',
  redirect: '몰 주소가 다른 주소로 이동합니다(리다이렉트). 실제 접속 주소(www 포함 여부·https)를 그대로 입력해주세요.',
  http: '몰 서버가 오류를 돌려주었습니다.',
  bad_response: '몰 서버 응답이 우커머스 REST 형식이 아닙니다. 주소가 우커머스 몰인지 확인해주세요.',
  network: '몰 서버에 연결할 수 없습니다. 주소와 서버 상태를 확인해주세요.',
};

export class WooApiError extends Error {
  constructor(public code: WooApiErrorCode, message?: string, public httpStatus?: number) {
    super(message || ERROR_MESSAGE[code]);
    this.name = 'WooApiError';
  }
}

// ════════════════════════════════════════════════════════════════════
// 순수 — URL · 인증 헤더 · 웹훅 URL
// ════════════════════════════════════════════════════════════════════

type UrlParams = Record<string, string | number | undefined | null>;

function withParams(base: string, params: UrlParams): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** REST v3 = {origin}/wp-json/wc/v3/{자원}. 인증은 헤더로만 — 여기엔 비밀이 없다. */
export function wooRestUrl(siteOrHost: string, resource: 'orders' | 'customers' | 'products' | 'webhooks' | `webhooks/${string}`, params: UrlParams): string {
  return withParams(`${wooSiteOrigin(siteOrHost)}/wp-json/wc/v3/${resource}`, params);
}

/** Store API(공개 · 키 불필요) = {origin}/wp-json/wc/store/v1/products. 상품 피커·AI 자동제작 재조회가 쓴다. */
export function wooStoreUrl(siteOrHost: string, params: { search?: string; per_page?: number; page?: number; include?: readonly string[] }): string {
  return withParams(`${wooSiteOrigin(siteOrHost)}/wp-json/wc/store/v1/products`, {
    search: params.search,
    per_page: params.per_page,
    page: params.page,
    include: params.include && params.include.length ? params.include.join(',') : undefined,
  });
}

export function wooBasicAuth(consumerKey: string, consumerSecret: string): string {
  return 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
}

/** 몰별 웹훅 수신 주소 — 몰 식별자를 경로에 둔다(발신 헤더는 미검증이라 보조). */
export function buildWooWebhookUrl(mallId: string, base: string = process.env.APP_BASE_URL || 'https://app.hanjul.ai'): string {
  return `${base.replace(/\/$/, '')}/api/woocommerce/webhook/${mallId}`;
}

/** 우커머스가 받는 ISO8601(시간대 표기 없음 · 초 단위). ms·Z 를 뗀다. */
function wooDateParam(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

// ════════════════════════════════════════════════════════════════════
// 행 ↔ 모델
// ════════════════════════════════════════════════════════════════════

export interface WooIntegration {
  id: string;
  companyId: string;
  mallId: string;
  siteUrl: string;
  status: string;
  connectedAt: Date | null;
  lastSyncedAt: Date | null;
  webhookSecret: string | null;
  consumerKey: string;
  consumerSecret: string;
  consentMetaKey: string | null;
  /** 앱 인증으로 받은 키 권한(read · write · read_write) · 직접 입력이면 '' */
  keyPermissions: string;
  /** 1클릭 연결이 만든 웹훅 id(해제 시 제거) */
  webhookIds: number[];
  syncError: { message: string; code: string; at: string | null } | null;
}

interface WooMeta {
  woo_site_url?: string;
  woo_consumer_key?: string;
  woo_consumer_secret?: string;
  woo_key_permissions?: string;
  woo_webhook_ids?: number[];
  woo_consent_meta_key?: string;
  woo_sync_error?: string;
  woo_sync_error_code?: string;
  woo_sync_error_at?: string;
}

const ROW_COLUMNS = 'id, company_id, mall_id, status, connected_at, last_synced_at, webhook_secret, meta';

function toIntegration(r: any): WooIntegration {
  const meta = (r.meta || {}) as WooMeta;
  return {
    id: r.id,
    companyId: r.company_id,
    mallId: r.mall_id,
    siteUrl: meta.woo_site_url || `https://${r.mall_id}/`,
    status: r.status,
    connectedAt: r.connected_at ? new Date(r.connected_at) : null,
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at) : null,
    webhookSecret: r.webhook_secret || null,
    consumerKey: meta.woo_consumer_key || '',
    consumerSecret: meta.woo_consumer_secret || '',
    consentMetaKey: meta.woo_consent_meta_key || null,
    keyPermissions: meta.woo_key_permissions || '',
    webhookIds: Array.isArray(meta.woo_webhook_ids) ? meta.woo_webhook_ids.map(Number).filter((n) => Number.isFinite(n)) : [],
    syncError: meta.woo_sync_error
      ? { message: meta.woo_sync_error, code: meta.woo_sync_error_code || 'unknown', at: meta.woo_sync_error_at || null }
      : null,
  };
}

const hasKeys = (i: WooIntegration): boolean => !!(i.consumerKey && i.consumerSecret);

// ════════════════════════════════════════════════════════════════════
// 자격 저장/조회/상태
// ════════════════════════════════════════════════════════════════════

export interface SaveWooCredentialsInput {
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
  consentMetaKey: string;
}

export interface SaveWooCredentialsResult {
  mallId: string;
  webhookUrl: string;
  /** 이 응답에서만 1회 노출 — 화면이 즉시 고객사 담당자에게 전달한다 */
  webhookSecret: string;
}

/**
 * 몰 자격 저장. 행이 없으면 pending 으로 만들고 웹훅 secret 을 발급한다.
 * 이미 있는 행은 meta 만 덧쓰고 status·secret 은 보존한다(해제(revoked)됐던 몰은 pending 으로 되살린다).
 * 저장만으로는 연결이 아니다 — verifyWooConnection 성공 또는 첫 웹훅 수신(서명 통과)이 active 로 올린다.
 */
export async function saveWooCredentials(companyId: string, input: SaveWooCredentialsInput): Promise<SaveWooCredentialsResult> {
  const mallId = normalizeWooMallId(input.siteUrl);
  if (!mallId) throw new WooApiError('invalid_site');
  const meta: WooMeta = { woo_site_url: String(input.siteUrl || '').trim() };
  const ck = String(input.consumerKey || '').trim();
  const cs = String(input.consumerSecret || '').trim();
  const consent = String(input.consentMetaKey || '').trim();
  if (ck) meta.woo_consumer_key = ck;
  if (cs) meta.woo_consumer_secret = cs;
  if (consent) meta.woo_consent_meta_key = consent;
  const freshSecret = randomBytes(32).toString('hex');

  const r = await query(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, 'woocommerce', $2, '', '',
      NULL, '', $3::jsonb, $4, NULL, 'pending', NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      meta = company_integrations.meta || EXCLUDED.meta,
      webhook_secret = COALESCE(company_integrations.webhook_secret, EXCLUDED.webhook_secret),
      status = CASE WHEN company_integrations.status = 'revoked' THEN 'pending' ELSE company_integrations.status END,
      updated_at = NOW()
    RETURNING webhook_secret`,
    [companyId, mallId, JSON.stringify(meta), freshSecret],
  );
  const webhookSecret = String(r.rows[0]?.webhook_secret || freshSecret);
  await registerWooAllowedOrigins(companyId, mallId);
  return { mallId, webhookUrl: buildWooWebhookUrl(mallId), webhookSecret };
}

/**
 * 몰 도메인을 수집 허용 도메인(companies.cdp_allowed_origins)에 등록 — 브라우저 SDK 수집은 이 목록에 있어야 열린다
 * (LESSONS_BACKEND 자사몰 연동 절: "연동 시 자동 등록 안 하면 SDK 깔아도 수집 0"). SQL 은 routes/cdp.ts POST /allowed-origins 와 같다.
 * 실패(미마이그레이션 등)는 저장을 막지 않고 로그만 남긴다 — 담당자가 화면에서 수동 등록할 수 있다.
 */
async function registerWooAllowedOrigins(companyId: string, mallId: string): Promise<void> {
  const origins = [`https://${mallId}`, `https://www.${mallId}`];
  try {
    await query(
      `UPDATE companies
         SET cdp_allowed_origins = ARRAY(SELECT DISTINCT unnest(COALESCE(cdp_allowed_origins, '{}'::text[]) || $2::text[])),
             updated_at = NOW()
       WHERE id = $1::uuid`,
      [companyId, origins],
    );
  } catch (err: any) {
    console.log(`[WooCommerce] 수집 허용 도메인 자동 등록 실패(저장은 계속) company=${companyId} mall=${mallId} err=${err?.message}`);
  }
}

/** 웹훅 secret 재발급(옛 secret 즉시 폐기 · 고객사가 우커머스 웹훅 설정을 갱신해야 다시 받는다). */
export async function rotateWooWebhookSecret(companyId: string, mallId: string): Promise<{ webhookSecret: string; webhookUrl: string }> {
  const secret = randomBytes(32).toString('hex');
  const r = await query(
    `UPDATE company_integrations SET webhook_secret = $3, updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 AND status <> 'revoked'
     RETURNING id`,
    [companyId, mallId, secret],
  );
  if (r.rows.length === 0) throw new WooApiError('no_integration');
  return { webhookSecret: secret, webhookUrl: buildWooWebhookUrl(mallId) };
}

/**
 * 앱 인증(wc-auth) 콜백이 준 REST 키 저장 — 해제(revoked) 아닌 행에만 병합. 행이 없으면 false(콜백 위조·해제 뒤 도착).
 */
export async function saveWooRestKeysFromAuth(
  companyId: string,
  mallId: string,
  keys: { consumerKey: string; consumerSecret: string; permissions: string },
): Promise<boolean> {
  const r = await query(
    `UPDATE company_integrations
     SET meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 AND status <> 'revoked'
     RETURNING id`,
    [companyId, mallId, JSON.stringify({ woo_consumer_key: keys.consumerKey, woo_consumer_secret: keys.consumerSecret, woo_key_permissions: keys.permissions })],
  );
  return r.rows.length > 0;
}

/** 자동 설정(검증·웹훅 생성·백필) 실패 사유 — 주기 수집 실패와 같은 meta 키에 남겨 화면 "조치 필요" 경로 하나로 보이게 한다. */
export async function recordWooSetupError(companyId: string, mallId: string, code: string, message: string): Promise<void> {
  await query(
    `UPDATE company_integrations
        SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
              'woo_sync_error', $3::text,
              'woo_sync_error_code', $4::text,
              'woo_sync_error_at', to_char(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS')
            ),
            updated_at = NOW()
      WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
    [companyId, mallId, String(message || '').slice(0, 500), code],
  );
}

/** 회사 + 몰 행(해제된 몰은 없음으로). 어댑터·워커·라우트가 전부 이 함수로 몰을 잡는다(타사 몰 오적재 차단). */
export async function getWooIntegration(companyId: string, mallId: string): Promise<WooIntegration | undefined> {
  const r = await query(
    `SELECT ${ROW_COLUMNS} FROM company_integrations
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 LIMIT 1`,
    [companyId, mallId],
  );
  if (r.rows.length === 0 || r.rows[0].status === 'revoked') return undefined;
  return toIntegration(r.rows[0]);
}

/** 회사의 우커머스 몰 전부(해제 제외). */
export async function listWooIntegrations(companyId: string): Promise<WooIntegration[]> {
  const r = await query(
    `SELECT ${ROW_COLUMNS} FROM company_integrations
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND status <> 'revoked'
     ORDER BY created_at ASC`,
    [companyId],
  );
  return r.rows.map(toIntegration);
}

/**
 * 웹훅 수신용 — 몰 식별자로 후보 행 전부(pending 포함 · 서명은 행마다 대조한다).
 * pending 을 넣는 이유: REST 키 없이 웹훅만 붙인 몰은 첫 수신(서명 통과)이 곧 연결 검증이다.
 */
export async function listWooIntegrationsByMallId(mallId: string): Promise<WooIntegration[]> {
  const r = await query(
    `SELECT ${ROW_COLUMNS} FROM company_integrations
     WHERE provider = 'woocommerce' AND mall_id = $1 AND status IN ('active', 'pending')
     ORDER BY connected_at ASC NULLS LAST, created_at ASC`,
    [mallId],
  );
  return r.rows.map(toIntegration);
}

/** 검증 성공 시에만 active + connected_at(최초 1회). 연결 검증 1콜 · 백필 성공 · 첫 웹훅(서명 통과) 세 경로가 부른다. */
export async function markWooConnected(companyId: string, mallId: string): Promise<void> {
  await query(
    `UPDATE company_integrations
     SET status = 'active', connected_at = COALESCE(connected_at, NOW()), updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
    [companyId, mallId],
  );
}

export async function disconnectWoo(companyId: string, mallId: string): Promise<boolean> {
  const r = await query(
    `UPDATE company_integrations SET status = 'revoked', updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 AND status <> 'revoked'
     RETURNING id`,
    [companyId, mallId],
  );
  return r.rows.length > 0;
}

export interface WooMallStatus {
  mallId: string;
  siteUrl: string;
  status: string;
  connected: boolean;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  webhookUrl: string;
  hasRestKeys: boolean;
  consentMetaKey: string | null;
  syncError: { message: string; code: string; at: string | null } | null;
}

export interface WooStatus {
  connected: boolean;
  malls: WooMallStatus[];
}

/** 연동센터 표시용 — 키·secret 값은 싣지 않는다. connected = 검증된 몰(active + connected_at)이 하나라도 있으면. */
export async function getWooStatus(companyId: string): Promise<WooStatus> {
  const rows = await listWooIntegrations(companyId);
  const malls: WooMallStatus[] = rows.map((i) => ({
    mallId: i.mallId,
    siteUrl: i.siteUrl,
    status: i.status,
    connected: i.status === 'active' && !!i.connectedAt,
    connectedAt: i.connectedAt ? i.connectedAt.toISOString() : null,
    lastSyncedAt: i.lastSyncedAt ? i.lastSyncedAt.toISOString() : null,
    webhookUrl: buildWooWebhookUrl(i.mallId),
    hasRestKeys: hasKeys(i),
    consentMetaKey: i.consentMetaKey,
    syncError: i.syncError,
  }));
  return { connected: malls.some((m) => m.connected), malls };
}

// ════════════════════════════════════════════════════════════════════
// HTTP — REST v3 1페이지
// ════════════════════════════════════════════════════════════════════

interface WooPage { items: any[]; totalPages: number }

async function fetchWooPage(integ: WooIntegration, resource: 'orders' | 'customers', params: UrlParams): Promise<WooPage> {
  if (!hasKeys(integ)) throw new WooApiError('no_keys');
  const url = wooRestUrl(wooRestBase(integ), resource, params);
  const res = await wooRequest('GET', url, authHeaders(integ), undefined, 0 /* 리다이렉트 따라가면 Authorization 헤더가 타 호스트로 흘러갈 수 있다 */);
  if (!Array.isArray(res.data)) throw new WooApiError('bad_response', undefined, Number(res.status));
  const totalPages = parseInt(String(res.headers?.['x-wp-totalpages'] ?? ''), 10);
  return { items: res.data, totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1 };
}

/**
 * REST 기준 주소 — 저장된 몰 주소의 호스트가 식별자(www 뗀 값)와 같을 때만 그 주소를 쓴다(SSRF: 식별자 밖 호스트로 보내지 않는다).
 * 다르면 https://{mallId}.
 */
function wooRestBase(integ: Pick<WooIntegration, 'mallId' | 'siteUrl'>): string {
  const origin = wooSiteOrigin(integ.siteUrl);
  const host = origin.replace(/^https:\/\//, '');
  return normalizeWooMallId(host) === integ.mallId ? origin : `https://${integ.mallId}`;
}

const authHeaders = (integ: WooIntegration): Record<string, string> => ({ Authorization: wooBasicAuth(integ.consumerKey, integ.consumerSecret) });

/**
 * HTTP 1회 — 네트워크 오류·HTTP 상태를 WooApiError 로 통일. Authorization 은 호출부가 headers 로 넣는다.
 * GET 은 axios.get · 그 밖(POST·PUT·DELETE)은 axios.request(JSON 본문).
 */
async function wooRequest(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: Record<string, string>, body: unknown, maxRedirects: number): Promise<any> {
  let res: any;
  try {
    const common = {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
      maxRedirects,
    };
    res = method === 'GET'
      ? await axios.get(url, common)
      : await axios.request({ ...common, method, url, data: body === undefined ? undefined : JSON.stringify(body), headers: { ...common.headers, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    throw new WooApiError('network', `${ERROR_MESSAGE.network} (${err?.code || err?.message || 'unknown'})`);
  }
  const status = Number(res.status);
  if (status === 401) throw new WooApiError('unauthorized', undefined, 401);
  if (status === 403) throw new WooApiError('forbidden', undefined, 403);
  if (status === 404) throw new WooApiError('not_found', undefined, 404);
  if (status === 429) throw new WooApiError('rate_limited', undefined, 429);
  if (status >= 300 && status < 400) throw new WooApiError('redirect', undefined, status);
  if (status >= 400) throw new WooApiError('http', `${ERROR_MESSAGE.http} (HTTP ${status})`, status);
  return res;
}

// ════════════════════════════════════════════════════════════════════
// Store API 상품(공개 · 키 불필요) — 상품 피커 · 이름 매칭 · AI 자동제작 재조회(W5)
// ════════════════════════════════════════════════════════════════════

export interface WooStoreQuery {
  q?: string;
  limit?: number;
  page?: number;
  /** 상품번호 재조회(include) */
  ids?: readonly string[];
}

/** Store API 상품 raw 배열. siteOrHost = 저장 몰 주소(있으면) 또는 몰 식별자. 공개 API 라 리다이렉트는 따라간다(비밀 없음). */
export async function fetchWooStoreProductsRaw(siteOrHost: string, opts: WooStoreQuery): Promise<any[]> {
  const perPage = Math.min(Math.max(opts.limit ?? 50, 1), STORE_PAGE_MAX);
  const url = wooStoreUrl(siteOrHost, { search: opts.q, per_page: perPage, page: opts.page, include: opts.ids });
  const res = await wooRequest('GET', url, {}, undefined, 3);
  if (!Array.isArray(res.data)) throw new WooApiError('bad_response', undefined, Number(res.status));
  return res.data;
}

/** Store API 상품 → MallProduct[] (provider = woocommerce:{mall} · 품절·구매불가 제외). */
export async function fetchWooStoreProducts(siteOrHost: string, opts: WooStoreQuery): Promise<MallProduct[]> {
  const mallId = normalizeWooMallId(siteOrHost);
  if (!mallId) throw new WooApiError('invalid_site');
  const raw = await fetchWooStoreProductsRaw(siteOrHost, opts);
  return raw.map((p) => normalizeWooStoreProduct(p, mallId)).filter((x): x is MallProduct => x !== null);
}

async function requireIntegration(companyId: string, mallId: string): Promise<WooIntegration> {
  const integ = await getWooIntegration(companyId, mallId);
  if (!integ) throw new WooApiError('no_integration');
  return integ;
}

/** 연결 확인 — 주문 1건 읽기로 키·권한·주소를 확인. 성공 시에만 active + connected_at(6원칙 ②). 실패 = WooApiError. */
export async function verifyWooConnection(companyId: string, mallId: string): Promise<void> {
  const integ = await requireIntegration(companyId, mallId);
  if (!hasKeys(integ)) throw new WooApiError('no_keys');
  await fetchWooPage(integ, 'orders', { per_page: 1 });
  await markWooConnected(companyId, mallId);
}

// ════════════════════════════════════════════════════════════════════
// 적재 — 자원 1건 → 매핑 → identify / syncOrder
// ════════════════════════════════════════════════════════════════════

export type WooProcessResult = 'synced' | 'skipped';

/**
 * 우커머스 자원 1건 적재. 웹훅 수신·백필·주기 수집·재처리 워커가 전부 이 함수 하나를 부른다.
 * - 회원: identifyCustomer(수신동의 raw 가 해석되면 smsOptIn 동봉). 식별 수단 없으면 skipped.
 * - 주문: 수신동의가 해석될 때만 identify(smsOptIn) → syncOrder(식별·매출·이벤트는 syncOrder 가 소유). 적재 불가(삭제 페이로드)면 skipped.
 */
export async function processWooResource(
  companyId: string,
  mallId: string,
  kind: WooTopicResource,
  raw: any,
  consentMetaKey: string | null | undefined,
): Promise<WooProcessResult> {
  if (kind === 'customer') {
    const m = mapWooCustomerToCdp(raw, { mallId, consentMetaKey });
    if (!m) return 'skipped';
    const consent = parseConsentValue(m.consentRaw);
    await identifyCustomer(companyId, { ...m.identify, ...(consent !== undefined ? { smsOptIn: consent } : {}) });
    return 'synced';
  }
  const m = mapWooOrderToCdp(raw, { mallId, consentMetaKey });
  if (!m) return 'skipped';
  const consent = parseConsentValue(m.consentRaw);
  if (consent !== undefined) {
    await identifyCustomer(companyId, {
      source: WOO_SOURCE,
      externalId: m.order.externalId,
      phone: m.order.phone,
      name: m.order.name,
      email: m.order.email,
      smsOptIn: consent,
    });
  }
  await syncOrder(companyId, m.order);
  return 'synced';
}

// ════════════════════════════════════════════════════════════════════
// 백필 · 주기 수집 — X-WP-TotalPages 끝까지(첫 페이지에서 멈추지 않는다)
// ════════════════════════════════════════════════════════════════════

export interface WooSyncResult { imported: number; pages: number }

async function walkPages(
  integ: WooIntegration,
  resource: 'orders' | 'customers',
  kind: WooTopicResource,
  baseParams: UrlParams,
  maxPages: number,
): Promise<WooSyncResult & { truncated: boolean }> {
  let imported = 0;
  let pages = 0;
  let totalPages = 1;
  let truncated = false;
  for (let page = 1; page <= totalPages; page++) {
    if (page > maxPages) { truncated = true; break; }
    const res = await fetchWooPage(integ, resource, { ...baseParams, page });
    pages++;
    totalPages = res.totalPages;
    for (const raw of res.items) {
      const r = await processWooResource(integ.companyId, integ.mallId, kind, raw, integ.consentMetaKey);
      if (r === 'synced') imported++;
    }
    if (res.items.length === 0) break;
  }
  return { imported, pages, truncated };
}

/** 주문 백필(연결 시 1회) — 생성일 기준 최근 days(기본 90). 성공 뒤 active 보장. dedup 은 syncOrder 멱등(order_id). */
export async function backfillWooOrders(companyId: string, mallId: string, opts?: { days?: number }): Promise<WooSyncResult> {
  const integ = await requireIntegration(companyId, mallId);
  const days = opts?.days ?? DEFAULT_BACKFILL_DAYS;
  const after = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const r = await walkPages(integ, 'orders', 'order', { per_page: PAGE_SIZE, after: wooDateParam(after), dates_are_gmt: 'true', orderby: 'date', order: 'asc' }, MAX_ORDER_PAGES);
  await markWooConnected(companyId, mallId);
  return { imported: r.imported, pages: r.pages };
}

/** 회원 백필(연결 시 1회) — 최근 가입 순 · 상한 MAX_CUSTOMER_PAGES(넘으면 truncated). 이후 회원 변경은 웹훅(customer.*)이 맡는다. */
export async function backfillWooCustomers(companyId: string, mallId: string): Promise<WooSyncResult & { truncated: boolean }> {
  const integ = await requireIntegration(companyId, mallId);
  return walkPages(integ, 'customers', 'customer', { per_page: PAGE_SIZE, orderby: 'registered_date', order: 'desc' }, MAX_CUSTOMER_PAGES);
}

// ════════════════════════════════════════════════════════════════════
// 웹훅 자동 생성·제거(REST · 1클릭 연결) — 고객사가 관리자에서 4개를 손으로 만들지 않게
// ════════════════════════════════════════════════════════════════════

export interface WooWebhookEnsureResult { created: number; existing: number; ids: number[] }

/**
 * 몰에 우리 웹훅 4개가 있게 한다(멱등): 목록에서 같은 수신 주소·주제가 있으면 두고, 없으면 만든다.
 * 필요 권한 = 쓰기(앱 인증 scope read_write). secret = 이 몰 행의 webhook_secret(수신 라우트가 대조하는 값).
 * ⛔ 웹훅 REST 본문 필드(name · topic · delivery_url · secret · status · api_version)는 문서 기준 · 실 응답 1건으로 확정(게이트 ②).
 */
export async function ensureWooWebhooks(companyId: string, mallId: string): Promise<WooWebhookEnsureResult> {
  const integ = await requireIntegration(companyId, mallId);
  if (!hasKeys(integ)) throw new WooApiError('no_keys');
  if (!integ.webhookSecret) throw new WooApiError('no_integration', '웹훅 secret 이 없습니다. 몰을 다시 저장해주세요.');
  const base = wooRestBase(integ);
  const deliveryUrl = buildWooWebhookUrl(mallId);
  const listRes = await wooRequest('GET', wooRestUrl(base, 'webhooks', { per_page: 100 }), authHeaders(integ), undefined, 0);
  const existingList: any[] = Array.isArray(listRes.data) ? listRes.data : [];
  const ids: number[] = [];
  let created = 0;
  let existing = 0;
  for (const topic of WOO_WEBHOOK_TOPICS) {
    const found = existingList.find((w) => String(w?.topic) === topic && String(w?.delivery_url) === deliveryUrl);
    if (found) {
      existing++;
      if (found.id != null) ids.push(Number(found.id));
      continue;
    }
    const res = await wooRequest('POST', wooRestUrl(base, 'webhooks', {}), authHeaders(integ), {
      name: `한줄로 · ${topic}`,
      topic,
      delivery_url: deliveryUrl,
      secret: integ.webhookSecret,
      status: 'active',
      api_version: 'wp_api_v3',
    }, 0);
    created++;
    if (res.data?.id != null) ids.push(Number(res.data.id));
  }
  await query(
    `UPDATE company_integrations SET meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
    [companyId, mallId, JSON.stringify({ woo_webhook_ids: ids })],
  );
  return { created, existing, ids };
}

/** 해제 시 우리가 만든 웹훅을 몰에서 지운다(최선 노력 · 실패는 건너뜀 · 지운 개수 반환). 키 없으면 0. */
export async function removeWooWebhooks(companyId: string, mallId: string): Promise<number> {
  const integ = await getWooIntegration(companyId, mallId);
  if (!integ || !hasKeys(integ) || integ.webhookIds.length === 0) return 0;
  const base = wooRestBase(integ);
  let removed = 0;
  for (const id of integ.webhookIds) {
    try {
      await wooRequest('DELETE', wooRestUrl(base, `webhooks/${id}`, { force: 'true' }), authHeaders(integ), undefined, 0);
      removed++;
    } catch (err: any) {
      console.log(`[WooCommerce] 웹훅 제거 건너뜀 mall=${mallId} id=${id} err=${err?.code || err?.message}`);
    }
  }
  await query(
    `UPDATE company_integrations SET meta = COALESCE(meta, '{}'::jsonb) - 'woo_webhook_ids', updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
    [companyId, mallId],
  ).catch(() => undefined);
  return removed;
}

/**
 * 주기 수집(워커) — since 이후 수정된 주문(modified_after · 상태 전환 포함). after = 생성일 바닥 90일을 함께 보내
 * 서버가 modified_after 를 모를 때도 범위가 묶이게 한다. 연결 상태는 건드리지 않는다(active 갱신은 검증·백필 몫).
 */
export async function syncWooOrdersSince(companyId: string, mallId: string, since: Date): Promise<WooSyncResult> {
  const integ = await requireIntegration(companyId, mallId);
  const floor = new Date(Date.now() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const r = await walkPages(
    integ,
    'orders',
    'order',
    // dates_are_gmt: 날짜 파라미터를 GMT 로 해석하게 한다(서버가 모르면 무시 → 몰 시간대 · 워커의 12시간 겹침이 덮는다). orderby 는 문서에 있는 date 만 쓴다.
    { per_page: PAGE_SIZE, modified_after: wooDateParam(since), after: wooDateParam(floor), dates_are_gmt: 'true', orderby: 'date', order: 'asc' },
    MAX_SYNC_PAGES,
  );
  return { imported: r.imported, pages: r.pages };
}
