/**
 * journey-goal-purchase.ts — 「이 여정에 들어온 뒤 구매했나」 판정 한 곳
 *   (★ 2026-10-25 여정 구조체크 2차 #13 · 뿌리 대장 R1 「같은 판정 두 벌」)
 *
 * 왜 있나
 *   같은 판정을 실행기 목표(구매 목표 종료) · 조건 칸(purchase_since_entry) · 지도 「곧 마칠 예정」 숫자가 따로 적었다.
 *   1019 B-1009-4(가입 여정 = 가입 묶음으로 같이 들어온 구매도 목표)를 실행기 목표에만 넣어, 조건 칸과 지도 숫자는 옛 세 신호였고
 *   지도 카드 문장은 매장 문 회사에 「환영 문자와 첫 구매 문자를 둘 다 받아요」(고치기 전 동작)라고 말했다.
 *
 * 신호(SQL 원문 = 0710 ~ 0929 목표 판정 · 1019 가입 묶음 그대로 · 한 문장으로 모음)
 *   ① 프로필 최근 구매일 > 진입일(KST · 엄격) ② 자사몰 구매 사건 > 진입 시각 ③ 매장 원장 구매일 > 진입 시각(KST naive)
 *   ④ 가입 여정만: 고객 행이 들어온 뒤(도착 축) 들어온 원장 구매(싱크가 가입 고객과 그 구매를 한 묶음으로 보낸다)
 */
import { netPurchaseSql } from './cdp-order-revenue';   // ★ 2026-11-02 결제된 구매 CT(CT-J3)
import { kstNotFutureSql, purchaseAfterSql, LEDGER_PURCHASES_SQL } from './two-door-purchase';   // ★ 2026-11-04 C99 CT-D4 구매 있었나

/**
 * 판정 SQL 조각. e = 실행 행 별칭(customer_id · entered_at 칸) · companyParam = 회사 id 자리($n) · signupExpr = 가입 여정인가(SQL 불리언).
 * 별칭은 이 조각 안에서만 쓰는 이름(pc · pe · pp · pb · cb)이라 호출부 별칭과 겹치지 않는다.
 */
export function purchasedSinceEntrySql(e: string, companyParam: string, signupExpr: string): string {
  return `(
    EXISTS (SELECT 1 FROM customers pc
             WHERE pc.id = ${e}.customer_id AND pc.company_id = ${companyParam}
               AND pc.recent_purchase_date IS NOT NULL
               AND pc.recent_purchase_date > (${e}.entered_at AT TIME ZONE 'Asia/Seoul')::date
               AND ${kstNotFutureSql('pc.recent_purchase_date')})   -- ★ C102 Codex 4R 미래 최근일 = 아직 안 산 것
    OR ${purchaseAfterSql(`${e}.customer_id`, companyParam, `${e}.entered_at`)}   -- ★ 2026-11-04 C99 몰 · 원장 갈래 = CT-D4 한 벌(기다리기 · 조건 칸과 같은 규칙)
    OR ((${signupExpr}) AND EXISTS (SELECT 1 FROM ${LEDGER_PURCHASES_SQL} pb   -- ★ 2026-11-04 C102 G1(CT-D6)
                                     JOIN customers cb ON cb.id = pb.customer_id AND cb.company_id = pb.company_id
                                    WHERE pb.company_id = ${companyParam} AND pb.customer_id = ${e}.customer_id
                                      AND pb.created_at >= cb.created_at
                                      -- ★ C102 Codex 4R — 도착 시각만으로 가입 묶음을 정하지 않는다(G7 고객 잇기가 오래된 구매의 도착을 지금으로 바꾼다)
                                      AND (pb.purchase_date IS NULL OR pb.purchase_date >= ((cb.created_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Seoul')::date)))
  )`;
}

/** 실행 한 건 판정 문장 — $1 회사 · $2 고객 · $3 진입 시각 · $4 가입 여정인가. */
export const PURCHASED_SINCE_ENTRY_ONE_SQL =
  `SELECT ${purchasedSinceEntrySql('e', '$1::uuid', '$4::boolean')} AS hit
     FROM (SELECT $2::uuid AS customer_id, $3::timestamptz AS entered_at) e`;

/**
 * ★ 2026-11-02 설계서 3-4 ② — 구매로 들어온 실행 중 그 진입 구매가 지금 결제된 구매가 아닌 것(취소 · 환불 · 결제 되돌림) · $1 실행 id 들 · $2 회사.
 *   진입 표식(__entry = { src: 'trigger', key: 사건 id } · 트리거 진입 반복문이 남긴다)만 본다 · 넘겨받은 진입(src = 'after') · 표식 없는 옛 행 = 판정 안 함(계속).
 *   결제된 구매 판정 = netPurchaseSql 한 곳(CT-J3 · 진입 커서가 같은 조각으로 들였다 → 지금 거짓 = 들어온 뒤 취소 · 환불).
 */
export const ENTRY_PURCHASE_VOIDED_SQL =
  `SELECT e.id FROM journey_executions e
     JOIN cdp_events ev ON ev.company_id = $2::uuid
      AND ev.id = CASE WHEN e.entry_event_properties->'__entry'->>'key' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN (e.entry_event_properties->'__entry'->>'key')::uuid END
    WHERE e.id = ANY($1::uuid[]) AND e.status = 'active'
      AND e.entry_event_properties->'__entry'->>'src' = 'trigger'
      AND ev.event_name = 'purchase' AND NOT ${netPurchaseSql('ev')}`;

/** 여정 시작 사건이 가입인가(가입 묶음 신호를 켜는 조건 · 실행기 · 조건 칸 · 지도가 같은 규칙). */
export const isSignupTrigger = (triggerEvent: string | null | undefined): boolean => String(triggerEvent || '') === 'customer.created';
