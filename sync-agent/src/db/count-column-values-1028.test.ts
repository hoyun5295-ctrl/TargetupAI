/**
 * ★ 2026-10-28 P2 어댑터 값 분포 조회(countColumnValues) — Oracle · MySQL SQL 꼴 · 넘침 판정 · 실행 시간 상한 · MySQL 한글 보정
 * (가짜 연결 · 실DB 속도는 설치 날)
 */
import { describe, it, expect, vi } from 'vitest';
import { OracleConnector } from './oracle';
import { MysqlConnector } from './mysql';

function oracleWith(execute: (sql: string, binds?: any) => Promise<any>, brk = vi.fn(async () => {})) {
  const conn = { execute, break: brk, close: vi.fn(async () => {}) };
  const c = new OracleConnector({ host: 'h', port: 1521, database: 'D', username: 'U', password: 'x', queryTimeout: 1000 } as any);
  (c as any).pool = { getConnection: async () => conn };
  return { c, conn };
}

describe('Oracle countColumnValues', () => {
  it('"소유자"."뷰" · 따옴표 컬럼 · GROUP BY · 많은 순 · ROWNUM limit+1 · 넘침 판정', async () => {
    const calls: Array<{ sql: string; binds: any }> = [];
    const { c, conn } = oracleWith(async (sql, binds) => {
      calls.push({ sql, binds });
      return { rows: [{ V: '수신', N: 935291 }, { V: '미수신', N: 156455 }, { V: null, N: 3 }] };
    });
    const r = await c.countColumnValues('UBOB3_MTREAL.V_CUSTOMER_MST', 'YN_SMS', 2, 60000);
    expect(calls[0].sql).toContain('FROM "UBOB3_MTREAL"."V_CUSTOMER_MST"');
    expect(calls[0].sql).toContain('GROUP BY "YN_SMS"');
    expect(calls[0].sql).toContain('ORDER BY COUNT(*) DESC');
    expect(calls[0].binds).toEqual({ lim: 3 });
    expect(r).toEqual({ values: [{ value: '수신', count: 935291 }, { value: '미수신', count: 156455 }], truncated: true });
    expect(conn.close).toHaveBeenCalled();
    expect(conn.break).not.toHaveBeenCalled();
  });

  it('상한을 넘기면 conn.break() 로 끊고 「시간 초과」로 던진다 · 연결은 닫는다', async () => {
    let rejectExec: (e: Error) => void = () => {};
    const brk = vi.fn(async () => { rejectExec(new Error('ORA-01013: user requested cancel of current operation')); });
    const { c, conn } = oracleWith(() => new Promise((_res, rej) => { rejectExec = rej; }), brk);
    await expect(c.countColumnValues('V', 'YN_SMS', 30, 20)).rejects.toThrow('값 세기 시간 초과');
    expect(brk).toHaveBeenCalledTimes(1);
    expect(conn.close).toHaveBeenCalled();
  });

  it('끊기가 실패하고 실행이 영영 안 끝나도 마감에 돌아온다(Codex 구현 2R)', async () => {
    const brk = vi.fn(async () => { throw new Error('DPI-1080: connection was closed'); });
    const { c } = oracleWith(() => new Promise(() => { /* 끝나지 않는 실행 */ }), brk);
    const started = Date.now();
    await expect(c.countColumnValues('V', 'YN_SMS', 30, 30)).rejects.toThrow('값 세기 시간 초과');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(brk).toHaveBeenCalledTimes(1);
  });
});

describe('MySQL countColumnValues', () => {
  function mysqlWith(rows: Record<string, unknown>[] | Error) {
    const calls: any[] = [];
    const c = new MysqlConnector({ host: 'h', port: 3306, database: 'D', username: 'U', password: 'x', queryTimeout: 1000 } as any);
    (c as any).pool = {
      query: async (opts: any) => {
        calls.push(opts);
        if (rows instanceof Error) throw rows;
        return [rows];
      },
    };
    (c as any).ensureConnected = () => {};
    return { c, calls };
  }

  it('백틱 식별자 · LIMIT 자리표 limit+1 · 쿼리 timeout · NULL 보존', async () => {
    const { c, calls } = mysqlWith([{ v: 'Y', n: 10 }, { v: null, n: 2 }]);
    const r = await c.countColumnValues('v_member', 'SMS`YN', 30, 60000);
    expect(calls[0].sql).toContain('FROM `v_member`');
    expect(calls[0].sql).toContain('GROUP BY `SMS``YN`');
    expect(calls[0].values).toEqual([31]);
    expect(calls[0].timeout).toBe(60000);
    expect(r).toEqual({ values: [{ value: 'Y', count: 10 }, { value: null, count: 2 }], truncated: false });
  });

  it('이중 인코딩 DB 면 고객 조회와 같은 한글 보정을 거친 글자로 돌려준다(분류 키 = 정규화에 들어오는 글자)', async () => {
    const broken = Buffer.from('수신', 'utf8').toString('latin1');
    const { c } = mysqlWith([{ v: broken, n: 7 }]);
    (c as any).needsEncodingFix = true;
    const r = await c.countColumnValues('v_member', 'YN_SMS', 30, 60000);
    expect(r.values).toEqual([{ value: '수신', count: 7 }]);
  });

  it('쿼리 timeout = 「시간 초과」로 던진다', async () => {
    const e = Object.assign(new Error('Query inactivity timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' });
    const { c } = mysqlWith(e);
    await expect(c.countColumnValues('v_member', 'YN_SMS', 30, 1000)).rejects.toThrow('값 세기 시간 초과');
  });
});
