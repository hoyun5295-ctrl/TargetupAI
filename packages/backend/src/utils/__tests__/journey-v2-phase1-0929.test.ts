/**
 * 여정 V2 1차 — 생애 지도(읽기 전용) · 그래프 CT · 진입 표식 (2026-09-29 · 설계서 §3 · §4 · §13)
 *
 * 못 박는 것:
 *   - 그래프 = 실행기 규칙(맞으면 다음 · 아니면 지정 칸 · 없으면 여정 끝 · 마지막 칸 뒤 출구 없음 · 모르는 칸 드러냄)
 *   - 선 상태 판정(연결됨 / 새는 선 / 받는 여정 없음 · 초안 · 멈춤 / 재진입 막힘) · 정보 알림은 선에 참여하지 않음
 *   - 진입 표식(__entry) = 커서 배치의 사건 id · 재진입 워커 행은 표식 없음
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../company-data-profile', () => ({ getCompanyJourneyFacts: vi.fn() }));

import { query } from '../../config/database';
import { getCompanyJourneyFacts } from '../company-data-profile';
import { buildJourneyGraph, exitSlotOf, formatInterval } from '../journey-graph';
import { buildLifecycleMap, isInfoAlertJourney } from '../journey-lifecycle-map';
import { planCdpCursorBatch } from '../journey-cdp-cursor';

const q = query as unknown as ReturnType<typeof vi.fn>;
const facts = getCompanyJourneyFacts as unknown as ReturnType<typeof vi.fn>;
const ALL_FACTS = {
  canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true, hasGrade: true, hasGradeOrder: true,
  hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true,
};
const step = (order: number, type: string, over: Record<string, any> = {}) => ({
  id: `s${order}`, step_order: order, step_type: type, delay_hours: 0, channel: 'lms', is_ad: true, ...over,
});

describe('그래프 = 실행기 규칙', () => {
  it('일렬 칸: 시작 → 1 → 2 → 3 → 끝 · 출구는 칸 앞마다(마지막 칸 뒤 없음)', () => {
    const g = buildJourneyGraph([step(1, 'message'), step(2, 'message', { delay_hours: 72 }), step(3, 'message', { delay_hours: 96 })], { goalExitEnabled: true });
    expect(g.edges).toEqual([
      { from: 0, to: 1, kind: 'next' }, { from: 1, to: 2, kind: 'next' }, { from: 2, to: 3, kind: 'next' }, { from: 3, to: -1, kind: 'next' },
    ]);
    expect(g.exitSlots).toEqual([0, 1, 2]);
    expect(g.nodes.map((n) => n.timingLabel)).toEqual(['시작하면 바로', 'D+3', 'D+7']);
    expect(g.nodes[1].intervalLabel).toBe('3일 뒤');
  });
  it('목표 종료가 꺼져 있으면 출구가 없다', () => {
    expect(buildJourneyGraph([step(1, 'message'), step(2, 'message')], { goalExitEnabled: false }).exitSlots).toEqual([]);
  });
  it('조건 칸: 맞으면 다음 · 아니면 지정한 뒤쪽 칸(옛 흐름 그림의 "skip"이 아니다)', () => {
    const g = buildJourneyGraph([step(1, 'message'), step(2, 'condition', { not_met_goto: 4 }), step(3, 'message'), step(4, 'message')], { goalExitEnabled: false });
    expect(g.edges).toContainEqual({ from: 2, to: 3, kind: 'met' });
    expect(g.edges).toContainEqual({ from: 2, to: 4, kind: 'not_met' });
    expect(g.issues).toEqual([]);
  });
  it('조건 칸에 이동 대상이 없으면 아니면 = 여정 끝 · 앞쪽 · 없는 칸 대상은 드러낸다', () => {
    expect(buildJourneyGraph([step(1, 'condition'), step(2, 'message')], { goalExitEnabled: false }).edges)
      .toContainEqual({ from: 1, to: -1, kind: 'not_met_end' });
    expect(buildJourneyGraph([step(1, 'message'), step(2, 'condition', { not_met_goto: 1 })], { goalExitEnabled: false }).issues[0]).toContain('뒤쪽 칸');
    expect(buildJourneyGraph([step(1, 'condition', { not_met_goto: 9 })], { goalExitEnabled: false }).issues[0]).toContain('없습니다');
  });
  it('모르는 칸 종류는 발송되지 않는다고 드러낸다', () => {
    // ★ 0930 V2 4차 — 'end' 는 이제 아는 칸(끝 칸)이다. 모르는 종류의 예는 목록 밖 값으로.
    expect(buildJourneyGraph([step(1, 'mystery')], { goalExitEnabled: false }).issues[0]).toContain('발송되지 않습니다');
  });
  it('사건 대기는 범위로 적는다(D+a~b)', () => {
    const g = buildJourneyGraph([step(1, 'message'), step(2, 'wait', { delay_hours: 24, wait_event_name: 'purchase', wait_timeout_hours: 72 }), step(3, 'message')], { goalExitEnabled: false });
    expect(g.nodes[2].timingLabel).toBe('D+0~3');
    expect(g.nodes[1].waitsForEvent).toBe(true);
  });
  it('날짜축은 기준일 표기', () => {
    const g = buildJourneyGraph([step(1, 'message', { anchor_offset_days: 3 }), step(2, 'message', { anchor_offset_days: 0 })], { goalExitEnabled: false, startKind: 'date_anchor' });
    expect(g.nodes.map((n) => n.timingLabel)).toEqual(['기준일 3일 전', '기준일 당일']);
  });
  it('출구 위치 = 마지막으로 처리한 칸 · 칸 수를 넘으면 마지막 자리에 붙인다', () => {
    const g = buildJourneyGraph([step(1, 'message'), step(2, 'message'), step(3, 'message')], { goalExitEnabled: true });
    expect(exitSlotOf(0, g)).toBe(0);
    expect(exitSlotOf(2, g)).toBe(2);
    expect(exitSlotOf(7, g)).toBe(2);
  });
  it('간격 문구', () => {
    expect(formatInterval(0)).toBe('바로');
    expect(formatInterval(30)).toBe('1일 6시간 뒤');
    expect(formatInterval(0, 'next_business_day')).toBe('다음 평일 오전 9시');
    expect(formatInterval(24, 'relative_at_hour', 10)).toBe('1일 뒤 오전 10시');
  });
});

describe('정보 알림 판정', () => {
  it('메시지 칸이 전부 알림톡 + 광고 아님이면 정보 알림', () => {
    expect(isInfoAlertJourney([{ step_type: 'message', channel: 'kakao', is_ad: false }])).toBe(true);
    expect(isInfoAlertJourney([{ step_type: 'message', channel: 'kakao', is_ad: false }, { step_type: 'message', channel: 'lms', is_ad: true }])).toBe(false);
    expect(isInfoAlertJourney([{ step_type: 'wait' }])).toBe(false);
  });
});

/** 지도 조회 목(mock) — 여정 · 칸 · 집계 SQL 을 돌려준다. */
function mockMap(journeys: any[], steps: any[], extra: { handed?: number; marked?: number } = {}) {
  q.mockImplementation(async (sql: string) => {
    if (/FROM journeys\s+WHERE company_id/.test(sql)) return { rows: journeys };
    if (/FROM journey_steps\s+WHERE journey_id = ANY/.test(sql)) return { rows: steps };
    if (/WITH marked AS/.test(sql)) return { rows: [{ marked: extra.marked ?? 0, handed: extra.handed ?? 0, handed_7d: 0 }] };
    return { rows: [] };
  });
}
const J = (id: string, trigger: string, over: Record<string, any> = {}) => ({
  id, name: id, status: 'active', trigger_event: trigger, trigger_filters: {}, start_kind: 'event',
  goal_exit_enabled: true, goal_kind: 'purchase', allow_reentry: true, auto_reentry_enabled: false, updated_at: null, ...over,
});
const S = (jid: string, order = 1, over: Record<string, any> = {}) => ({ id: `${jid}-${order}`, journey_id: jid, step_order: order, step_type: 'message', delay_hours: 0, channel: 'lms', is_ad: true, preview: '안녕하세요', ...over });

describe('생애 지도 — 선 상태', () => {
  beforeEach(() => { q.mockReset(); facts.mockReset(); facts.mockResolvedValue(ALL_FACTS); });

  it('가입(자동 종료 켜짐) → 첫 구매(켜짐) = 연결됨 · 표식 이전이면 이어받음 = null(측정 전)', async () => {
    mockMap([J('A', 'customer.created'), J('B', 'purchase.first')], [S('A'), S('B')]);
    const m = await buildLifecycleMap('c');
    const ln = m.lines.find((l) => l.fromJourneyId === 'A')!;
    expect(ln.state).toBe('connected');
    expect(ln.tier).toBe('solid');
    expect(ln.handedOver).toBeNull();
  });
  it('보내는 여정 자동 종료 꺼짐 = 새는 선', async () => {
    mockMap([J('A', 'customer.created', { goal_exit_enabled: false }), J('B', 'purchase.first')], [S('A'), S('B')]);
    const ln = (await buildLifecycleMap('c')).lines.find((l) => l.fromJourneyId === 'A')!;
    expect(ln.state).toBe('leak');
    expect(ln.tier).toBe('warn');
  });
  it('받는 여정이 없으면 빈 선 + 레인 유령 카드', async () => {
    mockMap([J('A', 'customer.created')], [S('A')]);
    const m = await buildLifecycleMap('c');
    expect(m.lines.find((l) => l.fromJourneyId === 'A')!.state).toBe('no_receiver');
    expect(m.ghosts.map((g) => g.triggerEvent)).toContain('purchase.first');
  });
  it('레인에 다른 여정이 있어도 받는 여정이 없는 선의 도착점은 유령 카드(트리거당 1장)', async () => {
    // 휴면 전환만 있고 휴면 복귀가 없다 — 이탈·복귀 레인은 비어 있지 않지만 선의 도착점이 있어야 선을 그린다.
    mockMap([J('A', 'customer.dormant'), J('A2', 'customer.dormant', { status: 'paused' })], [S('A'), S('A2')]);
    const m = await buildLifecycleMap('c');
    const g = m.ghosts.filter((x) => x.triggerEvent === 'customer.dormant_return');
    expect(g).toHaveLength(1);
    expect(g[0].lane).toBe('winback');
  });
  it('받는 여정이 초안 = 초안이라 못 받음 · 재진입 꺼진 주문 완료 = 재진입 막힘', async () => {
    mockMap([J('A', 'customer.created'), J('B', 'purchase.first', { status: 'draft' })], [S('A'), S('B')]);
    expect((await buildLifecycleMap('c')).lines[0].state).toBe('receiver_draft');
    mockMap([J('A', 'purchase.first'), J('B', 'cdp.purchase', { allow_reentry: false })], [S('A'), S('B')]);
    expect((await buildLifecycleMap('c')).lines.find((l) => l.toTrigger === 'cdp.purchase')!.state).toBe('reentry_off');
  });
  it('정보 알림(주문 완료 알림톡)은 받는 여정으로 세지 않는다', async () => {
    mockMap([J('A', 'purchase.first'), J('B', 'cdp.purchase')], [S('A'), S('B', 1, { channel: 'kakao', is_ad: false })]);
    const m = await buildLifecycleMap('c');
    expect(m.journeys.find((j) => j.id === 'B')!.band).toBe('info');
    expect(m.lines.find((l) => l.toTrigger === 'cdp.purchase')!.state).toBe('no_receiver');
  });
  it('표식이 있으면 이어받음 숫자를 싣는다', async () => {
    mockMap([J('A', 'customer.created'), J('B', 'purchase.first')], [S('A'), S('B')], { marked: 5, handed: 3 });
    expect((await buildLifecycleMap('c')).lines[0].handedOver).toBe(3);
  });
  it('상시 · 조건 없음 = 전 고객 표시 · 상시 레일', async () => {
    mockMap([J('A', 'custom', { start_kind: 'standing' })], [S('A')]);
    const j = (await buildLifecycleMap('c')).journeys[0];
    expect(j.broadAudience).toBe(true);
    expect(j.band).toBe('standing');
  });
  it('목표 이름 = 목표 종류(포인트 = 포인트 줄어듦) · 가입 + 자동 종료 = 환영 대신 첫 구매 안내', async () => {
    mockMap([J('A', 'customer.created'), J('P', 'customer.points_expiring', { goal_kind: 'points_used' })], [S('A'), S('P')]);
    const m = await buildLifecycleMap('c');
    expect(m.journeys.find((j) => j.id === 'P')!.goalLabel).toBe('포인트 줄어듦');
    expect(m.journeys.find((j) => j.id === 'A')!.goalLabel).toBe('구매 확인');
    expect(m.journeys.find((j) => j.id === 'A')!.notices.join()).toContain('첫 구매 여정이 맞이');
    expect(m.journeys.find((j) => j.id === 'P')!.notices).toEqual([]);
  });
  it('잠금 수준 = 상태별(초안 자유 · 멈춤 끝에 붙이기 · 켜짐 문안만)', async () => {
    mockMap([J('A', 'customer.created', { status: 'draft' }), J('B', 'purchase.first', { status: 'paused' }), J('C', 'cdp.purchase')], [S('A'), S('B'), S('C')]);
    const m = await buildLifecycleMap('c');
    expect(m.journeys.map((j) => j.lock.level)).toEqual(['full', 'append_only', 'copy_only']);
  });
});

describe('진입 표식 재료 — 커서 배치가 사건 id 를 싣는다', () => {
  it('고객별 첫 등장 사건 id', () => {
    const r = planCdpCursorBatch([
      { customerId: 'c1', eventId: 'e1', createdAt: new Date('2026-09-29T01:00:00Z'), occurredAt: new Date('2026-09-29T01:00:00Z') },
      { customerId: 'c1', eventId: 'e2', createdAt: new Date('2026-09-29T02:00:00Z'), occurredAt: new Date('2026-09-29T02:00:00Z') },
    ] as any, 1000, new Date('2026-09-29T03:00:00Z'));
    expect(r.eventIdByCustomer).toEqual({ c1: 'e1' });
  });
  it('진입 INSERT 에 __entry(src=trigger · key) 를 싣는다', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/utils/journey-trigger-watcher.ts'), 'utf8');
    expect(src).toContain("__entry: { src: 'trigger', key: batch.eventIdByCustomer?.[customerId] ?? null }");
  });
});
