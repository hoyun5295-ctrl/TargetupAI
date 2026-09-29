/**
 * journey-step-format.ts — 여정 step 발송 시점·조건을 사람이 읽는 한국어 문구로 (Phase 9 Task 2)
 *   DB import 0 — 순수. 저장된 여정 상세/타임라인 라벨의 단일 출처.
 *   편집 캔버스(생성 직후)는 입력 컨트롤이라 별도, 이 라벨은 저장된 여정 표시용.
 */

export interface StepTimingInput {
  delayMode?: string | null;
  delayHours: number;
  targetHourKst: number | null;
}

/** "트리거 후 3일 뒤 · 09시" / "직전 단계 후 2시간 뒤" / "다음 10시에 발송" / "다음 평일 09시". */
export function formatStepTiming(s: StepTimingInput, isFirst: boolean): string {
  const { delayMode, delayHours, targetHourKst } = s;

  if (delayMode === 'specific_hour' && targetHourKst != null) {
    return `다음 ${targetHourKst}시에 발송`;
  }
  if (delayMode === 'next_business_day') {
    return '다음 평일 09시';
  }

  // relative / relative_at_hour — 일 단위 우선, 24시간 미만이면 시간 단위
  const prefix = isFirst ? '트리거 후' : '직전 단계 후';
  const amount = delayHours % 24 === 0 && delayHours > 0 ? `${delayHours / 24}일` : `${delayHours}시간`;
  let out = `${prefix} ${amount} 뒤`;
  if (delayMode === 'relative_at_hour' && targetHourKst != null) {
    out += ` · ${String(targetHourKst).padStart(2, '0')}시`;
  }
  return out;
}

type ConditionJsonb =
  | { type: 'customer_field'; field: string; operator: string; value: any }
  | { type: 'cdp_event_exists'; event_name: string; within_days: number; presence: 'exists' | 'not_exists' }
  | { type: 'journey_step_clicked'; step_order: number; within_days: number; clicked: boolean };

const FIELD_KO: Record<string, string> = {
  recent_purchase_amount: '최근구매금액',
  total_purchase_amount: '누적구매금액',
  purchase_count: '구매횟수',
  grade: '등급',
  points: '포인트',
  age: '나이',
  gender: '성별',
  region: '지역',
  sms_opt_in: 'SMS수신동의',
  recent_purchase_date: '최근구매일',
  birth_date: '생일',
};
const OP_KO: Record<string, string> = {
  '==': '=', '!=': '≠', '>=': '≥', '<=': '≤', '>': '>', '<': '<',
  in: '포함', not_in: '미포함', is_null: '비어있음', not_null: '값있음',
};
const EVENT_KO: Record<string, string> = {
  purchase: '구매', cart_add: '장바구니', checkout_start: '결제시작',
  reservation_created: '예약', cart_abandon: '장바구니이탈',
};

/** "최근구매금액 ≥ 100,000" / "7일 내 구매 없음" / "Step 1 미클릭". */
export function formatConditionChip(c: ConditionJsonb | null | undefined): string {
  if (!c || !c.type) return '';

  if (c.type === 'customer_field') {
    const f = FIELD_KO[c.field] || c.field;
    if (c.operator === 'is_null' || c.operator === 'not_null') return `${f} ${OP_KO[c.operator]}`;
    const v = typeof c.value === 'number' ? c.value.toLocaleString() : String(c.value ?? '');
    return `${f} ${OP_KO[c.operator] || c.operator} ${v}`;
  }
  if (c.type === 'cdp_event_exists') {
    const ev = EVENT_KO[c.event_name] || c.event_name;
    return `${c.within_days}일 내 ${ev} ${c.presence === 'exists' ? '있음' : '없음'}`;
  }
  if (c.type === 'journey_step_clicked') {
    return `Step ${c.step_order} ${c.clicked ? '클릭' : '미클릭'}`;
  }
  return '';
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-11 여정 [타겟확인]: 트리거를 사람이 읽는 추출 조건 문구로.
//   extractor(selectJourneyTargetCustomerIds) switch의 9종과 1:1 — 신규 트리거 추가 시 여기도 추가.
// ════════════════════════════════════════════════════════════════════

const TRIGGER_KO: Record<string, string> = {
  'customer.created': '신규 가입 고객',
  'cdp.purchase': '구매 발생 고객',
  'cdp.reservation_created': '예약 발생 고객',
  'custom_order_shipped': '배송 시작 고객',
  'customer.dormant': '휴면 고객',
  'cdp.cart_abandon': '장바구니 이탈 고객',
  'customer.birthday_approaching': '생일 임박 고객',
  'customer.points_expiring': '포인트 소멸 임박 고객',
  // ★ 2026-08-08 — §11-5(2026-08-02)로 늘어난 트리거 5종이 이 표에 없어 화면·프롬프트에
  //   `트리거: purchase.first` 같은 저장값이 그대로 나가고 있었다. 라벨 표는 여기 하나다.
  'purchase.first': '첫 구매 고객',
  'customer.dormant_return': '휴면 복귀 고객',
  'customer.cycle_lapsed': '구매 주기를 넘긴 고객',
  'customer.grade_changed': '등급이 올라간 고객',
  'cdp.browse_no_purchase': '상품을 보고 구매하지 않은 고객',
  // ★ 2026-09-30 여정 V2 3차
  'purchase.product': '고른 상품을 산 고객',
  'custom': '지정 조건 매칭 고객',
};

/** ★ 2026-09-30 V2 3차 — 상품 재구매 대상 문장("샤워비누 · 바디워시 외 2개를 산 고객"). 상품이 없으면 빈 문자열. */
export function describeProductPick(triggerFilters: Record<string, any> | null | undefined): string {
  const f = triggerFilters || {};
  const names: string[] = Array.isArray(f.product_names) && f.product_names.length > 0
    ? f.product_names.map((x: unknown) => String(x))
    : (Array.isArray(f.product_keys) ? f.product_keys.map((x: unknown) => String(x)) : []);
  if (names.length === 0) return '';
  const head = names.slice(0, 3).join(' · ');
  return `${head}${names.length > 3 ? ` 외 ${names.length - 3}개` : ''}를 산 고객`;
}

/** "휴면 고객 (60일+) · 추가 조건 2건" — 여정 타겟확인 모달의 추출 조건 라벨. */
/**
 * ★ 2026-09-29 여정 V2 0차 ① — 대상 조건을 사람 말로(계획 모달 "누구에게"). 식별자 · 필드명을 화면에 내지 않는다.
 *   옛: 계획 모달은 트리거 이름만 보여 주고 대상 조건은 "추가 조건 N건"뿐이라, 저장값과 보인 것이 같은지 확인할 수 없었다.
 */
const COND_FIELD_KO: Record<string, string> = {
  grade: '등급', region: '지역', age: '나이', purchase_count: '구매 횟수', total_purchase_amount: '총 구매액',
  sms_opt_in: '수신 동의', store_name: '매장', store_code: '매장 코드', points: '포인트',
};
const COND_OP_KO: Record<string, (v: string) => string> = {
  '==': (v) => `${v}`, '!=': (v) => `${v} 아님`, '>=': (v) => `${v} 이상`, '<=': (v) => `${v} 이하`,
  '>': (v) => `${v} 초과`, '<': (v) => `${v} 미만`, in: (v) => `${v} 중 하나`, not_in: (v) => `${v} 제외`,
  is_null: () => '비어 있음', not_null: () => '있음',
};

export function describeCustomerConditions(conditions: unknown, logic?: unknown): string {
  if (!Array.isArray(conditions) || conditions.length === 0) return '';
  const parts = conditions.map((c: any) => {
    const field = COND_FIELD_KO[String(c?.field || '')] || '알 수 없는 항목';
    const raw = Array.isArray(c?.value) ? c.value.join(' · ') : c?.value === true ? '예' : c?.value === false ? '아니오' : String(c?.value ?? '');
    const op = COND_OP_KO[String(c?.op || '')];
    return op ? `${field} ${op(raw)}` : `${field} ${raw}`;
  });
  return parts.join(logic === 'OR' ? ' 또는 ' : ' · ');
}

/** 계획 모달 한 줄 — "언제 · 누구에게". 조건이 없으면 그 사실을 그대로 말한다(상시 여정은 전 고객). */
export function describeJourneyTarget(triggerEvent: string | null | undefined, triggerFilters: Record<string, any> | null | undefined): string {
  const f = triggerFilters || {};
  const who = describeCustomerConditions(f.customer_conditions, f.logic);
  // ★ 2026-09-30 V2 3차 — 상품 재구매는 고른 상품이 대상의 첫 조건이다(보이는 것 = 저장된 것).
  const product = describeProductPick(f);
  if (product) return who ? `대상: ${product} · ${who}` : `대상: ${product}`;
  // ★ 2026-09-30 V2 3차 — 겹침 해소로 첫 구매 고객을 뺀 주문 완료 여정
  if (f.exclude_first_purchase === true) return who ? `대상: 첫 구매 고객 제외 · ${who}` : '대상: 첫 구매 고객 제외 · 이 사건이 생긴 고객';
  if (who) return `대상: ${who}`;
  return String(triggerEvent || '') === 'custom' ? '대상: 조건 없음 · 전 고객' : '대상: 조건 없음 · 이 사건이 생긴 고객 전부';
}

export function describeJourneyTrigger(
  triggerEvent: string | null | undefined,
  triggerFilters: Record<string, any> | null | undefined,
): string {
  const ev = String(triggerEvent || '');
  const f = triggerFilters || {};
  let base = TRIGGER_KO[ev] || (ev ? `트리거: ${ev}` : '조건 매칭 고객');

  const parts: string[] = [];
  const days = Number(f.days ?? f.dormant_days ?? f.within_days);
  if (Number.isFinite(days) && days > 0) parts.push(`${days}일 기준`);
  const pmin = Number(f.points_min);
  if (Number.isFinite(pmin) && pmin > 0) parts.push(`포인트 ${pmin.toLocaleString()}+`);
  const conds = Array.isArray(f.customer_conditions) ? f.customer_conditions.length : 0;
  if (conds > 0) parts.push(`추가 조건 ${conds}건`);

  return parts.length > 0 ? `${base} (${parts.join(' · ')})` : base;
}
