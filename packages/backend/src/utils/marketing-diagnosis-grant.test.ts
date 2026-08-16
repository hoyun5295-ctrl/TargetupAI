/**
 * marketing-diagnosis-grant — 지급 판정 순서·실행 검증 (2026-08-16, Codex 적대 커밋 2~4 1R 수용분)
 *
 * 못 박는 것
 *   1. 기지급 판정이 plan 검사보다 먼저다 — 지급 성공 직후 재시도(회사는 이미 TRIAL)가
 *      not_applicable(400)이 아니라 already_granted로 떨어져야 재호출 안정 계약이 산다.
 *   2. FREE + 이력 없음 = granted / FREE + 만료일 잔존 = not_eligible / 유료 = not_applicable.
 *   3. executeGrant의 grants UNIQUE 충돌은 GrantConflictError로 던진다(호출부 롤백 계약).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./basic-trial', () => ({ grantFreeTrial: vi.fn() }));

import { grantFreeTrial } from './basic-trial';
import {
  judgeGrantEligibility, executeGrant, GrantConflictError,
  isDiagnosisRunner, judgeDiagnosisEligible,
} from './marketing-diagnosis-grant';

const grant = grantFreeTrial as unknown as ReturnType<typeof vi.fn>;
const COMPANY = 'cccccccc-0000-0000-0000-000000000000';
const DX = 'dddddddd-0000-0000-0000-000000000000';

type ClientOpts = {
  companyRow?: any | null;
  hasGrant?: boolean;
  hasTrialStartHistory?: boolean;
  grantInsertCode?: string;
};

function makeClient(opts: ClientOpts = {}) {
  const clientQuery = vi.fn(async (sql: string) => {
    const s = String(sql);
    if (/FOR UPDATE OF c/.test(s)) {
      const row = opts.companyRow === undefined
        ? { id: COMPANY, subscription_status: null, trial_expires_at: null, plan_code: 'FREE' }
        : opts.companyRow;
      return { rows: row === null ? [] : [row] };
    }
    if (/FROM diagnosis_trial_grants WHERE company_id/.test(s)) {
      return { rows: opts.hasGrant ? [{ ok: 1 }] : [] };
    }
    if (/FROM company_plan_changes/.test(s)) {
      return { rows: opts.hasTrialStartHistory ? [{ ok: 1 }] : [] };
    }
    if (/INSERT INTO diagnosis_trial_grants/.test(s)) {
      if (opts.grantInsertCode) {
        const err: any = new Error('duplicate key');
        err.code = opts.grantInsertCode;
        throw err;
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query: clientQuery } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  grant.mockResolvedValue({ trial_expires_at: '2026-08-23T00:00:00Z' });
});

/**
 * ★2026-08-17 Harold 확정 — 진단 진입·제출은 고객사 관리자 전용.
 * 완주는 회사당 1회이고 되돌릴 수 없으며(§3-3), 7일 체험 지급이 회사 계약 상태를 바꾼다.
 * 담당자가 답한 진단이 회사의 유일한 기록으로 굳고 체험 1회가 소진되는 것을 막는다.
 * 문자열 값이 판정의 전부라 여기서 못 박는다(로그인이 `user_type='admin'` → JWT `company_admin`).
 */
describe('진단 실행 자격 — 고객사 관리자 전용', () => {
  it('company_admin만 실행자다', () => {
    expect(isDiagnosisRunner('company_admin')).toBe(true);
    expect(isDiagnosisRunner('company_user')).toBe(false);
    expect(isDiagnosisRunner('super_admin')).toBe(false);
    expect(isDiagnosisRunner(undefined)).toBe(false);
    expect(isDiagnosisRunner(null)).toBe(false);
    expect(isDiagnosisRunner('admin')).toBe(false);   // DB 원값은 JWT 값이 아니다
  });

  it('eligible = FREE 정확 일치 × 관리자 — 둘 다여야 한다', () => {
    expect(judgeDiagnosisEligible({ planCode: 'FREE', userType: 'company_admin' })).toBe(true);
    expect(judgeDiagnosisEligible({ planCode: 'FREE', userType: 'company_user' })).toBe(false);
    expect(judgeDiagnosisEligible({ planCode: 'STARTER', userType: 'company_admin' })).toBe(false);
    expect(judgeDiagnosisEligible({ planCode: 'free', userType: 'company_admin' })).toBe(false); // 대문자 정확 일치
    expect(judgeDiagnosisEligible({ planCode: '', userType: 'company_admin' })).toBe(false);
  });
});

describe('judgeGrantEligibility — 판정 순서·4항', () => {
  it('기지급이 plan 검사보다 먼저다 — 지급 직후(TRIAL) 재시도가 already_granted가 된다', async () => {
    const client = makeClient({
      companyRow: { id: COMPANY, subscription_status: 'trial', trial_expires_at: '2026-08-23', plan_code: 'TRIAL' },
      hasGrant: true,
    });
    const r = await judgeGrantEligibility(client, COMPANY);
    expect(r.outcome).toBe('already_granted');   // plan을 먼저 보면 not_applicable로 오판 → 빨간불
  });

  it('FREE + 기지급·이력 없음 = granted', async () => {
    expect((await judgeGrantEligibility(makeClient(), COMPANY)).outcome).toBe('granted');
  });

  it('FREE인데 만료일 잔존(4항 ④) = not_eligible — 원장 밖 이력 흔적', async () => {
    const client = makeClient({
      companyRow: { id: COMPANY, subscription_status: null, trial_expires_at: '2026-01-01', plan_code: 'FREE' },
    });
    expect((await judgeGrantEligibility(client, COMPANY)).outcome).toBe('not_eligible');
  });

  it('trial_start 원장 이력(4항 ①) = not_eligible', async () => {
    const client = makeClient({ hasTrialStartHistory: true });
    expect((await judgeGrantEligibility(client, COMPANY)).outcome).toBe('not_eligible');
  });

  it('유료 plan(기지급 없음) = not_applicable / 회사 없음 = company_not_found', async () => {
    const paid = makeClient({ companyRow: { id: COMPANY, subscription_status: 'paid', trial_expires_at: null, plan_code: 'PRO' } });
    expect((await judgeGrantEligibility(paid, COMPANY)).outcome).toBe('not_applicable');
    const none = makeClient({ companyRow: null });
    expect((await judgeGrantEligibility(none, COMPANY)).outcome).toBe('company_not_found');
  });
});

describe('executeGrant — 지급 실행 계약', () => {
  it('grantFreeTrial(client 주입) 후 grants INSERT — 반환 = trial_expires_at, 행위자 기본값 자동', async () => {
    const client = makeClient();
    const r = await executeGrant(client, COMPANY, DX);
    expect(grant).toHaveBeenCalledWith(COMPANY, 7, { client });
    expect(r.trialExpiresAt).toBe('2026-08-23T00:00:00Z');
    const ins = client.query.mock.calls.find(([sql]: any[]) => /INSERT INTO diagnosis_trial_grants/.test(String(sql)));
    expect(ins?.[1]?.[4]).toBe('diagnosis-auto');
  });

  it('수동 부여는 행위자 스냅샷을 지급 행에 영속화한다 (2R — 감사 내구성)', async () => {
    const client = makeClient();
    await executeGrant(client, COMPANY, DX, { grantedBy: 'admin:super-1' });
    const ins = client.query.mock.calls.find(([sql]: any[]) => /INSERT INTO diagnosis_trial_grants/.test(String(sql)));
    expect(ins?.[1]?.[4]).toBe('admin:super-1');
  });

  it('grants UNIQUE 충돌(23505) = GrantConflictError — 그 외 오류는 그대로 던진다', async () => {
    await expect(executeGrant(makeClient({ grantInsertCode: '23505' }), COMPANY, DX)).rejects.toBeInstanceOf(GrantConflictError);
    await expect(executeGrant(makeClient({ grantInsertCode: '42P01' }), COMPANY, DX)).rejects.not.toBeInstanceOf(GrantConflictError);
  });
});
