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
export interface EnabledField {
    field_key: string;
    display_name: string;
    field_label: string;
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
/**
 * 고객사가 실제로 사용 중인 필드 목록을 동적으로 탐지한다.
 *
 * @returns { fields, fieldDefLabels, fieldDefTypes }
 */
export declare function detectEnabledFields(params: DetectEnabledFieldsParams): Promise<EnabledFieldsResult>;
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
export declare function buildDynamicSelectExpr(fields: EnabledField[], options?: {
    /** 수신거부 CASE의 user_id 파라미터 인덱스 ($N). 전달 시 sms_opt_in을 unsubscribes 반영으로 덮어씀. */
    unsubParamIndex?: number;
    /** 테이블 alias (기본: customers_unified) */
    tableAlias?: string;
}): {
    selectExpr: string;
    hasCustomFields: boolean;
};
//# sourceMappingURL=enabled-fields.d.ts.map