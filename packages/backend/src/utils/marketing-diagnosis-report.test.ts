/**
 * marketing-diagnosis-report — 결과 조립 검증 (2026-08-16, 마케팅 진단 커밋 2)
 *
 * 못 박는 것
 *   1. 잠금 소견은 실효 게이트 4축(DM·자동발송·AI·자사몰)만 — 고객DB 단어가 등장하면 거짓 리포트(§3-1).
 *   2. 퍼널 B(usage null)는 금액·발송 실적 effect가 0개 — 원화 표기 자체가 없어야 한다(§2-8).
 *   3. 크레딧 환산은 CREDIT_COST_MAP 파생 횟수만 — 원 단가 문자열 비노출.
 *   4. no_match = 추천 카드 null + 상담 summary(오추천 금지).
 *   5. 숫자 확정형 — 사용금액은 계산 시점 1회 반올림.
 */
import { describe, it, expect } from 'vitest';
import { buildDiagnosisResult } from './marketing-diagnosis-report';
import type { DiagnosisDefinition, RecommendResult, PlanRowLike } from './plan-recommend';
import type { MonthlyUsage } from './monthly-usage';

const DEF: DiagnosisDefinition = {
  version: 'v1', rule_version: 'r1',
  questions: [
    { key: 'industry', text: '어떤 분야이신가요?', type: 'industry_grid', options: [{ key: 'fashion', label: '의류/패션' }] },
    { key: 'ai_usage', text: 'AI 사용량은?', type: 'single', options: [{ key: 'u10', label: '월 10회 이하' }] },
  ],
};

const STARTER: PlanRowLike = {
  id: 'p1', plan_code: 'STARTER', plan_name: '스타터', monthly_price: '150000.00',
  is_active: true, ai_credits_per_month: 300,
};

const RECOMMEND: RecommendResult = {
  plan: STARTER,
  reasons: [{ question: 'AI 사용량은?', option: '월 10회 이하', column: 'ai_credits_per_month' }],
  no_match: false,
  no_match_kind: null,
};

const USAGE: MonthlyUsage = {
  totalSent: 120, totalSuccess: 100, totalFail: 20,
  smsSent: 80, lmsSent: 20, mmsSent: 0, kakaoSent: 0,
  monthlyCost: 1234.56,
  costs: { sms: 9.9, lms: 27.5, mms: 66, kakao: 7.5 },
};

const ANSWERS = { industry: 'fashion', ai_usage: 'u10' };

describe('buildDiagnosisResult', () => {
  it('퍼널 A — 실적·금액·크레딧 환산·추천·업종 예시가 전부 실린다', () => {
    const r = buildDiagnosisResult({
      definition: DEF, answers: ANSWERS, recommend: RECOMMEND,
      usage: USAGE, brandVoiceMissing: false, grantOutcome: 'granted',
    });
    expect(r.v).toBe(1);
    expect(r.grant_outcome).toBe('granted');
    expect(r.examples.industry).toBe('fashion');
    expect(r.recommendation).toMatchObject({ plan_code: 'STARTER', monthly_price: 150000 });
    expect(r.recommendation?.reasons).toHaveLength(1);

    const usageEffects = r.effects.filter((e) => e.kind === 'usage');
    expect(usageEffects.map((e) => e.value).join(' ')).toContain('성공 100건');
    expect(usageEffects.map((e) => e.value).join(' ')).toContain('1,235원');   // 반올림 1회(1234.56 → 1,235)

    const conv = r.effects.find((e) => e.kind === 'credit_conversion');
    expect(conv?.value).toContain('문안 생성 월 60회');                        // 300 ÷ 5
    expect(conv?.value).not.toContain('원');                                   // 단가 비노출
    for (const e of r.effects) expect(e.source.length).toBeGreaterThan(0);     // Source caption 의무
  });

  it('잠금 소견 = 4축만 — 고객DB 단어 금지(FREE도 열려 있는 축을 잠금 근거로 쓰면 거짓)', () => {
    const r = buildDiagnosisResult({
      definition: DEF, answers: ANSWERS, recommend: RECOMMEND,
      usage: USAGE, brandVoiceMissing: false, grantOutcome: 'granted',
    });
    const locked = r.findings.find((f) => f.key === 'locked_features');
    expect(locked).toBeDefined();
    for (const axis of ['모바일 DM', '자동 발송', 'AI 제작', '자사몰 연동']) {
      expect(locked!.text).toContain(axis);
    }
    expect(JSON.stringify(r.findings)).not.toContain('고객DB');
    expect(JSON.stringify(r.findings)).not.toContain('고객 DB');
  });

  it('퍼널 B(usage null) — 발송 실적·원화 effect 0개(금액 0 원칙)', () => {
    const r = buildDiagnosisResult({
      definition: DEF, answers: ANSWERS, recommend: RECOMMEND,
      usage: null, brandVoiceMissing: false, grantOutcome: null,
    });
    expect(r.effects.filter((e) => e.kind === 'usage')).toHaveLength(0);
    expect(JSON.stringify(r.effects)).not.toContain('원');
    expect(r.grant_outcome).toBeNull();
  });

  it('no_match — 추천 null + 상담 summary(억지 추천 금지)', () => {
    const r = buildDiagnosisResult({
      definition: DEF, answers: ANSWERS,
      recommend: { plan: null, reasons: [], no_match: true, no_match_kind: 'other' },
      usage: null, brandVoiceMissing: false, grantOutcome: null,
    });
    expect(r.recommendation).toBeNull();
    expect(r.no_match).toBe(true);
    expect(r.summary).toContain('상담');
  });

  it('브랜드 보이스 미등록이면 소견이 추가된다', () => {
    const r = buildDiagnosisResult({
      definition: DEF, answers: ANSWERS, recommend: RECOMMEND,
      usage: null, brandVoiceMissing: true, grantOutcome: 'not_eligible',
    });
    expect(r.findings.some((f) => f.key === 'brand_voice_missing')).toBe(true);
  });
});
