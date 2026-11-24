/**
 * 상한 있는 MySQL 연결(withBoundedMysql)의 기한 판정 세 자리(★2026-11-24 · Codex 구현 12R ~ 15R · 확인 판 확인 문자 · 여정 담당자 안내 공통)
 *   ① 들어올 때 지났으면 연결을 빌리지 않는다 ② 연결을 받은 직후 지났으면 일을 부르지 않고 돌려준다 ③ 문장을 내기 직전 지났으면 내지 않고 돌려준다.
 *   낸 뒤 상한을 넘긴 문장만 그 연결을 destroy(기존 계약). 시계(Date.now)와 연결 도착을 시험이 손으로 움직인다(실제 타이머 1초는 그 전에 끝난다).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { withBoundedMysql } from '../../config/database';

let now = 0;
afterEach(() => { vi.restoreAllMocks(); });

/** 연결을 손으로 건네는 가짜 풀 */
function manualPool() {
  const stats = { gets: 0, queries: 0, destroyed: 0, released: 0 };
  let give: (c: any) => void = () => undefined;
  const conn = {
    query: async () => { stats.queries++; return [[{ ok: 1 }], []]; },
    release: () => { stats.released++; },
    destroy: () => { stats.destroyed++; },
  };
  return {
    stats,
    hand: () => give(conn),
    getConnection: () => { stats.gets++; return new Promise<any>((res) => { give = res; }); },
  };
}

describe('withBoundedMysql — 같은 절대 기한으로 세 자리', () => {
  it('① 들어올 때 이미 지남 = 연결 빌리기 0 · 일 0', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    now = 2000;
    const p = manualPool();
    let worked = false;
    await expect(withBoundedMysql(1000, async (run) => { worked = true; return run('INSERT 1'); }, p as any, 1000)).rejects.toThrow(/빌리기 전/);
    expect(p.stats).toEqual({ gets: 0, queries: 0, destroyed: 0, released: 0 });
    expect(worked).toBe(false);
  });

  it('② 연결은 왔지만 그 순간 이미 지남 = 일 0 · 문장 0 · 돌려줌 1 · destroy 0', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    now = 0;
    const p = manualPool();
    let worked = false;
    const done = withBoundedMysql(1000, async (run) => { worked = true; return run('INSERT 1'); }, p as any, 1000);
    now = 2000;   // 연결이 오기 전에 기한이 지남
    p.hand();
    await expect(done).rejects.toThrow(/받은 직후/);
    expect(worked).toBe(false);
    expect(p.stats).toEqual({ gets: 1, queries: 0, destroyed: 0, released: 1 });
  });

  it('③ 일은 시작했지만 문장을 내기 직전 지남 = 일 · run 들어감 · 문장 0 · 돌려줌 1 · destroy 0', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    now = 0;
    const p = manualPool();
    let worked = false;
    let ran = false;
    const done = withBoundedMysql(1000, async (run) => { worked = true; now = 2000; ran = true; return run('INSERT 1'); }, p as any, 1000);
    p.hand();
    await expect(done).rejects.toThrow(/제출 전/);
    expect(worked && ran).toBe(true);
    expect(p.stats).toEqual({ gets: 1, queries: 0, destroyed: 0, released: 1 });
  });

  it('기한 안 = 그대로 실행 · 돌려줌 1', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    now = 0;
    const p = manualPool();
    const done = withBoundedMysql(1000, (run) => run('SELECT 1'), p as any, 1000);
    p.hand();
    expect(await done).toEqual([{ ok: 1 }]);
    expect(p.stats).toEqual({ gets: 1, queries: 1, destroyed: 0, released: 1 });
  });
});
