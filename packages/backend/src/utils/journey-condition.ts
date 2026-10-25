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

import { normalizeGenderCode } from './journey-condition-fields';

export type ConditionOutcome = 'met' | 'not_met' | 'error';

/**
 * ★ 2026-10-25 여정 구조체크 2차 #15(뿌리 대장 R1) — 조건 칸의 칸 규칙 = 대상 조건 CT(journey-condition-fields)와 같다.
 *   옛: 이 판정기는 고객 행 값을 글자 그대로 비교해 성별 「여성」이 DB 「F」와 영영 안 맞았고(늘 미충족),
 *   대상 조건에 있는 가상 칸(생일 달 · 마지막 구매 뒤 지난 날)은 고객 행에 없어 늘 미충족이었다.
 */
function kstTodayUtcMidnight(now: Date): number {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
}
/** DB date 칸(드라이버 = 프로세스 로컬 자정 Date · 또는 'YYYY-MM-DD' 글자) → 달력 날짜 UTC 자정 ms. 모르면 null. */
function calendarDayMs(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
/** 대상 조건 CT 의 가상 칸 값(없는 칸 = undefined · 판정 불가 = null). */
function virtualFieldValue(field: string, customer: Record<string, any>, now: Date): number | null | undefined {
  if (field === 'birth_month') {
    const md = String(customer.birth_month_day ?? '');
    if (/^\d{2}-\d{2}$/.test(md)) return Number(md.slice(0, 2));
    const bd = calendarDayMs(customer.birth_date);
    return bd == null ? null : new Date(bd).getUTCMonth() + 1;
  }
  if (field === 'days_since_purchase') {
    const rp = calendarDayMs(customer.recent_purchase_date);
    return rp == null ? null : Math.round((kstTodayUtcMidnight(now) - rp) / 86400000);
  }
  return undefined;
}

/**
 * type='customer_field' 평가 — customers 직접 컬럼 우선, 없으면 custom_fields JSONB fallback.
 * 9 operator: == != >= <= > < in not_in is_null not_null.
 * 빈 field / 미지원 operator = false(미충족).
 */
export function evaluateCustomerFieldCondition(
  condJsonb: Record<string, unknown>,
  customer: Record<string, any>,
  now: Date = new Date(),
): boolean {
  const field = String(condJsonb.field || '');
  const operator = String(condJsonb.operator || '');
  const value = (condJsonb as any).value;

  if (!field) return false;  // 빈 field = 확인 불가 = 미충족(발송 안 함)

  // ★ 2026-10-25 #15 — 대상 조건 CT 의 가상 칸(생일 달 · 마지막 구매 뒤 지난 날)은 같은 규칙으로 값을 만든다(판정 불가 = 미충족 · 비어 있음만 참)
  const virt = virtualFieldValue(field, customer, now);
  let cv: any = null;
  if (virt !== undefined) {
    if (virt === null) return operator === 'is_null';
    cv = virt;
  } else if (field in customer) {
    cv = customer[field];
  } else if (customer.custom_fields && typeof customer.custom_fields === 'object' && field in customer.custom_fields) {
    cv = customer.custom_fields[field];
  }

  // ★ 2026-10-25 #15 — 성별 = 표준 코드(F · M)끼리 비교(대상 조건 SQL 과 같은 판정 · 「여성」 = 「F」 = 「female」). 모르는 값 = 미충족.
  if (field === 'gender' && operator !== 'is_null' && operator !== 'not_null') {
    const code = normalizeGenderCode(cv);
    const want = (Array.isArray(value) ? value : [value]).map(normalizeGenderCode);
    if (!code || want.length === 0 || want.some((w) => w === null)) return false;
    if (operator === '==' || operator === 'in') return want.includes(code);
    if (operator === '!=' || operator === 'not_in') return !want.includes(code);
    return false;
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
