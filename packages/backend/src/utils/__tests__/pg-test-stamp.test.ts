/**
 * 스탬프 계약(★ 2026-10-27 설계서 §2-9 · D6 · DB 없음 · push 전 시험)
 * 짝 pg-mem 판이 지워진 pg 시험은 「그 시험이 부르는 CT 해시」가 마지막 test:pg 통과 때와 같아야 한다.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNIT_INCLUDE, UNIT_EXCLUDE } from '../../../vitest.globs';
import { BACKEND_ROOT, ctImportsOf, currentHashes, judgePgTest, listPgTests, parseReplaces, readStamp, replacesPathProblem } from './pg/stamp';
import { pgTestDir } from './pg/dump';

const SELF = 'src/utils/__tests__/x.pg.test.ts';
const judge = (text: string, o: { exists?: boolean; stamp?: any; hashes?: Record<string, string> } = {}) => judgePgTest({
  pgTestPath: SELF, text, include: UNIT_INCLUDE, exclude: UNIT_EXCLUDE,
  replacedExists: () => o.exists ?? false, stamp: () => o.stamp ?? null, hashes: () => o.hashes ?? { 'src/utils/a.ts': 'h1' },
});
const STAMP = { at: 'x', files: { 'src/utils/a.ts': 'h1' } };

describe('판정 함수', () => {
  it('none + 스탬프 맞음 = 통과 · none + 없음 · 다름 = 실패', () => {
    expect(judge('// replaces: none', { stamp: STAMP })).toBeNull();
    expect(judge('// replaces: none')).toMatch(/스탬프가 없다/);
    expect(judge('// replaces: none', { stamp: { at: 'x', files: { 'src/utils/a.ts': 'old' } } })).toMatch(/바뀌었다/);
  });
  it('짝이 있으면 스탬프를 요구하지 않는다 · 짝이 없으면(지움 · 이름 바뀜) 요구', () => {
    const t = '// replaces: src/utils/__tests__/x.test.ts';
    expect(judge(t, { exists: true })).toBeNull();
    expect(judge(t, { exists: false })).toMatch(/스탬프가 없다/);
    expect(judge(t, { exists: false, stamp: STAMP })).toBeNull();
  });
  it.each([
    ['줄 없음', '/** x */', /replaces: none/],
    ['자기 참조', `// replaces: ${SELF}`, /\.pg\.test\.ts 아님|자기/],
    ['.pg.test.ts 를 가리킴', '// replaces: src/utils/__tests__/y.pg.test.ts', /\.pg\.test\.ts 아님/],
    ['기본 exclude 에 걸림', '// replaces: src/node_modules/z.test.ts', /exclude/],
    ['기본 include 밖', '// replaces: scripts/z.test.ts', /include/],
    ['꼴 밖 값', '// replaces: src/utils/a.ts', /\.test\.ts/],
  ])('%s = 실패(짝이 있어도)', (_n, text, re) => {
    expect(judge(text as string, { exists: true, stamp: STAMP })).toMatch(re as RegExp);
  });
  it('CT import 를 하나도 못 뽑으면 판정 불가 = 실패 · CT 파일이 없으면 실패', () => {
    expect(judge('// replaces: none', { stamp: STAMP, hashes: {} })).toMatch(/판정 불가/);
    expect(judge('// replaces: none', { stamp: STAMP, hashes: { 'src/utils/a.ts': 'missing' } })).toMatch(/없다/);
  });
  it('import 추출 = 상대 import 중 vi.mock · __tests__ · config/database 밖 · 따옴표 · 꼴 무관', () => {
    const text = `import { a } from '../a';\nimport { pool } from '../../config/database';\nimport { f } from './pg/fixtures';\nvi.mock("../b", () => ({}));\nimport { b } from '../b';\nimport('../c');\nimport { d } from "../d";\nexport { e } from '../e';\nconst g = require('../g');\nimport type { T } from 'pg';`;
    expect(ctImportsOf('src/utils/__tests__/x.pg.test.ts', text)).toEqual(['src/utils/a.ts', 'src/utils/c.ts', 'src/utils/d.ts', 'src/utils/e.ts', 'src/utils/g.ts']);
  });
  it('첫 판의 실제 추출 = 선점 CT · 재처리 워커(흉내 낸 provider · system-alert 는 빠짐)', () => {
    const f = 'src/utils/__tests__/cdp-webhook-claim-1027.pg.test.ts';
    expect(ctImportsOf(f, readFileSync(join(BACKEND_ROOT, f), 'utf8'))).toEqual(['src/utils/cdp-webhook-delivery.ts', 'src/utils/cdp-webhook-retry-worker.ts']);
  });
  it('parseReplaces = 머리 5줄 안에서만', () => {
    expect(parseReplaces('// replaces: none\n')).toEqual({ kind: 'none' });
    expect(parseReplaces('\n\n\n\n\n// replaces: none')).toBeNull();
    expect(replacesPathProblem('src/utils/__tests__/k.test.ts', SELF, UNIT_INCLUDE, UNIT_EXCLUDE)).toBeNull();
  });
});

describe('실제 저장소 대조(push 전)', () => {
  const files = listPgTests();
  it('pg 시험 파일이 기계로 뽑힌다(첫 판 포함)', () => {
    expect(files).toContain('src/utils/__tests__/cdp-webhook-claim-1027.pg.test.ts');
  });
  it.each(files)('%s', (f) => {
    const text = readFileSync(join(BACKEND_ROOT, f), 'utf8');
    const problem = judgePgTest({
      pgTestPath: f, text, include: UNIT_INCLUDE, exclude: UNIT_EXCLUDE,
      replacedExists: (p) => existsSync(join(BACKEND_ROOT, p)),
      stamp: () => readStamp(join(pgTestDir(), 'last-pass.json')),
      hashes: () => currentHashes(ctImportsOf(f, text)),
    });
    expect(problem).toBeNull();
  });
});
