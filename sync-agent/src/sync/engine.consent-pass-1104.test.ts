/**
 * ★ 2026-11-04 1.7.6 고객 실행 = 세대(원장 패스) → 고객 적재 → 공개
 * 설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §3-2 ② · ⑤ · ⑥ — 순서 · 실패 때 멈추는 자리를 손으로 적은 기대값과 맞춘다.
 * 번호 = 도달 불가 합성(0100008…).
 */
import { describe, it, expect, vi } from 'vitest';
import { SyncEngine, type SyncEngineConfig } from './engine';
import type { IDbConnector, RawRow } from '../db/types';
import type { SyncStateManager } from './state';
import { isRetryableError } from '../api/retry';

// Zod 탈락 = 이름이 zod-drop 인 행(정규화가 거의 모든 칸을 맞는 형으로 바꿔 자연 값으로는 만들기 어렵다 · 떨어진 행을 엔진이 다루는 경계만 본다)
vi.mock('../types/customer', async (orig) => {
  const m = await orig<typeof import('../types/customer')>();
  return {
    ...m,
    validateCustomers: (rows: Record<string, unknown>[]) => {
      const r = m.validateCustomers(rows.filter((x) => x.name !== 'zod-drop'));
      const dropped = rows.filter((x) => x.name === 'zod-drop').map((raw) => ({ raw, errors: m.CustomerSchema.safeParse({}).error! }));
      return { valid: r.valid, invalid: [...r.invalid, ...dropped] };
    },
  };
});

const P1 = '01000080001';
const P2 = '01000080002';
const ROWS: RawRow[] = [
  { PHONE: P1, NAME: 'a', SMS: 'Y' },
  { PHONE: P1, NAME: 'b', SMS: 'N' },
  { PHONE: P2, NAME: 'c', SMS: '' },
];

function makeDb(rows: RawRow[], total = rows.length): IDbConnector {
  return {
    dbType: 'mysql',
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    testConnection: async () => true,
    getTables: async () => ['CUSTOMER'],
    getColumns: async () => [{ name: 'PHONE', dataType: 'varchar', nullable: true }],
    fetchIncremental: async () => [],
    fetchAll: async (_t: string, limit: number, offset: number) => rows.slice(offset, offset + limit),
    getRowCount: async () => total,
  };
}

function makeState(agentId: string | null = 'agent-1'): SyncStateManager {
  return {
    getState: () => ({ agentId }),
    getLastSyncAt: () => null,
    updateAfterSync: () => {},
    updateFullSyncAt: () => {},
  } as unknown as SyncStateManager;
}

const config = (o: Partial<SyncEngineConfig> = {}): SyncEngineConfig => ({
  batchSize: 2,
  customerTable: 'CUSTOMER',
  purchaseTable: '',
  timestampColumn: 'updated_at',
  fallbackToFullSync: true,
  customerMapping: { PHONE: 'phone', NAME: 'name', SMS: 'sms_opt_in' },
  purchaseMapping: {},
  ...o,
});

function makeApi(over: Partial<Record<string, any>> = {}) {
  const calls: string[] = [];
  const api: any = {
    consentPassStart: vi.fn(async () => { calls.push('start'); return { passId: 'pass-1' }; }),
    consentPassStage: vi.fn(async () => { calls.push('stage'); }),
    consentPassStageDone: vi.fn(async () => { calls.push('stage-done'); }),
    syncCustomers: vi.fn(async (req: any) => { calls.push(`load:${req.consentBatch}`); return { data: { upsertedCount: req.customers.length } }; }),
    consentPassComplete: vi.fn()
      .mockImplementationOnce(async () => { calls.push('complete'); return 'applying'; })
      .mockImplementation(async () => { calls.push('complete'); return 'done'; }),
    sendLog: vi.fn(async () => {}),
    ...over,
  };
  return { api, calls };
}

describe('1.7.6 고객 실행 = 세대 → 적재 → 공개', () => {
  it('순서 = start → 원장 묶음 → stage-done → 적재(패스 번호 · 요청 순번) → complete(보낸 요청 수) 를 done 까지', async () => {
    const { api, calls } = makeApi();
    await new SyncEngine(makeDb(ROWS), api, makeState(), config()).runFull('customers');
    expect(calls).toEqual(['start', 'stage', 'stage', 'stage-done', 'load:0', 'load:1', 'complete', 'complete']);
    const staged = api.consentPassStage.mock.calls.flatMap((c: any[]) => c[2]);
    expect(staged).toEqual([
      { phone: P1, sms_opt_in: true, sms_opt_in_unknown: null },
      { phone: P1, sms_opt_in: false, sms_opt_in_unknown: null },
      { phone: P2, sms_opt_in: null, sms_opt_in_unknown: null },
    ]);
    expect(api.consentPassStage.mock.calls[0].slice(0, 2)).toEqual(['agent-1', 'pass-1']);
    const load = api.syncCustomers.mock.calls[0][0];
    expect([load.agentId, load.consentPassId]).toEqual(['agent-1', 'pass-1']);
    expect(api.consentPassComplete.mock.calls[0]).toEqual(['agent-1', 'pass-1', 2]);
  });

  it('Codex 구현 1R #2 · Zod 에서 떨어진 행의 거부도 근거로 싣는다 · 고객 행이 0건인 묶음도 근거가 있으면 보내고 요청 수에 센다', async () => {
    const rows: RawRow[] = [
      { PHONE: P1, NAME: 'a', SMS: 'Y' }, { PHONE: P1, NAME: 'zod-drop', SMS: 'N' },   // 1묶음 = 유효 1 + 떨어짐 1(거부)
      { PHONE: P2, NAME: 'zod-drop', SMS: 'N' },                                       // 2묶음 = 떨어짐 1(거부)뿐
    ];
    const { api } = makeApi();
    await new SyncEngine(makeDb(rows), api, makeState(), config()).runFull('customers');
    const loads = api.syncCustomers.mock.calls.map((c: any[]) => c[0]);
    expect(loads.map((l: any) => [l.consentBatch, l.customers.length])).toEqual([[0, 1], [1, 0]]);
    expect(loads[0].consentEvidence).toEqual([{ phone: P1, sms_opt_in: false, sms_opt_in_unknown: null }]);
    expect(loads[1].consentEvidence).toEqual([{ phone: P2, sms_opt_in: false, sms_opt_in_unknown: null }]);
    expect(api.consentPassComplete.mock.calls[0]).toEqual(['agent-1', 'pass-1', 2]);
  });

  it('적재 요청 하나라도 보내지 못하면 complete 하지 않는다(다음 실행에 새 패스)', async () => {
    const { api, calls } = makeApi({
      syncCustomers: vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue({ data: { upsertedCount: 1 } }),
    });
    await new SyncEngine(makeDb(ROWS), api, makeState(), config()).runFull('customers');
    expect(calls).not.toContain('complete');
    expect(api.consentPassComplete).not.toHaveBeenCalled();
  });

  it('원장 묶음이 실패하면 고객 적재 · 공개를 하지 않는다', async () => {
    const { api } = makeApi({ consentPassStage: vi.fn().mockRejectedValue(new Error('timeout')) });
    const r = await new SyncEngine(makeDb(ROWS), api, makeState(), config()).runFull('customers');
    expect(api.syncCustomers).not.toHaveBeenCalled();
    expect(api.consentPassStageDone).not.toHaveBeenCalled();
    expect(r.errors.some((e) => e.code === 'CONSENT_PASS_FAILED' && e.operational)).toBe(true);
  });

  it('원장 패스가 총 행 수보다 덜 읽히면(도중 끊김) stage-done · 적재를 하지 않는다', async () => {
    const { api } = makeApi();
    await new SyncEngine(makeDb(ROWS, 5), api, makeState(), config()).runFull('customers');
    expect(api.consentPassStageDone).not.toHaveBeenCalled();
    expect(api.syncCustomers).not.toHaveBeenCalled();
  });

  it('complete 가 abandoned(서버가 받은 근거 수 ≠ 보낸 수) = 멈추고 운영 오류', async () => {
    const { api } = makeApi({ consentPassComplete: vi.fn(async () => 'abandoned') });
    await new SyncEngine(makeDb(ROWS), api, makeState(), config()).runFull('customers');
    expect(api.consentPassComplete).toHaveBeenCalledTimes(1);
    expect(api.sendLog.mock.calls.some((c: any[]) => /CONSENT_PUBLISH_FAILED/.test(c[0].errorMessage || ''))).toBe(true);
  });

  it('구매 실행 · 에이전트 번호 없음 · dry run = 세대 없음(지금 동작 그대로)', async () => {
    const a = makeApi();
    await new SyncEngine(makeDb(ROWS), a.api, makeState(null), config()).runFull('customers');
    expect(a.api.consentPassStart).not.toHaveBeenCalled();
    expect(a.api.syncCustomers.mock.calls[0][0].consentPassId).toBeUndefined();
    const b = makeApi();
    await new SyncEngine(makeDb(ROWS), b.api, makeState(), config({ dryRun: true })).runFull('customers');
    expect(b.api.consentPassStart).not.toHaveBeenCalled();
  });

  it('409(세대 상태 어긋남) 는 다시 보내지 않는다', () => {
    expect(isRetryableError({ response: { status: 409 } })).toBe(false);
    expect(isRetryableError({ response: { status: 503 } })).toBe(true);
  });
});
