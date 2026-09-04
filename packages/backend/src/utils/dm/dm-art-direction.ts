/**
 * ★ 모바일DM 아트디렉션 엔진 — 순수(DB import 0). 2026-06-25 (P1)
 *   - treatment(섹션 구도) 선택/검증 + 아트디렉션(DM 단위 타입·여백·모티프) 정규화 + 뷰어 CSS 변수 산출.
 *   - AI 출력은 부분/불량 가능 → 항상 안전 기본값. 미설정/미허용 = classic + 기본 토큰(현행과 동일, 비파괴).
 *   - 색/hex 정규화는 dm-visual-direction의 normalizeVisualConcept와 정합(여기선 enum·구조만 담당).
 */
import { DM_COLOR_TOKENS } from './dm-tokens';
// ★ 2026-07-14 디자인 4.0 M2 — 타입스케일·밀도·톤 기본의 소유가 design-core로 이동(값 무변 이관).
import { CORE_TYPE_SCALE, CORE_DENSITY_SCALE, CORE_TONE_DEFAULTS } from '../design-core/art-direction';
import { sansSafeDisplayStack } from '../design-core/fonts';

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
  // ★ 2026-07-13 디자인 3.0 — 필름 그레인 질감(테마 옵션)
  grain?: boolean;
};

// 섹션별 허용 구도. ★ 2026-07-13 디자인 3.0 — 4섹션 → 10섹션 확장 (미등재 섹션은 classic만).
//   SSOT: frontend/src/utils/dm-treatment.ts DM_TREATMENTS + DmRightPanel TREATMENT_OPTIONS 동기 수정 필수.
export const TREATMENTS: Record<string, readonly string[]> = {
  hero: ['classic', 'full_bleed', 'split', 'typographic', 'editorial_overlap'],
  text_card: ['classic', 'lead', 'framed', 'quote'],
  cta: ['classic', 'bar', 'ghost', 'sticky'],
  coupon: ['classic', 'ticket', 'spotlight'],
  product_carousel: ['classic', 'focus', 'list'],
  gallery: ['classic', 'mosaic'],
  reviews: ['classic', 'quote'],
  countdown: ['classic', 'banner'],
  promo_code: ['classic', 'light'],
  store_info: ['classic', 'card'],
};

/**
 * ★ 2026-09-04 (임은지 접수) CTA "버튼 배치"(가로/세로)가 **실제로 효과를 내는 구도**.
 *
 * 배치는 여러 버튼을 늘어놓는 규칙이라, 버튼을 한 줄로 쌓는 구도에서만 의미가 있다.
 *   · `classic`·`ghost` = 버튼 전부를 한 묶음으로 그린다 → 배치가 산다
 *   · `bar`   = 첫 버튼이 단독 강조 바이고 나머지가 목록인데, 편집기 상한이 버튼 2개라
 *               보조 버튼이 최대 1개다 → 늘어놓을 것이 없다
 *   · `sticky`= 첫 버튼 하나만 그린다 → 배치 개념 자체가 없다
 *
 * 종전엔 `renderCtaClassic`만 `layout`을 읽어, ghost에서 가로를 골라도 세로로 나갔다
 * (실사용 구도 분포는 bar·sticky·ghost가 다수이고 classic이 소수였다).
 * **판정을 여기 하나가 소유한다** — 렌더러·캔버스·편집기가 각자 조건을 쓰면 또 한쪽만 고쳐진다.
 * 프론트 미러 = `frontend/src/utils/dm-treatment.ts`(같은 값·같은 함수. 교차 일치는 계약 테스트가 고정).
 */
export const CTA_LAYOUT_TREATMENTS: readonly string[] = ['classic', 'ghost'];

/** 이 구도·버튼 수에서 배치 선택이 출력을 바꾸는가. false면 편집기가 컨트롤을 감춘다(죽은 컨트롤 금지). */
export function ctaLayoutApplies(treatment: string | undefined, buttonCount: number): boolean {
  return CTA_LAYOUT_TREATMENTS.includes(treatment || 'classic') && buttonCount >= 2;
}

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
// ★ 2026-07-14 디자인 4.0 M2 — 소유 = design-core (값 무변 이관)
const TONE_DEFAULTS = CORE_TONE_DEFAULTS;

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
    grain: raw?.grain === true,
  };
}

// ★ 2026-07-14 디자인 4.0 M2 — 소유 = design-core CORE_TYPE_SCALE·CORE_DENSITY_SCALE (값 무변 이관,
//   M0 골든 스냅샷이 출력 불변을 고정). emailH2는 이메일 가지 전용이라 여기선 미소비.
const TYPE_SCALE_VARS: Record<TypeScale, { hero: string; heroWeight: string; heroLs: string; h1: string }> = {
  editorial: CORE_TYPE_SCALE.editorial,
  bold:      CORE_TYPE_SCALE.bold,
  minimal:   CORE_TYPE_SCALE.minimal,
};
const DENSITY_SCALE: Record<SpacingDensity, string> = {
  compact: String(CORE_DENSITY_SCALE.compact),
  standard: String(CORE_DENSITY_SCALE.standard),
  airy: String(CORE_DENSITY_SCALE.airy),
};
const DISPLAY_FONT: Record<HeadlineFont, string> = {
  sans: 'var(--dm-font-primary)',
  serif: '"Noto Serif KR", var(--dm-font-primary)',
};

/** 아트디렉션 → 뷰어 :root override CSS(기존 토큰 다음에 주입돼 우선).
 *  ★ 2026-07-13 — brandDisplayFont(브랜드킷 font_display) 지정 시 그것이 최우선, 없으면 headlineFont(serif/sans). */
export function artDirectionToCssVars(ad: ArtDirection, brandDisplayFont?: string): string {
  const t = TYPE_SCALE_VARS[ad.typeScale];
  // ★ 2026-07-13 (Codex 지적) — raw <style> 삽입 XSS 차단: 서체 문자열 무해화
  const safeDisplay = brandDisplayFont ? brandDisplayFont.replace(/[^\w\s,"'\-]/g, '').trim() : '';
  // ★ 2026-07-16 M5 궁서체 영구 종결 2겹째 — 브랜드 display 스택 꼬리 generic serif를 본문(sans) 변수로 교체
  const display = safeDisplay
    ? sansSafeDisplayStack(safeDisplay, 'var(--dm-font-primary)')
    : DISPLAY_FONT[ad.headlineFont];
  return `:root{`
    + `--dm-fs-hero:${t.hero};--dm-fw-hero:${t.heroWeight};--dm-ls-hero:${t.heroLs};--dm-fs-h1:${t.h1};`
    + `--dm-section-pad-scale:${DENSITY_SCALE[ad.spacingDensity]};`
    + `--dm-font-display:${display};`
    + `}`;
}
