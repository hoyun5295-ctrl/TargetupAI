/**
 * product-pairs.ts — 같이 산 상품 · 「A 사고 B 안 산 고객」 (★ 2026-11-21 C152 D · 설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §2-D)
 *
 * 상품 식별 = 키 하나가 상품 하나(이름을 정하는 표 keymap 한 곳):
 *   keymap(문 · 키 → 이름 하나) = ① 상품 신호 표에서 그 키의 가장 최근 이름(product-reco namedProductsSql)
 *     ② 신호 표에서 쓸 수 있는 이름을 얻지 못한 키(오늘 들어온 구매 · 이름이 빈 키) = 창 안 그 키의 구매 줄 중 이름이 비지 않은 가장 최근 줄 ③ 없으면 이름 없는 상품(뺀다).
 *   세는 쪽(one = 사람 · 상품) = 구매 줄의 상품은 keymap 의 이름 하나(같은 키의 줄은 전부 같은 상품 · 이름이 바뀐 한 상품이 두 이름의 쌍이 되지 않는다).
 *   빼는 쪽(「b 를 산 적이 있다」) = 추천 상품의 인정 규칙 그대로(RECO_PICK_SQL hit) = 줄에 적힌 구매 당시 이름이 b 이거나 줄의 키가 keymap 에서 b ·
 *     기간 제한 없음(추천 상품의 buys 와 같다). 넓게 인정한다 = 산 사람에게 다시 권하지 않는 쪽.
 * 사람 = 번호(같은 번호의 고객 행이 여럿이면 구매를 먼저 합친다 · 번호가 없으면 고객 id).
 * 창 = 상품 신호 보관 기간(60일 = 이름을 풀 수 있는 기간). 세기 = 명단 수(같은 문장).
 */
import { netPurchaseSql } from './cdp-order-revenue';
import { LEDGER_PURCHASES_SQL } from './two-door-purchase';
import { mallItemKeySql, mallItemsSql, ledgerProductKeySql } from './journey-product';
import { namedProductsSql } from './product-reco';
import {
  PRODUCT_SIGNAL_WINDOW_DAYS, PRODUCT_SIGNAL_KEEP_DAYS, SIGNAL_KEY_MAX, AUDIENCE_LIST_MAX,
  normNameSql, normName, kstDayAgoSql, kstDayStartSql, sendableCustomerSql, boundedRead, type AudienceList,
} from './product-signal';

/** 창 일수 = 상품 신호 보관 기간(이름을 풀 수 있는 기간) */
export const PAIR_WINDOW_DAYS = PRODUCT_SIGNAL_KEEP_DAYS;
/** 산 사람이 많은 상품 위 몇 개의 짝을 찾는가 */
export const PAIR_TOP = 10;
/** 상품마다 같이 산 상품 몇 개 */
export const PAIR_PER_TOP = 3;
/** 같이 산 사람이 이보다 적은 짝은 싣지 않는다 */
export const PAIR_MIN_BOTH = 3;
/** 한 번에 세는 짝 수 상한(화면 줄 수 = PAIR_TOP × PAIR_PER_TOP) */
export const PAIR_COUNT_MAX = PAIR_TOP * PAIR_PER_TOP;

// $2 = 상품 신호 창(30일) → 구매를 읽는 창 = 그 두 배(보관 기간)
const WIN = `($2::int * 2)`;
const PERSON = `COALESCE(NULLIF(TRIM(c.phone), ''), c.id::text)`;

/**
 * 구매 줄(고객 · 문 · 키 · 줄에 적힌 이름 own(정리된 꼴) · own_name(보이는 꼴) · 시각) — 자사몰 = 매출 반영된 결제 주문의 상품 줄 · 매장 = 구매 원장 행.
 *   RECO_PICK_SQL 의 buys 와 같은 조각(키 · 이름). 뒤 조건으로 창 또는 고객을 좁힌다.
 */
function buyLinesSql(mallWhere: string, ledgerWhere: string): string {
  return `SELECT b.customer_id, 'mall'::text AS door, LEFT(${mallItemKeySql('bi')}, ${SIGNAL_KEY_MAX}) AS key,
                 ${normNameSql(`bi->>'productName'`)} AS own, NULLIF(TRIM(bi->>'productName'), '') AS own_name, b.occurred_at AS at
            FROM cdp_events b, ${mallItemsSql('b')} bi
           WHERE b.company_id = $1::uuid AND b.customer_id IS NOT NULL AND ${netPurchaseSql('b')} AND b.occurred_at <= NOW()${mallWhere}
          UNION ALL
          SELECT bl.customer_id, 'ledger'::text AS door, LEFT(${ledgerProductKeySql('bl')}, ${SIGNAL_KEY_MAX}) AS key,
                 ${normNameSql('bl.product_name')} AS own, NULLIF(TRIM(bl.product_name), '') AS own_name, (bl.purchase_date AT TIME ZONE 'Asia/Seoul') AS at
            FROM ${LEDGER_PURCHASES_SQL} bl
           WHERE bl.company_id = $1::uuid AND bl.customer_id IS NOT NULL${ledgerWhere}`;
}

/**
 * 공통 머리($1 회사 · $2 상품 신호 창) — named(신호 표의 키별 이름) · wlines(창 안 구매 줄) · keymap(키 → 이름 하나) · one(사람 · 상품).
 *   세는 쪽과 빼는 쪽이 이 keymap 을 같이 쓴다.
 */
const PAIR_HEAD_SQL = `
  named AS (${namedProductsSql('$2::int')}),
  wlines AS (${buyLinesSql(
    ` AND b.occurred_at >= ${kstDayStartSql(kstDayAgoSql(`(${WIN} - 1)`))}`,
    ` AND bl.purchase_date IS NOT NULL AND bl.purchase_date >= ${kstDayAgoSql(`(${WIN} - 1)`)}`,
  )}),
  kfill AS (
    SELECT DISTINCT ON (l.door, l.key) l.door, l.key, l.own AS norm, l.own_name AS name
      FROM wlines l
     WHERE l.key IS NOT NULL AND l.own IS NOT NULL
     ORDER BY l.door, l.key, l.at DESC, l.own_name
  ),
  keymap AS (
    SELECT k.door, k.key, COALESCE(n.norm, f.norm) AS norm,
           CASE WHEN n.norm IS NOT NULL THEN n.name ELSE f.name END AS name,
           COALESCE(n.orders, 0) AS orders, COALESCE(n.views, 0) AS views
      FROM (SELECT door, product_key AS key FROM named UNION SELECT door, key FROM wlines WHERE key IS NOT NULL) k
      LEFT JOIN named n ON n.door = k.door AND n.product_key = k.key AND n.norm IS NOT NULL
      LEFT JOIN kfill f ON f.door = k.door AND f.key = k.key
     WHERE COALESCE(n.norm, f.norm) IS NOT NULL
  ),
  one AS (
    SELECT DISTINCT ${PERSON} AS person, m.norm AS prod
      FROM wlines l
      JOIN keymap m ON m.door = l.door AND m.key = l.key
      JOIN customers c ON c.id = l.customer_id AND c.company_id = $1::uuid
  )`;

/**
 * 같이 산 상품($1 회사 · $2 상품 신호 창 · $3 위 몇 상품 · $4 상품마다 몇 개 · $5 최소 겹침) — 줄 = a · a_buyers · b · both(보이는 이름).
 *   top = 산 사람이 많은 상품 · pair = 그 상품을 산 사람이 같이 산 다른 상품 · 보이는 이름 = 그 정리된 이름으로 풀리는 이름 중 구매 · 조회가 많은 것.
 */
export const PAIRS_SQL = `
  WITH ${PAIR_HEAD_SQL},
  top AS (SELECT o.prod, COUNT(*)::int AS buyers FROM one o GROUP BY o.prod ORDER BY COUNT(*) DESC, o.prod LIMIT $3::int),
  pair AS (
    SELECT t.prod AS a, t.buyers, o2.prod AS b, COUNT(*)::int AS both
      FROM top t
      JOIN one o1 ON o1.prod = t.prod
      JOIN one o2 ON o2.person = o1.person AND o2.prod <> t.prod
     GROUP BY t.prod, t.buyers, o2.prod
    HAVING COUNT(*) >= $5::int
  ),
  ranked AS (SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.a ORDER BY p.both DESC, p.b) AS rn FROM pair p),
  disp AS (SELECT m.norm, (array_agg(m.name ORDER BY m.orders DESC, m.views DESC, m.name))[1] AS name FROM keymap m GROUP BY m.norm)
  SELECT da.name AS a, r.buyers AS a_buyers, db.name AS b, r.both
    FROM ranked r
    JOIN disp da ON da.norm = r.a
    JOIN disp db ON db.norm = r.b
   WHERE r.rn <= $4::int
   ORDER BY r.buyers DESC, r.a, r.both DESC, r.b`;

export interface BoughtTogether { a: string; aBuyers: number; b: string; both: number }

export async function listBoughtTogether(companyId: string): Promise<BoughtTogether[]> {
  const rows = await boundedRead(PAIRS_SQL, [companyId, PRODUCT_SIGNAL_WINDOW_DAYS, PAIR_TOP, PAIR_PER_TOP, PAIR_MIN_BOTH]);
  return rows.map((x: any) => ({ a: String(x.a), aBuyers: Number(x.a_buyers) || 0, b: String(x.b), both: Number(x.both) || 0 }));
}

/**
 * 짝마다 「a 를 샀고(창 안 · 세는 쪽) b 를 산 적이 없는(전 기간 · 빼는 쪽)」 수신 가능 고객 — 칸 = ord · customer_id · phone · name.
 *   $1 회사 · $2 상품 신호 창 · $3 a 들 · $4 b 들(정리된 이름 · 같은 길이 · 차례가 짝).
 *   차례: abuy(a 를 산 사람) → acust(그 번호의 고객 행 id 전부) → ever(전 기간 구매는 그 id 로만 읽는다) → bbuy(b 를 산 적 있는 사람)
 *        → 그 번호의 수신 가능 고객 행 하나(번호 하나 = 한 사람 · 대표 = 고객 id 순).
 */
export function boughtNotBoughtSql(sendable: string): string {
  return `WITH ${PAIR_HEAD_SQL},
    pairs AS (SELECT t.a, t.b, t.ord::int AS ord FROM unnest($3::text[], $4::text[]) WITH ORDINALITY AS t(a, b, ord)),
    abuy AS (SELECT DISTINCT p.ord, o.person FROM pairs p JOIN one o ON o.prod = p.a),
    acust AS (
      SELECT c.id, ${PERSON} AS person
        FROM customers c
       WHERE c.company_id = $1::uuid AND ${PERSON} IN (SELECT person FROM abuy)
    ),
    ever AS (${buyLinesSql(' AND b.customer_id IN (SELECT id FROM acust)', ' AND bl.customer_id IN (SELECT id FROM acust)')}),
    bbuy AS (
      SELECT DISTINCT p.ord, ac.person
        FROM ever e
        JOIN acust ac ON ac.id = e.customer_id
        JOIN pairs p ON e.own = p.b OR EXISTS (SELECT 1 FROM keymap m WHERE m.door = e.door AND m.key = e.key AND m.norm = p.b)
    )
    SELECT DISTINCT ON (a.ord, TRIM(c.phone)) a.ord, c.id AS customer_id, TRIM(c.phone) AS phone, c.name
      FROM abuy a
      JOIN customers c ON c.company_id = $1::uuid AND NULLIF(TRIM(c.phone), '') IS NOT NULL AND TRIM(c.phone) = a.person
     WHERE ${sendable}
       AND NOT EXISTS (SELECT 1 FROM bbuy x WHERE x.ord = a.ord AND x.person = a.person)
     ORDER BY a.ord, TRIM(c.phone), c.id`;
}

const normPair = (p: { a?: unknown; b?: unknown }): { a: string; b: string } | null => {
  const a = normName(p?.a);
  const b = normName(p?.b);
  return a && b && a !== b ? { a, b } : null;
};

/** 짝마다 사고 안 산 고객 수(입력 차례 그대로 · 읽을 수 없는 짝 = 0) */
export async function countBoughtNotBought(
  companyId: string, viewerUserId: string | null | undefined, pairs: ReadonlyArray<{ a?: unknown; b?: unknown }>,
): Promise<number[]> {
  const input = pairs.slice(0, PAIR_COUNT_MAX);
  const out = input.map(() => 0);
  const clean = input.map((p, i) => ({ i, n: normPair(p) })).filter((x): x is { i: number; n: { a: string; b: string } } => x.n !== null);
  if (clean.length === 0) return out;
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  const rows = await boundedRead(
    `SELECT x.ord, COUNT(*)::int AS n FROM (${boughtNotBoughtSql(sendable)}) x GROUP BY x.ord`,
    [companyId, PRODUCT_SIGNAL_WINDOW_DAYS, clean.map((x) => x.n.a), clean.map((x) => x.n.b)],
  );
  for (const r of rows) {
    const hit = clean[Number(r.ord) - 1];
    if (hit) out[hit.i] = Number(r.n) || 0;
  }
  return out;
}

/** 한 짝의 사고 안 산 고객 명단(지금 다시 센다 · 세는 길과 같은 문장) */
export async function listBoughtNotBought(companyId: string, viewerUserId: string | null | undefined, a: unknown, b: unknown): Promise<AudienceList> {
  const n = normPair({ a, b });
  if (!n) return { recipients: [], total: 0, truncated: false };
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  const rows = await boundedRead(boughtNotBoughtSql(sendable), [companyId, PRODUCT_SIGNAL_WINDOW_DAYS, [n.a], [n.b]]);
  const all = rows.map((x: any) => ({ phone: String(x.phone || ''), name: String(x.name || '') })).filter((x: { phone: string }) => x.phone !== '');
  return { recipients: all.slice(0, AUDIENCE_LIST_MAX), total: all.length, truncated: all.length > AUDIENCE_LIST_MAX };
}
