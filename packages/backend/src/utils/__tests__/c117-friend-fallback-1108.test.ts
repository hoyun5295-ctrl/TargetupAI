/**
 * ★ 2026-11-08 C117 Codex 구현 1R #1 — 친구 칸 목록 읽기 실패 = 줄 조회는 계속(모든 표 빈 값) · 청구용 getFriendColumnTables 는 그대로 던진다.
 *   모듈 캐시가 빈 상태가 필요해 계약 시험(c117-intake-contract-1108)과 파일을 나눴다.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  mysqlPool: {},
  mysqlQuery: vi.fn(async (sql: string) => {
    if (/information_schema\.COLUMNS/i.test(sql)) throw new Error('정보 스키마 읽기 실패(시험)');
    return [];
  }),
}));

import { withFriendYnField, getFriendColumnTables } from '../sms-queue';

describe('C117 친구 칸 폴백', () => {
  it('줄 조회 필드 = 모든 표 빈 값 · 던지지 않는다', async () => {
    const f = await withFriendYnField('seqno, dest_no');
    expect(f('SMSQ_SEND_12')).toBe("seqno, dest_no, '' AS friend_yn");
  });
  it('청구용 칸 목록은 그대로 던진다(빈 집합으로 삼키지 않는다 · 폴백을 공용 캐시에 쓰지 않았다)', async () => {
    await expect(getFriendColumnTables()).rejects.toThrow('정보 스키마 읽기 실패');
  });
});
