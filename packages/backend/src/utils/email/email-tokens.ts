/**
 * email-tokens.ts — 브랜드킷 → 이메일 인라인 값 해석 (단일 진입점)
 *
 * DM 디자인 토큰(리터럴 값)을 읽기 차용해, 이메일 렌더러가 인라인 style에 넣을
 * 실제 색/타이포/여백 값을 돌려준다. CSS 변수는 이메일에서 안 쓰므로 전부 리터럴.
 * 브랜드킷이 있으면 색·폰트를 override.
 *
 * ★ 2026-07-13 이메일 디자인 3.0 — 캠페인 단위 design(테마·아트디렉션·서체·프리헤더) 소비 추가.
 *   - design 미설정 = 전 파생값이 기존 기본과 동일 (기존 캠페인 산출 무변화 — 회귀 0 원칙)
 *   - 타입스케일/여백 밀도 = DM TYPE_SCALE_VARS·DENSITY와 SSOT 동기(리터럴 미러)
 *   - 다크 셸 = 배경이 어두우면(#fff 대비 4.5+) 중립 스케일 반전 (DM renderDmTokensCss 원리 미러,
 *     자기 면 가진 요소는 리터럴 #171717 원칙)
 *   - 서체 = 이메일 전용 폴백 스택(웹폰트 미지원 클라이언트 대비) + 지원 클라이언트용 @import
 */
import { DM_COLOR_TOKENS, DM_TYPOGRAPHY, DM_SPACING } from '../dm/dm-tokens';
import type { DmBrandKit } from '../dm/dm-tokens';
// ★ 2026-07-14 디자인 4.0 M2 — 타입스케일·밀도·서체 카탈로그 소유가 design-core로 이동(값 무변 이관).
import { CORE_TYPE_SCALE, CORE_DENSITY_SCALE } from '../design-core/art-direction';
import { CORE_FONTS } from '../design-core/fonts';

// ────────────── 디자인(캠페인 단위) 타입 ──────────────

export type EmailTypeScale = 'editorial' | 'bold' | 'minimal';
export type EmailSpacingDensity = 'compact' | 'standard' | 'airy';
export type EmailAccentMotif = 'none' | 'rule' | 'dot' | 'bracket' | 'index';
export type EmailSectionDivider = 'none' | 'hairline' | 'gap' | 'rule';

/** email_campaigns.design JSONB — 전 키 옵셔널. 미설정 = 현행 렌더와 동일. */
export interface EmailDesign {
  theme?: string;
  art_direction?: {
    typeScale?: EmailTypeScale;
    spacingDensity?: EmailSpacingDensity;
    accentMotif?: EmailAccentMotif;
    sectionDivider?: EmailSectionDivider;
  };
  font_family?: string;
  font_display?: string;
  palette?: { primary?: string; accent?: string; background?: string };
  preheader?: string;
}

/**
 * 클라이언트 입력 design 정규화 — 화이트리스트 키·enum·hex·길이만 통과(불량 = 해당 키 제거).
 * 저장(POST/PATCH)·미리보기(render-preview) 진입 전 단일 정규화 지점. 전부 탈락 = null.
 */
export function normalizeEmailDesign(raw: unknown): EmailDesign | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, any>;
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
    (allowed as readonly string[]).includes(v as string) ? (v as T) : undefined;
  const hex = (v: unknown): string | undefined =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : undefined;
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
  const out: EmailDesign = {};
  const theme = str(r.theme, 40);
  if (theme) out.theme = theme;
  const ad = r.art_direction && typeof r.art_direction === 'object' ? r.art_direction : {};
  const typeScale = oneOf<EmailTypeScale>(ad.typeScale, ['editorial', 'bold', 'minimal']);
  const spacingDensity = oneOf<EmailSpacingDensity>(ad.spacingDensity, ['compact', 'standard', 'airy']);
  const accentMotif = oneOf<EmailAccentMotif>(ad.accentMotif, ['none', 'rule', 'dot', 'bracket', 'index']);
  const sectionDivider = oneOf<EmailSectionDivider>(ad.sectionDivider, ['none', 'hairline', 'gap', 'rule']);
  if (typeScale || spacingDensity || accentMotif || sectionDivider) {
    out.art_direction = {
      ...(typeScale ? { typeScale } : {}),
      ...(spacingDensity ? { spacingDensity } : {}),
      ...(accentMotif ? { accentMotif } : {}),
      ...(sectionDivider ? { sectionDivider } : {}),
    };
  }
  const fontFamily = str(r.font_family, 200);
  if (fontFamily) out.font_family = fontFamily;
  const fontDisplay = str(r.font_display, 200);
  if (fontDisplay) out.font_display = fontDisplay;
  const primary = hex(r.palette?.primary);
  const accent = hex(r.palette?.accent);
  const background = hex(r.palette?.background);
  if (primary || accent || background) {
    out.palette = { ...(primary ? { primary } : {}), ...(accent ? { accent } : {}), ...(background ? { background } : {}) };
  }
  const preheader = str(r.preheader, 90);
  if (preheader) out.preheader = preheader;
  return Object.keys(out).length > 0 ? out : null;
}

// ────────────── 서체 카탈로그 (이메일판 — DM 6종 큐레이션 + 이메일 폴백 스택) ──────────────

/**
 * css = 이메일 안전 폴백 스택(웹폰트 → 한국어 시스템 서체 → 총칭).
 * google = css2 family 파라미터(DM 카탈로그와 동일 값) — @import 지원 클라이언트(Apple Mail 등)만 로드.
 */
// ★ 2026-07-14 디자인 4.0 M2 — 소유 = design-core/fonts CORE_FONTS (emailCss = 이메일 폴백 스택, 값 무변 파생).
export const EMAIL_FONT_CATALOG: ReadonlyArray<{ id: string; match: string; css: string; google: string | null }> =
  CORE_FONTS.map((c) => ({ id: c.id, match: c.match, css: c.emailCss, google: c.google }));

/** 저장된 font-family 문자열이 카탈로그 서체를 가리키면 이메일 폴백 스택으로 승격, 아니면 null(원본 유지). */
export function emailFontStack(family?: string): string | null {
  if (!family) return null;
  for (const c of EMAIL_FONT_CATALOG) {
    if (family.includes(c.match)) return c.css;
  }
  return null;
}

/** 사용 서체들의 Google Fonts @import 라인 — 지원 클라이언트만 로드(미지원 = 폴백 스택). 매칭 0건이면 ''. */
export function emailGoogleFontsImport(...families: Array<string | undefined>): string {
  const params: string[] = [];
  for (const f of families) {
    if (!f) continue;
    for (const c of EMAIL_FONT_CATALOG) {
      if (c.google && f.includes(c.match) && !params.includes(c.google)) params.push(c.google);
    }
  }
  if (params.length === 0) return '';
  return `@import url('https://fonts.googleapis.com/css2?${params.map((p) => `family=${p}`).join('&')}&display=swap');`;
}

// ────────────── 타입스케일 / 여백 밀도 (DM SSOT 리터럴 미러) ──────────────

// ★ 2026-07-14 디자인 4.0 M2 — 소유 = design-core CORE_TYPE_SCALE(emailH2 포함)·CORE_DENSITY_SCALE (값 무변 파생).
//   미설정 = DM_TYPOGRAPHY.scale 기본(현행 산출 그대로 — M0 골든 스냅샷 고정).
const EMAIL_TYPE_SCALE: Record<EmailTypeScale, { hero: { size: string; weight: number; ls: string }; h1: string; h2: string }> = {
  editorial: { hero: { size: CORE_TYPE_SCALE.editorial.hero, weight: Number(CORE_TYPE_SCALE.editorial.heroWeight), ls: CORE_TYPE_SCALE.editorial.heroLs }, h1: CORE_TYPE_SCALE.editorial.h1, h2: CORE_TYPE_SCALE.editorial.emailH2 },
  bold:      { hero: { size: CORE_TYPE_SCALE.bold.hero, weight: Number(CORE_TYPE_SCALE.bold.heroWeight), ls: CORE_TYPE_SCALE.bold.heroLs }, h1: CORE_TYPE_SCALE.bold.h1, h2: CORE_TYPE_SCALE.bold.emailH2 },
  minimal:   { hero: { size: CORE_TYPE_SCALE.minimal.hero, weight: Number(CORE_TYPE_SCALE.minimal.heroWeight), ls: CORE_TYPE_SCALE.minimal.heroLs }, h1: CORE_TYPE_SCALE.minimal.h1, h2: CORE_TYPE_SCALE.minimal.emailH2 },
};

const DENSITY_MULT: Record<EmailSpacingDensity, number> = CORE_DENSITY_SCALE;

function scaleSpacing(mult: number): typeof DM_SPACING {
  if (mult === 1) return DM_SPACING;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(DM_SPACING)) {
    const n = parseInt(String(v), 10);
    out[k] = Number.isFinite(n) && n > 0 ? `${Math.round(n * mult)}px` : String(v);
  }
  return out as unknown as typeof DM_SPACING;
}

// ────────────── 다크 셸 판정 (DM getContrastRatio 원리 미러 — 결정적) ──────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 배경이 어두운가 — 흰색 텍스트 대비 4.5:1 이상이면 다크 (WCAG 산식, 임의 상수 아님). */
export function isDarkBackground(hex?: string): boolean {
  if (!hex) return false;
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const contrastVsWhite = (1.0 + 0.05) / (relLuminance(rgb) + 0.05);
  return contrastVsWhite >= 4.5;
}

// ────────────── EmailBrand ──────────────

export interface EmailBrand {
  primary: string;
  primaryHover: string;
  accent: string;
  text: string;
  textMuted: string;
  bg: string;        // 바깥 배경
  cardBg: string;    // 본문 카드 배경
  border: string;
  fontFamily: string;
  mono: string;
  sp: typeof DM_SPACING;
  type: typeof DM_TYPOGRAPHY.scale;
  radius: { sm: string; md: string; lg: string; xl: string };
  // ── ★ 2026-07-07(5) 이메일 디자인 2.0 (인앱 2.0 톤 미러 — 추가 토큰, 기존 의미 불변) ──
  /** 강조색 연한 워시 (칩/쿠폰 면) — rgba */
  primarySoft: string;
  /** 강조색 대시 보더 색 (쿠폰 절취) — rgba */
  primaryDashed: string;
  /** primary 버튼 그라데이션 (background-image 값 — 미지원 클라이언트는 solid primary 폴백) */
  btnGrad: string;
  /** 카드 상단 브랜드 밴드 그라데이션 */
  bandGrad: string;
  /** 강조색 밴드/카운트다운 면 그라데이션 */
  heroGrad: string;
  /** 바깥 배경 (슬레이트 틴트 — brandKit.background_color 우선) */
  shellBg: string;
  // ── ★ 2026-07-13 이메일 디자인 3.0 (미설정 = 기존 출력과 동일한 기본값) ──
  /** 헤드라인 전용 서체 (미설정 = fontFamily) */
  displayFont: string;
  /** 헤드라인 마커펜 워시 — rgba */
  markerWash: string;
  /** 아트디렉션 — 헤드라인 모티프 */
  motif: EmailAccentMotif;
  /** 아트디렉션 — 섹션 사이 디바이더 */
  divider: EmailSectionDivider;
  /** 다크 셸 여부 (배경 어두움 → 중립 반전) */
  dark: boolean;
  /** head <style>용 Google Fonts @import 라인 ('' = 카탈로그 서체 미사용) */
  fontImport: string;
}

/** ★ 2026-07-07(5) 실측 발견 결함 수정 — 폰트 스택의 큰따옴표("Pretendard Variable")가
 *  style="..." 속성을 조기 종료시켜 HTML 파손 + 폰트 무효. 인라인 속성용은 작은따옴표로 치환.
 *  ★ 2026-07-13 — brand_kit/design 서체 문자열은 raw 삽입 표면 → 허용 문자 밖 제거(DM safeFontFamily 원칙). */
function inlineFont(stack: string): string {
  return stack.replace(/"/g, "'").replace(/[^a-zA-Z0-9 ,'\-]/g, '');
}

/** 브랜드킷(snake_case 필드) + 캠페인 design → 이메일 인라인 값. 미설정 필드는 DM 기본 토큰. */
export function resolveEmailBrand(brandKit?: DmBrandKit | null, design?: EmailDesign | null): EmailBrand {
  const pal = design?.palette || {};
  const primary = pal.primary || brandKit?.primary_color || DM_COLOR_TOKENS.brand.primary;
  const accent = pal.accent || brandKit?.accent_color || DM_COLOR_TOKENS.brand.accent;
  const background = pal.background || brandKit?.background_color;

  // 서체 — design 우선, 카탈로그 매칭 시 이메일 폴백 스택으로 승격(미매칭 = 저장값 그대로 = 하위호환)
  const bodyFamilyRaw = design?.font_family || brandKit?.font_family || DM_TYPOGRAPHY.fontFamily.primary;
  const displayFamilyRaw = design?.font_display || (brandKit as { font_display?: string } | null | undefined)?.font_display || bodyFamilyRaw;
  const fontFamily = inlineFont(emailFontStack(bodyFamilyRaw) || bodyFamilyRaw);
  const displayFont = inlineFont(emailFontStack(displayFamilyRaw) || displayFamilyRaw);

  // 타입스케일 — 미설정 = DM 기본 scale 그대로(기존 산출 무변화)
  const ts = design?.art_direction?.typeScale;
  const scale = ts && EMAIL_TYPE_SCALE[ts]
    ? ({
        ...DM_TYPOGRAPHY.scale,
        hero: { ...DM_TYPOGRAPHY.scale.hero, size: EMAIL_TYPE_SCALE[ts].hero.size, weight: EMAIL_TYPE_SCALE[ts].hero.weight, letterSpacing: EMAIL_TYPE_SCALE[ts].hero.ls },
        h1: { ...DM_TYPOGRAPHY.scale.h1, size: EMAIL_TYPE_SCALE[ts].h1 },
        h2: { ...DM_TYPOGRAPHY.scale.h2, size: EMAIL_TYPE_SCALE[ts].h2 },
      } as unknown as typeof DM_TYPOGRAPHY.scale)
    : DM_TYPOGRAPHY.scale;

  // 여백 밀도 — 미설정 = DM_SPACING 그대로
  const density = design?.art_direction?.spacingDensity;
  const sp = density && DENSITY_MULT[density] ? scaleSpacing(DENSITY_MULT[density]) : DM_SPACING;

  // 다크 셸 — 배경이 어두우면 중립 반전(리터럴). 자기 면 요소(#171717 패널 등)는 렌더러가 리터럴 유지.
  const dark = isDarkBackground(background);
  const neutrals = dark
    ? { text: '#f4f4f5', textMuted: '#a1a1aa', bg: '#1f1f23', cardBg: '#171717', border: 'rgba(255,255,255,0.14)' }
    : { text: DM_COLOR_TOKENS.neutral[800], textMuted: DM_COLOR_TOKENS.neutral[500], bg: background || DM_COLOR_TOKENS.neutral[100], cardBg: DM_COLOR_TOKENS.neutral[0], border: DM_COLOR_TOKENS.neutral[200] };

  return {
    primary,
    primaryHover: (pal.primary || brandKit?.primary_color) ? shift(primary, -24) : DM_COLOR_TOKENS.brand.primaryHover,
    accent,
    text: neutrals.text,
    textMuted: neutrals.textMuted,
    bg: neutrals.bg,
    cardBg: neutrals.cardBg,
    border: neutrals.border,
    fontFamily,
    mono: inlineFont(DM_TYPOGRAPHY.fontFamily.mono),
    sp,
    type: scale,
    radius: { sm: '8px', md: '12px', lg: '16px', xl: '20px' },
    primarySoft: withAlpha(primary, 0.08),
    primaryDashed: withAlpha(primary, 0.45),
    btnGrad: `linear-gradient(180deg,${shift(primary, 14)} 0%,${shift(primary, -28)} 100%)`,
    bandGrad: `linear-gradient(90deg,${primary} 0%,${shift(primary, 64)} 100%)`,
    heroGrad: `linear-gradient(135deg,${shift(primary, 18)} 0%,${primary} 55%,${shift(primary, -56)} 100%)`,
    shellBg: background || '#eef1f6',
    displayFont,
    markerWash: withAlpha(primary, 0.26),
    motif: design?.art_direction?.accentMotif || 'none',
    divider: design?.art_direction?.sectionDivider || 'none',
    dark,
    fontImport: emailGoogleFontsImport(bodyFamilyRaw, displayFamilyRaw),
  };
}

/** 명도 이동 — delta<0 = 어둡게, >0 = 밝게 (결정적 변환, 임의 상수 아님). #rrggbb 외는 원본 반환. */
function shift(hex: string, delta: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + delta);
  const g = clamp(((n >> 8) & 255) + delta);
  const b = clamp((n & 255) + delta);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/** hex + 알파 → rgba 문자열. #rrggbb 외는 원본 반환. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
