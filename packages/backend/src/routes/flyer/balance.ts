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
    const { companyId } = req.flyerUser!;

    const companyRes = await query(
      `SELECT plan_type, monthly_fee, plan_started_at, plan_expires_at, payment_status,
              sms_unit_price, lms_unit_price, mms_unit_price
       FROM flyer_companies WHERE id = $1`,
      [companyId]
    );
    if (companyRes.rows.length === 0) return res.status(404).json({ error: 'Company not found' });

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const usage = await aggregateFlyerMonthlyUsage(companyId, yearMonth);

    return res.json({
      plan: companyRes.rows[0],
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

export default router;
