/**
 * AI 크레딧 월 리셋의 음수 상계 계약 (★2026-09-25 한줄로 전수점검 C-08)
 *
 * 왜 있나
 *   부족분(overage_credits)은 선불이 아닌 회사에서 월 정산으로 현금 청구된다(billing-issue.ts 초과사용 합산 ·
 *   선불은 정산 발행 자체가 막힌다). 그런데 월 리셋이 billing_type을 보지 않고 음수 base를 다음 달 기본분에서 빼서
 *   같은 초과분을 두 번 받았다.
 *
 * 못 박는 것
 *   1. 선불(prepaid)은 종전대로 음수를 다음 달 기본분에서 상계한다.
 *   2. 선불이 아니면(postpaid · 값 없음) 기본분을 그대로 준다.
 *   3. 양수 잔액은 어느 쪽이든 이월하지 않는다(종전 동작).
 */
import { describe, it, expect, vi } from 'vitest';
import { applyResetIfNeeded, refundCreditWithClient } from '../ai-credit-tx';

function mockClient() {
  const calls: Array<{ sql: string; params: any[] }> = [];
  return { calls, query: vi.fn(async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rows: [] }; }) };
}

const LAST_MONTH = new Date('2026-08-15T00:00:00+09:00');
const NOW = new Date('2026-09-02T00:00:00+09:00');

async function reset(billingType: string | null, prevBase: number) {
  const client = mockClient();
  const row = { base: prevBase, purchased: 0, reset_at: LAST_MONTH.toISOString(), billing_type: billingType, plan_credits: 100 };
  const out = await applyResetIfNeeded(client, 'c1', row, NOW);
  const upd = client.calls.find((c) => c.sql.includes('UPDATE companies'));
  return { base: out.base, updatedBase: upd?.params[1] };
}

describe('applyResetIfNeeded 음수 상계', () => {
  it('선불은 음수를 다음 달 기본분에서 상계한다', async () => {
    const r = await reset('prepaid', -30);
    expect(r.base).toBe(70);
    expect(r.updatedBase).toBe(70);
  });

  it('후불은 기본분을 그대로 준다(초과분은 정산이 청구)', async () => {
    const r = await reset('postpaid', -30);
    expect(r.base).toBe(100);
    expect(r.updatedBase).toBe(100);
  });

  it('billing_type이 비어 있어도 정산 청구 대상이므로 상계하지 않는다', async () => {
    expect((await reset(null, -30)).base).toBe(100);
  });

  it('양수 잔액은 이월하지 않는다', async () => {
    expect((await reset('prepaid', 40)).base).toBe(100);
    expect((await reset('postpaid', 40)).base).toBe(100);
  });
});

/**
 * ★ 2026-09-25 C-08 (Codex 1R high) — 비선불 초과분 환불은 크레딧이 아니라 부채 취소다.
 *   리셋이 비선불 음수를 상계하지 않게 된 뒤, 옛 환불 규칙(초과분을 purchased로)이 남으면
 *   다음 달 환불에서 부채는 지워지고 구매 크레딧만 생긴다.
 */
function refundClient(state: { base: number; purchased: number; billingType: string | null; resetAt: string; orig: any }) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM companies c') && sql.includes('ai_credits_base_remaining AS base')) {
      return { rows: [{ base: state.base, purchased: state.purchased, cap: null, reset_at: state.resetAt, billing_type: state.billingType, overage_limit: 100, plan_credits: 100 }] };
    }
    if (sql.includes('WHERE idempotency_key = $1 LIMIT 1')) return { rows: [] };
    if (sql.includes("AND type = 'deduct'") && sql.includes('LIMIT 1')) return { rows: [state.orig] };
    if (sql.includes('SUM(amount)')) return { rows: [{ sum: 0 }] };
    if (sql.includes('(created_at, id) <')) return { rows: [] }; // 직전 행 없음 → bucket 규칙
    return { rows: [] };
  });
  return { calls, query };
}

async function refundOverage(billingType: string, sameCycle: boolean) {
  const deductAt = '2026-08-20T03:00:00.000Z';
  const state = {
    // 같은 주기: 아직 리셋 전(음수 base 유지) · 다음 주기: 리셋 뒤(비선불은 100, 선불은 상계된 70)
    base: sameCycle ? -30 : (billingType === 'prepaid' ? 70 : 100),
    purchased: 0,
    billingType,
    resetAt: sameCycle ? '2026-08-01T00:00:00.000Z' : '2026-09-01T00:00:00.000Z',
    orig: { id: 'd1', amount: 30, bucket: 'overage', overage_credits: 30, billed_billing_id: null, created_at: deductAt, balance_base_after: -30, balance_purchased_after: 0 },
  };
  const client = refundClient(state);
  const now = sameCycle ? new Date('2026-08-25T00:00:00+09:00') : new Date('2026-09-10T00:00:00+09:00');
  await refundCreditWithClient(client, { companyId: 'c1', amount: 30, source: 'test', reason: 'r', idempotencyKey: 'rf1', originalIdempotencyKey: 'dk1' }, now);
  const upd = client.calls.find((c) => c.sql.includes('UPDATE companies SET ai_credits_base_remaining'));
  const overageUpd = client.calls.find((c) => c.sql.includes('SET overage_credits'));
  return { base: upd?.params[1], purchased: upd?.params[2], overageAfter: overageUpd?.params[1] };
}

describe('refundCreditWithClient 초과분 환불', () => {
  it('후불 · 다음 달 환불 = 청구 부채만 지우고 크레딧은 늘리지 않는다', async () => {
    const r = await refundOverage('postpaid', false);
    expect(r.overageAfter).toBe(0);
    expect(r.base).toBe(100);
    expect(r.purchased).toBe(0);
  });

  it('후불 · 같은 달 환불 = 음수였던 base를 되메운다(차감 전 상태)', async () => {
    const r = await refundOverage('postpaid', true);
    expect(r.overageAfter).toBe(0);
    expect(r.base).toBe(0);
    expect(r.purchased).toBe(0);
  });

  it('선불은 종전 규칙 그대로(다음 달 상계된 base 70 + purchased 30 = 차감 전 100)', async () => {
    const r = await refundOverage('prepaid', false);
    expect(r.base).toBe(70);
    expect(r.purchased).toBe(30);
  });
});
