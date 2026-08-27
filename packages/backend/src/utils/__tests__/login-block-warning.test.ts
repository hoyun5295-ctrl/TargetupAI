/**
 * 로그인 횟수 제한 경고·차단 문구 계약 (★2026-08-27 전송자격인증 3.4)
 *
 * 왜 있나
 *   인증기준 3.4가 「로그인 횟수 제한 **경고** 및 차단」을 요구한다. 차단 문구만 있고 경고가 없으면
 *   심사에서 낼 화면이 없다. 그리고 임계값(5회)과 차단 시간(30분)은 이 CT가 소유해야 한다 —
 *   호출부가 숫자를 다시 쓰면 한쪽만 바뀌는 날이 오고, 화면 안내와 실제 동작이 어긋난다.
 *
 * 못 박는 것
 *   1. 임계 직전에만 경고가 나온다. 매 실패마다 남은 횟수를 알리면 공격자에게 진행 상황을 알려주는 셈이다.
 *   2. 차단되면 경고 대신 차단 안내가 나오고, 남은 횟수는 0이다.
 *   3. 문구에 실제 임계값과 차단 시간이 들어간다(화면 안내와 동작이 같은 값을 쓴다).
 *   4. IP나 아이디가 없으면 조회하지 않고 그대로 통과시킨다(정상 경로를 막지 않는다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import { recordFailureAndMaybeBlock } from '../login-block';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

const IP = '203.0.113.10';
const ID = 'tester';

/** 활성 차단 없음 + 지정한 실패 횟수를 돌려주는 fake */
function withFailCount(n: number) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (/FROM\s+login_blocks/i.test(sql)) return { rows: [] };
    if (/COUNT\(\*\)::int\s+AS\s+cnt/i.test(sql)) return { rows: [{ cnt: n }] };
    if (/INSERT\s+INTO\s+login_blocks/i.test(sql)) return { rows: [] };
    throw new Error(`예상하지 못한 SQL: ${sql}`);
  });
}

beforeEach(() => {
  mockQuery.mockClear();
  mockQuery.mockImplementation(async () => { throw new Error('테스트가 fake를 지정하지 않았다'); });
});

describe('경고는 임계 직전에만 나온다', () => {
  it.each([
    [1, 4],
    [2, 3],
  ])('실패 %i회(남은 %i회)에는 경고가 없다', async (fails, remaining) => {
    withFailCount(fails);
    const r = await recordFailureAndMaybeBlock(IP, ID);
    expect(r.blocked).toBe(false);
    expect(r.remainingAttempts).toBe(remaining);
    expect(r.warning).toBeNull();
  });

  it.each([
    [3, 2],
    [4, 1],
  ])('실패 %i회(남은 %i회)에는 경고가 나온다', async (fails, remaining) => {
    withFailCount(fails);
    const r = await recordFailureAndMaybeBlock(IP, ID);
    expect(r.blocked).toBe(false);
    expect(r.remainingAttempts).toBe(remaining);
    expect(r.warning).toContain(`${remaining}회 더 실패`);
    expect(r.warning).toContain('30분');
    expect(r.blockedMessage).toBeNull();
  });
});

describe('임계 도달 시 차단 안내로 바뀐다', () => {
  it('실패 5회면 차단되고 남은 횟수는 0이다', async () => {
    withFailCount(5);
    const r = await recordFailureAndMaybeBlock(IP, ID);
    expect(r.blocked).toBe(true);
    expect(r.remainingAttempts).toBe(0);
    expect(r.warning).toBeNull();
    expect(r.blockedMessage).toContain('5회');
    expect(r.blockedMessage).toContain('30분');
  });

  it('이미 차단 중이면 다시 기록하지 않고 차단 안내를 준다', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/FROM\s+login_blocks/i.test(sql)) return { rows: [{ id: 'x', fail_count: 5 }] };
      throw new Error(`차단 중에는 다른 SQL이 돌면 안 된다: ${sql}`);
    });
    const r = await recordFailureAndMaybeBlock(IP, ID);
    expect(r.blocked).toBe(true);
    expect(r.blockedMessage).toBeTruthy();
    // 차단 INSERT가 다시 돌지 않았다
    expect(mockQuery.mock.calls.length).toBe(1);
  });
});

describe('문구가 실제 동작 값을 쓴다', () => {
  it('경고와 차단 안내가 같은 차단 시간을 말한다', async () => {
    withFailCount(4);
    const warn = (await recordFailureAndMaybeBlock(IP, ID)).warning!;
    mockQuery.mockClear();
    withFailCount(5);
    const blocked = (await recordFailureAndMaybeBlock(IP, ID)).blockedMessage!;
    const pick = (s: string) => (s.match(/(\d+)분/) || [])[1];
    expect(pick(warn)).toBe(pick(blocked));
  });
});

describe('입력이 없으면 조회하지 않는다', () => {
  it.each([
    ['', ID],
    [IP, ''],
  ])('ip=%s id=%s', async (ip, id) => {
    mockQuery.mockImplementation(async () => { throw new Error('조회하면 안 된다'); });
    const r = await recordFailureAndMaybeBlock(ip, id);
    expect(r.blocked).toBe(false);
    expect(r.warning).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
