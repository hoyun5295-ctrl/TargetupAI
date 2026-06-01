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

import {
  needsMonthlyReset,
  splitDeduction,
  buildIdempotencyKey,
  kstMonthTag,
} from './ai-credit-calc';

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
            p.ai_credits_per_month       AS plan_credits
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1::uuid${forUpdate ? '\n      FOR UPDATE OF c' : ''}`,
    [companyId]
  );
  return res.rows[0] || null;
}

/** 트랜잭션 내부 월 리셋. base = 요금제 기본 크레딧 + reset 이력(월 1회 idempotent). */
export async function applyResetIfNeeded(client: any, companyId: string, row: any, now: Date): Promise<any> {
  const resetAt = row.reset_at ? new Date(row.reset_at) : null;
  if (!needsMonthlyReset(resetAt, now)) return row;

  const planCredits = Number(row.plan_credits) || 0;
  const purchased = Number(row.purchased) || 0;
  await client.query(
    `UPDATE companies
        SET ai_credits_base_remaining = $2,
            ai_credits_reset_at = NOW()
      WHERE id = $1::uuid`,
    [companyId, planCredits]
  );
  await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after)
     VALUES ($1::uuid, 'reset', $2, 'base', 'monthly-reset', $3, $2, $4)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [companyId, planCredits, `reset:${companyId}:${kstMonthTag(now)}`, purchased]
  );
  return { ...row, base: planCredits, reset_at: now.toISOString() };
}

/**
 * 트랜잭션 내부 차감 (BEGIN/COMMIT/ROLLBACK 포함). 호출측은 client 연결만 관리한다.
 * 순서: BEGIN → loadCreditRow(FOR UPDATE, 직렬화) → idempotent 재확인 → reset → split → UPDATE → INSERT → COMMIT.
 * cost 0·companyId 없음은 호출측(deductCredit)에서 거른다.
 */
export async function _deductWithClient(client: any, opts: DeductOpts, now: Date): Promise<DeductResult> {
  const empty: DeductResult = { deducted: false, fromBase: 0, fromPurchased: 0, baseAfter: 0, purchasedAfter: 0 };
  const idemKey = opts.idempotencyKey ?? buildIdempotencyKey(opts.source, opts.aiCallLogId);

  await client.query('BEGIN');

  const locked = await loadCreditRow(client, opts.companyId, true);
  if (!locked) {
    await client.query('ROLLBACK');
    return empty;
  }

  // ★ D227+ 크레딧제 미적용(요금제 크레딧 미설정 + 구매분 0) → 차감 skip(차단 X).
  //   plans.ai_credits_per_month에 값을 넣는 순간 자동으로 차감이 활성화된다.
  if (locked.plan_credits == null && (Number(locked.purchased) || 0) === 0) {
    await client.query('ROLLBACK');
    return empty;
  }

  // 잠금 획득 후 idempotent 재확인 — 동시 재시도 이중 차감 차단 (잠금 전 확인은 race 위험)
  if (idemKey) {
    const dup = await client.query(
      `SELECT 1 FROM ai_credit_transactions WHERE idempotency_key = $1 LIMIT 1`,
      [idemKey]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      return empty;
    }
  }

  const row = await applyResetIfNeeded(client, opts.companyId, locked, now);
  const base = Number(row.base) || 0;
  const purchased = Number(row.purchased) || 0;
  // ★ D227+ 후불 추가 사용: billing_type='postpaid'면 잔액을 한도까지 음수 허용(월말 청구). 선불은 0 → 0에서 차단.
  const overageAllowed = String(row.billing_type) === 'postpaid' ? Math.max(0, Number(row.overage_limit) || 0) : 0;
  const { fromBase, fromPurchased, shortfall } = splitDeduction(base, purchased, opts.cost);
  if ((base + purchased) - opts.cost < -overageAllowed) {
    await client.query('ROLLBACK');
    throw new InsufficientCreditError(opts.cost, base + purchased);
  }

  const baseAfter = base - fromBase - shortfall;  // 후불 초과분은 base가 음수로 누적(= 월말 청구 대상)
  const purchasedAfter = purchased - fromPurchased;
  await client.query(
    `UPDATE companies
        SET ai_credits_base_remaining = $2,
            ai_credits_purchased = $3
      WHERE id = $1::uuid`,
    [opts.companyId, baseAfter, purchasedAfter]
  );

  const bucket = shortfall > 0 ? 'overage' : (fromBase > 0 && fromPurchased > 0 ? 'mixed' : (fromPurchased > 0 ? 'purchased' : 'base'));
  await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, ai_call_log_id, idempotency_key,
        balance_base_after, balance_purchased_after, created_by, overage_credits)
     VALUES ($1::uuid, 'deduct', $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      opts.companyId, opts.cost, bucket, opts.source.slice(0, 60),
      opts.aiCallLogId || null, idemKey, baseAfter, purchasedAfter, opts.createdBy || null, shortfall,
    ]
  );

  await client.query('COMMIT');
  return { deducted: true, fromBase, fromPurchased, baseAfter, purchasedAfter };
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
  if (!opts.amount || opts.amount <= 0) throw new Error('금액은 1 이상이어야 합니다.');
  await client.query('BEGIN');

  const locked = await loadCreditRow(client, opts.companyId, true);
  if (!locked) {
    await client.query('ROLLBACK');
    throw new Error('회사를 찾을 수 없습니다.');
  }

  // ★ 멱등: 키가 오면 이미 처리된 지급/조정인지 확인(FOR UPDATE 뒤 = 더블클릭 직렬화). 키 없으면 기존 동작.
  if (opts.idempotencyKey) {
    const dup = await client.query(`SELECT 1 FROM ai_credit_transactions WHERE idempotency_key = $1 LIMIT 1`, [opts.idempotencyKey]);
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      throw new Error('이미 처리된 요청입니다.');
    }
  }

  const base = Number(locked.base) || 0;
  const purchased = Number(locked.purchased) || 0;
  const delta = opts.type === 'grant' ? opts.amount : -opts.amount;
  const purchasedAfter = purchased + delta;
  if (purchasedAfter < 0) {
    await client.query('ROLLBACK');
    throw new Error(`구매 크레딧이 부족합니다 (보유 ${purchased.toLocaleString()}).`);
  }

  await client.query(
    `UPDATE companies SET ai_credits_purchased = $2 WHERE id = $1::uuid`,
    [opts.companyId, purchasedAfter]
  );

  await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key,
        balance_base_after, balance_purchased_after, created_by, reason)
     VALUES ($1::uuid, $2, $3, 'purchased', $4, $5, $6, $7, $8, $9)`,
    [
      opts.companyId, opts.type, opts.amount, `admin-${opts.type}`,
      opts.idempotencyKey || `${opts.type}:${opts.companyId}:${now.getTime()}:${Math.floor(Math.random() * 1e9)}`,
      base, purchasedAfter, opts.adminId, (opts.reason || '').slice(0, 500),
    ]
  );

  await client.query('COMMIT');
  return { purchasedAfter };
}
