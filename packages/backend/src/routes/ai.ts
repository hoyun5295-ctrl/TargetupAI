import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { generateMessages, recommendTarget, checkAPIStatus } from '../services/ai';

const router = Router();

router.use(authenticate);

// GET /api/ai/status - API 상태 확인
router.get('/status', async (req: Request, res: Response) => {
  const status = checkAPIStatus();
  return res.json(status);
});

// POST /api/ai/generate-message - AI 메시지 생성
router.post('/generate-message', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { prompt, filters, productName, discountRate, eventName, brandName, channel } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: '프롬프트를 입력해주세요' });
    }

    // 타겟 정보 조회
    let targetQuery = 'SELECT COUNT(*) as total FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true';
    const targetResult = await query(targetQuery, [companyId]);
    
    const statsResult = await query(
      `SELECT 
        AVG((custom_fields->>'purchase_count')::numeric) as avg_purchase_count,
        AVG((custom_fields->>'total_spent')::numeric) as avg_total_spent
       FROM customers WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );

    const targetInfo = {
      total_count: parseInt(targetResult.rows[0].total),
      avg_purchase_count: parseFloat(statsResult.rows[0].avg_purchase_count) || 0,
      avg_total_spent: parseFloat(statsResult.rows[0].avg_total_spent) || 0,
    };

    const result = await generateMessages(prompt, targetInfo, {
      productName,
      discountRate,
      eventName,
      brandName,
      channel,
    });

    return res.json(result);
  } catch (error) {
    console.error('AI 메시지 생성 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/ai/recommend-target - AI 타겟 추천
router.post('/recommend-target', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { objective } = req.body;

    if (!objective) {
      return res.status(400).json({ error: '마케팅 목표를 입력해주세요' });
    }

    // 회사 정보 조회
    const companyResult = await query(
      `SELECT name, business_type, reject_number, brand_name FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    console.log('companyInfo:', companyInfo);
    if (!objective) {
      return res.status(400).json({ error: '마케팅 목표를 입력해주세요' });
    }
    

    // 고객 통계 조회
    const statsResult = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sms_opt_in = true) as sms_opt_in_count,
        COUNT(*) FILTER (WHERE gender = 'M') as male_count,
        COUNT(*) FILTER (WHERE gender = 'F') as female_count,
        AVG((custom_fields->>'purchase_count')::numeric) as avg_purchase_count,
        AVG((custom_fields->>'total_spent')::numeric) as avg_total_spent
       FROM customers
       WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );

    const result = await recommendTarget(companyId, objective, statsResult.rows[0], companyInfo);

// 실제 타겟 수 계산
let filterWhere = '';
const filterParams: any[] = [];
let paramIndex = 2;

const getValue = (field: any) => {
  if (!field) return null;
  if (typeof field === 'object' && field.value !== undefined) return field.value;
  return field;
};

const gender = getValue(result.filters?.gender);
if (gender) {
  filterWhere += ` AND gender = $${paramIndex++}`;
  filterParams.push(gender);
}

const age = getValue(result.filters?.age);
if (age && Array.isArray(age) && age.length === 2) {
  filterWhere += ` AND EXTRACT(YEAR FROM AGE(birth_date)) >= $${paramIndex++}`;
  filterParams.push(age[0]);
  filterWhere += ` AND EXTRACT(YEAR FROM AGE(birth_date)) <= $${paramIndex++}`;
  filterParams.push(age[1]);
}

const grade = getValue(result.filters?.grade);
if (grade) {
  filterWhere += ` AND grade = $${paramIndex++}`;
  filterParams.push(grade);
}

// custom_fields 처리
Object.keys(result.filters || {}).forEach(key => {
  if (key.startsWith('custom_fields.')) {
    const fieldName = key.replace('custom_fields.', '');
    const condition = result.filters[key];
    const value = getValue(condition);
    const operator = condition?.operator || 'eq';
    
    if (value !== null && value !== undefined) {
      if (operator === 'eq') {
        filterWhere += ` AND custom_fields->>'${fieldName}' = $${paramIndex++}`;
        filterParams.push(value);
      } else if (operator === 'gte') {
        filterWhere += ` AND (custom_fields->>'${fieldName}')::numeric >= $${paramIndex++}`;
        filterParams.push(value);
      } else if (operator === 'lte') {
        filterWhere += ` AND (custom_fields->>'${fieldName}')::numeric <= $${paramIndex++}`;
        filterParams.push(value);
      } else if (operator === 'in' && Array.isArray(value)) {
        filterWhere += ` AND custom_fields->>'${fieldName}' = ANY($${paramIndex++})`;
        filterParams.push(value);
      }
    }
  }
});

const actualCountResult = await query(
  `SELECT COUNT(*) FROM customers 
   WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ${filterWhere}`,
  [companyId, ...filterParams]
);
result.estimated_count = parseInt(actualCountResult.rows[0].count);

return res.json(result);
  } catch (error) {
    console.error('AI 타겟 추천 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;