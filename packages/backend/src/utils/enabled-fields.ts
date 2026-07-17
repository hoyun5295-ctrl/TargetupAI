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
import { redis } from '../config/defaults';
import { FIELD_MAP, getColumnFields, getFieldByKey, CATEGORY_LABELS, FIELD_DISPLAY_MAP, reverseDisplayValue } from './standard-field-map';
import { detectPhoneFields } from './callback-filter';
import { swrPrimeCache } from './swr-cache';

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
    // ★ 2026-07-03 성능: LIMIT이 DISTINCT 뒤에 걸리면 13만+ 전수 스캔 × 필드 수만큼 반복(고객DB 현황 수 초 지연).
    //   내부 서브쿼리 LIMIT 200으로 스캔 조기 종료 → 그 표본에서 DISTINCT 20 (판정 정확도 동일).
    const sampleResult = await query(
      `SELECT DISTINCT val FROM (
         SELECT custom_fields->>'${fieldKey}' as val
           FROM customers
          WHERE ${scopeWhere}
            AND custom_fields->>'${fieldKey}' IS NOT NULL
            AND custom_fields->>'${fieldKey}' != ''
          LIMIT 200
       ) sample_rows
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

// ─── 결과 캐시 ───
// ★ 2026-07-03 성능: 대형 고객사(13만+ × custom 15)에서 전수 스캔 3종이 수 초 → 결과 캐시.
//   LESSONS_BACKEND 캐시 원칙 준수 — 무효화 길목 배선(업로드 save·전체삭제·업로더별삭제·싱크 필드정의 등록)
//   + 다중 pm2(메모리 캐시 비전파) 대비 TTL 상한 5분.
//   키에 scopeWhere/params 포함 — company_user 매장 격리 스코프별 결과 분리.
const ENABLED_FIELDS_CACHE_TTL_MS = 5 * 60 * 1000;
const enabledFieldsCache = new Map<string, { at: number; data: EnabledFieldsResult }>();

/**
 * ★ Codex 3R·4차 — SWR 세대 키(회사별). 무효화마다 INCR — swrCache/swrPrimeCache가 "compute 도중
 * 무효화 발생"을 감지해 변형 전 결과의 저장(부활)을 생략하는 가드.
 * 회사별 분리(4차 지적 수용): 전역 키였을 때는 B사 무효화가 A사 워밍 저장까지 무효로 만들어 A가
 * 콜드로 남았다 — 회사별 키면 자기 회사 재무효화만 저장을 막고, 그 재무효화가 예약한 다음 워밍이
 * 항상 이어받는다. 이름에 'enabled-fields:' 콜론 구획을 쓰지 않아(enabled-fields-gen:) 데이터 키
 * 삭제 패턴에 걸리지 않는다 — 패턴 삭제로 세대가 리셋되면 INCR 재시작 값이 과거 값과 우연히
 * 일치해 가드가 뚫릴 수 있기 때문. (무인자 clear 호출 = 전 소스 grep 0건 실측)
 */
export const enabledFieldsGenKey = (companyId: string) => `enabled-fields-gen:${companyId}`;

export function clearEnabledFieldsCache(companyId?: string): void {
  // ★ 2026-07-17 — 라우트 응답 Redis 캐시(enabled-fields:{companyId}:{userId}:{scope})도 같은 길목에서 무효화.
  //   "업로드·삭제·싱크 = 즉시 반영" 기존 계약 유지(Codex 정정 — Redis 잔존 시 새 필드·삭제 고객 sample 노출).
  //   fire-and-forget — 무효화 실패해도 soft 60초 백그라운드 갱신이 먼저 정정(hard TTL은 최후 상한).
  if (companyId) {
    redis.incr(enabledFieldsGenKey(companyId)).catch(() => { /* 세대 가드 실패 = 키 삭제·TTL이 상한 */ });
  }
  const redisPattern = companyId ? `enabled-fields:${companyId}:*` : 'enabled-fields:*';
  redis.keys(redisPattern)
    .then((keys) => (keys.length > 0 ? redis.del(...keys) : 0))
    .catch(() => { /* TTL 60초 상한 */ });
  // ★ 2026-07-17(3) — 무효화 = 사전 워밍 예약(5초 디바운스). 데이터가 바뀐 직후 백그라운드로
  //   'all' 스코프 payload를 다시 계산해 공용 키를 데워 두므로, 사용자가 콜드 1초를 물지 않는다.
  if (companyId) scheduleEnabledFieldsWarm(companyId);
  if (!companyId) {
    enabledFieldsCache.clear();
    return;
  }
  for (const key of enabledFieldsCache.keys()) {
    if (key.startsWith(companyId + '|')) enabledFieldsCache.delete(key);
  }
}

// ─── 메인 함수 ───

/**
 * 고객사가 실제로 사용 중인 필드 목록을 동적으로 탐지한다.
 *
 * @returns { fields, fieldDefLabels, fieldDefTypes }
 */
export async function detectEnabledFields(
  params: DetectEnabledFieldsParams,
  opts: { bypassCache?: boolean } = {},
): Promise<EnabledFieldsResult> {
  const { companyId, scopeWhere, scopeParams } = params;

  // ★ 2026-07-03: 캐시 조회 (5분 TTL) — 소비처가 배열을 변형해도 안전하게 얕은 복사로 반환
  // ★ Codex 4차: bypassCache = 무효화 후 워밍 전용 — 무효화 직전 in-flight 계산이 5분 캐시에 남긴
  //   변형 전 결과를 재사용하지 않도록 읽기만 우회(계산 결과는 아래에서 캐시에 덮어써 신선하게 갱신).
  const cacheKey = `${companyId}|${scopeWhere}|${JSON.stringify(scopeParams)}`;
  const cached = opts.bypassCache ? undefined : enabledFieldsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ENABLED_FIELDS_CACHE_TTL_MS) {
    return {
      fields: [...cached.data.fields],
      fieldDefLabels: { ...cached.data.fieldDefLabels },
      fieldDefTypes: { ...cached.data.fieldDefTypes },
    };
  }

  const fields: EnabledField[] = [];
  const existingKeys = new Set<string>();

  // ★ 2026-07-03: 내부 쿼리가 하나라도 실패하면(부분 결과) 캐시 저장 금지 —
  //   일시 DB 오류로 축소된 필드 목록이 5분간 화면/엑셀/카드에 고정되는 것 차단
  let degraded = false;

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
    degraded = true;
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
      degraded = true;
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
    degraded = true;
    console.warn('[CT-18] custom_fields JSONB 키 조회 실패:', (err as any)?.message);
  }

  // 정렬: sort_order 기준
  fields.sort((a, b) => a.sort_order - b.sort_order);

  // ★ 2026-07-03: 캐시 저장 (원본 보관, 반환은 얕은 복사). 부분 실패(degraded) 결과는 캐시 금지.
  if (!degraded) {
    enabledFieldsCache.set(cacheKey, {
      at: Date.now(),
      data: { fields: [...fields], fieldDefLabels: { ...fieldDefLabels }, fieldDefTypes: { ...fieldDefTypes } },
    });
  }

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

// ─── 활성 필드 응답 payload 조립 + 사전 워밍 (★ 2026-07-17(3) 라우트 인라인 → CT 이동) ───

/**
 * enabled-fields 캐시 hard TTL(초) = 1시간. ★ Codex 확인 라운드 정정(24h→1h): CDP identify 계열
 * (identifyCustomer — custom_fields 쓰기)은 clearEnabledFieldsCache 길목을 타지 않는 고빈도 경로라
 * "모든 쓰기가 무효화를 탄다"는 전제가 성립하지 않는다. 그 핫패스에 KEYS 무효화를 붙이는 대신
 * TTL 상한을 1시간으로 묶는다 — 장기 무접근 후 첫 응답의 낡음이 최대 1시간(soft 60초 백그라운드
 * 갱신이 그 1회 뒤 즉시 정정), 콜드 재발은 1시간+ 무접근일 때만(워밍이 통상 유입을 커버).
 */
export const ENABLED_FIELDS_HARD_TTL_SEC = 60 * 60;

export interface EnabledFieldsPayload {
  fields: EnabledField[];
  options: Record<string, string[]>;
  sample: Record<string, any>;
  categories: typeof CATEGORY_LABELS;
  phoneFields: string[];
}

/**
 * GET /enabled-fields 응답 전체(fields+options+sample+phoneFields)를 조립한다.
 * 기존 routes/customers.ts 인라인 로직의 무변형 이동 — 쿼리·필터·실패 무시(try/catch) 전부 동일.
 * 소비처: ①라우트(swrCache compute) ②scheduleEnabledFieldsWarm(무효화 길목 사전 워밍).
 * 재진입 안전 — scopeParams는 읽기 전용으로만 쓴다.
 */
export async function buildEnabledFieldsPayload(
  params: DetectEnabledFieldsParams,
  opts: { bypassDetectorCache?: boolean } = {},
): Promise<EnabledFieldsPayload> {
  const { companyId, scopeWhere, scopeParams } = params;

  // ★ CT-18: 활성 필드 탐지 단일 진입점 (bypassDetectorCache = 워밍 전용 — Codex 4차)
  const { fields } = await detectEnabledFields(
    { companyId, scopeWhere, scopeParams },
    { bypassCache: opts.bypassDetectorCache },
  );

  // 3. 드롭다운 옵션 (실제 DB 값 기반 — 동적 감지)
  // 고카디널리티 필드 제외 (이름, 전화번호, 이메일, 주소는 DISTINCT 의미 없음)
  const HIGH_CARDINALITY = ['name', 'phone', 'email', 'address'];
  const options: Record<string, string[]> = {};

  // ★ 2026-07-17 성능 — 필드당 DISTINCT 조회(3-1 직접 컬럼 + 3-2 커스텀)를 순차 루프에서 병렬로.
  //   쿼리·필터·결과 의미 무변경, 필드별 실패 무시(try/catch)도 그대로 — 실행 시점만 병렬.
  //   ★ Codex 정정: 무제한 병렬은 커스텀 필드 다수 회사가 PG 풀(20)을 독점 → 동시 5개 청크 상한.
  const optionThunks: Array<() => Promise<void>> = [];

  // 3-1. 직접 컬럼 string 필드 → DISTINCT 조회
  for (const f of fields) {
    if (f.is_custom || f.data_type !== 'string' || HIGH_CARDINALITY.includes(f.field_key)) continue;
    const mapped = getFieldByKey(f.field_key);
    const col = mapped?.columnName || f.field_key;
    optionThunks.push(async () => {
      try {
        const optResult = await query(
          `SELECT DISTINCT ${col} FROM customers WHERE ${scopeWhere} AND ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col} LIMIT 100`,
          scopeParams
        );
        if (optResult.rows.length > 0 && optResult.rows.length <= 100) {
          options[f.field_key] = optResult.rows.map((r: any) => r[col]);
        }
      } catch (e) { /* 컬럼 없으면 무시 */ }
    });
  }

  // 3-2. 커스텀 필드 (JSONB) string 타입 → DISTINCT 조회
  for (const f of fields) {
    if (!f.is_custom || f.data_type !== 'string') continue;
    optionThunks.push(async () => {
      try {
        const optResult = await query(
          `SELECT DISTINCT custom_fields->>'${f.field_key}' as val FROM customers WHERE ${scopeWhere} AND custom_fields->>'${f.field_key}' IS NOT NULL AND custom_fields->>'${f.field_key}' != '' ORDER BY val LIMIT 100`,
          scopeParams
        );
        if (optResult.rows.length > 0 && optResult.rows.length <= 100) {
          options[f.field_key] = optResult.rows.map((r: any) => r.val);
        }
      } catch (e) { /* 커스텀 필드 옵션 조회 실패 무시 */ }
    });
  }
  for (let i = 0; i < optionThunks.length; i += 5) {
    await Promise.all(optionThunks.slice(i, i + 5).map((fn) => fn()));
  }

  // 4. 실제 고객 1건 샘플 데이터 (AI 맞춤한줄 미리보기용)
  // ★ B+0407-1: enum 필드(gender F→여성) 미리 변환 — 모든 frontend 표시 경로 자동 정상화
  const sample: Record<string, any> = {};
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
    const enabledKnown = knownPhoneKeys.filter(k => fields.some((f) => f.field_key === k));

    // 커스텀 필드는 실제 데이터 샘플링으로 판별 (최대 10건)
    const phoneSampleResult = await query(
      `SELECT custom_fields, store_phone FROM customers WHERE ${scopeWhere} AND custom_fields IS NOT NULL AND custom_fields != '{}' LIMIT 10`,
      scopeParams
    );
    const customPhoneFields = detectPhoneFields(
      phoneSampleResult.rows,
      fields.filter((f) => f.is_custom),
    );

    phoneFields = [...new Set([...enabledKnown, ...customPhoneFields.map(f => f.field_key)])];
  } catch (e) { /* phone_fields 감지 실패 시 빈 배열 */ }

  return { fields, options, sample, categories: CATEGORY_LABELS, phoneFields };
}

/**
 * ★ 2026-07-17(3) — 무효화 길목 사전 워밍. clearEnabledFieldsCache(9곳 전 길목 공용)가 호출한다.
 * 5초 디바운스(업로드/싱크 배치의 연속 무효화 흡수) 후 'all' 스코프 payload를 백그라운드 재계산해
 * 회사 공용 키(enabled-fields:{companyId}:all)를 데운다 — 콜드 1초(0717 실측 1,074ms)를
 * 사용자가 아니라 워커가 문다. 워밍 도중 또 무효화가 끼면 swrPrimeCache 세대 가드가 저장을
 * 생략하고, 그 무효화가 예약한 다음 워밍이 이어받는다. 실패 = 다음 접근이 콜드 계산(현행과 동일).
 */
// ★ Codex 확인 라운드 — 60초: 싱크는 4,000행 배치마다 무효화를 호출하므로 짧은 디바운스면 배치
//   사이(>5초 간격)마다 전수 스캔 워밍이 끼어 수십 회 낭비된다. 60초면 대형 싱크 전체가 하나로
//   합쳐져 마지막 배치 후 1회만 워밍. 트레이드오프 = 데이터 변경 후 60초 안에 진입하는 사용자만
//   콜드 1회(현행과 동일 비용) — 반복 콜드 제거라는 목적은 그대로.
const ENABLED_FIELDS_WARM_DEBOUNCE_MS = 60 * 1000;
const enabledFieldsWarmTimers = new Map<string, NodeJS.Timeout>();
// ★ Codex 4차 — 워밍 전역 직렬 큐: 여러 회사가 동시에 싱크/업로드를 끝내도 워밍은 한 번에 하나만
//   실행(회사당 대기 1건 dedup). 워밍의 DISTINCT 청크(동시 5)가 회사 수만큼 겹치면 PG 풀(20)을
//   잠식해 사용자 요청이 줄을 서게 되므로 — 워밍은 배경 작업이라 순서대로 밀려도 된다.
let enabledFieldsWarmChain: Promise<void> = Promise.resolve();
const enabledFieldsWarmQueued = new Set<string>();

function scheduleEnabledFieldsWarm(companyId: string): void {
  const prev = enabledFieldsWarmTimers.get(companyId);
  if (prev) clearTimeout(prev);
  enabledFieldsWarmTimers.set(companyId, setTimeout(() => {
    enabledFieldsWarmTimers.delete(companyId);
    if (enabledFieldsWarmQueued.has(companyId)) return; // 이미 대기 중 — 그 실행이 최신 데이터를 읽는다
    enabledFieldsWarmQueued.add(companyId);
    enabledFieldsWarmChain = enabledFieldsWarmChain
      .then(async () => {
        enabledFieldsWarmQueued.delete(companyId);
        await swrPrimeCache({
          key: `enabled-fields:${companyId}:all`,
          hardTtlSec: ENABLED_FIELDS_HARD_TTL_SEC,
          generationKey: enabledFieldsGenKey(companyId),
          // ★ Codex 4차 — detector 인메모리 캐시 우회: 무효화 직전 in-flight 계산이 남긴 변형 전
          //   결과를 재사용하지 않도록 항상 실계산(결과가 캐시를 덮어써 양쪽 층이 함께 신선해짐).
          compute: () => buildEnabledFieldsPayload(
            { companyId, scopeWhere: 'company_id = $1 AND is_active = true', scopeParams: [companyId] },
            { bypassDetectorCache: true },
          ),
        });
      })
      .catch(() => { /* 워밍 실패 = 다음 접근이 콜드 계산 (현행과 동일) */ });
  }, ENABLED_FIELDS_WARM_DEBOUNCE_MS));
}
