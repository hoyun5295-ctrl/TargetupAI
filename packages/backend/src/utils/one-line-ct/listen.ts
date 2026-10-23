/**
 * one-line-ct/listen.ts — ① 듣기(설계서 docs/2026-10-23-oneline-ct-complete-design.md A4)
 *
 * 한 줄 → 의도 하나. 입구(판정 gaps · 판단 대체 · 재료 판 · 반복 발송 점검 · 플래너 읽기 · 시연)는 이것만 부른다(같은 한 줄 = 같은 의도).
 * 규칙만(AI 0 · DB 0 · 시각 = nowMs). 규칙 자체(혜택 · 기간 · 상품 낱말 · 주소 · 구성 순위)는 원래 함수가 소유하고 여기는 모아 부른다.
 * ⛔ 사진에서 읽은 글 조각: 혜택 판정은 조각의 숫자를 지운 글(`applyLineReads` 면허 없음) · 제안 · 기간 · 주소 = 사람이 친 글만 · 상품 낱말 = 한 줄 전체.
 */
import { applyLineReads, hasConcreteBenefit, lineBenefitPrefill, lineProductTerms, lineWithoutReads, oneLineGaps, type OneLineGaps } from '../one-line-facts';
import { lineUrls, linePeriodMentioned, lineEndDatePrefill } from '../one-line-steps';
import { rankCompositions, type LineCompositionId } from '../line-compositions';

export interface LineIntent {
  /** 사람이 친 글(사진 조각 제외) */
  typed: string;
  /** 혜택 판정 글(사진 조각의 숫자를 지운 한 줄) */
  judged: string;
  /** 구체 혜택 값이 있는가 */
  concreteBenefit: boolean;
  /** 혜택 제안 칩(허용 꼴이 딱 하나일 때 · 사람이 눌러야 답) */
  benefit: string | null;
  /** 묻기(행사인데 혜택 값 없음) */
  gaps: OneLineGaps;
  periodMentioned: boolean;
  /** 마감 제안 칩(YYYY-MM-DD · 사람이 눌러야 답) */
  periodEnd: string | null;
  /** 한 번 만들면 계속 나가는 입구(여정 · 자동마케팅)에서 지나가는 날짜 말(최대 3) */
  passingDates: string[];
  productTerms: string[];
  urls: string[];
  /** 구성 추천(낱말 2 + 업종 1 · 판정 화면 · 판단 대체가 같은 순위) */
  rank: Array<{ id: LineCompositionId; score: number; recommended: boolean }>;
}

/** 지나가는 날짜 말 — 날짜 꼴 · 이번/다음 주 · 달 · 월말 · N일간 · 오늘만 · 단 하루 · 오늘/내일까지 */
const PASSING_DATE_RE = /(?<!\d)\d{4}\s*(?:[.\-/]|년)\s*\d{1,2}\s*(?:[.\-/]|월)\s*\d{1,2}(?!\d)|(?<!\d)\d{1,2}\s*월\s*\d{1,2}\s*일|이번\s*주\s*말|이번\s*주말|이번\s*주|다음\s*주|이번\s*달|다음\s*달|월말|금주|(?<!\d)\d{1,2}\s*일\s*(?:간|동안)|오늘만|오늘\s*까지|내일\s*까지|단\s*하루|당일\s*한정/g;

/** (순수) 한 줄 → 의도 */
export function listenLine(line: string, opts: { reads?: readonly string[]; industry?: string | null; nowMs?: number } = {}): LineIntent {
  const raw = String(line || '');
  const nowMs = opts.nowMs ?? Date.now();
  // 사진 조각뿐이면 친 글 = 빈 글(조각의 혜택 · 날짜를 제안으로 올리지 않는다 · H3)
  const typed = lineWithoutReads(raw, opts.reads);
  const judged = applyLineReads(raw, opts.reads, false);
  const concreteBenefit = hasConcreteBenefit(judged);
  const passing: string[] = [];
  for (const m of typed.matchAll(PASSING_DATE_RE)) {
    const w = m[0].replace(/\s+/g, ' ').trim();
    if (!passing.includes(w)) passing.push(w);
  }
  return {
    typed,
    judged,
    concreteBenefit,
    benefit: concreteBenefit ? lineBenefitPrefill(typed) : null,
    gaps: oneLineGaps(judged),
    periodMentioned: linePeriodMentioned(typed),
    periodEnd: lineEndDatePrefill(typed, nowMs),
    passingDates: passing.slice(0, 3),
    productTerms: lineProductTerms(raw),
    urls: lineUrls(typed),
    rank: rankCompositions(typed, opts.industry ?? null),
  };
}
