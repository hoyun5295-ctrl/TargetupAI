import { describe, it, expect } from 'vitest';
import { maskPII, maskUrl } from '../pii-masking';

describe('PII masking 7 분류 (§12 #7)', () => {
  it('email 마스킹 — 앞 1글자 + ***@domain 흐름', () => {
    expect(maskPII('hoyun5295@gmail.com')).toBe('h********@gmail.com');
  });

  it('휴대폰 010-1234-5678 마스킹 → 010-****-5678', () => {
    expect(maskPII('010-1234-5678')).toBe('010-****-5678');
    expect(maskPII('01012345678')).toBe('010****5678');
  });

  it('카드번호 16자리 마스킹 → 앞 4 + 끝 4 + 중간 ****', () => {
    expect(maskPII('1234-5678-9012-3456')).toBe('1234-****-****-3456');
    expect(maskPII('1234567890123456')).toBe('1234********3456');
  });

  it('주민번호 6+7 마스킹 → 앞 6 + 뒤 *******', () => {
    expect(maskPII('900101-1234567')).toBe('900101-*******');
  });

  it('세션토큰 (JWT-like) 마스킹 → eyJ... → [REDACTED_TOKEN]', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc';
    expect(maskPII(jwt)).toBe('[REDACTED_TOKEN]');
  });

  it('URL token sanitization — query string 안 access_token / api_key 마스킹', () => {
    const url = 'https://example.com/path?access_token=abc123&foo=bar&api_key=def456';
    const masked = maskUrl(url);
    expect(masked).toContain('access_token=%5BREDACTED%5D');
    expect(masked).toContain('api_key=%5BREDACTED%5D');
    expect(masked).not.toContain('abc123');
    expect(masked).not.toContain('def456');
  });

  it('비 PII 문자열 = 옛 그대로 반환', () => {
    expect(maskPII('hello world')).toBe('hello world');
    expect(maskPII('cart_added')).toBe('cart_added');
  });

  it('object 안 7 분류 자동 마스킹', () => {
    const input = {
      email: 'hoyun5295@gmail.com',
      phone: '010-1234-5678',
      note: 'hello',
    };
    expect(maskPII(input)).toEqual({
      email: 'h********@gmail.com',
      phone: '010-****-5678',
      note: 'hello',
    });
  });
});
