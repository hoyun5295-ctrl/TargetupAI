/**
 * 기능 관심 업체 (★2026-10-06 Harold 「클릭한 업체가 누군지 · 슈퍼관리자에 나만 볼 수 있는 메뉴로」)
 *
 * 원천 = audit_logs(새 테이블 0) · 기록 = 안내 창 한 곳(PlanFeatureModal) · 열람 = FEATURE_INTEREST_VIEWER_IDS(기본 ceo) AND 등급표.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../plan-guard', () => ({
  loadPlanContext: vi.fn(async (id: string) => ({ planName: id === 'c-paid' ? '스타터' : '무료' })),
  isActivePaidPlan: (ctx: any) => ctx?.planName === '스타터',
}));

import { query } from '../../config/database';
import { parseFeatureSeen, recordFeatureSeen, loadFeatureInterest, parseFeatureInterestQuery } from '../feature-interest';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');

beforeEach(() => { mockQuery.mockReset(); });

describe('기록 요청 정규화', () => {
  it('열람 · 요금제 보기만 · 기능 id 형식만', () => {
    expect(parseFeatureSeen({ featureId: 'auto-marketing', event: 'open' })).toEqual({ featureId: 'auto-marketing', event: 'open' });
    expect(parseFeatureSeen({ featureId: 'sns', event: 'pricing' })).toEqual({ featureId: 'sns', event: 'pricing' });
    expect(parseFeatureSeen({ featureId: 'login-promo', event: 'go' })).toEqual({ featureId: 'login-promo', event: 'go' });
    expect(parseFeatureSeen({ featureId: 'sns', event: 'click' })).toBeNull();
    expect(parseFeatureSeen({ featureId: "x'; DROP", event: 'open' })).toBeNull();
    expect(parseFeatureSeen({ featureId: 'A-UPPER', event: 'open' })).toBeNull();
    expect(parseFeatureSeen(null)).toBeNull();
  });
});

describe('기록 — 고객사 사용자만 audit_logs 에 남는다', () => {
  const req = (user: any) => ({ user, ip: '1.2.3.4', headers: { 'user-agent': 'ua' } });

  it('고객사 사용자 = action · 기능 · 회사가 남는다', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const ok = await recordFeatureSeen(req({ userId: 'u1', companyId: 'c1', userType: 'company_user' }), { featureId: 'auto-marketing', event: 'open' });
    expect(ok).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO audit_logs');
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe('plan_feature_open');
    expect(params[2]).toBe('plan_feature');
    expect(JSON.parse(params[4])).toEqual({ featureId: 'auto-marketing', companyId: 'c1' });
  });

  it('슈퍼관리자 · 회사 없는 토큰은 남기지 않는다', async () => {
    expect(await recordFeatureSeen(req({ userId: 's1', userType: 'super_admin' }), { featureId: 'sns', event: 'open' })).toBe(false);
    expect(await recordFeatureSeen(req({ userId: 'u1', userType: 'company_user' }), { featureId: 'sns', event: 'open' })).toBe(false);
    expect(await recordFeatureSeen(req(null), { featureId: 'sns', event: 'open' })).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('집계 — 회사 · 기능별', () => {
  const rows = [
    { action: 'plan_feature_pricing', created_at: '2026-10-06T07:42:00Z', feature_id: 'auto-marketing', company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티' },
    { action: 'plan_feature_open', created_at: '2026-10-06T07:41:00Z', feature_id: 'auto-marketing', company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티' },
    { action: 'plan_feature_open', created_at: '2026-10-06T07:38:00Z', feature_id: 'image-studio', company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티' },
    { action: 'plan_feature_open', created_at: '2026-10-06T07:30:00Z', feature_id: 'auto-marketing', company_id: 'c-free', user_name: '이직원', login_id: 'beauty02', company_name: '표본뷰티' },
    { action: 'plan_feature_open', created_at: '2026-10-06T02:00:00Z', feature_id: 'sns', company_id: 'c-paid', user_name: '박점장', login_id: 'cafe', company_name: '표본카페' },
  ];

  /** 가짜 DB — 같은 원장 행으로 SQL 네 개(묶음 · 사람 · 최근 기록 · 회사 이름)를 흉내 낸다(실제 SQL 보다 관대하지 않게 · 묶음은 전부 센다) */
  function fakeDb(raw: typeof rows) {
    mockQuery.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes('GROUP BY 1, 2, 3')) {
        const m = new Map<string, any>();
        for (const r of raw) {
          const k = `${r.company_id}|${r.feature_id}|${r.action}`;
          const v = m.get(k) || { company_id: r.company_id, feature_id: r.feature_id, action: r.action, n: 0, last_at: r.created_at };
          v.n += 1;
          if (r.created_at > v.last_at) v.last_at = r.created_at;
          m.set(k, v);
        }
        return { rows: Array.from(m.values()) };
      }
      if (q.includes('SELECT DISTINCT')) {
        const m = new Map<string, any>();
        for (const r of raw) m.set(`${r.company_id}|${r.login_id}`, { company_id: r.company_id, login_id: r.login_id, user_name: r.user_name });
        return { rows: Array.from(m.values()) };
      }
      if (q.includes('ROW_NUMBER()')) {
        const byC = new Map<string, any[]>();
        for (const r of [...raw].sort((x, y) => (x.created_at < y.created_at ? 1 : -1))) {
          const list = byC.get(r.company_id) || [];
          if (list.length < 30) list.push(r);
          byC.set(r.company_id, list);
        }
        return { rows: Array.from(byC.values()).flat().sort((x, y) => (x.created_at < y.created_at ? 1 : -1)) };
      }
      if (q.includes('FROM companies')) {
        const m = new Map<string, any>();
        for (const r of raw) m.set(r.company_id, { id: r.company_id, company_name: r.company_name });
        return { rows: Array.from(m.values()) };
      }
      throw new Error('예상 밖 SQL: ' + q.slice(0, 60));
    });
  }

  it('요약 · 기능별 · 업체별이 기록과 맞는다', async () => {
    fakeDb(rows);
    const d = await loadFeatureInterest(parseFeatureInterestQuery({ period: 'all' }));
    expect(d.summary).toEqual({ companies: 2, opens: 4, pricingCompanies: 1, unsubscribedCompanies: 1 });
    const am = d.features.find((f) => f.featureId === 'auto-marketing');
    expect(am).toEqual({ featureId: 'auto-marketing', companies: 1, pricingCompanies: 1, goCompanies: 0, opens: 2 });
    const beauty = d.companies.find((c) => c.companyId === 'c-free')!;
    expect(beauty.companyName).toBe('표본뷰티');
    expect(beauty.subscribed).toBe(false);
    expect(beauty.pricingClicks).toBe(1);
    expect(beauty.lastAt).toBe('2026-10-06T07:42:00.000Z');
    expect(beauty.users.map((u) => u.loginId).sort()).toEqual(['beauty01', 'beauty02']);
    expect(beauty.features[0]).toEqual({ featureId: 'auto-marketing', opens: 2 });
    expect(beauty.events[0].event).toBe('pricing');
    expect(d.companies.find((c) => c.companyId === 'c-paid')!.planName).toBe('스타터');
    expect(d.companies[0].companyId).toBe('c-free'); // 마지막 본 순
  });

  it('★ Codex 1R — 오래된 「요금제 보기」도 기능별 막대에 남는다(상세 30건 밖이어도 수는 전부 센다)', async () => {
    const old = { action: 'plan_feature_pricing', created_at: '2026-10-01T00:00:00Z', feature_id: 'journeys', company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티' };
    const many = Array.from({ length: 35 }, (_, i) => ({
      action: 'plan_feature_open', created_at: `2026-10-06T08:${String(i).padStart(2, '0')}:00Z`, feature_id: 'image-studio',
      company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티',
    }));
    fakeDb([old, ...many]);
    const d = await loadFeatureInterest(parseFeatureInterestQuery({ period: 'all' }));
    const beauty = d.companies[0];
    expect(beauty.events).toHaveLength(30);
    expect(beauty.events.some((e) => e.featureId === 'journeys')).toBe(false); // 상세에는 없어도
    expect(d.features.find((f) => f.featureId === 'journeys')).toEqual({ featureId: 'journeys', companies: 0, pricingCompanies: 1, goCompanies: 0, opens: 0 }); // 수에는 있다
    expect(beauty.pricingClicks).toBe(1);
  });

  it('요금제 미가입만 · 기간 전체는 시각 조건이 없고 · 기능을 고르면 그 조건이 붙는다', async () => {
    fakeDb(rows);
    const d = await loadFeatureInterest(parseFeatureInterestQuery({ period: 'all', plan: 'unsubscribed', featureId: 'auto-marketing' }));
    expect(d.companies.map((c) => c.companyId)).toEqual(['c-free']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).not.toContain('al.created_at >=');
    expect(String(sql)).toContain("al.action IN ($1, $2, $3)");
    expect(String(sql)).toContain("al.details->>'featureId' = $4");
    expect(params.slice(0, 4)).toEqual(['plan_feature_open', 'plan_feature_pricing', 'plan_feature_go', 'auto-marketing']);
  });

  it('★ 로그인 안내 창 — 뜬 것(open) · 「지금 바로가기」(go)를 요금제 보기와 따로 센다', async () => {
    fakeDb([
      { action: 'plan_feature_go', created_at: '2026-10-06T09:01:00Z', feature_id: 'login-promo', company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티' },
      { action: 'plan_feature_open', created_at: '2026-10-06T09:00:00Z', feature_id: 'login-promo', company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티' },
    ]);
    const d = await loadFeatureInterest(parseFeatureInterestQuery({ period: 'all' }));
    expect(d.features).toEqual([{ featureId: 'login-promo', companies: 1, pricingCompanies: 0, goCompanies: 1, opens: 1 }]);
    expect(d.companies[0].goClicks).toBe(1);
    expect(d.companies[0].pricingClicks).toBe(0);
    expect(d.companies[0].events[0].event).toBe('go');
    expect(d.summary.pricingCompanies).toBe(0);
  });

  it('기간을 고르면 시각 조건이 붙는다 · 읽는 행 수 상한이 없다(묶음 SQL)', async () => {
    fakeDb(rows);
    await loadFeatureInterest(parseFeatureInterestQuery({ period: '7d' }));
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.filter((q) => q.includes('al.created_at >=')).length).toBe(3);
    expect(sqls.some((q) => /LIMIT \$/.test(q))).toBe(false);
  });

  it('최근 7일이 기본 · 모르는 값은 기본값', () => {
    expect(parseFeatureInterestQuery({})).toEqual({ period: '7d', featureId: null, plan: 'all' });
    expect(parseFeatureInterestQuery({ period: 'x', plan: 'y', featureId: 'BAD ID' })).toEqual({ period: '7d', featureId: null, plan: 'all' });
  });
});

describe('열람은 Harold님만 · 기록은 로그인 사용자만', () => {
  it('열람 게이트 = 전용 ENV(기본 ceo) AND 등급표(대표만 조회)', () => {
    const audit = back('utils/audit-log.ts');
    expect(audit).toContain("isSuperAdminAllowed(superAdminId, 'FEATURE_INTEREST_VIEWER_IDS', 'ceo', 'feature-interest', 'featureInterest')");
    const role = back('utils/admin-role.ts');
    const at = role.indexOf("key: 'featureInterest'");
    expect(at).toBeGreaterThan(0);
    expect(role.slice(at, at + 300)).toContain("levels: { super: 'R', lead: 'NONE', support: 'NONE' }");
  });

  it('슈퍼관리자 경로 두 개 모두 게이트를 지난다', () => {
    const admin = back('routes/admin.ts');
    expect(admin).toContain("router.get('/feature-interest/access', authenticate, requireSuperAdmin");
    const r = admin.slice(admin.indexOf("router.get('/feature-interest', authenticate, requireSuperAdmin"));
    expect(r.slice(0, 400)).toContain('if (!(await isFeatureInterestViewer(req.user?.userId)))');
  });

  it('기록 경로 = 로그인 필수 · 사용자당 호출 상한(★ Codex 1R)', () => {
    const plans = back('routes/plans.ts').replace(/\r\n/g, '\n');
    expect(plans).toContain("router.post('/feature-seen', authenticate, featureSeenLimiter, async");
    expect(plans).toContain('keyGenerator: (req: Request) => `feature-seen:${req.user?.userId || \'anon\'}`');
    expect(back('utils/feature-interest.ts')).toContain('export const FEATURE_SEEN_RATE = { windowMs: 60 * 1000, max: 30 } as const;');
  });
});

describe('화면 — 안내 창 한 곳에서 보내고 · 메뉴는 허용 계정에만', () => {
  it('창이 열릴 때 · 「요금제 보기」(두 창 모양 모두)에서 보낸다', () => {
    const modal = front('components/PlanFeatureModal.tsx');
    expect(front('utils/plan-feature-report.ts')).toContain("fetch('/api/plans/feature-seen'");
    expect(modal).toContain("import { reportPlanFeature } from '../utils/plan-feature-report';");
    expect(modal).not.toContain('function reportPlanFeature');
    expect(modal).toContain("reportPlanFeature(intro.id, 'open');");
    expect(modal).toContain("const goPricing = () => { reportPlanFeature(intro.id, 'pricing'); onClose(); navigate('/pricing'); };");
    expect(modal.match(/onClick=\{goPricing\}/g)?.length).toBe(2);
    expect(modal).not.toContain("onClick={() => { onClose(); navigate('/pricing'); }}");
    // 영상 창 호출보다 먼저 선언(선언 전 호출 = 실행 오류)
    expect(modal.indexOf('const goPricing =')).toBeLessThan(modal.indexOf('if (intro.video) return renderVideoLayout();'));
  });

  it('슈퍼관리자 메뉴 = 허용 응답일 때만', () => {
    const dash = front('pages/AdminDashboard.tsx');
    expect(dash).toContain("fetch('/api/admin/feature-interest/access'");
    expect(dash).toContain("...(featureInterestAllowed ? [{ key: 'featureInterest', label: '기능 관심 업체' }] : []),");
    expect(dash).toContain("{activeTab === 'featureInterest' && featureInterestAllowed && <FeatureInterestTab />}");
  });
});

/**
 * ★ 2026-10-06 로그인 안내 창(Harold 「로그인 후 팝업 · 지금 바로가기」 · 목업 승인 · 추천 3건 = 못 쓰는 회사만 · 로그인마다 한 번 · 효과 기록)
 */
describe('로그인 안내 창 — 못 쓰는 회사 · 로그인마다 한 번 · 뜬 것과 바로가기 기록', () => {
  const promo = front('components/AiOperatorLoginPromo.tsx');

  it('대상 = 허브와 같은 서버 판정이 false 일 때만(모름은 띄우지 않는다)', () => {
    expect(promo).toContain("import { fetchAiOperatorAccess } from '../utils/ai-operator-access';");
    expect(promo).toContain('if (alive && allowed === false) setEligible(true);');
  });

  it('로그인 한 번(토큰)마다 한 번 · 이미 띄웠으면 묻지도 않는다', () => {
    expect(promo).toContain('if (!mark || readSeen() === mark) return;');
    expect(promo).toContain('try { localStorage.setItem(SEEN_KEY, mark); return localStorage.getItem(SEEN_KEY) === mark; } catch { return false; }');
  });

  it('★ Codex 2R — 「한 번」은 원자적으로 잡을 수 있을 때만: 잠금이 없거나 표식을 저장 못 하면 띄우지 않는다 · 한 화면 한 번', () => {
    const show = promo.slice(promo.indexOf('// ② 표시'), promo.indexOf('// 열려 있는 동안'));
    expect(show).toContain('if (!mark || !locks?.request) return;');
    expect(show).toContain('return writeSeen(mark);');
    expect(show).toContain('if (!eligible || blocked || open || shownRef.current) return;');
    expect(show.indexOf('shownRef.current = true;')).toBeLessThan(show.indexOf('setOpen(true);'));
    expect(show).not.toContain(': claim();'); // 잠금 없는 직접 선점 분기 없음
  });

  it('★ Codex 1R — 탭 두 개여도 한 번: 탭 사이 잠금 안에서 표식을 다시 보고 잡은 탭만 띄우고 기록한다', () => {
    const show = promo.slice(promo.indexOf('// ② 표시'), promo.indexOf('// 열려 있는 동안'));
    expect(show).toContain("locks.request('ai-op-login-promo', async () => claim())");
    expect(show).toContain('if (!alive || readSeen() === mark) return false;');
    expect(show.indexOf('writeSeen(mark);')).toBeLessThan(show.indexOf('setOpen(true);'));
    expect(show.indexOf('if (!alive || !won) return;')).toBeLessThan(show.indexOf("reportPlanFeature(LOGIN_PROMO_FEATURE_ID, 'open');"));
  });

  it('★ Codex 1R — 다른 자동 안내 창(요금제 변경 알림)이 정해지기 전 · 열려 있는 동안은 기다린다(렌더 때 아는 값)', () => {
    expect(promo).toContain('if (!eligible || blocked || open || shownRef.current) return;');
    const dash = front('pages/Dashboard.tsx');
    expect(dash).toContain('const loginPromoBlocked = !planInfo || !!planChange || (!!planInfo.plan_change?.from && !!planInfo.plan_change?.to && !planChangeDone);');
    expect(dash).toContain('<AiOperatorLoginPromo blocked={loginPromoBlocked} />');
    const close = dash.slice(dash.indexOf('const closePlanChange = async () => {'), dash.indexOf("fetch('/api/companies/plan-change/ack'"));
    expect(close).toContain('setPlanChangeDone(true);');
  });

  it('★ Codex 1R — Tab · Shift+Tab 은 창 안에서만 · 닫으면 포커스 복귀', () => {
    expect(promo).toContain("if (e.key !== 'Tab') return;");
    expect(promo).toContain('if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }');
    expect(promo).toContain('prevFocus?.focus?.();');
  });

  it('뜬 것 · 지금 바로가기를 기록하고 허브로 간다', () => {
    expect(promo).toContain("reportPlanFeature(LOGIN_PROMO_FEATURE_ID, 'open');");
    expect(promo).toContain("reportPlanFeature(LOGIN_PROMO_FEATURE_ID, 'go');");
    expect(promo).toContain("navigate('/ai-operator');");
    expect(promo).toContain("export const LOGIN_PROMO_FEATURE_ID = 'login-promo';");
  });

  it('무음 · 반복 · 화면 안 재생 · 움직임 줄이기면 재생 버튼 · native dialog 0', () => {
    expect(promo).toMatch(/<video[\s\S]*?muted[\s\S]*?loop[\s\S]*?playsInline[\s\S]*?autoPlay=\{!reduceMotion\}[\s\S]*?controls=\{reduceMotion\}/);
    expect(promo).not.toMatch(/\b(alert|confirm|prompt)\(/);
  });

  it('대시보드에 붙어 있다 · 슈퍼관리자 화면은 로그인 안내 창 이름과 바로가기를 보여 준다', () => {
    expect(front('pages/Dashboard.tsx')).toContain('<AiOperatorLoginPromo blocked={loginPromoBlocked} />');
    const tab = front('components/admin/FeatureInterestTab.tsx');
    expect(tab).toContain("id === LOGIN_PROMO_ID ? '로그인 안내 창'");
    expect(tab).toContain("const next = f.featureId === LOGIN_PROMO_ID ? f.goCompanies : f.pricingCompanies;");
  });
});
