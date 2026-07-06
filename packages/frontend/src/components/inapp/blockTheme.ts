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

export type ThemeKey = 'auto' | 'light' | 'dark' | 'brand' | 'vibrant' | 'minimal';

export type EyebrowVariant = 'chip' | 'chip_solid' | 'plain';
export type BulletVariant = 'badge' | 'mono';
export type DividerVariant = 'fade' | 'solid';

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

const VALID_KEYS: ThemeKey[] = ['auto', 'light', 'dark', 'brand', 'vibrant', 'minimal'];

/**
 * SDK resolveTheme 미러 — brand는 prefersDark와 무관하게 화이트 쇼케이스 고정.
 */
export function resolveTheme(themeKey: string | null | undefined, accentColor?: string | null, prefersDark = false): InAppTheme {
  const accent = isHexColor(accentColor) ? normalizeHex(accentColor as string) : DEFAULT_ACCENT;
  const key: ThemeKey = (VALID_KEYS as string[]).includes(String(themeKey)) ? (themeKey as ThemeKey) : 'auto';
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
  { key: 'bubble', label: '둥근 말풍선', hint: '꼬리 달린 대화형' },
  { key: 'ticket', label: '쿠폰 티켓', hint: '절취선 + 스터브 CTA' },
  { key: 'poster', label: '매거진 포스터', hint: '헤드라인 겹친 히어로' },
];

export interface CardLayoutPlan {
  hero: any | null;
  overlay: any[];
  main: any[];
  stub: any[];
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
    return { hero, overlay, main, stub: [] };
  }
  if (style === 'ticket') {
    let cut = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (String(list[i].type) === 'cta_group') { cut = i; break; }
    }
    if (cut <= 0) return { hero: null, overlay: [], main: list, stub: [] };
    return { hero: null, overlay: [], main: list.slice(0, cut), stub: list.slice(cut) };
  }
  return { hero: null, overlay: [], main: list, stub: [] };
}
