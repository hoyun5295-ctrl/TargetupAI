/**
 * standard-field-map.ts
 * =====================
 * 유일한 필드 매핑 정의. 모든 파일은 이것만 import.
 *
 * 기준: FIELD-INTEGRATION.md (2026-02-26 Harold님 확정)
 * - 필수 직접 컬럼 17개 + 커스텀 슬롯 15개 = 최대 32개
 * - 카테고리 6개: basic, purchase, store, membership, marketing, custom
 * - 하드코딩 금지. 이 파일이 유일한 기준.
 */

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
  displayName: string;         // 한글 라벨
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

// ─── 핵심 매핑표 — 필수 직접 컬럼 17개 + 커스텀 15개 ───

export const FIELD_MAP: StandardFieldMapping[] = [
  // ── basic (기본정보) — 7개 ──
  { fieldKey: 'name',       category: 'basic', displayName: '고객명',       dataType: 'string', storageType: 'column', columnName: 'name',       normalizeFunction: 'trim',            sortOrder: 1 },
  { fieldKey: 'phone',      category: 'basic', displayName: '고객전화번호', dataType: 'string', storageType: 'column', columnName: 'phone',      normalizeFunction: 'normalizePhone',  sortOrder: 2 },
  { fieldKey: 'gender',     category: 'basic', displayName: '성별',         dataType: 'string', storageType: 'column', columnName: 'gender',     normalizeFunction: 'normalizeGender', sortOrder: 3 },
  { fieldKey: 'age',        category: 'basic', displayName: '나이',         dataType: 'number', storageType: 'column', columnName: 'age',        normalizeFunction: 'parseInt',        sortOrder: 4 },
  { fieldKey: 'birth_date', category: 'basic', displayName: '생일',         dataType: 'date',   storageType: 'column', columnName: 'birth_date', normalizeFunction: 'normalizeDate',   sortOrder: 5 },
  { fieldKey: 'email',      category: 'basic', displayName: '이메일주소',   dataType: 'string', storageType: 'column', columnName: 'email',      normalizeFunction: 'normalizeEmail',  sortOrder: 6 },
  { fieldKey: 'address',    category: 'basic', displayName: '주소',         dataType: 'string', storageType: 'column', columnName: 'address',    normalizeFunction: 'trim',            sortOrder: 7 },

  // ── purchase (구매정보) — 3개 ──
  { fieldKey: 'recent_purchase_store',  category: 'purchase', displayName: '최근구매매장', dataType: 'string', storageType: 'column', columnName: 'recent_purchase_store',  normalizeFunction: 'trim',            sortOrder: 8 },
  { fieldKey: 'recent_purchase_amount', category: 'purchase', displayName: '최근구매금액', dataType: 'number', storageType: 'column', columnName: 'recent_purchase_amount', normalizeFunction: 'normalizeAmount', sortOrder: 9 },
  { fieldKey: 'total_purchase_amount',  category: 'purchase', displayName: '누적구매금액', dataType: 'number', storageType: 'column', columnName: 'total_purchase_amount',  normalizeFunction: 'normalizeAmount', sortOrder: 10 },

  // ── store (매장/등록정보) — 4개 ──
  { fieldKey: 'store_code',        category: 'store', displayName: '브랜드',       dataType: 'string', storageType: 'column', columnName: 'store_code',        normalizeFunction: 'trim',           sortOrder: 11 },
  { fieldKey: 'registration_type', category: 'store', displayName: '등록구분',     dataType: 'string', storageType: 'column', columnName: 'registration_type', normalizeFunction: 'trim',           sortOrder: 12 },
  { fieldKey: 'registered_store',  category: 'store', displayName: '등록매장정보', dataType: 'string', storageType: 'column', columnName: 'registered_store',  normalizeFunction: 'trim',           sortOrder: 13 },
  { fieldKey: 'store_phone',       category: 'store', displayName: '매장전화번호', dataType: 'string', storageType: 'column', columnName: 'store_phone',       normalizeFunction: 'normalizePhone', sortOrder: 14 },

  // ── membership (등급/포인트) — 2개 ──
  { fieldKey: 'grade',  category: 'membership', displayName: '고객등급',   dataType: 'string', storageType: 'column', columnName: 'grade',  normalizeFunction: 'normalizeGrade', sortOrder: 15 },
  { fieldKey: 'points', category: 'membership', displayName: '보유포인트', dataType: 'number', storageType: 'column', columnName: 'points', normalizeFunction: 'parseInt',       sortOrder: 16 },

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

/** customers 테이블 직접 컬럼 필드만 (필수 17개) */
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
