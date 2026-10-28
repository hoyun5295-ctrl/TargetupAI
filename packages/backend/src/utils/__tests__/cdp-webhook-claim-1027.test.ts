/**
 * 웹훅 수신 즉시 200 · 선점 문장 하나(★ 2026-10-27 자사몰 대비 K2-5 · K2-6 · 설계서 §6 짝 시험)
 *
 * 선점 · 재처리 · 정리 SQL 을 실제 SQL 엔진(pg-mem)으로 실행해 행 상태를 단정한다.
 * pg-mem 한계(시험 전용 고쳐 쓰기): 행 잠금이 없어 `FOR UPDATE SKIP LOCKED` 를 걷고, `make_interval(days => $1)` 를 같은 뜻의 간격 글자로 바꾼다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';

const holder: { db: any } = { db: null };
vi.mock('../../config/database', () => ({
  query: async (sql: string, params: any[] = []) => {
    let s = sql.replace(/FOR UPDATE SKIP LOCKED/g, '').replace(/make_interval\(days => \$1\)/g, "($1 || ' days')::interval");
    // pg-mem 은 $n 자리 표시를 바인드로 받는다
    return holder.db.public.query(bindParams(s, params));
  },
}));
const sendSystemAlert = vi.fn(async () => undefined);
vi.mock('../system-alert', () => ({ sendSystemAlert: (...a: any[]) => (sendSystemAlert as any)(...a) }));
const processWebhookEvent = vi.fn(async (..._a: any[]): Promise<any> => undefined);
vi.mock('../provider-registry', () => ({ getProvider: () => ({ processWebhookEvent }) }));

import { deliverWebhookToCompanies, claimDeliveries, drainWebhookQueueForTest } from '../cdp-webhook-delivery';
import { runCdpWebhookRetryPass, runCdpWebhookHousekeeping } from '../cdp-webhook-retry-worker';

/** $n → 글자 값(시험 전용 · 따옴표 이스케이프) */
function bindParams(sql: string, params: any[]): string {
  return sql.replace(/\$(\d+)/g, (_m, n) => {
    const v = params[Number(n) - 1];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

const CO = '00000000-0000-0000-0000-0000000000c1';

function freshDb() {
  const db = newDb();
  db.public.registerFunction({ name: 'gen_random_uuid', returns: 'uuid' as any, implementation: () => randomUUID(), impure: true });
  db.public.none(`
    CREATE TABLE cdp_webhook_deliveries (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, source varchar(30) NOT NULL, webhook_event varchar(100) NOT NULL,
      idempotency_key varchar(200) NOT NULL, payload jsonb, status varchar(20) NOT NULL DEFAULT 'received', error_message text,
      retry_count integer NOT NULL DEFAULT 0, processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, source, idempotency_key)
    );
  `);
  return db;
}

let seq = 0;
function seed(row: { status?: string; retry?: number; createdAgo: string; processedAgo?: string | null; payload?: any }): string {
  const id = randomUUID();
  seq += 1;
  const processed = row.processedAgo === undefined || row.processedAgo === null ? 'NULL' : `NOW() - INTERVAL '${row.processedAgo}'`;
  holder.db.public.none(`
    INSERT INTO cdp_webhook_deliveries (id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, processed_at, created_at)
    VALUES ('${id}', '${CO}', 'cafe24', 'order.created', 'k-${seq}', '${JSON.stringify(row.payload ?? { resource: { n: seq } })}',
            '${row.status ?? 'received'}', ${row.retry ?? 0}, ${processed}, NOW() - INTERVAL '${row.createdAgo}')`);
  return id;
}
const rowOf = (id: string) => holder.db.public.many(`SELECT * FROM cdp_webhook_deliveries WHERE id = '${id}'`)[0];

beforeEach(() => {
  holder.db = freshDb();
  processWebhookEvent.mockReset();
  processWebhookEvent.mockImplementation(async () => undefined);
  sendSystemAlert.mockClear();
});

describe('수신 = 기록 → 즉시 반환 → 줄이 자기 행을 잡아 처리', () => {
  it('기록 결과를 돌려준 뒤 처리 · 받은 시각(created_at)이 ctx 로 · 끝 상태 processed', async () => {
    const out = await deliverWebhookToCompanies({ source: 'cafe24', companyIds: [CO], event: 'order.created', idempotencyKey: 'a', payload: { resource: { x: 1 } }, logTag: 'T' });
    expect(out).toEqual({ recorded: 1, duplicate: 0 });
    await drainWebhookQueueForTest();
    const r = holder.db.public.many(`SELECT * FROM cdp_webhook_deliveries`)[0];
    expect(r.status).toBe('processed');
    expect(processWebhookEvent).toHaveBeenCalledWith(CO, 'order.created', { x: 1 }, { observedAt: new Date(r.created_at).toISOString(), storeCode: null, idScope: { provider: 'cafe24', mallId: '', idPrefix: null } });
  });
  it("처리가 'stale' 이면 superseded 로 닫는다", async () => {
    processWebhookEvent.mockImplementation(async () => 'stale');
    await deliverWebhookToCompanies({ source: 'cafe24', companyIds: [CO], event: 'order.created', idempotencyKey: 'b', payload: {}, logTag: 'T' });
    await drainWebhookQueueForTest();
    expect(holder.db.public.many(`SELECT status FROM cdp_webhook_deliveries`)[0].status).toBe('superseded');
  });
  // 같은 키 다시 받음 = 중복 · 실패 행을 덮지 않음 = webhook-duplicate-keeps-failed-0926(pg-mem 은 ON CONFLICT DO NOTHING RETURNING 이 기존 행을 돌려줘 여기서 못 본다)
  it('줄의 첫 시도 실패 = failed · retry_count 0(옛 규칙)', async () => {
    processWebhookEvent.mockImplementation(async () => { throw new Error('boom'); });
    await deliverWebhookToCompanies({ source: 'cafe24', companyIds: [CO], event: 'order.created', idempotencyKey: 'c', payload: {}, logTag: 'T' });
    await drainWebhookQueueForTest();
    const r = holder.db.public.many(`SELECT * FROM cdp_webhook_deliveries`)[0];
    expect([r.status, r.retry_count]).toEqual(['failed', 0]);
  });
});

describe('선점 문장 — 줄과 워커가 같은 행을 동시에 처리하지 않는다', () => {
  it('워커가 먼저 잡은 행 = 줄의 자기 행 선점 0행', async () => {
    const id = seed({ createdAgo: '11 minutes' });
    expect((await claimDeliveries({ limit: 10 })).map((r) => r.id)).toEqual([id]);
    expect(await claimDeliveries({ ownId: id })).toEqual([]);
  });
  it('줄이 잡은 행(10분 안) 50개가 앞에 있어도 그 뒤 멈춘 행을 잡는다(LIMIT 전에 뺌)', async () => {
    for (let i = 0; i < 50; i++) seed({ createdAgo: '20 minutes', processedAgo: '1 minute' });
    const stuck = seed({ createdAgo: '15 minutes' });
    expect((await claimDeliveries({ limit: 50 })).map((r) => r.id)).toEqual([stuck]);
  });
  it('잡고 10분 지나도 끝나지 않은 received(프로세스가 죽음) = 다시 잡는다', async () => {
    const id = seed({ createdAgo: '1 hour', processedAgo: '11 minutes' });
    expect((await claimDeliveries({ limit: 10 })).map((r) => r.id)).toEqual([id]);
  });
});

describe('재처리 워커 — 나이로 버리지 않는다 · 한 회차 한 번 · 소진 · 적체 경보', () => {
  it('8일 묵은 received 행이 처리된다(옛 7일 제한 삭제)', async () => {
    const id = seed({ createdAgo: '8 days' });
    await runCdpWebhookRetryPass();
    expect(rowOf(id).status).toBe('processed');
  });
  it('한 회차 안에서 실패한 행은 다시 잡히지 않는다(retry_count + 1 한 번)', async () => {
    processWebhookEvent.mockImplementation(async () => { throw new Error('boom'); });
    const id = seed({ status: 'failed', retry: 0, createdAgo: '1 hour', processedAgo: '6 minutes' });
    const r = await runCdpWebhookRetryPass();
    expect(r.retried).toBe(1);
    expect([rowOf(id).status, rowOf(id).retry_count]).toEqual(['failed', 1]);
  });
  it('실패 뒤 5분이 안 된 행은 잡지 않는다', async () => {
    seed({ status: 'failed', retry: 0, createdAgo: '1 hour', processedAgo: '2 minutes' });
    expect(await claimDeliveries({ limit: 10 })).toEqual([]);
  });
  it('옛 행(생성 30일 전)의 소진이 소진 경보에 잡힌다(기준 = 마지막 시도 시각)', async () => {
    processWebhookEvent.mockImplementation(async () => { throw new Error('boom'); });
    seed({ status: 'failed', retry: 2, createdAgo: '30 days', processedAgo: '6 minutes' });
    await runCdpWebhookRetryPass();
    expect(sendSystemAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupKey: 'cdp-webhook-exhausted' }));
  });
  it('30분 넘은 received 가 있으면 적체 경보', async () => {
    seed({ createdAgo: '40 minutes', processedAgo: '1 minute' });   // 줄이 잡고 아직 처리 중(워커 대상 아님)
    await runCdpWebhookRetryPass();
    expect(sendSystemAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupKey: 'cdp-webhook-backlog' }));
  });
});

describe('정리 — 원문은 끝난 행만 · 끝난 뒤 30일', () => {
  it('끝난 지 31일 = 비움 · 처리 못 한 40일 묵은 행 = 남김 · 방금 소진된 옛 행 = 남김 · superseded 는 보관 기한 뒤 삭제 대상', async () => {
    const done = seed({ status: 'processed', createdAgo: '40 days', processedAgo: '31 days' });
    const waiting = seed({ status: 'received', createdAgo: '40 days' });
    const justExhausted = seed({ status: 'failed', retry: 3, createdAgo: '40 days', processedAgo: '1 minute' });
    const oldSuperseded = seed({ status: 'superseded', createdAgo: '500 days', processedAgo: '500 days' });
    await runCdpWebhookHousekeeping();
    expect(rowOf(done).payload).toBeNull();
    expect(rowOf(waiting).payload).not.toBeNull();
    expect(rowOf(justExhausted).payload).not.toBeNull();
    expect(rowOf(oldSuperseded)).toBeUndefined();
  });
});
