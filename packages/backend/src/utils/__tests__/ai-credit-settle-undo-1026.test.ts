/**
 * ★ 2026-10-26 Codex 1R(돈 묶음 #1 · #3 · #8) — 성공 뒤 차감 + 되돌리기 한 벌(settleOrUndo).
 *   원장 쓰기 실패 = 만든 것을 되돌리고 503 그대로 · 되돌리기마저 실패 = [CREDIT][ORPHAN] 경보 · 걷기 성공 = 되돌리지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ clientQuery: vi.fn() }));
vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(async () => ({ query: m.clientQuery, release: () => undefined })) },
}));
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => undefined) }));

import { settleOrUndo, CreditSettleError } from '../ai-credit';

const COMPANY = '22222222-2222-4222-8222-222222222222';
const settle = { companyId: COMPANY, cost: 3, source: 'test-source', idempotencyKey: 'k-undo-1' };

describe('settleOrUndo — 못 걷으면 되돌리고 · 되돌리기 실패 = 경보', () => {
  beforeEach(() => { m.clientQuery.mockReset(); });
  it('원장 쓰기 실패 = 되돌림 1회 · CreditSettleError 그대로', async () => {
    m.clientQuery.mockRejectedValue(new Error('db down'));
    const undo = vi.fn(async () => undefined);
    await expect(settleOrUndo({ settle, undo, what: '시험 결과' })).rejects.toBeInstanceOf(CreditSettleError);
    expect(undo).toHaveBeenCalledTimes(1);
  });
  it('되돌리기마저 실패 = [CREDIT][ORPHAN] 줄 · 원래 오류 그대로', async () => {
    m.clientQuery.mockRejectedValue(new Error('db down'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(settleOrUndo({ settle, undo: async () => { throw new Error('되돌리기 실패'); }, what: '시험 결과' })).rejects.toBeInstanceOf(CreditSettleError);
      const line = log.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('[CREDIT][ORPHAN]'));
      expect(line).toContain('k-undo-1');
      expect(line).toContain('시험 결과 되돌리기 실패');
    } finally {
      log.mockRestore();
    }
  });
  it('걷기 성공 = 되돌리지 않는다', async () => {
    // BEGIN · 크레딧 행(크레딧제 적용 · 넉넉) · 멱등 중복 없음 · 그 뒤 쓰기 = 성공
    m.clientQuery.mockImplementation(async (sql: string) => {
      if (/FROM companies c/.test(sql)) return { rows: [{ base: 100, purchased: 0, cap: null, reset_at: new Date(), billing_type: 'prepaid', overage_limit: 0, plan_credits: 100 }] };
      if (/RETURNING/.test(sql)) return { rows: [{ id: 'tx-1' }] };
      return { rows: [] };
    });
    const undo = vi.fn(async () => undefined);
    await expect(settleOrUndo({ settle, undo, what: '시험 결과' })).resolves.toBe('deducted');
    expect(undo).not.toHaveBeenCalled();
  });
});
