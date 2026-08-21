/**
 * dm-themes.ts — 모바일 DM 디자인 테마 프리셋 8종 (★ 2026-07-13 디자인 3.0)
 *
 * 테마 = 브랜드킷 패치(색·서체·아트디렉션)의 큐레이션 조합.
 * 적용 = dmBuilderStore.updateBrandKit(theme.kit) 한 번 — brand_kit JSONB로 저장·발행까지 영속(DDL 0).
 * 아트디렉션 소비처: 뷰어(normalizeArtDirection 주입 — 타입스케일·모티프·디바이더·그레인) + 캔버스(data 속성).
 * 색·서체·룩만 다룬다 — 문안/혜택/사실은 절대 건드리지 않는다.
 */
import type { DmBrandKit } from '../stores/dmBuilderStore';

export type DmDesignTheme = {
  id: string;
  name: string;
  description: string;
  /** 카드 미리보기 스와치(좌→우) */
  swatches: [string, string, string];
  /** 미리보기 헤드라인 서체 표시용 */
  previewFont?: string;
  kit: Partial<DmBrandKit>;
  /** 이 톤들에 추천 배지 표시 */
  recommendedTones?: Array<NonNullable<DmBrandKit['tone']>>;
};

export const DM_DESIGN_THEMES: DmDesignTheme[] = [
  {
    id: 'editorial',
    name: '에디토리얼',
    description: '세리프 헤드라인 · 넉넉한 여백 · 헤어라인 구분: 잡지 화보 톤',
    swatches: ['#111827', '#b45309', '#ffffff'],
    previewFont: '"Noto Serif KR", serif',
    recommendedTones: ['premium', 'elegant'],
    kit: {
      primary_color: '#111827', accent_color: '#b45309', background_color: '#ffffff',
      font_display: '"Noto Serif KR", serif',
      art_direction: { theme: 'editorial', typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'hairline' },
    },
  },
  {
    id: 'luxury-dark',
    name: '럭셔리 다크',
    description: '딥 다크 서피스 · 골드 액센트 · 그레인: 프라이빗 오퍼 톤',
    swatches: ['#0e1018', '#d4af37', '#b89150'],
    previewFont: '"Noto Serif KR", serif',
    recommendedTones: ['premium'],
    kit: {
      primary_color: '#b89150', accent_color: '#d4af37', background_color: '#0e1018',
      font_display: '"Noto Serif KR", serif',
      art_direction: { theme: 'luxury-dark', typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'rule', grain: true },
    },
  },
  {
    id: 'minimal',
    name: '미니멀',
    description: '절제된 크기 · 여백 구분 · 무장식: 조용하고 정갈한 안내 톤',
    swatches: ['#3b82f6', '#93c5fd', '#ffffff'],
    recommendedTones: ['friendly'],
    kit: {
      primary_color: '#3b82f6', accent_color: '#93c5fd', background_color: '#ffffff',
      font_display: undefined,
      art_direction: { theme: 'minimal', typeScale: 'minimal', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'none', sectionDivider: 'gap' },
    },
  },
  {
    id: 'bold-sale',
    name: '볼드 세일',
    description: '검은고딕 임팩트 · 압축 밀도 · 섹션 넘버링: 세일 전용 조판',
    swatches: ['#18181b', '#fde68a', '#ef4444'],
    previewFont: '"Black Han Sans", sans-serif',
    recommendedTones: ['urgent'],
    kit: {
      primary_color: '#18181b', accent_color: '#fde68a', background_color: '#ffffff',
      font_display: '"Black Han Sans", sans-serif',
      art_direction: { theme: 'bold-sale', typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'compact', accentMotif: 'index', sectionDivider: 'none' },
    },
  },
  {
    id: 'soft-pastel',
    name: '소프트 파스텔',
    description: '옅은 핑크 서피스 · 도트 포인트: 부드러운 안부·복귀 톤',
    swatches: ['#ec4899', '#fbcfe8', '#fffafc'],
    recommendedTones: ['friendly', 'playful'],
    kit: {
      primary_color: '#ec4899', accent_color: '#fbcfe8', background_color: '#fffafc',
      font_display: undefined,
      art_direction: { theme: 'soft-pastel', typeScale: 'minimal', headlineFont: 'sans', spacingDensity: 'airy', accentMotif: 'dot', sectionDivider: 'gap' },
    },
  },
  {
    id: 'paper',
    name: '웜 페이퍼',
    description: '종이 질감 배경 · 고운바탕 세리프 · 그레인: 따뜻한 로컬 톤',
    swatches: ['#9a5b33', '#e8b96a', '#faf6ef'],
    previewFont: '"Gowun Batang", serif',
    recommendedTones: ['friendly', 'elegant'],
    kit: {
      primary_color: '#9a5b33', accent_color: '#e8b96a', background_color: '#faf6ef',
      font_display: '"Gowun Batang", serif',
      art_direction: { theme: 'paper', typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'dot', sectionDivider: 'hairline', grain: true },
    },
  },
  {
    id: 'city-night',
    name: '시티 나이트',
    description: '다크 배경 · 시안 네온 · 그레인: 테크·이벤트 밤 무드',
    swatches: ['#0b1220', '#0ea5e9', '#22d3ee'],
    recommendedTones: ['premium', 'urgent'],
    kit: {
      primary_color: '#0ea5e9', accent_color: '#22d3ee', background_color: '#0b1220',
      font_display: undefined,
      art_direction: { theme: 'city-night', typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'index', sectionDivider: 'none', grain: true },
    },
  },
  {
    id: 'festive',
    name: '페스티브',
    description: '로즈×앰버 · 브래킷 포인트: 팝업·이벤트 초대장 톤',
    swatches: ['#e11d48', '#fbbf24', '#ffffff'],
    recommendedTones: ['playful', 'urgent'],
    kit: {
      primary_color: '#e11d48', accent_color: '#fbbf24', background_color: '#ffffff',
      font_display: undefined,
      art_direction: { theme: 'festive', typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'bracket', sectionDivider: 'none' },
    },
  },
];

/** 현재 브랜드킷 톤 기반 추천 테마 id (결정적 — AI 호출·임의 상수 없음) */
export function recommendThemeIds(tone?: DmBrandKit['tone']): string[] {
  if (!tone) return [];
  return DM_DESIGN_THEMES.filter((t) => t.recommendedTones?.includes(tone)).map((t) => t.id);
}
