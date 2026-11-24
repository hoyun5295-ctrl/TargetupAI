/**
 * 테스트 문자 적재 CT 의 MySQL 절대 기한(★2026-11-24 · 확인 판 확인 문자 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §6-2-1 · Codex 구현 11R)
 *   기한이 있으면 준비(PG 큐 테이블 조회 · 판정)를 연결 밖에서 끝낸 뒤 INSERT 문장만 상한 있는 연결(withBoundedMysql)로 · 남은 시간이 없으면 연결을 빌리지 않는다.
 *   기한이 없으면 지금 그대로 공용 풀(mysqlQuery).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];
const absSeen: Array<number | undefined> = [];
vi.mock('../../config/database', () => ({
  default: { query: vi.fn() },
  query: vi.fn(async () => { order.push('pg'); return { rows: [{ sms_tables: ['SMSQ_SEND_10'] }] }; }),
  mysqlQuery: vi.fn(async () => { order.push('mysql'); return []; }),
  mysqlPool: {},
  withBoundedMysql: vi.fn(async (ms: number, work: (run: any) => Promise<any>, _pool?: unknown, abs?: number) => { order.push(`bounded:${ms > 0}`); absSeen.push(abs); return work(async () => { order.push('run'); return []; }); }),
}));
vi.mock('../demo-company', async (orig) => ({ ...(await orig<any>()), guardDemoLeak: async () => undefined }));

import { insertTestSmsQueue } from '../sms-queue';
import { withBoundedMysql, mysqlQuery } from '../../config/database';

beforeEach(() => { order.length = 0; vi.mocked(withBoundedMysql).mockClear(); vi.mocked(mysqlQuery).mockClear(); });

describe('insertTestSmsQueue mysqlDeadline', () => {
  it('기한 = 준비(PG) 뒤에 INSERT 만 상한 연결 · 공용 풀 0', async () => {
    const until = Date.now() + 60_000;
    absSeen.length = 0;
    await insertTestSmsQueue('01000000000', '0212345678', '확인 문자', 'SMS', 'p1', '', undefined, { mysqlDeadline: until });
    expect(withBoundedMysql).toHaveBeenCalledTimes(1);
    expect(absSeen[0]).toBe(until);   // ★ 13R 절대 기한 그대로
    expect(mysqlQuery).not.toHaveBeenCalled();
    expect(order.indexOf('bounded:true')).toBeGreaterThan(-1);
    expect(order.lastIndexOf('pg')).toBeLessThan(order.indexOf('bounded:true'));   // PG 준비가 연결 빌리기보다 먼저
    expect(order[order.length - 1]).toBe('run');
  });
  it('남은 시간 0 = 연결을 빌리지 않고 던진다', async () => {
    await expect(insertTestSmsQueue('01000000000', '0212345678', '확인 문자', 'SMS', 'p1', '', undefined, { mysqlDeadline: Date.now() - 1 })).rejects.toThrow('상한');
    expect(withBoundedMysql).not.toHaveBeenCalled();
    expect(mysqlQuery).not.toHaveBeenCalled();
  });
  it('미가입 0 — 기한 없는 호출(기존 9곳) = 지금 그대로 공용 풀', async () => {
    await insertTestSmsQueue('01000000000', '0212345678', '문자', 'SMS', 't1', '');
    expect(mysqlQuery).toHaveBeenCalledTimes(1);
    expect(withBoundedMysql).not.toHaveBeenCalled();
  });
});
