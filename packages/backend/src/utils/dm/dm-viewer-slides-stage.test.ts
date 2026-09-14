/**
 * dm-viewer-slides-stage.test.ts — 슬라이드 모드 뷰어: 이미지 무대 · 점 스트립 · PC 같은 열 (2026-09-14)
 *
 * 접수 cmu0ns23o01owjnlui3wdhe94(박성용): 슬라이드에서 이미지가 위에 붙고 아래가 비었다 · 하단 점이 34장이면 잘린다 ·
 * PC에서 장이 열 밖으로 넘치고 넘길 방법이 없다. 세 가지가 전부 renderPagesHtml 슬라이드 모드 CSS 세 줄이었다.
 * 여기서 고정하는 것 — ①이미지 1장짜리 장만 무대(dm-page--stage)가 된다 ②장 폭은 열 폭(100%)이지 100vw 가 아니다
 * ③점은 갯수만큼 두되 가로 스크롤 스트립 안에 있다 ④포인터 장치 한정 화살표 + ←/→ 배선이 있다 ⑤scroll 모드는 무접촉.
 */
import { describe, it, expect } from 'vitest';
import { isSwipeImagePage } from './dm-slides-expand';
import { renderDmViewerHtml } from './dm-viewer';

const gallery = (id: string, urls: string[], layout: string | undefined = 'list_1xN') => ({
  id, type: 'gallery', order: 0, visible: true,
  props: { images: urls.map((u) => ({ url: u })), ...(layout ? { layout } : {}), full_bleed: true },
});

describe('isSwipeImagePage — 이미지 무대 판정 (순수)', () => {
  it('list_1xN 갤러리 1장 = 무대', () => {
    expect(isSwipeImagePage({ id: 'p', sections: [gallery('g', ['a.jpg'])] })).toBe(true);
  });
  it('2장 이상·섹션 혼합·갤러리 아님·격자 레이아웃·빈 URL = 무대 아님', () => {
    expect(isSwipeImagePage({ id: 'p', sections: [gallery('g', ['a.jpg', 'b.jpg'])] })).toBe(false);
    expect(isSwipeImagePage({ id: 'p', sections: [{ id: 'h', type: 'hero', props: {} }, gallery('g', ['a.jpg'])] })).toBe(false);
    expect(isSwipeImagePage({ id: 'p', sections: [{ id: 'h', type: 'hero', props: {} }] })).toBe(false);
    expect(isSwipeImagePage({ id: 'p', sections: [gallery('g', ['a.jpg'], 'grid_2x2')] })).toBe(false);
    expect(isSwipeImagePage({ id: 'p', sections: [gallery('g', [''])] })).toBe(false);
    expect(isSwipeImagePage({ id: 'p', sections: [] })).toBe(false);
  });
});

const slidesDm = {
  short_code: 'stage001',
  title: '슬라이드 DM',
  store_name: '테스트몰',
  layout_mode: 'slides',
  pages: [
    { id: 'p1', sections: [
      { id: 's1', type: 'hero', order: 0, visible: true, props: { headline: '헤드라인' } },
      { id: 's2', type: 'cta', order: 1, visible: true, props: { buttons: [{ label: '보기', url: 'https://x.test' }] } },
    ] },
    // 갤러리 3장 → 뷰어가 3장으로 펼친다(expandSlidePagesForSwipe) → 각 장이 무대
    { id: 'p2', sections: [gallery('g1', ['a.jpg', 'b.jpg', 'c.jpg'])] },
  ],
};

describe('renderDmViewerHtml(slides) — 이미지 무대 · 점 스트립 · PC 같은 열', () => {
  const html = renderDmViewerHtml(slidesDm, 'https://hanjul.ai/api/dm');

  it('이미지 1장 장만 dm-page--stage, 혼합 장은 그대로', () => {
    const stage = html.match(/class="dm-page dm-page--stage"/g) || [];
    expect(stage.length).toBe(3);
    expect(html).toContain('class="dm-page" data-page-idx="0"');
  });

  it('무대 CSS — 상하 중앙·화면 맞춤·장 안 스크롤 0 · 이미지 inline 폭 100% 를 이긴다', () => {
    expect(html).toMatch(/\.dm-page--stage\{[^}]*justify-content:center/);
    expect(html).toMatch(/\.dm-page--stage\{[^}]*overflow:hidden/);
    expect(html).toMatch(/\.dm-page--stage \.dm-gal-grid img\{[^}]*width:auto!important/);
    expect(html).toMatch(/\.dm-page--stage \.dm-gal-grid img\{[^}]*max-height:calc\(100vh - /);
  });

  it('장 폭 = 열 폭(100%) — 100vw 를 쓰지 않는다 (PC 열 밖 넘침 원인)', () => {
    expect(html).toMatch(/\.dm-page\{flex:0 0 100%;width:100%;/);
    expect(html).not.toContain('width:100vw');
  });

  it('점은 이미지 갯수(4장)만큼, 가로 스크롤 스트립 안에', () => {
    const dots = html.match(/class="dot( active)?" data-idx="\d+"/g) || [];
    expect(dots.length).toBe(4);
    expect(html).toContain('<div class="dm-page-dots"><div class="dm-page-dots-in">');
    expect(html).toMatch(/\.dm-page-dots\{[^}]*overflow-x:auto/);
    expect(html).toMatch(/\.dm-page-dots\{[^}]*max-width:var\(--dm-mobile-max,430px\)/);
    // 활성 점을 가운데로 데려오는 배선
    expect(html).toContain("scrollIntoView({ inline: 'center'");
  });

  it('PC 화살표 = 포인터 장치 한정 + 키보드 ←/→ 배선 · 카운터는 열 안', () => {
    expect(html).toContain('data-dm-page-nav="prev"');
    expect(html).toContain('data-dm-page-nav="next"');
    expect(html).toContain('@media (hover:hover) and (pointer:fine){.dm-page-nav{display:flex}}');
    expect(html).toContain("e.key === 'ArrowRight'");
    expect(html).toContain("e.key === 'ArrowLeft'");
    expect(html).toMatch(/\.dm-page-counter\{[^}]*right:calc\(50% - min\(50%, var\(--dm-mobile-max,430px\)\/2\) \+ 12px\)/);
  });
});

describe('renderDmViewerHtml(scroll) — 무접촉 회귀 가드', () => {
  const html = renderDmViewerHtml({ ...slidesDm, layout_mode: 'scroll' }, 'https://hanjul.ai/api/dm');
  it('무대·점 스트립·화살표 요소가 없다', () => {
    expect(html).not.toContain('dm-page--stage');
    expect(html).not.toContain('<div class="dm-page-dots">');
    // 스크립트의 셀렉터 문자열은 모드 무관하게 있다(null 반환) — 요소·CSS 블록만 없어야 한다.
    expect(html).not.toContain('<button type="button" class="dm-page-nav"');
    expect(html).not.toContain('.dm-page-nav{');
  });
});
