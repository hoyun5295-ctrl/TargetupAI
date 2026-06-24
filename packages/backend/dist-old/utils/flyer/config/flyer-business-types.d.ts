/**
 * ★ CT-F13 — 전단AI 업종 레지스트리 컨트롤타워
 *
 * 업종(business_type) 조회 + 템플릿 메타데이터의 유일한 진입점.
 * - DB: flyer_business_types 테이블에서 업종별 카테고리 프리셋 + 사용 가능 템플릿 조회
 * - 코드: TEMPLATE_REGISTRY에 템플릿 label/desc/color 메타데이터 정의
 *
 * 업종 추가: DB INSERT만으로 확장 (코드 수정 없음)
 * 템플릿 추가: TEMPLATE_REGISTRY + CT-F14 렌더러 추가
 */
export interface BusinessType {
    type_code: string;
    type_name: string;
    category_presets: string[];
    default_template: string;
    is_active: boolean;
    sort_order: number;
}
export interface TemplateInfo {
    value: string;
    label: string;
    desc: string;
    color: string;
}
export declare const TEMPLATE_REGISTRY: Record<string, TemplateInfo>;
export declare function invalidateBusinessTypeCache(): void;
/**
 * 전체 활성 업종 목록 (캐시 5분).
 */
export declare function getBusinessTypes(): Promise<BusinessType[]>;
/**
 * 단건 조회. 캐시에서 검색.
 */
export declare function getBusinessType(typeCode: string): Promise<BusinessType | null>;
/**
 * 업종별 카테고리 프리셋. 미존재 시 빈 배열.
 */
export declare function getCategoryPresets(typeCode: string): Promise<string[]>;
/**
 * 업종별 사용 가능 템플릿 (메타데이터 포함).
 * DB의 available_templates가 없으면 공통 3종 + 업종 prefix 자동 매칭.
 */
export declare function getAvailableTemplates(typeCode: string): Promise<TemplateInfo[]>;
/**
 * 전체 업종 목록 (관리용 — is_active 무관).
 */
export declare function getAllBusinessTypes(): Promise<BusinessType[]>;
//# sourceMappingURL=flyer-business-types.d.ts.map