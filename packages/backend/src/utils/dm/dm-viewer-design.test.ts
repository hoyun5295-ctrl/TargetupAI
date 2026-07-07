/**
 * dm-viewer-design.test.ts — DM 발행물 디자인 2.0 골격 고정 (2026-07-07(5))
 *
 * 뷰어 CSS(.dm-cta 그라데이션·리빌 모션·데스크탑 앰비언트)와 리빌 배선이
 * 산출 HTML에 존재해야 한다. no-JS/reduced-motion 폴백(기본 표시) 구조도 고정.
 */
import { describe, it, expect } from 'vitest';
import { renderDmBaseCss } from './dm-tokens';
import { renderDmViewerHtml } from './dm-viewer';

describe('renderDmBaseCss — 디자인 2.0', () => {
  const css = renderDmBaseCss();

  it('.dm-cta = 그라데이션 면 + 강조색 그림자 + 800 굵기 + 프레스', () => {
    expect(css).toContain('linear-gradient(180deg, var(--dm-primary) 0%, var(--dm-primary-hover) 100%)');
    expect(css).toContain('font-weight: 800');
    expect(css).toContain('scale(0.97)');
  });

  it('리빌 모션 — .dm-reveal은 기본 숨김이 아니라 JS 부여 시에만 적용(클래스 분리)', () => {
    expect(css).toContain('.dm-reveal {');
    expect(css).toContain('.dm-reveal.dm-in');
    // .dm-section-wrap 자체에 opacity:0을 걸지 않는다 — no-JS 즉시 표시 보장
    expect(css).not.toMatch(/\.dm-section-wrap\s*\{[^}]*opacity:\s*0/);
  });

  it('데스크탑 앰비언트 — 480px+ 한정 (모바일 무영향)', () => {
    expect(css).toContain('@media (min-width: 480px)');
  });
});

describe('renderDmViewerHtml — 리빌 배선', () => {
  const dm = {
    short_code: 'test1234',
    title: '테스트 DM',
    store_name: '테스트몰',
    layout_mode: 'scroll',
    pages: [{ id: 'p1', sections: [
      { id: 's1', type: 'hero', order: 0, visible: true, props: { headline: '헤드라인' } },
      { id: 's2', type: 'cta', order: 1, visible: true, props: { buttons: [{ label: '보기', url: 'https://x.test' }] } },
    ] }],
  };

  it('리빌 옵저버 스크립트 + reduced-motion 게이트 포함', () => {
    const html = renderDmViewerHtml(dm, 'https://hanjul.ai/api/dm');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain("classList.add('dm-reveal')");
    expect(html).toContain("classList.add('dm-in')");
    // 첫 화면 요소는 리빌 스킵 (즉시 표시)
    expect(html).toContain('window.innerHeight * 0.92');
  });

  it('추적 배선(트래킹 비콘) 기존 유지 — 회귀 가드', () => {
    const html = renderDmViewerHtml(dm, 'https://hanjul.ai/api/dm');
    expect(html).toContain('sendBeacon');
    expect(html).toContain('/track');
    expect(html).toContain('section_interactions');
  });
});
