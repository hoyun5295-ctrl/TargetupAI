import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupPageviewTracking } from '../pageview';

describe('Pageview auto-capture (history.pushState + popstate + hashchange)', () => {
  let captured: Array<{ url: string; title: string; referrer: string }>;
  let stop: () => void;

  beforeEach(() => {
    captured = [];
    stop = setupPageviewTracking((event) => {
      captured.push(event);
    });
  });

  afterEach(() => {
    // 옛 window.history patching 영구 복구 (다음 test 안 누적 차단)
    if (stop) stop();
  });

  it('초기 load 시 즉시 1건 pageview 발송', () => {
    expect(captured.length).toBe(1);
    expect(captured[0].url).toBe(window.location.href);
  });

  it('history.pushState() 호출 시 pageview 발송', () => {
    window.history.pushState({}, '', '/new-path');
    expect(captured.length).toBe(2);
    expect(captured[1].url).toContain('/new-path');
  });

  it('history.replaceState() 호출 시 pageview 발송', () => {
    window.history.replaceState({}, '', '/replaced-path');
    expect(captured.length).toBe(2);
    expect(captured[1].url).toContain('/replaced-path');
  });

  it('popstate event 안 뒤로가기 시 pageview 발송', () => {
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(captured.length).toBe(2);
  });

  it('hashchange event 안 #hash 변경 시 pageview 발송', () => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(captured.length).toBe(2);
  });

  it('stop() 호출 후 추가 pushState = pageview 발송 X', () => {
    stop();
    window.history.pushState({}, '', '/after-stop');
    expect(captured.length).toBe(1);
  });
});
