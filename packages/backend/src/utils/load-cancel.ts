/**
 * load-cancel.ts — 적재 중단 표식 컨트롤타워 (순수 · DB import 0)
 *
 * ★ 2026-09-26 한줄로 V2 F10·F31·F32 신설.
 * 대행발송 취소는 청구 축(`status='completed'`) 때문에 캠페인 상태를 바꾸지 않는다(cancelCampaign `queueOnly` · 0828).
 * 그런데 직접발송 워커는 `status='cancelled'`만 보고 적재를 멈춰, 적재가 끝나기 전의 대행 취소가 워커에 전해지지 않았다
 * (적재 전 취소 = "이미 발송"으로 거절된 뒤 전량 발송 · 적재 중 취소 = 늦은 조각 환불 부족).
 * 그래서 적재가 끝나지 않은 캠페인에는 `send_config.loadCancelled` 표식을 남기고, 워커는 그 표식을 취소와 같게 본다.
 * 쓰는 쪽(cancelCampaign)과 읽는 쪽(direct-send-worker 선점·루프·종결)이 키 이름·판정을 따로 가지면 조용히 갈라진다 — 여기 하나에 둔다.
 */

export const LOAD_CANCEL_FLAG = 'loadCancelled';

/** 적재가 아직 끝나지 않은 단계(워커가 앞으로 적재할 수 있다). 'sent'·'failed'는 더 적재하지 않는다. */
const LOADING_SEND_PHASES = new Set(['preparing', 'queued', 'processing']);

export function isLoadingSendPhase(phase: unknown): boolean {
  return typeof phase === 'string' && LOADING_SEND_PHASES.has(phase);
}

/** SQL `IN (...)` 안에 넣는 같은 집합(코드 상수라 외부 입력이 섞이지 않는다) — ★2026-09-26 취소 환불 재시도 후보 조회가 쓴다. */
export const LOADING_SEND_PHASES_SQL = Array.from(LOADING_SEND_PHASES).map((p) => `'${p}'`).join(', ');

/** 적재를 멈춰야 하는가 — 캠페인 취소 상태 또는 적재 중단 표식(jsonb boolean · ->> 문자열 모두). */
export function isLoadStopped(status: unknown, loadCancelled: unknown): boolean {
  return status === 'cancelled' || loadCancelled === true || loadCancelled === 'true';
}

/** 종결 UPDATE용 — 중단되지 않은 캠페인만 정상 종결한다(중단이면 0행 → 워커의 취소 정산 분기). */
export const NOT_LOAD_STOPPED_SQL = `status != 'cancelled' AND COALESCE((send_config->>'${LOAD_CANCEL_FLAG}')::boolean, false) = false`;

/** 상태 재확인 SELECT용 — `load_cancelled` 열로 표식을 함께 읽는다. */
export const LOAD_CANCELLED_SELECT = `(send_config->>'${LOAD_CANCEL_FLAG}') = 'true' AS load_cancelled`;
