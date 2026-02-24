import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { query, mysqlQuery } from '../config/database';
import { ALL_SMS_TABLES, invalidateLineGroupCache } from './campaigns';

const router = Router();

// ===== 사용자 관리 API =====

// 전체 사용자 목록 조회
router.get('/users', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        u.id, u.login_id, u.name, u.email, u.phone, u.department,
        u.user_type, u.status, u.company_id, u.last_login_at, u.created_at,
        u.store_codes,
        c.company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      ORDER BY u.created_at DESC
    `);
    
    res.json({ users: result.rows });
  } catch (error) {
    console.error('사용자 목록 조회 실패:', error);
    res.status(500).json({ error: '사용자 목록 조회 실패' });
  }
});

// 사용자 추가 (계정 발급)
router.post('/users', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { companyId, loginId, password, name, email, phone, department, userType, storeCodes } = req.body;
  
  if (!companyId || !loginId || !password || !name) {
    return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
  }
  
  try {
    // 중복 체크
    const existing = await query('SELECT id FROM users WHERE login_id = $1', [loginId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '이미 사용중인 로그인 ID입니다.' });
    }

    // max_users 상한 체크
    const companyResult = await query(
      'SELECT max_users FROM companies WHERE id = $1',
      [companyId]
    );
    if (companyResult.rows.length > 0 && companyResult.rows[0].max_users) {
      const userCountResult = await query(
        'SELECT COUNT(*) FROM users WHERE company_id = $1 AND is_active = true',
        [companyId]
      );
      const currentUsers = parseInt(userCountResult.rows[0].count);
      if (currentUsers >= companyResult.rows[0].max_users) {
        return res.status(403).json({ 
          error: `최대 사용자 수(${companyResult.rows[0].max_users}명)를 초과할 수 없습니다.`,
          code: 'MAX_USERS_REACHED'
        });
      }
    }
    
    // 비밀번호 해시
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await query(`
      INSERT INTO users (company_id, login_id, password_hash, name, email, phone, department, user_type, status, must_change_password, store_codes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', true, $9)
      RETURNING id, login_id, name, email, user_type, status, created_at, store_codes
    `, [companyId, loginId, passwordHash, name, email || null, phone || null, department || null, userType || 'user', storeCodes || null]);
    
    res.status(201).json({ user: result.rows[0], message: '사용자가 생성되었습니다.' });
  } catch (error) {
    console.error('사용자 생성 실패:', error);
    res.status(500).json({ error: '사용자 생성 실패' });
  }
});

// 사용자 수정
router.put('/users/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, email, phone, department, userType, status, storeCodes } = req.body;
  
  try {
    const result = await query(`
      UPDATE users 
      SET name = COALESCE($1, name),
          email = COALESCE($2, email),
          phone = COALESCE($3, phone),
          department = COALESCE($4, department),
          user_type = COALESCE($5, user_type),
          status = COALESCE($6, status),
          store_codes = $7,
          updated_at = NOW()
      WHERE id = $8
      RETURNING id, login_id, name, email, user_type, status, store_codes
    `, [name, email, phone, department, userType, status, storeCodes || null, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    
    res.json({ user: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('사용자 수정 실패:', error);
    res.status(500).json({ error: '사용자 수정 실패' });
  }
});

// 사용자 삭제
router.delete('/users/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id, login_id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('사용자 삭제 실패:', error);
    res.status(500).json({ error: '사용자 삭제 실패' });
  }
});

// 비밀번호 초기화
router.post('/users/:id/reset-password', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // 사용자 정보 조회 (phone 포함)
    const userResult = await query('SELECT id, login_id, name, phone FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const user = userResult.rows[0];
    
    // 임시 비밀번호 생성
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let tempPassword = '';
    for (let i = 0; i < 8; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    
    await query(`
      UPDATE users 
      SET password_hash = $1, must_change_password = true, updated_at = NOW()
      WHERE id = $2
    `, [passwordHash, id]);
    
    // SMS 발송 (휴대폰 번호가 있는 경우)
    let smsSent = false;
    if (user.phone) {
      try {
        const phone = user.phone.replace(/-/g, '');
        const message = `[Target-UP] 임시 비밀번호: ${tempPassword}\n최초 로그인 시 비밀번호 변경이 필요합니다.`;
        
        await mysqlQuery(
          `INSERT INTO ${ALL_SMS_TABLES[0]} (dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1) VALUES (?, ?, ?, 'S', NOW(), 100, '1')`,
          [phone, '18008125', message]
        );
        smsSent = true;
      } catch (smsError) {
        console.error('SMS 발송 실패:', smsError);
      }
    }
    
    res.json({ 
      tempPassword, 
      message: '비밀번호가 초기화되었습니다.',
      user: { id: user.id, login_id: user.login_id, name: user.name },
      smsSent,
      phone: user.phone ? user.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-****-$3') : null
    });
  } catch (error) {
    console.error('비밀번호 초기화 실패:', error);
    res.status(500).json({ error: '비밀번호 초기화 실패' });
  }
});

// ===== 회사 상세 수정 API =====

// 회사 상세 조회
router.get('/companies/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const result = await query(`
      SELECT c.*, p.plan_name,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id) as total_customers,
        (SELECT COUNT(*) FROM users WHERE company_id = c.id) as total_users
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    
    res.json({ company: result.rows[0] });
  } catch (error) {
    console.error('회사 조회 실패:', error);
    res.status(500).json({ error: '회사 조회 실패' });
  }
});

// 회사 수정
router.put('/companies/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { 
    companyName, contactName, contactEmail, contactPhone,
    status, planId, rejectNumber, brandName,
    sendHourStart, sendHourEnd, dailyLimit, holidaySend, duplicateDays,
    costPerSms, costPerLms, costPerMms, costPerKakao,
    storeCodeList,
    businessNumber, ceoName, businessType, businessItem, address,
    allowCallbackSelfRegister, maxUsers, sessionTimeoutMinutes,
    approvalRequired, targetStrategy, lineGroupId, kakaoEnabled
  } = req.body;
  
  try {
    const result = await query(`
      UPDATE companies 
      SET company_name = COALESCE($1, company_name),
          contact_name = COALESCE($2, contact_name),
          contact_email = COALESCE($3, contact_email),
          contact_phone = COALESCE($4, contact_phone),
          status = COALESCE($5, status),
          plan_id = COALESCE($6, plan_id),
          reject_number = COALESCE($7, reject_number),
          brand_name = COALESCE($8, brand_name),
          send_start_hour = COALESCE($9, send_start_hour),
          send_end_hour = COALESCE($10, send_end_hour),
          daily_limit_per_customer = COALESCE($11, daily_limit_per_customer),
          holiday_send_allowed = COALESCE($12, holiday_send_allowed),
          duplicate_prevention_days = COALESCE($13, duplicate_prevention_days),
          cost_per_sms = COALESCE($14, cost_per_sms),
          cost_per_lms = COALESCE($15, cost_per_lms),
          cost_per_mms = COALESCE($16, cost_per_mms),
          cost_per_kakao = COALESCE($17, cost_per_kakao),
          store_code_list = COALESCE($18, store_code_list),
          business_number = COALESCE($19, business_number),
          ceo_name = COALESCE($20, ceo_name),
          business_type = COALESCE($21, business_type),
          business_item = COALESCE($22, business_item),
          address = COALESCE($23, address),
          allow_callback_self_register = COALESCE($24, allow_callback_self_register),
          max_users = COALESCE($25, max_users),
          session_timeout_minutes = COALESCE($26, session_timeout_minutes),
          approval_required = COALESCE($27, approval_required),
          target_strategy = COALESCE($28, target_strategy),
          line_group_id = COALESCE($29, line_group_id),
          kakao_enabled = COALESCE($30, kakao_enabled),
          updated_at = NOW()
      WHERE id = $31
      RETURNING *
    `, [companyName, contactName, contactEmail, contactPhone, status, planId, rejectNumber, brandName, sendHourStart, sendHourEnd, dailyLimit, holidaySend, duplicateDays, costPerSms, costPerLms, costPerMms, costPerKakao, storeCodeList ? JSON.stringify(storeCodeList) : null, businessNumber, ceoName, businessType, businessItem, address, allowCallbackSelfRegister !== undefined ? allowCallbackSelfRegister : null, maxUsers || null, sessionTimeoutMinutes || null, approvalRequired !== undefined ? approvalRequired : null, targetStrategy || null, lineGroupId || null, kakaoEnabled !== undefined ? kakaoEnabled : null, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    
    res.json({ company: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('회사 수정 실패:', error);
    res.status(500).json({ error: '회사 수정 실패' });
  }
});

// 회사 비활성화 (soft delete)
router.delete('/companies/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // 활성 캠페인이 있는지 확인
    const activeCampaigns = await query(
      "SELECT COUNT(*) FROM campaigns WHERE company_id = $1 AND status IN ('scheduled', 'sending')",
      [id]
    );
    if (parseInt(activeCampaigns.rows[0].count) > 0) {
      return res.status(400).json({ error: '진행 중이거나 예약된 캠페인이 있어 해지할 수 없습니다.' });
    }
    
    const result = await query(`
      UPDATE companies 
      SET status = 'terminated', updated_at = NOW()
      WHERE id = $1
      RETURNING id, company_name
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    
    // 해당 회사 사용자도 비활성화
    await query(
      "UPDATE users SET status = 'inactive', updated_at = NOW() WHERE company_id = $1",
      [id]
    );
    
    res.json({ message: `${result.rows[0].company_name}이(가) 해지되었습니다.` });
  } catch (error) {
    console.error('회사 해지 실패:', error);
    res.status(500).json({ error: '회사 해지 실패' });
  }
});

// ===== 예약 캠페인 관리 API =====

// 예약된 캠페인 목록 조회 (전체 고객사)
router.get('/campaigns/scheduled', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = (req.query.search as string) || '';
    const companyId = (req.query.companyId as string) || '';
    const status = (req.query.status as string) || '';       // scheduled / cancelled / '' (all)
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';
    const loginId = (req.query.loginId as string) || '';     // 사용자 계정 검색

    let where = `WHERE c.status IN ('scheduled', 'cancelled')`;
    const params: any[] = [];
    let paramIdx = 1;

    if (status) {
      where += ` AND c.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }
    if (companyId) {
      where += ` AND c.company_id = $${paramIdx}`;
      params.push(companyId);
      paramIdx++;
    }
    if (startDate) {
      where += ` AND COALESCE(c.scheduled_at, c.created_at) >= $${paramIdx}::date`;
      params.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      where += ` AND COALESCE(c.scheduled_at, c.created_at) < ($${paramIdx}::date + INTERVAL '1 day')`;
      params.push(endDate);
      paramIdx++;
    }
    if (search) {
      where += ` AND (c.campaign_name ILIKE $${paramIdx} OR co.company_name ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (loginId) {
      where += ` AND u.login_id ILIKE $${paramIdx}`;
      params.push(`%${loginId}%`);
      paramIdx++;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns c LEFT JOIN companies co ON c.company_id = co.id LEFT JOIN users u ON c.created_by = u.id ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(`
      SELECT 
        c.id, c.campaign_name, c.status, c.scheduled_at, c.target_count,
        c.created_at, c.cancelled_by, c.cancelled_by_type, c.cancel_reason, c.cancelled_at,
        c.message_type, c.send_type, c.send_channel,
        co.company_name, co.company_code,
        u.name as created_by_name, u.login_id as created_by_login
      FROM campaigns c
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN users u ON c.created_by = u.id
      ${where}
      ORDER BY CASE WHEN c.status = 'scheduled' THEN 0 ELSE 1 END, c.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset]);
    
    res.json({ campaigns: result.rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('예약 캠페인 조회 실패:', error);
    res.status(500).json({ error: '예약 캠페인 조회 실패' });
  }
});

// 슈퍼관리자 예약 취소
router.post('/campaigns/:id/cancel', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = (req as any).user?.userId;
  
  if (!reason || reason.trim() === '') {
    return res.status(400).json({ error: '취소 사유를 입력해주세요.' });
  }
  
  try {
    // 예약 상태인지 확인
    const check = await query('SELECT status, scheduled_at FROM campaigns WHERE id = $1', [id]);
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }
    
    if (check.rows[0].status !== 'scheduled') {
      return res.status(400).json({ error: '예약 상태인 캠페인만 취소할 수 있습니다.' });
    }
    
    // 취소 처리
    const result = await query(`
      UPDATE campaigns 
      SET status = 'cancelled',
          cancelled_by = $1,
          cancelled_by_type = 'super_admin',
          cancel_reason = $2,
          cancelled_at = NOW(),
          updated_at = NOW()
      WHERE id = $3
      RETURNING id, campaign_name
    `, [adminId, reason.trim(), id]);
    
    res.json({ 
      message: '예약이 취소되었습니다.',
      campaign: result.rows[0]
    });
  } catch (error) {
    console.error('예약 취소 실패:', error);
    res.status(500).json({ error: '예약 취소 실패' });
  }
});
// ===== 발신번호 관리 API =====

// 발신번호 목록 조회
router.get('/callback-numbers', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        cn.id, cn.phone, cn.label, cn.is_default, cn.created_at,
        c.company_name, c.company_code, c.id as company_id
      FROM callback_numbers cn
      LEFT JOIN companies c ON cn.company_id = c.id
      ORDER BY c.company_name, cn.is_default DESC, cn.created_at DESC
    `);
    
    res.json({ callbackNumbers: result.rows });
  } catch (error) {
    console.error('발신번호 조회 실패:', error);
    res.status(500).json({ error: '발신번호 조회 실패' });
  }
});

// 발신번호 등록
router.post('/callback-numbers', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { companyId, phone, label, isDefault } = req.body;
  
  if (!companyId || !phone) {
    return res.status(400).json({ error: '회사와 발신번호는 필수입니다.' });
  }
  
  try {
    // 대표번호로 설정 시 기존 대표번호 해제
    if (isDefault) {
      await query('UPDATE callback_numbers SET is_default = false WHERE company_id = $1', [companyId]);
    }
    
    const result = await query(`
      INSERT INTO callback_numbers (company_id, phone, label, is_default)
      VALUES ($1, $2, $3, $4)
      RETURNING id, phone, label, is_default
    `, [companyId, phone, label || null, isDefault || false]);
    
    res.json({ 
      message: '발신번호가 등록되었습니다.',
      callbackNumber: result.rows[0]
    });
  } catch (error) {
    console.error('발신번호 등록 실패:', error);
    res.status(500).json({ error: '발신번호 등록 실패' });
  }
});

// 발신번호 수정
router.put('/callback-numbers/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { phone, label } = req.body;
  
  try {
    const result = await query(`
      UPDATE callback_numbers 
      SET phone = COALESCE($1, phone),
          label = COALESCE($2, label)
      WHERE id = $3
      RETURNING id, phone, label, is_default
    `, [phone, label, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '수정되었습니다.', callbackNumber: result.rows[0] });
  } catch (error) {
    console.error('발신번호 수정 실패:', error);
    res.status(500).json({ error: '발신번호 수정 실패' });
  }
});

// 발신번호 삭제
router.delete('/callback-numbers/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const result = await query('DELETE FROM callback_numbers WHERE id = $1 RETURNING phone', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('발신번호 삭제 실패:', error);
    res.status(500).json({ error: '발신번호 삭제 실패' });
  }
});

// 대표번호 설정
router.put('/callback-numbers/:id/default', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const check = await query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
    }
    
    const companyId = check.rows[0].company_id;
    
    await query('UPDATE callback_numbers SET is_default = false WHERE company_id = $1', [companyId]);
    await query('UPDATE callback_numbers SET is_default = true WHERE id = $1', [id]);
    
    res.json({ message: '대표번호로 설정되었습니다.' });
  } catch (error) {
    console.error('대표번호 설정 실패:', error);
    res.status(500).json({ error: '대표번호 설정 실패' });
  }
});
// ===== 요금제 관리 API =====

// 요금제 목록 조회
router.get('/plans', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM companies WHERE plan_id = p.id) as company_count
      FROM plans p
      ORDER BY p.monthly_price ASC
    `);
    
    res.json({ plans: result.rows });
  } catch (error) {
    console.error('요금제 조회 실패:', error);
    res.status(500).json({ error: '요금제 조회 실패' });
  }
});

// 요금제 추가
router.post('/plans', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { planCode, planName, maxCustomers, monthlyPrice } = req.body;
  
  if (!planCode || !planName || maxCustomers === undefined || monthlyPrice === undefined) {
    return res.status(400).json({ error: '모든 항목을 입력해주세요.' });
  }
  
  try {
    const result = await query(`
      INSERT INTO plans (plan_code, plan_name, max_customers, monthly_price)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [planCode, planName, maxCustomers, monthlyPrice]);
    
    res.json({ 
      message: '요금제가 등록되었습니다.',
      plan: result.rows[0]
    });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 존재하는 요금제 코드입니다.' });
    }
    console.error('요금제 등록 실패:', error);
    res.status(500).json({ error: '요금제 등록 실패' });
  }
});

// 요금제 수정
router.put('/plans/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { planName, maxCustomers, monthlyPrice, isActive } = req.body;
  
  try {
    const result = await query(`
      UPDATE plans 
      SET plan_name = COALESCE($1, plan_name),
          max_customers = COALESCE($2, max_customers),
          monthly_price = COALESCE($3, monthly_price),
          is_active = COALESCE($4, is_active)
      WHERE id = $5
      RETURNING *
    `, [planName, maxCustomers, monthlyPrice, isActive, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '요금제를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '수정되었습니다.', plan: result.rows[0] });
  } catch (error) {
    console.error('요금제 수정 실패:', error);
    res.status(500).json({ error: '요금제 수정 실패' });
  }
});

// 요금제 삭제
router.delete('/plans/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // 사용 중인 회사가 있는지 확인
    const checkResult = await query('SELECT COUNT(*) FROM companies WHERE plan_id = $1', [id]);
    if (parseInt(checkResult.rows[0].count) > 0) {
      return res.status(400).json({ error: '이 요금제를 사용 중인 회사가 있어 삭제할 수 없습니다.' });
    }
    
    const result = await query('DELETE FROM plans WHERE id = $1 RETURNING plan_name', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '요금제를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('요금제 삭제 실패:', error);
    res.status(500).json({ error: '요금제 삭제 실패' });
  }
});

// ===== 플랜 변경 신청 관리 API =====

// 플랜 신청 목록 조회
router.get('/plan-requests', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        pr.*,
        c.company_name, c.company_code,
        p_current.plan_name as current_plan_name,
        p_requested.plan_name as requested_plan_name,
        p_requested.monthly_price as requested_plan_price,
        u.name as user_name, u.login_id as user_login_id,
        admin.name as processed_by_name
      FROM plan_requests pr
      LEFT JOIN companies c ON pr.company_id = c.id
      LEFT JOIN plans p_current ON c.plan_id = p_current.id
      LEFT JOIN plans p_requested ON pr.requested_plan_id = p_requested.id
      LEFT JOIN users u ON pr.user_id = u.id
      LEFT JOIN users admin ON pr.processed_by = admin.id
      ORDER BY 
        CASE WHEN pr.status = 'pending' THEN 0 ELSE 1 END,
        pr.created_at DESC
    `);
    
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('플랜 신청 조회 실패:', error);
    res.status(500).json({ error: '플랜 신청 조회 실패' });
  }
});

// 플랜 신청 승인
router.put('/plan-requests/:id/approve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { adminNote } = req.body;
  const adminId = (req as any).user?.userId;
  
  try {
    // 신청 정보 조회
    const requestResult = await query(
      'SELECT company_id, requested_plan_id, status FROM plan_requests WHERE id = $1',
      [id]
    );
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: '신청을 찾을 수 없습니다.' });
    }
    
    const request = requestResult.rows[0];
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: '이미 처리된 신청입니다.' });
    }
    
    // 회사 플랜 변경
    await query(
      'UPDATE companies SET plan_id = $1, updated_at = NOW() WHERE id = $2',
      [request.requested_plan_id, request.company_id]
    );
    
    // 신청 상태 변경
    const result = await query(`
      UPDATE plan_requests 
      SET status = 'approved',
          admin_note = $1,
          processed_by = $2,
          processed_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [adminNote || null, adminId, id]);
    
    res.json({ 
      message: '승인되었습니다. 회사 플랜이 변경되었습니다.',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('플랜 신청 승인 실패:', error);
    res.status(500).json({ error: '플랜 신청 승인 실패' });
  }
});

// 플랜 신청 거절
router.put('/plan-requests/:id/reject', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { adminNote } = req.body;
  const adminId = (req as any).user?.userId;
  
  if (!adminNote || adminNote.trim() === '') {
    return res.status(400).json({ error: '거절 사유를 입력해주세요.' });
  }
  
  try {
    const checkResult = await query('SELECT status FROM plan_requests WHERE id = $1', [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: '신청을 찾을 수 없습니다.' });
    }
    
    if (checkResult.rows[0].status !== 'pending') {
      return res.status(400).json({ error: '이미 처리된 신청입니다.' });
    }
    
    const result = await query(`
      UPDATE plan_requests 
      SET status = 'rejected',
          admin_note = $1,
          processed_by = $2,
          processed_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [adminNote.trim(), adminId, id]);
    
    res.json({ 
      message: '거절되었습니다.',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('플랜 신청 거절 실패:', error);
    res.status(500).json({ error: '플랜 신청 거절 실패' });
  }
});
// ===== 발송 통계 API =====

// 전체 발송 통계 (요약 + 페이징된 일별/월별)
router.get('/stats/send', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const view = (req.query.view as string) || 'daily';
    let startDate = (req.query.startDate as string) || '';
    let endDate = (req.query.endDate as string) || '';

    // 월별 조회 시 날짜를 월 단위로 자동 확장
    if (view === 'monthly') {
      if (startDate) startDate = startDate.substring(0, 7) + '-01';
      if (endDate) {
        const d = new Date(endDate);
        d.setMonth(d.getMonth() + 1, 0);
        endDate = d.toISOString().split('T')[0];
      }
    }

    const companyId = (req.query.companyId as string) || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    let dateWhere = '';
    const baseParams: any[] = [];
    let paramIdx = 1;

    if (startDate) {
      dateWhere += ` AND c.sent_at >= $${paramIdx}::date AT TIME ZONE 'Asia/Seoul'`;
      baseParams.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      dateWhere += ` AND c.sent_at < ($${paramIdx}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Seoul'`;
      baseParams.push(endDate);
      paramIdx++;
    }
    let companyWhere = '';
    if (companyId) {
      companyWhere = ` AND c.company_id = $${paramIdx}`;
      baseParams.push(companyId);
      paramIdx++;
    }

    // 1) 요약 (campaigns 직접 조회 - 직접발송 포함)
    const summaryResult = await query(`
      SELECT 
        COALESCE(SUM(c.sent_count), 0) as total_sent,
        COALESCE(SUM(c.success_count), 0) as total_success,
        COALESCE(SUM(c.fail_count), 0) as total_fail
      FROM campaigns c
      WHERE c.sent_at IS NOT NULL
        AND c.status NOT IN ('cancelled', 'draft') ${dateWhere} ${companyWhere}
    `, baseParams);

    // 2) 페이징된 일별/월별
    const groupCol = view === 'monthly'
      ? `TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;
    const groupAlias = view === 'monthly' ? 'month' : 'date';

    const countResult = await query(`
      SELECT COUNT(*) FROM (
        SELECT ${groupCol} as grp, co.company_name
        FROM campaigns c
        JOIN companies co ON c.company_id = co.id
        LEFT JOIN sms_line_groups lg ON co.line_group_id = lg.id
        WHERE c.sent_at IS NOT NULL
          AND c.status NOT IN ('cancelled', 'draft') ${dateWhere} ${companyWhere}
        GROUP BY grp, co.company_name, lg.group_name
      ) sub
    `, baseParams);
    const total = parseInt(countResult.rows[0].count);

    const rowsResult = await query(`
      SELECT 
        ${groupCol} as "${groupAlias}",
        co.id as company_id,
        co.company_name,
        lg.group_name as line_group_name,
        COUNT(DISTINCT c.id) as runs,
        COALESCE(SUM(c.sent_count), 0) as sent,
        COALESCE(SUM(c.success_count), 0) as success,
        COALESCE(SUM(c.fail_count), 0) as fail
      FROM campaigns c
      JOIN companies co ON c.company_id = co.id
      LEFT JOIN sms_line_groups lg ON co.line_group_id = lg.id
      WHERE c.sent_at IS NOT NULL
        AND c.status NOT IN ('cancelled', 'draft') ${dateWhere} ${companyWhere}
      GROUP BY ${groupCol}, co.id, co.company_name, lg.group_name
      ORDER BY "${groupAlias}" DESC, co.company_name
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...baseParams, limit, offset]);

    res.json({
      summary: summaryResult.rows[0],
      rows: rowsResult.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('발송 통계 조회 실패:', error);
    res.status(500).json({ error: '발송 통계 조회 실패' });
  }
});

// 발송 통계 상세 (사용자별 분해)
router.get('/stats/send/detail', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const view = (req.query.view as string) || 'daily';
    const dateVal = (req.query.date as string) || '';
    const companyId = (req.query.companyId as string) || '';

    if (!dateVal || !companyId) {
      return res.status(400).json({ error: '날짜와 고객사 ID가 필요합니다.' });
    }

    const groupCol = view === 'monthly'
      ? `TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;

    // 사용자별 통계 (campaigns 직접 조회)
    const result = await query(`
      SELECT 
        u.id as user_id,
        u.name as user_name,
        u.login_id,
        u.department,
        u.store_codes,
        COUNT(DISTINCT c.id) as runs,
        COALESCE(SUM(c.sent_count), 0) as sent,
        COALESCE(SUM(c.success_count), 0) as success,
        COALESCE(SUM(c.fail_count), 0) as fail
      FROM campaigns c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.sent_at IS NOT NULL
        AND c.status NOT IN ('cancelled', 'draft')
        AND ${groupCol} = $1
        AND c.company_id = $2
      GROUP BY u.id, u.name, u.login_id, u.department, u.store_codes
      ORDER BY sent DESC
    `, [dateVal, companyId]);

    // 캠페인 상세 목록 (campaigns 직접 조회)
    const campaignsResult = await query(`
      SELECT 
        c.id as campaign_id,
        c.campaign_name,
        c.send_type,
        u.name as user_name,
        u.login_id,
        c.id as run_id,
        1 as run_number,
        c.sent_count,
        c.success_count,
        c.fail_count,
        c.target_count,
        c.message_type,
        c.sent_at
      FROM campaigns c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.sent_at IS NOT NULL
        AND c.status NOT IN ('cancelled', 'draft')
        AND ${groupCol} = $1
        AND c.company_id = $2
      ORDER BY c.sent_at DESC
    `, [dateVal, companyId]);

    res.json({
      userStats: result.rows,
      campaigns: campaignsResult.rows,
    });
  } catch (error) {
    console.error('발송 통계 상세 조회 실패:', error);
    res.status(500).json({ error: '발송 통계 상세 조회 실패' });
  }
});

// ===== 전체 캠페인 관리 API =====

// 전체 캠페인 목록 (모든 회사 통합)
router.get('/campaigns/all', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || '';
    const status = (req.query.status as string) || '';
    const companyId = (req.query.companyId as string) || '';
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      where += ` AND (c.campaign_name ILIKE $${paramIdx} OR co.company_name ILIKE $${paramIdx} OR u.login_id ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (status) {
      where += ` AND c.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }
    if (companyId) {
      where += ` AND c.company_id = $${paramIdx}`;
      params.push(companyId);
      paramIdx++;
    }
    if (startDate) {
      where += ` AND COALESCE(c.sent_at, c.scheduled_at, c.created_at) >= $${paramIdx}::date`;
      params.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      where += ` AND COALESCE(c.sent_at, c.scheduled_at, c.created_at) < ($${paramIdx}::date + INTERVAL '1 day')`;
      params.push(endDate);
      paramIdx++;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns c LEFT JOIN companies co ON c.company_id = co.id LEFT JOIN users u ON c.created_by = u.id ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(`
      SELECT 
        c.id, c.campaign_name as name, c.status, c.send_type as campaign_type, c.created_at,
        c.company_id, c.message_type, c.send_channel, c.scheduled_at, c.sent_at,
        co.company_name, co.company_code,
        u.name as created_by_name, u.login_id as created_by_login,
        (SELECT COALESCE(SUM(cr.sent_count), 0) FROM campaign_runs cr WHERE cr.campaign_id = c.id) as total_sent,
        (SELECT COALESCE(SUM(cr.success_count), 0) FROM campaign_runs cr WHERE cr.campaign_id = c.id) as total_success,
        (SELECT COALESCE(SUM(cr.fail_count), 0) FROM campaign_runs cr WHERE cr.campaign_id = c.id) as total_fail,
        (SELECT cr.target_count FROM campaign_runs cr WHERE cr.campaign_id = c.id ORDER BY cr.run_number DESC LIMIT 1) as last_target_count,
        (SELECT cr.sent_at FROM campaign_runs cr WHERE cr.campaign_id = c.id ORDER BY cr.run_number DESC LIMIT 1) as last_sent_at
      FROM campaigns c
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN users u ON c.created_by = u.id
      ${where}
      ORDER BY c.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset]);

    res.json({ 
      campaigns: result.rows, 
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('전체 캠페인 조회 실패:', error);
    res.status(500).json({ error: '전체 캠페인 조회 실패' });
  }
});
// ===== SMS/카카오 발송 상세 조회 (MySQL) =====
router.get('/campaigns/:id/sms-detail', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const statusFilter = (req.query.status as string) || '';   // success / fail / pending / ''
    const searchType = (req.query.searchType as string) || ''; // dest_no / call_back
    const searchValue = (req.query.searchValue as string) || '';
    const channelFilter = (req.query.channel as string) || ''; // sms / kakao / '' (all)

    // 캠페인 기본 정보 (PostgreSQL)
    const campResult = await query(`
      SELECT c.id, c.campaign_name, c.message_type, c.send_type, c.status, c.scheduled_at, c.sent_at, c.target_count,
             c.success_count, c.fail_count, c.send_channel,
             co.company_name, co.company_code,
             u.name as created_by_name, u.login_id as created_by_login
      FROM campaigns c
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.id = $1
    `, [id]);
    if (campResult.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }
    const campaign = campResult.rows[0];
    const sendChannel = campaign.send_channel || 'sms';
    const showSms = (!channelFilter || channelFilter === 'sms') && (sendChannel === 'sms' || sendChannel === 'both');
    const showKakao = (!channelFilter || channelFilter === 'kakao') && (sendChannel === 'kakao' || sendChannel === 'both');

    let allDetail: any[] = [];
    let totalSms = 0;
    let totalKakao = 0;

    // ===== SMS 내역 조회 =====
    if (showSms) {
      let mysqlWhere = `WHERE app_etc1 = ?`;
      const mysqlParams: any[] = [id];

      if (statusFilter === 'success') {
        mysqlWhere += ` AND status_code IN (6, 1000, 1800)`;
      } else if (statusFilter === 'fail') {
        mysqlWhere += ` AND status_code NOT IN (6, 1000, 1800, 100)`;
      } else if (statusFilter === 'pending') {
        mysqlWhere += ` AND status_code = 100`;
      }

      if (searchValue && searchType === 'dest_no') {
        mysqlWhere += ` AND dest_no LIKE ?`;
        mysqlParams.push(`%${searchValue.replace(/-/g, '')}%`);
      } else if (searchValue && searchType === 'call_back') {
        mysqlWhere += ` AND call_back LIKE ?`;
        mysqlParams.push(`%${searchValue.replace(/-/g, '')}%`);
      }

      const countRows = await mysqlQuery(`SELECT COUNT(*) as cnt FROM SMSQ_SEND ${mysqlWhere}`, mysqlParams);
      totalSms = (countRows as any[])[0]?.cnt || 0;

      const rows = await mysqlQuery(
        `SELECT seqno, dest_no, call_back, msg_contents, msg_type, status_code, mob_company,
                sendreq_time, mobsend_time, repmsg_recvtm
         FROM SMSQ_SEND ${mysqlWhere}
         ORDER BY seqno DESC
         LIMIT ? OFFSET ?`,
         [...mysqlParams, Number(limit), Number(offset)]
      );

      const statusMap: Record<number, string> = { 6: 'SMS성공', 1000: 'LMS성공', 1800: '카카오성공', 100: '대기', 7: '비가입자', 8: 'Power-off', 16: '스팸차단' };
      const carrierMap: Record<string, string> = { '11': 'SKT', '16': 'KT', '19': 'LGU+' };

      (rows as any[]).forEach(r => {
        allDetail.push({
          seqno: r.seqno,
          destNo: r.dest_no,
          callBack: r.call_back,
          msgContents: r.msg_contents,
          msgType: r.msg_type === 'S' ? 'SMS' : r.msg_type === 'L' ? 'LMS' : r.msg_type === 'M' ? 'MMS' : r.msg_type,
          statusCode: r.status_code,
          statusText: statusMap[r.status_code] || `코드:${r.status_code}`,
          carrier: carrierMap[r.mob_company] || r.mob_company || '-',
          sendreqTime: r.sendreq_time,
          mobsendTime: r.mobsend_time,
          recvTime: r.repmsg_recvtm,
          channel: 'sms',
        });
      });
    }

    // ===== 카카오 내역 조회 =====
    if (showKakao) {
      let kakaoWhere = `WHERE REQUEST_UID = ?`;
      const kakaoParams: any[] = [id];

      if (statusFilter === 'success') {
        kakaoWhere += ` AND REPORT_CODE = '0000'`;
      } else if (statusFilter === 'fail') {
        kakaoWhere += ` AND REPORT_CODE != '0000' AND STATUS IN ('3','4')`;
      } else if (statusFilter === 'pending') {
        kakaoWhere += ` AND STATUS IN ('1','2')`;
      }

      if (searchValue && searchType === 'dest_no') {
        kakaoWhere += ` AND PHONE_NUMBER LIKE ?`;
        kakaoParams.push(`%${searchValue.replace(/-/g, '')}%`);
      }

      const kakaoCountRows = await mysqlQuery(`SELECT COUNT(*) as cnt FROM IMC_BM_FREE_BIZ_MSG ${kakaoWhere}`, kakaoParams);
      totalKakao = (kakaoCountRows as any[])[0]?.cnt || 0;

      const kakaoRows = await mysqlQuery(
        `SELECT ID, PHONE_NUMBER, MESSAGE, CHAT_BUBBLE_TYPE, STATUS, REPORT_CODE, REPORT_DATE,
                REQUEST_DATE, RESPONSE_DATE, RESEND_MT_TYPE, RESEND_REPORT_CODE
         FROM IMC_BM_FREE_BIZ_MSG ${kakaoWhere}
         ORDER BY ID DESC
         LIMIT ? OFFSET ?`,
         [...kakaoParams, Number(limit), Number(offset)]
      );

      const kakaoStatusMap: Record<string, string> = {
        '0000': '카카오성공', '': '대기',
      };

      (kakaoRows as any[]).forEach(r => {
        allDetail.push({
          seqno: r.ID,
          destNo: r.PHONE_NUMBER,
          callBack: '-',
          msgContents: r.MESSAGE,
          msgType: `카카오(${r.CHAT_BUBBLE_TYPE || 'TEXT'})`,
          statusCode: r.REPORT_CODE === '0000' ? 1800 : (r.STATUS <= '2' ? 100 : 9999),
          statusText: kakaoStatusMap[r.REPORT_CODE] || `카카오:${r.REPORT_CODE || '처리중'}`,
          carrier: '카카오',
          sendreqTime: r.REQUEST_DATE,
          mobsendTime: r.RESPONSE_DATE,
          recvTime: r.REPORT_DATE,
          channel: 'kakao',
          kakaoReportCode: r.REPORT_CODE,
          resendType: r.RESEND_MT_TYPE,
          resendReportCode: r.RESEND_REPORT_CODE,
        });
      });
    }

    const total = totalSms + totalKakao;

    res.json({ campaign, detail: allDetail, total, totalSms, totalKakao, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('SMS 상세 조회 실패:', error);
    res.status(500).json({ error: 'SMS 상세 조회 실패' });
  }
});
// ===== 표준 필드 관리 API =====

// 표준 필드 목록 조회
router.get('/standard-fields', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT id, field_key, display_name, category, data_type, description, sort_order FROM standard_fields WHERE is_active = true ORDER BY sort_order'
    );
    res.json({ fields: result.rows });
  } catch (error) {
    console.error('표준 필드 조회 실패:', error);
    res.status(500).json({ error: '표준 필드 조회 실패' });
  }
});

// 회사별 활성 필드 조회
router.get('/companies/:id/fields', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query('SELECT enabled_fields FROM companies WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    res.json({ enabledFields: result.rows[0].enabled_fields || [] });
  } catch (error) {
    console.error('회사 필드 조회 실패:', error);
    res.status(500).json({ error: '회사 필드 조회 실패' });
  }
});
// 회사별 필드 데이터 유무 체크
router.get('/companies/:id/field-data-check', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // field_key → 실제 DB 컬럼 매핑
    const FIELD_COLUMN_MAP: Record<string, string> = {
      name: 'name', phone: 'phone', gender: 'gender',
      birth_date: 'birth_date', age_group: 'age', region: 'region',
      address: 'address', email: 'email', grade: 'grade',
      total_purchase_amount: 'total_purchase_amount',
      purchase_count: 'purchase_count',
      last_purchase_date: 'recent_purchase_date',
      points: 'points', store_code: 'store_code', store_name: 'store_name',
      opt_in_sms: 'sms_opt_in',
    };

    // 활성 필드 목록
    const fieldsResult = await query('SELECT field_key FROM standard_fields WHERE is_active = true');
    const fieldKeys: string[] = fieldsResult.rows.map((r: any) => r.field_key);

    // 한 번의 쿼리로 모든 필드 데이터 유무 체크
    const selectParts = fieldKeys.map(key => {
      const col = FIELD_COLUMN_MAP[key];
      if (col) {
        return `COUNT(CASE WHEN ${col} IS NOT NULL AND ${col}::text != '' THEN 1 END) as "${key}"`;
      } else {
        return `COUNT(CASE WHEN custom_fields->>'${key}' IS NOT NULL AND custom_fields->>'${key}' != '' THEN 1 END) as "${key}"`;
      }
    });

    const sql = `SELECT ${selectParts.join(', ')} FROM customers_unified WHERE company_id = $1`;
    const result = await query(sql, [id]);

    const dataCheck: Record<string, { hasData: boolean; count: number }> = {};
    for (const key of fieldKeys) {
      const count = parseInt(result.rows[0]?.[key]) || 0;
      dataCheck[key] = { hasData: count > 0, count };
    }

    res.json({ dataCheck });
  } catch (error) {
    console.error('필드 데이터 체크 실패:', error);
    res.status(500).json({ error: '필드 데이터 체크 실패' });
  }
});
// 회사별 활성 필드 저장
router.put('/companies/:id/fields', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { enabledFields } = req.body;
  
  try {
    const result = await query(
      'UPDATE companies SET enabled_fields = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
      [JSON.stringify(enabledFields || []), id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    res.json({ message: '필터항목이 저장되었습니다.', enabledFields });
  } catch (error) {
    console.error('필터항목 저장 실패:', error);
    res.status(500).json({ error: '필터항목 저장 실패' });
  }
});

// ===== 정산서 이메일 발송 =====
router.post('/billing/:id/send-email', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { to, subject, body_html } = req.body;
    const adminId = req.user?.id || req.adminUser?.id;

    if (!to || !subject) {
      return res.status(400).json({ error: '수신자 이메일과 제목은 필수입니다' });
    }

    // 1) billing 조회 + 상태 체크
    const billingResult = await query(
      'SELECT * FROM billings WHERE id = $1', [id]
    );
    if (billingResult.rows.length === 0) {
      return res.status(404).json({ error: '정산 데이터를 찾을 수 없습니다' });
    }
    const billing = billingResult.rows[0];
    if (billing.status === 'draft') {
      return res.status(400).json({ error: '초안 상태에서는 발송할 수 없습니다. 확정 후 발송해주세요.' });
    }

    // 2) PDF 생성 (기존 PDF 생성 로직 재활용)
    //    ※ 기존 billing PDF 생성 함수를 여기서 호출하여 Buffer로 받기
    //    예: const pdfBuffer = await generateBillingPdf(id);
    //    현재는 stub이므로 PDF 생성까지만 확인

    // 3) 이메일 발송 (현재 stub)
    const { sendBillingEmail } = require('../services/emailService');
    const emailResult = await sendBillingEmail({
      to,
      subject,
      bodyHtml: body_html,
      pdfBuffer: null, // TODO: 실제 PDF buffer 연결
      pdfFilename: `정산서_${billing.company_name || 'billing'}_${billing.billing_year}_${billing.billing_month}.pdf`,
    });

    // 4) 발송 이력 기록
    if (emailResult.success) {
      await query(
        'UPDATE billings SET emailed_at = NOW(), emailed_to = $1, emailed_by = $2 WHERE id = $3',
        [to, adminId, id]
      );
    }

    res.json({
      success: emailResult.success,
      message: emailResult.message,
      emailed_at: new Date().toISOString(),
      emailed_to: to,
    });
  } catch (error: any) {
    console.error('정산서 이메일 발송 오류:', error);
    res.status(500).json({ error: error.message || '이메일 발송 실패' });
  }
});

// ===== 선불 잔액 관리 API =====

// billing_type 변경 (후불 ↔ 선불)
router.patch('/companies/:id/billing-type', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { billingType } = req.body;

  if (!billingType || !['prepaid', 'postpaid'].includes(billingType)) {
    return res.status(400).json({ error: '올바른 요금제 유형을 선택해주세요. (prepaid 또는 postpaid)' });
  }

  try {
    // 진행 중인 캠페인 확인
    const activeCampaigns = await query(
      "SELECT COUNT(*) FROM campaigns WHERE company_id = $1 AND status IN ('scheduled', 'sending')",
      [id]
    );
    if (parseInt(activeCampaigns.rows[0].count) > 0) {
      return res.status(400).json({ error: '진행 중이거나 예약된 캠페인이 있어 요금제 유형을 변경할 수 없습니다.' });
    }

    const result = await query(
      'UPDATE companies SET billing_type = $1, updated_at = NOW() WHERE id = $2 RETURNING id, company_name, billing_type, balance',
      [billingType, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    const c = result.rows[0];
    console.log(`[요금제변경] ${c.company_name} → ${billingType} (잔액: ${c.balance}원)`);

    res.json({
      message: `요금제 유형이 ${billingType === 'prepaid' ? '선불' : '후불'}로 변경되었습니다.`,
      company: { id: c.id, companyName: c.company_name, billingType: c.billing_type, balance: Number(c.balance) }
    });
  } catch (error) {
    console.error('요금제 유형 변경 실패:', error);
    res.status(500).json({ error: '요금제 유형 변경 실패' });
  }
});

// 수동 잔액 조정 (충전 또는 차감)
router.post('/companies/:id/balance-adjust', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { type, amount, reason } = req.body;
  const adminId = (req as any).user?.userId;

  if (!type || !['charge', 'deduct'].includes(type)) {
    return res.status(400).json({ error: '올바른 유형을 선택해주세요. (charge 또는 deduct)' });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: '금액은 0보다 커야 합니다.' });
  }
  if (!reason || reason.trim() === '') {
    return res.status(400).json({ error: '사유를 입력해주세요.' });
  }

  try {
    const txType = type === 'charge' ? 'admin_charge' : 'admin_deduct';

    if (type === 'deduct') {
      // 차감: 잔액 부족 체크 (atomic)
      const result = await query(
        'UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2 AND balance >= $1 RETURNING balance, company_name',
        [amount, id]
      );
      if (result.rows.length === 0) {
        const co = await query('SELECT balance, company_name FROM companies WHERE id = $1', [id]);
        if (co.rows.length === 0) return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
        return res.status(400).json({ error: `잔액이 부족합니다. 현재 잔액: ${Number(co.rows[0].balance).toLocaleString()}원` });
      }

      await query(
        `INSERT INTO balance_transactions (company_id, type, amount, balance_before, balance_after, description, admin_id, payment_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin')`,
        [id, txType, amount, Number(result.rows[0].balance) + amount, result.rows[0].balance, reason.trim(), adminId]
      );

      console.log(`[관리자차감] ${result.rows[0].company_name}: -${amount}원 → 잔액 ${result.rows[0].balance}원 (사유: ${reason})`);
      res.json({
        message: `${amount.toLocaleString()}원이 차감되었습니다.`,
        balance: Number(result.rows[0].balance),
        transactionType: txType
      });
    } else {
      // 충전
      const result = await query(
        'UPDATE companies SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance, company_name',
        [amount, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
      }

      await query(
        `INSERT INTO balance_transactions (company_id, type, amount, balance_before, balance_after, description, admin_id, payment_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin')`,
        [id, txType, amount, Number(result.rows[0].balance) - amount, result.rows[0].balance, reason.trim(), adminId]
      );

      console.log(`[관리자충전] ${result.rows[0].company_name}: +${amount}원 → 잔액 ${result.rows[0].balance}원 (사유: ${reason})`);
      res.json({
        message: `${amount.toLocaleString()}원이 충전되었습니다.`,
        balance: Number(result.rows[0].balance),
        transactionType: txType
      });
    }
  } catch (error) {
    console.error('잔액 조정 실패:', error);
    res.status(500).json({ error: '잔액 조정 실패' });
  }
});

// 회사별 잔액 이력 조회 (슈퍼관리자용)
router.get('/companies/:id/balance-transactions', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = (page - 1) * limit;

  try {
    // 회사 잔액 정보
    const companyResult = await query(
      'SELECT company_name, billing_type, balance FROM companies WHERE id = $1',
      [id]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    // 총 건수
    const countResult = await query(
      'SELECT COUNT(*) FROM balance_transactions WHERE company_id = $1',
      [id]
    );
    const total = parseInt(countResult.rows[0].count);

    // 이력 조회
    const result = await query(
      `SELECT bt.id, bt.type, bt.amount, bt.balance_after, bt.description, bt.reference_type, bt.reference_id, bt.admin_id, bt.created_at,
              sa.name as admin_name
       FROM balance_transactions bt
       LEFT JOIN super_admins sa ON bt.admin_id = sa.id
       WHERE bt.company_id = $1
       ORDER BY bt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    const c = companyResult.rows[0];
    res.json({
      company: { companyName: c.company_name, billingType: c.billing_type, balance: Number(c.balance) },
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

// ===== 충전 요청 관리 API =====

// 충전 요청 목록 조회 (필터 + 페이지네이션)
router.get('/deposit-requests', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status as string; // pending, confirmed, rejected
    const paymentMethod = req.query.paymentMethod as string; // deposit, card, virtual_account

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (status && status !== 'all') {
      where += ` AND dr.status = $${paramIdx++}`;
      params.push(status);
    }
    if (paymentMethod && paymentMethod !== 'all') {
      where += ` AND COALESCE(dr.payment_method, 'deposit') = $${paramIdx++}`;
      params.push(paymentMethod);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM deposit_requests dr ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT dr.id, dr.company_id, dr.amount, dr.depositor_name, dr.status,
              COALESCE(dr.payment_method, 'deposit') as payment_method,
              dr.admin_note, dr.confirmed_by, dr.confirmed_at, dr.created_at,
              c.company_name, c.billing_type, c.balance,
              sa.name as confirmed_by_name
       FROM deposit_requests dr
       JOIN companies c ON dr.company_id = c.id
       LEFT JOIN super_admins sa ON dr.confirmed_by = sa.id
       ${where}
       ORDER BY CASE WHEN dr.status = 'pending' THEN 0 ELSE 1 END, dr.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    res.json({
      requests: result.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('충전 요청 목록 조회 실패:', error);
    res.status(500).json({ error: '충전 요청 목록 조회 실패' });
  }
});

// 충전 요청 승인 (잔액 자동 충전)
router.put('/deposit-requests/:id/approve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = (req as any).user?.userId;
  const { adminNote } = req.body;

  try {
    // 요청 조회
    const reqResult = await query(
      `SELECT dr.*, c.company_name, c.billing_type, c.balance
       FROM deposit_requests dr
       JOIN companies c ON dr.company_id = c.id
       WHERE dr.id = $1`,
      [id]
    );

    if (reqResult.rows.length === 0) {
      return res.status(404).json({ error: '충전 요청을 찾을 수 없습니다.' });
    }

    const depositReq = reqResult.rows[0];

    if (depositReq.status !== 'pending') {
      return res.status(400).json({ error: '이미 처리된 요청입니다.' });
    }

    if (depositReq.billing_type !== 'prepaid') {
      return res.status(400).json({ error: '선불 고객사가 아닙니다.' });
    }

    // 1. 잔액 충전
    const balanceResult = await query(
      'UPDATE companies SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance',
      [depositReq.amount, depositReq.company_id]
    );

    // 2. balance_transactions 기록
    const newBalance = Number(balanceResult.rows[0].balance);
    await query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_before, balance_after, description, reference_type, reference_id, admin_id, payment_method)
       VALUES ($1, 'deposit_charge', $2, $3, $4, $5, 'deposit_request', $6, $7, 'bank_transfer')`,
      [
        depositReq.company_id,
        depositReq.amount,
        newBalance - Number(depositReq.amount),
        newBalance,
        `무통장입금 승인 (입금자: ${depositReq.depositor_name})`,
        id,
        adminId
      ]
    );

    // 3. deposit_requests 상태 변경
    await query(
      `UPDATE deposit_requests SET status = 'confirmed', confirmed_by = $1, confirmed_at = NOW(), admin_note = $2 WHERE id = $3`,
      [adminId, adminNote || null, id]
    );

    console.log(`[입금승인] ${depositReq.company_name}: +${Number(depositReq.amount).toLocaleString()}원 → 잔액 ${newBalance.toLocaleString()}원 (입금자: ${depositReq.depositor_name})`);

    res.json({
      message: `${Number(depositReq.amount).toLocaleString()}원이 충전되었습니다.`,
      balance: newBalance,
    });
  } catch (error) {
    console.error('충전 요청 승인 실패:', error);
    res.status(500).json({ error: '충전 요청 승인 실패' });
  }
});

// 충전 요청 거절
router.put('/deposit-requests/:id/reject', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = (req as any).user?.userId;
  const { adminNote } = req.body;

  try {
    const reqResult = await query(
      'SELECT status, amount, depositor_name FROM deposit_requests WHERE id = $1',
      [id]
    );

    if (reqResult.rows.length === 0) {
      return res.status(404).json({ error: '충전 요청을 찾을 수 없습니다.' });
    }

    if (reqResult.rows[0].status !== 'pending') {
      return res.status(400).json({ error: '이미 처리된 요청입니다.' });
    }

    await query(
      `UPDATE deposit_requests SET status = 'rejected', confirmed_by = $1, confirmed_at = NOW(), admin_note = $2 WHERE id = $3`,
      [adminId, adminNote || '거절', id]
    );

    console.log(`[입금거절] 요청 ${id}: ${Number(reqResult.rows[0].amount).toLocaleString()}원 (입금자: ${reqResult.rows[0].depositor_name})`);

    res.json({ message: '충전 요청이 거절되었습니다.' });
  } catch (error) {
    console.error('충전 요청 거절 실패:', error);
    res.status(500).json({ error: '충전 요청 거절 실패' });
  }
});

// 전체 선불 고객사 잔액 현황
router.get('/balance-overview', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT c.id, c.company_name, c.billing_type, c.balance,
        c.cost_per_sms, c.cost_per_lms,
        (SELECT COUNT(*) FROM balance_transactions WHERE company_id = c.id AND created_at >= NOW() - INTERVAL '30 days') as recent_tx_count,
        (SELECT SUM(amount) FROM balance_transactions WHERE company_id = c.id AND type = 'deduct' AND created_at >= NOW() - INTERVAL '30 days') as monthly_usage
      FROM companies c
      WHERE c.billing_type = 'prepaid' AND c.status = 'active'
      ORDER BY c.balance ASC
    `);

    res.json({ companies: result.rows });
  } catch (error) {
    console.error('잔액 현황 조회 실패:', error);
    res.status(500).json({ error: '잔액 현황 조회 실패' });
  }
});

// ===== 충전 관리 통합 API =====
router.get('/charge-management', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const offset = (page - 1) * limit;
    const companyId = req.query.companyId as string;
    const type = req.query.type as string;
    const paymentMethod = req.query.paymentMethod as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    // 1. Pending deposit requests (항상 조회)
    const pendingResult = await query(
      `SELECT dr.id, dr.company_id, dr.amount, dr.depositor_name, dr.status,
              COALESCE(dr.payment_method, 'deposit') as payment_method,
              dr.created_at, c.company_name, c.balance
       FROM deposit_requests dr
       JOIN companies c ON dr.company_id = c.id
       WHERE dr.status = 'pending'
       ORDER BY dr.created_at DESC`
    );

    // 2. Balance transactions 필터
    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (companyId && companyId !== 'all') {
      where += ` AND bt.company_id = $${paramIdx++}`;
      params.push(companyId);
    }
    if (type && type !== 'all') {
      if (type === 'charge') {
        where += ` AND bt.type IN ('admin_charge', 'charge', 'deposit_charge')`;
      } else if (type === 'deduct') {
        where += ` AND bt.type IN ('admin_deduct', 'deduct')`;
      } else if (type === 'refund') {
        where += ` AND bt.type = 'refund'`;
      }
    }
    if (paymentMethod && paymentMethod !== 'all') {
      where += ` AND COALESCE(bt.payment_method, 'system') = $${paramIdx++}`;
      params.push(paymentMethod);
    }
    if (startDate) {
      where += ` AND bt.created_at >= $${paramIdx++}::date`;
      params.push(startDate);
    }
    if (endDate) {
      where += ` AND bt.created_at < ($${paramIdx++}::date + INTERVAL '1 day')`;
      params.push(endDate);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM balance_transactions bt ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const txResult = await query(
      `SELECT bt.id, bt.company_id, bt.type, bt.amount, bt.balance_after, bt.description,
              bt.reference_type, bt.reference_id, bt.admin_id,
              COALESCE(bt.payment_method, 'system') as payment_method,
              bt.created_at,
              c.company_name,
              sa.name as admin_name
       FROM balance_transactions bt
       JOIN companies c ON bt.company_id = c.id
       LEFT JOIN super_admins sa ON bt.admin_id = sa.id
       ${where}
       ORDER BY bt.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    res.json({
      pendingRequests: pendingResult.rows,
      transactions: txResult.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('충전 관리 조회 실패:', error);
    res.status(500).json({ error: '충전 관리 조회 실패' });
  }
});

// ===== 감사 로그 조회 API =====
router.get('/audit-logs', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 25, action, companyId, fromDate, toDate, userId } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // 액션 필터
    if (action && action !== 'all') {
      whereClause += ` AND al.action LIKE $${paramIndex++}`;
      params.push(`%${action}%`);
    }

    // 고객사 필터 (user의 company_id로)
    if (companyId && companyId !== 'all') {
      whereClause += ` AND (u.company_id = $${paramIndex} OR al.details->>'companyId' = $${paramIndex})`;
      params.push(companyId);
      paramIndex++;
    }

    // 사용자 필터
    if (userId && userId !== 'all') {
      whereClause += ` AND al.user_id = $${paramIndex++}::uuid`;
      params.push(userId);
    }

    // 날짜 필터
    if (fromDate) {
      whereClause += ` AND al.created_at >= $${paramIndex++}::date`;
      params.push(String(fromDate));
    }
    if (toDate) {
      whereClause += ` AND al.created_at < ($${paramIndex++}::date + interval '1 day')`;
      params.push(String(toDate));
    }

    // 총 건수
    const countResult = await query(
      `SELECT COUNT(*) FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // 데이터 조회
    params.push(Number(limit), offset);
    const result = await query(
      `SELECT 
        al.id, al.user_id, al.action, al.target_type, al.target_id,
        al.details, al.ip_address, al.user_agent, al.created_at,
        COALESCE(u.login_id, sa.login_id, '시스템') as login_id,
        COALESCE(u.name, sa.name, '시스템') as user_name,
        u.company_id,
        c.company_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN super_admins sa ON al.user_id = sa.id
       LEFT JOIN companies c ON u.company_id = c.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    // 액션 유형 목록 (필터용)
    const actionsResult = await query(
      `SELECT DISTINCT action FROM audit_logs ORDER BY action`
    );

    res.json({
      logs: result.rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      actions: actionsResult.rows.map((r: any) => r.action),
    });
  } catch (error) {
    console.error('감사 로그 조회 실패:', error);
    res.status(500).json({ error: '감사 로그 조회 실패' });
  }
});

// ===== 발송 라인그룹 관리 API =====

// GET /api/admin/line-groups - 라인그룹 목록
router.get('/line-groups', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT lg.*,
        (SELECT COUNT(*) FROM companies c WHERE c.line_group_id = lg.id) as company_count
      FROM sms_line_groups lg
      ORDER BY lg.sort_order, lg.created_at
    `);
    res.json({ lineGroups: result.rows });
  } catch (error) {
    console.error('라인그룹 목록 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// POST /api/admin/line-groups - 라인그룹 생성
router.post('/line-groups', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { groupName, groupType, smsTables, sortOrder } = req.body;
    if (!groupName || !groupType || !smsTables || smsTables.length === 0) {
      return res.status(400).json({ error: '필수 필드를 입력해주세요.' });
    }
    const result = await query(`
      INSERT INTO sms_line_groups (group_name, group_type, sms_tables, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [groupName, groupType, smsTables, sortOrder || 0]);

    invalidateLineGroupCache();
    res.json({ lineGroup: result.rows[0], message: '라인그룹이 생성되었습니다.' });
  } catch (error) {
    console.error('라인그룹 생성 실패:', error);
    res.status(500).json({ error: '생성 실패' });
  }
});

// PUT /api/admin/line-groups/:id - 라인그룹 수정
router.put('/line-groups/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { groupName, groupType, smsTables, sortOrder, isActive } = req.body;
    const result = await query(`
      UPDATE sms_line_groups
      SET group_name = COALESCE($1, group_name),
          group_type = COALESCE($2, group_type),
          sms_tables = COALESCE($3, sms_tables),
          sort_order = COALESCE($4, sort_order),
          is_active = COALESCE($5, is_active),
          updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `, [groupName || null, groupType || null, smsTables || null, sortOrder !== undefined ? sortOrder : null, isActive !== undefined ? isActive : null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '라인그룹을 찾을 수 없습니다.' });
    }

    invalidateLineGroupCache();
    res.json({ lineGroup: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('라인그룹 수정 실패:', error);
    res.status(500).json({ error: '수정 실패' });
  }
});

// DELETE /api/admin/line-groups/:id - 라인그룹 삭제
router.delete('/line-groups/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // 할당된 회사 있는지 확인
    const assigned = await query('SELECT COUNT(*) FROM companies WHERE line_group_id = $1', [id]);
    if (parseInt(assigned.rows[0].count) > 0) {
      return res.status(400).json({ error: '할당된 고객사가 있어 삭제할 수 없습니다. 먼저 고객사 라인그룹을 변경해주세요.' });
    }
    await query('DELETE FROM sms_line_groups WHERE id = $1', [id]);
    invalidateLineGroupCache();
    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('라인그룹 삭제 실패:', error);
    res.status(500).json({ error: '삭제 실패' });
  }
});

export default router;