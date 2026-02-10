import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

// GET /api/balance - 현재 잔액 + 요금 정보 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const result = await query(
      `SELECT billing_type, balance, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao
       FROM companies WHERE id = $1`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }

    const c = result.rows[0];
    res.json({
      billingType: c.billing_type,
      balance: Number(c.balance),
      costPerSms: Number(c.cost_per_sms || 0),
      costPerLms: Number(c.cost_per_lms || 0),
      costPerMms: Number(c.cost_per_mms || 0),
      costPerKakao: Number(c.cost_per_kakao || 0),
    });
  } catch (error) {
    console.error('잔액 조회 실패:', error);
    res.status(500).json({ error: '잔액 조회 실패' });
  }
});

// GET /api/balance/transactions - 잔액 변동 이력 (페이지네이션)
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const type = req.query.type as string; // charge, deduct, refund 등 필터
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    let where = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (type) {
      where += ` AND type = $${paramIdx++}`;
      params.push(type);
    }
    if (startDate) {
      where += ` AND created_at >= $${paramIdx++}::date`;
      params.push(startDate);
    }
    if (endDate) {
      where += ` AND created_at < ($${paramIdx++}::date + INTERVAL '1 day')`;
      params.push(endDate);
    }

    // 총 건수
    const countResult = await query(
      `SELECT COUNT(*) FROM balance_transactions ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // 이력 조회
    const result = await query(
      `SELECT id, type, amount, balance_after, description, reference_type, reference_id, created_at
       FROM balance_transactions ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    res.json({
      transactions: result.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('잔액 이력 조회 실패:', error);
    res.status(500).json({ error: '잔액 이력 조회 실패' });
  }
});

// GET /api/balance/summary - 월별 충전/차감/환불 요약
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const months = parseInt(req.query.months as string) || 6;

    const result = await query(
      `SELECT
         TO_CHAR(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') as month,
         SUM(CASE WHEN type IN ('charge', 'deposit_charge', 'admin_charge') THEN amount ELSE 0 END) as total_charged,
         SUM(CASE WHEN type = 'deduct' THEN amount ELSE 0 END) as total_deducted,
         SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) as total_refunded,
         SUM(CASE WHEN type = 'admin_deduct' THEN amount ELSE 0 END) as total_admin_deducted,
         COUNT(*) as transaction_count
       FROM balance_transactions
       WHERE company_id = $1
         AND created_at >= NOW() - ($2 || ' months')::INTERVAL
       GROUP BY month
       ORDER BY month DESC`,
      [companyId, months]
    );

    res.json({ summary: result.rows });
  } catch (error) {
    console.error('잔액 요약 조회 실패:', error);
    res.status(500).json({ error: '잔액 요약 조회 실패' });
  }
});

// POST /api/balance/deposit-request - 무통장입금 요청
router.post('/deposit-request', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { amount, depositorName } = req.body;

    if (!amount || amount < 1000) {
      return res.status(400).json({ error: '1,000원 이상 입력해주세요.' });
    }
    if (!depositorName || depositorName.trim() === '') {
      return res.status(400).json({ error: '입금자명을 입력해주세요.' });
    }

    // 선불 고객사인지 확인
    const companyResult = await query(
      'SELECT billing_type, company_name FROM companies WHERE id = $1',
      [companyId]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }
    if (companyResult.rows[0].billing_type !== 'prepaid') {
      return res.status(400).json({ error: '선불 요금제 고객사만 이용 가능합니다.' });
    }

    // 중복 요청 방지 (같은 회사, 같은 금액, 10분 이내 pending 요청)
    const duplicateCheck = await query(
      `SELECT id FROM deposit_requests 
       WHERE company_id = $1 AND amount = $2 AND status = 'pending' 
         AND created_at > NOW() - INTERVAL '10 minutes'`,
      [companyId, amount]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ error: '동일 금액의 입금 요청이 이미 접수되어 있습니다. 잠시 후 다시 시도해주세요.' });
    }

    // deposit_requests에 저장
    const result = await query(
      `INSERT INTO deposit_requests (company_id, amount, depositor_name, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING id, amount, depositor_name, status, created_at`,
      [companyId, amount, depositorName.trim()]
    );

    const companyName = companyResult.rows[0].company_name;
    console.log(`[무통장입금요청] ${companyName}: ${Number(amount).toLocaleString()}원 / 입금자: ${depositorName.trim()}`);

    res.status(201).json({
      message: '입금 확인 요청이 접수되었습니다.',
      request: result.rows[0],
    });
  } catch (error) {
    console.error('무통장입금 요청 실패:', error);
    res.status(500).json({ error: '무통장입금 요청 실패' });
  }
});

export default router;
