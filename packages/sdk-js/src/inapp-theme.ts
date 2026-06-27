/**
 * @hanjullo/sdk — In-app Message 테마 토큰 (D230+ 2026-06-27)
 *
 * 큐레이션 테마 = 토큰 세트. SDK 렌더(inapp-blocks)와 관리자 미리보기가 동일 토큰을 쓰도록
 * 단일 정의를 둔다. 테마가 "면(surface)"을 정하고 회사색은 "accent"만 — 단색 범람 제거.
 *
 * 레거시 호환: content_blocks 없는 메시지는 이 모듈을 거치지 않고 기존 background_color 단색 렌더.
 */

export type ThemeKey = 'auto' | 'light' | 'dark' | 'brand' | 'vibrant' | 'minimal';

export interface InAppTheme {
  key: ThemeKey;
  /** 카드 배경 */
  surface: string;
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
  /** 구분선/테두리 */
  border: string;
  /** 카드 모서리 반경(px) */
  radius: number;
  /** 카드 그림자 */
  shadow: string;
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

// ════════════════════════════════════════════════════════════════════
// 테마 해석
// ════════════════════════════════════════════════════════════════════

function baseTokens(dark: boolean): Omit<InAppTheme, 'key' | 'accent' | 'accentText'> {
  return dark
    ? {
        surface: '#14182b',
        surfaceElevated: '#1c2138',
        textPrimary: '#eef1f8',
        textSecondary: '#aab0c6',
        border: 'rgba(255,255,255,0.10)',
        radius: 22,
        shadow: '0 28px 70px rgba(0,0,0,0.5)',
        onMedia: '#ffffff',
      }
    : {
        surface: '#ffffff',
        surfaceElevated: '#f5f6fb',
        textPrimary: '#0f172a',
        textSecondary: '#64748b',
        border: 'rgba(15,23,42,0.08)',
        radius: 22,
        shadow: '0 28px 70px rgba(15,23,42,0.18)',
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
      surfaceElevated: isLightText ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.07)',
      textPrimary: onAccent,
      textSecondary: isLightText ? 'rgba(255,255,255,0.82)' : 'rgba(15,23,42,0.7)',
      // vibrant: 버튼은 흰(또는 진한) 면 + 글자는 회사색 → 강한 대비
      accent: onAccent,
      accentText: accent,
      border: isLightText ? 'rgba(255,255,255,0.24)' : 'rgba(15,23,42,0.14)',
      radius: 24,
      shadow: '0 28px 70px rgba(0,0,0,0.32)',
      onMedia: '#ffffff',
    };
  }

  if (key === 'minimal') {
    return {
      key,
      surface: '#ffffff',
      surfaceElevated: '#ffffff',
      textPrimary: '#111827',
      textSecondary: '#6b7280',
      accent,
      accentText: pickReadableText(accent),
      border: 'rgba(17,24,39,0.10)',
      radius: 18,
      shadow: '0 12px 32px rgba(17,24,39,0.10)',
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
  };
}
