"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FALLBACKS = void 0;
exports.extractVariables = extractVariables;
exports.hasAnyVariable = hasAnyVariable;
exports.resolveSectionVariables = resolveSectionVariables;
exports.shouldHideSection = shouldHideSection;
exports.resolveSections = resolveSections;
exports.getAvailableVariables = getAvailableVariables;
/**
 * dm-variable-resolver.ts — DM 섹션 내 개인화 변수(%고객명% 등) 치환 + fallback
 *
 * 기존 messageUtils.ts `replaceVariables`를 재활용하고, 섹션 단위 fallback 규칙과
 * hide_section_if_empty(변수가 비어있으면 섹션 숨김) 처리를 추가.
 *
 * 설계서: status/DM-PRO-DESIGN.md §11
 */
const messageUtils_1 = require("../messageUtils");
const messageUtils_2 = require("../messageUtils");
// ────────────── 기본 fallback 매핑 ──────────────
exports.DEFAULT_FALLBACKS = {
    '%고객명%': '고객님',
    '%최근구매매장%': '가까운 매장',
    '%보유포인트%': '',
    '%쿠폰코드%': '공통 프로모션 코드',
    '%최근관심카테고리%': '인기 상품',
    '%최근구매일%': '',
    '%휴면여부%': '',
    '%추천상품%': '추천 상품',
};
// ────────────── 치환 가능한 string 필드 키 (섹션 타입별) ──────────────
const STRING_FIELD_KEYS = {
    header: ['brand_name', 'phone', 'event_title', 'discount_label', 'coupon_code'],
    hero: ['headline', 'sub_copy'],
    coupon: ['discount_label', 'coupon_code', 'usage_condition', 'cta_url'],
    countdown: ['urgency_text'],
    text_card: ['tag', 'headline', 'body'],
    cta: [], // buttons[]는 별도 처리
    video: ['caption'],
    store_info: ['phone', 'website', 'email', 'address', 'business_hours'],
    sns: [], // channels[]는 별도 처리
    promo_code: ['code', 'description', 'instructions', 'cta_label', 'cta_url'],
    footer: ['notes', 'cs_phone', 'cs_hours', 'legal_text'],
};
// ────────────── 변수 감지 ──────────────
function extractVariables(text) {
    if (!text)
        return [];
    const matches = text.match(/%[^%\s]+%/g) || [];
    return Array.from(new Set(matches));
}
function hasAnyVariable(text) {
    return /%[^%\s]+%/.test(text || '');
}
// ────────────── 섹션 내 모든 string 필드 치환 ──────────────
function resolveSectionVariables(section, customer, fieldMappings) {
    const keys = STRING_FIELD_KEYS[section.type] || [];
    const newProps = { ...section.props };
    const fallbacks = buildFallbackMap(section.variable_fallbacks);
    for (const k of keys) {
        const v = newProps[k];
        if (typeof v === 'string' && v.length > 0 && hasAnyVariable(v)) {
            newProps[k] = resolveText(v, customer, fieldMappings, fallbacks);
        }
    }
    // CTA buttons[]
    if (section.type === 'cta' && Array.isArray(newProps.buttons)) {
        newProps.buttons = newProps.buttons.map((b) => ({
            ...b,
            label: hasAnyVariable(b.label || '') ? resolveText(b.label, customer, fieldMappings, fallbacks) : b.label,
            url: hasAnyVariable(b.url || '') ? resolveText(b.url, customer, fieldMappings, fallbacks) : b.url,
        }));
    }
    // SNS channels[] — url/handle만
    if (section.type === 'sns' && Array.isArray(newProps.channels)) {
        newProps.channels = newProps.channels.map((ch) => ({
            ...ch,
            url: hasAnyVariable(ch.url || '') ? resolveText(ch.url, customer, fieldMappings, fallbacks) : ch.url,
            handle: hasAnyVariable(ch.handle || '') ? resolveText(ch.handle, customer, fieldMappings, fallbacks) : ch.handle,
        }));
    }
    return { ...section, props: newProps };
}
// ────────────── 텍스트 단위 치환 ──────────────
function resolveText(text, customer, fieldMappings, fallbacks) {
    // 1) 기존 replaceVariables로 fieldMappings 기반 치환
    let result = (0, messageUtils_1.replaceVariables)(text, customer, fieldMappings);
    // 2) 잔여 %변수% (fieldMappings에 없거나 customer가 null) → fallback 적용
    result = result.replace(/%[^%\s]+%/g, (match) => {
        if (fallbacks[match] !== undefined)
            return fallbacks[match];
        if (exports.DEFAULT_FALLBACKS[match] !== undefined)
            return exports.DEFAULT_FALLBACKS[match];
        return ''; // 정의 없는 변수는 빈 문자열
    });
    return result;
}
function buildFallbackMap(bindings) {
    const out = {};
    if (!bindings)
        return out;
    for (const b of bindings) {
        if (b.variable)
            out[b.variable] = b.fallback ?? '';
    }
    return out;
}
// ────────────── hide_section_if_empty 처리 ──────────────
/**
 * 변수가 고객 데이터에 없고 fallback도 빈 값일 때 섹션을 숨길지 판정.
 * 섹션의 variable_fallbacks에 hide_section_if_empty=true인 변수가 포함되어 있고
 * 그 변수가 빈 값이면 섹션을 제거.
 */
function shouldHideSection(section, customer, fieldMappings) {
    const bindings = section.variable_fallbacks || [];
    const hideTriggers = bindings.filter((b) => b.hide_section_if_empty);
    if (hideTriggers.length === 0)
        return false;
    for (const b of hideTriggers) {
        const probe = `${b.variable}`;
        const resolved = (0, messageUtils_1.replaceVariables)(probe, customer, fieldMappings);
        if (!resolved || resolved === b.variable || resolved === b.fallback) {
            return true;
        }
    }
    return false;
}
// ────────────── 전체 섹션 배열 해석 ──────────────
async function resolveSections(sections, customer, companyId) {
    const fieldMappings = await (0, messageUtils_2.prepareFieldMappings)(companyId);
    const resolved = [];
    for (const s of sections) {
        if (!s.visible)
            continue;
        if (shouldHideSection(s, customer, fieldMappings))
            continue;
        resolved.push(resolveSectionVariables(s, customer, fieldMappings));
    }
    return resolved;
}
async function getAvailableVariables(companyId) {
    const mappings = await (0, messageUtils_2.prepareFieldMappings)(companyId);
    const out = [];
    const categoryOf = (col) => {
        if (['name', 'gender', 'age', 'birth_date', 'email', 'phone', 'region', 'address', 'grade'].includes(col))
            return 'profile';
        if (col.startsWith('recent_') || col.startsWith('total_') || col === 'purchase_count' || col === 'points')
            return 'purchase';
        if (col.startsWith('custom_'))
            return 'custom';
        return 'system';
    };
    for (const [displayName, entry] of Object.entries(mappings)) {
        out.push({
            name: `%${displayName}%`,
            displayName,
            sample: String(entry?.sample ?? ''),
            description: entry?.description,
            category: categoryOf(entry?.column || ''),
        });
    }
    return out;
}
//# sourceMappingURL=dm-variable-resolver.js.map