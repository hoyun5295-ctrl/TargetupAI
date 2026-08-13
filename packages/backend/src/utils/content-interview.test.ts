/**
 * content-interview.test.ts — 원스텝 인터뷰 계약 (★ 2026-08-13 Phase 1)
 *
 * 설계서 = docs/2026-08-13-one-step-content-interview-design.md
 * 이 파일이 고정하는 것 = **설계서 §0 판정 원장이 코드에서 살아 있는가**.
 * 여기가 깨지면 기능이 조용히 의미를 잃는다(죽은 질문·마감 없는 카운트다운·원문 오염).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  INTERVIEW_QUESTION_KEYS,
  INTERVIEW_QUESTIONS,
  applyDerivedDefaults,
  buildDecisions,
  buildInterviewEventText,
  buildMasterBrief,
  guessObjective,
  isValidProofUrl,
  nextQuestion,
  remainingUserInputs,
  sanitizeAnswers,
  validateAnswer,
  visibleQuestions,
  type InterviewAnswers,
  type InterviewContext,
  type InterviewDecisions,
} from './content-interview';
import {
  FORCED_SECTIONS,
  INTERVIEW_SECTION_CONTRACT,
  buildDmStructure,
  buildFinalSectionTypes,
} from './dm/dm-interview-contract';
import { estimateOneStep, oneStepGenKey, oneStepInterviewKey } from './one-step-cost';
import { getCreditCost } from './ai-credit-calc';

const CTX: InterviewContext = {
  eventTitle: '가을 신상 위크',
  startsOn: '2026-09-01',
  endsOn: '2026-09-07',
  periodEnd: null,
  mallProducts: [{ name: '니트 가디건', origin: 'mall' }, { name: '울 머플러', origin: 'mall' }],
  hasStoreAddress: false,
};

const BASE: InterviewDecisions = {
  objective: 'new_product',
  urgency: 'none',
  proof: 'none',
  curationCount: 2,
  imageSource: 'product',
  storeShown: false,
  mallProducts: [],
};

describe('무과금의 근거 — 인터뷰 CT는 AI도 DB도 부르지 않는다', () => {
  it('AI·DB import가 0이다', () => {
    const src = readFileSync(path.join(__dirname, 'content-interview.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\.\/services\/ai'/);
    expect(src).not.toMatch(/from '\.\/ai-credit/);
    expect(src).not.toMatch(/from '\.\.\/config\/database'/);
    expect(src).not.toMatch(/\bquery\(/);
    expect(src).not.toMatch(/callAIWithFallback|orchestrate\(/);
  });
});

describe('죽은 질문 0 — 답을 바꾸면 최종 체인이 실제로 달라진다', () => {
  const base = buildFinalSectionTypes(BASE, { hasBenefit: false }).join('>');

  const variants: Record<string, string> = {
    objective: buildFinalSectionTypes({ ...BASE, objective: 'brand_story' }, { hasBenefit: false }).join('>'),
    products: buildFinalSectionTypes({ ...BASE, curationCount: 0 }, { hasBenefit: false }).join('>'),
    benefit: buildFinalSectionTypes(BASE, { hasBenefit: true }).join('>'),
    urgency: buildFinalSectionTypes({ ...BASE, urgency: 'deadline', urgencyEndsAt: '2026-09-07T23:59' }, { hasBenefit: false }).join('>'),
    proof: buildFinalSectionTypes({ ...BASE, proof: 'review', proofText: '좋아요' }, { hasBenefit: false }).join('>'),
    imageSource: buildFinalSectionTypes({ ...BASE, imageSource: 'studio' }, { hasBenefit: false }).join('>'),
    storeInfo: buildFinalSectionTypes({ ...BASE, storeShown: true }, { hasBenefit: false }).join('>'),
  };

  for (const key of INTERVIEW_QUESTION_KEYS) {
    it(`${key} — 답이 바뀌면 결과가 바뀐다`, () => {
      expect(variants[key]).toBeDefined();
      expect(variants[key]).not.toBe(base);
    });
  }

  it('질문표와 계약표의 키가 1:1이다', () => {
    expect(Object.keys(INTERVIEW_SECTION_CONTRACT).sort()).toEqual([...INTERVIEW_QUESTION_KEYS].sort());
    expect(Object.keys(INTERVIEW_QUESTIONS).sort()).toEqual([...INTERVIEW_QUESTION_KEYS].sort());
  });

  it('정규화가 강제하는 축(header·footer·hero·cta)은 묻지 않고, 계약표에도 적지 않는다', () => {
    for (const key of INTERVIEW_QUESTION_KEYS) {
      for (const s of INTERVIEW_SECTION_CONTRACT[key].moves) {
        expect(FORCED_SECTIONS).not.toContain(s);
      }
    }
    // 최종 체인에는 언제나 들어 있다(그래서 질문 대상이 아니다)
    const chain = buildFinalSectionTypes(BASE, { hasBenefit: false });
    for (const s of FORCED_SECTIONS) expect(chain).toContain(s);
  });
});

describe('파생 기본값 — 1클릭 완주는 되지만 지어내지는 않는다', () => {
  it('마감 시각이 없으면 긴급성은 꺼진다 — 마감 없는 카운트다운 금지', () => {
    const d = applyDerivedDefaults({}, { ...CTX, periodEnd: null });
    expect(d.urgency).toEqual({ kind: 'none' });
    expect(buildFinalSectionTypes(buildDecisions({}, { ...CTX, periodEnd: null }))).not.toContain('countdown');
  });

  it('마감 시각이 실존할 때만 카운트다운이 선다', () => {
    const ctx = { ...CTX, periodEnd: '2026-09-07T23:59:59+09:00' };
    expect(applyDerivedDefaults({}, ctx).urgency).toEqual({ kind: 'deadline', endsAt: ctx.periodEnd });
    expect(buildFinalSectionTypes(buildDecisions({}, ctx))).toContain('countdown');
  });

  it('증거는 파생할 수 없다 — 안 물었으면 기본이 없음이다', () => {
    expect(applyDerivedDefaults({}, CTX).proof).toEqual({ kind: 'none' });
    const chain = buildFinalSectionTypes(buildDecisions({}, CTX));
    expect(chain).not.toContain('reviews');
    expect(chain).not.toContain('youtube_embed');
  });

  it('혜택은 프리필하지 않는다 — 비면 비운 채로 간다', () => {
    expect(applyDerivedDefaults({}, CTX).benefit).toBeNull();
    expect(buildFinalSectionTypes(buildDecisions({}, CTX), { hasBenefit: false })).not.toContain('instant_coupon');
  });

  it('몰 상품이 있으면 상품 이미지, 없으면 스튜디오가 기본', () => {
    expect(applyDerivedDefaults({}, CTX).imageSource).toBe('product');
    expect(applyDerivedDefaults({}, { ...CTX, mallProducts: [] }).imageSource).toBe('studio');
  });

  it('매장 주소가 없으면 매장 안내를 켜지 않는다', () => {
    expect(applyDerivedDefaults({}, CTX).storeInfo).toBe(false);
    expect(applyDerivedDefaults({}, { ...CTX, hasStoreAddress: true }).storeInfo).toBe(true);
  });

  it('목적 추정은 결정적이다', () => {
    expect(guessObjective('가을 세일 특가')).toBe('promotion');
    expect(guessObjective('신상 출시')).toBe('new_product');
    expect(guessObjective('매장 오픈 안내')).toBe('store_visit');
    expect(guessObjective('')).toBe('new_product');
  });
});

describe('원문 오염 금지 — 기계가 채운 값은 사실 자격을 얻지 못한다', () => {
  it('몰에서 가져온 상품은 원문에 들어가지 않는다', () => {
    const text = buildInterviewEventText({ products: CTX.mallProducts }, CTX);
    expect(text).not.toContain('니트 가디건');
    expect(text).not.toContain('[상품]');
  });

  it('사용자가 직접 적은 상품만 원문에 들어간다', () => {
    const text = buildInterviewEventText({ products: [{ name: '수제 잼', origin: 'manual' }] }, CTX);
    expect(text).toContain('[상품] 수제 잼');
  });

  it('사용자가 적은 혜택은 그대로 들어간다(문구 변형 없음)', () => {
    const text = buildInterviewEventText({ benefit: '전 품목 2+2' }, CTX);
    expect(text).toContain('[혜택] 전 품목 2+2');
  });

  it('혜택이 비면 혜택 줄 자체가 없다', () => {
    expect(buildInterviewEventText({ benefit: null }, CTX)).not.toContain('[혜택]');
  });

  it('라벨은 EventBrief 필드와 1:1인 것만 쓴다', () => {
    const text = buildInterviewEventText(
      { benefit: '2+2', products: [{ name: '잼', origin: 'manual' }], note: '매장별 재고 상이' },
      CTX,
    );
    const labels = text.split('\n').map((l) => (l.match(/^\[([^\]]+)\]/) || [])[1]).filter(Boolean);
    expect(labels).toEqual(['행사명', '기간', '혜택', '상품', '유의사항']);
  });

  it('마스터프롬프트는 사실 원문과 결정값 두 갈래다(톤은 없다)', () => {
    const brief = buildMasterBrief({ benefit: '2+2' }, CTX);
    expect(Object.keys(brief).sort()).toEqual(['decisions', 'eventText']);
    expect(brief.decisions.mallProducts).toHaveLength(2);
    expect(brief.eventText).toContain('[혜택] 2+2');
  });
});

describe('분기·진행', () => {
  it('브랜드 이야기는 긴급성을 묻지 않는다', () => {
    const keys = visibleQuestions({ objective: 'brand_story' }).map((q) => q.key);
    expect(keys).not.toContain('urgency');
    expect(visibleQuestions({ objective: 'promotion' }).map((q) => q.key)).toContain('urgency');
  });

  it('다음 질문은 아직 안 답한 첫 번째다', () => {
    expect(nextQuestion({})?.key).toBe('objective');
    expect(nextQuestion({ objective: 'promotion' })?.key).toBe('products');
  });

  it('"없음"도 답한 것으로 센다 — 다시 묻지 않는다', () => {
    const a: InterviewAnswers = {
      objective: 'promotion',
      products: [{ name: '잼', origin: 'manual' }],
      benefit: null,
      urgency: { kind: 'none' },
      proof: { kind: 'none' },
      imageSource: 'studio',
      storeInfo: false,
    };
    expect(nextQuestion(a)).toBeNull();
  });

  it('사용자만 아는 축의 남은 개수를 센다 — 프리필된 것은 세지 않는다', () => {
    expect(remainingUserInputs({})).toBe(2); // 혜택·증거
    expect(remainingUserInputs({ benefit: null, proof: { kind: 'none' } })).toBe(0);
  });
});

describe('Phase 2 — 사람이 고른 구성이 AI 재설계에 덮이지 않는다', () => {
  const src = readFileSync(path.join(__dirname, 'dm/dm-ai.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function oneShotGenerate'));

  it('structure가 오면 parsePrompt·designSectionLayout을 부르지 않는다', () => {
    // 두 호출이 모두 structure 분기 **뒤**(else 가지)에 있어야 한다
    const structIdx = fn.indexOf('if (structure) {');
    const parseIdx = fn.indexOf('await parsePrompt(');
    const designIdx = fn.indexOf('await designSectionLayout(');
    expect(structIdx).toBeGreaterThan(0);
    expect(structIdx).toBeLessThan(parseIdx);
    expect(structIdx).toBeLessThan(designIdx);
    expect(fn).toContain('} else if (prompt) {');
    expect(fn).toContain('} else if (scenarioMeta?.sections) {');
  });

  it('정규화는 건너뛰지 않는다 — 발송 가능성의 최소 조건이다', () => {
    expect(fn).toContain('normalizeSectionChain(structure.sectionTypes, spec.objective)');
  });

  it('기존 두 호출부는 structure를 넘기지 않는다(동작 무변경)', () => {
    const route = readFileSync(path.join(__dirname, '../routes/dm.ts'), 'utf8');
    const planner = readFileSync(path.join(__dirname, 'planner-production.ts'), 'utf8');
    expect(route).not.toContain('structure:');
    expect(planner).not.toContain('structure:');
  });

  it('생성기 입력 조립은 계약 파일이 소유한다 — dm-ai는 인터뷰 타입을 모른다', () => {
    expect(src).not.toContain("from '../content-interview'");
    const s = buildDmStructure(BASE, { hasBenefit: true });
    expect(s.objective).toBe('sale');
    expect(s.toneHint).toBe('premium');
    expect(s.sectionTypes).toContain('instant_coupon');
  });
});

describe('Phase 3 — 요금은 한 산식에서 나오고, 발행분을 미리 걷지 않는다', () => {
  it('첫 생성은 생성비 + 대행 델타, 재생성은 생성비만', () => {
    const first = estimateOneStep({ sessionId: 'S1', attempt: 1, interviewPaid: false });
    const again = estimateOneStep({ sessionId: 'S1', attempt: 2, interviewPaid: true });
    expect(first.total).toBe(getCreditCost('dm-ai-generate') + getCreditCost('one-step-interview'));
    expect(again.total).toBe(getCreditCost('dm-ai-generate'));
    expect(first.charges.map((c) => c.source)).toEqual(['dm-ai-generate', 'one-step-interview']);
  });

  it('대행 델타 키는 세션 고정, 생성 키는 회차 포함', () => {
    expect(oneStepInterviewKey('S1')).toBe('one-step:S1');
    expect(oneStepGenKey('S1', 1)).not.toBe(oneStepGenKey('S1', 2));
    const a = estimateOneStep({ sessionId: 'S1', attempt: 1, interviewPaid: false });
    const b = estimateOneStep({ sessionId: 'S1', attempt: 9, interviewPaid: false });
    const keyOf = (q: typeof a, src: string) => q.charges.find((c) => c.source === src)?.idempotencyKey;
    expect(keyOf(a, 'one-step-interview')).toBe(keyOf(b, 'one-step-interview'));
    expect(keyOf(a, 'dm-ai-generate')).not.toBe(keyOf(b, 'dm-ai-generate'));
  });

  it('발행분은 견적에 포함하지 않고, 따로 나간다는 사실을 미리 말한다', () => {
    const q = estimateOneStep({ sessionId: 'S1', attempt: 1, interviewPaid: false });
    expect(q.charges.some((c) => c.source === 'dm-builder')).toBe(false);
    expect(q.publishNotice).toContain('발행');
  });

  it('단가의 진실은 CREDIT_COST_MAP 하나다 — 산식 파일에 숫자를 쓰지 않는다', () => {
    const src = readFileSync(path.join(__dirname, 'one-step-cost.ts'), 'utf8');
    expect(src).toContain("from './ai-credit-calc'");
    expect(src).not.toMatch(/cost:\s*\d+/);
  });

  it('라우트는 표시와 차감에 같은 함수를 쓰고, 프롬프트 통로를 타지 않는다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect((route.match(/estimateOneStep\(/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(route).toContain("prompt: ''");
    expect(route).toContain('structure,');
    // 생성 성공 뒤에 걷는다 — 차감이 생성 호출보다 뒤에 있다
    expect(route.indexOf('await oneShotGenerate(')).toBeLessThan(route.indexOf('deductCreditSafe('));
    // 테이블 미생성 구간은 503으로 답한다
    expect(route).toContain('handleDbMigrationError');
  });

  it('세션 조회·수정에 회사 조건이 직접 걸려 있다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const companyGuards = route.match(/company_id = \$\d::uuid/g) || [];
    expect(companyGuards.length).toBeGreaterThanOrEqual(5);
    expect(route).toContain('requireCompany');
  });
});

describe('검증', () => {
  it('마감을 골랐는데 시각이 없으면 통과하지 않는다', () => {
    expect(validateAnswer('urgency', { kind: 'deadline' }).ok).toBe(false);
    expect(validateAnswer('urgency', { kind: 'deadline', endsAt: '2026-09-07T23:59' }).ok).toBe(true);
  });

  it('후기는 내용이 있어야 한다 — 빈 후기를 만들지 않는다', () => {
    expect(validateAnswer('proof', { kind: 'review', text: '' }).ok).toBe(false);
    expect(validateAnswer('proof', { kind: 'review', text: '배송이 빨라요' }).ok).toBe(true);
  });

  it('증거 주소는 https + 허용 호스트만', () => {
    expect(isValidProofUrl('video', 'https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isValidProofUrl('video', 'http://youtube.com/watch?v=abc')).toBe(false);
    expect(isValidProofUrl('instagram', 'https://instagram.com/p/abc')).toBe(true);
    expect(isValidProofUrl('instagram', 'https://evil.example.com/p/abc')).toBe(false);
  });

  it('상품 0개는 통과하지 않는다', () => {
    expect(validateAnswer('products', []).ok).toBe(false);
    expect(validateAnswer('products', [{ name: '잼' }]).ok).toBe(true);
  });

  it('혜택 없음(null)은 유효한 답이다', () => {
    expect(validateAnswer('benefit', null).ok).toBe(true);
    expect(validateAnswer('benefit', '   ').ok).toBe(false);
  });

  it('모르는 키는 500이 아니라 무시된다 — 버전이 올라가도 세션이 살아 있다', () => {
    expect(validateAnswer('legacy_tone', 'friendly').ok).toBe(false);
    const cleaned = sanitizeAnswers({ objective: 'promotion', legacy_tone: 'friendly', urgency: { kind: 'nope' } });
    expect(cleaned).toEqual({ objective: 'promotion' });
  });
});
