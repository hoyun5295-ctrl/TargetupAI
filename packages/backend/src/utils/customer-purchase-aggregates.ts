/**
 * CT: 고객 구매 요약 집계 (싱크에이전트 경로)
 * ===================================================================
 *
 * 배경 (2026-07-03, isae 실측):
 *   purchases(원장)에는 구매가 쌓이는데 customers의 요약 컬럼
 *   (total_purchase_amount·purchase_count·recent_purchase_date·
 *    recent_purchase_amount·recent_purchase_store)을 채우는 경로가
 *   싱크에이전트 경로에만 없어 고객 목록 총구매액/최근구매가 전부 '-'.
 *
 * 집계 3경로와 이중 진실 가드 (2026-07-03 적대 검증 반영):
 *   - 웹훅 주문(cdp-orders.ts CT-22) = purchases 원장에 없고 customers를 직접 증분.
 *     → 웹훅 매출 이력(cdp_events event_name='purchase')이 있는 회사는 이 CT를 skip.
 *       원장-only 재계산이 웹훅 반영분을 덮어쓰는 사고 차단. (두 채널 통합은 별도 설계 과제)
 *   - 업로드 upsert(customer-upsert) = 업로드 데이터에 있으면 병합 (기존, 불변)
 *   - 싱크에이전트(sync.ts purchases) = 이 CT — 배치 적재 직후 해당 고객만 재계산
 *
 * 원칙·한계:
 *   - 원장(purchases) 기준 전체 재계산 = 멱등. 단 원장에 중복 적재가 있으면 그만큼 부풀어
 *     보인다(원장 무결성은 이 CT의 전제 — 적재 멱등키는 별도 과제).
 *   - 최근값 추출은 purchase_date DESC NULLS LAST + created_at DESC —
 *     날짜 없는 행이 '최근'으로 뽑혀 MAX(purchase_date)와 어긋나는 것 차단.
 *   - customer_id NULL 원장 행(고객보다 먼저 적재된 구매)은 집계에서 제외 —
 *     백필 시 phone 기반 링크 선행 필요.
 *   - customerIds 배치 단위(≤수천)로만 호출 — idx_purchases_customer 인덱스 전제.
 *     전사 백필은 요청 경로 밖에서 1회 SQL로 실행 (D231+ 대량 동기 작업 금지).
 *   - 집계 실패/데드락이 적재를 막으면 안 됨 — 호출부 try/catch 격리, 다음 배치가 자기치유.
 */

import { purchaseFactsSql, resolvePurchaseSummaryBranch } from './two-door-purchase';

type Run = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

// ★ 2026-11-04 C99 — 옛 「웹훅 매출 회사면 원장 재계산 skip」(60분 캐시)은 회사 갈래(two-door-purchase.resolvePurchaseSummaryBranch ·
//   회사 잠금 뒤 같은 연결의 새 문장)로 바뀌었다: 몰 매출 표식 + 원장 = 두 문 = CT-D3 · 원장만 = 아래 매장 재계산 · 몰만 = 주문 CT 증분.
//   캐시는 지웠다(캐시된 「몰 없음」이 첫 몰 매출 순간에 원장 재계산을 열어 CT-D3 결과를 덮는다 · Codex 설계 3R #3).

/**
 * ★ 2026-10-28 고객 누계 보호(P3 · 설계서 docs/2026-10-28-sync-value-check-summary-guard-design.md §4).
 * 고객 매핑으로 요약 칸을 주는 회사(에이전트 1.7.3+ 가 구매 요청에 customerSummaryFields 로 싣는다)는 고객 원본이 그 칸의 진실이다 —
 * 원장 재계산은 그 칸을 **고객 적재(customer-upsert.ts)와 같은 합치기 규칙**으로만 쓴다 — 같은 칸을 쓰는 두 작성자가 규칙이 다르면
 * 번갈아 덮거나(옛: 원장이 늘 덮음) 한쪽 값이 굳는다(COALESCE 로 채운 원장 값이 다음 구매에 안 바뀜 · Codex 설계 1R · 구현 1R 같은 뿌리).
 *   - greatest = 고객 적재가 GREATEST 인 칸(구매횟수 · 최근구매일) → 원장도 GREATEST(지금 값, 원장 값): 원본이 비어도 원장이 계속 채우고 굳지 않는다.
 *   - master   = 고객 적재가 「원본 값이 있으면 덮음」인 칸(누적금액 · 최근구매금액 · 최근구매매장 · 환불로 줄 수 있어 큰 값 규칙 불가)
 *                → 원장은 쓰지 않는다(원본이 비운 칸 = 원본의 값).
 * 옛: 고객 적재와 원장 재계산이 같은 칸을 번갈아 덮었다(일별 집계 원장이면 구매횟수 = 구매한 날 수).
 * [칸, 원장 식, 지킬 때 규칙]. ⛔ SQL 에는 이 표의 고정 조각만 들어간다(요청 글자를 넣지 않는다). 에이전트 `mapping/index.ts CUSTOMER_SUMMARY_FIELDS` 와 같은 5칸.
 */
const SUMMARY_SET_FRAGMENTS: ReadonlyArray<readonly [string, string, 'greatest' | 'master']> = [
  ['total_purchase_amount', 'agg.total_amount', 'master'],
  ['purchase_count', 'agg.cnt', 'greatest'],
  ['recent_purchase_date', 'agg.recent_date', 'greatest'],
  ['recent_purchase_amount', 'agg.recent_amount', 'master'],
  ['recent_purchase_store', 'agg.recent_store', 'master'],
];

/** 구매 요청의 customerSummaryFields → 허용 5칸만(배열 아님 · 모르는 칸 = 버림). 새 칸이 없는 요청(1.7.2 이하) = [] = 지금 동작. */
export function parseCustomerSummaryFields(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(SUMMARY_SET_FRAGMENTS.map(([col]) => col));
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && allowed.has(v)))];
}

/**
 * 매장만 회사(원장만 · 몰 매출 표식 없음) — 주어진 고객들의 구매 요약 컬럼을 purchases 원장 기준으로 재계산한다(옛 규칙 그대로).
 * keepColumns = 고객 원본이 주는 요약 칸(parseCustomerSummaryFields 결과) — 그 칸은 고객 적재와 같은 규칙(위 표)으로만 쓴다.
 * ⛔ 직접 부르지 않는다 — applyLedgerIngestSummary 가 회사 잠금 뒤 갈래로 고른다(두 문 회사에 이 재계산이 돌면 몰 구매가 지워진다).
 * @returns 갱신된 고객 행 수
 */
async function recomputeStoreOnlySummary(
  run: Run,
  companyId: string,
  ids: string[],
  keepColumns: string[],
): Promise<number> {
  const keep = new Set(keepColumns);
  const sets = SUMMARY_SET_FRAGMENTS.flatMap(([col, expr, rule]) => {
    if (!keep.has(col)) return [`${col} = ${expr}`];
    return rule === 'greatest' ? [`${col} = GREATEST(c.${col}, ${expr})`] : [];
  });
  if (!sets.length) return 0;

  const result = await run(
    `UPDATE customers c
        SET ${sets.join(',\n            ')}
       FROM (
         SELECT p.customer_id,
                SUM(p.total_amount) AS total_amount,
                COUNT(*)::int AS cnt,
                MAX(p.purchase_date) AS recent_date,
                (ARRAY_AGG(p.total_amount ORDER BY p.purchase_date DESC NULLS LAST, p.created_at DESC))[1] AS recent_amount,
                (ARRAY_AGG(COALESCE(NULLIF(p.store_name, ''), p.store_code) ORDER BY p.purchase_date DESC NULLS LAST, p.created_at DESC))[1] AS recent_store
           FROM purchases p
          WHERE p.company_id = $1
            AND p.customer_id = ANY($2::uuid[])
          GROUP BY p.customer_id
       ) agg
      WHERE c.company_id = $1
        AND c.id = agg.customer_id`,
    [companyId, ids],
  );
  return result.rowCount || 0;
}

// ─── CT-D3 두 문 회사 요약 칸(★ 2026-11-04 C99 · 설계서 §4 T1 · Harold 1103 §5 ④ (나)) ───
//   진실 = 두 문 사실(CT-D2 · 같은 구매 한 번) · 최근 구매일만 큰 값(사실, 원본) · 두 문 회사 요약 칸의 유일한 작성자.
//   원본(싱크 고객 · 엑셀)이 준 누계 · 횟수는 계산에 쓰지 않는다(summary_source.totals = 화면 「원본 누계」 표시용).

const SRC = `COALESCE(c.summary_source, '{}'::jsonb)`;
/** 원본(또는 옮긴 옛 값) 최근 구매 묶음의 날짜 · 금액 · 매장 — 꼴이 틀린 값은 없는 것으로. */
const SRC_RECENT_DATE = `(CASE WHEN (${SRC}->'recent'->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (${SRC}->'recent'->>'date')::date END)`;
const SRC_RECENT_AMOUNT = `(CASE WHEN (${SRC}->'recent'->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${SRC}->'recent'->>'amount')::numeric END)`;
const SRC_RECENT_STORE = `NULLIF(${SRC}->'recent'->>'store', '')`;

/**
 * CT-D3 — 두 문 회사 고객 구매 요약 칸 재계산. 호출부가 회사 잠금(lockCompanyPurchaseSummary)을 잡고 갈래가 두 문일 때만 부른다.
 *   ① 고객 행 잠금(번호 · id 순 = 업서트와 같은 순서) ② 처음 세는 고객(d2 없음) = 지금 칸의 최근 구매일 · 금액 · 매장을 recent(legacy)로 옮김
 *      (recent 묶음이 없거나 그 날짜가 지금 칸보다 이를 때만 · 두 문 회사는 업서트가 요약 칸을 직접 쓰지 않으므로 그 순간 칸 값 = 옛 값)
 *   ③ 사실로 계산해 쓰기 + d2 표식. 같은 함수가 업서트 · 원장 · 몰 · 전환 패스 어디서든 첫 단계부터 같다.
 *   칸이 없으면(C99-DDL-1 전 · 42703) 던진다 = 그 요청 되돌림(호출부가 503).
 */
export async function recomputeCustomerPurchaseSummary(run: Run, companyId: string, customerIds: string[]): Promise<number> {
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  await run(`SELECT 1 FROM customers WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) ORDER BY phone, id FOR UPDATE`, [companyId, ids]);
  // 옮기는 것은 사실보다 늦은 옛 날짜뿐(사실에 그날 이후 구매가 있으면 옮길 것이 없다 · 옮긴 날짜가 뒤에 취소된 몰 주문의 날이 되어
  //   최근일이 굳는 한계를 막는다 · 옛 날짜가 사실보다 늦다 = 원본이 우리가 못 본 구매를 봤다)
  await run(
    `WITH f AS (${purchaseFactsSql({ companyRef: '$1::uuid', customerIdsRef: '$2::uuid[]' })})
     UPDATE customers c
        SET summary_source = jsonb_set(${SRC}, '{recent}', jsonb_strip_nulls(jsonb_build_object(
              'date', to_char(c.recent_purchase_date, 'YYYY-MM-DD'), 'amount', c.recent_purchase_amount,
              'store', NULLIF(c.recent_purchase_store, ''), 'at', NOW(), 'legacy', true)))
      WHERE c.company_id = $1::uuid AND c.id = ANY($2::uuid[])
        AND NOT (${SRC} ? 'd2')
        AND c.recent_purchase_date IS NOT NULL
        AND (${SRC_RECENT_DATE} IS NULL OR ${SRC_RECENT_DATE} < c.recent_purchase_date)
        AND NOT EXISTS (SELECT 1 FROM f WHERE f.customer_id = c.id AND f.kst_day >= c.recent_purchase_date)`,
    [companyId, ids],
  );
  const useSrc = `(${SRC_RECENT_DATE} IS NOT NULL AND (agg.fact_day IS NULL OR ${SRC_RECENT_DATE} > agg.fact_day))`;
  // [칸, 새 값] — SET 과 「바뀌었나」 판정이 같은 식을 쓴다(값이 같으면 다시 쓰지 않는다 · full 싱크마다 전 행 재작성 금지 · R206 과 같은 규칙).
  const pairs: Array<[string, string]> = [
    ['purchase_count', 'COALESCE(agg.cnt, 0)'],
    ['total_purchase_amount', 'COALESCE(agg.total, 0)'],
    ['total_purchase', 'COALESCE(agg.total, 0)'],
    ['avg_order_value', 'CASE WHEN COALESCE(agg.cnt, 0) > 0 THEN COALESCE(agg.total, 0) / agg.cnt ELSE 0 END'],
    ['recent_purchase_date', `GREATEST(agg.fact_day, ${SRC_RECENT_DATE})`],
    ['recent_purchase_amount', `CASE WHEN ${useSrc} THEN ${SRC_RECENT_AMOUNT} ELSE agg.last_amount END`],
    ['recent_purchase_store', `CASE WHEN ${useSrc} THEN ${SRC_RECENT_STORE} ELSE st.store END`],
    ['last_purchase_date', `to_char(GREATEST(agg.fact_day, ${SRC_RECENT_DATE}), 'YYYY-MM-DD')`],
    ['summary_source', `CASE WHEN ${SRC} ? 'd2' THEN c.summary_source ELSE ${SRC} || jsonb_build_object('d2', jsonb_build_object('at', NOW())) END`],
  ];
  const r = await run(
    `WITH f AS (${purchaseFactsSql({ companyRef: '$1::uuid', customerIdsRef: '$2::uuid[]', undated: true })}),
          agg AS (
            SELECT f.customer_id, COUNT(*)::int AS cnt, COALESCE(SUM(f.amount), 0) AS total, MAX(f.kst_day) AS fact_day,
                   (ARRAY_AGG(f.amount ORDER BY f.kst_day DESC NULLS LAST, f.at DESC NULLS LAST, f.door DESC, f.source_id DESC))[1] AS last_amount
              FROM f GROUP BY f.customer_id
          ),
          st AS (
            SELECT f.customer_id, f.kst_day,
                   (ARRAY_AGG(f.store ORDER BY f.at DESC, f.source_id DESC) FILTER (WHERE f.door = 'ledger' AND f.store IS NOT NULL))[1] AS store
              FROM f WHERE f.kst_day IS NOT NULL GROUP BY f.customer_id, f.kst_day
          ),
          ids AS (SELECT unnest($2::uuid[]) AS id)
     UPDATE customers c SET
            ${pairs.map(([col, e]) => `${col} = ${e}`).join(',\n            ')},
            updated_at = NOW()
       FROM ids
       LEFT JOIN agg ON agg.customer_id = ids.id
       LEFT JOIN st ON st.customer_id = ids.id AND st.kst_day = agg.fact_day
      WHERE c.id = ids.id AND c.company_id = $1::uuid
        AND ROW(${pairs.map(([, e]) => e).join(', ')}) IS DISTINCT FROM ROW(${pairs.map(([col]) => `c.${col}`).join(', ')})`,
    [companyId, ids],
  );
  return r.rowCount || 0;
}

/**
 * 원장 적재 트랜잭션 안(회사 잠금은 적재 첫 쓰기 전에 잡았다) — 갈래를 다시 판정해 요약 칸을 맞춘다.
 *   두 문 = CT-D3 · 매장만 = 옛 원장 재계산(keep 규칙 그대로) · 실패 = 그 적재 통째로 되돌림(503 재전송 · 재전송 때 다시 돈다).
 */
export async function applyLedgerIngestSummary(
  run: Run,
  companyId: string,
  customerIds: string[],
  opts: { keepColumns?: string[] } = {},
): Promise<number> {
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (!companyId || ids.length === 0) return 0;
  const branch = await resolvePurchaseSummaryBranch(run, companyId);
  if (branch === 'two_door') return recomputeCustomerPurchaseSummary(run, companyId, ids);
  if (branch === 'store') return recomputeStoreOnlySummary(run, companyId, ids, opts.keepColumns || []);
  return 0;
}
