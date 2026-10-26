/**
 * 요금제 변경 CT(recordPlanChange) — 남은 기간 크레딧 · 체험 만료일 필수 (★2026-10-26 Harold)
 *
 * 못 박는 것
 *   1. 신청 승인 · 직접 변경 · 업그레이드 = 그 달 남은 기간 크레딧을 기본 칸에 반영하고 원장(plan_prorate)에 한 줄(제시뉴욕 10/26 = 58).
 *   2. 이번 달 리셋 전이면 직전 요금제로 리셋부터 — 다음 AI 사용 때 새 요금제 한 달치가 통째로 들어가지 않게.
 *   3. 체험 부여 · 만료는 크레딧을 건드리지 않는다(그 경로가 기본 칸을 직접 정한다).
 *   4. 무료체험(TRIAL) 배정은 체험 CT(trial_start)로만 · 만료일이 있어야 한다 — 끝나지 않는 체험(berluti · woorimfmg) 차단.
 *
 * ⚠ 가짜 DB는 CT가 실제로 보내는 SQL만 해석한다. 모르는 SQL이면 던진다(관대한 mock 금지).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => undefined) }));

import { recordPlanChange } from '../plan-change-log';

const CID = '11111111-1111-1111-1111-111111111111';
const PLANS: Record<string, { id: string; plan_code: string; monthly_price: number; credits: number }> = {
  FREE: { id: '00000000-0000-0000-0000-00000000f0ee', plan_code: 'FREE', monthly_price: 0, credits: 0 },
  TRIAL: { id: '00000000-0000-0000-0000-0000000071a1', plan_code: 'TRIAL', monthly_price: 0, credits: 750 },
  STARTER: { id: '00000000-0000-0000-0000-0000000057a2', plan_code: 'STARTER', monthly_price: 150000, credits: 300 },
  PRO: { id: '00000000-0000-0000-0000-000000000960', plan_code: 'PRO', monthly_price: 1000000, credits: 2400 },
};
const byId = (id: string) => Object.values(PLANS).find((p) => p.id === id) || null;

interface Co { base: number; purchased: number; reset_at: string | null; billing_type: string; trial_expires_at: string | null }
let co: Co;
let prev: { to_plan_id: string; to_plan_code: string; to_monthly_price: number } | null;
let changes: any[];
let creditTx: any[];

function fakeClient() {
  return {
    query: async (sql: string, p: any[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (s.startsWith('SELECT plan_code, monthly_price, COALESCE(ai_credits_per_month, 0) AS credits FROM plans WHERE id = $1::uuid')) {
        const pl = byId(p[0]);
        return { rows: pl ? [{ plan_code: pl.plan_code, monthly_price: pl.monthly_price, credits: pl.credits }] : [] };
      }
      if (s.startsWith('SELECT to_plan_id, to_plan_code, to_monthly_price FROM company_plan_changes')) return { rows: prev ? [prev] : [] };
      if (s.startsWith('SELECT trial_expires_at IS NOT NULL AS has_expiry FROM companies WHERE id = $1::uuid')) {
        return { rows: [{ has_expiry: co.trial_expires_at !== null }] };
      }
      if (s.startsWith('INSERT INTO company_plan_changes')) {
        changes.push({ to_plan_id: p[2], to_plan_code: p[4], effective_date: p[7], change_type: p[8] });
        return { rows: [{ id: `chg${changes.length}` }] };
      }
      if (s.startsWith('SELECT c.ai_credits_base_remaining AS base')) {
        return { rows: [{ base: co.base, purchased: co.purchased, cap: null, reset_at: co.reset_at, billing_type: co.billing_type, overage_limit: 0, plan_credits: null }] };
      }
      if (s.startsWith('SELECT COALESCE(ai_credits_per_month, 0) AS credits FROM plans WHERE id = $1::uuid')) {
        const pl = byId(p[0]);
        return { rows: pl ? [{ credits: pl.credits }] : [] };
      }
      if (s.startsWith('UPDATE companies SET ai_credits_base_remaining = $2, ai_credits_reset_at = NOW() WHERE id = $1::uuid')) {
        co.base = p[1]; co.reset_at = new Date().toISOString(); return { rows: [] };
      }
      if (s.startsWith('INSERT INTO ai_credit_transactions')) {
        const key = p[2];
        if (creditTx.some((t) => t.key === key)) return { rows: [], rowCount: 0 };
        creditTx.push({ type: s.includes("'reset'") ? 'reset' : s.includes("'plan_prorate'") ? 'plan_prorate' : '?', amount: p[1], key, base_after: p[3], purchased_after: p[4] });
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('UPDATE companies SET ai_credits_base_remaining = $2 WHERE id = $1::uuid')) { co.base = p[1]; return { rows: [] }; }
      throw new Error(`가짜 DB가 모르는 SQL: ${s.slice(0, 120)}`);
    },
  } as any;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T03:00:00Z'));   // KST 10/26 12:00
  co = { base: 0, purchased: 140, reset_at: '2026-10-23T19:00:00Z', billing_type: 'postpaid', trial_expires_at: null };
  prev = { to_plan_id: PLANS.FREE.id, to_plan_code: 'FREE', to_monthly_price: 0 };
  changes = [];
  creditTx = [];
});
afterEach(() => { vi.useRealTimers(); });

describe('recordPlanChange — 남은 기간 크레딧 (★1026)', () => {
  it('★ 제시뉴욕 10/26 미가입 → 스타터 = 기본 칸 +58 · 원장 plan_prorate 58 한 줄', async () => {
    const r = await recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.STARTER.id, changeType: 'auto', reason: '시험' });
    expect(r.recorded).toBe(true);
    expect(r.changeType).toBe('upgrade');
    expect(r.creditAdjust).toMatchObject({ applied: true, delta: 58 });
    expect(co.base).toBe(58);
    expect(creditTx).toEqual([expect.objectContaining({ type: 'plan_prorate', amount: 58, base_after: 58, purchased_after: 140 })]);
  });

  it('★ 이번 달 리셋 전이면 직전 요금제로 리셋부터 — 새 요금제 한 달치(300)가 아니라 58만', async () => {
    co.reset_at = '2026-09-30T00:00:00Z';
    co.base = 25;
    await recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.STARTER.id, changeType: 'auto' });
    expect(creditTx.map((t) => [t.type, t.amount])).toEqual([['reset', 0], ['plan_prorate', 58]]);
    expect(co.base).toBe(58);
  });

  it('업그레이드 스타터 → 프로 = 차액 2100 × 6/31 = 406', async () => {
    prev = { to_plan_id: PLANS.STARTER.id, to_plan_code: 'STARTER', to_monthly_price: 150000 };
    co.base = 100;
    const r = await recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.PRO.id, changeType: 'auto' });
    expect(r.creditAdjust).toMatchObject({ applied: true, delta: 406 });
    expect(co.base).toBe(506);
  });

  it('★ 체험 중 유료 전환 = 체험 남은 크레딧을 없애고 스타터 일할(58)로', async () => {
    prev = { to_plan_id: PLANS.TRIAL.id, to_plan_code: 'TRIAL', to_monthly_price: 0 };
    co.base = 412;
    await recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.STARTER.id, changeType: 'auto' });
    expect(co.base).toBe(58);
    expect(creditTx).toEqual([expect.objectContaining({ type: 'plan_prorate', amount: -354 })]);
  });

  it('체험 만료(trial_expire)는 크레딧을 건드리지 않는다 — 그 경로가 기본 칸을 직접 정한다', async () => {
    prev = { to_plan_id: PLANS.TRIAL.id, to_plan_code: 'TRIAL', to_monthly_price: 0 };
    co.base = 412;
    const r = await recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.FREE.id, changeType: 'trial_expire' });
    expect(r.creditAdjust).toMatchObject({ applied: false, skipped: 'trial' });
    expect(co.base).toBe(412);
    expect(creditTx).toEqual([]);
  });

  it('★ 잠금을 기다리다 달이 넘어간 복구(변경일 10/31 · 처리 11/1) = 직전 요금제로 11월 리셋 뒤 11월 전체 몫 +300(Codex 1R)', async () => {
    vi.setSystemTime(new Date('2026-10-31T15:30:00Z'));   // KST 11/01 00:30
    co.reset_at = '2026-10-23T19:00:00Z';                 // 10월에 리셋됨 → 11월 리셋 전
    co.base = 12;
    const r = await recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.STARTER.id, changeType: 'auto', effectiveDate: '2026-10-31' });
    expect(r.creditAdjust).toMatchObject({ applied: true, delta: 300 });
    expect(creditTx.map((t) => [t.type, t.amount])).toEqual([['reset', 0], ['plan_prorate', 300]]);
    expect(co.base).toBe(300);
  });

  it('★ 달이 넘어간 잠금(유료 → 미가입 · 변경일 10/31 · 처리 11/1) = 유료로 11월 리셋 뒤 전부 회수 — 한 달치가 남지 않는다', async () => {
    vi.setSystemTime(new Date('2026-10-31T15:30:00Z'));   // KST 11/01 00:30
    prev = { to_plan_id: PLANS.STARTER.id, to_plan_code: 'STARTER', to_monthly_price: 150000 };
    co.reset_at = '2026-10-01T00:00:00Z';
    co.base = 40;
    await recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.FREE.id, changeType: 'auto', effectiveDate: '2026-10-31' });
    expect(creditTx.map((t) => [t.type, t.amount])).toEqual([['reset', 300], ['plan_prorate', -300]]);
    expect(co.base).toBe(0);
  });

  it('같은 요금제 재기록은 이력도 크레딧도 없다', async () => {
    const r = await recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.FREE.id, changeType: 'auto' });
    expect(r).toMatchObject({ recorded: false, skipped: 'same_plan' });
    expect(changes).toEqual([]);
    expect(creditTx).toEqual([]);
  });
});

describe('recordPlanChange — 무료체험 배정은 체험 CT로만 · 만료일 필수 (★1026 · 뿌리 대장 R6)', () => {
  it('★ 체험 CT가 아닌 경로(auto)로 TRIAL 을 배정하면 던진다 — 이력도 남기지 않는다', async () => {
    co.trial_expires_at = '2026-11-25T00:00:00Z';
    await expect(recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.TRIAL.id, changeType: 'auto' })).rejects.toThrow(/체험/);
    expect(changes).toEqual([]);
  });

  it('★ 체험 CT(trial_start)라도 만료일이 없으면 던진다 — 끝나지 않는 체험 차단', async () => {
    co.trial_expires_at = null;
    await expect(recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.TRIAL.id, changeType: 'trial_start' })).rejects.toThrow(/만료일/);
    expect(changes).toEqual([]);
  });

  it('체험 CT + 만료일 = 기록 · 크레딧은 체험 CT 몫이라 건드리지 않는다', async () => {
    co.trial_expires_at = '2026-11-25T00:00:00Z';
    const r = await recordPlanChange({ client: fakeClient(), companyId: CID, toPlanId: PLANS.TRIAL.id, changeType: 'trial_start' });
    expect(r).toMatchObject({ recorded: true, changeType: 'trial_start', creditAdjust: { applied: false, skipped: 'trial' } });
    expect(creditTx).toEqual([]);
  });
});
