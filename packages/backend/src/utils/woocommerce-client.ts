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
import * as http from 'http';
import * as https from 'https';
import { randomBytes } from 'crypto';
import { query } from '../config/database';
import { syncOrder } from './cdp-orders';
import { identifyCustomer, parseConsentValue, CdpPhoneRequiredError } from './cdp-identity';
import { WOO_SOURCE, normalizeWooMallId, wooSiteOrigin, mapWooCustomerToCdp, mapWooOrderToCdp, type WooTopicResource } from './woocommerce-core';
export { wooSiteOrigin };
import { normalizeWooStoreProduct, type MallProduct } from './mall-product-normalize';

// ════════════════════════════════════════════════════════════════════
// 상수
// ════════════════════════════════════════════════════════════════════

export const WOO_PROVIDER = WOO_SOURCE;            // company_integrations.provider = cdp_events.source = 'woocommerce'
export const DEFAULT_BACKFILL_DAYS = 90;
/**
 * 한 페이지 건수(★0921 iroirotokyo.net 실측 · 90일 주문 20,267건): per_page=100 은 13.8초·1.3MB(제한 20초에 여유 6초 →
 * 203페이지 중 한 번만 밀려도 ECONNABORTED 로 전체 중단) · per_page=20 은 2.0초·192KB 이고 건당 시간도 짧다(0.10초 대 0.14초).
 */
export const PAGE_SIZE = 20;
/**
 * 가져오기 상한은 "건수"로 둔다(페이지 크기를 바꿔도 뜻이 안 변한다). 업무 한도가 아니라 폭주 방지선이다 —
 * 쇼핑몰 회원은 5,000명을 그냥 넘는다(옛 상한 5,000명 · 40,000건은 0921 폐기). 닿으면 truncated 로 남기고 화면에 알린다.
 */
export const MAX_BACKFILL_CUSTOMERS = 500_000;
export const MAX_BACKFILL_ORDERS = 200_000;
export const MAX_SYNC_ORDERS = 5_000;        // 주기 수집 한 회차 상한 — modified_after 를 서버가 모를 때 90일치가 통째로 오는 것을 막는다
/** 조정값(테스트가 지연을 0 으로 둔다). retryDelaysMs = 같은 페이지 재시도 전 대기 · 길이 + 1 = 총 시도 수 */
export const wooTuning = { retryDelaysMs: [2000, 6000] as number[] };
export const STORE_PAGE_MAX = 100;                  // Store API per_page 상한
/** 우리가 받는 웹훅 주제 4종 — 1클릭 연결이 REST 로 자동 생성한다(화면 안내 문안과 같은 목록) */
export const WOO_WEBHOOK_TOPICS = ['order.created', 'order.updated', 'customer.created', 'customer.updated'] as const;
const HTTP_TIMEOUT_MS = 20000;
const USER_AGENT = 'Hanjullo-CDP/1.0';
/**
 * 인증 호출의 응답 헤더 수신 상한(★0921 · iroirotokyo.net 실측). Node 기본 16,384 bytes 로는 못 받는 몰이 있다:
 * 관리자 키로 인증된 REST 응답에 Query Monitor(워드프레스 디버깅 플러그인)가 PHP 오류를 건당 약 1KB 헤더로 싣는다
 * (실측 23줄 · 헤더 합계 21,494 bytes · 키 없이 재면 1KB대). 256KB = 크롬의 응답 헤더 상한과 같은 수준(문서 기준) —
 * 몰 관리자 브라우저가 같은 헤더를 받는 한도라 그 위는 몰 쪽도 깨진다. 무한으로 열지 않는다(넘으면 header_overflow 로 말한다).
 */
export const WOO_MAX_HEADER_BYTES = 256 * 1024;

export type WooApiErrorCode =
  | 'invalid_site' | 'no_integration' | 'no_keys'
  | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'redirect' | 'http' | 'bad_response' | 'header_overflow' | 'network';

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
  header_overflow: '몰 서버에는 연결됐지만 응답 헤더가 너무 커서 받을 수 없습니다. 몰에 디버깅용 플러그인(Query Monitor 등)이 켜져 있으면 끈 뒤 다시 연결해주세요.',
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
  /**
   * 분류코드(2026-09-18 · 설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-1) — 몰 1행 = 분류코드 1개.
   * 이 몰에서 들어온 회원·주문을 customer_stores 에 이 코드로 기록한다. null = 회사 공용(분류 없음 · 기존 동작).
   */
  storeCode: string | null;
  /** 앱 인증으로 받은 키 권한(read · write · read_write) · 직접 입력이면 '' */
  keyPermissions: string;
  /** 1클릭 연결이 만든 웹훅 id(해제 시 제거) */
  webhookIds: number[];
  syncError: { message: string; code: string; at: string | null } | null;
  /** 기존 회원·주문 가져오기 진행 상태(meta.woo_backfill). null = 한 번도 시작 안 함 */
  backfill: WooBackfillState | null;
}

/**
 * 가져오기 진행 상태 — company_integrations.meta.woo_backfill (★0921 · SCHEMA.md 등재).
 * 페이지가 끝날 때마다 저장한다 → 실패·서버 재시작 뒤 주기 워커가 그 자리에서 이어 간다.
 * orders_after = 시작할 때 한 번 정한 90일 바닥(시간대 표기 없는 우커머스 날짜 파라미터) — 회차마다 새로 계산하면 창이 밀려 페이지가 어긋난다.
 */
export interface WooBackfillState {
  stage: 'customers' | 'orders' | 'done';
  /** 다음에 읽을 페이지(1부터) */
  customers_page: number;
  orders_page: number;
  orders_after: string;
  /** 적재한 건수(이어 갈 때 겹쳐 읽는 한 페이지는 다시 세어진다 — 진행 표시용이지 정산값이 아니다) */
  customers_imported: number;
  orders_imported: number;
  /** 신규 고객인데 쓸 수 있는 휴대폰 번호가 없어 넣지 못한 건(설계상 제외 · 장애 아님) */
  customers_no_phone: number;
  orders_no_phone: number;
  /** 예상 못 한 사유로 그 건만 건너뛴 수(로그에 몰·종류·id·사유) */
  failed: number;
  /** 폭주 방지선(MAX_BACKFILL_*)에 닿아 멈췄는가 */
  truncated: boolean;
  started_at: string;
  updated_at: string;
  done_at: string | null;
}

function readBackfill(v: any): WooBackfillState | null {
  if (!v || typeof v !== 'object') return null;
  const stage = v.stage === 'customers' || v.stage === 'orders' || v.stage === 'done' ? v.stage : null;
  if (!stage) return null;
  const n = (x: any, d: number) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Math.floor(Number(x)) : d);
  return {
    stage,
    customers_page: Math.max(1, n(v.customers_page, 1)),
    orders_page: Math.max(1, n(v.orders_page, 1)),
    orders_after: String(v.orders_after || ''),
    customers_imported: n(v.customers_imported, 0),
    orders_imported: n(v.orders_imported, 0),
    customers_no_phone: n(v.customers_no_phone, 0),
    orders_no_phone: n(v.orders_no_phone, 0),
    failed: n(v.failed, 0),
    truncated: v.truncated === true,
    started_at: String(v.started_at || ''),
    updated_at: String(v.updated_at || ''),
    done_at: v.done_at ? String(v.done_at) : null,
  };
}

interface WooMeta {
  woo_site_url?: string;
  woo_consumer_key?: string;
  woo_consumer_secret?: string;
  woo_key_permissions?: string;
  woo_webhook_ids?: number[];
  woo_consent_meta_key?: string;
  /** 분류코드 — provider 공통 키(접두 없음). utils/integration-scope.ts resolveStoreCodeByOriginHost 가 같은 키를 읽는다 */
  store_code?: string | null;
  woo_sync_error?: string;
  woo_sync_error_code?: string;
  woo_sync_error_at?: string;
  woo_backfill?: unknown;
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
    storeCode: typeof meta.store_code === 'string' && meta.store_code.trim() ? meta.store_code.trim() : null,
    keyPermissions: meta.woo_key_permissions || '',
    webhookIds: Array.isArray(meta.woo_webhook_ids) ? meta.woo_webhook_ids.map(Number).filter((n) => Number.isFinite(n)) : [],
    syncError: meta.woo_sync_error
      ? { message: meta.woo_sync_error, code: meta.woo_sync_error_code || 'unknown', at: meta.woo_sync_error_at || null }
      : null,
    backfill: readBackfill(meta.woo_backfill),
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
  /**
   * 분류코드. ⛔ 라우트가 권한 CT(utils/integration-scope.ts pickStoreCodeForConnect)로 정한 값만 넣는다(요청 본문 값 금지).
   * undefined = meta 에 키를 싣지 않는다(기존 몰의 분류코드를 덮지 않는다) · null = 회사 공용으로 명시.
   */
  storeCode?: string | null;
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
  if (input.storeCode !== undefined) meta.store_code = input.storeCode ? String(input.storeCode).trim() || null : null;
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

/**
 * 저장된 실패 사유를 지운다 — 새 시도가 시작되면 옛 기록은 거짓이 된다(★0921: 연결이 성공한 뒤에도 옛 "수집 실패"가 화면에 남아
 * 고객사가 "동일하다"고 회신). 그 뒤 실패하면 recordWooSetupError 가 새로 남긴다.
 */
export async function clearWooSetupError(companyId: string, mallId: string): Promise<void> {
  await query(
    `UPDATE company_integrations
        SET meta = COALESCE(meta, '{}'::jsonb) - 'woo_sync_error' - 'woo_sync_error_code' - 'woo_sync_error_at',
            updated_at = NOW()
      WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
    [companyId, mallId],
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
  /** 분류코드(없으면 회사 공용) — 관리자 화면에서 어느 몰이 누구 것인지 */
  storeCode: string | null;
  syncError: { message: string; code: string; at: string | null } | null;
  /** 기존 회원·주문 가져오기 진행(없으면 null) — 수십 분~수 시간 걸리는 일이라 화면이 "도는 중"임을 말해야 한다 */
  backfill: { stage: WooBackfillState['stage']; customersImported: number; ordersImported: number; noPhone: number; failed: number; truncated: boolean; doneAt: string | null } | null;
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
    storeCode: i.storeCode,
    syncError: i.syncError,
    backfill: i.backfill
      ? {
        stage: i.backfill.stage, customersImported: i.backfill.customers_imported, ordersImported: i.backfill.orders_imported,
        noPhone: i.backfill.customers_no_phone + i.backfill.orders_no_phone, failed: i.backfill.failed,
        truncated: i.backfill.truncated, doneAt: i.backfill.done_at,
      }
      : null,
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
 * 응답 헤더 상한을 WOO_MAX_HEADER_BYTES 로 연 transport. axios 는 maxHeaderSize 를 Node 로 넘기지 않아(config 에 그 키가 없다)
 * transport 자리에서 Node 요청 옵션에 직접 싣는다. ⛔ transport 를 주면 axios 가 리다이렉트를 따라가지 않는다 →
 * 리다이렉트 0 인 호출(= 인증 호출 전부)에만 싣는다. 공개 Store API(리다이렉트 3 · 키 없음 → 디버깅 헤더도 없다)는 그대로 둔다.
 */
export const wooWideHeaderTransport = {
  request: (options: any, callback: any): http.ClientRequest =>
    (String(options?.protocol || 'https:').startsWith('https') ? https : http).request({ ...options, maxHeaderSize: WOO_MAX_HEADER_BYTES }, callback),
};

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
      ...(maxRedirects === 0 ? { transport: wooWideHeaderTransport } : {}),
    };
    res = method === 'GET'
      ? await axios.get(url, common)
      : await axios.request({ ...common, method, url, data: body === undefined ? undefined : JSON.stringify(body), headers: { ...common.headers, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    // 연결은 됐고 응답 헤더가 상한을 넘은 것 — "연결할 수 없습니다"로 말하면 고객사가 자기 서버를 의심한다(0921 실측)
    if (err?.code === 'HPE_HEADER_OVERFLOW') throw new WooApiError('header_overflow');
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

/** synced = 적재 · skipped = 매핑 불가(식별 수단·주문시각 없음 · 운영자 역할) · no_phone = 신규 고객인데 쓸 수 있는 휴대폰 번호가 없다(CDP 고객은 휴대폰이 열쇠) */
export type WooProcessResult = 'synced' | 'skipped' | 'no_phone';

/**
 * 우커머스 자원 1건 적재. 웹훅 수신·백필·주기 수집·재처리 워커가 전부 이 함수 하나를 부른다.
 * - 회원: identifyCustomer(수신동의 raw 가 해석되면 smsOptIn 동봉). 식별 수단 없으면 skipped.
 * - 주문: 수신동의가 해석될 때만 identify(smsOptIn) → syncOrder(식별·매출·이벤트는 syncOrder 가 소유). 적재 불가(삭제 페이로드)면 skipped.
 * - 신규 고객인데 휴대폰 번호가 없으면(CdpPhoneRequiredError) 던지지 않고 no_phone — 그 건을 넣을 수 없을 뿐 장애가 아니다.
 *   던지면 웹훅은 같은 건을 끝없이 재처리하고 가져오기는 그 한 건에서 전체가 멈춘다(★0921 4몰 실측). 그 밖의 오류는 그대로 던진다.
 */
export async function processWooResource(
  companyId: string,
  mallId: string,
  kind: WooTopicResource,
  raw: any,
  consentMetaKey: string | null | undefined,
  /** 이 몰 행의 분류코드(WooIntegration.storeCode). 없으면 키를 싣지 않는다 = 지금과 같은 적재 */
  storeCode?: string | null,
): Promise<WooProcessResult> {
  try {
    return await applyWooResource(companyId, mallId, kind, raw, consentMetaKey, storeCode);
  } catch (err) {
    if (err instanceof CdpPhoneRequiredError) return 'no_phone';
    throw err;
  }
}

async function applyWooResource(
  companyId: string,
  mallId: string,
  kind: WooTopicResource,
  raw: any,
  consentMetaKey: string | null | undefined,
  storeCode?: string | null,
): Promise<'synced' | 'skipped'> {
  const store = storeCode ? { storeCode } : {};
  if (kind === 'customer') {
    const m = mapWooCustomerToCdp(raw, { mallId, consentMetaKey });
    if (!m) return 'skipped';
    const consent = parseConsentValue(m.consentRaw);
    await identifyCustomer(companyId, { ...m.identify, ...(consent !== undefined ? { smsOptIn: consent } : {}), ...store });
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
      ...store,
    });
  }
  await syncOrder(companyId, { ...m.order, ...store });
  return 'synced';
}

// ════════════════════════════════════════════════════════════════════
// 백필 · 주기 수집 — X-WP-TotalPages 끝까지(첫 페이지에서 멈추지 않는다)
// ════════════════════════════════════════════════════════════════════

export interface WooSyncResult { imported: number; pages: number }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 기다리면 풀릴 수 있는 실패만 다시 시도한다 — 시간 초과·연결 끊김(network) · 429 · 몰 서버 5xx. 키·권한·주소·헤더 초과는 기다려도 안 풀린다. */
function isRetryableWooError(err: unknown): boolean {
  if (!(err instanceof WooApiError)) return false;
  return err.code === 'network' || err.code === 'rate_limited' || (err.code === 'http' && Number(err.httpStatus) >= 500);
}

/**
 * 한 페이지 읽기 + 같은 페이지 재시도(wooTuning.retryDelaysMs). 수백~천 페이지를 도는 가져오기에서 한 번의 시간 초과가
 * 전체를 죽이지 않게 한다(★0921: 203페이지 중 1회 ECONNABORTED 로 회원·주문 전량 미적재).
 */
async function fetchWooPageWithRetry(integ: WooIntegration, resource: 'orders' | 'customers', params: UrlParams): Promise<WooPage> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchWooPage(integ, resource, params);
    } catch (err) {
      if (!isRetryableWooError(err) || attempt >= wooTuning.retryDelaysMs.length) throw err;
      console.log(`[WooCommerce] ${resource} page=${params.page} 재시도 ${attempt + 1}/${wooTuning.retryDelaysMs.length} mall=${integ.mallId} code=${(err as WooApiError).code}`);
      await sleep(wooTuning.retryDelaysMs[attempt]);
    }
  }
}

/**
 * 연속 실패 상한. 데이터 문제(길이 초과·형식 이상)는 드문드문 나고, 장애(DB 끊김 등)는 연속으로 난다 →
 * 드문 실패는 그 건만 세고 넘어가되, 연속으로 이만큼 실패하면 장애로 보고 멈춘다(전부 실패한 채 "완료"가 되지 않게).
 */
export const WOO_MAX_CONSECUTIVE_FAILURES = 10;
const MAX_FAILURE_LOGS_PER_RUN = 20;

interface WooItemTally { synced: number; noPhone: number; failed: number }
/** 한 회차(가져오기 1회 · 주기 수집 1회) 동안 페이지를 넘어 이어지는 연속 실패 수·로그 수 */
interface WooRunGuard { streak: number; logged: number }

/**
 * 한 페이지의 건들을 적재한다 — 한 건의 실패가 회차 전체를 죽이지 않는다(★0921: 전화번호 없는 회원 1명에 4몰 가져오기 전부 중단).
 * no_phone 은 processWooResource 가 값으로 돌려준다. 그 밖의 예외는 그 건만 failed 로 세고 로그(몰·종류·id·사유 — 개인정보 없음)를 남긴다.
 */
async function processWooItems(integ: WooIntegration, kind: WooTopicResource, items: any[], guard: WooRunGuard): Promise<WooItemTally> {
  const t: WooItemTally = { synced: 0, noPhone: 0, failed: 0 };
  for (const raw of items) {
    try {
      const r = await processWooResource(integ.companyId, integ.mallId, kind, raw, integ.consentMetaKey, integ.storeCode);
      if (r === 'synced') t.synced++;
      else if (r === 'no_phone') t.noPhone++;
      guard.streak = 0;
    } catch (err: any) {
      t.failed++;
      guard.streak++;
      if (guard.logged < MAX_FAILURE_LOGS_PER_RUN) {
        guard.logged++;
        console.error(`[WooCommerce] 적재 실패(그 건만 건너뜀) mall=${integ.mallId} ${kind} id=${raw?.id ?? '-'} — ${err?.message || err}`);
      }
      if (guard.streak >= WOO_MAX_CONSECUTIVE_FAILURES) throw err;
    }
  }
  return t;
}

/** 주기 수집용 페이지 순회(상태 저장 없음 · 한 회차 안에서 끝난다). maxItems = 건수 상한. */
async function walkPages(
  integ: WooIntegration,
  resource: 'orders' | 'customers',
  kind: WooTopicResource,
  baseParams: UrlParams,
  maxItems: number,
): Promise<WooSyncResult & { truncated: boolean }> {
  const maxPages = Math.ceil(maxItems / PAGE_SIZE);
  let imported = 0;
  let pages = 0;
  let totalPages = 1;
  let truncated = false;
  const guard: WooRunGuard = { streak: 0, logged: 0 };
  for (let page = 1; page <= totalPages; page++) {
    if (page > maxPages) { truncated = true; break; }
    const res = await fetchWooPageWithRetry(integ, resource, { ...baseParams, page });
    pages++;
    totalPages = res.totalPages;
    imported += (await processWooItems(integ, kind, res.items, guard)).synced;
    if (res.items.length === 0) break;
  }
  return { imported, pages, truncated };
}

// ════════════════════════════════════════════════════════════════════
// 기존 회원·주문 가져오기 — 단계(회원 → 주문) · 페이지마다 진행 저장 · 실패·재시작 뒤 이어 가기 · 한 번에 한 몰 (★0921)
// ════════════════════════════════════════════════════════════════════

async function saveBackfill(companyId: string, mallId: string, st: WooBackfillState): Promise<void> {
  st.updated_at = new Date().toISOString();
  await query(
    `UPDATE company_integrations
        SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('woo_backfill', $3::jsonb),
            updated_at = NOW()
      WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 AND status <> 'revoked'`,
    [companyId, mallId, JSON.stringify(st)],
  );
}

/**
 * 한 단계를 끝까지. 페이지가 끝날 때마다 "다음 페이지"를 저장한다.
 * 몰 행은 페이지마다 다시 읽는다 — 도는 중에 해제(없음 → 중단)되거나 재승인으로 키가 바뀌어도 그 즉시 따른다.
 * 정렬은 뒤에 붙는 순서(회원 id 오름차순 · 주문 생성일 오름차순)라 도는 중에 새 건이 생겨도 앞 페이지가 밀리지 않는다.
 */
async function runBackfillStage(companyId: string, mallId: string, st: WooBackfillState, stage: 'customers' | 'orders', guard: WooRunGuard): Promise<void> {
  const isCustomers = stage === 'customers';
  const maxPages = Math.ceil((isCustomers ? MAX_BACKFILL_CUSTOMERS : MAX_BACKFILL_ORDERS) / PAGE_SIZE);
  for (;;) {
    const page = isCustomers ? st.customers_page : st.orders_page;
    if (page > maxPages) { st.truncated = true; return; }
    const integ = await requireIntegration(companyId, mallId);
    if (!hasKeys(integ)) throw new WooApiError('no_keys');
    const res = isCustomers
      // role=all: 회원 역할이 몰마다 다르다(실측 bronze_member) — 기본값(customer)으로 부르면 0명이 온다. 운영자 역할은 매핑(core)이 뺀다.
      ? await fetchWooPageWithRetry(integ, 'customers', { per_page: PAGE_SIZE, role: 'all', orderby: 'id', order: 'asc', page })
      : await fetchWooPageWithRetry(integ, 'orders', { per_page: PAGE_SIZE, after: st.orders_after, dates_are_gmt: 'true', orderby: 'date', order: 'asc', page });
    const t = await processWooItems(integ, isCustomers ? 'customer' : 'order', res.items, guard);
    st.failed += t.failed;
    if (isCustomers) { st.customers_imported += t.synced; st.customers_no_phone += t.noPhone; st.customers_page = page + 1; }
    else { st.orders_imported += t.synced; st.orders_no_phone += t.noPhone; st.orders_page = page + 1; }
    await saveBackfill(companyId, mallId, st);
    if (res.items.length === 0 || page >= res.totalPages) return;
  }
}

/**
 * 기존 회원·주문 가져오기 1회 실행(끝까지 또는 실패까지).
 * - 상태 없음 → 새로 시작(주문 기준일 = 지금 - 90일 · 저장) · 진행 중 상태 → 저장된 페이지의 한 페이지 앞에서 이어 간다(겹친 건은 적재 멱등이 흡수).
 * - 끝난 상태 → 그대로 반환. restartIfDone(재승인·수동 연결) 이면 처음부터 다시.
 * - 시작할 때 옛 실패 사유를 지우고, 실패하면 새로 남긴 뒤 던진다. 끝나면 active 보장(옛 backfillWooOrders 와 같은 계약).
 * 직접 부르지 말고 enqueueWooBackfill 로 줄 세운다(동시 실행 방지) — 이 함수는 테스트와 큐가 부른다.
 */
export async function runWooBackfill(companyId: string, mallId: string, opts?: { restartIfDone?: boolean }): Promise<WooBackfillState> {
  const integ = await requireIntegration(companyId, mallId);
  if (!hasKeys(integ)) throw new WooApiError('no_keys');
  const prev = integ.backfill;
  if (prev && prev.stage === 'done' && !opts?.restartIfDone) return prev;

  let st: WooBackfillState;
  if (prev && prev.stage !== 'done' && prev.orders_after) {
    st = { ...prev, customers_page: Math.max(1, prev.customers_page - (prev.stage === 'customers' ? 1 : 0)), orders_page: Math.max(1, prev.orders_page - (prev.stage === 'orders' ? 1 : 0)) };
  } else {
    const now = new Date();
    st = {
      stage: 'customers', customers_page: 1, orders_page: 1,
      orders_after: wooDateParam(new Date(now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000)),
      customers_imported: 0, orders_imported: 0, customers_no_phone: 0, orders_no_phone: 0, failed: 0, truncated: false,
      started_at: now.toISOString(), updated_at: now.toISOString(), done_at: null,
    };
  }

  await clearWooSetupError(companyId, mallId);
  await saveBackfill(companyId, mallId, st);
  const guard: WooRunGuard = { streak: 0, logged: 0 };
  try {
    if (st.stage === 'customers') {
      await runBackfillStage(companyId, mallId, st, 'customers', guard);
      st.stage = 'orders';
      await saveBackfill(companyId, mallId, st);
    }
    if (st.stage === 'orders') {
      await runBackfillStage(companyId, mallId, st, 'orders', guard);
      st.stage = 'done';
      st.done_at = new Date().toISOString();
      await saveBackfill(companyId, mallId, st);
      await markWooConnected(companyId, mallId);
    }
  } catch (e: any) {
    const code = e instanceof WooApiError ? e.code : 'unknown';
    await recordWooSetupError(companyId, mallId, code, String(e?.message || 'unknown')).catch(() => undefined);
    throw e;
  }
  return st;
}

// 한 번에 한 몰만 돈다(한 회사의 몰 여럿이 같은 서버에 있을 수 있다 · 우리 DB 적재도 한 줄로). 같은 몰은 도는 동안 다시 줄 세우지 않는다.
const backfillQueued = new Set<string>();
let backfillChain: Promise<void> = Promise.resolve();

/**
 * 가져오기를 줄 세운다(즉시 반환). 승인 콜백·수동 연결·주기 워커가 전부 이 함수 하나로 시작한다.
 * 반환 false = 그 몰이 이미 줄에 있거나 도는 중. 실패는 runWooBackfill 이 meta 에 남기고 여기서는 로그만 — 다음 워커 회차가 이어 간다.
 */
export function enqueueWooBackfill(companyId: string, mallId: string, opts?: { restartIfDone?: boolean }): boolean {
  const key = `${companyId}:${mallId}`;
  if (backfillQueued.has(key)) return false;
  backfillQueued.add(key);
  backfillChain = backfillChain
    .then(() => runWooBackfill(companyId, mallId, opts))
    .then(
      (st) => { console.log(`[WooCommerce backfill] 끝 mall=${mallId} stage=${st.stage} customers=${st.customers_imported} orders=${st.orders_imported} no_phone=${st.customers_no_phone + st.orders_no_phone} failed=${st.failed}${st.truncated ? ' (truncated)' : ''}`); },
      (e: any) => { console.error(`[WooCommerce backfill] 중단 mall=${mallId} code=${e instanceof WooApiError ? e.code : 'unknown'} — ${e?.message || e} (다음 워커 회차가 이어 간다)`); },
    )
    .finally(() => { backfillQueued.delete(key); });
  return true;
}

/** 줄이 빌 때까지 기다린다(테스트·종료 처리용). */
export function wooBackfillIdle(): Promise<void> {
  return backfillChain;
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
    MAX_SYNC_ORDERS,
  );
  return { imported: r.imported, pages: r.pages };
}
