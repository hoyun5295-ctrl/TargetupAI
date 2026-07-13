/**
 * dm-tokens.ts (frontend) — 모바일 DM 빌더 디자인 토큰
 *
 * ⚠️ SSOT(Single Source of Truth) — 값은 반드시 backend와 동기화
 *    백엔드 미러: packages/backend/src/utils/dm/dm-tokens.ts
 *    값 변경 시 양쪽 동시 수정 필수.
 *
 * 관련:
 *  - CSS 변수 매핑: packages/frontend/src/styles/dm-builder.css
 *  - 설계서: status/DM-PRO-DESIGN.md §8
 */
import type { CSSProperties } from 'react';

// ────────────── Color ──────────────

export const DM_COLOR_TOKENS = {
  neutral: {
    0:    '#ffffff',
    50:   '#fafafa',
    100:  '#f5f5f5',
    200:  '#e5e5e5',
    300:  '#d4d4d4',
    400:  '#a3a3a3',
    500:  '#737373',
    600:  '#525252',
    700:  '#404040',
    800:  '#262626',
    900:  '#171717',
    1000: '#000000',
  },
  brand: {
    primary:      '#4f46e5',
    primaryHover: '#4338ca',
    primaryLight: '#eef2ff',
    accent:       '#f59e0b',
  },
  semantic: {
    success: '#10b981',
    warning: '#f59e0b',
    error:   '#ef4444',
    info:    '#3b82f6',
  },
  industry: {
    beauty:  { primary: '#ec4899', accent: '#fbcfe8' },
    fashion: { primary: '#18181b', accent: '#fde68a' },
    food:    { primary: '#ea580c', accent: '#fef3c7' },
    tech:    { primary: '#0ea5e9', accent: '#cffafe' },
    luxury:  { primary: '#1e3a8a', accent: '#d4af37' },
  },
} as const;

// ────────────── Typography ──────────────

export const DM_TYPOGRAPHY = {
  fontFamily: {
    primary: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
    serif:   '"Noto Serif KR", serif',
    mono:    '"JetBrains Mono", Menlo, Consolas, monospace',
  },
  // ★ 2026-07-02 디자인 시스템 v2 — 디스플레이급 타입 스케일 상향 (backend dm-tokens.ts와 SSOT 동기)
  scale: {
    hero:  { size: '40px', lineHeight: '1.15', weight: 800, letterSpacing: '-0.03em' },
    h1:    { size: '28px', lineHeight: '1.25', weight: 700, letterSpacing: '-0.02em' },
    h2:    { size: '22px', lineHeight: '1.35', weight: 700, letterSpacing: '-0.01em' },
    h3:    { size: '18px', lineHeight: '1.4', weight: 600, letterSpacing: '0' },
    body:  { size: '16px', lineHeight: '1.65', weight: 400, letterSpacing: '0' },
    small: { size: '13px', lineHeight: '1.55', weight: 400, letterSpacing: '0' },
    tiny:  { size: '11px', lineHeight: '1.4', weight: 400, letterSpacing: '0' },
  },
} as const;

// ────────────── 서체 카탈로그 (디자인 3.0) ──────────────

/**
 * ★ 2026-07-13 — 큐레이션 서체 카탈로그. SSOT: backend dm-tokens.ts 동기.
 * css = brandKit.font_family/font_display에 저장되는 font-family 문자열(기존 저장값 하위호환).
 */
export const DM_FONT_CATALOG: ReadonlyArray<{ id: string; label: string; css: string; google: string | null }> = [
  { id: 'pretendard',     label: '프리텐다드 (기본)',        css: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif', google: null },
  { id: 'noto-serif',     label: '노토 세리프 (명조)',       css: '"Noto Serif KR", serif',       google: 'Noto+Serif+KR:wght@400;600;700;900' },
  { id: 'nanum-myeongjo', label: '나눔명조',                 css: '"Nanum Myeongjo", serif',      google: 'Nanum+Myeongjo:wght@400;700;800' },
  { id: 'gowun-batang',   label: '고운바탕 (부드러운 명조)', css: '"Gowun Batang", serif',        google: 'Gowun+Batang:wght@400;700' },
  { id: 'gowun-dodum',    label: '고운돋움',                 css: '"Gowun Dodum", sans-serif',    google: 'Gowun+Dodum' },
  { id: 'black-han',      label: '검은고딕 (임팩트)',        css: '"Black Han Sans", sans-serif', google: 'Black+Han+Sans' },
];

/** ★ 2026-07-13 — 헤드라인×본문 페어링 프리셋 (BrandKitModal·테마 모달 공용) */
export const DM_FONT_PAIRINGS: ReadonlyArray<{ id: string; label: string; display: string; body: string }> = [
  { id: 'default',   label: '기본 (프리텐다드)',        display: '', body: '' },
  { id: 'editorial', label: '에디토리얼 (명조×고딕)',   display: '"Noto Serif KR", serif', body: '' },
  { id: 'classic',   label: '클래식 (나눔명조×고딕)',   display: '"Nanum Myeongjo", serif', body: '' },
  { id: 'warm',      label: '웜 (고운바탕×고운돋움)',    display: '"Gowun Batang", serif', body: '"Gowun Dodum", sans-serif' },
  { id: 'impact',    label: '임팩트 (검은고딕×고딕)',   display: '"Black Han Sans", sans-serif', body: '' },
  { id: 'serif-all', label: '풀 세리프 (명조×명조)',     display: '"Noto Serif KR", serif', body: '"Noto Serif KR", serif' },
];

/** ★ 2026-07-13 (Codex 지적) — 캔버스도 발행 뷰어와 동일한 아트디렉션 CSS 변수를 미러
 *  (backend dm-art-direction.artDirectionToCssVars의 TYPE_SCALE_VARS/DENSITY/DISPLAY_FONT와 SSOT 동기).
 *  ad 미설정 = 뷰어와 동일하게 중립 기본(bold)을 적용 — 편집 화면 = 발행물. */
export function dmArtDirectionCssVars(
  ad?: { typeScale?: 'editorial' | 'bold' | 'minimal'; headlineFont?: 'sans' | 'serif'; spacingDensity?: 'compact' | 'standard' | 'airy' },
  brandDisplayFont?: string,
): CSSProperties {
  const SCALE: Record<string, { hero: string; w: string; ls: string; h1: string }> = {
    editorial: { hero: '40px', w: '800', ls: '-0.03em', h1: '28px' },
    bold:      { hero: '34px', w: '900', ls: '-0.02em', h1: '24px' },
    minimal:   { hero: '28px', w: '600', ls: '0',       h1: '22px' },
  };
  const DENSITY: Record<string, string> = { compact: '0.8', standard: '1', airy: '1.4' };
  // 영속 데이터는 불량 가능 — 무효 enum은 backend normalize와 동일하게 기본값으로 (Codex 2R 지적: t undefined 크래시 방어)
  const t = SCALE[ad?.typeScale || 'bold'] || SCALE.bold;
  const display = brandDisplayFont
    || (ad?.headlineFont === 'serif' ? '"Noto Serif KR", var(--dm-font-primary)' : 'var(--dm-font-primary)');
  return {
    ['--dm-fs-hero']: t.hero, ['--dm-fw-hero']: t.w, ['--dm-ls-hero']: t.ls, ['--dm-fs-h1']: t.h1,
    ['--dm-section-pad-scale']: DENSITY[ad?.spacingDensity || 'standard'] || '1',
    ['--dm-font-display']: display,
  } as CSSProperties;
}

/** font-family 문자열(들)에서 필요한 Google Fonts css2 URL 생성 — 매칭 0건이면 null (backend 미러) */
export function dmGoogleFontsUrl(...families: Array<string | undefined>): string | null {
  const params: string[] = [];
  for (const f of families) {
    if (!f) continue;
    for (const c of DM_FONT_CATALOG) {
      if (!c.google) continue;
      const first = c.css.split(',')[0].replace(/"/g, '').trim();
      if (f.includes(first) && !params.includes(c.google)) params.push(c.google);
    }
  }
  if (params.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${params.map((p) => `family=${p}`).join('&')}&display=swap`;
}

// ────────────── Spacing / Radius / Shadow ──────────────

export const DM_SPACING = {
  0:  '0',
  1:  '4px',
  2:  '8px',
  3:  '12px',
  4:  '16px',
  5:  '20px',
  6:  '24px',
  8:  '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
} as const;

export const DM_RADIUS = {
  none:  '0',
  sm:    '4px',
  md:    '8px',
  lg:    '12px',
  xl:    '16px',
  '2xl': '24px',
  full:  '9999px',
} as const;

// ★ 2026-07-02 v2 — 슬레이트 틴트의 넓고 부드러운 그림자 (backend dm-tokens.ts와 SSOT 동기)
export const DM_SHADOW = {
  sm: '0 1px 2px rgba(15,23,42,0.06)',
  md: '0 6px 16px -4px rgba(15,23,42,0.10), 0 2px 6px -2px rgba(15,23,42,0.06)',
  lg: '0 12px 28px -6px rgba(15,23,42,0.12), 0 4px 10px -4px rgba(15,23,42,0.06)',
  xl: '0 24px 48px -12px rgba(15,23,42,0.16), 0 10px 18px -8px rgba(15,23,42,0.06)',
} as const;

// ────────────── Motion ──────────────

export const DM_MOTION = {
  sectionEnter: { opacity: [0, 1], y: [10, 0], duration: 240, easing: 'ease-out' },
  sectionExit:  { opacity: [1, 0], y: [0, -10], duration: 180, easing: 'ease-in' },
  dragOver:     { scale: 1.02, shadow: DM_SHADOW.lg, duration: 120 },
  hover:        { duration: 150, easing: 'ease-out' },
  press:        { scale: 0.98, duration: 100, easing: 'ease-out' },
} as const;

// ────────────── Breakpoints ──────────────

export const DM_BREAKPOINTS = {
  mobileSm: 320,
  mobileMd: 375,
  mobileLg: 430,
} as const;

// ────────────── Mobile Frame ──────────────

export const DM_MOBILE_FRAME = {
  maxWidth: '430px',
  minWidth: '320px',
  defaultWidth: '375px',
  canvasPadding: '16px',
} as const;

// ────────────── 타입 ──────────────

export type DmIndustry = keyof typeof DM_COLOR_TOKENS.industry;
export type DmTypographyScale = keyof typeof DM_TYPOGRAPHY.scale;
export type DmSpacing = keyof typeof DM_SPACING;
export type DmRadius = keyof typeof DM_RADIUS;
export type DmShadow = keyof typeof DM_SHADOW;

// ────────────── 유틸 ──────────────

/**
 * WCAG AA 대비 계산 (보조)
 * 두 색의 상대 luminance 차이로 대비비 계산 (AA: 4.5:1 이상)
 */
export function getContrastRatio(fgHex: string, bgHex: string): number {
  const lum = (hex: string): number => {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const ch = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const l1 = lum(fgHex);
  const l2 = lum(bgHex);
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/** 브랜드킷 값을 받아 CSS 변수 스타일 객체로 변환 (에디터/캔버스 inline style용)
 *  ★ 2026-07-13 디자인 3.0 — 서체(본문/헤드라인)·다크 배경 중립 반전까지 캔버스에 미러(뷰어 renderDmTokensCss 동일 규칙). */
export function brandKitToCssVars(kit: {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  neutral_color?: string;
  background_color?: string;
  font_family?: string;
  font_display?: string;
}): CSSProperties {
  const vars: Record<string, string> = {};
  if (kit.primary_color)    vars['--dm-primary'] = kit.primary_color;
  if (kit.secondary_color)  vars['--dm-secondary'] = kit.secondary_color;
  if (kit.accent_color)     vars['--dm-accent'] = kit.accent_color;
  if (kit.neutral_color)    vars['--dm-neutral'] = kit.neutral_color;
  if (kit.background_color) vars['--dm-bg'] = kit.background_color;
  if (kit.font_family)      vars['--dm-font-primary'] = kit.font_family;
  if (kit.font_display || kit.font_family) vars['--dm-font-display'] = kit.font_display || kit.font_family!;
  // 다크 배경 = 중립 스케일 자동 반전 (뷰어와 동일 판정·동일 값)
  if (kit.background_color && getContrastRatio('#ffffff', kit.background_color) >= 4.5) {
    Object.assign(vars, {
      '--dm-neutral-0': '#1b2130', '--dm-neutral-50': '#161b28', '--dm-neutral-100': '#1e2433',
      '--dm-neutral-200': '#2c3347', '--dm-neutral-300': '#3a4257', '--dm-neutral-400': '#8b94a7',
      '--dm-neutral-500': '#9aa3b5', '--dm-neutral-600': '#b7bfce', '--dm-neutral-700': '#cdd4e0',
      '--dm-neutral-800': '#e4e8f0', '--dm-neutral-900': '#f2f5fa', '--dm-neutral-1000': '#ffffff',
      '--dm-primary-light': `color-mix(in srgb, ${kit.primary_color || DM_COLOR_TOKENS.brand.primary} 22%, #141926)`,
    });
  }
  return vars as CSSProperties;
}
