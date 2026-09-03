/**
 * dm-section-prune.test.ts — 빈 섹션 제거·페이지 재조립 계약 (2026-09-03)
 */
import { describe, it, expect } from 'vitest';
import { hasSectionData, pruneEmptyDmSections, rebuildDmPages } from '../dm/dm-section-prune';
import { outreachSeedSkeleton } from '../sales-outreach-skeleton-seed';
import type { Section } from '../dm/dm-section-registry';

const sec = (type: string, props: any = {}, i = 0): Section => ({ id: `s${i}-${type}`, type: type as any, order: i, visible: true, props } as Section);

describe('hasSectionData', () => {
  it('상품 없음·자리표시자 = 없음 / 상품명 있음 = 있음', () => {
    expect(hasSectionData(sec('product_carousel', { products: [] }))).toBe(false);
    expect(hasSectionData(sec('product_carousel', { products: [{ name: '[상품을 추가해주세요]' }] }))).toBe(false);
    expect(hasSectionData(sec('product_carousel', { products: [{ name: '선케어 세트', price: 0 }] }))).toBe(true);
  });
  it('이미지·슬라이드·기간·코드·매장·sns·탭', () => {
    expect(hasSectionData(sec('gallery', { images: [{ url: '' }] }))).toBe(false);
    expect(hasSectionData(sec('gallery', { images: [{ url: 'https://x/a.jpg' }] }))).toBe(true);
    expect(hasSectionData(sec('slideshow', { slides: [] }))).toBe(false);
    expect(hasSectionData(sec('countdown', { end_datetime: '' }))).toBe(false);
    expect(hasSectionData(sec('countdown', { end_datetime: '2026-09-30T23:59:59+09:00' }))).toBe(true);
    expect(hasSectionData(sec('coupon', { discount_label: '[직접 작성해주세요]' }))).toBe(false);
    expect(hasSectionData(sec('promo_code', { code: '' }))).toBe(false);
    expect(hasSectionData(sec('store_info', {}))).toBe(false);
    expect(hasSectionData(sec('sns', { channels: [] }))).toBe(false);
    expect(hasSectionData(sec('tab_cards', { tabs: [{ content: '[직접 작성해주세요]' }] }))).toBe(false);
  });
  it('규칙이 없는 타입은 보존', () => {
    expect(hasSectionData(sec('poll', {}))).toBe(true);
    expect(hasSectionData(sec('reviews', {}))).toBe(true);
  });
});

describe('pruneEmptyDmSections · rebuildDmPages', () => {
  it('빈 상품·갤러리만 빠지고 header/hero/text_card/cta/footer는 남는다 · order 재부여 · pages 재조립', () => {
    const input: Section[] = [
      sec('header', { brand_name: '토니모리' }, 0),
      sec('hero', { headline: '가을 뷰티 소식' }, 1),
      sec('product_carousel', { products: [] }, 2),
      sec('product_carousel', { products: [] }, 3),
      sec('text_card', { body: '안내' }, 4),
      sec('gallery', { images: [] }, 5),
      sec('cta', { buttons: [{ label: '자세히 보기', url: '' }] }, 6),
      sec('footer', {}, 7),
    ];
    const r = pruneEmptyDmSections(input);
    expect(r.sections.map((s) => s.type)).toEqual(['header', 'hero', 'text_card', 'cta', 'footer']);
    expect(r.removed.sort()).toEqual(['gallery', 'product_carousel']);
    for (const s of r.sections) expect(input).toContain(s);
    const rebuilt = rebuildDmPages(r.sections);
    expect(rebuilt.sections.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
    expect(rebuilt.pages.flat().length).toBe(5);
    expect(['scroll', 'slides', 'scroll_snap']).toContain(rebuilt.layoutMode);
  });
});

describe('outreachSeedSkeleton', () => {
  it('실물 10건 · 유형 5:5 · 문구·URL 0', () => {
    const meta = outreachSeedSkeleton();
    expect(meta.chains.length).toBe(10);
    expect(meta.stats.by_type).toEqual({ media: 5, catalog: 5 });
    expect(JSON.stringify(meta)).not.toMatch(/https?:|유니클로|무신사|조선미녀/);
    expect(meta.serving.enabled).toBe(false);
  });
});
