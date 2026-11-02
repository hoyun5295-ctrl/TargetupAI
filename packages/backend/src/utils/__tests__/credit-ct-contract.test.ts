/**
 * 크레딧 컨트롤타워 계약 시험 (★ 2026-11-01 뿌리 R39 · 설계서 docs/2026-11-01-credit-control-tower-design.md §15 · §16)
 *
 * Harold 1101 밤 「크레딧을 컨트롤타워화 했으면 파편화 되어있는걸 모아서 컨트롤타워에서 처리를 하도록 싹 다 바꿔야」 ·
 * 「여러곳에서 사용할 기능은 제발 좀 컨트롤타워화」. C90 은 잔액 · 원장을 쓰는 자리(R38)만 모았고, 읽기 · 판정 · 단가 · 한도 ·
 * 체험 수명 · 경보는 기능 파일에 남아 있었다(§15 전수 = 17파일).
 * 이 시험은 대상을 소스에서 기계로 뽑는다(손 등재 표 0) · 면제 = 이유 필수 · 낡은 면제 = 실패.
 * (root-ledger.test.ts 와 같은 방식 · 그 파일은 다른 작업이 고치는 중이라 이 뿌리는 이 파일에 둔다)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { createHash } from 'crypto';

const BE = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const be = (rel: string) => read(join(BE, rel));

/** 운영 소스 파일 전수(시험 · 빌드 산출물 제외) */
function sourceFiles(root: string, ext: RegExp): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => ext.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.(test|spec|verify)\.tsx?$/.test(f) && !/(^|\/)(dist|dist-old|node_modules)\//.test(f));
}
/** 주석을 걷는다(줄 · 블록 · JSX 주석) */
function stripComments(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
/**
 * 글 전부 = TypeScript 구문 나무로 모은다(Codex 설계 2R-2 · 3R-3 · 4R-2 · 4R-3).
 *   조각 = 작은 · 큰따옴표 글 · 백틱(템플릿 머리 · 사이 · 꼬리 · 템플릿 안 템플릿까지) / 식 = 글 · 템플릿 · `+` 사슬의 가장 바깥.
 * 이름 → 값 = **컴파일러 결속**(Codex 설계 4R-3 · 5R-1 · 6R-1 = 손으로 선언을 모아 접다 우회된 같은 부류 세 번 → 구조 처방):
 *   백엔드 소스 전체를 한 프로그램으로 묶고(모듈 해석 = 이 소스 파일만 · 패키지 = 안 풀림) 식별자 → 기호(가져오기면 원래 기호) →
 *   선언이 하나이고 초기값 있는 const 일 때만 그 값으로 접는다(다른 파일 const 포함). 그 밖(let · var · 매개변수 · 구조 분해 ·
 *   import = require · 패키지 · 함수 결과) = 빈칸(HOLE). 빈칸이 하나라도 있으면 끝까지 안 접힌 식 = 동적(면제 안 함).
 * 정적 검사의 경계(모델 밖) = 실행 중에 정해지는 이름(카탈로그 · 자료로 고르는 표 · 칸) — 운영 소스에는 회사 삭제 도구(fk-delete-plan ·
 *   카탈로그) · 문자 큐 회선 표 · 보관 기한 규칙 표뿐이다(설계서 16-1 실측 1101).
 */
interface StrExpr { folded: string | null; partial: string; fragments: string[] }
const BE_FILES = sourceFiles(BE, /\.ts$/);
/** 접히지 않는 자리 표시(부분 값 안) */
const HOLE = '\u0000';
/** 메모리 안 소스로 만든 프로그램(표준 라이브러리 · 패키지 없음 · 모듈 해석은 이 표의 파일만) */
function programOf(files: Record<string, string>): ts.Program {
  const dirs = new Set<string>();
  for (const f of Object.keys(files)) for (let d = f.slice(0, f.lastIndexOf('/')); d; d = d.slice(0, d.lastIndexOf('/'))) dirs.add(d);
  const host: ts.CompilerHost = {
    getSourceFile: (n, lang) => (files[n] === undefined ? undefined : ts.createSourceFile(n, files[n], lang, true, ts.ScriptKind.TS)),
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => files[f] !== undefined,
    readFile: (f) => files[f],
    directoryExists: (d) => d === '/' || dirs.has(d.replace(/\/$/, '')),
  };
  return ts.createProgram(Object.keys(files), { noLib: true, types: [], target: ts.ScriptTarget.Latest, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 }, host);
}
function analyzeStrings(sf: ts.SourceFile, checker: ts.TypeChecker): { fragments: string[]; exprs: StrExpr[] } {
  const constInit = (id: ts.Identifier): ts.Expression | null => {
    let sym = checker.getSymbolAtLocation(id);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const d = sym?.declarations?.length === 1 ? sym.declarations[0] : null;
    return d && ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && d.initializer && ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const ? d.initializer : null;
  };
  /** 부분 값 = 접히는 자리는 값 · 안 접히는 자리는 HOLE */
  const partialFold = (e: ts.Expression, depth = 0): string => {
    if (depth > 30) return HOLE;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isParenthesizedExpression(e)) return partialFold(e.expression, depth + 1);
    if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((sp) => partialFold(sp.expression, depth + 1) + sp.literal.text).join('');
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return partialFold(e.left, depth + 1) + partialFold(e.right, depth + 1);
    if (ts.isIdentifier(e)) {
      const init = constInit(e);
      return init ? partialFold(init, depth + 1) : HOLE;
    }
    return HOLE;
  };
  const isStrish = (n: ts.Node): n is ts.Expression =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) ||
    (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken);
  const fragmentsOf = (n: ts.Node): string[] => {
    const out: string[] = [];
    const walk = (x: ts.Node) => {
      if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) out.push(x.text);
      else if (ts.isTemplateExpression(x)) out.push(x.head.text, ...x.templateSpans.map((s) => s.literal.text));
      ts.forEachChild(x, walk);
    };
    walk(n);
    return out;
  };
  const fragments: string[] = [];
  const exprs: StrExpr[] = [];
  const visit = (n: ts.Node) => {
    if (isStrish(n) && !(n.parent && isStrish(n.parent))) {
      const f = fragmentsOf(n);
      const partial = partialFold(n);
      const folded = partial.includes(HOLE) ? null : partial;
      fragments.push(...f, partial.split(HOLE).join(' '));
      exprs.push({ folded, partial, fragments: f });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { fragments, exprs };
}
const analysisCache = new Map<string, ReturnType<typeof analyzeStrings>>();
let beProgram: ts.Program | null = null;
const analysisOf = (f: string) => {
  if (!analysisCache.has(f)) {
    beProgram ??= programOf(Object.fromEntries(BE_FILES.map((x) => [`/${x}`, be(x)])));
    analysisCache.set(f, analyzeStrings(beProgram.getSourceFile(`/${f}`)!, beProgram.getTypeChecker()));
  }
  return analysisCache.get(f)!;
};
/** 오류 안내 글(사용 문맥 예외) — 칸 이름을 사람에게 알리는 문장이지 SQL 이 아니다 */
const isMigrationNotice = (s: string) => /^\s*DB 마이그레이션 필요/.test(s);
/**
 * 평범한 SQL 토큰(면제 문장 판정 전용 · Codex 설계 7R~11R 구조 처방). 면제 문장은 어휘 허용 목록(NOT_PLAIN_SQL)을 먼저 통과해야 하므로
 *   여기 오는 글에는 주석 · 달러 글 · E 글 · U& · 백슬래시 · 세미콜론이 없다 = PG 와 이 토큰기가 같게 자르는 부분집합만 다룬다:
 *   w = 낱말(대문자 · 식별자 규칙 = 비ASCII · $ 이어짐) · q = 큰따옴표 이름("" 이스케이프) · s = 작은따옴표 글('' 이스케이프) · p = 기호 · 자리표.
 */
type SqlTok = { k: 'w' | 'q' | 's' | 'p'; v: string };
const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const IDENT_CONT = /[A-Za-z0-9_$\u0080-\uffff]/;
function sqlTokens(src: string): SqlTok[] {
  const out: SqlTok[] = [];
  const n = src.length;
  let i = 0;
  const quoted = (q: string): string => {
    let v = '';
    while (i < n) {
      if (src[i] === q) { if (src[i + 1] === q) { v += q; i += 2; continue; } i++; break; }
      v += src[i++];
    }
    return v;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") { i++; out.push({ k: 's', v: quoted("'") }); continue; }
    if (c === '"') { i++; out.push({ k: 'q', v: quoted('"') }); continue; }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CONT.test(src[j])) j++;
      out.push({ k: 'w', v: src.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }
    const param = /^\$\d+/.exec(src.slice(i));
    if (param) { out.push({ k: 'p', v: param[0] }); i += param[0].length; continue; }
    out.push({ k: 'p', v: c });
    i++;
  }
  return out;
}
const isWord = (t: SqlTok | undefined, ...vs: string[]) => !!t && t.k === 'w' && vs.includes(t.v);
/** 쓰기 낱말(행 잠금 FOR [NO KEY] UPDATE 는 아니다) — 면제 문장은 첫 꼴 뒤에 이것이 0 이어야 한다(허용 목록 · Codex 설계 3R-2 · 6R-2) */
const WRITE_WORDS = ['UPDATE', 'INSERT', 'DELETE', 'MERGE', 'TRUNCATE', 'COPY', 'ALTER', 'DROP', 'CREATE', 'GRANT', 'REVOKE'];
const isWriteWordAt = (toks: SqlTok[], i: number) =>
  isWord(toks[i], ...WRITE_WORDS) && !(toks[i].v === 'UPDATE' && (isWord(toks[i - 1], 'FOR') || (isWord(toks[i - 1], 'KEY') && isWord(toks[i - 2], 'NO') && isWord(toks[i - 3], 'FOR'))));
/**
 * 면제 문장의 어휘 허용 목록(Codex 설계 8R) — 주석 · 달러 글 · 세미콜론(여러 문장) · 백슬래시 · E 글 · U& 가 하나라도 있으면 평범한 SQL 이 아니다(글 안이라도 · 보수적).
 *   지금 면제 문장 4개 = 전부 평범(1101 실측).
 */
const NOT_PLAIN_SQL = /--|\/\*|\$(?!\d)|;|\\|\b[Ee]'|\b[Uu]&/;
/** SQL 문장인가(넓게 · 칸 이름이 보이는 글을 대상에 넣는 거름) */
const SQL_KEYWORD = /\b(SELECT|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY|WITH|FROM|JOIN|WHERE|VALUES|ALTER|DROP|CREATE)\b/i;
/**
 * 끝까지 안 접힌 식(동적 SQL)이 요금제 표에 쓸 수 있나 = 정적 글 어디든 쓰기 낱말과 `plans` 가 함께 있다(Codex 설계 7R~11R 같은 부류 다섯 번 → 구조 처방).
 *   빈칸은 실행 때 주석 · 따옴표를 열고 닫아 정적 글의 어휘 구조를 바꿀 수 있어(9R · 10R · 11R) 동적 SQL 의 구조는 정적으로 정할 수 없다 →
 *   토큰 해석을 하지 않고 함께 있으면 대상(불확실하면 막는다). 정상 동적 문장은 사람이 읽고 판정한 지문 표(REVIEWED_DYNAMIC)로만 통과.
 *   쓰기 낱말은 PG 에서 따옴표 · 이스케이프로 쓸 수 없어 정적 낱말로만 실행된다. 정적 표 이름은 맨 낱말 `plans`(대소문자 무관) 또는 큰따옴표 이름으로만
 *   나타난다 → 따옴표 이름 후보 = 내용이 정확히 plans · 앞에 `&`(U& 유니코드 이스케이프 = 글자를 숨길 수 있다 · 이름을 모름) · 바로 앞이 빈칸(실행 때 U&).
 *   빈칸은 **빈칸마다 따로** 비움(글자 사이에 끼어도 같은 낱말) 또는 경계(낱말 앞뒤)로 본다(13R · 전체를 한 가지로 치환하면 섞인 꼴을 놓쳤다) ·
 *   따옴표는 짝을 짓지 않고 하나하나의 앞뒤만 본다(13R · 앞쪽 따옴표가 짝을 어긋나게 했다).
 */
/** 낱말 정규식 — 글자 사이 빈칸(0개 이상)을 허용하고, 빈칸은 낱말 경계도 된다(앞뒤 = 식별자 글자가 아님) */
const holeWord = (w: string, flags = 'i') =>
  new RegExp(`(?<![A-Za-z0-9_$])${[...w].join('\\u0000*')}(?![A-Za-z0-9_$])`, flags);
const DYNAMIC_WRITE_WORDS = ['UPDATE', 'DELETE', 'INSERT', 'MERGE', 'COPY', 'ALTER', 'DROP', 'TRUNCATE'].map((w) => holeWord(w));
/**
 * 표 이름 후보(Codex 설계 12R~14R = 따옴표 주변 빈칸 위치를 하나씩 막다 같은 부류 세 번 → 위치를 따지지 않는다):
 *   ① 맨 낱말 plans(빈칸 끼움 · 대소문자 무관 · 따옴표 이름 "plans" 도 여기서 걸린다 — 따옴표는 낱말 경계)
 *   ② 정적 큰따옴표가 하나라도 있음(따옴표 이름 = U& 유니코드 이스케이프로 글자를 숨길 수 있다 · 여는 · 닫는 따옴표 · U& 를 빈칸이 어디서 대도 정적 따옴표 하나가 남는다)
 *   ③ 기본 유니코드 이스케이프 = 도입자(정적 `\` 또는 빈칸 — 빈칸이 `\` 를 댈 수 있다 · 16R) + hex 4 · `+` hex 6(숫자 사이 빈칸 허용)
 *   ④ 정적 UESCAPE 낱말(사용자 지정 이스케이프 문자 = UESCAPE 가 정적이면 언제나 보인다 · 15R) ⑤ 정적 U& 표기(U 와 & 사이 빈칸 허용 · 16R)
 *   경계 = UESCAPE 까지 빈칸이 대면 이스케이프 문자가 실행 중에 정해진다(모델 밖 · 16-1). 일반 hex 4자리(도입자 없이)는 실측 24곳이 걸려 안 씀.
 */
const PLANS_NAME = [
  holeWord('plans'),
  /"/,
  /[\\\u0000](?:\u0000*[0-9A-Fa-f]){4}|[\\\u0000]\u0000*\+(?:\u0000*[0-9A-Fa-f]){6}/,
  holeWord('UESCAPE'),
  /(?<![A-Za-z0-9_$])U\u0000*&/i,
];
/** 정적 글이 `<` 로 시작 = SQL 아님(HTML 틀) — PG 는 여러 문장 글 전체를 먼저 구문 분석하므로 첫 글자가 구문 오류면 어떤 문장도 실행되지 않는다 */
const notSql = (partial: string) => /^\s*</.test(partial);
const mayWritePlans = (partial: string) =>
  !notSql(partial) && DYNAMIC_WRITE_WORDS.some((r) => r.test(partial)) && PLANS_NAME.some((r) => r.test(partial));

const CREDIT_CT = /^utils\/ai-credit[\w-]*\.ts$/;

/** 원장 · 잔액 · 충전 요청 · 초과 · 월 고정표 · 후불 한도 칸 = CT 밖 0(면제 없음 · SQL 꼴 여부와 무관하게 모든 글) */
const LEDGER_IDENT = /\b(ai_credit_transactions|ai_credits_(?:base_remaining|purchased|reset_at|monthly_cap)|postpaid_overage_limit|overage_credits|plan_month_credits|ai_credit_requests)\b/i;
/**
 * 요금제 월 크레딧 칸 = CT + 요금제 표를 그대로 보이거나 추천하는 (파일 · 문장 꼴) 짝만(Codex 설계 1R-3 · 파일 통째 면제 금지).
 *   이 칸을 바꾸는 UPDATE 는 CT `setPlanMonthCredits` 하나(그 달 고정표 스냅숏과 한 거래).
 */
const PLAN_CREDITS_IDENT = /\bai_credits_per_month\b/i;
const PLAN_CATALOG_EXEMPT: Record<string, { why: string; heads: string[][] }> = {
  'routes/admin.ts': { why: '요금제 만들기(INSERT INTO plans) · 신청 목록(SELECT) = 요금제 표 칸 그대로', heads: [['SELECT'], ['INSERT', 'INTO', 'PLANS']] },
  'utils/marketing-diagnosis-store.ts': { why: '진단 추천 = 요금제 표 칸으로 요금제를 고른다(SELECT · 돈 아님)', heads: [['SELECT']] },
  'utils/plan-term.ts': { why: '선불 기간 요금제 행 = 요금제 표 칸 그대로(SELECT)', heads: [['SELECT']] },
};

/**
 * 사람이 읽고 판정한 동적 SQL(쓰기 낱말 + plans 가 함께 있으나 요금제 표에 쓰지 않는다) = (파일 → 지문 · 이유).
 *   지문 = 부분 값(빈칸 = ⟨?⟩ · 공백 하나로)의 sha256 앞 16자. 문장이 바뀌면 지문이 달라져 빨간불(다시 판정) · 쓰이지 않는 지문 = 실패.
 */
const REVIEWED_DYNAMIC: Record<string, Array<{ fp: string; why: string }>> = {
  'utils/free-messaging.ts': [
    { fp: '290e44a63fab6484', why: '이번 달 무료 문자 지급(전 회사) = free_messaging_grants 에 INSERT · 요금제 표는 SELECT 로 읽기만(칸 이름이 요금제 종류마다 동적)' },
    { fp: 'b7ac583595a644fb', why: '무료 문자 지급(한 회사) = free_messaging_grants 에 INSERT · 요금제 표는 SELECT 로 읽기만(칸 이름이 요금제 종류마다 동적)' },
  ],
  'utils/marketing-diagnosis-grant.ts': [
    { fp: 'ae7ef829c14e9686', why: '진단 체험 지급 자격 = SELECT … FOR UPDATE OF c(회사 행 잠금) · 요금제 표는 읽기만(선불 기간 판정 조각이 함수)' },
  ],
  'utils/billing-issue.ts': [
    { fp: 'a47ca6c737ea6042', why: '청구 발행 수기 항목 읽기 = billing_extra_items SELECT · 쓰기 낱말은 SQL 주석의 「ALTER 실행 전에도」 · 요금제 표 0' },
  ],
  'utils/company-merge.ts': [
    { fp: '73791cef8f714477', why: '회사 병합 = 코드 상수 COMPANY_MERGE_AXES 의 표마다 company_id 만 옮김(표 이름 전체가 빈칸) · plans 에는 company_id 칸이 없다(1101 information_schema 0행)' },
  ],
};
const dynamicFingerprint = (partial: string) =>
  createHash('sha256').update(partial.split(HOLE).join('⟨?⟩').replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
/**
 * 대상 SQL 식 = (SQL 문장이면서 칸 이름이 조각 · 부분 값(다른 파일 const 포함)에 보임) 또는 (끝까지 안 접혔고 쓰기 낱말 + plans · 판정 지문 아님).
 */
function sqlExprsWithIdent(f: string, re: RegExp, reviewed: typeof REVIEWED_DYNAMIC = REVIEWED_DYNAMIC): StrExpr[] {
  return analysisOf(f).exprs.filter((e) => {
    const flat = e.partial.split(HOLE).join(' ');
    if (SQL_KEYWORD.test(flat) && [flat, ...e.fragments].some((t) => re.test(t))) return true;
    return e.folded === null && mayWritePlans(e.partial) && !(reviewed[f] || []).some((r) => r.fp === dynamicFingerprint(e.partial));
  });
}
/**
 * ② 판정 — 면제 파일의 식 = 끝까지 접히고(동적 = 면제 안 함) · 평범한 SQL(어휘 허용 목록 · 한 문장) · 첫 꼴(토큰)이 허용 목록 · 그 뒤 쓰기 낱말 0.
 */
function planCreditsViolations(files: string[], exempt: typeof PLAN_CATALOG_EXEMPT, reviewed: typeof REVIEWED_DYNAMIC = REVIEWED_DYNAMIC): string[] {
  const bad: string[] = [];
  for (const f of files) {
    for (const e of sqlExprsWithIdent(f, PLAN_CREDITS_IDENT, reviewed)) {
      const shown = (e.folded ?? e.fragments.join(' … ')).replace(/\s+/g, ' ').slice(0, 90);
      if (!exempt[f]) { bad.push(`${f}: 면제 아님(동적이면 지문 ${dynamicFingerprint(e.partial)}): ${shown}`); continue; }
      if (e.folded === null) { bad.push(`${f}: 끝까지 접히지 않는 동적 쿼리: ${shown}`); continue; }
      if (NOT_PLAIN_SQL.test(e.folded)) { bad.push(`${f}: 평범한 SQL 아님(주석 · 달러 글 · 세미콜론 · 백슬래시 · E · U& 글): ${shown}`); continue; }
      const toks = sqlTokens(e.folded);
      const head = exempt[f].heads.find((h) => h.every((w, i) => isWord(toks[i], w)));
      if (!head) bad.push(`${f}: 허용 꼴 아님: ${shown}`);
      else if (toks.some((_, i) => i >= head.length && isWriteWordAt(toks, i))) bad.push(`${f}: 쓰기 낱말: ${shown}`);
    }
  }
  return bad;
}
/** ① 판정 — 원장 칸 이름이 든 글 조각 · 접힌 값(오류 안내만 예외) */
const ledgerIdentHit = (f: string) => analysisOf(f).fragments.some((s) => LEDGER_IDENT.test(s) && !isMigrationNotice(s));

describe('R39 크레딧 일 = 크레딧 CT 파일(utils/ai-credit*.ts)만', () => {
  it('① 원장 · 잔액 · 충전 요청 · 초과 · 월 고정표 · 후불 한도 칸 이름이 든 글이 있는 파일 = CT 밖 0(면제 없음 · 오류 안내 글만 문맥 예외)', () => {
    expect(BE_FILES.filter((f) => !CREDIT_CT.test(f)).filter(ledgerIdentHit)).toEqual([]);
  });

  it('② 요금제 월 크레딧 칸 = CT 밖은 면제 (파일 · 문장 꼴) 짝만 · 동적 쿼리 · 바꾸는 문장 0 · 낡은 면제 = 실패', () => {
    const files = BE_FILES.filter((f) => !CREDIT_CT.test(f));
    expect(planCreditsViolations(files, PLAN_CATALOG_EXEMPT)).toEqual([]);
    const live = new Set(files.filter((f) => sqlExprsWithIdent(f, PLAN_CREDITS_IDENT).length > 0));
    expect(Object.keys(PLAN_CATALOG_EXEMPT).filter((f) => !live.has(f))).toEqual([]);
    for (const [f, { why }] of Object.entries(PLAN_CATALOG_EXEMPT)) expect(why.length, f).toBeGreaterThan(10);
    // 판정 지문 = 지금 그 파일에 있는 동적 문장이어야 한다(문장이 바뀌거나 없어지면 낡은 지문 = 실패 · 다시 판정)
    for (const [f, rows] of Object.entries(REVIEWED_DYNAMIC)) {
      const fps = new Set(analysisOf(f).exprs.filter((e) => e.folded === null && mayWritePlans(e.partial)).map((e) => dynamicFingerprint(e.partial)));
      for (const r of rows) {
        expect(fps.has(r.fp), `${f} 낡은 지문 ${r.fp}`).toBe(true);
        expect(r.why.length, `${f} ${r.fp}`).toBeGreaterThan(10);
      }
    }
  });

  it('①② 변이 — 숨긴 쓰기는 전부 빨간불(작은따옴표 · 소문자 · 이어 붙이기 · 템플릿 안 템플릿 · 변수로 나눈 UPSERT)', () => {
    // 변이 소스도 운영 소스와 같은 컴파일러 결속으로 읽는다(extra = 같은 프로그램의 다른 파일 · 없는 모듈 = 안 풀림)
    const probe = (src: string, extra: Record<string, string> = {}, exempt = true) => {
      const p = programOf({ '/routes/admin.ts': src, ...extra });
      analysisCache.set('routes/admin.ts#probe', analyzeStrings(p.getSourceFile('/routes/admin.ts')!, p.getTypeChecker()));
      return {
        ledger: analysisOf('routes/admin.ts#probe').fragments.some((s) => LEDGER_IDENT.test(s) && !isMigrationNotice(s)),
        plan: planCreditsViolations(['routes/admin.ts#probe'], exempt ? { 'routes/admin.ts#probe': PLAN_CATALOG_EXEMPT['routes/admin.ts'] } : {}),
      };
    };
    expect(probe(`query('UPDATE companies SET postpaid_overage_limit = $1 WHERE id = $2', [a, b]);`).ledger).toBe(true);
    expect(probe(`query('update companies set postpaid_overage_limit = $1 where id = $2', [a, b]);`).ledger).toBe(true);
    expect(probe(`query('UPDATE companies SET ' + 'postpaid_' + 'overage_limit = $1' + ' WHERE id = $2', [a]);`).ledger).toBe(true);
    expect(probe('query(`UPDATE companies SET ${`postpaid_overage_limit = $1`} WHERE id = $2`, [a]);').ledger).toBe(true);
    expect(probe("query(`UPDATE companies SET ${'postpaid_' + 'overage_limit'} = $1 WHERE id = $2`, [a]);").ledger).toBe(true);
    expect(probe('query(`UPDATE plans SET ai_credits_per_month = $1 WHERE id = $2`, [a, b]);').plan.length).toBeGreaterThan(0);
    expect(probe("const action = 'DO UPDATE SET'; query('INSERT INTO plans (plan_code, ai_credits_per_month) VALUES ($1,$2) ON CONFLICT (plan_code) ' + action + ' ai_credits_per_month = EXCLUDED.ai_credits_per_month');").plan.length).toBeGreaterThan(0);
    expect(probe("let action = pick(); query('INSERT INTO plans (plan_code, ai_credits_per_month) VALUES ($1,$2) ON CONFLICT (plan_code) ' + action + ' ai_credits_per_month = EXCLUDED.ai_credits_per_month');").plan.length).toBeGreaterThan(0);
    // Codex 설계 5R — 같은 이름 다른 범위 const(접기 거부) · 칸 이름 const + 동적 꼬리 · import 상수 칸 이름 · 동적 꼬리
    expect(probe("const action = 'DO UPDATE SET'; { const action = 'DO NOTHING'; } query('INSERT INTO plans (plan_code, ai_credits_per_month) VALUES ($1,$2) ON CONFLICT (plan_code) ' + action + ' ai_credits_per_month = EXCLUDED.ai_credits_per_month');").plan.length).toBeGreaterThan(0);
    expect(probe("const col = 'ai_credits_per_month'; query('UPDATE plans SET ' + col + ' = $1 WHERE id = $2 ' + tail);").plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './x'; query('UPDATE plans SET ' + COL + ' = $1 WHERE id = $2');").plan.length).toBeGreaterThan(0);
    expect(probe("const col = 'postpaid_overage_limit'; query('UPDATE companies SET ' + col + ' = $1 WHERE id = $2 ' + tail);").ledger).toBe(true);
    // 보수적 실패(거짓 빨간불 = 의도) — 면제 파일이라도 칸 이름이 보이는 SELECT 에 안 풀리는 import 를 끼우면 동적으로 판정해 거부한다
    expect(probe("import { WHERE_X } from './x'; query('SELECT ai_credits_per_month FROM plans ' + WHERE_X);").plan.length).toBeGreaterThan(0);
    // Codex 설계 6R — import = require 와 다른 범위 같은 이름 const · 별칭 있는 동적 UPDATE · 다른 파일 const 로 숨긴 칸 · 여러 문장 · 주석
    expect(probe("import action = require('./clause'); function f() { const action = 'DO NOTHING'; return action; } query('INSERT INTO plans (plan_code, ai_credits_per_month) VALUES ($1,$2) ON CONFLICT (plan_code) ' + action + ' ai_credits_per_month = EXCLUDED.ai_credits_per_month');").plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './x'; query('UPDATE plans p SET ' + COL + ' = $1 WHERE p.id = $2');").plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './x'; query('UPDATE \"public\".\"plans\" AS p SET ' + COL + ' = $1');").plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './x'; query('UPDATE /* 별칭 */ plans SET ' + COL + ' = $1');").plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './cols'; query('UPDATE plans AS p SET ' + COL + ' = $1 WHERE p.id = $2');", { '/routes/cols.ts': "export const COL = 'ai_credits_per_month';" }).plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './cols'; query('UPDATE companies SET ' + COL + ' = $1 WHERE id = $2');", { '/routes/cols.ts': "export const COL = 'postpaid_overage_limit';" }).ledger).toBe(true);
    expect(probe("query('SELECT ai_credits_per_month FROM plans; UPDATE plans AS p SET ai_credits_per_month = 0');").plan.length).toBeGreaterThan(0);
    expect(probe("query('SELECT ai_credits_per_month FROM plans WHERE id = $1 RETURNING (SELECT 1 FROM x) -- \\n UPDATE plans AS p SET ai_credits_per_month = 0');").plan.length).toBeGreaterThan(0);
    // Codex 설계 7R — 글 안 주석 기호 뒤 쓰기(작은따옴표 · E 글 · 달러 글) · 동적 TRUNCATE(SQL 거름과 따로) · DO 몸통 안 동적 쓰기
    expect(probe("query(\"SELECT '--', ai_credits_per_month FROM plans; UPDATE plans SET ai_credits_per_month = 0\");").plan.length).toBeGreaterThan(0);
    expect(probe("query(\"SELECT E'it\\\\'s -- x', ai_credits_per_month FROM plans; UPDATE plans SET ai_credits_per_month = 0\");").plan.length).toBeGreaterThan(0);
    expect(probe("query('SELECT $$ -- $$, ai_credits_per_month FROM plans; UPDATE plans SET ai_credits_per_month = 0');").plan.length).toBeGreaterThan(0);
    expect(probe("const mode = cascade ? 'CASCADE' : 'RESTRICT'; query('TRUNCATE plans ' + mode);").plan.length).toBeGreaterThan(0);
    expect(probe("const mode = cascade ? 'CASCADE' : 'RESTRICT'; query('TRUNCATE TABLE audit_x, ONLY public.\"plans\" ' + mode);", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './x'; query('DO $$ BEGIN UPDATE plans SET ' + COL + ' = 0; END $$');", {}, false).plan.length).toBeGreaterThan(0);
    // Codex 설계 8R — CR 로 끝나는 줄 주석 · 비ASCII 달러 태그(면제 = 어휘 허용 목록 · 동적 = PG 어휘 규칙) · DROP TABLE 목록 둘째 대상 · U& 이름 · 빈칸이 글을 닫는 꼴
    expect(probe("query('SELECT ai_credits_per_month FROM plans -- x\\r; UPDATE plans SET ai_credits_per_month = 0');").plan.length).toBeGreaterThan(0);
    expect(probe("query(\"SELECT $가$'$가$; UPDATE plans SET ai_credits_per_month = 0 -- '\");").plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './x'; query('SELECT 1 -- x\\r UPDATE plans SET ' + COL + ' = 0');", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './x'; query(\"SELECT $가$x$가$; UPDATE plans SET \" + COL + \" = 0\");", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("const mode = cascade ? 'CASCADE' : 'RESTRICT'; query('DROP TABLE IF EXISTS audit_x, public.plans ' + mode);", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("import { COL } from './x'; query('UPDATE U&\"pl\\\\0061ns\" SET ' + COL + ' = 0');", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("import { Q, COL } from './x'; query(\"SELECT '\" + Q + \"; UPDATE plans SET \" + COL + \" = 0; --'\");", {}, false).plan.length).toBeGreaterThan(0);
    // Codex 설계 9R — 글 밖 빈칸이 실행 때 주석을 열어 뒤 글의 경계를 바꾸는 꼴(prefix = '1 --' 이면 줄바꿈 뒤 TRUNCATE 가 실행된다)
    expect(probe("export function f(prefix: string) { return query(\"SELECT \" + prefix + \"'x\\n; TRUNCATE plans CASCADE; --'\"); }", {}, false).plan.length).toBeGreaterThan(0);
    // Codex 설계 10R — 쓰기 낱말 뒤 주석(경계를 지우면 주석 본문이 표 이름 자리에 온다) · 쓰기 낱말과 표 이름 사이 빈칸 · 빈칸 스키마
    expect(probe("export function f(prefix: string) { return query(\"SELECT \" + prefix + \"'x\\n; TRUNCATE/*note*/plans CASCADE; --'\"); }", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("import { X } from './x'; query('TRUNCATE ' + X + ' plans CASCADE');", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("import { S } from './x'; query('UPDATE ' + S + '.plans SET plan_name = $1');", {}, false).plan.length).toBeGreaterThan(0);
    // 보수적 실패(의도 · 11R 구조 처방) — 동적 SQL 에 쓰기 낱말과 plans 가 함께 있으면 읽기만 하는 꼴도 대상(사람 판정 지문 표로만 통과)
    const readOnly = "import { T } from './x'; query('DELETE FROM ' + T + ' USING plans p WHERE p.id = $1');";
    expect(probe(readOnly, {}, false).plan.length).toBeGreaterThan(0);
    const fp = /지문 ([0-9a-f]{16})/.exec(probe(readOnly, {}, false).plan[0])![1];   // 바로 위 변이 소스의 분석이 그대로 남아 있다
    expect(planCreditsViolations(['routes/admin.ts#probe'], {}, { 'routes/admin.ts#probe': [{ fp, why: '시험 — 사람이 판정한 지문은 통과' }] })).toEqual([]);
    // Codex 설계 11R — 주석 안 빈칸이 주석을 닫아 뒤 정적 표 이름이 코드가 되는 꼴
    expect(probe("export function f(endComment: string) { return query('TRUNCATE /*' + endComment + 'plans CASCADE'); }", {}, false).plan.length).toBeGreaterThan(0);
    // Codex 설계 12R — 빈 빈칸이 U& 와 따옴표 사이 · U 와 & 사이 · 따옴표 앞(실행 때 U&) · 따옴표 이름 안 · 쓰기 낱말 안을 가르는 꼴
    for (const q of [
      "'TRUNCATE U&' + gap + '\"\\\\0070lans\" CASCADE'",
      "'TRUNCATE U' + gap + '&\"\\\\0070lans\" CASCADE'",
      "'TRUNCATE ' + gap + '\"\\\\0070lans\" CASCADE'",
      "'TRUNCATE \"pl' + gap + 'ans\" CASCADE'",
      "'TRUN' + gap + 'CATE plans CASCADE'",
    ]) expect(probe(`export function f(gap: string) { return query(${q}); }`, {}, false).plan.length, q).toBeGreaterThan(0);
    // Codex 설계 13R — 앞쪽 큰따옴표가 짝 짓기를 어긋나게 하는 꼴 · 빈칸마다 비움 · 띄움이 섞인 꼴
    expect(probe("export function f(gap: string) { return query('/* \" */ TRUNCATE U&\"\\\\0070lans\" CASCADE' + gap); }", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("export function f(a: string, b: string) { return query('TRUN' + a + 'CATE' + b + 'plans CASCADE'); }", {}, false).plan.length).toBeGreaterThan(0);
    // 거짓 빨간불 없음 — `<` 로 시작하는 HTML 틀(SQL 로 실행될 수 없다) · 빈칸이 앞에 있으면 첫 글자를 모르므로 그대로 대상
    expect(probe("export function f(x: string) { return render('<div title=\"' + x + '\">Copy plans</div>'); }", {}, false).plan).toEqual([]);
    expect(probe("export function f(x: string) { return query(x + '<div>; TRUNCATE plans'); }", {}, false).plan.length).toBeGreaterThan(0);
    // 보수적 실패(의도 · 14R 구조 처방) — 동적 쓰기 SQL 에 정적 큰따옴표가 있으면 표 이름 전체가 빈칸이어도 대상(회사 병합 = 판정 지문 표로 통과)
    expect(probe("export function f(t: string) { return query('UPDATE \"' + t + '\" SET company_id = $2 WHERE company_id = $1'); }", {}, false).plan.length).toBeGreaterThan(0);
    // Codex 설계 14R — 닫는 따옴표까지 빈칸이 대는 꼴 · 따옴표를 전부 빈칸이 대도 본문의 유니코드 이스케이프는 정적으로 남는 꼴
    expect(probe("export function f(p: string, q: string) { return query('TRUNCATE ' + p + '\"\\\\0070lans' + q); }", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("export function f(p: string, q: string) { return query('TRUNCATE ' + p + '\\\\0070lans' + q); }", {}, false).plan.length).toBeGreaterThan(0);
    // Codex 설계 15R — 정적 UESCAPE 사용자 지정 이스케이프 · 기본 이스케이프 숫자 사이 빈칸
    expect(probe("export function f(p: string, q: string) { return query('TRUNCATE ' + p + '!0070lans' + q + \" UESCAPE '!'\"); }", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("export function f(p: string, g: string, q: string) { return query('TRUNCATE ' + p + '\\\\00' + g + '70lans' + q); }", {}, false).plan.length).toBeGreaterThan(0);
    // Codex 설계 16R — 기본 이스케이프 `\` 를 빈칸이 대는 꼴(정적 U& · U& 까지 빈칸)
    expect(probe("export function f(p: string, q: string) { return query('TRUNCATE U&' + p + '0070lans' + q + ' CASCADE'); }", {}, false).plan.length).toBeGreaterThan(0);
    expect(probe("export function f(p: string, q: string) { return query('TRUNCATE ' + p + '0070lans' + q + ' CASCADE'); }", {}, false).plan.length).toBeGreaterThan(0);
    // 거짓 빨간불 없음 — 주석이 든 칸 이름 없는 동적 SELECT(요금제 표를 읽기만)
    expect(probe("query('SELECT c.*, p.plan_code -- 설명\\n FROM companies c LEFT JOIN plans p ON p.id = c.plan_id WHERE ' + where);", {}, false).plan).toEqual([]);
    // 거짓 빨간불 없음 — 따옴표 이름 · 글 안 쓰기 낱말이 있는 평범한 SELECT
    expect(probe("query(\"SELECT 'UPDATE' AS x, \\\"UPDATE\\\" AS y, ai_credits_per_month FROM plans WHERE id = $1\");").plan).toEqual([]);
    // 보수적 실패(의도) — 면제 문장은 글 안이라도 주석 기호가 있으면 평범한 SQL 이 아니라 거부한다(어휘 허용 목록 · 8R)
    expect(probe("query(\"SELECT '--' AS x, ai_credits_per_month FROM plans WHERE id = $1\");").plan.length).toBeGreaterThan(0);
    // 거짓 빨간불 없음 — 행 잠금 FOR UPDATE SELECT · 칸 이름 없는 동적 SELECT(면제 아닌 파일 · 다른 파일 const 접힘)
    expect(probe("query('SELECT ai_credits_per_month FROM plans WHERE id = $1 FOR UPDATE');").plan).toEqual([]);
    expect(probe("import { COLS } from './cols'; query('SELECT ' + COLS + ' FROM plans p WHERE p.id = $1');", { '/routes/cols.ts': "export const COLS = 'plan_code, monthly_price';" }, false).plan).toEqual([]);
    // 정상(면제 꼴) = 통과 · 오류 안내 글 = 통과
    expect(probe('query(`INSERT INTO plans (plan_code, ai_credits_per_month) VALUES ($1, $2) RETURNING *`, [a, b]);').plan).toEqual([]);
    expect(probe("res.json({ error: 'DB 마이그레이션 필요: ai_credit_requests 테이블 생성 요청' });").ledger).toBe(false);
  });

  it('③ 월 AI 호출 수 한도 = 없음(Harold 1101 「한도를 두는거 자체가 문제」 · 크레딧 하나로)', () => {
    const FE = join(BE, '..', '..', 'frontend', 'src');
    const LIMIT = /\b(checkAiRateLimit|AiRateLimitExceeded|isAiCallLimitExempt|AI_CALL_LIMIT_EXEMPT_SOURCES|aiLimitCountedSql|ai_calls_per_month|AI_RATE_LIMIT)\b/;
    const be1 = BE_FILES.filter((f) => LIMIT.test(stripComments(be(f))));
    const fe1 = sourceFiles(FE, /\.(ts|tsx)$/).filter((f) => LIMIT.test(stripComments(read(join(FE, f)))));
    expect([...be1, ...fe1.map((f) => `frontend/${f}`)]).toEqual([]);
  });

  it('④ 기능 소개 창 크레딧 숫자 = 손으로 적지 않는다(서버가 단가표로 채운다)', () => {
    expect(stripComments(be('content/plan-feature-intros.ts')).match(/\bcredits:\s*\d/g) || []).toEqual([]);
  });

  it('⑤ 체험 끝 = 만료 시각(강등 작업 1분마다 · 하루 한 번 04:00 아님)', () => {
    const w = stripComments(be('utils/trial-downgrade-worker.ts'));
    expect(w).not.toMatch(/msUntilNextKst04/);
    expect(w).toMatch(/setInterval\([\s\S]{0,200}?60 \* 1000\)/);
  });

  it('⑥ 주기 작업(워커 · 패스)은 반복문 catch 안에서 항목마다 경보하지 않는다(실패를 모아 한 주기 1통 = alertPassFailures · §16-6)', () => {
    /**
     * 대상 = routes 밖 전수(★ 1102 설계 §17-4 C1 — 옛 「그 파일에 setInterval · cron · schedule」 거름은 타이머를 다른 파일에서 거는 패스(발송 전 검사 스캔)를 못 봤다) ·
     *   경보 = sendSystemAlert 직접 또는 그것을 부르는 함수(한 단계 · 이름은 소스에서 뽑는다) · routes = 요청 경로(한 요청 = 한 사건).
     * 자리 = 경보 호출 → (함수 경계 전에) catch → 반복문. 원인 하나(공급자 · DB · 코드)가 N 항목을 막으면 N 통이던 꼴(1101 월 마감 100통).
     * 면제 = 그 자리를 감싼 함수 이름 → 이유(반복이 한 사건 안의 축일 때만) · 낡은 면제 = 실패.
     */
    const PER_ITEM_OK: Record<string, string> = {
      'utils/direct-send-core.ts createDirectSendCampaign': '반복 = 캠페인 하나의 채널 축(최대 2) · 키 = 캠페인 · 실패하면 반복을 끝낸다(원인 하나가 N 항목을 막는 꼴 아님)',
    };
    const perItemPassAlerts = (files: Record<string, string>, ok: Record<string, string> = {}): string[] => {
      const sfs = Object.entries(files).map(([f, src]) => ({ f, src, sf: ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true) }));
      const callee = (n: ts.Node) => (ts.isCallExpression(n)
        ? (ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : null) : null);
      const fnNameOf = (n: ts.Node): string | null => {
        for (let p = n.parent; p; p = p.parent) {
          if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
          if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent)) return p.parent.name.getText();
        }
        return null;
      };
      const alerters = new Set<string>(['sendSystemAlert']);
      for (const { sf } of sfs) {
        const v = (n: ts.Node): void => { if (callee(n) === 'sendSystemAlert') { const fn = fnNameOf(n); if (fn) alerters.add(fn); } ts.forEachChild(n, v); };
        v(sf);
      }
      alerters.delete('alertPassFailures');
      const loopCatch = (n: ts.Node): boolean => {
        let sawCatch = false;
        for (let p = n.parent; p; p = p.parent) {
          if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) return false;
          if (ts.isCatchClause(p)) sawCatch = true;
          if (ts.isForOfStatement(p) || ts.isForStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return sawCatch;
        }
        return false;
      };
      const hits: string[] = [];
      const used = new Set<string>();
      for (const { f, sf } of sfs) {
        if (f.startsWith('routes/')) continue;
        const v = (n: ts.Node): void => {
          const c = callee(n);
          if (c && alerters.has(c) && loopCatch(n)) {
            const own = `${f} ${fnNameOf(n) ?? '(이름 없음)'}`;
            if (ok[own]) used.add(own);
            else hits.push(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${c}`);
          }
          ts.forEachChild(n, v);
        };
        v(sf);
      }
      for (const k of Object.keys(ok)) if (!used.has(k)) hits.push(`낡은 면제: ${k}`);
      return hits;
    };
    expect(perItemPassAlerts(Object.fromEntries(BE_FILES.map((f) => [f, be(f)])), PER_ITEM_OK)).toEqual([]);
    for (const [k, why] of Object.entries(PER_ITEM_OK)) expect(why.length, k).toBeGreaterThan(10);
    // 변이 — 직접 · 한 단계 간접은 잡고, 모아서 1통 · 요청 경로(routes)는 잡지 않는다 · 타이머가 다른 파일에 있는 패스도 잡는다(1102 빈틈) · 면제는 그 함수만 · 낡은 면제는 잡힌다
    const loop = (body: string) => `setInterval(tick, 1000);\nasync function tick() { for (const x of xs) { try { await work(x); } catch (e) { ${body} } } }`;
    const pass = 'async function h() { for (const x of xs) { try { await work(x); } catch (e) { await sendSystemAlert({}); } } }';
    expect(perItemPassAlerts({ 'utils/w.ts': loop('await sendSystemAlert({ companyId: x, dedupKey: x });') })).toHaveLength(1);
    expect(perItemPassAlerts({ 'utils/w.ts': loop('await alertX(x, e);'), 'utils/a.ts': 'export async function alertX() { await sendSystemAlert({}); }' })).toHaveLength(1);
    expect(perItemPassAlerts({ 'utils/w.ts': loop('failures.push({ companyId: x, error: String(e) });') + '\nawait alertPassFailures({});' })).toEqual([]);
    expect(perItemPassAlerts({ 'routes/r.ts': pass })).toEqual([]);
    expect(perItemPassAlerts({ 'utils/p.ts': pass })).toHaveLength(1);
    expect(perItemPassAlerts({ 'utils/p.ts': pass }, { 'utils/p.ts h': '반복 = 한 사건 안의 축 · 시험' })).toEqual([]);
    expect(perItemPassAlerts({ 'utils/p.ts': pass }, { 'utils/p.ts other': '반복 = 한 사건 안의 축 · 시험' })).toEqual(['utils/p.ts:1 sendSystemAlert', '낡은 면제: utils/p.ts other']);
  });

  it('⑦ AI 호출 금액 = 크레딧 CT aiCallCost 하나 · 호출부는 금액(creditCost) 대신 사실(charge) · 사실의 부모 = 단가표 값 > 0 인 원천(§16-3)', async () => {
    const { CREDIT_COST_MAP, aiCallCost } = await import('../ai-credit-calc');
    // (가) CT 밖 코드에 금액 칸 0
    expect(BE_FILES.filter((f) => !CREDIT_CT.test(f) && /\bcreditCost\b/.test(stripComments(be(f))))).toEqual([]);
    // (나) 사실 = 소스에서 뽑는다(손 등재 표 0) · 종류 넷 · 부모 원천 = 단가표 값 > 0 · 내부 = 이유
    const facts = BE_FILES.filter((f) => !CREDIT_CT.test(f)).flatMap((f) =>
      [...stripComments(be(f)).matchAll(/charge:\s*\{\s*kind:\s*'([a-z-]+)',\s*(of|by|parent|why):\s*'([^']*)'\s*\}/g)].map((m) => ({ f, kind: m[1], key: m[2], val: m[3] })));
    expect(facts.length).toBeGreaterThanOrEqual(24);   // 뽑기가 죽으면 0(1102 실측 = 캘린더 두 곳 포함 24)
    const bad = facts.filter((x) => x.kind === 'internal'
      ? !(x.key === 'why' && x.val.length > 5)
      : !({ retry: 'of', 'settled-by': 'by', 'included-in': 'parent' } as Record<string, string>)[x.kind] || ({ retry: 'of', 'settled-by': 'by', 'included-in': 'parent' } as Record<string, string>)[x.kind] !== x.key || !((CREDIT_COST_MAP[x.val] ?? 0) > 0));
    expect(bad.map((x) => `${x.f} ${x.kind} ${x.key}=${x.val}`)).toEqual([]);
    // (다) 금액 — 문안 생성 첫 호출 = 단가(5) · 보정 재시도 = 0 · 묶음 안 = 0
    expect(aiCallCost('generate-messages', undefined, false)).toBe(5);
    expect(aiCallCost('generate-messages', { kind: 'retry', of: 'generate-messages' }, false)).toBe(0);
    expect(aiCallCost('generate-messages', undefined, true)).toBe(0);
  });

  it('⑧ 금액 규칙 = 크레딧 CT(§16-3 P1 · P3) — CT 밖은 단가를 더하거나 빼지 않고(조합 = 규칙 · ai-credit-price) · 묶음 여부를 읽지 않는다(진입점 금액 = entryCreditCost)', () => {
    /** 단가 조합(getCreditCost 가 + · − 의 한 쪽) · 묶음 읽기(isInCreditBundle 호출) 자리 */
    const priceRuleSites = (rel: string, src: string): string[] => {
      const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true);
      const hits: string[] = [];
      const callee = (n: ts.Node) => (ts.isCallExpression(n) && ts.isIdentifier(n.expression) ? n.expression.text : null);
      const visit = (n: ts.Node): void => {
        const name = callee(n);
        let p = n.parent;
        while (p && ts.isParenthesizedExpression(p)) p = p.parent;
        const combined = name === 'getCreditCost' && p && ts.isBinaryExpression(p)
          && (p.operatorToken.kind === ts.SyntaxKind.PlusToken || p.operatorToken.kind === ts.SyntaxKind.MinusToken);
        if (combined || name === 'isInCreditBundle') hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${name}`);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return hits;
    };
    expect(BE_FILES.filter((f) => !CREDIT_CT.test(f)).flatMap((f) => priceRuleSites(f, be(f)))).toEqual([]);
    // 변이 — 조합 · 묶음 읽기는 잡고 수량 × 단가는 잡지 않는다
    expect(priceRuleSites('x.ts', "const a = getCreditCost('dm-ai-generate') + getCreditCost('dm-builder');")).toHaveLength(2);
    expect(priceRuleSites('x.ts', "const a = (getCreditCost('oneline-complete')) - 2;")).toHaveLength(1);
    expect(priceRuleSites('x.ts', "const a = isInCreditBundle() ? 0 : getCreditCost('inapp-ai-generator');")).toHaveLength(1);
    expect(priceRuleSites('x.ts', "const a = n * getCreditCost('journey-activate');")).toEqual([]);
  });
});
