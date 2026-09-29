/**
 * 여정 V2 2차 — 문장으로 만들기(질문표 · 답 검증 · 설계 1회 차감) · 이어붙이기 점검 (2026-09-30 · 설계서 §5)
 *
 * 못 박는 것:
 *   - 해석 결과는 레지스트리(AI 선택 가능 목록) 안 · 같은 사건 1개 · 최대 4개
 *   - 질문 = 코드가 만든다 · 추천 답 미리 선택 · 혜택은 비워 둔다 · 잠긴 사건은 고를 수 없다
 *   - [이대로 만들기](답 없음) = 추천 답으로 결정 · 목록 밖 값 거부
 *   - 설계 = 묶음 안 AI(차감 0) → 초안 저장 → 1회 차감(멱등키) · 저장 실패면 차감 0 · 같은 요청 두 번이면 초안 1개
 *   - 이어붙이기 점검 = 지도 선 상태를 읽고 1클릭 고치기 범위(켜진 여정은 자동 종료 켜기만)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn() }));
vi.mock('../ai-credit', () => {
  class InsufficientCreditError extends Error {}
  return { checkCredit: vi.fn(), deductCreditSafe: vi.fn(), InsufficientCreditError };
});
vi.mock('../company-data-profile', () => ({ getCompanyJourneyFacts: vi.fn() }));
vi.mock('../journey-ai-generator', () => ({ generateJourneyPackage: vi.fn() }));
vi.mock('../journey-draft-save', () => ({
  listJourneyCallbackNumbers: vi.fn(),
  defaultCallbackOf: (rows: any[]) => rows.find((r) => r.is_default)?.phone ?? (rows.length === 1 ? rows[0].phone : null),
  saveJourneyPackageAsDraft: vi.fn(),
  nextDraftChargeKey: vi.fn(),
  chargeThenSaveDraft: vi.fn(),
}));

import { callAIWithFallback } from '../../services/ai';
import { checkCredit } from '../ai-credit';
import { getCompanyJourneyFacts } from '../company-data-profile';
import { generateJourneyPackage } from '../journey-ai-generator';
import { listJourneyCallbackNumbers, saveJourneyPackageAsDraft, nextDraftChargeKey, chargeThenSaveDraft } from '../journey-draft-save';
import { isInCreditBundle } from '../ai-credit-context';
import { buildInterviewQuestions, decideJourneySpec, sanitizeInterviewPlans } from '../journey-interview';
import { parseJourneyIntent, designJourneyFromInterview } from '../journey-interview-ai';
import { buildAttachCheck, type LifecycleMap, type MapJourney, type MapLine } from '../journey-lifecycle-map';
import { getCreditCost } from '../ai-credit-calc';

const ai = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;
const credit = checkCredit as unknown as ReturnType<typeof vi.fn>;
const settle = chargeThenSaveDraft as unknown as ReturnType<typeof vi.fn>;
const claimed = nextDraftChargeKey as unknown as ReturnType<typeof vi.fn>;
const facts = getCompanyJourneyFacts as unknown as ReturnType<typeof vi.fn>;
const gen = generateJourneyPackage as unknown as ReturnType<typeof vi.fn>;
const cbs = listJourneyCallbackNumbers as unknown as ReturnType<typeof vi.fn>;
const save = saveJourneyPackageAsDraft as unknown as ReturnType<typeof vi.fn>;

const ALL_FACTS = {
  canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true, hasGrade: true, hasGradeOrder: true,
  hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true,
};
const OPEN: Record<string, { available: boolean; reason: string }> = {};

beforeEach(() => {
  ai.mockReset(); credit.mockReset(); settle.mockReset(); claimed.mockReset(); facts.mockReset(); gen.mockReset(); cbs.mockReset(); save.mockReset();
  facts.mockResolvedValue(ALL_FACTS);
  credit.mockResolvedValue(undefined);
  // ★ 0930 Codex 6R — 차감 확정 → 저장(CT 안) · 시도 키 = 요청 키#n(원장)
  settle.mockImplementation(async (o: any) => ({ journeyId: await o.save(), charged: o.cost }));
  claimed.mockImplementation(async (_c: string, k: string) => `${k}#1`);
  cbs.mockResolvedValue([{ phone: '0200000000', source: 'callback', description: null, is_default: true }]);
});

describe('해석 결과 정리', () => {
  it('목록 밖 사건 · 같은 사건 · 5개째를 버리고 p1~p4 로 번호를 붙인다', () => {
    const plans = sanitizeInterviewPlans({ plans: [
      { triggerEvent: 'customer.created', title: '가입', objective: 'a' },
      { triggerEvent: 'made.up', title: 'x' },
      { triggerEvent: 'customer.created', title: '또 가입' },
      { triggerEvent: 'purchase.first', title: '첫 구매' },
      { triggerEvent: 'cdp.purchase', title: '재구매' },
      { triggerEvent: 'customer.dormant', title: '휴면' },
      { triggerEvent: 'customer.dormant_return', title: '복귀' },
      { triggerEvent: 'cdp.reservation_created', title: '예약' },
    ] });
    expect(plans.map((p) => p.triggerEvent)).toEqual(['customer.created', 'purchase.first', 'cdp.purchase', 'customer.dormant']);
    expect(plans.map((p) => p.key)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
  it('AI 해석은 차감하지 않는다(묶음 안) · 깨진 응답이면 빈 목록', async () => {
    let bundled: boolean | null = null;
    ai.mockImplementation(async () => { bundled = isInCreditBundle(); return '{"plans":[{"triggerEvent":"customer.created","title":"가입 환영","objective":"반긴다"}]}'; });
    const plans = await parseJourneyIntent('c', '가입한 고객 환영해 줘');
    expect(bundled).toBe(true);
    expect(plans[0].triggerEvent).toBe('customer.created');
    ai.mockResolvedValue('JSON 아님');
    expect(await parseJourneyIntent('c', '아무 말')).toEqual([]);
  });
});

describe('질문표 · 답', () => {
  const plan = { key: 'p1', triggerEvent: 'customer.created', title: '가입 환영', objective: '가입 고객을 반긴다' };
  it('추천 답이 미리 골라져 있고 혜택은 비어 있다', () => {
    const qs = buildInterviewQuestions([plan], OPEN);
    expect(qs.map((q) => q.id)).toEqual(['p1:trigger', 'p1:messages', 'p1:goal', 'p1:benefit']);
    expect(qs.find((q) => q.id === 'p1:trigger')!.recommended).toBe('customer.created');
    expect(qs.find((q) => q.id === 'p1:messages')!.recommended).toBe('3');
    expect(qs.find((q) => q.id === 'p1:goal')!.recommended).toBe('yes');
    expect(qs.find((q) => q.id === 'p1:benefit')!.recommended).toBeUndefined();
  });
  it('[이대로 만들기] = 추천 답으로 결정 · 목표 문장에 횟수', () => {
    const qs = buildInterviewQuestions([plan], OPEN);
    const d = decideJourneySpec(plan, qs, {});
    expect(d).toMatchObject({ ok: true, spec: { triggerEvent: 'customer.created', messageCount: 3, goalExitEnabled: true, benefitText: null } });
    if (d.ok) expect(d.spec.objective).toContain('문자는 3번');
  });
  it('목록 밖 시작 사건 · 잠긴 사건은 거부', () => {
    const qs = buildInterviewQuestions([plan], { 'customer.created': { available: false, reason: '가입일 데이터가 없어요.' } });
    expect(decideJourneySpec(plan, qs, { 'p1:trigger': 'cdp.purchase' }).ok).toBe(false);
    expect(decideJourneySpec(plan, qs, { 'p1:trigger': 'customer.created' }).ok).toBe(false);
  });
  it('끝까지 보내는 사건(배송)은 자동 종료 질문을 숨기고 계약 기본값에 맡긴다', () => {
    const p = { key: 'p1', triggerEvent: 'custom_order_shipped', title: '배송', objective: '' };
    const qs = buildInterviewQuestions([p], OPEN);
    expect(qs.find((q) => q.id === 'p1:goal')!.hideForTriggers).toContain('custom_order_shipped');
    const d = decideJourneySpec(p, qs, {});
    expect(d.ok && d.spec.goalExitEnabled).toBeUndefined();
  });
});

describe('설계 1회 = 묶음 안 AI → 초안 저장 → 1회 차감', () => {
  const plan = { key: 'p1', triggerEvent: 'customer.created', title: '가입 환영', objective: '반긴다' };
  const PKG = { name: '가입 환영', steps: [], templateCode: 'onboarding', triggerEvent: 'customer.created', presetTriggerEvent: 'customer.created' };
  it('AI 는 묶음 안(차감 0) · 저장 뒤 단가 1회 차감(멱등키)', async () => {
    let bundled: boolean | null = null;
    gen.mockImplementation(async () => { bundled = isInCreditBundle(); return PKG; });
    save.mockResolvedValue('j-1');
    const iv = '11111111-1111-4111-8111-111111111111';
    const r = await designJourneyFromInterview({ companyId: 'c', userId: 'u', interviewId: iv, plan, answers: {} });
    expect(bundled).toBe(true);
    expect(r).toMatchObject({ journeyId: 'j-1', charged: getCreditCost('journey-ai-generate') });
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({ preferTriggerEvent: 'customer.created' }));
    // ★ 0930 Codex 1R — 과금 키에 회사 id · 확정은 초안 저장 CT(settleDraftCharge)가 원장 기준으로.
    expect(claimed).toHaveBeenCalledWith('c', `journey-interview:c:${iv}:p1`);
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ cost: getCreditCost('journey-ai-generate'), chargeKey: `journey-interview:c:${iv}:p1#1` }));
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('이미 과금된 요청(재시작 · 만료 뒤 재전송)은 AI 를 부르지 않는다', async () => {
    claimed.mockRejectedValue(new Error('이 요청으로 만든 여정 초안이 이미 있어요.'));
    await expect(designJourneyFromInterview({ companyId: 'c', userId: 'u', interviewId: '55555555-5555-4555-8555-555555555555', plan, answers: {} })).rejects.toThrow('이미 있어요');
    expect(gen).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('같은 요청이 다시 오면 초안을 또 만들지 않는다', async () => {
    gen.mockResolvedValue(PKG);
    save.mockResolvedValue('j-2');
    const iv = '22222222-2222-4222-8222-222222222222';
    const a = await designJourneyFromInterview({ companyId: 'c', userId: 'u', interviewId: iv, plan, answers: {} });
    const b = await designJourneyFromInterview({ companyId: 'c', userId: 'u', interviewId: iv, plan, answers: {} });
    expect(a.journeyId).toBe(b.journeyId);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('저장 실패는 차감 CT 안에서(환불 = CT 테스트) · AI 결과가 깨지면 1회 재요청', async () => {
    gen.mockRejectedValueOnce(new Error('JSON 파싱 실패')).mockResolvedValue(PKG);
    save.mockRejectedValue(new Error('저장 실패'));
    await expect(designJourneyFromInterview({ companyId: 'c', userId: 'u', interviewId: '33333333-3333-4333-8333-333333333333', plan, answers: {} })).rejects.toThrow('저장 실패');
    expect(gen).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenCalledTimes(1);
  });
  it('회신번호가 없으면 AI 를 부르지 않는다', async () => {
    cbs.mockResolvedValue([]);
    await expect(designJourneyFromInterview({ companyId: 'c', userId: 'u', interviewId: '44444444-4444-4444-8444-444444444444', plan, answers: {} })).rejects.toThrow('회신번호');
    expect(gen).not.toHaveBeenCalled();
  });
});

describe('이어붙이기 점검', () => {
  const J = (id: string, over: Partial<MapJourney>): MapJourney => ({
    id, name: id, status: 'active', lane: 'signup', band: 'flow', triggerEvent: 'customer.created', triggerLabel: '신규 가입', startKind: 'event',
    goalExitEnabled: true, goalKind: 'purchase', goalLabel: '구매 확인', notices: [], allowReentry: true, autoReentry: false, thresholdRecipients: null,
    targetSummary: '', broadAudience: false, counts: { activeNow: 5, entered30d: 0, goalMet30d: 0, completed30d: 0 },
    pendingGoalExit: null, exitsBeforeFirst: null, steps: [], graph: { edges: [], exitSlots: [], issues: [] },
    lock: { level: 'copy_only', reason: '' }, capability: null, updatedAt: null, ...over,
  });
  const L = (from: string, to: string | null, state: MapLine['state'], toTrigger = 'purchase.first'): MapLine => ({
    id: `${from}->${to || toTrigger}`, fromJourneyId: from, toJourneyId: to, fromTrigger: 'x', toTrigger, toLabel: '첫 구매', state,
    tier: state === 'connected' ? 'solid' : state === 'no_receiver' ? 'empty' : 'warn', reason: 'r', goalMet: 0, handedOver: null, handedOver7d: null,
  });
  const MAP = (journeys: MapJourney[], lines: MapLine[]): LifecycleMap => ({
    generatedAt: '', judgedAt: null, lanes: [], journeys, lines, ghosts: [], overlaps: [], lockedTriggers: [], costs: { generate: 3, activate: 200 },
  });
  it('새는 선 = 보내는 여정 자동 종료 켜기(켜진 여정도 가능 · 진행 중 인원 동봉)', () => {
    const rows = buildAttachCheck(MAP([J('A', { goalExitEnabled: false }), J('B', { triggerEvent: 'purchase.first', lane: 'first_purchase' })], [L('A', 'B', 'leak')]), ['A']);
    expect(rows[0].fix).toEqual({ action: 'goal_exit_on', journeyId: 'A', label: '목표를 이루면 멈춤 켜기', activeCount: 5 });
  });
  it('재진입 막힘 = 켜진 받는 여정은 일시정지하고 고치기 · 초안은 바로 고치기', () => {
    const B = J('B', { triggerEvent: 'cdp.purchase', lane: 'repurchase', allowReentry: false });
    expect(buildAttachCheck(MAP([J('A', {}), B], [L('A', 'B', 'reentry_off')]), ['A'])[0].fix!.action).toBe('pause_and_allow_reentry');
    const Bd = { ...B, status: 'draft' };
    expect(buildAttachCheck(MAP([J('A', {}), Bd], [L('A', 'B', 'reentry_off')]), ['A'])[0].fix!.action).toBe('allow_reentry_on');
  });
  it('받는 여정 없음 = 만들기 · 같은 사건의 켜진 여정이 있는 초안 = 중복 경고 · 앞 여정 제안', () => {
    const rows = buildAttachCheck(MAP([
      J('D', { status: 'draft', triggerEvent: 'purchase.first', lane: 'first_purchase' }),
      J('X', { triggerEvent: 'purchase.first', lane: 'first_purchase' }),
    ], [L('D', null, 'no_receiver', 'cdp.purchase')]), ['D']);
    expect(rows.find((r) => r.kind === 'outgoing')!.fix).toMatchObject({ action: 'create', triggerEvent: 'cdp.purchase' });
    expect(rows.some((r) => r.kind === 'duplicate')).toBe(true);
    expect(rows.find((r) => r.kind === 'suggest_sender')!.fix).toMatchObject({ action: 'create', triggerEvent: 'customer.created' });
  });
});
