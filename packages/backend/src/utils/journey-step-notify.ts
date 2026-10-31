/**
 * 여정 칸 담당자 알림(보내기 전 안내 · 보낸 결과) 켜짐 판정 CT (★ 2026-10-31 · 설계서 docs/2026-10-31-journey-step-gate-notice-design.md §2-5 · 뿌리 R30 · R1)
 *
 * true = 늘 켬 · false = 늘 끔 · null = 기본(첫 메시지 칸 · 마지막 메시지 칸만 켬). 메시지 칸 = step_type 이 비었거나 'message'(채널 무관).
 * 옛: 판정이 세 벌이었다 — 2시간 전 안내 = 「step_order 1 또는 모든 칸 수」 · 결과 안내 · 화면 = 「step_order 1 또는 메시지 칸 수」.
 *   기다림 칸이 앞에 있으면(1 기다림 · 2 문자 · 3 문자) 같은 토글이 두 안내에서 다르게 움직였다.
 * 화면 = frontend/src/utils/journey-step-notify.ts (같은 함수 · 대조 시험 journey-step-gate-1031.test.ts).
 */

export function isStepNotifyOn(
  flag: boolean | null | undefined,
  stepOrder: number,
  firstMessageOrder: number | null | undefined,
  lastMessageOrder: number | null | undefined,
): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  const o = Number(stepOrder);
  return (firstMessageOrder != null && o === Number(firstMessageOrder))
    || (lastMessageOrder != null && o === Number(lastMessageOrder));
}

/** 그 여정의 메시지 칸 첫 · 끝 번호 SQL 식(journeyExpr = 여정 id 식 · 결과 칸 이름은 부르는 쪽이 붙인다). */
export function messageStepBoundsSql(journeyExpr: string): { first: string; last: string } {
  const from = `FROM journey_steps ms WHERE ms.journey_id = ${journeyExpr} AND COALESCE(ms.step_type, 'message') = 'message'`;
  return { first: `(SELECT MIN(ms.step_order) ${from})`, last: `(SELECT MAX(ms.step_order) ${from})` };
}
