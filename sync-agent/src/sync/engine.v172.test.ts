/**
 * 1.7.2 계약 (2026-10-04 싱크·자사몰 전수점검)
 *
 * 1. 실행 한 줄 — 같은 엔진의 전체·증분(원격 명령 포함)은 겹쳐 돌지 않는다(S10). 먼저 줄 선 쪽이 먼저 끝난다(정각 고객 → 구매 · S1).
 * 2. 전송 실패는 로컬 큐에 담지 않는다(S8) — 엔진 생성자에 큐 자리가 없다(타입) · 실패 뒤 기준 시각을 올리지 않는다.
 * 3. 파일 원본(엑셀·CSV): 고객 증분 = 전체 다시 읽기 · 구매는 키가 없으면 잠금(E1).
 * 4. 갱신 시각 컬럼이 없는 구매 + 기본키 없음 = 잠금(매 회차 전체 = 키 없는 중복 · S13).
 */
import { describe, it, expect, vi } from 'vitest';
import { SyncEngine, type SyncEngineConfig } from './engine';
import type { IDbConnector, ColumnInfo, RawRow } from '../db/types';
import type { SyncStateManager } from './state';
import type { ApiClient } from '../api/client';

const cols = (names: string[], pk: string[] = []): ColumnInfo[] =>
  names.map((name) => ({ name, dataType: 'varchar', nullable: true, isPrimaryKey: pk.includes(name) }));

function makeState(lastSyncAt: string | null = null) {
  const calls = { updateAfterSync: 0, setCursor: 0 };
  const state = {
    getState: () => ({ agentId: null }),
    getLastSyncAt: () => lastSyncAt,
    updateAfterSync: () => { calls.updateAfterSync++; },
    updateFullSyncAt: () => {},
    getCursor: () => null,
    setCursor: () => { calls.setCursor++; },
    getIncrementalHold: () => null,
    setIncrementalHold: () => {},
  } as unknown as SyncStateManager;
  return { state, calls };
}

function makeConfig(o: Partial<SyncEngineConfig> = {}): SyncEngineConfig {
  return {
    batchSize: 100,
    customerTable: 'CUSTOMER',
    purchaseTable: 'SALES',
    timestampColumn: 'updated_at',
    fallbackToFullSync: true,
    customerMapping: { PHONE: 'phone' },
    purchaseMapping: { PHONE: 'customer_phone', DT: 'purchase_date' },
    dryRun: false,
    ...o,
  };
}

function baseDb(o: Partial<IDbConnector> = {}): IDbConnector {
  return {
    dbType: 'mysql',
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    testConnection: async () => true,
    getTables: async () => ['CUSTOMER', 'SALES'],
    getColumns: async () => cols(['PHONE', 'DT', 'updated_at']),
    fetchIncremental: async () => [],
    fetchAll: async () => [],
    getRowCount: async () => 0,
    ...o,
  };
}

describe('실행 한 줄 (S10 · S1)', () => {
  it('runFull 과 runIncremental 을 동시에 불러도 겹치지 않고 먼저 부른 순서대로 끝난다', async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const db = baseDb({
      dbType: 'excel', // 파일 원본: 고객 증분 = 전체(경로를 짧게 하려고)
      getRowCount: async (t: string) => {
        log.push(`start:${t}`);
        if (t === 'CUSTOMER') await gate; // 고객 전체가 길게 걸린다
        log.push(`end:${t}`);
        return 0;
      },
    });
    const engine = new SyncEngine(db, null, makeState().state, makeConfig({ purchaseKeyColumns: ['PHONE'] }));
    const a = engine.runFull('customers');
    const b = engine.runIncremental('purchases'); // 파일 원본 + 키 지정 = 전체
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toEqual(['start:CUSTOMER']); // 구매는 고객이 끝나기 전에 시작하지 않는다
    release();
    await Promise.all([a, b]);
    expect(log).toEqual(['start:CUSTOMER', 'end:CUSTOMER', 'start:SALES', 'end:SALES']);
  });

  it('앞 실행이 던져도 줄이 막히지 않는다', async () => {
    let n = 0;
    const db = baseDb({ dbType: 'excel', getRowCount: async () => { if (n++ === 0) throw new Error('boom'); return 0; } });
    const engine = new SyncEngine(db, null, makeState().state, makeConfig());
    await expect(engine.runFull('customers')).rejects.toThrow('boom');
    await expect(engine.runFull('customers')).resolves.toMatchObject({ mode: 'full' });
  });
});

describe('전송 실패 = 기준 시각 멈춤 (S8)', () => {
  it('비키셋 경로에서 API 실패가 있으면 updateAfterSync 를 부르지 않는다', async () => {
    const rows: RawRow[] = [{ PHONE: '01000000001', updated_at: '2026-10-04 00:00:00' }];
    let served = false;
    const db = baseDb({
      dbType: 'oracle', // 키셋 없는 어댑터(옛 경로) — mock 과 같은 모양
      fetchIncremental: async () => { if (served) return []; served = true; return rows; },
    });
    const api = { syncCustomers: vi.fn(async () => { throw new Error('ECONNRESET'); }) } as unknown as ApiClient;
    const { state, calls } = makeState('2026-10-03T00:00:00.000Z');
    const engine = new SyncEngine(db, api, state, makeConfig());
    const r = await engine.runIncremental('customers');
    expect(r.errors.some((e) => e.code === 'API_SEND_FAILED')).toBe(true);
    expect(calls.updateAfterSync).toBe(0);
  });
});

describe('파일 원본 (E1)', () => {
  it('고객 증분 = 전체 다시 읽기(옛 해시 비교 경로를 타지 않는다)', async () => {
    const fetchIncremental = vi.fn(async () => []);
    const fetchAll = vi.fn(async () => []);
    const db = baseDb({ dbType: 'csv', fetchIncremental, fetchAll, getRowCount: async () => 0 });
    // 기준 시각이 있어도(옛 경로라면 fetchIncremental 을 탔을 상태) 전체로 간다
    const engine = new SyncEngine(db, null, makeState('2026-10-03T00:00:00.000Z').state, makeConfig());
    const r = await engine.runIncremental('customers');
    expect(r.mode).toBe('full');
    expect(fetchIncremental).not.toHaveBeenCalled();
  });

  it('구매는 키가 없으면 잠금(INCREMENTAL_LOCKED_FILE_SOURCE) · 전체도 다시 돌지 않는다', async () => {
    const getRowCount = vi.fn(async () => 0);
    const db = baseDb({ dbType: 'excel', getRowCount });
    const engine = new SyncEngine(db, null, makeState().state, makeConfig());
    const r = await engine.runIncremental('purchases');
    expect(r.errors[0]?.code).toBe('INCREMENTAL_LOCKED_FILE_SOURCE');
    expect(getRowCount).not.toHaveBeenCalled();
  });
});

describe('갱신 시각 없음 + 기본키 없음 구매 = 잠금 (S13)', () => {
  it('fallbackToFullSync 여도 전체를 돌지 않는다', async () => {
    const getRowCount = vi.fn(async () => 0);
    const db = baseDb({
      dbType: 'mysql',
      getColumns: async () => cols(['PHONE', 'DT']), // updated_at 없음 · PK 없음
      getRowCount,
      fetchIncrementalKeyset: async () => ({ rows: [], meta: [] }),
      getSourceId: () => 'src',
    });
    const engine = new SyncEngine(db, null, makeState().state, makeConfig());
    const r = await engine.runIncremental('purchases');
    expect(r.errors[0]?.code).toBe('INCREMENTAL_LOCKED_NO_TS_NO_PK');
    expect(getRowCount).not.toHaveBeenCalled();
  });

  it('기본키가 있으면 종전처럼 전체로 대체한다(키가 실려 멱등)', async () => {
    const getRowCount = vi.fn(async () => 0);
    const db = baseDb({
      dbType: 'mysql',
      getColumns: async () => cols(['ID', 'PHONE', 'DT'], ['ID']),
      getRowCount,
      fetchIncrementalKeyset: async () => ({ rows: [], meta: [] }),
      fetchMaxCursor: async () => null,
      getSourceId: () => 'src',
    });
    const engine = new SyncEngine(db, null, makeState().state, makeConfig());
    const r = await engine.runIncremental('purchases');
    expect(r.mode).toBe('full');
    expect(getRowCount).toHaveBeenCalled();
  });
});

describe('구매 키를 정했는데 못 쓰면 키 없이 보내지 않는다 (Codex 1004 R1 high)', () => {
  const salesRows: RawRow[] = [{ PHONE: '01000000001', DT: '2026-10-01', ORDER_NO: 'A1' }];

  it('지정 키 컬럼이 원본에 없으면 = 전체 잠금(PURCHASE_KEY_UNUSABLE) · 전송 0', async () => {
    const fetchAll = vi.fn(async () => salesRows);
    const api = { syncPurchases: vi.fn(async () => ({ data: { insertedCount: 1 } })) } as unknown as ApiClient;
    const db = baseDb({ dbType: 'excel', fetchAll, getRowCount: async () => 1, getColumns: async () => cols(['PHONE', 'DT']) });
    const engine = new SyncEngine(db, api, makeState().state, makeConfig({ purchaseKeyColumns: ['ORDER_NO'] }));
    const r = await engine.runIncremental('purchases'); // 파일 원본 + 지정 키 = 매 회차 전체 경로
    expect(r.mode).toBe('full');
    expect(r.errors[0]?.code).toBe('PURCHASE_KEY_UNUSABLE');
    expect(fetchAll).not.toHaveBeenCalled();
    expect((api as any).syncPurchases).not.toHaveBeenCalled();
  });

  it('지정 키 컬럼이 날짜 타입(원본 행 키로 못 씀) = 잠금', async () => {
    const api = { syncPurchases: vi.fn(async () => ({ data: { insertedCount: 1 } })) } as unknown as ApiClient;
    const db = baseDb({
      dbType: 'excel',
      fetchAll: async () => salesRows,
      getRowCount: async () => 1,
      getColumns: async () => [...cols(['PHONE']), { name: 'DT', dataType: 'date', nullable: true, isPrimaryKey: false }],
    });
    const engine = new SyncEngine(db, api, makeState().state, makeConfig({ purchaseKeyColumns: ['DT'] }));
    const r = await engine.runFull('purchases');
    expect(r.errors[0]?.code).toBe('PURCHASE_KEY_UNUSABLE');
    expect((api as any).syncPurchases).not.toHaveBeenCalled();
  });
});

describe('키 없는 구매 첫 전체의 전송 실패 = 분명히 알린다 (Codex 1004 R1 high)', () => {
  const mkDb = () => {
    let served = false;
    return baseDb({
      dbType: 'excel',
      getRowCount: async () => 1,
      fetchAll: async () => { if (served) return []; served = true; return [{ PHONE: '01000000001', DT: '2026-10-01', AMT: 1000, ORDER_NO: 'A1' }]; },
      getColumns: async () => cols(['PHONE', 'DT', 'ORDER_NO']),
    });
  };
  const failingApi = () => ({ syncPurchases: vi.fn(async () => { throw new Error('503'); }) } as unknown as ApiClient);
  const mapping = { purchaseMapping: { PHONE: 'customer_phone', DT: 'purchase_date', AMT: 'total_amount' } };

  it('키 없음 + 전송 실패 = KEYLESS_FULL_INCOMPLETE', async () => {
    const engine = new SyncEngine(mkDb(), failingApi(), makeState().state, makeConfig(mapping));
    const r = await engine.runFull('purchases');
    expect(r.errors.some((e) => e.code === 'API_SEND_FAILED')).toBe(true);
    expect(r.errors.some((e) => e.code === 'KEYLESS_FULL_INCOMPLETE')).toBe(true);
  });

  it('키 있음 + 전송 실패 = 그 경고는 없다(다시 보내도 멱등)', async () => {
    const engine = new SyncEngine(mkDb(), failingApi(), makeState().state, makeConfig({ ...mapping, purchaseKeyColumns: ['ORDER_NO'] }));
    const r = await engine.runFull('purchases');
    expect(r.errors.some((e) => e.code === 'API_SEND_FAILED')).toBe(true);
    expect(r.errors.some((e) => e.code === 'KEYLESS_FULL_INCOMPLETE')).toBe(false);
  });
});

describe('키 없는 구매 배치의 재시도 표식 (Codex 1004 R2 high)', () => {
  it('원본 키가 없으면 행마다 같은 배치 표식 + 다른 순번을 source_row_key 로 싣는다', async () => {
    let served = false;
    const db = baseDb({
      dbType: 'excel',
      getRowCount: async () => 2,
      fetchAll: async () => {
        if (served) return [];
        served = true;
        return [
          { PHONE: '01000000001', DT: '2026-10-01', AMT: 1000 },
          { PHONE: '01000000001', DT: '2026-10-01', AMT: 1000 }, // 똑같은 두 구매 — 합쳐지면 안 된다
        ];
      },
      getColumns: async () => cols(['PHONE', 'DT', 'AMT']),
    });
    const syncPurchases = vi.fn(async (_req: any) => ({ data: { insertedCount: 2 } }));
    const engine = new SyncEngine(db, { syncPurchases } as unknown as ApiClient, makeState().state,
      makeConfig({ purchaseMapping: { PHONE: 'customer_phone', DT: 'purchase_date', AMT: 'total_amount' } }));
    await engine.runFull('purchases');
    const keys = syncPurchases.mock.calls[0][0].purchases.map((p: any) => p.source_row_key);
    expect(keys).toHaveLength(2);
    expect(keys.every((k: string) => /^~retry:[0-9a-f]{32}:\d+$/.test(k))).toBe(true);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0].split(':')[1]).toBe(keys[1].split(':')[1]);
  });
});
