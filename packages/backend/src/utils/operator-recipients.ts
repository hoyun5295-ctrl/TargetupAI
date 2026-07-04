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
export function buildSendableStagingInsertSql(
  stagingId: string,
  companyId: string,
  filterWhere: string,   // buildFilterWhereClauseCompat(filters, 2).sql ('' 가능) — companyId가 $1이므로 시작 인덱스 2
  filterParams: any[],
  storeFilter: string,   // operator 발송은 '' (store-scope 없음). 넘길 경우 $1=company 기준으로 합성됨.
  excludeClickedSince?: Date | null,
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
        ${clickGuard}`;
  return { sql, params };
}
