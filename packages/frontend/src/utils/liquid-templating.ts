/**
 * frontend/utils/liquid-templating.ts
 *
 * Phase B-1 Liquid Templating frontend 미러 (D191 2026-05-22)
 * backend `packages/backend/src/utils/liquid-templating.ts` 미러 — 실시간 미리보기 영역 + 네트워크 비용 0
 *
 * ★ 영구 원칙 정합 ★
 *  - 미러 동기 의무: backend liquid-templating.ts 수정 시 본 파일도 동일 정정 의무
 *  - 안전 sandbox 동일 매트릭스 (eval/Function 미사용 + 무한 루프 차단)
 *  - filter 화이트리스트 10건 + tag 5건 (backend 정합)
 *
 * 사용처: JourneysPage step textarea 실시간 미리보기 + LiquidPreviewModal
 */

export interface LiquidContext {
  customer?: Record<string, any>;
  company?: { name?: string; brand_name?: string };
  now?: Date;
  [key: string]: any;
}

export interface LiquidError {
  type: 'syntax' | 'runtime' | 'limit';
  message: string;
  position?: number;
}

export interface LiquidRenderResult {
  rendered: string;
  errors: LiquidError[];
  hasLiquidSyntax: boolean;
}

const FOR_LOOP_CAP = 100;
const OUTPUT_SIZE_CAP = 1024 * 1024;
const MAX_RECURSION_DEPTH = 50;
const LIQUID_DETECT_PATTERN = /\{\{|\{%/;

export function detectLiquidSyntax(text: string): boolean {
  if (!text) return false;
  return LIQUID_DETECT_PATTERN.test(text);
}

export function renderLiquid(template: string, context: LiquidContext): LiquidRenderResult {
  if (!template) {
    return { rendered: '', errors: [], hasLiquidSyntax: false };
  }
  const hasLiquidSyntax = detectLiquidSyntax(template);
  if (!hasLiquidSyntax) {
    return { rendered: template, errors: [], hasLiquidSyntax: false };
  }
  const errors: LiquidError[] = [];
  let rendered: string;
  try {
    const tokens = tokenize(template);
    const ast = parse(tokens);
    rendered = evaluate(ast, context, errors);
    if (rendered.length > OUTPUT_SIZE_CAP) {
      errors.push({ type: 'limit', message: `렌더링 결과 크기 한도 초과` });
      rendered = rendered.substring(0, OUTPUT_SIZE_CAP);
    }
  } catch (e: any) {
    errors.push({ type: 'runtime', message: e?.message || '렌더링 오류' });
    rendered = template;
  }
  return { rendered, errors, hasLiquidSyntax };
}

export function flattenCustomerForLiquid(customer: Record<string, any> | null): Record<string, any> {
  if (!customer) return {};
  const flat: Record<string, any> = {};
  for (const [key, value] of Object.entries(customer)) {
    if (key === 'custom_fields') continue;
    flat[key] = value;
  }
  if (customer.custom_fields && typeof customer.custom_fields === 'object') {
    for (const [key, value] of Object.entries(customer.custom_fields)) {
      if (!(key in flat)) flat[key] = value;
    }
  }
  return flat;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tokenizer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type TokenType = 'text' | 'output' | 'tag';
interface Token { type: TokenType; value: string; position: number; }

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let i = 0;
  while (i < template.length) {
    const outputStart = template.indexOf('{{', i);
    const tagStart = template.indexOf('{%', i);
    if (outputStart === -1 && tagStart === -1) {
      if (lastIndex < template.length) {
        tokens.push({ type: 'text', value: template.substring(lastIndex), position: lastIndex });
      }
      break;
    }
    let nextStart: number;
    let isTag: boolean;
    if (outputStart === -1) { nextStart = tagStart; isTag = true; }
    else if (tagStart === -1) { nextStart = outputStart; isTag = false; }
    else if (outputStart < tagStart) { nextStart = outputStart; isTag = false; }
    else { nextStart = tagStart; isTag = true; }
    if (nextStart > lastIndex) {
      tokens.push({ type: 'text', value: template.substring(lastIndex, nextStart), position: lastIndex });
    }
    if (isTag) {
      const tagEnd = template.indexOf('%}', nextStart + 2);
      if (tagEnd === -1) throw new Error(`Tag 미종결`);
      tokens.push({ type: 'tag', value: template.substring(nextStart + 2, tagEnd).trim(), position: nextStart });
      i = tagEnd + 2;
      lastIndex = i;
    } else {
      const outputEnd = template.indexOf('}}', nextStart + 2);
      if (outputEnd === -1) throw new Error(`Output 미종결`);
      tokens.push({ type: 'output', value: template.substring(nextStart + 2, outputEnd).trim(), position: nextStart });
      i = outputEnd + 2;
      lastIndex = i;
    }
  }
  return tokens;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AST + Parser
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ASTNode =
  | { type: 'text'; value: string }
  | { type: 'output'; expression: string }
  | { type: 'if'; branches: Array<{ condition: string; children: ASTNode[] }>; elseChildren?: ASTNode[] }
  | { type: 'for'; varName: string; iterable: string; children: ASTNode[] }
  | { type: 'assign'; varName: string; expression: string }
  | { type: 'case'; expression: string; whens: Array<{ value: string; children: ASTNode[] }>; elseChildren?: ASTNode[] }
  | { type: 'comment' };

interface ParseState { tokens: Token[]; idx: number; }

function parse(tokens: Token[]): ASTNode[] {
  return parseBlock({ tokens, idx: 0 }, []);
}

function parseBlock(state: ParseState, endTags: string[]): ASTNode[] {
  const nodes: ASTNode[] = [];
  while (state.idx < state.tokens.length) {
    const token = state.tokens[state.idx];
    if (token.type === 'text') { nodes.push({ type: 'text', value: token.value }); state.idx++; continue; }
    if (token.type === 'output') { nodes.push({ type: 'output', expression: token.value }); state.idx++; continue; }
    const tagName = token.value.split(/\s+/)[0];
    if (endTags.includes(tagName)) return nodes;
    if (tagName === 'if') { nodes.push(parseIfNode(state)); continue; }
    if (tagName === 'for') { nodes.push(parseForNode(state)); continue; }
    if (tagName === 'assign') {
      const match = token.value.match(/^assign\s+(\w+)\s*=\s*(.+)$/);
      if (!match) throw new Error(`assign 문법 오류`);
      nodes.push({ type: 'assign', varName: match[1], expression: match[2].trim() });
      state.idx++;
      continue;
    }
    if (tagName === 'case') { nodes.push(parseCaseNode(state)); continue; }
    if (tagName === 'comment') { nodes.push(parseCommentNode(state)); continue; }
    throw new Error(`미지원 tag: ${tagName}`);
  }
  return nodes;
}

function parseIfNode(state: ParseState): ASTNode {
  const startToken = state.tokens[state.idx];
  const initialCondition = startToken.value.replace(/^if\s+/, '').trim();
  state.idx++;
  const branches: Array<{ condition: string; children: ASTNode[] }> = [];
  let elseChildren: ASTNode[] | undefined;
  branches.push({ condition: initialCondition, children: parseBlock(state, ['elsif', 'elseif', 'else', 'endif']) });
  while (state.idx < state.tokens.length) {
    const t = state.tokens[state.idx];
    if (t.type !== 'tag') throw new Error('if 분기 오류');
    const tn = t.value.split(/\s+/)[0];
    if (tn === 'elsif' || tn === 'elseif') {
      const cond = t.value.replace(/^(elsif|elseif)\s+/, '').trim();
      state.idx++;
      branches.push({ condition: cond, children: parseBlock(state, ['elsif', 'elseif', 'else', 'endif']) });
      continue;
    }
    if (tn === 'else') { state.idx++; elseChildren = parseBlock(state, ['endif']); continue; }
    if (tn === 'endif') { state.idx++; break; }
    throw new Error(`if 미종결`);
  }
  return { type: 'if', branches, elseChildren };
}

function parseForNode(state: ParseState): ASTNode {
  const startToken = state.tokens[state.idx];
  const match = startToken.value.match(/^for\s+(\w+)\s+in\s+(.+)$/);
  if (!match) throw new Error(`for 문법 오류`);
  state.idx++;
  const children = parseBlock(state, ['endfor']);
  if (state.idx >= state.tokens.length || state.tokens[state.idx].value.split(/\s+/)[0] !== 'endfor') {
    throw new Error('for 미종결');
  }
  state.idx++;
  return { type: 'for', varName: match[1], iterable: match[2].trim(), children };
}

function parseCaseNode(state: ParseState): ASTNode {
  const startToken = state.tokens[state.idx];
  const expression = startToken.value.replace(/^case\s+/, '').trim();
  state.idx++;
  const whens: Array<{ value: string; children: ASTNode[] }> = [];
  let elseChildren: ASTNode[] | undefined;
  while (state.idx < state.tokens.length) {
    const t = state.tokens[state.idx];
    if (t.type === 'tag') {
      const tn = t.value.split(/\s+/)[0];
      if (tn === 'when' || tn === 'else' || tn === 'endcase') break;
    }
    state.idx++;
  }
  while (state.idx < state.tokens.length) {
    const t = state.tokens[state.idx];
    if (t.type !== 'tag') { state.idx++; continue; }
    const tn = t.value.split(/\s+/)[0];
    if (tn === 'when') {
      const value = t.value.replace(/^when\s+/, '').trim();
      state.idx++;
      whens.push({ value, children: parseBlock(state, ['when', 'else', 'endcase']) });
      continue;
    }
    if (tn === 'else') { state.idx++; elseChildren = parseBlock(state, ['endcase']); continue; }
    if (tn === 'endcase') { state.idx++; break; }
    throw new Error(`case 미종결`);
  }
  return { type: 'case', expression, whens, elseChildren };
}

function parseCommentNode(state: ParseState): ASTNode {
  state.idx++;
  while (state.idx < state.tokens.length) {
    const t = state.tokens[state.idx];
    if (t.type === 'tag' && t.value.split(/\s+/)[0] === 'endcomment') { state.idx++; return { type: 'comment' }; }
    state.idx++;
  }
  throw new Error('comment 미종결');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Evaluator
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function evaluate(ast: ASTNode[], context: LiquidContext, errors: LiquidError[], depth = 0): string {
  if (depth > MAX_RECURSION_DEPTH) { errors.push({ type: 'limit', message: '재귀 깊이 한도 초과' }); return ''; }
  let result = '';
  const scope: Record<string, any> = { ...context };
  for (const node of ast) {
    if (node.type === 'text') { result += node.value; continue; }
    if (node.type === 'output') {
      result += stringifyValue(evalExpression(node.expression, scope, errors));
      continue;
    }
    if (node.type === 'if') {
      let matched = false;
      for (const branch of node.branches) {
        if (evalCondition(branch.condition, scope, errors)) {
          result += evaluate(branch.children, scope, errors, depth + 1);
          matched = true;
          break;
        }
      }
      if (!matched && node.elseChildren) result += evaluate(node.elseChildren, scope, errors, depth + 1);
      continue;
    }
    if (node.type === 'for') {
      const iterable = evalExpression(node.iterable, scope, errors);
      if (!Array.isArray(iterable)) continue;
      const limit = Math.min(iterable.length, FOR_LOOP_CAP);
      for (let idx = 0; idx < limit; idx++) {
        result += evaluate(node.children, { ...scope, [node.varName]: iterable[idx] }, errors, depth + 1);
      }
      if (iterable.length > FOR_LOOP_CAP) errors.push({ type: 'limit', message: `for 한도 초과` });
      continue;
    }
    if (node.type === 'assign') {
      scope[node.varName] = evalExpression(node.expression, scope, errors);
      continue;
    }
    if (node.type === 'case') {
      const targetValue = evalExpression(node.expression, scope, errors);
      let matched = false;
      for (const when of node.whens) {
        if (looseEqual(targetValue, evalExpression(when.value, scope, errors))) {
          result += evaluate(when.children, scope, errors, depth + 1);
          matched = true;
          break;
        }
      }
      if (!matched && node.elseChildren) result += evaluate(node.elseChildren, scope, errors, depth + 1);
      continue;
    }
  }
  return result;
}

function evalExpression(expr: string, scope: Record<string, any>, errors: LiquidError[]): any {
  const parts = splitByPipe(expr);
  let value = evalAtom(parts[0].trim(), scope, errors);
  for (let i = 1; i < parts.length; i++) {
    value = applyFilter(value, parts[i].trim(), scope, errors);
  }
  return value;
}

function evalAtom(atom: string, scope: Record<string, any>, errors: LiquidError[]): any {
  const trimmed = atom.trim();
  if (!trimmed) return null;
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'nil' || trimmed === 'null') return null;
  if (trimmed === 'blank' || trimmed === 'empty') return '';
  return resolveVariable(trimmed, scope);
}

function resolveVariable(path: string, scope: Record<string, any>): any {
  const parts = path.split('.');
  let value: any = scope;
  for (const part of parts) {
    if (value == null) return null;
    value = value[part];
  }
  return value;
}

function evalCondition(condStr: string, scope: Record<string, any>, errors: LiquidError[]): boolean {
  const trimmed = condStr.trim();
  const orParts = splitByLogicalOp(trimmed, 'or');
  if (orParts.length > 1) return orParts.some((p) => evalCondition(p, scope, errors));
  const andParts = splitByLogicalOp(trimmed, 'and');
  if (andParts.length > 1) return andParts.every((p) => evalCondition(p, scope, errors));
  return evalComparison(trimmed, scope, errors);
}

function evalComparison(expr: string, scope: Record<string, any>, errors: LiquidError[]): boolean {
  const operators: Array<{ op: string; fn: (a: any, b: any) => boolean }> = [
    { op: '==', fn: (a, b) => looseEqual(a, b) },
    { op: '!=', fn: (a, b) => !looseEqual(a, b) },
    { op: '>=', fn: (a, b) => Number(a) >= Number(b) },
    { op: '<=', fn: (a, b) => Number(a) <= Number(b) },
    { op: '>', fn: (a, b) => Number(a) > Number(b) },
    { op: '<', fn: (a, b) => Number(a) < Number(b) },
    { op: 'contains', fn: (a, b) => {
      if (typeof a === 'string') return a.includes(String(b));
      if (Array.isArray(a)) return a.includes(b);
      return false;
    }},
  ];
  for (const { op, fn } of operators) {
    const opIdx = findOperatorIndex(expr, op);
    if (opIdx > -1) {
      const left = expr.substring(0, opIdx).trim();
      const right = expr.substring(opIdx + op.length).trim();
      return fn(evalAtom(left, scope, errors), evalAtom(right, scope, errors));
    }
  }
  return isTruthy(evalAtom(expr, scope, errors));
}

function findOperatorIndex(expr: string, op: string): number {
  let inStr: '"' | "'" | null = null;
  const isWordOp = /^[a-z]/.test(op);
  for (let i = 0; i <= expr.length - op.length; i++) {
    const c = expr[i];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (expr.substring(i, i + op.length) !== op) continue;
    if (isWordOp) {
      const before = expr[i - 1];
      const after = expr[i + op.length];
      if (before && /\w/.test(before)) continue;
      if (after && /\w/.test(after)) continue;
    }
    return i;
  }
  return -1;
}

function splitByPipe(expr: string): string[] {
  const result: string[] = [];
  let buf = '';
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) { buf += c; if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; buf += c; continue; }
    if (c === '|') { result.push(buf); buf = ''; continue; }
    buf += c;
  }
  result.push(buf);
  return result;
}

function splitByLogicalOp(expr: string, op: 'and' | 'or'): string[] {
  const parts: string[] = [];
  let buf = '';
  let inStr: '"' | "'" | null = null;
  const opLen = op.length;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) { buf += c; if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; buf += c; continue; }
    if (c === ' ' || c === '\t') {
      const lookAhead = expr.substring(i + 1, i + 1 + opLen);
      const after = expr[i + 1 + opLen];
      if (lookAhead === op && (after === ' ' || after === '\t')) {
        parts.push(buf); buf = ''; i += opLen + 1;
        while (i < expr.length && (expr[i] === ' ' || expr[i] === '\t')) i++;
        i--;
        continue;
      }
    }
    buf += c;
  }
  parts.push(buf);
  return parts;
}

function looseEqual(a: any, b: any): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === typeof b) return a === b;
  return String(a) === String(b);
}

function isTruthy(value: any): boolean {
  if (value == null) return false;
  if (value === false) return false;
  if (value === '') return false;
  if (value === 0) return false;
  return true;
}

function applyFilter(value: any, filterStr: string, scope: Record<string, any>, errors: LiquidError[]): any {
  const colonIdx = filterStr.indexOf(':');
  const filterName = colonIdx > -1 ? filterStr.substring(0, colonIdx).trim() : filterStr.trim();
  const argsStr = colonIdx > -1 ? filterStr.substring(colonIdx + 1).trim() : '';
  const args = argsStr ? parseFilterArgs(argsStr, scope, errors) : [];
  switch (filterName) {
    case 'default': return value == null || value === '' ? args[0] : value;
    case 'upcase': return String(value ?? '').toUpperCase();
    case 'downcase': return String(value ?? '').toLowerCase();
    case 'capitalize': {
      const s = String(value ?? '');
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    case 'minus': return Number(value) - Number(args[0]);
    case 'plus': return Number(value) + Number(args[0]);
    case 'divided_by': {
      const divisor = Number(args[0]);
      if (divisor === 0) { errors.push({ type: 'runtime', message: 'divided_by 0 차단' }); return 0; }
      return Number(value) / divisor;
    }
    case 'times': return Number(value) * Number(args[0]);
    case 'round': {
      const digits = Number(args[0] ?? 0);
      const factor = Math.pow(10, digits);
      return Math.round(Number(value) * factor) / factor;
    }
    case 'format_number': {
      const num = Number(value);
      if (isNaN(num)) return String(value ?? '');
      return num.toLocaleString('ko-KR');
    }
    default:
      errors.push({ type: 'syntax', message: `미지원 filter: ${filterName}` });
      return value;
  }
}

function parseFilterArgs(argsStr: string, scope: Record<string, any>, errors: LiquidError[]): any[] {
  const parts: string[] = [];
  let buf = '';
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < argsStr.length; i++) {
    const c = argsStr[i];
    if (inStr) { buf += c; if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; buf += c; continue; }
    if (c === ',') { parts.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((p) => evalAtom(p.trim(), scope, errors));
}

function stringifyValue(value: any): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 샘플 고객 매트릭스 (LiquidPreviewModal 사용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SampleCustomer {
  label: string;
  data: Record<string, any>;
}

export const SAMPLE_CUSTOMERS: SampleCustomer[] = [
  {
    label: 'VIP 단골 (서울)',
    data: { name: '박홍윤', grade: 'VIP', age: 45, gender: 'M', region: '서울',
            points: 25600, purchase_count: 38, recent_purchase_store: '강남점',
            recent_purchase_amount: 152000 },
  },
  {
    label: 'Gold (부산)',
    data: { name: '김민수', grade: 'Gold', age: 32, gender: 'M', region: '부산',
            points: 8200, purchase_count: 14, recent_purchase_store: '서면점',
            recent_purchase_amount: 78000 },
  },
  {
    label: 'Silver (대구)',
    data: { name: '이지영', grade: 'Silver', age: 28, gender: 'F', region: '대구',
            points: 3100, purchase_count: 5, recent_purchase_store: '동성로점',
            recent_purchase_amount: 42000 },
  },
  {
    label: '일반 (광주)',
    data: { name: '최서연', grade: '일반', age: 35, gender: 'F', region: '광주',
            points: 1200, purchase_count: 2, recent_purchase_store: '충장로점',
            recent_purchase_amount: 28000 },
  },
  {
    label: '신규 (인천)',
    data: { name: '정민호', grade: '신규', age: 24, gender: 'M', region: '인천',
            points: 100, purchase_count: 0, recent_purchase_store: null,
            recent_purchase_amount: 0 },
  },
  {
    label: '휴면 6개월+ (서울)',
    data: { name: '한지수', grade: 'Silver', age: 41, gender: 'F', region: '서울',
            points: 4500, purchase_count: 8, recent_purchase_store: '홍대점',
            recent_purchase_amount: 0 },
  },
  {
    label: 'VIP 여성 (부산)',
    data: { name: '윤소희', grade: 'VIP', age: 38, gender: 'F', region: '부산',
            points: 31200, purchase_count: 52, recent_purchase_store: '센텀점',
            recent_purchase_amount: 198000 },
  },
  {
    label: 'Gold 청년 (대전)',
    data: { name: '강현우', grade: 'Gold', age: 26, gender: 'M', region: '대전',
            points: 6800, purchase_count: 11, recent_purchase_store: '둔산점',
            recent_purchase_amount: 65000 },
  },
  {
    label: '익명 (값 누락)',
    data: { name: null, grade: null, age: null, gender: null, region: null,
            points: null, purchase_count: 0, recent_purchase_store: null,
            recent_purchase_amount: null },
  },
  {
    label: '풀 데이터 (테스트용)',
    data: { name: '테스트', grade: 'VIP', age: 30, gender: 'M', region: '서울',
            points: 99999, purchase_count: 100, recent_purchase_store: '본점',
            recent_purchase_amount: 999999 },
  },
];
