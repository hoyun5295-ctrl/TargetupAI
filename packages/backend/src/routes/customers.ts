import { Request, Response, Router } from 'express';
import * as XLSX from 'xlsx';
import { query, mysqlQuery } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getGenderVariants } from '../utils/normalize';
// ★ 2026-06-25: 고객 전체 삭제 시 데이터 프로필 캐시 무효화(게이트 즉시 반영)
import { clearCompanyDataProfileCache } from '../utils/company-data-profile';
import { FIELD_MAP, getFieldByKey, getColumnFields, CATEGORY_LABELS, FIELD_DISPLAY_MAP, reverseDisplayValue, renderFieldValue } from '../utils/standard-field-map';
import { DEFAULT_COSTS, redis, CACHE_TTL } from '../config/defaults';
import { isValidCustomFieldKey } from '../utils/safe-field-name';
import { getStoreScope } from '../utils/store-scope';
import { buildDynamicFilterCompat } from '../utils/customer-filter';
import { getTestSmsTables, kakaoBatchAggByGroup } from '../utils/sms-queue';
import { detectPhoneFields } from '../utils/callback-filter';
import { aggregateSmsCountsByCampaign } from '../utils/stats-aggregation';
import { blockIfSyncActive } from '../middlewares/sync-active-check';
import { createCustomerUpsertBuilder } from '../utils/customer-upsert';
import { detectEnabledFields, buildDynamicSelectExpr } from '../utils/enabled-fields';
// ★ D219+ Part 2 후속 (2026-05-27): CT-97 활용 — DirectTargetFilterModal 자연어 모드 (BASIC+ 게이팅)
import { requirePlanFeature } from '../utils/plan-guard';
import { generateSegmentFromNaturalLanguage, SegmentGenerationError } from '../utils/ai-segment-generator';

const router = Router();

router.use(authenticate);

// ★ D79: 인라인 래퍼 제거 → CT-01 buildDynamicFilterCompat 직접 사용

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

    // ★ B16-01: 브랜드(store_code) 격리 — store-scope 컨트롤타워 사용
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        whereClause += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${paramIndex++}::text[]))`;
        params.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({
          customers: [],
          pagination: { total: 0, page: Number(req.query.page || 1), limit: Number(req.query.limit || 50), totalPages: 0 },
        });
      }
      // scope.type === 'no_filter' → 필터 없이 company_id 전체 (기존대로)
    }

    // ★ D88: 사용자(ID)별 필터 → 해당 사용자의 store_codes 기준 조회 (uploaded_by 아닌 소속 브랜드 기준)
    const filterUserId = req.query.filterUserId as string;
    if (filterUserId && (userType === 'company_admin' || userType === 'super_admin')) {
      const fuResult = await query('SELECT store_codes FROM users WHERE id = $1 AND company_id = $2', [filterUserId, companyId]);
      const fuStoreCodes = fuResult.rows[0]?.store_codes;
      if (fuStoreCodes && fuStoreCodes.length > 0) {
        whereClause += ` AND store_code = ANY($${paramIndex++}::text[])`;
        params.push(fuStoreCodes);
      } else {
        // store_codes 미지정 사용자 → 해당 사용자가 업로드한 고객으로 폴백
        whereClause += ` AND uploaded_by = $${paramIndex++}`;
        params.push(filterUserId);
      }
    }

    // ★ 브랜드(store_code) 필터 — 고객사관리자/슈퍼관리자가 특정 브랜드만 조회
    const filterStoreCode = req.query.filterStoreCode as string;
    if (filterStoreCode && (userType === 'company_admin' || userType === 'super_admin')) {
      whereClause += ` AND store_code = $${paramIndex++}`;
      params.push(filterStoreCode);
    }

    // 동적 필터 적용
    if (filters) {
      const parsedFilters = typeof filters === 'string' ? JSON.parse(filters) : filters;
      const filterResult = buildDynamicFilterCompat(parsedFilters, paramIndex);
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
  // ★ D131 후속(2026-04-21): 원본 보존 — variant 확장 제거, DB 저장값과 정확히 일치하는 것만 매칭
  whereClause += ` AND grade = $${paramIndex++}`;
  params.push(String(grade));
}
// ★ B17-01: 수신거부 user_id 기준 통일
if (smsOptIn === 'true') {
  whereClause += ` AND sms_opt_in = true AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${paramIndex} AND u.phone = customers_unified.phone)`;
  params.push(userId);
  paramIndex++;
} else if (smsOptIn === 'false') {
  whereClause += ` AND (sms_opt_in = false OR EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${paramIndex} AND u.phone = customers_unified.phone))`;
  params.push(userId);
  paramIndex++;
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

    // 목록 조회 — ★ B17-01: 수신거부 user_id 기준 통일
    const unsubCaseIdx = paramIndex++;
    params.push(userId);
    params.push(Number(limit), offset);
    const result = await query(
      `SELECT id, name, phone, gender, TO_CHAR(birth_date, 'YYYY-MM-DD') as birth_date, age, email, address, grade, region, points,
              store_code, store_name, registered_store, recent_purchase_store,
              store_phone, registration_type,
              recent_purchase_amount, purchase_count,
              CASE WHEN EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubCaseIdx} AND u.phone = customers_unified.phone)
                   THEN false ELSE sms_opt_in END as sms_opt_in,
              TO_CHAR(recent_purchase_date, 'YYYY-MM-DD') as recent_purchase_date, total_purchase_amount, custom_fields
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

// ★ D132 Phase A: GET /api/customers/download - 현재 필터 조건 고객 리스트 XLSX 다운로드
//   CT-01 buildDynamicFilterCompat 재활용 (인라인 쿼리 금지).
//   GET /api/customers 와 동일한 WHERE 절 로직을 적용하되 limit 없이 전체 매칭 고객 내보냄.
// ★ CT-18 기반 동적 다운로드
//   Harold님 원칙 (D136, 2026-04-22): "고객사에서 바라보는 현황을 동적으로 바라보고 그걸 그대로 다운로드"
//   → detectEnabledFields 단일 진입점 사용. standardHeaders 19개 하드코딩 전면 제거.
//   → 화면(/enabled-fields) ≡ 엑셀(/download) 100% 일치 보장.
router.get('/download', async (req: Request, res: Response) => {
  try {
    let companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (userType === 'super_admin' && req.query.companyId) {
      companyId = req.query.companyId as string;
    }
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { filters, search, smsOptIn } = req.query;

    // ─── 1. scope/filter WHERE 절 조립 ───
    let scopeWhere = 'company_id = $1 AND is_active = true';
    const scopeParams: any[] = [companyId];
    let paramIndex = 2;

    // 브랜드 격리 (CT-02)
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        scopeWhere += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${paramIndex++}::text[]))`;
        scopeParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.status(403).json({ error: '접근 권한이 없습니다' });
      }
    }

    // 사용자별 필터
    const filterUserId = req.query.filterUserId as string;
    if (filterUserId && (userType === 'company_admin' || userType === 'super_admin')) {
      const fuResult = await query('SELECT store_codes FROM users WHERE id = $1 AND company_id = $2', [filterUserId, companyId]);
      const fuStoreCodes = fuResult.rows[0]?.store_codes;
      if (fuStoreCodes && fuStoreCodes.length > 0) {
        scopeWhere += ` AND store_code = ANY($${paramIndex++}::text[])`;
        scopeParams.push(fuStoreCodes);
      } else {
        scopeWhere += ` AND uploaded_by = $${paramIndex++}`;
        scopeParams.push(filterUserId);
      }
    }

    // 브랜드(store_code) 필터
    const filterStoreCode = req.query.filterStoreCode as string;
    if (filterStoreCode && (userType === 'company_admin' || userType === 'super_admin')) {
      scopeWhere += ` AND store_code = $${paramIndex++}`;
      scopeParams.push(filterStoreCode);
    }

    // ─── 2. CT-18: 활성 필드 동적 탐지 (화면과 동일 결과) ───
    //   이 시점의 scopeWhere/scopeParams 기준으로 실제 데이터 유무 판정
    const { fields } = await detectEnabledFields({
      companyId,
      scopeWhere,
      scopeParams: [...scopeParams],
    });

    // ─── 3. 동적 필터/검색/수신동의 WHERE 절 (리스트 쿼리 전용 추가) ───
    let listWhere = scopeWhere;
    const listParams = [...scopeParams];

    // 동적 필터 (CT-01)
    if (filters) {
      const parsedFilters = typeof filters === 'string' ? JSON.parse(filters) : filters;
      const filterResult = buildDynamicFilterCompat(parsedFilters, paramIndex);
      listWhere += filterResult.where;
      listParams.push(...filterResult.params);
      paramIndex = filterResult.nextIndex;
    }

    // 수신동의 필터
    if (smsOptIn === 'true') {
      listWhere += ` AND sms_opt_in = true AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${paramIndex} AND u.phone = customers_unified.phone)`;
      listParams.push(userId);
      paramIndex++;
    } else if (smsOptIn === 'false') {
      listWhere += ` AND (sms_opt_in = false OR EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${paramIndex} AND u.phone = customers_unified.phone))`;
      listParams.push(userId);
      paramIndex++;
    }

    // 검색어
    if (search) {
      const searchStr = String(search);
      const cleanSearch = searchStr.replace(/-/g, '');
      if (/^\d+$/.test(cleanSearch)) {
        if (cleanSearch.length === 4) {
          listWhere += ` AND (REPLACE(phone, '-', '') LIKE $${paramIndex} OR REPLACE(phone, '-', '') LIKE $${paramIndex + 1})`;
          listParams.push(`___${cleanSearch}____`, `_______${cleanSearch}`);
          paramIndex++;
        } else {
          listWhere += ` AND REPLACE(phone, '-', '') LIKE $${paramIndex}`;
          listParams.push(`%${cleanSearch}%`);
        }
      } else {
        listWhere += ` AND (name ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`;
        listParams.push(`%${searchStr}%`);
      }
      paramIndex++;
    }

    // ─── 4. 동적 SELECT (CT-18 buildDynamicSelectExpr) ───
    //   - fields에 sms_opt_in 포함 시 unsubscribes 반영 CASE 자동 생성
    //   - date 필드는 TO_CHAR('YYYY-MM-DD') 자동 적용
    //   - 커스텀 필드는 custom_fields JSONB 한 번만 SELECT
    const unsubParamIndex = paramIndex++;
    listParams.push(userId);

    const { selectExpr } = buildDynamicSelectExpr(fields, {
      unsubParamIndex,
      tableAlias: 'customers_unified',
    });

    if (!selectExpr) {
      // 이 고객사에 활성 필드가 없음 — 빈 엑셀 반환 방지용 방어
      return res.status(400).json({ error: '다운로드할 컬럼이 없습니다.' });
    }

    const result = await query(
      `SELECT ${selectExpr}
         FROM customers_unified
        WHERE ${listWhere}
        ORDER BY created_at DESC`,
      listParams,
    );

    // ─── 5. 동적 Row 변환 (renderFieldValue 단일 진입점) ───
    //   ★ D142 (2026-04-28) Harold님 원칙: "고객사 보는 화면 그대로 다운로드"
    //   · 22개 고정 필드: renderFieldValue → FIELD_DISPLAY_FORMAT_MAP 룰 적용
    //     (phone/store_phone → 하이픈 / recent_purchase_amount/total_purchase_amount/points → 콤마+정수
    //      / gender → 한글 / birth_date/recent_purchase_date → YYYY-MM-DD)
    //   · 커스텀 필드: 원본 보존 (Harold님 원칙 — feedback_custom_field_raw_preserve.md)
    //   · sms_opt_in(boolean): 엑셀 관행 'Y'/'N' (별도 분기 유지)
    //   화면 sample(reverseDisplayValue 적용) ≡ 엑셀 다운로드 100% 일치 보장.
    const rows = result.rows.map((c: any) => {
      const row: Record<string, any> = {};
      for (const f of fields) {
        const label = f.field_label;
        let val: any;

        if (f.is_custom) {
          val = c.custom_fields?.[f.field_key];
          // 커스텀 필드: 원본 100% 보존 (자동 추론 X)
          row[label] = val == null ? '' : String(val);
          continue;
        }

        val = c[f.field_key];

        // boolean(sms_opt_in 등) → Y/N (엑셀 관행, 화면과는 별개)
        if (f.data_type === 'boolean') {
          row[label] = val === true || val === 'true' ? 'Y' : 'N';
          continue;
        }

        // 22개 고정 필드: 컨트롤타워 단일 진입점 (화면 displayValue와 동일 룰)
        row[label] = renderFieldValue(val, f.field_key);
      }
      return row;
    });

    // ─── 6. XLSX 생성 ───
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '고객DB');
    const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 14);
    const filename = `customers_${ts}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('고객 다운로드 오류:', error);
    return res.status(500).json({ error: '다운로드 중 오류가 발생했습니다.' });
  }
});

// POST /api/customers/filter - 필터 미리보기 (타겟 수 계산)
router.post('/filter', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { filters } = req.body;

    let whereClause = 'WHERE company_id = $1 AND is_active = true AND sms_opt_in = true';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        whereClause += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${paramIndex++}::text[]))`;
        params.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({ total: 0, customers: [] });
      }
    }

    if (filters) {
      const filterResult = buildDynamicFilterCompat(filters, paramIndex);
      whereClause += filterResult.where;
      params.push(...filterResult.params);
    }

    // ★ B17-01: 수신거부 user_id 기준 통일
    params.push(userId);
    const countResult = await query(
      `SELECT COUNT(*) FROM customers_unified c ${whereClause}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${params.length} AND u.phone = c.phone)`,
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
router.post('/', blockIfSyncActive, async (req: Request, res: Response) => {
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
        p.customer_db_enabled,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id AND is_active = true) as current_count
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [companyId]);

    if (limitCheck.rows.length > 0) {
      const { max_customers, current_count, plan_name, customer_db_enabled } = limitCheck.rows[0];
      // ★ 2026-06-08: 고객 DB 업로드는 유료 요금제만 (FREE/미가입 customer_db_enabled=false → 차단)
      if (!customer_db_enabled) {
        return res.status(403).json({ error: '고객 DB 업로드는 유료 요금제에서 이용 가능합니다.', code: 'CUSTOMER_DB_LOCKED', planName: plan_name });
      }
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

    // ★ customer-upsert.ts 컨트롤타워 사용 (upload/sync와 동일 진입점, 인라인 INSERT 제거)
    const manualUpsertBuilder = createCustomerUpsertBuilder({
      source: 'manual',
      includeUploadedBy: false,
      returning: 'all',
    });
    const manualRow: Record<string, any> = {
      phone,
      name,
      gender,
      birth_date: birthDate,
      email,
      address,
      grade,
      points,
      store_code: storeCode,
      store_name: storeName,
      sms_opt_in: smsOptIn ?? true,
      custom_fields: customFields ? JSON.stringify(customFields) : null,
    };
    const { sql: manualSql, values: manualValues } = manualUpsertBuilder.buildBatch(companyId, [manualRow]);
    const result = await query(manualSql, manualValues);

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
router.post('/bulk', blockIfSyncActive, async (req: Request, res: Response) => {
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
        p.customer_db_enabled,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id AND is_active = true) as current_count
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [companyId]);

    if (limitCheck.rows.length > 0) {
      const { max_customers, current_count, plan_name, customer_db_enabled } = limitCheck.rows[0];
      // ★ 2026-06-08: 고객 DB 업로드는 유료 요금제만 (FREE/미가입 customer_db_enabled=false → 차단)
      if (!customer_db_enabled) {
        return res.status(403).json({ error: '고객 DB 업로드는 유료 요금제에서 이용 가능합니다.', code: 'CUSTOMER_DB_LOCKED', planName: plan_name });
      }
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

    // ★ customer-upsert.ts 컨트롤타워로 벌크 INSERT 통합 (upload/sync와 동일 진입점)
    const bulkUpsertBuilder = createCustomerUpsertBuilder({
      source: 'manual',
      includeUploadedBy: false,
    });
    const bulkRows: Record<string, any>[] = [];
    for (const customer of customers) {
      if (!customer.phone) {
        failCount++;
        errors.push(`전화번호 없음: ${JSON.stringify(customer)}`);
        continue;
      }
      bulkRows.push({
        phone: customer.phone,
        name: customer.name,
        gender: customer.gender,
        birth_date: customer.birthDate,
        email: customer.email,
        grade: customer.grade,
        points: customer.points,
        sms_opt_in: customer.smsOptIn ?? true,
        custom_fields: customer.customFields ? JSON.stringify(customer.customFields) : null,
      });
    }
    if (bulkRows.length > 0) {
      try {
        const { sql: bulkSql, values: bulkValues } = bulkUpsertBuilder.buildBatch(companyId, bulkRows);
        await query(bulkSql, bulkValues);
        successCount = bulkRows.length;
      } catch (err: any) {
        failCount += bulkRows.length;
        errors.push(`벌크 INSERT 오류: ${err?.message || 'unknown'}`);
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
    
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    // ★ Redis 캐싱 (60초) — 사용자별 캐시 키 (브랜드별 store_code 격리 반영)
    const cacheKey = `stats:${companyId}:${userId || 'anonymous'}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    } catch (e) { /* Redis 실패 시 DB 직접 조회 */ }

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    // ★ B16-01: store_codes 없는 company_user → 빈 통계 반환
    let storeFilter = '';
    const params: any[] = [companyId];

    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
        params.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({ total: 0, sms_opt_in_count: 0, gender_male: 0, gender_female: 0, gender_unknown: 0, age_20s: 0, age_30s: 0, age_40s: 0, age_50s: 0, age_60plus: 0, age_unknown: 0, grades: [], store_codes: [], custom_field_keys: [] });
      }
    }

    // ★ B17-01: 수신거부 user_id 기준 통일
    const unsubStatIdx = params.length + 1;
    params.push(userId);
    const result = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE c.sms_opt_in = true
          AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubStatIdx} AND u.phone = c.phone)
        ) as sms_opt_in_count,
        COUNT(*) FILTER (WHERE c.gender = ANY($${params.length + 1}::text[])) as male_count,
        COUNT(*) FILTER (WHERE c.gender = ANY($${params.length + 2}::text[])) as female_count,
        COUNT(*) FILTER (WHERE c.grade = 'VIP') as vip_count,
        COUNT(*) FILTER (WHERE c.sms_opt_in = false OR EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubStatIdx} AND u.phone = c.phone)) as unsubscribe_count,
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
    // ★ 사용자(company_user)는 본인 발송만, 관리자(company_admin)는 전체
    // ★ D144: PG cr.sent_count/success_count + c.sent_count/success_count 캐시 의존 제거.
    //   PG는 캠페인 메타만 SELECT → MySQL 큐 + 카카오 직접 카운트 → JS에서 message_type별 합산.
    const monthlySendFilterClause = userType === 'company_user' && userId ? ' AND c.created_by = $2' : '';
    const monthlySendFilterParams: any[] = userType === 'company_user' && userId ? [companyId, userId] : [companyId];

    const monthlyMetaResult = await query(
      `SELECT c.id, c.company_id, c.created_by, c.message_type
       FROM campaigns c
       WHERE c.company_id = $1
         AND c.status NOT IN ('cancelled', 'draft', 'scheduled')
         AND c.created_at >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))::date::timestamp AT TIME ZONE 'Asia/Seoul'${monthlySendFilterClause}`,
      monthlySendFilterParams
    );

    const monthlySmsMap = await aggregateSmsCountsByCampaign(monthlyMetaResult.rows);
    const monthlyKakaoMap = await kakaoBatchAggByGroup(monthlyMetaResult.rows.map((c: any) => c.id));

    // 채널별 집계 (성공 건수 기준으로 비용 계산)
    let smsSent = 0, lmsSent = 0, mmsSent = 0, kakaoSent = 0;
    let totalSent = 0, totalSuccess = 0, totalFail = 0;

    for (const c of monthlyMetaResult.rows) {
      const sms = monthlySmsMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
      const kakao = monthlyKakaoMap.get(c.id) || { total: 0, success: 0, fail: 0, pending: 0 };
      const sent = Number(sms.total_count || 0) + kakao.total;
      const success = Number(sms.success_count || 0) + kakao.success;
      totalSent += sent;
      totalSuccess += success;
      totalFail += Number(sms.fail_count || 0) + kakao.fail;

      switch (c.message_type) {
        case 'SMS': smsSent += success; break;
        case 'LMS': lmsSent += success; break;
        case 'MMS': mmsSent += success; break;
        case 'KAKAO': kakaoSent += success; break;
      }
    }

    // 월 사용금액 계산 (고객사 DB 단가 우선, 없으면 환경변수 기본단가)
    const costSms = parseFloat(company.cost_per_sms) || DEFAULT_COSTS.sms;
    const costLms = parseFloat(company.cost_per_lms) || DEFAULT_COSTS.lms;
    const costMms = parseFloat(company.cost_per_mms) || DEFAULT_COSTS.mms;
    const costKakao = parseFloat(company.cost_per_kakao) || DEFAULT_COSTS.kakao;

    let monthlyCost =
      smsSent * costSms +
      lmsSent * costLms +
      mmsSent * costMms +
      kakaoSent * costKakao;

    // ★ D79: 테스트발송 + 스팸필터 — 발송건수/성공률에서 제외, 사용금액만 요금제별 차등 포함
    // - 발송건수/성공률: 테스트/스팸필터 절대 미포함 (실제 발송 실적만)
    // - 사용금액: 무료/스타터/베이직 → 포함 (유료), 프로 이상 → 미포함 (무료 제공)
    let testCost = 0;
    try {
      // 요금제 확인 — 프로 이상이면 테스트 비용 무료
      const planResult = await query(
        `SELECT p.plan_code FROM companies c JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`,
        [companyId]
      );
      const planCode = (planResult.rows[0]?.plan_code || 'FREE').toUpperCase();
      const isProOrAbove = ['PRO', 'BUSINESS', 'ENTERPRISE'].includes(planCode);

      if (!isProOrAbove) {
        // 무료/스타터/베이직: 테스트 비용을 사용금액에 포함
        // ★ D100: balance_transactions 기반으로 테스트 비용 조회 (근본 해결)
        //   prepaidDeduct()가 모든 차감(테스트/스팸/발송)에서 created_by=userId를 저장하므로
        //   balance_transactions 한 곳에서 정확한 사용자별 비용 조회 가능.
        //   기존 방식(MySQL 테스트 테이블 직접 조회)은 userId 저장 불일치 문제가 있었음.
        //   → 테스트발송 차감 참조ID = '00000000-0000-0000-0000-000000000000' (더미 UUID)
        const testCostFilter = userType === 'company_user' && userId ? ' AND created_by = $2' : '';
        const testCostParams: any[] = userType === 'company_user' && userId ? [companyId, userId] : [companyId];
        const testCostResult = await query(
          `SELECT COALESCE(SUM(amount), 0)::numeric as total
           FROM balance_transactions
           WHERE company_id = $1
             AND type = 'deduct'
             AND reference_id = '00000000-0000-0000-0000-000000000000'
             AND created_at >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))::date::timestamp AT TIME ZONE 'Asia/Seoul'${testCostFilter}`,
          testCostParams
        );
        testCost += parseFloat(testCostResult.rows[0]?.total ?? 0);

        // 스팸필터 비용도 balance_transactions에서 조회
        //   스팸필터 차감의 reference_id = spam_filter_tests.id (UUID)
        //   reference_type = 'campaign' (prepaidDeduct 기본값)
        //   description에 '스팸' 포함되지 않으므로 spam_filter_tests JOIN으로 식별
        const sfCostFilter = userType === 'company_user' && userId ? ' AND bt.created_by = $2' : '';
        const sfCostParams: any[] = userType === 'company_user' && userId ? [companyId, userId] : [companyId];
        const sfCostResult = await query(
          `SELECT COALESCE(SUM(bt.amount), 0)::numeric as total
           FROM balance_transactions bt
           WHERE bt.company_id = $1
             AND bt.type = 'deduct'
             AND bt.reference_id IN (SELECT id FROM spam_filter_tests WHERE company_id = $1)
             AND bt.created_at >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))::date::timestamp AT TIME ZONE 'Asia/Seoul'${sfCostFilter}`,
          sfCostParams
        );
        testCost += parseFloat(sfCostResult.rows[0]?.total ?? 0);
      }
      // 프로 이상: testCost = 0 (무료 제공, 사용금액 미포함)
    } catch (testCostErr) {
      console.warn('[대시보드] 테스트/스팸필터 비용 조회 실패 (무시):', testCostErr);
    }
    monthlyCost += testCost;

    const successRate = totalSent > 0 ? ((totalSuccess / totalSent) * 100).toFixed(1) : '0';

    const responseData = { 
      stats: {
        ...result.rows[0],
        monthly_sent: totalSuccess,
        monthly_total: totalSent,
        monthly_fail: totalFail,
        success_rate: successRate,
        monthly_budget: parseFloat(company.monthly_budget || '0'),
        monthly_cost: Math.round(monthlyCost),
        sms_sent: smsSent,
        lms_sent: lmsSent,
        mms_sent: mmsSent,
        kakao_sent: kakaoSent,
        cost_per_sms: parseFloat(company.cost_per_sms) || DEFAULT_COSTS.sms,
        cost_per_lms: parseFloat(company.cost_per_lms) || DEFAULT_COSTS.lms,
        cost_per_mms: parseFloat(company.cost_per_mms) || DEFAULT_COSTS.mms,
        cost_per_kakao: parseFloat(company.cost_per_kakao) || DEFAULT_COSTS.kakao,
        use_db_sync: company.use_db_sync ?? true,
        use_file_upload: company.use_file_upload ?? true
      }
    };
    // ★ Redis 캐시 저장 (60초)
    try { await redis.setex(cacheKey, CACHE_TTL.customerStats, JSON.stringify(responseData)); } catch (e) { /* 캐시 실패 무시 */ }
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
    // ★ B16-01: store_codes 없는 company_user → 빈 결과
    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        whereClause += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${paramIndex++}::text[]))`;
        params.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({ count: 0 });
      }
    }

    // 수신동의 필터
    if (dynamicFilters && typeof dynamicFilters === 'object' && Object.keys(dynamicFilters).length > 0) {
      // === 동적 필터 (새 UI) ===
      if (smsOptIn) whereClause += ' AND sms_opt_in = true';
      const df = buildDynamicFilterCompat(dynamicFilters, paramIndex);
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
        // ★ D79: age 컬럼 NULL이어도 birth_date에서 나이 동적 계산
        const ageExpr = `COALESCE(age, DATE_PART('year', AGE(birth_date))::int)`;
        const ageVal = parseInt(ageRange);
        if (ageVal === 60) {
          whereClause += ` AND ${ageExpr} >= 60`;
        } else {
          whereClause += ` AND ${ageExpr} >= $${paramIndex++} AND ${ageExpr} < $${paramIndex++}`;
          params.push(ageVal, ageVal + 10);
        }
      }
      if (grade) {
        // ★ D131 후속(2026-04-21): 원본 보존 — variant 확장 제거
        whereClause += ` AND grade = $${paramIndex++}`;
        params.push(String(grade));
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
      `SELECT COUNT(*) FROM customers ${whereClause}`,
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

    // ★ D53: 요금제 게이팅 — customer_db_enabled 체크
    const planCheck = await query(
      `SELECT p.customer_db_enabled FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       WHERE c.id = $1`,
      [companyId]
    );
    if (!planCheck.rows[0]?.customer_db_enabled) {
      return res.status(403).json({
        error: '고객 DB 관리는 스타터 이상 요금제에서 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED'
      });
    }

    const { gender, ageRange, grade, region, minPurchase, recentDays, smsOptIn, phoneField, dynamicFilters } = req.body;

    let whereClause = 'WHERE company_id = $1 AND is_active = true';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        whereClause += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${paramIndex++}::text[]))`;
        params.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({ customers: [], count: 0 });
      }
    }

    if (dynamicFilters && typeof dynamicFilters === 'object' && Object.keys(dynamicFilters).length > 0) {
      if (smsOptIn) whereClause += ' AND sms_opt_in = true';
      const df = buildDynamicFilterCompat(dynamicFilters, paramIndex);
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
        // ★ D79: age 컬럼 NULL이어도 birth_date에서 나이 동적 계산
        const ageExpr = `COALESCE(age, DATE_PART('year', AGE(birth_date))::int)`;
        const ageVal = parseInt(ageRange);
        if (ageVal === 60) {
          whereClause += ` AND ${ageExpr} >= 60`;
        } else {
          whereClause += ` AND ${ageExpr} >= $${paramIndex++} AND ${ageExpr} < $${paramIndex++}`;
          params.push(ageVal, ageVal + 10);
        }
      }
      if (grade) {
        // ★ D131 후속(2026-04-21): 원본 보존 — variant 확장 제거
        whereClause += ` AND grade = $${paramIndex++}`;
        params.push(String(grade));
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

    // 데이터 추출 (FIELD_MAP 기반 동적 SELECT — D43-3 동적화)
    const phoneColumn = phoneField || 'phone';
    
    // FIELD_MAP에서 직접 컬럼 동적 생성
    const columnFields = getColumnFields();
    const selectParts = columnFields.map(f => {
      // phone은 phoneField 파라미터에 따라 별칭 처리
      if (f.columnName === 'phone') return `${phoneColumn} as phone`;
      return f.columnName;
    });
    // 시스템/파생/레거시 필드 추가 (FIELD_MAP 외, 기존 흐름 호환)
    selectParts.push('region', 'custom_fields', 'callback');
    const selectClause = selectParts.join(', ');
    
    // ★ B-D75-04: LIMIT 하드코딩 제거 — 필터 조건에 맞는 전체 고객을 추출 (제한 없음)
    const result = await query(
      `SELECT ${selectClause}
      FROM customers
      ${whereClause}
      ORDER BY created_at DESC`,
      params
    );

    // ★ B-D75-03: custom_fields JSONB를 flat하게 풀어서 반환 (프론트에서 r[field_key]로 직접 접근 가능)
    // ★ B+0407-1: enum 필드(gender F→여성) 미리 변환 — 모든 frontend 표시 경로 자동 정상화
    // ★ D142 (2026-04-28): custom_fields 평면화 시 모든 값을 String()로 강제 (Harold님 원칙).
    //   custom_1~15는 고객사 업로드 원본을 100% 보존해야 하는데, JSONB에 number/Date 객체 등으로
    //   저장된 케이스가 있으면 프론트에서 typeof로 자동 추론되어 콤마 사고 발생 가능.
    //   백엔드 출구에서 String() 박제 → 프론트 어디서든 number 추론 불가.
    const flatRecipients = result.rows.map((r: any) => {
      let flat: any;
      if (r.custom_fields && typeof r.custom_fields === 'object') {
        const { custom_fields, ...rest } = r;
        const customFlat = Object.fromEntries(
          Object.entries(custom_fields).map(([k, v]) => [k, v == null ? '' : String(v)])
        );
        flat = { ...rest, ...customFlat };
      } else {
        flat = { ...r };
      }
      for (const fk of Object.keys(FIELD_DISPLAY_MAP)) {
        if (flat[fk] != null) {
          flat[fk] = reverseDisplayValue(fk, flat[fk]);
        }
      }
      return flat;
    });

    res.json({
      success: true,
      count: flatRecipients.length,
      recipients: flatRecipients
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

    // company_user는 본인 store_codes 데이터 기준 옵션만
    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    let scopeWhere = 'company_id = $1 AND is_active = true';
    const scopeParams: any[] = [companyId];
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        scopeWhere += ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
        scopeParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({ grades: [], regions: [], storeNames: [], customFieldKeys: [] });
      }
    }

    // ★ D83: genders 추가 — 성별도 dropdown으로 제공 (contains 검색 시 필터 무시 버그 방지)
    const gendersResult = await query(
      `SELECT DISTINCT gender FROM customers WHERE ${scopeWhere} AND gender IS NOT NULL AND gender != '' ORDER BY gender`,
      scopeParams
    );
    const gradesResult = await query(
      `SELECT DISTINCT grade FROM customers WHERE ${scopeWhere} AND grade IS NOT NULL AND grade != '' ORDER BY grade`,
      scopeParams
    );
    const regionsResult = await query(
      `SELECT DISTINCT region FROM customers WHERE ${scopeWhere} AND region IS NOT NULL AND region != '' ORDER BY region`,
      scopeParams
    );

    // ★ 브랜드(store_code) 목록 — 고객사관리자/슈퍼관리자가 브랜드 필터에 사용
    let storeCodes: string[] = [];
    if (userType === 'company_admin' || userType === 'super_admin') {
      const storeResult = await query(
        `SELECT DISTINCT store_code FROM customer_stores WHERE company_id = $1 AND store_code IS NOT NULL AND store_code != '' ORDER BY store_code`,
        [companyId]
      );
      storeCodes = storeResult.rows.map((r: any) => r.store_code);
    }

    res.json({
      genders: gendersResult.rows.map((r: any) => r.gender),
      grades: gradesResult.rows.map((r: any) => r.grade),
      regions: regionsResult.rows.map((r: any) => r.region),
      store_codes: storeCodes,
    });
  } catch (error) {
    console.error('필터 옵션 조회 에러:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// GET /api/customers/enabled-fields - 회사별 전체 필드 + 커스텀 필드 + 샘플 데이터
// ★ CT-18 detectEnabledFields 단일 진입점 — 하드코딩 금지
router.get('/enabled-fields', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다' });

    // 데이터 범위: company_user는 본인 store_codes만, 그 외는 회사 전체
    // ★ B16-01: store_codes 없는 company_user → 빈 필드 반환
    let scopeWhere = 'company_id = $1 AND is_active = true';
    const scopeParams: any[] = [companyId];
    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        scopeWhere += ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
        scopeParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({ fields: [] });
      }
    }

    // ★ CT-18: 활성 필드 탐지 단일 진입점
    const { fields } = await detectEnabledFields({ companyId, scopeWhere, scopeParams });

    // 3. 드롭다운 옵션 (실제 DB 값 기반 — 동적 감지)
    // 고카디널리티 필드 제외 (이름, 전화번호, 이메일, 주소는 DISTINCT 의미 없음)
    const HIGH_CARDINALITY = ['name', 'phone', 'email', 'address'];
    const options: Record<string, string[]> = {};

    // 3-1. 직접 컬럼 string 필드 → DISTINCT 조회
    for (const f of fields) {
      if (f.is_custom || f.data_type !== 'string' || HIGH_CARDINALITY.includes(f.field_key)) continue;
      const mapped = getFieldByKey(f.field_key);
      const col = mapped?.columnName || f.field_key;
      try {
        const optResult = await query(
          `SELECT DISTINCT ${col} FROM customers WHERE ${scopeWhere} AND ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col} LIMIT 100`,
          scopeParams
        );
        if (optResult.rows.length > 0 && optResult.rows.length <= 100) {
          options[f.field_key] = optResult.rows.map((r: any) => r[col]);
        }
      } catch (e) { /* 컬럼 없으면 무시 */ }
    }

    // 3-2. 커스텀 필드 (JSONB) string 타입 → DISTINCT 조회
    for (const f of fields) {
      if (!f.is_custom || f.data_type !== 'string') continue;
      try {
        const optResult = await query(
          `SELECT DISTINCT custom_fields->>'${f.field_key}' as val FROM customers WHERE ${scopeWhere} AND custom_fields->>'${f.field_key}' IS NOT NULL AND custom_fields->>'${f.field_key}' != '' ORDER BY val LIMIT 100`,
          scopeParams
        );
        if (optResult.rows.length > 0 && optResult.rows.length <= 100) {
          options[f.field_key] = optResult.rows.map((r: any) => r.val);
        }
      } catch (e) { /* 커스텀 필드 옵션 조회 실패 무시 */ }
    }

    // 4. 실제 고객 1건 샘플 데이터 (AI 맞춤한줄 미리보기용)
    // ★ B+0407-1: enum 필드(gender F→여성) 미리 변환 — 모든 frontend 표시 경로 자동 정상화
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
        for (const f of fields) {
          const key = f.field_key;
          const mapped = getFieldByKey(key);
          let val: any;
          if (mapped?.storageType === 'custom_fields' && row.custom_fields && row.custom_fields[key] != null) {
            val = row.custom_fields[key];
          } else if (!mapped && row.custom_fields && row.custom_fields[key] != null) {
            // FIELD_MAP에 없는 커스텀 필드 (레거시 등)
            val = row.custom_fields[key];
          } else if (row[key] != null) {
            val = row[key];
          } else {
            continue;
          }
          // ★ B+0407-1: enum 필드 한글 역변환 (gender 'F' → '여성')
          if (FIELD_DISPLAY_MAP[key]) {
            sample[key] = reverseDisplayValue(key, val);
          } else {
            sample[key] = val;
          }
        }
      }
    } catch (e) { /* 샘플 조회 실패 시 빈 객체 */ }

    // ★ D103: 전화번호 형태 필드 동적 감지 — 개별회신번호 드롭다운용
    let phoneFields: string[] = [];
    try {
      // FIELD_MAP에서 normalizeFunction이 전화번호 관련인 필드는 무조건 포함 (데이터 없어도)
      const knownPhoneKeys = FIELD_MAP.filter(f =>
        f.normalizeFunction === 'normalizePhone' || f.normalizeFunction === 'normalizeStorePhone'
      ).map(f => f.fieldKey).filter(k => k !== 'phone'); // phone(수신자번호) 제외

      // 이미 enabled된 필드 중 기본 전화번호 필드
      const enabledKnown = knownPhoneKeys.filter(k => fields.some((f: any) => f.field_key === k));

      // 커스텀 필드는 실제 데이터 샘플링으로 판별 (최대 10건)
      const phoneSampleResult = await query(
        `SELECT custom_fields, store_phone FROM customers WHERE ${scopeWhere} AND custom_fields IS NOT NULL AND custom_fields != '{}' LIMIT 10`,
        scopeParams
      );
      const customPhoneFields = detectPhoneFields(
        phoneSampleResult.rows,
        fields.filter((f: any) => f.is_custom),
      );

      phoneFields = [...new Set([...enabledKnown, ...customPhoneFields.map(f => f.field_key)])];
    } catch (e) { /* phone_fields 감지 실패 시 빈 배열 */ }

    res.json({ fields, options, sample, categories: CATEGORY_LABELS, phoneFields });
  } catch (error) {
    console.error('활성 필드 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// ====== 고객 삭제 API ======

// DELETE /api/customers/:id - 개별 삭제 (고객사관리자, 슈퍼관리자만)
router.delete('/:id', blockIfSyncActive, async (req: Request, res: Response) => {
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
router.post('/bulk-delete', blockIfSyncActive, async (req: Request, res: Response) => {
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
router.post('/delete-all', blockIfSyncActive, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    // ★ D144 P5 (2026-05-06): company_admin도 자기 회사 전체 삭제 가능
    //   - super_admin: 임의 회사 (targetCompanyId)
    //   - company_admin: 자기 회사만 (targetCompanyId 무시, 본인 companyId 강제)
    if (userType !== 'super_admin' && userType !== 'company_admin') {
      return res.status(403).json({ error: '관리자만 전체 삭제가 가능합니다' });
    }

    const { targetCompanyId, confirmCompanyName } = req.body;
    // company_admin은 자기 companyId 강제 (다른 회사 삭제 시도 차단)
    const deleteCompanyId = userType === 'company_admin'
      ? companyId
      : (targetCompanyId || companyId);

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

    // ★ D114 P1: 수신거부 + 필드 정의 + customer_schema + customer_stores 정리
    // 고객 전체삭제 시 customer_field_definitions가 잔존하면 다음 업로드에서 매핑 충돌 오감지
    await query('DELETE FROM unsubscribes WHERE company_id = $1', [deleteCompanyId]);
    await query('DELETE FROM customer_field_definitions WHERE company_id = $1', [deleteCompanyId]);
    await query('DELETE FROM customer_stores WHERE company_id = $1', [deleteCompanyId]);
    await query(`UPDATE companies SET customer_schema = '{}'::jsonb WHERE id = $1`, [deleteCompanyId]);

    // 고객 전체 삭제
    const deleteResult = await query('DELETE FROM customers WHERE company_id = $1', [deleteCompanyId]);

    // ★ 2026-06-25: 고객 0건이 됐으므로 데이터 프로필 캐시 무효화 → 게이트 즉시 재표시
    clearCompanyDataProfileCache(deleteCompanyId);

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
// ★ 2026-07-03: 고객별 구매 이력 조회 — 구매 데이터를 눈으로 볼 화면 부재(직원 요청)
//   구매=돈 데이터라 B16-01 매장 스코프(목록 GET /와 동일 격리) 적용. LIMIT/OFFSET는 id DESC tie-breaker 필수(D150-4).
router.get('/:id/purchases', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    const { id } = req.params;
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }
    // 비-uuid는 PG 22P02(500) 전에 404로 차단
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: '고객을 찾을 수 없습니다.' });
    }

    const pageRaw = Number(req.query.page);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(Math.floor(pageRaw), 100000) : 1;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 100) : 20;
    const offset = (page - 1) * limit;

    // ★ B16-01: company_user 브랜드(store_code) 격리 — 목록 라우트와 동일 패턴
    let scopeClause = '';
    const custParams: any[] = [id, companyId];
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'blocked') {
        return res.status(404).json({ error: '고객을 찾을 수 없습니다.' });
      }
      if (scope.type === 'filtered') {
        scopeClause = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $2 AND store_code = ANY($3::text[]))';
        custParams.push(scope.storeCodes);
      }
    }

    const cust = await query(
      `SELECT id, name, phone FROM customers WHERE id = $1 AND company_id = $2 AND is_active = true${scopeClause}`,
      custParams
    );
    if (cust.rows.length === 0) {
      return res.status(404).json({ error: '고객을 찾을 수 없습니다.' });
    }

    const [summary, list] = await Promise.all([
      query(
        'SELECT COUNT(*)::int AS total_count, COALESCE(SUM(total_amount), 0) AS total_amount FROM purchases WHERE customer_id = $1 AND company_id = $2',
        [id, companyId]
      ),
      query(
        `SELECT TO_CHAR(purchase_date, 'YYYY-MM-DD') AS purchase_date, total_amount, quantity, store_code, store_name
         FROM purchases
         WHERE customer_id = $1 AND company_id = $2
         ORDER BY purchase_date DESC, id DESC
         LIMIT $3 OFFSET $4`,
        [id, companyId, limit, offset]
      ),
    ]);

    const totalCount = summary.rows[0]?.total_count || 0;
    res.json({
      customer: cust.rows[0],
      summary: { totalCount, totalAmount: Number(summary.rows[0]?.total_amount || 0) },
      purchases: list.rows,
      pagination: { total: totalCount, page, limit, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (error) {
    console.error('고객 구매 이력 조회 에러:', error);
    res.status(500).json({ error: '구매 이력 조회 실패' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const { id } = req.params;

    // ★ B17-01: 수신거부 user_id 기준 통일
    const result = await query(
      `SELECT c.*,
              CASE WHEN EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $3 AND u.phone = c.phone)
                   THEN false ELSE c.sms_opt_in END as sms_opt_in,
              EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $3 AND u.phone = c.phone) as is_unsubscribed
       FROM customers_unified c WHERE c.id = $1 AND c.company_id = $2 AND c.is_active = true`,
      [id, companyId, userId]
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

// ============================================================
// ★ D219+ Part 2 후속 (2026-05-27): 자연어 → CT-01 호환 filter 변환 + 매칭 미리보기
//   DirectTargetFilterModal AI 자연어 모드 + 향후 다른 메뉴 (AI 한줄로, Journey 등) 재활용 가능.
//   게이팅 = ai_messaging (BASIC+) — AI 자연어 변환 기능 한정.
//   본 endpoint = CT-97 generateSegmentFromNaturalLanguage 호출 + CT-01 호환 검증 + 미리보기.
//   책임소재 영역 정합 (Harold 명시 2026-05-27): "단 1의 오차도 없는 타겟 추출 의무".
// ============================================================

/**
 * POST /api/customers/generate-from-text
 * body: { naturalLanguage: string, customFieldKeys?: string[] }
 * 응답: { filter, explanation, matchCount, samples }
 */
router.post(
  '/generate-from-text',
  requirePlanFeature('ai_messaging'),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.user?.companyId;
      if (!companyId) {
        return res.status(401).json({ success: false, error: '인증 필요' });
      }
      const { naturalLanguage, customFieldKeys } = req.body as {
        naturalLanguage: string;
        customFieldKeys?: string[];
      };
      if (!naturalLanguage?.trim()) {
        return res.status(400).json({ success: false, error: '자연어 입력이 필요합니다.' });
      }

      const result = await generateSegmentFromNaturalLanguage({
        companyId,
        naturalLanguage,
        customFieldKeys: Array.isArray(customFieldKeys) ? customFieldKeys : undefined,
      });

      return res.json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof SegmentGenerationError) {
        // ZERO_MATCH / FILTER_VALIDATION_FAILED 등 사용자 안내 오류 = 400
        return res.status(400).json({ success: false, code: err.code, error: err.message });
      }
      console.error('[customers/generate-from-text] 실패:', err);
      return res.status(500).json({ success: false, error: 'AI 세그먼트 생성 실패' });
    }
  },
);

export default router;