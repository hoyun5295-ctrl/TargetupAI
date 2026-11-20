/**
 * agent-fill-balance.ts — 충전 내역 「반영 뒤 잔액」 기록 일꾼 (★ 2026-11-20 C147)
 * 설계서 = docs/2026-11-20-c147-agent-charge-balance-after-design.md(Codex 설계 11R approve)
 *
 * 62 충전 원장(RSRM_FillAmtHist)에는 줄마다 반영 뒤 잔액이 없다(실측). 이 일꾼이 30초마다 원장 전체와 지금 잔액을 읽어,
 * 반영을 확인한 순간의 잔액을 한줄로 PG(agent_fill_balance_marks)에 남긴다. 고객사 「충전 요청 → 충전 내역」 반영 칸이 읽는다.
 *
 * ⛔ 돈의 진실이 아니다(잔액 = 62 · 이 표 = 그 순간 읽은 값의 기록). 62 는 읽기만 한다. 발송 · 차감 · 잔액 무접촉.
 * ⛔ 근거가 모자라면 빈 값(틀린 잔액보다 빈 칸) — 증거(앞 · 뒤 잔액이 금액 절반 이상 같은 방향) · 이웃 없음 · 연속 관측 30분일 때만 captured.
 */
import type { PoolClient, QueryConfig, QueryResult } from 'pg';
import { query, pool } from '../config/database';
import { isPayStatsConfigured, openPayStatsConnection, closePayStatsConnection, readFillLedgerAll, queryLedgerBalancesByIds, type FillLedgerRow } from './pay-stats';

const LOG = '[agent-fill-balance]';
export const FILL_BALANCE_TICK_MS = 30_000;
const MYSQL_TIMEOUT_MS = 10_000;          // 62 질의마다(P2)
const CAPTURE_DEADLINE_MS = 20_000;       // 회차 시작부터 이만큼 지나면 captured 만 버린다(관측은 쓴다 · P2 5)
const NEIGHBOR_WINDOW_MS = 30 * 60_000;   // 이웃 ③ · §7 가정 ① 62 잔액 반영 지연 < 30분
const CONTINUOUS_MS = 30 * 60_000;        // 연속 관측 30분(P2 5)
const LOCK_KEY = 'agent-fill-balance';    // 프로세스 사이 회차 잠금(구현 1R #2)
const PG_TIMEOUT_MS = 10_000;             // 회차 연결의 PG 질의마다(구현 2R)

export type FillMarkState = 'pending' | 'applied' | 'captured' | 'skipped';
export type FillSkipReason = 'missed' | 'gap' | 'multi' | 'no_evidence' | 'gone';

/** PG 기록 한 줄(판정에 쓰는 칸) · 시각 = ms */
export interface FillMark {
  seqNo: number;
  agentSendId: string;
  amount: number;
  state: FillMarkState;
  lastPendingAt: number | null;
  balanceBefore: number | null;
  appliedSeenAt: number | null;
}

export interface FillMarkInsert {
  seqNo: number;
  agentSendId: string;
  amount: number;
  state: 'pending' | 'skipped';
  pendingAt: number | null;       // pending_seen_at = last_pending_at
  balanceBefore: number | null;
  appliedSeenAt: number | null;
  skipReason: FillSkipReason | null;
}

export interface FillMarkUpdate {
  seqNo: number;
  agentSendId: string;
  /** 판정이 본 상태 · 시각 — 같을 때만 바꾼다(두 회차가 겹쳐도 앞 상태를 덮지 않음 · P2 4) */
  expect: { state: FillMarkState; lastPendingAt: number | null; appliedSeenAt: number | null };
  next: { state: FillMarkState; lastPendingAt: number | null; balanceBefore: number | null; appliedSeenAt: number | null; balanceAfter: number | null; skipReason: FillSkipReason | null };
}

export interface FillPlanInput {
  r1: FillLedgerRow[];
  r2: FillLedgerRow[];
  /** 발송ID(대문자 축) → R1 · R2 사이에 읽은 지금 잔액(모름 = null · 없는 키 = 모름) */
  balances: Map<string, number | null>;
  marks: FillMark[];
  /** 반영 대기(N) 관측 시각 = R1 읽기 직전(이른 쪽) · 반영(Y) 관측 · 만료 판정 시각 = R2 읽은 뒤(늦은 쪽) — 늘 빈 값 쪽(9R #2) */
  r1Ms: number;
  r2Ms: number;
  tickMs: number;
  /** 회차 20초 마감 안 */
  captureOpen: boolean;
  /** 연속 관측 시작 S(메모리) · null = 실패 · 건너뜀 · 재시작 뒤 아직 관측을 끝까지 커밋하지 못함 = captured 0 */
  continuousSince: number | null;
}

export const fillMarkKey = (seqNo: number, agentSendId: string): string => `${seqNo}|${String(agentSendId ?? '').trim()}`;
const groupOf = (agentSendId: string): string => String(agentSendId ?? '').trim().toUpperCase();
const isOpen = (s: FillMarkState): boolean => s === 'pending' || s === 'applied';

/** 증거 판정(P2 3) — 충전 = 뒤 − 앞 ≥ F/2 · 차감 = 뒤 − 앞 ≤ F/2 · 값 하나라도 모르면 증거 없음 */
export function hasFillEvidence(amount: number, before: number | null, after: number | null): boolean {
  if (before === null || after === null || !Number.isFinite(before) || !Number.isFinite(after) || !Number.isFinite(amount)) return false;
  const d = after - before;
  if (amount > 0) return d >= amount / 2;
  if (amount < 0) return d <= amount / 2;
  return false;
}

/** 발송ID 마다 원장 줄 상태 한 줄(SeqNo · 금액 · 반영 표시) — R1 · R2 가 다르면 그 회차 그 발송ID captured 0(1R #2) */
function groupSignatures(rows: FillLedgerRow[]): Map<string, string> {
  const parts = new Map<string, string[]>();
  for (const r of rows) {
    const g = groupOf(r.agentSendId);
    const arr = parts.get(g) || [];
    arr.push(`${r.seqNo}:${r.agentSendId}:${r.amount}:${r.applied ? 'Y' : 'N'}`);
    parts.set(g, arr);
  }
  return new Map([...parts].map(([g, a]) => [g, a.sort().join(',')]));
}

/**
 * 순수 판정(설계서 P2 3 · 시험 대상) — 시계 = 이 일꾼의 관측 시각만(중계 시계 RsApplyDtTm 은 쓰지 않는다).
 * 관측은 R1 ∪ R2 에서 본 것 전부 남긴다(7R) · 잔액 기록(captured)은 이웃 0 · 연속 관측 · 증거가 모두 있을 때만.
 */
export function planFillMarks(input: FillPlanInput): { inserts: FillMarkInsert[]; updates: FillMarkUpdate[] } {
  const { r1, r2, balances, marks, r1Ms, r2Ms, tickMs, captureOpen, continuousSince } = input;
  const inserts: FillMarkInsert[] = [];
  const updates: FillMarkUpdate[] = [];

  const r1Map = new Map(r1.map((r) => [fillMarkKey(r.seqNo, r.agentSendId), r]));
  const r2Map = new Map(r2.map((r) => [fillMarkKey(r.seqNo, r.agentSendId), r]));
  const markMap = new Map(marks.map((m) => [fillMarkKey(m.seqNo, m.agentSendId), m]));

  // 이웃 재료 — 발송ID 별 줄 키 · R1 또는 R2 에서 반영 대기로 본 줄(①) · 반영으로 본 줄(④ 재료)
  const members = new Map<string, Set<string>>();
  const addMember = (g: string, k: string) => { const s = members.get(g) || new Set<string>(); s.add(k); members.set(g, s); };
  const nSeen = new Set<string>();
  const ySeen = new Set<string>();
  for (const [k, r] of [...r1Map, ...r2Map]) {
    addMember(groupOf(r.agentSendId), k);
    (r.applied ? ySeen : nSeen).add(k);
  }
  for (const [k, m] of markMap) addMember(groupOf(m.agentSendId), k);

  const sig1 = groupSignatures(r1);
  const sig2 = groupSignatures(r2);
  const mismatched = (g: string): boolean => (sig1.get(g) ?? '') !== (sig2.get(g) ?? '');

  const balanceOf = (agentSendId: string): number | null => {
    const v = balances.get(groupOf(agentSendId));
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  /** 이웃 = 잔액을 아직 바꿀 수 있는 같은 발송ID 의 다른 줄(P2 3 ①②③④) */
  const hasNeighbor = (key: string, c: FillMark): boolean => {
    const from = c.lastPendingAt === null ? -Infinity : c.lastPendingAt - NEIGHBOR_WINDOW_MS;
    for (const k of members.get(groupOf(c.agentSendId)) || []) {
      if (k === key) continue;
      const mk = markMap.get(k);
      if (nSeen.has(k)) return true;                                                // ① 62 에서 아직 반영 안 된 줄
      if (mk && isOpen(mk.state)) return true;                                     // ② PG 열린 기록
      if (mk && mk.appliedSeenAt !== null && mk.appliedSeenAt >= from) return true; // ③ 반영을 처음 본 지 30분 안(상태 무관)
      if (!mk && ySeen.has(k)) return true;                                        // ④ 이번 회차에 처음 반영으로 보임(기록 없음 · pending 에서 바뀜 = ②)
    }
    return false;
  };

  const update = (m: FillMark, next: Partial<FillMarkUpdate['next']>) => {
    updates.push({
      seqNo: m.seqNo,
      agentSendId: m.agentSendId,
      expect: { state: m.state, lastPendingAt: m.lastPendingAt, appliedSeenAt: m.appliedSeenAt },
      next: { state: m.state, lastPendingAt: m.lastPendingAt, balanceBefore: m.balanceBefore, appliedSeenAt: m.appliedSeenAt, balanceAfter: null, skipReason: null, ...next },
    });
  };

  /** 반영을 본 열린 기록(applied · 또는 이번 회차 pending → applied) 판정 */
  const judge = (key: string, m: FillMark, current: FillLedgerRow, appliedSeenAt: number, transitioned: boolean) => {
    const skip = (reason: FillSkipReason) => update(m, { state: 'skipped', appliedSeenAt, skipReason: reason });
    if (hasNeighbor(key, m)) return skip('multi');
    // 처음 기록한 금액과 지금 원장 금액이 다르면 증거 판정의 금액을 믿을 수 없다(구현 1R #1 · 원 단위 소수 셋째 자리까지 비교)
    if (Math.round(m.amount * 1000) !== Math.round(current.amount * 1000)) return skip('no_evidence');
    // 앞 잔액 관측이 연속 관측 시작 + 30분 이후일 때만(9R #1 · 10R) — S 없음 = captured 0
    if (continuousSince === null || m.lastPendingAt === null || m.lastPendingAt < continuousSince + CONTINUOUS_MS) return skip('no_evidence');
    const after = balanceOf(m.agentSendId);
    if (captureOpen && !mismatched(groupOf(m.agentSendId)) && hasFillEvidence(m.amount, m.balanceBefore, after)) {
      return update(m, { state: 'captured', appliedSeenAt, balanceAfter: after });
    }
    if (transitioned) update(m, { state: 'applied', appliedSeenAt }); // 증거 없음 · 이번 회차 쓰기 막힘 = applied 로 두고 다음 회차 다시
  };

  const keys = new Set<string>([...r1Map.keys(), ...r2Map.keys(), ...markMap.keys()]);
  for (const key of keys) {
    const m = markMap.get(key);
    const eff = r2Map.get(key) ?? r1Map.get(key); // 마지막으로 본 상태

    if (!eff) {
      // 원장에서 사라진 열린 기록 = gone · 사라짐을 본 시각에 반영됐을 수 있다 → 이웃 ③ 으로 30분(7R)
      if (m && isOpen(m.state)) update(m, { state: 'skipped', skipReason: 'gone', appliedSeenAt: m.appliedSeenAt ?? r2Ms });
      continue;
    }

    if (!eff.applied) {
      const before = balanceOf(eff.agentSendId);
      if (!m) {
        inserts.push({ seqNo: eff.seqNo, agentSendId: eff.agentSendId, amount: eff.amount, state: 'pending', pendingAt: r1Ms, balanceBefore: before, appliedSeenAt: null, skipReason: null });
      } else if (m.state === 'pending') {
        update(m, { lastPendingAt: r1Ms, balanceBefore: before }); // 반영 직전 값으로 계속 당김(모르면 비움)
      } else if (m.state === 'applied') {
        update(m, { state: 'skipped', skipReason: 'no_evidence' }); // 반영을 본 뒤 다시 대기 = 근거 없음
      }
      continue;
    }

    // 반영(Y)
    if (!m) {
      // 반영 대기를 본 적 없음 = 앞 값 없음 · 반영을 처음 본 시각은 상태와 무관하게 남긴다(이웃 ③ 근거)
      inserts.push({ seqNo: eff.seqNo, agentSendId: eff.agentSendId, amount: eff.amount, state: 'skipped', pendingAt: null, balanceBefore: null, appliedSeenAt: r2Ms, skipReason: 'missed' });
    } else if (m.state === 'pending') {
      if (m.lastPendingAt === null || r2Ms - m.lastPendingAt > 2 * tickMs) {
        update(m, { state: 'skipped', skipReason: 'gap', appliedSeenAt: r2Ms }); // 일꾼이 멈췄거나 건너뛴 사이에 반영(1R #1)
      } else {
        judge(key, m, eff, r2Ms, true);
      }
    } else if (m.state === 'applied') {
      if (m.appliedSeenAt === null || r2Ms - m.appliedSeenAt > 2 * tickMs) {
        update(m, { state: 'skipped', skipReason: 'no_evidence' });
      } else {
        judge(key, m, eff, m.appliedSeenAt, false);
      }
    }
  }
  return { inserts, updates };
}

// ── 일꾼 ─────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;
let running = false;
let continuousSince: number | null = null;  // 연속 관측 시작 S(메모리 · 재시작 = 없음)
let lastCommitMs: number | null = null;
let lastError: string | null = null;

/** 시험 전용 — 메모리 상태(S) 초기화 */
export function resetFillBalanceWorkerState(): void {
  running = false;
  continuousSince = null;
  lastCommitMs = null;
  lastError = null;
}

const tsOrNull = (v: any): number | null => (v === null || v === undefined ? null : new Date(v).getTime());
const numOrNull = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** 회차 연결의 질의 실행기 — 모든 질의에 시간 제한(구현 2R · 응답 없는 질의가 회차를 영영 붙잡지 않게) */
export type FillRun = (text: string, values?: any[]) => Promise<QueryResult>;

async function readMarks(run: FillRun): Promise<FillMark[]> {
  const r = await run(
    `SELECT seq_no, agent_send_id, fill_amount, state, last_pending_at, balance_before, applied_seen_at FROM agent_fill_balance_marks`,
  );
  return r.rows.map((x: any) => ({
    seqNo: Number(x.seq_no),
    agentSendId: String(x.agent_send_id),
    amount: Number(x.fill_amount),
    state: x.state as FillMarkState,
    lastPendingAt: tsOrNull(x.last_pending_at),
    balanceBefore: numOrNull(x.balance_before),
    appliedSeenAt: tsOrNull(x.applied_seen_at),
  }));
}

/** 판정 결과 쓰기 — 부르는 쪽 트랜잭션 안에서(회차 = 트랜잭션 하나) */
export async function writeFillPlan(run: FillRun, plan: { inserts: FillMarkInsert[]; updates: FillMarkUpdate[] }): Promise<void> {
  if (plan.inserts.length > 0) {
    const col = <T>(f: (i: FillMarkInsert) => T) => plan.inserts.map(f);
    await run(
      `INSERT INTO agent_fill_balance_marks
         (seq_no, agent_send_id, fill_amount, state, pending_seen_at, last_pending_at, balance_before, applied_seen_at, skip_reason)
       SELECT * FROM unnest($1::int[], $2::text[], $3::numeric[], $4::varchar[], $5::timestamptz[], $5::timestamptz[], $6::numeric[], $7::timestamptz[], $8::varchar[])
       ON CONFLICT (seq_no, agent_send_id) DO NOTHING`,
      [col((i) => i.seqNo), col((i) => i.agentSendId), col((i) => i.amount), col((i) => i.state),
        col((i) => iso(i.pendingAt)), col((i) => i.balanceBefore), col((i) => iso(i.appliedSeenAt)), col((i) => i.skipReason)],
    );
  }
  for (const u of plan.updates) {
    await run(
      `UPDATE agent_fill_balance_marks
          SET state = $3::varchar, last_pending_at = $4::timestamptz, balance_before = $5::numeric, applied_seen_at = $6::timestamptz,
              balance_after = $7::numeric, skip_reason = $8::varchar,
              captured_at = CASE WHEN $3::varchar = 'captured' THEN now() ELSE captured_at END
        WHERE seq_no = $1 AND agent_send_id = $2 AND state = $9::varchar
          AND last_pending_at IS NOT DISTINCT FROM $10::timestamptz AND applied_seen_at IS NOT DISTINCT FROM $11::timestamptz`,
      [u.seqNo, u.agentSendId, u.next.state, iso(u.next.lastPendingAt), u.next.balanceBefore, iso(u.next.appliedSeenAt),
        u.next.balanceAfter, u.next.skipReason, u.expect.state, iso(u.expect.lastPendingAt), iso(u.expect.appliedSeenAt)],
    );
  }
}

/**
 * 한 회차(설계서 P2) — now 는 시험에서 시계를 넘기려고 받는다.
 * ★ 구현 1R #2 · 2R = 회차 전체(PG 기록 읽기 · 62 읽기 · 판정 · 쓰기)가 연결 하나 · 트랜잭션 하나 · 트랜잭션 잠금(pg_try_advisory_xact_lock).
 *   이웃 판정은 다른 줄의 기록에 기대므로 다른 프로세스(PM2 reload 겹침)의 회차와 섞이면 안 된다 → 못 잡으면 건너뜀(이 프로세스 관측 끊김 = S 비움).
 *   모든 PG 질의에 시간 제한 · 오류 · 시간 초과 = 연결을 버린다(열린 트랜잭션 · 잠금은 서버가 되돌린다 = 늦게 끝난 질의도 커밋되지 않는다).
 *   트랜잭션이 62 읽기(질의마다 10초 제한) 동안 열려 있다 — 잡는 것은 이 일꾼 키 잠금 하나 · 표 줄 잠금은 끝의 쓰기에서만.
 */
export async function fillBalanceTick(now: () => number = Date.now): Promise<void> {
  if (running) { continuousSince = null; return; } // 겹침 = 건너뜀 = 연속 관측 끊김
  running = true;
  const startMs = now();
  let client: PoolClient | null = null;
  let broken = false;
  // 체크아웃한 PG 연결은 풀의 오류 리스너가 떨어져 있다 → 62 읽기 동안 끊기면 'error' 가 프로세스를 죽인다(구현 3R #1) → 듣고 회차 실패로(다음 PG 질의가 실패 · 연결 버림)
  const onPgError = () => { broken = true; };
  let payConn: Awaited<ReturnType<typeof openPayStatsConnection>> | null = null;
  try {
    if (!isPayStatsConfigured()) { continuousSince = null; return; }
    client = await pool.connect();
    client.on('error', onPgError);
    const c = client;
    // query_timeout = pg 8 질의별 읽기 시간 제한(@types/pg QueryConfig 에 칸이 없어 단언)
    const run: FillRun = (text, values) => c.query({ text, values, query_timeout: PG_TIMEOUT_MS } as QueryConfig);
    await run('BEGIN');
    if (!(await run(`SELECT pg_try_advisory_xact_lock(hashtext($1::text)) AS ok`, [LOCK_KEY])).rows[0]?.ok) {
      await run('ROLLBACK');
      continuousSince = null;
      return;
    }
    // 지난 커밋에서 2 회차 넘게 지났으면(멈춤 · 지연) 연속 관측이 끊긴 것 = 이번 커밋이 새 S
    if (lastCommitMs === null || startMs - lastCommitMs > 2 * FILL_BALANCE_TICK_MS) continuousSince = null;

    const marks = await readMarks(run); // 표 없음(DDL 전) = 던짐 → 조용히
    const r1Ms = now();
    payConn = await openPayStatsConnection(MYSQL_TIMEOUT_MS); // 회차 제 연결(공용 풀 무접촉 · 구현 3R #2)
    const r1 = await readFillLedgerAll(payConn, MYSQL_TIMEOUT_MS);
    const ids = new Map<string, string>();
    for (const r of r1) if (!r.applied) ids.set(groupOf(r.agentSendId), r.agentSendId);
    for (const m of marks) if (isOpen(m.state)) ids.set(groupOf(m.agentSendId), m.agentSendId);
    const picked = ids.size > 0 ? await queryLedgerBalancesByIds([...ids.values()], { timeoutMs: MYSQL_TIMEOUT_MS, conn: payConn }) : [];
    const balances = new Map<string, number | null>(picked.map((p) => [groupOf(p.agent_send_id), p.rem_amt]));
    const r2 = await readFillLedgerAll(payConn, MYSQL_TIMEOUT_MS);
    const r2Ms = now();

    const plan = planFillMarks({
      r1, r2, balances, marks, r1Ms, r2Ms,
      tickMs: FILL_BALANCE_TICK_MS,
      captureOpen: r2Ms - startMs <= CAPTURE_DEADLINE_MS,
      continuousSince,
    });
    await writeFillPlan(run, plan);
    await run('COMMIT');
    const commitMs = now();
    if (continuousSince === null) continuousSince = commitMs; // 실패 · 건너뜀 · 재시작 뒤 처음으로 관측을 끝까지 커밋한 시각(10R)
    lastCommitMs = commitMs;
    if (lastError) { console.log(`${LOG} 다시 이어짐`); lastError = null; }
  } catch (err: any) {
    broken = true;
    continuousSince = null;
    const msg = String(err?.message || err);
    if (msg.includes('agent_fill_balance_marks') && msg.includes('does not exist')) {
      if (lastError !== 'no_table') console.log(`${LOG} 표 없음(DDL 전) — 건너뜀`);
      lastError = 'no_table';
      return;
    }
    if (lastError !== msg) console.error(`${LOG} 회차 실패(다음 회차 다시 · 같은 오류는 한 번만 남김):`, msg);
    lastError = msg;
  } finally {
    if (payConn) closePayStatsConnection(payConn); // 늘 버림 · 소켓까지(늦은 응답 · 반납 대기 0 · 구현 4R)
    if (client) {
      client.removeListener('error', onPgError);
      client.release(broken ? true : undefined); // 오류 · 시간 초과 · 끊김 = 연결을 버림(서버가 트랜잭션 · 잠금을 되돌림)
    }
    running = false;
  }
}

export function startAgentFillBalanceWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void fillBalanceTick(); }, FILL_BALANCE_TICK_MS);
  console.log(`${LOG} 기동 (${FILL_BALANCE_TICK_MS / 1000}초 주기)`);
}

/**
 * 충전 내역 줄의 반영 뒤 잔액(captured 만) — 키 = fillMarkKey.
 * 표가 없거나 읽기 실패 = 빈 Map(목록을 막지 않는다 = 반영 칸 지금 그대로 · P3).
 */
export async function loadFillBalances(rows: Array<{ seqNo: number; agentSendId: string }>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const seqs = [...new Set(rows.map((r) => Number(r.seqNo)).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (seqs.length === 0) return out;
  try {
    const r = await query(
      `SELECT seq_no, agent_send_id, balance_after FROM agent_fill_balance_marks WHERE state = 'captured' AND seq_no = ANY($1::int[])`,
      [seqs],
    );
    for (const x of r.rows) {
      const v = Number(x.balance_after);
      if (x.balance_after !== null && Number.isFinite(v)) out.set(fillMarkKey(Number(x.seq_no), x.agent_send_id), v);
    }
  } catch (err: any) {
    console.error(`${LOG} 반영 뒤 잔액 읽기 실패(빈 칸으로 둠):`, err?.message || err);
  }
  return out;
}
