/**
 * editor-keys.ts — 편집기(.tsx) 소스에서 "담당자가 고칠 수 있는 속성 이름"을 **구문 트리**로 뽑는다 (★ 2026-10-14).
 *
 * 왜 정규식이 아닌가: 편집기 27개의 onUpdate 호출은 전부 객체 리터럴이지만, 키가 둘 이상인 호출·축약(`{ ...o, label }`)·
 * 항목 세터(`setItem(i, { question: v })`)·추가 버튼의 기본 객체(`[...questions, { id, type, question, required }]`)가 섞여 있어
 * "첫 키만" 잡는 정규식(0916 이메일 커버리지 `editorProps`)은 둘째 키부터 조용히 흘린다. 흘린 키는 대조 밖이 된다.
 *
 * 규칙(걸림쇠 — 어기면 즉시 throw · 조용한 누락 0):
 *  1. `onUpdate(x)`의 첫 인자는 객체 리터럴이어야 한다. 계산 키(`[k]`)·식별자 전개(`...patch`)·비객체 인자 = 실패.
 *  2. 항목 세터 = "첫 매개변수 이름이 `i`인 2-인자 화살표 함수로, 본문 `onUpdate` 안에서 둘째 인자를 전개하는 함수".
 *     그 세터 호출의 둘째 인자도 객체 리터럴이어야 한다(식별자·문자열 = 실패). 2-인자·첫 이름 `i`·onUpdate 호출인데 전개가 없으면 실패.
 *  3. onUpdate 값 안의 **배열 리터럴 요소인 객체 리터럴**(추가 버튼 기본 객체)의 키 = 그 배열의 항목 필드.
 *  4. 표시 기본값 `props.X ?? D`는 D가 리터럴일 때만 모은다(같은 X에 다른 D가 두 번 나오면 실패).
 *
 * 대상 밖(일부러): 세터 본문의 `{ ...q, ...patch }`·배열 전개(`[...items]`)·삭제 함수(`removeBtn(i)`) — 키를 만들지 않는다.
 */
import ts from 'typescript';

export type EditorKeys = {
  /** onUpdate({ key: … }) 최상위 키(정렬) */
  top: string[];
  /** 배열 속성의 항목 필드: { questions: ['question', 'type', …] } — 항목 세터 patch 키 + 추가 버튼 기본 객체 키 */
  items: Record<string, string[]>;
  /** 편집기 표시 기본값 `props.X ?? D`(리터럴만) */
  defaults: Record<string, boolean | number | string>;
};

function fail(fileName: string, node: ts.Node, sf: ts.SourceFile, why: string): never {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  throw new Error(`[editor-keys] ${fileName}:${line + 1} ${why} :: ${node.getText(sf).slice(0, 80)}`);
}

/** 객체 리터럴 속성 하나의 키(축약 포함). 계산 키·전개 = 실패. */
function propKey(p: ts.ObjectLiteralElementLike, sf: ts.SourceFile, fileName: string, where: string): string {
  if (ts.isSpreadAssignment(p)) fail(fileName, p, sf, `${where}에 전개(...)가 있다 · 키를 셀 수 없다`);
  if (ts.isShorthandPropertyAssignment(p)) return p.name.text;
  if (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) {
    const n = p.name;
    if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
    fail(fileName, p, sf, `${where}에 계산 키가 있다`);
  }
  return fail(fileName, p, sf, `${where}에 알 수 없는 속성 모양`);
}

/** 객체 리터럴의 키 전부. */
function literalKeys(obj: ts.ObjectLiteralExpression, sf: ts.SourceFile, fileName: string, where: string): string[] {
  return obj.properties.map((p) => propKey(p, sf, fileName, where));
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

function literalValue(n: ts.Expression): boolean | number | string | undefined {
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return undefined;
}

export function extractEditorKeys(src: string, fileName = 'Editor.tsx'): EditorKeys {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const top = new Set<string>();
  const items: Record<string, Set<string>> = {};
  const defaults: Record<string, boolean | number | string> = {};
  const addItem = (arr: string, k: string) => { (items[arr] ||= new Set()).add(k); };

  // ── 1) 항목 세터 찾기: (i, patch) => … onUpdate({ arr: … ...patch … }) ──
  const setters = new Map<string, string>(); // 세터 이름 → 배열 키
  walk(sf, (n) => {
    if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isArrowFunction(n.initializer) || !ts.isIdentifier(n.name)) return;
    const fn = n.initializer;
    if (fn.parameters.length !== 2) return;
    const p0 = fn.parameters[0].name, p1 = fn.parameters[1].name;
    if (!ts.isIdentifier(p0) || p0.text !== 'i' || !ts.isIdentifier(p1)) return;
    let updateCall: ts.CallExpression | null = null;
    let spreadsPatch = false;
    walk(fn.body, (m) => {
      if (ts.isCallExpression(m) && ts.isIdentifier(m.expression) && m.expression.text === 'onUpdate') updateCall = m;
      if (ts.isSpreadAssignment(m) && ts.isIdentifier(m.expression) && m.expression.text === p1.text) spreadsPatch = true;
    });
    if (!updateCall) return; // onUpdate를 안 부르는 2-인자 함수(이동 등)는 세터가 아니다
    if (!spreadsPatch) fail(fileName, n, sf, `세터 모양 밖 · 둘째 인자(${p1.text})를 onUpdate 안에서 전개하지 않는다`);
    const arg = (updateCall as ts.CallExpression).arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) fail(fileName, n, sf, '세터의 onUpdate 첫 인자가 객체 리터럴이 아니다');
    const keys = literalKeys(arg, sf, fileName, '세터의 onUpdate 객체');
    if (keys.length !== 1) fail(fileName, n, sf, `세터의 onUpdate 객체는 배열 키 하나여야 한다(지금 ${keys.length})`);
    setters.set(n.name.text, keys[0]);
  });

  // ── 2) 호출 전수: onUpdate({…}) 최상위 키 · 값 안 배열 리터럴의 객체 키 · 세터 호출 patch 키 ──
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return;
    const callee = n.expression.text;
    if (callee === 'onUpdate') {
      const arg = n.arguments[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) fail(fileName, n, sf, 'onUpdate 첫 인자가 객체 리터럴이 아니다');
      for (const p of arg.properties) {
        const key = propKey(p, sf, fileName, 'onUpdate 객체');
        top.add(key);
        if (ts.isPropertyAssignment(p)) {
          // 값 안의 "배열 리터럴 요소인 객체 리터럴" = 추가 버튼 기본 객체 → 항목 필드
          walk(p.initializer, (m) => {
            if (!ts.isArrayLiteralExpression(m)) return;
            for (const el of m.elements) {
              if (ts.isObjectLiteralExpression(el)) for (const k of literalKeys(el, sf, fileName, `${key}[] 기본 객체`)) addItem(key, k);
            }
          });
        }
      }
      return;
    }
    const arr = setters.get(callee);
    if (arr) {
      const arg = n.arguments[1];
      if (!arg || !ts.isObjectLiteralExpression(arg)) fail(fileName, n, sf, `세터 ${callee} 둘째 인자가 객체 리터럴이 아니다`);
      for (const k of literalKeys(arg, sf, fileName, `세터 ${callee} patch`)) addItem(arr, k);
    }
  });

  // ── 3) 표시 기본값 props.X ?? D ──
  walk(sf, (n) => {
    if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) return;
    const l = n.left;
    if (!ts.isPropertyAccessExpression(l) || !ts.isIdentifier(l.expression) || l.expression.text !== 'props') return;
    const v = literalValue(n.right);
    if (v === undefined) return;
    const k = l.name.text;
    if (k in defaults && defaults[k] !== v) fail(fileName, n, sf, `props.${k} 표시 기본값이 두 가지다(${String(defaults[k])} / ${String(v)})`);
    defaults[k] = v;
  });

  return {
    top: [...top].sort(),
    items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, [...v].sort()])),
    defaults,
  };
}

/** 키 총수(상한선 비교용) = 최상위 + 항목 필드 */
export function countEditorKeys(k: EditorKeys): number {
  return k.top.length + Object.values(k.items).reduce((a, v) => a + v.length, 0);
}
