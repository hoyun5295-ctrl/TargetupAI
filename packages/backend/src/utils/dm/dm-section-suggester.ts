/**
 * CT-89 — dm-section-suggester.ts
 *
 * D216+ 모바일DM 강화 — 작성 중 DM → 다음 섹션 자동 추천 (Notion 동급 직접 흐름).
 *
 * 규칙 기반 매트릭스 + 회사 메모리 보조 추천.
 *
 * 호출 영역: routes/dm.ts GET /:id/section-suggest
 */

import { query } from '../../config/database';
import type { SectionType } from './dm-section-registry';

// ────────────── 타입 ──────────────

export interface SectionSuggestion {
  next_section_type: SectionType;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

// ────────────── 규칙 기반 매트릭스 ──────────────

const NEXT_SECTION_RULES: Record<SectionType, SectionType[]> = {
  // 옛 11
  header: ['hero', 'product_carousel', 'countdown'],
  hero: ['product_carousel', 'text_card', 'cta', 'gallery'],
  coupon: ['cta', 'text_card', 'instant_coupon'],
  countdown: ['hero', 'cta', 'instant_coupon'],
  text_card: ['cta', 'product_carousel', 'gallery'],
  cta: ['footer', 'sns', 'store_info'],
  video: ['text_card', 'cta'],
  store_info: ['sns', 'footer'],
  sns: ['footer'],
  promo_code: ['cta', 'footer'],
  footer: [],
  // D216+ 신규 16
  product_carousel: ['cta', 'reviews', 'gallery'],
  gallery: ['cta', 'text_card'],
  slideshow: ['cta', 'text_card'],
  tab_cards: ['cta', 'product_carousel'],
  poll: ['cta', 'text_card'],
  survey: ['cta', 'footer'],
  email_capture: ['cta', 'footer'],
  click_rewards: ['cta', 'footer'],
  lucky_draw: ['cta', 'footer'],
  roulette: ['cta', 'footer'],
  instant_coupon: ['cta', 'footer'],
  limited_quantity: ['cta', 'footer'],
  youtube_embed: ['text_card', 'cta'],
  instagram_embed: ['cta'],
  map_store_locator: ['store_info', 'sns', 'footer'],
  reviews: ['cta', 'footer'],
};

// ────────────── 재사용 가능 섹션 (이미 존재해도 추가 허용) ──────────────

const REUSABLE_TYPES: SectionType[] = ['cta', 'text_card', 'product_carousel'];

// ────────────── 헬퍼 ──────────────

function parseJson<T = any>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

// ────────────── 메인 함수 ──────────────

export async function suggestNextSection(
  _companyId: string,
  campaignId: string,
): Promise<SectionSuggestion[]> {
  const result = await query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections: any[] = parseJson(result.rows[0]?.sections) || [];

  if (sections.length === 0) {
    return [
      { next_section_type: 'header', reason: '모든 DM은 헤더부터 시작', confidence: 'high' },
    ];
  }

  const lastSection = sections[sections.length - 1];
  const lastType = lastSection?.type as SectionType;
  const ruleCandidates = NEXT_SECTION_RULES[lastType] || [];

  const existingTypes = new Set<SectionType>(sections.map((s: any) => s?.type as SectionType));
  const filteredCandidates = ruleCandidates.filter(
    (t) => !existingTypes.has(t) || REUSABLE_TYPES.includes(t),
  );

  if (filteredCandidates.length === 0) {
    if (!existingTypes.has('footer')) {
      return [{ next_section_type: 'footer', reason: '마무리 영역 (푸터)', confidence: 'medium' }];
    }
    return [];
  }

  const suggestions: SectionSuggestion[] = filteredCandidates.slice(0, 3).map((type, idx) => ({
    next_section_type: type,
    reason: `${lastType} 다음 직접 흐름 추천`,
    confidence: idx === 0 ? 'high' : idx === 1 ? 'medium' : 'low',
  }));

  return suggestions;
}
