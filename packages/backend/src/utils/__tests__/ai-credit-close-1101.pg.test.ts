// replaces: none
/**
 * 크레딧 컨트롤타워 — 실 PostgreSQL 판(★ 2026-11-01 설계서 docs/2026-11-01-credit-control-tower-design.md §5 4·5판 · §8)
 *
 * 운영 문장을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본 · 대기 DDL C90-DDL-1 을 사본에 얹는다).
 * 시각: JS 시각만 가짜로 고정한다(Date 만 · 타이머는 진짜 — pg 연결이 타이머를 쓴다). 줄 시각은 SQL 이 경계로 정하거나 시험이 넣는다.
 * 기대값 = 설계서 손 계산 예(이에스 654 → 300 · P14 525 · Codex R3-1 (−100, 100) · R3-2 465).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';

const sendSystemAlert = vi.fn(async () => 0);
const passAlerts = vi.fn(async (_o: any) => 0);   // ★ 1101 §16-6 — 주기 패스 경보 = 한 주기 1통
vi.mock('../system-alert', () => ({ sendSystemAlert: (...a: any[]) => (sendSystemAlert as any)(...a), alertPassFailures: (...a: any[]) => (passAlerts as any)(...a) }));

import { loadCreditRow, applyResetIfNeeded, refundCreditWithClient, applyTrialStart, expireTrialLeftover, CreditLedgerConflictError, _deductWithClient } from '../ai-credit-tx';
import { recordPlanChange } from '../plan-change-log';
import { monthCredits, creditMonthsOpenInPeriod, grantedInMonth } from '../ai-credit-month';

const PLAN: Record<string, string> = {};
const CREDITS: Record<string, number> = { FREE: 0, TRIAL: 750, STARTER: 300, BASIC: 750 };
const PRICE: Record<string, number> = { FREE: 0, TRIAL: 0, STARTER: 150000, BASIC: 350000 };

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C90-DDL-1'));
  for (const code of Object.keys(CREDITS)) {
    const id = randomUUID();
    PLAN[code] = id;
    await insertMinimalRow(pool, 'plans', { id, plan_code: code, plan_name: code, monthly_price: PRICE[code], ai_credits_per_month: CREDITS[code], is_active: true });
  }
});

beforeEach(() => {
  sendSystemAlert.mockClear();
  passAlerts.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  return new Date(iso);
};

async function company(o: { plan: string; billing: 'prepaid' | 'postpaid'; base: number; purchased?: number; resetAt: string | null }): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', {
    id, plan_id: PLAN[o.plan], billing_type: o.billing, ai_credits_base_remaining: o.base,
    ai_credits_purchased: o.purchased ?? 0, ai_credits_reset_at: o.resetAt,
  });
  return id;
}

async function history(companyId: string, effective: string, from: string | null, to: string): Promise<void> {
  await insertMinimalRow(pool, 'company_plan_changes', {
    company_id: companyId, from_plan_id: from ? PLAN[from] : null, to_plan_id: PLAN[to], from_plan_code: from, to_plan_code: to,
    from_monthly_price: from ? PRICE[from] : null, to_monthly_price: PRICE[to], effective_date: effective, change_type: from ? 'admin' : 'initial',
  });
}

async function ledger(companyId: string, r: { type: string; amount: number; key: string; base: number; purchased: number; overage?: number; createdAt: string; bucket?: string; noSeq?: boolean; id?: string }): Promise<void> {
  await query(
    `INSERT INTO ai_credit_transactions (id, company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, overage_credits, created_at, seq)
     VALUES ($10::uuid, $1::uuid, $2, $3, $4, 'test', $5, $6, $7, $8, $9::timestamptz, ${r.noSeq ? 'NULL' : `nextval('ai_credit_tx_seq')`})`,
    [companyId, r.type, r.amount, r.bucket ?? 'base', r.key, r.base, r.purchased, r.overage ?? 0, r.createdAt, r.id ?? randomUUID()],
  );
}

const rowsOf = async (companyId: string) => (await query(
  `SELECT type, amount, overage_credits, balance_base_after, balance_purchased_after, idempotency_key,
          to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS.US') AS kst
     FROM ai_credit_transactions WHERE company_id = $1::uuid AND source <> 'test' ORDER BY seq`,
  [companyId],
)).rows;
const co = async (companyId: string) => (await query(
  `SELECT ai_credits_base_remaining AS base, ai_credits_purchased AS purchased,
          to_char(ai_credits_reset_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS reset_kst
     FROM companies WHERE id = $1::uuid`,
  [companyId],
)).rows[0];

async function inTx<T>(work: (c: any) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await work(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

describe('월 마감(C2) — 한 달씩 · 경계 시각 · 원장 먼저', () => {
  it('이에스(선불 · 10월 남은 654 · 스타터) → 10월 말일 끝 소멸 −654 · 11월 1일 0시 지급 +300 · 리셋 시각 11월 1일 0시', async () => {
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: 654, resetAt: '2026-10-01 09:19:00+09' });
    await history(id, '2026-10-04', null, 'STARTER');
    const now = at('2026-11-02T10:00:00+09:00');
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), now));
    expect(await rowsOf(id)).toEqual([
      { type: 'expire', amount: -654, overage_credits: 0, balance_base_after: 0, balance_purchased_after: 0, idempotency_key: `expire:${id}:202610`, kst: '2026-10-31 23:59:59.999999' },
      { type: 'reset', amount: 300, overage_credits: 0, balance_base_after: 300, balance_purchased_after: 0, idempotency_key: `reset:${id}:202611`, kst: '2026-11-01 00:00:00.000000' },
    ]);
    expect(await co(id)).toEqual({ base: 300, purchased: 0, reset_kst: '2026-11-01 00:00:00' });
  });

  it('후불 −100 · 그 주기 차감 초과 40 → 맞춤 60(10월 날짜) · 정리 +100 · 11월 지급', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: -100, resetAt: '2026-10-01 00:00:00+09' });
    await history(id, '2026-09-01', null, 'STARTER');
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:202610`, base: 300, purchased: 0, createdAt: '2026-10-01 00:00:00+09' });
    await ledger(id, { type: 'deduct', amount: 400, key: `t-d1:${id}`, base: -100, purchased: 0, overage: 40, createdAt: '2026-10-20 10:00:00+09', bucket: 'overage' });
    const now = at('2026-11-01T00:05:00+09:00');
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), now));
    const r = await rowsOf(id);
    expect(r.map((x: any) => [x.type, x.amount, x.overage_credits, x.balance_base_after, x.kst])).toEqual([
      ['deduct', 0, 60, -100, '2026-10-31 23:59:59.999999'],
      ['expire', 100, 0, 0, '2026-10-31 23:59:59.999999'],
      ['reset', 300, 0, 300, '2026-11-01 00:00:00.000000'],
    ]);
    // 10월 청구 기간(10/1 ~ 10/31)에 맞춤 줄이 들어간다 · 리셋 시각 ≥ 11/1 = 10월 마감 끝
    expect(await creditMonthsOpenInPeriod(pool as any, id, '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('밀린 두 달은 한 달씩(선불 −30 · 9월 리셋 → 11월): 10월 지급 · 10월 말 소멸 · 11월 지급', async () => {
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: -30, resetAt: '2026-09-01 00:00:00+09' });
    await history(id, '2026-08-01', null, 'STARTER');
    const now = at('2026-11-03T09:00:00+09:00');
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), now));
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount, x.balance_base_after, x.idempotency_key.split(':')[2], x.kst.slice(0, 10)])).toEqual([
      ['reset', 300, 270, '202610', '2026-10-01'],
      ['expire', -270, 0, '202610', '2026-10-31'],
      ['reset', 300, 300, '202611', '2026-11-01'],
    ]);
  });

  it('리셋 시각 없는데 기본분 ≠ 0 = 원장으로 설명 못 하는 잔액 → 던진다(줄 0)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: 50, resetAt: null });
    const now = at('2026-11-02T10:00:00+09:00');
    await expect(inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), now))).rejects.toBeInstanceOf(CreditLedgerConflictError);
    expect(await rowsOf(id)).toEqual([]);
  });

  it('첫 지급(리셋 시각 없음)의 달 키 · 줄 시각 · 리셋 시각 = 판정 시각 하나 → 다음 마감이 같은 키로 막히지 않는다(Codex 구현 1R-3)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: 0, resetAt: null });
    await history(id, '2026-11-01', null, 'STARTER');
    // JS 판정 시각(2031-03-01) ≠ DB 거래 시작 시각(지금) = 자정을 끼운 거래와 같은 꼴
    const first = at('2031-03-01T00:00:01+09:00');
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), first));
    // 주기 시작 줄 시각 = 리셋 시각 = 판정 시각(키의 달과 같다)
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount, x.idempotency_key.split(':')[2], x.kst])).toEqual([['reset', 300, '203103', '2031-03-01 00:00:01.000000']]);
    expect((await co(id)).reset_kst).toBe('2031-03-01 00:00:01');
    const next = at('2031-03-02T10:00:00+09:00');
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), next));
    expect((await rowsOf(id)).length).toBe(1);
  });

  it('마감 뒤 차감 줄 시각 = 판정 시각(그 줄이 든 주기 안 · DB 시계가 아니다 · Codex 구현 2R-1 · 4R-1)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: 300, resetAt: '2031-02-01 00:00:00+09' });
    await history(id, '2026-11-01', null, 'STARTER');
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:203102`, base: 300, purchased: 0, createdAt: '2031-02-01 00:00:00+09' });
    const now = at('2031-03-01T00:00:05+09:00');
    await inTx(async (c) => _deductWithClient(c, { companyId: id, cost: 50, source: 'test-deduct', idempotencyKey: `t-d:${id}` }, now, { manageTx: false }));
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount, x.kst])).toEqual([
      ['expire', -300, '2031-02-28 23:59:59.999999'],
      ['reset', 300, '2031-03-01 00:00:00.000000'],
      ['deduct', 50, '2031-03-01 00:00:05.000000'],
    ]);
  });

  it('마감 전 달이 든 청구 기간 = 열린 달로 보인다(발행 확인)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: 0, resetAt: '2026-10-20 00:00:00+09' });
    expect(await creditMonthsOpenInPeriod(pool as any, id, '2026-10-01', '2026-10-31')).toEqual(['2026-10']);
    expect(await creditMonthsOpenInPeriod(pool as any, id, '2026-10-01', '2026-10-15')).toEqual([]);   // 말일이 안 든 기간
  });
});

describe('요금제 변경(C4) — 그 달 권리 − 원장 지급 합', () => {
  it('P14 · 11/16 스타터 → 베이직(11월 지급 300) = +225 → 그 달 합 525', async () => {
    const id = await company({ plan: 'BASIC', billing: 'prepaid', base: 300, resetAt: '2026-11-01 00:00:00+09' });
    await history(id, '2026-10-04', null, 'STARTER');
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:202611`, base: 300, purchased: 0, createdAt: '2026-11-01 00:00:00+09' });
    at('2026-11-16T10:00:00+09:00');
    const out = await inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.BASIC, changeType: 'auto', reason: 'test' }));
    expect(out.creditAdjust).toMatchObject({ applied: true, delta: 225, entitlement: 525, granted: 300, baseAfter: 525 });
    expect((await co(id)).base).toBe(525);
  });

  it('일할 줄의 달 = 키에 박은 달(이력 행을 지워도 그 달 지급 합에 남는다 · 옛 키 꼴은 줄 시각의 달 · Codex 구현 2R-2)', async () => {
    const id = await company({ plan: 'BASIC', billing: 'prepaid', base: 300, resetAt: '2026-11-01 00:00:00+09' });
    await history(id, '2026-10-04', null, 'STARTER');
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:202611`, base: 300, purchased: 0, createdAt: '2026-11-01 00:00:00+09' });
    at('2026-11-16T10:00:00+09:00');
    await inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.BASIC, changeType: 'auto', reason: 'test' }));
    const pr = (await rowsOf(id)).find((x: any) => x.type === 'plan_prorate');
    expect(pr.idempotency_key).toMatch(new RegExp(`^plan-prorate:202611:[0-9a-f-]{36}$`));
    await query(`DELETE FROM company_plan_changes WHERE company_id = $1::uuid AND to_plan_code = 'BASIC'`, [id]);
    expect(await grantedInMonth(pool as any, id, '2026-11')).toBe(525);
    // 옛 키 꼴(1026 일할 = plan-prorate:이력 id) = 줄 시각의 달
    await ledger(id, { type: 'plan_prorate', amount: 10, key: `plan-prorate:${randomUUID()}`, base: 535, purchased: 0, createdAt: '2026-11-03 10:00:00+09' });
    await ledger(id, { type: 'plan_prorate', amount: 7, key: `plan-prorate:${randomUUID()}`, base: 542, purchased: 0, createdAt: '2026-10-20 10:00:00+09' });
    expect(await grantedInMonth(pool as any, id, '2026-11')).toBe(535);
  });

  it('이력 없는 회사의 첫 변경 = 바꾸기 전 요금제 힌트로 첫 이력 from_plan(R3-2 · 465)', async () => {
    const id = await company({ plan: 'BASIC', billing: 'prepaid', base: 300, resetAt: '2026-11-01 00:00:00+09' });
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:202611`, base: 300, purchased: 0, createdAt: '2026-11-01 00:00:00+09' });
    at('2026-11-20T10:00:00+09:00');
    const out = await inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.BASIC, changeType: 'auto', reason: 'test', prevPlanIdHint: PLAN.STARTER }));
    // 1~19 스타터 19 × 300 = 5,700 · 20~30 베이직 11 × 750 = 8,250 → 13,950 ÷ 30 = 465 · 이미 300 → +165
    expect(out.creditAdjust).toMatchObject({ applied: true, delta: 165, entitlement: 465 });
  });

  it('제시뉴욕 10/26 미가입 → 스타터(후불 · 구매 140) = 300 × 6/31 = 58 · 구매분 그대로', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: 0, purchased: 140, resetAt: '2026-10-24 04:00:00+09' });
    await history(id, '2026-09-01', null, 'FREE');
    at('2026-10-26T12:00:00+09:00');
    const out = await inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.STARTER, changeType: 'auto', reason: 'test' }));
    expect(out).toMatchObject({ recorded: true, changeType: 'upgrade', creditAdjust: { applied: true, delta: 58, entitlement: 58, granted: 0, baseAfter: 58 } });
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount, x.balance_base_after, x.balance_purchased_after])).toEqual([['plan_prorate', 58, 58, 140]]);
    expect(await co(id)).toMatchObject({ base: 58, purchased: 140 });
  });

  it('마감 전 달에 바꾸면 마감 먼저(그 달 지급 = 바뀌기 전 시간표) → 차이 · 후불은 0 지급도 줄', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: 25, resetAt: '2026-09-30 09:00:00+09' });
    await history(id, '2026-09-01', null, 'FREE');
    at('2026-10-26T12:00:00+09:00');
    await inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.STARTER, changeType: 'auto', reason: 'test' }));
    // 9월 마감: 양수 25 소멸 · 10월 E(미가입) 0 줄 → 이력 → 10월 E 58 − 지급 0
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount, x.balance_base_after, x.kst])).toEqual([
      ['expire', -25, 0, '2026-09-30 23:59:59.999999'],
      ['reset', 0, 0, '2026-10-01 00:00:00.000000'],
      ['plan_prorate', 58, 58, expect.any(String)],   // 일할 줄 시각 = DB 지금(시험은 JS 시각만 가짜)
    ]);
  });

  it('잠금 뒤 마감 전 복구(선불 · 11/4 스타터 → 미가입 · 11/10 베이직) = 11월 지급 30(바뀌기 전) + 차이 525 → 그 달 합 555', async () => {
    const id = await company({ plan: 'FREE', billing: 'prepaid', base: 300, resetAt: '2026-10-05 00:00:00+09' });
    await history(id, '2026-10-04', null, 'STARTER');
    await history(id, '2026-11-04', 'STARTER', 'FREE');
    at('2026-11-10T12:00:00+09:00');
    const out = await inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.BASIC, changeType: 'auto', reason: 'test' }));
    // 마감 시 11월 E = 300 × 3/30 = 30 · 바꾼 뒤 E = (300 × 3 + 750 × 21) ÷ 30 = 555 → +525
    expect(out.creditAdjust).toMatchObject({ applied: true, delta: 525, entitlement: 555, granted: 30, baseAfter: 555 });
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount, x.balance_base_after])).toEqual([
      ['expire', -300, 0], ['reset', 30, 30], ['plan_prorate', 525, 555],
    ]);
  });

  it('선불 잠김(미가입 · 넘긴 음수 −30) → 12/10 베이직 다시 열기 = 750 × 22/31 = 532 → 502', async () => {
    const id = await company({ plan: 'FREE', billing: 'prepaid', base: -30, resetAt: '2026-12-01 00:00:00+09' });
    await history(id, '2026-10-04', null, 'BASIC');
    await history(id, '2026-11-04', 'BASIC', 'FREE');
    at('2026-12-10T12:00:00+09:00');
    const out = await inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.BASIC, changeType: 'auto', reason: 'test' }));
    expect(out.creditAdjust).toMatchObject({ applied: true, delta: 532, entitlement: 532, granted: 0, baseAfter: 502 });
    expect((await co(id)).base).toBe(502);
  });

  it('체험 중 유료 전환 = 남은 체험 크레딧 소멸(이력 키) → 그 달 권리 차이(체험 날 = 0) 58', async () => {
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: 412, resetAt: '2026-10-01 00:00:00+09' });
    await history(id, '2026-10-10', 'FREE', 'TRIAL');
    at('2026-10-26T12:00:00+09:00');
    await inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.STARTER, changeType: 'auto', reason: 'test' }));
    const r = await rowsOf(id);
    expect(r.map((x: any) => [x.type, x.amount, x.balance_base_after])).toEqual([['expire', -412, 0], ['plan_prorate', 58, 58]]);
    expect(r[0].idempotency_key).toMatch(/^trial-end:/);
  });

  it('이력 없는 회사를 지금 요금제로 다시 승인(힌트 = 그 요금제) = 이력 · 원장 · 잔액 그대로(Codex 구현 1R-1 · 회수 0)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: 50, resetAt: '2026-11-01 00:00:00+09' });
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:202611`, base: 300, purchased: 0, createdAt: '2026-11-01 00:00:00+09' });
    at('2026-11-20T10:00:00+09:00');
    const out = await inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.STARTER, changeType: 'auto', reason: 'test', prevPlanIdHint: PLAN.STARTER }));
    expect(out).toMatchObject({ recorded: false, skipped: 'same_plan' });
    expect(await rowsOf(id)).toEqual([]);
    expect((await co(id)).base).toBe(50);
    expect((await query(`SELECT count(*)::int AS n FROM company_plan_changes WHERE company_id = $1::uuid`, [id])).rows[0].n).toBe(0);
  });

  it('체험 → 유료 전환 중 이력 INSERT 뒤 자정이 지나도 체험 소멸 · 일할 = 이 변경의 시각(10월) · 11월 지급은 다음 마감에 그대로(Codex 구현 1R-2)', async () => {
    const id = await company({ plan: 'TRIAL', billing: 'prepaid', base: 412, resetAt: '2026-10-01 00:00:00+09' });
    await history(id, '2026-10-01', 'FREE', 'TRIAL');
    at('2026-10-31T23:59:59.900+09:00');
    await inTx(async (c) => {
      // 이력 INSERT 직후 JS 시계가 11월로 넘어간다(자정을 끼운 거래)
      const wrapped = {
        query: async (sql: string, p?: any[]) => {
          const r = await c.query(sql, p);
          if (/INSERT INTO company_plan_changes/.test(sql)) vi.setSystemTime(new Date('2026-11-01T00:00:00.500+09:00'));
          return r;
        },
      };
      return recordPlanChange({ client: wrapped as any, companyId: id, toPlanId: PLAN.STARTER, changeType: 'auto', reason: 'test' });
    });
    // 10월 = 체험 30일(0) + 스타터 1일 → 300 × 1/31 = 10 · 체험 남은 412 소멸 · 리셋 시각은 아직 10월
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount])).toEqual([['expire', -412], ['plan_prorate', 10]]);
    expect(await co(id)).toMatchObject({ base: 10, reset_kst: '2026-10-01 00:00:00' });
    const later = at('2026-11-02T10:00:00+09:00');
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), later));
    expect(await co(id)).toMatchObject({ base: 300, reset_kst: '2026-11-01 00:00:00' });
  });

  it('적용일이 지난달 · 미래면 던진다', async () => {
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: 0, resetAt: '2026-11-01 00:00:00+09' });
    at('2026-11-16T10:00:00+09:00');
    await expect(inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.BASIC, changeType: 'auto', effectiveDate: '2026-10-31' }))).rejects.toThrow('적용일');
    await expect(inTx(async (c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.BASIC, changeType: 'auto', effectiveDate: '2026-11-17' }))).rejects.toThrow('적용일');
  });
});

describe('체험(C1 · I7)', () => {
  it('체험 시작 = 남은 양수 기본분 소멸 → 체험 크레딧 · 끝 = 남은 체험 크레딧 소멸', async () => {
    const id = await company({ plan: 'TRIAL', billing: 'prepaid', base: 40, resetAt: '2026-11-01 00:00:00+09' });
    at('2026-11-10T10:00:00+09:00');
    await inTx(async (c) => applyTrialStart(c, id, 300, '20261117T100000000000'));
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount, x.balance_base_after])).toEqual([['expire', -40, 0], ['trial_credit', 300, 300]]);
    await query(`UPDATE companies SET ai_credits_base_remaining = 120 WHERE id = $1::uuid`, [id]);   // 체험 중 180 사용(시험이 칸만 맞춤)
    await query(`INSERT INTO ai_credit_transactions (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, seq) VALUES ($1::uuid, 'deduct', 180, 'base', 'x', $2, 120, 0, nextval('ai_credit_tx_seq'))`, [id, `t-use:${id}`]);
    await inTx(async (c) => expireTrialLeftover(c, id, `trial-end:${id}:20261117T100000000000`));
    const last = (await rowsOf(id)).pop();
    expect([last.type, last.amount, last.balance_base_after]).toEqual(['expire', -120, 0]);
    expect((await co(id)).base).toBe(0);
  });
});

describe('환불(C8 · R3-1) — 구성 셋 · 구매분 몫은 언제나 구매분', () => {
  it('11/10 (기본 0 · 구매 100)에서 200 차감(초과 100) → 12/2 지난 주기 환불 = 부채 100 취소 · 구매 100 복원 → (−100, 100)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: -100, purchased: 0, resetAt: '2026-12-01 00:00:00+09' });
    await ledger(id, { type: 'grant', amount: 100, key: `t-g:${id}`, base: 0, purchased: 100, createdAt: '2026-11-10 09:00:00+09', bucket: 'purchased' });
    await ledger(id, { type: 'deduct', amount: 200, key: `orig:${id}`, base: -100, purchased: 0, overage: 100, createdAt: '2026-11-10 10:00:00+09', bucket: 'overage' });
    const now = at('2026-12-02T10:00:00+09:00');
    const r = await inTx(async (c) => refundCreditWithClient(c, {
      companyId: id, amount: 200, source: 'test-refund', idempotencyKey: `refund:${id}`, originalIdempotencyKey: `orig:${id}`, manageTx: false,
    } as any, now));
    expect(r.refunded).toBe(true);
    expect(await co(id)).toMatchObject({ base: -100, purchased: 100 });
    const ref = (await rowsOf(id)).find((x: any) => x.type === 'refund');
    expect([ref.amount, ref.overage_credits, ref.balance_base_after, ref.balance_purchased_after]).toEqual([200, 100, -100, 100]);
    const orig = (await query(`SELECT overage_credits FROM ai_credit_transactions WHERE idempotency_key = $1`, [`orig:${id}`])).rows[0];
    expect(orig.overage_credits).toBe(0);
  });

  it('같은 주기 환불 = 초과 몫도 기본분으로 되메움 → (0, 100) · 환불 행 overage 0', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: -100, purchased: 0, resetAt: '2026-11-01 00:00:00+09' });
    await ledger(id, { type: 'grant', amount: 100, key: `t-g:${id}`, base: 0, purchased: 100, createdAt: '2026-11-10 09:00:00+09', bucket: 'purchased' });
    await ledger(id, { type: 'deduct', amount: 200, key: `orig:${id}`, base: -100, purchased: 0, overage: 100, createdAt: '2026-11-10 10:00:00+09', bucket: 'overage' });
    const now = at('2026-11-12T10:00:00+09:00');
    await inTx(async (c) => refundCreditWithClient(c, {
      companyId: id, amount: 200, source: 'test-refund', idempotencyKey: `refund:${id}`, originalIdempotencyKey: `orig:${id}`, manageTx: false,
    } as any, now));
    expect(await co(id)).toMatchObject({ base: 0, purchased: 100 });
    const ref = (await rowsOf(id)).find((x: any) => x.type === 'refund');
    expect(ref.overage_credits).toBe(0);
  });

  it('선불 · 다음 주기 환불 = 넘겨 상계된 몫을 기본분으로(270 → 300 · 부채 취소 없음 · 차감 없었을 때 그대로)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: 270, resetAt: '2026-09-01 00:00:00+09' });
    await ledger(id, { type: 'reset', amount: 0, key: `t-r8:${id}`, base: 0, purchased: 0, createdAt: '2026-08-01 00:00:00+09' });
    await ledger(id, { type: 'deduct', amount: 30, key: `orig:${id}`, base: -30, purchased: 0, overage: 30, createdAt: '2026-08-20 10:00:00+09', bucket: 'overage' });
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:202609`, base: 270, purchased: 0, createdAt: '2026-09-01 00:00:00+09' });
    const now = at('2026-09-10T10:00:00+09:00');
    await inTx(async (c) => refundCreditWithClient(c, {
      companyId: id, amount: 30, source: 'test-refund', idempotencyKey: `refund:${id}`, originalIdempotencyKey: `orig:${id}`, manageTx: false,
    } as any, now));
    expect(await co(id)).toMatchObject({ base: 300, purchased: 0 });
    const ref = (await rowsOf(id)).find((x: any) => x.type === 'refund');
    expect([ref.amount, ref.overage_credits, ref.balance_base_after]).toEqual([30, 0, 300]);
  });

  it('새 줄은 언제나 seq · 같은 시각 두 차감(A 200 → B 150 · id 는 A > B)도 seq 가 순서 → B 환불 = (100, 100)(Codex 구현 3R-1 · 5R-1 구조 처방)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: 300, purchased: 100, resetAt: '2031-03-01 00:00:00+09' });
    await history(id, '2026-11-01', null, 'STARTER');
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:203103`, base: 300, purchased: 100, createdAt: '2031-03-01 00:00:00+09' });
    const now = at('2031-03-01T00:00:05+09:00');   // DB 지금(실제 시각) < 주기 시작 = 자정을 낀 거래와 같은 꼴
    await inTx(async (c) => _deductWithClient(c, { companyId: id, cost: 200, source: 'test-deduct', idempotencyKey: `t-A:${id}` }, now, { manageTx: false }));
    await inTx(async (c) => _deductWithClient(c, { companyId: id, cost: 150, source: 'test-deduct', idempotencyKey: `t-B:${id}` }, now, { manageTx: false }));
    expect(await co(id)).toMatchObject({ base: 0, purchased: 50 });
    // 두 차감 줄 시각이 같다(판정 시각 같음) · seq 는 쓴 순서 · id 순서는 반대로
    const ab = (await query(`SELECT idempotency_key AS k, seq::int AS s, to_char(created_at, 'HH24:MI:SS.US') AS t FROM ai_credit_transactions WHERE company_id = $1::uuid AND type = 'deduct' ORDER BY seq`, [id])).rows;
    expect(ab.map((r: any) => r.k)).toEqual([`t-A:${id}`, `t-B:${id}`]);
    expect(ab[0].t).toBe(ab[1].t);
    expect(ab.every((r: any) => r.s != null)).toBe(true);
    await query(`UPDATE ai_credit_transactions SET id = $2::uuid WHERE idempotency_key = $1`, [`t-A:${id}`, `ffffffff${randomUUID().slice(8)}`]);
    await query(`UPDATE ai_credit_transactions SET id = $2::uuid WHERE idempotency_key = $1`, [`t-B:${id}`, `00000000${randomUUID().slice(8)}`]);
    await inTx(async (c) => refundCreditWithClient(c, {
      companyId: id, amount: 150, source: 'test-refund', idempotencyKey: `refund:${id}`, originalIdempotencyKey: `t-B:${id}`, manageTx: false,
    } as any, at('2031-03-01T00:10:00+09:00')));
    expect(await co(id)).toMatchObject({ base: 100, purchased: 100 });
  });

  it('10/31 판정(마감 없음) 차감은 실행이 자정 뒤여도 줄 시각 = 10월(청구 달) → 11월 마감 뒤 환불 = 지난 주기(부채만 취소) → 300(Codex 구현 4R-1)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: 0, resetAt: '2026-10-01 00:00:00+09' });
    await query(`UPDATE companies SET postpaid_overage_limit = 500 WHERE id = $1::uuid`, [id]);
    await history(id, '2026-09-01', null, 'STARTER');
    await ledger(id, { type: 'reset', amount: 0, key: `reset:${id}:202610`, base: 0, purchased: 0, createdAt: '2026-10-01 00:00:00+09' });
    const oct = at('2026-10-31T23:59:59.900+09:00');   // 판정 = 10월(마감 없음) · DB 실행 시각은 그 뒤(실제 지금)
    await inTx(async (c) => _deductWithClient(c, { companyId: id, cost: 100, source: 'test-deduct', idempotencyKey: `t-o:${id}` }, oct, { manageTx: false }));
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount, x.overage_credits, x.kst])).toEqual([['deduct', 100, 100, '2026-10-31 23:59:59.900000']]);
    const nov = at('2026-11-02T10:00:00+09:00');
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), nov));
    expect((await co(id)).base).toBe(300);   // 10월 −100 = 청구로 정리 · 11월 지급 300
    await inTx(async (c) => refundCreditWithClient(c, {
      companyId: id, amount: 100, source: 'test-refund', idempotencyKey: `refund:${id}`, originalIdempotencyKey: `t-o:${id}`, manageTx: false,
    } as any, at('2026-11-05T10:00:00+09:00')));
    expect(await co(id)).toMatchObject({ base: 300, purchased: 0 });
    const ref = (await rowsOf(id)).find((x: any) => x.type === 'refund');
    expect(ref.overage_credits).toBe(100);
  });

  it('옛 행(seq 없음 = 배포 전 옛 코드 줄) 폴백: 같은 ms 안 µs 가 다른 두 줄 → µs 그대로 비교해 직전 줄 · 같은 주기 → 차감 전 300(2R 변이에서 드러난 ms 잘림)', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: -100, resetAt: '2026-11-01 00:00:00+09' });
    // 같은 ms 안 두 줄 · id 순서를 시각 순서와 반대로(리셋 줄 id > 원 차감 id) = 시각을 ms 로 잘라 비교하면 직전 줄을 놓친다
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:202611`, base: 300, purchased: 0, createdAt: '2026-11-01 00:00:00+09', noSeq: true, id: `ffffffff${randomUUID().slice(8)}` });
    await ledger(id, { type: 'deduct', amount: 400, key: `orig:${id}`, base: -100, purchased: 0, overage: 100, createdAt: '2026-11-01 00:00:00.000001+09', bucket: 'overage', noSeq: true, id: `00000000${randomUUID().slice(8)}` });
    const now = at('2026-11-05T10:00:00+09:00');
    await inTx(async (c) => refundCreditWithClient(c, {
      companyId: id, amount: 400, source: 'test-refund', idempotencyKey: `refund:${id}`, originalIdempotencyKey: `orig:${id}`, manageTx: false,
    } as any, now));
    expect(await co(id)).toMatchObject({ base: 300, purchased: 0 });
    const ref = (await rowsOf(id)).find((x: any) => x.type === 'refund');
    expect([ref.overage_credits, ref.balance_base_after]).toEqual([0, 300]);
  });

  it('자정 직전에 시작한 차감(줄 시각 10/31 · 잠금 순서는 11월 리셋 줄 뒤) 환불 = 같은 주기(seq) → 차감 전 300 · 환불 줄 overage 0', async () => {
    const id = await company({ plan: 'STARTER', billing: 'postpaid', base: -100, resetAt: '2026-11-01 00:00:00+09' });
    await ledger(id, { type: 'reset', amount: 300, key: `reset:${id}:202611`, base: 300, purchased: 0, createdAt: '2026-11-01 00:00:00+09' });
    await ledger(id, { type: 'deduct', amount: 400, key: `orig:${id}`, base: -100, purchased: 0, overage: 100, createdAt: '2026-10-31 23:59:59+09', bucket: 'overage' });
    const now = at('2026-11-05T10:00:00+09:00');
    await inTx(async (c) => refundCreditWithClient(c, {
      companyId: id, amount: 400, source: 'test-refund', idempotencyKey: `refund:${id}`, originalIdempotencyKey: `orig:${id}`, manageTx: false,
    } as any, now));
    expect(await co(id)).toMatchObject({ base: 300, purchased: 0 });
    const ref = (await rowsOf(id)).find((x: any) => x.type === 'refund');
    expect([ref.overage_credits, ref.balance_base_after]).toEqual([0, 300]);
  });
});

describe('1일 지급 패스(C2) · 대조(C9) — 운영 SQL 그대로', () => {
  /** 그 회사 경보 = 직접 경보 + 패스 경보의 실패 줄(한 주기 1통 안의 회사별 사실) */
  const alertsFor = (id: string) => [
    ...(sendSystemAlert.mock.calls as any[]).filter((a) => a[0]?.companyId === id).map((a) => String(a[0].message)),
    ...(passAlerts.mock.calls as any[]).flatMap((a) => a[0].failures).filter((f: any) => f.companyId === id).map((f: any) => String(f.error)),
  ];

  it('1일 패스 = 리셋이 이번 달 전인 회사를 한 달씩 닫는다(리셋 시각 = 11월 1일 0시)', async () => {
    const { grantMonthlyCreditsPass } = await import('../ai-credit');
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: 120, resetAt: '2026-10-03 08:00:00+09' });
    await history(id, '2026-10-03', null, 'STARTER');
    const now = at('2026-11-01T04:40:00+09:00');
    await grantMonthlyCreditsPass(now);
    expect(await co(id)).toMatchObject({ base: 300, reset_kst: '2026-11-01 00:00:00' });
    expect((await rowsOf(id)).map((x: any) => [x.type, x.amount])).toEqual([['expire', -120], ['reset', 300]]);
  });

  it('대조 범위 = 최근 줄 중 가장 작은 seq 바로 앞부터(밀린 마감이 넣은 지난 날짜 · 큰 seq 줄이 최근 줄을 가리지 않는다 · Codex 구현 2R-3)', async () => {
    const { runCreditReconcilePass } = await import('../ai-credit-reconcile');
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: 0, purchased: 150, resetAt: '2026-11-01 00:00:00+09' });
    await ledger(id, { type: 'reset', amount: 300, key: `t-a:${id}`, base: 300, purchased: 0, createdAt: '2026-09-01 00:00:00+09' });
    // 최근 지급 줄(구매분 +100 인데 잔액이 150 으로 적힘 = 어긋남)
    await ledger(id, { type: 'grant', amount: 100, key: `t-b:${id}`, base: 300, purchased: 150, createdAt: '2026-11-15 10:00:00+09', bucket: 'purchased' });
    // 그 뒤 밀린 마감이 지난 날짜로 넣은 줄(큰 seq · 9/30)
    await ledger(id, { type: 'expire', amount: -300, key: `t-c:${id}`, base: 0, purchased: 150, createdAt: '2026-09-30 23:59:59.999999+09' });
    sendSystemAlert.mockClear();
    passAlerts.mockClear();
    await runCreditReconcilePass(at('2026-11-20T10:00:00+09:00'));
    expect(alertsFor(id)).toEqual([expect.stringMatching(/grant 100: .*구매 0→150/)]);
  });

  it('CT 로만 바뀐 회사 = 경보 0 · 회사 칸을 원장 없이 바꾸면 그 회사 경보(마지막 줄 ≠ 회사 칸)', async () => {
    const { runCreditReconcilePass } = await import('../ai-credit-reconcile');
    const id = await company({ plan: 'STARTER', billing: 'prepaid', base: 654, resetAt: '2026-10-01 09:19:00+09' });
    await history(id, '2026-10-04', null, 'STARTER');
    const now = at('2026-11-02T10:00:00+09:00');
    await query(`SELECT setval('ai_credit_tx_seq', 98)`);   // 이 회사 두 줄 = seq 99 · 100(자릿수 경계 · 글자 순서면 뒤집힌다)
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), now));
    expect((await query(`SELECT seq::int AS s FROM ai_credit_transactions WHERE company_id = $1::uuid ORDER BY seq`, [id])).rows.map((r: any) => r.s)).toEqual([99, 100]);
    sendSystemAlert.mockClear();
    passAlerts.mockClear();
    await runCreditReconcilePass(now);
    expect(alertsFor(id)).toEqual([]);
    await query(`UPDATE companies SET ai_credits_base_remaining = 999 WHERE id = $1::uuid`, [id]);
    await runCreditReconcilePass(at('2026-11-03T10:00:00+09:00'));
    expect(alertsFor(id)).toEqual([expect.stringContaining('회사 칸(기본 999 · 구매 0)')]);
  });
});

describe('요금제 월 크레딧 고정(C10)', () => {
  it('그 달 처음 쓸 때 고정 · 값을 바꿔도 그 달은 고정값 · 다음 달은 새 값', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const nov = await monthCredits(c, '2031-11', 'snapshot');
      expect(nov.get('STARTER')).toBe(300);
      await c.query(`UPDATE plans SET ai_credits_per_month = 600 WHERE plan_code = 'STARTER'`);
      expect((await monthCredits(c, '2031-11', 'snapshot')).get('STARTER')).toBe(300);
      expect((await monthCredits(c, '2031-12', 'read')).get('STARTER')).toBe(600);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
