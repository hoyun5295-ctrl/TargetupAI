/**
 * utils/ai-credit-tx.ts — AI 크레딧 트랜잭션 로직 (client 주입, pool/config 의존 0)
 *
 * 종량제 토대 (D227+ 2026-05-31). pool 연결은 ai-credit.ts가 관리하고, 여기에는
 * client를 받는 트랜잭션 흐름만 둔다 → mock client로 단위 검증 가능(DB 연결 불필요).
 *
 * 동시성: deductCredit은 FOR UPDATE로 companies 행을 잠근 뒤(직렬화) idempotent를
 * 재확인한다. dup 체크가 잠금 전이면 동시 재시도가 둘 다 통과해 이중 차감되므로,
 * 반드시 loadCreditRow(FOR UPDATE) → dup 체크 순서를 지킨다.
 */

import type { PoolClient } from 'pg';
import { UserFacingError } from './http-error';
import {
  splitDeduction,
  buildIdempotencyKey,
  isOperationSource,
  SEND_CREDIT_SOURCES,
  creditApplies,
  isTrialOver,
} from './ai-credit-calc';
import {
  loadCloseInputs, simulateClose, addMonths, monthTag, monthLastDay, cycleUnbilledOverageRows, creditSeqReady, billedMonthly, monthKeyOf, TS_US_SQL,
  LEDGER_SEQ_SQL, monthEntitlementNow, grantedInMonth,
} from './ai-credit-month';

export class InsufficientCreditError extends Error {
  constructor(public required: number, public available: number) {
    super(
      `AI 크레딧이 부족합니다 (필요 ${required.toLocaleString()} / 보유 ${available.toLocaleString()}). 크레딧을 충전해 주세요.`
    );
    this.name = 'InsufficientCreditError';
  }
}

export interface CreditState {
  baseRemaining: number;
  purchased: number;
  total: number;
  monthlyCap: number | null;
  planCredits: number;
  creditEnabled: boolean;  // 요금제 크레딧 미설정(plan_credits NULL) + 구매분 0 → false (차감/체크 skip)
  resetAt: Date | null;
  billingType: string;     // 'prepaid' | 'postpaid' — 후불은 추가 사용 한도까지 음수 허용
  overageLimit: number;    // 후불 추가 사용 한도(크레딧). 선불은 0 취급(무시).
}

export interface DeductResult {
  deducted: boolean;
  fromBase: number;
  fromPurchased: number;
  baseAfter: number;
  purchasedAfter: number;
  /**
   * ★ 2026-08-05 — `deducted: false`의 사유. 종전엔 세 상황이 똑같은 empty로 나와
   * 호출부가 "돈이 빠졌는가"를 판정할 수 없었다(발송 경로가 무과금을 성공으로 마감한 원인).
   *  - `duplicate`      = 같은 멱등키로 **이미 차감됨** → 차감 의무 없음
   *  - `not_applicable` = 크레딧제 미적용 회사(요금제 크레딧 미설정 + 구매분 0) → 차감 대상 아님
   *  - `no_credit_row`  = 회사 크레딧 행 자체가 없음 → **미해결**(정상 상태가 아니다)
   */
  skipReason?: 'duplicate' | 'not_applicable' | 'no_credit_row';
}

export interface DeductOpts {
  companyId: string;
  cost: number;
  source: string;
  aiCallLogId?: string | null;
  createdBy?: string | null;
  /** 멱등키 직접 지정. 미지정 시 source+aiCallLogId 기반. aiCallLogId가 없을 때 호출측이 대체 키를 부여하는 용도. */
  idempotencyKey?: string;
}

/** companies 크레딧 행 + 요금제 기본 크레딧. forUpdate 시 companies 행 잠금. */
export async function loadCreditRow(client: any, companyId: string, forUpdate: boolean): Promise<any | null> {
  const res = await client.query(
    `SELECT c.ai_credits_base_remaining AS base,
            c.ai_credits_purchased       AS purchased,
            c.ai_credits_monthly_cap     AS cap,
            c.ai_credits_reset_at        AS reset_at,
            c.billing_type               AS billing_type,
            c.postpaid_overage_limit     AS overage_limit,
            p.ai_credits_per_month       AS plan_credits,
            p.plan_code                  AS plan_code,
            -- ★ 2026-11-01 §16-5 체험 수명(만료 시각이 지나면 강등 전이라도 남은 기본분 소멸) — 만료 시각은 UTC 벽시계 칸 · 키는 강등 작업과 같은 꼴
            c.subscription_status        AS subscription_status,
            (c.trial_expires_at AT TIME ZONE 'UTC') AS trial_ends_at,
            to_char(c.trial_expires_at, 'YYYYMMDD"T"HH24MISSUS') AS trial_key,
            p.monthly_price              AS plan_monthly_price
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1::uuid${forUpdate ? '\n      FOR UPDATE OF c' : ''}`,
    [companyId]
  );
  return res.rows[0] || null;
}

/**
 * ★ 2026-09-27 한줄로 V2 R192(Codex 차수3 1R) — 차감이 허용하는 음수 한도(순수). 실제 차감(_deductWithClient)과
 *   과금 전 엄격 확인(hasCreditForStrict)이 이 하나를 쓴다 — 두 곳이 다르게 계산하면 "확인은 통과·차감은 실패"가 된다.
 * v2 운영 과금(여정·자동마케팅 실행) = 활성 자산이라 마이너스 허용(−1개월 grant 상한). 다음달 grant에서 상계(applyResetIfNeeded).
 * 그 외(분석·생성·발행) = 후불(postpaid)이면 overage_limit까지, 선불은 0에서 차단(기존 동작).
 */
export function creditOverageAllowance(row: any, source: string): number {
  // ★ 2026-10-20 여정 V.3 D1(Harold 「선불이든 후불이든 크레딧이 모자르면 둘 다 멈추는게 맞는거지 · 다음달 크레딧에서 땡겨오냐」) —
  //   여정 운영은 그달 크레딧(기본 + 구매) 안에서만 쓴다. 선불 다음 달 당겨쓰기 · 후불 초과 청구 0. 모자라면 실행기가 보내기 전에 멈춘다.
  // ★ 2026-10-24 X1(자동 마케팅 · 설계서 docs/2026-10-24-automarketing-oneline-design.md §5) — 회차 발송 크레딧도 같다(선불 · 후불 모두 마이너스 0).
  //   보내기 직전에 걷고, 모자라면 그 회차를 보내지 않고 멈춘다(continuous-operator dispatchProposalSend).
  // ★ 2026-10-24 발송 크레딧 전부(목록 = SEND_CREDIT_SOURCES · 플래너 문안비 포함 · 뿌리 대장 R4) — 규칙이 생긴 기능에서만 고쳐 플래너가 빠져 있었다
  if (SEND_CREDIT_SOURCES.has(source)) return 0;
  const planCredits = Number(row.plan_credits) || 0;
  return isOperationSource(source)
    ? planCredits
    : (String(row.billing_type) === 'postpaid' ? Math.max(0, Number(row.overage_limit) || 0) : 0);
}

/** 원장 키 충돌 · 설명 못 하는 잔액 = 원장과 회사 칸이 어긋났다(조용히 건너뛰지 않는다 · 크레딧 컨트롤타워 C2) */
export class CreditLedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditLedgerConflictError';
  }
}

/**
 * 호출 계약 위반 · 원장 어긋남(★ 2026-11-01 크레딧 컨트롤타워 C4) — 사용자 조건이 아니라 코드 · 데이터 결함이다(호출부 트랜잭션 롤백 · 실패 알림).
 *   적용일 = 이번 달 1일 ~ 오늘만 · 일할 원장 키 중복 = 같은 이력 행을 두 번 반영하려 함.
 */
export class PlanChangeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanChangeContractError';
  }
}

type LedgerAt = { kind: 'inCycle'; params: CycleRowTimeParams } | { kind: 'instant'; at: Date } | { kind: 'monthStart'; month: string } | { kind: 'monthEnd'; month: string };

/**
 * ★ 2026-11-01 크레딧 컨트롤타워(Codex 구현 2R-1 · 1R-2 · 1R-3 과 같은 부류 세 번째 → 쓰는 쪽 규칙) — 줄 시각 = 주기 순서.
 *   주기 시작 줄(리셋) = 리셋 시각 그대로(달 경계 · 첫 지급 판정 시각). 마감 뒤에 CT 가 쓰는 줄 = **판정 시각**을 그 줄이 실제로 든 주기
 *   [마감 뒤 리셋 시각, 그 달 다음 달 1일 0시) 안으로 묶은 시각: max(판정 시각 · 주기 시작 + 1µs) 를 주기 끝 − 1µs 로 자른다.
 *   DB 시계(거래 시작 NOW() · 실행 clock_timestamp)로 찍으면 자정에 판정 주기와 줄 시각의 달이 갈린다(Codex 구현 2R-1 · 3R-1 · 4R-1 · 같은 뿌리).
 *   줄 시각은 청구 달만 맡는다 — 줄 순서는 seq(새 줄은 언제나 LEDGER_SEQ_SQL · 5R 구조 처방)라 같은 시각 두 줄이 생겨도 순서가 흔들리지 않는다.
 *   SQL 조각 계약: $n · $n+1 · $n+2 = cycleRowTimeParams(판정 시각 · 주기 시작 · 주기 끝).
 */
export type CycleRowTimeParams = [string, string | null, string];
export const CYCLE_ROW_TIME_SQL = (n: number) =>
  `LEAST(GREATEST($${n}::timestamptz, $${n + 1}::timestamptz + INTERVAL '1 microsecond'), $${n + 2}::timestamptz - INTERVAL '1 microsecond')`;
/** row = 마감 뒤 회사 크레딧 행(reset_at = 그 줄이 든 주기의 시작) · now = 판정 시각 */
export function cycleRowTimeParams(row: any, now: Date): CycleRowTimeParams {
  const t = row?.reset_at ? new Date(row.reset_at) : null;
  const start = t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
  const cycleMonth = monthKeyOf(start ? new Date(start) : now);
  return [now.toISOString(), start, kstMonthStartIso(addMonths(cycleMonth, 1))];
}

/** INSERT … ON CONFLICT DO NOTHING 결과 넣은 행 수(pg = rowCount · 0 = 같은 키가 이미 있다) */
export function insertedRows(r: { rowCount?: number | null; rows?: any[] }): number {
  return r.rowCount ?? (r.rows || []).length;
}

/**
 * 원장 한 줄(★ 2026-11-01 크레딧 컨트롤타워 I1 · 원장 먼저). 키가 이미 있으면 던진다(호출부 트랜잭션 롤백).
 * 시각: inCycle = 마감 뒤 줄(위 규칙) · instant = 판정 시각 그대로(첫 지급 리셋 줄 = 리셋 시각)
 *   · monthStart = 그 달 1일 0시(KST) · monthEnd = 그 달 말일 끝(다음 달 1일 0시 − 1µs).
 * 경계 시각은 SQL 이 계산한다(JS Date 는 ms 라 1µs 를 못 만든다).
 */
async function insertLedgerRow(client: any, r: {
  companyId: string; type: string; amount: number; bucket: string; source: string; key: string;
  baseAfter: number; purchasedAfter: number; overage?: number; reason?: string | null; at: LedgerAt;
}): Promise<void> {
  const params: any[] = [r.companyId, r.type, r.amount, r.bucket, r.source, r.key, r.baseAfter, r.purchasedAfter, r.overage ?? 0, r.reason ?? null];
  let at: string;
  if (r.at.kind === 'inCycle') {
    params.push(...r.at.params);
    at = CYCLE_ROW_TIME_SQL(11);
  } else if (r.at.kind === 'instant') {
    params.push(r.at.at.toISOString());
    at = '$11::timestamptz';
  } else if (r.at.kind === 'monthStart') {
    params.push(`${r.at.month}-01`);
    at = `($11::date)::timestamp AT TIME ZONE 'Asia/Seoul'`;
  } else {
    params.push(monthLastDay(r.at.month));
    at = `(($11::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul') - INTERVAL '1 microsecond'`;
  }
  const ins = await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, overage_credits, reason, created_at, seq)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${at}, ${LEDGER_SEQ_SQL})
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    params,
  );
  if (insertedRows(ins) === 0) throw new CreditLedgerConflictError(`원장 키가 이미 있습니다: ${r.key}`);
}

/** 그 주기 미청구 초과분을 최근 것부터 줄인다(C8 · U < 0). 청구된 것 때문에 다 못 줄이면 경보(사람 처리 · 크레딧으로 바꿔 주지 않는다) */
async function reduceUnbilledOverage(client: any, companyId: string, cycleMonth: string, resetAt: Date, amount: number): Promise<void> {
  let left = amount;
  for (const r of await cycleUnbilledOverageRows(client, companyId, cycleMonth, resetAt)) {
    if (left <= 0) break;
    const cut = Math.min(left, r.overage);
    await client.query(
      `UPDATE ai_credit_transactions SET overage_credits = overage_credits - $2 WHERE id = $1::uuid AND billed_billing_id IS NULL`,
      [r.id, cut],
    );
    left -= cut;
  }
  if (left > 0) {
    // ★ 2026-11-01 §16-6 — 모아 보내기(옛: 회사마다 1통 · 월 마감 패스 한 번에 회사 수만큼) · 항목 = 회사 · 달(한 번뿐인 사건 = 못 보내면 다음 통에 · Codex 구현 1R-2) · 양 = 로그
    // ★ 2026-11-02 설계 §17-3 — 사건 모드(total 없음 · 옛 total 1 = 「마지막 주기 실패 1곳 / 대상 1곳」 오해 글)
    console.warn(`[CREDIT][OVERAGE-UNREDUCED] ${cycleMonth} 이미 청구된 초과 ${left}크레딧 못 줄임 company=${companyId}`);
    const { alertPassFailures } = await import('./system-alert');
    await alertPassFailures({
      pass: 'credit-overage-unreduced', title: '후불 초과 맞춤에서 이미 청구된 초과를 줄이지 못한 회사가 있습니다(크레딧으로 돌려주지 않음 · 사람 확인).',
      failures: [{ companyId, error: `${cycleMonth} 이미 청구된 초과 못 줄임`, key: `${companyId}:${monthTag(cycleMonth)}` }],
      action: '서버 로그 [CREDIT][OVERAGE-UNREDUCED] 줄의 회사 · 양을 확인해 주세요.',
    }).catch(() => undefined);
  }
}

/** 'YYYY-MM' 1일 0시(KST)의 ISO */
function kstMonthStartIso(month: string): string {
  return new Date(`${month}-01T00:00:00+09:00`).toISOString();
}

/**
 * ★ 2026-11-01 크레딧 컨트롤타워 C2 — 월 마감(W1). 이름은 옛 「월 리셋」 그대로(부르는 곳 = 차감 · 환불 · 요금제 변경 · 체험 · 1일 패스 · 발행).
 * 회사 행을 FOR UPDATE 로 잠근 채 부른다. 리셋 시각의 달부터 지난달까지 **한 달씩**:
 *   ① 후불 맞춤 U = max(0, −b) − R(> 0 = 맞춤 줄 · < 0 = 미청구 초과 줄임) ② 소멸(후불 음수 정리 · 양수 소멸 · 경계가 체험이면 양수 남김 · 선불 음수 넘김)
 *   ③ 다음 달 E 지급(후불은 0 이어도 줄 = 주기 경계). 줄 시각 = 그 달 경계(I10). 끝에 리셋 시각 = 이번 달 1일 0시.
 * 리셋 시각이 없으면 첫 지급(E · 시각 = 지금). 그때 기본분 ≠ 0 이면 던진다(원장으로 설명 못 하는 잔액).
 */
export async function applyResetIfNeeded(client: any, companyId: string, row: any, now: Date): Promise<any> {
  // ★ 2026-11-01 §16-5 — 만료 시각이 지난 체험 = 강등 작업 전이라도 남은 기본분 소멸(월 마감보다 먼저 · 그 줄은 체험이 끝난 주기에 든다)
  if (isTrialOver(row, now)) row = await expireEndedTrial(client, companyId, row, now);
  const inp = await loadCloseInputs(client, companyId, row, now, 'snapshot');
  if (inp.kind === 'none') return row;
  const purchased = Number(row.purchased) || 0;
  const postpaid = billedMonthly(row.billing_type);
  let b = Number(row.base) || 0;

  if (inp.kind === 'first') {
    if (b !== 0) throw new CreditLedgerConflictError(`리셋 시각이 없는데 기본분이 ${b} 입니다(원장으로 설명 못 하는 잔액 · 회사 ${companyId})`);
    // 달 키 · 줄 시각 · 리셋 시각 = 판정에 쓴 now 하나(Codex 구현 1R-3 · DB 의 거래 시작 시각을 저장하면 자정을 끼운 거래에서
    //   키는 새 달 · 리셋 시각은 지난달이 되어 다음 마감이 같은 키를 다시 넣다 영구히 실패했다)
    if (inp.entitlement > 0 || postpaid) {
      b += inp.entitlement;
      await insertLedgerRow(client, {
        companyId, type: 'reset', amount: inp.entitlement, bucket: 'base', source: 'monthly-reset',
        key: `reset:${companyId}:${monthTag(inp.month)}`, baseAfter: b, purchasedAfter: purchased, at: { kind: 'instant', at: now },
      });
    }
    await client.query(`UPDATE companies SET ai_credits_base_remaining = $2, ai_credits_reset_at = $3::timestamptz WHERE id = $1::uuid`, [companyId, b, now.toISOString()]);
    return { ...row, base: b, reset_at: now.toISOString() };
  }

  const resetAt = new Date(row.reset_at);
  const sim = simulateClose({ base: b, billingType: String(row.billing_type || ''), months: inp.months });
  for (const st of sim.steps) {
    const next = addMonths(st.month, 1);
    if (st.settle > 0) {
      await insertLedgerRow(client, {
        companyId, type: 'deduct', amount: 0, bucket: 'overage', source: 'month-end-overage',
        key: `overage-settle:${companyId}:${monthTag(st.month)}`, baseAfter: b, purchasedAfter: purchased, overage: st.settle,
        reason: `월말 초과 사용 맞춤 ${st.month}`, at: { kind: 'monthEnd', month: st.month },
      });
    } else if (st.settle < 0) {
      await reduceUnbilledOverage(client, companyId, st.month, resetAt, -st.settle);
    }
    if (st.expire !== 0) {
      b += st.expire;
      await insertLedgerRow(client, {
        companyId, type: 'expire', amount: st.expire, bucket: 'base', source: 'monthly-close',
        key: `expire:${companyId}:${monthTag(st.month)}`, baseAfter: b, purchasedAfter: purchased,
        reason: st.expire < 0 ? `남은 기본분 소멸 ${st.month}` : `초과 사용 청구로 정리 ${st.month}`, at: { kind: 'monthEnd', month: st.month },
      });
    }
    if (st.grant > 0 || postpaid) {
      b += st.grant;
      await insertLedgerRow(client, {
        companyId, type: 'reset', amount: st.grant, bucket: 'base', source: 'monthly-reset',
        key: `reset:${companyId}:${monthTag(next)}`, baseAfter: b, purchasedAfter: purchased, at: { kind: 'monthStart', month: next },
      });
    }
  }
  await client.query(
    `UPDATE companies SET ai_credits_base_remaining = $2, ai_credits_reset_at = ($3::date)::timestamp AT TIME ZONE 'Asia/Seoul' WHERE id = $1::uuid`,
    [companyId, b, `${inp.curMonth}-01`],
  );
  return { ...row, base: b, reset_at: kstMonthStartIso(inp.curMonth) };
}

/**
 * 트랜잭션 내부 차감 (BEGIN/COMMIT/ROLLBACK 포함). 호출측은 client 연결만 관리한다.
 * 순서: BEGIN → loadCreditRow(FOR UPDATE, 직렬화) → idempotent 재확인 → reset → split → UPDATE → INSERT → COMMIT.
 * cost 0·companyId 없음은 호출측(deductCredit)에서 거른다.
 */
export async function _deductWithClient(client: any, opts: DeductOpts, now: Date, tx: { manageTx?: boolean } = {}): Promise<DeductResult> {
  const empty: DeductResult = { deducted: false, fromBase: 0, fromPurchased: 0, baseAfter: 0, purchasedAfter: 0 };
  const idemKey = opts.idempotencyKey ?? buildIdempotencyKey(opts.source, opts.aiCallLogId);
  // ★ 2026-10-04 manageTx=false = 호출부 트랜잭션 안에서 차감한다(BEGIN·COMMIT·ROLLBACK을 호출부가 소유 · 환불의 manageTx와 같은 축).
  //   쓰는 자리 = 플래너 행사 승인(대행료가 승인 커밋과 함께 확정 · 승인이 롤백되면 차감도 없다). 기본값은 종전 동작 그대로.
  const own = tx.manageTx !== false;
  const rollback = async () => { if (own) await client.query('ROLLBACK'); };

  if (own) await client.query('BEGIN');

  const locked = await loadCreditRow(client, opts.companyId, true);
  if (!locked) {
    await rollback();
    return { ...empty, skipReason: 'no_credit_row' };
  }

  // ★ D227+ 크레딧제 미적용(요금제 크레딧 미설정 + 구매분 0) → 차감 skip(차단 X).
  //   plans.ai_credits_per_month에 값을 넣는 순간 자동으로 차감이 활성화된다.
  if (!creditApplies(locked)) {
    await rollback();
    return { ...empty, skipReason: 'not_applicable' };
  }

  // 잠금 획득 후 idempotent 재확인 — 동시 재시도 이중 차감 차단 (잠금 전 확인은 race 위험)
  if (idemKey) {
    const dup = await client.query(
      `SELECT 1 FROM ai_credit_transactions WHERE idempotency_key = $1 LIMIT 1`,
      [idemKey]
    );
    if (dup.rows.length > 0) {
      await rollback();
      // 이미 그 키로 차감됐다 = 돈은 빠졌다. 실패와 섞으면 호출부가 재시도·보류로 오판한다.
      return { ...empty, skipReason: 'duplicate' };
    }
  }

  const row = await applyResetIfNeeded(client, opts.companyId, locked, now);
  const base = Number(row.base) || 0;
  const purchased = Number(row.purchased) || 0;
  // ★ v2 운영 과금(여정·자동마케팅 실행) = 활성 자산이라 마이너스 허용(−1개월 grant 상한). 다음달 grant에서 상계(applyResetIfNeeded).
  //   그 외(분석·생성·발행) = 후불(postpaid)이면 overage_limit까지, 선불은 0에서 차단(기존 동작).
  const overageAllowed = creditOverageAllowance(row, opts.source);
  const { fromBase, fromPurchased, shortfall } = splitDeduction(base, purchased, opts.cost);
  if ((base + purchased) - opts.cost < -overageAllowed) {
    await rollback();
    throw new InsufficientCreditError(opts.cost, base + purchased);
  }

  const baseAfter = base - fromBase - shortfall;  // 후불 초과분은 base가 음수로 누적(= 월말 청구 대상)
  const purchasedAfter = purchased - fromPurchased;

  // ★ 2026-11-01 크레딧 컨트롤타워 I1 — 원장 먼저. 들어가지 않았으면(같은 키) 잔액을 바꾸지 않는다.
  const bucket = shortfall > 0 ? 'overage' : (fromBase > 0 && fromPurchased > 0 ? 'mixed' : (fromPurchased > 0 ? 'purchased' : 'base'));
  const ins = await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, ai_call_log_id, idempotency_key,
        balance_base_after, balance_purchased_after, created_by, overage_credits, created_at, seq)
     VALUES ($1::uuid, 'deduct', $2, $3, $4, $5, $6, $7, $8, $9, $10, ${CYCLE_ROW_TIME_SQL(11)}, ${LEDGER_SEQ_SQL})
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      opts.companyId, opts.cost, bucket, opts.source.slice(0, 60),
      opts.aiCallLogId || null, idemKey, baseAfter, purchasedAfter, opts.createdBy || null, shortfall, ...cycleRowTimeParams(row, now),
    ]
  );
  if (insertedRows(ins) === 0) {
    await rollback();
    return { ...empty, skipReason: 'duplicate' };
  }
  await client.query(
    `UPDATE companies
        SET ai_credits_base_remaining = $2,
            ai_credits_purchased = $3
      WHERE id = $1::uuid`,
    [opts.companyId, baseAfter, purchasedAfter]
  );

  if (own) await client.query('COMMIT');
  return { deducted: true, fromBase, fromPurchased, baseAfter, purchasedAfter };
}

// ════════════════════════════════════════════════════════════════════
// 환불 (★ 2026-08-13 마케팅 플래너 Phase 3 — 인계 §4-⑤)
//   고객이 자기 차감을 되돌리는 첫 축이다. 종전에는 슈퍼관리자 수동 조정(adjustCredit)뿐이었다.
// ════════════════════════════════════════════════════════════════════

export interface RefundOpts {
  companyId: string;
  amount: number;
  /** 무엇을 되돌리는가 — 원 차감의 source를 그대로 쓴다(원장에서 짝이 보인다). */
  source: string;
  reason: string;
  createdBy?: string | null;
  /** 환불 멱등키 — 같은 키 재요청은 두 번 돌려주지 않는다. */
  idempotencyKey: string;
  /** 원 차감의 멱등키 — 버킷 복원 판정과 초과사용 상계의 근거. */
  originalIdempotencyKey?: string | null;
  /**
   * ★ 2026-08-13 Codex 2R — false면 **BEGIN/COMMIT을 호출부가 관리한다.**
   * 취소처럼 "원장 전이와 환불이 같은 트랜잭션이어야 하는" 경로가 쓴다 —
   * 나뉘면 취소만 커밋되고 환불이 유실되는 창이 남는다(재시도 근거가 원장에 없다).
   */
  manageTx?: boolean;
}

export interface RefundResult {
  refunded: boolean;
  amount: number;
  skipReason?: 'duplicate' | 'no_credit_row' | 'no_original' | 'partial_not_supported' | 'already_refunded' | 'held_after_lifetime_end';
}

/**
 * 크레딧 환불 (트랜잭션 · 멱등).
 *
 * **버킷 복원 규칙** — 원 차감 행의 bucket을 보고 되돌린다:
 *   base → base / purchased → purchased / mixed·overage → base.
 *   섞인 차감의 분할 비율은 원장에 남지 않으므로(bucket 하나만 남는다) base로 되돌린다 —
 *   base는 월 리셋에서 상계되는 항아리라 과다 환급이 이월되지 않는 쪽이다.
 *
 * ⛔ **초과사용(overage) 상계** — 후불 회사에서 그 차감이 초과사용으로 잡혔고 아직 청구되지 않았다면
 *    그 행의 overage_credits를 환불분만큼 줄인다. 줄이지 않으면 돈은 돌려줬는데 월말 청구서에는
 *    쓰지 않은 초과사용이 남는다(정산 집계는 `type='deduct' AND overage_credits > 0`을 읽는다).
 *    이미 청구된 행(billed_billing_id NOT NULL)은 건드리지 않는다 — 발행된 문서를 뒤에서 바꾸지 않는다.
 */
/** 환불 행에 남기는 원 차감 키 표식 — 누적 상한 판정의 결속 축(원장 컬럼 추가 없이). */
const ORIG_TAG_PREFIX = '[orig:';

export async function refundCreditWithClient(client: any, opts: RefundOpts, now: Date): Promise<RefundResult> {
  const amount = Math.max(0, Math.floor(Number(opts.amount) || 0));
  if (amount <= 0) return { refunded: false, amount: 0 };
  const manageTx = opts.manageTx !== false;
  const rollback = async () => { if (manageTx) await client.query('ROLLBACK'); };

  if (manageTx) await client.query('BEGIN');
  const locked = await loadCreditRow(client, opts.companyId, true);
  if (!locked) {
    await rollback();
    return { refunded: false, amount: 0, skipReason: 'no_credit_row' };
  }
  // 잠금 획득 후 멱등 확인 — 동시 재요청 이중 환불 차단(차감과 같은 순서 계약).
  const dup = await client.query(
    `SELECT 1 FROM ai_credit_transactions WHERE idempotency_key = $1 LIMIT 1`,
    [opts.idempotencyKey],
  );
  if (dup.rows.length > 0) {
    await rollback();
    return { refunded: false, amount: 0, skipReason: 'duplicate' };
  }

  // ⛔ **월 리셋을 먼저 적용한다**(차감과 같은 순서 계약). 월 경계 직후에 환불을 얹으면
  //   그 다음 차감·조회가 lazy 리셋을 돌려 방금 넣은 금액을 통째로 덮어쓴다.
  const row0 = await applyResetIfNeeded(client, opts.companyId, locked, now);

  let bucket = 'base';
  let originalAmount = 0;
  let origRow: any = null;
  const seqOk = await creditSeqReady(client);
  if (opts.originalIdempotencyKey) {
    const orig = await client.query(
      `SELECT id, amount, bucket, overage_credits, billed_billing_id, created_at, ${TS_US_SQL('created_at')} AS created_at_us,
              balance_base_after, balance_purchased_after${seqOk ? ', seq::text AS seq' : ''}
         FROM ai_credit_transactions
        WHERE idempotency_key = $1 AND company_id = $2::uuid AND type = 'deduct'
        LIMIT 1`,
      [opts.originalIdempotencyKey, opts.companyId],
    );
    const row = orig.rows[0];
    if (!row) {
      await rollback();
      return { refunded: false, amount: 0, skipReason: 'no_original' };
    }
    origRow = row;
    originalAmount = Number(row.amount) || 0;
    bucket = String(row.bucket || 'base');
  }
  // ⛔ **전액 환불만 지원한다.** 부분 환불을 허용하면 (a)구성분 반올림이 누적되어 항아리가 뒤바뀌고
  //   (b)서로 다른 멱등키로 나눠 환불해 원 차감액을 넘길 수 있다. 우리 환불 축(월간 대행 취소)은
  //   언제나 전액이므로, 지원하지 않는 것을 지원하는 척하지 않는다.
  if (originalAmount > 0 && amount !== originalAmount) {
    await rollback();
    return { refunded: false, amount: 0, skipReason: 'partial_not_supported' };
  }
  // ⛔ **같은 원 차감에 대한 누적 환불 상한** — 멱등키가 달라도 두 번 돌려주지 않는다.
  //   환불 행에 원 차감 키 표식을 남겨(reason) 그 합으로 판정한다(원장 컬럼 추가 없이 결속).
  if (opts.originalIdempotencyKey) {
    const already = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS sum FROM ai_credit_transactions
        WHERE company_id = $1::uuid AND type = 'refund' AND reason LIKE $2`,
      [opts.companyId, `%${ORIG_TAG_PREFIX}${opts.originalIdempotencyKey}]%`],
    );
    if ((Number(already.rows[0]?.sum) || 0) + amount > originalAmount) {
      await rollback();
      return { refunded: false, amount: 0, skipReason: 'already_refunded' };
    }
  }

  const base = Number(row0.base) || 0;
  const purchased = Number(row0.purchased) || 0;
  const isPrepaid = !billedMonthly(row0.billing_type);
  const resetAt = row0.reset_at ? new Date(row0.reset_at) : null;
  // ★ 2026-11-01 C8 — 같은 주기 = 원 차감이 지금 주기 리셋 줄보다 뒤. 둘 다 seq(잠금 순서)가 있으면 seq · 아니면 그 리셋 줄 시각 ·
  //   리셋 줄이 없으면(옛 행 · 선불 E 0) 리셋 시각(옛 규칙). 줄 시각(거래 시작)은 자정 직전에 시작한 거래면 지난달로 찍힌다.
  let sameCycle = !origRow || !resetAt || Number.isNaN(resetAt.getTime()) || new Date(origRow.created_at) >= resetAt;
  if (origRow && resetAt && !Number.isNaN(resetAt.getTime())) {
    const cur = await client.query(
      `SELECT ${seqOk ? 'seq::text' : 'NULL::text'} AS seq, ${TS_US_SQL('created_at')} AS at_us FROM ai_credit_transactions WHERE company_id = $1::uuid AND idempotency_key = $2`,
      [opts.companyId, `reset:${opts.companyId}:${monthTag(monthKeyOf(resetAt))}`],
    );
    const start = cur.rows[0];
    if (start && origRow.seq != null && start.seq != null) sameCycle = BigInt(String(origRow.seq)) > BigInt(String(start.seq));
    else if (start) sameCycle = String(origRow.created_at_us) >= String(start.at_us);   // 같은 꼴(UTC µs) 글자 비교 = 시각 비교
  }

  /**
   * ★ 2026-11-01 크레딧 컨트롤타워 C8(5판 · Codex R3-1) — **원 차감의 구성 셋**(기본분 몫 · 구매분 몫 · 초과 몫)을 다시 계산한다.
   *   차감은 기본분(양수만) → 구매분 → 초과(기본분을 음수로) 순이라, 원 행과 그 직전 행 잔액으로 정확히 나온다:
   *   fromBase = min(max(0, 직전 기본분), amount) · fromPurchased = 직전 구매분 − 원 행 구매분 · shortfall = 나머지.
   *   검사 = 직전 기본분 − 원 행 기본분 = fromBase + shortfall(옛 검사는 초과 몫을 기본분 몫에 섞어 맞지 않으면
   *   폴백으로 구매분을 기본분에 넣었다 · 지난 주기 반례 (−100, 0) → (0, 0) · 정답 (−100, 100)).
   *   직전 행 = seq(둘 다 있으면) · 아니면 created_at 순(옛 규칙).
   */
  let comp: { fromBase: number; fromPurchased: number; shortfall: number } | null = null;
  if (origRow) {
    let p0: any = null;
    if (seqOk && origRow.seq != null) {
      const bySeq = await client.query(
        `SELECT balance_base_after, balance_purchased_after FROM ai_credit_transactions
          WHERE company_id = $1::uuid AND seq < $2::bigint ORDER BY seq DESC LIMIT 1`,
        [opts.companyId, origRow.seq],
      );
      p0 = bySeq.rows[0] || null;
      if (!p0) {
        const old = await client.query(
          `SELECT balance_base_after, balance_purchased_after FROM ai_credit_transactions
            WHERE company_id = $1::uuid AND seq IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`,
          [opts.companyId],
        );
        p0 = old.rows[0] || null;
      }
    } else {
      const prev = await client.query(
        `SELECT balance_base_after, balance_purchased_after
           FROM ai_credit_transactions
          WHERE company_id = $1::uuid AND (created_at, id) < ($2::timestamptz, $3::uuid)
          ORDER BY created_at DESC, id DESC LIMIT 1`,
        [opts.companyId, origRow.created_at_us, origRow.id],   // µs 그대로(같은 거래 줄 · 주기 시작 + 1µs 를 놓치지 않게)
      );
      p0 = prev.rows[0] || null;
    }
    if (p0 && p0.balance_base_after != null && p0.balance_purchased_after != null
        && origRow.balance_base_after != null && origRow.balance_purchased_after != null) {
      const pB = Number(p0.balance_base_after);
      const pP = Number(p0.balance_purchased_after);
      const oB = Number(origRow.balance_base_after);
      const oP = Number(origRow.balance_purchased_after);
      const fromBase = Math.min(Math.max(0, pB), originalAmount);
      const fromPurchased = pP - oP;
      const shortfall = originalAmount - fromBase - fromPurchased;
      if (fromPurchased >= 0 && shortfall >= 0 && pB - oB === fromBase + shortfall) comp = { fromBase, fromPurchased, shortfall };
    }
  }

  /**
   * ★ 2026-11-01 §16-5 — 원 차감 **뒤에** 기본분 수명이 끝났나(체험 시작 · 체험 끝 줄 = source trial-start · trial-end · 금액 0 경계 줄 포함 ·
   *   비교 = seq · seq 없는 옛 원 행 = 시각). 끝났으면 되메운 지급 크레딧 몫(fromBase)은 아래에서 같은 거래로 바로 소멸한다.
   *   구성분을 모르면(폴백) 자동 환불하지 않는다 = 보류(Codex 설계 4R-1) — 판정은 원 행 부채 취소 등 어떤 쓰기보다 먼저(호출부 거래에서도 쓴 것 0).
   */
  let lifetimeEnded = false;
  if (origRow) {
    const bySeq = seqOk && origRow.seq != null;
    const ended = await client.query(
      `SELECT 1 FROM ai_credit_transactions
        WHERE company_id = $1::uuid AND source IN ('trial-start', 'trial-end')
          AND ${bySeq ? 'seq > $2::bigint' : 'created_at > $2::timestamptz'}
        LIMIT 1`,
      [opts.companyId, bySeq ? origRow.seq : origRow.created_at_us],
    );
    lifetimeEnded = ended.rows.length > 0;
    if (lifetimeEnded && !comp) {
      console.warn(`[CREDIT][HOLD] company=${opts.companyId} key=${opts.idempotencyKey} orig=${opts.originalIdempotencyKey} 원 차감 뒤 기본분 수명이 끝났고 구성분을 몰라 자동 환불하지 않음(원장으로 판정해 같은 키로 수동 환불)`);
      await rollback();
      return { refunded: false, amount: 0, skipReason: 'held_after_lifetime_end' };
    }
  }

  /**
   * 부채 취소 = 원 행의 **지금** 미청구 초과분 중 이번 환불의 초과 몫까지(후불만 · 선불 초과는 청구가 아니라 다음 달 상계).
   *   같은 주기 = 그 몫을 기본분으로 되메운다(차감 전 상태) · 지난 주기 = 그 음수는 마감이 이미 정리했으니 부채만 지운다
   *   → 환불 행 overage_credits = 그 부채 취소분(대조 규칙 = amount − overage_credits · §5-2).
   *   청구된 행(billed_billing_id)은 건드리지 않는다 — 발행된 문서를 뒤에서 바꾸지 않는다(크레딧으로 돌려준다).
   */
  const origOverageNow = origRow && !origRow.billed_billing_id ? (Number(origRow.overage_credits) || 0) : 0;
  const shortfallPart = comp ? comp.shortfall : (origRow ? Math.min(amount, Number(origRow.overage_credits) || 0) : 0);
  const debtCancel = !isPrepaid ? Math.min(shortfallPart, origOverageNow) : 0;
  if (debtCancel > 0) {
    await client.query(
      `UPDATE ai_credit_transactions SET overage_credits = overage_credits - $2 WHERE id = $1 AND billed_billing_id IS NULL`,
      [origRow.id, debtCancel],
    );
  }
  const refundOverage = sameCycle ? 0 : debtCancel;

  let toBase = 0;
  let toPurchased = 0;
  if (comp) {
    // 구매분 몫은 언제나 구매분(지금 기본분이 음수여도) · 기본분 몫 + (지난 주기면 부채로 갚은 만큼 뺀) 초과 몫은 기본분
    toPurchased = comp.fromPurchased;
    toBase = comp.fromBase + comp.shortfall - refundOverage;
  } else {
    // 폴백(직전 행을 못 구했거나 맞지 않음 · 옛 bucket 규칙) — 초과 몫은 위 부채 규칙, 나머지는 bucket 으로.
    const overagePart = Math.min(amount, shortfallPart);
    toBase += overagePart - refundOverage;
    const restAmount = amount - overagePart;
    if (bucket === 'purchased') {
      toPurchased += restAmount;
    } else if (bucket === 'base') {
      toBase += restAmount;
    } else {
      const curBase = base + toBase;
      const fill = curBase < 0 ? Math.min(restAmount, -curBase) : 0;
      toBase += fill;
      toPurchased += restAmount - fill;
    }
  }
  const baseAfter = base + toBase;
  const purchasedAfter = purchased + toPurchased;
  // 끝난 수명의 지급 크레딧 몫 = 바로 소멸(fromBase 그대로 · 상한 없음 = 새 수명의 빚을 끝난 크레딧이 갚지 않는다 · 부채 취소분은 남는다 · §16-5)
  const endExpire = lifetimeEnded && comp ? comp.fromBase : 0;
  const recordBucket = toBase > 0 && toPurchased > 0 ? 'mixed' : (toPurchased > 0 ? 'purchased' : 'base');
  // ★ 2026-11-01 크레딧 컨트롤타워 I1 — 원장 먼저(같은 키는 잠금 뒤 걸렀다 · 0행이면 잔액을 바꾸지 않는다).
  const ins = await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key,
        balance_base_after, balance_purchased_after, created_by, reason, overage_credits, created_at, seq)
     VALUES ($1::uuid, 'refund', $2, $3, $4, $5, $6, $7, $8, $9, $10, ${CYCLE_ROW_TIME_SQL(11)}, ${LEDGER_SEQ_SQL})
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      opts.companyId, amount, recordBucket, opts.source.slice(0, 60), opts.idempotencyKey,
      baseAfter, purchasedAfter, opts.createdBy || null,
      `${(opts.reason || '').slice(0, 420)}${opts.originalIdempotencyKey ? ` ${ORIG_TAG_PREFIX}${opts.originalIdempotencyKey}]` : ''}`.slice(0, 500),
      refundOverage, ...cycleRowTimeParams(row0, now),
    ],
  );
  if (insertedRows(ins) === 0) {
    await rollback();
    return { refunded: false, amount: 0, skipReason: 'duplicate' };
  }
  if (endExpire > 0) {
    await insertLedgerRow(client, {
      companyId: opts.companyId, type: 'expire', amount: -endExpire, bucket: 'base', source: 'trial-end-refund',
      key: `trial-end-refund:${opts.idempotencyKey}`, baseAfter: baseAfter - endExpire, purchasedAfter,
      reason: '끝난 수명의 기본분 = 환불 즉시 소멸', at: { kind: 'inCycle', params: cycleRowTimeParams(row0, now) },
    });
  }
  await client.query(
    `UPDATE companies SET ai_credits_base_remaining = $2, ai_credits_purchased = $3 WHERE id = $1::uuid`,
    [opts.companyId, baseAfter - endExpire, purchasedAfter],
  );
  if (manageTx) await client.query('COMMIT');
  return { refunded: true, amount };
}

export interface AdjustOpts {
  companyId: string;
  amount: number;
  type: 'grant' | 'admin_deduct';
  reason: string;
  adminId: string;
  /** 멱등키. 지정 시 같은 키 재요청은 중복 차단. 미지정 시 기존 동작(매번 신규). */
  idempotencyKey?: string;
}

/**
 * 슈퍼관리자 수동 크레딧 지급/조정 (구매분 버킷). 현금 balance-adjust 패턴 미러.
 *   grant = ai_credits_purchased 증가 / admin_deduct = 감소(0 미만 차단).
 *   ai_credit_transactions에 이력 기록(type=grant/admin_deduct, bucket='purchased', reason).
 *   FOR UPDATE로 행 잠근 뒤 계산(동시 조정 직렬화).
 */
export async function adjustCreditWithClient(client: any, opts: AdjustOpts, now: Date): Promise<{ purchasedAfter: number }> {
  if (!opts.amount || opts.amount <= 0) throw new UserFacingError(400, 'AMOUNT_INVALID', '금액은 1 이상이어야 해요.');
  await client.query('BEGIN');

  const locked = await loadCreditRow(client, opts.companyId, true);
  if (!locked) {
    await client.query('ROLLBACK');
    throw new UserFacingError(404, 'COMPANY_NOT_FOUND', '회사를 찾을 수 없어요.');
  }

  // ★ 멱등: 키가 오면 이미 처리된 지급/조정인지 확인(FOR UPDATE 뒤 = 더블클릭 직렬화). 키 없으면 기존 동작.
  if (opts.idempotencyKey) {
    const dup = await client.query(`SELECT 1 FROM ai_credit_transactions WHERE idempotency_key = $1 LIMIT 1`, [opts.idempotencyKey]);
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      throw new UserFacingError(409, 'ALREADY_PROCESSED', '이미 처리된 요청이에요.');
    }
  }

  const base = Number(locked.base) || 0;
  const purchased = Number(locked.purchased) || 0;
  const delta = opts.type === 'grant' ? opts.amount : -opts.amount;
  const purchasedAfter = purchased + delta;
  if (purchasedAfter < 0) {
    await client.query('ROLLBACK');
    throw new UserFacingError(402, 'INSUFFICIENT_PURCHASED', `구매 크레딧이 부족합니다 (보유 ${purchased.toLocaleString()}).`);
  }

  // ★ 2026-11-01 크레딧 컨트롤타워 I1 — 원장 먼저(같은 키는 위에서 잠금 뒤 걸렀다 · 들어간 경우에만 잔액).
  await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key,
        balance_base_after, balance_purchased_after, created_by, reason, seq)
     VALUES ($1::uuid, $2, $3, 'purchased', $4, $5, $6, $7, $8, $9, ${LEDGER_SEQ_SQL})`,
    [
      opts.companyId, opts.type, opts.amount, `admin-${opts.type}`,
      opts.idempotencyKey || `${opts.type}:${opts.companyId}:${now.getTime()}:${Math.floor(Math.random() * 1e9)}`,
      base, purchasedAfter, opts.adminId, (opts.reason || '').slice(0, 500),
    ]
  );
  await client.query(
    `UPDATE companies SET ai_credits_purchased = $2 WHERE id = $1::uuid`,
    [opts.companyId, purchasedAfter]
  );

  await client.query('COMMIT');
  return { purchasedAfter };
}

// ════════════════════════════════════════════════════════════════════
// 체험 크레딧(★ 2026-11-01 크레딧 컨트롤타워 C1 · I7 · D-A) — 체험 경로는 잔액 칸을 직접 쓰지 않고 이 두 함수만 부른다
// ════════════════════════════════════════════════════════════════════

/**
 * 체험 시작 = 월 마감 → 남은 양수 기본분 소멸 → 체험 크레딧(체험 한 번에 한 번). 음수는 그대로(선불 빚 · 후불은 달 경계 맞춤).
 * basic-trial 이 **연장이 아닐 때만** recordPlanChange **뒤에** 부른다(유료 → 체험이면 일할 회수가 먼저다).
 * trialKey = 새 체험 만료 시각(같은 체험의 재시도는 연장이라 여기 안 온다 · fresh 재시도는 호출부 1회 기록이 막는다).
 */
export async function applyTrialStart(client: any, companyId: string, credits: number, trialKey: string, now: Date = new Date()): Promise<void> {
  const locked = await loadCreditRow(client, companyId, true);
  if (!locked) return;
  const row = await applyResetIfNeeded(client, companyId, locked, now);
  const purchased = Number(row.purchased) || 0;
  let b = Number(row.base) || 0;
  if (b > 0) {
    const leftover = b;
    b = 0;
    await insertLedgerRow(client, {
      companyId, type: 'expire', amount: -leftover, bucket: 'base', source: 'trial-start',
      key: `trial-start-expire:${companyId}:${trialKey}`, baseAfter: b, purchasedAfter: purchased,
      reason: '무료체험 시작 전 남은 기본분 소멸', at: { kind: 'inCycle', params: cycleRowTimeParams(row, now) },
    });
  }
  const c = Math.max(0, Math.floor(Number(credits) || 0));
  if (c > 0) {
    b += c;
    await insertLedgerRow(client, {
      companyId, type: 'trial_credit', amount: c, bucket: 'base', source: 'trial-start',
      key: `trial-credit:${companyId}:${trialKey}`, baseAfter: b, purchasedAfter: purchased,
      reason: '무료체험 크레딧', at: { kind: 'inCycle', params: cycleRowTimeParams(row, now) },
    });
  } else if (Number(row.base) <= 0) {
    // ★ §16-5 수명 경계 줄 = 소멸 줄도 체험 크레딧 줄도 없으면 0 줄(그 뒤 환불이 끝난 수명의 기본분을 되살리지 않게 · Codex 설계 2R-1)
    await insertLedgerRow(client, {
      companyId, type: 'expire', amount: 0, bucket: 'base', source: 'trial-start',
      key: `trial-start-expire:${companyId}:${trialKey}`, baseAfter: b, purchasedAfter: purchased,
      reason: '무료체험 시작 · 수명 경계(소멸 0)', at: { kind: 'inCycle', params: cycleRowTimeParams(row, now) },
    });
  }
  await client.query(`UPDATE companies SET ai_credits_base_remaining = $2 WHERE id = $1::uuid`, [companyId, b]);
}

/**
 * 체험 끝(만료 · 취소 · 유료 전환) = 월 마감 → 남은 양수 기본분 소멸. 음수 빚은 그대로.
 * 체험 만료 워커 · 체험 취소는 recordPlanChange **앞에**, recordPlanChange 는 TRIAL 을 떠나는 변경의 이력 INSERT 뒤에 부른다.
 * ★ §16-5 — 남은 기본분이 0 이하여도 0 줄을 남긴다(수명 경계 · 다 쓰고 끝난 체험의 환불이 기본분을 되살리지 않게 · Codex 설계 2R-1).
 *   같은 키가 이미 있으면 = 만료 시각이 지난 뒤 첫 크레딧 일이 먼저 소멸했다(expireEndedTrial) → 넘어간다. 그때 기본분이 양수면
 *   환불 규칙상 생길 수 없는 잔액이라 던진다(호출부 거래 롤백 · 소리 내 멈춤).
 */
export async function expireTrialLeftover(client: any, companyId: string, key: string, now: Date = new Date()): Promise<void> {
  const locked = await loadCreditRow(client, companyId, true);
  if (!locked) return;
  const row = await applyResetIfNeeded(client, companyId, locked, now);
  const b = Number(row.base) || 0;
  const dup = await client.query(`SELECT 1 FROM ai_credit_transactions WHERE idempotency_key = $1 LIMIT 1`, [key]);
  if (dup.rows.length > 0) {
    if (b > 0) throw new CreditLedgerConflictError(`체험 끝 원장 줄(${key})이 이미 있는데 기본분이 ${b} 입니다(회사 ${companyId})`);
    return;
  }
  const leftover = Math.max(0, b);
  await insertLedgerRow(client, {
    companyId, type: 'expire', amount: -leftover, bucket: 'base', source: 'trial-end',
    key, baseAfter: b - leftover, purchasedAfter: Number(row.purchased) || 0,
    reason: '무료체험 종료 · 남은 체험 크레딧 소멸', at: { kind: 'inCycle', params: cycleRowTimeParams(row, now) },
  });
  if (leftover > 0) await client.query(`UPDATE companies SET ai_credits_base_remaining = $2 WHERE id = $1::uuid`, [companyId, b - leftover]);
}

/**
 * ★ 2026-11-01 §16-5 — 만료 시각이 지난 체험(isTrialOver) = 강등 작업을 기다리지 않고 남은 양수 기본분 소멸 · 0 이하여도 0 줄(수명 경계).
 *   키 = 강등 작업 · 체험 취소와 같은 `trial-end:{회사}:{만료 시각}`(같은 키가 있으면 이미 소멸 · 두 번 지움 0).
 *   applyResetIfNeeded 맨 앞에서만 부른다(회사 행 잠금 · 월 마감 전).
 */
async function expireEndedTrial(client: any, companyId: string, row: any, now: Date): Promise<any> {
  const key = `trial-end:${companyId}:${row.trial_key}`;
  const dup = await client.query(`SELECT 1 FROM ai_credit_transactions WHERE idempotency_key = $1 LIMIT 1`, [key]);
  if (dup.rows.length > 0) return row;
  const b = Number(row.base) || 0;
  const leftover = Math.max(0, b);
  await insertLedgerRow(client, {
    companyId, type: 'expire', amount: -leftover, bucket: 'base', source: 'trial-end',
    key, baseAfter: b - leftover, purchasedAfter: Number(row.purchased) || 0,
    reason: '무료체험 만료 · 남은 체험 크레딧 소멸', at: { kind: 'inCycle', params: cycleRowTimeParams(row, now) },
  });
  if (leftover > 0) await client.query(`UPDATE companies SET ai_credits_base_remaining = $2 WHERE id = $1::uuid`, [companyId, b - leftover]);
  console.log(`[CREDIT][TRIAL-END] company=${companyId} 만료 시각 지남 · 남은 기본분 ${leftover} 소멸(강등 전)`);
  return { ...row, base: b - leftover };
}

export interface PlanCreditAdjustResult {
  applied: boolean;
  /** 건너뛴 이유 — 운영에서 "왜 안 들어왔나"를 로그로 되짚을 수 있어야 한다 */
  skipped?: 'no_company' | 'no_change';
  delta?: number;
  baseAfter?: number;
  /** 그 달 권리(이 변경 뒤) */
  entitlement?: number;
  /** 이 변경 전 그 달 원장 지급 합 */
  granted?: number;
}

/**
 * ★ 2026-11-01 크레딧 컨트롤타워 C4(5판) — 요금제가 바뀐 달의 크레딧 = **E(이 변경 뒤 그 달 시간표) − 그 달 원장 지급 합**.
 *   그 달 합이 언제나 마지막 E 가 된다(변경마다 반올림하던 옛 식 `planChangeCreditDelta` 의 1씩 어긋남 · 이력 없는 회사 · 옛 반올림이 다음 변경에서 맞춰진다).
 *   TRIAL 을 떠나는 변경은 먼저 남은 체험 크레딧을 소멸한다(만료 · 취소 · 승인 · 선불 첫 결제 어느 길이든 같은 규칙 · I7).
 *   `recordPlanChange` 안에서만 부른다(이력 INSERT 뒤 · 같은 트랜잭션 · 회사 행 잠금 · 월 마감은 이미 끝).
 *   원장 INSERT 가 먼저이고 실제로 들어간 경우에만 기본 칸을 고친다(키 = 이력 행 id).
 */
export async function applyPlanCreditDelta(
  client: PoolClient,
  o: { companyId: string; historyId: string; today: string; now: Date; toPlanCode: string; leavingTrial: boolean; purchased: number },
): Promise<PlanCreditAdjustResult> {
  // 체험 소멸도 이 변경의 시각으로(Codex 구현 1R-2 · 다시 읽으면 이력 INSERT 와 소멸 사이 자정에 다음 달 지급분을 체험 잔여로 지웠다)
  if (o.leavingTrial) await expireTrialLeftover(client, o.companyId, `trial-end:${o.historyId}`, o.now);
  const month = o.today.slice(0, 7);
  const entitlement = await monthEntitlementNow(client, o.companyId, month, o.toPlanCode);
  const granted = await grantedInMonth(client, o.companyId, month);
  const delta = entitlement - granted;
  const row = await loadCreditRow(client, o.companyId, true);
  if (!row) return { applied: false, skipped: 'no_company' };
  const base = Number(row.base) || 0;
  if (delta === 0) return { applied: false, skipped: 'no_change', delta: 0, baseAfter: base, entitlement, granted };
  const newBase = base + delta;
  // amount 의 **부호가 방향**이다(양수 = 지급 · 음수 = 회수). 다른 type 과 달리 type 이 방향을 담지 않는다.
  // 키 = plan-prorate:그 달:이력 id(Codex 구현 2R-2 · 그 달 지급 합이 이 줄을 키로 센다 · 이력 행이 지워져도 · 줄 시각과 무관하게)
  const key = `plan-prorate:${monthTag(month)}:${o.historyId}`;
  const ins = await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, reason, created_at, seq)
     VALUES ($1::uuid, 'plan_prorate', $2, 'base', 'plan-prorate', $3, $4, $5, $6, ${CYCLE_ROW_TIME_SQL(7)}, ${LEDGER_SEQ_SQL})
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      o.companyId, delta, key, newBase, Number(row.purchased) || 0,
      `요금제 변경 일할: ${o.toPlanCode} · ${month} 권리 ${entitlement} − 이미 지급 ${granted}`, ...cycleRowTimeParams(row, o.now),
    ],
  );
  if (insertedRows(ins) === 0) throw new PlanChangeContractError(`요금제 변경 일할 원장 키가 이미 있습니다: ${key}`);
  await client.query(`UPDATE companies SET ai_credits_base_remaining = $2 WHERE id = $1::uuid`, [o.companyId, newBase]);
  console.log(`[plan-credit] company=${o.companyId} → ${o.toPlanCode} ${month} E=${entitlement} 지급=${granted} ${delta >= 0 ? '+' : ''}${delta} base=${base}→${newBase}`);
  return { applied: true, delta, baseAfter: newBase, entitlement, granted };
}
