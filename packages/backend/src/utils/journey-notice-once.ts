/**
 * 여정 담당자 안내 쓰기 = 한 꼴(★ 2026-10-31 · 설계서 docs/2026-10-31-journey-step-gate-notice-design.md §2-6 · §2-8 · Codex 설계 3R ~ 5R)
 *
 * 순서가 이 함수의 뜻이다: ① 시도 잡기(DB 에 남는 시도 수 · 조건부 UPDATE · 0행 = 보내지 않음)
 *   → ② 인증 라인 적재(상한 있는 MySQL 연결) → ③ 성공이면 성공 기록(조건부 UPDATE).
 *   - 관문(발송 전 안내)은 ③ 뒤에야 열린다 → 고객 문자가 안내보다 먼저 나가는 갈래 0.
 *   - 시도 수를 적재 **전에** 남기므로 재시작 · ③ 실패 · 상한 뒤 늦게 끝난 INSERT 가 있어도 같은 안내는 시도 상한(3)을 넘지 않는다.
 *   - 잠금을 쥐지 않는다(MySQL 작업 동안 PG 행 잠금 0 · 칸 수정의 기록 DELETE 는 기다리지 않는다).
 * 쓰는 곳 = 발송 전 안내(journey-pretest-notifier · journey_pretest_schedules.notice_attempts) · 보낸 결과 안내(journey-result-notice · journey_step_campaigns.result_notice_attempts).
 */

/** 같은 안내(같은 기록 행 · 같은 단계)를 적재하는 시도 상한 */
export const NOTICE_MAX_ATTEMPTS = 3;
/** 안내 한 통 적재(연결 받기 + INSERT)의 상한 */
export const NOTICE_ENQUEUE_TIMEOUT_MS = 20_000;

export interface NoticeOnceSteps {
  /** ① 시도 잡기 — 시도 수 +1 이 반영되면 true(0행 = false) */
  claim: () => Promise<boolean>;
  /** ② 적재 — 한 통이 큐에 들어가면 true */
  enqueue: () => Promise<boolean>;
  /** ③ 성공 기록 — 반영되면 true(0행 = 그사이 행이 바뀜) */
  finalize: () => Promise<boolean>;
}

export type NoticeOnceResult = 'sent' | 'not_claimed' | 'enqueue_failed' | 'finalize_missed';

/** ① → ② → ③. ② 의 오류는 실패로 접는다(시도 수는 이미 남았다 · 다음 회차가 다시 본다). ① · ③ 의 오류는 던진다(묶음 예외 상한이 센다). */
export async function sendNoticeOnce(steps: NoticeOnceSteps): Promise<NoticeOnceResult> {
  if (!(await steps.claim())) return 'not_claimed';
  let loaded = false;
  try {
    loaded = await steps.enqueue();
  } catch (err: any) {
    console.warn('[journey-notice] 안내 적재 실패(다음 회차가 시도 하나를 더 써서 다시):', err?.message || err);
    loaded = false;
  }
  if (!loaded) return 'enqueue_failed';
  return (await steps.finalize()) ? 'sent' : 'finalize_missed';
}
