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
  isOperationSource,
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
  // ★ v2 음수 상계 — 지난달 운영 과금(여정·자동마케팅 실행)으로 base가 음수면 이번달 grant에서 그만큼 차감(덮어쓰기 X).
  //   양수 잔액은 이월 안 함(기존 동작 유지 = 미사용분 소멸). carriedBase = grant + min(0, 지난 base).
  const prevBase = Number(row.base) || 0;
  const carriedBase = planCredits + Math.min(0, prevBase);
  await client.query(
    `UPDATE companies
        SET ai_credits_base_remaining = $2,
            ai_credits_reset_at = NOW()
      WHERE id = $1::uuid`,
    [companyId, carriedBase]
  );
  // amount = 월 grant(gross), balance_base_after = 상계 후 실제 base(carriedBase). 둘의 차 = 지난달 음수 상계분.
  await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after)
     VALUES ($1::uuid, 'reset', $2, 'base', 'monthly-reset', $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [companyId, planCredits, `reset:${companyId}:${kstMonthTag(now)}`, carriedBase, purchased]
  );
  return { ...row, base: carriedBase, reset_at: now.toISOString() };
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
    return { ...empty, skipReason: 'no_credit_row' };
  }

  // ★ D227+ 크레딧제 미적용(요금제 크레딧 미설정 + 구매분 0) → 차감 skip(차단 X).
  //   plans.ai_credits_per_month에 값을 넣는 순간 자동으로 차감이 활성화된다.
  if (locked.plan_credits == null && (Number(locked.purchased) || 0) === 0) {
    await client.query('ROLLBACK');
    return { ...empty, skipReason: 'not_applicable' };
  }

  // 잠금 획득 후 idempotent 재확인 — 동시 재시도 이중 차감 차단 (잠금 전 확인은 race 위험)
  if (idemKey) {
    const dup = await client.query(
      `SELECT 1 FROM ai_credit_transactions WHERE idempotency_key = $1 LIMIT 1`,
      [idemKey]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      // 이미 그 키로 차감됐다 = 돈은 빠졌다. 실패와 섞으면 호출부가 재시도·보류로 오판한다.
      return { ...empty, skipReason: 'duplicate' };
    }
  }

  const row = await applyResetIfNeeded(client, opts.companyId, locked, now);
  const base = Number(row.base) || 0;
  const purchased = Number(row.purchased) || 0;
  // ★ v2 운영 과금(여정·자동마케팅 실행) = 활성 자산이라 마이너스 허용(−1개월 grant 상한). 다음달 grant에서 상계(applyResetIfNeeded).
  //   그 외(분석·생성·발행) = 후불(postpaid)이면 overage_limit까지, 선불은 0에서 차단(기존 동작).
  const planCredits = Number(row.plan_credits) || 0;
  const overageAllowed = isOperationSource(opts.source)
    ? planCredits
    : (String(row.billing_type) === 'postpaid' ? Math.max(0, Number(row.overage_limit) || 0) : 0);
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
  skipReason?: 'duplicate' | 'no_credit_row' | 'no_original' | 'partial_not_supported' | 'already_refunded';
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
  if (opts.originalIdempotencyKey) {
    const orig = await client.query(
      `SELECT id, amount, bucket, overage_credits, billed_billing_id, created_at,
              balance_base_after, balance_purchased_after
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
    const overage = Number(row.overage_credits) || 0;
    if (overage > 0 && !row.billed_billing_id) {
      const remain = Math.max(0, overage - amount);
      await client.query(
        `UPDATE ai_credit_transactions SET overage_credits = $2 WHERE id = $1 AND billed_billing_id IS NULL`,
        [row.id, remain],
      );
    }
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
  /**
   * 버킷 복원 —
   *  - 원 차감이 base만/purchased만이면 그 항아리로 그대로 되돌린다(정확).
   *  - mixed·overage는 분할 비율이 원장에 남지 않는다. 그때는 **음수 base를 먼저 0까지 메우고
   *    나머지를 purchased로** 되돌린다. 전액을 base로 넣으면 월 리셋에서 양수 base가 소멸해
   *    고객이 돈으로 산 구매분이 사라진다(mixed 1000 환불 → purchased 900 소멸).
   */
  let toBase = 0;
  let toPurchased = 0;
  /**
   * ★ 2026-08-13 Codex 2R — **원 차감의 실제 구성분을 복원한다.**
   * 원장에 from_base/from_purchased 컬럼은 없지만, 차감 행의 `balance_*_after`와
   * **그 직전 거래 행의 after**가 있으면 차이로 정확히 계산된다(before − after).
   * 그것을 못 구할 때만 coarse bucket 규칙으로 내려간다.
   */
  let split: { fromBase: number; fromPurchased: number } | null = null;
  if (origRow) {
    const prev = await client.query(
      `SELECT balance_base_after, balance_purchased_after
         FROM ai_credit_transactions
        WHERE company_id = $1::uuid AND (created_at, id) < ($2, $3)
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [opts.companyId, origRow.created_at, origRow.id],
    );
    const p0 = prev.rows[0];
    if (p0) {
      const fromBase = Math.max(0, Number(p0.balance_base_after) - Number(origRow.balance_base_after));
      const fromPurchased = Math.max(0, Number(p0.balance_purchased_after) - Number(origRow.balance_purchased_after));
      // ⛔ **자가 검증** — 구성분 합이 (차감액 − 초과사용분)과 정확히 맞을 때만 신뢰한다.
      //   같은 트랜잭션에 월 리셋 행이 함께 들어간 경우처럼 "직전 행"이 애매할 수 있어,
      //   맞지 않으면 코스한 bucket 규칙으로 내려간다(틀린 정밀도보다 안전한 근사가 낫다).
      const expected = originalAmount - (Number(origRow.overage_credits) || 0);
      if (fromBase + fromPurchased === expected && expected > 0) split = { fromBase, fromPurchased };
    }
  }
  if (split) {
    // 전액 환불이라 구성분을 그대로 되돌린다(반올림 없음).
    toBase = Math.min(amount, split.fromBase);
    toPurchased = amount - toBase;
  } else if (bucket === 'purchased') {
    toPurchased = amount;
  } else if (bucket === 'base') {
    toBase = amount;
  } else {
    toBase = base < 0 ? Math.min(amount, -base) : 0;
    toPurchased = amount - toBase;
  }
  const baseAfter = base + toBase;
  const purchasedAfter = purchased + toPurchased;
  const recordBucket = toBase > 0 && toPurchased > 0 ? 'mixed' : (toPurchased > 0 ? 'purchased' : 'base');
  await client.query(
    `UPDATE companies SET ai_credits_base_remaining = $2, ai_credits_purchased = $3 WHERE id = $1::uuid`,
    [opts.companyId, baseAfter, purchasedAfter],
  );
  await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key,
        balance_base_after, balance_purchased_after, created_by, reason)
     VALUES ($1::uuid, 'refund', $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      opts.companyId, amount, recordBucket, opts.source.slice(0, 60), opts.idempotencyKey,
      baseAfter, purchasedAfter, opts.createdBy || null,
      `${(opts.reason || '').slice(0, 420)}${opts.originalIdempotencyKey ? ` ${ORIG_TAG_PREFIX}${opts.originalIdempotencyKey}]` : ''}`.slice(0, 500),
    ],
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
