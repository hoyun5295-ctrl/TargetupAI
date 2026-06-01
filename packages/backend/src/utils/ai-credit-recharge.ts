/**
 * utils/ai-credit-recharge.ts — AI 크레딧 충전 CT (D229+ 종량제)
 *
 * 선불 = 발송 잔액(companies.balance)에서 즉시 차감 + 구매분 지급 (단일 원자 트랜잭션).
 * 후불 = 충전 요청(ai_credit_requests pending) → 슈퍼관리자 승인 시 구매분 지급 + 월말 정산 합산(billed=false).
 *
 * 영구 원칙:
 *  - pool.connect + BEGIN + SELECT FOR UPDATE + 단일 트랜잭션 (동시 차감/충전 직렬화).
 *  - 단가/금액 계산은 ai-credit-calc.ts(순수). 보너스 없음.
 *  - adjustCreditWithClient는 자체 BEGIN/COMMIT이라 원자 합성 불가 → 여기서 INSERT/UPDATE를 직접 수행.
 *  - balance_transactions/ai_credit_transactions 컬럼 = prepaid.ts·ai-credit-tx.ts 운영 컬럼 미러.
 */

import { pool } from '../config/database';
import { calcRechargeAmount, CREDIT_UNIT_PRICE } from './ai-credit-calc';

export class RechargeError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'RechargeError';
    this.code = code;
  }
}

/** ai_credit_transactions.idempotency_key NOT NULL 안전 + 재시도 중복 방지용 키. */
function idemKey(prefix: string, companyId: string): string {
  return `${prefix}:${companyId}:${Date.now()}:${Math.floor(Math.random() * 1e9)}`;
}

/** 선불 즉시 충전 — 발송 잔액 차감 + 구매분 지급 (원자 트랜잭션). */
export async function rechargePrepaid(opts: { companyId: string; credits: number; userId?: string | null }) {
  const { credits: c, supply, vat, total } = calcRechargeAmount(opts.credits);
  if (c <= 0) throw new RechargeError('충전 크레딧은 1 이상이어야 합니다.', 'INVALID_AMOUNT');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const co = await client.query(
      `SELECT billing_type, balance, ai_credits_base_remaining AS base, ai_credits_purchased AS purchased
         FROM companies WHERE id = $1::uuid FOR UPDATE`,
      [opts.companyId]
    );
    if (co.rows.length === 0) { await client.query('ROLLBACK'); throw new RechargeError('회사를 찾을 수 없습니다.'); }
    const row = co.rows[0];
    if (String(row.billing_type) !== 'prepaid') { await client.query('ROLLBACK'); throw new RechargeError('선불 회사가 아닙니다.', 'NOT_PREPAID'); }

    const balance = Number(row.balance) || 0;
    if (balance < total) {
      await client.query('ROLLBACK');
      throw new RechargeError(`잔액이 부족합니다. 필요 ${total.toLocaleString()}원 / 현재 ${balance.toLocaleString()}원`, 'INSUFFICIENT_BALANCE');
    }

    // 1) 발송 잔액 차감 (FOR UPDATE 보유 상태 — 음수 불가)
    const balRes = await client.query(
      `UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid RETURNING balance`,
      [total, opts.companyId]
    );
    const newBalance = Number(balRes.rows[0].balance);

    // 2) 구매분 크레딧 지급
    const purchasedAfter = (Number(row.purchased) || 0) + c;
    await client.query(`UPDATE companies SET ai_credits_purchased = $2 WHERE id = $1::uuid`, [opts.companyId, purchasedAfter]);

    // 3) 크레딧 이력 (purchase)
    const txRes = await client.query(
      `INSERT INTO ai_credit_transactions
         (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, created_by, reason)
       VALUES ($1::uuid, 'purchase', $2, 'purchased', 'credit-recharge', $3, $4, $5, $6, $7)
       RETURNING id`,
      [opts.companyId, c, idemKey('recharge', opts.companyId), Number(row.base) || 0, purchasedAfter, opts.userId || null,
        `선불 충전 ${c.toLocaleString()} 크레딧 (VAT 포함 ${total.toLocaleString()}원)`]
    );
    const creditTxId = txRes.rows[0].id;

    // 4) 선불 잔액 이력 (deduct) — 선불충전금 사용 이력
    await client.query(
      `INSERT INTO balance_transactions
         (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method, created_by)
       VALUES ($1::uuid, 'deduct', $2, $3, $4, 'credit_recharge', $5::uuid, 'system', $6)`,
      [opts.companyId, total, newBalance, `AI 크레딧 ${c.toLocaleString()} 충전 (VAT 포함)`, creditTxId, opts.userId || null]
    );

    // 5) 충전 요청·이력 (선불 = 즉시 완료)
    const reqRes = await client.query(
      `INSERT INTO ai_credit_requests
         (company_id, user_id, credits, unit_price, supply_amount, vat, total_amount, billing_type, payment_method, status, processed_at, credit_tx_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'prepaid', 'prepaid_balance', 'completed', NOW(), $8::uuid)
       RETURNING id`,
      [opts.companyId, opts.userId || null, c, CREDIT_UNIT_PRICE, supply, vat, total, creditTxId]
    );

    await client.query('COMMIT');
    return { requestId: reqRes.rows[0].id, credits: c, supply, vat, total, newBalance, purchasedAfter };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
    throw err;
  } finally {
    client.release();
  }
}

/** 후불 충전 요청 생성 (pending). 중복 pending 차단. */
export async function createRechargeRequest(opts: { companyId: string; credits: number; userId?: string | null }) {
  const { credits: c, supply, vat, total } = calcRechargeAmount(opts.credits);
  if (c <= 0) throw new RechargeError('충전 크레딧은 1 이상이어야 합니다.', 'INVALID_AMOUNT');

  const co = await pool.query(`SELECT billing_type FROM companies WHERE id = $1::uuid`, [opts.companyId]);
  if (co.rows.length === 0) throw new RechargeError('회사를 찾을 수 없습니다.');
  if (String(co.rows[0].billing_type) !== 'postpaid') throw new RechargeError('후불 회사가 아닙니다.', 'NOT_POSTPAID');

  const dup = await pool.query(
    `SELECT id FROM ai_credit_requests WHERE company_id = $1::uuid AND status = 'pending' LIMIT 1`,
    [opts.companyId]
  );
  if (dup.rows.length > 0) throw new RechargeError('이미 처리 대기 중인 충전 요청이 있습니다.', 'DUPLICATE_PENDING');

  const r = await pool.query(
    `INSERT INTO ai_credit_requests
       (company_id, user_id, credits, unit_price, supply_amount, vat, total_amount, billing_type, payment_method, status)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'postpaid', 'postpaid_invoice', 'pending')
     RETURNING id, credits, total_amount`,
    [opts.companyId, opts.userId || null, c, CREDIT_UNIT_PRICE, supply, vat, total]
  );
  return r.rows[0];
}

/** 후불 충전 요청 승인 — 구매분 지급 + 요청 approved (원자 트랜잭션). 월말 청구 대상(billed=false). */
export async function approveRechargeRequest(opts: { requestId: string; adminId: string; adminNote?: string }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqRes = await client.query(
      `SELECT company_id, credits, total_amount, status FROM ai_credit_requests WHERE id = $1::uuid FOR UPDATE`,
      [opts.requestId]
    );
    if (reqRes.rows.length === 0) { await client.query('ROLLBACK'); throw new RechargeError('충전 요청을 찾을 수 없습니다.'); }
    const req = reqRes.rows[0];
    if (req.status !== 'pending') { await client.query('ROLLBACK'); throw new RechargeError('이미 처리된 요청입니다.', 'ALREADY_PROCESSED'); }

    const credits = Number(req.credits) || 0;
    const co = await client.query(
      `SELECT ai_credits_base_remaining AS base, ai_credits_purchased AS purchased FROM companies WHERE id = $1::uuid FOR UPDATE`,
      [req.company_id]
    );
    if (co.rows.length === 0) { await client.query('ROLLBACK'); throw new RechargeError('회사를 찾을 수 없습니다.'); }

    const purchasedAfter = (Number(co.rows[0].purchased) || 0) + credits;
    await client.query(`UPDATE companies SET ai_credits_purchased = $2 WHERE id = $1::uuid`, [req.company_id, purchasedAfter]);

    const txRes = await client.query(
      `INSERT INTO ai_credit_transactions
         (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, created_by, reason)
       VALUES ($1::uuid, 'postpaid_grant', $2, 'purchased', 'credit-recharge', $3, $4, $5, $6, $7)
       RETURNING id`,
      [req.company_id, credits, idemKey('recharge-approve', req.company_id), Number(co.rows[0].base) || 0, purchasedAfter, opts.adminId,
        `후불 충전 승인 ${credits.toLocaleString()} 크레딧 (월말 청구 ${Number(req.total_amount).toLocaleString()}원)`]
    );

    await client.query(
      `UPDATE ai_credit_requests
          SET status = 'approved', processed_by = $2, processed_at = NOW(), admin_note = $3, credit_tx_id = $4::uuid
        WHERE id = $1::uuid`,
      [opts.requestId, opts.adminId, opts.adminNote || null, txRes.rows[0].id]
    );

    await client.query('COMMIT');
    return { credits, purchasedAfter };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
    throw err;
  } finally {
    client.release();
  }
}

/** 후불 충전 요청 거절 (pending 만). */
export async function rejectRechargeRequest(opts: { requestId: string; adminId: string; adminNote: string }) {
  const r = await pool.query(
    `UPDATE ai_credit_requests
        SET status = 'rejected', processed_by = $2, processed_at = NOW(), admin_note = $3
      WHERE id = $1::uuid AND status = 'pending'
      RETURNING id`,
    [opts.requestId, opts.adminId, opts.adminNote]
  );
  if (r.rows.length === 0) throw new RechargeError('대기 중인 요청이 아닙니다.', 'NOT_PENDING');
  return { rejected: true };
}

/** 충전 요청 목록 (companyId 지정=사용자 / 미지정=슈퍼관리자 전체). */
export async function getRechargeRequests(opts: { companyId?: string; status?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = opts.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: any[] = [];
  if (opts.companyId) { params.push(opts.companyId); where.push(`r.company_id = $${params.length}::uuid`); }
  if (opts.status) { params.push(opts.status); where.push(`r.status = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const cnt = await pool.query(`SELECT COUNT(*) AS c FROM ai_credit_requests r ${whereSql}`, params);

  params.push(pageSize);
  params.push(offset);
  const list = await pool.query(
    `SELECT r.id, r.company_id, c.company_name, r.credits, r.total_amount, r.billing_type,
            r.payment_method, r.status, r.admin_note, r.created_at, r.processed_at
       FROM ai_credit_requests r
       LEFT JOIN companies c ON r.company_id = c.id
       ${whereSql}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { rows: list.rows, total: Number(cnt.rows[0].c) || 0, page, pageSize };
}
