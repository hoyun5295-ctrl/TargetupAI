/**
 * sns-spell-check.ts — SNS 글 맞춤법 검사 (2026-09-24 B-7)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §4 B-7.
 *
 * ★ 2026-09-25 판정·AI 호출은 채널 중립 엔진 `spell-check.ts`로 옮겼다(대행발송·직접발송 문자 검사와 공용).
 *   이 파일은 SNS 보호 구간(링크·금액·%·#태그·@계정·회사명·자주 쓰는 태그)과 SNS 지시문만 얹는다.
 *   SNS 응답·동작은 옮기기 전과 같다(기존 계약 테스트가 기준).
 * ⛔ 사용자 글을 이 함수가 바꾸지 않는다. 고치기는 화면에서 사용자가 누를 때만.
 */

import {
  judgeSpellCandidates, protectedWordSpans, runSpellCheck, spellTextHash,
  SPELL_MAX_CHANGE, SPELL_MAX_ISSUES,
  type SpellCandidate, type SpellIssue, type SpellKind,
} from './spell-check';
import { findBenefitSpans } from './copy-benefit-detector';
import { findBodyHashtagSpans, findSnsLinkSpans, type SnsTextSpan } from './sns-caption-rules';

export type SnsSpellKind = SpellKind;
export type SnsSpellIssue = SpellIssue;
export type SnsSpellCandidate = SpellCandidate;

/** 한 번에 돌려주는 최대 건수 */
export const SNS_SPELL_MAX_ISSUES = SPELL_MAX_ISSUES;
/** 변경 구간 최대 길이(코드포인트) */
export const SNS_SPELL_MAX_CHANGE = SPELL_MAX_CHANGE;

/** 글 해시 — 화면이 "이 결과가 지금 글의 것인가"를 대조한다. */
export function snsBodyHash(body: string): string {
  return spellTextHash(body);
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
  spans.push(...protectedWordSpans(body, words));
  return spans;
}

/**
 * 모델 후보 → 판정된 검사 결과(순수). 위치는 원문 기준.
 * @param words 보호 낱말(회사명·브랜드명·자주 쓰는 태그)
 */
export function judgeSnsSpellCandidates(body: string, candidates: readonly SnsSpellCandidate[], words: readonly string[] = []): SnsSpellIssue[] {
  const src = String(body ?? '');
  return judgeSpellCandidates(src, candidates, snsSpellProtectedSpans(src, words));
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
  const r = await runSpellCheck({
    companyId: input.companyId,
    userId: input.userId,
    text: body,
    system: SYSTEM,
    userMessage: `검사할 글:\n${body}`,
    source: 'sns-typo-check',
    protectedSpans: snsSpellProtectedSpans(body, input.protectedWords),
  });
  return { bodyHash: r.textHash, issues: r.issues, failed: r.failed };
}
