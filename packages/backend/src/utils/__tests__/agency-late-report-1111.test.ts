/**
 * C125 대행발송 스팸 검사 — 늦은 보고가 검사를 통과로 바꾸면 15분 대기 없이 이어 간다(★ 2026-11-11 · 소스 계약)
 *   동작(회복 사건 · 집기 대기 · 3번 셈)은 실 PG 시험 agency-late-report-1111.pg 가 본다. 여기는 배선:
 *   늦은 보고 자리가 회복 함수를 부르는가 · 장애 사건을 읽는 자리가 전부 회복 조각을 거치는가 · 화면 문구.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { stripComments, declarationsNamed } from './helpers/producer-scan';

const SRC = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const worker = read(join(SRC, 'utils', 'agency-send-worker.ts'));
const route = read(join(SRC, 'routes', 'spam-filter.ts'));
const fnBody = (src: string, head: string) => {
  const a = src.indexOf(head);
  expect(a, head).toBeGreaterThan(-1);
  const next = src.slice(a + head.length).search(/\n(?:export )?(?:async )?function |\n\/\*\*\n/);
  return src.slice(a, next < 0 ? undefined : a + head.length + next);
};

describe('C125 늦은 보고 → 대행발송 대기 해제(배선)', () => {
  it('늦은 보고 자리 = 결과 행을 고친 그 갈래에서 회복 함수를 부른다 · 보고 응답은 기다리지 않는다 · 실패를 삼킨다', () => {
    const at = route.indexOf('if (target.late && updated) {');
    expect(at).toBeGreaterThan(-1);
    const block = route.slice(at, route.indexOf('\n    }\n', at));
    expect(block).toContain('늦은 보고로 판정 정정');
    expect(stripComments(block)).toMatch(/void recoverAgencySpamErrors\(testId\)\.catch\(/);
    expect(stripComments(block)).not.toMatch(/await recoverAgencySpamErrors/);
    // 다른 자리에서 부르지 않는다(늦지 않은 보고 · 확인 문자 갈래는 검사 진행 중이라 대행 건이 아직 판정 전이다)
    expect(stripComments(route).split('recoverAgencySpamErrors(').length - 1).toBe(1);
    expect(route).toContain("import { recoverAgencySpamErrors } from '../utils/agency-send-worker';");
  });

  it('검사 장애 사건을 SQL 로 읽는 자리 전수(기계 추출) = 전부 회복 조각을 거친다 · 읽는 파일은 대행 워커 하나', () => {
    // 백엔드 소스 전체에서 그 사건 종류를 SQL 조건으로 읽는 파일
    const files = (readdirSync(SRC, { recursive: true }) as string[])
      .map((f) => String(f).replace(/\\/g, '/'))
      .filter((f) => /\.ts$/.test(f) && !/__tests__\//.test(f));
    const readers = files.filter((f) => /kind\s*=\s*'spam_check_error'/.test(stripComments(read(join(SRC, f)))));
    expect(readers).toEqual(['utils/agency-send-worker.ts']);

    const code = stripComments(worker);
    const sqls = [...code.matchAll(/`[^`]*kind\s*=\s*'spam_check_error'[^`]*`/g)].map((m) => m[0]);
    expect(sqls).toHaveLength(3); // 집기 대기 · 3번 셈 · 회복 넣기
    for (const sql of sqls) expect(sql).toContain("${unrecoveredSpamErrorSql('se')}");
  });

  it('회복 조각 = 같은 접수 · 같은 묶음의 회복 사건이 있는가 · 묶음 없는 장애는 회복되지 않는다(NULL 은 같지 않다)', () => {
    const f = stripComments(fnBody(worker, 'export function unrecoveredSpamErrorSql('));
    expect(f).toContain("sr.request_id = ${se}.request_id AND sr.kind = 'spam_check_recovered'");
    expect(f).toContain("sr.payload->>'batchId' = ${se}.payload->>'batchId'");
    expect(f).not.toMatch(/IS NOT DISTINCT FROM|COALESCE/);
  });

  it('집기 = 1차 · 발송 직전 두 고르기가 같은 대기 조각을 쓴다', () => {
    expect(stripComments(fnBody(worker, 'async function runFirstTest('))).toContain('${spamErrorBackoffSql(1)}');
    expect(stripComments(fnBody(worker, 'async function runFinalTest('))).toContain('${spamErrorBackoffSql(3)}');
  });

  it('장애 마감 = 사건 기록 → 묶음 잠금 구역에서 [회복 확인 → 회복 여부 → 회복 안 된 장애 셈 → 3번째 판단 · 상태 전환] → 구역 밖에서 기록 · 통보 · 다시 집기(Codex 1R · 2R · 3R)', () => {
    const f = stripComments(fnBody(worker, 'async function settleSpamCheckError('));
    const at = (s2: string) => {
      const i = f.indexOf(s2);
      expect(i, s2).toBeGreaterThan(-1);
      return i;
    };
    const ordered = (xs: string[]) => {
      const idx = xs.map(at);
      expect([...idx].sort((a, b) => a - b), xs.join(' → ')).toEqual(idx);
    };
    // 판정 본문 — 상태를 바꾸기 전에 읽을 것을 다 읽는다(읽기 뒤에만 상태 전환 · 전환 뒤에는 읽지 않는다)
    ordered([
      "await logEvent(row.id, 'spam_check_error'",
      'if (underLock && batchId) await recoverSpamErrorsOfBatchIn(run, batchId);',
      'await spamErrorRecovered(requestId, batchId, run)',
      'await countUnrecoveredSpamErrors(requestId, version, run);',
      'statusTried = true;',
      'if (n >= SPAM_CHECK_ERROR_LIMIT) {',
      "await setStatus(row.id, 'test_failed'",
      'await setStatus(row.id, backTo',
    ]);
    // 그 판정은 늦은 보고 쪽 회복 넣기와 같은 잠금 구역에서 돈다 · 기록 · 담당자 통보 · 다시 집기는 구역이 끝난 뒤
    ordered([
      'await withSpamRecoverLock(batchId, () => decide(query, true))',
      "if (settled.kind === 'failed') {",
      "await logEvent(row.id, 'test_failed'",
      'await notifyManager({',
      "if (settled.kind === 'recovered') {",
      'kickSpamRetest([requestId]);',
    ]);
    // 다시 집기는 회복된 경우 한 곳뿐 · 상태 전환을 시도한 뒤의 실패는 다시 마감하지 않고 올린다 · 트랜잭션에 묶지 않는다(끝에 실패할 COMMIT 없음)
    expect(f.split('kickSpamRetest(').length - 1).toBe(1);
    expect(f).toContain('if (statusTried) throw err;');
    expect(f).not.toMatch(/withTransaction|\bbegin\b|\bcommit\b/i);
    // ★ Codex 구현 4R · 5R · 6R — 「전환 뒤의 실패가 기록 · 통보 · 다시 집기를 빼먹는다」는 꼴을 열거하는 시험으로는 끝이 없다(함수 안 · 호출 사슬 · 잠금 정리).
    //   구조로 없앤다: 상태 전환의 결말(outcome)을 **전환이 끝난 그 식에서** 적고, 그 뒤 어디서 실패하든 마감은 그 결말을 돌려준다.
    //   ① 상태 전환은 둘뿐이고 둘 다 결말 대입과 한 식이다(전환과 대입 사이에 끼울 자리가 없다)
    expect(f.split('setStatus(').length - 1).toBe(2);
    expect(f.match(/\boutcome\s*=(?!=)/g)).toHaveLength(2);
    expect(f).toContain("return (outcome = { kind: (await setStatus(row.id, 'test_failed', { ...RELEASE }, token)) ? 'failed' : 'lost', n });");
    expect(f).toContain("return (outcome = { kind: (await setStatus(row.id, backTo, { ...RELEASE }, token).catch(() => false)) ? (recovered ? 'recovered' : 'backoff') : 'lost', n });");
    // ② 잠금 구역 호출이 던졌을 때 맨 먼저 결말을 본다 — 있으면 그대로 돌려준다(그 뒤 = 전환 자체가 던짐 → 위로 · 전환 전 실패 → 옛 순서 마감)
    //   구문 트리로 본다(Codex 7R): `const settled = await X` 의 X 에서 **가장 바깥 호출이 그 catch** 다 — 뒤에 then · finally 가 붙으면 가장 바깥이 달라진다.
    const sf = ts.createSourceFile('agency-send-worker.ts', worker, ts.ScriptTarget.Latest, true);
    const inits: ts.Expression[] = [];
    const fns: ts.FunctionDeclaration[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === 'settleSpamCheckError') fns.push(n);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'settled' && n.initializer) {
        let p: ts.Node | undefined = n.parent;
        while (p && !(ts.isFunctionDeclaration(p) && p.name?.text === 'settleSpamCheckError')) p = p.parent;
        if (p) inits.push(n.initializer);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(inits).toHaveLength(1);
    expect(fns).toHaveLength(1);
    // 계약이 보는 이름은 이 함수 안에서 한 번만 만들어진다 — 매개변수 · 안쪽 선언이 같은 이름으로 가리면(Codex 8R: catch 의 둘째 매개변수 outcome) 아래 단언이 다른 변수를 본다
    for (const name of ['outcome', 'statusTried', 'decide', 'settled']) {
      expect(declarationsNamed(fns[0], name).map((d) => ts.SyntaxKind[d.kind]), name).toEqual(['VariableDeclaration']);
    }
    const awaited = inits[0];
    if (!ts.isAwaitExpression(awaited)) throw new Error('settled 초기화 = await 식이어야 한다');
    const outer = awaited.expression;
    if (!ts.isCallExpression(outer) || !ts.isPropertyAccessExpression(outer.expression)) throw new Error('settled 초기화의 가장 바깥 = .catch( ) 호출이어야 한다');
    expect(outer.expression.name.text).toBe('catch');
    // catch 바로 앞 = 잠금 구역 호출 그 자체(사이에 then 없음)
    const zone = outer.expression.expression;
    expect(ts.isCallExpression(zone) && ts.isIdentifier(zone.expression) && zone.expression.text).toBe('withSpamRecoverLock');
    expect(zone.getText(sf)).toBe('withSpamRecoverLock(batchId, () => decide(query, true))');
    expect(outer.arguments).toHaveLength(1);
    const handler = outer.arguments[0];
    if (!ts.isArrowFunction(handler) || !ts.isBlock(handler.body)) throw new Error('catch 처리 = 블록 본문 화살표 함수여야 한다');
    expect(handler.parameters.map((p) => p.name.getText(sf))).toEqual(['err']);
    const [first, second] = handler.body.statements;
    // 첫 문장 = 결말이 있으면 (기다리는 것 없이) 그대로 돌려준다
    if (!first || !ts.isIfStatement(first) || !ts.isBlock(first.thenStatement)) throw new Error('catch 첫 문장 = if (outcome) { … } 여야 한다');
    expect(first.expression.getText(sf)).toBe('outcome');
    expect(first.elseStatement).toBeUndefined();
    expect(first.thenStatement.statements).toHaveLength(2);
    expect(first.thenStatement.statements[0].getText(sf)).toMatch(/^console\.warn\(/);
    expect(first.thenStatement.statements[1].getText(sf)).toBe('return outcome;');
    const waits: ts.Node[] = [];
    const findWaits = (n: ts.Node): void => {
      if (ts.isAwaitExpression(n) || (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'then')) waits.push(n);
      ts.forEachChild(n, findWaits);
    };
    findWaits(first);
    expect(waits).toHaveLength(0);
    // 둘째 문장 = 전환 자체가 던졌으면 위로
    expect(second?.getText(sf)).toBe('if (statusTried) throw err;');
    const decideBody = f.slice(f.indexOf('const decide = async ('), f.indexOf('const settled: Settled ='));
    const afterTry = decideBody.slice(decideBody.indexOf('statusTried = true;'));
    expect(decideBody.indexOf('statusTried = true;')).toBeGreaterThan(-1);
    // 읽기 셋은 「시도 표시」 앞에만 · 각각 한 번
    const beforeTry = decideBody.slice(0, decideBody.indexOf('statusTried = true;'));
    for (const read1 of ['recoverSpamErrorsOfBatchIn(', 'spamErrorRecovered(', 'countUnrecoveredSpamErrors(']) {
      expect(beforeTry.split(read1).length - 1, read1).toBe(1);
      expect(afterTry.split(read1).length - 1, read1).toBe(0);
    }
    expect(f).not.toMatch(/SELECT COUNT\(\*\)/);
    expect(f).not.toMatch(/\.includes\(String\(row\.id\)\)/);
  });

  it('잠금 구역 = 세션 잠금(잠금 전용 풀 · R41) + 일은 작업 풀에서 자동 커밋(트랜잭션 아님 · 넣은 회복 사건은 즉시 확정) · 끝에서 풀고 못 풀면 연결을 버린다', () => {
    const lock = stripComments(fnBody(worker, 'async function withSpamRecoverLock<T>('));
    const conn = lock.indexOf('const client = await lockPool.connect();');
    const take = lock.indexOf("await client.query(`SELECT pg_advisory_lock(hashtext('${SPAM_RECOVER_LOCK_NS}'), hashtext($1::text))`, [batchId]);");
    const work = lock.indexOf('return await work();');
    const free = lock.indexOf("await client.query(`SELECT pg_advisory_unlock(hashtext('${SPAM_RECOVER_LOCK_NS}'), hashtext($1::text))`, [batchId])");
    expect(conn).toBeGreaterThan(-1);
    expect(take).toBeGreaterThan(conn);
    expect(work).toBeGreaterThan(take);
    expect(free).toBeGreaterThan(work);
    expect(lock).toContain('} finally {');
    expect(lock).toMatch(/client\.release\(unlockFailed \? new Error\(/);
    expect(lock).toContain('if (!batchId) return work();');
    // 잠금 연결은 기다리기만 한다 — 작업 풀에서 잠금 연결을 꺼내지 않고(R41), 일을 잠금 연결에 싣지 않고, 트랜잭션으로 묶지 않는다
    expect(lock).not.toMatch(/\bpool\.connect\(\)/);
    expect(lock).not.toMatch(/\bbegin\b|\bcommit\b|withTransaction|pg_advisory_xact_lock/i);
    expect(lock.split('client.query(').length - 1).toBe(2);
    const outer = stripComments(fnBody(worker, 'async function recoverSpamErrorsOfBatch('));
    expect(outer).toContain('return withSpamRecoverLock(batchId, () => recoverSpamErrorsOfBatchIn(query, batchId));');
    const inner = stripComments(fnBody(worker, 'async function recoverSpamErrorsOfBatchIn('));
    expect(inner).not.toMatch(/withSpamRecoverLock|pg_advisory/);
    expect(worker).toContain("export const SPAM_RECOVER_LOCK_NS = 'agency-spam-recover';");
    expect(worker).toContain("import pool, { query, lockPool, type TxRun } from '../config/database';");
    expect(stripComments(worker)).not.toMatch(/\bas\s+lockPool\b/);
  });

  it('다시 집힌 접수 = 회복한 그 검사를 먼저 이어 본다(Codex 구현 1R) — 대행 검사 호출이 preferTestId 를 넘기고, 등록 함수가 같은 키 · 장애 아님일 때만 그것을 쓴다', () => {
    const round = stripComments(fnBody(worker, 'async function runSpamRound('));
    expect(round).toMatch(/preferTestId: \(await recoveredSpamTestIdFor\(String\(row\.id\), Number\(row\.content_version \|\| 0\)\)\.catch\(\(\) => null\)\) \?\? undefined,/);
    const queue = stripComments(read(join(SRC, 'utils', 'spam-test-queue.ts')));
    const a = queue.indexOf('const reusable = async (run?: SqlRun) => {');
    const reusable = queue.slice(a, queue.indexOf('const early = await reusable();', a));
    const pref = reusable.indexOf('await spamCheckFor(checkKey, run, reuseDays, preferTestId);');
    const fall = reusable.indexOf('await spamCheckFor(checkKey, run, reuseDays);');
    expect(pref).toBeGreaterThan(-1);
    expect(fall).toBeGreaterThan(pref);
    expect(reusable).toContain("if (preferred && preferred.outcome !== 'error') return preferred;");
    // 지정한 검사도 키 판정을 같은 문장으로 지난다(다른 문안 · 다른 회신번호 검사를 이어 보지 않는다)
    expect(queue).toContain('AND ($6::uuid IS NULL OR t.id = $6::uuid)');
    // 자동 검사 → 등록으로 그대로 넘긴다
    expect(queue).toContain('preferTestId: params.preferTestId,');
  });

  it('회복 = 판정은 검사 결과를 읽는 한 곳(readSpamTestOutcome) · 통과가 아니면 아무것도 넣지 않는다', () => {
    const f = stripComments(fnBody(worker, 'async function recoverSpamErrorsOfBatchIn('));
    const judge = f.indexOf("(await readSpamTestOutcome(String(t.id), run)).outcome !== 'pass') return [];");
    const insert = f.indexOf("'spam_check_recovered'");
    expect(judge).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(judge);
    // 결과 값을 여기서 따로 해석하지 않는다
    expect(f).not.toMatch(/result\s*(=|<>|!=|IS)\s/);
  });

  it('다시 집기 = 접수 직후 진입과 같은 길(runFirstTest · runFinalTest 에 접수 id) · 실패는 정기 tick 이 맡는다', () => {
    const f = stripComments(fnBody(worker, 'function kickSpamRetest('));
    expect(f).toContain('await runFirstTest(id);');
    expect(f).toContain('await runFinalTest(id);');
    expect(f).toMatch(/\.catch\(/);
    const pub = stripComments(fnBody(worker, 'export async function recoverAgencySpamErrors('));
    expect(pub).toContain('if (recovered.length > 0) {');
    expect(pub).toContain('kick(recovered);');
  });

  it('화면 진행 기록 = 새 사건 종류의 문구가 있다(사건 종류에 CHECK 없음 · 라벨 등재가 같은 커밋)', () => {
    const log = read(join(FE, 'components', 'agency', 'AgencyEventLog.tsx'));
    expect(log).toMatch(/spam_check_recovered: '늦게 도착한 수신 확인으로 검사를 이어 갑니다',/);
    expect(log).toMatch(/spam_check_error: '검사 장비 문제로 검사를 마치지 못해 잠시 뒤 다시 검사합니다',/);
  });
});
