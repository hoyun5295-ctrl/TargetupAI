/**
 * 도움말 봇 답변 조립 계약 (★ 2026-08-22 · ★ 2026-08-24 모델 경로 확장) — docs/FEATURE-HELP-CATALOG.md §4-5 · §10-1 · §10-6
 *   ① (★0824 개정) 매칭 실패도 모델 경로로 간다 — 재료는 여전히 카탈로그 전체뿐(폐집합)
 *   ② 응답 계약 = JSON {jobs, answer}. id가 카탈로그에 실존해야만 카드다. jobs가 비면 "모른다"
 *   ③ 출구 검사 — 없는 경로·혜택 토큰·모델명이 있으면 답변을 버린다
 *   ④ 호출 제한 초과 = 잠그지 않고 후보 카드만
 *   ⑤ 매칭은 사용자 어휘(keywords)로도 잡힌다
 *   ⑥ (2026-08-22(2)) 본문 있는 작업이 분명한 1순위면 모델 없이 정의를 그대로 낸다(direct)
 *   ⑦ (2026-08-22(2)) 프롬프트의 관련 기능은 id가 아니라 화면 이름이다
 *   ⑧ (★0824) 후속 문답이 messages로 이어진다. 후속 중에는 direct를 건너뛴다(문맥 없는 새 매칭이 엉뚱한 카드를 낸다)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  answerHelpQuestion, buildCatalogSystem, buildHelpMessages, checkAnswer, isDirectHit, matchJobs, parseModelAnswer,
  resetHelpQuota, takeHelpQuota, helpReasonLabel, classifyHelpDbError,
  helpQuestionKind, HELP_DAILY_LIMIT, HELP_DIRECT_MARGIN, HELP_MAX_HISTORY, HELP_MINUTE_LIMIT, HELP_REQUEST_PHRASES,
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
  it('related는 id가 아니라 화면 이름으로 들어간다(모델이 id를 한국어로 옮기며 이름을 짓는다)', () => {
    const system = buildCatalogSystem(FEATURE_CATALOG);
    const job = FEATURE_CATALOG.find((j) => j.related.length > 0)!;
    for (const id of job.related) {
      const title = FEATURE_CATALOG.find((j) => j.id === id)!.title;
      expect(system).toContain(title);
    }
    // related 배열 안에는 어떤 영문 id도 없다(자기 id는 카드 지목용으로 별도 필드에 있다)
    const defs = JSON.parse(system.slice(system.indexOf('[기능 정의] ') + '[기능 정의] '.length));
    for (const d of defs) for (const r of d.related) expect(/^[a-z0-9-]+$/.test(r)).toBe(false);
  });

  it('카탈로그 전체가 system에 들어가고 회사별 값·내부 필드는 없다', () => {
    const system = buildCatalogSystem(FEATURE_CATALOG);
    for (const j of FEATURE_CATALOG) expect(system).toContain(`"${j.id}"`);
    expect(system).not.toContain('sourceFile');
    expect(system).not.toContain('locked');
    expect(system).not.toContain('planKey');
    // 경로도 넣지 않는다 — 이동은 jobs id로만 한다(답에 경로가 나오면 출구 검사가 버린다)
    expect(system).not.toContain('"path"');
  });

  /**
   * ★ 2026-08-24(2) 스탠스 계약(Harold "너무 원론적이다"). 프롬프트가 "정의 요약"으로 돌아가면
   * 모델의 최선이 카드에 이미 있는 순서를 산문으로 다시 읽는 것이 된다 — 그 회귀를 문장으로 잠근다.
   */
  it('answer는 카드와 역할을 나눈다(순서 낭독 금지 · 막힘 호소에는 되묻기)', () => {
    const system = buildCatalogSystem(FEATURE_CATALOG);
    expect(system).toContain('안내 상담원');
    expect(system).toContain('순서를 처음부터 끝까지 나열하지 않습니다');
    expect(system).toContain('어디서 막혔는지 구체적인 선택지');
    expect(system).toContain('되물을 때도 이야기한 기능의 id를 jobs에 담습니다');
  });

  it('후속 문답이 messages로 이어지고 상한을 지킨다', () => {
    const history = Array.from({ length: HELP_MAX_HISTORY + 2 }, (_, i) => ({ q: `질문${i}`, a: `답${i}` }));
    const messages = buildHelpMessages('그게 안 되는데요', '/dashboard', history);
    expect(messages.length).toBe(HELP_MAX_HISTORY * 2 + 1);
    expect(messages[0].content).toBe(`질문${2}`);
    expect(messages[messages.length - 1].role).toBe('user');
    expect(messages[messages.length - 1].content).toContain('그게 안 되는데요');
    // 빈 문답은 버린다
    expect(buildHelpMessages('질문', null, [{ q: '', a: '답' }]).length).toBe(1);
  });
});

describe('도움말 봇 — 답변 조립(모델 경로)', () => {
  beforeEach(() => resetHelpQuota());

  const ok = (jobs: string[], answer: string) => JSON.stringify({ jobs, answer });

  it('매칭이 없어도 모델이 전체 원장에서 찾는다(2026-08-24 개정, 전에는 여기서 포기했다)', async () => {
    let called = 0;
    let seenSystem = '';
    // 매칭 0점을 고정하려고 우리 어휘가 하나도 없는 문장을 쓴다(주입 모델이라 내용은 무관)
    const noMatch = '이상하게 계속 그래요';
    expect(matchJobs(noMatch).filter((h) => h.score >= 3).length).toBe(0);
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000001', question: noMatch,
      callModel: async (system) => {
        called++; seenSystem = system;
        return { text: ok(['check-results'], '"발송 결과 보기"에서 실패 사유를 확인해 보세요.'), inputTokens: 10, outputTokens: 5 };
      },
    });
    expect(called).toBe(1);
    expect(r.answered).toBe(true);
    expect(r.usedModel).toBe(true);
    expect(r.jobs[0]?.id).toBe('check-results');
    // 재료는 카탈로그 전체다. 매칭이 못 찾은 질문도 원장 40개를 다 본다
    for (const j of FEATURE_CATALOG) expect(seenSystem).toContain(`"${j.id}"`);
  });

  it('모델이 모른다고 하면(jobs 빈 배열) 지어내지 않고 문의 남기기로 보낸다', async () => {
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000021', question: '오늘 점심 뭐 먹지',
      callModel: async () => ({ text: ok([], ''), inputTokens: 10, outputTokens: 2 }),
    });
    expect(r.answered).toBe(false);
    expect(r.reason?.startsWith('contract:')).toBe(true);
  });

  it('모델이 지어낸 id는 버린다. 실존 id가 하나도 없으면 답 전체를 버린다', async () => {
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000022', question: '고유질문 어떻게 해요', catalog: TIE_CATALOG,
      callModel: async () => ({ text: ok(['made-up-job'], '이렇게 하세요.'), inputTokens: 10, outputTokens: 5 }),
    });
    expect(r.answered).toBe(false);
    expect(r.reason).toBe('contract:no-grounded-job');
  });

  it('JSON이 아니면 답을 버린다(잘림·산문 응답)', async () => {
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000023', question: '고유질문 어떻게 해요', catalog: TIE_CATALOG,
      callModel: async () => ({ text: '"동점 작업 가"를 누르세요.', inputTokens: 10, outputTokens: 5 }),
    });
    expect(r.answered).toBe(false);
    expect(r.reason?.startsWith('contract:')).toBe(true);
  });

  it('어느 작업인지 가리기 어려우면 모델을 부르고 지목한 카드가 답과 함께 나간다', async () => {
    let called = 0;
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000002', question: '고유질문 어떻게 해요 (A)', catalog: TIE_CATALOG,
      callModel: async () => { called++; return { text: ok(['tie-a'], '"동점 작업 가"를 누르고 순서대로 진행하세요.'), inputTokens: 10, outputTokens: 5 }; },
    });
    expect(called).toBe(1);
    expect(r.answered).toBe(true);
    expect(r.direct).toBe(false);
    expect(r.jobs.length).toBe(1);
    expect(r.jobs[0].id).toBe('tie-a');
    expect((r.jobs[0] as any).sourceFile).toBeUndefined();
  });

  it('모델이 혜택을 지어내면 답변을 버리고 후보 카드만 남긴다', async () => {
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000003', question: '고유질문 어떻게 해요 (B)', catalog: TIE_CATALOG,
      callModel: async () => ({ text: ok(['tie-a'], '"동점 작업 가"에서 보내면 10% 할인 쿠폰이 붙습니다.'), inputTokens: 10, outputTokens: 5 }),
    });
    expect(r.answered).toBe(false);
    expect(r.reason?.startsWith('exit:')).toBe(true);
    expect(r.jobs.length).toBeGreaterThan(0);
  });

  it('후속 문답이 모델 messages로 이어지고, 후속 중에는 direct를 건너뛴다', async () => {
    let seen: { role: string; content: string }[] = [];
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000024',
      question: '그게 안 되는데요',
      history: [{ q: '예약 발송 어떻게 해요', a: '"예약을 걸고 보내기" 안내를 보여드렸습니다.' }],
      callModel: async (_system, messages) => {
        seen = messages;
        return { text: ok(['schedule-send'], '"예약을 걸고 보내기"에서 보낼 시각이 허용 시간 안인지 확인해 보세요.'), inputTokens: 10, outputTokens: 5 };
      },
    });
    expect(r.answered).toBe(true);
    expect(r.direct).toBe(false); // "예약 발송"이 직답 조건이어도 후속 중에는 모델이 문맥으로 답한다
    expect(seen.length).toBe(3);
    expect(seen[0]).toEqual({ role: 'user', content: '예약 발송 어떻게 해요' });
    expect(seen[1].role).toBe('assistant');
  });

  it('parseModelAnswer는 id 3개 상한을 지키고 순서를 보존한다', () => {
    const ids = FEATURE_CATALOG.slice(0, 4).map((j) => j.id);
    const p = parseModelAnswer(JSON.stringify({ jobs: ids, answer: '안내.' }), FEATURE_CATALOG);
    expect(p.ok).toBe(true);
    expect(p.jobs.map((j) => j.id)).toEqual(ids.slice(0, 3));
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

/**
 * ★ 2026-08-25 재시도·사유 (Harold 접수 "못 답함이 자꾸 생기면 어떻게 하냐").
 * 0824 운영 실측 — 20:19 못 답함 건은 모델이 답을 만들었는데(성공 기록·출력 210토큰) 계약·출구 검사가
 * 조용히 버린 것이었고, 사유가 어디에도 안 남아 원인을 특정할 수 없었다.
 *   ① 계약·출구 위반은 위반 사유를 모델에 되먹여 같은 호출 안에서 1회 재시도한다
 *   ② 모델이 스스로 모른다고 한 것(jobs·answer 모두 빈 값)은 위반이 아니다 — 재시도하지 않는다
 *   ③ 사유는 코드로만 남는다 — 외부 오류 원문(모델명 포함 가능)을 응답·DB에 싣지 않는다
 *   ④ 사유 코드 → 화면 한글 라벨 변환은 서버 CT 하나가 소유한다(질문 이력 탭이 그대로 그린다)
 */
describe('도움말 봇 — 재시도·사유(2026-08-25)', () => {
  beforeEach(() => resetHelpQuota());

  const ok = (jobs: string[], answer: string) => JSON.stringify({ jobs, answer });

  it('계약 위반(산문 응답)이면 위반 사유를 되먹여 1회 재시도한다', async () => {
    const calls: { role: string; content: string }[][] = [];
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000031', question: '고유질문 어떻게 해요 (재시도1)', catalog: TIE_CATALOG,
      callModel: async (_system, messages) => {
        calls.push(messages);
        if (calls.length === 1) return { text: '"동점 작업 가"를 누르세요.', inputTokens: 10, outputTokens: 5 };
        return { text: ok(['tie-a'], '"동점 작업 가"를 누르고 순서대로 진행하세요.'), inputTokens: 10, outputTokens: 5 };
      },
    });
    expect(calls.length).toBe(2);
    expect(r.answered).toBe(true);
    expect(r.jobs[0]?.id).toBe('tie-a');
    // 2회차 대화 = 원 질문 + 1회차 응답(assistant) + 위반 사유 되먹임(user)
    const second = calls[1];
    expect(second.length).toBe(3);
    expect(second[1]).toEqual({ role: 'assistant', content: '"동점 작업 가"를 누르세요.' });
    expect(second[2].role).toBe('user');
    expect(second[2].content).toContain('JSON');
  });

  it('출구 위반(혜택 표현)도 재시도 대상이고, 되먹임이 위반 종류를 짚는다', async () => {
    const calls: { role: string; content: string }[][] = [];
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000032', question: '고유질문 어떻게 해요 (재시도2)', catalog: TIE_CATALOG,
      callModel: async (_system, messages) => {
        calls.push(messages);
        if (calls.length === 1) return { text: ok(['tie-a'], '"동점 작업 가"에서 보내면 10% 할인이 붙습니다.'), inputTokens: 10, outputTokens: 5 };
        return { text: ok(['tie-a'], '"동점 작업 가"에서 순서대로 진행하세요.'), inputTokens: 10, outputTokens: 5 };
      },
    });
    expect(calls.length).toBe(2);
    expect(r.answered).toBe(true);
    expect(calls[1][2].content).toContain('혜택');
  });

  it('두 번 다 위반이면 못 답함으로 끝나고 마지막 사유가 남는다', async () => {
    let called = 0;
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000033', question: '고유질문 어떻게 해요 (재시도3)', catalog: TIE_CATALOG,
      callModel: async () => { called++; return { text: ok(['tie-a'], '지금 가입하면 20% 할인 쿠폰을 드립니다.'), inputTokens: 10, outputTokens: 5 }; },
    });
    expect(called).toBe(2);
    expect(r.answered).toBe(false);
    expect(r.reason?.startsWith('exit:benefit')).toBe(true);
    expect(r.jobs.length).toBeGreaterThan(0); // 후보 카드 폴백은 유지
  });

  it('모델이 스스로 모른다고 하면(jobs·answer 모두 빈 값) 재시도하지 않는다', async () => {
    let called = 0;
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000034', question: '고유질문 어떻게 해요 (재시도4)', catalog: TIE_CATALOG,
      callModel: async () => { called++; return { text: ok([], ''), inputTokens: 10, outputTokens: 2 }; },
    });
    expect(called).toBe(1);
    expect(r.answered).toBe(false);
    expect(r.reason).toBe('contract:no-answer');
  });

  it('모델 호출 실패는 원문 없이 model-error 코드로만 남는다(응답·DB에 외부 메시지 금지)', async () => {
    const r = await answerHelpQuestion({
      companyId: '00000000-0000-0000-0000-000000000035', question: '고유질문 어떻게 해요 (재시도5)', catalog: TIE_CATALOG,
      callModel: async () => { throw new Error('upstream detail with internal names'); },
    });
    expect(r.answered).toBe(false);
    expect(r.reason).toBe('model-error');
  });

  /**
   * ★ Codex 적대 1R high 회귀 고정 — PG의 42703 INSERT 오류 메시지는
   * column "reason" of relation "help_questions" does not exist 형태라 'relation' 문자열 판정에도 걸린다.
   * 문자열 순서로 가르면 컬럼 부재가 테이블 부재로 오인돼 레거시 INSERT 폴백에 영영 못 간다.
   * 판정은 SQLSTATE 우선(42703=column · 42P01=relation) 분류기 하나가 소유한다.
   */
  it('DB 오류 분류: 42703의 "of relation" 메시지를 테이블 부재로 오인하지 않는다', () => {
    // 실제 PG 메시지 형태 그대로 주입 — INSERT의 컬럼 부재(코드+겹치는 메시지)
    expect(classifyHelpDbError({ code: '42703', message: 'column "reason" of relation "help_questions" does not exist' })).toBe('missing-column');
    // 테이블 부재
    expect(classifyHelpDbError({ code: '42P01', message: 'relation "help_questions" does not exist' })).toBe('missing-relation');
    // 코드가 벗겨진 래핑 오류 — 메시지 폴백에서도 column을 먼저 본다
    expect(classifyHelpDbError({ message: 'column "reason" of relation "help_questions" does not exist' })).toBe('missing-column');
    expect(classifyHelpDbError({ message: 'column h.reason does not exist' })).toBe('missing-column');
    expect(classifyHelpDbError({ message: 'relation "help_questions" does not exist' })).toBe('missing-relation');
    // 무관한 오류
    expect(classifyHelpDbError({ code: '23502', message: 'null value in column "question"' })).toBe('other');
    expect(classifyHelpDbError(new Error('connection refused'))).toBe('other');
    expect(classifyHelpDbError(null)).toBe('other');
  });

  it('사유 코드 → 화면 라벨 변환을 서버가 소유한다', () => {
    expect(helpReasonLabel('quota')).toBe('질문 한도 초과');
    expect(helpReasonLabel('model-error')).toBe('AI 호출 실패');
    expect(helpReasonLabel('contract:json')).toBe('응답 형식 위반');
    expect(helpReasonLabel('contract:no-answer')).toBe('원장에 답 없음');
    expect(helpReasonLabel('contract:no-grounded-job')).toBe('기능 지목 실패');
    expect(helpReasonLabel('exit:benefit:할인')).toBe('혜택 표현 차단');
    expect(helpReasonLabel('exit:path:/customers')).toBe('경로 표기 차단');
    expect(helpReasonLabel(null)).toBeNull();
    expect(helpReasonLabel('')).toBeNull();
  });
});

/**
 * ★ 2026-08-24 기능 요청 구분. "이용 요청 남기기" 버튼의 고정 문구는 질문이 아니라 요청이다 —
 * 질문 이력의 "못 답함"에서 빼야 미답 비율이 봇의 실제 실패만 센다. 판정은 서버 레지스트리 하나가 소유한다.
 */
describe('도움말 봇 — 기능 요청 구분', () => {
  it('판정은 고정 문구 정확 일치다(앞뒤 공백만 눈감는다)', () => {
    expect(helpQuestionKind('대행발송 이용을 요청합니다.')).toBe('request');
    expect(helpQuestionKind(' 대행발송 이용을 요청합니다. ')).toBe('request');
    expect(helpQuestionKind('대행발송 이용을 요청합니다')).toBe('question'); // 사람이 비슷하게 친 문장은 질문이다
    expect(helpQuestionKind('대행발송 어떻게 해요')).toBe('question');
    expect(helpQuestionKind('')).toBe('question');
  });

  it('요청 버튼의 프론트 고정 문구가 레지스트리와 한 글자도 다르지 않다(소스 계약)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../frontend/src/components/agency/AgencySendIntroModal.tsx'), 'utf8',
    );
    const m = src.match(/question:\s*'([^']+)'/);
    expect(m, '요청 버튼이 고정 문구를 보내는 자리가 사라졌다 — 레지스트리와 함께 정리하라').not.toBeNull();
    expect(HELP_REQUEST_PHRASES).toContain(m![1]);
  });
});
