/**
 * operator-recipients.ts — 발송 가능 수신자 추출 SQL (공통 안전필터 통일)
 *
 * 순수 함수: 안전필터 + 회사 격리 + storeFilter + filterWhere를 합성한다(DB·필터빌더 미import → 순수 테스트).
 * 안전필터는 buildJourneySafetyFilter(CT) 하나로 통일 —
 *   is_active·sms_opt_in·is_opt_out·is_invalid·수신거부(회사+전화 안티조인).
 * filterWhere/filterParams는 호출부가 buildFilterWhereClauseCompat(CT-01)로 만들어 주입한다.
 * preview-recipients(routes/ai.ts)와 자동마케팅 자율 발송 추출이 같은 SQL을 공유한다.
 *
 * ★ Phase3 C (2026-06-26): excludeClickedSince 지정 시 = 다단계 시퀀스 리마인드 — 1차 발송 후 클릭한
 *   고객(message_click)을 제외(미반응자만). 미지정이면 기존 동작 불변. cdp_events 회사 격리($1) 정합.
 */
import { buildJourneySafetyFilter } from './journey-safety-filter';
// ★ 2026-07-05: 발송 피로도 보호 — 순수 clause 빌더(DB import 0)라 본 모듈 순수성 유지.
import { buildFatigueGuardClause, FatigueCap } from './fatigue-guard-core';

export function buildSendableRecipientsSql(
  filterWhere: string,   // buildFilterWhereClauseCompat(...).sql ('' 가능)
  filterParams: any[],   // buildFilterWhereClauseCompat(...).params
  baseParams: any[],     // [companyId, ...storeScope]
  storeFilter: string,   // ' AND id IN (...)' 또는 '' (단일 테이블이라 미qualified id = c.id)
  excludeClickedSince?: Date | null,  // 지정 시 그 시각 이후 message_click 한 고객 제외(미반응자 리마인드)
): { sql: string; params: any[] } {
  const params = [...baseParams, ...filterParams];
  let clickGuard = '';
  if (excludeClickedSince) {
    params.push(excludeClickedSince);
    clickGuard =
      `AND NOT EXISTS (
         SELECT 1 FROM cdp_events ce
          WHERE ce.customer_id = c.id
            AND ce.company_id = $1
            AND ce.event_name = 'message_click'
            AND ce.occurred_at >= $${params.length}
       )`;
  }
  const sql =
    `SELECT c.id, c.phone, c.name, c.gender, c.region, c.birth_date, c.age, c.grade, c.custom_fields
     FROM customers c
     WHERE c.company_id = $1
       AND ${buildJourneySafetyFilter('c')}
       ${storeFilter}
       ${filterWhere}
       ${clickGuard}
     LIMIT 10000`;
  return { sql, params };
}

/**
 * 발송용 수신자 → campaign_send_staging 서버사이드 직접 적재 (상한 없음).
 *
 * preview용 buildSendableRecipientsSql은 화면 표본이라 LIMIT을 두지만, 실발송은 전량을 적재해야 한다.
 * 임의 상한(옛 LIMIT 10000 공유)은 초과 수신자를 조용히 누락시킨다 — 통제선은 고객 예산·선불 잔액뿐(우리 강제 상한 0).
 * phone·name만 서버에서 staging으로 SELECT-INSERT(Node 왕복·대량 메모리 없음).
 * 안전필터·미클릭가드는 buildSendableRecipientsSql과 100% 동일(같은 buildJourneySafetyFilter·cdp_events 안티조인).
 *
 * param 배치: companyId=$1, filterParams=$2+, (excludeClickedSince), stagingId=마지막.
 * 반환 { sql, params } — 호출부가 query 후 result.rowCount로 적재(=발송 대상) 건수를 얻는다.
 */
/**
 * ★ 2026-07-10 [타겟확인] — 추천 카드 발송 대상 명단 조회 (상한 100 단일 쿼리).
 *   SoT: docs/superpowers/specs/2026-07-10-send-target-list-three-phase-design.md §3-1①.
 *   WHERE 조각은 buildSendableStagingInsertSql(발송 추출)과 동일 합성(안전필터+클릭제외+피로도) —
 *   "보여준 명단 = 나가는 명단"을 구조적으로 보장한다(원칙 2). COUNT·OFFSET 없음(부하 상수화, Harold 상한 확정).
 *   ORDER BY = 발송 추출과 동일 기준(추출 SQL에 ORDER 없음 → c.id ASC 결정적 정렬로 통일).
 *
 *   순수성: standard-field-map은 config/database를 import하므로 여기서 직접 import하지 않는다
 *   (verify 순수 테스트 process.exit 차단 — LESSONS_BACKEND "순수 테스트 DB-free 분리").
 *   조건 필드 정의(FIELD_MAP)는 filterWhere처럼 호출부가 주입한다.
 */

/** 조건 컬럼 해석에 필요한 FIELD_MAP 최소 형태 (StandardFieldMapping 구조 부분집합 — 호출부가 FIELD_MAP을 그대로 주입) */
export interface ConditionFieldDef {
  fieldKey: string;
  displayName: string;
  storageType: 'column' | 'custom_fields';
  columnName: string;
}

/** 해석된 조건 컬럼 — select는 주입된 defs(FIELD_MAP 상수)로만 합성되어 SQL 주입이 차단된다 */
export interface ResolvedConditionColumn {
  key: string;    // fieldKey (recipients 행의 속성명)
  label: string;  // FIELD_MAP displayName (라벨 단일 소스 — 0709 개인화 라벨 통일 교훈)
  select: string; // SELECT 절 조각 (c.<col> AS <key> 또는 custom_fields->>)
}

/**
 * proposal 필터(proposal_json.target.filters — CT-01 호환 형태)에서 "조건에 쓰인 필드"를 추출해
 * 주입된 FIELD_MAP 정의 화이트리스트로 컬럼·라벨을 확정한다. 미등록 키·빈 값은 건너뛴다.
 * CT-01 특수 키: minAge/min_age/maxAge/max_age → age, 'custom_fields.custom_N' 접두 → custom_N.
 * 반환 순서 = defs(FIELD_MAP sortOrder) 순서 — 결정적.
 */
export function resolveConditionColumns(filters: any, defs: ConditionFieldDef[]): ResolvedConditionColumn[] {
  const used = new Set<string>();
  for (const [rawKey, cond] of Object.entries(filters || {})) {
    const v = cond !== null && typeof cond === 'object' && !Array.isArray(cond) && (cond as any).value !== undefined
      ? (cond as any).value
      : cond;
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    let key = rawKey;
    if (key.startsWith('custom_fields.')) key = key.slice('custom_fields.'.length);
    if (key === 'minAge' || key === 'min_age' || key === 'maxAge' || key === 'max_age') key = 'age';
    if (key === 'phone' || key === 'name') continue; // 기본 컬럼(이름·연락처)과 중복
    used.add(key);
  }
  return defs
    .filter((d) => used.has(d.fieldKey) && d.fieldKey !== 'phone' && d.fieldKey !== 'name')
    .map((d) => ({
      key: d.fieldKey,
      label: d.displayName,
      select: d.storageType === 'custom_fields'
        ? `c.custom_fields->>'${d.columnName}' AS ${d.fieldKey}`
        : `c.${d.columnName} AS ${d.fieldKey}`,
    }));
}

/**
 * 상한 100 명단 SQL. extraColumns는 반드시 resolveConditionColumns 산출물만 전달한다(화이트리스트 밖 select 금지).
 * param 배치 = buildSendableStagingInsertSql과 동일: baseParams(companyId 선두), filterParams, (since), (fatigue days·max).
 */
export function buildSendableRecipientsTopSql(
  filterWhere: string,   // buildFilterWhereClauseCompat(...).sql ('' 가능)
  filterParams: any[],
  baseParams: any[],     // [companyId, ...storeScope]
  storeFilter: string,   // ' AND id IN (...)' 또는 ''
  excludeClickedSince?: Date | null,
  fatigueCap?: FatigueCap | null,
  extraColumns?: ResolvedConditionColumn[],
  limit = 100,
): { sql: string; params: any[] } {
  const params = [...baseParams, ...filterParams];
  let clickGuard = '';
  if (excludeClickedSince) {
    params.push(excludeClickedSince);
    clickGuard =
      `AND NOT EXISTS (
         SELECT 1 FROM cdp_events ce
          WHERE ce.customer_id = c.id
            AND ce.company_id = $1
            AND ce.event_name = 'message_click'
            AND ce.occurred_at >= $${params.length}
       )`;
  }
  const fatigueGuard = fatigueCap ? buildFatigueGuardClause(params, fatigueCap, 'c') : '';
  const extras = (extraColumns || []).map((c) => c.select);
  const lim = Math.max(1, Math.min(100, Math.floor(Number(limit) || 100)));
  const sql =
    `SELECT c.phone, c.name${extras.length ? ', ' + extras.join(', ') : ''}
     FROM customers c
     WHERE c.company_id = $1
       AND ${buildJourneySafetyFilter('c')}
       ${storeFilter}
       ${filterWhere}
       ${clickGuard}
       ${fatigueGuard}
     ORDER BY c.id ASC
     LIMIT ${lim}`;
  return { sql, params };
}

export function buildSendableStagingInsertSql(
  stagingId: string,
  companyId: string,
  filterWhere: string,   // buildFilterWhereClauseCompat(filters, 2).sql ('' 가능) — companyId가 $1이므로 시작 인덱스 2
  filterParams: any[],
  storeFilter: string,   // operator 발송은 '' (store-scope 없음). 넘길 경우 $1=company 기준으로 합성됨.
  excludeClickedSince?: Date | null,
  // ★ 2026-07-05: 발송 피로도 보호 — cap 지정 시 최근 N일 M건+ 수신자를 추출 단계에서 제외(차감 전 = 환불 불필요)
  fatigueCap?: FatigueCap | null,
): { sql: string; params: any[] } {
  const params: any[] = [companyId, ...filterParams];
  let clickGuard = '';
  if (excludeClickedSince) {
    params.push(excludeClickedSince);
    clickGuard =
      `AND NOT EXISTS (
         SELECT 1 FROM cdp_events ce
          WHERE ce.customer_id = c.id
            AND ce.company_id = $1
            AND ce.event_name = 'message_click'
            AND ce.occurred_at >= $${params.length}
       )`;
  }
  const fatigueGuard = fatigueCap ? buildFatigueGuardClause(params, fatigueCap, 'c') : '';
  params.push(stagingId);
  const stgIdx = params.length;
  const sql =
    `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name)
     SELECT $${stgIdx}::uuid, $1::uuid,
            COALESCE(regexp_replace(c.phone, '[^0-9]', '', 'g'), ''), c.name
       FROM customers c
      WHERE c.company_id = $1
        AND ${buildJourneySafetyFilter('c')}
        ${storeFilter}
        ${filterWhere}
        ${clickGuard}
        ${fatigueGuard}`;
  return { sql, params };
}
