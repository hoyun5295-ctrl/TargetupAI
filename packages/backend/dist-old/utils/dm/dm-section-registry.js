"use strict";
/**
 * dm-section-registry.ts — DM 섹션 11종의 타입/기본값/메타데이터 레지스트리 (Backend SSOT)
 *
 * ⚠️ SSOT — 프론트 미러: packages/frontend/src/utils/dm-section-defaults.ts
 *    섹션 타입/Props 구조/기본값 변경 시 양쪽 동시 수정 필수.
 *
 * 소비처:
 *  - dm-viewer.ts (HTML 렌더)
 *  - dm-ai.ts (Layout Recommender, Copy Generator)
 *  - dm-validate.ts (검수 엔진)
 *  - dm-builder.ts (CRUD)
 *
 * 설계서: status/DM-PRO-DESIGN.md §7
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECTION_META = exports.SECTION_DEFAULTS = exports.SECTION_TYPES = void 0;
exports.getDefaultProps = getDefaultProps;
exports.createSection = createSection;
exports.normalizeOrder = normalizeOrder;
exports.isValidSectionType = isValidSectionType;
exports.isMaxCountExceeded = isMaxCountExceeded;
exports.SECTION_TYPES = [
    'header', 'hero', 'coupon', 'countdown', 'text_card',
    'cta', 'video', 'store_info', 'sns', 'promo_code', 'footer',
];
// ────────────── 기본값 ──────────────
exports.SECTION_DEFAULTS = {
    header: {
        variant: 'logo',
        brand_name: '',
    },
    hero: {
        headline: '',
        align: 'center',
        height: 'md',
    },
    coupon: {
        discount_label: '',
        discount_type: 'percent',
    },
    countdown: {
        end_datetime: '',
        show_days: true,
        show_hours: true,
        show_minutes: true,
        show_seconds: false,
    },
    text_card: {
        headline: '',
        body: '',
        align: 'left',
        image_position: 'top',
    },
    cta: {
        buttons: [{ label: '자세히 보기', url: '', style: 'primary' }],
        layout: 'stack',
    },
    video: {
        video_url: '',
        video_type: 'youtube',
        autoplay: false,
    },
    store_info: {},
    sns: {
        channels: [],
        layout: 'icons',
    },
    promo_code: {
        code: '',
    },
    footer: {
        show_unsubscribe_link: true,
    },
};
exports.SECTION_META = {
    header: {
        label: '헤더',
        description: '브랜드 로고 + 고객센터번호 또는 배너/카운트다운/쿠폰 헤더',
        icon: '🏷️',
        maxCount: 1,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'beauty-elegant', 'fashion-editorial', 'luxury'],
        aiAware: true,
    },
    hero: {
        label: '히어로 (메인 비주얼)',
        description: '풀 배너 이미지 + 메인 헤드라인 + 서브카피',
        icon: '🎯',
        maxCount: 2,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'beauty-elegant', 'beauty-bold', 'fashion-editorial', 'food-warm', 'luxury'],
        aiAware: true,
    },
    coupon: {
        label: '쿠폰',
        description: '할인율 + 쿠폰코드 + 유효기간',
        icon: '🎟️',
        maxCount: 3,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'beauty-elegant', 'fashion-editorial', 'food-warm'],
        aiAware: true,
    },
    countdown: {
        label: '카운트다운',
        description: '종료 시각 + 긴급성 문구',
        icon: '⏰',
        maxCount: 2,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'urgent', 'elegant'],
        aiAware: true,
    },
    text_card: {
        label: '텍스트 카드',
        description: '헤드라인 + 본문 + 강조 태그',
        icon: '📝',
        maxCount: 10,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'beauty-elegant', 'fashion-editorial', 'food-warm', 'luxury'],
        aiAware: true,
    },
    cta: {
        label: 'CTA 버튼',
        description: '버튼 1~2개 + 링크',
        icon: '👆',
        maxCount: 5,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'bold', 'elegant'],
        aiAware: true,
    },
    video: {
        label: '영상',
        description: '썸네일 + 재생 버튼 + 랜딩',
        icon: '🎬',
        maxCount: 2,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'editorial'],
        aiAware: false,
    },
    store_info: {
        label: '매장/고객센터',
        description: '전화 + 홈페이지 + 매장찾기',
        icon: '📞',
        maxCount: 1,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'elegant'],
        aiAware: false,
    },
    sns: {
        label: 'SNS',
        description: '인스타/유튜브/카카오',
        icon: '📱',
        maxCount: 1,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'minimal'],
        aiAware: false,
    },
    promo_code: {
        label: '프로모션 코드',
        description: '프로모션 코드 + 사용안내',
        icon: '🎁',
        maxCount: 2,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'bold'],
        aiAware: true,
    },
    footer: {
        label: '하단 정보',
        description: '유의사항 + 고객센터 + 법정안내 + 수신거부',
        icon: '📄',
        maxCount: 1,
        defaultStyleVariant: 'default',
        supportsStyleVariants: ['default', 'minimal'],
        aiAware: true,
    },
};
// ────────────── 헬퍼 ──────────────
/** 섹션 타입의 기본 props를 깊은 복사로 반환 */
function getDefaultProps(type) {
    return JSON.parse(JSON.stringify(exports.SECTION_DEFAULTS[type]));
}
/** 새 Section 객체 생성 (id는 호출부에서 uuid 등으로 지정) */
function createSection(type, id, order, overrides) {
    const meta = exports.SECTION_META[type];
    const defaults = getDefaultProps(type);
    return {
        id,
        type,
        order,
        visible: true,
        style_variant: meta.defaultStyleVariant,
        props: { ...defaults, ...(overrides || {}) },
        variable_fallbacks: [],
    };
}
/** 섹션 배열 순서 재정렬 (0부터) */
function normalizeOrder(sections) {
    return sections
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s, i) => ({ ...s, order: i }));
}
/** 섹션 타입이 유효한지 검증 */
function isValidSectionType(type) {
    return exports.SECTION_TYPES.includes(type);
}
/** 섹션 최대 개수 초과 여부 체크 */
function isMaxCountExceeded(sections, type) {
    const max = exports.SECTION_META[type].maxCount;
    const count = sections.filter((s) => s.type === type).length;
    return count >= max;
}
//# sourceMappingURL=dm-section-registry.js.map