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

/**
 * 판정 SQL 조각. e = 실행 행 별칭(customer_id · entered_at 칸) · companyParam = 회사 id 자리($n) · signupExpr = 가입 여정인가(SQL 불리언).
 * 별칭은 이 조각 안에서만 쓰는 이름(pc · pe · pp · pb · cb)이라 호출부 별칭과 겹치지 않는다.
 */
export function purchasedSinceEntrySql(e: string, companyParam: string, signupExpr: string): string {
  return `(
    EXISTS (SELECT 1 FROM customers pc
             WHERE pc.id = ${e}.customer_id AND pc.company_id = ${companyParam}
               AND pc.recent_purchase_date IS NOT NULL
               AND pc.recent_purchase_date > (${e}.entered_at AT TIME ZONE 'Asia/Seoul')::date)
    OR EXISTS (SELECT 1 FROM cdp_events pe
                WHERE pe.company_id = ${companyParam} AND pe.customer_id = ${e}.customer_id
                  AND pe.event_name = 'purchase' AND pe.occurred_at > ${e}.entered_at)
    OR EXISTS (SELECT 1 FROM purchases pp
                WHERE pp.company_id = ${companyParam} AND pp.customer_id = ${e}.customer_id
                  AND pp.purchase_date IS NOT NULL
                  AND pp.purchase_date > (${e}.entered_at AT TIME ZONE 'Asia/Seoul'))
    OR ((${signupExpr}) AND EXISTS (SELECT 1 FROM purchases pb
                                     JOIN customers cb ON cb.id = pb.customer_id AND cb.company_id = pb.company_id
                                    WHERE pb.company_id = ${companyParam} AND pb.customer_id = ${e}.customer_id
                                      AND pb.created_at >= cb.created_at))
  )`;
}

/** 실행 한 건 판정 문장 — $1 회사 · $2 고객 · $3 진입 시각 · $4 가입 여정인가. */
export const PURCHASED_SINCE_ENTRY_ONE_SQL =
  `SELECT ${purchasedSinceEntrySql('e', '$1::uuid', '$4::boolean')} AS hit
     FROM (SELECT $2::uuid AS customer_id, $3::timestamptz AS entered_at) e`;

/** 여정 시작 사건이 가입인가(가입 묶음 신호를 켜는 조건 · 실행기 · 조건 칸 · 지도가 같은 규칙). */
export const isSignupTrigger = (triggerEvent: string | null | undefined): boolean => String(triggerEvent || '') === 'customer.created';
