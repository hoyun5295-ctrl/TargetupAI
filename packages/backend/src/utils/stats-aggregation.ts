/**
 * stats-aggregation.ts — 통계 집계 컨트롤타워
 *
 * manage-stats.ts, results.ts 등에서 반복되는 날짜 범위 필터링(KST),
 * 일별/월별 그루핑, 캠페인 성공/실패 집계 패턴을 한 곳에서 관리.
 *
 * ★ 기능 2 추가: aggregateCampaignPerformance() — AI 캠페인 추천용 성과 집계
 */

import { query, mysqlQuery } from '../config/database';
import { CAMPAIGN_OPT080_SELECT_EXPR, CAMPAIGN_OPT080_LEFT_JOIN } from './unsubscribe-helper';
// ★ D144: PG sent_count 캐시 의존 제거 — MySQL 직접 카운트로 전환
// ★ 2026-06-11: 카운트는 smsCampaignCountsSafe(이력=결과/라이브=대기 분리) — 이동 중 이중 카운트 차단
import { getAllSmsTablesWithLogs, getCompanySmsTablesWithLogs, smsCampaignCountsSafe, kakaoBatchAggByGroup } from './sms-queue';
import { classifyResultTables, computeDisplayCounts, DisplayCounts } from './sms-table-split';
import { SUCCESS_CODES_SQL, PENDING_CODES_SQL, tallySmsChannelCounts, SmsChannel, ChannelCount } from './sms-result-map';
import { CampaignTableMeta, recordedLiveTables, logTablesForLive } from './stats-table-scope';

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

/**
 * ★ 발송통계 날짜 기준 — 예약은 발송예정일(scheduled_at), 즉시발송은 실제 발송일(sent_at).
 * 예약 캠페인이 등록일에 잡히던 문제 정정. sent_at 컬럼 자체는 환불/결과동기화 의존이 있어 보존하고,
 * 통계 표시 날짜만 이 식으로 산출한다. 캠페인 alias는 'c' 고정.
 */
export const STAT_DATE_EXPR = `COALESCE(c.scheduled_at, c.sent_at)`;

/**
 * ★ 발송 시작된 캠페인만 집계 — 전송시각(scheduled_at) 미도래 예약은 발송 전이라 통계에서 제외 (Harold 명시 2026-06-09).
 *   예약은 전송시각이 되어야 발송이 시작되고(그 전엔 취소 가능), 발송 시작 후에만 통계에 잡혀야 한다.
 *   STAT_DATE_EXPR을 쓰는 모든 통계/집계/목록 WHERE에 ` AND ${STAT_STARTED_GUARD}` 동반. 캠페인 alias 'c' 고정.
 */
export const STAT_STARTED_GUARD = `NOT (c.status = 'scheduled' AND COALESCE(c.scheduled_at, c.sent_at) > NOW())`;

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
  pending: number;
}

export interface SendStatsResult {
  summary: { total_sent: string; total_success: string; total_fail: string; total_pending: string };
  rows: SendStatsRow[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * ★ 2026-07-17 성능 — 캠페인 배열을 "조회해야 할 MySQL 테이블셋"별로 그룹핑
 *   (counts·channelSplit·sendTimes 3집계 공용 — 0717 stats mysqlUnion 823ms 실측 처방).
 *
 * 축소는 "라인 축"으로만 한다 — 기록된 LIVE 테이블(send_config.sentTables, 0611+ 적재 워커 실기록)
 * + 그 라인의 전 존재 LOG(이새 실측: 전 라인 합집합 27개 → 라인당 LIVE 1+LOG 수 개).
 * ★ Codex 2R 정정: 시간 창(발송월 ±1개월) 방식은 선예약 직접발송(sent_at=적재 시각)·장기 분할
 * 발송(수개월 sendreq_time)이 창 밖 LOG로 빠지므로 폐기 — 캠페인 행은 적재된 테이블 또는 그 라인의
 * 월별 아카이브에만 존재할 수 있어 라인 축 축소는 시간 가정 없이 정확성이 보장된다.
 * 기록이 없거나 실존 교차 검증에 실패한 캠페인은 현행 그대로 (company,user) 라인 합집합
 * (getCompanySmsTablesWithLogs) fallback — 정확성 동일. 산식 소비처는 무접촉.
 */
async function resolveCampaignTableGroups(
  campaigns: CampaignTableMeta[]
): Promise<Map<string, { tables: string[]; ids: string[] }>> {
  const byTableSet = new Map<string, { tables: string[]; ids: string[] }>();
  if (campaigns.length === 0) return byTableSet;

  // 1) 기록 경로 vs fallback 분리 (판정 = stats-table-scope 순수 코어)
  type UserGroup = { companyId: string; userId: string | null; ids: string[] };
  const recorded: Array<{ c: CampaignTableMeta; lives: string[] }> = [];
  const byUser = new Map<string, UserGroup>();
  const pushFallback = (c: CampaignTableMeta) => {
    const key = `${c.company_id}::${c.created_by || ''}`;
    if (!byUser.has(key)) byUser.set(key, { companyId: c.company_id, userId: c.created_by, ids: [] });
    byUser.get(key)!.ids.push(c.id);
  };
  for (const c of campaigns) {
    const lives = recordedLiveTables(c);
    if (lives.length > 0) recorded.push({ c, lives });
    else pushFallback(c);
  }

  const addToSet = (tables: string[], ids: string[]) => {
    if (tables.length === 0 || ids.length === 0) return;
    const tableKey = [...tables].sort().join(',');
    if (!byTableSet.has(tableKey)) byTableSet.set(tableKey, { tables, ids: [] });
    byTableSet.get(tableKey)!.ids.push(...ids);
  };

  // 2) 기록 경로 — 전체 테이블 목록 1회 조회(5분 캐시)로 실존 교차 검증 후 LIVE+그 라인 전 LOG 구성.
  //    미실존 테이블이 UNION에 끼는 SQL 에러 차단. ★ Codex 3R: LIVE가 폐선돼 현 목록에 없어도
  //    그 라인의 LOG 아카이브가 남아 있으면 LOG만으로 집계(폐선 라인 결과 보존 — 현행 합집합은
  //    현재 배정 라인만 봐서 폐선분을 놓치므로 이쪽이 더 정확). LIVE·LOG 전무일 때만 fallback.
  if (recorded.length > 0) {
    const allTables = await getAllSmsTablesWithLogs();
    const existing = new Set(allTables);
    const logCache = new Map<string, string[]>();
    for (const { c, lives } of recorded) {
      const tables: string[] = [];
      for (const live of lives) {
        if (!logCache.has(live)) logCache.set(live, logTablesForLive(live, allTables));
        if (existing.has(live)) tables.push(live);
        tables.push(...logCache.get(live)!);
      }
      if (tables.length === 0) {
        pushFallback(c);
        continue;
      }
      addToSet(tables, [c.id]);
    }
  }

  // 3) fallback — 현행 (company,user) 라인 합집합 (기록 없는 과거 캠페인·미실존 기록 포함)
  const fallbackResolved = await Promise.all(
    Array.from(byUser.values()).map(async (ug) => ({
      ug,
      tables: await getCompanySmsTablesWithLogs(ug.companyId, ug.userId || undefined),
    }))
  );
  for (const { ug, tables } of fallbackResolved) addToSet(tables, ug.ids);
  return byTableSet;
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
 * ★ 2026-07-17 성능: 테이블셋 해석을 resolveCampaignTableGroups(sentTables 기록 축소)로 교체 —
 *   send_config·발송시각을 함께 넘기는 소비처(campaigns 목록·customers stats)는 실적재 테이블만 훑고,
 *   안 넘기는 소비처(results/admin/querySendStats)는 현행 합집합 그대로 (하위호환).
 *
 * @returns Map<campaignId, { total_count, success_count, fail_count, pending_count }>
 */
export async function aggregateSmsCountsByCampaign(
  campaigns: CampaignTableMeta[]
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (campaigns.length === 0) return result;

  // 1~3) 조회 테이블셋 그룹핑 — ★ 2026-07-17 구간 계측 유지(테이블셋 해석 vs MySQL UNION 분리)
  const tRes0 = Date.now();
  const byTableSet = await resolveCampaignTableGroups(campaigns);
  const tRes1 = Date.now();

  // 4) 라인그룹 테이블셋별 집계 — ★ 2026-06-11 정합성 100% 산식(이력=결과/라이브=대기)으로 교체
  let unionMs = 0;
  let tableCount = 0;
  for (const [, group] of byTableSet) {
    const tU0 = Date.now();
    const partial = await smsCampaignCountsSafe(group.tables, group.ids);
    unionMs += Date.now() - tU0;
    tableCount += group.tables.length;
    for (const [cid, v] of partial) {
      result.set(cid, { total_count: v.total, success_count: v.success, fail_count: v.fail, pending_count: v.pending });
    }
  }
  if (Date.now() - tRes0 >= 300) {
    console.log(`[SLOW-STAGE] aggregateSmsCounts — 테이블셋해석=${tRes1 - tRes0}ms mysqlUnion=${unionMs}ms 테이블=${tableCount}개 캠페인=${campaigns.length}건`);
  }
  return result;
}

/**
 * ★ 알림톡 통계 분리 — 캠페인의 SMS 큐를 채널(알림톡 K / 대체발송 L·k_oriseq>0 / lms·sms·mms)별로
 *   성공·실패·대기 집계. 통계 엑셀에서 알림톡 캠페인을 "알림톡"/"알림톡대체발송" 2행으로 가르는 전용.
 *   aggregateSmsCountsByCampaign(전 통계·결과 공유)은 불변 — 이 함수는 엑셀에서만 호출.
 *   ★ 신규 SQL 컬럼 0: msg_type·k_oriseq·status_code·app_etc1 모두 SMSQ_SEND 실측(29컬럼 덤프) 확정.
 * @returns Map<campaignId, Record<SmsChannel, {total,success,fail,pending}>>
 */
export async function aggregateSmsChannelSplitByCampaign(
  campaigns: CampaignTableMeta[]
): Promise<Map<string, Record<SmsChannel, ChannelCount>>> {
  const result = new Map<string, Record<SmsChannel, ChannelCount>>();
  if (campaigns.length === 0) return result;

  // 테이블셋 그룹핑 — ★ 2026-07-17 resolveCampaignTableGroups 공용 (sentTables 기록 축소 + 현행 fallback)
  const byTableSet = await resolveCampaignTableGroups(campaigns);

  // 라인그룹 테이블셋별 raw 집계: app_etc1 + msg_type + (대체 여부) + status_code
  // ★ 2026-06-11: 라이브 큐는 대기 코드만 — 큐→이력 이동 중 같은 행이 양쪽에서 잡히는 이중 카운트 차단
  //   (결과 행은 이력에서만 — smsCampaignCountsSafe와 동일 산식)
  // ★ 2026-07-04: smsCampaignCountsSafe와 동일하게 "LOG 짝 없는 LIVE(라인13 등)"는 대기 필터 제외 →
  //   결과까지 집계(LOG 부재 = 유일 소스라 이중카운트 불가). 짝 있는 LIVE만 대기 필터 유지.
  const rawByCampaign = new Map<string, Array<{ msg_type: string; k_oriseq: number | null; status_code: number; cnt: number }>>();
  for (const [, group] of byTableSet) {
    if (group.ids.length === 0 || group.tables.length === 0) continue;
    const placeholders = group.ids.map(() => '?').join(',');
    const { pendingLiveTables } = classifyResultTables(group.tables);
    const pendingOnly = new Set(pendingLiveTables);
    const unions = group.tables
      .map(t => `SELECT app_etc1 AS _grp, msg_type,
                   CASE WHEN k_oriseq IS NOT NULL AND k_oriseq > 0 THEN 1 ELSE 0 END AS is_sub,
                   status_code, COUNT(*) AS cnt
                 FROM ${t} WHERE app_etc1 IN (${placeholders})${pendingOnly.has(t) ? ` AND status_code IN (${PENDING_CODES_SQL})` : ''}
                 GROUP BY app_etc1, msg_type, is_sub, status_code`)
      .join(' UNION ALL ');
    // 같은 캠페인이 LIVE+LOG 여러 테이블로 쪼개질 수 있어 outer 재합산
    const sql = `SELECT _grp, msg_type, is_sub, status_code, SUM(cnt) AS cnt
                 FROM (${unions}) u GROUP BY _grp, msg_type, is_sub, status_code`;
    const params: any[] = [];
    for (let i = 0; i < group.tables.length; i++) params.push(...group.ids);
    const rows = await mysqlQuery(sql, params) as any[];
    for (const r of rows) {
      const cid = String(r._grp);
      if (!rawByCampaign.has(cid)) rawByCampaign.set(cid, []);
      rawByCampaign.get(cid)!.push({
        msg_type: String(r.msg_type),
        k_oriseq: Number(r.is_sub) === 1 ? 1 : null,  // tallySmsChannelCounts는 k_oriseq>0 여부만 봄
        status_code: Number(r.status_code),
        cnt: Number(r.cnt || 0),
      });
    }
  }

  for (const [cid, rows] of rawByCampaign) result.set(cid, tallySmsChannelCounts(rows));
  return result;
}

/**
 * ★ D144 후속: 캠페인 배열에 대해 MySQL 큐 `sendreq_time`(KST 그대로 저장)의
 * 첫 발송 요청 시각을 배치 조회. PG `campaigns.sent_at`은 bulk INSERT 완료 시점에
 * NOW()로 set되어 큰 캠페인일수록 실제 통신사 발송 시각과 분~수십분 차이 발생.
 * 이 헬퍼가 반환하는 시각이 사용자가 인식하는 "발송 시각"과 일치 (통신사로 첫 요청한 시각).
 *
 * @returns Map<campaignId, Date>  — KST 시각의 Date 객체. 응답으로 ISO 변환 시 +0900 포함.
 */
export async function aggregateSmsSendTimesByCampaign(
  campaigns: CampaignTableMeta[]
): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (campaigns.length === 0) return result;

  // 테이블셋 그룹핑 — ★ 2026-07-17 resolveCampaignTableGroups 공용 (sentTables 기록 축소 + 현행 fallback)
  const byTableSet = await resolveCampaignTableGroups(campaigns);

  // 라인그룹 테이블셋별 UNION ALL — outer MIN으로 첫 sendreq_time 추출
  // ★ sendreq_time은 KST 그대로 저장(D98) → DATE_FORMAT으로 +09:00 ISO 명시하면
  //   JS Date 생성/직렬화가 서버 TZ 무관하게 정확. PG sent_at(timestamptz UTC) 응답과 호환.
  for (const [, group] of byTableSet) {
    if (group.ids.length === 0 || group.tables.length === 0) continue;
    const placeholders = group.ids.map(() => '?').join(',');
    const unions = group.tables
      .map(t => `SELECT app_etc1 AS _grp, DATE_FORMAT(MIN(sendreq_time), '%Y-%m-%dT%H:%i:%s+09:00') AS first_sendreq_iso FROM ${t} WHERE app_etc1 IN (${placeholders}) GROUP BY app_etc1`)
      .join(' UNION ALL ');
    const sql = `SELECT _grp, MIN(first_sendreq_iso) AS first_sendreq_iso FROM (${unions}) t GROUP BY _grp`;
    const params: any[] = [];
    for (let i = 0; i < group.tables.length; i++) params.push(...group.ids);
    const rows = await mysqlQuery(sql, params) as any[];
    for (const r of rows) {
      if (!r._grp || !r.first_sendreq_iso) continue;
      const d = new Date(String(r.first_sendreq_iso));
      if (!isNaN(d.getTime())) result.set(String(r._grp), d);
    }
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
/**
 * ★ D228+ (2026-05-30) 발송결과 속도 — 캠페인별 결과 카운트(SMS+카카오 합산) 캐시 인지 조회 CT.
 *   result_final=true = campaign-sync-worker가 발송 6h 경과 후 확정한 PG 캐시(이미 SMS+카카오 합산, pending=0)
 *     → MySQL 집계 skip (대형 캠페인 GROUP BY 제거 = 발송결과/상세/통계 공통 병목 해소).
 *   진행 중(result_final=false) = aggregateSmsCountsByCampaign(SMS) + kakaoBatchAggByGroup(카카오) 실시간 합산.
 *   반환 = Map<campaignId, { sent, success, fail }> — 이미 SMS+카카오 합산 완료값.
 *   ★ 호출부는 카카오를 따로 더하지 말 것 (final PG값이 이미 합산이라 이중 합산 위험).
 *   ★ 필요 필드: id, company_id, created_by, result_final, sent_count, success_count, fail_count.
 *   ★ 2026-06-17: 대기(pending)를 직접 반환 — frontend 자체 파생(sent-success-fail) 종결. 산식 = computeDisplayCounts 단일.
 */
export async function getCampaignResultCounts(
  campaigns: Array<{ id: string; company_id: string; created_by: string | null; result_final?: boolean; sent_count?: number | null; success_count?: number | null; fail_count?: number | null }>
): Promise<Map<string, DisplayCounts>> {
  const out = new Map<string, DisplayCounts>();
  if (campaigns.length === 0) return out;

  // 완료 캠페인 = PG 캐시 (워커 확정 SMS+카카오 합산값). 대기는 정의상 0.
  for (const c of campaigns) {
    if (c.result_final) {
      out.set(c.id, computeDisplayCounts(true, c.sent_count, Number(c.success_count || 0), Number(c.fail_count || 0), 0));
    }
  }

  // 진행 중 캠페인만 MySQL 실시간 집계 (SMS + 카카오). 대기 = 실측(total - 성공 - 실패).
  const nonFinal = campaigns.filter((c) => !c.result_final);
  if (nonFinal.length > 0) {
    // ★ 2026-07-17: 서로 독립인 SMS·카카오 집계 병렬(동시 2 — MySQL 공용 풀 상한 정책과 일치).
    //   대시보드 2라우트가 이 CT로 합류하면서 기존 라우트별 병렬성을 CT 안에서 보존(Codex 지적 수용 —
    //   결과·시그니처 불변, 실행 시점만 병렬. 전 소비처(관리자·발송통계 포함) 공통 이득).
    const [smsMap, kakaoMap] = await Promise.all([
      aggregateSmsCountsByCampaign(nonFinal),
      kakaoBatchAggByGroup(nonFinal.map((c) => c.id)),
    ]);
    for (const c of nonFinal) {
      const sms = smsMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
      const kakao = (kakaoMap.get(c.id) as any) || { total: 0, success: 0, fail: 0, pending: 0 };
      const success = Number(sms.success_count || 0) + Number(kakao.success || 0);
      const fail = Number(sms.fail_count || 0) + Number(kakao.fail || 0);
      const total = Number(sms.total_count || 0) + Number(kakao.total || 0);
      out.set(c.id, computeDisplayCounts(false, c.sent_count, success, fail, Math.max(0, total - success - fail)));
    }
  }

  return out;
}

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

  // WHERE 절 동적 구성 — 발송통계는 발송예정일(예약)/발송일(즉시) 기준 (STAT_DATE_EXPR)
  const dr = buildDateRangeFilter(STAT_DATE_EXPR, startDate, endDate, 1);
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

  const baseWhereSql = `${STAT_DATE_EXPR} IS NOT NULL AND ${STAT_STARTED_GUARD} AND c.status NOT IN ('cancelled', 'draft') ${dateWhere} ${companyWhere} ${userWhere}`;
  const groupCol = kstGroupBy(STAT_DATE_EXPR, view);

  // 1) PG에서 캠페인 메타만 SELECT (sent_count/success_count/fail_count 제거).
  //    period(KST 일/월)은 PG에서 미리 계산 — JS에서 timezone 변환 추가 부담 없음.
  const metaResult = await query(`
    SELECT
      c.id, c.company_id, c.created_by, c.message_type,
      c.result_final, c.sent_count, c.success_count, c.fail_count,
      ${groupCol} as period
    FROM campaigns c
    WHERE ${baseWhereSql}
  `, baseParams);

  const campaigns = metaResult.rows;
  if (campaigns.length === 0) {
    return {
      summary: { total_sent: '0', total_success: '0', total_fail: '0', total_pending: '0' },
      rows: [],
      total: 0,
      page,
      totalPages: 0,
    };
  }

  // 2) ★ result_final 캐시 우선 — 완료(6h 경과) 캠페인은 PG 캐시(MySQL skip), 진행 중만 실시간 집계.
  //    getCampaignResultCounts가 SMS+카카오 합산까지 끝낸 {sent,success,fail} 반환 (이중 합산 방지).
  const resultCountMap = await getCampaignResultCounts(campaigns);

  // 3) JS에서 KST period 그룹핑 + 요약 합산 (대기 = getCampaignResultCounts 진실 — frontend 파생 제거)
  const byPeriod = new Map<string, { runs: Set<string>; sent: number; success: number; fail: number; pending: number }>();
  let totalSent = 0;
  let totalSuccess = 0;
  let totalFail = 0;
  let totalPending = 0;

  for (const c of campaigns) {
    const counts = resultCountMap.get(c.id) || { sent: 0, success: 0, fail: 0, pending: 0 };

    const sent = counts.sent;
    const success = counts.success;
    const fail = counts.fail;
    const pending = counts.pending;

    totalSent += sent;
    totalSuccess += success;
    totalFail += fail;
    totalPending += pending;

    if (!byPeriod.has(c.period)) {
      byPeriod.set(c.period, { runs: new Set(), sent: 0, success: 0, fail: 0, pending: 0 });
    }
    const bucket = byPeriod.get(c.period)!;
    bucket.runs.add(c.id);
    bucket.sent += sent;
    bucket.success += success;
    bucket.fail += fail;
    bucket.pending += pending;
  }

  const allRows = Array.from(byPeriod.entries())
    .map(([period, v]) => ({
      period,
      runs: v.runs.size,
      sent: v.sent,
      success: v.success,
      fail: v.fail,
      pending: v.pending,
    }))
    .sort((a, b) => b.period.localeCompare(a.period));

  const pagedRows = allRows.slice(offset, offset + limit);

  return {
    summary: {
      total_sent: String(totalSent),
      total_success: String(totalSuccess),
      total_fail: String(totalFail),
      total_pending: String(totalPending),
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

  const groupCol = kstGroupBy(STAT_DATE_EXPR, view);

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
      c.result_final, c.sent_count, c.success_count, c.fail_count,
      ${CAMPAIGN_OPT080_SELECT_EXPR},
      u.id as user_id, u.name as user_name, u.login_id, u.department, u.store_codes
    FROM campaigns c
    LEFT JOIN users u ON c.created_by = u.id
    ${CAMPAIGN_OPT080_LEFT_JOIN}
    WHERE ${STAT_DATE_EXPR} IS NOT NULL
      AND ${STAT_STARTED_GUARD}
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

  // 2) ★ result_final 캐시 우선 (카운트, MySQL skip) + 첫 발송 시각(실시간 유지)
  const resultCountMap = await getCampaignResultCounts(metaRows);
  const sentTimeMap = await aggregateSmsSendTimesByCampaign(metaRows);

  // 3) JS에서 사용자별 집계 + 캠페인 row 빌드
  type UserAgg = {
    user_id: any; user_name: any; login_id: any; department: any; store_codes: any;
    runs: Set<string>; sent: number; success: number; fail: number;
    sms_success: number; lms_success: number;
  };
  const byUser = new Map<string, UserAgg>();
  const campaignRows: any[] = [];

  for (const c of metaRows) {
    const counts = resultCountMap.get(c.id) || { sent: 0, success: 0, fail: 0 };

    const sent = counts.sent;
    const success = counts.success;
    const fail = counts.fail;

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
    // ★ D144 후속: sent_at은 MySQL MIN(sendreq_time)이 실제 통신사 발송 시각.
    //   PG c.sent_at은 INSERT 완료 시점(NOW())이라 큰 캠페인은 늦게 찍힘 → MySQL 우선.
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
      sent_at: sentTimeMap.get(c.id) ?? c.sent_at,
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
      AND COALESCE(c.scheduled_at, c.sent_at) >= NOW() - INTERVAL '${months} months'
      AND COALESCE(c.scheduled_at, c.sent_at) < NOW() - INTERVAL '24 hours'
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
        EXTRACT(HOUR FROM COALESCE(c.scheduled_at, c.sent_at) AT TIME ZONE 'Asia/Seoul')::int as hour,
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
        TO_CHAR(COALESCE(c.scheduled_at, c.sent_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as sent_at
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
