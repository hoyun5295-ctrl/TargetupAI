/**
 * 자동 마케팅 [제안 받기] = 미리보기 (★ 2026-10-05 · 설계서 docs/2026-10-05-automarketing-preview-design.md §2)
 *
 * 접수: 한 줄을 넣고 [제안 받기]를 누르자 제안을 보기도 전에 200 크레딧 확인 창(등록 = 가동).
 * 계약: 미리보기 = 등록 없이 첫 회차와 같은 계산 · 5크레딧(대상 0명 = 0) → [시작] = 보관한 입력 그대로 등록(200) + 본 제안 = 첫 회차.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const orchestrateMock = vi.fn();
const createOperatorMock = vi.fn();
const generateMock = vi.fn();
const loadCtxMock = vi.fn();
const buildCtxMock = vi.fn((op: any) => ({ built: true, op }));
const suggestMock = vi.fn();
const assertUsableMock = vi.fn();
const explainMock = vi.fn();
const findOpenMock = vi.fn();

vi.mock('../../services/ai-orchestrator', () => ({ orchestrate: (...a: any[]) => orchestrateMock(...a) }));
vi.mock('../../services/ai', () => ({ suggestSegmentForObjective: (...a: any[]) => suggestMock(...a) }));
vi.mock('../operator-audience', () => ({
  listSegmentAvailability: async () => [{ key: 'vip', label: 'VIP 고객', available: true }, { key: 'changed_grade', label: '등급이 바뀐 고객', available: true }],
  assertSegmentUsable: (...a: any[]) => assertUsableMock(...a),
}));
vi.mock('../automarketing-segment', () => ({ segmentNeedsCycleBaseline: (k: any) => k === 'changed_grade' }));
vi.mock('../ai-credit-calc', () => ({ getCreditCost: (s: string) => (s === 'ai-operator-propose' ? 5 : s === 'continuous-operator' ? 200 : 0) }));
vi.mock('../ai-credit', () => ({ InsufficientCreditError: class InsufficientCreditError extends Error {} }));
vi.mock('../continuous-operator', () => ({
  createOperator: (...a: any[]) => createOperatorMock(...a),
  generateProposalForOperator: (...a: any[]) => generateMock(...a),
  explainEmptyRound: (...a: any[]) => explainMock(...a),
  findOpenProposalForOperator: (...a: any[]) => findOpenMock(...a),
  loadOperatorCompanyContext: (...a: any[]) => loadCtxMock(...a),
  buildOperatorOrchestrateContext: (...a: any[]) => buildCtxMock(...(a as [any])),
  // 검증 · 정규화는 실제 규칙의 요지만(실제 함수 동일성은 아래 원문 계약이 고정한다)
  validateOperatorInput: (input: any) => {
    if (!input.name || !input.objective) throw new Error('name과 objective는 필수입니다.');
    if (input.objective.trim().length < 5) throw new Error('objective는 5자 이상 입력해주세요.');
    return { schedule: 'daily', scheduleTime: '09:00', scheduleMonth: null };
  },
  operatorContextFields: (input: any) => {
    if (input.segmentKey === 'bogus') throw new Error('알 수 없는 발송 대상 축입니다: bogus');
    return {
      companyId: input.companyId, createdBy: input.createdBy, objective: input.objective.trim(),
      copyStyle: null, channel: 'lms', benefitContent: null, targetHint: null,
      segmentKey: input.segmentKey ?? null, segmentParams: input.segmentParams ?? null,
    };
  },
}));

import {
  runOperatorPreview, startOperatorFromPreview, takePreview, PreviewBusyError, PreviewInputError,
  __resetPreviewStoreForTest, __agePreviewForTest, START_STATE_UNKNOWN_MESSAGE,
} from '../automarketing-preview';
import { InsufficientCreditError } from '../ai-credit';

const CO = 'company-1';
const US = 'user-1';
const BODY = { name: '90일 넘게 안 산 고객', objective: '90일 넘게 안 산 고객을 매주 월요일에 다시 불러와줘', schedule: 'daily', schedule_time: '09:00', channel: 'lms' };
const RESULT = { target: { count: 120, criteria: 'VIP 고객' }, messages: [{ body: 'A' }, { body: 'B' }, { body: 'C' }], meta: {} };

beforeEach(() => {
  __resetPreviewStoreForTest();
  [orchestrateMock, createOperatorMock, generateMock, loadCtxMock, buildCtxMock, suggestMock, assertUsableMock, explainMock, findOpenMock].forEach((m) => m.mockReset());
  findOpenMock.mockResolvedValue(null);
  explainMock.mockResolvedValue('0건 매칭 또는 생성 실패. 제안서가 생성되지 않았습니다.');
  buildCtxMock.mockImplementation((op: any) => ({ built: true, op }));
  loadCtxMock.mockResolvedValue({ ctx: {}, companyInfo: {}, customerStats: {} });
  suggestMock.mockResolvedValue(null);
});

describe('1. 미리보기 = 등록 0 · 허브와 같은 키 5 · 대상 0명 차감 0', () => {
  it('오케스트레이터를 ai-operator-propose · 5 · chargeOnlyWithTarget 로 부르고 등록은 하지 않는다', async () => {
    orchestrateMock.mockResolvedValue(RESULT);
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out.kind).toBe('proposal');
    expect(out.previewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.proposal).toBe(RESULT);
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(orchestrateMock.mock.calls[0][1]).toEqual({ source: 'ai-operator-propose', cost: 5, chargeOnlyWithTarget: true });
    // 문맥은 회차 생성과 같은 함수 · 등록 전이라 id = null
    expect(buildCtxMock.mock.calls[0][0]).toMatchObject({ id: null, companyId: CO, createdBy: US });
    expect(createOperatorMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('대상 0명 = 보관하지 않는다(시작 불가) · 사유만 돌려준다', async () => {
    orchestrateMock.mockResolvedValue({ target: { count: 0 }, messages: [{ body: 'A' }], meta: { countError: '담당 매장이 지정되지 않아 발송 대상을 정할 수 없습니다.' } });
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'zero', previewId: null, proposal: null, reason: '담당 매장이 지정되지 않아 발송 대상을 정할 수 없습니다.' });
  });

  it('문안 0개 = 오류(빈 제안을 첫 회차로 보관하지 않는다)', async () => {
    orchestrateMock.mockResolvedValue({ target: { count: 10 }, messages: [], meta: {} });
    await expect(runOperatorPreview(CO, US, BODY)).rejects.toThrow('문안 생성 결과 없음');
  });

  it('등록이 거절할 입력은 AI 를 부르기 전에 400 으로 거른다(돈 0)', async () => {
    await expect(runOperatorPreview(CO, US, { ...BODY, objective: '쿠폰' })).rejects.toBeInstanceOf(PreviewInputError);
    expect(orchestrateMock).not.toHaveBeenCalled();
    expect(suggestMock).not.toHaveBeenCalled();
  });

  it('모르는 축 = 400 · AI 0', async () => {
    await expect(runOperatorPreview(CO, US, { ...BODY, segment_key: 'bogus' })).rejects.toBeInstanceOf(PreviewInputError);
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it('변화 축으로 매핑되면 AI 를 부르지 않는다(0크레딧) · 시작은 가능(첫 회차 = 기준선)', async () => {
    suggestMock.mockResolvedValue({ key: 'changed_grade', params: {} });
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out.kind).toBe('baseline');
    expect(out.previewId).toBeTruthy();
    expect(out.appliedSegment).toEqual({ key: 'changed_grade', label: '등급이 바뀐 고객' });
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it('같은 회사 · 같은 사람 동시 요청 = 409(두 번째는 AI 0) · 끝나면 풀린다', async () => {
    let release!: (v: any) => void;
    orchestrateMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const first = runOperatorPreview(CO, US, BODY);
    await new Promise((r) => setTimeout(r, 0));
    await expect(runOperatorPreview(CO, US, BODY)).rejects.toBeInstanceOf(PreviewBusyError);
    // 다른 사람은 막지 않는다
    orchestrateMock.mockResolvedValueOnce(RESULT);
    await expect(runOperatorPreview(CO, 'user-2', BODY)).resolves.toMatchObject({ kind: 'proposal' });
    release(RESULT);
    await first;
    orchestrateMock.mockResolvedValueOnce(RESULT);
    await expect(runOperatorPreview(CO, US, BODY)).resolves.toMatchObject({ kind: 'proposal' });
  });

  it('AI 가 던져도 잠금이 풀린다', async () => {
    orchestrateMock.mockRejectedValueOnce(new Error('boom'));
    await expect(runOperatorPreview(CO, US, BODY)).rejects.toThrow('boom');
    orchestrateMock.mockResolvedValueOnce(RESULT);
    await expect(runOperatorPreview(CO, US, BODY)).resolves.toMatchObject({ kind: 'proposal' });
  });
});

describe('2. 시작 = 미리보기 id 하나 · 보관한 입력 그대로 · 본 제안 = 첫 회차', () => {
  it('보관한 입력으로 등록하고 precomputed 로 첫 회차를 저장한다', async () => {
    suggestMock.mockResolvedValue({ key: 'vip', params: { days: 90 } });
    orchestrateMock.mockResolvedValue(RESULT);
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockResolvedValue({ id: 'prop-1' });
    const started = await startOperatorFromPreview(out.previewId!, CO, US);
    expect(createOperatorMock).toHaveBeenCalledTimes(1);
    expect(createOperatorMock.mock.calls[0][0]).toMatchObject({
      companyId: CO, createdBy: US, objective: BODY.objective, segmentKey: 'vip', segmentParams: { days: 90 },
    });
    expect(generateMock).toHaveBeenCalledWith('op-1', { precomputed: RESULT });
    expect(started).toMatchObject({ proposal: { id: 'prop-1' }, message: null, appliedSegment: { key: 'vip', label: 'VIP 고객' } });
    expect(orchestrateMock).toHaveBeenCalledTimes(1);   // 다시 만들지 않는다
  });

  it('같은 미리보기로 두 번 시작할 수 없다(두 번째 = null → 410)', async () => {
    orchestrateMock.mockResolvedValue(RESULT);
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockResolvedValue({ id: 'prop-1' });
    const [a, b] = await Promise.all([startOperatorFromPreview(out.previewId!, CO, US), startOperatorFromPreview(out.previewId!, CO, US)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(createOperatorMock).toHaveBeenCalledTimes(1);
  });

  it('다른 회사 · 다른 사람 · 없는 id · 만료 = null(등록 0) · 남의 요청은 주인 것을 지우지 않는다', async () => {
    orchestrateMock.mockResolvedValue(RESULT);
    const out = await runOperatorPreview(CO, US, BODY);
    expect(await startOperatorFromPreview(out.previewId!, 'company-2', US)).toBeNull();
    expect(await startOperatorFromPreview(out.previewId!, CO, 'user-2')).toBeNull();
    expect(await startOperatorFromPreview('nope', CO, US)).toBeNull();
    expect(createOperatorMock).not.toHaveBeenCalled();
    __agePreviewForTest(out.previewId!, 31 * 60 * 1000);
    expect(await startOperatorFromPreview(out.previewId!, CO, US)).toBeNull();
    expect(createOperatorMock).not.toHaveBeenCalled();
  });

  it('잔액 부족(INSERT 전 사전 확인)이면 보관본을 되돌린다 → 충전 뒤 다시 누르면 등록된다', async () => {
    orchestrateMock.mockResolvedValue(RESULT);
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockRejectedValueOnce(new (InsufficientCreditError as any)('insufficient'));
    await expect(startOperatorFromPreview(out.previewId!, CO, US)).rejects.toThrow('insufficient');
    createOperatorMock.mockResolvedValueOnce({ id: 'op-1' });
    generateMock.mockResolvedValueOnce({ id: 'prop-1' });
    await expect(startOperatorFromPreview(out.previewId!, CO, US)).resolves.toMatchObject({ proposal: { id: 'prop-1' } });
  });

  it('그 밖의 등록 실패(INSERT 커밋 여부 모름)는 되돌리지 않는다 — 같은 미리보기로 두 번째 활성 등록 금지(Codex 1R high)', async () => {
    orchestrateMock.mockResolvedValue(RESULT);
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(startOperatorFromPreview(out.previewId!, CO, US)).rejects.toThrow('connection terminated');
    createOperatorMock.mockResolvedValueOnce({ id: 'op-2' });
    expect(await startOperatorFromPreview(out.previewId!, CO, US)).toBeNull();
    expect(createOperatorMock).toHaveBeenCalledTimes(1);
  });

  it('첫 회차 저장이 던져도 등록 결과를 돌려준다(500 → 다시 누름 → 두 번 등록 방지)', async () => {
    orchestrateMock.mockResolvedValue(RESULT);
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockRejectedValueOnce(new Error('db'));
    const started = await startOperatorFromPreview(out.previewId!, CO, US);
    expect(started?.operator).toEqual({ id: 'op-1' });
    expect(started?.proposal).toBeNull();
    expect(findOpenMock).toHaveBeenCalledWith('op-1', CO);
    expect(explainMock).toHaveBeenCalledWith('op-1', CO);
    expect(started?.message).toBe('0건 매칭 또는 생성 실패. 제안서가 생성되지 않았습니다.');
    expect(takePreview(out.previewId!, CO, US)).toBeNull();   // 등록이 끝난 미리보기는 남지 않는다
  });

  it('저장 뒤 후속 단계가 던져도 행이 있으면 저장된 회차로 돌려준다(반환값 대신 저장 상태 · Codex 1R)', async () => {
    orchestrateMock.mockResolvedValue(RESULT);
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockRejectedValueOnce(new Error('variants insert failed'));
    findOpenMock.mockResolvedValueOnce({ id: 'prop-saved' });
    const started = await startOperatorFromPreview(out.previewId!, CO, US);
    expect(started).toMatchObject({ proposal: { id: 'prop-saved' }, message: null });
    expect(explainMock).not.toHaveBeenCalled();
  });

  it('저장 상태 재조회가 실패하면 「만들지 못했다」고 단정하지 않는다(Codex 2R)', async () => {
    orchestrateMock.mockResolvedValue(RESULT);
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockRejectedValueOnce(new Error('db down'));
    findOpenMock.mockRejectedValueOnce(new Error('db down'));
    const started = await startOperatorFromPreview(out.previewId!, CO, US);
    expect(started?.operator).toEqual({ id: 'op-1' });
    expect(started?.proposal).toBeNull();
    expect(started?.message).toBe(START_STATE_UNKNOWN_MESSAGE);
    expect(explainMock).not.toHaveBeenCalled();
  });

  it('변화 축 시작 = precomputed 없이 회차 생성 · 안내는 저장 상태로 판정(기준선 실패를 성공으로 말하지 않는다)', async () => {
    suggestMock.mockResolvedValue({ key: 'changed_grade', params: {} });
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-9' });
    generateMock.mockResolvedValue(null);
    explainMock.mockResolvedValueOnce('비교 기준을 잡았습니다. 지난번과 달라진 고객이 생기면 다음 회차부터 대상으로 잡힙니다.');
    const started = await startOperatorFromPreview(out.previewId!, CO, US);
    expect(generateMock).toHaveBeenCalledWith('op-9', undefined);
    expect(explainMock).toHaveBeenCalledWith('op-9', CO);
    expect(started?.message).toContain('비교 기준을 잡았습니다');
  });
});

describe('3. 원문 계약 — 같은 함수 · 과금 조건 · 라우트', () => {
  const co = readFileSync(join(__dirname, '..', 'continuous-operator.ts'), 'utf8');
  const orch = readFileSync(join(__dirname, '..', '..', 'services', 'ai-orchestrator.ts'), 'utf8');
  const routes = readFileSync(join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf8');
  const pv = readFileSync(join(__dirname, '..', 'automarketing-preview.ts'), 'utf8');

  it('회차 생성 = 미리보기와 같은 문맥 함수 · precomputed 가 없으면 지금과 같은 호출', () => {
    expect(co).toContain('orchestratorResult = opts?.precomputed\n      ?? await orchestrate(buildOperatorOrchestrateContext({ ...operator, id: operator.id }, loaded), { source: \'continuous-operator\', cost: 0 });');
    expect(co).toContain('const loaded = await loadOperatorCompanyContext(operator.companyId);');
    expect(pv).toContain('buildOperatorOrchestrateContext({ ...fields, id: null }, loaded)');
  });

  it('등록 = 미리보기와 같은 검증 · 같은 축 정규화 · 같은 채널 · 혜택 정규화', () => {
    const create = co.slice(co.indexOf('export async function createOperator('), co.indexOf('export async function listOperators('));
    expect(create).toContain('const { schedule, scheduleTime, scheduleMonth } = validateOperatorInput(input);');
    expect(create).toContain('const { segKey, segParams } = normalizeOperatorSegment(input);');
    expect(create).toContain('const channel = normalizeOperatorChannel(input.channel);');
    expect(create).toContain('const benefitContent = normalizeOperatorBenefit(input.benefitContent);');
    expect(create).toContain('scheduleMonth, segKey ? null : targetHint,');
    const fieldsFn = co.slice(co.indexOf('export function operatorContextFields('), co.indexOf('export function operatorContextFields(') + 900);
    expect(fieldsFn).toContain('normalizeOperatorSegment(input)');
    expect(fieldsFn).toContain('targetHint: segKey ? null : normalizeTargetHint(input.targetHint),');
  });

  it('미리보기로 만든 첫 회차는 자율 발송 판정에서 빠진다(묵은 대상 수로 자동 예약 금지 · Codex 1R)', () => {
    expect(co).toContain('const autoExecuteEligible =\n    !opts?.precomputed &&\n    ctx.cdp_auto_execute_enabled &&');
    expect(co).toContain("opts?.precomputed && '미리보기로 만든 첫 회차(담당자 승인 뒤 발송)',");
  });

  it('빈 회차 사유 = run-now 와 미리보기 시작이 같은 함수 · 되돌림은 잔액 부족만', () => {
    const runNow = routes.slice(routes.indexOf("router.post('/operator/continuous/:id/run-now', "), routes.indexOf("// Proposals — 사용자 검토/승인/거부"));
    expect(runNow).toContain('message: await explainEmptyRound(req.params.id, companyId)');
    expect(runNow).not.toContain('hasCycleBaseline');
    expect(pv).toContain('if (!proposal) message = await explainEmptyRound(operator.id, companyId);');
    expect(pv).not.toContain('findOpenProposalForOperator(operator.id, companyId).catch(');
    expect(pv).toContain('if (e instanceof InsufficientCreditError) previews.set(previewId, entry);');
    const explain = co.slice(co.indexOf('export async function explainEmptyRound('), co.indexOf('export async function findOpenProposalForOperator('));
    expect(explain.indexOf("status = 'scheduled'")).toBeLessThan(explain.indexOf('hasCycleBaseline'));   // 예약 확인이 기준선 안내보다 먼저(0805)
  });

  it('orchestrate 과금 = 지정한 호출만 대상 0명 차감 0 · 지정 안 한 호출은 지금 그대로', () => {
    expect(orch).toContain("if ((result.messages?.length ?? 0) > 0 && (!creditOpts?.chargeOnlyWithTarget || (result.target?.count ?? 0) > 0)) {");
  });

  it('등록 라우트 = 옮긴 함수 · 미리보기 · 시작 라우트 = 요금제 게이트 · 시작은 preview_id 만 읽는다', () => {
    const create = routes.slice(routes.indexOf("router.post('/operator/continuous', "), routes.indexOf("router.post('/operator/continuous/preview', "));
    expect(create).toContain('const seg = await resolveRegistrationSegment(companyId, userId, req.body);');
    expect(create).toContain('...createOperatorInputFromBody(companyId, userId, req.body),');
    expect(create).toContain('const mapped = operatorSaveErrorResponse(err);');
    const preview = routes.slice(routes.indexOf("router.post('/operator/continuous/preview', "), routes.indexOf("router.post('/operator/continuous/from-preview', "));
    expect(preview).toContain('isAiOperatorAllowed(planCtx, req.user)');
    expect(preview).toContain('runOperatorPreview(companyId, userId, req.body)');
    const start = routes.slice(routes.indexOf("router.post('/operator/continuous/from-preview', "), routes.indexOf("router.get('/operator/continuous', "));
    expect(start).toContain('isAiOperatorAllowed(planCtx, req.user)');
    expect(start).toContain("const previewId = typeof req.body?.preview_id === 'string' ? req.body.preview_id : '';");
    expect(start).toContain("res.status(410)");
    expect(start.replace(/req\.body\??\.preview_id/g, '')).not.toMatch(/req\.body/);
  });
});

describe('4. 화면 배선 — 한 줄 = 미리보기 · 시작 = 200 확인 뒤 id 하나', () => {
  const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
  const page = readFileSync(join(FE, 'pages', 'ContinuousOperatorPage.tsx'), 'utf8');
  const modal = readFileSync(join(FE, 'components', 'automarketing', 'OperatorPreviewModal.tsx'), 'utf8');
  const feCredit = readFileSync(join(FE, 'constants', 'credit.ts'), 'utf8');
  const beCredit = readFileSync(join(__dirname, '..', 'ai-credit-calc.ts'), 'utf8');

  it('한 줄 · 자세히 쓰기 = 미리보기 요청(200 확인 창으로 바로 가지 않는다)', () => {
    const fn = page.slice(page.indexOf('const handleNaturalSubmit = '), page.indexOf('const requestPreview = '));
    expect(fn).toContain('requestPreview({ ...SMART_DEFAULTS, name: goal.slice(0, 40), objective: goal, copyStyle });');
    expect(fn).not.toContain('setPendingConfig');
    expect(page).toContain("fetch('/api/ai/operator/continuous/preview', {");
    expect(page).toContain('onSubmit: () => handleNaturalSubmit(line.trim(), null),');
    expect(page).toContain('<NaturalLanguageStart submitting={creating || previewing} onSubmit={handleNaturalSubmit} />');
  });

  it('시작 = 200 확인 창 → 미리보기 id 하나만 보낸다', () => {
    expect(page).toContain('onStart={() => setStartConfirm(true)}');
    expect(page).toMatch(/<CreditConfirmModal\s+open=\{startConfirm\}\s+source="continuous-operator"/);
    expect(page).toContain('onConfirm={() => { setStartConfirm(false); startFromPreview(); }}');
    expect(page).toContain("body: JSON.stringify({ preview_id: id }),");
  });

  it('늦게 온 미리보기는 버린다(닫기 = 세대 증가) · 대상 0명은 시작 버튼이 없다', () => {
    const req = page.slice(page.indexOf('const requestPreview = '), page.indexOf('const closePreview = '));
    expect(req.match(/if \(gen !== previewGen\.current\) return;/g)?.length).toBe(2);
    expect(page.slice(page.indexOf('const closePreview = '), page.indexOf('const editFromPreview = '))).toContain('previewGen.current += 1;');
    expect(modal).toContain("const canStart = !loading && !!data && data.kind !== 'zero' && !!data.previewId;");
    expect(modal).toContain("{data?.kind !== 'zero' && (");
  });

  it('버튼 금액 = 서버 단가 미러(제안 받기 5 · 시작 200)', () => {
    const be = Number(beCredit.match(/'ai-operator-propose':\s*(\d+)/)?.[1]);
    const fe = Number(feCredit.match(/'ai-operator-propose':\s*(\d+)/)?.[1]);
    expect(be).toBe(5);
    expect(fe).toBe(be);
    expect(page).toContain("credit: `${AI_GENERATE_COSTS['ai-operator-propose']}크레딧`,");
    expect(modal).toContain("const startCost = CONFIRM_CREDIT_COSTS['continuous-operator'] ?? 0;");
  });
});
