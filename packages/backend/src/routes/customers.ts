import { Request, Response, Router } from 'express';
import Redis from 'ioredis';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getGenderVariants } from '../utils/normalize';
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

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
    const basicFields = ['gender', 'grade', 'sms_opt_in', 'region'];
    const storeField = 'store_code';
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
    } else if (field === storeField) {
      if (operator === 'eq') {
        whereClause += ` AND id IN (SELECT customer_id FROM customer_stores WHERE store_code = $${paramIndex++})`;
        params.push(value);
      } else if (operator === 'in' && Array.isArray(value)) {
        whereClause += ` AND id IN (SELECT customer_id FROM customer_stores WHERE store_code = ANY($${paramIndex++}::text[]))`;
        params.push(value);
      }
    } else if (field === 'store_name') {
      if (operator === 'eq') {
        whereClause += ` AND store_name = $${paramIndex++}`;
        params.push(value);
      } else if (operator === 'in' && Array.isArray(value)) {
        whereClause += ` AND store_name = ANY($${paramIndex++}::text[])`;
        params.push(value);
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
    let companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    // 슈퍼관리자는 companyId 쿼리 파라미터로 다른 회사 조회 가능
    if (userType === 'super_admin' && req.query.companyId) {
      companyId = req.query.companyId as string;
    }

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { filters, search, page = 1, limit = 50, gender, minAge, maxAge, grade, smsOptIn } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE company_id = $1 AND is_active = true';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // 일반 사용자(브랜드 담당자)는 본인이 업로드한 고객만 조회
    if (userType === 'company_user' && userId) {
      whereClause += ` AND uploaded_by = $${paramIndex++}`;
      params.push(userId);
    }

    // ★ 고객사관리자: 사용자(ID)별 필터 → 해당 사용자가 업로드한 고객만
    const filterUserId = req.query.filterUserId as string;
    if (filterUserId && (userType === 'company_admin' || userType === 'super_admin')) {
      whereClause += ` AND uploaded_by = $${paramIndex++}`;
      params.push(filterUserId);
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
  whereClause += ` AND sms_opt_in = true AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = customers_unified.company_id AND u.phone = customers_unified.phone)`;
} else if (smsOptIn === 'false') {
  whereClause += ` AND (sms_opt_in = false OR EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = customers_unified.company_id AND u.phone = customers_unified.phone))`;
}

    // 검색어
    if (search) {
      const searchStr = String(search);
      // 전화번호 검색: 하이픈 제거 후 매칭
      const cleanSearch = searchStr.replace(/-/g, '');
      if (/^\d+$/.test(cleanSearch)) {
        if (cleanSearch.length === 4) {
          // 4자리: 가운데 4자리 또는 뒷 4자리 매칭
          whereClause += ` AND (REPLACE(phone, '-', '') LIKE $${paramIndex} OR REPLACE(phone, '-', '') LIKE $${paramIndex + 1})`;
          params.push(`___${cleanSearch}____`, `_______${cleanSearch}`);
          paramIndex++;
        } else {
          whereClause += ` AND REPLACE(phone, '-', '') LIKE $${paramIndex}`;
          params.push(`%${cleanSearch}%`);
        }
      } else {
        whereClause += ` AND (name ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`;
        params.push(`%${searchStr}%`);
      }
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
              store_code, store_name,
              CASE WHEN EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = customers_unified.company_id AND u.phone = customers_unified.phone)
                   THEN false ELSE sms_opt_in END as sms_opt_in,
              recent_purchase_date, total_purchase_amount, custom_fields
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
      `SELECT COUNT(*) FROM customers_unified c ${whereClause}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)`,
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
      ON CONFLICT (company_id, COALESCE(store_code, '__NONE__'), phone) DO UPDATE SET
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

    // customer_stores N:N 매핑 (store_code가 있을 때)
    const customerId = result.rows[0]?.id;
    if (customerId && storeCode) {
      await query(
        `INSERT INTO customer_stores (company_id, customer_id, store_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (customer_id, store_code) DO NOTHING`,
        [companyId, customerId, storeCode]
      );
    }

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
          ON CONFLICT (company_id, COALESCE(store_code, '__NONE__'), phone) DO UPDATE SET
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
          'store_codes', (SELECT array_agg(DISTINCT store_code) FROM customer_stores WHERE company_id = $1)
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
    
    // ★ Redis 캐싱 (60초) — 30만건 이상 집계 쿼리 최적화
    const cacheKey = `stats:${companyId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    } catch (e) { /* Redis 실패 시 DB 직접 조회 */ }
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
        storeFilter = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
        params.push(storeCodes);
      }
    }

    const result = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE c.sms_opt_in = true
          AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)
        ) as sms_opt_in_count,
        COUNT(*) FILTER (WHERE c.gender = ANY($${params.length + 1}::text[])) as male_count,
        COUNT(*) FILTER (WHERE c.gender = ANY($${params.length + 2}::text[])) as female_count,
        COUNT(*) FILTER (WHERE c.grade = 'VIP') as vip_count,
        COUNT(*) FILTER (WHERE c.sms_opt_in = false OR EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)) as unsubscribe_count,
        COUNT(*) FILTER (WHERE c.birth_year IS NOT NULL AND (2026 - c.birth_year) < 20) as age_under20,
        COUNT(*) FILTER (WHERE c.birth_year IS NOT NULL AND (2026 - c.birth_year) BETWEEN 20 AND 29) as age_20s,
        COUNT(*) FILTER (WHERE c.birth_year IS NOT NULL AND (2026 - c.birth_year) BETWEEN 30 AND 39) as age_30s,
        COUNT(*) FILTER (WHERE c.birth_year IS NOT NULL AND (2026 - c.birth_year) BETWEEN 40 AND 49) as age_40s,
        COUNT(*) FILTER (WHERE c.birth_year IS NOT NULL AND (2026 - c.birth_year) BETWEEN 50 AND 59) as age_50s,
        COUNT(*) FILTER (WHERE c.birth_year IS NOT NULL AND (2026 - c.birth_year) >= 60) as age_60plus
       FROM customers_unified c
       WHERE c.company_id = $1 AND c.is_active = true${storeFilter}`,
      [...params, getGenderVariants('M'), getGenderVariants('F')]
    );

    // 회사 요금 정보 조회
    const companyResult = await query(
      `SELECT monthly_budget, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, use_db_sync, use_file_upload
       FROM companies WHERE id = $1`,
      [companyId]
    );
    const company = companyResult.rows[0] || {};

    // 이번 달 채널별 발송 통계 (취소/초안/예약 제외, 성공 건수 기준)
    // campaign_runs 기반 (AI추천발송)
    const campaignStats = await query(
      `SELECT
        c.message_type,
        COALESCE(SUM(cr.sent_count), 0) as sent,
        COALESCE(SUM(cr.success_count), 0) as success
       FROM campaign_runs cr
       JOIN campaigns c ON cr.campaign_id = c.id
       WHERE c.company_id = $1
         AND c.status NOT IN ('cancelled', 'draft', 'scheduled')
         AND cr.status NOT IN ('cancelled')
         AND cr.created_at >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))::date::timestamp AT TIME ZONE 'Asia/Seoul'
       GROUP BY c.message_type`,
      [companyId]
    );

    // 직접발송(send_type=direct)은 campaign_runs 없을 수 있으므로 campaigns 직접 조회
    const directStats = await query(
      `SELECT
        message_type,
        COALESCE(SUM(sent_count), 0) as sent,
        COALESCE(SUM(success_count), 0) as success
       FROM campaigns
       WHERE company_id = $1
         AND send_type = 'direct'
         AND status NOT IN ('cancelled', 'draft', 'scheduled')
         AND created_at >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))::date::timestamp AT TIME ZONE 'Asia/Seoul'
         AND id NOT IN (SELECT DISTINCT campaign_id FROM campaign_runs WHERE campaign_id IS NOT NULL)
       GROUP BY message_type`,
      [companyId]
    );

    // 채널별 집계 (성공 건수 기준으로 비용 계산)
    let smsSent = 0, lmsSent = 0, mmsSent = 0, kakaoSent = 0;
    let totalSent = 0, totalSuccess = 0;

    // campaign_runs 기반 통계
    campaignStats.rows.forEach((row: any) => {
      const sent = parseInt(row.sent || '0');
      const success = parseInt(row.success || '0');
      totalSent += sent;
      totalSuccess += success;

      switch (row.message_type) {
        case 'SMS': smsSent += success; break;
        case 'LMS': lmsSent += success; break;
        case 'MMS': mmsSent += success; break;
        case 'KAKAO': kakaoSent += success; break;
      }
    });

    // 직접발송 통계 합산
    directStats.rows.forEach((row: any) => {
      const sent = parseInt(row.sent || '0');
      const success = parseInt(row.success || '0');
      totalSent += sent;
      totalSuccess += success;

      switch (row.message_type) {
        case 'SMS': smsSent += success; break;
        case 'LMS': lmsSent += success; break;
        case 'MMS': mmsSent += success; break;
        case 'KAKAO': kakaoSent += success; break;
      }
    });

    // 월 사용금액 계산
    const monthlyCost = 
      smsSent * parseFloat(company.cost_per_sms || '9.9') +
      lmsSent * parseFloat(company.cost_per_lms || '27') +
      mmsSent * parseFloat(company.cost_per_mms || '50') +
      kakaoSent * parseFloat(company.cost_per_kakao || '7.5');

    const successRate = totalSent > 0 ? ((totalSuccess / totalSent) * 100).toFixed(1) : '0';

    const responseData = { 
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
    };
    // ★ Redis 캐시 저장 (60초)
    try { await redis.setex(cacheKey, 60, JSON.stringify(responseData)); } catch (e) { /* 캐시 실패 무시 */ }
    return res.json(responseData);
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
        whereClause += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${paramIndex++}::text[]))`;
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
        whereClause += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${paramIndex++}::text[]))`;
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
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다' });

    // company_user는 본인 업로드 데이터 기준 옵션만
    let scopeWhere = 'company_id = $1 AND is_active = true';
    const scopeParams: any[] = [companyId];
    if (userType === 'company_user' && userId) {
      scopeWhere += ' AND uploaded_by = $2';
      scopeParams.push(userId);
    }

    const gradesResult = await query(
      `SELECT DISTINCT grade FROM customers WHERE ${scopeWhere} AND grade IS NOT NULL AND grade != '' ORDER BY grade`,
      scopeParams
    );
    const regionsResult = await query(
      `SELECT DISTINCT region FROM customers WHERE ${scopeWhere} AND region IS NOT NULL AND region != '' ORDER BY region`,
      scopeParams
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

// GET /api/customers/enabled-fields - 회사별 전체 필드 + 커스텀 필드 + 샘플 데이터
router.get('/enabled-fields', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다' });

    // 데이터 범위: company_user는 본인 업로드만, 그 외는 회사 전체
    let scopeWhere = 'company_id = $1 AND is_active = true';
    const scopeParams: any[] = [companyId];
    if (userType === 'company_user' && userId) {
      scopeWhere += ' AND uploaded_by = $2';
      scopeParams.push(userId);
    }

    // 표준 customers 테이블 컬럼 Set (custom_fields가 아닌 것들)
    const STANDARD_COLUMNS = new Set([
      'name', 'phone', 'gender', 'birth_date', 'birth_year', 'birth_month_day', 'age',
      'email', 'address', 'region', 'grade', 'points', 'store_code', 'store_name',
      'registered_store', 'registered_store_number', 'registration_type', 'callback',
      'recent_purchase_date', 'recent_purchase_amount', 'recent_purchase_store',
      'total_purchase_amount', 'total_purchase', 'purchase_count', 'avg_order_value',
      'ltv_score', 'wedding_anniversary', 'is_married', 'sms_opt_in',
    ]);

    // 필드 카테고리 자동 분류
    const CATEGORY_MAP: Record<string, string> = {
      name: '기본정보', phone: '기본정보', gender: '기본정보', age: '기본정보',
      birth_date: '기본정보', birth_year: '기본정보', birth_month_day: '기본정보',
      email: '기본정보', address: '기본정보',
      grade: '등급/포인트', points: '등급/포인트', ltv_score: '등급/포인트',
      store_name: '매장정보', store_code: '매장정보', registered_store: '매장정보',
      registered_store_number: '매장정보', registration_type: '매장정보', callback: '매장정보',
      region: '지역정보', recent_purchase_store: '지역정보',
      total_purchase_amount: '구매정보', total_purchase: '구매정보', purchase_count: '구매정보',
      recent_purchase_date: '구매정보', recent_purchase_amount: '구매정보', avg_order_value: '구매정보',
      wedding_anniversary: '날짜정보', is_married: '날짜정보',
      sms_opt_in: '수신정보',
    };

    const fields: any[] = [];
    const existingKeys = new Set<string>();

    // 1. customer_field_definitions 조회 (회사별 필드 정의가 있으면 우선 사용)
    const fieldDefsResult = await query(
      `SELECT field_key, field_label, field_type, display_order
       FROM customer_field_definitions 
       WHERE company_id = $1 AND is_hidden = false
       ORDER BY display_order`,
      [companyId]
    );

    if (fieldDefsResult.rows.length > 0) {
      for (const f of fieldDefsResult.rows) {
        fields.push({
          field_key: f.field_key,
          display_name: f.field_label,
          field_label: f.field_label,
          data_type: f.field_type || 'string',
          category: CATEGORY_MAP[f.field_key] || '추가정보',
          sort_order: f.display_order,
          is_custom: !STANDARD_COLUMNS.has(f.field_key),
        });
        existingKeys.add(f.field_key);
      }
    } else {
      // field_definitions가 없으면 실제 데이터 기반 동적 감지 (데이터 있는 컬럼만 표시)
      const dataCheckResult = await query(`
        SELECT
          COUNT(*) FILTER (WHERE gender IS NOT NULL AND gender != '') as cnt_gender,
          COUNT(*) FILTER (WHERE birth_date IS NOT NULL) as cnt_birth_date,
          COUNT(*) FILTER (WHERE age IS NOT NULL AND age > 0) as cnt_age,
          COUNT(*) FILTER (WHERE email IS NOT NULL AND email != '') as cnt_email,
          COUNT(*) FILTER (WHERE address IS NOT NULL AND address != '') as cnt_address,
          COUNT(*) FILTER (WHERE region IS NOT NULL AND region != '') as cnt_region,
          COUNT(*) FILTER (WHERE grade IS NOT NULL AND grade != '') as cnt_grade,
          COUNT(*) FILTER (WHERE points IS NOT NULL AND points > 0) as cnt_points,
          COUNT(*) FILTER (WHERE store_name IS NOT NULL AND store_name != '') as cnt_store_name,
          COUNT(*) FILTER (WHERE store_code IS NOT NULL AND store_code != '') as cnt_store_code,
          COUNT(*) FILTER (WHERE registered_store IS NOT NULL AND registered_store != '') as cnt_registered_store,
          COUNT(*) FILTER (WHERE registered_store_number IS NOT NULL AND registered_store_number != '') as cnt_reg_store_num,
          COUNT(*) FILTER (WHERE registration_type IS NOT NULL AND registration_type != '') as cnt_registration_type,
          COUNT(*) FILTER (WHERE callback IS NOT NULL AND callback != '') as cnt_callback,
          COUNT(*) FILTER (WHERE total_purchase_amount IS NOT NULL AND total_purchase_amount > 0) as cnt_total_purchase_amount,
          COUNT(*) FILTER (WHERE total_purchase IS NOT NULL AND total_purchase > 0) as cnt_total_purchase,
          COUNT(*) FILTER (WHERE purchase_count IS NOT NULL AND purchase_count > 0) as cnt_purchase_count,
          COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL) as cnt_recent_purchase_date,
          COUNT(*) FILTER (WHERE recent_purchase_amount IS NOT NULL AND recent_purchase_amount > 0) as cnt_recent_purchase_amount,
          COUNT(*) FILTER (WHERE recent_purchase_store IS NOT NULL AND recent_purchase_store != '') as cnt_recent_purchase_store,
          COUNT(*) FILTER (WHERE avg_order_value IS NOT NULL AND avg_order_value > 0) as cnt_avg_order_value,
          COUNT(*) FILTER (WHERE ltv_score IS NOT NULL AND ltv_score > 0) as cnt_ltv_score,
          COUNT(*) FILTER (WHERE wedding_anniversary IS NOT NULL) as cnt_wedding,
          COUNT(*) FILTER (WHERE is_married IS NOT NULL) as cnt_married
        FROM customers WHERE ${scopeWhere}
      `, scopeParams);

      const dc = dataCheckResult.rows[0] || {};

      const DETECTABLE_FIELDS = [
        { field_key: 'gender', display_name: '성별', data_type: 'string', cnt_key: 'cnt_gender', sort_order: 10 },
        { field_key: 'birth_date', display_name: '생년월일', data_type: 'date', cnt_key: 'cnt_birth_date', sort_order: 20 },
        { field_key: 'age', display_name: '연령대', data_type: 'number', cnt_key: 'cnt_age', sort_order: 25 },
        { field_key: 'email', display_name: '이메일', data_type: 'string', cnt_key: 'cnt_email', sort_order: 30 },
        { field_key: 'address', display_name: '주소', data_type: 'string', cnt_key: 'cnt_address', sort_order: 35 },
        { field_key: 'region', display_name: '지역', data_type: 'string', cnt_key: 'cnt_region', sort_order: 40 },
        { field_key: 'grade', display_name: '등급', data_type: 'string', cnt_key: 'cnt_grade', sort_order: 50 },
        { field_key: 'points', display_name: '포인트', data_type: 'number', cnt_key: 'cnt_points', sort_order: 55 },
        { field_key: 'store_name', display_name: '매장명', data_type: 'string', cnt_key: 'cnt_store_name', sort_order: 60 },
        { field_key: 'store_code', display_name: '매장코드', data_type: 'string', cnt_key: 'cnt_store_code', sort_order: 65 },
        { field_key: 'registered_store', display_name: '등록매장', data_type: 'string', cnt_key: 'cnt_registered_store', sort_order: 67 },
        { field_key: 'registered_store_number', display_name: '등록매장번호', data_type: 'string', cnt_key: 'cnt_reg_store_num', sort_order: 68 },
        { field_key: 'registration_type', display_name: '가입유형', data_type: 'string', cnt_key: 'cnt_registration_type', sort_order: 69 },
        { field_key: 'callback', display_name: '회신번호', data_type: 'string', cnt_key: 'cnt_callback', sort_order: 70 },
        { field_key: 'total_purchase_amount', display_name: '총구매금액', data_type: 'number', cnt_key: 'cnt_total_purchase_amount', sort_order: 80 },
        { field_key: 'total_purchase', display_name: '총구매', data_type: 'number', cnt_key: 'cnt_total_purchase', sort_order: 81 },
        { field_key: 'purchase_count', display_name: '구매횟수', data_type: 'number', cnt_key: 'cnt_purchase_count', sort_order: 85 },
        { field_key: 'recent_purchase_date', display_name: '최근구매일', data_type: 'date', cnt_key: 'cnt_recent_purchase_date', sort_order: 90 },
        { field_key: 'recent_purchase_amount', display_name: '최근구매금액', data_type: 'number', cnt_key: 'cnt_recent_purchase_amount', sort_order: 91 },
        { field_key: 'recent_purchase_store', display_name: '최근구매매장', data_type: 'string', cnt_key: 'cnt_recent_purchase_store', sort_order: 92 },
        { field_key: 'avg_order_value', display_name: '평균구매금액', data_type: 'number', cnt_key: 'cnt_avg_order_value', sort_order: 95 },
        { field_key: 'ltv_score', display_name: 'LTV점수', data_type: 'number', cnt_key: 'cnt_ltv_score', sort_order: 100 },
        { field_key: 'wedding_anniversary', display_name: '결혼기념일', data_type: 'date', cnt_key: 'cnt_wedding', sort_order: 110 },
        { field_key: 'is_married', display_name: '결혼여부', data_type: 'boolean', cnt_key: 'cnt_married', sort_order: 115 },
      ];

      for (const fd of DETECTABLE_FIELDS) {
        if (parseInt(dc[fd.cnt_key] || '0') > 0) {
          fields.push({
            field_key: fd.field_key,
            display_name: fd.display_name,
            field_label: fd.display_name,
            data_type: fd.data_type,
            category: CATEGORY_MAP[fd.field_key] || '추가정보',
            sort_order: fd.sort_order,
            is_custom: false,
          });
          existingKeys.add(fd.field_key);
        }
      }
    }

    // 2. custom_fields JSONB 키 조회 (field_definitions에 없지만 실제 데이터에 존재하는 커스텀 필드)
    try {
      const customKeysResult = await query(
        `SELECT DISTINCT jsonb_object_keys(custom_fields) as field_key
         FROM customers
         WHERE ${scopeWhere} AND custom_fields IS NOT NULL AND custom_fields != '{}'::jsonb`,
        scopeParams
      );
      for (const row of customKeysResult.rows) {
        if (!existingKeys.has(row.field_key)) {
          const defResult = await query(
            `SELECT field_label FROM customer_field_definitions WHERE company_id = $1 AND field_key = $2`,
            [companyId, row.field_key]
          );
          fields.push({
            field_key: row.field_key,
            display_name: defResult.rows[0]?.field_label || row.field_key,
            field_label: defResult.rows[0]?.field_label || row.field_key,
            data_type: 'string',
            category: '추가정보',
            sort_order: 900,
            is_custom: true,
          });
          existingKeys.add(row.field_key);
        }
      }
    } catch (e) { /* custom_fields 없으면 무시 */ }

    // 3. 드롭다운 옵션 (gender, grade, region — 실제 DB 값 기반)
    const OPTION_COLUMNS: Record<string, string> = {
      'gender': 'gender', 'grade': 'grade', 'region': 'region',
    };
    const options: Record<string, string[]> = {};
    for (const [key, col] of Object.entries(OPTION_COLUMNS)) {
      try {
        const optResult = await query(
          `SELECT DISTINCT ${col} FROM customers WHERE ${scopeWhere} AND ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col} LIMIT 100`,
          scopeParams
        );
        if (optResult.rows.length > 0) {
          options[key] = optResult.rows.map((r: any) => r[col]);
        }
      } catch (e) { /* 컬럼 없으면 무시 */ }
    }

    // 4. 실제 고객 1건 샘플 데이터 (AI 맞춤한줄 미리보기용)
    let sample: Record<string, any> = {};
    try {
      const sampleResult = await query(
        `SELECT * FROM customers
         WHERE ${scopeWhere} AND name IS NOT NULL AND name != ''
         ORDER BY updated_at DESC LIMIT 1`,
        scopeParams
      );
      if (sampleResult.rows.length > 0) {
        const row = sampleResult.rows[0];
        // 표준 필드 + custom_fields flat merge
        for (const f of fields) {
          const key = f.field_key;
          if (f.is_custom && row.custom_fields && row.custom_fields[key] != null) {
            sample[key] = row.custom_fields[key];
          } else if (row[key] != null) {
            sample[key] = row[key];
          }
        }
      }
    } catch (e) { /* 샘플 조회 실패 시 빈 객체 */ }

    res.json({ fields, options, sample });
  } catch (error) {
    console.error('활성 필드 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// ====== 고객 삭제 API ======

// DELETE /api/customers/:id - 개별 삭제 (고객사관리자, 슈퍼관리자만)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    let companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    const { id } = req.params;

    // 슈퍼관리자는 companyId 쿼리 파라미터로 다른 회사 고객 삭제 가능
    if (userType === 'super_admin' && req.query.companyId) {
      companyId = req.query.companyId as string;
    }

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
    let companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    // 슈퍼관리자는 body에서 companyId 전달 가능
    if (userType === 'super_admin' && req.body.companyId) {
      companyId = req.body.companyId;
    }

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
      `SELECT c.*,
              CASE WHEN EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)
                   THEN false ELSE c.sms_opt_in END as sms_opt_in,
              EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone) as is_unsubscribed
       FROM customers_unified c WHERE c.id = $1 AND c.company_id = $2 AND c.is_active = true`,
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