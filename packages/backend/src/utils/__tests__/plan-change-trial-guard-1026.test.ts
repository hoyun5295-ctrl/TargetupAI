/**
 * 요금제 변경 CT(recordPlanChange) — 무료체험 배정 계약 · 같은 요금제 재기록 (★2026-10-26 Harold · 뿌리 대장 R6)
 *
 * 못 박는 것
 *   1. 무료체험(TRIAL) 배정은 체험 CT(trial_start)로만 · 만료일이 있어야 한다 — 끝나지 않는 체험(berluti · woorimfmg) 차단.
 *   2. 같은 요금제 재기록은 이력도 크레딧도 없다(원장 CT 를 부르지 않는다).
 *   크레딧 금액(그 달 권리 − 원장 지급 합 · 체험 전환 · 마감 먼저)은 실 PG 시험 ai-credit-close-1101.pg.test.ts 가
 *   운영 SQL 그대로 못 박는다(★ 2026-11-01 크레딧 컨트롤타워 C4 · 옛 plan-change-credit-1026 의 크레딧 사례를 거기로 옮김).
 *
 * ⚠ 가짜 DB는 CT가 실제로 보내는 SQL만 해석한다. 모르는 SQL이면 던진다(관대한 mock 금지). 원장 CT 는 모듈 경계에서 끊는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => undefined) }));
vi.mock('../ai-credit-tx', () => ({
  loadCreditRow: vi.fn(async () => null),
  applyResetIfNeeded: vi.fn(),
  expireTrialLeftover: vi.fn(),
  insertedRows: (r: any) => r?.rowCount ?? r?.rows?.length ?? 0,
}));

import { recordPlanChange } from '../plan-change-log';
import { loadCreditRow } from '../ai-credit-tx';

const CID = '11111111-1111-1111-1111-111111111111';
const PLANS: Record<string, { id: string; plan_code: string; monthly_price: number; credits: number }> = {
  FREE: { id: '00000000-0000-0000-0000-00000000f0ee', plan_code: 'FREE', monthly_price: 0, credits: 0 },
  TRIAL: { id: '00000000-0000-0000-0000-0000000071a1', plan_code: 'TRIAL', monthly_price: 0, credits: 750 },
};
const byId = (id: string) => Object.values(PLANS).find((p) => p.id === id) || null;

let trialExpiresAt: string | null;
let changes: any[];

const client = {
  query: async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (s.startsWith('SELECT plan_code, monthly_price, COALESCE(ai_credits_per_month, 0) AS credits FROM plans WHERE id = $1::uuid')) {
      const pl = byId(p[0]);
      return { rows: pl ? [{ plan_code: pl.plan_code, monthly_price: pl.monthly_price, credits: pl.credits }] : [] };
    }
    if (s.startsWith('SELECT to_plan_id, to_plan_code, to_monthly_price FROM company_plan_changes')) {
      return { rows: [{ to_plan_id: PLANS.FREE.id, to_plan_code: 'FREE', to_monthly_price: 0 }] };
    }
    if (s.startsWith('SELECT trial_expires_at IS NOT NULL AS has_expiry FROM companies WHERE id = $1::uuid')) {
      return { rows: [{ has_expiry: trialExpiresAt !== null }] };
    }
    if (s.startsWith('INSERT INTO company_plan_changes')) {
      changes.push({ to_plan_id: p[2], to_plan_code: p[4], effective_date: p[7], change_type: p[8] });
      return { rows: [{ id: `chg${changes.length}` }] };
    }
    throw new Error(`가짜 DB가 모르는 SQL: ${s.slice(0, 120)}`);
  },
} as any;

beforeEach(() => {
  trialExpiresAt = null;
  changes = [];
  (loadCreditRow as any).mockClear();
});

describe('recordPlanChange — 무료체험 배정은 체험 CT로만 · 만료일 필수 (★1026 · 뿌리 대장 R6)', () => {
  it('★ 체험 CT가 아닌 경로(auto)로 TRIAL 을 배정하면 던진다 — 이력도 남기지 않는다', async () => {
    trialExpiresAt = '2026-11-25T00:00:00Z';
    await expect(recordPlanChange({ client, companyId: CID, toPlanId: PLANS.TRIAL.id, changeType: 'auto' })).rejects.toThrow(/체험/);
    expect(changes).toEqual([]);
  });

  it('★ 체험 CT(trial_start)라도 만료일이 없으면 던진다 — 끝나지 않는 체험 차단', async () => {
    await expect(recordPlanChange({ client, companyId: CID, toPlanId: PLANS.TRIAL.id, changeType: 'trial_start' })).rejects.toThrow(/만료일/);
    expect(changes).toEqual([]);
  });

  it('체험 CT + 만료일 = 기록 · 크레딧은 같은 트랜잭션(client)으로 원장 CT 에 맡긴다', async () => {
    trialExpiresAt = '2026-11-25T00:00:00Z';
    const r = await recordPlanChange({ client, companyId: CID, toPlanId: PLANS.TRIAL.id, changeType: 'trial_start' });
    expect(r).toMatchObject({ recorded: true, changeType: 'trial_start' });
    expect(changes).toEqual([expect.objectContaining({ to_plan_code: 'TRIAL', change_type: 'trial_start' })]);
    expect(loadCreditRow).toHaveBeenCalledWith(client, CID, true);
  });
});

describe('recordPlanChange — 같은 요금제 재기록', () => {
  it('이력도 크레딧도 없다(원장 CT 를 부르지 않는다)', async () => {
    const r = await recordPlanChange({ client, companyId: CID, toPlanId: PLANS.FREE.id, changeType: 'auto' });
    expect(r).toMatchObject({ recorded: false, skipped: 'same_plan' });
    expect(changes).toEqual([]);
    expect(loadCreditRow).not.toHaveBeenCalled();
  });
});
