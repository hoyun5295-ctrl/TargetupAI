// replaces: src/utils/__tests__/cdp-webhook-claim-1027.test.ts
/**
 * 웹훅 수신 즉시 200 · 선점 문장 하나 — 실 PostgreSQL 15.15 판(★ 2026-10-27 실 PG 시험층 첫 판 · 설계서 docs/2026-10-27-real-pg-test-deploy-ledger-design.md §2-7)
 *
 * 운영 문장을 글자 그대로 돌린다(SQL 고쳐 쓰기 0 · 표 = 운영 schema-only 덤프 사본 t_f_*).
 * pg-mem 판이 못 보던 것 = (a) SKIP LOCKED · (b) 줄과 워커의 경주(다시 읽은 행의 조건) · (c) ON CONFLICT DO NOTHING RETURNING 0행.
 * 짝 pg-mem 판(replaces)은 이 판이 처음 전부 통과하고 변이 M1~M4 가 잡힌 뒤 지운다.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

const sendSystemAlert = vi.fn(async () => undefined);
vi.mock('../system-alert', () => ({ sendSystemAlert: (...a: any[]) => (sendSystemAlert as any)(...a) }));
const processWebhookEvent = vi.fn(async (..._a: any[]): Promise<any> => undefined);
vi.mock('../provider-registry', () => ({ getProvider: () => ({ processWebhookEvent }) }));

import { deliverWebhookToCompanies, claimDeliveries, drainWebhookQueueForTest } from '../cdp-webhook-delivery';
import { runCdpWebhookRetryPass, runCdpWebhookHousekeeping } from '../cdp-webhook-retry-worker';

const CO = '00000000-0000-0000-0000-0000000000c1';
let seq = 0;

async function seed(row: { status?: string; retry?: number; createdAgo: string; processedAgo?: string | null; payload?: any; key?: string }): Promise<string> {
  const id = randomUUID();
  seq += 1;
  await query(
    `INSERT INTO cdp_webhook_deliveries (id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, processed_at, created_at)
     VALUES ($1::uuid, $2::uuid, 'cafe24', 'order.created', $3, $4::jsonb, $5, $6,
             NOW() - $7::interval, NOW() - $8::interval)`,   // $7 NULL = processed_at NULL
    [id, CO, row.key ?? `k-${seq}`, JSON.stringify(row.payload ?? { resource: { n: seq } }), row.status ?? 'received', row.retry ?? 0, row.processedAgo ?? null, row.createdAgo],
  );
  return id;
}
const rowOf = async (id: string): Promise<any> => (await query(`SELECT * FROM cdp_webhook_deliveries WHERE id = $1::uuid`, [id])).rows[0];
/** ms 안에 끝나면 그 값 · 아니면 'timeout'(잠금에 막혔다) */
const within = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
});

beforeEach(async () => {
  await query(`DELETE FROM cdp_webhook_deliveries`);
  processWebhookEvent.mockReset();
  processWebhookEvent.mockImplementation(async () => undefined);
  sendSystemAlert.mockClear();
});

describe('수신 = 기록 → 즉시 반환 → 줄이 자기 행을 잡아 처리', () => {
  it('기록 결과를 돌려준 뒤 처리 · 받은 시각(created_at)이 ctx 로 · 끝 상태 processed', async () => {
    const out = await deliverWebhookToCompanies({ source: 'cafe24', companyIds: [CO], event: 'order.created', idempotencyKey: 'a', payload: { resource: { x: 1 } }, logTag: 'T' });
    expect(out).toEqual({ recorded: 1, duplicate: 0 });
    await drainWebhookQueueForTest();
    const r = (await query(`SELECT * FROM cdp_webhook_deliveries`)).rows[0];
    expect(r.status).toBe('processed');
    expect(processWebhookEvent).toHaveBeenCalledWith(CO, 'order.created', { x: 1 }, { observedAt: new Date(r.created_at).toISOString(), storeCode: null });
  });
  it("처리가 'stale' 이면 superseded 로 닫는다", async () => {
    processWebhookEvent.mockImplementation(async () => 'stale');
    await deliverWebhookToCompanies({ source: 'cafe24', companyIds: [CO], event: 'order.created', idempotencyKey: 'b', payload: {}, logTag: 'T' });
    await drainWebhookQueueForTest();
    expect((await query(`SELECT status FROM cdp_webhook_deliveries`)).rows[0].status).toBe('superseded');
  });
  it('줄의 첫 시도 실패 = failed · retry_count 0(옛 규칙)', async () => {
    processWebhookEvent.mockImplementation(async () => { throw new Error('boom'); });
    await deliverWebhookToCompanies({ source: 'cafe24', companyIds: [CO], event: 'order.created', idempotencyKey: 'c', payload: {}, logTag: 'T' });
    await drainWebhookQueueForTest();
    const r = (await query(`SELECT * FROM cdp_webhook_deliveries`)).rows[0];
    expect([r.status, r.retry_count]).toEqual(['failed', 0]);
  });
  it('(c) 같은 키 다시 받음 = ON CONFLICT DO NOTHING RETURNING 0행 → 처리 완료 행만 duplicate · failed 행은 그대로', async () => {
    const done = await seed({ status: 'processed', createdAgo: '1 hour', processedAgo: '1 hour', key: 'dup-done' });
    const failed = await seed({ status: 'failed', retry: 1, createdAgo: '1 hour', processedAgo: '1 hour', key: 'dup-failed' });
    const o1 = await deliverWebhookToCompanies({ source: 'cafe24', companyIds: [CO], event: 'order.created', idempotencyKey: 'dup-done', payload: {}, logTag: 'T' });
    const o2 = await deliverWebhookToCompanies({ source: 'cafe24', companyIds: [CO], event: 'order.created', idempotencyKey: 'dup-failed', payload: {}, logTag: 'T' });
    await drainWebhookQueueForTest();
    expect([o1, o2]).toEqual([{ recorded: 0, duplicate: 1 }, { recorded: 0, duplicate: 1 }]);
    expect((await rowOf(done)).status).toBe('duplicate');
    expect((await rowOf(failed)).status).toBe('failed');
    expect(Number((await query(`SELECT count(*) AS n FROM cdp_webhook_deliveries`)).rows[0].n)).toBe(2);
    expect(processWebhookEvent).not.toHaveBeenCalled();
  });
});

describe('선점 문장 — 줄과 워커가 같은 행을 동시에 처리하지 않는다', () => {
  it('워커가 먼저 잡은 행 = 줄의 자기 행 선점 0행', async () => {
    const id = await seed({ createdAgo: '11 minutes' });
    expect((await claimDeliveries({ limit: 10 })).map((r) => r.id)).toEqual([id]);
    expect(await claimDeliveries({ ownId: id })).toEqual([]);
  });
  it('줄이 잡은 행(10분 안) 50개가 앞에 있어도 그 뒤 멈춘 행을 잡는다(LIMIT 전에 뺌)', async () => {
    for (let i = 0; i < 50; i++) await seed({ createdAgo: '20 minutes', processedAgo: '1 minute' });
    const stuck = await seed({ createdAgo: '15 minutes' });
    expect((await claimDeliveries({ limit: 50 })).map((r) => r.id)).toEqual([stuck]);
  });
  it('잡고 10분 지나도 끝나지 않은 received(프로세스가 죽음) = 다시 잡는다', async () => {
    const id = await seed({ createdAgo: '1 hour', processedAgo: '11 minutes' });
    expect((await claimDeliveries({ limit: 10 })).map((r) => r.id)).toEqual([id]);
  });
  it('(a) SKIP LOCKED: 다른 연결이 잠근 행은 기다리지 않고 건너뛴다', async () => {
    const locked = await seed({ createdAgo: '30 minutes' });
    const free = await seed({ createdAgo: '20 minutes' });
    const a = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query(`SELECT id FROM cdp_webhook_deliveries WHERE id = $1::uuid FOR UPDATE`, [locked]);
      const got = await within(claimDeliveries({ limit: 10 }), 2000);
      expect(got).not.toBe('timeout');
      expect((got as any[]).map((r) => r.id)).toEqual([free]);
      await a.query('COMMIT');
    } finally {
      a.release();
    }
    expect((await claimDeliveries({ limit: 10 })).map((r) => r.id)).toEqual([locked]);
  });
  it('(b) 줄 · 워커 경주: 워커 선점이 커밋 전이면 줄은 기다렸다가 다시 읽은 행에서 0행', async () => {
    const id = await seed({ createdAgo: '1 second' });
    const a = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query(`UPDATE cdp_webhook_deliveries SET processed_at = NOW() WHERE id = $1::uuid`, [id]);   // 워커의 선점(커밋 전)
      const own = claimDeliveries({ ownId: id });
      expect(await within(own, 500)).toBe('timeout');   // 행 잠금을 기다린다
      await a.query('COMMIT');
      expect(await own).toEqual([]);
    } finally {
      a.release();
    }
  });
});

describe('재처리 워커 — 나이로 버리지 않는다 · 한 회차 한 번 · 소진 · 적체 경보', () => {
  it('8일 묵은 received 행이 처리된다(옛 7일 제한 삭제)', async () => {
    const id = await seed({ createdAgo: '8 days' });
    await runCdpWebhookRetryPass();
    expect((await rowOf(id)).status).toBe('processed');
  });
  it('한 회차 안에서 실패한 행은 다시 잡히지 않는다(retry_count + 1 한 번)', async () => {
    processWebhookEvent.mockImplementation(async () => { throw new Error('boom'); });
    const id = await seed({ status: 'failed', retry: 0, createdAgo: '1 hour', processedAgo: '6 minutes' });
    const r = await runCdpWebhookRetryPass();
    expect(r.retried).toBe(1);
    const row = await rowOf(id);
    expect([row.status, row.retry_count]).toEqual(['failed', 1]);
  });
  it('실패 뒤 5분이 안 된 행은 잡지 않는다', async () => {
    await seed({ status: 'failed', retry: 0, createdAgo: '1 hour', processedAgo: '2 minutes' });
    expect(await claimDeliveries({ limit: 10 })).toEqual([]);
  });
  it('옛 행(생성 30일 전)의 소진이 소진 경보에 잡힌다(기준 = 마지막 시도 시각)', async () => {
    processWebhookEvent.mockImplementation(async () => { throw new Error('boom'); });
    await seed({ status: 'failed', retry: 2, createdAgo: '30 days', processedAgo: '6 minutes' });
    await runCdpWebhookRetryPass();
    expect(sendSystemAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupKey: 'cdp-webhook-exhausted' }));
  });
  it('30분 넘은 received 가 있으면 적체 경보', async () => {
    await seed({ createdAgo: '40 minutes', processedAgo: '1 minute' });   // 줄이 잡고 아직 처리 중(워커 대상 아님)
    await runCdpWebhookRetryPass();
    expect(sendSystemAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupKey: 'cdp-webhook-backlog' }));
  });
});

describe('정리 — 원문은 끝난 행만 · 끝난 뒤 30일', () => {
  it('끝난 지 31일 = 비움 · 처리 못 한 40일 묵은 행 = 남김 · 방금 소진된 옛 행 = 남김 · superseded 는 보관 기한 뒤 삭제 대상', async () => {
    const done = await seed({ status: 'processed', createdAgo: '40 days', processedAgo: '31 days' });
    const waiting = await seed({ status: 'received', createdAgo: '40 days' });
    const justExhausted = await seed({ status: 'failed', retry: 3, createdAgo: '40 days', processedAgo: '1 minute' });
    const oldSuperseded = await seed({ status: 'superseded', createdAgo: '500 days', processedAgo: '500 days' });
    await runCdpWebhookHousekeeping();
    expect((await rowOf(done)).payload).toBeNull();
    expect((await rowOf(waiting)).payload).not.toBeNull();
    expect((await rowOf(justExhausted)).payload).not.toBeNull();
    expect(await rowOf(oldSuperseded)).toBeUndefined();
  });
});
