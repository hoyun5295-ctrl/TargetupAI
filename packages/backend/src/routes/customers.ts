import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

// GET /api/customers - 고객 목록 (타겟 추출)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { 
      gender, 
      minAge, 
      maxAge, 
      grade, 
      smsOptIn,
      search,
      page = 1, 
      limit = 50 
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    
    let whereClause = 'WHERE company_id = $1 AND is_active = true';
    const params: any[] = [companyId];
    let paramIndex = 2;

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
              sms_opt_in, recent_purchase_date, total_purchase_amount
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
    console.error('고객 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/customers - 고객 추가 (단건)
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const {
      phone, name, gender, birthDate, email, address,
      grade, points, storeCode, storeName, smsOptIn
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: '전화번호는 필수입니다.' });
    }

    const result = await query(
      `INSERT INTO customers (
        company_id, phone, name, gender, birth_date, email, address,
        grade, points, store_code, store_name, sms_opt_in
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        companyId, phone, name, gender, birthDate, email, address,
        grade, points, storeCode, storeName, smsOptIn ?? true
      ]
    );

    return res.status(201).json({
      message: '고객이 추가되었습니다.',
      customer: result.rows[0],
    });
  } catch (error) {
    console.error('고객 추가 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/customers/bulk - 고객 대량 추가
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { customers } = req.body;

    if (!Array.isArray(customers) || customers.length === 0) {
      return res.status(400).json({ error: '고객 데이터가 필요합니다.' });
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
            grade, points, sms_opt_in
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (company_id, phone) DO UPDATE SET
            name = EXCLUDED.name,
            gender = EXCLUDED.gender,
            birth_date = EXCLUDED.birth_date,
            email = EXCLUDED.email,
            grade = EXCLUDED.grade,
            points = EXCLUDED.points,
            sms_opt_in = EXCLUDED.sms_opt_in,
            updated_at = CURRENT_TIMESTAMP`,
          [
            companyId, customer.phone, customer.name, customer.gender,
            customer.birthDate, customer.email, customer.grade,
            customer.points, customer.smsOptIn ?? true
          ]
        );
        successCount++;
      } catch (err) {
        failCount++;
        errors.push(`에러: ${customer.phone}`);
      }
    }

    return res.json({
      message: `${successCount}건 성공, ${failCount}건 실패`,
      successCount,
      failCount,
      errors: errors.slice(0, 10), // 처음 10개만
    });
  } catch (error) {
    console.error('고객 대량 추가 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/customers/stats - 고객 통계
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const result = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sms_opt_in = true) as sms_opt_in_count,
        COUNT(*) FILTER (WHERE gender = 'M') as male_count,
        COUNT(*) FILTER (WHERE gender = 'F') as female_count,
        COUNT(DISTINCT grade) as grade_count
       FROM customers
       WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );

    return res.json({ stats: result.rows[0] });
  } catch (error) {
    console.error('고객 통계 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
