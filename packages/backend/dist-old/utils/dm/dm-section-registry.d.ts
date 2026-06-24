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
export type SectionType = 'header' | 'hero' | 'coupon' | 'countdown' | 'text_card' | 'cta' | 'video' | 'store_info' | 'sns' | 'promo_code' | 'footer';
export declare const SECTION_TYPES: readonly SectionType[];
export type HeaderProps = {
    variant: 'logo' | 'banner' | 'countdown' | 'coupon';
    logo_url?: string;
    brand_name?: string;
    phone?: string;
    event_title?: string;
    event_date?: string;
    discount_label?: string;
    coupon_code?: string;
    banner_image_url?: string;
};
export type HeroProps = {
    image_url?: string;
    headline: string;
    sub_copy?: string;
    overlay_gradient?: boolean;
    align: 'left' | 'center' | 'right';
    height: 'sm' | 'md' | 'lg' | 'full';
};
export type CouponProps = {
    discount_label: string;
    discount_type: 'percent' | 'amount' | 'free_shipping';
    coupon_code?: string;
    expire_date?: string;
    min_purchase?: number;
    usage_condition?: string;
    cta_url?: string;
};
export type CountdownProps = {
    end_datetime: string;
    urgency_text?: string;
    show_days: boolean;
    show_hours: boolean;
    show_minutes: boolean;
    show_seconds: boolean;
};
export type TextCardProps = {
    tag?: string;
    headline: string;
    body: string;
    align: 'left' | 'center';
    image_url?: string;
    image_position: 'top' | 'left' | 'right' | 'bottom';
};
export type CtaButton = {
    label: string;
    url: string;
    style: 'primary' | 'secondary' | 'outline';
    icon?: string;
};
export type CtaProps = {
    buttons: CtaButton[];
    layout: 'stack' | 'row';
};
export type VideoProps = {
    video_url: string;
    video_type: 'youtube' | 'direct';
    thumbnail_url?: string;
    caption?: string;
    autoplay: boolean;
};
export type StoreInfoProps = {
    phone?: string;
    website?: string;
    email?: string;
    address?: string;
    map_url?: string;
    business_hours?: string;
};
export type SnsChannel = {
    type: 'instagram' | 'youtube' | 'kakao' | 'naver' | 'facebook' | 'twitter';
    url: string;
    handle?: string;
};
export type SnsProps = {
    channels: SnsChannel[];
    layout: 'icons' | 'buttons';
};
export type PromoCodeProps = {
    code: string;
    description?: string;
    instructions?: string;
    cta_url?: string;
    cta_label?: string;
};
export type FooterProps = {
    notes?: string;
    cs_phone?: string;
    cs_hours?: string;
    legal_text?: string;
    show_unsubscribe_link?: boolean;
};
export type SectionPropsMap = {
    header: HeaderProps;
    hero: HeroProps;
    coupon: CouponProps;
    countdown: CountdownProps;
    text_card: TextCardProps;
    cta: CtaProps;
    video: VideoProps;
    store_info: StoreInfoProps;
    sns: SnsProps;
    promo_code: PromoCodeProps;
    footer: FooterProps;
};
export type SectionProps = SectionPropsMap[SectionType];
export type VariableBinding = {
    variable: string;
    fallback: string;
    hide_section_if_empty?: boolean;
};
export type Section = {
    id: string;
    type: SectionType;
    order: number;
    visible: boolean;
    style_variant?: string;
    props: SectionProps;
    ai_locked?: boolean;
    variable_fallbacks?: VariableBinding[];
};
export declare const SECTION_DEFAULTS: {
    [K in SectionType]: SectionPropsMap[K];
};
export type SectionMeta = {
    label: string;
    description: string;
    icon: string;
    maxCount: number;
    defaultStyleVariant: string;
    supportsStyleVariants: string[];
    aiAware: boolean;
};
export declare const SECTION_META: Record<SectionType, SectionMeta>;
/** 섹션 타입의 기본 props를 깊은 복사로 반환 */
export declare function getDefaultProps<T extends SectionType>(type: T): SectionPropsMap[T];
/** 새 Section 객체 생성 (id는 호출부에서 uuid 등으로 지정) */
export declare function createSection<T extends SectionType>(type: T, id: string, order: number, overrides?: Partial<SectionPropsMap[T]>): Section;
/** 섹션 배열 순서 재정렬 (0부터) */
export declare function normalizeOrder(sections: Section[]): Section[];
/** 섹션 타입이 유효한지 검증 */
export declare function isValidSectionType(type: string): type is SectionType;
/** 섹션 최대 개수 초과 여부 체크 */
export declare function isMaxCountExceeded(sections: Section[], type: SectionType): boolean;
//# sourceMappingURL=dm-section-registry.d.ts.map