/**
 * 인앱 블록 테마 토큰 — 미리보기/편집기용 (D230+ 2026-06-27 · 2026-07-07 디자인 2.0 · 2026-07-07(2) 디자인 언어 2.1)
 *
 * ★ 단일 출처 = packages/sdk-js/src/inapp-theme.ts (값을 동일하게 유지).
 *   SDK는 자사몰 DOM 렌더, 여기는 관리자 React 미리보기 — 토큰 값은 1:1 일치시켜 parity 보장.
 *
 * 2026-07-07(2) 디자인 언어 2.1: 테마 6종이 "색깔만 다른 같은 카드"가 되지 않도록
 *   구조·타이포·장식 축 토큰 11종 추가 (SDK 미러 — 값 동일).
 *   - auto   = 자사몰 라이트/다크 모드를 따라감
 *   - light  = 소프트 글래스 / dark = 미드나잇 글래스(accent 글로우)
 *   - brand  = 브랜드 쇼케이스(상단 브랜드 밴드 + accent 워시 + 솔리드 칩 + 헤드라인 accent 바)
 *   - vibrant= 임팩트 포스터(회사색 면 + 샤인 + 알약 반전 버튼)
 *   - minimal= 모노 에디토리얼(플랫 + 헤어라인 + 민무늬 라벨 + 잉크 버튼)
 */

export type ThemeKey =
  | 'auto' | 'light' | 'dark' | 'brand' | 'vibrant' | 'minimal'
  // ★ 2026-07-14 디자인 3.0 — 시그니처 테마 7종 (SDK inapp-theme.ts 미러 — 값 1:1 동기 의무)
  | 'editorial' | 'luxury-dark' | 'bold-sale' | 'soft-pastel' | 'paper' | 'city-night' | 'festive';

export type EyebrowVariant = 'chip' | 'chip_solid' | 'plain';
export type BulletVariant = 'badge' | 'mono';
export type DividerVariant = 'fade' | 'solid';
export type DensityKey = 'airy' | 'compact';
export type MotifKey = 'rule' | 'dot' | 'bracket';

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
  // ── 2026-07-07(2) 디자인 언어 축 (SDK inapp-theme.ts 미러) ──
  eyebrowVariant: EyebrowVariant;
  headlineWeight: number;
  headlineAccentBar: boolean;
  bulletVariant: BulletVariant;
  dividerVariant: DividerVariant;
  buttonRadius: number;
  buttonPrimaryBg: string;
  buttonPrimaryText: string;
  buttonPrimaryShadow: string;
  buttonGhostColor: string;
  innerRadius: number;
  // ── ★ 2026-07-14 디자인 3.0 아트디렉션 축 (SDK inapp-theme.ts 미러 — 기존 6테마 미설정 = 현행 렌더 불변) ──
  displayFont?: string;
  headlineScale?: number;
  density?: DensityKey;
  motif?: MotifKey;
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

type ThemeSurfaceTokens = Pick<
  InAppTheme,
  'surface' | 'surfaceBg' | 'surfaceElevated' | 'textPrimary' | 'textSecondary' | 'border' | 'radius' | 'shadow' | 'ring' | 'onMedia'
>;

function baseTokens(dark: boolean): ThemeSurfaceTokens {
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

// ★ 2026-07-14 디자인 3.0 — 시그니처 테마 키 + 기본 강조색 (SDK 미러. 회사 accent_color가 항상 우선)
export const SIGNATURE_THEME_KEYS: ThemeKey[] = ['editorial', 'luxury-dark', 'bold-sale', 'soft-pastel', 'paper', 'city-night', 'festive'];
const SIGNATURE_DEFAULT_ACCENT: Partial<Record<ThemeKey, string>> = {
  'editorial': '#b45309',
  'luxury-dark': '#d4af37',
  'bold-sale': '#ef4444',
  'soft-pastel': '#ec4899',
  'paper': '#9a5b33',
  'city-night': '#22d3ee',
  'festive': '#e11d48',
};

const VALID_KEYS: ThemeKey[] = ['auto', 'light', 'dark', 'brand', 'vibrant', 'minimal', ...SIGNATURE_THEME_KEYS];

// ★ 2026-07-14 디자인 3.0 — 서체 카탈로그 (SDK INAPP_FONT_CATALOG 미러 — DM_FONT_CATALOG 6종 계열)
export const INAPP_FONT_CATALOG: ReadonlyArray<{ id: string; label: string; css: string; google: string | null }> = [
  { id: 'pretendard',     label: '프리텐다드 (기본)',        css: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif', google: null },
  { id: 'noto-serif',     label: '노토 세리프 (명조)',       css: '"Noto Serif KR", serif',       google: 'Noto+Serif+KR:wght@400;600;700;900' },
  { id: 'nanum-myeongjo', label: '나눔명조',                 css: '"Nanum Myeongjo", serif',      google: 'Nanum+Myeongjo:wght@400;700;800' },
  { id: 'gowun-batang',   label: '고운바탕 (부드러운 명조)', css: '"Gowun Batang", serif',        google: 'Gowun+Batang:wght@400;700' },
  { id: 'gowun-dodum',    label: '고운돋움',                 css: '"Gowun Dodum", sans-serif',    google: 'Gowun+Dodum' },
  { id: 'black-han',      label: '검은고딕 (임팩트)',        css: '"Black Han Sans", sans-serif', google: 'Black+Han+Sans' },
  // ── 2026-07-16 무료 글꼴 확장 (6→12) — design-core/fonts.ts CORE_FONTS 미러 ──
  { id: 'noto-sans-kr',     label: '노토 산스 (고딕)',   css: '"Noto Sans KR", sans-serif',     google: 'Noto+Sans+KR:wght@400;500;700;900' },
  { id: 'ibm-plex-sans-kr', label: 'IBM 플렉스 산스',    css: '"IBM Plex Sans KR", sans-serif', google: 'IBM+Plex+Sans+KR:wght@400;500;700' },
  { id: 'gothic-a1',        label: '고딕 A1',            css: '"Gothic A1", sans-serif',        google: 'Gothic+A1:wght@400;700;900' },
  { id: 'nanum-gothic',     label: '나눔고딕',           css: '"Nanum Gothic", sans-serif',     google: 'Nanum+Gothic:wght@400;700;800' },
  { id: 'jua',              label: '주아 (둥근 제목)',   css: '"Jua", sans-serif',              google: 'Jua' },
  { id: 'do-hyeon',         label: '도현 (각진 제목)',   css: '"Do Hyeon", sans-serif',         google: 'Do+Hyeon' },
];

/** 서체 문자열 무해화 (SDK safeFontFamily 미러) */
export function safeFontFamily(v: string | undefined | null, fallback: string): string {
  if (!v || typeof v !== 'string') return fallback;
  const cleaned = v.replace(/[^\w\s,"'\-]/g, '').trim();
  return cleaned || fallback;
}

/** font-family → Google Fonts css2 URL (카탈로그 매칭 화이트리스트 — SDK inappGoogleFontsUrl 미러) */
export function inappGoogleFontsUrl(...families: Array<string | undefined | null>): string | null {
  const params: string[] = [];
  for (const f of families) {
    if (!f) continue;
    for (const c of INAPP_FONT_CATALOG) {
      if (!c.google) continue;
      const first = c.css.split(',')[0].replace(/"/g, '').trim();
      if (f.includes(first) && !params.includes(c.google)) params.push(c.google);
    }
  }
  if (params.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${params.map((p) => `family=${p}`).join('&')}&display=swap`;
}

// ★ 2026-07-14 디자인 3.0 — 구도(treatment) 허용표 + 해석 (SDK inapp-blocks INAPP_TREATMENTS 미러 — fail-closed)
export type InAppTreatment = 'classic' | 'framed' | 'typographic' | 'spotlight';

export const INAPP_TREATMENTS: Record<string, InAppTreatment[]> = {
  'center_modal|classic': ['classic', 'framed', 'typographic', 'spotlight'],
  'inline_card|classic': ['classic', 'framed', 'typographic', 'spotlight'],
  'full_screen|classic': ['classic', 'framed', 'typographic'],
  'slide_in|classic': ['classic', 'typographic', 'spotlight'],
};

export function resolveInAppTreatment(template: string, cardStyle: string, requested: any): InAppTreatment {
  const allowed = INAPP_TREATMENTS[`${template}|${cardStyle}`];
  const req = String(requested || '');
  return allowed && (allowed as string[]).includes(req) ? (req as InAppTreatment) : 'classic';
}

export const INAPP_TREATMENT_OPTIONS: { key: InAppTreatment; label: string; hint: string }[] = [
  { key: 'classic', label: '기본 조판', hint: '현행 정돈 배치' },
  { key: 'framed', label: '액자', hint: '헤어라인 내부 프레임' },
  { key: 'typographic', label: '타이포 강조', hint: '헤드라인 대형 스케일' },
  { key: 'spotlight', label: '혜택 스포트라이트', hint: '혜택 대형 승격' },
];

/**
 * SDK resolveTheme 미러 — brand는 prefersDark와 무관하게 화이트 쇼케이스 고정.
 */
export function resolveTheme(themeKey: string | null | undefined, accentColor?: string | null, prefersDark = false): InAppTheme {
  const key: ThemeKey = (VALID_KEYS as string[]).includes(String(themeKey)) ? (themeKey as ThemeKey) : 'auto';
  // 회사 accent_color 우선 — 미설정 시 시그니처 테마는 자기 기본색 (SDK 미러)
  const accent = isHexColor(accentColor)
    ? normalizeHex(accentColor as string)
    : (SIGNATURE_DEFAULT_ACCENT[key] || DEFAULT_ACCENT);
  const onAccent = pickReadableText(accent);

  const glassButton = {
    buttonRadius: 14,
    buttonPrimaryBg: `linear-gradient(180deg, ${shadeHex(accent, 6)} 0%, ${shadeHex(accent, -12)} 100%)`,
    buttonPrimaryText: onAccent,
    buttonPrimaryShadow: `0 1px 2px ${withAlpha(shadeHex(accent, -40), 0.3)}, 0 8px 22px ${withAlpha(accent, 0.38)}, inset 0 1px 0 rgba(255,255,255,0.18)`,
    buttonGhostColor: accent,
  };

  if (key === 'vibrant') {
    const isLightText = onAccent === '#ffffff';
    return {
      key, surface: accent,
      surfaceBg: `radial-gradient(130% 85% at 85% -12%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 52%), linear-gradient(150deg, ${shadeHex(accent, 8)} 0%, ${accent} 45%, ${shadeHex(accent, -24)} 100%)`,
      surfaceElevated: isLightText ? 'rgba(255,255,255,0.15)' : 'rgba(15,23,42,0.08)',
      textPrimary: onAccent,
      textSecondary: isLightText ? 'rgba(255,255,255,0.84)' : 'rgba(15,23,42,0.72)',
      accent: onAccent, accentText: accent,
      accentSoft: isLightText ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.10)',
      border: isLightText ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.14)',
      radius: 26,
      shadow: `0 2px 8px rgba(0,0,0,0.22), 0 22px 54px ${withAlpha(shadeHex(accent, -35), 0.55)}`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.22)', onMedia: '#ffffff',
      eyebrowVariant: 'chip', headlineWeight: 800, headlineAccentBar: false,
      bulletVariant: 'badge', dividerVariant: 'fade',
      buttonRadius: 999,
      buttonPrimaryBg: isLightText ? '#ffffff' : '#0f172a',
      buttonPrimaryText: accent,
      buttonPrimaryShadow: '0 2px 6px rgba(0,0,0,0.2), 0 12px 30px rgba(0,0,0,0.25)',
      buttonGhostColor: onAccent,
      innerRadius: 16,
    };
  }
  if (key === 'minimal') {
    return {
      key, surface: '#ffffff', surfaceBg: '#ffffff', surfaceElevated: '#f7f7f8',
      textPrimary: '#111827', textSecondary: '#6b7280',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.08),
      border: 'rgba(17,24,39,0.12)', radius: 12,
      shadow: '0 1px 2px rgba(17,24,39,0.04), 0 14px 34px rgba(17,24,39,0.08)',
      ring: '', onMedia: '#ffffff',
      eyebrowVariant: 'plain', headlineWeight: 700, headlineAccentBar: false,
      bulletVariant: 'mono', dividerVariant: 'solid',
      buttonRadius: 9,
      buttonPrimaryBg: '#111827', buttonPrimaryText: '#ffffff',
      buttonPrimaryShadow: '0 6px 18px rgba(17,24,39,0.22)',
      buttonGhostColor: '#111827',
      innerRadius: 10,
    };
  }
  if (key === 'brand') {
    return {
      key, surface: '#ffffff',
      surfaceBg: `linear-gradient(90deg, ${accent} 0%, ${shadeHex(accent, 28)} 100%) left top / 100% 6px no-repeat, linear-gradient(180deg, ${withAlpha(accent, 0.07)} 0%, rgba(255,255,255,0) 32%) left top / 100% 100% no-repeat, linear-gradient(180deg, #ffffff 0%, #ffffff 100%)`,
      surfaceElevated: withAlpha(accent, 0.06),
      textPrimary: '#101828', textSecondary: '#4f5869',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.1),
      border: withAlpha(accent, 0.16), radius: 20,
      shadow: `0 2px 6px rgba(15,23,42,0.05), 0 16px 40px ${withAlpha(shadeHex(accent, -20), 0.16)}, 0 40px 90px rgba(15,23,42,0.12)`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.9)', onMedia: '#ffffff',
      eyebrowVariant: 'chip_solid', headlineWeight: 800, headlineAccentBar: true,
      bulletVariant: 'badge', dividerVariant: 'solid',
      buttonRadius: 12,
      buttonPrimaryBg: accent, buttonPrimaryText: onAccent,
      buttonPrimaryShadow: `0 2px 5px ${withAlpha(shadeHex(accent, -35), 0.25)}, 0 10px 26px ${withAlpha(accent, 0.35)}`,
      buttonGhostColor: accent,
      innerRadius: 12,
    };
  }

  // ★ 2026-07-14 디자인 3.0 — 시그니처 테마 7종 (SDK inapp-theme.ts 미러 — 값 1:1)
  if (key === 'editorial') {
    return {
      key, surface: '#ffffff',
      surfaceBg: 'linear-gradient(180deg, #ffffff 0%, #fbfaf8 100%)', surfaceElevated: '#f6f4f0',
      textPrimary: '#1c1917', textSecondary: '#57534e',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.09),
      border: 'rgba(28,25,23,0.14)', radius: 16,
      shadow: '0 1px 2px rgba(28,25,23,0.05), 0 16px 40px rgba(28,25,23,0.10)',
      ring: '', onMedia: '#ffffff',
      eyebrowVariant: 'plain', headlineWeight: 700, headlineAccentBar: false,
      bulletVariant: 'mono', dividerVariant: 'solid',
      buttonRadius: 6, buttonPrimaryBg: '#1c1917', buttonPrimaryText: '#ffffff',
      buttonPrimaryShadow: '0 6px 18px rgba(28,25,23,0.22)', buttonGhostColor: '#1c1917', innerRadius: 8,
      displayFont: '"Noto Serif KR", serif', headlineScale: 1.12, density: 'airy', motif: 'rule',
    };
  }
  if (key === 'luxury-dark') {
    return {
      key, surface: '#0e1018',
      surfaceBg: `radial-gradient(120% 70% at 20% -10%, ${withAlpha(accent, 0.14)} 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, #12141d 0%, #0b0d14 100%)`,
      surfaceElevated: 'rgba(255,255,255,0.05)',
      textPrimary: '#f4efe4', textSecondary: '#b6ae9c',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.14),
      border: withAlpha(accent, 0.22), radius: 18,
      shadow: `0 2px 8px rgba(0,0,0,0.4), 0 22px 60px rgba(0,0,0,0.55), 0 0 70px ${withAlpha(accent, 0.12)}`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.06)', onMedia: '#ffffff',
      eyebrowVariant: 'plain', headlineWeight: 700, headlineAccentBar: false,
      bulletVariant: 'mono', dividerVariant: 'solid',
      buttonRadius: 6,
      buttonPrimaryBg: `linear-gradient(180deg, ${shadeHex(accent, 8)} 0%, ${shadeHex(accent, -14)} 100%)`,
      buttonPrimaryText: onAccent,
      buttonPrimaryShadow: `0 2px 6px rgba(0,0,0,0.35), 0 10px 28px ${withAlpha(accent, 0.35)}`,
      buttonGhostColor: accent, innerRadius: 10,
      displayFont: '"Noto Serif KR", serif', headlineScale: 1.1, density: 'airy', motif: 'rule',
    };
  }
  if (key === 'bold-sale') {
    return {
      key, surface: '#ffffff', surfaceBg: '#ffffff', surfaceElevated: '#f7f7f8',
      textPrimary: '#18181b', textSecondary: '#52525b',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.1),
      border: 'rgba(24,24,27,0.14)', radius: 14,
      shadow: '0 2px 6px rgba(24,24,27,0.08), 0 18px 44px rgba(24,24,27,0.16)',
      ring: '', onMedia: '#ffffff',
      eyebrowVariant: 'chip_solid', headlineWeight: 900, headlineAccentBar: false,
      bulletVariant: 'badge', dividerVariant: 'solid',
      buttonRadius: 10, buttonPrimaryBg: '#18181b', buttonPrimaryText: '#ffffff',
      buttonPrimaryShadow: '0 8px 22px rgba(24,24,27,0.3)', buttonGhostColor: '#18181b', innerRadius: 10,
      displayFont: '"Black Han Sans", sans-serif', headlineScale: 1.22, density: 'compact', motif: 'rule',
    };
  }
  if (key === 'soft-pastel') {
    return {
      key, surface: '#fffafc',
      surfaceBg: `linear-gradient(180deg, #ffffff 0%, ${withAlpha(accent, 0.07)} 100%)`,
      surfaceElevated: withAlpha(accent, 0.07),
      textPrimary: '#3f3f46', textSecondary: '#71717a',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.12),
      border: withAlpha(accent, 0.18), radius: 26,
      shadow: `0 2px 6px rgba(63,63,70,0.05), 0 16px 40px ${withAlpha(accent, 0.18)}`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.9)', onMedia: '#ffffff',
      eyebrowVariant: 'chip', headlineWeight: 700, headlineAccentBar: false,
      bulletVariant: 'badge', dividerVariant: 'fade',
      buttonRadius: 999,
      buttonPrimaryBg: `linear-gradient(180deg, ${shadeHex(accent, 8)} 0%, ${shadeHex(accent, -10)} 100%)`,
      buttonPrimaryText: onAccent,
      buttonPrimaryShadow: `0 2px 5px ${withAlpha(shadeHex(accent, -30), 0.2)}, 0 10px 26px ${withAlpha(accent, 0.35)}`,
      buttonGhostColor: accent, innerRadius: 18,
      headlineScale: 1, density: 'airy', motif: 'dot',
    };
  }
  if (key === 'paper') {
    return {
      key, surface: '#faf6ef',
      surfaceBg: 'linear-gradient(180deg, #fbf8f2 0%, #f7f1e6 100%)', surfaceElevated: '#f1eadd',
      textPrimary: '#43302b', textSecondary: '#7d6f60',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.1),
      border: 'rgba(67,48,43,0.14)', radius: 16,
      shadow: '0 1px 2px rgba(67,48,43,0.05), 0 14px 36px rgba(67,48,43,0.12)',
      ring: '', onMedia: '#ffffff',
      eyebrowVariant: 'plain', headlineWeight: 700, headlineAccentBar: false,
      bulletVariant: 'mono', dividerVariant: 'solid',
      buttonRadius: 10,
      buttonPrimaryBg: `linear-gradient(180deg, ${shadeHex(accent, 6)} 0%, ${shadeHex(accent, -12)} 100%)`,
      buttonPrimaryText: onAccent,
      buttonPrimaryShadow: `0 2px 5px ${withAlpha(shadeHex(accent, -30), 0.22)}, 0 10px 24px ${withAlpha(accent, 0.3)}`,
      buttonGhostColor: accent, innerRadius: 10,
      displayFont: '"Gowun Batang", serif', headlineScale: 1.08, density: 'airy', motif: 'dot',
    };
  }
  if (key === 'city-night') {
    return {
      key, surface: '#0b1220',
      surfaceBg: `radial-gradient(130% 75% at 82% -10%, ${withAlpha(accent, 0.18)} 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, #0e1728 0%, #090f1b 100%)`,
      surfaceElevated: 'rgba(255,255,255,0.055)',
      textPrimary: '#e8f2fb', textSecondary: '#93a6bd',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.16),
      border: 'rgba(255,255,255,0.1)', radius: 20,
      shadow: `0 2px 8px rgba(0,0,0,0.4), 0 20px 52px rgba(0,0,0,0.5), 0 0 80px ${withAlpha(accent, 0.14)}`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.07)', onMedia: '#ffffff',
      eyebrowVariant: 'chip', headlineWeight: 800, headlineAccentBar: false,
      bulletVariant: 'badge', dividerVariant: 'fade',
      innerRadius: 14,
      headlineScale: 1.05, motif: 'rule',
      ...glassButton,
    };
  }
  if (key === 'festive') {
    return {
      key, surface: '#ffffff',
      surfaceBg: `linear-gradient(135deg, ${withAlpha(accent, 0.1)} 0%, rgba(255,255,255,0) 40%), linear-gradient(180deg, #ffffff 0%, #fffdfa 100%)`,
      surfaceElevated: withAlpha(accent, 0.06),
      textPrimary: '#1f2937', textSecondary: '#6b7280',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.11),
      border: withAlpha(accent, 0.2), radius: 22,
      shadow: `0 2px 6px rgba(31,41,55,0.06), 0 18px 44px ${withAlpha(accent, 0.22)}`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.9)', onMedia: '#ffffff',
      eyebrowVariant: 'chip_solid', headlineWeight: 800, headlineAccentBar: false,
      bulletVariant: 'badge', dividerVariant: 'fade',
      buttonRadius: 999,
      buttonPrimaryBg: `linear-gradient(180deg, ${shadeHex(accent, 8)} 0%, ${shadeHex(accent, -12)} 100%)`,
      buttonPrimaryText: onAccent,
      buttonPrimaryShadow: `0 2px 5px ${withAlpha(shadeHex(accent, -30), 0.25)}, 0 10px 26px ${withAlpha(accent, 0.38)}`,
      buttonGhostColor: accent, innerRadius: 16,
      headlineScale: 1.08, motif: 'bracket',
    };
  }

  // auto / light / dark — 글래스 계열 (auto = 자사몰 prefers 따름)
  const dark = key === 'dark' ? true : key === 'light' ? false : prefersDark;
  const base = baseTokens(dark);
  if (dark) {
    base.surfaceBg = `radial-gradient(130% 75% at 18% -8%, ${withAlpha(accent, 0.16)} 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, #1b2140 0%, #12162a 100%)`;
    base.shadow = `${base.shadow}, 0 0 70px ${withAlpha(accent, 0.12)}`;
  }
  return {
    key, ...base, accent, accentText: onAccent,
    accentSoft: withAlpha(accent, dark ? 0.18 : 0.12),
    eyebrowVariant: 'chip', headlineWeight: 700, headlineAccentBar: false,
    bulletVariant: 'badge', dividerVariant: 'fade',
    innerRadius: 14,
    ...glassButton,
  };
}

export const THEME_OPTIONS: { key: ThemeKey; label: string; hint: string }[] = [
  { key: 'auto', label: '자동', hint: '자사몰 라이트/다크 따라감' },
  { key: 'light', label: '라이트', hint: '소프트 글래스' },
  { key: 'dark', label: '다크', hint: '미드나잇 글로우' },
  { key: 'brand', label: '브랜드', hint: '브랜드 밴드 쇼케이스' },
  { key: 'vibrant', label: '비비드', hint: '회사색 임팩트' },
  { key: 'minimal', label: '미니멀', hint: '모노 에디토리얼' },
];

/** ★ 2026-07-14 디자인 3.0 — 시그니처 테마 (아트디렉션 내장 큐레이션 — DM/이메일 8종 정렬).
 *  1클릭 = theme 키 하나만 저장(서체·조판·모티프는 테마 토큰이 내장 — 문안 무변). */
export const SIGNATURE_THEME_OPTIONS: { key: ThemeKey; label: string; hint: string; swatches: [string, string, string] }[] = [
  { key: 'editorial',   label: '에디토리얼',   hint: '세리프 화보 · 넉넉한 여백',   swatches: ['#1c1917', '#b45309', '#ffffff'] },
  { key: 'luxury-dark', label: '럭셔리 다크',  hint: '딥 다크 · 골드 액센트',       swatches: ['#0e1018', '#d4af37', '#b89150'] },
  { key: 'bold-sale',   label: '볼드 세일',    hint: '검은고딕 임팩트 · 압축 밀도', swatches: ['#18181b', '#ef4444', '#ffffff'] },
  { key: 'soft-pastel', label: '소프트 파스텔', hint: '옅은 워시 · 알약 버튼',       swatches: ['#ec4899', '#fbcfe8', '#fffafc'] },
  { key: 'paper',       label: '웜 페이퍼',    hint: '종이 질감 · 고운바탕 명조',   swatches: ['#9a5b33', '#e8b96a', '#faf6ef'] },
  { key: 'city-night',  label: '시티 나이트',  hint: '다크 네온 · 밤 무드',         swatches: ['#0b1220', '#22d3ee', '#0ea5e9'] },
  { key: 'festive',     label: '페스티브',     hint: '축제 로즈×앰버 · 초대장 톤',  swatches: ['#e11d48', '#fbbf24', '#ffffff'] },
];

// ════════════════════════════════════════════════════════════════════
// 카드 형태 축 (2026-07-07(2)) — SDK inapp-blocks.ts CARD_STYLES/planCardLayout 1:1 미러
//   테마(색상)와 독립. classic/bubble/ticket/poster. 토스트·배너·플로팅 미적용.
// ════════════════════════════════════════════════════════════════════

export type CardStyle = 'classic' | 'bubble' | 'ticket' | 'poster';
export const CARD_STYLES: CardStyle[] = ['classic', 'bubble', 'ticket', 'poster'];

export function normalizeCardStyle(v: any): CardStyle {
  return (CARD_STYLES as string[]).includes(String(v)) ? (String(v) as CardStyle) : 'classic';
}

export const CARD_STYLE_OPTIONS: { key: CardStyle; label: string; hint: string }[] = [
  { key: 'classic', label: '클래식 카드', hint: '정돈된 기본 카드' },
  { key: 'bubble', label: '둥근 말풍선', hint: '아바타 채팅 + 답장 칩' },
  { key: 'ticket', label: '쿠폰 티켓', hint: '2톤 절취 티켓 + 다이컷' },
  { key: 'poster', label: '매거진 포스터', hint: '풀블리드 히어로 겹침' },
];

export interface CardLayoutPlan {
  hero: any | null;
  overlay: any[];
  main: any[];
  stub: any[];
  /** ★ 2026-07-07(5) bubble — 발신자 행(아바타+라벨)으로 승격되는 첫 eyebrow. 그 외 형태 = null */
  sender: any | null;
}

/** SDK planCardLayout 미러 — 분할 규칙 동일 유지 의무 */
export function planCardLayout(blocks: any[], style: CardStyle): CardLayoutPlan {
  const list = Array.isArray(blocks) ? blocks.filter((b) => b && typeof b === 'object') : [];
  if (style === 'poster') {
    let hero: any | null = null;
    const overlay: any[] = [];
    const main: any[] = [];
    let eyebrowTaken = false;
    let headlineTaken = false;
    for (const b of list) {
      if (!hero && b.type === 'media' && (b.variant === 'image' || (!b.variant && b.url)) && String(b.url || '').trim()) { hero = b; continue; }
      if (!eyebrowTaken && b.type === 'eyebrow') { overlay.push(b); eyebrowTaken = true; continue; }
      if (!headlineTaken && b.type === 'headline') { overlay.push(b); headlineTaken = true; continue; }
      main.push(b);
    }
    return { hero, overlay, main, stub: [], sender: null };
  }
  if (style === 'ticket') {
    let cut = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (String(list[i].type) === 'cta_group') { cut = i; break; }
    }
    if (cut <= 0) return { hero: null, overlay: [], main: list, stub: [], sender: null };
    return { hero: null, overlay: [], main: list.slice(0, cut), stub: list.slice(cut), sender: null };
  }
  if (style === 'bubble') {
    let sender: any | null = null;
    const main: any[] = [];
    for (const b of list) {
      if (!sender && b.type === 'eyebrow') { sender = b; continue; }
      main.push(b);
    }
    return { hero: null, overlay: [], main, stub: [], sender };
  }
  return { hero: null, overlay: [], main: list, stub: [], sender: null };
}
