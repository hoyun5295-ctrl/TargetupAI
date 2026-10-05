/**
 * 자동 마케팅 [제안 받기] = 미리보기 · 창 편집 · 시작 (★ 2026-10-05 · 설계서 docs/2026-10-05-automarketing-preview-design.md
 *   · docs/2026-10-05-automarketing-trust-design.md)
 *
 * 접수 ①: 한 줄 [제안 받기]가 제안을 보기도 전에 200(등록 = 가동).
 * 접수 ②: 생일 쿠폰 자동 마케팅이 생일 데이터가 없는데 전체 고객으로 잡혔다.
 * 계약: 미리보기 = 등록 없이 첫 회차와 같은 계산 · 대상은 번역 module 이 계약으로 고정(막힘 · 고르기 필요 = 시작 불가) ·
 *   AI 문안 5(대상 0명 0) · 직접 쓴 문안 0 · 시작 = 보관본 그대로 등록(200) + 승인 기간 + 본 제안 = 첫 회차.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const orchestrateMock = vi.fn();
const createOperatorMock = vi.fn();
const generateMock = vi.fn();
const loadCtxMock = vi.fn();
const buildCtxMock = vi.fn((op: any) => ({ built: true, op }));
const explainMock = vi.fn();
const findOpenMock = vi.fn();
const translateMock = vi.fn();
const countMock = vi.fn();
const forecastMock = vi.fn();
const approveWindowMock = vi.fn();
const windowMock = vi.fn();

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../../config/defaults', () => ({ getCompanyCosts: () => ({ sms: 10, lms: 30, mms: 60 }) }));
vi.mock('../../services/ai-orchestrator', () => ({ orchestrate: (...a: any[]) => orchestrateMock(...a) }));
vi.mock('../../services/ai', () => ({
  extractVarCatalog: () => ({ fieldMappings: { 이름: {}, 등급: {}, 포인트: {} }, availableVars: ['이름', '등급', '포인트'] }),
  filterVarCatalogByData: async (_c: any, vars: string[]) => { const i = vars.indexOf('포인트'); if (i >= 0) vars.splice(i, 1); },
}));
vi.mock('../automarketing-segment', () => ({ segmentNeedsCycleBaseline: (k: any) => k === 'went_quiet' }));
vi.mock('../ai-credit-calc', () => ({ getCreditCost: (s: string) => (s === 'ai-operator-propose' ? 5 : s === 'continuous-operator' ? 200 : 0) }));
vi.mock('../ai-credit', () => ({ InsufficientCreditError: class InsufficientCreditError extends Error {} }));
vi.mock('../audience-translate', () => ({
  translateAudience: (...a: any[]) => translateMock(...a),
  countContractAudience: (...a: any[]) => countMock(...a),
  forecastByDate: (...a: any[]) => forecastMock(...a),
  describeConditions: (cs: any[]) => cs.map((c) => `${c.label} ${c.value}`).join(' · '),
  AudienceConditionError: class AudienceConditionError extends Error {},
  loadAudienceFieldOptions: async () => ({ options: [{ field: 'custom_fields.custom_3', label: '잔여멤버쉽', kind: 'custom', dataType: 'number', fillCount: 1240, samples: ['3000'] }], zero: [], active: {} }),
}));
vi.mock('../autosend-policy', () => ({
  computeApprovalWindow: (...a: any[]) => windowMock(...a),
  countEmptyRounds: () => 0,
}));
vi.mock('../continuous-operator', () => ({
  createOperator: (...a: any[]) => createOperatorMock(...a),
  generateProposalForOperator: (...a: any[]) => generateMock(...a),
  loadOperatorCompanyContext: (...a: any[]) => loadCtxMock(...a),
  buildOperatorOrchestrateContext: (...a: any[]) => buildCtxMock(...(a as [any])),
  explainEmptyRound: (...a: any[]) => explainMock(...a),
  findOpenProposalForOperator: (...a: any[]) => findOpenMock(...a),
  approveOperatorWindow: (...a: any[]) => approveWindowMock(...a),
  mapRowToOperator: (r: any) => r,
  operatorContract: (op: any) => {
    const key = op.segmentKey || op.targetHint || null;
    if (key) return { key, conditions: null };
    return op.audienceConditions && op.audienceConditions.length > 0 ? { key: null, conditions: op.audienceConditions } : null;
  },
  normalizeOperatorBenefit: (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null),
  normalizeFixedCopyInput: (raw: any) => (raw && typeof raw.body === 'string' && raw.body.trim() ? { subject: String(raw.subject || ''), body: raw.body.trim() } : null),
  validateOperatorInput: (input: any) => {
    if (!input.name || !input.objective) throw new Error('name과 objective는 필수입니다.');
    if (input.objective.trim().length < 5) throw new Error('objective는 5자 이상 입력해주세요.');
    return { schedule: input.schedule || 'daily', scheduleTime: '09:00', scheduleMonth: null };
  },
  operatorContextFields: (input: any) => ({
    companyId: input.companyId, createdBy: input.createdBy, objective: input.objective.trim(),
    copyStyle: null, channel: 'lms', benefitContent: input.benefitContent ?? null, targetHint: null,
    segmentKey: input.segmentKey ?? null, segmentParams: input.segmentParams ?? null,
    audienceConditions: input.audienceConditions ?? null, schedule: input.schedule || 'daily',
  }),
}));

import {
  runOperatorPreview, updateOperatorPreview, startOperatorFromPreview, takePreview, PreviewBusyError, PreviewInputError,
  previewOperatorApproval, approveOperatorFromScreen, PreviewStaleError,
  __resetPreviewStoreForTest, __agePreviewForTest, START_STATE_UNKNOWN_MESSAGE,
} from '../automarketing-preview';
import { InsufficientCreditError } from '../ai-credit';
import { query as dbQuery } from '../../config/database';

const CO = 'company-1';
const US = 'user-1';
const BODY = { name: '생일 축하 쿠폰', objective: '매일 생일인 고객에게 생일 축하 30% 쿠폰 보내줘', schedule: 'daily', schedule_time: '09:00', channel: 'lms' };
const RESULT = { target: { count: 3 }, messages: [{ body: 'A' }, { body: 'B' }, { body: 'C' }], cost: { estimated: 90, unitCost: 30 }, meta: {} };
const AXIS = { kind: 'axis', segmentKey: 'birthday', segmentParams: {}, label: '생일 고객', description: '이번 회차 기간에 생일인 고객', mapped: true };
const WIN = { startAt: new Date('2026-10-06T00:00:00.000Z'), until: new Date('2026-10-12T14:59:59.999Z'), rounds: [new Date('2026-10-06T00:00:00.000Z')] };
const WIN_NEXT = { startAt: new Date('2026-10-07T00:00:00.000Z'), until: new Date('2026-10-13T14:59:59.999Z'), rounds: [new Date('2026-10-07T00:00:00.000Z')] };
const FILTERS = { kind: 'filters', conditions: [{ term: '포인트', field: 'custom_fields.custom_3', label: '잔여멤버쉽', operator: 'gte', value: 1000, source: 'ai' }] };

beforeEach(() => {
  __resetPreviewStoreForTest();
  [orchestrateMock, createOperatorMock, generateMock, loadCtxMock, buildCtxMock, explainMock, findOpenMock,
    translateMock, countMock, forecastMock, approveWindowMock, windowMock].forEach((m) => m.mockReset());
  windowMock.mockReturnValue(WIN);
  buildCtxMock.mockImplementation((op: any) => ({ built: true, op }));
  loadCtxMock.mockResolvedValue({ ctx: { cdp_auto_execute_max_recipients: 1000, cdp_auto_execute_max_cost_krw: 50000 }, companyInfo: { customer_schema: {} }, customerStats: {} });
  translateMock.mockResolvedValue(AXIS);
  forecastMock.mockResolvedValue(null);
  countMock.mockResolvedValue(120);
  orchestrateMock.mockResolvedValue(RESULT);
  findOpenMock.mockResolvedValue(null);
  explainMock.mockResolvedValue('0건 매칭 또는 생성 실패. 제안서가 생성되지 않았습니다.');
  approveWindowMock.mockResolvedValue({ until: new Date('2026-10-12T14:59:59.999Z'), startAt: new Date('2026-10-06T00:00:00.000Z'), rounds: [] });
});

describe('1. 미리보기 = 등록 0 · 대상은 번역 결과(계약) · AI 문안 5(대상 0명 0)', () => {
  it('축 계약 · AI 모드 = 허브와 같은 키 5 · chargeOnlyWithTarget · 등록 0', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'proposal', ready: true, count: 120, audience: { mode: 'axis', label: '생일 고객', mapped: true } });
    expect(out.previewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(orchestrateMock.mock.calls[0][1]).toEqual({ source: 'ai-operator-propose', cost: 5, chargeOnlyWithTarget: true });
    expect(buildCtxMock.mock.calls[0][0]).toMatchObject({ id: null, segmentKey: 'birthday' });
    expect(createOperatorMock).not.toHaveBeenCalled();
    expect(out.appliedSegment).toEqual({ key: 'birthday', label: '생일 고객' });
  });

  it('막힘(데이터 없음) = 보관 0 · AI 0 · 시작 불가 · 사유 그대로', async () => {
    translateMock.mockResolvedValueOnce({ kind: 'blocked', code: 'DATA_MISSING', reason: '이 목표는 「생일 고객」에게 보내는 목표인데, 고객 생일 정보가 아직 없어요.' });
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'blocked', previewId: null, ready: false });
    expect(out.reason).toContain('고객 생일 정보가 아직 없어요');
    expect(orchestrateMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
  });

  it('지금 대상 0명(축 · 칸 조건) = 시작 불가 · AI 0 · 보관(기준을 고칠 수 있게)', async () => {
    countMock.mockResolvedValueOnce(0);
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'zero', ready: false, count: 0 });
    expect(out.previewId).toBeTruthy();
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it('생일 · 매일 = 7일 예상이 기준 · 문안은 생일자가 있는 첫날 기준으로 만든다', async () => {
    forecastMock.mockResolvedValueOnce([
      { date: '2026-10-06', count: 0 }, { date: '2026-10-07', count: 2 }, { date: '2026-10-08', count: 1 },
    ]);
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'proposal', ready: true, count: 3 });
    expect(out.forecast?.[0]).toEqual({ date: '2026-10-06', count: 0 });
    expect((buildCtxMock.mock.calls[0][0] as any).anchorAt.toISOString()).toBe('2026-10-07T00:00:00.000Z');
  });

  it('7일 내내 0명 = 미리 보여 줄 문안 없음(차감 0) · 시작은 된다(대상 있는 날 그날 만든다)', async () => {
    forecastMock.mockResolvedValueOnce([{ date: '2026-10-06', count: 0 }, { date: '2026-10-07', count: 0 }]);
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'proposal', ready: true, proposal: null, count: 0 });
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it('고르기 필요 = AI 문안 0 · 시작 불가 → 칸을 고르면(편집) 그때 문안을 만든다', async () => {
    translateMock.mockResolvedValueOnce({ kind: 'needs_choice', conditions: [], unresolved: [{ term: '포인트', operator: 'gte', value: 1 }], options: [{ field: 'custom_fields.custom_3', label: '잔여멤버쉽', kind: 'custom', dataType: 'number', fillCount: 1240, samples: ['3000'] }] });
    const out = await runOperatorPreview(CO, US, { ...BODY, schedule: 'monthly' });
    expect(out).toMatchObject({ kind: 'needs_choice', ready: false });
    expect(out.reason).toContain('「포인트」');
    expect(orchestrateMock).not.toHaveBeenCalled();
    translateMock.mockResolvedValueOnce(FILTERS);
    const after = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, conditions: [{ term: '포인트', field: 'custom_fields.custom_3', operator: 'gte', value: 1000 }] });
    expect(translateMock.mock.calls[1][0]).toMatchObject({ conditions: [{ field: 'custom_fields.custom_3', operator: 'gte', value: 1000 }] });
    expect(translateMock.mock.calls[1][0].carry).toMatchObject({ kind: 'needs_choice', unresolved: [{ term: '포인트' }] });   // 창의 말이 빠지지 않게 번역에 넘긴다
    expect(after?.revision).toBe(1);
    expect(after).toMatchObject({ kind: 'proposal', ready: true, audience: { mode: 'filters' } });
    expect(after?.audience.options.map((o) => o.field)).toEqual(['custom_fields.custom_3']);   // [다른 칸 고르기] 목록
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
  });

  it('직접 쓴 문안 = AI 0(0크레딧) · 값 없는 %칸% 는 시작 불가', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, copy_mode: 'fixed', fixed_body: '%이름%님 생일 축하드려요' });
    expect(out).toMatchObject({ kind: 'proposal', ready: true, copy: { mode: 'fixed', body: '%이름%님 생일 축하드려요' } });
    expect(orchestrateMock).not.toHaveBeenCalled();
    const bad = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, fixed_body: '%포인트% 포인트가 남았어요' });
    expect(bad).toMatchObject({ ready: false });
    expect(bad?.reason).toContain('%포인트%');
    expect(bad?.copy.variables).toEqual(['이름', '등급']);
  });

  it('핵심 혜택을 고치면 AI 문안을 다시 만든다(혜택은 문안에 녹아 있다)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, benefit_content: '30% 쿠폰' });
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, benefit: '40% 쿠폰' });
    expect(orchestrateMock).toHaveBeenCalledTimes(2);
    await updateOperatorPreview(out.previewId!, CO, US, { revision: 1, copy_mode: 'ai' });
    expect(orchestrateMock).toHaveBeenCalledTimes(2);   // 혜택 그대로면 다시 만들지 않는다
  });

  it('등록이 거절할 입력 = 번역 · AI 전에 400', async () => {
    await expect(runOperatorPreview(CO, US, { ...BODY, objective: '쿠폰' })).rejects.toBeInstanceOf(PreviewInputError);
    expect(translateMock).not.toHaveBeenCalled();
  });

  it('같은 회사 · 같은 사람 동시 요청 = 409 · 끝나면 풀린다 · AI 가 던져도 풀린다', async () => {
    let release!: (v: any) => void;
    orchestrateMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const first = runOperatorPreview(CO, US, BODY);
    await new Promise((r) => setTimeout(r, 0));
    await expect(runOperatorPreview(CO, US, BODY)).rejects.toBeInstanceOf(PreviewBusyError);
    await expect(runOperatorPreview(CO, 'user-2', BODY)).resolves.toMatchObject({ kind: 'proposal' });
    release(RESULT);
    await first;
    orchestrateMock.mockRejectedValueOnce(new Error('boom'));
    await expect(runOperatorPreview(CO, US, BODY)).rejects.toThrow('boom');
    await expect(runOperatorPreview(CO, US, BODY)).resolves.toMatchObject({ kind: 'proposal' });
  });
});

describe('2. 시작 = 보관본 그대로 · 서버가 다시 판정(돈 0) · 승인 기간 · 본 제안 = 첫 회차', () => {
  it('보관본(계약 · 문안 분기)으로 등록 → 승인 기간 → precomputed 첫 회차 · 시작 판정 중 AI 0', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockResolvedValue({ id: 'prop-1' });
    const started = await startOperatorFromPreview(out.previewId!, CO, US, 0);
    expect(createOperatorMock.mock.calls[0][0]).toMatchObject({ segmentKey: 'birthday', audienceConditions: null, copyMode: 'ai' });
    expect(approveWindowMock.mock.calls[0][0]).toMatchObject({ companyId: CO, operatorId: 'op-1', userId: US, window: { startAt: WIN.startAt, until: WIN.until } });
    expect(generateMock).toHaveBeenCalledWith('op-1', { precomputed: RESULT });
    expect(started).toMatchObject({ proposal: { id: 'prop-1' }, message: null, approvedUntil: '2026-10-12T14:59:59.999Z' });
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
  });

  it('직접 쓴 문안 = precomputed 없이 첫 회차(회차가 그 문안으로 만든다)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, copy_mode: 'fixed', fixed_body: '%이름%님 생일 축하드려요' });
    createOperatorMock.mockResolvedValue({ id: 'op-2' });
    generateMock.mockResolvedValue({ id: 'prop-2' });
    await startOperatorFromPreview(out.previewId!, CO, US, 0);
    expect(createOperatorMock.mock.calls[0][0]).toMatchObject({ copyMode: 'fixed', fixedCopy: { body: '%이름%님 생일 축하드려요' } });
    expect(generateMock).toHaveBeenCalledWith('op-2', undefined);
  });

  it('시작할 수 없는 상태(0명) = 400 · 등록 0', async () => {
    countMock.mockResolvedValue(0);
    const out = await runOperatorPreview(CO, US, BODY);
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 0)).rejects.toBeInstanceOf(PreviewInputError);
    expect(createOperatorMock).not.toHaveBeenCalled();
  });

  it('시작 판정은 문안을 만들지 않는다 — 보관본에 문안이 없으면 400(AI 0 · 차감 0)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, copy_mode: 'fixed', fixed_body: '생일 축하드려요' });
    orchestrateMock.mockRejectedValueOnce(new Error('AI 일시 오류'));
    await expect(updateOperatorPreview(out.previewId!, CO, US, { revision: 0, copy_mode: 'ai' })).rejects.toThrow('AI 일시 오류');
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 1)).rejects.toBeInstanceOf(PreviewInputError);
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(createOperatorMock).not.toHaveBeenCalled();
  });

  it('발송 시각을 넘겨 승인 기간이 바뀌면 = 판을 올리고 다시 확인 · 저장은 확인받은 기간 그대로(Codex 3R)', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    windowMock.mockReturnValue(WIN_NEXT);   // 창을 연 뒤 오늘 발송 시각이 지났다
    const moved = await startOperatorFromPreview(out.previewId!, CO, US, 0).catch((e) => e);
    expect(moved).toBeInstanceOf(PreviewStaleError);
    expect(moved.message).toContain('승인 기간이 바뀌었어요');
    expect(moved.current).toMatchObject({ revision: 1, window: { startAt: WIN_NEXT.startAt.toISOString() } });
    expect(createOperatorMock).not.toHaveBeenCalled();
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockResolvedValue({ id: 'prop-1' });
    await startOperatorFromPreview(out.previewId!, CO, US, 1);
    expect(approveWindowMock.mock.calls[0][0].window).toMatchObject({ startAt: WIN_NEXT.startAt, until: WIN_NEXT.until });
  });

  it('늦게 온 옛 판 편집이 새 기간을 내보냈으면 = 그 기간을 못 본 판으로는 시작하지 못한다(Codex 4R)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, copy_mode: 'fixed', fixed_body: '생일 축하드려요' });
    await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, fixed_body: '생일 진심으로 축하드려요' });   // 화면 = 판 1 · 기간 A
    windowMock.mockReturnValue(WIN_NEXT);   // 발송 시각이 지났다
    const late = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, fixed_body: '늦게 온 편집' }).catch((e) => e);
    expect(late).toBeInstanceOf(PreviewStaleError);
    expect(late.current).toMatchObject({ revision: 2, window: { startAt: WIN_NEXT.startAt.toISOString() } });
    // 409 응답을 화면이 적용하기 전에 판 1 로 시작 = 기간 B 를 본 적 없는 화면 → 거절
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 1)).rejects.toBeInstanceOf(PreviewStaleError);
    expect(createOperatorMock).not.toHaveBeenCalled();
  });

  it('화면이 본 판이 아니면 시작 · 편집하지 않고 지금 상태를 돌려준다(본 것 = 등록한 것 · Codex 2R)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, copy_mode: 'fixed', fixed_body: '생일 축하드려요' });
    await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, fixed_body: '생일 진심으로 축하드려요' });
    const stale = await startOperatorFromPreview(out.previewId!, CO, US, 0).catch((e) => e);
    expect(stale).toBeInstanceOf(PreviewStaleError);
    expect(stale.current).toMatchObject({ revision: 1, copy: { body: '생일 진심으로 축하드려요' } });
    await expect(updateOperatorPreview(out.previewId!, CO, US, { revision: 0, fixed_body: '옛 화면에서 고침' })).rejects.toBeInstanceOf(PreviewStaleError);
    await expect(startOperatorFromPreview(out.previewId!, CO, US, undefined)).rejects.toBeInstanceOf(PreviewStaleError);   // 판 없음 = 옛 화면
    expect(createOperatorMock).not.toHaveBeenCalled();
  });

  it('승인 기간 저장이 실패해도(DDL 전) 시작은 된다 = 회차마다 승인으로 남는다', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockResolvedValue({ id: 'prop-1' });
    approveWindowMock.mockRejectedValueOnce(new Error('DB 마이그레이션 필요'));
    const started = await startOperatorFromPreview(out.previewId!, CO, US, 0);
    expect(started).toMatchObject({ approvedUntil: null, proposal: { id: 'prop-1' } });
  });

  it('같은 미리보기로 두 번 시작할 수 없다', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockResolvedValue({ id: 'prop-1' });
    const [a, b] = await Promise.allSettled([startOperatorFromPreview(out.previewId!, CO, US, 0), startOperatorFromPreview(out.previewId!, CO, US, 0)]);
    const done = [a, b].filter((r) => r.status === 'fulfilled' && r.value);
    expect(done).toHaveLength(1);
    expect(createOperatorMock).toHaveBeenCalledTimes(1);
  });

  it('다른 회사 · 다른 사람 · 없는 id · 만료 = null(등록 0)', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    expect(await startOperatorFromPreview(out.previewId!, 'company-2', US, 0)).toBeNull();
    expect(await startOperatorFromPreview(out.previewId!, CO, 'user-2', 0)).toBeNull();
    expect(await startOperatorFromPreview('nope', CO, US, 0)).toBeNull();
    __agePreviewForTest(out.previewId!, 31 * 60 * 1000);
    expect(await startOperatorFromPreview(out.previewId!, CO, US, 0)).toBeNull();
    expect(createOperatorMock).not.toHaveBeenCalled();
  });

  it('잔액 부족만 되돌린다 · 그 밖 실패는 되돌리지 않는다(Codex 1R high)', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockRejectedValueOnce(new (InsufficientCreditError as any)('insufficient'));
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 0)).rejects.toThrow('insufficient');
    createOperatorMock.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 0)).rejects.toThrow('connection terminated');
    expect(await startOperatorFromPreview(out.previewId!, CO, US, 0)).toBeNull();
  });

  it('첫 회차 저장이 던지면 저장 상태로 판정 · 재조회 실패 = 「확인하지 못했다」(Codex 1R · 2R)', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    createOperatorMock.mockResolvedValue({ id: 'op-1' });
    generateMock.mockRejectedValueOnce(new Error('db down'));
    findOpenMock.mockRejectedValueOnce(new Error('db down'));
    const started = await startOperatorFromPreview(out.previewId!, CO, US, 0);
    expect(started?.message).toBe(START_STATE_UNKNOWN_MESSAGE);
    expect(explainMock).not.toHaveBeenCalled();
    expect(takePreview(out.previewId!, CO, US)).toBeNull();
  });
});

describe('2-2. 다음 승인 = 창에서 본 계약 그대로 저장(Codex 1R)', () => {
  const OP = {
    id: 'op-9', companyId: CO, createdBy: US, name: '월간 안내', objective: '매월 고객 안내', schedule: 'monthly', scheduleTime: '09:00',
    scheduleDayOfWeek: null, scheduleDayOfMonth: 1, scheduleMonth: null, channel: 'lms', benefitContent: null, copyStyle: null,
    copyMode: 'ai', fixedCopy: null, segmentKey: 'all', segmentParams: null, targetHint: null, audienceConditions: null,
    approvalMeta: null, roundLog: [], approvedUntil: null,
  };
  const VIP = [{ field: 'grade', operator: 'eq', value: 'VIP' }];
  const rowOnce = (op: any) => (dbQuery as any).mockResolvedValueOnce({ rows: [op] });

  const AXIS_ALL = { kind: 'axis', segmentKey: 'all', segmentParams: {}, label: '전체 고객', description: '모든 고객', mapped: false };
  const VIP_FILTERS = { kind: 'filters', conditions: [{ ...VIP[0], label: '등급', term: '등급', source: 'user' }] };

  it('승인 창 = 서버 보관본 · 편집에서 고른 칸이 승인에 그대로 · 승인 때 계약을 다시 정하지 않는다(옛: 저장 때 전체로 되돌아갔다)', async () => {
    translateMock.mockResolvedValueOnce(AXIS_ALL).mockResolvedValueOnce(VIP_FILTERS);
    rowOnce(OP);
    const open = await previewOperatorApproval(CO, 'op-9', US);
    const id = open!.outcome.previewId!;
    expect(open!.outcome).toMatchObject({ revision: 0, audience: { mode: 'axis' } });
    const edited = await updateOperatorPreview(id, CO, US, { revision: 0, conditions: VIP.map((c) => ({ ...c, term: '등급' })) });
    expect(edited).toMatchObject({ revision: 1, audience: { mode: 'filters' } });
    expect(orchestrateMock).not.toHaveBeenCalled();   // 승인 창 = AI 문안 0
    rowOnce(OP);
    const saved = await approveOperatorFromScreen(CO, 'op-9', US, { preview_id: id, revision: 1 });
    expect(saved).toMatchObject({ until: '2026-10-12T14:59:59.999Z' });
    expect(translateMock).toHaveBeenCalledTimes(2);   // 열 때 · 고칠 때만
    expect(approveWindowMock.mock.calls[0][0].contract).toMatchObject({ segmentKey: null, conditions: [{ field: 'grade', value: 'VIP' }] });
    expect(await approveOperatorFromScreen(CO, 'op-9', US, { preview_id: id, revision: 1 })).toBeNull();   // 승인한 창은 끝
    expect(approveWindowMock.mock.calls[0][0].window).toMatchObject({ startAt: WIN.startAt, until: WIN.until });   // 본 기간 그대로
  });

  it('승인 창을 연 뒤 발송 시각이 지나면 = 같은 판으로 다른 기간을 저장하지 않는다(Codex 3R)', async () => {
    translateMock.mockResolvedValueOnce(AXIS_ALL);
    rowOnce(OP);
    const open = await previewOperatorApproval(CO, 'op-9', US);
    const id = open!.outcome.previewId!;
    windowMock.mockReturnValue(WIN_NEXT);
    const moved = await approveOperatorFromScreen(CO, 'op-9', US, { preview_id: id, revision: 0 }).catch((e) => e);
    expect(moved).toBeInstanceOf(PreviewStaleError);
    expect(moved.current).toMatchObject({ revision: 1 });
    expect(approveWindowMock).not.toHaveBeenCalled();
  });

  it('승인 = 화면이 본 판일 때만(다시 세기가 실패했거나 응답을 못 받은 화면) · 다른 운영자의 창 = null', async () => {
    translateMock.mockResolvedValueOnce(AXIS_ALL).mockResolvedValueOnce(VIP_FILTERS);
    rowOnce(OP);
    const open = await previewOperatorApproval(CO, 'op-9', US);
    const id = open!.outcome.previewId!;
    await updateOperatorPreview(id, CO, US, { revision: 0, conditions: VIP.map((c) => ({ ...c, term: '등급' })) });
    const stale = await approveOperatorFromScreen(CO, 'op-9', US, { preview_id: id, revision: 0 }).catch((e) => e);
    expect(stale).toBeInstanceOf(PreviewStaleError);
    expect(stale.current).toMatchObject({ revision: 1, audience: { mode: 'filters' } });
    expect(await approveOperatorFromScreen(CO, 'op-other', US, { preview_id: id, revision: 1 })).toBeNull();
    expect(await startOperatorFromPreview(id, CO, US, 1)).toBeNull();   // 승인 창으로 새 등록을 만들 수 없다
    expect(approveWindowMock).not.toHaveBeenCalled();
  });
});

describe('3. 원문 계약 — 계약만 · 먼저 세기 · 0명 조용히 · 승인 기간 · 직접 쓴 문안', () => {
  const SRC = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
  const co = SRC('utils', 'continuous-operator.ts');
  const orch = SRC('services', 'ai-orchestrator.ts');
  const routes = SRC('routes', 'ai.ts');
  const aud = SRC('utils', 'operator-audience.ts');
  const gen = co.slice(co.indexOf('export async function generateProposalForOperator('), co.indexOf('export async function adminStopProposal('));

  it('회차 = 계약으로 먼저 센다(AI 전) · 계약 없음 = 멈춤 + 알림 · 0명 = 조용히 기록', () => {
    expect(gen.indexOf('const m = await countOperatorAudienceFor({')).toBeLessThan(gen.indexOf('const loaded = await loadOperatorCompanyContext(operator.companyId);'));
    expect(gen).toContain('const contract = operatorContract(operator);');
    expect(gen).toContain('if (!contract) {');
    const zero = gen.slice(gen.indexOf('if (measuredCount === 0) {'), gen.indexOf('if (measuredCount === 0) {') + 400);
    expect(zero).toContain("appendRoundLog(operator.id, { outcome: 'empty', count: 0 })");
    expect(zero).not.toContain('notifyZeroTargetOnce');
  });

  it('자율 자격 = 회사 자율 옵션 또는 승인 기간 · 대상 수는 방금 센 값(미리보기 결과도 덮는다)', () => {
    expect(gen).toContain('const autoExecuteEligible =\n    (companyAuto || approvalActive) &&');
    expect(gen).toContain('const approvalActive = isWithinApprovalWindow(operator.approvedUntil, operator.approvalMeta?.windowStart, scheduledSendAt);');
    expect(gen).toContain('orchestratorResult = withMeasuredCount(opts.precomputed, measuredCount);');
  });

  it('수신자 확정 = 회차의 대상 칸이 지금 계약과 같을 때만 · 계약 저장과 직렬화(Q12 · Codex 1R~3R) · 리마인드(코호트) 제외', () => {
    const disp = co.slice(co.indexOf('async function dispatchProposalSend('), co.indexOf('async function dispatchProposalSend(') + 30000);
    const reminder = disp.indexOf('if (pj.meta?.is_reminder === true) {\n      // 리마인드 = 1차 수신자 코호트');
    const staged = disp.indexOf('const staged = await stageIfContractMatches(p.operator_id, pj.target, insSql, insParams);');
    expect(reminder).toBeGreaterThan(0);
    expect(staged).toBeGreaterThan(reminder);
    expect(disp.slice(staged, staged + 600)).toContain("if (staged == null) {");
    expect(co).not.toContain('gatePj');   // 발송 직전 게이트는 이 한 곳으로 옮겼다
  });

  it('갱신 안내 = 안 보낸 행만 조회 · 적재 실패면 선점 해제(Codex 1R)', () => {
    const rn = co.slice(co.indexOf('async function runApprovalRenewalNotices('), co.indexOf('let segmentColumnsReadyCache'));
    expect(rn).toContain("AND (approval_meta->>'renewalNoticeFor') IS NULL\n      ORDER BY approved_until`,");
    expect(rn).not.toMatch(/LIMIT \d/);   // 실패해 다시 고르는 행이 뒤 행을 막지 않게(Codex 2R)
    expect(rn).toContain('const since = approvalSummarySince(op.approvalMeta?.windowStart, op.autoSendLeadMinutes,');
    expect(rn).toContain("if (!sent) {");
    expect(rn).toContain("SET approval_meta = approval_meta - 'renewalNoticeFor'");
  });

  it('직접 쓴 문안 = AI 0 · 같은 문안 1회 검사(지문) · 재생성 0', () => {
    expect(gen).toContain("if (operator.copyMode === 'fixed' && operator.fixedCopy?.body) {");
    expect(gen).toContain("const cachedPass = isFixedCopy && operator.fixedCopy?.spam?.hash === fixedHash && operator.fixedCopy?.spam?.status === 'pass';");
    expect(gen).toContain('maxRetries: isFixedCopy ? 0 : 2,');
  });

  it('제안 = 센 회차(기간 · 기준 시각) · 발송 재추출 · 명단 화면이 같은 값으로 센다', () => {
    // 대상 칸은 저장된 계약이 마지막에 덮는다(미리보기 결과 · AI 결과의 대상 칸을 믿지 않는다 · Codex 1R)
    expect(gen).toContain('target: { ...(orchestratorResult?.target || {}), ...contractTarget(operator, contractKey, contractConditions), period, anchorAt: scheduledSendAt.toISOString() },');
    const ct = co.slice(co.indexOf('function contractTarget('), co.indexOf('function withMeasuredCount('));
    expect(ct).toContain("return { segmentKey: key, segmentParams: params, filters: {}, criteria: contractCriteriaText(key, params, null) };");
    expect(ct).toContain('return { segmentKey: null, segmentParams: null, filters: conditionsToFilters(list),');
    expect(co).toContain('period: pj.target?.period || null,\n        now: pj.target?.anchorAt ? new Date(pj.target.anchorAt) : undefined,');
    expect(routes).toContain('period: pj.target?.period || null,\n        now: pj.target?.anchorAt ? new Date(pj.target.anchorAt) : undefined,');
  });

  it('오케스트레이터 자동 마케팅 = 고정 칸 조건만 · 대상 0명 차감 0(지정한 호출만)', () => {
    expect(orch).toContain('else if (isOperatorScope) targetResult.filters = ctx.audienceFilters || {};');
    expect(orch).toContain('if ((result.messages?.length ?? 0) > 0 && (!creditOpts?.chargeOnlyWithTarget || (result.target?.count ?? 0) > 0)) {');
  });

  it('빈 조건 = 전체 금지(컴파일이 멈춘다)', () => {
    expect(aud).toContain('if (!compiled.sql.trim()) throw new AudienceEmptyError();');
  });

  it('등록 라우트 = 번역 · 막힘 · 고르기 필요면 등록 전에 400 · 시작 = preview_id 만 · 편집 · 승인 = 요금제 게이트 · 승인 = 주인', () => {
    const create = routes.slice(routes.indexOf("router.post('/operator/continuous', "), routes.indexOf("router.post('/operator/continuous/preview', "));
    expect(create.indexOf('const tr = await translateAudience({')).toBeLessThan(create.indexOf('const operator = await createOperator({'));
    expect(create).toContain("if (tr.kind === 'blocked') {");
    expect(create).toContain("if (tr.kind === 'needs_choice') {");
    const start = routes.slice(routes.indexOf("router.post('/operator/continuous/from-preview', "), routes.indexOf("router.post('/operator/continuous/preview/update', "));
    expect(start.replace(/req\.body\??\.(preview_id|revision)/g, '')).not.toMatch(/req\.body/);
    expect(start).toContain("if (err instanceof PreviewStaleError) return res.status(409).json({ success: false, error: err.message, code: 'PREVIEW_STALE', current: err.current });");
    const apv = routes.slice(routes.indexOf("router.post('/operator/continuous/:id/approval-preview', "), routes.indexOf("router.post('/operator/continuous/:id/approve-window', "));
    expect(apv).toContain('await previewOperatorApproval(companyId, req.params.id, userId);');   // 창을 열 때만(계약 덮어쓰기 입력 없음)
    for (const path of ['/operator/continuous/preview/update', '/operator/continuous/:id/approve-window']) {
      const at = routes.indexOf(`router.post('${path}', `);
      expect(routes.slice(at, at + 1200)).toContain('isAiOperatorAllowed(planCtx, req.user)');
    }
    const appr = routes.slice(routes.indexOf("router.post('/operator/continuous/:id/approve-window', "), routes.indexOf("router.get('/operator/continuous', "));
    expect(appr).toContain('created_by !== userId');
  });
});
