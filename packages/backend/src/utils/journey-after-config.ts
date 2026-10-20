/**
 * journey-after-config.ts — 「앞 여정을 마치면」 설정 읽기(순수 · ★ 2026-10-20 여정 V.3 §18)
 *
 * 붙인 여정(시작 사건 journey.after)의 trigger_filters 키: after_root(앞 여정 계보 뿌리) · after_outcome(넘길 결과) · attach_prev(떼기 값).
 * 켜기 검사 · 추출 · 감시 · 지도 · 붙이기가 이 한 곳으로 읽는다(형식이 틀리면 null = 켜지 않고 받지 않는다).
 */
import { isUuid } from './normalize';

export type AfterOutcome = 'goal_met' | 'completed' | 'any';
export const AFTER_OUTCOMES: AfterOutcome[] = ['goal_met', 'completed', 'any'];
export const AFTER_OUTCOME_LABEL: Record<AfterOutcome, string> = {
  goal_met: '목표를 이뤄 마친 고객',
  completed: '끝까지 받은 고객',
  any: '마친 고객 모두',
};

/** 마친 뒤 이 일수 안에 못 들어오면 받지 않는다(늦은 문자 0 · 조회 범위 상한). */
export const AFTER_JOURNEY_WINDOW_DAYS = 7;

/** 결과 → 앞 여정 실행의 끝난 상태. goal_met = 목표 종료 · 진입 교체 / completed = 마지막 칸까지. */
export function outcomeStatuses(outcome: AfterOutcome): string[] {
  return outcome === 'goal_met' ? ['goal_met'] : outcome === 'completed' ? ['completed'] : ['goal_met', 'completed'];
}

/**
 * 시작 설정 세대(trigger_filters.start_gen · 붙이기 · 떼기마다 +1 · 없으면 0). ★ Codex 적대 A 3R — 감시의 쓰기(넣기 · 커서 전진 · 멈춤)는
 *   읽은 때의 세대와 지금 세대가 같을 때만 한다. 시작 사건 이름 비교로는 붙였다 떼는 왕복(이름이 원래대로)을 못 가른다.
 */
export function startGenOf(filters: any): number {
  const n = Number((filters || {}).start_gen);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** 붙인 여정의 설정 — 형식이 틀리면 null. 뿌리는 소문자로(계보 비교). */
export function readAfterConfig(filters: any): { root: string; outcome: AfterOutcome } | null {
  const f = filters || {};
  const root = String(f.after_root || '');
  const outcome = String(f.after_outcome || '') as AfterOutcome;
  if (!isUuid(root) || !AFTER_OUTCOMES.includes(outcome)) return null;
  return { root: root.toLowerCase(), outcome };
}
