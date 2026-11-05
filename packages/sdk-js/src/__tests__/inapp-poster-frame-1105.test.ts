import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HanjulloInAppModule, INAPP_SDK_CAPS } from '../inapp';
import {
  buildPosterFrame, formatCountdown, usesPosterFrame, posterFrameRequiredCaps, fitPosterFrameWidth, POSTER_FRAME_RULES,
} from '../poster-frame';

/**
 * ★ 2026-11-05 인앱 포스터 재구성 — 그리는 부품(poster-frame.ts) · SDK 손잡이(설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §3-4 · §3-5 · §3-7)
 *   CT-IA6 = 부품 순수(기록 · 네트워크 · 저장소 · 이동 · 시계 반복 0) · 규칙 상수 · frame 렌더 = 화면 고정 0 · 그림 위 HTML = 쪽 번호만.
 */
function stubMatchMedia() {
  (window as any).matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  });
}
const mod = (): any => new HanjulloInAppModule('hjl_test', '', 'https://app.example.com/api/cdp');
const msg = (over: Record<string, any> = {}): any => ({
  id: '66666666-6666-6666-6666-666666666666', title: '', body: '', template: 'full_image',
  backgroundColor: '#ffffff', textColor: '#111111', triggerEvent: 'page_load', displayFrequency: 'always', ...over,
});
const part = (name: string) => Array.from(document.querySelectorAll(`[data-hjl-part="${name}"]`)) as HTMLElement[];

describe('CT-IA6 부품 순수 · 규칙 상수', () => {
  const src = readFileSync(join(__dirname, '..', 'poster-frame.ts'), 'utf8');
  it('기록 · 네트워크 · 저장소 · 이동 · 시계 반복 0(글자)', () => {
    for (const bad of [/\bfetch\s*\(/, /\btrack\b/, /localStorage/, /sessionStorage/, /setInterval/, /setTimeout/, /\blocation\b/, /XMLHttpRequest/, /sendBeacon/]) {
      expect(src, String(bad)).not.toMatch(bad);
    }
  });
  it('규칙 상수', () => {
    expect(POSTER_FRAME_RULES.closeHit).toBe(44);
    expect(POSTER_FRAME_RULES.maxHeightRatio).toBe(0.72);
    expect(POSTER_FRAME_RULES.defaultAccent).toBe('#111827');
    expect([...POSTER_FRAME_RULES.overImageParts]).toEqual(['pager']);
  });
  it('frame 렌더 = 화면 고정(position: fixed) 0 · page 렌더 = 배경만 화면 고정', () => {
    const slides = [{ image_url: '/a.jpg' }, { image_url: '/b.jpg' }];
    const f = buildPosterFrame({ slides, design: { poster_frame: 'card', poster_strip: { type: 'coupon', code: 'A' } }, now: 0, mount: 'frame', viewportHeight: 667 });
    const all = [f.backdrop, ...Array.from(f.backdrop.querySelectorAll('*'))] as HTMLElement[];
    expect(all.filter((e) => e.style && e.style.position === 'fixed')).toEqual([]);
    expect(f.backdrop.style.position).toBe('absolute');
    const p = buildPosterFrame({ slides, design: {}, now: 0, mount: 'page', viewportHeight: 667 });
    expect(p.backdrop.style.position).toBe('fixed');
  });
  it('그림 위 HTML = 쪽 번호 알약 하나(그림 칸의 직속 자식 = 넘기는 줄 + 쪽 번호)', () => {
    const f = buildPosterFrame({ slides: [{ image_url: '/a.jpg' }, { image_url: '/b.jpg' }], design: { poster_text: 'baked' }, now: 0, mount: 'frame', viewportHeight: 667 });
    const media = f.backdrop.querySelector('[data-hjl-part="media"]')!;
    expect(Array.from(media.children).map((c) => c.getAttribute('data-hjl-part'))).toEqual(['rail', 'pager']);
  });
  it('높이 상한 = 원본 비율로 폭을 줄인다(자름 0)', () => {
    expect(fitPosterFrameWidth(900, 1200, 800, 100, 520)).toBe(Math.round((Math.round(800 * 0.72) - 100) * 0.75));
    expect(fitPosterFrameWidth(1200, 600, 800, 100, 520)).toBe(520);
    expect(fitPosterFrameWidth(0, 0, 800, 100, 520)).toBeNull();
  });
});

describe('판정 · 글', () => {
  it('새 틀 여부 · 필요 판 · 남은 시간 글', () => {
    expect(usesPosterFrame(null)).toBe(false);
    expect(usesPosterFrame({ poster_layout: 'event_card' })).toBe(false);
    expect(usesPosterFrame({ poster_strip: { type: 'countdown' } })).toBe(true);
    expect(posterFrameRequiredCaps({ poster_frame: 'card' }, 2)).toEqual({ hard: ['frame_card'], soft: [] });
    expect(formatCountdown(0)).toBe('마감됐어요');
    expect(formatCountdown(59_000)).toBe('00:00:59');
    expect(formatCountdown((2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000)).toBe('2일 03:04:05');
  });
});

describe('SDK 렌더 · 손잡이', () => {
  beforeEach(() => { stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('통짜 = 글을 그리지 않는다 · 대체 글 = 장 alt · 바닥 시트 · 하루 보지 않기 · 닫기', () => {
    const m = mod();
    m.renderPoster(msg({ design: { poster_text: 'baked', dismiss_mode: 'snooze_day' }, posterSlides: [{ image_url: '/a.jpg', alt: '새로 나온 케이크', cta: { label: '보기', action_url: '/x' } }] }),
      '', '', '/a.jpg', '', [], 'fade', null, { customer: {} });
    const root = document.querySelector('[data-hanjullo-msg]') as HTMLElement;
    expect(root.getAttribute('data-hjl-frame')).toBe('sheet');
    expect(root.getAttribute('data-hjl-text')).toBe('baked');
    expect((part('image')[0] as HTMLImageElement).alt).toBe('새로 나온 케이크');
    expect(root.textContent).not.toContain('새로 나온 케이크');
    expect(part('cta')[0].textContent).toBe('보기');
    expect(part('foot-snooze')[0].textContent).toBe('오늘 하루 보지 않기');
    expect(part('foot-close')[0].textContent).toBe('닫기');
  });

  it('떠 있는 카드 = 카드 위 닫기 줄(하루 보지 않기 흰 글 · X 44px) · 카드 최대 400', () => {
    const m = mod();
    m.renderPoster(msg({ design: { poster_frame: 'card', dismiss_mode: 'snooze_day' }, posterSlides: [{ image_url: '/a.jpg', title: '글 얹기', body: '본문' }] }),
      '', '', '/a.jpg', '', [], 'fade', null, { customer: {} });
    const root = document.querySelector('[data-hanjullo-msg]') as HTMLElement;
    expect(root.getAttribute('data-hjl-frame')).toBe('card');
    const row = part('card-close-row')[0];
    expect(row.nextElementSibling?.getAttribute('data-hjl-part')).toBe('card');
    expect(part('foot-close')[0].style.width).toBe('44px');
    expect(root.style.maxWidth).toBe('400px');
    expect(root.textContent).toContain('글 얹기');   // 글 얹기 = 스크림
  });

  it('쿠폰 복사 = clipboard · 「복사했어요」 2초 · 기록 copy_code · 메시지는 닫지 않는다', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const m = mod();
    const tracked: any[] = [];
    m.track = (...a: any[]) => { tracked.push(a); return Promise.resolve(); };
    m.renderPoster(msg({ design: { poster_text: 'baked', poster_strip: { type: 'coupon', code: 'HANJUL1105', label: '멤버 코드' } }, posterSlides: [{ image_url: '/a.jpg', alt: 'x' }] }),
      '', '', '/a.jpg', '', [], 'fade', null, { customer: {} });
    expect(part('strip-label')[0].textContent).toBe('멤버 코드');
    expect(part('strip-code')[0].textContent).toBe('HANJUL1105');
    part('strip-copy')[0].click();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('HANJUL1105');
    expect(part('strip-copy')[0].textContent).toBe('복사했어요');
    expect(tracked.some((a) => a[1] === 'click' && a[3] === 'copy_code')).toBe(true);
    expect(document.querySelector('[data-hanjullo-msg]')).toBeTruthy();
    vi.advanceTimersByTime(2100);
    expect(part('strip-copy')[0].textContent).toBe('복사');
  });

  it('남은 시간 = 서버 시각 차이로 · 1초마다 · 0 이하 = 마감됐어요', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    const m = mod();
    m.clockOffsetMs = 60_000;   // 서버가 기기보다 1분 빠르다
    const end = new Date('2026-11-05T10:03:00Z').toISOString();
    m.renderPoster(msg({ endAt: end, design: { poster_strip: { type: 'countdown', label: '마감까지' } }, posterSlides: [{ image_url: '/a.jpg', title: 't' }] }),
      '', '', '/a.jpg', '', [], 'fade', null, { customer: {} });
    expect(part('strip-timer')[0].textContent).toBe('00:02:00');
    vi.advanceTimersByTime(1000);
    expect(part('strip-timer')[0].textContent).toBe('00:01:59');
    vi.advanceTimersByTime(130_000);
    expect(part('strip-timer')[0].textContent).toBe('마감됐어요');
  });

  it('여러 장 = 쪽 번호 · 다음 화살표로 장 버튼이 바뀐다 · 그림 누름 = 장 링크(slide_N_image)', () => {
    const m = mod();
    const tracked: any[] = [];
    m.track = (...a: any[]) => { tracked.push(a); return Promise.resolve(); };
    m.safeNavigate = () => {};
    m.renderPoster(msg({ design: { poster_text: 'baked', poster_frame: 'card' }, posterSlides: [
      { image_url: '/a.jpg', alt: 'a', cta: { label: '첫 버튼', action_url: '/1' } },
      { image_url: '/b.jpg', alt: 'b', cta: { label: '둘째 버튼', action_url: '/2' }, link_url: '/img2' },
    ] }), '', '', '/a.jpg', '', [], 'fade', null, { customer: {} });
    expect(part('pager-text')[0].textContent).toBe('1 / 2');
    expect(part('cta')[0].textContent).toBe('첫 버튼');
    part('next')[0].click();
    expect(part('pager-text')[0].textContent).toBe('2 / 2');
    expect(part('cta')[0].textContent).toBe('둘째 버튼');
    (part('image')[1] as HTMLElement).click();
    expect(tracked.some((a) => a[1] === 'click' && a[3] === 'slide_1_image')).toBe(true);
  });

  it('장 없는 메시지(flat 만) = flat 에서 첫 장을 만든다', () => {
    const m = mod();
    m.renderPoster(msg({ design: { poster_frame: 'card' }, posterSlides: [] }), '제목', '본문', '/a.jpg', '',
      [{ id: 'b', label: '가기', action_url: '/go', style: 'primary', background_color: '', text_color: '' }], 'fade', null, { customer: {} });
    expect(part('image').length).toBe(1);
    expect(part('cta')[0].textContent).toBe('가기');
  });

  it('(Codex 구현 1R) 어느 길로 사라지든 전역 키 · 창 크기 리스너 · 시계를 뗀다', async () => {
    const addW = vi.spyOn(window, 'addEventListener');
    const remW = vi.spyOn(window, 'removeEventListener');
    const addD = vi.spyOn(document, 'addEventListener');
    const remD = vi.spyOn(document, 'removeEventListener');
    const m = mod();
    const one = msg({ endAt: new Date(Date.now() + 60_000).toISOString(), design: { poster_text: 'baked', poster_strip: { type: 'countdown' } }, posterSlides: [{ image_url: '/a.jpg', alt: 'x' }] });
    m.renderPoster(one, '', '', '/a.jpg', '', [], 'fade', null, { customer: {} });
    const resize = addW.mock.calls.find((c) => c[0] === 'resize')![1];
    const key = addD.mock.calls.find((c) => c[0] === 'keydown')![1];
    m.removeMessageDom(one);   // 버튼 · 그림 이동 · 자동 닫힘과 같은 길(DOM 만 지움)
    await new Promise((r) => setTimeout(r, 0));
    expect(remW.mock.calls.some((c) => c[0] === 'resize' && c[1] === resize)).toBe(true);
    expect(remD.mock.calls.some((c) => c[0] === 'keydown' && c[1] === key)).toBe(true);
  });

  it('(Codex 구현 1R) 긴 쿠폰 코드 = 코드 칸이 줄며 말줄임 · [복사]는 줄지 않는다 · 복사 원문 = 전체', () => {
    const code = 'A'.repeat(40);
    const f = buildPosterFrame({ slides: [{ image_url: '/a.jpg' }], design: { poster_strip: { type: 'coupon', code } }, now: 0, mount: 'frame', viewportHeight: 667 });
    const c = f.parts.stripCode!;
    expect(c.style.minWidth).toMatch(/^0(px)?$/);
    expect(c.style.textOverflow).toBe('ellipsis');
    expect(c.textContent).toBe(code);
    expect(f.parts.stripCopy!.style.flex).toBe('0 0 auto');
  });

  it('Esc = 닫기 · 하루 보지 않기 = dismiss + snooze_day', () => {
    const m = mod();
    const tracked: any[] = [];
    m.track = (...a: any[]) => { tracked.push(a); return Promise.resolve(); };
    m.renderPoster(msg({ design: { poster_text: 'baked', dismiss_mode: 'snooze_day' }, posterSlides: [{ image_url: '/a.jpg', alt: 'x' }] }), '', '', '/a.jpg', '', [], 'fade', null, { customer: {} });
    part('foot-snooze')[0].click();
    expect(tracked.some((a) => a[1] === 'dismiss' && a[3] === 'snooze_day')).toBe(true);
    m.renderPoster(msg({ id: '77777777-7777-7777-7777-777777777777', design: { poster_text: 'baked' }, posterSlides: [{ image_url: '/a.jpg', alt: 'x' }] }), '', '', '/a.jpg', '', [], 'fade', null, { customer: {} });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[data-hanjullo-msg="77777777-7777-7777-7777-777777777777"]')).toBeNull();
  });

  it('조회 = caps 동봉(서버 낱말과 같은 표) · serverNow 차이 기록', async () => {
    const m = mod();
    const urls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (u: string) => {
      urls.push(String(u));
      return { ok: true, json: async () => ({ success: true, messages: [], serverNow: new Date(Date.now() + 5000).toISOString() }) } as any;
    });
    await m.fetchAndRender('page_load', { anonymousId: 'dev1' });
    expect(urls[0]).toContain(`caps=${encodeURIComponent(INAPP_SDK_CAPS.join(','))}`);
    expect(m.clockOffsetMs).toBeGreaterThan(3000);
  });
});
