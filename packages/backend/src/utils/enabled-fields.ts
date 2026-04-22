/**
 * CT-18: 고객사 활성 필드 탐지 컨트롤타워 (D136 밤 신설, 2026-04-22)
 * ===================================================================
 *
 * 역할:
 *   고객사가 실제로 업로드/사용 중인 필드를 동적으로 감지하여 반환한다.
 *   "고객DB 현황" = "엑셀 다운로드" = "대시보드 카드 선택" — 모든 "활성 필드" 탐지의 단일 진입점.
 *
 * Harold님 원칙 (2026-04-22 D136):
 *   "고객사에서 바라보는 현황을 동적으로 바라보고 그걸 그대로 다운로드 하게 해주면 끝."
 *   → 화면에 보이는 것과 엑셀/카드 설정이 100% 일치해야 한다.
 *
 * 판정 기준:
 *   1. 직접 컬럼 필드(FIELD_MAP storageType='column')
 *      - name, phone: 항상 포함 (필수)
 *      - 나머지: COUNT FILTER로 실제 데이터 있는 필드만
 *   2. 커스텀 필드(custom_fields JSONB)
 *      - jsonb_object_keys ∪ customer_field_definitions union
 *      - data_type 자동 감지:
 *          (a) customer_field_definitions.field_type 우선
 *          (b) VARCHAR/미등록이면 DISTINCT 20건 샘플링 → number/date 자동 판별
 *
 * 라벨 우선순위:
 *   customer_field_definitions.field_label > FIELD_MAP.displayName > field_key 원문
 *
 * ⚠️ 하드코딩 금지:
 *   - 필드 리스트는 오직 FIELD_MAP + customer_field_definitions + JSONB 실데이터에서 온다
 *   - 새 필드 추가는 FIELD_MAP 등록 + Harold님 확정만으로 전 소비처 자동 반영
 *
 * ⚠️ 인라인 금지:
 *   - 소비처가 COUNT FILTER, jsonb_object_keys, 타입 감지 로직을 자체 구현하는 것 절대 금지
 *   - 반드시 이 함수 호출
 *
 * 소비처:
 *   - routes/customers.ts GET /enabled-fields (화면용 + sample/options/phoneFields 추가)
 *   - routes/customers.ts GET /download (엑셀 다운로드)
 *   - routes/companies.ts dashboard-cards 관련 (D8 예정 — 고객사별 동적 카드 확장)
 *   - 향후 AI/자동발송 필드 선택 단계
 */

import { query } from '../config/database';
import { FIELD_MAP, getColumnFields, getFieldByKey } from './standard-field-map';

// ─── 타입 정의 ───

export interface EnabledField {
  field_key: string;
  display_name: string;       // 라벨 (화면/엑셀 공용)
  field_label: string;        // display_name과 동일 (프론트 호환 키)
  data_type: 'string' | 'number' | 'date' | 'boolean';
  category: string;
  sort_order: number;
  is_custom: boolean;
  /** 직접 컬럼 필드의 실제 DB 컬럼명 (FIELD_MAP.columnName). 동적 SELECT 생성용. */
  column_name?: string;
  /** FIELD_MAP.normalizeFunction 힌트 (포맷 판별/다운로드용). */
  normalize_function?: string;
}

export interface EnabledFieldsResult {
  fields: EnabledField[];
  /** customer_field_definitions에서 조회한 field_key → field_label 맵 */
  fieldDefLabels: Record<string, string>;
  /** customer_field_definitions에서 조회한 field_key → field_type 맵 */
  fieldDefTypes: Record<string, string>;
}

export interface DetectEnabledFieldsParams {
  companyId: string;
  /** 이미 조합된 WHERE 절 (예: "company_id = $1 AND is_active = true AND id IN (...)") */
  scopeWhere: string;
  /** scopeWhere에 대응되는 $1,$2,... 파라미터 배열 */
  scopeParams: any[];
}

// ─── 커스텀 필드 타입 자동 감지 ───

const NUMERIC_TYPE_KEYS = ['NUMBER', 'INTEGER', 'INT', 'FLOAT', 'NUMERIC', 'DECIMAL'];
const DATE_TYPE_KEYS = ['DATE', 'DATETIME', 'TIMESTAMP'];
const NUM_PATTERN = /^-?[\d,]+(\.\d+)?$/;
const DATE_PATTERN = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{8}$/;

function resolveCustomDataType(defType: string | undefined): 'string' | 'number' | 'date' {
  if (!defType) return 'string';
  const upper = defType.toUpperCase();
  if (NUMERIC_TYPE_KEYS.includes(upper)) return 'number';
  if (DATE_TYPE_KEYS.includes(upper)) return 'date';
  return 'string';
}

async function detectCustomFieldTypeFromSamples(
  companyId: string,
  scopeWhere: string,
  scopeParams: any[],
  fieldKey: string,
): Promise<'string' | 'number' | 'date'> {
  try {
    const sampleResult = await query(
      `SELECT DISTINCT custom_fields->>'${fieldKey}' as val
         FROM customers
        WHERE ${scopeWhere}
          AND custom_fields->>'${fieldKey}' IS NOT NULL
          AND custom_fields->>'${fieldKey}' != ''
        LIMIT 20`,
      scopeParams,
    );
    const samples = sampleResult.rows
      .map((r: any) => r.val)
      .filter((v: any) => v != null && String(v).trim() !== '');
    if (samples.length === 0) return 'string';

    const allNumeric = samples.every((v: string) => NUM_PATTERN.test(String(v).trim()));
    if (allNumeric) return 'number';

    const allDate = samples.every((v: string) => DATE_PATTERN.test(String(v).trim()));
    if (allDate) return 'date';
  } catch {
    /* 샘플링 실패 시 string 유지 */
  }
  return 'string';
}

// ─── 메인 함수 ───

/**
 * 고객사가 실제로 사용 중인 필드 목록을 동적으로 탐지한다.
 *
 * @returns { fields, fieldDefLabels, fieldDefTypes }
 */
export async function detectEnabledFields(
  params: DetectEnabledFieldsParams,
): Promise<EnabledFieldsResult> {
  const { companyId, scopeWhere, scopeParams } = params;

  const fields: EnabledField[] = [];
  const existingKeys = new Set<string>();

  // ─── 0. customer_field_definitions 라벨/타입 맵 ───
  const fieldDefLabels: Record<string, string> = {};
  const fieldDefTypes: Record<string, string> = {};
  const fieldDefOrder: Record<string, number> = {};
  try {
    const defRes = await query(
      `SELECT field_key, field_label, field_type, display_order
         FROM customer_field_definitions
        WHERE company_id = $1 AND (is_hidden = false OR is_hidden IS NULL)
        ORDER BY display_order`,
      [companyId],
    );
    for (const fd of defRes.rows) {
      if (fd.field_label) fieldDefLabels[fd.field_key] = fd.field_label;
      if (fd.field_type) fieldDefTypes[fd.field_key] = fd.field_type;
      if (fd.display_order != null) fieldDefOrder[fd.field_key] = fd.display_order;
    }
  } catch (err) {
    console.warn('[CT-18] customer_field_definitions 조회 실패 — FIELD_MAP만 사용:', (err as any)?.message);
  }

  // ─── 1. 직접 컬럼 필드 — FIELD_MAP + COUNT FILTER 동적 감지 ───

  // name, phone: 항상 포함 (필수)
  const nameField = getFieldByKey('name')!;
  const phoneField = getFieldByKey('phone')!;
  fields.push(
    {
      field_key: 'name',
      display_name: fieldDefLabels['name'] || nameField.displayName,
      field_label: fieldDefLabels['name'] || nameField.displayName,
      data_type: nameField.dataType,
      category: nameField.category,
      sort_order: nameField.sortOrder,
      is_custom: false,
      column_name: nameField.columnName,
      normalize_function: nameField.normalizeFunction,
    },
    {
      field_key: 'phone',
      display_name: fieldDefLabels['phone'] || phoneField.displayName,
      field_label: fieldDefLabels['phone'] || phoneField.displayName,
      data_type: phoneField.dataType,
      category: phoneField.category,
      sort_order: phoneField.sortOrder,
      is_custom: false,
      column_name: phoneField.columnName,
      normalize_function: phoneField.normalizeFunction,
    },
  );
  existingKeys.add('name');
  existingKeys.add('phone');

  // 나머지 직접 컬럼: 동적 COUNT FILTER로 실데이터 유무 확인
  const detectableFields = getColumnFields().filter(
    f => f.fieldKey !== 'name' && f.fieldKey !== 'phone',
  );
  if (detectableFields.length > 0) {
    const countFilters = detectableFields.map(f => {
      const col = f.columnName;
      if (f.dataType === 'boolean' || f.dataType === 'date') {
        return `COUNT(*) FILTER (WHERE ${col} IS NOT NULL) as cnt_${f.fieldKey}`;
      } else if (f.dataType === 'number') {
        return `COUNT(*) FILTER (WHERE ${col} IS NOT NULL AND ${col} > 0) as cnt_${f.fieldKey}`;
      }
      return `COUNT(*) FILTER (WHERE ${col} IS NOT NULL AND ${col} != '') as cnt_${f.fieldKey}`;
    });

    try {
      const dataCheckResult = await query(
        `SELECT ${countFilters.join(', ')} FROM customers WHERE ${scopeWhere}`,
        scopeParams,
      );
      const dc = dataCheckResult.rows[0] || {};
      for (const f of detectableFields) {
        if (parseInt(dc[`cnt_${f.fieldKey}`] || '0') > 0) {
          const label = fieldDefLabels[f.fieldKey] || f.displayName;
          fields.push({
            field_key: f.fieldKey,
            display_name: label,
            field_label: label,
            data_type: f.dataType,
            category: f.category,
            sort_order: f.sortOrder,
            is_custom: false,
            column_name: f.columnName,
            normalize_function: f.normalizeFunction,
          });
          existingKeys.add(f.fieldKey);
        }
      }
    } catch (err) {
      console.warn('[CT-18] 직접 컬럼 COUNT FILTER 실패:', (err as any)?.message);
    }
  }

  // ─── 2. 커스텀 필드 — JSONB 실키 ∪ field_definitions union ───
  try {
    const customKeysResult = await query(
      `SELECT DISTINCT jsonb_object_keys(custom_fields) as field_key
         FROM customers
        WHERE ${scopeWhere}
          AND custom_fields IS NOT NULL
          AND custom_fields != '{}'::jsonb`,
      scopeParams,
    );
    const jsonbKeys: string[] = customKeysResult.rows.map((r: any) => r.field_key);

    // field_definitions에 정의된 key 중 JSONB에 아직 없는 것도 포함 (업로드 예정 필드 대비 X)
    //   → Harold님 원칙 "실제 업로드한 내역 그대로"이므로 JSONB에 값이 있는 키만 포함.
    //     정의만 있고 값 없는 키는 제외.

    for (const fieldKey of jsonbKeys) {
      if (existingKeys.has(fieldKey)) continue;

      const mapped = getFieldByKey(fieldKey);
      const label = fieldDefLabels[fieldKey] || mapped?.displayName || fieldKey;

      // data_type: (1) defType → (2) VARCHAR/미등록이면 샘플링 자동 감지
      const defType = fieldDefTypes[fieldKey];
      let detectedType: 'string' | 'number' | 'date' = resolveCustomDataType(defType);
      if (detectedType === 'string' && (!defType || defType.toUpperCase() === 'VARCHAR')) {
        detectedType = await detectCustomFieldTypeFromSamples(companyId, scopeWhere, scopeParams, fieldKey);
      }

      fields.push({
        field_key: fieldKey,
        display_name: label,
        field_label: label,
        data_type: detectedType,
        category: mapped?.category || 'custom',
        sort_order:
          fieldDefOrder[fieldKey] != null
            ? 900 + fieldDefOrder[fieldKey] // defs 순서 우선
            : mapped?.sortOrder || 999,
        is_custom: true,
        // custom_fields JSONB 내부는 column_name 없음 (커스텀은 JSONB 평면화로 소비)
      });
      existingKeys.add(fieldKey);
    }
  } catch (err) {
    console.warn('[CT-18] custom_fields JSONB 키 조회 실패:', (err as any)?.message);
  }

  // 정렬: sort_order 기준
  fields.sort((a, b) => a.sort_order - b.sort_order);

  return { fields, fieldDefLabels, fieldDefTypes };
}

/**
 * 주어진 fields 배열을 기반으로 customers_unified 동적 SELECT 절을 생성한다.
 *
 * 엑셀 다운로드 / 리스트 조회에서 재사용 — FIELD_MAP.columnName 기반으로 컬럼을 동적 포함.
 *
 * 규칙:
 *   - name, phone: 항상 포함
 *   - date 타입: `TO_CHAR(col, 'YYYY-MM-DD') AS field_key` (문자열 안전)
 *   - sms_opt_in: 수신거부 반영 CASE (호출부에서 unsubCaseIdx 제공)
 *   - 그 외 직접 컬럼: `col AS field_key`
 *   - 커스텀 필드: custom_fields JSONB 전체를 한 번만 SELECT
 *
 * @returns { selectExpr: string, customFieldsIncluded: boolean }
 */
export function buildDynamicSelectExpr(
  fields: EnabledField[],
  options: {
    /** 수신거부 CASE의 user_id 파라미터 인덱스 ($N). 전달 시 sms_opt_in을 unsubscribes 반영으로 덮어씀. */
    unsubParamIndex?: number;
    /** 테이블 alias (기본: customers_unified) */
    tableAlias?: string;
  } = {},
): { selectExpr: string; hasCustomFields: boolean } {
  const { unsubParamIndex, tableAlias = 'customers_unified' } = options;

  const parts: string[] = [];
  let hasCustomFields = false;

  for (const f of fields) {
    if (f.is_custom) {
      hasCustomFields = true;
      continue;
    }
    const col = f.column_name;
    if (!col) continue;

    if (f.field_key === 'sms_opt_in' && unsubParamIndex) {
      parts.push(
        `CASE WHEN EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubParamIndex} AND u.phone = ${tableAlias}.phone) THEN false ELSE ${col} END AS ${f.field_key}`,
      );
    } else if (f.data_type === 'date') {
      parts.push(`TO_CHAR(${col}, 'YYYY-MM-DD') AS ${f.field_key}`);
    } else {
      parts.push(`${col} AS ${f.field_key}`);
    }
  }

  if (hasCustomFields) {
    parts.push('custom_fields');
  }

  return { selectExpr: parts.join(', '), hasCustomFields };
}
