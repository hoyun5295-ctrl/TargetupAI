/**
 * ★ CDP 이벤트 occurred_at 클램프 — 순수(DB import 0). 2026-06-25 (gap 5)
 *   자사몰 전송 시각을 그대로 신뢰하면 미래/이상치가 커서·통계를 왜곡. 미래만 보정(과거는 마이그레이션 정상).
 *   - 파싱 실패/미전달 → now
 *   - now + 5분 초과(미래) → now (시계 오차 5분 허용)
 *   - 그 외(과거·근접) → 그대로
 */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function clampOccurredAt(raw: string | Date | undefined | null, now: Date): Date {
  let d: Date;
  if (raw === undefined || raw === null) {
    d = now;
  } else if (raw instanceof Date) {
    d = raw;
  } else {
    d = new Date(raw);
  }
  if (isNaN(d.getTime())) return now;
  if (d.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return now;
  return d;
}
