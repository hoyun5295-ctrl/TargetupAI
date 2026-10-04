/**
 * 싱크 적재 계통 오류 = 503 (2026-10-04 싱크·자사몰 전수점검 S7 · S2 · S3)
 *
 * 못 박는 것:
 *   1. 고객·구매 청크가 계통 오류(교착 40P01 · 시간 초과 57014 · 연결 08006)로 실패하면 남은 청크를 멈추고 503 SYNC_RETRY.
 *      옛: 200 + 실패 건수 → 에이전트가 HTTP 성공으로 보고 커서를 넘겨 그 행들이 영구히 빠졌다.
 *   2. 단건 폴백 중에 계통 오류가 나도 503(뒤 행들을 "행 실패"로 세지 않는다).
 *   3. 행 오류(22xxx · 23xxx)는 지금처럼 그 행만 실패로 보고하고 200.
 *   4. 고객 행은 폰 순서로 적재한다(동시 요청 교착 방지).
 *   5. 매장 기록이 실패해 단건 폴백으로 가도 처리 건수를 두 번 세지 않는다.
 *
 * 테스트 번호는 형식만 맞는 도달 불가 값(010-0000-000x)만 쓴다.
 */
import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import os from 'node:os';

// pg 연결만 가짜로 둔다 — config/database 의 실제 query · withTransaction 이 이 가짜 연결 위에서 돈다(트랜잭션 경계까지 검사).
const h = vi.hoisted(() => ({ q: null as any, tx: [] as string[], seq: [] as string[] }));
vi.mock('pg', () => {
  const run = (sql: string, values?: any[]) => {
    h.seq.push(sql.replace(/\s+/g, ' ').trim().slice(0, 40));
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) {
      h.tx.push(sql);
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return h.q(sql, values);
  };
  class Pool {
    query = run;
    connect = async () => ({ query: run, release: () => undefined });
    on() { return this; }
  }
  return { Pool, types: { setTypeParser: () => undefined } };
});
vi.mock('../utils/geo-access', () => ({ guardMachineOrigin: vi.fn(async () => true) }));
vi.mock('../utils/secret-hash', () => ({
  hashSecret: (s: string) => `h:${s}`,
  verifySecret: () => ({ ok: true, needsUpgrade: false }),
}));
vi.mock('../utils/system-sync-user', () => ({ ensureSystemSyncUser: vi.fn(async () => 'sys-user') }));
vi.mock('../utils/unsubscribe-helper', () => ({ registerBulkCompanyUserUnsubscribes: vi.fn(async () => 0) }));
vi.mock('../utils/customer-purchase-aggregates', () => ({ updateCustomerPurchaseAggregates: vi.fn(async () => undefined) }));
vi.mock('../utils/enabled-fields', () => ({ clearEnabledFieldsCache: vi.fn() }));
vi.mock('../utils/ai-mapping', () => ({
  callAiMapping: vi.fn(),
  AiMappingQuotaExceeded: class extends Error {},
  AiMappingUnavailable: class extends Error {},
}));
vi.mock('../utils/agent-build-tiers', () => ({
  agentReleasesDir: () => os.tmpdir(),
  resolveBuildTierFromOsInfo: () => null,
}));

import express from 'express';
import syncRouter from './sync';

const q = vi.fn();
h.q = q;

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/sync', syncRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sync`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

const dbErr = (code: string) => Object.assign(new Error(`db ${code}`), { code });

interface Plan {
  /** 고객 일괄 INSERT 에 던질 오류(없으면 성공) */
  customerChunk?: Error;
  /** 고객 단건 INSERT 에 던질 오류 — 호출 순서대로 */
  customerRows?: Array<Error | null>;
  /** 매장 일괄 INSERT 에 던질 오류 */
  storeChunk?: Error;
  purchaseChunk?: Error;
  purchaseRows?: Array<Error | null>;
}

const calls = { customerInsert: [] as any[][], purchaseInsert: 0, syncLogs: 0, unsub: 0 };

function mockDb(plan: Plan) {
  let customerRowIdx = 0;
  let purchaseRowIdx = 0;
  q.mockImplementation(async (sql: string, values: any[] = []) => {
    if (/FROM companies\s+WHERE api_key = \$1/i.test(sql)) {
      return { rows: [{ id: 'co-1', name: '테스트', company_name: '테스트', status: 'active', use_db_sync: true, api_secret: null, api_secret_hash: 'h:x' }] };
    }
    if (/SELECT id FROM sync_agents WHERE company_id/i.test(sql)) return { rows: [{ id: 'agent-1' }] };
    if (/INSERT INTO customers\s*\(/i.test(sql)) {
      calls.customerInsert.push(values);
      const isSingle = (sql.match(/\),\s*\(/g) || []).length === 0 && /VALUES\s*\(/i.test(sql) && values.length < 60;
      if (!isSingle && plan.customerChunk) throw plan.customerChunk;
      if (isSingle && plan.customerRows) {
        const e = plan.customerRows[customerRowIdx++];
        if (e) throw e;
      }
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO customer_stores/i.test(sql)) {
      if (plan.storeChunk && values.length > 3) throw plan.storeChunk;
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO purchases/i.test(sql)) {
      calls.purchaseInsert++;
      const rows = (sql.match(/NOW\(\)\)/g) || []).length;
      if (rows > 1 && plan.purchaseChunk) throw plan.purchaseChunk;
      if (rows <= 1 && plan.purchaseRows) {
        const e = plan.purchaseRows[purchaseRowIdx++];
        if (e) throw e;
      }
      return { rows: [], rowCount: rows };
    }
    if (/INSERT INTO sync_logs/i.test(sql)) { calls.syncLogs++; return { rows: [] }; }
    if (/unsubscribes/i.test(sql)) { calls.unsub++; return { rows: [], rowCount: 0 }; }
    if (/SELECT id, phone FROM customers/i.test(sql)) return { rows: [] };
    if (/FROM sync_agents/i.test(sql)) return { rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

async function post(path: string, body: any) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sync-ApiKey': 'k', 'X-Sync-Secret': 'x' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

const customers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ phone: `0100000${String(n - i).padStart(4, '0')}`, name: `고객${i}`, store_code: 'S1' }));
const purchases = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ customer_phone: '01000000001', purchase_date: '2026-10-01', total_amount: 1000, source_row_key: `k${i}` }));

beforeEach(() => {
  q.mockReset();
  h.tx.length = 0;
  h.seq.length = 0;
  calls.customerInsert = [];
  calls.purchaseInsert = 0;
  calls.syncLogs = 0;
  calls.unsub = 0;
});

describe('고객 적재 — 계통 오류는 503', () => {
  it('청크 교착(40P01) = 503 SYNC_RETRY · 남은 청크 멈춤 · 실패로 세지 않음(sync_logs·수신거부 대조 없음)', async () => {
    mockDb({ customerChunk: dbErr('40P01') });
    const r = await post('/customers', { customers: customers(1200), mode: 'incremental' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('SYNC_RETRY');
    expect(calls.customerInsert.length).toBe(1); // 첫 청크에서 멈춘다(옛: 3청크 모두 시도)
    expect(calls.syncLogs).toBe(0);
    expect(calls.unsub).toBe(0);
  });

  it('단건 폴백 중 연결 오류(08006) = 503 (뒤 행을 실패로 세지 않음)', async () => {
    mockDb({ customerChunk: dbErr('22P02'), customerRows: [null, dbErr('08006')] });
    const r = await post('/customers', { customers: customers(5), mode: 'incremental' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('SYNC_RETRY');
    // 일괄 1 + 단건 2(두 번째에서 멈춤)
    expect(calls.customerInsert.length).toBe(3);
  });

  it('행 오류(23505)는 그 행만 실패 · 200', async () => {
    mockDb({ customerChunk: dbErr('23505'), customerRows: [null, dbErr('23505'), null] });
    const r = await post('/customers', { customers: customers(3), mode: 'incremental' });
    expect(r.status).toBe(200);
    expect(r.body.data.failedCount).toBe(1);
    expect(r.body.data.upsertedCount).toBe(2);
  });

  it('폰 순서로 적재한다(입력이 역순이어도)', async () => {
    mockDb({});
    const r = await post('/customers', { customers: customers(3), mode: 'incremental' });
    expect(r.status).toBe(200);
    const values = calls.customerInsert[0];
    const idx = ['01000000001', '01000000002', '01000000003'].map((p) => values.indexOf(p));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect(idx[0]).toBeLessThan(idx[1]);
    expect(idx[1]).toBeLessThan(idx[2]);
  });

  it('매장 기록 실패로 단건 폴백해도 처리 건수는 한 번만 센다', async () => {
    mockDb({ storeChunk: dbErr('23503') });
    const r = await post('/customers', { customers: customers(3), mode: 'incremental' });
    expect(r.status).toBe(200);
    expect(r.body.data.upsertedCount).toBe(3); // 옛: 일괄 3 + 단건 3 = 6
  });
});

describe('구매 적재 — 계통 오류는 503', () => {
  it('청크 시간 초과(57014) = 503 · 단건 폴백을 돌지 않는다', async () => {
    mockDb({ purchaseChunk: dbErr('57014') });
    const r = await post('/purchases', { purchases: purchases(3), mode: 'incremental' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('SYNC_RETRY');
    expect(calls.purchaseInsert).toBe(1);
  });

  it('행 오류(22007)는 단건 폴백으로 그 행만 실패 · 200', async () => {
    mockDb({ purchaseChunk: dbErr('22007'), purchaseRows: [null, dbErr('22007'), null] });
    const r = await post('/purchases', { purchases: purchases(3), mode: 'incremental' });
    expect(r.status).toBe(200);
    expect(r.body.data.failedCount).toBe(1);
    expect(r.body.data.insertedCount).toBe(2);
  });

  it('단건 폴백 중 교착(40P01) = 503', async () => {
    mockDb({ purchaseChunk: dbErr('22007'), purchaseRows: [dbErr('40P01')] });
    const r = await post('/purchases', { purchases: purchases(3), mode: 'incremental' });
    expect(r.status).toBe(503);
    expect(calls.purchaseInsert).toBe(2);
  });
});

describe('트랜잭션 경계 (Codex 1004 R1)', () => {
  const idx = (re: RegExp, from = 0) => h.seq.findIndex((x, i) => i >= from && re.test(x));

  it('고객: 못 알아본 동의(미동의) · 기본 동의 백필이 업서트와 같은 트랜잭션 안에서 커밋 전에 돈다', async () => {
    mockDb({});
    const body = customers(2).map((c, i) => (i === 0 ? { ...c, sms_opt_in_unknown: '수신안함' } : c));
    const r = await post('/customers', { customers: body, mode: 'incremental' });
    expect(r.status).toBe(200);
    const b = idx(/^BEGIN/);
    const ins = idx(/^INSERT INTO customers/, b);
    const unknown = idx(/^UPDATE customers SET sms_opt_in = false/, ins);
    const backfill = idx(/^UPDATE customers SET sms_opt_in = true/, unknown);
    const commit = idx(/^COMMIT/, backfill);
    expect([b, ins, unknown, backfill, commit].every((x) => x >= 0)).toBe(true);
    // 미동의 대상 = 못 알아본 그 번호만
    const unknownCall = q.mock.calls.find(([sql]) => /SET sms_opt_in = false/.test(sql));
    expect(unknownCall?.[1]?.[1]).toEqual(['01000000002']);
  });

  it('고객: 청크가 실패하면 그 청크의 동의 기본값도 함께 되돌린다(ROLLBACK · 커밋 0)', async () => {
    mockDb({ customerChunk: dbErr('40P01') });
    const r = await post('/customers', { customers: customers(2), mode: 'incremental' });
    expect(r.status).toBe(503);
    expect(h.tx).toEqual(['BEGIN', 'ROLLBACK']);
    expect(h.seq.some((x) => /^UPDATE customers SET sms_opt_in/.test(x))).toBe(false);
  });

  it('구매: 둘째 청크 계통 오류 = 요청 전체 ROLLBACK(첫 청크도 남지 않는다) · 503', async () => {
    let n = 0;
    mockDb({});
    const base = q.getMockImplementation()!;
    q.mockImplementation(async (sql: string, values: any[] = []) => {
      if (/INSERT INTO purchases/i.test(sql) && ++n === 2) throw dbErr('57014');
      return base(sql, values);
    });
    const r = await post('/purchases', { purchases: purchases(600).map((p) => ({ ...p, source_row_key: undefined })), mode: 'full' });
    expect(r.status).toBe(503);
    expect(h.tx[0]).toBe('BEGIN');
    expect(h.tx).not.toContain('COMMIT');
    expect(h.tx[h.tx.length - 1]).toBe('ROLLBACK');
  });

  it('구매: 행 오류는 그 행만 SAVEPOINT 로 되돌리고 나머지는 커밋', async () => {
    mockDb({ purchaseChunk: dbErr('22007'), purchaseRows: [null, dbErr('22007'), null] });
    const r = await post('/purchases', { purchases: purchases(3), mode: 'incremental' });
    expect(r.status).toBe(200);
    expect(r.body.data.insertedCount).toBe(2);
    expect(h.tx.filter((x) => x === 'ROLLBACK TO SAVEPOINT p_row')).toHaveLength(1);
    expect(h.tx.filter((x) => x === 'ROLLBACK TO SAVEPOINT p_chunk')).toHaveLength(1);
    expect(h.tx[h.tx.length - 1]).toBe('COMMIT');
    expect(h.tx).not.toContain('ROLLBACK');
  });
});
