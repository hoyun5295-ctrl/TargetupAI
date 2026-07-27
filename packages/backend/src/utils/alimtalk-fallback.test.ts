import { describe, it, expect } from 'vitest';
import {
  normalizeAlimtalkNextType,
  usesCustomContents,
  usesLmsFallback,
  validateAlimtalkFallback,
  resolveAlimtalkFallback,
  AlimtalkFallbackError,
  ALIMTALK_FALLBACK_ERRORS,
} from './alimtalk-fallback';

describe('normalizeAlimtalkNextType', () => {
  it('유효값은 그대로', () => {
    for (const t of ['N', 'S', 'L', 'A', 'B'] as const) {
      expect(normalizeAlimtalkNextType(t)).toBe(t);
    }
  });

  it('소문자·공백은 정규화', () => {
    expect(normalizeAlimtalkNextType(' b ')).toBe('B');
  });

  it('미지정·알 수 없는 값은 기본 L (기존 4경로 || L 폴백과 동일)', () => {
    expect(normalizeAlimtalkNextType(null)).toBe('L');
    expect(normalizeAlimtalkNextType(undefined)).toBe('L');
    expect(normalizeAlimtalkNextType('')).toBe('L');
    expect(normalizeAlimtalkNextType('X')).toBe('L');
  });
});

describe('타입 분류', () => {
  it('대체문안을 쓰는 타입 = A/B', () => {
    expect(usesCustomContents('A')).toBe(true);
    expect(usesCustomContents('B')).toBe(true);
    expect(usesCustomContents('L')).toBe(false);
    expect(usesCustomContents('S')).toBe(false);
    expect(usesCustomContents('N')).toBe(false);
  });

  it('LMS로 전환하는 타입 = L/B', () => {
    expect(usesLmsFallback('L')).toBe(true);
    expect(usesLmsFallback('B')).toBe(true);
    expect(usesLmsFallback('S')).toBe(false);
    expect(usesLmsFallback('A')).toBe(false);
    expect(usesLmsFallback('N')).toBe(false);
  });
});

describe('validateAlimtalkFallback', () => {
  it('대체 안함(N)은 문안·제목 없어도 통과', () => {
    expect(validateAlimtalkFallback({ nextType: 'N' })).toBeNull();
  });

  it('원문 그대로 LMS(L)는 제목 필수', () => {
    expect(validateAlimtalkFallback({ nextType: 'L', nextSubject: '주문 안내' })).toBeNull();
    expect(validateAlimtalkFallback({ nextType: 'L' })).toBe(ALIMTALK_FALLBACK_ERRORS.NO_SUBJECT);
    expect(validateAlimtalkFallback({ nextType: 'L', nextSubject: '   ' })).toBe(ALIMTALK_FALLBACK_ERRORS.NO_SUBJECT);
  });

  it('원문 그대로 LMS(L)는 대체문안이 비어도 통과 — 원문이 나가므로', () => {
    expect(validateAlimtalkFallback({ nextType: 'L', nextContents: '', nextSubject: '제목' })).toBeNull();
  });

  it('원문 그대로 SMS(S)는 제목 불필요', () => {
    expect(validateAlimtalkFallback({ nextType: 'S' })).toBeNull();
  });

  it('대체문안 LMS(B)는 문안·제목 둘 다 필수', () => {
    expect(validateAlimtalkFallback({ nextType: 'B', nextContents: '', nextSubject: '제목' }))
      .toBe(ALIMTALK_FALLBACK_ERRORS.NO_CONTENTS);
    expect(validateAlimtalkFallback({ nextType: 'B', nextContents: '대체 문구', nextSubject: '' }))
      .toBe(ALIMTALK_FALLBACK_ERRORS.NO_SUBJECT);
    expect(validateAlimtalkFallback({ nextType: 'B', nextContents: '대체 문구', nextSubject: '제목' })).toBeNull();
  });

  it('대체문안 SMS(A)는 문안만 필수', () => {
    expect(validateAlimtalkFallback({ nextType: 'A', nextContents: '' })).toBe(ALIMTALK_FALLBACK_ERRORS.NO_CONTENTS);
    expect(validateAlimtalkFallback({ nextType: 'A', nextContents: '대체 문구' })).toBeNull();
  });

  it('공백만 있는 대체문안은 미입력 취급', () => {
    expect(validateAlimtalkFallback({ nextType: 'B', nextContents: '   \n ', nextSubject: '제목' }))
      .toBe(ALIMTALK_FALLBACK_ERRORS.NO_CONTENTS);
  });
});

describe('resolveAlimtalkFallback', () => {
  it('대체 안함(N) — 문안·제목 모두 미적재', () => {
    expect(resolveAlimtalkFallback({ nextType: 'N', nextContents: '남은 값', nextSubject: '남은 제목' }))
      .toEqual({ nextType: 'N', nextContents: undefined, titleStr: undefined });
  });

  it('원문 그대로 LMS(L) — 남아 있던 대체문안은 NULL로 정규화(이중 진실 제거)', () => {
    expect(resolveAlimtalkFallback({ nextType: 'L', nextContents: '옛 대체문안', nextSubject: '제목' }))
      .toEqual({ nextType: 'L', nextContents: undefined, titleStr: '제목' });
  });

  it('원문 그대로 SMS(S) — 제목도 미적재', () => {
    expect(resolveAlimtalkFallback({ nextType: 'S', nextContents: '옛 값', nextSubject: '제목' }))
      .toEqual({ nextType: 'S', nextContents: undefined, titleStr: undefined });
  });

  it('대체문안 LMS(B) — 문안·제목 적재', () => {
    expect(resolveAlimtalkFallback({ nextType: 'B', nextContents: ' 대체 문구 ', nextSubject: ' 제목 ' }))
      .toEqual({ nextType: 'B', nextContents: '대체 문구', titleStr: '제목' });
  });

  it('대체문안 SMS(A) — 문안만 적재', () => {
    expect(resolveAlimtalkFallback({ nextType: 'A', nextContents: '대체 문구', nextSubject: '무시됨' }))
      .toEqual({ nextType: 'A', nextContents: '대체 문구', titleStr: undefined });
  });

  it('미지정 타입은 L로 확정 — 제목이 있으면 통과', () => {
    expect(resolveAlimtalkFallback({ nextSubject: '제목' }))
      .toEqual({ nextType: 'L', nextContents: undefined, titleStr: '제목' });
  });

  it('B인데 대체문안이 비면 발송 차단(throw) — 무엇이 나가는지 모르는 적재 금지', () => {
    expect(() => resolveAlimtalkFallback({ nextType: 'B', nextContents: '', nextSubject: '제목' }))
      .toThrow(AlimtalkFallbackError);
    expect(() => resolveAlimtalkFallback({ nextType: 'B', nextContents: '', nextSubject: '제목' }))
      .toThrow(ALIMTALK_FALLBACK_ERRORS.NO_CONTENTS);
  });

  it('L/B인데 제목이 비면 발송 차단(throw) — title_str NULL 미수신 사고 차단', () => {
    expect(() => resolveAlimtalkFallback({ nextType: 'L', nextSubject: '' })).toThrow(AlimtalkFallbackError);
    expect(() => resolveAlimtalkFallback({ nextType: 'B', nextContents: '문구', nextSubject: '' }))
      .toThrow(ALIMTALK_FALLBACK_ERRORS.NO_SUBJECT);
  });
});

describe('resolveAlimtalkFallback — 행 단위(disableFallback)', () => {
  const rowPolicy = { emptyContentsPolicy: 'disableFallback' as const };

  it('치환 결과가 빈 행은 throw 대신 그 행만 전환 없음(N) — 배치 중간 사망으로 인한 부분 발송 차단', () => {
    expect(resolveAlimtalkFallback({ nextType: 'B', nextContents: '', nextSubject: '제목' }, rowPolicy))
      .toEqual({ nextType: 'N', nextContents: undefined, titleStr: undefined, downgradedToNone: true });
  });

  it('공백만 남은 치환 결과도 같은 처리', () => {
    expect(resolveAlimtalkFallback({ nextType: 'A', nextContents: '  \n ' }, rowPolicy).downgradedToNone).toBe(true);
  });

  it('문안이 있으면 평소대로 적재 — 강등 표시 없음', () => {
    expect(resolveAlimtalkFallback({ nextType: 'B', nextContents: '대체 문구', nextSubject: '제목' }, rowPolicy))
      .toEqual({ nextType: 'B', nextContents: '대체 문구', titleStr: '제목' });
  });

  it('제목 누락은 행 단위에서도 설정 결함이라 그대로 차단', () => {
    expect(() => resolveAlimtalkFallback({ nextType: 'L', nextSubject: '' }, rowPolicy))
      .toThrow(ALIMTALK_FALLBACK_ERRORS.NO_SUBJECT);
  });

  it('B에 문안·제목이 둘 다 비면 강등으로 빠져나가지 않고 제목 결함으로 차단', () => {
    expect(() => resolveAlimtalkFallback({ nextType: 'B', nextContents: '', nextSubject: '' }, rowPolicy))
      .toThrow(ALIMTALK_FALLBACK_ERRORS.NO_SUBJECT);
    expect(() => resolveAlimtalkFallback({ nextType: 'B', nextContents: '  ', nextSubject: '  ' }, rowPolicy))
      .toThrow(ALIMTALK_FALLBACK_ERRORS.NO_SUBJECT);
  });

  it('N·L은 정책과 무관하게 기존 결과 유지', () => {
    expect(resolveAlimtalkFallback({ nextType: 'N' }, rowPolicy))
      .toEqual({ nextType: 'N', nextContents: undefined, titleStr: undefined });
    expect(resolveAlimtalkFallback({ nextType: 'L', nextContents: '', nextSubject: '제목' }, rowPolicy))
      .toEqual({ nextType: 'L', nextContents: undefined, titleStr: '제목' });
  });
});
