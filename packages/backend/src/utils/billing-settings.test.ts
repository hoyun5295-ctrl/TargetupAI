/**
 * 계산서 날짜 산식 계약 테스트 (2026-07-28)
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §1-1·§5.
 * 작성일자·자동발급 기한은 돈에 닿는 계산이라 순수 함수 + 계약 테스트로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { computeTaxbillIssueDate, computeTaxbillDueAt } from './billing-settings';

describe('computeTaxbillIssueDate — 작성일자 정책', () => {
  it('말일 정책 = 대상월 말일 (31일 달)', () => {
    expect(computeTaxbillIssueDate('last_day', '2026-07-31')).toBe('2026-07-31');
    // 기간 종료일이 월 중간이어도 "그 달의 말일"이다 — 중간 정산이 아니라 정책이 날짜를 정한다.
    expect(computeTaxbillIssueDate('last_day', '2026-07-26')).toBe('2026-07-31');
  });

  it('말일 정책 = 30일 달이면 30일, 2월이면 28/29일', () => {
    expect(computeTaxbillIssueDate('last_day', '2026-06-15')).toBe('2026-06-30');
    expect(computeTaxbillIssueDate('last_day', '2026-02-10')).toBe('2026-02-28');
    expect(computeTaxbillIssueDate('last_day', '2028-02-10')).toBe('2028-02-29'); // 윤년
  });

  it('익월 1일 정책 — 12월이면 익년 1월 1일', () => {
    expect(computeTaxbillIssueDate('first_day', '2026-07-31')).toBe('2026-08-01');
    expect(computeTaxbillIssueDate('first_day', '2026-12-05')).toBe('2027-01-01');
  });

  it('직접선택은 null — 사람이 지정할 때까지 작성일자가 없다', () => {
    expect(computeTaxbillIssueDate('manual', '2026-07-31')).toBeNull();
  });

  it('형식이 깨진 종료일은 throw — 조용히 이상한 날짜를 만들지 않는다', () => {
    expect(() => computeTaxbillIssueDate('last_day', '2026-7-1')).toThrow();
    expect(() => computeTaxbillIssueDate('first_day', '')).toThrow();
  });
});

describe('computeTaxbillDueAt — 자동발급 시각 = min(발송+3일, 익월 10일 00:00 KST)', () => {
  const KST = 9 * 60 * 60 * 1000;

  it('평시(8/3 발송): +3일이 기한 앞이라 +3일', () => {
    const sent = Date.UTC(2026, 7, 3, 1, 0, 0); // 8/3 10:00 KST
    const due = computeTaxbillDueAt(sent, '2026-07-31');
    expect(due.getTime()).toBe(sent + 3 * 24 * 60 * 60 * 1000);
  });

  it('늦은 정산(8/8 발송): +3일이 8/10을 넘으므로 8/10 00:00 KST로 캡', () => {
    const sent = Date.UTC(2026, 7, 8, 12, 0, 0);
    const due = computeTaxbillDueAt(sent, '2026-07-31');
    expect(due.getTime()).toBe(Date.UTC(2026, 7, 10, 0, 0, 0) - KST);
  });

  it('12월분의 캡은 익년 1/10 00:00 KST', () => {
    const sent = Date.UTC(2027, 0, 9, 0, 0, 0);
    const due = computeTaxbillDueAt(sent, '2026-12-31');
    expect(due.getTime()).toBe(Date.UTC(2027, 0, 10, 0, 0, 0) - KST);
  });
});
