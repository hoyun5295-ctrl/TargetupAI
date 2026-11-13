// replaces: none
/**
 * C133 F7 — 소개 창 노출 선점 · 실 PostgreSQL 판(★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §2-4 · 대기 DDL C133-DDL-1 을 시험 안에서 얹는다)
 *   운영 문장(INTRO_CLAIM_SQL · INTRO_DISMISS_SQL)을 글자 그대로 돌린다.
 *   1. 한 계정에 최대 3번 · 같은 로그인(표식)은 한 번 · A → B → A 도 한 번
 *   2. 동시에 여러 로그인이 와도 3을 넘지 않는다(한 문장 선점)
 *   3. 「다시 보지 않기」 = 그 뒤로 0 · 처음 해제 시각 유지 · 띄운 적 없어도 해제 가능
 *   4. 사용자 · 소개 판마다 따로 센다
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { INTRO_CLAIM_SQL, INTRO_DISMISS_SQL, V3_INTRO_KEY, V3_INTRO_MAX_SHOWN, introLoginMark } from '../v3-intro';

const U = (n: number) => `00000000-0000-0000-0000-0000000c133${n}`;
const claim = async (user: string, mark: string, key: string = V3_INTRO_KEY) =>
  (await pool.query(INTRO_CLAIM_SQL, [user, key, mark, V3_INTRO_MAX_SHOWN])).rows;
const row = async (user: string, key: string = V3_INTRO_KEY) =>
  (await pool.query('SELECT login_marks, dismissed_at FROM user_intro_acks WHERE user_id = $1 AND intro_key = $2', [user, key])).rows[0];

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C133-DDL-1'));
});

describe('노출 선점 한 문장(실 PG)', () => {
  it('첫 노출 = 행이 생기고 돌아온다 · 같은 로그인의 두 번째 요청 = 0행', async () => {
    const a = introLoginMark('login-a')!;
    expect(await claim(U(1), a)).toEqual([{ shown: 1 }]);
    expect(await claim(U(1), a)).toEqual([]);
    expect((await row(U(1))).login_marks).toEqual([a]);
  });

  it('로그인 세 번까지 · 네 번째 로그인 = 0행 · A → B → A 의 두 번째 A = 0행(노출 수를 다시 쓰지 않는다)', async () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) => introLoginMark(`u2-${x}`)!);
    expect(await claim(U(2), a)).toEqual([{ shown: 1 }]);
    expect(await claim(U(2), b)).toEqual([{ shown: 2 }]);
    expect(await claim(U(2), a)).toEqual([]);
    expect(await claim(U(2), c)).toEqual([{ shown: 3 }]);
    expect(await claim(U(2), d)).toEqual([]);
    expect(await claim(U(2), b)).toEqual([]);
    expect((await row(U(2))).login_marks).toEqual([a, b, c]);
  });

  it('동시에 로그인 열 개가 와도 띄우는 것은 셋', async () => {
    const marks = Array.from({ length: 10 }, (_, i) => introLoginMark(`u3-${i}`)!);
    const got = await Promise.all(marks.map((m) => claim(U(3), m)));
    expect(got.filter((r) => r.length === 1)).toHaveLength(3);
    expect((await row(U(3))).login_marks).toHaveLength(3);
  });

  it('같은 로그인의 요청 열 개가 동시에 와도 하나만', async () => {
    const m = introLoginMark('u4-same')!;
    const got = await Promise.all(Array.from({ length: 10 }, () => claim(U(4), m)));
    expect(got.filter((r) => r.length === 1)).toHaveLength(1);
    expect((await row(U(4))).login_marks).toEqual([m]);
  });
});

describe('「다시 보지 않기」(실 PG)', () => {
  it('해제 뒤에는 새 로그인도 0행 · 다시 눌러도 처음 해제 시각 그대로', async () => {
    expect(await claim(U(5), introLoginMark('u5-a')!)).toEqual([{ shown: 1 }]);
    await pool.query(INTRO_DISMISS_SQL, [U(5), V3_INTRO_KEY]);
    const first = (await row(U(5))).dismissed_at;
    expect(first).toBeTruthy();
    expect(await claim(U(5), introLoginMark('u5-b')!)).toEqual([]);
    await pool.query(INTRO_DISMISS_SQL, [U(5), V3_INTRO_KEY]);
    const again = await row(U(5));
    expect(new Date(again.dismissed_at).getTime()).toBe(new Date(first).getTime());
    expect(again.login_marks).toHaveLength(1);
  });

  it('띄운 적 없는 계정도 해제할 수 있고 그 뒤로 0행', async () => {
    await pool.query(INTRO_DISMISS_SQL, [U(6), V3_INTRO_KEY]);
    expect((await row(U(6))).login_marks).toEqual([]);
    expect(await claim(U(6), introLoginMark('u6-a')!)).toEqual([]);
  });
});

describe('사용자 · 소개 판마다 따로(실 PG)', () => {
  it('다른 사용자 · 다른 판은 서로의 횟수 · 해제에 영향이 없다', async () => {
    const m = introLoginMark('u7-a')!;
    await pool.query(INTRO_DISMISS_SQL, [U(7), V3_INTRO_KEY]);
    expect(await claim(U(7), m)).toEqual([]);
    expect(await claim(U(7), m, 'next-intro')).toEqual([{ shown: 1 }]);   // 다음 판 소개는 새로 센다
    expect(await claim(U(8), m)).toEqual([{ shown: 1 }]);                 // 같은 표식이어도 다른 사용자
  });
});
