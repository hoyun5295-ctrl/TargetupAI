/**
 * journey-product.ts — 상품 재구매 여정 CT (★ 2026-09-30 여정 V2 3차 · 설계서 §6)
 *
 * 한 곳에서 정하는 것
 *   ①상품 키 규칙 — 자사몰 주문 상품 = productId(없으면 productName) · 매장 원장 = product_code(없으면 product_name).
 *     진입(워커) · 목표(실행기) · 상품 목록(화면) · 사용 기간 제안이 **같은 규칙**을 쓴다(SQL 조각 + JS 판정 한 벌 · parity 테스트).
 *   ②고를 수 있는 상품 = 그 회사 **현역 문**에서 최근 관측된 목록뿐(직접 입력 없음 · 정답표 없음).
 *   ③사용 기간 제안 = 같은 고객이 같은 상품을 다시 산 간격의 중앙값 + 표본 수(담당자가 확정 · 지어내지 않는다).
 *   ④진입 자격 = 배치 행 중 고른 상품이 든 구매만(첫 구매 · 휴면 복귀 자격 필터와 같은 자리 · 커서 전진 규약 불변).
 *
 * ⛔ 문이 바뀌면 키가 달라진다(자사몰 productId ↔ 매장 상품 코드). 저장한 문과 지금 문이 다르면 진입하지 않고 멈춘다(조용한 0건 금지).
 */
import { query } from '../config/database';
import { isMallPurchaseDoorActive } from './journey-purchase-ledger';
import { JourneyInputError } from './journey-step-limits';
import type { CdpCursorBatch, CdpEventRow } from './journey-cdp-cursor';

export const PRODUCT_TRIGGER_EVENT = 'purchase.product';
export type PurchaseDoor = 'mall' | 'ledger';

/** 한 여정에 고를 수 있는 상품 수 상한. */
export const MAX_PRODUCT_KEYS = 30;
/** 상품 목록 = 최근 이 기간에 팔린 상품(관측). */
export const PRODUCT_OBSERVE_DAYS = 180;
/** 사용 기간 제안에 쓰는 재구매 이력 기간. */
export const PRODUCT_PERIOD_LOOKBACK_DAYS = 730;
/** 이 수보다 재구매 간격 표본이 적으면 중앙값을 권하지 않는다(담당자가 정한다). */
export const MIN_PERIOD_SAMPLE = 5;
const PRODUCT_LIST_LIMIT = 300;

// ── ① 상품 키 규칙(SQL · JS 한 벌) ──

/** 자사몰 주문 상품 한 줄(jsonb) → 상품 키 SQL. */
export function mallItemKeySql(item: string): string {
  return `COALESCE(NULLIF(TRIM(${item}->>'productId'), ''), NULLIF(TRIM(${item}->>'productName'), ''))`;
}
/** 매장 원장 행 → 상품 키 SQL. */
export function ledgerProductKeySql(alias: string): string {
  return `COALESCE(NULLIF(TRIM(${alias}.product_code), ''), NULLIF(TRIM(${alias}.product_name), ''))`;
}
/** 주문 이벤트의 상품 목록(배열이 아니면 빈 배열 · items_omitted 주문은 상품을 모른다). */
export function mallItemsSql(eventAlias: string): string {
  return `jsonb_array_elements(CASE WHEN jsonb_typeof(${eventAlias}.properties->'items') = 'array' THEN ${eventAlias}.properties->'items' ELSE '[]'::jsonb END)`;
}

const trimOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
export function mallItemKey(item: any): string | null {
  return trimOrNull(item?.productId) ?? trimOrNull(item?.productName);
}
export function ledgerProductKey(code: unknown, name: unknown): string | null {
  return trimOrNull(code) ?? trimOrNull(name);
}

/** 구매 행(자사몰 이벤트 properties 또는 원장 행 properties)에서 고른 상품이 있으면 그 상품. */
export function productMatchInRow(props: any, keys: Set<string>): { key: string; name: string } | null {
  if (!props || typeof props !== 'object') return null;
  if (Array.isArray(props.items)) {
    for (const it of props.items) {
      const k = mallItemKey(it);
      if (k && keys.has(k)) return { key: k, name: trimOrNull(it?.productName) ?? k };
    }
    return null;
  }
  const k = ledgerProductKey(props.product_code, props.product_name);
  if (k && keys.has(k)) return { key: k, name: trimOrNull(props.product_name) ?? k };
  return null;
}

// ── 필터 검증(저장 경로) ──

export interface ProductFilters {
  product_keys: string[];
  product_names: string[];
  door: PurchaseDoor;
}

/** 상품 재구매 여정의 대상 필터 검증 — 상품 0개 · 문 없음 = 거부(만들어도 영영 0건). */
export function normalizeProductFilters(raw: Record<string, any> | null | undefined): ProductFilters {
  const f = raw || {};
  const keys: string[] = [];
  const names: string[] = [];
  const rawKeys: unknown[] = Array.isArray(f.product_keys) ? f.product_keys : [];
  const rawNames: unknown[] = Array.isArray(f.product_names) ? f.product_names : [];
  rawKeys.forEach((k, i) => {
    const key = trimOrNull(k);
    if (!key || key.length > 200 || keys.includes(key)) return;
    keys.push(key);
    names.push((trimOrNull(rawNames[i]) ?? key).slice(0, 100));
  });
  if (keys.length === 0) throw new JourneyInputError('상품 재구매 여정은 상품을 하나 이상 골라야 해요.');
  if (keys.length > MAX_PRODUCT_KEYS) throw new JourneyInputError(`상품은 ${MAX_PRODUCT_KEYS}개까지 고를 수 있어요.`);
  const door = f.door === 'mall' || f.door === 'ledger' ? f.door : null;
  if (!door) throw new JourneyInputError('상품을 어디서 산 구매로 볼지 정해지지 않았어요. 상품을 다시 골라 주세요.');
  return { product_keys: keys, product_names: names, door };
}

// ── ② 현역 문 · 관측 상품 ──

export async function currentPurchaseDoor(companyId: string): Promise<PurchaseDoor> {
  return (await isMallPurchaseDoorActive(companyId)) ? 'mall' : 'ledger';
}

export interface ObservedProduct {
  key: string;
  name: string;
  buyers: number;
  orders: number;
  lastAt: string | null;
}

export async function listObservedProducts(companyId: string, door: PurchaseDoor): Promise<{
  products: ObservedProduct[];
  /** 상품 목록 없이 들어온 주문(너무 커서 상품이 빠진 주문) — 이 주문은 판정에서 빠진다. */
  omittedOrders: number;
  truncated: boolean;
}> {
  if (door === 'mall') {
    const r = await query(
      `SELECT x.key, MAX(x.name) AS name, COUNT(DISTINCT x.customer_id)::int AS buyers, COUNT(*)::int AS orders, MAX(x.occurred_at)::text AS last_at
         FROM (
           SELECT ${mallItemKeySql('it')} AS key, NULLIF(TRIM(it->>'productName'), '') AS name, e.customer_id, e.occurred_at
             FROM cdp_events e, ${mallItemsSql('e')} it
            WHERE e.company_id = $1::uuid AND e.event_name = 'purchase'
              AND e.occurred_at >= NOW() - ($2 || ' days')::interval
         ) x
        WHERE x.key IS NOT NULL
        GROUP BY x.key
        ORDER BY buyers DESC, orders DESC, x.key ASC
        LIMIT $3::int`,
      [companyId, String(PRODUCT_OBSERVE_DAYS), PRODUCT_LIST_LIMIT],
    );
    const om = await query(
      `SELECT COUNT(*)::int AS n FROM cdp_events
        WHERE company_id = $1::uuid AND event_name = 'purchase'
          AND occurred_at >= NOW() - ($2 || ' days')::interval
          AND properties->>'items_omitted' = 'true'`,
      [companyId, String(PRODUCT_OBSERVE_DAYS)],
    );
    return {
      products: r.rows.map((x: any) => ({ key: String(x.key), name: String(x.name || x.key), buyers: Number(x.buyers || 0), orders: Number(x.orders || 0), lastAt: x.last_at || null })),
      omittedOrders: Number(om.rows[0]?.n || 0),
      truncated: r.rows.length >= PRODUCT_LIST_LIMIT,
    };
  }
  const r = await query(
    `SELECT x.key, MAX(x.name) AS name, COUNT(DISTINCT x.customer_id)::int AS buyers, COUNT(*)::int AS orders, MAX(x.purchase_date)::text AS last_at
       FROM (
         SELECT ${ledgerProductKeySql('p')} AS key, NULLIF(TRIM(p.product_name), '') AS name, p.customer_id, p.purchase_date
           FROM purchases p
          WHERE p.company_id = $1::uuid AND p.customer_id IS NOT NULL AND p.purchase_date IS NOT NULL
            AND p.purchase_date >= ((NOW() AT TIME ZONE 'Asia/Seoul') - ($2 || ' days')::interval)
       ) x
      WHERE x.key IS NOT NULL
      GROUP BY x.key
      ORDER BY buyers DESC, orders DESC, x.key ASC
      LIMIT $3::int`,
    [companyId, String(PRODUCT_OBSERVE_DAYS), PRODUCT_LIST_LIMIT],
  );
  return {
    products: r.rows.map((x: any) => ({ key: String(x.key), name: String(x.name || x.key), buyers: Number(x.buyers || 0), orders: Number(x.orders || 0), lastAt: x.last_at || null })),
    omittedOrders: 0,
    truncated: r.rows.length >= PRODUCT_LIST_LIMIT,
  };
}

// ── ③ 사용 기간 제안 ──

export async function suggestUsagePeriod(companyId: string, door: PurchaseDoor, keys: string[]): Promise<{
  medianDays: number | null;
  sample: number;
  customers: number;
}> {
  const clean = [...new Set(keys.map((k) => trimOrNull(k)).filter(Boolean) as string[])].slice(0, MAX_PRODUCT_KEYS);
  if (clean.length === 0) return { medianDays: null, sample: 0, customers: 0 };
  const buys = door === 'mall'
    ? `SELECT DISTINCT e.customer_id, (e.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS d
         FROM cdp_events e, ${mallItemsSql('e')} it
        WHERE e.company_id = $1::uuid AND e.event_name = 'purchase' AND e.customer_id IS NOT NULL
          AND e.occurred_at >= NOW() - ($3 || ' days')::interval
          AND ${mallItemKeySql('it')} = ANY($2::text[])`
    : `SELECT DISTINCT p.customer_id, p.purchase_date::date AS d
         FROM purchases p
        WHERE p.company_id = $1::uuid AND p.customer_id IS NOT NULL AND p.purchase_date IS NOT NULL
          AND p.purchase_date >= ((NOW() AT TIME ZONE 'Asia/Seoul') - ($3 || ' days')::interval)
          AND ${ledgerProductKeySql('p')} = ANY($2::text[])`;
  const r = await query(
    `WITH buys AS (${buys}),
          gaps AS (SELECT customer_id, d - LAG(d) OVER (PARTITION BY customer_id ORDER BY d) AS gap FROM buys)
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS median,
            COUNT(*)::int AS sample,
            COUNT(DISTINCT customer_id)::int AS customers
       FROM gaps
      WHERE gap IS NOT NULL AND gap > 0`,
    [companyId, clean, String(PRODUCT_PERIOD_LOOKBACK_DAYS)],
  );
  const sample = Number(r.rows[0]?.sample || 0);
  const med = r.rows[0]?.median;
  return {
    medianDays: sample >= MIN_PERIOD_SAMPLE && med != null ? Math.max(1, Math.round(Number(med))) : null,
    sample,
    customers: Number(r.rows[0]?.customers || 0),
  };
}

// ── ④ 진입 자격(워커) ──

/**
 * 배치에서 고른 상품이 든 구매만 남긴다 — batch.ids 만 좁힌다(커서는 자격과 무관하게 전진 · 첫 구매 자격 필터와 같은 규약).
 * 진입 변수(entry_event_properties)는 **고른 상품이 든 행**의 properties + 상품 이름(알림톡 #{상품명} 등이 그 상품을 가리키게).
 */
export function qualifyProductBatch(batch: CdpCursorBatch, rows: CdpEventRow[], productKeys: string[]): void {
  const keys = new Set(productKeys);
  const hit = new Map<string, { row: CdpEventRow; key: string; name: string }>();
  for (const r of rows) {
    if (hit.has(r.customerId)) continue;
    const m = productMatchInRow(r.properties, keys);
    if (m) hit.set(r.customerId, { row: r, ...m });
  }
  batch.ids = batch.ids.filter((id) => hit.has(id));
  for (const id of batch.ids) {
    const h = hit.get(id)!;
    const base = (h.row.properties && typeof h.row.properties === 'object') ? h.row.properties : {};
    batch.propertiesByCustomer[id] = { ...base, product_name: h.name, product_key: h.key };
    if (batch.eventIdByCustomer) batch.eventIdByCustomer[id] = h.row.eventId;
  }
}

// ── 목표(실행기) ──

/**
 * 진입 뒤 같은 상품을 다시 샀는가 — 두 문 OR(문을 옮긴 고객도 놓치지 않는다 · 키 규칙은 위 한 벌).
 * 파라미터: $1 회사 · $2 고객 · $3 진입 시각(timestamptz) · $4 상품 키 text[]. 원장 시각은 KST naive 규약.
 */
export const PRODUCT_REPURCHASE_SINCE_ENTRY_SQL = `SELECT 1
  WHERE EXISTS (
    SELECT 1 FROM cdp_events e, ${mallItemsSql('e')} it
     WHERE e.company_id = $1::uuid AND e.customer_id = $2::uuid
       AND e.event_name = 'purchase' AND e.occurred_at > $3::timestamptz
       AND ${mallItemKeySql('it')} = ANY($4::text[])
  )
  OR EXISTS (
    SELECT 1 FROM purchases p
     WHERE p.company_id = $1::uuid AND p.customer_id = $2::uuid
       AND p.purchase_date IS NOT NULL
       AND p.purchase_date > ($3::timestamptz AT TIME ZONE 'Asia/Seoul')
       AND ${ledgerProductKeySql('p')} = ANY($4::text[])
  )`;

// ── ⑤ 구매 리듬(★ 2026-10-09 고객 관계 지도 · AI 진단 · 설계서 docs/2026-10-09-journey-crm-map-design.md §5) ──
//   회사 **현역 문 하나**에서만 센다(두 문을 합치면 같은 구매가 두 번 잡혀 간격이 0 으로 무너진다 · 회의론자 D6).
//   하루 단위(같은 날 여러 건 = 1) · 730일 · 고객별 차례(n) · 직전 구매와의 간격(일).

export interface PurchaseRhythm {
  door: PurchaseDoor;
  buyers: number;
  repeaters: number;
  /** 첫 구매 → 두 번째 구매 간격(일). 표본 미달이면 값 null(표본 수는 그대로). */
  firstToSecond: { p25: number | null; p50: number | null; p75: number | null; sample: number };
  /** 모든 재구매 간격(일). */
  gap: { p50: number | null; p75: number | null; p90: number | null; sample: number };
}

function rhythmBuysSql(door: PurchaseDoor): string {
  return door === 'mall'
    ? `SELECT DISTINCT e.customer_id, (e.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS d
         FROM cdp_events e
        WHERE e.company_id = $1::uuid AND e.event_name = 'purchase' AND e.customer_id IS NOT NULL
          AND e.occurred_at >= NOW() - ($2 || ' days')::interval`
    : `SELECT DISTINCT p.customer_id, p.purchase_date::date AS d
         FROM purchases p
        WHERE p.company_id = $1::uuid AND p.customer_id IS NOT NULL AND p.purchase_date IS NOT NULL
          AND p.purchase_date >= ((NOW() AT TIME ZONE 'Asia/Seoul') - ($2 || ' days')::interval)`;
}

const roundOrNull = (v: unknown, ok: boolean): number | null => (ok && v != null && Number.isFinite(Number(v)) ? Math.max(1, Math.round(Number(v))) : null);

export async function loadPurchaseRhythm(companyId: string, door: PurchaseDoor): Promise<PurchaseRhythm> {
  const r = await query(
    `WITH buys AS (${rhythmBuysSql(door)}),
          seq AS (
            SELECT customer_id, ROW_NUMBER() OVER w AS n, d - LAG(d) OVER w AS gap
              FROM buys WINDOW w AS (PARTITION BY customer_id ORDER BY d)
          )
     SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY gap) FILTER (WHERE n = 2) AS f2s_p25,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY gap) FILTER (WHERE n = 2) AS f2s_p50,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY gap) FILTER (WHERE n = 2) AS f2s_p75,
            COUNT(*) FILTER (WHERE n = 2)::int AS f2s_n,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY gap) FILTER (WHERE n >= 2) AS gap_p50,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY gap) FILTER (WHERE n >= 2) AS gap_p75,
            percentile_cont(0.9)  WITHIN GROUP (ORDER BY gap) FILTER (WHERE n >= 2) AS gap_p90,
            COUNT(*) FILTER (WHERE n >= 2)::int AS gap_n,
            COUNT(DISTINCT customer_id)::int AS buyers,
            COUNT(DISTINCT customer_id) FILTER (WHERE n >= 2)::int AS repeaters
       FROM seq`,
    [companyId, String(PRODUCT_PERIOD_LOOKBACK_DAYS)],
  );
  const x = r.rows[0] || {};
  const f2sN = Number(x.f2s_n || 0);
  const gapN = Number(x.gap_n || 0);
  const f2sOk = f2sN >= MIN_PERIOD_SAMPLE;
  const gapOk = gapN >= MIN_PERIOD_SAMPLE;
  return {
    door,
    buyers: Number(x.buyers || 0),
    repeaters: Number(x.repeaters || 0),
    firstToSecond: { p25: roundOrNull(x.f2s_p25, f2sOk), p50: roundOrNull(x.f2s_p50, f2sOk), p75: roundOrNull(x.f2s_p75, f2sOk), sample: f2sN },
    gap: { p50: roundOrNull(x.gap_p50, gapOk), p75: roundOrNull(x.gap_p75, gapOk), p90: roundOrNull(x.gap_p90, gapOk), sample: gapN },
  };
}

export interface ProductCycle { key: string; name: string; buyers: number; medianDays: number; sample: number }

/** 다시 많이 사는 상품 — 관측 목록 상위에서 사용 기간 중앙값이 잡히는 것만(같은 CT · 같은 키 규칙 · 새 SQL 0 · 회의론자 D4). */
export async function loadProductCycles(companyId: string, door: PurchaseDoor, limit = 3, scan = 8): Promise<ProductCycle[]> {
  const { products } = await listObservedProducts(companyId, door);
  const out: ProductCycle[] = [];
  for (const p of products.slice(0, scan)) {
    const s = await suggestUsagePeriod(companyId, door, [p.key]);
    if (s.medianDays != null) out.push({ key: p.key, name: p.name, buyers: p.buyers, medianDays: s.medianDays, sample: s.sample });
  }
  return out.sort((a, b) => b.sample - a.sample).slice(0, limit);
}
