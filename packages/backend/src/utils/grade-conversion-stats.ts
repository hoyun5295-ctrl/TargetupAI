/**
 * ★ CT: 등급별 발송 후 구매 실측 전환율 — operator-performance-estimator Layer 1 전용 (D227+ 2026-05-31)
 *
 * 목적
 *   과거 완료 캠페인 중 target_filter의 grade가 대상 등급과 겹치는 캠페인의 발송 합(분모) vs
 *   그 캠페인 발송 후 windowDays 내 cdp_events purchase한 동일 등급 customer 수(분자)
 *   → 그 회사 등급별 실제 전환율(상수 0). 표본 충분 시에만 채택.
 *
 * 데이터 의존
 *   cdp_events.event_name IN ('purchase','order') AND customer_id IS NOT NULL 이 채워져야 분자 > 0.
 *   현재(2026-05-31) 전 회사 cdp purchase 0건 → converted 0 → sampleOk false →
 *   호출측(estimatePerformance)이 자동으로 Layer 2(구매주기)로 강등. cdp가 쌓이면 자동 활성.
 *
 * 컬럼 검증 완료(information_schema): campaigns(target_filter jsonb, sent_at, sent_count, status, company_id)
 *   / cdp_events(customer_id uuid, event_name, occurred_at, company_id, id) / customers(id uuid, company_id, grade)
 *   JOIN 타입 cdp_events.customer_id(uuid) = customers.id(uuid).
 */
import { query } from '../config/database';

export interface GradeConversionStat {
  grade: string;
  sent: number;       // 그 등급 대상 완료 캠페인의 발송 합 (분모)
  converted: number;  // 발송 후 windowDays 내 구매한 동일 등급 distinct customer (분자)
  cvr: number;        // converted / sent
  sampleOk: boolean;  // 표본 신뢰 (sent ≥ minSample AND converted > 0)
}

/**
 * 타겟 등급들의 과거 발송 후 구매 실측 전환율 조회.
 *
 * target_filter의 grade.value는 문자열("VIP") 또는 배열(["VIP"]) 두 형태 모두 존재 →
 * jsonb_typeof 분기로 양쪽 다 펼쳐서 매칭.
 *
 * @param companyId    회사 ID (격리 필수)
 * @param targetGrades 대상 등급 목록
 * @param windowDays   발송 후 구매 집계 윈도우 (기본 7일 — attribution 표준)
 * @param lookbackDays 과거 캠페인 조회 기간 (기본 180일)
 * @param minSample    표본 신뢰 최소 발송수 (기본 300)
 */
export async function fetchGradeConversionStats(
  companyId: string,
  targetGrades: string[],
  windowDays = 7,
  lookbackDays = 180,
  minSample = 300,
): Promise<Map<string, GradeConversionStat>> {
  const result = new Map<string, GradeConversionStat>();
  const grades = (targetGrades || []).filter((g) => g && g !== '(미분류)');
  if (grades.length === 0) return result;

  const r = await query(
    `WITH grade_campaigns AS (
       SELECT c.id, c.sent_at, c.sent_count, gx.grade
       FROM campaigns c
       CROSS JOIN LATERAL (
         SELECT CASE
           WHEN jsonb_typeof(c.target_filter->'grade'->'value') = 'array'
             THEN c.target_filter->'grade'->'value'
           WHEN c.target_filter->'grade'->>'value' IS NOT NULL
             THEN jsonb_build_array(c.target_filter->'grade'->'value')
           ELSE '[]'::jsonb
         END AS garr
       ) gv
       CROSS JOIN LATERAL jsonb_array_elements_text(gv.garr) AS gx(grade)
       WHERE c.company_id = $1::uuid
         AND c.status = 'completed'
         AND c.sent_at IS NOT NULL
         AND c.sent_at > NOW() - ($3 || ' days')::interval
         AND gx.grade = ANY($2::text[])
     )
     SELECT gc.grade,
            COALESCE(SUM(gc.sent_count), 0)::bigint AS sent,
            COUNT(DISTINCT e.customer_id)::bigint   AS converted
     FROM grade_campaigns gc
     LEFT JOIN cdp_events e
            ON e.company_id = $1::uuid
           AND e.event_name IN ('purchase','order')
           AND e.customer_id IS NOT NULL
           AND e.occurred_at >= gc.sent_at
           AND e.occurred_at <= gc.sent_at + ($4 || ' hours')::interval
           AND EXISTS (
             SELECT 1 FROM customers cu
              WHERE cu.id = e.customer_id
                AND cu.company_id = $1::uuid
                AND cu.grade = gc.grade
           )
     GROUP BY gc.grade`,
    [companyId, grades, lookbackDays, windowDays * 24],
  );

  for (const row of r.rows) {
    const sent = Number(row.sent) || 0;
    const converted = Number(row.converted) || 0;
    const cvr = sent > 0 ? converted / sent : 0;
    result.set(String(row.grade), {
      grade: String(row.grade),
      sent,
      converted,
      cvr,
      sampleOk: sent >= minSample && converted > 0,
    });
  }
  return result;
}
