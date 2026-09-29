/**
 * journey-entry-replace.ts — 진입 교체 CT (★ 2026-09-30 여정 V2 3차 · 설계서 §6 · Harold 승인 결정 3)
 *
 * 같은 여정을 진행 중인 고객이 다시 사면(재구매 새 주기) 옛 실행을 목표 달성(goal_met)으로 닫고 새로 넣는다.
 *   옛: 구매 여정은 재진입 허용 · 쿨다운 0 · 실행 UNIQUE 없음이라 같은 고객의 실행이 여러 개 동시에 돌았다
 *   (자동 종료가 꺼져 있으면 두 주기의 문자가 겹쳐 나간다).
 *
 * ⛔ 새 여정 · 담당자가 직접 켠 여정만(trigger_filters.entry_replace === true). 키가 없는 기존 행은 동작 무변경.
 *   상품 재구매 프리셋은 서버가 켠다. 그 밖 구매 흐름 여정은 옵션에서 담당자가 켠다.
 * ⛔ 닫기와 새 진입은 한 트랜잭션(호출부 journey-trigger-watcher finishCursorBatch) — 닫고 못 넣는 반쯤 상태를 만들지 않는다.
 */

/** 이 여정이 진입 교체를 쓰는가. 명시 true 만(문자열 'true' 등은 옵션 검증기가 불리언으로 정규화해 저장한다). */
export function usesEntryReplacement(triggerFilters: Record<string, any> | null | undefined): boolean {
  return (triggerFilters || {}).entry_replace === true;
}

/** 옛 실행 닫기 — $1 여정 · $2 고객. 진행 중(active)만(대조군 holdout · 이미 끝난 실행은 건드리지 않는다). */
export const CLOSE_ACTIVE_FOR_REPLACEMENT_SQL =
  `UPDATE journey_executions SET status = 'goal_met', completed_at = NOW()
    WHERE journey_id = $1::uuid AND customer_id = $2::uuid AND status = 'active'`;
