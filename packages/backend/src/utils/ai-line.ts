/**
 * utils/ai-line.ts — AI 한줄로 판정 · 키 · 금액 · 칩 글 CT (순수 · DB 0 · AI 0 · ★ 2026-10-18)
 *
 * 설계서 = docs/2026-10-18-ai-line-design.md §5 · §6
 * "한 줄을 치면 대상을 뽑고, 이미 말한 것은 다시 묻지 않고, 빠진 것만 확인한 뒤, 고른 종류의 문안만 만든다."
 *
 * ⛔ 불변
 *   - 판정(갈래 · 빠진 것)은 사용자가 친 한 줄로만 한다(생성물로 결측을 찾지 않는다 · one-line-facts 원칙).
 *   - 조건 출처는 AI 자기 신고가 아니라 **조각이 원문에 실제로 있는가**로 서버가 정한다. 모르면 「AI 가 보탬」(끌 수 있는 쪽).
 *   - 원장 키 = 회사 + 날짜/시도 + 입력 지문. 같은 날 같은 한 줄 = 기본 0 · 같은 시도 재요청 = 0.
 */
import { VOICE_FORM_ASK, LINK_MAX, ONCE_LINK_LABEL, linkSpans, type VoiceFormSlot } from './voice-form-slots';
import { createHash } from 'crypto';
import { oneLineGaps, hasPromotionIntent, hasConcreteBenefit } from './one-line-facts';
import { linePeriodMentioned, lineFingerprint } from './one-line-steps';
import { kstDateTag, getCreditCost } from './ai-credit-calc';
import { SENDABLE_RECIPIENTS_LIMIT } from './operator-recipients';

// ★ 2026-10-19 스위치 삭제(Harold 「스위치고 뭐고」) — 새 흐름 = 전 회사 · AI 한줄로의 유일한 흐름.

// ─────────────── read (AI 0 · DB 0) ───────────────

export type AiLineBranch = 'sms' | 'alimtalk' | 'ask_kakao';

const ALIMTALK_RE = /알림\s*톡/;
const KAKAO_RE = /카톡|카카오/;

export interface AiLineRead {
  branch: AiLineBranch;
  /** 문자 갈래에서만 — 행사인데 혜택 값이 없다 · 행사인데 기간 말이 없다 */
  gaps: { benefit: boolean; period: boolean };
  /** 알림톡 + 광고 의도(할인 · 이벤트) = 알림톡으로 보낼 수 없다 */
  adConflict: boolean;
}

/** (순수) 한 줄 규칙 판정(갈래와 무관 · 카톡 갈래에서 문자를 고르면 같은 판정) — 행사인데 혜택 값이 없다 · 행사인데 기간 말이 없다 */
export function lineRuleGaps(line: string): { benefit: boolean; period: boolean } {
  const t = String(line || '').trim();
  return { benefit: oneLineGaps(t).benefit, period: hasPromotionIntent(t) && !linePeriodMentioned(t) };
}

/** (순수) 한 줄 → 갈래 · 빠진 것. 알림톡 갈래는 문안을 만들지 않으므로 묻지 않는다. */
export function readAiLine(line: string): AiLineRead {
  const t = String(line || '').trim();
  const branch: AiLineBranch = ALIMTALK_RE.test(t) ? 'alimtalk' : KAKAO_RE.test(t) ? 'ask_kakao' : 'sms';
  const g = lineRuleGaps(t);
  const sms = branch === 'sms';
  return {
    branch,
    gaps: { benefit: sms && g.benefit, period: sms && g.period },
    adConflict: branch === 'alimtalk' && hasPromotionIntent(t),
  };
}

// ─────────────── 묻는 목록(★ 2026-10-20 설계서 §17 · AI 가 한 줄을 읽고 판단 · 규칙은 안전망) ───────────────

export type AiLineAskKind = 'benefit' | 'period' | 'text';
export interface AiLineAsk {
  /** 'benefit' · 'period' · 'q1'… (화면 답 칸 키) */
  id: string;
  kind: AiLineAskKind;
  text: string;
  /** 왜 묻는지 한 줄(비면 '') */
  why: string;
  /** 고르기 칩(그 밖 질문만 · 혜택 값 · 숫자 없음) */
  options: string[];
  source: 'ai' | 'rule';
  /** ★ 2026-10-31 미리 채울 답(링크 질문 = 한 줄 속 주소 · 사람이 지우면 그 뜻이 이긴다 · 설계서 docs/2026-10-31-ai-line-answer-link-design.md P1) */
  prefill?: string;
}
/** 형식 검사용 상한(개수를 정하는 값이 아니다 · 응답이 망가졌을 때 화면과 요청 크기를 지킨다) */
export const AI_LINE_ASKS_MAX = 8;

/** 줄표를 나열 점으로 · 공백 정리 · 길이 상한(AI 가 쓴 글을 화면에 그대로 싣지 않는다) */
const tidyAsk = (s: unknown, max: number) => String(s ?? '').replace(/\u2014/g, ' · ').replace(/\s+/g, ' ').trim().slice(0, max);
/** 칩에 혜택 값이 실리면 사람이 누르는 순간 지어낸 혜택이 사실이 된다 — 숫자 · 혜택 낱말이 든 칩은 버린다 */
const ASK_OPTION_BAD_RE = /\d|%|원|무료|할인|쿠폰|적립|증정|사은품|포인트|세일|특가|반값|캐시백|페이백/;

/**
 * (순수) 질문 글에 한 줄에 없는 혜택 값이 있는가 — 한 줄에 없는 숫자 · 한 줄에 구체 혜택이 없는데 질문에 있는 구체 혜택.
 * ★ Codex 1020 R1 high — 「10% 할인은 어디서 쓰나요?」처럼 AI 가 지어낸 혜택을 사람에게 사실처럼 보이지 않게 질문째 버린다.
 */
function askInventsBenefit(text: string, line: string): boolean {
  const lineDigits = String(line || '').replace(/[,\s]/g, '');
  const nums = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || [];
  if (nums.some((n) => !lineDigits.includes(n))) return true;
  return hasConcreteBenefit(text) && !hasConcreteBenefit(line);
}

/** AI 가 kind link 로 낸 질문 표시(sanitizeAiAsks → mergeLineAsks 사이에서만 쓴다) */
const AI_LINK_ASK_ID = 'ai_link';
/** ★ 2026-10-31 AI 한줄로 링크 질문(목소리 링크 질문이 없을 때 · 글 = 서버 상수 = 답 식별 키 · 비움 = 결정 없음) */
export const LINE_LINK_ASK = { id: 'link', label: '문자에 넣을 링크 주소가 있으면 알려 주세요', help: '적으면 문자마다 이 주소를 넣어요. 비우면 지금처럼 써요.' } as const;

/** (순수) 대상 찾기 AI 가 낸 질문 → 화면에 실을 질문(모양 검사 · 지어낸 혜택 질문 버림 · 칩 거르기 · 같은 종류 · 같은 글 하나만) */
export function sanitizeAiAsks(raw: unknown, line: string): AiLineAsk[] {
  if (!Array.isArray(raw)) return [];
  const out: AiLineAsk[] = [];
  let textN = 0;
  for (const q of raw) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) continue;
    const r = q as Record<string, unknown>;
    const text = tidyAsk(r.question ?? r.text, 80);
    if (text.length < 4) continue;
    if (askInventsBenefit(text, line)) continue;
    const k = String(r.kind || '').toLowerCase();
    // ★ 2026-10-31 AI 가 kind link 로 낸 주소 질문 = 링크 질문 표시(id ai_link) · 묻는 글은 mergeLineAsks 가 서버 상수로 바꾼다(P1 · 글을 다시 분류하지 않는다)
    if (k === 'link') {
      if (!out.some((x) => x.id === AI_LINK_ASK_ID)) out.push({ id: AI_LINK_ASK_ID, kind: 'text', text, why: '', options: [], source: 'ai' });
      if (out.length >= AI_LINE_ASKS_MAX) break;
      continue;
    }
    const kind: AiLineAskKind = k === 'benefit' ? 'benefit' : k === 'period' ? 'period' : 'text';
    if (out.some((x) => x.text === text || (kind !== 'text' && x.kind === kind))) continue;
    const options = kind === 'text' && Array.isArray(r.options)
      ? [...new Set(r.options.map((o) => tidyAsk(o, 20)))].filter((o) => o.length >= 1 && !ASK_OPTION_BAD_RE.test(o) && !hasConcreteBenefit(o)).slice(0, 5)
      : [];
    const id = kind === 'text' ? `q${++textN}` : kind;
    out.push({ id, kind, text, why: tidyAsk(r.why, 60), options, source: 'ai' });
    if (out.length >= AI_LINE_ASKS_MAX) break;
  }
  return out;
}

/**
 * (순수) 묻는 목록 한 자리 — AI 가 판단한 질문 + 규칙 안전망(AI 가 혜택 · 기간을 놓쳤을 때만 보탠다).
 * 순서 = 혜택 → 기간 → 그 밖. 다 갖춘 한 줄이면 빈 목록(이 단계 없이 다음).
 * ★ 2026-10-31 링크 질문 한 자리(P1) — 목소리 링크 질문(voice_link)이 있으면 그것 하나 · 없으면 AI 링크 질문 · 한 줄 주소가 LINE_LINK_ASK 하나.
 *   lineLink = 한 줄 속 주소(readLinkText(line).url) = 그 자리의 미리 채움.
 */
export function mergeLineAsks(line: string, aiAsks: AiLineAsk[], voiceAsks: readonly AiLineAsk[] = [], lineLink: string | null = null): AiLineAsk[] {
  const g = lineRuleGaps(line);
  const aiLinkAsked = aiAsks.some((a) => a.id === AI_LINK_ASK_ID);
  const all = aiAsks.filter((a) => a.id !== AI_LINK_ASK_ID);
  if (g.benefit && !all.some((a) => a.kind === 'benefit')) {
    all.push({ id: 'benefit', kind: 'benefit', text: '문안에 들어갈 혜택을 알려 주세요', why: '한 줄에 할인 · 쿠폰 같은 혜택 값이 없어요. 없으면 지어내지 않아요', options: [], source: 'rule' });
  }
  if (g.period && !all.some((a) => a.kind === 'period')) {
    all.push({ id: 'period', kind: 'period', text: '혜택은 언제까지인가요?', why: '문안에 「언제까지」가 들어가야 혜택이 분명해져요', options: [], source: 'rule' });
  }
  // ★ 2026-10-29 목소리 꼴 칸(voice-form-slots · 규칙) = 혜택 · 기간 다음 · AI 의 그 밖 질문 앞(상한에 밀려 빠지지 않게)
  const order: AiLineAskKind[] = ['benefit', 'period', 'text'];
  const ordered = order.flatMap((k) => all.filter((a) => a.kind === k));
  const head = ordered.filter((a) => a.kind !== 'text');
  const tail = ordered.filter((a) => a.kind === 'text');
  const prefill = lineLink ? { prefill: lineLink } : {};
  const voice = voiceAsks.map((a) => (a.id === 'voice_link' ? { ...a, ...prefill } : a));
  const link: AiLineAsk[] = !voice.some((a) => a.id === 'voice_link') && (aiLinkAsked || lineLink)
    ? [{ id: LINE_LINK_ASK.id, kind: 'text', text: LINE_LINK_ASK.label, why: LINE_LINK_ASK.help, options: [], source: 'rule', ...prefill }]
    : [];
  return [...head, ...voice, ...link, ...tail].slice(0, AI_LINE_ASKS_MAX);
}

/** ★ 2026-10-29 (순수) 목소리 꼴 칸 질문 → AI 한줄로 묻는 목록 꼴(글 = 서버 상수 · 답 식별 키) */
export function voiceLineAsks(asks: readonly VoiceFormSlot[]): AiLineAsk[] {
  return asks.map((s) => ({ id: `voice_${s}`, kind: 'text' as const, text: VOICE_FORM_ASK[s].label, why: VOICE_FORM_ASK[s].help, options: [], source: 'rule' as const }));
}

/**
 * ★ 2026-10-29 (순수) 답 목록을 꼴 칸 답과 그 밖 답으로 가른다(꼴 칸 답 = 서버가 다시 계산한 질문의 글과 같은 q 만)
 * ★ 2026-10-31 lineLink = LINE_LINK_ASK 답(근거 글 · 참고 글에 싣지 않는다 · P1)
 */
export function splitVoiceLineAnswers(answers: readonly AiLineAnswer[], asks: readonly VoiceFormSlot[]): {
  voice: Partial<Record<VoiceFormSlot, string>>; lineLink?: string; others: AiLineAnswer[];
} {
  const voice: Partial<Record<VoiceFormSlot, string>> = {};
  let lineLink: string | undefined;
  const others: AiLineAnswer[] = [];
  // ★ Codex 구현 1R — 식별 = 서버 상수 글 셋 전부(그 사이 회사 값이 생겨 질문에서 빠진 칸의 답도 꼴 칸 답 · 근거 글로 새지 않는다)
  for (const a of answers) {
    const s = (Object.keys(VOICE_FORM_ASK) as VoiceFormSlot[]).find((x) => VOICE_FORM_ASK[x].label === a.q);
    if (s) voice[s] = a.a;
    else if (a.q === LINE_LINK_ASK.label) lineLink = a.a;
    else if (a.a) others.push(a);
  }
  void asks;
  return { voice, ...(lineLink ? { lineLink } : {}), others };
}

/**
 * ★ 2026-10-31 (순수) 정해진 링크의 주소 글자를 이번 문자 링크 토큰으로(P1 · 근거 글 · 참고 글 · 한 줄) — AI 가 주소를 옮겨 쓰다 틀리거나 두 번 쓰지 않게.
 *   바꾸는 자리 = 글 속 링크 구간(linkSpans · 덩어리 먼저) 하나가 통째로 url · raw 와 글자 그대로 같을 때만(부분 문자열 0 · 다른 링크 안쪽 0).
 *   (Codex 구현 1R ③ · 2R · 3R · 1031 ② 주소 경계 부류 → 링크 구간 읽기 한 곳 · 결과의 링크는 출구 ensureOnceLink 가 보장).
 */
export function withLinkToken(text: string, link: { raw: string; url: string } | null): string {
  const src = String(text ?? '');
  if (!link) return src;
  const token = `{{LINK:${ONCE_LINK_LABEL}}}`;
  let out = '';
  let at = 0;
  for (const sp of linkSpans(src)) {
    if (sp.link !== link.url && sp.link !== link.raw) continue;
    out += src.slice(at, sp.start) + token;
    at = sp.end;
  }
  return out + src.slice(at);
}

export interface AiLineAnswer { q: string; a: string }
/** (순수) 만들기 요청의 그 밖 질문 답(질문 · 답) — 모양이 틀리면 invalid · 빈 답은 버린다(묻고 답하지 않은 사실은 쓰지 않는다) */
export function readLineAnswers(raw: unknown): AiLineAnswer[] | 'invalid' {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > AI_LINE_ASKS_MAX) return 'invalid';
  const out: AiLineAnswer[] = [];
  const voiceLabels = new Set(Object.values(VOICE_FORM_ASK).map((v) => v.label));
  for (const x of raw) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return 'invalid';
    const q = tidyAsk((x as any).q, 80);
    const a = tidyAsk((x as any).a, LINK_MAX);   // ★ 2026-10-31 200 → LINK_MAX(긴 주소가 잘려 근거로 가지 않게 · P5)
    if (!q) return 'invalid';
    // ★ 2026-10-29 목소리 꼴 칸 답 = 빈 답도 남긴다(「이 줄 없이」 = 명시 생략 · Codex 구현 1R)
    if (a || voiceLabels.has(q)) out.push({ q, a });
  }
  return out;
}
/**
 * (순수) 혜택 근거 글(licenseText)에 붙일 「확인한 사실」 = **사람이 적은 답만**(답이 없으면 빈 글).
 * ★ Codex 1020 R1 high — 질문 글은 AI 가 썼다. 근거에 넣으면 질문 속 혜택이 「사람이 확인한 혜택」이 된다(혜택 날조 검사의 근거가 오염).
 */
export function lineAnswersLicense(answers: readonly AiLineAnswer[]): string {
  return answers.length > 0 ? `\n[확인한 사실]\n${answers.map((x) => `- ${x.a}`).join('\n')}` : '';
}
/** (순수) 생성기 참고 글 = 질문과 답(어떤 질문의 답인지 알려 주는 글 · 혜택 근거가 아니다) */
export function lineAnswersContext(answers: readonly AiLineAnswer[]): string {
  return answers.length > 0
    ? `[담당자에게 확인한 질문과 답: 답만 사실로 쓰고, 질문에만 있는 내용은 쓰지 않는다]\n${answers.map((x) => `- ${x.q} → ${x.a}`).join('\n')}`
    : '';
}

// ─────────────── 고른 칼럼 · 문자 성격 ───────────────

/** (순수) 고른 칼럼 중 본문에 %칼럼% 으로 들어가지 않은 것 */
export function missingLineVars(body: string, vars: readonly string[]): string[] {
  const b = String(body || '');
  return vars.filter((v) => !b.includes(`%${v}%`));
}

export type AiLineVoiceKind = 'marketing' | 'notice';
/** (순수) 문자 성격 = 광고 여부 하나(광고 표기 · 080 과 같은 값 · 새 판정 축을 만들지 않는다) */
export function lineVoiceKind(isAd: boolean): AiLineVoiceKind {
  return isAd ? 'marketing' : 'notice';
}

/** (순수) 한 줄이 「전체 고객」을 말했는가(「전체 고객」 · 「모든 회원」 · 「고객 전체」) — 말했으면 「누구에게」를 다시 묻지 않는다 */
export function lineMentionsAllCustomers(line: string): boolean {
  const t = String(line || '').replace(/\s+/g, '');
  return /(전체|모든|모두|전부)(고객|회원)|(고객|회원)(전체|모두|전부)/.test(t);
}

// ─────────────── 문안 종류 ───────────────

export type AiLineCopyType = 'emo' | 'benefit' | 'mz';
export type AiLineType = 'direct' | AiLineCopyType;
export const AI_LINE_COPY_TYPES: readonly AiLineCopyType[] = ['emo', 'benefit', 'mz'];
/** 문안 생성기 변형 id(A 감성형 · B 혜택강조형 · C MZ 감성형 — generateMessages 계약) ↔ 종류 */
export const AI_LINE_TYPE_BY_VARIANT: Readonly<Record<string, AiLineCopyType>> = { A: 'emo', B: 'benefit', C: 'mz' };
export const AI_LINE_TYPE_LABEL: Readonly<Record<AiLineType, string>> = { direct: '직접입력', emo: '감성형', benefit: '혜택강조형', mz: 'MZ 감성형' };

/** (순수) 대상 AI 의 추천 종류 글 → 종류 id(모르면 null) */
export function styleToType(style: unknown): AiLineCopyType | null {
  const s = String(style || '').replace(/\s+/g, '').toLowerCase();
  if (!s) return null;
  // ★ 2026-10-28 K3-6 — 지시문이 키(emo · benefit · mz)를 낸다 · 옛 이름 글자도 아래가 계속 읽는다
  if (s === 'emo' || s === 'benefit' || s === 'mz') return s;
  if (s.includes('혜택')) return 'benefit';
  if (s.includes('mz')) return 'mz';
  if (s.includes('감성')) return 'emo';
  return null;
}

/** (순수) 요청 본문의 종류 목록 — 문안 종류만(직접입력은 생성하지 않는다) · 중복 0 · 1~3개 */
export function sanitizeLineTypes(raw: unknown): AiLineCopyType[] | 'invalid' {
  if (!Array.isArray(raw)) return 'invalid';
  const out: AiLineCopyType[] = [];
  for (const v of raw) {
    if (!AI_LINE_COPY_TYPES.includes(v as AiLineCopyType)) return 'invalid';
    if (!out.includes(v as AiLineCopyType)) out.push(v as AiLineCopyType);
  }
  return out.length >= 1 && out.length <= AI_LINE_COPY_TYPES.length ? out : 'invalid';
}

// ─────────────── 조건 출처 · 칩 글 ───────────────

const normForQuote = (s: string) => String(s || '').toLowerCase().replace(/[\s·,.!?~"'()[\]「」]/g, '');

/** (순수) AI 가 적은 근거 조각이 한 줄에 실제로 있는가(공백 · 문장부호 무시 · 2글자 이상) */
export function quoteInLine(line: string, quote: unknown): boolean {
  const q = normForQuote(String(quote || ''));
  return q.length >= 2 && normForQuote(line).includes(q);
}

const condValue = (cond: unknown): unknown =>
  cond !== null && typeof cond === 'object' && !Array.isArray(cond) && 'value' in (cond as object) ? (cond as any).value : cond;
const condOp = (cond: unknown): string =>
  cond !== null && typeof cond === 'object' && !Array.isArray(cond) && typeof (cond as any).operator === 'string' ? (cond as any).operator : 'eq';
const fmtNum = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v));

/** (순수) 조건 하나 → 칩 글(「서울」 · 「30대」 · 「여성」 · 「고객등급 VIP」). 화면 칩과 문안 대상 문장이 같은 글을 쓴다. */
export function filterChipText(key: string, cond: unknown, label: string): string {
  const v = condValue(cond);
  const op = condOp(cond);
  const L = label || key;
  if (key === 'gender') {
    const g = String(v || '').toUpperCase();
    return g === 'M' || g === '남' || g === '남성' ? '남성' : g === 'F' || g === '여' || g === '여성' ? '여성' : `${L} ${String(v)}`;
  }
  if (key === 'minAge' || key === 'min_age') return `${fmtNum(v)}세 이상`;
  if (key === 'maxAge' || key === 'max_age') return `${fmtNum(v)}세 이하`;
  if (op === 'between' && Array.isArray(v) && v.length === 2) {
    const [a, b] = v.map(Number);
    if (key === 'age' && Number.isFinite(a) && a % 10 === 0 && b === a + 9) return `${a}대`;
    return `${L} ${fmtNum(v[0])}~${fmtNum(v[1])}`;
  }
  if (op === 'gte') return `${L} ${fmtNum(v)} 이상`;
  if (op === 'lte') return `${L} ${fmtNum(v)} 이하`;
  if (op === 'in' && Array.isArray(v)) return key === 'region' ? v.join('·') : `${L} ${v.join('·')}`;
  if (op === 'birth_month') return `${fmtNum(v)}월 생일`;
  if (op === 'date_gte') return `${L} ${String(v)} 이후`;
  if (op === 'date_lte') return `${L} ${String(v)} 이전`;
  if (op === 'days_within') return `${L} ${fmtNum(v)}일 안`;
  if (key === 'region' || key === 'address') return String(v);
  if (op === 'contains') return `${L} 「${String(v)}」 포함`;
  return `${L} ${String(v)}`;
}

// ─────────────── 원장 키 · 금액 ───────────────

export const AI_LINE_SOURCE = {
  intake: 'ai-line-intake',
  compose: 'ai-line-compose',
  decorate: 'ai-line-decorate',
} as const;

/** 한 줄 지문 12자(공백 정리 후 · 1017 한 줄 완성과 같은 함수) */
export function aiLineLineFp(line: string): string {
  return lineFingerprint(line);
}

/** 기본(대상 찾기) 키 — 회사 · KST 날짜 · 한 줄 지문(최대 9+36+1+8+1+12 = 67자) */
export function aiLineBaseKey(companyId: string, line: string, at: Date): string {
  return aiLineBaseKeyOfFp(companyId, aiLineLineFp(line), at);
}

/**
 * ★ 2026-10-22 한줄 CT 판단 키 = 지문으로 바로(설계서 docs/2026-10-22-oneline-ct-design.md §11-3).
 *   모바일DM · 이메일 · 인앱의 판단(2)과 AI 한줄로 대상 찾기(2)가 같은 키 = 같은 한 줄은 입구가 달라도 판단 한 번.
 */
export function aiLineBaseKeyOfFp(companyId: string, fp: string, at: Date): string {
  return `aio-base:${companyId}:${kstDateTag(at)}:${fp}`;
}

/** 지문 기준 오늘 · 어제 판단 키 */
export function aiLineBaseKeysOfFp(companyId: string, fp: string, now: Date): string[] {
  const today = aiLineBaseKeyOfFp(companyId, fp, now);
  const yesterday = aiLineBaseKeyOfFp(companyId, fp, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return today === yesterday ? [today] : [today, yesterday];
}

/** 기본을 이미 냈는지 볼 키 — 오늘 · 어제(자정 경계 · 23:59 대상 찾기 → 00:01 만들기 = 다시 걷지 않는다) */
export function aiLineBaseKeys(companyId: string, line: string, now: Date): string[] {
  const today = aiLineBaseKey(companyId, line, now);
  const yesterday = aiLineBaseKey(companyId, line, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return today === yesterday ? [today] : [today, yesterday];
}

/** 입력 지문 16자 — 요청 본문 전체를 결박한다(같은 시도 토큰으로 내용을 바꾸면 새 키) */
export function aiLineInputFp(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex').slice(0, 16);
}

/** 문안 키(최대 9+36+1+64+1+16 = 127자 · varchar(150) 안) */
export function aiLineCopyKey(companyId: string, attemptToken: string, payload: unknown): string {
  return `aio-copy:${companyId}:${attemptToken}:${aiLineInputFp(payload)}`;
}

/** 꾸미기 키 */
export function aiLineDecoKey(companyId: string, attemptToken: string, payload: unknown): string {
  return `aio-deco:${companyId}:${attemptToken}:${aiLineInputFp(payload)}`;
}

/** (순수) 만들기 금액 = 기본(아직 안 냈으면) + 종류마다 문안 단가 */
export function aiLineComposeCost(copyCount: number, basePaid: boolean): { base: number; copies: number; total: number } {
  const base = basePaid ? 0 : getCreditCost(AI_LINE_SOURCE.intake);
  const copies = Math.max(0, Math.floor(copyCount)) * getCreditCost(AI_LINE_SOURCE.compose);
  return { base, copies, total: base + copies };
}

/** 한 번에 보낼 수 있는 대상 상한 = 승인 발송 명단 상한(같은 값 하나) */
export const AI_LINE_MAX_AUDIENCE = SENDABLE_RECIPIENTS_LIMIT;

// ─────────────── 칼럼 · 1위 고객 ───────────────

/** 문안 변수로 쓰지 않는 칼럼(연락처 · 동의 · 주소 · 내부 코드 · 성별) — FIELD_MAP fieldKey */
export const AI_LINE_COLUMN_EXCLUDE: ReadonlySet<string> = new Set([
  'phone', 'sms_opt_in', 'email', 'address', 'store_code', 'store_phone', 'registration_type', 'gender',
]);
/** 이 대상 안 채움 비율이 이보다 낮으면 잠금(회사 프로필의 차단 기준과 같은 30) */
export const AI_LINE_FILL_LOCK = 30;

/** (순수) 이름 가리기 — 1자 = *, 2자 = 김*, 3자+ = 김*지(가운데 전부) */
export function maskName(name: unknown): string {
  const s = String(name ?? '').trim();
  if (!s) return '';
  const chars = Array.from(s);
  if (chars.length === 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}
