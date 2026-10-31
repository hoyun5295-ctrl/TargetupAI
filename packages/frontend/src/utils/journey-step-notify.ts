/**
 * 여정 칸 담당자 알림 켜짐 판정(★ 2026-10-31 · 설계서 docs/2026-10-31-journey-step-gate-notice-design.md §2-5).
 * 서버 packages/backend/src/utils/journey-step-notify.ts 의 isStepNotifyOn 과 같은 함수다(대조 시험 = backend journey-step-gate-1031.test.ts).
 * true = 늘 켬 · false = 늘 끔 · null = 기본(첫 메시지 칸 · 마지막 메시지 칸만 켬).
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
