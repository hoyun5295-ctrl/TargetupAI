/**
 * operator-recipients.ts — 발송 가능 수신자 추출 SQL (공통 안전필터 통일)
 *
 * 순수 함수: 안전필터 + 회사 격리 + storeFilter + filterWhere를 합성한다(DB·필터빌더 미import → 순수 테스트).
 * 안전필터는 buildJourneySafetyFilter(CT) 하나로 통일 —
 *   is_active·sms_opt_in·is_opt_out·is_invalid·수신거부(회사+전화 안티조인).
 * filterWhere/filterParams는 호출부가 buildFilterWhereClauseCompat(CT-01)로 만들어 주입한다.
 * preview-recipients(routes/ai.ts)와 자동마케팅 자율 발송 추출이 같은 SQL을 공유한다.
 */
import { buildJourneySafetyFilter } from './journey-safety-filter';

export function buildSendableRecipientsSql(
  filterWhere: string,   // buildFilterWhereClauseCompat(...).sql ('' 가능)
  filterParams: any[],   // buildFilterWhereClauseCompat(...).params
  baseParams: any[],     // [companyId, ...storeScope]
  storeFilter: string,   // ' AND id IN (...)' 또는 '' (단일 테이블이라 미qualified id = c.id)
): { sql: string; params: any[] } {
  const sql =
    `SELECT c.id, c.phone, c.name, c.gender, c.region, c.birth_date, c.age, c.grade, c.custom_fields
     FROM customers c
     WHERE c.company_id = $1
       AND ${buildJourneySafetyFilter('c')}
       ${storeFilter}
       ${filterWhere}
     LIMIT 10000`;
  return { sql, params: [...baseParams, ...filterParams] };
}
