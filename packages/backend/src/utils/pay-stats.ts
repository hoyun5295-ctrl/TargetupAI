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
  agent_send_id: string; // ★ 2026-07-24 발송ID(=CustId) 축 — 슈퍼 정산 대조용(고객사 화면과 동일 축)
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

      // ★ 2026-07-24 발송ID 축 추가 — 매핑 lookup(위 custToCompany.get)은 불변이라 집계 총량 보존, 표시용만 trim.
      const custId = String(r.CustId || '').trim();
      const key = `${period}|${comp.id}|${custId}|${mt}`;
      if (!byKey.has(key)) byKey.set(key, { period, company_id: comp.id, company_name: comp.name, agent_send_id: custId, msg_type: mt, type_label: agentTypeLabel(mt), sent: 0, success: 0, fail: 0, pending: 0 });
      const b = byKey.get(key)!;
      b.sent += sent; b.success += success; b.fail += fail; b.pending += pending;
    }

    const allRows: PayAgentCompanyRow[] = Array.from(byKey.values()).sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      const nc = a.company_name.localeCompare(b.company_name);
      if (nc !== 0) return nc;
      if (a.agent_send_id !== b.agent_send_id) return a.agent_send_id.localeCompare(b.agent_send_id);
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

export interface PayAgentBalance {
  agent_send_id: string;
  rem_amt: number | null; // null = 통계 행 없음/값 미확정(집계 전) — 실제 0원과 구분(Codex R1-2)
  as_of_date: string; // 'YYYY-MM-DD' — 게이트웨이 일별 통계의 최신 기준일(DestDt). ''=집계 전
  updated_at: string; // 그 행의 게이트웨이 갱신 시각(UpdTm)
}

export interface PayBalanceSourceRow {
  CustId?: any; DestDt?: any; RemAmt?: any; UpdTm?: any; MsgType?: any; StoreId?: any;
}

function updTmMs(v: any): number {
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v || '').replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

// RemAmt 원값 정규화 — null/undefined/빈 문자열은 "값 없음"(NaN)으로. Number(null)=0 강제 변환 차단(Codex R2 실버그).
function remAmtNum(v: any): number {
  if (v === null || v === undefined || String(v).trim() === '') return NaN;
  return Number(v);
}

// ★ 권위 행 확정(§8-9 행 단위 실측 0724): RemAmt는 **StoreId=''(계정 합계 행)에만** 실린다.
//   D0130 실증 — 빈 StoreId 행(L·S)은 둘 다 18,445(같은 값 복제), UUID StoreId 상세 행은 전부 0. B0001 동일('alarm' 행 0).
//   → pickLatestBalances는 StoreId 빈 행만 잔액 소스로 쓴다. PK가 (DestDt,CustId,StoreId,MsgType)라 StoreId는 NOT NULL('' 비교로 충분).
// 잔액 행 우선순위(계정 행 안에서) — DestDt 최대 → UpdTm 최신 → 값 보유(비NaN) 우선 → MsgType·StoreId 사전순.
// ⚠ "큰 값 우선" 축은 두지 않는다(Codex R3 — 계정 행 간 값이 어긋나는 미관측 상황에서 잔액 과대 표시 편향 차단).
//   실측상 같은 날 계정 행 RemAmt는 동일 복제(D0130 L·S 둘 다 18,445)라 값 축 자체가 불필요하고,
//   어긋나면 최신 스냅샷(UpdTm)이 이기며, 그마저 같으면 MsgType 사전순으로 결정적이다.
function balanceRowRank(a: PayBalanceSourceRow, b: PayBalanceSourceRow): number {
  const da = String(a.DestDt || ''), db = String(b.DestDt || '');
  if (da !== db) return da > db ? -1 : 1;
  const ua = updTmMs(a.UpdTm), ub = updTmMs(b.UpdTm);
  if (ua !== ub) return ua > ub ? -1 : 1;
  const ha = Number.isFinite(remAmtNum(a.RemAmt)) ? 0 : 1;
  const hb = Number.isFinite(remAmtNum(b.RemAmt)) ? 0 : 1;
  if (ha !== hb) return ha - hb; // 값 보유 행 > 값 없는(null) 행 — 동시각 한정
  const ma = String(a.MsgType || ''), mb = String(b.MsgType || '');
  if (ma !== mb) return ma < mb ? -1 : 1;
  const sa = String(a.StoreId || ''), sb = String(b.StoreId || '');
  if (sa !== sb) return sa < sb ? -1 : 1;
  return 0;
}

/**
 * 순수 선택 로직(테스트 대상) — CustId별 최우선 행 1건을 골라 custIds 순서대로 반환.
 * 통계 행이 없는 ID는 rem_amt=null(집계 전)로 합성해 조용한 누락을 막되, 0원으로 오인시키지 않는다.
 * RemAmt가 수치가 아니면 null(미확정) 처리.
 */
export function pickLatestBalances(custIds: string[], rows: PayBalanceSourceRow[]): PayAgentBalance[] {
  const best = new Map<string, PayBalanceSourceRow>();
  for (const r of rows) {
    const cid = String(r.CustId || '').trim();
    if (!cid) continue;
    if (String(r.StoreId || '').trim() !== '') continue; // 권위 행 = StoreId 빈 계정 합계 행만(§8-9 확정) — 상세 행 RemAmt=0 오염 차단
    const cur = best.get(cid);
    if (!cur || balanceRowRank(r, cur) < 0) best.set(cid, r);
  }
  return custIds.map((cid) => {
    const r = best.get(cid);
    if (!r) return { agent_send_id: cid, rem_amt: null, as_of_date: '', updated_at: '' };
    const dt = String(r.DestDt || '');
    const amt = remAmtNum(r.RemAmt); // null/''=값 없음 → null (0원 강제 변환 금지 — Codex R2)
    return {
      agent_send_id: cid,
      rem_amt: Number.isFinite(amt) ? amt : null,
      as_of_date: /^\d{8}$/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : '',
      updated_at: String(r.UpdTm || ''),
    };
  });
}

export interface AgentLedgerFields {
  billingType: 'prepaid' | 'postpaid';
  costPerSms: number | null;
  costPerLms: number | null;
  costPerMms: number | null;
  costPerKakao: number | null;
}

// 단가 1개 값 검증 (등록·수정 공용) — null/빈 값 = 미설정(null), 그 외 0~1,000,000 유한수(소수 허용)
function parseCostValue(v: any, label: string): { value: number | null } | { error: string } {
  if (v === undefined || v === null || String(v).trim() === '') return { value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
    return { error: `${label} 단가는 0 이상 1,000,000 이하 숫자여야 합니다.` };
  }
  return { value: n };
}

/**
 * ★ 2026-07-24 §5-1 — 발송ID 원장 필드(선/후불·단가) 등록용 파싱·검증 (POST 전용 — 미지정 = 기본값).
 * billingType 미지정/빈 값 = postpaid(기존 동작 보존). 위반 시 { error } 반환 — 라우트는 400으로 응답.
 */
export function parseAgentLedgerFields(body: any): AgentLedgerFields | { error: string } {
  const rawBilling = body?.billingType === undefined || body?.billingType === null || String(body?.billingType).trim() === ''
    ? 'postpaid'
    : String(body.billingType).trim();
  if (rawBilling !== 'prepaid' && rawBilling !== 'postpaid') {
    return { error: 'billingType은 prepaid 또는 postpaid만 허용됩니다.' };
  }
  const sms = parseCostValue(body?.costPerSms, 'SMS');
  if ('error' in sms) return sms;
  const lms = parseCostValue(body?.costPerLms, 'LMS');
  if ('error' in lms) return lms;
  const mms = parseCostValue(body?.costPerMms, 'MMS');
  if ('error' in mms) return mms;
  const kakao = parseCostValue(body?.costPerKakao, '카카오');
  if ('error' in kakao) return kakao;
  return { billingType: rawBilling, costPerSms: sms.value, costPerLms: lms.value, costPerMms: mms.value, costPerKakao: kakao.value };
}

export interface AgentLedgerPatch {
  updates: {
    billing_type?: 'prepaid' | 'postpaid';
    cost_per_sms?: number | null;
    cost_per_lms?: number | null;
    cost_per_mms?: number | null;
    cost_per_kakao?: number | null;
  };
}

/**
 * ★ 2026-07-24 §5-1 — 발송ID 원장 수정용 부분(PATCH) 파싱·검증 (Codex 5R-1 정정).
 * undefined/빈 billingType = 미변경(기존 값 보존 — 전체 덮어쓰기로 원장이 초기화되는 사고 차단).
 * 단가는 키가 온 것만 반영: '' 또는 null = 명시적 해제(null), 값 = 검증 후 세트.
 */
export function parseAgentLedgerPatch(body: any): AgentLedgerPatch | { error: string } {
  const updates: AgentLedgerPatch['updates'] = {};
  if (body?.billingType !== undefined && body?.billingType !== null && String(body.billingType).trim() !== '') {
    const bt = String(body.billingType).trim();
    if (bt !== 'prepaid' && bt !== 'postpaid') {
      return { error: 'billingType은 prepaid 또는 postpaid만 허용됩니다.' };
    }
    updates.billing_type = bt;
  }
  const entries: Array<['cost_per_sms' | 'cost_per_lms' | 'cost_per_mms' | 'cost_per_kakao', any, string]> = [
    ['cost_per_sms', body?.costPerSms, 'SMS'],
    ['cost_per_lms', body?.costPerLms, 'LMS'],
    ['cost_per_mms', body?.costPerMms, 'MMS'],
    ['cost_per_kakao', body?.costPerKakao, '카카오'],
  ];
  for (const [col, v, label] of entries) {
    if (v === undefined) continue;
    const r = parseCostValue(v, label);
    if ('error' in r) return r;
    updates[col] = r.value;
  }
  return { updates };
}

/**
 * ★ 2026-07-24 §5-2 — 발송ID별 게이트웨이 잔액 조회 (선불 prepaid ID만).
 * 잔액 = RSRM_SalesStts에서 CustId별 MAX(DestDt) 행의 RemAmt(같은 날 복수 행이면 UpdTm 최신 행).
 * 저장하지 않는다(이중 진실 금지) — 조회만. 과거 적재분(dump 복원·0715 이전)은 RemAmt=0이라
 * as_of_date를 반드시 함께 노출해 stale 여부를 사용자가 식별하게 한다(0724 실측 근거).
 * PAY env 미설정 = 기능 자체 비활성 — PG 검증 없이 빈 배열(의도. 이 경로에선 503 분기 미작동이 정상).
 * MySQL 연결/조회 실패 = 빈 배열(호출부 미노출 폴백).
 * 단 PG 에러(billing_type 컬럼 미마이그레이션 등)는 그대로 던진다 — 라우트 catch의 503 분기용.
 */
export async function queryPayAgentBalances(companyId: string): Promise<PayAgentBalance[]> {
  const pool = getPool();
  if (!pool) return [];

  const custRes = await query(
    `SELECT agent_send_id FROM company_agent_ids WHERE company_id = $1 AND billing_type = 'prepaid' ORDER BY agent_send_id`,
    [companyId],
  );
  const custIds: string[] = custRes.rows.map((r: any) => String(r.agent_send_id).trim()).filter(Boolean);
  if (custIds.length === 0) return [];

  try {
    // 계정 합계 행(StoreId='')만 — MAX(DestDt) 산정도 계정 행 기준(상세 행만 있는 날짜로 끌려가는 것 방지). 규칙 자체는 pickLatestBalances에도 이중 적용.
    const ph = custIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT s.CustId, s.DestDt, s.RemAmt, s.UpdTm, s.MsgType, s.StoreId
         FROM RSRM_SalesStts s
         JOIN (SELECT CustId, MAX(DestDt) AS mx FROM RSRM_SalesStts WHERE CustId IN (${ph}) AND StoreId = '' GROUP BY CustId) m
           ON m.CustId = s.CustId AND m.mx = s.DestDt
        WHERE s.StoreId = ''`,
      custIds,
    );
    return pickLatestBalances(custIds, rows as PayBalanceSourceRow[]);
  } catch (err: any) {
    console.log('[pay-stats] 잔액 조회 실패(미노출 폴백):', err?.message || err);
    return [];
  }
}
