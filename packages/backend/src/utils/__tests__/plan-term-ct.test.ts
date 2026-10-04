/**
 * 선불 요금제 이용 기간 CT 시나리오 + 소스 계약 (★2026-10-04 · docs/2026-10-04-prepaid-plan-term-design.md)
 *
 * 못 박는 것(돈 경로)
 *   1. 만료 정산: 자동 결제 = 잔액 −1개월(부가세 포함) · 만료일 +1개월 · 잔액 원장 reference_type 'plan_term'
 *      잔액 부족·자동 끔 = 잠금(plan_id ← FREE, 복구 요금제 기억, 사유·잔액·필요액 스냅샷) · 다음 구매 FREE = 미가입으로 종료
 *   2. 1개월 연장: 회차·금액 CAS(어긋나면 409 + 새 견적, 돈 0) · 같은 requestId 재시도 = 첫 결과 재생(두 번 결제 없음)
 *      잠김이면 오늘부터 1개월 + 원래 요금제 복구
 *   3. 신청 승인: 올림 = 차액 즉시 · 부족 = 402(상태 무변화) · 내림 = 예약만 · DDL 전 = 미처리
 *   4. 정렬: 미리 산 다른 요금제 구간이 시작되면 plan_id 교체 · CT 밖에서 바뀐 plan_id는 손대지 않는다
 *   5. 복구 시 AI 크레딧: 잠긴 동안 월 리셋이 돌았을 때만 보충
 *   6. 소스 계약: plan_term 칸·원장·요금제 이용료 차감은 CT 파일만 쓴다 · CT에 CURRENT_DATE 0 · plan_id 쓰기 파일 허용 목록
 *
 * ⚠ 가짜 DB는 CT가 실제로 보내는 SQL만 해석한다. 모르는 SQL이면 던진다(관대한 mock 금지).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

interface Plan { id: string; plan_code: string; plan_name: string; monthly_price: number; ai_credits_per_month: number }
const PLANS: Record<string, Plan> = {
  FREE: { id: '00000000-0000-0000-0000-00000000f0ee', plan_code: 'FREE', plan_name: '미가입', monthly_price: 0, ai_credits_per_month: 0 },
  BASIC: { id: '00000000-0000-0000-0000-0000000ba51c', plan_code: 'BASIC', plan_name: '베이직', monthly_price: 350000, ai_credits_per_month: 750 },
  PRO: { id: '00000000-0000-0000-0000-000000000960', plan_code: 'PRO', plan_name: '프로', monthly_price: 1000000, ai_credits_per_month: 2400 },
  STD: { id: '00000000-0000-0000-0000-000000000570', plan_code: 'STD', plan_name: '스탠다드', monthly_price: 600000, ai_credits_per_month: 1200 },
};
const byId = (id: string | null) => Object.values(PLANS).find((p) => p.id === id) || null;
const CID = '11111111-1111-1111-1111-111111111111';

const db = {
  ready: true,
  co: {} as any,
  events: [] as any[],
  balanceTx: [] as any[],
  planChanges: [] as any[],
  creditTx: [] as any[],
  alerts: [] as string[],
};

function resetDb(over: Partial<any> = {}) {
  db.ready = true;
  db.co = {
    id: CID, company_name: '테스트사', status: 'active', billing_type: 'prepaid', balance: 1000000,
    plan_id: PLANS.PRO.id, subscription_status: 'paid', trial_expires_at: null,
    plan_term_expires_on: '2026-11-03', plan_term_auto_renew: true, plan_term_restore_plan_id: null,
    plan_term_next_plan_id: null, plan_term_version: 1, ai_base: 500, ai_purchased: 0, ...over,
  };
  db.events = [];
  db.balanceTx = [];
  db.planChanges = [{ to_plan_id: db.co.plan_id, to_plan_code: byId(db.co.plan_id)?.plan_code, to_monthly_price: byId(db.co.plan_id)?.monthly_price }];
  db.creditTx = [];
  db.alerts = [];
}

function addEvent(e: any) {
  db.events.push({ id: `e${db.events.length + 1}`, created_at: '2026-10-04T00:00:00.000Z', detail: null, monthly_price: null, covers_from: null, covers_to: null, ...e });
}

function exec(sql: string, p: any[] = []): any {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [] };
  if (s.startsWith('SELECT c.id, c.company_name')) {
    const c = db.co;
    return { rows: [{
      id: c.id, company_name: c.company_name, status: c.status, billing_type: c.billing_type, balance: c.balance,
      plan_id: c.plan_id, plan_price: byId(c.plan_id)?.monthly_price ?? 0, ready: db.ready,
      expires_on: db.ready ? c.plan_term_expires_on : null, auto_renew: c.plan_term_auto_renew,
      restore_plan_id: db.ready ? c.plan_term_restore_plan_id : null, next_plan_id: db.ready ? c.plan_term_next_plan_id : null,
      version: db.ready ? c.plan_term_version : 0, ai_base: c.ai_base, ai_purchased: c.ai_purchased,
    }] };
  }
  if (s.startsWith('SELECT c.id FROM companies c WHERE')) {
    return { rows: db.ready && db.co.plan_term_expires_on && !db.co.plan_term_restore_plan_id ? [{ id: CID }] : [] };
  }
  if (s.startsWith('SELECT id, term_version, event_type, plan_id, monthly_price')) {
    return { rows: [...db.events].sort((a, b) => a.term_version - b.term_version) };
  }
  if (s.startsWith('SELECT id, plan_code, plan_name')) {
    const pl = byId(p[0]);
    return { rows: pl ? [pl] : [] };
  }
  if (s.startsWith("SELECT id FROM plans WHERE plan_code = 'FREE'")) return { rows: [{ id: PLANS.FREE.id }] };
  if (s.startsWith('UPDATE companies SET plan_term_version = plan_term_version + 1')) {
    if (p[1] !== db.co.plan_term_version) return { rows: [] };
    const setPart = s.slice(s.indexOf(' SET ') + 5, s.indexOf(' WHERE '));
    for (const m of setPart.matchAll(/(\w+) = \$(\d+)/g)) db.co[m[1]] = p[Number(m[2]) - 1];
    if (setPart.includes("subscription_status = 'paid'")) db.co.subscription_status = 'paid';
    if (setPart.includes('trial_expires_at = NULL')) db.co.trial_expires_at = null;
    db.co.plan_term_version += 1;
    return { rows: [{ plan_term_version: db.co.plan_term_version }] };
  }
  if (s.startsWith('UPDATE companies SET balance = balance - $1')) {
    if (db.co.balance < p[0]) return { rows: [] };
    db.co.balance = Math.round((db.co.balance - p[0]) * 100) / 100;
    return { rows: [{ balance: db.co.balance }] };
  }
  if (s.startsWith('INSERT INTO balance_transactions')) {
    db.balanceTx.push({ company_id: p[0], type: 'deduct', amount: p[1], balance_before: p[2], balance_after: p[3], description: p[4], reference_type: p[5], reference_id: p[6], created_by: p[7] });
    return { rows: [{ id: `bt${db.balanceTx.length}` }] };
  }
  if (s.startsWith('INSERT INTO company_plan_term_events')) {
    if (db.events.some((e) => e.term_version === p[2])) throw Object.assign(new Error('dup version'), { code: '23505' });
    if (p[20] && db.events.some((e) => e.request_id === p[20])) throw Object.assign(new Error('dup request'), { code: '23505' });
    db.events.push({
      id: p[0], term_version: p[2], event_type: p[3], plan_id: p[4], plan_code: p[5], monthly_price: p[6],
      covers_from: p[7], covers_to: p[8], supply_amount: p[9], vat_amount: p[10], total_amount: p[11],
      balance_before: p[12], balance_after: p[13], balance_tx_id: p[14], expires_before: p[15], expires_after: p[16],
      actor_type: p[17], request_id: p[20], detail: p[24] ? JSON.parse(p[24]) : null, created_at: '2026-11-04T00:00:00.000Z',
    });
    return { rows: [] };
  }
  if (s.startsWith('SELECT event_type, to_char(expires_after')) {
    const e = db.events.find((x) => x.request_id === p[1]);
    return { rows: e ? [{ event_type: e.event_type, expires_after: e.expires_after, balance_after: e.balance_after, total_amount: e.total_amount }] : [] };
  }
  // recordPlanChange
  if (s.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
  if (s.startsWith('SELECT plan_code, monthly_price FROM plans')) {
    const pl = byId(p[0]);
    return { rows: pl ? [{ plan_code: pl.plan_code, monthly_price: pl.monthly_price }] : [] };
  }
  if (s.startsWith('SELECT to_plan_id, to_plan_code, to_monthly_price FROM company_plan_changes')) {
    return { rows: db.planChanges.length ? [db.planChanges[db.planChanges.length - 1]] : [] };
  }
  if (s.startsWith('SELECT EXISTS(SELECT 1 FROM users')) return { rows: [{ in_users: true, super_login: null }] };
  if (s.startsWith('INSERT INTO company_plan_changes')) {
    db.planChanges.push({ to_plan_id: p[2], to_plan_code: p[4], to_monthly_price: p[6], change_type: p[8], effective_date: p[7] });
    return { rows: [] };
  }
  // AI 크레딧 보충
  if (s.startsWith('SELECT 1 FROM ai_credit_transactions')) {
    return { rows: db.creditTx.some((t) => t.source === 'monthly-reset' && t.created_at >= p[1]) ? [{ '?column?': 1 }] : [] };
  }
  if (s.startsWith('INSERT INTO ai_credit_transactions')) {
    if (db.creditTx.some((t) => t.key === p[2])) return { rows: [], rowCount: 0 };
    db.creditTx.push({ source: 'plan-term-restore', key: p[2], amount: p[1], base_after: p[3] });
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('UPDATE companies SET ai_credits_base_remaining')) { db.co.ai_base = p[1]; return { rows: [] }; }
  throw new Error(`가짜 DB가 모르는 SQL: ${s.slice(0, 120)}`);
}

const client = { query: vi.fn(async (sql: string, p?: any[]) => exec(sql, p)), release: vi.fn() };
vi.mock('../../config/database', () => ({
  default: { connect: async () => client, query: async (sql: string, p?: any[]) => exec(sql, p) },
  pool: { connect: async () => client, query: async (sql: string, p?: any[]) => exec(sql, p) },
  query: async (sql: string, p?: any[]) => exec(sql, p),
}));
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async (a: any) => { db.alerts.push(a.message); return 0; }) }));

import { getPlanTermQuote, extendPlanTerm, applyPlanRequestWithClient, runPlanTermPass, setPlanTermAutoRenew } from '../plan-term';

const ADMIN = { type: 'company_user' as const, id: '22222222-2222-2222-2222-222222222222', label: '김관리' };
const SUPER = { type: 'super_admin' as const, id: '33333333-3333-3333-3333-333333333333', label: '대표' };
const REQ1 = '44444444-4444-4444-4444-444444444444';
const REQ2 = '55555555-5555-5555-5555-555555555555';

beforeEach(() => resetDb());

describe('만료 정산(워커)', () => {
  it('자동 켬 + 잔액 충분 = 1개월 결제(부가세 포함) · 만료일 다음 1개월 · 잔액 원장 plan_term', async () => {
    resetDb({ balance: 2000000 });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    await runPlanTermPass('2026-11-04');
    expect(db.co.balance).toBe(900000);
    expect(db.co.plan_term_expires_on).toBe('2026-12-03');
    const ev = db.events.find((e) => e.event_type === 'renew');
    expect(ev).toMatchObject({ covers_from: '2026-11-04', covers_to: '2026-12-03', total_amount: 1100000, supply_amount: 1000000, vat_amount: 100000 });
    expect(db.balanceTx).toHaveLength(1);
    expect(db.balanceTx[0]).toMatchObject({ amount: 1100000, reference_type: 'plan_term', reference_id: ev.id, created_by: null });
    expect(db.co.plan_id).toBe(PLANS.PRO.id);
  });
  it('잔액 부족 = 잠금: plan_id FREE · 복구 요금제 · 스냅샷 · 이력 · 발송 상태(subscription_status) 그대로', async () => {
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    await runPlanTermPass('2026-11-04');
    expect(db.co.balance).toBe(1000000);
    expect(db.co.plan_id).toBe(PLANS.FREE.id);
    expect(db.co.plan_term_restore_plan_id).toBe(PLANS.PRO.id);
    expect(db.co.subscription_status).toBe('paid');
    const ev = db.events.find((e) => e.event_type === 'block');
    expect(ev.detail).toMatchObject({ reason: 'insufficient', balance: 1000000, required: 1100000 });
    expect(db.planChanges[db.planChanges.length - 1].to_plan_code).toBe('FREE');
    expect(db.balanceTx).toHaveLength(0);
  });
  it('잠긴 회사는 다시 시도하지 않는다(충전해도)', async () => {
    resetDb({ plan_id: PLANS.FREE.id, plan_term_restore_plan_id: PLANS.PRO.id, balance: 9000000 });
    await runPlanTermPass('2026-11-05');
    expect(db.co.balance).toBe(9000000);
    expect(db.events).toHaveLength(0);
  });
  it('자동 끔 = 잠금(auto_off)', async () => {
    resetDb({ balance: 9000000, plan_term_auto_renew: false });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    await runPlanTermPass('2026-11-04');
    expect(db.events.find((e) => e.event_type === 'block').detail.reason).toBe('auto_off');
    expect(db.co.balance).toBe(9000000);
  });
  it('다음 구매가 FREE(내림 예약)면 잔액·스위치와 무관하게 미가입으로 끝낸다 — 0원 연장 반복 금지', async () => {
    resetDb({ balance: 9000000, plan_term_next_plan_id: PLANS.FREE.id });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    await runPlanTermPass('2026-11-04');
    expect(db.co.plan_id).toBe(PLANS.FREE.id);
    expect(db.co.plan_term_expires_on).toBeNull();
    expect(db.co.plan_term_restore_plan_id).toBeNull();
    expect(db.balanceTx).toHaveLength(0);
    expect(db.events.map((e) => e.event_type)).toContain('expire_free');
  });
  it('내림 예약 뒤 자동 결제 = 예약 요금제 가격 · 그날 plan_id 정렬', async () => {
    resetDb({ balance: 9000000, plan_term_next_plan_id: PLANS.BASIC.id });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    await runPlanTermPass('2026-11-04');
    expect(db.balanceTx[0].amount).toBe(385000);
    expect(db.co.plan_id).toBe(PLANS.BASIC.id);
    expect(db.co.plan_term_next_plan_id).toBeNull();
    expect(db.events.map((e) => e.event_type)).toEqual(['start', 'renew', 'align']);
  });
});

describe('1개월 연장(고객 관리자)', () => {
  beforeEach(() => {
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    db.co.balance = 5000000;
  });
  it('견적 = 만료일 다음 날부터 1개월 · 남은 기간 보존', async () => {
    const q = await getPlanTermQuote(CID, '2026-10-10');
    expect(q).toMatchObject({ starts_on: '2026-11-04', new_expires: '2026-12-03', total: 1100000, days_left: 25, restoring: false, version: 1 });
  });
  it('회차·금액이 맞으면 결제 · 같은 requestId 재시도는 재생(두 번 결제 없음)', async () => {
    const r1 = await extendPlanTerm(CID, { requestId: REQ1, version: 1, total: 1100000 }, ADMIN, '2026-10-10');
    expect(r1).toMatchObject({ replayed: false, expires_on: '2026-12-03' });
    expect(db.co.balance).toBe(3900000);
    const r2 = await extendPlanTerm(CID, { requestId: REQ1, version: 1, total: 1100000 }, ADMIN, '2026-10-10');
    expect(r2).toMatchObject({ replayed: true, expires_on: '2026-12-03' });
    expect(db.co.balance).toBe(3900000);
    expect(db.balanceTx).toHaveLength(1);
    expect(db.balanceTx[0].created_by).toBe(ADMIN.id);
  });
  it('회차가 어긋나면 409 + 새 견적 · 돈 0', async () => {
    const r = await extendPlanTerm(CID, { requestId: REQ1, version: 0, total: 1100000 }, ADMIN, '2026-10-10');
    expect('conflict' in r && r.conflict.status).toBe(409);
    expect('conflict' in r && r.conflict.body.code).toBe('QUOTE_CHANGED');
    expect(db.balanceTx).toHaveLength(0);
  });
  it('금액이 어긋나면(정가 변경) 409', async () => {
    const r = await extendPlanTerm(CID, { requestId: REQ1, version: 1, total: 1000000 }, ADMIN, '2026-10-10');
    expect('conflict' in r && r.conflict.body.code).toBe('QUOTE_CHANGED');
  });
  it('연타(다른 requestId·같은 회차) = 두 번째는 409', async () => {
    await extendPlanTerm(CID, { requestId: REQ1, version: 1, total: 1100000 }, ADMIN, '2026-10-10');
    const r = await extendPlanTerm(CID, { requestId: REQ2, version: 1, total: 1100000 }, ADMIN, '2026-10-10');
    expect('conflict' in r).toBe(true);
    expect(db.balanceTx).toHaveLength(1);
  });
  it('잔액 부족 = 402(상태 무변화)', async () => {
    db.co.balance = 100;
    await expect(extendPlanTerm(CID, { requestId: REQ1, version: 1, total: 1100000 }, ADMIN, '2026-10-10')).rejects.toMatchObject({ status: 402 });
  });
  it('내림 예약이 FREE면 409 NEXT_PLAN_FREE', async () => {
    db.co.plan_term_next_plan_id = PLANS.FREE.id;
    const q = await getPlanTermQuote(CID, '2026-10-10');
    const r = await extendPlanTerm(CID, { requestId: REQ1, version: q.version, total: q.total }, ADMIN, '2026-10-10');
    expect('conflict' in r && r.conflict.body.code).toBe('NEXT_PLAN_FREE');
    expect(db.balanceTx).toHaveLength(0);
  });
});

describe('잠김 → 1개월 연장 = 다시 열기', () => {
  it('오늘부터 1개월 · 원래 요금제 복구 · 잠긴 동안 월 리셋이 돌았으면 AI 크레딧 보충', async () => {
    resetDb({ plan_id: PLANS.FREE.id, plan_term_restore_plan_id: PLANS.PRO.id, balance: 5000000, ai_base: -30 });
    addEvent({ term_version: 1, event_type: 'block', plan_id: PLANS.PRO.id, created_at: '2026-11-04T00:00:00.000Z', detail: { reason: 'insufficient' } });
    db.creditTx.push({ source: 'monthly-reset', created_at: '2026-12-01T00:00:00.000Z' });
    const q = await getPlanTermQuote(CID, '2026-12-10');
    expect(q).toMatchObject({ restoring: true, starts_on: '2026-12-10', new_expires: '2027-01-09' });
    const r = await extendPlanTerm(CID, { requestId: REQ1, version: q.version, total: q.total }, ADMIN, '2026-12-10');
    expect(r).toMatchObject({ restored: true, expires_on: '2027-01-09' });
    expect(db.co.plan_id).toBe(PLANS.PRO.id);
    expect(db.co.plan_term_restore_plan_id).toBeNull();
    expect(db.co.ai_base).toBe(2400 - 30);
    expect(db.creditTx.filter((t) => t.source === 'plan-term-restore')).toHaveLength(1);
  });
  it('잠긴 동안 리셋이 안 돌았으면 크레딧은 손대지 않는다', async () => {
    resetDb({ plan_id: PLANS.FREE.id, plan_term_restore_plan_id: PLANS.PRO.id, balance: 5000000, ai_base: 300 });
    addEvent({ term_version: 1, event_type: 'block', plan_id: PLANS.PRO.id, created_at: '2026-11-04T00:00:00.000Z' });
    const q = await getPlanTermQuote(CID, '2026-11-10');
    await extendPlanTerm(CID, { requestId: REQ1, version: q.version, total: q.total }, ADMIN, '2026-11-10');
    expect(db.co.ai_base).toBe(300);
  });
});

describe('요금제 신청 승인', () => {
  beforeEach(() => {
    resetDb({ plan_id: PLANS.BASIC.id, balance: 9000000, plan_term_expires_on: '2026-12-03' });
    addEvent({ term_version: 1, event_type: 'renew', plan_id: PLANS.BASIC.id, monthly_price: 350000, covers_from: '2026-11-04', covers_to: '2026-12-03' });
  });
  it('올림 = 남은 기간 차액 즉시 · 만료일 그대로 · 요금제 교체', async () => {
    const out = await applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.PRO.id, trialRequest: false, actor: SUPER }, '2026-11-19');
    expect(out).toMatchObject({ handled: true, outcome: 'upgrade', charged: 357500 }); // 650,000 × 15/30 = 325,000 + 부가세
    expect(db.co.plan_id).toBe(PLANS.PRO.id);
    expect(db.co.plan_term_expires_on).toBe('2026-12-03');
    expect(db.balanceTx[0]).toMatchObject({ amount: 357500, reference_type: 'plan_term', created_by: null });
  });
  it('올림 잔액 부족 = 402 · 돈·요금제 무변화', async () => {
    db.co.balance = 1000;
    await expect(applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.PRO.id, trialRequest: false, actor: SUPER }, '2026-11-19'))
      .rejects.toMatchObject({ status: 402 });
    expect(db.co.plan_id).toBe(PLANS.BASIC.id);
    expect(db.balanceTx).toHaveLength(0);
  });
  it('내림 = 예약만(돈·요금제 무변화)', async () => {
    db.co.plan_id = PLANS.PRO.id;
    db.events[0].plan_id = PLANS.PRO.id;
    db.events[0].monthly_price = 1000000;
    const out = await applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.BASIC.id, trialRequest: false, actor: SUPER }, '2026-11-19');
    expect(out).toMatchObject({ handled: true, outcome: 'reserve' });
    expect(db.co.plan_term_next_plan_id).toBe(PLANS.BASIC.id);
    expect(db.co.plan_id).toBe(PLANS.PRO.id);
    expect(db.balanceTx).toHaveLength(0);
  });
  it('관리 중 체험 신청 = 409', async () => {
    await expect(applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.PRO.id, trialRequest: true, actor: SUPER }, '2026-11-19'))
      .rejects.toMatchObject({ status: 409 });
  });
  it('DDL 전 = 미처리(기존 경로)', async () => {
    db.ready = false;
    const out = await applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.PRO.id, trialRequest: false, actor: SUPER }, '2026-11-19');
    expect(out).toEqual({ handled: false });
    expect(db.balanceTx).toHaveLength(0);
  });
  it('후불 = 미처리', async () => {
    db.co.billing_type = 'postpaid';
    expect(await applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.PRO.id, trialRequest: false, actor: SUPER }, '2026-11-19'))
      .toEqual({ handled: false });
  });
  it('미관리 선불 + 유료 = 첫 1개월 결제로 시작', async () => {
    resetDb({ plan_id: PLANS.FREE.id, plan_term_expires_on: null, plan_term_version: 0, balance: 9000000, subscription_status: 'trial_expired', trial_expires_at: '2026-09-01' });
    const out = await applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.BASIC.id, trialRequest: false, actor: SUPER }, '2026-10-04');
    expect(out).toMatchObject({ handled: true, outcome: 'first_charge', charged: 385000 });
    expect(db.co).toMatchObject({ plan_id: PLANS.BASIC.id, plan_term_expires_on: '2026-11-03', subscription_status: 'paid', trial_expires_at: null, plan_term_auto_renew: true });
  });
});

describe('적대 검토 정정(2026-10-04)', () => {
  it('경계일 승인: 진입 정렬로 바뀐 요금제의 정가로 판정한다(옛 가격이면 올림이 예약으로 뒤집힌다)', async () => {
    resetDb({ plan_term_expires_on: '2026-12-03', plan_term_version: 2, balance: 9000000 });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    addEvent({ term_version: 2, event_type: 'extend', plan_id: PLANS.BASIC.id, monthly_price: 350000, covers_from: '2026-11-04', covers_to: '2026-12-03' });
    const out = await applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.STD.id, trialRequest: false, actor: SUPER }, '2026-11-04');
    expect(out).toMatchObject({ handled: true, outcome: 'upgrade', charged: 275000 }); // (600,000 − 350,000) × 30/30 + 부가세
    expect(db.co.plan_id).toBe(PLANS.STD.id);
  });
  it('정산이 멈춘 회사(해지)는 견적·연장을 막는다(지난 날짜 구간을 사지 않는다)', async () => {
    resetDb({ status: 'terminated', balance: 9000000 });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    await expect(getPlanTermQuote(CID, '2026-11-05')).rejects.toMatchObject({ status: 409, body: { code: 'SETTLE_PENDING' } });
    await expect(applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.PRO.id, trialRequest: false, actor: SUPER }, '2026-11-05'))
      .rejects.toMatchObject({ status: 409 });
    expect(db.balanceTx).toHaveLength(0);
  });
});

describe('Codex 1R 정정', () => {
  it('[high] 올림이 미리 산 더 비싼 구간을 보존한다(차액도 그 구간을 빼고 받는다)', async () => {
    // 오늘 BASIC(35만) · 미리 산 다음 달 PRO(100만) · STD(60만)로 올림 → BASIC 구간만 STD, PRO 구간 그대로
    resetDb({ plan_id: PLANS.BASIC.id, plan_term_expires_on: '2027-01-03', plan_term_version: 2, balance: 9000000 });
    addEvent({ term_version: 1, event_type: 'renew', plan_id: PLANS.BASIC.id, monthly_price: 350000, covers_from: '2026-11-04', covers_to: '2026-12-03' });
    addEvent({ term_version: 2, event_type: 'extend', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-12-04', covers_to: '2027-01-03' });
    const out = await applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.STD.id, trialRequest: false, actor: SUPER }, '2026-11-04');
    expect(out).toMatchObject({ handled: true, outcome: 'upgrade', charged: 275000 }); // (60만 − 35만) × 30/30 + 부가세
    const up = db.events.filter((e) => e.event_type === 'upgrade');
    expect(up.map((e) => [e.covers_from, e.covers_to])).toEqual([['2026-11-04', '2026-12-03']]);
    expect(db.co.plan_id).toBe(PLANS.STD.id);
  });
  it('[high] 관리 종료 뒤 다시 시작하면 지난 기간 원장의 요금제로 결제하지 않는다', async () => {
    resetDb({ plan_id: PLANS.BASIC.id, plan_term_expires_on: '2026-10-09', plan_term_version: 3, balance: 9000000 });
    addEvent({ term_version: 1, event_type: 'renew', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    addEvent({ term_version: 2, event_type: 'end', plan_id: null });
    addEvent({ term_version: 3, event_type: 'start', plan_id: PLANS.BASIC.id, monthly_price: 350000 }); // covers 없음(만료일 = 어제)
    await runPlanTermPass('2026-10-10');
    expect(db.balanceTx[0]).toMatchObject({ amount: 385000 }); // BASIC 1개월 + 부가세 (PRO 1,100,000 아님)
    expect(db.co.plan_id).toBe(PLANS.BASIC.id);
  });
  it('[medium] 동시에 부른 패스는 하나를 함께 기다린다(지급 워커가 정렬 뒤에 지급)', async () => {
    const a = runPlanTermPass('2026-10-10');
    const b = runPlanTermPass('2026-10-10');
    expect(a).toBe(b);
    await a;
  });
  it('[medium] 무료 메시징 지급 워커는 이용 기간 패스를 먼저 기다린다(소스 순서)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'free-messaging-grant-worker.ts'), 'utf8');
    const pass = src.indexOf('await runPlanTermPass()');
    const grant = src.indexOf('await grantFreeMessagingForCurrentMonth(exclude)');
    expect(pass).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(0);
    expect(pass).toBeLessThan(grant);
  });
});

describe('Codex 2R 정정', () => {
  it('[high] 미래 구간만 올린 뒤 그 구간이 시작되면 정렬된다(올림 행이 가드를 막지 않는다)', async () => {
    // A 정가 5만원(구매 당시 10만원) · 미래 C 4만원 구매 · B 8만원 신청 → 오늘 A 보존, 미래 C 구간만 B
    PLANS.A = { id: '00000000-0000-0000-0000-00000000000a', plan_code: 'A', plan_name: '에이', monthly_price: 50000, ai_credits_per_month: 0 };
    PLANS.B = { id: '00000000-0000-0000-0000-00000000000b', plan_code: 'B', plan_name: '비', monthly_price: 80000, ai_credits_per_month: 0 };
    PLANS.C = { id: '00000000-0000-0000-0000-00000000000c', plan_code: 'C', plan_name: '씨', monthly_price: 40000, ai_credits_per_month: 0 };
    resetDb({ plan_id: PLANS.A.id, plan_term_expires_on: '2027-01-03', plan_term_version: 3, balance: 9000000 });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.A.id, monthly_price: 100000, covers_from: '2026-11-01', covers_to: '2026-11-03' });
    addEvent({ term_version: 2, event_type: 'renew', plan_id: PLANS.A.id, monthly_price: 100000, covers_from: '2026-11-04', covers_to: '2026-12-03' });
    addEvent({ term_version: 3, event_type: 'extend', plan_id: PLANS.C.id, monthly_price: 40000, covers_from: '2026-12-04', covers_to: '2027-01-03' });
    const out = await applyPlanRequestWithClient(client as any, { companyId: CID, targetPlanId: PLANS.B.id, trialRequest: false, actor: SUPER }, '2026-11-10');
    expect(out).toMatchObject({ handled: true, outcome: 'upgrade' });
    expect(db.co.plan_id).toBe(PLANS.A.id);
    expect(db.events[db.events.length - 1].detail).toEqual({ sets_plan: false });
    await runPlanTermPass('2026-12-04');
    expect(db.co.plan_id).toBe(PLANS.B.id);
    expect(db.alerts.some((a) => a.includes('원장과 다릅니다'))).toBe(false);
    delete (PLANS as any).A; delete (PLANS as any).B; delete (PLANS as any).C;
  });
  it('[medium] 다른 기준일 패스는 앞 패스를 기다린 뒤 따로 돈다 · 같은 날은 하나를 함께 기다린다', async () => {
    const a = runPlanTermPass('2026-10-10');
    const b = runPlanTermPass('2026-10-11');
    const c = runPlanTermPass('2026-10-11');
    expect(a).not.toBe(b);
    expect(b).toBe(c);
    await Promise.all([a, b]);
  });
  it('[medium] 정산 실패 회사는 결과의 failed 로 돌려준다(지급 제외 근거)', async () => {
    resetDb({ balance: 9000000, status: 'active' });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    const orig = client.query.getMockImplementation();
    client.query.mockImplementation(async (sql: string, p?: any[]) => {
      if (String(sql).includes('UPDATE companies SET balance = balance - $1')) throw new Error('일시 장애');
      return exec(sql, p);
    });
    const r = await runPlanTermPass('2026-11-04');
    client.query.mockImplementation(orig!);
    expect(r.failed).toEqual([CID]);
  });
});

describe('정렬 가드', () => {
  it('미리 산 다른 요금제 구간이 시작되면 교체', async () => {
    resetDb({ plan_term_expires_on: '2026-12-03', plan_term_version: 2 });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    addEvent({ term_version: 2, event_type: 'extend', plan_id: PLANS.BASIC.id, monthly_price: 350000, covers_from: '2026-11-04', covers_to: '2026-12-03' });
    await runPlanTermPass('2026-11-04');
    expect(db.co.plan_id).toBe(PLANS.BASIC.id);
    expect(db.events[db.events.length - 1].event_type).toBe('align');
  });
  it('CT 밖에서 바뀐 plan_id는 손대지 않고 알린다', async () => {
    resetDb({ plan_term_expires_on: '2026-12-03', plan_term_version: 2, plan_id: PLANS.FREE.id });
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    addEvent({ term_version: 2, event_type: 'extend', plan_id: PLANS.BASIC.id, monthly_price: 350000, covers_from: '2026-11-04', covers_to: '2026-12-03' });
    await runPlanTermPass('2026-11-04');
    expect(db.co.plan_id).toBe(PLANS.FREE.id);
    expect(db.alerts.some((a) => a.includes('원장과 다릅니다'))).toBe(true);
  });
});

describe('자동 연장 스위치', () => {
  it('같은 값이면 무변화 · 바꾸면 회차 +1 · 이벤트', async () => {
    addEvent({ term_version: 1, event_type: 'start', plan_id: PLANS.PRO.id, monthly_price: 1000000, covers_from: '2026-10-04', covers_to: '2026-11-03' });
    expect(await setPlanTermAutoRenew(CID, true, ADMIN, '2026-10-10')).toMatchObject({ changed: false });
    expect(await setPlanTermAutoRenew(CID, false, ADMIN, '2026-10-10')).toMatchObject({ changed: true, auto_renew: false, version: 2 });
    expect(db.events[db.events.length - 1].event_type).toBe('auto_off');
  });
});

// ════════════════════════════════════════════════════════════
// 소스 계약
// ════════════════════════════════════════════════════════════
const SRC = path.resolve(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'node_modules') walk(p, out); }
    else if (n.endsWith('.ts') && !n.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const files = walk(SRC).map((f) => ({ rel: path.relative(SRC, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') }));

describe('소스 계약', () => {
  it('plan_term 칸 쓰기·원장 INSERT·요금제 이용료 차감은 CT 파일만', () => {
    const writers = files.filter((f) =>
      /plan_term_(expires_on|auto_renew|restore_plan_id|next_plan_id|version)\s*=\s*[$?']/.test(f.text)
      || /INSERT INTO company_plan_term_events/.test(f.text)
      || /PLAN_TERM_REFERENCE_TYPE|'plan_term'\s*,\s*\$/.test(f.text.replace(/IS DISTINCT FROM 'plan_term'/g, '')),
    ).map((f) => f.rel);
    expect(writers).toEqual(['utils/plan-term.ts']);
  });
  it('CT는 DB의 오늘(UTC)을 쓰지 않는다', () => {
    const ct = files.find((f) => f.rel === 'utils/plan-term.ts')!.text;
    expect(ct).not.toMatch(/CURRENT_DATE|now\(\)::date|NOW\(\)::date/);
  });
  it('plan_id를 쓰는 파일 = 허용 목록(새 쓰기 경로는 선불 이용 기간 게이트를 검토해야 한다)', () => {
    const re = /SET\s+plan_id\s*=|plan_id\s*=\s*COALESCE\(\$\d+,\s*plan_id\)|plan_id = \?::uuid/;
    const writers = files.filter((f) => re.test(f.text)).map((f) => f.rel).sort();
    expect(writers).toEqual([
      'routes/admin.ts', 'routes/companies.ts', 'utils/basic-trial.ts', 'utils/plan-term.ts', 'utils/trial-downgrade-worker.ts',
    ].sort());
  });
});
