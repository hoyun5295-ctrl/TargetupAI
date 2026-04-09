/**
 * ★ CT-F03 — 전단AI 과금/결제 컨트롤타워
 *
 * 한줄로 utils/prepaid.ts와 완전 분리.
 * - 전단AI는 월 15만원 정액제 + 발송량 초과분 과금
 * - flyer_billing_history에 월별 청구 기록
 * - flyer_companies.plan_expires_at 관리
 *
 * 발송 시 차감 로직은 없음 (정액제). 단 월말 배치로 초과 발송량 계산하여 익월 청구에 포함.
 */

import { query } from '../../config/database';

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
 * 발송 가능 여부 확인 (결제 상태 + 플랜 만료).
 */
export async function canFlyerCompanySend(companyId: string): Promise<{ ok: boolean; reason?: string }> {
  const result = await query(
    `SELECT payment_status, plan_expires_at FROM flyer_companies WHERE id = $1`,
    [companyId]
  );
  if (result.rows.length === 0) return { ok: false, reason: 'company_not_found' };

  const c = result.rows[0];
  if (c.payment_status === 'suspended') return { ok: false, reason: '구독이 정지되었습니다' };
  if (c.plan_expires_at && new Date(c.plan_expires_at) < new Date()) {
    return { ok: false, reason: '구독 기간이 만료되었습니다' };
  }
  return { ok: true };
}
