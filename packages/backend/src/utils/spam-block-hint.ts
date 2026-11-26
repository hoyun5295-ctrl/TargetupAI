/**
 * spam-block-hint.ts — 스팸 검사가 막혔을 때 「어느 부분이 걸린 것 같은지」의 순수 핵심 CT
 *   (★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §5 · §6-1 · §7)
 *
 * 통신사는 막은 이유를 주지 않는다. 그래서 둘로 좁힌다.
 *   A = 기록으로 의심 조각 고르기(rankSuspects · 보내기 0 · 저장 0)
 *   B = 목적(주소 · 혜택)을 지킨 채 바꾼 글을 막힌 통신사로 보내 보기 — 고칠 줄(editableLines) · 판 상태와 다음(classifyRewrite) · 바꿈 목록(plateFixes) · 받기(applySpamFixes)
 *       (★ 2026-11-26 C164 · 옛 「의심 부분을 뺀 글」 판은 없앴다 = 주소 · 혜택을 빼면 문자를 보낼 이유가 없다)
 * 이 파일은 DB 를 보지 않는다(순수). 읽기 · 등록 · 화면 응답은 이 함수들을 부르는 쪽이 한다.
 *
 * ponytail: 조각 = 낱말 단위라 「두 낱말이 함께 있어야 막힘」 같은 조합 차단은 가르지 못한다(B 가 글을 통째로 바꿔 보내 받친다).
 */

/** 닮은 글 문턱(자카드) — 시작값 · 구현 0단계에서 실제 차단 41행과 앞선 통과 글로 로컬에서 맞춘다(설계서 §5-2) */
export const DIAG_BASELINE_MIN_SIMILARITY = 0.5;

export type SuspectKind = 'url' | 'new_vs_passed' | 'rule' | 'other';
export interface SpamToken { token: string; line: number; legal: boolean; url: boolean }
export interface SpamLine { text: string; legal: boolean }
export interface Suspect { token: string; kind: SuspectKind; line: number; demoted?: boolean }

const URL_RE = /(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s]*/gi;
/** 조각 앞뒤에서 떼는 기호(꾸밈 · 괄호 · 문장 부호) — % 는 남긴다(20% 는 한 조각) */
const EDGE_RE = /^[\s■□●○◆◇▶▷►▲△▼▽>＞<※*·•\-—–[\](){}「」『』【】,.!?:;"'`~…]+|[\s■□●○◆◇▶▷►▲△▼▽>＞<※*·•\-—–[\](){}「」『』【】,.!?:;"'`~…]+$/g;
const AD_MARK = '(광고)';
const PHONE_080_RE = /^080-?\d{3,4}-?\d{4}$/;
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
 */
export function rankSuspects(i: {
  sentText: string; templateText: string;
  passedTexts: ReadonlyArray<{ text: string; at: string }>;
  blockedSiblings: ReadonlyArray<string>;
  ruleTokens: ReadonlyArray<string>;
}): { suspects: Suspect[]; baseline: { at: string } | null } {
  const template = tokenSet(i.templateText);
  const sent = tokenizeSpamText(i.sentText).tokens.filter((t) => !t.legal && template.has(t.token));
  const baseline = pickBaseline(i.sentText, i.passedTexts);
  const baseSet = baseline ? tokenSet(baseline.text) : null;
  const mine = tokenSet(i.sentText);
  const siblings = i.blockedSiblings.map(tokenSet).filter((s) => jaccard(mine, s) >= DIAG_BASELINE_MIN_SIMILARITY);
  const rules = new Set(i.ruleTokens.map((t) => normToken(t)));
  const seen = new Set<string>();
  const suspects: Suspect[] = [];
  for (const t of sent) {
    if (seen.has(t.token)) continue;
    seen.add(t.token);
    const kind: SuspectKind = t.url ? 'url' : baseSet && !baseSet.has(t.token) ? 'new_vs_passed' : rules.has(t.token) ? 'rule' : 'other';
    const s: Suspect = { token: t.token, kind, line: t.line };
    if (siblings.some((sib) => !sib.has(t.token))) s.demoted = true;
    suspects.push(s);
  }
  suspects.sort((a, b) => (Number(!!a.demoted) - Number(!!b.demoted)) || (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || (a.line - b.line));
  return { suspects, baseline: baseline ? { at: baseline.at } : null };
}

/** 판 결과 행 하나의 상태 — queued · checking = 아직 모름 · arrived = 도착 · blocked = 막힘 · unknown = 확인 못 함(실패 · 시간 초과 · 오류) */
export type DiagCheckState = 'queued' | 'checking' | 'arrived' | 'blocked' | 'unknown';

// ════════════════════════════════════════════════════════════════════
// ★ 2026-11-26 C164 재작성 판(설계서 docs/2026-11-25-spam-diag-rewrite-design.md) — 「뺀 글」이 아니라 「목적(주소 · 혜택)을 지킨 채 바꾼 글」
//   판 = 글당 최대 3판(R1 ~ R3) · 판 하나를 막힌 통신사 전부에 보냄 · 전부 도착한 첫 판 = 고객이 받을 글.
// ════════════════════════════════════════════════════════════════════

/** 판 종류 — w1 표현만 바꾼 글 · w1u 그 본문에 짧은 주소 · w2 새로 쓴 글 · w2u 그 본문에 짧은 주소(§5-1) */
export type PlateKind = 'w1' | 'w1u' | 'w2' | 'w2u';
/** 고칠 수 있는 줄 — 보낸 글의 줄 위치 ↔ 원문(변수 칸 그대로인 글)의 줄 위치 */
export interface EditableLine { sentLine: number; tplLine: number }
/** 바꿈 하나(§6-3) — tplLine = 원문 줄 위치 · before = 그 원문 줄 · 제목은 tplLine 0 */
export interface SpamFix { field: 'body' | 'subject'; tplLine: number; before: string; after: string; kind: 'text' | 'url' }
/** 판 하나의 지금 상태 — 결과 = 그 판을 보낸 통신사마다 */
export interface PlateState { kind: PlateKind; results: Array<{ carrier: string; state: DiagCheckState }>; closed?: boolean; ended?: { reason: string } | null }
export type RewriteStep =
  | { kind: 'closed' } | { kind: 'wait' } | { kind: 'end_unknown' }
  | { kind: 'found'; plate: number }
  | { kind: 'next'; candidates: PlateKind[] }
  | { kind: 'ask_url'; options: PlateKind[] }
  | { kind: 'end'; reason: string };

export const REWRITE_MAX_PLATES = 3;
/** 수신자 값이 들어가는 자리 — 변수 칸 · Liquid 식(이 줄은 AI 도 주소 바꾸기도 건드리지 않는다) */
const VALUE_SLOT_RE = /%[^%\s]+%|\{\{|\{%/;
/** 글에 수신자 값 자리가 있는가(제목을 고칠 수 있는지 판정) */
export const hasValueSlot = (text: string): boolean => VALUE_SLOT_RE.test(String(text || ''));
/** 다른 말로 바꿔 달라고 할 수 있는 조각인가 — 숫자 · 변수 칸 · 주소는 아니다(그 값은 그대로 남아야 한다 · §6-2 avoid) */
export const isRewordable = (token: string): boolean => !PRESERVED_RE.test(token) && !/^(?:https?:\/\/|www\.)/i.test(token) && !/\.[a-z]{2,}\//i.test(token);

/**
 * 고칠 수 있는 줄(§6-1) — **줄 자리로 짝짓는다**(★ Codex 구현 1R · 2R 같은 부류 두 번 = 구조 답).
 *   검사 글은 원문의 줄 순서 그대로 만들어진다: 변수는 그 줄 안에서 값으로 바뀌고, 광고 표기는 첫 줄 앞에 붙고, 수신거부 줄은 맨 뒤에 붙는다(messageUtils buildAdMessage).
 *   그래서 원문 k번째 줄의 출처는 보낸 글 k번째 줄이다. 글자가 같은 줄을 찾아 짝짓지 않는다 — 수신자 값이 우연히 원문의 다른 줄과 같은 글자여도 자리가 다르면 그 줄이 아니다.
 *   고칠 줄 = 그 자리의 두 줄이 글자 그대로 같고 · 원문 줄에 변수 칸 · Liquid 식이 없고 · 법정 줄 · 빈 줄이 아닌 것.
 *   isLegalLine = 법정 줄 판정(★ Codex 구현 3R — 발송 조립기가 광고 머리말 · 수신거부 꼬리말로 인정하는 꼴 그대로 · 「( 광고 )」 · 「무료 수신 거부」 · 「무료거부」 · 부르는 쪽이 조립기의 판정을 넘긴다 · 이 파일에 식을 따로 두지 않는다).
 *   이 함수의 짝은 「있을 법한 줄」을 고르는 것까지다 — 판과 받기가 실제로 같은 글이 되는지는 등록이 발송 조립기로 다시 조립해 글자 그대로 대조한다(spam-diag 조립 관문 ①②).
 *   수신자 값이 든 줄은 원문 줄에 변수 칸이 있어 빠진다 = 그 값은 AI 요청에 실리지 않는다. 첫 줄에 광고 표기가 붙었으면 글자가 달라 빠진다(법정 줄).
 *   자리를 믿을 수 없는 글 = 고칠 줄 0: 보낸 글이 원문보다 짧거나, 원문 줄 수 뒤에 빈 줄 · 수신거부 줄 말고 다른 줄이 남는다(값에 줄바꿈이 있어 줄이 밀린 글).
 */
export function editableLines(sentText: string, templateText: string, isLegalLine: (line: string) => boolean): EditableLine[] {
  const tpl = String(templateText || '').replace(/\n+$/, '').split('\n');
  const sent = tokenizeSpamText(sentText).lines;
  if (sent.length < tpl.length) return [];
  if (sent.slice(tpl.length).some((l) => l.text.trim() && !isLegalLine(l.text))) return [];
  const out: EditableLine[] = [];
  tpl.forEach((t, k) => {
    if (t.trim() && !VALUE_SLOT_RE.test(t) && sent[k].text === t && !sent[k].legal && !isLegalLine(t)) out.push({ sentLine: k, tplLine: k });
  });
  return out;
}

/**
 * 판 글에서 바꿈 목록(§6-3) — 줄 수가 같고 달라진 줄이 모두 고칠 줄일 때만 · 아니면 null(그 판은 버린다 = 고정 줄 보존 §6-2 ⑥).
 *   kind url = 그 줄에서 주소만 바뀜 · 표현도 함께 바뀌었으면 text(주소를 바꿨는지는 판의 주소 목록이 따로 말한다).
 */
export function plateFixes(sentText: string, plateText: string, editable: ReadonlyArray<EditableLine>, urls: ReadonlyArray<{ from: string; to: string }>): SpamFix[] | null {
  const a = String(sentText || '').split('\n');
  const b = String(plateText || '').split('\n');
  if (a.length !== b.length) return null;
  const tplOf = new Map(editable.map((e) => [e.sentLine, e.tplLine]));
  const fixes: SpamFix[] = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    const tplLine = tplOf.get(i);
    if (tplLine === undefined) return null;
    const urlOnly = urls.reduce((t, u) => t.split(u.from).join(u.to), a[i]) === b[i];
    fixes.push({ field: 'body', tplLine, before: a[i], after: b[i], kind: urlOnly ? 'url' : 'text' });
  }
  return fixes;
}

/**
 * 판 상태 · 다음(§5-1 · §5-2 · 순수).
 *   closed = 닫힌 진단 · found = 대상 전부 도착한 첫 판(늦은 보고로 앞 판이 도착이 돼도 그 판) · wait = 마지막 판이 확인 중 ·
 *   end_unknown = 마지막 판에 확인 못 한 결과가 있음(판을 더 보내지 않는다) · end = 못 만들었다고 적힌 판 · 3판 · 더 만들 종류 없음 ·
 *   next = 차례로 만들어 볼 종류(앞 것을 못 만들면 다음 것) · ask_url = 화면 소유 + 주소가 있는 글(주소 판은 사람이 눌러야 만든다).
 *   hasUrl = 고칠 줄에 바꿀 수 있는 주소가 있는가(부르는 쪽이 주소 바꾸기 CT 로 판정).
 */
export function classifyRewrite(i: { plates: ReadonlyArray<PlateState>; owner: 'screen' | 'agency'; hasUrl: boolean }): RewriteStep {
  const { plates } = i;
  if (plates.some((p) => p.closed)) return { kind: 'closed' };
  const found = plates.findIndex((p) => p.results.length > 0 && p.results.every((r) => r.state === 'arrived'));
  if (found >= 0) return { kind: 'found', plate: found };
  const last = plates[plates.length - 1];
  if (!last) return { kind: 'next', candidates: ['w1'] };
  if (last.results.some((r) => r.state === 'queued' || r.state === 'checking')) return { kind: 'wait' };
  if (last.results.length === 0 || last.results.some((r) => r.state === 'unknown')) return { kind: 'end_unknown' };
  if (last.ended) return { kind: 'end', reason: last.ended.reason };
  if (plates.length >= REWRITE_MAX_PLATES) return { kind: 'end', reason: 'exhausted' };
  const canSwap = i.hasUrl && !plates.some((p) => p.kind === 'w1u' || p.kind === 'w2u');
  const urlKind: PlateKind[] = !canSwap ? [] : last.kind === 'w1' ? ['w1u'] : last.kind === 'w2' ? ['w2u'] : [];
  const candidates: PlateKind[] = [...urlKind, ...(last.kind === 'w1' || last.kind === 'w1u' ? ['w2' as const] : [])];
  if (candidates.length === 0) return { kind: 'end', reason: 'exhausted' };
  return i.owner === 'screen' && urlKind.length > 0 ? { kind: 'ask_url', options: candidates } : { kind: 'next', candidates };
}

/**
 * 받기(§9-1 · 서버 한 곳) — 바꿈 목록을 지금 글에 넣는다.
 *   지금 글 = 원문 그대로면 줄 위치로 · 달라졌으면 바꿀 줄이 원문에도 지금 글에도 딱 하나일 때만 그 줄을(줄이 옮겨 가도 같은 줄로 확정) · 하나라도 아니면 넣지 않는다.
 *   제목 = 지금 제목이 바꾸기 전 제목과 같을 때만.
 */
export function applySpamFixes(
  current: { body: string; subject: string | null }, template: { body: string; subject: string | null }, fixes: ReadonlyArray<SpamFix>,
): { ok: true; body: string; subject: string | null } | { ok: false; reason: 'changed' } {
  const cur = String(current.body || '').split('\n');
  const tpl = String(template.body || '').split('\n');
  const same = current.body === template.body;
  const once = (list: string[], line: string) => list.indexOf(line) >= 0 && list.indexOf(line) === list.lastIndexOf(line);
  const out = [...cur];
  let subject = current.subject;
  for (const f of fixes) {
    if (f.field === 'subject') {
      if ((current.subject ?? '') !== f.before) return { ok: false, reason: 'changed' };
      subject = f.after;
      continue;
    }
    const at = same ? (tpl[f.tplLine] === f.before ? f.tplLine : -1) : once(tpl, f.before) && once(cur, f.before) ? cur.indexOf(f.before) : -1;
    if (at < 0) return { ok: false, reason: 'changed' };
    out[at] = f.after;
  }
  return { ok: true, body: out.join('\n'), subject };
}
