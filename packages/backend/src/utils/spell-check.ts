/**
 * spell-check.ts — 채널 중립 맞춤법 검사 엔진 (2026-09-25 공용화)
 * 설계 SoT = docs/2026-09-25-agency-spell-check-design.md §3-1 · 원본 = SNS B-7(docs/2026-09-24-sns-channel-design.md §4).
 *
 * 채널 층(SNS `sns-spell-check.ts` · 문자 `sms-spell-check.ts`)이 넘기는 것 = 보호 구간 · 시스템 지시 · source.
 * 판정 규칙은 여기 하나다. 채널마다 따로 두면 "어떤 후보를 버리는가"가 두 벌이 된다.
 *
 * 엔진 = 자사 AI 경로(결정성 약속 0). **모델은 후보만 낸다. 위치·판정은 서버가 한다.**
 *   ① 모델이 준 before 가 원문에 **정확히 한 번** 있을 때만 쓴다(두 번 이상이면 어느 자리인지 모른다)
 *   ② before·after 의 공통 앞뒤를 잘라 **최소 변경 구간**을 구하고 모든 판정은 그 구간으로 한다
 *   ③ 버림 = 보호 구간을 건드림 · after 에 새 숫자·링크·혜택 ·
 *      띄어쓰기라면서 공백 밖 글자가 다름(→ 오타로 다시 분류) · 오타 편집 거리 > max(2, 30%) · 같음 ·
 *      변경 20자 초과(코드포인트) · 앞 항목과 겹침 · 20개 초과
 *   ④ 보여 주고 고치는 구간 = 최소 변경 구간을 낱말 경계(공백)까지 넓힌 것
 * ⛔ 사용자 글을 이 함수가 바꾸지 않는다. 고치기는 화면에서 사용자가 누를 때만.
 */

import { createHash } from 'crypto';
import { callAIWithFallback } from '../services/ai';
import { extractJsonFromAiText } from './ai-json';
import { findBenefitSpans } from './copy-benefit-detector';
import { findSnsLinkSpans } from './sns-caption-rules';

export type SpellKind = 'typo' | 'spacing';

export interface SpellTextSpan {
  start: number;
  end: number;
  text: string;
}

export interface SpellIssue {
  id: string;
  /** 원문 기준 위치(UTF-16 · textarea setSelectionRange 와 같은 단위) */
  start: number;
  end: number;
  before: string;
  after: string;
  kind: SpellKind;
  reason: string;
  /** 채널 규칙으로 [고치기]를 잠근 이유. 문자 단문 90바이트 초과 = 'sms_bytes' */
  blocked?: 'sms_bytes';
}

export interface SpellCandidate {
  before: unknown;
  after: unknown;
  reason?: unknown;
}

/** 한 번에 돌려주는 최대 건수 */
export const SPELL_MAX_ISSUES = 20;
/** 변경 구간 최대 길이(코드포인트) */
export const SPELL_MAX_CHANGE = 20;

/** 글 해시 — 화면이 "이 결과가 지금 글의 것인가"를 대조한다. */
export function spellTextHash(text: string): string {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16);
}

function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = text.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = text.indexOf(needle, i + 1);
  }
  return n;
}

export function escapeSpellRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 보호 낱말(회사명·브랜드명 등 2자 이상)이 원문에 나오는 자리 전부. */
export function protectedWordSpans(text: string, words: readonly string[]): SpellTextSpan[] {
  const spans: SpellTextSpan[] = [];
  for (const w of words) {
    const word = String(w ?? '').trim();
    if ([...word].length < 2) continue;
    for (const m of text.matchAll(new RegExp(escapeSpellRe(word), 'gi'))) {
      if (m.index != null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  return spans;
}

function digitsOf(s: string): string[] {
  return (s.match(/\d+/g) ?? []).sort();
}

/**
 * 모델 후보 → 판정된 검사 결과(순수). 위치는 원문 기준.
 * @param protectedSpans 채널 층이 구한 보호 구간(원문 기준)
 */
export function judgeSpellCandidates(
  text: string,
  candidates: readonly SpellCandidate[],
  protectedSpans: readonly SpellTextSpan[],
): SpellIssue[] {
  const src = String(text ?? '');
  const out: SpellIssue[] = [];

  for (const c of candidates) {
    if (out.length >= SPELL_MAX_ISSUES) break;
    const fullBefore = String(c?.before ?? '');
    const fullAfter = String(c?.after ?? '');
    if (!fullBefore || fullBefore === fullAfter) continue;
    // ① 원문에 정확히 한 번
    if (countOccurrences(src, fullBefore) !== 1) continue;
    const spanStart = src.indexOf(fullBefore);
    const spanEnd = spanStart + fullBefore.length;

    // ② 최소 변경 구간(공통 앞뒤 자르기)
    let p = 0;
    while (p < fullBefore.length && p < fullAfter.length && fullBefore[p] === fullAfter[p]) p += 1;
    let q = 0;
    while (
      q < fullBefore.length - p && q < fullAfter.length - p
      && fullBefore[fullBefore.length - 1 - q] === fullAfter[fullAfter.length - 1 - q]
    ) q += 1;
    const minBefore = fullBefore.slice(p, fullBefore.length - q);
    const minAfter = fullAfter.slice(p, fullAfter.length - q);
    if (minBefore === minAfter) continue;
    const minStart = spanStart + p;
    const minEnd = minStart + minBefore.length;
    if (Math.max([...minBefore].length, [...minAfter].length) > SPELL_MAX_CHANGE) continue;

    // ③ 보호 구간(끼워 넣기는 구간 안쪽이면 건드린 것)
    const touches = protectedSpans.some((s) => (minStart === minEnd
      ? minStart > s.start && minStart < s.end
      : minStart < s.end && minEnd > s.start));
    if (touches) continue;

    // ④ 낱말 경계까지 넓힌다(모델이 준 구간 안에서)
    let s = minStart;
    while (s > spanStart && !/\s/.test(src[s - 1])) s -= 1;
    let e = minEnd;
    while (e < spanEnd && !/\s/.test(src[e])) e += 1;
    const before = src.slice(s, e);
    const after = src.slice(s, minStart) + minAfter + src.slice(minEnd, e);
    if (before === after) continue;

    // 분류 — 공백만 다르면 띄어쓰기, 아니면 오타
    const kind: SpellKind = before.replace(/\s+/g, '') === after.replace(/\s+/g, '') ? 'spacing' : 'typo';
    if (kind === 'typo') {
      const limit = Math.max(2, Math.ceil([...before].length * 0.3));
      if (levenshtein(minBefore, minAfter) > limit) continue;
      // 새 숫자·링크·혜택
      if (digitsOf(after).join(',') !== digitsOf(before).join(',')) continue;
      if (findSnsLinkSpans(after).length > findSnsLinkSpans(before).length) continue;
      const had = new Set(findBenefitSpans(before).map((b) => b.text.replace(/\s+/g, '')));
      if (findBenefitSpans(after).some((b) => !had.has(b.text.replace(/\s+/g, '')))) continue;
    }

    // ⑤ 앞 항목과 겹침
    if (out.some((o) => s < o.end && e > o.start)) continue;

    out.push({
      id: `${s}-${e}`,
      start: s,
      end: e,
      before,
      after,
      kind,
      reason: String(c?.reason ?? '').trim().slice(0, 80) || (kind === 'spacing' ? '띄어쓰기' : '맞춤법'),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 고친 글(순수) — 한 항목을 원문 자리에 넣는다. 화면의 [고치기]와 같은 계산(바이트 판정용). */
export function applySpellIssue(text: string, issue: Pick<SpellIssue, 'start' | 'end' | 'before' | 'after'>): string {
  const src = String(text ?? '');
  if (src.slice(issue.start, issue.end) !== issue.before) return src;
  return src.slice(0, issue.start) + issue.after + src.slice(issue.end);
}

/**
 * 검사 실행 — AI 후보 → 판정.
 * 월 AI 호출 한도 면제 여부는 `source`로 정해진다(CT-55 `AI_CALL_LIMIT_EXEMPT_SOURCES` · 문자 맞춤법만 · SNS 는 한도 적용).
 */
export async function runSpellCheck(input: {
  companyId: string;
  userId?: string | null;
  text: string;
  system: string;
  userMessage: string;
  source: string;
  protectedSpans: readonly SpellTextSpan[];
}): Promise<{ textHash: string; issues: SpellIssue[]; failed: boolean }> {
  const text = String(input.text ?? '');
  const textHash = spellTextHash(text);
  if (!text.trim()) return { textHash, issues: [], failed: false };

  const raw = await callAIWithFallback({
    system: input.system,
    userMessage: input.userMessage,
    maxTokens: 1500,
    temperature: 0,
    companyId: input.companyId,
    userId: input.userId ?? undefined,
    source: input.source,
  });

  // ⛔ 답을 읽지 못한 것을 '고칠 곳 없음'으로 보이지 않는다(가짜 성공 0).
  let parsed: { issues?: unknown };
  try {
    parsed = extractJsonFromAiText(String(raw));
  } catch {
    return { textHash, issues: [], failed: true };
  }
  const candidates = Array.isArray(parsed.issues) ? (parsed.issues as SpellCandidate[]) : [];
  return { textHash, issues: judgeSpellCandidates(text, candidates, input.protectedSpans), failed: false };
}
