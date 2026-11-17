/**
 * 기능 관심 업체 (★2026-10-06 Harold 「클릭한 업체가 누군지 · 슈퍼관리자에 나만 볼 수 있는 메뉴로」)
 *
 * 원천 = audit_logs(새 테이블 0) · 기록 = 안내 창 한 곳(PlanFeatureModal) · 열람 = FEATURE_INTEREST_VIEWER_IDS(기본 ceo) AND 등급표.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { readAdminScreenSource } from './source-scan';

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
      // ★ C141 최근 누름(열람 제외 · 회사마다 체험 단추마다 · 그 밖을 6건씩) — 상세 기록 30건과 따로 읽는 문장
      if (q.includes('ROW_NUMBER()') && q.includes('AND al.action IN ($2, $3)')) {
        const byC = new Map<string, any[]>();
        for (const r of [...raw].filter((x) => x.action !== 'plan_feature_open').sort((x, y) => (x.created_at < y.created_at ? 1 : -1))) {
          const key = `${r.company_id}|${r.action === 'plan_feature_go' && ['line-trial', 'studio-trial'].includes(r.feature_id) ? r.feature_id : ''}`;
          const list = byC.get(key) || [];
          if (list.length < 6) list.push(r);
          byC.set(key, list);
        }
        return { rows: Array.from(byC.values()).flat().sort((x, y) => (x.created_at < y.created_at ? 1 : -1)) };
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
      if (q.includes('FROM diagnosis_trial_grants')) return { rows: [] };   // ★ C141 7일 무료체험 목록(이 파일의 회사는 받은 적 없음)
      if (q.includes('FROM companies')) {
        const m = new Map<string, any>();
        for (const r of raw) m.set(r.company_id, { id: r.company_id, company_name: r.company_name });
        return { rows: Array.from(m.values()) };
      }
      throw new Error('예상 밖 SQL: ' + q.slice(0, 60));
    });
  }

  // ★ 2026-11-16 C138 — 서버는 업체 줄만 낸다. 요약 수 · 기능별 수 · 기능 조건은 화면이 받아 둔 줄에서 센다(c138-trial-entry-interest 「화면의 걸러 보기」)
  it('업체별이 기록과 맞는다 · 서버는 요약 · 기능별 수를 따로 내지 않는다', async () => {
    fakeDb(rows);
    const d = await loadFeatureInterest(parseFeatureInterestQuery({ period: 'all' }));
    expect(Object.keys(d).sort()).toEqual(['companies', 'dismissalsKnown', 'lineTrialsKnown', 'trialsKnown']);
    expect(d.companies).toHaveLength(2);
    const beauty = d.companies.find((c) => c.companyId === 'c-free')!;
    expect(beauty.companyName).toBe('표본뷰티');
    expect(beauty.subscribed).toBe(false);
    expect(beauty.pricingClicks).toBe(1);
    expect(beauty.lastAt).toBe('2026-10-06T07:42:00.000Z');
    expect(beauty.users.map((u) => u.loginId).sort()).toEqual(['beauty01', 'beauty02']);
    expect(beauty.features[0]).toEqual({ featureId: 'auto-marketing', opens: 2, clicks: 1 });   // ★ C141 그 안내에서 누른 수(요금제 보기 1)
    expect(beauty.events[0].event).toBe('pricing');
    expect(d.companies.find((c) => c.companyId === 'c-paid')!.planName).toBe('스타터');
    expect(d.companies[0].companyId).toBe('c-free'); // 마지막 본 순
  });

  it('★ Codex 1R — 오래된 「요금제 보기」도 수에 남는다(상세 30건 밖이어도 수는 전부 센다)', async () => {
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
    expect(beauty.pricingClicks).toBe(1);                                       // 수에는 있다
    // ★ C141 Codex 구현 1R — 최근 누름은 열람을 빼고 따로 읽어 35건 열람 뒤에도 남는다(화면 「최근 일어난 일」의 원천)
    expect(beauty.recentClicks).toEqual([{ at: '2026-10-01T00:00:00.000Z', event: 'pricing', featureId: 'journeys', userName: '김담당' }]);
    // ★ C141 기능 줄 = 본 수 + 누른 수 · 본 기록이 없는 안내의 누름(오래된 요금제 보기)도 줄에 남는다(안내별 「누른 회사」에서 빠지지 않게)
    expect(beauty.features).toEqual([{ featureId: 'image-studio', opens: 35, clicks: 0 }, { featureId: 'journeys', opens: 0, clicks: 1 }]);
  });

  it('요금제 미가입만 · 기간 전체는 시각 조건이 없다 · ★ C138 기능 조건은 서버에 없다(화면이 거른다 · 보내도 무시)', async () => {
    fakeDb(rows);
    const d = await loadFeatureInterest(parseFeatureInterestQuery({ period: 'all', plan: 'unsubscribed', featureId: 'auto-marketing' }));
    expect(d.companies.map((c) => c.companyId)).toEqual(['c-free']);
    expect(d.companies[0].features.map((f) => f.featureId).sort()).toEqual(['auto-marketing', 'image-studio']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).not.toContain('al.created_at >=');
    expect(String(sql)).toContain("al.action IN ($1, $2, $3)");
    expect(String(sql)).not.toContain('$4');
    expect(params).toEqual(['plan_feature_open', 'plan_feature_pricing', 'plan_feature_go']);
  });

  it('★ 로그인 안내 창 — 뜬 것(open) · 「지금 바로가기」(go)를 요금제 보기와 따로 센다', async () => {
    fakeDb([
      { action: 'plan_feature_go', created_at: '2026-10-06T09:01:00Z', feature_id: 'login-promo', company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티' },
      { action: 'plan_feature_open', created_at: '2026-10-06T09:00:00Z', feature_id: 'login-promo', company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티' },
    ]);
    const d = await loadFeatureInterest(parseFeatureInterestQuery({ period: 'all' }));
    expect(d.companies[0].features).toEqual([{ featureId: 'login-promo', opens: 1, clicks: 1 }]);
    expect(d.companies[0].goClicks).toBe(1);
    expect(d.companies[0].pricingClicks).toBe(0);
    expect(d.companies[0].events[0].event).toBe('go');
  });

  it('기간을 고르면 시각 조건이 붙는다 · 읽는 행 수 상한이 없다(묶음 SQL)', async () => {
    fakeDb(rows);
    await loadFeatureInterest(parseFeatureInterestQuery({ period: '7d' }));
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.filter((q) => q.includes('al.created_at >=')).length).toBe(4);   // 묶음 · 사람 · 상세 기록 · ★ C141 최근 누름
    expect(sqls.some((q) => /LIMIT \$/.test(q))).toBe(false);
  });

  it('최근 7일이 기본 · 모르는 값은 기본값', () => {
    expect(parseFeatureInterestQuery({})).toEqual({ period: '7d', plan: 'all' });
    expect(parseFeatureInterestQuery({ period: 'x', plan: 'y', featureId: 'BAD ID' })).toEqual({ period: '7d', plan: 'all' });
    expect(parseFeatureInterestQuery({ period: 'month', plan: 'subscribed', featureId: 'sns' })).toEqual({ period: 'month', plan: 'subscribed' });
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
    const dash = readAdminScreenSource(); // ★ 2026-10-09 파일 분리 E 뒤 = 본체 + 옮겨 간 화면 합본
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

  // ★ 2026-11-16 C136 — 창의 글 · 그림은 이 번들에 없고 로그인 뒤 서버가 준다(설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2).
  //   대상 · 판 · 계정당 횟수는 서버가 정한다(utils/v3-intro · 시험 = c133-v3-intro*.test.ts) · 순서 = 준비 → 그림 전부 받기 → 선점 → 띄움.
  const scenes = front('components/v3/V3ScenesPromo.tsx');
  const showPart = () => promo.slice(promo.indexOf('// ② 표시'), promo.indexOf('// 열려 있는 동안'));

  it('대상 = 서버가 띄우라고 답할 때만(모름 · 실패 · 그림을 못 받음 = 띄우지 않는다)', () => {
    expect(promo).toContain("import { claimV3Intro, peekV3Intro, type V3IntroVariant } from '../utils/v3-intro';");
    expect(promo).toContain('const peek = await peekV3Intro();');
    expect(promo).toContain('if (!alive || !peek) return;');
    expect(promo).toContain('const text = await resolveGated(peek.content);');
    expect(promo).toContain('if (!text) return;');
    expect(promo).toContain('const claimed = await claimV3Intro(peek.introKey);');
    expect(promo).toContain('if (!alive || !claimed) { text.release(); return; }');
    expect(promo).not.toContain('fetchAiOperatorAccess');   // 옛 판정(자동 마케팅을 못 쓰는 회사만)은 걷었다
    const util = front('utils/v3-intro.ts');
    expect(util).toContain("if (!r.ok || d?.success !== true || typeof d.introKey !== 'string') return null;");
    expect(util).toContain('return r.ok && d?.success === true && d.show === true && d.introKey === introKey;');
  });

  it('로그인 한 번(토큰)마다 한 번 · 이미 띄웠으면 묻지도 않는다', () => {
    expect(promo).toContain('if (!mark || readSeen() === mark) return;');
    expect(promo).toContain('try { localStorage.setItem(SEEN_KEY, mark); return localStorage.getItem(SEEN_KEY) === mark; } catch { return false; }');
  });

  it('★ Codex 2R — 「한 번」은 원자적으로 잡을 수 있을 때만: 잠금이 없거나 표식을 저장 못 하면 띄우지 않는다 · 한 화면 한 번', () => {
    const show = showPart();
    expect(show).toContain('if (!mark || !locks?.request) return;');
    expect(show).toContain('return writeSeen(mark);');
    expect(show).toContain('if (!eligible || blocked || open || askedRef.current) return;');
    expect(show.indexOf('askedRef.current = true;')).toBeLessThan(show.indexOf('setShown({'));
    expect(show).not.toContain(': take();'); // 잠금 없는 직접 선점 분기 없음
  });

  it('★ Codex 1R — 탭 두 개여도 한 번: 탭 사이 잠금 안에서 표식을 다시 보고 잡은 탭만 묻고 띄우고 기록한다', () => {
    const show = showPart();
    expect(show).toContain("locks.request('ai-op-login-promo', async () => take())");
    expect(show).toContain('if (!alive || readSeen() === mark) return false;');
    // ★ C136 — 서버에 묻는 것은 잠금을 잡은 탭만 · 이 화면에서 다시 묻지 않게 표시한 뒤 · 준비 → 그림 → 선점(= 노출 한 번) → 띄움 → 기록
    const order = [
      'writeSeen(mark);', 'if (!alive || !won) return;', 'askedRef.current = true;',
      'await peekV3Intro()', 'await resolveGated(', 'await claimV3Intro(', 'setShown({', "'open');",
    ].map((x) => show.indexOf(x));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(show.match(/claimV3Intro\(/g)).toHaveLength(1);
    expect(show.match(/peekV3Intro\(/g)).toHaveLength(1);
  });

  it('★ Codex 1R — 다른 자동 안내 창(요금제 변경 알림)이 정해지기 전 · 열려 있는 동안은 기다린다(렌더 때 아는 값)', () => {
    expect(promo).toContain('if (!eligible || blocked || open || askedRef.current) return;');
    const dash = front('pages/Dashboard.tsx');
    // ★ 2026-11-17 C140 — 마케팅 진단 초대 창(자동 안내 창)을 걷었다: 그 창과 겹치지 않으려고 진단 상태를 기다리던 조건(C133)도 없다 · 기다리는 것 = 요금제 변경 알림 하나
    expect(dash).toContain(
      'const loginPromoBlocked = !planInfo || !!planChange || (!!planInfo.plan_change?.from && !!planInfo.plan_change?.to && !planChangeDone);');
    for (const gone of ['diagnosisInviteDue', 'showDiagnosisInvite', 'diagnosisChecked']) expect(dash, gone).not.toContain(gone);
    expect(dash).toContain('<AiOperatorLoginPromo blocked={loginPromoBlocked} />');
    const close = dash.slice(dash.indexOf('const closePlanChange = async () => {'), dash.indexOf("fetch('/api/companies/plan-change/ack'"));
    expect(close).toContain('setPlanChangeDone(true);');
  });

  it('★ Codex 1R — Tab · Shift+Tab 은 창 안에서만 · 닫으면 포커스 복귀', () => {
    expect(promo).toContain("if (e.key !== 'Tab') return;");
    expect(promo).toContain('if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }');
    expect(promo).toContain('prevFocus?.focus?.();');
  });

  it('뜬 것 · 바로가기를 기록하고 이미지 스튜디오로 간다(★ C133 — 허브 → 이미지 스튜디오)', () => {
    expect(promo).toContain("reportPlanFeature(peek.variant === 'trial' ? STUDIO_TRIAL_POPUP_ID : LOGIN_PROMO_FEATURE_ID, 'open');");
    expect(promo).toContain("export const LOGIN_PROMO_FEATURE_ID = 'login-promo';");
    expect(scenes).toContain("const FEATURE_ID = 'login-promo';");
    expect(scenes).toContain("else if (act === 'go') { reportPlanFeature(FEATURE_ID, 'go'); onClose(); navigate('/image-studio'); }");
    expect(scenes).not.toContain("navigate('/ai-operator');");
  });

  it('★ C136 — 서버가 준 글만 그린다(번들에 창의 글 · 그림 0) · 바깥을 눌러도 닫히지 않는다 · native dialog 0 · 닫으면 그림 주소를 버린다', () => {
    expect(promo).not.toContain('<video');
    expect(promo).toContain("return shown.variant === 'trial' ? <StudioTrialPromo {...inner} /> : <V3ScenesPromo {...inner} />;");
    expect(promo).toContain('if (!shown) return null;');
    expect(promo).toContain('useEffect(() => () => { text?.release(); }, [text]);');
    expect(scenes).toContain('<style>{css}</style>');
    expect(scenes).toContain('dangerouslySetInnerHTML={inner}');
    // 바깥(어두운 판)에는 누름 처리가 없다 — 닫기는 X · Esc · 「다음에 볼게요」
    expect(scenes).toContain('<div className="scrim" />');
    for (const src of [promo, scenes]) expect(src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')).not.toMatch(/\b(alert|confirm|prompt)\(/);
  });

  it('★ C138 두 안내 창에는 「다시 보지 않기」가 없다(Harold 「그거 눌러버리면 홍보가 안 되는데」) · 화면 코드에도 숨기는 길 0', () => {
    const code = scenes.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    for (const gone of ['dismiss', 'useToast', 'busyRef']) expect(code, gone).not.toContain(gone);
    expect(scenes).toContain("if (act === 'close' || act === 'later') onClose();");
    // 무료체험 안내 창도 같다 = 닫는 길은 X · 「다음에 볼게요」 · 신청 실패 안내(토스트)는 그대로
    const trial = front('components/v3/StudioTrialPromo.tsx');
    expect(trial.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')).not.toMatch(/dismiss|다시 띄우지 않아요/);
    expect(trial).toContain("if (act === 'close' || act === 'later') onClose();");
    expect(trial).toContain("toast.error('지금은 열지 못했어요. 잠시 뒤 다시 눌러 주세요.');");
  });

  it('대시보드에 붙어 있다 · 슈퍼관리자 화면은 로그인 안내 창 이름과 바로가기를 보여 준다', () => {
    expect(front('pages/Dashboard.tsx')).toContain('<AiOperatorLoginPromo blocked={loginPromoBlocked} />');
    const tab = front('components/admin/FeatureInterestTab.tsx');
    // ★ 2026-11-15 C135 — 로그인 뒤 안내 창의 이름 · 다음 행동(주 버튼)은 등록부(constants/login-popups.ts)가 정한다(탭에 손으로 적지 않는다 · 새 창을 올려도 탭이 그대로 그린다)
    // ★ 2026-11-16 C138 — 등록부가 그 창의 판 열쇠(introKeys)도 쥔다(「다시 보지 않기」 기록을 창 이름으로 보여 준다)
    expect(front('constants/login-popups.ts')).toContain("{ id: 'login-promo', name: '로그인 안내 창', goLabel: '바로가기', introKeys: ['v3-scenes', 'v3-intro'] },");
    expect(tab).toContain('const featureName = (id: string) => loginPopupOf(id)?.name || FEATURE_TITLES.get(id) || id;');
    expect(tab).toContain("(e.event === 'go' ? loginPopupOf(e.featureId)?.goLabel || EVENT_LABEL.go : EVENT_LABEL[e.event])");
  });
});

/**
 * ★ 2026-10-07 업체별 표 = 한 줄 · 상세 창(Harold 목업 2안 「회사명부터 다 깨진다 · 클릭하면 모달」)
 * ★ 2026-11-16 C138 = 아무 칸도 자르지 않는다(말줄임 · 말풍선을 걷었다)
 * ★ 2026-11-17 C141 통합안(Harold 「정신없다 · 칸도 벗어난다」) = 표 대신 회사 목록 · 화면 끝까지 늘이던 폭(FULL_BLEED)을 걷고 본문 폭 안에서 줄을 바꾼다
 */
describe('회사 목록 — 자르지 않는다 · 본문 폭 안 · 상세 창', () => {
  const tab = front('components/admin/FeatureInterestTab.tsx');
  const code = tab.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const list = tab.slice(tab.indexOf('{pageSlice(rows, page).map((c) => ('), tab.indexOf('<ListPager'));

  it('목록 글은 자르지 않는다 — 말줄임 0 · 회사 이름 · 상태 · 덧붙임은 칸 안에서 줄을 바꾼다(낱말 안에서 끊지 않는다)', () => {
    expect(list.length).toBeGreaterThan(500);
    for (const cut of ['truncate', 'line-clamp', 'text-ellipsis', 'overflow-hidden', 'whitespace-nowrap']) expect(list, cut).not.toContain(cut);
    expect(tab).toContain("const WRAP = 'break-keep [overflow-wrap:anywhere]';");
    expect(list.match(/\$\{WRAP\}/g)!.length).toBeGreaterThanOrEqual(2);   // 회사 이름 · 상태 칸
    // 칸 폭 = 회사 · 상태(남는 폭 전부) · 시각 · 화살표 · 좁은 화면은 한 줄씩
    expect(list).toContain('grid grid-cols-1 md:grid-cols-[minmax(0,190px)_minmax(0,1fr)_112px_16px]');
    // 옛 펼침 줄 · 표 칸 · 말풍선은 없다
    for (const gone of ['openRow', 'Fragment', 'setTip', 'fixed z-[60]', '기능별 관심', '<thead']) expect(code, gone).not.toContain(gone);
    expect(code.match(/<table /g)).toHaveLength(1);   // 상세 창의 시간순 기록 하나
  });

  it('★ C141 화면 끝까지 늘이지 않는다 — 관리자 본문 틀(1280) 안 · 폭을 재는 코드 0', () => {
    for (const gone of ['FULL_BLEED', '100vw', 'useLayoutEffect', 'getBoundingClientRect', 'clientWidth', "addEventListener('resize'", 'style.width']) expect(code, gone).not.toContain(gone);
    expect(front('pages/AdminDashboard.tsx')).toContain('<main className="max-w-7xl mx-auto px-4 md:px-6 pt-[18px] pb-10">');
  });

  it('줄을 누르면 상세 창(줄 = 단추 = Enter · Space 도) · 닫기 = X · [닫기] · ESC 만(배경 클릭 닫기 없음)', () => {
    expect(list).toContain('<button type="button" onClick={() => setDetail(c)} aria-label={`${c.companyName} 상세 보기`}');
    expect(tab).toContain('{detail && <CompanyDetailModal c={detail} dismissalsKnown={!!data?.dismissalsKnown} onClose={() => setDetail(null)} />}');
    const modal = tab.slice(tab.indexOf('function CompanyDetailModal'), tab.indexOf('export default function FeatureInterestTab'));
    expect(modal).toContain("if (e.key === 'Escape' && !e.isComposing)");
    expect(modal).toContain('role="dialog" aria-modal="true"');
    expect(modal).not.toMatch(/bg-gray-900\/45[^"]*"\s+onClick/);
    expect(modal.match(/onClick=\{onClose\}/g)?.length).toBe(2);
    // 상세 창은 받은 줄의 값만 그린다(서버 조회 추가 없음)
    expect(modal).not.toContain('fetch(');
  });

  it('줄표 · 모델명 · native dialog 0', () => {
    expect(code).not.toContain('—');
    expect(code).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
    expect(code).not.toMatch(/\b(alert|confirm|prompt)\(/);
  });
});
