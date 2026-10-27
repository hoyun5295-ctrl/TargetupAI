/**
 * 시험 그릇의 관리 연결(postgres DB) — 받는 문장은 허용 목록뿐(★ 2026-10-27 설계서 §2-4 · 설계서 D1 허가 범위 = t_ DB 생성 · 삭제)
 */
import { Client } from 'pg';
import { pgTestUrl } from '../../../../scripts/test-pg-env.mjs';

const EXEC_ALLOWED = /^(CREATE DATABASE t_[a-z0-9_]+( TEMPLATE t_tpl(_closed|_after)?)?|DROP DATABASE IF EXISTS t_[a-z0-9_]+( WITH \(FORCE\))?|COMMENT ON DATABASE t_tpl(_closed|_after)? IS '[0-9a-f]{64}')$/;

export const ADMIN_SELECTS = {
  version: 'SHOW server_version',
  timezone: 'SHOW TimeZone',
  databases: "SELECT datname, datcollate, shobj_description(oid, 'pg_database') AS note FROM pg_database WHERE datname LIKE 't\\_%' OR datname = 'postgres'",
} as const;

export function assertAdminExec(sql: string): void {
  if (!EXEC_ALLOWED.test(sql)) throw new Error(`[test:pg 관리 연결] 허용 목록 밖 문장 = ${sql}`);
}

export interface Admin {
  exec(sql: string): Promise<void>;
  select(name: keyof typeof ADMIN_SELECTS): Promise<any[]>;
}

export async function withAdmin<T>(work: (admin: Admin) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: pgTestUrl('postgres') });
  await client.connect();
  try {
    return await work({
      exec: async (sql) => { assertAdminExec(sql); await client.query(sql); },
      select: async (name) => (await client.query(ADMIN_SELECTS[name])).rows,
    });
  } finally {
    await client.end().catch(() => undefined);
  }
}
