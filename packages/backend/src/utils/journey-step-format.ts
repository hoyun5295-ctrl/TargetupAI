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
  'custom': '지정 조건 매칭 고객',
};

/** "휴면 고객 (60일+) · 추가 조건 2건" — 여정 타겟확인 모달의 추출 조건 라벨. */
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
