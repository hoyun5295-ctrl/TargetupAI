// daily-brief-policy 순수 정책 테스트 — 오늘의 추천(일일 분석 엔진) 3단계 (2026-07-02)
// 원칙: 숫자는 실데이터만(AI 숫자 무시), 구체 혜택 생성 금지, 추천 최대 3건, JSON 안전 파싱.
import { describe, it, expect } from 'vitest';
import {
  sanitizeBriefRecommendations, extractJsonObject,
  buildDailyBriefSystemPrompt, buildDailyBriefUserMessage,
} from './daily-brief-policy';

const OPPS = [
  { type: 'dormant', title: '휴면 고객 회복', count: 321, valueAtStake: 1500000, suggestedObjective: '휴면 고객 복귀 유도' },
  { type: 'birthday', title: '생일 고객', count: 12, valueAtStake: 90000, suggestedObjective: '이번 달 생일 고객 축하' },
];

describe('sanitizeBriefRecommendations — 추천 검증·실데이터 귀속', () => {
  it('배열이 아니면 빈 배열, 최대 3건으로 자른다', () => {
    expect(sanitizeBriefRecommendations(null, [])).toEqual([]);
    expect(sanitizeBriefRecommendations('x', [])).toEqual([]);
    const four = Array.from({ length: 4 }, (_, i) => ({ title: `추천${i}`, objective: `목표를 달성한다 ${i}`, reason: '근거' }));
    expect(sanitizeBriefRecommendations(four, []).length).toBe(3);
  });

  it('opportunityType이 실측 신호와 일치하면 targetCount를 실데이터 count로 덮는다 (AI 숫자 무시)', () => {
    const recs = sanitizeBriefRecommendations(
      [{ title: '휴면 회복', objective: '휴면 고객을 복귀 유도', reason: '휴면 신호', opportunityType: 'dormant', targetCount: 99999 }],
      OPPS,
    );
    expect(recs[0].targetCount).toBe(321);
  });

  it('title/objective에 구체 혜택(%·쿠폰·무료·N원)이 있으면 그 추천을 버린다', () => {
    const recs = sanitizeBriefRecommendations(
      [
        { title: '30% 할인 프로모션', objective: '전 고객에게 30% 할인 안내', reason: 'r' },
        { title: '쿠폰 지급', objective: '쿠폰을 뿌린다', reason: 'r' },
        { title: '휴면 회복', objective: '휴면 고객을 복귀 유도', reason: '누적 구매액 ₩1,500,000 규모', opportunityType: 'dormant' },
      ],
      OPPS,
    );
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('휴면 회복');
  });

  it('objective가 5자 미만이거나 없으면 버린다', () => {
    const recs = sanitizeBriefRecommendations(
      [{ title: 't', objective: '짧다', reason: 'r' }, { title: 't2', reason: 'r' }],
      [],
    );
    expect(recs).toEqual([]);
  });
});

describe('extractJsonObject — AI 응답 JSON 안전 파싱', () => {
  it('json 코드펜스와 평문 JSON 모두 파싱한다', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')?.a).toBe(1);
    expect(extractJsonObject('{"a":2}')?.a).toBe(2);
    expect(extractJsonObject('앞말 {"a":3} 뒷말')?.a).toBe(3);
    expect(extractJsonObject('JSON 아님')).toBeNull();
  });
});

describe('프롬프트 빌더 — 금지 원칙 포함, 모델명 미노출', () => {
  it('system에 구체 혜택 금지·제공 숫자만 사용 지시가 있고 모델명이 없다', () => {
    const sys = buildDailyBriefSystemPrompt();
    expect(sys).toMatch(/혜택.*금지|금지.*혜택/);
    expect(sys).toContain('제공된');
    expect(sys).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude/i);
  });

  it('userMessage에 실측 신호와 운영 중 목표가 들어간다', () => {
    const um = buildDailyBriefUserMessage({
      memoryBlock: '## Company Memory',
      opportunities: OPPS as any,
      activeOperators: [{ name: 'VIP 재구매', objective: 'VIP 재구매 유도' }],
      pendingProposals: 2,
    });
    expect(um).toContain('휴면 고객 회복');
    expect(um).toContain('321');
    expect(um).toContain('VIP 재구매 유도');
    expect(um).toContain('Company Memory');
  });
});
