/**
 * C129 여정 남은 결함 아홉 건(★ 2026-11-11 · 설계서 docs/2026-11-11-journey-remaining-nine-design.md §6 T1 · T2 · T3) — 소스 계약(구문 트리) · AI 수정 결과
 *   D1 멈춤은 진행 중인 실행에만 · D2 여정 멈춤이 먼저 · 실행 멈춤은 계보 잠금 안에서 여정이 멈춘 상태일 때만 · 소진 기준 = 칸별 시도 기록 수
 *   D3 차감 실패는 시도로 세지 않는다 · D4 월 예산 달 = KST · D5 여정 알림톡 줄도 행 단위 정책 · D7 AI 수정은 알림톡 칸을 만들지도 바꾸지도 못한다
 *   D9 감시의 첫 칸 = 넣는 트랜잭션 안에서. 실제 표 동작은 journey-remaining-1111.pg.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ts from 'typescript';

const aiMock = vi.fn(async (_p: any): Promise<string> => '{}');
vi.mock('../ai-credit', async (orig) => ({
  ...(await orig<any>()),
  checkCredit: async () => undefined,
  runChargedAi: async (o: any) => { const result = await o.run(); return { result, charged: o.accept ? !!o.accept(result) : true }; },
  settleCreditAfterSuccess: async () => 'not_applicable',
}));
vi.mock('../../services/ai', () => ({ callAIWithFallback: (p: any) => aiMock(p), getKoreanCalendar: () => ({}), getSeasonContext: () => ({ month: 11, season: '가을', keywords: [] }) }));
vi.mock('../../config/database', () => {
  const query = vi.fn(async (text: string) => (/FROM companies/.test(String(text)) ? { rows: [{}] } : { rows: [] }));
  return { query, pool: { connect: vi.fn() }, lockPool: { connect: vi.fn() }, default: { connect: vi.fn(), query } };
});
vi.mock('../copy-prompt-composer', () => ({ composeCopyBrain: async () => ({ promptSuffix: '', examples: [] }) }));
vi.mock('../brand-voice-prompt', () => ({ VOICE_KIND_BY_STEP: 'by_step', voiceLearned: async () => false, getBrandVoiceSnapshot: async () => null, getBrandGuideline: async () => null, voiceLearnedOf: () => false, resolveGuidelineFor: () => null, composeVoicePrompt: async (i: { basePrompt: string }) => ({ system: i.basePrompt, guideline: null, shape: null, voiceLearned: false, exampleCount: 0 }) }));
vi.mock('../best-copy-assets', () => ({ getStructureSkeleton: async () => null }));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: async () => '' }));
vi.mock('../company-data-profile', () => ({ getCompanyDataProfile: async () => null, formatProfileForAiPrompt: () => '' }));

import { be, sourceFiles, BE, declarationsNamed } from './helpers/producer-scan';
import { editJourneyPackage } from '../journey-ai-editor';
import { alimtalkFallbackChargeType } from '../alimtalk-fallback';
import { resolveKakaoCharge, resolveFallbackCharge } from '../prepaid';
import { buildJourneyTargetQuery } from '../journey-target-extractor';
import { isDateEdgeTrigger } from '../journey-trigger-watcher';

beforeEach(() => { aiMock.mockReset(); });

const SRC_FILES = sourceFiles(BE, /\.ts$/);
const sfOf = (rel: string) => ts.createSourceFile(rel, be(rel), ts.ScriptTarget.Latest, true);
const literalsUnder = (root: ts.Node, sf: ts.SourceFile): string[] => {
  const out: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { out.push(n.text); return; }
    if (ts.isTemplateExpression(n)) { out.push(n.getText(sf)); n.templateSpans.forEach((s) => walk(s.expression)); return; }
    ts.forEachChild(n, walk);
  };
  walk(root);
  return out;
};
const fnNode = (sf: ts.SourceFile, name: string): ts.FunctionDeclaration => {
  const hits = declarationsNamed(sf, name).filter(ts.isFunctionDeclaration);
  expect(hits.length, name).toBe(1);
  return hits[0];
};
const callsNamed = (root: ts.Node, name: string): ts.CallExpression[] => {
  const out: ts.CallExpression[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(root);
  return out;
};
const enclosingFn = (n: ts.Node): ts.FunctionDeclaration | null => {
  for (let p = n.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p)) return p;
  return null;
};
const ancestors = (n: ts.Node): ts.Node[] => { const out: ts.Node[] = []; for (let p: ts.Node | undefined = n; p; p = p.parent) out.push(p); return out; };

// ════════════════════════════════════════════════════════════════════
// T1 — 멈춤 쓰기(R93) · 자동 멈춤 순서(R45 · R12)
// ════════════════════════════════════════════════════════════════════
describe('T1 R93 — 실행을 멈춤으로 바꾸는 문장은 진행 중인 실행에만 건다', () => {
  it('UPDATE journey_executions … SET status = paused 전수(구문 트리) = WHERE 에 status = active', () => {
    const found: string[] = [];
    for (const f of SRC_FILES) {
      const sf = sfOf(f);
      for (const sql of literalsUnder(sf, sf)) {
        const m = /UPDATE\s+journey_executions\b[\s\S]*?\bSET\b([\s\S]*)/i.exec(sql);
        if (!m) continue;
        const [setClause, ...rest] = m[1].split(/\bWHERE\b/i);
        if (!/(?<![.\w])status\s*=\s*'paused'/.test(setClause)) continue;
        found.push(f);
        expect(rest.join(' WHERE '), `${f} 멈춤 쓰기의 조건`).toMatch(/status\s*=\s*'active'/);
      }
    }
    expect(found.sort()).toEqual(['utils/journey-pause-handler.ts']);   // 자동 멈춤 한 문장(그날 정지는 실행 상태를 바꾸지 않는다)
  });

  it('autoPauseExecution = 계보 잠금 → 여정 상태 읽기 → (멈춘 여정일 때만) 갱신 · 기록 = 갱신 뒤', () => {
    const sf = sfOf('utils/journey-pause-handler.ts');
    const fn = fnNode(sf, 'autoPauseExecution');
    const text = fn.getText(sf);
    const lock = text.indexOf('lockLineage(');
    const readJourney = text.search(/SELECT status FROM journeys/);
    const guard = text.search(/!==\s*'paused'/);
    const update = text.search(/UPDATE journey_executions SET status = 'paused'/);
    const log = text.indexOf('INSERT INTO journey_step_pause_logs');
    expect([lock, readJourney, guard, update, log].every((x) => x >= 0)).toBe(true);
    expect([lock, readJourney, guard, update, log]).toEqual([lock, readJourney, guard, update, log].slice().sort((a, b) => a - b));
    expect(text).toMatch(/Promise<'paused' \| 'skipped'>/);
    // 여정 행은 잠그지 않는다(완료 처리의 「실행 → 여정」 순서와 엇갈리는 행 잠금 0)
    expect(text).not.toMatch(/FROM journeys[^`]*FOR UPDATE/);
  });
});

describe('T1 R45 — 자동 멈춤 = 여정 멈춤이 먼저 · 전진은 그 사이', () => {
  const sf = sfOf('utils/journey-executor.ts');
  const autoCalls = callsNamed(sf, 'autoPauseExecution');
  it('autoPauseExecution 을 부르는 자리 = 실행기 여섯(다른 파일 0)', () => {
    const elsewhere = SRC_FILES.filter((f) => f !== 'utils/journey-executor.ts' && f !== 'utils/journey-pause-handler.ts' && callsNamed(sfOf(f), 'autoPauseExecution').length > 0);
    expect(elsewhere).toEqual([]);
    const byFn: Record<string, number> = {};
    for (const c of autoCalls) { const n = enclosingFn(c)?.name?.text || '(top)'; byFn[n] = (byFn[n] || 0) + 1; }
    expect(byFn).toEqual({ applyBoundaryPause: 1, sendUnits: 2, retryOrPauseAfterLoadFailure: 1, holdUnknownLoad: 1, handleConditionEvalError: 1 });
  });
  it('자리마다 같은 함수 안에서 pauseJourney 가 더 앞 · 그 사이에 다른 실행 멈춤 0 · 전진이 있는 자리 = 여정 멈춤과 실행 멈춤 사이', () => {
    let withAdvance = 0;
    for (const a of autoCalls) {
      const fn = enclosingFn(a)!;
      const pauses = callsNamed(fn, 'pauseJourney').filter((p) => p.getStart(sf) < a.getStart(sf));
      expect(pauses.length, `${fn.name?.text} 의 실행 멈춤 앞에 여정 멈춤`).toBeGreaterThan(0);
      const p = pauses[pauses.length - 1];
      const between = autoCalls.filter((x) => x !== a && x.getStart(sf) > p.getStart(sf) && x.getStart(sf) < a.getStart(sf));
      expect(between).toEqual([]);
      // 두 호출을 함께 품는 가장 안쪽 블록
      const pa = new Set(ancestors(p));
      const block = ancestors(a).find((x) => pa.has(x) && ts.isBlock(x))!;
      const adv = callsNamed(block, 'advanceExecutions');
      if (adv.length > 0) {
        withAdvance++;
        for (const v of adv) {
          expect(v.getStart(sf), `${fn.name?.text} 전진은 여정 멈춤 뒤`).toBeGreaterThan(p.getStart(sf));
          expect(v.getStart(sf), `${fn.name?.text} 전진은 실행 멈춤 앞`).toBeLessThan(a.getStart(sf));
        }
        // 여정 멈춤이 try 에 싸여 있고 전진이 그 try 밖이면, 그 catch 는 반드시 그 자리를 끝낸다(return · throw) — 던졌는데 전진으로 흘러가지 않는다
        const tryOfP = ancestors(p).find((x) => ts.isTryStatement(x) && x !== block && ancestors(x).includes(block)) as ts.TryStatement | undefined;
        if (tryOfP && adv.some((v) => !ancestors(v).includes(tryOfP.tryBlock))) {
          let ends = false;
          const walk = (n: ts.Node): void => { if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) ends = true; ts.forEachChild(n, walk); };
          if (tryOfP.catchClause) walk(tryOfP.catchClause.block);
          expect(ends, `${fn.name?.text} 여정 멈춤 실패 = 그 자리를 끝낸다`).toBe(true);
        }
      }
    }
    expect(withAdvance).toBe(2);   // 적재 시도 상한 · 안 들어감 재시도 소진
  });
  it('안 들어감 재시도 소진의 판정 = 그 칸의 시도 기록 수(조각) · error_count 로 판정하지 않는다', () => {
    const fn = fnNode(sf, 'retryOrPauseAfterLoadFailure');
    const text = fn.getText(sf);
    expect(callsNamed(fn, 'loadAttemptsSql').length).toBeGreaterThanOrEqual(2);   // 읽기 + 재시도 문장 조건
    expect(text).toMatch(/\|\| 0\) >= LOAD_ATTEMPT_MAX;/);        // 소진 = 그 칸 시도 수가 상한 이상
    expect(text).toMatch(/loadAttemptsSql\('e', '\$3'\)\} < \$\{LOAD_ATTEMPT_MAX\}/);   // 재시도 문장 조건 = 같은 기준
    expect(text).not.toMatch(/error_count,\s*0\)\s*[<>]/);        // SQL 조건
    expect(text).not.toMatch(/ecById|\.ec\b/);                     // 옛 판정 변수
    expect(text).toMatch(/error_count = COALESCE\(error_count, 0\) \+ 1/);   // 진단 칸은 계속 쌓는다
  });
});

// ════════════════════════════════════════════════════════════════════
// T2 — 차감 실패 시도(R8) · 월 예산 달(R18) · 대체 규칙 옵션(R1) · 감시 첫 칸(R12)
// ════════════════════════════════════════════════════════════════════
describe('T2 계약', () => {
  const sf = sfOf('utils/journey-executor.ts');
  it('차감 실패 갈래 = 표식 삭제와 시도 기록 삭제가 한 문장(CLEAR_UNPAID_CLAIMS_SQL) · 그 문장 = 조각 dropLastLoadAttemptSql', () => {
    let hit = 0;
    const walk = (n: ts.Node): void => {
      if (ts.isIfStatement(n) && n.expression.getText(sf).replace(/\s+/g, '') === '!deduct.ok') {
        hit++;
        const body = n.thenStatement.getText(sf);
        expect(body).toContain('CLEAR_UNPAID_CLAIMS_SQL');
        expect(body).not.toMatch(/DELETE FROM journey_step_logs/);   // 옛 따로 된 삭제 문장
      }
      ts.forEachChild(n, walk);
    };
    walk(fnNode(sf, 'sendUnits'));
    expect(hit).toBe(1);
    const decl = declarationsNamed(sf, 'CLEAR_UNPAID_CLAIMS_SQL').filter(ts.isVariableDeclaration);
    expect(decl).toHaveLength(1);
    expect(decl[0].getText(sf)).toMatch(/DELETE FROM journey_step_logs[\s\S]*RETURNING execution_id[\s\S]*dropLastLoadAttemptSql\(/);
  });
  it('여정 유틸에 KST 변환 없는 달 시작(date_trunc month NOW) 0 · 월 예산 문장 = KST 조각', () => {
    const journeyFiles = SRC_FILES.filter((f) => /^utils\/journey-/.test(f));
    expect(journeyFiles.length).toBeGreaterThan(20);
    for (const f of journeyFiles) {
      const s = sfOf(f);
      for (const sql of literalsUnder(s, s)) expect(sql, f).not.toMatch(/date_trunc\('month',\s*NOW\(\)\s*\)/i);
    }
    const decl = declarationsNamed(sf, 'JOURNEY_MONTH_COST_SQL').filter(ts.isVariableDeclaration);
    expect(decl).toHaveLength(1);
    expect(decl[0].getText(sf)).toContain('${KST_MONTH_START_SQL}');
  });
  it('resolveAlimtalkFallback 호출 전수 분류 — 행 단위(disableFallback) = 직접발송 동기 · 워커 · 여정 실행기 / 그 밖 = 설정 검증 · 도달 불가 · 고정 유형', () => {
    const rowLevel: string[] = [];
    const plain: string[] = [];
    for (const f of SRC_FILES) {
      if (f === 'utils/alimtalk-fallback.ts') continue;
      const s = sfOf(f);
      for (const c of callsNamed(s, 'resolveAlimtalkFallback')) {
        const second = c.arguments[1]?.getText(s) || '';
        (/emptyContentsPolicy:\s*'disableFallback'/.test(second) ? rowLevel : plain).push(f);
      }
    }
    expect(rowLevel.sort()).toEqual(['routes/campaigns.ts', 'utils/direct-send-processor.ts', 'utils/journey-executor.ts']);
    // 설정 검증(직접발송 워커 · 행을 만들기 전 한 번) · 도달 불가(자동발송 알림톡 = 그 채널 행 0 · 새로 만들기 410) · 고정 유형(시스템 알림톡 nextType S)
    expect(plain.sort()).toEqual(['utils/auto-campaign-worker.ts', 'utils/direct-send-processor.ts', 'utils/system-alimtalk.ts']);
  });
  it('감시의 두 넣기 길 = 첫 발송 시각에 쓰는 첫 칸을 계보 잠금 뒤 그 연결(client)로 읽는다', () => {
    const w = sfOf('utils/journey-trigger-watcher.ts');
    for (const name of ['finishCursorBatch', 'enqueueCandidates']) {
      const fn = fnNode(w, name);
      const lock = callsNamed(fn, 'lockLineageEntry');
      expect(lock, name).toHaveLength(1);
      const runAt = callsNamed(fn, 'firstRunAtFor');
      expect(runAt.length, name).toBeGreaterThan(0);
      // client.query 로 첫 칸(step_order = 1)을 읽는 호출이 잠금 뒤 · 첫 발송 시각 계산 앞에 있다
      const reads: number[] = [];
      const walk = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && n.expression.getText(w) === 'client.query' && n.arguments[0] && /FROM journey_steps[\s\S]*step_order = 1/.test(n.arguments[0].getText(w))) reads.push(n.getStart(w));
        ts.forEachChild(n, walk);
      };
      walk(fn);
      expect(reads, `${name} 잠금 안 첫 칸 읽기`).toHaveLength(1);
      expect(reads[0]).toBeGreaterThan(lock[0].getStart(w));
      for (const r of runAt) {
        expect(r.getStart(w), name).toBeGreaterThan(reads[0]);
        // 대기 방식 · 대기 시간 · 시각 · 밤 예외 판정 넷 모두 잠금 안에서 읽은 첫 칸 값 그대로(상수 · 다른 변수로 바꿔 쓰지 않는다)
        expect(r.getText(w).replace(/\s+/g, ' '), `${name} 첫 발송 시각은 잠금 안에서 읽은 첫 칸으로`)
          .toContain('liveFirst.delay_mode, Number(liveFirst.delay_hours || 0), liveFirst.target_hour_kst, txNow, { nightExempt: isNightExemptStep(liveFirst) })');
        expect(r.getText(w)).not.toMatch(/(?<![A-Za-z])firstStep\./);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// T3 — AI 수정: 알림톡 칸은 만들지도 바꾸지도 못한다 · 끝 칸은 글이 없다
// ════════════════════════════════════════════════════════════════════
describe('T3 AI 수정(패키지) — 알림톡 칸 · 끝 칸', () => {
  const CO = '11111111-1111-1111-1111-111111111111';
  const sms = (order: number, messageTemplate: string, over: Record<string, unknown> = {}) =>
    ({ stepOrder: order, stepType: 'message', channel: 'lms', delayHours: 0, subject: '새 소식', messageTemplate, isAd: false, ...over });
  const kakao = (order: number, code: string, over: Record<string, unknown> = {}) => ({
    stepOrder: order, stepType: 'message', channel: 'kakao', delayHours: 24, subject: '', messageTemplate: `승인 본문 ${code}`, isAd: false,
    alimtalkProfileId: 'p-1', alimtalkTemplateCode: code, alimtalkVariableMap: { '#{이름}': '@@name@@' },
    alimtalkNextType: 'B', alimtalkNextContents: `대체 문자 ${code}`, alimtalkNextSubject: `제목 ${code}`, ...over,
  });
  const edit = (current: any[], next: any[]) => {
    const pkg: any = { name: '새 소식', templateCode: 'repeat', triggerEvent: 'cdp.purchase', steps: current };
    aiMock.mockResolvedValue(JSON.stringify({ ...pkg, steps: next, reasoning: '수정' }));
    return editJourneyPackage({ companyId: CO, currentPackage: pkg, instruction: '말투를 더 정중하게' }) as Promise<any>;
  };
  const PLAIN = '%고객명%님, 신상품이 들어왔어요.';
  const kakaoFields = (s: any) => ({
    body: s.messageTemplate, subject: s.subject, profile: s.alimtalkProfileId, code: s.alimtalkTemplateCode, map: s.alimtalkVariableMap,
    nextType: s.alimtalkNextType, nextContents: s.alimtalkNextContents, nextSubject: s.alimtalkNextSubject,
  });

  it('알림톡 칸의 변수 값 · 대체 문자 · 본문을 AI 가 바꿔 돌려줘도 원래 값 그대로(자리 · 대기 시간은 AI 답)', async () => {
    const A = kakao(2, 'TPL_A');
    const tampered = kakao(2, 'TPL_A', {
      delayHours: 48, messageTemplate: '바꾼 본문', alimtalkVariableMap: { '#{이름}': '50% 할인 고객' },
      alimtalkNextType: 'S', alimtalkNextContents: '오늘만 50% 할인!', alimtalkNextSubject: '특가', alimtalkProfileId: 'p-9',
    });
    const r = await edit([sms(1, PLAIN), A], [sms(1, '%고객명%님, 신상품이 도착했습니다.'), tampered]);
    expect(kakaoFields(r.steps[1])).toEqual(kakaoFields(A));
    expect(r.steps[1].delayHours).toBe(48);
    expect(r.steps[0].messageTemplate).toBe('%고객명%님, 신상품이 도착했습니다.');
  });
  it('알림톡 칸 둘의 자리를 맞바꾼 답 · 앞에 문자 칸을 끼운 답 = 각자 자기 설정(템플릿 코드로 찾는다 · 자리로 찾지 않는다)', async () => {
    const A = kakao(1, 'TPL_A');
    const B = kakao(2, 'TPL_B');
    const swapped = await edit([A, B], [kakao(1, 'TPL_B', { alimtalkNextContents: 'x' }), kakao(2, 'TPL_A', { alimtalkNextContents: 'y' })]);
    expect(kakaoFields(swapped.steps[0])).toEqual(kakaoFields(B));
    expect(kakaoFields(swapped.steps[1])).toEqual(kakaoFields(A));
    const inserted = await edit([A, B], [sms(1, PLAIN), kakao(2, 'TPL_A', { alimtalkNextContents: 'x' }), kakao(3, 'TPL_B', { alimtalkNextContents: 'y' })]);
    expect(kakaoFields(inserted.steps[1])).toEqual(kakaoFields(A));
    expect(kakaoFields(inserted.steps[2])).toEqual(kakaoFields(B));
  });
  it('알림톡 칸 하나를 뺀 답 = 적용(남은 칸은 자기 설정)', async () => {
    const A = kakao(1, 'TPL_A');
    const B = kakao(2, 'TPL_B');
    const r = await edit([A, B, sms(3, PLAIN)], [kakao(1, 'TPL_B'), sms(2, PLAIN)]);
    expect(r.steps).toHaveLength(2);
    expect(kakaoFields(r.steps[0])).toEqual(kakaoFields(B));
  });
  it('원래에 없는 알림톡 칸(새 칸 · 변수 값에 지어낸 혜택 · 대체 종류 S) = 수정 전체 미적용', async () => {
    const fresh = kakao(2, 'TPL_NEW', { alimtalkVariableMap: { '#{혜택}': '50% 할인' }, alimtalkNextType: 'S', alimtalkNextContents: '', alimtalkNextSubject: '' });
    await expect(edit([sms(1, PLAIN)], [sms(1, PLAIN), fresh])).rejects.toThrow(/알림톡 칸은 AI 로/);
    await expect(edit([sms(1, PLAIN), kakao(2, 'TPL_A')], [sms(1, PLAIN), kakao(2, 'TPL_A'), fresh])).rejects.toThrow(/알림톡 칸은 AI 로/);
    // 템플릿 코드가 빈 알림톡 칸 · 문자 칸을 알림톡으로 바꾼 답
    await expect(edit([sms(1, PLAIN)], [sms(1, PLAIN), kakao(2, '')])).rejects.toThrow(/알림톡 칸은 AI 로/);
    await expect(edit([sms(1, PLAIN), sms(2, PLAIN)], [sms(1, PLAIN), kakao(2, 'TPL_A')])).rejects.toThrow(/알림톡 칸은 AI 로/);
  });
  it('같은 코드의 알림톡 칸이 원래에 둘이거나 결과에 둘 = 어느 칸인지 가를 수 없다 = 미적용', async () => {
    const A1 = kakao(1, 'TPL_A', { alimtalkNextContents: '첫 칸 대체' });
    const A2 = kakao(2, 'TPL_A', { alimtalkNextContents: '둘째 칸 대체' });
    await expect(edit([A1, A2], [kakao(1, 'TPL_A'), kakao(2, 'TPL_A')])).rejects.toThrow(/알림톡 칸은 AI 로/);
    await expect(edit([kakao(1, 'TPL_A'), sms(2, PLAIN)], [kakao(1, 'TPL_A'), kakao(2, 'TPL_A')])).rejects.toThrow(/알림톡 칸은 AI 로/);
  });
  it('원래 알림톡 칸을 문자 칸으로 바꾼 답 = 그 글은 문자 관문을 지난다(지어낸 혜택 = 자리표시)', async () => {
    const r = await edit([kakao(1, 'TPL_A'), sms(2, PLAIN)], [sms(1, '오늘만 50% 할인! 지금 확인하세요.'), sms(2, PLAIN)]);
    expect(r.steps[0].channel).toBe('lms');
    expect(r.steps[0].messageTemplate).not.toContain('50%');
    expect(r.steps[0].alimtalkTemplateCode).toBeUndefined();
  });
  it('끝 칸(end · 기능 스위치가 켜진 환경에서만 받는다) = 본문 · 제목이 빈 글', async () => {
    vi.stubEnv('JOURNEY_END_CHIP_ENABLED', 'true');
    const r = await edit([sms(1, PLAIN), sms(2, PLAIN)], [sms(1, PLAIN), { stepOrder: 2, stepType: 'end', messageTemplate: '끝 칸에 실린 글 50% 할인', subject: '끝 제목' }]);
    expect(r.steps[1].stepType).toBe('end');
    expect(r.steps[1].messageTemplate).toBe('');
    expect(r.steps[1].subject).toBe('');
    vi.unstubAllEnvs();
  });
});

// ════════════════════════════════════════════════════════════════════
// ★ 2026-11-11 C129 결정 둘(설계서 §10) — D10 선불 여정 알림톡 칸의 차감 꼴 · D11 날짜형 시작의 따라잡기
// ════════════════════════════════════════════════════════════════════

describe('T5 D10 — 선불 여정 알림톡 칸의 차감 꼴(브랜드 대체와 한 함수 · 원장 열쇠 · 한 캠페인 = 한 꼴)', () => {
  it('alimtalkFallbackChargeType — 대체 안함 = null · S · A = SMS · L · B · 빈 값(기본 L) = LMS', () => {
    expect(alimtalkFallbackChargeType('N')).toBeNull();
    for (const t of ['S', 'A']) expect(alimtalkFallbackChargeType(t), t).toBe('SMS');
    for (const t of ['L', 'B', '', null, undefined]) expect(alimtalkFallbackChargeType(t as any), String(t)).toBe('LMS');
  });

  it('resolveKakaoCharge — 차감 단가 = max(알림톡, 고른 대체) · 고르지 않은 유형 칸 = 차감 단가 · 꼴 글자에 단가 전부 · 미설정 = 유형 이름', () => {
    const row = { cost_per_kakao: 10, cost_per_sms: 12, cost_per_lms: 30 };
    expect(resolveKakaoCharge(row, null)).toEqual({ unset: null, unitPrice: 10, settleUnits: null, shape: 'KAKAO|N|10|-' });
    expect(resolveKakaoCharge(row, 'LMS')).toEqual({ unset: null, unitPrice: 30, settleUnits: { KAKAO: 10, SMS: 30, LMS: 30 }, shape: 'KAKAO|LMS|30|10/30/30' });
    expect(resolveKakaoCharge(row, 'SMS')).toEqual({ unset: null, unitPrice: 12, settleUnits: { KAKAO: 10, SMS: 12, LMS: 12 }, shape: 'KAKAO|SMS|12|10/12/12' });
    // 알림톡이 더 비싼 계약 = 차감 단가는 알림톡 · 대체 성공은 그 차액을 돌려받는다
    expect(resolveKakaoCharge({ ...row, cost_per_kakao: 40 }, 'LMS')).toEqual({ unset: null, unitPrice: 40, settleUnits: { KAKAO: 40, SMS: 40, LMS: 30 }, shape: 'KAKAO|LMS|40|40/40/30' });
    expect(resolveKakaoCharge({ ...row, cost_per_lms: null }, 'LMS')).toEqual({ unset: 'LMS' });
    expect(resolveKakaoCharge({ ...row, cost_per_kakao: null }, null)).toEqual({ unset: 'KAKAO' });
    // 단가 하나만 달라도 다른 글자(같은 날 단가를 바꾸면 다른 단계 캠페인)
    expect((resolveKakaoCharge({ ...row, cost_per_lms: 40 }, 'LMS') as any).shape).toBe('KAKAO|LMS|40|10/40/40');
    expect(resolveFallbackCharge(26.4, 'SMS', 9.9)).toEqual({ unitPrice: 26.4, settleUnits: { KAKAO: 26.4, SMS: 9.9, LMS: 26.4 } });
  });

  it('prepaid — 브랜드 블록과 알림톡 칸이 차감 꼴 함수 하나 · 원장 열쇠 확인 = 과금 방식(잠금 앞 · 뒤) · 열쇠 없음 · 발송 날 · 꼴', () => {
    const sf = sfOf('utils/prepaid.ts');
    const deduct = fnNode(sf, 'prepaidDeduct');
    expect(callsNamed(deduct, 'resolveFallbackCharge')).toHaveLength(1);   // 브랜드 대체
    expect(callsNamed(deduct, 'resolveKakaoCharge')).toHaveLength(1);      // 여정 알림톡 칸
    expect(callsNamed(fnNode(sf, 'resolveKakaoCharge'), 'resolveFallbackCharge')).toHaveLength(1);
    const text = deduct.getText(sf);
    expect(text).not.toContain('Math.max(resolved.price');
    expect(text.split('chargeChanged: true').length - 1).toBe(4);
    expect(text).toContain("if (pre.rows[0].billing_type !== 'prepaid' && opts?.kakaoCharge) return { ok: false, chargeChanged: true");
    expect(text).toContain('if (opts?.kakaoCharge) return { ok: false, chargeChanged: true');
    expect(text).toContain("if (messageType === 'KAKAO' && referenceType === 'journey' && !opts?.kakaoCharge) {");
    expect(text).toContain('if (kstDateString() !== opts.kakaoCharge.sendDay || kc.shape !== opts.kakaoCharge.expectShape) {');
    // 발송 날의 시계 = 단계 캠페인을 고를 때와 같은 함수
    expect(be('utils/prepaid.ts')).toContain("import { kstDateString } from './journey-step-campaign';");
  });

  it('실행기 — 차감 꼴 = 차감과 같은 함수 · 지출 관문 = guardCost · 원장 열쇠를 넘긴다 · 꼴이 바뀐 회차는 표식만 지우고 멈추지 않는다', () => {
    const src = be('utils/journey-executor.ts');
    expect(src).toContain('const kakaoFb = isKakao ? alimtalkFallbackChargeType(step.alimtalk_next_type) : null;');
    expect(src).toContain('const kakaoCharge = isPrepaid && isKakao ? resolveKakaoCharge(compRes.rows[0] || {}, kakaoFb) : null;');
    expect(src).toContain('const guardCost = kakaoCharge && kakaoCharge.unset === null ? Math.round(kakaoCharge.unitPrice) : sendCost;');
    const from = src.indexOf("reason: 'subject_empty_for_lms_mms'");
    const gate = src.slice(from, src.indexOf('outcomes[i].out = out;', from));
    expect(gate.split('guardCost').length - 1).toBe(7);   // 칸 임계 2 · 월 예산의 이번 몫 2 · 잔액 사전 확인 2 · 차례 차감 1
    expect(gate).not.toContain('sendCost');
    const sf = sfOf('utils/journey-executor.ts');
    const send = fnNode(sf, 'sendUnits');
    const ded = callsNamed(send, 'prepaidDeduct');
    expect(ded).toHaveLength(1);
    expect(ded[0].arguments.slice(5).map((x) => x.getText(sf))).toEqual(["'journey'", 'null', 'c.kakaoPay ? { kakaoCharge: { ...c.kakaoPay, sendDay: pick.sendDate } } : undefined']);
    const pick = callsNamed(send, 'pickStepCampaignForUnits');
    expect(pick).toHaveLength(1);
    expect(pick[0].getText(sf)).toContain('ledgerShape: c.ledgerShape,');
    const branches: ts.IfStatement[] = [];
    const walk = (n: ts.Node): void => { if (ts.isIfStatement(n) && n.expression.getText(sf) === '!deduct.ok && deduct.chargeChanged') branches.push(n); ts.forEachChild(n, walk); };
    walk(send);
    expect(branches).toHaveLength(1);
    const bt = branches[0].thenStatement.getText(sf);
    expect(bt).toContain('await query(CLEAR_UNPAID_CLAIMS_SQL, [claimIds, step.id, campaignId]);');
    expect(bt).toContain('return unit[0].idx;');
    for (const stop of ['pauseJourney', 'autoPauseExecution', 'logStepMany']) expect(bt, stop).not.toContain(stop);
    // 그 갈래가 일반 차감 실패 갈래보다 앞
    const st = send.getText(sf);
    expect(st.indexOf('if (!deduct.ok && deduct.chargeChanged) {')).toBeLessThan(st.indexOf('if (!deduct.ok) {'));
  });

  it('단계 캠페인 — 꼴이 다르면(한쪽만 있는 것 포함) 이어 붙임 · 만들 때 꼴을 싣는다 · 고른 발송 날을 함께 돌려준다', () => {
    const src = be('utils/journey-step-campaign.ts');
    expect(src).toContain('const sameShape = (row.ledger_shape ?? null) === (spec.ledgerShape ?? null);');
    expect(src).toContain('if (!row.sealed && sameShape && row.protocol === LOAD_PROTOCOL_UNIT) return { campaignId: String(row.campaign_id), sendDate };');
    expect(src).toContain('if (!row.sealed && sameShape && row.protocol !== LOAD_PROTOCOL_UNIT) {');
    expect(src).not.toMatch(/if \(!row\.sealed && row\.protocol/);
    expect(src).toContain('...(spec.ledgerShape ? { ledgerShape: spec.ledgerShape } : {})');
    expect(src).toContain('if (created) return { campaignId: created, sendDate };');
  });

  it('월 예산 문장 — 꼴 없는 캠페인 = 칸 기록 · 꼴 있는 캠페인 = 잔액 원장 순지출(차감 − 환불 + 회수 · 캠페인 발송 날의 달)', () => {
    const src = be('utils/journey-executor.ts');
    const at = src.indexOf('export const JOURNEY_MONTH_COST_SQL');
    const sql = src.slice(at, src.indexOf('`;', at));
    expect(sql).toContain("WHEN t.type = 'deduct' THEN t.amount");
    expect(sql).toContain("WHEN t.type = 'refund' THEN -t.amount");
    expect(sql).toContain("WHEN t.type = 'admin_deduct' AND t.description LIKE '%환불 reverse%' THEN -t.amount");
    expect(sql).toContain("JOIN campaigns sc ON sc.id = jsc.campaign_id AND (sc.send_config ? 'ledgerShape')");
    expect(sql).toContain("t.reference_type = 'journey' AND t.reference_id = sc.id");
    expect(sql).toContain('jsc.send_date::date >= (${KST_MONTH_START_SQL} AT TIME ZONE \'Asia/Seoul\')::date');
    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM campaigns lc WHERE lc.id = l.campaign_id AND (lc.send_config ? 'ledgerShape'))");
  });
});

describe('T5 D11 — 날짜형 시작(생일 임박 · 연 단위 포인트 소멸)의 따라잡기', () => {
  const CO = '00000000-0000-4000-8000-0000000000c1';
  const J = '00000000-0000-4000-8000-0000000000c2';
  const KST = "((NOW() AT TIME ZONE 'Asia/Seoul')::date)";
  const mdOf = (d: string) => `TO_CHAR(${d}, 'MM-DD'), CASE WHEN TO_CHAR(${d}, 'MM-DD') = '02-28' AND TO_CHAR(${d} + INTERVAL '1 day', 'MM-DD') = '03-01' THEN '02-29' END`;
  const reentry = { allowReentry: true, cooldownDays: 0, floorDays: 1, lineageIds: [J] };
  const annual = { expiry_mode: 'annual_date', expiry_month_day: '12-31', days_before: 7, points_min: 0 };

  it('isDateEdgeTrigger — 생일 임박 · 연 단위 소멸만(휴면 · 미사용 일수 방식 소멸 · 사건 = 아니다)', () => {
    expect(isDateEdgeTrigger('customer.birthday_approaching', {})).toBe(true);
    expect(isDateEdgeTrigger('customer.points_expiring', annual)).toBe(true);
    expect(isDateEdgeTrigger('customer.points_expiring', { expiry_mode: 'inactivity' })).toBe(false);
    expect(isDateEdgeTrigger('customer.points_expiring', null)).toBe(false);
    for (const t of ['customer.dormant', 'cdp.purchase', 'customer.created', 'custom']) expect(isDateEdgeTrigger(t, {}), t).toBe(false);
  });

  it('훑기 입력 없음(미리보기 · 인원 세기 · 칸 없음) = 옛 문장과 같은 글자', async () => {
    const day = `(${KST} + ($2 || ' days')::interval)`;
    const b = await buildJourneyTargetQuery(CO, 'customer.birthday_approaching', { days_before: 7 }, 100);
    expect(b!.sql).toContain(`c.birth_month_day IN (${mdOf(day)})`);
    expect(b!.sql).toContain(`TO_CHAR(c.birth_date, 'MM-DD') IN (${mdOf(day)})`);
    expect(b!.sql).not.toContain('wje.');
    expect(b!.sql).not.toContain('::date +');
    expect(b!.params.slice(0, 2)).toEqual([CO, '7']);
    expect(b!.params).toHaveLength(3);
    const p = await buildJourneyTargetQuery(CO, 'customer.points_expiring', annual, 100);
    expect(p!.sql).toContain(`AND TO_CHAR((${KST} + ($3 || ' days')::interval), 'MM-DD') = $4`);
    expect(p!.sql).not.toContain('wje.');
    expect(p!.params.slice(0, 4)).toEqual([CO, '0', '7', '12-31']);
  });

  it('훑기 입력 있음 = 기준일은 넘겨받은 날짜 · 창 = N − g · m 은 N 으로 자른다 · m > 0 이면 창 안에 들어온 고객 제외', async () => {
    const scan = (catchUpDays: number) => ({ on: '2026-11-11', catchUpDays });
    const base = "($3::date + ($2 || ' days')::interval";
    const q = await buildJourneyTargetQuery(CO, 'customer.birthday_approaching', { days_before: 7 }, 100, J, reentry, '', undefined, scan(2));
    expect(q!.params[2]).toBe('2026-11-11');
    expect(q!.sql).not.toContain(`${KST} + ($2`);
    expect(q!.sql).toContain(`c.birth_month_day IN (${[`${base})`, `${base} - INTERVAL '1 days')`, `${base} - INTERVAL '2 days')`].map(mdOf).join(', ')})`);
    expect(q!.sql).not.toContain("INTERVAL '3 days'");
    expect(q!.sql).toContain("wje.entered_at >= (($3::date - INTERVAL '2 days')::timestamp AT TIME ZONE 'Asia/Seoul')");
    expect(q!.sql).toMatch(/wje\.journey_id = ANY\(\$\d+::uuid\[\]\) AND wje\.customer_id = c\.id/);
    expect(q!.params).toContainEqual([J]);

    // 못 훑은 날이 N 보다 많아도 N 까지만(생일이 기준일이거나 앞날)
    const cut = await buildJourneyTargetQuery(CO, 'customer.birthday_approaching', { days_before: 1 }, 100, J, reentry, '', undefined, scan(5));
    expect(cut!.sql).toContain(`${base} - INTERVAL '1 days')`);
    expect(cut!.sql).not.toContain("INTERVAL '2 days'");
    expect(cut!.sql).toContain("wje.entered_at >= (($3::date - INTERVAL '1 days')::timestamp AT TIME ZONE 'Asia/Seoul')");

    // 못 훑은 날 0 = 하루 · 창 안 제외 없음(기준일만 넘겨받은 값)
    const one = await buildJourneyTargetQuery(CO, 'customer.birthday_approaching', { days_before: 7 }, 100, J, reentry, '', undefined, scan(0));
    expect(one!.sql).toContain(`c.birth_month_day IN (${mdOf(`${base})`)})`);
    expect(one!.sql).not.toContain("($2 || ' days')::interval - INTERVAL");   // 날짜 창은 하루(재진입 조각의 INTERVAL 과 구분)
    expect(one!.sql).not.toContain('wje.');

    // 연 단위 소멸 = 소멸일이 창의 어느 날과 같으면
    const pts = await buildJourneyTargetQuery(CO, 'customer.points_expiring', annual, 100, J, reentry, '', undefined, scan(1));
    expect(pts!.params[4]).toBe('2026-11-11');
    expect(pts!.sql).toContain("$4 IN (TO_CHAR(($5::date + ($3 || ' days')::interval), 'MM-DD'), TO_CHAR(($5::date + ($3 || ' days')::interval - INTERVAL '1 days'), 'MM-DD'))");
    expect(pts!.sql).toContain("wje.entered_at >= (($5::date - INTERVAL '1 days')::timestamp AT TIME ZONE 'Asia/Seoul')");
  });

  it('감시 — 기록 문장(같은 값이어도 다시 써 1행) · 넣기와 같은 연결 · 넣기 앞 기준일 확인 · 끝난 회차 = 기록 문장 1행뿐', () => {
    const sf = sfOf('utils/journey-trigger-watcher.ts');
    const mark = fnNode(sf, 'markStateScan');
    const sqls = literalsUnder(mark, sf).join('\n');
    expect(sqls).toContain('UPDATE journeys SET last_state_cursor_on = $3::text::date');
    expect(sqls).toContain("status = 'active'");
    expect(sqls).toContain("COALESCE(trigger_filters, '{}'::jsonb) = $4::jsonb");
    expect(sqls).toContain('${KST_CLOCK_DATE_SQL}::text = $3::text');   // 지금 시각(잠금을 기다리다 자정을 넘긴 트랜잭션이 어제로 보지 않게 · Codex 구현 1R)
    expect(be('utils/stats-aggregation.ts')).toContain("export const KST_CLOCK_DATE_SQL = `((clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date)`;");
    expect(sqls).toContain('RETURNING id');
    expect(sqls).not.toMatch(/last_state_cursor_on\s+(IS NULL|<)/);   // 「더 옛날일 때만」 조건을 두지 않는다(앞 회차의 기록이 이번 회차를 대신하지 않게)
    expect(callsNamed(mark, 'startSameSql')).toHaveLength(1);
    expect(mark.getText(sf)).toContain('JSON.stringify(j.trigger_filters || {})');

    const enq = fnNode(sf, 'enqueueCandidates');
    const marks = callsNamed(enq, 'markStateScan');
    expect(marks).toHaveLength(1);
    expect(marks[0].arguments[0].getText(sf)).toBe('client');
    const et = enq.getText(sf);
    expect(et).toContain('if (scanMark?.advance) scanDone = await markStateScan(client, j, expect, scanMark.on);');
    expect(et.indexOf('INSERT INTO journey_executions')).toBeLessThan(et.indexOf('markStateScan(client'));
    expect(et.indexOf('markStateScan(client')).toBeLessThan(et.lastIndexOf("await client.query('COMMIT')"));
    expect(et).toMatch(/if \(scanMark\) \{\s+const same = await client\.query\(`SELECT \(\$\{KST_CLOCK_DATE_SQL\}::text = \$1::text\) AS same`, \[scanMark\.on\]\);\s+if \(!same\.rows\[0\]\?\.same\) \{\s+await client\.query\('ROLLBACK'\);\s+return \{ matched, enqueued: 0, skipped: matched, scanDone: false \};/);
    expect(et.indexOf('if (scanMark) {')).toBeLessThan(et.indexOf('INSERT INTO journey_executions'));

    const proc = fnNode(sf, 'processJourneyTrigger').getText(sf);
    expect(proc).toContain('if (ctx.dateEdge) {');
    expect(proc).toContain('scan ? { on: scan.on, advance: !cut || backfill != null } : undefined');
    expect(proc).toContain('ctx.scan = scan;');
    expect(proc).toContain('if (scan) ctx.done = await markStateScan({ query }, j, expect, scan.on);');
    // 회차를 여는 한 문장 = 읽기 + 그날을 미완료로 내려 두기(끝난 뒤 되돌리는 쓰기 0 · 그 쓰기가 실패할 일도 없다 · Codex 구현 2R)
    expect(proc).toContain('const sr = await query(OPEN_STATE_SCAN_SQL, [j.id, j.company_id]);');
    const open = be('utils/journey-trigger-watcher.ts');
    const openSql = open.slice(open.indexOf('const OPEN_STATE_SCAN_SQL ='), open.indexOf('`;', open.indexOf('const OPEN_STATE_SCAN_SQL =')));
    expect(openSql).toContain('SELECT last_state_cursor_on AS was FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE');
    expect(openSql).toContain('SET last_state_cursor_on = CASE WHEN cur.was >= ${KST_TODAY_DATE_SQL} THEN ${KST_TODAY_DATE_SQL} - 1 ELSE cur.was END');
    expect(openSql).toContain('RETURNING ${KST_TODAY_DATE_SQL}::text AS scan_on, (${KST_TODAY_DATE_SQL} - cur.was) AS gap');
    expect(open).not.toContain('unfinishStateScan');

    expect(proc).toContain('if (r.scanDone) ctx.done = true;');
    expect(proc).toContain('return { matched: r.matched, enqueued: r.enqueued, skipped: r.skipped, truncated: cut };');
    // 감싸는 함수 = ① 한 여정의 날짜형 회차는 프로세스 사이에서도 하나씩(세션 잠금 · 못 잡으면 열지 않고 넘김) ② 끝나지 않은 회차는 1시간 쉼에서 뺀다
    const round = fnNode(sf, 'runJourneyTriggerRound').getText(sf);
    expect(round).toContain('dateEdge: isDateEdgeTrigger(j.trigger_event, j.trigger_filters) && await stateCursorColumnReady()');
    expect(round).toContain('if (!ctx.dateEdge) return processJourneyTrigger(j, ctx);');
    expect(round).toContain('const got = await withJourneySessionLock(DATE_SCAN_LOCK_SPACE, j.id, false, () => processJourneyTrigger(j, ctx));');
    expect(round).toContain('if (!got.locked) return { matched: 0, enqueued: 0, skipped: 0, truncated: true };');
    expect(round).toContain('return ctx.scan && !ctx.done ? { ...got.value, truncated: true } : got.value;');
    expect(callsNamed(sf, 'processJourneyTrigger')).toHaveLength(2);   // 본문을 부르는 자리 = 감싸는 함수 안 둘(날짜형 = 잠금 안 · 그 밖 = 그대로)
    expect(callsNamed(fnNode(sf, 'runJourneyTriggerRound'), 'processJourneyTrigger')).toHaveLength(2);
    expect(callsNamed(fnNode(sf, 'runJourneyTriggerWatcher'), 'runJourneyTriggerRound')).toHaveLength(1);
    // 세션 잠금의 꼴 = 공용 하나(한 번 보내기 잠금도 그것을 부른다 · 같은 이름 · 같은 키)
    const lock = literalsUnder(fnNode(sfOf('utils/journey-lineage.ts'), 'withJourneySessionLock'), sfOf('utils/journey-lineage.ts')).join('\n');
    expect(lock).toContain('SELECT pg_try_advisory_lock(hashtext($1::text), hashtext($2::text)) AS ok');
    expect(lock).toContain('SELECT pg_advisory_unlock(hashtext($1::text), hashtext($2::text))');
    expect(fnNode(sfOf('utils/journey-anchor-scheduler.ts'), 'withOneShotLock').getText(sfOf('utils/journey-anchor-scheduler.ts'))).toContain("return withJourneySessionLock('one-shot-settle', journeyId, wait, work);");
    // 상한 초과 멈춤 갈래는 기록 문장보다 앞에서 돌아간다
    expect(proc.indexOf('대량 진입 감지')).toBeLessThan(proc.indexOf('await enqueueCandidates('));
  });
});

