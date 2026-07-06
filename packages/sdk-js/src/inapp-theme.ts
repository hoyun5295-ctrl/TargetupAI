/**
 * @hanjullo/sdk — In-app Message 테마 토큰 (D230+ 2026-06-27 · 2026-07-07 디자인 2.0)
 *
 * 큐레이션 테마 = 토큰 세트. SDK 렌더(inapp-blocks)와 관리자 미리보기가 동일 토큰을 쓰도록
 * 단일 정의를 둔다. 테마가 "면(surface)"을 정하고 회사색은 "accent"만 — 단색 범람 제거.
 *
 * 2026-07-07 디자인 2.0: 그라데이션 면(surfaceBg) + 3중 레이어 그림자 + 상단 하이라이트 링(ring)
 *   + accentSoft(워시) 토큰 추가. 기존 토큰 의미는 불변(하위 호환) — 추가만.
 *
 * 레거시 호환: content_blocks 없는 메시지는 이 모듈을 거치지 않고 기존 background_color 단색 렌더.
 */

export type ThemeKey = 'auto' | 'light' | 'dark' | 'brand' | 'vibrant' | 'minimal';

export interface InAppTheme {
  key: ThemeKey;
  /** 카드 배경 (단색 — 노치/펀치홀 등 "구멍" 색으로도 사용) */
  surface: string;
  /** 카드 배경 (그라데이션 — 실제 카드 면 렌더용. 단색 폴백 = surface) */
  surfaceBg: string;
  /** 블록 내부 면 (benefit/product 카드) */
  surfaceElevated: string;
  /** 본문 위 주 글자색 */
  textPrimary: string;
  /** 보조 글자색 */
  textSecondary: string;
  /** 강조색 (accent_color 우선, 없으면 테마 기본) */
  accent: string;
  /** accent 위 글자색 (대비 자동 보정) */
  accentText: string;
  /** accent 연한 워시 (칩/아이콘 배경) */
  accentSoft: string;
  /** 구분선/테두리 */
  border: string;
  /** 카드 모서리 반경(px) */
  radius: number;
  /** 카드 그림자 (3중 레이어 — 근접·중간·원거리) */
  shadow: string;
  /** 카드 상단 하이라이트 링 (inset — 유리 모서리 광) */
  ring: string;
  /** 미디어 오버레이 위 글자색 */
  onMedia: string;
}

export const DEFAULT_ACCENT = '#6d5cf0';

// ════════════════════════════════════════════════════════════════════
// 색 유틸 (순수 — DOM 의존 X)
// ════════════════════════════════════════════════════════════════════

/** #rgb / #rrggbb 만 hex로 인정 (gradient·rgb() 등은 대비 계산 불가 → false) */
export function isHexColor(c: string | null | undefined): boolean {
  if (!c || typeof c !== 'string') return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c.trim());
}

function normalizeHex(c: string): string {
  let h = c.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h.toLowerCase();
}

function hexToRgb(c: string): { r: number; g: number; b: number } | null {
  if (!isHexColor(c)) return null;
  const h = normalizeHex(c);
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function channelLuminance(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** 상대 휘도 (WCAG) — 0(검정)~1(흰색). hex가 아니면 0.5(중립)로 본다. */
export function relativeLuminance(c: string): number {
  const rgb = hexToRgb(c);
  if (!rgb) return 0.5;
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

/** 배경 위에서 읽히는 글자색 — 밝으면 진한 글자, 어두우면 흰 글자 */
export function pickReadableText(bg: string): string {
  return relativeLuminance(bg) > 0.55 ? '#0f172a' : '#ffffff';
}

/** hex에 알파를 입힌 rgba 문자열. hex 아니면 원본 그대로(이미 rgba/gradient일 수 있음) */
export function withAlpha(c: string, alpha: number): string {
  const rgb = hexToRgb(c);
  if (!rgb) return c;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

/**
 * hex 명도 이동 — percent<0 = 어둡게(검정 혼합), >0 = 밝게(흰색 혼합). hex 아니면 원본.
 * CTA 그라데이션(accent → 짙은 accent)·vibrant 면 생성용.
 */
export function shadeHex(c: string, percent: number): string {
  const rgb = hexToRgb(c);
  if (!rgb) return c;
  const p = Math.max(-100, Math.min(100, percent)) / 100;
  const target = p < 0 ? 0 : 255;
  const amt = Math.abs(p);
  const mix = (v: number) => Math.round(v + (target - v) * amt);
  const to2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to2(mix(rgb.r))}${to2(mix(rgb.g))}${to2(mix(rgb.b))}`;
}

// ════════════════════════════════════════════════════════════════════
// 테마 해석
// ════════════════════════════════════════════════════════════════════

function baseTokens(dark: boolean): Omit<InAppTheme, 'key' | 'accent' | 'accentText' | 'accentSoft'> {
  return dark
    ? {
        surface: '#161b30',
        surfaceBg: 'linear-gradient(180deg, #1b2140 0%, #12162a 100%)',
        surfaceElevated: 'rgba(255,255,255,0.055)',
        textPrimary: '#f2f4fb',
        textSecondary: '#a9b0c8',
        border: 'rgba(255,255,255,0.09)',
        radius: 24,
        shadow: '0 2px 8px rgba(0,0,0,0.35), 0 18px 46px rgba(0,0,0,0.42), 0 44px 110px rgba(0,0,0,0.5)',
        ring: 'inset 0 1px 0 rgba(255,255,255,0.08)',
        onMedia: '#ffffff',
      }
    : {
        surface: '#ffffff',
        surfaceBg: 'linear-gradient(180deg, #ffffff 0%, #fafbff 100%)',
        surfaceElevated: '#f4f5fb',
        textPrimary: '#0f172a',
        textSecondary: '#5b6474',
        border: 'rgba(15,23,42,0.07)',
        radius: 24,
        shadow: '0 2px 6px rgba(15,23,42,0.05), 0 14px 36px rgba(15,23,42,0.10), 0 40px 90px rgba(15,23,42,0.16)',
        ring: 'inset 0 1px 0 rgba(255,255,255,0.9)',
        onMedia: '#ffffff',
      };
}

const VALID_KEYS: ThemeKey[] = ['auto', 'light', 'dark', 'brand', 'vibrant', 'minimal'];

export interface ResolveThemeOptions {
  /** 자사몰 prefers-color-scheme: dark 여부 (auto/brand 면 선택). 미전달 시 false */
  prefersDark?: boolean;
}

/**
 * 테마 키 + 회사 accent → 토큰 세트.
 * - 면은 테마가, accent만 회사색.
 * - accent 위 글자(accentText), 면 위 글자(textPrimary)는 대비 자동 보정.
 * - accent_color가 hex가 아니면 기본 accent 사용(레거시 gradient 값이 들어와도 안전).
 */
export function resolveTheme(
  themeKey: string | null | undefined,
  accentColor?: string | null,
  opts?: ResolveThemeOptions,
): InAppTheme {
  const prefersDark = !!opts?.prefersDark;
  const accent = isHexColor(accentColor) ? normalizeHex(accentColor as string) : DEFAULT_ACCENT;

  let key: ThemeKey = (VALID_KEYS as string[]).includes(String(themeKey)) ? (themeKey as ThemeKey) : 'auto';

  if (key === 'vibrant') {
    const onAccent = pickReadableText(accent);
    const isLightText = onAccent === '#ffffff';
    return {
      key,
      surface: accent,
      surfaceBg: `linear-gradient(150deg, ${shadeHex(accent, 8)} 0%, ${accent} 45%, ${shadeHex(accent, -24)} 100%)`,
      surfaceElevated: isLightText ? 'rgba(255,255,255,0.15)' : 'rgba(15,23,42,0.08)',
      textPrimary: onAccent,
      textSecondary: isLightText ? 'rgba(255,255,255,0.84)' : 'rgba(15,23,42,0.72)',
      // vibrant: 버튼은 흰(또는 진한) 면 + 글자는 회사색 → 강한 대비
      accent: onAccent,
      accentText: accent,
      accentSoft: isLightText ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.10)',
      border: isLightText ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.14)',
      radius: 26,
      shadow: `0 2px 8px rgba(0,0,0,0.22), 0 22px 54px ${withAlpha(shadeHex(accent, -35), 0.55)}`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.22)',
      onMedia: '#ffffff',
    };
  }

  if (key === 'minimal') {
    return {
      key,
      surface: '#ffffff',
      surfaceBg: '#ffffff',
      surfaceElevated: '#f8f9fb',
      textPrimary: '#111827',
      textSecondary: '#6b7280',
      accent,
      accentText: pickReadableText(accent),
      accentSoft: withAlpha(accent, 0.1),
      border: 'rgba(17,24,39,0.09)',
      radius: 20,
      shadow: '0 1px 3px rgba(17,24,39,0.05), 0 16px 40px rgba(17,24,39,0.10)',
      ring: 'inset 0 0 0 1px rgba(17,24,39,0.03)',
      onMedia: '#ffffff',
    };
  }

  // auto / light / dark / brand
  const dark = key === 'dark' ? true : key === 'light' ? false : prefersDark; // auto·brand = prefers 따름
  const base = baseTokens(dark);
  return {
    key,
    ...base,
    accent,
    accentText: pickReadableText(accent),
    accentSoft: withAlpha(accent, dark ? 0.18 : 0.12),
  };
}
