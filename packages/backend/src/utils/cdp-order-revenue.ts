/**
 * ★ CT-86: CDP 주문 매출 반영 판정 컨트롤타워 — 2026-06-10
 *
 * 목적
 *   syncOrder(cdp-orders.ts)의 "이번 호출이 RFM 매출에 무엇을 해야 하는가"를 순수 함수로 판정.
 *   - 이전 결함: purchase 이벤트 존재 = 무조건 중복 처리 → pending으로 먼저 들어온 주문이
 *     나중에 paid가 되어도 매출이 영원히 미반영 + 취소/환불 차감 미구현.
 *   - 정정: 이벤트 존재 여부가 아니라 "매출 반영 마커(revenue_applied)" 기준으로 판정.
 *
 * 마커 규약 (cdp_events.properties — 실측 jsonb 컬럼, ALTER 불필요)
 *   - revenue_applied: true  → 이 주문의 매출이 customers RFM에 더해짐
 *   - revenue_reversed: true → 취소/환불로 차감까지 끝남 (재차감 금지)
 *   - 마커가 없는 과거 행: 기록 당시 status가 paid/completed였으면 "반영됨"으로 간주
 *     (이전 코드가 그 시점에 RFM을 더했기 때문 — 기존 데이터 호환)
 *
 * DB import 없음 — 순수 함수 (DB-free 테스트 가능).
 */

export const REVENUE_STATUSES = ['completed', 'paid'] as const;
export const CANCEL_STATUSES = ['cancelled', 'refunded'] as const;

export function isRevenueStatus(status: string): boolean {
  return (REVENUE_STATUSES as readonly string[]).includes(status);
}

export function isCancelStatus(status: string): boolean {
  return (CANCEL_STATUSES as readonly string[]).includes(status);
}

export interface ExistingPurchaseEvent {
  /** cdp_events.properties (기존 purchase 이벤트) */
  properties: Record<string, any> | null;
}

export type OrderRevenueAction =
  | 'apply'      // 매출 더하기 (+ revenue_applied 마커)
  | 'reverse'    // 매출 차감 (+ revenue_reversed 마커)
  | 'none';      // 매출 변화 없음 (트래킹만)

export interface OrderRevenueDecision {
  action: OrderRevenueAction;
  /** 기존 이벤트가 이미 매출 반영 상태였는지 (마커 또는 과거 호환 간주 포함) */
  alreadyApplied: boolean;
  /** 차감 시 사용할 금액 — 반영 시점에 기록된 금액이 진실 (이번 호출 금액 아님) */
  reverseAmount: number | null;
}

/** 기존 purchase 이벤트가 "매출 반영됨" 상태인지 판정 (과거 데이터 호환 포함) */
export function isRevenueApplied(existing: ExistingPurchaseEvent | null): boolean {
  if (!existing || !existing.properties) return false;
  const p = existing.properties;
  if (p.revenue_applied === true) return true;
  // 마커 도입(2026-06-10) 전 행 호환: 기록 당시 paid/completed였으면 이전 코드가 이미 더했음
  if (p.revenue_applied === undefined && isRevenueStatus(String(p.status || ''))) return true;
  return false;
}

/** 기존 purchase 이벤트가 이미 차감까지 끝났는지 */
export function isRevenueReversed(existing: ExistingPurchaseEvent | null): boolean {
  return !!existing?.properties && existing.properties.revenue_reversed === true;
}

/**
 * 이번 주문 호출이 매출에 할 일 판정.
 *
 * @param existing      같은 order_id의 기존 purchase 이벤트 (없으면 null)
 * @param incomingStatus 이번 호출의 주문 status
 */
export function decideOrderRevenueAction(
  existing: ExistingPurchaseEvent | null,
  incomingStatus: string
): OrderRevenueDecision {
  const applied = isRevenueApplied(existing);
  const reversed = isRevenueReversed(existing);

  if (isRevenueStatus(incomingStatus)) {
    // 결제 확정 — 아직 반영 전이면 더한다. 이미 반영(또는 차감 종료)이면 재반영 금지.
    if (!applied && !reversed) {
      return { action: 'apply', alreadyApplied: false, reverseAmount: null };
    }
    return { action: 'none', alreadyApplied: applied, reverseAmount: null };
  }

  if (isCancelStatus(incomingStatus)) {
    // 취소/환불 — 반영된 적 있고 아직 차감 전이면 차감. 반영 전 취소는 매출 변화 없음.
    if (applied && !reversed) {
      const amt = Number(existing?.properties?.total_amount);
      return {
        action: 'reverse',
        alreadyApplied: true,
        reverseAmount: Number.isFinite(amt) && amt > 0 ? amt : null,
      };
    }
    return { action: 'none', alreadyApplied: applied, reverseAmount: null };
  }

  // pending / shipping 등 — 트래킹만
  return { action: 'none', alreadyApplied: applied, reverseAmount: null };
}
