import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import nodemailer from 'nodemailer';
import { query } from '../config/database';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { getCardDef } from '../utils/dashboard-card-pool';
import { getStoreScope } from '../utils/store-scope';

const router = Router();

// 모든 라우트에 인증 필요
router.use(authenticate);

// ⚠️ /settings 라우트를 /:id 보다 먼저 정의해야 함!
// 회사 설정 조회
router.get('/settings', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const result = await query(`
      SELECT
        company_name, brand_name, business_type, reject_number, manager_phone, manager_contacts,
        monthly_budget, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
        send_start_hour, send_end_hour, daily_limit_per_customer,
        holiday_send_allowed, duplicate_prevention_days,
        target_strategy, cross_category_allowed, excluded_segments,
        approval_required
      FROM companies WHERE id = $1
    `, [companyId]);

    const row = result.rows[0] || {};
    // ★ B17-11: 사용자별 080번호 우선 적용 (reject_number override)
    if (userId) {
      const userOptResult = await query('SELECT opt_out_080_number FROM users WHERE id = $1', [userId]);
      const userOpt080 = userOptResult.rows[0]?.opt_out_080_number;
      if (userOpt080) row.reject_number = userOpt080;
    }
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
        p.ai_analysis_level,
        p.customer_db_enabled,
        p.spam_filter_enabled,
        p.ai_messaging_enabled,
        p.auto_spam_test_enabled,
        p.ai_premium_enabled,
        c.subscription_status,
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

// D87: 자사 사용자 목록 조회 (발신번호 배정용)
router.get('/company-users', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const result = await query(
      `SELECT id, name, email, user_type, store_codes
       FROM users
       WHERE company_id = $1 AND is_active = true
       ORDER BY user_type ASC, name ASC`,
      [companyId]
    );

    res.json({ success: true, users: result.rows });
  } catch (error) {
    console.error('사용자 목록 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// 회신번호 목록 조회
// D87: assignment_scope 기반 사용자별 배정 필터링 추가
router.get('/callback-numbers', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    // D87: assignment_scope 기반 필터링 (하위호환: 컬럼 미존재 시 기존 동작 유지)
    let hasAssignmentScope = true;
    try {
      await query(`SELECT assignment_scope FROM callback_numbers LIMIT 0`);
    } catch {
      hasAssignmentScope = false;
    }

    let sql: string;
    const params: any[] = [companyId];

    if (hasAssignmentScope) {
      // D87: assignment_scope 필터링
      // - 'all': 누구나 사용 가능
      // - 'assigned': callback_number_assignments에 배정된 사용자만
      sql = `
        SELECT cn.id, cn.phone, cn.label, cn.is_default, cn.store_code, cn.store_name, cn.created_at, cn.assignment_scope
        FROM callback_numbers cn
        WHERE cn.company_id = $1
          AND (
            cn.assignment_scope = 'all'
            OR EXISTS (
              SELECT 1 FROM callback_number_assignments cna
              WHERE cna.callback_number_id = cn.id AND cna.user_id = $2
            )
          )
      `;
      params.push(userId);
    } else {
      // 하위호환: assignment_scope 컬럼 없으면 기존 쿼리
      sql = `SELECT id, phone, label, is_default, store_code, store_name, created_at FROM callback_numbers WHERE company_id = $1`;
    }

    // 일반 사용자(브랜드담당자)는 본인 store_codes에 해당하는 회신번호만
    if (userType !== 'admin') {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        const paramIdx = params.length + 1;
        sql += ` AND (${hasAssignmentScope ? 'cn.' : ''}store_code = ANY($${paramIdx}) OR ${hasAssignmentScope ? 'cn.' : ''}store_code IS NULL OR ${hasAssignmentScope ? 'cn.' : ''}is_default = true)`;
        params.push(storeCodes);
      }
    }

    sql += ` ORDER BY ${hasAssignmentScope ? 'cn.' : ''}is_default DESC, ${hasAssignmentScope ? 'cn.' : ''}store_code ASC, ${hasAssignmentScope ? 'cn.' : ''}created_at ASC`;
    const result = await query(sql, params);

    res.json({ success: true, numbers: result.rows });
  } catch (error) {
    console.error('회신번호 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// ===== 대시보드 동적 카드 API (D41) =====

interface CardDataResult {
  cardId: string;
  label: string;
  type: string;
  icon: string;
  value: number | { label: string; count: number }[];
  hasData: boolean;
}

/**
 * 대시보드 카드 집계 함수
 * 설정된 카드만 효율적으로 집계 (단일 customers 쿼리 + 필요한 외부 테이블만)
 */
async function aggregateDashboardCards(companyId: string, cardIds: string[], userId?: string, userType?: string): Promise<CardDataResult[]> {
  const results: CardDataResult[] = [];

  // ★ 사용자 격리: 고객 데이터는 store_code 기준, 발송 데이터는 created_by 기준
  let customerStoreFilter = '';
  const isCompanyUser = userType === 'company_user' && userId;
  if (isCompanyUser) {
    const scope = await getStoreScope(companyId, userId);
    if (scope.type === 'blocked') {
      return cardIds.map(id => {
        const def = getCardDef(id);
        return { cardId: id, label: def?.label ?? id, type: def?.type ?? 'count', icon: def?.icon ?? 'HelpCircle', value: 0, hasData: false };
      });
    }
    if (scope.type === 'filtered') {
      customerStoreFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = '${companyId}' AND store_code = ANY(ARRAY[${scope.storeCodes.map(s => `'${s}'`).join(',')}]::text[]))`;
    }
  }

  // ── 1단계: customers 통합 집계 (데이터 존재 여부 포함) ──
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
  const baseResult = await query(`
    SELECT
      COUNT(*)::int                                                                          as total_customers,
      COUNT(*) FILTER (WHERE gender = 'M')::int                                              as gender_male,
      COUNT(*) FILTER (WHERE gender = 'F')::int                                              as gender_female,
      COUNT(*) FILTER (WHERE gender IS NOT NULL)::int                                        as has_gender_data,
      COUNT(*) FILTER (WHERE birth_month_day LIKE $2)::int                                   as birthday_this_month,
      COUNT(*) FILTER (WHERE birth_month_day IS NOT NULL)::int                               as has_birthday_data,
      COUNT(*) FILTER (WHERE email IS NOT NULL)::int                                         as email_has,
      COUNT(*) FILTER (WHERE sms_opt_in = true)::int                                         as opt_in_count,
      COUNT(*) FILTER (WHERE sms_opt_in IS NOT NULL)::int                                    as has_opt_in_data,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int                  as new_this_month,
      COALESCE(SUM(total_purchase_amount), 0)::numeric                                       as total_purchase_sum,
      COUNT(*) FILTER (WHERE total_purchase_amount IS NOT NULL AND total_purchase_amount > 0)::int as has_purchase_data,
      COUNT(*) FILTER (WHERE recent_purchase_date >= (NOW() - INTERVAL '30 days')::date)::int     as recent_30d_purchase,
      COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL)::int                               as has_recent_purchase_data,
      COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL AND recent_purchase_date < (NOW() - INTERVAL '90 days')::date)::int as inactive_90d,
      COUNT(*) FILTER (WHERE age IS NOT NULL)::int                                           as has_age_data,
      COUNT(*) FILTER (WHERE grade IS NOT NULL)::int                                         as has_grade_data,
      COUNT(*) FILTER (WHERE region IS NOT NULL)::int                                        as has_region_data,
      COUNT(*) FILTER (WHERE registered_store IS NOT NULL OR recent_purchase_store IS NOT NULL)::int as has_store_data
    FROM customers
    WHERE company_id = $1${customerStoreFilter}
  `, [companyId, `${month}-%`]);

  const base = baseResult.rows[0];
  const totalCustomers = parseInt(base.total_customers);

  // ── 2단계: 각 카드별 결과 조립 ──
  for (const cardId of cardIds) {
    const def = getCardDef(cardId);
    if (!def) continue;

    let value: number | { label: string; count: number }[] = 0;
    let hasData = true;

    switch (cardId) {
      // ── 단순 집계 (customers 통합 쿼리 결과 사용) ──
      case 'total_customers':
        value = totalCustomers;
        hasData = totalCustomers > 0;
        break;

      case 'gender_male':
        value = parseInt(base.gender_male);
        hasData = parseInt(base.has_gender_data) > 0;
        break;

      case 'gender_female':
        value = parseInt(base.gender_female);
        hasData = parseInt(base.has_gender_data) > 0;
        break;

      case 'birthday_this_month':
        value = parseInt(base.birthday_this_month);
        hasData = parseInt(base.has_birthday_data) > 0;
        break;

      case 'email_rate': {
        const emailHas = parseInt(base.email_has);
        value = totalCustomers > 0 ? Math.round((emailHas / totalCustomers) * 100) : 0;
        hasData = totalCustomers > 0;
        break;
      }

      case 'opt_in_count':
        value = parseInt(base.opt_in_count);
        hasData = parseInt(base.has_opt_in_data) > 0;
        break;

      case 'new_this_month':
        value = parseInt(base.new_this_month);
        hasData = totalCustomers > 0;
        break;

      case 'total_purchase_sum':
        value = parseFloat(base.total_purchase_sum);
        hasData = parseInt(base.has_purchase_data) > 0;
        break;

      case 'recent_30d_purchase':
        value = parseInt(base.recent_30d_purchase);
        hasData = parseInt(base.has_recent_purchase_data) > 0;
        break;

      case 'inactive_90d':
        value = parseInt(base.inactive_90d);
        hasData = parseInt(base.has_recent_purchase_data) > 0;
        break;

      // ── 분포형 카드 (데이터 존재 시에만 별도 쿼리) ──
      case 'age_distribution': {
        if (parseInt(base.has_age_data) === 0) {
          value = [];
          hasData = false;
          break;
        }
        const ageResult = await query(`
          SELECT
            CASE
              WHEN age < 20 THEN '10대 이하'
              WHEN age < 30 THEN '20대'
              WHEN age < 40 THEN '30대'
              WHEN age < 50 THEN '40대'
              WHEN age < 60 THEN '50대'
              ELSE '60대 이상'
            END as label,
            COUNT(*)::int as count
          FROM customers
          WHERE company_id = $1 AND age IS NOT NULL${customerStoreFilter}
          GROUP BY 1
          ORDER BY MIN(age)
        `, [companyId]);
        value = ageResult.rows as { label: string; count: number }[];
        hasData = true;
        break;
      }

      case 'grade_distribution': {
        if (parseInt(base.has_grade_data) === 0) {
          value = [];
          hasData = false;
          break;
        }
        const gradeResult = await query(`
          SELECT grade as label, COUNT(*)::int as count
          FROM customers
          WHERE company_id = $1 AND grade IS NOT NULL${customerStoreFilter}
          GROUP BY grade
          ORDER BY count DESC
        `, [companyId]);
        value = gradeResult.rows as { label: string; count: number }[];
        hasData = true;
        break;
      }

      case 'region_top': {
        if (parseInt(base.has_region_data) === 0) {
          value = [];
          hasData = false;
          break;
        }
        const regionResult = await query(`
          SELECT region as label, COUNT(*)::int as count
          FROM customers
          WHERE company_id = $1 AND region IS NOT NULL${customerStoreFilter}
          GROUP BY region
          ORDER BY count DESC
          LIMIT 5
        `, [companyId]);
        value = regionResult.rows as { label: string; count: number }[];
        hasData = true;
        break;
      }

      case 'store_distribution': {
        if (parseInt(base.has_store_data) === 0) {
          value = [];
          hasData = false;
          break;
        }
        // ★ B17-16: store_name → COALESCE(registered_store, recent_purchase_store) 실제 컬럼 참조
        const storeResult = await query(`
          SELECT COALESCE(registered_store, recent_purchase_store) as label, COUNT(*)::int as count
          FROM customers
          WHERE company_id = $1 AND (registered_store IS NOT NULL OR recent_purchase_store IS NOT NULL)${customerStoreFilter}
          GROUP BY COALESCE(registered_store, recent_purchase_store)
          ORDER BY count DESC
          LIMIT 10
        `, [companyId]);
        value = storeResult.rows as { label: string; count: number }[];
        hasData = true;
        break;
      }

      // ── 외부 테이블 카드 ──
      case 'opt_out_count': {
        const optOutResult = await query(
          `SELECT COUNT(DISTINCT phone)::int as count FROM unsubscribes WHERE company_id = $1`,
          [companyId]
        );
        value = parseInt(optOutResult.rows[0]?.count ?? 0);
        hasData = totalCustomers > 0;
        break;
      }

      case 'active_campaigns': {
        const campCreatedByFilter = isCompanyUser ? ` AND created_by = '${userId}'` : '';
        const campResult = await query(
          `SELECT COUNT(*)::int as count FROM campaigns WHERE company_id = $1 AND status IN ('sending', 'scheduled')${campCreatedByFilter}`,
          [companyId]
        );
        value = parseInt(campResult.rows[0]?.count ?? 0);
        hasData = true;
        break;
      }

      case 'monthly_spend': {
        const spendCreatedByFilter = isCompanyUser ? ` AND reference_id IN (SELECT id::text FROM campaigns WHERE company_id = '${companyId}' AND created_by = '${userId}')` : '';
        const spendResult = await query(
          `SELECT COALESCE(SUM(amount), 0)::numeric as total
           FROM balance_transactions
           WHERE company_id = $1 AND type = 'deduct' AND created_at >= date_trunc('month', NOW())${spendCreatedByFilter}`,
          [companyId]
        );
        value = parseFloat(spendResult.rows[0]?.total ?? 0);
        hasData = true;
        break;
      }
    }

    results.push({
      cardId: def.cardId,
      label: def.label,
      type: def.type,
      icon: def.icon,
      value,
      hasData,
    });
  }

  return results;
}

// GET /api/companies/dashboard-cards — 고객사별 대시보드 카드 데이터
router.get('/dashboard-cards', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    // company_settings에서 카드 설정 조회
    const settingsResult = await query(
      `SELECT setting_key, setting_value
       FROM company_settings
       WHERE company_id = $1 AND setting_key IN ('dashboard_cards', 'dashboard_card_count')`,
      [companyId]
    );

    const settings: Record<string, string> = {};
    for (const row of settingsResult.rows as any[]) {
      settings[row.setting_key] = row.setting_value;
    }

    const cardCount = parseInt(settings.dashboard_card_count || '0');
    let cardIds: string[] = [];

    try {
      cardIds = settings.dashboard_cards ? JSON.parse(settings.dashboard_cards) : [];
    } catch {
      cardIds = [];
    }

    // 카드 미설정 시
    if (cardIds.length === 0) {
      return res.json({
        configured: false,
        cardCount: 0,
        cards: [],
      });
    }

    // DB에 고객 데이터 존재 여부 확인 (전체 블러 처리용)
    const customerCheck = await query(
      'SELECT COUNT(*)::int as count FROM customers WHERE company_id = $1 LIMIT 1',
      [companyId]
    );
    const hasCustomers = parseInt(customerCheck.rows[0].count) > 0;

    if (!hasCustomers) {
      // DB 미업로드 → 프론트에서 전체 블러 + CTA 표시
      return res.json({
        configured: true,
        cardCount,
        hasCustomerData: false,
        cards: cardIds.map(id => {
          const def = getCardDef(id);
          return {
            cardId: id,
            label: def?.label ?? id,
            type: def?.type ?? 'count',
            icon: def?.icon ?? 'HelpCircle',
            value: 0,
            hasData: false,
          };
        }),
      });
    }

    // 집계 실행 — 사용자 격리 정보 전달
    const cards = await aggregateDashboardCards(companyId, cardIds, userId, userType);

    res.json({
      configured: true,
      cardCount,
      hasCustomerData: true,
      cards,
    });
  } catch (error) {
    console.error('대시보드 카드 조회 실패:', error);
    res.status(500).json({ error: '대시보드 카드 조회 실패' });
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
        name = COALESCE($1, name),
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
