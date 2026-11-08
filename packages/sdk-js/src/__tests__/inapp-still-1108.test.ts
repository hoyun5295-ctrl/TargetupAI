import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderInAppForHost, type InAppHostEvent } from '../inapp';
import { buildPosterFrame } from '../poster-frame';

/**
 * ★ 2026-11-08 C116 V9 · V9a 정지 그리기(설계서 docs/2026-11-08-c116-inapp-bake-design.md D8)
 *   정지 = 살아 있는 부품(시계 · 복사 · 버튼 칸 · 쪽 번호 · 닫기 줄 · 바닥 줄)을 만들지 않는다 · 마감 시각 = 정적 글 · 높이 예산 = 띠만 ·
 *   SDK 는 붙이기만(자동 닫힘 · 움직임 · 연결 0) · 정지 아님 = 지금 구성 그대로.
 */
function stubMatchMedia() {
  (window as any).matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  });
}
const ID = '77777777-7777-7777-7777-777777777777';
const IMG = (n: string) => `/api/cdp/inapp/image/00000000-0000-0000-0000-000000000000/${n}.jpg`;
const two = [
  { image_url: IMG('a'), title: '첫 장', cta: { label: '보러 가기', action_url: '/event/1' } },
  { image_url: IMG('b'), title: '둘째 장', cta: { label: '둘째 버튼', action_url: '/event/2' } },
];
const one = [{ image_url: IMG('a'), title: '한 장', cta: { label: '보러 가기', action_url: '/event/1' } }];
const strips: Array<[string, Record<string, any> | null]> = [
  ['띠 없음', null],
  ['쿠폰', { type: 'coupon', code: 'HALLO30' }],
  ['마감', { type: 'countdown' }],
];
const part = (root: ParentNode, name: string) => root.querySelector(`[data-hjl-part="${name}"]`);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('C116 V9a 공용 부품 정지', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  for (const [slidesName, slides] of [['한 장', one], ['두 장', two]] as const) {
    for (const [stripName, strip] of strips) {
      for (const frame of ['sheet', 'card']) {
        const design = { ...(frame === 'card' ? { poster_frame: 'card' } : {}), ...(strip ? { poster_strip: strip } : {}) };
        it(`${slidesName} · ${stripName} · ${frame}: 정지 = 살아 있는 부품 0 · 정지 아님 = 지금 구성`, () => {
          const base = { slides: slides as any, design, now: Date.parse('2026-11-08T00:00:00Z'), endAt: '2026-11-30T14:59:00Z', mount: 'frame' as const, viewportHeight: 800 };
          const still = buildPosterFrame({ ...base, still: { deadlineText: '11월 30일 23:59' } });
          for (const k of ['stripTimer', 'stripCopy', 'ctaHost', 'pager', 'prev', 'next', 'dismissDay', 'close'] as const) {
            expect(still.parts[k], k).toBeNull();
          }
          expect(still.parts.rail).toBeTruthy();
          for (const n of ['card-close-row', 'pager', 'cta-host', 'foot', 'strip-copy', 'strip-timer', 'foot-close', 'foot-snooze', 'foot-optout']) {
            expect(part(still.backdrop, n), n).toBeNull();
          }
          if (strip?.type === 'countdown') expect(part(still.backdrop, 'strip-deadline')?.textContent).toBe('11월 30일 23:59');
          if (strip?.type === 'coupon') expect(part(still.backdrop, 'strip-code')?.textContent).toBe('HALLO30');

          const live = buildPosterFrame(base);
          expect(!!live.parts.ctaHost).toBe(true);
          expect(!!live.parts.dismissDay && !!live.parts.close).toBe(true);
          expect(!!live.parts.pager).toBe(slides.length > 1);
          expect(!!live.parts.stripCopy).toBe(strip?.type === 'coupon');
          expect(!!live.parts.stripTimer).toBe(strip?.type === 'countdown');
        });
      }
    }
  }

  it('정지 = 버튼 유무가 틀 폭(높이 예산)을 바꾸지 않는다 · 정지 아님 = 바뀐다(Codex 설계 1R ⑥)', () => {
    const noCta = two.map(({ cta: _c, ...rest }) => rest);
    const base = { design: {}, now: 0, mount: 'frame' as const, viewportHeight: 700 };
    const w = (slides: any[], still: boolean) => buildPosterFrame({ ...base, slides, ...(still ? { still: {} } : {}) }).root.style.maxWidth;
    expect(w(two, true)).toBe(w(noCta, true));
    expect(w(two, false)).not.toBe(w(noCta, false));
  });
});

describe('C116 V9 SDK 호스트 정지', () => {
  let events: InAppHostEvent[];
  const post = (e: InAppHostEvent) => { events.push(e); };
  beforeEach(async () => {
    stubMatchMedia();
    document.body.innerHTML = '';
    await flush();
    localStorage.clear(); sessionStorage.clear();
    events = [];
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('정지 → 레일로 전 장 넘김 → 자동 닫힘 시각 지남: 메시지 그대로 · 살아 있는 부품 0 · 마감 글 그대로 · 움직임 0', async () => {
    vi.useFakeTimers();
    const message: any = {
      id: ID, title: '', body: '', template: 'full_image', backgroundColor: '#ffffff', textColor: '#111111',
      triggerEvent: 'page_load', displayFrequency: 'always', autoDismissSeconds: 3, animation: 'rise',
      endAt: '2026-11-30T14:59:00Z', design: { poster_frame: 'card', poster_strip: { type: 'countdown' } }, posterSlides: two,
    };
    expect(renderInAppForHost({ message, serverNow: '2026-11-08T00:00:00Z', still: { deadlineText: '11월 30일 23:59' } }, post)).toBe(true);
    const root = document.querySelector(`[data-hanjullo-msg="${ID}"]`) as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.transform || '').not.toMatch(/translate|scale/);
    const rail = document.querySelector('[data-hjl-carousel]') as HTMLElement;
    rail.scrollLeft = 300;
    rail.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(10_000);
    expect(document.querySelector(`[data-hanjullo-msg="${ID}"]`)).toBeTruthy();
    for (const n of ['card-close-row', 'pager', 'cta-host', 'foot', 'strip-copy', 'strip-timer']) expect(part(document, n), n).toBeNull();
    expect(part(document, 'strip-deadline')?.textContent).toBe('11월 30일 23:59');
    expect(events.filter((e) => e.type === 'close')).toHaveLength(0);
  });

  it('정지 아님(보통 호스트) = 지금 그대로 버튼 칸 · 닫기 줄 · 시계가 있다', () => {
    const message: any = {
      id: ID, title: '', body: '', template: 'full_image', backgroundColor: '#ffffff', textColor: '#111111',
      triggerEvent: 'page_load', displayFrequency: 'always', endAt: '2026-11-30T14:59:00Z',
      design: { poster_frame: 'card', poster_strip: { type: 'countdown' } }, posterSlides: two,
    };
    renderInAppForHost({ message, serverNow: '2026-11-08T00:00:00Z' }, post);
    for (const n of ['card-close-row', 'pager', 'cta-host', 'strip-timer']) expect(part(document, n), n).toBeTruthy();
  });
});

/** ★ 2026-11-08 C116-B VB11 정지 = 틀 상자 그림자 0(찍는 상자 밖으로 뻗어 잘리는 값) · 정지 아님 = 그림자 그대로 */
describe('C116-B VB11 정지 그림자', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  for (const frame of ['sheet', 'card']) {
    it(`${frame}: 정지 = boxShadow none · 정지 아님 = 그림자 있음`, () => {
      const design = frame === 'card' ? { poster_frame: 'card' } : {};
      const base = { slides: two as any, design, now: Date.parse('2026-11-08T00:00:00Z'), endAt: null, mount: 'frame' as const, viewportHeight: 800 };
      const boxOf = (r: ReturnType<typeof buildPosterFrame>) => r.root.querySelector(`[data-hjl-part="${frame === 'card' ? 'card' : 'sheet'}"]`) as HTMLElement;
      expect(boxOf(buildPosterFrame({ ...base, still: { deadlineText: null } })).style.boxShadow).toBe('none');
      expect(boxOf(buildPosterFrame(base)).style.boxShadow).not.toBe('none');
      expect(boxOf(buildPosterFrame(base)).style.boxShadow).not.toBe('');
    });
  }
});
