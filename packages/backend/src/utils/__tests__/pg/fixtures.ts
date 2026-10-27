/**
 * 실 PG 시험의 최소 행(★ 2026-10-27 설계서 §2-7) — 칸 목록은 손으로 적지 않고 덤프 표의 information_schema 에서 읽는다
 * (NOT NULL · 기본값 없음 · 생성 칸 아님 = 형에 맞는 빈 값). CHECK 에 걸리면 그 칸만 values 로 넘긴다.
 */
import type { Pool, PoolClient } from 'pg';

const EMPTY_BY_TYPE: Record<string, string> = {
  uuid: 'gen_random_uuid()', text: "''", varchar: "''", bpchar: "''", int2: '0', int4: '0', int8: '0', numeric: '0',
  float4: '0', float8: '0', bool: 'false', timestamptz: 'now()', timestamp: 'now()', date: 'current_date', jsonb: "'{}'", json: "'{}'",
};

export async function insertMinimalRow(db: Pool | PoolClient, table: string, values: Record<string, unknown>): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`표 이름 꼴 = ${table}`);
  const { rows } = await db.query(
    `SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL
        AND is_generated = 'NEVER' AND is_identity = 'NO'`,
    [table],
  );
  const cols: string[] = [];
  const exprs: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error(`칸 이름 꼴 = ${k}`);
    params.push(v);
    cols.push(k);
    exprs.push(`$${params.length}`);
  }
  for (const r of rows) {
    if (cols.includes(r.column_name)) continue;
    const empty = r.udt_name.startsWith('_') ? "'{}'" : EMPTY_BY_TYPE[r.udt_name];
    if (!empty) throw new Error(`${table}.${r.column_name}(${r.udt_name}) 의 빈 값을 모른다 · values 로 넘긴다`);
    cols.push(r.column_name);
    exprs.push(empty);
  }
  await db.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${exprs.join(', ')})`, params);
}
