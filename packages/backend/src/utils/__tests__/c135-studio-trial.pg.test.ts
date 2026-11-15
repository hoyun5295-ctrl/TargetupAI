// replaces: none
/**
 * C135 — 이미지 스튜디오 무료체험 3회 · 실 PostgreSQL 판(★ 2026-11-15 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §5 · 대기 DDL C135-DDL-1 을 시험 안에서 얹는다)
 *   운영 문장(TRIAL_REQUEST_SQL · TRIAL_RESERVE_SQL · TRIAL_RELEASE_SQL)을 글자 그대로 돌린다.
 *   1. 신청 두 번 = 한 행(3회가 다시 차지 않는다)
 *   2. 선점 3번 뒤 넷째 = 다 씀 · 같은 키 두 번 = 둘째는 「이미 쓴 키」 · 되돌린 칸은 다시 잡힌다
 *   3. 두 연결이 동시에 마지막 칸을 잡아도 하나만
 *   4. 신청 업체 목록 = 관심 기록과 무관하게 전부
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import {
  STUDIO_TRIAL_GRANTED, readStudioTrial, requestStudioTrial, reserveStudioTrial, releaseStudioTrial, trialStatusOf, loadStudioTrials,
} from '../studio-trial';
import { INTRO_CLAIM_SQL, INTRO_LOGIN_GATE_KEY, INTRO_LOGIN_GATE_KEEP, STUDIO_TRIAL_INTRO_KEY, V3_INTRO_KEY, V3_INTRO_MAX_SHOWN, dismissIntro, introLoginMark } from '../v3-intro';

const C = (n: number) => `00000000-0000-0000-0000-0000000c135${n}`;
const U = '00000000-0000-0000-0000-00000000c135';
/** 로그인 표식 문 시험의 계정(앞 시험이 숨김 · 노출을 남긴 계정과 섞이지 않게 따로) */
const G = (c: string) => `00000000-0000-0000-0000-0000000c135${c}`;

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C135-DDL-1'));
  await pool.query(ledgerBlockSql('C133-DDL-1'));   // 소개 창 노출 · 숨김 표(판 열쇠 분리 시험)
  await pool.query('DELETE FROM image_studio_trials WHERE company_id::text LIKE $1', ['00000000-0000-0000-0000-0000000c135%']);
  await pool.query('DELETE FROM user_intro_acks WHERE user_id::text LIKE $1', ['00000000-0000-0000-0000-0000000c135%']);
});

describe('신청(실 PG)', () => {
  it('신청 전 = 행 없음 · 신청 = 3회 · 다시 신청해도 그대로', async () => {
    expect(await readStudioTrial(C(1))).toBeNull();
    expect(await requestStudioTrial(C(1), U)).toEqual({ requested: true, granted: 3, used: 0, remaining: 3 });
    expect(await reserveStudioTrial(C(1), 'k-1')).toEqual({ state: 'ok', used: 1, granted: 3 });
    // 한 칸 쓴 뒤 다시 신청 = 3회가 다시 차지 않는다
    expect(await requestStudioTrial(C(1), U)).toEqual({ requested: true, granted: 3, used: 1, remaining: 2 });
    expect(STUDIO_TRIAL_GRANTED).toBe(3);
  });

  it('신청하지 않은 회사는 잡을 칸이 없다', async () => {
    expect(await reserveStudioTrial(C(2), 'k-1')).toEqual({ state: 'used_up', used: 0, granted: 0 });
  });
});

describe('선점 · 되돌림(실 PG)', () => {
  it('3번까지 · 넷째 = 다 씀 · 쓴 키는 그대로 남는다', async () => {
    await requestStudioTrial(C(3), U);
    expect(await reserveStudioTrial(C(3), 'a')).toEqual({ state: 'ok', used: 1, granted: 3 });
    expect(await reserveStudioTrial(C(3), 'b')).toEqual({ state: 'ok', used: 2, granted: 3 });
    expect(await reserveStudioTrial(C(3), 'c')).toEqual({ state: 'ok', used: 3, granted: 3 });
    expect(await reserveStudioTrial(C(3), 'd')).toEqual({ state: 'used_up', used: 3, granted: 3 });
    expect((await readStudioTrial(C(3)))!.usedKeys).toEqual(['a', 'b', 'c']);
    expect(trialStatusOf(await readStudioTrial(C(3)))).toEqual({ requested: true, granted: 3, used: 3, remaining: 0 });
  });

  it('같은 키를 두 번 잡으면 둘째 = 이미 쓴 키(칸이 남아 있어도 · 새 그림을 만들지 않게)', async () => {
    await requestStudioTrial(C(4), U);
    expect((await reserveStudioTrial(C(4), 'same')).state).toBe('ok');
    expect(await reserveStudioTrial(C(4), 'same')).toEqual({ state: 'spent', used: 1, granted: 3 });
    expect((await readStudioTrial(C(4)))!.usedKeys).toEqual(['same']);
  });

  it('되돌린 칸은 다시 잡힌다 · 없는 키를 되돌려도 아무 일도 없다', async () => {
    await requestStudioTrial(C(5), U);
    await reserveStudioTrial(C(5), 'a'); await reserveStudioTrial(C(5), 'b'); await reserveStudioTrial(C(5), 'c');
    await releaseStudioTrial(C(5), 'b');
    await releaseStudioTrial(C(5), 'nope');
    expect((await readStudioTrial(C(5)))!.usedKeys).toEqual(['a', 'c']);
    expect(await reserveStudioTrial(C(5), 'd')).toEqual({ state: 'ok', used: 3, granted: 3 });
    expect((await reserveStudioTrial(C(5), 'e')).state).toBe('used_up');
  });

  it('동시에 열 요청이 와도 잡히는 것은 셋 · 같은 키 열 요청은 하나만', async () => {
    await requestStudioTrial(C(6), U);
    const many = await Promise.all(Array.from({ length: 10 }, (_, i) => reserveStudioTrial(C(6), `k-${i}`)));
    expect(many.filter((r) => r.state === 'ok')).toHaveLength(3);
    expect((await readStudioTrial(C(6)))!.usedKeys).toHaveLength(3);
    await requestStudioTrial(C(7), U);
    const same = await Promise.all(Array.from({ length: 10 }, () => reserveStudioTrial(C(7), 'one')));
    expect(same.filter((r) => r.state === 'ok')).toHaveLength(1);
    // 겹친 같은 키 = 「이미 쓴 키」(409 길) · 「다 썼다」(403)로 답하면 남은 2칸이 있는데 체험이 끝난 것처럼 보인다
    expect(same.filter((r) => r.state === 'spent')).toHaveLength(9);
    expect(same.filter((r) => r.state === 'used_up')).toHaveLength(0);
    expect((await readStudioTrial(C(7)))!.usedKeys).toEqual(['one']);
    expect(trialStatusOf(await readStudioTrial(C(7)))).toEqual({ requested: true, granted: 3, used: 1, remaining: 2 });
  });
});

describe('「다시 보지 않기」의 판 열쇠(실 PG)', () => {
  const claim = async (user: string, key: string, mark: string) => (await pool.query(INTRO_CLAIM_SQL, [user, key, mark, V3_INTRO_MAX_SHOWN])).rows.length;
  const dismissed = async (user: string) =>
    (await pool.query('SELECT intro_key FROM user_intro_acks WHERE user_id = $1 AND dismissed_at IS NOT NULL ORDER BY intro_key', [user])).rows.map((r: any) => r.intro_key);

  it('무료체험 창을 숨겨도 V3 소개 창은 숨지 않는다 · 반대도 같다', async () => {
    const a = { userId: C(1), companyId: C(1), userType: 'company_admin' };
    expect(await dismissIntro(a, STUDIO_TRIAL_INTRO_KEY)).toBe(true);
    expect(await dismissed(C(1))).toEqual([STUDIO_TRIAL_INTRO_KEY]);
    expect(await claim(C(1), STUDIO_TRIAL_INTRO_KEY, introLoginMark('a-1')!)).toBe(0);   // 무료체험 창 = 다시 안 뜬다
    expect(await claim(C(1), V3_INTRO_KEY, introLoginMark('a-2')!)).toBe(1);              // V3 소개 창 = 다음 로그인에 그대로 뜬다
    const b = { userId: C(2), companyId: C(2), userType: 'company_user' };
    expect(await dismissIntro(b)).toBe(true);                                             // 열쇠 없이 = V3 소개 창(종전 화면이 보내는 꼴)
    expect(await dismissed(C(2))).toEqual([V3_INTRO_KEY]);
    expect(await claim(C(2), STUDIO_TRIAL_INTRO_KEY, introLoginMark('b-1')!)).toBe(1);
  });

  it('로그인 표식 문의 열쇠는 「다시 보지 않기」로 건드릴 수 없다', async () => {
    const g = { userId: C(8), companyId: C(8), userType: 'company_admin' };
    expect(await claim(C(8), V3_INTRO_KEY, introLoginMark('g-1')!)).toBe(1);
    expect(await dismissIntro(g, INTRO_LOGIN_GATE_KEY)).toBe(true);                       // 닫힌 목록 밖 = V3 소개 창을 숨긴 것으로 받는다
    expect(await dismissed(C(8))).toEqual([V3_INTRO_KEY]);
  });

  it('닫힌 목록 밖의 값은 V3 소개 창으로 받는다(아무 판 열쇠나 만들어 넣지 못한다) · 대상이 아니면 쓰지 않는다', async () => {
    const c = { userId: C(3), companyId: C(3), userType: 'company_admin' };
    expect(await dismissIntro(c, 'made-up-key')).toBe(true);
    expect(await dismissed(C(3))).toEqual([V3_INTRO_KEY]);
    expect(await dismissIntro({ userId: C(4), companyId: C(4), userType: 'super_admin' }, STUDIO_TRIAL_INTRO_KEY)).toBe(false);
    expect(await dismissed(C(4))).toEqual([]);
  });
});

describe('한 로그인에 자동 안내 창 하나 — 판을 통틀어(실 PG)', () => {
  const claim = async (user: string, key: string, mark: string) => (await pool.query(INTRO_CLAIM_SQL, [user, key, mark, V3_INTRO_MAX_SHOWN])).rows;
  const marksOf = async (user: string, key: string): Promise<string[]> =>
    (await pool.query('SELECT login_marks FROM user_intro_acks WHERE user_id = $1 AND intro_key = $2', [user, key])).rows[0]?.login_marks ?? [];
  const M = (s: string) => introLoginMark(s)!;

  it('무료체험 창을 띄운 로그인은 같은 표식으로 V3 소개 창을 또 띄우지 못한다(순서를 바꿔도 같다) · V3 노출 수도 쓰지 않는다', async () => {
    expect(await claim(G('a'), STUDIO_TRIAL_INTRO_KEY, M('x-1'))).toEqual([{ shown: 1 }]);
    expect(await claim(G('a'), V3_INTRO_KEY, M('x-1'))).toEqual([]);                        // Codex 구현 1R — 같은 로그인의 두 번째 요청
    expect(await claim(G('a'), STUDIO_TRIAL_INTRO_KEY, M('x-1'))).toEqual([]);
    expect(await marksOf(G('a'), V3_INTRO_KEY)).toEqual([]);
    expect(await claim(G('b'), V3_INTRO_KEY, M('y-1'))).toEqual([{ shown: 1 }]);
    expect(await claim(G('b'), STUDIO_TRIAL_INTRO_KEY, M('y-1'))).toEqual([]);              // 요청 사이에 체험 자격이 생겨도(판이 바뀌어도) 같은 로그인은 한 번
    expect(await marksOf(G('b'), STUDIO_TRIAL_INTRO_KEY)).toEqual([]);
  });

  it('같은 로그인의 요청 열 개가 판을 섞어 동시에 와도 띄우는 것은 하나', async () => {
    const got = await Promise.all(Array.from({ length: 10 }, (_, i) => claim(G('c'), i % 2 ? V3_INTRO_KEY : STUDIO_TRIAL_INTRO_KEY, M('z-1'))));
    expect(got.filter((r) => r.length === 1)).toHaveLength(1);
    expect((await marksOf(G('c'), V3_INTRO_KEY)).length + (await marksOf(G('c'), STUDIO_TRIAL_INTRO_KEY)).length).toBe(1);
    expect(await marksOf(G('c'), INTRO_LOGIN_GATE_KEY)).toEqual([M('z-1')]);
  });

  /**
   * 겹침을 확정적으로 만든다: 첫 요청이 문 행을 잡은 채(트랜잭션을 닫지 않고) 서 있는 동안 둘째 요청이 다른 판으로 들어온다.
   *   둘째는 첫째의 쓰기를 아직 못 본 채 시작했으므로(문장 시작 때의 눈) 「처음 보는 표식」으로 알고 문 행을 고치려다 줄을 선다.
   *   첫째가 끝나면 둘째는 **끝난 뒤의 문 행**을 다시 보고 0행이어야 한다(문 행의 갱신 조건이 이 자리를 지킨다).
   */
  const overlap = async (user: string, mark: string, first: string, second: string) => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      const one = (await a.query(INTRO_CLAIM_SQL, [user, first, mark, V3_INTRO_MAX_SHOWN])).rows;
      const pending = b.query(INTRO_CLAIM_SQL, [user, second, mark, V3_INTRO_MAX_SHOWN]).then((r) => r.rows);
      const settledEarly = await Promise.race([pending.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 400))]);
      await a.query('COMMIT');
      return { one, two: await pending, settledEarly };
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
  };

  it('겹친 두 요청(같은 로그인 · 다른 판) — 첫째가 문을 잡고 서 있는 동안 들어온 둘째는 줄을 섰다가 0행(문 행이 없던 계정)', async () => {
    const r = await overlap(G('0'), M('ov-1'), STUDIO_TRIAL_INTRO_KEY, V3_INTRO_KEY);
    expect(r.settledEarly).toBe(false);                  // 둘째는 첫째가 끝날 때까지 기다렸다(겹침이 실제로 일어났다)
    expect(r.one).toEqual([{ shown: 1 }]);
    expect(r.two).toEqual([]);
    expect(await marksOf(G('0'), V3_INTRO_KEY)).toEqual([]);
    expect(await marksOf(G('0'), INTRO_LOGIN_GATE_KEY)).toEqual([M('ov-1')]);   // 문에 표식이 두 번 붙지 않는다
  });

  it('겹친 두 요청 — 문 행이 이미 있는 계정도 같다(순서를 바꿔 V3 판이 먼저)', async () => {
    expect(await claim(G('9'), V3_INTRO_KEY, M('ov-0'))).toEqual([{ shown: 1 }]);   // 앞선 로그인 = 문 행이 있다
    const r = await overlap(G('9'), M('ov-2'), V3_INTRO_KEY, STUDIO_TRIAL_INTRO_KEY);
    expect(r.settledEarly).toBe(false);
    expect(r.one).toEqual([{ shown: 2 }]);
    expect(r.two).toEqual([]);
    expect(await marksOf(G('9'), STUDIO_TRIAL_INTRO_KEY)).toEqual([]);
    expect(await marksOf(G('9'), INTRO_LOGIN_GATE_KEY)).toEqual([M('ov-0'), M('ov-2')]);
  });

  it('판마다 노출 수는 따로 센다 — 무료체험 창 3번을 다 띄운 계정도 다음 로그인에 V3 소개 창이 뜬다', async () => {
    for (const n of [1, 2, 3]) expect(await claim(G('d'), STUDIO_TRIAL_INTRO_KEY, M(`t-${n}`))).toEqual([{ shown: n }]);
    expect(await claim(G('d'), STUDIO_TRIAL_INTRO_KEY, M('t-4'))).toEqual([]);              // 그 판은 다 띄웠다(이 로그인의 문은 쓰였다)
    expect(await claim(G('d'), V3_INTRO_KEY, M('t-4'))).toEqual([]);                        // 그래서 부르는 쪽은 판을 먼저 정하고 한 번만 부른다
    expect(await claim(G('d'), V3_INTRO_KEY, M('t-5'))).toEqual([{ shown: 1 }]);
  });

  it('로그인 표식 문은 최근 것만 든다(계정마다 한 행이 끝없이 자라지 않는다) · 밀려난 뒤에도 그 판의 표식이 같은 로그인을 막는다', async () => {
    for (let n = 1; n <= INTRO_LOGIN_GATE_KEEP + 3; n++) await claim(G('e'), 'cap-check', M(`c-${n}`));
    const gate = await marksOf(G('e'), INTRO_LOGIN_GATE_KEY);
    expect(gate).toHaveLength(INTRO_LOGIN_GATE_KEEP);
    expect(gate[gate.length - 1]).toBe(M(`c-${INTRO_LOGIN_GATE_KEEP + 3}`));
    expect(gate).not.toContain(M('c-1'));
    expect(await claim(G('e'), 'cap-check', M('c-1'))).toEqual([]);                         // 문에서는 밀려났어도 그 판에 이미 든 표식
    expect(await claim(G('e'), V3_INTRO_KEY, M('c-1'))).toEqual([]);                        // 다른 판으로 물어도 같다(그 계정의 모든 행을 본다)
    expect(await marksOf(G('e'), V3_INTRO_KEY)).toEqual([]);
  });

  it('★ Codex 구현 2R — 배포 전에 이미 V3 창을 띄운 로그인(그 판의 행에만 표식 · 문 행 없음)은 다른 판을 또 띄우지 못한다', async () => {
    const m = M('before-deploy');
    // 이 카드 배포 전의 상태를 그대로 만든다: 판의 행에 표식이 있고 로그인 표식 문 행은 없다
    await pool.query("INSERT INTO user_intro_acks (user_id, intro_key, login_marks) VALUES ($1::uuid, $2, ARRAY[$3]::text[])", [G('f'), V3_INTRO_KEY, m]);
    expect(await claim(G('f'), STUDIO_TRIAL_INTRO_KEY, m)).toEqual([]);
    expect(await marksOf(G('f'), STUDIO_TRIAL_INTRO_KEY)).toEqual([]);                     // 무료체험 판의 노출 수를 쓰지 않는다
    expect(await marksOf(G('f'), INTRO_LOGIN_GATE_KEY)).toEqual([]);                       // 문 행도 만들지 않는다(아무것도 쓰지 않는다)
    expect(await claim(G('f'), V3_INTRO_KEY, m)).toEqual([]);                              // 같은 판으로 다시 물어도 0행(종전 그대로)
    expect(await marksOf(G('f'), V3_INTRO_KEY)).toEqual([m]);
    // 다음 로그인부터는 정상 — 무료체험 판이 뜨고 문 행이 생긴다
    const next = M('after-deploy');
    expect(await claim(G('f'), STUDIO_TRIAL_INTRO_KEY, next)).toEqual([{ shown: 1 }]);
    expect(await marksOf(G('f'), INTRO_LOGIN_GATE_KEY)).toEqual([next]);
    // 문 행이 있는 계정에서도 같다: 판의 행에만 있는 옛 표식(문에 없음)으로 다른 판을 물으면 0행
    expect(await claim(G('f'), STUDIO_TRIAL_INTRO_KEY, m)).toEqual([]);
    expect(await marksOf(G('f'), STUDIO_TRIAL_INTRO_KEY)).toEqual([next]);
  });
});

describe('신청 업체 목록(실 PG)', () => {
  it('관심 기록이 없어도 신청한 회사는 전부 나온다 · 최근 신청이 위', async () => {
    const list = (await loadStudioTrials())!;
    const mine = list.filter((r) => r.companyId.startsWith('00000000-0000-0000-0000-0000000c135'));
    expect(mine.map((r) => r.companyId).sort()).toEqual([C(1), C(3), C(4), C(5), C(6), C(7)].sort());
    const c3 = mine.find((r) => r.companyId === C(3))!;
    expect({ used: c3.used, granted: c3.granted }).toEqual({ used: 3, granted: 3 });
    expect(typeof c3.requestedAt).toBe('string');
    for (let i = 1; i < list.length; i++) expect(list[i - 1].requestedAt >= list[i].requestedAt).toBe(true);
  });
});
