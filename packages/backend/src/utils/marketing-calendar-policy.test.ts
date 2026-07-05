// marketing-calendar-policy 순수 정책 테스트 — 4차 마케팅 캘린더 (2026-07-02)
import { describe, it, expect } from 'vitest';
import {
  sanitizeCalendarEntries,
  buildCalendarSystemPrompt,
  missingCalendarMonths,
  buildCalendarRepairMessage,
} from './marketing-calendar-policy';

describe('sanitizeCalendarEntries — 연간 캠페인 설계 검증', () => {
  it('배열 아님 → 빈 배열, 월 1~12 밖·중복 월은 버린다', () => {
    expect(sanitizeCalendarEntries(null)).toEqual([]);
    const entries = sanitizeCalendarEntries([
      { month: 1, title: '새해 인사', objective: '새해 안부와 신년 소식 안내' },
      { month: 1, title: '중복 1월', objective: '중복 월은 버려져야 한다' },
      { month: 13, title: '없는 달', objective: '13월은 존재하지 않는다' },
      { month: 7, title: '여름 캠페인', objective: '여름 휴가철 안부와 시즌 소식 안내' },
    ]);
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.month)).toEqual([1, 7]);
  });

  it('구체 혜택(%·쿠폰·무료·N원)이 있는 항목은 버린다', () => {
    const entries = sanitizeCalendarEntries([
      { month: 3, title: '30% 세일', objective: '봄맞이 30% 할인 안내' },
      { month: 4, title: '봄나들이', objective: '벚꽃 시즌 안부와 소식 안내' },
    ]);
    expect(entries.length).toBe(1);
    expect(entries[0].month).toBe(4);
  });

  it('발송일은 1~28로 클램프, 미지정은 1', () => {
    const entries = sanitizeCalendarEntries([
      { month: 5, title: '가정의 달', objective: '가정의 달 감사 인사', suggestedDay: 31 },
      { month: 6, title: '여름맞이', objective: '여름맞이 소식 안내' },
    ]);
    expect(entries[0].suggestedDay).toBe(28);
    expect(entries[1].suggestedDay).toBe(1);
  });
});

describe('buildCalendarSystemPrompt — 원칙 포함·모델명 미노출', () => {
  it('구체 혜택 금지 지시가 있고 모델명이 없다', () => {
    const sys = buildCalendarSystemPrompt();
    expect(sys).toMatch(/혜택.*금지|금지.*혜택/);
    expect(sys).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude/i);
  });
});

describe('missingCalendarMonths — 결손 달 판정 (2026-07-05 보정 재호출)', () => {
  it('빈 배열이면 1~12 전부, 가득 차면 빈 배열', () => {
    expect(missingCalendarMonths([])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const full = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, title: 't', objective: '목표 다섯자 이상', suggestedDay: 1 }));
    expect(missingCalendarMonths(full)).toEqual([]);
  });

  it('걸러진 달만 정확히 골라낸다', () => {
    const entries = sanitizeCalendarEntries([
      { month: 3, title: '30% 세일', objective: '봄맞이 30% 할인 안내' }, // 혜택 → 걸러짐
      { month: 4, title: '봄나들이', objective: '벚꽃 시즌 안부와 소식 안내' },
    ]);
    const missing = missingCalendarMonths(entries);
    expect(missing).toContain(3);
    expect(missing).not.toContain(4);
    expect(missing.length).toBe(11);
  });
});

describe('buildCalendarRepairMessage — 보정 요청', () => {
  const input = { businessType: '카페', brandName: '한줄로', brandTone: null, customerCount: 100, currentMonth: 7 };

  it('부족 달 목록과 혜택 금지 재강조를 포함한다', () => {
    const msg = buildCalendarRepairMessage(input, [3, 9]);
    expect(msg).toContain('3, 9월');
    expect(msg).toMatch(/혜택.*(금지|절대 넣지)/);
    expect(msg).toContain('카페');
  });

  it('모델명이 없다', () => {
    expect(buildCalendarRepairMessage(input, [1])).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude/i);
  });
});
