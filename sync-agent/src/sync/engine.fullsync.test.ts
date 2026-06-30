/**
 * runFull 페이지네이션 완전성 테스트
 *
 * 배경(2026-06-30 이새에프앤씨 실측): 원천 137,082건(계획 35배치)인데 full 동기화가
 * 배치 25(~99,852)에서 끊겼다. 원인 = runFull 루프가 "한 페이지가 batchSize보다
 * 적으면 끝"이라고 단정(`rows.length < batchSize` → break)하는데, 깊은 OFFSET 구간에서
 * fetchAll이 뒤에 데이터가 더 있는데도 짧은/빈 페이지를 돌려주면 거기서 조기 종료된다.
 * 빠진 분은 그날 증분이 우연히 메웠을 뿐, 구조적으로는 영구 누락 위험.
 *
 * 이 테스트는 그 조기 종료를 재현한다(RED). 정정 후에는 getRowCount(총건수)까지
 * 구동되어 전수를 받는다(GREEN).
 */
import { describe, it, expect, vi } from 'vitest';
import { SyncEngine, type SyncEngineConfig } from './engine';
import type { IDbConnector, ColumnInfo, RawRow } from '../db/types';
import type { SyncStateManager } from './state';
import type { ApiClient } from '../api/client';

function makeColumns(names: string[]): ColumnInfo[] {
  return names.map((name) => ({ name, dataType: 'varchar', nullable: true }));
}

function makeRows(n: number): RawRow[] {
  return Array.from({ length: n }, (_, i) => ({
    PHONE: `0101${String(i).padStart(7, '0')}`,
    NAME: `n${i}`,
    updated_at: '2026-06-30 00:00:00',
  }));
}

function makeState(): SyncStateManager {
  return {
    getState: () => ({ agentId: null }),
    getLastSyncAt: () => null,
    updateAfterSync: () => {},
    updateFullSyncAt: () => {},
  } as unknown as SyncStateManager;
}

function makeConfig(overrides: Partial<SyncEngineConfig> = {}): SyncEngineConfig {
  return {
    batchSize: 100,
    customerTable: 'CUSTOMER',
    purchaseTable: '',
    timestampColumn: 'updated_at',
    fallbackToFullSync: true,
    customerMapping: { PHONE: 'phone', NAME: 'name' },
    purchaseMapping: {},
    dryRun: true,
    ...overrides,
  };
}

function makeOffsetDb(
  fetchAll: IDbConnector['fetchAll'],
  total: number,
): IDbConnector {
  return {
    dbType: 'oracle',
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    testConnection: async () => true,
    getTables: async () => ['CUSTOMER'],
    getColumns: async () => makeColumns(['PHONE', 'NAME', 'updated_at']),
    fetchIncremental: async () => [],
    fetchAll,
    getRowCount: async () => total,
  };
}

const apiNull = null as unknown as ApiClient;

describe('runFull 페이지네이션 완전성 (이새 조기종료 재현)', () => {
  it('중간 배치가 batchSize보다 짧게 와도 끝까지(getRowCount) 받는다', async () => {
    const all = makeRows(250); // batchSize 100 → 정상이면 100/100/50

    // 이새 재현: offset 100 배치가 100이 아니라 70만 돌려줌(짧은 페이지). 하지만 뒤에 더 있음.
    const fetchAll = vi.fn(
      async (_t: string, limit: number, offset: number): Promise<RawRow[]> => {
        if (offset === 100) return all.slice(100, 100 + 70); // 짧은 페이지(70 < 100)
        return all.slice(offset, offset + limit);
      },
    );
    const db = makeOffsetDb(fetchAll, all.length);
    const engine = new SyncEngine(db, apiNull, makeState(), makeConfig());

    const result = await engine.runFull('customers');

    // 짧은 페이지(offset 100) 이후에도 계속 받아 offset 170을 조회해야 한다.
    const fetchedOffsets = fetchAll.mock.calls.map((c) => c[2]);
    expect(fetchedOffsets).toContain(170);
    expect(result.totalCount).toBe(250);
  });

  it('키셋 어댑터는 OFFSET 대신 키셋으로 전수를 받고 마지막 짧은 페이지에서 정상 종료한다', async () => {
    const all = makeRows(250);
    const fetchAllKeyset = vi.fn(
      async (
        _t: string,
        limit: number,
        afterKey: string | null,
      ): Promise<{ rows: RawRow[]; lastKey: string | null }> => {
        const start = afterKey == null ? 0 : Number(afterKey) + 1;
        const slice = all.slice(start, start + limit);
        const lastKey = slice.length > 0 ? String(start + slice.length - 1) : null;
        return { rows: slice, lastKey };
      },
    );
    // 키셋이 있으면 OFFSET fetchAll은 절대 쓰이면 안 된다.
    const offsetFetch = vi.fn(async (): Promise<RawRow[]> => {
      throw new Error('키셋 어댑터에서 OFFSET fetchAll이 호출되면 안 됨');
    });
    const db = makeOffsetDb(offsetFetch, all.length);
    (db as { fetchAllKeyset?: unknown }).fetchAllKeyset = fetchAllKeyset;
    const engine = new SyncEngine(db, apiNull, makeState(), makeConfig());

    const result = await engine.runFull('customers');

    expect(fetchAllKeyset).toHaveBeenCalled();
    expect(offsetFetch).not.toHaveBeenCalled();
    expect(result.totalCount).toBe(250);
  });

  it('증분도 중간 짧은 페이지에서 끊기지 않고 변경분을 끝까지 받는다', async () => {
    const all = makeRows(250);
    const fetchIncremental = vi.fn(
      async (
        _t: string,
        _col: string,
        _since: string,
        limit: number,
        offset: number,
      ): Promise<RawRow[]> => {
        if (offset === 100) return all.slice(100, 100 + 70); // 짧은 페이지
        return all.slice(offset, offset + limit);
      },
    );
    const db = makeOffsetDb(vi.fn(async (): Promise<RawRow[]> => []), all.length);
    db.fetchIncremental = fetchIncremental;
    db.getColumns = async () => makeColumns(['PHONE', 'NAME', 'updated_at']);
    const state = {
      getState: () => ({ agentId: null }),
      getLastSyncAt: () => '2026-06-01T00:00:00.000Z',
      updateAfterSync: () => {},
      updateFullSyncAt: () => {},
    } as unknown as SyncStateManager;
    const engine = new SyncEngine(db, apiNull, state, makeConfig());

    const result = await engine.runIncremental('customers');

    expect(result.mode).toBe('incremental');
    const offsets = fetchIncremental.mock.calls.map((c) => c[4]);
    expect(offsets).toContain(170);
    expect(result.totalCount).toBe(250);
  });
});
