/**
 * utils/dashboard-card-pool.ts
 * ============================
 * 대시보드 동적 카드 풀 정의 (D41)
 *
 * FIELD_MAP 필수 17개 기반 카드 17종.
 * 슈퍼관리자가 고객사별로 원하는 만큼 선택 (프론트에서 6개씩 페이징 표시).
 *
 * ★ 동적 필터링: 직접 컬럼 + 커스텀 필드(JSONB) 양쪽 데이터 유무를 체크하여
 *   해당 고객사에 실제 데이터가 있는 카드만 풀에 표시.
 *   - requiresField: 직접 컬럼명
 *   - customLabelPatterns: 커스텀 필드 라벨 매칭 패턴 (부분일치)
 *
 * 이 파일은 companies.ts + admin.ts에서 import.
 */
export type CardType = 'count' | 'rate' | 'sum' | 'distribution';
export interface DashboardCardDef {
    cardId: string;
    label: string;
    type: CardType;
    icon: string;
    emoji: string;
    description: string;
    requiresField?: string;
    customLabelPatterns?: string[];
}
export declare const DASHBOARD_CARD_POOL: DashboardCardDef[];
/** 유효한 cardId Set */
export declare const VALID_CARD_IDS: Set<string>;
/** cardId로 카드 정의 조회 */
export declare function getCardDef(cardId: string): DashboardCardDef | undefined;
export declare const DYNAMIC_CARD_PREFIX = "dyn_";
export type DynamicAggType = 'dist' | 'sum' | 'has' | 'recent30d' | 'rate';
export declare function isDynamicCardId(cardId: string): boolean;
export interface ParsedDynamicCardId {
    fieldKey: string;
    aggType: DynamicAggType;
}
/**
 * `dyn_{fieldKey}_{aggType}` 파싱. 실패 시 null.
 * aggType이 suffix에 위치하므로 뒤에서 매칭 (fieldKey에 `_` 포함 가능성 대비).
 */
export declare function parseDynamicCardId(cardId: string): ParsedDynamicCardId | null;
/**
 * 커스텀 필드 배열에서 동적 카드 목록 생성
 * - is_custom=true인 필드만 대상 (직접 컬럼은 고정 풀로 커버됨)
 * - data_type에 따라 자연스러운 집계 카드 1개씩 생성
 *
 * @param fields CT-18 detectEnabledFields의 fields 배열
 */
export declare function generateDynamicCards(fields: Array<{
    field_key: string;
    field_label: string;
    data_type: string;
    is_custom: boolean;
}>): DashboardCardDef[];
/** 카드 ID 배열 유효성 검증 */
export declare function validateCardIds(cardIds: string[]): {
    valid: boolean;
    invalid: string[];
};
/** 의존 필드가 있는 카드들의 직접 컬럼 목록 (중복 제거) */
export declare function getRequiredFields(): string[];
/**
 * 데이터 존재 필드 기반으로 카드 풀 필터링
 * @param availableColumns - 직접 컬럼 중 데이터가 있는 필드 Set
 * @param customFieldLabels - 커스텀 필드 중 데이터가 있는 라벨 목록 (소문자)
 */
export declare function filterPoolByAvailableData(availableColumns: Set<string>, customFieldLabels: string[]): DashboardCardDef[];
//# sourceMappingURL=dashboard-card-pool.d.ts.map