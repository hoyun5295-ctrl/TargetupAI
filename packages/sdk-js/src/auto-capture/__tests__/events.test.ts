import { describe, it, expect } from 'vitest';
import { isValidEventName, STANDARD_EVENT_NAMES } from '../events';

describe('SDK 표준 이벤트명 검증 (isValidEventName)', () => {
  it('표준 이벤트명 cart_add → valid', () => {
    expect(isValidEventName('cart_add')).toBe(true);
  });

  it('표준 이벤트명 전체 → valid', () => {
    for (const name of STANDARD_EVENT_NAMES) {
      expect(isValidEventName(name)).toBe(true);
    }
  });

  it('custom_ 접두사 (소문자/숫자/언더스코어) → valid', () => {
    expect(isValidEventName('custom_signup_bonus')).toBe(true);
    expect(isValidEventName('custom_event1')).toBe(true);
  });

  it('비표준 이벤트명 (오타) → invalid', () => {
    expect(isValidEventName('cartadd')).toBe(false);
    expect(isValidEventName('CART_ADD')).toBe(false);
  });

  it('빈 문자열 / 공백 → invalid', () => {
    expect(isValidEventName('')).toBe(false);
    expect(isValidEventName('  ')).toBe(false);
  });

  it('custom_ 접두사인데 대문자/특수문자 포함 → invalid', () => {
    expect(isValidEventName('custom_Bad')).toBe(false);
    expect(isValidEventName('custom_with space')).toBe(false);
  });

  it('50자 초과 → invalid', () => {
    expect(isValidEventName('custom_' + 'a'.repeat(50))).toBe(false);
  });
});
