import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HanjulloInAppModule, resolvePosterLayout, isSnoozeActive, POSTER_SHEET_DEFAULTS, INAPP_SNOOZE_MS } from '../inapp';

/**
 * ★ 2026-09-29 인앱 만들기 개편 — 새 레이아웃(event_card · banner_sheet) · 쪽 번호 · PC 화살표 · 키보드 · 「오늘 하루 보지 않기」.
 *   설계서 docs/2026-09-29-inapp-editor-redesign-design.md §1. jsdom 렌더.
 */

let finePointer = false;
function stubMatchMedia() {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('pointer: fine') ? finePointer : false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  });
}
function makeModule(): any {
  return new HanjulloInAppModule('hjl_test', '', 'https://app.example.com/api/cdp');
}
function msg(over: Record<string, any> = {}): any {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    title: 'T', body: 'B', template: 'full_image',
    backgroundColor: '#ffffff', textColor: '#111111',
    triggerEvent: 'page_load', displayFrequency: 'always',
    ...over,
  };
}
const part = (name: string) => document.querySelectorAll(`[data-hjl-part="${name}"]`);
const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};

describe('순수 판정', () => {
  it('레이아웃 = 허용 값만 · 그 밖 overlay', () => {
    expect(resolvePosterLayout({ poster_layout: 'event_card' })).toBe('event_card');
    expect(resolvePosterLayout({ poster_layout: 'banner_sheet' })).toBe('banner_sheet');
    expect(resolvePosterLayout({ poster_layout: 'x' })).toBe('overlay');
    expect(resolvePosterLayout(null)).toBe('overlay');
  });
  it('하루 보지 않기 만료', () => {
    expect(isSnoozeActive({ a: 2000 }, 'a', 1000)).toBe(true);
    expect(isSnoozeActive({ a: 1000 }, 'a', 1000)).toBe(false);
    expect(isSnoozeActive({}, 'a', 1000)).toBe(false);
    expect(INAPP_SNOOZE_MS).toBe(86_400_000);
  });
});

describe('event_card', () => {
  beforeEach(() => { finePointer = false; stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); });

  it('1장 = 레이아웃 경로(쪽 번호 · 화살표 없음) · 라벨 · 제목 · 본문 · 사진 · 바닥 둘', () => {
    const mod = makeModule();
    const m = msg({
      design: { poster_layout: 'event_card', dismiss_mode: 'snooze_day' },
      posterSlides: [{ image_url: '/a.jpg', eyebrow: 'EVENT', title: '이달의 샌드위치', body: '두 줄\n본문' }],
    });
    mod.renderPoster(m, 'T', 'B', '/a.jpg', '', [], 'fade', null, { customer: {} });
    const root = document.querySelector('[data-hanjullo-msg]')!;
    expect(root.getAttribute('data-hjl-layout')).toBe('event_card');
    expect(part('eyebrow')[0].textContent).toBe('EVENT');
    expect(part('title')[0].textContent).toBe('이달의 샌드위치');
    expect(part('body')[0].textContent).toBe('두 줄\n본문');
    expect(part('media')).toHaveLength(1);
    expect(part('pager')).toHaveLength(0);
    expect(part('prev')).toHaveLength(0);
    expect(part('foot-snooze')[0].textContent).toBe('오늘 하루 보지 않기');
    expect(part('foot-close')[0].textContent).toBe('닫기');
  });

  it('값이 빠진 장 = 기본값(글 칸 바탕 · 제목색 · 크기 · cover)', () => {
    const mod = makeModule();
    mod.renderPoster(msg({ design: { poster_layout: 'event_card' }, posterSlides: [{ image_url: '/a.jpg', title: 't', body: 'b' }] }), 'T', 'B', '/a.jpg', '', [], 'fade', null, { customer: {} });
    const D = POSTER_SHEET_DEFAULTS.event_card;
    expect((part('text')[0] as HTMLElement).style.background).toBe(rgb(D.bg));
    expect((part('title')[0] as HTMLElement).style.color).toBe(rgb(D.titleColor));
    expect((part('title')[0] as HTMLElement).style.fontSize).toBe(`${D.titleSize}px`);
    expect((part('body')[0] as HTMLElement).style.fontSize).toBe(`${D.bodySize}px`);
    expect((part('media')[0].querySelector('img') as HTMLImageElement).style.objectFit).toBe('cover');
  });

  it('dismiss_mode 없음 = 「다시 보지 않기」(지금 동작)', () => {
    const mod = makeModule();
    mod.renderPoster(msg({ design: { poster_layout: 'event_card' }, posterSlides: [{ image_url: '/a.jpg' }] }), 'T', 'B', '/a.jpg', '', [], 'fade', null, { customer: {} });
    expect(part('foot-optout')[0].textContent).toBe('다시 보지 않기');
    expect(part('foot-snooze')).toHaveLength(0);
  });

  it('3장 = 쪽 번호 1 / 3 → → 키 = 2 / 3 → ← 두 번 = 3 / 3(돌아감) · Esc = 닫힘', () => {
    const mod = makeModule();
    mod.renderPoster(msg({
      design: { poster_layout: 'event_card' },
      posterSlides: [{ image_url: '/1.jpg', title: '하나' }, { image_url: '/2.jpg', title: '둘' }, { image_url: '/3.jpg', title: '셋' }],
    }), 'T', 'B', '/1.jpg', '', [], 'fade', null, { customer: {} });
    expect(document.querySelectorAll('[data-hjl-slide]')).toHaveLength(3);
    expect(part('pager')[0].textContent).toBe('1 / 3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(part('pager')[0].textContent).toBe('2 / 3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(part('pager')[0].textContent).toBe('3 / 3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[data-hanjullo-msg]')).toBeNull();
  });

  it('PC(마우스) = 좌우 화살표 · 누르면 다음 장', () => {
    finePointer = true; stubMatchMedia();
    const mod = makeModule();
    mod.renderPoster(msg({ design: { poster_layout: 'event_card' }, posterSlides: [{ image_url: '/1.jpg' }, { image_url: '/2.jpg' }] }), 'T', 'B', '/1.jpg', '', [], 'fade', null, { customer: {} });
    expect(part('prev')).toHaveLength(1);
    (part('next')[0] as HTMLElement).click();
    expect(part('pager')[0].textContent).toBe('2 / 2');
  });

  it('장이 없는 flat 메시지도 같은 모양(첫 장을 flat 으로)', () => {
    const mod = makeModule();
    mod.renderPoster(msg({ design: { poster_layout: 'event_card' } }), '제목', '본문', '/a.jpg', 'NEW', [], 'fade', null, { customer: {} });
    expect(document.querySelector('[data-hjl-layout="event_card"]')).toBeTruthy();
    expect(part('eyebrow')[0].textContent).toBe('NEW');
    expect(part('title')[0].textContent).toBe('제목');
  });

  it('변수 치환 — 라벨 · 제목', () => {
    const mod = makeModule();
    mod.renderPoster(msg({ design: { poster_layout: 'event_card' }, posterSlides: [{ image_url: '/a.jpg', eyebrow: '%이름%님 전용', title: '{{ customer.name }}님' }] }), 'T', 'B', '/a.jpg', '', [], 'fade', null, { customer: { name: '하나' } });
    expect(part('eyebrow')[0].textContent).toBe('하나님 전용');
    expect(part('title')[0].textContent).toBe('하나님');
  });
});

describe('banner_sheet', () => {
  beforeEach(() => { finePointer = false; stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); });

  it('탭 칩 · 윗줄 · 큰 제목 · 아랫줄 · 버튼 · 사진 contain · X', () => {
    const mod = makeModule();
    mod.renderPoster(msg({
      design: { poster_layout: 'banner_sheet', dismiss_mode: 'snooze_day' },
      posterSlides: [{ image_url: '/p.png', eyebrow: '장보기·쇼핑', subtitle: '이제 1만원부터', title: '편의점 특가대전', body: '1+1 할인 왔어요!', cta: { label: '보러 가기', action_url: '/sale' } }],
    }), 'T', 'B', '/p.png', '', [], 'fade', null, { customer: {} });
    expect(document.querySelector('[data-hjl-layout="banner_sheet"]')).toBeTruthy();
    expect(part('eyebrow')[0].textContent).toBe('장보기·쇼핑');
    expect(part('subtitle')[0].textContent).toBe('이제 1만원부터');
    expect(part('title')[0].textContent).toBe('편의점 특가대전');
    expect(part('body')[0].textContent).toBe('1+1 할인 왔어요!');
    expect(part('cta')[0].textContent).toBe('보러 가기');
    const D = POSTER_SHEET_DEFAULTS.banner_sheet;
    expect((part('panel')[0] as HTMLElement).style.background).toBe(rgb(D.bg));
    expect((part('title')[0] as HTMLElement).style.color).toBe(rgb(D.titleColor));
    expect((part('media')[0].querySelector('img') as HTMLImageElement).style.objectFit).toBe('contain');
    expect(document.querySelector('button[aria-label="닫기"]')).toBeTruthy();
  });

  it('장마다 명시한 색 · 맞춤이 기본값을 이긴다', () => {
    const mod = makeModule();
    mod.renderPoster(msg({
      design: { poster_layout: 'banner_sheet' },
      posterSlides: [{ image_url: '/p.png', title: 't', bg_color: '#0f766e', title_color: '#ffffff', image_fit: 'cover', title_size: 30 }],
    }), 'T', 'B', '/p.png', '', [], 'fade', null, { customer: {} });
    expect((part('panel')[0] as HTMLElement).style.background).toBe(rgb('#0f766e'));
    expect((part('title')[0] as HTMLElement).style.color).toBe(rgb('#ffffff'));
    expect((part('title')[0] as HTMLElement).style.fontSize).toBe('30px');
    expect((part('media')[0].querySelector('img') as HTMLImageElement).style.objectFit).toBe('cover');
  });
});

describe('overlay(지금 포스터) 회귀 0', () => {
  beforeEach(() => { finePointer = false; stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); });

  it('design 없음 · 1장 = 단일 포스터(레이아웃 표시 없음)', () => {
    const mod = makeModule();
    mod.renderPoster(msg({ posterSlides: [{ image_url: '/a.jpg' }] }), 'T', 'B', '/a.jpg', '', [], 'fade', null, { customer: {} });
    expect(document.querySelector('[data-hjl-layout]')).toBeNull();
    expect(document.querySelector('[data-hjl-carousel]')).toBeNull();
  });

  it('overlay 캐러셀 = 장마다 라벨(없으면 메시지 배지)', () => {
    const mod = makeModule();
    mod.renderPoster(msg({ posterSlides: [{ image_url: '/1.jpg', eyebrow: 'A장' }, { image_url: '/2.jpg' }] }), 'T', 'B', '/1.jpg', '공통', [], 'fade', null, { customer: {} });
    const t = document.querySelector('[data-hjl-carousel]')!.textContent || '';
    expect(t).toContain('A장');
    expect(t).toContain('공통');
  });

  it('옛 포스터도 dismiss_mode = snooze_day 면 「오늘 하루 보지 않기」', () => {
    const mod = makeModule();
    mod.renderPoster(msg({ design: { dismiss_mode: 'snooze_day' } }), 'T', 'B', '/a.jpg', '', [], 'fade', null, { customer: {} });
    expect(document.body.textContent).toContain('오늘 하루 보지 않기');
  });
});

describe('「오늘 하루 보지 않기」 동작', () => {
  beforeEach(() => { finePointer = false; stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); });

  it('누르면 24시간 억제 저장(부모 축 포함) · dismiss + snooze_day 기록 · 이후 표시 판정 = 거절', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    (globalThis as any).fetch = fetchMock;
    const mod = makeModule();
    const m = msg({ parentMessageId: '33333333-3333-3333-3333-333333333333', design: { poster_layout: 'event_card', dismiss_mode: 'snooze_day' }, posterSlides: [{ image_url: '/a.jpg' }] });
    expect(mod.canDisplayMessage(m)).toBe(true);
    mod.renderPoster(m, 'T', 'B', '/a.jpg', '', [], 'fade', null, { customer: {}, anonymousId: 'anon-1' });
    (part('foot-snooze')[0] as HTMLElement).click();
    const map = JSON.parse(localStorage.getItem('hanjullo_inapp_snooze') || '{}');
    expect(map[m.id]).toBeGreaterThan(Date.now());
    expect(map['33333333-3333-3333-3333-333333333333']).toBeGreaterThan(Date.now());
    await Promise.resolve();
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.event_type).toBe('dismiss');
    expect(body.button_id).toBe('snooze_day');
    // 새 세션(세션 억제 없음)에서도 24시간 안에는 안 뜬다
    sessionStorage.clear();
    expect(mod.canDisplayMessage(m)).toBe(false);
    // 변형 형제도 부모 축으로 막힌다
    expect(mod.canDisplayMessage(msg({ id: '44444444-4444-4444-4444-444444444444', parentMessageId: '33333333-3333-3333-3333-333333333333' }))).toBe(false);
  });

  it('만료가 지나면 다시 뜬다', () => {
    const mod = makeModule();
    localStorage.setItem('hanjullo_inapp_snooze', JSON.stringify({ [msg().id]: Date.now() - 1 }));
    expect(mod.canDisplayMessage(msg())).toBe(true);
  });
});
