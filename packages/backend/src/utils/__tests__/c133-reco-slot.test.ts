// replaces: none
/**
 * C133 F2 ① — 여정 문자의 추천 상품 자리(★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-4 · §13 T2-8 ~ T2-16)
 *   1. 자리 문법 = 맞는 꼴 · 틀린 꼴(후보 0 · 4개 · 대체 문장 없음 · 금지 글자 · 두 번 · 보낼 수 없는 글자)
 *   2. 렌더의 두 걸음 = 표식으로 바꾸고 나중에 채운다 · 자리 없는 글은 한 글자도 안 바뀐다
 *   3. 보낼 글 판정(CT-J10) = 자리 없는 글의 판정 결과 종전과 같음 · 자리 있는 글의 갈래(닫힌 회사 · A/B 칸 · 제목 · 다른 문법 안)
 *   4. 검사 = 나갈 수 있는 글 전부(후보마다 + 대체 문장)를 공용 검사 함수 안 한 곳에서 펼친다 · 하나라도 걸리면 통과가 아니다
 *   5. 계약(소스) = 검사 네 길이 그 함수 하나를 부른다 · AI 가 손대지 않는 세 자리 · 실행기는 판을 강제하지 않는다 · 수동 검사 창은 받지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const spamQueue = vi.hoisted(() => ({
  enqueueSpamTest: vi.fn(),
  readSpamTestOutcome: vi.fn(),
  peekSpamCheck: vi.fn(),
}));
const render = vi.hoisted(() => ({ renderJourneySmsMessage: vi.fn(), journeyCopyContext: vi.fn() }));
const demo = vi.hoisted(() => ({ isDemoCompany: vi.fn(async (_id: string) => false) }));

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn(), pool: {} }));
vi.mock('../spam-test-queue', async (orig) => ({ ...(await orig<any>()), ...spamQueue }));
vi.mock('../journey-message-render', () => ({
  renderJourneySmsMessage: render.renderJourneySmsMessage,
  pickJourneySampleCustomer: vi.fn(async () => null),
  journeyCopyContext: render.journeyCopyContext,
}));
vi.mock('../demo-company', () => ({ isDemoCompany: demo.isDemoCompany }));
vi.mock('../spam-test-view', () => ({ spamCheckView: vi.fn() }));
vi.mock('../journey-kakao-step', () => ({ kakaoStepVerdict: vi.fn() }));

import {
  RECO_MARK, RECO_MAX_CANDIDATES, hasRecoMark, readRecoSlot, recoTexts, recoVersionCount, recoVersionLabel,
  maskRecoSlot, fillRecoSlot, recoSlotIssue, recoTextIssue, RecoSlotLostError,
} from '../reco-slot';
import { UserFacingError } from '../http-error';
import { journeyCopyIssue } from '../send-placeholder-gate';
import { sanitizeUnsendableForSms } from '../message-sanitizer';
import { detectLiquidSyntax, liquidTokens } from '../liquid-templating';
import { findVarTokens } from '../var-tokens';
import { journeyRevisedCopy, journeyRevisedKept, copyPinned } from '../journey-ai-copy';
import { runStepSpamTest, peekStepSpam, validateJourneyForActivation } from '../journey-pretest-validator';
import { query } from '../../config/database';
import * as front from '../../../../frontend/src/utils/reco-slot';

const SLOT = '<추천상품: 수분크림 | 선크림 | 세럼 || 요즘 많이 찾는 상품>';
const BODY = `%이름%님, ${SLOT} 어떠세요?`;
const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

describe('자리 문법(순수)', () => {
  it('맞는 꼴 = 후보 1 ~ 3개 + 대체 문장 하나', () => {
    const r = readRecoSlot(BODY);
    expect(r).toEqual({ kind: 'ok', slot: { raw: SLOT, names: ['수분크림', '선크림', '세럼'], fallback: '요즘 많이 찾는 상품' } });
    expect(readRecoSlot('<추천상품: 수분크림 || 인기 상품>').kind).toBe('ok');
    expect(readRecoSlot('<추천상품:수분크림||인기 상품>')).toMatchObject({ kind: 'ok', slot: { names: ['수분크림'], fallback: '인기 상품' } });
    expect(RECO_MAX_CANDIDATES).toBe(3);
  });
  it('자리 글자가 없으면 none — 꺾쇠가 든 보통 글도 none', () => {
    for (const t of ['', null, undefined, '안녕하세요', '<광고> 3 < 5 > 2 || a | b', '추천상품: A || B', '<추천 상품: A || B>']) {
      expect(readRecoSlot(t as any)).toEqual({ kind: 'none' });
      expect(hasRecoMark(t as any)).toBe(false);
      expect(recoVersionCount(t as any)).toBe(0);
    }
  });
  it.each([
    ['후보 0', '<추천상품: || 대체>'],
    ['빈 후보', '<추천상품: A | | B || 대체>'],
    ['후보 4개', '<추천상품: A | B | C | D || 대체>'],
    ['대체 문장 없음', '<추천상품: A | B>'],
    ['대체 문장 빔', '<추천상품: A | B || >'],
    ['대체 문장 둘', '<추천상품: A || B || C>'],
    ['대체 문장에 |', '<추천상품: A || B | C>'],
    ['두 번', '<추천상품: A || B> 그리고 <추천상품: C || D>'],
    ['닫는 꺾쇠 없음', '<추천상품: A || B'],
    ['콜론 없음', '<추천상품 A || B>'],
    ['줄바꿈', '<추천상품: A\n | B || C>'],
    ['안에 꺾쇠', '<추천상품: A<B || C>'],
    ['같은 후보 두 번', '<추천상품: A | A || B>'],
    ['% 가 든 후보', '<추천상품: 50% 세일 || B>'],
    ['중괄호', '<추천상품: {{ a }} || B>'],
    ['대괄호가 든 대체 문장', '<추천상품: A || [직접 입력]>'],
    ['이모지 후보', '<추천상품: 반짝😊크림 || B>'],
    ['이모지 대체 문장', '<추천상품: A || 인기 상품😊>'],
    ['보이지 않는 글자', '<추천상품: A​ || B>'],
  ])('틀린 꼴 = bad(사유) · 검사 판 0 — %s', (_n, text) => {
    const r = readRecoSlot(text);
    expect(r.kind).toBe('bad');
    expect((r as any).reason.length).toBeGreaterThan(5);
    expect(hasRecoMark(text)).toBe(true);
    expect(recoVersionCount(text)).toBe(0);
    expect(maskRecoSlot(text)).toBeNull();
  });
  it('후보 글자 판정 = 자리 판정과 제안이 같은 함수', () => {
    expect(recoTextIssue('수분 크림 50ml')).toBeNull();
    expect(recoTextIssue('★특가 크림')).toBeNull();   // 문자로 그대로 나가는 기호
    for (const t of ['a|b', '50%', '{x}', '[x]', 'a<b', 'a>b', 'a\nb', '크림😊', '크림​']) expect(recoTextIssue(t)).toBeTruthy();
  });
  it('검사 판 = 후보마다 + 맨 끝 대체 문장 · 이름표', () => {
    const r = readRecoSlot(BODY);
    if (r.kind !== 'ok') throw new Error('fixture');
    expect(recoTexts(r.slot)).toEqual(['수분크림', '선크림', '세럼', '요즘 많이 찾는 상품']);
    expect(recoVersionCount(BODY)).toBe(4);
    expect([0, 1, 2, 3].map((i) => recoVersionLabel(BODY, i))).toEqual(['수분크림', '선크림', '세럼', '대체 문장']);
    expect(recoVersionLabel('자리 없음', 0)).toBe('');
  });
});

describe('렌더의 두 걸음(순수)', () => {
  it('자리를 영문 · 숫자 표식으로 바꾼다 — 다른 글자는 그대로', () => {
    const m = maskRecoSlot(BODY)!;
    expect(m.token).toMatch(/^[A-Z0-9]+$/);
    expect(m.template).toBe(`%이름%님, ${m.token} 어떠세요?`);
    expect(m.template).not.toContain(RECO_MARK);
    expect(m.slot.names).toEqual(['수분크림', '선크림', '세럼']);
  });
  it('표식 = 부를 때마다 새로 뽑는 긴 무작위 글자열(고객 값 · 회사 값과 겹칠 수 있는 고정 글자열이 아니다)', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => maskRecoSlot(BODY)!.token));
    expect(tokens.size).toBe(50);
    for (const t of tokens) { expect(t).toMatch(/^HJRECO[0-9A-F]{24}$/); expect(BODY).not.toContain(t); }
    const m = maskRecoSlot(`HJRECOSLOT 코드 ${SLOT}`)!;
    expect(m.template.split(m.token)).toHaveLength(2);
    expect(m.template.startsWith('HJRECOSLOT 코드 ')).toBe(true);   // 본문의 비슷한 글자열은 건드리지 않는다
  });
  it('자리가 없거나 꼴이 틀리면 null(본문을 건드리지 않는다)', () => {
    expect(maskRecoSlot('%이름%님 안녕하세요')).toBeNull();
    expect(maskRecoSlot('<추천상품: A | B>')).toBeNull();
  });
  it('채우기 = 표식을 고른 글자로 · 치환 문법($&)이 끼어들지 않는다', () => {
    expect(fillRecoSlot('가 TOK 나', 'TOK', '수분크림')).toBe('가 수분크림 나');
    expect(fillRecoSlot('가 TOK 나', 'TOK', '$& $1 $$')).toBe('가 $& $1 $$ 나');
  });
  it('채우기 = 표식이 정확히 한 번 있을 때만 · 사라졌거나(0번) 불어났으면(2번 이상) null(조용히 자리 없는 글을 돌려주지 않는다)', () => {
    expect(fillRecoSlot('표식 없음', 'TOK', '수분크림')).toBeNull();
    expect(fillRecoSlot('', 'TOK', '수분크림')).toBeNull();
    expect(fillRecoSlot('TOK 그리고 TOK', 'TOK', '수분크림')).toBeNull();
    expect(fillRecoSlot('TOK', 'TOK', '')).toBe('');
    const e = new RecoSlotLostError();
    expect(e).toBeInstanceOf(UserFacingError);   // 미리보기 주소가 그 문장 그대로 돌려준다
    expect(e.status).toBe(400);
    expect(e.code).toBe('RECO_SLOT_LOST');
    expect(e.message).toMatch(/추천 상품 자리가 받는 글에서 사라졌어요/);
  });
  it('대체 문자열의 $ 꼴이 자리 글자에 있어도 표식 바꾸기가 깨지지 않는다', () => {
    const m = maskRecoSlot('가격 $1 <추천상품: A$& || B$1> 끝')!;
    expect(m.template).toBe(`가격 $1 ${m.token} 끝`);
  });
});

describe('자리 판정(순수 · CT-J10 이 부른다)', () => {
  const open = { allowed: true, hasVariants: false };
  it('자리 없는 글 = 늘 null(열림 · 닫힘 · A/B 무관)', () => {
    for (const o of [open, { allowed: false, hasVariants: true }]) {
      expect(recoSlotIssue('%이름%님 안녕하세요 <광고>', o)).toBeNull();
      expect(recoSlotIssue('', o)).toBeNull();
      expect(recoSlotIssue(null, o)).toBeNull();
    }
  });
  it('맞는 자리 + 열린 회사 + A/B 아님 = null', () => {
    expect(recoSlotIssue(BODY, open)).toBeNull();
  });
  it('닫힌 회사 = 막음(꼴이 맞아도 · 틀려도)', () => {
    expect(recoSlotIssue(BODY, { allowed: false, hasVariants: false })).toMatch(/열려 있지 않아요/);
    expect(recoSlotIssue('<추천상품: A', { allowed: false, hasVariants: false })).toMatch(/열려 있지 않아요/);
  });
  it('틀린 꼴 = 그 사유', () => {
    expect(recoSlotIssue('<추천상품: A | B | C | D || E>', open)).toMatch(/3개까지/);
    expect(recoSlotIssue('<추천상품: A | B>', open)).toMatch(/대체 문장/);
  });
  it('문안 A/B 칸 = 막음', () => {
    expect(recoSlotIssue(BODY, { allowed: true, hasVariants: true })).toMatch(/A\/B/);
  });
  it.each([
    ['%…% 안', '%<추천상품: 고객명 || 고객명>%'],
    ['%…% 조각 안', '%이름<추천상품: A || B>%'],
    ['{{ }} 안', '{{ customer.<추천상품: name || name> }}'],
    ['%…% 안 · 뒤에 글자', '%<추천상품: 고객명 || 고객명>님%'],
  ])('다른 문법 안에 낀 자리 = 막음 — %s', (_n, text) => {
    expect(recoSlotIssue(text, open)).toMatch(/안에 넣을 수 없어요/);
  });
  it.each([
    ['조건 갈래 안의 자리(표본의 조건이 거짓이면 자리가 사라져 후보가 검사 없이 통과한다)', '{% if customer.grade == "VIP" %}VIP 님께 <추천상품: A || B>{% endif %}'],
    ['조건식 안의 자리', '{% if <추천상품: A || B> %}가{% endif %}'],
    ['자리 밖의 조건문', '<추천상품: A || B> 어떠세요? {% if customer.grade == "VIP" %}VIP 혜택{% endif %}'],
    ['주석 태그', '{% comment %}메모{% endcomment %}<추천상품: A || B>'],
  ])('조건문({%% %%})이 든 글에는 자리를 받지 않는다 — %s', (_n, text) => {
    expect(recoSlotIssue(text, open)).toMatch(/조건문/);
    expect(journeyCopyIssue({ bodies: [text], subjects: [null] }, { knownVarNames: new Set(), cartJourney: false, recoAllowed: true })?.code).toBe('RECO_SLOT');
  });
  it.each([
    ['숨은 글자를 지우면 조건문이 되는 글(여는 중괄호와 % 사이)', `{\u200B% if customer.grade == "VIP" %}<추천상품: A || B>{\u200B% endif %}`, /조건문/],
    ['숨은 글자를 지우면 출력식 안이 되는 글', `{\u200B{ customer.<추천상품: name || name> }}`, /안에 넣을 수 없어요/],
    ['따옴표 안의 닫는 중괄호 뒤에 낀 자리(파서는 }} 까지 출력식으로 읽는다)', `{{ customer.name | default: '}<추천상품: A || B>' }}`, /안에 넣을 수 없어요/],
    ['숨은 글자를 지우면 %변수% 조각 안이 되는 글', `%이름\u200B<추천상품: A || B>%`, /안에 넣을 수 없어요/],
    ['닫히지 않은 출력식', '{{ customer.name <추천상품: A || B>', /닫히지 않았어요|안에 넣을 수 없어요/],
  ])('판정은 렌더가 읽는 글(글자 정리 뒤)을 렌더의 파서로 읽는다 — %s', (_n, text, why) => {
    expect(recoSlotIssue(text as string, open)).toMatch(why as RegExp);
  });
  it('판정이 통과시킨 글 = 렌더의 파서가 자리 표식을 글 조각 안에 정확히 한 번 남긴다(판정과 렌더가 같은 파서 · 같은 정리)', () => {
    for (const text of [BODY, '30% 할인 <추천상품: A || B> 10% 적립', '{{ company.name }} 에서 <추천상품: A || B> 어떠세요?', `줄1\n<추천상품: A | B || C>\n줄3 ★`, `숨은\u200B글자 <추천상품: A || B>`]) {
      expect(recoSlotIssue(text, open)).toBeNull();
      const m = maskRecoSlot(text)!;
      const seen = sanitizeUnsendableForSms(m.template).sanitized;
      const tokens = detectLiquidSyntax(seen) ? liquidTokens(seen) : [{ type: 'text' as const, value: seen }];
      expect(tokens.some((t) => t.type === 'tag')).toBe(false);
      expect(tokens.filter((t) => t.type === 'text').reduce((n, t) => n + t.value.split(m.token).length - 1, 0)).toBe(1);
      expect(tokens.filter((t) => t.type === 'output').some((t) => t.value.includes(m.token))).toBe(false);
      expect(findVarTokens(seen).some((t) => t.name.includes(m.token))).toBe(false);
    }
  });
  it('퍼센트 기호 옆 · 출력식({{ }}) 옆의 자리 = 허용 · 조건문만 있고 자리가 없는 글 = 판정 밖', () => {
    expect(recoSlotIssue('30% 할인 <추천상품: A || B> 10% 적립', open)).toBeNull();
    expect(recoSlotIssue('{{ company.name }} 에서 <추천상품: A || B> 어떠세요?', open)).toBeNull();
    expect(recoSlotIssue('{% if customer.grade == "VIP" %}VIP 혜택{% endif %}', open)).toBeNull();
  });
});

describe('보낼 글 판정 CT-J10', () => {
  const known = new Set(['이름']);
  const ctxOpen = { knownVarNames: known, cartJourney: false, recoAllowed: true };
  const ctxOld = { knownVarNames: known, cartJourney: false };

  it('자리 없는 글의 판정 결과는 종전과 같다(열림 값이 있든 없든 · T2-11)', () => {
    const cases: Array<[string, string | null]> = [
      ['%이름%님 안녕하세요. 이번 주 혜택을 확인해 보세요.', null],
      ['[혜택을 직접 입력해 주세요]', null],
      ['%없는변수% 안녕하세요', null],
      ['{{ cart.product_name }} 담아 두셨어요', null],
      ['안녕하세요', '%이름%님께'],
      ['3 < 5 || 2 > 1 | 그리고 <광고>', null],
    ];
    for (const [body, subject] of cases) {
      const copy = { bodies: [body], subjects: [subject] };
      expect(journeyCopyIssue(copy, ctxOpen)).toEqual(journeyCopyIssue(copy, ctxOld));
      expect(journeyCopyIssue(copy, { ...ctxOpen, hasVariants: true })).toEqual(journeyCopyIssue(copy, ctxOld));
      expect(journeyCopyIssue(copy, ctxOld)?.code).not.toBe('RECO_SLOT');
    }
  });
  it('맞는 자리 = 통과 · 모르는 변수로 보지 않는다', () => {
    expect(journeyCopyIssue({ bodies: [BODY], subjects: [null] }, ctxOpen)).toBeNull();
  });
  it('열림 값이 없으면 닫힘으로 본다(안 열린 회사의 글 = 막음)', () => {
    expect(journeyCopyIssue({ bodies: [BODY], subjects: [null] }, ctxOld)?.code).toBe('RECO_SLOT');
    expect(journeyCopyIssue({ bodies: [BODY], subjects: [null] }, { ...ctxOpen, recoAllowed: false })?.code).toBe('RECO_SLOT');
  });
  it('제목의 자리 · 틀린 꼴 · A/B 칸 · 다른 문법 안 = RECO_SLOT', () => {
    expect(journeyCopyIssue({ bodies: ['안녕하세요 고객님'], subjects: [SLOT] }, ctxOpen)).toMatchObject({ code: 'RECO_SLOT', message: expect.stringMatching(/제목/) });
    expect(journeyCopyIssue({ bodies: ['<추천상품: A | B>'], subjects: [null] }, ctxOpen)?.code).toBe('RECO_SLOT');
    expect(journeyCopyIssue({ bodies: [BODY], subjects: [null] }, { ...ctxOpen, hasVariants: true })?.code).toBe('RECO_SLOT');
    expect(journeyCopyIssue({ bodies: ['%<추천상품: 이름 || 이름>%'], subjects: [null] }, ctxOpen)?.code).toBe('RECO_SLOT');
  });
  it('판 여럿 중 하나에만 틀린 자리가 있어도 막는다', () => {
    expect(journeyCopyIssue({ bodies: ['안녕하세요 고객님', '<추천상품: A>'], subjects: [null, null] }, ctxOpen)?.code).toBe('RECO_SLOT');
  });
  it('자리 밖의 기존 판정은 그대로 건다(자리 있는 글의 없는 변수)', () => {
    expect(journeyCopyIssue({ bodies: [`%없는변수% ${SLOT}`], subjects: [null] }, ctxOpen)?.code).toBe('UNKNOWN_VARIABLE');
  });
});

describe('검사 = 나갈 수 있는 글 전부(공용 검사 함수 안 한 곳)', () => {
  const params = { companyId: 'c', userId: 'u', subject: null, channel: 'lms' as const, isAd: true, callbackNumber: '01000000000', journeyId: 'j' };
  const outcomes: Record<string, 'pass' | 'blocked' | 'pending' | 'error'> = {};

  beforeEach(() => {
    for (const k of Object.keys(outcomes)) delete outcomes[k];
    render.renderJourneySmsMessage.mockReset();
    spamQueue.enqueueSpamTest.mockReset();
    spamQueue.readSpamTestOutcome.mockReset();
    spamQueue.peekSpamCheck.mockReset();
    // 렌더 = 그 판으로 강제한 글(판 번호를 글에 남긴다) · 검사 번호 = 그 글
    render.renderJourneySmsMessage.mockImplementation(async (i: any) => ({ message: `글:${i.recoIndex === undefined ? '고객' : i.recoIndex}`, subject: '', msgType: 'LMS', isAd: true }));
    spamQueue.enqueueSpamTest.mockImplementation(async (p: any) => ({ ok: true, testId: p.messageContentLms, reused: false }));
    spamQueue.readSpamTestOutcome.mockImplementation(async (id: string) => ({
      outcome: outcomes[id] ?? 'pass',
      carrierResults: outcomes[id] === 'blocked' ? [{ carrier: 'SKT', messageType: 'LMS', result: 'blocked' }] : [],
    }));
    spamQueue.peekSpamCheck.mockImplementation(async (p: any) => (outcomes[p.messageContentLms] === undefined ? null : { testId: p.messageContentLms, outcome: outcomes[p.messageContentLms], status: 'completed', createdAt: new Date() }));
  });

  it('자리 없는 글 = 종전처럼 한 번(판을 강제하지 않는다)', async () => {
    const r = await runStepSpamTest({ ...params, body: '안녕하세요 고객님' });
    expect(r.verdict).toBe('pass');
    expect(spamQueue.enqueueSpamTest).toHaveBeenCalledTimes(1);
    expect(render.renderJourneySmsMessage.mock.calls[0][0].recoIndex).toBeUndefined();
    expect(r.recoBlocked).toBeUndefined();
  });
  it('자리 있는 글 = 후보마다 + 대체 문장(N + 1) · 판마다 그 판으로 렌더한 글을 검사', async () => {
    const r = await runStepSpamTest({ ...params, body: BODY });
    expect(r.verdict).toBe('pass');
    expect(spamQueue.enqueueSpamTest).toHaveBeenCalledTimes(4);
    expect(spamQueue.enqueueSpamTest.mock.calls.map((c) => c[0].messageContentLms).sort()).toEqual(['글:0', '글:1', '글:2', '글:3']);
    expect(r.recoBlocked).toEqual([]);
  });
  it('한 판이라도 차단 = 차단 · 걸린 후보의 이름을 싣는다', async () => {
    outcomes['글:1'] = 'blocked';
    const r = await runStepSpamTest({ ...params, body: BODY });
    expect(r.verdict).toBe('blocked');
    expect(r.ok).toBe(false);
    expect(r.recoBlocked).toEqual(['선크림']);
    expect(r.failedCarriers).toEqual(['SKT(LMS)']);
  });
  it('대체 문장만 걸려도 차단 · 이름표 = 대체 문장', async () => {
    outcomes['글:3'] = 'blocked';
    const r = await runStepSpamTest({ ...params, body: BODY });
    expect(r.verdict).toBe('blocked');
    expect(r.recoBlocked).toEqual(['대체 문장']);
  });
  it('차단 없이 한 판이 검사 장애 = 장애(통과로 읽지 않는다)', async () => {
    outcomes['글:2'] = 'error';
    const r = await runStepSpamTest({ ...params, body: BODY });
    expect(r.verdict).toBe('error');
    expect(r.ok).toBe(false);
  });
  it('틀린 꼴의 자리 = 펼치지 않는다(보낼 글 판정이 먼저 막는 글 · 한 번)', async () => {
    await runStepSpamTest({ ...params, body: '<추천상품: A | B>' });
    expect(spamQueue.enqueueSpamTest).toHaveBeenCalledTimes(1);
  });
  it('검사 글을 만들다 추천 자리가 사라진 판 = 통과가 아니다(고칠 글) · 그 판은 검사 등록 · 차감을 하지 않는다', async () => {
    render.renderJourneySmsMessage.mockImplementation(async (i: any) => {
      if (i.recoIndex === 1) throw new RecoSlotLostError();
      return { message: `글:${i.recoIndex}`, subject: '', msgType: 'LMS', isAd: true };
    });
    const r = await runStepSpamTest({ ...params, body: BODY });
    expect(r.verdict).toBe('rejected');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/추천 상품 자리가 받는 글에서 사라졌어요/);
    expect(spamQueue.enqueueSpamTest.mock.calls.map((c) => c[0].messageContentLms).sort()).toEqual(['글:0', '글:2', '글:3']);   // 사라진 판은 등록하지 않는다
    // 엿보기도 같다(검사 전으로 읽지 않는다 · 통과로 읽지 않는다)
    outcomes['글:0'] = 'pass'; outcomes['글:2'] = 'pass'; outcomes['글:3'] = 'pass';
    const p = await peekStepSpam({ ...params, body: BODY });
    expect(p?.verdict).toBe('rejected');
    expect(p?.error).toMatch(/사라졌어요/);
  });
  it('자리가 사라진 것이 아닌 렌더 오류 = 지금처럼 검사 장애(고칠 글로 읽지 않는다)', async () => {
    render.renderJourneySmsMessage.mockImplementation(async () => { throw new Error('db down'); });
    const r = await runStepSpamTest({ ...params, body: '안녕하세요 고객님' });
    expect(r.verdict).toBe('error');
    await expect(peekStepSpam({ ...params, body: '안녕하세요 고객님' })).rejects.toThrow('db down');
  });
  it('시연 회사 = 검사 글도 만들지 않고 통과(검사 걸기 · 엿보기 · 추천 자리가 든 글도 · 검사 발송 0 계약 그대로)', async () => {
    demo.isDemoCompany.mockResolvedValue(true);
    try {
      const r = await runStepSpamTest({ ...params, body: BODY });
      expect(r.verdict).toBe('pass');
      expect((await peekStepSpam({ ...params, body: BODY }))?.verdict).toBe('pass');
      expect((await peekStepSpam({ ...params, body: '안녕하세요 고객님' }))?.verdict).toBe('pass');
      expect(render.renderJourneySmsMessage).not.toHaveBeenCalled();
      expect(spamQueue.enqueueSpamTest).not.toHaveBeenCalled();
      expect(spamQueue.peekSpamCheck).not.toHaveBeenCalled();
    } finally { demo.isDemoCompany.mockResolvedValue(false); }
  });
  it('엿보기 = 한 판이라도 검사 전이면 검사 전 · 전부 있으면 판 전부의 판정', async () => {
    outcomes['글:0'] = 'pass'; outcomes['글:1'] = 'pass'; outcomes['글:2'] = 'pass';
    expect(await peekStepSpam({ ...params, body: BODY })).toBeNull();   // 대체 문장 판이 검사 전
    outcomes['글:3'] = 'pass';
    expect((await peekStepSpam({ ...params, body: BODY }))?.verdict).toBe('pass');
    outcomes['글:3'] = 'blocked';
    const r = await peekStepSpam({ ...params, body: BODY });
    expect(r?.verdict).toBe('blocked');
    expect(r?.recoBlocked).toEqual(['대체 문장']);
    expect(spamQueue.enqueueSpamTest).not.toHaveBeenCalled();   // 엿보기는 검사를 걸지 않는다
  });
  it('엿보기 = 확정된 차단이 있으면 다른 판이 검사 전이어도 차단과 그 후보 이름을 알린다', async () => {
    outcomes['글:1'] = 'blocked';   // 선크림만 검사됐고 걸렸다 · 나머지 셋은 검사 전
    const r = await peekStepSpam({ ...params, body: BODY });
    expect(r?.verdict).toBe('blocked');
    expect(r?.ok).toBe(false);
    expect(r?.recoBlocked).toEqual(['선크림']);
    // 걸린 판 없이 검사 중인 판과 검사 전인 판이 섞이면 = 검사 전(켜기가 전부 건다)
    delete outcomes['글:1']; outcomes['글:0'] = 'pending';
    expect(await peekStepSpam({ ...params, body: BODY })).toBeNull();
  });
});

describe('켜기 검증 = 걸린 후보 이름을 적는다(고칠 곳 = 후보)', () => {
  const stepRow = (body: string) => ({ step_id: 's1', channel: 'lms', message_template: body, subject: '제목', is_ad: true, callback_number: '0212345678', step_order: 1, trigger_event: 'signup' });
  const blocked = (recoBlocked?: string[]) => async () => ({ verdict: 'blocked' as const, ok: false, enqueueOk: true, failedCarriers: ['SKT(LMS)'], matchedStopWords: [], score: 0, ...(recoBlocked ? { recoBlocked } : {}) });
  const run = async (body: string, spam: any) => {
    (query as any).mockImplementation(async (sql: string) => (/FROM journey_steps s/.test(sql) ? { rows: [stepRow(body)] } : { rows: [] }));
    render.journeyCopyContext.mockResolvedValue({ knownVarNames: new Set(['이름']), cartJourney: false, recoAllowed: true, hasVariants: false });
    try { return await validateJourneyForActivation('c', 'j', 'u', { spam }); }
    finally { (query as any).mockImplementation(async () => ({ rows: [] })); }
  };

  it('추천 자리 판이 걸리면 그 후보 이름 · 자리 없는 글은 종전 문구', async () => {
    const withSlot = await run(BODY, blocked(['선크림', '대체 문장']));
    expect(withSlot.ok).toBe(false);
    expect(withSlot.failedSteps).toHaveLength(1);
    expect(withSlot.failedSteps[0]).toMatchObject({ stepId: 's1', reason: 'spam_filter_failed', details: '추천 상품 후보(선크림, 대체 문장)가 스팸 검사에 걸렸어요. 후보에서 빼거나 바꿔 주세요.' });
    const plain = await run('%이름%님 안녕하세요. 이번 주 혜택을 확인해 보세요.', blocked());
    expect(plain.failedSteps[0]).toMatchObject({ reason: 'spam_filter_failed', details: '통신사 차단: SKT(LMS)' });
    // 판은 걸렸는데 이름표가 비면(통신사 결과 없음) 종전 문구
    const empty = await run(BODY, blocked([]));
    expect(empty.failedSteps[0].details).toBe('통신사 차단: SKT(LMS)');
  });
  it('검사가 「자리가 사라졌다」로 돌아오면 켜기 검증은 고칠 글(copy_issue)로 그 문장을 적는다(검사 장애로 적지 않는다)', async () => {
    const lost = new RecoSlotLostError().message;
    const r = await run(BODY, async () => ({ verdict: 'rejected', ok: false, enqueueOk: false, failedCarriers: [], matchedStopWords: [], score: 0, error: lost }));
    expect(r.ok).toBe(false);
    expect(r.failedSteps[0]).toMatchObject({ reason: 'copy_issue', details: lost });
  });
  it('켜기 검증은 판을 스스로 고르지 않고 본문을 그대로 넘긴다(펼침은 검사 함수 몫)', async () => {
    const seen: any[] = [];
    await run(BODY, async (p: any) => { seen.push(p); return { verdict: 'pass', ok: true, enqueueOk: true, failedCarriers: [], matchedStopWords: [], score: 95 }; });
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toBe(BODY);
    expect(seen[0].recoIndex).toBeUndefined();
  });
});

describe('계약(소스)', () => {
  const validator = src('journey-pretest-validator.ts');
  const notifier = src('journey-pretest-notifier.ts');
  const body = (text: string, start: string, end: string) => { const a = text.indexOf(start); const b = text.indexOf(end, a + start.length); if (a < 0 || b < 0) throw new Error(`구간 없음: ${start}`); return text.slice(a, b); };

  it('펼침은 공용 검사 함수 둘(runStepSpamTest · peekStepSpam) 안에만 있다', () => {
    const uses = validator.split('recoVersionCount(').length - 1;
    expect(uses).toBe(2);
    expect(body(validator, 'export async function runStepSpamTest(', '\n}\n')).toContain('recoVersionCount(params.body)');
    expect(body(validator, 'export async function peekStepSpam(', '\n}\n')).toContain('recoVersionCount(params.body)');
    // 판 하나를 검사하는 안쪽 함수는 밖에 내보내지 않는다(밖에서 부르면 펼침을 건너뛴다)
    expect(validator).toContain('\nasync function runOneStepSpamTest(');
    expect(validator).toContain('\nasync function peekOneStepSpam(');
    expect(validator).not.toMatch(/export\s+async\s+function\s+(runOneStepSpamTest|peekOneStepSpam)/);
  });
  it('검사 글 = 그 판으로 렌더한 글(판 번호가 렌더까지 간다)', () => {
    expect(body(validator, 'async function stepSpamInput(', '\n}\n')).toContain('recoIndex: params.recoIndex');
  });
  it('검사 네 길(켜기 검증 · 발송 2시간 전 · 주간 · 재작성 후보)이 그 함수를 부르고 판을 스스로 고르지 않는다', () => {
    expect(validator).toContain('const spam = opts.spam ?? runStepSpamTest;');
    expect(notifier.split('runStepSpamTest({').length - 1).toBeGreaterThanOrEqual(3);
    expect(notifier).not.toContain('recoIndex');
    expect(notifier).not.toContain('runOneStepSpamTest');
    // 켜기 검증의 호출도 판 번호를 싣지 않는다
    expect(body(validator, 'const r = await spam({', '});')).not.toContain('recoIndex');
  });
  it('실행기 = 판을 강제하지 않는다(그 고객으로 고른다)', () => {
    const exec = src('journey-executor.ts');
    expect(exec).toContain('renderJourneySmsMessage({');
    expect(exec).not.toContain('recoIndex');
  });
  it('렌더 = 표식으로 바꾼 글이 기존 길을 지난 뒤에 채운다 · 채울 글자도 같은 글자 정리', () => {
    const r = src('journey-message-render.ts');
    const fn = r.slice(r.indexOf('export async function renderJourneySmsMessage('), r.indexOf('export async function pickJourneySampleCustomer('));
    const mask = fn.indexOf('maskRecoSlot(');
    const prep = fn.indexOf('prepareSendMessage(');
    const fill = fn.indexOf('fillRecoSlot(');
    expect(mask).toBeGreaterThan(0);
    expect(prep).toBeGreaterThan(mask);
    expect(fill).toBeGreaterThan(prep);
    expect(fn).toContain('if (!reco) return { message: prep.message, subject: prep.subject, msgType, isAd };');
    expect(fn).toContain('fillRecoSlot(prep.message, reco.token, sanitizeUnsendableForSms(chosen).sanitized)');
    // 채우는 자리가 마지막 판정: 표식을 먼저 확인하고(없으면 고르기 조회 전에 던진다) · 채운 결과가 null 이어도 던진다 · 자리 없는 글을 돌려주는 길이 없다
    const lostFirst = fn.indexOf("if (fillRecoSlot(prep.message, reco.token, '') === null) throw new RecoSlotLostError();");
    expect(lostFirst).toBeGreaterThan(prep);
    expect(fn.indexOf('await recoTextFor(')).toBeGreaterThan(lostFirst);
    expect(fn).toContain('if (filled === null) throw new RecoSlotLostError();');
    expect(fn).toContain('return { message: filled, subject: prep.subject, msgType, isAd };');
  });
  it('실행기 = 추천 자리가 사라진 고객에게는 보내지 않는다(그 고객만 실패 · 그 밖의 렌더 오류는 지금처럼 던진다)', () => {
    const exec = src('journey-executor.ts');
    expect(exec).toContain('}).catch((err) => { if (err instanceof RecoSlotLostError) return null; throw err; });');
    expect(exec).toContain("if (r.recoLost) out = { kind: 'fail', reason: 'reco_slot_lost' };");
    // 사라진 줄은 발송 줄에 들어가지 않는다(그 판정이 발송 갈래보다 앞)
    expect(exec.indexOf("if (r.recoLost) out = { kind: 'fail', reason: 'reco_slot_lost' };")).toBeLessThan(exec.indexOf("out = { kind: 'send' };"));
    expect(validator).toContain('if (err instanceof RecoSlotLostError) return recoLostResult(err);');
    expect(validator.split('instanceof RecoSlotLostError').length - 1).toBe(2);   // 검사 걸기 · 엿보기
  });
  it('AI 가 손대지 않는 세 자리(고치기 · 다시 쓰기 · A/B 문안 만들기)에 추천 자리 판정이 조건 태그 판정과 나란히 있다', () => {
    const gen = src('journey-ai-generator.ts');
    expect(gen).toContain('if (hasRecoMark(args[0].currentMessage)) throw new JourneyInputError(RECO_SLOT_NOTICE);');
    expect(body(gen, 'export async function regenerateStepAvoidingSpam(', 'runChargedAi(')).toContain('if (hasRecoMark(input.currentMessage)) return null;');
    const vg = src('variant-generator.ts');
    expect(vg).toContain('if (hasRecoMark(baseMessage)) {');
    // 조건 태그 판정이 있는 자리 수 = 추천 자리 판정이 있는 자리 수(새 자리가 생기면 둘 다 넣는다)
    for (const t of [gen, vg]) expect(t.split('hasRecoMark(').length).toBe(t.split('hasLiquidTags(').length);
  });
  it('고치는 여정 AI 글의 한 관문(journeyRevisedCopy) = 추천 자리가 든 글은 글자 그대로일 때만 통과 · AI 가 자리를 만들어 넣지 못한다', () => {
    expect(journeyRevisedCopy(BODY, BODY)).toBe(BODY);
    expect(journeyRevisedCopy(BODY.replace('어떠세요', '추천드려요'), BODY)).toBeNull();                    // 자리 밖을 고쳐도 받지 않는다
    expect(journeyRevisedCopy(BODY.replace('선크림', '립밤'), BODY)).toBeNull();                              // 후보를 바꿈
    expect(journeyRevisedCopy('%이름%님, 요즘 많이 찾는 상품 어떠세요?', BODY)).toBeNull();                  // 자리를 지움
    expect(journeyRevisedCopy(`%이름%님 ${SLOT}`, '%이름%님 안녕하세요')).toBeNull();                        // 원문에 없던 자리를 만듦
    expect(journeyRevisedKept(BODY, BODY)).toBe(true);
    expect(journeyRevisedKept(BODY.replace('선크림', '립밤'), BODY)).toBe(false);
    // 자리와 무관한 글 = 종전 규칙 그대로
    expect(journeyRevisedCopy('%이름%님 반가워요', '%이름%님 안녕하세요')).toBe('%이름%님 반가워요');
    // 여정을 통째로 고치는 AI 수정 = 추천 자리가 든 칸이 있으면 칸 대응을 고정하고(칸 수 그대로 · i번째끼리) 그 관문으로 대조한다
    expect(copyPinned(BODY)).toBe(true);
    expect(copyPinned('{{ customer.name }}님')).toBe(true);
    expect(copyPinned('%이름%님 안녕하세요')).toBe(false);
    expect(copyPinned(null)).toBe(false);
    const editor = src('journey-ai-editor.ts');
    expect(editor).toContain('const liquidPackage = curSteps.some((c) => copyPinned(c?.messageTemplate) || copyPinned(c?.subject));');
    expect(editor).toContain("const copyBaseOf = (i: number, field: 'messageTemplate' | 'subject'): string => (liquidPackage ? String(curSteps[i]?.[field] || '') : '');");
    expect(editor).toContain("(s.stepType === 'message' && s.channel !== 'kakao') || copyPinned(copyBaseOf(i, field));");
    expect(editor).toContain('journeyRevisedCopy(String(s[field] || \'\'), copyBaseOf(i, field))');
    expect(editor).toContain('journeyRevisedKept(String(s[field] || \'\'), copyBaseOf(i, field))');
    expect(editor).not.toContain('detectLiquidSyntax');   // 칸 대응 고정 판정은 copyPinned 한 곳
    const copy = src('journey-ai-copy.ts');
    const fn = copy.slice(copy.indexOf('export function journeyRevisedCopy('), copy.indexOf('export function journeyRevisedKept('));
    expect(fn.indexOf('if (hasRecoMark(base) || hasRecoMark(ai)) return ai === base ? ai : null;')).toBeGreaterThan(0);
    expect(fn.indexOf('hasRecoMark(base)')).toBeLessThan(fn.indexOf('if (!detectLiquidSyntax(ai) && !detectLiquidSyntax(base)) return ai;'));
  });
  it('A/B 문안 쓰기 문 = 추천 자리가 든 칸 · 글을 받지 않는다 · 켜기 관문과 칸 저장은 A/B 여부를 판정에 싣는다', () => {
    expect(src('bandit-optimizer.ts')).toContain("if (hasRecoMark(own.rows[0].message_template) || hasRecoMark(input.messageTemplate)) throw new JourneyStepGateError(");
    const builder = src('journey-builder.ts');
    expect(builder).toContain('await journeyCopyContext(companyId, triggerEvent, [body], abRows.length > 0)');
    expect(builder).toContain('await journeyCopyContext(companyId, cur.trigger_event, [cur.message_template], cur.has_variants === true)');
    expect(validator).toContain('await journeyCopyContext(companyId, triggerEvent, [msg.body], msg.variantId != null)');
    expect(src('journey-message-render.ts')).toContain('    hasVariants,\n  };');
  });
  it('수동 검사 창(글 하나의 검사 하나)은 추천 자리가 든 칸을 받지 않는다', () => {
    expect(body(validator, 'export async function journeyStepSpamParams(', '\n}\n')).toContain("if (hasRecoMark(v.body)) throw new UserFacingError(400, 'RECO_STEP'");
  });
  it('순수 파일 = DB 를 끌어오지 않는다(보낼 글 판정 CT 가 읽는다)', () => {
    const slot = src('reco-slot.ts');
    expect(slot).not.toContain('config/database');
    expect(slot.match(/^import .*$/gm)).toEqual(["import { randomBytes } from 'crypto';", "import { scanSmsText, sanitizeUnsendableForSms } from './message-sanitizer';", "import { detectLiquidSyntax, liquidTokens } from './liquid-templating';", "import { findVarTokens } from './var-tokens';", "import { UserFacingError } from './http-error';"]);
    expect(src('http-error.ts')).not.toContain('config/database');
    // 그 파일들도 DB 를 끌어오지 않는다
    for (const f of ['message-sanitizer.ts', 'liquid-templating.ts', 'var-tokens.ts']) expect(src(f)).not.toContain('config/database');
    // 판정은 원문을 정규식으로 읽지 않는다(렌더의 정리 · 렌더의 파서)
    const issue = slot.slice(slot.indexOf('export function recoSlotIssue('));
    expect(issue).toContain('sanitizeUnsendableForSms(text.replace(r.slot.raw, () => probe)).sanitized');
    expect(issue).toContain('liquidTokens(seen)');
    expect(issue).not.toMatch(/includes\('\{%'\)|new RegExp\(/);
  });
  it('회사 값 = 추천 자리가 든 글이 있을 때만 단계 개방을 읽고 · 닫힘이 확인된 회사만 막는다', () => {
    const r = src('journey-message-render.ts');
    expect(r).toContain("recoAllowed: bodies.some((t) => hasRecoMark(t)) ? (await v3LiveState('reco', companyId)) !== 'closed' : false,");
  });
});

/** 문자 바이트(한글 등 2바이트 · 그 밖 1바이트) — 화면 calculateSmsBytes 와 같은 셈의 시험용 꼴 */
const bytes = (s: string) => Array.from(s).reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);

describe('화면 쪽 읽기 = 서버와 같은 답(보낼 수 없는 글자 판정만 서버 몫)', () => {
  const cases = [
    BODY, '<추천상품: A || B>', '<추천상품:A|B||C>', '  앞 <추천상품: 수분 크림 | 선 크림 || 인기 상품> 뒤', '안녕하세요', '', '3 < 5 || 2 > 1',
    '<추천상품: A | B>', '<추천상품: || 대체>', '<추천상품: A | | B || 대체>', '<추천상품: A | B | C | D || E>', '<추천상품: A || B || C>', '<추천상품: A || B | C>',
    '<추천상품: A || B> <추천상품: C || D>', '<추천상품: A || B', '<추천상품 A || B>', '<추천상품: A\n || B>', '<추천상품: A | A || B>',
    '<추천상품: 50% || B>', '<추천상품: {{ a }} || B>', '<추천상품: A || [직접 입력]>', '<추천상품: A || >',
  ];
  it.each(cases)('같은 판정 · 같은 후보 — %s', (t) => {
    const b = readRecoSlot(t);
    const f = front.readRecoSlot(t);
    expect(f.kind).toBe(b.kind);
    if (b.kind === 'ok' && f.kind === 'ok') expect(f.slot).toEqual(b.slot);
    expect(front.hasRecoMark(t)).toBe(hasRecoMark(t));
  });
  it('보낼 수 없는 글자(이모지 · 보이지 않는 글자) = 서버만 막는다(화면은 읽고 · 저장 · 켜기 때 서버 사유가 뜬다)', () => {
    for (const t of ['<추천상품: 반짝😊크림 || B>', '<추천상품: A​ || B>']) {
      expect(front.readRecoSlot(t).kind).toBe('ok');
      expect(readRecoSlot(t).kind).toBe('bad');
    }
  });
  it('화면이 만든 자리 글자 = 서버가 맞는 자리로 읽는다(앞뒤 공백 정리)', () => {
    const tag = front.buildRecoTag([' 수분 크림 ', '선크림'], ' 요즘 많이 찾는 상품 ');
    expect(tag).toBe('<추천상품: 수분 크림 | 선크림 || 요즘 많이 찾는 상품>');
    expect(readRecoSlot(`안녕하세요 ${tag}`)).toMatchObject({ kind: 'ok', slot: { raw: tag, names: ['수분 크림', '선크림'], fallback: '요즘 많이 찾는 상품' } });
  });
  it('다른 문법의 글자 = 화면 금지 글자와 서버 판정이 같은 글자', () => {
    for (const ch of ['<', '>', '|', '%', '{', '}', '[', ']', '\n', '\r']) {
      expect(front.recoTextForbidden(`가${ch}나`)).toBe(true);
      expect(recoTextIssue(`가${ch}나`)).toBeTruthy();
    }
    for (const t of ['수분 크림 50ml', '★특가', 'A/B (1+1)']) { expect(front.recoTextForbidden(t)).toBe(false); expect(recoTextIssue(t)).toBeNull(); }
  });
  it('완성된 판 전부 = 자리를 표식으로 → 합성 → 판마다 채움(서버 렌더와 같은 순서) · 자리가 없거나 틀리면 null', () => {
    const compose = (t: string) => `(광고)${t}\n무료수신거부`;
    expect(front.recoComposedVersions(BODY, compose)).toEqual([
      '(광고)%이름%님, 수분크림 어떠세요?\n무료수신거부', '(광고)%이름%님, 선크림 어떠세요?\n무료수신거부',
      '(광고)%이름%님, 세럼 어떠세요?\n무료수신거부', '(광고)%이름%님, 요즘 많이 찾는 상품 어떠세요?\n무료수신거부',
    ]);
    expect(front.recoComposedVersions('자리 없음', compose)).toBeNull();
    expect(front.recoComposedVersions('<추천상품: A | B>', compose)).toBeNull();
  });
  it('합성은 글자를 넣기 전의 글(표식)을 본다 — 대체 문장에 수신거부 문구가 있어도 꼬리 줄이 붙은 바이트(서버와 같다)', () => {
    // 본문에 수신거부 문구가 있으면 꼬리 줄을 안 붙이는 합성(화면 buildAdMessageFront 와 같은 꼴의 시험용 함수)
    const compose = (t: string) => (t.includes('수신거부') ? `(광고)${t}` : `(광고)${t}\n무료수신거부 08012345678`);
    const t = '안내 <추천상품: ABCDEFGHIJKLM || 무료수신거부 상품>';
    const versions = front.recoComposedVersions(t, compose)!;
    expect(versions).toEqual(['(광고)안내 ABCDEFGHIJKLM\n무료수신거부 08012345678', '(광고)안내 무료수신거부 상품\n무료수신거부 08012345678']);
    expect(Math.max(...versions.map(bytes))).toBe(bytes('(광고)안내 무료수신거부 상품\n무료수신거부 08012345678'));
    // 글자를 먼저 넣고 합성하면 꼬리 줄이 빠진 더 작은 값이 나온다(옛 길 · 서버와 다르다)
    expect(bytes(compose('안내 무료수신거부 상품'))).toBeLessThan(Math.max(...versions.map(bytes)));
  });
  it('가장 큰 판 = 글자 수가 아니라 바이트(영문 10자 = 10바이트 < 한글 6자 = 12바이트)', () => {
    const versions = front.recoComposedVersions('<추천상품: ABCDEFGHIJ | 수분보습크림 || 인기>', (x) => x)!;
    expect(versions).toEqual(['ABCDEFGHIJ', '수분보습크림', '인기']);
    expect('ABCDEFGHIJ'.length).toBeGreaterThan('수분보습크림'.length);
    expect(versions.reduce((a, b) => (bytes(b) > bytes(a) ? b : a))).toBe('수분보습크림');
  });
  it('화면 표식 = 부를 때마다 새 무작위 글자열 — 합성이 넣은 고객 값이 표식처럼 생겨도 그 값은 후보로 바뀌지 않는다', () => {
    const seen: string[] = [];
    const compose = (masked: string) => { seen.push(masked); return masked.replace('%이름%', 'HJRECOSCREEN'); };
    expect(front.recoComposedVersions('%이름%님 <추천상품: 신상품 || 기본상품>', compose)).toEqual(['HJRECOSCREEN님 신상품', 'HJRECOSCREEN님 기본상품']);
    front.recoComposedVersions('%이름%님 <추천상품: 신상품 || 기본상품>', compose);
    expect(seen[0]).not.toBe(seen[1]);                                   // 표식이 매번 다르다
    expect(seen[0]).toMatch(/^%이름%님 HJRECO[0-9A-F]{24}$/);
  });
  it('합성이 표식을 지우거나 불리면 null(판을 지어내지 않는다 · 서버 채우기와 같은 불변식)', () => {
    expect(front.recoComposedVersions('안내 <추천상품: A || B>', () => '표식이 사라진 글')).toBeNull();
    expect(front.recoComposedVersions('안내 <추천상품: A || B>', (m) => `${m} ${m}`)).toBeNull();
  });
  it('빼기 = 맞는 자리만 지운다', () => {
    expect(front.removeRecoSlot(BODY)).toBe('%이름%님,  어떠세요?');
    expect(front.removeRecoSlot('<추천상품: A | B>')).toBe('<추천상품: A | B>');
  });
});

describe('계약(화면 소스)', () => {
  const fe = (rel: string) => readFileSync(resolve(__dirname, '../../../../frontend/src', rel), 'utf8').replace(/\r\n/g, '\n');
  it('휴대폰 편집기 = 고른 판을 서버에 싣고 · 판이 바뀌면 지난 받는 모습을 버린다 · 바이트는 가장 긴 판', () => {
    const p = fe('components/journey/PhoneComposer.tsx');
    expect(p).toContain('...(recoIndex !== undefined ? { recoIndex } : {})');
    expect(p).toContain("setServerBusy(false); if (mode === 'see') void openSee(); }, [recoIndex]);");
    expect(p).toContain('recoVersions !== null ? Math.max(...recoVersions.map((v) => calculateSmsBytes(v))) : calculateSmsBytes(composed)');
    expect(p).toContain("hasReco ? recoComposedVersions(body || '', (masked) => buildAdMessageFront(masked, msgType, isAd, opt080Number)) : null");
    expect(p).toContain("const versions = recoComposedVersions(body || '', see);");
    expect(p).toContain('if (!versions) return see(body || \'\');');   // 판을 못 만들면 원문 합성 그대로(지어낸 판 0)
    const fr = fe('utils/reco-slot.ts');
    expect(fr).toContain('crypto.getRandomValues(new Uint8Array(12))');
    expect(fr).toContain('if (parts.length !== 2) return null;');
    expect(p).not.toContain('fillRecoForCount');
  });
  it('칸 편집 화면 = 알림톡 칸 · 본문 잠금 칸에는 추천 상품 줄이 없다 · 넣기는 본문 커서 자리(변수 넣기와 같은 길)', () => {
    const s = fe('components/journey/JourneyStepStudio.tsx');
    expect(s).toContain("{!copyLock && step.channel !== 'kakao' && (\n            <RecoSlotControl\n              key={recoKey}");   // 칸마다 새 편집 상태
    expect(s).toContain('const recoKey = stepUid ?? String(stepKey);');
    expect(s).toContain('useEffect(() => { setRecoView(undefined); }, [recoKey]);');
    // 작업 화면이 칸의 고유 식별자(저장된 칸 id · 새 칸 임시 id)를 넘긴다 — 순서 번호는 칸을 빼고 더하면 겹친다
    expect(fe('components/journey/workspace/JourneyWorkspace.tsx')).toContain('<JourneyStepStudio\n                        step={selStudio}\n                        stepUid={selected}');
    expect(s).toContain('onInsert={insertText}');
    expect(s).toContain('const insertVar = (name: string) => insertText(`%${name}%`);');
  });
  it('추천 상품 줄 = 열리지 않은 회사에는 그리지 않는다 · 사용자 화면에 모델 이름 없음', () => {
    const c = fe('components/journey/RecoSlotControl.tsx');
    expect(c).toContain('if (!data || !data.live) return null;');
    expect(c).toContain("fetchJson('/api/product-insight/reco-candidates')");
    // 서버: 라우트는 단계 판정을 직접 하지 않는다(관문 = CT recoCandidatesFor · 닫힌 회사 = 후보 0)
    const route = readFileSync(resolve(__dirname, '../../routes/product-insight.ts'), 'utf8');
    expect(route).toContain('...(await recoCandidatesFor(');
    expect(route).not.toMatch(/v3Live\(|suggestRecoCandidates/);
    expect(src('product-reco.ts')).toContain("if (!companyId || !(await v3Live('reco', companyId))) return { live: false, hasSignals: false, candidates: [], max: RECO_MAX_CANDIDATES };");
    for (const f of [c, fe('utils/reco-slot.ts')]) expect(f).not.toMatch(/Claude|Anthropic|GPT|Opus|Sonnet|Haiku|Fable/i);
  });
});
