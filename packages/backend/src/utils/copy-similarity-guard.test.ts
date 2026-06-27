import { describe, test, expect } from 'vitest';
import { checkCopyLeak, findBannedWords, isLikelySignature, normalizeForCompare } from './copy-similarity-guard';

describe('normalizeForCompare — 마스킹 토큰·구두점 제거', () => {
  test('{brand} 등 마스킹 토큰과 구두점 제거', () => {
    const n = normalizeForCompare('{brand} 특별 혜택!!');
    expect(n).not.toContain('{brand}');
    expect(n).toContain('특별');
    expect(n).toContain('혜택');
  });
});

describe('checkCopyLeak — 시그니처/표현 복제 차단', () => {
  test('연속 6어절 그대로 베끼면 leaked', () => {
    const ex = ['지금 바로 확인하고 특별한 혜택 받아가세요 오늘만'];
    const r = checkCopyLeak('안녕하세요 지금 바로 확인하고 특별한 혜택 받아가세요 오늘만 드림', ex, { ngram: 6 });
    expect(r.leaked).toBe(true);
  });

  test('표현이 다르면 통과', () => {
    const ex = ['지금 바로 확인하고 특별한 혜택 받아가세요'];
    const r = checkCopyLeak('새로운 소식을 가볍게 전해드려요', ex, { ngram: 6 });
    expect(r.leaked).toBe(false);
  });

  test('어순만 바꾼 변형 베낌 → Jaccard 단어집합으로 차단', () => {
    const ex = ['봄 신상 입고 완료 지금 바로 만나보세요'];
    const r = checkCopyLeak('바로 지금 봄 신상 만나보세요 입고 완료', ex, { ngram: 6, jaccard: 0.6 });
    expect(r.leaked).toBe(true);
  });

  test('예시 없으면 항상 통과', () => {
    expect(checkCopyLeak('아무 문장입니다', []).leaked).toBe(false);
  });
});

describe('findBannedWords', () => {
  test('금지어 검출', () => {
    expect(findBannedWords('무료 사은품 증정', ['무료', '대박'])).toContain('무료');
  });
  test('금지어 없으면 빈 배열', () => {
    expect(findBannedWords('정상 문장입니다', ['무료', '대박'])).toEqual([]);
  });
});

describe('isLikelySignature — tenant 반복 고빈도만 후보', () => {
  test('고빈도 → 후보', () => {
    expect(isLikelySignature('오늘도 좋은 하루', { '오늘도 좋은 하루': 8 }, 3)).toBe(true);
  });
  test('저빈도 → 비후보', () => {
    expect(isLikelySignature('가벼운 인사', { '가벼운 인사': 1 }, 3)).toBe(false);
  });
});
