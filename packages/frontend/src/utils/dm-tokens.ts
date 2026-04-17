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

/** 브랜드킷 값을 받아 CSS 변수 스타일 객체로 변환 (에디터/캔버스 inline style용) */
export function brandKitToCssVars(kit: {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  neutral_color?: string;
  background_color?: string;
}): CSSProperties {
  const vars: Record<string, string> = {};
  if (kit.primary_color)    vars['--dm-primary'] = kit.primary_color;
  if (kit.secondary_color)  vars['--dm-secondary'] = kit.secondary_color;
  if (kit.accent_color)     vars['--dm-accent'] = kit.accent_color;
  if (kit.neutral_color)    vars['--dm-neutral'] = kit.neutral_color;
  if (kit.background_color) vars['--dm-bg'] = kit.background_color;
  return vars as CSSProperties;
}
