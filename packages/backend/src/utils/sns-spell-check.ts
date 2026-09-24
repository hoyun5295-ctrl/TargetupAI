/**
 * sns-spell-check.ts — SNS 글 맞춤법 검사 (2026-09-24 B-7)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §4 B-7.
 *
 * 엔진 = 자사 AI 경로(결정성 약속 0). **모델은 후보만 낸다. 위치·판정은 서버가 한다.**
 *   ① 모델이 준 before 가 원문에 **정확히 한 번** 있을 때만 쓴다(두 번 이상이면 어느 자리인지 모른다)
 *   ② before·after 의 공통 앞뒤를 잘라 **최소 변경 구간**을 구하고 모든 판정은 그 구간으로 한다
 *   ③ 버림 = 보호 구간(링크·금액·%·#태그·@계정·회사명·자주 쓰는 태그)을 건드림 · after 에 새 숫자·링크·혜택 ·
 *      띄어쓰기라면서 공백 밖 글자가 다름(→ 오타로 다시 분류) · 오타 편집 거리 > max(2, 30%) · 같음 ·
 *      변경 20자 초과(코드포인트) · 앞 항목과 겹침 · 20개 초과
 *   ④ 보여 주고 고치는 구간 = 최소 변경 구간을 낱말 경계(공백)까지 넓힌 것
 * ⛔ 사용자 글을 이 함수가 바꾸지 않는다. 고치기는 화면에서 사용자가 누를 때만.
 */

import { createHash } from 'crypto';
import { callAIWithFallback } from '../services/ai';
import { extractJsonFromAiText } from './ai-json';
import { findBenefitSpans } from './copy-benefit-detector';
import { findBodyHashtagSpans, findSnsLinkSpans, type SnsTextSpan } from './sns-caption-rules';

export type SnsSpellKind = 'typo' | 'spacing';

export interface SnsSpellIssue {
  id: string;
  /** 원문 기준 위치(UTF-16 · textarea setSelectionRange 와 같은 단위) */
  start: number;
  end: number;
  before: string;
  after: string;
  kind: SnsSpellKind;
  reason: string;
}

export interface SnsSpellCandidate {
  before: unknown;
  after: unknown;
  reason?: unknown;
}

/** 한 번에 돌려주는 최대 건수 */
export const SNS_SPELL_MAX_ISSUES = 20;
/** 변경 구간 최대 길이(코드포인트) */
export const SNS_SPELL_MAX_CHANGE = 20;

/** 글 해시 — 화면이 "이 결과가 지금 글의 것인가"를 대조한다. */
export function snsBodyHash(body: string): string {
  return createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex').slice(0, 16);
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 보호 구간 — 링크 · 혜택 덩어리(금액·%) · #태그 · @계정 · 회사명·브랜드명 · 자주 쓰는 태그 낱말. */
export function snsSpellProtectedSpans(body: string, words: readonly string[]): SnsTextSpan[] {
  const spans: SnsTextSpan[] = [
    ...findSnsLinkSpans(body),
    ...findBenefitSpans(body),
    ...findBodyHashtagSpans(body),
  ];
  for (const m of body.matchAll(/@[0-9A-Za-z._]+/g)) {
    if (m.index != null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  for (const w of words) {
    const word = String(w ?? '').trim();
    if ([...word].length < 2) continue;
    for (const m of body.matchAll(new RegExp(escapeRe(word), 'gi'))) {
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
 * @param words 보호 낱말(회사명·브랜드명·자주 쓰는 태그)
 */
export function judgeSnsSpellCandidates(body: string, candidates: readonly SnsSpellCandidate[], words: readonly string[] = []): SnsSpellIssue[] {
  const src = String(body ?? '');
  const protectedSpans = snsSpellProtectedSpans(src, words);
  const out: SnsSpellIssue[] = [];

  for (const c of candidates) {
    if (out.length >= SNS_SPELL_MAX_ISSUES) break;
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
    if (Math.max([...minBefore].length, [...minAfter].length) > SNS_SPELL_MAX_CHANGE) continue;

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
    const kind: SnsSpellKind = before.replace(/\s+/g, '') === after.replace(/\s+/g, '') ? 'spacing' : 'typo';
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

const SYSTEM = [
  '너는 한국어 맞춤법 검사기다. SNS 게시글에서 맞춤법·띄어쓰기·오타만 찾는다.',
  '규칙:',
  '- 문체·표현·어순·말투는 고치지 않는다. 틀린 곳만 찾는다.',
  '- before 는 원문에서 **그대로 복사한** 짧은 구간(틀린 낱말과 앞뒤 한두 낱말)이다. 원문에 한 번만 나오는 구간으로 잡는다.',
  '- after 는 before 를 바로잡은 것이다. 숫자·링크·가격·상호·해시태그·이모지는 건드리지 않는다.',
  '- 신조어·상품명·외래어 표기·SNS 말투(ㅎㅎ, ~요~)는 틀린 것으로 보지 않는다.',
  '- 틀린 곳이 없으면 빈 배열.',
  '출력 형식(JSON 하나만):',
  '{"issues":[{"before":"원문 구간","after":"고친 구간","reason":"한 줄 사유"}]}',
].join('\n');

/** 검사 실행. 회사 보호 낱말은 라우트가 넘긴다. */
export async function checkSnsSpelling(input: {
  companyId: string;
  userId?: string | null;
  body: string;
  protectedWords: string[];
}): Promise<{ bodyHash: string; issues: SnsSpellIssue[]; failed: boolean }> {
  const body = String(input.body ?? '');
  const bodyHash = snsBodyHash(body);
  if (!body.trim()) return { bodyHash, issues: [], failed: false };

  const raw = await callAIWithFallback({
    system: SYSTEM,
    userMessage: `검사할 글:\n${body}`,
    maxTokens: 1500,
    temperature: 0,
    companyId: input.companyId,
    userId: input.userId ?? undefined,
    source: 'sns-typo-check',
  });

  // ⛔ 답을 읽지 못한 것을 '고칠 곳 없음'으로 보이지 않는다(가짜 성공 0).
  let parsed: { issues?: unknown };
  try {
    parsed = extractJsonFromAiText(String(raw));
  } catch {
    return { bodyHash, issues: [], failed: true };
  }
  const candidates = Array.isArray(parsed.issues) ? (parsed.issues as SnsSpellCandidate[]) : [];
  return { bodyHash, issues: judgeSnsSpellCandidates(body, candidates, input.protectedWords), failed: false };
}
