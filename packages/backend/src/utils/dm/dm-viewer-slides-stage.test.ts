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

  it('이미지 1장 장만 dm-page--stage, 혼합 장은 그대로 · 펼친 무대 3장에 <img> 3개(빈 장 0 · 재오픈 정정)', () => {
    const stage = html.match(/class="dm-page dm-page--stage"/g) || [];
    expect(stage.length).toBe(3);
    expect(html).toContain('class="dm-page" data-page-idx="0"');
    // 펼친 장이 visible 을 잃으면 renderSections 가 버려 무대가 비었다 — 갤러리 3장 = 이미지 3개가 실제로 그려져야 한다
    const stageImgs = (html.match(/<section class="dm-page dm-page--stage"[^>]*>[\s\S]*?<\/section>/g) || []).filter((sec) => /<img/.test(sec));
    expect(stageImgs.length).toBe(3);
  });

  it('무대 CSS — 상하 중앙·화면 맞춤·장 안 스크롤 0 · 이미지 inline 폭 100% 를 이긴다 · 크롭 0(object-fit contain)', () => {
    expect(html).toMatch(/\.dm-page--stage\{[^}]*justify-content:center/);
    expect(html).toMatch(/\.dm-page--stage\{[^}]*overflow:hidden/);
    expect(html).toMatch(/\.dm-page--stage \.dm-gal-grid img\{[^}]*width:auto!important/);
    expect(html).toMatch(/\.dm-page--stage \.dm-gal-grid img\{[^}]*object-fit:contain/);
  });

  // ★ 재오픈(0914 16:15) "이미지가 하단으로 고정되고 확대되어 상하가 잘렸습니다" — 뿌리 = 장·이미지 높이를 100vh(브라우저 툴바를 포함한 큰 뷰포트)로 잡고
  //   뷰어는 height:100%(보이는 뷰포트)라 장이 뷰어보다 커서 아래가 잘렸다. 기준을 실제 보이는 높이(window.innerHeight → --dm-vh)로 옮긴다.
  it('높이 기준 = 실제 보이는 높이(--dm-vh) — 슬라이드 CSS 에 100vh 단독 사용 0 · 스크립트가 innerHeight 로 갱신(리사이즈·visualViewport)', () => {
    const slidesCss = html.slice(html.indexOf('.dm-viewer{height'), html.indexOf('.dm-section-wrap{position:relative}'));
    expect(slidesCss).toMatch(/\.dm-page\{[^}]*height:var\(--dm-vh,100vh\)/);
    expect(slidesCss).not.toMatch(/\.dm-page\{[^}]*;height:100vh/);
    expect(slidesCss).toMatch(/\.dm-page--stage \.dm-gal-grid img\{[^}]*max-height:calc\(var\(--dm-vh,100vh\) - /);
    expect(html).toContain("'--dm-vh'");
    expect(html).toContain('window.innerHeight');
    expect(html).toContain('visualViewport');
    expect(html).toMatch(/addEventListener\('resize'/);
  });

  it('장 폭 = 열 폭(100%) — 100vw 를 쓰지 않는다 (PC 열 밖 넘침 원인)', () => {
    expect(html).toMatch(/\.dm-page\{flex:0 0 100%;width:100%;/);
    expect(html).not.toContain('width:100vw');
  });

  it('점은 이미지 갯수(4장)만큼, 아래 띠 안 가로 스크롤 스트립 · 점 5px(재오픈 "단추 확대" 정정) · 진행 막대 · 카운터도 띠 안', () => {
    const dots = html.match(/class="dot( active)?" data-idx="\d+"/g) || [];
    expect(dots.length).toBe(4);
    expect(html).toContain('<div class="dm-page-dots">');
    expect(html).toContain('<div class="dm-page-dots-in">');
    expect(html).toMatch(/\.dm-page-dots-strip\{[^}]*overflow-x:auto/);
    expect(html).toMatch(/\.dm-page-dots\{[^}]*max-width:var\(--dm-mobile-max,430px\)/);
    expect(html).toMatch(/\.dm-page-dots \.dot\{[^}]*width:5px;height:5px/);
    // 메이크뷰식 진행 막대(현재/전체) — 점이 많아도 위치가 한눈에
    expect(html).toContain('<div class="dm-page-bar"><div class="dm-page-bar-in"></div></div>');
    expect(html).toMatch(/barIn\.style\.width/);
    // 카운터는 이미지 위(우상단)가 아니라 아래 띠 안 — 이미지 상단 글자(제품 코드)를 가리지 않는다
    expect(html).toMatch(/<div class="dm-page-dots">[\s\S]{0,400}class="dm-page-counter"/);
    expect(html).not.toMatch(/\.dm-page-counter\{[^}]*top:12px/);
    // 활성 점을 가운데로 데려오는 배선
    expect(html).toContain("scrollIntoView({ inline: 'center'");
  });

  it('PC 화살표 = 포인터 장치 한정 + 키보드 ←/→ 배선 · 카운터는 열 안', () => {
    expect(html).toContain('data-dm-page-nav="prev"');
    expect(html).toContain('data-dm-page-nav="next"');
    expect(html).toContain('@media (hover:hover) and (pointer:fine){.dm-page-nav{display:flex}}');
    expect(html).toContain("e.key === 'ArrowRight'");
    expect(html).toContain("e.key === 'ArrowLeft'");
    // 카운터는 띠 안 오른쪽(열 안) — 화면 끝이 아니라 열 오른쪽
    expect(html).toMatch(/\.dm-page-counter\{[^}]*position:absolute;right:12px/);
  });
});

describe('renderDmViewerHtml(scroll) — 무접촉 회귀 가드', () => {
  const html = renderDmViewerHtml({ ...slidesDm, layout_mode: 'scroll' }, 'https://hanjul.ai/api/dm');
  it('무대·점 스트립·화살표 요소가 없다', () => {
    expect(html).not.toContain('dm-page--stage');
    expect(html).not.toContain('<div class="dm-page-dots">');
    expect(html).not.toContain('dm-page-bar');
    expect(html).not.toContain("'--dm-vh'");
    // 스크립트의 셀렉터 문자열은 모드 무관하게 있다(null 반환) — 요소·CSS 블록만 없어야 한다.
    expect(html).not.toContain('<button type="button" class="dm-page-nav"');
    expect(html).not.toContain('.dm-page-nav{');
  });
});
