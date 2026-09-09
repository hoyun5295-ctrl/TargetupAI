import { describe, it, expect } from 'vitest';
import { renderSection } from './dm-section-renderer';
import type { Section } from './dm-section-registry';

/**
 * ★ 2026-09-09 재료 축 v4 — 가격이 없는 상품(렌더 DOM 카드 · SPA 몰)은 가격 줄을 그리지 않는다.
 * 옛 출력은 `Number(price || 0)` 로 "0원" 을 찍었다(가격이 없는 것과 0원은 다르다). 가격이 있으면 옛 출력 그대로.
 */
const carousel = (products: unknown[], layout = 'grid'): Section => ({ id: 'pc1', type: 'product_carousel', order: 0, visible: true, props: { products, layout, title: '' } } as unknown as Section);

describe('DM 상품 캐러셀 — 가격 없음 = 가격 줄 0 · 있음 = 그대로', () => {
  it('price null(또는 0) · 할인 없음 → "원" 이 없다 · 이름·링크는 남는다', () => {
    for (const lay of ['grid', 'focus', 'list']) {
      const html = renderSection(carousel([{ name: '히알시카 수분진정 SET', image_url: 'https://cdn/1.png', price: null, link_url: 'https://shop/p/1' }, { name: '펩타이드 크림', image_url: 'https://cdn/2.png', price: 0 }], lay), {} as any);
      expect(html).toContain('히알시카 수분진정 SET');
      expect(html).toContain('https://shop/p/1');
      expect(html).not.toMatch(/원</);
    }
  });
  it('price 36000 · 할인 30600 → 15% · 30,600원 · 36,000원 그대로', () => {
    const html = renderSection(carousel([{ name: 'A', image_url: 'https://cdn/1.png', price: 36000, discount_price: 30600 }]), {} as any);
    expect(html).toContain('30,600원');
    expect(html).toContain('36,000원');
    expect(html).toContain('15%');
  });
  it('할인가만 있고 정가가 0 이면 할인가만', () => {
    const html = renderSection(carousel([{ name: 'A', image_url: 'https://cdn/1.png', price: 0, discount_price: 9900 }]), {} as any);
    expect(html).toContain('9,900원');
    // "0원" 단독(정가 0 취소선)이 없어야 한다 — "9,900원" 안의 "0원" 은 제외
    expect(html).not.toMatch(/[^0-9,]0원</);
    expect(html).not.toContain('line-through');
  });
});
