/**
 * dm-tokens.ts (backend) — 모바일 DM 빌더 디자인 토큰 (뷰어 HTML 렌더용)
 *
 * ⚠️ SSOT(Single Source of Truth) — 값은 반드시 frontend와 동기화
 *    프론트 미러: packages/frontend/src/utils/dm-tokens.ts
 *    CSS 변수 매핑: packages/frontend/src/styles/dm-builder.css
 *    값 변경 시 세 파일 동시 수정 필수.
 *
 * 용도: dm-viewer.ts가 HTML 렌더 시 <style>:root{...}</style> 블록을 인라인 주입.
 *       외부 CDN 의존 없이 뷰어 HTML 자체에 토큰을 내장.
 *
 * 설계서: status/DM-PRO-DESIGN.md §8
 */

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
  scale: {
    hero:  { size: '32px', lineHeight: '1.2', weight: 800, letterSpacing: '-0.02em' },
    h1:    { size: '24px', lineHeight: '1.3', weight: 700, letterSpacing: '-0.01em' },
    h2:    { size: '20px', lineHeight: '1.4', weight: 700, letterSpacing: '0' },
    h3:    { size: '18px', lineHeight: '1.4', weight: 600, letterSpacing: '0' },
    body:  { size: '15px', lineHeight: '1.6', weight: 400, letterSpacing: '0' },
    small: { size: '13px', lineHeight: '1.5', weight: 400, letterSpacing: '0' },
    tiny:  { size: '11px', lineHeight: '1.4', weight: 400, letterSpacing: '0' },
  },
} as const;

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

export const DM_SHADOW = {
  sm: '0 1px 2px rgba(0,0,0,0.05)',
  md: '0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
  xl: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
} as const;

// ────────────── BrandKit 타입 ──────────────

export type DmBrandKit = {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  neutral_color?: string;
  background_color?: string;
  font_family?: string;
  tone?: 'premium' | 'friendly' | 'urgent' | 'elegant' | 'playful';
  contact?: { phone?: string; email?: string; website?: string };
  sns?: { instagram?: string; youtube?: string; kakao?: string; naver?: string };
};

// ────────────── CSS 변수 렌더러 (뷰어 HTML 삽입용) ──────────────

/**
 * 뷰어 HTML의 <head> 안 <style> 블록에 주입할 :root CSS 문자열 반환.
 * brandKit이 있으면 기본값을 override.
 */
export function renderDmTokensCss(brandKit?: DmBrandKit): string {
  const primary   = brandKit?.primary_color    || DM_COLOR_TOKENS.brand.primary;
  const secondary = brandKit?.secondary_color  || DM_COLOR_TOKENS.neutral[700];
  const accent    = brandKit?.accent_color     || DM_COLOR_TOKENS.brand.accent;
  const neutral   = brandKit?.neutral_color    || DM_COLOR_TOKENS.neutral[700];
  const bg        = brandKit?.background_color || DM_COLOR_TOKENS.neutral[0];
  const fontPri   = brandKit?.font_family      || DM_TYPOGRAPHY.fontFamily.primary;

  return `
:root {
  --dm-neutral-0: ${DM_COLOR_TOKENS.neutral[0]};
  --dm-neutral-50: ${DM_COLOR_TOKENS.neutral[50]};
  --dm-neutral-100: ${DM_COLOR_TOKENS.neutral[100]};
  --dm-neutral-200: ${DM_COLOR_TOKENS.neutral[200]};
  --dm-neutral-300: ${DM_COLOR_TOKENS.neutral[300]};
  --dm-neutral-400: ${DM_COLOR_TOKENS.neutral[400]};
  --dm-neutral-500: ${DM_COLOR_TOKENS.neutral[500]};
  --dm-neutral-600: ${DM_COLOR_TOKENS.neutral[600]};
  --dm-neutral-700: ${DM_COLOR_TOKENS.neutral[700]};
  --dm-neutral-800: ${DM_COLOR_TOKENS.neutral[800]};
  --dm-neutral-900: ${DM_COLOR_TOKENS.neutral[900]};
  --dm-neutral-1000: ${DM_COLOR_TOKENS.neutral[1000]};

  --dm-primary: ${primary};
  --dm-primary-hover: ${DM_COLOR_TOKENS.brand.primaryHover};
  --dm-primary-light: ${DM_COLOR_TOKENS.brand.primaryLight};
  --dm-secondary: ${secondary};
  --dm-accent: ${accent};
  --dm-neutral: ${neutral};
  --dm-bg: ${bg};

  --dm-success: ${DM_COLOR_TOKENS.semantic.success};
  --dm-warning: ${DM_COLOR_TOKENS.semantic.warning};
  --dm-error: ${DM_COLOR_TOKENS.semantic.error};
  --dm-info: ${DM_COLOR_TOKENS.semantic.info};

  --dm-font-primary: ${fontPri};
  --dm-font-serif: ${DM_TYPOGRAPHY.fontFamily.serif};
  --dm-font-mono: ${DM_TYPOGRAPHY.fontFamily.mono};

  --dm-fs-hero: ${DM_TYPOGRAPHY.scale.hero.size};
  --dm-fs-h1: ${DM_TYPOGRAPHY.scale.h1.size};
  --dm-fs-h2: ${DM_TYPOGRAPHY.scale.h2.size};
  --dm-fs-h3: ${DM_TYPOGRAPHY.scale.h3.size};
  --dm-fs-body: ${DM_TYPOGRAPHY.scale.body.size};
  --dm-fs-small: ${DM_TYPOGRAPHY.scale.small.size};
  --dm-fs-tiny: ${DM_TYPOGRAPHY.scale.tiny.size};

  --dm-lh-hero: ${DM_TYPOGRAPHY.scale.hero.lineHeight};
  --dm-lh-h1: ${DM_TYPOGRAPHY.scale.h1.lineHeight};
  --dm-lh-h2: ${DM_TYPOGRAPHY.scale.h2.lineHeight};
  --dm-lh-h3: ${DM_TYPOGRAPHY.scale.h3.lineHeight};
  --dm-lh-body: ${DM_TYPOGRAPHY.scale.body.lineHeight};
  --dm-lh-small: ${DM_TYPOGRAPHY.scale.small.lineHeight};
  --dm-lh-tiny: ${DM_TYPOGRAPHY.scale.tiny.lineHeight};

  --dm-sp-0: 0; --dm-sp-1: 4px; --dm-sp-2: 8px; --dm-sp-3: 12px;
  --dm-sp-4: 16px; --dm-sp-5: 20px; --dm-sp-6: 24px; --dm-sp-8: 32px;
  --dm-sp-10: 40px; --dm-sp-12: 48px; --dm-sp-16: 64px; --dm-sp-20: 80px;

  --dm-radius-none: 0; --dm-radius-sm: 4px; --dm-radius-md: 8px;
  --dm-radius-lg: 12px; --dm-radius-xl: 16px; --dm-radius-2xl: 24px;
  --dm-radius-full: 9999px;

  --dm-shadow-sm: ${DM_SHADOW.sm};
  --dm-shadow-md: ${DM_SHADOW.md};
  --dm-shadow-lg: ${DM_SHADOW.lg};
  --dm-shadow-xl: ${DM_SHADOW.xl};
}
`.trim();
}

/**
 * 뷰어 HTML의 <head> 안에 삽입할 기본 리셋/공통 CSS.
 * 토큰 변수 :root 블록은 renderDmTokensCss()로 별도 주입.
 */
export function renderDmBaseCss(): string {
  return `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  font-family: var(--dm-font-primary);
  font-size: var(--dm-fs-body);
  line-height: var(--dm-lh-body);
  color: var(--dm-neutral-900);
  background: var(--dm-neutral-100);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a { color: inherit; text-decoration: none; }
img { max-width: 100%; display: block; }
button { font-family: inherit; cursor: pointer; border: 0; background: transparent; }

.dm-viewer {
  max-width: var(--dm-mobile-max, 430px);
  min-height: 100vh;
  margin: 0 auto;
  background: var(--dm-bg);
}

.dm-section {
  position: relative;
}

.dm-cta {
  display: inline-block;
  padding: 12px 24px;
  min-height: 44px;
  min-width: 44px;
  border-radius: var(--dm-radius-lg);
  font-size: var(--dm-fs-body);
  font-weight: 700;
  text-align: center;
  background: var(--dm-primary);
  color: #fff;
  transition: background 150ms ease-out, transform 100ms ease-out;
}
.dm-cta:hover { background: var(--dm-primary-hover); }
.dm-cta:active { transform: scale(0.98); }
.dm-cta-secondary { background: var(--dm-neutral-100); color: var(--dm-neutral-900); }
.dm-cta-outline { background: transparent; border: 2px solid var(--dm-primary); color: var(--dm-primary); }

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0ms !important; transition-duration: 0ms !important; }
}

@media (max-width: 375px) {
  :root { --dm-fs-hero: 28px; --dm-fs-h1: 22px; }
}
@media (max-width: 320px) {
  :root { --dm-fs-hero: 24px; --dm-fs-h1: 20px; }
}
`.trim();
}

// ────────────── WCAG 대비 계산 (검수 엔진용) ──────────────

/**
 * 두 색의 WCAG 대비비 계산. AA 기준 4.5:1 이상.
 */
export function getContrastRatio(fgHex: string, bgHex: string): number {
  const lum = (hex: string): number => {
    const h = hex.replace('#', '');
    if (h.length !== 6) return 0;
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

/** brandKit의 primary_color가 흰 배경에서 WCAG AA 통과하는지 확인 */
export function isBrandKitPrimaryAccessible(brandKit?: DmBrandKit): boolean {
  const primary = brandKit?.primary_color || DM_COLOR_TOKENS.brand.primary;
  return getContrastRatio(primary, '#ffffff') >= 4.5;
}
