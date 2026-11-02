/**
 * journey-click.ts — 여정 링크 클릭 판정 한 곳(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-15 · 3-0 CT-J9).
 *
 * 왜 있나
 *   옛 「앞 칸 클릭」 조건 · 목표 「클릭」이 그 칸 · 그 여정 링크가 아니라 고객의 아무 문자 링크 클릭이나 셌다(D12 · D13).
 *   클릭 사건에는 실행기가 링크를 줄일 때 실은 여정 · 칸 id 가 있다(journey-executor shortenUrlsInTexts ctx → routes/short-url 클릭 기록 = properties.journey_id · step_id).
 *   → 조건 · 목표 · 통계가 이 조각 하나로 「그 여정 · 그 칸 링크 클릭」을 고른다.
 */

/**
 * cdp_events 별칭의 「여정 링크 클릭」 조건(WHERE · ON 에 붙인다).
 *   journeyExpr · stepExpr = SQL 식(별칭 칸 · 매개변수) · 비교는 글자로(사건 속성 = 글자 · 형 변환 실패 0).
 */
export function journeyClickSql(eventAlias: string, scope: { companyExpr: string; journeyExpr: string; stepExpr?: string }): string {
  const a = eventAlias;
  return `(${a}.event_name = 'message_click' AND ${a}.company_id = ${scope.companyExpr}`
    + ` AND ${a}.properties->>'journey_id' = (${scope.journeyExpr})::text`
    + (scope.stepExpr ? ` AND ${a}.properties->>'step_id' = (${scope.stepExpr})::text` : '')
    + ')';
}
