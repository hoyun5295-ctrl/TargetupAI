/**
 * dm-treatment.ts — 섹션 구도(treatment) 선택 (프론트 캔버스용)
 *
 * 백엔드 utils/dm/dm-art-direction.ts TREATMENTS/selectTreatment 미러.
 * 편집 캔버스가 발행 SSR과 동일한 구도를 그리도록, 사용자가 명시 선택한 treatment를 검증해 반환한다.
 * (캔버스엔 DM 단위 artDirection.typeScale이 없어 editorial 자동기본 분기는 생략 — 그 분기는
 *  artDirection이 설정된 DM에서만 SSR에 발생하고, 명시 선택 구도는 여기서 100% 일치한다.)
 */
// ★ 2026-07-13 디자인 3.0 — 4섹션 → 10섹션 확장 (backend dm-art-direction.TREATMENTS 미러)
export const DM_TREATMENTS: Record<string, readonly string[]> = {
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

/** 요청 treatment가 해당 섹션 허용표에 있으면 그대로, 아니면 classic. */
export function selectTreatment(sectionType: string, requested?: string | null): string {
  const allowed = DM_TREATMENTS[sectionType];
  if (!allowed) return 'classic';
  if (requested && allowed.includes(requested)) return requested;
  return 'classic';
}
