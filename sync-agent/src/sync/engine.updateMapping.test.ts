/**
 * SyncEngine.updateMapping — 런타임 매핑 교체 (원격 update_config 지원)
 *
 * 배경(2026-07-01 isae): custom 매핑이 config.enc(박스)에만 있어 원격 --setup-cli 없이는
 * 못 고쳤다. 슈퍼관리자에서 매핑을 내려보내(update_config) 재시작 없이 즉시 갈아끼우려면
 * engine이 들고 있는 customerMapping/purchaseMapping을 런타임에 교체할 수 있어야 한다.
 *
 * 이 테스트는 교체 전에는 그 슬롯이 비어 있고, updateMapping 후 runFull이 새 매핑대로
 * custom_fields를 구성해 전송하는 것을 검증한다(RED → GREEN).
 */
import { describe, it, expect } from 'vitest';
import { SyncEngine, type SyncEngineConfig } from './engine';
import type { IDbConnector, ColumnInfo, RawRow } from '../db/types';
import type { SyncStateManager } from './state';
import type { ApiClient } from '../api/client';

function makeColumns(names: string[]): ColumnInfo[] {
  return names.map((name) => ({ name, dataType: 'varchar', nullable: true }));
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
    customerMapping: { HP: 'phone' },
    purchaseMapping: {},
    dryRun: false,
    ...overrides,
  };
}

function makeDb(rows: RawRow[], columns: string[]): IDbConnector {
  return {
    dbType: 'oracle',
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    testConnection: async () => true,
    getTables: async () => ['CUSTOMER'],
    getColumns: async () => makeColumns(columns),
    fetchIncremental: async () => [],
    fetchAll: async (_t: string, _limit: number, offset: number) => (offset === 0 ? rows : []),
    getRowCount: async () => rows.length,
  } as unknown as IDbConnector;
}

describe('SyncEngine.updateMapping (런타임 매핑 교체)', () => {
  it('updateMapping 후 runFull이 교체된 매핑으로 custom_fields를 구성해 전송한다', async () => {
    const rows: RawRow[] = [
      { HP: '01011112222', REG_DT: '2026-01-01', updated_at: '2026-06-30 00:00:00' },
    ];
    const db = makeDb(rows, ['HP', 'REG_DT', 'updated_at']);

    const sent: Array<{ customers: Array<Record<string, unknown>> }> = [];
    const apiClient = {
      syncCustomers: async (req: { customers: Array<Record<string, unknown>> }) => {
        sent.push(req);
        return { data: { upsertedCount: req.customers.length, failedCount: 0 } };
      },
    } as unknown as ApiClient;

    // 초기 매핑에는 REG_DT가 없음 → custom_fields 비어 있어야 함
    const engine = new SyncEngine(db, apiClient, makeState(), makeConfig({ customerMapping: { HP: 'phone' } }));

    // 런타임 교체: REG_DT를 custom_1 슬롯으로
    engine.updateMapping({ customers: { HP: 'phone', REG_DT: 'custom_1' } });

    await engine.runFull('customers');

    expect(sent).toHaveLength(1);
    const customer = sent[0].customers[0];
    expect(customer.custom_fields).toMatchObject({ custom_1: '2026-01-01' });
  });

  it('customers만 넘기면 purchaseMapping은 건드리지 않는다', () => {
    const engine = new SyncEngine(
      makeDb([], ['HP']),
      null,
      makeState(),
      makeConfig({ customerMapping: { HP: 'phone' }, purchaseMapping: { BUY_DT: 'purchase_date' } }),
    );

    engine.updateMapping({ customers: { HP: 'phone', REG_DT: 'custom_1' } });

    // 교체 후에도 구매 매핑은 그대로여야 한다(부분 갱신 안전성)
    expect(engine.getMapping().purchases).toEqual({ BUY_DT: 'purchase_date' });
    expect(engine.getMapping().customers).toEqual({ HP: 'phone', REG_DT: 'custom_1' });
  });
});
