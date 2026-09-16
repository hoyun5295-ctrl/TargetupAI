/**
 * 장 넘김 효과 배선 계약 — 발행 HTML 기준 (★ 2026-09-16).
 *
 * 핵심: **효과를 안 고른 DM 의 발행 HTML 에는 효과 흔적이 한 글자도 없다.**
 * 고른 DM 만 body 표식·CSS·스크립트가 실리고, 장 이동 한 곳(goToPage)이 효과 경로로 갈라진다.
 */
import { describe, it, expect } from 'vitest';
import { renderDmViewerHtml } from './dm-viewer';

const page = (i: number) => ({
  id: 'p' + i,
  sections: [{ id: 's' + i, type: 'gallery', order: 0, visible: true, props: { images: [{ url: '/api/dm/v/images/c1/p' + i + '.jpg' }], layout: 'list_1xN', full_bleed: true } }],
});
const dmWith = (settings: any) => ({
  id: 'd1', title: '카탈로그', short_code: 'abc123', layout_mode: 'slides',
  pages: [page(1), page(2), page(3)], sections: [], brand_kit: null, settings,
});
const FX_MARKS = ['dm-fx', 'data-dm-effect', 'fxGo', 'FX_KIND'];

describe('효과 배선', () => {
  it('효과 미지정 = 발행 HTML 에 효과 흔적 0', () => {
    const html = renderDmViewerHtml(dmWith(null), 'https://hanjul.ai/api/dm');
    for (const m of FX_MARKS) expect(html, m + ' 가 미지정 DM 에 실렸다').not.toContain(m);
  });

  it("effect:'slide'(기본) 도 흔적 0 — 현행 가로 스크롤 그대로", () => {
    const html = renderDmViewerHtml(dmWith({ effect: 'slide' }), 'https://hanjul.ai/api/dm');
    for (const m of FX_MARKS) expect(html).not.toContain(m);
    expect(html).toContain('scroll-snap-type');
  });

  it("effect:'flip' = body 표식 · CSS · 스크립트가 함께 실린다", () => {
    const html = renderDmViewerHtml(dmWith({ effect: 'flip' }), 'https://hanjul.ai/api/dm');
    expect(html).toContain('data-dm-effect="flip"');
    expect(html).toContain('class="dm-fx dm-fx-flip"');
    expect(html).toContain('rotateY(-160deg)');
    expect(html).toContain('function fxGo');
    // 장 이동 한 곳이 효과 경로로 갈라진다(점·화살표·키보드가 모두 이 함수를 쓴다)
    expect(html).toContain('fxGo(i); return;');
    // 추적 계약: 도달 장·점 갱신은 기존 함수 그대로
    expect(html).toContain('updateCurrent(i)');
  });

  it("effect:'fade' = 투명도 전환만 (3D 없음)", () => {
    const html = renderDmViewerHtml(dmWith({ effect: 'fade' }), 'https://hanjul.ai/api/dm');
    expect(html).toContain('data-dm-effect="fade"');
    expect(html).toContain('.dm-fx-fade .dm-page{transition:opacity');
    expect(html).not.toContain('rotateY');
  });

  it('장이 1개면 효과를 켜지 않는다', () => {
    const dm = { ...dmWith({ effect: 'flip' }), pages: [page(1)] };
    const html = renderDmViewerHtml(dm, 'https://hanjul.ai/api/dm');
    for (const m of FX_MARKS) expect(html).not.toContain(m);
  });

  it('카탈로그(PC 책 펼침)와 효과는 함께 실릴 수 있다', () => {
    const html = renderDmViewerHtml(dmWith({ catalog: true, effect: 'flip' }), 'https://hanjul.ai/api/dm');
    expect(html).toContain('data-dm-catalog="1"');
    expect(html).toContain('data-dm-effect="flip"');
  });
});
