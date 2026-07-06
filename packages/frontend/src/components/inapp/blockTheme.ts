/**
 * 인앱 블록 테마 토큰 — 미리보기/편집기용 (D230+ 2026-06-27 · 2026-07-07 디자인 2.0)
 *
 * ★ 단일 출처 = packages/sdk-js/src/inapp-theme.ts (값을 동일하게 유지).
 *   SDK는 자사몰 DOM 렌더, 여기는 관리자 React 미리보기 — 토큰 값은 1:1 일치시켜 parity 보장.
 */

export type ThemeKey = 'auto' | 'light' | 'dark' | 'brand' | 'vibrant' | 'minimal';

export interface InAppTheme {
  key: ThemeKey;
  surface: string;
  surfaceBg: string;
  surfaceElevated: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  border: string;
  radius: number;
  shadow: string;
  ring: string;
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

/** hex 명도 이동 — percent<0 = 어둡게, >0 = 밝게. hex 아니면 원본. (SDK shadeHex 미러) */
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

function baseTokens(dark: boolean): Omit<InAppTheme, 'key' | 'accent' | 'accentText' | 'accentSoft'> {
  return dark
    ? {
        surface: '#161b30',
        surfaceBg: 'linear-gradient(180deg, #1b2140 0%, #12162a 100%)',
        surfaceElevated: 'rgba(255,255,255,0.055)',
        textPrimary: '#f2f4fb', textSecondary: '#a9b0c8',
        border: 'rgba(255,255,255,0.09)', radius: 24,
        shadow: '0 2px 8px rgba(0,0,0,0.35), 0 18px 46px rgba(0,0,0,0.42), 0 44px 110px rgba(0,0,0,0.5)',
        ring: 'inset 0 1px 0 rgba(255,255,255,0.08)', onMedia: '#ffffff',
      }
    : {
        surface: '#ffffff',
        surfaceBg: 'linear-gradient(180deg, #ffffff 0%, #fafbff 100%)',
        surfaceElevated: '#f4f5fb',
        textPrimary: '#0f172a', textSecondary: '#5b6474',
        border: 'rgba(15,23,42,0.07)', radius: 24,
        shadow: '0 2px 6px rgba(15,23,42,0.05), 0 14px 36px rgba(15,23,42,0.10), 0 40px 90px rgba(15,23,42,0.16)',
        ring: 'inset 0 1px 0 rgba(255,255,255,0.9)', onMedia: '#ffffff',
      };
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
      surfaceBg: `linear-gradient(150deg, ${shadeHex(accent, 8)} 0%, ${accent} 45%, ${shadeHex(accent, -24)} 100%)`,
      surfaceElevated: isLightText ? 'rgba(255,255,255,0.15)' : 'rgba(15,23,42,0.08)',
      textPrimary: onAccent,
      textSecondary: isLightText ? 'rgba(255,255,255,0.84)' : 'rgba(15,23,42,0.72)',
      accent: onAccent, accentText: accent,
      accentSoft: isLightText ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.10)',
      border: isLightText ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.14)',
      radius: 26,
      shadow: `0 2px 8px rgba(0,0,0,0.22), 0 22px 54px ${withAlpha(shadeHex(accent, -35), 0.55)}`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.22)', onMedia: '#ffffff',
    };
  }
  if (key === 'minimal') {
    return {
      key, surface: '#ffffff', surfaceBg: '#ffffff', surfaceElevated: '#f8f9fb',
      textPrimary: '#111827', textSecondary: '#6b7280',
      accent, accentText: pickReadableText(accent), accentSoft: withAlpha(accent, 0.1),
      border: 'rgba(17,24,39,0.09)', radius: 20,
      shadow: '0 1px 3px rgba(17,24,39,0.05), 0 16px 40px rgba(17,24,39,0.10)',
      ring: 'inset 0 0 0 1px rgba(17,24,39,0.03)', onMedia: '#ffffff',
    };
  }
  const dark = key === 'dark' ? true : key === 'light' ? false : prefersDark;
  return {
    key, ...baseTokens(dark), accent, accentText: pickReadableText(accent),
    accentSoft: withAlpha(accent, dark ? 0.18 : 0.12),
  };
}

export const THEME_OPTIONS: { key: ThemeKey; label: string }[] = [
  { key: 'auto', label: '자동' },
  { key: 'light', label: '라이트' },
  { key: 'dark', label: '다크' },
  { key: 'brand', label: '브랜드' },
  { key: 'vibrant', label: '비비드' },
  { key: 'minimal', label: '미니멀' },
];
