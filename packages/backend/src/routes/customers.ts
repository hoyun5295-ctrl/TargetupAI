// customers.ts 전체 교체
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

// 동적 필터 쿼리 빌더
function buildDynamicFilter(filters: any, startIndex: number) {
  let whereClause = '';
  const params: any[] = [];
  let paramIndex = startIndex;

  if (!filters || typeof filters !== 'object') {
    return { where: '', params: [], nextIndex: paramIndex };
  }

  for (const [field, condition] of Object.entries(filters)) {
    if (!condition || typeof condition !== 'object') continue;
    
    const { operator, value } = condition as { operator: string; value: any };
    if (value === undefined || value === null || value === '') continue;

    // 기본 필드 처리
    const basicFields = ['gender', 'grade', 'sms_opt_in', 'store_code'];
    const numericFields = ['points', 'total_purchase_amount'];
    const dateFields = ['birth_date', 'recent_purchase_date', 'created_at'];

    if (basicFields.includes(field)) {
      if (operator === 'eq') {
        whereClause += ` AND ${field} = $${paramIndex++}`;
        params.push(value);
      } else if (operator === 'in' && Array.isArray(value)) {
        const placeholders = value.map(() => `$${paramIndex++}`).join(', ');
        whereClause += ` AND ${field} IN (${placeholders})`;
        params.push(...value);
      }
    } else if (numericFields.includes(field)) {
      if (operator === 'eq') {
        whereClause += ` AND ${field} = $${paramIndex++}`;
        params.push(Number(value));
      } else if (operator === 'gte') {
        whereClause += ` AND ${field} >= $${paramIndex++}`;
        params.push(Number(value));
      } else if (operator === 'lte') {
        whereClause += ` AND ${field} <= $${paramIndex++}`;
        params.push(Number(value));
      } else if (operator === 'between' && Array.isArray(value)) {
        whereClause += ` AND ${field} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(Number(value[0]), Number(value[1]));
      }
    } else if (dateFields.includes(field)) {
      if (operator === 'gte') {
        whereClause += ` AND ${field} >= $${paramIndex++}`;
        params.push(value);
      } else if (operator === 'lte') {
        whereClause += ` AND ${field} <= $${paramIndex++}`;
        params.push(value);
      } else if (operator === 'between' && Array.isArray(value)) {
        whereClause += ` AND ${field} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(value[0], value[1]);
      }
    } else if (field === 'age') {
      // 나이는 birth_date로 계산
      if (operator === 'gte') {
        whereClause += ` AND EXTRACT(YEAR FROM AGE(birth_date)) >= $${paramIndex++}`;
        params.push(Number(value));
      } else if (operator === 'lte') {
        whereClause += ` AND EXTRACT(YEAR FROM AGE(birth_date)) <= $${paramIndex++}`;
        params.push(Number(value));
      } else if (operator === 'between' && Array.isArray(value)) {
        whereClause += ` AND EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(Number(value[0]), Number(value[1]));
      }
    } else {
      // custom_fields (JSONB) 처리
      if (operator === 'eq') {
        whereClause += ` AND custom_fields->>'${field}' = $${paramIndex++}`;
        params.push(String(value));
      } else if (operator === 'gte') {
        whereClause += ` AND (custom_fields->>'${field}')::numeric >= $${paramIndex++}`;
        params.push(Number(value));
      } else if (operator === 'lte') {
        whereClause += ` AND (custom_fields->>'${field}')::numeric <= $${paramIndex++}`;
        params.push(Number(value));
      } else if (operator === 'between' && Array.isArray(value)) {
        whereClause += ` AND (custom_fields->>'${field}')::numeric BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(Number(value[0]), Number(value[1]));
      } else if (operator === 'in' && Array.isArray(value)) {
        const placeholders = value.map(() => `$${paramIndex++}`).join(', ');
        whereClause += ` AND custom_fields->>'${field}' IN (${placeholders})`;
        params.push(...value.map(String));
      } else if (operator === 'contains') {
        whereClause += ` AND custom_fields->>'${field}' ILIKE $${paramIndex++}`;
        params.push(`%${value}%`);
      } else if (operator === 'date_gte') {
        whereClause += ` AND (custom_fields->>'${field}')::date >= $${paramIndex++}`;
        params.push(value);
      } else if (operator === 'date_lte') {
        whereClause += ` AND (custom_fields->>'${field}')::date <= $${paramIndex++}`;
        params.push(value);
      }
    }
  }

  return { where: whereClause, params, nextIndex: paramIndex };
}

// GET /api/customers - 고객 목록 (동적 필터)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { filters, search, page = 1, limit = 50, gender, minAge, maxAge, grade, smsOptIn } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE company_id = $1 AND is_active = true';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // 일반 사용자는 본인 store_codes에 해당하는 고객만 조회
    if (userType === 'company_user' && userId) {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        whereClause += ` AND store_code = ANY($${paramIndex++})`;
        params.push(storeCodes);
      }
    }

    // 동적 필터 적용
    if (filters) {
      const parsedFilters = typeof filters === 'string' ? JSON.parse(filters) : filters;
      const filterResult = buildDynamicFilter(parsedFilters, paramIndex);
      whereClause += filterResult.where;
      params.push(...filterResult.params);
      paramIndex = filterResult.nextIndex;
    }
    // 개별 파라미터 필터 (기존 방식 호환)
if (gender) {
  whereClause += ` AND gender = $${paramIndex++}`;
  params.push(gender);
}
if (minAge) {
  whereClause += ` AND EXTRACT(YEAR FROM AGE(birth_date)) >= $${paramIndex++}`;
  params.push(Number(minAge));
}
if (maxAge) {
  whereClause += ` AND EXTRACT(YEAR FROM AGE(birth_date)) <= $${paramIndex++}`;
  params.push(Number(maxAge));
}
if (grade) {
  whereClause += ` AND grade = $${paramIndex++}`;
  params.push(grade);
}
if (smsOptIn === 'true') {
  whereClause += ` AND sms_opt_in = true`;
}

    // 검색어
    if (search) {
      whereClause += ` AND (name ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // 총 개수
    const countResult = await query(
      `SELECT COUNT(*) FROM customers_unified ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // 목록 조회
    params.push(Number(limit), offset);
    const result = await query(
      `SELECT id, name, phone, gender, birth_date, email, grade, points,
              sms_opt_in, recent_purchase_date, total_purchase_amount, custom_fields
       FROM customers_unified
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return res.json({
      customers: result.rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('고객 목록 조회 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/customers/filter - 필터 미리보기 (타겟 수 계산)
router.post('/filter', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { filters } = req.body;

    let whereClause = 'WHERE company_id = $1 AND is_active = true AND sms_opt_in = true';
    const params: any[] = [companyId];

    if (filters) {
      const filterResult = buildDynamicFilter(filters, 2);
      whereClause += filterResult.where;
      params.push(...filterResult.params);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM customers_unified ${whereClause}`,
      params
    );

    return res.json({
      targetCount: parseInt(countResult.rows[0].count),
      filters,
    });
  } catch (error) {
    console.error('필터 미리보기 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/customers/fields - 사용 가능한 필터 필드 목록
router.get('/fields', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    // custom_fields에서 사용된 키 추출
    const result = await query(
      `SELECT DISTINCT jsonb_object_keys(custom_fields) as field_name
       FROM customers
       WHERE company_id = $1 AND custom_fields IS NOT NULL AND custom_fields != '{}'
       LIMIT 100`,
      [companyId]
    );

    const customFields = result.rows.map(r => r.field_name);

    return res.json({
      basicFields: [
        { name: 'gender', label: '성별', type: 'select', options: ['M', 'F'] },
        { name: 'age', label: '나이', type: 'number' },
        { name: 'grade', label: '등급', type: 'text' },
        { name: 'points', label: '포인트', type: 'number' },
        { name: 'sms_opt_in', label: 'SMS수신동의', type: 'boolean' },
        { name: 'total_purchase_amount', label: '총구매금액', type: 'number' },
        { name: 'recent_purchase_date', label: '최근구매일', type: 'date' },
      ],
      customFields: customFields.map(f => ({ name: f, label: f, type: 'custom' })),
    });
  } catch (error) {
    console.error('필드 목록 조회 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/customers - 고객 추가 (단건)
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const {
      phone, name, gender, birthDate, email, address,
      grade, points, storeCode, storeName, smsOptIn, customFields
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: '전화번호는 필수입니다' });
    }

    // 요금제 제한 체크
    const limitCheck = await query(`
      SELECT 
        c.id,
        p.max_customers,
        p.plan_name,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id AND is_active = true) as current_count
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [companyId]);

    if (limitCheck.rows.length > 0) {
      const { max_customers, current_count, plan_name } = limitCheck.rows[0];
      if (max_customers && current_count >= max_customers) {
        return res.status(403).json({ 
          error: '요금제 고객 수 제한을 초과했습니다.',
          code: 'PLAN_LIMIT_EXCEEDED',
          planName: plan_name,
          maxCustomers: max_customers,
          currentCount: current_count
        });
      }
    }

    const result = await query(
      `INSERT INTO customers (
        company_id, phone, name, gender, birth_date, email, address,
        grade, points, store_code, store_name, sms_opt_in, custom_fields
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (company_id, phone) DO UPDATE SET
        name = EXCLUDED.name,
        gender = EXCLUDED.gender,
        birth_date = EXCLUDED.birth_date,
        email = EXCLUDED.email,
        address = EXCLUDED.address,
        grade = EXCLUDED.grade,
        points = EXCLUDED.points,
        store_code = EXCLUDED.store_code,
        store_name = EXCLUDED.store_name,
        sms_opt_in = EXCLUDED.sms_opt_in,
        custom_fields = COALESCE(customers.custom_fields, '{}') || EXCLUDED.custom_fields,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        companyId, phone, name, gender, birthDate, email, address,
        grade, points, storeCode, storeName, smsOptIn ?? true, customFields || {}
      ]
    );

    return res.status(201).json({
      message: '고객이 추가되었습니다',
      customer: result.rows[0],
    });
  } catch (error) {
    console.error('고객 추가 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/customers/bulk - 고객 일괄 추가
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { customers } = req.body;

    if (!Array.isArray(customers) || customers.length === 0) {
      return res.status(400).json({ error: '고객 데이터가 필요합니다' });
    }

    // 요금제 제한 체크
    const limitCheck = await query(`
      SELECT 
        c.id,
        p.max_customers,
        p.plan_name,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id AND is_active = true) as current_count
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [companyId]);

    if (limitCheck.rows.length > 0) {
      const { max_customers, current_count, plan_name } = limitCheck.rows[0];
      const newTotal = Number(current_count) + customers.length;
      if (max_customers && newTotal > max_customers) {
        const available = max_customers - current_count;
        return res.status(403).json({ 
          error: '요금제 고객 수 제한을 초과합니다.',
          code: 'PLAN_LIMIT_EXCEEDED',
          planName: plan_name,
          maxCustomers: max_customers,
          currentCount: current_count,
          requestedCount: customers.length,
          availableCount: available > 0 ? available : 0
        });
      }
    }

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const customer of customers) {
      try {
        if (!customer.phone) {
          failCount++;
          errors.push(`전화번호 없음: ${JSON.stringify(customer)}`);
          continue;
        }

        await query(
          `INSERT INTO customers (
            company_id, phone, name, gender, birth_date, email,
            grade, points, sms_opt_in, custom_fields
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (company_id, phone) DO UPDATE SET
            name = EXCLUDED.name,
            gender = EXCLUDED.gender,
            birth_date = EXCLUDED.birth_date,
            email = EXCLUDED.email,
            grade = EXCLUDED.grade,
            points = EXCLUDED.points,
            sms_opt_in = EXCLUDED.sms_opt_in,
            custom_fields = COALESCE(customers.custom_fields, '{}') || EXCLUDED.custom_fields,
            updated_at = CURRENT_TIMESTAMP`,
          [
            companyId, customer.phone, customer.name, customer.gender,
            customer.birthDate, customer.email, customer.grade,
            customer.points, customer.smsOptIn ?? true, customer.customFields || {}
          ]
        );
        successCount++;
      } catch (err) {
        failCount++;
        errors.push(`오류: ${customer.phone}`);
      }
    }

    // 엑셀 업로드 완료 후 스키마 자동 갱신
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

    return res.json({
      message: `${successCount}건 성공, ${failCount}건 실패`,
      successCount,
      failCount,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error('고객 일괄 추가 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/customers/stats - 고객 통계
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    let storeFilter = '';
    const params: any[] = [companyId];
    
    if (userType === 'company_user' && userId) {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        storeFilter = ' AND store_code = ANY($2)';
        params.push(storeCodes);
      }
    }

    const result = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sms_opt_in = true) as sms_opt_in_count,
        COUNT(*) FILTER (WHERE gender = '남성') as male_count,
        COUNT(*) FILTER (WHERE gender = '여성') as female_count,
        COUNT(*) FILTER (WHERE grade = 'VIP') as vip_count,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) < 20) as age_under20,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) BETWEEN 20 AND 29) as age_20s,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) BETWEEN 30 AND 39) as age_30s,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) BETWEEN 40 AND 49) as age_40s,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) BETWEEN 50 AND 59) as age_50s,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) >= 60) as age_60plus
       FROM customers_unified
       WHERE company_id = $1 AND is_active = true${storeFilter}`,
      params
    );

    // 회사 요금 정보 조회
    const companyResult = await query(
      `SELECT monthly_budget, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, use_db_sync, use_file_upload
       FROM companies WHERE id = $1`,
      [companyId]
    );
    const company = companyResult.rows[0] || {};

    // 이번 달 채널별 발송 통계
    const campaignStats = await query(
      `SELECT
        c.message_type,
        COALESCE(SUM(cr.sent_count), 0) as sent,
        COALESCE(SUM(cr.success_count), 0) as success
       FROM campaign_runs cr
       JOIN campaigns c ON cr.campaign_id = c.id
       WHERE c.company_id = $1
         AND cr.created_at >= date_trunc('month', CURRENT_DATE)
       GROUP BY c.message_type`,
      [companyId]
    );

    // 채널별 집계
    let smsSent = 0, lmsSent = 0, mmsSent = 0, kakaoSent = 0;
    let totalSent = 0, totalSuccess = 0;

    campaignStats.rows.forEach((row: any) => {
      const sent = parseInt(row.sent || '0');
      const success = parseInt(row.success || '0');
      totalSent += sent;
      totalSuccess += success;

      switch (row.message_type) {
        case 'SMS': smsSent = sent; break;
        case 'LMS': lmsSent = sent; break;
        case 'MMS': mmsSent = sent; break;
        case 'KAKAO': kakaoSent = sent; break;
      }
    });

    // 월 사용금액 계산
    const monthlyCost = 
      smsSent * parseFloat(company.cost_per_sms || '9.9') +
      lmsSent * parseFloat(company.cost_per_lms || '27') +
      mmsSent * parseFloat(company.cost_per_mms || '50') +
      kakaoSent * parseFloat(company.cost_per_kakao || '7.5');

    const successRate = totalSent > 0 ? ((totalSuccess / totalSent) * 100).toFixed(1) : '0';

    return res.json({ 
      stats: {
        ...result.rows[0],
        monthly_sent: totalSent,
        success_rate: successRate,
        monthly_budget: parseFloat(company.monthly_budget || '0'),
        monthly_cost: Math.round(monthlyCost),
        sms_sent: smsSent,
        lms_sent: lmsSent,
        mms_sent: mmsSent,
        kakao_sent: kakaoSent,
        cost_per_sms: parseFloat(company.cost_per_sms || '9.9'),
        cost_per_lms: parseFloat(company.cost_per_lms || '27'),
        cost_per_mms: parseFloat(company.cost_per_mms || '50'),
        cost_per_kakao: parseFloat(company.cost_per_kakao || '7.5'),
        use_db_sync: company.use_db_sync ?? true,
        use_file_upload: company.use_file_upload ?? true
      }
    });
  } catch (error) {
    console.error('고객 통계 조회 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;