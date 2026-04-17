/**
 * dm-section-defaults.ts (frontend) — DM 섹션 11종 타입/기본값/메타데이터 (Frontend SSOT 미러)
 *
 * ⚠️ SSOT — 백엔드 원본: packages/backend/src/utils/dm/dm-section-registry.ts
 *    섹션 타입/Props 구조/기본값 변경 시 양쪽 동시 수정 필수.
 *
 * 소비처:
 *  - DmBuilderPage (에디터)
 *  - components/dm/canvas/* (섹션 컴포넌트)
 *  - stores/dmBuilderStore (상태 관리)
 *  - components/dm/panels/SectionAddMenu (섹션 추가 버튼)
 */

// ────────────── 섹션 타입 (11종) ──────────────

export type SectionType =
  | 'header'
  | 'hero'
  | 'coupon'
  | 'countdown'
  | 'text_card'
  | 'cta'
  | 'video'
  | 'store_info'
  | 'sns'
  | 'promo_code'
  | 'footer';

export const SECTION_TYPES: readonly SectionType[] = [
  'header', 'hero', 'coupon', 'countdown', 'text_card',
  'cta', 'video', 'store_info', 'sns', 'promo_code', 'footer',
] as const;

// ────────────── Props 타입 ──────────────

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
  header:     HeaderProps;
  hero:       HeroProps;
  coupon:     CouponProps;
  countdown:  CountdownProps;
  text_card:  TextCardProps;
  cta:        CtaProps;
  video:      VideoProps;
  store_info: StoreInfoProps;
  sns:        SnsProps;
  promo_code: PromoCodeProps;
  footer:     FooterProps;
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

// ────────────── 기본값 ──────────────

export const SECTION_DEFAULTS: { [K in SectionType]: SectionPropsMap[K] } = {
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

// ────────────── 메타데이터 ──────────────

export type SectionMeta = {
  label: string;
  description: string;
  icon: string;
  maxCount: number;
  defaultStyleVariant: string;
  supportsStyleVariants: string[];
  aiAware: boolean;
};

export const SECTION_META: Record<SectionType, SectionMeta> = {
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
export function getDefaultProps<T extends SectionType>(type: T): SectionPropsMap[T] {
  return JSON.parse(JSON.stringify(SECTION_DEFAULTS[type])) as SectionPropsMap[T];
}

/** 새 Section 생성 (uuid는 호출부에서 crypto.randomUUID()) */
export function createSection<T extends SectionType>(
  type: T,
  order: number,
  overrides?: Partial<SectionPropsMap[T]>,
): Section {
  const meta = SECTION_META[type];
  const defaults = getDefaultProps(type);
  return {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    order,
    visible: true,
    style_variant: meta.defaultStyleVariant,
    props: { ...defaults, ...(overrides || {}) } as SectionProps,
    variable_fallbacks: [],
  };
}

/** 섹션 배열 순서 재정렬 (0부터) */
export function normalizeOrder(sections: Section[]): Section[] {
  return sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i }));
}

/** 섹션 타입 유효성 */
export function isValidSectionType(type: string): type is SectionType {
  return SECTION_TYPES.includes(type as SectionType);
}

/** 섹션 최대 개수 초과 여부 */
export function isMaxCountExceeded(sections: Section[], type: SectionType): boolean {
  const max = SECTION_META[type].maxCount;
  const count = sections.filter((s) => s.type === type).length;
  return count >= max;
}

/** 섹션 추가 메뉴 정렬 순서 (권장 배치 순) */
export const SECTION_ADD_MENU_ORDER: SectionType[] = [
  'header',
  'hero',
  'coupon',
  'countdown',
  'text_card',
  'cta',
  'video',
  'store_info',
  'promo_code',
  'sns',
  'footer',
];
