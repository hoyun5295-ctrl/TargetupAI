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
/** 카테고리 6개 — FIELD-INTEGRATION.md 확정 */
export type FieldCategory = 'basic' | 'purchase' | 'store' | 'membership' | 'marketing' | 'custom';
export type StorageType = 'column' | 'custom_fields';
export type DataType = 'string' | 'number' | 'date' | 'boolean';
export interface StandardFieldMapping {
    fieldKey: string;
    category: FieldCategory;
    displayName: string;
    /**
     * ★ D111 P2: 추가 한글 별칭 (동의어) — 사용자가 %이름%, %성함% 등 다른 한글로 변수를 써도 치환되도록.
     * extractVarCatalog가 fieldMappings에 displayName + aliases 모두 등록.
     * 배경: isoi 사례 — customer_schema.field_mappings가 없는 회사에서 FIELD_MAP fallback 시
     *       displayName('고객명')만 등록되어 %이름%이 치환 안 되는 문제.
     */
    aliases?: string[];
    dataType: DataType;
    storageType: StorageType;
    columnName: string;
    normalizeFunction?: string;
    sortOrder: number;
}
export declare const CATEGORY_LABELS: Record<FieldCategory, string>;
export declare const FIELD_MAP: StandardFieldMapping[];
/** field_key로 매핑 찾기 */
export declare function getFieldByKey(fieldKey: string): StandardFieldMapping | undefined;
/** 카테고리별 필드 목록 */
export declare function getFieldsByCategory(category: FieldCategory): StandardFieldMapping[];
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
export declare function applyFieldAliases<T>(fieldMappings: Record<string, T>, availableVars: string[], findEntryByColumn: (columnName: string) => T | undefined): void;
export declare function getColumnFields(): StandardFieldMapping[];
/** custom_fields JSONB 필드만 (커스텀 15개) */
export declare function getCustomFields(): StandardFieldMapping[];
/** field_key → 실제 customers 컬럼명 (직접 컬럼일 때) */
export declare function fieldKeyToColumn(fieldKey: string): string | null;
/** field_key → custom_fields 내 키 (JSONB일 때) */
export declare function fieldKeyToCustomKey(fieldKey: string): string | null;
/** 모든 카테고리 목록 (정렬 순서대로) */
export declare function getAllCategories(): FieldCategory[];
/**
 * INSERT용: customers 테이블 직접 컬럼 목록
 * upload.ts, sync.ts에서 INSERT 구문 생성 시 사용
 */
export declare function getInsertColumns(): string[];
/**
 * WHERE절 생성용: field_key → SQL 조건절 참조 위치
 * column이면 바로 컬럼명, custom_fields면 custom_fields->>'키'
 */
export declare function fieldKeyToSqlRef(fieldKey: string): string | null;
export declare function upsertCustomFieldDefinitions(companyId: string, definitions: Array<{
    fieldKey: string;
    label: string;
    fieldType?: string;
}>): Promise<number>;
/**
 * 필드별 DB값 → 표시값 매핑.
 * key: FIELD_MAP fieldKey
 * value: { dbValue(소문자): displayValue }
 *
 * 대소문자 무관 매칭을 위해 lowercase 키 사용.
 */
export declare const FIELD_DISPLAY_MAP: Record<string, Record<string, string>>;
/**
 * DB값을 표시용 한글로 역변환한다.
 * 매칭되는 매핑이 없으면 원본 String(dbValue)을 그대로 반환.
 *
 * @example
 *   reverseDisplayValue('gender', 'F') → '여성'
 *   reverseDisplayValue('gender', 'M') → '남성'
 *   reverseDisplayValue('grade', 'VIP') → 'VIP' (매핑 없음)
 */
export declare function reverseDisplayValue(fieldKey: string, dbValue: any): string;
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
export declare const FIELD_DISPLAY_FORMAT_MAP: Record<string, (value: any) => string>;
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
export declare function renderFieldValue(value: any, fieldKey?: string): string;
//# sourceMappingURL=standard-field-map.d.ts.map