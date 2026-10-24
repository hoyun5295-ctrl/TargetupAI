/**
 * 여정 결함 0 (★ 2026-10-23) — Codex 적대 1라운드 9건
 *   F1 사람이 한 줄로 말한 대상 조건은 시작 사건이 정해져도 남는다 · F2 질문표에서 비운 혜택은 목표문으로 되살아나지 않는다
 *   F3 결과를 모르는 요청 = 같은 요청 키로 다시 시도 · F4 마지막 날 = 차감 전 칸 확인 + 초안 INSERT 한 번에
 *   F5 날짜축 계획 = 같은 요청 같은 결과(잔액 검사 전) · F6 완료 = 한 문장 · 1회 발송 끝남 = 정리 워커 한 곳
 *   F7~F9 지도 = 보는 사람 범위(붙이기 점검 · 머리 요약 · 목표 달성 캐시)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  pool: { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(), getKoreanCalendar: vi.fn(() => '') }));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: vi.fn(async () => '') }));
vi.mock('../brand-voice-prompt', () => ({ buildSystemPromptWithBrandVoice: vi.fn(async (_c: string, s: string) => s) }));
vi.mock('../company-data-profile', () => ({ getCompanyDataProfile: vi.fn(async () => null), formatProfileForAiPrompt: vi.fn(() => '') }));
vi.mock('../ai-credit', () => ({ checkCredit: vi.fn(async () => undefined), deductCreditOutcome: vi.fn(async () => 'deducted'), isChargedByKey: vi.fn(async () => false) }));
const store = new Map<string, string>();
vi.mock('../../config/defaults', async (orig) => ({
  ...(await orig<typeof import('../../config/defaults')>()),
  redis: { get: vi.fn(async (k: string) => store.get(k) ?? null), set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }) },
}));

import { callAIWithFallback } from '../../services/ai';
import { checkCredit, deductCreditOutcome, isChargedByKey } from '../ai-credit';
import { generateJourneyPackage, generateAnchorJourneyPlan } from '../journey-ai-generator';
import { sanitizeInterviewPlans } from '../journey-interview';
import { RequestKeys } from '../../../../frontend/src/utils/request-id';

const ai = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;
const COMPANY = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const SRC = resolve(__dirname, '../..');
const FE = resolve(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8');
const fe = (p: string) => readFileSync(resolve(FE, p), 'utf8');

const pkgResponse = (message: string, filters: Record<string, any>) => JSON.stringify({
  name: '가입 환영', templateCode: 'onboarding', triggerEvent: 'customer.created', triggerFilters: filters,
  steps: [{ stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', subject: '반가워요', messageTemplate: message, isAd: true, stepIntent: '인사' }],
  allowReentry: false, reentryCooldownDays: null, budgetMonthlyHint: null, thresholdCostHint: null, reasoning: '시험', unsupportedConditions: [],
});

beforeEach(() => {
  ai.mockReset();
  store.clear();
  (checkCredit as any).mockClear();
  (deductCreditOutcome as any).mockReset();
  (deductCreditOutcome as any).mockResolvedValue('deducted');
  (isChargedByKey as any).mockReset();
  (isChargedByKey as any).mockResolvedValue(false);
});

describe('F1 · F2 질문표 길 = 사람이 확정한 대상 · 혜택만', () => {
  const said = { recent_hours: 24, made_up: true, logic: 'AND', customer_conditions: [{ field: 'region', op: '==', value: '서울' }, { field: 'gender', op: '==', value: '여성' }] };

  it('한 줄이 말한 대상 조건 = 시작 사건이 정해져도 남는다(성별 = 표준 코드) · 그 밖의 필터는 비운다', async () => {
    ai.mockResolvedValue(pkgResponse('%고객명%님, 가입을 환영해요.', said));
    const pkg = await generateJourneyPackage({ companyId: COMPANY, createdBy: USER, objective: '가입한 고객을 반긴다', preferTriggerEvent: 'customer.created', audienceLine: '서울 여성 신규 가입자에게 환영 문자' });
    expect(pkg.triggerFilters).toEqual({ logic: 'AND', customer_conditions: [{ field: 'region', op: '==', value: '서울' }, { field: 'gender', op: '==', value: 'F' }] });
    expect(pkg.targetSummary).toContain('서울');
    // AI 에게도 사람이 쓴 한 줄이 간다(해석 AI 가 옮긴 목표문만 보지 않는다)
    expect(String(ai.mock.calls[0][0].userMessage)).toContain('서울 여성 신규 가입자에게 환영 문자');
  });

  it('한 줄이 없는 입구(카드 · 빠른 시작) = 조건을 비운다(0808 그대로)', async () => {
    ai.mockResolvedValue(pkgResponse('%고객명%님, 가입을 환영해요.', said));
    const pkg = await generateJourneyPackage({ companyId: COMPANY, createdBy: USER, objective: '가입한 고객을 반긴다', preferTriggerEvent: 'customer.created' });
    expect(pkg.triggerFilters).toEqual({});
  });

  it('혜택 = null(질문표에서 비움) → 목표문의 혜택도 근거가 아니다 · undefined 는 옛 하위호환', async () => {
    ai.mockResolvedValue(pkgResponse('%고객명%님, 가입 고객 10% 쿠폰을 드려요.', {}));
    const cleared = await generateJourneyPackage({ companyId: COMPANY, createdBy: USER, objective: '가입 고객에게 10% 쿠폰', preferTriggerEvent: 'customer.created', benefitText: null });
    expect(cleared.steps[0].messageTemplate).not.toContain('10%');
    expect(cleared.steps[0].messageTemplate).toContain('[혜택 안내: 직접 수정해주세요]');
    expect(String(ai.mock.calls[0][0].system)).not.toContain('사용자가 목표문에 직접 적은 구체 혜택은 창작이 아닙니다');
    ai.mockClear();
    const legacy = await generateJourneyPackage({ companyId: COMPANY, createdBy: USER, objective: '가입 고객에게 10% 쿠폰', preferTriggerEvent: 'customer.created' });
    expect(legacy.steps[0].messageTemplate).toContain('10%');
  });

  it('계획은 사람이 쓴 한 줄을 들고 다닌다(화면 → 서버 그대로) · 질문표 길이 넘긴다', () => {
    const [p] = sanitizeInterviewPlans({ plans: [{ triggerEvent: 'customer.created', title: '가입 환영', objective: '반긴다', sentence: '  서울 여성 가입자에게  ' }] });
    expect(p.sentence).toBe('서울 여성 가입자에게');
    const [q] = sanitizeInterviewPlans({ plans: [{ triggerEvent: 'customer.created', title: '가입 환영', objective: '반긴다' }] });
    expect(q.sentence).toBeUndefined();
    const ia = read('utils/journey-interview-ai.ts');
    expect(ia).toContain('plans: plans.map((p) => ({ ...p, sentence: said }))');
    expect(ia).toContain('audienceLine: plan.sentence,');
    expect(ia).toContain('benefitText: spec.benefitText,');
    expect(read('routes/ai.ts')).toContain("sentence: String(plan.sentence || '') }");
  });
});

describe('F4 마지막 날 = 차감 전 칸 확인 · 초안 INSERT 한 번에', () => {
  it('칸이 없으면 차감 전에 막는다(503) · 저장 뒤 따로 쓰는 UPDATE 0', () => {
    const ia = read('utils/journey-interview-ai.ts');
    const gate = ia.indexOf('if (spec.entryEndsOn && !(await entryEndsColumnReady())) {');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(ia.indexOf('await checkCredit(input.companyId, cost);'));
    expect(ia.slice(gate, gate + 300)).toContain('throw new JourneyMigrationPendingError(');
    expect(ia).not.toMatch(/UPDATE journeys SET entry_ends_on/);
    expect(ia).toContain('entryEndsOn: spec.entryEndsOn,');
    expect(read('utils/journey-draft-save.ts')).toContain('entryEndsOn: opts.entryEndsOn || null,');
    const b = read('utils/journey-builder.ts');
    expect(b).toContain("goal_exit_enabled, goal_kind,${input.entryEndsOn ? ' entry_ends_on,' : ''}");
    expect(b).toContain("$21, $22,${input.entryEndsOn ? ' $23::date,' : ''}");
    expect(b).toContain('...(input.entryEndsOn ? [input.entryEndsOn] : []),');
  });
});

describe('F5 날짜축 계획 = 같은 요청 같은 결과', () => {
  const stepJson = JSON.stringify({ subject: '곧 소멸돼요', message: '%고객명%님, 포인트가 곧 소멸돼요.' });

  it('같은 요청 키 재시도 = 보관한 결과 그대로(AI · 잔액 검사 · 차감 다시 안 함)', async () => {
    ai.mockResolvedValue(stepJson);
    const rid = '33333333-3333-4333-8333-333333333333';
    const a = await generateAnchorJourneyPlan({ companyId: COMPANY, objective: '포인트 소멸 7일전 당일', requestId: rid });
    expect(a.steps.length).toBe(2);
    const aiCalls = ai.mock.calls.length;
    const b = await generateAnchorJourneyPlan({ companyId: COMPANY, objective: '포인트 소멸 7일전 당일', requestId: rid });
    expect(b).toEqual(a);
    expect(ai.mock.calls.length).toBe(aiCalls);
    expect((checkCredit as any).mock.calls.length).toBe(1);
    const charge = (deductCreditOutcome as any).mock.calls[0][0];
    expect(charge.idempotencyKey).toMatch(new RegExp(`^journey-anchor-plan:${COMPANY}:${rid}:[0-9a-f]{16}$`));
    expect(charge.throwOnInsufficient).toBe(true);   // 사전 확인 뒤 잔액 소진 = 402(무과금 결과 0)
  });

  it('같은 요청 키라도 목표문이 다르면 새 요청(새 키 · 잔액 검사 · 새 차감) · 낸 키로 다른 입력을 만들 수 없다(2R)', async () => {
    ai.mockResolvedValue(stepJson);
    const rid = '66666666-6666-4666-8666-666666666666';
    await generateAnchorJourneyPlan({ companyId: COMPANY, objective: '포인트 소멸 당일', requestId: rid });
    (isChargedByKey as any).mockImplementation(async (_c: string, k: string) => k === (deductCreditOutcome as any).mock.calls[0][0].idempotencyKey);
    await generateAnchorJourneyPlan({ companyId: COMPANY, objective: '포인트 소멸 7일전 3일전 당일', requestId: rid });
    const keys = (deductCreditOutcome as any).mock.calls.map((c: any[]) => c[0].idempotencyKey);
    expect(keys.length).toBe(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect((checkCredit as any).mock.calls.length).toBe(2);   // 두 번째도 잔액 검사(낸 키의 생략을 받지 않는다)
  });

  it('차감이 안 된 결과(failed)는 보관하지 않는다 → 같은 키 재시도가 다시 정산한다(2R)', async () => {
    ai.mockResolvedValue(stepJson);
    (deductCreditOutcome as any).mockResolvedValueOnce('failed');
    const rid = '77777777-7777-4777-8777-777777777777';
    await generateAnchorJourneyPlan({ companyId: COMPANY, objective: '포인트 소멸 당일', requestId: rid });
    await generateAnchorJourneyPlan({ companyId: COMPANY, objective: '포인트 소멸 당일', requestId: rid });
    expect((deductCreditOutcome as any).mock.calls.length).toBe(2);
    expect(ai.mock.calls.length).toBe(2);
  });

  it('보관이 없어도 이미 낸 요청이면 잔액 검사 없이 만든다(낸 결과를 잔액 부족으로 막지 않는다)', async () => {
    ai.mockResolvedValue(stepJson);
    (isChargedByKey as any).mockResolvedValue(true);
    await generateAnchorJourneyPlan({ companyId: COMPANY, objective: '포인트 소멸 당일', requestId: '44444444-4444-4444-8444-444444444444' });
    expect((checkCredit as any).mock.calls.length).toBe(0);
  });

  it('동시에 온 같은 요청 = 한 번 만든다', async () => {
    ai.mockResolvedValue(stepJson);
    const rid = '55555555-5555-4555-8555-555555555555';
    const [x, y] = await Promise.all([
      generateAnchorJourneyPlan({ companyId: COMPANY, objective: '포인트 소멸 당일', requestId: rid }),
      generateAnchorJourneyPlan({ companyId: COMPANY, objective: '포인트 소멸 당일', requestId: rid }),
    ]);
    expect(x).toEqual(y);
    expect(ai.mock.calls.length).toBe(1);
  });
});

describe('F6 완료 = 한 문장 · 1회 발송 끝남 = 한 곳', () => {
  it('실행 완료 · 끝 칸 기록 · 여정 통계가 한 SQL 문장', () => {
    const ex = read('utils/journey-executor.ts');
    const fn = ex.slice(ex.indexOf('async function finishExecution('), ex.indexOf('async function hasPurchasedSinceEntry('));
    expect((fn.match(/await query\(/g) || []).length).toBe(1);
    expect(fn).toContain('end_log AS (');
    expect(fn).toContain('UPDATE journeys j SET');
    expect(fn).not.toContain('logSkippedStep');
  });
  it('1회 발송 끝남 = 감시 워커 정리(endDrainedVersions) 한 곳 · 실행기 안에서 따로 끝내지 않는다', () => {
    expect(read('utils/journey-executor.ts')).not.toMatch(/UPDATE journeys SET status = 'ended'/);
    const l = read('utils/journey-lineage.ts');
    const fn = l.slice(l.indexOf('export async function endDrainedVersions('));
    expect(fn).toContain("(j.start_kind = 'one_shot' AND EXISTS (SELECT 1 FROM journey_executions x WHERE x.journey_id = j.id))");
    expect(fn).toContain("AND NOT EXISTS (SELECT 1 FROM journey_executions e WHERE e.journey_id = j.id AND e.status = 'active')");
  });
});

describe('F3 결과를 모르는 요청 = 같은 키로 다시 시도', () => {
  const m = fe('components/journey/map/InterviewModal.tsx');
  it('못 만든 것만 같은 요청 키로 다시 · 다 만들었을 때만 보관을 지운다 · 결과를 모르면 새 요청을 열지 않는다', () => {
    expect(m).toContain('const build = async (only?: string[]) => {');
    expect(m).toContain('if (made.length === targets.length) clearStore();');
    expect(m).toContain('onClick={() => void build(retryKeys)}');
    expect(m).toContain('{!unsure && <button type="button" onClick={restart}');
    expect(m).toContain("unknown: x.unknown || res.status >= 500 || res.status === 409");   // 2R: 결과 모름은 다시 시도의 사전 거절로 풀리지 않는다
    expect(m).toContain("const d = await res.json().catch(() => null);");                     // 2R: 본문을 못 읽으면 결과 모름
    expect(m).toContain("if (d === null) throw new Error(");
    expect(m).not.toContain("unknown: undefined");
    expect(m).toContain("const unsure = progress.some((p) => p.unknown);");   // 3R: 앞 행 402 로 대기에 남은 결과 모름도 새 요청을 막는다
    // 3R · 4R: 날짜축 요청 키 = 목표마다 하나(RequestKeys CT) · 그 목표의 결과를 받을 때만 지운다
    const page = fe('pages/JourneysPage.tsx');
    expect(page).toContain('const reqId = anchorKeys.current.keyFor(objective);');
    expect((page.match(/anchorKeys\.current\.settled\(/g) || []).length).toBe(1);
    expect(page.slice(page.indexOf('anchorKeys.current.settled(') - 40, page.indexOf('anchorKeys.current.settled('))).toContain('if (data.success)');
    expect(page).not.toContain('anchorReqRef');
  });

  it('요청 키 CT: 실패 · 결과 모름이면 같은 키 · 다른 입력의 성공은 이 키를 지우지 않는다(A 끊김 → B 성공 → A 재시도 = A 처음 키 · 4R)', () => {
    const keys = new RequestKeys();
    const a1 = keys.keyFor('포인트 소멸 7일전 당일');
    const b1 = keys.keyFor('행사 3일전');
    expect(b1).not.toBe(a1);
    keys.settled('행사 3일전');                                  // B 성공
    expect(keys.keyFor(' 포인트 소멸 7일전 당일 ')).toBe(a1);    // A 재시도 = 처음 키(공백 정리는 서버 해시와 같다)
    expect(keys.keyFor('행사 3일전')).not.toBe(b1);              // B 는 결과를 받았다 = 다음은 새 요청
    keys.settled('포인트 소멸 7일전 당일');
    expect(keys.keyFor('포인트 소멸 7일전 당일')).not.toBe(a1);
    // 다시 시도는 interviewId 를 새로 만들지 않는다(새 키는 질문표를 새로 받을 때만)
    expect((m.match(/setInterviewId\(newRequestId\(\)\)/g) || []).length).toBe(1);
  });
});

describe('F7~F9 지도 = 보는 사람 범위', () => {
  it('붙이기 점검 = 보는 사람 지도 · 머리 요약 = 보이는 여정만 · 목표 달성 캐시 = 여정 집합까지 키', () => {
    const r = read('routes/ai.ts');
    const chk = r.slice(r.indexOf("router.get('/operator/journeys-attach-check'"), r.indexOf("router.get('/operator/journeys-opportunities'"));
    expect(chk).toContain('buildLifecycleMap(companyId, gate.userId)');
    const map = read('utils/journey-lifecycle-map.ts');
    expect(map).toContain("const cacheKey = `${companyId}|${scopeSql}|${[...journeyIds].sort().join(',')}`;");
    expect(map).toContain("${ownerOnly ? ' AND e.journey_id = ANY($2::uuid[])' : ''}");
    expect(map).toContain('[...credits].filter(([root]) => !ownerOnly || visibleRoots.has(root))');
  });
});
