import { describe, test, expect } from 'vitest';
import {
  sanitizeSectionInteractions,
  mergeSectionInteractions,
  sumSectionClicks,
  computeDmProgressPct,
  isDmCompleted,
  clampDurationDelta,
  clampScrollPct,
  MAX_DURATION_DELTA_SEC,
} from './dm-tracking';

describe('sanitizeSectionInteractions — 공개 비콘 입력 정제', () => {
  test('정상 {views, clicks}만 통과', () => {
    expect(sanitizeSectionInteractions({ s1: { views: 2, clicks: 1 } })).toEqual({ s1: { views: 2, clicks: 1 } });
  });

  test('객체 아님/배열/null = 빈 결과', () => {
    expect(sanitizeSectionInteractions(null)).toEqual({});
    expect(sanitizeSectionInteractions([1, 2])).toEqual({});
    expect(sanitizeSectionInteractions('x')).toEqual({});
  });

  test('음수·문자·비유한 카운터는 0 처리, 둘 다 0이면 키 제거', () => {
    expect(sanitizeSectionInteractions({ s1: { views: -5, clicks: 'x' } })).toEqual({});
    expect(sanitizeSectionInteractions({ s1: { views: Infinity, clicks: 3 } })).toEqual({ s1: { views: 0, clicks: 3 } });
  });

  test('키 200개 상한 (공개 endpoint 폭주 차단)', () => {
    const big: any = {};
    for (let i = 0; i < 300; i++) big[`s${i}`] = { views: 1, clicks: 0 };
    expect(Object.keys(sanitizeSectionInteractions(big)).length).toBe(200);
  });
});

describe('mergeSectionInteractions — 증가분 합산 (재방문 누적)', () => {
  test('기존 + 증가분 합산', () => {
    const merged = mergeSectionInteractions({ s1: { views: 3, clicks: 1 } }, { s1: { views: 2, clicks: 0 }, s2: { views: 1, clicks: 1 } });
    expect(merged).toEqual({ s1: { views: 5, clicks: 1 }, s2: { views: 1, clicks: 1 } });
  });

  test('기존이 오염 값이어도(문자 jsonb) 안전 병합', () => {
    expect(mergeSectionInteractions('broken', { s1: { views: 1, clicks: 0 } })).toEqual({ s1: { views: 1, clicks: 0 } });
  });
});

describe('sumSectionClicks — 추적 화면 클릭 지표', () => {
  test('전체 섹션 클릭 합', () => {
    expect(sumSectionClicks({ s1: { views: 9, clicks: 2 }, s2: { views: 1, clicks: 3 } })).toBe(5);
  });
  test('빈/오염 값 = 0', () => {
    expect(sumSectionClicks(null)).toBe(0);
  });
});

describe('computeDmProgressPct — 스크롤 깊이 우선, 구 데이터는 페이지 비율', () => {
  test('max_scroll_pct 있으면 그대로', () => {
    expect(computeDmProgressPct(1, 1, 62)).toBe(62);
  });
  test('깊이 미측정(구 데이터)이면 페이지 비율', () => {
    expect(computeDmProgressPct(2, 4, null)).toBe(50);
  });
  test('total_pages 0 = 0%', () => {
    expect(computeDmProgressPct(1, 0, null)).toBe(0);
  });
  test('경계 clamp — 150 → 100, -5 → 0', () => {
    expect(computeDmProgressPct(1, 1, 150)).toBe(100);
    expect(computeDmProgressPct(1, 1, -5)).toBe(0);
  });
});

describe('isDmCompleted — 완독 판정', () => {
  test('깊이 90% 이상 = 완독', () => {
    expect(isDmCompleted(1, 1, 90)).toBe(true);
    expect(isDmCompleted(1, 1, 89)).toBe(false);
  });
  test('깊이 미측정 + 다페이지 마지막 도달 = 완독 (구 슬라이드 데이터 하위호환)', () => {
    expect(isDmCompleted(3, 3, null)).toBe(true);
    expect(isDmCompleted(2, 3, null)).toBe(false);
  });
  test('깊이 미측정 + 단일 페이지 = 판정 불가 false (구 "열람=완독" 오판 제거)', () => {
    expect(isDmCompleted(1, 1, null)).toBe(false);
  });
});

describe('clamp — 공개 입력 상한', () => {
  test('duration 증가분 상한', () => {
    expect(clampDurationDelta(999999)).toBe(MAX_DURATION_DELTA_SEC);
    expect(clampDurationDelta(-3)).toBe(0);
    expect(clampDurationDelta('abc')).toBe(0);
  });
  test('스크롤 % — 숫자 아님 = null 보존 (0 오염 금지)', () => {
    expect(clampScrollPct(undefined)).toBe(null);
    expect(clampScrollPct('')).toBe(null);
    expect(clampScrollPct(42)).toBe(42);
  });
});
