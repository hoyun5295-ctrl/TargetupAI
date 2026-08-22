/**
 * 도움말 봇 답변 조립 계약 (★ 2026-08-22) — docs/FEATURE-HELP-CATALOG.md §4-5
 *   ① 폐집합 매칭 실패 = 모델 호출 0
 *   ② 출구 검사 — 없는 경로·혜택 토큰·모델명이 있으면 답변을 버린다
 *   ③ 호출 제한 초과 = 잠그지 않고 후보 카드만
 *   ④ 매칭은 사용자 어휘(keywords)로도 잡힌다
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { answerHelpQuestion, checkAnswer, matchJobs, resetHelpQuota, takeHelpQuota, HELP_DAILY_LIMIT, HELP_MINUTE_LIMIT } from '../help-answer';
import { FEATURE_CATALOG } from '../../content/feature-catalog';

const ALLOWED = new Set(FEATURE_CATALOG.map((j) => j.entry.path));

describe('도움말 봇 — 매칭', () => {
  it('사용자 어휘로 작업을 찾는다(우리 용어가 아니어도)', () => {
    expect(matchJobs('문자 어떻게 보내요?')[0]?.job.id).toBe('send-direct');
    expect(matchJobs('엑셀 올리는 법')[0]?.job.id).toBe('upload-customers');
    expect(matchJobs('수신거부는 어디서 해')[0]?.job.id).toBe('manage-unsubscribes');
    expect(matchJobs('내일 아침에 나가게 해줘')[0]?.job.id).toBe('schedule-send');
  });

  it('관계없는 질문은 임계 미만이다', () => {
    const hits = matchJobs('오늘 점심 뭐 먹지');
    expect(hits.every((h) => h.score < 3)).toBe(true);
  });
});

describe('도움말 봇 — 출구 검사', () => {
  it('카탈로그 밖 경로가 있으면 버린다', () => {
    expect(checkAnswer('"설정"에서 /settings 를 여세요.', ALLOWED).ok).toBe(true);
    expect(checkAnswer('/customers 화면으로 가세요.', ALLOWED).ok).toBe(false);
  });
  it('혜택 수치·모델명·줄표가 있으면 버린다', () => {
    expect(checkAnswer('지금 가입하면 20% 할인 쿠폰을 드립니다.', ALLOWED).ok).toBe(false);
    expect(checkAnswer('이 답은 Claude가 만들었습니다.', ALLOWED).ok).toBe(false);
    expect(checkAnswer('직접발송 — 문자 보내기', ALLOWED).ok).toBe(false);
    expect(checkAnswer('', ALLOWED).ok).toBe(false);
  });
});

describe('도움말 봇 — 답변 조립', () => {
  beforeEach(() => resetHelpQuota());

  it('매칭이 없으면 모델을 부르지 않는다', async () => {
    let called = 0;
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000001', question: '오늘 점심 뭐 먹지',
      callModel: async () => { called++; return { text: 'x', inputTokens: 0, outputTokens: 0 }; },
    });
    expect(called).toBe(0);
    expect(r.answered).toBe(false);
    expect(r.usedModel).toBe(false);
  });

  it('매칭되면 모델을 부르고 출구 검사를 통과한 답만 내보낸다', async () => {
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000002', question: '문자 보내는 법 알려줘 (고유질문 A)',
      callModel: async () => ({ text: '상단 메뉴 "직접발송"을 누르고 수신번호를 넣은 뒤 보내세요.', inputTokens: 10, outputTokens: 5 }),
    });
    expect(r.answered).toBe(true);
    expect(r.jobs[0]?.id).toBe('send-direct');
    expect((r.jobs[0] as any).sourceFile).toBeUndefined();
  });

  it('모델이 혜택을 지어내면 답변을 버리고 후보 카드만 남긴다', async () => {
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000003', question: '문자 보내는 법 알려줘 (고유질문 B)',
      callModel: async () => ({ text: '"직접발송"에서 보내면 10% 할인 쿠폰이 붙습니다.', inputTokens: 10, outputTokens: 5 }),
    });
    expect(r.answered).toBe(false);
    expect(r.reason?.startsWith('exit:')).toBe(true);
    expect(r.jobs.length).toBeGreaterThan(0);
  });

  it('회사별 분당·일일 한도를 넘으면 모델을 부르지 않고 후보만 준다', () => {
    const c = '00000000-0000-0000-0000-000000000004';
    const now = new Date('2026-08-22T10:00:00Z');
    for (let i = 0; i < HELP_MINUTE_LIMIT; i++) expect(takeHelpQuota(c, now)).toBe(true);
    expect(takeHelpQuota(c, now)).toBe(false);
    // 다음 분에는 다시 열리되 일일 한도는 누적된다
    resetHelpQuota();
    for (let i = 0; i < HELP_DAILY_LIMIT; i++) expect(takeHelpQuota(c, new Date(now.getTime() + i * 60000))).toBe(true);
    expect(takeHelpQuota(c, new Date(now.getTime() + HELP_DAILY_LIMIT * 60000))).toBe(false);
  });
});
