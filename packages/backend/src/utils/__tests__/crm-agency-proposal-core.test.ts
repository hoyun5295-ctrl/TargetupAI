// CRM 캠페인 대행 — 제안서 정규화/출구 가드 순수 코어 테스트 (2026-07-09)
import { describe, it, expect } from 'vitest';
import { normalizeProposal, normalizeAgencyChannel, guardDraftCopyBenefits } from '../crm-agency-proposal-core';
import type { AgencyRequestParsed } from '../crm-agency-request';

const req = (over: Partial<AgencyRequestParsed> = {}): AgencyRequestParsed => ({
  title: '7월 신제품 런칭', periodStart: '2026-07-15', periodEnd: '2026-07-31',
  description: '신제품 A 출시 행사', benefit: '전 구매 고객 10% 할인',
  channels: [], budget: null, note: '', products: [], missingRequired: [], ...over,
});

describe('normalizeAgencyChannel', () => {
  it('화이트리스트 코드는 그대로, 한국어는 매핑, 미상은 lms', () => {
    expect(normalizeAgencyChannel('sms')).toBe('sms');
    expect(normalizeAgencyChannel('알림톡')).toBe('alimtalk');
    expect(normalizeAgencyChannel('문자')).toBe('lms');
    expect(normalizeAgencyChannel('push')).toBe('lms');
  });
});

describe('guardDraftCopyBenefits', () => {
  it('요청 혜택에 있는 표현은 통과한다', () => {
    const r = guardDraftCopyBenefits('%고객명%님, 이번 달 10% 할인!', req());
    expect(r.removed).toBe(false);
    expect(r.copy).toContain('10%');
  });
  it('요청서에 없는 구체 혜택 줄은 제거하고 removed=true', () => {
    const r = guardDraftCopyBenefits('첫 줄 안내\n지금 오시면 5,000원 쿠폰 증정!', req());
    expect(r.removed).toBe(true);
    expect(r.copy).not.toContain('5,000원');
    expect(r.copy).toContain('첫 줄 안내');
  });
  it('상품 가격 수치는 허용된다', () => {
    const r = guardDraftCopyBenefits('신제품 A 29000원 특가', req({ products: [{ name: '신제품 A', price: 39000, salePrice: 29000 }] }));
    expect(r.removed).toBe(false);
  });
});

describe('normalizeProposal', () => {
  it('plans를 정규화하고 최대 5개로 자른다', () => {
    const raw = {
      situation: ['고객 1,000명'], eventSummary: '요약',
      plans: Array.from({ length: 7 }, (_, i) => ({
        title: `플랜${i}`, objective: `목표${i}`, channel: 'LMS',
        targetDescription: 'VIP 등급', timing: '7/15 10시', draftCopy: '문안', expectedNote: '',
      })),
      insights: [], risks: [],
    };
    const out = normalizeProposal(raw, '테스트사', req());
    expect(out.plans.length).toBe(5);
    expect(out.plans[0].channel).toBe('lms');
    expect(out.plans[0].targetCount).toBeNull(); // 실측 전
  });
  it('plans 0건이면 throw (위장 성공 금지)', () => {
    expect(() => normalizeProposal({ plans: [] }, '테스트사', req())).toThrow();
  });
  it('중괄호 템플릿 문법이 든 문안은 평문화된다', () => {
    const raw = {
      plans: [{ title: 'A', objective: '목표', channel: 'lms', targetDescription: 'VIP',
        timing: '', draftCopy: '{% if customer.grade %}VIP님{% endif %} 안내', expectedNote: '' }],
    };
    const out = normalizeProposal(raw, '테스트사', req());
    expect(out.plans[0].draftCopy).not.toContain('{%');
  });
});
