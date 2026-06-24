/**
 * stats-aggregation.ts — 통계 집계 컨트롤타워
 *
 * manage-stats.ts, results.ts 등에서 반복되는 날짜 범위 필터링(KST),
 * 일별/월별 그루핑, 캠페인 성공/실패 집계 패턴을 한 곳에서 관리.
 *
 * ★ 기능 2 추가: aggregateCampaignPerformance() — AI 캠페인 추천용 성과 집계
 */
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
export declare function buildDateRangeFilter(column: string, startDate?: string, endDate?: string, startParamIndex?: number): DateRangeResult;
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
export declare function buildMonthRangeFilter(column: string, yearMonth: string, startParamIndex?: number): DateRangeResult;
/**
 * KST 기준 날짜/월별 fromDate-toDate 범위 WHERE 절 생성.
 * fromDate/toDate가 있으면 그 범위, 없으면 yearMonth 기준 월별.
 *
 * @param column - 날짜 컬럼명
 * @param options - { fromDate?, toDate?, yearMonth? }
 * @param startParamIndex - 파라미터 시작 인덱스
 */
export declare function buildPeriodFilter(column: string, options: {
    fromDate?: string;
    toDate?: string;
    yearMonth?: string;
}, startParamIndex?: number): DateRangeResult;
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
export declare function kstGroupBy(column: string, view: 'daily' | 'monthly'): string;
/**
 * KST 기준으로 날짜만 추출하는 표현식.
 *
 * @param column - 타임스탬프 컬럼명
 * @returns "(column AT TIME ZONE 'Asia/Seoul')::date"
 */
export declare function kstDate(column: string): string;
export interface SendStatsOptions {
    view: 'daily' | 'monthly';
    startDate?: string;
    endDate?: string;
    companyId?: string;
    filterUserId?: string;
    page: number;
    limit: number;
}
export interface SendStatsRow {
    period: string;
    companyName?: string;
    runs: number;
    sent: number;
    success: number;
    fail: number;
}
export interface SendStatsResult {
    summary: {
        total_sent: string;
        total_success: string;
        total_fail: string;
    };
    rows: SendStatsRow[];
    total: number;
    page: number;
    totalPages: number;
}
/**
 * ★ D144 헬퍼: 캠페인 배열을 라인그룹 테이블셋별로 그룹핑하여
 * MySQL 큐(SMSQ_SEND_*) 테이블에서 status_code 기반 success/fail/pending을
 * 배치 집계한다. CT-04 `getCompanySmsTablesWithLogs` + `smsBatchAggByGroup` 사용.
 *
 * 소비처: querySendStats / querySendStatsDetail (이 파일) +
 *        admin.ts / results.ts / customers.ts (Phase 2~4) — 같은 패턴 재사용.
 *
 * ★ 최적화 (D144 후속): 67개 회사 통계 등 다회사 조회 시 (company_id, created_by) 쌍별
 *   그룹핑은 N회 sequential MySQL 쿼리 발생. 대부분 회사가 동일 default BULK_ONLY 라인그룹
 *   공유하므로 "라인그룹 테이블셋"별로 묶으면 K(<<N)회로 축소 (CLAUDE.md D110 UNION ALL 교훈).
 *
 * @returns Map<campaignId, { total_count, success_count, fail_count, pending_count }>
 */
export declare function aggregateSmsCountsByCampaign(campaigns: Array<{
    id: string;
    company_id: string;
    created_by: string | null;
}>): Promise<Map<string, Record<string, number>>>;
/**
 * ★ D144 후속: 캠페인 배열에 대해 MySQL 큐 `sendreq_time`(KST 그대로 저장)의
 * 첫 발송 요청 시각을 배치 조회. PG `campaigns.sent_at`은 bulk INSERT 완료 시점에
 * NOW()로 set되어 큰 캠페인일수록 실제 통신사 발송 시각과 분~수십분 차이 발생.
 * 이 헬퍼가 반환하는 시각이 사용자가 인식하는 "발송 시각"과 일치 (통신사로 첫 요청한 시각).
 *
 * @returns Map<campaignId, Date>  — KST 시각의 Date 객체. 응답으로 ISO 변환 시 +0900 포함.
 */
export declare function aggregateSmsSendTimesByCampaign(campaigns: Array<{
    id: string;
    company_id: string;
    created_by: string | null;
}>): Promise<Map<string, Date>>;
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
export declare function querySendStats(options: SendStatsOptions): Promise<SendStatsResult>;
export interface SendStatsDetailOptions {
    view: 'daily' | 'monthly';
    date: string;
    companyId: string;
    filterUserId?: string;
}
export interface SendStatsDetailResult {
    userStats: any[];
    campaigns: any[];
    unitCost: {
        sms: number;
        lms: number;
    };
}
/**
 * 발송통계 상세 (사용자별 분해) — 단일 진입점
 *
 * ★ D144: PG `c.sent_count/success_count/fail_count` 캐시 의존 제거.
 * 사용자별 집계 + 캠페인 row별 카운트 모두 MySQL 큐 + 카카오에서 직접 집계.
 * 응답 키(userStats/campaigns/unitCost) 형태는 그대로 유지하여 frontend 변경 0.
 */
export declare function querySendStatsDetail(options: SendStatsDetailOptions, DEFAULT_COSTS_PARAM: {
    sms: number;
    lms: number;
}): Promise<SendStatsDetailResult>;
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
export declare function aggregateCampaignPerformance(companyId: string, months?: number): Promise<CampaignPerformanceData>;
//# sourceMappingURL=stats-aggregation.d.ts.map