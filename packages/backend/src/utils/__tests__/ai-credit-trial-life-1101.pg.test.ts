// replaces: none
/**
 * 체험 수명 — 실 PostgreSQL 판(★ 2026-11-01 설계서 docs/2026-11-01-credit-control-tower-design.md §16-5 · Harold 「체험크레딧은 체험 종료가 되면 그냥 사라져야」)
 *
 * 운영 문장을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본 · C90-DDL-1 을 얹는다). JS 시각만 가짜로 고정한다(Date 만).
 * 기대값 = 설계서 16-5 손 계산 예. 강등 작업은 다른 시험 회사까지 건드리지 않게 그 작업의 두 걸음(회사 칸 갱신 → expireTrialLeftover)을
 * 같은 순서로 이 회사에만 돌린다(작업 자체의 호출 순서는 trial-downgrade-worker.test.ts 가 본다).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';

vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => 0) }));

import { loadCreditRow, applyResetIfNeeded, refundCreditWithClient, applyTrialStart, expireTrialLeftover, CreditLedgerConflictError, _deductWithClient } from '../ai-credit-tx';
import { getCreditState } from '../ai-credit';
import { recordPlanChange } from '../plan-change-log';

const PLAN: Record<string, string> = {};
const CREDITS: Record<string, number> = { FREE: 0, TRIAL: 750, STARTER: 300 };
const PRICE: Record<string, number> = { FREE: 0, TRIAL: 0, STARTER: 150000 };
/** 체험 만료 = 11/1 12:00 KST(만료 칸 = UTC 벽시계) · 키 = 강등 작업과 같은 꼴 */
const ENDS_UTC = '2026-11-01 03:00:00';
const TRIAL_KEY = '20261101T030000000000';

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C90-DDL-1'));
  for (const code of Object.keys(CREDITS)) {
    const id = randomUUID();
    PLAN[code] = id;
    await insertMinimalRow(pool, 'plans', { id, plan_code: code, plan_name: code, monthly_price: PRICE[code], ai_credits_per_month: CREDITS[code], is_active: true });
  }
});
afterEach(() => {
  vi.useRealTimers();
});

const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  return new Date(iso);
};
const BEFORE_END = '2026-11-01T11:00:00+09:00';
const AFTER_END = '2026-11-01T12:00:30+09:00';

/** 회사 + 지금 잔액을 설명하는 원장 줄 하나(운영 회사는 언제나 체험 크레딧 · 지급 줄이 먼저 있다 · seed false = 직전 줄 없는 옛 원장) */
async function trialCompany(o: { base: number; purchased?: number; billing?: 'prepaid' | 'postpaid'; plan?: string; status?: string; ends?: string | null; seed?: boolean }): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', {
    id, plan_id: PLAN[o.plan ?? 'TRIAL'], billing_type: o.billing ?? 'prepaid', subscription_status: o.status ?? 'trial',
    trial_expires_at: o.ends === undefined ? ENDS_UTC : o.ends,
    ai_credits_base_remaining: o.base, ai_credits_purchased: o.purchased ?? 0, ai_credits_reset_at: '2026-11-01 00:00:00+09',
  });
  if (o.seed !== false) {
    await ledger(id, { type: 'reset', amount: o.base, key: `seed:${id}`, base: o.base, purchased: o.purchased ?? 0, createdAt: '2026-11-01 00:00:00+09' });
  }
  return id;
}
async function ledger(companyId: string, r: { type: string; amount: number; key: string; base: number; purchased: number; overage?: number; createdAt: string; bucket?: string }): Promise<void> {
  await query(
    `INSERT INTO ai_credit_transactions (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, overage_credits, created_at, seq)
     VALUES ($1::uuid, $2, $3, $4, 'test', $5, $6, $7, $8, $9::timestamptz, nextval('ai_credit_tx_seq'))`,
    [companyId, r.type, r.amount, r.bucket ?? 'base', r.key, r.base, r.purchased, r.overage ?? 0, r.createdAt],
  );
}
const rowsOf = async (companyId: string) => (await query(
  `SELECT type, amount, source, balance_base_after AS base, balance_purchased_after AS purchased, idempotency_key AS key
     FROM ai_credit_transactions WHERE company_id = $1::uuid AND source <> 'test' ORDER BY seq`,
  [companyId],
)).rows.map((x: any) => [x.type, x.amount, x.source, x.base, x.purchased]);
const co = async (companyId: string) => (await query(
  `SELECT ai_credits_base_remaining AS base, ai_credits_purchased AS purchased FROM companies WHERE id = $1::uuid`, [companyId],
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
const deduct = (id: string, cost: number, key: string, now: Date) =>
  inTx((c) => _deductWithClient(c, { companyId: id, cost, source: 'ai-generic', idempotencyKey: key }, now, { manageTx: false }));
const refund = (id: string, amount: number, orig: string, now: Date) =>
  inTx((c) => refundCreditWithClient(c, { companyId: id, amount, source: 'test-refund', reason: '시험', idempotencyKey: `refund:${orig}`, originalIdempotencyKey: orig, manageTx: false }, now));
/** 강등 작업의 두 걸음(회사 칸 갱신 → 체험 끝 소멸 · 같은 키) — 이 회사에만 */
async function downgrade(id: string, now: Date): Promise<void> {
  await inTx(async (c) => {
    await c.query(`UPDATE companies SET plan_id = $2, subscription_status = 'trial_expired', trial_expires_at = NULL WHERE id = $1::uuid`, [id, PLAN.FREE]);
    await expireTrialLeftover(c, id, `trial-end:${id}:${TRIAL_KEY}`, now);
  });
}

describe('체험 끝 = 만료 시각(강등 작업 전이라도 · §16-5)', () => {
  it('만료 시각이 지나면 첫 크레딧 일이 남은 기본분을 소멸(키 = 강등 작업과 같은 trial-end:{회사}:{만료 시각}) · 화면도 0 · 강등 작업은 같은 키라 두 번 지움 0', async () => {
    const id = await trialCompany({ base: 300, purchased: 50 });
    let now = at(BEFORE_END);
    expect((await getCreditState(id)).baseRemaining).toBe(300);
    now = at(AFTER_END);
    expect((await getCreditState(id)).baseRemaining).toBe(0);   // 쓰기 전에도 화면 = 0(투영)
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), now));
    expect(await rowsOf(id)).toEqual([['expire', -300, 'trial-end', 0, 50]]);
    expect((await query(`SELECT idempotency_key FROM ai_credit_transactions WHERE company_id = $1::uuid`, [id])).rows[0].idempotency_key).toBe(`trial-end:${id}:${TRIAL_KEY}`);
    await downgrade(id, now);
    expect(await rowsOf(id)).toEqual([['expire', -300, 'trial-end', 0, 50]]);
    expect(await co(id)).toEqual({ base: 0, purchased: 50 });
  });

  it('같은 키가 있는데 기본분이 양수 = 환불 규칙상 생길 수 없는 잔액 → 강등이 던진다(소리 내 멈춤)', async () => {
    const id = await trialCompany({ base: 300 });
    const now = at(AFTER_END);
    await inTx(async (c) => applyResetIfNeeded(c, id, await loadCreditRow(c, id, true), now));
    await query(`UPDATE companies SET ai_credits_base_remaining = 50 WHERE id = $1::uuid`, [id]);
    await expect(downgrade(id, now)).rejects.toThrow(CreditLedgerConflictError);
  });

  it('다 쓰고 끝난 체험도 경계 줄(0)을 남긴다 → 같은 달 환불 = 기본분 되살아남 0(Codex 설계 2R-1)', async () => {
    const id = await trialCompany({ base: 300 });
    await deduct(id, 300, `use:${id}`, at(BEFORE_END));
    await downgrade(id, at(AFTER_END));
    expect(await rowsOf(id)).toEqual([['deduct', 300, 'ai-generic', 0, 0], ['expire', 0, 'trial-end', 0, 0]]);
    const r = await refund(id, 300, `use:${id}`, at('2026-11-01T13:00:00+09:00'));
    expect(r.refunded).toBe(true);
    expect(await co(id)).toEqual({ base: 0, purchased: 0 });
    expect((await rowsOf(id)).slice(2)).toEqual([['refund', 300, 'test-refund', 300, 0], ['expire', -300, 'trial-end-refund', 0, 0]]);
  });

  it('반쯤 사용 → 만료 뒤 환불(게으른 소멸이 먼저) → 강등 = 충돌 0 · 잔액 0 · 유료 전환 이력도 통과', async () => {
    const id = await trialCompany({ base: 300 });
    await deduct(id, 100, `use:${id}`, at(BEFORE_END));
    const now = at(AFTER_END);
    expect((await refund(id, 100, `use:${id}`, now)).refunded).toBe(true);
    expect(await rowsOf(id)).toEqual([
      ['deduct', 100, 'ai-generic', 200, 0], ['expire', -200, 'trial-end', 0, 0],
      ['refund', 100, 'test-refund', 100, 0], ['expire', -100, 'trial-end-refund', 0, 0],
    ]);
    await downgrade(id, now);
    await inTx((c) => recordPlanChange({ client: c, companyId: id, toPlanId: PLAN.FREE, changeType: 'trial_expire', prevPlanIdHint: PLAN.TRIAL, now }));
    expect(await co(id)).toEqual({ base: 0, purchased: 0 });
  });

  it('체험 전 차감 → 체험 시작(크레딧 0 · 남은 유료 기본분 소멸) → 환불 = 되살아남 0', async () => {
    const id = await trialCompany({ base: 100, plan: 'STARTER', status: 'active', ends: null });
    await deduct(id, 40, `use:${id}`, at('2026-11-01T09:00:00+09:00'));
    const now = at('2026-11-01T09:30:00+09:00');
    await inTx((c) => applyTrialStart(c, id, 0, '20261108T003000000000', now));
    expect((await refund(id, 40, `use:${id}`, now)).refunded).toBe(true);
    expect(await co(id)).toEqual({ base: 0, purchased: 0 });
  });

  it('체험 시작에 소멸 줄도 체험 크레딧 줄도 없으면 경계 0 줄 · 잔액 −100 → 같은 달 환불 = 0(빚 취소 보존 · Codex 설계 3R-1)', async () => {
    const id = await trialCompany({ base: -100, plan: 'STARTER', status: 'active', ends: null, seed: false });
    await ledger(id, { type: 'reset', amount: 0, key: `t-r:${id}`, base: 0, purchased: 0, createdAt: '2026-11-01 00:00:00+09' });
    await ledger(id, { type: 'deduct', amount: 100, key: `use:${id}`, base: -100, purchased: 0, createdAt: '2026-11-01 08:00:00+09' });
    const now = at('2026-11-01T09:30:00+09:00');
    await inTx((c) => applyTrialStart(c, id, 0, '20261108T003000000000', now));
    expect(await rowsOf(id)).toEqual([['expire', 0, 'trial-start', -100, 0]]);
    expect((await refund(id, 100, `use:${id}`, now)).refunded).toBe(true);
    expect(await co(id)).toEqual({ base: 0, purchased: 0 });
  });

  it('체험 크레딧 60 + 빚 40 섞인 차감 → 체험 끝 → 환불 = 60 만 소멸 · 빚 40 취소 보존 → 0', async () => {
    const id = await trialCompany({ base: -40, seed: false });
    await ledger(id, { type: 'trial_credit', amount: 60, key: `t-c:${id}`, base: 60, purchased: 0, createdAt: '2026-11-01 08:00:00+09' });
    await ledger(id, { type: 'deduct', amount: 100, key: `use:${id}`, base: -40, purchased: 0, createdAt: '2026-11-01 09:00:00+09', bucket: 'overage' });
    const now = at(AFTER_END);
    await downgrade(id, now);
    expect((await refund(id, 100, `use:${id}`, now)).refunded).toBe(true);
    expect(await co(id)).toEqual({ base: 0, purchased: 0 });
  });

  it('체험 크레딧 60 + 구매 40 차감 → 체험 끝 → 환불 = 구매분 40 만 복원', async () => {
    const id = await trialCompany({ base: 60, purchased: 40 });
    await deduct(id, 100, `use:${id}`, at(BEFORE_END));
    const now = at(AFTER_END);
    await downgrade(id, now);
    expect((await refund(id, 100, `use:${id}`, now)).refunded).toBe(true);
    expect(await co(id)).toEqual({ base: 0, purchased: 40 });
  });

  it('상한 없음(1101 정정) — 체험 끝 뒤 새 빚 −30 → 끝난 체험 차감(기본 60) 환불 = −30 그대로(끝난 크레딧이 새 빚을 갚지 않는다)', async () => {
    const id = await trialCompany({ base: 60 });
    await deduct(id, 60, `use:${id}`, at(BEFORE_END));
    const now = at(AFTER_END);
    await downgrade(id, now);
    await ledger(id, { type: 'deduct', amount: 30, key: `new-debt:${id}`, base: -30, purchased: 0, createdAt: '2026-11-01 12:01:00+09' });
    await query(`UPDATE companies SET ai_credits_base_remaining = -30 WHERE id = $1::uuid`, [id]);
    expect((await refund(id, 60, `use:${id}`, at('2026-11-01T12:02:00+09:00'))).refunded).toBe(true);
    expect(await co(id)).toEqual({ base: -30, purchased: 0 });
  });

  it('구성분을 모르는 옛 줄(직전 줄 없음) + 원 차감 뒤 수명 끝 = 보류(잔액 · 원 행 초과 칸 · 환불 줄 그대로 · Codex 설계 4R-1)', async () => {
    const id = await trialCompany({ base: 0, purchased: 0, billing: 'postpaid', seed: false });
    await ledger(id, { type: 'deduct', amount: 100, key: `use:${id}`, base: 0, purchased: 0, overage: 40, createdAt: '2026-11-01 09:00:00+09', bucket: 'mixed' });
    const r = await refund(id, 100, `use:${id}`, at(AFTER_END));
    expect(r).toEqual({ refunded: false, amount: 0, skipReason: 'held_after_lifetime_end' });
    expect(await co(id)).toEqual({ base: 0, purchased: 0 });
    expect((await query(`SELECT overage_credits FROM ai_credit_transactions WHERE idempotency_key = $1`, [`use:${id}`])).rows[0].overage_credits).toBe(40);
    expect((await rowsOf(id)).filter((x) => x[0] === 'refund')).toEqual([]);
  });

  it('체험 중(만료 전) 환불 = 경계 없음 → 체험 크레딧 그대로 되메움', async () => {
    const id = await trialCompany({ base: 300 });
    await deduct(id, 100, `use:${id}`, at(BEFORE_END));
    expect((await refund(id, 100, `use:${id}`, at('2026-11-01T11:30:00+09:00'))).refunded).toBe(true);
    expect(await co(id)).toEqual({ base: 300, purchased: 0 });
  });
});
