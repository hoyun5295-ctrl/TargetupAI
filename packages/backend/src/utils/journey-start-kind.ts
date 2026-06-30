/**
 * journey-start-kind.ts — 여정 시작 방식(start_kind) 1급 축 (2026-06-30 여정 일반화).
 *   DB import 0 — 순수.
 *
 * start_kind 4종 (journeys.start_kind 컬럼, default 'event'):
 *   - event       : 고객 행동(cdp/customer 트리거) 발생 시 진입. 진입 상대 타이밍. (기존 8 트리거)
 *   - standing    : 조건 충족 고객 상시 진입(custom anti-join). 진입 상대 타이밍.
 *   - date_anchor : 회사 지정일(anchor_date) 기준 D-N 멀티스텝. 절대 날짜 타이밍. D-0 후 자동 정지/재가동.
 *   - one_shot    : 지정 대상군 1회 발송(즉시 또는 예약). 발송 후 완료.
 *
 * 진입 경로 분리:
 *   - event/standing  = journey-trigger-watcher(5분 cron)가 처리 → isWatcherDriven=true.
 *   - date_anchor     = journey-anchor-scheduler(날짜 키)가 처리 → isWatcherDriven=false.
 *   - one_shot        = 활성 시점 dispatch가 단발 enqueue → isWatcherDriven=false.
 *
 * executor 단발 처리:
 *   - date_anchor/one_shot = 단발(1 step 발송 후 완료, 상대 advance 안 함) → isSingleStepKind=true.
 *   - event/standing = 기존 멀티스텝 상대 advance(byte 불변) → isSingleStepKind=false.
 */

export type StartKind = 'event' | 'standing' | 'date_anchor' | 'one_shot';

export const START_KINDS: StartKind[] = ['event', 'standing', 'date_anchor', 'one_shot'];

export function isValidStartKind(x: any): x is StartKind {
  return typeof x === 'string' && (START_KINDS as string[]).includes(x);
}

/** 미지정/미지원 → 'event'(회귀 안전 default — 기존 트리거 경로 보존). */
export function normalizeStartKind(x: any): StartKind {
  return isValidStartKind(x) ? x : 'event';
}

/**
 * 마이그레이션/default 분류 — trigger_event로 start_kind 도출(명시 startKind 없을 때만).
 *   custom → standing · 그 외(8 트리거, points_expiring 포함) → event.
 *   ★ points_expiring(annual_date 포함)는 기존 watcher 추출 경로(journey-target-extractor)가 그대로 처리한다.
 *     date_anchor는 anchor_date·anchor_offset_days를 갖춘 신규 날짜축 빌더가 명시 지정할 때만 적용(자동 분류 X) —
 *     anchor_date 없는 옛 경로를 date_anchor로 잘못 분류해 발송 불능이 되는 것을 막는다.
 *   opts.expiryMode는 호환을 위해 받되 분류에 쓰지 않는다.
 */
export function classifyStartKind(
  triggerEvent: string,
  _opts?: { expiryMode?: string | null },
): StartKind {
  if (triggerEvent === 'custom') return 'standing';
  return 'event';
}

/** journey-trigger-watcher(5분 cron)가 처리하는 진입 방식인가 — event/standing만. */
export function isWatcherDriven(startKind: string | null | undefined): boolean {
  const k = normalizeStartKind(startKind);
  return k === 'event' || k === 'standing';
}

/** executor가 단발(1 step 후 완료, 상대 advance 안 함)로 처리하는 방식인가 — date_anchor/one_shot. */
export function isSingleStepKind(startKind: string | null | undefined): boolean {
  const k = normalizeStartKind(startKind);
  return k === 'date_anchor' || k === 'one_shot';
}
