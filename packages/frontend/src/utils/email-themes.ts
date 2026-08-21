/**
 * email-themes.ts — 이메일 디자인 테마 프리셋 8종 (★ 2026-07-13 이메일 디자인 3.0)
 *
 * DM 테마 8종(dm-themes.ts)과 같은 큐레이션을 이메일 안전형으로 재구성 — grain(질감)·모션 제외.
 * 테마 = 캠페인 design(색·서체·아트디렉션) 패치. 적용 = 편집기 design state 1회 갱신 —
 * email_campaigns.design JSONB로 캠페인 단위 저장(회사 brand_kit 무변경 = DM·인앱·타 캠페인 영향 0).
 * 소비처: 백엔드 email-tokens.resolveEmailBrand(다크 셸·타입스케일·모티프·디바이더·서체 폴백 스택).
 * 색·서체·룩만 다룬다 — 문안/혜택/사실은 절대 건드리지 않는다.
 */

// 백엔드 utils/email/email-tokens.ts EmailDesign 미러 (SSOT — enum 값 동기)
export interface EmailDesign {
  theme?: string;
  art_direction?: {
    typeScale?: 'editorial' | 'bold' | 'minimal';
    spacingDensity?: 'compact' | 'standard' | 'airy';
    accentMotif?: 'none' | 'rule' | 'dot' | 'bracket' | 'index';
    sectionDivider?: 'none' | 'hairline' | 'gap' | 'rule';
  };
  font_family?: string;
  font_display?: string;
  palette?: { primary?: string; accent?: string; background?: string };
  preheader?: string;
}

export type EmailDesignTheme = {
  id: string;
  name: string;
  description: string;
  /** 카드 미리보기 스와치(좌→우) */
  swatches: [string, string, string];
  /** 미리보기 헤드라인 서체 표시용 */
  previewFont?: string;
  design: EmailDesign;
};

export const EMAIL_DESIGN_THEMES: EmailDesignTheme[] = [
  {
    id: 'editorial',
    name: '에디토리얼',
    description: '세리프 헤드라인 · 넉넉한 여백 · 헤어라인 구분: 잡지 화보 톤',
    swatches: ['#111827', '#b45309', '#ffffff'],
    previewFont: '"Noto Serif KR", serif',
    design: {
      theme: 'editorial',
      palette: { primary: '#111827', accent: '#b45309', background: '#ffffff' },
      font_display: '"Noto Serif KR", serif',
      art_direction: { typeScale: 'editorial', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'hairline' },
    },
  },
  {
    id: 'luxury-dark',
    name: '럭셔리 다크',
    description: '딥 다크 셸 · 골드 액센트: 프라이빗 오퍼 톤 (다크 발송물)',
    swatches: ['#0e1018', '#d4af37', '#b89150'],
    previewFont: '"Noto Serif KR", serif',
    design: {
      theme: 'luxury-dark',
      palette: { primary: '#b89150', accent: '#d4af37', background: '#0e1018' },
      font_display: '"Noto Serif KR", serif',
      art_direction: { typeScale: 'editorial', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'rule' },
    },
  },
  {
    id: 'minimal',
    name: '미니멀',
    description: '절제된 크기 · 여백 구분 · 무장식: 조용하고 정갈한 안내 톤',
    swatches: ['#3b82f6', '#93c5fd', '#ffffff'],
    design: {
      theme: 'minimal',
      palette: { primary: '#3b82f6', accent: '#93c5fd', background: '#ffffff' },
      art_direction: { typeScale: 'minimal', spacingDensity: 'standard', accentMotif: 'none', sectionDivider: 'gap' },
    },
  },
  {
    id: 'bold-sale',
    name: '볼드 세일',
    description: '검은고딕 임팩트 · 압축 밀도 · 섹션 넘버링: 세일 전용 조판',
    swatches: ['#18181b', '#fde68a', '#ef4444'],
    previewFont: '"Black Han Sans", sans-serif',
    design: {
      theme: 'bold-sale',
      palette: { primary: '#18181b', accent: '#fde68a', background: '#ffffff' },
      font_display: '"Black Han Sans", sans-serif',
      art_direction: { typeScale: 'bold', spacingDensity: 'compact', accentMotif: 'index', sectionDivider: 'none' },
    },
  },
  {
    id: 'soft-pastel',
    name: '소프트 파스텔',
    description: '옅은 핑크 셸 · 도트 포인트: 부드러운 안부·복귀 톤',
    swatches: ['#ec4899', '#fbcfe8', '#fffafc'],
    design: {
      theme: 'soft-pastel',
      palette: { primary: '#ec4899', accent: '#fbcfe8', background: '#fffafc' },
      art_direction: { typeScale: 'minimal', spacingDensity: 'airy', accentMotif: 'dot', sectionDivider: 'gap' },
    },
  },
  {
    id: 'paper',
    name: '웜 페이퍼',
    description: '종이 톤 배경 · 고운바탕 세리프: 따뜻한 로컬 톤',
    swatches: ['#9a5b33', '#e8b96a', '#faf6ef'],
    previewFont: '"Gowun Batang", serif',
    design: {
      theme: 'paper',
      palette: { primary: '#9a5b33', accent: '#e8b96a', background: '#faf6ef' },
      font_display: '"Gowun Batang", serif',
      art_direction: { typeScale: 'editorial', spacingDensity: 'airy', accentMotif: 'dot', sectionDivider: 'hairline' },
    },
  },
  {
    id: 'city-night',
    name: '시티 나이트',
    description: '다크 셸 · 시안 네온: 테크·이벤트 밤 무드 (다크 발송물)',
    swatches: ['#0b1220', '#0ea5e9', '#22d3ee'],
    design: {
      theme: 'city-night',
      palette: { primary: '#0ea5e9', accent: '#22d3ee', background: '#0b1220' },
      art_direction: { typeScale: 'bold', spacingDensity: 'standard', accentMotif: 'index', sectionDivider: 'none' },
    },
  },
  {
    id: 'festive',
    name: '페스티브',
    description: '로즈×앰버 · 브래킷 포인트: 팝업·이벤트 초대장 톤',
    swatches: ['#e11d48', '#fbbf24', '#ffffff'],
    design: {
      theme: 'festive',
      palette: { primary: '#e11d48', accent: '#fbbf24', background: '#ffffff' },
      art_direction: { typeScale: 'bold', spacingDensity: 'standard', accentMotif: 'bracket', sectionDivider: 'none' },
    },
  },
];

/** 테마 적용 — 룩(색·서체·아트디렉션)만 교체, 사용자 콘텐츠(preheader)는 보존. */
export function applyEmailTheme(current: EmailDesign | null, theme: EmailDesignTheme): EmailDesign {
  return {
    ...theme.design,
    ...(current?.preheader ? { preheader: current.preheader } : {}),
  };
}

/** 이메일 안전 구도 픽커 옵션 — 백엔드 EMAIL_TREATMENTS(email-blocks.ts) 미러 (SSOT 동기 수정 필수). */
export const EMAIL_TREATMENT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  hero: [
    { value: 'classic', label: '기본' },
    { value: 'split', label: '분할 (이미지+텍스트)' },
    { value: 'typographic', label: '타이포 (이미지 미사용)' },
  ],
  text_card: [
    { value: 'classic', label: '기본' },
    { value: 'lead', label: '리드문 (큰 본문)' },
    { value: 'framed', label: '프레임' },
    { value: 'quote', label: '인용' },
  ],
  cta: [
    { value: 'classic', label: '기본' },
    { value: 'bar', label: '전폭 밴드' },
    { value: 'ghost', label: '아웃라인' },
  ],
  coupon: [
    { value: 'classic', label: '티켓 (기본)' },
    { value: 'spotlight', label: '스포트라이트 (다크)' },
  ],
  product_carousel: [
    { value: 'classic', label: '2열 그리드 (기본)' },
    { value: 'focus', label: '대표 상품 강조' },
    { value: 'list', label: '리스트' },
  ],
};

/** 이메일 배경면 옵션 — 백엔드 EMAIL_BACKGROUNDS 미러 (glass 제외). */
export const EMAIL_BACKGROUND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: '없음' },
  { value: 'soft', label: '소프트' },
  { value: 'tint', label: '틴트' },
  { value: 'dark', label: '다크' },
  { value: 'gradient', label: '그라데이션' },
];
