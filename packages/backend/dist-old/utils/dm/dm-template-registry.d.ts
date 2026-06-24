import type { Section } from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';
export type TemplateCategory = 'new_product' | 'discount' | 'urgent' | 'point_reminder' | 'reactivation' | 'offline_driving' | 'vip';
export type TemplateIndustry = 'beauty' | 'fashion' | 'food' | 'tech' | 'luxury' | 'general';
export type DmTemplate = {
    id: string;
    category: TemplateCategory;
    industry: TemplateIndustry;
    name: string;
    description: string;
    thumbnail_url?: string;
    sections: Section[];
    brand_kit?: Partial<DmBrandKit>;
    popularity: number;
};
export declare const DM_TEMPLATES: DmTemplate[];
export declare function getTemplate(id: string): DmTemplate | null;
export declare function listTemplates(filter?: {
    category?: TemplateCategory;
    industry?: TemplateIndustry;
}): DmTemplate[];
/**
 * dm_templates 테이블에 기본 템플릿 UPSERT.
 * 서버 시작 시 1회 호출 권장 (app.ts listen 콜백).
 */
export declare function seedDefaultTemplates(): Promise<void>;
export type NewDmFromTemplate = {
    title: string;
    store_name?: string;
    sections: Section[];
    brand_kit: DmBrandKit;
    template_id: string;
};
export declare function instantiateTemplate(template: DmTemplate, override?: {
    title?: string;
    storeName?: string;
    brandKit?: Partial<DmBrandKit>;
}): NewDmFromTemplate;
//# sourceMappingURL=dm-template-registry.d.ts.map