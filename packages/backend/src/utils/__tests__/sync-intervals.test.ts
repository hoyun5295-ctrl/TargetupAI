/**
 * 에이전트 주기 해석 계약 — 온라인 판정이 이 값으로 잘린다.
 *
 * ★ 2026-09-02(2) 신설. 경위: 판정이 "60분 주기"를 상수로 박아 70분/130분으로 잘랐는데
 *   **동기화 주기는 고객사마다 다르고 기본이 360분(6시간)** 이라, 6시간 주기 고객사가 정상인데도
 *   오프라인으로 표시됐다. 값의 자리가 config jsonb ▸ 레거시 컬럼 ▸ 기본값 3겹이라 순서를 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { resolveAgentIntervals, AGENT_INTERVAL_DEFAULTS } from '../sync-intervals';

describe('주기 해석 우선순위 — config ▸ 컬럼 ▸ 기본값', () => {
  it('config가 있으면 config가 이긴다 (원격 설정이 최종 진실)', () => {
    const iv = resolveAgentIntervals(
      { sync_interval_customers: 15, sync_interval_purchases: 20, heartbeat_interval: 5 },
      { sync_interval_customers: 999, sync_interval_purchases: 999 },
    );
    expect(iv).toEqual({ heartbeatMin: 5, customersMin: 15, purchasesMin: 20 });
  });

  it('config에 없으면 레거시 컬럼으로 내려간다', () => {
    const iv = resolveAgentIntervals({}, { sync_interval_customers: 120, sync_interval_purchases: 90 });
    expect(iv.customersMin).toBe(120);
    expect(iv.purchasesMin).toBe(90);
  });

  it('둘 다 없으면 기본값 — 동기화 360분(6시간) · 하트비트 60분', () => {
    expect(resolveAgentIntervals(null, null)).toEqual({
      heartbeatMin: 60, customersMin: 360, purchasesMin: 360,
    });
  });

  it('기본값은 에이전트에게 실제로 내려가는 값과 같아야 한다', () => {
    // routes/sync.ts getSyncConfigForAgent 와 같은 벌(360/360/60). 여기만 바꾸면 화면과 실제가 갈린다.
    expect(AGENT_INTERVAL_DEFAULTS.customersMin).toBe(360);
    expect(AGENT_INTERVAL_DEFAULTS.purchasesMin).toBe(360);
    expect(AGENT_INTERVAL_DEFAULTS.heartbeatMin).toBe(60);
  });
});

describe('망가진 값은 판정을 무너뜨리지 않는다', () => {
  it('0·음수·문자열·NaN이면 기본값으로 되돌린다', () => {
    for (const bad of [0, -5, 'abc', NaN, null, undefined, '']) {
      const iv = resolveAgentIntervals({ sync_interval_customers: bad, heartbeat_interval: bad }, null);
      expect(iv.customersMin, String(bad)).toBe(360);
      expect(iv.heartbeatMin, String(bad)).toBe(60);
    }
  });

  it('숫자 문자열은 받아들인다 (jsonb에서 문자열로 올 수 있다)', () => {
    expect(resolveAgentIntervals({ sync_interval_customers: '30' }, null).customersMin).toBe(30);
  });
});

describe('판정 경계 — 실제 주기로 잘라야 6시간 고객사가 오해받지 않는다', () => {
  const GRACE = 10;
  const judge = (elapsedMin: number, cycleMin: number) =>
    elapsedMin <= cycleMin + GRACE ? 'online'
      : elapsedMin <= cycleMin * 2 + GRACE ? 'delayed' : 'beyond';

  it('6시간 주기 고객사는 3시간이 지나도 정상이다 (종전 130분 고정이면 오프라인이었다)', () => {
    const { customersMin } = resolveAgentIntervals(null, null); // 360
    expect(judge(180, customersMin)).toBe('online');
    expect(130 > 120).toBe(true); // 종전 기준이었다면 이미 넘긴 시간
  });

  it('30분 주기로 조인 고객사는 45분이면 지연이다 (느슨한 고정값이면 못 잡는다)', () => {
    const { customersMin } = resolveAgentIntervals({ sync_interval_customers: 30 }, null);
    expect(judge(45, customersMin)).toBe('delayed');
  });

  it('하트비트 60분 주기에서 70분까지는 정상, 130분 초과면 지연을 넘어선다', () => {
    const { heartbeatMin } = resolveAgentIntervals(null, null); // 60
    expect(judge(70, heartbeatMin)).toBe('online');
    expect(judge(131, heartbeatMin)).toBe('beyond');
  });
});
