/**
 * 실 PG 시험층 안전문 · 실행기 env(★ 2026-10-27 설계서 §2-2 · §2-3 · DB 없음 · 회귀 주입 = 어긴 env 마다 실제로 멈추는가)
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPgTestEnv } from './pg/gate';
import { buildTestEnv, testPgPaths, TEST_ENV, pgTestUrl } from '../../../scripts/test-pg-env.mjs';

const cleanDir = (): string => mkdtempSync(join(tmpdir(), 'pgt-'));
const baseEnv = (): Record<string, string> => ({ ...buildTestEnv({ PATH: 'C:\\x', SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\L' }), VITEST: 'true', VITEST_POOL_ID: '1', NODE_ENV: 'test' });

describe('안전문 — 다 지키면 통과 · 하나라도 어기면 멈춘다', () => {
  it('실행기가 만든 env · .env 없는 cwd = 통과(작업자 t_ DB 도)', () => {
    expect(() => assertPgTestEnv(baseEnv(), cleanDir())).not.toThrow();
    expect(() => assertPgTestEnv({ ...baseEnv(), DATABASE_URL: pgTestUrl('t_f_1_ab12cd34') }, cleanDir())).not.toThrow();
  });
  it.each(['.env', '.env.local', '.env.test'])('cwd 에 %s 가 있으면 멈춘다', (name) => {
    const d = cleanDir();
    writeFileSync(join(d, name), 'X=1');
    expect(() => assertPgTestEnv(baseEnv(), d)).toThrow(/env 파일/);
  });
  it('실행기 표식이 없으면 멈춘다(실행기 우회)', () => {
    const env = baseEnv();
    delete env.TU_PG_RUN;
    expect(() => assertPgTestEnv(env, cleanDir())).toThrow(/TU_PG_RUN/);
  });
  it('허용 목록 밖 env 이름 하나(부모 셸 키 상속) = 멈춘다', () => {
    expect(() => assertPgTestEnv({ ...baseEnv(), OPENAI_API_KEY: 'sk-x' }, cleanDir())).toThrow(/OPENAI_API_KEY/);
    expect(() => assertPgTestEnv({ ...baseEnv(), JWT_SECRET: 'x' }, cleanDir())).toThrow(/JWT_SECRET/);
  });
  it.each([
    ['host localhost', 'postgres://postgres:tu_pgtest_local@localhost:56415/postgres'],
    ['운영 꼴 주소', 'postgres://targetup:x@127.0.0.1:5432/targetup'],
    ['다른 포트', 'postgres://postgres:tu_pgtest_local@127.0.0.1:5432/postgres'],
    ['t_ 아닌 DB', 'postgres://postgres:tu_pgtest_local@127.0.0.1:56415/targetup'],
    ['다른 암호', 'postgres://postgres:other@127.0.0.1:56415/postgres'],
    ['꼴 아님', 'not a url'],
  ])('DATABASE_URL %s = 멈춘다', (_n, url) => {
    expect(() => assertPgTestEnv({ ...baseEnv(), DATABASE_URL: url }, cleanDir())).toThrow(/안전문/);
  });
  it('MySQL · Redis 가 닿는 값이면 멈춘다', () => {
    expect(() => assertPgTestEnv({ ...baseEnv(), MYSQL_HOST: 'localhost' }, cleanDir())).toThrow(/MySQL/);
    expect(() => assertPgTestEnv({ ...baseEnv(), MYSQL_PORT: '3306' }, cleanDir())).toThrow(/MySQL/);
    expect(() => assertPgTestEnv({ ...baseEnv(), REDIS_URL: 'redis://localhost:6379' }, cleanDir())).toThrow(/Redis/);
  });
});

describe('실행기 env · 경로', () => {
  it('부모 env 의 운영 키 · 접속 값은 결과에 없다 · 결과 이름 ⊆ OS 이름 + 시험 값', () => {
    const env = buildTestEnv({ PATH: 'p', Path: 'p2', OPENAI_API_KEY: 'sk', DATABASE_URL: 'postgres://targetup@58.227.193.62/targetup', MYSQL_PASSWORD: 'real', LOCALAPPDATA: 'L' });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBe(TEST_ENV.DATABASE_URL);
    expect(env.MYSQL_PASSWORD).toBe(TEST_ENV.MYSQL_PASSWORD);
    expect(env.LOCALAPPDATA).toBe('L');
    expect(() => assertPgTestEnv({ ...env, VITEST: 'true' }, mkdtempSync(join(tmpdir(), 'pgt-')))).not.toThrow();
  });
  it('vitest 진입 · 설정 · cwd 는 실행기 기준 절대경로이고 실제로 있다', async () => {
    const { existsSync } = await import('node:fs');
    const { isAbsolute } = await import('node:path');
    const p = testPgPaths();
    for (const f of [p.vitestEntry, p.config, p.cwd]) {
      expect(isAbsolute(f)).toBe(true);
      expect(existsSync(f)).toBe(true);
    }
    expect(p.cwd.endsWith(join('backend', 'src'))).toBe(true);
    expect(existsSync(join(p.cwd, '.env'))).toBe(false);   // 이 cwd 에서는 dotenv 가 읽을 .env 가 없다
  });
});
