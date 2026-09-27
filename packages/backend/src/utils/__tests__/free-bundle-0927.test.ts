/**
 * 요금제 무료 제공 기록 (★ 2026-09-27 한줄로 V2 차수 1 FREE 묶음 — R234 · R235)
 *
 * R234 무료 잔량 식이 billing_items를 company_id로 걸렀는데 인덱스는 (billing_id, channel)뿐이라 선불 발송마다 전체를 훑었다
 *      → 그 회사 청구서(billings · 회사당 몇 장)를 거쳐 항목을 찾는다(기존 인덱스 · DDL 0 · 같은 결과 — 항목의 회사 = 그 청구서의 회사).
 * R235 표시용 시도 카운터(recordFreeAttempt)가 차감 트랜잭션 안에서 SAVEPOINT 없이 돌아, 그 UPDATE가 실패하면
 *      잡아도 트랜잭션이 aborted라 차감 전체가 실패했다("발송을 막지 않는다"와 반대) → 무료 소진 함수와 같은 SAVEPOINT.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
  pool: { query: vi.fn(), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
}));

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('R234 무료 잔량 식 = 그 회사 청구서를 거쳐 항목을 찾는다', () => {
  it('billing_items를 청구서 id로 찾는다(회사 조건도 그대로)', () => {
    const f = src('free-messaging.ts');
    const expr = f.slice(f.indexOf('const REMAINING_EXPR = `'), f.indexOf('), 0))`;', f.indexOf('const REMAINING_EXPR = `')));
    expect(expr).toContain('bi.billing_id IN (SELECT b.id FROM billings b WHERE b.company_id = g.company_id)');
    expect(expr).toContain('bi.company_id = g.company_id');
  });
});

describe('R235 시도 카운터 = 트랜잭션 안이면 SAVEPOINT', () => {
  it('실패해도 트랜잭션을 오류 직전으로 되돌리고 0을 돌려준다(차감은 계속)', async () => {
    const { recordFreeAttempt } = await import('../free-messaging');
    const log: string[] = [];
    const client = { query: vi.fn(async (sql: string) => {
      log.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
      if (/UPDATE free_messaging_grants/.test(sql)) throw Object.assign(new Error('boom'), { code: '23514' });
      return { rows: [] };
    }) };
    expect(await recordFreeAttempt(client, 'c1', 'SMS', 3, { inTransaction: true })).toBe(0);
    expect(log[0]).toBe('SAVEPOINT free_attempt');
    expect(log).toContain('ROLLBACK TO SAVEPOINT free_attempt');
  });
  it('성공이면 RELEASE · 트랜잭션 밖이면 SAVEPOINT 없음', async () => {
    const { recordFreeAttempt } = await import('../free-messaging');
    const log: string[] = [];
    const client = { query: vi.fn(async (sql: string) => { log.push(sql.trim().split(/\s+/)[0]); return { rows: [{ taken: 2 }] }; }) };
    expect(await recordFreeAttempt(client, 'c1', 'SMS', 2, { inTransaction: true })).toBe(2);
    expect(log).toEqual(['SAVEPOINT', 'WITH', 'RELEASE']);
    log.length = 0;
    await recordFreeAttempt(client, 'c1', 'SMS', 2);
    expect(log).toEqual(['WITH']);
  });
  it('차감 CT 두 호출부가 트랜잭션 여부를 넘긴다', () => {
    const p = src('prepaid.ts');
    expect(p).toContain('await recordFreeAttempt({ query: run }, companyId, messageType, count, { inTransaction: !!callerClient });');
    expect(p).toContain('if (freeUsed > 0) await recordFreeAttempt(client, companyId, messageType, freeUsed, { inTransaction: true });');
  });
});
