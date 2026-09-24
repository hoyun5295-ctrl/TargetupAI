/**
 * sns-schedule.ts — SNS 예약 시각 판정 컨트롤타워 (2026-09-24)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §2 S3 · §6 E4.
 *
 * 저장(/posts)·게시(/publish · 구 화면 호환)·시각 바꾸기가 **이 함수 하나**로 예약 시각을 읽는다.
 *
 * ⛔ 왜 필요한가(0924 확인 결함 K5)
 *   화면은 `datetime-local` 원문(시간대 없음)을 보냈고 서버는 `new Date(원문)` 으로 **서버 프로세스 시간대**로 읽었다.
 *   또 지난 시각을 거르지 않아, 사용자는 예약했다고 믿는데 바로 올라갔다(24시간 안이면 워커가 즉시 선점).
 *
 * 규칙
 *   - 비었으면 = 지금 올리기(null).
 *   - ISO + 오프셋(`Z` · `+09:00`)은 그대로 읽는다. 새 화면은 언제나 이 형태로 보낸다(DateTimeField = toISOString).
 *   - 오프셋 없는 `YYYY-MM-DDTHH:mm(:ss)` 는 **한국 시간**으로 읽는다 — 배포 사이 열려 있던 구 화면이 막히지 않게.
 *   - 그 밖의 형태는 400.
 *   - 지금보다 60초 넘게 이전이면 400(누르는 사이 몇 초 지난 것은 지금 올리기로 본다).
 */

/** 지난 시각으로 보지 않는 여유 — 사용자가 시각을 고르고 누르는 사이 흐른 시간. */
export const SNS_SCHEDULE_PAST_GRACE_MS = 60 * 1000;

export type SnsScheduleParse =
  | { ok: true; at: Date | null }
  | { ok: false; code: 'SCHEDULE_INVALID' | 'SCHEDULE_IN_PAST'; error: string };

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_NO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

export function parseSnsScheduleAt(raw: unknown, now: number = Date.now()): SnsScheduleParse {
  if (raw === null || raw === undefined) return { ok: true, at: null };
  const s = String(raw).trim();
  if (!s) return { ok: true, at: null };

  let iso: string;
  if (ISO_WITH_OFFSET.test(s)) iso = s;
  else if (LOCAL_NO_OFFSET.test(s)) iso = `${s.length === 16 ? `${s}:00` : s}+09:00`;
  else return { ok: false, code: 'SCHEDULE_INVALID', error: '예약 시각을 읽지 못했어요. 시각을 다시 골라 주세요.' };

  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, code: 'SCHEDULE_INVALID', error: '예약 시각을 읽지 못했어요. 시각을 다시 골라 주세요.' };
  }
  if (at.getTime() < now - SNS_SCHEDULE_PAST_GRACE_MS) {
    return { ok: false, code: 'SCHEDULE_IN_PAST', error: '이미 지난 시각이에요. 지금 올리거나 다른 시각을 골라 주세요.' };
  }
  return { ok: true, at };
}
