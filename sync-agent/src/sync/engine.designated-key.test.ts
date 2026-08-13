/**
 * 뷰 소스 지정 키 (★ 2026-08-13 아난티 실측 결함 정정) — PK 메타 없는 소스의 증분 개방 계약을 고정한다.
 *
 * 고정하는 계약:
 *   1) 메타에 PK가 없고 지정 키도 없으면 **종전 그대로 잠근다**(INCREMENTAL_LOCKED_NO_PK — 완화 아님).
 *   2) 지정 키가 있으면 그 키를 PK처럼 써서 증분이 돈다. fingerprint에 지정 키가 들어가므로
 *      키를 바꾸면 커서가 폐기되고 전량 재기준된다(§4 계약 그대로).
 *   3) 메타에 PK가 있으면 메타가 우선이다 — 지정 키는 보충이지 대체가 아니다.
 *   4) 지정 키 컬럼이 소스에 실존하지 않으면(뷰 재정의) 잠근다 — 없는 컬럼 커서는 조용히 깨진다.
 *   5) 지정 키가 날짜·이진형이면 잠근다(비스칼라 PK와 같은 계약).
 */
import { describe, it, expect, vi } from 'vitest';
import { SyncEngine, SyncEngineConfig } from './engine';
import type { IDbConnector, RawRow, ColumnInfo } from '../db/types';
import type { IncrementalCursor, RowCursorMeta } from '../db/keyset';
import type { SyncCursorState, SyncTarget } from '../types/sync';

function makeState(initialCursor?: SyncCursorState | null) {
  const cursors: Record<string, SyncCursorState | null> = { purchases: initialCursor ?? null, customers: null };
  const holds: Record<string, string | null> = { purchases: null, customers: null };
  const setCursorCalls: SyncCursorState[] = [];
  return {
    setCursorCalls,
    getLastSyncAt: () => null,
    updateAfterSync: () => {},
    updateFullSyncAt: () => {},
    getState: () => ({ agentId: null }),
    getCursor: (t: SyncTarget) => cursors[t],
    setCursor: (t: SyncTarget, c: SyncCursorState) => { cursors[t] = c; setCursorCalls.push(c); },
    clearCursor: (t: SyncTarget) => { cursors[t] = null; },
    getIncrementalHold: (t: SyncTarget) => holds[t],
    setIncrementalHold: (t: SyncTarget, r: string | null) => { holds[t] = r; },
  } as any;
}

/** 뷰 컬럼 메타 — isPrimaryKey가 하나도 없다(뷰의 실제 모습). */
const VIEW_COLS: ColumnInfo[] = [
  { name: 'ORDER_NO', dataType: 'varchar', nullable: false },
  { name: 'PHONE', dataType: 'varchar', nullable: false },
  { name: 'ORD_DT', dataType: 'datetime', nullable: true },
];

function makeDb(pages: Array<{ rows: RawRow[]; meta: RowCursorMeta[] }>, columns: ColumnInfo[]) {
  let call = 0;
  const fetchIncrementalKeyset = vi.fn(async () => pages[call++] ?? { rows: [], meta: [] });
  const db: IDbConnector = {
    dbType: 'mock' as any,
    connect: async () => {}, disconnect: async () => {}, isConnected: () => true,
    testConnection: async () => true,
    getColumns: async () => columns,
    getTables: async () => [],
    fetchIncremental: vi.fn(async () => []),
    fetchAll: vi.fn(async () => []),
    getRowCount: async () => 0,
    fetchIncrementalKeyset,
    fetchMaxCursor: vi.fn(async () => null),
    getSourceId: () => 'mock-src',
  };
  return { db, fetchIncrementalKeyset };
}

const BASE: SyncEngineConfig = {
  batchSize: 10,
  customerTable: 'CUST_VIEW',
  purchaseTable: 'ORDER_VIEW',
  timestampColumn: 'ORD_DT',
  fallbackToFullSync: true,
  customerMapping: { PHONE: 'phone' },
  purchaseMapping: { PHONE: 'customer_phone', ORD_DT: 'purchase_date' },
};

// 지정 키 fingerprint — pkColumns 자리에 지정 키가 그대로 들어간다
const FP_DESIGNATED = JSON.stringify(['mock', 'mock-src', 'ORDER_VIEW', 'ORD_DT', ['ORDER_NO']]);
const CURSOR: SyncCursorState = { tsRaw: '2026-08-01 00:00:00', keys: ['A-100'], pkColumns: ['ORDER_NO'], fingerprint: FP_DESIGNATED };

function makeApi() {
  return {
    syncPurchases: vi.fn(async (req: any) => ({ data: { insertedCount: req.purchases.length } })),
    syncCustomers: vi.fn(async (req: any) => ({ data: { upsertedCount: req.customers.length } })),
    sendLog: vi.fn(async () => {}),
  } as any;
}

describe('뷰 소스 지정 키 — PK 메타 없는 소스의 증분', () => {
  it('지정 키도 PK 메타도 없으면 종전 그대로 잠근다 (완화 아님)', async () => {
    const { db, fetchIncrementalKeyset } = makeDb([], VIEW_COLS);
    const engine = new SyncEngine(db, makeApi(), makeState(), { ...BASE });
    const result = await engine.runIncremental('purchases');
    expect(result.errors?.some((e) => e.code === 'INCREMENTAL_LOCKED_NO_PK')).toBe(true);
    expect(fetchIncrementalKeyset).not.toHaveBeenCalled();
  });

  it('지정 키가 있으면 그 키로 증분이 돈다', async () => {
    const { db, fetchIncrementalKeyset } = makeDb(
      [{ rows: [{ ORDER_NO: 'A-101', PHONE: '01000000001', ORD_DT: '2026-08-02' }], meta: [{ tsRaw: '2026-08-02 00:00:00', keys: ['A-101'] }] }],
      VIEW_COLS,
    );
    const engine = new SyncEngine(db, makeApi(), makeState(CURSOR), { ...BASE, purchaseKeyColumns: ['ORDER_NO'] });
    const result = await engine.runIncremental('purchases');
    expect(result.errors?.some((e) => e.code === 'INCREMENTAL_LOCKED_NO_PK')).toBe(false);
    expect(fetchIncrementalKeyset).toHaveBeenCalled();
    // 키셋 조회에 지정 키가 PK 자리로 전달된다
    const callArgs = fetchIncrementalKeyset.mock.calls[0] as any[];
    expect(JSON.stringify(callArgs)).toContain('ORDER_NO');
  });

  it('메타에 PK가 있으면 지정 키를 무시하고 메타가 우선이다', async () => {
    const withPk: ColumnInfo[] = [
      { name: 'REAL_PK', dataType: 'int', nullable: false, isPrimaryKey: true },
      ...VIEW_COLS,
    ];
    const { db, fetchIncrementalKeyset } = makeDb(
      [{ rows: [], meta: [] }],
      withPk,
    );
    // fingerprint를 메타 PK 기준으로 줘야 커서가 유지된다 — 지정 키가 이겼다면 여기서 폐기·전량이 됐을 것
    const fpMeta = JSON.stringify(['mock', 'mock-src', 'ORDER_VIEW', 'ORD_DT', ['REAL_PK']]);
    const engine = new SyncEngine(db, makeApi(), makeState({ ...CURSOR, keys: [7], pkColumns: ['REAL_PK'], fingerprint: fpMeta }), {
      ...BASE,
      purchaseKeyColumns: ['ORDER_NO'],
    });
    const result = await engine.runIncremental('purchases');
    expect(result.errors?.some((e) => e.code === 'INCREMENTAL_LOCKED_NO_PK')).toBe(false);
    expect(fetchIncrementalKeyset).toHaveBeenCalled();
    const callArgs = fetchIncrementalKeyset.mock.calls[0] as any[];
    expect(JSON.stringify(callArgs)).toContain('REAL_PK');
  });

  it('지정 키 컬럼이 소스에 없으면(뷰 재정의) 잠근다', async () => {
    const { db, fetchIncrementalKeyset } = makeDb([], VIEW_COLS);
    const engine = new SyncEngine(db, makeApi(), makeState(), { ...BASE, purchaseKeyColumns: ['GONE_COL'] });
    const result = await engine.runIncremental('purchases');
    expect(result.errors?.some((e) => e.code === 'PK_META_FAILED')).toBe(true);
    expect(fetchIncrementalKeyset).not.toHaveBeenCalled();
  });

  it('지정 키가 날짜형이면 잠근다 (비스칼라 PK와 같은 계약)', async () => {
    const { db, fetchIncrementalKeyset } = makeDb([], VIEW_COLS);
    const engine = new SyncEngine(db, makeApi(), makeState(), { ...BASE, purchaseKeyColumns: ['ORD_DT'] });
    const result = await engine.runIncremental('purchases');
    expect(result.errors?.some((e) => e.code === 'INCREMENTAL_LOCKED_PK_TYPE')).toBe(true);
    expect(fetchIncrementalKeyset).not.toHaveBeenCalled();
  });
});
