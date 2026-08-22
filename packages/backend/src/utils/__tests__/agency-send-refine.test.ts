/**
 * 대행발송 문안 다듬기 계약 (★ 2026-08-22) — docs/2026-08-22-agency-send-design.md 불변 8
 *
 * 이 파일이 잠그는 것: **고객이 보낸 약속은 다듬어도 그대로 남는다.**
 *   날짜가 하루 밀리거나 전화번호가 바뀌면 그건 다른 발송이다. AI가 그렇게 쓰면 그 결과를 버린다.
 */
import { describe, it, expect } from 'vitest';
import { checkRefined, extractAnchors, buildRefinePrompt, refineForSpam } from '../agency-send-refine';

const COMPANY = '00000000-0000-0000-0000-0000000000aa';
const ORIGINAL = '[한줄상회] %이름%님, 8월 24일 오후 2시부터 가을 신상 행사를 엽니다. 문의 02-1234-5678 https://hanjul.ai/e/1';

describe('핵심 토큰 추출', () => {
  it('날짜·시각·전화번호·링크·변수를 잡는다', () => {
    const a = extractAnchors(ORIGINAL);
    expect(a.has('8월24일')).toBe(true);
    expect(a.has('2시')).toBe(true);
    expect(a.has('02-1234-5678')).toBe(true);
    expect(a.has('https://hanjul.ai/e/1')).toBe(true);
    expect(a.has('%이름%')).toBe(true);
  });

  it('공백이 달라도 같은 토큰으로 본다', () => {
    expect(extractAnchors('8월 24일').has('8월24일')).toBe(true);
    expect(extractAnchors('8월24일').has('8월24일')).toBe(true);
  });
});

describe('다듬은 문안 검사', () => {
  it('표현만 바뀌고 약속이 남아 있으면 통과', () => {
    const refined = '[한줄상회] %이름%님, 8월 24일 오후 2시부터 가을 신상품을 소개합니다. 문의 02-1234-5678 https://hanjul.ai/e/1';
    expect(checkRefined(ORIGINAL, refined).ok).toBe(true);
  });

  it('날짜가 바뀌면 버린다', () => {
    const refined = '[한줄상회] %이름%님, 8월 25일 오후 2시부터 가을 신상 행사를 엽니다. 문의 02-1234-5678 https://hanjul.ai/e/1';
    const r = checkRefined(ORIGINAL, refined);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('anchor-lost');
  });

  it('전화번호나 링크가 사라지면 버린다', () => {
    expect(checkRefined(ORIGINAL, '[한줄상회] %이름%님, 8월 24일 오후 2시 가을 신상 행사입니다. https://hanjul.ai/e/1').ok).toBe(false);
    expect(checkRefined(ORIGINAL, '[한줄상회] %이름%님, 8월 24일 오후 2시 행사입니다. 문의 02-1234-5678').ok).toBe(false);
  });

  it('변수 자리를 지우면 버린다 — 고객 이름이 안 들어간다', () => {
    const refined = '[한줄상회] 고객님, 8월 24일 오후 2시부터 가을 신상 행사를 엽니다. 문의 02-1234-5678 https://hanjul.ai/e/1';
    expect(checkRefined(ORIGINAL, refined).ok).toBe(false);
  });

  it('원문에 없던 혜택을 지어내면 버린다', () => {
    const refined = `${ORIGINAL} 전 품목 30% 할인`;
    const r = checkRefined(ORIGINAL, refined);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('benefit-invented');
  });

  it('원문에 있던 혜택은 그대로 써도 된다', () => {
    const withBenefit = `${ORIGINAL} 전 품목 30% 할인`;
    const refined = `[한줄상회] %이름%님, 8월 24일 오후 2시부터 가을 신상품을 소개합니다. 전 품목 30% 할인. 문의 02-1234-5678 https://hanjul.ai/e/1`;
    expect(checkRefined(withBenefit, refined).ok).toBe(true);
  });

  it('빈 응답은 버린다', () => {
    expect(checkRefined(ORIGINAL, '').ok).toBe(false);
    expect(checkRefined(ORIGINAL, '   ').ok).toBe(false);
  });
});

describe('회차별 지시', () => {
  it('2회차는 최소 수정을 지시한다', () => {
    expect(buildRefinePrompt(ORIGINAL, 1).system).toContain('폭넓게');
    expect(buildRefinePrompt(ORIGINAL, 2).system).toContain('낱말 몇 개만');
    expect(buildRefinePrompt(ORIGINAL, 9).system).toContain('낱말 몇 개만'); // 범위 밖은 보수적으로
  });

  it('원문이 프롬프트에 그대로 들어간다', () => {
    expect(buildRefinePrompt(ORIGINAL, 1).user).toContain(ORIGINAL);
  });
});

describe('다듬기 호출', () => {
  it('검사를 통과한 문안만 돌려준다', async () => {
    const good = '[한줄상회] %이름%님, 8월 24일 오후 2시부터 가을 신상품을 소개합니다. 문의 02-1234-5678 https://hanjul.ai/e/1';
    const r = await refineForSpam({
      companyId: COMPANY, original: ORIGINAL, round: 1,
      callModel: async () => ({ text: good, inputTokens: 10, outputTokens: 20 }),
    });
    expect(r.ok).toBe(true);
    expect(r.content).toBe(good);
  });

  it('약속을 깬 문안은 버리고 사유를 남긴다', async () => {
    const r = await refineForSpam({
      companyId: COMPANY, original: ORIGINAL, round: 1,
      callModel: async () => ({ text: '[한줄상회] 고객님 오늘 행사합니다', inputTokens: 10, outputTokens: 5 }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('anchor-lost');
  });

  it('모델이 죽어도 던지지 않고 사유를 돌려준다', async () => {
    const r = await refineForSpam({
      companyId: COMPANY, original: ORIGINAL, round: 1,
      callModel: async () => { throw new Error('timeout'); },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('model-error');
  });

  it('원문이 없으면 부르지 않는다', async () => {
    let called = 0;
    const r = await refineForSpam({
      companyId: COMPANY, original: '   ', round: 1,
      callModel: async () => { called++; return { text: 'x', inputTokens: 0, outputTokens: 0 }; },
    });
    expect(called).toBe(0);
    expect(r.ok).toBe(false);
  });
});
