// replaces: none
/**
 * B-1101-4 · R37 — 정산 기준 기록 문장(READ_HIGH_UPDATE_SQL)을 실 PostgreSQL · 실제 드라이버로 돌린다
 * (설계서 docs/2026-11-01-result-read-shrink-guard-design.md §3-3 · 새 SQL = 실 PG 시험 뒤 배포).
 *   못 박는 것: 칸마다 큰 값만 남는다(내려가지 않음) · send_config 의 다른 키는 그대로 · send_config NULL 에서도 만든다 · 숫자 칸.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { READ_HIGH_UPDATE_SQL } from '../mysql-refund-sweeper';

const CO = '00000000-0000-0000-0000-00000000c101';
const CA = '00000000-0000-0000-0000-00000000a101';
const CB = '00000000-0000-0000-0000-00000000b101';

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'campaigns', { id: CA, company_id: CO, send_config: JSON.stringify({ sentTables: ['SMSQ_SEND_15'] }) });
  await insertMinimalRow(pool, 'campaigns', { id: CB, company_id: CO });
  await pool.query('UPDATE campaigns SET send_config = NULL WHERE id = $1', [CB]);
});

const readHigh = async (id: string) => (await pool.query(`SELECT send_config FROM campaigns WHERE id = $1`, [id])).rows[0].send_config;

describe('정산 기준 기록 = 칸마다 큰 값만', () => {
  it('처음 기록 · 다른 키 보존', async () => {
    await pool.query(READ_HIGH_UPDATE_SQL, [CA, 733, 0, 0, 0, 0, 0, 0, 0, 0]);
    const sc = await readHigh(CA);
    expect(sc.sentTables).toEqual(['SMSQ_SEND_15']);
    expect(Number(sc.readHigh.success)).toBe(733);
  });
  it('덜 읽힌 값(274)은 기준을 내리지 않고 · 커진 칸(차액 88.46 · 브랜드 100)만 오른다', async () => {
    await pool.query(READ_HIGH_UPDATE_SQL, [CA, 274, 3, 88.46, 100, 90, 0, 0, 0, 0]);
    const rh = (await readHigh(CA)).readHigh;
    expect(Number(rh.success)).toBe(733);
    expect(Number(rh.sub)).toBe(3);
    expect(Number(rh.unitDiff)).toBe(88.46);
    expect(Number(rh.brandLoaded)).toBe(100);
    expect(Number(rh.brandSuccess)).toBe(90);
  });
  it('send_config 가 NULL 인 캠페인도 기록을 만든다', async () => {
    await pool.query(READ_HIGH_UPDATE_SQL, [CB, 5, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Number((await readHigh(CB)).readHigh.success)).toBe(5);
  });
  it('세대가 바뀌었으면(취소 정산이 기준을 지움) 낡은 읽기는 쓰지 않는다 · 같은 세대만 쓴다', async () => {
    await pool.query(`UPDATE campaigns SET send_config = (send_config - 'readHigh') || '{"readHighGen": 1}'::jsonb WHERE id = $1`, [CA]);
    const stale = await pool.query(READ_HIGH_UPDATE_SQL, [CA, 999, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(stale.rowCount).toBe(0);
    expect((await readHigh(CA)).readHigh).toBeUndefined();
    const fresh = await pool.query(READ_HIGH_UPDATE_SQL, [CA, 50, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(fresh.rowCount).toBe(1);
    expect(Number((await readHigh(CA)).readHigh.success)).toBe(50);
  });
});
