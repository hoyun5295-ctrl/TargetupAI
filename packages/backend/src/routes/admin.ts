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
    storeCodeList
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
          updated_at = NOW()
      WHERE id = $19
      RETURNING *
    `, [companyName, contactName, contactEmail, contactPhone, status, planId, rejectNumber, brandName, sendHourStart, sendHourEnd, dailyLimit, holidaySend, duplicateDays, costPerSms, costPerLms, costPerMms, costPerKakao, storeCodeList ? JSON.stringify(storeCodeList) : null, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    
    res.json({ company: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('회사 수정 실패:', error);
    res.status(500).json({ error: '회사 수정 실패' });
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
export default router;