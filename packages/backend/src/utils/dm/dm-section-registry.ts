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

// ────────────── 섹션 타입 정의 (11종) ──────────────

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

// ────────────── Props 타입 (섹션별) ──────────────

export type HeaderProps = {
  variant: 'logo' | 'banner' | 'countdown' | 'coupon';
  align?: 'left' | 'center' | 'right'; // logo형 정렬(기본 center) — ★ 2026-07-08 'right' 추가(프론트 미러, UI 좌·중·우 지원)
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
  // ★ 2026-07-15 헤더 제목(브랜드명) 색(임은지 신고) — 미지정 = 기본 neutral-900. 프론트 미러.
  title_color?: string;
  // ★ 2026-07-15 브랜드명 표시 여부(서수란 신고) — 미지정/true = 표시(현행), false = 로고만. 프론트 미러.
  show_brand_name?: boolean;
};

export type HeroProps = {
  image_url?: string;
  headline: string;
  sub_copy?: string;
  overlay_gradient?: boolean;
  align: 'left' | 'center' | 'right';
  height: 'sm' | 'md' | 'lg' | 'full';
  // ★ 2026-07-02 텍스트 색상 직접 지정 — 미지정 = 기존 기본색 그대로 (이메일 + DM classic 렌더 적용)
  headline_color?: string;
  sub_copy_color?: string;
  // ★ 2026-07-02(2) 폰트 크기 직접 선택(px, 10~80) — 미지정 = 기존 토큰 크기 그대로
  headline_size?: number;
  sub_copy_size?: number;
  // ★ 2026-07-13 디자인 3.0 이미지 스튜디오 — 미지정 = overlay_gradient 하위호환 렌더 그대로
  overlay?: 'none' | 'soft' | 'strong' | 'brand' | 'top';   // 오버레이 프리셋(방향·강도·브랜드 틴트)
  focus?: 'center' | 'top' | 'bottom';                      // 이미지 초점(object-position)
  image_fit?: 'cover' | 'contain';                          // ★ 2026-07-22 cover(꽉 차게·잘림)/contain(전체·잘림X). 완성 포스터 통짜. 미지정=cover(회귀 0)
  headline_emphasis?: 'none' | 'marker' | 'underline';      // 헤드라인 강조(형광 마커/밑줄 스트로크)
};

export type CouponProps = {
  discount_label: string;
  discount_type: 'percent' | 'amount' | 'free_shipping';
  coupon_code?: string;
  expire_date?: string;
  min_purchase?: number;
  usage_condition?: string;
  // ★ 2026-07-15 쿠폰 "쿠폰 사용하기" 버튼 색(임은지 신고) — 미지정 = 기본 primary. 프론트 미러.
  button_color?: string;
  cta_url?: string;
};

export type CountdownProps = {
  end_datetime: string;
  urgency_text?: string;
  // 2026-07-09: 카운트다운 배경색·상단문구 글씨색 (미지정 = 기본 다크/accent)
  background_color?: string;
  urgency_color?: string;
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
  // ★ 2026-07-02 텍스트 색상 직접 지정 — 미지정 = 기존 기본색 그대로
  headline_color?: string;
  body_color?: string;
  // ★ 2026-07-02(2) 폰트 크기 직접 선택(px, 10~80) — 미지정 = 기존 토큰 크기 그대로
  headline_size?: number;
  body_size?: number;
  // ★ 2026-07-13 디자인 3.0 — 헤드라인 강조(형광 마커/밑줄 스트로크). 미지정 = 현행
  headline_emphasis?: 'none' | 'marker' | 'underline';
};

export type CtaButton = {
  label: string;
  url: string;
  style: 'primary' | 'secondary' | 'outline';
  icon?: string;
  // ★ 2026-07-15 버튼 색 직접 지정(남지현·임은지 신고) — 미지정 = 스타일 프리셋 색(dm-cta-*) 유지(회귀 0). 프론트 defaults 미러.
  color?: string;
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

// ────────────── D216+ 신규 16 섹션 Props ──────────────

// 카테고리 A. 시각 카드형

export type ProductCarouselItem = {
  id?: string;
  image_url: string;
  name: string;
  price: number;
  discount_price?: number;
  discount_rate?: number;
  link_url?: string;
};

export type ProductCarouselProps = {
  title?: string;
  products: ProductCarouselItem[];
  show_indicator?: boolean;
  auto_slide?: boolean;
  slide_interval_ms?: number;
  // ★ 2026-07-14 이미지 맞춤(남지현) — 프론트 미러(옛 프론트에만 있던 필드 정합)
  image_fit?: 'cover' | 'contain';
  image_focus?: 'top' | 'center' | 'bottom';
  // ★ 2026-07-15 상품슬라이드 색·이미지 높이(서수란 신고) — 미지정 = 현행(배경 회색·캡션 무배경·md 높이). 프론트 미러.
  background_color?: string;   // 슬라이드 섹션 배경(기본 회색 var(--dm-neutral-50) 대체)
  caption_bg_color?: string;   // 상품명·가격 글씨공간(카드) 배경
  image_height?: 'sm' | 'md' | 'lg';  // 이미지 높이 조정(기본 md — 기존 고정 높이)
};

export type GalleryImage = {
  url: string;
  caption?: string;
  link_url?: string;
};

export type GalleryProps = {
  title?: string;
  images: GalleryImage[];
  layout: 'grid_2x2' | 'grid_3x3' | 'list_1xN' | 'masonry';
  enable_zoom?: boolean;
  enable_fullscreen?: boolean;
};

export type SlideshowSlide = {
  image_url: string;
  caption?: string;
  link_url?: string;
};

export type SlideshowProps = {
  slides: SlideshowSlide[];
  interval_ms: number;
  show_pause?: boolean;
  show_indicator?: boolean;
};

export type TabCardItem = {
  label: string;
  content_type: 'text' | 'image' | 'product_list';
  content: string;
};

export type TabCardsProps = {
  tabs: TabCardItem[];
  default_tab_index?: number;
};

// 카테고리 B. 인터랙션 수집형

export type PollOption = {
  id: string;
  label: string;
};

export type PollProps = {
  question: string;
  options: PollOption[];
  allow_multiple?: boolean;
  show_result_after_vote?: boolean;
  one_vote_per_user: boolean;
};

export type SurveyQuestion = {
  id: string;
  type: 'single' | 'multiple' | 'text' | 'rating';
  question: string;
  options?: string[];
  required?: boolean;
};

export type SurveyProps = {
  title?: string;
  questions: SurveyQuestion[];
  show_progress?: boolean;
  completion_reward_text?: string;
};

export type EmailCaptureProps = {
  headline: string;
  description?: string;
  reward_description?: string;
  consent_text: string;
  consent_required: boolean;
  success_text?: string;
  legal_notice?: string;
};

export type ClickRewardsProps = {
  reward_type: 'like' | 'share' | 'scroll';
  target_count: number;
  reward_description: string;
  show_progress: boolean;
};

// 카테고리 C. 참여형 이벤트

export type LuckyDrawFormField = {
  name: 'name' | 'phone' | 'email';
  required: boolean;
};

/** 추첨 경품 등급 (A editor 설정 → 발행 시 dm_prizes win_method='random' 동기화) */
export type LuckyDrawPrize = {
  rank: number;
  name: string;
  count: number;
};

export type LuckyDrawProps = {
  title: string;
  description?: string;
  form_fields: LuckyDrawFormField[];
  draw_at: string;
  result_announce_url?: string;
  consent_text: string;
  prizes?: LuckyDrawPrize[];
};

export type RouletteSegment = {
  id: string;
  label: string;
  probability: number;
  reward_description?: string;
  prize_count?: number; // 재고(>0=경품, 0/없음=꽝). 발행 시 dm_prizes win_method='roulette' 동기화
};

export type RouletteProps = {
  segments: RouletteSegment[];
  one_spin_per_user: boolean;
  spin_animation_ms?: number;
};

export type InstantCouponProps = {
  coupon_label: string;
  discount_description: string;
  expires_at?: string;
  conditions?: string;
  usage_instructions?: string;
};

export type LimitedQuantityProps = {
  title: string;
  description?: string;
  total_quantity: number;
  current_remaining?: number;
  signup_url?: string;
};

// 카테고리 D. 외부 임베드 + 매장 안내

export type YoutubeEmbedProps = {
  video_url: string;
  auto_play?: boolean;
  thumbnail_url?: string;
};

export type InstagramEmbedProps = {
  post_url: string;
};

export type MapStore = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone?: string;
  hours?: string;
};

export type MapStoreLocatorProps = {
  stores: MapStore[];
  enable_user_location?: boolean;
  default_zoom?: number;
};

export type ReviewItem = {
  rating: number;
  author: string;
  body: string;
  date?: string;
};

export type ReviewsProps = {
  title?: string;
  reviews: ReviewItem[];
  show_average_rating?: boolean;
  show_more_link?: string;
};

// ────────────── Props 맵 (타입 레벨) ──────────────

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

// ────────────── 변수 바인딩 (개인화 fallback) ──────────────

export type VariableBinding = {
  variable: string;             // '%고객명%'
  fallback: string;             // '고객님'
  hide_section_if_empty?: boolean;
};

// ────────────── 통합 Section 타입 ──────────────

export type Section = {
  id: string;
  type: SectionType;
  order: number;
  visible: boolean;
  style_variant?: string;       // 'beauty-elegant' | 'fashion-editorial' | ... (색/톤 변형)
  treatment?: string;           // 섹션 구도 변형(아트디렉션). 미설정=classic(현행). 허용값=dm-art-direction.TREATMENTS
  props: SectionProps;
  ai_locked?: boolean;
  variable_fallbacks?: VariableBinding[];
  align?: 'left' | 'center' | 'right';  // 섹션 공통 정렬(전 섹션 일괄, 미설정=가운데)
  accent_color?: string;                // 섹션 버튼/액센트 색 override(미설정=브랜드 색)
  accent_color_2?: string;              // ★ 2026-07-14 배경면=그라데이션 두 번째 색(임은지). 미설정=자동 도출
  // ★ 2026-07-02(2) 섹션 공통 텍스트 크기(px, 10~80) — 제목급(hero/h1~h3)·본문급(body/small) 토큰 일괄 override. 미설정=기본
  title_size?: number;
  text_size?: number;
  // ★ 2026-07-13 디자인 3.0 — 섹션 배경면/연결부/겹침 (미설정 = 현행 렌더 그대로. 3면: SSR renderSection·캔버스 SectionRenderer·RightPanel)
  background?: 'soft' | 'tint' | 'dark' | 'gradient' | 'glass';
  divider_shape?: 'wave' | 'slant' | 'curve';
  pull_up?: boolean;
  // 개인화 조건부 표시 — 충족 안 하는 수신자에겐 이 섹션 제외(미설정=항상 표시). 이메일 발송 시 평가
  display_condition?: {
    field: string;
    op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
    value: string;
  };
};

// ────────────── 기본값 ──────────────

export const SECTION_DEFAULTS: { [K in SectionType]: SectionPropsMap[K] } = {
  // 옛 11
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
  // D216+ 신규 16
  product_carousel: {
    products: [],
    show_indicator: true,
    auto_slide: false,
    slide_interval_ms: 4000,
  },
  gallery: {
    images: [],
    layout: 'grid_2x2',
    enable_zoom: true,
    enable_fullscreen: false,
  },
  slideshow: {
    slides: [],
    interval_ms: 4000,
    show_pause: true,
    show_indicator: true,
  },
  tab_cards: {
    tabs: [
      { label: '탭 1', content_type: 'text', content: '[직접 작성해주세요]' },
    ],
    default_tab_index: 0,
  },
  poll: {
    question: '[직접 작성해주세요]',
    options: [
      { id: '1', label: '옵션 1' },
      { id: '2', label: '옵션 2' },
    ],
    one_vote_per_user: true,
    show_result_after_vote: true,
    allow_multiple: false,
  },
  survey: {
    questions: [],
    show_progress: true,
  },
  email_capture: {
    headline: '[직접 작성해주세요]',
    consent_text: '개인정보 수집 및 마케팅 정보 수신 동의',
    consent_required: true,
  },
  click_rewards: {
    reward_type: 'like',
    target_count: 10,
    reward_description: '[직접 작성해주세요]',
    show_progress: true,
  },
  lucky_draw: {
    title: '[직접 작성해주세요]',
    form_fields: [
      { name: 'name', required: true },
      { name: 'phone', required: true },
    ],
    draw_at: '',
    consent_text: '개인정보 수집 및 마케팅 정보 수신 동의',
  },
  roulette: {
    segments: Array.from({ length: 8 }, (_, i) => ({
      id: String(i + 1),
      label: `옵션 ${i + 1}`,
      probability: 0.125,
    })),
    one_spin_per_user: true,
    spin_animation_ms: 3000,
  },
  instant_coupon: {
    coupon_label: '[직접 작성해주세요]',
    discount_description: '[직접 작성해주세요]',
  },
  limited_quantity: {
    title: '[직접 작성해주세요]',
    total_quantity: 100,
  },
  youtube_embed: {
    video_url: '',
    auto_play: false,
  },
  instagram_embed: {
    post_url: '',
  },
  map_store_locator: {
    stores: [],
    enable_user_location: false,
    default_zoom: 14,
  },
  reviews: {
    reviews: [],
    show_average_rating: true,
  },
};

// ────────────── 메타데이터 (에디터/AI용) ──────────────

export type SectionCategory =
  | 'header_footer'
  | 'hero_visual'
  | 'commerce'
  | 'interactive'
  | 'event'
  | 'embed'
  | 'info';

export type SectionMeta = {
  label: string;
  description: string;
  icon: string;                 // 이모지 (프론트 패널용 가볍게)
  maxCount: number;             // 한 DM 내 최대 허용 개수
  defaultStyleVariant: string;
  supportsStyleVariants: string[];
  aiAware: boolean;             // AI가 생성할 수 있는 섹션인지
  category?: SectionCategory;   // D216+ 신규 — 섹션 분류
  beta?: boolean;               // D216+ 신규 — 베타 표기
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
    category: 'header_footer',
  },
  hero: {
    label: '히어로 (메인 비주얼)',
    description: '풀 배너 이미지 + 메인 헤드라인 + 서브카피',
    icon: '🎯',
    maxCount: 2,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'beauty-elegant', 'beauty-bold', 'fashion-editorial', 'food-warm', 'luxury'],
    aiAware: true,
    category: 'hero_visual',
  },
  coupon: {
    label: '쿠폰',
    description: '할인율 + 쿠폰코드 + 유효기간',
    icon: '🎟️',
    maxCount: 3,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'beauty-elegant', 'fashion-editorial', 'food-warm'],
    aiAware: true,
    category: 'event',
  },
  countdown: {
    label: '카운트다운',
    description: '종료 시각 + 긴급성 문구',
    icon: '⏰',
    maxCount: 2,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'urgent', 'elegant'],
    aiAware: true,
    category: 'event',
  },
  text_card: {
    label: '텍스트 카드',
    description: '헤드라인 + 본문 + 강조 태그',
    icon: '📝',
    maxCount: 10,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'beauty-elegant', 'fashion-editorial', 'food-warm', 'luxury'],
    aiAware: true,
    category: 'info',
  },
  cta: {
    label: 'CTA 버튼',
    description: '버튼 1~2개 + 링크',
    icon: '👆',
    maxCount: 5,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'bold', 'elegant'],
    aiAware: true,
    category: 'commerce',
  },
  video: {
    label: '영상',
    description: '썸네일 + 재생 버튼 + 랜딩',
    icon: '🎬',
    maxCount: 2,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'editorial'],
    aiAware: false,
    category: 'hero_visual',
  },
  store_info: {
    label: '매장/고객센터',
    description: '전화 + 홈페이지 + 매장찾기',
    icon: '📞',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'elegant'],
    aiAware: false,
    category: 'info',
  },
  sns: {
    label: 'SNS',
    description: '인스타/유튜브/카카오',
    icon: '📱',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'minimal'],
    aiAware: false,
    category: 'info',
  },
  promo_code: {
    label: '프로모션 코드',
    description: '프로모션 코드 + 사용안내',
    icon: '🎁',
    maxCount: 2,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'bold'],
    aiAware: true,
    category: 'event',
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
  // 카테고리 A. 시각 카드형
  product_carousel: {
    label: '상품 슬라이드',
    description: '상품 다수 (사진 + 가격 + 할인) 2열 중앙 그리드',
    icon: '🛍️',
    maxCount: 3,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'beauty-elegant', 'fashion-editorial'],
    aiAware: true,
    category: 'commerce',
  },
  gallery: {
    label: '갤러리',
    description: '다중 사진 그리드 (2×2 / 3×3 / 1×N) + 풀스크린',
    icon: '🖼️',
    maxCount: 5,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'minimal', 'editorial'],
    aiAware: true,
    category: 'hero_visual',
  },
  slideshow: {
    label: '자동 슬라이드쇼',
    description: '3~5초 자동 전환 + 일시정지',
    icon: '🎞️',
    maxCount: 2,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: true,
    category: 'hero_visual',
  },
  tab_cards: {
    label: '탭 카드',
    description: '카테고리별 탭 분기 콘텐츠',
    icon: '📑',
    maxCount: 3,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: false,
    category: 'commerce',
  },
  // 카테고리 B. 인터랙션 수집형
  poll: {
    label: '실시간 투표',
    description: '질문 + 옵션 2~5 + 실시간 결과 %',
    icon: '📊',
    maxCount: 2,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: true,
    category: 'interactive',
    beta: true,
  },
  survey: {
    label: '설문',
    description: '다중 질문 + 진행률 + 완료 보상',
    icon: '📝',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: true,
    category: 'interactive',
    beta: true,
  },
  email_capture: {
    label: '이메일 수집',
    description: '이메일 입력 + 동의 체크 + 즉시 쿠폰 발급',
    icon: '✉️',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: true,
    category: 'interactive',
  },
  click_rewards: {
    label: '참여 보상',
    description: '좋아요 / 공유 / 스크롤 적립 + 진행률',
    icon: '⭐',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: false,
    category: 'interactive',
    beta: true,
  },
  // 카테고리 C. 참여형 이벤트
  lucky_draw: {
    label: '추첨 이벤트',
    description: '응모 + 자동 추첨 + 결과 발표',
    icon: '🎁',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: true,
    category: 'event',
    beta: true,
  },
  roulette: {
    label: '룰렛 이벤트',
    description: '8 영역 회전 휠 + 자동 당첨',
    icon: '🎡',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: false,
    category: 'event',
    beta: true,
  },
  instant_coupon: {
    label: '즉시 쿠폰 발급',
    description: '만료 카운트다운 + 사용 안내',
    icon: '🎟️',
    maxCount: 2,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: true,
    category: 'event',
  },
  limited_quantity: {
    label: '선착순 한정',
    description: '실시간 잔여 수량 + 완료 알림',
    icon: '⏳',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default', 'urgent'],
    aiAware: true,
    category: 'event',
  },
  // 카테고리 D. 외부 임베드 + 매장 안내
  youtube_embed: {
    label: 'YouTube 임베드',
    description: 'YouTube URL 공식 임베드',
    icon: '▶️',
    maxCount: 2,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: false,
    category: 'embed',
  },
  instagram_embed: {
    label: 'Instagram 임베드',
    description: 'Instagram post 공식 임베드',
    icon: '📷',
    maxCount: 2,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: false,
    category: 'embed',
  },
  map_store_locator: {
    label: '매장 찾기 지도',
    description: '지도 + 매장 다수 + 가까운 매장 자동 정렬',
    icon: '🗺️',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: false,
    category: 'info',
  },
  reviews: {
    label: '리뷰',
    description: '별점 + 본문 + 평균 별점 + 더 보기',
    icon: '⭐',
    maxCount: 1,
    defaultStyleVariant: 'default',
    supportsStyleVariants: ['default'],
    aiAware: true,
    category: 'info',
  },
};

// ────────────── 헬퍼 ──────────────

/** 섹션 타입의 기본 props를 깊은 복사로 반환 */
export function getDefaultProps<T extends SectionType>(type: T): SectionPropsMap[T] {
  return JSON.parse(JSON.stringify(SECTION_DEFAULTS[type])) as SectionPropsMap[T];
}

/** 새 Section 객체 생성 (id는 호출부에서 uuid 등으로 지정) */
export function createSection<T extends SectionType>(
  type: T,
  id: string,
  order: number,
  overrides?: Partial<SectionPropsMap[T]>,
): Section {
  const meta = SECTION_META[type];
  const defaults = getDefaultProps(type);
  return {
    id,
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

/** 섹션 타입이 유효한지 검증 */
export function isValidSectionType(type: string): type is SectionType {
  return SECTION_TYPES.includes(type as SectionType);
}

/** 섹션 최대 개수 초과 여부 체크 */
export function isMaxCountExceeded(sections: Section[], type: SectionType): boolean {
  const max = SECTION_META[type].maxCount;
  const count = sections.filter((s) => s.type === type).length;
  return count >= max;
}
