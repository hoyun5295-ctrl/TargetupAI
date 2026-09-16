/**
 * 카탈로그 쪽 상품 칩 계약 (★ 2026-09-16 설계서 §5-3).
 *
 *  - 가격·링크는 이미지에 새기지 않고 이미지 **밖** 칩으로 나온다.
 *  - 칩이 붙어도 쪽 자격(갤러리 1섹션·list_1xN·이미지 1장)은 그대로다 → PC 책 펼침 유지.
 *  - 칩이 없으면 발행 HTML 이 종전과 같다(빈 문자열).
 */
import { describe, it, expect } from 'vitest';
import { renderDmViewerHtml } from './dm-viewer';
import { isSwipeImagePage } from './dm-slides-expand';
import { isCatalogDm } from './dm-viewer-catalog';
import { DM_GALLERY_CHIP_MARKER } from './dm-property-contract';

const page = (i: number, chips?: any[]) => ({
  id: 'p' + i,
  sections: [{
    id: 's' + i, type: 'gallery', order: 0, visible: true,
    props: { images: [{ url: '/api/dm/v/images/c1/p' + i + '.jpg' }], layout: 'list_1xN', full_bleed: true, ...(chips ? { chips } : {}) },
  }],
});
const dm = (pages: any[]) => ({
  id: 'd1', title: '카탈로그', short_code: 'abc123', layout_mode: 'slides',
  pages, sections: [], brand_kit: null, settings: { catalog: true },
});

describe('카탈로그 쪽 상품 칩', () => {
  const chips = [
    { label: '캐시미어 코트', price: '129,000원', url: 'https://shop.example.invalid/p/1' },
    { label: '데일리 머플러', price: '39,000원' },
  ];

  it('칩이 없으면 발행 HTML 에 칩 흔적이 없다', () => {
    const html = renderDmViewerHtml(dm([page(1), page(2)]), 'https://hanjul.ai/api/dm');
    expect(html).not.toContain(DM_GALLERY_CHIP_MARKER);
    expect(html).not.toContain('dm-gal-chips');
  });

  it('칩은 이미지 밖 글자로 나온다 (이름·가격·링크)', () => {
    const html = renderDmViewerHtml(dm([page(1, chips), page(2)]), 'https://hanjul.ai/api/dm');
    expect(html).toContain(DM_GALLERY_CHIP_MARKER);
    expect(html).toContain('캐시미어 코트');
    expect(html).toContain('129,000원');
    expect(html).toContain('href="https://shop.example.invalid/p/1"');
    // 주소가 없는 칩은 링크가 아니라 글자만
    expect(html).toContain('<span data-dm-chip');
  });

  it('칩이 붙어도 쪽 자격(책 펼침)이 유지된다', () => {
    const pages = [page(1, chips), page(2, chips)] as any;
    expect(isSwipeImagePage(pages[0])).toBe(true);
    expect(isCatalogDm(pages)).toBe(true);
  });

  it('빈 이름 칩은 그리지 않고, 최대 4개까지만 낸다', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ label: '상품' + i }));
    const html = renderDmViewerHtml(dm([page(1, [{ label: '  ' }, ...many]), page(2)]), 'https://hanjul.ai/api/dm');
    const count = html.split(DM_GALLERY_CHIP_MARKER).length - 1;
    expect(count).toBeLessThanOrEqual(4);
    expect(count).toBeGreaterThan(0);
  });

  it('칩 주소도 안전 검사를 지난다 (javascript: 는 링크가 되지 않는다)', () => {
    const html = renderDmViewerHtml(dm([page(1, [{ label: '위험', url: 'javascript:alert(1)' }]), page(2)]), 'https://hanjul.ai/api/dm');
    expect(html).not.toContain('javascript:alert');
  });
});
