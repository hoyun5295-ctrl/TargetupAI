/**
 * 이메일 편집기 파리티 — "편집기에서 고를 수 있는데 발송 HTML엔 반영 안 됨"을 배포 전에 막는다.
 * `dm-editor-parity.test.ts`의 이메일 판. 근거표 = `email-property-contract.ts`.
 *
 * 소스 스캔이 아니라 **행동 테스트**다 — 값을 바꿔 렌더하고 출력이 실제로 달라지는지 밟는다
 * (LESSONS_BACKEND 2026-08-01 · 토큰 존재만 보는 검사는 조건 반전을 못 잡는다).
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections } from '../email-section-renderer';
import { EMAIL_PRODUCT_TREATMENTS, EMAIL_PRODUCT_IMG_HEIGHT, EMAIL_PRODUCT_LIST_THUMB, EMAIL_PRODUCT_CAROUSEL_PROPS } from '../email-property-contract';
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
