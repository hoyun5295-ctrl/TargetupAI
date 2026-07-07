// marketing-calendar-policy 순수 정책 테스트 — 4차 마케팅 캘린더 (2026-07-02)
import { describe, it, expect } from 'vitest';
import {
  sanitizeCalendarEntries,
  buildCalendarSystemPrompt,
  buildCalendarUserMessage,
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

  it('targetHint 화이트리스트 지시와 JSON 필드 예시를 담는다 (2026-07-07 완비)', () => {
    const sys = buildCalendarSystemPrompt();
    expect(sys).toContain('targetHint');
    expect(sys).toContain('"all"');
    expect(sys).toContain('dormant');
    expect(sys).toContain('휴면 고객');
  });
});

describe('sanitizeCalendarEntries — targetHint 축 (2026-07-07 완비)', () => {
  it('화이트리스트 값은 보존, 이상값·미지정은 all', () => {
    const entries = sanitizeCalendarEntries([
      { month: 3, title: '봄맞이', objective: '휴면 고객 재방문 유도 안내', targetHint: 'dormant' },
      { month: 7, title: '여름 성수기', objective: '최근 구매 고객 추가 구매 유도', targetHint: 'churn_risk_high' },
      { month: 9, title: '추석 인사', objective: '전체 고객 명절 인사 전달' },
    ]);
    expect(entries.find((e) => e.month === 3)?.targetHint).toBe('dormant');
    expect(entries.find((e) => e.month === 7)?.targetHint).toBe('all'); // 예측 축 유입 = all로 강등
    expect(entries.find((e) => e.month === 9)?.targetHint).toBe('all');
  });
});

describe('missingCalendarMonths — 결손 달 판정 (2026-07-05 보정 재호출)', () => {
  it('빈 배열이면 1~12 전부, 가득 차면 빈 배열', () => {
    expect(missingCalendarMonths([])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const full = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, title: 't', objective: '목표 다섯자 이상', suggestedDay: 1, targetHint: 'all' as const }));
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

describe('buildCalendarUserMessage — P2-6 회사 실데이터 컨텍스트 (2026-07-05)', () => {
  const base = { businessType: '카페', brandName: '한줄로', brandTone: null, customerCount: 100, currentMonth: 7 };

  it('컨텍스트 미지정 = 기본 프롬프트(절 없음) — 폴백 유지', () => {
    const msg = buildCalendarUserMessage(base);
    expect(msg).toContain('## 회사 정보');
    expect(msg).not.toContain('구매 실측');
    expect(msg).not.toContain('학습 메모리');
    expect(msg).not.toContain('운영 중인 자동 캠페인');
    expect(msg).toContain('1년치 시즌 캠페인 캘린더를 JSON으로 설계');
  });

  it('월별 구매 실측 절 — 실데이터 행과 설계 지시 포함', () => {
    const msg = buildCalendarUserMessage({
      ...base,
      monthlyRevenue: [{ month: 5, purchases: 120, revenue: 3400000 }, { month: 12, purchases: 300, revenue: 9100000 }],
    });
    expect(msg).toContain('구매 실측');
    expect(msg).toContain('5월: 구매 120건');
    expect(msg).toContain('3,400,000원');
    expect(msg).toMatch(/성수기.*캠페인/);
  });

  it('학습 메모리·기존 캠페인 절 — 내용과 중복 회피 지시 포함', () => {
    const msg = buildCalendarUserMessage({
      ...base,
      memoryContext: '- 금요일 오전 발송 반응이 좋다',
      existingCampaigns: [
        { name: '3월 화이트데이', schedule: 'yearly', scheduleMonth: 3, scheduleDayOfMonth: 14 },
        { name: 'VIP 리텐션', schedule: 'monthly', scheduleMonth: null, scheduleDayOfMonth: 1 },
      ],
    });
    expect(msg).toContain('금요일 오전 발송 반응이 좋다');
    expect(msg).toContain('3월 화이트데이 (매년 3월 14일)');
    expect(msg).toContain('VIP 리텐션 (매월 1일)');
    expect(msg).toMatch(/겹치.*피하/);
  });

  it('빈 배열·빈 문자열 컨텍스트 = 절 생략', () => {
    const msg = buildCalendarUserMessage({ ...base, monthlyRevenue: [], memoryContext: '  ', existingCampaigns: [] });
    expect(msg).not.toContain('구매 실측');
    expect(msg).not.toContain('학습 메모리');
    expect(msg).not.toContain('운영 중인 자동 캠페인');
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
