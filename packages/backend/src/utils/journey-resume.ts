/**
 * journey-resume.ts — 멈춘 여정을 다시 켤 때의 보정 3가지(★ 2026-10-20 여정 V.3 묶음 3 · 설계서 §6-1 ~ §6-3)
 *
 * 지도에 [일시정지] [다시 켜기]를 올리기 전에 막아야 하는 구멍(브레인스토밍 회의론자 1차 · 최종 검증):
 *   1. 밀린 문자 몰림 — 다시 켜기는 실행 시각을 손대지 않았다(실행기가 next_run_at <= NOW 를 다음 5분에 한꺼번에 보냈다).
 *      → 멈춘 기간을 **일 단위로 올림**해서 민다(보낼 시각 · 밤 보정이 그대로 맞는다). 멈추기 직전 이미 때가 된 실행(next_run_at <= paused_at)은
 *        밀지 않는다(바로 받는다 · 순서 보존). 날짜 기준 · 한 번 보내기 실행은 칸 하나짜리 단발이라 밀지 않는다(날짜가 뜻이다).
 *   2. 멈춘 동안 생긴 사건 몰림 — 커서는 NULL 일 때만 잡혀 멈춘 동안의 구매 · 사건이 다시 켠 직후 한꺼번에 들어왔다.
 *      → 쓰고 있던 커서(NULL 아님)만 다시 켠 시각으로 다시 잡는다(커서 id 는 비움 · 첫 켜기와 같은 모양 · 과거분 소급 금지와 같은 방향).
 *        NULL 커서는 그대로(원장 문 미개방 · 빈 창 = 다음 회차부터).
 *   3. 굳은 고객 — 잔액 부족 · 통신사 실패 자동 멈춤이 그 발송을 맞은 실행을 paused 로 굳히고 되살리는 길이 없었다(journey-pause-handler autoPauseExecution).
 *      → 그 자동 멈춤 기록(사유 · 멈출 때 상태 active)이 있는 실행만 active 로. 그날 정지(manager_manual) · 번호 오류(phone_invalid)는 되살리지 않는다.
 *
 * 다시 켜는 트랜잭션(journey-builder activateJourney) 안에서 활성화 UPDATE 바로 뒤에 부른다. 첫 켜기(초안)에는 부르지 않는다.
 */

/** 되살리는 자동 멈춤 사유(journey-pause-handler autoPauseExecution 의 pauseReason 중 시스템 일시 장애만). */
export const RESUME_REVIVE_REASONS = ['balance_insufficient', 'carrier_temp_fail', 'auto_retry_exhausted'] as const;

/**
 * ★ Codex 적대 A3 — 옛: 과거 자동 멈춤 기록이 하나라도 있으면 되살려, 그 뒤 담당자가 「이 발송 정지」로 다시 멈춘 실행까지 깨웠다
 *   (그날 정지는 대표 실행에만 기록을 남겨 실행별 최신 기록으로도 못 가른다). 기록 테이블 시각 칸에 기대지 않는 보수 판정:
 *   자동 멈춤 기록이 있고, 그 실행의 다음 칸에 사람이 건 그날 정지(manager_manual · 여정 전체 정지 링크 제외) 기록이 **하나도 없을 때만** 되살린다.
 *   (같은 칸에 사람 정지가 한 번이라도 있었으면 멈춘 채 둔다 = 덜 보내는 방향.)
 */
export const RESUME_REVIVE_SQL =
  `UPDATE journey_executions e SET status = 'active'
     WHERE e.journey_id = $1::uuid AND e.status = 'paused'
       AND EXISTS (
         SELECT 1 FROM journey_step_pause_logs l
          WHERE l.execution_id = e.id AND l.execution_status_at_pause = 'active'
            AND l.pause_reason = ANY($2::text[])
       )
       AND NOT EXISTS (
         SELECT 1 FROM journey_step_pause_logs m
          WHERE m.journey_id = e.journey_id AND m.pause_reason = 'manager_manual'
            AND COALESCE(m.pause_trigger_source, '') <> 'manager_link_journey'
            AND m.step_id = (SELECT s.id FROM journey_steps s
                              WHERE s.journey_id = e.journey_id AND s.step_order > e.current_step_order
                              ORDER BY s.step_order ASC LIMIT 1)
       )
   RETURNING e.id`;

/** 멈춘 기간을 일 단위 올림만큼 민다($2 = 멈춘 시각 원문 · 같은 문장 안에서 일수를 정한다). */
export const RESUME_SHIFT_SQL =
  `UPDATE journey_executions
      SET next_run_at = next_run_at + make_interval(days => GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - $2::timestamptz)) / 86400.0)::int))
    WHERE journey_id = $1::uuid AND status = 'active'
      AND next_run_at IS NOT NULL AND next_run_at > $2::timestamptz
   RETURNING id`;

/** 쓰고 있던 커서만 다시 켠 시각으로($2 = 활성화 UPDATE 가 찍은 approved_at). */
export const RESUME_CURSOR_SQL =
  `UPDATE journeys SET
      last_event_cursor = CASE WHEN last_event_cursor IS NOT NULL THEN $2::timestamptz ELSE NULL END,
      last_event_cursor_id = NULL,
      last_purchase_cursor = CASE WHEN last_purchase_cursor IS NOT NULL THEN $2::timestamptz ELSE NULL END,
      last_purchase_cursor_id = NULL
    WHERE id = $1::uuid`;

export interface ResumePrev {
  status: string;
  /** 멈춘 시각 원문(::text · µs 절사 없이) · 없으면 null */
  pausedRaw: string | null;
  startKind: string | null;
}

export function isSingleShotStartKind(startKind: string | null | undefined): boolean {
  return startKind === 'date_anchor' || startKind === 'one_shot';
}

/** 다시 켜기 보정 — 옛 상태가 멈춤일 때만. 실행 결과 수를 돌려준다(로그용). */
export async function applyResumeAdjustments(
  run: { query: (text: string, params?: any[]) => Promise<any> },
  journeyId: string,
  prev: ResumePrev,
  approvedAt: unknown,
): Promise<{ revived: number; shifted: number; cursorReset: boolean }> {
  if (prev.status !== 'paused') return { revived: 0, shifted: 0, cursorReset: false };
  const revived = await run.query(RESUME_REVIVE_SQL, [journeyId, [...RESUME_REVIVE_REASONS]]);
  let shifted = 0;
  if (prev.pausedRaw && !isSingleShotStartKind(prev.startKind)) {
    const sh = await run.query(RESUME_SHIFT_SQL, [journeyId, prev.pausedRaw]);
    shifted = sh?.rows?.length || 0;
  }
  await run.query(RESUME_CURSOR_SQL, [journeyId, approvedAt]);
  return { revived: revived?.rows?.length || 0, shifted, cursorReset: true };
}
