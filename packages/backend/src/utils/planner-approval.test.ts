/**
 * planner-approval.test.ts — 플래너 월 대행 원장 CT 계약 (★ 2026-08-13 Phase 2 · ★ 2026-10-04 월간 결재 폐지 뒤 남은 축)
 *
 * 고정하는 계약:
 *  ① 차감 멱등키는 회사·월(·회차) 고정이다 — 이 형식이 흔들리면 재승인·더블클릭이 이중 차감이 된다.
 *  ② 대행 단가의 진실은 getCreditCost 하나다(테스트도 숫자를 하드코딩하지 않는다).
 *  ③ 달 축은 KST 기준이다 — UTC로 세면 매월 1일 오전 9시 이전에 이번 달이 "지난 달"이 된다.
 *  ④ 월간 결재(브리핑 · 결재 올리기 · 월 승인 · 결재 문자)는 남아 있지 않다 — 승인은 행사마다(planner-approve).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PLANNER_AGENCY_SOURCE,
  getAgencyCredits,
  buildApprovalIdempotencyKey,
  currentPlanMonth,
} from './planner-approval';
import { getCreditCost } from './ai-credit-calc';

describe('멱등키 — 회사·월 고정', () => {
  it('같은 회사·같은 달은 항상 같은 키, 달이 바뀌면 키도 바뀐다', () => {
    const a = buildApprovalIdempotencyKey('c-1', '2026-09');
    expect(a).toBe('planner:c-1:2026-09');
    expect(buildApprovalIdempotencyKey('c-1', '2026-09')).toBe(a);
    expect(buildApprovalIdempotencyKey('c-1', '2026-10')).not.toBe(a);
    expect(buildApprovalIdempotencyKey('c-2', '2026-09')).not.toBe(a);
  });

  it('회차가 오르면 키가 바뀐다 — 환불 뒤 재승인은 새로 결제된다(회차 0 = 종전 키)', () => {
    expect(buildApprovalIdempotencyKey('c-1', '2026-09', 0)).toBe('planner:c-1:2026-09');
    expect(buildApprovalIdempotencyKey('c-1', '2026-09', 1)).toBe('planner:c-1:2026-09#1');
  });
});

describe('대행 단가 — getCreditCost가 유일 소스', () => {
  it('대행 크레딧은 CREDIT_COST_MAP의 그 source 값이다', () => {
    expect(getAgencyCredits()).toBe(getCreditCost(PLANNER_AGENCY_SOURCE));
    expect(getAgencyCredits()).toBeGreaterThan(0);
  });
});

describe('월 축 — KST 기준', () => {
  it('currentPlanMonth는 YYYY-MM이다', () => {
    expect(currentPlanMonth(new Date('2026-09-15T00:00:00Z'))).toBe('2026-09');
  });

  it('UTC 8월 31일 15:30은 KST로 9월 1일 00:30이다', () => {
    expect(currentPlanMonth(new Date('2026-08-31T15:30:00Z'))).toBe('2026-09');
  });
});

describe('월간 결재 폐지(★ 2026-10-04)', () => {
  it('월 결재 함수(브리핑 · 결재 올리기 · 월 승인 · 결재 문자)가 남아 있지 않다', () => {
    const src = readFileSync(resolve(__dirname, './planner-approval.ts'), 'utf8');
    for (const gone of ['loadMonthlyBrief', 'submitMonthlyBrief', 'approveMonthlyBrief', 'claimApproval', 'buildApprovalNoticeBody', 'computePlanHash']) {
      expect(src, gone).not.toContain(gone);
    }
  });

  it('월 대행 취소의 환불 판정은 실적 집계 한 벌(countMonthWork)을 같은 트랜잭션 클라이언트로 부른다', () => {
    const src = readFileSync(resolve(__dirname, './planner-approval.ts'), 'utf8');
    const cancel = src.slice(src.indexOf('export async function cancelMonthlyApproval'));
    expect(cancel).toContain('countMonthWork(companyId, planMonth, client)');
    const lockIdx = cancel.indexOf('FOR UPDATE');
    const workIdx = cancel.indexOf('countMonthWork(companyId, planMonth, client)');
    const refundIdx = cancel.indexOf('refundCreditWithClient(client');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(workIdx).toBeGreaterThan(lockIdx);
    expect(refundIdx).toBeGreaterThan(workIdx);
  });
});
