/**
 * purchase-history-source.ts — 구매이력 화면의 원천 컨트롤타워 (★2026-10-01 B-1001-7 · 이에스페이먼트 영업 접수 "구매이력이 안 보인다")
 *
 * 경위(운영 실측 1001): 이에스페이먼트 4몰 주문 가져오기 = 전부 완료(실패 0) · 자사몰 결제 확정 주문 28,269건이 cdp_events 에 있다.
 *   그런데 구매이력 화면(관리 > 구매내역 · 고객별 구매내역 창)은 구매 원장(purchases)만 읽었고, 자사몰 주문은 원장에 쓰지 않는다
 *   (cdp-orders → cdp_events + 고객 요약 칸 · customer-purchase-aggregates 머리 "두 채널 통합은 별도 설계 과제") → 원장 0행 = 화면 0건.
 *
 * ⛔ 원장에 자사몰 주문을 쓰지 않는다 — 여정(실행·대상 추출·생애 지도·상품·통계)이 원장과 자사몰 이벤트를 **둘 다** 읽고
 *   "회사마다 문 하나"(journey-purchase-ledger)로 가려 쓴다. 원장에 쓰면 같은 구매가 두 번 잡혀 중복 발송·중복 과금 위험이다.
 *   그래서 **읽는 화면만** 두 원천을 같은 칸 모양으로 합친다. 이미 들어온 데이터가 소급 작업 없이 그대로 보인다.
 *
 * 자사몰 쪽 행 = 매출 반영된 주문(CT-86 isRevenueApplied 와 같은 규칙) · 취소·환불 차감 안 됨 · 고객 연결된 주문 이벤트만(고객 요약 칸과 같은 셈).
 *   구매일 = 주문 시각(KST 벽시계 · 원장 purchase_date 와 같은 축).
 *
 * ⛔ 같은 구매를 두 번 보이지 않는다(Codex 1001 R1) — 자사몰 주문을 ERP 로도 동기화해 원장에도 주는 회사가 있다(journey-purchase-ledger 머리).
 *   두 원천에 공통 주문번호가 없어 **같은 고객 · 같은 날(KST) · 같은 금액**의 원장 행이 있으면 자사몰 행을 뺀다(원장 우선).
 *   금액이나 날짜가 다른 오프라인 구매는 그대로 남는다.
 * ⛔ 매장(분류코드) = 그 주문의 연동 행 하나(이벤트당 최대 1행 · LATERAL LIMIT 1):
 *   우커머스 = 주문번호 `{몰 주소}:{번호}` 의 몰 주소와 같은 연동 행(다몰 접두 · woocommerce-core 불변 3).
 *   그 밖(카페24·고도몰 등 접두 없음) = 그 회사에 그 provider 연동이 **하나뿐일 때만** 그 행. 둘 이상이면 어느 몰인지 몰라 비운다.
 *   두 갈래는 서로 배타다(Codex 1001 R2) — 접두 비교는 우커머스에만 건다. 접두 없는 주문번호가 어느 연동의 mall_id 와 우연히 같아도 붙지 않는다.
 */

import { REVENUE_STATUSES } from './cdp-order-revenue';

/**
 * 매출 반영된 주문인가 — CT-86 isRevenueApplied 와 같은 규칙(고객 요약 칸과 같은 셈):
 *   revenue_applied = JSON true · 또는 표식 도입(0610) 전 행이면 기록 당시 상태가 결제 완료. 차감 끝난 주문(revenue_reversed = true)은 뺀다.
 */
const APPLIED = `(e.properties->'revenue_applied' = 'true'::jsonb`
  + ` OR (NOT (e.properties ? 'revenue_applied') AND e.properties->>'status' IN (${REVENUE_STATUSES.map((x) => `'${x}'`).join(', ')})))`;
const NOT_REVERSED = `COALESCE(e.properties->'revenue_reversed' = 'true'::jsonb, false) = false`;

/** 문자열 숫자만 숫자로 — 다른 값이면 0(한 행의 이상한 값이 화면 전체를 500 으로 만들지 않게) */
const num = (expr: string) => `CASE WHEN (${expr}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${expr})::numeric ELSE 0 END`;
const ITEMS = `e.properties->'items'`;
const AMOUNT = num(`e.properties->>'total_amount'`);
const KST_AT = `(e.occurred_at AT TIME ZONE 'Asia/Seoul')`;
/** 주문번호 앞부분 = 우커머스 다몰 접두(몰 주소) */
const ORDER_MALL = `split_part(e.properties->>'order_id', ':', 1)`;

/**
 * 구매이력 원천 — `FROM ${purchaseHistorySourceSql('$1')} JOIN customers c ON c.id = p.customer_id ...` 자리에 넣는다(별칭 p).
 * 칸 = id · company_id · customer_id · purchase_date · store_code · store_name · product_name · quantity · total_amount · origin('ledger'|'mall')
 * @param companyRef 회사 id 자리표(예: '$1' · '$2') — 두 원천을 모두 회사로 먼저 좁힌다
 */
export function purchaseHistorySourceSql(companyRef: string): string {
  return `(
    SELECT p0.id, p0.company_id, p0.customer_id, p0.purchase_date, p0.store_code, p0.store_name,
           p0.product_name, p0.quantity, p0.total_amount, 'ledger'::text AS origin
      FROM purchases p0
     WHERE p0.company_id = ${companyRef}
    UNION ALL
    SELECT e.id, e.company_id, e.customer_id,
           ${KST_AT} AS purchase_date,
           mi.meta->>'store_code' AS store_code,
           COALESCE(NULLIF(mi.meta->>'store_code', ''), mi.mall_id) AS store_name,
           NULLIF(CONCAT(${ITEMS}->0->>'productName',
             CASE WHEN jsonb_typeof(${ITEMS}) = 'array' THEN
               CASE WHEN jsonb_array_length(${ITEMS}) > 1 THEN ' 외 ' || (jsonb_array_length(${ITEMS}) - 1) || '건' END
             END), '') AS product_name,
           CASE WHEN (e.properties->>'item_count') ~ '^[0-9]+$' THEN (e.properties->>'item_count')::int ELSE 1 END AS quantity,
           ${AMOUNT} AS total_amount,
           'mall'::text AS origin
      FROM cdp_events e
      LEFT JOIN LATERAL (
        SELECT ci.mall_id, ci.meta
          FROM company_integrations ci
         WHERE ci.company_id = e.company_id AND ci.provider = e.source
           AND ((e.source = 'woocommerce' AND ci.mall_id = ${ORDER_MALL})
                OR (e.source <> 'woocommerce'
                    AND (SELECT COUNT(*) FROM company_integrations c1 WHERE c1.company_id = e.company_id AND c1.provider = e.source) = 1))
         ORDER BY ci.created_at ASC
         LIMIT 1
      ) mi ON true
     WHERE e.company_id = ${companyRef}
       AND e.event_name = 'purchase'
       AND e.customer_id IS NOT NULL
       AND ${APPLIED}
       AND ${NOT_REVERSED}
       AND NOT EXISTS (
         SELECT 1 FROM purchases px
          WHERE px.company_id = e.company_id AND px.customer_id = e.customer_id
            AND px.purchase_date::date = ${KST_AT}::date
            AND px.total_amount = ${AMOUNT})
  ) p`;
}
