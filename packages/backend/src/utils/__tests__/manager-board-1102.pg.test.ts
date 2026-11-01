// replaces: none
/**
 * 담당자 상황판 · 주간 요약 — 실 PostgreSQL 판(★ 2026-11-02 엔진 재설계 E4-2 · E5 · 원장 C93-DDL-1 · 2 · 3)
 *
 * 운영 문장을 글자 그대로 돌린다(범위 · 칸 검사 · 할 일 · 오늘 나갈 칸 · 숫자 · 주간 요약 시도 잡기 · 한 통).
 * 바깥(MySQL 결과 집계 · 문자 적재)만 시험이 쥔다.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({ sent: [] as string[], counts: new Map<string, any>(), spam: new Map<string, number>() }));
vi.mock('../sms-queue', async (orig) => ({
  ...(await orig() as any),
  getAuthSmsTable: async () => 'SMSQ_TEST',
  getCompanySmsTablesWithLogs: async () => ['SMSQ_TEST'],
  smsCampaignCountsSafe: async (_t: string[], ids: string[]) => new Map(ids.filter((i) => ctl.counts.has(i)).map((i) => [i, ctl.counts.get(i)])),
  smsCampaignSpamCountsSafe: async (_t: string[], ids: string[]) => new Map(ids.map((i) => [i, ctl.spam.get(i) ?? 0])),
  bulkInsertSmsQueue: async (_t: string[], rows: any[][]) => { ctl.sent.push(String(rows[0][2])); return 1; },
}));
vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  return { ...real, withBoundedMysql: async (_ms: number, work: any) => work(async () => []) };
});

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { loadManagerBoardFor } from '../manager-board';
import { runWeeklyDigest, resetDigestTableCache } from '../manager-weekly-digest';

const CO = randomUUID();
const ADMIN = randomUUID();
const MEMBER = randomUUID();
const J_HELD = randomUUID();
const J_PAUSED = randomUUID();
const J_ONESHOT = randomUUID();
const J_MEMBER = randomUUID();
const S_HELD = randomUUID();
const SNAP = randomUUID();
const CUST = randomUUID();
const OP = randomUUID();
const CAMP = randomUUID();

beforeAll(async () => {
  process.env.JOURNEY_PAUSE_TOKEN_SECRET = 'test-secret-1102';
  for (const id of ['C93-DDL-1', 'C93-DDL-2', 'C93-DDL-3']) await pool.query(ledgerBlockSql(id));
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '시험 회사' });
  await insertMinimalRow(pool, 'users', { id: ADMIN, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1105', login_id: 't-1102-board-a' });
  await insertMinimalRow(pool, 'users', { id: MEMBER, company_id: CO, user_type: 'user', is_active: true, phone: '010-0000-1106', login_id: 't-1102-board-m' });
  await insertMinimalRow(pool, 'customers', { id: CUST, company_id: CO, phone: '01000007400' });
  const j = (id: string, name: string, status: string, owner: string, extra: Record<string, unknown> = {}) =>
    insertMinimalRow(pool, 'journeys', { id, company_id: CO, created_by: owner, name, status, start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678', ...extra });
  await j(J_HELD, '보류 여정', 'active', ADMIN);
  await j(J_PAUSED, '멈춘 여정', 'paused', ADMIN, { pause_reason: '담당자가 일시정지' });
  await j(J_ONESHOT, '한 번 여정', 'active', ADMIN, { start_kind: 'one_shot' });
  await j(J_MEMBER, '담당자 여정', 'active', MEMBER);
  await pool.query(`UPDATE journeys SET one_shot_dispatch_pending_at = NOW() - INTERVAL '5 minutes' WHERE id = $1::uuid`, [J_ONESHOT]);
  await insertMinimalRow(pool, 'journey_steps', { id: S_HELD, journey_id: J_HELD, step_order: 1, step_type: 'message', channel: 'lms', message_template: '안내' });
  await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: J_MEMBER, step_order: 1, step_type: 'message', channel: 'sms', message_template: '안내' });
  await insertMinimalRow(pool, 'journey_step_snapshots', { id: SNAP, journey_id: J_HELD, step_id: S_HELD, message_body: '안내', confidence_score: 0 });
  await pool.query(
    `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status, snapshot_id)
     VALUES ($1, $2, $3, NULL, NOW(), NOW(), 'held', $4)`, [CO, J_HELD, S_HELD, SNAP]);
  // 오늘 나갈 칸(보류 여정 1번 칸 · 오늘 KST 안 · 지금부터 1분 뒤)
  await insertMinimalRow(pool, 'journey_executions', { id: randomUUID(), journey_id: J_HELD, customer_id: CUST, current_step_order: 0, status: 'active' });
  await pool.query(`UPDATE journey_executions SET next_run_at = NOW() + INTERVAL '1 minute' WHERE journey_id = $1::uuid`, [J_HELD]);
  // 스팸 차단 몰림(지난 7일 · 결과 집계는 가짜)
  await insertMinimalRow(pool, 'campaigns', { id: CAMP, company_id: CO, message_type: 'LMS', status: 'completed', sent_count: 100, success_count: 60, fail_count: 40 });
  await pool.query(`INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id) VALUES ($1, $2, (NOW() AT TIME ZONE 'Asia/Seoul')::date, $3)`, [J_HELD, S_HELD, CAMP]);
  ctl.counts.set(CAMP, { success: 60, fail: 40, pending: 0, total: 100 });
  ctl.spam.set(CAMP, 30);
  // 자동마케팅 · 승인 대기 제안 · 플래너 확인 대기
  await insertMinimalRow(pool, 'continuous_operators', { id: OP, company_id: CO, status: 'active', created_by: ADMIN, name: '재구매 자동마케팅' });
  await insertMinimalRow(pool, 'operator_proposals', { id: randomUUID(), operator_id: OP, company_id: CO, status: 'admin_review', proposal_json: {} });
  await insertMinimalRow(pool, 'planner_events', { id: randomUUID(), company_id: CO, created_by: ADMIN, title: '11월 행사', status: 'briefed', plan_month: '2026-11', starts_on: '2026-11-20', ends_on: '2099-11-30' });
});

describe('E5 상황판 한 장(실 PG)', () => {
  it('관리자 = 회사 전체 · 할 일(보류 칸 · 스팸 몰림 · 넣는 중 · 멈춘 여정 · 승인 대기 · 플래너) · 오늘 나갈 칸 + 멈추기 · 숫자', async () => {
    const v = (await loadManagerBoardFor(CO, ADMIN))!;
    expect(v.scope).toBe('company');
    expect(v.companyName).toBe('시험 회사');
    expect(v.journeys.map((j) => j.name).sort()).toEqual(['담당자 여정', '멈춘 여정', '보류 여정', '한 번 여정']);
    expect(v.todos.map((t) => t.kind).sort()).toEqual(['dispatch_pending', 'held_step', 'paused_journey', 'planner_confirm', 'proposal_review', 'spam_surge']);
    expect(v.journeys.find((j) => j.id === J_HELD)!.steps).toEqual([expect.objectContaining({ order: 1, check: 'held' })]);
    expect(v.today).toEqual([expect.objectContaining({ journeyId: J_HELD, stepOrder: 1, count: 1 })]);
    expect(v.today[0].pauseUrl).toMatch(/\/journey-pause#t=/);
    expect(v.numbers).toMatchObject({ activeJourneys: 3, activeOperators: 1, sent7d: 100, successRate: 60 });
    expect(v.verdict.tone).toBe('warn');
  });
  it('담당자 = 자기가 만든 것만', async () => {
    const v = (await loadManagerBoardFor(CO, MEMBER))!;
    expect(v.scope).toBe('mine');
    expect(v.journeys.map((j) => j.name)).toEqual(['담당자 여정']);
    expect(v.operators).toEqual([]);
    expect(v.planner).toEqual([]);
  });
  it('다른 회사 담당자 · 없는 담당자 = null', async () => {
    expect(await loadManagerBoardFor(randomUUID(), ADMIN)).toBeNull();
  });
});

describe('★ Codex 구현 1R 상황판 목록 상한이 할 일 · 숫자를 자르지 않는다', () => {
  it('켜진 여정 55개 · 마지막 여정만 보류 = 할 일에 그 칸 · 켜진 수 = 전체 · 목록 = 50 · 나머지 수', async () => {
    const co = randomUUID();
    const admin = randomUUID();
    await insertMinimalRow(pool, 'companies', { id: co, company_name: '여정 많은 회사' });
    await insertMinimalRow(pool, 'users', { id: admin, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-1109', login_id: 't-1102-board-many' });
    let lastJ = '';
    let lastS = '';
    for (let i = 0; i < 55; i++) {
      lastJ = randomUUID();
      await insertMinimalRow(pool, 'journeys', { id: lastJ, company_id: co, created_by: admin, name: `여정 ${i}`, status: 'active', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
      await pool.query(`UPDATE journeys SET updated_at = NOW() - ($2 || ' minutes')::interval WHERE id = $1::uuid`, [lastJ, String(i)]);
      lastS = randomUUID();
      await insertMinimalRow(pool, 'journey_steps', { id: lastS, journey_id: lastJ, step_order: 1, step_type: 'message', channel: 'lms', message_template: '안내' });
    }
    const snap = randomUUID();
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: snap, journey_id: lastJ, step_id: lastS, message_body: '안내', confidence_score: 0 });
    await pool.query(
      `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status, snapshot_id)
       VALUES ($1, $2, $3, NULL, NOW(), NOW(), 'held', $4)`, [co, lastJ, lastS, snap]);
    const v = (await loadManagerBoardFor(co, admin))!;
    expect(v.numbers.activeJourneys).toBe(55);
    expect(v.journeys).toHaveLength(50);
    expect(v.more).toEqual({ journeys: 5, operators: 0 });
    expect(v.journeys.map((j) => j.id)).not.toContain(lastJ);
    expect(v.todos.filter((t) => t.kind === 'held_step')).toHaveLength(1);
    expect(v.verdict.tone).toBe('warn');
  });
});

describe('★ Codex 구현 2R(R18) 상황판 지난 7일 = 보낸 시각', () => {
  it('10일 전에 만들어 어제 보낸 자동마케팅 회차 = 지난 7일 보낸 수에 든다', async () => {
    const co = randomUUID();
    const admin = randomUUID();
    const op = randomUUID();
    const camp = randomUUID();
    await insertMinimalRow(pool, 'companies', { id: co, company_name: '늦게 보낸 회사' });
    await insertMinimalRow(pool, 'users', { id: admin, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-1110', login_id: 't-1102-board-late' });
    await insertMinimalRow(pool, 'continuous_operators', { id: op, company_id: co, status: 'active', created_by: admin, name: '늦게 보낸 자동마케팅' });
    await insertMinimalRow(pool, 'campaigns', { id: camp, company_id: co, message_type: 'SMS', status: 'completed', sent_count: 7, success_count: 7, fail_count: 0 });
    await insertMinimalRow(pool, 'operator_proposals', { id: randomUUID(), operator_id: op, company_id: co, status: 'sent', campaign_id: camp, proposal_json: {} });
    await pool.query(`UPDATE operator_proposals SET created_at = NOW() - INTERVAL '10 days', auto_sent_at = NOW() - INTERVAL '1 day' WHERE operator_id = $1::uuid`, [op]);
    const v = (await loadManagerBoardFor(co, admin))!;
    expect(v.numbers.sent7d).toBe(7);
  });
});

describe('E4-2 주간 요약(실 PG)', () => {
  it('월요일 09:30 KST = 담당자(번호)마다 한 통 · 다시 = 0(보낸 기록) · 창 밖 = 0', async () => {
    resetDigestTableCache();
    const monday = new Date('2026-11-02T00:30:00Z');
    ctl.sent = [];
    const r1 = await runWeeklyDigest(monday);
    const mine = ctl.sent.filter((b) => b.includes('[한줄로 주간 요약]'));
    expect(mine.length).toBeGreaterThanOrEqual(2);   // 관리자(만든 여정 · 자동마케팅) · 담당자(만든 여정) = 번호 둘
    expect(r1.sent).toBe(mine.length);
    expect(mine.some((b) => b.includes('확인할 일'))).toBe(true);
    const rows = (await pool.query(`SELECT owner_key, attempts, sent_at IS NOT NULL AS sent FROM manager_weekly_digests WHERE company_id = $1::uuid ORDER BY owner_key`, [CO])).rows;
    expect(rows.map((x) => [x.owner_key, Number(x.attempts), x.sent])).toEqual([['01000001105', 1, true], ['01000001106', 1, true]]);
    ctl.sent = [];
    await runWeeklyDigest(monday);
    expect(ctl.sent.filter((b) => b.includes('시험 회사') || b.includes('[한줄로 주간 요약]'))).toHaveLength(0);
    await runWeeklyDigest(new Date('2026-11-03T00:30:00Z'));
    expect(ctl.sent).toHaveLength(0);
  });
});
