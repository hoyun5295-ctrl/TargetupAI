/**
 * 한줄로 C131 · 뿌리 R94 — 「MySQL 로 나가는 SQL 은 지킴이를 지난다」 실행 길 계약(설계서 §6-2 (나) · 닫힌 목록)
 *   판정 자체는 실행 순간(utils/queue-scan-guard.ts)이 한다. 이 시험은 실행 길이 목록 밖으로 새지 않는지만 본다.
 *   1 mysql 모듈 가져오기 = 목록 파일만 · 2 풀 이름 · getConnection = 목록 함수만 · 3 그 함수의 query/execute = 지킴이를 지난 글
 *   4 받은 연결은 그 함수 밖으로 나가지 않는다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '../..');
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') out.push(...listTs(p)); continue; }
    if (/\.ts$/.test(e.name) && !/\.(test|spec|verify)\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 결제 DB(sales) 전용 풀 · 큐 표 글자 0 — 1 · 2 의 예외(이유 = 다른 DB) */
const PAY_STATS = 'utils/pay-stats.ts';
const MYSQL_IMPORTERS = new Set(['config/database.ts', 'utils/queue-scan-guard.ts', PAY_STATS]);
/** 풀 이름 · getConnection 을 쓰는 자리(파일 → 가장 바깥 함수 이름) */
const CONN_SCOPES: Record<string, string[]> = {
  'config/database.ts': ['(최상위)', '(익명)', 'mysqlQuery', 'withBoundedMysql', 'mysqlBillingQuery'],
  'utils/queue-load-tx.ts': ['(가져오기)', 'openQueueTransaction'],
  'utils/sms-queue.ts': ['(가져오기)', 'loadQueueUnit'],
};
const POOL_NAMES = new Set(['mysqlPool', 'mysqlBillingPool']);
/** 받은 연결에 부를 수 있는 메서드(실행 = query · execute 는 3 이 지킴이를 본다 · then = 연결 약속) */
const CONN_METHODS = new Set(['query', 'execute', 'release', 'destroy', 'beginTransaction', 'commit', 'rollback', 'then']);

const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

/** 가장 바깥 함수의 이름(없으면 최상위 · 가져오기) */
function scopeName(n: ts.Node): string {
  let outer: ts.Node | undefined;
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return '(가져오기)';
    if (isFn(p)) outer = p;
  }
  if (!outer) return '(최상위)';
  if ((ts.isFunctionDeclaration(outer) || ts.isMethodDeclaration(outer)) && outer.name) return outer.name.getText();
  if (outer.parent && ts.isVariableDeclaration(outer.parent)) return outer.parent.name.getText();
  return '(익명)';
}
function outerFn(n: ts.Node): ts.Node | undefined {
  let outer: ts.Node | undefined;
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (isFn(p)) outer = p;
  return outer;
}
const innerFn = (n: ts.Node): ts.Node | undefined => { for (let p = n.parent; p; p = p.parent) if (isFn(p)) return p; return undefined; };
const walk = (n: ts.Node, f: (x: ts.Node) => void): void => { f(n); ts.forEachChild(n, (c) => walk(c, f)); };
const unwrap = (e: ts.Expression): ts.Expression => (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ? unwrap(e.expression) : e);

const files = listTs(SRC).map((f) => ({ f: rel(f), text: fs.readFileSync(f, 'utf8') }))
  .map(({ f, text }) => ({ f, text, sf: ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true) }));

/**
 * config/database 가져오기가 쓰는 이름을 드러내는가 — 정적 이름 가져오기 · 기본 가져오기 · 동적 가져오기의 풀어 받기(`const { query } = await import(…)`)
 *   · `.then(m => m.이름…)`(m 을 「m.이름」 꼴로만 씀). 이름공간 · 통째 받기 · 다시 내보내기 = 아님(풀 이름 검사를 피할 수 있다).
 */
function databaseImportNamed(n: ts.Node): boolean {
  if (ts.isImportDeclaration(n)) return !(n.importClause?.namedBindings && ts.isNamespaceImport(n.importClause.namedBindings));
  if (!ts.isCallExpression(n)) return false;
  let p: ts.Node = n.parent;
  while (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p)) p = p.parent;
  if (ts.isVariableDeclaration(p) && ts.isObjectBindingPattern(p.name)) return p.name.elements.every((e) => !e.dotDotDotToken && (!e.propertyName || ts.isIdentifier(e.propertyName)));
  if (ts.isPropertyAccessExpression(p) && p.name.text === 'then' && ts.isCallExpression(p.parent) && p.parent.expression === p) {
    const cb = p.parent.arguments[0];
    if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) || cb.parameters.length !== 1 || !ts.isIdentifier(cb.parameters[0].name)) return false;
    const m = cb.parameters[0].name.text;
    let ok = true;
    walk(cb.body, (c) => { if (ts.isIdentifier(c) && c.text === m && !(ts.isPropertyAccessExpression(c.parent) && c.parent.expression === c)) ok = false; });
    return ok;
  }
  return false;
}

/** 계약 위반 목록(시험 = 0 · 변이 시험이 같은 함수를 부른다) */
function routeViolations(units: Array<{ f: string; text: string; sf: ts.SourceFile }>): string[] {
  const bad: string[] = [];
  const at = (u: { f: string; sf: ts.SourceFile }, n: ts.Node) => `${u.f}:${u.sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  for (const u of units) {
    walk(u.sf, (n) => {
      // 1. mysql 모듈 가져오기 · 글자 아닌 동적 가져오기
      let spec: ts.Expression | undefined;
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) spec = n.moduleSpecifier;
      if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) spec = n.moduleReference.expression;
      if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
        spec = n.arguments[0];
        if (!spec || !ts.isStringLiteralLike(spec)) { bad.push(`${at(u, n)} 글자 아닌 동적 가져오기`); return; }
      }
      if (spec && ts.isStringLiteralLike(spec)) {
        const m = spec.text;
        if (/^mysql/i.test(m) && !MYSQL_IMPORTERS.has(u.f)) bad.push(`${at(u, n)} ${m} 가져오기(목록 밖)`);
        if (/^mysql/i.test(m) && u.f === 'utils/queue-scan-guard.ts') {
          const ic = ts.isImportDeclaration(n) ? n.importClause : undefined;
          const names = ic?.namedBindings && ts.isNamedImports(ic.namedBindings) ? ic.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text) : [];
          if (!ic || ic.name || names.join(',') !== 'format') bad.push(`${at(u, n)} 지킴이는 format 하나만 가져온다`);
        }
        if (/config\/database$/.test(m) && !databaseImportNamed(n)) bad.push(`${at(u, n)} config/database 를 이름 없이(이름공간 · 통째 · 다시 내보내기) 가져옴`);
      }
      // 2. 풀 이름(속성 이름 · 풀어 받기 · 글자 포함) · getConnection = 목록 함수만
      if (ts.isStringLiteralLike(n) && POOL_NAMES.has(n.text) && u.f !== 'config/database.ts') bad.push(`${at(u, n)} 풀 이름 글자 ${n.text}`);
      if (ts.isIdentifier(n) && POOL_NAMES.has(n.text)) {
        const s = scopeName(n);
        if (!(CONN_SCOPES[u.f] ?? []).includes(s)) bad.push(`${at(u, n)} ${n.text} 를 목록 밖(${s})에서 씀`);
        if (s === '(최상위)' && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) bad.push(`${at(u, n)} ${n.text} 를 최상위에서 씀`);
      }
      if (ts.isPropertyAccessExpression(n) && n.name.text === 'getConnection' && u.f !== PAY_STATS) {
        const s = scopeName(n);
        if (!(CONN_SCOPES[u.f] ?? []).includes(s) || s.startsWith('(최')) bad.push(`${at(u, n)} getConnection 을 목록 밖(${u.f} ${s})에서 부름`);
      }
    });
    if (u.f === PAY_STATS && /SMSQ/i.test(u.text)) bad.push(`${u.f} 결제 DB 파일에 큐 표 글자`);
  }

  // 3 · 4. 목록 함수 안
  for (const u of units) {
    const names = CONN_SCOPES[u.f];
    if (!names) continue;
    const scopes = new Set<ts.Node>();
    walk(u.sf, (n) => {
      const touches = (ts.isIdentifier(n) && POOL_NAMES.has(n.text)) || (ts.isPropertyAccessExpression(n) && n.name.text === 'getConnection');
      const o = touches ? outerFn(n) : undefined;
      if (o) scopes.add(o);
    });
    for (const scope of scopes) {
      // 3. query / execute 첫 인자 = 값 인자 없는 끼워 넣기 없는 글(큐 글자 · 자리표시자 0) · 또는 같은 안쪽 함수에서 앞서 noteQueueSql 에 넘긴 같은 식
      walk(scope, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || !['query', 'execute'].includes(n.expression.name.text)) return;
        const a = n.arguments[0];
        if (a && n.arguments.length === 1 && ts.isStringLiteralLike(a) && !/SMSQ|\?/i.test(a.text)) return;
        const fn = innerFn(n);
        let noted = false;
        if (a && fn) walk(fn, (c) => {
          if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'noteQueueSql' && c.arguments[1]
            && c.arguments[1].getText() === a.getText() && c.getStart() < n.getStart() && innerFn(c) === fn) noted = true;
        });
        if (!noted) bad.push(`${at(u, n)} ${n.expression.getText()} 가 지킴이를 지나지 않음`);
      });
      // 4. 연결을 담은 이름 = 「연결.메서드」 꼴로만(돌려주기 · 넘기기 · 담기 0 · raceBounded 상한 기다리기만 예외)
      const holders = new Set<string>();
      const rhsHolds = (e: ts.Expression) => {
        let hit = false;
        const look = (c: ts.Node): void => {
          if (isFn(c)) return;   // 클로저 값 = 연결 아님(클로저가 연결을 밖으로 내면 아래 참조 검사가 잡는다)
          if (ts.isPropertyAccessExpression(c) && c.name.text === 'getConnection') hit = true;
          if (ts.isIdentifier(c) && holders.has(c.text)) hit = true;
          ts.forEachChild(c, look);
        };
        look(e);
        return hit;
      };
      for (let round = 0; round < 3; round++) walk(scope, (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && rhsHolds(n.initializer)) holders.add(n.name.text);
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && rhsHolds(n.right)) holders.add(n.left.text);
        // 연결 약속.then((받은 연결) => …) = 받은 연결도 연결
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'then'
          && ts.isIdentifier(n.expression.expression) && holders.has(n.expression.expression.text)) {
          const cb = n.arguments[0];
          if (cb && isFn(cb) && cb.parameters[0] && ts.isIdentifier(cb.parameters[0].name)) holders.add(cb.parameters[0].name.text);
        }
      });
      walk(scope, (n) => {
        // arguments = 매개변수 이름 없이 받은 값(연결 포함)을 꺼낼 수 있다 = 추적 못 함(Codex 구현 3R)
        if (ts.isIdentifier(n) && n.text === 'arguments') { bad.push(`${at(u, n)} arguments 사용 — 연결 추적 못 함`); return; }
        if (!ts.isIdentifier(n) || !holders.has(n.text)) return;
        const p = n.parent;
        if (ts.isParameter(p) && p.name === n) return;                              // .then 콜백 매개변수 선언
        // 연결.메서드(…) = 정해진 메서드 호출만(속성 꺼내기 · 다른 메서드 = 연결이 새는 길 · Codex 구현 1R conn.connection)
        if (ts.isPropertyAccessExpression(p) && p.expression === n) {
          // then = 그 자리에서 쓴 함수만(매개변수 = 이름 하나 · 이름 콜백 · 풀어 받기 = 추적 못 함 = 위반 · Codex 구현 2R)
          if (p.name.text === 'then' && ts.isCallExpression(p.parent) && p.parent.expression === p
            && !p.parent.arguments.every((a) => ts.isArrowFunction(a) && a.parameters.every((q) => ts.isIdentifier(q.name)))) {
            bad.push(`${at(u, n)} 연결 ${n.text} 의 then 콜백 — 그 자리에서 쓴 함수가 아님`);
            return;
          }
          if (CONN_METHODS.has(p.name.text) && ts.isCallExpression(p.parent) && p.parent.expression === p) return;
          bad.push(`${at(u, n)} 연결 ${n.text} 의 ${p.name.text} — 정해진 메서드 호출이 아님`);
          return;
        }
        if (ts.isVariableDeclaration(p) && p.name === n) return;                    // 선언
        if (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return; // 받기
        if (ts.isTypeQueryNode(p)) return;                                          // typeof 연결(형 자리)
        if (u.f === 'config/database.ts' && ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'raceBounded' && p.arguments[0] === n) return;
        bad.push(`${at(u, n)} 연결 ${n.text} 가 함수 밖으로 나갈 수 있는 자리(${ts.SyntaxKind[p.kind]})`);
      });
      if (holders.size === 0) bad.push(`${at(u, scope)} 연결을 담은 이름을 못 찾음`);
    }
  }
  return bad;
}

describe('C131 R94 — MySQL 실행 길 = 지킴이를 지나는 닫힌 목록', () => {
  it('현재 소스 = 위반 0', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(routeViolations(files)).toEqual([]);
  });

  it('목록 함수가 실제로 있다(이름이 바뀌면 시험이 빈 목록으로 통과하지 않게)', () => {
    for (const [f, names] of Object.entries(CONN_SCOPES)) {
      const u = files.find((x) => x.f === f);
      expect(u, f).toBeTruthy();
      for (const nm of names.filter((x) => !x.startsWith('('))) expect(u!.text, `${f} ${nm}`).toMatch(new RegExp(`\\b${nm}\\b`));
      expect((u!.text.match(/noteQueueSql\(/g) ?? []).length, f).toBeGreaterThanOrEqual(f === 'config/database.ts' ? 4 : f === 'utils/queue-load-tx.ts' ? 2 : 1);
    }
  });

  // 반례(가짜 소스 하나를 목록에 더해 같은 판정을 돌린다)
  const withFake = (f: string, text: string) => routeViolations([{ f, text, sf: ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true) }]);
  const real = (f: string) => files.find((x) => x.f === f)!.text;

  it('반례 — 새 파일에서 풀 · mysql2 · 이름공간 · 동적 가져오기', () => {
    expect(withFake('utils/new-x.ts', `import { mysqlPool } from '../config/database'; export const f = () => mysqlPool.query('SELECT * FROM SMSQ_SEND_15');`).length).toBeGreaterThan(0);
    expect(withFake('utils/new-x.ts', `import mysql from 'mysql2/promise'; export const p = mysql.createPool({});`).length).toBeGreaterThan(0);
    expect(withFake('utils/new-x.ts', `import * as db from '../config/database'; export const f = () => (db as any).mysqlPool;`).length).toBeGreaterThan(0);
    expect(withFake('utils/new-x.ts', `const m = 'mysql2'; export const f = () => require(m);`).length).toBeGreaterThan(0);
    expect(withFake('utils/new-x.ts', `export { mysqlPool } from '../config/database';`).length).toBeGreaterThan(0);
    expect(withFake('utils/new-x.ts', `export * from '../config/database';`).length).toBeGreaterThan(0);
    expect(withFake('utils/new-x.ts', `export async function f() { const db = await import('../config/database'); return db.mysqlPool; }`).length).toBeGreaterThan(0);
    expect(withFake('utils/new-x.ts', `export async function f() { const db: any = await import('../config/database'); return db['mysql' + 'Pool']; }`).length).toBeGreaterThan(0);
    expect(withFake('utils/new-x.ts', `export async function f() { const { mysqlPool: p } = await import('../config/database'); return p; }`).length).toBeGreaterThan(0);
    expect(withFake('utils/new-x.ts', `export async function f() { return import('../config/database').then((m) => (m as any)['mysqlPool']); }`).length).toBeGreaterThan(0);
    // PG 만 쓰는 동적 가져오기(현재 세 파일의 꼴)는 통과
    expect(withFake('utils/new-x.ts', `export async function f() { const { query } = await import('../config/database'); return query('SELECT 1'); }`)).toEqual([]);
    expect(withFake('utils/new-x.ts', `export async function f(p: any) { const c = await p.getConnection(); return c; }`).length).toBeGreaterThan(0);
  });

  it('반례 — 목록 함수 안에서 지킴이를 빼거나 연결을 내보냄', () => {
    const db = real('config/database.ts');
    expect(withFake('config/database.ts', db.replace("noteQueueSql('mysqlQuery', sql, params);", '')).length).toBeGreaterThan(0);
    expect(withFake('config/database.ts', db.replace("noteQueueSql('withBoundedMysql', sql, params);", '')).length).toBeGreaterThan(0);
    expect(withFake('config/database.ts', db.replace("noteQueueSql('mysqlBillingQuery', limitSql);", '')).length).toBeGreaterThan(0);
    const sq = real('utils/sms-queue.ts');
    expect(withFake('utils/sms-queue.ts', sq.replace("noteQueueSql('loadQueueUnit', ins.sql, ins.params);", '')).length).toBeGreaterThan(0);
    expect(withFake('utils/sms-queue.ts', sq.replace("state: 'loaded', table, threadId,", "state: 'loaded', table, threadId, conn,")).length).toBeGreaterThan(0);
    const tx = real('utils/queue-load-tx.ts');
    expect(withFake('utils/queue-load-tx.ts', tx.replace("noteQueueSql('openQueueTransaction', sql, params);", '')).length).toBeGreaterThan(0);
    expect(withFake('utils/queue-load-tx.ts', tx.replace('afterCommit: (fn) => { hooks.push(fn); },', 'afterCommit: (fn) => { hooks.push(fn); }, raw: conn,')).length).toBeGreaterThan(0);
    // Codex 구현 1R — 값 인자로 표 이름을 넘기는 글자 · 연결 속성 꺼내기
    expect(withFake('config/database.ts', db.replace("noteQueueSql('mysqlQuery', sql, params);", "noteQueueSql('mysqlQuery', sql, params); await conn.query('SELECT * FROM ??', ['SMSQ_SEND_15']);")).length).toBeGreaterThan(0);
    expect(withFake('utils/queue-load-tx.ts', tx.replace('afterCommit: (fn) => { hooks.push(fn); },', 'afterCommit: (fn) => { hooks.push(fn); }, raw: conn.connection,')).length).toBeGreaterThan(0);
    expect(withFake('config/database.ts', db.replace('acquiring.then((late) => late.destroy(), () => undefined);', 'acquiring.then((late) => leak(late), () => undefined);')).length).toBeGreaterThan(0);
    // Codex 구현 3R — 일반 함수 콜백의 arguments 로 연결 꺼내기
    expect(withFake('config/database.ts', db.replace('acquiring.then((late) => late.destroy(), () => undefined);', 'acquiring.then(function () { (globalThis as any).raw = arguments[0]; }, () => undefined);')).length).toBeGreaterThan(0);
    expect(withFake('config/database.ts', db.replace('acquiring.then((late) => late.destroy(), () => undefined);', 'acquiring.then((late) => { (globalThis as any).raw = arguments; late.destroy(); }, () => undefined);')).length).toBeGreaterThan(0);
    // Codex 구현 2R — 이름 콜백 · 풀어 받기 콜백
    expect(withFake('config/database.ts', db.replace('acquiring.then((late) => late.destroy(), () => undefined);', 'acquiring.then(useRaw, () => undefined);')).length).toBeGreaterThan(0);
    expect(withFake('config/database.ts', db.replace('acquiring.then((late) => late.destroy(), () => undefined);', 'acquiring.then(({ query }) => query("SELECT * FROM SMSQ_SEND_15"), () => undefined);')).length).toBeGreaterThan(0);
    // 같은 파일 다른 함수에서 풀을 쓰면
    expect(withFake('utils/sms-queue.ts', sq + `\nexport async function leak() { return mysqlPool.query('SELECT * FROM SMSQ_SEND_15'); }\n`).length).toBeGreaterThan(0);
    // 결제 파일에 큐 표 글자
    expect(withFake(PAY_STATS, real(PAY_STATS) + `\n// SMSQ_SEND_15\n`).length).toBeGreaterThan(0);
  });
});
