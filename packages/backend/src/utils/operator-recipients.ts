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
