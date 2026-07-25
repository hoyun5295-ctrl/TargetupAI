import { describe, it, expect } from 'vitest';
import { evaluateSnapshot, type MonitorState } from './pay-ingest-monitor';

const MIN = 60_000;
// 2026-07-25 12:00 KST 고정 기준(테스트는 시계에 의존하지 않는다)
const T0 = Date.UTC(2026, 6, 25, 3, 0, 0);

const snap = (o: Partial<{ aborted: number; uptime: number; today: number; latest: string }>) => ({
  abortedConnects: o.aborted ?? 23,
  connections: 59188,
  uptimeSec: o.uptime ?? 1_589_149,
  todayRows: o.today ?? 100,
  latestDestDt: o.latest ?? '20260725',
});

const stateAt = (o: Partial<MonitorState> = {}): MonitorState => ({
  abortedConnects: 23,
  uptimeSec: 1_589_149,
  todayRows: 100,
  lastIngestProgressAt: T0,
  observedDay: '20260725',
  ...o,
});

describe('evaluateSnapshot — 통계DB 트립와이어 판정 (2026-07-25)', () => {
  it('첫 관측은 기준선만 잡고 판정하지 않는다 — 부팅 직후 오탐 차단', () => {
    const v = evaluateSnapshot(null, snap({}), T0);
    expect(v.abortedSpike).toBeNull();
    expect(v.ingestStall).toBeNull();
    expect(v.nextState.abortedConnects).toBe(23);
    expect(v.nextState.lastIngestProgressAt).toBe(T0);
  });

  it('평소 증가폭(실측 하루 1~2건)은 알리지 않는다', () => {
    const v = evaluateSnapshot(stateAt(), snap({ aborted: 25 }), T0 + 10 * MIN);
    expect(v.abortedSpike).toBeNull();
  });

  it('★ 인증 실패 급증은 잡는다 — 10분에 20건이면 평소 16일치', () => {
    const v = evaluateSnapshot(stateAt(), snap({ aborted: 23 + 20 }), T0 + 10 * MIN);
    expect(v.abortedSpike).toEqual({ delta: 20 });
  });

  it('임계 바로 아래는 안 잡는다 (경계)', () => {
    const v = evaluateSnapshot(stateAt(), snap({ aborted: 23 + 19 }), T0 + 10 * MIN);
    expect(v.abortedSpike).toBeNull();
  });

  it('DB 재시작(uptime 감소)이면 판정하지 않고 기준선만 다시 잡는다 — 카운터가 0부터 다시 센다', () => {
    const v = evaluateSnapshot(stateAt(), snap({ aborted: 3, uptime: 120 }), T0 + 10 * MIN);
    expect(v.dbRestarted).toBe(true);
    expect(v.abortedSpike).toBeNull();
    expect(v.ingestStall).toBeNull();
    expect(v.nextState.abortedConnects).toBe(3);
    expect(v.nextState.uptimeSec).toBe(120);
  });

  it('재시작 시 델타가 음수여도 급증으로 오판하지 않는다', () => {
    const v = evaluateSnapshot(stateAt({ abortedConnects: 5000 }), snap({ aborted: 1, uptime: 60 }), T0 + 10 * MIN);
    expect(v.abortedSpike).toBeNull();
  });

  it('★ 적재가 늘고 있으면 정체가 아니다 — 강문희 push 정상', () => {
    const v = evaluateSnapshot(stateAt(), snap({ today: 140 }), T0 + 10 * MIN);
    expect(v.ingestStall).toBeNull();
    expect(v.nextState.lastIngestProgressAt).toBe(T0 + 10 * MIN);
  });

  it('★ 행이 안 늘어도 임계(120분) 전에는 안 알린다 — 야간 소강 오탐 차단', () => {
    const v = evaluateSnapshot(stateAt(), snap({ today: 100 }), T0 + 60 * MIN);
    expect(v.ingestStall).toBeNull();
  });

  it('★ 120분 넘게 행이 안 늘면 적재 정체로 알린다 — 방화벽 오설정 감지', () => {
    const v = evaluateSnapshot(stateAt(), snap({ today: 100 }), T0 + 130 * MIN);
    expect(v.ingestStall).toEqual({ stalledMin: 130, todayRows: 100 });
  });

  it('정체 시간은 마지막 증가 시점부터 누적된다 — 주기마다 리셋되지 않는다', () => {
    let st = stateAt();
    let v = evaluateSnapshot(st, snap({ today: 100 }), T0 + 60 * MIN);
    expect(v.ingestStall).toBeNull();
    v = evaluateSnapshot(v.nextState, snap({ today: 100 }), T0 + 125 * MIN);
    expect(v.ingestStall?.stalledMin).toBe(125);
  });

  it('★ 날짜가 바뀌면 오늘 행 수가 0부터라 정체로 오판하지 않는다', () => {
    // 전날 12:00 기준선 → 다음날 00:10 관측. todayRows가 100 → 0으로 줄지만 정상이다.
    const prev = stateAt({ observedDay: '20260725', todayRows: 5000, lastIngestProgressAt: T0 });
    const nextDay = Date.UTC(2026, 6, 25, 15, 10, 0); // KST 2026-07-26 00:10
    const v = evaluateSnapshot(prev, snap({ today: 0, latest: '20260726' }), nextDay);
    expect(v.ingestStall).toBeNull();
    expect(v.nextState.observedDay).toBe('20260726');
    expect(v.nextState.lastIngestProgressAt).toBe(nextDay);
  });

  it('급증과 정체는 동시에 잡힌다 — 방화벽 사고 시 둘 다 일어난다', () => {
    const v = evaluateSnapshot(stateAt(), snap({ aborted: 23 + 50, today: 100 }), T0 + 130 * MIN);
    expect(v.abortedSpike).toEqual({ delta: 50 });
    expect(v.ingestStall?.stalledMin).toBe(130);
  });

  it('임계를 인자로 낮추면 그대로 반영된다(운영 조정 가능)', () => {
    const v = evaluateSnapshot(stateAt(), snap({ aborted: 26 }), T0 + 10 * MIN, { abortedThreshold: 3, stallMin: 5 });
    expect(v.abortedSpike).toEqual({ delta: 3 });
  });
});
