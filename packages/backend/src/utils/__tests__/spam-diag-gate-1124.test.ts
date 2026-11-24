/**
 * 확인 판 발송 관문(★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §6-2-1)
 *
 * 확인 판 문자는 두 함수로만 적재된다(검사 문자 = executeSpamTest 적재 · 확인 문자 = sendProbe). 그 두 함수 안에서
 * 부모 진단 잠금을 잡고 영속 상태를 다시 읽은 뒤 이 판정으로 셋 중 하나를 고른다:
 *   not_mine = 이미 내 것이 아님(아무것도 쓰지 않음) · pass = 적재 · reject = 열린 값만 닫기.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  judgeDiagTestSend, judgeDiagProbeSend, diagSendsOn, diagLockKey, DIAG_TEST_SEND_MINUTES, DIAG_PROBE_SEND_MINUTES,
} from '../spam-diag-gate';

const NOW = Date.parse('2026-11-24T05:00:00Z');
const min = (n: number) => n * 60_000;

describe('검사 문자 관문(judgeDiagTestSend)', () => {
  const base = { switchOn: true, status: 'active', result: null as string | null, createdAtMs: NOW - min(1), nowMs: NOW, callbackAllowed: true, hasParent: true };

  it('열린 판 · 스위치 켜짐 · 15분 안 · 권한 있음 = 적재', () => {
    expect(judgeDiagTestSend(base)).toBe('pass');
  });
  it('판이 active 가 아니면(정리 · 닫기가 먼저) = 내 것 아님', () => {
    expect(judgeDiagTestSend({ ...base, status: 'completed' })).toBe('not_mine');
  });
  it('결과가 이미 정해졌으면(error · timeout · pass) = 내 것 아님', () => {
    expect(judgeDiagTestSend({ ...base, result: 'error' })).toBe('not_mine');
    expect(judgeDiagTestSend({ ...base, result: 'timeout' })).toBe('not_mine');
  });
  it('스위치 꺼짐 · 15분 넘음 · 권한 없음 · 부모 없음 = 거부', () => {
    expect(judgeDiagTestSend({ ...base, switchOn: false })).toBe('reject');
    expect(judgeDiagTestSend({ ...base, createdAtMs: NOW - min(DIAG_TEST_SEND_MINUTES) - 1 })).toBe('reject');
    expect(judgeDiagTestSend({ ...base, callbackAllowed: false })).toBe('reject');
    expect(judgeDiagTestSend({ ...base, hasParent: false })).toBe('reject');
  });
  it('15분 경계 안쪽은 적재', () => {
    expect(judgeDiagTestSend({ ...base, createdAtMs: NOW - min(DIAG_TEST_SEND_MINUTES) + 1000 })).toBe('pass');
  });
});

describe('확인 문자 관문(judgeDiagProbeSend)', () => {
  const base = { switchOn: true, probeStatus: 'claimed', result: 'unconfirmed' as string | null, diagCreatedAtMs: NOW - min(5), nowMs: NOW, callbackAllowed: true, hasParent: true };

  it('선점 · 확인 중 · 30분 안 · 권한 = 적재', () => {
    expect(judgeDiagProbeSend(base)).toBe('pass');
  });
  it('선점이 이미 내 것이 아님(다른 호출이 먼저 보내 sent · 닫혀 expired) = 아무것도 안 씀', () => {
    expect(judgeDiagProbeSend({ ...base, probeStatus: 'sent' })).toBe('not_mine');
    expect(judgeDiagProbeSend({ ...base, probeStatus: 'expired' })).toBe('not_mine');
  });
  it('결과가 이미 확인 중이 아님(늦은 보고 pass · 닫기 error) = 거부(확인 문자만 닫고 결과는 둔다 — 호출부)', () => {
    expect(judgeDiagProbeSend({ ...base, result: 'pass' })).toBe('reject');
    expect(judgeDiagProbeSend({ ...base, result: 'error' })).toBe('reject');
  });
  it('스위치 꺼짐 · 30분 넘음 · 권한 없음 = 거부', () => {
    expect(judgeDiagProbeSend({ ...base, switchOn: false })).toBe('reject');
    expect(judgeDiagProbeSend({ ...base, diagCreatedAtMs: NOW - min(DIAG_PROBE_SEND_MINUTES) - 1 })).toBe('reject');
    expect(judgeDiagProbeSend({ ...base, callbackAllowed: false })).toBe('reject');
  });
});

describe('스위치 · 잠금 키', () => {
  it('스위치 = ENV SPAM_DIAG_SENDS 가 정확히 on 일 때만', () => {
    expect(diagSendsOn({ SPAM_DIAG_SENDS: 'on' })).toBe(true);
    expect(diagSendsOn({ SPAM_DIAG_SENDS: 'ON' })).toBe(false);
    expect(diagSendsOn({})).toBe(false);
  });
  it('잠금 키 = 부모 검사 id 하나(닫기 · 두 적재 함수가 같은 키)', () => {
    expect(diagLockKey('abc')).toBe('spam_diag:abc');
  });
});

describe('적재 두 함수 배선(소스 계약)', () => {
  const queue = readFileSync(join(__dirname, '..', 'spam-test-queue.ts'), 'utf8');
  const probe = readFileSync(join(__dirname, '..', 'spam-probe.ts'), 'utf8');
  const body = (src: string, head: string) => {
    const i = src.indexOf(head);
    expect(i, head).toBeGreaterThan(-1);
    const next = src.indexOf('\nasync function ', i + head.length);
    const nextExp = src.indexOf('\nexport ', i + head.length);
    const end = [next, nextExp].filter((n) => n > 0).sort((a, b) => a - b)[0] ?? src.length;
    return src.slice(i, end);
  };

  it('executeSpamTest = 확인 판이면 적재 전에 sendDiagTestRow(관문)로 간다', () => {
    const b = body(queue, 'async function executeSpamTest(');
    expect(b).toContain('isDiagTest(test.source)');
    expect(b.indexOf('sendDiagTestRow(')).toBeGreaterThan(-1);
    expect(b.indexOf('sendDiagTestRow(')).toBeLessThan(b.indexOf('await insertTestSmsQueue('));
  });

  it('sendDiagTestRow = 도장 값(잠금 앞) → 진단 잠금 → 행 잠금 → 저장점 → 권한(같은 연결) → 관문 → 커밋 · 연결 반납 → 적재(잠금 밖)', () => {
    const b = body(queue, 'export async function sendDiagTestRow(');
    const order = ['spamStampReady(', 'pool.connect()', 'DIAG_LOCK_SQL', 'FOR UPDATE', 'SAVEPOINT', 'diagCallbackAllowed(', 'judgeDiagTestSend(', "'COMMIT'", 'client.release()', 'insertTestSmsQueue('];
    let at = -1;
    for (const k of order) { const n = b.indexOf(k, at + 1); expect(n, k).toBeGreaterThan(at); at = n; }
    expect(b).toMatch(/diagCallbackAllowed\([^)]*, run\)/);   // 권한 = 잠금을 쥔 같은 연결
  });

  it('내 것 아님인데 판이 active 이고 결과가 모두 정해졌으면 판만 completed(대기열이 멈추지 않게)', () => {
    const b = body(queue, 'export async function sendDiagTestRow(');
    expect(b).toMatch(/WHERE id = \$1 AND status = 'active' AND NOT EXISTS \(SELECT 1 FROM spam_filter_test_results WHERE test_id = \$1 AND result IS NULL\)/);
  });

  it('executeSpamTest = 확인 판이면 어느 단계의 예외든 공통 완료로 가지 않고 active 로 둔다(정리가 timeout 으로 닫는다)', () => {
    const b = body(queue, 'async function executeSpamTest(');
    expect(b).toContain('source?: string | null');
    const c = b.indexOf("console.error('[SpamTestQueue] 테스트 실행 오류:', err);");
    expect(c).toBeGreaterThan(-1);
    expect(b.indexOf('if (isDiagTest(source)) return;', c)).toBeGreaterThan(c);
    expect(b.indexOf('if (isDiagTest(source)) return;', c)).toBeLessThan(b.indexOf('if (refundCompanyId)', c));
    expect(queue).toContain('await executeSpamTest(test.id, isAutoSpamSource(test.source), test.company_id, test.source);');
  });

  it('대기열 전환 = 아직 queued 일 때만 · 못 바꿨으면 실행 0', () => {
    expect(queue).toContain("`UPDATE spam_filter_tests SET status = 'active' WHERE id = $1 AND status = 'queued'`");
    expect(queue).toContain('if ((activated.rowCount ?? 0) === 0) return;');
  });

  it('sendProbe = 출처를 스스로 읽고 확인 판이면 sendDiagProbe(관문)로 간다(부르는 자리에 기대지 않는다)', () => {
    const b = body(probe, 'async function sendProbe(');
    expect(b).toContain('isDiagTest(');
    expect(b.indexOf('sendDiagProbe(')).toBeLessThan(b.indexOf('insertTestSmsQueue('));
  });

  it('sendDiagProbe = 도장 값 → 진단 잠금 → 행 잠금 → 저장점 → 권한(같은 연결) → 관문 → sent 표시 → 커밋 · 반납 → 적재(잠금 밖)', () => {
    const b = body(probe, 'async function sendDiagProbe(');
    const order = ['spamStampReady(', 'pool.connect()', 'DIAG_LOCK_SQL', 'FOR UPDATE', 'SAVEPOINT', 'diagCallbackAllowed(', 'judgeDiagProbeSend(', "SET status = 'sent'", "'COMMIT'", 'client.release()', 'insertTestSmsQueue('];
    let at = -1;
    for (const k of order) { const n = b.indexOf(k, at + 1); expect(n, k).toBeGreaterThan(at); at = n; }
    expect(b).toMatch(/diagCallbackAllowed\([^)]*, run\)/);
  });

  it('확인 문자 적재(insertTestSmsQueue)는 sendProbe · sendDiagProbe 안에만 있다', () => {
    const calls = (probe.match(/insertTestSmsQueue\(/g) || []).length;
    const inside = (body(probe, 'async function sendProbe(').match(/insertTestSmsQueue\(/g) || []).length
      + (body(probe, 'async function sendDiagProbe(').match(/insertTestSmsQueue\(/g) || []).length;
    expect(calls).toBe(inside);
  });
});
