// replaces: none
/**
 * C133 F7 — 한줄로 V3 단계 개방 판정 · 로그인 소개 창(★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §2 · §11 · §14)
 *   1. 단계 개방 = 요금제가 먼저 · ENV 명단이 뒤(명단에 든 미가입 회사가 뚫리지 않는다) · 비면 닫힘
 *   2. 소개 창 = 대상 · 로그인 표식 · 포스터 3장 · 칩은 「그 회사에 지금 열린 기능」만 · 금지 문구
 *   3. 선점 순서 = 포스터 확인이 선점보다 먼저(띄울 수 없는데 노출 수만 쓰지 않는다)
 *   실 PG 판(상한 3 · 같은 로그인 한 번 · 다시 보지 않기 · 동시 요청) = c133-v3-intro.pg.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const samples = new Set<string>();
const planCtx: { value: any; fail: boolean } = { value: null, fail: false };

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../image-studio', () => ({
  findTemplateSample: (id: string) => (samples.has(id) ? { absPath: `/x/${id}.jpg`, mime: 'image/jpeg', v: 7 } : null),
}));
vi.mock('../image-studio-templates', () => ({
  listTemplatesPublic: () => [
    { id: 't-food-1', category: 'food' }, { id: 't-food-2', category: 'food' },
    { id: 't-beauty-1', category: 'beauty' }, { id: 't-beauty-2', category: 'beauty' }, { id: 't-etc-1', category: 'etc' },
  ],
}));
vi.mock('../sales-outreach-produce', () => ({ studioIndustryCategories: (code: string | null) => (code === 'beauty' ? ['beauty'] : null) }));
vi.mock('../copy-prompt-composer', () => ({ resolveCompanyIndustry: vi.fn(async () => 'beauty') }));
vi.mock('../plan-guard', async (orig) => ({
  ...(await orig() as any),
  loadPlanContext: vi.fn(async () => { if (planCtx.fail) throw new Error('plan down'); return planCtx.value; }),
}));

import { query } from '../../config/database';
import { V3_FEATURES, V3_STAGE_ENV, V3_PLAN_KEY, v3StageOpen, v3LiveWith, v3Live } from '../v3-stage';
import {
  V3_INTRO_KEY, V3_INTRO_MAX_SHOWN, V3_INTRO_POSTER_COUNT, V3_INTRO_MAX_CHIPS, V3_INTRO_CHIPS,
  INTRO_CLAIM_SQL, INTRO_DISMISS_SQL,
  isIntroAudience, introLoginMark, pickIntroPosters, introChipsFor, claimIntro, dismissIntro,
} from '../v3-intro';

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
  samples.clear();
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

describe('소개 창 — 포스터 3장(업종 먼저 · 실샘플만 · 모자라면 띄우지 않는다)', () => {
  const T = [
    { id: 'f1', category: 'food' }, { id: 'f2', category: 'food' },
    { id: 'b1', category: 'beauty' }, { id: 'b2', category: 'beauty' }, { id: 'e1', category: 'etc' },
  ];
  const has = (ids: string[]) => (id: string) => (ids.includes(id) ? { v: 3 } : null);

  it('회사 업종 카테고리를 먼저 · 모자라면 나머지에서 목록 순서대로', () => {
    expect(pickIntroPosters(T, ['beauty'], has(['f1', 'f2', 'b1', 'b2', 'e1'])).map((p) => p.id)).toEqual(['b1', 'b2', 'f1']);
    expect(pickIntroPosters(T, null, has(['f1', 'f2', 'b1', 'b2', 'e1'])).map((p) => p.id)).toEqual(['f1', 'f2', 'b1']);
    expect(pickIntroPosters(T, ['nothing'], has(['f1', 'f2', 'b1'])).map((p) => p.id)).toEqual(['f1', 'f2', 'b1']);
  });

  it('실샘플 파일이 없는 템플릿은 건너뛴다 · 주소 = 공개 실샘플 주소 + 파일 시각', () => {
    const got = pickIntroPosters(T, ['beauty'], has(['b2', 'f2', 'e1']));
    expect(got).toEqual([
      { id: 'b2', url: '/api/image-studio/template-sample/b2?v=3' },
      { id: 'f2', url: '/api/image-studio/template-sample/f2?v=3' },
      { id: 'e1', url: '/api/image-studio/template-sample/e1?v=3' },
    ]);
  });

  it('3장을 못 채우면 빈 배열(두 장만 그리지 않는다)', () => {
    expect(pickIntroPosters(T, ['beauty'], has(['b1', 'f1']))).toEqual([]);
    expect(pickIntroPosters([], null, has([]))).toEqual([]);
    expect(V3_INTRO_POSTER_COUNT).toBe(3);
  });
});

describe('소개 창 — 칩 = 그 회사에 지금 열린 기능만', () => {
  it('단계 ENV 가 전부 비었으면 이미지 스튜디오 칩 하나(아직 안 연 기능을 약속하지 않는다)', () => {
    expect(introChipsFor(CO, PAID).map((c) => c.key)).toEqual(['image-studio']);
  });

  it('열린 기능만 · 목록 순서 그대로 · 최대 4개', () => {
    process.env.V3_STAGE_BENCHMARK = '*';
    process.env.V3_STAGE_INBOX = CO;
    expect(introChipsFor(CO, PAID).map((c) => c.key)).toEqual(['image-studio', 'benchmark', 'inbox']);
    expect(introChipsFor('c-other', PAID).map((c) => c.key)).toEqual(['image-studio', 'benchmark']);
    openAll('*');
    expect(introChipsFor(CO, PAID).map((c) => c.key)).toEqual(['image-studio', 'journey-pack', 'product-insight', 'benchmark']);
    expect(V3_INTRO_MAX_CHIPS).toBe(4);
  });

  it('⛔ 미가입 · 요금제 모름 = 명단에 있어도 이미지 스튜디오 칩만', () => {
    openAll('*');
    expect(introChipsFor(CO, FREE).map((c) => c.key)).toEqual(['image-studio']);
    expect(introChipsFor(CO, null).map((c) => c.key)).toEqual(['image-studio']);
  });

  it('칩은 화면에 줄 칸만 내보낸다(내부 기능 열쇠를 싣지 않는다)', () => {
    openAll('*');
    for (const c of introChipsFor(CO, PAID)) expect(Object.keys(c).sort()).toEqual(['key', 'label', 'text']);
  });

  it('칩의 기능 열쇠 = 단계 개방 기능 목록 안 · 늘 보이는 칩은 이미지 스튜디오뿐', () => {
    expect(V3_INTRO_CHIPS.filter((c) => c.feature === null).map((c) => c.key)).toEqual(['image-studio']);
    for (const c of V3_INTRO_CHIPS) if (c.feature) expect(V3_FEATURES).toContain(c.feature);
  });

  it('금지 문구: 약속 숫자 · 「업계 최고」 · 「무료」 · 줄표 · AI 모델 이름 · 영문 제품명 0', () => {
    for (const c of V3_INTRO_CHIPS) {
      const s = `${c.label} ${c.text}`;
      expect(s).not.toMatch(/\d/);
      expect(s).not.toMatch(/업계|최고|무료|보장|—|–/);
      expect(s).not.toMatch(/opus|sonnet|haiku|gpt|claude|anthropic|gemini/i);
      expect(s.replace(/AI/g, '')).not.toMatch(/[A-Za-z]/);
    }
  });
});

describe('claimIntro — 포스터 확인이 선점보다 먼저 · 행이 돌아온 요청만 띄운다', () => {
  const enough = () => { for (const id of ['t-food-1', 't-beauty-1', 't-beauty-2']) samples.add(id); };

  it('대상이 아니거나 토큰이 없으면 DB 를 부르지 않고 띄우지 않는다', async () => {
    enough();
    expect(await claimIntro({ ...USER, userType: 'super_admin' }, 'tok')).toEqual({ show: false });
    expect(await claimIntro(USER, null)).toEqual({ show: false });
    expect(await claimIntro(null, 'tok')).toEqual({ show: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('⛔ 포스터 3장이 없으면 선점하지 않는다(노출 수를 쓰지 않는다)', async () => {
    samples.add('t-beauty-1');
    samples.add('t-food-1');
    expect(await claimIntro(USER, 'tok')).toEqual({ show: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('선점 문장이 행을 안 돌려주면(상한 · 같은 로그인 · 다시 보지 않기) 띄우지 않는다', async () => {
    enough();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await claimIntro(USER, 'tok')).toEqual({ show: false });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('행이 돌아오면 포스터 3장(업종 먼저) + 칩 · 인자 = 사용자 · 판 열쇠 · 표식 · 상한 3', async () => {
    enough();
    process.env.V3_STAGE_BENCHMARK = '*';
    mockQuery.mockResolvedValueOnce({ rows: [{ shown: 1 }] });
    const got = await claimIntro(USER, 'tok');
    expect(got).toEqual({
      show: true,
      posters: [
        { id: 't-beauty-1', url: '/api/image-studio/template-sample/t-beauty-1?v=7' },
        { id: 't-beauty-2', url: '/api/image-studio/template-sample/t-beauty-2?v=7' },
        { id: 't-food-1', url: '/api/image-studio/template-sample/t-food-1?v=7' },
      ],
      chips: [
        { key: 'image-studio', label: '이미지 스튜디오', text: '사진 한 장으로 포스터' },
        { key: 'benchmark', label: '업종 평균 비교', text: '같은 업종 평균과 견주기' },
      ],
    });
    expect(mockQuery).toHaveBeenCalledWith(INTRO_CLAIM_SQL, ['u-1', V3_INTRO_KEY, introLoginMark('tok'), V3_INTRO_MAX_SHOWN]);
    expect(V3_INTRO_MAX_SHOWN).toBe(3);
  });

  it('요금제를 못 읽으면 창은 띄우되 단계 기능 칩은 빠진다(모르면 약속하지 않는다)', async () => {
    enough();
    openAll('*');
    planCtx.fail = true;
    mockQuery.mockResolvedValueOnce({ rows: [{ shown: 2 }] });
    const got = await claimIntro(USER, 'tok');
    expect(got.show).toBe(true);
    expect((got as any).chips.map((c: any) => c.key)).toEqual(['image-studio']);
  });

  it('표가 없으면(42P01) 삼키지 않고 던진다 → 라우트가 503 으로 바꾼다', async () => {
    enough();
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('relation "user_intro_acks" does not exist'), { code: '42P01' }));
    await expect(claimIntro(USER, 'tok')).rejects.toMatchObject({ code: '42P01' });
  });

  it('다시 보지 않기: 대상만 적는다', async () => {
    expect(await dismissIntro({ ...USER, userType: 'super_admin' })).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await dismissIntro(USER)).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(INTRO_DISMISS_SQL, ['u-1', V3_INTRO_KEY]);
  });
});

describe('라우트 계약 — 로그인 필수 · 호출 상한 · 표 없음 = 503 · SQL 은 CT 에만', () => {
  const routes = back('routes/plans.ts');
  const code = routes.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

  it('두 주소 모두 authenticate + 사용자당 호출 상한', () => {
    expect(code).toContain("router.post('/v3-intro/claim', authenticate, featureSeenLimiter, async");
    expect(code).toContain("router.post('/v3-intro/dismiss', authenticate, featureSeenLimiter, async");
  });

  it('로그인 표식은 서버가 요청의 토큰에서 만든다(본문 값을 받지 않는다)', () => {
    const claim = code.slice(code.indexOf("router.post('/v3-intro/claim'"), code.indexOf("router.post('/v3-intro/dismiss'"));
    expect(claim).toContain('await claimIntro(req.user as any, bearerOf(req))');
    expect(claim).not.toContain('req.body');
    expect(claim).toContain("res.setHeader('Cache-Control', 'private, no-store');");
  });

  it('표가 없으면 503 DB_MIGRATION_PENDING(두 주소)', () => {
    expect(code.match(/handleDbMigrationError\(err, res, 'user_intro_acks'\)/g)).toHaveLength(2);
  });

  it('라우트에 표 SQL · 판정을 적지 않는다(CT 한 곳)', () => {
    expect(code).not.toContain('user_intro_acks (');
    expect(code).not.toMatch(/INSERT INTO|array_append|login_marks/);
  });
});
