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
    expect(route.indexOf('oneShotGenerate({')).toBeLessThan(route.indexOf('deductCreditOutcome('));
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

// ★ 2026-08-14 적대 검토 정정 — 세션은 "돈을 낸 단위"다. 그 단위가 1회용이 되면 안전장치가 전부 실효 0이 된다.
//    Codex 1R(high 4) 뒤 뿌리 둘로 재정리: ①과금 진실은 원장 하나 ②생성은 상태를 선점한다.
describe('0814 정정 — 과금 진실은 원장 하나다(표식 사본 금지)', () => {
  it('견적·생성 모두 원장에 묻는다 — 세션 표식을 읽지 않는다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const asked = route.match(/await isChargedByKey\(companyId, oneStepInterviewKey\(/g) || [];
    expect(asked.length).toBeGreaterThanOrEqual(2);   // 견적 · 생성
    // 표식을 진실로 쓰던 옛 형태가 남아 있지 않다(사본을 다시 만들면 두 진실이 갈린다)
    expect(route).not.toContain('interview_paid_at = NOW()');
    expect(route).not.toContain('shouldMarkInterviewPaid');
    expect(route).not.toMatch(/AS paid/);
  });

  it('걷지 못한 항목은 키·세션·회차와 함께 남긴다 — 수동 재차감이 정책이라 대상을 특정할 수 있어야 한다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toMatch(/const outcome = await deductCreditOutcome\(/);
    expect(route).toContain('collected.push(c)');
    expect(route).toMatch(/CREDIT\]\[MISS\][\s\S]{0,120}key=\$\{c\.idempotencyKey\}/);
    expect(route).toMatch(/session=\$\{s\.id\} attempt=\$\{attempt\}/);
  });

  it('요금 CT는 원장을 진실로 삼는다고 명시한다 — 다음 사람이 표식을 다시 만들지 않게', () => {
    const src = readFileSync(path.join(__dirname, 'one-step-cost.ts'), 'utf8');
    expect(src).toContain('isChargedByKey');
    expect(src).not.toContain('shouldMarkInterviewPaid');
  });
});

// ★ Codex 2R·3R·4R이 같은 축(선점·차감 원자성)을 세 번 지적했다. 5R에서 잠금 방식이
//    **공용 DB 풀을 고갈시켜 백엔드 전체를 멈춘다**는 것이 드러나, 잠금을 걷고 lease + CAS로 돌아왔다.
//    남는 창(차감 하나가 10분 초과)은 계통 장애 상황이라 **명시적으로 수용**한다 — 라우트 주석이 근거를 갖는다.
describe('0814 정정 — 생성은 상태를 선점하고, 돈은 그 안에서 쓴다', () => {
  it('선점은 generating 원자 전이다 — 동시 요청 둘째는 0행이라 409', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toContain("SET status = 'generating', attempt = attempt + 1");
    expect(route).toContain("AND (status IN ('draft', 'generated')");
    expect(route).toContain('ONE_STEP_GENERATING');
    expect(route).toContain('409');
  });

  it('DB 커넥션을 쥐고 AI를 호출하지 않는다 — 풀(max 20)이 마르면 백엔드 전체가 선다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).not.toContain('pool.connect()');
    expect(route).not.toContain('pg_try_advisory_lock');
  });

  it('끊긴 선점은 10분 lease로 회수한다 — 없으면 그 세션이 영구히 잠긴다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const leases = route.match(/status = 'generating' AND updated_at < NOW\(\) - INTERVAL '10 minutes'/g) || [];
    expect(leases.length).toBeGreaterThanOrEqual(2);   // 재선점 · 이어받기
  });

  it('실패하면 선점을 푼다 — 내가 잡은 회차일 때만(남의 선점을 풀지 않는다)', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toContain('let claimedAttempt = 0');
    expect(route).toMatch(/if \(claimedAttempt > 0\) \{[\s\S]{0,400}SET status = 'draft'[\s\S]{0,300}AND attempt = \$\d/);
  });

  it('돈을 쓰기 전에 소유권을 재확인하고 lease를 새로 시작한다 — 남는 창을 차감 하나로 좁힌다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toContain('const stillOurs = await holdClaim();');
    expect(route).toContain('stillOurs.rows.length !== 1');
    expect(route).toContain('ONE_STEP_CLAIM_LOST');
    // 재확인이 lease를 갱신한다(갱신이 없으면 생성 시간이 창에 계속 포함된다)
    expect(route).toMatch(/const holdClaim = \(\) => query\(\s*`UPDATE \$\{TABLE\} SET updated_at = NOW\(\)/);
    // 순서 = 생성 → 재확인 → 차감 → 최종화
    expect(route.indexOf('oneShotGenerate({')).toBeLessThan(route.indexOf('const stillOurs = await holdClaim();'));
    expect(route.indexOf('const stillOurs = await holdClaim();')).toBeLessThan(route.indexOf('deductCreditOutcome('));
    expect(route.indexOf('deductCreditOutcome(')).toBeLessThan(route.indexOf('const finalize = await query('));
    // 재확인은 삼키지 않는다 — 오류면 던져서 선점 해제·500으로 간다(그 경로엔 차감이 없다)
    expect(route).not.toMatch(/const holdClaim = \(\) => query\([\s\S]{0,400}\)\.catch\(/);
  });

  // ★ Codex 7R — 제외법(견적 − 실패분)은 "시도조차 안 한 항목"을 걷힌 것으로 센다.
  it('걷힌 금액은 양수로 모아서 싣는다 — 견적에서 빼면 미시도 항목이 청구된 것처럼 보인다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toContain('collected.push(c)');
    expect(route).toContain('charges: collected, total: sumOneStepCharges(collected)');
    // 옛 제외법 형태로 되돌아가지 않는다
    expect(route).not.toContain('unpaidKeys');
    expect(route).not.toMatch(/quote\.charges\.filter\(/);
  });

  // ★ Codex 8R — "세션이 이 결과를 가리키는가"는 원인이 셋(선점 상실·확인 실패·최종화 미확정)이지만
  //    사용자에게는 한 사실이다. 따로 판정해 일부만 실으면 화면이 정상 완료로 오인한다.
  it('세션 불일치는 판정 하나로 모아 한 번만 내보낸다 — 세 원인이 모두 같은 표식을 세운다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const marks = route.match(/sessionDetached = true;/g) || [];
    expect(marks.length).toBeGreaterThanOrEqual(3);   // 확인 실패 · 선점 상실 · 최종화 미확정
    expect(route).toContain('sessionDetached: sessionDetached || undefined');
    // 선점을 잃었으면 최종화를 아예 시도하지 않는다(남의 회차를 건드리지 않는다)
    expect(route).toMatch(/if \(!sessionDetached\) \{[\s\S]{0,200}const finalize = await query\(/);
    // 옛 이름으로 되돌아가지 않는다
    expect(route).not.toContain('claimLost');
  });

  it('차감 중 소유권 확인이 던져도 500으로 흘리지 않는다 — 걷힌 돈과 결과를 잃고 재시도에서 또 걷힌다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toMatch(/try \{\s*own = await holdClaim\(\);\s*\} catch \(e: any\) \{[\s\S]{0,300}break;/);
  });

  it('클라이언트가 세션 불일치를 받아서 구분한다 — 서버 필드에 소비처가 없으면 없는 것과 같다', () => {
    const modal = readFileSync(path.join(__dirname, '../../../frontend/src/components/dm/OneStepInterviewModal.tsx'), 'utf8');
    expect(modal).toContain('onGenerated(d.data as GeneratedPayload, sessionId, !!d.sessionDetached)');
    const page = readFileSync(path.join(__dirname, '../../../frontend/src/pages/DmBuilderPage.tsx'), 'utf8');
    expect(page).toMatch(/onGenerated=\{\(payload, _sessionId, sessionDetached\)/);
    expect(page).toContain('sessionDetached');
  });

  it('크레딧제 미적용 회사는 견적도 0이다 — 화면 금액과 실차감(0)이 갈리지 않게', () => {
    expect(estimateOneStep({ sessionId: 'x', attempt: 1, interviewPaid: false, creditEnabled: false }).total).toBe(0);
    expect(estimateOneStep({ sessionId: 'x', attempt: 1, interviewPaid: false, creditEnabled: true }).total).toBeGreaterThan(0);
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const passed = route.match(/estimateOneStep\(\{[^}]*creditEnabled[^}]*\}\)/g) || [];
    expect(passed.length).toBeGreaterThanOrEqual(2);   // 견적 · 생성
  });

  // ★ Codex 9R — 가격을 정하는 자리에서 fail-open 조회를 쓰면 견적만 0원이 되고 생성은 양수를 걷는다.
  it('가격 판정 상태는 엄격 조회로 읽는다 — 실패를 미적용으로 접으면 승인 안 한 금액이 나간다', () => {
    const credit = readFileSync(path.join(__dirname, 'ai-credit.ts'), 'utf8');
    expect(credit).toContain('export async function isCreditEnabledStrict');
    // 엄격 함수는 조회 실패를 삼키지 않는다(관대한 getCreditState는 그대로 둔다)
    expect(credit).not.toMatch(/isCreditEnabledStrict[\s\S]{0,500}catch[\s\S]{0,120}return false/);
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const strict = route.match(/await isCreditEnabledStrict\(companyId\)/g) || [];
    expect(strict.length).toBeGreaterThanOrEqual(2);   // 견적 · 생성
    // 관대한 조회를 가격에 쓰지 않는다
    expect(route).not.toContain('getCreditState');
  });

  // ★ Codex 10R — 차감 뒤 원장을 다시 조회하면, 그 조회가 한 번 실패했을 때
  //    **실제로 걷힌 돈을 미수로 단정**해 거짓 미수 로그와 과소 청구를 만든다.
  //    `not_applicable`의 조건은 엄격 조회가 이미 걸러 0원이 되므로 사후 조회는 덧댄 장치였다.
  it('차감 뒤 원장을 다시 조회하지 않는다 — 조회 실패가 실제 수금을 미수로 뒤집는다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).not.toContain('inLedger');
    // 사후 재조회로 되돌아가지 않는다(멱등키로 원장을 다시 묻는 형태)
    expect(route).not.toMatch(/isChargedByKey\(companyId, c\.idempotencyKey\)/);
  });

  // ★ Codex 11R — true/false로는 "돈이 실제로 빠졌는가"를 못 가른다.
  //    생성 중 크레딧제가 꺼지면 not_applicable이 true로 접혀 무과금이 청구로 보고된다.
  it('수금 판정은 결말로 가른다 — deducted·duplicate만 걷힌 것이다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toMatch(/const outcome = await deductCreditOutcome\(/);
    expect(route).toMatch(/if \(outcome === 'deducted' \|\| outcome === 'duplicate'\) \{[\s\S]{0,60}collected\.push\(c\);/);
    // 미수(재차감 큐)는 `failed` 하나뿐 — 무과금 결말을 큐에 넣으면 잘못 걷힌다
    expect(route).toMatch(/else if \(outcome === 'failed'\) \{[\s\S]{0,120}unpaid\.push\(c\);/);
    expect(route).toContain('재차감 대상 아님');
    expect(route).not.toMatch(/outcome === 'not_applicable'[\s\S]{0,200}unpaid\.push/);
    // 불리언 래퍼로 되돌아가지 않는다
    expect(route).not.toContain('deductCreditSafe');
    // CT는 판정을 한 벌만 갖는다(불리언은 결말을 접기만 한다)
    const credit = readFileSync(path.join(__dirname, 'ai-credit.ts'), 'utf8');
    expect(credit).toContain("export type DeductOutcome");
    expect(credit).toMatch(/deductCreditSafe[\s\S]{0,400}await deductCreditOutcome\(opts, _deps\)\) !== 'failed'/);
  });

  it('승인한 금액과 지금 금액이 다르면 걷지 않는다 — 견적·생성 사이 상태 변화가 미승인 과금이 된다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toContain('QUOTE_CHANGED');
    expect(route).toContain("const expectedTotal = req.body?.expectedTotal");
    // 누락·비정상 타입은 선점 전에 막는다 — 선택이면 결박이 계약이 아니라 권고가 된다
    expect(route).toContain('QUOTE_REQUIRED');
    expect(route).toMatch(/typeof expectedTotal !== 'number' \|\| !Number\.isFinite\(expectedTotal\) \|\| expectedTotal < 0/);
    // 검사가 선점보다 앞이다 — 뒤면 409로 되돌아가며 세션이 generating에 갇힌다
    expect(route.indexOf('QUOTE_CHANGED')).toBeLessThan(route.indexOf("SET status = 'generating'"));
    // 검사가 AI 호출·차감보다 앞이다
    expect(route.indexOf('QUOTE_CHANGED')).toBeLessThan(route.indexOf('oneShotGenerate({'));
    // 화면이 승인 총액을 실어 보내고, 변경 응답을 구분해 재확인한다
    const modal = readFileSync(path.join(__dirname, '../../../frontend/src/components/dm/OneStepInterviewModal.tsx'), 'utf8');
    expect(modal).toContain('expectedTotal: approvedTotal');
    expect(modal).toContain("d?.code === 'QUOTE_CHANGED'");
  });

  // ★ Codex 6R — 항목이 둘이라 한 번만 갱신하면 두 차감의 **합산** 시간이 lease를 넘는다.
  it('lease는 차감 항목마다 갱신하고, 잃으면 다음 차감을 시작하지 않는다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    // 루프 안에서 매 항목 직전에 소유권을 확인한다
    expect(route).toMatch(/for \(const c of quote\.charges\)[\s\S]{0,900}own = await holdClaim\(\);/);
    // 0행이면 break — 남은 항목을 걷지 않는다
    expect(route).toMatch(/if \(own\.rows\.length !== 1\) \{[\s\S]{0,300}break;/);
    // 확인이 차감보다 앞이다
    expect(route.indexOf('const own = await holdClaim()')).toBeLessThan(route.indexOf('const outcome = await deductCreditOutcome('));
  });

  it('완료도 내가 잡은 회차일 때만 쓴다 — 진행 중인 남의 선점을 덮지 않는다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toMatch(/status = 'generated'[\s\S]{0,400}AND status = 'generating' AND attempt = \$\d/);
    expect(route).toContain('finalize.rows.length !== 1');
  });

  it('생성 입력은 선점이 돌려준 답으로만 만든다 — 먼저 읽고 나중에 선점하면 옛 답으로 과금한다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toContain('RETURNING attempt, answers, prefill');
    expect(route).toMatch(/buildMasterBrief\(claimed\.answers/);
    // 선점 전에 읽어 둔 s.answers로 생성 입력을 만들지 않는다
    expect(route).not.toMatch(/buildMasterBrief\(s\.answers/);
  });

  it('과금 조회가 안 되면 금액을 짓지 않는다 — 모르는 것을 미차감으로 접으면 이미 낸 고객이 막힌다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const guards = route.match(/CREDIT_LOOKUP_UNAVAILABLE/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2);   // 견적 · 생성
    expect(route).toContain('503');
    const credit = readFileSync(path.join(__dirname, 'ai-credit.ts'), 'utf8');
    // CT는 조회 실패를 false로 접지 않는다(던진다)
    expect(credit).not.toMatch(/isChargedByKey[\s\S]{0,600}catch[\s\S]{0,120}return false/);
  });

  it('생성 중에는 답을 못 고친다 — PATCH 허용 상태에 generating이 없다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const patchAllow = route.match(/AND status IN \('draft', 'generated'\)/g) || [];
    expect(patchAllow.length).toBeGreaterThanOrEqual(1);
    expect(route).not.toMatch(/status IN \('draft', 'generated', 'generating'\)/);
  });

  it('이어받기와 새로 시작을 사용자가 고른다 — 시간 창은 같은 행사임을 증명하지 못한다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toContain('!req.body?.fresh');
  });
});

describe('0814 정정 — 세션은 이어지고, 담당자별로 격리된다', () => {
  it('세션 열기는 진행 중인 내 draft를 먼저 찾는다 — 새로 만들면 대행비를 다시 걷는다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const resume = route.indexOf("AND updated_at > NOW() - INTERVAL '30 days'");
    expect(resume).toBeGreaterThan(-1);
    expect(route).toContain('ORDER BY updated_at DESC LIMIT 1');
    expect(route).toContain('resumed: true');
    // 이어받기 조회가 INSERT보다 먼저 온다(뒤에 있으면 매번 새 세션이 만들어진다)
    expect(resume).toBeLessThan(route.indexOf(`INSERT INTO`));
  });

  it('답을 고치면 생성 완료 세션도 다시 진행 중이 된다 — 막으면 새 세션으로 밀려 또 낸다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    expect(route).toContain("AND status IN ('draft', 'generated')");
    expect(route).toMatch(/SET answers = [\s\S]{0,120}status = 'draft'/);
  });

  it('전 엔드포인트에 소유 조건이 걸려 있다 — 회사 조건만으로는 옆 담당자 세션이 열린다', () => {
    const route = readFileSync(path.join(__dirname, '../routes/content-interview.ts'), 'utf8');
    const ownerGuards = route.match(/IS NULL OR created_by = \$\d::uuid/g) || [];
    // 조회 · 답 저장 · 회차 올리기 · 최종화 네 경로
    //   (표식 경로는 원장 판정으로, 소유권 재확인·선점 해제는 잠금으로 대체돼 사라졌다)
    expect(ownerGuards.length).toBeGreaterThanOrEqual(4);
    expect(route).toContain("from '../utils/owner-scope'");
    // 격리 CT를 쓴다 — 라우트 안에 같은 판정을 다시 쓰지 않는다
    expect(route).not.toMatch(/userType === 'company_admin'/);
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
