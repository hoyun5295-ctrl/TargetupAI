// utils/prepaid.ts
// ★ 메시징 컨트롤타워 — 선불 잔액 관리의 유일한 진입점
// 포인트 차감/환불은 이 모듈을 통해서만 수행한다.
// 하드코딩 금지. DB 기반 단가 조회.

import { query } from '../config/database';

/** 선불 차감 */
export async function prepaidDeduct(
  companyId: string, count: number, messageType: string, referenceId: string
): Promise<{ ok: boolean; error?: string; amount?: number; balance?: number; insufficientBalance?: boolean }> {
  const co = await query(
    'SELECT billing_type, balance, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1',
    [companyId]
  );
  if (co.rows.length === 0) return { ok: false, error: '회사 정보를 찾을 수 없습니다' };

  const c = co.rows[0];
  if (c.billing_type !== 'prepaid') return { ok: true, amount: 0 }; // 후불은 패스

  const unitPrice = messageType === 'SMS' ? Number(c.cost_per_sms || 0)
    : messageType === 'LMS' ? Number(c.cost_per_lms || 0)
    : messageType === 'MMS' ? Number(c.cost_per_mms || 0)
    : messageType === 'KAKAO' ? Number(c.cost_per_kakao || 0) : 0;

  const totalAmount = Math.round(unitPrice * count * 100) / 100; // 부동소수점 보정
  if (totalAmount === 0) return { ok: true, amount: 0 };

  // Atomic 차감: balance >= totalAmount 일 때만 성공
  const result = await query(
    'UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2 AND balance >= $1 RETURNING balance',
    [totalAmount, companyId]
  );

  if (result.rows.length === 0) {
    return {
      ok: false,
      error: `잔액이 부족합니다. 필요: ${totalAmount.toLocaleString()}원 / 현재: ${Number(c.balance).toLocaleString()}원`,
      amount: totalAmount,
      balance: Number(c.balance),
      insufficientBalance: true
    };
  }

  // 거래 기록
  await query(
    `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method)
     VALUES ($1, 'deduct', $2, $3, $4, 'campaign', $5, 'system')`,
    [companyId, totalAmount, result.rows[0].balance, `${messageType} ${count}건 발송 차감 (건당 ${unitPrice}원)`, referenceId]
  );

  console.log(`[선불차감] company=${companyId} ${messageType}×${count} = ${totalAmount}원 차감 → 잔액 ${result.rows[0].balance}원`);
  return { ok: true, amount: totalAmount, balance: Number(result.rows[0].balance) };
}

/** 선불 환불 (실패건 또는 취소) — 중복 환불 방지 포함 */
export async function prepaidRefund(
  companyId: string, count: number, messageType: string, campaignId: string, reason: string
): Promise<{ refunded: number }> {
  const co = await query(
    'SELECT billing_type, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1',
    [companyId]
  );
  if (co.rows.length === 0 || co.rows[0].billing_type !== 'prepaid') return { refunded: 0 };
  if (count <= 0) return { refunded: 0 };

  const c = co.rows[0];
  const unitPrice = messageType === 'SMS' ? Number(c.cost_per_sms || 0)
    : messageType === 'LMS' ? Number(c.cost_per_lms || 0)
    : messageType === 'MMS' ? Number(c.cost_per_mms || 0)
    : messageType === 'KAKAO' ? Number(c.cost_per_kakao || 0) : 0;

  // 이미 환불된 금액 조회 (중복 환불 방지)
  const existing = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM balance_transactions
     WHERE company_id = $1 AND type = 'refund' AND reference_type = 'campaign' AND reference_id = $2`,
    [companyId, campaignId]
  );
  const alreadyRefunded = Number(existing.rows[0].total);

  // 원래 차감 금액 조회
  const deducted = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM balance_transactions
     WHERE company_id = $1 AND type = 'deduct' AND reference_type = 'campaign' AND reference_id = $2`,
    [companyId, campaignId]
  );
  const totalDeducted = Number(deducted.rows[0].total);

  const refundAmount = Math.round(Math.min(unitPrice * count, totalDeducted - alreadyRefunded) * 100) / 100;
  if (refundAmount <= 0) return { refunded: 0 };

  const result = await query(
    'UPDATE companies SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance',
    [refundAmount, companyId]
  );

  if (result.rows.length > 0) {
    await query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method)
       VALUES ($1, 'refund', $2, $3, $4, 'campaign', $5, 'system')`,
      [companyId, refundAmount, result.rows[0].balance, `${reason} (${messageType} ${count}건 × ${unitPrice}원)`, campaignId]
    );
    console.log(`[선불환불] company=${companyId} ${refundAmount}원 환불 → 잔액 ${result.rows[0].balance}원`);
  }

  return { refunded: refundAmount };
}
