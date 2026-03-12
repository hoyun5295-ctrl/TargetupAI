/**
 * customer-filter.ts — 고객 필터/쿼리 빌더 컨트롤타워 (CT-01)
 *
 * 유일한 필터 WHERE 절 생성기. campaigns.ts, customers.ts, ai.ts 3곳의
 * 중복 필터 빌더를 이 파일 하나로 통합.
 *
 * 설계 원칙:
 * - 기존 3곳이 생성하던 SQL과 100% 동일한 결과를 생성
 * - tableAlias 옵션으로 'c.' 접두사 유무 제어 (campaigns.ts용)
 * - store_code는 호출부마다 다르므로 "호출부 위임" (skipStoreCode 옵션)
 * - 입력 형식: scalar 값과 {operator, value} 객체 모두 지원
 * - 나이 계산: KST 기준으로 통일 (campaigns.ts 방식)
 * - days_within: parameterized query로 SQL injection 방지
 * - 커스텀 필드: 8개 연산자 전부 지원 (customers.ts 기준)
 */

import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getRegionVariants } from './normalize';
import { isValidCustomFieldKey } from './safe-field-name';

// ============================================================
// 타입 정의
// ============================================================

export interface FilterResult {
  sql: string;
  params: any[];
  nextIndex: number;
}

export interface FilterOptions {
  /** 테이블 alias 접두사. campaigns.ts는 'c', 나머지는 '' */
  tableAlias?: string;
  /** 파라미터 시작 인덱스 ($1, $2, ...) */
  startParamIndex: number;
  /**
   * store_code 처리 방식:
   * - 'skip': 호출부에서 직접 처리 (기본값)
   * - 'direct': WHERE store_code = $X (campaigns.ts 방식)
   * - 'subquery': WHERE id IN (SELECT ... FROM customer_stores) (customers.ts 방식, companyIdParamRef 필요)
   */
  storeCodeMode?: 'skip' | 'direct' | 'subquery';
  /** subquery 모드에서 company_id 파라미터 참조 (예: '$1') */
  companyIdParamRef?: string;
  /**
   * 입력 형식:
   * - 'mixed': scalar + {value, operator} 혼합 지원 (campaigns.ts, ai.ts 방식)
   * - 'structured': 항상 {operator, value} 형식 (customers.ts 방식)
   */
  inputFormat?: 'mixed' | 'structured';
}

// ============================================================
// 내부 헬퍼
// ============================================================

/** scalar 또는 {value, operator} 객체에서 값 추출 (campaigns.ts/ai.ts 호환) */
function getValue(field: any): any {
  if (field === null || field === undefined) return null;
  if (typeof field === 'object' && field.value !== undefined) return field.value;
  return field;
}

/** 컬럼명에 테이블 alias 접두사 적용 */
function col(alias: string, column: string): string {
  return alias ? `${alias}.${column}` : column;
}

// ============================================================
// 숫자 필드 목록 (customers.ts 기준 — 가장 완전)
// ============================================================
const NUMERIC_FIELDS = [
  'points', 'total_purchase_amount', 'recent_purchase_amount',
  'purchase_count', 'avg_order_value', 'ltv_score',
  'visit_count', 'coupon_usage_count', 'return_count',
];

// ============================================================
// 날짜 필드 목록
// ============================================================
const DATE_FIELDS = ['birth_date', 'recent_purchase_date', 'created_at'];

// ============================================================
// 문자열 직접 컬럼 필드 목록
// ============================================================
const STRING_FIELDS = [
  'name', 'email', 'address', 'registration_type',
  'registered_store', 'recent_purchase_store', 'store_phone',
];

// ============================================================
// 메인 함수: buildCustomerFilter
// ============================================================

/**
 * 필터 객체를 SQL WHERE 절 (AND ...) 문자열로 변환.
 *
 * @param filters - 필터 객체 (프론트엔드 또는 AI에서 전달)
 * @param options - 필터 빌드 옵션
 * @returns {sql, params, nextIndex}
 */
export function buildCustomerFilter(filters: any, options: FilterOptions): FilterResult {
  const {
    tableAlias = '',
    startParamIndex,
    storeCodeMode = 'skip',
    companyIdParamRef = '$1',
    inputFormat = 'mixed',
  } = options;

  let sql = '';
  const params: any[] = [];
  let paramIndex = startParamIndex;
  const alias = tableAlias;

  if (!filters || (typeof filters !== 'object')) {
    return { sql: '', params: [], nextIndex: paramIndex };
  }

  // ────────────────────────────────────────────────
  // structured 형식 (customers.ts 방식): {field: {operator, value}}
  // ────────────────────────────────────────────────
  if (inputFormat === 'structured') {
    for (const [field, condition] of Object.entries(filters)) {
      if (!condition || typeof condition !== 'object') continue;

      const { operator, value } = condition as { operator: string; value: any };
      if (value === undefined || value === null || value === '') continue;

      // ── 기본 필드 (gender, grade, sms_opt_in, region) ──
      if (['gender', 'grade', 'sms_opt_in', 'region'].includes(field)) {
        if (operator === 'eq') {
          if (field === 'gender') {
            const gf = buildGenderFilter(String(value), paramIndex);
            sql += gf.sql;
            params.push(...gf.params);
            paramIndex = gf.nextIndex;
          } else if (field === 'grade') {
            const grf = buildGradeFilter(String(value), paramIndex);
            sql += grf.sql;
            params.push(...grf.params);
            paramIndex = grf.nextIndex;
          } else if (field === 'region') {
            const rf = buildRegionFilter(String(value), paramIndex);
            sql += rf.sql;
            params.push(...rf.params);
            paramIndex = rf.nextIndex;
          } else {
            // sms_opt_in 등
            sql += ` AND ${col(alias, field)} = $${paramIndex++}`;
            params.push(value);
          }
        } else if (operator === 'in' && Array.isArray(value)) {
          const placeholders = value.map(() => `$${paramIndex++}`).join(', ');
          sql += ` AND ${col(alias, field)} IN (${placeholders})`;
          params.push(...value);
        }

      // ── store_code ──
      } else if (field === 'store_code' && storeCodeMode !== 'skip') {
        if (storeCodeMode === 'subquery') {
          if (operator === 'eq') {
            sql += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = ${companyIdParamRef} AND store_code = $${paramIndex++})`;
            params.push(value);
          } else if (operator === 'in' && Array.isArray(value)) {
            sql += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = ${companyIdParamRef} AND store_code = ANY($${paramIndex++}::text[]))`;
            params.push(value);
          }
        } else if (storeCodeMode === 'direct') {
          if (operator === 'eq') {
            sql += ` AND ${col(alias, 'store_code')} = $${paramIndex++}`;
            params.push(value);
          } else if (operator === 'in' && Array.isArray(value)) {
            sql += ` AND ${col(alias, 'store_code')} = ANY($${paramIndex++}::text[])`;
            params.push(value);
          }
        }

      // ── store_name ──
      } else if (field === 'store_name') {
        if (operator === 'eq') {
          sql += ` AND ${col(alias, 'store_name')} = $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'in' && Array.isArray(value)) {
          sql += ` AND ${col(alias, 'store_name')} = ANY($${paramIndex++}::text[])`;
          params.push(value);
        }

      // ── 숫자 필드 ──
      } else if (NUMERIC_FIELDS.includes(field)) {
        if (operator === 'eq') {
          sql += ` AND ${col(alias, field)} = $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'gte') {
          sql += ` AND ${col(alias, field)} >= $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'lte') {
          sql += ` AND ${col(alias, field)} <= $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'between' && Array.isArray(value)) {
          sql += ` AND ${col(alias, field)} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
          params.push(Number(value[0]), Number(value[1]));
        }

      // ── 날짜 필드 ──
      } else if (DATE_FIELDS.includes(field)) {
        if (operator === 'gte') {
          sql += ` AND ${col(alias, field)} >= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'lte') {
          sql += ` AND ${col(alias, field)} <= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'between' && Array.isArray(value)) {
          sql += ` AND ${col(alias, field)} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
          params.push(value[0], value[1]);
        } else if (operator === 'days_within') {
          // ★ SQL injection 방지: parameterized (campaigns.ts 기존 string interpolation 수정)
          const daysAgo = new Date();
          daysAgo.setDate(daysAgo.getDate() - parseInt(value));
          sql += ` AND ${col(alias, field)} >= $${paramIndex++}`;
          params.push(daysAgo.toISOString().split('T')[0]);
        } else if (operator === 'birth_month') {
          sql += ` AND EXTRACT(MONTH FROM ${col(alias, field)}) = $${paramIndex++}`;
          params.push(parseInt(value));
        }

      // ── age (직접 컬럼) ──
      } else if (field === 'age') {
        if (operator === 'gte') {
          sql += ` AND ${col(alias, 'age')} >= $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'lte') {
          sql += ` AND ${col(alias, 'age')} <= $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'between' && Array.isArray(value)) {
          sql += ` AND ${col(alias, 'age')} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
          params.push(Number(value[0]), Number(value[1]));
        }

      // ── 문자열 필드 ──
      } else if (STRING_FIELDS.includes(field)) {
        if (operator === 'eq') {
          sql += ` AND ${col(alias, field)} = $${paramIndex++}`;
          params.push(String(value));
        } else if (operator === 'in' && Array.isArray(value)) {
          const placeholders = value.map(() => `$${paramIndex++}`).join(', ');
          sql += ` AND ${col(alias, field)} IN (${placeholders})`;
          params.push(...value.map(String));
        } else if (operator === 'contains') {
          sql += ` AND ${col(alias, field)} ILIKE $${paramIndex++}`;
          params.push(`%${value}%`);
        }

      // ── 커스텀 필드 (JSONB) — 화이트리스트 검증 ──
      } else {
        if (!isValidCustomFieldKey(field)) continue;
        const cfCol = `custom_fields->>'${field}'`;

        if (operator === 'eq') {
          sql += ` AND ${cfCol} = $${paramIndex++}`;
          params.push(String(value));
        } else if (operator === 'gte') {
          sql += ` AND (${cfCol})::numeric >= $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'lte') {
          sql += ` AND (${cfCol})::numeric <= $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'between' && Array.isArray(value)) {
          sql += ` AND (${cfCol})::numeric BETWEEN $${paramIndex++} AND $${paramIndex++}`;
          params.push(Number(value[0]), Number(value[1]));
        } else if (operator === 'in' && Array.isArray(value)) {
          const placeholders = value.map(() => `$${paramIndex++}`).join(', ');
          sql += ` AND ${cfCol} IN (${placeholders})`;
          params.push(...value.map(String));
        } else if (operator === 'contains') {
          sql += ` AND ${cfCol} ILIKE $${paramIndex++}`;
          params.push(`%${value}%`);
        } else if (operator === 'date_gte') {
          sql += ` AND (${cfCol})::date >= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'date_lte') {
          sql += ` AND (${cfCol})::date <= $${paramIndex++}`;
          params.push(value);
        }
      }
    }

    return { sql, params, nextIndex: paramIndex };
  }

  // ────────────────────────────────────────────────
  // mixed 형식 (campaigns.ts, ai.ts 방식): scalar 또는 {value, operator}
  // ────────────────────────────────────────────────

  // gender (normalize.ts 변형값 매칭)
  // ★ normalize 헬퍼가 alias를 받지 않으므로 gender/grade/region은 alias 미적용
  // ★ campaigns.ts 원본은 raw 값을 그대로 buildGenderFilter에 넘김 (사전 정규화 없음)
  const gender = getValue(filters.gender);
  if (gender) {
    const genderResult = buildGenderFilter(gender, paramIndex);
    sql += genderResult.sql;
    params.push(...genderResult.params);
    paramIndex = genderResult.nextIndex;
  }

  // age (배열: [30, 39]) — ★ structured 모드와 동일하게 age 컬럼 직접 사용
  // ★ birth_year는 NULL인 경우가 많아 age 컬럼 기반으로 통일 (B16-06 수정)
  const age = getValue(filters.age);
  if (age && Array.isArray(age) && age.length === 2) {
    sql += ` AND ${col(alias, 'age')} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
    params.push(Number(age[0]), Number(age[1]));
  }

  // minAge/maxAge (기존 호환) — age 컬럼 직접 사용으로 통일
  const minAge = getValue(filters.minAge) || getValue(filters.min_age);
  if (minAge) {
    sql += ` AND ${col(alias, 'age')} >= $${paramIndex++}`;
    params.push(Number(minAge));
  }
  const maxAge = getValue(filters.maxAge) || getValue(filters.max_age);
  if (maxAge) {
    sql += ` AND ${col(alias, 'age')} <= $${paramIndex++}`;
    params.push(Number(maxAge));
  }

  // grade (normalize.ts 변형값 매칭) — alias 미적용 (헬퍼가 직접 생성)
  const gradeFilter = filters.grade;
  const grade = getValue(gradeFilter);
  if (grade) {
    const gradeOp = gradeFilter?.operator || 'eq';
    if (gradeOp === 'in' && Array.isArray(grade)) {
      const gradeResult = buildGradeFilter(grade, paramIndex);
      sql += gradeResult.sql;
      params.push(...gradeResult.params);
      paramIndex = gradeResult.nextIndex;
    } else {
      const gradeResult = buildGradeFilter(String(grade), paramIndex);
      sql += gradeResult.sql;
      params.push(...gradeResult.params);
      paramIndex = gradeResult.nextIndex;
    }
  }

  // region (normalize.ts 변형값 매칭) — alias 미적용 (헬퍼가 직접 생성)
  const regionFilter = filters.region;
  const region = getValue(regionFilter);
  if (region) {
    const regionOp = regionFilter?.operator || 'eq';
    if (regionOp === 'in' && Array.isArray(region)) {
      const allVariants = (region as string[]).flatMap(r => getRegionVariants(r));
      sql += ` AND region = ANY($${paramIndex++}::text[])`;
      params.push(allVariants);
    } else {
      const regionResult = buildRegionFilter(String(region), paramIndex);
      sql += regionResult.sql;
      params.push(...regionResult.params);
      paramIndex = regionResult.nextIndex;
    }
  }

  // points
  const pointsFilter = filters.points;
  const points = getValue(pointsFilter);
  if (points !== null && points !== undefined) {
    const pointsOp = pointsFilter?.operator || 'gte';
    if (pointsOp === 'gte') {
      sql += ` AND ${col(alias, 'points')} >= $${paramIndex++}`;
      params.push(Number(points));
    } else if (pointsOp === 'lte') {
      sql += ` AND ${col(alias, 'points')} <= $${paramIndex++}`;
      params.push(Number(points));
    } else if (pointsOp === 'between' && Array.isArray(points)) {
      sql += ` AND ${col(alias, 'points')} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      params.push(Number(points[0]), Number(points[1]));
    }
  }

  // total_purchase_amount
  const purchaseFilter = filters.total_purchase_amount;
  const purchaseAmt = getValue(purchaseFilter);
  if (purchaseAmt !== null && purchaseAmt !== undefined) {
    const purchaseOp = purchaseFilter?.operator || 'gte';
    if (purchaseOp === 'gte') {
      sql += ` AND ${col(alias, 'total_purchase_amount')} >= $${paramIndex++}`;
      params.push(Number(purchaseAmt));
    } else if (purchaseOp === 'lte') {
      sql += ` AND ${col(alias, 'total_purchase_amount')} <= $${paramIndex++}`;
      params.push(Number(purchaseAmt));
    } else if (purchaseOp === 'between' && Array.isArray(purchaseAmt)) {
      sql += ` AND ${col(alias, 'total_purchase_amount')} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      params.push(Number(purchaseAmt[0]), Number(purchaseAmt[1]));
    }
  }

  // recent_purchase_date — ★ days_within parameterized (SQL injection 수정)
  const recentDateFilter = filters.recent_purchase_date;
  const recentDate = getValue(recentDateFilter);
  if (recentDate) {
    const dateOp = recentDateFilter?.operator || 'days_within';
    if (dateOp === 'days_within') {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(recentDate));
      sql += ` AND ${col(alias, 'recent_purchase_date')} >= $${paramIndex++}`;
      params.push(daysAgo.toISOString().split('T')[0]);
    } else if (dateOp === 'gte') {
      sql += ` AND ${col(alias, 'recent_purchase_date')} >= $${paramIndex++}`;
      params.push(recentDate);
    } else if (dateOp === 'lte') {
      sql += ` AND ${col(alias, 'recent_purchase_date')} <= $${paramIndex++}`;
      params.push(recentDate);
    }
  }

  // birth_date (mixed 형식) — birth_month 연산자 지원
  const birthDateFilter = filters.birth_date;
  const birthDate = getValue(birthDateFilter);
  if (birthDate !== null && birthDate !== undefined) {
    const birthOp = birthDateFilter?.operator || 'birth_month';
    if (birthOp === 'birth_month') {
      sql += ` AND EXTRACT(MONTH FROM ${col(alias, 'birth_date')}) = $${paramIndex++}`;
      params.push(parseInt(birthDate));
    } else if (birthOp === 'gte') {
      sql += ` AND ${col(alias, 'birth_date')} >= $${paramIndex++}`;
      params.push(birthDate);
    } else if (birthOp === 'lte') {
      sql += ` AND ${col(alias, 'birth_date')} <= $${paramIndex++}`;
      params.push(birthDate);
    } else if (birthOp === 'between' && Array.isArray(birthDate)) {
      sql += ` AND ${col(alias, 'birth_date')} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      params.push(birthDate[0], birthDate[1]);
    }
  }

  // store_code (mixed 형식) — storeCodeMode에 따라 처리
  if (storeCodeMode !== 'skip') {
    const storeCode = getValue(filters.store_code);
    if (storeCode) {
      const storeOp = filters.store_code?.operator || 'eq';
      if (storeCodeMode === 'direct') {
        if (storeOp === 'in' && Array.isArray(storeCode)) {
          sql += ` AND ${col(alias, 'store_code')} = ANY($${paramIndex++}::text[])`;
          params.push(storeCode);
        } else {
          sql += ` AND ${col(alias, 'store_code')} = $${paramIndex++}`;
          params.push(storeCode);
        }
      }
      // subquery 모드는 mixed 형식에서도 지원
      if (storeCodeMode === 'subquery') {
        if (storeOp === 'in' && Array.isArray(storeCode)) {
          sql += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = ${companyIdParamRef} AND store_code = ANY($${paramIndex++}::text[]))`;
          params.push(storeCode);
        } else {
          sql += ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = ${companyIdParamRef} AND store_code = $${paramIndex++})`;
          params.push(storeCode);
        }
      }
    }
  }

  // store_name (mixed 형식)
  const storeNameFilter = filters.store_name;
  const storeName = getValue(storeNameFilter);
  if (storeName) {
    const storeOp = storeNameFilter?.operator || 'eq';
    if (storeOp === 'in' && Array.isArray(storeName)) {
      sql += ` AND ${col(alias, 'store_name')} = ANY($${paramIndex++}::text[])`;
      params.push(storeName);
    } else {
      sql += ` AND ${col(alias, 'store_name')} = $${paramIndex++}`;
      params.push(storeName);
    }
  }

  // custom_fields (JSONB) — 화이트리스트 검증, 8개 연산자 전부 지원
  Object.keys(filters).forEach(key => {
    if (key.startsWith('custom_fields.')) {
      const fieldName = key.replace('custom_fields.', '');
      if (!isValidCustomFieldKey(fieldName)) return;
      const condition = filters[key];
      const value = getValue(condition);
      const operator = condition?.operator || 'eq';

      if (value !== null && value !== undefined) {
        const cfCol = `custom_fields->>'${fieldName}'`;

        if (operator === 'eq') {
          sql += ` AND ${cfCol} = $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'gte') {
          sql += ` AND (${cfCol})::numeric >= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'lte') {
          sql += ` AND (${cfCol})::numeric <= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'between' && Array.isArray(value)) {
          sql += ` AND (${cfCol})::numeric BETWEEN $${paramIndex++} AND $${paramIndex++}`;
          params.push(Number(value[0]), Number(value[1]));
        } else if (operator === 'in' && Array.isArray(value)) {
          sql += ` AND ${cfCol} = ANY($${paramIndex++})`;
          params.push(value);
        } else if (operator === 'contains') {
          sql += ` AND ${cfCol} ILIKE $${paramIndex++}`;
          params.push(`%${value}%`);
        } else if (operator === 'date_gte') {
          sql += ` AND (${cfCol})::date >= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'date_lte') {
          sql += ` AND (${cfCol})::date <= $${paramIndex++}`;
          params.push(value);
        }
      }
    }
  });

  return { sql, params, nextIndex: paramIndex };
}

// ============================================================
// 하위 호환 래퍼 함수 (교체 단계에서 기존 시그니처 유지용)
// ============================================================

/**
 * campaigns.ts 호환 래퍼.
 * 기존 시그니처: buildFilterQuery(filter, companyId) → {where, params}
 * 통합 시그니처: buildCustomerFilter(filter, options) → {sql, params, nextIndex}
 *
 * ★ 기존과 동일한 SQL 생성을 보장하되, nextIndex도 리턴하여 체이닝 가능.
 * ★ store_code는 'direct' 모드 + alias 'c' 사용.
 */
export function buildFilterQueryCompat(filter: any, _companyId: string): { where: string; params: any[]; nextIndex: number } {
  const result = buildCustomerFilter(filter, {
    tableAlias: 'c',
    startParamIndex: 2,  // campaigns.ts는 항상 $1 = companyId
    storeCodeMode: 'direct',
    inputFormat: 'mixed',
  });
  return { where: result.sql, params: result.params, nextIndex: result.nextIndex };
}

/**
 * customers.ts 호환 래퍼.
 * 기존 시그니처: buildDynamicFilter(filters, startIndex) → {where, params, nextIndex}
 * ★ store_code는 'subquery' 모드.
 */
export function buildDynamicFilterCompat(filters: any, startIndex: number): { where: string; params: any[]; nextIndex: number } {
  const result = buildCustomerFilter(filters, {
    tableAlias: '',
    startParamIndex: startIndex,
    storeCodeMode: 'subquery',
    companyIdParamRef: '$1',
    inputFormat: 'structured',
  });
  return { where: result.sql, params: result.params, nextIndex: result.nextIndex };
}

/**
 * ai.ts 호환 래퍼.
 * 기존 시그니처: buildFilterWhereClause(filters, startParamIndex) → {sql, params, nextIndex}
 * ★ ai.ts 원본은 gender를 사전 정규화(남→M, 여→F)한 후 buildGenderFilter에 넘김.
 *   campaigns.ts는 raw 그대로 넘기므로, 여기서 사전 정규화를 적용.
 * ★ store_code는 'skip' (ai.ts에서는 store_code 미사용).
 */
export function buildFilterWhereClauseCompat(filters: any, startParamIndex: number): FilterResult {
  // ai.ts 원본의 gender 사전 정규화 적용
  if (filters?.gender) {
    const rawGender = typeof filters.gender === 'object' && filters.gender.value !== undefined
      ? filters.gender.value : filters.gender;
    if (rawGender) {
      const standardGender = String(rawGender).toLowerCase();
      const genderKey = ['m', 'male', '남', '남자', '남성'].includes(standardGender) ? 'M'
        : ['f', 'female', '여', '여자', '여성'].includes(standardGender) ? 'F' : rawGender;
      // gender 값을 정규화된 키로 교체 (원본 필터 객체 변경 방지를 위해 얕은 복사)
      filters = { ...filters, gender: genderKey };
    }
  }

  return buildCustomerFilter(filters, {
    tableAlias: '',
    startParamIndex,
    storeCodeMode: 'skip',
    inputFormat: 'mixed',
  });
}
