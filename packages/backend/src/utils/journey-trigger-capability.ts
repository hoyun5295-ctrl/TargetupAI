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
// (2026-08-02 §11-5) 상한 전면 필수화로 classifyJourneyTrigger 의존이 사라졌다 — 커서 규약은 journey-cdp-cursor가 계속 소유.

/** 화면 트리거 key — 프론트 카탈로그(journey-trigger-catalog.ts)의 key와 같다. */
export type TriggerKey =
  | 'purchase' | 'reservation' | 'cart' | 'shipped'
  | 'signup' | 'dormant' | 'birthday' | 'points'
  // ★ §11-5 신설 — 구매 스트림 분기 2종(#2 첫 구매 · #5 휴면 복귀)
  | 'first_purchase' | 'dormant_return' | 'cycle_lapsed' | 'browse' | 'grade';

export const TRIGGER_KEYS: TriggerKey[] = [
  'purchase', 'reservation', 'cart', 'shipped',
  'signup', 'dormant', 'birthday', 'points',
  'first_purchase', 'dormant_return', 'cycle_lapsed', 'browse', 'grade',
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
  /** 등급 값 보유 — #7의 1차 근거(값이 있는가). */
  hasGrade: boolean;
  /**
   * ★ 2026-08-02 — 등급 **서열을 회사가 확인**했는가(순위가 매겨진 값 2개 이상).
   * ⛔ 값만 있고 서열이 없으면 상승·하락을 가릴 수 없다. 그 상태로 열면 **떨어진 고객에게 축하가 나간다.**
   *   우리가 등급 사전을 갖지 않기로 한 이상, 서열은 사람이 한 번 확인한 것만 믿는다.
   */
  hasGradeOrder: boolean;
  /** 자사몰·SDK에서 들어온 행동 기록. */
  hasPurchaseEvents: boolean;
  hasCartEvents: boolean;
  /** 상품 조회(product_view) 기록 — #12 조회 후 미구매의 근거. */
  hasBrowseEvents: boolean;
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
    // ★ 2026-08-01 §11-4: 구매는 문이 둘이다(자사몰 주문 / 매장·ERP 싱크). 사유도 한쪽만 가리키지 않는다.
    f.hasPurchaseEvents
      ? yes('purchase', '구매가 들어오면 발송합니다.')
      : no('purchase', '구매 정보가 아직 들어오지 않았어요. 자사몰이나 매장 시스템을 연동하면 열립니다.'),

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

    // ★ §11-5 — 구매 스트림 분기 2종. 근거는 구매와 같다(문과 무관, §2-2).
    f.hasPurchaseEvents
      ? yes('first_purchase', '생애 첫 구매가 들어오면 발송합니다.')
      : no('first_purchase', '구매 정보가 아직 들어오지 않았어요. 자사몰이나 매장 시스템을 연동하면 열립니다.'),

    f.hasPurchaseEvents
      ? yes('dormant_return', '오래 쉬었다가 다시 구매하면 발송합니다.')
      : no('dormant_return', '구매 정보가 아직 들어오지 않았어요. 자사몰이나 매장 시스템을 연동하면 열립니다.'),

    f.hasPurchaseEvents
      ? yes('cycle_lapsed', '평소 구매 주기를 넘기면 발송합니다.')
      : no('cycle_lapsed', '구매 정보가 아직 들어오지 않았어요. 자사몰이나 매장 시스템을 연동하면 열립니다.'),

    f.hasBrowseEvents
      ? yes('browse', '상품을 보고 구매하지 않으면 발송합니다.')
      : no('browse', '상품 조회 기록이 아직 들어오지 않았어요. 자사몰을 연동하면 열립니다.'),

    // ★ 2026-08-02 — 상승만 발화한다. 서열을 모르면 방향을 못 가리므로 값만으로는 열지 않는다.
    !f.hasGrade
      ? no('grade', '등급 정보가 없어요. 고객 정보에 등급이 있으면 열립니다.')
      : !f.hasGradeOrder
        ? no('grade', '등급 순서를 한 번 정해 주시면 열립니다. 어느 등급이 위인지 알아야 올라간 분에게만 보낼 수 있어요.')
        : yes('grade', '회원 등급이 올라가면 발송합니다.'),
  ];
}

// ═══════════════════════════════════════════════════════════
// 트리거 레지스트리 — §11-5 (2026-08-02). 15종 + 상시의 계약 단일 출처.
//   §3의 정의 넷(진입/종료/재진입/필요 데이터) 중 코드가 강제할 것을 여기 선언한다.
//   화이트리스트(§5-4)·쿨다운 필수(§9-N1)·종료 신호(§5-1)가 전부 이 표에서 나온다.
//   새 트리거 = 이 표에 한 줄 추가가 유일한 등록 경로다(호출부 분기 금지).
// ═══════════════════════════════════════════════════════════

export interface TriggerContract {
  /** journeys.trigger_event 저장값. */
  event: string;
  /** 화면 카탈로그 key. null = 화면 비노출(custom·미구현 전이형). */
  key: TriggerKey | null;
  /** §3 분류 — transition(상태 전이) / event(사건) / reservation(예약) / standing(상시). */
  cls: 'transition' | 'event' | 'reservation' | 'standing';
  /**
   * 추출·실행 경로가 실제로 있는가. false면 저장·활성화 모두 거부한다 —
   * "만들어지고 켜지는데 영원히 0건"(§2-3이 없애려는 상태)을 등록 단계에서 차단.
   */
  implemented: boolean;
  /** §5-1 종료 신호 — 실행기 배선은 §11-5 C조각. 계약 선언이 먼저다. */
  exit: 'purchase' | 'second_purchase' | 'next_purchase' | 'steps_done' | 'points_used' | 'reservation_closed';
  /** 재진입 허용 시 최소 쿨다운 일수(§9-N1). 미달이면 활성화 거부. */
  cooldownMinDays?: number;
}

export const TRIGGER_CONTRACTS: TriggerContract[] = [
  // §3-1 상태 전이형
  { event: 'customer.created',              key: 'signup',   cls: 'transition', implemented: true,  exit: 'purchase' },
  { event: 'purchase.first',                key: 'first_purchase', cls: 'transition', implemented: true, exit: 'second_purchase' }, // #2 — 구매 스트림 분기(이전 구매 0건)
  { event: 'cdp.purchase',                  key: 'purchase', cls: 'event',      implemented: true,  exit: 'next_purchase' },     // #3 재구매(현행 구매)
  { event: 'customer.dormant',              key: 'dormant',  cls: 'transition', implemented: true,  exit: 'purchase' },
  { event: 'customer.dormant_return',       key: 'dormant_return', cls: 'transition', implemented: true, exit: 'steps_done' },   // #5 — 구매 스트림 분기(직전 구매가 휴면 기준일 이상 과거)
  { event: 'customer.cycle_lapsed',         key: 'cycle_lapsed', cls: 'transition', implemented: true, exit: 'purchase', cooldownMinDays: 1 }, // #6
  // #7 — 원장 state와 **서열 비교**(상승만). 쿨다운은 오르내리락 왕복에서 축하가 연달아 나가는 것을 막는 바닥값이고,
  //   진짜 방어는 "상승만 + 같은 급 제외"다(2026-08-02).
  { event: 'customer.grade_changed',        key: 'grade',    cls: 'transition', implemented: true,  exit: 'steps_done', cooldownMinDays: 1 },
  { event: 'customer.birthday_approaching', key: 'birthday', cls: 'transition', implemented: true,  exit: 'steps_done' },
  { event: 'customer.points_expiring',      key: 'points',   cls: 'transition', implemented: true,  exit: 'points_used' },
  // §3-2 사건 발생형
  { event: 'cdp.cart_abandon',              key: 'cart',     cls: 'event',      implemented: true,  exit: 'purchase', cooldownMinDays: 1 },  // §9-N1
  { event: 'custom_order_shipped',          key: 'shipped',  cls: 'event',      implemented: true,  exit: 'steps_done' },
  { event: 'cdp.browse_no_purchase',        key: 'browse',   cls: 'event',      implemented: true,  exit: 'purchase', cooldownMinDays: 1 }, // #12
  // §3-3 예약 (원장 §8 선행 — 착수 6번. 커서 경로는 있으나 데이터 문이 없어 capability가 잠근다)
  { event: 'cdp.reservation_created',       key: 'reservation', cls: 'reservation', implemented: true,  exit: 'reservation_closed' },
  { event: 'reservation.visit_dn',          key: null,       cls: 'reservation', implemented: false, exit: 'reservation_closed' }, // #14 — 착수 6번
  { event: 'reservation.visit_done',        key: null,       cls: 'reservation', implemented: false, exit: 'steps_done' },         // #15 — 착수 6번
  // 상시(자유 세그먼트) — §3-5: §5-4 게이트 뒤로
  { event: 'custom',                        key: null,       cls: 'standing',   implemented: true,  exit: 'steps_done' },
];

const CONTRACT_BY_EVENT = new Map(TRIGGER_CONTRACTS.map((c) => [c.event, c]));

/** 등록된 trigger_event인가 — DB CHECK와 같은 집합(§5-4). */
export function isRegisteredTriggerEvent(triggerEvent: string): boolean {
  return CONTRACT_BY_EVENT.has(triggerEvent);
}

/** 저장·활성화가 받아주는 trigger_event인가 — 등록 + 구현 완료. */
export function isImplementedTriggerEvent(triggerEvent: string): boolean {
  return CONTRACT_BY_EVENT.get(triggerEvent)?.implemented === true;
}

/** 계약 조회 — 없으면 null(fail-closed는 호출부 몫). */
export function getTriggerContract(triggerEvent: string): TriggerContract | null {
  return CONTRACT_BY_EVENT.get(triggerEvent) ?? null;
}

/**
 * 저장된 trigger_event → 화면 트리거 key. 레지스트리에서 파생(단일 출처).
 *   'custom'(상시)·미구현 전이형은 null — 가능 여부를 묻지 않는다.
 */
export function triggerKeyForEvent(triggerEvent: string): TriggerKey | null {
  return CONTRACT_BY_EVENT.get(triggerEvent)?.key ?? null;
}

/**
 * 수신자 상한 — **전 트리거 필수** (2026-08-02 §11-5, §9-C6 종결).
 *
 * ⛔ 옛 판정(상태형만 필수)은 "커서 트리거는 대량 적재가 과거 이벤트를 만들지 않는다"에 기댔는데,
 *   §11-4 원장 문이 그 전제를 깼다 — 첫 full sync가 발생 시각 창(3일) 안 구매를 한꺼번에 만든다.
 *   면제 집합을 조건부로 유지하는 것보다 전면 필수가 단순하고, 예외가 없으면 빠질 것도 없다.
 */
export function requiresRecipientCap(_triggerEvent: string): boolean {
  return true;
}

/**
 * 상한을 요구하지 않는 트리거 목록 — 활성화 UPDATE의 원자 조건에 쓴다.
 * §9-C6 종결로 빈 배열(전 트리거 필수). requiresRecipientCap의 여집합 — parity 테스트가 고정한다.
 */
export const CAP_EXEMPT_TRIGGERS: string[] = [];

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
