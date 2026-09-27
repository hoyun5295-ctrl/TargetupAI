/**
 * 결제 방식 전환 재확인 (★ 2026-09-27 한줄로 V2 차수 1 BT 묶음 — m009 · m016 · F34)
 *
 * m009 카드결제 확정이 회사 결제 방식을 다시 보지 않았다 → 결제창을 연 뒤 후불로 바뀐 회사에 선불 잔액이 적립됐다.
 *      → 확정 트랜잭션에서 회사 행을 잠그고 선불인지 다시 본다. 아니면 던진다(호출부가 망취소 · 실패 기록).
 * m016 후불 크레딧 충전 승인이 결제 방식을 다시 보지 않았다 → 요청 뒤 선불로 바뀐 회사에 월말 청구분(billed=false) 크레딧이
 *      지급되고, 선불 회사는 정산 발행이 막혀 영구 미청구가 됐다 → 승인 트랜잭션의 회사 잠금에서 후불인지 다시 본다.
 * F34 정산 발행이 「발행 시점」 결제 방식 하나로 판정했다 → 전환 뒤 발행하면 이중 청구(선불 기간을 후불로) · 누락(후불 기간을 선불이라 막음).
 *      → 전환을 이력(audit_logs · 전환과 같은 트랜잭션)으로 남기고, 발행·미리보기·정액·일괄 목록이 「그 기간에 적용된 결제 방식」으로 판정한다.
 *        기간 안에 전환이 있으면 발행을 막고 전환일을 뺀 앞·뒤로 나눠 발행하게 한다
 *        (전환일 하루는 선불·후불 발송이 섞여 있어 발행하지 않는다 · 이중 청구 방지 쪽 · Harold 확인 필요).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const txLog: string[] = [];
const txParams: any[][] = [];
const state: { handler: ((sql: string, p?: any[]) => any) | null } = { handler: null };
const client = {
  query: vi.fn(async (sql: string, p?: any[]) => {
    const s = String(sql).trim();
    txLog.push(s);
    txParams.push(p || []);
    return state.handler ? state.handler(s, p) : { rows: [] };
  }),
  release: vi.fn(),
};
vi.mock('../../config/database', () => ({
  default: { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [] })) },
  pool: { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [] })) },
  query: vi.fn(async () => ({ rows: [] })),
}));
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => undefined) }));

beforeEach(() => { txLog.length = 0; txParams.length = 0; state.handler = null; client.query.mockClear(); });

const isCompanyLock = (s: string) => /FROM companies/.test(s) && /FOR UPDATE/.test(s);

describe('m009 카드결제 확정 = 선불 회사만', () => {
  const approval = { success: true, resultCode: '0000', resultMsg: '정상', tid: 'T1', totPrice: '10000', moid: 'HJ-1-TEST', raw: {} } as any;
  const handler = (billingType: string) => (s: string) => {
    if (s.includes('FROM payments') && s.includes('FOR UPDATE')) {
      return { rows: [{ id: 'p1', company_id: 'c1', user_id: 'u1', amount: '10000', status: 'pending', pg_payment_key: null }] };
    }
    if (isCompanyLock(s)) return { rows: [{ billing_type: billingType }] };
    if (s.startsWith('UPDATE payments')) return { rows: [{ id: 'p1' }] };
    if (s.startsWith('UPDATE companies')) return { rows: [{ balance: 11000 }] };
    return { rows: [] };
  };
  it('선불이면 확정한다 · 회사 잠금 재확인은 결제 행 갱신 전', async () => {
    state.handler = handler('prepaid');
    const { finalizePaymentSuccess } = await import('../payment-processor');
    await finalizePaymentSuccess({ orderId: 'HJ-1-TEST', approval });
    const iLock = txLog.findIndex(isCompanyLock);
    expect(iLock).toBeGreaterThan(-1);
    expect(iLock).toBeLessThan(txLog.findIndex((s) => s.startsWith('UPDATE payments')));
    expect(txLog).toContain('COMMIT');
  });
  it('후불로 바뀌었으면 확정하지 않고 던진다(잔액 적립 없음 · 호출부가 망취소)', async () => {
    state.handler = handler('postpaid');
    const { finalizePaymentSuccess } = await import('../payment-processor');
    await expect(finalizePaymentSuccess({ orderId: 'HJ-1-TEST', approval })).rejects.toThrow(/선불/);
    expect(txLog.some((s) => s.startsWith('UPDATE payments'))).toBe(false);
    expect(txLog.some((s) => s.startsWith('UPDATE companies'))).toBe(false);
    expect(txLog).toContain('ROLLBACK');
    expect(txLog).not.toContain('COMMIT');
  });
});

describe('m016 후불 크레딧 승인 = 후불 회사만', () => {
  const handler = (billingType: string) => (s: string) => {
    if (s.includes('FROM ai_credit_requests') && s.includes('FOR UPDATE')) {
      return { rows: [{ company_id: 'c1', credits: 100, total_amount: 11000, status: 'pending' }] };
    }
    if (isCompanyLock(s)) return { rows: [{ base: 0, purchased: 0, billing_type: billingType }] };
    if (s.startsWith('INSERT INTO ai_credit_transactions')) return { rows: [{ id: 'tx1' }] };
    return { rows: [] };
  };
  it('후불이면 지급한다', async () => {
    state.handler = handler('postpaid');
    const { approveRechargeRequest } = await import('../ai-credit-recharge');
    await approveRechargeRequest({ requestId: 'r1', adminId: 'a1' });
    expect(txLog.some((s) => s.startsWith('UPDATE companies SET ai_credits_purchased'))).toBe(true);
    expect(txLog).toContain('COMMIT');
  });
  it('선불로 바뀌었으면 지급하지 않는다(요청은 대기 그대로 · 관리자가 거절)', async () => {
    state.handler = handler('prepaid');
    const { approveRechargeRequest } = await import('../ai-credit-recharge');
    await expect(approveRechargeRequest({ requestId: 'r1', adminId: 'a1' })).rejects.toMatchObject({ code: 'BILLING_TYPE_CHANGED' });
    expect(txLog.some((s) => s.startsWith('UPDATE companies'))).toBe(false);
    expect(txLog.some((s) => s.startsWith('INSERT INTO ai_credit_transactions'))).toBe(false);
    expect(txLog.some((s) => s.startsWith('UPDATE ai_credit_requests'))).toBe(false);
    expect(txLog).not.toContain('COMMIT');
  });
});

describe('F34 그 기간에 적용된 결제 방식', () => {
  const sw = (day: string, from: string, to: string) => ({ day, at: `${day}T10:00:00+09:00`, from, to });
  const SEP = ['2026-09-01', '2026-09-30'] as const;
  it('전환 이력이 없으면 지금 값', async () => {
    const { resolvePeriodBillingType } = await import('../billing-type-history');
    expect(resolvePeriodBillingType([], ...SEP, 'postpaid')).toEqual({ kind: 'single', type: 'postpaid' });
    expect(resolvePeriodBillingType([], ...SEP, 'prepaid')).toEqual({ kind: 'single', type: 'prepaid' });
  });
  it('기간 뒤 전환 = 그 전환 직전 값(후불→선불이면 후불 · 누락 방지 / 선불→후불이면 선불 · 이중 청구 방지)', async () => {
    const { resolvePeriodBillingType } = await import('../billing-type-history');
    expect(resolvePeriodBillingType([sw('2026-10-03', 'postpaid', 'prepaid')], ...SEP, 'prepaid')).toEqual({ kind: 'single', type: 'postpaid' });
    expect(resolvePeriodBillingType([sw('2026-10-03', 'prepaid', 'postpaid')], ...SEP, 'postpaid')).toEqual({ kind: 'single', type: 'prepaid' });
    // 여러 번 바뀌었으면 기간 뒤 첫 전환의 직전 값
    expect(resolvePeriodBillingType([
      sw('2026-08-10', 'prepaid', 'postpaid'), sw('2026-10-03', 'postpaid', 'prepaid'), sw('2026-10-20', 'prepaid', 'postpaid'),
    ], ...SEP, 'postpaid')).toEqual({ kind: 'single', type: 'postpaid' });
  });
  it('기간 앞 전환만 있으면 지금 값', async () => {
    const { resolvePeriodBillingType } = await import('../billing-type-history');
    expect(resolvePeriodBillingType([sw('2026-08-10', 'prepaid', 'postpaid')], ...SEP, 'postpaid')).toEqual({ kind: 'single', type: 'postpaid' });
  });
  it('기간 안(첫날·끝날 포함)에 전환이 있으면 섞임', async () => {
    const { resolvePeriodBillingType } = await import('../billing-type-history');
    for (const d of ['2026-09-01', '2026-09-15', '2026-09-30']) {
      const r = resolvePeriodBillingType([sw(d, 'prepaid', 'postpaid')], ...SEP, 'postpaid');
      expect(r.kind).toBe('mixed');
      expect((r as any).switches).toHaveLength(1);
    }
  });
  it('값을 알 수 없으면 판정하지 않는다(발행 차단 쪽)', async () => {
    const { resolvePeriodBillingType } = await import('../billing-type-history');
    expect(resolvePeriodBillingType([sw('2026-10-03', '??', 'prepaid')], ...SEP, 'prepaid').kind).toBe('unknown');
    expect(resolvePeriodBillingType([], ...SEP, '').kind).toBe('unknown');
  });
  // ★ Codex BT 1R medium — '2026-09-05 '처럼 공백 붙은 날짜는 문자열 비교로 전환일을 비껴가는데 사용량 SQL은 9월 5일로 읽었다.
  it('기간이 엄격한 YYYY-MM-DD(실제 날짜 · 시작 ≤ 끝)가 아니면 판정하지 않는다', async () => {
    const { resolvePeriodBillingType } = await import('../billing-type-history');
    const s5 = [sw('2026-09-05', 'prepaid', 'postpaid')];
    expect(resolvePeriodBillingType(s5, '2026-09-05 ', '2026-09-30', 'postpaid').kind).toBe('unknown');
    expect(resolvePeriodBillingType([], '2026-02-30', '2026-03-10', 'postpaid').kind).toBe('unknown');
    expect(resolvePeriodBillingType([], '2026-09-30', '2026-09-01', 'postpaid').kind).toBe('unknown');
    expect(resolvePeriodBillingType([], '2026-9-1', '2026-09-30', 'postpaid').kind).toBe('unknown');
    expect(resolvePeriodBillingType(s5, '2026-09-05', '2026-09-30', 'postpaid').kind).toBe('mixed');
  });
  it('이력 읽기: 전환 행만 · 한국 날짜 · 시간순 · 지금 값을 함께 읽는다', async () => {
    const { readPeriodBillingType } = await import('../billing-type-history');
    const calls: Array<[string, any[]]> = [];
    const db = {
      query: vi.fn(async (sql: string, p: any[]) => {
        calls.push([sql, p]);
        if (/FROM companies/.test(sql)) return { rows: [{ billing_type: 'prepaid' }] };
        return { rows: [{ day: '2026-10-03', at: '2026-10-03T01:00:00Z', from_type: 'postpaid', to_type: 'prepaid' }] };
      }),
    };
    const r = await readPeriodBillingType('c1', ...SEP, db as any);
    expect(r).toEqual({ kind: 'single', type: 'postpaid' });
    const hist = calls.find(([s]) => /FROM audit_logs/.test(s))!;
    expect(hist[0]).toContain("AT TIME ZONE 'Asia/Seoul'");
    expect(hist[0]).toMatch(/ORDER BY created_at ASC/);
    expect(hist[0]).toContain("target_type = 'company'");
    expect(hist[1]).toEqual(['c1', 'billing_type_change']);
  });
  it('없는 회사면 알 수 없음', async () => {
    const { readPeriodBillingType } = await import('../billing-type-history');
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    expect((await readPeriodBillingType('c1', ...SEP, db as any)).kind).toBe('unknown');
  });
});

describe('F34 전환 = 결제 방식 갱신과 이력 기록을 한 트랜잭션으로', () => {
  const handler = (cur: string, opts: { auditFails?: boolean } = {}) => (s: string) => {
    if (isCompanyLock(s)) return { rows: cur ? [{ billing_type: cur }] : [] };
    if (s.startsWith('UPDATE companies')) return { rows: [{ id: 'c1', company_name: '에이', billing_type: 'postpaid', balance: '0' }] };
    if (s.startsWith('INSERT INTO audit_logs') && opts.auditFails) throw new Error('insert failed');
    if (/FROM companies/.test(s)) return { rows: [{ id: 'c1', company_name: '에이', billing_type: cur, balance: '0' }] };
    return { rows: [] };
  };
  it('바뀌면 잠금 → 갱신 → 이력 → 커밋', async () => {
    state.handler = handler('prepaid');
    const { switchCompanyBillingType } = await import('../billing-type-history');
    const r = await switchCompanyBillingType({ companyId: 'c1', to: 'postpaid', actorUserId: 'u1', ip: '127.0.0.1', userAgent: 'ua' });
    expect(r).toMatchObject({ found: true, changed: true, from: 'prepaid' });
    const iLock = txLog.findIndex(isCompanyLock);
    const iUpd = txLog.findIndex((s) => s.startsWith('UPDATE companies'));
    const iIns = txLog.findIndex((s) => s.startsWith('INSERT INTO audit_logs'));
    const iCommit = txLog.indexOf('COMMIT');
    expect(txLog[0]).toBe('BEGIN');
    expect(iLock).toBeLessThan(iUpd);
    expect(iUpd).toBeLessThan(iIns);
    expect(iIns).toBeLessThan(iCommit);
    // ★ Codex BT 1R high — 이력 시각 = 잠금을 얻은 뒤 실제 시각(트랜잭션 시작 시각이면 동시 전환 순서가 뒤집히고 자정을 넘긴 대기는 전날로 찍힌다)
    expect(txLog[iIns]).toMatch(/created_at\)\s*VALUES \([^)]*clock_timestamp\(\)\)/);
    const p = txParams[iIns];
    expect(p).toContain('billing_type_change');
    expect(p).toContain('c1');
    expect(p).toContain(JSON.stringify({ from: 'prepaid', to: 'postpaid' }));
  });
  it('같은 값이면 이력을 남기지 않는다(전환 아님)', async () => {
    state.handler = handler('postpaid');
    const { switchCompanyBillingType } = await import('../billing-type-history');
    const r = await switchCompanyBillingType({ companyId: 'c1', to: 'postpaid', actorUserId: 'u1' });
    expect(r).toMatchObject({ found: true, changed: false });
    expect(txLog.some((s) => s.startsWith('INSERT INTO audit_logs'))).toBe(false);
    expect(txLog.some((s) => s.startsWith('UPDATE companies'))).toBe(false);
  });
  it('이력 기록이 실패하면 전환도 하지 않는다(이력 없는 전환 = 청구 판정이 틀린다)', async () => {
    state.handler = handler('prepaid', { auditFails: true });
    const { switchCompanyBillingType } = await import('../billing-type-history');
    await expect(switchCompanyBillingType({ companyId: 'c1', to: 'postpaid', actorUserId: 'u1' })).rejects.toThrow();
    expect(txLog).toContain('ROLLBACK');
    expect(txLog).not.toContain('COMMIT');
  });
  it('없는 회사', async () => {
    state.handler = handler('');
    const { switchCompanyBillingType } = await import('../billing-type-history');
    expect(await switchCompanyBillingType({ companyId: 'c1', to: 'postpaid', actorUserId: 'u1' })).toMatchObject({ found: false });
    expect(txLog).not.toContain('COMMIT');
  });
});

describe('F34 배선', () => {
  const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
  const admin = src('..', 'routes', 'admin.ts');
  const issue = src('billing-issue.ts');
  const billingRoute = src('..', 'routes', 'billing.ts');
  const bulk = src('billing-bulk.ts');
  it('관리자 전환 경로는 전환 CT만 쓴다(직접 UPDATE 없음)', () => {
    const at = admin.indexOf("router.patch('/companies/:id/billing-type'");
    const route = admin.slice(at, admin.indexOf("router.post('/companies/:id/balance-adjust'", at));
    expect(route).toContain('switchCompanyBillingType(');
    expect(route).not.toContain('UPDATE companies SET billing_type');
  });
  it('일반 발행: 기간 판정을 잠금 전(빠른 거절)과 잠금·원장 재검증 뒤 두 번', () => {
    const body = issue.slice(issue.indexOf('export async function issueBilling('), issue.indexOf('export async function issueMinimumChargeBilling('));
    expect(body).not.toContain("String(ledger.companyPriceRow?.billing_type) === 'prepaid'");
    const first = body.indexOf('readPeriodBillingType(company_id, billing_start, billing_end)');
    const lock = body.indexOf('await lockCompanyForBilling(client, company_id);');
    const fp = body.indexOf('const fingerprintNow = await readBillingLedgerFingerprint(company_id, client);');
    const second = body.indexOf('readPeriodBillingType(company_id, billing_start, billing_end, client)');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(lock);
    expect(second).toBeGreaterThan(fp);
    expect(body).toContain("'PREPAID_COMPANY_NOT_BILLABLE'");
  });
  it('정액 발행: 같은 판정(잠금 전 · 잠금 뒤)', () => {
    const body = issue.slice(issue.indexOf('export async function issueMinimumChargeBilling('));
    expect(body).not.toContain("String(co.billing_type) !== 'postpaid'");
    const first = body.indexOf('readPeriodBillingType(company_id, billing_start, billing_end)');
    const lock = body.indexOf('await lockCompanyForBilling(client, company_id);');
    const second = body.indexOf('readPeriodBillingType(company_id, billing_start, billing_end, client)');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(lock);
    expect(second).toBeGreaterThan(lock);
    expect(body).toContain("'MIN_CHARGE_NOT_POSTPAID'");
  });
  it('미리보기: 발행과 같은 판정', () => {
    expect(billingRoute).not.toContain("const billable = company.billing_type !== 'prepaid';");
    expect(billingRoute).toContain('readPeriodBillingType(companyId, startDate, endDate)');
  });
  it('일괄 목록: 그 기간에 후불이었거나 기간 안에 전환한 회사', () => {
    expect(bulk).not.toContain("WHERE c.billing_type = 'postpaid'");
    expect(bulk).toContain("periodPostpaidOrSwitchedSql('c', '$1', '$2')");
    expect(bulk).toContain('WITH ${BILLING_TYPE_SWITCHES_CTE}');
  });
  it('일괄 목록 SQL 조각: 전환 이력 한 번 읽기 · 한국 날짜 · 기간 뒤 첫 전환의 직전 값 · 기간 안 전환', async () => {
    const { periodPostpaidOrSwitchedSql, BILLING_TYPE_SWITCHES_CTE } = await import('../billing-type-history');
    expect(BILLING_TYPE_SWITCHES_CTE).toContain("action = 'billing_type_change'");
    expect(BILLING_TYPE_SWITCHES_CTE).toContain("AT TIME ZONE 'Asia/Seoul'");
    const sql = periodPostpaidOrSwitchedSql('c', '$1', '$2');
    expect(sql).toMatch(/s\.day > \$2::date ORDER BY s\.created_at ASC LIMIT 1/);
    expect(sql).toContain("c.billing_type) = 'postpaid'");
    expect(sql).toContain('s2.day BETWEEN $1::date AND $2::date');
  });
});
