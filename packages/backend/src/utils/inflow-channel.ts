/**
 * inflow-channel.ts — 유입 경로별 방문 · 구매 · 매출 (★ 2026-11-21 C152 E · 설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §2-E)
 *
 * 방문 시작 = 세션(session_id 가 있는 page_view)마다 가장 이른 한 줄. 경로 = 그 줄의 주소 꼬리표(utm_source) · referrer 로 여섯 갈래.
 * 구매 = 매출 반영된 결제 주문(netPurchaseSql). 구매 하나는 한 경로에만 센다:
 *   ① 같은 session_id 의 방문 시작 ② 없으면 그 고객의 구매 시각 앞 7일 안 가장 늦은 방문 시작 ③ 없으면 「방문 기록 없음」.
 * 줄 = 창 안 방문이 있거나 귀속된 구매가 있는 경로(창 앞 7일 방문에 귀속된 구매는 그 경로 줄 · 방문 0).
 * ★ 2026-11-22 C156 — 추적 링크가 붙인 표식(short-url INFLOW_MARK)으로 **시작한** 세션 = 「한줄로 메시지 링크」
 *   (세션의 가장 이른 시각의 페이지뷰들 가운데 표식이 든 줄이 있을 때 · 그 뒤 시각의 표식은 갈래를 바꾸지 않는다 · 여섯 갈래 식은 그대로).
 * 알고 두는 한계 = 본문에 주소를 그대로 적어 보낸 문자의 방문은 referrer 가 비어 「직접 방문」 · 웹훅 주문은 세션이 없어 고객 기준 길만 탄다.
 * 주소 · referrer = SDK auto-capture/pageview.ts 가 싣고 cdp-events.ts normalizeBrowserEvent 가 properties 에 남긴 칸(url · referrer).
 */
import { netPurchaseSql } from './cdp-order-revenue';
import { mallAmountSql } from './two-door-purchase';
import { boundedRead, kstDayAgoSql, kstDayStartSql } from './product-signal';
import { INFLOW_MARK } from './short-url';

export const INFLOW_WINDOW_DAYS = 30;
export const INFLOW_LOOKBACK_DAYS = 7;
export const INFLOW_ROWS_MAX = 12;
export const INFLOW_NO_VISIT = '방문 기록 없음';
export const INFLOW_REST = '그 밖';
const TAG_MAX = 40;
/** ★ C156 추적 링크의 표식으로 시작한 방문의 줄 이름 */
export const INFLOW_OWN_LABEL = '한줄로 메시지 링크';

/**
 * (SQL) 이 주소에 우리 표식 칸이 있는가 — 조각(#…)을 떼고 **첫 `?` 뒤의 쿼리만** 꺼내 그 안에서 칸으로 찾는다.
 *   경로 · 조각 · 다른 칸의 값 안에 든 같은 글자는 잡지 않는다. 글자 = 붙이는 쪽과 같은 상수(INFLOW_MARK).
 */
export function inflowOwnSql(url: string): string {
  return `COALESCE(substring(split_part(${url}, '#', 1) from '[?](.*)$') ~ '(^|&)${INFLOW_MARK}(&|$)', false)`;
}

const hostSql = (v: string) => `lower(COALESCE(substring(${v} from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#:]+)'), ''))`;

/**
 * (SQL) 방문 시작 한 줄의 경로 — 판정 차례가 곧 계약이다(위에서부터 처음 맞는 것).
 *   꼬리표 값 = 주소에서 꺼낸 글자를 소문자 · 영숫자 · `_ . -` 만 남기고 40자(고객이 넣은 글자를 그대로 싣지 않는다 · 빈 값이면 다음 갈래).
 */
export function inflowChannelSql(url: string, referrer: string): string {
  const tag = `LEFT(regexp_replace(lower(COALESCE(substring(${url} from '[?&]utm_source=([^&#]*)'), '')), '[^a-z0-9_.-]', '', 'g'), ${TAG_MAX})`;
  const ref = `btrim(COALESCE(${referrer}, ''))`;
  const refHost = hostSql(referrer);
  return `(CASE
      WHEN ${tag} <> '' THEN '링크 꼬리표 · ' || ${tag}
      WHEN ${ref} = '' THEN '직접 방문'
      WHEN ${refHost} <> '' AND ${refHost} = ${hostSql(url)} THEN '직접 방문'
      WHEN ${refHost} ~ '(naver|google|daum|bing|yahoo)' THEN '검색'
      WHEN ${refHost} ~ '(instagram|facebook|kakao|youtube|tiktok|twitter|(^|[.])x[.]com$|(^|[.])t[.]co$)' THEN 'SNS'
      ELSE '다른 사이트'
    END)`;
}

/**
 * 경로별 방문 · 구매 · 매출($1 회사 · $2 창 일수 · $3 귀속 일수) — 매출 큰 순.
 *   pv = 창 앞 귀속 일수까지 거슬러 읽은 페이지뷰 · sess = 세션마다 시작 줄(고객 = 그 세션에서 처음 식별된 고객) ·
 *   buys = 창 안 구매 · attr = 구매마다 경로 하나 · v = 창 안에 시작한 세션 수.
 */
export const INFLOW_SQL = `
  WITH w AS (SELECT ${kstDayStartSql(kstDayAgoSql('($2::int - 1)'))} AS since),
  pv AS (
    SELECT e.session_id, e.customer_id, e.occurred_at, e.properties->>'url' AS url, e.properties->>'referrer' AS ref
      FROM cdp_events e, w
     WHERE e.company_id = $1::uuid AND e.event_name = 'page_view' AND NULLIF(e.session_id, '') IS NOT NULL
       AND e.occurred_at >= w.since - make_interval(days => $3::int) AND e.occurred_at <= NOW()
  ),
  sess AS (
    SELECT s.session_id, s.at, s.customer_id,
           (CASE WHEN s.own THEN '${INFLOW_OWN_LABEL}' ELSE ${inflowChannelSql('s.url', 's.ref')} END) AS channel
      FROM (
        SELECT p.session_id, MIN(p.occurred_at) AS at,
               (array_agg(p.url ORDER BY p.occurred_at))[1] AS url,
               (array_agg(p.ref ORDER BY p.occurred_at))[1] AS ref,
               (array_agg(p.customer_id ORDER BY p.occurred_at) FILTER (WHERE p.customer_id IS NOT NULL))[1] AS customer_id,
               COALESCE(BOOL_OR(p.own) FILTER (WHERE p.occurred_at = p.first_at), false) AS own
          FROM (SELECT v.*, MIN(v.occurred_at) OVER (PARTITION BY v.session_id) AS first_at, ${inflowOwnSql('v.url')} AS own FROM pv v) p
         GROUP BY p.session_id
      ) s
  ),
  buys AS (
    SELECT b.id, NULLIF(b.session_id, '') AS session_id, b.customer_id, b.occurred_at AS at, COALESCE(${mallAmountSql('b')}, 0) AS amount
      FROM cdp_events b, w
     WHERE b.company_id = $1::uuid AND ${netPurchaseSql('b')} AND b.occurred_at >= w.since AND b.occurred_at <= NOW()
  ),
  attr AS (
    SELECT b.id, b.amount,
           COALESCE(
             (SELECT s.channel FROM sess s WHERE s.session_id = b.session_id LIMIT 1),
             (SELECT s.channel FROM sess s
               WHERE b.customer_id IS NOT NULL AND s.customer_id = b.customer_id
                 AND s.at <= b.at AND s.at >= b.at - make_interval(days => $3::int)
               ORDER BY s.at DESC, s.session_id LIMIT 1),
             '${INFLOW_NO_VISIT}') AS channel
      FROM buys b
  ),
  v AS (SELECT s.channel, COUNT(*)::int AS visits FROM sess s, w WHERE s.at >= w.since GROUP BY s.channel),
  p AS (SELECT a.channel, COUNT(*)::int AS purchases, COALESCE(SUM(a.amount), 0)::float8 AS revenue FROM attr a GROUP BY a.channel)
  SELECT COALESCE(v.channel, p.channel) AS channel, COALESCE(v.visits, 0)::int AS visits,
         COALESCE(p.purchases, 0)::int AS purchases, COALESCE(p.revenue, 0)::float8 AS revenue
    FROM v FULL JOIN p ON p.channel = v.channel
   ORDER BY COALESCE(p.revenue, 0) DESC, COALESCE(v.visits, 0) DESC, COALESCE(v.channel, p.channel)`;

export interface InflowRow { channel: string; visits: number; purchases: number; revenue: number }

/** (순수) 줄 수 상한 — 넘는 줄은 「그 밖」 한 줄로 합친다(방문 · 구매 · 매출의 합은 그대로) */
export function capInflowRows(rows: readonly InflowRow[], max: number = INFLOW_ROWS_MAX): InflowRow[] {
  if (rows.length <= max) return [...rows];
  const head = rows.slice(0, max - 1);
  const rest = rows.slice(max - 1).reduce<InflowRow>(
    (a, r) => ({ channel: INFLOW_REST, visits: a.visits + r.visits, purchases: a.purchases + r.purchases, revenue: a.revenue + r.revenue }),
    { channel: INFLOW_REST, visits: 0, purchases: 0, revenue: 0 },
  );
  return [...head, rest];
}

/** 최근 30일 유입 경로 — 방문도 구매도 없으면 빈 배열 · 시간 제한(넘으면 그 요청만 실패) */
export async function listInflowChannels(companyId: string): Promise<InflowRow[]> {
  const rows = await boundedRead(INFLOW_SQL, [companyId, INFLOW_WINDOW_DAYS, INFLOW_LOOKBACK_DAYS]);
  return capInflowRows(rows.map((x: any) => ({
    channel: String(x.channel), visits: Number(x.visits) || 0, purchases: Number(x.purchases) || 0, revenue: Number(x.revenue) || 0,
  })));
}
