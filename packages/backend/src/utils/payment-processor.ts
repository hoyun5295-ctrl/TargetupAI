// utils/payment-processor.ts (CT-42)
// 결제 흐름 통합 — 트랜잭션 + idempotent + balance 증가
// SoT: status/legacy-payment-migration.md §6-2
//
// 진정 흐름:
//  1) createPendingPayment(/prepare) → payments INSERT (status='pending', pg_order_id 영역)
//  2) Frontend INIStdPay.pay → 이니시스 결제창 → P_NEXT_URL form POST
//  3) approveInicisPayment(inicis-client) → authUrl POST + signature 검증
//  4) finalizePaymentSuccess(/return) → payments UPDATE (status='pending'→'completed') 트랜잭션
//     + companies.balance UPDATE + balance_transactions INSERT (idempotent: status='pending' 가드)
//  5) finalizePaymentFailure(/return 실패 또는 /close) → payments UPDATE (status='pending'→'failed'|'cancelled')

import { pool } from '../config/database';
import type { InicisApprovalResult } from './inicis-client';

// ── 1단계: pending payment 생성 ────────────────────────────

export interface CreatePendingPaymentInput {
  companyId: string;
  userId: string | null;
  orderId: string;
  amount: number;
  productName: string;
  buyerName: string;
  buyerEmail: string;
  buyerTel: string;
}

export interface CreatePendingPaymentResult {
  paymentId: string;
}

export async function createPendingPayment(input: CreatePendingPaymentInput): Promise<CreatePendingPaymentResult> {
  if (!input.amount || input.amount < 1000) {
    throw new Error('[payment-processor] 결제 금액 1,000원 이상');
  }

  const result = await pool.query(
    `INSERT INTO payments (
      company_id, user_id, payment_method, pg_provider,
      pg_order_id, amount, status,
      buyer_name, buyer_tel, buyer_email, product_name,
      created_at
    ) VALUES (
      $1, $2, 'card', 'inicis',
      $3, $4, 'pending',
      $5, $6, $7, $8,
      NOW()
    )
    RETURNING id`,
    [
      input.companyId,
      input.userId,
      input.orderId,
      input.amount,
      input.buyerName,
      input.buyerTel,
      input.buyerEmail,
      input.productName,
    ]
  );

  console.log(`[payment-processor] pending payment 생성: companyId=${input.companyId}, orderId=${input.orderId}, amount=${input.amount}`);

  return { paymentId: result.rows[0].id };
}

// ── 2단계: 결제 성공 확정 (pending → completed) ──────────

export interface FinalizePaymentSuccessInput {
  orderId: string;
  approval: InicisApprovalResult;
}

export interface FinalizePaymentSuccessResult {
  paymentId: string;
  companyId: string;
  userId: string | null;
  amount: number;
  alreadyProcessed: boolean;
  newBalance: number;
}

export async function finalizePaymentSuccess(input: FinalizePaymentSuccessInput): Promise<FinalizePaymentSuccessResult> {
  const { approval, orderId } = input;

  if (!approval.success) {
    throw new Error(`[payment-processor] 결제 승인 실패 상태: ${approval.resultCode} ${approval.resultMsg}`);
  }
  if (!approval.tid) {
    throw new Error('[payment-processor] 결제 승인 응답에 tid 누락');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) pending payment row lock + 조회
    const pendingResult = await client.query(
      `SELECT id, company_id, user_id, amount, status, pg_payment_key
       FROM payments
       WHERE pg_order_id = $1 AND pg_provider = 'inicis'
       FOR UPDATE`,
      [orderId]
    );

    if (pendingResult.rows.length === 0) {
      throw new Error(`[payment-processor] pending payment 영역 미존재: orderId=${orderId}`);
    }

    const pending = pendingResult.rows[0];

    // idempotent — 이미 completed 영역
    if (pending.status === 'completed') {
      const companyResult = await client.query(
        `SELECT balance FROM companies WHERE id = $1`,
        [pending.company_id]
      );
      await client.query('COMMIT');
      console.log(`[payment-processor] 이미 처리된 결제 (idempotent): orderId=${orderId}, paymentId=${pending.id}`);
      return {
        paymentId: pending.id,
        companyId: pending.company_id,
        userId: pending.user_id,
        amount: Number(pending.amount),
        alreadyProcessed: true,
        newBalance: Number(companyResult.rows[0]?.balance || 0),
      };
    }

    if (pending.status !== 'pending') {
      throw new Error(`[payment-processor] pending 영역 X (status=${pending.status}): orderId=${orderId}`);
    }

    // 2) 금액 위변조 검증
    const dbAmount = Number(pending.amount);
    if (approval.totPrice) {
      const totPriceNum = Number(String(approval.totPrice).replace(/[^0-9.]/g, ''));
      if (totPriceNum > 0 && Math.abs(totPriceNum - dbAmount) > 0.5) {
        throw new Error(`[payment-processor] 결제 금액 위변조: db=${dbAmount}, inicis=${totPriceNum}`);
      }
    }

    // 3) payments UPDATE (pending → completed)
    const updateResult = await client.query(
      `UPDATE payments
       SET status = 'completed',
           pg_payment_key = $1,
           card_company = $2,
           card_quota = $3,
           result_code = $4,
           result_msg = $5,
           pg_response = $6,
           paid_at = NOW()
       WHERE id = $7 AND status = 'pending'
       RETURNING id`,
      [
        approval.tid,
        approval.cardName || null,
        approval.cardQuota ? parseInt(String(approval.cardQuota), 10) : null,
        approval.resultCode,
        approval.resultMsg,
        JSON.stringify(approval.raw),
        pending.id,
      ]
    );

    if (updateResult.rows.length === 0) {
      throw new Error(`[payment-processor] payments UPDATE 영역 실패 (동시 처리?): id=${pending.id}`);
    }

    // 4) companies.balance 증가
    const balanceResult = await client.query(
      `UPDATE companies
       SET balance = balance + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING balance`,
      [dbAmount, pending.company_id]
    );

    if (balanceResult.rows.length === 0) {
      throw new Error(`[payment-processor] 회사 영역 미존재: ${pending.company_id}`);
    }

    const newBalance = Number(balanceResult.rows[0].balance);

    // 5) balance_transactions INSERT (charge)
    const description = `카드결제 충전 (${dbAmount.toLocaleString()}원${approval.cardName ? ` · ${approval.cardName}` : ''}${approval.cardQuota && Number(approval.cardQuota) > 0 ? ` · ${approval.cardQuota}개월` : ''})`;

    await client.query(
      `INSERT INTO balance_transactions (
        company_id, type, amount, balance_after, description,
        reference_type, reference_id, created_by, created_at
      ) VALUES (
        $1, 'charge', $2, $3, $4,
        'payment', $5, $6, NOW()
      )`,
      [
        pending.company_id,
        dbAmount,
        newBalance,
        description,
        pending.id,
        pending.user_id,
      ]
    );

    await client.query('COMMIT');

    console.log(`[payment-processor] 결제 성공 확정: companyId=${pending.company_id}, paymentId=${pending.id}, amount=${dbAmount}, tid=${approval.tid}, newBalance=${newBalance}`);

    return {
      paymentId: pending.id,
      companyId: pending.company_id,
      userId: pending.user_id,
      amount: dbAmount,
      alreadyProcessed: false,
      newBalance,
    };
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[payment-processor] 트랜잭션 ROLLBACK:', err.message || err);
    throw err;
  } finally {
    client.release();
  }
}

// ── 3단계: 결제 실패/취소 (pending → failed|cancelled) ───

export interface FinalizePaymentFailureInput {
  orderId: string;
  resultCode: string;
  resultMsg: string;
  rawResponse: Record<string, any>;
  status: 'failed' | 'cancelled';
}

export interface FinalizePaymentFailureResult {
  paymentId: string | null;
  companyId: string | null;
  amount: number;
}

export async function finalizePaymentFailure(input: FinalizePaymentFailureInput): Promise<FinalizePaymentFailureResult> {
  const result = await pool.query(
    `UPDATE payments
     SET status = $1,
         result_code = $2,
         result_msg = $3,
         pg_response = $4,
         cancelled_at = NOW()
     WHERE pg_order_id = $5 AND pg_provider = 'inicis' AND status = 'pending'
     RETURNING id, company_id, amount`,
    [
      input.status,
      input.resultCode,
      input.resultMsg,
      JSON.stringify(input.rawResponse),
      input.orderId,
    ]
  );

  if (result.rows.length === 0) {
    console.warn(`[payment-processor] 실패 처리 대상 pending row 미존재: orderId=${input.orderId}`);
    return { paymentId: null, companyId: null, amount: 0 };
  }

  console.log(`[payment-processor] 결제 ${input.status === 'cancelled' ? '취소' : '실패'} 처리: orderId=${input.orderId}, paymentId=${result.rows[0].id}, resultCode=${input.resultCode}`);

  return {
    paymentId: result.rows[0].id,
    companyId: result.rows[0].company_id,
    amount: Number(result.rows[0].amount),
  };
}
