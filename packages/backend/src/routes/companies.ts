import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../config/database';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';

const router = Router();

// 모든 라우트에 인증 필요
router.use(authenticate);

// GET /api/companies - 고객사 목록
router.get('/', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      whereClause += ` AND c.status = $${paramIndex++}`;
      params.push(status);
    }

    if (search) {
      whereClause += ` AND (c.company_name ILIKE $${paramIndex} OR c.company_code ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // 총 개수
    const countResult = await query(
      `SELECT COUNT(*) FROM companies c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // 목록 조회
    params.push(Number(limit), offset);
    const result = await query(
      `SELECT c.*, p.plan_name, p.plan_code
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return res.json({
      companies: result.rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('고객사 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/companies/:id - 고객사 상세
router.get('/:id', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT c.*, p.plan_name, p.plan_code, p.max_customers
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
    }

    return res.json({ company: result.rows[0] });
  } catch (error) {
    console.error('고객사 상세 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/companies - 고객사 생성
router.post('/', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const {
      companyCode,
      companyName,
      businessNumber,
      ceoName,
      contactName,
      contactEmail,
      contactPhone,
      address,
      planId,
      dataInputMethod = 'file',
    } = req.body;

    // API 키 생성
    const apiKey = `tk_${crypto.randomBytes(24).toString('hex')}`;
    const apiSecret = crypto.randomBytes(32).toString('hex');

    // DB 이름 생성
    const dbName = `targetup_${companyCode.toLowerCase()}`;

    const result = await query(
      `INSERT INTO companies (
        company_code, company_name, business_number, ceo_name,
        contact_name, contact_email, contact_phone, address,
        plan_id, data_input_method, api_key, api_secret, db_name,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        companyCode, companyName, businessNumber, ceoName,
        contactName, contactEmail, contactPhone, address,
        planId, dataInputMethod, apiKey, apiSecret, dbName,
        req.user?.userId
      ]
    );

    return res.status(201).json({
      message: '고객사가 생성되었습니다.',
      company: result.rows[0],
    });
  } catch (error: any) {
    console.error('고객사 생성 에러:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 존재하는 고객사 코드입니다.' });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// PUT /api/companies/:id - 고객사 수정
router.put('/:id', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      companyName,
      businessNumber,
      ceoName,
      contactName,
      contactEmail,
      contactPhone,
      address,
      planId,
      status,
      dataInputMethod,
    } = req.body;

    const result = await query(
      `UPDATE companies SET
        company_name = COALESCE($1, company_name),
        business_number = COALESCE($2, business_number),
        ceo_name = COALESCE($3, ceo_name),
        contact_name = COALESCE($4, contact_name),
        contact_email = COALESCE($5, contact_email),
        contact_phone = COALESCE($6, contact_phone),
        address = COALESCE($7, address),
        plan_id = COALESCE($8, plan_id),
        status = COALESCE($9, status),
        data_input_method = COALESCE($10, data_input_method),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *`,
      [
        companyName, businessNumber, ceoName, contactName,
        contactEmail, contactPhone, address, planId,
        status, dataInputMethod, id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
    }

    return res.json({
      message: '고객사가 수정되었습니다.',
      company: result.rows[0],
    });
  } catch (error) {
    console.error('고객사 수정 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/companies/:id/admin - 고객사 관리자 생성
router.post('/:id/admin', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { loginId, password, name, email, phone } = req.body;

    // 고객사 확인
    const companyResult = await query('SELECT * FROM companies WHERE id = $1', [id]);
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users (company_id, login_id, password_hash, name, email, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin')
       RETURNING id, login_id, name, email, phone, role`,
      [id, loginId, passwordHash, name, email, phone]
    );

    return res.status(201).json({
      message: '고객사 관리자가 생성되었습니다.',
      user: result.rows[0],
    });
  } catch (error: any) {
    console.error('고객사 관리자 생성 에러:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 존재하는 로그인 ID입니다.' });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 회사 설정 조회
router.get('/settings', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const result = await query(`
      SELECT 
        brand_name, business_type, reject_number,
        monthly_budget, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
        send_start_hour, send_end_hour, daily_limit_per_customer,
        holiday_send_allowed, duplicate_prevention_days,
        target_strategy, cross_category_allowed, excluded_segments,
        approval_required
      FROM companies WHERE id = $1
    `, [companyId]);
    
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('설정 조회 에러:', error);
    res.status(500).json({ error: '설정 조회 실패' });
  }
});

// 회사 설정 수정
router.put('/settings', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const {
      brand_name, business_type, reject_number,
      monthly_budget, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
      send_start_hour, send_end_hour, daily_limit_per_customer,
      holiday_send_allowed, duplicate_prevention_days,
      target_strategy, cross_category_allowed, excluded_segments,
      approval_required
    } = req.body;

    await query(`
      UPDATE companies SET
        brand_name = COALESCE($1, brand_name),
        business_type = COALESCE($2, business_type),
        reject_number = COALESCE($3, reject_number),
        monthly_budget = COALESCE($4, monthly_budget),
        cost_per_sms = COALESCE($5, cost_per_sms),
        cost_per_lms = COALESCE($6, cost_per_lms),
        cost_per_mms = COALESCE($7, cost_per_mms),
        cost_per_kakao = COALESCE($8, cost_per_kakao),
        send_start_hour = COALESCE($9, send_start_hour),
        send_end_hour = COALESCE($10, send_end_hour),
        daily_limit_per_customer = COALESCE($11, daily_limit_per_customer),
        holiday_send_allowed = COALESCE($12, holiday_send_allowed),
        duplicate_prevention_days = COALESCE($13, duplicate_prevention_days),
        target_strategy = COALESCE($14, target_strategy),
        cross_category_allowed = COALESCE($15, cross_category_allowed),
        excluded_segments = COALESCE($16, excluded_segments),
        approval_required = COALESCE($17, approval_required),
        updated_at = NOW()
      WHERE id = $18
    `, [
      brand_name, business_type, reject_number,
      monthly_budget, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
      send_start_hour, send_end_hour, daily_limit_per_customer,
      holiday_send_allowed, duplicate_prevention_days,
      target_strategy, cross_category_allowed, excluded_segments ? JSON.stringify(excluded_segments) : null,
      approval_required, companyId
    ]);

    res.json({ message: '설정이 저장되었습니다' });
  } catch (error) {
    console.error('설정 수정 에러:', error);
    res.status(500).json({ error: '설정 저장 실패' });
  }
});
export default router;
