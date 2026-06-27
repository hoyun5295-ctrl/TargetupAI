/**
 * 인앱 블록 테마 토큰 — 미리보기/편집기용 (D230+ 2026-06-27)
 *
 * ★ 단일 출처 = packages/sdk-js/src/inapp-theme.ts (값을 동일하게 유지).
 *   SDK는 자사몰 DOM 렌더, 여기는 관리자 React 미리보기 — 토큰 값은 1:1 일치시켜 parity 보장.
 */

export type ThemeKey = 'auto' | 'light' | 'dark' | 'brand' | 'vibrant' | 'minimal';

export interface InAppTheme {
  key: ThemeKey;
  surface: string;
  surfaceElevated: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentText: string;
  border: string;
  radius: number;
  shadow: string;
  onMedia: string;
}

export const DEFAULT_ACCENT = '#6d5cf0';

export function isHexColor(c: string | null | undefined): boolean {
  if (!c || typeof c !== 'string') return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c.trim());
}

function normalizeHex(c: string): string {
  let h = c.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return h.toLowerCase();
}

function hexToRgb(c: string): { r: number; g: number; b: number } | null {
  if (!isHexColor(c)) return null;
  const h = normalizeHex(c);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

function channelLuminance(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(c: string): number {
  const rgb = hexToRgb(c);
  if (!rgb) return 0.5;
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

export function pickReadableText(bg: string): string {
  return relativeLuminance(bg) > 0.55 ? '#0f172a' : '#ffffff';
}

export function withAlpha(c: string, alpha: number): string {
  const rgb = hexToRgb(c);
  if (!rgb) return c;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

function baseTokens(dark: boolean): Omit<InAppTheme, 'key' | 'accent' | 'accentText'> {
  return dark
    ? { surface: '#14182b', surfaceElevated: '#1c2138', textPrimary: '#eef1f8', textSecondary: '#aab0c6', border: 'rgba(255,255,255,0.10)', radius: 22, shadow: '0 28px 70px rgba(0,0,0,0.5)', onMedia: '#ffffff' }
    : { surface: '#ffffff', surfaceElevated: '#f5f6fb', textPrimary: '#0f172a', textSecondary: '#64748b', border: 'rgba(15,23,42,0.08)', radius: 22, shadow: '0 28px 70px rgba(15,23,42,0.18)', onMedia: '#ffffff' };
}

const VALID_KEYS: ThemeKey[] = ['auto', 'light', 'dark', 'brand', 'vibrant', 'minimal'];

export function resolveTheme(themeKey: string | null | undefined, accentColor?: string | null, prefersDark = false): InAppTheme {
  const accent = isHexColor(accentColor) ? normalizeHex(accentColor as string) : DEFAULT_ACCENT;
  const key: ThemeKey = (VALID_KEYS as string[]).includes(String(themeKey)) ? (themeKey as ThemeKey) : 'auto';

  if (key === 'vibrant') {
    const onAccent = pickReadableText(accent);
    const isLightText = onAccent === '#ffffff';
    return {
      key, surface: accent,
      surfaceElevated: isLightText ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.07)',
      textPrimary: onAccent,
      textSecondary: isLightText ? 'rgba(255,255,255,0.82)' : 'rgba(15,23,42,0.7)',
      accent: onAccent, accentText: accent,
      border: isLightText ? 'rgba(255,255,255,0.24)' : 'rgba(15,23,42,0.14)',
      radius: 24, shadow: '0 28px 70px rgba(0,0,0,0.32)', onMedia: '#ffffff',
    };
  }
  if (key === 'minimal') {
    return {
      key, surface: '#ffffff', surfaceElevated: '#ffffff', textPrimary: '#111827', textSecondary: '#6b7280',
      accent, accentText: pickReadableText(accent), border: 'rgba(17,24,39,0.10)', radius: 18,
      shadow: '0 12px 32px rgba(17,24,39,0.10)', onMedia: '#ffffff',
    };
  }
  const dark = key === 'dark' ? true : key === 'light' ? false : prefersDark;
  return { key, ...baseTokens(dark), accent, accentText: pickReadableText(accent) };
}

export const THEME_OPTIONS: { key: ThemeKey; label: string }[] = [
  { key: 'auto', label: '자동' },
  { key: 'light', label: '라이트' },
  { key: 'dark', label: '다크' },
  { key: 'brand', label: '브랜드' },
  { key: 'vibrant', label: '비비드' },
  { key: 'minimal', label: '미니멀' },
];
