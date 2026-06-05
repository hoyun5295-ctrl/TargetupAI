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

/**
 * 발송 시점 JS 판정 — buildJourneySafetyFilter의 customer 컬럼 기준과 100% 동일.
 *   진입(추출)과 발송 사이에 고객이 비활성/수신거부/무효로 바뀌어도 발송 직전 한 번 더 막는다.
 *   - is_active = true (NULL=불가, `= true`와 동일 엄격)
 *   - sms_opt_in = true (NULL=불가)
 *   - is_opt_out IS NOT TRUE (NULL/false=가능)
 *   - is_invalid IS NOT TRUE (NULL/false=가능)
 * 수신거부(unsubscribes) 안티조인은 DB 조회라 호출부에서 별도 처리(회사+전화 기준).
 */
export function isCustomerSendable(c: {
  is_active?: boolean | null;
  sms_opt_in?: boolean | null;
  is_opt_out?: boolean | null;
  is_invalid?: boolean | null;
}): boolean {
  return c.is_active === true && c.sms_opt_in === true && c.is_opt_out !== true && c.is_invalid !== true;
}

/**
 * 진입 안티조인 — 이미 진입했거나 재진입 cooldown 안인 고객을 추출에서 제외(휴면·생일·포인트).
 *   SQL 자체 dedup이 없던 trigger의 LIMIT 창이 회차마다 다음 분으로 밀리게 해 501번째+ 영구 누락을 막는다.
 *   판정 기준 = checkCooldown(trigger-watcher)과 동일:
 *     - 재진입 불가 → execution이 하나라도 있으면 제외
 *     - 재진입 가능 + cooldown>0 → active이거나 마지막 진입이 cooldown 안이면 제외
 *     - 재진입 가능 + cooldown<=0 → 제외 없음(무제한 재진입, LIMIT 스로틀만)
 *   params에 push(applyCustomerConditions와 동일 패턴) — 호출부는 cond 앞에 둔다. 반환은 'AND ...' 또는 ''.
 *   검증 컬럼: journey_executions.journey_id·customer_id·status·entered_at(executor·watcher 사용 중).
 */
export function buildReentryAntiJoin(
  alias: string,
  params: any[],
  journeyId: string,
  allowReentry: boolean,
  cooldownDays: number,
): string {
  const a = alias;
  if (!allowReentry) {
    params.push(journeyId);
    return `AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $${params.length}::uuid AND je.customer_id = ${a}.id)`;
  }
  const cd = Math.floor(Number(cooldownDays) || 0);
  if (cd <= 0) return '';
  params.push(journeyId);
  const jIdx = params.length;
  params.push(String(cd));
  const cdIdx = params.length;
  return `AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $${jIdx}::uuid AND je.customer_id = ${a}.id AND (je.status = 'active' OR je.entered_at > NOW() - ($${cdIdx} || ' days')::interval))`;
}
