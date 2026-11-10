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
export function buildJourneySafetyFilter(alias: string, consentTrue?: string): string {
  // ★ 2026-10-02 consentTrue = 수신동의 조각(mall-consent consentSql().isTrue). 안 주면 고객 행 열(옛 글자 그대로).
  //   몰 동의 회사는 호출부가 주인 기준 조각(여정 = journeyOwnerConsent · 그 밖 = ownerConsentTrue)을 넘긴다.
  const a = alias;
  return (
    `${a}.is_active = true ` +
    `AND ${consentTrue || `${a}.sms_opt_in = true`} ` +
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
}, opts: { informational?: boolean } = {}): boolean {
  // ★ 2026-11-02 설계서 3-11 · §4 ⑦ — 정보성 칸(알림톡 = 광고 판정 CT 가 false) = 활성 · 번호 유효만(광고 동의 · 광고 거부 · 080 거부는 광고 칸만)
  if (opts.informational) return c.is_active === true && c.is_invalid !== true;
  return c.is_active === true && c.sms_opt_in === true && c.is_opt_out !== true && c.is_invalid !== true;
}

/**
 * 진입 안티조인 — 이미 진입했거나 재진입 cooldown 안인 고객을 추출에서 제외(휴면·생일·포인트).
 *   SQL 자체 dedup이 없던 trigger의 LIMIT 창이 회차마다 다음 분으로 밀리게 해 501번째+ 영구 누락을 막는다.
 *   판정 기준 = checkCooldown(trigger-watcher)과 동일:
 *     - 재진입 불가 → execution이 하나라도 있으면 제외
 *     - 재진입 가능 + cooldown>0 → active이거나 마지막 진입이 cooldown 안이면 제외
 *     - 재진입 가능 + cooldown<=0 → 지금 진행 중(active)만 제외(★ 2026-11-05 C105 H3 · 진입 넣기 가드 `reentryGuard` 와 같은 집합 · 계보면 계보 전체)
 *   params에 push(applyCustomerConditions와 동일 패턴) — 호출부는 cond 앞에 둔다. 반환은 'AND ...' 또는 ''.
 *   검증 컬럼: journey_executions.journey_id·customer_id·status·entered_at(executor·watcher 사용 중).
 */
/**
 * ★ 2026-11-10 C123(뿌리 R87) — 재진입 허용 여정에서 「이 실행이 있으면 다시 넣지 않는다」 조각(실행을 넣는 자리의 실행 시점 관문 · 저장값과 무관).
 *   최솟값 0(사건 키로 한 번만 들어오는 시작) = 진행 중만(옛 글자 그대로) · 1 이상 = 진행 중 또는 **끝난 지 계약 최솟값 안**
 *   (끝난 시각이 없는 실행 = 들어온 시각 · 상태 무관 = 방금 「이 발송 정지」로 끝낸 실행도 건다).
 *   쓰는 곳 = 뽑기 안티조인(아래) · 진입 감시 묶음 넣기 가드 · 자동 재진입 워커 — 뽑기 수 = 넣기 수(따로 쓴 같은 판정 0).
 *   floorDays = 계약 상수(journey-trigger-capability reentryFloorDays · autoReentryFloorDays)만 넘긴다(사용자 입력 아님 · 정수로 접어 글자로 싣는다).
 */
export function reentryHoldSql(execAlias: string, floorDays: number): string {
  const f = Math.max(0, Math.floor(Number(floorDays) || 0));
  return f > 0
    ? `(${execAlias}.status = 'active' OR COALESCE(${execAlias}.completed_at, ${execAlias}.entered_at) > NOW() - INTERVAL '${f} days')`
    : `${execAlias}.status = 'active'`;
}

export function buildReentryAntiJoin(
  alias: string,
  params: any[],
  journeyId: string,
  allowReentry: boolean,
  cooldownDays: number,
  // ★ 2026-11-10 C123 — 계약 최솟값(필수 인자 · 기본값 없음 = 새 뽑기 갈래가 빠뜨리면 컴파일 실패 · Codex 설계 1R #4)
  floorDays: number,
  // ★ 2026-09-30 여정 V2 5차 — 같은 계보(새 판 · 옛 판) 여정 id. 2개 이상일 때만 계보로 본다(없으면 옛 문장 그대로).
  lineageIds?: string[],
): string {
  const a = alias;
  const lineage = lineageIds && lineageIds.length > 1 ? lineageIds : null;
  if (!allowReentry) {
    params.push(lineage || journeyId);
    const match = lineage ? `je.journey_id = ANY($${params.length}::uuid[])` : `je.journey_id = $${params.length}::uuid`;
    return `AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE ${match} AND je.customer_id = ${a}.id)`;
  }
  const cd = Math.floor(Number(cooldownDays) || 0);
  if (cd <= 0) {
    // ★ 2026-11-05 C105 H3 — 진행 중이면 그 실행에서 마무리한다(지금 여정 · 계보 다른 판 모두 · 이중 진입 0).
    //   = 진입 넣기 가드(journey-trigger-watcher `reentryGuard` = 허용이면 계보 · 지금 여정의 active 제외)와 같은 집합.
    //   옛: 계보 없으면 조건 0 · 있으면 다른 판만 → 뽑기 · 세기가 지금 여정 진행 중 고객까지 세어 넣기 수와 달랐고
    //   「한 번에 최대」를 넘었다며 여정이 멈출 수 있었다(Codex C104 구현 1R [범위 밖]).
    params.push(lineage || journeyId);
    const match = lineage ? `je.journey_id = ANY($${params.length}::uuid[])` : `je.journey_id = $${params.length}::uuid`;
    return `AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE ${match} AND je.customer_id = ${a}.id AND ${reentryHoldSql('je', floorDays)})`;
  }
  params.push(lineage || journeyId);
  const jIdx = params.length;
  params.push(String(cd));
  const cdIdx = params.length;
  const match = lineage ? `je.journey_id = ANY($${jIdx}::uuid[])` : `je.journey_id = $${jIdx}::uuid`;
  return `AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE ${match} AND je.customer_id = ${a}.id AND (${reentryHoldSql('je', floorDays)} OR je.entered_at > NOW() - ($${cdIdx} || ' days')::interval))`;
}
