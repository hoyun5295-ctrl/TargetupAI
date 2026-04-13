/**
 * ★ CT-F03 — 전단AI 과금/결제 컨트롤타워
 *
 * 한줄로 utils/prepaid.ts와 완전 분리.
 * - 전단AI는 매장당 월 15만원 + 문자 100% 선불 (후불 없음)
 * - 과금 주체: flyer_users (매장). flyer_companies(총판)는 상위 차단만.
 * - flyer_billing_history에 월별 청구 기록
 *
 * D113: 매장별 과금 체계로 전환. canFlyerStoreSend + deductFlyerPrepaid + refundFlyerPrepaid 신설.
 * 기존 canFlyerCompanySend는 총판 레벨 체크용으로 유지 (하위호환).
 */

import { query } from '../../../config/database';

export interface FlyerBillingSummary {
  company_id: string;
  month: string; // YYYY-MM
  sms_count: number;
  lms_count: number;
  mms_count: number;
  total_cost: number;
}

/**
 * 회사 월 발송량 집계 (flyer_campaigns 기준).
 * 기본 정액 15만원 + 초과분 (단가 x 발송수) 계산.
 */
export async function aggregateFlyerMonthlyUsage(
  companyId: string,
  yearMonth: string // 'YYYY-MM'
): Promise<FlyerBillingSummary> {
  const [year, month] = yearMonth.split('-').map(Number);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;

  const result = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN message_type='SMS' THEN success_count ELSE 0 END), 0)::int AS sms,
       COALESCE(SUM(CASE WHEN message_type='LMS' THEN success_count ELSE 0 END), 0)::int AS lms,
       COALESCE(SUM(CASE WHEN message_type='MMS' THEN success_count ELSE 0 END), 0)::int AS mms
     FROM flyer_campaigns
     WHERE company_id = $1
       AND sent_at >= ($2::date || ' 00:00:00+09')::timestamptz
       AND sent_at <  (($2::date + INTERVAL '1 month')::date || ' 00:00:00+09')::timestamptz
       AND status = 'completed'`,
    [companyId, monthStart]
  );

  const { sms, lms, mms } = result.rows[0] || { sms: 0, lms: 0, mms: 0 };

  // 단가 조회
  const priceRes = await query(
    `SELECT sms_unit_price, lms_unit_price, mms_unit_price, monthly_fee
     FROM flyer_companies WHERE id = $1`,
    [companyId]
  );
  const c = priceRes.rows[0] || {};
  const sendCost = sms * Number(c.sms_unit_price || 9) +
                   lms * Number(c.lms_unit_price || 29) +
                   mms * Number(c.mms_unit_price || 80);

  return {
    company_id: companyId,
    month: yearMonth,
    sms_count: sms,
    lms_count: lms,
    mms_count: mms,
    total_cost: Number(c.monthly_fee || 150000) + sendCost,
  };
}

/**
 * 월별 청구 기록 생성 (매월 1일 배치에서 호출).
 */
export async function recordFlyerMonthlyBilling(companyId: string, yearMonth: string): Promise<void> {
  const summary = await aggregateFlyerMonthlyUsage(companyId, yearMonth);
  const monthStart = `${yearMonth}-01`;

  const feeRes = await query(`SELECT monthly_fee FROM flyer_companies WHERE id = $1`, [companyId]);
  const monthlyFee = Number(feeRes.rows[0]?.monthly_fee || 150000);
  const overage = Math.max(0, summary.total_cost - monthlyFee);

  await query(
    `INSERT INTO flyer_billing_history
       (id, company_id, billing_month, monthly_fee, sms_overage, total_amount, payment_status, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'pending', NOW())
     ON CONFLICT (company_id, billing_month) DO UPDATE SET
       monthly_fee = EXCLUDED.monthly_fee,
       sms_overage = EXCLUDED.sms_overage,
       total_amount = EXCLUDED.total_amount`,
    [companyId, monthStart, monthlyFee, overage, summary.total_cost]
  );
}

/**
 * [하위호환] 총판(flyer_companies) 레벨 발송 가능 여부.
 * 총판 정지 시 하위 전체 매장 차단. canFlyerStoreSend에서 내부 호출됨.
 */
export async function canFlyerCompanySend(companyId: string): Promise<{ ok: boolean; reason?: string }> {
  const result = await query(
    `SELECT payment_status, plan_expires_at FROM flyer_companies WHERE id = $1`,
    [companyId]
  );
  if (result.rows.length === 0) return { ok: false, reason: 'company_not_found' };

  const c = result.rows[0];
  if (c.payment_status === 'suspended') return { ok: false, reason: '총판 계정이 정지되었습니다' };
  if (c.plan_expires_at && new Date(c.plan_expires_at) < new Date()) {
    return { ok: false, reason: '총판 구독 기간이 만료되었습니다' };
  }
  return { ok: true };
}

/**
 * ★ D113: 매장(flyer_users) 레벨 발송 가능 여부 확인.
 * 1. 매장 payment_status + plan_expires_at 체크
 * 2. 총판(flyer_companies) 레벨도 체크 (상위 차단)
 */
export async function canFlyerStoreSend(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const userRes = await query(
    `SELECT u.payment_status, u.plan_expires_at, u.company_id
     FROM flyer_users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId]
  );
  if (userRes.rows.length === 0) return { ok: false, reason: '매장 정보를 찾을 수 없습니다' };

  const u = userRes.rows[0];

  // 매장 레벨 체크
  if (u.payment_status === 'suspended') return { ok: false, reason: '매장 구독이 정지되었습니다' };
  if (u.payment_status === 'pending') return { ok: false, reason: '매장 구독이 아직 활성화되지 않았습니다' };
  if (u.plan_expires_at && new Date(u.plan_expires_at) < new Date()) {
    return { ok: false, reason: '매장 구독 기간이 만료되었습니다' };
  }

  // 총판 레벨 체크
  return canFlyerCompanySend(u.company_id);
}

/**
 * ★ D113: 선불 잔액 차감 (Atomic).
 * prepaid_balance >= totalAmount 조건부 UPDATE로 잔액 부족 시 실패 반환.
 */
export async function deductFlyerPrepaid(
  userId: string,
  count: number,
  messageType: 'SMS' | 'LMS' | 'MMS'
): Promise<{ ok: boolean; deducted?: number; balance?: number; reason?: string }> {
  // 단가 조회
  const priceRes = await query(
    `SELECT sms_unit_price, lms_unit_price, mms_unit_price, prepaid_balance
     FROM flyer_users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (priceRes.rows.length === 0) return { ok: false, reason: '매장 정보를 찾을 수 없습니다' };

  const u = priceRes.rows[0];
  const priceMap: Record<string, number> = {
    SMS: Number(u.sms_unit_price || 9),
    LMS: Number(u.lms_unit_price || 29),
    MMS: Number(u.mms_unit_price || 80),
  };
  const unitPrice = priceMap[messageType] || 9;
  const totalAmount = Math.ceil(unitPrice * count);

  // Atomic 차감: balance >= totalAmount 조건
  const updateRes = await query(
    `UPDATE flyer_users
     SET prepaid_balance = prepaid_balance - $1
     WHERE id = $2 AND prepaid_balance >= $1 AND deleted_at IS NULL
     RETURNING prepaid_balance`,
    [totalAmount, userId]
  );

  if (updateRes.rows.length === 0) {
    const currentBalance = Number(u.prepaid_balance || 0);
    return {
      ok: false,
      balance: currentBalance,
      reason: `잔액이 부족합니다 (필요: ₩${totalAmount.toLocaleString()}, 잔액: ₩${currentBalance.toLocaleString()})`,
    };
  }

  return {
    ok: true,
    deducted: totalAmount,
    balance: Number(updateRes.rows[0].prepaid_balance),
  };
}

/**
 * ★ D113: 선불 잔액 환불 (발송 취소 시).
 */
export async function refundFlyerPrepaid(
  userId: string,
  amount: number
): Promise<{ ok: boolean; balance?: number }> {
  if (amount <= 0) return { ok: true };

  const result = await query(
    `UPDATE flyer_users
     SET prepaid_balance = prepaid_balance + $1
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING prepaid_balance`,
    [amount, userId]
  );

  if (result.rows.length === 0) return { ok: false };
  return { ok: true, balance: Number(result.rows[0].prepaid_balance) };
}
