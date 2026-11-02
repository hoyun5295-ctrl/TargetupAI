/**
 * utils/ai-credit-month.ts — 크레딧 월 권리 · 월 마감 계산(★ 2026-11-01 크레딧 컨트롤타워 · 설계서 docs/2026-11-01-credit-control-tower-design.md §5 4판)
 *
 * 순수 계산(DB 모름)과 그 계산에 넣을 값을 읽는 함수(`loadMonthEntitlement` · `monthCredits`)를 둔다.
 * 잔액 칸 · 원장 쓰기는 여기 없다(쓰기 = ai-credit-tx.ts · 뿌리 대장 R38).
 *
 *  - E(M) = round(Σ 날짜별 월분 ÷ 그 달 일수) 한 번(I5). 날짜의 요금제 = 그 날 이전 마지막 이력의 to_plan ·
 *    첫 이력 전 날짜 = 첫 이력의 from_plan(없으면 0) · 이력이 하나도 없으면 지금 요금제. TRIAL 날 = 0(체험 크레딧은 따로).
 *  - 월 마감 = 한 달씩(I10): 후불 맞춤 U = max(0, −b) − R → 소멸(후불 음수 정리 · 양수 소멸 · 경계가 체험이면 양수 남김 · 선불 음수 넘김) → 다음 달 E 지급.
 */
import { daysInMonth } from './plan-proration';
import { isTrialOver } from './ai-credit-calc';

/** KST 기준 'YYYY-MM' */
export function monthKeyOf(d: Date): string {
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' 에 n 달을 더한다 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' → 'YYYY-MM-DD' 말일 */
export function monthLastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

/** 'YYYY-MM' → 리셋 · 소멸 키에 쓰는 'YYYYMM'(옛 리셋 키 `reset:회사:YYYYMM` 과 같은 꼴) */
export function monthTag(month: string): string {
  return month.replace('-', '');
}

export interface PlanChangeLite {
  /** 'YYYY-MM-DD'(DATE 칸은 to_char 로 읽는다) */
  effective_date: string;
  from_plan_code: string | null;
  to_plan_code: string;
}

/** (순수) 그 날의 요금제 코드 — 이력은 effective_date · changed_at 오름차순(같은 날 = 나중 기록이 이긴다) */
export function planCodeOfDay(changes: PlanChangeLite[], day: string, currentPlanCode: string | null): string | null {
  if (changes.length === 0) return currentPlanCode;
  let found: string | null | undefined;
  for (const c of changes) {
    if (c.effective_date <= day) found = c.to_plan_code;
    else break;
  }
  return found === undefined ? changes[0].from_plan_code : found;
}

/** (순수) 그 달 권리 E(M) — 한 번 반올림(I5) */
export function monthEntitlementFrom(o: {
  month: string;
  changes: PlanChangeLite[];
  creditsOf: (planCode: string) => number;
  currentPlanCode: string | null;
}): number {
  const [y, m] = o.month.split('-').map(Number);
  const days = daysInMonth(y, m);
  let sum = 0;
  for (let d = 1; d <= days; d++) {
    const code = planCodeOfDay(o.changes, `${o.month}-${String(d).padStart(2, '0')}`, o.currentPlanCode);
    if (!code || code === 'TRIAL') continue;
    sum += Math.max(0, Number(o.creditsOf(code)) || 0);
  }
  return Math.round(sum / days);
}

/** (순수) 그 달 말일의 요금제가 체험인가(C3 · 달 경계 체험 잔액 남김) */
export function trialAtMonthEnd(changes: PlanChangeLite[], month: string, currentPlanCode: string | null): boolean {
  return planCodeOfDay(changes, monthLastDay(month), currentPlanCode) === 'TRIAL';
}

export interface CloseMonthInfo {
  /** 마감하는 달 'YYYY-MM' */
  month: string;
  /** 그 달 말일 요금제가 TRIAL */
  trialAtEnd: boolean;
  /** 다음 달 E */
  nextEntitlement: number;
  /** 그 주기에 차감 행으로 적힌 초과분 합 R(청구된 것 포함 · 후불만 의미) */
  overageRecorded: number;
}

export interface CloseStep {
  month: string;
  /** 후불 맞춤 U(> 0 = 맞춤 줄 · < 0 = 미청구 초과 줄임 · 선불 0) */
  settle: number;
  /** 소멸 · 정리 변동(부호 있음 · 0 = 줄 없음) */
  expire: number;
  /** 다음 달 지급 */
  grant: number;
}

/** (순수) 한 달씩 마감 — 기본분만 다룬다(구매분은 마감이 안 바꾼다) */
export function simulateClose(o: { base: number; billingType: string; months: CloseMonthInfo[] }): { steps: CloseStep[]; base: number } {
  const postpaid = billedMonthly(o.billingType);
  let b = Number(o.base) || 0;
  const steps: CloseStep[] = [];
  for (const mi of o.months) {
    const settle = postpaid ? Math.max(0, -b) - (Number(mi.overageRecorded) || 0) : 0;
    let expire = 0;
    if (b < 0 && postpaid) expire = -b;                   // 후불 음수 = 맞춤으로 청구에 넘겼다
    else if (b > 0 && !mi.trialAtEnd) expire = -b;        // 남은 양수 기본분 소멸(경계가 체험이면 남김)
    b += expire;
    const grant = Math.max(0, Number(mi.nextEntitlement) || 0);
    b += grant;
    steps.push({ month: mi.month, settle, expire, grant });
  }
  return { steps, base: b };
}

/** (순수) 마감할 달 목록 = 리셋 시각의 달부터 지금 달 직전까지(리셋 시각 NULL = 첫 지급이라 없음) */
export function monthsToClose(resetAt: Date | null, now: Date): string[] {
  if (!resetAt) return [];
  const cur = monthKeyOf(now);
  const out: string[] = [];
  for (let m = monthKeyOf(resetAt); m < cur; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** (순수) 'YYYY-MM-DD' 이 그 달 1일 ~ 오늘 안인가(C4 적용일 검사) */
export function isEffectiveDateInCurrentMonth(effectiveDate: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && effectiveDate <= today && effectiveDate >= `${today.slice(0, 7)}-01`;
}

/**
 * (순수) 월 정산서로 청구되는 회사인가 = 선불이 아닌 회사 전부(빈 값 포함 · billing-issue 는 선불만 막는다 · 칸 기본값 postpaid · CHECK 없음).
 *   음수 기본분 = 청구될 부채라 월 마감이 다음 달로 넘기지 않고 맞춤 · 정리한다. 월 마감 · 미리 계산 · 환불이 이것 하나로 읽는다.
 */
export function billedMonthly(billingType: unknown): boolean {
  return String(billingType ?? '') !== 'prepaid';
}


// ════════════════════════════════════════════════════════════
// 읽기 — 계산에 넣을 값(잔액 · 원장 쓰기 0 · 그 달 월분 고정표 넣기만 · C10)
// ════════════════════════════════════════════════════════════

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * 시각 칸을 µs 까지 글자로(UTC ISO · 같은 꼴끼리 글자 비교 = 시각 비교). JS Date 는 ms 라 받아서 다시 넘기면 µs 가 잘려
 *   같은 ms 안 줄(주기 시작 + 1µs · 한 거래의 같은 NOW())의 앞뒤가 id 순으로 흔들린다(★ 2026-11-01 Codex 구현 2R 변이에서 드러남).
 */
export const TS_US_SQL = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * 새 원장 줄의 순번 = 언제나 이 값(★ 2026-11-01 C9 · Codex 구현 5R 구조 처방). seq 칸은 기본값 없이 배포 **앞에** 넣는다(C90-DDL-1):
 *   옛 코드는 칸을 모르니 옛 코드 줄 = seq 없음(= 옛 행) · 새 코드 줄은 INSERT 마다 이 값을 넣어 회사 잠금 아래 쓴 순서를 갖는다.
 *   순서(직전 줄 · 주기 안 · 대조)는 seq 가 맡고, 줄 시각은 청구 달만 맡는다(seq 없는 새 줄이 없으니 시각으로 순서를 흉내 낼 일이 없다).
 */
export const LEDGER_SEQ_SQL = `nextval('ai_credit_tx_seq')`;

/** 칸 · 표 준비 확인(배포 → DDL 순서 · 참은 기억 · 거짓은 5분 뒤 다시 · journey-lineage 와 같은 규약) */
function schemaProbe(sql: string): (db: Db) => Promise<boolean> {
  let ready = false;
  let absentUntil = 0;
  return async (db: Db) => {
    if (ready) return true;
    if (Date.now() < absentUntil) return false;
    const r = await db.query(sql);
    const ok = r.rows[0]?.ok === true;
    if (ok) ready = true;
    else absentUntil = Date.now() + 5 * 60 * 1000;
    return ok;
  };
}
/** 원장 순번 칸(seq · §7 DDL) */
export const creditSeqReady = schemaProbe(
  `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_credit_transactions' AND column_name = 'seq') AS ok`,
);
/** 그 달 월분 고정표(plan_month_credits · §7 DDL) */
export const planMonthCreditsReady = schemaProbe(`SELECT to_regclass('public.plan_month_credits') IS NOT NULL AS ok`);

/** 그 회사 요금제 이력(그 날까지 · effective_date · changed_at 오름차순) */
export async function loadPlanChangesLite(db: Db, companyId: string, uptoDay: string): Promise<PlanChangeLite[]> {
  const r = await db.query(
    `SELECT to_char(effective_date, 'YYYY-MM-DD') AS effective_date, from_plan_code, to_plan_code
       FROM company_plan_changes
      WHERE company_id = $1::uuid AND effective_date <= $2::date
      ORDER BY effective_date ASC, changed_at ASC`,
    [companyId, uptoDay],
  );
  return r.rows.map((x: any) => ({ effective_date: String(x.effective_date), from_plan_code: x.from_plan_code ?? null, to_plan_code: String(x.to_plan_code) }));
}

/**
 * 그 달 요금제별 월분(C10). 'snapshot' = 그 달 행이 없는 요금제를 지금 plans 값으로 넣고 읽는다 · 'read' = 넣지 않고 같은 값을 계산.
 * 표가 없으면(DDL 전) plans 지금 값 — 그동안 월 크레딧 수정은 503 으로 막혀 값이 못 바뀐다(R2-6).
 */
export async function monthCredits(db: Db, month: string, mode: 'snapshot' | 'read'): Promise<Map<string, number>> {
  const live = await db.query(`SELECT plan_code, COALESCE(ai_credits_per_month, 0) AS credits FROM plans`);
  const out = new Map<string, number>(live.rows.map((r: any) => [String(r.plan_code), Math.max(0, Number(r.credits) || 0)]));
  if (!(await planMonthCreditsReady(db))) return out;
  if (mode === 'snapshot') {
    await db.query(
      `INSERT INTO plan_month_credits (month, plan_code, credits)
       SELECT $1::date, plan_code, GREATEST(COALESCE(ai_credits_per_month, 0), 0) FROM plans
       ON CONFLICT (month, plan_code) DO NOTHING`,
      [`${month}-01`],
    );
  }
  const fixed = await db.query(`SELECT plan_code, credits FROM plan_month_credits WHERE month = $1::date`, [`${month}-01`]);
  for (const r of fixed.rows) out.set(String(r.plan_code), Math.max(0, Number(r.credits) || 0));
  return out;
}

/** 요금제 월 크레딧 수정 전: 닫히지 않았을 수 있는 달 전부를 지금(수정 전) 값으로 고정(C10 · Codex R3-3) */
export async function snapshotOpenMonths(db: Db, now: Date): Promise<void> {
  const cur = monthKeyOf(now);
  const r = await db.query(`SELECT MIN(ai_credits_reset_at) AS oldest FROM companies WHERE ai_credits_reset_at IS NOT NULL`);
  let from = r.rows[0]?.oldest ? monthKeyOf(new Date(r.rows[0].oldest)) : cur;
  if (from < addMonths(cur, -24)) from = addMonths(cur, -24);
  for (let m = from; m <= cur; m = addMonths(m, 1)) await monthCredits(db, m, 'snapshot');
}

/** 그 주기 차감 행을 고르는 조건(C8 · seq 우선 · 옛 행은 created_at ≥ 주기 시작) — 파라미터는 $1 회사 뒤 $2 */
async function cycleFilter(db: Db, companyId: string, cycleMonth: string, resetAt: Date): Promise<{ where: string; params: any[] }> {
  const seqOk = await creditSeqReady(db);
  const key = `reset:${companyId}:${monthTag(cycleMonth)}`;
  const st = await db.query(
    `SELECT ${seqOk ? 'seq::text' : 'NULL::text'} AS seq, ${TS_US_SQL('created_at')} AS at_us FROM ai_credit_transactions WHERE idempotency_key = $1`,
    [key],
  );
  const startSeq: string | null = st.rows[0]?.seq ?? null;
  const startAt: string = st.rows[0]?.at_us ?? resetAt.toISOString();
  if (startSeq) return { where: `t.seq > $2::bigint`, params: [startSeq] };
  if (seqOk) return { where: `(t.seq IS NOT NULL OR t.created_at >= $2::timestamptz)`, params: [startAt] };
  return { where: `t.created_at >= $2::timestamptz`, params: [startAt] };
}

/** 그 주기 차감 행에 적힌 초과분 합 R(청구된 것 포함 · C8) */
export async function cycleOverageRecorded(db: Db, companyId: string, cycleMonth: string, resetAt: Date): Promise<number> {
  const f = await cycleFilter(db, companyId, cycleMonth, resetAt);
  const r = await db.query(
    `SELECT COALESCE(SUM(t.overage_credits), 0)::int AS r FROM ai_credit_transactions t
      WHERE t.company_id = $1::uuid AND t.type = 'deduct' AND t.overage_credits > 0 AND ${f.where}`,
    [companyId, ...f.params],
  );
  return Number(r.rows[0]?.r) || 0;
}

/** 그 주기 미청구 초과 차감 행(최근 것부터 · 잠금) — U < 0 줄이기용(C8) */
export async function cycleUnbilledOverageRows(db: Db, companyId: string, cycleMonth: string, resetAt: Date): Promise<Array<{ id: string; overage: number }>> {
  const f = await cycleFilter(db, companyId, cycleMonth, resetAt);
  const seqOk = await creditSeqReady(db);
  const r = await db.query(
    `SELECT t.id, t.overage_credits FROM ai_credit_transactions t
      WHERE t.company_id = $1::uuid AND t.type = 'deduct' AND t.overage_credits > 0 AND t.billed_billing_id IS NULL AND ${f.where}
      ORDER BY t.created_at DESC${seqOk ? ', t.seq DESC NULLS LAST' : ''}, t.id DESC
      FOR UPDATE`,
    [companyId, ...f.params],
  );
  return r.rows.map((x: any) => ({ id: String(x.id), overage: Number(x.overage_credits) || 0 }));
}

export type CloseInputs =
  | { kind: 'none' }
  | { kind: 'first'; month: string; entitlement: number }
  | { kind: 'close'; curMonth: string; months: CloseMonthInfo[] };

/** 월 마감에 넣을 값(쓰기 = 'snapshot' · 표시 · 확인 = 'read') — row = loadCreditRow 의 행(plan_code · reset_at · base · billing_type) */
export async function loadCloseInputs(db: Db, companyId: string, row: any, now: Date, mode: 'snapshot' | 'read'): Promise<CloseInputs> {
  const resetAt: Date | null = row.reset_at ? new Date(row.reset_at) : null;
  const cur = monthKeyOf(now);
  if (resetAt && monthKeyOf(resetAt) >= cur) return { kind: 'none' };
  const changes = await loadPlanChangesLite(db, companyId, monthLastDay(cur));
  const planCode: string | null = row.plan_code ?? null;
  const entitlementOf = async (m: string) => {
    const credits = await monthCredits(db, m, mode);
    return monthEntitlementFrom({ month: m, changes, creditsOf: (c) => credits.get(c) ?? 0, currentPlanCode: planCode });
  };
  if (!resetAt) return { kind: 'first', month: cur, entitlement: await entitlementOf(cur) };
  const months = monthsToClose(resetAt, now);
  const infos: CloseMonthInfo[] = [];
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    infos.push({
      month: m,
      trialAtEnd: trialAtMonthEnd(changes, m, planCode),
      nextEntitlement: await entitlementOf(addMonths(m, 1)),
      // 차감이 있을 수 있는 주기는 첫 달뿐이다 — 차감은 언제나 마감부터 돌린다(밀린 달에는 차감이 없다)
      overageRecorded: i === 0 && billedMonthly(row.billing_type) ? await cycleOverageRecorded(db, companyId, m, resetAt) : 0,
    });
  }
  return { kind: 'close', curMonth: cur, months: infos };
}

/** 월 마감을 쓰지 않고 계산한 기본분(C7 · 표시 · 사전 확인 · 엄격 확인이 이것만) */
export async function projectBaseAfterClose(db: Db, companyId: string, row: any, now: Date): Promise<number> {
  // ★ 2026-11-01 §16-5 — 만료 시각이 지난 체험 = 남은 양수 기본분 0(쓰는 쪽 applyResetIfNeeded 와 같은 판정 · 강등 전이라도)
  const base = isTrialOver(row, now) ? Math.min(Number(row.base) || 0, 0) : Number(row.base) || 0;
  const inp = await loadCloseInputs(db, companyId, row, now, 'read');
  if (inp.kind === 'none') return base;
  if (inp.kind === 'first') return base + inp.entitlement;
  return simulateClose({ base, billingType: String(row.billing_type || ''), months: inp.months }).base;
}

/** 그 달 E(지금 이력 · 그 달 고정 월분 · C4 의 E_after) */
export async function monthEntitlementNow(db: Db, companyId: string, month: string, currentPlanCode: string | null): Promise<number> {
  const changes = await loadPlanChangesLite(db, companyId, monthLastDay(month));
  const credits = await monthCredits(db, month, 'snapshot');
  return monthEntitlementFrom({ month, changes, creditsOf: (c) => credits.get(c) ?? 0, currentPlanCode });
}

/**
 * 그 달 원장 지급 합 = 그 달 reset 줄 + 그 달 plan_prorate 줄(C4 · Δ 의 기준).
 * 일할 줄의 달 = 키에 박은 달(plan-prorate:YYYYMM:이력 id · Codex 구현 2R-2 — 이력 행 · 줄 시각과 무관).
 * 옛 키 꼴(plan-prorate:이력 id · 1026 일할 · 이 배포 전에만 생긴다)은 줄 시각의 달로 센다.
 */
export async function grantedInMonth(db: Db, companyId: string, month: string): Promise<number> {
  const r = await db.query(
    `SELECT COALESCE(SUM(amount), 0)::int AS g FROM ai_credit_transactions
      WHERE company_id = $1::uuid
        AND (idempotency_key = $2
             OR (type = 'plan_prorate' AND idempotency_key LIKE $3)
             OR (type = 'plan_prorate' AND idempotency_key !~ '^plan-prorate:[0-9]{6}:'
                 AND created_at >= ($4::date)::timestamp AT TIME ZONE 'Asia/Seoul'
                 AND created_at < (($4::date + INTERVAL '1 month')::date)::timestamp AT TIME ZONE 'Asia/Seoul'))`,
    [companyId, `reset:${companyId}:${monthTag(month)}`, `plan-prorate:${monthTag(month)}:%`, `${month}-01`],
  );
  return Number(r.rows[0]?.g) || 0;
}

/**
 * 청구 기간에 말일이 든 달 중 아직 크레딧 월 마감이 안 된 달(★ 2026-11-01 크레딧 컨트롤타워 C8 · I10).
 * 마감은 한 달씩이라 리셋 시각 ≥ 그 달 다음 달 1일 0시(KST) = 그 달 맞춤 · 소멸 줄이 그 달 날짜로 다 들어갔다.
 * 발행 트랜잭션 안(정산 잠금 뒤)에서 읽기만 한다 — 비어 있지 않으면 발행하지 않는다.
 */
export async function creditMonthsOpenInPeriod(db: Db, companyId: string, billingStart: string, billingEnd: string): Promise<string[]> {
  const r = await db.query(`SELECT ai_credits_reset_at FROM companies WHERE id = $1::uuid`, [companyId]);
  const resetAt: Date | null = r.rows[0]?.ai_credits_reset_at ? new Date(r.rows[0].ai_credits_reset_at) : null;
  const open: string[] = [];
  for (let m = billingStart.slice(0, 7); m <= billingEnd.slice(0, 7); m = addMonths(m, 1)) {
    const last = monthLastDay(m);
    if (last < billingStart || last > billingEnd) continue;
    const nextStart = new Date(`${addMonths(m, 1)}-01T00:00:00+09:00`);
    if (!resetAt || resetAt.getTime() < nextStart.getTime()) open.push(m);
  }
  return open;
}
