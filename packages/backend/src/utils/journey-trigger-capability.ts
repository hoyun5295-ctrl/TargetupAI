/**
 * journey-trigger-capability.ts — "이 회사가 지금 만들 수 있는 여정은 무엇인가" (2026-08-01, 설계서 §2-3)
 *   DB import 0 — 순수. 사실(facts)을 받아 트리거별 가능 여부와 사유만 만든다.
 *
 * ⛔ 우리는 정답표를 갖지 않는다
 *   고객사마다 여는 범위가 다르다. 그래서 "이 트리거는 되고 저건 안 된다"를 우리가 미리 못 박지 않고,
 *   **그 회사가 준 데이터로 판정할 수 있는지**를 계산한다. 못 하면 숨기지 않고 사유와 함께 잠근다.
 *   지금은 만들어지고 켜지고 0건으로 도는데, 고객사는 켜 뒀다고 믿고 우리는 아무것도 안 보낸다.
 *   그게 제일 나쁜 형태다.
 *
 * 사유 문구는 화면에 그대로 나간다 — 고객 언어로만 쓴다(내부 용어·컬럼명 금지).
 */

// 커서 경로 판정은 단일 출처를 재사용한다(인라인 재정의 금지).
import { classifyJourneyTrigger } from './journey-cdp-cursor';

/** 화면 트리거 key — 프론트 카탈로그(journey-trigger-catalog.ts)의 key와 같다. */
export type TriggerKey =
  | 'purchase' | 'reservation' | 'cart' | 'shipped'
  | 'signup' | 'dormant' | 'birthday' | 'points';

export const TRIGGER_KEYS: TriggerKey[] = [
  'purchase', 'reservation', 'cart', 'shipped',
  'signup', 'dormant', 'birthday', 'points',
];

/**
 * 회사가 실제로 준 것. 호출부(company-data-profile)가 실측으로 채운다.
 * 여기서 기본값을 지어내지 않는다 — 모르면 false다.
 */
export interface CompanyJourneyFacts {
  /** 신규/기존을 가릴 근거가 있는가 — journey-identity-signals가 판정한 결과. */
  canJudgeNewCustomer: boolean;
  hasRecentPurchaseDate: boolean;
  hasBirthday: boolean;
  hasPoints: boolean;
  /** 자사몰·SDK에서 들어온 행동 기록. */
  hasPurchaseEvents: boolean;
  hasCartEvents: boolean;
  hasShippedEvents: boolean;
}

export interface TriggerAvailability {
  key: TriggerKey;
  available: boolean;
  /** 왜 되는지 / 왜 안 되는지 — 화면에 그대로 나간다. */
  reason: string;
}

/**
 * 예약은 **어떤 회사에서도 아직 만들 수 없다.**
 * 예약 데이터를 받는 연동 자체가 없다(설계서 §3-3·§8). 회사 데이터와 무관한 구조적 사유라
 * facts를 보지 않고 잠근다. 지금은 화면에서 고를 수 있는데 만들면 영영 0건이 된다.
 */
const RESERVATION_REASON = '예약 정보를 받는 연동이 아직 없어요. 준비되면 열립니다.';

export function resolveTriggerAvailability(facts: CompanyJourneyFacts): TriggerAvailability[] {
  const f = facts || ({} as CompanyJourneyFacts);
  const yes = (key: TriggerKey, reason: string): TriggerAvailability => ({ key, available: true, reason });
  const no = (key: TriggerKey, reason: string): TriggerAvailability => ({ key, available: false, reason });

  return [
    f.hasPurchaseEvents
      ? yes('purchase', '주문이 들어오면 발송합니다.')
      : no('purchase', '자사몰 주문 정보가 아직 들어오지 않았어요. 연동하면 열립니다.'),

    no('reservation', RESERVATION_REASON),

    f.hasCartEvents
      ? yes('cart', '장바구니에 담고 결제하지 않으면 발송합니다.')
      : no('cart', '장바구니 정보가 아직 들어오지 않았어요. 자사몰을 연동하면 열립니다.'),

    f.hasShippedEvents
      ? yes('shipped', '배송이 시작되면 발송합니다.')
      : no('shipped', '배송 정보가 아직 들어오지 않았어요. 자사몰을 연동하면 열립니다.'),

    f.canJudgeNewCustomer
      ? yes('signup', '처음 오신 분에게 발송합니다.')
      : no('signup', '기존 고객과 새 고객을 구분할 정보가 없어요. 구매이력을 연동하면 열립니다.'),

    f.hasRecentPurchaseDate
      ? yes('dormant', '한동안 구매가 없으면 발송합니다.')
      : no('dormant', '최근 구매일 정보가 없어요. 구매이력을 연동하면 열립니다.'),

    f.hasBirthday
      ? yes('birthday', '생일이 다가오면 발송합니다.')
      : no('birthday', '생년월일 정보가 없어요. 고객 정보에 생년월일이 있으면 열립니다.'),

    f.hasPoints
      ? yes('points', '포인트가 사라지기 전에 발송합니다.')
      : no('points', '포인트 정보가 없어요. 고객 정보에 포인트가 있으면 열립니다.'),
  ];
}

/**
 * 저장된 trigger_event → 화면 트리거 key. 매핑 없는 값은 null(가능 여부를 묻지 않는다).
 *   'custom'(상시 세그먼트)은 트리거 데이터가 필요 없어 null이다 — 조건은 회사가 직접 고른다.
 *   활성화 게이트(journey-builder)가 이 함수로 저장값을 판정 대상에 잇는다.
 */
export function triggerKeyForEvent(triggerEvent: string): TriggerKey | null {
  switch (triggerEvent) {
    case 'cdp.purchase': return 'purchase';
    case 'cdp.reservation_created': return 'reservation';
    case 'cdp.cart_abandon': return 'cart';
    case 'custom_order_shipped': return 'shipped';
    case 'customer.created': return 'signup';
    case 'customer.dormant': return 'dormant';
    case 'customer.birthday_approaching': return 'birthday';
    case 'customer.points_expiring': return 'points';
    default: return null;
  }
}

/**
 * 수신자 상한을 **필수로** 받아야 하는 트리거인가 (2026-08-01 Codex 5R 수용).
 *
 * ⛔ 유예 대상(isBulkStateTrigger)과 다른 집합이다. 옛 코드는 둘을 하나로 묶어 생일이 빠졌다.
 *   생일은 실제 날짜라 유예는 필요 없지만, 생년월일을 대량 적재하면 그날 MM-DD가 맞는 코호트가
 *   **한꺼번에** 후보가 된다. 상한이 없으면 그대로 나간다.
 *
 * 기준: **커서 경로가 아닌 모든 트리거.** 커서 트리거(구매·예약·배송·장바구니)는 활성화 시점부터
 *   앞으로만 흐르는 이벤트를 읽으므로 데이터 대량 적재가 과거 이벤트를 만들지 않는다.
 *   그 밖(신규가입·휴면·생일·포인트·상시 + 모르는 값)은 고객 상태를 매 회차 재평가하므로
 *   적재 한 번에 코호트 전체가 발화할 수 있다. 모르는 값이 여기 포함되는 것은 의도다(fail-closed).
 *   판정은 journey-cdp-cursor의 classifyJourneyTrigger 단일 출처를 재사용한다.
 */
export function requiresRecipientCap(triggerEvent: string): boolean {
  return classifyJourneyTrigger(triggerEvent) === 'state';
}

/**
 * 상한을 요구하지 않는 트리거 목록 — 활성화 UPDATE의 원자 조건에 쓴다.
 * requiresRecipientCap의 여집합이며, 아래 parity 테스트가 둘의 일치를 고정한다.
 */
export const CAP_EXEMPT_TRIGGERS: string[] = [
  'cdp.purchase', 'cdp.reservation_created', 'custom_order_shipped', 'cdp.cart_abandon',
];

/** 화면이 쓰기 좋은 형태 — key → 가능 여부·사유. */
export function toAvailabilityMap(list: TriggerAvailability[]): Record<string, { available: boolean; reason: string }> {
  const map: Record<string, { available: boolean; reason: string }> = {};
  for (const a of list) map[a.key] = { available: a.available, reason: a.reason };
  return map;
}

/** 하나라도 만들 수 있는가 — 전부 잠기면 화면이 "무엇을 연동해야 하는지"만 안내한다. */
export function hasAnyAvailableTrigger(list: TriggerAvailability[]): boolean {
  return list.some((a) => a.available);
}
