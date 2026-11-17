// replaces: none
/**
 * C138 — 기능 관심 업체에 합친 줄(무료체험 신청 · 「다시 보지 않기」) · 실 PostgreSQL 판 (★ 2026-11-16 · 설계 기록 docs/2026-11-16-c138-trial-entry-interest-design.md)
 *   운영 문장(INTRO_DISMISSED_SQL · loadFeatureInterest 의 SQL 전부)을 글자 그대로 돌린다. 새 표 · 새 칸 0(C133-DDL-1 · C135-DDL-1 의 표를 읽기만).
 *   1. 누른 계정 목록 = 누른 행만 · 회사가 있는 계정만 · 최근에 누른 순 · 문 행 · 노출만 한 계정 · 계정 행이 없는 기록은 빠진다
 *   2. 업체 줄 = 본 기록이 없어도 무료체험 신청 · 「다시 보지 않기」 회사가 나온다 · 본 회사에는 seen · 요금제 조건이 걸린다
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import { INTRO_CLAIM_SQL, INTRO_DISMISSED_SQL, STUDIO_TRIAL_INTRO_KEY, V3_SCENES_INTRO_KEY, V3_INTRO_MAX_SHOWN, dismissIntro, loadIntroDismissals } from '../v3-intro';
import { requestStudioTrial, reserveStudioTrial } from '../studio-trial';
import { loadFeatureInterest, parseFeatureInterestQuery, recordFeatureSeen } from '../feature-interest';

const CO = (n: number) => `00000000-0000-0000-0000-0000000c138${n}`;
const US = (n: number) => `00000000-0000-0000-0000-000000c138a${n}`;
/** 계정 행이 없는 기록(다른 시험이 남긴 것과 같은 꼴) */
const GHOST = '00000000-0000-0000-0000-000000c138af';
const MINE_CO = '00000000-0000-0000-0000-0000000c138%';
const MINE_US = '00000000-0000-0000-0000-000000c138a%';
const mine = <T extends { companyId: string }>(rows: T[]) => rows.filter((r) => r.companyId.startsWith('00000000-0000-0000-0000-0000000c138'));
const user = (n: number, co: number) => ({ userId: US(n), companyId: CO(co), userType: 'company_admin' });
const setDismissedAt = (n: number, key: string, at: string) =>
  pool.query('UPDATE user_intro_acks SET dismissed_at = $3::timestamptz WHERE user_id = $1::uuid AND intro_key = $2', [US(n), key, at]);

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C133-DDL-1'));
  await pool.query(ledgerBlockSql('C135-DDL-1'));
  await pool.query('DELETE FROM user_intro_acks WHERE user_id::text LIKE $1', [MINE_US]);
  await pool.query('DELETE FROM image_studio_trials WHERE company_id::text LIKE $1', [MINE_CO]);
  await pool.query('DELETE FROM audit_logs WHERE user_id::text LIKE $1', [MINE_US]);
  await pool.query('DELETE FROM users WHERE id::text LIKE $1', [MINE_US]);
  await pool.query('DELETE FROM companies WHERE id::text LIKE $1', [MINE_CO]);

  for (const n of [1, 2, 3, 4]) await insertMinimalRow(pool, 'companies', { id: CO(n), company_name: `C138 회사 ${n}` });
  // 회사 1 = 계정 둘(체험 창 숨김 · 장면 창 숨김) + 무료체험 신청(한 장 씀) · 회사 2 = 장면 창 숨김 + 본 기록 · 회사 3 = 노출만(숨김 없음) · 회사 4 = 무료체험만
  const people: [number, number, string][] = [[1, 1, '김일'], [2, 1, ''], [3, 2, '박이'], [4, 3, '최삼'], [5, 4, '정사']];
  for (const [n, co, name] of people) {
    await insertMinimalRow(pool, 'users', { id: US(n), company_id: CO(co), user_type: 'admin', is_active: true, phone: `010-0000-138${n}`, login_id: `t-c138-${n}`, name });
  }
  expect(await dismissIntro(user(1, 1), STUDIO_TRIAL_INTRO_KEY)).toBe(true);
  expect(await dismissIntro(user(2, 1), V3_SCENES_INTRO_KEY)).toBe(true);
  expect(await dismissIntro(user(3, 2), V3_SCENES_INTRO_KEY)).toBe(true);
  await setDismissedAt(1, STUDIO_TRIAL_INTRO_KEY, '2026-11-16T01:00:00Z');
  await setDismissedAt(2, V3_SCENES_INTRO_KEY, '2026-11-16T03:00:00Z');
  await setDismissedAt(3, V3_SCENES_INTRO_KEY, '2026-11-16T02:00:00Z');
  // 노출만 한 계정(회사 3) — 운영 선점 문장 그대로(문 행 _login 과 판 행이 생기고 둘 다 해제 시각이 없다)
  await pool.query(INTRO_CLAIM_SQL, [US(4), V3_SCENES_INTRO_KEY, 'mark-c138', V3_INTRO_MAX_SHOWN]);
  // 계정 행이 없는 숨김 기록
  await pool.query("INSERT INTO user_intro_acks (user_id, intro_key, dismissed_at) VALUES ($1::uuid, $2, now())", [GHOST, V3_SCENES_INTRO_KEY]);

  await requestStudioTrial(CO(1), US(1));
  await reserveStudioTrial(CO(1), 'k-1');
  await requestStudioTrial(CO(4), US(5));
  // 회사 2 의 본 기록 = 운영 기록 함수 그대로(audit_logs)
  const req = { user: user(3, 2), ip: '127.0.0.1', headers: { 'user-agent': 'c138-pg' } };
  expect(await recordFeatureSeen(req, { featureId: 'login-promo', event: 'open' })).toBe(true);
  expect(await recordFeatureSeen(req, { featureId: 'login-promo', event: 'go' })).toBe(true);
});

describe('「다시 보지 않기」를 누른 계정 목록(실 PG)', () => {
  it('누른 행만 · 회사가 있는 계정만 · 최근에 누른 순 — 노출만 한 계정 · 문 행 · 계정 행 없는 기록은 빠진다', async () => {
    const list = mine((await loadIntroDismissals())!);
    expect(list).toEqual([
      { companyId: CO(1), introKey: V3_SCENES_INTRO_KEY, at: '2026-11-16T03:00:00.000Z', userName: '', loginId: 't-c138-2' },
      { companyId: CO(2), introKey: V3_SCENES_INTRO_KEY, at: '2026-11-16T02:00:00.000Z', userName: '박이', loginId: 't-c138-3' },
      { companyId: CO(1), introKey: STUDIO_TRIAL_INTRO_KEY, at: '2026-11-16T01:00:00.000Z', userName: '김일', loginId: 't-c138-1' },
    ]);
    // 계정 행이 없는 기록(GHOST)은 회사 · 아이디를 알 수 없어 목록에 없다 = 목록의 모든 줄에 회사 id 와 로그인 아이디가 있다
    const whole = (await loadIntroDismissals())!;
    expect(whole.length).toBeGreaterThanOrEqual(3);
    expect(whole.filter((r) => !/^[0-9a-f-]{36}$/.test(r.companyId) || !r.loginId)).toEqual([]);
    expect((await pool.query('SELECT 1 FROM user_intro_acks WHERE user_id = $1::uuid AND dismissed_at IS NOT NULL', [GHOST])).rows).toHaveLength(1);
    // 노출만 한 계정은 표에 행이 있지만(문 행 + 판 행) 목록에는 없다
    const shown = await pool.query('SELECT intro_key, dismissed_at FROM user_intro_acks WHERE user_id = $1::uuid ORDER BY intro_key', [US(4)]);
    expect(shown.rows.length).toBeGreaterThanOrEqual(1);
    expect(shown.rows.every((r: any) => r.dismissed_at === null)).toBe(true);
    // 전체 목록도 최근에 누른 순
    const all = (await pool.query(INTRO_DISMISSED_SQL)).rows;
    for (let i = 1; i < all.length; i++) expect(new Date(all[i - 1].dismissed_at) >= new Date(all[i].dismissed_at)).toBe(true);
  });
});

describe('업체 줄(실 PG)', () => {
  const load = (q: any) => loadFeatureInterest(parseFeatureInterestQuery(q));

  it('본 기록이 없어도 무료체험 신청 · 「다시 보지 않기」 회사가 줄로 나온다 · 노출만 한 회사는 안 나온다', async () => {
    const d = await load({ period: 'all' });
    const by = new Map(mine(d.companies).map((c) => [c.companyId, c]));
    expect([...by.keys()].sort()).toEqual([CO(1), CO(2), CO(4)]);
    expect(d.trialsKnown).toBe(true);
    expect(d.dismissalsKnown).toBe(true);

    const c1 = by.get(CO(1))!;
    expect(c1).toMatchObject({ companyName: 'C138 회사 1', seen: false, features: [], pricingClicks: 0, goClicks: 0, users: [], events: [] });
    expect(c1.trial).toMatchObject({ requestedBy: '김일', used: 1, granted: 3 });
    expect(c1.dismissed.map((x) => `${x.introKey}/${x.loginId}`)).toEqual([`${V3_SCENES_INTRO_KEY}/t-c138-2`, `${STUDIO_TRIAL_INTRO_KEY}/t-c138-1`]);

    const c2 = by.get(CO(2))!;
    expect(c2).toMatchObject({ companyName: 'C138 회사 2', seen: true, trial: null, goClicks: 1, features: [{ featureId: 'login-promo', opens: 1 }] });
    expect(c2.users).toEqual([{ name: '박이', loginId: 't-c138-3' }]);
    expect(c2.dismissed).toEqual([{ introKey: V3_SCENES_INTRO_KEY, at: '2026-11-16T02:00:00.000Z', userName: '박이', loginId: 't-c138-3' }]);

    const c4 = by.get(CO(4))!;
    expect(c4).toMatchObject({ companyName: 'C138 회사 4', seen: false, dismissed: [] });
    expect(c4.trial).toMatchObject({ requestedBy: '정사', used: 0, granted: 3 });
  });

  it('요금제 조건은 합친 줄에도 걸린다(시험 회사 = 요금제 없음)', async () => {
    expect(mine((await load({ period: 'all', plan: 'subscribed' })).companies)).toEqual([]);
    expect(mine((await load({ period: 'all', plan: 'unsubscribed' })).companies).map((c) => c.companyId).sort()).toEqual([CO(1), CO(2), CO(4)]);
  });

  it('기간을 좁혀도 무료체험 신청 · 「다시 보지 않기」 회사는 그대로 나온다(지금 상태) · 본 기록은 그 기간 것만', async () => {
    const d = await load({ period: 'today' });
    const rows = mine(d.companies);
    expect(rows.map((c) => c.companyId).sort()).toEqual([CO(1), CO(2), CO(4)]);
    expect(rows.map((c) => `${c.companyId.slice(-1)}:${c.seen}`).sort()).toEqual(['1:false', '2:true', '4:false']);   // 회사 2 = 방금 남긴 본 기록
    expect(Object.keys(d).sort()).toEqual(['companies', 'dismissalsKnown', 'lineTrialsKnown', 'trialsKnown']);   // ★ C141 7일 체험 목록을 읽었는가
  });
});
