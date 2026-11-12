/**
 * queue-scan-guard.ts — 큐 표 전체 훑기 지킴이(한줄로 C131 · 뿌리 R94 · 1113 Harold 「네, 바꿔」)
 *
 * 비토 라인 표(SMSQ_SEND_13 ~ 16)는 이력 표로 옮기지 않아 끝없이 커진다. 색인 앞 칸으로 좁히지 않는 조건으로
 * 훑으면 한 번에 수백만 행을 읽어 DB 를 막는다(1112 슬로 로그 · 설계서 docs/2026-11-13-c131-bito-line-scan-report-speed-design.md).
 *
 * 판정 자리 = MySQL 실행 함수가 **실제로 내보내는 SQL 글**(mysql2 와 같은 format 으로 `?` · `??` 를 채운 글).
 *   큐 표(SMSQ_SEND…)에 닿는 자리마다 그 쿼리 블록 WHERE 의 최상위 AND 에 좁히는 색인 조건이 하나 이상 있어야 한다:
 *   app_etc1 · dest_no · seqno · status_code 의 `=` 값 · `IN (값…)`, 또는 `status_code >= N`(N ≥ ABNORMAL_STATUS_FLOOR).
 * 어기면 막지 않는다 — 모양(값 = ? · 숫자 = N)별로 모아 처음 한 번 로그 · 감시 워커가 꺼내 시스템 경보.
 *   쿼리를 막으면 발송 · 결과 반영이 멈추는 쪽이 더 위험하다. 실행 · 반환 · 예외는 그대로(던지지 않는다).
 */
import { format } from 'mysql2/promise';

/** 결과 코드 밖 이상값 구역의 시작(sms-result-map ABNORMAL_STATUS_MIN 과 같은 값 · 계약 시험이 대조) */
export const ABNORMAL_STATUS_FLOOR = 100000;

/**
 * 판정은 **토큰 배열** 위에서 한다(Codex 구현 1R · 2R — 이어 붙인 글 위의 정규식 낱말 경계는 SQL 낱말 규칙과 달라
 *   `q$END` · `0.` · 이름 자리 키워드 같은 틈이 계속 났다). 키워드 = 이름 자리(역따옴표 · 점 뒤)가 아닌 낱말 토큰 중 아래 목록.
 * ★ 기본값 = **모르는 꼴은 위반(판정 불가)**(Codex 구현 3R — 같은 부류 세 번째 · 「아는 규칙만 보고 나머지는 통과」가 뿌리).
 *   위반은 막지 않고 경보만 내므로, 모르는 글자 · 문장 종류 · 집합 연산 꼴을 통과시키는 것보다 알리는 쪽이 안전하다.
 */
type Tok = { k: 'kw' | 'name' | 'val' | 'num' | 'op'; t: string };

/** 판정이 쓰는 키워드 + 행을 읽지 않는 문장의 첫 낱말 */
const KW = new Set([
  'AND', 'OR', 'XOR', 'NOT', 'BETWEEN', 'CASE', 'END', 'WHERE', 'GROUP', 'ORDER', 'BY', 'LIMIT', 'HAVING', 'WINDOW', 'FOR', 'LOCK',
  'INTO', 'UNION', 'EXCEPT', 'INTERSECT', 'SELECT', 'TABLE', 'VALUES', 'LIKE', 'INSERT', 'REPLACE', 'CREATE', 'IF', 'EXISTS', 'IN', 'SQL_CALC_FOUND_ROWS',
  'LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY', 'IGNORE', 'ANALYZE', 'EXPLAIN', 'DESCRIBE', 'DESC', 'SHOW', 'ALTER', 'DROP',
  'TRUNCATE', 'RENAME', 'UNLOCK', 'OPTIMIZE', 'CHECK', 'REPAIR', 'FLUSH', 'GRANT', 'REVOKE', 'KILL', 'USE', 'BEGIN', 'START',
  'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
]);
const OPS = ['<=>', '->>', '>=', '<=', '<>', '!=', '||', '&&', ':=', '->', '<<', '>>'];
/** 낱말 글자 = ASCII 만(따옴표 밖 다른 글자 = 판정 불가 · Codex 구현 3R q€LIMIT) */
const WORD = /[A-Za-z0-9_$]/;
/** 건너뛰는 공백 = ASCII 만 */
const ASCII_SPACE = /[ \t\n\r\f\v]/;
/** 따옴표 밖에서 아는 기호 글자 */
const OP_CHARS = new Set([...'()[]{},.;=<>!+-*/%&|^~:']);

/** 따옴표로 닫힌 조각의 끝(닫는 따옴표 자리) · 없으면 -1 — 역빗금 이스케이프(역따옴표 제외) · 겹침 */
function closeAt(sql: string, from: number, q: string): number {
  for (let j = from; j < sql.length; j++) {
    if (q !== '`' && sql[j] === '\\') { j++; continue; }
    if (sql[j] === q) { if (sql[j + 1] === q) { j++; continue; } return j; }
  }
  return -1;
}

/**
 * SQL 글 → 토큰: 문자열('…' · "…") · 변수(@x · @@x · @'x') · 자리표시자 ? = 값 · 역따옴표 = 이름 · 숫자 · 기호 · 낱말.
 * 주석(# · -- · /* *\/) = 건너뜀 · 실행 주석(/*! *\/) · 닫히지 않은 따옴표 · 주석 = 판정 불가(error · 그때까지의 토큰은 모양에 씀).
 */
function lex(sql: string): { toks: Tok[]; error?: string } {
  const toks: Tok[] = [];
  const n = sql.length;
  const fail = (error: string) => ({ toks, error });
  for (let i = 0; i < n;) {
    const c = sql[i];
    if (ASCII_SPACE.test(c)) { i++; continue; }   // ASCII 공백만(NBSP · 전각 공백 = 아래에서 판정 불가 · Codex 구현 4R)
    if (c === '#' || (c === '-' && sql[i + 1] === '-' && (i + 2 >= n || /[\x00-\x20]/.test(sql[i + 2])))) {
      const e = sql.indexOf('\n', i);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      if (sql[i + 2] === '!') return fail('실행 주석');
      const e = sql.indexOf('*/', i + 2);
      if (e < 0) return fail('닫히지 않은 주석');
      i = e + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const e = closeAt(sql, i + 1, c);
      if (e < 0) return fail('닫히지 않은 문자열');
      toks.push({ k: 'val', t: '?' });
      i = e + 1;
      continue;
    }
    if (c === '`') {
      const e = closeAt(sql, i + 1, '`');
      if (e < 0) return fail('닫히지 않은 이름');
      toks.push({ k: 'name', t: sql.slice(i + 1, e).replace(/``/g, '`') });
      i = e + 1;
      continue;
    }
    if (c === '@') {
      let j = i + 1;
      if (sql[j] === '@') j++;
      if (sql[j] === "'" || sql[j] === '"' || sql[j] === '`') {
        const e = closeAt(sql, j + 1, sql[j]);
        if (e < 0) return fail('닫히지 않은 변수 이름');
        j = e + 1;
      } else {
        while (j < n && (WORD.test(sql[j]) || sql[j] === '.')) j++;
      }
      toks.push({ k: 'val', t: '?' });
      i = j;
      continue;
    }
    if (c === '?') { toks.push({ k: 'val', t: '?' }); i++; continue; }
    // 숫자(1 · 1.5 · 0. · .5 · 1e3 · 0x1F) — 바로 뒤에 낱말 글자가 붙으면 숫자로 시작하는 이름(1abc)
    const num = /^(?:0x[0-9a-f]+|0b[01]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i.exec(sql.slice(i, i + 64));
    if (num && (/\d/.test(c) || (c === '.' && /\d/.test(sql[i + 1] ?? '') && toks[toks.length - 1]?.k !== 'name'))) {
      let j = i + num[0].length;
      if (j < n && WORD.test(sql[j])) {
        while (j < n && WORD.test(sql[j])) j++;
        toks.push({ k: 'name', t: sql.slice(i, j) });
      } else {
        toks.push({ k: 'num', t: num[0] });
      }
      i = j;
      continue;
    }
    if (WORD.test(c)) {
      let j = i;
      while (j < n && WORD.test(sql[j])) j++;
      const w = sql.slice(i, j);
      const afterDot = toks[toks.length - 1]?.k === 'op' && toks[toks.length - 1].t === '.';
      toks.push(!afterDot && KW.has(w.toUpperCase()) ? { k: 'kw', t: w.toUpperCase() } : { k: 'name', t: w });
      i = j;
      continue;
    }
    if (!OP_CHARS.has(c)) return fail(`알 수 없는 글자 U+${c.codePointAt(0)!.toString(16).toUpperCase()}`);
    const op = OPS.find((o) => sql.startsWith(o, i)) ?? c;
    toks.push({ k: 'op', t: op });
    i += op.length;
  }
  return { toks };
}

const isKw = (x: Tok | undefined, ...w: string[]) => !!x && x.k === 'kw' && w.includes(x.t);
const isOp = (x: Tok | undefined, o: string) => !!x && x.k === 'op' && x.t === o;
const NARROW_COLS = new Set(['app_etc1', 'dest_no', 'seqno', 'status_code']);
const isCol = (x: Tok | undefined) => !!x && x.k === 'name' && NARROW_COLS.has(x.t.toLowerCase());
const isInt = (x: Tok | undefined) => !!x && x.k === 'num' && /^\d+$/.test(x.t);
/** 값 하나(자리표시자 · 문자열 · 정수 · 음의 정수)의 끝 다음 자리 · 아니면 -1 */
function valueEnd(p: Tok[], i: number): number {
  if (p[i]?.k === 'val' || isInt(p[i])) return i + 1;
  if (isOp(p[i], '-') && isInt(p[i + 1])) return i + 2;
  return -1;
}

/** 최상위(괄호 · CASE…END 밖) AND 로 자른다 · BETWEEN 의 AND 는 자르지 않음 · 최상위 OR · XOR · || · 깊이가 맞지 않으면 null */
function topLevelAnd(w: Tok[]): Tok[][] | null {
  const parts: Tok[][] = [];
  let depth = 0; let cur: Tok[] = []; let between = false;
  for (const x of w) {
    if (isOp(x, '(') || isKw(x, 'CASE')) depth++;
    if (isOp(x, ')') || isKw(x, 'END')) depth--;
    if (depth < 0) return null;
    if (depth === 0 && (isKw(x, 'OR', 'XOR') || isOp(x, '||'))) return null;
    if (depth === 0 && isKw(x, 'BETWEEN')) between = true;
    if (depth === 0 && (isKw(x, 'AND') || isOp(x, '&&'))) {
      if (between) { between = false; cur.push(x); continue; }
      parts.push(cur); cur = []; continue;
    }
    cur.push(x);
  }
  if (depth !== 0) return null;
  parts.push(cur);
  return parts.filter((x) => x.length > 0);
}

/** 조건 하나가 좁히는 색인 조건인가 — 칸 = 값 · 칸 IN (값, …) · status_code >= 이상값 경계 이상 · 괄호 묶음은 안을 다시 판정 */
function narrows(p: Tok[]): boolean {
  if (isOp(p[0], '(') && isOp(p[p.length - 1], ')')) {
    let d = 0;
    let whole = true;
    for (let i = 0; i < p.length; i++) {
      if (isOp(p[i], '(')) d++;
      if (isOp(p[i], ')')) d--;
      if (d === 0 && i < p.length - 1) { whole = false; break; }
    }
    if (whole) return hasNarrowingIndex(p.slice(1, -1));
  }
  if (!isCol(p[0])) return false;
  if (isOp(p[1], '=')) return valueEnd(p, 2) === p.length;
  if (isKw(p[1], 'IN') && isOp(p[2], '(') && isOp(p[p.length - 1], ')')) {
    let i = 3;
    for (;;) {
      const e = valueEnd(p, i);
      if (e < 0) return false;
      if (e === p.length - 1) return true;
      if (!isOp(p[e], ',')) return false;
      i = e + 1;
    }
  }
  return p[0].t.toLowerCase() === 'status_code' && isOp(p[1], '>=') && isInt(p[2]) && p.length === 3 && Number(p[2].t) >= ABNORMAL_STATUS_FLOOR;
}

/** WHERE 몸통의 최상위 AND 에 좁히는 색인 조건이 하나 이상 있는가 */
function hasNarrowingIndex(w: Tok[]): boolean {
  const parts = topLevelAnd(w);
  return parts !== null && parts.some(narrows);
}

/** 행을 읽지 않는 문장의 첫 낱말(정의 · 잠금 · 관리 · 거래) · EXPLAIN · DESCRIBE 는 ANALYZE 가 붙으면 실제로 돌므로 판정 */
const NO_SCAN_LEAD = ['SHOW', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'LOCK', 'UNLOCK', 'ANALYZE', 'OPTIMIZE', 'CHECK', 'REPAIR', 'FLUSH', 'GRANT', 'REVOKE', 'KILL', 'USE', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'];
/** 판정하는 문장 종류(그 밖 = 판정 불가 · CHECKSUM · HANDLER · PREPARE · CALL · DO · TABLE …) */
const JUDGED_LEAD = ['SELECT', 'WITH', 'UPDATE', 'DELETE', 'INSERT', 'REPLACE', 'SET'];
const BLOCK_STOP = ['GROUP', 'ORDER', 'LIMIT', 'HAVING', 'WINDOW', 'FOR', 'LOCK', 'INTO'];
const SET_OPS = ['UNION', 'EXCEPT', 'INTERSECT'];
const isQueue = (x: Tok | undefined) => !!x && x.k === 'name' && /^SMSQ_SEND/i.test(x.t);
const wordOf = (x: Tok | undefined) => (x && (x.k === 'kw' || x.k === 'name') ? x.t.toUpperCase() : '');

/** 문장 종류 판정 — 'skip' = 행을 읽지 않음 · 'judge' = 큐 표마다 판정 · 그 밖 = 판정 불가 사유 */
function statementKind(s: Tok[], li: number): 'skip' | 'judge' | string {
  const lead = wordOf(s[li]);
  if (NO_SCAN_LEAD.includes(lead)) return 'skip';
  if (['EXPLAIN', 'DESCRIBE', 'DESC'].includes(lead)) return isKw(s[li + 1], 'ANALYZE') ? 'judge' : 'skip';
  // CREATE 는 정확히 `CREATE TABLE [IF NOT EXISTS] 이름 LIKE [스키마.]표` 만(본뜨기 = 행을 읽지 않음) · 그 밖(AS SELECT · AS TABLE …) = 판정 불가
  if (lead === 'CREATE') {
    const rest = s.slice(li + 1).map((x) => (x.k === 'kw' ? x.t : x.k === 'op' ? x.t : '#'));
    return /^TABLE (IF NOT EXISTS )?#( \. #)? LIKE #( \. #)?$/.test(rest.join(' ')) ? 'skip' : '판정 불가(CREATE 꼴)';
  }
  return JUDGED_LEAD.includes(lead) ? 'judge' : `판정 불가(문장 종류 ${lead || s[li]?.t || '없음'})`;
}

/** 한 문장(토큰)의 위반 사유 · 없으면 null */
function statementViolation(s: Tok[]): string | null {
  let li = 0;
  while (isOp(s[li], '(')) li++;
  const kind = statementKind(s, li);
  if (kind === 'skip') return null;
  if (kind !== 'judge') return kind;
  // INSERT · REPLACE 의 넣는 표 하나만 건너뜀(INSERT [꾸밈] [INTO] [스키마.]표)
  let target = -1;
  if (isKw(s[li], 'INSERT', 'REPLACE')) {
    let t = li + 1;
    while (isKw(s[t], 'LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY', 'IGNORE')) t++;
    if (isKw(s[t], 'INTO')) t++;
    if (s[t]?.k === 'name' && isOp(s[t + 1], '.')) t += 2;
    target = t;
  }
  const depthAt: number[] = [];
  let d = 0;
  for (const x of s) { depthAt.push(d); if (isOp(x, '(')) d++; if (isOp(x, ')')) d--; }
  for (let r = 0; r < s.length; r++) {
    if (!isQueue(s[r]) || r === target) continue;
    if (isOp(s[r + 1], '.')) continue;                     // 칸 앞 표 이름(SMSQ_SEND_13.status_code)
    const depth = depthAt[r];
    let end = s.length;
    for (let i = r; i < s.length; i++) {
      if (depthAt[i] < depth || (isOp(s[i], ')') && depthAt[i] === depth) || (isKw(s[i], ...SET_OPS) && depthAt[i] === depth)) { end = i; break; }
    }
    const block = s.slice(r, end);
    // 표가 있는지만 보는 꼴 = 정확히 `SELECT … FROM 큐표 LIMIT 0`(routes/campaigns.ts 로그 표 확인) · SQL_CALC_FOUND_ROWS 없음(Codex 구현 1R)
    if (block.length === 3 && isKw(block[1], 'LIMIT') && block[2].k === 'num' && block[2].t === '0' && isKw(s[li], 'SELECT') && !s.some((x) => isKw(x, 'SQL_CALC_FOUND_ROWS'))) continue;
    const w = block.findIndex((x, i) => isKw(x, 'WHERE') && depthAt[r + i] === depth);
    // 블록 안(같은 깊이)에 다른 문장 머리가 있으면 그 WHERE · 조건 끝이 이 표의 것인지 모른다(모르는 집합 연산 · MINUS 등) = 판정 불가
    if (block.some((x, i) => i > 0 && isKw(x, 'SELECT', 'TABLE', 'WITH') && depthAt[r + i] === depth)) return '판정 불가(블록 안 다른 문장)';
    if (w < 0) return '조건 없음';
    let stop = block.length;
    for (let i = w + 1; i < block.length; i++) if (isKw(block[i], ...BLOCK_STOP) && depthAt[r + i] === depth) { stop = i; break; }
    if (!hasNarrowingIndex(block.slice(w + 1, stop))) return '좁히는 색인 조건 없음';
  }
  return null;
}

/** 모양 = 토큰을 다시 이은 글(값 = ? · 숫자 = N · 표 번호 = n · 목록 = … · 160자) — 고객 값이 실리지 않는다 */
function shapeOf(toks: Tok[]): string {
  return toks
    .map((x) => (x.k === 'val' ? '?' : x.k === 'num' ? 'N' : x.k === 'name' ? x.t.replace(/^SMSQ_SEND_\d+/i, 'SMSQ_SEND_n') : x.t))
    .join(' ')
    .replace(/(?:\?|N)(?: , (?:\?|N))+/g, '…')
    .slice(0, 160);
}

/**
 * 실제로 나갈 SQL 글(값을 채운 뒤) 판정 · 큐 표에 닿지 않거나 좁히면 null · 아니면 { 사유, 모양 }.
 */
export function queueScanVerdict(sql: string): { reason: string; shape: string } | null {
  const { toks, error } = lex(sql);
  if (error) return { reason: `판정 불가(${error})`, shape: shapeOf(toks) };
  let start = 0;
  for (let i = 0; i <= toks.length; i++) {
    if (i < toks.length && !isOp(toks[i], ';')) continue;
    const s = toks.slice(start, i);
    start = i + 1;
    if (s.length === 0) continue;
    // 큐 표 이름 토큰이 없어도 모르는 문장 종류면 판정 불가(PREPARE … FROM '…SMSQ_SEND…' 처럼 글 안에 큐 SQL 을 실을 수 있다)
    let li = 0;
    while (isOp(s[li], '(')) li++;
    const kind = statementKind(s, li);
    if (kind !== 'skip' && kind !== 'judge') return { reason: kind, shape: shapeOf(s) };
    if (!s.some(isQueue)) continue;
    const reason = statementViolation(s);
    if (reason) return { reason, shape: shapeOf(s) };
  }
  return null;
}

export interface QueueScanViolation { via: string; reason: string; shape: string }
type Reporter = (v: QueueScanViolation) => unknown;

/** 6시간(시스템 경보의 같은 항목 다시 알림 간격과 같다) · 모양 상한 */
const REPORT_GAP_MS = 6 * 60 * 60 * 1000;
const MAX_SHAPES = 200;
const reportedAt = new Map<string, number>();
let capLogged = false;

/**
 * 기본 보고 = 시스템 경보 원장(alertPassFailures · 사건 모드 · 원장에 먼저 쓰고 보냄 · 재기동 뒤 부팅 때 다시 보냄).
 * 늦게 가져온다(system-alert → config/database → 이 파일 순환을 피함 · 위반이 처음 날 때 한 번 불러온다).
 */
const defaultReporter: Reporter = (v) => import('./system-alert').then((m) => m.alertPassFailures({
  pass: 'queue-scan-guard',
  title: '큐 표를 좁히지 않는 SQL 이 나갔습니다(표 전체를 훑을 수 있음 · R94).',
  failures: [{ companyId: null, key: `${v.via}|${v.reason}|${v.shape}`, error: `${v.via} · ${v.reason} · ${v.shape}` }],
  action: '서버 로그 [queue-scan-guard] 줄의 SQL 모양을 찾아 그 쿼리 조건에 app_etc1 · dest_no · seqno · status_code 색인 조건을 넣어 주세요.',
}));
let reporter: Reporter = defaultReporter;

/** 시험용 — 보고 함수 바꾸기(없으면 기본) · 기록 비우기 */
export function setQueueScanReporter(fn: Reporter | null): void {
  reporter = fn ?? defaultReporter;
  reportedAt.clear();
  capLogged = false;
}

/**
 * MySQL 실행 함수가 실행 직전에 부른다(via = 실행 함수 이름). 던지지 않는다 · 기다리지 않는다 · 반환값 없음.
 * 빠른 길 = 글에 SMSQ_SEND 도 `??`(이름 자리표시자)도 없음 · SELECT · TABLE 없는 INSERT.
 */
export function noteQueueSql(via: string, sql: unknown, params?: unknown): void {
  try {
    const raw = typeof sql === 'string' ? sql : (sql && typeof (sql as any).sql === 'string' ? (sql as any).sql : null);
    if (raw === null) return;
    if (!/SMSQ_SEND/i.test(raw) && !raw.includes('??')) return;
    if (/^[ \t\n\r\f\v]*INSERT\b/i.test(raw) && !/\b(?:SELECT|TABLE)\b/i.test(raw)) return;
    const values = params ?? (sql && typeof sql === 'object' ? (sql as any).values : undefined);
    const text = values === undefined ? raw : format(raw, values as any);
    const v = queueScanVerdict(text);
    if (v) report({ via, reason: v.reason, shape: v.shape });
  } catch (e: any) {
    try { report({ via, reason: `판정 불가(${String(e?.message || e).slice(0, 60)})`, shape: '' }); } catch { /* 보고도 못 하면 조용히 */ }
  }
}

/** 로그 한 줄(같은 모양 = 6시간에 한 번) + 보고(기다리지 않음 · 실패는 로그) */
function report(v: QueueScanViolation): void {
  const key = `${v.via}|${v.reason}|${v.shape}`;
  const now = Date.now();
  const last = reportedAt.get(key);
  if (last !== undefined && now - last < REPORT_GAP_MS) return;
  if (last === undefined && reportedAt.size >= MAX_SHAPES) {
    for (const [k, at] of reportedAt) if (now - at >= REPORT_GAP_MS) reportedAt.delete(k);
    if (reportedAt.size >= MAX_SHAPES) {
      if (!capLogged) { capLogged = true; console.warn(`[queue-scan-guard] 모양 상한 ${MAX_SHAPES} — 새 모양은 6시간 안에 알리지 않음: ${v.via} · ${v.reason} · ${v.shape}`); }
      return;
    }
  }
  reportedAt.set(key, now);
  console.warn(`[queue-scan-guard] 큐 표 전체 훑기 의심 — ${v.via} · ${v.reason} · ${v.shape}`);
  void Promise.resolve()
    .then(() => reporter(v))
    .catch((e: any) => console.warn(`[queue-scan-guard] 경보 보고 실패(로그 줄이 기록): ${String(e?.message || e).slice(0, 120)}`));
}
