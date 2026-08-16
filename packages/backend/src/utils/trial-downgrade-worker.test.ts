/**
 * trial-downgrade-worker — 강등 술어·유료 가드 행동 검증 (2026-08-16, 마케팅 진단 커밋 1)
 *
 * 왜 있나
 *   헤더 주석은 plan_code 기준이라 적혀 있는데 실제 WHERE는 status 단독이었다 — status가
 *   덮인 TRIAL 회사는 체험이 영구 무료로 남는 구멍(설계서 §4-2). 술어를 SELECT·UPDATE 공유
 *   상수로 올리고, 유료 플랜을 FREE로 덮는 사고(청구 원장 0원 소급 불가)를 가드로 막는다.
 *   소스 스캔은 조건 반전을 못 잡으므로(LESSONS_BACKEND 2026-08-01) 호출 행동을 직접 단정한다.
 *
 * 못 박는 것
 *   1. 만료 체험(비유료 plan)은 강등된다 — UPDATE→이력(trial_expire)→COMMIT.
 *   2. 유료 plan + status='trial' 조합은 강등하지 않고 경고만 남긴다(가드).
 *   3. TRIAL plan 자체는 가격이 있어도 가드 비대상 — plan 미배정(NULL)도 비대상.
 *   4. targets SELECT와 UPDATE가 같은 술어 상수를 공유하고, 술어는 status 축·TRIAL plan 축·
 *      만료일 근거(IS NOT NULL + < NOW())를 전부 담는다 — 축 하나를 지우면 여기가 빨간불.
 *   5. 경쟁 탈락(UPDATE 0행)은 이력 없이 ROLLBACK. 이력 실패는 그 회사만 경보, 나머지는 계속.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/database', () => {
  const connect = vi.fn();
  return { default: { connect }, pool: { connect }, query: vi.fn() };
});
vi.mock('./plan-change-log', () => ({
  recordPlanChange: vi.fn(),
  alertPlanChangeFailure: vi.fn(),
}));

import pool, { query } from '../config/database';
import { recordPlanChange, alertPlanChangeFailure } from './plan-change-log';
import {
  runTrialDowngradeJob,
  TRIAL_DOWNGRADE_TARGET_WHERE,
  PAID_PLAN_DOWNGRADE_GUARD_WHERE,
} from './trial-downgrade-worker';

const q = query as unknown as ReturnType<typeof vi.fn>;
const connect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const record = recordPlanChange as unknown as ReturnType<typeof vi.fn>;
const alertFail = alertPlanChangeFailure as unknown as ReturnType<typeof vi.fn>;

const FREE_PLAN_ID = 'ffffffff-0000-0000-0000-000000000000';
const TRIAL_PLAN_ID = 'tttttttt-0000-0000-0000-000000000000';

type Fixture = { id: string; company_name: string; plan_id: string | null; plan_code: string | null; monthly_price: string | null };

const clientQuery = vi.fn();
const client = { query: clientQuery, release: vi.fn() };

/** FREE plan·TRIAL 행수 조회 + targets 조회를 픽스처로 돌려주는 mock DB. UPDATE 결과 행수는 opts로. */
function mockDb(targets: Fixture[], opts: { updRowCount?: number; trialPlanCount?: number } = {}) {
  q.mockImplementation(async (sql: string) => {
    if (/FROM plans WHERE plan_code = 'FREE'/.test(sql)) {
      return { rows: [{ id: FREE_PLAN_ID, base_credits: 0 }] };
    }
    if (/count\(\*\)::int AS n FROM plans WHERE plan_code = 'TRIAL'/.test(sql)) {
      return { rows: [{ n: opts.trialPlanCount ?? 1 }] };
    }
    if (/LEFT JOIN plans p ON p\.id = companies\.plan_id/.test(sql)) {
      return { rows: targets };
    }
    return { rows: [], rowCount: 0 };
  });
  clientQuery.mockImplementation(async (sql: string) => {
    if (/^UPDATE companies/.test(sql.trim())) {
      const n = opts.updRowCount ?? 1;
      return { rows: n > 0 ? [{ id: 'updated' }] : [], rowCount: n };
    }
    return { rows: [], rowCount: 0 };
  });
  connect.mockResolvedValue(client);
}

function clientSqlKinds(): string[] {
  return clientQuery.mock.calls.map(([sql]) => {
    const s = String(sql).trim();
    if (/^BEGIN/.test(s)) return 'BEGIN';
    if (/^COMMIT/.test(s)) return 'COMMIT';
    if (/^ROLLBACK/.test(s)) return 'ROLLBACK';
    if (/^UPDATE companies/.test(s)) return 'UPDATE';
    return 'OTHER';
  });
}

const T1: Fixture = { id: '11111111-1111-1111-1111-111111111111', company_name: '만료체험사', plan_id: TRIAL_PLAN_ID, plan_code: 'TRIAL', monthly_price: '0.00' };
const T2: Fixture = { id: '22222222-2222-2222-2222-222222222222', company_name: '두번째사', plan_id: TRIAL_PLAN_ID, plan_code: 'TRIAL', monthly_price: '0.00' };
const PAID: Fixture = { id: '33333333-3333-3333-3333-333333333333', company_name: '유료잔존사', plan_id: 'pppppppp-0000-0000-0000-000000000000', plan_code: 'PRO', monthly_price: '1000000.00' };
const FREE_CLEANUP: Fixture = { id: '55555555-5555-5555-5555-555555555555', company_name: '상태잔존사', plan_id: FREE_PLAN_ID, plan_code: 'FREE', monthly_price: '0.00' };

let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

describe('trial-downgrade-worker — 술어·유료 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    record.mockResolvedValue(undefined);
    alertFail.mockResolvedValue(undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('픽스처① 만료 체험(TRIAL·0원)은 강등된다 — UPDATE→이력(trial_expire)→COMMIT 순서', async () => {
    mockDb([T1]);
    const r = await runTrialDowngradeJob();

    expect(clientSqlKinds()).toEqual(['BEGIN', 'UPDATE', 'COMMIT']);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      companyId: T1.id,
      toPlanId: FREE_PLAN_ID,
      changeType: 'trial_expire',
    }));
    expect(r.downgraded).toBe(1);
  });

  it('픽스처④ 유료 plan + 체험 상태 조합은 강등하지 않고 경고만 남긴다 (가드)', async () => {
    mockDb([PAID]);
    const r = await runTrialDowngradeJob();

    expect(connect).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(r.downgraded).toBe(0);
    const warned = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(warned).toContain('강등하지 않음');
    expect(warned).toContain('PRO');
  });

  it('TRIAL plan은 가격이 있어도 가드 비대상 — 강등이 진행된다 (레거시 유료 체험 코드 대비)', async () => {
    mockDb([{ ...T1, monthly_price: '100.00' }]);
    const r = await runTrialDowngradeJob();
    expect(clientSqlKinds()).toContain('UPDATE');
    expect(r.downgraded).toBe(1);
  });

  it('plan 미배정(NULL)은 가드에 걸리지 않는다 — FREE 배정으로 정합 회복', async () => {
    mockDb([{ id: '44444444-4444-4444-4444-444444444444', company_name: '미배정사', plan_id: null, plan_code: null, monthly_price: null }]);
    const r = await runTrialDowngradeJob();
    expect(clientSqlKinds()).toContain('UPDATE');
    expect(r.downgraded).toBe(1);
  });

  it('이미 FREE인 상태 청소는 이력 없이 COMMIT — FREE→FREE trial_expire 기록 금지 (적대 1R medium)', async () => {
    mockDb([FREE_CLEANUP]);
    const r = await runTrialDowngradeJob();

    expect(clientSqlKinds()).toEqual(['BEGIN', 'UPDATE', 'COMMIT']);
    expect(record).not.toHaveBeenCalled();
    expect(r.downgraded).toBe(1);
  });

  it('TRIAL 카탈로그 행 수가 1이 아니면 경고를 남긴다 (0=축 무력화·2+=오염 관측)', async () => {
    mockDb([], { trialPlanCount: 2 });
    await runTrialDowngradeJob();
    const warned = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(warned).toContain('TRIAL 행이 2개');
  });

  it('픽스처②·③ targets SELECT와 UPDATE가 같은 술어 상수를 공유한다 — 두 축 + 만료일 근거', async () => {
    mockDb([T1]);
    await runTrialDowngradeJob();

    // 술어 상수 자체가 세 근거를 전부 담는다 — 축 하나를 지우면 여기서 빨간불.
    expect(TRIAL_DOWNGRADE_TARGET_WHERE).toContain(`subscription_status = 'trial'`);
    expect(TRIAL_DOWNGRADE_TARGET_WHERE).toContain(`plan_code = 'TRIAL'`);          // 픽스처②: status 덮인 TRIAL도 잡는 축
    expect(TRIAL_DOWNGRADE_TARGET_WHERE).toContain('trial_expires_at IS NOT NULL'); // 픽스처③: 만료일 없으면 강등 금지
    expect(TRIAL_DOWNGRADE_TARGET_WHERE).toContain('trial_expires_at < NOW()');
    expect(PAID_PLAN_DOWNGRADE_GUARD_WHERE).toContain('monthly_price > 0');
    expect(PAID_PLAN_DOWNGRADE_GUARD_WHERE).toContain(`plan_code <> 'TRIAL'`);

    // 실행에 실제로 나간 SQL이 그 상수를 그대로 포함한다(단일 소스 증명 — toContain은 부재 시 실패).
    const selectSql = q.mock.calls.map(([s]) => String(s)).find((s) => /LEFT JOIN plans p ON p\.id = companies\.plan_id/.test(s));
    expect(selectSql).toBeDefined();
    expect(selectSql).toContain(TRIAL_DOWNGRADE_TARGET_WHERE);

    const updateSql = clientQuery.mock.calls.map(([s]) => String(s)).find((s) => /^UPDATE companies/.test(String(s).trim()));
    expect(updateSql).toBeDefined();
    expect(updateSql).toContain(TRIAL_DOWNGRADE_TARGET_WHERE);
    expect(updateSql).toContain(PAID_PLAN_DOWNGRADE_GUARD_WHERE);
    // 2R high — 이력 생략 판정(조회 시점 plan_id)과 갱신의 원자 결합 조건이 UPDATE에 실려 나간다.
    expect(updateSql).toContain('companies.plan_id = $4::uuid');
    const updateParams = clientQuery.mock.calls.find(([s]) => /^UPDATE companies/.test(String(s).trim()))?.[1];
    expect(updateParams).toHaveLength(4);
    expect(updateParams?.[3]).toBe(T1.plan_id);
  });

  it('경쟁 탈락(UPDATE 0행)은 이력 없이 ROLLBACK — 정상 스킵', async () => {
    mockDb([T1], { updRowCount: 0 });
    const r = await runTrialDowngradeJob();

    expect(clientSqlKinds()).toEqual(['BEGIN', 'UPDATE', 'ROLLBACK']);
    expect(record).not.toHaveBeenCalled();
    expect(r.downgraded).toBe(0);
  });

  it('이력 기록 실패는 그 회사만 ROLLBACK+경보 — 나머지 회사는 계속 처리된다', async () => {
    mockDb([T1, T2]);
    record.mockRejectedValueOnce(new Error('이력 기록 실패'));
    const r = await runTrialDowngradeJob();

    expect(alertFail).toHaveBeenCalledTimes(1);
    expect(alertFail.mock.calls[0][0]).toBe(T1.id);
    expect(clientSqlKinds()).toEqual(['BEGIN', 'UPDATE', 'ROLLBACK', 'BEGIN', 'UPDATE', 'COMMIT']);
    expect(r.downgraded).toBe(1);
  });
});
