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
  // 옛 11 (D119/D125 보존)
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
  | 'footer'
  // D216+ 신규 16 — 카테고리 A. 시각 카드형
  | 'product_carousel'
  | 'gallery'
  | 'slideshow'
  | 'tab_cards'
  // 카테고리 B. 인터랙션 수집형
  | 'poll'
  | 'survey'
  | 'email_capture'
  | 'click_rewards'
  // 카테고리 C. 참여형 이벤트
  | 'lucky_draw'
  | 'roulette'
  | 'instant_coupon'
  | 'limited_quantity'
  // 카테고리 D. 외부 임베드 + 매장 안내
  | 'youtube_embed'
  | 'instagram_embed'
  | 'map_store_locator'
  | 'reviews';

export const SECTION_TYPES: readonly SectionType[] = [
  // 옛 11
  'header', 'hero', 'coupon', 'countdown', 'text_card',
  'cta', 'video', 'store_info', 'sns', 'promo_code', 'footer',
  // D216+ 신규 16
  'product_carousel', 'gallery', 'slideshow', 'tab_cards',
  'poll', 'survey', 'email_capture', 'click_rewards',
  'lucky_draw', 'roulette', 'instant_coupon', 'limited_quantity',
  'youtube_embed', 'instagram_embed', 'map_store_locator', 'reviews',
] as const;

// ────────────── Props 타입 ──────────────

export type HeaderProps = {
  variant: 'logo' | 'banner' | 'countdown' | 'coupon';
  align?: 'left' | 'center' | 'right'; // logo형 정렬(기본 center) — ★ 2026-07-08 'right' 추가(UI 좌·중·우 버튼 지원, 타입 누락으로 우측 미반영이던 문제)
  brand_size?: 'sm' | 'md' | 'lg'; // 브랜드명 크기(기본 md)
  logo_size?: 'sm' | 'md' | 'lg';  // 로고 크기(기본 md)
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
  // ★ 2026-07-02 텍스트 색상 직접 지정 (미지정 = 기본색) — backend dm-section-registry와 동일
  headline_color?: string;
  sub_copy_color?: string;
  // ★ 2026-07-02(2) 폰트 크기 직접 선택(px) — backend dm-section-registry와 동일
  headline_size?: number;
  sub_copy_size?: number;
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
  // ★ 2026-07-02 텍스트 색상 직접 지정 (미지정 = 기본색) — backend dm-section-registry와 동일
  headline_color?: string;
  body_color?: string;
  // ★ 2026-07-02(2) 폰트 크기 직접 선택(px) — backend dm-section-registry와 동일
  headline_size?: number;
  body_size?: number;
};

// ★ 2026-07-02(2) 폰트 크기 선택지 — 히어로/텍스트 카드 속성 패널 공용 (''=기본 토큰 크기)
export const DM_FONT_SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '기본 (자동)' },
  ...[14, 16, 18, 20, 24, 28, 32, 36, 40, 48].map((n) => ({ value: String(n), label: `${n}px` })),
];

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

// ────────────── D216+ 신규 16 Props ──────────────

export type ProductCarouselItem = { id?: string; image_url: string; name: string; price: number; discount_price?: number; discount_rate?: number; link_url?: string; };
export type ProductCarouselProps = { title?: string; products: ProductCarouselItem[]; show_indicator?: boolean; auto_slide?: boolean; slide_interval_ms?: number; };

export type GalleryImage = { url: string; caption?: string; link_url?: string; };
export type GalleryProps = { title?: string; images: GalleryImage[]; layout: 'grid_2x2' | 'grid_3x3' | 'list_1xN' | 'masonry'; enable_zoom?: boolean; enable_fullscreen?: boolean; };

export type SlideshowSlide = { image_url: string; caption?: string; link_url?: string; };
export type SlideshowProps = { slides: SlideshowSlide[]; interval_ms: number; show_pause?: boolean; show_indicator?: boolean; };

export type TabCardItem = { label: string; content_type: 'text' | 'image' | 'product_list'; content: string; };
export type TabCardsProps = { tabs: TabCardItem[]; default_tab_index?: number; };

export type PollOption = { id: string; label: string; };
export type PollProps = { question: string; options: PollOption[]; allow_multiple?: boolean; show_result_after_vote?: boolean; one_vote_per_user: boolean; };

export type SurveyQuestion = { id: string; type: 'single' | 'multiple' | 'text' | 'rating'; question: string; options?: string[]; required?: boolean; };
export type SurveyProps = { title?: string; questions: SurveyQuestion[]; show_progress?: boolean; completion_reward_text?: string; };

export type EmailCaptureProps = { headline: string; description?: string; reward_description?: string; consent_text: string; consent_required: boolean; success_text?: string; legal_notice?: string; };

export type ClickRewardsProps = { reward_type: 'like' | 'share' | 'scroll'; target_count: number; reward_description: string; show_progress: boolean; };

export type LuckyDrawFormField = { name: 'name' | 'phone' | 'email'; required: boolean; };
export type LuckyDrawPrize = { rank: number; name: string; count: number; };
export type LuckyDrawProps = { title: string; description?: string; form_fields: LuckyDrawFormField[]; draw_at: string; result_announce_url?: string; consent_text: string; prizes?: LuckyDrawPrize[]; };

export type RouletteSegment = { id: string; label: string; probability: number; reward_description?: string; prize_count?: number; };
export type RouletteProps = { segments: RouletteSegment[]; one_spin_per_user: boolean; spin_animation_ms?: number; };

export type InstantCouponProps = { coupon_label: string; discount_description: string; expires_at?: string; conditions?: string; usage_instructions?: string; };

export type LimitedQuantityProps = { title: string; description?: string; total_quantity: number; current_remaining?: number; signup_url?: string; };

export type YoutubeEmbedProps = { video_url: string; auto_play?: boolean; thumbnail_url?: string; };

export type InstagramEmbedProps = { post_url: string; };

export type MapStore = { id: string; name: string; address: string; lat: number; lng: number; phone?: string; hours?: string; };
export type MapStoreLocatorProps = { stores: MapStore[]; enable_user_location?: boolean; default_zoom?: number; };

export type ReviewItem = { rating: number; author: string; body: string; date?: string; };
export type ReviewsProps = { title?: string; reviews: ReviewItem[]; show_average_rating?: boolean; show_more_link?: string; };

export type SectionPropsMap = {
  // 옛 11
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
  // D216+ 신규 16
  product_carousel:  ProductCarouselProps;
  gallery:           GalleryProps;
  slideshow:         SlideshowProps;
  tab_cards:         TabCardsProps;
  poll:              PollProps;
  survey:            SurveyProps;
  email_capture:     EmailCaptureProps;
  click_rewards:     ClickRewardsProps;
  lucky_draw:        LuckyDrawProps;
  roulette:          RouletteProps;
  instant_coupon:    InstantCouponProps;
  limited_quantity:  LimitedQuantityProps;
  youtube_embed:     YoutubeEmbedProps;
  instagram_embed:   InstagramEmbedProps;
  map_store_locator: MapStoreLocatorProps;
  reviews:           ReviewsProps;
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
  /** 섹션 구도 변형(아트디렉션). 미설정=classic(기본). 허용값은 백엔드 dm-art-direction.TREATMENTS */
  treatment?: string;
  props: SectionProps;
  ai_locked?: boolean;
  variable_fallbacks?: VariableBinding[];
  /** 섹션 공통 정렬(좌/가운데/우) — 전 섹션 일괄. 미설정 시 가운데 */
  align?: 'left' | 'center' | 'right';
  /** 섹션 버튼/액센트 색 override — 미설정 시 브랜드 색 */
  accent_color?: string;
  /** ★ 2026-07-02(2) 섹션 공통 텍스트 크기(px) — 제목급/본문급 토큰 일괄 override. 미설정=기본 */
  title_size?: number;
  text_size?: number;
  /** 개인화 조건부 표시 — 충족 안 하는 수신자에겐 이 섹션 제외(미설정=항상 표시). 이메일 발송 시 평가 */
  display_condition?: {
    field: string;
    op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
    value: string;
  };
};

// ────────────── 기본값 ──────────────

export const SECTION_DEFAULTS: { [K in SectionType]: SectionPropsMap[K] } = {
  header: {
    variant: 'logo',
    brand_name: '',
    align: 'center',
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
  // D216+ 신규 16
  product_carousel: { products: [], show_indicator: true, auto_slide: false, slide_interval_ms: 4000 },
  gallery: { images: [], layout: 'grid_2x2', enable_zoom: true, enable_fullscreen: false },
  slideshow: { slides: [], interval_ms: 4000, show_pause: true, show_indicator: true },
  tab_cards: { tabs: [{ label: '탭 1', content_type: 'text', content: '[직접 작성해주세요]' }], default_tab_index: 0 },
  poll: { question: '[직접 작성해주세요]', options: [{ id: '1', label: '옵션 1' }, { id: '2', label: '옵션 2' }], one_vote_per_user: true, show_result_after_vote: true, allow_multiple: false },
  survey: { questions: [], show_progress: true },
  email_capture: { headline: '[직접 작성해주세요]', consent_text: '개인정보 수집 및 마케팅 정보 수신 동의', consent_required: true },
  click_rewards: { reward_type: 'like', target_count: 10, reward_description: '[직접 작성해주세요]', show_progress: true },
  lucky_draw: { title: '[직접 작성해주세요]', form_fields: [{ name: 'name', required: true }, { name: 'phone', required: true }], draw_at: '', consent_text: '개인정보 수집 및 마케팅 정보 수신 동의' },
  roulette: { segments: Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), label: `옵션 ${i + 1}`, probability: 0.125 })), one_spin_per_user: true, spin_animation_ms: 3000 },
  instant_coupon: { coupon_label: '[직접 작성해주세요]', discount_description: '[직접 작성해주세요]' },
  limited_quantity: { title: '[직접 작성해주세요]', total_quantity: 100 },
  youtube_embed: { video_url: '', auto_play: false },
  instagram_embed: { post_url: '' },
  map_store_locator: { stores: [], enable_user_location: false, default_zoom: 14 },
  reviews: { reviews: [], show_average_rating: true },
};

// ────────────── 메타데이터 ──────────────

export type SectionCategory = 'header_footer' | 'hero_visual' | 'commerce' | 'interactive' | 'event' | 'embed' | 'info';

export type SectionMeta = {
  label: string;
  description: string;
  icon: string;
  maxCount: number;
  defaultStyleVariant: string;
  supportsStyleVariants: string[];
  aiAware: boolean;
  category?: SectionCategory;
  beta?: boolean;
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
    category: 'header_footer',
  },
  // ────────────── D216+ 신규 16 메타 ──────────────
  product_carousel: { label: '상품 슬라이드', description: '상품 다수 (사진 + 가격 + 할인) 좌우 슬라이드', icon: '🛍️', maxCount: 3, defaultStyleVariant: 'default', supportsStyleVariants: ['default', 'beauty-elegant', 'fashion-editorial'], aiAware: true, category: 'commerce' },
  gallery: { label: '갤러리', description: '다중 사진 그리드 (2×2 / 3×3 / 1×N)', icon: '🖼️', maxCount: 5, defaultStyleVariant: 'default', supportsStyleVariants: ['default', 'minimal', 'editorial'], aiAware: true, category: 'hero_visual' },
  slideshow: { label: '자동 슬라이드쇼', description: '3~5초 자동 전환 + 일시정지', icon: '🎞️', maxCount: 2, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: true, category: 'hero_visual' },
  tab_cards: { label: '탭 카드', description: '카테고리별 탭 분기 콘텐츠', icon: '📑', maxCount: 3, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: false, category: 'commerce' },
  poll: { label: '실시간 투표', description: '질문 + 옵션 + 실시간 결과 %', icon: '📊', maxCount: 2, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: true, category: 'interactive', beta: true },
  survey: { label: '설문', description: '다중 질문 + 진행률 + 완료 보상', icon: '📝', maxCount: 1, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: true, category: 'interactive', beta: true },
  email_capture: { label: '이메일 수집', description: '이메일 입력 + 동의 + 즉시 쿠폰 발급', icon: '✉️', maxCount: 1, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: true, category: 'interactive' },
  click_rewards: { label: '참여 보상', description: '좋아요 / 공유 / 스크롤 적립', icon: '⭐', maxCount: 1, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: false, category: 'interactive', beta: true },
  lucky_draw: { label: '추첨 이벤트', description: '응모 + 자동 추첨 + 결과 발표', icon: '🎁', maxCount: 1, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: true, category: 'event', beta: true },
  roulette: { label: '룰렛 이벤트', description: '8 영역 회전 휠 + 자동 당첨', icon: '🎡', maxCount: 1, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: false, category: 'event', beta: true },
  instant_coupon: { label: '즉시 쿠폰 발급', description: '만료 카운트다운 + 사용 안내', icon: '🎟️', maxCount: 2, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: true, category: 'event' },
  limited_quantity: { label: '선착순 한정', description: '실시간 잔여 수량 + 완료 알림', icon: '⏳', maxCount: 1, defaultStyleVariant: 'default', supportsStyleVariants: ['default', 'urgent'], aiAware: true, category: 'event' },
  youtube_embed: { label: 'YouTube 임베드', description: 'YouTube URL 공식 임베드', icon: '▶️', maxCount: 2, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: false, category: 'embed' },
  instagram_embed: { label: 'Instagram 임베드', description: 'Instagram post 공식 임베드', icon: '📷', maxCount: 2, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: false, category: 'embed' },
  map_store_locator: { label: '매장 찾기 지도', description: '지도 + 매장 다수 + 가까운 매장 정렬', icon: '🗺️', maxCount: 1, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: false, category: 'info' },
  reviews: { label: '리뷰', description: '별점 + 본문 + 평균 별점', icon: '⭐', maxCount: 1, defaultStyleVariant: 'default', supportsStyleVariants: ['default'], aiAware: true, category: 'info' },
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
