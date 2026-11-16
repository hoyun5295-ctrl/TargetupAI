// replaces: none
/**
 * C133 F7 — 한줄로 V3 단계 개방 판정 · 로그인 소개 창(★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §2 · §11 · §14)
 *   1. 단계 개방 = 요금제가 먼저 · ENV 명단이 뒤(명단에 든 미가입 회사가 뚫리지 않는다) · 비면 닫힘
 *   2. 소개 창 = 대상 · 로그인 표식
 *   3. ★ 2026-11-16 C136(설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2) — 옛 판(포스터 3장 · 기능 칩)은 띄우지 않는다.
 *      순서 = 준비(노출을 쓰지 않는다) → 선점(준비한 판의 열쇠와 판정이 같을 때만 노출 한 번) · 옛 「띄울 수 없는데 노출 수만 쓰지 않는다」를 같은 뜻으로 옮김
 *   실 PG 판(상한 3 · 같은 로그인 한 번 · 다시 보지 않기 · 동시 요청) = c133-v3-intro.pg.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const planCtx: { value: any; fail: boolean } = { value: null, fail: false };

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../plan-guard', async (orig) => ({
  ...(await orig() as any),
  loadPlanContext: vi.fn(async () => { if (planCtx.fail) throw new Error('plan down'); return planCtx.value; }),
}));

import { query } from '../../config/database';
import { V3_FEATURES, V3_STAGE_ENV, V3_PLAN_KEY, v3StageOpen, v3LiveWith, v3Live } from '../v3-stage';
import {
  V3_INTRO_KEY, V3_SCENES_INTRO_KEY, STUDIO_TRIAL_INTRO_KEY, INTRO_KEYS, LIVE_INTRO_KEYS, V3_INTRO_MAX_SHOWN,
  INTRO_CLAIM_SQL, INTRO_DISMISS_SQL, INTRO_LOGIN_SEEN_SQL, INTRO_STATE_SQL,
  isIntroAudience, introLoginMark, decideIntro, peekIntro, claimIntro, dismissIntro,
} from '../v3-intro';
import { COMPANY_USAGE_SQL, GATED_CACHE_CONTROL } from '../gated-content';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');

const PAID = { planCode: 'STARTER', subscriptionStatus: 'paid', autoCampaignOverride: null, features: {} } as any;
const FREE = { planCode: 'FREE', subscriptionStatus: null, autoCampaignOverride: null, features: {} } as any;
const EXPIRED = { planCode: 'PRO', subscriptionStatus: 'expired', autoCampaignOverride: null, features: {} } as any;
const CO = 'c-1';
const USER = { userId: 'u-1', companyId: CO, userType: 'company_admin' };

const ENV_NAMES = Object.values(V3_STAGE_ENV);
const saved: Record<string, string | undefined> = {};
const openAll = (value: string) => { for (const n of ENV_NAMES) process.env[n] = value; };
beforeEach(() => {
  for (const n of ENV_NAMES) { saved[n] = process.env[n]; delete process.env[n]; }
  mockQuery.mockReset();
  planCtx.value = PAID;
  planCtx.fail = false;
});
afterEach(() => {
  for (const n of ENV_NAMES) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
});

describe('단계 개방 — 요금제가 먼저 · ENV 명단이 뒤 · 비면 닫힘', () => {
  it('요금제가 막으면 ENV 가 전 회사(*)여도 닫힘', () => {
    expect(v3StageOpen('split', CO, false, { V3_STAGE_SPLIT: '*' })).toBe(false);
    expect(v3StageOpen('split', CO, false, { V3_STAGE_SPLIT: CO })).toBe(false);
  });

  it('요금제가 허용해도 ENV 가 비었거나 명단에 없으면 닫힘 · 명단 · * 만 연다', () => {
    expect(v3StageOpen('split', CO, true, {})).toBe(false);
    expect(v3StageOpen('split', CO, true, { V3_STAGE_SPLIT: '' })).toBe(false);
    expect(v3StageOpen('split', CO, true, { V3_STAGE_SPLIT: ' , ' })).toBe(false);
    expect(v3StageOpen('split', CO, true, { V3_STAGE_SPLIT: 'c-9, c-8' })).toBe(false);
    expect(v3StageOpen('split', CO, true, { V3_STAGE_SPLIT: `c-9, ${CO}` })).toBe(true);
    expect(v3StageOpen('split', CO, true, { V3_STAGE_SPLIT: '*' })).toBe(true);
    expect(v3StageOpen('split', null, true, { V3_STAGE_SPLIT: '*' })).toBe(false);   // 회사 없는 요청
  });

  it('기능마다 자기 ENV 만 본다(다른 기능의 ENV 로 열리지 않는다)', () => {
    for (const f of V3_FEATURES) {
      const others = Object.fromEntries(V3_FEATURES.filter((x) => x !== f).map((x) => [V3_STAGE_ENV[x], '*']));
      expect(v3StageOpen(f, CO, true, others)).toBe(false);
      expect(v3StageOpen(f, CO, true, { [V3_STAGE_ENV[f]]: '*' })).toBe(true);
    }
    expect(new Set(ENV_NAMES).size).toBe(V3_FEATURES.length);
    for (const n of ENV_NAMES) expect(n).toMatch(/^V3_STAGE_[A-Z_]+$/);
    for (const f of V3_FEATURES) expect(typeof V3_PLAN_KEY[f]).toBe('string');
  });

  it('요금제 문맥으로 판정: 미가입 · 만료 · 문맥 없음 = 닫힘 · 유료 + 명단 = 열림', () => {
    openAll('*');
    for (const f of V3_FEATURES) {
      expect(v3LiveWith(f, CO, PAID)).toBe(true);
      expect(v3LiveWith(f, CO, FREE)).toBe(false);      // ⛔ 미가입 회사는 명단에 있어도 닫힘(변화 0)
      expect(v3LiveWith(f, CO, EXPIRED)).toBe(false);
      expect(v3LiveWith(f, CO, null)).toBe(false);
      expect(v3LiveWith(f, null, PAID)).toBe(false);
    }
  });

  it('v3Live: 요금제 조회가 실패하면 닫힘(모르면 열지 않는다)', async () => {
    openAll('*');
    expect(await v3Live('inbox', CO)).toBe(true);
    planCtx.fail = true;
    expect(await v3Live('inbox', CO)).toBe(false);
    expect(await v3Live('inbox', null)).toBe(false);
  });

  it('소스: 요금제 판정 줄이 ENV 읽기보다 앞에 있다', () => {
    const src = back('utils/v3-stage.ts');
    const fn = src.slice(src.indexOf('export function v3StageOpen('), src.indexOf('export function v3LiveWith('));
    expect(fn.indexOf('if (!planAllowed) return false;')).toBeGreaterThan(-1);
    expect(fn.indexOf('if (!planAllowed) return false;')).toBeLessThan(fn.indexOf('companyListAllows('));
  });
});

describe('소개 창 — 대상 · 로그인 표식', () => {
  it('대상 = 회사와 사용자 id 가 있는 고객사 사용자(슈퍼관리자 · 회사 없는 토큰 제외)', () => {
    expect(isIntroAudience(USER)).toBe(true);
    expect(isIntroAudience({ ...USER, userType: 'company_user' })).toBe(true);
    expect(isIntroAudience({ ...USER, userType: 'super_admin' })).toBe(false);
    expect(isIntroAudience({ userId: 'u-1', userType: 'company_admin' })).toBe(false);
    expect(isIntroAudience({ companyId: CO, userType: 'company_admin' })).toBe(false);
    expect(isIntroAudience(null)).toBe(false);
  });

  it('표식 = 토큰마다 다르고 같은 토큰이면 같다 · 토큰 원문을 담지 않는다 · 빈 토큰 = null', () => {
    const a = introLoginMark('token-AAAA-1111');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(introLoginMark('token-AAAA-1111')).toBe(a);
    expect(introLoginMark('token-AAAA-1112')).not.toBe(a);
    expect(a).not.toContain('AAAA');
    expect(introLoginMark('')).toBeNull();
    expect(introLoginMark('   ')).toBeNull();
    expect(introLoginMark(null)).toBeNull();
  });
});

describe('준비 → 선점 — 준비는 노출을 쓰지 않고 · 선점은 준비한 판의 열쇠와 판정이 같을 때만 쓴다(★ C136)', () => {
  // 판정이 읽는 순서: 회사 용도 → 이 로그인이 이미 창을 띄웠나 → (요금제 = 유료 → 무료체험 판 아님 · 조회 0) → 장면 판의 노출 상태
  const feed = (o: { usage?: string | null; seen?: boolean; state?: { dismissed: boolean; shown: number } } = {}) => {
    mockQuery.mockResolvedValueOnce({ rows: [{ usage_type: o.usage === undefined ? 'web' : o.usage }] });
    mockQuery.mockResolvedValueOnce({ rows: o.seen ? [{ ok: 1 }] : [] });
    mockQuery.mockResolvedValueOnce({ rows: o.state ? [o.state] : [] });
  };
  const sqls = () => mockQuery.mock.calls.map((c) => c[0]);

  it('대상이 아니거나 토큰이 없으면 DB 를 부르지 않고 띄우지 않는다', async () => {
    expect(await decideIntro({ ...USER, userType: 'super_admin' }, 'tok')).toBeNull();
    expect(await peekIntro(USER, null)).toEqual({ introKey: null });
    expect(await claimIntro(null, 'tok', V3_SCENES_INTRO_KEY)).toEqual({ show: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('준비 = 장면 판과 그 판의 글 · 읽기 문장만(선점 문장을 부르지 않는다 = 노출을 쓰지 않는다)', async () => {
    feed();
    const got: any = await peekIntro(USER, 'tok');
    expect(got.introKey).toBe(V3_SCENES_INTRO_KEY);
    expect(got.variant).toBe('scenes');
    expect(got.content.css).toContain('.v3p ');
    expect(got.content.html).toContain('data-slides');
    expect(got.content.sets).toHaveLength(3);
    expect(sqls()).toEqual([COMPANY_USAGE_SQL, INTRO_LOGIN_SEEN_SQL, INTRO_STATE_SQL]);
    for (const s of sqls()) expect(s).not.toMatch(/INSERT|UPDATE|DELETE/);
  });

  it('에이전트 전용 회사 · 없는 회사 = 띄울 것 없음(글을 주지 않는다 · 그다음 조회 0)', async () => {
    feed({ usage: 'agent' });
    expect(await peekIntro(USER, 'tok')).toEqual({ introKey: null });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await peekIntro(USER, 'tok')).toEqual({ introKey: null });
  });

  it('이 로그인이 이미 창을 띄웠으면 없음 · 장면 판을 다 띄웠거나(3번) 숨긴 계정도 없음', async () => {
    feed({ seen: true });
    expect(await decideIntro(USER, 'tok')).toBeNull();
    mockQuery.mockReset();
    feed({ state: { dismissed: false, shown: 3 } });
    expect(await decideIntro(USER, 'tok')).toBeNull();
    mockQuery.mockReset();
    feed({ state: { dismissed: true, shown: 1 } });
    expect(await decideIntro(USER, 'tok')).toBeNull();
    mockQuery.mockReset();
    feed({ state: { dismissed: false, shown: 2 } });
    expect(await decideIntro(USER, 'tok')).toEqual({ introKey: V3_SCENES_INTRO_KEY, variant: 'scenes' });
  });

  it('⛔ 선점 = 열쇠가 없거나(배포 전에 받아 둔 옛 화면) · 옛 판 · 모르는 값이면 DB 를 부르지 않고 띄우지 않는다', async () => {
    expect(await claimIntro(USER, 'tok')).toEqual({ show: false });
    expect(await claimIntro(USER, 'tok', V3_INTRO_KEY)).toEqual({ show: false });
    expect(await claimIntro(USER, 'tok', 'x')).toEqual({ show: false });
    expect(await claimIntro(USER, 'tok', 7)).toEqual({ show: false });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(LIVE_INTRO_KEYS).toEqual([V3_SCENES_INTRO_KEY, STUDIO_TRIAL_INTRO_KEY]);
  });

  it('선점 = 판정이 준비한 열쇠와 같을 때만 선점 문장 · 인자 = 사용자 · 판 열쇠 · 표식 · 상한 3', async () => {
    feed();
    mockQuery.mockResolvedValueOnce({ rows: [{ shown: 1 }] });
    expect(await claimIntro(USER, 'tok', V3_SCENES_INTRO_KEY)).toEqual({ show: true, introKey: V3_SCENES_INTRO_KEY, variant: 'scenes' });
    expect(mockQuery).toHaveBeenLastCalledWith(INTRO_CLAIM_SQL, ['u-1', V3_SCENES_INTRO_KEY, introLoginMark('tok'), V3_INTRO_MAX_SHOWN]);
    expect(V3_INTRO_MAX_SHOWN).toBe(3);
  });

  it('⛔ 준비한 판과 지금 판정이 다르면 선점하지 않는다(그 사이 판이 바뀌어도 노출 0)', async () => {
    feed();
    expect(await claimIntro(USER, 'tok', STUDIO_TRIAL_INTRO_KEY)).toEqual({ show: false });
    expect(sqls()).not.toContain(INTRO_CLAIM_SQL);
    mockQuery.mockReset();
    feed({ seen: true });
    expect(await claimIntro(USER, 'tok', V3_SCENES_INTRO_KEY)).toEqual({ show: false });
    expect(sqls()).not.toContain(INTRO_CLAIM_SQL);
  });

  it('선점 문장이 행을 안 돌려주면(같은 로그인의 다른 요청이 먼저 · 그 사이 다 띄움) 띄우지 않는다', async () => {
    feed();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await claimIntro(USER, 'tok', V3_SCENES_INTRO_KEY)).toEqual({ show: false });
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it('표가 없으면(42P01) 삼키지 않고 던진다 → 라우트가 503 으로 바꾼다(준비 · 선점 모두)', async () => {
    const gone = () => Object.assign(new Error('relation "user_intro_acks" does not exist'), { code: '42P01' });
    mockQuery.mockResolvedValueOnce({ rows: [{ usage_type: 'web' }] });
    mockQuery.mockRejectedValueOnce(gone());
    await expect(peekIntro(USER, 'tok')).rejects.toMatchObject({ code: '42P01' });
    mockQuery.mockResolvedValueOnce({ rows: [{ usage_type: 'web' }] });
    mockQuery.mockRejectedValueOnce(gone());
    await expect(claimIntro(USER, 'tok', V3_SCENES_INTRO_KEY)).rejects.toMatchObject({ code: '42P01' });
  });

  it('다시 보지 않기: 대상만 적는다 · 열쇠 없음 · 모르는 값 = 옛 판(새 판을 숨기지 않는다) · 닫힌 목록의 값은 그 판', async () => {
    expect(await dismissIntro({ ...USER, userType: 'super_admin' })).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await dismissIntro(USER)).toBe(true);
    expect(mockQuery).toHaveBeenLastCalledWith(INTRO_DISMISS_SQL, ['u-1', V3_INTRO_KEY]);
    await dismissIntro(USER, 'nope');
    expect(mockQuery).toHaveBeenLastCalledWith(INTRO_DISMISS_SQL, ['u-1', V3_INTRO_KEY]);
    await dismissIntro(USER, V3_SCENES_INTRO_KEY);
    expect(mockQuery).toHaveBeenLastCalledWith(INTRO_DISMISS_SQL, ['u-1', V3_SCENES_INTRO_KEY]);
    expect(INTRO_KEYS).toEqual([V3_INTRO_KEY, V3_SCENES_INTRO_KEY, STUDIO_TRIAL_INTRO_KEY]);
    expect(V3_INTRO_KEY).toBe('v3-intro');
  });
});

describe('라우트 계약 — 로그인 필수 · 호출 상한 · 표 없음 = 503 · SQL 은 CT 에만', () => {
  const routes = back('routes/plans.ts');
  const code = routes.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

  it('세 주소 모두 authenticate + 사용자당 호출 상한', () => {
    expect(code).toContain("router.get('/v3-intro/peek', authenticate, featureSeenLimiter, async");
    expect(code).toContain("router.post('/v3-intro/claim', authenticate, featureSeenLimiter, async");
    expect(code).toContain("router.post('/v3-intro/dismiss', authenticate, featureSeenLimiter, async");
  });

  it('로그인 표식은 서버가 요청의 토큰에서 만든다 · 본문에서 받는 것은 판 열쇠뿐 · 응답은 캐시에 남기지 않는다', () => {
    const peek = code.slice(code.indexOf("router.get('/v3-intro/peek'"), code.indexOf("router.post('/v3-intro/claim'"));
    const claim = code.slice(code.indexOf("router.post('/v3-intro/claim'"), code.indexOf("router.post('/v3-intro/dismiss'"));
    expect(peek).toContain('await peekIntro(req.user as any, bearerOf(req))');
    expect(peek).not.toContain('req.body');
    expect(claim).toContain('await claimIntro(req.user as any, bearerOf(req), req.body?.introKey)');
    expect(claim.match(/req\.body/g)).toHaveLength(1);
    for (const part of [peek, claim]) expect(part).toContain("res.setHeader('Cache-Control', GATED_CACHE_CONTROL);");
    expect(GATED_CACHE_CONTROL).toBe('private, no-store');
  });

  it('표가 없으면 503 DB_MIGRATION_PENDING(세 주소)', () => {
    expect(code.match(/handleDbMigrationError\(err, res, 'user_intro_acks'\)/g)).toHaveLength(3);
  });

  it('라우트에 표 SQL · 판정을 적지 않는다(CT 한 곳)', () => {
    expect(code).not.toContain('user_intro_acks (');
    expect(code).not.toMatch(/INSERT INTO|array_append|login_marks/);
  });
});
