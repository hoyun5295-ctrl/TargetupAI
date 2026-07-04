import { describe, it, expect } from 'vitest';
import { smsByteLength, sentenceCount, hasCta } from './copy-text-metrics';

describe('copy-text-metrics', () => {
  it('한글은 2바이트, ASCII는 1바이트로 센다', () => {
    expect(smsByteLength('가나다')).toBe(6);
    expect(smsByteLength('abc')).toBe(3);
    expect(smsByteLength('가a')).toBe(3);
    expect(smsByteLength('')).toBe(0);
  });
  it('문장 수를 센다(구분자 . ! ? 줄바꿈)', () => {
    expect(sentenceCount('안녕하세요. 반갑습니다!')).toBe(2);
    expect(sentenceCount('한 문장')).toBe(1);
    expect(sentenceCount('')).toBe(0);
  });
  it('CTA 힌트 포함 여부를 판정한다', () => {
    expect(hasCta('지금 신청하세요')).toBe(true);
    expect(hasCta('그냥 인사말')).toBe(false);
  });
});
