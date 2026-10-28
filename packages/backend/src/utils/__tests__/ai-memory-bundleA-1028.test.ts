/**
 * AI 메모리 · 브랜드 보이스 묶음 A 순수 CT (★ 2026-10-28 · 설계서 docs/2026-10-28-ai-memory-brand-voice-design.md §6)
 *
 * 종류 판정 순서 · 모양 측정(n<3 미측정 · 반대 증거) · 뼈대(원문 글자 + 칸만) · 세대 전이 표 · 집 규칙(목소리 없는 회사 = 글자 그대로) ·
 * 목소리 해석(확인된 묶음만 · 사람 행 덮기) · 예시 고르기 · 출구 스타일 · 재생성 비교 · 「사람이 보낸 발송」 거름 · 추출 결과 조립.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({
  default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
}));

import { resolveCopyIntent, kindOfContentType, contentTypeOfPurpose, COPY_CONTENT_TYPES } from '../copy-content-type';
import { measureText, buildCompanyShape, normalizeForShape, shapeIssues } from '../copy-shape';
import { buildSkeleton, maskPhrase, isSkeletonOfText, textHash, SKELETON_SLOT } from '../brand-voice-skeleton';
import { AI_FILL_DIRECT_PATTERN, BENEFIT_PLACEHOLDER } from '../copy-benefit-detector';
import {
  EMPTY_STATE, onMessageWrite, onAdminEdit, onReset, extractDoneFor, onExtractSuccess, onReview, canSample, onSample, voiceStatusOf, parseState,
} from '../brand-voice-state';
import { buildHouseRules, HOUSE_SEGMENTS, CLICHE_LINES, variantNamesFor, VOICE_VARIANT_NAMES } from '../copy-house-rules';
import { brandSystemPromptForTest, applyCopyCVariant } from '../../services/ai';
import { resolveGuidelineFor, voiceLearnedOf, liveSkeletons, pickVoiceExamples, planBrandVoiceRows, type RepresentativeMessage } from '../brand-voice-prompt';
import { applyCopyExitGuards, compareCopyAttempts, runWithRegenBudget, takeGenerationSlot, generationSlotsLeft } from '../copy-exit-guards';
import { shapeHumanSentCandidates, PRESELECT_MAX } from '../human-sent-messages';
import { scoreSpamRisk } from '../copy-spam-risk';
import { buildExtractionResult } from '../brand-voice-extract';
import { sampleHasBody } from '../brand-voice-sample';

describe('K9 견본 = 쓸 글이 남아야 성공(Codex 구현 1R · 2R)', () => {
  it('이름 · 직접 채울 칸만 든 결과는 줄 · 순서와 무관하게 실패', () => {
    const names = ['한줄로', null];
    expect(sampleHasBody('[한줄로]\n', names)).toBe(false);
    expect(sampleHasBody('[한줄로] [상품명: 직접 입력해주세요]', names)).toBe(false);
    expect(sampleHasBody('[상품명: 직접 입력해주세요]\n[한 줄 로]', names)).toBe(false);
    expect(sampleHasBody('', names)).toBe(false);
    expect(sampleHasBody('[한줄로]\n이번 주 새로 들어온 옷이에요', names)).toBe(true);
    // 포함관계 · 겹치는 이름(지우는 순서와 무관 · Codex 구현 3R)
    expect(sampleHasBody('[주식회사 한줄로] [상품명: 직접 입력해주세요]', ['한줄로', '주식회사 한줄로'])).toBe(false);
    expect(sampleHasBody('한줄로마', ['한줄로', '로마'])).toBe(false);
    expect(sampleHasBody('한줄로 한줄로 소식이에요', ['한줄로'])).toBe(true);
  });
});

const LMS = (lines: string[]) => lines.join('\n');

describe('K4 종류 · 성격', () => {
  it('성격은 종류에서만 파생(안부 · 공지 = notice)', () => {
    expect(COPY_CONTENT_TYPES.map(kindOfContentType)).toEqual(['marketing', 'marketing', 'marketing', 'notice', 'notice']);
  });
  it('판정 순서 = 입력 종류 > 목적 코드 > AI 판정 > 광고 여부(종류 null)', () => {
    expect(resolveCopyIntent({ inputType: 'greeting', purpose: { journeyTemplate: 'repeat' }, aiType: 'promo', isAd: true })).toEqual({ contentType: 'greeting', kind: 'notice', source: 'input' });
    expect(resolveCopyIntent({ purpose: { journeyTemplate: 'birthday' }, aiType: 'promo', isAd: true })).toEqual({ contentType: 'greeting', kind: 'notice', source: 'purpose' });
    expect(resolveCopyIntent({ purpose: { operatorTargetHint: 'all' }, aiType: 'launch', isAd: false })).toEqual({ contentType: 'launch', kind: 'marketing', source: 'ai' });
    expect(resolveCopyIntent({ isAd: false })).toEqual({ contentType: null, kind: 'notice', source: 'ad' });
    expect(resolveCopyIntent({ inputType: 'nope', aiType: 'x', isAd: true })).toEqual({ contentType: null, kind: 'marketing', source: 'ad' });
  });
  it('목적 코드 표(여정 template_code · 운영자 target_hint · custom · all = 없음)', () => {
    expect(contentTypeOfPurpose({ journeyTemplate: 'reservation' })).toBe('notice');
    expect(contentTypeOfPurpose({ journeyTemplate: 'cart' })).toBe('promo');
    expect(contentTypeOfPurpose({ journeyTemplate: 'custom' })).toBeNull();
    expect(contentTypeOfPurpose({ operatorTargetHint: 'new_customers' })).toBe('greeting');
    expect(contentTypeOfPurpose({ operatorTargetHint: 'all' })).toBeNull();
  });
});

describe('K5 모양', () => {
  it('정규화 = 법 꼬리만 뗀다 · 전송자 머리는 남긴다', () => {
    expect(normalizeForShape('(광고)[한줄]\n본문\n\n무료수신거부 080-123-4567')).toBe('[한줄]\n본문');
    expect(normalizeForShape('[Web발신]\n(광고) [한줄] 오늘만\n무료거부 0801234567')).toBe('[한줄] 오늘만');
  });
  it('한 편 실측 = 줄 · 문단 · 빈 줄 · 구분선 · 기호 · 머리', () => {
    const m = measureText(LMS(['[한줄]', '봄 신상 입고 ★', '', '', '━━━━', '지금 만나보세요!', '♥ 한줄로']));
    expect(m).toMatchObject({ lines: 5, paragraphs: 2, maxBlankRun: 2, dividers: 1, exclaims: 1, bracketHead: true, firstLine: '[한줄]', lastLine: '♥ 한줄로' });
    expect(Object.keys(m.symbols)).toEqual(expect.arrayContaining(['★', '━', '!', '♥']));
    expect(m.symbols['[']).toBeUndefined();
  });
  it('회사 기준값 = 칸마다 n<3 미측정 · 반대 증거는 1건으로 선다', () => {
    const two = buildCompanyShape(['[한줄]\n짧은 줄', '이 줄은 열일곱 글자를 넘는 꽤 긴 문장입니다']);
    expect(two.n).toBe(2);
    expect(two.lineLenP90).toBeNull();
    expect(two.maxBlankRun).toBeNull();
    expect(two.evidence.lineOver17).toBe(true);
    expect(two.evidence.nonBracketHead).toBe(true);
    const three = buildCompanyShape(['[a]\n하나\n\n둘', '[a]\n셋\n\n\n넷', '[a]\n다섯']);
    expect(three.n).toBe(3);
    expect(three.maxBlankRun).toBe(2);
    expect(three.paragraphs).toEqual({ min: 1, max: 2 });
    expect(three.evidence.blankRunOver1).toBe(true);
  });
  it('생성문 모양 검사 = 측정 칸만 · SMS 는 줄 · 빈 줄 제외 · 미측정 = 검사 0', () => {
    const shape = buildCompanyShape(['[a]\n하나 ★', '[a]\n둘 ★', '[a]\n셋 ★']);
    expect(shapeIssues('[a]\n넷 ◆', shape, 'LMS').some((i) => i.includes('◆'))).toBe(true);
    expect(shapeIssues('[a]\n넷 ★', shape, 'LMS')).toEqual([]);
    expect(shapeIssues('아무거나 ◆', buildCompanyShape(['a', 'b']), 'LMS')).toEqual([]);
  });
});

describe('K5-4 뼈대 = 원문 글자 + 칸(I16 허용 목록)', () => {
  const text = '(광고)[한줄] 봄 신상 페스타 오픈!\n강남점에서 4/15(화)까지 30% 할인\nhttps://hanjul.ai/e 문의 02-123-4567\n%이름%님 만나요';
  it('원문에 있는 조각만 칸 · 코드 판정 사실도 칸 · 변수는 남긴다', () => {
    const sk = buildSkeleton(text, { events: ['봄 신상 페스타', '없는 행사'], stores: ['강남점'], products: [] });
    expect(sk).toContain(SKELETON_SLOT.event);
    expect(sk).toContain(SKELETON_SLOT.store);
    expect(sk).toContain(SKELETON_SLOT.period);
    expect(sk).toContain(BENEFIT_PLACEHOLDER);
    expect(sk).toContain(SKELETON_SLOT.link);
    expect(sk).toContain(SKELETON_SLOT.phone);
    expect(sk).toContain('%이름%님');
    expect(sk).not.toMatch(/페스타|강남점|4\/15|30%|hanjul|02-123/);
    expect(sk.startsWith('[한줄]')).toBe(true);
    for (const slot of Object.values(SKELETON_SLOT)) expect(AI_FILL_DIRECT_PATTERN.test(slot)).toBe(true);
  });
  it('사람이 고친 뼈대 = 원문 글자 순서 + 칸만(새 글 거절)', () => {
    const sk = buildSkeleton(text, {});
    expect(isSkeletonOfText(sk, text)).toBe(true);
    expect(isSkeletonOfText(sk.replace('오픈', `${SKELETON_SLOT.product}`), text)).toBe(true);
    expect(isSkeletonOfText(`${sk}\n새로 지어낸 문장`, text)).toBe(false);
  });
  it('문구 칸도 같은 칸 치기 · 글 해시 = 정규화 뒤', () => {
    expect(maskPhrase('봄 신상 페스타 30% 혜택', [{ events: ['봄 신상 페스타'] }])).toBe(`${SKELETON_SLOT.event} ${BENEFIT_PLACEHOLDER} 혜택`);
    expect(textHash('(광고)본문')).toBe(textHash('본문'));
  });
});

describe('K7 세대 전이 표', () => {
  const s0 = { ...EMPTY_STATE };
  it('문안 쓰기 = gen+1 · 추출은 시작 세대일 때만 · 확인 = 본 세대만 · 견본 = 이 세대 확인 뒤', () => {
    const s1 = onMessageWrite(s0);
    expect(s1.gen).toBe(1);
    expect(onExtractSuccess(s1, 0)).toEqual({ ok: false, code: 'stale' });
    const ex = onExtractSuccess(s1, 1);
    expect(ex.ok && ex.state.guidelineGen).toBe(1);
    const s2 = (ex as any).state;
    // 같은 세대를 늦게 마친 두 번째 추출 = done(덮지 않는다 · 화면이 본 결과가 그대로 확인된다 · Codex 구현 1R)
    expect(onExtractSuccess(s2, 1)).toEqual({ ok: false, code: 'done' });
    expect(extractDoneFor(s2, 1)).toBe(true);
    expect(extractDoneFor(s1, 1)).toBe(false);
    expect(canSample(s2, 1)).toBe(false);   // 확인 전
    expect(onReview(s2, 0, { by: null, skeletons: {}, phrases: {} }).ok).toBe(false);   // 409
    const rv = onReview(s2, 1, { by: 'u', skeletons: { m1: { hash: 'h', text: 't' } }, phrases: {} });
    expect(rv.ok).toBe(true);
    const s3 = (rv as any).state;
    expect(canSample(s3, 1)).toBe(true);
    expect(onSample(s3, 2, {}).ok).toBe(false);
    expect(voiceStatusOf(s3, { messageCount: 1, unskeletonedCount: 0, hasGuideline: true })).toBe('sample_pending');
    const s4 = (onSample(s3, 1, [{ x: 1 }]) as any).state;
    expect(voiceStatusOf(s4, { messageCount: 1, unskeletonedCount: 0, hasGuideline: true })).toBe('ready');
  });
  it('직접 정정 = gen+1 · 학습 완료면 guidelineGen 승계 · 미완이면 옛 값 · reviewed 그대로', () => {
    const done = { ...EMPTY_STATE, gen: 3, guidelineGen: 3, reviewed: { extractGen: 3, at: '', by: null, skeletons: {}, phrases: {} } };
    const e1 = onAdminEdit(done);
    expect([e1.gen, e1.guidelineGen, e1.reviewed]).toEqual([4, 4, done.reviewed]);
    const half = { ...EMPTY_STATE, gen: 5, guidelineGen: 3 };
    expect([onAdminEdit(half).gen, onAdminEdit(half).guidelineGen]).toEqual([6, 3]);
  });
  it('초기화 = gen+1 · 대기 추출본 · 확인된 묶음 · 견본 비움 · 열린 확인 = 409', () => {
    const st = { ...EMPTY_STATE, gen: 2, guidelineGen: 2, extract: { gen: 2, at: '' }, reviewed: { extractGen: 2, at: '', by: null, skeletons: {}, phrases: {} } };
    const r = onReset(st);
    expect([r.gen, r.extract, r.reviewed, r.sample]).toEqual([3, null, null, null]);
    expect(onReview(r, 2, { by: null, skeletons: {}, phrases: {} }).ok).toBe(false);
    expect(voiceStatusOf(r, { messageCount: 2, unskeletonedCount: 2, hasGuideline: false })).toBe('incomplete');
  });
  it('상태 행 읽기 = 깨진 값은 빈 상태 · 숫자 아닌 세대 0', () => {
    expect(parseState('x')).toEqual(EMPTY_STATE);
    expect(parseState({ gen: 'a', guidelineGen: -1 }).gen).toBe(0);
  });
});

describe('K2 집 규칙 · I15 목소리 없는 회사 = 글자 그대로', () => {
  const base = brandSystemPromptForTest();
  const punchy = applyCopyCVariant(base, 'punchy');
  it('줄 자리 앵커는 원문에 정확히 한 번(지시문을 고치면 이 시험이 먼저 깨진다)', () => {
    for (const seg of Object.values(HOUSE_SEGMENTS)) {
      for (const p of [base, punchy]) {
        expect(p.split(seg.start).length - 1, seg.id).toBe(1);
        expect(p.indexOf(seg.end, p.indexOf(seg.start) + 1), seg.id).toBeGreaterThan(0);
      }
    }
    for (const c of CLICHE_LINES) expect(base.split(c.start).length - 1, c.id).toBe(1);
  });
  it('목소리 없음 = 그대로', () => {
    expect(buildHouseRules(base, null)).toEqual({ system: base, applied: [] });
  });
  it('목소리 회사 = 대응 칸 없는 스타일 끔 · 3안 전략 교체 · 반대 증거 줄 뺌 · 잰 값으로 바꿈 · 법 줄은 그대로', () => {
    const shape = buildCompanyShape(['[한]\n안녕하세요 고객님 이 줄은 열일곱 글자를 넘습니다\n\n\n둘째 문단', '[한]\n짧게\n\n셋째', '[한]\n하나 둘']);
    const r = buildHouseRules(base, { shape, lengthRange: { min_chars: 40, max_chars: 120 }, samples: ['안녕하세요 고객님'] });
    expect(r.system).not.toContain('### 2. 사용 시나리오');
    expect(r.system).not.toContain('### 3. 감각 언어');
    expect(r.system).not.toContain('### 10. 업종별 킬 포인트');
    expect(r.system).not.toContain('### 계절감/시기 반영');
    expect(r.system).toContain('**우리 문자처럼(A)**');
    expect(r.system).not.toContain('- "안녕하세요, 고객님"');
    expect(r.system).toContain(`보통 ${shape.lineLenP50}자`);
    expect(r.system).toContain('LMS 본문 길이는 이 회사 문자처럼 40~120자');
    expect(r.system).toContain(`"variant_name": "${VOICE_VARIANT_NAMES[0]}"`);
    // 법 줄
    expect(r.system).toContain('### 1. 광고 표기 금지');
    expect(r.system).toContain('### 2. 정보 날조 절대 금지');
    expect(r.system).toContain('SMS/LMS/MMS: 이모지 절대 금지!');
  });
  it('3안 이름 = 서버 함수(목소리 = 목소리 이름 · 아니면 지금 이름)', () => {
    expect(variantNamesFor(false, 'MZ감성형')).toEqual(['감성형', '혜택강조형', 'MZ감성형']);
    expect(variantNamesFor(true, 'MZ감성형')).toEqual([...VOICE_VARIANT_NAMES]);
  });
});

describe('K6 목소리 해석(I3 · I16)', () => {
  const msg = (id: string, text: string, kind: 'marketing' | 'notice', content_type: any = null): RepresentativeMessage => ({ id, channel: 'LMS', message_text: text, manual_priority: 1, kind, content_type });
  const messages = [msg('m1', '[한]\n봄 신상', 'marketing', 'launch'), msg('m2', '[한]\n감사해요', 'notice', 'greeting'), msg('m3', '[한]\n세일', 'marketing', 'promo')];
  const reviewed = { extractGen: 1, at: '', by: null, skeletons: { m1: { hash: textHash('[한]\n봄 신상'), text: '[한]\n[상품명: 직접 입력해주세요]' }, m2: { hash: 'stale', text: 'x' } }, phrases: { marketing: { frequent_expressions: ['딱 오늘'], signature: '한줄 드림' } } };
  const state = { ...EMPTY_STATE, gen: 1, guidelineGen: 1, extract: { gen: 1, at: '' }, reviewed };
  const g = { tone_signature: '친근', frequent_expressions: ['확인 안 된 표현'], signature: '확인 안 된 서명', cta_patterns: ['x'], greeting_pattern: 'y', emoji_whitelist: ['★'] } as any;
  it('살아 있는 뼈대 = 지금 문안 + 글 해시 맞음 · 목소리 판정 = 그 뼈대 또는 사람 행 칸', () => {
    expect(liveSkeletons(state, messages).map((x) => x.message.id)).toEqual(['m1']);
    expect(voiceLearnedOf({ state, messages, admin: {} })).toBe(true);
    expect(voiceLearnedOf({ state, messages, admin: {} }, 'notice')).toBe(false);
    expect(voiceLearnedOf({ state: EMPTY_STATE, messages, admin: { notice: { tone_signature: { value: 'x', at: '', by: null } } } }, 'notice')).toBe(true);
  });
  it('해석된 가이드라인 = 확인된 문구 칸만(미확인 AI 문구 0) · 사람 행이 덮는다', () => {
    const r = resolveGuidelineFor({ guideline: g, noticeGuideline: null, state, admin: { marketing: { tone_signature: { value: '정중', at: '', by: 'u' } } } }, 'marketing')!;
    expect(r.frequent_expressions).toEqual(['딱 오늘']);
    expect(r.signature).toBe('한줄 드림');
    expect(r.cta_patterns).toEqual([]);
    expect(r.greeting_pattern).toBe('');
    expect(r.tone_signature).toBe('정중');
    expect(r.emoji_whitelist).toEqual(['★']);
    const none = resolveGuidelineFor({ guideline: g, noticeGuideline: null, state: EMPTY_STATE, admin: {} }, 'marketing')!;
    expect([none.frequent_expressions, none.signature]).toEqual([[], '']);
  });
  it('예시 고르기 = 같은 종류 → 같은 성격 → 전체 · 상한 5', () => {
    const live = Array.from({ length: 7 }, (_, i) => ({ message: msg(`k${i}`, `t${i}`, i < 2 ? 'notice' : 'marketing', i === 4 ? 'promo' : null), skeleton: `s${i}` }));
    const picked = pickVoiceExamples(live, 'notice', 'promo');
    expect(picked.length).toBe(5);
    expect(picked.map((x) => x.message.id).slice(0, 3)).toEqual(['k4', 'k0', 'k1']);
  });
  it('저장 계획 = 분류된 문안 1건 이상(K4-3)', () => {
    expect(planBrandVoiceRows(['marketing', null], { marketing: { a: 1 } })).toMatchObject({ ok: true });
    expect(planBrandVoiceRows([null], {})).toMatchObject({ ok: false });
  });
});

describe('K12 출구 · 재생성', () => {
  const ctx = { channel: 'LMS', isAd: true, bannedWords: [], benefitGround: '가을 신상', baseDate: new Date('2026-10-28T03:00:00Z'), validationVars: [], stripAllVars: false, brandLinks: [], senderNames: ['한줄'] };
  it('스타일 후처리 = 목소리 회사 기준값(구분선 유지 · 빈 줄 2줄까지)', () => {
    const t = '[한줄]\n가을\n━━━━\n\n\n\n끝';
    expect(applyCopyExitGuards({ message_text: t }, ctx).message_text).toBe('[한줄]\n가을\n\n끝');   // 지금 = 구분선 지움 · 빈 줄 1줄
    expect(applyCopyExitGuards({ message_text: t }, { ...ctx, style: { keepDividers: true, maxBlankRun: 2 } }).message_text).toBe('[한줄]\n가을\n━━━━\n\n\n끝');
  });
  it('법 출구 그대로 · 남은 칸 = 법 문제 · 전송자 명칭', () => {
    const out = applyCopyExitGuards({ message_text: '가을 신상 30% 할인\n[상품명: 직접 입력해주세요] 만나요', subject: '신상' }, ctx);
    expect(out.flags.inventedBenefits.length).toBeGreaterThan(0);
    expect(out.flags.placeholderLeft).toBe(true);
    expect(out.message_text.startsWith('[한줄]\n')).toBe(true);   // 제목 · 본문 첫 줄에 이름이 없음 → 첫 줄에 붙인다
    expect(out.flags.senderAdded).toBe(true);
  });
  it('비교 = 법 → 스팸 → 목소리', () => {
    expect(compareCopyAttempts({ law: 0, spam: 1, voice: 9 }, { law: 1, spam: 0, voice: 0 })).toBeLessThan(0);
    expect(compareCopyAttempts({ law: 1, spam: 0.2, voice: 0 }, { law: 1, spam: 0.1, voice: 0 })).toBeGreaterThan(0);
  });
  it('회차 예산 = 바깥 · 안쪽이 함께 쓴다 · 예산 밖 = 무한', async () => {
    expect(takeGenerationSlot()).toBe(true);
    expect(generationSlotsLeft()).toBe(Number.POSITIVE_INFINITY);
    const seen = await runWithRegenBudget(async () => [takeGenerationSlot(), takeGenerationSlot(), takeGenerationSlot(), takeGenerationSlot(), generationSlotsLeft()]);
    expect(seen).toEqual([true, true, true, false, 0]);
  });
  it('스팸 기호 가산 = 회사 표본 기호 수 이하면 0(K2-4)', () => {
    const t = '★ 신상 ★ 입고 ★ 만나요 ★';
    expect(scoreSpamRisk(t).score).toBeGreaterThan(0);
    expect(scoreSpamRisk(t, { allowedSymbolCount: 4 }).score).toBe(0);
  });
});

describe('K8 「사람이 보낸 발송」 거름', () => {
  const row = (id: string, ch: string, text: string, sent_at = '2026-10-01') => ({ id, message_type: ch, subject: null, message_content: text, is_ad: true, sent_at, sent_count: 30 });
  it('짧은 글 · 휴대폰 · 쿠폰 코드 꼴 제외 · 같은 글 하나', () => {
    const long = '가을 신상이 들어왔어요. 이번 주 매장에서 먼저 만나 보세요. 늘 고맙습니다.';
    const out = shapeHumanSentCandidates([
      row('a', 'LMS', long), row('b', 'LMS', `(광고)${long}`), row('c', 'LMS', '짧음'),
      row('d', 'LMS', `${long} 010-1234-5678`), row('e', 'LMS', `${long} 코드 AB12CD34EF`),
    ]);
    expect(out.map((c) => c.campaignId)).toEqual(['a']);
  });
  it('미리 체크 = 최근 순 · 채널을 돌아가며 · 최대 10', () => {
    const t = (i: number) => `문자 ${i}번 이번 주 매장 소식을 전해 드려요 늘 고맙습니다 감사합니다`;
    const rows = [...Array.from({ length: 12 }, (_, i) => row(`l${i}`, 'LMS', t(i))), ...Array.from({ length: 3 }, (_, i) => row(`s${i}`, 'SMS', t(100 + i)))];
    const out = shapeHumanSentCandidates(rows);
    const pre = out.filter((c) => c.preselected);
    expect(pre.length).toBe(PRESELECT_MAX);
    expect(pre.filter((c) => c.channel === 'SMS').length).toBe(3);
  });
});

describe('K7-4 추출 결과 조립', () => {
  const rows = [
    { id: 'm1', value: { channel: 'LMS' as const, message_text: '[한줄]\n봄 신상 페스타 30% 할인!\n지금 만나요', manual_priority: 1, created_by_admin: true } },
    { id: 'm2', value: { channel: 'LMS' as const, message_text: '[한줄]\n늘 감사합니다 고객님', manual_priority: 2, created_by_admin: true, content_type: 'greeting' as const, content_type_source: 'admin' as const } },
  ];
  it('종류 = 사람 종류 먼저 · 뼈대 = 원문에 있는 조각만 · 문구 칸 = 칸 친 뒤 · 모양 = 코드', () => {
    const parsed = {
      messages: [{ content_type: 'promo', facts: { events: ['봄 신상 페스타', '없는 행사'] } }, { content_type: 'promo', facts: {} }],
      marketing: { tone_signature: '활기/감성', frequent_expressions: ['봄 신상 페스타 오픈'], cta_patterns: ['지금 만나요'], signature: '', emoji_whitelist: ['!'] },
      notice: { tone_signature: '정중/격조', frequent_expressions: ['늘 감사합니다'] },
    };
    const r = buildExtractionResult(parsed, rows as any, [null, 'greeting'], [null, 'notice'], 7) as any;
    expect(r.ok).toBe(true);
    expect(r.messages.map((m: any) => [m.value.content_type, m.value.kind, m.value.content_type_source])).toEqual([['promo', 'marketing', 'ai'], ['greeting', 'notice', 'admin']]);
    expect(r.messages[0].value.skeleton.text).toContain('[행사명: 직접 입력해주세요]');
    expect(r.messages[0].value.skeleton.extractGen).toBe(7);
    expect(r.main.frequent_expressions).toEqual(['[행사명: 직접 입력해주세요] 오픈']);
    expect(r.main.shape.n).toBe(1);
    expect(r.notice.voice_kind).toBe('notice');
  });
  it('문안이 있는 성격의 묶음이 빠지면 저장 0', () => {
    const parsed = { messages: [{ content_type: 'promo' }, { content_type: 'greeting' }], marketing: { tone_signature: 'x' }, notice: null };
    expect(buildExtractionResult(parsed, rows as any, [null, null], [null, null], 1)).toEqual({ ok: false });
  });
});
