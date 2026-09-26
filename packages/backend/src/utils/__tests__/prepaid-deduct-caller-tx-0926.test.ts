/**
 * 선불 차감 — 호출자 트랜잭션 참여 (★ 2026-09-26 한줄로 V2 SQ · Codex 2R ①)
 *
 * 스팸 검사 큐 등록이 [검사·결과 행 트랜잭션] 과 [차감 트랜잭션] 두 개라, 차감 커밋과 등록 커밋 사이에 멈추면 차감만 남았고
 * 등록 커밋 응답이 유실되면 이미 등록된 검사를 환불할 수 있었다. 차감이 호출자 트랜잭션에 들어가면 셋이 한 번에 커밋된다.
 *
 * 이 파일이 잠그는 것:
 *   ① client를 넘기면 그 연결로만 일한다(새 연결·BEGIN·COMMIT 없음) · 세이브포인트로 감싸고 성공이면 풀어 준다
 *   ② 실패(잔액 부족·단가 미설정·예외)는 세이브포인트까지만 되돌린다 — 호출자 트랜잭션은 호출자가 끝낸다
 *   ③ client를 안 넘기면 종전 그대로(자기 연결 · BEGIN/COMMIT/ROLLBACK)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { billingType: 'prepaid', balance: 10000, failUpdate: false, throwOnInsert: false };
function exec(log: string[], sql: string, _params: any[] = []) {
  const s = String(sql).trim();
  log.push(s.split(/\s+/).slice(0, 4).join(' '));
  if (s.includes('SELECT billing_type FROM companies')) return { rows: [{ billing_type: state.billingType }] };
  if (s.includes('FROM companies WHERE id = $1 FOR UPDATE')) {
    return { rows: [{ billing_type: state.billingType, balance: state.balance, unit_price_basis: 'vat_included', cost_per_sms: 11, cost_per_lms: 27.5, cost_per_mms: 60 }] };
  }
  if (s.startsWith('UPDATE companies SET balance = balance -')) {
    return state.failUpdate ? { rows: [] } : { rows: [{ balance: state.balance - 22 }] };
  }
  if (s.startsWith('INSERT INTO balance_transactions') && state.throwOnInsert) throw new Error('insert fail');
  return { rows: [] };
}
const poolLog: string[] = [];
const poolClient = { query: vi.fn(async (sql: string, p?: any[]) => exec(poolLog, sql, p)), release: vi.fn() };
const connectMock = vi.fn(async () => poolClient);
vi.mock('../../config/database', () => ({
  default: { connect: (...a: any[]) => (connectMock as any)(...a), query: vi.fn() },
  query: vi.fn(async (sql: string, p?: any[]) => exec(poolLog, sql, p)),
}));
vi.mock('../free-messaging', () => ({
  isFreeMessagingEligible: () => false,
  consumeFreeQuota: async () => 0,
  recordFreeAttempt: async () => undefined,
}));
vi.mock('../system-alert', () => ({ sendSystemAlert: async () => undefined }));

import { prepaidDeduct } from '../prepaid';

const callerLog: string[] = [];
const caller = { query: vi.fn(async (sql: string, p?: any[]) => exec(callerLog, sql, p)), release: vi.fn() } as any;

beforeEach(() => {
  state.billingType = 'prepaid'; state.failUpdate = false; state.throwOnInsert = false;
  poolLog.length = 0; callerLog.length = 0;
  connectMock.mockClear(); poolClient.release.mockClear(); caller.query.mockClear(); caller.release.mockClear();
});

describe('호출자 트랜잭션에 들어간 차감', () => {
  it('① 새 연결 없이 세이브포인트로 감싸 차감하고 풀어 준다', async () => {
    const r = await prepaidDeduct('c1', 2, 'SMS', 'test-1', 'u1', 'spam', null, { client: caller });
    expect(r.ok).toBe(true);
    expect(connectMock).not.toHaveBeenCalled();
    expect(callerLog[0]).toBe('SELECT billing_type FROM companies'); // 후불 확인도 호출자 연결로
    expect(callerLog[1]).toBe('SAVEPOINT prepaid_deduct');
    expect(callerLog).toContain('RELEASE SAVEPOINT prepaid_deduct');
    expect(callerLog).not.toContain('BEGIN');
    expect(callerLog).not.toContain('COMMIT');
    expect(callerLog.some((l) => l.startsWith('INSERT INTO balance_transactions'))).toBe(true);
    expect(caller.release).not.toHaveBeenCalled();
  });

  it('② 잔액 부족은 세이브포인트까지만 되돌린다', async () => {
    state.failUpdate = true;
    const r = await prepaidDeduct('c1', 2, 'SMS', 'test-1', 'u1', 'spam', null, { client: caller });
    expect(r.ok).toBe(false);
    expect(r.insufficientBalance).toBe(true);
    expect(callerLog).toContain('ROLLBACK TO SAVEPOINT prepaid_deduct');
    expect(callerLog).not.toContain('ROLLBACK');
  });

  it('② 예외도 세이브포인트까지만 되돌리고 실패로 돌려준다', async () => {
    state.throwOnInsert = true;
    const r = await prepaidDeduct('c1', 2, 'SMS', 'test-1', 'u1', 'spam', null, { client: caller });
    expect(r.ok).toBe(false);
    expect(callerLog).toContain('ROLLBACK TO SAVEPOINT prepaid_deduct');
    expect(callerLog).not.toContain('ROLLBACK');
  });

  it('후불은 호출자 연결로 확인만 하고 끝낸다', async () => {
    state.billingType = 'postpaid';
    const r = await prepaidDeduct('c1', 2, 'SMS', 'test-1', 'u1', 'spam', null, { client: caller });
    expect(r).toEqual({ ok: true, amount: 0 });
    expect(connectMock).not.toHaveBeenCalled();
    expect(callerLog.some((l) => l.startsWith('SELECT billing_type FROM'))).toBe(true);
  });
});

describe('③ 종전 호출(client 없음)', () => {
  it('자기 연결로 BEGIN → COMMIT', async () => {
    const r = await prepaidDeduct('c1', 2, 'SMS', 'camp-1', 'u1', 'campaign');
    expect(r.ok).toBe(true);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(poolLog).toContain('BEGIN');
    expect(poolLog).toContain('COMMIT');
    expect(poolLog.some((l) => l.includes('SAVEPOINT prepaid_deduct'))).toBe(false);
    expect(poolClient.release).toHaveBeenCalled();
  });
  it('잔액 부족은 ROLLBACK', async () => {
    state.failUpdate = true;
    const r = await prepaidDeduct('c1', 2, 'SMS', 'camp-1', 'u1', 'campaign');
    expect(r.ok).toBe(false);
    expect(poolLog).toContain('ROLLBACK');
  });
});
