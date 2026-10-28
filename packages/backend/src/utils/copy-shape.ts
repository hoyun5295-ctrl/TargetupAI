/**
 * 문안 모양 CT (★ 2026-10-28 AI 메모리 설계 K5-1 · I8 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * normalizeForShape = 법 꼬리(광고 머리 · 080 · 무료수신거부 줄 · [Web발신])만 뗀다 · 전송자 머리(첫 줄 [브랜드])는 남긴다.
 * measureText       = 한 편의 실측(늘 값을 낸다) · 생성문 검사 · 고치기 원문 대조.
 * buildCompanyShape = 여러 편을 모은 회사 기준값 · 칸마다 표본 3건 미만 = 미측정(null) · 반대 증거(evidence)는 1건으로 선다(I9).
 * AI 0 · 순수.
 */

export function normalizeForShape(text: string): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\[Web발신\]\s*\n?/i, '')
    .replace(/^\s*[(（]\s*광고\s*[)）]\s*/, '')
    .split('\n')
    .filter((l) => !/^\s*(무료\s*수신\s*거부|무료거부|수신거부)\s*[:：]?\s*0?\d[\d-]{6,}\s*$/.test(l))
    .join('\n')
    .replace(/\s*(무료\s*수신\s*거부|무료거부)\s*[:：]?\s*0?\d[\d-]{6,}\s*$/, '')
    .replace(/\n+$/, '')
    .replace(/^\n+/, '');
}

/** 스팸 자기 검사(copy-spam-risk)가 세는 기호와 같은 집합 */
const SPAM_SYMBOL_RE = /[!★☆♥♡~]/g;
/** 글자 · 숫자 · 공백 · 흔한 문장 부호 · 대괄호(전송자 머리 · 직접 채울 칸 = 법 · 규격)가 아닌 것 = 기호(KS X 1001 기호 · 화살표 등) */
const SYMBOL_RE = /[^\p{L}\p{N}\s.,?'"()%:;/\-+&@#*=_^\[\]]/gu;
/** 줄 전체가 같은 기호 3개 이상 = 구분선 실물 */
const DIVIDER_LINE_RE = /^\s*([^\p{L}\p{N}\s])\1{2,}\s*$/u;

export interface TextShape {
  chars: number;
  lines: number;
  paragraphs: number;
  maxBlankRun: number;
  lineLengths: number[];
  maxLineLen: number;
  dividers: number;
  symbols: Record<string, number>;
  spamSymbols: number;
  exclaims: number;
  firstLine: string;
  lastLine: string;
  /** 첫 줄이 [이름] 꼴로 시작하는가 */
  bracketHead: boolean;
}

export function measureText(text: string): TextShape {
  const t = normalizeForShape(text);
  const rawLines = t.split('\n');
  const nonEmpty = rawLines.filter((l) => l.trim().length > 0);
  let maxBlankRun = 0;
  let run = 0;
  for (const l of rawLines) {
    if (l.trim().length === 0) { run++; maxBlankRun = Math.max(maxBlankRun, run); } else run = 0;
  }
  const paragraphs = t.trim() ? t.trim().split(/\n[ \t]*\n+/).filter((p) => p.trim()).length : 0;
  const symbols: Record<string, number> = {};
  for (const m of t.matchAll(SYMBOL_RE)) symbols[m[0]] = (symbols[m[0]] || 0) + 1;
  const lineLengths = nonEmpty.map((l) => Array.from(l.trim()).length);
  const firstLine = (nonEmpty[0] || '').trim();
  return {
    chars: Array.from(t).length,
    lines: nonEmpty.length,
    paragraphs,
    maxBlankRun,
    lineLengths,
    maxLineLen: lineLengths.length ? Math.max(...lineLengths) : 0,
    dividers: rawLines.filter((l) => DIVIDER_LINE_RE.test(l)).length,
    symbols,
    spamSymbols: (t.match(SPAM_SYMBOL_RE) || []).length,
    exclaims: (t.match(/!/g) || []).length,
    firstLine,
    lastLine: (nonEmpty[nonEmpty.length - 1] || '').trim(),
    bracketHead: /^\[[^\]\n]{1,30}\]/.test(firstLine),
  };
}

/** 표본 하한(회사 기준값을 학습 · 채택할 때만 · I8) */
export const SHAPE_MIN_SAMPLES = 3;

export interface CompanyShape {
  n: number;
  /** 아래 측정 칸 = n < 3 이면 null(미측정) */
  lineLenP50: number | null;
  lineLenP90: number | null;
  maxBlankRun: number | null;
  paragraphs: { min: number; max: number } | null;
  exclaimMax: number | null;
  spamSymbolMax: number | null;
  /** 쓴 기호 = 빈도순(표본 1건부터 · 화면 칩 · 허용 집합) */
  symbols: string[];
  /** 반대 증거(1건이면 선다 · 스타일 규칙 끄기 · I9) */
  evidence: {
    divider: boolean;
    lineOver17: boolean;
    blankRunOver1: boolean;
    paragraphsUnder5: boolean;
    exclaimOver3: boolean;
    nonBracketHead: boolean;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function buildCompanyShape(texts: ReadonlyArray<string>): CompanyShape {
  const shapes = texts.map((t) => measureText(t)).filter((s) => s.chars > 0);
  const n = shapes.length;
  const ok = n >= SHAPE_MIN_SAMPLES;
  const allLens = shapes.flatMap((s) => s.lineLengths).sort((a, b) => a - b);
  const symCount: Record<string, number> = {};
  for (const s of shapes) for (const [k, v] of Object.entries(s.symbols)) symCount[k] = (symCount[k] || 0) + v;
  const paras = shapes.map((s) => s.paragraphs);
  return {
    n,
    lineLenP50: ok && allLens.length ? percentile(allLens, 50) : null,
    lineLenP90: ok && allLens.length ? percentile(allLens, 90) : null,
    maxBlankRun: ok ? Math.max(...shapes.map((s) => s.maxBlankRun)) : null,
    paragraphs: ok ? { min: Math.min(...paras), max: Math.max(...paras) } : null,
    exclaimMax: ok ? Math.max(...shapes.map((s) => s.exclaims)) : null,
    spamSymbolMax: ok ? Math.max(...shapes.map((s) => s.spamSymbols)) : null,
    symbols: Object.entries(symCount).sort((a, b) => b[1] - a[1]).map(([k]) => k),
    evidence: {
      divider: shapes.some((s) => s.dividers > 0),
      lineOver17: shapes.some((s) => s.maxLineLen > 17),
      blankRunOver1: shapes.some((s) => s.maxBlankRun > 1),
      paragraphsUnder5: shapes.some((s) => s.paragraphs < 5),
      exclaimOver3: shapes.some((s) => s.exclaims > 3),
      nonBracketHead: shapes.some((s) => !s.bracketHead),
    },
  };
}

/** (순수) 생성문 모양 검사 = 측정 칸만(줄 길이 p90 · 최대 연속 빈 줄 · 구분선 · 기호 집합) · SMS 는 줄 · 문단 검사 제외(K5-5) */
export function shapeIssues(output: string, shape: CompanyShape | null | undefined, channel: string): string[] {
  if (!shape || shape.n < SHAPE_MIN_SAMPLES) return [];
  const m = measureText(output);
  const issues: string[] = [];
  const isSms = String(channel || '').toUpperCase() === 'SMS';
  if (!isSms && shape.lineLenP90 != null && m.maxLineLen > Math.ceil(shape.lineLenP90 * 1.3)) {
    issues.push(`한 줄 길이를 ${shape.lineLenP90}자 안팎으로(지금 최대 ${m.maxLineLen}자)`);
  }
  if (!isSms && shape.maxBlankRun != null && m.maxBlankRun > shape.maxBlankRun) {
    issues.push(`빈 줄은 연속 ${shape.maxBlankRun}줄까지(지금 ${m.maxBlankRun}줄)`);
  }
  if (!shape.evidence.divider && m.dividers > 0) issues.push('구분선(같은 기호 3개 이상 한 줄) 쓰지 않기');
  const allowed = new Set(shape.symbols);
  const foreign = Object.keys(m.symbols).filter((s) => !allowed.has(s));
  if (foreign.length > 0) issues.push(`이 회사가 쓰지 않는 기호(${foreign.join(' ')}) 빼기`);
  return issues;
}

/**
 * (순수) 고치기 모드 출구 대조(I12 · K11-1) — 사람 원문의 꼴이 무너진 다시 쓰기인가.
 *   원문이 3줄 이상인데 1줄로 뭉침 · 원문에 없던 기호가 생김 · 원문보다 빈 줄이 더 길게 늘어남 = 꼴 이탈(그 안을 버린다).
 */
export function rewriteShapeDrift(original: string, output: string): string[] {
  const a = measureText(original);
  const b = measureText(output);
  const out: string[] = [];
  if (a.lines >= 3 && b.lines <= 1) out.push('줄바꿈이 사라짐');
  if (b.maxBlankRun > Math.max(1, a.maxBlankRun)) out.push('빈 줄이 늘어남');
  const added = Object.keys(b.symbols).filter((s) => !(s in a.symbols) && s !== '!' && s !== '~');
  if (added.length > 0) out.push(`원문에 없던 기호(${added.join(' ')})`);
  return out;
}
