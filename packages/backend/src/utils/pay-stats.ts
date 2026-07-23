/**
 * pay-stats.ts — 에이전트(모듈) 발송 통계 CT (Track D 접점, 2026-07-20 / 유형별 재개발 2026-07-23)
 *
 * 배경: 에이전트 전용 회사의 발송은 한줄로 campaigns가 아니라 게이트웨이 엔진(54/57/58)에서 일어나고,
 * 그 일별 통계는 강문희 수집엔진이 우리 서버 pay-ingest-db(MariaDB)의 `RSRM_SalesStts`로 실시간 적재한다.
 * 회사↔엔진 계정 연결 축 = `company_agent_ids.agent_send_id`(=CustId, B/C/D 접두 실측 확정).
 *
 * RSRM_SalesStts 컬럼(0720 SHOW COLUMNS 실측): DestDt(varchar8)·SysId·CustId·StoreId·MsgType·
 * RemAmt·TotCnt·OkCnt·FailCnt·ReadyCnt·UpdTm·InsTm.
 * MsgType 코드(0723 실측): S=SMS · L=LMS · M=MMS · K=카카오알림톡 (그 외 X=팩스 등).
 *
 * ★ 2026-07-23 유형별 재개발: 성공/전송을 유형(SMS/LMS/MMS/카카오)별로 나눠서 반환한다.
 *   - 회사(queryPayAgentStats): (기간×유형) rows + 유형별 합계(byType) + 전체 summary.
 *   - 슈퍼(queryPayAgentStatsAllCompanies): (기간×회사×유형) rows + 전체 summary.
 *
 * env(미설정 = 기능 조용히 비활성):
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

// ★ 유형 라벨 단일 소스 (MsgType 코드 → 사용자 표시명). 카카오는 알림톡.
export const AGENT_MSG_TYPE_LABEL: Record<string, string> = {
  S: 'SMS', L: 'LMS', M: 'MMS', K: '카카오알림톡', X: '팩스',
  KS: '카카오(SMS대체)', KL: '카카오(LMS대체)',
};
export function agentTypeLabel(t: string): string {
  const key = String(t || '').trim().toUpperCase();
  return AGENT_MSG_TYPE_LABEL[key] || (key ? key : '기타');
}
// 유형 표시 순서 (SMS→LMS→MMS→카카오→기타)
const TYPE_ORDER = ['S', 'L', 'M', 'K', 'KS', 'KL', 'X'];
function typeOrder(mt: string): number {
  const i = TYPE_ORDER.indexOf(String(mt || '').trim().toUpperCase());
  return i < 0 ? 99 : i;
}

export interface PayStatsOptions {
  companyId: string;
  view: 'daily' | 'monthly';
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  page: number;
  limit: number;
}

export interface PayTypeAgg {
  msg_type: string;
  type_label: string;
  sent: number;
  success: number;
  fail: number;
  pending: number;
}
export interface PayPeriodTypeRow extends PayTypeAgg {
  period: string;
  agent_send_id: string; // ★ 2026-07-23 발송ID(=CustId) 축 — 회사 표에서 ID별 구분(서수란 신고). 정산 오차 확인용.
}
export interface PayStatsResult {
  summary: { total_sent: string; total_success: string; total_fail: string; total_pending: string };
  byType: PayTypeAgg[];          // 유형별 합계 (기간 전체)
  rows: PayPeriodTypeRow[];       // (기간 × 유형) 행
  total: number;
  page: number;
  totalPages: number;
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' (DestDt 비교용). 형식 밖 값은 무시(필터 생략) */
function toDestDt(d?: string): string | null {
  const s = String(d || '').replace(/-/g, '').trim();
  return /^\d{8}$/.test(s) ? s : null;
}

/** 월별 조회 시 시작/끝 날짜를 월 단위로 확장 (querySendStats와 동일 규칙) */
function expandMonthly(view: 'daily' | 'monthly', startDate?: string, endDate?: string): { startDate?: string; endDate?: string } {
  if (view !== 'monthly') return { startDate, endDate };
  let s = startDate, e = endDate;
  if (s) s = s.substring(0, 7) + '-01';
  if (e) {
    const d = new Date(e);
    d.setMonth(d.getMonth() + 1, 0);
    e = d.toISOString().split('T')[0];
  }
  return { startDate: s, endDate: e };
}

function periodOf(dt: string, view: 'daily' | 'monthly'): string {
  return view === 'monthly'
    ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}`
    : `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
}

/**
 * 에이전트 회사의 엔진 발송 통계 — 회사에 연결된 CustId 전량 합산, **유형(MsgType)별 분해**.
 * 미설정/미연결/조회 실패 = null 반환(호출부는 조용히 폴백).
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

    const { startDate, endDate } = expandMonthly(options.view, options.startDate, options.endDate);
    const fromDt = toDestDt(startDate);
    const toDt = toDestDt(endDate);

    const conds: string[] = [`CustId IN (${custIds.map(() => '?').join(',')})`];
    const params: any[] = [...custIds];
    if (fromDt) { conds.push('DestDt >= ?'); params.push(fromDt); }
    if (toDt) { conds.push('DestDt <= ?'); params.push(toDt); }

    // ★ 2026-07-23 (서수란) 발송ID(CustId)별 × 유형 분해 — GROUP BY에 CustId 추가.
    //   byType/summary는 여전히 전 CustId 합산(회귀 0). CustId=RSRM_SalesStts 기존 컬럼(WHERE에서 이미 사용).
    const [rows] = await pool.query(
      `SELECT DestDt, CustId, MsgType,
              SUM(TotCnt) AS tot, SUM(OkCnt) AS ok, SUM(FailCnt) AS fl, SUM(ReadyCnt) AS rd
         FROM RSRM_SalesStts
        WHERE ${conds.join(' AND ')}
        GROUP BY DestDt, CustId, MsgType`,
      params,
    );

    const byPeriodType = new Map<string, PayPeriodTypeRow>();
    const byTypeMap = new Map<string, PayTypeAgg>();
    let totalSent = 0, totalSuccess = 0, totalFail = 0, totalPending = 0;

    for (const r of rows as any[]) {
      const dt = String(r.DestDt || '');
      if (!/^\d{8}$/.test(dt)) continue;
      const mt = String(r.MsgType || '').trim().toUpperCase();
      const custId = String(r.CustId || '').trim();
      const period = periodOf(dt, options.view);
      const sent = Number(r.tot) || 0;
      const success = Number(r.ok) || 0;
      const fail = Number(r.fl) || 0;
      const pending = Number(r.rd) || 0;
      totalSent += sent; totalSuccess += success; totalFail += fail; totalPending += pending;

      const pk = `${period}|${custId}|${mt}`;
      if (!byPeriodType.has(pk)) byPeriodType.set(pk, { period, agent_send_id: custId, msg_type: mt, type_label: agentTypeLabel(mt), sent: 0, success: 0, fail: 0, pending: 0 });
      const p = byPeriodType.get(pk)!;
      p.sent += sent; p.success += success; p.fail += fail; p.pending += pending;

      if (!byTypeMap.has(mt)) byTypeMap.set(mt, { msg_type: mt, type_label: agentTypeLabel(mt), sent: 0, success: 0, fail: 0, pending: 0 });
      const t = byTypeMap.get(mt)!;
      t.sent += sent; t.success += success; t.fail += fail; t.pending += pending;
    }

    const allRows = Array.from(byPeriodType.values()).sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      if (a.agent_send_id !== b.agent_send_id) return a.agent_send_id.localeCompare(b.agent_send_id);
      return typeOrder(a.msg_type) - typeOrder(b.msg_type);
    });
    const byType = Array.from(byTypeMap.values()).sort((a, b) => typeOrder(a.msg_type) - typeOrder(b.msg_type));

    const offset = (options.page - 1) * options.limit;
    return {
      summary: {
        total_sent: String(totalSent),
        total_success: String(totalSuccess),
        total_fail: String(totalFail),
        total_pending: String(totalPending),
      },
      byType,
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

/**
 * 회사의 유형별 합계만 (전송결과 모달 등 요약 섹션용). 기간 전체를 유형별로 집계.
 * 반환 = byType 배열 + summary. rows 불필요한 소비처를 위한 경량 함수.
 */
export async function queryPayAgentByType(options: {
  companyId: string;
  startDate?: string; // raw YYYY-MM-DD
  endDate?: string;
}): Promise<{ summary: { total_sent: string; total_success: string; total_fail: string; total_pending: string }; byType: PayTypeAgg[] } | null> {
  const res = await queryPayAgentStats({ companyId: options.companyId, view: 'daily', startDate: options.startDate, endDate: options.endDate, page: 1, limit: 1 });
  if (!res) return null;
  return { summary: res.summary, byType: res.byType };
}

export interface PayAgentCompanyRow {
  period: string;
  company_id: string;
  company_name: string;
  msg_type: string;
  type_label: string;
  sent: number;
  success: number;
  fail: number;
  pending: number;
}

export interface PayAgentAllResult {
  summary: { total_sent: string; total_success: string; total_fail: string; total_pending: string };
  rows: PayAgentCompanyRow[];
  total: number;
}

/**
 * 슈퍼관리자용 — 전 에이전트(agent·both) 회사의 엔진 발송 통계를 **(기간, 회사, 유형)별**로 합산.
 * companyId 지정 시 그 회사만. 미설정/미연결/실패 = null.
 *
 * ★ 날짜 확장: 이 함수가 view=monthly일 때 자체 확장하므로 호출부는 **원본(raw) 날짜**를 넘겨야 한다
 *   (admin 라우트가 이미 월 확장한 값을 넘기면 이중 확장 — rawStartDate/rawEndDate 전달 필수).
 */
export async function queryPayAgentStatsAllCompanies(options: {
  view: 'daily' | 'monthly';
  startDate?: string; // raw YYYY-MM-DD (미확장)
  endDate?: string;   // raw YYYY-MM-DD (미확장)
  companyId?: string;
}): Promise<PayAgentAllResult | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const mapParams: any[] = [];
    let compFilter = '';
    if (options.companyId) { compFilter = 'AND c.id = $1'; mapParams.push(options.companyId); }
    const mapRes = await query(
      `SELECT cai.agent_send_id, c.id AS company_id, c.company_name
         FROM company_agent_ids cai
         JOIN companies c ON c.id = cai.company_id
        WHERE c.usage_type IN ('agent','both') ${compFilter}`,
      mapParams,
    );
    const custToCompany = new Map<string, { id: string; name: string }>();
    const custIds: string[] = [];
    for (const r of mapRes.rows as any[]) {
      const cid = String(r.agent_send_id).trim();
      if (!cid) continue;
      custToCompany.set(cid, { id: String(r.company_id), name: String(r.company_name || '') });
      custIds.push(cid);
    }
    const empty: PayAgentAllResult = { summary: { total_sent: '0', total_success: '0', total_fail: '0', total_pending: '0' }, rows: [], total: 0 };
    if (custIds.length === 0) return empty;

    const { startDate, endDate } = expandMonthly(options.view, options.startDate, options.endDate);
    const fromDt = toDestDt(startDate);
    const toDt = toDestDt(endDate);

    const conds: string[] = [`CustId IN (${custIds.map(() => '?').join(',')})`];
    const params: any[] = [...custIds];
    if (fromDt) { conds.push('DestDt >= ?'); params.push(fromDt); }
    if (toDt) { conds.push('DestDt <= ?'); params.push(toDt); }

    const [rows] = await pool.query(
      `SELECT DestDt, CustId, MsgType,
              SUM(TotCnt) AS tot, SUM(OkCnt) AS ok, SUM(FailCnt) AS fl, SUM(ReadyCnt) AS rd
         FROM RSRM_SalesStts
        WHERE ${conds.join(' AND ')}
        GROUP BY DestDt, CustId, MsgType`,
      params,
    );

    const byKey = new Map<string, PayAgentCompanyRow>();
    let totalSent = 0, totalSuccess = 0, totalFail = 0, totalPending = 0;

    for (const r of rows as any[]) {
      const dt = String(r.DestDt || '');
      if (!/^\d{8}$/.test(dt)) continue;
      const comp = custToCompany.get(String(r.CustId));
      if (!comp) continue;
      const mt = String(r.MsgType || '').trim().toUpperCase();
      const period = periodOf(dt, options.view);
      const sent = Number(r.tot) || 0;
      const success = Number(r.ok) || 0;
      const fail = Number(r.fl) || 0;
      const pending = Number(r.rd) || 0;
      totalSent += sent; totalSuccess += success; totalFail += fail; totalPending += pending;

      const key = `${period}|${comp.id}|${mt}`;
      if (!byKey.has(key)) byKey.set(key, { period, company_id: comp.id, company_name: comp.name, msg_type: mt, type_label: agentTypeLabel(mt), sent: 0, success: 0, fail: 0, pending: 0 });
      const b = byKey.get(key)!;
      b.sent += sent; b.success += success; b.fail += fail; b.pending += pending;
    }

    const allRows: PayAgentCompanyRow[] = Array.from(byKey.values()).sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      const nc = a.company_name.localeCompare(b.company_name);
      if (nc !== 0) return nc;
      return typeOrder(a.msg_type) - typeOrder(b.msg_type);
    });

    return {
      summary: {
        total_sent: String(totalSent),
        total_success: String(totalSuccess),
        total_fail: String(totalFail),
        total_pending: String(totalPending),
      },
      rows: allRows,
      total: allRows.length,
    };
  } catch (err: any) {
    console.log('[pay-stats] 슈퍼 전체 조회 실패:', err?.message || err);
    return null;
  }
}
