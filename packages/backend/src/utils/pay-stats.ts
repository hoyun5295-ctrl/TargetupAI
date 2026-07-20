/**
 * pay-stats.ts — 에이전트(모듈) 발송 통계 CT (Track D 접점, 2026-07-20)
 *
 * 배경: 에이전트 전용 회사의 발송은 한줄로 campaigns가 아니라 게이트웨이 엔진(54/57/58)에서 일어나고,
 * 그 일별 통계는 강문희 수집엔진이 우리 서버 pay-ingest-db(MariaDB)의 `RSRM_SalesStts`로 실시간 적재한다
 * (0720 실측: 당일 18:46 적재 확인). 회사↔엔진 계정 연결 축 = `company_agent_ids.agent_send_id`(=CustId).
 *
 * RSRM_SalesStts 컬럼(0720 Harold SHOW COLUMNS 실측): DestDt(varchar8)·SysId·CustId·StoreId·MsgType·
 * RemAmt·TotCnt·OkCnt·FailCnt·ReadyCnt·UpdTm·InsTm.
 *
 * 반환 형태 = stats-aggregation `querySendStats`와 동일(summary/rows/total/page/totalPages) —
 * 발송통계 화면(StatsTab) 무수정으로 에이전트 회사에 엔진 통계를 표시한다.
 *
 * env(미설정 = 기능 조용히 비활성 — 기존 campaigns 축 유지):
 *   PAY_STATS_DB_HOST(기본 127.0.0.1) · PAY_STATS_DB_PORT(기본 23388) ·
 *   PAY_STATS_DB_USER · PAY_STATS_DB_PASSWORD · PAY_STATS_DB_NAME(기본 sales)
 */

import mysql from 'mysql2/promise';
import { query } from '../config/database';

let _pool: mysql.Pool | null = null;

export function isPayStatsConfigured(): boolean {
  return !!(process.env.PAY_STATS_DB_USER && process.env.PAY_STATS_DB_PASSWORD);
}

function getPool(): mysql.Pool | null {
  if (!isPayStatsConfigured()) return null;
  if (_pool) return _pool;
  _pool = mysql.createPool({
    host: process.env.PAY_STATS_DB_HOST || '127.0.0.1',
    port: Number(process.env.PAY_STATS_DB_PORT || 23388),
    user: process.env.PAY_STATS_DB_USER,
    password: process.env.PAY_STATS_DB_PASSWORD,
    database: process.env.PAY_STATS_DB_NAME || 'sales',
    connectionLimit: 3,
    charset: 'utf8mb4',
  });
  return _pool;
}

export interface PayStatsOptions {
  companyId: string;
  view: 'daily' | 'monthly';
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  page: number;
  limit: number;
}

export interface PayStatsResult {
  summary: { total_sent: string; total_success: string; total_fail: string; total_pending: string };
  rows: { period: string; runs: number; sent: number; success: number; fail: number; pending: number }[];
  total: number;
  page: number;
  totalPages: number;
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' (DestDt 비교용). 형식 밖 값은 무시(필터 생략) */
function toDestDt(d?: string): string | null {
  const s = String(d || '').replace(/-/g, '').trim();
  return /^\d{8}$/.test(s) ? s : null;
}

/**
 * 에이전트 회사의 엔진 발송 통계 — 회사에 연결된 CustId 전량 합산(다계정 = 고객사관리자 화면에서 하나로).
 * 미설정/미연결/조회 실패 = null 반환(호출부는 기존 campaigns 축 유지 — 조용한 폴백, 500 금지).
 */
export async function queryPayAgentStats(options: PayStatsOptions): Promise<PayStatsResult | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const custRes = await query(
      `SELECT agent_send_id FROM company_agent_ids WHERE company_id = $1 ORDER BY agent_send_id`,
      [options.companyId],
    );
    const custIds: string[] = custRes.rows.map((r: any) => String(r.agent_send_id).trim()).filter(Boolean);
    if (custIds.length === 0) return null;

    // 월별 조회 시 날짜를 월 단위로 확장 (querySendStats와 동일 규칙)
    let { startDate, endDate } = options;
    if (options.view === 'monthly') {
      if (startDate) startDate = startDate.substring(0, 7) + '-01';
      if (endDate) {
        const d = new Date(endDate);
        d.setMonth(d.getMonth() + 1, 0);
        endDate = d.toISOString().split('T')[0];
      }
    }
    const fromDt = toDestDt(startDate);
    const toDt = toDestDt(endDate);

    const conds: string[] = [`CustId IN (${custIds.map(() => '?').join(',')})`];
    const params: any[] = [...custIds];
    if (fromDt) { conds.push('DestDt >= ?'); params.push(fromDt); }
    if (toDt) { conds.push('DestDt <= ?'); params.push(toDt); }

    const [rows] = await pool.query(
      `SELECT DestDt, CustId,
              SUM(TotCnt) AS tot, SUM(OkCnt) AS ok, SUM(FailCnt) AS fl, SUM(ReadyCnt) AS rd
         FROM RSRM_SalesStts
        WHERE ${conds.join(' AND ')}
        GROUP BY DestDt, CustId`,
      params,
    );

    const byPeriod = new Map<string, { custs: Set<string>; sent: number; success: number; fail: number; pending: number }>();
    let totalSent = 0, totalSuccess = 0, totalFail = 0, totalPending = 0;

    for (const r of rows as any[]) {
      const dt = String(r.DestDt || '');
      if (dt.length !== 8) continue;
      const period = options.view === 'monthly'
        ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}`
        : `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
      const sent = Number(r.tot) || 0;
      const success = Number(r.ok) || 0;
      const fail = Number(r.fl) || 0;
      const pending = Number(r.rd) || 0;
      totalSent += sent; totalSuccess += success; totalFail += fail; totalPending += pending;
      if (!byPeriod.has(period)) byPeriod.set(period, { custs: new Set(), sent: 0, success: 0, fail: 0, pending: 0 });
      const b = byPeriod.get(period)!;
      b.custs.add(String(r.CustId));
      b.sent += sent; b.success += success; b.fail += fail; b.pending += pending;
    }

    const allRows = Array.from(byPeriod.entries())
      .map(([period, v]) => ({ period, runs: v.custs.size, sent: v.sent, success: v.success, fail: v.fail, pending: v.pending }))
      .sort((a, b) => b.period.localeCompare(a.period));

    const offset = (options.page - 1) * options.limit;
    return {
      summary: {
        total_sent: String(totalSent),
        total_success: String(totalSuccess),
        total_fail: String(totalFail),
        total_pending: String(totalPending),
      },
      rows: allRows.slice(offset, offset + options.limit),
      total: allRows.length,
      page: options.page,
      totalPages: Math.ceil(allRows.length / options.limit),
    };
  } catch (err: any) {
    console.log('[pay-stats] 조회 실패(campaigns 축 폴백):', err?.message || err);
    return null;
  }
}

export interface PayStatsDetailResult {
  userStats: { user_name: string; department: string; sent: number; success: number; fail: number; cost: number }[];
  campaigns: any[];
  unitCost: { sms: number; lms: number };
}

const MSG_TYPE_LABEL: Record<string, string> = { S: 'SMS', L: 'LMS', M: 'MMS' };

/**
 * 에이전트 회사 발송 상세 — 그 날짜(또는 월)의 계정(CustId)×유형(MsgType)별 분해.
 * 상세 모달의 userStats 표(이름/부서/발송/성공/실패)에 그대로 실리도록 동일 키로 반환
 * (이름=CustId, 부서=유형 라벨 — 화면 무수정). campaigns 섹션은 빈 배열 = 미표시.
 */
export async function queryPayAgentStatsDetail(options: {
  companyId: string;
  view: 'daily' | 'monthly';
  date: string; // daily 'YYYY-MM-DD' / monthly 'YYYY-MM'
}): Promise<PayStatsDetailResult | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const custRes = await query(
      `SELECT agent_send_id FROM company_agent_ids WHERE company_id = $1 ORDER BY agent_send_id`,
      [options.companyId],
    );
    const custIds: string[] = custRes.rows.map((r: any) => String(r.agent_send_id).trim()).filter(Boolean);
    if (custIds.length === 0) return null;

    const compact = String(options.date || '').replace(/-/g, '');
    let dateCond: string;
    let dateParam: string;
    if (options.view === 'monthly') {
      if (!/^\d{6}$/.test(compact)) return null;
      dateCond = 'DestDt LIKE ?';
      dateParam = `${compact}%`;
    } else {
      if (!/^\d{8}$/.test(compact)) return null;
      dateCond = 'DestDt = ?';
      dateParam = compact;
    }

    const [rows] = await pool.query(
      `SELECT CustId, MsgType,
              SUM(TotCnt) AS tot, SUM(OkCnt) AS ok, SUM(FailCnt) AS fl
         FROM RSRM_SalesStts
        WHERE CustId IN (${custIds.map(() => '?').join(',')}) AND ${dateCond}
        GROUP BY CustId, MsgType
        ORDER BY CustId, MsgType`,
      [...custIds, dateParam],
    );

    const userStats = (rows as any[])
      .filter((r) => Number(r.tot) > 0)
      .map((r) => ({
        user_name: String(r.CustId),
        department: MSG_TYPE_LABEL[String(r.MsgType)] || String(r.MsgType || '-'),
        sent: Number(r.tot) || 0,
        success: Number(r.ok) || 0,
        fail: Number(r.fl) || 0,
        cost: 0,
      }));
    if (userStats.length === 0) return null;

    return { userStats, campaigns: [], unitCost: { sms: 0, lms: 0 } };
  } catch (err: any) {
    console.log('[pay-stats] 상세 조회 실패(campaigns 축 폴백):', err?.message || err);
    return null;
  }
}
