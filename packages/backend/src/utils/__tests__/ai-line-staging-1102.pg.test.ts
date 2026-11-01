// replaces: none
/**
 * AI 한줄로 서버 적재 · 명단 서명 — 실 PostgreSQL 판(★ 2026-11-02 엔진 재설계 E1-4 · 설계 1R D1-5 · 2R D2-4)
 *
 * 서명 = 실제 발송 집합(중복 제거 · 수신거부 거름)의 번호마다 md5 앞 63비트를 numeric 으로 더한 합 + 수.
 * 못 박는 것: 수 · 합이 집합을 가른다(수가 같아도 사람이 바뀌면 다름) · 순서 무관 · 중복 지우기는 번호당 한 행.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { stagingSendSignature, dedupStagingRows, countStagingFiltered } from '../direct-send-core';

const CO = randomUUID();
const U = randomUUID();
const put = (stg: string, phone: string) => insertMinimalRow(pool, 'campaign_send_staging', { staging_id: stg, company_id: CO, phone });

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: U, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1107', login_id: 't-1102-stg' });
  await insertMinimalRow(pool, 'unsubscribes', { company_id: CO, user_id: U, phone: '01000000003' });
});

describe('E1-4 명단 서명(실 PG)', () => {
  it('수 = 실제 발송 집합(countStagingFiltered 와 같은 수) · 중복 · 수신거부 · 순서 무관', async () => {
    const a = randomUUID();
    for (const p of ['01000000001', '01000000001', '01000000002', '01000000003']) await put(a, p);
    const sig = await stagingSendSignature(a, CO, U, true, true);
    expect(sig.split(':')[0]).toBe('2');
    const counted = await countStagingFiltered(a, CO, U, true, true, true);
    expect(Number(sig.split(':')[0])).toBe(counted.sendCount);
    expect((await stagingSendSignature(a, CO, U, true, false)).split(':')[0]).toBe('3');
    expect((await stagingSendSignature(a, CO, U, false, false)).split(':')[0]).toBe('4');
    const b = randomUUID();
    for (const p of ['01000000002', '01000000003', '01000000001']) await put(b, p);
    expect(await stagingSendSignature(b, CO, U, true, true)).toBe(sig);
  });
  it('수가 같아도 사람이 바뀌면 다르다 · 합은 정확한 numeric(63비트 × 행 수가 bigint 를 넘어도)', async () => {
    const a = randomUUID();
    const b = randomUUID();
    for (const p of ['01000000011', '01000000012']) await put(a, p);
    for (const p of ['01000000011', '01000000013']) await put(b, p);
    const sa = await stagingSendSignature(a, CO, U, true, true);
    const sb = await stagingSendSignature(b, CO, U, true, true);
    expect(sa.split(':')[0]).toBe(sb.split(':')[0]);
    expect(sa).not.toBe(sb);
    expect(sa.split(':')[1]).toMatch(/^\d+$/);
  });
  it('중복 지우기 = 번호당 한 행 · 지운 수', async () => {
    const a = randomUUID();
    for (const p of ['01000000021', '01000000021', '01000000021', '01000000022']) await put(a, p);
    expect(await dedupStagingRows(a, CO)).toBe(2);
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE staging_id = $1::uuid`, [a]);
    expect(n.rows[0].n).toBe(2);
  });
});
