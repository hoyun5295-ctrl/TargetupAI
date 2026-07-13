/**
 * email-blocks.ts — 이메일 렌더 가능 블록 화이트리스트 (단일 진실원)
 *
 * DM 섹션 27종 중 이메일 클라이언트에서 정적으로 안전 렌더되는 것만 노출한다.
 * 에디터(블록 추가 메뉴)·렌더러·AI 생성 셋이 이 상수만 소비한다(인라인 판정 금지).
 * "보이면 작동" 불변식 — 이 집합 밖 블록은 렌더 0(깨진 HTML 차단).
 */
import type { Section, SectionType } from '../dm/dm-section-registry';
import type { ExtractedEventProduct } from '../event-brief';

// 이메일에서 정적으로 안전 렌더되는 블록.
export const EMAIL_BLOCK_WHITELIST: readonly SectionType[] = [
  'header', 'hero', 'text_card', 'cta', 'coupon', 'promo_code',
  'product_carousel', 'gallery', 'store_info', 'sns', 'reviews', 'footer',
] as const;

// 비호환(인터랙티브/JS/임베드) → 'static': 정적 요약 렌더 / 'skip': 렌더 0(메뉴에서도 제외)
export const EMAIL_INCOMPATIBLE: Record<string, 'static' | 'skip'> = {
  countdown: 'static',          // D-day 텍스트만
  video: 'static',              // 썸네일 + 링크
  youtube_embed: 'static',      // 썸네일 + 링크
  instagram_embed: 'static',    // 링크
  map_store_locator: 'static',  // 주소 텍스트
  tab_cards: 'static',
  slideshow: 'static',
  poll: 'skip',
  survey: 'skip',
  email_capture: 'skip',
  click_rewards: 'skip',
  lucky_draw: 'skip',
  roulette: 'skip',
  instant_coupon: 'skip',
  limited_quantity: 'skip',
};

/** 이메일에서 어떤 형태로든 렌더되는 블록인지(화이트리스트 또는 정적 대체). */
export function isEmailRenderable(type: string): boolean {
  return (EMAIL_BLOCK_WHITELIST as readonly string[]).includes(type) || EMAIL_INCOMPATIBLE[type] === 'static';
}

/**
 * ★ 2026-07-13 디자인 3.0 — 이메일 안전 구도(treatment) 허용표 (단일 진실).
 * DM TREATMENTS의 이메일 클라이언트 안전 부분집합 — 렌더러·에디터 픽커·골든 템플릿 셋이 이것만 소비.
 * 미등재 섹션/미허용 값 = classic (fail-closed — 깨진 조판 차단).
 * 이식 제외: sticky(고정 배치)·full_bleed(vh)·editorial_overlap(음수 마진)·mosaic — 이메일 렌더 제약.
 */
export const EMAIL_TREATMENTS: Record<string, readonly string[]> = {
  hero: ['classic', 'split', 'typographic'],
  text_card: ['classic', 'lead', 'framed', 'quote'],
  cta: ['classic', 'bar', 'ghost'],
  coupon: ['classic', 'spotlight'],
  product_carousel: ['classic', 'focus', 'list'],
};

/** 요청 구도 검증 — 허용표에 있으면 그대로, 아니면 classic (DM selectTreatment 미러). */
export function selectEmailTreatment(sectionType: string, requested?: string): string {
  const allowed = EMAIL_TREATMENTS[sectionType];
  if (!allowed) return 'classic';
  return requested && allowed.includes(requested) ? requested : 'classic';
}

/** 이메일 배경면(섹션 리듬) 허용값 — DM dm-bgx-*의 bgcolor 치환판. glass 제외(클라이언트 제약). */
export const EMAIL_BACKGROUNDS: readonly string[] = ['none', 'soft', 'tint', 'dark', 'gradient'];

/**
 * ★ 2026-07-13 — 행사 원문 검증 통과 상품 → 이메일 product_carousel 항목 (순수).
 * link_url 보존(옛 map이 name/price만 담아 URL을 유실하던 결함의 단일 정정 지점) +
 * og:image 자동 채움(og 부재/실패 = 빈 값 유지 — 사용자가 직접 업로드). DM dm-ai one-shot 미러.
 */
export function buildCarouselProductsFromExtracted(
  extracted: ExtractedEventProduct[],
  ogImages: Array<string | undefined> = [],
): Array<Record<string, unknown>> {
  return (extracted || []).map((v, i) => ({
    id: `p-${i + 1}`,
    image_url: ogImages[i] || '',
    name: v.name,
    price: v.price,
    ...(v.discount_price ? { discount_price: v.discount_price } : {}),
    ...(v.discount_rate ? { discount_rate: v.discount_rate } : {}),
    ...(v.link_url ? { link_url: v.link_url } : {}),
  }));
}

/**
 * AI가 낸 blocks([{ type, props }]) → 검증된 email Section[].
 * 화이트리스트 밖 type은 제거(fail-closed) + id/order/visible 부여. 순수 함수(DB/AI 0).
 */
export function normalizeAiBlocksToSections(rawBlocks: unknown): Section[] {
  const blocks = Array.isArray(rawBlocks) ? rawBlocks : [];
  const out: Section[] = [];
  let order = 0;
  for (const raw of blocks) {
    const b = (raw && typeof raw === 'object') ? (raw as { type?: unknown; props?: unknown }) : {};
    const type = String(b.type || '');
    if (!(EMAIL_BLOCK_WHITELIST as readonly string[]).includes(type)) continue; // 화이트리스트만(보이면 작동 불변식)
    out.push({
      id: 'ai-' + order + '-' + type,
      type: type as SectionType,
      order,
      visible: true,
      props: (b.props && typeof b.props === 'object') ? (b.props as Section['props']) : ({} as Section['props']),
    } as Section);
    order++;
  }
  return out;
}
