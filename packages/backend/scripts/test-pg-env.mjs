// 실 PG 시험층 · 그릇 · 환경의 유일한 주인(★ 2026-10-27 설계서 docs/2026-10-27-real-pg-test-deploy-ledger-design.md §2-1 · §2-2 · §2-3)
//
// 그릇 = Harold 님이 이 PC 에서 1회 띄우는 컨테이너 하나. AI 는 기동 · 종료하지 않는다(그 안의 t_ DB 만 · 설계서 D1).
//   docker run -d --name tu-pgtest --restart unless-stopped --memory 1g --cpus 2 -e POSTGRES_PASSWORD=tu_pgtest_local -e TZ=Etc/UTC -p 127.0.0.1:56415:5432 --tmpfs /var/lib/postgresql/data:rw,size=512m postgres:15.15 -c shared_buffers=64MB -c fsync=off -c synchronous_commit=off -c full_page_writes=off
// 멈춰 있으면 = docker start tu-pgtest (Harold 님)
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PG_TEST_CONTAINER = 'tu-pgtest';
export const PG_TEST_PORT = 56415;
export const PG_TEST_PASSWORD = 'tu_pgtest_local';   // 이 그릇 전용 시험 값 · 127.0.0.1 만 받는다 · 운영 값과 무관
export const PG_TEST_START_HINT = `docker start ${PG_TEST_CONTAINER}`;

export function pgTestUrl(db) {
  return `postgres://postgres:${PG_TEST_PASSWORD}@127.0.0.1:${PG_TEST_PORT}/${db}`;
}

/** 부모 셸에서 물려주는 OS 이름(이것 밖은 시험 프로세스에 안 간다 · 운영 키 · 토큰 상속 차단 · Codex R1 #1) */
export const OS_ENV_NAMES = [
  'PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'ComSpec', 'windir', 'TEMP', 'TMP',
  'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'OS',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'USERNAME', 'USERDOMAIN', 'LOGONSERVER',   // Windows 가 자식 프로세스에 스스로 넣는다(1027 실측 · 계정 이름 · 비밀 아님)
];

/** 시험 값 = 닿지 않는 곳 · DATABASE_URL 은 작업자가 시험 파일마다 t_f_ DB 로 바꾼다 */
export const TEST_ENV = {
  DATABASE_URL: pgTestUrl('postgres'),
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: '9',
  MYSQL_PASSWORD: PG_TEST_PASSWORD,
  REDIS_URL: 'redis://127.0.0.1:9',
  DB_POOL_MAX: '5',
  TZ: 'Etc/UTC',
  TU_PG_RUN: '1',
};

/** vitest · vite 가 스스로 넣는 이름(vitest 4.1.12 · vite 8.3.5 · 1027 실측) · 접두 VITEST_ 는 vitest 내부 이름
 *  vite 의 env 파일 읽기는 vitest.pg.config.ts envDir: false 로 끈다(VITE_ 접두를 통째로 열지 않는다) */
export const RUNNER_ENV_NAMES = ['VITEST', 'TEST', 'NODE_ENV', 'BASE_URL', 'DEV', 'PROD', 'MODE', 'SSR', 'VITE_USER_NODE_ENV', 'FORCE_TTY', 'FORCE_COLOR'];

/** env 이름이 허용 목록 안인가(안전문 조건 4 와 같은 판정) */
export function isAllowedEnvName(name) {
  if (OS_ENV_NAMES.some((n) => n.toUpperCase() === name.toUpperCase())) return true;
  if (Object.prototype.hasOwnProperty.call(TEST_ENV, name)) return true;
  if (RUNNER_ENV_NAMES.includes(name) || name.startsWith('VITEST_')) return true;
  return /^=[A-Za-z]:$/.test(name);   // Windows 가 자식에 남기는 드라이브별 현재 폴더 표시(값 = 경로)
}

/** 부모 env 에서 OS 이름만 골라 시험 값을 얹는다(Windows env 이름은 대소문자를 가리지 않는다) */
export function buildTestEnv(parentEnv) {
  const out = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (v !== undefined && OS_ENV_NAMES.some((n) => n.toUpperCase() === k.toUpperCase())) out[k] = v;
  }
  return { ...out, ...TEST_ENV };
}

/** 경로는 이 파일 위치 기준 절대경로(자식 cwd = src 라 상대경로는 엉뚱한 곳을 가리킨다 · Codex R2 #1) */
export function testPgPaths() {
  const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return {
    backend,
    vitestEntry: join(backend, 'node_modules', 'vitest', 'vitest.mjs'),
    config: join(backend, 'vitest.pg.config.ts'),
    cwd: join(backend, 'src'),
  };
}
