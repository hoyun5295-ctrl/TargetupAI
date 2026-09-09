import { describe, it, expect } from 'vitest';
import { renderEmailSections } from '../email-section-renderer';
import type { Section } from '../../dm/dm-section-registry';

/**
 * ★ 2026-09-09 재료 축 v4 — 이메일 상품 캐러셀도 가격이 없으면 가격 줄을 비운다(DM 과 짝 · 옛 출력은 "0원"·"NaN원").
 */
const carousel = (products: unknown[], layout = 'grid'): Section => ({ id: 'pc1', type: 'product_carousel', order: 0, visible: true, props: { products, layout, title: '' } } as unknown as Section);

describe('이메일 상품 캐러셀 — 가격 없음 = 가격 줄 0', () => {
  it('price null · 할인 없음 → "원" 없음 · 이름·링크 유지', () => {
    for (const lay of ['grid', 'focus', 'list']) {
      const html = renderEmailSections([carousel([{ name: '히알시카 수분진정 SET', image_url: 'https://cdn/1.png', price: null, link_url: 'https://shop/p/1' }, { name: 'B', image_url: 'https://cdn/2.png', price: null }], lay)], {});
      expect(html).toContain('히알시카 수분진정 SET');
      expect(html).toContain('https://shop/p/1');
      expect(html).not.toMatch(/원</);
      expect(html).not.toContain('NaN');
    }
  });
  it('가격 있으면 그대로 · 할인가 + 정가 취소선', () => {
    const html = renderEmailSections([carousel([{ name: 'A', image_url: 'https://cdn/1.png', price: 36000, discount_price: 30600 }])], {});
    expect(html).toContain('30,600원');
    expect(html).toContain('36,000원');
  });
});
