// ★ 2026-11-10 적재 묶음 트랜잭션 CT(queue-load-tx) + 세 큐 CT 의 tx 갈래(설계서 docs/2026-11-10-load-resume-design.md §3 · §4)
//   못 박는 것: 커밋 = COMMIT 뒤 반납 뒤 커밋 뒤 함수 · COMMIT 오류 = 'unknown'(파기 · 뒤 함수 0) · 엔진 관문 · 커밋 기록 중복 키 = 이미 커밋됨(수) ·
//              잠금 대기 만료 · tx 면 배치 실패 = QueueTxAbort(부분 커밋 0) · 탐지 · 학습 = 커밋 뒤 · tx 없으면 옛 규칙(삼킴 · 부분 성공) 그대로
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ mysqlCalls: [] as string[], mysqlFail: null as null | ((sql: string, n: number) => boolean), n: 0 }));
vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  mysqlQuery: vi.fn(async (sql: string) => {
    db.n++;
    db.mysqlCalls.push(sql);
    if (db.mysqlFail && db.mysqlFail(sql, db.n)) throw Object.assign(new Error('mysql 실패'), { code: 'ER_X' });
    return [];
  }),
  mysqlPool: { getConnection: vi.fn() },
  pool: { connect: vi.fn() },
}));

import {
  openQueueTransaction, queueTxReady, claimLoadChunk, sealLoadChunk, LOAD_CHUNK_TABLE,
  QueueTxAbort, LoadChunkAlreadyCommitted, LoadChunkLockTimeout, __resetQueueTxEngineCache, type QueueTx,
} from '../queue-load-tx';
import { bulkInsertSmsQueue, insertBrandQueue, insertAlimtalkQueue } from '../sms-queue';
import { BATCH_SIZES } from '../../config/defaults';

function fakeConn(o: { commitFails?: boolean; rollbackFails?: boolean } = {}) {
  const log: string[] = [];
  const conn = {
    query: vi.fn(async (sql: string) => { log.push(`Q:${sql}`); return [[{ ok: 1 }], []]; }),
    beginTransaction: vi.fn(async () => { log.push('BEGIN'); }),
    commit: vi.fn(async () => { log.push('COMMIT'); if (o.commitFails) throw new Error('연결 끊김'); }),
    rollback: vi.fn(async () => { log.push('ROLLBACK'); if (o.rollbackFails) throw new Error('끊김'); }),
    release: vi.fn(() => { log.push('RELEASE'); }),
    destroy: vi.fn(() => { log.push('DESTROY'); }),
  };
  return { conn, log, pool: { getConnection: async () => conn } };
}

function fakeTx(o: { failAt?: number } = {}) {
  const runs: string[] = [];
  const hooks: Array<() => any> = [];
  const tx: QueueTx = {
    run: async (sql: string) => {
      runs.push(sql);
      if (o.failAt && runs.length === o.failAt) throw Object.assign(new Error('배치 실패'), { code: 'ER_DATA_TOO_LONG' });
      return [];
    },
    afterCommit: (fn) => { hooks.push(fn); },
  };
  return { tx, runs, hooks };
}

beforeEach(() => {
  db.mysqlCalls = []; db.mysqlFail = null; db.n = 0;
  __resetQueueTxEngineCache();
});

describe('openQueueTransaction', () => {
  it('BEGIN 전에 잠금 대기 상한 · 커밋 = COMMIT → 연결 닫음(풀 반납 0 · 세션 값 누수 0 · Codex 구현 1R) → 커밋 뒤 함수(순서)', async () => {
    const f = fakeConn();
    const tx = await openQueueTransaction(f.pool);
    tx.afterCommit(() => { f.log.push('HOOK'); });
    const rows = await tx.run('INSERT X');
    expect(rows).toEqual([{ ok: 1 }]);
    expect(await tx.commit()).toBe('committed');
    expect(f.log[0]).toMatch(/innodb_lock_wait_timeout = 30/);
    expect(f.log.slice(1)).toEqual(['BEGIN', 'Q:INSERT X', 'COMMIT', 'DESTROY', 'HOOK']);
    expect(f.log).not.toContain('RELEASE');
  });
  it('COMMIT 오류 = unknown · 연결 파기 · 커밋 뒤 함수 0', async () => {
    const f = fakeConn({ commitFails: true });
    const tx = await openQueueTransaction(f.pool);
    tx.afterCommit(() => { f.log.push('HOOK'); });
    expect(await tx.commit()).toBe('unknown');
    expect(f.log).toContain('DESTROY');
    expect(f.log).not.toContain('HOOK');
    expect(f.log).not.toContain('RELEASE');
  });
  it('되돌림 = ROLLBACK → 연결 닫음(반납 0) · 오류여도 닫음 · 커밋 뒤 함수 0', async () => {
    const a = fakeConn();
    const t1 = await openQueueTransaction(a.pool);
    t1.afterCommit(() => { a.log.push('HOOK'); });
    await t1.rollback();
    expect(a.log.slice(-2)).toEqual(['ROLLBACK', 'DESTROY']);
    expect(a.log).not.toContain('RELEASE');
    expect(a.log).not.toContain('HOOK');
    const b = fakeConn({ rollbackFails: true });
    const t2 = await openQueueTransaction(b.pool);
    await t2.rollback();
    expect(b.log).toContain('DESTROY');
  });
});

describe('queueTxReady(관문)', () => {
  it('큐 테이블 + 커밋 기록 표가 모두 InnoDB 일 때만 참 · 하나라도 없거나 다른 엔진 · 조회 실패 = 거짓', async () => {
    const all = async () => [{ t: 'SMSQ_SEND_1', e: 'InnoDB' }, { t: LOAD_CHUNK_TABLE, e: 'InnoDB' }];
    expect(await queueTxReady(['SMSQ_SEND_1'], all)).toBe(true);
    __resetQueueTxEngineCache();
    expect(await queueTxReady(['SMSQ_SEND_1'], async () => [{ t: 'SMSQ_SEND_1', e: 'InnoDB' }])).toBe(false);   // 기록 표 없음(DDL 전)
    __resetQueueTxEngineCache();
    expect(await queueTxReady(['SMSQ_SEND_1'], async () => [{ t: 'SMSQ_SEND_1', e: 'MyISAM' }, { t: LOAD_CHUNK_TABLE, e: 'InnoDB' }])).toBe(false);
    __resetQueueTxEngineCache();
    expect(await queueTxReady(['SMSQ_SEND_1'], async () => { throw new Error('x'); })).toBe(false);
  });
  it('캐시 = 두 번째 부름은 다시 묻지 않는다', async () => {
    const run = vi.fn(async () => [{ t: 'SMSQ_SEND_1', e: 'InnoDB' }, { t: LOAD_CHUNK_TABLE, e: 'InnoDB' }]);
    await queueTxReady(['SMSQ_SEND_1'], run);
    await queueTxReady(['SMSQ_SEND_1'], run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('claimLoadChunk · sealLoadChunk', () => {
  it('첫 문장 = 기록 INSERT(0 · 0) · seal = 같은 줄에 적재 수', async () => {
    const { tx, runs } = fakeTx();
    await claimLoadChunk(tx, 'camp', '101', 100);
    await sealLoadChunk(tx, 'camp', '101', 98, 0);
    expect(runs[0]).toMatch(new RegExp(`^INSERT INTO ${LOAD_CHUNK_TABLE} \\(campaign_id, first_staging_id, rows_read, sms_loaded, brand_loaded\\) VALUES \\(\\?, \\?, \\?, 0, 0\\)`));
    expect(runs[1]).toMatch(new RegExp(`^UPDATE ${LOAD_CHUNK_TABLE} SET sms_loaded = \\?, brand_loaded = \\?`));
  });
  it('중복 키 = 이미 커밋됨(같은 트랜잭션에서 수를 읽음) · 잠금 대기 만료 = LockTimeout · 그 밖 = 그대로 던짐', async () => {
    const dup: QueueTx = {
      run: async (sql: string) => {
        if (sql.startsWith('INSERT')) throw Object.assign(new Error('Duplicate entry'), { errno: 1062, code: 'ER_DUP_ENTRY' });
        return [{ rows_read: 100, sms_loaded: 97, brand_loaded: 0 }];
      },
      afterCommit: () => undefined,
    };
    await expect(claimLoadChunk(dup, 'c', '1', 100)).rejects.toMatchObject({ name: 'LoadChunkAlreadyCommitted', record: { rowsRead: 100, smsLoaded: 97, brandLoaded: 0 } });
    const lock: QueueTx = { run: async () => { throw Object.assign(new Error('Lock wait timeout'), { errno: 1205 }); }, afterCommit: () => undefined };
    await expect(claimLoadChunk(lock, 'c', '1', 100)).rejects.toBeInstanceOf(LoadChunkLockTimeout);
    const other: QueueTx = { run: async () => { throw new Error('다른 오류'); }, afterCommit: () => undefined };
    await expect(claimLoadChunk(other, 'c', '1', 100)).rejects.toThrow('다른 오류');
    expect(LoadChunkAlreadyCommitted).toBeTypeOf('function');
  });
});

describe('세 큐 CT 의 tx 갈래', () => {
  const smsRow = (i: number) => [`0100000${String(i).padStart(4, '0')}`, '0212345678', '안내', 'S', '', '', 'camp-1', 'c-1', '', '', ''];

  it('bulkInsertSmsQueue + tx = 그 연결로 · 공용 풀 0 · 탐지 = 커밋 뒤 · 두 번째 배치 실패 = QueueTxAbort', async () => {
    const ok = fakeTx();
    const n = await bulkInsertSmsQueue(['SMSQ_SEND_1'], [smsRow(1), smsRow(2)], true, { companyId: 'c-1' } as any, { tx: ok.tx });
    expect(n).toBe(2);
    expect(ok.runs.length).toBe(1);
    expect(ok.hooks.length).toBe(1);   // 탐지 = 커밋 뒤
    expect(db.mysqlCalls.filter((s) => s.startsWith('INSERT'))).toEqual([]);
    const many = Array.from({ length: BATCH_SIZES.smsSend + 1 }, (_, i) => smsRow(i));
    const bad = fakeTx({ failAt: 2 });
    await expect(bulkInsertSmsQueue(['SMSQ_SEND_1'], many, true, { companyId: 'c-1' } as any, { tx: bad.tx })).rejects.toBeInstanceOf(QueueTxAbort);
    expect(bad.hooks.length).toBe(0);
  });

  it('tx 없으면 옛 규칙 그대로 = 배치 실패를 삼키고 성공 배치만 센다(부분 성공)', async () => {
    const many = Array.from({ length: BATCH_SIZES.smsSend + 1 }, (_, i) => smsRow(i));
    let inserts = 0;
    db.mysqlFail = (sql) => sql.startsWith('INSERT') && ++inserts === 2;
    const n = await bulkInsertSmsQueue(['SMSQ_SEND_1'], many, true, { companyId: 'c-1' } as any);
    expect(n).toBe(BATCH_SIZES.smsSend);
  });

  it('insertBrandQueue · insertAlimtalkQueue + tx = 실패 = QueueTxAbort · 성공 = 그 연결 · 알림톡 학습 = 커밋 뒤', async () => {
    const brandRow = { phone: '01000000001', callback: '', msgContents: '{"x":1}', etcJson: '{"sender_key":"k"}', nextType: 'N' as const, companyId: 'c-1' };
    const b = fakeTx();
    expect(await insertBrandQueue(['SMSQ_SEND_1'], [brandRow as any], 'camp-1', undefined, b.tx)).toBe(1);
    expect(b.runs.length).toBe(1);
    await expect(insertBrandQueue(['SMSQ_SEND_1'], [brandRow as any], 'camp-1', undefined, fakeTx({ failAt: 1 }).tx)).rejects.toBeInstanceOf(QueueTxAbort);
    const alimRow = { phone: '01000000001', callback: '0212345678', message: '안내', templateCode: 'T1', nextType: 'N', companyId: 'c-1' };
    const a = fakeTx();
    expect(await insertAlimtalkQueue(['SMSQ_SEND_1'], [alimRow as any], 'camp-1', a.tx)).toBe(1);
    expect(a.hooks.length).toBe(1);   // 학습 적재 = 커밋 뒤
    await expect(insertAlimtalkQueue(['SMSQ_SEND_1'], [alimRow as any], 'camp-1', fakeTx({ failAt: 1 }).tx)).rejects.toBeInstanceOf(QueueTxAbort);
  });
});
