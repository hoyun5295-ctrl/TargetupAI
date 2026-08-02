/**
 * journey-intake-grace.ts — 이관 유예 (2026-08-01, 여정 재설계 §3-0-3)
 *   DB import 0 — 순수. SQL 조각과 일수만 만든다.
 *
 * 문제
 *   "우리가 이 고객을 오늘 처음 봤다"는 "이 고객이 오늘 무언가를 했다"가 아니다.
 *   고객사가 기존 고객 DB를 처음 연동하면 수만 명의 created_at이 전부 오늘이 된다.
 *   그 순간 상태형 트리거가 통째로 발화한다 — 3년 전 최근구매일이 오늘 적재되면 그 사람은
 *   즉시 휴면 대상이고, 포인트 소멸도 같으며, 상시 세그먼트는 조건 맞는 전원이 들어온다.
 *   이관은 예외가 아니라 **모든 고객사의 첫 단계**다.
 *
 * 이 CT가 하는 일 (과장하지 않는다 — Codex 4R 정정)
 *   상태형 트리거는 **우리가 그 고객을 안 지 유예가 지난 뒤에만** 발화한다.
 *   막는 것은 **이관 직후 즉시 발화** 하나뿐이다.
 *
 *   ⛔ 유예는 대량 발화를 없애지 못한다. `created_at <= NOW() - 유예`는 시간이 지나면
 *     이관 행 전체가 **동시에** 참이 되는 단조 조건이라, 상시 세그먼트나 포인트 조건처럼
 *     그 뒤로도 계속 참인 트리거는 유예 만료일에 같은 배치가 통째로 들어온다.
 *     그것을 막는 것은 **수신자 상한**이다 — 상태형 여정은 활성화 시점에 상한을 필수로 받는다
 *     (journey-builder.activateJourney). 상한이 없으면 활성화 자체를 거부한다.
 *     기본값이 꺼져 있는 장치에 기대면 안 된다는 것이 이 정정의 요지다.
 *
 *   "며칠 만에 몇 명 이상 늘면 이관"이라는 감지 임계는 두지 않는다.
 *   그건 우리가 정답표를 만드는 일이고(설계서 §2-3), 5만 고객사에 1만 명이 들어오는 조합처럼
 *   비율로도 절대수로도 안 잡히는 구멍이 남는다.
 *
 *   근본 해법(상태 전이 감지 — "어제는 휴면이 아니었는데 오늘 휴면이 됐다")은 진입 원장 일반화가
 *   담당한다(설계서 §3-0, 착수 순서 5번). 여기서는 그 전까지의 안전장치만 만든다.
 *
 * 유예를 적용하지 않는 트리거와 이유
 *   - customer.created        : 진짜 신규는 즉시 보내는 것이 목적이다. 이관 오인은 판정 근거가 막는다
 *                               (journey-identity-signals — "전에도 고객이었다"를 걸러낸다).
 *   - customer.birthday_approaching : 생일은 실제 날짜라 적재 시점과 무관하게 정확하다.
 *   - cdp.* / custom_order_shipped  : 커서가 활성화 시점부터 흐르므로 과거 이벤트 소급이 없다.
 *
 * NULL 안전
 *   customers.created_at이 NULL이면 비교가 NULL이라 그 행은 빠진다 — 덜 보내는 방향이다.
 */

// 유예 일수 클램프는 기존 CT 재사용(인라인 중복 금지). 미설정만 기본값, 0은 "회사가 껐다"로 유효.
import { clampInt } from './journey-points-trigger';

/**
 * 기본 유예 7일.
 * 근거: 이관 배치는 하루~며칠에 걸쳐 들어온다(초기 전량 + 뒤따르는 보정분).
 * 상태형 트리거는 휴면·포인트 소멸처럼 이미 시간이 지난 상태라 며칠 늦어져도 마케팅 효과가 거의 안 변한다.
 * 반대로 짧게 잡으면 이관 꼬리가 유예를 빠져나간다. 회사가 조정할 수 있다(trigger_filters.intake_grace_days).
 */
export const DEFAULT_INTAKE_GRACE_DAYS = 7;
export const MAX_INTAKE_GRACE_DAYS = 90;

/** SQL 식별자 안전 문자만 — alias 주입 차단. */
const SAFE_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 이관 배치가 통째로 걸리는 상태형 트리거인가 — 단일 출처.
 *
 * 두 곳이 같은 집합을 쓴다:
 *   - 추출: 이관 유예를 건다(journey-target-extractor).
 *   - 활성화: 수신자 상한을 필수로 요구한다(journey-builder.activateJourney).
 * 새 상태형 트리거를 추가하면 여기만 고치면 둘 다 따라온다.
 */
export function isBulkStateTrigger(triggerEvent: string): boolean {
  switch (triggerEvent) {
    case 'customer.dormant':
    case 'customer.points_expiring':
    case 'customer.cycle_lapsed':  // §11-5 #6 — 이관 배치가 통째로 걸리는 상태형
    case 'custom':
      return true;
    default:
      return false;
  }
}

/** 회사 설정(trigger_filters.intake_grace_days) → 유예 일수. 미설정 기본 7, 0은 끔, 상한 90. */
export function resolveIntakeGraceDays(filters: Record<string, any> | null | undefined): number {
  return clampInt((filters || {}).intake_grace_days, DEFAULT_INTAKE_GRACE_DAYS, 0, MAX_INTAKE_GRACE_DAYS);
}

/**
 * "우리가 이 고객을 안 지 유예가 지났다" SQL 조각. 유예 0이면 null(조건 없음 = 회사가 껐다).
 * params에 일수 1개를 push한다(applyCustomerConditions와 동일 패턴 — 호출부는 cond 앞에 둔다).
 */
export function buildIntakeGraceClause(alias: string, params: any[], graceDays: number): string | null {
  if (!SAFE_ALIAS.test(alias)) throw new Error(`안전하지 않은 테이블 alias: ${alias}`);
  const days = clampInt(graceDays, DEFAULT_INTAKE_GRACE_DAYS, 0, MAX_INTAKE_GRACE_DAYS);
  if (days <= 0) return null;
  params.push(String(days));
  return `${alias}.created_at <= NOW() - ($${params.length} || ' days')::interval`;
}
