import { describe, it, expect, beforeEach } from 'vitest';
import { createHjlGlobal } from '../index';

describe('Auto-Capture index (IIFE 진입점)', () => {
  beforeEach(() => {
    // 매 test 직전 = 신규 hjl 재신설 (ES module cache 우회 + 옛 state clear)
    (window as any).hjl = createHjlGlobal();
  });

  it('window.hjl 객체 노출 의무', () => {
    expect((window as any).hjl).toBeDefined();
    expect(typeof (window as any).hjl.init).toBe('function');
    expect(typeof (window as any).hjl.track).toBe('function');
  });

  it('hjl.init({apiKey, secret}) 호출 시 config 저장 의무', () => {
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123', secret: 'sk_test456' });
    expect(hjl._config).toBeDefined();
    expect(hjl._config.apiKey).toBe('hjl_test123');
  });

  it('hjl.init() 호출 X 시 apiKey 누락 에러 던짐', () => {
    const hjl = (window as any).hjl;
    expect(() => hjl.init({})).toThrow('apiKey');
  });

  it('apiKey 안 hjl_ 접두사 누락 시 에러 던짐', () => {
    const hjl = (window as any).hjl;
    expect(() => hjl.init({ apiKey: 'invalid', secret: 'sk_test' })).toThrow('hjl_');
  });
});
