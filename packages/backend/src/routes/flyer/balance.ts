/**
 * ★ 전단AI 잔액/과금 라우트
 * 마운트: /api/flyer/balance
 * CT: CT-F03 flyer-billing.ts
 */

import { Request, Response, Router } from 'express';
import { query } from '../../config/database';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
import { aggregateFlyerMonthlyUsage } from '../../utils/flyer';

const router = Router();
router.use(flyerAuthenticate);

/**
 * GET / — 현재 플랜 + 이번 달 발송량 요약
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { companyId, userId } = req.flyerUser!;

    // ★ D114: 매장(flyer_users) 정보 우선 — 이용료/잔액/구독상태는 매장 단위
    const userRes = await query(
      `SELECT u.monthly_fee, u.prepaid_balance, u.payment_status, u.plan_started_at, u.plan_expires_at,
              c.sms_unit_price, c.lms_unit_price, c.mms_unit_price
       FROM flyer_users u
       JOIN flyer_companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Store not found' });

    const store = userRes.rows[0];
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const usage = await aggregateFlyerMonthlyUsage(companyId, yearMonth);

    return res.json({
      balance: Number(store.prepaid_balance || 0),
      billing_type: 'prepaid',
      costPerSms: Number(store.sms_unit_price || 9),
      costPerLms: Number(store.lms_unit_price || 29),
      costPerMms: Number(store.mms_unit_price || 80),
      plan: {
        monthly_fee: Number(store.monthly_fee || 150000),
        payment_status: store.payment_status,
        plan_started_at: store.plan_started_at,
        plan_expires_at: store.plan_expires_at,
      },
      currentMonth: yearMonth,
      usage,
    });
  } catch (error: any) {
    console.error('[flyer/balance] get error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /history — 과금 이력 (월별)
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const result = await query(
      `SELECT billing_month, monthly_fee, sms_overage, total_amount, payment_status, paid_at
       FROM flyer_billing_history
       WHERE company_id = $1
       ORDER BY billing_month DESC
       LIMIT 12`,
      [companyId]
    );
    return res.json(result.rows);
  } catch (error: any) {
    console.error('[flyer/balance] history error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /transactions — 거래 내역 (프론트 BalancePage 호환)
 */
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const result = await query(
      `SELECT id, billing_month, monthly_fee, sms_overage, total_amount, payment_status, paid_at, created_at
       FROM flyer_billing_history
       WHERE company_id = $1
       ORDER BY billing_month DESC
       LIMIT 50`,
      [companyId]
    );
    return res.json({ transactions: result.rows, total: result.rows.length });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /summary — 최근 N개월 월별 요약
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const months = parseInt(String(req.query.months || '6'), 10);
    const result = await query(
      `SELECT TO_CHAR(billing_month, 'YYYY-MM') AS month, total_amount, sms_overage, payment_status
       FROM flyer_billing_history
       WHERE company_id = $1
         AND billing_month >= (CURRENT_DATE - ($2 || ' months')::interval)
       ORDER BY billing_month DESC`,
      [companyId, months]
    );
    return res.json({ summary: result.rows });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /deposit-request — 입금 요청 (전단AI는 정액제이므로 간단 처리)
 */
router.post('/deposit-request', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.flyerUser!;
    const { amount, depositorName } = req.body;
    if (!amount || !depositorName) {
      return res.status(400).json({ error: '금액과 입금자명을 입력해주세요' });
    }
    // 입금 요청 기록 (billing_history에 pending으로 INSERT)
    await query(
      `INSERT INTO flyer_billing_history (id, company_id, billing_month, monthly_fee, total_amount, payment_status, created_at)
       VALUES (gen_random_uuid(), $1, DATE_TRUNC('month', CURRENT_DATE), $2, $2, 'pending', NOW())
       ON CONFLICT (company_id, billing_month) DO UPDATE SET
         total_amount = flyer_billing_history.total_amount + EXCLUDED.total_amount`,
      [companyId, amount]
    );
    return res.json({ message: '입금 요청이 등록되었습니다', amount, depositorName });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * ★ D114: POST /subscribe — 이용료 결제 (매장 사장님이 직접)
 * 잔액에서 monthly_fee(15만원) 차감 → payment_status='active' + 30일 사용기간
 * 잔액 부족 시 실패. 이미 active이고 만료 전이면 기간 연장(+30일).
 */
router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const userId = req.flyerUser!.userId;

    // 매장 정보 조회
    const userRes = await query(
      `SELECT id, store_name, monthly_fee, prepaid_balance, payment_status, plan_expires_at
       FROM flyer_users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: '매장 정보를 찾을 수 없습니다' });

    const store = userRes.rows[0];
    const fee = Number(store.monthly_fee || 150000);
    const balance = Number(store.prepaid_balance || 0);

    if (balance < fee) {
      return res.status(400).json({
        error: `잔액이 부족합니다. 이용료 ₩${fee.toLocaleString()} / 현재 잔액 ₩${balance.toLocaleString()}`,
        code: 'INSUFFICIENT_BALANCE',
        required: fee,
        balance,
      });
    }

    // 잔액 차감 + active + 30일 (이미 active이면 기존 만료일에서 +30일 연장)
    const result = await query(
      `UPDATE flyer_users
       SET prepaid_balance = prepaid_balance - $1,
           payment_status = 'active',
           plan_started_at = CASE WHEN payment_status != 'active' THEN CURRENT_DATE ELSE plan_started_at END,
           plan_expires_at = CASE
             WHEN payment_status = 'active' AND plan_expires_at > CURRENT_DATE
               THEN plan_expires_at + INTERVAL '30 days'
             ELSE CURRENT_DATE + INTERVAL '30 days'
           END,
           updated_at = NOW()
       WHERE id = $2 AND prepaid_balance >= $1 AND deleted_at IS NULL
       RETURNING id, store_name, prepaid_balance, payment_status, plan_started_at, plan_expires_at`,
      [fee, userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: '결제 처리에 실패했습니다. 다시 시도해주세요.' });
    }

    const updated = result.rows[0];
    console.log(`[flyer/balance] 이용료 결제: ${updated.store_name} ₩${fee.toLocaleString()} → 잔액 ₩${Number(updated.prepaid_balance).toLocaleString()}, 만료 ${updated.plan_expires_at}`);

    return res.json({
      success: true,
      message: `이용료 ₩${fee.toLocaleString()} 결제 완료! 30일간 전단AI를 이용하실 수 있습니다.`,
      fee,
      balance: Number(updated.prepaid_balance),
      plan_expires_at: updated.plan_expires_at,
    });
  } catch (error: any) {
    console.error('[flyer/balance] subscribe error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

export default router;
