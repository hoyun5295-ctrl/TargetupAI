/**
 * two-door-purchase.ts — 두 문(자사몰 결제 · 매장 원장) 구매 판정 CT
 *   (★ 2026-11-04 C99 · 설계서 docs/2026-11-03-two-door-purchase-design.md §2 · §3)
 *
 * 왜 있나
 *   옛 규칙은 「회사마다 문 하나」였다(최근 30일 자사몰 구매가 있으면 매장 원장을 닫는다). 자사몰과 매장 싱크를 둘 다 쓰는 회사에서
 *   매장 구매가 여정 진입 · 고객 요약 칸 · 조건 · 기다리기 · 상품 목록 · 성과에서 빠졌다(뿌리 R54).
 *   이제 두 문을 늘 다 읽고, 같은 구매가 두 문에 다 있을 때만 그 겹침을 한 곳(CT-D1)에서 뺀다. 한 문만 쓰는 회사는 다른 문이 비어
 *   결과가 지금과 같다.
 *
 * 한 곳에서 정하는 것
 *   CT-D1 같은 구매 — 같은 회사 · 같은 고객 · 같은 KST 날짜 · (몰 금액 = 그 원장 행 금액 또는 = 그 고객 그날 원장 합계).
 *   CT-D2 두 문 구매 사실 — 몰 결제 전부 ∪ 몰과 같은 구매가 아닌 원장 행(같은 구매 = 몰 주문 하나로 센다 · 몰이 시각 · 금액이 정확).
 *   CT-D4 구매 있었나 — 이 시각 뒤 / 지난 N일 안에 몰 결제 또는 원장 구매(원장은 날짜만 = 기준 날 다음 날부터).
 *   CT-D5 구매 진입 소유 — 같은 날 다른 문으로 이미 진입했나(진입은 되돌릴 수 없는 발송이라 날짜 단위로 먼저 진입한 문이 그날을 가진다).
 *   회사 잠금 · 회사 갈래 — 고객 요약 칸을 쓰는 세 트랜잭션(고객 업서트 · 원장 적재 · 몰 주문)이 줄을 서고 잠근 뒤 갈래를 판정한다.
 *
 * ⛔ 규칙 한계(⑨-1 그대로 · 숨기지 않는다): 같은 날 같은 고객이 매장에서 따로 산 것이 섞여 그날 원장 합계가 몰 금액과 달라지고,
 *   원장이 상품 줄 단위라 어느 한 줄도 몰 금액과 같지 않으면 같은 주문을 사실에서 두 번 센다(진입은 날짜 단위 소유라 두 번 나가지 않는다).
 * ⛔ 시각 규약: purchases.purchase_date = KST 날짜 0시(시간대 없는 timestamp) · 몰 날짜 = (occurred_at AT TIME ZONE 'Asia/Seoul')::date.
 */
import { netPurchaseSql } from './cdp-order-revenue';

export type PurchaseDoorKind = 'mall' | 'ledger';

// ── CT-D6 원장 구매 행(★ 2026-11-04 C102 G1 · 설계서 docs/2026-11-04-c102-structural-zero-design.md) ──

/**
 * 원장 행 p 가 구매인가 — 금액이 음수인 행(환불 · 반품)은 구매가 아니다. 금액 없는 행 = 구매 기록 그대로 · 0원 = 구매(몰 0원 결제와 같은 뜻).
 *   ★ C102 G6 — 구매일이 KST 지금보다 뒤인 행(매장 시스템 날짜 오타 · 예정 행)은 그 날이 올 때까지 구매가 아니다(진입 커서와 같은 경계 ·
 *   옛: 「이 시각 뒤에 샀나」 · 「지난 N일」이 늘 참 = 구매 목표가 첫 칸 전에 「샀음」). 날짜 없는 행 = 그대로(요약 칸만 쓴다).
 *   원장을 구매로 읽는 자리는 전부 이 조각(또는 LEDGER_PURCHASES_SQL)을 지난다(계약 시험 c102-structural-contract).
 */
export function ledgerPurchaseRowSql(p: string): string {
  return `((${p}.total_amount IS NULL OR ${p}.total_amount >= 0) AND ${ledgerNotFutureSql(p)})`;
}

/**
 * 날짜 식(KST 날짜 · KST naive 시각)이 KST 지금보다 뒤가 아닌가 — 「미래 날짜는 아직 일어난 일이 아니다」 판정 한 곳(★ C102 G6 · Codex 4R).
 *   원장 행 · 고객 요약 최근일 · 원본 요약 최근일이 같은 조각을 쓴다. NULL = 거짓(호출부가 NULL 을 따로 정한다).
 */
export function kstNotFutureSql(expr: string): string {
  return `(${expr} <= (NOW() AT TIME ZONE 'Asia/Seoul'))`;
}

/** 원장 행 p 의 구매일이 미래가 아닌가(날짜 없는 행 = 참 · 요약 칸만 쓴다). */
export function ledgerNotFutureSql(p: string): string {
  return `(${p}.purchase_date IS NULL OR ${kstNotFutureSql(`${p}.purchase_date`)})`;
}

/** 구매 원장 행만 — FROM · JOIN 자리에 purchases 대신 쓴다(단순 부분 질의 = 플래너가 펼쳐 색인 그대로). */
export const LEDGER_PURCHASES_SQL = `(SELECT * FROM purchases lp WHERE ${ledgerPurchaseRowSql('lp')})`;

/** 회사 c(별칭 · companies)의 원장 문에 행이 왔나 — 갈래 · 전환 패스(환불 행도 순액에 쓰여 그 고객을 다시 센다). */
export function companyLedgerExistsSql(c: string): string {
  return `EXISTS (SELECT 1 FROM purchases p WHERE p.company_id = ${c}.id)`;
}

/** 원장 행 p 가 환불 · 반품인가(금액 음수) — 구매 행(ledgerPurchaseRowSql)의 반대쪽 한 곳. */
export function ledgerRefundRowSql(p: string): string {
  return `(${p}.total_amount < 0 AND ${ledgerNotFutureSql(p)})`;
}

/** 고객별 환불 행 금액 합(음수) — 요약 칸 누계 = 순액(구매 합 + 이 값 · 0 아래로 안 내려감 · 몰 취소 차감과 같은 뜻). */
export function ledgerRefundTotalsSql(companyRef: string, customerIdsRef: string): string {
  return `SELECT r.customer_id, SUM(r.total_amount) AS refund
    FROM purchases r
   WHERE r.company_id = ${companyRef} AND r.customer_id = ANY(${customerIdsRef}) AND ${ledgerRefundRowSql('r')}
   GROUP BY r.customer_id`;
}

/**
 * ★ C102 G7 — 고객보다 먼저 온 원장 행(적재 때 그 번호 고객이 없어 customer_id 없음)을 같은 회사 · 같은 번호 고객에 잇는다.
 *   도착 시각 = 지금(몰 사건 고객 연결과 같은 규칙 · cdp-events.ts · cdp-identity.ts) — 고객 없는 행은 진입 커서가 본 적이 없어 재발송 0 ·
 *   커서 창(구매일이 도착 뒤 정한 시간 안)이 오래된 구매의 소급 진입을 막는다. 최근 3일 도착분 · 한 번에 1000행 · 회사 잠금 안(원장 적재 트랜잭션).
 *   $1 = 회사 id · 돌려주는 칸 = 이은 고객 id.
 */
export const LINK_ORPHAN_LEDGER_ROWS_SQL = `WITH cand AS (
    SELECT o.id, cu.id AS cid
      FROM purchases o
      JOIN customers cu ON cu.company_id = o.company_id AND cu.phone = o.customer_phone
     WHERE o.company_id = $1::uuid AND o.customer_id IS NULL
       AND o.created_at >= NOW() - INTERVAL '3 days'
     ORDER BY o.created_at, o.id
     LIMIT 1000
  )
  UPDATE purchases o SET customer_id = cand.cid, created_at = NOW()
    FROM cand
   WHERE o.id = cand.id AND o.customer_id IS NULL
  RETURNING o.customer_id`;

/**
 * 그 고객의 그날(date 식)에 원장 환불 행이 있나 — CT-D3 옛 값 옮기기가 「옛 계산이 반품을 구매로 세어 남긴 최근일」을
 *   원본 값으로 굳히지 않게(★ C102 Codex 1R · 사실보다 늦은 칸 날짜가 그날 환불 행으로 설명되면 원본이 본 구매가 아니다).
 */
export function ledgerRefundOnDaySql(companyRef: string, customerExpr: string, dayExpr: string): string {
  return `EXISTS (SELECT 1 FROM purchases rd
                   WHERE rd.company_id = ${companyRef} AND rd.customer_id = ${customerExpr} AND ${ledgerRefundRowSql('rd')}
                     AND rd.purchase_date >= ${dayExpr} AND rd.purchase_date < ${dayExpr} + 1)`;
}


// ── CT-D1 같은 구매 ──

/** 몰 결제 사건의 금액(숫자 꼴이 아니면 NULL = 같은 구매 아님). */
export function mallAmountSql(e: string): string {
  return `(CASE WHEN (${e}.properties->>'total_amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${e}.properties->>'total_amount')::numeric END)`;
}

/** 원장 행 p 와 같은 날 같은 고객의 원장 합계(날짜 = 범위 비교 · idx_purchases_customer). */
function ledgerDaySumSql(p: string): string {
  return `(SELECT SUM(ds.total_amount) FROM ${LEDGER_PURCHASES_SQL} ds
            WHERE ds.company_id = ${p}.company_id AND ds.customer_id = ${p}.customer_id
              AND ds.purchase_date >= ${p}.purchase_date::date AND ds.purchase_date < ${p}.purchase_date::date + 1)`;
}

/**
 * 원장 행 p 가 같은 날 몰 결제와 같은 구매인가(SQL 불리언). 고객이 없는 원장 행 · 날짜 없는 행 = 같은 구매 판정 밖(늘 거짓 = 그대로 원장 사실).
 *   같은 날 = 몰 결제 시각이 그 KST 날짜 0시 ~ 다음 날 0시(= (occurred_at AT TIME ZONE 'Asia/Seoul')::date 와 같은 뜻 · 범위라 idx_cdp_events_customer).
 */
export function ledgerDupOfMallSql(p: string): string {
  return `(${p}.customer_id IS NOT NULL AND ${p}.purchase_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM cdp_events dm
     WHERE dm.customer_id = ${p}.customer_id AND dm.company_id = ${p}.company_id
       AND dm.occurred_at >= (${p}.purchase_date::date::timestamp AT TIME ZONE 'Asia/Seoul')
       AND dm.occurred_at < ((${p}.purchase_date::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
       AND ${netPurchaseSql('dm')}
       AND (${mallAmountSql('dm')} = ${p}.total_amount OR ${mallAmountSql('dm')} = ${ledgerDaySumSql(p)})))`;
}

/**
 * 몰 결제 사건 e 가 같은 날 원장과 같은 구매인가(SQL 불리언 · 원장 쪽에서 본 같은 판정) — 같은 고객 · 같은 KST 날짜의 원장 행이 있고
 *   몰 금액 = 어느 원장 행 금액 또는 = 그날 원장 합계. 원장 우선으로 보이는 화면(구매 이력)만 쓴다(사실 · 요약은 몰이 이긴다 = CT-D2).
 */
export function mallDupOfLedgerSql(e: string): string {
  return `(${e}.customer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM ${LEDGER_PURCHASES_SQL} dl
     WHERE dl.customer_id = ${e}.customer_id AND dl.company_id = ${e}.company_id
       AND dl.purchase_date >= (${e}.occurred_at AT TIME ZONE 'Asia/Seoul')::date
       AND dl.purchase_date < (${e}.occurred_at AT TIME ZONE 'Asia/Seoul')::date + 1
       AND (dl.total_amount = ${mallAmountSql(e)} OR ${mallAmountSql(e)} = ${ledgerDaySumSql('dl')})))`;
}

// ── CT-D2 두 문 구매 사실 ──

export interface PurchaseFactsOptions {
  /** 회사 id 식(예: `$1::uuid`). */
  companyRef: string;
  /** 고객 id 배열 식(예: `$2::uuid[]`) — 있으면 그 고객만. */
  customerIdsRef?: string;
  /** 이 시각 이후만(timestamptz 식) — 몰 = 결제 시각 · 원장 = 그 시각의 KST 날짜 0시 이후. */
  sinceAt?: string;
  /** 날짜 없는 원장 행도 넣는가(요약 칸 = 지금처럼 원장 행 단위 · 날짜 칸 NULL). 기본 = 빼기. */
  undated?: boolean;
}

/**
 * 두 문 구매 사실 한 벌(겹침 뺌) — 칸 = door · customer_id · kst_day(date) · at(timestamptz) · amount(numeric) · store · source_id · properties.
 *   몰 = 결제된 구매(netPurchaseSql) 전부 · 원장 = 고객이 있는 구매 행(CT-D6 · 환불 행 뺌) 중 몰과 같은 구매가 아닌 것(CT-D1).
 *   원장 at = 그날 KST 0시(날짜만 있다) · store = 매장 이름(없으면 매장 코드) · 몰 store = NULL.
 *   ⛔ 이 조각 밖에서 원장과 몰 결제를 한 집계로 더하지 않는다(계약 시험 two-door-purchase-contract).
 */
export function purchaseFactsSql(o: PurchaseFactsOptions): string {
  const mallCust = o.customerIdsRef ? ` AND f.customer_id = ANY(${o.customerIdsRef})` : '';
  const ledgerCust = o.customerIdsRef ? ` AND p.customer_id = ANY(${o.customerIdsRef})` : '';
  const mallSince = o.sinceAt ? ` AND f.occurred_at >= ${o.sinceAt}` : '';
  const ledgerSince = o.sinceAt ? ` AND p.purchase_date >= ((${o.sinceAt}) AT TIME ZONE 'Asia/Seoul')::date` : '';
  const ledgerDated = o.undated ? '' : ' AND p.purchase_date IS NOT NULL';
  return `SELECT 'mall'::text AS door, f.customer_id, (f.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day, f.occurred_at AS at,
         ${mallAmountSql('f')} AS amount, NULL::text AS store, f.id::text AS source_id, f.properties AS properties
    FROM cdp_events f
   WHERE f.company_id = ${o.companyRef} AND ${netPurchaseSql('f')} AND f.customer_id IS NOT NULL${mallCust}${mallSince}
  UNION ALL
  SELECT 'ledger'::text AS door, p.customer_id, p.purchase_date::date AS kst_day, (p.purchase_date AT TIME ZONE 'Asia/Seoul') AS at,
         p.total_amount AS amount, COALESCE(NULLIF(p.store_name, ''), p.store_code)::text AS store, p.id::text AS source_id,
         jsonb_strip_nulls(jsonb_build_object('total_amount', p.total_amount, 'product_name', p.product_name, 'product_code', p.product_code)) AS properties
    FROM ${LEDGER_PURCHASES_SQL} p
   WHERE p.company_id = ${o.companyRef} AND p.customer_id IS NOT NULL${ledgerDated}${ledgerCust}${ledgerSince}
     AND NOT ${ledgerDupOfMallSql('p')}`;
}

// ── CT-D4 구매 있었나 ──

/**
 * 이 시각(timestamptz 식) 뒤에 샀나 — 몰 결제(시각 비교) 또는 원장(날짜만 = 기준 시각의 KST 날짜 다음 날부터 · 목표 판정과 같은 규칙).
 *   별칭(pa · pl)은 이 조각 안에서만 쓴다.
 */
export function purchaseAfterSql(customerExpr: string, companyRef: string, afterExpr: string): string {
  return `(EXISTS (SELECT 1 FROM cdp_events pa
                    WHERE pa.company_id = ${companyRef} AND pa.customer_id = ${customerExpr}
                      AND ${netPurchaseSql('pa')} AND pa.occurred_at > ${afterExpr})
        OR EXISTS (SELECT 1 FROM ${LEDGER_PURCHASES_SQL} pl
                    WHERE pl.company_id = ${companyRef} AND pl.customer_id = ${customerExpr}
                      AND pl.purchase_date IS NOT NULL
                      AND pl.purchase_date > (${afterExpr} AT TIME ZONE 'Asia/Seoul')))`;
}

/**
 * 지난 N일(정수 식) 안에 샀나 — 몰 = 결제 시각 ≥ 지금 − N일 · 원장 = 구매일 ≥ KST 오늘 − N일(조건 칸 「지난 N일」).
 */
export function purchaseWithinDaysSql(customerExpr: string, companyRef: string, daysExpr: string): string {
  return `(EXISTS (SELECT 1 FROM cdp_events pa
                    WHERE pa.company_id = ${companyRef} AND pa.customer_id = ${customerExpr}
                      AND ${netPurchaseSql('pa')} AND pa.occurred_at >= NOW() - ((${daysExpr})::int * INTERVAL '1 day'))
        OR EXISTS (SELECT 1 FROM ${LEDGER_PURCHASES_SQL} pl
                    WHERE pl.company_id = ${companyRef} AND pl.customer_id = ${customerExpr}
                      AND pl.purchase_date IS NOT NULL
                      AND pl.purchase_date >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - (${daysExpr})::int)))`;
}

// ── CT-D5 구매 진입 소유 ──

/** 진입 표식의 날짜 = KST 'YYYY-MM-DD'(몰 = 결제 시각의 KST 날짜 · 원장 = 구매일). */
export function mallEntryDaySql(e: string): string {
  return `to_char((${e}.occurred_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')`;
}
export function ledgerEntryDaySql(p: string): string {
  return `to_char(${p}.purchase_date::date, 'YYYY-MM-DD')`;
}

/**
 * 이 계보(uuid[] 식)에 같은 고객 · 같은 날 · **다른 문** 표식으로 트리거 진입한 실행이 있나(SQL 불리언).
 *   진입 표식 = entry_event_properties.__entry = { src: 'trigger', key, door, day }(구매 계열 진입 반복문이 남긴다).
 *   문 · 날짜가 없는 옛 표식 = 판정 밖(지금 두 문 회사 0 · C99-S0).
 *   커서 행 SQL(후보가 태어나는 자리)과 넣기 반복문(계보 잠금 안 다시 보기) 두 겹이 같은 조각을 쓴다.
 */
export function crossDoorEntryOwnedSql(lineageRef: string, customerRef: string, doorRef: string, dayRef: string): string {
  return `EXISTS (SELECT 1 FROM journey_executions xo
                   WHERE xo.journey_id = ANY(${lineageRef}::uuid[]) AND xo.customer_id = ${customerRef}
                     AND xo.entry_event_properties->'__entry'->>'src' = 'trigger'
                     AND xo.entry_event_properties->'__entry'->>'door' IN ('mall', 'ledger')
                     AND xo.entry_event_properties->'__entry'->>'door' <> ${doorRef}
                     AND xo.entry_event_properties->'__entry'->>'day' = ${dayRef})`;
}

// ── 회사 잠금 · 회사 갈래 ──

type Run = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

/**
 * 회사 구매 요약 잠금 — 고객 업서트 · 원장 적재 · 몰 주문 · 두 문 전환 패스가 **첫 쓰기 전에** 잡는다(트랜잭션 끝까지).
 *   같은 회사의 세 쓰기가 줄을 서므로 「두 문이 되는 순간」이 한 번에 하나다(Codex 설계 3R #3). 잠금 순서 = 회사 → 고객 행.
 */
export async function lockCompanyPurchaseSummary(run: Run, companyId: string): Promise<void> {
  await run(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('purchase-summary'))`, [companyId]);
}

export type PurchaseSummaryBranch = 'two_door' | 'store' | 'mall' | 'none';

/**
 * 회사 갈래 — 잠근 뒤 **같은 연결의 새 문장**으로 판정한다(전역 조회 · 캐시 재사용 금지).
 *   두 문 = 몰 결제 사실(netPurchaseSql = CT-D2 가 세는 몰 사실과 같은 판정)과 원장 행이 다 있음
 *          **또는** companies.two_door_since 가 있음(한 번 두 문이면 계속 · 고객 · 구매를 지워도 그대로 · Codex 설계 5R #1 · 6R #1).
 *   ★ Codex 구현 2R — 옛 판정 = 몰 매출 「표식」(revenue_applied · revenue_reversed). 사실은 표식 없는 옛 결제(마커 도입 전 · status 결제)도 몰 구매로 세어
 *     갈래와 사실이 어긋났다(원장 + 옛 결제만 있는 회사 = 갈래 「매장만」인데 사실은 두 문 · 첫 취소의 차감 표식이 그 순간 회사를 두 문으로 바꿔도 이미 판정한
 *     갈래로 단순 차감). 갈래 = 사실과 같은 조각 하나.
 *   두 문을 처음 본 트랜잭션이 two_door_since 를 한 번만 쓴다(WHERE two_door_since IS NULL · 되돌려지면 이력도 없다).
 *   칸이 없으면(C99-DDL-2 전 · 42703) 던진다 = 그 요청 되돌림 + 503 DB_MIGRATION_PENDING(호출부 · db_alter_safety_net).
 */
export async function resolvePurchaseSummaryBranch(run: Run, companyId: string): Promise<PurchaseSummaryBranch> {
  const r = await run(
    `SELECT c.two_door_since IS NOT NULL AS sticky,
            EXISTS (SELECT 1 FROM cdp_events e WHERE e.company_id = c.id AND ${netPurchaseSql('e')}) AS mall,
            ${companyLedgerExistsSql('c')} AS ledger
       FROM companies c WHERE c.id = $1::uuid`,
    [companyId],
  );
  const x = r.rows[0];
  if (!x) return 'none';
  if (x.sticky) return 'two_door';
  if (x.mall && x.ledger) {
    await run(`UPDATE companies SET two_door_since = NOW() WHERE id = $1::uuid AND two_door_since IS NULL`, [companyId]);
    return 'two_door';
  }
  if (x.ledger) return 'store';
  if (x.mall) return 'mall';
  return 'none';
}
