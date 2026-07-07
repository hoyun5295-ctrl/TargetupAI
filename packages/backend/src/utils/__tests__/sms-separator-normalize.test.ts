import { describe, it, expect } from 'vitest';
import { normalizeSmsSeparatorLines } from '../messageUtils';

/**
 * ★ 2026-07-08 SMS/LMS 구분선 정규화 — AI 생성 문안의 긴 구분선이
 * 휴대폰 화면 폭을 넘어 두 줄로 꺾여 보이는 문제 차단 게이트.
 */
describe('normalizeSmsSeparatorLines', () => {
  it('긴 하이픈 구분선 = 하이픈 10개로 통일', () => {
    const input = '첫 줄\n---------------------------------\n둘째 줄';
    expect(normalizeSmsSeparatorLines(input)).toBe('첫 줄\n----------\n둘째 줄');
  });

  it('등호·언더스코어·전각 대시·혼합 구분선도 통일', () => {
    expect(normalizeSmsSeparatorLines('================')).toBe('----------');
    expect(normalizeSmsSeparatorLines('________________')).toBe('----------');
    expect(normalizeSmsSeparatorLines('──────────────')).toBe('----------');
    expect(normalizeSmsSeparatorLines('- - - - - - - - -')).toBe('----------');
  });

  it('본문 문장 안 대시·짧은 대시는 보존', () => {
    const s = '기간: 7/10 - 7/20\n85,000원 → 72,250원\n---\n주소';
    expect(normalizeSmsSeparatorLines(s)).toBe(s);
  });

  it('빈 값·줄바꿈 구조 보존', () => {
    expect(normalizeSmsSeparatorLines('')).toBe('');
    expect(normalizeSmsSeparatorLines('a\n\nb')).toBe('a\n\nb');
  });
});
