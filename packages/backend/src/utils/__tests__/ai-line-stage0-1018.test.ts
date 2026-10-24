/**
 * ai-line-stage0-1018.test.ts — AI 한줄로 설계서(docs/2026-10-18-ai-line-design.md) §2 · 0단계 운영 결함 4건 회귀
 *
 * 0-1 허브 제안 = 대상 0명이면 문안이 나와도 0 · 0-2 허브 대상 수 = 승인 발송과 같은 매장 범위
 * 0-3 허브 조건 해석기 = 브랜드(store_code) 조건을 소속 표로 · 0-4 이번달 사용금액 카드 = 발송 현황과 같은 CT
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import { resolveHubStoreScope } from '../store-scope';
import { buildFilterWhereClauseCompat } from '../customer-filter';
import { isUnresolvedEmptyTarget } from '../all-customers-signal';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const q = query as unknown as ReturnType<typeof vi.fn>;

function db(o: { dbUserType?: string; storeCodes?: string[] | null; myMatch?: boolean; companyHasRows?: boolean }) {
  q.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT user_type FROM users')) return { rows: o.dbUserType ? [{ user_type: o.dbUserType }] : [] };
    if (sql.includes('FROM users')) return { rows: [{ store_codes: o.storeCodes ?? null }] };
    if (sql.includes('customer_stores') && sql.includes('ANY(')) return { rows: [{ has_match: !!o.myMatch }] };
    if (sql.includes('customer_stores')) return { rows: [{ has_stores: !!o.companyHasRows }] };
    if (sql.includes('allow_user_full_access')) return { rows: [{ allow_user_full_access: false }] };
    return { rows: [] };
  });
}

beforeEach(() => { q.mockReset(); });

describe('0-2 resolveHubStoreScope = 승인 발송 판정 원형', () => {
  it('관리자(JWT) = 범위 없음 · DB 조회 0', async () => {
    db({});
    expect(await resolveHubStoreScope(COMPANY, USER, 'company_admin')).toEqual({ storeFilter: '', baseParams: [COMPANY], blocked: false });
    expect(q).not.toHaveBeenCalled();
  });
  it('담당자 + 배정 코드 = 소속 표 조건($1 회사 · $2 코드)', async () => {
    db({ storeCodes: ['CPB'], myMatch: true, companyHasRows: true });
    const s = await resolveHubStoreScope(COMPANY, USER, 'company_user');
    expect(s.blocked).toBe(false);
    expect(s.baseParams).toEqual([COMPANY, ['CPB']]);
    expect(s.storeFilter).toContain('customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[])');
  });
  it('담당자 + 분류 체계 있는데 미배정 = 막힘', async () => {
    db({ storeCodes: null, companyHasRows: true });
    expect((await resolveHubStoreScope(COMPANY, USER, 'company_user')).blocked).toBe(true);
  });
  it('유형을 모르면(플래너 문안 등) DB 유형으로 — user = 담당자 판정', async () => {
    db({ dbUserType: 'user', storeCodes: ['A'], myMatch: true, companyHasRows: true });
    const s = await resolveHubStoreScope(COMPANY, USER, undefined);
    expect(s.baseParams).toEqual([COMPANY, ['A']]);
  });
  it('유형을 모르고 DB 유형이 관리자면 범위 없음', async () => {
    db({ dbUserType: 'admin' });
    expect((await resolveHubStoreScope(COMPANY, USER, null)).storeFilter).toBe('');
  });
});

describe('0-3 허브 조건 해석기 · 브랜드 조건', () => {
  it('store_code 단독 = 소속 표 조건(옛: 빈 조각 → 회사 전체)', () => {
    const r = buildFilterWhereClauseCompat({ store_code: { operator: 'eq', value: 'CPB' } }, 2);
    expect(r.sql).toContain('customer_stores');
    expect(r.sql).toContain('company_id = $1');
    expect(r.params).toEqual(['CPB']);
  });
  it('여러 브랜드(in) = 배열 한 자리', () => {
    const r = buildFilterWhereClauseCompat({ store_code: { operator: 'in', value: ['A', 'B'] } }, 3);
    expect(r.sql).toContain('ANY($3::text[])');
    expect(r.params).toEqual([['A', 'B']]);
  });
  it('★ Codex 1R — 몰 동의 범위 = 같은 소속 행의 동의 · 관리자 = 몰 동의 코드일 때만', () => {
    const strict = buildFilterWhereClauseCompat({ store_code: { operator: 'eq', value: 'A' } }, 2, { storeConsent: true });
    expect(strict.sql).toContain('mcs.sms_opt_in = true');
    const admin = buildFilterWhereClauseCompat({ store_code: { operator: 'eq', value: 'A' } }, 2, { storeConsentMallCodes: ['A'] });
    expect(admin.sql).toContain("mcs.sms_opt_in = true OR NOT (mcs.store_code = ANY(ARRAY['A']::text[]))");
    expect(buildFilterWhereClauseCompat({ store_code: { operator: 'eq', value: 'A' } }, 2).sql).not.toContain('sms_opt_in');
  });
  it('브랜드 단독 조건은 「옮기지 못함」이 아니다', () => {
    expect(isUnresolvedEmptyTarget({ filters: { store_code: { operator: 'eq', value: 'CPB' } }, all_customers: false })).toBe(false);
  });
});

describe('0-1 · 0-2 · 0-4 소스 계약', () => {
  const ai = read('routes/ai.ts');
  const orch = read('services/ai-orchestrator.ts');
  const comp = read('routes/companies.ts');
  it('허브 제안 = chargeOnlyWithTarget + 요청 사용자 유형', () => {
    expect(ai).toMatch(/source: 'ai-operator-propose', cost: 5, chargeOnlyWithTarget: true/);
    expect(ai).toMatch(/userType: req\.user\?\.userType \?\? null/);
  });
  it('orchestrateWithAI 도 0명이면 차감하지 않는다', () => {
    // ★ 2026-10-24 두 경로의 돈 = 한 곳(chargeOrchestrate) — orchestrateWithAI 도 그 함수를 지난다
    const fn = orch.slice(orch.indexOf('export async function orchestrateWithAI'), orch.indexOf('async function _orchestrateWithAIImpl'));
    expect(fn).toContain('return chargeOrchestrate(ctx, creditOpts, () => _orchestrateWithAIImpl(ctx));');
    const charge = orch.slice(orch.indexOf('async function chargeOrchestrate('), orch.indexOf('export async function orchestrate('));
    expect(charge).toContain('chargeOnlyWithTarget');
    expect(charge).toMatch(/result\.target\?\.count \?\? 0\) > 0/);
  });
  it('허브 대상 수 두 갈래 모두 범위 CT', () => {
    expect((orch.match(/resolveHubStoreScope\(ctx\.companyId, ctx\.userId, ctx\.userType\)/g) || []).length).toBe(2);
    expect(orch).not.toMatch(/countFilteredCustomers\(ctx\.companyId, targetResult\.filters, ctx\.userId \|\| ''\)/);
  });
  it('승인 발송 · 1위 고객 = 같은 범위 CT(인라인 getStoreScope 블록 제거)', () => {
    const preview = ai.slice(ai.indexOf("router.post('/operator/preview-recipients'"), ai.indexOf("router.get('/operator/segments'"));
    expect(preview).toContain('resolveHubStoreScope(companyId, userId, userType)');
    expect(preview).not.toContain('getStoreScope(');
  });
  it('이번달 사용금액 카드 = computeMonthlyUsage(옛 balance_transactions 합 제거)', () => {
    const start = comp.indexOf("case 'monthly_spend': {");
    const block = comp.slice(start, comp.indexOf('break;', start)).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(block).toContain('computeMonthlyUsage(companyId');
    expect(block).not.toContain('balance_transactions');
  });
});
