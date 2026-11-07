import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderInAppForHost, defaultHostBridge, type InAppHostEvent } from '../inapp';

/**
 * ★ 2026-11-08 C114 CT-V3 웹뷰 호스트 다리(설계서 docs/2026-11-08-c114-roadmap-v2-design.md §3 I-1 · §5)
 *   ready = 첫 장 그림 load 뒤 한 번 · failed = error · 8초 · ready · failed 합쳐 한 번 · impression 다리 0 ·
 *   track(click · dismiss · opt_out) · navigate · close 한 번 · optout · copy · 그림 eager · API 호출 0(fetch · XHR · sendBeacon).
 */
function stubMatchMedia() {
  (window as any).matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  });
}
const ID = '88888888-8888-8888-8888-888888888888';
const poster = (over: Record<string, any> = {}): any => ({
  id: ID, title: '', body: '', template: 'full_image', backgroundColor: '#ffffff', textColor: '#111111',
  triggerEvent: 'page_load', displayFrequency: 'always',
  posterSlides: [
    { image_url: '/api/cdp/inapp/image/00000000-0000-0000-0000-000000000000/a.jpg', title: '첫 장', cta: { label: '보러 가기', action_url: '/event/1' } },
    { image_url: '/api/cdp/inapp/image/00000000-0000-0000-0000-000000000000/b.jpg', title: '둘째 장' },
  ],
  ...over,
});
const loadFirst = (ok = true) => {
  const img = document.querySelector('[data-hanjullo-msg] img') as HTMLImageElement;
  if (ok) {
    Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => 400 });
    img.dispatchEvent(new Event('load'));
  } else {
    img.dispatchEvent(new Event('error'));
  }
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('CT-V3 웹뷰 호스트 다리', () => {
  let events: InAppHostEvent[];
  let fetchSpy: any; let xhrSpy: any; let beaconSpy: any;
  const post = (e: InAppHostEvent) => { events.push(e); };
  beforeEach(async () => {
    stubMatchMedia();
    document.body.innerHTML = ''; document.head.innerHTML = '';
    await flush();   // 앞 시험의 닫힘 감시가 비운 문서를 보고 내는 사건을 여기서 흘려보낸다
    localStorage.clear(); sessionStorage.clear();
    events = [];
    fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    (globalThis as any).fetch = fetchSpy;
    xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
    beaconSpy = vi.fn(() => true);
    (navigator as any).sendBeacon = beaconSpy;
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const noApi = () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  };

  it('그림 = 전부 eager · ready 는 첫 장 load 뒤 한 번 · impression 다리 0', async () => {
    expect(renderInAppForHost({ message: poster(), serverNow: new Date().toISOString() }, post)).toBe(true);
    const imgs = Array.from(document.querySelectorAll('[data-hanjullo-msg] img')) as HTMLImageElement[];
    expect(imgs.length).toBe(2);
    expect(imgs.every((im) => im.loading === 'eager')).toBe(true);
    expect(events.filter((e) => e.type === 'ready')).toHaveLength(0);
    loadFirst(true);
    await flush();
    loadFirst(true);
    await flush();
    expect(events.filter((e) => e.type === 'ready')).toEqual([{ type: 'ready', messageId: ID }]);
    expect(events.some((e) => e.type === 'track' && (e as any).event === 'impression')).toBe(false);
    noApi();
  });

  it('첫 그림 error = failed 한 번 · 뒤늦은 load = 사건 0', async () => {
    renderInAppForHost({ message: poster() }, post);
    loadFirst(false);
    await flush();
    loadFirst(true);
    await flush();
    expect(events.filter((e) => e.type === 'ready' || e.type === 'failed')).toEqual([{ type: 'failed', messageId: ID }]);
  });

  it('8초 안에 안 들어옴 = failed', () => {
    vi.useFakeTimers();
    renderInAppForHost({ message: poster() }, post);
    vi.advanceTimersByTime(8001);
    expect(events.filter((e) => e.type === 'failed')).toHaveLength(1);
  });

  it('그림 없는 메시지 = 다음 그리기 틀 뒤 ready', async () => {
    renderInAppForHost({ message: { id: ID, title: '안내', body: '본문', template: 'center_modal', backgroundColor: '#fff', textColor: '#111', triggerEvent: 'page_load', displayFrequency: 'always' } as any }, post);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(events.filter((e) => e.type === 'ready')).toHaveLength(1);
  });

  it('장 버튼 = track click(slide_0) + navigate(앱이 이동) · 닫힘 = close 한 번 · API 0', async () => {
    renderInAppForHost({ message: poster() }, post);
    loadFirst(true);
    await flush();
    const cta = document.querySelector('[data-hjl-part="cta"]') as HTMLElement;
    cta.click();
    await flush();
    expect(events).toContainEqual(expect.objectContaining({ type: 'track', messageId: ID, event: 'click', buttonId: 'slide_0' }));
    expect(events).toContainEqual({ type: 'navigate', url: '/event/1' });
    await flush();
    expect(events.filter((e) => e.type === 'close')).toEqual([{ type: 'close', messageId: ID }]);
    noApi();
  });

  it('다시 보지 않기 = optout + track opt_out + close · 앱 저장소 몫(SDK 저장소 쓰기 0)', async () => {
    renderInAppForHost({ message: poster() }, post);
    loadFirst(true);
    await flush();
    const optout = Array.from(document.querySelectorAll('[data-hanjullo-msg] button, [data-hanjullo-msg] [role="button"]'))
      .find((b) => (b.textContent || '').includes('다시 보지 않기')) as HTMLElement;
    expect(optout).toBeTruthy();
    optout.click();
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toContainEqual(expect.objectContaining({ type: 'optout', messageId: ID }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'track', event: 'opt_out' }));
    expect(events.filter((e) => e.type === 'close')).toHaveLength(1);
    noApi();
  });

  it('쿠폰 띠 복사 = copy 사건(앱이 복사)', async () => {
    renderInAppForHost({ message: poster({ design: { poster_strip: { type: 'coupon', code: 'HELLO10' } } }) }, post);
    loadFirst(true);
    await flush();
    const copy = document.querySelector('[data-hjl-part="strip-copy"]') as HTMLElement
      || (Array.from(document.querySelectorAll('[data-hanjullo-msg] button')).find((b) => b.textContent === '복사') as HTMLElement);
    expect(copy).toBeTruthy();
    copy.click();
    await flush();
    expect(events).toContainEqual({ type: 'copy', messageId: ID, text: 'HELLO10' });
  });

  it('(Codex 구현 1R ②) 스스로 닫지 않는 모양(떠 있는 버튼) = 이동하면 메시지를 닫아 close 한 번', async () => {
    renderInAppForHost({ message: { id: ID, title: '장바구니', body: '', template: 'floating_button', backgroundColor: '#fff', textColor: '#111', triggerEvent: 'page_load', displayFrequency: 'always',
      buttons: [{ id: 'fb', label: '장바구니', action_url: '/cart', style: 'primary' }] } as any }, post);
    const btn = document.querySelector('[data-hanjullo-msg] button, button[data-hanjullo-msg]') as HTMLElement;
    expect(btn).toBeTruthy();
    btn.click();
    await flush();
    expect(events).toContainEqual({ type: 'navigate', url: '/cart' });
    expect(document.querySelector(`[data-hanjullo-msg="${ID}"]`)).toBeNull();
    expect(events.filter((e) => e.type === 'close')).toHaveLength(1);
    noApi();
  });

  it('다리 찾기 = RN → iOS → 안드로이드 · 없으면 이동만 페이지가', () => {
    const rn = vi.fn();
    (window as any).ReactNativeWebView = { postMessage: rn };
    defaultHostBridge()({ type: 'ready', messageId: ID });
    expect(rn).toHaveBeenCalledWith(JSON.stringify({ type: 'ready', messageId: ID }));
    delete (window as any).ReactNativeWebView;
    const ios = vi.fn();
    (window as any).webkit = { messageHandlers: { hanjulInApp: { postMessage: ios } } };
    defaultHostBridge()({ type: 'close', messageId: ID });
    expect(ios).toHaveBeenCalledWith({ type: 'close', messageId: ID });
    delete (window as any).webkit;
    const and = vi.fn();
    (window as any).HanjulInAppAndroid = { postMessage: and };
    defaultHostBridge()({ type: 'failed', messageId: ID });
    expect(and).toHaveBeenCalledWith(JSON.stringify({ type: 'failed', messageId: ID }));
    delete (window as any).HanjulInAppAndroid;
  });
});
