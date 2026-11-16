// replaces: none
/**
 * C136 배포 가 — 로그인 직후 안내 창의 「준비 → 선점」 · 실 PostgreSQL 판(★ 2026-11-16 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2-1 · §2-3 · §11)
 *   운영 함수(decideIntro · peekIntro · claimIntro · dismissIntro · canSeeIntroContent)를 실제 표 위에서 그대로 돌린다.
 *   1. 준비는 노출을 쓰지 않는다(표에 행이 생기지 않는다)
 *   2. 선점은 준비한 판의 열쇠와 판정이 같을 때만 쓴다 · 같은 로그인은 한 번
 *   3. 옛 화면의 숨김 요청(열쇠 없음)은 옛 판에 적히고 새 판을 숨기지 않는다
 *   4. 에이전트 전용 회사 = 대상 아님(회사 용도 칸을 실제 표에서 읽는다)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import {
  decideIntro, peekIntro, claimIntro, dismissIntro,
  V3_INTRO_KEY, V3_SCENES_INTRO_KEY, STUDIO_TRIAL_INTRO_KEY, INTRO_LOGIN_GATE_KEY, V3_INTRO_MAX_SHOWN,
} from '../v3-intro';
import { canSeeIntroContent } from '../gated-content';
import { requestStudioTrial } from '../studio-trial';

const CO = (n: number) => `00000000-0000-0000-0000-00000c136a0${n}`;
const UU = (n: number) => `00000000-0000-0000-0000-00000c136b0${n}`;
const user = (c: number, u: number) => ({ userId: UU(u), companyId: CO(c), userType: 'company_admin' });
const rows = async (u: number) =>
  (await pool.query('SELECT intro_key, cardinality(login_marks) AS n, dismissed_at IS NOT NULL AS hidden FROM user_intro_acks WHERE user_id = $1::uuid ORDER BY intro_key', [UU(u)])).rows;

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C133-DDL-1'));
  await pool.query(ledgerBlockSql('C135-DDL-1'));
  await pool.query('DELETE FROM user_intro_acks WHERE user_id::text LIKE $1', ['00000000-0000-0000-0000-00000c136b%']);
  await pool.query('DELETE FROM image_studio_trials WHERE company_id::text LIKE $1', ['00000000-0000-0000-0000-00000c136a%']);
  await pool.query('DELETE FROM companies WHERE id::text LIKE $1', ['00000000-0000-0000-0000-00000c136a%']);
  // 1 = 미가입 · 체험 미신청(무료체험 판) · 2 = 미가입 · 체험 신청함(장면 판) · 3 = 에이전트 전용
  await insertMinimalRow(pool, 'companies', { id: CO(1), usage_type: 'web' });
  await insertMinimalRow(pool, 'companies', { id: CO(2), usage_type: 'web' });
  await insertMinimalRow(pool, 'companies', { id: CO(3), usage_type: 'agent' });
  await requestStudioTrial(CO(2), UU(9));
});

describe('받을 수 있는 계정(실 PG) — 회사 용도 칸을 실제 표에서 읽는다', () => {
  it('web = 허용 · agent = 거절 · 없는 회사 = 거절', async () => {
    expect(await canSeeIntroContent(user(1, 1))).toBe(true);
    expect(await canSeeIntroContent(user(3, 1))).toBe(false);
    expect(await canSeeIntroContent({ userId: UU(1), companyId: '00000000-0000-0000-0000-00000c136aff', userType: 'company_admin' })).toBe(false);
  });
});

describe('준비 → 선점(실 PG)', () => {
  it('준비는 노출을 쓰지 않는다 — 몇 번을 물어도 표에 행이 생기지 않는다', async () => {
    for (let i = 0; i < 3; i++) {
      const got: any = await peekIntro(user(2, 1), 'login-a');
      expect(got.introKey).toBe(V3_SCENES_INTRO_KEY);
      expect(got.variant).toBe('scenes');
      expect(got.content.html.length).toBeGreaterThan(1000);
    }
    expect(await rows(1)).toEqual([]);
    // 체험을 아직 신청하지 않은 미가입 회사 = 무료체험 판(읽기만)
    expect(await decideIntro(user(1, 2), 'login-a')).toEqual({ introKey: STUDIO_TRIAL_INTRO_KEY, variant: 'trial' });
    expect(await rows(2)).toEqual([]);
  });

  it('선점 = 준비한 판의 열쇠와 판정이 같을 때만 노출 한 번 · 다르거나 없으면 행 0', async () => {
    expect(await claimIntro(user(2, 3), 'login-a')).toEqual({ show: false });                          // 열쇠 없음(옛 화면)
    expect(await claimIntro(user(2, 3), 'login-a', V3_INTRO_KEY)).toEqual({ show: false });            // 옛 판
    expect(await claimIntro(user(2, 3), 'login-a', STUDIO_TRIAL_INTRO_KEY)).toEqual({ show: false });  // 판정(장면 판)과 다른 판
    expect(await rows(3)).toEqual([]);
    expect(await claimIntro(user(2, 3), 'login-a', V3_SCENES_INTRO_KEY)).toEqual({ show: true, introKey: V3_SCENES_INTRO_KEY, variant: 'scenes' });
    expect(await rows(3)).toEqual([
      { intro_key: INTRO_LOGIN_GATE_KEY, n: 1, hidden: false },
      { intro_key: V3_SCENES_INTRO_KEY, n: 1, hidden: false },
    ]);
  });

  it('같은 로그인은 한 번 — 다시 물으면 준비도 「없음」 · 선점도 0 · 다음 로그인에는 다시 뜬다(계정당 3번까지)', async () => {
    expect(await peekIntro(user(2, 3), 'login-a')).toEqual({ introKey: null });
    expect(await claimIntro(user(2, 3), 'login-a', V3_SCENES_INTRO_KEY)).toEqual({ show: false });
    expect((await claimIntro(user(2, 3), 'login-b', V3_SCENES_INTRO_KEY)).show).toBe(true);
    expect((await claimIntro(user(2, 3), 'login-c', V3_SCENES_INTRO_KEY)).show).toBe(true);
    expect(V3_INTRO_MAX_SHOWN).toBe(3);
    expect(await decideIntro(user(2, 3), 'login-d')).toBeNull();                                        // 3번을 다 띄웠다
    expect(await claimIntro(user(2, 3), 'login-d', V3_SCENES_INTRO_KEY)).toEqual({ show: false });
    expect((await rows(3)).find((r) => r.intro_key === V3_SCENES_INTRO_KEY)!.n).toBe(3);
  });

  it('두 요청이 같은 로그인으로 동시에 선점해도 하나만 띄운다', async () => {
    const got = await Promise.all(Array.from({ length: 8 }, () => claimIntro(user(2, 4), 'login-x', V3_SCENES_INTRO_KEY)));
    expect(got.filter((g) => g.show)).toHaveLength(1);
    expect((await rows(4)).find((r) => r.intro_key === V3_SCENES_INTRO_KEY)!.n).toBe(1);
  });

  it('⛔ 옛 화면의 「다시 보지 않기」(열쇠 없음 · 모르는 값) = 옛 판에 적힌다 — 새 판은 그대로 뜬다 · 새 판의 열쇠로 숨기면 안 뜬다', async () => {
    await dismissIntro(user(2, 5));
    await dismissIntro(user(2, 5), 'whatever');
    expect(await rows(5)).toEqual([{ intro_key: V3_INTRO_KEY, n: 0, hidden: true }]);
    expect(await decideIntro(user(2, 5), 'login-a')).toEqual({ introKey: V3_SCENES_INTRO_KEY, variant: 'scenes' });
    await dismissIntro(user(2, 5), V3_SCENES_INTRO_KEY);
    expect(await decideIntro(user(2, 5), 'login-a')).toBeNull();
    expect(await claimIntro(user(2, 5), 'login-a', V3_SCENES_INTRO_KEY)).toEqual({ show: false });
  });

  it('에이전트 전용 회사 · 슈퍼관리자 = 준비도 선점도 「없음」(글을 주지 않는다 · 행 0)', async () => {
    expect(await peekIntro(user(3, 6), 'login-a')).toEqual({ introKey: null });
    expect(await claimIntro(user(3, 6), 'login-a', V3_SCENES_INTRO_KEY)).toEqual({ show: false });
    expect(await peekIntro({ ...user(2, 6), userType: 'super_admin' }, 'login-a')).toEqual({ introKey: null });
    expect(await rows(6)).toEqual([]);
  });

  it('무료체험 판: 준비 = 체험 판 · 그 열쇠로 선점 · 체험을 신청한 뒤의 다음 로그인 = 장면 판', async () => {
    expect(await claimIntro(user(1, 7), 'login-a', V3_SCENES_INTRO_KEY)).toEqual({ show: false });     // 판정은 체험 판이다
    expect(await claimIntro(user(1, 7), 'login-a', STUDIO_TRIAL_INTRO_KEY)).toEqual({ show: true, introKey: STUDIO_TRIAL_INTRO_KEY, variant: 'trial' });
    await requestStudioTrial(CO(1), UU(7));
    expect(await decideIntro(user(1, 7), 'login-b')).toEqual({ introKey: V3_SCENES_INTRO_KEY, variant: 'scenes' });
  });
});
