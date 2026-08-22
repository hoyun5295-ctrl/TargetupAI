/**
 * 도움말 봇 답변 조립 계약 (★ 2026-08-22) — docs/FEATURE-HELP-CATALOG.md §4-5 · §10-1
 *   ① 폐집합 매칭 실패 = 모델 호출 0
 *   ② 출구 검사 — 없는 경로·혜택 토큰·모델명이 있으면 답변을 버린다
 *   ③ 호출 제한 초과 = 잠그지 않고 후보 카드만
 *   ④ 매칭은 사용자 어휘(keywords)로도 잡힌다
 *   ⑤ (2026-08-22(2)) 본문 있는 작업이 분명한 1순위면 모델 없이 정의를 그대로 낸다(direct)
 *   ⑥ (2026-08-22(2)) 프롬프트의 관련 기능은 id가 아니라 화면 이름이다
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  answerHelpQuestion, buildHelpMessages, checkAnswer, isDirectHit, matchJobs, resetHelpQuota, takeHelpQuota,
  HELP_DAILY_LIMIT, HELP_DIRECT_MARGIN, HELP_MINUTE_LIMIT,
} from '../help-answer';
import { FEATURE_CATALOG, toPublicJob, type FeatureJob } from '../../content/feature-catalog';

const ALLOWED = new Set(FEATURE_CATALOG.map((j) => j.entry.path));

/** 1·2순위가 동점이 되는 작은 카탈로그 — "어느 작업인지" 모델이 가려야 하는 상황을 고정한다 */
const tieJob = (id: string, title: string): FeatureJob => ({
  id, title, goal: '동점 시험용', keywords: ['고유질문', '시험 어휘', '동점', '가르기', '모델 호출'],
  steps: ['하나', '둘', '셋'], blockers: [], entry: { path: '/dashboard', via: '시험' },
  planKey: null, creditSource: null, related: [], status: 'ready', stubUntil: null, sourceFile: 'test',
});
const TIE_CATALOG: FeatureJob[] = [tieJob('tie-a', '동점 작업 가'), tieJob('tie-b', '동점 작업 나')];

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

describe('도움말 봇 — 답변 틀 고정(direct)', () => {
  it('본문 있는 작업이 분명한 1순위면 모델을 부르지 않고 정의를 그대로 낸다', async () => {
    let called = 0;
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000011', question: '예약 발송 어떻게 해요',
      callModel: async () => { called++; return { text: 'x', inputTokens: 0, outputTokens: 0 }; },
    });
    expect(called).toBe(0);
    expect(r.answered).toBe(true);
    expect(r.direct).toBe(true);
    expect(r.answer).toBe('');
    expect(r.jobs[0]?.id).toBe('schedule-send');
    expect(r.jobs[0]?.steps.length).toBeGreaterThanOrEqual(3);
  });

  it('1·2순위 점수 차가 여유보다 작으면 direct가 아니다(모델이 가린다)', () => {
    const hits = matchJobs('고유질문 어떻게 해요', null, TIE_CATALOG);
    expect(hits.length).toBe(2);
    expect(hits[0].score).toBe(hits[1].score);
    expect(isDirectHit(hits)).toBe(false);
    // 여유 이상 벌어지면 direct
    expect(isDirectHit([{ job: TIE_CATALOG[0], score: 10 }, { job: TIE_CATALOG[1], score: 10 - HELP_DIRECT_MARGIN }])).toBe(true);
    // 본문 없는 작업은 점수가 높아도 direct가 아니다
    const stub: FeatureJob = { ...TIE_CATALOG[0], id: 'tie-stub', status: 'stub', stubUntil: '2099-12-31', steps: [] };
    expect(isDirectHit([{ job: stub, score: 10 }])).toBe(false);
  });

  it('direct는 한도를 소모하지 않는다', async () => {
    resetHelpQuota();
    const c = '00000000-0000-0000-0000-000000000012';
    for (let i = 0; i < HELP_MINUTE_LIMIT + 2; i++) {
      const r = await answerHelpQuestion({ companyId: c, question: '예약 발송 어떻게 해요' });
      expect(r.direct).toBe(true);
    }
    expect(takeHelpQuota(c)).toBe(true);
  });
});

describe('도움말 봇 — 프롬프트', () => {
  it('관련 기능은 id가 아니라 화면 이름으로 들어간다', () => {
    const job = FEATURE_CATALOG.find((j) => j.related.length > 0)!;
    const { user } = buildHelpMessages('시험', [toPublicJob(job)]);
    for (const id of job.related) {
      const title = FEATURE_CATALOG.find((j) => j.id === id)!.title;
      expect(user).toContain(title);
      expect(user).not.toContain(`"${id}"`);
    }
    expect(user).not.toContain('"id"');
  });
});

describe('도움말 봇 — 답변 조립(모델 경로)', () => {
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

  it('어느 작업인지 가리기 어려우면 모델을 부르고 출구 검사를 통과한 답만 내보낸다', async () => {
    let called = 0;
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000002', question: '고유질문 어떻게 해요 (A)', catalog: TIE_CATALOG,
      callModel: async () => { called++; return { text: '"동점 작업 가"를 누르고 순서대로 진행하세요.', inputTokens: 10, outputTokens: 5 }; },
    });
    expect(called).toBe(1);
    expect(r.answered).toBe(true);
    expect(r.direct).toBe(false);
    expect(r.jobs.length).toBe(2);
    expect((r.jobs[0] as any).sourceFile).toBeUndefined();
  });

  it('모델이 혜택을 지어내면 답변을 버리고 후보 카드만 남긴다', async () => {
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000003', question: '고유질문 어떻게 해요 (B)', catalog: TIE_CATALOG,
      callModel: async () => ({ text: '"동점 작업 가"에서 보내면 10% 할인 쿠폰이 붙습니다.', inputTokens: 10, outputTokens: 5 }),
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
