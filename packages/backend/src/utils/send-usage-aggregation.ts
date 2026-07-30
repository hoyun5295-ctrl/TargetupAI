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

import pool, { mysqlBillingQuery, MYSQL_BILLING_POOL_LIMIT } from '../config/database';
import { SUCCESS_CODES_SQL, PENDING_CODES_SQL } from './sms-result-map';
import { getAllBulkSmsTables, getBitoSmsTables, getTestSmsTables, mergeLineTables } from './sms-queue';
import { queryPayAgentStoreBreakdown, type PayAgentStoreRow } from './pay-stats';
import { loadBillingLedger, hasAgentMapping, type BillingLedger } from './billing-ledger';
import { floorWon } from './money';
import { mapWithConcurrency } from './concurrency';
import { normalizeUnitPriceBasis, toSupplyPrice, type UnitPriceBasis } from './unit-price';
import type { PlanSegment } from './plan-proration';
import {
  BILLING_TYPES,
  type BillingTypeDef, type AgentPriceColumn, type AgentUnitPriceRow,
} from './billing-types';

// 축 정의는 `billing-types.ts`(순수)로 옮겼다. 소비처가 이 모듈에서 가져다 쓰던 이름은 그대로 둔다.
export { BILLING_TYPES };
export type { BillingTypeDef, AgentPriceColumn, AgentUnitPriceRow };

/** SMSQ msg_type → 청구 유형키. 변환 누락 = 그 유형이 청구 합산에서 통째로 빠진다. */
export const MSG_TYPE_TO_USAGE_KEY: Record<string, string> = Object.fromEntries(
  BILLING_TYPES.filter((t) => t.smsqCode).map((t) => [t.smsqCode as string, t.key]),
);

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
  return resolveBillingUnitPricesDetailed(co).prices;
}

/**
 * 단가와 함께 **"미설정이라 0원으로 떨어진 유형키"** 를 돌려준다. (★ 2026-07-26 신설)
 *
 * `priceOrNull`이 미설정(NULL)과 명시적 0원을 구분해 놓고도 곧바로 `?? 0`으로 합쳐지고 있었다.
 * 그래서 `cost_per_mms`가 비어 있는 회사가 MMS를 1,000건 보내면 **아무 경고 없이 0원으로 청구**된다.
 * 에이전트 단가는 미설정을 막게 해놨는데(`priceBillingRows`) 웹만 뚫려 있던 것이다 —
 * MMS 308,043건 0원 청구가 정확히 이 계열의 사고였다.
 *
 * 기존 함수 시그니처는 그대로 둔다(소비처 3곳 + 기존 테스트 9개 무수정 통과).
 *
 * ★ 테스트 단가는 미설정 시 일반 단가를 상속하는 것이 **설계된 동작**이다(0725 정정).
 *   그래서 자기도 비어 있고 **상속원까지 비어 있을 때만** 미설정으로 본다.
 *   스팸은 전용 단가가 없고 일반 SMS/LMS를 그대로 쓰므로(D16) 그 원본을 따른다.
 */
export function resolveBillingUnitPricesDetailed(co: any): { prices: Record<string, number>; unsetKeys: string[] } {
  // ★ 2026-07-26 청구는 **공급가(부가세 별도)** 로 계산한다. 저장값이 어느 기준인지는 회사마다 다르므로
  //   `unit_price_basis`를 통해 변환한다(전환 전 회사는 ÷1.1, 전환 후 회사는 그대로).
  //   변환을 여기 한 곳에 두는 이유: 청구 단가를 읽는 경로가 `/generate`·`/preview` 둘뿐이고
  //   둘 다 이 함수를 지난다. 라우트에서 각자 나누면 두 금액이 갈라진다.
  const basis = normalizeUnitPriceBasis(co?.unit_price_basis);
  const supply = (v: any) => toSupplyPrice(priceOrNull(v), basis);
  const smsRaw = supply(co?.cost_per_sms);
  const lmsRaw = supply(co?.cost_per_lms);
  const mmsRaw = supply(co?.cost_per_mms);
  const kakaoRaw = supply(co?.cost_per_kakao);
  // ★ 2026-07-29 브랜드메시지 — 알림톡과 다른 단가다. 그 전에는 브랜드 발송이 KAKAO 단가로 청구됐다.
  const brandRaw = supply(co?.cost_per_brand);
  const testSmsRaw = supply(co?.cost_per_test_sms);
  const testLmsRaw = supply(co?.cost_per_test_lms);

  const sms = smsRaw ?? 0;
  const lms = lmsRaw ?? 0;
  const prices: Record<string, number> = {
    SMS: sms,
    LMS: lms,
    MMS: mmsRaw ?? 0,
    KAKAO: kakaoRaw ?? 0,
    BRAND: brandRaw ?? 0,
    TEST_SMS: testSmsRaw ?? sms,
    TEST_LMS: testLmsRaw ?? lms,
    SPAM_SMS: sms,
    SPAM_LMS: lms,
  };

  const unsetKeys: string[] = [];
  if (smsRaw === null) unsetKeys.push('SMS');
  if (lmsRaw === null) unsetKeys.push('LMS');
  if (mmsRaw === null) unsetKeys.push('MMS');
  if (kakaoRaw === null) unsetKeys.push('KAKAO');
  // 브랜드 단가는 알림톡을 상속하지 않는다 — 상속시키면 미설정이 조용히 알림톡 단가로 청구된다.
  if (brandRaw === null) unsetKeys.push('BRAND');
  if (testSmsRaw === null && smsRaw === null) unsetKeys.push('TEST_SMS');
  if (testLmsRaw === null && lmsRaw === null) unsetKeys.push('TEST_LMS');
  if (smsRaw === null) unsetKeys.push('SPAM_SMS');
  if (lmsRaw === null) unsetKeys.push('SPAM_LMS');

  return { prices, unsetKeys };
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
  const rows = await mysqlBillingQuery(
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

/**
 * @param existingLogTables 이미 읽어 둔 LOG 테이블 목록. 넘기면 `information_schema` REGEXP 조회를 건너뛴다.
 *   한 번의 발행에서 이 함수가 네 번 불리는데(발송·테스트 × 두 집계) 매번 전 테이블 목록을 다시 읽고 있었다.
 *   **요청 안에서만 재사용한다** — 모듈 캐시로 두면 월 경계에 새로 생긴 LOG 테이블을 못 봐서
 *   그 달 첫 발행이 통째로 미청구가 될 수 있다.
 */
export async function getTablesForBillingPeriod(
  baseTables: string[], startDate: string, endDate: string, existingLogTables?: Set<string>,
): Promise<string[]> {
  const existingLogs = existingLogTables ?? await getBillingLogTables();
  const allTables = [...baseTables];
  for (const ym of billingLogMonths(startDate, endDate)) {
    for (const t of baseTables) {
      const logTable = `${t}_${ym}`;
      if (existingLogs.has(logTable) && !allTables.includes(logTable)) allTables.push(logTable);
    }
  }
  return allTables;
}

// (2026-07-30 재구축) 옛 queryImcOrSkipIfMissing 헬퍼 삭제 — IMC 테이블을 읽는 arm이 전부 폐기됐다.
// 브랜드는 SMSQ msg_type='F'로 일반발송 arm이 담당하며, SMSQ 라인 테이블 부재는 설정 오류라 반드시 터져야 한다.

/**
 * SMSQ 테이블들에서 (발송ID × 일자 × msg_type) 카운트.
 *
 * ★ 2026-07-26 신설 — `smsAggByDateType`은 `app_etc1`을 내리지 않아 **계정 축을 만들 수 없다.**
 *   청구서는 "일자 × 계정 × 유형"으로 나와야 하므로(Harold 정의 항목 2) run_id를 함께 받아
 *   PG에서 `campaigns.created_by`로 되매핑한다. 기존 함수는 화면·엑셀이 쓰고 있어 건드리지 않는다.
 */
/**
 * ★ 2026-07-28 `app_etc1 IN (...)` 집계 전용 인덱스 힌트.
 *
 * **실측으로 확정한 처방이다.** `SMSQ_SEND_5_202607`(606,016행·876MB)에서 캠페인 5개를 집계할 때:
 *   · 힌트 없음 = **12.92초**  (EXPLAIN `type: ALL` · `key: NULL` — 인덱스를 아예 안 쓴다)
 *   · `COUNT(msg_type)` 통짜 읽기 = 12.26초  ← 집계가 통짜 읽기와 같은 값이다
 *   · `FORCE INDEX (idx_app_etc1_sendreq)` = **1.17초** (결과 동일, 11배)
 *
 * 왜 옵티마이저가 인덱스를 버렸나 — EXPLAIN의 `filtered: 49.60`. 캠페인 5개가 실제로는
 * 테이블의 23.4%(144,676/617,523)인데 절반이 걸린다고 추정해서 풀스캔이 싸다고 판단했다.
 * **IN 값이 5개일 때도 그렇다** — 그래서 IN 목록을 잘라 주는 것(청킹)으로는 전혀 해결되지 않았다.
 * 개수가 아니라 선택률 추정이 문제였다.
 *
 * ⚠ `app_etc1 = 'test'`처럼 **단일값**으로 거르는 집계에는 붙이지 않는다. 그쪽은 그 값이 테이블
 *   전체라 인덱스를 강제하면 오히려 느려진다. 그래서 힌트는 호출부가 켠다(기본은 꺼짐).
 * ⚠ 2026-07-28 실측: SMSQ 계열 103개 테이블 **전부** 이 인덱스를 갖고 있다. 그래도 없는 테이블이
 *   생기면 MySQL이 1176으로 죽으므로, 아래 러너가 그때만 힌트 없이 한 번 더 던진다(느릴 뿐 결과는 같다).
 */
export const SMSQ_APP_ETC1_INDEX_HINT = ' FORCE INDEX (idx_app_etc1_sendreq)';

async function queryWithIndexHint(
  buildSql: (hint: string) => string,
  params: any[],
  indexHint: string,
): Promise<any[]> {
  if (!indexHint) return (await mysqlBillingQuery(buildSql(''), params)) as any[];
  try {
    return (await mysqlBillingQuery(buildSql(indexHint), params)) as any[];
  } catch (e: any) {
    // 1176 = Key ... doesn't exist in table. 인덱스 없는 테이블에서만 난다 — 힌트를 빼고 재시도.
    if (e?.errno === 1176) return (await mysqlBillingQuery(buildSql(''), params)) as any[];
    throw e;
  }
}

export async function smsAggByRunDateType(
  tables: string[],
  whereClause: string,
  params: any[],
  indexHint = '',
): Promise<any[]> {
  // ★ 2026-07-26 직렬 `for await`를 동시성 상한 병렬로 바꿨다. 테이블 수만큼 왕복이 순차라
  //   회사당 40~48개 × 두 집계 = 90~100회가 한 줄로 섰다(금강제화 발행 2분의 지배 요인).
  //   풀(10)을 독점하지 않도록 상한을 둔다 — 발송·환불 워커가 같은 풀을 쓴다.
  const perTable = await mapWithConcurrency(tables, MYSQL_BILLING_POOL_LIMIT, async (t) => {
    return await queryWithIndexHint(
      (hint) =>
        `SELECT app_etc1 as run_id, msg_type, DATE(sendreq_time) as send_date,
              COUNT(*) as total_count,
              SUM(CASE WHEN status_code IN (${SUCCESS_CODES_SQL}) THEN 1 ELSE 0 END) as success_count,
              SUM(CASE WHEN status_code NOT IN (${SUCCESS_CODES_SQL},${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as fail_count,
              SUM(CASE WHEN status_code IN (${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as pending_count
       FROM ${t}${hint} WHERE ${whereClause}
       GROUP BY app_etc1, msg_type, DATE(sendreq_time)`,
      params,
      indexHint,
    );
  });
  return perTable.flat();
}

/**
 * 테스트 라인 테이블에서 (계정 × 일자 × msg_type) 카운트.
 * 계정은 `bill_id`에 들어간다 — `sms-queue.ts insertTestSmsQueue`가 `extra.billId = userId`로 적재한다.
 */
export async function testSmsAggByUserDateType(tables: string[], whereClause: string, params: any[]): Promise<any[]> {
  // ★ 2026-07-26 직렬 `for await`를 동시성 상한 병렬로 바꿨다. 테이블 수만큼 왕복이 순차라
  //   회사당 40~48개 × 두 집계 = 90~100회가 한 줄로 섰다(금강제화 발행 2분의 지배 요인).
  //   풀(10)을 독점하지 않도록 상한을 둔다 — 발송·환불 워커가 같은 풀을 쓴다.
  const perTable = await mapWithConcurrency(tables, MYSQL_BILLING_POOL_LIMIT, async (t) => {
    return await mysqlBillingQuery(
      `SELECT bill_id, msg_type, DATE(sendreq_time) as send_date,
              COUNT(*) as total_count,
              SUM(CASE WHEN status_code IN (${SUCCESS_CODES_SQL}) THEN 1 ELSE 0 END) as success_count,
              SUM(CASE WHEN status_code NOT IN (${SUCCESS_CODES_SQL},${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as fail_count,
              SUM(CASE WHEN status_code IN (${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as pending_count
       FROM ${t} WHERE ${whereClause}
       GROUP BY bill_id, msg_type, DATE(sendreq_time)`,
      params
    ) as any[];
  });
  return perTable.flat();
}

/** SMSQ 테이블들에서 (일자 × msg_type) 카운트 — 청구 단가 산정의 기준 축 */
export async function smsAggByDateType(
  tables: string[],
  whereClause: string,
  params: any[],
  indexHint = '',
): Promise<any[]> {
  // ★ 2026-07-26 직렬 `for await`를 동시성 상한 병렬로 바꿨다. 테이블 수만큼 왕복이 순차라
  //   회사당 40~48개 × 두 집계 = 90~100회가 한 줄로 섰다(금강제화 발행 2분의 지배 요인).
  //   풀(10)을 독점하지 않도록 상한을 둔다 — 발송·환불 워커가 같은 풀을 쓴다.
  const perTable = await mapWithConcurrency(tables, MYSQL_BILLING_POOL_LIMIT, async (t) => {
    return await queryWithIndexHint(
      (hint) =>
        `SELECT msg_type, DATE(sendreq_time) as send_date,
              COUNT(*) as total_count,
              SUM(CASE WHEN status_code IN (${SUCCESS_CODES_SQL}) THEN 1 ELSE 0 END) as success_count,
              SUM(CASE WHEN status_code NOT IN (${SUCCESS_CODES_SQL},${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as fail_count,
              SUM(CASE WHEN status_code IN (${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as pending_count
       FROM ${t}${hint} WHERE ${whereClause}
       GROUP BY msg_type, DATE(sendreq_time)`,
      params,
      indexHint,
    );
  });
  return perTable.flat();
}

/**
 * ★ 2026-07-28 `app_etc1 IN (...)` 목록을 청크로 나눠 집계한다.
 *
 * 왜 나누는가 — 회사 하나의 run_id가 수백~수천 개가 되면 그 목록을 통째로 IN에 넣는다.
 * MySQL은 IN 값이 `eq_range_index_dive_limit`(기본 200)을 넘으면 인덱스 다이브를 포기하고
 * 평균 통계로 행수를 추정하는데, 그 추정이 테이블의 수십 %가 되면 **인덱스를 버리고 풀스캔**을 고른다.
 * `SMSQ_SEND_5_202607` 실측이 606,016행·876MB였고, 0727 발행에서 그 한 쿼리가 60초 상한을 넘겨 죽었다.
 *
 * 목록을 200 이하로 자르면 인덱스 탐색이 살아난다. 그러면 **그 회사 발송이 없는 테이블은
 * range scan이 즉시 0행을 돌려주고 876MB를 아예 안 읽는다** — 회사당 40~48개 테이블 중
 * 대부분이 그런 테이블이다.
 *
 * ⚠ 스캔 대상 테이블 목록은 그대로 둔다. 목록을 좁히는 방식(`sentTables` 등)은 적재 기록이
 *   불완전할 때 실발송분이 조용히 미청구로 빠진다(에이치피오 87,014건 계열). 여기서는
 *   **우리가 목록을 좁히는 게 아니라 인덱스가 좁힌다** — 누락이 구조적으로 불가능하다.
 *
 * 청크별 결과는 호출부의 `bump`/`bumpRow`가 누적한다. run_id는 정확히 한 청크에만 속하므로
 * 합계는 통짜 쿼리와 같다.
 */
export const RUN_ID_IN_CHUNK = Math.max(1, Number(process.env.BILLING_RUN_ID_IN_CHUNK) || 200);

async function aggregateByRunIdChunks(
  tables: string[],
  runIds: string[],
  agg: (tables: string[], whereClause: string, params: any[], indexHint?: string) => Promise<any[]>,
): Promise<any[]> {
  const out: any[] = [];
  // 청크는 순차로 돈다 — 각 청크가 이미 테이블 수만큼 병렬로 퍼지므로,
  // 청크까지 병렬로 겹치면 정산 풀(8)을 넘겨 서로를 굶긴다.
  for (const chunk of chunkArray(runIds, RUN_ID_IN_CHUNK)) {
    const ph = chunk.map(() => '?').join(',');
    // ★ 2026-07-28 여기서만 인덱스 힌트를 켠다 — `app_etc1 IN (...)` 형태에서만 유효하다.
    //   실측 12.92초 → 1.17초(11배). 근거는 SMSQ_APP_ETC1_INDEX_HINT 주석.
    out.push(...(await agg(tables, `app_etc1 IN (${ph})`, chunk, SMSQ_APP_ETC1_INDEX_HINT)));
  }
  return out;
}

/**
 * ★ 2026-07-30 (적대검증 2R): 두 ID 집합의 이중 집계 —
 *   eventIds는 기존 그대로 기간 조건 없이(1 ID = 1 발송 이벤트 — 산식 불변),
 *   periodCampaignIds는 **청구 기간의 sendreq_time 조건과 함께** 집계한다.
 *   같은 캠페인 ID가 여러 달 재발송돼도 그 달 발송분만 그 달 청구에 실린다.
 *   두 집합은 selectBillingSendIds가 서로소로 만들었으므로 행이 두 번 세어질 수 없다.
 */
export async function aggregateBillingSendIds(
  tables: string[],
  ids: BillingSendIdSets,
  agg: (tables: string[], whereClause: string, params: any[], indexHint?: string) => Promise<any[]>,
  startDate: string,
  endDate: string,
): Promise<any[]> {
  const out: any[] = [...(await aggregateByRunIdChunks(tables, ids.eventIds, agg))];
  for (const chunk of chunkArray(ids.periodCampaignIds, RUN_ID_IN_CHUNK)) {
    const ph = chunk.map(() => '?').join(',');
    out.push(...(await agg(
      tables,
      `app_etc1 IN (${ph}) AND sendreq_time >= ? AND sendreq_time < DATE_ADD(?, INTERVAL 1 DAY)`,
      [...chunk, startDate, endDate],
      SMSQ_APP_ETC1_INDEX_HINT,
    )));
  }
  return out;
}

/**
 * MySQL/PG가 돌려주는 날짜값을 YYYY-MM-DD 문자열로.
 *
 * ★ 2026-07-26 정정 — `toISOString()`을 쓰면 **하루가 앞으로 밀린다.**
 *   mysql2 풀에 `dateStrings` 옵션이 없어 `DATE()` 결과가 **로컬 자정 Date 객체**로 오고
 *   (`config/database.ts` mysql 풀 설정), PG도 `date`(oid 1082) 파서를 재정의하지 않아 같다
 *   (`types.setTypeParser`는 1114=timestamp만 덮는다).
 *   서버 실측(2026-07-26): `DATE('2026-07-15 10:00:00')` → `Wed Jul 15 2026 00:00:00 GMT+0900`
 *   → `toISOString().slice(0,10)` = **`2026-07-14`**.
 *
 *   그래서 발송통계 엑셀 웹 행과 청구서 일자별 상세가 하루씩 밀려 있었다.
 *   에이전트 축은 `YYYYMMDD` 문자열을 자르므로(`pay-stats.ts periodOf`) 안 밀려서,
 *   같은 파일·같은 청구서 안에서 웹 행과 에이전트 행의 날짜 기준이 갈려 있었다.
 *
 *   두 드라이버 모두 **로컬 자정 Date**를 주므로 로컬 연·월·일 성분을 그대로 읽는 게 정답이다.
 *   서버 TZ가 무엇이든 옳다 — UTC든 KST든 드라이버가 만든 그 자정의 달력일을 되돌려준다.
 */
export function toDayKey(v: any): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

// ============================================================
//  청구 기간 경계 — KST 자정 (★ 2026-07-26 신설)
// ============================================================

/**
 * PG 세션 TZ가 `Etc/UTC`(2026-07-26 `SHOW timezone` 실측)라 `sent_at >= $2::date`로 쓰면
 * 경계가 **UTC 자정 = KST 09:00**이 된다. 그러면 매달 양끝에서 9시간씩 어긋난다 —
 * 7/1 KST 00~09시 발송이 7월 청구에서 빠져 6월로 가고, 8/1 새벽 발송이 7월에 들어온다.
 * 실측(2026-07-26): 7/1 KST 00~09시 완료 직접발송 6건(7월 전체 4,670건 중).
 *
 * 이 결함은 위 `toDayKey` 밀림과 **정확히 서로를 상쇄하고 있었다.** 한쪽만 고치면 상쇄가 깨져
 * 청구서에 기간 밖 날짜(`07-01`이 6월 청구서에)가 인쇄된다. 반드시 세트로 고친다.
 *
 * 스팸필터 조회가 이미 이 형태를 쓰고 있어 그것을 기준으로 통일한다.
 */
const kstStart = (p: string) => `(${p} || ' 00:00:00+09')::timestamptz`;
const kstEnd = (p: string) => `((${p}::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz`;
/** `timestamp without time zone` 컬럼용 — 값이 UTC 벽시계로 저장돼 있으므로 같은 축으로 내린다. */
const kstStartNaive = (p: string) => `(${kstStart(p)} AT TIME ZONE 'UTC')`;
const kstEndNaive = (p: string) => `(${kstEnd(p)} AT TIME ZONE 'UTC')`;

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
/**
 * ★ 2026-07-30 적대검증 2R 수용 — 청구 대상 ID를 **두 집합으로 분리**해서 돌려준다.
 *
 *   · eventIds = cr.id(완료 run) ∪ direct c.id — 한 ID = 한 발송 이벤트라 app_etc1 매칭에 기간 조건이
 *     필요 없다(기존 계약 그대로 — 산식 불변).
 *   · periodCampaignIds = run 기반 캠페인의 campaigns.id — 큐 적재 경로(AI /:id/send·/brand-send)는
 *     app_etc1에 campaigns.id를 기록하므로 cr.id만으로는 그 발송분이 통째로 빠진다(브랜드 F행이 이 축에
 *     얹히며 드러났고, AI SMS도 같은 갭). 단 같은 캠페인이 run_number를 늘리며 **여러 달에 걸쳐 재발송**될
 *     수 있어, 이 집합은 반드시 sendreq_time 기간 조건과 함께 집계해야 한다 — 기간 없이 넣으면 인접 월
 *     발송분이 양쪽 달에 모두 계상된다(2R critical).
 *   direct 캠페인이 구형 경로로 campaign_runs를 함께 만든 경우 periodCampaignIds에서 빼서(이중 계상 차단)
 *   기존 dateless 집계(eventIds)에만 남긴다. mapRunOwners는 두 축을 다 해석한다.
 */
export interface BillingSendIdSets {
  eventIds: string[];
  periodCampaignIds: string[];
}

export async function selectBillingSendIds(opts: {
  companyId: string;
  startDate: string;
  endDate: string;
  userId?: string;
}): Promise<BillingSendIdSets> {
  const { companyId, startDate, endDate, userId } = opts;
  const params: any[] = [companyId, startDate, endDate];
  let userWhereRun = '';
  let userWhereDirect = '';
  if (userId) {
    params.push(userId);
    // ★ 2026-07-25 정정 — 캠페인 생성 경로가 채우는 컬럼은 `created_by`다(user_id는 대부분 비어 있다).
    userWhereRun = ` AND c.created_by = $${params.length}`;
    userWhereDirect = ` AND c2.created_by = $${params.length}`;
  }

  const runsResult = await pool.query(
    `SELECT cr.id AS run_id, c.id AS campaign_id
       FROM campaign_runs cr
       JOIN campaigns c ON c.id = cr.campaign_id
      WHERE c.company_id = $1
        AND cr.sent_at >= ${kstStartNaive('$2')}
        AND cr.sent_at < ${kstEndNaive('$3')}
        AND cr.status = 'completed'${userWhereRun}`,
    params,
  );
  const directResult = await pool.query(
    `SELECT c2.id AS run_id
       FROM campaigns c2
      WHERE c2.company_id = $1
        AND c2.send_type = 'direct'
        AND c2.send_phase = 'sent'
        AND c2.status = 'completed'
        AND COALESCE(c2.scheduled_at, c2.sent_at) >= ${kstStart('$2')}
        AND COALESCE(c2.scheduled_at, c2.sent_at) < ${kstEnd('$3')}${userWhereDirect}`,
    params,
  );

  const eventIds = new Set<string>();
  for (const r of runsResult.rows as any[]) eventIds.add(String(r.run_id));
  for (const r of directResult.rows as any[]) eventIds.add(String(r.run_id));
  const periodCampaignIds = new Set<string>();
  for (const r of runsResult.rows as any[]) {
    const cid = String(r.campaign_id);
    if (!eventIds.has(cid)) periodCampaignIds.add(cid);
  }
  return { eventIds: Array.from(eventIds), periodCampaignIds: Array.from(periodCampaignIds) };
}

/** 두 집합의 총 개수 — "청구 대상 있음" 판정용 */
export function countBillingSendIds(ids: BillingSendIdSets): number {
  return ids.eventIds.length + ids.periodCampaignIds.length;
}

/**
 * (순수) 일자×유형 집계 → 유형별 **성공 건수** 합계. 청구 금액의 수량 축이다.
 * 청구서 발행과 미리보기가 같은 수량을 쓰도록 합산도 한 함수로 묶는다.
 */
/** 청구가 합산하는 유형키 — 여기 없는 키는 수량이 아무리 많아도 0원이 된다. */
const EMPTY_BILLING_TOTALS: Record<string, number> = Object.fromEntries(BILLING_TYPES.map((t) => [t.key, 0]));

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

  // 1) 대상 발송 ID 수집 (이벤트 축 + 기간 한정 캠페인 축 — 2R)
  const billingIds = await selectBillingSendIds({ companyId, startDate, endDate, userId });

  // ★ 2026-07-26 LOG 테이블 목록은 요청당 한 번만 읽는다(information_schema REGEXP는 싸지 않다).
  const logTables = await getBillingLogTables();

  // 2) 일반발송 — 회사 라인그룹 + LOG 테이블 통합
  if (countBillingSendIds(billingIds) > 0) {
    const companyTables = await getBillingCompanyTables(companyId);
    const billingTables = await getTablesForBillingPeriod(companyTables, startDate, endDate, logTables);
    // ★ 2026-07-28 IN 목록을 청크로 — 통짜로 넣으면 옵티마이저가 인덱스를 버린다(위 헬퍼 주석).
    const rows = await aggregateBillingSendIds(billingTables, billingIds, smsAggByDateType, startDate, endDate);
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
    const testTables = await getTablesForBillingPeriod(testBaseTables, startDate, endDate, logTables);
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

  // (2026-07-30 재구축) 옛 5)·6) 브랜드메시지 IMC arm 폐기 —
  //   브랜드는 SMSQ에 msg_type='F'로 적재되어 위 2) 일반발송 집계가 담당한다.
  //   유형키 변환(F→BRAND)은 MSG_TYPE_TO_USAGE_KEY(billing-types 표 smsqCode 파생)가 맡는다.
  //   알림톡(K→KAKAO)과 완전히 같은 구조 — 채널별 전용 arm이 더는 없다.

  return dayData;
}

/** 발송통계 엑셀 웹 행용 — 청구 유형키를 사용자 표시명으로 (표시명 원천 = BILLING_TYPES.label) */
export const USAGE_TYPE_LABEL: Record<string, string> = Object.fromEntries(BILLING_TYPES.map((t) => [t.key, t.label]));

/** 유형 표시 순서 — 청구서 항목 순서와 동일 */
const USAGE_TYPE_ORDER = BILLING_TYPES.map((t) => t.key);

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

// ============================================================
//  청구용 통합 집계 (★ 2026-07-26 신설 — 정산 재구성 ①)
// ============================================================

/**
 * Harold 정의 청구서(2026-07-25)는 채널이 나뉜 항목별 청구서다:
 *   ② 한줄로 웹 = 일자 × 계정 × 유형 / ③ 에이전트 = 일자 × 발송ID × 유형 / ④ 테스트 = 일자 × 계정 × 유형
 *
 * 그런데 기존 청구 집계(`buildCompanyUsageByDay`)는 **일자 × 유형**뿐이라 계정도 발송ID도 없고,
 * 무엇보다 **에이전트(`sales.RSRM_SalesStts`)를 아예 읽지 않는다.**
 * 그 결과 `usage_type='both'` 회사 17곳(베네통·아난티·마리오아울렛 등)의 게이트웨이 발송분이
 * 청구서에서 통째로 빠져 있었다. MMS 308,043건 0원 청구와 같은 계열인데 채널 하나가 통째로 빠진 것.
 *
 * 기존 함수는 발송통계 화면·엑셀이 쓰고 있고 0725에 축을 맞춰놨으므로 **건드리지 않는다.**
 * 대신 이 함수가 청구 축을 그대로 내고, 발행 직전에 두 결과를 대조한다(`diffBillingRowsVsDayData`).
 * 화면·엑셀·청구서가 갈라지지 않는다는 걸 사람 눈이 아니라 기계가 보증하게 하려는 것이다.
 *
 * ★ 대상ID(StoreId)는 청구서 축이 아니다(Harold 지시 2026-07-26 — "하루씩 묶어서, 건바이건은 통계에서").
 *   게이트웨이 입력값이라 계정마다 의미가 갈린다: 아난티(D0018)는 22개짜리 지점 코드인데
 *   제이씨패밀리(B0229)는 7월 한 달에 29,598개 — 사실상 발송 건 식별자다(행 30,314개와 거의 1:1).
 *   우리가 카디널리티를 통제할 수 없는 값을 청구 축으로 삼으면 청구서가 3만 줄이 된다.
 *   지점별 확인은 기존 발송통계 엑셀(`queryPayAgentStoreBreakdown` 대상ID 분해)이 이미 담당한다.
 */
/** `plan`은 발송이 아니라 구독료다 — 수량 축이 없고 금액이 일할로 미리 정해져 온다. */
// ★ 2026-07-30 'extra' = 월별 추가 항목(080 이용료·부가서비스·통화료 — billing_extra_items). 발송 축이 아니다.
export type BillingChannel = 'plan' | 'web' | 'agent' | 'test' | 'spam' | 'extra';

/** 청구 상세 한 줄 = `billing_items` 한 행 */
export interface BillingUsageRow {
  channel: BillingChannel;
  /** YYYY-MM-DD */
  itemDate: string;
  /** 유형키. 청구 단가가 붙는 키(SMS·LMS·MMS·KAKAO·TEST_SMS·TEST_LMS·SPAM_SMS·SPAM_LMS)가 아니면 미청구로 드러난다 */
  typeKey: string;
  /** web·test·spam 계정. 없으면 null(계정 미상) */
  userId: string | null;
  /** agent 발송ID(= RSRM_SalesStts.CustId). 그 외 채널은 null */
  agentSendId: string | null;
  total: number;
  success: number;
  fail: number;
  pending: number;
}

export interface BillingUsageResult {
  rows: BillingUsageRow[];
  /** 청구 단가가 정의되지 않은 유형키 — 조용한 0원 청구를 막기 위해 발행 전에 드러낸다 */
  unbillable: UnbillableUsageKey[];
  /** 선불 발송ID라 청구에서 뺀 분 — 게이트웨이 잔액에서 이미 빠졌으므로 청구하면 이중 청구다 */
  excludedPrepaidSendIds: string[];
  /** `usage_type`이 agent·both인데 발송ID 매핑이 0행 — 게이트웨이 발송분이 통째로 빠지는 신호 */
  agentMappingMissing: boolean;
}

/**
 * 에이전트 MsgType → 청구 유형키.
 * 여기 없는 코드는 **원본 코드를 그대로 유형키로 쓴다.** 임의로 뭉치면 그 유형이 조용히 0원이 된다 —
 * 2026-07-26 실측에서 `G`(여미지 B0227, 7월 성공 42,833건)가 그 자리에 있었다.
 * 원본으로 남겨야 `findUnbillableUsageKeys`가 발행 시점에 집어낸다.
 */
export const AGENT_MSG_TYPE_TO_USAGE_KEY: Record<string, string> = Object.fromEntries(
  BILLING_TYPES.filter((t) => t.agentCode).map((t) => [t.agentCode as string, t.key]),
);

export function agentUsageKey(msgType: any): string {
  const k = String(msgType || '').trim().toUpperCase();
  if (!k) return '(유형 미상)';
  return AGENT_MSG_TYPE_TO_USAGE_KEY[k] || k;
}

/**
 * (순수) 청구 상세 행의 그룹 키.
 *
 * ★ 2026-07-26 문자열 연결(`채널|일자|계정|유형`)에서 교체.
 *   `typeKey`는 매핑에 없는 게이트웨이 `MsgType`을 원본 그대로 쓰고(`agentUsageKey`),
 *   `agentSendId`도 외부 입력이라 `|`가 안 들어온다는 보장이 없다.
 *   `sendId='A' + type='B|C'`와 `sendId='A|B' + type='C'`가 같은 키가 되면
 *   서로 다른 유형이 한 행으로 합쳐지고 그 행에 한쪽 단가만 붙는다.
 *
 *   키를 행에서 직접 만들게 해서 **키와 행 내용이 갈라질 수 없게** 한다 —
 *   그 전에는 같은 정보를 키 문자열과 seed에 두 번 썼고, 실제로 에이전트 키만 채널 접두가 빠져 있었다.
 */
export function billingRowKey(r: BillingUsageRow): string {
  return JSON.stringify([r.channel, r.itemDate, r.userId ?? '', r.agentSendId ?? '', r.typeKey]);
}

function bumpRow(acc: Map<string, BillingUsageRow>, seed: BillingUsageRow, c: { total?: any; success?: any; fail?: any; pending?: any }): void {
  const key = billingRowKey(seed);
  if (!acc.has(key)) acc.set(key, seed);
  const b = acc.get(key)!;
  b.total += Number(c.total || 0);
  b.success += Number(c.success || 0);
  b.fail += Number(c.fail || 0);
  b.pending += Number(c.pending || 0);
}

/** 청구 상세 정렬 — 채널 → 일자 → 계정/발송ID → 유형. PDF·화면이 이 순서를 그대로 쓴다. */
// 요금제가 청구서 항목 1번이다(Harold 정의) — 정렬 맨 앞.
const CHANNEL_ORDER: BillingChannel[] = ['plan', 'web', 'agent', 'test', 'spam', 'extra'];
const TYPE_ORDER_FOR_BILLING = BILLING_TYPES.map((t) => t.key);

export function sortBillingUsageRows(rows: BillingUsageRow[]): BillingUsageRow[] {
  const ch = (c: BillingChannel) => CHANNEL_ORDER.indexOf(c);
  const ty = (t: string) => {
    const i = TYPE_ORDER_FOR_BILLING.indexOf(t);
    return i === -1 ? 99 : i;
  };
  return [...rows].sort((a, b) => {
    if (a.channel !== b.channel) return ch(a.channel) - ch(b.channel);
    if (a.itemDate !== b.itemDate) return a.itemDate.localeCompare(b.itemDate);
    const ka = a.agentSendId || a.userId || '';
    const kb = b.agentSendId || b.userId || '';
    if (ka !== kb) return ka.localeCompare(kb);
    const o = ty(a.typeKey) - ty(b.typeKey);
    return o !== 0 ? o : a.typeKey.localeCompare(b.typeKey);
  });
}

/**
 * (순수) 대상ID 그레인 에이전트 행 → 청구 그레인(일자 × 발송ID × 유형)으로 롤업.
 *
 * `allowedSendIds`(후불 발송ID 집합, 대문자)에 없는 발송ID는 제외하고 목록으로 돌려준다.
 * 발송ID별 `billing_type`은 회사 후불·선불과 **완전히 독립**이라(2026-07-24 ALTER),
 * 회사가 후불이어도 선불 발송ID가 섞여 있으면 그건 게이트웨이 잔액에서 이미 빠진 돈이다.
 */
export function rollupAgentRowsForBilling(
  storeRows: PayAgentStoreRow[],
  allowedSendIds: Set<string>,
): { rows: BillingUsageRow[]; excludedSendIds: string[] } {
  const acc = new Map<string, BillingUsageRow>();
  const excluded = new Set<string>();
  for (const r of storeRows || []) {
    const sendId = String(r?.agent_send_id || '').trim();
    if (!sendId) continue;
    if (!allowedSendIds.has(sendId.toUpperCase())) { excluded.add(sendId); continue; }
    const day = String(r?.period || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue; // 월별 그레인·깨진 일자는 청구에 넣지 않는다
    const typeKey = agentUsageKey(r.msg_type);
    bumpRow(acc, {
      channel: 'agent', itemDate: day, typeKey, userId: null, agentSendId: sendId,
      total: 0, success: 0, fail: 0, pending: 0,
    }, { total: r.sent, success: r.success, fail: r.fail, pending: r.pending });
  }
  return { rows: sortBillingUsageRows(Array.from(acc.values())), excludedSendIds: Array.from(excluded).sort() };
}

/** (순수) 청구 상세 행 중 단가가 정의되지 않은 유형키 — `findUnbillableUsageKeys`의 행 버전 */
export function findUnbillableBillingRows(rows: BillingUsageRow[]): UnbillableUsageKey[] {
  const acc = new Map<string, UnbillableUsageKey>();
  for (const r of rows || []) {
    if (r.typeKey in EMPTY_BILLING_TOTALS) continue;
    if (!acc.has(r.typeKey)) acc.set(r.typeKey, { key: r.typeKey, success: 0, total: 0 });
    const a = acc.get(r.typeKey)!;
    a.success += Number(r.success) || 0;
    a.total += Number(r.total) || 0;
  }
  return Array.from(acc.values()).sort((a, b) => b.success - a.success || a.key.localeCompare(b.key));
}

/**
 * (순수) 회사 단가가 미설정이라 0원으로 청구될 유형키 — **성공 수량이 있는 것만**. (★ 2026-07-26 신설)
 *
 * 에이전트 쪽 `missingAgentPrices`와 정확히 같은 규칙이다: 수량이 0인 유형까지 막으면
 * 발행이 이유 없이 멈춘다. 실측(2026-07-26)상 단가가 비어 있는 후불 회사 65곳은 전부
 * 에이전트 전용이라 웹 발송이 0이고, `both` 13곳·`web` 25곳은 단가 NULL이 한 곳도 없다 —
 * 즉 이 게이트를 켜도 지금 막히는 회사는 없고, 앞으로의 회귀만 막는다.
 */
export function findUnsetPricedTypes(unsetKeys: string[], rows: BillingUsageRow[]): UnbillableUsageKey[] {
  const unset = new Set(unsetKeys || []);
  const acc = new Map<string, UnbillableUsageKey>();
  for (const r of rows || []) {
    if (r.channel === 'agent') continue;           // 에이전트는 발송ID별 단가라 축이 다르다
    if (!unset.has(r.typeKey)) continue;
    if ((Number(r.success) || 0) <= 0) continue;
    if (!acc.has(r.typeKey)) acc.set(r.typeKey, { key: r.typeKey, success: 0, total: 0 });
    const a = acc.get(r.typeKey)!;
    a.success += Number(r.success) || 0;
    a.total += Number(r.total) || 0;
  }
  return Array.from(acc.values()).sort((a, b) => b.success - a.success || a.key.localeCompare(b.key));
}

/**
 * (순수) 차단 사유 목록을 사람이 읽을 한 줄로 — 상위 N건만. (★ 2026-07-26 신설)
 *
 * 관리자 화면 토스트는 한 줄짜리이고 3초 뒤 사라진다. 발송ID 283개를 그대로 이어붙이면
 * 화면을 뚫고 지나가 운영자가 아무것도 못 읽는다. 전체 목록은 응답 배열에 그대로 실려 있다.
 */
export function summarizeBlockList(items: string[], head = 5): string {
  const list = (items || []).filter(Boolean);
  if (list.length <= head) return list.join(', ');
  return `${list.slice(0, head).join(', ')} 외 ${list.length - head}건`;
}

export interface BillingUsageDiff { typeKey: string; rowsSuccess: number; dayDataSuccess: number }

/**
 * (순수) 새 청구 상세(web·test·spam)와 기존 집계(`buildCompanyUsageByDay`)를 유형별 성공 수량으로 대조.
 *
 * 두 경로가 갈라지면 화면·엑셀 숫자와 청구서 금액이 어긋난다. 0725에 축을 맞춘 걸
 * 이번 재구성이 조용히 되돌리는 것을 막는 유일한 기계적 장치다 — 어긋나면 발행을 막는다.
 * 에이전트는 기존 집계에 없는 채널이라 대조 대상이 아니다.
 */
export function diffBillingRowsVsDayData(rows: BillingUsageRow[], dayData: UsageDayData): BillingUsageDiff[] {
  const fromRows = new Map<string, number>();
  for (const r of rows || []) {
    if (r.channel === 'agent') continue;
    fromRows.set(r.typeKey, (fromRows.get(r.typeKey) || 0) + (Number(r.success) || 0));
  }
  const fromDay = new Map<string, number>();
  Object.values(dayData || {}).forEach((types) => {
    Object.entries(types || {}).forEach(([key, c]) => {
      fromDay.set(key, (fromDay.get(key) || 0) + (Number(c?.success) || 0));
    });
  });
  const keys = Array.from(new Set([...fromRows.keys(), ...fromDay.keys()])).sort();
  const diffs: BillingUsageDiff[] = [];
  for (const key of keys) {
    const a = fromRows.get(key) || 0;
    const b = fromDay.get(key) || 0;
    if (a !== b) diffs.push({ typeKey: key, rowsSuccess: a, dayDataSuccess: b });
  }
  return diffs;
}

// ============================================================
//  청구 상세 단가 부착 (★ 2026-07-26 — 정산 재구성 ②)
// ============================================================

/** `company_agent_ids` 단가 행 — 발송ID별 단가는 회사 단가와 별개 축이다(2026-07-24 ALTER) */
// AgentUnitPriceRow는 축 정의와 한 몸이라 billing-types.ts로 옮겼다(위에서 re-export).

/** `billing_items` 한 행 — 청구 상세에 단가·금액과 FK가 붙은 상태 */
export interface PricedBillingItem extends BillingUsageRow {
  /** `company_agent_ids.id` (agent 채널만) */
  agentId: string | null;
  unitPrice: number;
  /**
   * 청구 금액 = `성공 × 단가` **정확값(소수 유지)**. `billing_items.amount`에 이 값이 저장된다.
   * ★ 2026-07-30 절사 위치 정정(Harold) — 행 단위 절사는 0726 지시("최종 금액의 소수점만 버려라")의
   * 과대 해석이었다. 절사는 `buildInvoiceLines` 항목줄에서 1회만 한다. 발송 행은 amount === amountExact.
   * (요금제 행만 구간이 곧 항목줄이라 `buildPlanBillingItems`에서 구간 단위 절사값이 실린다.)
   */
  amount: number;
  /**
   * `성공 × 단가` 원값. 헤더 공급가액을 상세와 **다른 코드**로 계산해 대조하는 A-8 항등식이
   * 절사 축과 얽히지 않도록, 대조는 항상 이 값으로 한다.
   */
  amountExact: number;
  /**
   * 요금제 행 전용 — 일할 구간 일수 / 그 달 일수(`billing_items.plan_days`·`plan_month_days`).
   * 발송 행은 null이다. 발송 수량 컬럼(`total_count`·`fail_count`)에 이 값을 실으면
   * PDF 2페이지 '전송'·'실패' 열과 상세 모달 합계가 오염된다(★ 2026-07-26 Codex 3차 HIGH).
   */
  planDays: number | null;
  planMonthDays: number | null;
}

/**
 * (순수) 요금제 구간 → 청구 상세 행. (★ 2026-07-26 — 정산 재구성 ④)
 *
 * 요금제는 발송이 아니라 구독료다. 수량 축이 없고 금액이 **일할로 이미 정해져** 온다.
 * 그래서 `priceBillingRows`(성공 × 단가)를 태우지 않는다 — 태우면 수량이 0이라 금액이 0원이 된다.
 *
 * `message_type`에 플랜 코드를 함께 담는다(`PLAN_BASIC` 등, varchar(20) 안에 들어간다).
 * 청구서에 "어느 요금제 몇 일치"가 보여야 고객이 일할 금액을 검산할 수 있다.
 *
 * ★ 2026-07-26 일수를 **전용 컬럼**(`plan_days`·`plan_month_days`)으로 옮겼다(Codex 3차 HIGH).
 *   그 전에는 구간 일수를 `total_count`에, 그 달 일수를 `fail_count`에 실었다.
 *   같은 컬럼이 채널에 따라 다른 뜻이 되면서 PDF 2페이지 '전송'·'실패' 열과
 *   상세 모달 합계(`detailItems.reduce`)에 9·31이 발송 건수처럼 더해졌다 — D132 계열이다.
 *   발송 수량 4칸은 전부 0으로 둔다. 요금제는 발송이 아니다.
 */
export function buildPlanBillingItems(segments: PlanSegment[]): PricedBillingItem[] {
  return (segments || []).map((s) => ({
    channel: 'plan' as const,
    itemDate: s.from,
    typeKey: `PLAN_${String(s.planCode || '').slice(0, 15)}`,
    userId: null,
    agentSendId: null,
    agentId: null,
    total: 0, success: 0, fail: 0, pending: 0,
    planDays: Number(s.days) || 0,
    planMonthDays: Number(s.monthDays) || 0,
    unitPrice: Number(s.monthlyPrice) || 0,
    // ★ 2026-07-26 일할 금액도 원 미만 절사(350,000 × 9/31 = 101,612.90…). 발송 행과 같은 규칙이어야
    //   장 소계·공급가액이 정수 덧셈으로 성립한다.
    amount: floorWon(Number(s.amount) || 0),
    amountExact: Number(s.amount) || 0,
  }));
}

/**
 * (순수) 월별 추가 항목(billing_extra_items — 080 이용료·부가서비스·통화료) → 청구 상세 행. (★ 2026-07-30 신설)
 *
 * 요금제(buildPlanBillingItems)와 같은 부류다 — 발송이 아니라서 수량 4칸은 전부 0으로 둔다
 * (수량 칸에 실으면 PDF 2페이지 전송·실패 열이 오염된다 — 2026-07-26 Codex 3차 HIGH와 같은 함정).
 * 항목줄 수량 표시는 buildInvoiceLines가 extra 채널 전용으로 합친 행 수를 세어 담당한다.
 * 금액은 공급가 정수라 amount === amountExact(절사 멱등).
 */
export function buildExtraBillingItems(rows: Array<{ kind: string; supply_amount: any; period_month: any }>): PricedBillingItem[] {
  const KIND_TO_TYPE: Record<string, string> = {
    '080_fee': 'EXTRA_080_FEE',
    '080_svc': 'EXTRA_080_SVC',
    '080_call': 'EXTRA_080_CALL',
  };
  return (rows || []).map((r) => {
    const amount = Math.round(Number(r.supply_amount) || 0);
    return {
      channel: 'extra' as const,
      itemDate: toDayKey(r.period_month),
      typeKey: KIND_TO_TYPE[String(r.kind)] || `EXTRA_${String(r.kind || '').toUpperCase().slice(0, 13)}`,
      userId: null,
      agentSendId: null,
      agentId: null,
      total: 0, success: 0, fail: 0, pending: 0,
      planDays: null,
      planMonthDays: null,
      unitPrice: amount,
      amount,
      amountExact: amount,
    };
  });
}

export interface AgentPriceMiss { agentSendId: string; typeKey: string; success: number }

export interface PricedBillingResult {
  items: PricedBillingItem[];
  /** 채널별 공급가 소계(원 단위 절사 후) — 청구서 1페이지 항목이 이 값이다 */
  amountByChannel: Record<BillingChannel, number>;
  /** 채널별 소계의 **절사 전** 값 — 헤더 공급가액 교차검증(A-8) 전용. 저장·표시에 쓰지 않는다. */
  amountExactByChannel: Record<BillingChannel, number>;
  /** 단가가 비어 있는 (발송ID × 유형) — 채우기 전에는 발행을 막는다 */
  missingAgentPrices: AgentPriceMiss[];
  /** 청구 단가 자체가 정의되지 않은 유형키(성공 수량이 있는 것만) */
  unbillableTypes: UnbillableUsageKey[];
}

// 단언 캐스팅을 쓰지 않는다 — 캐스팅이 있으면 표의 오타를 tsc가 못 본다(Codex 적대검증 수용).
const AGENT_PRICE_COLUMN: Record<string, AgentPriceColumn> = Object.fromEntries(
  BILLING_TYPES.flatMap((t) => (t.agentPriceColumn ? [[t.key, t.agentPriceColumn] as const] : [])),
);

/**
 * (순수) 청구 상세 행에 단가·금액을 붙인다.
 *
 * ★ 에이전트 단가는 **회사 단가가 아니라 발송ID별 단가**(`company_agent_ids.cost_per_*`)다.
 *   2026-07-26 실측: 283개 발송ID 전부 미설정(NULL)이다. 운영에서 채우는 값이므로,
 *   비어 있으면 **0원으로 계산하지 않고 어느 발송ID·유형이 비었는지를 돌려준다.**
 *   0원 폴백은 청구서를 조용히 축소시킨다 — MMS 308,043건 0원 청구가 정확히 그 사고였다.
 *   0원을 명시적으로 설정한 경우(`0`)는 0원 그대로 쓴다. 미설정(NULL·빈값)만 막는다.
 *
 * ★ 단가 정의가 없는 유형키(에이전트 `G` 등)는 성공 수량이 있을 때만 막는다.
 *   수량 0인 유형까지 막으면 발행이 이유 없이 멈춘다.
 */
export function priceBillingRows(
  rows: BillingUsageRow[],
  webPrices: Record<string, number>,
  agentPriceRows: AgentUnitPriceRow[],
  // ★ 2026-07-26 발송ID 단가도 회사의 부가세 기준을 따른다. 같은 회사의 단가 입력 기준이 두 개일 수 없다.
  //   (`webPrices`는 `resolveBillingUnitPricesDetailed`가 이미 공급가로 바꿔 넘겨준다.)
  //   기본값은 전환 전 — 인자를 빠뜨린 호출부가 조용히 ÷1.1을 하는 쪽으로 기울지 않게 한다.
  agentPriceBasis: UnitPriceBasis = 'vat_included',
): PricedBillingResult {
  const bySendId = new Map<string, AgentUnitPriceRow>();
  for (const p of agentPriceRows || []) {
    const key = String(p?.agent_send_id || '').trim().toUpperCase();
    if (key) bySendId.set(key, p);
  }

  const items: PricedBillingItem[] = [];
  const amountByChannel: Record<BillingChannel, number> = { plan: 0, web: 0, agent: 0, test: 0, spam: 0, extra: 0 };
  const amountExactByChannel: Record<BillingChannel, number> = { plan: 0, web: 0, agent: 0, test: 0, spam: 0, extra: 0 };
  const missMap = new Map<string, AgentPriceMiss>();

  for (const r of rows || []) {
    const success = Number(r.success) || 0;
    let unitPrice = 0;
    let agentId: string | null = null;

    if (r.channel === 'agent') {
      const p = bySendId.get(String(r.agentSendId || '').trim().toUpperCase());
      agentId = p ? String(p.id) : null;
      const col = AGENT_PRICE_COLUMN[r.typeKey];
      const raw = col && p ? (p as any)[col] : null;
      const resolved = toSupplyPrice(priceOrNull(raw), agentPriceBasis);
      if (resolved === null) {
        // 단가를 못 정한다. 0원으로 밀어넣지 않고 어디가 비었는지 남긴다.
        if (success > 0) {
          const k = `${r.agentSendId || ''}|${r.typeKey}`;
          if (!missMap.has(k)) missMap.set(k, { agentSendId: String(r.agentSendId || ''), typeKey: r.typeKey, success: 0 });
          missMap.get(k)!.success += success;
        }
      } else {
        unitPrice = resolved;
      }
    } else {
      unitPrice = Number(webPrices?.[r.typeKey]) || 0;
    }

    // ★ 2026-07-30 절사 위치 정정(Harold — 0726 지시의 원뜻은 "최종 청구 금액의 소수점만 버려라").
    //   행(일자) 단위 절사는 그 지시의 과대 해석이었다 — 절사가 일자 수만큼 누적돼 항목표가
    //   `수량 × 단가`와 수십 원씩 어긋났고(서수란 0729 접수: 1,733×7.2 = 12,477.6 → 12,456 표시),
    //   고객이 검산할 때마다 걸린다. 일자 행은 **정확값(소수 유지)** 그대로 두고,
    //   절사는 `buildInvoiceLines`의 **항목줄에서 1회**만 한다(같은 단가 그룹은 Σ(일자×단가)=총수량×단가라
    //   항목줄 절사값이 정확히 floor(수량×단가)가 된다). 헤더 공급가액은 그 절사된 항목줄들의 정수 합.
    const amountExact = success * unitPrice;
    const amount = amountExact;
    amountByChannel[r.channel] += amount;
    amountExactByChannel[r.channel] += amountExact;
    // 발송 행은 요금제 일수 축이 없다 — null이 그 사실이다(0은 "0일"과 구분이 안 된다).
    items.push({ ...r, agentId, unitPrice, amount, amountExact, planDays: null, planMonthDays: null });
  }

  const unbillableTypes = findUnbillableBillingRows(items.filter((i) => (Number(i.success) || 0) > 0));

  return {
    items,
    amountByChannel,
    amountExactByChannel,
    missingAgentPrices: Array.from(missMap.values()).sort(
      (a, b) => b.success - a.success || a.agentSendId.localeCompare(b.agentSendId) || a.typeKey.localeCompare(b.typeKey),
    ),
    unbillableTypes,
  };
}

// ※ 옛 `getPostpaidAgentSendIds`는 삭제했다(2026-07-26).
//   같은 원장을 여기서 한 번, 라우트에서 한 번 따로 읽어 그 사이 값이 바뀌면 조용히 어긋났다.
//   이제 `utils/billing-ledger.ts`가 한 스냅샷으로 읽고 발행 트랜잭션 안에서 지문을 재확인한다.

// ============================================================
//  계정 실재 확인 (★ 2026-07-26 — 정산 재구성 A-7)
// ============================================================

/**
 * 상세 행이 가리키는 계정 중 **실제로 남아 있는** 것만 돌려준다.
 *
 * `billing_items.user_id`는 `users` FK인데, 사용자 삭제가 soft가 아니라 **하드 삭제**다
 * (`admin.ts`·`manage-users.ts`의 `DELETE FROM users`). 퇴사자 계정을 지우면 그 사람이 그 달에 한
 * 발송의 계정 uuid가 MySQL 큐·`campaigns.created_by`에는 그대로 남아 있어,
 * INSERT에서 FK 위반(23503)이 나고 **그 회사 청구서를 통째로 못 뽑는다.**
 * 월 정산은 지난 달을 뽑는데 그 사이 퇴사 처리가 일어나는 건 드문 일이 아니다.
 *
 * 이 결함은 축을 계정별로 쪼갠 이번 변경이 **처음 만들어낸 것**이다 —
 * 그 전에는 `user_id`가 헤더값 복사라 항상 유효했다.
 */
export async function resolveExistingUserIds(companyId: string, userIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (ids.length === 0) return new Set();
  const res = await pool.query(
    `SELECT id FROM users WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  return new Set((res.rows as any[]).map((r) => String(r.id)));
}

/**
 * (순수) 남아 있지 않은 계정을 `null`로 내린다. **차단하지 않는다.**
 * 청구서 전체를 못 뽑는 것보다 계정 하나가 미상인 편이 낫다 — 수량·금액은 그대로 청구된다.
 * 계정은 표시 축이지 금액 축이 아니다(웹 단가는 회사 단가라 계정과 무관).
 */
export function nullifyUnknownUserIds<T extends { userId: string | null }>(
  items: T[],
  existing: Set<string>,
): { items: T[]; unknownUserIds: string[] } {
  const unknown = new Set<string>();
  const out = (items || []).map((it) => {
    const uid = it.userId;
    if (!uid || existing.has(uid)) return it;
    unknown.add(uid);
    return { ...it, userId: null };
  });
  return { items: out, unknownUserIds: Array.from(unknown).sort() };
}

// ============================================================
//  발행 단위(scope) 장 분할 (★ 2026-07-26 — 정산 재구성 A-0)
// ============================================================

export type BillingScope = 'combined' | 'by_user';

/** 청구서 한 장 */
export interface BillingSheet {
  /** `combined`(회사 1장) / `by_user`(계정 장) / `common`(공통 장) */
  sheetScope: 'combined' | 'by_user' | 'common';
  /** 계정 장이면 그 계정. 공통·합산 장은 null */
  userId: string | null;
  items: PricedBillingItem[];
  /** 유형키별 성공 수량 — `billings` 헤더 컬럼에 그대로 들어간다 */
  totals: Record<string, number>;
  /** 이 장의 공급가 소계(AI 크레딧 제외) */
  amount: number;
  /** 회사 단위 항목(AI 크레딧·요금제)을 싣는 장인가 — 묶음에 하나뿐이다 */
  carriesCompanyItems: boolean;
}

function sheetTotals(items: PricedBillingItem[]): Record<string, number> {
  const t: Record<string, number> = { ...EMPTY_BILLING_TOTALS };
  for (const i of items) if (i.typeKey in t) t[i.typeKey] += Number(i.success) || 0;
  return t;
}

/**
 * (순수) 청구 상세를 발행 단위대로 장으로 나눈다.
 *
 * **회사 단위 항목은 공통 장 하나에 모은다**(Harold 결정 2026-07-26 "고객사 관리자 = 본사").
 * 테스트·스팸필터·AI 크레딧·에이전트 발송분·계정 미상 발송분이 여기 들어간다.
 *
 * 대표 장에 몰거나 계정별로 안분하지 않는 이유:
 * - **대표를 정할 규칙이 없다.** 계정이 추가·삭제되면 대표가 바뀌어 같은 항목이 달마다 다른 사람 청구서에 붙는다.
 * - **안분 기준이 사실이 아니다.** AI 크레딧 충전은 회사 행위라 계정으로 나눌 근거가 없다.
 *   기준을 만드는 순간 그건 우리가 만든 숫자이고 분쟁 시 근거를 못 댄다.
 *   게다가 VAT가 장마다 반올림돼 합계가 장 수의 절반만큼 어긋난다.
 * - 별도 장으로 빼면 `Σ(계정 장) + 공통 장 === 합산 1장`이 **정수 덧셈으로 정확히** 성립한다.
 *
 * ★ 에이전트 발송분은 계정 축이 없어 공통 장으로 간다. 웹 발송은 본사가 보내는 것이라
 *   지점·계정에 섞지 않는다는 Harold 확정과 같은 원칙이다.
 */
export function splitBillingSheets(items: PricedBillingItem[], scope: BillingScope): BillingSheet[] {
  const all = items || [];
  if (scope === 'combined') {
    return [{
      sheetScope: 'combined', userId: null, items: all,
      totals: sheetTotals(all),
      amount: all.reduce((s, i) => s + (Number(i.amount) || 0), 0),
      carriesCompanyItems: true,
    }];
  }

  const byUser = new Map<string, PricedBillingItem[]>();
  const common: PricedBillingItem[] = [];
  for (const it of all) {
    // 계정 축이 있는 것만 계정 장으로. 에이전트·테스트·스팸과 계정 미상 웹 발송은 공통 장.
    if (it.channel === 'web' && it.userId) {
      if (!byUser.has(it.userId)) byUser.set(it.userId, []);
      byUser.get(it.userId)!.push(it);
    } else {
      common.push(it);
    }
  }

  const sheets: BillingSheet[] = Array.from(byUser.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([userId, list]) => ({
      sheetScope: 'by_user' as const, userId, items: list,
      totals: sheetTotals(list),
      amount: list.reduce((s, i) => s + (Number(i.amount) || 0), 0),
      carriesCompanyItems: false,
    }));

  sheets.push({
    sheetScope: 'common', userId: null, items: common,
    totals: sheetTotals(common),
    amount: common.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    carriesCompanyItems: true,
  });
  return sheets;
}

/**
 * (순수) 묶음 합계 불변식 — `Σ(장별 공급가) + AI 크레딧 === 합산 공급가`.
 *
 * VAT에는 걸지 않는다. 장마다 `Math.round(subtotal × 0.1)`가 일어나 장 수의 절반만큼 어긋나므로,
 * VAT까지 묶으면 정상 발행이 반올림 때문에 막힌다.
 */
export function checkSheetSumIdentity(sheets: BillingSheet[], aiCreditSupply: number, combinedSubtotal: number): BillingAmountCheck {
  const itemsSum = (sheets || []).reduce((s, sh) => s + (Number(sh.amount) || 0), 0);
  return checkBillingAmountIdentity([{ amount: itemsSum }], aiCreditSupply, combinedSubtotal);
}

// ============================================================
//  금액 항등식 (★ 2026-07-26 — 정산 재구성 A-8)
// ============================================================

export interface BillingAmountCheck {
  ok: boolean;
  itemsSum: number;
  aiCreditSupply: number;
  subtotal: number;
  diff: number;
}

/**
 * (순수) 상세 행 합 + AI 크레딧 = 공급가액.
 *
 * 헤더 `subtotal`은 `totals × 단가`로, 상세는 `priceBillingRows`로 **서로 다른 코드가 계산한다.**
 * 그래서 축이 어긋나면 청구서 1페이지 항목 합계와 공급가액이 안 맞는다 —
 * 에이전트 금액이 subtotal에만 들어가고 항목표에는 없던 것이 정확히 그 증상이었다.
 *
 * AI 크레딧은 `billing_items`에 행이 없으므로(충전은 발송이 아니다) 따로 더한다.
 * 반올림은 VAT 한 곳뿐이고 여기는 정수 덧셈이라 **오차 허용 없이** 같아야 한다.
 */
export function checkBillingAmountIdentity(
  items: Array<{ amount: number }>,
  aiCreditSupply: number,
  subtotal: number,
): BillingAmountCheck {
  const itemsSum = (items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const credit = Number(aiCreditSupply) || 0;
  const sub = Number(subtotal) || 0;
  const diff = itemsSum + credit - sub;
  return { ok: Math.abs(diff) < 0.005, itemsSum, aiCreditSupply: credit, subtotal: sub, diff };
}

/** (순수) 배열을 고정 크기로 나눈다 — PG 바인드 파라미터 상한(65,535) 회피용. */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 청구 대상 발송(run) → 그 발송을 만든 계정. `selectBillingRunIds` 집합에서만 뽑으므로 두 경로가 갈릴 수 없다. */
async function mapRunOwners(runIds: string[]): Promise<Map<string, string | null>> {
  const m = new Map<string, string | null>();
  if (runIds.length === 0) return m;
  const res = await pool.query(
    `SELECT cr.id AS run_id, c.created_by
       FROM campaign_runs cr JOIN campaigns c ON c.id = cr.campaign_id
      WHERE cr.id = ANY($1::uuid[])
      UNION
     SELECT c2.id AS run_id, c2.created_by
       FROM campaigns c2
      WHERE c2.id = ANY($1::uuid[])`,
    [runIds],
  );
  for (const r of res.rows as any[]) {
    m.set(String(r.run_id), r.created_by ? String(r.created_by) : null);
  }
  return m;
}

/**
 * 회사의 청구 상세를 **채널 × 일자 × (계정 | 발송ID) × 유형**으로 낸다. `/generate`가 그대로 저장한다.
 *
 * @param userId 지정 시 그 사용자 발송분만. 테스트·스팸·에이전트·크레딧은 회사 단위 항목이라 제외된다
 *               (기존 청구서 동작 그대로 — 사용자별로 나눌 근거가 없다).
 */
export async function buildBillingUsageRows(opts: {
  companyId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  userId?: string;
  /** 발행 경로가 넘기는 단가·선불여부 스냅샷. 미전달 시 자체 1회 로드(미리보기·단독 호출 하위호환). */
  ledger?: BillingLedger;
}): Promise<BillingUsageResult> {
  const { companyId, startDate, endDate, userId } = opts;
  const acc = new Map<string, BillingUsageRow>();
  let excludedPrepaidSendIds: string[] = [];
  let agentMappingMissing = false;
  // ★ 2026-07-26 LOG 테이블 목록은 요청당 한 번만 읽는다(발송·테스트 두 곳이 공유).
  const logTables = await getBillingLogTables();

  // 1) 웹 일반발송 — 일자 × 계정 × 유형 (이벤트 축 + 기간 한정 캠페인 축 — 일자축과 같은 분리 규칙, 2R)
  const billingIds = await selectBillingSendIds({ companyId, startDate, endDate, userId });
  if (countBillingSendIds(billingIds) > 0) {
    const owners = await mapRunOwners([...billingIds.eventIds, ...billingIds.periodCampaignIds]);
    const companyTables = await getBillingCompanyTables(companyId);
    const billingTables = await getTablesForBillingPeriod(companyTables, startDate, endDate, logTables);
    // ★ 2026-07-28 IN 목록 청크 — 일자축과 **같은 분할 규칙**을 써야 두 축 대조가 성립한다.
    const rows = await aggregateBillingSendIds(billingTables, billingIds, smsAggByRunDateType, startDate, endDate);
    for (const row of rows) {
      const day = toDayKey(row.send_date);
      const typeKey = MSG_TYPE_TO_USAGE_KEY[row.msg_type] || String(row.msg_type || '');
      const uid = owners.get(String(row.run_id)) ?? null;
      bumpRow(acc, {
        channel: 'web', itemDate: day, typeKey, userId: uid, agentSendId: null,
        total: 0, success: 0, fail: 0, pending: 0,
      }, { total: row.total_count, success: row.success_count, fail: row.fail_count, pending: row.pending_count });
    }
  }

  // (2026-07-30 재구축) 옛 2) 브랜드메시지 IMC arm 폐기 — 브랜드는 SMSQ msg_type='F'로
  //   위 1) 웹 일반발송 집계가 담당하고, 유형키(F→BRAND)는 MSG_TYPE_TO_USAGE_KEY가 맡는다.
  //   일자축(buildCompanyUsageByDay)과 같은 축이라 대조(diffBillingRowsVsDayData)도 그대로 성립한다.

  // 3) 테스트발송 — 계정은 bill_id
  if (!userId) {
    const testBase = await getBillingTestTables();
    const testTables = await getTablesForBillingPeriod(testBase, startDate, endDate, logTables);
    const testRows = await testSmsAggByUserDateType(
      testTables,
      `app_etc1 = 'test' AND app_etc2 = ? AND sendreq_time >= ? AND sendreq_time < DATE_ADD(?, INTERVAL 1 DAY)`,
      [companyId, startDate, endDate],
    );
    for (const row of testRows) {
      const day = toDayKey(row.send_date);
      const typeKey = row.msg_type === 'S' ? 'TEST_SMS' : 'TEST_LMS';
      const uid = String(row.bill_id || '').trim() || null;
      bumpRow(acc, {
        channel: 'test', itemDate: day, typeKey, userId: uid, agentSendId: null,
        total: 0, success: 0, fail: 0, pending: 0,
      }, { total: row.total_count, success: row.success_count, fail: row.fail_count, pending: row.pending_count });
    }
  }

  // 4) 스팸필터 테스트 (PostgreSQL) — 계정은 spam_filter_tests.user_id
  if (!userId) {
    const spamRes = await pool.query(`
      SELECT t.user_id, r.message_type,
             DATE(t.created_at AT TIME ZONE 'Asia/Seoul') as send_date,
             COUNT(*) as total_count,
             SUM(CASE WHEN r.result IS NOT NULL THEN 1 ELSE 0 END) as success_count
        FROM spam_filter_test_results r
        JOIN spam_filter_tests t ON r.test_id = t.id
       WHERE t.company_id = $1
         AND t.created_at >= ($2 || ' 00:00:00+09')::timestamptz
         AND t.created_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz
       GROUP BY t.user_id, r.message_type, DATE(t.created_at AT TIME ZONE 'Asia/Seoul')
    `, [companyId, startDate, endDate]);
    for (const row of spamRes.rows as any[]) {
      const day = toDayKey(row.send_date);
      const typeKey = row.message_type === 'LMS' ? 'SPAM_LMS' : 'SPAM_SMS';
      const uid = row.user_id ? String(row.user_id) : null;
      bumpRow(acc, {
        channel: 'spam', itemDate: day, typeKey, userId: uid, agentSendId: null,
        total: 0, success: 0, fail: 0, pending: 0,
      }, { total: row.total_count, success: row.success_count });
    }
  }

  const rows = Array.from(acc.values());

  // 5) 에이전트(게이트웨이) — 일자 × 발송ID × 유형
  if (!userId) {
    const ledger = opts.ledger ?? await loadBillingLedger(companyId);

    if (hasAgentMapping(ledger)) {
      // ★ `null`은 "0건"이 아니라 **미설정·조회 실패**다. 0건으로 삼키면 이 채널이 통째로 빠진 청구서가
      //   조용히 나간다 — 지금 고치려는 결함과 정확히 같은 모양이 된다. 반드시 터뜨린다.
      //
      // ★ 2026-07-26 터뜨리는 **범위를 좁혔다.** 그 전에는 매핑이 하나도 없는 순수 웹 회사에서도
      //   `queryPayAgentStoreBreakdown`을 불러, `PAY_STATS_DB_*` env가 비어 있으면 `getPool()`이 null →
      //   항상 null 반환 → **게이트웨이와 무관한 회사까지 전 발행이 중단**됐다.
      //   판정 축을 `usage_type`이 아니라 **매핑 실재**로 잡는다 — 매핑은 있는데 usage_type이 'web'인
      //   회사가 조용히 빠지는 것을 막기 위해서다.
      const storeRows = await queryPayAgentStoreBreakdown({
        scope: 'company', view: 'daily', startDate, endDate, companyId,
      });
      if (storeRows === null) {
        throw new Error('에이전트 발송 통계를 조회하지 못했습니다(PAY 통계DB 미설정 또는 조회 실패). 게이트웨이 발송분이 빠진 청구서가 나가지 않도록 발행을 중단합니다.');
      }
      if (storeRows.length > 0) {
        const agg = rollupAgentRowsForBilling(storeRows, ledger.postpaidSendIds);
        rows.push(...agg.rows);
        excludedPrepaidSendIds = agg.excludedSendIds;
      }
    } else if (ledger.usageType === 'agent' || ledger.usageType === 'both') {
      // ★ 2026-07-26 경고에서 차단으로(Codex 2차 수용). 매핑이 0인데 에이전트를 쓴다고 표시된 회사는
      //   게이트웨이 발송분이 청구에서 통째로 빠지는데 **금액 검사 3중이 전부 0을 기준으로 통과한다.**
      //   이번에 고치려는 `both` 17사 누락과 정확히 같은 모양이라, 로그만 남기면 같은 사고가 반복된다.
      //   매핑을 지운 게 의도였다면 `usage_type`을 'web'으로 바꾸는 게 맞는 표현이다.
      agentMappingMissing = true;
      console.log(`[정산][에이전트매핑없음] company=${companyId} usage_type=${ledger.usageType} — company_agent_ids 0행. 게이트웨이 발송분이 있다면 청구에서 통째로 빠진다.`);
    }
  }

  const sorted = sortBillingUsageRows(rows);
  return { rows: sorted, unbillable: findUnbillableBillingRows(sorted), excludedPrepaidSendIds, agentMappingMissing };
}
