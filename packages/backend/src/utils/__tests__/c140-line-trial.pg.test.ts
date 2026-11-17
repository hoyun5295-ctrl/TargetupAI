// replaces: none
/**
 * C140 — 대시보드 한 줄 배너의 7일 무료체험 · 실 PostgreSQL 판(★ 2026-11-17 · 설계서 docs/2026-11-17-line-trial-banner-design.md §6)
 *   운영 함수(runLineTrialStart → judgeGrantEligibility → executeGrant → grantFreeTrial)를 그대로 돌린다. 표 = 운영 schema-only 덤프 사본.
 *   0. DDL 전 = 진단 id 칸 NOT NULL 위반 → 503 판정 · 전체 되돌림 / DDL(배포 원장 C140-DDL-1) 뒤 = NULL 허용
 *   1. 미가입 관리자 시작 = 지급 원장 1행(진단 id NULL · line-banner) + 체험 요금제 + 7일 + 체험 크레딧
 *   2. 같은 요청 두 번(연속 · 동시) = 원장 1행 · 두 답 모두 성공
 *   3. 체험이 살아 있지 않은 「이미 지급」 = trial_used / 지급 행 없는 대상 아님 = not_applicable
 *   4. 미가입 대조(누르지 않은 회사 = 원장 0 · 요금제 · 크레딧 그대로) · 설문 길(진단 id 있는 지급) 무변 · 회사 병합 축
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';

vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => 0) }));

import { runLineTrialStart, trialFutureSql, trialDaysLeftSql, isGrantDdlPending, lineBannerColumnsSql, judgeLineBanner } from '../line-trial';
import { judgeGrantEligibility, executeGrant } from '../marketing-diagnosis-grant';
import { buildIndirectCountQuery, DIAGNOSIS_GRANT_SPLIT_SQL } from '../company-merge';

const PLAN: Record<string, string> = {};
/** 시험 요금제 값 = 운영 실측 기록(status/SCHEMA.md plans 절): TRIAL 월 0원 · 750크레딧 */
const PLANS: Array<[string, number, number]> = [['FREE', 0, 0], ['TRIAL', 0, 750], ['BASIC', 350000, 750]];

const nullableOf = async () => (await query(
  `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'diagnosis_trial_grants' AND column_name = 'diagnosis_id'`,
)).rows[0]?.is_nullable;

async function company(plan: string, extra: Record<string, unknown> = {}): Promise<{ co: string; user: string }> {
  const co = randomUUID();
  const user = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: co, company_name: `C140 ${plan}`, plan_id: PLAN[plan], billing_type: 'prepaid', ...extra });
  await insertMinimalRow(pool, 'users', { id: user, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-0140', login_id: `t-c140-${co.slice(0, 8)}`, name: '시험' });
  return { co, user };
}
const coRow = async (co: string) => (await query(
  `SELECT UPPER(p.plan_code) AS plan, c.subscription_status AS status, c.trial_expires_at IS NOT NULL AS has_expiry,
          (c.trial_expires_at - NOW()) BETWEEN interval '6 days 23 hours' AND interval '7 days 1 minute' AS seven_days,
          c.ai_credits_base_remaining AS base, c.ai_credits_purchased AS purchased
     FROM companies c JOIN plans p ON p.id = c.plan_id WHERE c.id = $1::uuid`, [co],
)).rows[0];
const grantsOf = async (co: string) => (await query(
  `SELECT diagnosis_id, granted_days, granted_by, trial_expires_at IS NOT NULL AS has_expiry FROM diagnosis_trial_grants WHERE company_id = $1::uuid`, [co],
)).rows;
const countOf = async (table: string, co: string) => Number((await query(`SELECT count(*)::int AS n FROM ${table} WHERE company_id = $1::uuid`, [co])).rows[0].n);

/** DDL 전에 본 것(beforeAll 이 적는다) */
const pre: { nullable?: string; err?: any; row?: any; grants?: number; changes?: number; credits?: number } = {};

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C90-DDL-1'));
  for (const [code, price, credits] of PLANS) {
    const id = randomUUID();
    PLAN[code] = id;
    await insertMinimalRow(pool, 'plans', { id, plan_code: code, plan_name: code, monthly_price: price, ai_credits_per_month: credits, is_active: true });
  }
  // ── DDL 전: 새 코드가 먼저 돈 경우 ──
  pre.nullable = await nullableOf();
  const { co, user } = await company('FREE');
  pre.err = await runLineTrialStart(co, user).then(() => null, (e) => e);
  pre.row = await coRow(co);
  pre.grants = (await grantsOf(co)).length;
  pre.changes = await countOf('company_plan_changes', co);
  pre.credits = await countOf('ai_credit_transactions', co);
  // ── 배포 원장의 DDL 을 글자 그대로 ──
  await pool.query(ledgerBlockSql('C140-DDL-1'));
});

describe('0. DDL 앞뒤(배포 원장 C140-DDL-1)', () => {
  it('덤프 사본의 진단 id 칸 = NOT NULL → DDL 뒤 NULL 허용', async () => {
    expect(pre.nullable).toBe('NO');
    expect(await nullableOf()).toBe('YES');
  });

  it('DDL 전에 시작하면 그 칸의 NOT NULL 위반이고(503 판정) 지급 · 요금제 · 이력 · 크레딧이 전부 되돌려진다', () => {
    expect(pre.err).toBeTruthy();
    expect(String(pre.err.code)).toBe('23502');
    expect(isGrantDdlPending(pre.err)).toBe(true);
    expect(pre.row.plan).toBe('FREE');
    expect(pre.row.has_expiry).toBe(false);
    expect(pre.grants).toBe(0);
    expect(pre.changes).toBe(0);
    expect(pre.credits).toBe(0);
  });
});

describe('1. 미가입 관리자가 시작한다', () => {
  it('지급 원장 1행(진단 id NULL · line-banner:사용자 · 7일) + 체험 요금제 + 만료 7일 뒤 + 체험 크레딧 750', async () => {
    const { co, user } = await company('FREE');
    // 미가입 새 회사의 상태 칸 = 비어 있다(1026 에 DB 기본값 'trial' 을 없앴다 · status/SCHEMA.md companies 절)
    expect((await coRow(co)).status).toBe(null);

    const out = await runLineTrialStart(co, user);
    expect(out.outcome).toBe('granted');
    expect((out as any).trialExpiresAt).toBeTruthy();

    const row = await coRow(co);
    expect(row.plan).toBe('TRIAL');
    expect(row.status).toBe('trial');
    expect(row.seven_days).toBe(true);
    expect(Number(row.base)).toBe(750);
    expect(Number(row.purchased)).toBe(0);

    expect(await grantsOf(co)).toEqual([{ diagnosis_id: null, granted_days: 7, granted_by: `line-banner:${user}`, has_expiry: true }]);
    expect(await countOf('company_plan_changes', co)).toBe(1);
    expect(await countOf('marketing_diagnoses', co)).toBe(0);   // 가짜 진단 행을 만들지 않는다
  });

  it('상태 칸이 trial 인 미가입 회사(1026 전 옛 기본값으로 태어났거나 옛 체험의 흔적 · 지급 행 없음)도 시작된다 — 판정은 상태 칸을 읽지 않는다', async () => {
    const { co, user } = await company('FREE', { subscription_status: 'trial', trial_expires_at: '2026-06-30 00:00:00' });
    expect((await coRow(co)).status).toBe('trial');
    expect((await runLineTrialStart(co, user)).outcome).toBe('granted');
    expect((await coRow(co)).seven_days).toBe(true);   // 옛 만료일 위에 더하지 않고 오늘부터 7일
  });
});

describe('2. 같은 요청 두 번 = 원장 1행 · 두 답 모두 성공', () => {
  it('연속: 둘째 답 = already_granted · 같은 만료일 · 크레딧 · 이력이 한 번만', async () => {
    const { co, user } = await company('FREE');
    const a = await runLineTrialStart(co, user);
    const before = await coRow(co);
    const b = await runLineTrialStart(co, user);
    expect([a.outcome, b.outcome]).toEqual(['granted', 'already_granted']);
    expect(new Date((b as any).trialExpiresAt).getTime()).toBe(new Date((a as any).trialExpiresAt).getTime());
    expect(await grantsOf(co)).toHaveLength(1);
    expect(await countOf('company_plan_changes', co)).toBe(1);
    expect(Number((await coRow(co)).base)).toBe(Number(before.base));
  });

  it('동시: 하나는 granted · 하나는 already_granted · 원장 1행(회사 행 잠금이 줄 세운다)', async () => {
    const { co, user } = await company('FREE');
    const outs = await Promise.all([runLineTrialStart(co, user), runLineTrialStart(co, user)]);
    expect(outs.map((o) => o.outcome).sort()).toEqual(['already_granted', 'granted']);
    expect(await grantsOf(co)).toHaveLength(1);
    expect(await countOf('company_plan_changes', co)).toBe(1);
    expect(Number((await coRow(co)).base)).toBe(750);
  });
});

describe('3. 이미 지급인데 체험이 살아 있지 않다 = trial_used · 지급 행 없는 대상 아님 = not_applicable', () => {
  const started = async () => {
    const c = await company('FREE');
    expect((await runLineTrialStart(c.co, c.user)).outcome).toBe('granted');
    return c;
  };

  it('체험이 끝나 미가입으로 돌아간 회사(강등 워커가 한 뒤의 모양)', async () => {
    const { co, user } = await started();
    await query(`UPDATE companies SET plan_id = $2::uuid, subscription_status = 'trial_expired' WHERE id = $1::uuid`, [co, PLAN.FREE]);
    expect(await runLineTrialStart(co, user)).toEqual({ outcome: 'trial_used' });
    expect(await grantsOf(co)).toHaveLength(1);
  });

  it('만료일이 지났는데 강등 전인 회사 · 유료로 바뀐 회사(만료일 없는 체험은 DB 제약이 막는다)', async () => {
    const past = await started();
    await query(`UPDATE companies SET trial_expires_at = NOW() - interval '1 minute' WHERE id = $1::uuid`, [past.co]);
    expect(await runLineTrialStart(past.co, past.user)).toEqual({ outcome: 'trial_used' });

    // 「체험 상태인데 만료일 없음」은 만들 수 없다(1026 CHECK companies_trial_needs_expiry) — 판정 표의 그 칸은 DB 가 먼저 막는다
    const none = await started();
    await expect(query(`UPDATE companies SET trial_expires_at = NULL WHERE id = $1::uuid`, [none.co]))
      .rejects.toMatchObject({ code: '23514', constraint: 'companies_trial_needs_expiry' });

    // 유료 요금제에 trial 상태 · 미래 만료일이 같이 남은 조합(강등 워커가 강등을 막는 조합)에도 배너 체험은 살아 있지 않다
    const paid = await started();
    await query(`UPDATE companies SET plan_id = $2::uuid WHERE id = $1::uuid`, [paid.co, PLAN.BASIC]);
    expect((await coRow(paid.co)).status).toBe('trial');
    expect(await runLineTrialStart(paid.co, paid.user)).toEqual({ outcome: 'trial_used' });
  });

  it('지급 행 없이 유료 · 지급 행 없이 다른 체험 중 · 선불 이용 기간 잠김 · 없는 회사', async () => {
    const basic = await company('BASIC');
    expect(await runLineTrialStart(basic.co, basic.user)).toEqual({ outcome: 'not_applicable' });

    const otherTrial = await company('TRIAL', { subscription_status: 'trial', trial_expires_at: '2099-01-01 00:00:00' });
    expect(await runLineTrialStart(otherTrial.co, otherTrial.user)).toEqual({ outcome: 'not_applicable' });

    const managed = await company('FREE');
    await query(`UPDATE companies SET plan_term_expires_on = current_date + 30 WHERE id = $1::uuid`, [managed.co]);
    expect(await runLineTrialStart(managed.co, managed.user)).toEqual({ outcome: 'not_applicable' });

    for (const c of [basic, otherTrial, managed]) expect(await grantsOf(c.co)).toHaveLength(0);
    expect(await runLineTrialStart(randomUUID(), randomUUID())).toEqual({ outcome: 'company_not_found' });
  });
});

describe('4. 닿지 않는 것', () => {
  it('미가입 대조 — 누르지 않은 회사는 원장 0 · 요금제 · 크레딧 · 이력 그대로', async () => {
    const idle = await company('FREE');
    const before = await coRow(idle.co);
    const other = await company('FREE');
    expect((await runLineTrialStart(other.co, other.user)).outcome).toBe('granted');
    expect(await coRow(idle.co)).toEqual({ ...before, seven_days: before.seven_days });
    expect(before.plan).toBe('FREE');
    expect(await grantsOf(idle.co)).toHaveLength(0);
    expect(await countOf('company_plan_changes', idle.co)).toBe(0);
    expect(await countOf('ai_credit_transactions', idle.co)).toBe(0);
  });

  it('만료일 술어 = 강등 워커 「지남」의 여집합(지남 = 거짓 · 없음 = 거짓 · 뒤 = 참)', async () => {
    const c = await company('FREE');
    const f = async () => (await query(`SELECT ${trialFutureSql('c')} AS f FROM companies c WHERE c.id = $1::uuid`, [c.co])).rows[0].f;
    expect(await f()).toBe(false);
    await query(`UPDATE companies SET trial_expires_at = NOW() + interval '1 hour' WHERE id = $1::uuid`, [c.co]);
    expect(await f()).toBe(true);
    await query(`UPDATE companies SET trial_expires_at = NOW() - interval '1 second' WHERE id = $1::uuid`, [c.co]);
    expect(await f()).toBe(false);
  });

  it('남은 날 수 = 서울 달력으로 센다(사흘 뒤 정오 = 3 · 오늘 밤 23시 59분 = 0 · 방금 켠 체험 = 7 · 만료일 없음 = NULL)', async () => {
    const c = await company('FREE');
    const days = async () => (await query(`SELECT ${trialDaysLeftSql('c')} AS d FROM companies c WHERE c.id = $1::uuid`, [c.co])).rows[0].d;
    expect(await days()).toBe(null);
    // 서울 벽시계로 만든 시각을 운영이 쓰는 꼴(세션 시간대의 벽시계 · NOW() + n일과 같은 기준)로 넣는다
    const setKst = (expr: string) => query(
      `UPDATE companies SET trial_expires_at = ((${expr}) AT TIME ZONE 'Asia/Seoul')::timestamp WHERE id = $1::uuid`, [c.co]);
    await setKst(`(NOW() AT TIME ZONE 'Asia/Seoul')::date + 3 + time '12:00'`);
    expect(await days()).toBe(3);
    await setKst(`(NOW() AT TIME ZONE 'Asia/Seoul')::date + time '23:59'`);
    expect(await days()).toBe(0);

    const fresh = await company('FREE');
    expect((await runLineTrialStart(fresh.co, fresh.user)).outcome).toBe('granted');
    expect((await query(`SELECT ${trialDaysLeftSql('c')} AS d FROM companies c WHERE c.id = $1::uuid`, [fresh.co])).rows[0].d).toBe(7);
  });

  it('배너 판정의 입력은 회사 행과 한 문장으로 읽는다 — 지급이 떠 있는 동안 = (미가입 · 지급 없음) · 끝난 뒤 = (체험 · 지급 있음) · 섞인 조합이 없어 배너가 사라지지 않는다', async () => {
    // Codex 구현 1R 2 — 요금제와 지급 여부를 따로 읽으면 지급 COMMIT 과 겹칠 때 (미가입 · 지급 있음)이 나와 배너가 없음으로 갈린다.
    const c = await company('FREE');
    const read = async () => (await query(
      `SELECT UPPER(COALESCE(p.plan_code, '')) AS plan_code, ${lineBannerColumnsSql('c')}
         FROM companies c LEFT JOIN plans p ON p.id = c.plan_id WHERE c.id = $1::uuid`, [c.co])).rows[0];
    const bannerOf = (r: any) => judgeLineBanner({ userType: 'company_admin', planCode: r.plan_code, hasGrant: r.has_grant, trialFuture: r.trial_future });
    const before = await read();
    expect([before.plan_code, before.has_grant, before.trial_future, before.trial_days_left]).toEqual(['FREE', false, false, null]);
    expect(bannerOf(before)).toBe('offer');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect((await judgeGrantEligibility(client, c.co)).outcome).toBe('granted');
      await executeGrant(client, c.co, null, { grantedBy: 'line-banner:t' });
      // 지급 트랜잭션이 아직 끝나지 않았다 — 다른 연결의 한 문장은 지급 전 값만 본다(회사 행 잠금에 걸려 기다리지도 않는다)
      const mid = await read();
      expect([mid.plan_code, mid.has_grant, mid.trial_future]).toEqual(['FREE', false, false]);
      expect(bannerOf(mid)).toBe('offer');
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    const after = await read();
    expect([after.plan_code, after.has_grant, after.trial_future, after.trial_days_left]).toEqual(['TRIAL', true, true, 7]);
    expect(bannerOf(after)).toBe('trial');
    // 섞인 조합(따로 읽으면 나올 수 있던 것)은 배너 없음이다 = 이 조합이 나오지 않게 한 문장으로 읽는다
    expect(judgeLineBanner({ userType: 'company_admin', planCode: 'FREE', hasGrant: true, trialFuture: false })).toBe(null);
  });

  it('설문 길(진단 id 있는 지급)은 종전 그대로 · 배너로 켠 회사가 나중에 설문을 내면 판정 = already_granted', async () => {
    await insertMinimalRow(pool, 'diagnosis_question_sets', { version: 't-c140', definition: '{}', is_active: false });
    const c = await company('FREE');
    const dx = randomUUID();
    await insertMinimalRow(pool, 'marketing_diagnoses', { id: dx, funnel: 'A', company_id: c.co, question_set_version: 't-c140', answers: '{}', result: '{}' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect((await judgeGrantEligibility(client, c.co)).outcome).toBe('granted');
      await executeGrant(client, c.co, dx);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await grantsOf(c.co)).toEqual([{ diagnosis_id: dx, granted_days: 7, granted_by: 'diagnosis-auto', has_expiry: true }]);

    const banner = await company('FREE');
    expect((await runLineTrialStart(banner.co, banner.user)).outcome).toBe('granted');
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      expect((await judgeGrantEligibility(client2, banner.co)).outcome).toBe('already_granted');
      await client2.query('ROLLBACK');
    } finally {
      client2.release();
    }
  });

  it('회사 병합 — 진단 id 없는 지급 행은 「옛 회사 진단을 가리키는 지급」으로 세지 않는다(결합 문장 · 공용 FK 축 둘 다 0)', async () => {
    const c = await company('FREE');
    expect((await runLineTrialStart(c.co, c.user)).outcome).toBe('granted');
    const split = await query(DIAGNOSIS_GRANT_SPLIT_SQL, [c.co]);
    const axis = await query(
      buildIndirectCountQuery({ childTable: 'diagnosis_trial_grants', childColumns: ['diagnosis_id'], parentTable: 'marketing_diagnoses', parentColumns: ['id'] } as any),
      [c.co],
    );
    // 결합 문장은 「그 회사의 지급 행이 진단을 가리키는 수」 = JOIN 이라 NULL 행은 0
    expect(Number(split.rows[0].cnt)).toBe(0);
    expect(Number(axis.rows[0].cnt)).toBe(0);
  });
});
