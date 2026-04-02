/**
 * stats-aggregation.ts — 통계 집계 컨트롤타워
 *
 * manage-stats.ts, results.ts 등에서 반복되는 날짜 범위 필터링(KST),
 * 일별/월별 그루핑, 캠페인 성공/실패 집계 패턴을 한 곳에서 관리.
 *
 * ★ 기능 2 추가: aggregateCampaignPerformance() — AI 캠페인 추천용 성과 집계
 */

import { query } from '../config/database';

// ============================================================
// KST 날짜 범위 필터 빌더
// ============================================================

export interface DateRangeResult {
  sql: string;
  params: any[];
  nextIndex: number;
}

/**
 * KST 기준 날짜 범위 WHERE 절 생성.
 *
 * @param column - 날짜 컬럼명 (예: 'c.sent_at', 'created_at')
 * @param startDate - 시작일 (YYYY-MM-DD 또는 undefined)
 * @param endDate - 종료일 (YYYY-MM-DD 또는 undefined)
 * @param startParamIndex - 파라미터 시작 인덱스
 * @returns {sql, params, nextIndex}
 *
 * @example
 * const dr = buildDateRangeFilter('c.sent_at', '2026-01-01', '2026-01-31', 1);
 * // sql: " AND c.sent_at >= ($1 || ' 00:00:00+09')::timestamptz AND c.sent_at < (($2::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz"
 * // params: ['2026-01-01', '2026-01-31']
 */
export function buildDateRangeFilter(
  column: string,
  startDate?: string,
  endDate?: string,
  startParamIndex: number = 1
): DateRangeResult {
  let sql = '';
  const params: any[] = [];
  let paramIndex = startParamIndex;

  // ★ D104: 명시적 KST timestamptz 구성 — PG session timezone(UTC)에 무관하게 정확
  // '2026-04-02 00:00:00+09' = KST 자정 = UTC 전일 15:00
  if (startDate) {
    sql += ` AND ${column} >= ($${paramIndex} || ' 00:00:00+09')::timestamptz`;
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    sql += ` AND ${column} < (($${paramIndex}::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz`;
    params.push(endDate);
    paramIndex++;
  }

  return { sql, params, nextIndex: paramIndex };
}

/**
 * KST 기준 월별 범위 WHERE 절 생성 (YYYY-MM 형식).
 *
 * @param column - 날짜 컬럼명
 * @param yearMonth - 'YYYYMM' 또는 'YYYY-MM' 형식
 * @param startParamIndex - 파라미터 시작 인덱스
 * @returns {sql, params, nextIndex}
 *
 * @example
 * const dr = buildMonthRangeFilter('created_at', '202603', 2);
 * // sql: " AND created_at >= ($2 || ' 00:00:00+09')::timestamptz AND created_at < (($2::date + interval '1 month')::date::text || ' 00:00:00+09')::timestamptz"
 * // params: ['2026-03-01']
 */
export function buildMonthRangeFilter(
  column: string,
  yearMonth: string,
  startParamIndex: number = 1
): DateRangeResult {
  let sql = '';
  const params: any[] = [];
  let paramIndex = startParamIndex;

  // YYYYMM → YYYY-MM-01
  const normalized = yearMonth.includes('-')
    ? `${yearMonth}-01`
    : `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-01`;

  // ★ D104: 명시적 KST timestamptz 구성
  sql += ` AND ${column} >= ($${paramIndex} || ' 00:00:00+09')::timestamptz`;
  sql += ` AND ${column} < (($${paramIndex}::date + interval '1 month')::date::text || ' 00:00:00+09')::timestamptz`;
  params.push(normalized);
  paramIndex++;

  return { sql, params, nextIndex: paramIndex };
}

/**
 * KST 기준 날짜/월별 fromDate-toDate 범위 WHERE 절 생성.
 * fromDate/toDate가 있으면 그 범위, 없으면 yearMonth 기준 월별.
 *
 * @param column - 날짜 컬럼명
 * @param options - { fromDate?, toDate?, yearMonth? }
 * @param startParamIndex - 파라미터 시작 인덱스
 */
export function buildPeriodFilter(
  column: string,
  options: { fromDate?: string; toDate?: string; yearMonth?: string },
  startParamIndex: number = 1
): DateRangeResult {
  const { fromDate, toDate, yearMonth } = options;

  if (fromDate && toDate) {
    let sql = '';
    const params: any[] = [];
    let paramIndex = startParamIndex;

    // ★ D104: 명시적 KST timestamptz 구성
    sql += ` AND ${column} >= ($${paramIndex} || ' 00:00:00+09')::timestamptz`;
    params.push(String(fromDate));
    paramIndex++;

    sql += ` AND ${column} < (($${paramIndex}::date + interval '1 day')::date::text || ' 00:00:00+09')::timestamptz`;
    params.push(String(toDate));
    paramIndex++;

    return { sql, params, nextIndex: paramIndex };
  }

  if (yearMonth) {
    return buildMonthRangeFilter(column, yearMonth, startParamIndex);
  }

  // 기본: 현재 월
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return buildMonthRangeFilter(column, currentYearMonth, startParamIndex);
}

// ============================================================
// KST 그루핑 표현식
// ============================================================

/**
 * 일별/월별 KST 기준 그루핑 표현식 생성.
 *
 * @param column - 타임스탬프 컬럼명 (예: 'c.sent_at')
 * @param view - 'daily' | 'monthly'
 * @returns TO_CHAR 표현식 문자열
 *
 * @example
 * kstGroupBy('c.sent_at', 'daily')   → "TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')"
 * kstGroupBy('c.sent_at', 'monthly') → "TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')"
 */
export function kstGroupBy(column: string, view: 'daily' | 'monthly'): string {
  const format = view === 'monthly' ? 'YYYY-MM' : 'YYYY-MM-DD';
  return `TO_CHAR(${column} AT TIME ZONE 'Asia/Seoul', '${format}')`;
}

/**
 * KST 기준으로 날짜만 추출하는 표현식.
 *
 * @param column - 타임스탬프 컬럼명
 * @returns "(column AT TIME ZONE 'Asia/Seoul')::date"
 */
export function kstDate(column: string): string {
  return `(${column} AT TIME ZONE 'Asia/Seoul')::date`;
}

// ============================================================
// ★ 기능 2: 캠페인 성과 집계 (AI 다음 캠페인 추천용)
// campaigns + campaign_runs JOIN → 세그먼트별/시간대별/채널별 성과 분석
// ============================================================

export interface CampaignPerformanceData {
  /** 세그먼트별 성과 (target_filter 기반 그루핑) */
  bySegment: Array<{
    segment_summary: string;
    campaign_count: number;
    total_sent: number;
    total_success: number;
    avg_success_rate: number;
  }>;
  /** KST 시간대별 성과 */
  byTimeSlot: Array<{
    hour: number;
    campaign_count: number;
    avg_success_rate: number;
  }>;
  /** 메시지 타입별 성과 */
  byMessageType: Array<{
    message_type: string;
    campaign_count: number;
    total_sent: number;
    avg_success_rate: number;
  }>;
  /** 최근 성과 좋은 캠페인 TOP 5 */
  topCampaigns: Array<{
    campaign_name: string;
    message_type: string;
    target_count: number;
    success_rate: number;
    sent_at: string;
  }>;
  /** 총 캠페인 수 */
  totalCampaigns: number;
  /** 분석 기간 (개월) */
  periodMonths: number;
}

/**
 * 캠페인 성과 집계 (AI 추천용)
 * - 지정된 기간 동안의 캠페인 성과를 다각도로 집계
 * - 발송 후 24시간 이상 경과한 캠페인만 포함 (결과 동기화 보장)
 *
 * @param companyId - 회사 ID
 * @param months - 분석 기간 (기본 3개월)
 */
export async function aggregateCampaignPerformance(
  companyId: string,
  months: number = 3
): Promise<CampaignPerformanceData> {
  const emptyResult: CampaignPerformanceData = {
    bySegment: [],
    byTimeSlot: [],
    byMessageType: [],
    topCampaigns: [],
    totalCampaigns: 0,
    periodMonths: months,
  };

  try {
    // 기본 조건: N개월 이내 + 발송 후 24시간 경과 + completed/sending 상태
    const baseWhere = `
      c.company_id = $1
      AND c.sent_at >= NOW() - INTERVAL '${months} months'
      AND c.sent_at < NOW() - INTERVAL '24 hours'
      AND c.status IN ('completed', 'sending')
      AND c.sent_count > 0
    `;

    // 1) 총 캠페인 수
    const totalResult = await query(
      `SELECT COUNT(*) as cnt FROM campaigns c WHERE ${baseWhere}`,
      [companyId]
    );
    const totalCampaigns = parseInt(totalResult.rows[0].cnt);

    if (totalCampaigns === 0) {
      return emptyResult;
    }

    // 2) 메시지 타입별 성과
    const byTypeResult = await query(
      `SELECT
        c.message_type,
        COUNT(*) as campaign_count,
        SUM(c.sent_count) as total_sent,
        ROUND(AVG(
          CASE WHEN c.sent_count > 0
            THEN COALESCE(c.success_count, 0)::numeric / c.sent_count * 100
            ELSE 0 END
        ), 1) as avg_success_rate
       FROM campaigns c
       WHERE ${baseWhere}
       GROUP BY c.message_type
       ORDER BY avg_success_rate DESC`,
      [companyId]
    );

    // 3) KST 시간대별 성과
    const byTimeResult = await query(
      `SELECT
        EXTRACT(HOUR FROM c.sent_at AT TIME ZONE 'Asia/Seoul')::int as hour,
        COUNT(*) as campaign_count,
        ROUND(AVG(
          CASE WHEN c.sent_count > 0
            THEN COALESCE(c.success_count, 0)::numeric / c.sent_count * 100
            ELSE 0 END
        ), 1) as avg_success_rate
       FROM campaigns c
       WHERE ${baseWhere}
       GROUP BY hour
       ORDER BY avg_success_rate DESC`,
      [companyId]
    );

    // 4) 세그먼트별 성과 (target_filter JSONB 기반)
    // target_filter에서 주요 키(gender, age, grade) 조합으로 세그먼트 요약
    const bySegmentResult = await query(
      `SELECT
        CONCAT_WS(' / ',
          NULLIF(c.target_filter->>'gender', ''),
          CASE WHEN c.target_filter ? 'age' THEN '연령:' || (c.target_filter->>'age') ELSE NULL END,
          CASE WHEN c.target_filter ? 'grade' THEN '등급:' || (c.target_filter->'grade'->>'value') ELSE NULL END
        ) as segment_summary,
        COUNT(*) as campaign_count,
        SUM(c.sent_count) as total_sent,
        SUM(COALESCE(c.success_count, 0)) as total_success,
        ROUND(AVG(
          CASE WHEN c.sent_count > 0
            THEN COALESCE(c.success_count, 0)::numeric / c.sent_count * 100
            ELSE 0 END
        ), 1) as avg_success_rate
       FROM campaigns c
       WHERE ${baseWhere}
         AND c.target_filter IS NOT NULL
         AND c.target_filter != '{}'::jsonb
       GROUP BY segment_summary
       HAVING COUNT(*) >= 2
       ORDER BY avg_success_rate DESC
       LIMIT 10`,
      [companyId]
    );

    // 5) 성과 좋은 캠페인 TOP 5
    const topResult = await query(
      `SELECT
        c.campaign_name,
        c.message_type,
        c.target_count,
        CASE WHEN c.sent_count > 0
          THEN ROUND(COALESCE(c.success_count, 0)::numeric / c.sent_count * 100, 1)
          ELSE 0 END as success_rate,
        TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as sent_at
       FROM campaigns c
       WHERE ${baseWhere}
       ORDER BY success_rate DESC, c.sent_count DESC
       LIMIT 5`,
      [companyId]
    );

    return {
      bySegment: bySegmentResult.rows.map(r => ({
        segment_summary: r.segment_summary || '전체',
        campaign_count: parseInt(r.campaign_count),
        total_sent: parseInt(r.total_sent),
        total_success: parseInt(r.total_success),
        avg_success_rate: parseFloat(r.avg_success_rate),
      })),
      byTimeSlot: byTimeResult.rows.map(r => ({
        hour: r.hour,
        campaign_count: parseInt(r.campaign_count),
        avg_success_rate: parseFloat(r.avg_success_rate),
      })),
      byMessageType: byTypeResult.rows.map(r => ({
        message_type: r.message_type || 'SMS',
        campaign_count: parseInt(r.campaign_count),
        total_sent: parseInt(r.total_sent || '0'),
        avg_success_rate: parseFloat(r.avg_success_rate),
      })),
      topCampaigns: topResult.rows.map(r => ({
        campaign_name: r.campaign_name,
        message_type: r.message_type || 'SMS',
        target_count: parseInt(r.target_count || '0'),
        success_rate: parseFloat(r.success_rate),
        sent_at: r.sent_at,
      })),
      totalCampaigns,
      periodMonths: months,
    };
  } catch (err) {
    console.error('[stats-aggregation] aggregateCampaignPerformance 오류:', err);
    return emptyResult;
  }
}
