/**
 * stats-aggregation.ts — 통계 집계 컨트롤타워 (CT-04)
 *
 * manage-stats.ts, results.ts 등에서 반복되는 날짜 범위 필터링(KST),
 * 일별/월별 그루핑, 캠페인 성공/실패 집계 패턴을 한 곳에서 관리.
 */

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
 * // sql: " AND c.sent_at >= $1::date AT TIME ZONE 'Asia/Seoul' AND c.sent_at < ($2::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Seoul'"
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

  if (startDate) {
    sql += ` AND ${column} >= $${paramIndex}::date AT TIME ZONE 'Asia/Seoul'`;
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    sql += ` AND ${column} < ($${paramIndex}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Seoul'`;
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
 * // sql: " AND created_at >= $2::date::timestamp AT TIME ZONE 'Asia/Seoul' AND created_at < ($2::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'"
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

  sql += ` AND ${column} >= $${paramIndex}::date::timestamp AT TIME ZONE 'Asia/Seoul'`;
  sql += ` AND ${column} < ($${paramIndex}::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'`;
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

    sql += ` AND ${column} >= $${paramIndex}::date::timestamp AT TIME ZONE 'Asia/Seoul'`;
    params.push(String(fromDate));
    paramIndex++;

    sql += ` AND ${column} < ($${paramIndex}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Seoul'`;
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
