/**
 * dm-validate.ts — DM 발행 전 10영역 자동 검수 엔진
 *
 * 영역 (설계서 §10):
 *   link / personalization / coupon / countdown / layout / style
 *   / content / required_info / data / operation
 *
 * 치명(fatal)이 1건이라도 있으면 can_publish=false.
 * 권장(recommend), 성과개선(improve)은 발행 차단 X.
 */
import type { Section } from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';
export type Severity = 'fatal' | 'recommend' | 'improve';
export type ValidationArea = 'link' | 'personalization' | 'coupon' | 'countdown' | 'layout' | 'style' | 'content' | 'required_info' | 'data' | 'operation';
export type ValidationItem = {
    area: ValidationArea;
    severity: Severity;
    section_id?: string;
    message: string;
    fix_suggestion?: string;
};
export type ValidationResult = {
    level: 'pass' | 'warning' | 'error';
    items: ValidationItem[];
    can_publish: boolean;
    checked_at: string;
    stats: {
        fatal: number;
        recommend: number;
        improve: number;
    };
};
export declare function validateLinks(sections: Section[]): ValidationItem[];
export declare function validatePersonalization(sections: Section[]): ValidationItem[];
export declare function validateCoupons(sections: Section[]): ValidationItem[];
export declare function validateCountdown(sections: Section[]): ValidationItem[];
export declare function validateLayout(sections: Section[]): ValidationItem[];
export declare function validateStyle(sections: Section[], brandKit?: DmBrandKit): ValidationItem[];
export declare function validateContent(sections: Section[]): ValidationItem[];
export declare function validateRequiredInfo(sections: Section[]): ValidationItem[];
export declare function validateData(sections: Section[], sampleCustomers: Array<{
    key: string;
    data: Record<string, any> | null;
}>): ValidationItem[];
export declare function validateOperation(dm: {
    sections?: Section[] | null;
    scheduled_at?: string | null;
    publish_mode?: 'now' | 'scheduled' | 'approval_required' | null;
}): ValidationItem[];
export declare function validateDm(dm: {
    sections?: Section[] | string | null;
    brand_kit?: DmBrandKit | string | null;
    scheduled_at?: string | null;
    publish_mode?: 'now' | 'scheduled' | 'approval_required' | null;
}, opts?: {
    sampleCustomers?: Array<{
        key: string;
        data: Record<string, any> | null;
    }>;
}): Promise<ValidationResult>;
//# sourceMappingURL=dm-validate.d.ts.map