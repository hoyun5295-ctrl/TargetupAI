/**
 * CT-50 utils/liquid-templating.ts
 *
 * Phase B-1 Liquid Templating (D191 2026-05-22)
 * Shopify Liquid 표준 호환 부분 집합 — 안전 sandbox 파서 + evaluator
 *
 * 사용처: messageUtils.ts replaceVariables Step 1 — 5 발송 경로 자동 적용
 *  - routes/campaigns.ts (AI/직접/타겟/예약/테스트)
 *  - routes/spam-filter.ts
 *  - utils/auto-campaign-worker.ts
 *  - utils/spam-test-queue.ts
 *  - utils/journey-executor.ts
 *
 * 영구 원칙 정합:
 *  - 서버 코드 실행 X (eval/Function 미사용)
 *  - 무한 루프 차단 (for 100회 cap)
 *  - 메모리 cap (1MB output)
 *  - 외부 함수 호출 X (filter 화이트리스트 10건만)
 *  - backward compat 100% (기존 %변수% 패턴 충돌 0)
 *  - 오류 시 발송 차단 X — 원본 텍스트 반환 + errors 배열 반환
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

export interface LiquidValidationResult {
  valid: boolean;
  errors: LiquidError[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 안전 sandbox 한도
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const FOR_LOOP_CAP = 100;
const OUTPUT_SIZE_CAP = 1024 * 1024;
const MAX_RECURSION_DEPTH = 50;
const LIQUID_DETECT_PATTERN = /\{\{|\{%/;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 본문에 {{ cart.* }} Liquid 변수가 있는지(장바구니 값 조회 게이팅 · 보낼 글 판정 · ★ 2026-11-02 cdp-events 에서 옮김 = 순수 판정 한 곳) */
export function hasCartLiquidVars(template: string): boolean {
  return /\{\{\s*cart\./.test(template || '');
}

export function detectLiquidSyntax(text: string): boolean {
  if (!text) return false;
  return LIQUID_DETECT_PATTERN.test(text);
}

export function validateLiquidTemplate(text: string): LiquidValidationResult {
  if (!text || !detectLiquidSyntax(text)) {
    return { valid: true, errors: [] };
  }

  const errors: LiquidError[] = [];
  try {
    const tokens = tokenize(text);
    parse(tokens);
  } catch (e: any) {
    errors.push({ type: 'syntax', message: e?.message || '문법 오류' });
  }

  return { valid: errors.length === 0, errors };
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
      errors.push({
        type: 'limit',
        message: `렌더링 결과 크기 한도 초과 (${rendered.length} > ${OUTPUT_SIZE_CAP})`,
      });
      rendered = rendered.substring(0, OUTPUT_SIZE_CAP);
    }
  } catch (e: any) {
    errors.push({ type: 'runtime', message: e?.message || '렌더링 오류' });
    rendered = template;
  }

  return { rendered, errors, hasLiquidSyntax };
}

/**
 * ★ 2026-07-06 잔존 태그 제거 (순수) — 렌더 실패/부분 렌더로 남은 {{ }}·{% %}를 텍스트에서 제거.
 *   발송 최후 방어(messageUtils)와 생성 출구 가드(services/ai.ts)의 폴백 전용.
 *   정상 렌더(잔존 0)는 detect=false로 무접촉 — 기존 경로 영향 0.
 */
export function stripLiquidLeftovers(text: string): string {
  if (!text || !detectLiquidSyntax(text)) return text;
  return text
    .replace(/\{%[\s\S]*?%\}/g, '')
    .replace(/\{\{[\s\S]*?\}\}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim();
}

/**
 * ★ 2026-11-10 생성물 평문화의 한 규칙(순수) — 발송 렌더가 쓰는 **같은 파서**(tokenize → parse) 의 구조에서 else 갈래만 고른다.
 *   - 조건식은 계산하지 않는다(Codex 1R · 빈 고객 렌더는 != 조건이 참이 돼 등급 전용 문구를 남겼다)
 *   - if · case = else 갈래만(else 없으면 덩어리째 없음) · for · assign · comment = 없음 · {{ … | default: 'x' }} = x · 그 밖 출력 = 없음
 *   - 파서가 못 읽는 글(미지원 태그 · 짝 안 맞음 · 미종결) = 첫 {% 앞 글만 남긴다(조건부 글이 새지 않는 쪽 · 그런 글은 발송 렌더도 못 읽는다)
 *   ★ Codex 2R ~ 4R(주석 · raw 경계)이 같은 부류로 세 번 = 정규식으로 따로 해석한 것이 뿌리 → 렌더 파서 하나로 묶었다(그 해석기는 지움).
 */
function flattenParsedElse(nodes: ASTNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.value;
    else if (n.type === 'output') {
      const d = /\|\s*default\s*:\s*(['"])([\s\S]*?)\1/.exec(n.expression);
      out += d ? d[2] : '';
    } else if (n.type === 'if' || n.type === 'case') {
      if (n.elseChildren) out += flattenParsedElse(n.elseChildren);
    }
  }
  return out;
}

function tidyFlattened(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim();
}

/**
 * ★ 2026-07-06 생성물 평문화 (순수) — %변수% 세계(캠페인·오퍼레이터 문안) 생성물에 Liquid가 섞인 경우
 *   else 갈래만 남기고({{ x | default: 'y' }} → 'y') 잔존 태그 제거.
 *   ★ 2026-11-10 고르는 법 = 렌더 파서 구조(flattenParsedElse · 조건식 계산 없음) · 못 읽는 글 = 첫 {% 앞만.
 *   "존재하지 않는 필드 기반 문법"이 사용자 화면·발송에 절대 노출되지 않는 기계 보장 층.
 *   Liquid 허용 경로(인앱)에서는 호출하지 않는다 — 분기 기능 보존.
 */
export function flattenLiquidToPlainText(text: string): string {
  if (!text || !detectLiquidSyntax(text)) return text;
  let nodes: ASTNode[];
  try {
    nodes = parse(tokenize(text));
  } catch {
    const cut = text.indexOf('{%');
    const head = cut === -1 ? text : text.slice(0, cut);
    try { return tidyFlattened(flattenParsedElse(parse(tokenize(head)))); } catch { const c2 = head.indexOf("{{"); return tidyFlattened(c2 === -1 ? head : head.slice(0, c2)); }
  }
  return tidyFlattened(flattenParsedElse(nodes));
}

/**
 * ★ 2026-11-10 여정 생성물 = %변수% 한 가지(순수) — 여정 AI 가 만든 문안에 섞인 Liquid 를 %변수% 세계로 옮긴다.
 *   옛: 여정만 Liquid 세계로 지시받아 같은 요청도 {{ customer.name | default: '고객' }} 와 %고객명% 가 왔다갔다 했고,
 *       {% if %} 분기는 쓰기 화면에 코드 원문으로 보이고 받는 모습엔 대상 고객 한 명의 분기만 보여 「문안이 다르다」로 읽혔다.
 *   - {{ customer.X | … }} 중 아는 칸(toPercent 에 있는 칸) = %표시명% (필터 · default 는 버린다 · 빈 값 처리는 발송 치환이 한다)
 *   - 그 밖 Liquid(분기 · 모르는 칸) = flattenLiquidToPlainText(렌더 파서 구조 · else 갈래만)
 *   - 장바구니 문법(cart.)이 든 글 = 고객 칸 이름만 바꾸고 나머지는 그대로(장바구니 여정은 지금도 Liquid 렌더로 나간다 · 보낼 글 판정이 장바구니 여정에서만 허용 · send-placeholder-gate)
 *   부르는 곳 = 새로 만드는 여정 문안 출구만(이미 저장된 문안 · 다듬기 · 스팸 회피 다시 쓰기는 원문 보존이라 부르지 않는다).
 *   ★ 2026-11-11 C126 — 생산자는 이 함수를 직접 부르지 않고 journey-ai-copy 의 journeyNewCopy(쓰기) · journeyRevisedCopy(고치기)를 부른다.
 */
export function liquidCopyToPercent(text: string, toPercent: Readonly<Record<string, string>>): string {
  if (!text || !detectLiquidSyntax(text)) return text;
  const out = text.replace(/\{\{\s*customer\.([A-Za-z0-9_]+)\s*(?:\|[^}]*)?\}\}/g, (whole, key: string) => {
    const name = Object.prototype.hasOwnProperty.call(toPercent, key) ? toPercent[key] : '';
    return name ? `%${name}%` : whole;
  });
  if (!detectLiquidSyntax(out)) return out;
  let nodes: ASTNode[];
  try { nodes = parse(tokenize(out)); } catch { return flattenLiquidToPlainText(out); }
  if (referencesCart(nodes)) return out;
  return flattenLiquidToPlainText(out);
}

/**
 * ★ 2026-11-11 C126(D5) — 렌더 파서의 토큰(글 · 출력 `{{ … }}` · 태그 `{% … %}`)을 그대로 내보낸다(값 = 파서가 앞뒤 공백만 뗀 안쪽 글자).
 *   여정 AI 글의 고치기 관문(journey-ai-copy)이 원문과 결과의 템플릿 뼈대를 같은 파서로 비교한다. 닫히지 않은 출력 · 태그 = 던진다(렌더와 같음).
 */
export function liquidTokens(text: string): Array<{ type: 'text' | 'output' | 'tag'; value: string }> {
  return tokenize(String(text ?? '')).map((t) => ({ type: t.type, value: t.value }));
}

/** 렌더 파서 AST 에서 장바구니(cart)를 실제로 참조하는가 — 주석 · 따옴표 안 글은 빼고 식(출력 · 조건 · for 대상 · assign · case)에서 뿌리 이름 cart 를 본다(Codex 5R · 정규식으로 원문을 훑으면 주석 속 cart 를 잡고 assign 별칭을 놓쳤다) */
function referencesCart(nodes: ASTNode[]): boolean {
  const refs = (expr: string) => /(^|[^\w.])cart(?!\w)/.test(String(expr || '').replace(/'[^']*'|"[^"]*"/g, ''));
  for (const n of nodes) {
    if (n.type === 'output' && refs(n.expression)) return true;
    if (n.type === 'assign' && refs(n.expression)) return true;
    if (n.type === 'for' && (refs(n.iterable) || referencesCart(n.children))) return true;
    if (n.type === 'if' && (n.branches.some((b) => refs(b.condition) || referencesCart(b.children)) || (n.elseChildren && referencesCart(n.elseChildren)))) return true;
    if (n.type === 'case' && (refs(n.expression) || n.whens.some((w) => refs(w.value) || referencesCart(w.children)) || (n.elseChildren && referencesCart(n.elseChildren)))) return true;
  }
  return false;
}

/**
 * customer DB row를 Liquid context 평탄화
 * - 최상위 컬럼 + custom_fields JSONB 평탄화 → customer.X 단일 진입점
 */
export function flattenCustomerForLiquid(customer: Record<string, any> | null): Record<string, any> {
  if (!customer) return {};
  const flat: Record<string, any> = {};

  for (const [key, value] of Object.entries(customer)) {
    if (key === 'custom_fields') continue;
    flat[key] = value;
  }

  if (customer.custom_fields && typeof customer.custom_fields === 'object') {
    for (const [key, value] of Object.entries(customer.custom_fields)) {
      if (!(key in flat)) {
        flat[key] = value;
      }
    }
  }

  return flat;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tokenizer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type TokenType = 'text' | 'output' | 'tag';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

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
    if (outputStart === -1) {
      nextStart = tagStart;
      isTag = true;
    } else if (tagStart === -1) {
      nextStart = outputStart;
      isTag = false;
    } else if (outputStart < tagStart) {
      nextStart = outputStart;
      isTag = false;
    } else {
      nextStart = tagStart;
      isTag = true;
    }

    if (nextStart > lastIndex) {
      tokens.push({ type: 'text', value: template.substring(lastIndex, nextStart), position: lastIndex });
    }

    if (isTag) {
      const tagEnd = template.indexOf('%}', nextStart + 2);
      if (tagEnd === -1) throw new Error(`Tag 미종결 (position ${nextStart})`);
      const value = template.substring(nextStart + 2, tagEnd).trim();
      tokens.push({ type: 'tag', value, position: nextStart });
      i = tagEnd + 2;
      lastIndex = i;
    } else {
      const outputEnd = template.indexOf('}}', nextStart + 2);
      if (outputEnd === -1) throw new Error(`Output 미종결 (position ${nextStart})`);
      const value = template.substring(nextStart + 2, outputEnd).trim();
      tokens.push({ type: 'output', value, position: nextStart });
      i = outputEnd + 2;
      lastIndex = i;
    }
  }

  return tokens;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AST + Parser (재귀 하강)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ASTNode =
  | { type: 'text'; value: string }
  | { type: 'output'; expression: string }
  | { type: 'if'; branches: Array<{ condition: string; children: ASTNode[] }>; elseChildren?: ASTNode[] }
  | { type: 'for'; varName: string; iterable: string; children: ASTNode[] }
  | { type: 'assign'; varName: string; expression: string }
  | { type: 'case'; expression: string; whens: Array<{ value: string; children: ASTNode[] }>; elseChildren?: ASTNode[] }
  | { type: 'comment' };

interface ParseState {
  tokens: Token[];
  idx: number;
}

function parse(tokens: Token[]): ASTNode[] {
  const state: ParseState = { tokens, idx: 0 };
  return parseBlock(state, []);
}

function parseBlock(state: ParseState, endTags: string[]): ASTNode[] {
  const nodes: ASTNode[] = [];

  while (state.idx < state.tokens.length) {
    const token = state.tokens[state.idx];

    if (token.type === 'text') {
      nodes.push({ type: 'text', value: token.value });
      state.idx++;
      continue;
    }

    if (token.type === 'output') {
      nodes.push({ type: 'output', expression: token.value });
      state.idx++;
      continue;
    }

    const tagName = token.value.split(/\s+/)[0];

    if (endTags.includes(tagName)) {
      return nodes;
    }

    if (tagName === 'if') {
      nodes.push(parseIfNode(state));
      continue;
    }

    if (tagName === 'for') {
      nodes.push(parseForNode(state));
      continue;
    }

    if (tagName === 'assign') {
      const match = token.value.match(/^assign\s+(\w+)\s*=\s*(.+)$/);
      if (!match) throw new Error(`assign 문법 오류 (position ${token.position})`);
      nodes.push({ type: 'assign', varName: match[1], expression: match[2].trim() });
      state.idx++;
      continue;
    }

    if (tagName === 'case') {
      nodes.push(parseCaseNode(state));
      continue;
    }

    if (tagName === 'comment') {
      nodes.push(parseCommentNode(state));
      continue;
    }

    throw new Error(`미지원 tag: ${tagName} (position ${token.position})`);
  }

  return nodes;
}

function parseIfNode(state: ParseState): ASTNode {
  const startToken = state.tokens[state.idx];
  const initialCondition = startToken.value.replace(/^if\s+/, '').trim();
  state.idx++;

  const branches: Array<{ condition: string; children: ASTNode[] }> = [];
  let elseChildren: ASTNode[] | undefined;
  let currentChildren = parseBlock(state, ['elsif', 'elseif', 'else', 'endif']);
  branches.push({ condition: initialCondition, children: currentChildren });

  while (state.idx < state.tokens.length) {
    const t = state.tokens[state.idx];
    if (t.type !== 'tag') throw new Error('if 분기 토큰 오류');
    const tn = t.value.split(/\s+/)[0];

    if (tn === 'elsif' || tn === 'elseif') {
      const cond = t.value.replace(/^(elsif|elseif)\s+/, '').trim();
      state.idx++;
      const children = parseBlock(state, ['elsif', 'elseif', 'else', 'endif']);
      branches.push({ condition: cond, children });
      continue;
    }

    if (tn === 'else') {
      state.idx++;
      elseChildren = parseBlock(state, ['endif']);
      continue;
    }

    if (tn === 'endif') {
      state.idx++;
      break;
    }

    throw new Error(`if 미종결: 예상치 못한 tag: ${tn}`);
  }

  return { type: 'if', branches, elseChildren };
}

function parseForNode(state: ParseState): ASTNode {
  const startToken = state.tokens[state.idx];
  const match = startToken.value.match(/^for\s+(\w+)\s+in\s+(.+)$/);
  if (!match) throw new Error(`for 문법 오류 (position ${startToken.position})`);
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

  // case 본문 진입 전 sink 텍스트 skip
  while (state.idx < state.tokens.length) {
    const t = state.tokens[state.idx];
    if (t.type === 'tag') {
      const tn = t.value.split(/\s+/)[0];
      if (tn === 'when') break;
      if (tn === 'else') break;
      if (tn === 'endcase') break;
    }
    state.idx++;
  }

  while (state.idx < state.tokens.length) {
    const t = state.tokens[state.idx];
    if (t.type !== 'tag') {
      state.idx++;
      continue;
    }
    const tn = t.value.split(/\s+/)[0];

    if (tn === 'when') {
      const value = t.value.replace(/^when\s+/, '').trim();
      state.idx++;
      const children = parseBlock(state, ['when', 'else', 'endcase']);
      whens.push({ value, children });
      continue;
    }

    if (tn === 'else') {
      state.idx++;
      elseChildren = parseBlock(state, ['endcase']);
      continue;
    }

    if (tn === 'endcase') {
      state.idx++;
      break;
    }

    throw new Error(`case 미종결: 예상치 못한 tag: ${tn}`);
  }

  return { type: 'case', expression, whens, elseChildren };
}

function parseCommentNode(state: ParseState): ASTNode {
  state.idx++;
  while (state.idx < state.tokens.length) {
    const t = state.tokens[state.idx];
    if (t.type === 'tag' && t.value.split(/\s+/)[0] === 'endcomment') {
      state.idx++;
      return { type: 'comment' };
    }
    state.idx++;
  }
  throw new Error('comment 미종결');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Evaluator
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function evaluate(
  ast: ASTNode[],
  context: LiquidContext,
  errors: LiquidError[],
  depth = 0,
  sharedScope?: Record<string, any>,
): string {
  if (depth > MAX_RECURSION_DEPTH) {
    errors.push({ type: 'limit', message: '재귀 깊이 한도 초과' });
    return '';
  }

  let result = '';
  // ★ 2026-09-27 한줄로 V2 R428 — 한 렌더 안의 범위는 하나(Liquid 규칙: if·for·case 안 assign이 블록 밖에도 남는다).
  //   최상위에서만 복사하고 안쪽 블록은 같은 범위를 쓴다. 옛: 호출마다 사본을 만들어 블록 안 assign이 사라졌다.
  const scope: Record<string, any> = sharedScope ?? { ...context };

  for (const node of ast) {
    if (node.type === 'text') {
      result += node.value;
      continue;
    }

    if (node.type === 'output') {
      const value = evalExpression(node.expression, scope, errors);
      result += stringifyValue(value);
      continue;
    }

    if (node.type === 'if') {
      let matched = false;
      for (const branch of node.branches) {
        if (evalCondition(branch.condition, scope, errors)) {
          result += evaluate(branch.children, scope, errors, depth + 1, scope);
          matched = true;
          break;
        }
      }
      if (!matched && node.elseChildren) {
        result += evaluate(node.elseChildren, scope, errors, depth + 1, scope);
      }
      continue;
    }

    if (node.type === 'for') {
      const iterable = evalExpression(node.iterable, scope, errors);
      if (!Array.isArray(iterable)) continue;

      const limit = Math.min(iterable.length, FOR_LOOP_CAP);
      // 반복 변수만 반복 동안 걸고 끝나면 되돌린다(바깥 같은 이름 변수 보존)
      const hadLoopVar = Object.prototype.hasOwnProperty.call(scope, node.varName);
      const prevLoopVar = scope[node.varName];
      for (let idx = 0; idx < limit; idx++) {
        scope[node.varName] = iterable[idx];
        result += evaluate(node.children, scope, errors, depth + 1, scope);
      }
      if (hadLoopVar) scope[node.varName] = prevLoopVar; else delete scope[node.varName];
      if (iterable.length > FOR_LOOP_CAP) {
        errors.push({
          type: 'limit',
          message: `for 반복 한도 초과 (${iterable.length} > ${FOR_LOOP_CAP})`,
        });
      }
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
        const whenValue = evalExpression(when.value, scope, errors);
        if (looseEqual(targetValue, whenValue)) {
          result += evaluate(when.children, scope, errors, depth + 1, scope);
          matched = true;
          break;
        }
      }
      if (!matched && node.elseChildren) {
        result += evaluate(node.elseChildren, scope, errors, depth + 1, scope);
      }
      continue;
    }

    if (node.type === 'comment') continue;
  }

  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 표현식 평가 (filter + 변수 해석)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 조건 평가 (and/or + 비교 연산자 + contains)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function evalCondition(condStr: string, scope: Record<string, any>, errors: LiquidError[]): boolean {
  const trimmed = condStr.trim();

  const orParts = splitByLogicalOp(trimmed, 'or');
  if (orParts.length > 1) {
    return orParts.some((p) => evalCondition(p, scope, errors));
  }

  const andParts = splitByLogicalOp(trimmed, 'and');
  if (andParts.length > 1) {
    return andParts.every((p) => evalCondition(p, scope, errors));
  }

  return evalComparison(trimmed, scope, errors);
}

function evalComparison(expr: string, scope: Record<string, any>, errors: LiquidError[]): boolean {
  // 긴 op 먼저 매칭 (>= 가 > 보다 우선)
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
      const leftVal = evalAtom(left, scope, errors);
      const rightVal = evalAtom(right, scope, errors);
      return fn(leftVal, rightVal);
    }
  }

  return isTruthy(evalAtom(expr, scope, errors));
}

function findOperatorIndex(expr: string, op: string): number {
  let inStr: '"' | "'" | null = null;
  const isWordOp = /^[a-z]/.test(op);

  for (let i = 0; i <= expr.length - op.length; i++) {
    const c = expr[i];
    if (inStr) {
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
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
    if (inStr) {
      buf += c;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      buf += c;
      continue;
    }
    if (c === '|') {
      result.push(buf);
      buf = '';
      continue;
    }
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
    if (inStr) {
      buf += c;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      buf += c;
      continue;
    }
    // \s+op\s+ 매칭
    if (c === ' ' || c === '\t') {
      const lookAhead = expr.substring(i + 1, i + 1 + opLen);
      const after = expr[i + 1 + opLen];
      if (lookAhead === op && (after === ' ' || after === '\t')) {
        parts.push(buf);
        buf = '';
        i += opLen + 1;
        // 뒤 공백 skip
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Filter 화이트리스트 (10건)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function applyFilter(
  value: any,
  filterStr: string,
  scope: Record<string, any>,
  errors: LiquidError[],
): any {
  const colonIdx = filterStr.indexOf(':');
  const filterName = colonIdx > -1 ? filterStr.substring(0, colonIdx).trim() : filterStr.trim();
  const argsStr = colonIdx > -1 ? filterStr.substring(colonIdx + 1).trim() : '';
  const args = argsStr ? parseFilterArgs(argsStr, scope, errors) : [];

  switch (filterName) {
    case 'default':
      return value == null || value === '' ? args[0] : value;
    case 'upcase':
      return String(value ?? '').toUpperCase();
    case 'downcase':
      return String(value ?? '').toLowerCase();
    case 'capitalize': {
      const s = String(value ?? '');
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    case 'minus':
      return Number(value) - Number(args[0]);
    case 'plus':
      return Number(value) + Number(args[0]);
    case 'divided_by': {
      const divisor = Number(args[0]);
      if (divisor === 0) {
        errors.push({ type: 'runtime', message: 'divided_by 0 차단' });
        return 0;
      }
      return Number(value) / divisor;
    }
    case 'times':
      return Number(value) * Number(args[0]);
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
    if (inStr) {
      buf += c;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      buf += c;
      continue;
    }
    if (c === ',') {
      parts.push(buf);
      buf = '';
      continue;
    }
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
