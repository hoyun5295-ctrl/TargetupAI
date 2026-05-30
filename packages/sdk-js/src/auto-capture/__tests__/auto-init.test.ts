import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { autoInitFromScriptTag } from '../auto-init';

describe('autoInitFromScriptTag — data-hjl-key 스니펫 자동 init', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    (window as any).hjl = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('data-hjl-key 속성을 가진 script 발견 → 해당 키로 init 호출', () => {
    const s = document.createElement('script');
    s.setAttribute('data-hjl-key', 'hjl_abc123');
    s.setAttribute('src', 'https://app.hanjul.ai/sdk/v0.3.5/hanjul.min.js');
    document.head.appendChild(s);

    const init = vi.fn();
    (window as any).hjl = { init };

    autoInitFromScriptTag();

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith({ apiKey: 'hjl_abc123' });
  });

  it('data-hjl-key 속성 없으면 init 미호출', () => {
    const s = document.createElement('script');
    s.setAttribute('src', 'https://app.hanjul.ai/sdk/v0.3.5/hanjul.min.js');
    document.head.appendChild(s);

    const init = vi.fn();
    (window as any).hjl = { init };

    autoInitFromScriptTag();

    expect(init).not.toHaveBeenCalled();
  });

  it('window.hjl 미존재 시 throw 없이 무시', () => {
    const s = document.createElement('script');
    s.setAttribute('data-hjl-key', 'hjl_abc123');
    document.head.appendChild(s);
    (window as any).hjl = undefined;

    expect(() => autoInitFromScriptTag()).not.toThrow();
  });

  it('빈 data-hjl-key 값이면 init 미호출', () => {
    const s = document.createElement('script');
    s.setAttribute('data-hjl-key', '');
    document.head.appendChild(s);

    const init = vi.fn();
    (window as any).hjl = { init };

    autoInitFromScriptTag();

    expect(init).not.toHaveBeenCalled();
  });
});
