// replaces: none
/**
 * C143 — SMS 길이(90바이트) 여정 갈래 · 실 PostgreSQL 판(★ 2026-11-18 · 설계서 docs/2026-11-18-c143-sms-length-admin-lists-design.md §2 W2 · W3 · §4)
 *   W2 실행기 = 고객별 렌더 뒤 · 비용 앞에서 넘는 고객만 sms_too_long(failed 로그 + 전진 · 적재 0) · 같은 묶음의 90 이하 고객 = 발송
 *   W3 켜기 · 켜진 칸 고치기 = 증명되는 하한(변수 없음 = 실제 글 · 변수 있음 = 고정 글자만)이 90 을 넘으면 막음 · Codex 1R #3 반례는 막지 않음
 * 틀(가짜 모듈 · 묶음 단위 적재) = journey-batch-send-1102.pg.test.ts 머리(9 ~ 65줄)를 글자 그대로 복사 · 고객 번호 = 010-0000-xxxx(도달 불가 대역).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({
  hours: { start: 0, end: 24 },
  tables: ['SMSQ_TEST'] as string[],
  planOk: true,
  outcomes: [] as Array<'loaded' | 'rejected' | 'unknown'>,
  units: [] as Array<{ campaign: string; phones: string[]; texts: string[] }>,
  onUnit: null as null | ((n: number) => Promise<void>),
  alive: false,
  upper: new Map<string, number>(),
  lower: new Map<string, number>(),
  alerts: [] as string[],
  thread: 100,
}));

vi.mock('../../config/defaults', async (orig) => {
  const real: any = await orig();
  return { ...real, SEND_HOURS: ctl.hours };
});
vi.mock('../sms-queue', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    QUEUE_UNIT_MAX: 3,
    getCompanySmsTables: async () => ctl.tables,
    hasCompanyLineGroup: async () => true,
    recordCampaignSentTables: async () => undefined,
    loadQueueUnit: async (p: any) => {
      const rows = p.kind === 'sms' ? p.smsRows : p.alimRows;
      const outcome = ctl.outcomes.shift() ?? 'loaded';
      if (outcome === 'rejected') return { state: 'rejected', table: 'SMSQ_TEST', reason: '주입: 연결 받기 실패' };
      const threadId = ++ctl.thread;
      await p.record({ threadId, table: 'SMSQ_TEST', count: rows.length });
      ctl.units.push({ campaign: String(p.kind === 'sms' ? rows[0][6] : p.appEtc1), phones: rows.map((r: any) => String(p.kind === 'sms' ? r[0] : r.phone)), texts: rows.map((r: any) => (p.kind === 'sms' ? String(r[2]) : '')) });
      const hook = ctl.onUnit;
      ctl.onUnit = null;
      if (hook) await hook(ctl.units.length);
      if (outcome === 'unknown') return { state: 'unknown', table: 'SMSQ_TEST', threadId, reason: '주입: 응답 유실' };
      return { state: 'loaded', table: 'SMSQ_TEST', threadId, finish: () => undefined };
    },
    isMysqlThreadAlive: async () => ctl.alive,
    getCampaignSmsTablesWide: async () => ['SMSQ_TEST'],
    smsCountAll: async (_t: string[], _w: string, params: any[]) => ctl.upper.get(String(params[0])) ?? 0,
    smsCampaignCountsSafe: async (_t: string[], ids: string[]) => new Map(ids.map((id) => [String(id), { total: ctl.lower.get(String(id)) ?? 0, success: 0, fail: 0, pending: 0 }])),
  };
});
vi.mock('../system-alert', () => ({
  sendSystemAlert: async (p: any) => { ctl.alerts.push(String(p?.dedupKey)); return 1; },
  alertPassFailures: async (p: any) => { if (p?.failures?.length) ctl.alerts.push(String(p.pass)); },
}));
vi.mock('../plan-guard', async (orig) => {
  const real: any = await orig();
  return { ...real, aiOperatorAllowedForWorker: async () => ctl.planOk };
});

vi.mock('../spam-test-queue', async (orig) => ({ ...(await orig<any>()), peekSpamCheck: async () => null, enqueueSpamTest: async () => ({ ok: true, testId: randomUUID() }) }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { runJourneyExecutor } from '../journey-executor';
import { resetStepCampaignSeqCache } from '../journey-step-campaign';
import { activationBlockIssue, updateJourneyStep, JourneyStepGateError } from '../journey-builder';
import { eucKrByteLength } from '../message-byte';
import { buildAdMessage } from '../messageUtils';
import { SHORT_URL_BASE } from '../short-url';

const PLAN = randomUUID();
const OPT080 = '0801234567';
const CB = '0212341118';

async function company(): Promise<{ co: string; owner: string }> {
  const co = randomUUID(); const owner = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: co, company_name: 'C143 길이 시험', ai_credits_purchased: 100000, plan_id: PLAN, subscription_status: 'active', billing_type: 'postpaid', opt_out_080_number: OPT080 });
  await insertMinimalRow(pool, 'users', { id: owner, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-1118', login_id: `t-1118-c143-${co.slice(0, 8)}` });
  await insertMinimalRow(pool, 'sender_numbers', { id: randomUUID(), company_id: co, phone_number: CB, is_active: true });
  return { co, owner };
}

beforeAll(async () => {
  for (const id of ['C89-DDL-1', 'C90-DDL-1', 'C93-DDL-1', 'C93-DDL-2', 'C93-DDL-3', 'C96-DDL-1']) await pool.query(ledgerBlockSql(id));
  resetStepCampaignSeqCache();
  await insertMinimalRow(pool, 'plans', { id: PLAN, plan_code: 'PRO', plan_name: 'PRO', monthly_price: 1000000, ai_credits_per_month: 2400, is_active: true });
}, 120_000);

beforeEach(async () => {
  await pool.query(`UPDATE journeys SET status = 'paused' WHERE status = 'active'`);
  Object.assign(ctl, { tables: ['SMSQ_TEST'], planOk: true, outcomes: [], units: [], onUnit: null, alive: false, alerts: [] });
  ctl.hours.start = 0; ctl.hours.end = 24;
  ctl.upper.clear(); ctl.lower.clear();
});

describe('W2 실행기 — 넘는 고객만 sms_too_long · 90 이하 고객 = 발송', () => {
  it('%이름% 이 긴 고객 = failed(sms_too_long) · 적재 0 · 전진 / 짧은 고객 = 같은 묶음에서 발송', async () => {
    const { co, owner } = await company();
    const j = randomUUID(); const s1 = randomUUID();
    const tpl = '%이름%님 ' + 'A'.repeat(56);
    await insertMinimalRow(pool, 'journeys', { id: j, company_id: co, created_by: owner, name: 'C143 실행', status: 'active', start_kind: 'event', trigger_event: 'cdp.purchase', callback_number: CB });
    await insertMinimalRow(pool, 'journey_steps', { id: s1, journey_id: j, step_order: 1, step_type: 'message', channel: 'sms', message_template: tpl, delay_mode: 'relative', delay_hours: 0 });
    await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: j, step_order: 2, step_type: 'message', channel: 'lms', message_template: '둘째 칸 안내 문안입니다.', delay_mode: 'relative', delay_hours: 24 });
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: randomUUID(), journey_id: j, step_id: s1, message_body: tpl, confidence_score: 100 });
    const people = [{ name: '김가', phone: '01000001181' }, { name: '김가나다라마', phone: '01000001182' }];
    const execs: string[] = [];
    for (const [i, p] of people.entries()) {
      const cust = randomUUID();
      await insertMinimalRow(pool, 'customers', { id: cust, company_id: co, phone: p.phone, name: p.name, is_active: true, sms_opt_in: true });
      const ex = randomUUID();
      await insertMinimalRow(pool, 'journey_executions', { id: ex, journey_id: j, customer_id: cust, current_step_order: 0, status: 'active' });
      await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 hour' + ($2 || ' seconds')::interval WHERE id = $1`, [ex, String(i)]);
      execs.push(ex);
    }
    // 전제(값 범위): 짧은 이름 = 90 안 · 긴 이름 = 90 넘음(광고 머리 · 꼬리 포함 · 렌더와 같은 조립)
    expect(eucKrByteLength(buildAdMessage(`김가님 ${'A'.repeat(56)}`, 'SMS', true, OPT080))).toBeLessThanOrEqual(90);
    expect(eucKrByteLength(buildAdMessage(`김가나다라마님 ${'A'.repeat(56)}`, 'SMS', true, OPT080))).toBeGreaterThan(90);

    await runJourneyExecutor();
    expect(ctl.units.flatMap((u) => u.phones)).toEqual(['01000001181']);
    const logs = (await pool.query(`SELECT execution_id, status, error_reason FROM journey_step_logs WHERE execution_id = ANY($1::uuid[])`, [execs])).rows;
    const byExec = new Map(logs.map((l: any) => [String(l.execution_id), l]));
    expect(byExec.get(execs[0])?.status).toBe('sent');
    expect(byExec.get(execs[1])?.status).toBe('failed');
    expect(byExec.get(execs[1])?.error_reason).toBe('sms_too_long');
    const st = (await pool.query(`SELECT id, status, current_step_order FROM journey_executions WHERE id = ANY($1::uuid[])`, [execs])).rows;
    const long = st.find((r: any) => String(r.id) === execs[1]);
    expect(long.current_step_order).toBe(1);   // 전진(다음 칸)
    expect(long.status).toBe('active');
  });
});

describe('W2 렌더 판정 = 넘는 고객 몫을 비용 · 예산 셈에 넣지 않는다', () => {
  it('월 예산 = 한 통 몫 · 넘는 고객이 앞 · 짧은 고객이 뒤 → 짧은 고객 발송 · 넘는 고객 failed(sms_too_long) · 예산 멈춤 0', async () => {
    const { co, owner } = await company();
    await pool.query(`UPDATE companies SET cost_per_sms = 20, unit_price_basis = 'vat_included' WHERE id = $1`, [co]);
    const j = randomUUID(); const s1 = randomUUID();
    const tpl = '%이름%님 ' + 'A'.repeat(56);
    await insertMinimalRow(pool, 'journeys', { id: j, company_id: co, created_by: owner, name: 'C143 예산', status: 'active', start_kind: 'event', trigger_event: 'cdp.purchase', callback_number: CB, budget_monthly: 30 });
    await insertMinimalRow(pool, 'journey_steps', { id: s1, journey_id: j, step_order: 1, step_type: 'message', channel: 'sms', message_template: tpl, delay_mode: 'relative', delay_hours: 0 });
    await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: j, step_order: 2, step_type: 'message', channel: 'lms', message_template: '둘째 칸 안내 문안입니다.', delay_mode: 'relative', delay_hours: 24 });
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: randomUUID(), journey_id: j, step_id: s1, message_body: tpl, confidence_score: 100 });
    const people = [{ name: '김가나다라마', phone: '01000001185' }, { name: '김가', phone: '01000001186' }];   // 넘는 고객이 먼저(next_run_at 순)
    const execs: string[] = [];
    for (const [i, p] of people.entries()) {
      const cust = randomUUID();
      await insertMinimalRow(pool, 'customers', { id: cust, company_id: co, phone: p.phone, name: p.name, is_active: true, sms_opt_in: true });
      const ex = randomUUID();
      await insertMinimalRow(pool, 'journey_executions', { id: ex, journey_id: j, customer_id: cust, current_step_order: 0, status: 'active' });
      await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 hour' + ($2 || ' seconds')::interval WHERE id = $1`, [ex, String(i)]);
      execs.push(ex);
    }

    await runJourneyExecutor();
    expect(ctl.units.flatMap((u) => u.phones)).toEqual(['01000001186']);
    const logs = (await pool.query(`SELECT execution_id, status, error_reason FROM journey_step_logs WHERE execution_id = ANY($1::uuid[])`, [execs])).rows;
    const byExec = new Map(logs.map((l: any) => [String(l.execution_id), `${l.status}:${l.error_reason ?? ''}`]));
    expect(byExec.get(execs[0])).toBe('failed:sms_too_long');
    expect(byExec.get(execs[1])).toBe('sent:');
    expect((await pool.query(`SELECT status FROM journeys WHERE id = $1`, [j])).rows[0].status).toBe('active');   // 예산 멈춤 0
  });
});

describe('W2 · W3 주소 줄이기 갈래(Codex 구현 1R #2) — 원문은 90 을 넘어도 줄이면 들어가는 글 = 켜기 통과 · 발송', () => {
  it('변수 없는 SMS 칸 + 긴 주소 = 켜기 막힘 0 · 실행기 = 줄인 글(90 안)로 발송 · 실패 기록 0', async () => {
    const { co, owner } = await company();
    const j = randomUUID(); const s1 = randomUUID();
    const tpl = `안내 https://example.com/${'a'.repeat(80)}`;
    // 전제(값 범위): 원문 + 머리 · 꼬리 = 90 넘음
    expect(eucKrByteLength(buildAdMessage(tpl, 'SMS', true, OPT080))).toBeGreaterThan(90);
    await insertMinimalRow(pool, 'journeys', { id: j, company_id: co, created_by: owner, name: 'C143 주소', status: 'draft', start_kind: 'event', trigger_event: 'custom', trigger_filters: { all_customers: true }, callback_number: CB });
    await insertMinimalRow(pool, 'journey_steps', { id: s1, journey_id: j, step_order: 1, step_type: 'message', channel: 'sms', message_template: tpl, delay_mode: 'relative', delay_hours: 0 });
    expect(await activationBlockIssue(co, j, { forCheck: true })).toBeNull();
    await pool.query(`UPDATE journeys SET status = 'active' WHERE id = $1`, [j]);
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: randomUUID(), journey_id: j, step_id: s1, message_body: tpl, confidence_score: 100 });
    const cust = randomUUID();
    await insertMinimalRow(pool, 'customers', { id: cust, company_id: co, phone: '01000001183', name: '김가', is_active: true, sms_opt_in: true });
    const ex = randomUUID();
    await insertMinimalRow(pool, 'journey_executions', { id: ex, journey_id: j, customer_id: cust, current_step_order: 0, status: 'active' });
    await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [ex]);

    await runJourneyExecutor();
    expect(ctl.units.flatMap((u) => u.phones)).toEqual(['01000001183']);
    const sent = ctl.units.flatMap((u) => u.texts)[0];
    expect(sent).toContain(SHORT_URL_BASE);
    expect(eucKrByteLength(sent)).toBeLessThanOrEqual(90);
    const log = (await pool.query(`SELECT status, error_reason FROM journey_step_logs WHERE execution_id = $1`, [ex])).rows;
    expect(log.map((l: any) => l.status)).toEqual(['sent']);
  });
});

describe('W2 줄인 뒤 다시 잰다(Codex 구현 1R #2) — 짧은 원문 주소가 더 긴 짧은 주소로 바뀌어 넘는 고객 = 그 고객만 실패', () => {
  it('원문 + 머리 · 꼬리 = 딱 90 · 줄인 글 = 90 넘음 → failed(sms_too_long) · 적재 0 · 전진', async () => {
    const { co, owner } = await company();
    const j = randomUUID(); const s1 = randomUUID();
    let pad = 0;
    while (eucKrByteLength(buildAdMessage('A'.repeat(pad + 1) + ' http://a.co', 'SMS', true, OPT080)) <= 90) pad += 1;
    const tpl = 'A'.repeat(pad) + ' http://a.co';
    expect(eucKrByteLength(buildAdMessage(tpl, 'SMS', true, OPT080))).toBe(90);
    await insertMinimalRow(pool, 'journeys', { id: j, company_id: co, created_by: owner, name: 'C143 짧은 주소', status: 'active', start_kind: 'event', trigger_event: 'cdp.purchase', callback_number: CB });
    await insertMinimalRow(pool, 'journey_steps', { id: s1, journey_id: j, step_order: 1, step_type: 'message', channel: 'sms', message_template: tpl, delay_mode: 'relative', delay_hours: 0 });
    await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: j, step_order: 2, step_type: 'message', channel: 'lms', message_template: '둘째 칸 안내 문안입니다.', delay_mode: 'relative', delay_hours: 24 });
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: randomUUID(), journey_id: j, step_id: s1, message_body: tpl, confidence_score: 100 });
    const cust = randomUUID();
    await insertMinimalRow(pool, 'customers', { id: cust, company_id: co, phone: '01000001184', name: '김가', is_active: true, sms_opt_in: true });
    const ex = randomUUID();
    await insertMinimalRow(pool, 'journey_executions', { id: ex, journey_id: j, customer_id: cust, current_step_order: 0, status: 'active' });
    await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [ex]);

    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(0);
    const log = (await pool.query(`SELECT status, error_reason FROM journey_step_logs WHERE execution_id = $1`, [ex])).rows;
    expect(log.map((l: any) => `${l.status}:${l.error_reason}`)).toEqual(['failed:sms_too_long']);
    const st = (await pool.query(`SELECT status, current_step_order FROM journey_executions WHERE id = $1`, [ex])).rows[0];
    expect(st.current_step_order).toBe(1);
    expect(st.status).toBe('active');
  });
});

describe('W3 켜기 · 켜진 칸 고치기 — 증명되는 하한', () => {
  it('변수 없는 SMS 칸 = 실제 글(광고 머리 · 꼬리 포함)이 90 을 넘으면 켜기 막힘 · 90 이면 통과', async () => {
    const { co, owner } = await company();
    const j = randomUUID(); const s = randomUUID();
    const len = 90 - eucKrByteLength(buildAdMessage('', 'SMS', true, OPT080));   // 광고 머리 · 꼬리를 붙여 딱 90 이 되는 본문 길이
    await insertMinimalRow(pool, 'journeys', { id: j, company_id: co, created_by: owner, name: 'C143 켜기', status: 'draft', start_kind: 'event', trigger_event: 'custom', trigger_filters: { all_customers: true }, callback_number: CB });
    await insertMinimalRow(pool, 'journey_steps', { id: s, journey_id: j, step_order: 1, step_type: 'message', channel: 'sms', message_template: 'A'.repeat(len + 1), delay_mode: 'relative', delay_hours: 0 });
    const over = await activationBlockIssue(co, j, { forCheck: true });
    expect(over?.cause).toBe('copy_issue');
    expect(over?.message).toBe('1번째 칸 SMS 글이 (광고) 표기와 무료수신거부 줄까지 91바이트예요. SMS는 90바이트까지라 이대로는 보낼 수 없어요. 줄이거나 LMS로 바꿔 주세요.');
    await pool.query(`UPDATE journey_steps SET message_template = $2 WHERE id = $1`, [s, 'A'.repeat(len)]);
    expect(await activationBlockIssue(co, j, { forCheck: true })).toBeNull();
  });
  it('변수 있는 칸 = 고정 글자만(값이 무료수신거부 문구여도 막지 않음) · 고정 글자만으로 넘으면 「고객 정보를 넣기 전에도」', async () => {
    const { co, owner } = await company();
    const j = randomUUID(); const s = randomUUID();
    await insertMinimalRow(pool, 'journeys', { id: j, company_id: co, created_by: owner, name: 'C143 변수', status: 'draft', start_kind: 'event', trigger_event: 'custom', trigger_filters: { all_customers: true }, callback_number: CB });
    await insertMinimalRow(pool, 'journey_steps', { id: s, journey_id: j, step_order: 1, step_type: 'message', channel: 'sms', message_template: `%이름%님 ${'A'.repeat(70)}`, delay_mode: 'relative', delay_hours: 0 });
    expect(await activationBlockIssue(co, j, { forCheck: true })).toBeNull();   // 고정 73바이트 = 하한 안(광고 꼬리는 값에 따라 안 붙을 수 있어 더하지 않는다)
    await pool.query(`UPDATE journey_steps SET message_template = $2 WHERE id = $1`, [s, `%이름%님 ${'A'.repeat(90)}`]);
    const over = await activationBlockIssue(co, j, { forCheck: true });
    expect(over?.message).toContain('고객 정보를 넣기 전에도 93바이트예요');
  });
  it('켜진 SMS 칸을 넘는 글로 고치기 = 409 COPY_ISSUE · 저장 0', async () => {
    const { co, owner } = await company();
    const j = randomUUID(); const s = randomUUID();
    const okText = '오늘 매장 안내 문안입니다.';
    await insertMinimalRow(pool, 'journeys', { id: j, company_id: co, created_by: owner, name: 'C143 켜짐', status: 'active', start_kind: 'event', trigger_event: 'custom', trigger_filters: { all_customers: true }, callback_number: CB });
    await insertMinimalRow(pool, 'journey_steps', { id: s, journey_id: j, step_order: 1, step_type: 'message', channel: 'sms', message_template: okText, delay_mode: 'relative', delay_hours: 0 });
    const err = await updateJourneyStep(co, j, s, { messageTemplate: '가'.repeat(60), allowActiveMessageEdit: true }).catch((e) => e);
    expect(err).toBeInstanceOf(JourneyStepGateError);
    expect(err.code).toBe('COPY_ISSUE');
    expect(err.message).toContain('SMS 글이 (광고) 표기와 무료수신거부 줄까지');
    expect((await pool.query(`SELECT message_template FROM journey_steps WHERE id = $1`, [s])).rows[0].message_template).toBe(okText);
  });
});
