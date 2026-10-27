// npm run test:pg — 실 PG 시험층 실행기(★ 2026-10-27 설계서 §2-2)
// env 를 허용 목록으로 새로 만들고(부모 셸 env 를 물려주지 않음) cwd = src(.env 없음)에서 vitest 를 자식으로 띄운다.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { buildTestEnv, testPgPaths } from './test-pg-env.mjs';

const paths = testPgPaths();
for (const p of [paths.vitestEntry, paths.config, paths.cwd]) {
  if (!existsSync(p)) {
    console.error(`[test:pg] 없음: ${p}`);
    process.exit(1);
  }
}

const child = spawn(process.execPath, [paths.vitestEntry, 'run', '--config', paths.config, ...process.argv.slice(2)], {
  cwd: paths.cwd,
  env: buildTestEnv(process.env),
  stdio: 'inherit',
});
try {
  os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW);   // Harold 님 노트북 부담(작업자는 setup-file 에서 한 번 더)
} catch { /* 우선순위를 못 바꿔도 시험은 돈다 */ }
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
