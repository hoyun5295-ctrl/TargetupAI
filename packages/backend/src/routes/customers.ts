// customers.ts 전체 교체
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getGenderVariants } from '../utils/normalize';

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
    const basicFields = ['gender', 'grade', 'sms_opt_in', 'store_code', 'region'];
    const numericFields = ['points', 'total_purchase_amount', 'purchase_count', 'avg_order_value', 'ltv_score', 'visit_count', 'coupon_usage_count', 'return_count'];
    const dateFields = ['birth_date', 'recent_purchase_date', 'created_at'];

    if (basicFields.includes(field)) {
      if (operator === 'eq') {
        if (field === 'gender') {
          const gf = buildGenderFilter(String(value), paramIndex);
          whereClause += gf.sql;
          params.push(...gf.params);
          paramIndex = gf.nextIndex;
        } else if (field === 'grade') {
          const grf = buildGradeFilter(String(value), paramIndex);
          whereClause += grf.sql;
          params.push(...grf.params);
          paramIndex = grf.nextIndex;
        } else if (field === 'region') {
          const rf = buildRegionFilter(String(value), paramIndex);
          whereClause += rf.sql;
          params.push(...rf.params);
          paramIndex = rf.nextIndex;
        } else {
          whereClause += ` AND ${field} = $${paramIndex++}`;
          params.push(value);
        }
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
      } else if (operator === 'days_within') {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(value));
        whereClause += ` AND ${field} >= $${paramIndex++}`;
        params.push(daysAgo.toISOString().split('T')[0]);
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
      const gf = buildGenderFilter(String(gender), paramIndex);
      whereClause += gf.sql;
      params.push(...gf.params);
      paramIndex = gf.nextIndex;
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
  const grf = buildGradeFilter(String(grade), paramIndex);
  whereClause += grf.sql;
  params.push(...grf.params);
  paramIndex = grf.nextIndex;
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
      `SELECT id, name, phone, gender, birth_date, age, email, grade, region, points,
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
        COUNT(*) FILTER (WHERE gender = ANY($${params.length + 1}::text[])) as male_count,
        COUNT(*) FILTER (WHERE gender = ANY($${params.length + 2}::text[])) as female_count,
        COUNT(*) FILTER (WHERE grade = 'VIP') as vip_count,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) < 20) as age_under20,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) BETWEEN 20 AND 29) as age_20s,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) BETWEEN 30 AND 39) as age_30s,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) BETWEEN 40 AND 49) as age_40s,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) BETWEEN 50 AND 59) as age_50s,
        COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND (2026 - birth_year) >= 60) as age_60plus
       FROM customers_unified
       WHERE company_id = $1 AND is_active = true${storeFilter}`,
      [...params, getGenderVariants('M'), getGenderVariants('F')]
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

// ====== 직접 타겟 설정 API ======

// GET /api/customers/schema - 회사의 customer_schema 조회
router.get('/schema', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const result = await query(
      'SELECT customer_schema FROM companies WHERE id = $1',
      [companyId]
    );

    const schema = result.rows[0]?.customer_schema || {};
    
    // 스키마에서 필드 목록 추출
    const fields = Object.keys(schema).map(key => ({
      name: key,
      label: schema[key]?.label || key,
      type: schema[key]?.type || 'text'
    }));

    // 기본 필드 추가 (customers_unified 테이블 기본 컬럼)
    const defaultFields = [
      { name: 'phone', label: '전화번호', type: 'text' },
      { name: 'name', label: '이름', type: 'text' },
      { name: 'gender', label: '성별', type: 'select' },
      { name: 'birth_date', label: '생년월일', type: 'date' },
      { name: 'grade', label: '등급', type: 'select' },
      { name: 'region', label: '지역', type: 'text' },
      { name: 'total_purchase_amount', label: '총구매금액', type: 'number' },
      { name: 'recent_purchase_date', label: '최근구매일', type: 'date' },
      { name: 'sms_opt_in', label: '수신동의', type: 'boolean' }
    ];

    res.json({ 
      fields: [...defaultFields, ...fields],
      phoneFields: ['phone', 'mobile', 'phone_number', 'tel', 'cell_phone'].filter(f => 
        defaultFields.some(df => df.name === f) || fields.some(cf => cf.name === f)
      )
    });
  } catch (error) {
    console.error('스키마 조회 에러:', error);
    res.status(500).json({ error: '스키마 조회 실패' });
  }
});

// POST /api/customers/filter-count - 필터 조건으로 대상 인원 카운트
router.post('/filter-count', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { gender, ageRange, grade, region, minPurchase, recentDays, smsOptIn, dynamicFilters } = req.body;

    let whereClause = 'WHERE company_id = $1 AND is_active = true';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    if (userType === 'company_user' && userId) {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        whereClause += ` AND store_code = ANY($${paramIndex++}::text[])`;
        params.push(storeCodes);
      }
    }

    // 수신동의 필터
    if (dynamicFilters && typeof dynamicFilters === 'object' && Object.keys(dynamicFilters).length > 0) {
      // === 동적 필터 (새 UI) ===
      if (smsOptIn) whereClause += ' AND sms_opt_in = true';
      const df = buildDynamicFilter(dynamicFilters, paramIndex);
      whereClause += df.where;
      params.push(...df.params);
      paramIndex = df.nextIndex;
    } else {
      // === 레거시 필터 (기존 UI - 하위호환) ===
      if (smsOptIn) {
        whereClause += ' AND sms_opt_in = true';
      }
      if (gender) {
        const gf = buildGenderFilter(String(gender), paramIndex);
        whereClause += gf.sql;
        params.push(...gf.params);
        paramIndex = gf.nextIndex;
      }
      if (ageRange) {
        const ageVal = parseInt(ageRange);
        if (ageVal === 60) {
          whereClause += ` AND age >= 60`;
        } else {
          whereClause += ` AND age >= $${paramIndex++} AND age < $${paramIndex++}`;
          params.push(ageVal, ageVal + 10);
        }
      }
      if (grade) {
        const grf = buildGradeFilter(String(grade), paramIndex);
        whereClause += grf.sql;
        params.push(...grf.params);
        paramIndex = grf.nextIndex;
      }
      if (region) {
        const regionResult = buildRegionFilter(String(region), paramIndex);
        whereClause += regionResult.sql;
        params.push(...regionResult.params);
        paramIndex = regionResult.nextIndex;
      }
      if (minPurchase) {
        whereClause += ` AND total_purchase_amount >= $${paramIndex++}`;
        params.push(parseInt(minPurchase));
      }
      if (recentDays) {
        whereClause += ` AND recent_purchase_date >= NOW() - INTERVAL '${parseInt(recentDays)} days'`;
      }
    }

    const result = await query(
      `SELECT COUNT(*) FROM customers_unified ${whereClause}`,
      params
    );

    const count = parseInt(result.rows[0].count);
    res.json({ count });
  } catch (error) {
    console.error('필터 카운트 에러:', error);
    res.status(500).json({ error: '카운트 조회 실패' });
  }
});

// POST /api/customers/extract - 타겟 추출 (데이터 반환)
router.post('/extract', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { gender, ageRange, grade, region, minPurchase, recentDays, smsOptIn, phoneField, limit = 10000, dynamicFilters } = req.body;

    let whereClause = 'WHERE company_id = $1 AND is_active = true';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    if (userType === 'company_user' && userId) {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        whereClause += ` AND store_code = ANY($${paramIndex++}::text[])`;
        params.push(storeCodes);
      }
    }

    if (dynamicFilters && typeof dynamicFilters === 'object' && Object.keys(dynamicFilters).length > 0) {
      if (smsOptIn) whereClause += ' AND sms_opt_in = true';
      const df = buildDynamicFilter(dynamicFilters, paramIndex);
      whereClause += df.where;
      params.push(...df.params);
      paramIndex = df.nextIndex;
    } else {
      if (smsOptIn) {
        whereClause += ' AND sms_opt_in = true';
      }
      if (gender) {
        const gf = buildGenderFilter(String(gender), paramIndex);
        whereClause += gf.sql;
        params.push(...gf.params);
        paramIndex = gf.nextIndex;
      }
      if (ageRange) {
        const ageVal = parseInt(ageRange);
        if (ageVal === 60) {
          whereClause += ` AND age >= 60`;
        } else {
          whereClause += ` AND age >= $${paramIndex++} AND age < $${paramIndex++}`;
          params.push(ageVal, ageVal + 10);
        }
      }
      if (grade) {
        const grf = buildGradeFilter(String(grade), paramIndex);
        whereClause += grf.sql;
        params.push(...grf.params);
        paramIndex = grf.nextIndex;
      }
      if (region) {
        const regionResult = buildRegionFilter(String(region), paramIndex);
        whereClause += regionResult.sql;
        params.push(...regionResult.params);
        paramIndex = regionResult.nextIndex;
      }
      if (minPurchase) {
        whereClause += ` AND total_purchase_amount >= $${paramIndex++}`;
        params.push(parseInt(minPurchase));
      }
      if (recentDays) {
        whereClause += ` AND recent_purchase_date >= NOW() - INTERVAL '${parseInt(recentDays)} days'`;
      }
    }

    // 데이터 추출 (전화번호 필드 동적 선택)
    const phoneColumn = phoneField || 'phone';
    
    params.push(parseInt(limit as string));
    const result = await query(
      `SELECT 
        ${phoneColumn} as phone,
        name,
        gender,
        grade,
        region,
        total_purchase_amount,
        recent_purchase_date,
        custom_fields,
        callback
      FROM customers_unified 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}`,
      params
    );

    res.json({ 
      success: true,
      count: result.rows.length,
      recipients: result.rows 
    });
  } catch (error) {
    console.error('타겟 추출 에러:', error);
    res.status(500).json({ error: '타겟 추출 실패' });
  }
});

// GET /api/customers/filter-options - 필터 드롭다운용 고유값 조회
router.get('/filter-options', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다' });

    const gradesResult = await query(
      `SELECT DISTINCT grade FROM customers_unified WHERE company_id = $1 AND is_active = true AND grade IS NOT NULL AND grade != '' ORDER BY grade`,
      [companyId]
    );
    const regionsResult = await query(
      `SELECT DISTINCT region FROM customers_unified WHERE company_id = $1 AND is_active = true AND region IS NOT NULL AND region != '' ORDER BY region`,
      [companyId]
    );

    res.json({
      grades: gradesResult.rows.map((r: any) => r.grade),
      regions: regionsResult.rows.map((r: any) => r.region),
    });
  } catch (error) {
    console.error('필터 옵션 조회 에러:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// GET /api/customers/enabled-fields - 회사별 활성 필터 필드 + 드롭다운 옵션
router.get('/enabled-fields', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다' });

    const companyResult = await query('SELECT enabled_fields FROM companies WHERE id = $1', [companyId]);
    
    const DEFAULT_FIELDS = ['gender', 'age_group', 'grade', 'region', 'total_purchase_amount', 'last_purchase_date'];
    const enabledKeys = companyResult.rows[0]?.enabled_fields?.length > 0 
      ? companyResult.rows[0].enabled_fields 
      : DEFAULT_FIELDS;

    if (enabledKeys.length === 0) {
      return res.json({ fields: [], options: {} });
    }

    const fieldsResult = await query(
      `SELECT field_key, display_name, category, data_type, description, sort_order 
       FROM standard_fields 
       WHERE is_active = true AND field_key = ANY($1) 
       ORDER BY sort_order`,
      [enabledKeys]
    );

    const OPTION_COLUMNS: Record<string, string> = {
      'gender': 'gender', 'grade': 'grade', 'region': 'region', 'store_code': 'store_code',
    };

    const options: Record<string, string[]> = {};
    for (const field of fieldsResult.rows) {
      if (field.data_type === 'string' && OPTION_COLUMNS[field.field_key]) {
        const col = OPTION_COLUMNS[field.field_key];
        try {
          const optResult = await query(
            `SELECT DISTINCT ${col} FROM customers_unified WHERE company_id = $1 AND is_active = true AND ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col} LIMIT 100`,
            [companyId]
          );
          if (optResult.rows.length > 0) {
            options[field.field_key] = optResult.rows.map((r: any) => r[col]);
          }
        } catch (e) { /* 컬럼 없으면 무시 */ }
      }
    }

    res.json({ fields: fieldsResult.rows, options });
  } catch (error) {
    console.error('활성 필드 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// ====== 고객 삭제 API ======

// DELETE /api/customers/:id - 개별 삭제 (고객사관리자, 슈퍼관리자만)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    const { id } = req.params;

    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다' });
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ error: '고객사 관리자 이상 권한이 필요합니다' });
    }

    // 삭제 대상 확인
    const target = await query(
      'SELECT id, name, phone FROM customers WHERE id = $1 AND company_id = $2 AND is_active = true',
      [id, companyId]
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ error: '고객을 찾을 수 없습니다' });
    }

    const customer = target.rows[0];

    // 연관 데이터 삭제 (purchases, consents)
    await query('DELETE FROM purchases WHERE customer_id = $1 AND company_id = $2', [id, companyId]);
    await query('DELETE FROM consents WHERE customer_id = $1', [id]);

    // 고객 삭제 (하드 삭제)
    await query('DELETE FROM customers WHERE id = $1 AND company_id = $2', [id, companyId]);

    // 감사 로그
    await query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        'customer_delete',
        'customer',
        id,
        JSON.stringify({ name: customer.name, phone: customer.phone, delete_type: 'individual' }),
        req.ip,
        req.headers['user-agent'] || ''
      ]
    );

    res.json({ success: true, message: '고객이 삭제되었습니다', deletedCount: 1 });
  } catch (error) {
    console.error('고객 개별 삭제 에러:', error);
    res.status(500).json({ error: '삭제 실패' });
  }
});

// POST /api/customers/bulk-delete - 선택 삭제 (고객사관리자, 슈퍼관리자만)
router.post('/bulk-delete', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다' });
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ error: '고객사 관리자 이상 권한이 필요합니다' });
    }

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '삭제할 고객 ID를 선택해주세요' });
    }
    if (ids.length > 1000) {
      return res.status(400).json({ error: '한 번에 최대 1,000건까지 삭제할 수 있습니다' });
    }

    // 실제 존재하는 고객만 필터
    const existing = await query(
      'SELECT id, name, phone FROM customers WHERE id = ANY($1) AND company_id = $2 AND is_active = true',
      [ids, companyId]
    );
    const validIds = existing.rows.map((r: any) => r.id);
    if (validIds.length === 0) {
      return res.status(404).json({ error: '삭제할 고객이 없습니다' });
    }

    // 연관 데이터 삭제
    await query('DELETE FROM purchases WHERE customer_id = ANY($1) AND company_id = $2', [validIds, companyId]);
    await query('DELETE FROM consents WHERE customer_id = ANY($1)', [validIds]);

    // 고객 삭제
    const deleteResult = await query(
      'DELETE FROM customers WHERE id = ANY($1) AND company_id = $2',
      [validIds, companyId]
    );

    // 감사 로그
    await query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        'customer_bulk_delete',
        'customer',
        null,
        JSON.stringify({
          delete_type: 'bulk',
          requested_count: ids.length,
          deleted_count: deleteResult.rowCount,
          sample_phones: existing.rows.slice(0, 5).map((r: any) => r.phone)
        }),
        req.ip,
        req.headers['user-agent'] || ''
      ]
    );

    res.json({
      success: true,
      message: `${deleteResult.rowCount}명의 고객이 삭제되었습니다`,
      deletedCount: deleteResult.rowCount
    });
  } catch (error) {
    console.error('고객 선택 삭제 에러:', error);
    res.status(500).json({ error: '삭제 실패' });
  }
});

// POST /api/customers/delete-all - 전체 삭제 (슈퍼관리자만)
router.post('/delete-all', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (userType !== 'super_admin') {
      return res.status(403).json({ error: '슈퍼관리자만 전체 삭제가 가능합니다' });
    }

    const { targetCompanyId, confirmCompanyName } = req.body;
    const deleteCompanyId = targetCompanyId || companyId;

    if (!deleteCompanyId) return res.status(400).json({ error: '회사 ID가 필요합니다' });
    if (!confirmCompanyName) return res.status(400).json({ error: '회사명 확인이 필요합니다' });

    // 회사명 확인
    const companyResult = await query('SELECT company_name FROM companies WHERE id = $1', [deleteCompanyId]);
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다' });
    }
    if (companyResult.rows[0].company_name !== confirmCompanyName) {
      return res.status(400).json({ error: '회사명이 일치하지 않습니다' });
    }

    // 삭제 전 건수 확인
    const countResult = await query(
      'SELECT COUNT(*) FROM customers WHERE company_id = $1 AND is_active = true',
      [deleteCompanyId]
    );
    const totalCount = parseInt(countResult.rows[0].count);

    if (totalCount === 0) {
      return res.status(400).json({ error: '삭제할 고객 데이터가 없습니다' });
    }

    // 연관 데이터 삭제 (해당 회사 전체)
    const purchaseResult = await query('DELETE FROM purchases WHERE company_id = $1', [deleteCompanyId]);
    await query('DELETE FROM consents WHERE customer_id IN (SELECT id FROM customers WHERE company_id = $1)', [deleteCompanyId]);

    // 고객 전체 삭제
    const deleteResult = await query('DELETE FROM customers WHERE company_id = $1', [deleteCompanyId]);

    // 감사 로그
    await query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        'customer_delete_all',
        'company',
        deleteCompanyId,
        JSON.stringify({
          delete_type: 'all',
          company_name: confirmCompanyName,
          deleted_customers: deleteResult.rowCount,
          deleted_purchases: purchaseResult.rowCount
        }),
        req.ip,
        req.headers['user-agent'] || ''
      ]
    );

    res.json({
      success: true,
      message: `${deleteResult.rowCount}명의 고객 데이터가 전체 삭제되었습니다`,
      deletedCount: deleteResult.rowCount,
      deletedPurchases: purchaseResult.rowCount
    });
  } catch (error) {
    console.error('고객 전체 삭제 에러:', error);
    res.status(500).json({ error: '삭제 실패' });
  }
});

// GET /api/customers/:id - 고객 상세 (⚠️ 반드시 맨 아래! 위의 라우트보다 뒤에 있어야 함)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM customers_unified WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '고객을 찾을 수 없습니다.' });
    }

    res.json({ customer: result.rows[0] });
  } catch (error) {
    console.error('고객 상세 조회 에러:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

export default router;