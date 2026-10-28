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

import { query } from '../config/database';

// ─── 웹훅 매출 회사 가드 캐시 ───
//   true(웹훅 매출 이력 있음 → skip) = 사실상 영구라 60분 캐시 / false = 5분(웹훅 도입 감지)
const WEBHOOK_TRUE_TTL_MS = 60 * 60 * 1000;
const WEBHOOK_FALSE_TTL_MS = 5 * 60 * 1000;
const webhookRevenueCache = new Map<string, { at: number; has: boolean }>();

async function hasWebhookRevenueHistory(companyId: string): Promise<boolean> {
  const cached = webhookRevenueCache.get(companyId);
  if (cached) {
    const ttl = cached.has ? WEBHOOK_TRUE_TTL_MS : WEBHOOK_FALSE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.has;
  }
  // CT-22(cdp-orders.ts)가 customers 요약 컬럼을 실제로 증분/차감한 증거 마커만 매칭 —
  //   revenue_applied/revenue_reversed는 CT-22 전용 기록. event_name='purchase'만으로 걸면
  //   웹 SDK/이벤트 API 행동 추적의 purchase 이벤트(요약 컬럼 미증분)까지 걸려
  //   싱크 회사의 집계가 무음으로 꺼지는 오탐이 생긴다 (2026-07-03 재검증 반영).
  const res = await query(
    `SELECT 1 FROM cdp_events
      WHERE company_id = $1::uuid AND event_name = 'purchase'
        AND (properties ? 'revenue_applied' OR properties ? 'revenue_reversed')
      LIMIT 1`,
    [companyId],
  );
  const has = res.rows.length > 0;
  if (has && !cached?.has) {
    console.log(`[구매요약집계] 웹훅 매출 회사 감지 — 싱크 재계산 skip (company: ${companyId})`);
  }
  webhookRevenueCache.set(companyId, { at: Date.now(), has });
  return has;
}

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
 * 주어진 고객들의 구매 요약 컬럼을 purchases 원장 기준으로 재계산한다.
 * 웹훅 매출 이력이 있는 회사는 skip(0 반환) — cdp-orders 증분 집계가 그 회사의 진실.
 * keepColumns = 고객 원본이 주는 요약 칸(parseCustomerSummaryFields 결과) — 그 칸은 고객 적재와 같은 규칙(위 표)으로만 쓴다.
 * @returns 갱신된 고객 행 수 (skip 시 0)
 */
export async function updateCustomerPurchaseAggregates(
  companyId: string,
  customerIds: string[],
  opts: { keepColumns?: string[] } = {},
): Promise<number> {
  if (!companyId || !customerIds?.length) return 0;
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (!ids.length) return 0;

  const keep = new Set(opts.keepColumns || []);
  const sets = SUMMARY_SET_FRAGMENTS.flatMap(([col, expr, rule]) => {
    if (!keep.has(col)) return [`${col} = ${expr}`];
    return rule === 'greatest' ? [`${col} = GREATEST(c.${col}, ${expr})`] : [];
  });
  if (!sets.length) return 0;

  // ★ 이중 진실 가드 — 웹훅 매출 회사는 원장-only 재계산이 웹훅 반영분을 덮어쓰므로 skip
  if (await hasWebhookRevenueHistory(companyId)) return 0;

  const result = await query(
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
