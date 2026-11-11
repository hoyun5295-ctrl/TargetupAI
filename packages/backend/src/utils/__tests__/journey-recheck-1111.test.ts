/**
 * C126 여정 재점검(★ 2026-11-11 · 설계서 docs/2026-11-11-journey-recheck-design.md §6 T1 · T2 · T3 · T5) — 단위 · 소스 계약 · 생산자 결과
 *   D1 미완료 실행 = 진행 중 + 멈춤 · D3 한 번만 들어오는 시작의 넣기 가드 · D4 대기일 = 끝난 뒤 max(최솟값, 저장값) · D2 워커 = 잠금 안 읽기
 *   · D5 여정 AI 글의 변수 꼴(쓰기 · 고치기 두 규칙). 실행 시점 동작(실제 표)은 journey-recheck-1111.pg.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ts from 'typescript';

const aiMock = vi.fn(async (_p: any): Promise<string> => '{}');
const dbRows: { company: any } = { company: {} };
vi.mock('../ai-credit', async (orig) => ({
  ...(await orig<any>()),
  checkCredit: async () => undefined,
  runChargedAi: async (o: any) => { const result = await o.run(); return { result, charged: o.accept ? !!o.accept(result) : true }; },
  settleCreditAfterSuccess: async () => 'not_applicable',
}));
vi.mock('../../services/ai', () => ({ callAIWithFallback: (p: any) => aiMock(p), getKoreanCalendar: () => ({}), getSeasonContext: () => ({ month: 11, season: '가을', keywords: [] }) }));
vi.mock('../../config/database', () => {
  const query = vi.fn(async (text: string) => (/FROM companies/.test(String(text)) ? { rows: [dbRows.company] } : { rows: [] }));
  return { query, pool: { connect: vi.fn() }, lockPool: { connect: vi.fn() }, default: { connect: vi.fn(), query } };
});
vi.mock('../copy-prompt-composer', () => ({ composeCopyBrain: async () => ({ promptSuffix: '', examples: [] }) }));
vi.mock('../brand-voice-prompt', () => ({ VOICE_KIND_BY_STEP: 'by_step', voiceLearned: async () => false, getBrandVoiceSnapshot: async () => null, getBrandGuideline: async () => null, voiceLearnedOf: () => false, resolveGuidelineFor: () => null, composeVoicePrompt: async (i: { basePrompt: string }) => ({ system: i.basePrompt, guideline: null, shape: null, voiceLearned: false, exampleCount: 0 }) }));
vi.mock('../best-copy-assets', () => ({ getStructureSkeleton: async () => null }));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: async () => '' }));
vi.mock('../company-data-profile', () => ({ getCompanyDataProfile: async () => null, formatProfileForAiPrompt: () => '' }));

import { be, sourceFiles, BE, stripComments, declarationsNamed } from './helpers/producer-scan';
import { openExecutionSql, recentlyEndedSql, reentryHoldSql, reentryWaitDays, REENTRY_WAIT_MAX_DAYS, buildReentryAntiJoin } from '../journey-safety-filter';
import { TRIGGER_CONTRACTS, entersOncePerCustomer } from '../journey-trigger-capability';
import { journeyNewCopy, journeyRevisedCopy, journeyRevisedKept, hasLiquidTags, LIQUID_TAG_NOTICE } from '../journey-ai-copy';
import { liquidCopyToPercent, detectLiquidSyntax } from '../liquid-templating';
import { CUSTOMER_LIQUID_TO_PERCENT } from '../standard-field-map';
import { CLOSE_ACTIVE_FOR_REPLACEMENT_SQL, CLOSE_PAUSED_FOR_REPLACEMENT_SQL } from '../journey-entry-replace';
import { outcomeStatuses } from '../journey-after-config';
import { refineStepMessage, regenerateStepAvoidingSpam } from '../journey-ai-generator';
import { generateVariantsFromMessage } from '../variant-generator';
import { editJourneyPackage } from '../journey-ai-editor';

beforeEach(() => { aiMock.mockReset(); dbRows.company = {}; });

// ════════════════════════════════════════════════════════════════════
// T3 단위 — 조각 · 대기일 · 한 번만 들어오는 시작
// ════════════════════════════════════════════════════════════════════
describe('D1 미완료 실행 조각 = 진행 중 + 멈춤(한 곳)', () => {
  it('조각 글자', () => {
    expect(openExecutionSql('je')).toBe("je.status IN ('active', 'paused')");
    expect(recentlyEndedSql('je', 7)).toBe("COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '7 days'");
    expect(reentryHoldSql('je', 0)).toBe("je.status IN ('active', 'paused')");
    expect(reentryHoldSql('je', 7)).toBe("(je.status IN ('active', 'paused') OR COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '7 days')");
  });
  it('진입 교체: 진행 중 = 목표 달성(옛 글자 그대로) · 멈춘 실행 = ended(뒤 여정이 「마침」으로 받지 않는 상태) · 둘 다 끝난 시각 기록', () => {
    expect(CLOSE_ACTIVE_FOR_REPLACEMENT_SQL).toContain("SET status = 'goal_met', completed_at = NOW()");
    expect(CLOSE_ACTIVE_FOR_REPLACEMENT_SQL).toContain("AND status = 'active'");
    expect(CLOSE_PAUSED_FOR_REPLACEMENT_SQL).toContain("SET status = 'ended', completed_at = NOW()");
    expect(CLOSE_PAUSED_FOR_REPLACEMENT_SQL).toContain("AND status = 'paused'");
    for (const outcome of ['goal_met', 'completed', 'any'] as const) expect(outcomeStatuses(outcome)).not.toContain('ended');
  });
});

describe('D4 대기일 = max(계약 최솟값, 저장 대기일) · 저장값을 줄이지 않는다', () => {
  it('reentryWaitDays', () => {
    expect(reentryWaitDays(7, 3)).toBe(7);
    expect(reentryWaitDays(7, 30)).toBe(30);
    expect(reentryWaitDays(7, 730)).toBe(730);          // 365 를 넘는 저장값 그대로(Codex 설계 2R #5)
    expect(reentryWaitDays(1, 3650)).toBe(3650);
    expect(reentryWaitDays(0, null)).toBe(0);
    expect(reentryWaitDays(0, undefined)).toBe(0);
    expect(reentryWaitDays(0, '')).toBe(0);
    expect(reentryWaitDays(7, -5)).toBe(7);
    expect(reentryWaitDays(0, 2.9)).toBe(2);
    expect(reentryWaitDays(0, '45')).toBe(45);
    expect(reentryWaitDays(1, Number.NaN)).toBe(REENTRY_WAIT_MAX_DAYS);       // 숫자가 아님 = 막는 쪽
    expect(reentryWaitDays(1, 'abc')).toBe(REENTRY_WAIT_MAX_DAYS);
    expect(reentryWaitDays(1, Infinity)).toBe(REENTRY_WAIT_MAX_DAYS);
    expect(reentryWaitDays(1, 10 ** 12)).toBe(REENTRY_WAIT_MAX_DAYS);
    expect(REENTRY_WAIT_MAX_DAYS).toBe(36500);
  });
  it('조각이 싣는 글자 = 숫자뿐(문자열 값이 와도 SQL 글자가 되지 않는다)', () => {
    const sql = reentryHoldSql('je', "1 day'); DROP TABLE x; --" as any);
    expect(sql).toBe(`(je.status IN ('active', 'paused') OR COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '${REENTRY_WAIT_MAX_DAYS} days')`);
  });
  it('뽑기 안티조인: 재진입 불가 = 옛 글자 · 허용 = 한 갈래(끝난 뒤 max(최솟값, 저장값) · 바인드 = 여정 하나)', () => {
    const off: any[] = [];
    expect(buildReentryAntiJoin('c', off, 'J', false, 30, 7))
      .toBe('AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $1::uuid AND je.customer_id = c.id)');
    expect(off).toEqual(['J']);
    const cases: Array<[number, number, string]> = [
      [0, 0, "je.status IN ('active', 'paused')"],
      [0, 7, "(je.status IN ('active', 'paused') OR COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '7 days')"],
      [30, 7, "(je.status IN ('active', 'paused') OR COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '30 days')"],
      [3, 7, "(je.status IN ('active', 'paused') OR COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '7 days')"],
      [730, 7, "(je.status IN ('active', 'paused') OR COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '730 days')"],
    ];
    for (const [cooldown, floor, hold] of cases) {
      const p: any[] = [];
      expect(buildReentryAntiJoin('c', p, 'J', true, cooldown, floor), `${cooldown}/${floor}`)
        .toBe(`AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $1::uuid AND je.customer_id = c.id AND ${hold})`);
      expect(p).toEqual(['J']);                         // 저장 대기일 바인드 없음(옛: 둘)
      const lp: any[] = ['x'];
      expect(buildReentryAntiJoin('c', lp, 'J', true, cooldown, floor, ['J', 'OLD'])).toContain('je.journey_id = ANY($2::uuid[])');
      expect(lp).toEqual(['x', ['J', 'OLD']]);
    }
    // 옛 기준(들어온 시각) 조건이 남지 않는다
    expect(buildReentryAntiJoin('c', [], 'J', true, 30, 7)).not.toMatch(/je\.entered_at > NOW\(\)/);
  });
});

describe('D3 한 번만 들어오는 시작 = 계약의 상시 시작뿐', () => {
  it('계약 전수', () => {
    for (const c of TRIGGER_CONTRACTS) expect(entersOncePerCustomer(c.event), c.event).toBe(c.cls === 'standing');
    expect(entersOncePerCustomer('custom')).toBe(true);
    expect(entersOncePerCustomer('customer.dormant')).toBe(false);
    expect(entersOncePerCustomer('journey.after')).toBe(false);
    expect(entersOncePerCustomer('모르는 시작')).toBe(false);
    expect(entersOncePerCustomer(null)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// T1 · T2 소스 계약(구문 트리)
// ════════════════════════════════════════════════════════════════════
const SRC_FILES = sourceFiles(BE, /\.ts$/);
const sfOf = (rel: string) => ts.createSourceFile(rel, be(rel), ts.ScriptTarget.Latest, true);
/** 그 노드 아래의 글자열 · 템플릿 글자열 전부(템플릿 = 끼운 식까지 원문 그대로) */
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
/** 그 노드를 감싼 함수 선언 이름(함수 밖이면 최상위 상수 이름) = 자리 이름 */
const siteName = (n: ts.Node): string => {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && ts.isSourceFile(p.parent.parent.parent)) return p.name.text;
  }
  return '(top)';
};
const fnNode = (sf: ts.SourceFile, name: string): ts.FunctionDeclaration => {
  const hits = declarationsNamed(sf, name).filter(ts.isFunctionDeclaration);
  expect(hits.length, name).toBe(1);
  return hits[0];
};

describe('T1 R87 넓힘 — 진입을 막는 판정은 미완료 조각을 지난다 · 종결은 끝난 시각을 남긴다', () => {
  const ENTRY_JUDGES: Array<[string, string]> = [
    ['utils/journey-safety-filter.ts', 'reentryHoldSql'],
    ['utils/journey-safety-filter.ts', 'buildReentryAntiJoin'],
    ['utils/journey-target-extractor.ts', 'afterJourneyTargetQuery'],
    ['utils/journey-trigger-watcher.ts', 'enqueueCandidates'],
    ['utils/journey-trigger-watcher.ts', 'checkCooldown'],
    ['utils/journey-trigger-watcher.ts', 'cooldownElapsed'],
    ['utils/journey-reentry-worker.ts', 'runReentryBatch'],
  ];
  it('진입 판정 함수 안의 실행 표 SQL 에 따로 쓴 `status = \'active\'` 0(전부 openExecutionSql)', () => {
    for (const [file, name] of ENTRY_JUDGES) {
      const sf = sfOf(file);
      const sqls = literalsUnder(fnNode(sf, name), sf).filter((t) => /journey_executions/.test(t));
      for (const sql of sqls) expect(sql, `${file} ${name}`).not.toMatch(/status\s*=\s*'active'/);
    }
  });
  it('실행 표 SQL 에 진행 중 상태를 직접 적은 자리 전수 = 「진입 판정 아님」 분류표(새 자리 = 실패 · 진입 판정 함수는 표에 없다)', () => {
    // [파일 | 감싼 함수 선언 · 최상위 상수] → 진입 판정이 아닌 까닭. 새 자리가 생기면 이 시험이 실패한다:
    //   진입을 막는 판정이면 여기 올리지 말고 openExecutionSql 을 쓴다(멈춘 실행 = 미완료) · 아니면 까닭을 적어 올린다.
    const NOT_ENTRY: Record<string, string> = {
      'utils/journey-anchor-scheduler.ts | processAnchorJourney': '날짜 기준 여정의 자동 정지 판정(그 회차 실행이 남았는가) · 여정 행 상태',
      'utils/journey-anchor-scheduler.ts | recoverPendingOneShots': '여정 행 상태(journeys.status)',
      'utils/journey-builder.ts | countInProgressExecutions': '칸 편집 정책(진행 중 + 멈춤을 센다)',
      'utils/journey-entry-replace.ts | CLOSE_ACTIVE_FOR_REPLACEMENT_SQL': '닫기(진입 교체 · 진행 중 → 목표 달성)',
      'utils/journey-executor.ts | applyRowOutcomes': '실행기',
      'utils/journey-executor.ts | delayExecutions': '실행기',
      'utils/journey-executor.ts | finishExecutions': '실행기',
      'utils/journey-executor.ts | processStepBatch': '실행기',
      'utils/journey-executor.ts | recordExecutionErrors': '실행기',
      'utils/journey-executor.ts | resolveOrphanJourneyClaims': '실행기',
      'utils/journey-executor.ts | runJourneyExecutor': '실행기',
      'utils/journey-executor.ts | sendUnits': '실행기',
      'utils/journey-executor.ts | setNextRunAt': '실행기',
      'utils/journey-executor.ts | stillActiveExecutions': '실행기',
      'utils/journey-goal-purchase.ts | ENTRY_PURCHASE_VOIDED_SQL': '실행기(진행 중 실행의 진입 구매 취소 판정)',
      'utils/journey-lifecycle-map.ts | buildLifecycleMap': '화면(생애주기 지도)',
      'utils/journey-lifecycle-map.ts | loadPendingGoalExits': '화면(생애주기 지도)',
      'utils/journey-lineage.ts | endDrainedVersions': '닫기(다 빠진 옛 판)',
      'utils/journey-lineage.ts | endJourneyLineage': '닫기(여정 끝내기 · 진행 중 + 멈춤)',
      'utils/journey-pause-handler.ts | autoPauseExecution': '멈춤(자동 멈춤 = 진행 중인 실행에만 · C129 D1)',
      'utils/journey-pause-handler.ts | dueExecutionsSql': '멈춤(그날 정지 대상)',
      'utils/journey-pause-handler.ts | pauseStepForDay': '멈춤',
      'utils/journey-pretest-notifier.ts | detectLateNewCopy': '사전 검사 대상',
      'utils/journey-pretest-notifier.ts | scanAndPretest': '사전 검사 대상',
      'utils/journey-pretest-notifier.ts | weeklyCheckRows': '주간 검사 대상',
      'utils/journey-resume.ts | RESUME_REVIVE_SQL': '되살리기(멈춤 → 진행 중)',
      'utils/journey-resume.ts | RESUME_STALE_ANCHOR_SQL': '닫기(다시 켤 때 지난 날 실행)',
      'utils/journey-stats.ts | getJourneyLiveSnapshot': '통계 · 화면',
      'utils/journey-stats.ts | getJourneyOverview': '통계 · 화면',
      'utils/manager-board.ts | loadManagerBoardFor': '화면(담당자 상황판)',
      'utils/operator-recipients.ts | buildAudienceWhere': '캠페인 대상 조건(여정 진행 중 고객 제외 · 여정 진입 아님)',
    };
    const found = new Set<string>();
    for (const f of SRC_FILES) {
      const sf = sfOf(f);
      const visit = (n: ts.Node): void => {
        const text = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : ts.isTemplateExpression(n) ? n.getText(sf) : null;
        if (text != null && /journey_executions/.test(text)
          && (/status\s*=\s*'active'/.test(text) || /status\s+(?:NOT\s+)?IN\s*\([^)]*'active'[^)]*\)/i.test(text))) found.add(`${f} | ${siteName(n)}`);
        if (ts.isTemplateExpression(n)) { n.templateSpans.forEach((s) => visit(s.expression)); return; }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect([...found].sort()).toEqual(Object.keys(NOT_ENTRY).sort());
    for (const [file, name] of ENTRY_JUDGES) expect(NOT_ENTRY[`${file} | ${name}`], `${file} ${name} = 진입 판정`).toBeUndefined();
  });
  it('미완료 조각을 쓰는 자리 = 뽑기 조각 · 앞 여정 뒤 뽑기 · 사건 커서의 다른 판 검사 · 칸 지우기 가드(조각 함수 호출을 구문 트리로 센다)', () => {
    const callers = SRC_FILES.filter((f) => {
      const sf = sfOf(f);
      let n = 0;
      const walk = (x: ts.Node): void => { if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'openExecutionSql') n++; ts.forEachChild(x, walk); };
      walk(sf);
      return n > 0;
    }).sort();
    // ★ 1111 C129 D6 — 칸 지우기 가드(journey-builder)도 미완료 조각을 쓴다(진입 판정은 아니고 같은 상태 집합)
    expect(callers).toEqual(['utils/journey-builder.ts', 'utils/journey-safety-filter.ts', 'utils/journey-target-extractor.ts', 'utils/journey-trigger-watcher.ts']);
  });
  it('실행을 종결로 바꾸는 UPDATE 전수 = 같은 문장에 completed_at · 끝난 시각 없이 바꾸는 상태 = 미완료 목록 안', () => {
    const open = new Set(Array.from(openExecutionSql('x').matchAll(/'(\w+)'/g)).map((m) => m[1]));
    expect([...open].sort()).toEqual(['active', 'paused']);
    const found: string[] = [];
    for (const f of SRC_FILES) {
      const sf = sfOf(f);
      for (const sql of literalsUnder(sf, sf)) {
        const m = /UPDATE\s+journey_executions\b[\s\S]*?\bSET\b([\s\S]*)/i.exec(sql);
        if (!m) continue;
        const setClause = m[1].split(/\bWHERE\b/i)[0];
        const assigned = Array.from(setClause.matchAll(/(?<![.\w])status\s*=\s*'(\w+)'/g)).map((x) => x[1]);
        for (const st of assigned) {
          found.push(`${f}:${st}`);
          if (open.has(st)) continue;                                  // 미완료로 바꾸는 것(멈춤 · 되살리기)
          expect(setClause, `${f} status='${st}' = 종결인데 끝난 시각이 없다`).toMatch(/completed_at\s*=/);
        }
      }
    }
    // 종결 · 멈춤 · 되살리기 자리가 실제로 뽑혔다(뽑기가 죽으면 위 단언이 빈 통과가 된다)
    expect(found.filter((x) => x.endsWith(':ended')).length).toBeGreaterThanOrEqual(7);
    expect(found.filter((x) => x.endsWith(':goal_met')).length).toBeGreaterThanOrEqual(2);
    expect(found).toContain('utils/journey-pause-handler.ts:paused');
    expect(found).toContain('utils/journey-entry-replace.ts:ended');
  });
  it('감시 묶음 넣기 가드 = 뽑기와 같은 값(max(계약 최솟값, 저장 대기일)) · 한 번만 들어오는 시작 = 조각 없음', () => {
    const w = stripComments(be('utils/journey-trigger-watcher.ts'));
    expect(w).toContain('const reentryGuard = j.allow_reentry && !entersOncePerCustomer(j.trigger_event)');
    expect(w).toContain("? `AND ${reentryHoldSql('je', reentryWaitDays(reentryFloorDays(j.trigger_event), j.reentry_cooldown_days))}` : ``;");
    // 교체 = 진행 중 닫기 바로 뒤에 멈춘 실행 닫기(같은 반복 안)
    const sf = sfOf('utils/journey-trigger-watcher.ts');
    const calls: string[] = [];
    const walk = (x: ts.Node): void => {
      if (ts.isCallExpression(x) && x.arguments.length > 0 && ts.isIdentifier(x.arguments[0]) && /^CLOSE_(ACTIVE|PAUSED)_FOR_REPLACEMENT_SQL$/.test(x.arguments[0].text)) calls.push(x.arguments[0].text);
      ts.forEachChild(x, walk);
    };
    walk(sf);
    expect(calls).toEqual(['CLOSE_ACTIVE_FOR_REPLACEMENT_SQL', 'CLOSE_PAUSED_FOR_REPLACEMENT_SQL']);
  });
});

describe('T2 R12 — 자동 재진입 워커는 여정 값을 잠금 안에서만 읽는다', () => {
  const sf = sfOf('utils/journey-reentry-worker.ts');
  const fn = fnNode(sf, 'runReentryBatch');
  /** 함수 안의 호출 중 SQL 글자를 첫 인자로 받는 것 = [부른 이름, SQL] */
  const sqlCalls: Array<[string, string]> = [];
  const walk = (x: ts.Node): void => {
    if (ts.isCallExpression(x) && x.arguments.length > 0) {
      const a = x.arguments[0];
      if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) || ts.isTemplateExpression(a)) sqlCalls.push([x.expression.getText(sf), a.getText(sf)]);
    }
    ts.forEachChild(x, walk);
  };
  walk(fn);
  it('목록 문장 = id · 회사만 고른다(전역 query 로 읽는 여정 문장은 이것 하나)', () => {
    const globalJourneys = sqlCalls.filter(([callee, sql]) => callee === 'query' && /FROM\s+journeys\b/i.test(sql));
    expect(globalJourneys).toHaveLength(1);
    const cols = /SELECT([\s\S]*?)FROM\s+journeys/i.exec(globalJourneys[0][1])![1].replace(/\s+/g, ' ').trim();
    expect(cols).toBe('id, company_id');
  });
  it('여정 행 · 첫 칸 = 넣기 트랜잭션 연결(client)로 읽고 여정 행은 FOR UPDATE', () => {
    const rowReads = sqlCalls.filter(([, sql]) => /SELECT[\s\S]*FROM\s+journeys\b/i.test(sql) && /reentry_cooldown_days/.test(sql));
    expect(rowReads).toHaveLength(1);
    expect(rowReads[0][0]).toBe('client.query');
    expect(rowReads[0][1]).toMatch(/FOR UPDATE/);
    for (const col of ['allow_reentry', 'auto_reentry_enabled', 'reentry_cooldown_days', 'threshold_recipients_per_step', 'trigger_event', 'trigger_filters']) expect(rowReads[0][1]).toContain(col);
    const stepReads = sqlCalls.filter(([, sql]) => /FROM\s+journey_steps\b/i.test(sql));
    expect(stepReads).toHaveLength(1);
    expect(stepReads[0][0]).toBe('client.query');
    // 전역 query 로 여정 설정 · 칸을 읽는 호출 0(목록 하나뿐)
    expect(sqlCalls.filter(([callee, sql]) => callee === 'query' && /journey_steps|reentry_cooldown_days|trigger_event|threshold_recipients/.test(sql))).toEqual([]);
  });
  it('관문의 대기일 = max(자동 최솟값, 저장 대기일) · 목표 달성 자격 바인드는 저장값 그대로', () => {
    const k = stripComments(be('utils/journey-reentry-worker.ts'));
    expect(k).toContain("const holdDays = reentryWaitDays(autoReentryFloorDays(String(j.trigger_event || '')), j.reentry_cooldown_days);");
    expect(k).toContain("AND ${reentryHoldSql('je2', holdDays)}");
    expect(k).toContain("AND (je.status = 'completed' OR (je.status = 'goal_met' AND $2 > 0))");
    expect(k).toContain('[companyId, cooldownDays, pickLimit, lineage]');
    expect(k).toContain('if (!j || j.auto_reentry_enabled !== true || j.allow_reentry !== true) throw new EntryClosedSkip();');
  });
});

// ════════════════════════════════════════════════════════════════════
// T3 · T5 — 여정 AI 글의 변수 꼴
// ════════════════════════════════════════════════════════════════════
const VIP = "{% if customer.grade == 'VIP' %}20% 할인 안내입니다.{% endif %}";

describe('D5 journeyNewCopy = C122 ④ 변환 그대로', () => {
  it('같은 결과', () => {
    for (const t of ["{{ customer.name | default: '고객' }}님, 안녕하세요.", '%고객명%님', "앞{% if a %}X{% else %}Y{% endif %}뒤", "{{ customer.name }}님, {{ cart.product_name }} 상품"]) {
      expect(journeyNewCopy(t)).toBe(liquidCopyToPercent(t, CUSTOMER_LIQUID_TO_PERCENT));
    }
  });
});

describe('D5 journeyRevisedCopy — 고치기 = 원문 보존 · 쓸 수 없는 안 = null', () => {
  it('① 둘 다 템플릿 문법 없음 = 글자 그대로', () => {
    expect(journeyRevisedCopy('%고객명%님, 생일 축하드려요.', '%고객명%님, 생일 축하합니다')).toBe('%고객명%님, 생일 축하드려요.');
    expect(journeyRevisedCopy('새 글', '')).toBe('새 글');
  });
  it('③ 원문에 없던 아는 고객 변수 = %변수% · 모르는 칸 = null', () => {
    expect(journeyRevisedCopy("{{ customer.name | default: '고객' }}님, 생일 축하드려요.", '%고객명%님, 생일 축하합니다')).toBe('%고객명%님, 생일 축하드려요.');
    expect(journeyRevisedCopy('{{customer.grade}} 회원님', '회원님 안내')).toBe('%고객등급% 회원님');
    expect(journeyRevisedCopy("{{ customer.click_score | default: '친구' }}님", '안내')).toBeNull();
    // 빈 원문(빈 칸 다듬기) + 승인 혜택 = 변수만 바꿔 적고 통과(조각 대조 없음 · Codex 설계 4R #3)
    expect(journeyRevisedCopy('{{ customer.name }}님, 20% 할인 안내입니다.', '')).toBe('%고객명%님, 20% 할인 안내입니다.');
    expect(journeyRevisedCopy('%고객명%님, 20% 할인 안내입니다.', '')).toBe('%고객명%님, 20% 할인 안내입니다.');
  });
  it('④ 새 조건문 = null(평문으로 접지 않는다) · 원문 혜택을 if 로 감쌈 = null · 빈 원문도 같음', () => {
    expect(journeyRevisedCopy("안내{% if customer.grade == 'VIP' %} VIP 전용{% endif %}", '안내드립니다')).toBeNull();
    expect(journeyRevisedCopy(`확인해주세요. ${VIP}`, '20% 할인 안내입니다. 확인해주세요.')).toBeNull();
    expect(journeyRevisedCopy(`새 소식입니다. ${VIP}`, '')).toBeNull();
    expect(journeyRevisedCopy('{% assign x = 1 %}안내', '안내')).toBeNull();
  });
  it('② 원문에 조건 태그 = 글자 그대로 같을 때만(삭제 · 갈래 맞바꾸기 · 조건식 공백 · 밖에 문장 추가 · 기한 이동 전부 null)', () => {
    const two = "{% if customer.grade == 'VIP' %}VIP 20% 할인{% else %}일반 10% 할인{% endif %}";
    expect(journeyRevisedCopy(VIP, VIP)).toBe(VIP);
    expect(journeyRevisedCopy('20% 할인 안내입니다.', VIP)).toBeNull();                                                          // 태그 통째 삭제(평문 결과)
    expect(journeyRevisedCopy("{% if customer.grade == 'VIP' %}일반 10% 할인{% else %}VIP 20% 할인{% endif %}", two)).toBeNull();   // 갈래 맞바꾸기
    expect(journeyRevisedCopy("{% if customer.grade == 'VIP 회원' %}20% 할인{% endif %}", "{% if customer.grade == 'VIP  회원' %}20% 할인{% endif %}")).toBeNull();   // 따옴표 안 공백
    expect(journeyRevisedCopy(`20% 할인 안내드립니다. ${VIP}`, VIP)).toBeNull();                                                  // 조건 밖에 같은 혜택 추가
    expect(journeyRevisedCopy("{% if customer.grade == 'VIP' %}소식을 기다려 주세요.{% else %}11월까지 신청하세요.{% endif %}",
      "{% if customer.grade == 'VIP' %}11월까지 신청하세요.{% else %}소식을 기다려 주세요.{% endif %}")).toBeNull();          // 이번 달 기한의 갈래 이동
    expect(journeyRevisedCopy("{% if customer.grade == 'VIP' %}20% 할인 안내드려요.{% endif %}", VIP)).toBeNull();                // 갈래 안 말만 바꿈
    expect(hasLiquidTags(VIP)).toBe(true);
    expect(hasLiquidTags('{{ cart.product_name }}')).toBe(false);
    expect(hasLiquidTags('본문{% if a %}')).toBe(true);
    expect(hasLiquidTags('{{ 닫히지 않음')).toBe(true);                                                                            // 파서가 못 읽는 원문 = 고치지 않는 쪽
    expect(hasLiquidTags('%고객명%님')).toBe(false);
  });
  it('④ 출력만 있는 원문 = 출력 순서열이 글자 그대로 같아야 한다(주변 글은 고칠 수 있다)', () => {
    const cart = '{{ cart.product_name }} 상품이 장바구니에 있어요. {{ cart.product_url }}';
    expect(journeyRevisedCopy('담아 두신 {{ cart.product_name }} 상품을 잊지 않으셨죠? {{ cart.product_url }}', cart)).toBe('담아 두신 {{ cart.product_name }} 상품을 잊지 않으셨죠? {{ cart.product_url }}');
    expect(journeyRevisedCopy('담아 두신 상품을 잊지 않으셨죠? {{ cart.product_url }}', cart)).toBeNull();                                  // 출력 삭제
    expect(journeyRevisedCopy('{{ cart.product_name }} {{ cart.product_name }} {{ cart.product_url }}', cart)).toBeNull();               // 하나 더 씀
    expect(journeyRevisedCopy('{{ cart.product_url }} 에서 {{ cart.product_name }}', cart)).toBeNull();                                 // 순서 바꿈
    expect(journeyRevisedCopy("{{ cart.product_name | default: '상품' }} 상품 {{ cart.product_url }}", cart)).toBeNull();                 // 필터 글자 바꿈
    expect(journeyRevisedCopy('장바구니 상품이 있어요.', cart)).toBeNull();                                                              // 평문 결과(출력 전부 삭제)
    // 옛 여정: 원문에 글자 그대로 있던 고객 변수 출력은 그대로 둔다 · 새로 생긴 같은 칸은 %변수% 가 돼 순서열이 달라지지 않는다
    const old = "{{ customer.name | default: '고객' }}님, 안녕하세요.";
    expect(journeyRevisedCopy("{{ customer.name | default: '고객' }}님, 반갑습니다.", old)).toBe("{{ customer.name | default: '고객' }}님, 반갑습니다.");
    expect(journeyRevisedCopy('고객님, 반갑습니다.', old)).toBeNull();
  });
  it('⑤ 파서가 못 읽는 글 = null', () => {
    expect(journeyRevisedCopy('본문 {{ customer.name', '본문')).toBeNull();
    expect(journeyRevisedCopy('본문{% if a %}', '본문')).toBeNull();
  });
  it('출구 직전 최종 대조 = 바꿀 것 없이 그대로 지나야 한다', () => {
    expect(journeyRevisedKept('%고객명%님 안내', '%고객명%님')).toBe(true);
    expect(journeyRevisedKept('{{ customer.name }}님 안내', '%고객명%님')).toBe(false);     // 한 번 더 바꿔 적을 것이 남음
    expect(journeyRevisedKept("{% if a %}x{% endif %}", '안내')).toBe(false);
    expect(journeyRevisedKept(VIP, VIP)).toBe(true);
    expect(journeyRevisedKept(VIP.replace('안내', '안 내'), VIP)).toBe(false);
  });
});

describe('T5 계약 — 여정 AI 글 출구의 생산자 이름 = 알려진 집합 · 변환 직접 호출 = 변수 꼴 CT 하나', () => {
  it('finishCopy · finishMany 를 부르는 생산자 이름(구문 트리)', () => {
    const names = new Set<string>();
    for (const f of SRC_FILES) {
      const sf = sfOf(f);
      const walk = (x: ts.Node): void => {
        if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && (x.expression.text === 'finishCopy' || x.expression.text === 'finishMany')) {
          for (const a of x.arguments) {
            if (!ts.isObjectLiteralExpression(a)) continue;
            for (const p of a.properties) {
              if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'producer') {
                expect(ts.isStringLiteral(p.initializer), `${f} 생산자 이름 = 글자열 리터럴`).toBe(true);
                names.add((p.initializer as ts.StringLiteral).text);
              }
            }
          }
        }
        ts.forEachChild(x, walk);
      };
      walk(sf);
    }
    // 'decorate' = AI 오퍼레이터 꾸미기(캠페인 문안 · 여정 아님 · 같은 출구를 쓴다 · 그 글의 템플릿 문법 관문은 이번 범위 밖 = 설계서 §9 #8)
    expect([...names].sort()).toEqual([
      'decorate', 'journey-ai-edit', 'journey-anchor-plan', 'journey-custom-steps', 'journey-next-step',
      'journey-package', 'journey-pretest-regen', 'journey-step-refine', 'variant-generator',
    ]);
  });
  it('liquidCopyToPercent 를 부르는 운영 파일 = journey-ai-copy.ts 하나 · 변수 꼴 CT 를 부르는 생산자 파일', () => {
    const callersOf = (name: string) => SRC_FILES.filter((f) => {
      const sf = sfOf(f);
      let n = 0;
      const walk = (x: ts.Node): void => { if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === name) n++; ts.forEachChild(x, walk); };
      walk(sf);
      return n > 0;
    }).sort();
    expect(callersOf('liquidCopyToPercent')).toEqual(['utils/journey-ai-copy.ts']);
    expect(callersOf('journeyNewCopy')).toEqual(['utils/journey-ai-generator.ts', 'utils/journey-builder.ts', 'utils/journey-step-diagnosis.ts']);
    expect(callersOf('journeyRevisedCopy')).toEqual(['utils/journey-ai-copy.ts', 'utils/journey-ai-editor.ts', 'utils/journey-ai-generator.ts', 'utils/variant-generator.ts']);
    expect(callersOf('journeyRevisedKept')).toEqual(['utils/journey-ai-editor.ts', 'utils/journey-ai-generator.ts', 'utils/variant-generator.ts']);
  });
});

// ── 생산자 결과(가짜 AI) ─────────────────────────────────────────────
const CO = '11111111-1111-1111-1111-111111111111';
const LIQ_NAME = "{{ customer.name | default: '고객' }}";
const ZW = '​';

describe('T5 생산자 결과 — 칸 다듬기', () => {
  const refine = (currentMessage: string, messages: string[], extra: Record<string, unknown> = {}) => {
    aiMock.mockResolvedValue(JSON.stringify({ candidates: messages.map((message) => ({ message, tone: '감성적', reasoning: 'r' })) }));
    return refineStepMessage({ companyId: CO, currentMessage, channel: 'lms', isAd: false, ...extra } as any);
  };
  it('원문 %고객명% + AI 가 템플릿 변수로 답함 = %고객명% · 새 조건문이 든 안 = 없음', async () => {
    const r = await refine('%고객명%님, 생일 축하합니다. 좋은 하루 보내세요.', [
      `${LIQ_NAME}님, 생일을 진심으로 축하드려요. 좋은 하루 보내세요.`,
      "%고객명%님, 생일 축하드려요.{% if customer.grade == 'VIP' %} VIP 고객님께 감사드려요.{% endif %}",
    ]);
    expect(r.candidates.map((c) => c.message)).toEqual(['%고객명%님, 생일을 진심으로 축하드려요. 좋은 하루 보내세요.']);
    expect(r.candidates.every((c) => !detectLiquidSyntax(c.message))).toBe(true);
  });
  it('원문 혜택 문장을 if 로 감싼 안 = 없음(평문으로 접어 혜택이 지워진 글이 나가지 않는다)', async () => {
    const r = await refine('20% 할인 안내입니다. 확인해 주세요.', [`확인해 주세요. ${VIP}`]);
    expect(r.candidates).toEqual([]);
  });
  it('조건 태그가 든 원문 = AI 를 부르지 않고 안내(과금 래퍼 진입 전)', async () => {
    await expect(refine(VIP, ['아무 글'])).rejects.toThrow(LIQUID_TAG_NOTICE);
    expect(aiMock).not.toHaveBeenCalled();
  });
  it('빈 칸 다듬기: 승인 혜택을 if 안에 넣은 답 = 후보 0 · 변수만 템플릿으로 쓴 답 = %고객명% 후보', async () => {
    const journey = { triggerLabel: '생일', objective: '생일 축하' };
    const none = await refine('', [`새 소식입니다. ${VIP}`], { journey });
    expect(none.candidates).toEqual([]);
    const ok = await refine('', ['{{ customer.name }}님, 생일을 축하드려요. 좋은 하루 보내세요.'], { journey });
    expect(ok.candidates.map((c) => c.message)).toEqual(['%고객명%님, 생일을 축하드려요. 좋은 하루 보내세요.']);
  });
  it('출구 직전 최종 대조: `{` 와 `%` 사이 보이지 않는 글자(정리 뒤 새 태그) = 그 안 없음', async () => {
    const r = await refine('%고객명%님, 생일 축하합니다. 좋은 하루 보내세요.', [`%고객명%님, 생일 축하드려요.{${ZW}% if customer.grade == 'VIP' %} VIP 감사{${ZW}% endif %} 좋은 하루 보내세요.`]);
    expect(r.candidates.every((c) => !detectLiquidSyntax(c.message))).toBe(true);
    expect(r.candidates).toEqual([]);
  });
  it('출구 직전 최종 대조: 회사 이름(전송자 명칭)에 템플릿 문법 = 명칭이 붙은 글은 나가지 않는다', async () => {
    dbRows.company = { company_name: '{{ customer.name }}', brand_name: null };
    aiMock.mockResolvedValue(JSON.stringify({ candidates: [{ message: '%고객명%님, 가을 신상품이 들어왔어요. 지금 만나 보세요.', tone: '감성적', reasoning: 'r' }] }));
    const r = await refineStepMessage({ companyId: CO, currentMessage: '%고객명%님, 가을 신상품 안내입니다. 만나 보세요.', channel: 'lms', isAd: true } as any);
    expect(r.candidates).toEqual([]);
  });
});

describe('T5 생산자 결과 — 스팸 재작성(사람 검토 없이 실발송 판을 바꾸는 길)', () => {
  const regen = (currentMessage: string, reply: string, isAd = false) => {
    aiMock.mockResolvedValue(reply);
    return regenerateStepAvoidingSpam({ companyId: CO, currentMessage, channel: 'lms', isAd, matchedStopWords: ['특가'] });
  };
  it('원문에 없던 아는 변수 = %변수% · 새 조건문 = null(자동 교체 없음)', async () => {
    expect(await regen('%고객명%님, 가을 신상품 안내입니다. 만나 보세요.', `${LIQ_NAME}님, 가을 신상품 안내입니다. 만나 보세요.`)).toBe('%고객명%님, 가을 신상품 안내입니다. 만나 보세요.');
    expect(await regen('%고객명%님, 가을 신상품 안내입니다. 만나 보세요.', "%고객명%님, 가을 신상품 안내입니다.{% if customer.grade == 'VIP' %} 만나 보세요.{% endif %}")).toBeNull();
  });
  it('조건 태그가 든 원문 = AI 를 부르지 않고 null', async () => {
    expect(await regen(VIP, '20% 할인 안내입니다.')).toBeNull();
    expect(aiMock).not.toHaveBeenCalled();
  });
  it('출구 직전 최종 대조: 회사 이름에 템플릿 문법 = null', async () => {
    dbRows.company = { company_name: '{{ customer.name }}', brand_name: null };
    expect(await regen('%고객명%님, 가을 신상품 안내입니다. 만나 보세요.', '%고객명%님, 가을 신상품 안내입니다. 만나 보세요.', true)).toBeNull();
  });
});

describe('T5 생산자 결과 — A/B 문안', () => {
  const BASE = '%고객명%님, 가을 신상품이 들어왔어요. 지금 만나 보세요.';
  const variants = (baseMessage: string, bodies: string[]) => {
    aiMock.mockResolvedValue(JSON.stringify({ variants: bodies.map((messageTemplate, i) => ({ tone: ['감성적', '실용적', '캐주얼'][i % 3], messageTemplate, reasoning: 'r' })) }));
    return generateVariantsFromMessage({ stepId: 's1', companyId: CO, baseMessage, channel: 'lms', isAd: true });
  };
  it('원문에 없던 아는 변수 = %변수% · 새 조건문이 든 문안 = 없음', async () => {
    const r = await variants(BASE, [
      `${LIQ_NAME}님, 가을 신상품이 도착했어요. 지금 만나 보세요.`,
      "%고객명%님, 가을 신상품이 들어왔어요.{% if customer.grade == 'VIP' %} 지금 만나 보세요.{% endif %}",
    ]);
    expect(r.variants.map((v) => v.messageTemplate)).toEqual(['%고객명%님, 가을 신상품이 도착했어요. 지금 만나 보세요.']);
  });
  it('조건 태그가 든 기준 문안 = AI 를 부르지 않고 안내', async () => {
    const r = await variants(`${VIP} 지금 확인해 보세요.`, ['아무 글이나 열 글자 이상']);
    expect(r.variants).toEqual([]);
    expect(r.warnings).toEqual([LIQUID_TAG_NOTICE]);
    expect(aiMock).not.toHaveBeenCalled();
  });
  it('출구 직전 최종 대조: 정리 뒤 새 태그가 되는 문안 = 없음', async () => {
    const r = await variants(BASE, [`%고객명%님, 가을 신상품이 들어왔어요.{${ZW}% if customer.grade == 'VIP' %} 지금 만나 보세요.{${ZW}% endif %}`]);
    expect(r.variants.every((v) => !detectLiquidSyntax(v.messageTemplate))).toBe(true);
    expect(r.variants).toEqual([]);
  });
});

describe('T5 생산자 결과 — AI 수정(패키지)', () => {
  const step = (order: number, messageTemplate: string, over: Record<string, unknown> = {}) =>
    ({ stepOrder: order, stepType: 'message', channel: 'lms', delayHours: 0, subject: '가을 소식', messageTemplate, isAd: false, ...over });
  const edit = (current: any[], next: any[]) => {
    const pkg: any = { name: '가을', templateCode: 'repeat', triggerEvent: 'cdp.purchase', steps: current };
    aiMock.mockResolvedValue(JSON.stringify({ ...pkg, steps: next, reasoning: '수정' }));
    return editJourneyPackage({ companyId: CO, currentPackage: pkg, instruction: '말투를 더 정중하게' }) as Promise<any>;
  };
  const PLAIN = '%고객명%님, 가을 신상품이 들어왔어요.';
  it('문법 없는 패키지: 새 아는 변수 = %변수% · 새 조건문 = 미적용', async () => {
    const ok = await edit([step(1, PLAIN)], [step(1, `${LIQ_NAME}님, 가을 신상품이 도착했습니다.`)]);
    expect(ok.steps[0].messageTemplate).toBe('%고객명%님, 가을 신상품이 도착했습니다.');
    await expect(edit([step(1, PLAIN)], [step(1, "%고객명%님, 가을 신상품.{% if customer.grade == 'VIP' %} VIP 전용{% endif %}")])).rejects.toThrow(/변수 표기/);
    await expect(edit([step(1, PLAIN)], [step(1, PLAIN, { subject: "{% if a %}가을{% endif %} 소식" })])).rejects.toThrow(/변수 표기/);   // 제목도 같다
  });
  it('문법 있는 패키지: 칸 수가 달라짐 = 미적용 · 조건 태그가 든 칸은 글자 그대로 · 다른 칸은 고칠 수 있다', async () => {
    const A = "{% if customer.grade == 'VIP' %}VIP 20% 할인{% else %}일반 10% 할인{% endif %}";
    const B = "{% if customer.grade == 'VIP' %}VIP 10% 할인{% else %}일반 20% 할인{% endif %}";
    await expect(edit([step(1, A), step(2, PLAIN)], [step(1, A), step(2, PLAIN), step(3, '새 칸입니다. 확인해 주세요.')])).rejects.toThrow(/칸 수/);
    // 같은 뼈대의 두 칸에서 A 를 B 와 같게 바꾼 답 = 미적용(자기 자리 칸과 대조)
    await expect(edit([step(1, A), step(2, B)], [step(1, B), step(2, B)])).rejects.toThrow(/조건문이 든 칸/);
    const ok = await edit([step(1, A), step(2, PLAIN)], [step(1, A), step(2, '%고객명%님, 가을 신상품이 도착했습니다.')]);
    expect(ok.steps[0].messageTemplate).toBe(A);
    expect(ok.steps[1].messageTemplate).toBe('%고객명%님, 가을 신상품이 도착했습니다.');
  });
  it('결과 칸의 종류 · 채널을 바꿔도 원래 칸의 템플릿 문법이 든 글은 지워지지 않는다(대기 · 조건 · 카카오로 바꾼 답 = 미적용 · Codex 구현 1R)', async () => {
    const A = "{% if customer.grade == 'VIP' %}VIP 20% 할인{% else %}일반 10% 할인{% endif %}";
    const CART = '{{ cart.product_name }} 상품이 장바구니에 있어요.';
    const WAIT = (order: number) => ({ stepOrder: order, stepType: 'wait', delayHours: 24 });
    await expect(edit([step(1, A), step(2, PLAIN)], [WAIT(1), step(2, PLAIN)])).rejects.toThrow(/조건문이 든 칸/);
    await expect(edit([step(1, PLAIN), step(2, A), step(3, PLAIN)], [step(1, PLAIN), { stepOrder: 2, stepType: 'condition', conditionJsonb: { type: 'purchased' } }, step(3, PLAIN)])).rejects.toThrow(/조건문이 든 칸/);
    await expect(edit([step(1, CART), step(2, PLAIN)], [WAIT(1), step(2, PLAIN)])).rejects.toThrow(/조건문이 든 칸/);                       // 변수 출력만 든 칸도 같다
    await expect(edit([step(1, PLAIN, { subject: "{% if a %}가을{% endif %} 소식" }), step(2, PLAIN)], [WAIT(1), step(2, PLAIN)])).rejects.toThrow(/조건문이 든 칸/);   // 제목에만 있던 경우
    // ★ 1111 C129 D7 — 문자 칸을 알림톡으로 바꾼 답은 알림톡 칸 규칙이 먼저 막는다(AI 는 알림톡 칸을 새로 만들 수 없다)
    await expect(edit([step(1, A), step(2, PLAIN)], [step(1, '카카오 본문입니다.', { channel: 'kakao' }), step(2, PLAIN)])).rejects.toThrow(/알림톡 칸은 AI 로/);
    // 템플릿 문법이 없던 문자 칸의 종류를 바꾸는 것은 그대로 된다(다른 칸의 조건문은 글자 그대로)
    const ok = await edit([step(1, A), step(2, PLAIN), step(3, PLAIN)], [step(1, A), WAIT(2), step(3, PLAIN)]);
    expect(ok.steps[0].messageTemplate).toBe(A);
    expect(ok.steps[1].stepType).toBe('wait');
  });
  it('조건값에 연속 공백이 든 원래 칸을 그대로 돌려줘도 글자 정리로 달라지면 미적용', async () => {
    const SP = "{% if customer.grade == 'VIP   A' %}VIP 안내{% endif %}";
    await expect(edit([step(1, SP)], [step(1, SP)])).rejects.toThrow(/조건문이 든 칸/);
  });
  it('출구 직전 최종 대조: 회사 이름(전송자 명칭)에 템플릿 문법 = AI 가 새로 쓴 광고 칸에 명칭이 붙으면 미적용', async () => {
    dbRows.company = { company_name: '{{ customer.name }}', brand_name: null };
    await expect(edit([step(1, PLAIN, { isAd: true })], [step(1, '%고객명%님, 가을 신상품이 도착했습니다.', { isAd: true })])).rejects.toThrow(/변수 표기/);
    dbRows.company = { company_name: '가을상점', brand_name: null };
    const ok = await edit([step(1, PLAIN, { isAd: true })], [step(1, '%고객명%님, 가을 신상품이 도착했습니다.', { isAd: true })]);
    expect(ok.steps[0].messageTemplate).toBe('[가을상점]\n%고객명%님, 가을 신상품이 도착했습니다.');
  });
});
