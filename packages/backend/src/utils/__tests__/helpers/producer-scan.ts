/**
 * 고객 글 생산자 뽑기 공용 도우미(★ 2026-10-28 AI 메모리 설계 K15-2 · R24)
 *
 * 뿌리 대장 R13 단위 뽑기(utils/__tests__/root-ledger.test.ts · 구문 트리 단위 · 자기 몸통 · import 바인딩 풀이)를 글자 그대로 옮겨 온 것.
 * 바뀐 곳 = 내보내기 · 도달 대상 CT 이름을 인자로 받는 것(기본 = 효능 CT = R13 과 같은 판정) 둘뿐.
 * root-ledger.test.ts 는 다른 트랙의 미커밋 변경이 있어 이번에 손대지 않았다 · 그 트랙 커밋 뒤 R13 도 이 도우미를 부르게 옮긴다(설계서 §10).
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

export const BE = join(__dirname, '..', '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
export const be = (rel: string) => read(join(BE, rel));

/** 소스 파일 전수(시험 · 빌드 산출물 제외) */
export function sourceFiles(root: string, ext: RegExp): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => ext.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.(test|spec|verify)\.tsx?$/.test(f) && !/(^|\/)(dist|dist-old|node_modules)\//.test(f));
}

/** 주석을 걷는다(줄 주석 · 블록 주석 · JSX 주석). 문자열 속 '//'(주소)도 걷히지만 찾는 쪽이 줄기만 한다(놓치는 쪽 아님). */
export function stripComments(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

export const EFFICACY_CT = ['claimsEfficacy', 'claimsInventedEfficacy', 'dropInventedEfficacy\\w*', 'pairClaimsInventedEfficacy', 'rewriteAddsFacts', 'headlineClaimsEfficacy', 'guardReadingSequence'];
export const BENEFIT_CT = ['findInventedBenefits', 'replaceInventedBenefits\\w*', 'copyFactsExistInText', 'stripUnauthorizedBenefits', 'findNewNumbers'];
export interface FnUnit { key: string; file: string; name: string | null; body: string; start: number; end: number }
const RAW_AI_RE = /\bcallAIWithFallback\(|\bmessages(?:\s+as\s+any\))?\.(?:batches\.)?create\(/;
const RAW_AI_CALLEE_RE = /^(?:callAIWithFallback|.*\bmessages(?:\s+as\s+any\))?\)?\.(?:batches\.)?create)$/;
/**
 * ★ 1024 ② Codex 1R — 단위 = **구문 트리**로 뽑는다(정규식 선언 자르기는 클래스 메서드 · 이름 없는 기본 내보내기를 앞 함수에 섞었고 라우터는 파일째였다).
 *   이름 있는 함수 · 변수에 담은 함수 · 클래스 메서드 · 객체 속성 함수 · 기본 내보내기 · 라우터 주소 처리기(파일:방법 경로).
 * ★ Codex 2R — 단위의 글 = **자기 몸통**(안쪽 단위의 글을 뺀다). 안쪽 함수의 검사 · AI 호출이 바깥 단위를 통과시키지 않고,
 *   AI 호출은 그것을 품은 가장 안쪽 단위에 귀속한다. 인자로 넘긴 이름 없는 콜백은 그 자리에서 도는 바깥 단위의 몸통이다.
 */
export type ImportMap = Map<string, { file: string; name: string }>;
/** 상대 경로 import → 파일 키(utils/x.ts · 폴더면 index.ts) */
function importTarget(file: string, spec: string): string {
  const parts = file.split('/').slice(0, -1);
  for (const seg of spec.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');   // 확장자 없는 키 · resolve 가 .ts · /index.ts 를 붙여 찾는다
}
export function unitsOfSource(file: string, text: string): { units: FnUnit[]; aiCalls: number[]; wrapperRefs: Array<{ name: string; pos: number }>; imports: ImportMap } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const units: FnUnit[] = [];
  const aiCalls: number[] = [];
  const wrapperRefs: Array<{ name: string; pos: number }> = [];
  const imports: ImportMap = new Map();
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const push = (key: string, name: string | null, node: ts.Node) => units.push({ key: `${file}#${key}`, file, name, body: '', start: node.getStart(sf), end: node.getEnd() });
  const isFn = (n: ts.Node | undefined): boolean => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
  const visit = (node: ts.Node): void => {
    // ★ Codex 4R — import 바인딩(별칭 포함 · 상대 경로만 · 이름 풀이가 실제 바인딩을 따른다)
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')
      && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const target = importTarget(file, node.moduleSpecifier.text);
      for (const el of node.importClause.namedBindings.elements) imports.set(el.name.text, { file: target, name: (el.propertyName ?? el.name).text });
    }
    if (ts.isFunctionDeclaration(node) && node.body) push(node.name ? node.name.text : `default@${lineOf(node)}`, node.name ? node.name.text : null, node);
    else if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && node.body) {
      const owner = ts.isClassLike(node.parent) && node.parent.name ? node.parent.name.text : `object@${lineOf(node)}`;
      push(`${owner}.${node.name.getText(sf)}`, node.name.getText(sf), node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFn(node.initializer)) push(node.name.text, node.name.text, node);
    // ★ 2026-10-25 — 호출 인자로 넘긴 객체의 콜백 속성(runChargedAi({ run: () => … }) 꼴)은 그 자리에서 도는 바깥 단위의 몸통이다(위 설계 · 이름 없는 콜백과 같다)
    else if (ts.isPropertyAssignment(node) && isFn(node.initializer) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
      && !(ts.isObjectLiteralExpression(node.parent) && ts.isCallExpression(node.parent.parent))) push(`${node.name.text}@${lineOf(node)}`, node.name.text, node);
    else if (ts.isExportAssignment(node) && isFn(node.expression)) push(`default@${lineOf(node)}`, null, node);
    else if (file.startsWith('routes/') && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && /^(get|post|put|patch|delete)$/.test(node.expression.name.text) && node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[0])) {
      push(`${node.expression.name.text.toUpperCase()} ${node.arguments[0].text}`, null, node);
    }
    if (ts.isCallExpression(node) && RAW_AI_CALLEE_RE.test(node.expression.getText(sf).replace(/\s+/g, ' '))) aiCalls.push(node.getStart(sf));
    // 래퍼 참조(부르기 · 값으로 넘기기) 후보 — 선언 이름 · import · export · 타입 자리는 아니다(래퍼 집합과는 scanSources 가 대조)
    if (ts.isIdentifier(node) && /^call[A-Z]\w*$/.test(node.text)
      && !(ts.isFunctionDeclaration(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isImportSpecifier(node.parent) || ts.isExportSpecifier(node.parent) || ts.isTypeQueryNode(node.parent))) {
      wrapperRefs.push({ name: node.text, pos: node.getStart(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // 자기 몸통 = 제 범위에서 안쪽 단위 범위를 뺀 글(겹친 범위는 합친다)
  for (const u of units) {
    const inner = units.filter((o) => o !== u && o.start >= u.start && o.end <= u.end && (o.start > u.start || o.end < u.end)).sort((a, b) => a.start - b.start);
    let pos = u.start;
    let own = '';
    for (const o of inner) {
      if (o.start < pos) { pos = Math.max(pos, o.end); continue; }
      own += text.slice(pos, o.start);
      pos = o.end;
    }
    own += text.slice(pos, u.end);
    u.body = stripComments(own);
  }
  return { units, aiCalls, wrapperRefs, imports };
}
interface SourceScan { units: FnUnit[]; uncovered: string[]; imports: Map<string, ImportMap> }
let scanCache: SourceScan | null = null;
/** 전 소스 단위 + 어느 단위에도 덮이지 않은 AI 호출(파일:줄 · 0 이어야 한다) */
export function scanSources(): SourceScan {
  if (scanCache) return scanCache;
  const units: FnUnit[] = [];
  const importsByFile = new Map<string, ImportMap>();
  const pending: Array<{ file: string; text: string; units: FnUnit[]; aiCalls: number[]; wrapperRefs: Array<{ name: string; pos: number }> }> = [];
  for (const dir of ['utils', 'services', 'routes']) {
    for (const rel of sourceFiles(join(BE, dir), /\.ts$/)) {
      const file = `${dir}/${rel}`;
      const text = be(file);
      const r = unitsOfSource(file, text);
      units.push(...r.units);
      importsByFile.set(file, r.imports);
      pending.push({ file, text, ...r });
    }
  }
  const wrappers = wrappersOf(units);
  const uncovered: string[] = [];
  for (const p of pending) {
    for (const pos of [...p.aiCalls, ...p.wrapperRefs.filter((r) => wrappers.has(r.name)).map((r) => r.pos)]) {
      if (p.units.some((u) => u.start <= pos && pos < u.end)) continue;
      uncovered.push(`${p.file}:${p.text.slice(0, pos).split('\n').length}`);
    }
  }
  scanCache = { units, uncovered, imports: importsByFile };
  return scanCache;
}
/** 래퍼 = 이름이 call 로 시작하고 날 AI 호출을 품은 함수(callOutreachAi · callAnthropic 꼴 · 참조로 넘겨도 잡는다) */
export function wrappersOf(units: FnUnit[]): Set<string> {
  return new Set(units.filter((u) => u.name && /^call[A-Z]/.test(u.name) && RAW_AI_RE.test(u.body)).map((u) => u.name!));
}
/** 판정 이름 + 별칭(`const x = findNewNumbers` 꼴 · 부르기 전에 이름을 바꿔 시험을 비켜 가지 않게) */
export function ctCallRe(names: string[], units: FnUnit[]): RegExp {
  const base = new RegExp(`^(?:${names.join('|')})$`);
  const aliases = new Set<string>();
  for (const u of units) for (const m of u.body.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*(\w+)\s*[;,)]/g)) if (base.test(m[2])) aliases.add(m[1]);
  return new RegExp(`\\b(?:${[...names, ...aliases].join('|')})\\(`);
}
/** (나) 분류 — AI 를 부르는 단위 중 효능 판정에 닿지 않는 것(그 단위 · 아래로 닫힘 · 부르는 쪽) */
export function unclassifiedAiUnits(units: FnUnit[], all: FnUnit[], wrappers: Set<string>, imports: Map<string, ImportMap> = new Map(), targetCt: string[] = EFFICACY_CT): { ai: FnUnit[]; unclassified: string[] } {
  const effRe = ctCallRe(targetCt, all);
  const aiRe = new RegExp(`${wrappers.size ? `\\b(?:${[...wrappers].join('|')})\\b|` : ''}\\bmessages(?:\\s+as\\s+any\\))?\\.(?:batches\\.)?create\\(`);
  // ★ Codex 3R — 단위 = 파일 + 이름으로 푼다(이름만으로 합치면 다른 파일의 같은 이름 속성 함수가 도달을 빌려 준다).
  //   부른 이름 → 같은 파일의 그 이름 단위가 먼저 · 없으면 다른 파일의 선언(함수 · 변수 함수 · 메서드)만 · 객체 속성 함수 이름은 파일 밖으로 풀지 않는다.
  const isProp = (u: FnUnit) => /@\d+$/.test(u.key);
  const sameFile = new Map<string, FnUnit[]>();
  const globalDecl = new Map<string, FnUnit[]>();
  for (const u of all) {
    if (!u.name) continue;
    const k = `${u.file}\u0000${u.name}`;
    sameFile.set(k, [...(sameFile.get(k) || []), u]);
    if (!isProp(u)) globalDecl.set(u.name, [...(globalDecl.get(u.name) || []), u]);
  }
  // ★ Codex 4R — import 로 바인딩이 정해진 이름 = 그 파일의 그 선언만(별칭 따라감) · 같은 파일 → 다른 파일 선언 순
  const resolve = (file: string, name: string): FnUnit[] => {
    const imp = imports.get(file)?.get(name);
    if (imp) return (sameFile.get(`${imp.file}.ts\u0000${imp.name}`) ?? sameFile.get(`${imp.file}/index.ts\u0000${imp.name}`) ?? []).filter((u) => !isProp(u));
    return sameFile.get(`${file}\u0000${name}`) ?? globalDecl.get(name) ?? [];
  };
  // ★ Codex 5R — 부름 = 이름 + 속성 호출인가(x.y( · x?.y( ). 속성 호출에는 import 바인딩을 붙이지 않는다(받는 객체가 다르다) ·
  //   같은 파일의 그 이름 단위 → 없으면 다른 파일의 클래스 메서드만 · 그 밖은 풀지 않는다(검사 없는 것으로 남는다 = fail-closed).
  type Call = { name: string; prop: boolean };
  const isMethod = (u: FnUnit) => (u.key.split('#')[1] || '').includes('.');
  const calls = new Map<FnUnit, Call[]>(all.map((u) => {
    const seen = new Map<string, Call>();
    for (const m of u.body.matchAll(/(\.\s*)?\b(\w+)\s*\(/g)) { const c = { name: m[2], prop: !!m[1] }; if (c.name !== u.name) seen.set(`${c.prop ? '.' : ''}${c.name}`, c); }
    return [u, Array.from(seen.values())];
  }));
  const resolveCall = (file: string, c: Call): FnUnit[] => (c.prop
    ? (sameFile.get(`${file}\u0000${c.name}`) ?? (globalDecl.get(c.name) || []).filter(isMethod))
    : resolve(file, c.name));
  const reach = new Set<FnUnit>(all.filter((u) => effRe.test(u.body)));
  for (let changed = true; changed;) {
    changed = false;
    for (const u of all) {
      if (reach.has(u)) continue;
      // 같은 이름이 여럿으로 풀리면(바인딩을 확정 못 함) **전부** 검사에 닿아야 닿은 것이다(하나가 안전하다고 통과시키지 않는다)
      if ((calls.get(u) || []).some((c) => { const ts2 = resolveCall(u.file, c); return ts2.length > 0 && ts2.every((t) => reach.has(t)); })) { reach.add(u); changed = true; }
    }
  }
  const ai = units.filter((u) => !(u.name && wrappers.has(u.name)) && aiRe.test(u.body));
  const unclassified = ai.filter((u) => {
    if (reach.has(u)) return false;
    // 부르는 쪽 = 그 이름을 불러 이 단위로 풀리는 단위(같은 규칙)
    //   바인딩이 이 단위 하나로 정해지는 호출만 부르는 쪽이다(같은 이름 여럿이면 어느 쪽인지 모른다)
    const callers = u.name ? all.filter((v) => v !== u && (calls.get(v) || []).some((c) => { if (c.name !== u.name) return false; const ts2 = resolveCall(v.file, c); return ts2.length === 1 && ts2[0] === u; })) : [];
    return !callers.some((v) => reach.has(v));
  }).map((u) => u.key);
  return { ai, unclassified: Array.from(new Set(unclassified)) };
}
