/**
 * 여정 트리거 카탈로그 + 알림톡 템플릿 호환 판정 (2026-07-28)
 *
 * 왜 있나
 *   정보 알림 빌더가 거래 4종만 열어두고 있었다. 그런데 백엔드
 *   `journey-target-extractor.ts`의 switch는 8종을 이미 처리한다 — 못 만든 게 아니라 안 연 것이다.
 *   가입 환영·포인트 소멸 안내 같은 전형적인 정보성 알림톡을 여정으로 만들 수 없었던 원인이 여기다.
 *   (2026-07-27 박성용 접수 "신규회원에게 알림톡 1회 발송"이 이 벽에 부딪힌 건이다)
 *
 * 호환 판정이 왜 필요한가 — 백엔드 실측
 *   알림톡 `#{주문번호}` 같은 **이벤트 변수**는 진입 시점 `entry_event_properties`로만 채워진다.
 *   그 properties를 싣는 트리거는 4종뿐이다:
 *     · cdp.purchase / cdp.reservation_created / custom_order_shipped
 *         → journey-cdp-cursor.ts `resolveCdpCursorEventName` 커서 경로
 *     · cdp.cart_abandon
 *         → journey-trigger-watcher.ts:167 `selectCartAbandonProperties` 전용 경로
 *   나머지 4종(가입·휴면·생일·포인트소멸)은 `enqueueCandidates(j, ids)`로 properties 없이 진입한다.
 *   따라서 이벤트 변수가 든 템플릿을 그 4종에 붙이면 **치환이 빈 채로 발송된다.**
 *
 *   이건 AI 판단에 맡길 문제가 아니라 규칙으로 100% 갈린다. 그래서 순수 함수로 둔다.
 */

/** 진입 시점 이벤트 properties를 실어주는 트리거 — 백엔드 두 경로(커서 + 장바구니 전용)와 1:1. */
export const TRIGGERS_WITH_EVENT_PROPS = [
  'cdp.purchase',
  'purchase.first',
  'customer.dormant_return',
  'cdp.reservation_created',
  'custom_order_shipped',
  'cdp.cart_abandon',
] as const;

export type TriggerGroup = 'tx' | 'lifecycle';

export interface TriggerDef {
  key: string;
  triggerEvent: string;
  /** 여정 템플릿 코드 — 백엔드 journey-builder가 기대하는 값. */
  templateCode: 'repeat' | 'reservation' | 'cart' | 'custom';
  group: TriggerGroup;
  label: string;
  desc: string;
  /** 이 트리거가 채워주는 이벤트 변수(라벨) — 템플릿 호환 판정 기준. */
  eventFields: { key: string; label: string }[];
  /** 트리거 기본 필터 — 백엔드 extractor가 읽는 키만 넣는다(실측 확정). */
  filters: Record<string, any>;
  /** 자사몰 연동이 있어야 발생하는 이벤트인가. */
  gated?: boolean;
  /** 사용자가 값을 넣어야 대상이 정해지는 트리거(기본값을 지어내지 않는다). */
  requiresConfig?: 'points_min';
}

/**
 * 백엔드 `selectJourneyTargetCustomerIds` switch가 실제로 대상을 뽑는 8종.
 * 여기 없는 값은 백엔드가 `default: return []`로 조용히 0건이 된다 — 임의로 늘리지 않는다.
 */
export const TRIGGER_EVENTS: TriggerDef[] = [
  // ── 거래가 일어날 때 (이벤트 properties 있음) ──
  {
    key: 'purchase', triggerEvent: 'cdp.purchase', templateCode: 'repeat', group: 'tx',
    label: '주문 완료', desc: '구매가 일어나면',
    eventFields: [{ key: 'order_no', label: '주문번호' }, { key: 'product_name', label: '상품명' }, { key: 'total_amount', label: '결제금액' }],
    filters: {},
  },
  {
    key: 'reservation', triggerEvent: 'cdp.reservation_created', templateCode: 'reservation', group: 'tx',
    label: '예약 확인', desc: '예약이 등록되면',
    eventFields: [{ key: 'reservation_no', label: '예약번호' }, { key: 'reservation_date', label: '예약일시' }],
    filters: {},
  },
  {
    key: 'cart', triggerEvent: 'cdp.cart_abandon', templateCode: 'cart', group: 'tx',
    label: '장바구니', desc: '장바구니에 담기면',
    eventFields: [{ key: 'product_name', label: '상품명' }],
    filters: { abandon_hours: 24 },
  },
  {
    key: 'shipped', triggerEvent: 'custom_order_shipped', templateCode: 'cart', group: 'tx',
    label: '배송 시작', desc: '배송이 시작되면',
    eventFields: [{ key: 'tracking_no', label: '운송장번호' }, { key: 'carrier', label: '택배사' }],
    filters: {}, gated: true,
  },
  // ★ §11-5 (2026-08-02) — 구매 스트림 분기 2종. 매장(싱크)·자사몰 어느 문이든 같은 트리거가 물린다.
  {
    key: 'first_purchase', triggerEvent: 'purchase.first', templateCode: 'repeat', group: 'tx',
    label: '첫 구매', desc: '생애 첫 구매가 일어나면',
    eventFields: [{ key: 'product_name', label: '상품명' }, { key: 'total_amount', label: '결제금액' }, { key: 'store_name', label: '매장명' }],
    filters: {},
  },
  {
    key: 'dormant_return', triggerEvent: 'customer.dormant_return', templateCode: 'repeat', group: 'tx',
    label: '휴면 복귀', desc: '오래 쉬었다가 다시 구매하면',
    eventFields: [{ key: 'product_name', label: '상품명' }, { key: 'total_amount', label: '결제금액' }, { key: 'store_name', label: '매장명' }],
    filters: { dormant_days: 30 },   // 복귀 판정 기준(직전 구매와의 간격) — 백엔드 기본값과 동일
  },
  {
    key: 'browse', triggerEvent: 'cdp.browse_no_purchase', templateCode: 'cart', group: 'tx',
    label: '조회 후 미구매', desc: '상품을 보고 구매하지 않으면',
    eventFields: [],
    filters: { browse_days: 3 },   // 백엔드 기본값과 동일(journey-target-extractor)
    gated: true,   // product_view는 자사몰 연동이 있어야 발생한다(Codex 지적 수용)
  },
  // ── 고객 상태가 바뀔 때 (이벤트 properties 없음 — 고객 변수만 쓸 수 있다) ──
  {
    key: 'cycle_lapsed', triggerEvent: 'customer.cycle_lapsed', templateCode: 'custom', group: 'lifecycle',
    label: '구매 주기 이탈', desc: '평소 구매 주기를 넘기면',
    eventFields: [],
    filters: { cycle_factor: 1.5 },   // 평균 구매 간격 × 계수 — 백엔드 기본값과 동일
  },
  {
    key: 'signup', triggerEvent: 'customer.created', templateCode: 'custom', group: 'lifecycle',
    label: '신규 가입', desc: '회원이 가입하면',
    eventFields: [],
    filters: {},
  },
  {
    key: 'dormant', triggerEvent: 'customer.dormant', templateCode: 'custom', group: 'lifecycle',
    label: '휴면 전환', desc: '한동안 구매가 없으면',
    eventFields: [],
    filters: { dormant_days: 30 },   // 백엔드 기본값과 동일(journey-target-extractor)
  },
  {
    key: 'birthday', triggerEvent: 'customer.birthday_approaching', templateCode: 'custom', group: 'lifecycle',
    label: '생일 D-7', desc: '생일이 다가오면',
    eventFields: [],
    filters: { days_before: 7 },     // 백엔드 기본값과 동일
  },
  {
    key: 'points', triggerEvent: 'customer.points_expiring', templateCode: 'custom', group: 'lifecycle',
    label: '포인트 소멸 임박', desc: '보유 포인트가 사라지기 전에',
    eventFields: [],
    // points_min 기본값은 백엔드가 0이라 그대로 열면 사실상 전원이 대상이 된다.
    // 숫자를 여기서 지어내지 않고 사용자에게 받는다.
    filters: { inactive_days: 180 }, // 백엔드 기본값과 동일
    requiresConfig: 'points_min',
  },
];

/** 템플릿 내용에서 `#{...}` 변수명을 뽑는다(중괄호 제외). */
export function extractTemplateVariableNames(content: string): string[] {
  const matches = String(content || '').match(/#\{[^}]+\}/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(2, -1).trim()))).filter(Boolean);
}

export interface TriggerCompatResult {
  /** 이 템플릿에 붙일 수 있는 트리거 */
  allowed: TriggerDef[];
  /** 붙일 수 없는 트리거 + 사유 */
  blocked: { trigger: TriggerDef; reason: string }[];
  /** 템플릿에서 발견된 이벤트 변수(라벨) — 사용자에게 이유를 보여줄 때 쓴다 */
  eventVarsFound: string[];
}

/**
 * 템플릿이 쓰는 변수로 붙일 수 있는 트리거를 가른다.
 *
 * - 이벤트 변수(주문번호·예약일시 등)를 쓰면 → 그 변수를 채워주는 트리거만 허용.
 * - 고객 변수(#{이름}·#{등급})만 쓰면 → 8종 전부 허용(고객 필드는 어느 트리거에서나 치환된다).
 *
 * 판정 기준은 **변수 이름이 어떤 트리거의 eventFields 라벨과 일치하는가**다.
 * 회사가 승인받은 템플릿의 변수명은 자유라 완전 일치가 아닐 수 있는데,
 * 그때는 이벤트 변수로 보지 않아 8종이 다 열린다 — 막는 쪽이 아니라 여는 쪽으로 실패한다.
 * (잘못 막으면 쓸 수 있는 조합을 못 쓰게 되고, 잘못 열어도 검토 화면에서 사람이 본다)
 */
export function resolveTriggerCompat(templateContent: string, hasMallIntegration = false): TriggerCompatResult {
  const vars = extractTemplateVariableNames(templateContent);
  const available = TRIGGER_EVENTS.filter((t) => !t.gated || hasMallIntegration);

  // 변수명 → 그 변수를 채워줄 수 있는 트리거 목록.
  // ★ 소유자 판정은 **전체 카탈로그**로 한다(available 아님). gated로 먼저 걸러내면
  //   자사몰 미연동 회사에서 `#{운송장번호}`의 소유자(배송)가 사라져 "이벤트 변수 없음"으로 오판하고
  //   가입·생일 같은 트리거가 전부 열린다 — 값이 빈 채로 발송된다. (Codex 1R 지적, 실결함)
  const varToTriggers = new Map<string, TriggerDef[]>();
  for (const v of vars) {
    const owners = TRIGGER_EVENTS.filter((t) => t.eventFields.some((f) => f.label === v));
    if (owners.length > 0) varToTriggers.set(v, owners);
  }

  const eventVarsFound = Array.from(varToTriggers.keys());
  if (eventVarsFound.length === 0) {
    return { allowed: available, blocked: [], eventVarsFound: [] };
  }

  // 발견된 이벤트 변수를 **전부** 채워줄 수 있는 트리거만 허용한다.
  const allowed = available.filter((t) =>
    eventVarsFound.every((v) => (varToTriggers.get(v) || []).some((o) => o.triggerEvent === t.triggerEvent)),
  );
  const allowedSet = new Set(allowed.map((t) => t.triggerEvent));
  const blocked = available
    .filter((t) => !allowedSet.has(t.triggerEvent))
    .map((t) => ({
      trigger: t,
      reason: TRIGGERS_WITH_EVENT_PROPS.includes(t.triggerEvent as any)
        ? `이 트리거는 ${eventVarsFound.join('·')} 값을 주지 않아요`
        : `이 트리거에는 거래 정보가 없어 ${eventVarsFound.join('·')}가 빈 채로 나가요`,
    }));

  return { allowed, blocked, eventVarsFound };
}
