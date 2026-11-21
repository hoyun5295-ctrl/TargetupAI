/**
 * product-reco.ts — 고객별 추천 상품 CT (★ 2026-11-13 C133 F2 ① · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-4)
 *
 * 한 원칙: 나갈 수 있는 것은 담당자가 본 후보 집합뿐이고, 고르는 규칙은 예측이 아니라 설명 가능한 순서다.
 *
 * 자리 문법 · 자리 판정 · 렌더의 두 걸음 = reco-slot.ts(순수). 이 파일 = DB 를 읽는 둘.
 *   ① 고르기 pickRecoIndex — 1) 최근 30일에 봤고 그 뒤 안 산 후보 중 가장 최근에 본 것 2) 후보 순서에서 안 산 첫 후보 3) 없음(대체 문장).
 *      「산 것」 = 자사몰 + 매장 두 문 · 같은 (문, 키) 또는 같은 이름. 최근 30일 뿌리 표에 관측이 없는 후보는 건너뛴다(끊긴 상품).
 *      읽기에 실패하면 대체 문장(발송을 막지 않는다 · 대체 문장도 검사한 판).
 *   ② 후보 제안 suggestRecoCandidates — 창이 전부 보여 주고 담당자가 고른다.
 */
import { query } from '../config/database';
import { netPurchaseSql } from './cdp-order-revenue';
import { LEDGER_PURCHASES_SQL } from './two-door-purchase';
import { mallItemKeySql, mallItemsSql, ledgerProductKeySql } from './journey-product';
import { recoTextIssue, type RecoSlot } from './reco-slot';
import { v3Live } from './v3-stage';
import { signalTextOf } from './product-signal-text';
import { RECO_MAX_CANDIDATES } from './reco-slot';
import {
  PRODUCT_SIGNAL_WINDOW_DAYS, SIGNAL_KEY_MAX, SIGNAL_VIEW_EVENT,
  signalItemsSql, signalItemKeySql, signalItemNameSql, normNameSql, normName, kstDayAgoSql, kstDayStartSql,
} from './product-signal';

/**
 * 상품마다 이름 하나 + 최근 창의 관측($1 회사 · win = 창 일수 식) — **후보 제안과 고객별 고르기가 같이 쓰는 이름 해석**(Codex 구현 1R #5 · #6).
 *   이름 = 보관 기간(창의 두 배 = 뿌리 표가 두는 기간) 안에서 그 (문, 키)에 적힌 가장 최근의 이름. 번호만 싣는 조회가 이어지는 상품도
 *   앞서 적힌 이름으로 읽힌다(최근 행의 이름이 비어도 끊긴 상품이 아니다). seen = 최근 창의 조회 + 장바구니 + 구매(0 = 끊긴 상품).
 *   칸 = door · product_key · name · norm(정리된 이름) · orders · views · seen.
 */
export function namedProductsSql(win: string): string {   // ★ C152 D 같이 산 상품(product-pairs keymap)도 이 이름 해석을 쓴다
  const latestName = `(array_agg(s.product_name ORDER BY s.day DESC) FILTER (WHERE s.product_name IS NOT NULL))[1]`;
  const inWindow = `s.day > ${kstDayAgoSql(win)}`;
  return `SELECT s.door, s.product_key, ${latestName} AS name, ${normNameSql(latestName)} AS norm,
         COALESCE(SUM(s.orders) FILTER (WHERE ${inWindow}), 0)::int AS orders,
         COALESCE(SUM(s.views) FILTER (WHERE ${inWindow}), 0)::int AS views,
         COALESCE(SUM(s.views + s.carts + s.orders) FILTER (WHERE ${inWindow}), 0)::int AS seen
    FROM product_signal_daily s
   WHERE s.company_id = $1::uuid AND s.day > ${kstDayAgoSql(`(${win} * 2)`)}
   GROUP BY s.door, s.product_key`;
}

/**
 * 그 고객에게 나갈 후보 번호($1 회사 · $2 고객 · $3 후보 이름(정리된 꼴 · 순서대로) · $4 창 일수) — 한 줄 · ord = 1부터 · NULL = 없음(대체 문장).
 *   alive = 이름이 후보와 같고(namedProductsSql 의 이름 해석) 최근 창에 관측이 있는 상품의 (문, 키) · viewed = 그 고객이 창 안에 본 후보의 마지막 조회 시각 ·
 *   buys = 그 고객의 구매 줄(자사몰 결제 주문의 상품 줄 + 매장 원장) · hit = 후보마다 맞는 구매(같은 이름 또는 같은 문의 같은 키).
 *   「본 뒤 안 삼」 = 자사몰은 마지막 조회 뒤 시각 · 매장 원장은 조회한 KST 날 포함 그 뒤(원장은 날짜만 = 상품 반응 명단과 같은 규칙).
 */
export const RECO_PICK_SQL = `
  WITH cand AS (
    SELECT t.name, t.ord::int AS ord FROM unnest($3::text[]) WITH ORDINALITY AS t(name, ord)
  ),
  alive AS (
    SELECT c.ord, c.name, n.door, n.product_key
      FROM cand c
      JOIN (${namedProductsSql('$4::int')}) n ON n.norm = c.name AND n.seen > 0
  ),
  live AS (SELECT DISTINCT ord, name FROM alive),
  viewed AS (
    SELECT l.ord, MAX(e.occurred_at) AS last_view
      FROM cdp_events e, ${signalItemsSql('e')} it,
           LATERAL (SELECT ${signalItemKeySql('it')} AS key, ${normNameSql(signalItemNameSql('it'))} AS name) k,
           live l
     WHERE e.customer_id = $2::uuid AND e.company_id = $1::uuid AND e.event_name = '${SIGNAL_VIEW_EVENT}'
       AND e.occurred_at >= ${kstDayStartSql(kstDayAgoSql('($4::int - 1)'))} AND e.occurred_at <= NOW()
       AND (k.name = l.name OR EXISTS (SELECT 1 FROM alive a WHERE a.ord = l.ord AND a.door = 'mall' AND a.product_key = k.key))
     GROUP BY l.ord
  ),
  buys AS (
    SELECT 'mall'::text AS door, b.occurred_at AS at, NULL::date AS day,
           LEFT(${mallItemKeySql('bi')}, ${SIGNAL_KEY_MAX}) AS key, ${normNameSql(`bi->>'productName'`)} AS name
      FROM cdp_events b, ${mallItemsSql('b')} bi
     WHERE b.customer_id = $2::uuid AND b.company_id = $1::uuid AND ${netPurchaseSql('b')}
    UNION ALL
    SELECT 'ledger'::text AS door, NULL::timestamptz AS at, bl.purchase_date::date AS day,
           LEFT(${ledgerProductKeySql('bl')}, ${SIGNAL_KEY_MAX}) AS key, ${normNameSql('bl.product_name')} AS name
      FROM ${LEDGER_PURCHASES_SQL} bl
     WHERE bl.customer_id = $2::uuid AND bl.company_id = $1::uuid
  ),
  hit AS (
    SELECT l.ord, y.door, y.at, y.day
      FROM live l
      JOIN buys y ON y.name = l.name OR EXISTS (SELECT 1 FROM alive a WHERE a.ord = l.ord AND a.door = y.door AND a.product_key = y.key)
  )
  SELECT COALESCE(
    (SELECT v.ord FROM viewed v
      WHERE NOT EXISTS (
        SELECT 1 FROM hit h
         WHERE h.ord = v.ord
           AND ((h.door = 'mall' AND h.at > v.last_view)
             OR (h.door = 'ledger' AND h.day >= (v.last_view AT TIME ZONE 'Asia/Seoul')::date)))
      ORDER BY v.last_view DESC, v.ord LIMIT 1),
    (SELECT l.ord FROM live l WHERE NOT EXISTS (SELECT 1 FROM hit h WHERE h.ord = l.ord) ORDER BY l.ord LIMIT 1)
  ) AS ord`;

/**
 * 그 고객에게 나갈 후보의 자리(0부터) · null = 대체 문장.
 *   고객을 모르거나(표본 없음) 읽지 못하면 null — 발송을 막지 않는다(대체 문장도 담당자가 쓰고 검사를 지난 판이다).
 */
export async function pickRecoIndex(companyId: string, customerId: string | null | undefined, names: readonly string[]): Promise<number | null> {
  if (!customerId || names.length === 0) return null;
  try {
    const r = await query(RECO_PICK_SQL, [companyId, customerId, names.map((n) => normName(n) ?? ''), PRODUCT_SIGNAL_WINDOW_DAYS]);
    const ord = r.rows[0]?.ord;
    const i = ord === null || ord === undefined ? -1 : Number(ord) - 1;
    return i >= 0 && i < names.length ? i : null;
  } catch (err: any) {
    console.warn('[product-reco] 고르기 실패 → 대체 문장:', err?.message || err);
    return null;
  }
}

/**
 * 렌더가 자리에 넣을 글자 — recoIndex 를 주면 그 판으로 강제(검사 · 미리보기 · 0 ~ 후보 수 = 대체 문장) · 안 주면 그 고객으로 고른다.
 *   범위 밖 번호 = 대체 문장.
 */
export async function recoTextFor(slot: RecoSlot, o: { companyId: string; customerId: string | null | undefined; recoIndex?: number }): Promise<string> {
  const i = o.recoIndex !== undefined ? o.recoIndex : await pickRecoIndex(o.companyId, o.customerId, slot.names);
  return i !== null && Number.isInteger(i) && i >= 0 && i < slot.names.length ? slot.names[i] : slot.fallback;
}

/** 후보 제안 줄 수 — 창이 전부 보여 준다(담당자가 그 안에서 고른다) */
export const RECO_SUGGEST_LIMIT = 30;
/** ponytail: 제안은 판매 · 조회 위 이 줄 수까지만 읽고 쓸 수 없는 이름을 뺀 뒤 위 30 을 준다(응답 크기 한도). 위 500 이름의 대부분이 쓸 수 없는 이름인 회사가 생기면 SQL 에서 먼저 거른다. */
const RECO_SUGGEST_SCAN = 500;

/**
 * 후보 제안($1 회사 · $2 창 일수 · $3 읽을 줄 수) — 이름이 같은 상품(두 문 · 번호가 여럿)은 한 줄로 합치고 **합친 뒤에** 판매 · 조회 위 순으로 줄 세운다.
 *   조회가 없는 매장 상품도 판매로 줄에 선다(옛: 조회 위 100 상품 목록을 다시 줄 세워 조회 없는 판매 상위가 빠졌다 · Codex 구현 1R #6).
 */
export const RECO_SUGGEST_SQL = `
  SELECT (array_agg(n.name ORDER BY n.orders DESC, n.views DESC, n.name))[1] AS name
    FROM (${namedProductsSql('$2::int')}) n
   WHERE n.norm IS NOT NULL AND n.seen > 0
   GROUP BY n.norm
   ORDER BY SUM(n.orders) DESC, SUM(n.views) DESC, n.norm
   LIMIT $3::int`;

/**
 * 시스템 제안 — 최근 30일 뿌리 표의 상품 이름을 판매 · 조회 위 순으로(이름이 같은 두 문의 상품은 한 줄 · 숫자는 싣지 않는다).
 *   후보로 쓸 수 없는 이름(금지 글자 · 보낼 수 없는 글자 = 자리 판정과 같은 함수)은 빼고 준다.
 */
export async function suggestRecoCandidates(companyId: string): Promise<string[]> {
  const r = await query(RECO_SUGGEST_SQL, [companyId, PRODUCT_SIGNAL_WINDOW_DAYS, RECO_SUGGEST_SCAN]);
  return r.rows
    .map((x: any) => String(x.name || '').replace(/[ \t\n\r\f\v]+/g, ' ').replace(/^ | $/g, ''))   // 보이는 이름 = 공백류를 접고 다듬은 글(정리 규칙 = normName 과 같은 글자 집합)
    .filter((name: string) => name !== '' && recoTextIssue(name) === null)
    .slice(0, RECO_SUGGEST_LIMIT);
}

/**
 * 「추천 상품」 줄이 받는 값 — 관문(추천 상품이 열린 회사인가)을 여기서 본다(라우트는 단계 판정을 직접 하지 않는다).
 *   닫힌 회사 = live false 한 줄(후보 0) · 이름만 준다(조회 · 구매 수는 회사 전체 값이라 싣지 않는다 = 분류코드로 나뉜 담당자에게도 같은 응답).
 */
export async function recoCandidatesFor(companyId: string | null | undefined): Promise<{ live: boolean; hasSignals: boolean; candidates: string[]; max: number }> {
  if (!companyId || !(await v3Live('reco', companyId))) return { live: false, hasSignals: false, candidates: [], max: RECO_MAX_CANDIDATES };
  const candidates = await suggestRecoCandidates(companyId);
  return { live: true, hasSignals: candidates.length > 0, candidates, max: RECO_MAX_CANDIDATES };
}

/**
 * 상품 이름들의 반응 숫자 글자(★ 2026-11-14 C133 F2 ② · 받는 사람에게 보이는 글자 = product-signal-text signalTextOf) — 이름 → 글자.
 *   이름 해석 = 추천과 같은 조각(namedProductsSql · 상품마다 보관 기간 안 가장 최근 이름) · 같은 이름의 상품(번호가 여럿 · 두 문)은 조회를 더한다.
 *   조회가 없는 이름은 결과에 없다(글자 없음 = 지어낸 숫자 0). 숫자를 볼 수 있는 요청자인가(productInsightOpenFor)는 부르는 길이 먼저 본다.
 */
export const SIGNAL_TEXT_NAMES_MAX = 50;
export const SIGNAL_VIEWS_BY_NAME_SQL = `
  SELECT n.norm, SUM(n.views)::int AS views
    FROM (${namedProductsSql('$2::int')}) n
   WHERE n.norm = ANY($3::text[])
   GROUP BY n.norm`;

export async function signalTextsFor(companyId: string, names: readonly string[]): Promise<Record<string, string>> {
  const wanted = names.slice(0, SIGNAL_TEXT_NAMES_MAX).map((name) => ({ name, norm: normName(name) })).filter((x) => x.norm !== null);
  if (wanted.length === 0) return {};
  const r = await query(SIGNAL_VIEWS_BY_NAME_SQL, [companyId, PRODUCT_SIGNAL_WINDOW_DAYS, [...new Set(wanted.map((x) => x.norm))]]);
  const views = new Map<string, number>(r.rows.map((x: any) => [String(x.norm), Number(x.views || 0)]));
  const out: Record<string, string> = {};
  for (const w of wanted) {
    const text = signalTextOf(views.get(w.norm as string) ?? 0, PRODUCT_SIGNAL_WINDOW_DAYS);
    if (text) out[w.name] = text;
  }
  return out;
}
