"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertLegacyToSections = convertLegacyToSections;
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
const dm_section_registry_1 = require("./dm-section-registry");
function parseObj(raw) {
    if (raw === null || raw === undefined)
        return {};
    if (typeof raw !== 'string')
        return raw;
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
function parsePages(raw) {
    if (!raw)
        return [];
    if (Array.isArray(raw))
        return raw;
    try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p : [];
    }
    catch {
        return [];
    }
}
// ────────────── 헤더 변환 ──────────────
function convertHeader(template, data, order) {
    const d = data || {};
    const t = template || 'logo';
    if (t === 'banner') {
        return {
            ...(0, dm_section_registry_1.createSection)('header', '', order),
            id: cryptoId(),
            props: { variant: 'banner', banner_image_url: d.bannerUrl || d.imageUrl || '' },
        };
    }
    if (t === 'countdown') {
        return {
            ...(0, dm_section_registry_1.createSection)('header', '', order),
            id: cryptoId(),
            props: { variant: 'countdown', event_title: d.eventTitle || '', event_date: d.eventDate || '', brand_name: d.brandName || '' },
        };
    }
    if (t === 'coupon') {
        return {
            ...(0, dm_section_registry_1.createSection)('header', '', order),
            id: cryptoId(),
            props: { variant: 'coupon', discount_label: d.discount || '', coupon_code: d.couponCode || '', brand_name: d.brandName || '' },
        };
    }
    // default: logo
    return {
        ...(0, dm_section_registry_1.createSection)('header', '', order),
        id: cryptoId(),
        props: { variant: 'logo', logo_url: d.logoUrl || '', brand_name: d.brandName || d.name || '', phone: d.phone || '' },
    };
}
// ────────────── 페이지 변환 ──────────────
function convertPage(page, startOrder) {
    const layout = page.layout || 'full-image';
    if (layout === 'text-card') {
        return [{
                ...(0, dm_section_registry_1.createSection)('text_card', '', startOrder),
                id: cryptoId(),
                props: {
                    headline: page.heading || '',
                    body: page.caption || '',
                    align: 'center',
                    image_position: 'top',
                },
                style_variant: 'default',
            }];
    }
    if (layout === 'cta-card') {
        const textSec = {
            ...(0, dm_section_registry_1.createSection)('text_card', '', startOrder),
            id: cryptoId(),
            props: {
                headline: '',
                body: page.caption || '',
                align: 'left',
                image_position: 'top',
                image_url: page.imageUrl,
            },
        };
        const ctaSec = {
            ...(0, dm_section_registry_1.createSection)('cta', '', startOrder + 1),
            id: cryptoId(),
            props: {
                buttons: [{ label: page.ctaText || '자세히 보기', url: page.ctaUrl || '', style: 'primary' }],
                layout: 'stack',
            },
        };
        return [textSec, ctaSec];
    }
    if (layout === 'video') {
        return [{
                ...(0, dm_section_registry_1.createSection)('video', '', startOrder),
                id: cryptoId(),
                props: {
                    video_url: page.videoUrl || '',
                    video_type: page.videoType || 'youtube',
                    caption: page.caption || '',
                    autoplay: false,
                },
            }];
    }
    // full-image (default) → hero
    return [{
            ...(0, dm_section_registry_1.createSection)('hero', '', startOrder),
            id: cryptoId(),
            props: {
                image_url: page.imageUrl,
                headline: page.heading || '',
                sub_copy: page.caption || '',
                align: 'center',
                height: 'md',
                overlay_gradient: true,
            },
        }];
}
// ────────────── 푸터 변환 ──────────────
function convertFooter(template, data, order) {
    const d = data || {};
    const t = template || 'cs';
    if (t === 'cta') {
        return {
            ...(0, dm_section_registry_1.createSection)('cta', '', order),
            id: cryptoId(),
            props: {
                buttons: [{ label: d.ctaText || '자세히 보기', url: d.ctaUrl || '', style: 'primary' }],
                layout: 'stack',
            },
        };
    }
    if (t === 'social') {
        const channels = [];
        if (d.instagram)
            channels.push({ type: 'instagram', url: d.instagram });
        if (d.youtube)
            channels.push({ type: 'youtube', url: d.youtube });
        if (d.kakao)
            channels.push({ type: 'kakao', url: d.kakao });
        return {
            ...(0, dm_section_registry_1.createSection)('sns', '', order),
            id: cryptoId(),
            props: { channels, layout: 'buttons' },
        };
    }
    if (t === 'promo') {
        return {
            ...(0, dm_section_registry_1.createSection)('promo_code', '', order),
            id: cryptoId(),
            props: {
                code: d.promoCode || '',
                description: d.promoDesc || '',
                cta_url: d.promoUrl || '',
                cta_label: '지금 사용하기',
            },
        };
    }
    // default: 'cs' → footer
    return {
        ...(0, dm_section_registry_1.createSection)('footer', '', order),
        id: cryptoId(),
        props: {
            cs_phone: d.phone || '',
            notes: d.website ? `홈페이지: ${d.website}` : '',
            legal_text: d.email || '',
            show_unsubscribe_link: true,
        },
    };
}
// ────────────── 통합 진입점 ──────────────
function convertLegacyToSections(legacy) {
    const headerData = parseObj(legacy.header_data);
    const footerData = parseObj(legacy.footer_data);
    const pages = parsePages(legacy.pages).sort((a, b) => (a.order || 0) - (b.order || 0));
    const sections = [];
    let order = 0;
    // 헤더
    const headerSection = convertHeader(legacy.header_template, headerData, order++);
    if (headerSection)
        sections.push(headerSection);
    // 페이지 (각각 1~2 섹션으로 확장)
    for (const page of pages) {
        const converted = convertPage(page, order);
        sections.push(...converted);
        order += converted.length;
    }
    // 푸터 → footer 섹션은 항상 맨 마지막
    const footerSection = convertFooter(legacy.footer_template, footerData, order++);
    sections.push(footerSection);
    // 마지막에 KISA 필수 footer가 없으면 추가 (footer가 이미 변환되었으면 스킵)
    const hasFooterProper = sections.some((s) => s.type === 'footer');
    if (!hasFooterProper) {
        sections.push({
            ...(0, dm_section_registry_1.createSection)('footer', '', order++),
            id: cryptoId(),
            props: { show_unsubscribe_link: true },
        });
    }
    return { sections: (0, dm_section_registry_1.normalizeOrder)(sections) };
}
function cryptoId() {
    if (typeof globalThis.crypto?.randomUUID === 'function')
        return globalThis.crypto.randomUUID();
    return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
//# sourceMappingURL=dm-legacy-converter.js.map