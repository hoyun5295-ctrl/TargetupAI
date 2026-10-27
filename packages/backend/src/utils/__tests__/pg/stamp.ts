/**
 * 스탬프 계약(★ 2026-10-27 설계서 §2-9 · D6)
 * test:pg 가 전부 통과하면 「pg 시험이 부르는 CT 파일의 해시」를 PC 에 적고, 짝 pg-mem 판이 지워진 뒤부터
 * 기본 시험(pg-test-stamp.test.ts)이 지금 해시와 대조한다 = 실 PG 시험층이 「안 불리는 검사」가 되지 않게.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, matchesGlob, posix, relative, sep } from 'node:path';
import ts from 'typescript';
import { sha256 } from './dump';

/** packages/backend 기준 경로 */
export const BACKEND_ROOT = join(__dirname, '..', '..', '..', '..');
const toPosix = (p: string): string => p.split(sep).join('/');

export type Replaces = { kind: 'none' } | { kind: 'path'; path: string };

/** 머리 한 줄 `// replaces: none` 또는 `// replaces: src/…/x.test.ts` · 없거나 꼴 밖 = null */
export function parseReplaces(text: string): Replaces | null {
  const m = /^\/\/ replaces: (\S+)\s*$/m.exec(text.split(/\r?\n/).slice(0, 5).join('\n'));
  if (!m) return null;
  return m[1] === 'none' ? { kind: 'none' } : { kind: 'path', path: m[1] };
}

/** 짝 경로 = 기본 시험이 실제로 모으는 파일 꼴(.test.ts · .pg.test.ts 아님 · 자기 아님 · 기본 include 안 · exclude 밖) */
export function replacesPathProblem(path: string, selfPath: string, include: string[], exclude: string[]): string | null {
  if (!path.endsWith('.test.ts') || path.endsWith('.pg.test.ts')) return '짝은 기본 시험(.test.ts · .pg.test.ts 아님)이어야 한다';
  if (path === selfPath) return '자기 자신을 가리킨다';
  if (!include.some((g) => matchesGlob(path, g))) return '기본 include 밖이다';
  if (exclude.some((g) => matchesGlob(path, g))) return '기본 exclude 에 걸린다';
  return null;
}

/**
 * pg 시험 파일의 상대 import 중 __tests__/ · config/database 밖의 CT(backend 기준 src/… .ts) · ponytail: 직접 import 만
 * 추출 = TypeScript 전처리기(따옴표 · import · export from · 동적 import · require 꼴을 다 안다 · 정규식으로 꼴을 고르다 빠지는 길 차단 · Codex 구현 R1 #5)
 */
export function ctImportsOf(pgTestPath: string, text: string): string[] {
  const dir = posix.dirname(pgTestPath);
  const resolveRel = (spec: string): string => posix.normalize(posix.join(dir, spec));
  const mocked = new Set([...text.matchAll(/vi\.mock\(\s*(['"`])(\.{1,2}\/[^'"`]+)\1/g)].map((m) => resolveRel(m[2])));   // 흉내 낸 모듈은 실 PG 가 보지 않는다
  const out = new Set<string>();
  for (const f of ts.preProcessFile(text, true, true).importedFiles) {
    if (!f.fileName.startsWith('./') && !f.fileName.startsWith('../')) continue;
    const p = resolveRel(f.fileName.replace(/\.(ts|js)$/, ''));
    if (mocked.has(p) || p.includes('/__tests__/') || p === 'src/config/database') continue;
    out.add(`${p}.ts`);
  }
  return [...out].sort();
}

export function listPgTests(root = BACKEND_ROOT): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.pg.test.ts')) found.push(toPosix(relative(root, p)));
    }
  };
  walk(join(root, 'src'));
  return found.sort();
}

export interface Stamp { at: string; files: Record<string, string> }

export function currentHashes(cts: string[], root = BACKEND_ROOT): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ct of cts) out[ct] = existsSync(join(root, ct)) ? sha256(readFileSync(join(root, ct), 'utf8')) : 'missing';
  return out;
}

/** 한 pg 시험 파일의 판정 · 실패면 이유 문장 · 통과면 null */
export function judgePgTest(opts: {
  pgTestPath: string; text: string; include: string[]; exclude: string[];
  replacedExists: (path: string) => boolean; stamp: () => Stamp | null; hashes: () => Record<string, string>;
}): string | null {
  const r = parseReplaces(opts.text);
  if (!r) return `${opts.pgTestPath}: 머리에 「// replaces: none」 또는 「// replaces: <짝 기본 시험 경로>」 가 없다`;
  if (r.kind === 'path') {
    const problem = replacesPathProblem(r.path, opts.pgTestPath, opts.include, opts.exclude);
    if (problem) return `${opts.pgTestPath}: replaces 가 잘못 가리킨다(${r.path} · ${problem})`;
    if (opts.replacedExists(r.path)) return null;   // 짝 pg-mem 판이 push 전 시험을 지킨다
  }
  const stamp = opts.stamp();
  if (!stamp) return `${opts.pgTestPath}: 실 PG 통과 스탬프가 없다 · npm run test:pg 를 돌린 뒤 push`;
  const hashes = opts.hashes();
  if (Object.keys(hashes).length === 0) return `${opts.pgTestPath}: 실 PG 가 보는 CT import 를 하나도 못 뽑았다(판정 불가)`;
  for (const [ct, h] of Object.entries(hashes)) {
    if (h === 'missing') return `${opts.pgTestPath}: import 한 CT 파일이 없다(${ct})`;
    if (stamp.files[ct] !== h) return `${opts.pgTestPath}: 실 PG 시험 대상 CT 가 바뀌었다(${ct}) · npm run test:pg 를 돌린 뒤 push`;
  }
  return null;
}

export function readStamp(file: string): Stamp | null {
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, 'utf8'));
  return s && typeof s.files === 'object' ? (s as Stamp) : null;
}

export function writeStamp(file: string, stamp: Stamp): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(stamp, null, 2));
}

/** 지금 저장소의 pg 시험 전부 → 스탬프에 적을 CT 해시(reporter 가 통과 뒤 쓴다) */
export function stampForAll(root = BACKEND_ROOT): Record<string, string> {
  const files: Record<string, string> = {};
  for (const t of listPgTests(root)) Object.assign(files, currentHashes(ctImportsOf(t, readFileSync(join(root, t), 'utf8')), root));
  return files;
}
