/**
 * dm-legacy-converter.ts — D119 슬라이드형 DM → D125 섹션형 DM 자동 변환
 *
 * 변환 규칙:
 *   header_template + header_data           → header 섹션 (variant 4종)
 *   pages[].layout='full-image'             → hero 섹션
 *   pages[].layout='text-card'              → text_card 섹션
 *   pages[].layout='cta-card'               → text_card + cta 2섹션 분리
 *   pages[].layout='video'                  → video 섹션
 *   footer_template + footer_data           → footer/cta/sns/promo_code 분기
 *
 * 설계서: status/DM-PRO-DESIGN.md §15
 */
import { type Section } from './dm-section-registry';
type LegacyDm = {
    title?: string;
    header_template?: string;
    footer_template?: string;
    header_data?: Record<string, any> | string;
    footer_data?: Record<string, any> | string;
    pages?: LegacyPage[] | string;
};
type LegacyPage = {
    order?: number;
    layout?: 'full-image' | 'text-card' | 'cta-card' | 'video';
    imageUrl?: string;
    videoUrl?: string;
    videoType?: 'youtube' | 'direct';
    caption?: string;
    bgColor?: string;
    textColor?: string;
    heading?: string;
    ctaText?: string;
    ctaUrl?: string;
};
export declare function convertLegacyToSections(legacy: LegacyDm): {
    sections: Section[];
};
export {};
//# sourceMappingURL=dm-legacy-converter.d.ts.map