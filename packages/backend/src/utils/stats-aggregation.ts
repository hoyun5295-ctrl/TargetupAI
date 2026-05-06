/**
 * stats-aggregation.ts — 통계 집계 컨트롤타워
 *
 * manage-stats.ts, results.ts 등에서 반복되는 날짜 범위 필터링(KST),
 * 일별/월별 그루핑, 캠페인 성공/실패 집계 패턴을 한 곳에서 관리.
 *
 * ★ 기능 2 추가: aggregateCampaignPerformance() — AI 캠페인 추천용 성과 집계
 */

import { query } from '../config/database';
import { CAMPAIGN_OPT080_SELECT_EXPR, CAMPAIGN_OPT080_LEFT_JOIN } from './unsubscribe-helper';
// ★ D144: PG sent_count 캐시 의존 제거 — MySQL 직접 카운트로 전환
import { getCompanySmsTablesWithLogs, smsBatchAggByGroup, kakaoBatchAggByGroup } from './sms-queue';
import { SUCCESS_CODES_SQL, PENDING_CODES_SQL } from './sms-result-map';

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
// ★ 발송통계 컨트롤타워 — manage-stats.ts, results.ts 등 공용
// 슈퍼관리자/고객사관리자/고객사사용자 모두 이 함수를 import해서 사용
// ============================================================

export interface SendStatsOptions {
  view: 'daily' | 'monthly';
  startDate?: string;
  endDate?: string;
  companyId?: string;       // null이면 전체 회사 (슈퍼관리자)
  filterUserId?: string;    // 특정 사용자 필터
  page: number;
  limit: number;
}

export interface SendStatsRow {
  period: string;  // 항상 'period' 키로 통일 (YYYY-MM-DD 또는 YYYY-MM)
  companyName?: string;
  runs: number;
  sent: number;
  success: number;
  fail: number;
}

export interface SendStatsResult {
  summary: { total_sent: string; total_success: string; total_fail: string };
  rows: SendStatsRow[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * ★ D144 헬퍼: 캠페인 배열을 (company_id, created_by)별로 그룹핑하여
 * MySQL 큐(SMSQ_SEND_*) 테이블에서 status_code 기반 success/fail/pending을
 * 배치 집계한다. CT-04 `getCompanySmsTablesWithLogs` + `smsBatchAggByGroup` 사용.
 *
 * 소비처: querySendStats / querySendStatsDetail (이 파일) +
 *        admin.ts / results.ts / customers.ts (Phase 2~4) — 같은 패턴 재사용.
 *
 * @returns Map<campaignId, { total_count, success_count, fail_count, pending_count }>
 */
export async function aggregateSmsCountsByCampaign(
  campaigns: Array<{ id: string; company_id: string; created_by: string | null }>
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (campaigns.length === 0) return result;

  const smsAggFields = `
    COUNT(*) as total_count,
    SUM(CASE WHEN status_code IN (${SUCCESS_CODES_SQL}) THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN status_code NOT IN (${SUCCESS_CODES_SQL}, ${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as fail_count,
    SUM(CASE WHEN status_code IN (${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as pending_count
  `;

  // (company_id, created_by) 쌍 단위로 그룹핑 → 회사/유저별 라인그룹 테이블 1번씩 조회
  const byUser = new Map<string, { companyId: string; userId: string | null; ids: string[] }>();
  for (const c of campaigns) {
    const key = `${c.company_id}::${c.created_by || ''}`;
    if (!byUser.has(key)) {
      byUser.set(key, { companyId: c.company_id, userId: c.created_by, ids: [] });
    }
    byUser.get(key)!.ids.push(c.id);
  }

  for (const [, group] of byUser) {
    const tables = await getCompanySmsTablesWithLogs(group.companyId, group.userId || undefined);
    if (tables.length === 0) continue;
    const partial = await smsBatchAggByGroup(tables, 'app_etc1', smsAggFields, group.ids);
    for (const [cid, v] of partial) result.set(cid, v);
  }
  return result;
}

/**
 * 발송통계 조회 (일별/월별) — 단일 진입점
 * manage-stats.ts, results.ts 등에서 import하여 사용.
 * 슈퍼관리자(companyId=null): 전체 회사 통계
 * 고객사관리자/사용자(companyId 지정): 자사 통계
 *
 * ★ D144: PG `c.sent_count/success_count/fail_count` 캐시 의존 제거.
 * 모든 카운트는 MySQL 큐(SMSQ_SEND_*) + 카카오(IMC_BM_FREE_BIZ_MSG)에서 직접 집계.
 * billing.ts 정상 패턴 미러. 응답 키(summary/rows) 형태는 그대로 유지하여 frontend 변경 0.
 */
export async function querySendStats(options: SendStatsOptions): Promise<SendStatsResult> {
  const { view, page, limit } = options;
  let { startDate, endDate } = options;
  const offset = (page - 1) * limit;

  // 월별 조회 시 날짜를 월 단위로 자동 확장
  if (view === 'monthly') {
    if (startDate) startDate = startDate.substring(0, 7) + '-01';
    if (endDate) {
      const d = new Date(endDate);
      d.setMonth(d.getMonth() + 1, 0);
      endDate = d.toISOString().split('T')[0];
    }
  }

  // WHERE 절 동적 구성
  const dr = buildDateRangeFilter('c.sent_at', startDate, endDate, 1);
  const dateWhere = dr.sql;
  const baseParams: any[] = [...dr.params];
  let paramIdx = dr.nextIndex;

  let companyWhere = '';
  if (options.companyId) {
    companyWhere = ` AND c.company_id = $${paramIdx}`;
    baseParams.push(options.companyId);
    paramIdx++;
  }

  let userWhere = '';
  if (options.filterUserId) {
    userWhere = ` AND c.created_by = $${paramIdx}`;
    baseParams.push(options.filterUserId);
    paramIdx++;
  }

  const baseWhereSql = `c.sent_at IS NOT NULL AND c.status NOT IN ('cancelled', 'draft') ${dateWhere} ${companyWhere} ${userWhere}`;
  const groupCol = kstGroupBy('c.sent_at', view);

  // 1) PG에서 캠페인 메타만 SELECT (sent_count/success_count/fail_count 제거).
  //    period(KST 일/월)은 PG에서 미리 계산 — JS에서 timezone 변환 추가 부담 없음.
  const metaResult = await query(`
    SELECT
      c.id, c.company_id, c.created_by, c.message_type,
      ${groupCol} as period
    FROM campaigns c
    WHERE ${baseWhereSql}
  `, baseParams);

  const campaigns = metaResult.rows;
  if (campaigns.length === 0) {
    return {
      summary: { total_sent: '0', total_success: '0', total_fail: '0' },
      rows: [],
      total: 0,
      page,
      totalPages: 0,
    };
  }

  // 2) MySQL 큐 + 카카오 배치 집계 (CT-04 컨트롤타워)
  const smsCountMap = await aggregateSmsCountsByCampaign(campaigns);
  const kakaoCountMap = await kakaoBatchAggByGroup(campaigns.map((c: any) => c.id));

  // 3) JS에서 KST period 그룹핑 + 요약 합산
  const byPeriod = new Map<string, { runs: Set<string>; sent: number; success: number; fail: number }>();
  let totalSent = 0;
  let totalSuccess = 0;
  let totalFail = 0;

  for (const c of campaigns) {
    const sms = smsCountMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
    const kakao = kakaoCountMap.get(c.id) || { total: 0, success: 0, fail: 0, pending: 0 };

    const sent = Number(sms.total_count || 0) + kakao.total;
    const success = Number(sms.success_count || 0) + kakao.success;
    const fail = Number(sms.fail_count || 0) + kakao.fail;

    totalSent += sent;
    totalSuccess += success;
    totalFail += fail;

    if (!byPeriod.has(c.period)) {
      byPeriod.set(c.period, { runs: new Set(), sent: 0, success: 0, fail: 0 });
    }
    const bucket = byPeriod.get(c.period)!;
    bucket.runs.add(c.id);
    bucket.sent += sent;
    bucket.success += success;
    bucket.fail += fail;
  }

  const allRows = Array.from(byPeriod.entries())
    .map(([period, v]) => ({
      period,
      runs: v.runs.size,
      sent: v.sent,
      success: v.success,
      fail: v.fail,
    }))
    .sort((a, b) => b.period.localeCompare(a.period));

  const pagedRows = allRows.slice(offset, offset + limit);

  return {
    summary: {
      total_sent: String(totalSent),
      total_success: String(totalSuccess),
      total_fail: String(totalFail),
    },
    rows: pagedRows,
    total: allRows.length,
    page,
    totalPages: Math.ceil(allRows.length / limit),
  };
}

export interface SendStatsDetailOptions {
  view: 'daily' | 'monthly';
  date: string;            // 조회 대상 날짜/월
  companyId: string;
  filterUserId?: string;
}

export interface SendStatsDetailResult {
  userStats: any[];
  campaigns: any[];
  unitCost: { sms: number; lms: number };
}

/**
 * 발송통계 상세 (사용자별 분해) — 단일 진입점
 *
 * ★ D144: PG `c.sent_count/success_count/fail_count` 캐시 의존 제거.
 * 사용자별 집계 + 캠페인 row별 카운트 모두 MySQL 큐 + 카카오에서 직접 집계.
 * 응답 키(userStats/campaigns/unitCost) 형태는 그대로 유지하여 frontend 변경 0.
 */
export async function querySendStatsDetail(
  options: SendStatsDetailOptions,
  DEFAULT_COSTS_PARAM: { sms: number; lms: number }
): Promise<SendStatsDetailResult> {
  const { view, date, companyId, filterUserId } = options;

  const groupCol = kstGroupBy('c.sent_at', view);

  const userFilter = filterUserId ? ` AND c.created_by = $3` : '';
  const detailParams: any[] = filterUserId ? [date, companyId, filterUserId] : [date, companyId];

  // 비용 단가
  const costRes = await query('SELECT cost_per_sms, cost_per_lms FROM companies WHERE id = $1', [companyId]);
  const cSms = Number(costRes.rows[0]?.cost_per_sms) || DEFAULT_COSTS_PARAM.sms;
  const cLms = Number(costRes.rows[0]?.cost_per_lms) || DEFAULT_COSTS_PARAM.lms;

  // 1) PG에서 캠페인 + 사용자 + opt080 메타만 SELECT (카운트 컬럼 제거)
  //    ★ alias 'c' 필수 (CAMPAIGN_OPT080_LEFT_JOIN 가정)
  const metaResult = await query(`
    SELECT
      c.id, c.company_id, c.created_by, c.campaign_name, c.send_type, c.message_content,
      c.message_type, c.is_ad, c.callback_number, c.target_count, c.sent_at,
      ${CAMPAIGN_OPT080_SELECT_EXPR},
      u.id as user_id, u.name as user_name, u.login_id, u.department, u.store_codes
    FROM campaigns c
    LEFT JOIN users u ON c.created_by = u.id
    ${CAMPAIGN_OPT080_LEFT_JOIN}
    WHERE c.sent_at IS NOT NULL
      AND ${groupCol} = $1
      AND c.company_id = $2
      AND c.status NOT IN ('cancelled', 'draft')
      ${userFilter}
    ORDER BY c.sent_at DESC
  `, detailParams);

  const metaRows = metaResult.rows;
  if (metaRows.length === 0) {
    return { userStats: [], campaigns: [], unitCost: { sms: cSms, lms: cLms } };
  }

  // 2) MySQL 큐 + 카카오 배치 집계
  const smsCountMap = await aggregateSmsCountsByCampaign(metaRows);
  const kakaoCountMap = await kakaoBatchAggByGroup(metaRows.map((c: any) => c.id));

  // 3) JS에서 사용자별 집계 + 캠페인 row 빌드
  type UserAgg = {
    user_id: any; user_name: any; login_id: any; department: any; store_codes: any;
    runs: Set<string>; sent: number; success: number; fail: number;
    sms_success: number; lms_success: number;
  };
  const byUser = new Map<string, UserAgg>();
  const campaignRows: any[] = [];

  for (const c of metaRows) {
    const sms = smsCountMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
    const kakao = kakaoCountMap.get(c.id) || { total: 0, success: 0, fail: 0, pending: 0 };

    const sent = Number(sms.total_count || 0) + kakao.total;
    const success = Number(sms.success_count || 0) + kakao.success;
    const fail = Number(sms.fail_count || 0) + kakao.fail;

    // 사용자별 집계 (created_by NULL인 캠페인은 'null' 키로 묶임 → user_name 등 NULL)
    const uKey = c.user_id || 'null';
    if (!byUser.has(uKey)) {
      byUser.set(uKey, {
        user_id: c.user_id, user_name: c.user_name, login_id: c.login_id,
        department: c.department, store_codes: c.store_codes,
        runs: new Set<string>(),
        sent: 0, success: 0, fail: 0,
        sms_success: 0, lms_success: 0,
      });
    }
    const u = byUser.get(uKey)!;
    u.runs.add(c.id);
    u.sent += sent;
    u.success += success;
    u.fail += fail;

    // message_type 분기 (PG c.message_type 기준 — 기존 SQL 분기와 동일)
    const isSms = c.message_type === 'SMS' || c.message_type === 'S';
    const isLmsOrMms = c.message_type === 'LMS' || c.message_type === 'L'
      || c.message_type === 'MMS' || c.message_type === 'M';
    if (isSms) u.sms_success += success;
    if (isLmsOrMms) u.lms_success += success;

    // 캠페인 row (기존 응답 키 형태 그대로)
    campaignRows.push({
      campaign_id: c.id,
      campaign_name: c.campaign_name,
      send_type: c.send_type,
      message_content: c.message_content,
      message_type: c.message_type,
      is_ad: c.is_ad,
      callback_number: c.callback_number,
      opt_out_080_number: c.opt_out_080_number ?? null,
      user_name: c.user_name,
      login_id: c.login_id,
      run_id: c.id,
      run_number: 1,
      sent_count: sent,
      success_count: success,
      fail_count: fail,
      target_count: c.target_count,
      sent_at: c.sent_at,
    });
  }

  const userStats = Array.from(byUser.values())
    .map((u) => ({
      user_id: u.user_id,
      user_name: u.user_name,
      login_id: u.login_id,
      department: u.department,
      store_codes: u.store_codes,
      runs: u.runs.size,
      sent: u.sent,
      success: u.success,
      fail: u.fail,
      sms_success: u.sms_success,
      lms_success: u.lms_success,
      cost: Math.round((u.sms_success * cSms + u.lms_success * cLms) * 10) / 10,
    }))
    .sort((a, b) => b.sent - a.sent);

  return {
    userStats,
    campaigns: campaignRows,
    unitCost: { sms: cSms, lms: cLms },
  };
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
