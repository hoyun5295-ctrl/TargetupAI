import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { generateMessages, recommendTarget, checkAPIStatus, extractVarCatalog } from '../services/ai';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getGenderVariants, getGradeVariants, getRegionVariants } from '../utils/normalize';

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

    const { prompt, filters, productName, discountRate, eventName, brandName, channel, isAd, usePersonalization, personalizationVars } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: '프롬프트를 입력해주세요' });
    }

    // 회사 정보 조회 (브랜드 정보 포함)
    const companyResult = await query(
      'SELECT reject_number, brand_name, brand_slogan, brand_description, brand_tone, customer_schema FROM companies WHERE id = $1',
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    const { fieldMappings: varCatalog, availableVars } = extractVarCatalog(companyInfo.customer_schema);

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
      brandName: companyInfo.brand_name || brandName || '브랜드',
      brandSlogan: companyInfo.brand_slogan,
      brandDescription: companyInfo.brand_description,
      brandTone: companyInfo.brand_tone,
      channel,
      isAd,
      rejectNumber: companyInfo.reject_number,
      usePersonalization,
      personalizationVars,
      availableVarsCatalog: varCatalog,
      availableVars: availableVars,
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
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { objective } = req.body;

    if (!objective) {
      return res.status(400).json({ error: '마케팅 목표를 입력해주세요' });
    }

    // 회사 정보 조회 (스키마 포함)
    const companyResult = await query(
      `SELECT company_name, business_type, reject_number, brand_name, customer_schema FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    // company_name을 name으로 매핑
    companyInfo.name = companyInfo.company_name;
    console.log('companyInfo:', companyInfo);

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    let storeFilter = '';
    const baseParams: any[] = [companyId];
    
    if (userType === 'company_user' && userId) {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        storeFilter = ' AND store_code = ANY($2::text[])';
        baseParams.push(storeCodes);
      }
    }

    // 고객 통계 조회
    const statsResult = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sms_opt_in = true) as sms_opt_in_count,
        COUNT(*) FILTER (WHERE gender = ANY($${baseParams.length + 1}::text[])) as male_count,
        COUNT(*) FILTER (WHERE gender = ANY($${baseParams.length + 2}::text[])) as female_count,
        AVG((custom_fields->>'purchase_count')::numeric) as avg_purchase_count,
        AVG((custom_fields->>'total_spent')::numeric) as avg_total_spent
       FROM customers
       WHERE company_id = $1 AND is_active = true${storeFilter}`,
      [...baseParams, getGenderVariants('M'), getGenderVariants('F')]
    );

    const result = await recommendTarget(companyId, objective, statsResult.rows[0], companyInfo);

console.log('AI 필터 결과:', JSON.stringify(result.filters, null, 2));

// 실제 타겟 수 계산
let filterWhere = '';
const filterParams: any[] = [];
let paramIndex = baseParams.length + 1;

const getValue = (field: any) => {
  if (!field) return null;
  if (typeof field === 'object' && field.value !== undefined) return field.value;
  return field;
};

const gender = getValue(result.filters?.gender);
if (gender) {
  // normalize.ts 변형값 매칭 (DB에 어떤 형식으로 저장되어 있든 매칭)
  const standardGender = String(gender).toLowerCase();
  const genderKey = ['m', 'male', '남', '남자', '남성'].includes(standardGender) ? 'M' 
    : ['f', 'female', '여', '여자', '여성'].includes(standardGender) ? 'F' : gender;
  const genderResult = buildGenderFilter(genderKey, paramIndex);
  filterWhere += genderResult.sql;
  filterParams.push(...genderResult.params);
  paramIndex = genderResult.nextIndex;
}

const age = getValue(result.filters?.age);
if (age && Array.isArray(age) && age.length === 2) {
  // birth_year 기준으로 나이 계산 (2026 - birth_year)
  filterWhere += ` AND (2026 - birth_year) >= $${paramIndex++}`;
  filterParams.push(age[0]);
  filterWhere += ` AND (2026 - birth_year) <= $${paramIndex++}`;
  filterParams.push(age[1]);
}

const gradeFilter = result.filters?.grade;
const grade = getValue(gradeFilter);
if (grade) {
  const gradeOp = gradeFilter?.operator || 'eq';
  if (gradeOp === 'in' && Array.isArray(grade)) {
    // 배열의 모든 등급에 대해 변형값 매칭
    const gradeResult = buildGradeFilter(grade, paramIndex);
    filterWhere += gradeResult.sql;
    filterParams.push(...gradeResult.params);
    paramIndex = gradeResult.nextIndex;
  } else {
    const gradeResult = buildGradeFilter(String(grade), paramIndex);
    filterWhere += gradeResult.sql;
    filterParams.push(...gradeResult.params);
    paramIndex = gradeResult.nextIndex;
  }
}

const regionFilter = result.filters?.region;
const region = getValue(regionFilter);
if (region) {
  const regionOp = regionFilter?.operator || 'eq';
  if (regionOp === 'in' && Array.isArray(region)) {
    // 배열의 모든 지역에 대해 변형값 매칭
    const allVariants = (region as string[]).flatMap(r => getRegionVariants(r));
    filterWhere += ` AND region = ANY($${paramIndex++}::text[])`;
    filterParams.push(allVariants);
  } else {
    const regionResult = buildRegionFilter(String(region), paramIndex);
    filterWhere += regionResult.sql;
    filterParams.push(...regionResult.params);
    paramIndex = regionResult.nextIndex;
  }
}

const pointsFilter = result.filters?.points;
const points = getValue(pointsFilter);
if (points !== null && points !== undefined) {
  const pointsOp = pointsFilter?.operator || 'gte';
  if (pointsOp === 'gte') {
    filterWhere += ` AND points >= $${paramIndex++}`;
    filterParams.push(points);
  } else if (pointsOp === 'lte') {
    filterWhere += ` AND points <= $${paramIndex++}`;
    filterParams.push(points);
  } else if (pointsOp === 'between' && Array.isArray(points)) {
    filterWhere += ` AND points >= $${paramIndex++} AND points <= $${paramIndex++}`;
    filterParams.push(points[0], points[1]);
  }
}

const purchaseFilter = result.filters?.total_purchase_amount;
const purchaseAmt = getValue(purchaseFilter);
if (purchaseAmt !== null && purchaseAmt !== undefined) {
  const purchaseOp = purchaseFilter?.operator || 'gte';
  if (purchaseOp === 'gte') {
    filterWhere += ` AND total_purchase_amount >= $${paramIndex++}`;
    filterParams.push(purchaseAmt);
  } else if (purchaseOp === 'lte') {
    filterWhere += ` AND total_purchase_amount <= $${paramIndex++}`;
    filterParams.push(purchaseAmt);
  }
}

const recentDateFilter = result.filters?.recent_purchase_date;
const recentDate = getValue(recentDateFilter);
if (recentDate) {
  const dateOp = recentDateFilter?.operator || 'lte';
  if (dateOp === 'lte') {
    filterWhere += ` AND recent_purchase_date <= $${paramIndex++}`;
    filterParams.push(recentDate);
  } else if (dateOp === 'gte') {
    filterWhere += ` AND recent_purchase_date >= $${paramIndex++}`;
    filterParams.push(recentDate);
  }
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
  `SELECT COUNT(*) FROM customers c
   WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterWhere}
   AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)`,
  [...baseParams, ...filterParams]
);
const actualCount = parseInt(actualCountResult.rows[0].count);

// 수신거부 건수 계산
const unsubCountResult = await query(
  `SELECT COUNT(*) FROM customers c
   WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterWhere}
   AND EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)`,
  [...baseParams, ...filterParams]
);
const unsubscribeCount = parseInt(unsubCountResult.rows[0].count);

result.estimated_count = actualCount;
(result as any).unsubscribe_count = unsubscribeCount;

return res.json(result);
  } catch (error) {
    console.error('AI 타겟 추천 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;