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

describe('sanitizeBriefRecommendations — 5차 확장 (정착 제안 · 채널 제안)', () => {
  it("opportunityType 'journey_promotion'은 신호 미매칭이어도 보존한다 (여정 굳히기 제안)", () => {
    const recs = sanitizeBriefRecommendations(
      [{ title: 'VIP 재구매 여정 정착', objective: 'VIP 재구매 유도를 여정으로 정착', reason: '발송 120건 중 클릭 18건', opportunityType: 'journey_promotion' }],
      OPPS,
    );
    expect(recs[0].opportunityType).toBe('journey_promotion');
    expect(recs[0].targetCount).toBeNull();
  });

  it("recommendedChannel은 sms/email/dm 화이트리스트만, 그 외는 null", () => {
    const recs = sanitizeBriefRecommendations(
      [
        { title: 'a', objective: '이메일 재구매 유도', reason: 'r', recommendedChannel: 'email' },
        { title: 'b', objective: '문자 재구매 유도', reason: 'r', recommendedChannel: 'kakao' },
      ],
      [],
    );
    expect(recs[0].recommendedChannel).toBe('email');
    expect(recs[1].recommendedChannel).toBeNull();
  });
});

describe('buildDailyBriefUserMessage — 5차 확장 입력', () => {
  it('어제 성과와 정착 후보가 들어가면 본문에 포함된다', () => {
    const um = buildDailyBriefUserMessage({
      memoryBlock: '',
      opportunities: OPPS as any,
      activeOperators: [],
      pendingProposals: 0,
      yesterdayRecap: { campaigns: 2, sent: 1743, success: 1740, clicked: 190 },
      promotionCandidates: [{ name: 'VIP 재구매', objective: 'VIP 재구매 유도', sent: 120, clicks: 18 }],
    });
    expect(um).toContain('1,743');
    expect(um).toContain('VIP 재구매');
    expect(um).toContain('120');
    expect(um).toContain('18');
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
