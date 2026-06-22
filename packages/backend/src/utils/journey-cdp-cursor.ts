/**
 * cdp 이벤트 커서 배치 플래너 — 순수(DB import 0).
 *
 * 한 윈도우 (cursor, windowEnd]의 이벤트 행을 받아:
 *   - chunk를 넘으면 앞 chunk만 처리하고, 커서를 "마지막 처리 이벤트 시각"까지만 전진(나머지는 다음 회차).
 *   - chunk 이내면 창 전체 처리로 보고 커서 = windowEnd.
 *   - 고객 중복은 제거(첫 등장 순서 유지).
 * → 한 윈도우 이벤트가 상한을 넘어도 영구 누락 없이 회차로 분산 처리(LIMIT 손실 정정 #11).
 *
 * 경계 동시각 가정: 다음 회차는 occurred_at > newCursor(배타)로 잇는다. occurred_at은 microsecond라
 *   절단 경계에 정확히 같은 시각 이벤트가 chunk 밖으로 갈라질 확률은 무시 가능. 갈라져도 재진입 cooldown이 중복을 막는다.
 */

export interface CdpEventRow {
  customerId: string;
  occurredAt: Date;
  properties?: Record<string, any> | null;
}

export interface CdpCursorBatch {
  ids: string[];
  propertiesByCustomer: Record<string, Record<string, any>>;  // customerId → 첫 등장 이벤트 properties (알림톡 변수 치환용)
  newCursor: Date;
  truncated: boolean;
}

export function planCdpCursorBatch(rows: CdpEventRow[], chunk: number, windowEnd: Date): CdpCursorBatch {
  const truncated = rows.length > chunk;
  const usable = truncated ? rows.slice(0, chunk) : rows;

  const seen = new Set<string>();
  const ids: string[] = [];
  const propertiesByCustomer: Record<string, Record<string, any>> = {};
  for (const r of usable) {
    if (!seen.has(r.customerId)) {
      seen.add(r.customerId);
      ids.push(r.customerId);
      if (r.properties && typeof r.properties === 'object') {
        propertiesByCustomer[r.customerId] = r.properties;
      }
    }
  }

  const newCursor = truncated && usable.length > 0 ? usable[usable.length - 1].occurredAt : windowEnd;
  return { ids, propertiesByCustomer, newCursor, truncated };
}

/**
 * 진입 properties를 customerId 순서에 정렬한 jsonb[] 파라미터 배열로 변환 (enqueueCandidates의 unnest 두 배열 정렬용).
 *   - propsByCustomer에 있고 비어있지 않으면 JSON.stringify, 없거나 빈 객체면 null.
 *   - props 미전달(cdp 커서 외 트리거) 시 전부 null → entry_event_properties NULL(기존 동작 불변).
 */
export function buildEntryPropsArray(
  customerIds: string[],
  propsByCustomer?: Record<string, Record<string, any>>,
): (string | null)[] {
  return customerIds.map((id) => {
    const p = propsByCustomer?.[id];
    if (p && typeof p === 'object' && Object.keys(p).length > 0) return JSON.stringify(p);
    return null;
  });
}

/**
 * 커서 경로(이벤트 스트림 + 누락 0 + 정확히 1회 + properties 동봉)를 타는 trigger 판정 — 단일 출처.
 *   반환값 = cdp_events.event_name(매칭용), null이면 enqueueCandidates(상태 재평가) 경로.
 *   구매·예약·배송(custom_order_shipped)은 1회성 이벤트라 커서 경로 → 진입 이벤트 properties를 알림톡 변수로 채운다.
 */
export function resolveCdpCursorEventName(triggerEvent: string): string | null {
  switch (triggerEvent) {
    case 'cdp.purchase': return 'purchase';
    case 'cdp.reservation_created': return 'reservation_created';
    case 'custom_order_shipped': return 'custom_order_shipped';
    default: return null;
  }
}
