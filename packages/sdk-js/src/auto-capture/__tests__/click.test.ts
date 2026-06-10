import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupClickTracking } from '../click';

describe('Click auto-capture (보수 — §5 #5)', () => {
  let captured: Array<Record<string, unknown>>;
  let stop: () => void;

  beforeEach(() => {
    captured = [];
    document.body.innerHTML = '';
    stop = setupClickTracking((event) => {
      captured.push(event as unknown as Record<string, unknown>);
    });
  });

  afterEach(() => {
    // 옛 listener 영구 제거 (다음 test 안 누적 차단)
    if (stop) stop();
  });

  it('단순 button 클릭 시 tag + position 수집 + innerText 수집 X', () => {
    const btn = document.createElement('button');
    btn.textContent = '구매하기';
    document.body.appendChild(btn);
    btn.click();
    expect(captured.length).toBe(1);
    expect(captured[0].tag).toBe('button');
    expect(captured[0].text).toBeUndefined();
  });

  it('a href 클릭 시 href sanitize 의무 (access_token 마스킹)', () => {
    const a = document.createElement('a');
    a.href = 'https://example.com/path?access_token=secret&foo=bar';
    document.body.appendChild(a);
    a.click();
    expect(captured.length).toBe(1);
    expect((captured[0].href as string)).toContain('REDACTED');
    expect((captured[0].href as string)).not.toContain('secret');
  });

  it('data-hjl-event="purchase_click" attribute 안 event 명 추출', () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-hjl-event', 'purchase_click');
    document.body.appendChild(btn);
    btn.click();
    expect(captured.length).toBe(1);
    expect(captured[0].event).toBe('purchase_click');
  });

  it('role="link" attribute 안 role 수집', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'link');
    document.body.appendChild(div);
    div.click();
    expect(captured.length).toBe(1);
    expect(captured[0].role).toBe('link');
  });

  it('data-hjl-capture="text" opt-in 안 innerText 수집 OK', () => {
    const btn = document.createElement('button');
    btn.textContent = '특별 혜택';
    btn.setAttribute('data-hjl-capture', 'text');
    document.body.appendChild(btn);
    btn.click();
    expect(captured.length).toBe(1);
    expect(captured[0].text).toBe('특별 혜택');
  });

  it('stop() 호출 후 click = 수집 X', () => {
    stop();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.click();
    expect(captured.length).toBe(0);
  });
});
