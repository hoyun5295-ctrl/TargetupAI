/**
 * dm-visual-direction.ts — AI 비주얼 컨셉 정규화·적용·무드 배경 (순수, DB import 0)
 *
 * AI 아트 디렉터(dm-ai.designVisualConcept)가 만든 비주얼 컨셉을 안전하게 정규화하고,
 * 섹션에 색·무드를 입힌다. 사진이 없어도 브랜드/업종 색 그라데이션으로 완성형이 되게 한다.
 *
 * 영구 룰: 색·무드만 다룬다. 혜택/상품/가격 등 텍스트 props는 절대 건드리지 않는다.
 */
import { DM_COLOR_TOKENS, getContrastRatio } from './dm-tokens';
import type { Section } from './dm-section-registry';

export type VisualConcept = {
  palette: { primary: string; accent: string; surface: string; on_surface: string };
  mood: string;
  hero_treatment: 'gradient' | 'color_block' | 'image';
  emphasis_sections: string[];
  type_scale: 'bold' | 'editorial' | 'minimal';
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

/** 배경색 위에서 가독성이 높은 글자색(흰/진검정)을 WCAG 대비로 선택. */
export function pickReadableText(bgHex: string): string {
  const dark = '#111111';
  const light = '#ffffff';
  return getContrastRatio(light, bgHex) >= getContrastRatio(dark, bgHex) ? light : dark;
}

type IndustryKey = keyof typeof DM_COLOR_TOKENS.industry;
function industryColors(industry: string): { primary: string; accent: string } {
  const k = industry as IndustryKey;
  return DM_COLOR_TOKENS.industry[k] || { primary: DM_COLOR_TOKENS.brand.primary, accent: DM_COLOR_TOKENS.brand.accent };
}

/** AI가 만든 컨셉(부분/불량 가능)을 안전 기본값으로 정규화. 누락·잘못된 hex는 업종 색으로. */
export function normalizeVisualConcept(raw: (Partial<VisualConcept> & { palette?: any }) | null | undefined, industry: string): VisualConcept {
  const ind = industryColors(industry);
  const primary = safeHex(raw?.palette?.primary, ind.primary);
  const accent = safeHex(raw?.palette?.accent, ind.accent);
  const surface = safeHex(raw?.palette?.surface, DM_COLOR_TOKENS.neutral[0]);
  const on_surface = safeHex(raw?.palette?.on_surface, pickReadableText(surface));
  const treatment = (['gradient', 'color_block', 'image'] as const).includes(raw?.hero_treatment as any)
    ? (raw!.hero_treatment as VisualConcept['hero_treatment'])
    : 'gradient';
  const typeScale = (['bold', 'editorial', 'minimal'] as const).includes(raw?.type_scale as any)
    ? (raw!.type_scale as VisualConcept['type_scale'])
    : 'bold';
  return {
    palette: { primary, accent, surface, on_surface },
    mood: typeof raw?.mood === 'string' ? raw!.mood!.slice(0, 40) : '',
    hero_treatment: treatment,
    emphasis_sections: Array.isArray(raw?.emphasis_sections) ? raw!.emphasis_sections!.map(String).slice(0, 6) : [],
    type_scale: typeScale,
  };
}

/** 사진 없이도 완성형이 되는 브랜드 색 그라데이션. */
export function buildMoodBackground(palette: VisualConcept['palette'], _mood: string): string {
  return `linear-gradient(135deg, ${palette.primary} 0%, ${palette.accent} 100%)`;
}

/**
 * 컨셉을 섹션에 적용 — 색·무드만. 텍스트(혜택) props는 절대 불변.
 * 이미지 없는 hero에는 무드 배경을 주입해 휑함을 없앤다(이미지 있으면 원본 우선).
 */
export function applyVisualDirection(sections: Section[], concept: VisualConcept): Section[] {
  return sections.map((s) => {
    const next: any = { ...s, accent_color: s.accent_color || concept.palette.accent };
    const hasImage = !!(s.props as any)?.image_url;
    if (s.type === 'hero' && !hasImage && concept.hero_treatment !== 'image') {
      next.props = {
        ...(s.props as any),
        mood_background: buildMoodBackground(concept.palette, concept.mood),
        mood_text: pickReadableText(concept.palette.primary),
      };
    }
    return next as Section;
  });
}
