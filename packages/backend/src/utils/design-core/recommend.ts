/**
 * ★ CT design-core/recommend.ts — 결정적 디자인 추천 통합 (디자인 4.0 M1, 2026-07-14)
 *
 * 3 생성기에 흩어져 있던 추천 상수의 단일 소유자. 전부 결정적 매핑 — 임의 산식 0.
 * 이관 원본(2026-07-14 실측):
 *   - tone → 테마 추천        : FE dm-themes recommendThemeIds (팔레트 recommendedTones 파생)
 *   - 이메일 템플릿 → 테마    : FE email-templates themeDesign 매핑 12종
 *   - 인앱 시나리오 → 카드 형태/구도 : BE inapp-ai-generator SCENARIO_CARD_STYLE·SCENARIO_TREATMENT
 *   - tone → 아트디렉션 기본  : art-direction.ts CORE_TONE_DEFAULTS (소유는 그 파일)
 */
import { CORE_PALETTES, type CorePaletteId, type CoreTone } from './palette';

/** tone → 추천 팔레트 id (결정적 — CORE_PALETTES.recommendedTones 파생) */
export function recommendPalettesForTone(tone?: string): CorePaletteId[] {
  if (!tone) return [];
  return CORE_PALETTES.filter((p) => p.recommendedTones.includes(tone as CoreTone)).map((p) => p.id);
}

/** 이메일 골든 템플릿 key → 테마 (FE email-templates와 M3 동기 테스트 대상) */
export const EMAIL_TEMPLATE_THEME: Record<string, CorePaletteId> = {
  'cart': 'minimal',
  'dormant': 'soft-pastel',
  'vip': 'luxury-dark',
  'new': 'editorial',
  'birthday': 'soft-pastel',
  'newsletter': 'editorial',
  'season-sale': 'bold-sale',
  'event-invite': 'festive',
  'restock': 'minimal',
  'review-showcase': 'paper',
  'membership': 'city-night',
  'store-open': 'paper',
};

/** 인앱 빠른 시작 시나리오 → 카드 형태 (대화 회복=말풍선 / 혜택=티켓 / 신상=포스터 / 포멀=클래식) */
export const INAPP_SCENARIO_CARD_STYLE: Record<string, string> = {
  cart_recovery: 'ticket',
  new_welcome: 'bubble',
  dormant_recovery: 'bubble',
  new_product: 'poster',
  vip_appreciation: 'classic',
  checkout_abandon: 'bubble',
  repeat_purchase: 'ticket',
};

/** 인앱 시나리오 → 구도 (허용표 밖 조합은 SDK fail-closed로 classic) */
export const INAPP_SCENARIO_TREATMENT: Partial<Record<string, string>> = {
  vip_appreciation: 'framed',
};
