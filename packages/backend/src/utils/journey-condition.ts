/**
 * CT: Journey Condition — 조건 평가 순수 로직 (Phase 7, 2026-06-04)
 *
 * 여정 condition step의 customer_field 평가를 담당하는 순수 함수.
 * DB 의존 분기(cdp_event_exists / journey_step_clicked)는 journey-executor가 보유한다(query 필요).
 *
 * 안전 원칙 (Phase 7):
 *   조건을 확인 못 하는 경우(빈 field / 미지원 operator) = 미충족(false) = 발송 안 함.
 *   "확인 불가"를 "보내도 됨"으로 받지 않는다.
 */

export type ConditionOutcome = 'met' | 'not_met' | 'error';

/**
 * type='customer_field' 평가 — customers 직접 컬럼 우선, 없으면 custom_fields JSONB fallback.
 * 9 operator: == != >= <= > < in not_in is_null not_null.
 * 빈 field / 미지원 operator = false(미충족).
 */
export function evaluateCustomerFieldCondition(
  condJsonb: Record<string, unknown>,
  customer: Record<string, any>,
): boolean {
  const field = String(condJsonb.field || '');
  const operator = String(condJsonb.operator || '');
  const value = (condJsonb as any).value;

  if (!field) return false;  // 빈 field = 확인 불가 = 미충족(발송 안 함)

  let cv: any = null;
  if (field in customer) {
    cv = customer[field];
  } else if (customer.custom_fields && typeof customer.custom_fields === 'object' && field in customer.custom_fields) {
    cv = customer.custom_fields[field];
  }

  switch (operator) {
    case '==':       return String(cv ?? '') === String(value ?? '');
    case '!=':       return String(cv ?? '') !== String(value ?? '');
    case '>=':       return Number(cv) >= Number(value);
    case '<=':       return Number(cv) <= Number(value);
    case '>':        return Number(cv) > Number(value);
    case '<':        return Number(cv) < Number(value);
    case 'in':       return Array.isArray(value) && value.map((v) => String(v)).includes(String(cv ?? ''));
    case 'not_in':   return Array.isArray(value) && !value.map((v) => String(v)).includes(String(cv ?? ''));
    case 'is_null':  return cv == null || cv === '';
    case 'not_null': return cv != null && cv !== '';
    default:         return false;  // 미지원 operator = 확인 불가 = 미충족(발송 안 함)
  }
}
