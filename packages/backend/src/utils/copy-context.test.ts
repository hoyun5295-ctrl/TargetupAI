import { describe, test, expect } from 'vitest';
import { buildTemporalContext, buildIndustryEvents, renderContextForPrompt } from './copy-context';

describe('buildTemporalContext — KST 기준 시의성 분류 (외부 의존 0, 달력 사실만)', () => {
  test('여름 토요일 정오 + 광복절', () => {
    const t = buildTemporalContext(new Date('2026-08-15T03:00:00Z')); // KST 2026-08-15 12:00 토
    expect(t.date).toBe('2026-08-15');
    expect(t.season).toBe('summer');
    expect(t.weekday).toBe('토');
    expect(t.isWeekend).toBe(true);
    expect(t.dayPart).toBe('noon');
    expect(t.holiday).toBe('광복절');
  });

  test('봄 평일 오전 — 공휴일 없음', () => {
    const t = buildTemporalContext(new Date('2026-03-04T01:00:00Z')); // KST 10:00 수
    expect(t.season).toBe('spring');
    expect(t.weekday).toBe('수');
    expect(t.isWeekend).toBe(false);
    expect(t.dayPart).toBe('morning');
    expect(t.holiday).toBeNull();
  });

  test('설날(음력 고정표 2026) 인식', () => {
    const t = buildTemporalContext(new Date('2026-02-17T02:00:00Z')); // KST 11:00 화
    expect(t.holiday).toBe('설날');
  });

  test('추석(음력 고정표 2026) 인식', () => {
    const t = buildTemporalContext(new Date('2026-09-25T02:00:00Z')); // KST 11:00 금
    expect(t.holiday).toBe('추석');
  });
});

describe('buildIndustryEvents — 업종+시기 매칭만', () => {
  test('11월 말 = 블랙프라이데이 주간', () => {
    const ev = buildIndustryEvents('fashion', new Date('2026-11-25T01:00:00Z'));
    expect(ev.some((e) => e.key === 'black_friday')).toBe(true);
  });

  test('업종 null 이어도 배열 안전(공통 이벤트)', () => {
    const ev = buildIndustryEvents(null, new Date('2026-03-04T01:00:00Z'));
    expect(Array.isArray(ev)).toBe(true);
  });

  test('이벤트 없는 한산한 시기 = 빈 배열 또는 공통만', () => {
    const ev = buildIndustryEvents('fashion', new Date('2026-03-04T01:00:00Z'));
    expect(Array.isArray(ev)).toBe(true);
  });
});

describe('renderContextForPrompt — 값 있는 항목만 한국어 문장, 빈 입력 안전', () => {
  test('겨울 + 크리스마스 이브 문맥', () => {
    const ctx = {
      temporal: buildTemporalContext(new Date('2026-12-24T03:00:00Z')), // KST 12:00 목, winter
      industryEvents: [],
    };
    const s = renderContextForPrompt(ctx);
    expect(typeof s).toBe('string');
    expect(s).toContain('겨울');
  });

  test('빈 industryEvents·맥락이어도 throw 없음', () => {
    const ctx = {
      temporal: buildTemporalContext(new Date('2026-03-04T01:00:00Z')),
      industryEvents: [],
    };
    expect(() => renderContextForPrompt(ctx)).not.toThrow();
  });
});
