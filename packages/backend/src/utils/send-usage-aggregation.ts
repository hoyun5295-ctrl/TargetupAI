/**
 * send-usage-aggregation.ts — 고객사 발송 사용량 집계 컨트롤타워 (★ 2026-07-25 신설)
 *
 * 신설 사유(Harold 지시 2026-07-25): 발송통계 엑셀의 유형이 **청구서와 다르면 정산이 성립하지 않는다.**
 *   기존에는 청구서만 MySQL 실제 `msg_type`으로 집계하고, 통계 화면은 캠페인에 선언된 유형을 썼다.
 *   본문 90바이트 초과 시 큐 적재 단계에서 SMS→LMS로 자동 승격되는데 캠페인 값은 갱신되지 않아
 *   같은 발송이 화면에선 SMS, 청구서에선 LMS로 갈렸다.
 *
 * 그래서 **청구서가 쓰던 집계 블록을 그대로 이 파일로 옮기고**, 청구서(billing.ts)와 발송통계 엑셀이
 * 같은 함수를 호출하게 한다. 로직을 복사하면 언젠가 갈라지므로 복사가 아니라 이동이다.
 *
 * 반환 = `dayData[YYYY-MM-DD][유형키] = { total, success, fail, pending }`
 *   유형키: SMS · LMS · MMS · KAKAO · TEST_SMS · TEST_LMS · SPAM_SMS · SPAM_LMS
 *   (청구 단가가 이 키 단위로 매겨진다 — billing.ts 단가 스냅샷과 1:1)
 */

import pool, { mysqlQuery } from '../config/database';
import { SUCCESS_CODES_SQL, PENDING_CODES_SQL } from './sms-result-map';
import { getAllBulkSmsTables, getBitoSmsTables, getTestSmsTables, mergeLineTables } from './sms-queue';

/** SMSQ msg_type → 청구 유형키. 변환 누락 = 그 유형이 청구 합산에서 통째로 빠진다. */
export const MSG_TYPE_TO_USAGE_KEY: Record<string, string> = { S: 'SMS', L: 'LMS', M: 'MMS', K: 'KAKAO' };

export interface UsageDayCounts { total: number; success: number; fail: number; pending: number }
/** 일자(YYYY-MM-DD) → 유형키 → 카운트 */
export type UsageDayData = Record<string, Record<string, UsageDayCounts>>;

// ============================================================
//  청구 단가 스냅샷 — 유형키와 1:1
// ============================================================

/** 숫자로 읽되 "미설정"과 "0원 설정"을 구분한다. 미설정만 null. */
function priceOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * `companies` 단가 행 → 유형키별 청구 단가.
 *
 * ★ 2026-07-25 정정 — 테스트 단가는 `Number(x) || 일반단가` 폴백이었다.
 *   0원은 falsy라 폴백에 먹혀 **"테스트 발송 무료" 설정이 조용히 일반 단가로 되돌아갔다.**
 *   슈퍼관리자 화면은 0을 정상 저장하고(admin.ts NULLIF), 프론트도 `?? ''`로 0을 보존하는데
 *   읽는 쪽만 깨져 있어서 화면에는 0원인데 청구는 일반 단가로 나가는 구조였다.
 *   미설정(NULL/빈값)일 때만 일반 단가를 상속하고, 명시된 0원은 0원 그대로 쓴다.
 *
 * 스팸필터는 전용 단가를 두지 않고 일반 SMS/LMS 단가를 그대로 쓴다(D16 결정).
 */
export function resolveBillingUnitPrices(co: any): Record<string, number> {
  const sms = priceOrNull(co?.cost_per_sms) ?? 0;
  const lms = priceOrNull(co?.cost_per_lms) ?? 0;
  return {
    SMS: sms,
    LMS: lms,
    MMS: priceOrNull(co?.cost_per_mms) ?? 0,
    KAKAO: priceOrNull(co?.cost_per_kakao) ?? 0,
    TEST_SMS: priceOrNull(co?.cost_per_test_sms) ?? sms,
    TEST_LMS: priceOrNull(co?.cost_per_test_lms) ?? lms,
    SPAM_SMS: sms,
    SPAM_LMS: lms,
  };
}

// ============================================================
//  테이블 해석 헬퍼 — CT-04(sms-queue.ts) 재사용
// ============================================================

// ★ 2026-06-11: 회사 라인만 → 전 bulk 라인 합집합. 사용자 개별 라인 발송분(에이치피오 87,014 = 대량발송(1))이
//   회사 라인({7,8,9})만 보던 정산에서 통째로 빠지던 누락 fix. 라인 해제/재배정에도 내성.
//   회사 격리는 whereClause(app_etc1 IN (그 회사 run/campaign id) · app_etc2=company_id)가 보장 — 타사 혼입 0.
// ★ 2026-07-17: bulk → bulk + bito 합집합 (Harold 승인). getAllBulkSmsTables는 group_type='bulk'만 봐서
//   비토 게이트웨이 라인(13·14·15) 발송분이 정산에서 통째로 빠져 있었다.
export const getBillingCompanyTables = async (_companyId: string) => {
  const [bulk, bito] = await Promise.all([getAllBulkSmsTables(), getBitoSmsTables()]);
  return mergeLineTables(bulk, bito);
};
export const getBillingTestTables = () => getTestSmsTables();

export async function getBillingLogTables(): Promise<Set<string>> {
  const rows = await mysqlQuery(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME REGEXP '^SMSQ_SEND(_[0-9]+)?_[0-9]{6}$'`
  ) as any[];
  const tables = new Set<string>();
  for (const row of rows) tables.add(String(row.TABLE_NAME));
  return tables;
}

/**
 * (순수) 정산 기간에 훑어야 할 LOG 테이블의 연월(YYYYMM) 목록 — **기간 앞뒤로 한 달씩 넓힌다.**
 *
 * ★ 2026-07-25 실측으로 확인된 결함 정정.
 *   게이트웨이가 큐 행을 LOG 테이블로 옮길 때 발송일 기준 달로 정확히 나뉘지 않는다.
 *   실측: `SMSQ_SEND_6_202606`에 `sendreq_time = 2026-07-01 10:00:00~10:00:19`인 385건(전부 성공)이 들어 있다.
 *   7월 정산은 `_202607`만 훑어서 이 385건을 못 보고, 6월 정산도 그 캠페인이 7월 발송이라
 *   6월 발송ID 목록에 없어 못 본다 — **양쪽 어디에도 안 잡히고 사라진다.**
 *   월 경계마다 반복되는 구조라 월말 대량 발송이 걸리면 그대로 커진다.
 *
 * 앞뒤로 넓혀도 이중 계상은 구조적으로 불가능하다. 큐 행은 테이블 하나에만 존재하고,
 * 청구에 들어갈지는 `app_etc1`이 그 기간 발송ID 목록에 있느냐가 정한다 —
 * 기간 밖 발송의 행은 테이블을 더 훑어도 애초에 매칭되지 않는다.
 */
export function billingLogMonths(startDate: string, endDate: string): string[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const months: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth() - 1, 1);        // 시작월 −1
  const last = new Date(end.getFullYear(), end.getMonth() + 1, 1);           // 종료월 +1
  while (cur <= last) {
    months.push(`${cur.getFullYear()}${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

export async function getTablesForBillingPeriod(baseTables: string[], startDate: string, endDate: string): Promise<string[]> {
  const existingLogs = await getBillingLogTables();
  const allTables = [...baseTables];
  for (const ym of billingLogMonths(startDate, endDate)) {
    for (const t of baseTables) {
      const logTable = `${t}_${ym}`;
      if (existingLogs.has(logTable) && !allTables.includes(logTable)) allTables.push(logTable);
    }
  }
  return allTables;
}

/**
 * 카카오 브랜드메시지(IMC) 조회 전용 — 테이블이 없으면 조용히 건너뛴다.
 *
 * ★ 2026-07-25 실측: 운영 MySQL에 `IMC%` 테이블이 전 스키마에 하나도 없다(SMSQ_SEND는 104개 존재).
 *   지금은 카카오/both 채널 발송이 0건이라 이 쿼리 자체가 실행되지 않아 안 터지지만,
 *   어느 회사든 카카오 채널로 한 건만 보내면 `/generate`가 ER_NO_SUCH_TABLE(1146)로 500이 된다.
 *   정산은 한 달에 한 번 뽑는 작업이라 그 자리에서 막히면 마감을 놓친다.
 *
 * ※ SMSQ 라인 테이블에는 이 방어를 쓰지 않는다. 라인 테이블이 없는 건 설정 오류이고,
 *   조용히 건너뛰면 그 라인 발송분이 통째로 미청구가 된다 — 반드시 터져야 한다.
 */
async function queryImcOrSkipIfMissing(sql: string, params: any[], context: string): Promise<any[]> {
  try {
    return await mysqlQuery(sql, params) as any[];
  } catch (e: any) {
    if (e?.errno === 1146 || e?.code === 'ER_NO_SUCH_TABLE') {
      console.log(`[정산] ${context} — IMC 테이블 없음, 집계에서 제외. (${e?.message || ''})`);
      return [];
    }
    throw e;
  }
}

/** SMSQ 테이블들에서 (일자 × msg_type) 카운트 — 청구 단가 산정의 기준 축 */
export async function smsAggByDateType(tables: string[], whereClause: string, params: any[]): Promise<any[]> {
  const allRows: any[] = [];
  for (const t of tables) {
    const rows = await mysqlQuery(
      `SELECT msg_type, DATE(sendreq_time) as send_date,
              COUNT(*) as total_count,
              SUM(CASE WHEN status_code IN (${SUCCESS_CODES_SQL}) THEN 1 ELSE 0 END) as success_count,
              SUM(CASE WHEN status_code NOT IN (${SUCCESS_CODES_SQL},${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as fail_count,
              SUM(CASE WHEN status_code IN (${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as pending_count
       FROM ${t} WHERE ${whereClause}
       GROUP BY msg_type, DATE(sendreq_time)`,
      params
    ) as any[];
    allRows.push(...rows);
  }
  return allRows;
}

/** MySQL/PG가 돌려주는 날짜값을 YYYY-MM-DD 문자열로 */
function toDayKey(v: any): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function bump(dayData: UsageDayData, day: string, type: string, row: { total?: any; success?: any; fail?: any; pending?: any }): void {
  if (!dayData[day]) dayData[day] = {};
  if (!dayData[day][type]) dayData[day][type] = { total: 0, success: 0, fail: 0, pending: 0 };
  const b = dayData[day][type];
  b.total += Number(row.total || 0);
  b.success += Number(row.success || 0);
  b.fail += Number(row.fail || 0);
  b.pending += Number(row.pending || 0);
}

/**
 * 회사의 발송 사용량을 **청구 기준 그대로** 일자×유형으로 집계한다.
 * billing.ts(거래내역서·청구서)와 발송통계 엑셀이 함께 호출하는 단일 진입점.
 *
 * @param userId 지정 시 그 사용자 발송분만(일반발송 한정). 테스트·스팸은 회사 단위 항목이라 제외된다 — 청구서 동작 그대로.
 */
/**
 * 청구 대상 run_id 집합 — **어느 발송을 이 기간 청구에 넣을지**를 정하는 유일한 기준.
 *
 * ★ 2026-07-25 함수로 분리 — SQL은 그대로다. 미리보기(`/preview`)가 자체 SQL로 다른 집합을 뽑고 있어서
 *   같은 기간인데 미리보기 금액과 실제 발행 금액이 달랐다. 두 경로가 이 함수 하나만 보게 한다.
 *   (미리보기는 `cr.status = 'completed'` 조건이 없어 미완료 발송까지 세고 있었다.)
 *
 * ★ 2026-06-11: 신규 직접발송 파이프라인(staging worker, 5/30+)은 campaign_runs를 만들지 않고
 *   큐 app_etc1에 campaigns.id를 기록 — campaign_runs만 보던 집계에서 통째로 빠지던 누락 fix.
 *   양쪽을 IN에 넣어도 MySQL 행은 자기 app_etc1 하나에만 매칭되므로 이중 계상 0.
 */
export async function selectBillingRunIds(opts: {
  companyId: string;
  startDate: string;
  endDate: string;
  userId?: string;
}): Promise<string[]> {
  const { companyId, startDate, endDate, userId } = opts;
  let runsSql = `
    SELECT cr.id as run_id
    FROM campaign_runs cr
    JOIN campaigns c ON c.id = cr.campaign_id
    WHERE c.company_id = $1
      AND cr.sent_at >= $2::date
      AND cr.sent_at < ($3::date + interval '1 day')
      AND cr.status = 'completed'`;
  const runsParams: any[] = [companyId, startDate, endDate];
  if (userId) {
    runsParams.push(userId);
    // ★ 2026-07-25 정정 — 캠페인 생성 경로가 채우는 컬럼은 `created_by`다(user_id는 대부분 비어 있다).
    //   `c.user_id`로 걸러 왔던 탓에 사용자 지정 청구서에서 캠페인 발송분이 통째로 빠졌다.
    //   통계 화면도 `created_by` 기준이라 이제 화면·엑셀·청구서가 같은 축을 본다.
    runsSql += ` AND c.created_by = $${runsParams.length}`;
  }
  runsSql += `
    UNION
    SELECT c2.id as run_id
    FROM campaigns c2
    WHERE c2.company_id = $1
      AND c2.send_type = 'direct'
      AND c2.send_phase = 'sent'
      AND c2.status = 'completed'
      AND COALESCE(c2.scheduled_at, c2.sent_at) >= $2::date
      AND COALESCE(c2.scheduled_at, c2.sent_at) < ($3::date + interval '1 day')`;
  if (userId) runsSql += ` AND c2.created_by = $${runsParams.length}`;

  const runsResult = await pool.query(runsSql, runsParams);
  return runsResult.rows.map((r: any) => r.run_id);
}

/**
 * (순수) 일자×유형 집계 → 유형별 **성공 건수** 합계. 청구 금액의 수량 축이다.
 * 청구서 발행과 미리보기가 같은 수량을 쓰도록 합산도 한 함수로 묶는다.
 */
/** 청구가 합산하는 유형키 — 여기 없는 키는 수량이 아무리 많아도 0원이 된다. */
const EMPTY_BILLING_TOTALS: Record<string, number> = {
  SMS: 0, LMS: 0, MMS: 0, KAKAO: 0, TEST_SMS: 0, TEST_LMS: 0, SPAM_SMS: 0, SPAM_LMS: 0,
};

export function buildBillingTotals(dayData: UsageDayData): Record<string, number> {
  const totals: Record<string, number> = { ...EMPTY_BILLING_TOTALS };
  Object.values(dayData || {}).forEach((types) => {
    Object.entries(types || {}).forEach(([key, counts]) => {
      if (key in totals) totals[key] += Number(counts?.success) || 0;
    });
  });
  return totals;
}

export interface UnbillableUsageKey { key: string; success: number; total: number }

/**
 * (순수) 집계에는 잡혔는데 **청구가 읽지 못하는** 유형키를 찾아낸다.
 *
 * ★ 2026-07-25 신설. 이 계열 결함이 이번이 두 번째다:
 *   SMSQ msg_type 'M'·'K'가 유형키로 변환되지 않아 MMS 308,043건과 알림톡이 통째로 0원 청구됐다.
 *   증상이 "에러"가 아니라 "조용히 적은 금액"이라 청구서를 눈으로 봐도 안 걸린다.
 *   그래서 개별 유형을 하나씩 막는 대신, 모르는 키가 들어오면 그 자리에서 드러나게 한다.
 *   새 발송 채널·새 msg_type이 생겼는데 변환을 빠뜨리면 첫 정산에서 로그로 잡힌다.
 */
export function findUnbillableUsageKeys(dayData: UsageDayData): UnbillableUsageKey[] {
  const acc = new Map<string, UnbillableUsageKey>();
  Object.values(dayData || {}).forEach((types) => {
    Object.entries(types || {}).forEach(([key, counts]) => {
      if (key in EMPTY_BILLING_TOTALS) return;
      if (!acc.has(key)) acc.set(key, { key, success: 0, total: 0 });
      const a = acc.get(key)!;
      a.success += Number(counts?.success) || 0;
      a.total += Number(counts?.total) || 0;
    });
  });
  return Array.from(acc.values()).sort((a, b) => b.success - a.success || a.key.localeCompare(b.key));
}

/** 누락 유형키를 운영 로그로 드러낸다(stdout — stderr는 분기에 따라 안 남을 수 있다). */
export function logUnbillableUsageKeys(dayData: UsageDayData, context: string): UnbillableUsageKey[] {
  const unknown = findUnbillableUsageKeys(dayData);
  if (unknown.length > 0) {
    const detail = unknown.map((u) => `${u.key}(성공 ${u.success}/적재 ${u.total})`).join(', ');
    console.log(`[정산][유형누락] ${context} — 청구가 못 읽는 유형키: ${detail}. MSG_TYPE_TO_USAGE_KEY 변환 또는 단가 정의 누락 점검 필요.`);
  }
  return unknown;
}

export async function buildCompanyUsageByDay(opts: {
  companyId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  userId?: string;
}): Promise<UsageDayData> {
  const { companyId, startDate, endDate, userId } = opts;
  const dayData: UsageDayData = {};

  // 1) 대상 run_id 수집
  const runIds = await selectBillingRunIds({ companyId, startDate, endDate, userId });

  // 2) 일반발송 — 회사 라인그룹 + LOG 테이블 통합
  if (runIds.length > 0) {
    const companyTables = await getBillingCompanyTables(companyId);
    const billingTables = await getTablesForBillingPeriod(companyTables, startDate, endDate);
    const ph = runIds.map(() => '?').join(',');
    const rows = await smsAggByDateType(billingTables, `app_etc1 IN (${ph})`, runIds);
    rows.forEach((row: any) => {
      // ★ 2026-07-25 정정 — 'M'·'K'가 변환되지 않아 청구 합산(types.MMS·types.KAKAO)에서 통째로 빠졌다.
      //   SMSQ msg_type은 S/L/M/K다(qtmsg-type.ts toQtmsgType · 알림톡은 sms-queue insertAlimtalkQueue가 'K'로 적재).
      //   변환 누락 시 dayData에 'M'·'K' 키로 담겼다가 billing 합산이 못 읽어 0원 청구가 된다.
      const t = MSG_TYPE_TO_USAGE_KEY[row.msg_type] || String(row.msg_type || '');
      bump(dayData, toDayKey(row.send_date), t, {
        total: row.total_count, success: row.success_count, fail: row.fail_count, pending: row.pending_count,
      });
    });
  }

  // 3) 테스트발송 — 테스트 전용 라인 + LOG 테이블 통합 (회사 단위라 사용자 필터 시 제외)
  if (!userId) {
    const testBaseTables = await getBillingTestTables();
    const testTables = await getTablesForBillingPeriod(testBaseTables, startDate, endDate);
    const testRows = await smsAggByDateType(
      testTables,
      `app_etc1 = 'test' AND app_etc2 = ? AND sendreq_time >= ? AND sendreq_time < DATE_ADD(?, INTERVAL 1 DAY)`,
      [companyId, startDate, endDate]
    );
    testRows.forEach((row: any) => {
      const t = row.msg_type === 'S' ? 'TEST_SMS' : 'TEST_LMS';
      bump(dayData, toDayKey(row.send_date), t, {
        total: row.total_count, success: row.success_count, fail: row.fail_count, pending: row.pending_count,
      });
    });
  }

  // 4) 스팸필터 테스트 (PostgreSQL)
  if (!userId) {
    const spamResult = await pool.query(`
      SELECT
        r.message_type,
        DATE(t.created_at AT TIME ZONE 'Asia/Seoul') as send_date,
        COUNT(*) as total_count,
        SUM(CASE WHEN r.result IS NOT NULL THEN 1 ELSE 0 END) as success_count
      FROM spam_filter_test_results r
      JOIN spam_filter_tests t ON r.test_id = t.id
      WHERE t.company_id = $1
        AND t.created_at >= ($2 || ' 00:00:00+09')::timestamptz
        AND t.created_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz
      GROUP BY r.message_type, DATE(t.created_at AT TIME ZONE 'Asia/Seoul')
    `, [companyId, startDate, endDate]);
    spamResult.rows.forEach((row: any) => {
      const t = row.message_type === 'LMS' ? 'SPAM_LMS' : 'SPAM_SMS';
      bump(dayData, toDayKey(row.send_date), t, { total: row.total_count, success: row.success_count });
    });
  }

  // 5) 카카오 브랜드메시지 (IMC_BM_FREE_BIZ_MSG) — 캠페인 발송분
  //   ※ 알림톡은 여기가 아니다. 알림톡은 SMSQ에 msg_type='K'로 적재된다(sms-queue.ts insertAlimtalkQueue).
  //     위 2) 일반발송 집계가 담당하며, 유형키 변환(K→KAKAO)이 그 몫이다.
  if (runIds.length > 0) {
    const campaignIdsResult = await pool.query(
      `SELECT DISTINCT c.id as campaign_id
       FROM campaign_runs cr
       JOIN campaigns c ON c.id = cr.campaign_id
       WHERE cr.id = ANY($1::uuid[])
         AND (c.send_channel = 'kakao' OR c.send_channel = 'both')`,
      [runIds]
    );
    const kakaoCampaignIds = campaignIdsResult.rows.map((r: any) => r.campaign_id);
    if (kakaoCampaignIds.length > 0) {
      const kph = kakaoCampaignIds.map(() => '?').join(',');
      const kakaoRows = await queryImcOrSkipIfMissing(
        `SELECT DATE(REQUEST_DATE) as send_date,
                COUNT(*) as total_count,
                SUM(CASE WHEN REPORT_CODE = '0000' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN REPORT_CODE != '0000' AND STATUS IN ('3','4') THEN 1 ELSE 0 END) as fail_count,
                SUM(CASE WHEN STATUS IN ('1','2') THEN 1 ELSE 0 END) as pending_count
         FROM IMC_BM_FREE_BIZ_MSG
         WHERE REQUEST_UID IN (${kph})
           AND REQUEST_DATE >= ? AND REQUEST_DATE < DATE_ADD(?, INTERVAL 1 DAY)
         GROUP BY DATE(REQUEST_DATE)`,
        [...kakaoCampaignIds, startDate, endDate],
        `캠페인 브랜드메시지 ${kakaoCampaignIds.length}건`
      );
      (kakaoRows as any[]).forEach((row: any) => {
        bump(dayData, toDayKey(row.send_date), 'KAKAO', {
          total: row.total_count, success: row.success_count, fail: row.fail_count, pending: row.pending_count,
        });
      });
    }
  }

  // 6) 직접발송(direct-send) 카카오
  {
    // ★ 2026-07-25 사용자 지정 정산에 사용자 필터가 없어 같은 회사 타 사용자 발송분이 섞였다
    const dkParams: any[] = [companyId, startDate, endDate];
    let dkUserWhere = '';
    if (userId) { dkParams.push(userId); dkUserWhere = ` AND created_by = $${dkParams.length}`; }
    const directKakaoResult = await pool.query(
      // ※ 'direct'를 넣으면 구형 /direct-send 경로가 campaign_runs도 만들기 때문에
      //   위 캠페인 arm과 겹쳐 같은 IMC 행을 두 번 센다. 원 동작('manual')을 유지한다.
      `SELECT id FROM campaigns
       WHERE company_id = $1
         AND send_type = 'manual'
         AND (send_channel = 'kakao' OR send_channel = 'both')
         AND sent_at >= $2::date
         AND sent_at < ($3::date + interval '1 day')${dkUserWhere}`,
      dkParams
    );
    const directKakaoIds = directKakaoResult.rows.map((r: any) => r.id);
    if (directKakaoIds.length > 0) {
      const dkph = directKakaoIds.map(() => '?').join(',');
      const dkRows = await queryImcOrSkipIfMissing(
        `SELECT DATE(REQUEST_DATE) as send_date,
                COUNT(*) as total_count,
                SUM(CASE WHEN REPORT_CODE = '0000' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN REPORT_CODE != '0000' AND STATUS IN ('3','4') THEN 1 ELSE 0 END) as fail_count,
                SUM(CASE WHEN STATUS IN ('1','2') THEN 1 ELSE 0 END) as pending_count
         FROM IMC_BM_FREE_BIZ_MSG
         WHERE REQUEST_UID IN (${dkph})
         GROUP BY DATE(REQUEST_DATE)`,
        directKakaoIds,
        `직접발송 브랜드메시지 ${directKakaoIds.length}건`
      );
      (dkRows as any[]).forEach((row: any) => {
        bump(dayData, toDayKey(row.send_date), 'KAKAO', {
          total: row.total_count, success: row.success_count, fail: row.fail_count, pending: row.pending_count,
        });
      });
    }
  }

  return dayData;
}

/** 발송통계 엑셀 웹 행용 — 청구 유형키를 사용자 표시명으로 */
export const USAGE_TYPE_LABEL: Record<string, string> = {
  SMS: 'SMS',
  LMS: 'LMS',
  MMS: 'MMS',
  KAKAO: '카카오',
  TEST_SMS: '테스트 SMS',
  TEST_LMS: '테스트 LMS',
  SPAM_SMS: '스팸테스트 SMS',
  SPAM_LMS: '스팸테스트 LMS',
};

/** 유형 표시 순서 — 청구서 항목 순서와 동일 */
const USAGE_TYPE_ORDER = ['SMS', 'LMS', 'MMS', 'KAKAO', 'TEST_SMS', 'TEST_LMS', 'SPAM_SMS', 'SPAM_LMS'];

export interface UsagePeriodTypeRow {
  period: string;
  type_key: string;
  type_label: string;
  sent: number;
  success: number;
  fail: number;
  pending: number;
}

/**
 * (순수) `buildCompanyUsageByDay` 결과를 기간(일/월) × 유형 행으로 롤업.
 * 일자 문자열만 다루므로 DB 없이 단위 테스트 가능하다.
 */
export function rollupUsageByPeriod(dayData: UsageDayData, view: 'daily' | 'monthly'): UsagePeriodTypeRow[] {
  const byKey = new Map<string, UsagePeriodTypeRow>();
  for (const [day, types] of Object.entries(dayData || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const period = view === 'monthly' ? day.slice(0, 7) : day;
    for (const [typeKey, c] of Object.entries(types || {})) {
      const k = `${period}|${typeKey}`;
      if (!byKey.has(k)) {
        byKey.set(k, { period, type_key: typeKey, type_label: USAGE_TYPE_LABEL[typeKey] || typeKey, sent: 0, success: 0, fail: 0, pending: 0 });
      }
      const b = byKey.get(k)!;
      b.sent += Number(c.total) || 0;
      b.success += Number(c.success) || 0;
      b.fail += Number(c.fail) || 0;
      b.pending += Number(c.pending) || 0;
    }
  }
  const order = (t: string) => {
    const i = USAGE_TYPE_ORDER.indexOf(t);
    return i === -1 ? 99 : i;
  };
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.period !== b.period) return b.period.localeCompare(a.period);
    const o = order(a.type_key) - order(b.type_key);
    return o !== 0 ? o : a.type_key.localeCompare(b.type_key);
  });
}
