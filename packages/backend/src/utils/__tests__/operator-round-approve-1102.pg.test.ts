// replaces: none
/**
 * 자동마케팅 회차 · 승인 시각 · 상한 갈래 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-1 · 3-2 · §7)
 *
 * 운영 문장을 글자 그대로 돌린다(회차 키 · 회차 잠금 · 교체 · 승인 선점 · 예약 · 발송 패스 · 발송 직전 상한 · 예산).
 * 발송 = 시연 회사(대상 계산 · 문안 · 상한 · 예산까지 진짜로 돌고 캠페인 · 큐 · 크레딧 앞에서 「보냄(시연)」으로 마감) · 바깥(담당자 문자 · 운영 경보 · 발송 창 시각)만 시험이 쥔다.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({ hours: { start: 0, end: 24 } }));
vi.mock('../../config/defaults', async (orig) => ({ ...(await orig() as any), SEND_HOURS: ctl.hours }));
vi.mock('../sms-queue', async (orig) => ({ ...(await orig() as any), getAuthSmsTable: async () => 'SMSQ_TEST', bulkInsertSmsQueue: async (_t: string[], rows: any[][]) => rows.length }));
vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  return { ...real, withBoundedMysql: async (_ms: number, work: any) => work(async () => []) };
});
vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1, alertPassFailures: async () => undefined }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { roundKeyOf, roundState, withRoundLock, replaceRoundCas } from '../operator-round';
import { approveProposal, generateProposalForOperator, runAutoSendPass } from '../continuous-operator';
import { normalizeSegmentParams } from '../automarketing-segment';

const N_CUSTOMERS = 5;
const CAP = 2;
const kstHour = () => new Date(Date.now() + 9 * 3600_000).getUTCHours();
const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

interface Op { co: string; owner: string; op: string; scheduleTime: string }
async function setup(o: { budgetMonthly?: number | null; approved?: boolean } = {}): Promise<Op> {
  const co = randomUUID(); const owner = randomUUID(); const op = randomUUID();
  await insertMinimalRow(pool, 'companies', {
    id: co, company_name: '회차 승인 시험', is_demo: true,
    cdp_auto_execute_max_recipients: CAP, cdp_auto_execute_max_cost_krw: 1_000_000, cost_per_sms: 20, cost_per_lms: 50,
  });
  await insertMinimalRow(pool, 'users', { id: owner, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: `t-1102-round-${co.slice(0, 8)}` });
  for (let i = 0; i < N_CUSTOMERS; i++) {
    await insertMinimalRow(pool, 'customers', { id: randomUUID(), company_id: co, phone: `0100000${co.slice(0, 2).replace(/\D/g, '0')}${String(i).padStart(2, '0')}`.slice(0, 11), is_active: true, sms_opt_in: true });
  }
  const scheduleTime = hh(kstHour() + 5);
  await insertMinimalRow(pool, 'continuous_operators', {
    id: op, company_id: co, name: '주간 안내', status: 'active', created_by: owner, schedule: 'daily', schedule_time: scheduleTime,
    segment_key: 'all', callback_number: '0212345678', budget_monthly: o.budgetMonthly ?? null, auto_send_lead_minutes: 120,
  });
  if (o.approved) {
    await pool.query(
      `UPDATE continuous_operators SET approved_until = NOW() + INTERVAL '7 days', approval_meta = jsonb_build_object('windowStart', (NOW() - INTERVAL '1 day')::text) WHERE id = $1::uuid`, [op]);
  }
  return { co, owner, op, scheduleTime };
}
const roundKey = (s: Op) => roundKeyOf({ schedule: 'daily', scheduleTime: s.scheduleTime, scheduleDayOfWeek: null, scheduleDayOfMonth: null, scheduleMonth: null });
async function proposal(s: Op, o: { status: string; sendAt: Date | null; meta?: Record<string, unknown>; reviewed?: boolean; spamPass?: boolean; key?: string }): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'operator_proposals', {
    id, operator_id: s.op, company_id: s.co, status: o.status, recipient_count: N_CUSTOMERS, cost_estimate: 100,
    scheduled_send_at: o.sendAt, spam_test_status: o.spamPass ? 'pass' : null,
    reviewed_by: o.reviewed ? s.owner : null, reviewed_at: o.reviewed ? new Date() : null,
    proposal_json: {
      messages: [{ variantId: 'a', body: '이번 주 매장 안내드려요. 들러 주세요.', subject: '' }],
      channel: { recommended: 'SMS', isAd: true },
      target: { segmentKey: 'all', segmentParams: normalizeSegmentParams('all', null), filters: {} },
      meta: { roundKey: o.key ?? roundKey(s), ...(o.meta || {}) },
    },
  });
  return id;
}
const row = async (id: string) => (await pool.query(
  `SELECT status, scheduled_send_at, reviewed_by, auto_execute_reason, proposal_json->'meta'->'demo' AS demo FROM operator_proposals WHERE id = $1::uuid`, [id])).rows[0];
const keyCount = async (s: Op, key: string) => Number((await pool.query(
  `SELECT COUNT(*)::int AS n FROM operator_proposals WHERE operator_id = $1::uuid AND proposal_json->'meta'->>'roundKey' = $2 AND status NOT IN ('expired')`, [s.op, key])).rows[0].n);
/** 화면 흐름 그대로 — 처음 승인은 지금 문안(지문)을 돌려받고(FINAL_CHANGED) 그 지문으로 다시 승인 */
async function approve(s: Op, id: string) {
  const first = await approveProposal(s.co, id, s.owner, { variantIndex: 0 }, null);
  if (first.code !== 'FINAL_CHANGED') return first;
  return approveProposal(s.co, id, s.owner, { variantIndex: 0 }, first.finals?.[0]?.fingerprint ?? null);
}

beforeEach(() => { ctl.hours.start = 0; ctl.hours.end = 24; });

describe('3-1 회차 정체(실 PG)', () => {
  it('(c) 이 회차를 이미 보냄 = 워커 생성 0 · 다음 생성 시각 = 다음 회차(그 회차 뒤)', async () => {
    const s = await setup();
    const key = roundKey(s);
    await proposal(s, { status: 'sent', sendAt: new Date(key) });
    const r = await generateProposalForOperator(s.op);
    expect(r).toBeNull();
    expect(await keyCount(s, key)).toBe(1);
    const next = new Date((await pool.query(`SELECT next_run_at FROM continuous_operators WHERE id = $1`, [s.op])).rows[0].next_run_at);
    expect(next.getTime()).toBeGreaterThan(new Date(key).getTime());   // 그 회차의 준비 시각이 아니라 다음 회차
  });

  it('(c) 담당자 손에 있는 회차(대기) = 워커 생성 0', async () => {
    const s = await setup();
    const key = roundKey(s);
    await proposal(s, { status: 'pending', sendAt: new Date(key) });
    expect(await generateProposalForOperator(s.op)).toBeNull();
    expect(await keyCount(s, key)).toBe(1);
  });

  it('(d) 두 연결이 같은 회차를 함께 만들려 함 = 회차 잠금이 줄 세워 하나만', async () => {
    const s = await setup();
    const key = roundKey(s);
    const make = () => withRoundLock(s.op, key, async (run) => {
      const st = await roundState(run, s.op, key);
      if (st.done || st.openIds.length > 0) return 'skip';
      await new Promise((r) => setTimeout(r, 150));
      await run(
        `INSERT INTO operator_proposals (id, operator_id, company_id, status, proposal_json) VALUES ($1, $2, $3, 'pending', jsonb_build_object('meta', jsonb_build_object('roundKey', $4::text)))`,
        [randomUUID(), s.op, s.co, key]);
      return 'made';
    });
    const out = await Promise.all([make(), make()]);
    expect(out.sort()).toEqual(['made', 'skip']);
    expect(await keyCount(s, key)).toBe(1);
  });

  it('(d) 지금 실행이 본 대기 회차를 그사이 사람이 승인 = 교체 0 · 새 회차 0 · 승인한 회차 그대로', async () => {
    const s = await setup();
    const key = roundKey(s);
    const p = await proposal(s, { status: 'pending', sendAt: new Date(key) });
    const res = await withRoundLock(s.op, key, async (run) => {
      const st = await roundState(run, s.op, key);
      expect(st.openIds).toEqual([p]);
      expect((await approve(s, p)).ok).toBe(true);   // 다른 연결 · 회차 잠금을 잡지 않는 승인
      return replaceRoundCas(run, st.openIds);
    });
    expect(res).toBe(false);
    expect((await row(p)).status).toBe('scheduled');
    expect(await keyCount(s, key)).toBe(1);
  });

  it('(d) 지금 실행이 먼저 교체 = 그 뒤 승인 선점 0(만료된 회차는 승인되지 않는다)', async () => {
    const s = await setup();
    const key = roundKey(s);
    const p = await proposal(s, { status: 'pending', sendAt: new Date(key) });
    expect(await withRoundLock(s.op, key, async (run) => replaceRoundCas(run, (await roundState(run, s.op, key)).openIds))).toBe(true);
    expect((await approve(s, p)).ok).toBe(false);
    expect((await row(p)).status).toBe('expired');
  });
});

describe('3-2 B 회차 승인 = 정한 시각(실 PG)', () => {
  it('정한 시각 전 승인 = 그 시각 예약(사람 승인 · 상한 넘는 대상도)', async () => {
    const s = await setup();
    const t = new Date(Date.now() + 3 * 3600_000);
    const p = await proposal(s, { status: 'pending', sendAt: t });
    const r = await approve(s, p);
    expect(r.ok).toBe(true);
    const now = await row(p);
    expect(now.status).toBe('scheduled');
    expect(new Date(now.scheduled_send_at).getTime()).toBe(t.getTime());
    expect(now.reviewed_by).toBe(s.owner);
  });

  it('정한 시각 뒤 승인 = 지금 보냄(상한 넘는 대상 · 예산 넘음도 사람 승인 = 보지 않음)', async () => {
    const s = await setup({ budgetMonthly: 1 });
    const p = await proposal(s, { status: 'pending', sendAt: new Date(Date.now() - 3600_000) });
    const r = await approve(s, p);
    expect(r).toMatchObject({ ok: true, action: 'sent', sentCount: N_CUSTOMERS });
    const now = await row(p);
    expect(now.status).toBe('sent');
    expect(now.demo).toMatchObject({ simulated: true, recipients: N_CUSTOMERS });
  });

  it('야간 승인 = 다음 발송 창 예약 → 아침 발송 패스 = 상한 · 예산 없이 보냄', async () => {
    const s = await setup({ budgetMonthly: 1 });
    const start = (kstHour() + 2) % 24;
    ctl.hours.start = start; ctl.hours.end = start + 1;
    const p = await proposal(s, { status: 'pending', sendAt: new Date(Date.now() - 600_000) });
    const r = await approve(s, p);
    expect(r.ok).toBe(true);
    expect((await row(p)).status).toBe('scheduled');
    ctl.hours.start = 0; ctl.hours.end = 24;
    await pool.query(`UPDATE operator_proposals SET scheduled_send_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [p]);
    await runAutoSendPass();
    const now = await row(p);
    expect(now.status).toBe('sent');
    expect(now.demo).toMatchObject({ recipients: N_CUSTOMERS });
  });
});

describe('3-2 F 발송 직전 상한 갈래(실 PG · operatorCapPolicy)', () => {
  it('승인 기간 회차 + 상한 넘는 대상 = 그대로 보냄(상한 안 봄)', async () => {
    const s = await setup({ approved: true });
    const p = await proposal(s, { status: 'scheduled', sendAt: new Date(Date.now() - 60_000), spamPass: true, meta: { capPath: 'approval_window' } });
    await runAutoSendPass();
    const now = await row(p);
    expect(now.status).toBe('sent');
    expect(now.demo).toMatchObject({ recipients: N_CUSTOMERS });
  });

  it('승인 기간 회차 + 예산 넘음 = 검토로(예산은 본다)', async () => {
    const s = await setup({ approved: true, budgetMonthly: 1 });
    const p = await proposal(s, { status: 'scheduled', sendAt: new Date(Date.now() - 60_000), spamPass: true, meta: { capPath: 'approval_window' } });
    await runAutoSendPass();
    const now = await row(p);
    expect(now.status).toBe('admin_review');
    expect(String(now.auto_execute_reason)).toContain('예산');
  });

  it('회사 자율 회차 + 상한 넘는 대상 = 검토로(상한을 본다)', async () => {
    const s = await setup();
    const p = await proposal(s, { status: 'scheduled', sendAt: new Date(Date.now() - 60_000), spamPass: true });
    await runAutoSendPass();
    const now = await row(p);
    expect(now.status).toBe('admin_review');
    expect(String(now.auto_execute_reason)).toContain(`상한(${CAP}명)`);
  });
});
