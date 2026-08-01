/**
 * cdp 이벤트 커서 배치 플래너 — 순수(DB import 0).
 *
 * ★ 2026-08-01 §11-3 — 커서 축을 "언제 일어났나"에서 "언제 도착했나"로 옮겼다.
 *
 *   옛 축(occurred_at)이 만든 구멍 셋:
 *     1) 배치로 늦게 도착한 데이터가 커서 뒤에 떨어져 **영영 안 잡힌다.** 매장 구매를 싱크에이전트가
 *        하루 뒤에 올리면 그 행의 발생 시각은 이미 커서보다 과거다. 배선을 해도 진입이 0이 된다.
 *     2) 브라우저 SDK는 **한 배치의 모든 이벤트에 같은 시각**을 찍는다(cdp-events의 batch.sentAt 클램프).
 *        옛 주석의 "microsecond라 동시각 확률 무시 가능"이라는 전제가 그 경로에서 성립하지 않는다.
 *     3) 로그인 전 익명 이벤트에 나중에 customer_id가 붙어도(최대 30일 소급) 커서는 이미 지나가
 *        그 구매·배송이 여정에 못 들어간다.
 *   도착 축(created_at)은 셋 다 닫는다 — 늦게 도착해도 도착 순서로는 항상 커서 앞이다.
 *
 * 동시각 타이
 *   도착 축에서도 같은 시각이 몰릴 수 있어(배치 적재) 보조 키로 이벤트 id를 함께 쓴다.
 *   `journeys.last_event_cursor_id`가 아직 없는 환경에서는 eventId=null로 시각만 쓴다 —
 *   그때도 (1)(3)은 닫히고 (2)만 남는다. 컬럼이 생기면 코드 변경 없이 정밀해진다.
 *
 * 커서 전진 규칙
 *   본 회차에 **실제로 본 마지막 행**까지만 전진한다. 못 본 구간을 건너뛰지 않는다.
 *   행이 하나도 없으면 그 창을 다 소비한 것이므로 windowEnd로 전진한다.
 */

export interface CdpEventRow {
  customerId: string;
  /** 이벤트 고유 id — 동시각 타이브레이커. */
  eventId: string;
  /** 도착 시각(cdp_events.created_at) — 커서 축. */
  createdAt: Date;
  /** 발생 시각 — 문안·통계용으로 남긴다(커서 축 아님). */
  occurredAt: Date;
  properties?: Record<string, any> | null;
}

/** 커서 위치 — `at`은 축(도착/발생)에 해당하는 시각. eventId가 null이면 타이 보조 없이 시각만 쓴다. */
export interface CdpCursorPosition {
  at: Date;
  eventId: string | null;
}

/** 커서 축 — 도착(created_at)이 기본. 컬럼 미마이그레이션 환경만 발생(occurred_at)을 유지한다. */
export type CdpCursorAxis = 'created_at' | 'occurred_at';

export interface CdpCursorBatch {
  ids: string[];
  propertiesByCustomer: Record<string, Record<string, any>>;  // customerId → 첫 등장 이벤트 properties (알림톡 변수 치환용)
  newCursor: CdpCursorPosition;
  truncated: boolean;
}

export function planCdpCursorBatch(
  rows: CdpEventRow[],
  chunk: number,
  windowEnd: Date,
  axis: CdpCursorAxis = 'created_at',
): CdpCursorBatch {
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

  // 실제로 본 마지막 행까지만 전진한다. 절단 여부와 무관 — 못 본 것을 건너뛰지 않는 쪽이 항상 안전하다.
  // 커서 값은 축에 맞춰 고른다. 옛 축(occurred_at)에 도착 시각을 써 넣으면 다음 회차 비교가 어긋난다.
  const last = usable.length > 0 ? usable[usable.length - 1] : null;
  const newCursor: CdpCursorPosition = last
    ? { at: axis === 'occurred_at' ? last.occurredAt : last.createdAt, eventId: last.eventId }
    : { at: windowEnd, eventId: null };

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

export type JourneyTriggerClass = 'event_cursor' | 'event_special' | 'state';

/**
 * 여정 트리거 이벤트성/상태성 분류 — 단일 출처 (2026-06-25 gap 1).
 *   - event_cursor: 진입 cdp_event + 치환 가치 properties 보유 → 커서 경로(누락 0·정확히 1회·properties 동봉).
 *   - event_special: cart_abandon — 이벤트 기반이나 "이후 결제 없음" 파생 상태라 별도 properties 동봉(trigger-watcher).
 *   - state: 휴면/생일/포인트/신규/자유 세그먼트 — 진입 이벤트 없음(properties 원천 부재, 설계상 정상).
 * 새 이벤트성 트리거 추가 시 event_cursor면 resolveCdpCursorEventName도 함께 추가(verify 가드가 강제).
 * ★ 수신자 상한 필수 판정(journey-trigger-capability.requiresRecipientCap)도 이 분류를 쓴다 — state가 대상.
 */
export function classifyJourneyTrigger(triggerEvent: string): JourneyTriggerClass {
  switch (triggerEvent) {
    case 'cdp.purchase':
    case 'cdp.reservation_created':
    case 'custom_order_shipped':
      return 'event_cursor';
    case 'cdp.cart_abandon':
      return 'event_special';
    default:
      return 'state';
  }
}
