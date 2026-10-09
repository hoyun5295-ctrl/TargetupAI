// ★ 2026-10-09 시연 회사(설계서 docs/2026-10-09-demo-company-design.md) — 발송 0 · 돈 0 · 판정 fail-closed · 사람 입구 거절 · 합성 데이터 규칙
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const { DEMO, REAL, state, mysqlCalls, poolConnect } = vi.hoisted(() => ({
  DEMO: '11111111-1111-1111-1111-111111111111',
  REAL: '22222222-2222-2222-2222-222222222222',
  state: { failWith: null as null | { code?: string; message: string } },
  mysqlCalls: [] as unknown[],
  poolConnect: vi.fn(),
}));

vi.mock('../../config/database', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    if (/SELECT is_demo FROM companies/.test(sql)) {
      if (state.failWith) { const e: any = new Error(state.failWith.message); e.code = state.failWith.code; throw e; }
      return { rows: [{ is_demo: params[0] === DEMO }] };
    }
    return { rows: [] };
  });
  return {
    query,
    mysqlQuery: vi.fn(async (...a: unknown[]) => { mysqlCalls.push(a); return []; }),
    pool: { connect: poolConnect, query },
    default: { connect: poolConnect, query },
  };
});
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { isDemoCompany, demoBlock, guardDemoLeak, DemoLeakError, __resetDemoCompanyCache } from '../demo-company';
import { bulkInsertSmsQueue, insertAlimtalkQueue, insertTestSmsQueue } from '../sms-queue';
import { prepaidDeduct, prepaidRefund } from '../prepaid';
import { autoSpamTestWithRegenerate } from '../spam-test-queue';
import { demoPhone, demoIdentity, buildDailyBatch, buildSeedData, DEMO_SEED_CUSTOMERS } from '../demo-data';
import { normalizePhone } from '../normalize';

const SRC = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const FRONT = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8');

beforeEach(() => { __resetDemoCompanyCache(); state.failWith = null; mysqlCalls.length = 0; poolConnect.mockReset(); });

describe('판정 CT — fail-closed', () => {
  it('시연 회사만 true · id 없으면 false', async () => {
    expect(await isDemoCompany(DEMO)).toBe(true);
    expect(await isDemoCompany(REAL)).toBe(false);
    expect(await isDemoCompany(null)).toBe(false);
  });
  it('칸 부재(42703)만 "시연 아님" · 그 밖의 조회 오류는 throw(모르면 보내지 않는다)', async () => {
    state.failWith = { code: '42703', message: 'column "is_demo" does not exist' };
    expect(await isDemoCompany(DEMO)).toBe(false);
    __resetDemoCompanyCache();
    state.failWith = { code: '57P01', message: 'terminating connection' };
    await expect(isDemoCompany(DEMO)).rejects.toThrow();
  });
});

describe('최후 방어 층 — 시연 회사는 큐·차감에 닿지 않는다', () => {
  it('문자 일괄 적재 · 알림톡 · 테스트 적재 = throw · MySQL 호출 0', async () => {
    const row = ['01000000001', '01000000000', '본문', 'L', '제목', null, '', DEMO, '', '', ''];
    await expect(bulkInsertSmsQueue(['SMSQ_SEND_1'], [row], true)).rejects.toBeInstanceOf(DemoLeakError);
    await expect(insertAlimtalkQueue(['SMSQ_SEND_1'], [{ phone: '01000000001', callback: '01000000000', message: 'x', templateCode: 'T', companyId: DEMO }])).rejects.toBeInstanceOf(DemoLeakError);
    await expect(insertTestSmsQueue('01000000001', '01000000000', 'x', 'S', 't1', '', { companyId: DEMO })).rejects.toBeInstanceOf(DemoLeakError);
    expect(mysqlCalls).toHaveLength(0);
  });
  it('선불 차감 = 실패로 돌려준다(원장 트랜잭션 0) · 환불 = no-op(throw 하지 않는다 · 스위퍼 루프 보호)', async () => {
    const d = await prepaidDeduct(DEMO, 3, 'LMS', 'c1');
    expect(d.ok).toBe(false);
    expect(poolConnect).not.toHaveBeenCalled();
    expect(await prepaidRefund(DEMO, 3, 'LMS', 'c1', 'fail')).toEqual({ refunded: 0, ok: true });
  });
  it('일반 회사는 그대로 통과(가드가 막지 않는다)', async () => {
    await expect(guardDemoLeak('t', REAL)).resolves.toBeUndefined();
  });
});

describe('스팸 검사 CT — 시연 회사 = 검사 발송 0 · 통과로 본다', () => {
  it('큐 등록 없이 모든 안 통과', async () => {
    const r = await autoSpamTestWithRegenerate({ companyId: DEMO, userId: 'u', callbackNumber: '01000000000', messageType: 'LMS', variants: [{ variantId: 'A', messageText: '안녕' }], isAd: true, stopOnFirstPass: true });
    expect(r.variants.map((v) => v.spamResult)).toEqual(['pass']);
    expect(r.passedVariantId).toBe('A');
    expect(r.totalTestCount).toBe(0);
    expect(mysqlCalls).toHaveLength(0);
  });
});

describe('사람 입구 미들웨어', () => {
  const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return { json: (b: unknown) => { r.body = b; } }; }; return r; };
  it('시연 = 409 DEMO_BLOCKED · 일반 = next · 판정 실패 = 503(보내지 않는다)', async () => {
    const r1 = res(); const n1 = vi.fn();
    await demoBlock({ user: { companyId: DEMO } }, r1, n1);
    expect(r1.code).toBe(409); expect(r1.body.code).toBe('DEMO_BLOCKED'); expect(n1).not.toHaveBeenCalled();
    const r2 = res(); const n2 = vi.fn();
    await demoBlock({ user: { companyId: REAL } }, r2, n2);
    expect(n2).toHaveBeenCalled();
    __resetDemoCompanyCache();
    state.failWith = { code: '08006', message: 'connection failure' };
    const r3 = res(); const n3 = vi.fn();
    await demoBlock({ user: { companyId: DEMO } }, r3, n3);
    expect(r3.code).toBe(503); expect(n3).not.toHaveBeenCalled();
  });
  it('계약: 사람이 누르는 발송·돈 입구에 미들웨어가 걸려 있다', () => {
    expect(SRC('routes', 'campaigns.ts')).toContain("router.post(['/test-send', '/:id/send', '/direct-send/commit', '/direct-send', '/brand-send'], demoBlock);");
    const c = SRC('routes', 'campaigns.ts');
    expect(c.indexOf("router.post(['/test-send'")).toBeLessThan(c.indexOf("router.post('/test-send', async"));
    expect(SRC('routes', 'dm.ts')).toContain("dmRouter.post('/:id/send-to-target', requireDmAccess, demoBlock, async");
    expect(SRC('routes', 'dm.ts')).toContain("dmRouter.post('/:id/test-send', requireDmAccess, demoBlock, async");
    expect(SRC('routes', 'spam-filter.ts')).toContain("router.post('/test', authenticate, demoBlock, async");
    expect(SRC('routes', 'balance.ts')).toContain("router.post('/deposit-request', demoBlock, async");
    expect(SRC('routes', 'payments.ts')).toContain("router.post('/inicis/prepare', demoBlock, async");
    for (const h of ["'/my-credit/recharge'", "'/my-credit/recharge-request'", "'/plan-request'"]) expect(SRC('routes', 'companies.ts')).toContain(`router.post(${h}, demoBlock, async`);
    expect(SRC('routes', 'manage-callbacks.ts')).toContain("router.post('/', demoBlock, async");
    expect(SRC('utils', 'direct-send-core.ts')).toContain('await assertNotDemoCompany(ctx.companyId);');
  });
});

describe('경로 층 계약 — 절단점은 돈·큐보다 앞', () => {
  it('여정 실행기: 시연 절단점이 잔액 확인 · 캠페인 생성 · 차감보다 앞 · 시연 기록 = demo_simulated', () => {
    const s = SRC('utils', 'journey-executor.ts');
    const cut = s.indexOf("'sent', 0, 'demo_simulated'");
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(s.indexOf('// 8. 잔액 사전 확인'));
    expect(cut).toBeLessThan(s.indexOf('// 9. campaigns INSERT'));
  });
  it('자동마케팅: 시연 절단점이 적재 표식 · createDirectSendCampaign 앞 · 담당자 통지 맨 앞 return', () => {
    const s = SRC('utils', 'continuous-operator.ts');
    const body = s.slice(s.indexOf('async function dispatchProposalSend('));
    const cut = body.indexOf("'{meta,demo}'");
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(body.indexOf("'{meta,sendStagingId}'"));
    expect(cut).toBeLessThan(body.indexOf('await createDirectSendCampaign('));
    const notify = s.slice(s.indexOf('export async function notifyOperatorAdmins('));
    expect(notify.indexOf('if (await isDemoCompany(operator.companyId)) return false;')).toBeLessThan(notify.indexOf('const phones'));
  });
  it('여정 통계: 시연 기록은 발송 수에서 빠지고 따로 센다', () => {
    const s = SRC('utils', 'journey-stats.ts');
    expect(s).toContain("AS demo_simulated_count");
    expect(s).toContain("COUNT(*) FILTER (WHERE l.status = 'sent' AND COALESCE(l.error_reason, '') <> 'demo_simulated') AS sent_count");
  });
  it('로그인: 비밀번호 변경 대상은 세션·토큰을 받지 않는다 · 화면은 변경 응답을 확인한다 · 시연 표식', () => {
    const s = SRC('utils', 'login-issue.ts');
    const gate = s.indexOf('if (user.must_change_password === true)');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(s.indexOf('const token = generateToken(payload);'));
    expect(s).toContain('isDemo: await isDemoCompany(user.company_id)');
    const login = FRONT('pages', 'LoginPage.tsx');
    expect(login).toContain("if (!res.ok) { setPwError(data?.error || '비밀번호 변경에 실패했습니다.'); return; }");
    expect(FRONT('App.tsx')).toContain('<DemoCompanyBanner />');
  });
});

describe('합성 데이터 — 도달 불가 번호 · 결정적', () => {
  it('번호 = 0100 으로 시작하는 11자리 · 수집 경로 정규화 통과', () => {
    for (const i of [0, 1, 2999, 3000 + 365 * 100]) {
      const p = demoPhone(i);
      expect(p).toMatch(/^0100\d{7}$/);
      expect(normalizePhone(p)).toBe(p);
    }
  });
  it('같은 날 = 같은 묶음(재실행 중복 0) · 다른 날 = 다른 번호대', () => {
    const a = buildDailyBatch('2026-10-20');
    expect(buildDailyBatch('2026-10-20')).toEqual(a);
    const b = buildDailyBatch('2026-10-21');
    expect(new Set(a.newCustomers.map((c) => c.phone)).size).toBe(a.newCustomers.length);
    expect(a.newCustomers.some((c) => b.newCustomers.some((d) => d.phone === c.phone))).toBe(false);
    expect(a.newCustomers.length).toBeGreaterThanOrEqual(20);
    expect(a.salesDay).toBe('2026-10-19');
    expect(a.newPurchases.every((p) => p.purchase_date.startsWith('2026-10-19'))).toBe(true);
  });
  it('시드 = 3,000명 · 수신동의 일관 · 구매 이력은 과거만(결과 소급 0 · 입력 데이터)', () => {
    const s = buildSeedData('2026-10-09');
    expect(s.customers).toHaveLength(DEMO_SEED_CUSTOMERS);
    expect(s.customers.every((c) => c.sms_opt_in === true)).toBe(true);
    expect(s.purchases.every((p) => p.purchase_date < '2026-10-09')).toBe(true);
    expect(demoIdentity(7)).toEqual(demoIdentity(7));
  });
});
