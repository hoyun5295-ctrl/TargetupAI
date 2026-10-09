/**
 * ★ 2026-10-09 고객 관계 지도 — 설계서 docs/2026-10-09-journey-crm-map-design.md
 *
 * 못 박는 것:
 *   - 칸 편집 정책 한 곳(stepEditPolicy) · PATCH 게이트가 잠금 안에서 같은 함수를 부른다 · 거절 = 409(STEP_EDIT_LOCKED)
 *   - 선 판정(순수): 받는 쪽 = 켜진 것 전부 · 보내는 여정이 켜짐이 아니면 실선 금지(sender_off = 비어 있음) · 휴면 기준일 다름
 *   - 숫자 한 벌: 여정마다 창(30~180일) · 옛 30일 필드 없음 · 출구 자리 밖 위치는 가장 가까운 출구 자리에 더한다
 *   - AI 진단 계획(순수): 실측이면 실측 간격 · 표본 미달이면 참고 간격 표기 · 휴면 두 여정 같은 기준일 · 이미 있음/잠김 상태
 *   - 추천 시점 덮어쓰기 = 프리셋 고정 뒤(순서) · 칸 수 모자라면 재요청 대상
 *   - 시연 v2: 결정적 · 시드 끝 = 어제 · 시드와 매일이 같은 원장 키 · 상품 주기가 데이터에 있다 · 여정 표 직접 쓰기 0
 *   - 지도 배치(프론트 순수 함수): 그릴 수 있는 선은 빠짐없이 · 같은 열 카드 겹침 0 · 칸은 카드 안
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../company-data-profile', () => ({ getCompanyJourneyFacts: vi.fn() }));

import { query } from '../../config/database';
import { getCompanyJourneyFacts } from '../company-data-profile';
import { stepEditPolicy, blockedStepEditGroups } from '../journey-step-edit-policy';
import { buildLifecycleMap, computeMapLines, mapWindowDays, journeyEndNote, type LineJourneyInput } from '../journey-lifecycle-map';
import { buildFlowPlan, dormantDaysFromRhythm, recoRequestId } from '../journey-opportunities';
import { applyRecoTiming } from '../journey-ai-generator';
import { buildSeedData, buildDailyBatch, demoTimeline, timelinePurchaseRow, purchasesOn, dayNumber } from '../demo-data';
import type { PurchaseRhythm } from '../journey-product';
import { layoutMap, L } from '../../../../frontend/src/utils/journey-map-layout';

const q = query as unknown as ReturnType<typeof vi.fn>;
const facts = getCompanyJourneyFacts as unknown as ReturnType<typeof vi.fn>;
const ALL_FACTS = {
  canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true, hasGrade: true, hasGradeOrder: true,
  hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true,
};
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('칸 편집 정책 — 한 곳 · 묶음별', () => {
  const groups = (status: string, inProgress: number) => {
    const p = stepEditPolicy(status, inProgress);
    return [p.copy, p.timing, p.structure, p.ops];
  };
  it('상태 × 진행 중 표', () => {
    expect(groups('draft', 5)).toEqual([true, true, true, true]);
    expect(groups('paused', 0)).toEqual([true, true, true, true]);
    expect(groups('paused', 3)).toEqual([true, true, false, true]);
    expect(groups('active', 9)).toEqual([true, false, false, true]);
    expect(groups('ended', 0)).toEqual([false, false, false, false]);
  });
  it('막힌 묶음 — 켜진 여정 문안은 allowActiveMessageEdit 로만 · 이미지는 구조 · 담당자 알림은 운영', () => {
    const active = stepEditPolicy('active', 1);
    expect(blockedStepEditGroups(active, { messageTemplate: 'x' }, 'active')).toEqual(['copy']);
    expect(blockedStepEditGroups(active, { messageTemplate: 'x', allowActiveMessageEdit: true }, 'active')).toEqual([]);
    expect(blockedStepEditGroups(active, { mmsImagePaths: ['a'], allowActiveMessageEdit: true }, 'active')).toEqual(['structure']);
    expect(blockedStepEditGroups(active, { delayHours: 24 }, 'active')).toEqual(['timing']);
    expect(blockedStepEditGroups(active, { notifyManagerOnPretest: true }, 'active')).toEqual([]);
    const pausedBusy = stepEditPolicy('paused', 2);
    expect(blockedStepEditGroups(pausedBusy, { stepType: 'condition', conditionJsonb: {} }, 'paused')).toEqual(['structure']);
    expect(blockedStepEditGroups(pausedBusy, { delayHours: 48, messageTemplate: 'y' }, 'paused')).toEqual([]);
  });
  it('PATCH 게이트 = 잠금 안에서 진행 중을 세고 같은 정책 · 거절은 409 코드(일반 Error 500 아님)', () => {
    const b = src('journey-builder.ts');
    const body = b.slice(b.indexOf('export async function updateJourneyStep('), b.indexOf('// ★ 2026-08-02 §13-1 — 저장 후 스텝 추가·삭제'));
    expect(body).toContain('withJourneyValidationReset(companyId, journeyId, async (run, journey) => {');
    expect(body).toContain('await assertStepEditAllowed(run, journey.status);');
    expect(body).toContain("countInProgressExecutions(run, journeyId)");
    expect(body).toContain("new JourneyStepGateError(stepEditBlockedMessage(policy, blocked), 'STEP_EDIT_LOCKED')");
    expect(body).not.toContain('활성 상태 여정은 문안(본문·제목)만 수정할 수 있습니다');
    // 라우트가 대기 방식 · 보낼 시각을 넘긴다(편집 창 "보내는 시각도 정하기"가 저장되게)
    const r = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf8');
    const patch = r.slice(r.indexOf("router.patch('/operator/journeys/:id/steps/:stepId'"), r.indexOf("router.post('/operator/journeys/:id/steps'"));
    expect(patch).toContain('delayMode: delayMode !== undefined ? delayMode : undefined');
    expect(patch).toContain('if (err instanceof JourneyStepGateError)');
  });
});

describe('선 판정(순수)', () => {
  const J = (id: string, triggerEvent: string, over: Partial<LineJourneyInput> = {}): LineJourneyInput => ({
    id, status: 'active', triggerEvent, goalExitEnabled: true, allowReentry: true, filters: {}, ...over,
  });
  const cap = () => null;
  it('받는 쪽 = 켜진 것 전부(상품 여정 둘이면 선 둘)', () => {
    const lines = computeMapLines([J('F', 'purchase.first'), J('P1', 'purchase.product'), J('P2', 'purchase.product'), J('PD', 'purchase.product', { status: 'draft' })], cap);
    const toProduct = lines.filter((l) => l.fromJourneyId === 'F' && l.toTrigger === 'purchase.product');
    expect(toProduct.map((l) => l.toJourneyId).sort()).toEqual(['P1', 'P2']);
    expect(toProduct.every((l) => l.state === 'connected')).toBe(true);
  });
  it('켜진 받는 쪽이 없으면 대표 하나에 점선 한 가닥(초안 덤불 0)', () => {
    const lines = computeMapLines([J('A', 'customer.created'), J('B1', 'purchase.first', { status: 'draft' }), J('B2', 'purchase.first', { status: 'draft' })], cap);
    expect(lines.filter((l) => l.fromJourneyId === 'A')).toHaveLength(1);
    expect(lines[0].state).toBe('receiver_draft');
  });
  it('보내는 여정이 켜짐이 아니면 실선 금지(sender_off)', () => {
    const lines = computeMapLines([J('A', 'customer.created', { status: 'draft' }), J('B', 'purchase.first')], cap);
    expect(lines[0].state).toBe('sender_off');
  });
  it('휴면 → 복귀 기준일이 다르면 손봐야 함 · 같으면 이어짐', () => {
    const diff = computeMapLines([J('D', 'customer.dormant', { filters: { dormant_days: 60 } }), J('R', 'customer.dormant_return')], cap);
    expect(diff[0].state).toBe('dormant_mismatch');
    expect(diff[0].reason).toContain('휴면 60일 · 복귀 30일');
    const same = computeMapLines([J('D', 'customer.dormant', { filters: { dormant_days: 60 } }), J('R', 'customer.dormant_return', { filters: { dormant_days: 60 } })], cap);
    expect(same[0].state).toBe('connected');
  });
});

describe('숫자 창 · 바닥 줄', () => {
  const node = (h: number | null) => ({ cumulativeMaxHours: h }) as any;
  it('창 = 마지막 칸 + 7일 · 30~180일', () => {
    expect(mapWindowDays({ nodes: [node(0), node(72)] })).toBe(30);
    expect(mapWindowDays({ nodes: [node(45 * 24)] })).toBe(52);
    expect(mapWindowDays({ nodes: [node(400 * 24)] })).toBe(180);
  });
  it('바닥 줄 = 목표 종료 · 목표 종류 · 계약 출구', () => {
    expect(journeyEndNote('customer.created', true, 'purchase')).toBe('구매가 확인되면 여기서 끝나요');
    expect(journeyEndNote('customer.created', false, 'purchase')).toBe('구매해도 끝까지 보냅니다');
    expect(journeyEndNote('customer.birthday_approaching', false, 'purchase')).toBe('마지막 문자를 보내면 끝나요');
    expect(journeyEndNote('purchase.product', true, 'purchase')).toBe('같은 상품을 다시 사면 여기서 끝나요');
    expect(journeyEndNote('customer.points_expiring', true, 'points_used')).toBe('포인트를 쓰면 여기서 끝나요');
  });
});

describe('생애 지도 응답 — 숫자 한 벌', () => {
  beforeEach(() => { q.mockReset(); facts.mockReset(); facts.mockResolvedValue(ALL_FACTS); });
  it('옛 30일 필드 없음 · 코호트 합 · 출구 자리 밖 위치는 마지막 출구 자리에 더한다 · 자사몰 문 안내', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/FROM journeys\s+WHERE company_id/.test(sql)) {
        return { rows: [{ id: 'A', name: '가입', status: 'active', trigger_event: 'customer.created', trigger_filters: {}, start_kind: 'event', goal_exit_enabled: true, goal_kind: 'purchase', allow_reentry: false, auto_reentry_enabled: false, updated_at: null }] };
      }
      if (/FROM journey_steps\s+WHERE journey_id = ANY/.test(sql)) {
        return { rows: [1, 2, 3].map((o) => ({ id: `s${o}`, journey_id: 'A', step_order: o, step_type: 'message', delay_hours: o === 1 ? 0 : 48, channel: 'lms', is_ad: true, preview: '안녕' })) };
      }
      if (/status IN \('active', 'paused'\)\s+GROUP BY journey_id, current_step_order/.test(sql)) return { rows: [{ journey_id: 'A', k: 1, active_now: 4, in_progress: 5 }] };
      if (/GROUP BY e.journey_id, e.status, e.current_step_order/.test(sql)) {
        return { rows: [
          { journey_id: 'A', status: 'goal_met', k: 1, n: 2 },
          { journey_id: 'A', status: 'goal_met', k: 7, n: 3 },   // 칸 수를 넘는 위치(점프 · 옛 행) → 마지막 출구 자리(2)
          { journey_id: 'A', status: 'completed', k: 3, n: 6 },
          { journey_id: 'A', status: 'active', k: 1, n: 4 },
        ] };
      }
      if (/JOIN journey_step_logs l/.test(sql)) return { rows: [{ journey_id: 'A', step_id: 's1', reached: 15 }, { journey_id: 'A', step_id: 's2', reached: 9 }] };
      if (/FROM cdp_events\s+WHERE company_id = \$1::uuid\s+AND event_name = 'purchase'/.test(sql)) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    });
    const m = await buildLifecycleMap('c-mall');
    const j = m.journeys[0];
    expect(Object.keys(j.counts).sort()).toEqual(['activeNow', 'completed', 'entered', 'goalMet', 'inProgress']);
    expect(j.counts).toMatchObject({ activeNow: 4, inProgress: 5, entered: 15, goalMet: 5, completed: 6 });
    expect(j.windowDays).toBe(30);
    expect(j.steps.map((s) => s.reached)).toEqual([15, 9, 0]);
    expect(j.steps.map((s) => s.exitsAfter)).toEqual([2, 3, null]);
    expect(j.steps[1].waitingHere).toBe(4);
    expect(j.notices.join()).toContain('환영 문자 대신 첫 구매 여정');
    expect(j.endNote).toBe('구매가 확인되면 여기서 끝나요');
    expect(j.edit.copy).toBe(true);
  });
});

describe('AI 진단 계획(순수)', () => {
  const rhythm = (over: Partial<PurchaseRhythm> = {}): PurchaseRhythm => ({
    door: 'ledger', buyers: 2000, repeaters: 1500,
    firstToSecond: { p25: 31, p50: 40, p75: 48, sample: 1800 },
    gap: { p50: 38, p75: 46, p90: 54, sample: 6700 },
    ...over,
  });
  it('실측이면 실측 간격 · 휴면 두 여정 같은 기준일 · 이미 있음/잠김', () => {
    const plan = buildFlowPlan(rhythm(), new Set(['customer.created']), { dormant_return: { available: false, reason: '구매 연동이 필요해요' } } as any);
    const by = (ev: string) => plan.find((p) => p.triggerEvent === ev)!;
    expect(by('customer.created').status).toBe('exists');
    expect(by('purchase.first')).toMatchObject({ daysFromStart: [1, 40, 48], measured: true, status: 'ready' });
    expect(by('cdp.purchase').daysFromStart).toEqual([3, 38]);
    expect(by('customer.dormant').dormantDays).toBe(54);
    expect(by('customer.dormant_return').dormantDays).toBe(54);
    expect(by('customer.dormant_return').status).toBe('locked');
  });
  it('표본 미달이면 참고 간격(표기) · 이탈 기준일은 지어내지 않는다(null → 기본 30)', () => {
    const thin = rhythm({ firstToSecond: { p25: null, p50: null, p75: null, sample: 3 }, gap: { p50: null, p75: null, p90: null, sample: 4 } });
    expect(dormantDaysFromRhythm(thin)).toBeNull();
    const plan = buildFlowPlan(thin, new Set(), {});
    const first = plan.find((p) => p.triggerEvent === 'purchase.first')!;
    expect(first.measured).toBe(false);
    expect(first.evidence).toContain('표본 3건');
    expect(plan.find((p) => p.triggerEvent === 'customer.dormant')!.dormantDays).toBe(30);
    expect(buildFlowPlan(null, new Set(), {}).every((p) => p.daysFromStart.every((d, i, a) => i === 0 || d > a[i - 1]))).toBe(true);
  });
  it('이탈 기준일 = 간격 p90 을 30~365 로 묶음', () => {
    expect(dormantDaysFromRhythm(rhythm({ gap: { p50: 5, p75: 8, p90: 12, sample: 50 } }))).toBe(30);
    expect(dormantDaysFromRhythm(rhythm({ gap: { p50: 200, p75: 300, p90: 500, sample: 50 } }))).toBe(365);
  });
});

describe('추천 시점 덮어쓰기', () => {
  const st = (n: number) => Array.from({ length: n }, (_, i) => ({ stepOrder: i + 1, stepType: 'message' as const, delayHours: 999, channel: 'lms' as const, messageTemplate: `m${i}`, subject: '', isAd: true, stepIntent: '' }));
  it('누적 일수 → 칸 사이 대기 · 넘치면 자름 · 모자라면 throw(재요청 대상)', () => {
    expect(applyRecoTiming(st(4), [1, 40, 48]).map((s) => s.delayHours)).toEqual([24, 39 * 24, 8 * 24]);
    expect(() => applyRecoTiming(st(2), [1, 40, 48])).toThrow();
  });
  it('덮어쓰기는 프리셋 고정(조건 비움) 뒤 · 휴면 기준일을 싣는다', () => {
    const g = src('journey-ai-generator.ts');
    const preset = g.indexOf('if (presetTrigger) {\n    triggerEvent = presetTrigger;');
    const reco = g.indexOf('if (input.timing && !productFilters) {');
    expect(preset).toBeGreaterThan(0);
    expect(reco).toBeGreaterThan(preset);
    expect(g.slice(reco, reco + 600)).toContain('dormant_days: Math.round(dd)');
  });
  it('추천 초안 라우트는 계획을 서버가 다시 계산한다(화면 간격 · 칸 수를 쓰지 않는다)', () => {
    const r = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf8');
    const route = r.slice(r.indexOf("router.post('/operator/journeys-reco/design'"), r.indexOf('// POST /api/ai/operator/journeys — 신규 여정 생성'));
    expect(route).toContain('const plan = await recoPlanFor(companyId, String(triggerEvent || \'\'));');
    expect(route).toContain('timing: { daysFromStart: plan.daysFromStart, dormantDays: plan.dormantDays }');
    expect(route).not.toMatch(/timing:\s*\{\s*daysFromStart:\s*shownDays/);
  });
});

describe('시연 데이터 v2', () => {
  it('결정적 · 시드 끝 = 어제 · 시드와 매일이 같은 원장 키(겹쳐도 이중 적재 0)', () => {
    const seed = buildSeedData('2026-10-12');
    expect(seed.purchases.every((p) => p.purchase_date < '2026-10-12')).toBe(true);
    expect(seed.purchases.some((p) => p.purchase_date.startsWith('2026-10-11'))).toBe(true);
    const day = buildDailyBatch('2026-10-12');
    const seedKeys = new Set(seed.purchases.map((p) => p.source_row_key));
    const seedDayRows = day.buyerPurchases.filter((p) => Number(p.source_row_key.split('-')[2]) < 3000);
    expect(seedDayRows.length).toBeGreaterThan(0);
    expect(seedDayRows.every((p) => seedKeys.has(p.source_row_key))).toBe(true);
    expect(demoTimeline(42)).toEqual(demoTimeline(42));
    const b = demoTimeline(42).buys[0];
    if (b) expect(timelinePurchaseRow(42, b)).toEqual(timelinePurchaseRow(42, b));
  });
  it('하루치 구매는 그 영업일만', () => {
    const day = buildDailyBatch('2026-10-15');
    expect([...day.newPurchases, ...day.buyerPurchases].every((p) => p.purchase_date.startsWith('2026-10-14'))).toBe(true);
    expect(day.buyerIndexes.every((i) => purchasesOn(i, dayNumber('2026-10-14')).length > 0)).toBe(true);
  });
  it('상품 주기가 데이터에 있다(토너 45일 · 시트 마스크 21일 근처)', () => {
    const seed = buildSeedData('2026-10-09');
    const gapsOf = (code: string) => {
      const per = new Map<string, string[]>();
      for (const p of seed.purchases.filter((x) => x.product_code === code)) {
        const a = per.get(p.customer_phone) || [];
        const d = p.purchase_date.slice(0, 10);
        if (!a.includes(d)) a.push(d);
        per.set(p.customer_phone, a);
      }
      const gaps: number[] = [];
      for (const ds of per.values()) { ds.sort(); for (let i = 1; i < ds.length; i++) gaps.push((Date.parse(ds[i]) - Date.parse(ds[i - 1])) / 864e5); }
      gaps.sort((x, y) => x - y);
      return gaps[Math.floor(gaps.length / 2)];
    };
    expect(gapsOf('SK-101')).toBeGreaterThanOrEqual(40);
    expect(gapsOf('SK-101')).toBeLessThanOrEqual(52);
    expect(gapsOf('SK-108')).toBeLessThanOrEqual(26);
  });
  it('합성 데이터는 여정 표를 직접 쓰지 않는다(결과 소급 0 · 목업 0)', () => {
    const d = src('demo-data.ts');
    expect(d).not.toMatch(/journey_executions|journey_step_logs|INSERT INTO journeys|UPDATE journeys/);
  });
});

describe('지도 배치(프론트 순수 함수)', () => {
  const step = (o: number, kind = 'message') => ({
    stepId: `x${o}`, order: o, kind, channel: 'lms', isAd: true, timingLabel: `D+${o}`, intervalLabel: '1일 뒤', preview: '',
    waitingHere: 0, reached: 0, exitsAfter: 0, pendingHere: null, outOfWindow: false,
  });
  const journey = (id: string, lane: string, triggerEvent: string, status = 'active', n = 3) => ({
    id, name: id, status, lane, band: 'flow', triggerEvent, triggerLabel: triggerEvent, startKind: 'event', goalExitEnabled: true,
    goalKind: 'purchase', goalLabel: '구매 확인', notices: [], allowReentry: true, autoReentry: false, thresholdRecipients: 500,
    targetSummary: '', broadAudience: false, counts: { activeNow: 0, inProgress: 0, entered: 0, goalMet: 0, completed: 0 }, windowDays: 30,
    pendingGoalExit: null, exitsBeforeFirst: 0, endNote: '', entryReplace: false,
    steps: Array.from({ length: n }, (_, i) => step(i + 1)),
    graph: { edges: [], exitSlots: Array.from({ length: n }, (_, i) => i), issues: [] },
    edit: { copy: true, timing: true, structure: true, ops: true, reason: '' },
    capability: null, updatedAt: null, lineageId: null, canNewVersion: false, olderVersions: [],
  });
  const line = (from: string, to: string | null, toTrigger: string) => ({
    id: `${from}->${to || toTrigger}`, fromJourneyId: from, toJourneyId: to, fromTrigger: '', toTrigger, toLabel: '', state: 'connected', tier: 'solid',
    reason: '', goalMet: 0, handedOver: null, handedOver7d: null, receiverEntered: null, windowDays: 30, fix: null,
  });
  const data: any = {
    generatedAt: '', judgedAt: null, lanes: [], overlaps: [], lockedTriggers: [], costs: { generate: 3, activate: 200 },
    journeys: [
      journey('A', 'signup', 'customer.created'), journey('F', 'first_purchase', 'purchase.first'),
      journey('R', 'repurchase', 'cdp.purchase', 'active', 2), journey('P1', 'product', 'purchase.product', 'active', 2),
      journey('P2', 'product', 'purchase.product', 'active', 2), journey('D', 'winback', 'customer.dormant', 'active', 2),
      journey('A2', 'signup', 'customer.created', 'draft'), journey('A3', 'signup', 'customer.created', 'paused', 4),
    ],
    lines: [line('A', 'F', 'purchase.first'), line('F', 'R', 'cdp.purchase'), line('F', 'P1', 'purchase.product'), line('F', 'P2', 'purchase.product'), line('R', 'P1', 'purchase.product'), line('D', null, 'customer.dormant_return')],
    ghosts: [{ lane: 'winback', triggerEvent: 'customer.dormant_return', label: '휴면 복귀', available: true, reason: '', createMode: 'preset' }],
  };
  const opts = { statusFilter: 'all' as const, search: '', expanded: new Set<string>(), collapsed: new Set<string>(), showQuiet: new Set<string>(), preview: true };
  it('그릴 수 있는 선은 빠짐없이(빈 자리 포함) · 같은 보내는 여정의 선은 ◆ 하나에서', () => {
    const lay = layoutMap(data, opts);
    expect(lay.lines.map((l) => l.line.id).sort()).toEqual(data.lines.map((l: any) => l.id).sort());
    const fromF = lay.lines.filter((l) => l.line.fromJourneyId === 'F').map((l) => l.d.split(' C ')[0]);
    expect(new Set(fromF).size).toBe(1);
    expect(lay.cards.find((c) => c.journeyId === 'F')!.diamond).not.toBeNull();
  });
  it('같은 열 상자 겹침 0 · 칸은 카드 안 · 상품은 띠(열 아래)', () => {
    const lay = layoutMap(data, opts);
    const boxes = [...lay.cards, ...lay.ghosts, ...lay.quiet];
    for (let i = 0; i < boxes.length; i++) {
      for (let k = i + 1; k < boxes.length; k++) {
        const a = boxes[i]; const b = boxes[k];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    for (const c of lay.cards) for (const s of c.steps) {
      expect(s.y).toBeGreaterThanOrEqual(c.y);
      expect(s.y + s.h).toBeLessThanOrEqual(c.y + c.h);
    }
    const band = lay.band!;
    const p1 = lay.cards.find((c) => c.journeyId === 'P1')!;
    expect(p1.y).toBeGreaterThan(band.y);
    expect(Math.max(...lay.cards.filter((c) => !c.journeyId.startsWith('P')).map((c) => c.y + c.h))).toBeLessThan(band.y);
  });
  it('레인마다 켜짐 · 멈춤 앞 2개만 척추 · 초안은 묶음 한 줄 · 펼치면 카드', () => {
    const lay = layoutMap(data, opts);
    expect(lay.cards.find((c) => c.journeyId === 'A')!.open).toBe(true);
    expect(lay.cards.find((c) => c.journeyId === 'A3')!.open).toBe(true);
    expect(lay.cards.some((c) => c.journeyId === 'A2')).toBe(false);
    expect(lay.quiet.find((qz) => qz.lane === 'signup')!.label).toBe('초안 1');
    const opened = layoutMap(data, { ...opts, showQuiet: new Set(['signup']) });
    expect(opened.cards.some((c) => c.journeyId === 'A2')).toBe(true);
    expect(L.colW).toBeGreaterThan(200);
  });
});

describe('추천 요청 키(결정적 · Codex 3R)', () => {
  it('같은 회사 · 계획 = 같은 키(날짜 없음 · 자정을 넘겨도 같다) · 회사나 내용이 다르면 다른 키 · uuid 모양', () => {
    const plan = { triggerEvent: 'purchase.first', daysFromStart: [1, 40, 48], dormantDays: null };
    const a = recoRequestId('c1', plan);
    expect(recoRequestId('c1', { ...plan })).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(recoRequestId('c2', plan)).not.toBe(a);
    expect(recoRequestId('c1', { ...plan, daysFromStart: [1, 41, 48] })).not.toBe(a);
    expect(recoRequestId('c1', { ...plan, triggerEvent: 'cdp.purchase' })).not.toBe(a);
  });
  it('라우트는 화면 키를 받지 않고 서버가 계산한 키로 부른다', () => {
    const r = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf8');
    const route = r.slice(r.indexOf("router.post('/operator/journeys-reco/design'"), r.indexOf('// POST /api/ai/operator/journeys — 신규 여정 생성'));
    expect(route).toContain('interviewId: recoRequestId(companyId, plan),');
    expect(route).not.toMatch(/recoRequestId\([^)]*toISOString/);
    expect(route).not.toContain('recoId');
  });
});

describe('Codex 1R 정정', () => {
  it('추천 간격은 계획에서 칸 사이 365일 안으로 맞추고 사실을 적는다 · 생성기는 넘치면 몰래 자르지 않고 거부', () => {
    const r: PurchaseRhythm = { door: 'ledger', buyers: 50, repeaters: 40, firstToSecond: { p25: 300, p50: 400, p75: 900, sample: 30 }, gap: { p50: 38, p75: 46, p90: 54, sample: 60 } };
    const first = buildFlowPlan(r, new Set(), {}).find((p) => p.triggerEvent === 'purchase.first')!;
    expect(first.daysFromStart).toEqual([1, 366, 731]);
    expect(first.evidence).toContain('최대 365일');
    const st = [1, 2].map((i) => ({ stepOrder: i, stepType: 'message' as const, delayHours: 0, channel: 'lms' as const, messageTemplate: 'm', subject: '', isAd: true, stepIntent: '' }));
    expect(() => applyRecoTiming(st, [1, 400])).toThrow('최대 대기');
  });
  it('초안 · 멈춤만 있는 레인은 다시 권하지 않는다(drafted)', () => {
    const plan = buildFlowPlan(null, new Set(['customer.created']), {}, new Set(['purchase.first']));
    expect(plan.find((p) => p.triggerEvent === 'customer.created')!.status).toBe('exists');
    expect(plan.find((p) => p.triggerEvent === 'purchase.first')!.status).toBe('drafted');
  });
  it('시드: 시연 표식이 파일 · 해시보다 먼저 · 빈 회사만 이어받는다 · 이 회사 키 파일이 없으면 새로 발급(파일 → 해시)', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'setup-demo-company.ts'), 'utf8');
    const create = s.indexOf('await createCompanyCore(');
    const mark = s.indexOf("UPDATE companies SET is_demo = true, use_db_sync = true WHERE id = $1::uuid`, [companyId]);", create);
    const file = s.indexOf('fs.writeFileSync(secretOut', create);
    const hash = s.indexOf('api_secret_hash = $2', file);
    expect(create).toBeGreaterThan(0);
    expect(mark).toBeGreaterThan(create);
    expect(file).toBeGreaterThan(mark);
    expect(hash).toBeGreaterThan(file);
    expect(s).toContain("e.code !== COMPANY_CODE || Number(e.u) + Number(e.c) + Number(e.p) > 0");
    expect(s).toContain('k[1].trim() === apiKey');
  });
  it('편집 창: 늦게 온 AI 응답은 요청한 칸이 지금 칸일 때만 · 요청 중 · 저장 중 · 고친 내용 있으면 칸 이동 막음', () => {
    const m = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'journey', 'map', 'MapStepEditModal.tsx'), 'utf8');
    expect(m).toContain('if (selectedRef.current !== forStep)');
    expect(m).toContain("if (aiBusy || saving)");
    expect(m).toContain('if (dirty)');
    expect(m).not.toMatch(/onClick=\{\(\) => setSelected\(/);
  });
  it('진단 초안: 통신 예외를 칸마다 잡아 부분 성공을 넘기고 요청 키는 다시 열어도 유지', () => {
    const d = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'journey', 'map', 'JourneyDiagnosisPanel.tsx'), 'utf8');
    expect(d).toContain('return { ok: false, d: null, lost: true };');
    expect(d).not.toContain('recoId.current = uuid();');
    expect(d).not.toContain('productReq.current = new Map();');
    // Codex 2R — 본문을 못 읽으면 결과 모름(빈 객체로 바꿔 계속 가지 않는다) · 키는 페이지가 소유(창 언마운트에도 유지)
    expect(d).toContain('const d = await res.json();');
    expect(d).toContain("if (!d || typeof d.success !== 'boolean') return { ok: false, d: null, lost: true };");
    // Codex 3R — 요청 키는 화면 수명이 아니라 내용에서 결정적(상품 = 화면 해시 · 추천 흐름 = 서버 계산)
    expect(d).toContain('requestId: await productRequestId(pr.key, pr.medianDays)');
    expect(d).not.toMatch(/randomUUID|recoId/);
  });
  it('시드: 빈 회사 판정에서 회사 생성이 함께 만드는 시스템 싱크 계정 하나만 뺀다(Codex 2R)', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'setup-demo-company.ts'), 'utf8');
    expect(s).toContain("AND NOT (is_system = true AND login_id = 'system_sync_' || $1::text)) AS u,");
  });
});
