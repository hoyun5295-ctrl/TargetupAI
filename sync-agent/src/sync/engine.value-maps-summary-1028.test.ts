/**
 * ★ 2026-10-28 P2 설치별 값 분류 · P3 고객 누계 보호 — 엔진 배선(docs/2026-10-28-sync-value-check-summary-guard-design.md)
 *
 * 고정하는 계약:
 *   1) 엔진 설정의 valueMaps 는 지금 고객 매핑의 단일 원본 컬럼 · 고객 테이블 · 원본 식별과 맞을 때만 고객 정규화에 쓰인다.
 *   2) 원격 매핑 갱신으로 컬럼이 바뀌거나 원본 · 테이블이 다르면 옛 표는 안 쓰인다(지금 규칙).
 *   3) valueMaps 가 없으면 지금과 같다 · 옛 상태 파일이면 업그레이드만으로 전량이 돌지 않는다.
 *   4) 분류표 지문이 마지막 고객 전량 때와 다르면 다음 고객 동기화가 전량(증분 보류 중이어도) · 도중에 바뀌면 기록하지 않는다.
 *   5) 구매 요청에 고객 매핑의 요약 칸을 싣는다 · 요약 칸이 없으면 싣지 않는다(서버는 지금 동작).
 */
import { describe, it, expect, vi } from 'vitest';
import { SyncEngine, type SyncEngineConfig } from './engine';
import type { IDbConnector, ColumnInfo, RawRow } from '../db/types';
import type { RowCursorMeta } from '../db/keyset';
import type { SyncCursorState, SyncTarget } from '../types/sync';
import type { SyncStateManager } from './state';
import type { ApiClient } from '../api/client';
import { valueMapsDigest } from '../normalize';

const CUST_COLS = ['HP', 'YN_SMS', 'YN_WITHDRAW', 'SMS2'];
const SRC = '["oracle","h",1521,"D","SYNC_READER",""]';

function customerDb(rows: RawRow[]): IDbConnector {
  return {
    dbType: 'oracle',
    connect: async () => {}, disconnect: async () => {}, isConnected: () => true,
    testConnection: async () => true,
    getTables: async () => ['CUST'],
    getColumns: async () => CUST_COLS.map((name) => ({ name, dataType: 'varchar', nullable: true })),
    fetchIncremental: async () => [],
    fetchAll: async (_t: string, _limit: number, offset: number) => (offset === 0 ? rows : []),
    getRowCount: async () => rows.length,
  } as unknown as IDbConnector;
}

const customerState = () => ({
  getState: () => ({ agentId: null }),
  getLastSyncAt: () => null,
  updateAfterSync: () => {},
  updateFullSyncAt: () => {},
}) as unknown as SyncStateManager;

function customerApi() {
  const sent: Array<Record<string, unknown>> = [];
  const api = {
    syncCustomers: async (req: { customers: Array<Record<string, unknown>> }) => {
      sent.push(...req.customers);
      return { data: { upsertedCount: req.customers.length, failedCount: 0 } };
    },
    sendLog: async () => {},
  } as unknown as ApiClient;
  return { api, sent };
}

const MT_MAPS = {
  sms_opt_in: { column: 'YN_SMS', table: 'CUST', source: SRC, values: { 수신: true, 미수신: false } },
  is_opt_out: { column: 'YN_WITHDRAW', table: 'CUST', source: SRC, values: { 회원: false } },
};

const ROWS: RawRow[] = [
  { HP: '01000000001', YN_SMS: '수신', YN_WITHDRAW: '회원', SMS2: '수신' },
  { HP: '01000000002', YN_SMS: '미수신', YN_WITHDRAW: '회원', SMS2: '미수신' },
  { HP: '01000000003', YN_SMS: '수신', YN_WITHDRAW: '탈퇴', SMS2: '수신' },
];

const custConfig = (o: Partial<SyncEngineConfig> = {}): SyncEngineConfig => ({
  batchSize: 100, customerTable: 'CUST', purchaseTable: '', timestampColumn: 'updated_at', fallbackToFullSync: true,
  customerMapping: { HP: 'phone', YN_SMS: 'sms_opt_in', YN_WITHDRAW: 'is_opt_out' }, purchaseMapping: {}, dryRun: false,
  valueMapsSource: SRC,
  ...o,
});

describe('P2 엔진 — 설치별 값 분류', () => {
  it('맞는 표면 수신 = 동의 · 미수신 = 거부 · 탈퇴 = 거부(낱말표) · 회원 = 정상(분류)', async () => {
    const { api, sent } = customerApi();
    const engine = new SyncEngine(customerDb(ROWS), api, customerState(), custConfig({ valueMaps: MT_MAPS }));
    const result = await engine.runFull('customers');
    expect(sent.map((c) => c.sms_opt_in)).toEqual([true, false, false]);
    expect(sent.some((c) => 'sms_opt_in_unknown' in c)).toBe(false);
    expect(result.errors?.some((e) => e.code === 'OPT_OUT_VALUE_UNKNOWN' || e.code === 'CONSENT_VALUE_UNKNOWN')).toBe(false);
  });

  it('valueMaps 없음 = 지금과 같다(회원 = 모르는 탈퇴 값 → 수신거부로 접힘 · 배치 로그)', async () => {
    const { api, sent } = customerApi();
    const engine = new SyncEngine(customerDb(ROWS), api, customerState(), custConfig());
    const result = await engine.runFull('customers');
    expect(sent.map((c) => c.sms_opt_in)).toEqual([false, false, false]);
    expect(result.errors?.some((e) => e.code === 'OPT_OUT_VALUE_UNKNOWN')).toBe(true);
  });

  it('원격 매핑 갱신으로 수신동의 컬럼이 바뀌면 옛 표는 안 쓰인다', async () => {
    const { api, sent } = customerApi();
    const engine = new SyncEngine(customerDb(ROWS), api, customerState(), custConfig({ valueMaps: MT_MAPS }));
    engine.updateMapping({ customers: { HP: 'phone', SMS2: 'sms_opt_in' } });
    await engine.runFull('customers');
    expect(sent.map((c) => c.sms_opt_in)).toEqual([null, null, null]);
    expect(sent.map((c) => c.sms_opt_in_unknown)).toEqual(['수신', '미수신', '수신']);
  });

  it('원본 식별이 다르면(DB 를 바꾼 설정) 옛 표는 안 쓰인다', async () => {
    const { api, sent } = customerApi();
    const engine = new SyncEngine(customerDb(ROWS), api, customerState(), custConfig({ valueMaps: MT_MAPS, valueMapsSource: '["oracle","other",1521,"D","U",""]' }));
    await engine.runFull('customers');
    expect(sent.map((c) => c.sms_opt_in)).toEqual([false, false, false]);
  });

});

describe('P2 엔진 — 적용 지문(분류 변경 = 고객 전량 한 곳 · Codex 설계 1R · 구현 1R)', () => {
  const CURSOR_FP = JSON.stringify(['oracle', 'mt-src', 'CUST', 'UPD_DT', ['HP']]);
  function keysetDb(onFirstFetch: () => void = () => {}) {
    let first = true;
    const fetchAll = vi.fn(async (_t: string, limit: number, offset: number) => {
      if (first) { first = false; onFirstFetch(); }
      return ROWS.slice(offset, offset + limit).map((r) => ({ ...r, UPD_DT: '2026-10-27 10:00:00' }));
    });
    const db = {
      dbType: 'oracle',
      connect: async () => {}, disconnect: async () => {}, isConnected: () => true,
      testConnection: async () => true,
      getTables: async () => ['CUST'],
      getColumns: async () => [
        { name: 'HP', dataType: 'varchar', nullable: false, isPrimaryKey: true },
        { name: 'YN_SMS', dataType: 'varchar', nullable: true },
        { name: 'YN_WITHDRAW', dataType: 'varchar', nullable: true },
        { name: 'SMS2', dataType: 'varchar', nullable: true },
        { name: 'UPD_DT', dataType: 'datetime', nullable: true },
      ],
      fetchIncremental: async () => [],
      fetchAll,
      getRowCount: async () => ROWS.length,
      fetchIncrementalKeyset: vi.fn(async () => ({ rows: [], meta: [] })),
      fetchMaxCursor: async (_t: string, _c: string, _pk: string[], below?: string) =>
        below ? { tsRaw: '2026-10-26 09:00:00', keys: ['01000000001'] } : { tsRaw: '2026-10-27 10:00:00', keys: ['01000000003'] },
      getSourceId: () => 'mt-src',
    } as unknown as IDbConnector;
    return { db, fetchAll };
  }
  function digestState(applied: string | undefined, hold: string | null = null) {
    const setCursor = vi.fn();
    let current = applied;
    const setAppliedValueMapsDigest = vi.fn((d: string) => { current = d; });
    const state = {
      getState: () => ({ agentId: null }), getLastSyncAt: () => null, updateAfterSync: () => {}, updateFullSyncAt: () => {},
      getCursor: () => ({ tsRaw: '2026-10-26 09:00:00', keys: ['01000000001'], pkColumns: ['HP'], fingerprint: CURSOR_FP }),
      setCursor, clearCursor: () => {}, getIncrementalHold: () => hold, setIncrementalHold: () => {},
      ...(applied === undefined ? {} : { getAppliedValueMapsDigest: () => current }),
      setAppliedValueMapsDigest,
    } as any;
    return { state, setCursor, setAppliedValueMapsDigest, applied: () => current };
  }
  const cfg = (o: Partial<SyncEngineConfig> = {}) => custConfig({ timestampColumn: 'UPD_DT', ...o });

  it('분류표 없는 설치 · 옛 상태 파일(칸 없음) = 증분 그대로(업그레이드만으로 전량이 돌지 않는다)', async () => {
    const { db, fetchAll } = keysetDb();
    const { state, setAppliedValueMapsDigest } = digestState(undefined);
    await new SyncEngine(db, customerApi().api, state, cfg()).runIncremental('customers');
    expect(fetchAll).not.toHaveBeenCalled();
    expect(setAppliedValueMapsDigest).not.toHaveBeenCalled();
  });

  it('분류표가 생기면(기록 = 없음) 다음 고객 증분이 전량으로 · 끝나면 그 지문을 기록', async () => {
    const { db, fetchAll } = keysetDb();
    const { state, setAppliedValueMapsDigest } = digestState('');
    await new SyncEngine(db, customerApi().api, state, cfg({ valueMaps: MT_MAPS })).runIncremental('customers');
    expect(fetchAll).toHaveBeenCalled();
    expect(setAppliedValueMapsDigest).toHaveBeenCalledWith(valueMapsDigest(MT_MAPS));
  });

  it('증분 보류 중이어도 분류가 바뀌면 전량', async () => {
    const { db, fetchAll } = keysetDb();
    const { state } = digestState('', '타임스탬프 컬럼 값이 전부 NULL');
    await new SyncEngine(db, customerApi().api, state, cfg({ valueMaps: MT_MAPS })).runIncremental('customers');
    expect(fetchAll).toHaveBeenCalled();
  });

  it('기록 = 지금 지문이면 증분 그대로 · 커서 지문은 분류표와 무관한 옛 5칸', async () => {
    const { db, fetchAll } = keysetDb();
    const { state } = digestState(valueMapsDigest(MT_MAPS));
    await new SyncEngine(db, customerApi().api, state, cfg({ valueMaps: MT_MAPS })).runIncremental('customers');
    expect(fetchAll).not.toHaveBeenCalled();
    const { db: db2 } = keysetDb();
    const s2 = digestState('');
    await new SyncEngine(db2, customerApi().api, s2.state, cfg({ valueMaps: MT_MAPS })).runFull('customers');
    expect(JSON.parse(s2.setCursor.mock.calls[0][1].fingerprint)).toHaveLength(5);
  });

  it('전량 도중 매핑이 바뀌어도 그 실행은 시작 표 하나로 끝까지 · 시작 표를 기록 → 다음 고객 동기화가 새 기준으로 다시 전량', async () => {
    let engine: SyncEngine;
    const { db, fetchAll } = keysetDb(() => engine.updateMapping({ customers: { HP: 'phone', SMS2: 'sms_opt_in', YN_WITHDRAW: 'is_opt_out' } }));
    const { api, sent } = customerApi();
    const s = digestState('');
    engine = new SyncEngine(db, api, s.state, cfg({ valueMaps: MT_MAPS, batchSize: 1 }));
    await engine.runFull('customers');
    // 세 배치 모두 시작 표(YN_SMS 분류)로 나갔다 — 도중에 SMS2 매핑으로 바뀌었어도 실행 안에서 섞이지 않는다
    expect(sent.map((c) => c.sms_opt_in)).toEqual([true, false, false]);
    expect(s.setAppliedValueMapsDigest.mock.calls.map((c) => c[0])).toEqual(['!pending', valueMapsDigest(MT_MAPS)]);
    fetchAll.mockClear();
    await engine.runIncremental('customers');
    expect(fetchAll).toHaveBeenCalled();
  });

  it('「진행 중」을 상태 파일에 못 쓰면 고객을 한 건도 보내지 않고 잠금 결과(Codex 구현 2R)', async () => {
    const { db, fetchAll } = keysetDb();
    const s = digestState('');
    s.state.setAppliedValueMapsDigest = vi.fn(() => { throw new Error('ENOSPC: no space left on device'); });
    const { api, sent } = customerApi();
    const onSyncResult = vi.fn();
    const result = await new SyncEngine(db, api, s.state, cfg({ valueMaps: MT_MAPS }), { onSyncResult } as any).runFull('customers');
    expect(sent).toHaveLength(0);
    expect(fetchAll).not.toHaveBeenCalled();
    expect(result.errors?.[0]?.code).toBe('VALUE_MAPS_STATE_SAVE_FAILED');
    // 경보에는 실패로(보낸 건수 0 이어도 · Codex 구현 3R)
    expect(onSyncResult).toHaveBeenCalledWith(false, expect.stringContaining('상태 파일'));
  });

  it('일부만 보내고 실패하면 「진행 중」이 남는다 · 그 뒤 분류가 옛 값으로 돌아와도(A→B→A) 다음 고객 동기화가 전량', async () => {
    const OLD = valueMapsDigest({ sms_opt_in: MT_MAPS.sms_opt_in });
    const { db, fetchAll } = keysetDb();
    const s = digestState(OLD);
    let calls = 0;
    const failingApi = {
      syncCustomers: async (req: { customers: unknown[] }) => {
        if (++calls >= 2) throw new Error('503');
        return { data: { upsertedCount: req.customers.length, failedCount: 0 } };
      },
      sendLog: async () => {},
    } as unknown as ApiClient;
    const engine = new SyncEngine(db, failingApi, s.state, cfg({ valueMaps: MT_MAPS, batchSize: 1 }));
    await engine.runFull('customers');
    expect(s.applied()).toBe('!pending');
    // 분류표가 옛 값(OLD)으로 돌아옴 — 기록이 「진행 중」이라 같지 않다 → 전량
    engine.updateMapping({ customers: { HP: 'phone', YN_SMS: 'sms_opt_in' } });
    fetchAll.mockClear();
    await engine.runIncremental('customers');
    expect(fetchAll).toHaveBeenCalled();
  });
});

// ─── P3 구매 요청의 요약 칸 ─────────────────────────────

const VIEW_COLS: ColumnInfo[] = [
  { name: 'ORDER_NO', dataType: 'varchar', nullable: false },
  { name: 'PHONE', dataType: 'varchar', nullable: false },
  { name: 'ORD_DT', dataType: 'datetime', nullable: true },
  { name: 'AMT', dataType: 'number', nullable: true },
];

function purchaseDb(pages: Array<{ rows: RawRow[]; meta: RowCursorMeta[] }>) {
  let call = 0;
  return {
    dbType: 'mock' as any,
    connect: async () => {}, disconnect: async () => {}, isConnected: () => true,
    testConnection: async () => true,
    getColumns: async () => VIEW_COLS,
    getTables: async () => [],
    fetchIncremental: vi.fn(async () => []),
    fetchAll: vi.fn(async () => []),
    getRowCount: async () => 0,
    fetchIncrementalKeyset: vi.fn(async () => pages[call++] ?? { rows: [], meta: [] }),
    fetchMaxCursor: vi.fn(async () => null),
    getSourceId: () => 'mock-src',
  } as unknown as IDbConnector;
}

function purchaseState(cursor: SyncCursorState) {
  const cursors: Record<string, SyncCursorState | null> = { purchases: cursor, customers: null };
  return {
    getLastSyncAt: () => null, updateAfterSync: () => {}, updateFullSyncAt: () => {},
    getState: () => ({ agentId: null }),
    getCursor: (t: SyncTarget) => cursors[t],
    setCursor: (t: SyncTarget, c: SyncCursorState) => { cursors[t] = c; },
    clearCursor: (t: SyncTarget) => { cursors[t] = null; },
    getIncrementalHold: () => null,
    setIncrementalHold: () => {},
  } as any;
}

const PURCHASE_BASE: SyncEngineConfig = {
  batchSize: 10, customerTable: 'CUST_VIEW', purchaseTable: 'ORDER_VIEW', timestampColumn: 'ORD_DT', fallbackToFullSync: true,
  customerMapping: { PHONE: 'phone' }, purchaseMapping: { PHONE: 'customer_phone', ORD_DT: 'purchase_date', AMT: 'total_amount' },
  purchaseKeyColumns: ['ORDER_NO'],
};
const CURSOR: SyncCursorState = {
  tsRaw: '2026-08-01 00:00:00', keys: ['A-100'], pkColumns: ['ORDER_NO'],
  fingerprint: JSON.stringify(['mock', 'mock-src', 'ORDER_VIEW', 'ORD_DT', ['ORDER_NO']]),
};
const PAGE = [{
  rows: [{ ORDER_NO: 'A-101', PHONE: '01000000001', ORD_DT: '2026-08-02', AMT: 15000 }],
  meta: [{ tsRaw: '2026-08-02 00:00:00', keys: ['A-101'] }],
}];

async function sendOnePurchase(customerMapping: Record<string, string>) {
  const syncPurchases = vi.fn(async (req: any) => ({ data: { insertedCount: req.purchases.length } }));
  const api = { syncPurchases, syncCustomers: vi.fn(), sendLog: vi.fn(async () => {}) } as any;
  const engine = new SyncEngine(purchaseDb(PAGE), api, purchaseState(CURSOR), { ...PURCHASE_BASE, customerMapping });
  await engine.runIncremental('purchases');
  expect(syncPurchases).toHaveBeenCalledTimes(1);
  return syncPurchases.mock.calls[0][0];
}

describe('P3 엔진 — 구매 요청의 고객 요약 칸', () => {
  it('고객 매핑의 요약 칸만 싣는다(엠티 CT_BUY · AM_BUY · DT_LASTBUY · DS_SALESHOP)', async () => {
    const req = await sendOnePurchase({
      PHONE: 'phone', CT_BUY: 'purchase_count', AM_BUY: 'total_purchase_amount', DT_LASTBUY: 'recent_purchase_date',
      DS_SALESHOP: 'recent_purchase_store', DS_CUSTOMER: 'name',
    });
    expect(req.customerSummaryFields).toEqual(['total_purchase_amount', 'purchase_count', 'recent_purchase_date', 'recent_purchase_store']);
  });

  it('요약 칸이 없으면 칸 자체를 싣지 않는다(서버 = 지금 동작)', async () => {
    const req = await sendOnePurchase({ PHONE: 'phone', DS_CUSTOMER: 'name' });
    expect('customerSummaryFields' in req).toBe(false);
  });
});
