/**
 * test:pg 보고 줄 · 스탬프(★ 2026-10-27 설계서 §2-8 · §2-9) — 사람은 이 줄을 완료 보고 · Codex 요청문 ① 에 그대로 옮긴다.
 * 전부 통과했을 때만 스탬프를 쓴다(하나라도 실패 · 건너뜀 · 수집 오류면 쓰지 않는다).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter, TestModule } from 'vitest/node';
import { pgTestDir, parseSchemaMeta, PROD_PG_VERSION } from './dump';
import { listPgTests, stampForAll, writeStamp, BACKEND_ROOT } from './stamp';
import { relative, sep } from 'node:path';
import { LEDGER_PATH } from './global-setup';
import { parseLedger } from '../../../../scripts/deploy-ledger-lib.mjs';

export default class PgReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<unknown>, reason: string): void {
    const tests = testModules.flatMap((m) => [...m.children.allTests()]);
    const passed = tests.filter((t) => t.result().state === 'passed').length;
    // 스탬프 = 저장소의 pg 시험 전부가 이번에 돌았고 전부 통과했을 때만(파일 필터로 일부만 돌린 실행은 안 씀 · Codex 구현 R1 #1)
    const ran = new Set(testModules.map((m) => relative(BACKEND_ROOT, m.moduleId).split(sep).join('/')));
    const all = listPgTests();
    const fullSet = all.length > 0 && all.length === ran.size && all.every((f) => ran.has(f));
    const allPassed = reason === 'passed' && unhandledErrors.length === 0 && fullSet
      && testModules.every((m) => m.ok()) && tests.length > 0 && passed === tests.length;
    const dir = pgTestDir();
    const metaFile = join(dir, 'schema.meta.json');
    const meta = existsSync(metaFile) ? parseSchemaMeta(readFileSync(metaFile, 'utf8')) : null;
    let ledgerHead: Record<string, string> = {};
    let applied = 0;
    try {
      const ledger = parseLedger(readFileSync(LEDGER_PATH, 'utf8'));
      ledgerHead = ledger.head;
      applied = ledger.blocks.filter((b: any) => b.section === 'applied').length;
    } catch { /* 원장 오류는 globalSetup 이 이미 실패로 냈다 */ }
    if (allPassed) writeStamp(join(dir, 'last-pass.json'), { at: new Date().toISOString(), files: stampForAll() });
    console.log(`실 PG(${PROD_PG_VERSION}) ${testModules.length}파일 ${passed}건 ${allPassed ? '통과' : `실패(통과 ${passed}/${tests.length})`} · 운영 규모 · 성능 · 데이터 분포는 이 시험 밖`
      + ` · 덤프 ${meta?.at ?? '없음'} · 덤프 뒤 적용 DDL ${applied} · 마지막 해시 대조 ${ledgerHead['마지막 해시 대조'] || '없음'}`
      + (allPassed ? ' · 스탬프 기록' : fullSet ? ' · 스탬프 안 씀' : ` · 스탬프 안 씀(일부만 실행 ${ran.size}/${all.length})`));
  }
}
