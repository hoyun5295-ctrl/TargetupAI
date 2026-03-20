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

import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getRegionVariants, normalizeDate } from './normalize';
import { isValidCustomFieldKey } from './safe-field-name';
import { getColumnFields } from './standard-field-map';

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

/** 값이 날짜 패턴인지 감지 (YYYY-MM-DD 또는 YYYYMMDD) — 커스텀필드 캐스팅 자동 전환용 */
function isDateLikeValue(value: any): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{8}$/.test(s);
}

/** 컬럼명에 테이블 alias 접두사 적용 */
function col(alias: string, column: string): string {
  return alias ? `${alias}.${column}` : column;
}

/**
 * ★ D83: 날짜 필터값 안전 정규화 — normalize.ts 컨트롤타워 활용
 * 사용자가 "2025. 10. 19.", "3월" 등 비정상 형식을 입력해도 쿼리가 터지지 않도록 방어.
 * 정규화 성공 → YYYY-MM-DD 반환, 실패 → null 반환 (호출부에서 해당 필터 스킵)
 */
function safeDateValue(value: any): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  // 이미 ISO 형식이면 바로 반환
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // normalize.ts 컨트롤타워의 normalizeDate로 정규화 시도
  const normalized = normalizeDate(s);
  if (normalized) return normalized;
  // 정규화 실패 — 쿼리 에러 방지를 위해 null 반환
  console.warn(`[CT-01] 날짜 필터값 정규화 실패 (무시됨): "${s}"`);
  return null;
}

// ★ D83: NUMERIC_FIELDS, DATE_FIELDS, STRING_FIELDS 하드코딩 리스트 제거
// structured 모드에서 이 리스트에 의존하던 전용 핸들러를 삭제하고
// FIELD_MAP 동적 루프(getColumnFields() + dataType 기반)로 통일.
// 한줄로(mixed 모드)와 동일한 방식 — 새 필드 추가 시 FIELD_MAP만 수정하면 자동 반영.

/**
 * ★ D89: 문자열 contains 검색 시 구분자 정규화 헬퍼
 * - phone/store_phone: 하이픈(-) 제거 후 비교 (DB에 하이픈 없이 저장)
 * - address/recent_purchase_store/registered_store/store_name: 언더스코어(_)/공백 제거 후 비교
 * - 기타 문자열 필드: 그대로 ILIKE
 *
 * @returns { colExpr: SQL 컬럼 표현식, cleanValue: 정규화된 검색값 }
 */
const PHONE_FIELDS = new Set(['phone', 'store_phone']);
const SEPARATOR_FIELDS = new Set(['address', 'recent_purchase_store', 'registered_store', 'store_name']);

function normalizeContainsSearch(fieldKey: string, columnRef: string, value: string): { colExpr: string; cleanValue: string } {
  if (PHONE_FIELDS.has(fieldKey)) {
    return { colExpr: `REPLACE(${columnRef}, '-', '')`, cleanValue: String(value).replace(/-/g, '') };
  }
  if (SEPARATOR_FIELDS.has(fieldKey)) {
    return { colExpr: `REPLACE(REPLACE(${columnRef}, '_', ''), ' ', '')`, cleanValue: String(value).replace(/[_ ]/g, '') };
  }
  return { colExpr: columnRef, cleanValue: String(value) };
}

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
        // ★ D88: dropdown 선택 필드는 contains가 와도 eq로 자동 전환 (방어)
        const effectiveOp = (operator === 'contains') ? 'eq' : operator;
        if (effectiveOp === 'eq') {
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
          } else if (field === 'sms_opt_in') {
            // ★ D88: boolean 필드 — 문자열 'true'/'false' → 실제 boolean 변환
            const boolVal = String(value).toLowerCase() === 'true' || value === true;
            sql += ` AND ${col(alias, field)} = $${paramIndex++}`;
            params.push(boolVal);
          } else {
            sql += ` AND ${col(alias, field)} = $${paramIndex++}`;
            params.push(value);
          }
        } else if (effectiveOp === 'in' && Array.isArray(value)) {
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

      // ── store_name, 숫자 필드, 날짜 필드 ──
      // ★ D83: 전용 핸들러 전부 삭제 → FIELD_MAP 동적 루프(else 블록)에서 dataType 기반 자동 처리
      // 한줄로(mixed 모드)와 동일한 FIELD_MAP 동적 루프 방식으로 통일
      // 이전: NUMERIC_FIELDS/DATE_FIELDS 하드코딩 리스트 → 새 필드 추가 시 누락 위험

      // ── age (직접 컬럼 + birth_date 폴백) ──
      // ★ D79: age 컬럼이 NULL이어도 birth_date에서 나이 동적 계산
      } else if (field === 'age') {
        const ageExpr = `COALESCE(${col(alias, 'age')}, DATE_PART('year', AGE(${col(alias, 'birth_date')}))::int)`;
        if (operator === 'eq') {
          // ★ D83: 나이 일치 연산자 추가 (직원 리포트 — eq 시 전체 리스트 반환 버그)
          sql += ` AND ${ageExpr} = $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'gte') {
          sql += ` AND ${ageExpr} >= $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'lte') {
          sql += ` AND ${ageExpr} <= $${paramIndex++}`;
          params.push(Number(value));
        } else if (operator === 'between' && Array.isArray(value)) {
          sql += ` AND ${ageExpr} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
          params.push(Number(value[0]), Number(value[1]));
        }

      // ── FIELD_MAP 동적 처리 — 위 핸들러에 없는 직접 컬럼 필드를 dataType 기반으로 자동 처리 ──
      // ★ phone, name, email, address 등 STRING_FIELDS 하드코딩 없이 FIELD_MAP으로 통일
      } else {
        const fieldDef = getColumnFields().find(f => f.fieldKey === field);
        if (fieldDef) {
          const columnRef = col(alias, fieldDef.columnName);
          if (fieldDef.dataType === 'number') {
            if (operator === 'eq') { sql += ` AND ${columnRef} = $${paramIndex++}`; params.push(Number(value)); }
            else if (operator === 'gte') { sql += ` AND ${columnRef} >= $${paramIndex++}`; params.push(Number(value)); }
            else if (operator === 'lte') { sql += ` AND ${columnRef} <= $${paramIndex++}`; params.push(Number(value)); }
            else if (operator === 'between' && Array.isArray(value)) {
              sql += ` AND ${columnRef} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
              params.push(Number(value[0]), Number(value[1]));
            }
          } else if (fieldDef.dataType === 'date') {
            // ★ D83: safeDateValue 방어 — 비정상 날짜 입력 시 쿼리 에러 방지
            if (operator === 'days_within') {
              const days = parseInt(value);
              if (!isNaN(days)) {
                const daysAgo = new Date(); daysAgo.setDate(daysAgo.getDate() - days);
                sql += ` AND ${columnRef} >= $${paramIndex++}`; params.push(daysAgo.toISOString().split('T')[0]);
              }
            } else if (operator === 'birth_month') {
              const month = parseInt(value);
              if (!isNaN(month) && month >= 1 && month <= 12) {
                sql += ` AND EXTRACT(MONTH FROM ${columnRef}) = $${paramIndex++}`; params.push(month);
              }
            } else if (operator === 'gte') {
              const safe = safeDateValue(value);
              if (safe) { sql += ` AND ${columnRef} >= $${paramIndex++}`; params.push(safe); }
            } else if (operator === 'lte') {
              const safe = safeDateValue(value);
              if (safe) { sql += ` AND ${columnRef} <= $${paramIndex++}`; params.push(safe); }
            } else if (operator === 'between' && Array.isArray(value)) {
              const safe0 = safeDateValue(value[0]); const safe1 = safeDateValue(value[1]);
              if (safe0 && safe1) {
                sql += ` AND ${columnRef} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
                params.push(safe0, safe1);
              }
            }
          } else {
            // 문자열 필드: contains 기본, eq/in도 지원
            if (operator === 'contains') {
              // ★ D89: 전화번호 하이픈, 주소/매장명 구분자 정규화
              const norm = normalizeContainsSearch(field, columnRef, value);
              sql += ` AND ${norm.colExpr} ILIKE $${paramIndex++}`; params.push(`%${norm.cleanValue}%`);
            } else if (operator === 'in' && Array.isArray(value)) {
              sql += ` AND ${columnRef} = ANY($${paramIndex++}::text[])`; params.push(value);
            } else {
              // eq 포함 기타 → 정확 일치
              sql += ` AND ${columnRef} = $${paramIndex++}`; params.push(String(value));
            }
          }
          continue; // FIELD_MAP에서 처리됨 → 커스텀 필드로 넘기지 않음
        }

        // ── 커스텀 필드 (JSONB) — FIELD_MAP에 없는 필드만 ──
        if (!isValidCustomFieldKey(field)) continue;
        const cfCol = `custom_fields->>'${field}'`;

        if (operator === 'eq') {
          sql += ` AND ${cfCol} = $${paramIndex++}`;
          params.push(String(value));
        } else if (operator === 'gte') {
          // ★ D77: 날짜형 값 자동 감지 — ::numeric 대신 ::date 캐스팅
          if (isDateLikeValue(value)) {
            sql += ` AND (${cfCol})::date >= $${paramIndex++}`;
            params.push(value);
          } else {
            sql += ` AND (${cfCol})::numeric >= $${paramIndex++}`;
            params.push(Number(value));
          }
        } else if (operator === 'lte') {
          // ★ D77: 날짜형 값 자동 감지
          if (isDateLikeValue(value)) {
            sql += ` AND (${cfCol})::date <= $${paramIndex++}`;
            params.push(value);
          } else {
            sql += ` AND (${cfCol})::numeric <= $${paramIndex++}`;
            params.push(Number(value));
          }
        } else if (operator === 'between' && Array.isArray(value)) {
          // ★ D77: 날짜형 값 자동 감지
          if (isDateLikeValue(value[0]) || isDateLikeValue(value[1])) {
            sql += ` AND (${cfCol})::date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
            params.push(value[0], value[1]);
          } else {
            sql += ` AND (${cfCol})::numeric BETWEEN $${paramIndex++} AND $${paramIndex++}`;
            params.push(Number(value[0]), Number(value[1]));
          }
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

  // age (배열: [30, 39]) — ★ D79: age 컬럼 NULL이어도 birth_date에서 나이 동적 계산
  const ageExprMixed = `COALESCE(${col(alias, 'age')}, DATE_PART('year', AGE(${col(alias, 'birth_date')}))::int)`;
  const age = getValue(filters.age);
  if (age && Array.isArray(age) && age.length === 2) {
    sql += ` AND ${ageExprMixed} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
    params.push(Number(age[0]), Number(age[1]));
  }

  // minAge/maxAge (기존 호환) — ★ D79: birth_date 폴백 동일 적용
  const minAge = getValue(filters.minAge) || getValue(filters.min_age);
  if (minAge) {
    sql += ` AND ${ageExprMixed} >= $${paramIndex++}`;
    params.push(Number(minAge));
  }
  const maxAge = getValue(filters.maxAge) || getValue(filters.max_age);
  if (maxAge) {
    sql += ` AND ${ageExprMixed} <= $${paramIndex++}`;
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

  // ────────────────────────────────────────────────
  // ★ D74: FIELD_MAP 기반 동적 필터 — 하드코딩 제거
  // 특수 처리 필드(gender, grade, region, age, birth_date, store_code)는 위에서 처리 완료.
  // 나머지 FIELD_MAP 필드는 dataType 기반으로 자동 필터 생성.
  // ────────────────────────────────────────────────
  // ★ 위에서 이미 특수 처리한 필드만 등록 (normalize 헬퍼 사용 또는 별도 분기 필요한 것)
  // name, email, address는 일반 문자열 필드이므로 FIELD_MAP 동적 루프에서 자동 처리
  // phone, sms_opt_in은 기본 WHERE절에 이미 포함 (필터 불필요)
  const SPECIAL_FIELDS = new Set([
    'gender', 'grade', 'region', 'age',  // normalize 헬퍼 사용
    'phone', 'sms_opt_in',               // 기본 WHERE절에 포함
    'store_code',                          // 아래 별도 분기
  ]);

  for (const field of getColumnFields()) {
    if (SPECIAL_FIELDS.has(field.fieldKey)) continue; // 위에서 이미 처리
    const filterEntry = filters[field.fieldKey];
    const value = getValue(filterEntry);
    if (value === null || value === undefined) continue;

    const columnRef = col(alias, field.columnName);
    const operator = filterEntry?.operator || (field.dataType === 'number' ? 'gte' : 'eq');

    if (field.dataType === 'number') {
      // 숫자 필드: gte / lte / between
      if (operator === 'gte') {
        sql += ` AND ${columnRef} >= $${paramIndex++}`;
        params.push(Number(value));
      } else if (operator === 'lte') {
        sql += ` AND ${columnRef} <= $${paramIndex++}`;
        params.push(Number(value));
      } else if (operator === 'between' && Array.isArray(value)) {
        sql += ` AND ${columnRef} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(Number(value[0]), Number(value[1]));
      } else if (operator === 'eq') {
        sql += ` AND ${columnRef} = $${paramIndex++}`;
        params.push(Number(value));
      }
    } else if (field.dataType === 'date') {
      // ★ D83: 날짜 필드 — safeDateValue로 비정상 입력 방어
      if (operator === 'days_within') {
        const days = parseInt(value);
        if (!isNaN(days)) {
          const daysAgo = new Date();
          daysAgo.setDate(daysAgo.getDate() - days);
          sql += ` AND ${columnRef} >= $${paramIndex++}`;
          params.push(daysAgo.toISOString().split('T')[0]);
        }
      } else if (operator === 'birth_month') {
        const month = parseInt(value);
        if (!isNaN(month) && month >= 1 && month <= 12) {
          sql += ` AND EXTRACT(MONTH FROM ${columnRef}) = $${paramIndex++}`;
          params.push(month);
        }
      } else if (operator === 'gte') {
        const safe = safeDateValue(value);
        if (safe) { sql += ` AND ${columnRef} >= $${paramIndex++}`; params.push(safe); }
      } else if (operator === 'lte') {
        const safe = safeDateValue(value);
        if (safe) { sql += ` AND ${columnRef} <= $${paramIndex++}`; params.push(safe); }
      } else if (operator === 'between' && Array.isArray(value)) {
        const safe0 = safeDateValue(value[0]);
        const safe1 = safeDateValue(value[1]);
        if (safe0 && safe1) {
          sql += ` AND ${columnRef} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
          params.push(safe0, safe1);
        }
      }
    } else {
      // 문자열 필드: eq / in / contains
      if (operator === 'in' && Array.isArray(value)) {
        sql += ` AND ${columnRef} = ANY($${paramIndex++}::text[])`;
        params.push(value);
      } else if (operator === 'contains') {
        // ★ D89: 전화번호 하이픈, 주소/매장명 구분자 정규화
        const norm = normalizeContainsSearch(field.fieldKey, columnRef, value);
        sql += ` AND ${norm.colExpr} ILIKE $${paramIndex++}`;
        params.push(`%${norm.cleanValue}%`);
      } else {
        sql += ` AND ${columnRef} = $${paramIndex++}`;
        params.push(value);
      }
    }
  }

  // store_code (특수 처리 — storeCodeMode에 따라 direct/subquery/skip 분기)
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

  // ────────────────────────────────────────────────
  // ★ D74: 커스텀 필드 (JSONB) 동적 필터 — custom_fields.custom_N 키 + 8개 연산자
  // ────────────────────────────────────────────────
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
          // ★ D77: 날짜형 값 자동 감지 — ::numeric 대신 ::date 캐스팅
          if (isDateLikeValue(value)) {
            sql += ` AND (${cfCol})::date >= $${paramIndex++}`;
            params.push(value);
          } else {
            sql += ` AND (${cfCol})::numeric >= $${paramIndex++}`;
            params.push(value);
          }
        } else if (operator === 'lte') {
          // ★ D77: 날짜형 값 자동 감지
          if (isDateLikeValue(value)) {
            sql += ` AND (${cfCol})::date <= $${paramIndex++}`;
            params.push(value);
          } else {
            sql += ` AND (${cfCol})::numeric <= $${paramIndex++}`;
            params.push(value);
          }
        } else if (operator === 'between' && Array.isArray(value)) {
          // ★ D77: 날짜형 값 자동 감지
          if (isDateLikeValue(value[0]) || isDateLikeValue(value[1])) {
            sql += ` AND (${cfCol})::date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
            params.push(value[0], value[1]);
          } else {
            sql += ` AND (${cfCol})::numeric BETWEEN $${paramIndex++} AND $${paramIndex++}`;
            params.push(Number(value[0]), Number(value[1]));
          }
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
  // ★ D83: 디버그 로그
  console.log('[CT-01 DEBUG] buildFilterQueryCompat input:', JSON.stringify(filter));
  const result = buildCustomerFilter(filter, {
    tableAlias: 'c',
    startParamIndex: 2,  // campaigns.ts는 항상 $1 = companyId
    storeCodeMode: 'direct',
    inputFormat: 'mixed',
  });
  console.log('[CT-01 DEBUG] buildFilterQueryCompat output SQL:', result.sql, '| params:', JSON.stringify(result.params));
  return { where: result.sql, params: result.params, nextIndex: result.nextIndex };
}

/**
 * customers.ts 호환 래퍼.
 * 기존 시그니처: buildDynamicFilter(filters, startIndex) → {where, params, nextIndex}
 * ★ store_code는 'subquery' 모드.
 */
export function buildDynamicFilterCompat(filters: any, startIndex: number): { where: string; params: any[]; nextIndex: number } {
  // ★ D83: 디버그 로그 — 필터 입력 → 생성된 SQL 추적 (문제 필드 특정용)
  console.log('[CT-01 DEBUG] buildDynamicFilterCompat input:', JSON.stringify(filters));
  const result = buildCustomerFilter(filters, {
    tableAlias: '',
    startParamIndex: startIndex,
    storeCodeMode: 'subquery',
    companyIdParamRef: '$1',
    inputFormat: 'structured',
  });
  console.log('[CT-01 DEBUG] buildDynamicFilterCompat output SQL:', result.sql, '| params:', JSON.stringify(result.params));
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
