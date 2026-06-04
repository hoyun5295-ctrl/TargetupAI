/**
 * 여정 공통 안전필터 — 모든 trigger 추출이 무조건 적용하는 단일 컨트롤타워.
 *
 * 반환 = customers(또는 customers를 join한 alias)에 대한 SQL 조각(파라미터 0개).
 * 호출부는 ` AND ${buildJourneySafetyFilter('c')}` 형태로 WHERE에 이어 붙인다.
 *
 * 영구 원칙:
 *   - 전 trigger 무조건 적용(customer_conditions 유무와 독립). JOIN 조건부 금지.
 *   - 회사 격리 company_id = $N 절은 각 호출부 WHERE에 이미 있어 그대로 둔다.
 *   - is_opt_out / is_invalid 는 nullable → IS NOT TRUE(NULL=발송 가능).
 *   - 수신거부(unsubscribes)는 회사+전화번호 기준 안티조인(executor의 user_id 기준보다 넓게 차단).
 *
 * 검증된 컬럼(information_schema 2026-06-04):
 *   customers.is_active(bool), sms_opt_in(bool), is_opt_out(bool), is_invalid(bool),
 *   company_id(uuid), phone(varchar) / unsubscribes.company_id, phone.
 */
export function buildJourneySafetyFilter(alias: string): string {
  const a = alias;
  return (
    `${a}.is_active = true ` +
    `AND ${a}.sms_opt_in = true ` +
    `AND ${a}.is_opt_out IS NOT TRUE ` +
    `AND ${a}.is_invalid IS NOT TRUE ` +
    `AND NOT EXISTS (SELECT 1 FROM unsubscribes u ` +
    `WHERE u.company_id = ${a}.company_id AND u.phone = ${a}.phone)`
  );
}
