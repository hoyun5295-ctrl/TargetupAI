/**
 * standard-field-map.ts
 * =====================
 * 유일한 필드 매핑 정의. 모든 파일은 이것만 import.
 *
 * 기준: FIELD-INTEGRATION.md (2026-02-26 Harold님 확정)
 * - 직접 컬럼 필드 + 커스텀 슬롯 15개
 * - 카테고리 6개: basic, purchase, store, membership, marketing, custom
 * - 하드코딩 금지. 이 파일이 유일한 기준.
 *
 * CT-07: customer_field_definitions UPSERT 컨트롤타워
 * - upload.ts, sync.ts 등 커스텀 필드 라벨 저장은 반드시 이 파일의 upsertCustomFieldDefinitions()를 사용
 * - ON CONFLICT DO UPDATE 방식으로 라벨 항상 최신화 (잘못된 라벨 고착 방지)
 */

import { query } from '../config/database';

// ─── 타입 정의 ───

/** 카테고리 6개 — FIELD-INTEGRATION.md 확정 */
export type FieldCategory =
  | 'basic'
  | 'purchase'
  | 'store'
  | 'membership'
  | 'marketing'
  | 'custom';

export type StorageType = 'column' | 'custom_fields';
export type DataType = 'string' | 'number' | 'date' | 'boolean';

export interface StandardFieldMapping {
  fieldKey: string;            // 유일한 기준 키
  category: FieldCategory;     // 카테고리
  displayName: string;         // 한글 라벨 (기본)
  /**
   * ★ D111 P2: 추가 한글 별칭 (동의어) — 사용자가 %이름%, %성함% 등 다른 한글로 변수를 써도 치환되도록.
   * extractVarCatalog가 fieldMappings에 displayName + aliases 모두 등록.
   * 배경: isoi 사례 — customer_schema.field_mappings가 없는 회사에서 FIELD_MAP fallback 시
   *       displayName('고객명')만 등록되어 %이름%이 치환 안 되는 문제.
   */
  aliases?: string[];
  dataType: DataType;          // 데이터 타입
  storageType: StorageType;    // 'column' = customers 직접 컬럼, 'custom_fields' = JSONB
  columnName: string;          // storageType=column → DB 컬럼명, storageType=custom_fields → JSONB 내 키
  normalizeFunction?: string;  // normalize.ts에서 호출할 함수명
  sortOrder: number;           // 정렬 순서
}

// ─── 카테고리 라벨 (프론트엔드용) ───

export const CATEGORY_LABELS: Record<FieldCategory, string> = {
  basic: '기본정보',
  purchase: '구매정보',
  store: '매장/등록정보',
  membership: '등급/포인트',
  marketing: '수신동의',
  custom: '커스텀',
};

// ─── 핵심 매핑표 — 직접 컬럼 필드 + 커스텀 15개 ───

export const FIELD_MAP: StandardFieldMapping[] = [
  // ── basic (기본정보) — 7개 ──
  // ★ D111 P2: aliases — isoi 사례(customer_schema.field_mappings 비어있음)에서 %이름% 변수가 '고객명'만 등록되어 치환 실패한 문제 해결
  { fieldKey: 'name',       category: 'basic', displayName: '고객명',       aliases: ['이름', '성함'],            dataType: 'string', storageType: 'column', columnName: 'name',       normalizeFunction: 'trim',            sortOrder: 1 },
  { fieldKey: 'phone',      category: 'basic', displayName: '고객전화번호', aliases: ['전화번호', '연락처', '휴대폰'], dataType: 'string', storageType: 'column', columnName: 'phone',      normalizeFunction: 'normalizePhone',  sortOrder: 2 },
  { fieldKey: 'gender',     category: 'basic', displayName: '성별',         dataType: 'string', storageType: 'column', columnName: 'gender',     normalizeFunction: 'normalizeGender', sortOrder: 3 },
  { fieldKey: 'age',        category: 'basic', displayName: '나이',         dataType: 'number', storageType: 'column', columnName: 'age',        normalizeFunction: 'parseInt',        sortOrder: 4 },
  { fieldKey: 'birth_date', category: 'basic', displayName: '생일',         dataType: 'date',   storageType: 'column', columnName: 'birth_date', normalizeFunction: 'normalizeDate',   sortOrder: 5 },
  { fieldKey: 'email',      category: 'basic', displayName: '이메일주소',   dataType: 'string', storageType: 'column', columnName: 'email',      normalizeFunction: 'normalizeEmail',  sortOrder: 6 },
  { fieldKey: 'address',    category: 'basic', displayName: '주소',         dataType: 'string', storageType: 'column', columnName: 'address',    normalizeFunction: 'trim',            sortOrder: 7 },
  // ★ B-D70-17: region은 customer-filter/AI프롬프트에서 사용되지만 FIELD_MAP에 누락되어 enabled-fields 미감지
  { fieldKey: 'region',     category: 'basic', displayName: '지역',         dataType: 'string', storageType: 'column', columnName: 'region',     normalizeFunction: 'trim',            sortOrder: 7.5 },

  // ── purchase (구매정보) — 4개 ──
  { fieldKey: 'recent_purchase_store',  category: 'purchase', displayName: '최근구매매장', dataType: 'string', storageType: 'column', columnName: 'recent_purchase_store',  normalizeFunction: 'trim',            sortOrder: 8 },
  { fieldKey: 'recent_purchase_amount', category: 'purchase', displayName: '최근구매금액', dataType: 'number', storageType: 'column', columnName: 'recent_purchase_amount', normalizeFunction: 'normalizeAmount', sortOrder: 9 },
  { fieldKey: 'total_purchase_amount',  category: 'purchase', displayName: '누적구매금액', dataType: 'number', storageType: 'column', columnName: 'total_purchase_amount',  normalizeFunction: 'normalizeAmount', sortOrder: 10 },
  // ★ B-D70-17: purchase_count는 customer-filter/CustomerDBModal에서 사용되지만 FIELD_MAP에 누락
  { fieldKey: 'purchase_count',         category: 'purchase', displayName: '구매횟수',     dataType: 'number', storageType: 'column', columnName: 'purchase_count',         normalizeFunction: 'parseInt',        sortOrder: 10.5 },
  // ★ D71: recent_purchase_date는 DB 컬럼 존재하지만 FIELD_MAP 누락 → 엑셀 업로드 시 매핑 불가 수정
  { fieldKey: 'recent_purchase_date',   category: 'purchase', displayName: '최근구매일',   dataType: 'date',   storageType: 'column', columnName: 'recent_purchase_date',   normalizeFunction: 'normalizeDate',   sortOrder: 10.7 },

  // ── store (매장/등록정보) — 5개 ──
  { fieldKey: 'store_code',        category: 'store', displayName: '브랜드',       dataType: 'string', storageType: 'column', columnName: 'store_code',        normalizeFunction: 'trim',           sortOrder: 11 },
  { fieldKey: 'registration_type', category: 'store', displayName: '등록구분',     dataType: 'string', storageType: 'column', columnName: 'registration_type', normalizeFunction: 'trim',           sortOrder: 12 },
  { fieldKey: 'registered_store',  category: 'store', displayName: '등록매장정보', dataType: 'string', storageType: 'column', columnName: 'registered_store',  normalizeFunction: 'trim',           sortOrder: 13 },
  { fieldKey: 'store_phone',       category: 'store', displayName: '매장전화번호', dataType: 'string', storageType: 'column', columnName: 'store_phone',       normalizeFunction: 'normalizeStorePhone', sortOrder: 14 },
  // ★ B-D70-17: store_name은 customer-filter/CustomerDBModal에서 사용되지만 FIELD_MAP에 누락
  { fieldKey: 'store_name',        category: 'store', displayName: '매장명',       dataType: 'string', storageType: 'column', columnName: 'store_name',        normalizeFunction: 'trim',           sortOrder: 14.5 },

  // ── membership (등급/포인트) — 2개 ──
  // ★ D131 후속(2026-04-21): 고객사별 등급 체계(시세이도 '일반/실버/골든', 타사 '블루/블랙' 등)는
  //   우리가 미리 대비 불가. 원본 값 그대로 저장/표시가 SaaS 원칙(Harold님 결정).
  //   normalizeGrade 함수/GRADE_MAP은 남겨두되 FIELD_MAP에서 호출 끊음 → trim으로 교체.
  // ★ 2026-07-08: aliases 추가 — AI Operator 문안/미리보기는 '등급'·'포인트' 라벨을 쓰는데 발송 사전엔 displayName('고객등급'·'보유포인트')만 있어 %등급%·%포인트%가 발송 시 빈칸이던 문제 해결(name의 '이름'·'성함' 선례 동일).
  { fieldKey: 'grade',  category: 'membership', displayName: '고객등급',   aliases: ['등급'],   dataType: 'string', storageType: 'column', columnName: 'grade',  normalizeFunction: 'trim',           sortOrder: 15 },
  { fieldKey: 'points', category: 'membership', displayName: '보유포인트', aliases: ['포인트'], dataType: 'number', storageType: 'column', columnName: 'points', normalizeFunction: 'parseInt',       sortOrder: 16 },

  // ── marketing (수신동의) — 1개 ──
  { fieldKey: 'sms_opt_in', category: 'marketing', displayName: '수신동의여부', dataType: 'boolean', storageType: 'column', columnName: 'sms_opt_in', normalizeFunction: 'normalizeSmsOptIn', sortOrder: 17 },

  // ── custom (커스텀) — 15개 슬롯 ──
  { fieldKey: 'custom_1',  category: 'custom', displayName: '커스텀1',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_1',  sortOrder: 18 },
  { fieldKey: 'custom_2',  category: 'custom', displayName: '커스텀2',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_2',  sortOrder: 19 },
  { fieldKey: 'custom_3',  category: 'custom', displayName: '커스텀3',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_3',  sortOrder: 20 },
  { fieldKey: 'custom_4',  category: 'custom', displayName: '커스텀4',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_4',  sortOrder: 21 },
  { fieldKey: 'custom_5',  category: 'custom', displayName: '커스텀5',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_5',  sortOrder: 22 },
  { fieldKey: 'custom_6',  category: 'custom', displayName: '커스텀6',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_6',  sortOrder: 23 },
  { fieldKey: 'custom_7',  category: 'custom', displayName: '커스텀7',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_7',  sortOrder: 24 },
  { fieldKey: 'custom_8',  category: 'custom', displayName: '커스텀8',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_8',  sortOrder: 25 },
  { fieldKey: 'custom_9',  category: 'custom', displayName: '커스텀9',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_9',  sortOrder: 26 },
  { fieldKey: 'custom_10', category: 'custom', displayName: '커스텀10', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_10', sortOrder: 27 },
  { fieldKey: 'custom_11', category: 'custom', displayName: '커스텀11', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_11', sortOrder: 28 },
  { fieldKey: 'custom_12', category: 'custom', displayName: '커스텀12', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_12', sortOrder: 29 },
  { fieldKey: 'custom_13', category: 'custom', displayName: '커스텀13', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_13', sortOrder: 30 },
  { fieldKey: 'custom_14', category: 'custom', displayName: '커스텀14', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_14', sortOrder: 31 },
  { fieldKey: 'custom_15', category: 'custom', displayName: '커스텀15', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_15', sortOrder: 32 },
];

// ─── 헬퍼 함수들 ───

/** field_key로 매핑 찾기 */
export function getFieldByKey(fieldKey: string): StandardFieldMapping | undefined {
  return FIELD_MAP.find(f => f.fieldKey === fieldKey);
}

/** 카테고리별 필드 목록 */
export function getFieldsByCategory(category: FieldCategory): StandardFieldMapping[] {
  return FIELD_MAP.filter(f => f.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** customers 테이블 직접 컬럼 필드만 (storageType === 'column') */
/**
 * ★ D111 P2: FIELD_MAP.aliases 자동 주입 컨트롤타워
 *
 * 배경: isoi 사례 — customer_schema.field_mappings가 비어있는 회사에서
 *       `%이름%` 변수가 FIELD_MAP displayName('고객명')만 등록되어 치환 실패.
 *
 * 역할: 임의의 fieldMappings 맵에 FIELD_MAP.aliases(한글 동의어)를 자동 주입한다.
 *       이미 등록된 키는 덮어쓰지 않으므로 customer_schema 우선순위를 유지한다.
 *
 * 호출부:
 *   - services/ai.ts extractVarCatalog (변수 카탈로그 최종 반환 전)
 *   - 향후 추가되는 fieldMappings 구성 경로
 *
 * ⚠️ 이 함수를 호출하는 대신 인라인으로 alias 주입 로직을 작성하지 말 것 (재발 방지).
 *
 * @param fieldMappings  { varName: entry } 맵 (in-place 수정)
 * @param availableVars  가용 변수명 배열 (in-place 수정)
 * @param findEntryByColumn  displayName에 entry가 없을 때 column으로 찾는 콜백
 */
export function applyFieldAliases<T>(
  fieldMappings: Record<string, T>,
  availableVars: string[],
  findEntryByColumn: (columnName: string) => T | undefined
): void {
  for (const f of FIELD_MAP) {
    if (f.storageType === 'custom_fields') continue;
    if (!f.aliases || f.aliases.length === 0) continue;

    const baseEntry = fieldMappings[f.displayName] || findEntryByColumn(f.columnName);
    if (!baseEntry) continue;

    for (const alias of f.aliases) {
      if (!fieldMappings[alias]) {
        fieldMappings[alias] = baseEntry;
      }
      if (!availableVars.includes(alias)) {
        availableVars.push(alias);
      }
    }
  }
}

/**
 * ★ 2026-07-09: FIELD_MAP displayName을 발송 사전의 "항상 유효한 토큰"으로 보강 — 개인화 토큰 단일 표준 언어(displayName) 정합.
 *
 * 배경: company-data-profile(활용가능컬럼 버튼·AI 프롬프트)·sample-customer(미리보기 키)를 FIELD_MAP displayName으로 통일함에 따라,
 *       발송 사전(extractVarCatalog)이 customer_schema의 다른 라벨을 쓰는 회사에서도 %displayName%(고객등급·등록매장정보 등)이 항상 매칭되어야 한다.
 *       스키마 라벨/alias는 그대로 유지(하위호환) — 컬럼 기준으로 이미 존재하는 엔트리에 displayName 키만 얹는다.
 *
 * ⚠️ applyFieldAliases와 동일 계열 — 인라인으로 displayName 주입 로직 작성 금지(재발 방지). 이 함수만 호출.
 *
 * @param fieldMappings  { varName: entry } 맵 (in-place 수정)
 * @param availableVars  가용 변수명 배열 (in-place 수정)
 * @param findEntryByColumn  column으로 기존 entry를 찾는 콜백
 */
export function applyFieldDisplayNames<T>(
  fieldMappings: Record<string, T>,
  availableVars: string[],
  findEntryByColumn: (columnName: string) => T | undefined
): void {
  for (const f of FIELD_MAP) {
    if (f.storageType === 'custom_fields') continue;
    if (f.fieldKey === 'phone' || f.fieldKey === 'sms_opt_in') continue;
    if (fieldMappings[f.displayName]) continue; // 이미 있으면(디폴트 카탈로그 등) 스킵
    const entry = findEntryByColumn(f.columnName);
    if (!entry) continue;
    fieldMappings[f.displayName] = entry;
    if (!availableVars.includes(f.displayName)) availableVars.push(f.displayName);
  }
}

export function getColumnFields(): StandardFieldMapping[] {
  return FIELD_MAP.filter(f => f.storageType === 'column');
}

/** custom_fields JSONB 필드만 (커스텀 15개) */
export function getCustomFields(): StandardFieldMapping[] {
  return FIELD_MAP.filter(f => f.storageType === 'custom_fields');
}

/** field_key → 실제 customers 컬럼명 (직접 컬럼일 때) */
export function fieldKeyToColumn(fieldKey: string): string | null {
  const field = FIELD_MAP.find(f => f.fieldKey === fieldKey && f.storageType === 'column');
  return field ? field.columnName : null;
}

/** field_key → custom_fields 내 키 (JSONB일 때) */
export function fieldKeyToCustomKey(fieldKey: string): string | null {
  const field = FIELD_MAP.find(f => f.fieldKey === fieldKey && f.storageType === 'custom_fields');
  return field ? field.columnName : null;
}

/** 모든 카테고리 목록 (정렬 순서대로) */
export function getAllCategories(): FieldCategory[] {
  return ['basic', 'purchase', 'store', 'membership', 'marketing', 'custom'];
}

/**
 * INSERT용: customers 테이블 직접 컬럼 목록
 * upload.ts, sync.ts에서 INSERT 구문 생성 시 사용
 */
export function getInsertColumns(): string[] {
  return getColumnFields().map(f => f.columnName);
}

/**
 * WHERE절 생성용: field_key → SQL 조건절 참조 위치
 * column이면 바로 컬럼명, custom_fields면 custom_fields->>'키'
 */
export function fieldKeyToSqlRef(fieldKey: string): string | null {
  const field = getFieldByKey(fieldKey);
  if (!field) return null;
  if (field.storageType === 'column') return field.columnName;
  return `custom_fields->>'${field.columnName}'`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CT-07: customer_field_definitions UPSERT 컨트롤타워
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 커스텀 필드 정의(customer_field_definitions) UPSERT — 유일한 쓰기 진입점
 *
 * - upload.ts, sync.ts 등 모든 커스텀 필드 라벨 저장은 이 함수만 사용
 * - ON CONFLICT DO UPDATE: 라벨이 변경되면 항상 최신으로 갱신
 *   (기존 "최초 등록 우선" 정책은 잘못된 라벨이 영원히 고착되는 버그 유발 → 제거)
 * - display_order는 custom_ 접미사 숫자 기반 자동 계산
 *
 * @param companyId    회사 ID
 * @param definitions  { fieldKey: 'custom_1', label: '평균주문금액', fieldType?: 'VARCHAR' }[]
 * @returns upsert된 건수
 */
// ★ D131 후속(2026-04-21) → D133 강화(2026-04-22): customer_field_definitions.field_type CHECK 제약 허용값 매핑.
//   DB 제약: CHECK (field_type IN ('INT', 'VARCHAR', 'DATE', 'BOOLEAN'))
//   Agent/upload/sync 어디서든 보낼 수 있는 값을 전부 DB 허용값으로 수렴시킴.
//   D133 추가: 'NUMBER'/'STRING'/'DATETIME' 같은 대문자 변형도 직접 매핑 등록(대소문자 폴백에 의존하지 않고 명시).
const FIELD_TYPE_DB_MAP: Record<string, string> = {
  // 문자열 계열 → VARCHAR
  'string': 'VARCHAR', 'str': 'VARCHAR', 'varchar': 'VARCHAR', 'text': 'VARCHAR', 'char': 'VARCHAR',
  'STRING': 'VARCHAR', 'STR': 'VARCHAR', 'TEXT': 'VARCHAR', 'CHAR': 'VARCHAR',
  // 숫자 계열 → INT (DB 제약이 NUMBER/NUMERIC/FLOAT 미허용이므로 INT로 통일)
  'number': 'INT', 'num': 'INT', 'int': 'INT', 'integer': 'INT', 'numeric': 'INT', 'float': 'INT', 'double': 'INT', 'decimal': 'INT', 'bigint': 'INT',
  'NUMBER': 'INT', 'NUM': 'INT', 'INTEGER': 'INT', 'NUMERIC': 'INT', 'FLOAT': 'INT', 'DOUBLE': 'INT', 'DECIMAL': 'INT', 'BIGINT': 'INT',
  // 날짜 계열 → DATE
  'date': 'DATE', 'datetime': 'DATE', 'timestamp': 'DATE', 'timestamptz': 'DATE', 'time': 'DATE',
  'DATETIME': 'DATE', 'TIMESTAMP': 'DATE', 'TIMESTAMPTZ': 'DATE', 'TIME': 'DATE',
  // 불리언 계열 → BOOLEAN
  'boolean': 'BOOLEAN', 'bool': 'BOOLEAN', 'bit': 'BOOLEAN',
  'BOOL': 'BOOLEAN', 'BIT': 'BOOLEAN',
  // 이미 DB 허용값 (대문자)이면 그대로
  'VARCHAR': 'VARCHAR', 'INT': 'INT', 'DATE': 'DATE', 'BOOLEAN': 'BOOLEAN',
};

function toDbFieldType(input: string | undefined | null): string {
  if (!input) return 'VARCHAR';
  const trimmed = String(input).trim();
  if (!trimmed) return 'VARCHAR';
  // 1차: 원본, 2차: 소문자, 3차: 대문자 폴백 (엣지케이스 대비)
  const mapped =
    FIELD_TYPE_DB_MAP[trimmed] ||
    FIELD_TYPE_DB_MAP[trimmed.toLowerCase()] ||
    FIELD_TYPE_DB_MAP[trimmed.toUpperCase()];
  if (!mapped) {
    console.warn(`[CT-07] 알 수 없는 field_type "${input}" → VARCHAR 폴백. FIELD_TYPE_DB_MAP 확장 검토 필요`);
  }
  return mapped || 'VARCHAR'; // 모르는 값은 안전하게 VARCHAR
}

export async function upsertCustomFieldDefinitions(
  companyId: string,
  definitions: Array<{ fieldKey: string; label: string; fieldType?: string }>
): Promise<number> {
  // ★ D131 후속(2026-04-21): 개별 INSERT try/catch로 단일 행 실패가 전체 500을 유발하지 않도록.
  //   원인 분석용 상세 로그 + 실패한 정의는 스킵하고 나머지 계속 처리.
  //   2026-04-21 Sync Agent 리눅스 테스트에서 이 함수 호출이 500 내던 이슈 근본 방어.
  let upsertedCount = 0;
  const failures: Array<{ fieldKey: string; error: string }> = [];
  for (const def of definitions) {
    if (!def.fieldKey.startsWith('custom_')) continue;
    const displayOrder = parseInt(def.fieldKey.replace('custom_', '')) || 0;
    // ★ D131 후속: Agent가 보낸 일반 타입명을 DB CHECK 제약 허용값으로 변환
    const dbFieldType = toDbFieldType(def.fieldType);
    try {
      await query(
        `INSERT INTO customer_field_definitions (id, company_id, field_key, field_label, field_type, display_order, is_hidden, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, false, NOW())
         ON CONFLICT (company_id, field_key) DO UPDATE SET
           field_label = EXCLUDED.field_label,
           field_type = EXCLUDED.field_type,
           display_order = EXCLUDED.display_order`,
        [companyId, def.fieldKey, def.label, dbFieldType, displayOrder]
      );
      upsertedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ fieldKey: def.fieldKey, error: msg });
      // ★ D133: 진단성 강화 — 원본 input + 매핑된 dbType + label 길이 동시 기록
      console.error(
        `[CT-07] ${def.fieldKey} upsert 실패 (company=${companyId}, inputType="${def.fieldType ?? 'undefined'}", dbType="${dbFieldType}", labelLen=${(def.label ?? '').length}):`,
        msg,
      );
    }
  }
  if (upsertedCount > 0) {
    console.log(`[CT-07] 커스텀 필드 정의 ${upsertedCount}개 upsert (company: ${companyId})`);
  }
  if (failures.length > 0) {
    console.warn(`[CT-07] ${failures.length}건 실패 (company: ${companyId}):`, failures);
  }
  return upsertedCount;
}

// ============================================================
// ★ B+0407-1: FIELD_DISPLAY_MAP — DB enum 값 → 표시용 한글 역변환 컨트롤타워
// ============================================================
//
// DB에는 정규화된 enum 값(예: gender 'M'/'F')이 저장되지만,
// 메시지/미리보기에 표시할 때는 한글('남성'/'여성')로 보여야 한다.
//
// 기존 누락 사례:
//   - 직접타겟발송 미리보기/스팸필터/담당자테스트에서 %성별% → "F" 출력 (0407 PDF #4)
//
// 사용처 (백엔드/프론트 양쪽):
//   - backend/utils/messageUtils.ts replaceVariables — 발송 변수 치환
//   - frontend/utils/formatDate.ts replaceMessageVars/formatPreviewValue — 미리보기
//
// ⚠️ 절대 금지:
//   - 라우트/컴포넌트에서 인라인으로 'F'→'여성' 매핑 작성 금지
//   - 새 enum 필드 추가 시 반드시 이 MAP에 등록 (한 곳만 수정하면 백/프론트 자동 반영)

/**
 * 필드별 DB값 → 표시값 매핑.
 * key: FIELD_MAP fieldKey
 * value: { dbValue(소문자): displayValue }
 *
 * 대소문자 무관 매칭을 위해 lowercase 키 사용.
 */
export const FIELD_DISPLAY_MAP: Record<string, Record<string, string>> = {
  gender: {
    m: '남성',
    f: '여성',
    male: '남성',
    female: '여성',
    남: '남성',
    여: '여성',
  },
  // 향후 확장 예시:
  // is_married: { true: '기혼', false: '미혼' },
};

/**
 * DB값을 표시용 한글로 역변환한다.
 * 매칭되는 매핑이 없으면 원본 String(dbValue)을 그대로 반환.
 *
 * @example
 *   reverseDisplayValue('gender', 'F') → '여성'
 *   reverseDisplayValue('gender', 'M') → '남성'
 *   reverseDisplayValue('grade', 'VIP') → 'VIP' (매핑 없음)
 */
export function reverseDisplayValue(fieldKey: string, dbValue: any): string {
  if (dbValue === null || dbValue === undefined) return '';
  const map = FIELD_DISPLAY_MAP[fieldKey];
  if (!map) return String(dbValue);
  const key = String(dbValue).trim().toLowerCase();
  return map[key] || String(dbValue);
}

// ============================================================
// ★ D142 (2026-04-28): displayFormat 컨트롤타워 — Harold님 원칙 그대로 구현
//
// 원칙: "고정 22개 = 그 필드 룰대로 / 커스텀 = 있는 그대로"
//
// 사용처:
//   - messageUtils.ts replaceVariables (변수 치환 시 표시값 결정)
//   - 추후 백엔드 어디서든 "DB값 → 표시값" 변환은 renderFieldValue() 호출
//   - frontend/utils/formatDate.ts 동일 로직 미러 (FRONT_DISPLAY_FORMAT_MAP)
//
// ⚠️ 자동 type 추론 (data_type === 'number' 보고 콤마 등) 절대 금지.
//    fieldKey 누락되면 → FIELD_DISPLAY_FORMAT_MAP 매칭 실패 → String(value) 원본 반환.
//    이게 안전한 기본값. custom_1~15는 의도적으로 매핑 등록 안 하므로 자동으로 원본 보존.
// ============================================================

/** 전화번호 표시 — 휴대폰/유선/대표번호 모두 하이픈 포함 형태로 (frontend formatPhoneNumber와 미러) */
function fmtPhoneDisplay(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  const cleaned = String(value).replace(/\D/g, '');
  if (!cleaned) return String(value);
  // 휴대폰 11자리: 010-XXXX-XXXX
  if (cleaned.length === 11 && cleaned.startsWith('01')) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  // 휴대폰 10자리 (구형): 01X-XXX-XXXX
  if (cleaned.length === 10 && cleaned.startsWith('01')) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  // 서울 02 (9자리): 02-XXX-XXXX
  if (cleaned.length === 9 && cleaned.startsWith('02')) return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)}-${cleaned.slice(5)}`;
  // 서울 02 (10자리): 02-XXXX-XXXX
  if (cleaned.length === 10 && cleaned.startsWith('02')) return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
  // 대표번호 8자리 (1588/1599/1644/1666/1670/1800/1833/1855/1877/1899): 1XXX-XXXX
  if (cleaned.length === 8 && cleaned.startsWith('1')) return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  // 050X 인터넷전화 12자리: 050X-XXXX-XXXX
  if (cleaned.length === 12 && cleaned.startsWith('050')) return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
  // 기타 지역번호 10자리: 0XX-XXX-XXXX
  if (cleaned.length === 10 && cleaned.startsWith('0')) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  // 기타 지역번호 11자리: 0XX-XXXX-XXXX
  if (cleaned.length === 11 && cleaned.startsWith('0')) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  return String(value);
}

/** 날짜 표시 — YYYY-MM-DD 형식 (KST 기준, 하루 밀림 방지) */
function fmtDateDisplay(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  const str = String(value).trim();
  // 순수 YYYY-MM-DD (UTC 변환 X)
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // ISO timestamp → KST 변환 후 YYYY-MM-DD
  const d = new Date(str.includes('T') || str.endsWith('Z') ? str : str.replace(' ', 'T') + 'Z');
  if (!isNaN(d.getTime())) {
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
  }
  return str;
}

/** 금액/포인트 표시 — 천 단위 콤마 (정수: 50,000 / 소수: trailing zero 제거 50,000.5) */
function fmtMoneyDisplay(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  const str = String(value).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) return String(value);
  const num = Number(str);
  if (isNaN(num) || !isFinite(num)) return String(value);
  if (Number.isInteger(num)) return num.toLocaleString('ko-KR');
  const [intPart, decPart] = num.toString().split('.');
  return Number(intPart).toLocaleString('ko-KR') + (decPart ? '.' + decPart : '');
}

/** 정수 표시 — 콤마 X (나이/구매횟수: "30", "5") */
function fmtIntDisplay(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  return String(value).trim();
}

/** 성별 표시 — DB enum (M/F/male/female/남/여) → 한글 (남성/여성) */
function fmtGenderDisplay(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  const k = String(value).trim().toLowerCase();
  const map: Record<string, string> = { m: '남성', f: '여성', male: '남성', female: '여성', 남: '남성', 여: '여성' };
  return map[k] || String(value);
}

/** 수신동의 표시 — boolean → '동의'/'비동의' */
function fmtSmsOptInDisplay(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  if (value === true || value === 1 || value === 'Y' || value === 'y') return '동의';
  if (value === false || value === 0 || value === 'N' || value === 'n') return '비동의';
  const k = String(value).toLowerCase();
  if (k === 'true') return '동의';
  if (k === 'false') return '비동의';
  return String(value);
}

/** 일반 string 필드 — trim만 (이름/주소/매장명 등) */
function fmtStringDisplay(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * ★ FIELD_DISPLAY_FORMAT_MAP — 22개 고정 필드의 displayFormat 1:1 매핑.
 *
 * Harold님 원칙: "고정 22개 = 그 필드 룰대로 / 커스텀 = 있는 그대로"
 *
 * - 키: FIELD_MAP의 fieldKey
 * - 값: 해당 필드 표시 함수
 * - 등록되지 않은 fieldKey (= custom_1~15, 미정의) → renderFieldValue가 String(value) 반환
 *
 * ⚠️ 새 고정 필드 추가 시 이 MAP에만 등록하면 백엔드 자동 반영. 호출부 수정 불필요.
 */
export const FIELD_DISPLAY_FORMAT_MAP: Record<string, (value: any) => string> = {
  // ── basic 8 ──
  name:       fmtStringDisplay,
  phone:      fmtPhoneDisplay,
  gender:     fmtGenderDisplay,
  age:        fmtIntDisplay,
  birth_date: fmtDateDisplay,
  email:      fmtStringDisplay,
  address:    fmtStringDisplay,
  region:     fmtStringDisplay,
  // ── purchase 5 ──
  recent_purchase_store:  fmtStringDisplay,
  recent_purchase_amount: fmtMoneyDisplay,
  total_purchase_amount:  fmtMoneyDisplay,
  purchase_count:         fmtIntDisplay,
  recent_purchase_date:   fmtDateDisplay,
  // ── store 5 ──
  store_code:        fmtStringDisplay,
  registration_type: fmtStringDisplay,
  registered_store:  fmtStringDisplay,
  store_phone:       fmtPhoneDisplay,
  store_name:        fmtStringDisplay,
  // ── membership 2 ──
  grade:  fmtStringDisplay,
  points: fmtMoneyDisplay,
  // ── marketing 1 ──
  sms_opt_in: fmtSmsOptInDisplay,
  // ── custom_1 ~ custom_15: 의도적으로 등록 안 함 → renderFieldValue가 String(value) 원본 반환 ──
};

/**
 * ★ renderFieldValue — DB값 → 표시값 단일 진입점.
 *
 * 흐름:
 *   1. value null/undefined → ''
 *   2. fieldKey 없음 → String(value) (안전한 기본값)
 *   3. FIELD_DISPLAY_FORMAT_MAP[fieldKey] 매칭 → 해당 함수 호출
 *   4. 매칭 실패 (= custom_1~15, 미지정) → String(value) 원본
 *
 * @example
 *   renderFieldValue('01012345678', 'phone')              → '010-1234-5678'
 *   renderFieldValue('1800-8125', 'store_phone')          → '1800-8125'
 *   renderFieldValue('M', 'gender')                       → '남성'
 *   renderFieldValue('50000.00', 'recent_purchase_amount')→ '50,000'
 *   renderFieldValue('1995-03-01', 'birth_date')          → '1995-03-01'
 *   renderFieldValue('20260518140000', 'custom_2')        → '20260518140000' (원본)
 *   renderFieldValue('홍길동', 'name')                     → '홍길동'
 */
export function renderFieldValue(value: any, fieldKey?: string): string {
  if (value === null || value === undefined) return '';
  if (!fieldKey) return String(value);
  const formatter = FIELD_DISPLAY_FORMAT_MAP[fieldKey];
  if (formatter) return formatter(value);
  return String(value);
}
