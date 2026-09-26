/**
 * 스팸 검사 큐 등록 순서 · 결과 조회 · 수동 검사 입구 (★ 2026-09-26 한줄로 V2 SQ 묶음 m001·m002·m003·m038·m040·m041)
 *
 * m001 검사 행을 'queued'로 먼저 커밋 → 3초 워커가 차감·결과 행 생성 전에 집어 보낼 수 있었다(잔액 부족이면 무료 발송).
 * m002 차감 뒤 결과 행 INSERT가 던지면 환불 없이 queued 행이 남아 나중에 일부 행으로 나갔다.
 *   → 검사 행·결과 행을 한 트랜잭션에 넣고, 차감이 성공한 뒤에 커밋한다(워커는 커밋 전 행을 못 본다).
 *     결과 행 실패 = 롤백(돈 안 움직임) · 차감 실패 = 롤백 · 커밋 실패 = 방금 차감을 즉시 환불.
 * m003 결과 조회가 서버 현재 월 로그 하나만 봐 월말 검사의 성공을 놓쳤다 → 전월 로그까지(조회 CT 하나).
 * m038 수동 검사의 "진행 중 1건" 확인이 잠금 없이 조회 뒤 삽입 → 사용자 잠금 안에서 다시 확인하고 넣는다.
 * m040 검사 발신번호가 등록 번호인지 확인하지 않았다 → 등록 번호만(미등록은 통신사가 막아 유료 검사가 헛돈다).
 * m041 앱 수신 보고가 결과 행을 통신사·유형으로만 갱신 → 단말 번호까지.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const calls: string[] = [];
const state = { failResultInsert: false, failCommit: false };
const client = {
  query: vi.fn(async (sql: string, _p?: any[]) => {
    const s = String(sql).trim();
    if (s === 'BEGIN') { calls.push('BEGIN'); return { rows: [] }; }
    if (s === 'COMMIT') { calls.push('COMMIT'); if (state.failCommit) throw new Error('commit fail'); return { rows: [] }; }
    if (s === 'ROLLBACK') { calls.push('ROLLBACK'); return { rows: [] }; }
    if (s.includes('FROM companies WHERE id = $1 FOR UPDATE')) { calls.push('LOCK company'); return { rows: [{ id: 'c1' }] }; }
    if (s.includes('INSERT INTO spam_filter_tests')) { calls.push('INSERT test'); return { rows: [{ id: 'test-1', created_at: new Date() }] }; }
    if (s.includes('INSERT INTO spam_filter_test_results')) {
      calls.push('INSERT result');
      if (state.failResultInsert) throw new Error('result insert fail');
      return { rows: [] };
    }
    return { rows: [] };
  }),
  release: vi.fn(),
};
const plainQuery = vi.fn(async (sql: string, _p?: any[]) => {
  const s = String(sql);
  if (s.includes('FROM spam_filter_devices')) return { rows: [{ id: 'd1', carrier: 'SKT', phone: '01000000001' }, { id: 'd2', carrier: 'KT', phone: '01000000002' }] };
  if (s.includes('opt_out_080_number')) return { rows: [{ user_080: null, company_080: null }] };
  if (s.includes('INSERT INTO spam_filter_tests')) { calls.push('PLAIN INSERT test'); return { rows: [{ id: 'x' }] }; }
  if (s.includes("SET status = 'completed'")) { calls.push('PLAIN completed'); return { rows: [] }; }
  return { rows: [] };
});
const mysqlMock = vi.fn(async (_sql: string, _p?: any[]) => [] as any[]);
vi.mock('../../config/database', () => ({
  default: { connect: vi.fn(async () => client), query: (...a: any[]) => (plainQuery as any)(...a) },
  query: (...a: any[]) => (plainQuery as any)(...a),
  mysqlQuery: (...a: any[]) => (mysqlMock as any)(...a),
}));
vi.mock('../messageUtils', () => ({
  prepareFieldMappings: async () => ({}),
  replaceVariables: (t: string) => t,
  enrichWithCustomFields: (x: any) => x,
  buildAdMessage: (t: string) => t,
  buildAdSubject: (t: string) => t,
}));
vi.mock('../store-scope', () => ({ getSampleCustomerScope: async () => ({ where: '', params: [] }) }));
vi.mock('../sms-queue', () => ({
  getTestSmsTables: async () => ['SMSQ_TEST'],
  toQtmsgType: (t: string) => t,
  insertTestSmsQueue: async () => undefined,
}));
const deductMock = vi.fn(async (..._a: any[]) => ({ ok: true, amount: 22 } as any));
const refundMock = vi.fn(async (..._a: any[]) => ({ refunded: 22, ok: true }));
vi.mock('../prepaid', () => ({
  prepaidDeduct: (...a: any[]) => (deductMock as any)(...a),
  prepaidRefund: (...a: any[]) => (refundMock as any)(...a),
  REFUND_KEYS: { NOT_LOADED: 'notloaded', FAIL: 'fail', CANCEL: 'cancel', TEST: 'test', KAKAO_DIFF: 'kakao_diff' },
}));
vi.mock('../system-alert', () => ({ sendSystemAlert: async () => undefined }));

import { enqueueSpamTest, fetchSpamQtmsgRows } from '../spam-test-queue';

const base = { companyId: 'c1', userId: 'u1', callbackNumber: '0212345678', messageContentSms: '안녕하세요', messageType: 'SMS', source: 'auto_ai', firstRecipient: { name: '가' } } as any;

beforeEach(() => {
  calls.length = 0;
  state.failResultInsert = false;
  state.failCommit = false;
  deductMock.mockReset(); deductMock.mockImplementation(async () => ({ ok: true, amount: 22 }));
  refundMock.mockClear(); client.query.mockClear(); client.release.mockClear(); mysqlMock.mockClear();
});

describe('큐 등록 순서 (m001·m002)', () => {
  it('회사 잠금 → 검사 행·결과 행 → 차감(같은 트랜잭션) → 커밋', async () => {
    const r = await enqueueSpamTest(base);
    expect(r.ok).toBe(true);
    // 회사 행을 먼저 잠근다 — 검사 행 INSERT(회사 FK = KEY SHARE) 뒤 차감의 FOR UPDATE로 올리면 같은 회사 동시 등록 둘이 서로를 기다린다
    expect(calls).toEqual(['BEGIN', 'LOCK company', 'INSERT test', 'INSERT result', 'INSERT result', 'COMMIT']);
    expect(deductMock).toHaveBeenCalledTimes(1);
    expect(deductMock.mock.invocationCallOrder[0]).toBeLessThan(client.query.mock.invocationCallOrder[client.query.mock.calls.findIndex((c) => String(c[0]).trim() === 'COMMIT')]);
    expect(client.release).toHaveBeenCalled();
  });

  it('차감은 등록 트랜잭션의 연결로 한다(차감만 따로 커밋되지 않는다 · Codex 2R ①)', async () => {
    await enqueueSpamTest(base);
    const args = deductMock.mock.calls[0];
    expect(args[3]).toBe('test-1');
    expect(args[5]).toBe('spam');
    expect(args[7]).toEqual({ client });
  });

  it('차감 실패 = 롤백(검사 행이 남지 않는다 · 워커가 볼 행이 없다)', async () => {
    deductMock.mockImplementation(async () => ({ ok: false, error: '잔액 부족', balance: 0, amount: 22 }));
    const r = await enqueueSpamTest(base);
    expect(r.ok).toBe(false);
    expect(r.insufficientBalance).toBe(true);
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(calls).not.toContain('PLAIN completed');
  });

  it('결과 행 실패 = 롤백 · 차감하지 않는다', async () => {
    state.failResultInsert = true;
    const r = await enqueueSpamTest(base);
    expect(r.ok).toBe(false);
    expect(deductMock).not.toHaveBeenCalled();
    expect(calls).toContain('ROLLBACK');
  });

  it('커밋 실패 = 환불하지 않는다(차감도 같은 커밋이라 함께 사라졌거나, 응답만 유실돼 검사가 나간다)', async () => {
    state.failCommit = true;
    const r = await enqueueSpamTest(base);
    expect(r.ok).toBe(false);
    expect(refundMock).not.toHaveBeenCalled();
  });

  it('차감 없는 검사(skipPrepaid)는 회사 잠금 없이 같은 트랜잭션', async () => {
    const r = await enqueueSpamTest({ ...base, skipPrepaid: true });
    expect(r.ok).toBe(true);
    expect(deductMock).not.toHaveBeenCalled();
    expect(calls).toEqual(['BEGIN', 'INSERT test', 'INSERT result', 'INSERT result', 'COMMIT']);
  });

  it('검사 행을 트랜잭션 밖에서 넣지 않는다', async () => {
    await enqueueSpamTest(base);
    expect(calls).not.toContain('PLAIN INSERT test');
  });
});

describe('결과 조회 (m003)', () => {
  it('라이브 + 이번 달 + 지난달 로그를 본다', async () => {
    await fetchSpamQtmsgRows('t1', new Date(2026, 9, 1, 0, 0, 30)); // 10월 1일 0시
    const sqls = mysqlMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /FROM SMSQ_TEST WHERE/.test(s))).toBe(true);
    expect(sqls.some((s) => s.includes('FROM SMSQ_TEST_202610 '))).toBe(true);
    expect(sqls.some((s) => s.includes('FROM SMSQ_TEST_202609 '))).toBe(true);
  });
  it('1월이면 지난해 12월', async () => {
    await fetchSpamQtmsgRows('t1', new Date(2027, 0, 1, 0, 0, 30));
    const sqls = mysqlMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('FROM SMSQ_TEST_202612 '))).toBe(true);
  });
});

describe('배선 (m003·m038·m040·m041)', () => {
  const route = readFileSync(resolve(__dirname, '../../routes/spam-filter.ts'), 'utf8');
  const queue = readFileSync(resolve(__dirname, '../spam-test-queue.ts'), 'utf8');
  it('결과 조회는 두 곳 모두 CT를 쓴다(월 계산 복붙 0)', () => {
    expect(route).toContain('fetchSpamQtmsgRows(');
    expect(queue.split('fetchSpamQtmsgRows(').length - 1).toBeGreaterThanOrEqual(2); // 정의 + 워커
    expect(route).not.toMatch(/const logTable = `\$\{testTable\}_\$\{yyyymm\}`/);
    expect(queue).not.toMatch(/const logTable = `\$\{testTable\}_\$\{yyyymm\}`/);
  });
  it('수동 검사는 사용자 잠금 안에서 진행 중 검사를 다시 확인하고 넣는다', () => {
    const at = route.indexOf("router.post('/test'");
    const body = route.slice(at, route.indexOf('router.', at + 10));
    expect(route).toMatch(/const SPAM_TEST_USER_LOCK_SQL = `SELECT pg_advisory_xact_lock\(/);
    expect(body.split('SPAM_TEST_USER_LOCK_SQL').length - 1).toBe(2); // 체험 경로 + 유료 경로
    const lockAt = body.lastIndexOf('SPAM_TEST_USER_LOCK_SQL');
    const recheckAt = body.indexOf("status IN ('pending', 'active')", lockAt);
    expect(recheckAt).toBeGreaterThan(lockAt);
  });
  it('수동 검사는 등록 발신번호만 받는다', () => {
    const at = route.indexOf("router.post('/test'");
    const body = route.slice(at, route.indexOf('router.', at + 10));
    expect(body).toContain('getRegisteredCallbackSet(');
    expect(body.indexOf('getRegisteredCallbackSet(')).toBeLessThan(body.indexOf('prepaidDeduct('));
  });
  it('앱 수신 보고는 단말 번호까지 맞춰 갱신한다', () => {
    const at = route.indexOf("router.post('/report'");
    const body = route.slice(at, route.indexOf('router.', at + 10));
    expect(body).toMatch(/UPDATE spam_filter_test_results[\s\S]*WHERE test_id = \$1 AND carrier = \$2 AND message_type = \$3 AND phone = \$5 AND received = false/);
  });
});
