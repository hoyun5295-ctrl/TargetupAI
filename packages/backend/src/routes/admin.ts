import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { query, mysqlQuery } from '../config/database';

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
          `INSERT INTO SMSQ_SEND (dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1) VALUES (?, ?, ?, 'S', NOW(), 100, '1')`,
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
    businessNumber, ceoName, businessType, businessItem, address
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
          send_hour_start = COALESCE($9, send_hour_start),
          send_hour_end = COALESCE($10, send_hour_end),
          daily_limit = COALESCE($11, daily_limit),
          holiday_send = COALESCE($12, holiday_send),
          duplicate_days = COALESCE($13, duplicate_days),
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
          updated_at = NOW()
      WHERE id = $24
      RETURNING *
    `, [companyName, contactName, contactEmail, contactPhone, status, planId, rejectNumber, brandName, sendHourStart, sendHourEnd, dailyLimit, holidaySend, duplicateDays, costPerSms, costPerLms, costPerMms, costPerKakao, storeCodeList ? JSON.stringify(storeCodeList) : null, businessNumber, ceoName, businessType, businessItem, address, id]);
    
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
    const result = await query(`
      SELECT 
        c.id, c.campaign_name, c.status, c.scheduled_at, c.target_count,
        c.created_at, c.cancelled_by, c.cancelled_by_type, c.cancel_reason, c.cancelled_at,
        co.company_name, co.company_code,
        u.name as created_by_name
      FROM campaigns c
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.status IN ('scheduled', 'cancelled')
      ORDER BY c.created_at DESC
    `);
    
    res.json({ campaigns: result.rows });
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
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';
    const companyId = (req.query.companyId as string) || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    let dateWhere = '';
    const baseParams: any[] = [];
    let paramIdx = 1;

    if (startDate) {
      dateWhere += ` AND cr.sent_at >= $${paramIdx}::date`;
      baseParams.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      dateWhere += ` AND cr.sent_at < ($${paramIdx}::date + INTERVAL '1 day')`;
      baseParams.push(endDate);
      paramIdx++;
    }
    let companyWhere = '';
    if (companyId) {
      companyWhere = ` AND c.company_id = $${paramIdx}`;
      baseParams.push(companyId);
      paramIdx++;
    }

    // 1) 요약
    const summaryResult = await query(`
      SELECT 
        COALESCE(SUM(cr.sent_count), 0) as total_sent,
        COALESCE(SUM(cr.success_count), 0) as total_success,
        COALESCE(SUM(cr.fail_count), 0) as total_fail
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE cr.sent_at IS NOT NULL ${dateWhere} ${companyWhere}
    `, baseParams);

    // 2) 페이징된 일별/월별
    const groupCol = view === 'monthly'
      ? `TO_CHAR(cr.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(cr.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;
    const groupAlias = view === 'monthly' ? 'month' : 'date';

    const countResult = await query(`
      SELECT COUNT(*) FROM (
        SELECT ${groupCol} as grp, co.company_name
        FROM campaign_runs cr
        JOIN campaigns c ON cr.campaign_id = c.id
        JOIN companies co ON c.company_id = co.id
        WHERE cr.sent_at IS NOT NULL ${dateWhere} ${companyWhere}
        GROUP BY grp, co.company_name
      ) sub
    `, baseParams);
    const total = parseInt(countResult.rows[0].count);

    const rowsResult = await query(`
      SELECT 
        ${groupCol} as "${groupAlias}",
        co.id as company_id,
        co.company_name,
        COUNT(DISTINCT cr.id) as runs,
        COALESCE(SUM(cr.sent_count), 0) as sent,
        COALESCE(SUM(cr.success_count), 0) as success,
        COALESCE(SUM(cr.fail_count), 0) as fail
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      JOIN companies co ON c.company_id = co.id
      WHERE cr.sent_at IS NOT NULL ${dateWhere} ${companyWhere}
      GROUP BY ${groupCol}, co.id, co.company_name
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
      ? `TO_CHAR(cr.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(cr.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;

    // 사용자별 통계
    const result = await query(`
      SELECT 
        u.id as user_id,
        u.name as user_name,
        u.login_id,
        u.department,
        u.store_codes,
        COUNT(DISTINCT cr.id) as runs,
        COALESCE(SUM(cr.sent_count), 0) as sent,
        COALESCE(SUM(cr.success_count), 0) as success,
        COALESCE(SUM(cr.fail_count), 0) as fail
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE cr.sent_at IS NOT NULL
        AND ${groupCol} = $1
        AND c.company_id = $2
      GROUP BY u.id, u.name, u.login_id, u.department, u.store_codes
      ORDER BY sent DESC
    `, [dateVal, companyId]);

    // 캠페인 상세 목록
    const campaignsResult = await query(`
      SELECT 
        c.id as campaign_id,
        c.campaign_name,
        c.send_type,
        u.name as user_name,
        u.login_id,
        cr.id as run_id,
        cr.run_number,
        cr.sent_count,
        cr.success_count,
        cr.fail_count,
        cr.target_count,
        cr.message_type,
        cr.sent_at
      FROM campaign_runs cr
      JOIN campaigns c ON cr.campaign_id = c.id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE cr.sent_at IS NOT NULL
        AND ${groupCol} = $1
        AND c.company_id = $2
      ORDER BY cr.sent_at DESC
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
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      where += ` AND (c.campaign_name ILIKE $${paramIdx} OR co.company_name ILIKE $${paramIdx})`;
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

    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns c LEFT JOIN companies co ON c.company_id = co.id ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(`
      SELECT 
        c.id, c.campaign_name as name, c.status, c.send_type as campaign_type, c.created_at,
        c.company_id,
        co.company_name,
        (SELECT COUNT(*) FROM campaign_runs cr WHERE cr.campaign_id = c.id) as run_count,
        (SELECT COALESCE(SUM(cr.sent_count), 0) FROM campaign_runs cr WHERE cr.campaign_id = c.id) as total_sent,
        (SELECT COALESCE(SUM(cr.success_count), 0) FROM campaign_runs cr WHERE cr.campaign_id = c.id) as total_success,
        (SELECT COALESCE(SUM(cr.fail_count), 0) FROM campaign_runs cr WHERE cr.campaign_id = c.id) as total_fail,
        (SELECT cr.target_count FROM campaign_runs cr WHERE cr.campaign_id = c.id ORDER BY cr.run_number DESC LIMIT 1) as last_target_count,
        (SELECT cr.status FROM campaign_runs cr WHERE cr.campaign_id = c.id ORDER BY cr.run_number DESC LIMIT 1) as last_run_status,
        (SELECT cr.sent_at FROM campaign_runs cr WHERE cr.campaign_id = c.id ORDER BY cr.run_number DESC LIMIT 1) as last_sent_at
      FROM campaigns c
      LEFT JOIN companies co ON c.company_id = co.id
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

export default router;