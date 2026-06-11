/**
 * SyncEngine 타임스탬프 컬럼 실재 검증 + fallbackToFullSync 동작 테스트
 *
 * 배경(2026-06-11 인비토 첫 연동 실측): 고객사 테이블(SyncTest)에 설정된 timestamp 컬럼
 * (updated_at)이 없어 증분 동기화가 매 주기 MSSQL 207(Invalid column name)로 실패했고,
 * 최초 전체 동기화 이후의 신규/수정 데이터가 영구히 반영되지 않았다.
 * fallbackToFullSync는 config 전 경로에 선언만 있고 소비처가 0건이라 동작하지 않았다.
 */
import { describe, it, expect, vi } from 'vitest';
import { SyncEngine, type SyncEngineConfig } from './engine';
import type { IDbConnector, ColumnInfo, RawRow } from '../db/types';
import type { SyncStateManager } from './state';
import type { ApiClient } from '../api/client';

function makeColumns(names: string[]): ColumnInfo[] {
  return names.map((name) => ({ name, dataType: 'varchar', nullable: true }));
}

function makeDb(opts: {
  columns?: ColumnInfo[];
  columnsError?: Error;
  rows?: RawRow[];
}) {
  const fetchIncremental = vi.fn(async (): Promise<RawRow[]> => []);
  const fetchAll = vi.fn(
    async (_table: string, _limit: number, offset: number): Promise<RawRow[]> =>
      offset === 0 ? opts.rows || [] : [],
  );
  const getColumns = vi.fn(async (): Promise<ColumnInfo[]> => {
    if (opts.columnsError) throw opts.columnsError;
    return opts.columns || [];
  });
  const db: IDbConnector = {
    dbType: 'mssql',
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    testConnection: async () => true,
    getTables: async () => ['SyncTest'],
    getColumns,
    fetchIncremental,
    fetchAll,
    getRowCount: async () => (opts.rows || []).length,
  };
  return { db, fetchIncremental, fetchAll, getColumns };
}

function makeState(lastSyncAt: string | null): SyncStateManager {
  return {
    getState: () => ({ agentId: null }),
    getLastSyncAt: () => lastSyncAt,
    updateAfterSync: () => {},
    updateFullSyncAt: () => {},
  } as unknown as SyncStateManager;
}

function makeConfig(overrides: Partial<SyncEngineConfig> = {}): SyncEngineConfig {
  return {
    batchSize: 100,
    customerTable: 'SyncTest',
    purchaseTable: '',
    timestampColumn: 'updated_at',
    fallbackToFullSync: true,
    customerMapping: { PHONE: 'phone', NAME: 'name' },
    purchaseMapping: {},
    dryRun: true,
    ...overrides,
  };
}

const apiNull = null as unknown as ApiClient;
const LAST_SYNC = '2026-06-11T00:00:00.000Z';

describe('runIncremental 타임스탬프 컬럼 검증', () => {
  it('컬럼 없음 + fallbackToFullSync=true → 전체 동기화로 대체한다', async () => {
    const { db, fetchIncremental, fetchAll } = makeDb({
      columns: makeColumns(['CustNo', 'PHONE', 'NAME']),
      rows: [{ PHONE: '01012345678', NAME: '홍길동' }],
    });
    const engine = new SyncEngine(db, apiNull, makeState(LAST_SYNC), makeConfig());

    const result = await engine.runIncremental('customers');

    expect(result.mode).toBe('full');
    expect(result.totalCount).toBe(1);
    expect(fetchIncremental).not.toHaveBeenCalled();
    expect(fetchAll).toHaveBeenCalled();
  });

  it('컬럼 없음 + fallbackToFullSync=false → 테이블/컬럼명 명시 에러로 중단한다', async () => {
    const { db, fetchIncremental, fetchAll } = makeDb({
      columns: makeColumns(['CustNo']),
    });
    const engine = new SyncEngine(
      db, apiNull, makeState(LAST_SYNC), makeConfig({ fallbackToFullSync: false }),
    );

    await expect(engine.runIncremental('customers')).rejects.toThrow(/updated_at/);
    await expect(engine.runIncremental('customers')).rejects.toThrow(/SyncTest/);
    expect(fetchIncremental).not.toHaveBeenCalled();
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it('컬럼 존재(대소문자 무관) → 증분을 그대로 진행한다', async () => {
    const { db, fetchIncremental } = makeDb({
      columns: makeColumns(['CustNo', 'UPDATED_AT']),
    });
    const engine = new SyncEngine(db, apiNull, makeState(LAST_SYNC), makeConfig());

    const result = await engine.runIncremental('customers');

    expect(result.mode).toBe('incremental');
    expect(fetchIncremental).toHaveBeenCalledTimes(1);
  });

  it('getColumns 실패(메타 조회 불가) → 기존처럼 증분을 시도한다 (동작 비악화)', async () => {
    const { db, fetchIncremental } = makeDb({
      columnsError: new Error('permission denied'),
    });
    const engine = new SyncEngine(db, apiNull, makeState(LAST_SYNC), makeConfig());

    const result = await engine.runIncremental('customers');

    expect(result.mode).toBe('incremental');
    expect(fetchIncremental).toHaveBeenCalledTimes(1);
  });
});

describe('validateTimestampColumnsAtStartup (기동 시 검증)', () => {
  it('고객 테이블 컬럼 누락을 보고한다', async () => {
    const { db } = makeDb({ columns: makeColumns(['CustNo']) });
    const engine = new SyncEngine(db, apiNull, makeState(null), makeConfig());

    const report = await engine.validateTimestampColumnsAtStartup();

    expect(report).toEqual([
      { target: 'customers', table: 'SyncTest', column: 'updated_at', status: 'missing' },
    ]);
  });

  it('구매 테이블 미설정이면 고객만 검증한다', async () => {
    const { db } = makeDb({ columns: makeColumns(['updated_at']) });
    const engine = new SyncEngine(db, apiNull, makeState(null), makeConfig());

    const report = await engine.validateTimestampColumnsAtStartup();

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ target: 'customers', status: 'ok' });
  });

  it('구매 테이블 설정 시 두 테이블 모두 검증한다', async () => {
    const { db } = makeDb({ columns: makeColumns(['updated_at']) });
    const engine = new SyncEngine(
      db, apiNull, makeState(null), makeConfig({ purchaseTable: 'PurchaseTest' }),
    );

    const report = await engine.validateTimestampColumnsAtStartup();

    expect(report).toHaveLength(2);
    expect(report.map((r) => r.target)).toEqual(['customers', 'purchases']);
  });
});
