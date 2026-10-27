/**
 * 실 PG 시험층 안전문(★ 2026-10-27 설계서 docs/2026-10-27-real-pg-test-deploy-ledger-design.md §2-3 · fail-closed)
 * globalSetup(주 프로세스)과 setup-file(작업자마다) 첫 줄에서 부른다. 하나라도 어기면 throw.
 */
import { readdirSync } from 'node:fs';
import { isAllowedEnvName, PG_TEST_PASSWORD, PG_TEST_PORT } from '../../../../scripts/test-pg-env.mjs';

const DB_NAME = /^(postgres|t_[a-z0-9_]+)$/;

export function assertPgTestEnv(env: Record<string, string | undefined>, cwd: string): void {
  const fail = (why: string): never => {
    throw new Error(`[test:pg 안전문] ${why} · npm run test:pg 로만 돌린다`);
  };
  const envFiles = readdirSync(cwd).filter((f) => /^\.env/i.test(f));
  if (envFiles.length) fail(`cwd 에 env 파일이 있다(${cwd} · ${envFiles.join(', ')})`);
  if (env.TU_PG_RUN !== '1') fail('실행기 표식(TU_PG_RUN) 없음');
  const unknown = Object.keys(env).filter((k) => !isAllowedEnvName(k));
  if (unknown.length) fail(`허용 목록 밖 env 이름 = ${unknown.sort().join(', ')}`);
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? '');
  } catch {
    return fail('DATABASE_URL 꼴이 아니다');
  }
  if (url.protocol !== 'postgres:' || url.hostname !== '127.0.0.1' || url.port !== String(PG_TEST_PORT)
    || url.username !== 'postgres' || decodeURIComponent(url.password) !== PG_TEST_PASSWORD || url.search || url.hash) {
    fail(`DATABASE_URL 이 시험 그릇(127.0.0.1:${PG_TEST_PORT})이 아니다`);
  }
  if (!DB_NAME.test(url.pathname.slice(1))) fail(`DB 이름이 t_ 시험 DB 가 아니다(${url.pathname.slice(1)})`);
  if (env.MYSQL_HOST !== '127.0.0.1' || env.MYSQL_PORT !== '9') fail('MySQL 접속 값이 닿지 않는 시험 값이 아니다');
  if (env.REDIS_URL !== 'redis://127.0.0.1:9') fail('Redis 접속 값이 닿지 않는 시험 값이 아니다');
}
