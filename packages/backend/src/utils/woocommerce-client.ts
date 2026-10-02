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
import { query, pool } from '../config/database';
import { runSerial } from './inflight-lock';
import { syncOrder } from './cdp-orders';
import { identifyCustomer, parseConsentValue, isConsentAbsent, CdpPhoneRequiredError } from './cdp-identity';
import { WOO_SOURCE, normalizeWooMallId, wooSiteOrigin, wooSelfHost, mapWooCustomerToCdp, mapWooOrderToCdp, wooMemberIdFormat, wooConsentReadable, type WooTopicResource } from './woocommerce-core';
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
export const MAX_BACKFILL_CUSTOMERS = 5_000_000;   // 첫 실고객 몰의 회원이 약 50만(0921 Harold) — 방지선은 그 10배에 둔다
export const MAX_BACKFILL_ORDERS = 2_000_000;
export const MAX_SYNC_ORDERS = 5_000;        // 주기 수집 한 회차 상한 — modified_after 를 서버가 모를 때 90일치가 통째로 오는 것을 막는다
/**
 * ★ 2026-10-01 주문 해석 규칙 판 — 상태 매핑(woocommerce-core mapWooOrderStatus)이 바뀌어 **이미 읽은 주문을 다시 읽어야** 할 때 올린다.
 *   1 = ~0930(몰 고유 상태를 전부 결제 전으로 읽었다) · 2 = 1001(결제 완료 시각으로 판정).
 *   판이 낮은 끝난 가져오기는 주기 워커가 주문 단계만 한 번 다시 읽는다(startWooOrderReread) — 고객사가 다시 연결·재설치할 일이 없다.
 */
export const WOO_ORDER_RULE_VERSION = 2;
/** 주기 수집이 상한에 닿아 주문 다시 읽기로 넘길 때의 최소 간격 — 몰 서버가 modified_after 를 모르면 회차마다 닿으므로 하루 한 번으로 묶는다 */
export const WOO_REREAD_MIN_GAP_MS = 24 * 60 * 60 * 1000;
const envInt = (name: string, fallback: number, max: number): number => {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
};
/**
 * 조정값(테스트가 바꾼다). retryDelaysMs = 같은 페이지 재시도 전 대기 · 길이 + 1 = 총 시도 수.
 * *PageConcurrency = 가져오기에서 몰에 동시에 보내는 페이지 요청 수(★0921). 순차(1)로는 회원 분당 1,200명 → 회원 50만 몰이면 7시간.
 * 몰 서버 부하가 같은 배수로 는다 — 회원 조회(가벼움 · 페이지당 약 0.7초)는 4 · 주문 조회(무거움 · 페이지당 2초·192KB)는 2.
 * 몰이 버거워하면(재시도 로그가 늘면) ENV 로 낮춘다: WOO_BACKFILL_CUSTOMER_CONCURRENCY · WOO_BACKFILL_ORDER_CONCURRENCY(상한 8).
 */
export const wooTuning = {
  retryDelaysMs: [2000, 6000] as number[],
  customerPageConcurrency: envInt('WOO_BACKFILL_CUSTOMER_CONCURRENCY', 4, 8),
  orderPageConcurrency: envInt('WOO_BACKFILL_ORDER_CONCURRENCY', 2, 8),
};
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
  | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'redirect' | 'http' | 'bad_response' | 'header_overflow' | 'network'
  | 'busy';

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
  busy: '같은 쇼핑몰에 다른 연결 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.',
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
  /** ★1001 해제 뒤 웹훅 정리 미완료를 처음 남긴 시각(없으면 null) */
  webhookCleanupSince: string | null;
  /** ★1001 이 몰의 증명된 다른 주소(호스트 · www 뗀 값) — 서명 검증된 웹훅 본문에서만 채운다 */
  seenHosts: string[];
  /** ★1001 이동을 따라가 성공한 REST 기준 주소(없으면 저장된 몰 주소) */
  restOrigin: string | null;
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
  /**
   * 그 몰의 연결(사용자 승인 · 수동 연결 · 운영자가 그 몰을 지정해 돌린 스크립트)이 시작시킨 가져오기인가.
   * 주기 워커는 이 표시가 있는 미완료 건만 이어 간다 — 아무도 요청하지 않은 몰을 워커가 스스로 가져오지 않는다
   * (★0921 Harold: 연동은 사용자 계정에서 자기 몰 하나씩 · 몰 1개 연동이 다른 몰로 번지면 안 된다).
   */
  requested: boolean;
  /**
   * ★1001 이 가져오기가 주문을 읽은 해석 규칙 판(WOO_ORDER_RULE_VERSION). 값이 없는 옛 상태 = 1.
   * 판이 낮은 끝난 가져오기는 주기 워커가 주문 단계만 한 번 다시 읽는다.
   */
  order_rule: number;
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
    requested: v.requested === true,
    order_rule: Math.max(1, n(v.order_rule, 1)),
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
  /** ★1001 해제 뒤 웹훅 정리가 덜 끝났다(몰 목록을 못 읽었거나 못 지운 것이 남음) — 처음 남긴 시각(ISO). 주기 워커가 WOO_WEBHOOK_CLEANUP_DAYS 동안 이어서 정리한다 */
  woo_webhook_cleanup?: string;
  woo_consent_meta_key?: string;
  /** ★1001 서명 검증된 웹훅 본문이 말한 이 몰의 다른 주소(www 뗀 호스트 · 도메인 이전·다중 도메인) — 최대 WOO_SEEN_HOSTS_MAX */
  woo_seen_hosts?: string[];
  /** ★1001 REST 기준 주소 — 몰이 이동(3xx)시킨 곳이 증명된 주소일 때 따라가 성공한 origin. 호스트가 식별자·woo_seen_hosts 밖이면 쓰지 않는다 */
  woo_rest_origin?: string;
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
    webhookCleanupSince: typeof meta.woo_webhook_cleanup === 'string' && meta.woo_webhook_cleanup ? meta.woo_webhook_cleanup : null,
    seenHosts: Array.isArray(meta.woo_seen_hosts) ? meta.woo_seen_hosts.map((h) => String(h || '')).filter(Boolean) : [],
    restOrigin: typeof meta.woo_rest_origin === 'string' && meta.woo_rest_origin.trim() ? meta.woo_rest_origin.trim() : null,
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
  /**
   * ★1001 권한 게이트 — 저장이 쓸 행이 정해진 뒤 **같은 잠금 안에서** 불린다(existing = 그 행 · 해제됐거나 없으면 null).
   * 반환한 storeCode 를 쓴다(storeCode 인자보다 먼저). 거부는 던진다(저장은 일어나지 않는다).
   * 화면에서 오는 저장(사용자 주체가 있는 호출)은 반드시 넘긴다 — 안 넘기면 소유 검사 없이 쓴다(운영자 스크립트·테스트 전용).
   */
  decide?: (existing: WooIntegration | null) => { storeCode: string | null | undefined };
}

export interface SaveWooCredentialsResult {
  mallId: string;
  webhookUrl: string;
  /** 이 응답에서만 1회 노출 — 화면이 즉시 고객사 담당자에게 전달한다 */
  webhookSecret: string;
}

type WooDb = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

/**
 * ★ 2026-10-01 회사의 우커머스 **몰 주소 소유**를 바꾸는 쓰기(몰 저장 · 증명 주소 기록)를 한 줄로 세운다(Codex 1001 R1).
 *   불변: 한 회사 안에서 호스트 하나는 한 행에만 속한다(몰 식별자 또는 증명 주소). 판정과 쓰기가 같은 잠금 안에 있어야
 *   두 몰이 같은 호스트를 동시에 가져가거나, 권한 판정 뒤에 저장 대상이 바뀌는 일이 없다. 잠금 범위 = 회사 하나(트랜잭션 끝에 풀린다).
 */
async function withWooIdentityLock<T>(companyId: string, fn: (db: WooDb) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`woo-identity:${companyId}`]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * ★ 2026-10-01 이 주소를 저장할 몰 식별자 — 입력 주소의 호스트. 단 그 호스트가 이 회사 기존 몰의 **증명된 주소**(woo_seen_hosts)면 그 몰의 식별자.
 *   도메인을 옮긴 몰을 새 주소로 다시 저장해도 행이 둘로 갈리면 안 된다 — 주문번호 접두({mallId}:{id})가 갈려 같은 주문이 두 번 매출에 들어간다.
 *   같은 호스트를 식별자로 가진 행이 이미 있으면 그 행이 먼저다(해제된 행은 보지 않는다).
 * ⛔ 대상 행 결정 · 권한 게이트 · 쓰기는 saveWooCredentials 가 **한 잠금 안에서** 한다(Codex 1001 R1) —
 *   게이트가 먼저 "없는 몰"로 판정한 뒤 저장이 다른 담당자의 행으로 가면 소유 검사 없이 덮어쓴다.
 * @returns 주소가 올바르지 않으면 null
 */
export async function resolveWooMallIdForSave(companyId: string, siteUrl: string, db: WooDb = { query }): Promise<string | null> {
  const typed = normalizeWooMallId(siteUrl);
  if (!typed) return null;
  const r = await db.query(
    `SELECT mall_id FROM company_integrations
      WHERE company_id = $1::uuid AND provider = 'woocommerce' AND status <> 'revoked'
        AND (mall_id = $2 OR (meta->'woo_seen_hosts') ? $2)
      ORDER BY (mall_id = $2) DESC, created_at ASC LIMIT 1`,
    [companyId, typed],
  );
  return r.rows[0]?.mall_id ? String(r.rows[0].mall_id) : typed;
}

/**
 * 몰 자격 저장. 행이 없으면 pending 으로 만들고 웹훅 secret 을 발급한다.
 * 이미 있는 행은 meta 만 덧쓰고 status·secret 은 보존한다(해제(revoked)됐던 몰은 pending 으로 되살린다).
 * 저장만으로는 연결이 아니다 — verifyWooConnection 성공 또는 첫 웹훅 수신(서명 통과)이 active 로 올린다.
 */
export async function saveWooCredentials(companyId: string, input: SaveWooCredentialsInput): Promise<SaveWooCredentialsResult> {
  const typedMallId = normalizeWooMallId(input.siteUrl);
  if (!typedMallId) throw new WooApiError('invalid_site');
  // ★1001 저장(해제됐던 몰을 되살리는 자리)은 그 몰의 웹훅 줄에 선다(Codex R5) — 도는 중인 해제 뒤 웹훅 정리가 끝난 뒤에 되살린다
  //   (정리가 목록을 읽는 사이 되살아나면, 되살아난 몰의 웹훅을 그 정리가 지운다).
  //   줄의 열쇠 = 저장이 쓸 몰. 줄을 기다리는 사이 대상이 바뀌면(그 주소가 다른 몰의 증명 주소가 됨) 쓰지 않고 그 몰의 줄에 다시 선다.
  //   **대상 확인은 언제나 한다**(Codex R6) — 선 줄과 쓰는 몰이 다르면 그 몰의 정리와 겹친다. 계속 어긋나면 쓰지 않고 busy 로 끝낸다(다시 누르면 된다).
  let lineMall = (await resolveWooMallIdForSave(companyId, input.siteUrl)) || typedMallId;
  for (let attempt = 0; attempt < WOO_SAVE_LINE_ATTEMPTS; attempt++) {
    const mall = lineMall;
    const out = await runSerial(wooWebhookLine(companyId, mall), () => saveWooCredentialsInLine(companyId, input, typedMallId, mall));
    if ('saved' in out) return out.saved;
    lineMall = out.moved;
  }
  throw new WooApiError('busy');
}

/** 저장이 대상 어긋남으로 줄을 다시 서는 횟수 상한 */
const WOO_SAVE_LINE_ATTEMPTS = 3;

async function saveWooCredentialsInLine(
  companyId: string,
  input: SaveWooCredentialsInput,
  typedMallId: string,
  /** 이 줄이 맡은 몰 — 잠금 안에서 정한 대상이 이것과 다르면 쓰지 않고 그 몰을 돌려준다 */
  expectMall: string,
): Promise<{ saved: SaveWooCredentialsResult } | { moved: string }> {
  const meta: WooMeta = { woo_site_url: String(input.siteUrl || '').trim() };
  const ck = String(input.consumerKey || '').trim();
  const cs = String(input.consumerSecret || '').trim();
  const consent = String(input.consentMetaKey || '').trim();
  if (ck) meta.woo_consumer_key = ck;
  if (cs) meta.woo_consumer_secret = cs;
  if (consent) meta.woo_consent_meta_key = consent;
  const freshSecret = randomBytes(32).toString('hex');

  // 대상 행 결정 → 권한 게이트 → 쓰기를 한 잠금 안에서(그 사이 다른 몰이 이 주소를 증명 주소로 가져가지 못한다)
  const locked = await withWooIdentityLock(companyId, async (db) => {
    const mallId = (await resolveWooMallIdForSave(companyId, input.siteUrl, db)) || typedMallId;
    if (mallId !== expectMall) return { kind: 'moved' as const, mallId };
    let storeCode = input.storeCode;
    if (input.decide) {
      const cur = await db.query(
        `SELECT ${ROW_COLUMNS} FROM company_integrations
          WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 FOR UPDATE`,
        [companyId, mallId],
      );
      const row = cur.rows[0];
      storeCode = input.decide(row && row.status !== 'revoked' ? toIntegration(row) : null).storeCode;
    }
    if (storeCode !== undefined) meta.store_code = storeCode ? String(storeCode).trim() || null : null;
    const r = await db.query(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, 'woocommerce', $2, '', '',
      NULL, '', $3::jsonb, $4, NULL, 'pending', NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      -- ★1001 해제됐던 몰을 되살릴 때는 옛 증명 주소·굳힌 기준 주소를 버린다(Codex R2) — 해제된 동안 그 주소를 다른 몰이 가져갔을 수 있다.
      --   되살린 몰은 서명 검증된 웹훅으로 다시 증명받는다(한 회사 안에서 호스트 하나는 한 행에만).
      meta = (CASE WHEN company_integrations.status = 'revoked'
                   THEN company_integrations.meta - 'woo_seen_hosts' - 'woo_rest_origin' - 'woo_webhook_cleanup'
                   ELSE company_integrations.meta END) || EXCLUDED.meta,
      webhook_secret = COALESCE(company_integrations.webhook_secret, EXCLUDED.webhook_secret),
      status = CASE WHEN company_integrations.status = 'revoked' THEN 'pending' ELSE company_integrations.status END,
      updated_at = NOW()
    RETURNING webhook_secret`,
    [companyId, mallId, JSON.stringify(meta), freshSecret],
    );
    return { kind: 'saved' as const, mallId, r };
  });
  if (locked.kind === 'moved') return { moved: locked.mallId };
  const { mallId, r } = locked;
  const webhookSecret = String(r.rows[0]?.webhook_secret || freshSecret);
  await registerWooAllowedOrigins(companyId, mallId);
  if (typedMallId !== mallId) await registerWooAllowedOrigins(companyId, typedMallId);
  return { saved: { mallId, webhookUrl: buildWooWebhookUrl(mallId), webhookSecret } };
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
     WHERE provider = 'woocommerce' AND (mall_id = $1 OR (meta->'woo_seen_hosts') ? $1) AND status IN ('active', 'pending')
     ORDER BY (mall_id = $1) DESC, connected_at ASC NULLS LAST, created_at ASC`,
    [mallId],
  );
  return r.rows.map(toIntegration);
}

/**
 * 검증 성공 시에만 active + connected_at(최초 1회). 연결 검증 1콜 · 백필 성공 · 첫 웹훅(서명 통과) 세 경로가 부른다.
 * ★1001 해제된 행은 되돌리지 않는다 — 도는 중이던 가져오기·수신이 해제 뒤에 끝나며 연결로 되살리면 해제가 무효가 되고,
 *   옛 증명 주소까지 되살아난다. 해제된 몰을 되살리는 자리는 저장(saveWooCredentials) 하나다.
 */
export async function markWooConnected(companyId: string, mallId: string): Promise<void> {
  await query(
    `UPDATE company_integrations
     SET status = 'active', connected_at = COALESCE(connected_at, NOW()), updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 AND status <> 'revoked'`,
    [companyId, mallId],
  );
}

/**
 * 행을 끊는다. ★1001 **같은 문장에서** 웹훅 정리 미완료(meta.woo_webhook_cleanup)를 적는다(Codex R5) —
 *   정리가 끝나기 전에 프로세스가 죽거나 정리 결과 저장이 실패해도, 표시가 남아 주기 워커가 이어서 정리한다.
 *   표시는 정리가 끝난 것이 확인될 때만 비운다(removeWooWebhooksInLine).
 * ⛔ **요청 시점에 즉시** 부른다(웹훅 줄에 세우지 않는다 — Codex R6): 줄에서 기다렸다 끊으면 그 사이 다른 담당자가 되살린 연결을 끊는다.
 *   줄에 서는 것은 뒤따르는 웹훅 제거(removeWooWebhooks)뿐이고, 제거는 줄 안에서 행을 새로 읽어 해제된 행이 아니면 아무것도 하지 않는다.
 * @param allow 권한 게이트(Codex R7) — **행을 잠근 같은 잠금 안에서** 지금의 행으로 불린다. 거부는 던진다(끊지 않는다).
 *   라우트가 먼저 행을 읽어 판정하면, 판정과 끊기 사이에 다른 담당자가 되살린 연결을 판정 없이 끊는다. 화면에서 오는 해제는 반드시 넘긴다.
 * @returns 끊었으면 true · 행이 없거나 이미 끊겨 있으면 false(게이트를 부르지 않는다)
 */
export async function disconnectWoo(companyId: string, mallId: string, allow?: (existing: WooIntegration) => void): Promise<boolean> {
  return withWooIdentityLock(companyId, async (db) => {
    const cur = await db.query(
      `SELECT ${ROW_COLUMNS} FROM company_integrations
        WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 FOR UPDATE`,
      [companyId, mallId],
    );
    const row = cur.rows[0];
    if (!row || row.status === 'revoked') return false;
    if (allow) allow(toIntegration(row));
    const r = await db.query(
      `UPDATE company_integrations SET status = 'revoked', meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
       WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 AND status <> 'revoked'
       RETURNING id`,
      [companyId, mallId, JSON.stringify({ woo_webhook_cleanup: new Date().toISOString() })],
    );
    return r.rows.length > 0;
  });
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
  const res = await wooAuthedRequest(integ, 'GET', (base) => wooRestUrl(base, resource, params));
  if (!Array.isArray(res.data)) throw new WooApiError('bad_response', undefined, Number(res.status));
  const totalPages = parseInt(String(res.headers?.['x-wp-totalpages'] ?? ''), 10);
  return { items: res.data, totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1 };
}

/** 이 몰의 주소로 인정하는 호스트인가 — 몰 식별자 자신 또는 서명 검증된 웹훅이 증명한 주소(woo_seen_hosts). 그 밖으로는 인증 헤더를 보내지 않는다. */
function wooHostAllowed(integ: Pick<WooIntegration, 'mallId'> & { seenHosts?: string[] }, originOrHost: string): boolean {
  const host = normalizeWooMallId(originOrHost);
  return !!host && (host === integ.mallId || (integ.seenHosts || []).includes(host));
}

/**
 * REST 기준 주소 — 인정하는 호스트(wooHostAllowed)일 때만 그 주소를 쓴다(SSRF: 그 밖 호스트로 보내지 않는다).
 * 순서 = 이동을 따라가 성공한 주소(woo_rest_origin) → 저장된 몰 주소 → https://{mallId}.
 */
function wooRestBase(integ: Pick<WooIntegration, 'mallId' | 'siteUrl'> & { seenHosts?: string[]; restOrigin?: string | null }): string {
  if (integ.restOrigin && wooHostAllowed(integ, integ.restOrigin)) return wooSiteOrigin(integ.restOrigin);
  const origin = wooSiteOrigin(integ.siteUrl);
  return wooHostAllowed(integ, origin) ? origin : `https://${integ.mallId}`;
}

/**
 * ★ 2026-10-01 몰이 다른 주소로 이동(3xx)시킬 때 따라가도 되는 origin — https · 지금 주소와 다른 origin · 인정하는 호스트일 때만. 아니면 null.
 *   (운영 실측: 두 몰이 도메인을 옮긴 뒤 주기 수집이 9일간 redirect 로 실패했다. 무작정 따라가면 옛 도메인이 남의 손에 넘어갔을 때
 *    REST 키가 그쪽으로 간다 → 서명 검증된 웹훅 본문이 증명한 주소 또는 www 만 다른 같은 몰 주소로만 따라간다.)
 */
export function wooRedirectOrigin(integ: Pick<WooIntegration, 'mallId'> & { seenHosts?: string[] }, base: string, location: unknown): string | null {
  if (typeof location !== 'string' || !location.trim()) return null;
  let u: URL;
  try { u = new URL(location.trim(), base); } catch { return null; }
  if (u.protocol !== 'https:' || u.origin === base) return null;
  return wooHostAllowed(integ, u.origin) ? u.origin : null;
}

/** 이동을 따라가 성공한 주소를 그 몰의 REST 기준 주소로 굳힌다 + 새 주소를 수집 허용 도메인에 넣는다. 실패해도 이번 응답은 돌려준다. */
async function adoptWooRestOrigin(integ: WooIntegration, origin: string): Promise<void> {
  const from = wooRestBase(integ);
  integ.restOrigin = origin; // 같은 실행의 다음 쪽부터는 곧장 새 주소로
  try {
    await query(
      `UPDATE company_integrations SET meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
       WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
      [integ.companyId, integ.mallId, JSON.stringify({ woo_rest_origin: origin })],
    );
    const host = normalizeWooMallId(origin);
    if (host && host !== integ.mallId) await registerWooAllowedOrigins(integ.companyId, host);
    console.log(`[WooCommerce] 몰 주소 이동을 따라갑니다 company=${integ.companyId} mall=${integ.mallId} ${from} → ${origin}`);
  } catch (err: any) {
    console.warn(`[WooCommerce] 이동 주소 저장 실패(이번 호출은 계속) mall=${integ.mallId} err=${err?.message || err}`);
  }
}

/**
 * 인증 호출 공용 — 리다이렉트는 자동으로 따라가지 않는다(Authorization 이 타 호스트로 흐르지 않게).
 * 3xx 면 이동 대상이 **이 몰의 인정된 주소**일 때만 한 번 다시 부르고, 성공하면 그 주소를 기준 주소로 굳힌다.
 * 인정된 주소가 아니면 저장된 서명 검증 웹훅 기록에서 한 번 배워 본다(learnWooHostFromSignedDeliveries) — 거기에도 없으면 redirect 로 끝난다.
 */
async function wooAuthedRequest(integ: WooIntegration, method: 'GET' | 'POST' | 'PUT' | 'DELETE', urlOf: (base: string) => string, body?: unknown): Promise<any> {
  const base = wooRestBase(integ);
  const first = await wooHttp(method, urlOf(base), authHeaders(integ), body, 0);
  const status = Number(first.status);
  if (!(status >= 300 && status < 400)) return wooEnsureOk(first);
  let target = wooRedirectOrigin(integ, base, first.headers?.location);
  // 이동 대상이 아직 증명 안 된 호스트면, 그 호스트가 이 몰의 **저장된 서명 검증 웹훅 기록**에 있는지 본다(있으면 증명 주소로 적고 다시 판정).
  if (!target && (await learnWooHostFromSignedDeliveries(integ, base, first.headers?.location))) {
    target = wooRedirectOrigin(integ, base, first.headers?.location);
  }
  if (!target) throw new WooApiError('redirect', undefined, status);
  const second = wooEnsureOk(await wooHttp(method, urlOf(target), authHeaders(integ), body, 0));
  await adoptWooRestOrigin(integ, target);
  return second;
}

/** 저장된 웹훅 기록에서 증명 주소를 배울 때 보는 기간(일) — 그 안에 서명 검증을 통과한 기록만 근거로 삼는다 */
export const WOO_LEARN_LOOKBACK_DAYS = 7;
/** 기록에 없던 호스트를 다시 찾아보기까지의 간격(프로세스 메모리) — 페이지마다·회차마다 같은 조회를 되풀이하지 않는다 */
const WOO_LEARN_RETRY_MS = 10 * 60 * 1000;
const learnMissUntil = new Map<string, number>();

/**
 * ★ 2026-10-01 이동(3xx) 대상 호스트가 **이미 저장된 서명 검증 웹훅 기록**에 이 몰의 본문 주소로 있으면, 그 기록으로 증명 주소를 적는다.
 *   왜(배포 뒤 실측): 증명 주소를 "다음에 들어오는 웹훅"에서만 배우게 했더니, 배포 뒤 웹훅이 들어오지 않은 두 몰이 이동을 못 따라가 멈춰 있었다.
 *     웹훅이 몰 쪽에서 꺼졌다면 영영 못 배운다(수집이 안 되니 웹훅 점검도 못 돈다) — 증명은 이미 원장에 있는데 받는 순간에만 배운 것이 빈틈이다.
 *   근거: cdp_webhook_deliveries 에 source = 'woocommerce' 로 쓰는 자리는 둘뿐이다 — 웹훅 수신 라우트(서명이 맞은 행의 회사로 · 서명 뒤)와
 *     연결 승인용 임시 행(webhook_event = 'oauth_state' · 여기서 뺀다). 그래서 (회사 · 몰)의 저장 기록 본문 주소 = 그 몰 secret 으로 서명된 주소다.
 *   ⛔ 이동 대상 **그 호스트만** 찾는다(기록에 있는 다른 주소를 미리 적지 않는다). 적는 일은 noteWooSeenHost 가 한다(한 회사 안 유일성 · 상한 · 회사 잠금 그대로).
 * @returns 이번에 증명 주소로 적었으면 true
 */
async function learnWooHostFromSignedDeliveries(integ: WooIntegration, base: string, location: unknown): Promise<boolean> {
  if (typeof location !== 'string' || !location.trim()) return false;
  let u: URL;
  try { u = new URL(location.trim(), base); } catch { return false; }
  if (u.protocol !== 'https:' || u.origin === base) return false;   // 따라갈 수 없는 이동은 배울 것도 없다(wooRedirectOrigin 과 같은 조건)
  const host = normalizeWooMallId(u.origin);
  if (!host || host === integ.mallId || integ.seenHosts.includes(host)) return false;
  const key = `${integ.companyId}:${integ.mallId}:${host}`;
  if ((learnMissUntil.get(key) || 0) > Date.now()) return false;
  const r = await query(
    `SELECT d.payload->'resource'->'_links'->'self'->0->>'href' AS href
       FROM cdp_webhook_deliveries d
      WHERE d.company_id = $1::uuid AND d.source = 'woocommerce' AND d.webhook_event <> 'oauth_state'
        AND d.payload->>'mall_id' = $2
        AND d.created_at >= NOW() - ($5 || ' days')::interval
        AND (d.payload->'resource'->'_links'->'self'->0->>'href' LIKE $3
          OR d.payload->'resource'->'_links'->'self'->0->>'href' LIKE $4)
      LIMIT 1`,
    [integ.companyId, integ.mallId, `https://${host}/%`, `https://www.${host}/%`, String(WOO_LEARN_LOOKBACK_DAYS)],
  );
  // 읽어 온 주소의 호스트가 이동 대상과 같을 때만 적는다(https 만 · 조회 조건과 같은 판정을 코드에서 한 번 더)
  const proof = { _links: { self: [{ href: r.rows[0]?.href }] } };
  const learned = wooSelfHost(proof) === host ? await noteWooSeenHost(integ, proof) : false;
  if (!learned) learnMissUntil.set(key, Date.now() + WOO_LEARN_RETRY_MS);
  return learned;
}

export const WOO_SEEN_HOSTS_MAX = 8;
/** 적지 못한 호스트를 다시 물어보기까지의 간격(프로세스 메모리) */
const WOO_SEEN_HOST_RETRY_MS = 30 * 60 * 1000;
const seenHostRefusedUntil = new Map<string, number>();
/** 테스트 전용 — 거부 기억 비우기 */
export function resetWooSeenHostRefusals(): void { seenHostRefusedUntil.clear(); learnMissUntil.clear(); }

/**
 * ★ 2026-10-01 서명이 검증된 웹훅 본문이 말하는 몰 주소를 그 몰의 증명된 주소로 적는다(새 호스트일 때만 쓰기 · 최대 WOO_SEEN_HOSTS_MAX).
 *   한 회사 안에서 호스트 하나는 한 행에만 속한다 — 다른 몰의 식별자·증명 주소와 겹치면 적지 않는다(Codex 1001 R1).
 *   ⛔ 서명 검증 **뒤에만** 부른다(routes/woocommerce.ts 수신 라우트) — 검증 안 된 본문으로 적으면 아무나 남의 몰에 주소를 꽂는다.
 *   새 주소는 수집 허용 도메인에도 넣는다(브라우저 SDK 수집 · 분류코드 판정 resolveStoreCodeByOriginHost 가 같은 목록을 본다).
 * @returns 새로 적었으면 true
 */
export async function noteWooSeenHost(integ: WooIntegration, resource: any): Promise<boolean> {
  const host = wooSelfHost(resource);
  if (!host || host === integ.mallId || integ.seenHosts.includes(host)) return false;
  const refusedKey = `${integ.companyId}:${integ.mallId}:${host}`;
  if ((seenHostRefusedUntil.get(refusedKey) || 0) > Date.now()) return false;
  // 같은 회사의 다른 몰이 이미 가진 호스트(몰 식별자 또는 증명 주소)는 적지 않는다 — 자기 몰 서명으로 남의 몰 주소를 가져가면
  //   SDK 분류코드 판정·새 주소 저장이 엉뚱한 몰로 간다. 덧붙이기·중복·상한·충돌 검사를 한 문장에서(잠금 안).
  const hosts = await withWooIdentityLock(integ.companyId, async (db) => {
    const r = await db.query(
      `UPDATE company_integrations t
          SET meta = COALESCE(t.meta, '{}'::jsonb)
                     || jsonb_build_object('woo_seen_hosts', COALESCE(t.meta->'woo_seen_hosts', '[]'::jsonb) || to_jsonb($3::text)),
              updated_at = NOW()
        WHERE t.company_id = $1::uuid AND t.provider = 'woocommerce' AND t.mall_id = $2 AND t.status <> 'revoked'
          AND NOT (COALESCE(t.meta->'woo_seen_hosts', '[]'::jsonb) ? $3)
          AND jsonb_array_length(COALESCE(t.meta->'woo_seen_hosts', '[]'::jsonb)) < $4
          AND NOT EXISTS (
            SELECT 1 FROM company_integrations o
             WHERE o.company_id = t.company_id AND o.provider = 'woocommerce' AND o.id <> t.id AND o.status <> 'revoked'
               AND (o.mall_id = $3 OR (o.meta->'woo_seen_hosts') ? $3))
      RETURNING t.meta->'woo_seen_hosts' AS hosts`,
      [integ.companyId, integ.mallId, host, WOO_SEEN_HOSTS_MAX],
    );
    return r.rows[0]?.hosts;
  });
  if (!Array.isArray(hosts)) {
    // 못 적은 사유(다른 몰 소유 · 상한 · 이미 있음)는 웹훅마다 다시 물을 일이 아니다 — 한동안 건너뛴다
    seenHostRefusedUntil.set(refusedKey, Date.now() + WOO_SEEN_HOST_RETRY_MS);
    console.log(`[WooCommerce] 몰 주소를 적지 않았습니다(같은 회사의 다른 몰이 가진 주소이거나 상한 ${WOO_SEEN_HOSTS_MAX}개) company=${integ.companyId} mall=${integ.mallId} host=${host}`);
    return false;
  }
  integ.seenHosts = hosts.map((h: any) => String(h || '')).filter(Boolean);
  await registerWooAllowedOrigins(integ.companyId, host);
  console.log(`[WooCommerce] 몰의 다른 주소를 확인했습니다(서명 검증된 웹훅) company=${integ.companyId} mall=${integ.mallId} host=${host}`);
  return true;
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
  return wooEnsureOk(await wooHttp(method, url, headers, body, maxRedirects));
}

/** 응답을 그대로 돌려준다(3xx 포함) — 네트워크 오류만 WooApiError 로 바꾼다. 이동 판정은 호출부(wooAuthedRequest)가 한다. */
async function wooHttp(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: Record<string, string>, body: unknown, maxRedirects: number): Promise<any> {
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
  return res;
}

/** HTTP 상태 → WooApiError 통일(2xx 만 통과) */
function wooEnsureOk(res: any): any {
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

/**
 * Store API 상품 → MallProduct[] (provider = woocommerce:{mall} · 품절·구매불가 제외).
 * @param mallIdOf 연동 행의 몰 식별자(★1001) — 넘기면 결과의 몰 표기는 이 값이다. 도메인을 옮겨 새 주소로 다시 저장한 몰은
 *   저장 주소의 호스트가 몰 식별자와 다르다(식별자는 처음 것 그대로). 안 넘기면 주소의 호스트(종전).
 */
export async function fetchWooStoreProducts(siteOrHost: string, opts: WooStoreQuery, mallIdOf?: string): Promise<MallProduct[]> {
  const mallId = normalizeWooMallId(mallIdOf || siteOrHost);
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
    // ★1002 회원 정보에 동의 값이 아예 없으면 그 사실과 읽은 동의 키 이름 · 이 몰의 회원 식별자 모양을 싣는다 — 「회원 정보에 값이 없으면 동의」 규칙을 켠 몰만
    //   CT 가 그 몰 소속 행의 모름을 채운다(해석 못 한 값은 싣지 않는다 = 모름). ⛔ 아래 주문 경로에는 싣지 않는다(CT mall-consent 머리 주석).
    //   「없다」 = 동의 키가 설정돼 있고 메타 목록을 실제로 받았는데 그 키가 없거나 값이 빈 것. 키 미설정 · 메타 목록이 안 실린 본문은 읽지 못한 것이다.
    const absent = consent === undefined && wooConsentReadable(raw?.meta_data, consentMetaKey) && isConsentAbsent(m.consentRaw);
    await identifyCustomer(companyId, {
      ...m.identify,
      ...(consent !== undefined ? { smsOptIn: consent } : {}),
      ...(absent ? { profileConsentAbsent: { consentKey: String(consentMetaKey || '').trim(), ...wooMemberIdFormat(mallId) } } : {}),
      ...store,
    });
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

export interface WooSyncResult { imported: number; pages: number; /** 한 회차 상한(MAX_SYNC_ORDERS)에 닿아 남은 주문을 못 읽었다 */ truncated?: boolean }

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
    const put = () => processWooResource(integ.companyId, integ.mallId, kind, raw, integ.consentMetaKey, integ.storeCode);
    try {
      // UNIQUE 위반(23505) = 동시에 도는 다른 페이지가 같은 휴대폰·이메일의 고객을 방금 만들었다 → 한 번 더 넣으면 그 고객에 합쳐진다
      const r = await put().catch((e: any) => { if (e?.code === '23505') return put(); throw e; });
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
 *
 * 동시 처리(★0921 운영 실측: 순차로는 회원 분당 1,200명 → 회원 50만 몰이면 7시간 · 병목 = 몰 응답 페이지당 0.7~2초):
 *   첫 페이지는 혼자 받아 전체 쪽수를 확정하고, 나머지는 wooTuning.*PageConcurrency 개가 페이지를 나눠 받는다.
 *   저장하는 "다음 페이지"는 끝난 페이지가 **이어진 데까지**(watermark) — 뒤 페이지가 먼저 끝나도 앞의 실패한 페이지를 건너뛰지 않는다.
 *   저장은 한 줄로 세운다(늦게 도착한 옛 값이 새 값을 덮지 않게). 한 페이지가 끝내 실패하면 새 페이지를 더 집지 않고 첫 오류를 던진다.
 */
async function runBackfillStage(companyId: string, mallId: string, st: WooBackfillState, stage: 'customers' | 'orders', guard: WooRunGuard): Promise<void> {
  const isCustomers = stage === 'customers';
  const maxPages = Math.ceil((isCustomers ? MAX_BACKFILL_CUSTOMERS : MAX_BACKFILL_ORDERS) / PAGE_SIZE);
  const concurrency = Math.max(1, Math.floor(isCustomers ? wooTuning.customerPageConcurrency : wooTuning.orderPageConcurrency) || 1);
  const startPage = isCustomers ? st.customers_page : st.orders_page;

  let totalPages = Number.POSITIVE_INFINITY;   // 첫 응답에서 확정 · 도는 중 늘면 따라 늘린다
  let emptyAt = Number.POSITIVE_INFINITY;      // 빈 페이지가 나온 가장 앞 자리(그 뒤는 없다)
  const lastPage = () => Math.min(totalPages, emptyAt - 1);
  let nextPage = startPage;
  let watermark = startPage;                   // 이 앞 페이지는 전부 끝났다
  const finished = new Set<number>();
  let firstError: unknown = null;
  let saving: Promise<void> = Promise.resolve();

  const doPage = async (page: number): Promise<void> => {
    const integ = await requireIntegration(companyId, mallId);
    if (!hasKeys(integ)) throw new WooApiError('no_keys');
    const res = isCustomers
      // role=all: 회원 역할이 몰마다 다르다(실측 bronze_member) — 기본값(customer)으로 부르면 0명이 온다. 운영자 역할은 매핑(core)이 뺀다.
      ? await fetchWooPageWithRetry(integ, 'customers', { per_page: PAGE_SIZE, role: 'all', orderby: 'id', order: 'asc', page })
      : await fetchWooPageWithRetry(integ, 'orders', { per_page: PAGE_SIZE, after: st.orders_after, dates_are_gmt: 'true', orderby: 'date', order: 'asc', page });
    if (res.items.length === 0) emptyAt = Math.min(emptyAt, page);
    totalPages = Number.isFinite(totalPages) ? Math.max(totalPages, res.totalPages) : res.totalPages;
    const t = await processWooItems(integ, isCustomers ? 'customer' : 'order', res.items, guard);
    st.failed += t.failed;
    if (isCustomers) { st.customers_imported += t.synced; st.customers_no_phone += t.noPhone; }
    else { st.orders_imported += t.synced; st.orders_no_phone += t.noPhone; }
    finished.add(page);
    while (finished.has(watermark)) { finished.delete(watermark); watermark++; }
    if (isCustomers) st.customers_page = watermark; else st.orders_page = watermark;
    saving = saving.then(() => saveBackfill(companyId, mallId, st));
    await saving;
  };

  if (startPage > maxPages) { st.truncated = true; return; }
  await doPage(nextPage++);

  const worker = async (): Promise<void> => {
    while (!firstError) {
      const page = nextPage;
      if (page > lastPage()) return;
      if (page > maxPages) { st.truncated = true; return; }
      nextPage++;
      try { await doPage(page); } catch (e) { if (!firstError) firstError = e; return; }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await saving.catch(() => undefined);
  if (firstError) throw firstError;
}

/**
 * 기존 회원·주문 가져오기 1회 실행(끝까지 또는 실패까지).
 * - 상태 없음 → 새로 시작(주문 기준일 = 지금 - 90일 · 저장) · 진행 중 상태 → 저장된 페이지의 한 페이지 앞에서 이어 간다(겹친 건은 적재 멱등이 흡수).
 * - 끝난 상태 → 그대로 반환. restartIfDone(재승인·수동 연결) 이면 처음부터 다시.
 * - 시작할 때 옛 실패 사유를 지우고, 실패하면 새로 남긴 뒤 던진다. 끝나면 active 보장(옛 backfillWooOrders 와 같은 계약).
 * 직접 부르지 말고 enqueueWooBackfill 로 줄 세운다(동시 실행 방지) — 이 함수는 테스트와 큐가 부른다.
 */
export async function runWooBackfill(companyId: string, mallId: string, opts?: { restartIfDone?: boolean; requested?: boolean }): Promise<WooBackfillState> {
  const integ = await requireIntegration(companyId, mallId);
  if (!hasKeys(integ)) throw new WooApiError('no_keys');
  const prev = integ.backfill;
  if (prev && prev.stage === 'done' && !opts?.restartIfDone) return prev;

  let st: WooBackfillState;
  if (prev && prev.stage !== 'done' && prev.orders_after) {
    st = {
      ...prev,
      customers_page: Math.max(1, prev.customers_page - (prev.stage === 'customers' ? 1 : 0)),
      orders_page: Math.max(1, prev.orders_page - (prev.stage === 'orders' ? 1 : 0)),
      // 주문 단계를 아직 시작 안 했으면 주문은 전부 지금 규칙으로 읽힌다. 주문 단계 도중이면 앞쪽은 옛 규칙으로 읽은 것이라 판을 올리지 않는다(끝난 뒤 다시 읽는다).
      order_rule: prev.stage === 'customers' ? WOO_ORDER_RULE_VERSION : prev.order_rule,
    };
  } else {
    const now = new Date();
    st = {
      stage: 'customers', customers_page: 1, orders_page: 1,
      orders_after: wooDateParam(new Date(now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000)),
      customers_imported: 0, orders_imported: 0, customers_no_phone: 0, orders_no_phone: 0, failed: 0, truncated: false, requested: false,
      order_rule: WOO_ORDER_RULE_VERSION,
      started_at: now.toISOString(), updated_at: now.toISOString(), done_at: null,
    };
  }

  if (opts?.requested) st.requested = true;
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
export function enqueueWooBackfill(companyId: string, mallId: string, opts?: { restartIfDone?: boolean; requested?: boolean }): boolean {
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

export type WooRereadReason = 'rule' | 'truncated';

/**
 * 끝난 가져오기의 주문을 다시 읽어야 하는가(순수).
 * - 한 번도 안 가져온 몰 · 도는 중인 몰은 건드리지 않는다(★0921 워커가 스스로 새 몰을 가져오지 않는다 — 다시 읽기는 **그 몰이 이미 끝낸 가져오기**에만 붙는다).
 * - rule = 그 가져오기가 읽은 규칙 판이 지금보다 낮다 · truncated = 주기 수집이 상한에 닿았다(하루 한 번까지).
 */
export function wooOrderRereadDue(bf: Pick<WooBackfillState, 'stage' | 'order_rule' | 'started_at'> | null | undefined, reason: WooRereadReason, nowMs: number): boolean {
  if (!bf || bf.stage !== 'done') return false;
  if (reason === 'rule') return bf.order_rule < WOO_ORDER_RULE_VERSION;
  const started = Date.parse(bf.started_at);
  return !Number.isFinite(started) || nowMs - started >= WOO_REREAD_MIN_GAP_MS;
}

/**
 * ★ 2026-10-01 이미 가져온 몰의 **주문 단계만** 처음부터 다시 줄 세운다(회원 단계는 건너뛴다 · 회원 집계는 그대로).
 *   왜: 상태 규칙이 바뀌기 전에 읽은 주문(몰 고유 상태 = 결제 전으로 적재)은 몰에서 다시 수정되지 않는 한 주기 수집에 안 잡힌다.
 *       다시 읽으면 적재 관문(syncOrder)이 같은 주문번호의 기존 이벤트에 매출을 1회만 반영한다(표식 멱등 · 새 이벤트를 만들지 않는다).
 *   판(order_rule)은 **줄 세울 때** 올린다 — 도중에 실패해도 주기 워커가 requested 미완료 건으로 이어 간다(같은 다시 읽기를 두 번 시작하지 않는다).
 * @returns 줄 세웠으면 true
 */
export async function startWooOrderReread(companyId: string, mallId: string, reason: WooRereadReason): Promise<boolean> {
  const integ = await getWooIntegration(companyId, mallId);
  if (!integ || !hasKeys(integ)) return false;
  const now = new Date();
  const prev = integ.backfill;
  if (!prev || !wooOrderRereadDue(prev, reason, now.getTime())) return false;
  const st: WooBackfillState = {
    ...prev,
    stage: 'orders',
    orders_page: 1,
    orders_after: wooDateParam(new Date(now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000)),
    orders_imported: 0,
    orders_no_phone: 0,
    truncated: false,
    requested: true,
    order_rule: WOO_ORDER_RULE_VERSION,
    started_at: now.toISOString(),
    done_at: null,
  };
  await saveBackfill(companyId, mallId, st);
  console.log(`[WooCommerce backfill] 주문 다시 읽기 시작 company=${companyId} mall=${mallId} 사유=${reason === 'rule' ? '상태 규칙 변경' : '주기 수집 상한 닿음'} · 최근 ${DEFAULT_BACKFILL_DAYS}일`);
  enqueueWooBackfill(companyId, mallId);
  return true;
}

/** 줄이 빌 때까지 기다린다(테스트·종료 처리용). */
export function wooBackfillIdle(): Promise<void> {
  return backfillChain;
}

// ════════════════════════════════════════════════════════════════════
// 웹훅 자동 생성·제거(REST · 1클릭 연결) — 고객사가 관리자에서 4개를 손으로 만들지 않게
// ════════════════════════════════════════════════════════════════════

export interface WooWebhookEnsureResult { created: number; existing: number; reactivated: number; ids: number[] }

/** 웹훅 목록 한 쪽 크기 · 읽는 쪽수 상한(= 1,000개까지 확인) */
const WOO_WEBHOOK_LIST_PAGE = 100;
const WOO_WEBHOOK_LIST_MAX_PAGES = 10;

/**
 * 몰에 우리 웹훅 4개가 있게 한다(멱등): 목록에서 같은 수신 주소·주제가 있으면 두고, 없으면 만든다.
 * ★1001 우커머스는 전달이 연속 실패하면 웹훅을 `disabled` 로 꺼 둔다 — 꺼진 우리 웹훅은 다시 켠다(주기 워커가 회차마다 부른다).
 *   운영 실측: 일본이모 주문 수정 웹훅 7일 0건(다른 3몰은 수백~수천). `paused`(관리자가 손으로 멈춤)는 건드리지 않는다.
 * 필요 권한 = 쓰기(앱 인증 scope read_write). secret = 이 몰 행의 webhook_secret(수신 라우트가 대조하는 값).
 * ⛔ 웹훅 REST 본문 필드(name · topic · delivery_url · secret · status · api_version)는 문서 기준 · 실 응답 1건으로 확정(게이트 ②).
 * ★1001 같은 몰의 웹훅을 다루는 실행(주기 워커 점검 · 앱 인증 뒤 점검 · 해제의 제거)은 **몰 단위로 한 줄**이다(wooWebhookLine).
 *   줄 안에서 행을 새로 읽으므로 해제된 몰이면 아무것도 만들지 않는다. 교차가 없어 보상 삭제 같은 장치를 두지 않는다(Codex R1~R3 경위 = 설계서 §8-4-1).
 */
export function ensureWooWebhooks(companyId: string, mallId: string): Promise<WooWebhookEnsureResult> {
  return runSerial(wooWebhookLine(companyId, mallId), () => ensureWooWebhooksInLine(companyId, mallId));
}

/**
 * 몰의 웹훅 목록을 끝 쪽까지 읽는다. complete = false 면 쪽수 상한에 걸려 끝을 확인 못 한 것이다.
 * 배열이 아닌 응답(보안 플러그인의 안내 화면 · 오류 객체)은 "없음"이 아니라 "모름"이다 → bad_response.
 */
async function listWooWebhooks(integ: WooIntegration): Promise<{ items: any[]; complete: boolean }> {
  const items: any[] = [];
  for (let page = 1; page <= WOO_WEBHOOK_LIST_MAX_PAGES; page++) {
    const res = await wooAuthedRequest(integ, 'GET', (base) => wooRestUrl(base, 'webhooks', { per_page: WOO_WEBHOOK_LIST_PAGE, page }));
    if (!Array.isArray(res.data)) throw new WooApiError('bad_response', undefined, Number(res.status));
    items.push(...res.data);
    if (res.data.length < WOO_WEBHOOK_LIST_PAGE) return { items, complete: true };
  }
  return { items, complete: false };
}

/** 우리 웹훅인가 = 수신 주소가 같거나 우리가 만든 id(몰이 주소 표기를 바꿔 돌려줘도 알아본다). 점검과 제거가 같은 판정을 쓴다. */
const isOurWooWebhook = (integ: WooIntegration, deliveryUrl: string) => (w: any): boolean =>
  String(w?.delivery_url) === deliveryUrl || (w?.id != null && integ.webhookIds.includes(Number(w.id)));

/** 한 몰의 웹훅을 다루는 실행이 서는 줄의 열쇠 */
const wooWebhookLine = (companyId: string, mallId: string): string => `woo-webhooks:${companyId}:${mallId}`;

async function ensureWooWebhooksInLine(companyId: string, mallId: string): Promise<WooWebhookEnsureResult> {
  const integ = await requireIntegration(companyId, mallId);
  if (!hasKeys(integ)) throw new WooApiError('no_keys');
  if (!integ.webhookSecret) throw new WooApiError('no_integration', '웹훅 secret 이 없습니다. 몰을 다시 저장해주세요.');
  const deliveryUrl = buildWooWebhookUrl(mallId);
  // 목록은 끝 쪽까지 읽는다 — 한 쪽만 보면 웹훅이 많은 몰에서 우리 것을 못 찾아 회차마다 새로 만든다. 끝을 확인 못 하면(상한) 만들지 않는다.
  const { items: existingList, complete: listComplete } = await listWooWebhooks(integ);
  const mine = isOurWooWebhook(integ, deliveryUrl);
  const ids: number[] = [];
  const createdIds: number[] = [];
  let created = 0;
  let existing = 0;
  let reactivated = 0;
  // 여기부터 몰에 웹훅이 생길 수 있다 — 어느 지점에서 실패하든 이번에 만든 것이 행에 적히지 못한 채 남으면 안 된다(해제의 제거가 행의 id 로 지운다).
  try {
    for (const topic of WOO_WEBHOOK_TOPICS) {
      const found = existingList.find((w) => String(w?.topic) === topic && mine(w));
      if (found) {
        existing++;
        if (found.id != null) ids.push(Number(found.id));
        if (found.id != null && String(found.status || '') === 'disabled') {
          await wooAuthedRequest(integ, 'PUT', (base) => wooRestUrl(base, `webhooks/${found.id}`, {}), { status: 'active' });
          reactivated++;
        }
        continue;
      }
      if (!listComplete) continue;   // 목록 끝을 확인 못 했다 — 있는지 모르는 것을 또 만들지 않는다
      const res = await wooAuthedRequest(integ, 'POST', (base) => wooRestUrl(base, 'webhooks', {}), {
        name: `한줄로 · ${topic}`,
        topic,
        delivery_url: deliveryUrl,
        secret: integ.webhookSecret,
        status: 'active',
        api_version: 'wp_api_v3',
      });
      created++;
      if (res.data?.id != null) { ids.push(Number(res.data.id)); createdIds.push(Number(res.data.id)); }
    }
    // 바뀐 것이 있을 때만 쓴다 — 주기 워커가 회차마다 부르므로 변화 없는 쓰기로 updated_at 을 흔들지 않는다
    const same = ids.length === integ.webhookIds.length && ids.every((id) => integ.webhookIds.includes(id));
    //   목록 전체 교체는 점검이 끝까지 성공했을 때만(목록 끝을 확인 못 한 회차는 찾은 것만 남기면 나머지를 잃는다).
    if (!same && listComplete) await saveWooWebhookIds(companyId, mallId, ids);
  } catch (err) {
    // 만들다 만 것도 추적한다 — 기존 id 를 잃지 않게 **합쳐서** 적는다(Codex R3). 다음 회차가 이어 만들고, 해제의 제거가 이 목록으로 지운다.
    if (createdIds.length > 0) {
      await saveWooWebhookIds(companyId, mallId, [...new Set([...integ.webhookIds, ...ids])]).catch(() => undefined);
    }
    throw err;
  }
  return { created, existing, reactivated, ids };
}

/**
 * 우리 웹훅 id 목록을 행에 적는다. id 는 **추적값**이라 행 상태와 무관하게 적는다 —
 * 해제 직후에 끝난 점검이 만든 웹훅도 여기 적혀 있어야 뒤에 선 제거(removeWooWebhooks)가 찾아 지운다.
 */
async function saveWooWebhookIds(companyId: string, mallId: string, ids: number[]): Promise<void> {
  await query(
    `UPDATE company_integrations SET meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
    [companyId, mallId, JSON.stringify({ woo_webhook_ids: ids })],
  );
}

/** 해제 뒤 웹훅 정리 미완료를 주기 워커가 이어서 정리하는 기간 — 그 뒤로는 더 시도하지 않는다(없어진 몰을 끝없이 부르지 않게) */
export const WOO_WEBHOOK_CLEANUP_DAYS = 7;

/**
 * 해제된 몰에서 우리 웹훅을 지운다(지운 개수 반환). 키 없으면 0.
 * ★1001 해제(revoked) **뒤에** 부른다 · **해제된 행에만** 한다(그 사이 다시 연결된 몰의 웹훅은 지우지 않는다) · 웹훅 줄(wooWebhookLine)에 선다 —
 *   도는 중이던 점검이 끝난 뒤에 돌고, 해제 뒤에 시작하는 점검은 해제된 행을 보고 만들지 않는다.
 * 지울 대상은 **몰의 실제 목록**에서 찾는다(점검과 같은 식별 = 수신 주소 또는 우리가 만든 id) — 우리 기록만 믿으면
 *   생성 응답이 유실돼 id 를 못 적은 웹훅이 영영 남는다(Codex R4). 우리가 웹훅을 만드는 몰(쓰기 권한 키)만 목록으로 재확인한다.
 * **정리 미완료**(meta.woo_webhook_cleanup = 처음 남긴 시각)는 해제가 행을 끊을 때 적는다(disconnectWoo). 여기서는 정리가 끝난 것이 확인될 때만 비운다 —
 *   목록을 못 읽었거나 못 지운 것이 남으면 그대로 둬 주기 워커가 WOO_WEBHOOK_CLEANUP_DAYS 동안 이어서 정리한다. 몰에 이미 없는 웹훅(not_found)은 지운 것으로 본다.
 */
export function removeWooWebhooks(companyId: string, mallId: string): Promise<number> {
  return runSerial(wooWebhookLine(companyId, mallId), () => removeWooWebhooksInLine(companyId, mallId));
}

async function removeWooWebhooksInLine(companyId: string, mallId: string): Promise<number> {
  const row = await query(
    `SELECT ${ROW_COLUMNS} FROM company_integrations
     WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 LIMIT 1`,
    [companyId, mallId],
  );
  if (!row.rows[0] || row.rows[0].status !== 'revoked') return 0;
  const integ = toIntegration(row.rows[0]);
  // 정리 결과를 행에 적는다 — 남은 것이 없으면 기록 id 와 미완료 표시를 비우고, 남았으면 그것만 남긴다. 저장이 실패하면 표시가 그대로 남아 다음 회차가 다시 한다.
  const settle = (patch: Record<string, unknown>) => query(
    `UPDATE company_integrations
        SET meta = (COALESCE(meta, '{}'::jsonb) - 'woo_webhook_ids' - 'woo_webhook_cleanup') || $3::jsonb, updated_at = NOW()
      WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2 AND status = 'revoked'`,
    [companyId, mallId, JSON.stringify(patch)],
  ).catch(() => undefined);
  // 지울 수단(REST 키)이 없으면 정리할 것이 없다 = 정리 끝
  if (!hasKeys(integ)) { await settle({}); return 0; }

  let targets = integ.webhookIds;
  let unsure = false;   // 몰의 목록으로 확인하지 못했다(조회 실패 · 쪽수 상한)
  if (integ.keyPermissions.includes('write')) {
    try {
      const list = await listWooWebhooks(integ);
      const found = list.items.filter(isOurWooWebhook(integ, buildWooWebhookUrl(mallId))).map((w) => Number(w?.id)).filter((n) => Number.isFinite(n));
      // 끝까지 읽었으면 목록이 진실이다(기록에만 있고 목록에 없는 id 는 이미 없는 웹훅). 못 읽은 쪽이 있으면 기록의 id 도 함께 지운다.
      targets = list.complete ? found : [...found, ...integ.webhookIds];
      unsure = !list.complete;
    } catch {
      unsure = true;
    }
  }
  targets = [...new Set(targets)];

  let removed = 0;
  const left: number[] = [];
  for (const id of targets) {
    try {
      await wooAuthedRequest(integ, 'DELETE', (base) => wooRestUrl(base, `webhooks/${id}`, { force: 'true' }));
      removed++;
    } catch (err: any) {
      if (err instanceof WooApiError && err.code === 'not_found') continue;   // 이미 없는 웹훅
      left.push(id);
      console.log(`[WooCommerce] 웹훅 제거 실패(행에 남겨 주기 워커가 다시 지운다) mall=${mallId} id=${id} err=${err?.code || err?.message}`);
    }
  }
  const pending = unsure || left.length > 0;
  await settle(pending
    ? { ...(left.length > 0 ? { woo_webhook_ids: left } : {}), woo_webhook_cleanup: integ.webhookCleanupSince || new Date().toISOString() }
    : {});
  return removed;
}

/** 해제 뒤 웹훅 정리가 덜 끝난 몰(정리 미완료를 남긴 지 WOO_WEBHOOK_CLEANUP_DAYS 이내 · 해제 상태) — 주기 워커가 이어서 정리한다. */
export async function listWooWebhookCleanupTargets(): Promise<Array<{ companyId: string; mallId: string }>> {
  const cutoff = new Date(Date.now() - WOO_WEBHOOK_CLEANUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const r = await query(
    `SELECT company_id, mall_id FROM company_integrations
      WHERE provider = 'woocommerce' AND status = 'revoked' AND (meta->>'woo_webhook_cleanup') > $1
      ORDER BY updated_at ASC LIMIT 10`,
    [cutoff],
  );
  return r.rows.map((x: any) => ({ companyId: String(x.company_id), mallId: String(x.mall_id) }));
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
  return { imported: r.imported, pages: r.pages, truncated: r.truncated };
}
