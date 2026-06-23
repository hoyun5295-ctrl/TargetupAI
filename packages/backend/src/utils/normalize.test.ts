import { describe, test, expect } from 'vitest';
import { normalizeOpt080Input } from './normalize';

describe('normalizeOpt080Input — 080 수신거부번호 입력 정규화 (빈값/공백=삭제)', () => {
  test('빈 문자열은 null(삭제 의도)', () => {
    expect(normalizeOpt080Input('')).toBe(null);
  });

  test('공백만 있어도 null(삭제)', () => {
    expect(normalizeOpt080Input('   ')).toBe(null);
  });

  test('null/undefined는 null', () => {
    expect(normalizeOpt080Input(null)).toBe(null);
    expect(normalizeOpt080Input(undefined)).toBe(null);
  });

  test('정상 번호는 그대로 유지', () => {
    expect(normalizeOpt080Input('0807196700')).toBe('0807196700');
  });

  test('앞뒤 공백은 제거', () => {
    expect(normalizeOpt080Input('  080-348-3600  ')).toBe('080-348-3600');
  });
});
