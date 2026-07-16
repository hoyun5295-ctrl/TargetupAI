import { describe, it, expect } from 'vitest';
import { renderSection } from './dm-section-renderer';
import type { Section } from './dm-section-registry';

function hero(extra: Partial<Section> = {}): Section {
  return { id: 's1', type: 'hero', order: 0, visible: true, props: { headline: '신상품', sub_copy: '지금' }, ...extra } as Section;
}

describe('dm treatment render — hero', () => {
  it('classic(미설정) = data-treatment 미부착(byte 불변) + 헤드라인 보존', () => {
    const html = renderSection(hero(), {});
    expect(html).toContain('data-section-type="hero"');
    expect(html).toContain('신상품');
    expect(html).not.toContain('data-treatment=');
  });

  it('typographic = data-treatment 부착 + 대형 헤드라인 변수 사용', () => {
    const html = renderSection(hero({ treatment: 'typographic' }), {});
    expect(html).toContain('data-treatment="typographic"');
    expect(html).toContain('신상품');
    expect(html).toContain('var(--dm-fs-hero)');
  });

  it('full_bleed / split / editorial_overlap = 각 data-treatment 부착', () => {
    for (const t of ['full_bleed', 'split', 'editorial_overlap']) {
      const html = renderSection(hero({ treatment: t }), {});
      expect(html).toContain(`data-treatment="${t}"`);
      expect(html).toContain('data-section-type="hero"');
    }
  });

  it('미허용 treatment → classic 폴백(data-treatment 미부착)', () => {
    const html = renderSection(hero({ treatment: 'nope' }), {});
    expect(html).toContain('data-section-type="hero"');
    expect(html).not.toContain('data-treatment=');
  });

  it('입력 escape 유지(XSS)', () => {
    const html = renderSection(hero({ props: { headline: '<script>' } as any }), {});
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('숨김 섹션(visible=false)은 빈 문자열', () => {
    expect(renderSection(hero({ visible: false }), {})).toBe('');
  });
});

function sec(type: any, props: any, treatment?: string): Section {
  return { id: 's1', type, order: 0, visible: true, props, ...(treatment ? { treatment } : {}) } as Section;
}

describe('dm treatment render — coupon/text_card/cta', () => {
  it('coupon ticket/spotlight = data-treatment 부착 + 코드 보존', () => {
    for (const t of ['ticket', 'spotlight']) {
      const html = renderSection(sec('coupon', { discount_label: '30% 할인', coupon_code: 'SAVE30' }, t), {});
      expect(html).toContain(`data-treatment="${t}"`);
      expect(html).toContain('SAVE30');
    }
  });
  it('coupon classic = data-treatment 미부착', () => {
    const html = renderSection(sec('coupon', { discount_label: '30%', coupon_code: 'X' }), {});
    expect(html).not.toContain('data-treatment=');
  });
  it('text_card lead/framed = data-treatment 부착 + 본문 보존', () => {
    for (const t of ['lead', 'framed']) {
      const html = renderSection(sec('text_card', { headline: '제목', body: '본문내용' }, t), {});
      expect(html).toContain(`data-treatment="${t}"`);
      expect(html).toContain('본문내용');
    }
  });
  it('cta bar/ghost = data-treatment 부착 + 라벨 보존', () => {
    for (const t of ['bar', 'ghost']) {
      const html = renderSection(sec('cta', { buttons: [{ label: '구매하기', url: 'https://x.com' }] }, t), {});
      expect(html).toContain(`data-treatment="${t}"`);
      expect(html).toContain('구매하기');
    }
  });
  it('coupon/text_card/cta 입력 escape', () => {
    const c = renderSection(sec('coupon', { discount_label: '<b>', coupon_code: '<i>' }, 'spotlight'), {});
    expect(c).not.toContain('<b>');
    expect(c).not.toContain('<i>');
  });
});

// ★ 2026-07-16 서수란 재오픈 재발 방지 게이트 —
//   "색 지정이 기본 2열 구도에서만 먹는다"의 근본(구도별 소비 누락) 차단.
//   상품슬라이드 배경색·글씨공간 색·이미지 높이는 3개 구도(classic/focus/list) 전부에서 소비돼야 한다.
//   한 구도라도 하드코딩(var(--dm-bg))으로 무시하면 이 테스트가 pre-push 훅에서 push를 막는다.
describe('dm treatment render — product_carousel 구도별 색/높이 소비 게이트', () => {
  const products = [
    { image_url: 'https://cdn.example.com/a.jpg', name: '상품 A', price: 10000 },
    { image_url: 'https://cdn.example.com/b.jpg', name: '상품 B', price: 20000, discount_price: 15000 },
    { image_url: 'https://cdn.example.com/c.jpg', name: '상품 C', price: 30000 },
  ];
  const TREATMENTS: Array<[string, string | undefined]> = [
    ['classic(기본 2열)', undefined],
    ['focus(첫 상품 대형)', 'focus'],
    ['list(리스트)', 'list'],
  ];

  for (const [label, treatment] of TREATMENTS) {
    it(`${label} 구도 = background_color + caption_bg_color 소비`, () => {
      const html = renderSection(
        sec('product_carousel', { products, caption_bg_color: '#abcdef', background_color: '#123456' }, treatment),
        {},
      );
      expect(html.includes('#abcdef'), `${label}: 글씨공간 색(caption_bg_color) 미소비 — 카드 배경 하드코딩 의심`).toBe(true);
      expect(html.includes('#123456'), `${label}: 배경색(background_color) 미소비 — 섹션 배경 하드코딩 의심`).toBe(true);
    });
  }

  for (const [label, treatment] of TREATMENTS) {
    it(`${label} 구도 = image_height(lg) 반영`, () => {
      const smHtml = renderSection(sec('product_carousel', { products, image_height: 'sm' }, treatment), {});
      const lgHtml = renderSection(sec('product_carousel', { products, image_height: 'lg' }, treatment), {});
      // sm↔lg 높이 토큰이 실제로 달라야 한다(구도가 image_height를 소비한다는 증거).
      const heights = (h: string) => (h.match(/height:\d+px/g) || []).join('|');
      expect(heights(smHtml) !== heights(lgHtml), `${label}: image_height 미반영 — 이미지 높이 하드코딩 의심`).toBe(true);
    });
  }
});
