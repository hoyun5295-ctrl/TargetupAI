// replaces: none
/**
 * C109 P1 — 대행 글자 정리 이력 · 승인 요청 줄 읽기 SQL(실 PostgreSQL 판 · ★ 2026-11-06 설계서 docs/2026-11-06-b1106-1-unsupported-char-design.md §6 · §9 P1)
 *   새 칸 · 새 표 0(DDL 0) · 새 SQL = readAgencyCharLines(종류마다 가장 최근 한 줄) · 쓰기 = logCharCleanedTx(트랜잭션 안 · 실패를 삼키지 않는다).
 *   볼 것: 칸 존재(information_schema) · 종류마다 가장 최근 · 다른 접수 0 · 문안 수정이 명단 이력을 지우지 않는다 · 연속 수정 = 마지막 줄 ·
 *          이력 쓰기 실패 = 같은 트랜잭션의 문안 수정째 롤백.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { logCharCleanedTx } from '../agency-send-intake';
import { readAgencyCharLines } from '../agency-send-worker';

const CO = '00000000-0000-0000-0000-0000000c1106';
const R1 = '00000000-0000-0000-0000-0000000a1106';
const R2 = '00000000-0000-0000-0000-0000000b1106';

/** 운영과 같은 꼴 = 연결 하나 + BEGIN · COMMIT(createRequestCore · editAgencyContentTx 가 client 를 넘긴다) · 던지면 ROLLBACK */
async function tx(work: (c: any) => Promise<void>): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await work(c);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  for (const id of [R1, R2]) {
    await insertMinimalRow(pool, 'agency_send_requests', { id, company_id: CO, current_content: '여름 세일 %이름%님', original_content: '여름 세일 %이름%님' });
  }
});

describe('P1 대행 글자 정리 이력(실 PG)', () => {
  it('이력 표 칸이 있다(information_schema · 새 SQL 이 읽는 칸)', async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agency_send_events' ORDER BY column_name`,
    );
    const cols = r.rows.map((x: any) => String(x.column_name));
    for (const c of ['request_id', 'kind', 'payload', 'created_at']) expect(cols).toContain(c);
  });

  it('접수 = 두 종류를 같은 트랜잭션에 · 승인 요청 줄 = 종류마다 한 줄 · 다른 접수 0', async () => {
    await tx(async (c: any) => {
      await logCharCleanedTx(c, R1, { content: ["2번째 줄 '여름 세일' 뒤 이모지(U+1F60A)", "제목 맨 앞 보이지 않는 글자(U+200B)"], recipients: { count: 4, examples: ["명단 3행 이름 칸 '가' 뒤 이모지(U+1F60A)"] } });
    });
    expect(await readAgencyCharLines(R1)).toEqual([
      "보낼 수 없는 글자를 빼고 보냅니다: 2번째 줄 '여름 세일' 뒤 이모지(U+1F60A), 외 1곳",
      "명단에서 보낼 수 없는 글자를 빼고 보냅니다: 명단 3행 이름 칸 '가' 뒤 이모지(U+1F60A), 외 3곳",
    ]);
    expect(await readAgencyCharLines(R2)).toEqual([]);
  });

  it('문안 수정 = 빈 줄로 문안 이력을 덮고 명단 이력은 그대로 · 연속 수정 = 마지막 줄', async () => {
    await tx(async (c: any) => {
      await logCharCleanedTx(c, R1, { content: [], recipients: { count: 0, examples: [] } }, { forceContent: true, contentOnly: true });
    });
    expect(await readAgencyCharLines(R1)).toEqual([
      "명단에서 보낼 수 없는 글자를 빼고 보냅니다: 명단 3행 이름 칸 '가' 뒤 이모지(U+1F60A), 외 3곳",
    ]);
    await tx(async (c: any) => {
      await logCharCleanedTx(c, R1, { content: ["맨 앞 이모지(U+1F389)"], recipients: { count: 0, examples: [] } }, { forceContent: true, contentOnly: true });
    });
    expect((await readAgencyCharLines(R1))[0]).toBe('보낼 수 없는 글자를 빼고 보냅니다: 맨 앞 이모지(U+1F389)');
  });

  it('이력 쓰기 실패 = 같은 트랜잭션의 문안 수정째 롤백(문안 그대로)', async () => {
    const before = (await pool.query(`SELECT current_content FROM agency_send_requests WHERE id = $1::uuid`, [R2])).rows[0].current_content;
    await expect(tx(async (c: any) => {
      await c.query(`UPDATE agency_send_requests SET current_content = '고친 글' WHERE id = $1::uuid`, [R2]);
      await logCharCleanedTx(c, 'not-a-uuid', { content: ['x'], recipients: { count: 0, examples: [] } }, { forceContent: true, contentOnly: true });
    })).rejects.toThrow();
    const after = (await pool.query(`SELECT current_content FROM agency_send_requests WHERE id = $1::uuid`, [R2])).rows[0].current_content;
    expect(after).toBe(before);
    expect(await readAgencyCharLines(R2)).toEqual([]);
  });
});
