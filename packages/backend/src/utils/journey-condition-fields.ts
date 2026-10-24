/**
 * journey-condition-fields.ts — 여정 대상 조건 칸 한 곳 (★ 2026-10-23 여정 결함 0)
 *
 * 왜 있나
 *   같은 칸 목록이 다섯 곳에 손으로 적혀 있었다: 추출기 허용 목록 · 사람 말 이름표 · 잘못된 칸 안내 문구 · AI 생성 프롬프트 · 화면.
 *   AI 프롬프트는 8칸만 알아서 「포인트 1만 이상」 · 「90일 안 산」 조건을 못 냈고, 성별 칸은 어디에도 없어 「여성 고객」이 빠졌다.
 *   → 서버 쪽은 이 표 하나에서 전부 나온다. 화면 COND_FIELDS 는 짝 시험(journey-v3-cond-fields-1020)이 같은 키를 고정한다.
 */
import { getGenderVariants } from './normalize';

export const CUSTOMER_CONDITION_SPECS = [
  { key: 'grade', label: '등급', ai: '등급 (값 = 회사가 쓰는 등급 이름 그대로)' },
  { key: 'region', label: '지역', ai: '지역 (예: 서울)' },
  { key: 'age', label: '나이', ai: '나이 (숫자)' },
  { key: 'gender', label: '성별', ai: '성별 (값 = "F" 여성 · "M" 남성 · 연산자 == 또는 !=)' },
  { key: 'birth_month', label: '생일 달', ai: '생일 달 (1~12 숫자 · 예: 이번 달 생일 = 이번 달 숫자)' },
  { key: 'purchase_count', label: '구매 횟수', ai: '구매 횟수 (숫자)' },
  { key: 'total_purchase_amount', label: '총 구매액', ai: '총 구매액 (원 · 숫자)' },
  { key: 'points', label: '포인트', ai: '포인트 (숫자)' },
  { key: 'days_since_purchase', label: '마지막 구매 뒤 지난 날', ai: '마지막 구매 뒤 지난 날 (일 · 숫자 · 연산자 >= <= > < 만)' },
  { key: 'store_name', label: '매장', ai: '매장명' },
  { key: 'store_code', label: '매장 코드', ai: '매장 코드' },
  { key: 'sms_opt_in', label: '수신 동의', ai: '문자 수신 동의 (true / false)' },
] as const;

export type CustomerConditionField = (typeof CUSTOMER_CONDITION_SPECS)[number]['key'];

export const CUSTOMER_CONDITION_FIELDS: readonly CustomerConditionField[] = CUSTOMER_CONDITION_SPECS.map((s) => s.key);

export function conditionFieldLabel(key: string): string | null {
  return CUSTOMER_CONDITION_SPECS.find((s) => s.key === key)?.label ?? null;
}

/** 잘못된 칸 안내에 붙는 「쓸 수 있는 칸」 목록(사람 말). */
export function conditionFieldLabelList(): string {
  return CUSTOMER_CONDITION_SPECS.map((s) => s.label).join(' · ');
}

/** AI 프롬프트의 허용 칸 메뉴(생성 · 대화형 수정 공용). 목록 밖 칸은 저장되지 않는다. */
export function formatConditionMenuForAi(): string {
  return CUSTOMER_CONDITION_SPECS.map((s) => `     · ${s.key}: ${s.ai}`).join('\n');
}

/** 성별 값을 표준 코드로(F · M). 「여성」 · 「female」 · 「2」 같은 표기도 같은 코드. 모르면 null. */
export function normalizeGenderCode(value: unknown): 'M' | 'F' | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (getGenderVariants('F').includes(v)) return 'F';
  if (getGenderVariants('M').includes(v)) return 'M';
  return null;
}

/** 생일 달 SQL(1~12) — 월일 칸(MM-DD) 우선, 없으면 생일 날짜. 생일 여정(customer.birthday_approaching)과 같은 두 칸을 읽는다. */
export const BIRTH_MONTH_SQL = `COALESCE(CASE WHEN c.birth_month_day ~ '^[0-9]{2}-[0-9]{2}$' THEN substr(c.birth_month_day, 1, 2)::int END, EXTRACT(MONTH FROM c.birth_date)::int)`;
