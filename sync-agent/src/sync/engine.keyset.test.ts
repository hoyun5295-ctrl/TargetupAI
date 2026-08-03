/**
 * 엔진 키셋 커서 경로 (★ 2026-08-03 · Codex 적대검증 반영) — 전진 규칙·잠금·씨앗을 고정한다.
 *
 * 고정하는 계약:
 *   1) 커서는 **닫힌 버킷 경계**만 저장한다 — 더 큰 ts가 관측된 버킷의 마지막 행까지.
 *      최대 ts 버킷(열린 버킷)은 저장하지 않고 매 주기 재조회한다(같은 ts 낮은 PK 후행 삽입 유실 차단 — F2).
 *   2) API 실패 = 미전진. 행 검증 실패는 전진(영구 재조회 루프 차단).
 *   3) 직렬화 불가 키 행은 **보내지 않고** 행 실패로 보고한다(키 없는 행은 재조회마다 중복 — F4).
 *   4) PK 없음·비스칼라 PK = 증분 잠금. 커서 fingerprint 불일치 = 폐기 후 전량 재기준(F3).
 *   5) 전량 씨앗은 **완전 스캔 + API 무실패**일 때만(F1), 시작 시점 닫힌 경계로(2단 조회).
 *      닫힌 경계가 없으면(버킷 하나) 열린 버킷 시작 커서(keys=[] → ts >= 재조회)로.
 */
import { describe, it, expect, vi } from 'vitest';
import { SyncEngine, SyncEngineConfig } from './engine';
import type { IDbConnector, RawRow, ColumnInfo } from '../db/types';
import type { IncrementalCursor, RowCursorMeta } from '../db/keyset';
import type { SyncCursorState, SyncTarget } from '../types/sync';

// 엔진 fingerprint 규약(JSON 구조화 — 3R F11)과 같은 값. 키셋 경로는 getSourceId 필수(4R F13).
const FP = JSON.stringify(['mock', 'mock-src', 'SALES', 'SALE_DT', ['SALE_ID']]);

// ─── 인메모리 상태 (파일 I/O 없는 SyncStateManager 대역) ──

function makeState(initialCursor?: SyncCursorState | null, hold?: string | null) {
  const cursors: Record<string, SyncCursorState | null> = { purchases: initialCursor ?? null, customers: null };
  const holds: Record<string, string | null> = { purchases: hold ?? null, customers: null };
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

// ─── mock 어댑터 ────────────────────────────────────────

const PK_COLS: ColumnInfo[] = [
  { name: 'SALE_ID', dataType: 'int', nullable: false, isPrimaryKey: true },
  { name: 'PHONE', dataType: 'varchar', nullable: false },
  { name: 'SALE_DT', dataType: 'datetime', nullable: true },
];

function makeDb(pages: Array<{ rows: RawRow[]; meta: RowCursorMeta[] }>, opts?: {
  columns?: ColumnInfo[];
  maxCursor?: IncrementalCursor | null;   // 2단 조회 ①최대 튜플(T0)
  closedSeed?: IncrementalCursor | null;  // 2단 조회 ②닫힌 경계(ts < T0)
  fullRows?: RawRow[];
  rowCount?: number;                      // 미지정 시 fullRows 길이(완전 스캔)
}) {
  let call = 0;
  const fetchIncrementalKeyset = vi.fn(async () => pages[call++] ?? { rows: [], meta: [] });
  const fetchMaxCursor = vi.fn(async (_t: string, _c: string, _p: string[], beforeTs?: string | null) =>
    beforeTs ? (opts?.closedSeed ?? null) : (opts?.maxCursor ?? null));
  let fullServed = false;
  const db: IDbConnector = {
    dbType: 'mock' as any,
    connect: async () => {}, disconnect: async () => {}, isConnected: () => true,
    testConnection: async () => true,
    getColumns: async () => opts?.columns ?? PK_COLS,
    getTables: async () => [],
    fetchIncremental: vi.fn(async () => []),
    fetchAll: vi.fn(async () => {
      if (fullServed || !opts?.fullRows) return [];
      fullServed = true;
      return opts.fullRows;
    }),
    getRowCount: async () => opts?.rowCount ?? opts?.fullRows?.length ?? 0,
    fetchIncrementalKeyset,
    fetchMaxCursor,
    getSourceId: () => 'mock-src',
  };
  return { db, fetchIncrementalKeyset, fetchMaxCursor };
}

const CONFIG: SyncEngineConfig = {
  batchSize: 2,
  customerTable: 'CUST',
  purchaseTable: 'SALES',
  timestampColumn: 'SALE_DT',
  fallbackToFullSync: true,
  customerMapping: { PHONE: 'phone', NAME: 'name' },
  purchaseMapping: { PHONE: 'customer_phone', SALE_DT: 'purchase_date', AMT: 'total_amount' },
};

function makeApi() {
  const sent: any[] = [];
  return {
    sent,
    syncPurchases: vi.fn(async (req: any) => { sent.push(req); return { data: { insertedCount: req.purchases.length } }; }),
    syncCustomers: vi.fn(async (req: any) => ({ data: { upsertedCount: req.customers.length } })),
    sendLog: vi.fn(async () => {}),
  } as any;
}

const CURSOR: SyncCursorState = { tsRaw: '2026-08-01 00:00:00', keys: [100], pkColumns: ['SALE_ID'], fingerprint: FP };
const TS_A = '2026-08-02 00:00:00';
const TS_B = '2026-08-03 00:00:00';

// 미할당 대역 테스트 번호(도달 불가) — 실번호 생성 금지 규칙
const row = (id: number, phone = '01000000001'): RawRow => ({
  SALE_ID: id, PHONE: phone, SALE_DT: '2026-08-02', AMT: 1000,
});

describe('키셋 증분 — 닫힌 버킷 경계 전진', () => {
  it('더 큰 ts가 관측된 버킷의 마지막 행까지만 저장하고, 열린 버킷은 저장하지 않는다', async () => {
    const state = makeState(CURSOR);
    const { db } = makeDb([
      {
        rows: [row(101), row(102)],
        meta: [{ tsRaw: TS_A, keys: [101] }, { tsRaw: TS_A, keys: [102] }],
      },
      { rows: [row(103)], meta: [{ tsRaw: TS_B, keys: [103] }] },
    ]);
    const api = makeApi();
    const engine = new SyncEngine(db, api, state, CONFIG);

    const result = await engine.runIncremental('purchases');

    expect(result.successCount).toBe(3);
    // A 버킷은 B가 관측된 순간 닫힌다 → 경계 = A의 마지막 행(102). B(열린 버킷)는 저장 안 함.
    expect(state.setCursorCalls).toEqual([
      { tsRaw: TS_A, keys: [102], pkColumns: ['SALE_ID'], fingerprint: FP },
    ]);
  });

  it('전 페이지가 같은 ts(열린 버킷 하나)면 커서를 저장하지 않는다 — 다음 주기가 재조회한다', async () => {
    const state = makeState(CURSOR);
    const { db } = makeDb([
      { rows: [row(101)], meta: [{ tsRaw: TS_A, keys: [101] }] },
    ]);
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runIncremental('purchases');
    expect(state.setCursorCalls).toHaveLength(0);
  });

  it('payload에 source_row_key(PK 직렬화)가 실린다', async () => {
    const state = makeState(CURSOR);
    const { db } = makeDb([
      { rows: [row(101)], meta: [{ tsRaw: TS_A, keys: [101] }] },
    ]);
    const api = makeApi();
    const engine = new SyncEngine(db, api, state, CONFIG);

    await engine.runIncremental('purchases');
    expect(api.sent[0].purchases[0].source_row_key).toBe('101');
  });

  it('API 실패면 커서를 전진하지 않는다(다음 주기 재시도)', async () => {
    const state = makeState(CURSOR);
    const { db } = makeDb([
      { rows: [row(101), row(102)], meta: [{ tsRaw: TS_A, keys: [101] }, { tsRaw: TS_B, keys: [102] }] },
    ]);
    const api = makeApi();
    api.syncPurchases = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const engine = new SyncEngine(db, api, state, CONFIG);

    const result = await engine.runIncremental('purchases');

    expect(state.setCursorCalls).toHaveLength(0);
    expect(result.errors.some((e) => e.code === 'API_SEND_FAILED')).toBe(true);
  });

  it('행 검증 실패(전화 불량)는 경계 전진을 막지 않는다 — 영구 재조회 루프 차단', async () => {
    const state = makeState(CURSOR);
    const { db } = makeDb([
      {
        rows: [row(101, 'bad-phone'), row(102)],
        meta: [{ tsRaw: TS_A, keys: [101] }, { tsRaw: TS_B, keys: [102] }],
      },
    ]);
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runIncremental('purchases');
    // 불량 행이 있어도 A 버킷은 닫혔으므로 경계(101)가 저장된다.
    expect(state.setCursorCalls).toEqual([
      { tsRaw: TS_A, keys: [101], pkColumns: ['SALE_ID'], fingerprint: FP },
    ]);
  });

  it('직렬화 불가 키 행은 보내지 않고 행 실패로 보고한다 — 키 없는 전송은 재조회마다 중복(F4)', async () => {
    const state = makeState(CURSOR);
    const longKey = 'K'.repeat(201);
    const { db } = makeDb([
      {
        rows: [{ ...row(0), SALE_ID: longKey }, row(102)],
        meta: [{ tsRaw: TS_A, keys: [longKey] }, { tsRaw: TS_A, keys: [102] }],
      },
    ]);
    const api = makeApi();
    const engine = new SyncEngine(db, api, state, CONFIG);

    const result = await engine.runIncremental('purchases');

    expect(api.sent[0].purchases).toHaveLength(1);
    expect(api.sent[0].purchases[0].source_row_key).toBe('102');
    expect(result.errors.some((e) => e.code === 'SOURCE_KEY_UNSERIALIZABLE')).toBe(true);
    expect(result.failCount).toBe(1);
  });
});

describe('키셋 증분 — 잠금·재기준', () => {
  it('PK 없는 테이블은 증분을 잠근다(전량 폭주 금지·사유 보고)', async () => {
    const state = makeState(CURSOR);
    const { db, fetchIncrementalKeyset } = makeDb([], {
      columns: [
        { name: 'PHONE', dataType: 'varchar', nullable: false },
        // 타임스탬프 컬럼은 실재해야 한다 — 없으면 그보다 앞 게이트(컬럼 검증)가 전량 폴백으로 보낸다
        { name: 'SALE_DT', dataType: 'datetime', nullable: true },
      ],
    });
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    const result = await engine.runIncremental('purchases');

    expect(result.errors.some((e) => e.code === 'INCREMENTAL_LOCKED_NO_PK')).toBe(true);
    expect(fetchIncrementalKeyset).not.toHaveBeenCalled();
    expect((db.fetchAll as any)).not.toHaveBeenCalled();
  });

  it('날짜형 PK는 잠근다 — 결정적 직렬화 불가', async () => {
    const state = makeState(CURSOR);
    const { db } = makeDb([], {
      columns: [{ name: 'SALE_DT', dataType: 'datetime', nullable: false, isPrimaryKey: true }],
    });
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    const result = await engine.runIncremental('purchases');
    expect(result.errors.some((e) => e.code === 'INCREMENTAL_LOCKED_PK_TYPE')).toBe(true);
  });

  it('fingerprint가 다르면 커서를 폐기하고 전량으로 재기준한다(F3 — 소스·축 변경 fail-closed)', async () => {
    const state = makeState({ tsRaw: '2026-08-01 00:00:00', keys: [1], pkColumns: ['SALE_ID'], fingerprint: JSON.stringify(['mock', 'mock-src', 'OTHER', 'SALE_DT', ['SALE_ID']]) });
    const { db, fetchIncrementalKeyset } = makeDb([]);
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runIncremental('purchases');

    expect(fetchIncrementalKeyset).not.toHaveBeenCalled();
    expect((db.fetchAll as any).mock.calls.length).toBeGreaterThan(0); // 전량 진입
  });

  it('getSourceId 미구현 어댑터는 증분을 잠근다(4R F13 — 같은 dbType 다른 소스가 같은 fingerprint가 된다)', async () => {
    const state = makeState(CURSOR);
    const { db, fetchIncrementalKeyset } = makeDb([
      { rows: [row(101)], meta: [{ tsRaw: TS_A, keys: [101] }] },
    ]);
    delete (db as any).getSourceId;
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    const result = await engine.runIncremental('purchases');

    expect(result.errors.some((e) => e.code === 'INCREMENTAL_LOCKED_NO_SOURCE_ID')).toBe(true);
    expect(fetchIncrementalKeyset).not.toHaveBeenCalled();
    expect(state.setCursorCalls).toHaveLength(0);
  });

  it('열린 버킷 커서(keys=[])는 그대로 어댑터에 전달된다 — ts >= 재조회', async () => {
    const state = makeState({ tsRaw: TS_A, keys: [], pkColumns: ['SALE_ID'], fingerprint: FP });
    const { db, fetchIncrementalKeyset } = makeDb([
      { rows: [row(101)], meta: [{ tsRaw: TS_A, keys: [101] }] },
    ]);
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runIncremental('purchases');

    const passed = (fetchIncrementalKeyset.mock.calls[0] as unknown[])[3];
    expect(passed).toEqual({ tsRaw: TS_A, keys: [] });
  });
});

describe('전량 동기화 — 커서 씨앗 (F1·F2 게이트)', () => {
  it('시작 시점의 닫힌 버킷 경계를 씨앗으로 심는다(2단 조회 — 최대 튜플이 아니다)', async () => {
    const state = makeState(null);
    const t0: IncrementalCursor = { tsRaw: TS_B, keys: [999] };
    const closed: IncrementalCursor = { tsRaw: TS_A, keys: [888] };
    const { db, fetchMaxCursor } = makeDb([], { maxCursor: t0, closedSeed: closed, fullRows: [row(1), row(2)] });
    const api = makeApi();
    const engine = new SyncEngine(db, api, state, CONFIG);

    const result = await engine.runFull('purchases');

    expect(result.successCount).toBe(2);
    // 씨앗 조회가 스캔(fetchAll)보다 먼저 — 스캔 중 생긴 행이 유실되지 않는 순서
    expect(fetchMaxCursor.mock.invocationCallOrder[0])
      .toBeLessThan((db.fetchAll as any).mock.invocationCallOrder[0]);
    expect(state.setCursorCalls).toEqual([
      { tsRaw: TS_A, keys: [888], pkColumns: ['SALE_ID'], fingerprint: FP },
    ]);
    // 전량도 source_row_key를 싣는다
    expect(api.sent[0].purchases[0].source_row_key).toBe('1');
  });

  it('버킷이 하나뿐이면 열린 버킷 시작 커서(keys=[])로 심는다 — 매 주기 그 버킷 재조회', async () => {
    const state = makeState(null);
    const t0: IncrementalCursor = { tsRaw: TS_A, keys: [7] };
    const { db } = makeDb([], { maxCursor: t0, closedSeed: null, fullRows: [row(1)] });
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runFull('purchases');

    expect(state.setCursorCalls).toEqual([
      { tsRaw: TS_A, keys: [], pkColumns: ['SALE_ID'], fingerprint: FP },
    ]);
  });

  it('불완전 스캔이면 씨앗을 심지 않는다(F1) — 놓친 행이 커서 아래로 들어가 영구 유실된다', async () => {
    const state = makeState(null);
    const t0: IncrementalCursor = { tsRaw: TS_B, keys: [999] };
    const closed: IncrementalCursor = { tsRaw: TS_A, keys: [888] };
    // 원천 5행인데 2행만 수신 — 미완
    const { db } = makeDb([], { maxCursor: t0, closedSeed: closed, fullRows: [row(1), row(2)], rowCount: 5 });
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runFull('purchases');

    expect(state.setCursorCalls).toHaveLength(0);
    expect(state.getIncrementalHold('purchases')).toBeNull();
  });

  it('API 실패가 있으면 씨앗을 심지 않는다(F1)', async () => {
    const state = makeState(null);
    const t0: IncrementalCursor = { tsRaw: TS_B, keys: [999] };
    const { db } = makeDb([], { maxCursor: t0, closedSeed: { tsRaw: TS_A, keys: [888] }, fullRows: [row(1)] });
    const api = makeApi();
    api.syncPurchases = vi.fn(async () => { throw new Error('502'); });
    const engine = new SyncEngine(db, api, state, CONFIG);

    await engine.runFull('purchases');
    expect(state.setCursorCalls).toHaveLength(0);
  });

  it('카운트 0인데 행을 받았으면 미완으로 취급해 씨앗을 심지 않는다(2R F7 — 카운트 자체가 틀렸다)', async () => {
    const state = makeState(null);
    const { db } = makeDb([], {
      maxCursor: { tsRaw: TS_B, keys: [9] }, closedSeed: { tsRaw: TS_A, keys: [8] },
      fullRows: [row(1)], rowCount: 0,
    });
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runFull('purchases');

    expect(state.setCursorCalls).toHaveLength(0);
    expect(state.getIncrementalHold('purchases')).toBeNull();
  });

  it('시작 탐침이 비었는데 종료 탐침에 값이 보이면 씨앗도 보류도 없이 다음 주기 전량 재기준(2R F7 — 재탐침은 씨앗이 아니다)', async () => {
    const state = makeState(null);
    // 시작 탐침 null → 스캔 중 신규 행 발생 시나리오: 종료 탐침은 값을 돌려준다.
    let probeCall = 0;
    const { db, fetchMaxCursor } = makeDb([], { fullRows: [row(1)] });
    fetchMaxCursor.mockImplementation(async (_t: string, _c: string, _p: string[], beforeTs?: string | null) => {
      probeCall++;
      if (probeCall === 1) return null;                     // 시작 탐침 = 비어 있음(T0 없으면 1회로 끝)
      return beforeTs ? null : { tsRaw: TS_B, keys: [1] };  // 종료 탐침 = 값 관측
    });
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runFull('purchases');

    expect(state.setCursorCalls).toHaveLength(0);
    expect(state.getIncrementalHold('purchases')).toBeNull();
  });

  it('타임스탬프 값이 전부 NULL이면 증분 보류를 설정한다(매 주기 전량 폭주 금지)', async () => {
    const state = makeState(null);
    const { db } = makeDb([], { maxCursor: null, closedSeed: null, fullRows: [row(1)] });
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runFull('purchases');

    expect(state.getIncrementalHold('purchases')).toContain('NULL');
    expect(state.setCursorCalls).toHaveLength(0);
  });

  it('보류 중 탐침이 값을 관측하면 보류를 풀고 전량으로 재기준한다', async () => {
    const state = makeState(null, '타임스탬프 컬럼 값이 전부 NULL');
    const t0: IncrementalCursor = { tsRaw: TS_B, keys: [1] };
    const { db, fetchIncrementalKeyset } = makeDb([], { maxCursor: t0, closedSeed: { tsRaw: TS_A, keys: [1] }, fullRows: [row(1)] });
    const engine = new SyncEngine(db, makeApi(), state, CONFIG);

    await engine.runIncremental('purchases');

    expect(state.getIncrementalHold('purchases')).toBeNull();
    expect((db.fetchAll as any).mock.calls.length).toBeGreaterThan(0); // 전량 재기준
    expect(fetchIncrementalKeyset).not.toHaveBeenCalled();             // 증분은 다음 주기부터
  });
});
