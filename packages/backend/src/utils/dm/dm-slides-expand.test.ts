import { describe, test, expect } from 'vitest';
import { expandSlidePagesForSwipe } from './dm-slides-expand';

describe('expandSlidePagesForSwipe — 슬라이드 모드: 이미지 N장을 각 1페이지로 펼침(가로 스와이프)', () => {
  test('1페이지 갤러리 4장 → 4페이지(각 1장, 원본 비율 풀폭 list_1xN)', () => {
    const pages = [
      { id: 'p1', sections: [{ id: 'g1', type: 'gallery', order: 0, props: { images: [{ url: 'a.jpg' }, { url: 'b.jpg' }, { url: 'c.jpg' }, { url: 'd.jpg' }], layout: 'list_1xN' } }] },
    ];
    const out = expandSlidePagesForSwipe(pages);
    expect(out.length).toBe(4);
    expect(out[0].sections[0].type).toBe('gallery');
    expect(out[0].sections[0].props.images).toEqual([{ url: 'a.jpg', caption: undefined }]);
    expect(out[3].sections[0].props.images[0].url).toBe('d.jpg');
    expect(out[0].sections[0].props.layout).toBe('list_1xN');
  });

  test('이미 이미지당 1페이지(좌우 슬라이드 업로드)면 변화 없음(원본 반환)', () => {
    const pages = [
      { id: 'p1', sections: [{ id: 'g1', type: 'gallery', order: 0, props: { images: [{ url: 'a.jpg' }], layout: 'list_1xN' } }] },
      { id: 'p2', sections: [{ id: 'g2', type: 'gallery', order: 0, props: { images: [{ url: 'b.jpg' }], layout: 'list_1xN' } }] },
    ];
    const out = expandSlidePagesForSwipe(pages);
    expect(out.length).toBe(2);
    expect(out).toBe(pages);
  });

  test('슬라이드쇼 슬라이드 3장 → 3페이지 갤러리(image_url·caption 보존)', () => {
    const pages = [
      { id: 'p1', sections: [{ id: 's1', type: 'slideshow', order: 0, props: { slides: [{ image_url: 'x.jpg', caption: '첫장' }, { image_url: 'y.jpg' }, { image_url: 'z.jpg' }] } }] },
    ];
    const out = expandSlidePagesForSwipe(pages);
    expect(out.length).toBe(3);
    expect(out[0].sections[0].type).toBe('gallery');
    expect(out[0].sections[0].props.images[0].url).toBe('x.jpg');
    expect(out[0].sections[0].props.images[0].caption).toBe('첫장');
    expect(out[2].sections[0].props.images[0].url).toBe('z.jpg');
  });

  test('header+gallery 혼합 페이지는 펼치지 않음(이미지 전용 아님)', () => {
    const pages = [
      { id: 'p1', sections: [{ id: 'h1', type: 'header', order: 0, props: {} }, { id: 'g1', type: 'gallery', order: 1, props: { images: [{ url: 'a.jpg' }, { url: 'b.jpg' }], layout: 'list_1xN' } }] },
    ];
    const out = expandSlidePagesForSwipe(pages);
    expect(out.length).toBe(1);
    expect(out).toBe(pages);
  });

  test('빈 입력/빈 갤러리는 그대로', () => {
    expect(expandSlidePagesForSwipe([])).toEqual([]);
    const empty = [{ id: 'p1', sections: [{ id: 'g1', type: 'gallery', order: 0, props: { images: [], layout: 'list_1xN' } }] }];
    expect(expandSlidePagesForSwipe(empty)).toBe(empty);
  });
});
