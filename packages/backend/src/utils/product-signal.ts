/**
 * product-signal.ts — 상품 단위 뿌리 CT (★ 2026-11-13 C133 F2 · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-1 ~ §5-3)
 *
 * 한 곳에서 정하는 것
 *   ① 조회 · 장바구니 사건의 상품 식별 — 상품 줄 = `properties.items[]`(SDK 가 GA4 view_item · add_to_cart 를 옮긴 꼴) 또는
 *      사건 맨 위 칸(직접 부르는 viewProduct(p)). 키 = productId → product_id → product_code → 이름(productName → product_name) 순서의 첫 값.
 *      주문 상품의 키는 지금 있는 규칙 그대로다(journey-product mallItemKeySql · ledgerProductKeySql) — productId 가 있는 줄은 두 식이 같은 답(짝 시험).
 *      상품 식별 = (문, 키). 자사몰 123번과 매장 123번은 다른 상품이다. 문을 넘는 「같은 상품」은 이름(공백 정리 · 소문자)으로만 본다.
 *   ② 표 product_signal_daily(배포 원장 C133-DDL-2) = 회사 · 문 · 상품 키 · KST 날짜마다 조회 · 장바구니 · 구매 수.
 *      쓰는 곳 = 이 파일의 야간 워커 하나. **회사마다 보관 기간(60일) 전체를 다시 세어 한 트랜잭션에서 통째로 바꾼다.**
 *      커서 · 「다시 셀 날」을 두지 않는다 = 늦게 온 옛 사건 · 구매 정정 · 취소 · 처음 채우기가 모두 같은 한 길.
 *   ③ 읽기 = 이 파일의 함수만 · 모든 읽기에 company_id · 창 = PRODUCT_SIGNAL_WINDOW_DAYS(30) 하나(앞 30일은 「지난 30일 대비」 비교용).
 *   ④ 「보고 안 산 고객」 = 최근 30일 그 상품을 본 식별 고객 중 그 뒤 그 상품을 두 문 어디서도 안 산 고객 · 수신 가능(여정 안전 필터) ·
 *      보는 사람의 분류코드 범위 안. 세는 길과 명단 길이 같은 문장이다. 조건으로 정하는 대상이고 예측은 쓰지 않는다.
 *
 * ⛔ 계산 대상 회사 = 단계 개방(v3-stage)에서 상품 반응 · 추천이 열린 회사만. ENV 명단이 비면 아무것도 계산하지 않는다(미가입 · 미개방 회사 부하 0).
 */
import { query, withTransaction } from '../config/database';
import { netPurchaseSql } from './cdp-order-revenue';
import { LEDGER_PURCHASES_SQL } from './two-door-purchase';
import { mallItemKeySql, mallItemsSql, ledgerProductKeySql } from './journey-product';
import { buildJourneySafetyFilter } from './journey-safety-filter';
import { ownerJourneyConsent } from './mall-consent';
import { getOwnerCustomerScopeSql } from './store-scope';
import { ACTIVE_PAID_PLAN_WHERE } from './plan-guard';
import { v3Live, v3LiveState, v3StageScope, type V3Feature } from './v3-stage';
import { resolveHubStoreScope } from './store-scope';

/** 화면 · 후보 · 고르기가 같이 쓰는 창(일) — 퍼널 창(cdp-diagnostics buildCdpFunnel)과 같은 값 */
export const PRODUCT_SIGNAL_WINDOW_DAYS = 30;
/** 표에 두는 기간 = 창의 두 배(앞 30일 = 「지난 30일 대비」 비교용) */
export const PRODUCT_SIGNAL_KEEP_DAYS = PRODUCT_SIGNAL_WINDOW_DAYS * 2;
export const SIGNAL_VIEW_EVENT = 'product_view';
export const SIGNAL_CART_EVENT = 'cart_add';
export const SIGNAL_SEARCH_EVENT = 'search';
/** 표의 상품 키 · 이름 칸 길이(넘는 값은 잘라 담는다 — 긴 이름 하나가 그 회사 계산 전체를 떨어뜨리지 않게) */
export const SIGNAL_KEY_MAX = 200;
export type SignalDoor = 'mall' | 'ledger';
/** 이 뿌리를 읽는 기능(둘 중 하나라도 열린 회사만 계산한다) */
export const SIGNAL_FEATURES: readonly V3Feature[] = ['product-insight', 'reco'];

// ── ① 상품 식별(SQL · JS 한 벌) ──

export const SIGNAL_KEY_FIELDS = ['productId', 'product_id', 'product_code'] as const;
export const SIGNAL_NAME_FIELDS = ['productName', 'product_name'] as const;

const fieldSql = (it: string, k: string) => `NULLIF(TRIM(${it}->>'${k}'), '')`;

/** 조회 · 장바구니 사건 e 의 상품 줄(jsonb) — items[] 가 있으면 그 줄들 · 없으면 사건 맨 위 칸을 한 줄로 */
export function signalItemsSql(e: string): string {
  return `jsonb_array_elements(CASE WHEN jsonb_typeof(${e}.properties->'items') = 'array' AND jsonb_array_length(${e}.properties->'items') > 0`
    + ` THEN ${e}.properties->'items' ELSE jsonb_build_array(${e}.properties) END)`;
}
/** 상품 줄 → 이름 SQL */
export function signalItemNameSql(it: string): string {
  return `COALESCE(${SIGNAL_NAME_FIELDS.map((k) => fieldSql(it, k)).join(', ')})`;
}
/** 상품 줄 → 키 SQL(표 칸 길이로 자른다) */
export function signalItemKeySql(it: string): string {
  return `LEFT(COALESCE(${[...SIGNAL_KEY_FIELDS, ...SIGNAL_NAME_FIELDS].map((k) => fieldSql(it, k)).join(', ')}), ${SIGNAL_KEY_MAX})`;
}
/** 이름 비교용 정리 SQL — 앞뒤 공백 제거 · 이어진 공백 하나로 · 소문자 · 빈 값 = NULL(NULL 끼리는 같지 않다) */
export function normNameSql(expr: string): string {
  return `NULLIF(LOWER(regexp_replace(TRIM(${expr}), '\\s+', ' ', 'g')), '')`;
}

const trimOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
/** signalItemsSql 의 JS 쌍둥이 */
export function signalLines(props: any): any[] {
  if (props && Array.isArray(props.items) && props.items.length > 0) return props.items;
  return [props];
}
export function signalItemName(item: any): string | null {
  for (const k of SIGNAL_NAME_FIELDS) { const v = trimOrNull(item?.[k]); if (v) return v; }
  return null;
}
export function signalItemKey(item: any): string | null {
  for (const k of [...SIGNAL_KEY_FIELDS, ...SIGNAL_NAME_FIELDS]) { const v = trimOrNull(item?.[k]); if (v) return v.slice(0, SIGNAL_KEY_MAX); }
  return null;
}
/** normNameSql 의 JS 쌍둥이 */
export function normName(v: unknown): string | null {
  const s = trimOrNull(v);
  return s ? s.replace(/\s+/g, ' ').toLowerCase() : null;
}

// ── ② 쓰기 — 회사 하나를 통째로 다시 센다 ──

/** KST 오늘에서 n일 전 날짜(오늘 포함 n+1일 범위의 첫날) */
const kstDayAgoSql = (n: string) => `((NOW() AT TIME ZONE 'Asia/Seoul')::date - ${n})`;
/** 그 KST 날짜 0시의 시각(timestamptz) — cdp_events.occurred_at 범위 비교용(색인 company_id · event_name · occurred_at) */
const kstDayStartSql = (dayExpr: string) => `(${dayExpr}::timestamp AT TIME ZONE 'Asia/Seoul')`;

export const SIGNAL_DELETE_SQL = 'DELETE FROM product_signal_daily WHERE company_id = $1::uuid';

/**
 * 회사 하나의 보관 기간 전체를 다시 세어 넣는다($1 회사 · $2 보관 일수).
 *   조회 · 장바구니 = 사건의 상품 줄마다 1 / 자사몰 구매 = 결제된 주문 수(같은 주문 안 같은 상품 여러 줄 = 1) / 매장 구매 = 구매 원장 행 수.
 *   이름 = 그날 마지막으로 본(산) 이름. 미래 시각 사건은 세지 않는다(원장은 LEDGER_PURCHASES_SQL 이 이미 뺀다).
 */
export const SIGNAL_REBUILD_SQL = `
  INSERT INTO product_signal_daily (company_id, door, product_key, day, product_name, views, carts, orders)
  SELECT $1::uuid, x.door, x.key, x.day,
         (array_agg(x.name ORDER BY x.at DESC) FILTER (WHERE x.name IS NOT NULL))[1],
         (COUNT(*) FILTER (WHERE x.kind = 'view'))::int,
         (COUNT(*) FILTER (WHERE x.kind = 'cart'))::int,
         (COUNT(DISTINCT x.src) FILTER (WHERE x.kind = 'order'))::int
    FROM (
      SELECT 'mall'::text AS door, ${signalItemKeySql('it')} AS key, (e.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS day,
             LEFT(${signalItemNameSql('it')}, ${SIGNAL_KEY_MAX}) AS name, e.occurred_at AS at,
             CASE WHEN e.event_name = '${SIGNAL_VIEW_EVENT}' THEN 'view' ELSE 'cart' END AS kind, e.id::text AS src
        FROM cdp_events e, ${signalItemsSql('e')} it
       WHERE e.company_id = $1::uuid AND e.event_name IN ('${SIGNAL_VIEW_EVENT}', '${SIGNAL_CART_EVENT}')
         AND e.occurred_at >= ${kstDayStartSql(kstDayAgoSql('($2::int - 1)'))} AND e.occurred_at <= NOW()
      UNION ALL
      SELECT 'mall'::text, LEFT(${mallItemKeySql('it')}, ${SIGNAL_KEY_MAX}), (e.occurred_at AT TIME ZONE 'Asia/Seoul')::date,
             LEFT(NULLIF(TRIM(it->>'productName'), ''), ${SIGNAL_KEY_MAX}), e.occurred_at, 'order', e.id::text
        FROM cdp_events e, ${mallItemsSql('e')} it
       WHERE e.company_id = $1::uuid AND ${netPurchaseSql('e')}
         AND e.occurred_at >= ${kstDayStartSql(kstDayAgoSql('($2::int - 1)'))} AND e.occurred_at <= NOW()
      UNION ALL
      SELECT 'ledger'::text, LEFT(${ledgerProductKeySql('p')}, ${SIGNAL_KEY_MAX}), p.purchase_date::date,
             LEFT(NULLIF(TRIM(p.product_name), ''), ${SIGNAL_KEY_MAX}), (p.purchase_date AT TIME ZONE 'Asia/Seoul'), 'order', p.id::text
        FROM ${LEDGER_PURCHASES_SQL} p
       WHERE p.company_id = $1::uuid AND p.purchase_date IS NOT NULL
         AND p.purchase_date >= ${kstDayAgoSql('($2::int - 1)')}
    ) x
   WHERE x.key IS NOT NULL
   GROUP BY x.door, x.key, x.day`;

/** 회사 하나 계산의 시간 제한(ms) — 넘으면 그 회사의 옛 행을 그대로 둔다(되돌림 = 반쯤 바뀐 상태 0) */
export const SIGNAL_REBUILD_TIMEOUT_MS = 120_000;

/** 회사 하나를 통째로 다시 센다(지우고 넣기 · 한 트랜잭션). 돌려주는 값 = 넣은 행 수 */
export async function rebuildCompanySignals(companyId: string): Promise<number> {
  return withTransaction(async (run) => {
    await run(`SET LOCAL statement_timeout = ${SIGNAL_REBUILD_TIMEOUT_MS}`);
    await run(SIGNAL_DELETE_SQL, [companyId]);
    const r = await run(SIGNAL_REBUILD_SQL, [companyId, PRODUCT_SIGNAL_KEEP_DAYS]);
    return r.rowCount || 0;
  });
}

// ── ③ 읽기 ──

export interface ProductSignalRow {
  door: SignalDoor;
  key: string;
  name: string;
  views: number;
  carts: number;
  orders: number;
  /** 앞 30일(비교용) */
  prevViews: number;
  prevOrders: number;
}

export const PRODUCT_SIGNAL_LIST_LIMIT = 100;

/**
 * 최근 30일 상품 표($1 회사 · $2 창 일수 · $3 줄 수) — 조회 많은 순 · 같으면 구매 순.
 *   창 안에 조회 · 장바구니 · 구매가 하나라도 있는 상품만. 날짜로 다시 거른다(계산이 며칠 밀려도 창 밖 값이 섞이지 않는다).
 */
export const SIGNAL_LIST_SQL = `
  SELECT s.door, s.product_key AS key,
         (array_agg(s.product_name ORDER BY s.day DESC) FILTER (WHERE s.product_name IS NOT NULL))[1] AS name,
         COALESCE(SUM(s.views) FILTER (WHERE s.day > ${kstDayAgoSql('$2::int')}), 0)::int AS views,
         COALESCE(SUM(s.carts) FILTER (WHERE s.day > ${kstDayAgoSql('$2::int')}), 0)::int AS carts,
         COALESCE(SUM(s.orders) FILTER (WHERE s.day > ${kstDayAgoSql('$2::int')}), 0)::int AS orders,
         COALESCE(SUM(s.views) FILTER (WHERE s.day <= ${kstDayAgoSql('$2::int')}), 0)::int AS prev_views,
         COALESCE(SUM(s.orders) FILTER (WHERE s.day <= ${kstDayAgoSql('$2::int')}), 0)::int AS prev_orders
    FROM product_signal_daily s
   WHERE s.company_id = $1::uuid AND s.day > ${kstDayAgoSql('($2::int * 2)')}
   GROUP BY s.door, s.product_key
  HAVING COALESCE(SUM(s.views + s.carts + s.orders) FILTER (WHERE s.day > ${kstDayAgoSql('$2::int')}), 0) > 0
   ORDER BY views DESC, orders DESC, s.door, s.product_key
   LIMIT $3::int`;

const toRow = (x: any): ProductSignalRow => ({
  door: x.door === 'ledger' ? 'ledger' : 'mall',
  key: String(x.key),
  name: String(x.name || x.key),
  views: Number(x.views || 0),
  carts: Number(x.carts || 0),
  orders: Number(x.orders || 0),
  prevViews: Number(x.prev_views || 0),
  prevOrders: Number(x.prev_orders || 0),
});

export async function listProductSignals(companyId: string, limit: number = PRODUCT_SIGNAL_LIST_LIMIT): Promise<ProductSignalRow[]> {
  const n = Math.max(1, Math.min(PRODUCT_SIGNAL_LIST_LIMIT, Math.floor(Number(limit) || PRODUCT_SIGNAL_LIST_LIMIT)));
  const r = await query(SIGNAL_LIST_SQL, [companyId, PRODUCT_SIGNAL_WINDOW_DAYS, n]);
  return r.rows.map(toRow);
}

/** 고른 상품들의 최근 30일 숫자($1 회사 · $2 창 · $3 문 · $4 키들) — 몰 상품 고르는 창 · 반응 숫자 글자 고정이 읽는다. 관측 없는 키는 결과에 없다 */
export const SIGNAL_NUMBERS_SQL = `
  SELECT s.product_key AS key, SUM(s.views)::int AS views, SUM(s.carts)::int AS carts, SUM(s.orders)::int AS orders
    FROM product_signal_daily s
   WHERE s.company_id = $1::uuid AND s.door = $3 AND s.product_key = ANY($4::text[]) AND s.day > ${kstDayAgoSql('$2::int')}
   GROUP BY s.product_key`;

export async function productNumbersFor(companyId: string, door: SignalDoor, keys: readonly string[]): Promise<Map<string, { views: number; carts: number; orders: number }>> {
  const clean = [...new Set(keys.map((k) => trimOrNull(k)?.slice(0, SIGNAL_KEY_MAX)).filter(Boolean) as string[])].slice(0, 500);
  const out = new Map<string, { views: number; carts: number; orders: number }>();
  if (clean.length === 0) return out;
  const r = await query(SIGNAL_NUMBERS_SQL, [companyId, PRODUCT_SIGNAL_WINDOW_DAYS, door, clean]);
  for (const x of r.rows) out.set(String(x.key), { views: Number(x.views || 0), carts: Number(x.carts || 0), orders: Number(x.orders || 0) });
  return out;
}

export interface SignalViewer { companyId?: string; userId?: string; userType?: string }

/**
 * 이 요청자가 상품 숫자(회사 전체 값)를 볼 수 있는가 — 숫자가 나가는 모든 자리의 관문 한 곳(성과리포트 구역 · 몰 상품 고르는 창).
 *   회사 사용자 · 단계 개방(요금제가 먼저) · **분류코드로 나뉘지 않은 사람**. 상품 조회 수는 회사 전체 값이라 담당자의 범위로 나눌 수 없다
 *   (「사용자는 자기 것」 원칙) → 분류코드로 나뉜 담당자 · 미배정 담당자에게는 숫자를 주지 않는다.
 */
export async function productInsightOpenFor(user: SignalViewer | null | undefined): Promise<boolean> {
  const companyId = user?.companyId;
  if (!companyId || !user?.userId || user.userType === 'super_admin') return false;
  if (!(await v3Live('product-insight', companyId))) return false;
  const scope = await resolveHubStoreScope(companyId, user.userId, user.userType);
  return !scope.blocked && scope.storeFilter === '';
}

/**
 * 몰 상품 목록에 최근 30일 숫자(signal)를 붙인다 — 몰 상품 고르는 창의 담당자용 표시(설계서 §5-3).
 *   맞추는 순서 = 상품 식별 규칙과 같다: 상품번호(no) → 상품 코드(code) → 이름. 관측이 없는 상품은 signal 없음(표시 없음).
 *   ⛔ 이 숫자는 덧붙임이다 — 숫자를 볼 수 없는 요청자(productInsightOpenFor) · 표 없음 · 조회 실패 = 받은 목록을 그대로 돌려준다(상품 고르기를 깨지 않는다).
 */
export async function attachProductNumbers<T extends { no?: unknown; code?: unknown; name?: unknown }>(
  viewer: SignalViewer | null | undefined,
  products: T[],
): Promise<Array<T & { signal?: { views: number; orders: number } }>> {
  try {
    if (products.length === 0 || !(await productInsightOpenFor(viewer))) return products;
    const companyId = String(viewer!.companyId);
    const cand = (p: T) => [p.no, p.code, p.name].map((v) => trimOrNull(v)?.slice(0, SIGNAL_KEY_MAX)).filter(Boolean) as string[];
    const numbers = await productNumbersFor(companyId, 'mall', products.flatMap(cand));
    return products.map((p) => {
      const hit = cand(p).map((k) => numbers.get(k)).find(Boolean);
      return hit ? { ...p, signal: { views: hit.views, orders: hit.orders } } : p;
    });
  } catch (err: any) {
    console.warn('[product-signal] 상품 숫자 붙이기 건너뜀:', err?.message);
    return products;
  }
}

/** 이 회사에 최근 30일 관측(조회 · 장바구니 · 구매)이 있는가 — 빈 상태 판정 */
export async function hasProductSignals(companyId: string): Promise<boolean> {
  const r = await query(
    `SELECT EXISTS (SELECT 1 FROM product_signal_daily s WHERE s.company_id = $1::uuid AND s.day > ${kstDayAgoSql('$2::int')}) AS has`,
    [companyId, PRODUCT_SIGNAL_WINDOW_DAYS],
  );
  return r.rows[0]?.has === true;
}

// ── 검색어 ──

export const SEARCH_TERM_LIMIT = 50;
export const SEARCH_TERM_MAX = 100;
/** 사건 e 의 검색어(공백 정리 · 소문자 · 길이 제한 · 빈 값 = NULL) */
export function searchTermSql(e: string): string {
  return `LEFT(${normNameSql(`${e}.properties->>'search_term'`)}, ${SEARCH_TERM_MAX})`;
}
/** searchTermSql 의 JS 쌍둥이(화면이 보낸 검색어를 같은 꼴로) */
export function normSearchTerm(v: unknown): string | null {
  return normName(v)?.slice(0, SEARCH_TERM_MAX) || null;
}

/** 최근 30일 검색어 순위($1 회사 · $2 창 · $3 줄 수) — 검색 수 · 검색한 식별 고객 수 */
export const SEARCH_TERMS_SQL = `
  SELECT t.term, COUNT(*)::int AS searches, COUNT(DISTINCT t.customer_id)::int AS customers
    FROM (
      SELECT ${searchTermSql('e')} AS term, e.customer_id
        FROM cdp_events e
       WHERE e.company_id = $1::uuid AND e.event_name = '${SIGNAL_SEARCH_EVENT}'
         AND e.occurred_at >= ${kstDayStartSql(kstDayAgoSql('($2::int - 1)'))} AND e.occurred_at <= NOW()
    ) t
   WHERE t.term IS NOT NULL
   GROUP BY t.term
   ORDER BY searches DESC, t.term
   LIMIT $3::int`;

export async function listSearchTerms(companyId: string): Promise<Array<{ term: string; searches: number; customers: number }>> {
  const r = await query(SEARCH_TERMS_SQL, [companyId, PRODUCT_SIGNAL_WINDOW_DAYS, SEARCH_TERM_LIMIT]);
  return r.rows.map((x: any) => ({ term: String(x.term), searches: Number(x.searches || 0), customers: Number(x.customers || 0) }));
}

// ── ④ 「보고 안 산 고객」 · 「이 말을 찾은 고객」 — 세는 길 = 명단 길 ──

/** 주인(요청자) 기준 수신 가능 조건 + 분류코드 범위 — 여정 추출과 같은 두 CT */
async function sendableCustomerSql(companyId: string, viewerUserId: string | null | undefined): Promise<string> {
  const consent = await ownerJourneyConsent(companyId, viewerUserId);
  const scope = await getOwnerCustomerScopeSql(companyId, viewerUserId, 'c');
  return `${buildJourneySafetyFilter('c', consent?.isTrue)}${scope}`;
}

/**
 * 최근 창 안에 그 상품을 본 식별 고객 중 마지막으로 본 뒤 그 상품을 안 산 수신 가능 고객 — 칸 = key · customer_id · phone · name.
 *   $1 회사 · $2 키들(자사몰 문) · $3 창 일수.
 *   「산 것」 = 자사몰 결제 주문의 같은 키 또는 같은 이름(마지막 조회 뒤) · 매장 원장의 같은 이름(조회한 KST 날 포함 그 뒤 — 원장은 날짜만 있어
 *   같은 날 매장에서 산 사람도 뺀다 = 산 사람에게 다시 권하지 않는 쪽).
 */
export function viewedNotBoughtSql(sendable: string): string {
  return `WITH viewed AS (
      SELECT k.key, e.customer_id, MAX(e.occurred_at) AS last_view,
             (array_agg(k.name ORDER BY e.occurred_at DESC) FILTER (WHERE k.name IS NOT NULL))[1] AS name
        FROM cdp_events e, ${signalItemsSql('e')} it,
             LATERAL (SELECT ${signalItemKeySql('it')} AS key, ${signalItemNameSql('it')} AS name) k
       WHERE e.company_id = $1::uuid AND e.event_name = '${SIGNAL_VIEW_EVENT}' AND e.customer_id IS NOT NULL
         AND e.occurred_at >= ${kstDayStartSql(kstDayAgoSql('($3::int - 1)'))} AND e.occurred_at <= NOW()
         AND k.key = ANY($2::text[])
       GROUP BY k.key, e.customer_id
    )
    SELECT v.key, c.id AS customer_id, c.phone, c.name
      FROM viewed v
      JOIN customers c ON c.id = v.customer_id AND c.company_id = $1::uuid
     WHERE ${sendable}
       AND NOT EXISTS (
         SELECT 1 FROM cdp_events b, ${mallItemsSql('b')} bi
          WHERE b.company_id = $1::uuid AND b.customer_id = v.customer_id AND ${netPurchaseSql('b')} AND b.occurred_at > v.last_view
            AND (LEFT(${mallItemKeySql('bi')}, ${SIGNAL_KEY_MAX}) = v.key OR ${normNameSql(`bi->>'productName'`)} = ${normNameSql('v.name')}))
       AND NOT EXISTS (
         SELECT 1 FROM ${LEDGER_PURCHASES_SQL} bl
          WHERE bl.company_id = $1::uuid AND bl.customer_id = v.customer_id AND bl.purchase_date IS NOT NULL
            AND bl.purchase_date >= (v.last_view AT TIME ZONE 'Asia/Seoul')::date
            AND ${normNameSql('bl.product_name')} = ${normNameSql('v.name')})`;
}

/**
 * 최근 창 안에 그 말들을 찾은 식별 고객 중 수신 가능 고객 — 칸 = term · customer_id · phone · name.
 *   $1 회사 · $2 검색어들(정리된 꼴) · $3 창 일수. 검색 사건에서 출발한다(고객 전체를 훑지 않는다 · 색인 company_id · event_name · occurred_at).
 */
export function searchedCustomersSql(sendable: string): string {
  return `WITH hit AS (
      SELECT DISTINCT t.term, t.customer_id
        FROM (
          SELECT ${searchTermSql('e')} AS term, e.customer_id
            FROM cdp_events e
           WHERE e.company_id = $1::uuid AND e.event_name = '${SIGNAL_SEARCH_EVENT}' AND e.customer_id IS NOT NULL
             AND e.occurred_at >= ${kstDayStartSql(kstDayAgoSql('($3::int - 1)'))} AND e.occurred_at <= NOW()
        ) t
       WHERE t.term = ANY($2::text[])
    )
    SELECT h.term, c.id AS customer_id, c.phone, c.name
      FROM hit h
      JOIN customers c ON c.id = h.customer_id AND c.company_id = $1::uuid
     WHERE ${sendable}`;
}

/** 대상 조회 한 번의 시간 제한(ms) — 사건 30일을 훑는다 · 넘으면 그 요청만 실패(화면은 단추를 그리지 않는다) */
export const AUDIENCE_QUERY_TIMEOUT_MS = 25_000;
async function boundedRead(sql: string, params: any[]): Promise<any[]> {
  return withTransaction(async (run) => {
    await run(`SET LOCAL statement_timeout = ${AUDIENCE_QUERY_TIMEOUT_MS}`);
    return (await run(sql, params)).rows;
  });
}
/** 명단이 번호 하나를 한 번만 담으므로 세는 것도 번호 기준이다(빈 번호 제외) — 세는 길 = 명단 길 */
const PHONE_COUNT_SQL = `COUNT(DISTINCT NULLIF(TRIM(a.phone), ''))::int`;

/** 한 번에 세는 상품 수 상한(화면 표의 줄 수) */
export const AUDIENCE_COUNT_KEYS_MAX = PRODUCT_SIGNAL_LIST_LIMIT;
/** 명단으로 넘기는 최대 인원(넘으면 truncated) */
export const AUDIENCE_LIST_MAX = 50_000;

/** 상품마다 「보고 안 산 고객」 수 — 자사몰 문의 키만(조회 사건은 자사몰에만 있다) */
export async function countViewedNotBought(companyId: string, viewerUserId: string | null | undefined, keys: readonly string[]): Promise<Map<string, number>> {
  const clean = [...new Set(keys.map((k) => trimOrNull(k)?.slice(0, SIGNAL_KEY_MAX)).filter(Boolean) as string[])].slice(0, AUDIENCE_COUNT_KEYS_MAX);
  const out = new Map<string, number>();
  if (clean.length === 0) return out;
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  const rows = await boundedRead(
    `SELECT a.key, ${PHONE_COUNT_SQL} AS n FROM (${viewedNotBoughtSql(sendable)}) a GROUP BY a.key`,
    [companyId, clean, PRODUCT_SIGNAL_WINDOW_DAYS],
  );
  for (const x of rows) out.set(String(x.key), Number(x.n || 0));
  return out;
}

export interface AudienceRecipient { phone: string; name: string }
export interface AudienceList { recipients: AudienceRecipient[]; total: number; truncated: boolean }

const toAudience = (rows: any[]): AudienceList => {
  // 같은 번호의 고객 행이 둘이면 한 번만(직접발송 창의 중복 제거와 같은 결과를 미리)
  const seen = new Set<string>();
  const all: AudienceRecipient[] = [];
  for (const x of rows) {
    const phone = String(x.phone || '').trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    all.push({ phone, name: String(x.name || '') });
  }
  return { recipients: all.slice(0, AUDIENCE_LIST_MAX), total: all.length, truncated: all.length > AUDIENCE_LIST_MAX };
};

/** 한 상품의 「보고 안 산 고객」 명단(지금 다시 센다) */
export async function listViewedNotBought(companyId: string, viewerUserId: string | null | undefined, key: string): Promise<AudienceList> {
  const k = trimOrNull(key)?.slice(0, SIGNAL_KEY_MAX);
  if (!k) return { recipients: [], total: 0, truncated: false };
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  return toAudience(await boundedRead(`${viewedNotBoughtSql(sendable)} ORDER BY c.id`, [companyId, [k], PRODUCT_SIGNAL_WINDOW_DAYS]));
}

/** 검색어마다 수신 가능한 검색 고객 수 */
export async function countSearchedCustomers(companyId: string, viewerUserId: string | null | undefined, terms: readonly string[]): Promise<Map<string, number>> {
  const clean = [...new Set(terms.map((t) => normSearchTerm(t)).filter(Boolean) as string[])].slice(0, SEARCH_TERM_LIMIT);
  const out = new Map<string, number>();
  if (clean.length === 0) return out;
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  for (const term of clean) out.set(term, 0);
  const rows = await boundedRead(
    `SELECT a.term, ${PHONE_COUNT_SQL} AS n FROM (${searchedCustomersSql(sendable)}) a GROUP BY a.term`,
    [companyId, clean, PRODUCT_SIGNAL_WINDOW_DAYS],
  );
  for (const x of rows) out.set(String(x.term), Number(x.n || 0));
  return out;
}

/** 한 검색어의 수신 가능 고객 명단(지금 다시 센다) */
export async function listSearchedCustomers(companyId: string, viewerUserId: string | null | undefined, term: string): Promise<AudienceList> {
  const t = normSearchTerm(term);
  if (!t) return { recipients: [], total: 0, truncated: false };
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  return toAudience(await boundedRead(`${searchedCustomersSql(sendable)} ORDER BY c.id`, [companyId, [t], PRODUCT_SIGNAL_WINDOW_DAYS]));
}

// ── 야간 워커 ──

/**
 * 계산 대상 회사 — 상품 반응 · 추천 중 하나라도 열린 회사(ENV 명단이 후보 · 회사마다 판정으로 확정).
 *   unknown = 요금제를 읽지 못한 회사(일시 장애일 수 있다) → 이번에는 세지도 **지우지도** 않는다(옛 행 유지 · 다음 밤 다시).
 */
export async function signalTargets(): Promise<{ open: string[]; unknown: string[] }> {
  const scopes = SIGNAL_FEATURES.map((f) => v3StageScope(f));
  let candidates: string[];
  if (scopes.some((s) => s.all)) {
    const r = await query(`SELECT c.id FROM companies c JOIN plans p ON c.plan_id = p.id WHERE ${ACTIVE_PAID_PLAN_WHERE} ORDER BY c.id`);
    candidates = r.rows.map((x: any) => String(x.id));
  } else {
    candidates = [...new Set(scopes.flatMap((s) => s.ids))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  }
  const open: string[] = [];
  const unknown: string[] = [];
  for (const id of candidates) {
    const states: string[] = [];
    for (const f of SIGNAL_FEATURES) {
      states.push(await v3LiveState(f, id));
      if (states[states.length - 1] === 'open') break;
    }
    if (states.includes('open')) open.push(id);
    else if (states.includes('unknown')) unknown.push(id);
  }
  return { open, unknown };
}

/** 계산 대상 회사 id 만 */
export async function signalTargetCompanies(): Promise<string[]> {
  return (await signalTargets()).open;
}

export interface SignalPassResult { ran: boolean; rebuilt: number; cleared: number; failed: number }

let passRunning = false;

/**
 * 한 바퀴 — 열린 회사는 통째로 다시 세고, 열려 있지 않은데 행이 남은 회사는 지운다(닫힌 뒤 옛 숫자가 남지 않게).
 *   onlyMissing = 행이 하나도 없는 열린 회사만(기동 직후 첫 채우기 · 방금 명단에 든 회사). 한 회사의 실패는 그 회사만 건너뛴다(옛 행 유지).
 */
export async function runProductSignalPass(opts: { onlyMissing?: boolean } = {}): Promise<SignalPassResult> {
  if (passRunning) return { ran: false, rebuilt: 0, cleared: 0, failed: 0 };
  passRunning = true;
  const res: SignalPassResult = { ran: true, rebuilt: 0, cleared: 0, failed: 0 };
  try {
    const { open, unknown } = await signalTargets();
    const have = new Set((await query('SELECT DISTINCT company_id FROM product_signal_daily')).rows.map((x: any) => String(x.company_id)));
    // ponytail: 회사를 하나씩 차례로 센다(회사마다 최대 2분) — 열린 회사가 수백 곳이 되어 밤 안에 못 끝나면 두세 회사씩 나란히 돌린다
    for (const id of open) {
      if (opts.onlyMissing && have.has(id)) continue;
      try {
        await rebuildCompanySignals(id);
        res.rebuilt++;
      } catch (err: any) {
        res.failed++;
        console.error(`[product-signal] 회사 ${id} 계산 실패(옛 행 유지 · 다음 밤 다시): ${err?.message}`);
      }
    }
    if (!opts.onlyMissing) {
      // 지우는 것은 「닫힌 것이 확인된」 회사뿐이다 — 판정을 못 한 회사(unknown)의 행은 그대로 둔다
      const keep = new Set([...open, ...unknown]);
      for (const id of have) {
        if (keep.has(id)) continue;
        await query(SIGNAL_DELETE_SQL, [id]);
        res.cleared++;
      }
    }
  } finally {
    passRunning = false;
  }
  return res;
}

const WORKER_INTERVAL_MS = 30 * 60 * 1000;
/** 밤 계산 시각(KST 시) — 발송 · 적재가 없는 시간대 */
export const SIGNAL_RUN_HOUR_KST = 3;
const BOOT_FILL_DELAY_MS = 90_000;
let workerTimer: ReturnType<typeof setInterval> | null = null;
let lastRunDayKst = '';

const kstNow = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000);

/** (순수) 지금 밤 계산을 돌릴 차례인가 — KST 3시대 · 그날 아직 안 돌았을 때 */
export function signalRunDue(now: Date, lastDay: string): boolean {
  const k = kstNow(now);
  return k.getUTCHours() === SIGNAL_RUN_HOUR_KST && k.toISOString().slice(0, 10) !== lastDay;
}

async function tick(): Promise<void> {
  const now = new Date();
  if (!signalRunDue(now, lastRunDayKst)) return;
  lastRunDayKst = kstNow(now).toISOString().slice(0, 10);
  try {
    const r = await runProductSignalPass();
    if (r.ran && (r.rebuilt || r.cleared || r.failed)) console.log(`[product-signal] 밤 계산 — 다시 센 회사 ${r.rebuilt} · 지운 회사 ${r.cleared} · 실패 ${r.failed}`);
  } catch (err: any) {
    console.error('[product-signal] 밤 계산 실패(표가 없으면 DDL C133-DDL-2 확인):', err?.message);
  }
}

export function startProductSignalWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => { void tick(); }, WORKER_INTERVAL_MS);
  // 기동 직후 첫 채우기 — 방금 명단에 든 회사가 밤까지 빈 화면으로 기다리지 않게(행이 이미 있는 회사는 건드리지 않는다)
  setTimeout(() => {
    void runProductSignalPass({ onlyMissing: true }).catch((err: any) => console.error('[product-signal] 첫 채우기 실패:', err?.message));
  }, BOOT_FILL_DELAY_MS).unref?.();
  console.log('[product-signal] 워커 시작 — 매일 KST 3시대 · 열린 회사만 · 회사마다 60일 통째로 다시 셈');
}

export function stopProductSignalWorker(): void {
  if (workerTimer) { clearInterval(workerTimer); workerTimer = null; }
}
