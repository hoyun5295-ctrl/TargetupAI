/**
 * 최소과금 정액 발행 — 해지·수동 정산 회사 거절 (★2026-09-26 한줄로 V2 F14)
 *
 * 최소과금 일괄 발행은 등록 회사 전부를 발행 CT에 넘기는데, CT가 해지(`companies.status='terminated'`)와
 * 수동 정산(`company_billing_settings.manual_billing`)을 거르지 않았다 — 일반 일괄발급(billing-bulk filterBillableCompanies)은 둘 다 뺀다.
 * 해지한 회사에 매달 정액 청구서가 나가고, 수동 정산 회사는 사람이 따로 청구해 이중 청구가 될 수 있었다.
 *
 * 못 박는 것
 *   1. 결정 자리 = 발행 CT(issueMinimumChargeBilling) — 회사 조회가 상태·수동 정산을 함께 읽고 422로 거절(일괄 라우트는 사유와 함께 건너뜀).
 *   2. 거절은 원장 조회·트랜잭션보다 앞(아무것도 만들지 않는다).
 *   3. 일반 일괄발급과 같은 기준(해지 · 수동 정산).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'billing-issue.ts'), 'utf8');
const fn = src.slice(src.indexOf('export async function issueMinimumChargeBilling('), src.indexOf('const client = await pool.connect();', src.indexOf('export async function issueMinimumChargeBilling(')));
const bulk = readFileSync(join(__dirname, '..', 'billing-bulk.ts'), 'utf8');

describe('최소과금 발행 적격', () => {
  it('회사 조회가 상태와 수동 정산을 함께 읽는다', () => {
    expect(fn).toContain('c.status AS company_status');
    expect(fn).toContain('COALESCE(s.manual_billing, false) AS manual_billing');
  });

  it('해지 회사는 422 MIN_CHARGE_TERMINATED', () => {
    expect(fn).toMatch(/if \(String\(co\.company_status\) === 'terminated'\) \{\s*throw new BillingIssueError\(422, \{[\s\S]{0,200}?code: 'MIN_CHARGE_TERMINATED'/);
  });

  it('수동 정산 회사는 422 MIN_CHARGE_MANUAL_BILLING', () => {
    expect(fn).toMatch(/if \(co\.manual_billing === true\) \{\s*throw new BillingIssueError\(422, \{[\s\S]{0,200}?code: 'MIN_CHARGE_MANUAL_BILLING'/);
  });

  it('거절은 원장 조회보다 앞', () => {
    expect(fn.indexOf("code: 'MIN_CHARGE_TERMINATED'")).toBeLessThan(fn.indexOf('await loadBillingLedger('));
    expect(fn.indexOf("code: 'MIN_CHARGE_MANUAL_BILLING'")).toBeLessThan(fn.indexOf('await loadBillingLedger('));
  });

  it('일반 일괄발급과 같은 기준(해지 · 수동 정산 제외)', () => {
    expect(bulk).toContain("r.manual_billing !== true && r.min_charge_supply == null && r.status !== 'terminated'");
  });
});
