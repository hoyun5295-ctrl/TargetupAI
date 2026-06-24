import { type Section, type SectionType } from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';
export type CampaignObjective = 'awareness' | 'sale' | 'retention' | 'reactivation' | 'loyalty';
export type CampaignTone = 'premium' | 'friendly' | 'urgent' | 'elegant' | 'playful';
export type CampaignIndustry = 'beauty' | 'fashion' | 'food' | 'tech' | 'luxury' | 'general';
export type CampaignSpec = {
    brand: {
        name: string;
        tone?: CampaignTone;
    };
    objective: CampaignObjective;
    target: {
        age_range?: [number, number];
        gender?: 'F' | 'M' | 'all';
        region?: string;
        segment?: string;
    };
    benefit?: {
        type: 'discount' | 'coupon' | 'free_gift' | 'point' | 'limited_time';
        value?: string;
    };
    urgency?: {
        end_datetime?: string;
        label?: string;
    };
    personalization?: string[];
    tone: CampaignTone;
    industry?: CampaignIndustry;
    recommended_sections?: SectionType[];
};
export type CopyDraft = {
    headlines?: Array<{
        style: 'direct' | 'emotional' | 'urgent';
        text: string;
    }>;
    subCopies?: string[];
    ctaLabels?: string[];
    body?: string;
};
export type ToneKey = 'direct' | 'emotional' | 'premium' | 'urgent' | 'friendly' | 'sales';
export declare const TONE_LABELS: Record<ToneKey, string>;
export declare function parsePrompt(rawPrompt: string): Promise<CampaignSpec>;
export declare function recommendLayout(spec: CampaignSpec): Section[];
export declare function generateCopy(spec: CampaignSpec, section: Section): Promise<CopyDraft>;
export declare function transformTone(text: string, targetTone: ToneKey): Promise<string>;
export type ImprovementSuggestion = {
    section_id: string;
    field: string;
    before: string;
    after: string;
    reason: string;
};
export declare function improveMessage(sections: Section[], brandKit?: DmBrandKit): Promise<ImprovementSuggestion[]>;
//# sourceMappingURL=dm-ai.d.ts.map