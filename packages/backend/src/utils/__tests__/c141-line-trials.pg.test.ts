// replaces: none
/**
 * C141 — 슈퍼관리자 「기능 관심 업체」의 7일 무료체험 목록 · 실 PostgreSQL 판(★ 2026-11-17 · 설계 docs/2026-11-17-c141-feature-interest-redesign-design.md)
 *   운영 문장(LINE_TRIAL_LIST_SQL · loadFeatureInterest 의 SQL 전부)을 글자 그대로 돌린다. 새 표 · 새 칸 0(C140-DDL-1 의 칸을 읽기만).
 *   지급은 운영 함수 그대로 = 배너(runLineTrialStart) · 진단 설문(executeGrant + 진단 행) · 슈퍼관리자 부여(executeGrant + 기록자 admin:).
 *   1. 길 · 켠 사람 이름(배너만) · 살아 있음 · 남은 날 · 끝나는 시각(살아 있으면 회사 · 끝났으면 지급 때)
 *   2. 집계 끝까지 = 업체 줄에 7일 체험 · 본 기록이 없는 체험 회사도 줄 · 기능 줄의 누른 수
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { LINE_TRIAL_LIST_SQL, loadLineTrials, runLineTrialStart } from '../line-trial';
import { judgeGrantEligibility, executeGrant } from '../marketing-diagnosis-grant';
import { requestStudioTrial } from '../studio-trial';
import { loadFeatureInterest, parseFeatureInterestQuery, recordFeatureSeen } from '../feature-interest';
import { recentActivity } from '../../../../frontend/src/utils/feature-interest-view';

const PLAN: Record<string, string> = {};
/** 시험 요금제 값 = 운영 실측(원장 C140-P0 · 1117): TRIAL 월 0원 · 750크레딧 */
const PLANS: Array<[string, number, number]> = [['FREE', 0, 0], ['TRIAL', 0, 750]];
const MINE: string[] = [];

async function company(name: string): Promise<{ co: string; user: string }> {
  const co = randomUUID();
  const user = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: co, company_name: name, plan_id: PLAN.FREE, billing_type: 'prepaid' });
  await insertMinimalRow(pool, 'users', { id: user, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-0141', login_id: `t-c141-${co.slice(0, 8)}`, name: `${name} 담당` });
  MINE.push(co);
  return { co, user };
}
async function grantWithDiagnosis(co: string, grantedBy?: string) {
  const dx = randomUUID();
  await insertMinimalRow(pool, 'marketing_diagnoses', { id: dx, funnel: 'A', company_id: co, question_set_version: 't-c141', answers: '{}', result: '{}' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    expect((await judgeGrantEligibility(client, co)).outcome).toBe('granted');
    await executeGrant(client, co, dx, grantedBy ? { grantedBy } : undefined);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

let banner: { co: string; user: string };
let survey: { co: string; user: string };
let admin: { co: string; user: string };
let ended: { co: string; user: string };

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C90-DDL-1'));
  await pool.query(ledgerBlockSql('C140-DDL-1'));
  await pool.query(ledgerBlockSql('C135-DDL-1'));   // 이미지 체험 신청 표(3R 뒤집은 반례)
  for (const [code, price, credits] of PLANS) {
    const id = randomUUID();
    PLAN[code] = id;
    await insertMinimalRow(pool, 'plans', { id, plan_code: code, plan_name: code === 'TRIAL' ? '무료체험' : '미가입', monthly_price: price, ai_credits_per_month: credits, is_active: true });
  }
  await insertMinimalRow(pool, 'diagnosis_question_sets', { version: 't-c141', definition: '{}', is_active: false });

  banner = await company('C141 배너');
  expect((await runLineTrialStart(banner.co, banner.user)).outcome).toBe('granted');
  survey = await company('C141 설문');
  await grantWithDiagnosis(survey.co);
  admin = await company('C141 부여');
  await grantWithDiagnosis(admin.co, `admin:${randomUUID()}`);
  // 끝난 체험 = 강등 워커가 한 뒤의 모양(미가입 · 만료가 지남) · 지급 때 정한 만료는 그대로
  ended = await company('C141 끝남');
  expect((await runLineTrialStart(ended.co, ended.user)).outcome).toBe('granted');
  await pool.query(`UPDATE diagnosis_trial_grants SET trial_expires_at = NOW() - interval '1 day' WHERE company_id = $1::uuid`, [ended.co]);
  await pool.query(`UPDATE companies SET plan_id = $2::uuid, subscription_status = 'trial_expired', trial_expires_at = NOW() - interval '1 day' WHERE id = $1::uuid`, [ended.co, PLAN.FREE]);
  // 배너 회사의 본 · 누른 기록 = 운영 기록 함수 그대로(audit_logs)
  const req = { user: { userId: banner.user, companyId: banner.co, userType: 'company_admin' }, ip: '127.0.0.1', headers: { 'user-agent': 'c141-pg' } };
  expect(await recordFeatureSeen(req, { featureId: 'line-trial', event: 'open' })).toBe(true);
  expect(await recordFeatureSeen(req, { featureId: 'line-trial', event: 'go' })).toBe(true);
});

describe('1. 7일 무료체험 목록(운영 문장 그대로)', () => {
  it('길 · 켠 사람 · 살아 있음 · 남은 날 · 끝나는 시각', async () => {
    const all = await loadLineTrials();
    expect(all).not.toBeNull();
    const by = new Map(all!.filter((r) => MINE.includes(r.companyId)).map((r) => [r.companyId, r]));
    expect(by.size).toBe(4);
    expect(by.get(banner.co)).toMatchObject({ source: 'banner', grantedBy: 'C141 배너 담당', alive: true, daysLeft: 7 });
    expect(by.get(survey.co)).toMatchObject({ source: 'diagnosis', grantedBy: '', alive: true, daysLeft: 7 });
    expect(by.get(admin.co)).toMatchObject({ source: 'admin', grantedBy: '', alive: true, daysLeft: 7 });
    expect(by.get(ended.co)).toMatchObject({ source: 'banner', grantedBy: 'C141 끝남 담당', alive: false, daysLeft: null });
    // 끝나는 시각 = 살아 있으면 회사의 만료(지급 7일 뒤) · 끝났으면 지급 원장의 만료(어제)
    const now = Date.now();
    const days = (iso: string | null) => (new Date(iso!).getTime() - now) / 86_400_000;
    expect(days(by.get(banner.co)!.endsAt)).toBeGreaterThan(6.9);
    expect(days(by.get(banner.co)!.endsAt)).toBeLessThan(7.01);
    expect(days(by.get(ended.co)!.endsAt)).toBeGreaterThan(-1.01);
    expect(days(by.get(ended.co)!.endsAt)).toBeLessThan(-0.99);
    // 켠 시각 = 방금(지급 원장 created_at)
    expect(now - new Date(by.get(banner.co)!.grantedAt).getTime()).toBeLessThan(10 * 60_000);
  });

  it('지급 원장이 없는 회사는 목록에 없다 · 문장은 한 회사 한 줄(지급 원장 UNIQUE(company_id))', async () => {
    const plain = await company('C141 지급 없음');
    const rows = (await pool.query(LINE_TRIAL_LIST_SQL)).rows.map((r: any) => String(r.company_id));
    expect(rows).not.toContain(plain.co);
    for (const co of [banner.co, survey.co, admin.co, ended.co]) expect(rows.filter((x) => x === co)).toHaveLength(1);
  });
});

describe('2. 집계 끝까지(운영 문장 그대로)', () => {
  it('업체 줄에 7일 체험 · 본 기록이 없는 체험 회사도 줄 · 기능 줄의 누른 수 · 목록을 읽었다', async () => {
    const d = await loadFeatureInterest(parseFeatureInterestQuery({ period: 'all' }));
    expect(d.lineTrialsKnown).toBe(true);
    const by = new Map(d.companies.filter((c) => MINE.includes(c.companyId)).map((c) => [c.companyId, c]));
    expect(by.get(banner.co)).toMatchObject({ seen: true, companyName: 'C141 배너', features: [{ featureId: 'line-trial', opens: 1, clicks: 1 }], goClicks: 1, lineTrial: { source: 'banner', alive: true, daysLeft: 7 } });
    // 최근 누름 = 열람을 뺀 기록만(운영 문장 그대로)
    expect(by.get(banner.co)!.recentClicks.map((e) => [e.event, e.featureId, e.userName])).toEqual([['go', 'line-trial', 'C141 배너 담당']]);
    expect(by.get(survey.co)).toMatchObject({ seen: false, companyName: 'C141 설문', features: [], lineTrial: { source: 'diagnosis', alive: true } });
    expect(by.get(ended.co)!.lineTrial).toMatchObject({ alive: false, daysLeft: null });
    expect(by.has(MINE[MINE.length - 1])).toBe(false);   // 지급도 기록도 없는 회사는 줄이 없다
  });
});

describe('3. 최근 일어난 일 — Codex 구현 2R · 3R 반례(운영 문장 + 화면 판정)', () => {
  // 기록 = 운영 기록 함수가 쓰는 칸 그대로(user_id · action · target_type · details{featureId, companyId}) · 시각만 정해 넣는다
  const ins = (user: string, co: string, action: string, featureId: string, iso: string) => pool.query(
    `INSERT INTO audit_logs (user_id, action, target_type, details, created_at) VALUES ($1, $2, 'plan_feature', $3, $4)`,
    [user, action, JSON.stringify({ featureId, companyId: co }), iso]);
  /** 결과(켬 · 신청) 직전 1 ~ 10분에 가려질 단추 10번 · 11분 전 남을 누름 1번(A) · 20 ~ 24분 전 바로가기 5번(B) → 화면 최근 여섯 */
  async function scenario(o: { result: 'line' | 'studio'; hidden: string; keep: [string, string] }) {
    const A = await company(`C141 반례 A ${o.result}${o.keep[1]}`);
    const B = await company(`C141 반례 B ${o.result}${o.keep[1]}`);
    let t0: Date;
    if (o.result === 'line') {
      expect((await runLineTrialStart(A.co, A.user)).outcome).toBe('granted');
      t0 = (await pool.query('SELECT created_at::timestamptz AS t FROM diagnosis_trial_grants WHERE company_id = $1::uuid', [A.co])).rows[0].t;
    } else {
      await requestStudioTrial(A.co, A.user);
      t0 = (await pool.query('SELECT requested_at::timestamptz AS t FROM image_studio_trials WHERE company_id = $1::uuid', [A.co])).rows[0].t;
    }
    const at = (min: number) => new Date(t0.getTime() + min * 60_000).toISOString();
    for (let i = 1; i <= 10; i++) await ins(A.user, A.co, 'plan_feature_go', o.hidden, at(-i));
    await ins(A.user, A.co, o.keep[0], o.keep[1], at(-11));
    for (let i = 0; i < 5; i++) await ins(B.user, B.co, 'plan_feature_go', 'login-promo', at(-20 - i));
    const d = await loadFeatureInterest(parseFeatureInterestQuery({ period: 'all' }));
    const two = d.companies.filter((c) => c.companyId === A.co || c.companyId === B.co);
    expect(two).toHaveLength(2);
    const who = (id: string) => (id === A.co ? 'A' : 'B');
    return { acts: recentActivity(two as any, (id) => id, 6).map((a) => [who(a.companyId), a.text]), a: two.find((c) => c.companyId === A.co)! };
  }
  const B4 = Array.from({ length: 4 }, () => ['B', '로그인 안내 창에서 바로가기']);

  it('2R — 7일 체험(결과 있음) 단추 10번 + 요금제 보기 1번 → A 켬 · A 요금제 보기 · B 넷', async () => {
    const { acts, a } = await scenario({ result: 'line', hidden: 'line-trial', keep: ['plan_feature_pricing', 'sns'] });
    expect(acts).toEqual([['A', '배너로 7일 무료체험 켬'], ['A', 'sns 안내 창에서 요금제 보기'], ...B4]);
    expect(a.recentClicks.filter((e) => e.featureId === 'line-trial')).toHaveLength(6);   // 묶음마다 6건
  });

  it('3R — 7일 체험(결과 있음) 단추 10번 + 결과 없는 이미지 체험 단추 1번 → A 켬 · A 이미지 체험 누름 · B 넷', async () => {
    const { acts } = await scenario({ result: 'line', hidden: 'line-trial', keep: ['plan_feature_go', 'studio-trial'] });
    expect(acts).toEqual([['A', '배너로 7일 무료체험 켬'], ['A', '이미지 체험 안내에서 체험 신청'], ...B4]);
  });

  it('3R 뒤집음 — 이미지 체험(결과 있음) 단추 10번 + 결과 없는 7일 체험 단추 1번 → A 신청 · A 7일 체험 누름 · B 넷', async () => {
    const { acts } = await scenario({ result: 'studio', hidden: 'studio-trial', keep: ['plan_feature_go', 'line-trial'] });
    expect(acts).toEqual([['A', '이미지 체험 신청'], ['A', '7일 무료체험 배너에서 7일 무료로 써 보기'], ...B4]);
  });
});
