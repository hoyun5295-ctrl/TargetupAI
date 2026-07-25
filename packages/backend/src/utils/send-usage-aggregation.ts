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

export async function getTablesForBillingPeriod(baseTables: string[], startDate: string, endDate: string): Promise<string[]> {
  const existingLogs = await getBillingLogTables();
  const allTables = [...baseTables];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const ym = `${cur.getFullYear()}${String(cur.getMonth() + 1).padStart(2, '0')}`;
    for (const t of baseTables) {
      const logTable = `${t}_${ym}`;
      if (existingLogs.has(logTable) && !allTables.includes(logTable)) allTables.push(logTable);
    }
    cur.setMonth(cur.getMonth() + 1);
  }
  return allTables;
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
export async function buildCompanyUsageByDay(opts: {
  companyId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  userId?: string;
}): Promise<UsageDayData> {
  const { companyId, startDate, endDate, userId } = opts;
  const dayData: UsageDayData = {};

  // 1) 대상 run_id 수집
  //   ★ 2026-06-11: 신규 직접발송 파이프라인(staging worker, 5/30+)은 campaign_runs를 만들지 않고
  //   큐 app_etc1에 campaigns.id를 기록 — campaign_runs만 보던 집계에서 통째로 빠지던 누락 fix.
  //   양쪽을 IN에 넣어도 MySQL 행은 자기 app_etc1 하나에만 매칭되므로 이중 계상 0.
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
  const runIds = runsResult.rows.map((r: any) => r.run_id);

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
      const kakaoRows = await mysqlQuery(
        `SELECT DATE(REQUEST_DATE) as send_date,
                COUNT(*) as total_count,
                SUM(CASE WHEN REPORT_CODE = '0000' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN REPORT_CODE != '0000' AND STATUS IN ('3','4') THEN 1 ELSE 0 END) as fail_count,
                SUM(CASE WHEN STATUS IN ('1','2') THEN 1 ELSE 0 END) as pending_count
         FROM IMC_BM_FREE_BIZ_MSG
         WHERE REQUEST_UID IN (${kph})
           AND REQUEST_DATE >= ? AND REQUEST_DATE < DATE_ADD(?, INTERVAL 1 DAY)
         GROUP BY DATE(REQUEST_DATE)`,
        [...kakaoCampaignIds, startDate, endDate]
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
      const dkRows = await mysqlQuery(
        `SELECT DATE(REQUEST_DATE) as send_date,
                COUNT(*) as total_count,
                SUM(CASE WHEN REPORT_CODE = '0000' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN REPORT_CODE != '0000' AND STATUS IN ('3','4') THEN 1 ELSE 0 END) as fail_count,
                SUM(CASE WHEN STATUS IN ('1','2') THEN 1 ELSE 0 END) as pending_count
         FROM IMC_BM_FREE_BIZ_MSG
         WHERE REQUEST_UID IN (${dkph})
         GROUP BY DATE(REQUEST_DATE)`,
        directKakaoIds
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
