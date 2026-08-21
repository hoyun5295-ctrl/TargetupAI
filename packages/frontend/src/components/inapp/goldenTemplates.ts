/**
 * ★ 2026-07-14 인앱 디자인 3.0 — 골든 템플릿 12종 (DM dm-template-registry / 이메일 email-templates 방법론)
 *
 * 완성형 = 표시 형태(template) × 카드 형태(card_style) × 테마 × 블록 배열 + design(모션·구도).
 * 원칙:
 *  - 혜택 수치 0 — benefit 블록은 placeholder 그대로(저장 시 직접 작성 강제 = AI 임의 혜택 영구 룰과 동일 게이트)
 *  - 버튼 URL = "[URL — 회사 admin 수정]" placeholder (SDK가 이동 차단)
 *  - 트리거/세그먼트/시간대는 건드리지 않는다 — 디자인·블록만 교체
 *  - 채널 웹 허용 4형태(center_modal/slide_in/toast/floating_button) 안에서만 구성
 */

export interface GoldenInAppTemplate {
  id: string;
  label: string;
  hint: string;
  template: 'center_modal' | 'slide_in' | 'toast' | 'floating_button';
  card_style: 'classic' | 'bubble' | 'ticket' | 'poster';
  theme: string;
  design: Record<string, any>;
  is_ad?: boolean;
  badge_text?: string;
  content_blocks: any[];
  /** 카드 스와치 (좌→우) — 픽커 시각 표본 */
  swatches: [string, string, string];
}

const CTA_URL = '[URL: 회사 admin 수정]';
const BENEFIT_PH = '[혜택 안내: 직접 작성해주세요]';

export const GOLDEN_INAPP_TEMPLATES: GoldenInAppTemplate[] = [
  {
    id: 'welcome-pastel', label: '환영 인사', hint: '말풍선 · 소프트 파스텔',
    template: 'center_modal', card_style: 'bubble', theme: 'soft-pastel',
    design: { motion: 'rich' },
    swatches: ['#ec4899', '#fbcfe8', '#fffafc'],
    content_blocks: [
      { type: 'eyebrow', text: '처음 오셨네요', tone: 'accent' },
      { type: 'headline', text: '만나서 반가워요', size: 'lg' },
      { type: 'body', text: '{{ customer.name }}님, 함께하게 되어 기뻐요.\n둘러보시면서 마음에 드는 것을 찾아보세요.' },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '둘러보기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'comeback-paper', label: '오랜만의 안부', hint: '말풍선 · 웜 페이퍼',
    template: 'center_modal', card_style: 'bubble', theme: 'paper',
    design: { motion: 'rich' },
    swatches: ['#9a5b33', '#e8b96a', '#faf6ef'],
    content_blocks: [
      { type: 'eyebrow', text: '오랜만이에요', tone: 'accent' },
      { type: 'headline', text: '다시 만나 반가워요', size: 'lg' },
      { type: 'body', text: '{{ customer.name }}님, 그동안 잘 지내셨나요?\n그 사이 새로운 소식이 많이 쌓였어요.' },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '새 소식 보기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'vip-luxury', label: 'VIP 프라이빗', hint: '액자 구도 · 럭셔리 다크',
    template: 'center_modal', card_style: 'classic', theme: 'luxury-dark',
    design: { motion: 'rich', treatment: 'framed' },
    swatches: ['#0e1018', '#d4af37', '#b89150'],
    content_blocks: [
      { type: 'eyebrow', text: 'PRIVATE', tone: 'accent' },
      { type: 'headline', text: '소중한 고객님께 드리는 초대', size: 'lg' },
      { type: 'body', text: '오랜 시간 함께해주신 {{ customer.name }}님을 위해\n준비한 프라이빗 안내입니다.' },
      { type: 'benefit', text: BENEFIT_PH },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '초대 확인하기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'sale-bold', label: '세일 임박', hint: '타이포 강조 · 볼드 세일',
    template: 'center_modal', card_style: 'classic', theme: 'bold-sale',
    design: { motion: 'rich', treatment: 'typographic' },
    is_ad: true,
    swatches: ['#18181b', '#ef4444', '#ffffff'],
    content_blocks: [
      { type: 'eyebrow', text: '마감 임박', tone: 'accent' },
      { type: 'headline', text: '이번 주말이 마지막이에요', size: 'xl', emphasis: 'marker' },
      { type: 'body', text: '망설이는 사이 끝나버릴 수 있어요.\n지금 확인해보세요.' },
      { type: 'benefit', text: BENEFIT_PH },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '지금 보러가기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'newdrop-night', label: '신상 발표', hint: '포스터 · 시티 나이트',
    template: 'center_modal', card_style: 'poster', theme: 'city-night',
    design: { motion: 'rich' },
    swatches: ['#0b1220', '#22d3ee', '#0ea5e9'],
    content_blocks: [
      { type: 'media', variant: 'image', url: '', aspect: '16:9' },
      { type: 'eyebrow', text: 'NEW DROP', tone: 'accent' },
      { type: 'headline', text: '새로운 컬렉션 공개', size: 'xl' },
      { type: 'body', text: '기다려주신 신상품이 도착했어요.\n가장 먼저 만나보세요.' },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '컬렉션 보기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'coupon-festive', label: '쿠폰 티켓', hint: '절취 티켓 · 페스티브',
    template: 'center_modal', card_style: 'ticket', theme: 'festive',
    design: { motion: 'rich' },
    is_ad: true,
    swatches: ['#e11d48', '#fbbf24', '#ffffff'],
    content_blocks: [
      { type: 'eyebrow', text: 'COUPON', tone: 'accent' },
      { type: 'headline', text: '고객님을 위한 쿠폰이 도착했어요', size: 'lg' },
      { type: 'benefit', text: BENEFIT_PH },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '쿠폰 받기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'editorial-notice', label: '프리미엄 안내', hint: '액자 구도 · 에디토리얼',
    template: 'center_modal', card_style: 'classic', theme: 'editorial',
    design: { motion: 'rich', treatment: 'framed' },
    swatches: ['#1c1917', '#b45309', '#ffffff'],
    content_blocks: [
      { type: 'eyebrow', text: 'NOTICE', tone: 'accent' },
      { type: 'headline', text: '조용히 전해드리는 소식', size: 'lg' },
      { type: 'body', text: '고객님께 먼저 알려드리고 싶은\n이야기가 있어 글을 남깁니다.' },
      { type: 'divider' },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '자세히 읽기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'review-glass', label: '후기·신뢰', hint: '슬라이드 인 · 소프트 글래스',
    template: 'slide_in', card_style: 'classic', theme: 'light',
    design: { motion: 'rich' },
    swatches: ['#ffffff', '#6d5cf0', '#f4f5fb'],
    content_blocks: [
      { type: 'rating', value: 4.8, count: 1200, label: '후기' },
      { type: 'headline', text: '많은 분들이 만족하셨어요', size: 'md' },
      { type: 'body', text: '실제 구매 고객님들의 생생한 후기를 확인해보세요.' },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '후기 보기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'cart-ticket', label: '장바구니 회복', hint: '슬라이드 티켓 · 파스텔',
    template: 'slide_in', card_style: 'ticket', theme: 'soft-pastel',
    design: { motion: 'rich' },
    is_ad: true,
    swatches: ['#ec4899', '#fbcfe8', '#fffafc'],
    content_blocks: [
      { type: 'eyebrow', text: '장바구니', tone: 'accent' },
      { type: 'headline', text: '담아두신 상품이 기다리고 있어요', size: 'md' },
      { type: 'benefit', text: BENEFIT_PH },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '장바구니 가기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'event-invite', label: '이벤트 초대', hint: '슬라이드 인 · 페스티브',
    template: 'slide_in', card_style: 'classic', theme: 'festive',
    design: { motion: 'rich', treatment: 'typographic' },
    swatches: ['#e11d48', '#fbbf24', '#ffffff'],
    content_blocks: [
      { type: 'eyebrow', text: 'INVITATION', tone: 'accent' },
      { type: 'headline', text: '특별한 자리에 초대합니다', size: 'lg', emphasis: 'underline' },
      { type: 'body', text: '{{ customer.name }}님을 위한 이벤트가 열려요.' },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '초대장 열기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
  {
    id: 'quiet-toast', label: '조용한 공지', hint: '토스트 · 미니멀',
    template: 'toast', card_style: 'classic', theme: 'minimal',
    design: {},
    swatches: ['#ffffff', '#111827', '#f7f7f8'],
    content_blocks: [
      { type: 'headline', text: '새 소식이 도착했어요', size: 'sm' },
      { type: 'body', text: '마이페이지에서 확인하실 수 있어요.', size: 'sm' },
    ],
  },
  {
    id: 'floating-brand', label: '플로팅 진입', hint: '플로팅 버튼 · 브랜드',
    template: 'floating_button', card_style: 'classic', theme: 'brand',
    design: {},
    swatches: ['#ffffff', '#6d5cf0', '#f4f5fb'],
    content_blocks: [
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '이벤트 확인하기', action_url: CTA_URL, style: 'primary' }] },
    ],
  },
];
