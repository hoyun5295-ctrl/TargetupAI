// replaces: none
/**
 * C135 — 한줄로 V3 로그인 팝업 · 이미지 스튜디오 무료체험 3회(★ 2026-11-15 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §8)
 *   1. 체험 자격 = 지금 판정이 막는 미가입 회사뿐(기존 권한이 줄지 않는다 · 유료 회사에 체험이 닿지 않는다)
 *   2. 생성 문의 판정 · 선점 결과의 뜻(이미 쓴 키 · 다 씀) · 응답 코드
 *   3. 로그인 직후 소개 창의 체험 갈래 · 「다시 보지 않기」의 판 열쇠
 *   4. 로그인 화면 스위치
 *   5. 소스 계약 = 생성 주소의 순서(체험 판정 → 선점 → 생성 → 되돌림) · 체험이 다른 주소로 번지지 않음 · 화면 문구 규칙 · 등록부
 *   실 PG 판(신청 · 선점 · 되돌림 · 동시 요청 · 신청 업체 목록 · 판 열쇠 분리) = c135-studio-trial.pg.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const planCtx: { value: any; fail: boolean } = { value: null, fail: false };
const samples = new Set<string>();

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../image-studio', () => ({
  findTemplateSample: (id: string) => (samples.has(id) ? { absPath: `/x/${id}.jpg`, mime: 'image/jpeg', v: 7 } : null),
}));
vi.mock('../image-studio-templates', () => ({
  listTemplatesPublic: () => [{ id: 't-1', category: 'beauty' }, { id: 't-2', category: 'beauty' }, { id: 't-3', category: 'food' }],
}));
vi.mock('../sales-outreach-produce', () => ({ studioIndustryCategories: () => null }));
vi.mock('../copy-prompt-composer', () => ({ resolveCompanyIndustry: vi.fn(async () => null) }));
vi.mock('../plan-guard', async (orig) => ({
  ...(await orig() as any),
  loadPlanContext: vi.fn(async () => { if (planCtx.fail) throw new Error('plan down'); return planCtx.value; }),
}));

import { query } from '../../config/database';
import {
  STUDIO_TRIAL_GRANTED, TRIAL_READ_SQL, TRIAL_RESERVE_SQL, TRIAL_REQUEST_SQL,
  trialStatusOf, resolveStudioTrial, studioTrialGate, studioTrialView, requestStudioTrialFor,
  reserveStudioTrial, trialRefusal, trialErrorResponse, isTrialTableMissing,
} from '../studio-trial';
import { studioTrialEligible } from '../plan-guard';
import {
  claimIntro, dismissIntro, INTRO_CLAIM_SQL, INTRO_DISMISS_SQL, INTRO_STATE_SQL, INTRO_KEYS, INTRO_LOGIN_GATE_KEY,
  STUDIO_TRIAL_INTRO_KEY, V3_INTRO_KEY, V3_INTRO_MAX_SHOWN, introLoginMark,
} from '../v3-intro';
import { V3_LOGIN_INTRO_ENV, v3LoginIntroOn } from '../v3-login-intro';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const SRC = join(__dirname, '..', '..');
const FRONT = join(SRC, '..', '..', 'frontend');
const back = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
const front = (rel: string) => readFileSync(join(FRONT, 'src', rel), 'utf8').replace(/\r\n/g, '\n');

const ctx = (over: Record<string, unknown>) => ({ companyId: 'c-1', planCode: 'FREE', planName: '미가입', subscriptionStatus: null, isAiOperatorTrialActive: false, features: {}, ...over }) as any;
const FREE = ctx({});
const FREE_AI_TRIAL = ctx({ isAiOperatorTrialActive: true });
const PAID = ctx({ planCode: 'STARTER', subscriptionStatus: 'paid' });
const PRO_TRIAL = ctx({ planCode: 'TRIAL', subscriptionStatus: 'trial' });
const PAID_EXPIRED = ctx({ planCode: 'PRO', subscriptionStatus: 'expired' });
const FREE_SUSPENDED = ctx({ subscriptionStatus: 'suspended' });
const CO = 'c-1';
const USER = { userId: 'u-1', companyId: CO, userType: 'company_admin', loginId: 'kim' };
const ROW = (used: string[], granted = 3) => ({ rows: [{ granted, used_keys: used, requested_at: '2026-11-15T01:00:00Z' }] });
const NONE = { rows: [] };

let savedAllow: string | undefined;
beforeEach(() => {
  mockQuery.mockReset();
  samples.clear();
  planCtx.value = FREE;
  planCtx.fail = false;
  savedAllow = process.env.AI_OPERATOR_ALLOWED_USERS;
  delete process.env.AI_OPERATOR_ALLOWED_USERS;
});
afterEach(() => {
  if (savedAllow === undefined) delete process.env.AI_OPERATOR_ALLOWED_USERS; else process.env.AI_OPERATOR_ALLOWED_USERS = savedAllow;
});

describe('체험 자격 — 지금 판정이 막는 미가입 회사뿐', () => {
  it('미가입 + 지금 막힘 = 자격 있음', () => {
    expect(studioTrialEligible(FREE, USER)).toBe(true);
  });

  it('지금 길이 이미 열린 회사 = 자격 없음(체험이 기존 권한을 줄이지 않는다)', () => {
    expect(studioTrialEligible(FREE_AI_TRIAL, USER)).toBe(false);                    // 30일 AI 체험 중인 미가입 회사
    expect(studioTrialEligible(PAID, USER)).toBe(false);                             // 유료
    expect(studioTrialEligible(PRO_TRIAL, USER)).toBe(false);                        // PRO 무료체험
    expect(studioTrialEligible(FREE, { ...USER, userType: 'super_admin' })).toBe(false);
    process.env.AI_OPERATOR_ALLOWED_USERS = 'someone, KIM';
    expect(studioTrialEligible(FREE, USER)).toBe(false);                             // 허용 명단
    expect(studioTrialEligible(FREE, { ...USER, loginId: 'lee' })).toBe(true);        // 명단 밖 사용자는 그대로 자격 있음
  });

  it('만료 · 정지 = 자격 없음(미가입이 아니다 · 종전 403) · 요금제를 모르면 자격 없음', () => {
    expect(studioTrialEligible(PAID_EXPIRED, USER)).toBe(false);
    expect(studioTrialEligible(FREE_SUSPENDED, USER)).toBe(false);
    expect(studioTrialEligible(null, USER)).toBe(false);
    expect(studioTrialEligible(undefined, USER)).toBe(false);
  });

  it('화면에 주는 꼴 — 신청 전 = 0 · 남은 칸은 음수가 되지 않는다', () => {
    expect(trialStatusOf(null)).toEqual({ requested: false, granted: 0, used: 0, remaining: 0 });
    expect(trialStatusOf({ granted: 3, usedKeys: ['a'], requestedAt: 'x' })).toEqual({ requested: true, granted: 3, used: 1, remaining: 2 });
    expect(trialStatusOf({ granted: 3, usedKeys: ['a', 'b', 'c', 'd'], requestedAt: 'x' }).remaining).toBe(0);
    expect(STUDIO_TRIAL_GRANTED).toBe(3);
  });
});

describe('생성 문의 판정 — 체험 길은 「자격 있고 신청한 회사」뿐', () => {
  it('지금 길이 열린 회사는 체험 표를 읽지도 않는다(유료 회사 = 조회 0 · 체험 행이 있어도 종전 길)', async () => {
    expect(await resolveStudioTrial(CO, USER, PAID)).toBe(false);
    expect(await resolveStudioTrial(CO, USER, FREE_AI_TRIAL)).toBe(false);
    expect(await resolveStudioTrial(CO, USER, null)).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('미가입: 신청 행이 있으면 체험 길 · 없으면 종전 요금제 문(= 403)', async () => {
    mockQuery.mockResolvedValueOnce(ROW([]));
    expect(await resolveStudioTrial(CO, USER, FREE)).toBe(true);
    expect(mockQuery.mock.calls[0]).toEqual([TRIAL_READ_SQL, [CO]]);
    mockQuery.mockResolvedValueOnce(NONE);
    expect(await resolveStudioTrial(CO, USER, FREE)).toBe(false);
    // 다 쓴 회사도 체험 길로 들어간다 — 「다 썼다」는 답은 선점 한 곳이 한다(요금제 안내 403 이 아니라 체험 소진 403)
    mockQuery.mockResolvedValueOnce(ROW(['a', 'b', 'c']));
    expect(await resolveStudioTrial(CO, USER, FREE)).toBe(true);
  });

  it('표가 아직 없으면(42P01) 체험이 아니다 · 그 밖의 읽기 실패는 던진다', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('relation "image_studio_trials" does not exist'), { code: '42P01' }));
    expect(await resolveStudioTrial(CO, USER, FREE)).toBe(false);
    mockQuery.mockRejectedValueOnce(new Error('connection reset'));
    await expect(resolveStudioTrial(CO, USER, FREE)).rejects.toThrow('connection reset');
  });

  it('문 한 줄: 요금제 문맥을 한 번 읽어 함께 준다 · 요금제를 못 읽으면 plan = undefined(종전 문이 다시 읽어 종전 오류) · 체험 판정 실패 = 종전 문', async () => {
    mockQuery.mockResolvedValueOnce(ROW([]));
    expect(await studioTrialGate(CO, USER)).toEqual({ plan: FREE, trial: true });
    planCtx.value = PAID;
    expect(await studioTrialGate(CO, USER)).toEqual({ plan: PAID, trial: false });
    planCtx.value = null;   // 회사 없음 = 종전 문이 404
    expect(await studioTrialGate(CO, USER)).toEqual({ plan: null, trial: false });
    planCtx.fail = true;
    expect(await studioTrialGate(CO, USER)).toEqual({ plan: undefined, trial: false });
    planCtx.fail = false; planCtx.value = FREE;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockQuery.mockRejectedValueOnce(new Error('connection reset'));
    expect(await studioTrialGate(CO, USER)).toEqual({ plan: FREE, trial: false });
    quiet.mockRestore();
  });
});

describe('선점 결과의 뜻 — 칸이 남았는데 0행 = 다시 누르기 · 칸이 없을 때만 다 씀', () => {
  it('1행 = 잡았다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ used: 2, granted: 3 }] });
    expect(await reserveStudioTrial(CO, 'k')).toEqual({ state: 'ok', used: 2, granted: 3 });
    expect(mockQuery.mock.calls[0]).toEqual([TRIAL_RESERVE_SQL, [CO, 'k']]);
  });

  it('0행 + 남은 칸 있음 = spent(이미 쓴 키 · 같은 키의 겹친 요청 · 그 키가 방금 되돌려진 틈 모두)', async () => {
    mockQuery.mockResolvedValueOnce(NONE).mockResolvedValueOnce(ROW(['k']));
    expect(await reserveStudioTrial(CO, 'k')).toEqual({ state: 'spent', used: 1, granted: 3 });
    // 읽은 행에 그 키가 없어도(선점과 읽기 사이에 되돌려짐) 칸이 남았으면 「다 썼다」가 아니다
    mockQuery.mockResolvedValueOnce(NONE).mockResolvedValueOnce(ROW([]));
    expect(await reserveStudioTrial(CO, 'k')).toEqual({ state: 'spent', used: 0, granted: 3 });
  });

  it('0행 + 남은 칸 없음(행 없음 포함) = used_up', async () => {
    mockQuery.mockResolvedValueOnce(NONE).mockResolvedValueOnce(ROW(['a', 'b', 'c']));
    expect(await reserveStudioTrial(CO, 'd')).toEqual({ state: 'used_up', used: 3, granted: 3 });
    mockQuery.mockResolvedValueOnce(NONE).mockResolvedValueOnce(NONE);
    expect(await reserveStudioTrial(CO, 'd')).toEqual({ state: 'used_up', used: 0, granted: 0 });
    // 세 번째 칸을 쓴 키의 다시 요청 = 남은 칸이 없으니 다 씀
    mockQuery.mockResolvedValueOnce(NONE).mockResolvedValueOnce(ROW(['a', 'b', 'c']));
    expect((await reserveStudioTrial(CO, 'c')).state).toBe('used_up');
  });

  it('거절 응답 = spent 409 TRIAL_ATTEMPT_SPENT · used_up 403 TRIAL_USED_UP(요금제 안내 코드와 다르다)', () => {
    const spent = trialRefusal({ state: 'spent', used: 1, granted: 3 });
    expect(spent.status).toBe(409);
    expect(spent.body).toMatchObject({ success: false, code: 'TRIAL_ATTEMPT_SPENT' });
    expect(String(spent.body.error)).toContain('만들기를 한 번 더');
    const up = trialRefusal({ state: 'used_up', used: 3, granted: 3 });
    expect(up.status).toBe(403);
    expect(up.body).toMatchObject({ success: false, code: 'TRIAL_USED_UP', error: '무료체험 3회를 모두 쓰셨어요.' });
  });

  it('신청 · 상태 주소의 오류 = 표 없음 503 DB_MIGRATION_PENDING · 그 밖 503(500 을 내지 않는다)', () => {
    const missing = Object.assign(new Error('relation "image_studio_trials" does not exist'), { code: '42P01' });
    expect(isTrialTableMissing(missing)).toBe(true);
    expect(trialErrorResponse(missing)).toMatchObject({ status: 503, body: { success: false, code: 'DB_MIGRATION_PENDING' } });
    expect(String(trialErrorResponse(missing).body.error)).toContain('image_studio_trials');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const other = trialErrorResponse(new Error('boom'));
    quiet.mockRestore();
    expect(other.status).toBe(503);
    expect(other.body.code).toBeUndefined();
    expect(String(other.body.error)).not.toContain('boom');   // 원문을 고객에게 내지 않는다
  });
});

describe('신청 · 상태 — 자격 없는 회사는 행을 만들지 않는다', () => {
  it('자격 있음 = 신청 문장 + 다시 읽기 · 누른 사용자를 남긴다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockResolvedValueOnce(ROW([]));
    expect(await requestStudioTrialFor(CO, USER)).toEqual({ requested: true, granted: 3, used: 0, remaining: 3 });
    expect(mockQuery.mock.calls[0]).toEqual([TRIAL_REQUEST_SQL, [CO, 'u-1', 3]]);
    expect(TRIAL_REQUEST_SQL).toContain('ON CONFLICT (company_id) DO NOTHING');   // 두 번 눌러도 3회가 다시 차지 않는다
  });

  it('자격 없음(유료 · AI 체험 중 · 만료) = null · 쓰기 0', async () => {
    for (const p of [PAID, FREE_AI_TRIAL, PAID_EXPIRED, null]) {
      planCtx.value = p;
      expect(await requestStudioTrialFor(CO, USER)).toBeNull();
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('상태 = 자격 + 신청 · 사용', async () => {
    mockQuery.mockResolvedValueOnce(ROW(['a']));
    expect(await studioTrialView(CO, USER)).toEqual({ eligible: true, requested: true, granted: 3, used: 1, remaining: 2 });
    planCtx.value = PAID;
    mockQuery.mockResolvedValueOnce(NONE);
    expect(await studioTrialView(CO, USER)).toEqual({ eligible: false, requested: false, granted: 0, used: 0, remaining: 0 });
  });
});

describe('로그인 직후 소개 창 — 체험 갈래', () => {
  const mark = introLoginMark('tok')!;
  const fillSamples = () => { for (const id of ['t-1', 't-2', 't-3']) samples.add(id); };

  it('미가입 + 아직 신청 안 함 = 무료체험 창(판 열쇠 따로 · 포스터 조건을 보지 않는다)', async () => {
    mockQuery.mockResolvedValueOnce(NONE).mockResolvedValueOnce(NONE).mockResolvedValueOnce({ rows: [{ shown: 1 }] });
    expect(await claimIntro(USER, 'tok')).toEqual({ show: true, variant: 'trial', introKey: 'studio-trial', posters: [], chips: [] });
    expect(mockQuery.mock.calls[0]).toEqual([TRIAL_READ_SQL, [CO]]);
    expect(mockQuery.mock.calls[1]).toEqual([INTRO_STATE_SQL, ['u-1', STUDIO_TRIAL_INTRO_KEY]]);
    expect(mockQuery.mock.calls[2]).toEqual([INTRO_CLAIM_SQL, ['u-1', STUDIO_TRIAL_INTRO_KEY, mark, V3_INTRO_MAX_SHOWN]]);
    expect(mockQuery).toHaveBeenCalledTimes(3);   // V3 소개 창의 노출 수는 쓰지 않는다
    // 두 번째 · 세 번째 노출(아직 여지가 있다)
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce(NONE).mockResolvedValueOnce({ rows: [{ dismissed: false, shown: 2 }] }).mockResolvedValueOnce({ rows: [{ shown: 3 }] });
    expect(((await claimIntro(USER, 'tok-3')) as any).variant).toBe('trial');
  });

  it('★ Codex 구현 1R — 선점이 0행(이 로그인이 이미 창을 띄웠다)이면 다른 판으로 넘어가지 않는다 · V3 소개 창을 선점하지 않는다', async () => {
    fillSamples();   // 종전 소개 창을 띄울 재료가 다 있어도
    mockQuery.mockResolvedValueOnce(NONE).mockResolvedValueOnce({ rows: [{ dismissed: false, shown: 1 }] }).mockResolvedValueOnce(NONE);
    expect(await claimIntro(USER, 'tok')).toEqual({ show: false });
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls.filter((c) => c[0] === INTRO_CLAIM_SQL).map((c) => c[1][1])).toEqual([STUDIO_TRIAL_INTRO_KEY]);
  });

  it('선점 문장 = 로그인 표식 문(판을 통틀어 한 번)과 판의 노출을 한 문장에서 함께 잡는다', () => {
    expect(INTRO_LOGIN_GATE_KEY).toBe('_login');
    expect(INTRO_KEYS).not.toContain(INTRO_LOGIN_GATE_KEY);   // 「다시 보지 않기」로 건드릴 수 없다
    const sql = INTRO_CLAIM_SQL.replace(/\s+/g, ' ');
    expect(sql).toContain("WITH gate AS ( INSERT INTO user_intro_acks AS g (user_id, intro_key, login_marks) SELECT $1::uuid, '_login', ARRAY[$3]::text[]");
    // 「이 로그인은 처음인가」의 진실 = 그 계정의 모든 행(문 행이 생기기 전에 어느 판이 모은 표식 · 문에서 밀려난 표식 포함 · Codex 구현 2R)
    expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM user_intro_acks x WHERE x.user_id = $1::uuid AND $3 = ANY(x.login_marks)) ON CONFLICT (user_id, intro_key) DO UPDATE');
    expect(sql).toContain('WHERE NOT ($3 = ANY(g.login_marks)) RETURNING 1 )');
    expect(sql).toContain('SELECT $1::uuid, $2::varchar, ARRAY[$3]::text[] FROM gate');
    expect(sql).toContain('WHERE a.dismissed_at IS NULL AND cardinality(a.login_marks) < $4::int AND NOT ($3 = ANY(a.login_marks))');
    // 부르는 쪽은 판을 먼저 정하고 한 번만 부른다(체험 갈래는 선점 결과를 그대로 돌려준다)
    const src = back('utils/v3-intro.ts');
    expect(src).toContain("return t.rows.length > 0 ? { show: true, variant: 'trial', introKey: STUDIO_TRIAL_INTRO_KEY, posters: [], chips: [] } : { show: false };");
  });

  it('이미 신청한 회사 = 무료체험 창을 다시 띄우지 않는다(종전 소개 창 판정으로)', async () => {
    fillSamples();
    mockQuery.mockResolvedValueOnce(ROW([])).mockResolvedValueOnce({ rows: [{ shown: 1 }] });
    const got = await claimIntro(USER, 'tok');
    expect(got).toMatchObject({ show: true });
    expect((got as any).variant).toBeUndefined();
    expect(mockQuery.mock.calls[1]).toEqual([INTRO_CLAIM_SQL, ['u-1', V3_INTRO_KEY, mark, V3_INTRO_MAX_SHOWN]]);
  });

  it('무료체험 창을 다 띄웠거나(3번) 숨긴 계정 = 선점 전에 읽어 종전 소개 창 판정으로 간다(무료체험 판은 선점하지 않는다)', async () => {
    fillSamples();
    for (const state of [{ dismissed: false, shown: 3 }, { dismissed: true, shown: 1 }, { dismissed: true, shown: 0 }]) {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce(NONE).mockResolvedValueOnce({ rows: [state] }).mockResolvedValueOnce({ rows: [{ shown: 2 }] });
      const got = await claimIntro(USER, 'tok');
      expect((got as any).variant, JSON.stringify(state)).toBeUndefined();
      expect(got).toMatchObject({ show: true });
      expect(mockQuery.mock.calls.filter((c) => c[0] === INTRO_CLAIM_SQL).map((c) => c[1][1])).toEqual([V3_INTRO_KEY]);
    }
  });

  it('유료 · AI 체험 중인 회사 = 체험 표를 읽지 않고 종전 소개 창', async () => {
    fillSamples();
    for (const p of [PAID, FREE_AI_TRIAL]) {
      mockQuery.mockReset();
      planCtx.value = p;
      mockQuery.mockResolvedValueOnce({ rows: [{ shown: 1 }] });
      const got = await claimIntro(USER, 'tok');
      expect((got as any).variant).toBeUndefined();
      expect(mockQuery.mock.calls[0][0]).toBe(INTRO_CLAIM_SQL);
      expect(mockQuery.mock.calls[0][1][1]).toBe(V3_INTRO_KEY);
    }
  });

  it('요금제 · 체험 표를 못 읽으면 체험 창을 띄우지 않는다(모르면 종전 판정)', async () => {
    fillSamples();
    planCtx.fail = true;
    mockQuery.mockResolvedValueOnce({ rows: [{ shown: 1 }] });
    expect(((await claimIntro(USER, 'tok')) as any).variant).toBeUndefined();
    planCtx.fail = false;
    mockQuery.mockReset();
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' })).mockResolvedValueOnce({ rows: [{ shown: 1 }] });
    const got = await claimIntro(USER, 'tok');
    expect((got as any).variant).toBeUndefined();
    expect(mockQuery.mock.calls[1][1][1]).toBe(V3_INTRO_KEY);
    // 노출 상태를 못 읽어도 같다(체험 판을 선점하지 않는다)
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce(NONE).mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce({ rows: [{ shown: 1 }] });
    expect(((await claimIntro(USER, 'tok')) as any).variant).toBeUndefined();
    expect(mockQuery.mock.calls.filter((c) => c[0] === INTRO_CLAIM_SQL).map((c) => c[1][1])).toEqual([V3_INTRO_KEY]);
  });

  it('「다시 보지 않기」 = 닫힌 목록 안의 판 열쇠만 · 밖의 값 · 없음 = V3 소개 창(종전 동작)', async () => {
    expect(INTRO_KEYS).toEqual([V3_INTRO_KEY, STUDIO_TRIAL_INTRO_KEY]);
    mockQuery.mockResolvedValue({ rows: [] });
    await dismissIntro(USER, 'studio-trial');
    await dismissIntro(USER);
    await dismissIntro(USER, 'anything-else');
    await dismissIntro(USER, { introKey: 'studio-trial' });
    expect(mockQuery.mock.calls.map((c) => [c[0], c[1][1]])).toEqual([
      [INTRO_DISMISS_SQL, 'studio-trial'], [INTRO_DISMISS_SQL, 'v3-intro'], [INTRO_DISMISS_SQL, 'v3-intro'], [INTRO_DISMISS_SQL, 'v3-intro'],
    ]);
    expect(back('routes/plans.ts')).toContain('await dismissIntro(req.user as any, req.body?.introKey);');
  });
});

describe('로그인 화면 스위치 — 비면 꺼짐(열지 않은 기능을 로그인 전에 약속하지 않는다)', () => {
  it('on 일 때만 켜짐', () => {
    expect(V3_LOGIN_INTRO_ENV).toBe('V3_LOGIN_INTRO');
    expect(v3LoginIntroOn({})).toBe(false);
    expect(v3LoginIntroOn({ V3_LOGIN_INTRO: '' })).toBe(false);
    expect(v3LoginIntroOn({ V3_LOGIN_INTRO: 'off' })).toBe(false);
    expect(v3LoginIntroOn({ V3_LOGIN_INTRO: '1' })).toBe(false);
    expect(v3LoginIntroOn({ V3_LOGIN_INTRO: 'true' })).toBe(false);
    expect(v3LoginIntroOn({ V3_LOGIN_INTRO: 'on' })).toBe(true);
    expect(v3LoginIntroOn({ V3_LOGIN_INTRO: ' ON ' })).toBe(true);
  });

  it('공개 주소는 판정 함수만 부르고 · 화면은 못 받으면 종전 인증 안내 창', () => {
    const route = back('routes/intro-public.ts');
    expect(route).toContain("router.get('/v3-login', (_req: Request, res: Response) => {");
    expect(route).toContain('res.json({ success: true, on: v3LoginIntroOn() });');
    expect(route).toContain("res.setHeader('Cache-Control', 'no-store');");
    const util = front('utils/v3-login-intro.ts');
    expect(util).toContain("fetch('/api/public/intro/v3-login', { signal: ctl.signal })");
    expect(util).toContain('return d?.success === true && d.on === true;');
    expect(util).toMatch(/catch \{\s*return false;/);
    expect(util).toContain('export const V3_LOGIN_INTRO_WAIT_MS = 1500;');
    const sw = front('components/v3/LoginNoticeSwitch.tsx');
    expect(sw).toContain("void fetchV3LoginIntroOn().then((on) => { if (alive) setMode(on ? 'v3' : 'policy'); });");
    expect(sw).toContain("if (mode === 'wait') return null;");
    expect(sw).toContain("if (mode === 'v3') return <V3LoginIntroModal onClose={onClose} onAuthNotice={() => setMode('policy')} />;");
    expect(sw).toContain('return <LoginPolicyNoticeModal onClose={onClose} />;');
  });
});

describe('소스 계약 — 생성 주소: 체험 판정 → (종전 문) → 선점 → 생성 → 실패하면 되돌림', () => {
  const route = back('routes/image-studio.ts');
  const gen = route.slice(route.indexOf("imageStudioRouter.post('/generate'"), route.indexOf('// ── GET /trial'));

  it('체험 판정이 요금제 문 자리 · 체험 길이 아니면 종전 문 그대로(읽어 둔 요금제 문맥을 넘긴다)', () => {
    expect(gen.length).toBeGreaterThan(2000);
    expect(gen).toContain('const gate = await studioTrialGate(companyId, req.user);');
    expect(gen).toContain('if (!trial && await aiZonePlanBlocked(req, res, gate.plan)) return;');
    expect(gen.indexOf('studioTrialGate(')).toBeLessThan(gen.indexOf('tryAcquireGenerateLock('));
    expect(gen).not.toContain('if (await aiZonePlanBlocked(req, res)) return;');
  });

  it('체험 길은 크레딧을 보지도 걷지도 않는다(납부 확인 · 사전 확인 · 성공 뒤 차감)', () => {
    expect(gen).toContain('let alreadyPaid = trial;');
    expect(gen).toContain('if (!trial && attemptKey) {\n    try { alreadyPaid = await isChargedByKey(companyId, attemptKey); }');
    expect(gen).toContain('if (!alreadyPaid) { try { await checkCredit(companyId, getCreditCost(CREDIT_SOURCE.generate)); }');
    expect(gen).toMatch(/if \(!alreadyPaid\) \{\n(\s*\/\/[^\n]*\n)*\s*await settleOrUndo\(/);
    // 크레딧 함수 호출은 저 세 자리뿐이다(체험 갈래 안에 따로 없다) · alreadyPaid 를 다시 false 로 돌리는 줄이 없다
    expect(gen.match(/isChargedByKey\(/g)).toHaveLength(1);
    expect(gen.match(/checkCredit\(/g)).toHaveLength(1);
    expect(gen.match(/settleOrUndo\(/g)).toHaveLength(1);
    expect(gen).not.toMatch(/alreadyPaid = false/);
  });

  it('선점이 생성보다 앞 · 못 잡으면 만들지 않는다 · 같은 시도 기억이 있으면 선점하지 않는다', () => {
    const reserve = gen.indexOf('await reserveStudioTrial(companyId, trialKey)');
    const make = gen.indexOf('await generatePoster(');
    expect(reserve).toBeGreaterThan(0);
    expect(reserve).toBeLessThan(make);
    const between = gen.slice(reserve, make);
    expect(between).toContain("if (held.state !== 'ok') { const no = trialRefusal(held); return res.status(no.status).json(no.body); }");
    expect(between).toContain('trialHeld = trialKey;');
    expect(gen.indexOf('recallStudioResult<')).toBeLessThan(reserve);
    expect(gen).toContain('const trialKey = attemptKey || `image-studio:${newTempId()}`;');
    // 선점은 입력 검사 · 임시 용량 검사를 다 지난 뒤(잘못된 요청이 칸을 쓰지 않는다)
    for (const check of ['getTemplate(String(templateId', 'readProductTempIds(req.body)', 'findUnfilledTemplateText(texts)', 'isStudioTempFull(companyId)']) {
      expect(gen.indexOf(check), check).toBeGreaterThan(0);
      expect(gen.indexOf(check), check).toBeLessThan(reserve);
    }
  });

  it('그림이 임시 저장까지 된 뒤에만 칸을 쓴 것으로 치고 · 그 전에 실패하면 되돌린다', () => {
    const saved = gen.indexOf('trialHeld = null;');
    expect(saved).toBeGreaterThan(gen.indexOf('writeTempBuffer(companyId'));
    expect(saved).toBeLessThan(gen.indexOf('await settleOrUndo('));
    const tail = gen.slice(gen.lastIndexOf('} catch (err) {'));
    expect(tail).toContain('if (trialHeld) {');
    expect(tail).toContain('await releaseStudioTrial(companyId, trialHeld).catch(');
    expect(tail.indexOf('releaseStudioTrial(')).toBeLessThan(tail.indexOf('return respondStudioError(res, err);'));
    expect(gen).toContain('...(trialUse ? { trial: trialUse } : {}),');
  });

  it('체험은 생성 주소 하나뿐 — 수정 · 한 줄 헤드라인은 종전 요금제 문 그대로', () => {
    expect(route.match(/studioTrialGate\(/g)).toHaveLength(1);
    expect(route.match(/reserveStudioTrial\(/g)).toHaveLength(1);
    expect(route.match(/if \(await aiZonePlanBlocked\(req, res\)\) return;/g)).toHaveLength(2);
    const edit = route.slice(route.indexOf("imageStudioRouter.post('/edit'"), route.indexOf("imageStudioRouter.post('/layers'"));
    const line = route.slice(route.indexOf("imageStudioRouter.post('/line-headline'"), route.indexOf("imageStudioRouter.post('/ingest-product'"));
    for (const block of [edit, line]) {
      expect(block).toContain('if (await aiZonePlanBlocked(req, res)) return;');
      expect(block).not.toMatch(/trial/i);
    }
  });

  it('신청 · 상태 주소 = 로그인 뒤(authenticate 아래) · 판정은 CT · 자격 없음 409 · 오류 = CT 의 503', () => {
    expect(route.indexOf('imageStudioRouter.use(authenticate);')).toBeLessThan(route.indexOf("imageStudioRouter.get('/trial'"));
    const trial = route.slice(route.indexOf("imageStudioRouter.get('/trial'"), route.indexOf('// ── POST /edit'));
    expect(trial).toContain('...(await studioTrialView(companyId, req.user))');
    expect(trial).toContain('const status = await requestStudioTrialFor(companyId, req.user);');
    expect(trial).toContain("code: 'TRIAL_NOT_ELIGIBLE'");
    expect(trial.match(/const no = trialErrorResponse\(err\);/g)).toHaveLength(2);
    expect(trial).not.toContain('res.status(500)');
  });

  it('보호 파일 다섯은 이 카드에서 체험을 모른다(발송 · 과금 경로 무접촉)', () => {
    for (const f of ['routes/campaigns.ts', 'routes/spam-filter.ts', 'utils/messageUtils.ts', 'routes/results.ts', 'routes/billing.ts']) {
      const s = back(f);
      expect(s, f).not.toContain('studio-trial');
      expect(s, f).not.toContain('image_studio_trials');
    }
    expect(back('utils/ai-credit.ts')).not.toContain('studio-trial');
  });
});

describe('소스 계약 — 화면', () => {
  const parts = front('components/v3/v3-popup-parts.ts');
  const lit = (name: string) => {
    const at = parts.indexOf(`export const ${name} = `);
    const open = parts.indexOf('`', at);
    return parts.slice(open + 1, parts.indexOf('`;', open));
  };
  const css = lit('V3_POPUP_CSS');
  const loginHtml = parts.slice(parts.indexOf('export const V3_LOGIN_HTML'), parts.indexOf('export const V3_TRIAL_HTML'));
  const trialHtml = parts.slice(parts.indexOf('export const V3_TRIAL_HTML'));
  const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '\n');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

  it('동적 import 는 난독화 제외 파일(App.tsx)에만 — 다른 파일에 두면 빌드가 경로 문자열을 깨뜨린다(0718 전 고객 다운의 뿌리)', () => {
    const cfg = readFileSync(join(FRONT, 'vite.config.ts'), 'utf8');
    expect(cfg).toContain('/App\\.tsx$/');
    const offenders = walk(join(FRONT, 'src'))
      .filter((p) => /\.(ts|tsx)$/.test(p) && !/[\\/]App\.tsx$/.test(p))
      .filter((p) => /\bimport\(/.test(readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
    expect(offenders.map((p) => p.slice(FRONT.length + 1).replace(/\\/g, '/'))).toEqual([]);
  });

  it('팝업 CSS = 전부 .v3p 아래 · 키프레임 이름 앞 v3p-(앱 전역 fadeIn 과 겹치지 않는다) · 글꼴 지정 없음(앱 전역 프리텐다드 하나)', () => {
    expect(css.length).toBeGreaterThan(20000);
    const flat = css.replace(/@keyframes [^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const selectors = [...flat.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(200);
    for (const sel of selectors) for (const one of sel.split(',')) expect(one.trim().startsWith('.v3p'), one).toBe(true);
    const frames = [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThan(20);
    for (const f of frames) expect(f.startsWith('v3p-'), f).toBe(true);
    for (const use of css.matchAll(/animation(?:-name)?\s*:\s*([A-Za-z][A-Za-z0-9_-]*)/g)) expect(frames.includes(use[1]) || use[1] === 'none', use[1]).toBe(true);
    expect(css).not.toContain('font-family');
    expect(css).not.toMatch(/violet|purple|#7c3aed/i);
    expect(css).toContain('@container stage (max-width:720px){');
    expect(css).toContain('@media (prefers-reduced-motion:reduce){');
  });

  it('아이콘 참조 = xlink:href(그냥 href 면 Tab 가두기가 아이콘을 버튼으로 세어 창 밖으로 샌다) · 그림 = 실제로 있는 정적 파일', () => {
    expect(parts).not.toMatch(/<use href=/);
    expect(parts.match(/<use xlink:href="#v3p-/g)!.length).toBeGreaterThan(8);
    for (const html of [loginHtml, trialHtml]) for (const m of html.matchAll(/xlink:href="#(v3p-[a-z]+)"/g)) expect(parts, m[1]).toContain(`<symbol id="${m[1]}"`);
    const urls = [...parts.matchAll(/\/v3\/[a-z0-9-]+\.(?:jpg|webp)/g)].map((m) => m[0]);
    expect(new Set(urls).size).toBe(9);
    for (const u of new Set(urls)) expect(existsSync(join(FRONT, 'public', u)), u).toBe(true);
    expect(parts).not.toContain('data:image');
  });

  it('보이는 글 = 줄표 · 가운뎃점 · 모델명 0 · 광고 문자는 광고 표기와 무료수신거부 · 알림톡에는 광고 표기 없음', () => {
    const motion = front('components/v3/v3-motion.ts');
    const texts = [visible(loginHtml), visible(trialHtml), ...[...motion.matchAll(/text: '([^']+)'/g)].map((m) => m[1])];
    expect(texts[2]).toBeTruthy();
    for (const t of texts) {
      expect(t).not.toContain('—');
      expect(t).not.toContain('·');
      expect(t).not.toMatch(/Claude|GPT|Anthropic|Opus|Sonnet|Haiku|claude-|Gemini/i);
    }
    for (const sms of [...motion.matchAll(/text: '([^']+)'/g)].map((m) => m[1])) {
      expect(sms.startsWith('(광고)[')).toBe(true);
      expect(sms).toContain('무료수신거부 080-');
    }
    const sms2 = loginHtml.slice(loginHtml.indexOf('<div class="card sms">'), loginHtml.indexOf('</div>', loginHtml.indexOf('<div class="card sms">')));
    expect(sms2).toContain('(광고)[결온]');
    expect(sms2).toContain('무료수신거부 080-000-0000');
    const talk = loginHtml.slice(loginHtml.indexOf('<div class="at-bd">'), loginHtml.indexOf('<div class="at-btn">'));
    expect(talk).toContain('결온의 가족이 되어 주셔서');
    expect(talk).not.toContain('(광고)');
    expect(talk).not.toContain('수신거부');
    // 화면 속 숫자는 예시라고 적는다(장면 2 · 3 · 4)
    expect(loginHtml.match(/<span class="eg">예시 화면<\/span>/g)).toHaveLength(3);
  });

  it('두 창 = 기본 대화상자 0 · 바깥(어두운 판)을 눌러도 닫히지 않는다 · 창 안쪽은 같은 문자열 한 번', () => {
    for (const f of ['components/v3/V3LoginIntroModal.tsx', 'components/v3/StudioTrialPromo.tsx', 'components/v3/LoginNoticeSwitch.tsx', 'components/v3/v3-motion.ts', 'components/v3/use-dialog-trap.ts']) {
      const s = front(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      expect(s, f).not.toMatch(/\b(alert|confirm|prompt)\(/);
      expect(s, f).not.toMatch(/Claude|GPT|Anthropic|Opus|Sonnet|Haiku|claude-|Gemini/i);
    }
    for (const f of ['components/v3/V3LoginIntroModal.tsx', 'components/v3/StudioTrialPromo.tsx']) {
      const s = front(f);
      expect(s).toContain('<div className="scrim" />');
      expect(s).toContain('<style>{V3_POPUP_CSS}</style>');
      expect(s).toContain('role="dialog"');
      expect(s).toContain('aria-modal="true"');
    }
    expect(front('components/v3/V3LoginIntroModal.tsx')).toContain('const LOGIN_INNER = { __html: V3_LOGIN_HTML };');
    expect(front('components/v3/StudioTrialPromo.tsx')).toContain('const TRIAL_INNER = { __html: V3_TRIAL_HTML };');
  });

  it('로그인 전 창 = 인증 세 줄은 인증 안내 창의 CHANGES 그대로 · 오늘 하루 보지 않기는 같은 저장 열쇠 · V3 페이지로', () => {
    const modal = front('components/v3/V3LoginIntroModal.tsx');
    expect(loginHtml).toContain('<ul data-auth></ul>');
    expect(modal).toContain("import { CHANGES, hideLoginPolicyNoticeToday } from '../LoginPolicyNoticeModal';");
    expect(modal).toContain('list.replaceChildren(...CHANGES.map((c, i) => {');
    expect(modal).toContain("else if (act === 'hide-today') { hideLoginPolicyNoticeToday(); onClose(); }");
    expect(modal).toContain("else if (act === 'go') window.location.assign(V3_PAGE_PATH);");
    expect(modal).toContain("export const V3_PAGE_PATH = '/about-v3.html';");
    expect(existsSync(join(FRONT, 'public', 'about-v3.html'))).toBe(true);
    const policy = front('components/LoginPolicyNoticeModal.tsx');
    expect(policy).toContain('export const CHANGES: Array<{ label: string; title: string; detail: string }> = [');
    expect(policy).toContain('export function hideLoginPolicyNoticeToday(): void {');
    for (const act of ['close', 'go', 'hide-today', 'auth']) expect(loginHtml).toContain(`data-act="${act}"`);
    expect(loginHtml.match(/data-tab/g)).toHaveLength(5);
    expect(loginHtml).toContain('data-pp aria-label="자동 넘김 멈춤"');
  });

  it('무료체험 창 = 서버가 열렸다고 답한 뒤에만 「열렸습니다」 · 판 열쇠를 실어 숨긴다 · 누름을 기록한다', () => {
    const promo = front('components/v3/StudioTrialPromo.tsx');
    expect(promo).toContain("reportPlanFeature(STUDIO_TRIAL_POPUP_ID, 'go');");
    expect(promo).toContain('const state = await requestStudioTrial();');
    expect(promo).toContain("if (!state || !state.requested) { toast.error('지금은 열지 못했어요. 잠시 뒤 다시 눌러 주세요.'); return; }");
    expect(promo.indexOf('if (!state || !state.requested)')).toBeLessThan(promo.indexOf("pop.classList.add('opened');"));
    expect(promo).toContain('const saved = await dismissV3Intro(introKey);');
    expect(promo).toContain("else if (act === 'studio') { onClose(); navigate('/image-studio'); }");
    for (const act of ['close', 'trial', 'later', 'dismiss', 'studio']) expect(trialHtml).toContain(`data-act="${act}"`);
    expect(trialHtml).toContain('무료체험 3회 이용하고 싶습니다');
    expect(trialHtml).toContain('data-stop aria-label="장면 반복 멈춤"');
    // 틀(로그인 안내 창)이 서버 답으로 안쪽을 바꾸고 기능 id 를 갈라 기록한다
    const frame = front('components/AiOperatorLoginPromo.tsx');
    expect(frame).toContain("if (intro.variant === 'trial') return <StudioTrialPromo introKey={intro.introKey} rootRef={dialogRef} onClose={close} />;");
    expect(frame).toContain("if (got.variant === 'trial') reportPlanFeature(STUDIO_TRIAL_POPUP_ID, 'open');");
    const util = front('utils/v3-intro.ts');
    expect(util).toContain("if (d.variant === 'trial' && typeof d.introKey === 'string') return { variant: 'trial', introKey: d.introKey, posters: [], chips: [] };");
    expect(util.indexOf("if (d.variant === 'trial'")).toBeLessThan(util.indexOf('if (posters.length === 0) return null;'));
    expect(util).toContain("introKey ? { method: 'POST', body: { introKey } } : { method: 'POST' }");
  });

  it('스튜디오 입구 · 남은 횟수 = 서버 값만 · 체험은 이미지 스튜디오 화면 하나에만', () => {
    const gate = front('components/PlanGate.tsx');
    expect(gate).toContain("const TRIAL_FEATURE_ID = 'image-studio';");
    expect(gate).toContain('if (featureId === TRIAL_FEATURE_ID) {');
    expect(gate).toContain("if (trial?.eligible && trial.requested) { setState('open'); return; }");
    expect(gate.indexOf("if (allowed !== false) { setState('open'); return; }")).toBeLessThan(gate.indexOf('fetchStudioTrial()'));
    const page = front('pages/ImageStudioPage.tsx');
    expect(page).toContain('if (isAiOperatorAccessKnownAllowed()) return;');   // 요금제로 열린 회사는 묻지 않는다
    expect(page).toContain('setTrial(t && t.eligible && t.requested ? t : null);');
    expect(page).toContain("actionLabel: '요금제 보기', onAction: () => navigate('/pricing')");
    const api = front('utils/studio-trial.ts');
    expect(api).toContain("fetchJson('/api/image-studio/trial')");
    expect(api).toContain("sendJson('/api/image-studio/trial/request', { method: 'POST' })");
    expect(api).toContain("if (!ok || !body?.success || typeof body.requested !== 'boolean') return null;");
  });

  it('등록부 ↔ 탭 ↔ 기록: 창의 기능 id 가 등록부에 있고 · 탭은 등록부로 이름과 다음 행동을 그린다', () => {
    const reg = front('constants/login-popups.ts');
    expect(reg).toContain("{ id: 'login-promo', name: '로그인 안내 창', goLabel: '바로가기' },");
    expect(reg).toContain("{ id: STUDIO_TRIAL_POPUP_ID, name: '무료체험 안내 창', goLabel: '체험 신청' },");
    expect(reg).toContain("export const STUDIO_TRIAL_POPUP_ID = 'studio-trial';");
    expect(front('components/AiOperatorLoginPromo.tsx')).toContain("export const LOGIN_PROMO_FEATURE_ID = 'login-promo';");
    for (const id of ['login-promo', 'studio-trial']) expect(id).toMatch(/^[a-z][a-z-]{1,39}$/);   // 기록 주소가 받는 id 형식(utils/feature-interest FEATURE_ID_RE)
    expect(back('utils/feature-interest.ts')).toContain('const FEATURE_ID_RE = /^[a-z][a-z-]{1,39}$/;');
    const tab = front('components/admin/FeatureInterestTab.tsx');
    expect(tab).toContain("import { LOGIN_POPUPS, loginPopupOf } from '../../constants/login-popups';");
    expect(tab).toContain('{LOGIN_POPUPS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}');
    expect(tab).toContain('{data?.trials && (');
    expect(tab).toContain('아직 무료체험을 신청한 회사가 없습니다');
    // 서버: 신청 업체 목록은 관심 기록과 따로 읽고 · 못 읽어도 탭의 나머지는 그대로
    const fi = back('utils/feature-interest.ts');
    expect(fi).toContain('const trials = await loadStudioTrials().catch((err: any) => {');
    expect(fi).toContain('trials: StudioTrialListRow[] | null;');
  });

  it('공개 V3 페이지 = 배포된 기능 넷만 · 요금 약속 없음 · 로그인으로 · 그림은 실제로 있는 파일 · 글꼴 하나', () => {
    const page = readFileSync(join(FRONT, 'public', 'about-v3.html'), 'utf8');
    expect(page.match(/<section class="ft"/g)).toHaveLength(4);
    for (const label of ['01 이미지 스튜디오', '02 상품 반응', '03 기본 여정', '04 업종 평균']) expect(page).toContain(label);
    for (const gone of ['추천 상품', '나눠 보내기', '답장 상담', '요금은 그대로', '달라지는 발송 단가', '목업', 'data:image', 'href="#"']) expect(page, gone).not.toContain(gone);
    expect(page.match(/href="\/login"/g)!.length).toBe(3);
    const text = visible(page);
    expect(text).not.toContain('—');
    expect(text).not.toContain('·');
    expect(text).not.toMatch(/Claude|GPT|Anthropic|Opus|Sonnet|Haiku|claude-|Gemini/i);
    for (const u of new Set([...page.matchAll(/\/v3\/[a-z0-9-]+\.(?:jpg|webp)/g)].map((m) => m[0]))) expect(existsSync(join(FRONT, 'public', u)), u).toBe(true);
    const fonts = [...page.matchAll(/font-family:([^;}]+)/g)].map((m) => m[1]);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toContain('Pretendard');
    expect(page).toContain('(광고)[결온]');
    expect(page).toContain('무료수신거부 080-000-0000');
  });
});
