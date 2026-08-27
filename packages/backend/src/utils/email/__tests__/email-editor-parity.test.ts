/**
 * 이메일 편집기 파리티 — "편집기에서 고를 수 있는데 발송 HTML엔 반영 안 됨"을 배포 전에 막는다.
 * `dm-editor-parity.test.ts`의 이메일 판. 근거표 = `email-property-contract.ts`.
 *
 * 소스 스캔이 아니라 **행동 테스트**다 — 값을 바꿔 렌더하고 출력이 실제로 달라지는지 밟는다
 * (LESSONS_BACKEND 2026-08-01 · 토큰 존재만 보는 검사는 조건 반전을 못 잡는다).
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections } from '../email-section-renderer';
import { EMAIL_PRODUCT_TREATMENTS, EMAIL_PRODUCT_IMG_HEIGHT, EMAIL_PRODUCT_LIST_THUMB, EMAIL_PRODUCT_CAROUSEL_PROPS, EMAIL_HERO_PROPS, EMAIL_HERO_IMAGE_TREATMENTS, EMAIL_HERO_HEIGHT, EMAIL_DESIGN_PROPS } from '../email-property-contract';
import type { Section } from '../../dm/dm-section-registry';

const PRODUCTS = [
  { image_url: 'https://x.example.com/a.jpg', name: '상품 A', price: 20000, discount_price: 15000, link_url: 'https://shop.example.com/a' },
  { image_url: 'https://x.example.com/b.jpg', name: '상품 B', price: 30000 },
  { image_url: 'https://x.example.com/c.jpg', name: '상품 C', price: 40000 },
];

const carousel = (props: Record<string, unknown>, treatment?: string): Section =>
  ({ id: 's-pc', type: 'product_carousel', order: 0, visible: true, treatment, props: { products: PRODUCTS, ...props } } as unknown as Section);

const render = (props: Record<string, unknown>, treatment?: string) =>
  renderEmailSections([carousel(props, treatment)], {});

describe('상품 슬라이드 — 편집기 속성이 이메일 발송 HTML에 반영된다', () => {
  for (const t of EMAIL_PRODUCT_TREATMENTS) {
    it(`[${t}] 글씨공간 색(caption_bg_color)이 출력에 실린다`, () => {
      expect(render({ caption_bg_color: '#e74b4b' }, t)).toContain('#e74b4b');
    });

    it(`[${t}] 배경색(background_color)이 출력에 실린다`, () => {
      expect(render({ background_color: '#f06060' }, t)).toContain('#f06060');
    });

    it(`[${t}] 이미지 맞춤(image_fit=contain)이 출력을 바꾼다`, () => {
      expect(render({ image_fit: 'contain' }, t)).toContain('object-fit:contain');
      expect(render({}, t)).not.toContain('object-fit:contain');
    });
  }

  it('[classic] 이미지 높이(image_height)가 출력 높이를 바꾼다 · md = 현행 200', () => {
    expect(render({ image_height: 'sm' })).toContain(`height:${EMAIL_PRODUCT_IMG_HEIGHT.sm}px`);
    expect(render({ image_height: 'lg' })).toContain(`height:${EMAIL_PRODUCT_IMG_HEIGHT.lg}px`);
    expect(render({})).toContain(`height:${EMAIL_PRODUCT_IMG_HEIGHT.md}px`);
  });

  it('[list] 썸네일 높이도 image_height를 따른다 · md = 현행 96', () => {
    expect(render({ image_height: 'sm' }, 'list')).toContain(`height:${EMAIL_PRODUCT_LIST_THUMB.sm}px`);
    expect(render({ image_height: 'lg' }, 'list')).toContain(`height:${EMAIL_PRODUCT_LIST_THUMB.lg}px`);
    expect(render({}, 'list')).toContain(`height:${EMAIL_PRODUCT_LIST_THUMB.md}px`);
  });

  it('이미지 정렬(image_focus)이 채우기일 때 출력을 바꾼다', () => {
    expect(render({ image_focus: 'top' })).toContain('object-position:center top');
    expect(render({ image_focus: 'bottom' })).toContain('object-position:center bottom');
  });
});

describe('상품 슬라이드 — 미지정이면 현행 출력과 한 글자도 다르지 않다 (무회귀)', () => {
  for (const t of EMAIL_PRODUCT_TREATMENTS) {
    it(`[${t}] 5개 속성 미지정 = 색·정렬 지정이 출력에 섞이지 않는다`, () => {
      const html = render({}, t);
      expect(html).not.toContain('object-fit:contain');
      expect(html).not.toContain('object-position:center top');
      expect(html).not.toContain('object-position:center bottom');
    });
  }
});

describe('상품 슬라이드 제목 — 크기·색 (2026-08-26 신설 · 임은지 접수)', () => {
  it('title_color가 제목 색으로 실린다', () => {
    expect(render({ title: '가을 감사제', title_color: '#ff3366' })).toContain('#ff3366');
  });

  it('title_size가 제목 글자 크기를 바꾼다', () => {
    const sm = render({ title: '가을 감사제', title_size: 'sm' });
    const md = render({ title: '가을 감사제' });
    const lg = render({ title: '가을 감사제', title_size: 'lg' });
    expect(sm).not.toBe(md);
    expect(lg).not.toBe(md);
    expect(sm).not.toBe(lg);
  });

  it('제목 크기·색 미지정 = 현행 제목 출력 그대로', () => {
    const before = render({ title: '가을 감사제' });
    expect(before).toContain('가을 감사제');
    expect(before).not.toContain('#ff3366');
  });
});

// ── 원장 구동 검사 — 표에 등재된 속성은 전부 출력을 바꿔야 한다 ──
// 이 블록이 harness다. 편집기에 새 속성을 만들고 원장에만 적으면 여기서 깨진다.
describe('email-property-contract 원장 = 실제 소비 (등재만 하고 안 읽으면 실패)', () => {
  const PROBE: Record<string, unknown> = {
    background_color: '#f06060',
    caption_bg_color: '#e74b4b',
    image_fit: 'contain',
    image_focus: 'top',
    image_height: 'lg',
    title_size: 'lg',
    title_color: '#ff3366',
  };

  it('원장의 모든 속성에 탐침 값이 있다 (새 속성 등재 시 탐침도 함께)', () => {
    for (const { prop } of EMAIL_PRODUCT_CAROUSEL_PROPS) {
      expect(PROBE[prop], `${prop} 탐침 값 없음`).toBeDefined();
    }
  });

  for (const { prop, desc } of EMAIL_PRODUCT_CAROUSEL_PROPS) {
    it(`${prop} (${desc}) — 값을 주면 출력이 실제로 달라진다`, () => {
      const base = render({ title: '가을 감사제' });
      const probed = render({ title: '가을 감사제', [prop]: PROBE[prop] });
      expect(probed, `${prop}가 이메일 렌더러에서 소비되지 않는다`).not.toBe(base);
    });
  }
});

// ── 히어로 (2026-08-27 임은지 접수 cmtb65jft02y5jnot96pjwvjo) ──
describe('히어로 — 편집기 속성이 이미지 구도 전부에서 반영된다', () => {
  const hero = (props: Record<string, unknown>, treatment?: string): Section =>
    ({ id: 's-hero', type: 'hero', order: 0, visible: true, treatment,
       props: { headline: '붉은팥 PDRN 모공탄력 세럼', sub_copy: '열감을 내리고 모공은 쫀쫀하게', align: 'center', height: 'md', image_url: 'https://x.example.com/hero.jpg', ...props } } as unknown as Section);
  const rh = (props: Record<string, unknown>, treatment?: string) => renderEmailSections([hero(props, treatment)], {});

  for (const t of EMAIL_HERO_IMAGE_TREATMENTS) {
    it(`[${t}] 높이 설정이 실제 높이를 바꾼다 (편집기 "높이" 컨트롤이 죽지 않는다)`, () => {
      expect(rh({ height: 'sm' }, t)).toContain(`${EMAIL_HERO_HEIGHT.sm}px`);
      expect(rh({ height: 'lg' }, t)).toContain(`${EMAIL_HERO_HEIGHT.lg}px`);
      expect(rh({ height: 'md' }, t)).toContain(`${EMAIL_HERO_HEIGHT.md}px`);
    });

    it(`[${t}] 이미지 맞춤(contain)이 출력을 바꾼다 — 완성 포스터가 잘리지 않아야 한다`, () => {
      expect(rh({ image_fit: 'contain' }, t)).not.toBe(rh({}, t));
    });

    it(`[${t}] 이미지 초점(focus=top)이 출력을 바꾼다`, () => {
      expect(rh({ focus: 'top' }, t)).not.toBe(rh({}, t));
    });
  }

  it('원장의 히어로 속성은 전부 출력을 바꾼다 (등재만 하고 안 읽으면 실패)', () => {
    const PROBE: Record<string, unknown> = {
      height: 'lg', image_fit: 'contain', focus: 'top', align: 'left',
      headline_color: '#ff3366', headline_size: 33, sub_copy_color: '#3366ff', sub_copy_size: 22,
    };
    for (const { prop, desc } of EMAIL_HERO_PROPS) {
      expect(PROBE[prop], `${prop} 탐침 값 없음`).toBeDefined();
      expect(rh({ [prop]: PROBE[prop] }), `${prop} (${desc})가 이메일 히어로 렌더러에서 소비되지 않는다`).not.toBe(rh({}));
    }
  });
});

// ── 캠페인 서체 (2026-08-27 임은지 접수 cmtb6kn6j0369jnotmslux7i2) ──
describe('캠페인 디자인 서체 — 지정하면 발송 HTML에 실린다', () => {
  const body: Section[] = [
    { id: 'h', type: 'hero', order: 0, visible: true, props: { headline: '헤드라인', sub_copy: '서브카피', align: 'center', height: 'md' } } as unknown as Section,
    { id: 't', type: 'text_card', order: 1, visible: true, props: { headline: '소개', body: '본문입니다' } } as unknown as Section,
  ];

  it('서체 미지정 = 현행 출력 (회귀 0)', () => {
    expect(renderEmailSections(body, { design: {} as never })).toBe(renderEmailSections(body, {}));
  });

  for (const { prop, desc, probe } of EMAIL_DESIGN_PROPS) {
    it(`${prop} (${desc}) — 지정 값이 실제 출력을 바꾼다`, () => {
      const base = renderEmailSections(body, {});
      const styled = renderEmailSections(body, { design: { [prop]: probe } as never });
      expect(styled, `${prop}가 이메일 렌더러에서 소비되지 않는다`).not.toBe(base);
      // 카탈로그 서체는 이메일 폴백 스택으로 승격되므로 **서체 이름**이 출력에 남아야 한다
      const face = probe.split(',')[0].replace(/"/g, '').trim();
      expect(styled).toContain(face);
    });
  }

  it('카탈로그 서체는 자가호스팅 fonts.css @import까지 함께 나간다 (수신함에서 실제 그 글꼴로 보인다)', () => {
    const base = renderEmailSections(body, {});
    const styled = renderEmailSections(body, { design: { font_family: '"Noto Serif KR", serif' } as never });
    expect(base).not.toContain('/api/dm/v/fonts.css');
    expect(styled, '자가호스팅 서체 @import가 빠지면 수신함에서 기본 글꼴로 떨어진다').toContain('/api/dm/v/fonts.css');
    expect(styled).toContain('@import url(');
  });
});
