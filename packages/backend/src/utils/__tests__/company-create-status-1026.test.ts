/**
 * 회사 생성 CT — 구독 상태를 직접 쓴다 · 무료체험은 체험 CT로 (★2026-10-26)
 *
 * 경위: 생성 INSERT 가 구독 상태(subscription_status)를 안 써서 DB 기본값 'trial' 로 태어났다
 *   → 체험을 한 번도 안 받은 미가입 32곳이 「체험 중」(운영 실측 1026 · LESSONS_DB 9).
 *   무료체험(TRIAL) 요금제로 만들면 만료일 없이 생겨 체험이 끝나지 않았다(berluti · woorimfmg 가입일부터 5개월).
 *
 * 못 박는 것:
 *   1. 유료 요금제 = 'paid' · 미가입(FREE) · 요금제 없음 = NULL — 생성 INSERT 한 문장에서.
 *   2. TRIAL 로 만들면 INSERT 는 요금제 없이 · 같은 트랜잭션에서 체험 CT(grantFreeTrial)가 만료일 · 크레딧 · 이력을 넣는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PLANS: Record<string, { plan_code: string; trial_days: number }> = {
  'p-starter': { plan_code: 'STARTER', trial_days: 0 },
  'p-free': { plan_code: 'FREE', trial_days: 0 },
  'p-trial7': { plan_code: 'TRIAL', trial_days: 7 },
  'p-trial0': { plan_code: 'TRIAL', trial_days: 0 },
};

const h = vi.hoisted(() => ({ calls: [] as { sql: string; params?: any[] }[] }));

vi.mock('../../config/database', () => {
  const client = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      h.calls.push({ sql, params });
      if (/INSERT INTO companies/.test(sql)) return { rows: [{ id: 'c-1026', plan_id: params?.[9] ?? null, subscription_status: params?.[22] ?? null }] };
      if (/SELECT plan_code, COALESCE\(trial_days, 0\) AS trial_days FROM plans WHERE id = \$1::uuid/.test(sql)) {
        const pl = PLANS[params?.[0]];
        return { rows: pl ? [pl] : [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { default: { connect: vi.fn(async () => client) }, query: vi.fn(async () => ({ rows: [] })) };
});
vi.mock('../system-sync-user', () => ({ ensureSystemSyncUser: vi.fn(async () => undefined) }));
vi.mock('../plan-change-log', () => ({ recordPlanChange: vi.fn(async () => ({ recorded: true })) }));
vi.mock('../basic-trial', () => ({
  grantFreeTrial: vi.fn(async () => ({ id: 'c-1026', plan_id: 'p-trial-real', subscription_status: 'trial', trial_expires_at: '2026-11-02T00:00:00Z' })),
}));
vi.mock('../account-issue', () => ({ recordAccountIssued: vi.fn(async () => undefined), recordCompanyRegistered: vi.fn(async () => undefined) }));

import { createCompanyCore } from '../company-create';
import { recordPlanChange } from '../plan-change-log';
import { grantFreeTrial } from '../basic-trial';

function insertedRow(): Record<string, any> {
  const ins = h.calls.find((c) => /INSERT INTO companies/.test(c.sql));
  expect(ins, '회사 INSERT 가 없다').toBeTruthy();
  const cols = ins!.sql.match(/INSERT INTO companies \(([\s\S]*?)\)\s*VALUES/)![1].split(',').map((s) => s.trim());
  const placeholders = ins!.sql.match(/VALUES \(([\s\S]*?)\)/)![1].split(',').map((s) => s.trim());
  expect(placeholders.length).toBe(cols.length);
  expect(ins!.params!.length).toBe(cols.length);
  return Object.fromEntries(cols.map((c, i) => [c, ins!.params![Number(placeholders[i].slice(1)) - 1]]));
}

beforeEach(() => {
  h.calls.length = 0;
  vi.mocked(recordPlanChange).mockClear();
  vi.mocked(grantFreeTrial).mockClear();
});

describe('회사 생성 — 구독 상태를 직접 쓴다(★1026)', () => {
  it('유료 요금제 = paid · 최초 이력', async () => {
    await createCompanyCore({ companyCode: 'S1026', companyName: '스타터', planId: 'p-starter' });
    const row = insertedRow();
    expect(row).toHaveProperty('subscription_status', 'paid');
    expect(row.plan_id).toBe('p-starter');
    expect(recordPlanChange).toHaveBeenCalledWith(expect.objectContaining({ toPlanId: 'p-starter', changeType: 'initial' }));
    expect(grantFreeTrial).not.toHaveBeenCalled();
  });

  it('★ 미가입(FREE) = NULL — 「체험 중」으로 태어나지 않는다', async () => {
    await createCompanyCore({ companyCode: 'F1026', companyName: '미가입', planId: 'p-free' });
    const row = insertedRow();
    expect(row).toHaveProperty('subscription_status', null);
    expect(row.plan_id).toBe('p-free');
  });

  it('요금제 없음 = NULL · 이력 없음', async () => {
    await createCompanyCore({ companyCode: 'N1026', companyName: '요금제 없음' });
    const row = insertedRow();
    expect(row).toHaveProperty('subscription_status', null);
    expect(row.plan_id).toBeNull();
    expect(recordPlanChange).not.toHaveBeenCalled();
  });
});

describe('회사 생성 — 무료체험은 체험 CT로(★1026 · 뿌리 대장 R6)', () => {
  it('★ TRIAL 로 만들면 INSERT 는 요금제 없이 · 같은 트랜잭션에서 체험 CT(요금제 체험 일수 7)', async () => {
    const created = await createCompanyCore({ companyCode: 'T1026', companyName: '체험', planId: 'p-trial7' });
    const row = insertedRow();
    expect(row.plan_id).toBeNull();
    expect(row).toHaveProperty('subscription_status', null);
    expect(grantFreeTrial).toHaveBeenCalledWith('c-1026', 7, expect.objectContaining({ client: expect.anything() }));
    expect(recordPlanChange).not.toHaveBeenCalled();
    expect(created).toMatchObject({ plan_id: 'p-trial-real', subscription_status: 'trial', trial_expires_at: '2026-11-02T00:00:00Z' });
  });

  it('요금제에 체험 일수가 없으면 30일', async () => {
    await createCompanyCore({ companyCode: 'T1026B', companyName: '체험', planId: 'p-trial0' });
    expect(grantFreeTrial).toHaveBeenCalledWith('c-1026', 30, expect.anything());
  });
});
