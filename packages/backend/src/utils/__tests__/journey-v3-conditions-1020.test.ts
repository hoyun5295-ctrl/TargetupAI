/**
 * 여정 V.3 묶음 2 — 조건 직접 설정 · 추출기 구멍(2026-10-20 · 설계서 §7-3 · §7-4)
 *
 * 못 박는 것:
 *   - 조건이 하나라도 들어왔는데 하나라도 건너뛰면 0명(FALSE) — 옛: 건너뛴 만큼 대상이 넓어지고 전부 빠지면 전 고객
 *   - 「마지막 구매 N일」(days_since_purchase) = KST 오늘 − 최근 구매일(휴면 추출과 같은 칸) · 숫자 비교만
 *   - 「가입 N일」(created_at)은 만들지 않는다
 */
import { describe, it, expect } from 'vitest';
import { applyCustomerConditions, findCustomerConditionIssues, CUSTOMER_CONDITION_FIELDS } from '../journey-target-extractor';

describe('applyCustomerConditions — 닫는 방향', () => {
  it('조건 없음 = null(조건 없는 선택 · 상시 · 사건형 그대로)', () => {
    expect(applyCustomerConditions([], 'AND', [])).toBeNull();
  });
  it('모르는 칸이 섞이면 전체를 0명으로', () => {
    const params: any[] = [];
    expect(applyCustomerConditions([{ field: 'grade', op: '==', value: 'VIP' }, { field: 'nope', op: '==', value: 1 }], 'AND', params)).toBe('FALSE');
  });
  it('모르는 연산자 · 빈 in 목록도 0명', () => {
    expect(applyCustomerConditions([{ field: 'grade', op: '~', value: 'VIP' }], 'AND', [])).toBe('FALSE');
    expect(applyCustomerConditions([{ field: 'grade', op: 'in', value: [] }], 'AND', [])).toBe('FALSE');
  });
  it('전부 빠지면 전 고객이 아니라 0명', () => {
    expect(applyCustomerConditions([{ field: 'nope', op: '==', value: 1 }], 'OR', [])).toBe('FALSE');
  });
  it('정상 조건은 그대로', () => {
    const params: any[] = ['c'];
    expect(applyCustomerConditions([{ field: 'grade', op: '==', value: 'VIP' }], 'AND', params)).toBe('(c.grade = $2)');
    expect(params).toEqual(['c', 'VIP']);
  });
});

describe('마지막 구매 N일', () => {
  it('허용 칸에 있고 「가입 N일」은 없다', () => {
    expect(CUSTOMER_CONDITION_FIELDS).toContain('days_since_purchase');
    expect(CUSTOMER_CONDITION_FIELDS).not.toContain('days_since_signup');
    expect(CUSTOMER_CONDITION_FIELDS).not.toContain('created_at');
  });
  it('KST 오늘 − 최근 구매일 · 정수 파라미터', () => {
    const params: any[] = ['c'];
    const sql = applyCustomerConditions([{ field: 'days_since_purchase', op: '>=', value: '90' }], 'AND', params);
    expect(sql).toBe("((((NOW() AT TIME ZONE 'Asia/Seoul')::date) - c.recent_purchase_date) >= $2::int)");
    expect(params).toEqual(['c', 90]);
  });
  it('숫자 비교만 · 숫자가 아니면 거절', () => {
    expect(findCustomerConditionIssues([{ field: 'days_since_purchase', op: 'in', value: [1] }])).toHaveLength(1);
    expect(findCustomerConditionIssues([{ field: 'days_since_purchase', op: '>=', value: 'abc' }])).toHaveLength(1);
    expect(findCustomerConditionIssues([{ field: 'days_since_purchase', op: '<', value: 30 }])).toHaveLength(0);
    expect(applyCustomerConditions([{ field: 'days_since_purchase', op: 'in', value: [1] }], 'AND', [])).toBe('FALSE');
  });
});
