import type { Section } from './dm-section-registry';
export declare const DEFAULT_FALLBACKS: Record<string, string>;
export declare function extractVariables(text: string): string[];
export declare function hasAnyVariable(text: string): boolean;
export declare function resolveSectionVariables(section: Section, customer: Record<string, any> | null, fieldMappings: Record<string, any>): Section;
/**
 * 변수가 고객 데이터에 없고 fallback도 빈 값일 때 섹션을 숨길지 판정.
 * 섹션의 variable_fallbacks에 hide_section_if_empty=true인 변수가 포함되어 있고
 * 그 변수가 빈 값이면 섹션을 제거.
 */
export declare function shouldHideSection(section: Section, customer: Record<string, any> | null, fieldMappings: Record<string, any>): boolean;
export declare function resolveSections(sections: Section[], customer: Record<string, any> | null, companyId: string): Promise<Section[]>;
export type AvailableVariable = {
    name: string;
    displayName: string;
    sample: string;
    description?: string;
    category: 'profile' | 'purchase' | 'custom' | 'system';
};
export declare function getAvailableVariables(companyId: string): Promise<AvailableVariable[]>;
//# sourceMappingURL=dm-variable-resolver.d.ts.map