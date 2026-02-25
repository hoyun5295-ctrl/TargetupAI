import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import nodemailer from 'nodemailer';
import { query } from '../config/database';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';

const router = Router();

// 모든 라우트에 인증 필요
router.use(authenticate);

// ⚠️ /settings 라우트를 /:id 보다 먼저 정의해야 함!
// 회사 설정 조회
router.get('/settings', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const result = await query(`
      SELECT 
        brand_name, business_type, reject_number, manager_phone, manager_contacts,
        monthly_budget, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
        send_start_hour, send_end_hour, daily_limit_per_customer,
        holiday_send_allowed, duplicate_prevention_days,
        target_strategy, cross_category_allowed, excluded_segments,
        approval_required
      FROM companies WHERE id = $1
    `, [companyId]);
    
    const row = result.rows[0] || {};
    // manager_phone: JSON 문자열이면 파싱, 단일 번호면 배열로 변환
    if (row.manager_phone) {
      try {
        row.manager_phones = JSON.parse(row.manager_phone);
      } catch {
        // 기존 단일 번호 → 배열로 변환
        row.manager_phones = row.manager_phone ? [row.manager_phone] : [];
      }
    } else {
      row.manager_phones = [];
    }

    // 카카오 발신 프로필 목록도 함께 제공
    const kakaoProfilesResult = await query(
      `SELECT id, profile_key, profile_name, is_active FROM kakao_sender_profiles WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC`,
      [companyId]
    );
    row.kakao_profiles = kakaoProfilesResult.rows;
    
    res.json(row);
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
      brand_name, business_type, reject_number, manager_phones, manager_contacts,
      monthly_budget, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
      send_start_hour, send_end_hour, daily_limit_per_customer,
      holiday_send_allowed, duplicate_prevention_days,
      target_strategy, cross_category_allowed, excluded_segments,
      approval_required
    } = req.body;

    // manager_phones 배열 → JSON 문자열로 저장 (하위 호환)
    const managerPhoneJson = manager_phones ? JSON.stringify(manager_phones) : null;
    // manager_contacts는 JSON 문자열로 변환해서 저장
    const managerContactsJson = manager_contacts ? JSON.stringify(manager_contacts) : null;

    await query(`
      UPDATE companies SET
        brand_name = COALESCE($1, brand_name),
        business_type = COALESCE($2, business_type),
        reject_number = COALESCE($3, reject_number),
        manager_phone = COALESCE($4, manager_phone),
        manager_contacts = COALESCE($5, manager_contacts),
        monthly_budget = COALESCE($6, monthly_budget),
        cost_per_sms = COALESCE($7, cost_per_sms),
        cost_per_lms = COALESCE($8, cost_per_lms),
        cost_per_mms = COALESCE($9, cost_per_mms),
        cost_per_kakao = COALESCE($10, cost_per_kakao),
        send_start_hour = COALESCE($11, send_start_hour),
        send_end_hour = COALESCE($12, send_end_hour),
        daily_limit_per_customer = COALESCE($13, daily_limit_per_customer),
        holiday_send_allowed = COALESCE($14, holiday_send_allowed),
        duplicate_prevention_days = COALESCE($15, duplicate_prevention_days),
        target_strategy = COALESCE($16, target_strategy),
        cross_category_allowed = COALESCE($17, cross_category_allowed),
        excluded_segments = COALESCE($18, excluded_segments),
        approval_required = COALESCE($19, approval_required),
        updated_at = NOW()
      WHERE id = $20
    `, [
      brand_name, business_type, reject_number, managerPhoneJson, managerContactsJson,
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
// GET /api/companies/my-plan - 현재 회사 플랜 정보
router.get('/my-plan', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    const result = await query(`
      SELECT 
        c.company_name,
        c.plan_id,
        p.plan_name,
        p.plan_code,
        p.monthly_price,
        p.max_customers,
        c.created_at,
        c.created_at + INTERVAL '7 days' as trial_expires_at,
        NOW() > c.created_at + INTERVAL '7 days' as is_trial_expired,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id) as current_customers
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [companyId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('플랜 조회 실패:', error);
    res.status(500).json({ error: '플랜 조회 실패' });
  }
});

// POST /api/companies/plan-request - 플랜 변경 신청
router.post('/plan-request', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    const { requestedPlanId, message } = req.body;

    if (!requestedPlanId) {
      return res.status(400).json({ error: '요청할 플랜을 선택해주세요.' });
    }

    // 중복 신청 방지: 이미 pending 상태인 신청이 있는지 확인
    const pendingCheck = await query(
      `SELECT id FROM plan_requests WHERE company_id = $1 AND status = 'pending' LIMIT 1`,
      [companyId]
    );
    if (pendingCheck.rows.length > 0) {
      return res.status(409).json({ error: '이미 처리 대기 중인 요금제 신청이 있습니다.', code: 'DUPLICATE_PENDING' });
    }

    // plan_requests 테이블에 저장
    await query(`
      INSERT INTO plan_requests (company_id, user_id, requested_plan_id, message, status)
      VALUES ($1, $2, $3, $4, 'pending')
    `, [companyId, userId, requestedPlanId, message || null]);

    res.json({ message: '플랜 변경 신청이 접수되었습니다.' });
  } catch (error) {
    console.error('플랜 신청 실패:', error);
    res.status(500).json({ error: '플랜 신청 실패' });
  }
});

// GET /api/companies/plan-request/status - 현재 신청 상태 조회 (pending + 미확인 결과)
router.get('/plan-request/status', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    // pending 신청 확인
    const pendingResult = await query(
      `SELECT pr.id, pr.status, p.plan_name as requested_plan_name
       FROM plan_requests pr
       LEFT JOIN plans p ON pr.requested_plan_id = p.id
       WHERE pr.company_id = $1 AND pr.status = 'pending'
       ORDER BY pr.created_at DESC LIMIT 1`,
      [companyId]
    );

    // 미확인 처리 결과 (approved/rejected 중 user_confirmed = false)
    const unconfirmedResult = await query(
      `SELECT pr.id, pr.status, pr.admin_note, p.plan_name as requested_plan_name, pr.processed_at
       FROM plan_requests pr
       LEFT JOIN plans p ON pr.requested_plan_id = p.id
       WHERE pr.company_id = $1 AND pr.status IN ('approved', 'rejected') AND pr.user_confirmed = false
       ORDER BY pr.processed_at DESC LIMIT 1`,
      [companyId]
    );

    res.json({
      pending: pendingResult.rows[0] || null,
      unconfirmed: unconfirmedResult.rows[0] || null,
    });
  } catch (error) {
    console.error('플랜 신청 상태 조회 실패:', error);
    res.status(500).json({ error: '플랜 신청 상태 조회 실패' });
  }
});

// PUT /api/companies/plan-request/:id/confirm - 사용자 결과 확인 처리
router.put('/plan-request/:id/confirm', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const { id } = req.params;

    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    await query(
      `UPDATE plan_requests SET user_confirmed = true WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    res.json({ message: '확인 처리되었습니다.' });
  } catch (error) {
    console.error('플랜 결과 확인 실패:', error);
    res.status(500).json({ error: '플랜 결과 확인 실패' });
  }
});

// 회신번호 목록 조회
router.get('/callback-numbers', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    let sql = 'SELECT id, phone, label, is_default, store_code, store_name, created_at FROM callback_numbers WHERE company_id = $1';
    const params: any[] = [companyId];

    // 일반 사용자는 본인 store_codes에 해당하는 회신번호만
    if (userType !== 'admin') {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        sql += ' AND (store_code = ANY($2) OR store_code IS NULL OR is_default = true)';
        params.push(storeCodes);
      }
    }

    sql += ' ORDER BY is_default DESC, store_code ASC, created_at ASC';
    const result = await query(sql, params);

    res.json({ success: true, numbers: result.rows });
  } catch (error) {
    console.error('회신번호 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

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

    const countResult = await query(
      `SELECT COUNT(*) FROM companies c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

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

    const apiKey = `tk_${crypto.randomBytes(24).toString('hex')}`;
    const apiSecret = crypto.randomBytes(32).toString('hex');
    const dbName = `targetup_${companyCode.toLowerCase()}`;

    const result = await query(
      `INSERT INTO companies (
        name, company_code, company_name, business_number, ceo_name,
        contact_name, contact_email, contact_phone, address,
        plan_id, data_input_method, api_key, api_secret, db_name,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        companyName, companyCode, companyName, businessNumber, ceoName,
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

// PUT /api/companies/:id - 고객사 수정 (전체 설정 포함)
router.put('/:id', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      companyName, businessNumber, ceoName,
      contactName, contactEmail, contactPhone,
      address, planId, status, dataInputMethod,
      rejectNumber,
      // 발송정책
      sendHourStart, sendHourEnd, dailyLimit,
      holidaySend, duplicateDays,
      // 단가
      costPerSms, costPerLms, costPerMms, costPerKakao,
      // AI설정
      targetStrategy, crossCategoryAllowed, excludedSegments,
      approvalRequired,
      // 분류코드
      storeCodeList,
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
        reject_number = COALESCE($11, reject_number),
        send_start_hour = COALESCE($12, send_start_hour),
        send_end_hour = COALESCE($13, send_end_hour),
        daily_limit_per_customer = COALESCE($14, daily_limit_per_customer),
        holiday_send_allowed = COALESCE($15, holiday_send_allowed),
        duplicate_prevention_days = COALESCE($16, duplicate_prevention_days),
        cost_per_sms = COALESCE($17, cost_per_sms),
        cost_per_lms = COALESCE($18, cost_per_lms),
        cost_per_mms = COALESCE($19, cost_per_mms),
        cost_per_kakao = COALESCE($20, cost_per_kakao),
        target_strategy = COALESCE($21, target_strategy),
        cross_category_allowed = COALESCE($22, cross_category_allowed),
        excluded_segments = COALESCE($23, excluded_segments),
        approval_required = COALESCE($24, approval_required),
        store_code_list = COALESCE($25, store_code_list),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $26
      RETURNING *`,
      [
        companyName, businessNumber, ceoName, contactName,
        contactEmail, contactPhone, address, planId,
        status, dataInputMethod, rejectNumber,
        sendHourStart, sendHourEnd, dailyLimit,
        holidaySend, duplicateDays,
        costPerSms, costPerLms, costPerMms, costPerKakao,
        targetStrategy, crossCategoryAllowed,
        excludedSegments ? JSON.stringify(excludedSegments) : null,
        approvalRequired,
        storeCodeList ? JSON.stringify(storeCodeList) : null,
        id
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

// 회신번호 목록 조회
router.get('/callback-numbers', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const result = await query(
      'SELECT id, phone, label, is_default, created_at FROM callback_numbers WHERE company_id = $1 ORDER BY is_default DESC, created_at ASC',
      [companyId]
    );
  
    res.json({ success: true, numbers: result.rows });
  } catch (error) {
    console.error('회신번호 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/companies/refresh-schema - 고객 스키마 갱신
router.post('/refresh-schema', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    await query(`
      UPDATE companies SET customer_schema = (
        SELECT jsonb_build_object(
          'genders', (SELECT array_agg(DISTINCT gender) FROM customers WHERE company_id = $1 AND gender IS NOT NULL),
          'grades', (SELECT array_agg(DISTINCT grade) FROM customers WHERE company_id = $1 AND grade IS NOT NULL),
          'custom_field_keys', (SELECT array_agg(DISTINCT k) FROM customers, jsonb_object_keys(custom_fields) k WHERE company_id = $1),
          'store_codes', (SELECT array_agg(DISTINCT store_code) FROM customers WHERE company_id = $1 AND store_code IS NOT NULL)
        )
      ) WHERE id = $1
    `, [companyId]);

    res.json({ success: true, message: '스키마가 갱신되었습니다.' });
  } catch (error) {
    console.error('스키마 갱신 실패:', error);
    res.status(500).json({ success: false, error: '스키마 갱신 실패' });
  }
});

// POST /api/companies/inquiry - 솔루션 문의 메일 발송
router.post('/inquiry', async (req: Request, res: Response) => {
  try {
    const { companyName, contactName, phone, email, planInterest, subject, message } = req.body;

    if (!contactName || !phone || !email || !subject || !message) {
      return res.status(400).json({ error: '필수 항목을 모두 입력해주세요.' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.hiworks.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const htmlBody = `
      <div style="font-family: 'Apple SD Gothic Neo', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3B82F6, #6366F1); padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 20px;">📩 한줄로 솔루션 문의</h2>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280; width: 100px;">회사명</td>
              <td style="padding: 10px 0; font-weight: 600;">${companyName || '-'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280;">담당자</td>
              <td style="padding: 10px 0; font-weight: 600;">${contactName}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280;">연락처</td>
              <td style="padding: 10px 0;">${phone}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280;">이메일</td>
              <td style="padding: 10px 0;"><a href="mailto:${email}" style="color: #3B82F6;">${email}</a></td>
            </tr>
            ${planInterest ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280;">관심 요금제</td>
              <td style="padding: 10px 0;"><span style="background: #EFF6FF; color: #2563EB; padding: 2px 10px; border-radius: 12px; font-size: 13px;">${planInterest}</span></td>
            </tr>` : ''}
          </table>
          <div style="margin-top: 20px; padding: 16px; background: #F9FAFB; border-radius: 8px;">
            <div style="font-size: 13px; color: #6B7280; margin-bottom: 8px;">문의 내용</div>
            <div style="font-size: 14px; color: #111827; white-space: pre-line;">${message}</div>
          </div>
          <div style="margin-top: 20px; font-size: 12px; color: #9CA3AF; text-align: center;">
            이 메일은 한줄로(hanjul.ai) 솔루션 문의 폼에서 자동 발송되었습니다.
          </div>
        </div>
      </div>
    `;

    const toAddresses = (process.env.SMTP_TO || '').split(',').map(e => e.trim()).filter(Boolean);

    await transporter.sendMail({
      from: `"한줄로 문의" <${process.env.SMTP_USER}>`,
      to: toAddresses.join(', '),
      bcc: process.env.SMTP_BCC || '',
      subject: `[한줄로 문의] ${subject}`,
      html: htmlBody,
    });

    res.json({ message: '문의가 전송되었습니다.' });
  } catch (error) {
    console.error('문의 메일 발송 실패:', error);
    res.status(500).json({ error: '문의 전송에 실패했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

// ===== 카카오 발신 프로필 관리 =====

// GET /api/companies/kakao-profiles — 카카오 발신 프로필 목록
router.get('/kakao-profiles', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const result = await query(
      `SELECT id, profile_key, profile_name, is_active, created_at
       FROM kakao_sender_profiles
       WHERE company_id = $1
       ORDER BY created_at ASC`,
      [companyId]
    );

    res.json({ success: true, profiles: result.rows });
  } catch (error) {
    console.error('카카오 프로필 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/companies/kakao-profiles — 카카오 발신 프로필 등록
router.post('/kakao-profiles', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userType = (req as any).user?.userType;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }
    // 고객사 관리자 또는 슈퍼관리자만 등록 가능
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ success: false, error: '관리자 권한이 필요합니다' });
    }

    const { profileKey, profileName } = req.body;
    if (!profileKey || !profileName) {
      return res.status(400).json({ success: false, error: '프로필키와 프로필명은 필수입니다' });
    }

    // 중복 체크
    const existing = await query(
      'SELECT id FROM kakao_sender_profiles WHERE company_id = $1 AND profile_key = $2',
      [companyId, profileKey]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: '이미 등록된 프로필키입니다' });
    }

    const result = await query(
      `INSERT INTO kakao_sender_profiles (company_id, profile_key, profile_name, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, profile_key, profile_name, is_active, created_at`,
      [companyId, profileKey, profileName]
    );

    res.status(201).json({ success: true, profile: result.rows[0], message: '카카오 프로필이 등록되었습니다.' });
  } catch (error) {
    console.error('카카오 프로필 등록 실패:', error);
    res.status(500).json({ success: false, error: '등록 실패' });
  }
});

// PUT /api/companies/kakao-profiles/:id — 카카오 발신 프로필 수정
router.put('/kakao-profiles/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userType = (req as any).user?.userType;
    const { id } = req.params;

    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ success: false, error: '관리자 권한이 필요합니다' });
    }

    const { profileName, isActive } = req.body;

    const result = await query(
      `UPDATE kakao_sender_profiles
       SET profile_name = COALESCE($1, profile_name),
           is_active = COALESCE($2, is_active)
       WHERE id = $3 AND company_id = $4
       RETURNING id, profile_key, profile_name, is_active`,
      [profileName, isActive, id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '프로필을 찾을 수 없습니다' });
    }

    res.json({ success: true, profile: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('카카오 프로필 수정 실패:', error);
    res.status(500).json({ success: false, error: '수정 실패' });
  }
});

// DELETE /api/companies/kakao-profiles/:id — 카카오 발신 프로필 삭제
router.delete('/kakao-profiles/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userType = (req as any).user?.userType;
    const { id } = req.params;

    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ success: false, error: '관리자 권한이 필요합니다' });
    }

    const result = await query(
      'DELETE FROM kakao_sender_profiles WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '프로필을 찾을 수 없습니다' });
    }

    res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error) {
    console.error('카카오 프로필 삭제 실패:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

export default router;
