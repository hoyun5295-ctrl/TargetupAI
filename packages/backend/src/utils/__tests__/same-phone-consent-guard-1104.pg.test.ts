// replaces: none
/**
 * 고객 적재 청크 첫 문장 = 회사 잠금 + 섞인 회사 판정(설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md 3-2 ⑦ · ⑧ · ⑨)
 * 기대값: 표가 없으면(DDL 전) 옛 적재 영향 0(같은 트랜잭션이 이어서 쓴다) · 세대가 있는 회사의 옛 적재 = MIXED_AGENT · 새 적재 · 다른 회사 = 통과.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, withTransaction } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { guardSyncLoadChunk, startConsentPass, ConsentPassError } from '../same-phone-consent';

const CO = randomUUID();
const OTHER = randomUUID();
const AGENT = randomUUID();
const code = async (w: Promise<unknown>) => { try { await w; return 'OK'; } catch (e) { return e instanceof ConsentPassError ? e.code : String(e); } };

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '섞인 회사 시험' });
  await insertMinimalRow(pool, 'companies', { id: OTHER, company_name: '다른 회사' });
}, 120_000);

describe('적재 청크 판정(실 PG)', () => {
  it('세대 표가 없으면(DDL 전) 옛 적재는 그대로 · 같은 트랜잭션이 이어서 쓴다', async () => {
    const after = await withTransaction(async (run) => {
      await guardSyncLoadChunk(run, CO, false);
      return (await run(`SELECT 1 AS one`)).rows[0].one;
    });
    expect(after).toBe(1);
  });

  it('세대가 생긴 회사 = 옛 적재 MIXED_AGENT · 새 적재 통과 · 다른 회사 옛 적재 통과', async () => {
    await pool.query(ledgerBlockSql('C101-DDL-1'));
    await insertMinimalRow(pool, 'sync_agents', { id: AGENT, company_id: CO });
    expect(await code(withTransaction((run) => guardSyncLoadChunk(run, CO, false)))).toBe('OK');
    await withTransaction((run) => startConsentPass(run, CO, AGENT));
    expect(await code(withTransaction((run) => guardSyncLoadChunk(run, CO, false)))).toBe('MIXED_AGENT');
    expect(await code(withTransaction((run) => guardSyncLoadChunk(run, CO, true)))).toBe('OK');
    expect(await code(withTransaction((run) => guardSyncLoadChunk(run, OTHER, false)))).toBe('OK');
  });
});
