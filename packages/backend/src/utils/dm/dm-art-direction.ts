/**
 * ★ 모바일DM 아트디렉션 엔진 — 순수(DB import 0). 2026-06-25 (P1)
 *   - treatment(섹션 구도) 선택/검증 + 아트디렉션(DM 단위 타입·여백·모티프) 정규화 + 뷰어 CSS 변수 산출.
 *   - AI 출력은 부분/불량 가능 → 항상 안전 기본값. 미설정/미허용 = classic + 기본 토큰(현행과 동일, 비파괴).
 *   - 색/hex 정규화는 dm-visual-direction의 normalizeVisualConcept와 정합(여기선 enum·구조만 담당).
 */
import { DM_COLOR_TOKENS } from './dm-tokens';

export type TypeScale = 'editorial' | 'bold' | 'minimal';
export type SpacingDensity = 'compact' | 'standard' | 'airy';
export type AccentMotif = 'none' | 'rule' | 'index' | 'bracket' | 'dot';
export type SectionDivider = 'none' | 'hairline' | 'gap' | 'rule';
export type HeadlineFont = 'sans' | 'serif';

export type ArtDirection = {
  palette: { primary: string; accent: string; surface: string; on_surface: string };
  mood: string;
  emphasisSections: string[];
  typeScale: TypeScale;
  headlineFont: HeadlineFont;
  spacingDensity: SpacingDensity;
  accentMotif: AccentMotif;
  sectionDivider: SectionDivider;
};

// 섹션별 허용 구도. 우선 4종(P1). 그 외 섹션은 classic만.
export const TREATMENTS: Record<string, readonly string[]> = {
  hero: ['classic', 'full_bleed', 'split', 'typographic', 'editorial_overlap'],
  text_card: ['classic', 'lead', 'framed'],
  cta: ['classic', 'bar', 'ghost'],
  coupon: ['classic', 'ticket', 'spotlight'],
};

const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;
function safeHex(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const s = v.trim();
    if (HEX6.test(s)) return s;
    if (HEX3.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  }
  return fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return (allowed as readonly string[]).includes(v as string) ? (v as T) : def;
}

/**
 * 요청 treatment 검증 → 허용표에 있으면 그대로. 없거나 미설정이면 결정적 기본값.
 *   editorial 타입스케일 + 이미지 없는 hero → 'typographic' 기본(타이포로 휑함 메움). 그 외 classic.
 */
export function selectTreatment(
  sectionType: string,
  requested: string | undefined,
  ctx: { typeScale?: TypeScale; hasImage?: boolean },
): string {
  const allowed = TREATMENTS[sectionType];
  if (!allowed) return 'classic';
  if (requested && allowed.includes(requested)) return requested;
  if (sectionType === 'hero' && ctx.typeScale === 'editorial' && ctx.hasImage === false && allowed.includes('typographic')) {
    return 'typographic';
  }
  return 'classic';
}

type IndustryKey = keyof typeof DM_COLOR_TOKENS.industry;
function industryColors(industry: string): { primary: string; accent: string } {
  const k = industry as IndustryKey;
  return DM_COLOR_TOKENS.industry[k] || { primary: DM_COLOR_TOKENS.brand.primary, accent: DM_COLOR_TOKENS.brand.accent };
}

// tone → 아트디렉션 기본 경향(결정적). AI가 명시 안 했을 때만 적용.
const TONE_DEFAULTS: Record<string, { typeScale: TypeScale; headlineFont: HeadlineFont; spacingDensity: SpacingDensity }> = {
  premium:  { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy' },
  elegant:  { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy' },
  urgent:   { typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'compact' },
  playful:  { typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard' },
  friendly: { typeScale: 'minimal', headlineFont: 'sans', spacingDensity: 'standard' },
};

export function normalizeArtDirection(
  raw: Partial<ArtDirection> | null | undefined,
  industry: string,
  tone?: string,
): ArtDirection {
  const ind = industryColors(industry);
  const td = (tone && TONE_DEFAULTS[tone]) || { typeScale: 'bold' as TypeScale, headlineFont: 'sans' as HeadlineFont, spacingDensity: 'standard' as SpacingDensity };
  const primary = safeHex(raw?.palette?.primary, ind.primary);
  const accent = safeHex(raw?.palette?.accent, ind.accent);
  const surface = safeHex(raw?.palette?.surface, DM_COLOR_TOKENS.neutral[0]);
  const on_surface = safeHex(raw?.palette?.on_surface, DM_COLOR_TOKENS.neutral[900]);
  return {
    palette: { primary, accent, surface, on_surface },
    mood: typeof raw?.mood === 'string' ? raw.mood.slice(0, 40) : '',
    emphasisSections: Array.isArray(raw?.emphasisSections) ? raw!.emphasisSections!.map(String).slice(0, 6) : [],
    typeScale: oneOf<TypeScale>(raw?.typeScale, ['editorial', 'bold', 'minimal'], td.typeScale),
    headlineFont: oneOf<HeadlineFont>(raw?.headlineFont, ['sans', 'serif'], td.headlineFont),
    spacingDensity: oneOf<SpacingDensity>(raw?.spacingDensity, ['compact', 'standard', 'airy'], td.spacingDensity),
    accentMotif: oneOf<AccentMotif>(raw?.accentMotif, ['none', 'rule', 'index', 'bracket', 'dot'], 'none'),
    sectionDivider: oneOf<SectionDivider>(raw?.sectionDivider, ['none', 'hairline', 'gap', 'rule'], 'none'),
  };
}

const TYPE_SCALE_VARS: Record<TypeScale, { hero: string; heroWeight: string; heroLs: string; h1: string }> = {
  editorial: { hero: '40px', heroWeight: '800', heroLs: '-0.03em', h1: '28px' },
  bold:      { hero: '34px', heroWeight: '900', heroLs: '-0.02em', h1: '24px' },
  minimal:   { hero: '28px', heroWeight: '600', heroLs: '0',       h1: '22px' },
};
const DENSITY_SCALE: Record<SpacingDensity, string> = { compact: '0.8', standard: '1', airy: '1.4' };
const DISPLAY_FONT: Record<HeadlineFont, string> = {
  sans: 'var(--dm-font-primary)',
  serif: '"Noto Serif KR", var(--dm-font-primary)',
};

/** 아트디렉션 → 뷰어 :root override CSS(기존 토큰 다음에 주입돼 우선). */
export function artDirectionToCssVars(ad: ArtDirection): string {
  const t = TYPE_SCALE_VARS[ad.typeScale];
  return `:root{`
    + `--dm-fs-hero:${t.hero};--dm-fw-hero:${t.heroWeight};--dm-ls-hero:${t.heroLs};--dm-fs-h1:${t.h1};`
    + `--dm-section-pad-scale:${DENSITY_SCALE[ad.spacingDensity]};`
    + `--dm-font-display:${DISPLAY_FONT[ad.headlineFont]};`
    + `}`;
}
