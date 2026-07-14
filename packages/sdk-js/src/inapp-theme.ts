/**
 * @hanjullo/sdk — In-app Message 테마 토큰 (D230+ 2026-06-27 · 2026-07-07 디자인 2.0 · 2026-07-07(2) 디자인 언어 2.1)
 *
 * 큐레이션 테마 = 토큰 세트. SDK 렌더(inapp-blocks)와 관리자 미리보기가 동일 토큰을 쓰도록
 * 단일 정의를 둔다. 테마가 "면(surface)"을 정하고 회사색은 "accent"만 — 단색 범람 제거.
 *
 * 2026-07-07 디자인 2.0: 그라데이션 면(surfaceBg) + 3중 레이어 그림자 + 상단 하이라이트 링(ring)
 *   + accentSoft(워시) 토큰 추가. 기존 토큰 의미는 불변(하위 호환) — 추가만.
 *
 * 2026-07-07(2) 디자인 언어 2.1: 테마 6종이 "색깔만 다른 같은 카드"가 되지 않도록
 *   구조·타이포·장식 축 토큰 11종 추가 (역시 추가만 — 기존 토큰 의미 불변).
 *   - auto   = 자사몰 라이트/다크 모드를 따라감 (라이트/다크 언어 중 하나로 해석)
 *   - light  = 소프트 글래스: 흰 그라데이션 면 + 부드러운 3중 그림자 + 칩 라벨 + 그라데이션 버튼
 *   - dark   = 미드나잇 글래스: 네이비 면 + accent 글로우 + 유리 광
 *   - brand  = 브랜드 쇼케이스: 흰 캔버스 고정 + 상단 브랜드 밴드 + accent 워시 + 솔리드 accent 칩
 *              + 헤드라인 밑 accent 바 + 플랫 accent 버튼 (다크몰에서도 화이트 쇼케이스 유지)
 *   - vibrant= 임팩트 포스터: 회사색 면 전체 + 상단 샤인 + 알약(pill) 반전 버튼
 *   - minimal= 모노 에디토리얼: 완전 플랫 흰 면 + 헤어라인 보더 + 민무늬 라벨(자간 넓게)
 *              + 모노 불릿 + 잉크(먹색) 사각 버튼 — accent는 티켓/포인트에만
 *
 * 레거시 호환: content_blocks 없는 메시지는 이 모듈을 거치지 않고 기존 background_color 단색 렌더.
 */

export type ThemeKey =
  | 'auto' | 'light' | 'dark' | 'brand' | 'vibrant' | 'minimal'
  // ★ 2026-07-14 디자인 3.0 — 시그니처 테마 7종 (DM/이메일 8종 큐레이션 정렬. 기존 6키 토큰 불변 — 추가만)
  | 'editorial' | 'luxury-dark' | 'bold-sale' | 'soft-pastel' | 'paper' | 'city-night' | 'festive';

export type EyebrowVariant = 'chip' | 'chip_solid' | 'plain';
export type BulletVariant = 'badge' | 'mono';
export type DividerVariant = 'fade' | 'solid';
export type DensityKey = 'airy' | 'compact';
export type MotifKey = 'rule' | 'dot' | 'bracket';

export interface InAppTheme {
  key: ThemeKey;
  /** 카드 배경 (단색 — 노치/펀치홀 등 "구멍" 색으로도 사용) */
  surface: string;
  /** 카드 배경 (그라데이션·장식 레이어 포함 — 실제 카드 면 렌더용. 단색 폴백 = surface) */
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
  /** 카드 상단 하이라이트 링 (inset — 유리 모서리 광). '' = 없음(플랫 테마) */
  ring: string;
  /** 미디어 오버레이 위 글자색 */
  onMedia: string;
  // ── 2026-07-07(2) 디자인 언어 축 (추가 토큰 — 기존 의미 불변) ──
  /** eyebrow 라벨 렌더 방식 — chip(연한 워시 칩) / chip_solid(accent 솔리드 칩) / plain(민무늬 자간 라벨) */
  eyebrowVariant: EyebrowVariant;
  /** 헤드라인 기본 굵기 (size=xl은 최소 800 보장) */
  headlineWeight: number;
  /** 헤드라인 아래 accent 짧은 바 (브랜드 쇼케이스 시그니처) */
  headlineAccentBar: boolean;
  /** bullets 아이콘 — badge(accent 원형 배지) / mono(민무늬 잉크 체크) */
  bulletVariant: BulletVariant;
  /** 구분선 — fade(양끝 스며듦) / solid(헤어라인) */
  dividerVariant: DividerVariant;
  /** 버튼 모서리(px). 999 = 알약 */
  buttonRadius: number;
  /** primary 버튼 면 (테마가 완성한 값 — 그라데이션/플랫/잉크) */
  buttonPrimaryBg: string;
  /** primary 버튼 글자색 */
  buttonPrimaryText: string;
  /** primary 버튼 그림자 */
  buttonPrimaryShadow: string;
  /** ghost 버튼 글자색 */
  buttonGhostColor: string;
  /** 내부 카드(혜택 티켓/상품/카운트다운) 모서리(px) */
  innerRadius: number;
  // ── ★ 2026-07-14 디자인 3.0 아트디렉션 축 (시그니처 테마 전용 — 기존 6테마 미설정 = 현행 렌더 불변) ──
  /** 헤드라인 전용 서체(font-family). 실로딩은 카탈로그 매칭 시에만(inappGoogleFontsUrl) */
  displayFont?: string;
  /** 헤드라인 크기 배율 (미설정 = 1 — 현행) */
  headlineScale?: number;
  /** 블록 간격 밀도 (미설정 = 현행 13px) */
  density?: DensityKey;
  /** 헤드라인 위 모티프 마크 (미설정 = 없음) */
  motif?: MotifKey;
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

// ★ 2026-07-14 디자인 3.0 — 시그니처 테마 키 + 테마별 기본 강조색 (회사 accent_color가 항상 우선)
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

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-14 디자인 3.0 — 서체 카탈로그 (SSOT: backend dm-tokens DM_FONT_CATALOG 6종 미러)
//   실로딩은 카탈로그 매칭 시에만 — 임의 문자열로 외부 URL을 만들지 않는다 (화이트리스트).
// ════════════════════════════════════════════════════════════════════

export const INAPP_FONT_CATALOG: ReadonlyArray<{ id: string; label: string; css: string; google: string | null }> = [
  { id: 'pretendard',     label: '프리텐다드 (기본)',        css: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif', google: null },
  { id: 'noto-serif',     label: '노토 세리프 (명조)',       css: '"Noto Serif KR", serif',       google: 'Noto+Serif+KR:wght@400;600;700;900' },
  { id: 'nanum-myeongjo', label: '나눔명조',                 css: '"Nanum Myeongjo", serif',      google: 'Nanum+Myeongjo:wght@400;700;800' },
  { id: 'gowun-batang',   label: '고운바탕 (부드러운 명조)', css: '"Gowun Batang", serif',        google: 'Gowun+Batang:wght@400;700' },
  { id: 'gowun-dodum',    label: '고운돋움',                 css: '"Gowun Dodum", sans-serif',    google: 'Gowun+Dodum' },
  { id: 'black-han',      label: '검은고딕 (임팩트)',        css: '"Black Han Sans", sans-serif', google: 'Black+Han+Sans' },
];

/** 서체 문자열 무해화 — font-family에 필요한 문자만 허용 (dm-tokens safeFontFamily 미러) */
export function safeFontFamily(v: string | undefined | null, fallback: string): string {
  if (!v || typeof v !== 'string') return fallback;
  const cleaned = v.replace(/[^\w\s,"'\-]/g, '').trim();
  return cleaned || fallback;
}

/** font-family 문자열(들) → Google Fonts css2 URL. 카탈로그 매칭 0건 = null(로드 안 함) — dm-tokens dmGoogleFontsUrl 미러 */
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

export interface ResolveThemeOptions {
  /** 자사몰 prefers-color-scheme: dark 여부 (auto 면 선택). 미전달 시 false */
  prefersDark?: boolean;
}

/**
 * 테마 키 + 회사 accent → 토큰 세트.
 * - 면·구조·타이포·장식은 테마가, accent만 회사색.
 * - accent 위 글자(accentText), 면 위 글자(textPrimary)는 대비 자동 보정.
 * - accent_color가 hex가 아니면 기본 accent 사용(레거시 gradient 값이 들어와도 안전).
 * - brand는 prefersDark와 무관하게 화이트 쇼케이스 고정 (브랜드 밴드가 시그니처).
 */
export function resolveTheme(
  themeKey: string | null | undefined,
  accentColor?: string | null,
  opts?: ResolveThemeOptions,
): InAppTheme {
  const prefersDark = !!opts?.prefersDark;
  const key: ThemeKey = (VALID_KEYS as string[]).includes(String(themeKey)) ? (themeKey as ThemeKey) : 'auto';
  // 회사 accent_color 우선 — 미설정 시 시그니처 테마는 자기 기본색, 그 외 기존 기본색 (기존 6테마 동작 불변)
  const accent = isHexColor(accentColor)
    ? normalizeHex(accentColor as string)
    : (SIGNATURE_DEFAULT_ACCENT[key] || DEFAULT_ACCENT);
  const onAccent = pickReadableText(accent);

  // 라이트/다크 글래스 공용 — 그라데이션 primary 버튼 (눌리는 입체감)
  const glassButton = {
    buttonRadius: 14,
    buttonPrimaryBg: `linear-gradient(180deg, ${shadeHex(accent, 6)} 0%, ${shadeHex(accent, -12)} 100%)`,
    buttonPrimaryText: onAccent,
    buttonPrimaryShadow: `0 1px 2px ${withAlpha(shadeHex(accent, -40), 0.3)}, 0 8px 22px ${withAlpha(accent, 0.38)}, inset 0 1px 0 rgba(255,255,255,0.18)`,
    buttonGhostColor: accent,
  };

  if (key === 'vibrant') {
    // 임팩트 포스터 — 회사색 면 전체 + 상단 샤인 + 반전(흰/잉크) 알약 버튼
    const isLightText = onAccent === '#ffffff';
    return {
      key,
      surface: accent,
      surfaceBg: `radial-gradient(130% 85% at 85% -12%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 52%), linear-gradient(150deg, ${shadeHex(accent, 8)} 0%, ${accent} 45%, ${shadeHex(accent, -24)} 100%)`,
      surfaceElevated: isLightText ? 'rgba(255,255,255,0.15)' : 'rgba(15,23,42,0.08)',
      textPrimary: onAccent,
      textSecondary: isLightText ? 'rgba(255,255,255,0.84)' : 'rgba(15,23,42,0.72)',
      // vibrant: 버튼·아이콘은 흰(또는 진한) 면 + 글자는 회사색 → 강한 대비
      accent: onAccent,
      accentText: accent,
      accentSoft: isLightText ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.10)',
      border: isLightText ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.14)',
      radius: 26,
      shadow: `0 2px 8px rgba(0,0,0,0.22), 0 22px 54px ${withAlpha(shadeHex(accent, -35), 0.55)}`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.22)',
      onMedia: '#ffffff',
      eyebrowVariant: 'chip',
      headlineWeight: 800,
      headlineAccentBar: false,
      bulletVariant: 'badge',
      dividerVariant: 'fade',
      buttonRadius: 999,
      buttonPrimaryBg: isLightText ? '#ffffff' : '#0f172a',
      buttonPrimaryText: accent,
      buttonPrimaryShadow: '0 2px 6px rgba(0,0,0,0.2), 0 12px 30px rgba(0,0,0,0.25)',
      buttonGhostColor: onAccent,
      innerRadius: 16,
    };
  }

  if (key === 'minimal') {
    // 모노 에디토리얼 — 완전 플랫 + 헤어라인 + 민무늬 라벨 + 잉크 버튼. accent는 티켓/포인트에만.
    return {
      key,
      surface: '#ffffff',
      surfaceBg: '#ffffff',
      surfaceElevated: '#f7f7f8',
      textPrimary: '#111827',
      textSecondary: '#6b7280',
      accent,
      accentText: onAccent,
      accentSoft: withAlpha(accent, 0.08),
      border: 'rgba(17,24,39,0.12)',
      radius: 12,
      shadow: '0 1px 2px rgba(17,24,39,0.04), 0 14px 34px rgba(17,24,39,0.08)',
      ring: '',
      onMedia: '#ffffff',
      eyebrowVariant: 'plain',
      headlineWeight: 700,
      headlineAccentBar: false,
      bulletVariant: 'mono',
      dividerVariant: 'solid',
      buttonRadius: 9,
      buttonPrimaryBg: '#111827',
      buttonPrimaryText: '#ffffff',
      buttonPrimaryShadow: '0 6px 18px rgba(17,24,39,0.22)',
      buttonGhostColor: '#111827',
      innerRadius: 10,
    };
  }

  if (key === 'brand') {
    // 브랜드 쇼케이스 — 흰 캔버스 고정 + 상단 브랜드 밴드 + accent 워시 + 솔리드 칩 + 헤드라인 accent 바
    return {
      key,
      surface: '#ffffff',
      surfaceBg: `linear-gradient(90deg, ${accent} 0%, ${shadeHex(accent, 28)} 100%) left top / 100% 6px no-repeat, linear-gradient(180deg, ${withAlpha(accent, 0.07)} 0%, rgba(255,255,255,0) 32%) left top / 100% 100% no-repeat, linear-gradient(180deg, #ffffff 0%, #ffffff 100%)`,
      surfaceElevated: withAlpha(accent, 0.06),
      textPrimary: '#101828',
      textSecondary: '#4f5869',
      accent,
      accentText: onAccent,
      accentSoft: withAlpha(accent, 0.1),
      border: withAlpha(accent, 0.16),
      radius: 20,
      shadow: `0 2px 6px rgba(15,23,42,0.05), 0 16px 40px ${withAlpha(shadeHex(accent, -20), 0.16)}, 0 40px 90px rgba(15,23,42,0.12)`,
      ring: 'inset 0 1px 0 rgba(255,255,255,0.9)',
      onMedia: '#ffffff',
      eyebrowVariant: 'chip_solid',
      headlineWeight: 800,
      headlineAccentBar: true,
      bulletVariant: 'badge',
      dividerVariant: 'solid',
      buttonRadius: 12,
      buttonPrimaryBg: accent,
      buttonPrimaryText: onAccent,
      buttonPrimaryShadow: `0 2px 5px ${withAlpha(shadeHex(accent, -35), 0.25)}, 0 10px 26px ${withAlpha(accent, 0.35)}`,
      buttonGhostColor: accent,
      innerRadius: 12,
    };
  }

  // ★ 2026-07-14 디자인 3.0 — 시그니처 테마 7종 (아트디렉션 내장. 다크 면은 리터럴 원칙 — 자기 면 색 고정)
  if (key === 'editorial') {
    return {
      key,
      surface: '#ffffff',
      surfaceBg: 'linear-gradient(180deg, #ffffff 0%, #fbfaf8 100%)',
      surfaceElevated: '#f6f4f0',
      textPrimary: '#1c1917', textSecondary: '#57534e',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.09),
      border: 'rgba(28,25,23,0.14)', radius: 16,
      shadow: '0 1px 2px rgba(28,25,23,0.05), 0 16px 40px rgba(28,25,23,0.10)',
      ring: '', onMedia: '#ffffff',
      eyebrowVariant: 'plain', headlineWeight: 700, headlineAccentBar: false,
      bulletVariant: 'mono', dividerVariant: 'solid',
      buttonRadius: 6,
      buttonPrimaryBg: '#1c1917', buttonPrimaryText: '#ffffff',
      buttonPrimaryShadow: '0 6px 18px rgba(28,25,23,0.22)',
      buttonGhostColor: '#1c1917', innerRadius: 8,
      displayFont: '"Noto Serif KR", serif', headlineScale: 1.12, density: 'airy', motif: 'rule',
    };
  }
  if (key === 'luxury-dark') {
    return {
      key,
      surface: '#0e1018',
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
      key,
      surface: '#ffffff', surfaceBg: '#ffffff', surfaceElevated: '#f7f7f8',
      textPrimary: '#18181b', textSecondary: '#52525b',
      accent, accentText: onAccent, accentSoft: withAlpha(accent, 0.1),
      border: 'rgba(24,24,27,0.14)', radius: 14,
      shadow: '0 2px 6px rgba(24,24,27,0.08), 0 18px 44px rgba(24,24,27,0.16)',
      ring: '', onMedia: '#ffffff',
      eyebrowVariant: 'chip_solid', headlineWeight: 900, headlineAccentBar: false,
      bulletVariant: 'badge', dividerVariant: 'solid',
      buttonRadius: 10,
      buttonPrimaryBg: '#18181b', buttonPrimaryText: '#ffffff',
      buttonPrimaryShadow: '0 8px 22px rgba(24,24,27,0.3)',
      buttonGhostColor: '#18181b', innerRadius: 10,
      displayFont: '"Black Han Sans", sans-serif', headlineScale: 1.22, density: 'compact', motif: 'rule',
    };
  }
  if (key === 'soft-pastel') {
    return {
      key,
      surface: '#fffafc',
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
      key,
      surface: '#faf6ef',
      surfaceBg: 'linear-gradient(180deg, #fbf8f2 0%, #f7f1e6 100%)',
      surfaceElevated: '#f1eadd',
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
      key,
      surface: '#0b1220',
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
      key,
      surface: '#ffffff',
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
    // 미드나잇 글래스 — accent 글로우 (좌상단 은은한 브랜드 빛)
    base.surfaceBg = `radial-gradient(130% 75% at 18% -8%, ${withAlpha(accent, 0.16)} 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, #1b2140 0%, #12162a 100%)`;
    base.shadow = `${base.shadow}, 0 0 70px ${withAlpha(accent, 0.12)}`;
  }
  return {
    key,
    ...base,
    accent,
    accentText: onAccent,
    accentSoft: withAlpha(accent, dark ? 0.18 : 0.12),
    eyebrowVariant: 'chip',
    headlineWeight: 700,
    headlineAccentBar: false,
    bulletVariant: 'badge',
    dividerVariant: 'fade',
    innerRadius: 14,
    ...glassButton,
  };
}
