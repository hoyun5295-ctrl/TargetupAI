/**
 * email-analytics-calc.ts — 분석 대시보드 순수 계산 (DB import 0, TDD 대상)
 *
 * 비율·증감만 담당한다. 집계 SQL은 routes/email.ts, 표시는 EmailAnalyticsModal이 맡는다.
 */

/** 비율 % — 분모 0 이하면 0. 소수 1자리 반올림. */
export function rate(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** 상대 증감 % — 이전 값 0 이하면 null(비교 불가). 소수 1자리. */
export function relativeDelta(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** 포인트 증감(pp) — 오픈율 같은 비율 지표 비교용. 소수 1자리. */
export function pointDelta(currentPct: number, previousPct: number): number {
  return Math.round((currentPct - previousPct) * 10) / 10;
}
