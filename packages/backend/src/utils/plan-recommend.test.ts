/**
 * plan-recommend — 추천 룰 행렬 검증 (2026-08-16, 마케팅 진단 커밋 3)
 *
 * 설계서 §4-5 룰 행렬을 B안 확정(v1 requires = ai_credits_per_month gte 단일 축)에 맞춰 못 박는다.
 * plans 픽스처는 2026-08-16 운영 실측값(§3-1)과 같은 모양 — 이 값이 바뀌면 경계 케이스도 함께 재검토.
 */
import { describe, it, expect } from 'vitest';
import {
  validateDefinition,
  validateAnswers,
  recommendPlan,
  type DiagnosisDefinition,
  type PlanRowLike,
} from './plan-recommend';

/** B안 v1 축약 정의 — 실 seed와 같은 구조(문항 3: 무조건/AI 크레딧/한도 v2 예비). */
const DEF: DiagnosisDefinition = {
  version: 'v1',
  rule_version: 'r1',
  questions: [
    {
      key: 'industry', text: '어떤 분야이신가요?', type: 'industry_grid',
      options: [{ key: 'fashion', label: '의류/패션' }, { key: 'fnb', label: '식음료/카페' }],
    },
    {
      key: 'ai_usage', text: 'AI 제작은 얼마나 쓰실 것 같나요?', type: 'single',
      options: [
        { key: 'none', label: '안 쓸 것 같아요' },
        { key: 'u10', label: '월 10회 이하', requires: [{ column: 'ai_credits_per_month', op: 'gte', value: 50 }] },
        { key: 'm10_50', label: '월 10~50회', requires: [{ column: 'ai_credits_per_month', op: 'gte', value: 250 }] },
        { key: 'o50', label: '월 50회 이상', requires: [{ column: 'ai_credits_per_month', op: 'gte', value: 500 }] },
      ],
    },
  ],
};

/** v2 예비 — 한도 축 gte_or_null 의미론 검증용(현 seed에는 없음). */
const DEF_V2: DiagnosisDefinition = {
  version: 'v2', rule_version: 'r2',
  questions: [{
    key: 'auto', text: '자동 발송 개수는?', type: 'single',
    options: [
      { key: 'none', label: '필요 없어요' },
      { key: 'q6_10', label: '6~10개', requires: [{ column: 'max_auto_campaigns', op: 'gte_or_null', value: 10 }] },
    ],
  }],
};

function plan(code: string, price: number, credits: number | null, extra: Partial<PlanRowLike> = {}): PlanRowLike {
  return {
    id: `plan-${code}`, plan_code: code, plan_name: code,
    monthly_price: String(price.toFixed(2)),          // PG numeric은 문자열로 온다
    is_active: true, ai_credits_per_month: credits, ...extra,
  };
}

/** 2026-08-16 운영 실측 모양 그대로. */
const PLANS: PlanRowLike[] = [
  plan('FREE', 0, 0),
  plan('TRIAL', 0, 750),
  plan('STAFF', 0, 16500),
  plan('STARTER', 150000, 300, { max_auto_campaigns: null }),
  plan('BASIC', 350000, 750, { max_auto_campaigns: null }),
  plan('PRO', 1000000, 2400, { max_auto_campaigns: 5 }),
  plan('BUSINESS', 3000000, 7800, { max_auto_campaigns: 10 }),
  plan('ENTERPRISE', 5500000, 16500, { max_auto_campaigns: null }),
];

const A = (ai: string) => ({ industry: 'fashion', ai_usage: ai });

describe('recommendPlan — 룰 행렬 (B안 v1)', () => {
  it('①전부 최소(요구조건 0) → 최저 유료 STARTER', () => {
    const r = recommendPlan(DEF, A('none'), PLANS);
    expect(r.plan?.plan_code).toBe('STARTER');
    expect(r.no_match).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('②u10(50)·③m10_50(250) → STARTER(300) 통과 + reasons에 발동 근거', () => {
    expect(recommendPlan(DEF, A('u10'), PLANS).plan?.plan_code).toBe('STARTER');
    const r = recommendPlan(DEF, A('m10_50'), PLANS);
    expect(r.plan?.plan_code).toBe('STARTER');
    expect(r.reasons).toEqual([
      { question: 'AI 제작은 얼마나 쓰실 것 같나요?', option: '월 10~50회', column: 'ai_credits_per_month' },
    ]);
  });

  it('④o50(500) → STARTER(300) 탈락·BASIC(750) 추천', () => {
    const r = recommendPlan(DEF, A('o50'), PLANS);
    expect(r.plan?.plan_code).toBe('BASIC');
  });

  it('⑤후보 필터 — 0원 플랜(FREE·TRIAL·STAFF)·비활성 유료는 어떤 답에도 추천되지 않는다', () => {
    const withInactive = [...PLANS, plan('LEGACY', 90000, 99999, { is_active: false })];
    for (const ai of ['none', 'u10', 'm10_50', 'o50']) {
      const code = recommendPlan(DEF, A(ai), withInactive).plan?.plan_code;
      expect(['STARTER', 'BASIC', 'PRO', 'BUSINESS', 'ENTERPRISE']).toContain(code);
    }
  });

  it('⑥ai_credits NULL 요금제는 0으로 취급되어 탈락한다 (gte — NULL=0 의미론)', () => {
    const rows = [plan('NOVAL', 100000, null), plan('BASIC', 350000, 750)];
    const r = recommendPlan(DEF, A('u10'), rows);
    expect(r.plan?.plan_code).toBe('BASIC');   // NOVAL이 최저가지만 NULL=0 < 50 탈락
  });

  it('⑦만족 0행 = no_match — 억지 추천 금지', () => {
    const rows = [plan('STARTER', 150000, 100), plan('BASIC', 350000, 200)];
    const r = recommendPlan(DEF, A('o50'), rows);
    expect(r.plan).toBeNull();
    expect(r.no_match).toBe(true);
  });

  it('⑧동률 가격은 plan_code ASC 2차 정렬', () => {
    const rows = [plan('BB', 150000, 300), plan('AA', 150000, 300)];
    expect(recommendPlan(DEF, A('none'), rows).plan?.plan_code).toBe('AA');
  });

  it('gte_or_null 의미론(v2 예비) — NULL=무제한 통과·유한값은 비교', () => {
    const r = recommendPlan(DEF_V2, { auto: 'q6_10' }, PLANS);
    // STARTER(NULL=무제한)가 최저가 통과 — 이것이 바로 §3-1 역전 실태다(v1에서 이 축을 뺀 이유).
    expect(r.plan?.plan_code).toBe('STARTER');
    const noNull = PLANS.filter((p) => p.max_auto_campaigns !== null);
    expect(recommendPlan(DEF_V2, { auto: 'q6_10' }, noNull).plan?.plan_code).toBe('BUSINESS'); // PRO 5 < 10 탈락
  });

  it('미검증 answers는 throw — 검증 우회 경로 차단', () => {
    expect(() => recommendPlan(DEF, { industry: 'fashion' } as any, PLANS)).toThrow('answers 검증 미통과');
  });
});

describe('validateAnswers — 완전 검증', () => {
  it('정확 일치만 통과 — 누락·초과·위조·비객체 전부 거부', () => {
    expect(validateAnswers(DEF, A('none')).ok).toBe(true);
    expect(validateAnswers(DEF, {}).ok).toBe(false);                                    // 전 문항 누락
    expect(validateAnswers(DEF, { industry: 'fashion' }).ok).toBe(false);               // 일부 누락
    expect(validateAnswers(DEF, { ...A('none'), extra: 'x' }).ok).toBe(false);          // 초과 키(source_utm 류)
    expect(validateAnswers(DEF, { industry: 'fashion', ai_usage: 'forged' }).ok).toBe(false); // 위조 option
    expect(validateAnswers(DEF, [] as any).ok).toBe(false);
    expect(validateAnswers(DEF, null as any).ok).toBe(false);
  });
});

describe('validateDefinition — seed 게이트', () => {
  it('정상 정의 통과', () => {
    expect(validateDefinition(DEF)).toEqual({ ok: true, errors: [] });
    expect(validateDefinition(DEF_V2).ok).toBe(true);
  });

  it('ai_credits_per_month에 gte_or_null 금지 — NULL=0 컬럼(값 미기재 요금제 최저가 추천 사고 차단)', () => {
    const bad = JSON.parse(JSON.stringify(DEF));
    bad.questions[1].options[1].requires[0].op = 'gte_or_null';
    const r = validateDefinition(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('비허용 op');
  });

  it('미등록 컬럼·value 형식 위반 거부', () => {
    const badCol = JSON.parse(JSON.stringify(DEF));
    badCol.questions[1].options[1].requires[0].column = 'monthly_price';
    expect(validateDefinition(badCol).ok).toBe(false);

    const badVal = JSON.parse(JSON.stringify(DEF));
    delete badVal.questions[1].options[1].requires[0].value;
    expect(validateDefinition(badVal).ok).toBe(false);

    const isTrueVal = JSON.parse(JSON.stringify(DEF));
    isTrueVal.questions[1].options[1].requires[0] = { column: 'mobile_dm_enabled', op: 'is_true', value: 1 };
    expect(validateDefinition(isTrueVal).ok).toBe(false);
  });

  it('문항·선택지 key 중복 거부', () => {
    const dup = JSON.parse(JSON.stringify(DEF));
    dup.questions[1].key = 'industry';
    expect(validateDefinition(dup).ok).toBe(false);
  });
});
