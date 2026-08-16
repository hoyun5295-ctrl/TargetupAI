/**
 * grantFreeTrial — client 주입 회귀 검증 (2026-08-16, 마케팅 진단 커밋 2)
 *
 * 왜 있나
 *   마케팅 진단 submit(§4-1)은 진단 저장과 체험 지급을 한 트랜잭션으로 묶기 위해 client를 주입한다.
 *   주입 시 내부 SQL이 **전부** 그 client를 타야 한다 — 전역 query가 한 줄이라도 남으면(TRIAL 플랜 조회가
 *   그랬다 — Codex high) submit 트랜잭션 안에서 풀 커넥션을 추가 요구해 풀 고갈 데드락이 된다.
 *   기존 호출부 2곳(companies.ts grant-basic-trial · admin.ts 승인)은 무주입 경로 — 동작 불변이 계약이다.
 *
 * 못 박는 것
 *   1. 무주입 = 기존 동작: BEGIN→플랜조회→FOR UPDATE→UPDATE→이력(trial_start)→COMMIT→release,
 *      반환에 trial_expires_at·plan_code·extended가 실린다(응답 계약 — companies.ts:1951이 그대로 싣는다).
 *   2. 연장 판정 = 잠근 행의 갱신 전 값(status trial + 미래 만료) → extended true·크레딧 불변 파라미터.
 *   3. 무주입 실패 = ROLLBACK + 실패 알림 + rethrow.
 *   4. 주입 = BEGIN/COMMIT/ROLLBACK/알림/pool.connect 전부 0회 — 트랜잭션·알림은 호출부 소유.
 *      모든 SQL(플랜 조회 포함)과 recordPlanChange가 주입 client를 탄다.
 *   5. 주입 실패 = 그대로 throw만(호출부가 ROLLBACK) — 여기서 알림·ROLLBACK을 걸면 이중 처리.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => {
  const connect = vi.fn();
  return { default: { connect }, pool: { connect }, query: vi.fn() };
});
vi.mock('./plan-change-log', () => ({
  recordPlanChange: vi.fn(),
  alertPlanChangeFailure: vi.fn(),
}));

import pool from '../config/database';
import { recordPlanChange, alertPlanChangeFailure } from './plan-change-log';
import { grantFreeTrial } from './basic-trial';

const connect = (pool as any).connect as ReturnType<typeof vi.fn>;
const record = recordPlanChange as unknown as ReturnType<typeof vi.fn>;
const alertFail = alertPlanChangeFailure as unknown as ReturnType<typeof vi.fn>;

const TRIAL_PLAN_ID = 'aaaaaaaa-0000-0000-0000-000000000000';
const COMPANY_ID = 'cccccccc-0000-0000-0000-000000000000';
const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

type ClientOpts = {
  trialPlanRows?: any[];
  companyRow?: any | null;
  updateThrows?: boolean;
};

function makeClient(opts: ClientOpts = {}) {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  const clientQuery = vi.fn(async (sql: string, params?: any[]) => {
    const s = String(sql).trim();
    calls.push({ sql: s, params });
    if (/^BEGIN|^COMMIT|^ROLLBACK/.test(s)) return { rows: [], rowCount: 0 };
    if (/FROM plans WHERE plan_code = 'TRIAL'/.test(s)) {
      return { rows: opts.trialPlanRows ?? [{ id: TRIAL_PLAN_ID, credits: 750 }] };
    }
    if (/FOR UPDATE/.test(s)) {
      const row = opts.companyRow === undefined
        ? { subscription_status: null, trial_expires_at: null }
        : opts.companyRow;
      return { rows: row === null ? [] : [row] };
    }
    if (/^UPDATE companies/.test(s)) {
      if (opts.updateThrows) throw new Error('UPDATE 실패');
      return {
        rows: [{
          id: COMPANY_ID, plan_id: TRIAL_PLAN_ID, subscription_status: 'trial',
          trial_expires_at: FUTURE, plan_code: 'TRIAL',
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  return { client: { query: clientQuery, release: vi.fn() }, calls, clientQuery };
}

function kinds(calls: Array<{ sql: string }>): string[] {
  return calls.map(({ sql }) => {
    if (/^BEGIN/.test(sql)) return 'BEGIN';
    if (/^COMMIT/.test(sql)) return 'COMMIT';
    if (/^ROLLBACK/.test(sql)) return 'ROLLBACK';
    if (/FROM plans WHERE plan_code = 'TRIAL'/.test(sql)) return 'PLAN';
    if (/FOR UPDATE/.test(sql)) return 'LOCK';
    if (/^UPDATE companies/.test(sql)) return 'UPDATE';
    return 'OTHER';
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  record.mockResolvedValue(undefined);
  alertFail.mockResolvedValue(undefined);
});

describe('grantFreeTrial — 무주입(기존 호출부 2곳) 회귀', () => {
  it('신규 부여: BEGIN→플랜조회→잠금→UPDATE→COMMIT + trial_start 이력 + 반환 계약', async () => {
    const { client, calls } = makeClient();
    connect.mockResolvedValue(client);

    const r = await grantFreeTrial(COMPANY_ID, 7);

    expect(kinds(calls)).toEqual(['BEGIN', 'PLAN', 'LOCK', 'UPDATE', 'COMMIT']);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      client, companyId: COMPANY_ID, toPlanId: TRIAL_PLAN_ID, changeType: 'trial_start',
      reason: '무료체험 7일 부여',
    }));
    // 응답 계약 — companies.ts grant-basic-trial이 이 반환을 그대로 싣는다(§4-1은 trial_expires_at 사용).
    expect(r).toMatchObject({
      id: COMPANY_ID, plan_code: 'TRIAL', trial_expires_at: FUTURE, extended: false,
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('연장: 잠근 행이 trial+미래 만료면 extended=true·추가 부여 reason·크레딧 보존 파라미터', async () => {
    const { client, calls } = makeClient({
      companyRow: { subscription_status: 'trial', trial_expires_at: FUTURE },
    });
    connect.mockResolvedValue(client);

    const r = await grantFreeTrial(COMPANY_ID, 30);

    expect(r.extended).toBe(true);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ reason: '무료체험 30일 추가 부여' }));
    const upd = calls.find((c) => /^UPDATE companies/.test(c.sql));
    expect(upd?.params).toEqual([TRIAL_PLAN_ID, 30, 750, COMPANY_ID, true]);
  });

  it('실패(UPDATE throw): ROLLBACK + 실패 알림 + rethrow', async () => {
    const { client, calls } = makeClient({ updateThrows: true });
    connect.mockResolvedValue(client);

    await expect(grantFreeTrial(COMPANY_ID, 7)).rejects.toThrow('UPDATE 실패');
    expect(kinds(calls)).toContain('ROLLBACK');
    expect(alertFail).toHaveBeenCalledWith(COMPANY_ID, expect.any(Error));
    expect(record).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('TRIAL 요금제 미존재: 명시 오류로 실패한다', async () => {
    const { client } = makeClient({ trialPlanRows: [] });
    connect.mockResolvedValue(client);
    await expect(grantFreeTrial(COMPANY_ID, 7)).rejects.toThrow('무료체험 요금제가 존재하지 않습니다.');
  });
});

describe('grantFreeTrial — client 주입(마케팅 진단 submit 전용 경로)', () => {
  it('트랜잭션·알림 0회 — 모든 SQL(플랜 조회 포함)과 이력이 주입 client를 탄다', async () => {
    const { client, calls } = makeClient();

    const r = await grantFreeTrial(COMPANY_ID, 7, { client: client as any });

    expect(connect).not.toHaveBeenCalled();                       // 풀에서 새 커넥션을 얻지 않는다
    expect(kinds(calls)).toEqual(['PLAN', 'LOCK', 'UPDATE']);     // BEGIN/COMMIT/ROLLBACK 없음
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ client, changeType: 'trial_start' }));
    expect(alertFail).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();                // 커넥션 수명도 호출부 소유
    expect(r).toMatchObject({ trial_expires_at: FUTURE, extended: false });
  });

  it('주입 경로 실패는 그대로 throw만 — ROLLBACK·알림은 호출부 몫(이중 처리 금지)', async () => {
    const { client, calls } = makeClient({ updateThrows: true });

    await expect(grantFreeTrial(COMPANY_ID, 7, { client: client as any })).rejects.toThrow('UPDATE 실패');
    expect(kinds(calls)).not.toContain('ROLLBACK');
    expect(alertFail).not.toHaveBeenCalled();
  });
});
