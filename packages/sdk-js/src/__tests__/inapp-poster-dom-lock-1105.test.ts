import { describe, it, expect, beforeEach } from 'vitest';
import { HanjulloInAppModule } from '../inapp';

/**
 * ★ 2026-11-05 인앱 포스터 재구성 CT-IA7 — 지금 3모양(overlay 한 장 · overlay 캐러셀 · 이벤트 카드 · 배너 시트) DOM 잠금.
 *   설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §3-7: 스크림을 그리는 부품(poster-frame.ts)으로 옮기기 **전에**
 *   이 스냅샷을 먼저 쓰고, 옮긴 뒤 같은지 본다(바뀌면 빨간불). 새 키(통짜 · 카드 · 띠)가 없는 메시지는 지금 경로 그대로여야 한다.
 * ★ 2026-11-08 C114 I-3 = 의도한 바꿈으로 스냅샷을 다시 찍었다(설계서 docs/2026-11-08-c114-roadmap-v2-design.md · Codex 설계 3R approve):
 *   사진 위 글 한 장 · 여러 장 = 새 틀(잘림 0 · 옛 4:5 cover 캐러셀 삭제) · 이벤트 카드 사진 기본 = 맞추기(contain). 그 밖 바뀜 = 빨간불.
 */
function stubMatchMedia() {
  (window as any).matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  });
}
function makeModule(): any {
  return new HanjulloInAppModule('hjl_test', '', 'https://app.example.com/api/cdp');
}
function msg(over: Record<string, any> = {}): any {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    title: '한 장 제목', body: '한 장 본문', template: 'full_image',
    backgroundColor: '#ffffff', textColor: '#111111',
    triggerEvent: 'page_load', displayFrequency: 'always',
    ...over,
  };
}
const html = () => (document.querySelector('[data-hanjullo-wrap]') as HTMLElement).outerHTML;

describe('CT-IA7 지금 포스터 DOM 잠금', () => {
  beforeEach(() => { stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); });

  it('overlay 한 장(스크림 · 배지 · 버튼 · 다시 보지 않기)', () => {
    const mod = makeModule();
    mod.renderPoster(msg({ design: { poster_title_color: '#fde047', poster_title_size: 22 } }), '한 장 제목', '한 장 본문\n두 줄', '/a.jpg', 'NEW',
      [{ id: 'b1', label: '보러 가기', action_url: 'https://mall.example/x', style: 'primary', background_color: '#111827', text_color: '#ffffff' }],
      'fade', null, { customer: {} });
    expect(html()).toMatchSnapshot();
  });

  it('overlay 캐러셀 3장(장마다 스크림 · 점 · 장 버튼)', () => {
    const mod = makeModule();
    const m = msg({
      posterSlides: [
        { image_url: '/a.jpg', title: '첫 장', body: '첫 본문', eyebrow: 'A', cta: { label: '첫 버튼', action_url: 'https://mall.example/1' } },
        { image_url: '/b.jpg', title: '둘째 장', title_color: '#ffffff', body_size: 16 },
        { image_url: '/c.jpg', body: '셋째 본문만', link_url: 'https://mall.example/3' },
      ],
    });
    mod.renderPoster(m, '한 장 제목', '한 장 본문', '/a.jpg', '', [], 'fade', null, { customer: {} });
    expect(html()).toMatchSnapshot();
  });

  it('이벤트 카드 2장 · 배너 시트 1장', () => {
    const mod = makeModule();
    mod.renderPoster(msg({
      id: '44444444-4444-4444-4444-444444444444',
      design: { poster_layout: 'event_card', dismiss_mode: 'snooze_day' },
      posterSlides: [{ image_url: '/a.jpg', eyebrow: 'EVENT', title: '카드 제목', body: '카드 본문' }, { image_url: '/b.jpg', title: '둘째' }],
    }), 'T', 'B', '/a.jpg', '', [], 'fade', null, { customer: {} });
    const a = html();
    document.body.innerHTML = '';
    mod.renderPoster(msg({
      id: '55555555-5555-5555-5555-555555555555',
      design: { poster_layout: 'banner_sheet' },
      posterSlides: [{ image_url: '/a.jpg', eyebrow: '기획전', subtitle: '윗줄', title: '큰 제목', body: '아랫줄', cta: { label: '보기', action_url: '/x' } }],
    }), 'T', 'B', '/a.jpg', '', [], 'fade', null, { customer: {} });
    expect({ eventCard: a, bannerSheet: html() }).toMatchSnapshot();
  });
});
