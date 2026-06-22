import { describe, test, expect } from 'vitest';
import { normalizeDmShortCode } from './dm-code';

describe('normalizeDmShortCode — 공개 URL의 dm- 접두사 제거 (viewer 조회 정합)', () => {
  test('dm- 접두사가 있으면 제거 — 발행/테스트 URL이 dm-{code}라 viewer 조회 실패하던 문제', () => {
    expect(normalizeDmShortCode('dm-BJF71HG')).toBe('BJF71HG');
  });

  test('접두사가 없으면 그대로', () => {
    expect(normalizeDmShortCode('BJF71HG')).toBe('BJF71HG');
  });

  test('앞뒤 공백 제거', () => {
    expect(normalizeDmShortCode('  dm-ABC1234  ')).toBe('ABC1234');
  });

  test('선두 dm- 1회만 제거 (코드 자체에 dm 포함은 보존)', () => {
    // short_code 문자셋은 영숫자뿐(하이픈 없음)이라 "dm-" 하이픈은 접두사로만 등장.
    expect(normalizeDmShortCode('dm-dmABC12')).toBe('dmABC12');
  });

  test('빈 문자열·null-유사 입력은 빈 문자열', () => {
    expect(normalizeDmShortCode('')).toBe('');
    expect(normalizeDmShortCode(undefined as any)).toBe('');
    expect(normalizeDmShortCode(null as any)).toBe('');
  });
});
