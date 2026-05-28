import { describe, it, expect, beforeEach } from 'vitest';
import { detectIdentify, watchIdentifyChanges } from '../identify';

describe('Identify auto-detection (body data-hjl-user-id)', () => {
  beforeEach(() => {
    document.body.removeAttribute('data-hjl-user-id');
    document.body.removeAttribute('data-hjl-email');
    document.body.removeAttribute('data-hjl-phone');
    document.body.removeAttribute('data-hjl-name');
  });

  it('body data-hjl-user-id 자동 감지 → externalId 추출', () => {
    document.body.setAttribute('data-hjl-user-id', 'user_123');
    const result = detectIdentify();
    expect(result).toEqual({ externalId: 'user_123' });
  });

  it('data-hjl-user-id 누락 시 null 반환', () => {
    const result = detectIdentify();
    expect(result).toBeNull();
  });

  it('body data-hjl-email + data-hjl-phone 추가 traits 추출', () => {
    document.body.setAttribute('data-hjl-user-id', 'user_123');
    document.body.setAttribute('data-hjl-email', 'hoyun@example.com');
    document.body.setAttribute('data-hjl-phone', '01012345678');
    const result = detectIdentify();
    expect(result).toEqual({
      externalId: 'user_123',
      email: 'hoyun@example.com',
      phone: '01012345678',
    });
  });

  it('watchIdentifyChanges() — MutationObserver 안 attribute 변경 감지', async () => {
    const captured: Array<unknown> = [];
    const stop = watchIdentifyChanges((result) => {
      captured.push(result);
    });
    document.body.setAttribute('data-hjl-user-id', 'user_456');
    await new Promise((r) => setTimeout(r, 10));
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]).toEqual({ externalId: 'user_456' });
    stop();
  });
});
