/**
 * 확인 판 적재 관문의 동작(★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §6-2-1 · §11 「발송 관문」 · 「확인 문자 소유」)
 *
 * 가짜 연결로 「잠금 아래 다시 읽은 값」을 정해 놓고, 적재(insertTestSmsQueue) · 닫기 쓰기 · 커밋이 판정대로 일어나는지 본다.
 *   검사 문자 = sendDiagTestRow · 확인 문자 = sendDiagProbe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn(async () => { sqls.push('INSERT'); });
const callbackSetMock = vi.fn(async () => new Set(['0212345678']));
let lockedRow: any = null;
const sqls: string[] = [];
const fakeClient = {
  query: vi.fn(async (sql: string) => {
    sqls.push(sql);
    if (/FOR UPDATE OF/.test(sql)) return { rows: lockedRow ? [lockedRow] : [], rowCount: lockedRow ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  }),
  release: vi.fn(),
};

vi.mock('../../config/database', () => ({
  default: { connect: vi.fn(async () => fakeClient), query: vi.fn(async () => ({ rows: [] })) },
  query: vi.fn(async (sql: string) => { sqls.push(`POOL:${sql}`); return { rows: [] }; }),
  mysqlQuery: vi.fn(async () => []),
}));
vi.mock('../sms-queue', async (orig) => ({ ...(await orig<any>()), insertTestSmsQueue: (...a: any[]) => (insertMock as any)(...a) }));
vi.mock('../callback-filter', async (orig) => ({ ...(await orig<any>()), getRegisteredCallbackSet: (...a: any[]) => (callbackSetMock as any)(...a) }));

import { sendDiagTestRow } from '../spam-test-queue';
import { sendDiagProbe, DIAG_PROBE_LOAD_WAIT_MS } from '../spam-probe';

const NOW = Date.now();
const testArgs = {
  testId: 't-diag', parentTestId: 't-parent', companyId: 'c1', userId: 'u1', callback: '02-1234-5678',
  rowId: 'r1', phone: '01000000000', messageType: 'LMS', content: '글', title: '',
};
const probeArgs = { id: 'p1', phone: '01000000000', nonce: 'ABC123', callback: '02-1234-5678' };
const probeKind = { parentTestId: 't-parent', testId: 't-diag', companyId: 'c1', userId: 'u1', createdAt: new Date(NOW - 5 * 60_000) };
const wrote = (re: RegExp) => sqls.some((s) => re.test(s));

beforeEach(() => {
  sqls.length = 0;
  insertMock.mockClear();
  callbackSetMock.mockReset();
  callbackSetMock.mockImplementation(async () => new Set(['0212345678']));
  process.env.SPAM_DIAG_SENDS = 'on';
});

describe('검사 문자(sendDiagTestRow)', () => {
  it('통과 = 부모 잠금 아래 판정 · 커밋 뒤 잠금 밖 적재 · 닫기 쓰기 0', async () => {
    lockedRow = { status: 'active', created_at: new Date(NOW - 60_000), result: null };
    expect(await sendDiagTestRow(testArgs)).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(sqls.some((s) => /pg_advisory_xact_lock/.test(s))).toBe(true);
    expect(wrote(/UPDATE spam_filter_test_results/)).toBe(false);
    expect(sqls.indexOf('COMMIT')).toBeLessThan(sqls.indexOf('INSERT'));   // 잠금이 MySQL 을 기다리지 않는다
    expect(sqls[sqls.length - 1]).toBe('INSERT');
  });

  it('내 것 아님(정리가 먼저 닫음 = 판 completed) = 적재 0 · 쓰기 0', async () => {
    lockedRow = { status: 'completed', created_at: new Date(NOW - 60_000), result: 'timeout' };
    expect(await sendDiagTestRow(testArgs)).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
    expect(wrote(/^\s*UPDATE /)).toBe(false);
  });

  it('진단 닫기가 먼저 결과를 닫음(판은 아직 active) = 적재 0 · 결과 쓰기 0 · 판만 completed(미결 결과 없을 때)', async () => {
    lockedRow = { status: 'active', created_at: new Date(NOW - 60_000), result: 'error' };
    expect(await sendDiagTestRow(testArgs)).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
    expect(wrote(/UPDATE spam_filter_test_results/)).toBe(false);
    expect(wrote(/UPDATE spam_filter_tests SET status = 'completed'[\s\S]*NOT EXISTS/)).toBe(true);
  });

  it('스위치 꺼짐 = 적재 0 · 아직 NULL 인 결과만 error · 판 completed', async () => {
    process.env.SPAM_DIAG_SENDS = 'off';
    lockedRow = { status: 'active', created_at: new Date(NOW - 60_000), result: null };
    expect(await sendDiagTestRow(testArgs)).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
    expect(wrote(/UPDATE spam_filter_test_results[\s\S]*result IS NULL/)).toBe(true);
    expect(wrote(/UPDATE spam_filter_tests SET status = 'completed'/)).toBe(true);
  });

  it('대기 중 발신번호 권한 회수 · 배정 칸 확인 실패(strict 던짐) = 적재 0', async () => {
    lockedRow = { status: 'active', created_at: new Date(NOW - 60_000), result: null };
    callbackSetMock.mockImplementation(async () => new Set(['0299999999']));
    expect(await sendDiagTestRow(testArgs)).toBe(false);
    callbackSetMock.mockImplementation(async () => { throw new Error('scope lost'); });
    expect(await sendDiagTestRow(testArgs)).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('15분 지난 판 = 적재 0', async () => {
    lockedRow = { status: 'active', created_at: new Date(NOW - 16 * 60_000), result: null };
    expect(await sendDiagTestRow(testArgs)).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('적재(잠금 밖)가 던지면 위로 올린다 · 판정은 커밋됐고 상태 쓰기 0(판 active · 결과 NULL → 멈춘 검사 정리가 timeout)', async () => {
    lockedRow = { status: 'active', created_at: new Date(NOW - 60_000), result: null };
    insertMock.mockImplementationOnce(async () => { throw new Error('mysql down'); });
    await expect(sendDiagTestRow(testArgs)).rejects.toThrow('mysql down');
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
    expect(wrote(/^\s*UPDATE /)).toBe(false);
  });
});

describe('확인 문자(sendDiagProbe)', () => {
  it('통과 = sent 표시 · 커밋 뒤 잠금 밖 적재(뒤에 온 호출은 claimed 가 아니라 한 통)', async () => {
    lockedRow = { probe_status: 'claimed', result_id: 'r1', result: 'unconfirmed' };
    await sendDiagProbe(probeArgs, probeKind);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const sent = sqls.findIndex((s) => /SET status = 'sent'/.test(s));
    expect(sent).toBeGreaterThan(-1);
    // ★ Codex 구현 6R 구조 — 기한은 이 표시 한 번에(잠금 뒤 시각 + 적재 상한 + 5분) · 적재 뒤 기한을 다시 쓰는 갱신 0
    expect(sqls[sent]).toMatch(/SET status = 'sent', sent_at = \$2::timestamptz, deadline_at = \$3::timestamptz/);   // ★ 7R 기한 · 상한 = 같은 기준 시각(gateAt)
    expect(sent).toBeLessThan(sqls.indexOf('COMMIT'));
    expect(sqls.indexOf('COMMIT')).toBeLessThan(sqls.indexOf('INSERT'));
    expect(sqls.some((s) => /^POOL:\s*UPDATE spam_test_probes/.test(s))).toBe(false);
  });

  it('적재가 던지면 위로 올린다(기한은 이미 정해져 기한 처리가 expired · error 로 닫는다 · 다시 쓰는 갱신 0)', async () => {
    lockedRow = { probe_status: 'claimed', result_id: 'r1', result: 'unconfirmed' };
    insertMock.mockImplementationOnce(async () => { throw new Error('mysql down'); });
    await expect(sendDiagProbe(probeArgs, probeKind)).rejects.toThrow('mysql down');
    expect(sqls.some((s) => /^POOL:\s*UPDATE spam_test_probes/.test(s))).toBe(false);
  });

  it('★ 10R · 11R 적재 = 적재 CT 에 MySQL 절대 기한(gateAt + 60초)을 넘긴다 · 적재가 던지면 위로 · 상태 쓰기 0', async () => {
    lockedRow = { probe_status: 'claimed', result_id: 'r1', result: 'unconfirmed' };
    const before = Date.now();
    await sendDiagProbe(probeArgs, probeKind);
    const opts = insertMock.mock.calls[0]?.[7] as any;
    expect(opts?.mysqlDeadline).toBeGreaterThanOrEqual(before + DIAG_PROBE_LOAD_WAIT_MS);
    expect(opts?.mysqlDeadline).toBeLessThanOrEqual(Date.now() + DIAG_PROBE_LOAD_WAIT_MS);
    sqls.length = 0; insertMock.mockClear();
    lockedRow = { probe_status: 'claimed', result_id: 'r1', result: 'unconfirmed' };
    insertMock.mockImplementationOnce(async () => { throw new Error('MySQL 실행 상한 넘김'); });
    await expect(sendDiagProbe({ ...probeArgs, id: 'p2' }, probeKind)).rejects.toThrow('상한');
    expect(sqls.some((s) => /^POOL:\s*(WITH p AS \(\s*)?UPDATE spam_test_probes/.test(s))).toBe(false);
  });

  it('선점이 이미 내 것이 아님(다른 호출이 먼저 sent) = 적재 0 · 쓰기 0(먼저 보낸 것의 기다림을 깨지 않는다)', async () => {
    lockedRow = { probe_status: 'sent', result_id: 'r1', result: 'unconfirmed' };
    await sendDiagProbe(probeArgs, probeKind);
    expect(insertMock).not.toHaveBeenCalled();
    expect(wrote(/^\s*UPDATE /)).toBe(false);
  });

  it('결과가 이미 통과(늦은 보고) = 적재 0 · 확인 문자 expired · 결과 쓰기는 unconfirmed 조건(통과는 그대로)', async () => {
    lockedRow = { probe_status: 'claimed', result_id: 'r1', result: 'pass' };
    await sendDiagProbe(probeArgs, probeKind);
    expect(insertMock).not.toHaveBeenCalled();
    expect(wrote(/SET status = 'expired'/)).toBe(true);
    const resultWrite = sqls.find((s) => /UPDATE spam_filter_test_results/.test(s)) || '';
    expect(resultWrite).toMatch(/result = 'unconfirmed'/);
  });

  it('스위치 꺼짐 = 적재 0(첫 선점 · 다시 보내기 모두 이 함수를 지난다)', async () => {
    process.env.SPAM_DIAG_SENDS = '';
    lockedRow = { probe_status: 'claimed', result_id: 'r1', result: 'unconfirmed' };
    await sendDiagProbe(probeArgs, probeKind);
    expect(insertMock).not.toHaveBeenCalled();
    expect(wrote(/SET status = 'expired'/)).toBe(true);
  });

  it('판을 만든 지 30분 넘음 = 적재 0', async () => {
    lockedRow = { probe_status: 'claimed', result_id: 'r1', result: 'unconfirmed' };
    await sendDiagProbe(probeArgs, { ...probeKind, createdAt: new Date(NOW - 31 * 60_000) });
    expect(insertMock).not.toHaveBeenCalled();
  });
});
