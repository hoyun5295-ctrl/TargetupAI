/**
 * 자동 마케팅 [제안 받기] = 미리보기 · 창 편집 · 시작 (★ 2026-10-05 · 설계서 docs/2026-10-05-automarketing-preview-design.md
 *   · docs/2026-10-05-automarketing-trust-design.md · ★ 2026-10-24 docs/2026-10-24-automarketing-oneline-design.md)
 *
 * 접수 ①: 한 줄 [제안 받기]가 제안을 보기도 전에 200(등록 = 가동).
 * 접수 ②: 생일 쿠폰 자동 마케팅이 생일 데이터가 없는데 전체 고객으로 잡혔다.
 * 접수 ③(1024): 한 줄로 더 쉽게 — 모자란 것만 묻는다 · 돈은 두 순간 · 요청 키 · 등록 한 트랜잭션.
 * 계약: 미리보기 = 등록 없이 첫 회차와 같은 계산 · 대상은 번역 module 이 계약으로 고정 · 질문이 있으면 0 ·
 *   AI 문안 5(대상 0명 0 · 답 · 다시 만들기에서만) · 직접 쓴 문안 0 · 시작 = 보관본 그대로 등록(200 · 승인 기간 같은 INSERT) + 본 안 = 첫 회차.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const orchestrateMock = vi.fn();
const registerMock = vi.fn();
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
const cbChoicesMock = vi.fn();
const opt080Mock = vi.fn();

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../../config/defaults', () => ({ getCompanyCosts: () => ({ sms: 10, lms: 30, mms: 60 }), SEND_HOURS: { start: 8, end: 21 } }));
vi.mock('../../services/ai-orchestrator', () => ({ orchestrate: (...a: any[]) => orchestrateMock(...a) }));
vi.mock('../../services/ai', () => ({
  extractVarCatalog: () => ({ fieldMappings: { 이름: {}, 등급: {}, 포인트: {} }, availableVars: ['이름', '등급', '포인트'] }),
  filterVarCatalogByData: async (_c: any, vars: string[]) => { const i = vars.indexOf('포인트'); if (i >= 0) vars.splice(i, 1); },
}));
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
vi.mock('../autosend-policy', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  computeApprovalWindow: (...a: any[]) => windowMock(...a),
  countEmptyRounds: () => 0,
}));
vi.mock('../operator-audience', () => ({
  listSegmentAvailability: async () => [
    { key: 'all', label: '전체 고객', available: true, reason: '' },
    { key: 'vip', label: '상위 등급 고객', available: true, reason: '' },
    { key: 'birthday', label: '생일 고객', available: false, reason: '고객 생일 정보가 아직 없어요.' },
  ],
}));
vi.mock('../messageUtils', () => ({ getOpt080Number: (...a: any[]) => opt080Mock(...a) }));
vi.mock('../demo-company', () => ({ isDemoCompany: async () => false }));
vi.mock('../continuous-operator', () => ({
  registerOperator: (...a: any[]) => registerMock(...a),
  generateProposalForOperator: (...a: any[]) => generateMock(...a),
  loadOperatorCompanyContext: (...a: any[]) => loadCtxMock(...a),
  buildOperatorOrchestrateContext: (...a: any[]) => buildCtxMock(...(a as [any])),
  explainEmptyRound: (...a: any[]) => explainMock(...a),
  findOpenProposalForOperator: (...a: any[]) => findOpenMock(...a),
  approveOperatorWindow: (...a: any[]) => approveWindowMock(...a),
  listOperatorCallbackChoices: (...a: any[]) => cbChoicesMock(...a),
  finalCopiesOf: (pj: any) => (pj.messages || []).map((m: any, i: number) => ({ variantIndex: i, body: m.body, sent: `(광고)${m.body}`, sentSubject: '', fingerprint: `f${i}` })),
  checkOperatorCallback: async (_c: any, _u: any, i: any) => ({ callbackNumber: String(i.callbackNumber || '').replace(/\D/g, '') || null, useIndividualCallback: false }),
  mapRowToOperator: (r: any) => r,
  operatorContract: (op: any) => {
    const key = op.segmentKey || op.targetHint || null;
    if (key) return { key, conditions: null };
    return op.audienceConditions && op.audienceConditions.length > 0 ? { key: null, conditions: op.audienceConditions } : null;
  },
  normalizeOperatorBenefit: (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null),
  normalizeOperatorChannel: (v: any) => (['sms', 'lms', 'mms'].includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'lms'),
  normalizeFixedCopyInput: (raw: any) => (raw && typeof raw.body === 'string' && raw.body.trim() ? { subject: String(raw.subject || ''), body: raw.body.trim() } : null),
  validateOperatorInput: (input: any) => {
    if (!input.name || !input.objective) throw new Error('name과 objective는 필수입니다.');
    if (input.objective.trim().length < 5) throw new Error('objective는 5자 이상 입력해주세요.');
    const h = parseInt(String(input.scheduleTime || '09:00'), 10);
    if (h < 8 || h >= 21) throw new Error('발송 희망 시각은 08:00~20:59 사이만 가능합니다');
    return { schedule: input.schedule || 'daily', scheduleTime: input.scheduleTime || '09:00', scheduleMonth: null };
  },
  operatorContextFields: (input: any) => ({
    companyId: input.companyId, createdBy: input.createdBy, objective: input.objective.trim(),
    copyStyle: null, channel: 'lms', benefitContent: input.benefitContent ?? null, targetHint: null,
    segmentKey: input.segmentKey ?? null, segmentParams: input.segmentParams ?? null,
    audienceConditions: input.audienceConditions ?? null, schedule: input.schedule || 'daily',
  }),
  OperatorCallbackError: class OperatorCallbackError extends Error {},
  OperatorRegisterConflictError: class OperatorRegisterConflictError extends Error {},
  OperatorChargeError: class OperatorChargeError extends Error {},
  OperatorPairingError: class OperatorPairingError extends Error {},
  OperatorScheduleChangedError: class OperatorScheduleChangedError extends Error {},
  operatorScheduleShape: (op: any) => ({
    schedule: op.schedule, scheduleTime: op.scheduleTime,
    scheduleDayOfWeek: op.scheduleDayOfWeek ?? null, scheduleDayOfMonth: op.scheduleDayOfMonth ?? null, scheduleMonth: op.scheduleMonth ?? null,
  }),
}));

import {
  runOperatorPreview, updateOperatorPreview, startOperatorFromPreview, takePreview, PreviewBusyError, PreviewInputError,
  previewOperatorApproval, approveOperatorFromScreen, PreviewStaleError, scheduleBodyFromText,
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
const KEY = 'screen-key-0001';
const regOk = (id: string) => registerMock.mockImplementation(async (_i: any, o: any) => ({ operator: { id: o.id || id, approvedUntil: o.window?.until ?? null }, existed: false }));

beforeEach(() => {
  __resetPreviewStoreForTest();
  [orchestrateMock, registerMock, generateMock, loadCtxMock, buildCtxMock, explainMock, findOpenMock,
    translateMock, countMock, forecastMock, approveWindowMock, windowMock, cbChoicesMock, opt080Mock].forEach((m) => m.mockReset());
  (dbQuery as any).mockReset();
  (dbQuery as any).mockImplementation(async (sql: string) => (/FROM users/.test(String(sql)) ? { rows: [{ phone: '01012345678' }] } : { rows: [] }));
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
  cbChoicesMock.mockResolvedValue({ defaultNumber: '0212345678', candidates: [] });
  opt080Mock.mockResolvedValue('0801234567');
});

describe('1. 미리보기 = 등록 0 · 대상은 번역 결과(계약) · 질문이 없으면 AI 문안 5(대상 0명 0)', () => {
  it('축 계약 · AI 모드 = 5 · chargeOnlyWithTarget · 잔액 부족이면 결과 0 · 등록 0 · 번역은 매월로(짝은 질문표)', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'proposal', ready: true, count: 120, questions: [], audience: { mode: 'axis', label: '생일 고객', mapped: true } });
    expect(out.previewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(orchestrateMock.mock.calls[0][1]).toMatchObject({ source: 'ai-operator-propose', cost: 5, chargeOnlyWithTarget: true, throwOnInsufficient: true });
    expect(orchestrateMock.mock.calls[0][1].idempotencyKey).toBeUndefined();   // 화면 키 없는 옛 화면 = 지금 그대로
    expect(translateMock.mock.calls[0][0].schedule).toBe('monthly');
    expect(buildCtxMock.mock.calls[0][0]).toMatchObject({ id: null, segmentKey: 'birthday' });
    expect(registerMock).not.toHaveBeenCalled();
    expect(out.appliedSegment).toEqual({ key: 'birthday', label: '생일 고객' });
    expect(out.costs).toEqual({ start: 200, copy: 5, send: 0 });
  });

  it('한 줄의 혜택(허용 꼴 하나) = 혜택 칸에 채우고 알린다 · 질문 0', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out.copy.benefit).toBe('30% 쿠폰');
    expect(out.notes).toContain('적어 주신 혜택 「30% 쿠폰」만 실어요.');
  });

  it('화면 키 = 원장 키(화면 키 + 문안 입력 지문) · 같은 키 재전송 = 같은 보관본(AI 0 · 차감 0)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, request_key: KEY });
    const key = orchestrateMock.mock.calls[0][1].idempotencyKey;
    expect(key).toMatch(/^ai-operator-propose:company-1:[0-9a-f]{32}$/);
    const again = await runOperatorPreview(CO, US, { ...BODY, request_key: KEY });
    expect(again.previewId).toBe(out.previewId);
    expect(again.proposal).toEqual(RESULT);
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(translateMock).toHaveBeenCalledTimes(1);   // 번역도 다시 하지 않는다(지문이 AI 번역에 따라 갈리지 않게)
  });

  it('막힘(데이터 없음) = AI 0 · 시작 불가 · 사유 그대로', async () => {
    translateMock.mockResolvedValueOnce({ kind: 'blocked', code: 'DATA_MISSING', reason: '이 목표는 「생일 고객」에게 보내는 목표인데, 고객 생일 정보가 아직 없어요.' });
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'blocked', ready: false, blockCode: 'DATA_MISSING' });
    expect(out.reason).toContain('고객 생일 정보가 아직 없어요');
    expect(orchestrateMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
  });

  it('080 없음 · 발신번호 0개 = 막힘(질문 아님 · 0크레딧)', async () => {
    opt080Mock.mockResolvedValueOnce('');
    const a = await runOperatorPreview(CO, US, BODY);
    expect(a).toMatchObject({ kind: 'blocked', blockCode: 'OPT080_MISSING', ready: false });
    cbChoicesMock.mockResolvedValueOnce({ defaultNumber: null, candidates: [] });
    const b = await runOperatorPreview(CO, 'user-2', BODY);
    expect(b).toMatchObject({ kind: 'blocked', blockCode: 'CALLBACK_MISSING' });
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it('지금 대상 0명 = 시작 불가 · AI 0 · 보관(기준을 고칠 수 있게) · 「세부 설정에서」 0', async () => {
    countMock.mockResolvedValueOnce(0);
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'zero', ready: false, count: 0 });
    expect(out.previewId).toBeTruthy();
    expect(out.reason).not.toContain('세부 설정');
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
    forecastMock.mockResolvedValue([{ date: '2026-10-06', count: 0 }, { date: '2026-10-07', count: 0 }]);
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out).toMatchObject({ kind: 'proposal', ready: true, proposal: null, count: 0 });
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it('① 칸을 못 정함 = 상태 A(질문 · AI 0 · 0크레딧) → 답(서버 질문표로 검증) → 그때 문안(5)', async () => {
    translateMock.mockResolvedValueOnce({ kind: 'needs_choice', conditions: [], unresolved: [{ term: '포인트', operator: 'gte', value: 1000 }], options: [{ field: 'custom_fields.custom_3', label: '잔여멤버쉽', kind: 'custom', dataType: 'number', fillCount: 1240, samples: ['3000'] }] });
    const out = await runOperatorPreview(CO, US, { ...BODY, schedule: 'monthly' });
    expect(out).toMatchObject({ kind: 'questions', ready: false });
    expect(out.questions.map((q) => q.id)).toEqual(['field:포인트']);
    expect(out.questions[0].recommended).toBeUndefined();   // 미리 고른 답 0
    expect(orchestrateMock).not.toHaveBeenCalled();
    await expect(updateOperatorPreview(out.previewId!, CO, US, { revision: 0, answers: { 'field:포인트': 'custom_fields.nope' } })).rejects.toBeInstanceOf(PreviewInputError);
    translateMock.mockResolvedValueOnce(FILTERS);
    const after = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, answers: { 'field:포인트': 'custom_fields.custom_3' } });
    expect(translateMock.mock.calls[1][0]).toMatchObject({ conditions: [{ term: '포인트', field: 'custom_fields.custom_3', operator: 'gte', value: 1000 }] });
    expect(translateMock.mock.calls[1][0].carry).toMatchObject({ kind: 'needs_choice', unresolved: [{ term: '포인트' }] });
    expect(after).toMatchObject({ kind: 'proposal', ready: true, revision: 1, audience: { mode: 'filters' } });
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
  });

  it('② 받는 분 없음 · AI 가 「전체 고객」을 고름 = 묻는다(전체는 맨 끝 · 미리 고른 답 0 · 쓸 수 없는 축은 자물쇠)', async () => {
    translateMock.mockResolvedValueOnce({ kind: 'axis', segmentKey: 'all', segmentParams: {}, label: '전체 고객', description: '', mapped: true });
    const out = await runOperatorPreview(CO, US, { ...BODY, schedule: 'monthly', objective: '이번 달 신상품 입고 소식 보내줘' });
    expect(out.kind).toBe('questions');
    const q = out.questions.find((x) => x.id === 'audience')!;
    expect(q.options!.map((o) => o.value)).toEqual(['axis:vip', 'axis:birthday', 'axis:all']);
    expect(q.options!.find((o) => o.value === 'axis:birthday')).toMatchObject({ disabled: true });
    expect(q.options![2].label).toBe('수신 동의한 전체 고객 · 120명');
    expect(out.appliedSegment).toBeNull();
    translateMock.mockResolvedValueOnce({ kind: 'axis', segmentKey: 'vip', segmentParams: {}, label: '상위 등급 고객', description: '', mapped: false });
    const after = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, answers: { audience: 'axis:vip' } });
    expect(translateMock.mock.calls[1][0]).toMatchObject({ segmentKey: 'vip' });
    expect(after).toMatchObject({ kind: 'proposal', ready: true });
  });

  it('③ 사람이 쓴 매주 + 상태 축 = 묻는다(막힌 값 자물쇠 · [매월로]) · 매월로 답하면 다시 세기만', async () => {
    translateMock.mockResolvedValueOnce({ kind: 'axis', segmentKey: 'vip', segmentParams: {}, label: '상위 등급 고객', description: '', mapped: true });
    const out = await runOperatorPreview(CO, US, { name: 'VIP 소식', objective: '매주 VIP에게 신상품 소식', infer_schedule: true });
    const q = out.questions.find((x) => x.id === 'schedule')!;
    expect(q.options!.map((o) => o.value)).toEqual(['monthly', 'axis:grade_up', 'keep']);
    expect(q.options![2]).toMatchObject({ disabled: true });
    const after = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, answers: { schedule: 'monthly' } });
    expect(after).toMatchObject({ kind: 'proposal', window: { schedule: 'monthly' } });
  });

  it('④ 행사 말인데 혜택 값 없음 = 묻는다 · [혜택 없이 보내기] = 빈 답 · 혜택 글의 날짜 = 거절', async () => {
    translateMock.mockResolvedValueOnce({ kind: 'axis', segmentKey: 'vip', segmentParams: {}, label: '상위 등급 고객', description: '', mapped: true });
    const out = await runOperatorPreview(CO, US, { name: '세일', objective: '매월 VIP에게 시즌 세일 안내 보내줘', infer_schedule: true });
    const q = out.questions.find((x) => x.id === 'benefit')!;
    expect(q).toMatchObject({ kind: 'text', noneLabel: '혜택 없이 보내기' });
    await expect(updateOperatorPreview(out.previewId!, CO, US, { revision: 0, answers: { benefit: '10월 25일까지 20% 할인' } })).rejects.toThrow('지나가는 날짜');
    const after = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, answers: { benefit: '' } });
    expect(after).toMatchObject({ kind: 'proposal', copy: { benefit: null } });
  });

  it('④ 값이 조건과 섞임(「VIP만 20% 할인」) = 사람 글 조각을 채운 글 칸(조각 = 원문의 부분 문자열)', async () => {
    translateMock.mockResolvedValueOnce({ kind: 'axis', segmentKey: 'vip', segmentParams: {}, label: '상위 등급 고객', description: '', mapped: true });
    const line = '매월 VIP만 20% 할인 안내';
    const out = await runOperatorPreview(CO, US, { name: 'VIP', objective: line, infer_schedule: true });
    const q = out.questions.find((x) => x.id === 'benefit')!;
    expect(q.recommended).toBe('20% 할인');
    expect(line).toContain(q.recommended!);
  });

  it('⑤ 기본 번호 없음 + 후보 둘 = 묻는다 · 후보 하나 = 그 번호를 칸에 적는다(묻지 않음) · ⑥ 계정 휴대폰 없음 = 묻는다', async () => {
    cbChoicesMock.mockResolvedValueOnce({ defaultNumber: null, candidates: ['0212345678', '0311234567'] });
    (dbQuery as any).mockImplementation(async () => ({ rows: [] }));
    const out = await runOperatorPreview(CO, US, BODY);
    expect(out.questions.map((q) => q.id)).toEqual(['callback', 'admin_phone']);
    await expect(updateOperatorPreview(out.previewId!, CO, US, { revision: 0, answers: { callback: '0212345678', admin_phone: '1234' } })).rejects.toThrow('휴대폰 번호');
    const after = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, answers: { callback: '0212345678', admin_phone: '010-1234-5678' } });
    expect(after).toMatchObject({ kind: 'proposal', sendVia: { callback: '0212345678', adminPhone: '01012345678' } });
    cbChoicesMock.mockResolvedValueOnce({ defaultNumber: null, candidates: ['0212345678'] });
    (dbQuery as any).mockImplementation(async (sql: string) => (/FROM users/.test(String(sql)) ? { rows: [{ phone: '01012345678' }] } : { rows: [] }));
    const one = await runOperatorPreview(CO, 'user-3', BODY);
    expect(one.questions).toEqual([]);
    expect(one.sendVia.callback).toBe('0212345678');
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

  it('편집은 문안을 만들지 않는다 — 지문(대상 칸 · 혜택)이 바뀌면 시작 잠금 · [다시 만들기]에서만 5', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, schedule: 'monthly', benefit_content: '30% 쿠폰' });
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    const stale = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, benefit: '40% 쿠폰' });
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(stale).toMatchObject({ ready: false, copyStale: true, proposal: RESULT });
    const remade = await updateOperatorPreview(out.previewId!, CO, US, { revision: 1, regenerate: true });
    expect(orchestrateMock).toHaveBeenCalledTimes(2);
    expect(remade).toMatchObject({ ready: true, copyStale: false });
    // 기준 숫자(값)는 지문 밖 = 다시 세기만(0)
    translateMock.mockResolvedValueOnce(FILTERS).mockResolvedValueOnce({ ...FILTERS, conditions: [{ ...FILTERS.conditions[0], value: 3000 }] });
    await updateOperatorPreview(out.previewId!, CO, US, { revision: 2, conditions: [{ term: '포인트', field: 'custom_fields.custom_3', operator: 'gte', value: 1000 }] });
    await updateOperatorPreview(out.previewId!, CO, US, { revision: 3, regenerate: true });
    const v = await updateOperatorPreview(out.previewId!, CO, US, { revision: 4, conditions: [{ term: '포인트', field: 'custom_fields.custom_3', operator: 'gte', value: 3000 }] });
    expect(v).toMatchObject({ ready: true, copyStale: false });
    expect(orchestrateMock).toHaveBeenCalledTimes(3);
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

describe('1-2. 한 줄의 주기 · 시각(순수)', () => {
  const NOW = new Date('2026-10-24T01:00:00.000Z');   // KST 10:00
  it('주기 말 없음 = 매월(written false) · 가장 빨리 나가는 날(09:00 지났으면 내일)', () => {
    const r = scheduleBodyFromText('VIP에게 신상품 소식', {}, NOW);
    expect(r).toMatchObject({ written: false, moved: null, fields: { schedule: 'monthly', schedule_day_of_month: 25, schedule_time: '09:00' } });
    expect(scheduleBodyFromText('VIP에게 오후 3시에 소식', {}, NOW).fields).toMatchObject({ schedule_day_of_month: 24, schedule_time: '15:00' });
  });
  it('발송 불가 시각 = 검증 전에 옮기고 알린다(오후 10시 → 오후 8시 · 이른 아침 → 오전 8시)', () => {
    expect(scheduleBodyFromText('매주 월요일 오후 10시에 보내줘', {}, NOW)).toMatchObject({ written: true, moved: { from: '22:00', to: '20:00' }, fields: { schedule: 'weekly', schedule_day_of_week: 1 } });
    expect(scheduleBodyFromText('매월 1일 오전 6시', {}, NOW).moved).toEqual({ from: '06:00', to: '08:00' });
  });
  it('미리보기 = 옮긴 시각으로 검증을 지난다(옛: 400) · 결과 문장 한 줄', async () => {
    const out = await runOperatorPreview(CO, US, { name: '야간', objective: '매주 월요일 오후 10시 생일 고객 쿠폰 30% 할인', infer_schedule: true });
    expect(out.window.scheduleTime).toBe('20:00');
    expect(out.notes).toContain('적어 주신 오후 10시는 보낼 수 없는 시각이라 오후 8시로 옮겼어요.');
  });
  it('주기 말 없는 생일 축 = 생일인 날(매일)', async () => {
    const out = await runOperatorPreview(CO, US, { name: '생일', objective: '생일 고객에게 30% 할인 쿠폰', infer_schedule: true });
    expect(out.questions).toEqual([]);
    expect(out.window.schedule).toBe('daily');
  });
});

describe('2. 시작 = 보관본 그대로 · 서버가 다시 판정(돈 0) · 등록 한 트랜잭션 · 본 안 = 첫 회차', () => {
  it('보관본(계약 · 문안 분기)으로 등록(id = 미리보기 id · 승인 기간 같은 INSERT) → precomputed 첫 회차(본 탭) · 시작 판정 중 AI 0', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    regOk('x');
    generateMock.mockResolvedValue({ id: 'prop-1' });
    const started = await startOperatorFromPreview(out.previewId!, CO, US, 0, 2);
    expect(registerMock.mock.calls[0][0]).toMatchObject({ segmentKey: 'birthday', audienceConditions: null, copyMode: 'ai', benefitContent: '30% 쿠폰', adminPhoneNumbers: ['01012345678'] });
    expect(registerMock.mock.calls[0][1]).toEqual({ id: out.previewId, window: { startAt: WIN.startAt, until: WIN.until } });
    expect(approveWindowMock).not.toHaveBeenCalled();
    expect(generateMock).toHaveBeenCalledWith(out.previewId, { precomputed: RESULT, variantIndex: 2 });
    expect(started).toMatchObject({ proposal: { id: 'prop-1' }, message: null, approvedUntil: '2026-10-12T14:59:59.999Z' });
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(takePreview(out.previewId!, CO, US)).toBeNull();   // 커밋 뒤에 지웠다
  });

  it('직접 쓴 문안 = precomputed 없이 첫 회차(회차가 그 문안으로 만든다)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, copy_mode: 'fixed', fixed_body: '%이름%님 생일 축하드려요' });
    regOk('op-2');
    generateMock.mockResolvedValue({ id: 'prop-2' });
    await startOperatorFromPreview(out.previewId!, CO, US, 0);
    expect(registerMock.mock.calls[0][0]).toMatchObject({ copyMode: 'fixed', fixedCopy: { body: '%이름%님 생일 축하드려요' } });
    expect(generateMock).toHaveBeenCalledWith(out.previewId, undefined);
  });

  it('시작할 수 없는 상태(0명) = 400 · 등록 0', async () => {
    countMock.mockResolvedValue(0);
    const out = await runOperatorPreview(CO, US, BODY);
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 0)).rejects.toBeInstanceOf(PreviewInputError);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('시작 판정은 문안을 만들지 않는다 — 보관본에 문안이 없으면 400(AI 0 · 차감 0)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, copy_mode: 'fixed', fixed_body: '생일 축하드려요' });
    orchestrateMock.mockRejectedValueOnce(new Error('AI 일시 오류'));
    await expect(updateOperatorPreview(out.previewId!, CO, US, { revision: 0, copy_mode: 'ai', regenerate: true })).rejects.toThrow('AI 일시 오류');
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 1)).rejects.toBeInstanceOf(PreviewInputError);
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('발송 시각을 넘겨 승인 기간이 바뀌면 = 판을 올리고 다시 확인 · 저장은 확인받은 기간 그대로(Codex 3R)', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    windowMock.mockReturnValue(WIN_NEXT);   // 창을 연 뒤 오늘 발송 시각이 지났다
    const moved = await startOperatorFromPreview(out.previewId!, CO, US, 0).catch((e) => e);
    expect(moved).toBeInstanceOf(PreviewStaleError);
    expect(moved.message).toContain('승인 기간이 바뀌었어요');
    expect(moved.current).toMatchObject({ revision: 1, window: { startAt: WIN_NEXT.startAt.toISOString() } });
    expect(registerMock).not.toHaveBeenCalled();
    regOk('op-1');
    generateMock.mockResolvedValue({ id: 'prop-1' });
    await startOperatorFromPreview(out.previewId!, CO, US, 1);
    expect(registerMock.mock.calls[0][1].window).toMatchObject({ startAt: WIN_NEXT.startAt, until: WIN_NEXT.until });
  });

  it('늦게 온 옛 판 편집이 새 기간을 내보냈으면 = 그 기간을 못 본 판으로는 시작하지 못한다(Codex 4R)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, copy_mode: 'fixed', fixed_body: '생일 축하드려요' });
    await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, fixed_body: '생일 진심으로 축하드려요' });   // 화면 = 판 1 · 기간 A
    windowMock.mockReturnValue(WIN_NEXT);   // 발송 시각이 지났다
    const late = await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, fixed_body: '늦게 온 편집' }).catch((e) => e);
    expect(late).toBeInstanceOf(PreviewStaleError);
    expect(late.current).toMatchObject({ revision: 2, window: { startAt: WIN_NEXT.startAt.toISOString() } });
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 1)).rejects.toBeInstanceOf(PreviewStaleError);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('화면이 본 판이 아니면 시작 · 편집하지 않고 지금 상태를 돌려준다(본 것 = 등록한 것 · Codex 2R)', async () => {
    const out = await runOperatorPreview(CO, US, { ...BODY, copy_mode: 'fixed', fixed_body: '생일 축하드려요' });
    await updateOperatorPreview(out.previewId!, CO, US, { revision: 0, fixed_body: '생일 진심으로 축하드려요' });
    const stale = await startOperatorFromPreview(out.previewId!, CO, US, 0).catch((e) => e);
    expect(stale).toBeInstanceOf(PreviewStaleError);
    expect(stale.current).toMatchObject({ revision: 1, copy: { body: '생일 진심으로 축하드려요' } });
    await expect(updateOperatorPreview(out.previewId!, CO, US, { revision: 0, fixed_body: '옛 화면에서 고침' })).rejects.toBeInstanceOf(PreviewStaleError);
    await expect(startOperatorFromPreview(out.previewId!, CO, US, undefined)).rejects.toBeInstanceOf(PreviewStaleError);   // 판 없음 = 옛 화면
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('같은 시작의 재전송 = 409(처리 중) · 등록은 한 번', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    regOk('op-1');
    generateMock.mockResolvedValue({ id: 'prop-1' });
    const [a, b] = await Promise.allSettled([startOperatorFromPreview(out.previewId!, CO, US, 0), startOperatorFromPreview(out.previewId!, CO, US, 0)]);
    expect([a, b].filter((r) => r.status === 'fulfilled' && r.value)).toHaveLength(1);
    expect([a, b].some((r) => r.status === 'rejected' && (r as any).reason instanceof PreviewBusyError)).toBe(true);
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('결과 모름 재전송 = 행이 먼저(id = 미리보기 id · 같은 회사 · 같은 사람) → 그 행을 돌려준다(등록 0 · 차감 0)', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    (dbQuery as any).mockImplementationOnce(async () => ({ rows: [{ id: out.previewId, approvedUntil: new Date('2026-10-12T14:59:59.999Z') }] }));
    findOpenMock.mockResolvedValueOnce({ id: 'prop-9' });
    const again = await startOperatorFromPreview(out.previewId!, CO, US, 0);
    expect(again).toMatchObject({ operator: { id: out.previewId }, proposal: { id: 'prop-9' }, approvedUntil: '2026-10-12T14:59:59.999Z' });
    expect(registerMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('다른 회사 · 다른 사람 · 없는 id · 만료 = null(등록 0)', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    expect(await startOperatorFromPreview(out.previewId!, 'company-2', US, 0)).toBeNull();
    expect(await startOperatorFromPreview(out.previewId!, CO, 'user-2', 0)).toBeNull();
    expect(await startOperatorFromPreview('nope', CO, US, 0)).toBeNull();
    __agePreviewForTest(out.previewId!, 31 * 60 * 1000);
    expect(await startOperatorFromPreview(out.previewId!, CO, US, 0)).toBeNull();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('등록이 던지면(잔액 부족 · 그 밖) 보관본이 남는다 — 등록은 한 트랜잭션이라 다시 눌러도 두 번 등록 0', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    registerMock.mockRejectedValueOnce(new (InsufficientCreditError as any)('insufficient'));
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 0)).rejects.toThrow('insufficient');
    registerMock.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(startOperatorFromPreview(out.previewId!, CO, US, 0)).rejects.toThrow('connection terminated');
    regOk('op-1');
    generateMock.mockResolvedValue({ id: 'prop-1' });
    expect(await startOperatorFromPreview(out.previewId!, CO, US, 0)).toMatchObject({ proposal: { id: 'prop-1' } });
  });

  it('첫 회차 저장이 던지면 저장 상태로 판정 · 재조회 실패 = 「확인하지 못했다」(Codex 1R · 2R)', async () => {
    const out = await runOperatorPreview(CO, US, BODY);
    regOk('op-1');
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
    expect(open!.outcome).toMatchObject({ revision: 0, audience: { mode: 'axis' }, questions: [] });
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
    // ★ 1024 Codex 3R — 창을 열 때의 일정을 함께 넘긴다(잠근 행과 다르면 저장 0) · 답하지 않았으면 주기를 넘기지 않는다
    expect(approveWindowMock.mock.calls[0][0].seenSchedule).toMatchObject({ schedule: expect.any(String) });
    expect(approveWindowMock.mock.calls[0][0].schedule).toBeNull();
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

  it('승인 = 화면이 본 판일 때만 · 다른 운영자의 창 = null · 승인 창으로 새 등록 0', async () => {
    translateMock.mockResolvedValueOnce(AXIS_ALL).mockResolvedValueOnce(VIP_FILTERS);
    rowOnce(OP);
    const open = await previewOperatorApproval(CO, 'op-9', US);
    const id = open!.outcome.previewId!;
    await updateOperatorPreview(id, CO, US, { revision: 0, conditions: VIP.map((c) => ({ ...c, term: '등급' })) });
    const stale = await approveOperatorFromScreen(CO, 'op-9', US, { preview_id: id, revision: 0 }).catch((e) => e);
    expect(stale).toBeInstanceOf(PreviewStaleError);
    expect(stale.current).toMatchObject({ revision: 1, audience: { mode: 'filters' } });
    expect(await approveOperatorFromScreen(CO, 'op-other', US, { preview_id: id, revision: 1 })).toBeNull();
    expect(await startOperatorFromPreview(id, CO, US, 1)).toBeNull();
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
    const disp = co.slice(co.indexOf('async function dispatchProposalSend('), co.indexOf('async function dispatchProposalSend(') + 40000);
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

  it('직접 쓴 문안 = AI 0 · 같은 문안 1회 검사(지문) · 재생성 0 · 사람이 고른 첫 회차 안도 재생성 0', () => {
    expect(gen).toContain("if (operator.copyMode === 'fixed' && operator.fixedCopy?.body) {");
    expect(gen).toContain("const cachedPass = isFixedCopy && operator.fixedCopy?.spam?.hash === fixedHash && operator.fixedCopy?.spam?.status === 'pass';");
    expect(gen).toContain('const noRegen = isFixedCopy || chosenFirst != null;');
    expect(gen).toContain('maxRetries: noRegen ? 0 : 2,');
  });

  it('제안 = 센 회차(기간 · 기준 시각) · 발송 재추출 · 명단 화면이 같은 값으로 센다', () => {
    expect(gen).toContain('target: { ...(orchestratorResult?.target || {}), ...contractTarget(operator, contractKey, contractConditions), period, anchorAt: scheduledSendAt.toISOString() },');
    const ct = co.slice(co.indexOf('function contractTarget('), co.indexOf('function withMeasuredCount('));
    expect(ct).toContain("return { segmentKey: key, segmentParams: params, filters: {}, criteria: contractCriteriaText(key, params, null) };");
    expect(ct).toContain('return { segmentKey: null, segmentParams: null, filters: conditionsToFilters(list),');
    expect(co).toContain('period: pj.target?.period || null,\n        now: pj.target?.anchorAt ? new Date(pj.target.anchorAt) : undefined,');
    expect(routes).toContain('period: pj.target?.period || null,\n        now: pj.target?.anchorAt ? new Date(pj.target.anchorAt) : undefined,');
  });

  it('오케스트레이터 자동 마케팅 = 고정 칸 조건만 · 대상 0명 차감 0(지정한 호출만) · 차감 한 곳(키 · 잔액 부족 던짐)', () => {
    expect(orch).toContain('else if (isOperatorScope) targetResult.filters = ctx.audienceFilters || {};');
    expect(orch).toContain('if ((result.messages?.length ?? 0) > 0 && (!creditOpts?.chargeOnlyWithTarget || (result.target?.count ?? 0) > 0)) {');
    expect(orch).toContain('if (!(key && await isChargedByKey(ctx.companyId, key))) await checkCredit(ctx.companyId, cost);');
    expect((orch.match(/chargeOrchestrate\(ctx, creditOpts/g) || []).length).toBe(2);
  });

  it('빈 조건 = 전체 금지(컴파일이 멈춘다)', () => {
    expect(aud).toContain('if (!compiled.sql.trim()) throw new AudienceEmptyError();');
  });

  it('등록 라우트 = 캘린더 전용 + 화면 키 · 번역 · 막힘이면 등록 전에 400 · 시작 = preview_id · 판 · 본 탭 · 자동 마케팅 주소 = 문 한 벌', () => {
    const create = routes.slice(routes.indexOf("router.post('/operator/continuous', "), routes.indexOf("router.post('/operator/continuous/preview', "));
    expect(create).toContain('if (!isUuid(requestKey))');
    expect(create).toContain('if (calendarMonth == null)');
    expect(create.indexOf('const tr = await translateAudience({')).toBeLessThan(create.indexOf('await registerOperator({'));
    expect(create).toContain("}, { id: requestKey, calendarMonth });");
    const start = routes.slice(routes.indexOf("router.post('/operator/continuous/from-preview', "), routes.indexOf("router.post('/operator/continuous/preview/update', "));
    expect(start.replace(/req\.body\??\.(preview_id|revision|variant_index)/g, '')).not.toMatch(/req\.body/);
    const am = routes.slice(routes.indexOf("router.post('/operator/continuous', "), routes.indexOf('// ★ D179 (2026-05-19) Multi-Goal Decisioning'));
    const handlers = am.split(/\nrouter\.(?:get|post|put|delete|patch)\(/).slice(1);
    for (const h of handlers) {
      if (/^'\/operator\/(continuous|proposals)/.test(h)) expect(h).toContain('operatorGate(req, res, { plan: ');
      expect(h).not.toMatch(/error: err\?\.message/);   // 500 원문 0
    }
    expect(routes).not.toContain("'/operator/proposals/:id/variants/:vid/record'");
  });
});
