/**
 * spam-block-hint.ts — 스팸 검사가 막혔을 때 「어느 부분이 걸린 것 같은지」의 순수 핵심 CT
 *   (★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §5 · §6-1 · §7)
 *
 * 통신사는 막은 이유를 주지 않는다. 그래서 둘로 좁힌다.
 *   A = 기록으로 의심 조각 고르기(rankSuspects · 보내기 0 · 저장 0)
 *   B = 의심 묶음을 뺀 확인 판 만들기(makeDiagVariant) · 그 결과로 대행 갈래 정하기(classifyDiag)
 * 이 파일은 DB 를 보지 않는다(순수). 읽기 · 등록 · 화면 응답은 이 함수들을 부르는 쪽이 한다.
 *
 * ponytail: 조각 = 낱말 단위라 「두 낱말이 함께 있어야 막힘」 같은 조합 차단은 가르지 못한다(B 가 「빼도 막힘」으로 받친다 · 4c).
 */

/** 닮은 글 문턱(자카드) — 시작값 · 구현 0단계에서 실제 차단 41행과 앞선 통과 글로 로컬에서 맞춘다(설계서 §5-2) */
export const DIAG_BASELINE_MIN_SIMILARITY = 0.5;

export type SuspectKind = 'url' | 'new_vs_passed' | 'rule' | 'other';
export interface SpamToken { token: string; line: number; legal: boolean; url: boolean }
export interface SpamLine { text: string; legal: boolean }
export interface Suspect { token: string; kind: SuspectKind; line: number; demoted?: boolean; confirmedNotSole?: boolean }

const URL_RE = /(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s]*/gi;
/** 조각 앞뒤에서 떼는 기호(꾸밈 · 괄호 · 문장 부호) — % 는 남긴다(20% 는 한 조각) */
const EDGE_RE = /^[\s■□●○◆◇▶▷►▲△▼▽>＞<※*·•\-—–[\](){}「」『』【】,.!?:;"'`~…]+|[\s■□●○◆◇▶▷►▲△▼▽>＞<※*·•\-—–[\](){}「」『』【】,.!?:;"'`~…]+$/g;
const AD_MARK = '(광고)';
const PHONE_080_RE = /^080-?\d{3,4}-?\d{4}$/;
const HAS_DIGIT_RE = /\d/;
const HAS_WORD_RE = /[0-9A-Za-z가-힣]/;
/** 보존 값(AI 다듬기가 바꾸지 않는 꼴) — 주소 · 숫자 든 조각 · 변수 칸 */
const PRESERVED_RE = /\d|%[^%\s]+%/;

function normToken(raw: string): string {
  const t = raw.replace(EDGE_RE, '');
  return /[A-Za-z]/.test(t) ? t.toLowerCase() : t;
}

/**
 * 글을 줄 · 조각으로.
 *   줄의 legal = 확인 판이 지키는 줄(B · §6-1) = (광고)가 든 첫 줄 · 「수신거부」가 든 줄.
 *   조각의 legal = 의심 후보에서 빼는 법정 조각(A · §5-1) = (광고) 그 조각 · 「수신거부」 줄의 조각 · 080 번호(어디서든).
 *   (광고) 첫 줄의 나머지 낱말은 후보다(첫 줄 문장도 걸릴 수 있다 · 판은 그 줄을 빼지 않을 뿐).
 */
export function tokenizeSpamText(text: string): { lines: SpamLine[]; tokens: SpamToken[] } {
  const rawLines = String(text || '').split('\n');
  let adLineSeen = false;
  const optOut: boolean[] = [];
  const lines: SpamLine[] = rawLines.map((l, i) => {
    let legal = false;
    if (!adLineSeen && l.includes(AD_MARK)) { legal = true; adLineSeen = true; }
    optOut[i] = l.includes('수신거부');
    if (optOut[i]) legal = true;
    return { text: l, legal };
  });
  const tokens: SpamToken[] = [];
  lines.forEach((ln, i) => {
    let rest = ln.text;
    for (const m of ln.text.matchAll(URL_RE)) {
      const u = m[0].replace(/[),.!?]+$/, '');
      tokens.push({ token: u.toLowerCase(), line: i, legal: optOut[i], url: true });
      rest = rest.replace(m[0], ' ');
    }
    for (const w of rest.split(/\s+/)) {
      if (!w) continue;
      if (w === AD_MARK) { tokens.push({ token: AD_MARK, line: i, legal: true, url: false }); continue; }
      const t = normToken(w);
      if (!t || !HAS_WORD_RE.test(t)) continue;
      tokens.push({ token: t, line: i, legal: optOut[i] || PHONE_080_RE.test(t), url: false });
    }
  });
  return { lines, tokens };
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenizeSpamText(text).tokens.filter((t) => !t.legal).map((t) => t.token));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const hasAdMark = (t: string) => String(t || '').includes(AD_MARK);

/** 닮은 지난 통과 글 하나 — 광고 표기 유무가 같고 조각 겹침이 문턱 이상인 것 중 가장 닮은 것 · 없으면 null */
export function pickBaseline(blockedText: string, passed: ReadonlyArray<{ text: string; at: string }>): { text: string; at: string; similarity: number } | null {
  const mine = tokenSet(blockedText);
  let best: { text: string; at: string; similarity: number } | null = null;
  for (const p of passed) {
    if (hasAdMark(p.text) !== hasAdMark(blockedText)) continue;
    const s = jaccard(mine, tokenSet(p.text));
    if (s >= DIAG_BASELINE_MIN_SIMILARITY && (!best || s > best.similarity)) best = { text: p.text, at: p.at, similarity: s };
  }
  return best;
}

const KIND_RANK: Record<SuspectKind, number> = { url: 0, new_vs_passed: 1, rule: 2, other: 3 };

/**
 * A — 의심 조각 순서(설계서 §5-2).
 *   후보 = 보낸 글의 조각 중 원문(고객이 쓴 글)에도 있는 것(변수 값 · 개인정보 0) · 법정 조각 제외.
 *   주소 → 닮은 지난 통과 글에 없던 조각 → 우리 차단정보 규칙 조각 → 그 밖. 같은 글의 고친 판(겹침 문턱 이상)이 그 조각 없이도 막혔으면 뒤로 민다(지우지 않음).
 *   이 검사의 확인 판으로 「빼도 막힘」이 확정된 조각 = confirmedNotSole 표시.
 */
export function rankSuspects(i: {
  sentText: string; templateText: string;
  passedTexts: ReadonlyArray<{ text: string; at: string }>;
  blockedSiblings: ReadonlyArray<string>;
  ruleTokens: ReadonlyArray<string>;
  confirmedNotSole: ReadonlyArray<string>;
}): { suspects: Suspect[]; baseline: { at: string } | null } {
  const template = tokenSet(i.templateText);
  const sent = tokenizeSpamText(i.sentText).tokens.filter((t) => !t.legal && template.has(t.token));
  const baseline = pickBaseline(i.sentText, i.passedTexts);
  const baseSet = baseline ? tokenSet(baseline.text) : null;
  const mine = tokenSet(i.sentText);
  const siblings = i.blockedSiblings.map(tokenSet).filter((s) => jaccard(mine, s) >= DIAG_BASELINE_MIN_SIMILARITY);
  const rules = new Set(i.ruleTokens.map((t) => normToken(t)));
  const confirmed = new Set(i.confirmedNotSole.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  const suspects: Suspect[] = [];
  for (const t of sent) {
    if (seen.has(t.token)) continue;
    seen.add(t.token);
    const kind: SuspectKind = t.url ? 'url' : baseSet && !baseSet.has(t.token) ? 'new_vs_passed' : rules.has(t.token) ? 'rule' : 'other';
    const s: Suspect = { token: t.token, kind, line: t.line };
    if (siblings.some((sib) => !sib.has(t.token))) s.demoted = true;
    if (confirmed.has(t.token)) s.confirmedNotSole = true;
    suspects.push(s);
  }
  suspects.sort((a, b) => (Number(!!a.demoted) - Number(!!b.demoted)) || (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || (a.line - b.line));
  return { suspects, baseline: baseline ? { at: baseline.at } : null };
}

/**
 * B — 확인 판 만들기(설계서 §6-1 · 통신사마다).
 *   판 ① = 보낸 글의 주소 조각만 뺀다(주소를 빼고 기호만 남는 줄은 줄째) · 주소 0 이면 null.
 *   판 ② = 표시한 줄을 뺀다: 지난 글에 없던 조각(없으면 규칙 조각)이 든 줄 · 그것도 없으면 숫자가 든 줄. 주소만 든 줄 · 법정 줄은 안 뺀다.
 *   법정 줄은 어느 판에서도 남는다 · 남는 줄이 법정 줄뿐이면 null.
 */
/** 판이 무엇을 기준으로 뺐나 — url = 판 ① · suspect = 표시한 줄(지난 글에 없던 · 규칙 조각) · digits = 숫자 든 줄(혜택 줄 · 화면 이름) */
export type DiagVariantBasis = 'url' | 'suspect' | 'digits';

export function makeDiagVariant(sentText: string, variant: 1 | 2, suspects: ReadonlyArray<Suspect>): { text: string; removedTokens: string[]; removedLines: string[]; basis: DiagVariantBasis } | null {
  const { lines, tokens } = tokenizeSpamText(sentText);
  const out = lines.map((l) => l.text);
  const removedTokens: string[] = [];
  const removedLines: string[] = [];
  const drop = new Set<number>();
  let basis: DiagVariantBasis = 'url';

  if (variant === 1) {
    // ★ 배포 2 Codex 1R — 법정 줄((광고) 첫 줄 · 수신거부 줄)은 원문 그대로 · 주소를 실제로 뺀 줄만 기호만 남으면 줄째 뺀다(원문의 구분 줄 · 기호 줄은 그대로)
    const urls = tokens.filter((t) => t.url && !t.legal && !lines[t.line].legal);
    if (urls.length === 0) return null;
    const touched = new Set<number>();
    for (const u of urls) {
      const idx = out[u.line].toLowerCase().indexOf(u.token);
      if (idx < 0) continue;
      out[u.line] = out[u.line].slice(0, idx) + out[u.line].slice(idx + u.token.length);
      removedTokens.push(u.token);
      touched.add(u.line);
    }
    if (touched.size === 0) return null;
    for (const i of touched) if (!HAS_WORD_RE.test(out[i])) drop.add(i);
  } else {
    const urlOnly = (i: number) => {
      const words = tokens.filter((t) => t.line === i && !t.legal);
      return words.length > 0 && words.every((t) => t.url);
    };
    const pick = (kind: SuspectKind) => {
      const want = new Set(suspects.filter((s) => s.kind === kind && !s.demoted && !s.confirmedNotSole).map((s) => s.token));
      return new Set(tokens.filter((t) => want.has(t.token) && !t.legal && !t.url).map((t) => t.line));
    };
    let target = pick('new_vs_passed');
    if (target.size === 0) target = pick('rule');
    basis = 'suspect';
    if (target.size === 0) {
      basis = 'digits';
      target = new Set(lines.map((l, i) => i).filter((i) => {
        if (lines[i].legal || urlOnly(i)) return false;
        return tokens.some((t) => t.line === i && !t.url && !t.legal && HAS_DIGIT_RE.test(t.token));
      }));
    }
    for (const i of target) {
      if (lines[i].legal || urlOnly(i)) continue;
      drop.add(i);
      removedLines.push(lines[i].text);
      for (const t of tokens) if (t.line === i && !t.legal && !t.url) removedTokens.push(t.token);
    }
    if (drop.size === 0) return null;
  }

  const kept = out.filter((_l, i) => !drop.has(i));
  const keptLines = lines.filter((_l, i) => !drop.has(i));
  const hasNonLegal = kept.some((l, i) => !keptLines[i].legal && HAS_WORD_RE.test(l));
  if (!hasNonLegal) return null;
  return { text: kept.join('\n'), removedTokens, removedLines, basis };
}

export type DiagCheckState = 'queued' | 'checking' | 'arrived' | 'blocked' | 'unknown';
export interface CarrierChecks { v1?: DiagCheckState; v2?: DiagCheckState; v2Removed?: string[] }

/**
 * 대행 갈래(설계서 §7 · 확정 결과만 · 막힌 통신사 = 지금 blocked 인 통신사).
 *   wait = 대기 · 확인 중이 남음 / 4a = 막힌 통신사 전부 판 ① 도착 / 4b = 판 ② 도착(avoid = 그 판이 뺀 조각 중 보존 값이 아닌 것) /
 *   register_v2 = 판 ① 빼도 막힘 확정인데 판 ② 가 아직 없음(부르는 쪽이 자격을 보고 등록 · 못 하면 4c) / 4c = 그 밖.
 */
export function classifyDiag(i: { blockedCarriers: ReadonlyArray<string>; checks: Readonly<Record<string, CarrierChecks>> }): {
  branch: 'wait' | '4a' | '4b' | '4c' | 'register_v2'; avoid?: string[]; registerV2Carriers?: string[];
} {
  const cs = i.blockedCarriers.map((c) => ({ c, ch: i.checks[c] || {} }));
  const pending = (s?: DiagCheckState) => s === 'queued' || s === 'checking';
  if (cs.some(({ ch }) => pending(ch.v1) || pending(ch.v2))) return { branch: 'wait' };
  if (cs.length > 0 && cs.every(({ ch }) => ch.v1 === 'arrived')) return { branch: '4a' };
  const arrivedV2 = cs.filter(({ ch }) => ch.v2 === 'arrived');
  if (arrivedV2.length > 0) {
    const avoid = [...new Set(arrivedV2.flatMap(({ ch }) => ch.v2Removed || []))]
      .filter((t) => !PRESERVED_RE.test(t) && !/^(?:https?:\/\/|www\.)/i.test(t) && !/\.[a-z]{2,}\//i.test(t));
    return { branch: '4b', avoid };
  }
  const needV2 = cs.filter(({ ch }) => ch.v1 === 'blocked' && ch.v2 === undefined).map(({ c }) => c);
  if (needV2.length > 0) return { branch: 'register_v2', registerV2Carriers: needV2 };
  return { branch: '4c' };
}
