// replaces: none
/**
 * 여정 묶음 발송 · 두 갈래 — 실 PostgreSQL 판(★ 2026-11-02 · 설계서 docs/2026-11-02-journey-batch-send-design.md §6 · Codex 설계 7R approve)
 *
 * 운영 문장을 글자 그대로 돌린다. 바깥(MySQL 단위 적재 · 처리 목록 · MySQL 장부 집계 · 금칙어 규칙 · 요금제 판정 · 운영 경보)만 시험이 쥔다.
 * 적재 단위 상한 = 3(QUEUE_UNIT_MAX 를 시험 값으로) = 작은 묶음으로 단위 여럿 · 단위 사이 사건을 본다.
 * 단계 캠페인 DDL = 이 파일 사본에 원장 블록(C96-DDL-1 · 2A · 2B)을 그대로 실행(원장 SQL 도 함께 검증) · 첫 절 = DDL 없음 상태.
 * 옛 코드의 단계 캠페인 문장 = 배포본 글자 그대로(OLD_MAPPING_SQL · 동시 만들기 · 부정 시험).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({
  hours: { start: 0, end: 24 },
  tables: ['SMSQ_TEST'] as string[],
  planOk: true,
  outcomes: [] as Array<'loaded' | 'rejected' | 'unknown'>,
  units: [] as Array<{ campaign: string; phones: string[] }>,
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
      ctl.units.push({ campaign: String(p.kind === 'sms' ? rows[0][6] : p.appEtc1), phones: rows.map((r: any) => String(p.kind === 'sms' ? r[0] : r.phone)) });
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

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { runJourneyExecutor } from '../journey-executor';
import { pickStepCampaignForUnits, resetStepCampaignSeqCache, kstDateString, type StepCampaignSpec } from '../journey-step-campaign';
import { stepSendableSql, stepHeldSql } from '../journey-pretest-notifier';

/** 옛 코드(배포본 journey-step-campaign.ts getOrCreateStepCampaign)의 매핑 문장 글자 그대로 */
const OLD_MAPPING_SQL = `INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
     ON CONFLICT (journey_id, step_id, send_date) DO NOTHING
     RETURNING campaign_id`;
/** 새 코드의 매핑 문장(순번 칸이 있을 때 · 대상 없는 DO NOTHING) */
const NEW_MAPPING_SQL = `INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id, seq)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::smallint)
           ON CONFLICT DO NOTHING
           RETURNING campaign_id`;

const PLAN = randomUUID();
/** 봉인(판정 CT 가 닫을 때 같은 문장에서 다는 표식과 같은 꼴 · journey-send-claim close) */
const sealStepCampaign = (id: string) => pool.query(`UPDATE campaigns SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{loadSealed}', 'true'::jsonb) WHERE id = $1`, [id]);
const kstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
/** KST 날짜의 낮 12시(UTC 03:00) */
const kstNoon = (day: string) => new Date(`${day}T03:00:00Z`);

interface Seeded { co: string; owner: string; j: string; s1: string; execs: string[]; custs: string[] }
/**
 * 회사 · 담당자 · 켜진 여정 · 문자 칸 2(1 = 검사 통과 판 · 2 = 하루 뒤) · 고객 · 지금 낼 실행(next_run_at 차례 = 배열 순서).
 * 번호는 발송 판정을 지나는 꼴 · 시험 DB 안에서만(실제 발송 0 = 단위 적재가 시험 손).
 */
async function seed(o: {
  trigger?: string; callback?: string | null; threshold?: number | null; demo?: boolean;
  customers: Array<{ phone?: string; optIn?: boolean; callback?: string | null; foreign?: boolean; sameAs?: number; enteredAt?: Date }>;
}): Promise<Seeded> {
  const co = randomUUID(); const owner = randomUUID(); const j = randomUUID(); const s1 = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: co, company_name: '묶음 발송 시험', ai_credits_purchased: 100000, plan_id: PLAN, subscription_status: 'active', billing_type: 'postpaid', is_demo: o.demo === true });
  await insertMinimalRow(pool, 'users', { id: owner, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: `t-1102-bs-${co.slice(0, 8)}` });
  await insertMinimalRow(pool, 'journeys', {
    id: j, company_id: co, created_by: owner, name: '묶음 발송 시험', status: 'active', start_kind: 'event',
    trigger_event: o.trigger ?? 'cdp.purchase', callback_number: o.callback === undefined ? '0212345678' : o.callback,
    threshold_cost_per_step: o.threshold ?? null,
  });
  await insertMinimalRow(pool, 'journey_steps', { id: s1, journey_id: j, step_order: 1, step_type: 'message', channel: 'lms', message_template: '묶음 발송 시험 안내 문안입니다.', delay_mode: 'relative', delay_hours: 0 });
  await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: j, step_order: 2, step_type: 'message', channel: 'lms', message_template: '둘째 칸 안내 문안입니다.', delay_mode: 'relative', delay_hours: 24 });
  await insertMinimalRow(pool, 'journey_step_snapshots', { id: randomUUID(), journey_id: j, step_id: s1, message_body: '묶음 발송 시험 안내 문안입니다.', confidence_score: 100 });
  let other: string | null = null;
  const custs: string[] = []; const execs: string[] = [];
  for (const [i, c] of o.customers.entries()) {
    let cust: string;
    if (c.sameAs != null) cust = custs[c.sameAs];
    else if (c.foreign) {
      if (!other) { other = randomUUID(); await insertMinimalRow(pool, 'companies', { id: other, company_name: '다른 회사' }); }
      cust = randomUUID();
      await insertMinimalRow(pool, 'customers', { id: cust, company_id: other, phone: '01077770000', is_active: true, sms_opt_in: true });
    } else {
      cust = randomUUID();
      await insertMinimalRow(pool, 'customers', { id: cust, company_id: co, phone: c.phone ?? `0109${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, is_active: true, sms_opt_in: c.optIn !== false, callback: c.callback ?? null });
    }
    custs.push(cust);
    const ex = randomUUID();
    await insertMinimalRow(pool, 'journey_executions', { id: ex, journey_id: j, customer_id: cust, current_step_order: 0, status: 'active' });
    await pool.query(
      `UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 hour' + ($2 || ' seconds')::interval, entered_at = COALESCE($3::timestamptz, entered_at) WHERE id = $1`,
      [ex, String(i), c.enteredAt ? c.enteredAt.toISOString() : null],
    );
    execs.push(ex);
  }
  return { co, owner, j, s1, execs, custs };
}
const logsOf = async (s: Seeded) => (await pool.query(
  `SELECT l.execution_id, l.status, l.error_reason, l.campaign_id FROM journey_step_logs l WHERE l.execution_id = ANY($1::uuid[]) ORDER BY l.sent_at`, [s.execs],
)).rows;
const execState = async (s: Seeded) => (await pool.query(
  `SELECT id, status, current_step_order, next_run_at, COALESCE(error_count, 0) AS ec FROM journey_executions WHERE id = ANY($1::uuid[])`, [s.execs],
)).rows.reduce((m: Map<string, any>, r: any) => m.set(String(r.id), r), new Map<string, any>());
const campaignsOf = async (s: Seeded) => (await pool.query(
  `SELECT c.id, c.sent_count, c.send_config FROM journey_step_campaigns jsc JOIN campaigns c ON c.id = jsc.campaign_id WHERE jsc.journey_id = $1`, [s.j],
)).rows;
/** 그 실행 · 그 칸의 적재 시도 기록 수(표식과 같은 문장에서 남기는 load_attempt = 상한 근거) */
const loadFailures = async (execId: string, stepId: string) => Number((await pool.query(
  `SELECT COUNT(*)::int AS n FROM journey_executions e, jsonb_array_elements(COALESCE(e.error_log, '[]'::jsonb)) fl
    WHERE e.id = $1 AND fl->>'step_id' = $2::text AND fl->>'reason' = 'load_attempt'`, [execId, stepId],
)).rows[0].n);
const journeyStatus = async (s: Seeded) => (await pool.query(`SELECT status, pause_reason FROM journeys WHERE id = $1`, [s.j])).rows[0];
const specOf = (s: Seeded): StepCampaignSpec => ({
  companyId: s.co, journeyId: s.j, stepId: s.s1, stepOrder: 1, msgType: 'LMS', representativeMessage: '시험', subject: '시험',
  isAd: true, createdBy: s.owner, sendChannel: 'sms', callbackNumber: '0212345678', kakaoTemplateId: null, mmsImagePaths: null,
});

beforeAll(async () => {
  // 운영엔 있음 · 시험 그릇 덤프엔 없음(크레딧 원장 seq · 검사 기록 판)
  for (const id of ['C90-DDL-1', 'C93-DDL-1', 'C93-DDL-2', 'C93-DDL-3']) await pool.query(ledgerBlockSql(id));
  await insertMinimalRow(pool, 'plans', { id: PLAN, plan_code: 'PRO', plan_name: 'PRO', monthly_price: 1000000, ai_credits_per_month: 2400, is_active: true });
}, 120_000);

beforeEach(async () => {
  // 앞 시험의 여정은 멈춘다(이 파일 사본 안 · 한 회차가 이 시험의 묶음만 보게)
  await pool.query(`UPDATE journeys SET status = 'paused' WHERE status = 'active'`);
  Object.assign(ctl, { tables: ['SMSQ_TEST'], planOk: true, outcomes: [], units: [], onUnit: null, alive: false, alerts: [] });
  ctl.hours.start = 0; ctl.hours.end = 24;
  ctl.upper.clear(); ctl.lower.clear();
});

describe('단계 캠페인 — DDL 없음(배포 앞 DDL-1 이 빠진 상태 · I6)', () => {
  it('순번 칸 없음 = 칸을 뺀 같은 대상 없는 문장 + 운영 경보 · 옛 코드와 같은 날 동시 만들기 = 오류 0 · 고아 0 · 옛 캠페인을 새 규약으로 넘겨 씀(I5)', async () => {
    resetStepCampaignSeqCache();
    const s = await seed({ customers: [] });
    const a = await pool.connect();
    try {
      const old = randomUUID();
      await insertMinimalRow(a, 'campaigns', { id: old, company_id: s.co, campaign_name: '[여정] step 1', status: 'sending', send_type: 'journey' });
      await a.query('BEGIN');
      await a.query(OLD_MAPPING_SQL, [s.j, s.s1, kstDay(), old]);
      const picking = pickStepCampaignForUnits(specOf(s));   // 매핑 문장이 이긴 쪽 커밋을 기다린다
      await new Promise((r) => setTimeout(r, 300));
      await a.query('COMMIT');
      expect(await picking).toEqual({ campaignId: old, sendDate: kstDateString() });   // ★ C129 D10 — 고른 캠페인의 발송 날을 함께 돌려준다
      const left = await pool.query(`SELECT COUNT(*)::int AS n FROM campaigns WHERE company_id = $1`, [s.co]);
      expect(left.rows[0].n).toBe(1);   // 진 쪽이 만든 캠페인은 지웠다
      const cfg = await pool.query(`SELECT send_config->>'loadProtocol' AS p FROM campaigns WHERE id = $1`, [old]);
      expect(cfg.rows[0].p).toBe('unit');
      expect(ctl.alerts).toContain('journey-step-campaign-seq-missing');
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      a.release();
    }
  });
});

describe('묶음 발송(DDL-1 뒤 = 배포 직후 상태)', () => {
  beforeAll(async () => {
    await pool.query(ledgerBlockSql('C96-DDL-1'));
    resetStepCampaignSeqCache();
  });

  it('묶음 하나 = 단위(INSERT 한 문장)마다 표식 → 차감 → 적재 → 확정 · 7명 = 단위 3 · 3 · 1 · 발송 수 = 확정 수 · 단위 기록 남지 않음', async () => {
    const s = await seed({ customers: Array.from({ length: 7 }, () => ({})) });
    const sum = await runJourneyExecutor();
    expect(ctl.units.map((u) => u.phones.length)).toEqual([3, 3, 1]);
    expect(new Set(ctl.units.map((u) => u.campaign)).size).toBe(1);
    const logs = await logsOf(s);
    expect(logs.filter((l: any) => l.status === 'sent')).toHaveLength(7);
    expect(logs.filter((l: any) => l.status === 'sending')).toHaveLength(0);
    const camps = await campaignsOf(s);
    expect(camps).toHaveLength(1);
    expect(Number(camps[0].sent_count)).toBe(7);
    expect(camps[0].send_config.loadProtocol).toBe('unit');
    expect(camps[0].send_config.loadUnit).toBeUndefined();
    const st = await execState(s);
    for (const id of s.execs) expect(Number(st.get(id).current_step_order)).toBe(1);
    expect(sum.sent).toBeGreaterThanOrEqual(7);
  });

  it('하루 묶음 = 같은 고객 둘째 실행은 한 통으로(duplicate_in_batch · 전진) · 즉시 갈래는 거르지 않는다', async () => {
    const d = await seed({ trigger: 'customer.created', customers: [{}, { sameAs: 0 }, {}] });
    await runJourneyExecutor();
    const dl = await logsOf(d);
    expect(dl.filter((l: any) => l.status === 'sent')).toHaveLength(2);
    expect(dl.filter((l: any) => l.error_reason === 'duplicate_in_batch').map((l: any) => String(l.execution_id))).toEqual([d.execs[1]]);
    expect(Number((await execState(d)).get(d.execs[1]).current_step_order)).toBe(1);
    await pool.query(`UPDATE journeys SET status = 'paused' WHERE id = $1`, [d.j]);
    ctl.units = [];
    const i = await seed({ trigger: 'cdp.purchase', customers: [{}, { sameAs: 0 }] });
    await runJourneyExecutor();
    expect((await logsOf(i)).filter((l: any) => l.status === 'sent')).toHaveLength(2);
  });

  it('둘째 단위 안 들어감(문장 보내기 전 실패) = 첫 단위 확정 · 둘째 표식 0 + 지금 재시도 규칙(5분 뒤) · 셋째 단위 시도 0', async () => {
    const s = await seed({ customers: Array.from({ length: 7 }, () => ({})) });
    ctl.outcomes = ['loaded', 'rejected'];
    await runJourneyExecutor();
    expect(ctl.units.map((u) => u.phones.length)).toEqual([3]);
    const logs = await logsOf(s);
    const st = await execState(s);
    for (const id of s.execs.slice(0, 3)) expect(logs.filter((l: any) => String(l.execution_id) === id).map((l: any) => l.status)).toEqual(['sent']);
    for (const id of s.execs.slice(3, 6)) {
      expect(logs.filter((l: any) => String(l.execution_id) === id).map((l: any) => `${l.status}:${l.error_reason}`)).toEqual(['failed:queue_insert_failed_retry_scheduled']);
      expect(Number(st.get(id).ec)).toBe(1);
      expect(new Date(st.get(id).next_run_at).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    }
    expect(logs.filter((l: any) => String(l.execution_id) === s.execs[6])).toHaveLength(0);
    expect(new Date(st.get(s.execs[6]).next_run_at).getTime()).toBeLessThan(Date.now());
    expect(logs.filter((l: any) => l.status === 'sending')).toHaveLength(0);
  });

  it('결과 불명 = 표식 보존 · 뒤 단위 0 → 다음 회차: 연결 살아 있음 = 보류(새 단위 0 · I2 · I4) → 끝남 + 장부 n = 확정(다시 안 보냄)', async () => {
    const s = await seed({ customers: Array.from({ length: 7 }, () => ({})) });
    ctl.outcomes = ['unknown'];
    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(1);
    const first = ctl.units[0];
    let logs = await logsOf(s);
    expect(logs.filter((l: any) => l.status === 'sending')).toHaveLength(3);
    const camp = String(first.campaign);
    expect((await pool.query(`SELECT send_config ? 'loadUnit' AS has FROM campaigns WHERE id = $1`, [camp])).rows[0].has).toBe(true);

    let st = await execState(s);
    for (const id of s.execs.slice(0, 3)) expect(new Date(st.get(id).next_run_at).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);   // 불명 = 5분 뒤 다시(시도 기록)

    ctl.alive = true;
    await runJourneyExecutor();   // 남은 넷 = 새 단위 앞에서 그 캠페인의 단위를 판정 → 원 연결이 살아 있음 = 보류
    expect(ctl.units).toHaveLength(1);   // 같은 캠페인에 미확정 단위 = 이 (여정 · 칸) 새 단위 0
    logs = await logsOf(s);
    for (const id of s.execs.slice(3)) expect(logs.filter((l: any) => String(l.execution_id) === id)).toHaveLength(0);

    ctl.alive = false; ctl.upper.set(camp, 3); ctl.lower.set(camp, 3);
    await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = ANY($1::uuid[]) AND current_step_order = 0`, [s.execs]);
    await runJourneyExecutor();   // 셋 = 가드가 단위 판정(끝남 + 장부 3 = 확정 · 전진) · 넷 = 새 단위로 보낸다
    logs = await logsOf(s);
    expect(logs.filter((l: any) => l.status === 'sent')).toHaveLength(7);
    expect(logs.filter((l: any) => l.status === 'sending')).toHaveLength(0);
    const sentPhones = ctl.units.flatMap((u) => u.phones);
    expect(sentPhones).toHaveLength(7);
    expect(new Set(sentPhones).size).toBe(7);   // 다시 보낸 번호 0
    st = await execState(s);
    for (const id of s.execs) expect(Number(st.get(id).current_step_order)).toBe(1);
  });

  it('결과 불명 = 시도 횟수를 지금 남긴다(5분 뒤 · R8) → 미적재 증명 뒤 다시 보냄이 또 불명이면 여정 멈춤(무한 반복 · 반복 차감 0 · Codex 구현 1R)', async () => {
    const s = await seed({ customers: [{}] });
    ctl.outcomes = ['unknown'];
    await runJourneyExecutor();
    let st = await execState(s);
    expect(await loadFailures(s.execs[0], s.s1)).toBe(1);
    expect(Number(st.get(s.execs[0]).ec)).toBe(0);   // 공용 오류 수는 그대로(다른 칸 · 처리 예외와 섞지 않는다)
    expect(new Date(st.get(s.execs[0]).next_run_at).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [s.execs[0]]);
    ctl.alive = false; ctl.outcomes = ['unknown'];   // 장부 0 = 안 들어감 증명 → 지우고 다시 보냄 → 또 불명
    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(2);
    expect((await journeyStatus(s)).status).toBe('paused');
    st = await execState(s);
    expect(Number(st.get(s.execs[0]).current_step_order)).toBe(0);   // 전진 0(표식은 판정이 닫는다)
    expect(await loadFailures(s.execs[0], s.s1)).toBe(2);

    // ★ Codex 구현 2R — 실행 · 여정 멈춤이 실패했다고 쳐도(둘 다 다시 active) 미적재가 증명된 뒤 세 번째 시도 0 = 실패 기록 + 전진
    await pool.query(`UPDATE journeys SET status = 'active', pause_reason = NULL WHERE id = $1`, [s.j]);
    await pool.query(`UPDATE journey_executions SET status = 'active', next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [s.execs[0]]);
    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(2);
    const logs = await logsOf(s);
    expect(logs.filter((l: any) => l.status === 'sending')).toHaveLength(0);
    expect(logs.map((l: any) => `${l.status}:${l.error_reason ?? ''}`)).toContain('failed:queue_insert_failed');
    expect(Number((await execState(s)).get(s.execs[0]).current_step_order)).toBe(1);
  });

  it('다른 길(다른 묶음 판정 · 고아 정리)이 표식을 먼저 지워도 상한에 닿은 실행의 세 번째 시도 0 = 새 표식 앞 한 곳(Codex 구현 3R)', async () => {
    const s = await seed({ customers: [{}] });
    ctl.outcomes = ['unknown'];
    await runJourneyExecutor();
    await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [s.execs[0]]);
    ctl.alive = false; ctl.outcomes = ['unknown'];
    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(2);
    // 다른 길이 표식 · 단위 기록을 지웠다고 친다 + 멈춤이 실패했다고 친다 + 사후 진단 기록 쓰기도 실패했다고 친다(★ Codex 구현 4R)
    await pool.query(`DELETE FROM journey_step_logs WHERE execution_id = $1 AND status = 'sending'`, [s.execs[0]]);
    await pool.query(
      `UPDATE journey_executions SET error_log = (SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) FROM jsonb_array_elements(error_log) v WHERE v->>'reason' <> 'queue_insert_unknown') WHERE id = $1`,
      [s.execs[0]],
    );
    await pool.query(`UPDATE campaigns SET send_config = send_config - 'loadUnit' WHERE id = $1`, [ctl.units[1].campaign]);
    await pool.query(`UPDATE journeys SET status = 'active', pause_reason = NULL WHERE id = $1`, [s.j]);
    await pool.query(`UPDATE journey_executions SET status = 'active', next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [s.execs[0]]);
    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(2);
    const logs = await logsOf(s);
    expect(logs.map((l: any) => `${l.status}:${l.error_reason ?? ''}`)).toEqual(['failed:queue_insert_failed']);
    expect(Number((await execState(s)).get(s.execs[0]).current_step_order)).toBe(1);
  });

  it('적재가 중간에 멈추면(재시도 소진 → 여정 멈춤) 그 뒤 비발송 고객은 결말 0(로그 · 전진 0 · Codex 구현 1R)', async () => {
    const s = await seed({ customers: [{}, { optIn: false }] });
    // ★ 2026-11-11 C129 D2 — 소진 기준 = 그 칸의 적재 시도 기록 수(옛: 실행 전체 error_count = 1) · 앞선 시도 하나를 심는다(이번 시도 = 2 = 상한)
    await pool.query(
      `UPDATE journey_executions SET error_log = COALESCE(error_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('reason', 'load_attempt', 'step_id', $2::text, 'campaign_id', 'prev', 'at', NOW())) WHERE id = $1`,
      [s.execs[0], s.s1],
    );
    ctl.outcomes = ['rejected'];
    await runJourneyExecutor();
    const logs = await logsOf(s);
    expect(logs.filter((l: any) => String(l.execution_id) === s.execs[0]).map((l: any) => `${l.status}:${l.error_reason}`)).toEqual(['failed:queue_insert_failed']);
    expect(logs.filter((l: any) => String(l.execution_id) === s.execs[1])).toHaveLength(0);
    expect(Number((await execState(s)).get(s.execs[1]).current_step_order)).toBe(0);
    expect((await journeyStatus(s)).status).toBe('paused');
  });

  it('정상 확정 = 실행 · 여정 비용 통계도 같은 문장(전진은 비용 0 · 두 번 더하지 않음 · Codex 구현 1R) · 다음 칸으로 넘어가면 시도 기록 지움(4R)', async () => {
    const s = await seed({ customers: [{}, {}] });
    await runJourneyExecutor();
    for (const id of s.execs) expect(await loadFailures(id, s.s1)).toBe(0);
    const cost = await pool.query(`SELECT COALESCE(SUM(cost), 0)::numeric AS c FROM journey_step_logs WHERE execution_id = ANY($1::uuid[]) AND status = 'sent'`, [s.execs]);
    const ex = await pool.query(`SELECT COALESCE(SUM(total_cost), 0)::numeric AS c FROM journey_executions WHERE id = ANY($1::uuid[])`, [s.execs]);
    const j = await pool.query(`SELECT stats_total_cost::numeric AS c FROM journeys WHERE id = $1`, [s.j]);
    expect(Number(cost.rows[0].c)).toBeGreaterThan(0);
    expect(Number(ex.rows[0].c)).toBe(Number(cost.rows[0].c));
    expect(Number(j.rows[0].c)).toBe(Number(cost.rows[0].c));
  });

  it('결과 불명 + 연결 끝남 + 장부 0(안 들어감 증명 · 새 규약) = 표식 지우고 그 셋을 다시 보낸다', async () => {
    const s = await seed({ customers: Array.from({ length: 3 }, () => ({})) });
    ctl.outcomes = ['unknown'];
    await runJourneyExecutor();
    const firstPhones = ctl.units[0].phones;
    ctl.alive = false;
    await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = ANY($1::uuid[])`, [s.execs]);   // 불명 = 5분 뒤 다시(시도 기록)
    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(2);
    expect(ctl.units[1].phones.sort()).toEqual([...firstPhones].sort());
    expect((await logsOf(s)).filter((l: any) => l.status === 'sent')).toHaveLength(3);
  });

  it('멈춤 경계 = 처음 멈춤 고객 앞까지 보내고 · 경계 고객 로그 + 여정 멈춤 · 뒤 고객은 아무것도 안 함', async () => {
    const cb = '0211112222';
    const s = await seed({ callback: null, customers: [{ callback: cb }, { callback: cb }, { callback: null }, { callback: cb }] });
    await runJourneyExecutor();
    const logs = await logsOf(s);
    const byExec = (i: number) => logs.filter((l: any) => String(l.execution_id) === s.execs[i]).map((l: any) => `${l.status}:${l.error_reason ?? ''}`);
    expect(byExec(0)).toEqual(['sent:']);
    expect(byExec(1)).toEqual(['sent:']);
    expect(byExec(2)).toEqual(['failed:callback_number_empty']);
    expect(byExec(3)).toEqual([]);
    expect((await journeyStatus(s)).status).toBe('paused');
    expect(Number((await execState(s)).get(s.execs[3]).current_step_order)).toBe(0);
  });

  it('단위 사이에 여정을 멈추면 다음 단위 표식 0 · 적재 0(표식 = 여정 · 실행 active 만)', async () => {
    const s = await seed({ customers: Array.from({ length: 5 }, () => ({})) });
    ctl.onUnit = async () => { await pool.query(`UPDATE journeys SET status = 'paused' WHERE id = $1`, [s.j]); };
    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(1);
    const logs = await logsOf(s);
    expect(logs.filter((l: any) => l.status === 'sent')).toHaveLength(3);
    for (const id of s.execs.slice(3)) expect(logs.filter((l: any) => String(l.execution_id) === id)).toHaveLength(0);
  });

  it('단위 사이에 발송 창이 닫히면 남은 실행 = 다음 창 · 표식 0(I7 · 판정과 같은 기준 시각)', async () => {
    const s = await seed({ customers: Array.from({ length: 5 }, () => ({})) });
    ctl.onUnit = async () => { ctl.hours.end = 0; };
    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(1);
    const st = await execState(s);
    const logs = await logsOf(s);
    for (const id of s.execs.slice(3)) {
      expect(logs.filter((l: any) => String(l.execution_id) === id)).toHaveLength(0);
      expect(new Date(st.get(id).next_run_at).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('전이 표 — 고객 없음 · 동의 철회 · 수신거부 = 건너뜀 + 전진 · 무효 번호 = 실행 종료 · 정상 = 발송(한 묶음 안 각자 결말)', async () => {
    // 무효 번호 = 숫자가 하나도 없는 번호(normalizePhone = 숫자만 남김 · 옛 한 건 판과 같은 판정)
    const s = await seed({ customers: [{ foreign: true }, { optIn: false }, { phone: '01055551234' }, { phone: '번호없음' }, {}] });
    await insertMinimalRow(pool, 'unsubscribes', { id: randomUUID(), company_id: s.co, phone: '01055551234', user_id: s.owner });
    await runJourneyExecutor();
    const logs = await logsOf(s);
    const st = await execState(s);
    const of = (i: number) => logs.filter((l: any) => String(l.execution_id) === s.execs[i]).map((l: any) => `${l.status}:${l.error_reason ?? ''}`);
    expect(of(0)).toEqual(['skipped:customer_not_found']);
    expect(of(1)).toEqual(['skipped:opt_out_or_inactive']);
    expect(of(2)).toEqual(['skipped:unsubscribed']);
    expect(of(3)).toEqual(['failed:invalid_phone']);
    expect(of(4)).toEqual(['sent:']);
    for (const i of [0, 1, 2, 4]) expect(Number(st.get(s.execs[i]).current_step_order)).toBe(1);
    expect(st.get(s.execs[3]).status).toBe('ended');
    expect((await journeyStatus(s)).status).toBe('active');
  });

  it('전이 표 — 묶음 단위 멈춤(요금제 잠김 · 칸 비용 임계 · 발송 표 없음) = 첫 고객 로그 + 여정 멈춤 · 적재 0 · 시연 회사 = demo_simulated 기록 · 적재 0', async () => {
    ctl.planOk = false;
    const p = await seed({ customers: [{}, {}] });
    await runJourneyExecutor();
    expect((await logsOf(p)).map((l: any) => `${l.status}:${l.error_reason}`)).toEqual(['failed:plan_locked']);
    expect((await journeyStatus(p)).status).toBe('paused');
    ctl.planOk = true;

    const t = await seed({ threshold: 1, customers: [{}, {}] });
    await runJourneyExecutor();
    expect((await logsOf(t)).map((l: any) => `${l.status}:${l.error_reason}`)).toEqual(['failed:threshold_cost_exceeded']);
    expect((await journeyStatus(t)).status).toBe('paused');

    ctl.tables = [];
    const n = await seed({ customers: [{}] });
    await runJourneyExecutor();
    expect((await logsOf(n)).map((l: any) => `${l.status}:${l.error_reason}`)).toEqual(['failed:no_sms_tables']);
    ctl.tables = ['SMSQ_TEST'];

    const d = await seed({ demo: true, customers: [{}, {}] });
    await runJourneyExecutor();
    const dl = await logsOf(d);
    expect(dl.map((l: any) => `${l.status}:${l.error_reason}:${l.campaign_id}`)).toEqual(['sent:demo_simulated:null', 'sent:demo_simulated:null']);
    expect(ctl.units).toHaveLength(0);
  });

  // ★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-6 · D2 — 하루 묶음 이상치 관문 없앰(양으로 작은 여정을 통째로 멈췄다 · 신규 판정 = 가입 근거)
  it('이상치 관문 없음 = 지난 날 하루 1명 · 어제 4명 = 그대로 4명 나감 · 멈춤 0 · 이상치 기록 0', async () => {
    const yday = kstDay(-1);
    const s = await seed({ trigger: 'customer.created', customers: Array.from({ length: 4 }, () => ({ enteredAt: kstNoon(yday) })) });
    for (let k = 2; k <= 9; k++) {
      const c = randomUUID();
      await insertMinimalRow(pool, 'customers', { id: c, company_id: s.co, phone: `0108${String(k).padStart(7, '0')}`, is_active: true, sms_opt_in: true });
      await insertMinimalRow(pool, 'journey_executions', { id: randomUUID(), journey_id: s.j, customer_id: c, current_step_order: 1, status: 'completed' });
      await pool.query(`UPDATE journey_executions SET entered_at = $2 WHERE customer_id = $1`, [c, kstNoon(kstDay(-k)).toISOString()]);
    }
    await runJourneyExecutor();
    expect(ctl.units.flatMap((u) => u.phones)).toHaveLength(4);
    expect((await journeyStatus(s)).status).toBe('active');
    const pl = await pool.query(`SELECT 1 FROM journey_step_pause_logs WHERE journey_id = $1 AND pause_reason = 'daily_volume_anomaly'`, [s.j]);
    expect(pl.rows).toEqual([]);
  });
});

describe('단계 캠페인 — DDL-1 상태 · DDL-2 뒤(I3 · I6)', () => {
  it('DDL-1 상태: 옛 문장 · 새 문장이 같은 날 동시에 만들어도 오류 0 · 고아 0 / 봉인 = 이어 붙임 닫힘 → 그 (여정 · 칸) 오늘 새 단위 0', async () => {
    resetStepCampaignSeqCache();
    for (const sql of [OLD_MAPPING_SQL, NEW_MAPPING_SQL]) {
      const s = await seed({ customers: [] });
      const a = await pool.connect();
      try {
        const won = randomUUID();
        await insertMinimalRow(a, 'campaigns', { id: won, company_id: s.co, campaign_name: '[여정] step 1', status: 'sending', send_type: 'journey', send_config: { journeyLedger: 'campaign', loadProtocol: 'unit' } });
        await a.query('BEGIN');
        await a.query(sql, sql === OLD_MAPPING_SQL ? [s.j, s.s1, kstDay(), won] : [s.j, s.s1, kstDay(), won, 0]);
        const picking = pickStepCampaignForUnits(specOf(s));
        await new Promise((r) => setTimeout(r, 300));
        await a.query('COMMIT');
        expect(await picking).toEqual({ campaignId: won, sendDate: kstDateString() });
        expect((await pool.query(`SELECT COUNT(*)::int AS n FROM campaigns WHERE company_id = $1`, [s.co])).rows[0].n).toBe(1);
        await sealStepCampaign(won);
        expect(await pickStepCampaignForUnits(specOf(s))).toEqual({ blocked: 'continuation_unavailable' });
      } finally {
        await a.query('ROLLBACK').catch(() => undefined);
        a.release();
      }
    }
  });

  it('DDL-2 뒤: 봉인된 캠페인 다음 = 순번 1 새 캠페인 · 같은 순번 동시 만들기 = 이긴 쪽 · 고아 0 / 부정 시험 = 옛 문장은 42P10(그래서 DDL-2 는 옛 프로세스 0 뒤)', async () => {
    await pool.query(ledgerBlockSql('C96-DDL-2A'));
    await pool.query(ledgerBlockSql('C96-DDL-2B'));
    resetStepCampaignSeqCache();
    const pk = await pool.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'journey_step_campaigns'::regclass AND contype = 'p'`);
    expect(pk.rows[0].d).toBe('PRIMARY KEY (journey_id, step_id, send_date, seq)');

    const s = await seed({ customers: [] });
    const first = await pickStepCampaignForUnits(specOf(s));
    if (!('campaignId' in first)) throw new Error('첫 캠페인을 못 만들었다');
    await sealStepCampaign(first.campaignId);
    const a = await pool.connect();
    try {
      const won = randomUUID();
      await insertMinimalRow(a, 'campaigns', { id: won, company_id: s.co, campaign_name: '[여정] step 1', status: 'sending', send_type: 'journey', send_config: { journeyLedger: 'campaign', loadProtocol: 'unit' } });
      await a.query('BEGIN');
      await a.query(NEW_MAPPING_SQL, [s.j, s.s1, kstDay(), won, 1]);
      const picking = pickStepCampaignForUnits(specOf(s));
      await new Promise((r) => setTimeout(r, 300));
      await a.query('COMMIT');
      expect(await picking).toEqual({ campaignId: won, sendDate: kstDateString() });
      const rows = await pool.query(`SELECT seq, campaign_id FROM journey_step_campaigns WHERE journey_id = $1 ORDER BY seq`, [s.j]);
      expect(rows.rows.map((r: any) => Number(r.seq))).toEqual([0, 1]);
      expect((await pool.query(`SELECT COUNT(*)::int AS n FROM campaigns WHERE company_id = $1`, [s.co])).rows[0].n).toBe(2);
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      a.release();
    }
    const old = await pool.query(OLD_MAPPING_SQL, [s.j, s.s1, kstDay(), randomUUID()]).then(() => null, (e: any) => e?.code);
    expect(old).toBe('42P10');
  });
});

// ★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md §7 — 실행기 효과 자리(3-4 ② · 3-4 ④ · 3-3 (c) · 3-18)
describe('C98 핵심 처방 — 실행기(실 PG)', () => {
  beforeAll(async () => {
    await pool.query(ledgerBlockSql('C96-DDL-1'));
    resetStepCampaignSeqCache();
  });
  const PAID = { revenue_applied: true, status: 'paid' };
  const purchase = async (co: string, cust: string) => {
    const id = randomUUID();
    await insertMinimalRow(pool, 'cdp_events', { id, company_id: co, customer_id: cust, event_name: 'purchase', source: 'test', properties: PAID });
    return id;
  };
  const reverse = (ev: string) => pool.query(`UPDATE cdp_events SET properties = properties || '{"revenue_reversed": true, "status": "cancelled"}'::jsonb WHERE id = $1`, [ev]);

  it('3-4 ② 구매로 들어온 뒤 그 구매 취소 = 그 실행 끝(ended · order_cancelled · 발송 0) · 결제 그대로 = 발송', async () => {
    const s = await seed({ trigger: 'cdp.purchase', customers: [{}, {}] });
    for (const [i, ex] of s.execs.entries()) {
      const ev = await purchase(s.co, s.custs[i]);
      await pool.query(`UPDATE journey_executions SET entry_event_properties = $2::jsonb WHERE id = $1`, [ex, JSON.stringify({ __entry: { src: 'trigger', key: ev } })]);
      if (i === 1) await reverse(ev);
    }
    await runJourneyExecutor();
    expect(ctl.units.flatMap((u) => u.phones)).toHaveLength(1);
    const st = await execState(s);
    expect(st.get(s.execs[1]).status).toBe('ended');
    expect((await logsOf(s)).filter((l: any) => l.execution_id === s.execs[1]).map((l: any) => `${l.status}:${l.error_reason}`)).toEqual(['skipped:order_cancelled']);
  });

  it('3-4 ④ 가입으로 시작한 여정의 「구매했으면」 조건 + 취소한 구매 = 안 산 갈래(끝) · 결제한 구매 = 산 갈래', async () => {
    const s = await seed({ trigger: 'customer.created', customers: [{}, {}] });
    await pool.query(
      `UPDATE journey_steps SET step_type = 'condition', condition_jsonb = '{"type": "cdp_event_exists", "event_name": "purchase", "within_days": 7}'::jsonb WHERE id = $1`, [s.s1]);
    await purchase(s.co, s.custs[0]);
    await reverse(await purchase(s.co, s.custs[1]));
    await runJourneyExecutor();
    const logs = await logsOf(s);
    expect(logs.find((l: any) => l.execution_id === s.execs[0])?.error_reason).toBe('condition_passed');
    expect((await execState(s)).get(s.execs[1]).status).toBe('ended');
    expect(ctl.units).toHaveLength(0);
  });

  it('3-3 (c) 판에 채울 자리 = 실행기가 그 칸 보류 · 발송 0 · 여정 멈춤 0 · 담당자 안내 원장 1', async () => {
    const s = await seed({ customers: [{}, {}] });
    const snap = randomUUID();
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: snap, journey_id: s.j, step_id: s.s1, message_body: '[혜택 안내: 직접 수정해주세요] 이번 주 안내드려요.', confidence_score: 100 });
    await runJourneyExecutor();
    expect(ctl.units).toHaveLength(0);
    expect((await journeyStatus(s)).status).toBe('active');
    expect((await pool.query(`SELECT ${stepHeldSql('$1::uuid', '$2::uuid')} AS h`, [s.j, s.s1])).rows[0].h).toBe(true);
    const held = (await pool.query(`SELECT snapshot_id, notice_sent_at FROM journey_pretest_schedules WHERE journey_id = $1 AND step_id = $2 AND status = 'held'`, [s.j, s.s1])).rows;
    expect(held).toHaveLength(1);
    expect(String(held[0].snapshot_id)).toBe(snap);
    expect(held[0].notice_sent_at).toBeNull();   // 안내 = 원장에 남김(보내기 = 보내기 전 검사 스캔의 안내 패스)
    expect([...(await execState(s)).values()].every((e: any) => e.status === 'active' && Number(e.current_step_order) === 0)).toBe(true);
  });

  it('3-18 발송 선점 판정 = 읽은 판 그대로일 때만(다른 연결이 새 판 · 보류를 커밋하면 거짓)', async () => {
    const s = await seed({ customers: [] });
    const read = (await pool.query(`SELECT id FROM journey_step_snapshots WHERE step_id = $1 ORDER BY created_at DESC LIMIT 1`, [s.s1])).rows[0].id;
    const ok = async () => (await pool.query(`SELECT ${stepSendableSql('$1::uuid', '$2::uuid', '$3::uuid')} AS ok`, [s.j, s.s1, read])).rows[0].ok;
    expect(await ok()).toBe(true);
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      const nid = randomUUID();
      await insertMinimalRow(other, 'journey_step_snapshots', { id: nid, company_id: s.co, journey_id: s.j, step_id: s.s1, message_body: '고친 글', confidence_score: 0 });
      await other.query(`UPDATE journey_step_snapshots SET created_at = NOW() + INTERVAL '1 second' WHERE id = $1`, [nid]);
      expect(await ok()).toBe(true);   // 커밋 전 = 아직 그 판
      await other.query('COMMIT');
    } finally { other.release(); }
    expect(await ok()).toBe(false);   // 새 판(검사 전)이 커밋됨 = 읽은 판으로는 선점 0
    const s2 = await seed({ customers: [] });
    const read2 = (await pool.query(`SELECT id FROM journey_step_snapshots WHERE step_id = $1`, [s2.s1])).rows[0].id;
    await pool.query(
      `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, scheduled_send_at, notify_at, status, snapshot_id) VALUES ($1, $2, $3, NOW(), NOW(), 'held', $4)`,
      [s2.co, s2.j, s2.s1, read2]);
    expect((await pool.query(`SELECT ${stepSendableSql('$1::uuid', '$2::uuid', '$3::uuid')} AS ok`, [s2.j, s2.s1, read2])).rows[0].ok).toBe(false);
  });
});

// ★ 2026-11-02 설계서 3-15 · CT-J9 — 클릭 = 그 여정 · 그 칸 링크(조건 두 꼴 · 목표 · 실 PG)
describe('C98 CT-J9 여정 링크 클릭(실행기 · 실 PG)', () => {
  beforeAll(async () => {
    await pool.query(ledgerBlockSql('C96-DDL-1'));
    resetStepCampaignSeqCache();
  });
  /** 1칸을 보낸 뒤(로그 sent · 1시간 전) 다음 차례가 된 실행 · 고객 0 = 이 여정 1칸 링크 클릭 · 고객 1 = 다른 여정 링크 클릭 */
  const afterFirst = async (o: { trigger?: string } = {}) => {
    const s = await seed({ trigger: o.trigger ?? 'customer.created', customers: [{}, {}] });
    for (const ex of s.execs) {
      await pool.query(`INSERT INTO journey_step_logs (execution_id, step_id, sent_at, status) VALUES ($1, $2, NOW() - INTERVAL '1 hour', 'sent')`, [ex, s.s1]);
      await pool.query(`UPDATE journey_executions SET current_step_order = 1, next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [ex]);
    }
    const click = (cust: string, journeyId: string) => insertMinimalRow(pool, 'cdp_events', {
      id: randomUUID(), company_id: s.co, customer_id: cust, event_name: 'message_click', source: 'short_url',
      properties: { journey_id: journeyId, step_id: s.s1 },
    });
    await click(s.custs[0], s.j);
    await click(s.custs[1], randomUUID());
    return s;
  };
  const toCondition = (s: Seeded, cond: Record<string, unknown>) => pool.query(
    `UPDATE journey_steps SET step_type = 'condition', condition_jsonb = $2::jsonb WHERE journey_id = $1 AND step_order = 2`, [s.j, JSON.stringify(cond)]);

  it('조건 「이 칸 링크를 눌렀나」(step_link_clicked) = 이 여정 그 칸 링크만', async () => {
    const s = await afterFirst();
    await toCondition(s, { type: 'step_link_clicked', step_id: s.s1 });
    await runJourneyExecutor();
    const st = await execState(s);
    expect(st.get(s.execs[1]).status).toBe('ended');
    expect(st.get(s.execs[0]).status).not.toBe('ended');
    expect((await logsOf(s)).find((l: any) => l.execution_id === s.execs[0] && l.error_reason === 'condition_passed')).toBeTruthy();
  });

  it('옛 조건 「앞 칸 클릭」(journey_step_clicked · 칸 순번) = 이 여정 그 칸 링크만', async () => {
    const s = await afterFirst();
    await toCondition(s, { type: 'journey_step_clicked', step_order: 1, within_days: 7 });
    await runJourneyExecutor();
    const st = await execState(s);
    expect(st.get(s.execs[1]).status).toBe('ended');
    expect(st.get(s.execs[0]).status).not.toBe('ended');
  });

  it('목표 「클릭」 = 이 여정 링크를 누른 실행만 목표 달성(goal_met) · 다른 여정 링크 = 계속', async () => {
    const s = await afterFirst();
    await pool.query(`UPDATE journeys SET goal_exit_enabled = true, goal_kind = 'click' WHERE id = $1`, [s.j]);
    await runJourneyExecutor();
    const st = await execState(s);
    expect(st.get(s.execs[0]).status).toBe('goal_met');
    expect(st.get(s.execs[1]).status).not.toBe('goal_met');
  });
});
