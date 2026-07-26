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
import { expandMonthlyRange } from './stats-period';

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

/**
 * ★ 2026-07-25 통계 DB 상태 스냅샷 — 침입 감시·적재 정체 감지 전용.
 *
 * 배경: `pay-ingest-db`가 `0.0.0.0:23388`로 게시돼 인터넷에서 접근 가능한 상태다(실측 확인).
 *   계정은 전부 호스트 제한(`%` 없음)이라 인증은 못 뚫지만, 인증 이전 단계는 열려 있다.
 *   방화벽으로 출처를 좁히더라도 "누가 두드리는지"와 "적재가 살아 있는지"는 계속 보고 있어야 한다.
 *
 * ※ **읽기 전용이다.** 상태 변수 조회와 COUNT 하나뿐이라 강문희 쪽 적재를 방해하지 않는다.
 *   커넥션도 새로 만들지 않고 기존 풀(connectionLimit 3)을 공유한다.
 */
export interface PayDbSnapshot {
  abortedConnects: number;
  connections: number;
  /** MariaDB 가동 시간(초). 줄어들면 DB가 재시작된 것 → 누적 카운터 기준선을 다시 잡아야 한다. */
  uptimeSec: number;
  /** 오늘(KST 기준 YYYYMMDD) 적재된 행 수. 정체하면 push가 끊긴 것이다. */
  todayRows: number;
  /** 적재된 가장 최근 일자(YYYYMMDD). */
  latestDestDt: string | null;
}

export async function fetchPayDbSnapshot(): Promise<PayDbSnapshot | null> {
  const pool = getPool();
  if (!pool) return null;

  const [statusRows] = await pool.query(
    `SHOW GLOBAL STATUS WHERE Variable_name IN ('Aborted_connects','Connections','Uptime')`,
  );
  const status: Record<string, number> = {};
  for (const r of statusRows as any[]) status[String(r.Variable_name)] = Number(r.Value) || 0;

  // DestDt는 YYYYMMDD 문자열이다. 오늘 행 수와 최신 일자를 함께 본다 —
  // 최신 일자만 보면 하루 단위라 둔감해서, 오늘 안에 멈춘 것을 못 잡는다.
  const [ingestRows] = await pool.query(
    `SELECT COUNT(*) AS todayRows, MAX(DestDt) AS latestDestDt
       FROM RSRM_SalesStts
      WHERE DestDt = DATE_FORMAT(NOW(), '%Y%m%d')`,
  );
  const ing = (ingestRows as any[])[0] || {};

  return {
    abortedConnects: status.Aborted_connects || 0,
    connections: status.Connections || 0,
    uptimeSec: status.Uptime || 0,
    todayRows: Number(ing.todayRows) || 0,
    latestDestDt: ing.latestDestDt ? String(ing.latestDestDt) : null,
  };
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
  enrichNames?: boolean; // ★ 2026-07-25 발급명(CustNm) 부착 여부. 기본 true. rows 미사용 경로(queryPayAgentByType)는 false로 불필요 조회 차단.
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
  cust_name?: string; // ★ 2026-07-25 발급명(RSRM_SalesMst.CustNm) — 표시용 "custId / custNm". 이름 없으면 미포함(CustId만).
  is_relay?: boolean; // ★ 2026-07-25 부달(미달) 재전송 귀속분 — 공용 엔진 계정 발송을 원 발송ID로 귀속한 행
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

/** 조회 기간 상한(일) — 대상ID 그레인은 카디널리티가 높아(피케이포유 325 등) 무제한 조회 시 메모리·CSV 폭증. 연 단위 정산은 허용. */
export const STATS_RANGE_MAX_DAYS = 366;

/**
 * (순수) 통계 조회 기간 검증 — 존재·형식(YYYY-MM-DD)·실재 날짜·순서(시작≤종료)·상한.
 * ★ 2026-07-25 라우트 입력 검증 단일 소스(고객사·슈퍼 엑셀 공용). toDestDt는 형식 밖 값을 조용히 무시하므로
 *   검증 없이 두면 잘못된 날짜가 **무제한 전체 기간 조회**로 새어 대상ID 그레인에서 과중해진다.
 * ★ 성공 시 **정규화(trim)된 날짜를 함께 반환** — 호출부는 반드시 이 값을 하위 조회·파일명에 쓴다.
 *   원본을 그대로 넘기면 공백 낀 값이 expandMonthly의 substring(0,7)에서 깨져(' 2026-0-01') 시작일 필터가 조용히 빠진다.
 */
export function validateStatsDateRange(
  startDate?: string,
  endDate?: string,
  maxDays: number = STATS_RANGE_MAX_DAYS,
): { ok: true; startDate: string; endDate: string } | { ok: false; error: string } {
  const s = String(startDate || '').trim();
  const e = String(endDate || '').trim();
  if (!s || !e) return { ok: false, error: '시작일과 종료일을 입력해주세요.' };
  const fmt = /^\d{4}-\d{2}-\d{2}$/;
  if (!fmt.test(s) || !fmt.test(e)) return { ok: false, error: '날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).' };
  // 실재 날짜 확인 — 2026-13-45 같은 값이 형식만 통과해 들어오는 것 차단
  const real = (v: string): boolean => {
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };
  if (!real(s) || !real(e)) return { ok: false, error: '존재하지 않는 날짜입니다.' };
  if (s > e) return { ok: false, error: '시작일이 종료일보다 늦을 수 없습니다.' };
  const days = Math.round((Date.parse(e) - Date.parse(s)) / 86400000) + 1;
  if (days > maxDays) return { ok: false, error: `조회 기간은 최대 ${maxDays}일입니다. 기간을 나눠 받아주세요.` };
  return { ok: true, startDate: s, endDate: e };
}

/**
 * 월별 조회 시 시작/끝 날짜를 월 단위로 확장.
 * ★ 2026-07-25 규칙을 `utils/stats-period.ts` CT로 이동 — 화면(querySendStats)·에이전트(여기)·
 *   발송통계 엑셀 웹 행이 같은 함수를 봐야 한 파일 안에서 기간 축이 갈리지 않는다.
 */
const expandMonthly = expandMonthlyRange;

function periodOf(dt: string, view: 'daily' | 'monthly'): string {
  return view === 'monthly'
    ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}`
    : `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
}

/**
 * ★ 2026-07-25 (서수란 #4) 부달(미달) 재전송 중계 계정.
 * 알림톡 부달은 각 고객사 계정이 아니라 인비토 공용 엔진 계정으로 재전송되고, 원 계정은 `StoreId`에 기록된다.
 * 이 계정들의 발송은 우리 매핑에 없어 **어느 고객사 통계에도 안 잡히고**, 지금까지 사람이 수기로 원 업체에 붙여 왔다.
 * 계정이 늘어날 수 있으므로 env(`PAY_RELAY_CUST_IDS`, 콤마 구분)로 덮어쓸 수 있다.
 */
export const PAY_RELAY_CUST_IDS: string[] = Array.from(
  new Set(
    String(process.env.PAY_RELAY_CUST_IDS || 'B0061')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => {
        if (!s) return false;
        // 형식 강제 — 오타로 엉뚱한 값이 들어가면 그 계정 발송이 통째로 부달로 오분류된다
        if (!/^[A-Z]\d{4}$/.test(s)) {
          console.log(`[pay-stats] PAY_RELAY_CUST_IDS 형식 위반으로 무시: ${s}`);
          return false;
        }
        return true;
      }),
  ),
);

export function isRelayCustId(custId: string): boolean {
  return PAY_RELAY_CUST_IDS.includes(String(custId || '').trim().toUpperCase());
}

/**
 * 매핑 목록에서 중계 계정을 걷어낸다.
 * 중계 계정이 실수로 `company_agent_ids`에 등록되면 기본 조회와 부달 조회 양쪽에 잡혀 **이중 계상**된다.
 * 부달분은 원 발송ID로 귀속하는 것이 계약이므로, 중계 계정 자체는 어느 회사의 직접 발송분도 아니다.
 */
export function excludeRelayCustIds(custIds: string[]): string[] {
  return custIds.filter((c) => !isRelayCustId(c));
}

/**
 * (순수) 중계 계정 행의 `StoreId`에서 **원 발송ID**를 뽑는다. 못 뽑으면 null(=미귀속).
 * 실측 형태(2026-07-25): `b0093_16006217` · `b0179_1600-1279` · `b0067_metrocity` · `B0179_1522-5954` · `B0131`(단독).
 *   → 접두 4자리 + 선택적 `_접미`. 접미는 발신번호·영문명 등 제각각이라 검증 대상이 아니다.
 * 대문자로 정규화한다(게이트웨이 컬럼 collation이 utf8mb3_general_ci라 대소문자를 이미 같게 본다).
 *
 * ★ 안전 설계: 여기서 뽑은 값은 **후보**일 뿐이다. 반드시 `company_agent_ids` 실존 확인을 통과해야 귀속한다.
 *   "가장 비슷한 회사" 같은 추측 폴백은 절대 넣지 않는다 — 틀리면 남의 발송이 남의 청구서에 들어간다.
 * ★ 주의: 같은 이름의 `RSRM_FillAmtHist.StoreId`는 대상ID가 아니라 **발송ID(=CustId)**다(충전 경로).
 *   이 함수를 그쪽에 재사용하면 남의 계정에 충전이 들어간다. 통계 경로 전용이다.
 */
export function resolveRelayOwnerCustId(storeId: string | null | undefined): string | null {
  const s = String(storeId ?? '').trim();
  const m = /^([A-Za-z]\d{4})(?:_.*)?$/.exec(s);
  return m ? m[1].toUpperCase() : null;
}

/** 중계 계정 원본 행 + 해석된 원 발송ID (ownerCustId=null 이면 미귀속) */
export interface RelayResolvedRow {
  period_dt: string; // DestDt(YYYYMMDD)
  relay_cust_id: string;
  store_id: string;
  owner_cust_id: string | null;
  msg_type: string;
  sent: number;
  success: number;
  fail: number;
  pending: number;
}

/**
 * 중계 계정(부달 재전송) 행을 기간으로 조회하고 원 발송ID를 해석한다.
 * 실패 시 **throw** — 호출부의 try/catch가 null을 반환하고, CSV 라우트는 그 null을 503으로 표면화한다.
 * 조용히 빈 배열을 돌려주면 "부달 0건"으로 오독돼 정산이 과소집계된다.
 */
async function fetchRelayRows(pool: any, fromDt: string | null, toDt: string | null): Promise<RelayResolvedRow[]> {
  if (PAY_RELAY_CUST_IDS.length === 0) return [];
  const conds: string[] = [`CustId IN (${PAY_RELAY_CUST_IDS.map(() => '?').join(',')})`];
  const params: any[] = [...PAY_RELAY_CUST_IDS];
  if (fromDt) { conds.push('DestDt >= ?'); params.push(fromDt); }
  if (toDt) { conds.push('DestDt <= ?'); params.push(toDt); }

  const [rows] = await pool.query(
    `SELECT DestDt, CustId, StoreId, MsgType,
            SUM(TotCnt) AS tot, SUM(OkCnt) AS ok, SUM(FailCnt) AS fl, SUM(ReadyCnt) AS rd
       FROM RSRM_SalesStts
      WHERE ${conds.join(' AND ')}
      GROUP BY DestDt, CustId, StoreId, MsgType`,
    params,
  );

  const out: RelayResolvedRow[] = [];
  for (const r of rows as any[]) {
    const dt = String(r.DestDt || '');
    if (!/^\d{8}$/.test(dt)) continue;
    out.push({
      period_dt: dt,
      relay_cust_id: String(r.CustId || '').trim(),
      store_id: String(r.StoreId ?? ''),
      owner_cust_id: resolveRelayOwnerCustId(r.StoreId),
      msg_type: String(r.MsgType || '').trim().toUpperCase(),
      sent: Number(r.tot) || 0,
      success: Number(r.ok) || 0,
      fail: Number(r.fl) || 0,
      pending: Number(r.rd) || 0,
    });
  }
  return out;
}

/**
 * 발송ID(CustId) → 발급명(CustNm) 맵. 원장 RSRM_SalesMst(62 pay-ingest-db — 143 폐기와 무관하게 유지)에서 조회.
 * ★ 2026-07-25 (서수란) 발송ID에 업체가 아는 발급명을 함께 표시하기 위한 이름 소스(내부 코드 B0039만으론 업체가 모름).
 * 이름 없는 CustId는 맵에 없음(호출부는 CustId만 표시 폴백). 조회 실패 = 빈 맵(회귀 0 — 발송·정산 무영향).
 * 한 CustId에 원장 행이 여럿(계정×지점 730행/499 CustId)일 수 있어, ORDER BY로 최신행(UpdTm→SeqNo)을 결정적으로 채택한다.
 */
export async function fetchCustNames(pool: any, custIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(custIds.map((c) => String(c).trim()).filter(Boolean)));
  if (ids.length === 0) return map;
  try {
    const [rows] = await pool.query(
      `SELECT CustId, CustNm FROM RSRM_SalesMst
        WHERE CustId IN (${ids.map(() => '?').join(',')}) AND CustNm <> ''
        ORDER BY CustId, UpdTm DESC, SeqNo DESC`,
      ids,
    );
    // ORDER BY로 CustId별 최신행이 먼저 오므로, 첫 항목(!map.has)이 최신 이름 = 결정적.
    for (const r of rows as any[]) {
      const id = String(r.CustId || '').trim();
      const nm = String(r.CustNm || '').trim();
      if (id && nm && !map.has(id)) map.set(id, nm);
    }
  } catch (err: any) {
    console.log('[pay-stats] 발급명(CustNm) 조회 실패 — CustId만 표시:', err?.message || err);
  }
  return map;
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
    // 중계 계정이 매핑에 섞여 있으면 기본 조회와 부달 조회 양쪽에 잡혀 이중 계상된다
    const custIds: string[] = excludeRelayCustIds(custRes.rows.map((r: any) => String(r.agent_send_id).trim()).filter(Boolean));
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

    // ★ 2026-07-25 (서수란 #4) 부달 재전송 귀속 — 공용 엔진 계정 발송을 StoreId에 적힌 원 발송ID로 되돌린다.
    //   이 물량은 우리 매핑에 없어 지금까지 어느 고객사에도 안 잡혔고 사람이 수기로 붙여 왔다(= 순수 추가, 감소하는 회사 없음).
    //   해석 실패분(미귀속)은 이 회사 것이라는 근거가 없으므로 회사 화면에서는 제외한다 — 총량 대조는 슈퍼 축이 담당.
    const custIdSet = new Set(custIds.map((c) => c.toUpperCase()));
    for (const rr of await fetchRelayRows(pool, fromDt, toDt)) {
      if (!rr.owner_cust_id || !custIdSet.has(rr.owner_cust_id)) continue;
      const period = periodOf(rr.period_dt, options.view);
      totalSent += rr.sent; totalSuccess += rr.success; totalFail += rr.fail; totalPending += rr.pending;

      const pk = `${period}|${rr.owner_cust_id}|${rr.msg_type}|relay`;
      if (!byPeriodType.has(pk)) {
        byPeriodType.set(pk, { period, agent_send_id: rr.owner_cust_id, msg_type: rr.msg_type, type_label: agentTypeLabel(rr.msg_type), is_relay: true, sent: 0, success: 0, fail: 0, pending: 0 });
      }
      const rp = byPeriodType.get(pk)!;
      rp.sent += rr.sent; rp.success += rr.success; rp.fail += rr.fail; rp.pending += rr.pending;

      if (!byTypeMap.has(rr.msg_type)) byTypeMap.set(rr.msg_type, { msg_type: rr.msg_type, type_label: agentTypeLabel(rr.msg_type), sent: 0, success: 0, fail: 0, pending: 0 });
      const rt = byTypeMap.get(rr.msg_type)!;
      rt.sent += rr.sent; rt.success += rr.success; rt.fail += rr.fail; rt.pending += rr.pending;
    }

    const allRows = Array.from(byPeriodType.values()).sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      if (a.agent_send_id !== b.agent_send_id) return a.agent_send_id.localeCompare(b.agent_send_id);
      const to = typeOrder(a.msg_type) - typeOrder(b.msg_type);
      if (to !== 0) return to;
      return Number(a.is_relay || false) - Number(b.is_relay || false); // 직접분 먼저, 부달 귀속분 뒤
    });
    // ★ 2026-07-25 (서수란) 발급명(CustNm) 부착 — 발송ID를 "custId / custNm"로 표시. 이름 없으면 CustId만.
    //   rows 미사용 경로(queryPayAgentByType→ResultsModal 요약)는 enrichNames:false로 이 조회를 건너뛴다.
    if (options.enrichNames !== false) {
      const nameMap = await fetchCustNames(pool, custIds);
      for (const row of allRows) {
        const nm = nameMap.get(row.agent_send_id);
        if (nm) row.cust_name = nm;
      }
    }
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
  const res = await queryPayAgentStats({ companyId: options.companyId, view: 'daily', startDate: options.startDate, endDate: options.endDate, page: 1, limit: 1, enrichNames: false });
  if (!res) return null;
  return { summary: res.summary, byType: res.byType };
}

export interface PayAgentCompanyRow {
  period: string;
  company_id: string;
  company_name: string;
  agent_send_id: string; // ★ 2026-07-24 발송ID(=CustId) 축 — 슈퍼 정산 대조용(고객사 화면과 동일 축)
  cust_name?: string; // ★ 2026-07-25 발급명(RSRM_SalesMst.CustNm) — 표시용 "custId / custNm". 이름 없으면 미포함(CustId만).
  is_relay?: boolean; // ★ 2026-07-25 부달 재전송 귀속분
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
    // ★ 2026-07-25 매핑은 **항상 전사 조회**한다. 회사 필터는 그 뒤에 적용.
    //   부달 귀속을 필터된 매핑으로 해석하면, 다른 회사 소유 부달이 원 계정을 못 찾아
    //   `(미귀속)`으로 둔갑해 선택한 회사 화면·CSV에 섞여 들어간다(Codex 적대검증 발견).
    const mapRes = await query(
      `SELECT cai.agent_send_id, c.id AS company_id, c.company_name
         FROM company_agent_ids cai
         JOIN companies c ON c.id = cai.company_id
        WHERE c.usage_type IN ('agent','both')`,
    );
    const allCustToCompany = new Map<string, { id: string; name: string }>();
    for (const r of mapRes.rows as any[]) {
      const cid = String(r.agent_send_id).trim();
      if (!cid) continue;
      allCustToCompany.set(cid, { id: String(r.company_id), name: String(r.company_name || '') });
    }
    // 조회 대상(회사 필터 적용분)
    const custToCompany = new Map<string, { id: string; name: string }>();
    const custIds: string[] = [];
    for (const [cid, comp] of allCustToCompany) {
      if (isRelayCustId(cid)) continue; // 중계 계정은 직접 발송분이 아니다(부달 조회가 따로 담당)
      if (options.companyId && comp.id !== options.companyId) continue;
      custToCompany.set(cid, comp);
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

    // ★ 2026-07-25 (서수란 #4) 부달 재전송 귀속 — 슈퍼 축은 **미귀속분도 버리지 않고** 표면화한다.
    //   조용히 버리면 "B0061 총량 = 귀속분 + 미귀속분" 대조가 깨져 파싱 결함을 아무도 못 본다.
    //   해석은 전사 매핑으로 한다(위 주석 참조). 회사 필터가 걸린 조회에서는 그 회사 소유분만 남기고,
    //   해석 실패분(미귀속)은 전사 조회에서만 보여준다 — 특정 회사 화면에 남의 미귀속이 섞이면 안 된다.
    const upperToCompany = new Map<string, { id: string; name: string }>();
    for (const [cid, comp] of allCustToCompany) upperToCompany.set(cid.toUpperCase(), comp);

    for (const rr of await fetchRelayRows(pool, fromDt, toDt)) {
      const owner = rr.owner_cust_id ? upperToCompany.get(rr.owner_cust_id) : undefined;
      if (options.companyId && (!owner || owner.id !== options.companyId)) continue;
      const period = periodOf(rr.period_dt, options.view);
      totalSent += rr.sent; totalSuccess += rr.success; totalFail += rr.fail; totalPending += rr.pending;

      const compId = owner ? owner.id : '';
      const compName = owner ? owner.name : '(미귀속)';
      const sendId = owner ? rr.owner_cust_id! : rr.relay_cust_id;
      const key = `${period}|${compId}|${sendId}|${rr.msg_type}|relay`;
      if (!byKey.has(key)) {
        byKey.set(key, { period, company_id: compId, company_name: compName, agent_send_id: sendId, is_relay: true, msg_type: rr.msg_type, type_label: agentTypeLabel(rr.msg_type), sent: 0, success: 0, fail: 0, pending: 0 });
      }
      const rb = byKey.get(key)!;
      rb.sent += rr.sent; rb.success += rr.success; rb.fail += rr.fail; rb.pending += rr.pending;
    }

    const allRows: PayAgentCompanyRow[] = Array.from(byKey.values()).sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      const nc = a.company_name.localeCompare(b.company_name);
      if (nc !== 0) return nc;
      if (a.agent_send_id !== b.agent_send_id) return a.agent_send_id.localeCompare(b.agent_send_id);
      const to = typeOrder(a.msg_type) - typeOrder(b.msg_type);
      if (to !== 0) return to;
      return Number(a.is_relay || false) - Number(b.is_relay || false);
    });

    // ★ 2026-07-25 (서수란) 발급명(CustNm) 부착 — 슈퍼 화면·CSV 발송ID에 발급명 병기(고객사와 동일 소스).
    const nameMap = await fetchCustNames(pool, custIds);
    for (const row of allRows) {
      const nm = nameMap.get(row.agent_send_id);
      if (nm) row.cust_name = nm;
    }

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

// ★ 2026-07-25 (서수란 #2) 대상ID(StoreId)별 분해 — CSV 엑셀 정산 전용.
export interface PayAgentStoreRow {
  period: string;
  company_name?: string; // 슈퍼(admin) scope에서만 채움
  agent_send_id: string; // = CustId
  cust_name?: string;    // 발급명(RSRM_SalesMst.CustNm)
  store_id: string;      // 대상ID(StoreId 원본). ''=대상ID 없음
  is_relay?: boolean;    // ★ 2026-07-25 부달 재전송 귀속분(공용 엔진 계정 → 원 발송ID)
  msg_type: string;
  type_label: string;
  sent: number;
  success: number;
  fail: number;
  pending: number;
}

/**
 * (순수) SQL 원본 행 → 대상ID(StoreId)별 PayAgentStoreRow[] 그룹핑·정렬. DB I/O와 분리해 단위 테스트 가능.
 * - 공백만 있는 StoreId는 ''(대상ID 없음 버킷)로 정규화 → 유령 중복 행 방지. 그 외는 원본 보존(정산 키).
 * - admin scope: custToCompany에 없는 CustId 제외(집계 총량 보존) + company_name 채움.
 * - 정렬: 기간 desc → (admin)회사명 → 발송ID → 대상ID → 유형순(동일 typeOrder 미지 유형은 msg_type 사전순 tiebreak).
 * - nameMap 있으면 발급명(cust_name) 부착.
 */
export function groupStoreRows(
  rawRows: any[],
  opts: {
    scope: 'company' | 'admin';
    view: 'daily' | 'monthly';
    custToCompany?: Map<string, string>;
    nameMap?: Map<string, string>;
  },
): PayAgentStoreRow[] {
  const byKey = new Map<string, PayAgentStoreRow>();
  for (const r of rawRows || []) {
    const dt = String(r.DestDt || '');
    if (!/^\d{8}$/.test(dt)) continue;
    const custId = String(r.CustId || '').trim();
    if (opts.scope === 'admin' && !opts.custToCompany?.has(custId)) continue; // 매핑 없는 CustId 제외(집계 총량 보존)
    const mt = String(r.MsgType || '').trim().toUpperCase();
    const rawStore = String(r.StoreId ?? '');
    const storeId = rawStore.trim() === '' ? '' : rawStore; // 공백만 = 대상ID 없음(정규화), 그 외 원본 보존
    const period = periodOf(dt, opts.view);
    const sent = Number(r.tot) || 0;
    const success = Number(r.ok) || 0;
    const fail = Number(r.fl) || 0;
    const pending = Number(r.rd) || 0;

    const key = `${period}|${custId}|${storeId}|${mt}`;
    if (!byKey.has(key)) {
      const row: PayAgentStoreRow = { period, agent_send_id: custId, store_id: storeId, msg_type: mt, type_label: agentTypeLabel(mt), sent: 0, success: 0, fail: 0, pending: 0 };
      if (opts.scope === 'admin') row.company_name = opts.custToCompany?.get(custId) || '';
      byKey.set(key, row);
    }
    const b = byKey.get(key)!;
    b.sent += sent; b.success += success; b.fail += fail; b.pending += pending;
  }

  const allRows = Array.from(byKey.values()).sort((a, b) => {
    if (a.period !== b.period) return b.period.localeCompare(a.period);
    if (opts.scope === 'admin') {
      const nc = (a.company_name || '').localeCompare(b.company_name || '');
      if (nc !== 0) return nc;
    }
    if (a.agent_send_id !== b.agent_send_id) return a.agent_send_id.localeCompare(b.agent_send_id);
    const sa = a.store_id || '', sb = b.store_id || '';
    if (sa !== sb) return sa.localeCompare(sb);
    const to = typeOrder(a.msg_type) - typeOrder(b.msg_type);
    if (to !== 0) return to;
    return a.msg_type.localeCompare(b.msg_type); // 미지 유형(동일 typeOrder 99) 결정적 tiebreak
  });

  if (opts.nameMap) {
    for (const row of allRows) {
      const nm = opts.nameMap.get(row.agent_send_id);
      if (nm) row.cust_name = nm;
    }
  }
  return allRows;
}

/**
 * 대상ID(StoreId)별 발송 통계 — **CSV 엑셀 정산 전용**(화면 집계 함수와 분리 = 라이브 통계 회귀 0).
 * ★ 2026-07-25 서수란 #2: 아난티 지점·마리오 200/400·피케이포유 업체구분처럼 발송 시 입력한 대상ID로 청구를 나눈다.
 *   그레인 = (기간 × 발송ID × 대상ID × 유형). 화면에 통으로 넣으면 폭증(피케이포유 325 등)이라 CSV에만 둔다.
 * scope='company' = 그 회사만(고객사 CSV, company_name 불필요). scope='admin' = 전 agent/both(슈퍼 CSV, company_name 채움·companyId로 필터 가능).
 * 대상ID(StoreId)는 원본 그대로 — 게이트웨이 ingest 인코딩 손상(피케이포유 EUC-KR 이중인코딩) 복원은 별도 과제.
 * **반환 계약**: `null` = 미설정(pool 없음)·조회 실패 → 호출부는 **503으로 표면화**(빈 CSV로 내면 정산 과소집계로 오인).
 *   `[]` = 정상 0건(매핑된 발송ID 없음 포함). 이 둘을 절대 같게 다루지 말 것.
 */
export async function queryPayAgentStoreBreakdown(options: {
  scope: 'company' | 'admin';
  view: 'daily' | 'monthly';
  startDate?: string; // raw YYYY-MM-DD
  endDate?: string;
  companyId?: string; // company scope=필수, admin scope=선택 필터
}): Promise<PayAgentStoreRow[] | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    // 1) CustId 목록(+ admin scope는 회사명 매핑)
    const custIds: string[] = [];
    const custToCompany = new Map<string, string>(); // CustId → company_name (admin scope)
    const allOwnerCompany = new Map<string, { id: string; name: string }>(); // 대문자 CustId → 회사(전사) — 부달 귀속 해석용
    if (options.scope === 'company') {
      if (!options.companyId) return [];
      // ★ 부달 귀속 해석에 쓸 전사 매핑도 함께 채운다. 이게 비어 있으면 회사 CSV에서 부달 행이
      //   전부 미해석으로 떨어져 통째로 사라진다(화면엔 있고 엑셀엔 없는 상태 = 정산 대조 붕괴).
      const allRes = await query(
        `SELECT cai.agent_send_id, c.id AS company_id, c.company_name
           FROM company_agent_ids cai
           JOIN companies c ON c.id = cai.company_id`,
      );
      for (const x of allRes.rows as any[]) {
        const cid = String(x.agent_send_id || '').trim();
        if (!cid) continue;
        allOwnerCompany.set(cid.toUpperCase(), { id: String(x.company_id), name: String(x.company_name || '') });
      }
      const r = await query(
        `SELECT agent_send_id FROM company_agent_ids WHERE company_id = $1 ORDER BY agent_send_id`,
        [options.companyId],
      );
      for (const x of r.rows as any[]) {
        const cid = String(x.agent_send_id).trim();
        // 중계 계정 제외 — 부달 조회가 따로 담당한다. 안 빼면 같은 행이 두 번 잡힌다(고객사 CSV 이중 계상)
        if (cid && !isRelayCustId(cid)) custIds.push(cid);
      }
    } else {
      // ★ 2026-07-25 매핑은 전사 조회 후 회사 필터 적용 — 부달 귀속을 필터된 매핑으로 해석하면
      //   다른 회사 소유 부달이 (미귀속)으로 둔갑해 선택한 회사 CSV에 섞인다(Codex 적대검증 발견).
      const r = await query(
        `SELECT cai.agent_send_id, c.id AS company_id, c.company_name
           FROM company_agent_ids cai
           JOIN companies c ON c.id = cai.company_id
          WHERE c.usage_type IN ('agent','both')`,
      );
      for (const x of r.rows as any[]) {
        const cid = String(x.agent_send_id).trim();
        if (!cid) continue;
        allOwnerCompany.set(cid.toUpperCase(), { id: String(x.company_id), name: String(x.company_name || '') });
        if (isRelayCustId(cid)) continue; // 중계 계정 제외 — 부달 조회가 따로 담당(이중 계상 차단)
        if (options.companyId && String(x.company_id) !== options.companyId) continue;
        custToCompany.set(cid, String(x.company_name || ''));
        custIds.push(cid);
      }
    }
    if (custIds.length === 0) return [];

    // 2) 날짜/조건 (화면 함수와 동일 규칙)
    const { startDate, endDate } = expandMonthly(options.view, options.startDate, options.endDate);
    const fromDt = toDestDt(startDate);
    const toDt = toDestDt(endDate);
    const conds: string[] = [`CustId IN (${custIds.map(() => '?').join(',')})`];
    const params: any[] = [...custIds];
    if (fromDt) { conds.push('DestDt >= ?'); params.push(fromDt); }
    if (toDt) { conds.push('DestDt <= ?'); params.push(toDt); }

    // 3) 대상ID(StoreId)별 집계 — GROUP BY에 StoreId 추가
    const [rows] = await pool.query(
      `SELECT DestDt, CustId, StoreId, MsgType,
              SUM(TotCnt) AS tot, SUM(OkCnt) AS ok, SUM(FailCnt) AS fl, SUM(ReadyCnt) AS rd
         FROM RSRM_SalesStts
        WHERE ${conds.join(' AND ')}
        GROUP BY DestDt, CustId, StoreId, MsgType`,
      params,
    );

    // 4) 발급명 부착 소스 + 순수 그룹핑(공백 정규화·정렬·이름 부착)은 groupStoreRows에 위임(단위 테스트 대상)
    const nameMap = await fetchCustNames(pool, custIds);
    const baseRows = groupStoreRows(rows as any[], { scope: options.scope, view: options.view, custToCompany, nameMap });

    // 5) ★ 2026-07-25 (서수란 #4) 부달 재전송 귀속 행 추가.
    //    대상ID(store_id)에는 원본 마커(`b0179_16601910` 등)를 그대로 남긴다 — 어느 계정·번호에서 온 부달인지가 정산 근거다.
    //    슈퍼 축은 미귀속분도 `(미귀속)`으로 남겨 "총량 = 귀속 + 미귀속" 대조가 가능하게 한다.
    const ownScope = new Set(custIds.map((c) => c.toUpperCase())); // 이번 조회 대상(회사 필터 적용분)
    const relayRows: PayAgentStoreRow[] = [];
    const relayKey = new Map<string, PayAgentStoreRow>();
    for (const rr of await fetchRelayRows(pool, fromDt, toDt)) {
      // 해석은 전사 매핑으로, 채택은 조회 범위로 — 남의 회사 부달이 (미귀속)으로 새는 것 차단
      const resolved = rr.owner_cust_id && allOwnerCompany.has(rr.owner_cust_id) ? rr.owner_cust_id : null;
      const owner = resolved && ownScope.has(resolved) ? resolved : null;
      if (!owner && (options.scope === 'company' || options.companyId || resolved)) continue;
      const period = periodOf(rr.period_dt, options.view);
      const sendId = owner || rr.relay_cust_id;
      const key = `${period}|${sendId}|${rr.store_id}|${rr.msg_type}`;
      if (!relayKey.has(key)) {
        const row: PayAgentStoreRow = {
          period, agent_send_id: sendId, store_id: rr.store_id, is_relay: true,
          msg_type: rr.msg_type, type_label: agentTypeLabel(rr.msg_type),
          sent: 0, success: 0, fail: 0, pending: 0,
        };
        if (options.scope === 'admin') row.company_name = owner ? (allOwnerCompany.get(owner)?.name || '') : '(미귀속)';
        const nm = owner ? nameMap.get(owner) : undefined;
        if (nm) row.cust_name = nm;
        relayKey.set(key, row);
        relayRows.push(row);
      }
      const rb = relayKey.get(key)!;
      rb.sent += rr.sent; rb.success += rr.success; rb.fail += rr.fail; rb.pending += rr.pending;
    }

    // ★ 정렬은 통합 후 한 번 — 부달 행을 뒤에 이어붙이기만 하면 DB 반환 순서대로 흩어진다(Codex 지적)
    return baseRows.concat(relayRows).sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      if (options.scope === 'admin') {
        const nc = (a.company_name || '').localeCompare(b.company_name || '');
        if (nc !== 0) return nc;
      }
      if (a.agent_send_id !== b.agent_send_id) return a.agent_send_id.localeCompare(b.agent_send_id);
      const sa = a.store_id || '', sb = b.store_id || '';
      if (sa !== sb) return sa.localeCompare(sb);
      const to = typeOrder(a.msg_type) - typeOrder(b.msg_type);
      if (to !== 0) return to;
      if (a.msg_type !== b.msg_type) return a.msg_type.localeCompare(b.msg_type);
      return Number(a.is_relay || false) - Number(b.is_relay || false);
    });
  } catch (err: any) {
    console.log('[pay-stats] 대상ID 분해 조회 실패:', err?.message || err);
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
// ============================================================
// ★ 2026-07-24 §5-3 — 에이전트 충전 실행 (62 pay-ingest-db RSRM_FillAmtHist)
//   계약(0724 강문희 회신 + 왕복 실측 B0023 ±1,000 통과):
//   - INSERT = (StoreId=발송ID, FillAmt, FillDtTm=NOW(), PayMethod='2', RsApplyFlag='N')
//   - 엔진이 N 행을 읽어 잔액 증액 후 Y + RsApplyDtTm update → **Y 확인 후에만 성공 표시**(6원칙 ②)
//   - SeqNo는 auto_increment 재채번(워터마크 아님). 음수 = 상계(실무 패턴). PayFkey = 미사용(비움)
//   - PG에 상태를 복제 저장하지 않는다 — FillAmtHist가 단일 원장(이중 진실 금지)
// ============================================================

export interface AgentChargeInput { agentSendId: string; amount: number }

/**
 * 충전 요청 body 검증 — 1~50건, 발송ID 필수·**요청 내 중복 금지**, 금액 = 0 제외 ±1억 이내 유한수(소수 허용),
 * **배치 절대합 ≤ 1억**(Codex 7R-2 — 동일 한도 행 50개로 총액 폭주하는 경로 차단).
 */
export function parseAgentCharges(body: any): { charges: AgentChargeInput[] } | { error: string } {
  const raw = Array.isArray(body?.charges) ? body.charges : null;
  if (!raw || raw.length === 0) return { error: 'charges 배열이 비어 있습니다.' };
  if (raw.length > 50) return { error: '일괄 충전은 50건 이하여야 합니다.' };
  const charges: AgentChargeInput[] = [];
  const seen = new Set<string>();
  let absTotal = 0;
  for (const r of raw) {
    const agentSendId = String(r?.agentSendId || '').trim();
    if (!agentSendId || agentSendId.length > 100) return { error: '발송ID가 비었거나 100자를 초과했습니다.' };
    if (seen.has(agentSendId.toUpperCase())) return { error: `같은 발송ID가 요청에 2번 이상 있습니다: ${agentSendId} — 금액을 합쳐 1행으로 입력하세요.` };
    seen.add(agentSendId.toUpperCase());
    // 금액 = number 또는 십진 문자열만 (Codex 8R — boolean/배열/16진 문자열의 Number() 강제 변환 차단)
    const rawAmount = r?.amount;
    let amount: number;
    if (typeof rawAmount === 'number') {
      amount = rawAmount;
    } else if (typeof rawAmount === 'string' && /^-?\d+(\.\d+)?$/.test(rawAmount.trim())) {
      amount = Number(rawAmount.trim());
    } else {
      return { error: `금액 형식이 올바르지 않습니다. (${agentSendId})` };
    }
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000_000) {
      return { error: `금액은 0을 제외한 ±100,000,000 이내 숫자여야 합니다. (${agentSendId})` };
    }
    absTotal += Math.abs(amount);
    charges.push({ agentSendId, amount });
  }
  if (absTotal > 100_000_000) {
    return { error: `배치 총액(절대값 합)은 100,000,000 이하여야 합니다. (현재 ${absTotal.toLocaleString()})` };
  }
  return { charges };
}

const CHARGE_STMT_TIMEOUT_MS = 30_000;  // 개별 문 timeout(빠른 실패용)
// ★ 전체 충전 트랜잭션 단일 데드라인(Codex 14R): 커넥션 획득·세션 설정·모든 INSERT·COMMIT을 통틀어 이 시한.
//   resolve 자격(요청 후 3분=180초)보다 넉넉히 짧게 둬, insert가 최대 ~60초 내 확정(성공/롤백/응답유실)되게 한다.
//   (per-statement timeout만으론 50행×29초 누적으로 3분 초과 가능 — 전체 데드라인 필요.)
const CHARGE_TX_DEADLINE_MS = 60_000;

/**
 * 충전 행 일괄 INSERT (단일 트랜잭션 — 부분 성공 차단). 반환 = 행별 SeqNo. 실패는 그대로 throw(라우트 분기).
 * 데드라인 초과 시 커넥션을 destroy(best-effort 정리) + chargeCommitUncertain 처리.
 * ★안전성의 근거는 destroy의 즉시성이 아니다: destroy(소켓 half-close)는 서버측 COMMIT을 즉시 취소한다고 보장하지
 *   않으므로, uncertain 건은 요청 후 3분 경과 뒤에만 resolve하도록 라우트가 강제한다(그 시점엔 60초 데드라인이
 *   지나 트랜잭션이 서버에서 확정). 정확한 성공/실패 판정은 그 3분 유예 + resolve의 게이트웨이 대조(findGatewayCharges)가
 *   담당한다 — 커밋됐으면 게이트웨이에 행이 보여 not_applied 거부, 롤백됐으면 안 보여 허용.
 */
export async function insertAgentCharges(charges: AgentChargeInput[]): Promise<Array<AgentChargeInput & { seqNo: number }>> {
  const pool = getPool();
  if (!pool) throw new Error('PAY_STATS_DB_NOT_CONFIGURED');

  const holder: { conn: mysql.PoolConnection | null } = { conn: null };
  let deadlineHit = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      deadlineHit = true;
      if (holder.conn) { try { holder.conn.destroy(); } catch { /* 이미 끊김 */ } } // best-effort 정리(즉시 롤백 보장 아님 — 안전성은 resolve의 3분 유예+대조가 담당)
      const e: any = new Error('CHARGE_TX_DEADLINE');
      e.chargeCommitUncertain = true; // 극히 드물게 데드라인 직전 커밋됐을 수 있음 → uncertain 보수 처리
      reject(e);
    }, CHARGE_TX_DEADLINE_MS);
  });

  const work = (async (): Promise<Array<AgentChargeInput & { seqNo: number }>> => {
    const c = await pool.getConnection();
    holder.conn = c;
    // 데드라인이 이미 지난 뒤 늦게 획득한 커넥션은 즉시 반납(누수 차단 — Codex 15R-2). 트랜잭션 미개시라 release 안전.
    if (deadlineHit) { try { c.release(); } catch { /* 이미 반납 */ } throw Object.assign(new Error('CHARGE_TX_DEADLINE'), { chargeCommitUncertain: true }); }
    await c.query({ sql: `SET SESSION max_statement_time=${CHARGE_STMT_TIMEOUT_MS / 1000}` });
    await c.query({ sql: 'START TRANSACTION', timeout: CHARGE_STMT_TIMEOUT_MS });
    const out: Array<AgentChargeInput & { seqNo: number }> = [];
    for (const ch of charges) {
      const [r] = await c.query(
        { sql: `INSERT INTO RSRM_FillAmtHist (StoreId, FillAmt, FillDtTm, PayMethod, RsApplyFlag) VALUES (?, ?, NOW(), '2', 'N')`, timeout: CHARGE_STMT_TIMEOUT_MS },
        [ch.agentSendId, ch.amount],
      );
      out.push({ ...ch, seqNo: Number((r as any).insertId) });
    }
    try {
      await c.query({ sql: 'COMMIT', timeout: CHARGE_STMT_TIMEOUT_MS });
    } catch (commitErr: any) {
      commitErr.chargeCommitUncertain = true; // 커밋 응답 유실 가능 — 예약 유지(Codex 8R-1a)
      throw commitErr;
    }
    return out;
  })();

  try {
    const out = await Promise.race([work, deadline]);
    if (timer) clearTimeout(timer);
    if (holder.conn) holder.conn.release();
    return out;
  } catch (err: any) {
    if (timer) clearTimeout(timer);
    const conn = holder.conn;
    if (err?.message === 'CHARGE_TX_DEADLINE') {
      // 커넥션은 타이머에서 destroy됨(또는 아직 미획득). work가 늦게 커넥션을 얻어도 다음 획득분은 풀이 회수.
      throw err;
    }
    // work 자체 에러 — 커밋 불확실이면 롤백 무의미(destroy), 아니면 롤백 후 반환
    if (conn) {
      if (err?.chargeCommitUncertain) {
        try { conn.destroy(); } catch { /* 이미 끊김 */ }
      } else {
        try {
          await conn.query({ sql: 'ROLLBACK', timeout: CHARGE_STMT_TIMEOUT_MS });
          conn.release();
        } catch {
          try { conn.destroy(); } catch { /* 이미 끊김 */ }
        }
      }
    }
    throw err;
  }
}

export interface AgentChargeStatusRow {
  seqNo: number;
  agentSendId: string;
  amount: number;
  filledAt: string;        // 'YYYY-MM-DD HH:mm:ss' (서버 로컬 = KST — MySQL NOW()와 동일 기준)
  filledAtMs: number | null; // 시간창 비교용 epoch ms — mysql2가 DATETIME을 Date 객체로 주므로 String() 파싱 금지(Codex 12R 실버그)
  applied: boolean; // RsApplyFlag === 'Y' — 이것만이 성공 신호
  appliedAt: string | null;
}

function dtToMs(v: any): number | null {
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v || '').replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

function fmtDt(v: any): string {
  const ms = dtToMs(v);
  if (ms === null) return String(v || '');
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * ★ 2026-07-24 Codex 12R — 자가복구 수용 판정(순수). 반환 = 수용할 행들(시간창 내 · 다중집합 일치) 또는 null.
 * MySQL 실행 행이 요청 created_at 기준 [-before, +after]분 창 안에 있고, (발송ID, 금액) 다중집합이 예약 charges와
 * 정확히 일치할 때만 수용 — 과거의 동일 (발송ID, 금액) SeqNo나 무관 행 주입으로 원장 연결을 오염시키는 경로 차단.
 */
export function matchHealWindow(
  charges: Array<{ agentSendId: string; amount: number }>,
  mysqlRows: AgentChargeStatusRow[],
  centerMs: number,
  beforeMin: number,
  afterMin: number,
): AgentChargeStatusRow[] | null {
  const inWindow = mysqlRows.filter((r) => {
    const t = r.filledAtMs;
    return t !== null && t >= centerMs - beforeMin * 60_000 && t <= centerMs + afterMin * 60_000;
  });
  const expect = charges.map((c) => `${String(c.agentSendId).trim()}|${Number(c.amount)}`).sort();
  const got = inWindow.map((r) => `${r.agentSendId}|${r.amount}`).sort();
  const matches = inWindow.length > 0 && inWindow.length === charges.length && expect.every((v, i) => v === got[i]);
  return matches ? inWindow : null;
}

export function toChargeRow(r: any): AgentChargeStatusRow {
  return {
    seqNo: Number(r.SeqNo),
    agentSendId: String(r.StoreId || ''),
    amount: Number(r.FillAmt) || 0,
    filledAt: fmtDt(r.FillDtTm),
    filledAtMs: dtToMs(r.FillDtTm),
    applied: String(r.RsApplyFlag || '').toUpperCase() === 'Y',
    appliedAt: r.RsApplyDtTm ? fmtDt(r.RsApplyDtTm) : null,
  };
}

/** SeqNo 목록의 반영 상태 조회 (프론트 폴링용) */
export async function getAgentChargeStatus(seqNos: number[]): Promise<AgentChargeStatusRow[]> {
  const pool = getPool();
  if (!pool || seqNos.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT SeqNo, StoreId, FillAmt, FillDtTm, RsApplyFlag, RsApplyDtTm FROM RSRM_FillAmtHist WHERE SeqNo IN (${seqNos.map(() => '?').join(',')})`,
    seqNos,
  );
  return (rows as any[]).map(toChargeRow);
}

/**
 * ★ 2026-07-24 Codex 11R — 게이트웨이 실행 대조: (발송ID, 금액) 조합이 기준 시각 ±window분 안에 실존하는지.
 * resolve(not_applied) 검증용 — 실반영된 충전을 미반영으로 지워 한도 회계를 왜곡하는 경로 차단.
 * MySQL 미설정 = throw(호출부 fail-closed — 대조 불가면 해소 보류).
 */
export async function findGatewayCharges(inputs: AgentChargeInput[], center: Date, windowMinutes: number): Promise<AgentChargeStatusRow[]> {
  const pool = getPool();
  if (!pool) throw new Error('PAY_STATS_DB_NOT_CONFIGURED');
  if (inputs.length === 0) return [];
  const conds = inputs.map(() => '(StoreId = ? AND FillAmt = ?)').join(' OR ');
  const params: any[] = [];
  inputs.forEach((i) => { params.push(i.agentSendId, i.amount); });
  params.push(new Date(center.getTime() - windowMinutes * 60_000), new Date(center.getTime() + windowMinutes * 60_000));
  const [rows] = await pool.query(
    `SELECT SeqNo, StoreId, FillAmt, FillDtTm, RsApplyFlag, RsApplyDtTm FROM RSRM_FillAmtHist WHERE (${conds}) AND FillDtTm BETWEEN ? AND ?`,
    params,
  );
  return (rows as any[]).map(toChargeRow);
}

export interface AgentChargeListFilter {
  limit?: number;
  /** 건너뛸 행 수(페이징) */
  offset?: number;
  /** 발송ID 정확 일치 (화면 검색은 프론트 셀렉트에서 고른 값이라 정확 일치로 충분) */
  agentSendId?: string;
  /** YYYY-MM-DD (그날 00:00:00부터) */
  startDate?: string;
  /** YYYY-MM-DD (그날 23:59:59까지) */
  endDate?: string;
}

/** (순수) 필터 → WHERE 조각. 목록·건수가 **같은 조건**을 쓰도록 한 곳에서 만든다. */
function buildChargeFilterSql(f: AgentChargeListFilter): { where: string; params: any[] } {
  const conds: string[] = [];
  const params: any[] = [];
  const sendId = String(f.agentSendId || '').trim();
  if (sendId) { conds.push('StoreId = ?'); params.push(sendId); }
  if (f.startDate && DATE_ONLY.test(String(f.startDate))) { conds.push('FillDtTm >= ?'); params.push(`${f.startDate} 00:00:00`); }
  if (f.endDate && DATE_ONLY.test(String(f.endDate))) { conds.push('FillDtTm <= ?'); params.push(`${f.endDate} 23:59:59`); }
  return { where: conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '', params };
}

/**
 * 원장 전체의 최신 충전 시각 — **유입이 멈췄는지 드러내는 값.** (★ 2026-07-26)
 *
 * 62 `pay-ingest-db`는 강문희가 push하는 수신 DB다. 통계(`RSRM_SalesStts`)는 실시간으로 들어오지만
 * 충전 원장이 함께 오는지는 별개다 — 2026-07-26 실측에서 **0707 dump 이후 게이트웨이 충전 유입이 0**이었다.
 * 그동안 화면은 멈춘 데이터를 최신인 양 보여줬고, 통장과 직접 대조하기 전까지 아무도 몰랐다.
 * 필터와 무관하게 원장 전체를 본다 — "이 조건에 없다"가 아니라 "원장 자체가 멈췄다"를 알려야 한다.
 */
export async function latestAgentChargeAt(): Promise<string | null> {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(`SELECT MAX(FillDtTm) AS latest FROM RSRM_FillAmtHist`);
  const v = (rows as any[])[0]?.latest;
  return v ? String(v) : null;
}

/** 필터에 걸리는 전체 충전 건수 — 페이징 표시용. 목록과 **같은 조건**을 쓴다. */
export async function countAgentCharges(filter: AgentChargeListFilter = {}): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const { where, params } = buildChargeFilterSql(filter || {});
  const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM RSRM_FillAmtHist ${where}`, params);
  return Number((rows as any[])[0]?.cnt) || 0;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 충전 이력 (표시용 — 최신순). (★ 2026-07-26 발송ID·기간 필터 추가)
 *
 * 게이트웨이 원장을 조회만 한다(복제 저장 없음). 날짜는 형식을 검증한 값만 바인딩한다 —
 * 형식이 어긋난 값은 조건 자체를 걸지 않는다(전체 조회로 떨어질 뿐 잘못된 구간을 만들지 않는다).
 */
export async function listAgentCharges(filter: number | AgentChargeListFilter = {}): Promise<AgentChargeStatusRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const f: AgentChargeListFilter = typeof filter === 'number' ? { limit: filter } : (filter || {});
  const lim = Math.min(Math.max(Math.floor(Number(f.limit)) || 30, 1), 200);
  const off = Math.max(Math.floor(Number(f.offset)) || 0, 0);
  const { where, params } = buildChargeFilterSql(f);

  // SeqNo는 채번 유일값이라 정렬이 결정적이다 — LIMIT/OFFSET 청크에 tie-breaker가 따로 필요 없다(D150-4).
  const [rows] = await pool.query(
    `SELECT SeqNo, StoreId, FillAmt, FillDtTm, RsApplyFlag, RsApplyDtTm FROM RSRM_FillAmtHist ${where} ORDER BY SeqNo DESC LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  return (rows as any[]).map(toChargeRow);
}

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
