// replaces: none
/**
 * C147 충전 내역 반영 뒤 잔액 — 계약 시험(★ 2026-11-20 설계서 docs/2026-11-20-c147-agent-charge-balance-after-design.md §4)
 *   순수 판정 planFillMarks 표 = Codex 설계 1R ~ 10R 시나리오 · 소스 계약(부팅 줄 · 조회 CT · 화면 숫자 판정 · 중계 시계 안 씀).
 *   발송ID = 시험용 형식값(C147A · C147B) · 실제 계정 아님.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  planFillMarks, hasFillEvidence, fillMarkKey, FILL_BALANCE_TICK_MS,
  type FillMark, type FillPlanInput, type FillMarkInsert, type FillMarkUpdate,
} from '../agent-fill-balance';
import { closePayStatsConnection, type FillLedgerRow } from '../pay-stats';
import net from 'net';

const MIN = 60_000;
const S = Date.UTC(2026, 10, 20, 0, 0, 0);       // 연속 관측 시작
const T = S + 31 * MIN;                            // 차단 해제 뒤
const A = 'C147A';
const B = 'C147B';

const row = (seqNo: number, applied: boolean, amount = 10_000, id = A): FillLedgerRow => ({ seqNo, agentSendId: id, amount, applied });

/** PG 쓰기 모의(조건부 UPDATE 의미 그대로) */
function apply(marks: FillMark[], plan: { inserts: FillMarkInsert[]; updates: FillMarkUpdate[] }): FillMark[] {
  const map = new Map(marks.map((m) => [fillMarkKey(m.seqNo, m.agentSendId), { ...m }]));
  for (const i of plan.inserts) {
    const k = fillMarkKey(i.seqNo, i.agentSendId);
    if (map.has(k)) continue; // ON CONFLICT DO NOTHING
    map.set(k, { seqNo: i.seqNo, agentSendId: i.agentSendId, amount: i.amount, state: i.state, lastPendingAt: i.pendingAt, balanceBefore: i.balanceBefore, appliedSeenAt: i.appliedSeenAt, ...({ skipReason: i.skipReason } as any) });
  }
  for (const u of plan.updates) {
    const k = fillMarkKey(u.seqNo, u.agentSendId);
    const m = map.get(k);
    if (!m || m.state !== u.expect.state || m.lastPendingAt !== u.expect.lastPendingAt || m.appliedSeenAt !== u.expect.appliedSeenAt) continue;
    map.set(k, { ...m, state: u.next.state, lastPendingAt: u.next.lastPendingAt, balanceBefore: u.next.balanceBefore, appliedSeenAt: u.next.appliedSeenAt, ...({ balanceAfter: u.next.balanceAfter, skipReason: u.next.skipReason } as any) });
  }
  return [...map.values()];
}

/** 한 회차 = 판정 + 쓰기 모의 · r2 생략 = r1 과 같음 */
function tick(marks: FillMark[], at: number, r1: FillLedgerRow[], bal: Record<string, number | null>, extra: Partial<FillPlanInput> = {}) {
  const input: FillPlanInput = {
    r1, r2: extra.r2 ?? r1,
    balances: new Map(Object.entries(bal)),
    marks, r1Ms: at, r2Ms: at + 1_000,
    tickMs: FILL_BALANCE_TICK_MS, captureOpen: true, continuousSince: S, ...extra,
  };
  const plan = planFillMarks(input);
  return { plan, marks: apply(marks, plan) };
}
const find = (marks: FillMark[], seq: number, id = A) => marks.find((m) => m.seqNo === seq && m.agentSendId === id) as any;

describe('증거 판정 hasFillEvidence', () => {
  it.each([
    [10_000, 1_000, 11_000, true],     // 충전 · 그대로 실림
    [10_000, 1_000, 6_000, true],      // 충전 · 절반
    [10_000, 1_000, 5_999, false],     // 충전 · 절반 못 미침
    [10_000, 1_000, 900, false],       // 충전인데 줄어듦
    [-10_000, 20_000, 10_000, true],   // 차감
    [-10_000, 20_000, 15_000, true],   // 차감 절반
    [-10_000, 20_000, 15_001, false],  // 차감 절반 못 미침
    [-10_000, 20_000, 21_000, false],  // 차감인데 늘어남
    [0, 1_000, 1_000, false],          // 금액 0
    [10_000, null, 11_000, false],     // 앞 값 모름
    [10_000, 1_000, null, false],      // 뒤 값 모름
  ])('금액 %s · 앞 %s · 뒤 %s → %s', (f, b, a, want) => {
    expect(hasFillEvidence(f, b, a)).toBe(want);
  });
});

describe('planFillMarks 기본 흐름', () => {
  it('반영 대기 → 반영 → 증거 = captured(뒤 값 = 이번 회차 잔액)', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false)], { [A]: 1_000 }));
    expect(find(m, 1)).toMatchObject({ state: 'pending', lastPendingAt: T, balanceBefore: 1_000 });
    ({ marks: m } = tick(m, T + 30_000, [row(1, false)], { [A]: 1_200 }));
    expect(find(m, 1)).toMatchObject({ state: 'pending', lastPendingAt: T + 30_000, balanceBefore: 1_200 }); // 반영 직전 값으로 당김
    ({ marks: m } = tick(m, T + 60_000, [row(1, true)], { [A]: 11_150 }));
    expect(find(m, 1)).toMatchObject({ state: 'captured', balanceAfter: 11_150, appliedSeenAt: T + 61_000 });
  });

  it('증거 없음 = applied 유지 → 2 회차 넘으면 no_evidence', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true)], { [A]: 1_000 }));
    expect(find(m, 1).state).toBe('applied');
    ({ marks: m } = tick(m, T + 60_000, [row(1, true)], { [A]: 1_000 }));
    expect(find(m, 1).state).toBe('applied');
    ({ marks: m } = tick(m, T + 90_000, [row(1, true)], { [A]: 1_000 }));
    expect(find(m, 1).state).toBe('applied'); // 반영 처음 본 뒤 정확히 2 회차 = 아직 안
    ({ marks: m } = tick(m, T + 120_000, [row(1, true)], { [A]: 1_000 }));
    expect(find(m, 1)).toMatchObject({ state: 'skipped', skipReason: 'no_evidence' });
  });

  it('증거가 다음 회차에 오면 그때 captured(잔액이 반영 표시보다 늦게 실림)', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, T + 60_000, [row(1, true)], { [A]: 11_000 }));
    expect(find(m, 1)).toMatchObject({ state: 'captured', balanceAfter: 11_000 });
  });

  it('차감 줄 = 잔액이 금액 절반 이상 줄어야 captured', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false, -5_000)], { [A]: 20_000 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true, -5_000)], { [A]: 15_000 }));
    expect(find(m, 1)).toMatchObject({ state: 'captured', balanceAfter: 15_000 });
  });

  it('반영 대기를 본 적 없는 반영 줄 = missed · 반영 처음 본 시각 = R2', () => {
    const { marks } = tick([], T, [row(1, true)], { [A]: 1_000 });
    expect(find(marks, 1)).toMatchObject({ state: 'skipped', skipReason: 'missed', appliedSeenAt: T + 1_000 });
  });

  it('공백(마지막 반영 대기 관측이 2 회차보다 오래) = gap', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, T + 90_000, [row(1, true)], { [A]: 11_000 }));
    expect(find(m, 1)).toMatchObject({ state: 'skipped', skipReason: 'gap' });
  });

  it('앞 값 모름 · 뒤 값 모름 = 증거 없음', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false)], { [A]: null }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true)], { [A]: 11_000 }));
    expect(find(m, 1).state).toBe('applied');
    let n: FillMark[] = [];
    ({ marks: n } = tick(n, T, [row(1, false)], { [A]: 1_000 }));
    ({ marks: n } = tick(n, T + 30_000, [row(1, true)], {}));
    expect(find(n, 1).state).toBe('applied');
  });
});

describe('이웃 판정 = 같은 발송ID 다른 줄이 잔액을 아직 바꿀 수 있으면 빈 값(multi)', () => {
  it('① 다른 반영 대기 줄(나이 무관 · 4R · 5R)', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false), row(2, false, 3_000)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true), row(2, false, 3_000)], { [A]: 11_000 }));
    expect(find(m, 1)).toMatchObject({ state: 'skipped', skipReason: 'multi' });
  });

  it('다른 발송ID 의 줄은 이웃이 아니다', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false), row(2, false, 3_000, B)], { [A]: 1_000, [B]: 5 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true), row(2, false, 3_000, B)], { [A]: 11_000, [B]: 5 }));
    expect(find(m, 1).state).toBe('captured');
  });

  it('③ 이미 끝난(missed) 앞 줄을 30분 안에 반영으로 처음 봄 = 2R 연속 충전', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, true), row(2, false)], { [A]: 1_000 })); // 1 = missed(반영 처음 봄 T+1s)
    ({ marks: m } = tick(m, T + 30_000, [row(1, true), row(2, true)], { [A]: 21_000 }));
    expect(find(m, 2)).toMatchObject({ state: 'skipped', skipReason: 'multi' });
  });

  it('③ 30분 넘게 지난 반영 줄은 이웃이 아니다', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, true)], { [A]: 1_000 }));
    const t2 = T + 31 * MIN;
    ({ marks: m } = tick(m, t2, [row(1, true), row(2, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, t2 + 30_000, [row(1, true), row(2, true)], { [A]: 11_000 }));
    expect(find(m, 2).state).toBe('captured');
  });

  it('④ 기록 없는 줄이 이번 회차에 반영으로 처음 보임(6R · 원장 전체 읽기)', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(2, false)], { [A]: 1_000 }));
    // 기록 없던 옛 줄 1 이 같은 회차에 반영으로 보임
    ({ marks: m } = tick(m, T + 30_000, [row(1, true, 4_000), row(2, true)], { [A]: 15_000 }));
    expect(find(m, 2)).toMatchObject({ state: 'skipped', skipReason: 'multi' });
    expect(find(m, 1)).toMatchObject({ state: 'skipped', skipReason: 'missed' });
  });

  it('6R · R1 · R2 사이에 기록 없는 옛 줄이 반영 → 그 회차 관측 기록 → 다음 회차 이웃 ③', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false, 4_000), row(2, false)], { [A]: 1_000 }));
    // 1 의 기록을 지워 「PG 기록 없는 옛 줄」 을 만든다
    m = m.filter((x) => x.seqNo !== 1);
    const r1 = [row(1, false, 4_000), row(2, false)];
    const r2 = [row(1, true, 4_000), row(2, false)];
    ({ marks: m } = tick(m, T + 30_000, r1, { [A]: 5_000 }, { r2 }));
    expect(find(m, 1)).toMatchObject({ state: 'skipped', skipReason: 'missed' }); // 관측은 남는다(7R)
    ({ marks: m } = tick(m, T + 60_000, [row(1, true, 4_000), row(2, true)], { [A]: 15_000 }));
    expect(find(m, 2)).toMatchObject({ state: 'skipped', skipReason: 'multi' });
  });

  it('7R · R1 · R2 어긋난 회차에 본 줄이 그 뒤 원장에서 지워짐 = gone · 30분 이웃', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false, 4_000), row(2, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, T + 30_000, [row(2, false)], { [A]: 1_000 }, { r2: [row(2, false)] })); // 1 이 R1 · R2 둘 다 없음
    expect(find(m, 1)).toMatchObject({ state: 'skipped', skipReason: 'gone', appliedSeenAt: T + 31_000 });
    ({ marks: m } = tick(m, T + 60_000, [row(2, true)], { [A]: 15_000 }));
    expect(find(m, 2)).toMatchObject({ state: 'skipped', skipReason: 'multi' });
  });

  it('R1 에만 있고 R2 에 없는 열린 기록 = 그 회차 gone 아님(다음 회차에 판정)', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, false)], { [A]: 1_000 }, { r2: [] }));
    expect(find(m, 1).state).toBe('pending');
  });

  it('같은 회차에 둘 다 처음 반영 = 둘 다 multi', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false), row(2, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true), row(2, true)], { [A]: 21_000 }));
    expect([find(m, 1).skipReason, find(m, 2).skipReason]).toEqual(['multi', 'multi']);
  });
});

describe('잔액 기록 막힘 = 관측은 남기고 captured 만 0', () => {
  it('R1 ≠ R2 발송ID = 그 회차 captured 0 · applied 로 두고 다음 회차 다시(1R #2)', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false), row(5, false, 1, B)], { [A]: 1_000, [B]: 0 }));
    // 1 은 R1 · R2 모두 반영 · 같은 발송ID 에 새 반영 대기 줄 3 이 R2 에만 생김 = 어긋남
    ({ marks: m } = tick(m, T + 30_000, [row(1, true)], { [A]: 11_000 }, { r2: [row(1, true), row(3, false, 7)] }));
    expect(find(m, 1).state).toBe('skipped'); // 3 = 반영 대기 이웃 → multi
    expect(find(m, 3).state).toBe('pending'); // R2 에서만 본 줄도 기록
  });

  it('R1 ≠ R2 인데 이웃이 아닌 줄 때문(30분 넘은 옛 줄의 금액 칸만 바뀜) = captured 0 · applied 유지 → 다음 회차 captured', () => {
    const old: FillMark = { seqNo: 9, agentSendId: A, amount: 7, state: 'skipped', lastPendingAt: null, balanceBefore: null, appliedSeenAt: T - 40 * MIN };
    let m: FillMark[] = [old];
    ({ marks: m } = tick(m, T, [row(9, true, 7), row(1, false)], { [A]: 1_000 }));
    const { plan, marks } = tick(m, T + 30_000, [row(9, true, 7), row(1, true)], { [A]: 11_000 }, { r2: [row(9, true, 8), row(1, true)] });
    expect(find(marks, 1).state).toBe('applied');
    expect(plan.updates.some((u) => u.next.state === 'captured')).toBe(false);
    ({ marks: m } = tick(marks, T + 60_000, [row(9, true, 8), row(1, true)], { [A]: 11_000 }));
    expect(find(m, 1).state).toBe('captured');
  });

  it('금액이 바뀐 줄 = 처음 기록한 금액으로 판정하지 않는다(구현 1R #1)', () => {
    // R2 에서 금액이 바뀜 = 그 회차 바로 빈 값
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false, 1_000)], { [A]: 0 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true, 1_000)], { [A]: 600 }, { r2: [row(1, true, 100_000)] }));
    expect(find(m, 1)).toMatchObject({ state: 'skipped', skipReason: 'no_evidence' });
    // 증거 없이 applied 로 둔 뒤 R1 · R2 둘 다 바뀐 금액으로 같아짐 = 처음 금액 1,000 의 절반(500)을 넘는 600 이어도 빈 값
    let n: FillMark[] = [];
    ({ marks: n } = tick(n, T, [row(1, false, 1_000)], { [A]: 0 }));
    ({ marks: n } = tick(n, T + 30_000, [row(1, true, 1_000)], { [A]: 0 }));
    expect(find(n, 1).state).toBe('applied');
    ({ marks: n } = tick(n, T + 60_000, [row(1, true, 100_000)], { [A]: 600 }));
    expect(find(n, 1)).toMatchObject({ state: 'skipped', skipReason: 'no_evidence' });
  });

  it('원장 금액 소수 넷째 자리 이하 차이(PG numeric(18,3) 반올림)는 같은 금액', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false, 1_000.5)], { [A]: 0 }));
    m = m.map((x) => ({ ...x, amount: 1_000.5 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true, 1_000.5004)], { [A]: 1_000.5 }));
    expect(find(m, 1).state).toBe('captured');
  });

  it('20초 마감 넘은 회차 = captured 0 · 관측(새 반영 대기 줄)은 기록(8R)', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false), row(9, false, 1, B)], { [A]: 1_000, [B]: 0 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true), row(9, false, 1, B), row(10, false, 1, B)], { [A]: 11_000, [B]: 0 }, { captureOpen: false }));
    expect(find(m, 1).state).toBe('applied');
    expect(find(m, 10, B).state).toBe('pending');
    ({ marks: m } = tick(m, T + 60_000, [row(1, true), row(9, false, 1, B), row(10, false, 1, B)], { [A]: 11_000, [B]: 0 }));
    expect(find(m, 1).state).toBe('captured');
  });

  it('연속 관측 시작 S 없음(실패 · 재시작 뒤 첫 커밋 전) = captured 0', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, T + 30_000, [row(1, true)], { [A]: 11_000 }, { continuousSince: null }));
    expect(find(m, 1)).toMatchObject({ state: 'skipped', skipReason: 'no_evidence' });
  });

  it('앞 잔액 관측이 S + 30분 전 = 증거가 있어도 빈 값(9R #1 경계)', () => {
    let m: FillMark[] = [];
    const t0 = S + 29 * MIN;
    ({ marks: m } = tick(m, t0, [row(1, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, t0 + 30_000, [row(1, true)], { [A]: 11_000 }));
    expect(find(m, 1)).toMatchObject({ state: 'skipped', skipReason: 'no_evidence' });
  });

  it('앞 잔액 관측이 S + 30분 정각 이후 = captured(9R #1 경계 안쪽)', () => {
    let m: FillMark[] = [];
    const t0 = S + 30 * MIN;
    ({ marks: m } = tick(m, t0, [row(1, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, t0 + 30_000, [row(1, true)], { [A]: 11_000 }));
    expect(find(m, 1).state).toBe('captured');
  });

  it('반영 대기를 계속 보면 last_pending_at 이 당겨져 해제 뒤 다시 판정된다', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, S + 10 * MIN, [row(1, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, S + 31 * MIN, [row(1, false)], { [A]: 1_000 }));
    ({ marks: m } = tick(m, S + 31 * MIN + 30_000, [row(1, true)], { [A]: 11_000 }));
    expect(find(m, 1).state).toBe('captured');
  });
});

describe('관측 시각 = 늘 빈 값 쪽(9R #2)', () => {
  it('반영 대기 관측 = R1 시각 · 반영 관측 = R2 시각', () => {
    const { marks } = tick([], T, [row(1, false), row(2, true)], { [A]: 1_000 }, { r1Ms: T, r2Ms: T + 7_000 });
    expect(find(marks, 1).lastPendingAt).toBe(T);
    expect(find(marks, 2).appliedSeenAt).toBe(T + 7_000);
  });

  it('R2 에서 처음 본 반영 = R2 시각부터 30분 이웃', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false)], { [A]: 1_000 }, { r2: [row(1, false), row(2, true, 3)], r1Ms: T, r2Ms: T + 9_000 }));
    expect(find(m, 2).appliedSeenAt).toBe(T + 9_000);
  });
});

describe('조건부 쓰기 = 판정이 본 상태 · 시각을 같이 싣는다', () => {
  it('갱신마다 expect 가 기록 그대로', () => {
    let m: FillMark[] = [];
    ({ marks: m } = tick(m, T, [row(1, false)], { [A]: 1_000 }));
    const { plan } = tick(m, T + 30_000, [row(1, true)], { [A]: 11_000 });
    expect(plan.updates[0].expect).toEqual({ state: 'pending', lastPendingAt: T, appliedSeenAt: null });
  });

  it('첫 회차 = 반영 줄 전부 missed · 반영 대기 줄 전부 pending', () => {
    const { marks } = tick([], T, [row(1, true), row(2, true, 5, B), row(3, false)], { [A]: 1 });
    expect(marks.map((x) => `${x.seqNo}:${x.state}`).sort()).toEqual(['1:skipped', '2:skipped', '3:pending']);
  });
});

describe('소스 계약', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('일꾼 부팅 줄 = app.ts 한 곳', () => {
    expect(strip(src('app.ts')).match(/startAgentFillBalanceWorker\(\)/g)?.length).toBe(1);
  });

  it('조회 라우트가 CT(loadFillBalances · fillMarkKey)를 부른다', () => {
    const r = strip(src('routes/agent-charge-orders.ts'));
    expect(r).toMatch(/loadFillBalances\(rows\)/);
    expect(r).toMatch(/balanceAfter:\s*balances\.get\(fillMarkKey\(r\.seqNo,\s*r\.agentSendId\)\)\s*\?\?\s*null/);
  });

  it('판정 · 원장 읽기는 중계 시계(RsApplyDtTm)를 쓰지 않는다', () => {
    expect(strip(src('utils/agent-fill-balance.ts'))).not.toMatch(/RsApplyDtTm|appliedAt/);
    const read = strip(src('utils/pay-stats.ts')).match(/export async function readFillLedgerAll[\s\S]*?\n}/)?.[0] || '';
    expect(read).toMatch(/SELECT SeqNo, StoreId, FillAmt, RsApplyFlag FROM RSRM_FillAmtHist'/);
    expect(read).not.toMatch(/WHERE|LIMIT/); // 창 없음(6R)
  });

  it('회차의 62 읽기 셋 = 회차 제 연결(공용 풀 무접촉) · 그 연결은 오류 리스너를 단다(구현 3R)', () => {
    const w = strip(src('utils/agent-fill-balance.ts'));
    expect(w.match(/readFillLedgerAll\(payConn, MYSQL_TIMEOUT_MS\)/g)?.length).toBe(2);
    expect(w).toMatch(/queryLedgerBalancesByIds\(\[\.\.\.ids\.values\(\)\], \{ timeoutMs: MYSQL_TIMEOUT_MS, conn: payConn \}\)/);
    expect(w).toMatch(/if \(payConn\) closePayStatsConnection\(payConn\);/); // 소켓까지 닫는 도우미로(구현 4R)
    expect(w).not.toMatch(/payConn\.(destroy|end)\(/);
    const open = strip(src('utils/pay-stats.ts')).match(/export async function openPayStatsConnection[\s\S]*?\n}/)?.[0] || '';
    expect(open).toMatch(/connectTimeout: timeoutMs/);
    expect(open).toMatch(/conn\.on\('error'/);
  });

  it('화면 = 잔액이 숫자일 때만 글', () => {
    const f = strip(readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'manage', 'AgentChargeRequestTab.tsx'), 'utf8'));
    expect(f).toMatch(/typeof l\.balanceAfter === 'number' && Number\.isFinite\(l\.balanceAfter\) && \(/);
    expect(f).toMatch(/잔액 \{formatAgentBalance\(l\.balanceAfter\)\}원/);
  });
});

describe('62 회차 연결 닫기(구현 4R)', () => {
  it('응답 · FIN 을 보내지 않는 상대여도 소켓까지 닫힌다(mysql2 destroy = stream.end 만으로는 남음)', async () => {
    const server = net.createServer({ allowHalfOpen: true }, () => undefined); // 받기만 · 답 0 · FIN 0
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const sock = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
    try {
      await new Promise<void>((r) => sock.once('connect', () => r()));
      const closed = new Promise<boolean>((r) => { sock.once('close', () => r(true)); setTimeout(() => r(false), 1_000); });
      closePayStatsConnection({ destroy: () => { sock.end(); }, connection: { stream: sock } } as any);
      expect(sock.destroyed).toBe(true);
      expect(await closed).toBe(true);
    } finally {
      sock.destroy();
      server.close();
    }
  });
});
