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
