// replaces: none
/**
 * C144 — JBN 특별가 · 실 PostgreSQL 판(★ 2026-11-18 · 설계서 docs/2026-11-18-c144-jbn-special-price-design.md §6)
 *   원장 블록 C144-DDL-1 · C144-DML-1 을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본).
 *   0. DDL 전 = 공개 목록 그대로 · JBN 주소 = 칸 · 표 없음(503 갈래)
 *   1. DML 이 도는 동안 월초 고정이 기다린다(한 트랜잭션 · 잠금) · 원 요금제의 그 달 고정값이 JBN 코드에 복사된다
 *   2. JBN 행 = 활성 유료 공개 요금제마다 한 줄 · 월정액 0.7 · 기능 칸 같음 · 두 번 돌려도 그대로
 *   3. 공개 목록 · 진단 후보 · 무료 수량 = DDL · DML 전후 같은 집합 / 되돌리기(C144-RB-1) = 옛 공개 SQL 에 JBN 0
 *   4. 신청 · 같은 id 두 번 · 상태 이동 · 동시 확인 · 연결 비교 · 단계 계산 · 지우기 · 보관 기한 / 신청 쓰기가 회사 · 요금제를 바꾸지 않음
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';

vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => 0) }));

import {
  loadJbnPlans, parseJbnApplication, insertJbnApplication, changeJbnStatus, linkJbnCompany, deleteJbnApplication,
  loadJbnOverview, purgeJbnApplicationPii,
} from '../jbn';
import { PUBLIC_CATALOG_PLAN_SQL } from '../plan-guard';
import { DIAGNOSIS_PLAN_ROWS_SQL } from '../marketing-diagnosis-store';
import { readPlanFreeQuotas } from '../free-messaging';
import { monthCredits, monthKeyOf } from '../ai-credit-month';

/** [코드, 월정액, 월 크레딧, 활성, 상위 등급] — 값 = status/SCHEMA.md plans 절 0728 기록 */
const SEED: Array<[string, number, number, boolean, boolean]> = [
  ['FREE', 0, 0, true, false], ['TRIAL', 0, 750, true, false], ['STAFF', 0, 0, true, true],
  ['STARTER', 150000, 300, true, false], ['BASIC', 350000, 750, true, false], ['PRO', 1000000, 2400, true, true],
  ['OLDPAID', 99000, 100, false, false],
];
const PLAN: Record<string, string> = {};
const ADMIN = { userId: null, label: 'ceo' };
const MONTH = monthKeyOf(new Date());

const publicSql = `SELECT id FROM plans p WHERE p.is_active = true AND ${PUBLIC_CATALOG_PLAN_SQL} ORDER BY p.monthly_price ASC, p.plan_code ASC`;
const ids = async (sql: string) => (await query(sql)).rows.map((r: any) => String(r.id)).sort();
const before: { pub?: string[]; diag?: string[]; quotas?: string[]; plansErr?: string; insertErr?: string } = {};

async function company(name: string, planCode: string): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', { id, company_name: name, plan_id: PLAN[planCode], billing_type: 'prepaid' });
  return id;
}
const input = (over: Record<string, unknown> = {}) => {
  const r = parseJbnApplication({
    id: randomUUID(), companyName: '시험상사', ownerName: '시험', nickname: '시험상사 시험', phone: '010-0000-0144',
    consultMethod: 'phone', memo: '', interestPlanCode: 'BASIC', consent: true, ...over,
  }, ['STARTER', 'BASIC', 'PRO']);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const appRow = async (id: string) => (await query(`SELECT * FROM jbn_applications WHERE id = $1::uuid`, [id])).rows[0];

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C90-DDL-1'));   // 월 크레딧 고정표(운영에는 있음 · 이 사본에는 대기 블록)
  for (const [code, price, credits, active, adv] of SEED) {
    const id = randomUUID();
    PLAN[code] = id;
    await insertMinimalRow(pool, 'plans', {
      id, plan_code: code, plan_name: code, monthly_price: price, ai_credits_per_month: credits, is_active: active,
      advanced_access_enabled: adv, customer_db_enabled: code !== 'FREE', max_customers: 1000, free_sms_qty: code === 'BASIC' ? 300 : 0,
    });
  }
  // 원 요금제(BASIC)의 이번 달 고정값 600 ≠ 지금 값 750
  await query(`INSERT INTO plan_month_credits (month, plan_code, credits) VALUES ($1::date, 'BASIC', 600)`, [`${MONTH}-01`]);
  before.pub = await ids(publicSql);
  before.diag = (await query(DIAGNOSIS_PLAN_ROWS_SQL)).rows.map((r: any) => String(r.id)).sort();
  before.quotas = Object.keys(await readPlanFreeQuotas()).sort();
  before.plansErr = await loadJbnPlans().then(() => 'none', (e: any) => e?.code);
  before.insertErr = await insertJbnApplication(input(), '127.0.0.1').then(() => 'none', (e: any) => e?.code);
});

describe('0. DDL 전', () => {
  it('공개 목록 = 활성 요금제 전부(칸이 없어도 조각이 참) · JBN 요금 = 칸 없음 · 신청 = 표 없음', () => {
    expect(before.pub).toEqual([PLAN.FREE, PLAN.TRIAL, PLAN.STAFF, PLAN.STARTER, PLAN.BASIC, PLAN.PRO].sort());
    expect(before.plansErr).toBe('42703');
    expect(before.insertErr).toBe('42P01');
  });
});

describe('1 · 2. DDL · DML(한 트랜잭션 · 월초 고정과 동시)', () => {
  it('DML 이 커밋하기 전에는 월초 고정이 기다리고 · 커밋 뒤 JBN 고정값 = 원 요금제 고정값 600', async () => {
    await pool.query(ledgerBlockSql('C144-DDL-1'));
    const dml = ledgerBlockSql('C144-DML-1');
    expect(dml.trim().startsWith('BEGIN;')).toBe(true);
    expect(dml.trim().endsWith('COMMIT;')).toBe(true);
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query(dml.trim().replace(/COMMIT;$/, ''));   // 커밋 앞에서 멈춘다
      let done = false;
      const snap = monthCredits(c2, MONTH, 'snapshot').then((m) => { done = true; return m; });
      await new Promise((r) => setTimeout(r, 400));
      expect(done).toBe(false);   // 고정표 잠금에 걸려 기다린다
      await c1.query('COMMIT');
      const m = await snap;
      expect(m.get('JBN_BASIC')).toBe(600);
      expect(m.get('BASIC')).toBe(600);
      expect(m.get('JBN_STARTER')).toBe(300);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('JBN 행 = 활성 유료 공개 요금제마다 한 줄(FREE · TRIAL · STAFF · 비활성 제외) · 월정액 0.7 · 기능 칸 같음', async () => {
    const r = await query(
      `SELECT j.plan_code, j.plan_name, j.monthly_price::float AS price, b.plan_code AS base, j.is_active,
              (to_jsonb(j) - ARRAY['id','plan_code','plan_name','monthly_price','partner_code','base_plan_id','created_at'])
                = (to_jsonb(b) - ARRAY['id','plan_code','plan_name','monthly_price','partner_code','base_plan_id','created_at']) AS same_rest
         FROM plans j JOIN plans b ON b.id = j.base_plan_id WHERE j.partner_code = 'JBN' ORDER BY j.monthly_price`,
    );
    expect(r.rows).toEqual([
      { plan_code: 'JBN_STARTER', plan_name: 'JBN STARTER', price: 105000, base: 'STARTER', is_active: true, same_rest: true },
      { plan_code: 'JBN_BASIC', plan_name: 'JBN BASIC', price: 245000, base: 'BASIC', is_active: true, same_rest: true },
      { plan_code: 'JBN_PRO', plan_name: 'JBN PRO', price: 700000, base: 'PRO', is_active: true, same_rest: true },
    ]);
  });

  it('DML 두 번 = 그대로(행 · 고정값)', async () => {
    await pool.query(ledgerBlockSql('C144-DML-1'));
    expect(Number((await query(`SELECT count(*) FROM plans WHERE partner_code = 'JBN'`)).rows[0].count)).toBe(3);
    expect((await query(`SELECT credits FROM plan_month_credits WHERE plan_code = 'JBN_BASIC'`)).rows).toEqual([{ credits: 600 }]);
  });
});

describe('3. 공개 목록 무변 · 되돌리기', () => {
  it('공개 목록 · 진단 후보 · 무료 수량 = 전후 같은 집합', async () => {
    expect(await ids(publicSql)).toEqual(before.pub);
    expect((await query(DIAGNOSIS_PLAN_ROWS_SQL)).rows.map((r: any) => String(r.id)).sort()).toEqual(before.diag);
    expect(Object.keys(await readPlanFreeQuotas()).sort()).toEqual(before.quotas);
  });
  it('JBN 요금 = 원 이름 · 정가 · 70% · 크레딧 · 가격 순', async () => {
    expect(await loadJbnPlans()).toEqual([
      { code: 'STARTER', name: 'STARTER', basePrice: 150000, price: 105000, credits: 300 },
      { code: 'BASIC', name: 'BASIC', basePrice: 350000, price: 245000, credits: 750 },
      { code: 'PRO', name: 'PRO', basePrice: 1000000, price: 700000, credits: 2400 },
    ]);
  });
  it('C144-RB-1(비활성) 뒤 옛 공개 SQL 에 JBN 0 · 다시 켬', async () => {
    await query(`UPDATE plans SET is_active = false WHERE partner_code = 'JBN'`);
    const old = (await query(`SELECT plan_code FROM plans WHERE is_active = true ORDER BY monthly_price ASC`)).rows.map((r: any) => r.plan_code);
    expect(old.filter((c: string) => c.startsWith('JBN_'))).toEqual([]);
    expect(await loadJbnPlans()).toEqual([]);
    await query(`UPDATE plans SET is_active = true WHERE partner_code = 'JBN'`);
  });
});

describe('4. 신청 · 회원 확인 · 연결 · 단계 · 보관', () => {
  const coA = { id: '' };
  const coB = { id: '' };
  const coOnly = { id: '' };
  const app1 = input();
  const app2 = input({ nickname: '두번째 신청' });
  const app3 = input({ nickname: '세번째 신청' });
  let snapshot = '';

  beforeAll(async () => {
    coA.id = await company('C144 회사 A', 'BASIC');
    coB.id = await company('C144 회사 B', 'FREE');
    coOnly.id = await company('C144 신청 없는 JBN 회사', 'STARTER');
    await query(`UPDATE companies SET plan_id = (SELECT id FROM plans WHERE plan_code = 'JBN_STARTER') WHERE id = $1::uuid`, [coOnly.id]);
    snapshot = JSON.stringify((await query(
      `SELECT c.id, c.plan_id, c.subscription_status FROM companies c WHERE c.id = ANY($1::uuid[]) ORDER BY c.id`, [[coA.id, coB.id, coOnly.id]],
    )).rows) + JSON.stringify((await query(`SELECT id, monthly_price, is_active FROM plans ORDER BY id`)).rows);
  });

  it('같은 id 두 번 = 한 행', async () => {
    expect(await insertJbnApplication(app1, '127.0.0.1')).toBe('created');
    expect(await insertJbnApplication(app1, '127.0.0.1')).toBe('exists');
    await insertJbnApplication(app2, null);
    expect(Number((await query(`SELECT count(*) FROM jbn_applications WHERE id = ANY($1::uuid[])`, [[app1.id, app2.id]])).rows[0].count)).toBe(2);
  });

  it('동시 확인 = 한 쪽만(다른 쪽 409 + 지금 행)', async () => {
    const [a, b] = await Promise.all([
      changeJbnStatus(app1.id, { from: 'pending', to: 'verified' }, ADMIN),
      changeJbnStatus(app1.id, { from: 'pending', to: 'rejected', reason: '없음' }, ADMIN),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    const lost = a.ok ? b : a;
    expect(!lost.ok && lost.status).toBe(409);
    // 시험을 이어 가려고 확인 상태로 맞춘다
    const row = await appRow(app1.id);
    if (row.status === 'rejected') {
      expect((await changeJbnStatus(app1.id, { from: 'rejected', to: 'pending' }, ADMIN)).ok).toBe(true);
      expect((await changeJbnStatus(app1.id, { from: 'pending', to: 'verified' }, ADMIN)).ok).toBe(true);
    }
    expect((await appRow(app1.id)).status).toBe('verified');
    expect((await appRow(app1.id)).status_by_label).toBe('ceo');
  });

  it('허용표 밖 = 400 · 확인 전 신청은 연결 불가 409', async () => {
    expect(await changeJbnStatus(app2.id, { from: 'pending', to: 'pending' }, ADMIN)).toMatchObject({ ok: false, status: 400 });
    expect(await linkJbnCompany(app2.id, { companyId: coA.id, expectedCompanyId: null }, ADMIN)).toMatchObject({ ok: false, status: 409 });
  });

  it('연결 비교 = 직전값이 다르면 409(덮어쓰기 · 오래 열린 화면의 해제 차단) · 없는 회사 400', async () => {
    expect((await linkJbnCompany(app1.id, { companyId: coA.id, expectedCompanyId: null }, ADMIN)).ok).toBe(true);
    expect(await linkJbnCompany(app1.id, { companyId: coB.id, expectedCompanyId: null }, ADMIN)).toMatchObject({ ok: false, status: 409 });
    expect(await linkJbnCompany(app1.id, { companyId: null, expectedCompanyId: null }, ADMIN)).toMatchObject({ ok: false, status: 409 });
    expect(await linkJbnCompany(app1.id, { companyId: randomUUID(), expectedCompanyId: coA.id }, ADMIN)).toMatchObject({ ok: false, status: 400, code: 'COMPANY_NOT_FOUND' });
    expect((await linkJbnCompany(app1.id, { companyId: coB.id, expectedCompanyId: coA.id }, ADMIN)).ok).toBe(true);
    expect((await appRow(app1.id)).company_id).toBe(coB.id);
  });

  it('연결된 신청은 확인을 풀 수 없다(409)', async () => {
    const r = await changeJbnStatus(app1.id, { from: 'verified', to: 'pending' }, ADMIN);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toBe('회사가 연결된 신청입니다. 연결을 먼저 끊어 주세요.');
  });

  it('신청 쓰기는 회사 · 요금제를 바꾸지 않는다', async () => {
    const now = JSON.stringify((await query(
      `SELECT c.id, c.plan_id, c.subscription_status FROM companies c WHERE c.id = ANY($1::uuid[]) ORDER BY c.id`, [[coA.id, coB.id, coOnly.id]],
    )).rows) + JSON.stringify((await query(`SELECT id, monthly_price, is_active FROM plans ORDER BY id`)).rows);
    expect(now).toBe(snapshot);
  });

  it('단계 = 연결 회사가 JBN 판이면 적용 중 · 신청 없는 JBN 회사도 적용 중', async () => {
    let o = await loadJbnOverview({ stage: 'verified', q: '' });
    expect(o.applications.map((a) => a.id)).toContain(app1.id);
    expect(o.counts.on).toBe(1);   // 신청 없는 JBN 회사
    await query(`UPDATE companies SET plan_id = (SELECT id FROM plans WHERE plan_code = 'JBN_BASIC') WHERE id = $1::uuid`, [coB.id]);
    o = await loadJbnOverview({ stage: 'verified', q: '' });
    expect(o.applications.map((a) => a.id)).not.toContain(app1.id);
    // 같은 회사에 신청이 두 건 연결되면 둘 다 보인다(Codex 구현 1R · 옛 판 = 최신 하나만 남아 지우기 · 찾기가 안 됐다)
    expect(await insertJbnApplication(app3, null)).toBe('created');
    expect((await changeJbnStatus(app3.id, { from: 'pending', to: 'verified' }, ADMIN)).ok).toBe(true);
    expect((await linkJbnCompany(app3.id, { companyId: coB.id, expectedCompanyId: null }, ADMIN)).ok).toBe(true);
    o = await loadJbnOverview({ stage: 'on', q: '' });
    expect(o.counts.on).toBe(2);
    // 회사 순서 = DB 정렬 규칙(운영 en_US.utf8) · 시험은 집합으로 본다
    expect(o.companies.map((c) => [c.companyName, c.planName, c.applications.map((a) => a.nickname).join('|')]).sort()).toEqual([
      ['C144 신청 없는 JBN 회사', 'JBN STARTER', ''],
      ['C144 회사 B', 'JBN BASIC', '세번째 신청|시험상사 시험'],
    ].sort());
    expect((await loadJbnOverview({ stage: 'on', q: '시험상사' })).companies.map((c) => c.companyName)).toEqual(['C144 회사 B']);   // 오래된 신청으로도 찾힌다
    expect((await loadJbnOverview({ stage: 'verified', q: '' })).applications.map((a) => a.id)).not.toContain(app3.id);
    expect(o.plans.map((p) => [p.name, p.price, p.basePrice, p.companies])).toEqual([
      ['JBN STARTER', 105000, 150000, 1], ['JBN BASIC', 245000, 350000, 1], ['JBN PRO', 700000, 1000000, 0],
    ]);
    o = await loadJbnOverview({ stage: 'pending', q: '두번째' });
    expect(o.applications.map((a) => a.id)).toEqual([app2.id]);
    expect(o.truncated).toBe(false);
  });

  it('지우기 = 한 번 true · 다시 false', async () => {
    expect(await deleteJbnApplication(app2.id, ADMIN)).toBe(true);
    expect(await deleteJbnApplication(app2.id, ADMIN)).toBe(false);
  });

  it('보관 기한 = 90일 지난 IP 지움 · 1년 지난 행 삭제(감사 기록이 있어도) · 지운 신청의 회사는 적용 중에 그대로', async () => {
    const old90 = input({ nickname: '90일' });
    const old1y = input({ nickname: '1년' });
    await insertJbnApplication(old90, '10.0.0.1');
    await insertJbnApplication(old1y, '10.0.0.2');
    await query(`UPDATE jbn_applications SET created_at = now() - interval '100 days' WHERE id = $1::uuid`, [old90.id]);
    await query(`UPDATE jbn_applications SET created_at = now() - interval '400 days' WHERE id = $1::uuid`, [old1y.id]);
    await query(`UPDATE jbn_applications SET created_at = now() - interval '400 days' WHERE id = $1::uuid`, [app1.id]);   // 회사 B 에 연결된 신청
    await query(`INSERT INTO audit_logs (action, target_type, target_id, details) VALUES ('jbn_status', 'jbn_application', $1::uuid, '{"to":"verified"}')`, [app1.id]);
    const out = await purgeJbnApplicationPii();
    expect(out.deleted).toBeGreaterThanOrEqual(2);
    expect((await appRow(old90.id)).ip_address).toBe(null);
    expect((await appRow(old90.id)).nickname).toBe('90일');
    expect(await appRow(old1y.id)).toBeUndefined();
    expect(await appRow(app1.id)).toBeUndefined();
    const o = await loadJbnOverview({ stage: 'on', q: '' });
    expect(o.companies.find((c) => c.companyName === 'C144 회사 B')?.applications.map((a) => a.nickname)).toEqual(['세번째 신청']);
  });
});
