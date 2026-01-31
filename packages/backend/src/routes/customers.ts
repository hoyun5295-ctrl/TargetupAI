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

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { filters, search, page = 1, limit = 50, gender, minAge, maxAge, grade, smsOptIn } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE company_id = $1 AND is_active = true';
    const params: any[] = [companyId];
    let paramIndex = 2;

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
      `SELECT COUNT(*) FROM customers ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // 목록 조회
    params.push(Number(limit), offset);
    const result = await query(
      `SELECT id, name, phone, gender, birth_date, email, grade, points,
              sms_opt_in, recent_purchase_date, total_purchase_amount, custom_fields
       FROM customers
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
      `SELECT COUNT(*) FROM customers ${whereClause}`,
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

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const result = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sms_opt_in = true) as sms_opt_in_count,
        COUNT(*) FILTER (WHERE gender = 'M') as male_count,
        COUNT(*) FILTER (WHERE gender = 'F') as female_count,
        COUNT(DISTINCT grade) as grade_count,
        AVG((custom_fields->>'purchase_count')::numeric) as avg_purchase_count,
        AVG((custom_fields->>'total_spent')::numeric) as avg_total_spent
       FROM customers
       WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );

    return res.json({ stats: result.rows[0] });
  } catch (error) {
    console.error('고객 통계 조회 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;