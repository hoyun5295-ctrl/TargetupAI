/**
 * withTransaction(config/database) · 업로드 경로 수신동의 기본값 원자성 (2026-10-04 Codex 1004 R1 high)
 *
 * 못 박는 것:
 *   1. 성공 = BEGIN → work → COMMIT · 연결 반납(정상).
 *   2. work 가 던지면 ROLLBACK 후 같은 오류를 다시 던진다.
 *   3. ROLLBACK 마저 실패하면 그 연결은 오류와 함께 반납(풀이 버린다).
 *   4. 업로드 경로는 업서트와 수신동의 기본값을 같은 트랜잭션 안에서 부른다(일괄 · 단건 폴백 둘 다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const h = vi.hoisted(() => ({
  log: [] as string[],
  failOn: null as string | null,
  rollbackFails: false,
  released: [] as Array<Error | undefined>,
}));

vi.mock('pg', () => {
  class Pool {
    query = async () => ({ rows: [], rowCount: 0 });
    connect = async () => ({
      query: async (sql: string) => {
        h.log.push(sql);
        if (sql === 'ROLLBACK' && h.rollbackFails) throw new Error('connection terminated');
        if (h.failOn && sql === h.failOn) throw Object.assign(new Error('boom'), { code: '40P01' });
        return { rows: [], rowCount: 1 };
      },
      release: (err?: Error) => { h.released.push(err); },
    });
    on() { return this; }
  }
  return { Pool, types: { setTypeParser: () => undefined } };
});

import { withTransaction } from '../../config/database';

beforeEach(() => {
  h.log.length = 0;
  h.released.length = 0;
  h.failOn = null;
  h.rollbackFails = false;
});

describe('withTransaction', () => {
  it('성공 = BEGIN → work → COMMIT · 정상 반납', async () => {
    const out = await withTransaction(async (run) => { await run('W1'); return 7; });
    expect(out).toBe(7);
    expect(h.log).toEqual(['BEGIN', 'W1', 'COMMIT']);
    expect(h.released).toEqual([undefined]);
  });

  it('work 실패 = ROLLBACK 후 같은 오류를 던진다(COMMIT 없음)', async () => {
    h.failOn = 'W2';
    await expect(withTransaction(async (run) => { await run('W1'); await run('W2'); })).rejects.toMatchObject({ code: '40P01' });
    expect(h.log).toEqual(['BEGIN', 'W1', 'W2', 'ROLLBACK']);
    expect(h.released).toEqual([undefined]);
  });

  it('ROLLBACK 도 실패하면 연결을 오류와 함께 반납(풀이 버린다)', async () => {
    h.failOn = 'W1';
    h.rollbackFails = true;
    await expect(withTransaction(async (run) => { await run('W1'); })).rejects.toMatchObject({ code: '40P01' });
    expect(h.released[0]).toBeInstanceOf(Error);
  });
});

describe('업로드 경로 계약 — 업서트와 수신동의 기본값은 한 트랜잭션', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../routes/upload.ts'), 'utf-8');

  it('일괄 · 단건 폴백 모두 withTransaction 안에서 업서트 직후 applySmsOptInDefaults', () => {
    const pattern = /withTransaction\(async \(run\) => \{\s*const r = await run\((?:sql, queryValues|rowSql, rowValues)\);\s*await applySmsOptInDefaults\(run,/g;
    expect((src.match(pattern) || []).length).toBe(2);
  });

  it('트랜잭션 밖 수신동의 백필은 남아 있지 않다', () => {
    expect(src).not.toMatch(/buildSmsOptInBackfill|buildSmsOptInUnknownDefault/);
  });
});
