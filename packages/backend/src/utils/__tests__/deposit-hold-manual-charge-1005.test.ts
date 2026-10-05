/**
 * 명의 확인 보류 건을 수동 충전으로 채우지 않는다 (★ 2026-10-05 전송자격인증 2.3)
 *   실례(9/18): 보류된 무통장입금 7분 뒤 같은 금액을 관리자 수동 충전으로 넣어 소명 없이 충전됐다.
 *   계약: 명의 확인 대기 입금 신청이 있는 고객사의 수동 충전 = 409 · 잔액 그대로. 차감 · 입금 승인 · PG 결제는 그대로.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ default: { connect: vi.fn() }, query: vi.fn() }));

import { findPendingHeldDeposit, HELD_DEPOSIT_PENDING_MESSAGE } from '../deposit-approve';

describe('findPendingHeldDeposit — 명의 확인 대기 입금 신청', () => {
  it('대기 중 보류 건이 있으면 그 건 · 없으면 null', async () => {
    const calls: Array<{ sql: string; params: any[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        calls.push({ sql, params });
        return { rows: [{ id: 'd1', amount: '20000.00', depositor_name: '입금자', created_at: '2026-09-18T06:35:00Z' }] };
      }),
    };
    expect(await findPendingHeldDeposit(db, 'co-1')).toEqual({ id: 'd1', amount: 20000, depositorName: '입금자', createdAt: '2026-09-18T06:35:00.000Z' });
    expect(calls[0].params).toEqual(['co-1']);
    expect(calls[0].sql).toContain("status = 'pending' AND held_reason IS NOT NULL");
    expect(await findPendingHeldDeposit({ query: async () => ({ rows: [] }) }, 'co-1')).toBeNull();
  });
  it('안내 문구 = 소명 확인 승인 또는 반려로 닫으라는 말 · 내부 식별자 없음', () => {
    expect(HELD_DEPOSIT_PENDING_MESSAGE).toContain('승인 대기에서 소명을 확인해 승인하거나 반려');
    expect(HELD_DEPOSIT_PENDING_MESSAGE).not.toMatch(/held_reason|deposit_requests|pending/);
  });
});

describe('수동 잔액 조정 라우트 — 충전 갈래만 잔액을 늘리기 전에 막는다', () => {
  const admin = readFileSync(join(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf8');
  const route = admin.slice(admin.indexOf("router.post('/companies/:id/balance-adjust',"), admin.indexOf("router.get('/companies/:id/balance-transactions',"));
  const chargeAt = route.indexOf('// 충전\n');
  const charge = route.slice(chargeAt);
  const deduct = route.slice(0, chargeAt);

  it('충전 = 판정 → 있으면 되돌리고 409 → 그다음에야 잔액 증가', () => {
    const guard = charge.indexOf('if (await findPendingHeldDeposit(client, id)) {');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(charge.indexOf("'UPDATE companies SET balance = balance + $1"));
    const block = charge.slice(guard, guard + 300);
    const rollback = block.indexOf("await client.query('ROLLBACK');");
    expect(rollback).toBeGreaterThan(0);
    expect(rollback).toBeLessThan(block.indexOf('return res.status(409)'));
    expect(block).toContain("code: 'DEPOSIT_HOLD_PENDING'");
  });
  it('보류 칸이 없는 환경 = 500 이 아니라 503 마이그레이션 대기(되돌린 뒤 · Codex 1R)', () => {
    const c = route.slice(route.lastIndexOf('} catch (error) {'));
    const rollback = c.indexOf("await client.query('ROLLBACK')");
    const pending = c.indexOf('if (isMissingSchemaError(error)) return res.status(503).json(migrationPendingBody(');
    expect(rollback).toBeGreaterThan(0);
    expect(pending).toBeGreaterThan(rollback);
    expect(pending).toBeLessThan(c.indexOf('res.status(500)'));
  });
  it('차감 갈래는 그대로(판정 없음)', () => {
    expect(deduct).not.toContain('findPendingHeldDeposit');
  });
});
