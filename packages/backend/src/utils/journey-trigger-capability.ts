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
  | 'first_purchase' | 'dormant_return' | 'cycle_lapsed' | 'browse' | 'grade'
  // ★ 2026-09-30 여정 V2 3차 — 상품 재구매(고른 상품을 사면)
  | 'product';

export const TRIGGER_KEYS: TriggerKey[] = [
  'purchase', 'reservation', 'cart', 'shipped',
  'signup', 'dormant', 'birthday', 'points',
  'first_purchase', 'dormant_return', 'cycle_lapsed', 'browse', 'grade',
  'product',
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
  /**
   * ★ 2026-09-30 여정 V2 3차 — 상품 단위 구매가 들어오는가(자사몰 주문 상품 목록 · 매장 원장 상품 코드/이름).
   *   없으면 상품 재구매 여정을 열지 않는다(고를 상품이 없다 = 영영 0건).
   */
  hasProductPurchases?: boolean;
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

    // ★ 2026-09-30 여정 V2 3차 — 상품은 그 회사 현역 문에서 관측된 목록에서만 고른다(정답표 없음).
    f.hasProductPurchases
      ? yes('product', '고른 상품을 사면 발송하고, 같은 상품을 다시 사면 끝냅니다.')
      : no('product', '주문에 상품 정보가 아직 들어오지 않았어요. 자사몰 주문이나 매장 구매에 상품이 실려 오면 열립니다.'),
  ];
}

// ═══════════════════════════════════════════════════════════
// 트리거 레지스트리 — §11-5 (2026-08-02). 15종 + 상시의 계약 단일 출처.
//   §3의 정의 넷(진입/종료/재진입/필요 데이터) 중 코드가 강제할 것을 여기 선언한다.
//   화이트리스트(§5-4)·쿨다운 필수(§9-N1)·종료 신호(§5-1)가 전부 이 표에서 나온다.
//   새 트리거 = 이 표에 한 줄 추가가 유일한 등록 경로다(호출부 분기 금지).
// ═══════════════════════════════════════════════════════════

/**
 * 화면 카탈로그 템플릿 코드 — 프론트 `journey-trigger-catalog.ts`의 `TriggerDef.templateCode`와 같은 집합.
 * (여정 저장 템플릿 7종과는 다른 축이다 — 이건 "이 트리거의 카드가 어느 모양인가"이고 parity가 프론트와 1:1을 고정한다)
 */
export type CatalogTemplateCode = 'repeat' | 'reservation' | 'cart' | 'custom';

/**
 * ★ 2026-09-29 여정 V2 — 생애 지도 레인(설계서 docs/2026-09-29-journey-v2-master-design.md §3).
 *   레인은 이 계약이 소유하고 프론트 카탈로그가 미러한다(parity: 모든 트리거 = 레인 하나).
 *   signup 가입 · first_purchase 첫 구매 · repurchase 재구매 · product 상품 재구매 · winback 이탈·복귀 ·
 *   moment 언제든 생기는 순간 · standing 상시.
 */
export type JourneyLane = 'signup' | 'first_purchase' | 'repurchase' | 'product' | 'winback' | 'moment' | 'standing';

export interface TriggerContract {
  /** journeys.trigger_event 저장값. */
  event: string;
  /** ★ 2026-09-29 V2 — 사람 말 이름(카탈로그 label 미러 · parity). AI 트리거 표 · 지도가 이 이름을 쓴다. */
  label: string;
  /** ★ 2026-09-29 V2 — "언제 시작하나" 한 줄(카탈로그 desc 미러 · parity). AI 트리거 표가 이 문장을 쓴다. */
  desc: string;
  /** ★ 2026-09-29 V2 — 생애 지도 레인. */
  lane: JourneyLane;
  /**
   * ★ 2026-09-29 V2 — 구매 사건 하나로 발화하는 트리거(구매 스트림).
   *   이 집합의 모든 쌍은 overlapEvents(같이 발화) 또는 exclusiveEvents(자격이 배타) 중 한쪽에 선언돼야 한다(parity).
   *   옛: 첫 구매 ↔ 주문 완료 쌍이 어디에도 없어 첫 구매 1건에 두 여정이 시작되는데 화면이 알리지 않았다.
   */
  purchaseStream?: boolean;
  /** ★ 2026-09-29 V2 — 같은 구매 스트림이지만 자격이 배타라 한 사건으로 둘 다 발화하지 않는 트리거(대칭). */
  exclusiveEvents?: string[];
  /**
   * ★ 2026-09-29 V2 — 사건마다 다시 받아야 의미가 있는 트리거(받는 여정으로 쓰이면 재진입이 꺼지면 선이 끊긴다).
   *   프리셋 · AI 초안에서 서버가 allow_reentry를 켜고 쿨다운을 계약 최솟값으로 둔다(AI 출력에 맡기지 않는다).
   */
  reentryRequired?: boolean;
  /** 화면 카탈로그 key. null = 화면 비노출(custom·미구현 전이형). */
  key: TriggerKey | null;
  /**
   * ★ 2026-09-30 여정 V2 3차 — 상품을 골라야 대상이 정해지는 트리거(상품 재구매).
   *   AI 선택 목록 · 1클릭 프리셋 · 다음 수 추천에서 뺀다(상품을 못 고른 채 만들면 영영 0건). 만드는 길 = 상품 고르기 창 하나.
   */
  productPick?: boolean;
  /**
   * ★ 2026-08-08 이어달리기 — 화면 카탈로그 템플릿 코드(프론트 카탈로그 미러, parity 고정).
   * key가 있는 트리거만 갖는다. 추천 카드의 모양과 프리셋 생성의 저장값이 여기서 나온다.
   */
  templateCode?: CatalogTemplateCode;
  /**
   * ★ 2026-08-08 이어달리기 — 이 여정의 목표(exit)가 이뤄진 고객을 받는 다음 트리거.
   * 후속 관계를 새 테이블로 만들지 않는다. exit가 이미 목표 사건을 선언하고 있어 간선은 그 위에 얹힌다.
   * ⛔ exit가 'steps_done'인 트리거에는 달지 않는다 — 전환 사건이 없는데 "전환했어요" 추천은 성립하지 않는다(parity 고정).
   */
  nextEvents?: string[];
  /**
   * ★ 2026-08-08 — 같은 사건 하나로 함께 발화하는 트리거. 여정끼리 밀어내지 않는 것이 설계 결정이므로
   * 막지 않고 화면이 알린다(여정 문서 §4의 겹침 안내 의무). 대칭으로 적는다.
   */
  overlapEvents?: string[];
  /** §3 분류 — transition(상태 전이) / event(사건) / reservation(예약) / standing(상시). */
  cls: 'transition' | 'event' | 'reservation' | 'standing';
  /**
   * 추출·실행 경로가 실제로 있는가. false면 저장·활성화 모두 거부한다 —
   * "만들어지고 켜지는데 영원히 0건"(§2-3이 없애려는 상태)을 등록 단계에서 차단.
   */
  implemented: boolean;
  /** §5-1 종료 신호 — 실행기 배선은 §11-5 C조각. 계약 선언이 먼저다. */
  exit: 'purchase' | 'second_purchase' | 'next_purchase' | 'steps_done' | 'points_used' | 'reservation_closed' | 'product_repurchase';
  /** 재진입 허용 시 최소 쿨다운 일수(§9-N1). 미달이면 활성화 거부. */
  cooldownMinDays?: number;
}

export const TRIGGER_CONTRACTS: TriggerContract[] = [
  // §3-1 상태 전이형
  // ★ 2026-08-08 이어달리기 v1 간선 3 — exit 신호와 의미가 일치하는 것만 잇는다(설계서 §3).
  //   신규가입(exit=purchase, 신규 고객의 구매 = 생애 첫 구매) → 첫 구매
  { event: 'customer.created',              key: 'signup',   label: '신규 가입', desc: '회원이 가입하면', lane: 'signup', cls: 'transition', implemented: true,  exit: 'purchase', templateCode: 'custom', nextEvents: ['purchase.first'] },
  //   첫 구매(exit=second_purchase, 두 번째 구매 = 재구매) → 재구매
  // ★ 2026-09-29 V2 — 첫 구매 1건은 주문 완료(모든 구매)도 함께 발화한다(자격 필터는 첫 구매 · 휴면 복귀 두 종뿐 · journey-trigger-watcher.ts:302).
  //   옛 계약에 이 쌍이 없어 한 번의 첫 구매에 두 여정이 시작되는데 화면이 알리지 않았다. 휴면 복귀와는 자격이 배타다(이전 구매 0건 vs 있음).
  { event: 'purchase.first',                key: 'first_purchase', label: '첫 구매', desc: '생애 첫 구매가 일어나면', lane: 'first_purchase', cls: 'transition', implemented: true, exit: 'second_purchase', templateCode: 'repeat', nextEvents: ['cdp.purchase', 'purchase.product'], purchaseStream: true, overlapEvents: ['cdp.purchase', 'purchase.product'], exclusiveEvents: ['customer.dormant_return'] }, // #2 — 구매 스트림 분기(이전 구매 0건)
  { event: 'cdp.purchase',                  key: 'purchase', label: '주문 완료', desc: '구매가 일어나면', lane: 'repurchase', cls: 'event',      implemented: true,  exit: 'next_purchase', templateCode: 'repeat', nextEvents: ['purchase.product'], purchaseStream: true, reentryRequired: true, overlapEvents: ['customer.dormant_return', 'purchase.first', 'purchase.product'] },     // #3 재구매(현행 구매)
  // ★ 2026-09-30 여정 V2 3차 — 상품 재구매. 고른 상품을 사면 시작 · 같은 상품을 다시 사면 끝(목표 = product_repurchase).
  //   구매 한 건이 주문 완료 · 첫 구매 · 휴면 복귀와 함께 발화한다(겹침). 받는 쪽이므로 사건마다 다시 받는다(reentryRequired).
  { event: 'purchase.product',              key: 'product',  label: '상품 구매', desc: '고른 상품을 사면', lane: 'product', cls: 'event',     implemented: true,  exit: 'product_repurchase', templateCode: 'repeat', productPick: true, purchaseStream: true, reentryRequired: true, overlapEvents: ['cdp.purchase', 'purchase.first', 'customer.dormant_return'] },
  //   휴면(exit=purchase, 휴면 중 구매 = 복귀) → 휴면 복귀
  { event: 'customer.dormant',              key: 'dormant',  label: '휴면 전환', desc: '한동안 구매가 없으면', lane: 'winback', cls: 'transition', implemented: true,  exit: 'purchase', templateCode: 'custom', nextEvents: ['customer.dormant_return'] },
  { event: 'customer.dormant_return',       key: 'dormant_return', label: '휴면 복귀', desc: '오래 쉬었다가 다시 구매하면', lane: 'winback', cls: 'transition', implemented: true, exit: 'steps_done', templateCode: 'repeat', purchaseStream: true, reentryRequired: true, overlapEvents: ['cdp.purchase', 'purchase.product'], exclusiveEvents: ['purchase.first'] },   // #5 — 구매 스트림 분기(직전 구매가 휴면 기준일 이상 과거)
  { event: 'customer.cycle_lapsed',         key: 'cycle_lapsed', label: '구매 주기 이탈', desc: '평소 구매 주기를 넘기면', lane: 'winback', cls: 'transition', implemented: true, exit: 'purchase', cooldownMinDays: 1, templateCode: 'custom' }, // #6
  // #7 — 원장 state와 **서열 비교**(상승만). 쿨다운은 오르내리락 왕복에서 축하가 연달아 나가는 것을 막는 바닥값이고,
  //   진짜 방어는 "상승만 + 같은 급 제외"다(2026-08-02).
  { event: 'customer.grade_changed',        key: 'grade',    label: '등급 상승', desc: '회원 등급이 올라가면', lane: 'moment', cls: 'transition', implemented: true,  exit: 'steps_done', cooldownMinDays: 1, templateCode: 'custom' },
  { event: 'customer.birthday_approaching', key: 'birthday', label: '생일 D-7', desc: '생일이 다가오면', lane: 'moment', cls: 'transition', implemented: true,  exit: 'steps_done', templateCode: 'custom' },
  { event: 'customer.points_expiring',      key: 'points',   label: '포인트 소멸 임박', desc: '보유 포인트가 사라지기 전에', lane: 'moment', cls: 'transition', implemented: true,  exit: 'points_used', templateCode: 'custom' },
  // §3-2 사건 발생형
  { event: 'cdp.cart_abandon',              key: 'cart',     label: '장바구니', desc: '장바구니에 담기면', lane: 'moment', cls: 'event',      implemented: true,  exit: 'purchase', cooldownMinDays: 1, templateCode: 'cart' },  // §9-N1
  { event: 'custom_order_shipped',          key: 'shipped',  label: '배송 시작', desc: '배송이 시작되면', lane: 'moment', cls: 'event',      implemented: true,  exit: 'steps_done', templateCode: 'cart' },
  { event: 'cdp.browse_no_purchase',        key: 'browse',   label: '조회 후 미구매', desc: '상품을 보고 구매하지 않으면', lane: 'moment', cls: 'event',      implemented: true,  exit: 'purchase', cooldownMinDays: 1, templateCode: 'cart' }, // #12
  // §3-3 예약 (원장 §8 선행 — 착수 6번. 커서 경로는 있으나 데이터 문이 없어 capability가 잠근다)
  { event: 'cdp.reservation_created',       key: 'reservation', label: '예약 확인', desc: '예약이 등록되면', lane: 'moment', cls: 'reservation', implemented: true,  exit: 'reservation_closed', templateCode: 'reservation' },
  { event: 'reservation.visit_dn',          key: null,       label: '방문 전 안내', desc: '방문 며칠 전에', lane: 'moment', cls: 'reservation', implemented: false, exit: 'reservation_closed' }, // #14 — 착수 6번
  { event: 'reservation.visit_done',        key: null,       label: '방문 뒤 안내', desc: '방문을 마치면', lane: 'moment', cls: 'reservation', implemented: false, exit: 'steps_done' },         // #15 — 착수 6번
  // 상시(자유 세그먼트) — §3-5: §5-4 게이트 뒤로
  { event: 'custom',                        key: null,       label: '고른 고객에게', desc: '고른 고객에게 한 번', lane: 'standing', cls: 'standing',   implemented: true,  exit: 'steps_done' },
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
 * ★ 2026-08-08 이어달리기 — 이 트리거의 목표가 이뤄진 고객을 받는 다음 트리거들.
 * 모르는 트리거·간선 없는 트리거는 빈 배열(추천이 없을 뿐이다).
 */
export function nextTriggerEvents(triggerEvent: string): string[] {
  return CONTRACT_BY_EVENT.get(triggerEvent)?.nextEvents ?? [];
}

/** ★ 2026-08-08 — 같은 사건 하나로 함께 발화하는 트리거들(겹침 안내의 유일한 근거). */
export function overlapTriggerEvents(triggerEvent: string): string[] {
  return CONTRACT_BY_EVENT.get(triggerEvent)?.overlapEvents ?? [];
}

/** ★ 2026-09-29 V2 — 같은 구매 스트림이지만 자격이 배타인 트리거들(겹침 판정에서 빼는 근거). */
export function exclusiveTriggerEvents(triggerEvent: string): string[] {
  return CONTRACT_BY_EVENT.get(triggerEvent)?.exclusiveEvents ?? [];
}

/** ★ 2026-09-29 V2 — 사람 말 이름. 모르는 값은 빈 문자열(화면이 지어내지 않는다). */
export function triggerLabel(triggerEvent: string): string {
  return CONTRACT_BY_EVENT.get(triggerEvent)?.label ?? '';
}

/** ★ 2026-09-29 V2 — 생애 지도 레인. 모르는 값은 null(지도가 "분류 안 됨"으로 보인다 · 숨기지 않는다). */
export function laneForTrigger(triggerEvent: string): JourneyLane | null {
  return CONTRACT_BY_EVENT.get(triggerEvent)?.lane ?? null;
}

/** 목표 달성으로 끝낼 사건이 있는 종료 신호(steps_done · reservation_closed = 끝까지 보내는 여정). */
const GOAL_EXIT_SIGNALS: ReadonlyArray<TriggerContract['exit']> = ['purchase', 'second_purchase', 'next_purchase', 'points_used', 'product_repurchase'];

/**
 * ★ 2026-09-29 V2(Harold 승인 결정 1) — **새 여정**의 "목표를 이루면 남은 문자 안 보냄" 기본값.
 *   옛: 화면 템플릿 목록(repeat · cart · dormant)이 정했고 같은 트리거도 만드는 길마다 달랐다
 *   (AI 자유 생성 'dormant' = 켜짐 · 프리셋 'custom' = 꺼짐 · 가입은 목록에 없어 늘 꺼짐 → 첫 구매 뒤에도 가입 문자 계속).
 *   이제 계약의 종료 신호 하나가 정한다. 기존 여정 행은 건드리지 않는다(저장값 그대로).
 */
export function defaultGoalExitFor(triggerEvent: string): boolean {
  const exit = CONTRACT_BY_EVENT.get(triggerEvent)?.exit;
  return !!exit && GOAL_EXIT_SIGNALS.includes(exit);
}

/**
 * ★ 2026-09-29 V2(Harold 승인 결정 2) — **새 여정**에 저장할 목표 종류. 포인트 소멸 여정은 "포인트 사용"이 목표다.
 *   옛: goal_kind가 NOT NULL DEFAULT 'purchase'라 계약 파생 분기(journey-executor.ts isGoalConvertedSinceEntry)에
 *   도달하지 못하고 포인트 여정도 "구매"로 끝났다. 기존 행은 건드리지 않는다.
 */
export function goalKindForTrigger(triggerEvent: string): 'purchase' | 'points_used' | 'product' {
  const exit = CONTRACT_BY_EVENT.get(triggerEvent)?.exit;
  // ★ 2026-09-30 V2 3차 — 상품 재구매 여정의 목표 = 같은 상품을 다시 산 것(journey-product CT 판정).
  if (exit === 'product_repurchase') return 'product';
  return exit === 'points_used' ? 'points_used' : 'purchase';
}

/** ★ 2026-09-30 V2 3차 — 상품을 골라야 만들 수 있는 트리거인가(AI 선택 · 1클릭 프리셋 · 다음 수에서 뺀다). */
export function isProductPickTrigger(triggerEvent: string): boolean {
  return CONTRACT_BY_EVENT.get(triggerEvent)?.productPick === true;
}

/**
 * ★ 2026-09-29 V2 — 프리셋 · AI 초안의 재진입 값을 계약이 정한다(AI 출력에 맡기지 않는다).
 *   사건마다 받아야 하는 트리거(reentryRequired)는 "다음 사건 때 다시 받기"를 켜고 쿨다운 = 계약 최솟값.
 *   그 밖은 null = 기존 규칙(AI 제안 + 활성화 게이트의 최소 쿨다운)을 그대로 둔다.
 */
export function contractReentryPolicy(triggerEvent: string): { allowReentry: true; cooldownDays: number } | null {
  const c = CONTRACT_BY_EVENT.get(triggerEvent);
  if (!c?.reentryRequired) return null;
  return { allowReentry: true, cooldownDays: c.cooldownMinDays ?? 0 };
}

/**
 * ★ 2026-09-29 V2 0차 ⑧ — AI 여정 설계가 고를 수 있는 시작 사건(레지스트리 파생 · 단일 출처).
 *   옛: 프롬프트에 7종을 손으로 적어 첫 구매 · 휴면 복귀 · 구매 주기 이탈 · 등급 · 포인트 · 조회 후 미구매 · 배송에 문장이 닿지 않았다.
 *   예약은 정보 알림 축으로 빠졌다(여정 문서 §4) → 제외. 프롬프트와 서버 검증이 이 한 목록을 같이 쓴다.
 */
export function aiSelectableTriggerEvents(): string[] {
  // ★ 2026-09-30 V2 3차 — 상품을 골라야 하는 트리거는 AI 가 고르지 않는다(상품은 담당자가 관측 목록에서 고른다).
  return TRIGGER_CONTRACTS.filter((c) => c.implemented && c.cls !== 'reservation' && !c.productPick).map((c) => c.event);
}

/** AI 프롬프트용 시작 사건 표 — "- 값: 이름 (언제)" 한 줄씩. */
export function formatTriggerMenuForAi(): string {
  return TRIGGER_CONTRACTS
    .filter((c) => c.implemented && c.cls !== 'reservation' && !c.productPick)
    .map((c) => `   - ${c.event}: ${c.label} (${c.desc})`)
    .join('\n');
}

/**
 * ★ 2026-09-29 V2 (회의론자 0차 검증 2-가) — 저장 템플릿 코드(journeys.template_code)를 **트리거에서 파생**한다.
 *   옛: AI 가 templateCode 와 triggerEvent 를 따로 냈다. 화면이 트리거를 저장하기 시작하면(0차 ①) 둘이 어긋난 채 저장돼
 *   template_code 로 여정 종류를 세는 곳(기회 엔진 · 목록 아이콘)이 엉뚱하게 판정한다. 저장 템플릿 7종 + 포인트.
 */
export function storageTemplateCodeFor(triggerEvent: string):
  'onboarding' | 'repeat' | 'dormant' | 'points_expiring' | 'cart' | 'birthday' | 'reservation' | 'custom' {
  switch (triggerEvent) {
    case 'customer.created': return 'onboarding';
    case 'purchase.first':
    case 'cdp.purchase':
    case 'customer.dormant_return':
    case 'purchase.product': return 'repeat';
    case 'customer.dormant': return 'dormant';
    case 'customer.points_expiring': return 'points_expiring';
    case 'cdp.cart_abandon': return 'cart';
    case 'customer.birthday_approaching': return 'birthday';
    case 'cdp.reservation_created': return 'reservation';
    default: return 'custom';
  }
}

/** ★ 2026-08-08 — 화면 카탈로그 템플릿 코드. 없으면 null(화면 비노출 트리거). */
export function triggerTemplateCode(triggerEvent: string): CatalogTemplateCode | null {
  return CONTRACT_BY_EVENT.get(triggerEvent)?.templateCode ?? null;
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

/**
 * ★ 2026-09-30 여정 V2 2차 — 시작 사건(trigger_event) 기준 가능 여부. toAvailabilityMap 은 트리거 키 기준이다.
 * 키가 없는 사건(상시 · 구현 전 예약)은 넣지 않는다(= 판정 없음 · 호출부가 막지 않는다).
 */
export function availabilityByEvent(list: TriggerAvailability[]): Record<string, { available: boolean; reason: string }> {
  const byKey = toAvailabilityMap(list);
  const out: Record<string, { available: boolean; reason: string }> = {};
  for (const c of TRIGGER_CONTRACTS) {
    if (c.key && byKey[c.key]) out[c.event] = { ...byKey[c.key] };
  }
  return out;
}
