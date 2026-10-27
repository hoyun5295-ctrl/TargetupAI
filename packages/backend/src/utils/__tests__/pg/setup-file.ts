/**
 * test:pg 작업자 setupFiles(★ 2026-10-27 설계서 §2-7) — 시험 파일마다 t_tpl_closed 사본 하나 · 끝나면 지운다.
 * config/database 의 Pool 은 import 때 DATABASE_URL 을 읽으므로, 이 파일이 시험 파일보다 먼저 env 를 그 사본으로 둔다.
 */
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { afterAll } from 'vitest';
import { assertPgTestEnv } from './gate';
import { withAdmin } from './admin';
import { pgTestUrl } from '../../../../scripts/test-pg-env.mjs';

assertPgTestEnv(process.env, process.cwd());
try {
  os.setPriority(process.pid, os.constants.priority.PRIORITY_LOW);
} catch { /* 우선순위를 못 바꿔도 시험은 돈다 */ }

const db = `t_f_${String(process.env.VITEST_POOL_ID ?? '0').replace(/\D/g, '')}_${randomBytes(4).toString('hex')}`;
for (let attempt = 1; ; attempt++) {
  try {
    await withAdmin((a) => a.exec(`CREATE DATABASE ${db} TEMPLATE t_tpl_closed`));
    break;
  } catch (err: any) {
    if (err?.code !== '55006' || attempt >= 10) throw err;   // 다른 작업자가 같은 template 을 복사 중
    await new Promise((r) => setTimeout(r, 200 * attempt));
  }
}
process.env.DATABASE_URL = pgTestUrl(db);
assertPgTestEnv(process.env, process.cwd());

afterAll(async () => {
  const { pool } = await import('../../../config/database');
  await pool.end().catch(() => undefined);
  await withAdmin((a) => a.exec(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`));
});
