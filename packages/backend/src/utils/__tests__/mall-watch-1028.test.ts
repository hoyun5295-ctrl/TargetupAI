/**
 * 자사몰 연동 감시 2단 · SDK 허용 판(★ 2026-10-28 자사몰 대비 K10 2단 · K15 M25) — 행동 시험
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const alerts: any[] = [];
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async (p: any) => { alerts.push(p); return 1; }) }));
const monitorRows: any[] = [];
vi.mock('../mall-integration-monitor', () => ({ loadMallIntegrationMonitor: vi.fn(async () => monitorRows) }));
const q = vi.fn(async (..._a: any[]) => ({ rows: [] as any[] }));
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (q as any)(...a) }));

import { isUnusualSilence, runMallWatchPass } from '../mall-watch-worker';
import { SERVED_SDK_VERSIONS } from '../sdk-serve';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const base = { id: 'i1', companyId: 'c1', companyName: '시험몰', provider: 'woocommerce', mallId: 'w.example', problem: null, unknownStatuses: [], received30d: 50, lastReceivedAt: '2026-10-27T12:00:00Z' };

beforeEach(() => { alerts.length = 0; monitorRows.length = 0; q.mockReset(); q.mockImplementation(async () => ({ rows: [] })); });

describe('침묵 판정 = 그 몰의 30일 최장 간격보다 길 때만', () => {
  it('최장 간격 6시간 · 지금 24시간 = 침묵 · 최장 48시간 = 아님 · 30일 5건 미만 · 간격 모름 = 아님', () => {
    expect(isUnusualSilence(base, 6 * 3600, NOW)).toBe(true);
    expect(isUnusualSilence(base, 48 * 3600, NOW)).toBe(false);
    expect(isUnusualSilence({ ...base, received30d: 4 }, 60, NOW)).toBe(false);
    expect(isUnusualSilence(base, undefined, NOW)).toBe(false);
  });
});

describe('경보 회차', () => {
  it('사람 조치 · 긴 침묵 · 모르는 상태 = 경보 · 기다리면 풀리는 문제 = 경보 0', async () => {
    monitorRows.push(
      { ...base, id: 'a', problem: { kind: 'action', cause: 'ip_not_allowed' }, provider: 'godo', mallId: 'godo', received30d: 0, lastReceivedAt: null },
      { ...base, id: 'b', problem: { kind: 'transient', cause: 'rate_limited' }, received30d: 0, lastReceivedAt: null },
      { ...base, id: 'c' },
      { ...base, id: 'd', mallId: 'x.example', received30d: 0, lastReceivedAt: null, unknownStatuses: [{ status: 'wc-custom', count: 3 }] },
    );
    q.mockImplementation(async () => ({ rows: [{ company_id: 'c1', source: 'woocommerce', mall: 'w.example', max_gap: 3600 }] }));
    expect(await runMallWatchPass(NOW)).toBe(3);
    expect(alerts.map((a) => a.dedupKey)).toEqual(['mall-action:a:ip_not_allowed', 'mall-silence:c', 'mall-unknown-status:c1:woocommerce:wc-custom']);
    expect(alerts.every((a) => !JSON.stringify(a).match(/[0-9a-f]{8}-[0-9a-f]{4}-/))).toBe(true);   // 문자에 내부 번호 0
  });
});

describe('SDK 허용 판(M25)', () => {
  it('목록 = 폴더의 판 중 내주는 것 · 최신 판 포함', () => {
    expect(SERVED_SDK_VERSIONS).toContain('v0.3.11');
    expect(new Set(SERVED_SDK_VERSIONS).size).toBe(SERVED_SDK_VERSIONS.length);
  });
});
