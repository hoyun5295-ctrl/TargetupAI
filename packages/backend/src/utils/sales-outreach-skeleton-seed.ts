/**
 * sales-outreach-skeleton-seed.ts — AI 영업 내장 참조 골격 (2026-09-03)
 *
 * 직원 실물 DM 10건(임은지 5 · 남지현 5 · 0903 실측 · 설계서 §5-2)의 **섹션 타입 순서**를 코드에 내장한다.
 * 베스트 구성에서 승격·서빙을 켜기 전에도 AI 영업 DM이 실물 골격으로 만들어지게 하는 폴백이다.
 *   - DB 골격(serving on)이 있으면 그것이 우선한다(pickOutreachStructure).
 *   - 여기에는 타입 순서만 있다. 문구·이미지·브랜드명 0(불변 1·2).
 */
import { appendChains, emptySkeletonMeta, type SkeletonChain, type SkeletonMeta } from './dm/dm-structure-resolve';
import type { SectionType } from './dm/dm-section-registry';

const seq = (s: string): SectionType[] => s.split('>') as SectionType[];

const SEED_ROWS: Array<[string, string, 'media' | 'catalog']> = [
  ['A', 'header>video>countdown>product_carousel>reviews>gallery>tab_cards>product_carousel>text_card>slideshow>instant_coupon>footer', 'media'],
  ['B', 'header>hero>slideshow>cta>gallery>countdown>youtube_embed>gallery>promo_code>instagram_embed', 'media'],
  ['C', 'header>hero>product_carousel>youtube_embed>cta>slideshow>text_card>gallery>slideshow>sns', 'media'],
  ['D', 'header>slideshow>product_carousel>tab_cards>youtube_embed>countdown>product_carousel>cta>sns', 'media'],
  ['E', 'header>youtube_embed>hero>product_carousel>product_carousel>coupon>countdown>slideshow>cta>gallery>gallery>store_info', 'media'],
  ['F', 'header>hero>cta>gallery>product_carousel>cta>footer', 'catalog'],
  ['G', 'header>hero>cta>product_carousel>product_carousel>gallery>gallery>cta>countdown>footer', 'catalog'],
  ['H', 'header>hero>cta>product_carousel>hero>product_carousel>cta>cta>cta>footer', 'catalog'],
  ['I', 'header>coupon>product_carousel>cta>product_carousel>gallery>cta>gallery>cta>countdown>footer', 'catalog'],
  ['J', 'header>hero>slideshow>product_carousel>product_carousel>product_carousel>gallery>cta>gallery>footer', 'catalog'],
];

const SEED_CHAINS: SkeletonChain[] = SEED_ROWS.map(([key, s, type]) => ({
  seq: seq(s),
  author_type: type,
  author_type_source: 'auto',
  src: 'human_edited',
  ref: { kind: 'dm', id: `seed-0903-${key}`, promoted_at: '2026-09-03T00:00:00.000Z', promoted_by: null },
}));

export const OUTREACH_SEED_SKELETON_ID = 'builtin-0903';

/** 내장 골격 — chains 10 + 통계. 매 호출마다 새 객체(호출부가 변형해도 원본 불변). */
export function outreachSeedSkeleton(): SkeletonMeta {
  return appendChains(emptySkeletonMeta(), SEED_CHAINS).meta;
}
