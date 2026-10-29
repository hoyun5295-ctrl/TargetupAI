/**
 * ★ 2026-10-29 1.7.5 날짜 타입 원본 컬럼 = 원본 벽시계 글자 (뿌리 대장 R16 · 싱크에이전트로 넓힘)
 *
 *   엠티 VM 재검증(Oracle 11g · Server 2016 · KST · 1.7.4): 원본 DT_BIRTH 1970-04-08 · DT_LASTBUY 2026-10-25 가
 *   운영 PG 에 1970-04-07 · 2026-10-24 로 들어갔다(같은 행 custom 날짜 칸은 맞음).
 *   PG · Oracle 어댑터는 드라이버의 로컬 Date 를 toISOString 으로 넘긴다(KST 자정 = 전날 15:00Z) → 표준 날짜 칸은 앞 10자를 잘랐다.
 *   custom 칸은 0913 에 글자 모양으로 되돌렸으나 PG 는 'postgresql' 과 비교해 한 번도 돌지 않았고,
 *   모양으로 추측하면 TEXT 컬럼의 같은 꼴 원문까지 바뀐다(Codex 1R).
 *   → 엔진이 원본 컬럼 타입(date · datetime)을 읽고, 매핑이 그 컬럼 값만 되돌린다.
 */
process.env.TZ = 'Asia/Seoul';

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mapRow } from '../mapping';
import { normalizeCustomer, normalizePurchase } from './index';
import { ISO_DATE_CONNECTORS, type IDbConnector, type RawRow } from '../db/types';
import { SyncEngine, type SyncEngineConfig } from '../sync/engine';
import type { SyncStateManager } from '../sync/state';
import type { ApiClient } from '../api/client';

describe('시험 환경 = 한국 시각', () => {
  it('KST 자정의 ISO 는 전날 15:00Z 다(이 전제가 깨지면 아래 시험이 결함을 못 본다)', () => {
    expect(new Date(1970, 3, 8).toISOString()).toBe('1970-04-07T15:00:00.000Z');
  });
});

// 엠티 VM 실측 값 그대로(원본 → 어댑터가 넘긴 ISO)
const ROW: RawRow = {
  HP: '01002000001',
  DT_BIRTH: '1970-04-07T15:00:00.000Z',     // DATE 1970-04-08
  DT_LASTBUY: '2026-10-24T15:00:00.000Z',   // DATE 2026-10-25
  DT_FIRSTBUY: '2020-01-01T15:00:00.000Z',  // DATE 2020-01-02 → custom
  MEMO: '2026-10-24T15:00:00.000Z',         // VARCHAR2 원문(같은 꼴이라도 날짜가 아님)
};
const MAPPING = { HP: 'phone', DT_BIRTH: 'birth_date', DT_LASTBUY: 'recent_purchase_date', DT_FIRSTBUY: 'custom_1', MEMO: 'custom_2' };
const DATE_COLS = new Set(['DT_BIRTH', 'DT_LASTBUY', 'DT_FIRSTBUY']);

describe('매핑 + 정규화: 날짜 타입 컬럼만 원본 날짜로', () => {
  it('표준 날짜 칸 · custom 날짜 칸 = 원본 날짜 · TEXT 컬럼의 같은 꼴 글자 = 원문', () => {
    const out = normalizeCustomer(mapRow(ROW, MAPPING, DATE_COLS), { dbType: 'oracle' }) as any;
    expect(out.birth_date).toBe('1970-04-08');
    expect(out.birth_month_day).toBe('04-08');
    expect(out.recent_purchase_date).toBe('2026-10-25');
    expect(out.custom_fields).toEqual({ custom_1: '2020-01-02', custom_2: '2026-10-24T15:00:00.000Z' });
  });

  it('시각이 있는 날짜(오전 8시 = 전날 23:00Z)는 날짜 · 시각 모두 원본', () => {
    const m = mapRow({ HP: '01002000001', DT_LASTBUY: '2026-10-24T23:00:00.000Z', DT_FIRSTBUY: '2026-10-24T23:00:00.000Z' }, MAPPING, DATE_COLS);
    const out = normalizeCustomer(m, { dbType: 'oracle' }) as any;
    expect(out.recent_purchase_date).toBe('2026-10-25');
    expect(out.custom_fields.custom_1).toBe('2026-10-25 08:00:00');
  });

  it('구매일도 같은 매핑을 지나 원본 시각', () => {
    const m = mapRow({ HP: '01002000001', BUY_DT: '2026-10-24T23:00:00.000Z' }, { HP: 'customer_phone', BUY_DT: 'purchase_date' }, new Set(['BUY_DT']));
    expect(normalizePurchase(m, { dbType: 'postgres' }).purchase_date).toBe('2026-10-25 08:00:00');
  });

  it('날짜 컬럼 목록이 없으면(mysql · mssql · 엑셀 · 옛 호출) 지금과 같다', () => {
    const out = normalizeCustomer(mapRow(ROW, MAPPING), { dbType: 'oracle' }) as any;
    expect(out.birth_date).toBe('1970-04-07');
    expect(out.custom_fields.custom_2).toBe('2026-10-24T15:00:00.000Z');
  });
});

// ── 엔진 배선 ──
const COLS = [
  { name: 'HP', dataType: 'varchar' }, { name: 'DT_BIRTH', dataType: 'datetime' }, { name: 'DT_LASTBUY', dataType: 'date' },
  { name: 'DT_FIRSTBUY', dataType: 'datetime' }, { name: 'MEMO', dataType: 'varchar' },
];
function db(dbType: string, getColumns: () => Promise<unknown>, calls: { n: number }): IDbConnector {
  return {
    dbType,
    connect: async () => {}, disconnect: async () => {}, isConnected: () => true, testConnection: async () => true,
    getTables: async () => ['CUST'],
    getColumns: async () => { calls.n++; return getColumns(); },
    fetchIncremental: async () => [],
    fetchAll: async (_t: string, _l: number, offset: number) => (offset === 0 ? [{ ...ROW }] : []),
    getRowCount: async () => 1,
  } as unknown as IDbConnector;
}
const state = () => ({
  getState: () => ({ agentId: null }), getLastSyncAt: () => null, updateAfterSync: () => {}, updateFullSyncAt: () => {},
}) as unknown as SyncStateManager;
function api() {
  const sent: Array<Record<string, any>> = [];
  return {
    sent,
    api: {
      syncCustomers: async (req: { customers: Array<Record<string, unknown>> }) => {
        sent.push(...req.customers);
        return { data: { upsertedCount: req.customers.length, failedCount: 0 } };
      },
      sendLog: async () => {},
    } as unknown as ApiClient,
  };
}
const cfg: SyncEngineConfig = {
  batchSize: 100, customerTable: 'CUST', purchaseTable: '', timestampColumn: 'updated_at', fallbackToFullSync: true,
  customerMapping: MAPPING, purchaseMapping: {}, dryRun: false,
};

describe('엔진: 원본 컬럼 타입으로 되돌린다', () => {
  it('oracle — 날짜 타입 컬럼만 원본 날짜로 보낸다(TEXT 컬럼 원문 그대로)', async () => {
    const { api: a, sent } = api();
    const calls = { n: 0 };
    await new SyncEngine(db('oracle', async () => COLS, calls), a, state(), cfg).runFull('customers');
    expect(sent).toHaveLength(1);
    expect(sent[0].birth_date).toBe('1970-04-08');
    expect(sent[0].recent_purchase_date).toBe('2026-10-25');
    expect(sent[0].custom_fields).toEqual({ custom_1: '2020-01-02', custom_2: '2026-10-24T15:00:00.000Z' });
  });

  it('mysql — 컬럼 타입을 읽지 않고 지금과 같다(드라이버가 Date 객체를 준다 · 글자는 원문)', async () => {
    const { api: a, sent } = api();
    const calls = { n: 0 };
    await new SyncEngine(db('mysql', async () => COLS, calls), a, state(), cfg).runFull('customers');
    expect(sent[0].birth_date).toBe('1970-04-07');
    expect(calls.n).toBe(0);
  });

  it.each(['runFull', 'runIncremental'] as const)('컬럼 타입 조회 실패 = 한 건도 보내지 않고 잠근다(%s · 하루 밀린 날짜 · UTC 글자 custom 0)', async (run) => {
    const { api: a, sent } = api();
    const calls = { n: 0 };
    const result = await new SyncEngine(db('oracle', async () => { throw new Error('ORA-00942'); }, calls), a, state(), cfg)[run]('customers');
    expect(sent).toHaveLength(0);
    expect(result.successCount).toBe(0);
    expect(result.errors?.map((e) => e.code)).toEqual(['DATE_COLUMN_TYPE_UNKNOWN']);
  });

  it('증분(마지막 동기화 기록 있음 · 변경분 있음)도 컬럼 타입을 못 읽으면 보내지 않는다', async () => {
    const { api: a, sent } = api();
    const calls = { n: 0 };
    const conn = db('oracle', async () => { throw new Error('ORA-00942'); }, calls);
    let served = false;
    (conn as any).fetchIncremental = async () => (served ? [] : ((served = true), [{ ...ROW }]));
    const st = { ...state(), getLastSyncAt: () => '2026-10-29T00:00:00.000Z' } as unknown as SyncStateManager;
    const result = await new SyncEngine(conn, a, st, cfg).runIncremental('customers');
    expect(sent).toHaveLength(0);
    expect(result.mode).toBe('incremental');
    expect(result.errors?.map((e) => e.code)).toEqual(['DATE_COLUMN_TYPE_UNKNOWN']);
  });

  it('미리보기는 실행 캐시를 쓰지 않는다 — 미리보기 조회가 실패해도 다음 실행은 제 조회로 되돌린다', async () => {
    const { api: a, sent } = api();
    const calls = { n: 0 };
    let fail = true;
    const engine = new SyncEngine(db('oracle', async () => { if (fail) throw new Error('ORA-03113'); return COLS; }, calls), a, state(), cfg);
    const preview = await engine.previewMapping('customers', MAPPING);
    expect(preview.ok).toBe(false);
    fail = false;
    await engine.runFull('customers');
    expect(sent[0].birth_date).toBe('1970-04-08');
    expect(calls.n).toBe(2);
  });

  it('미리보기도 실제 전송과 같은 날짜 글자', async () => {
    const calls = { n: 0 };
    const engine = new SyncEngine(db('oracle', async () => COLS, calls), api().api, state(), cfg);
    const preview = await engine.previewMapping('customers', MAPPING);
    expect(preview.mappedRow?.birth_date).toBe('1970-04-08');
    expect((preview.mappedRow?.custom_fields as any)?.custom_2).toBe('2026-10-24T15:00:00.000Z');
  });

  it('한 실행 안에서는 컬럼 타입을 한 번만 읽는다', async () => {
    const { api: a } = api();
    const calls = { n: 0 };
    const multi = db('oracle', async () => COLS, calls);
    let page = 0;
    (multi as any).fetchAll = async () => (page++ < 3 ? [{ ...ROW, HP: `0100200000${page}` }] : []);
    await new SyncEngine(multi, a, state(), { ...cfg, batchSize: 1 }).runFull('customers');
    expect(calls.n).toBe(1);
  });

  it('다음 실행은 컬럼 타입을 새로 읽는다(원본 스키마 변경 반영)', async () => {
    const { api: a } = api();
    const calls = { n: 0 };
    const engine = new SyncEngine(db('oracle', async () => COLS, calls), a, state(), cfg);
    await engine.runFull('customers');
    await engine.runFull('customers');
    expect(calls.n).toBe(2);
  });
});

describe('알림 판정 = 만드는 자리의 운영 장애 표시(Codex 3R)', () => {
  it('날짜 타입 조회 실패 잠금 = 알림 실패(사유 포함)', async () => {
    const onSyncResult = vi.fn();
    const engine = new SyncEngine(db('oracle', async () => { throw new Error('ORA-00942'); }, { n: 0 }), api().api, state(), cfg, { onSyncResult } as any);
    await engine.runIncremental('customers');
    expect(onSyncResult).toHaveBeenCalledWith(false, expect.stringContaining('날짜 컬럼'));
  });

  it('전송 실패 = 알림 실패 · 정상 = 성공', async () => {
    const failApi = { syncCustomers: async () => { throw new Error('ECONNRESET'); }, sendLog: async () => {} } as unknown as ApiClient;
    const bad = vi.fn();
    await new SyncEngine(db('oracle', async () => COLS, { n: 0 }), failApi, state(), cfg, { onSyncResult: bad } as any).runFull('customers');
    expect(bad).toHaveBeenCalledWith(false, expect.stringContaining('ECONNRESET'));
    const good = vi.fn();
    await new SyncEngine(db('oracle', async () => COLS, { n: 0 }), api().api, state(), cfg, { onSyncResult: good } as any).runFull('customers');
    expect(good).toHaveBeenCalledWith(true, undefined);
  });

  it('설계상 잠금(파일 원본 구매 1회) = 알림 없음(지금 동작)', async () => {
    const onSyncResult = vi.fn();
    const file = db('excel', async () => [], { n: 0 });
    const result = await new SyncEngine(file, api().api, state(), { ...cfg, purchaseTable: 'P', purchaseMapping: { HP: 'customer_phone' } }, { onSyncResult } as any)
      .runIncremental('purchases');
    expect(result.errors?.map((e) => e.code)).toEqual(['INCREMENTAL_LOCKED_FILE_SOURCE']);
    expect(onSyncResult).toHaveBeenCalledWith(true, undefined);
  });
});

describe('계약: 날짜를 ISO 글자로 넘기는 어댑터 = ISO_DATE_CONNECTORS', () => {
  it('db/*.ts 에서 Date 를 toISOString 으로 바꾸는 어댑터의 dbType 은 모두 목록에 있고, 목록에 그 밖은 없다', () => {
    const dir = path.resolve(__dirname, '../db');
    const found: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!/\.toISOString\(\)/.test(src)) continue;
      const m = src.match(/readonly dbType = '([a-z]+)' as const/);
      expect(m, `${f}: dbType 선언을 못 찾음`).not.toBeNull();
      found.push(m![1]);
    }
    expect(found.sort()).toEqual(['oracle', 'postgres']);
    expect([...ISO_DATE_CONNECTORS].sort()).toEqual(found);
  });
});
