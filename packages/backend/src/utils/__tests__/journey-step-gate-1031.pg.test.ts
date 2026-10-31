// replaces: none
/**
 * 여정 칸 관문 · 담당자 안내 — 실 PostgreSQL 판(★ 2026-10-31 · 설계서 docs/2026-10-31-journey-step-gate-notice-design.md §5-2)
 *
 * 운영 문장을 글자 그대로 돌린다. 바깥(스팸 검사 · MySQL 적재 · 결과 집계 · 운영 경보)만 시험이 쥔다.
 * 새 칸(원장 C84-DDL-2 · C84-DDL-1)은 이 파일의 사본에 원장 블록을 그대로 실행해 만든다(원장 SQL 도 함께 검증).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const ctl = vi.hoisted(() => ({
  failFinalize: false,
  enqueue: [] as string[],
  enqueueResult: 1 as number,
  onEnqueue: null as null | (() => Promise<void>),
  onSpamTest: null as null | (() => Promise<void>),
  spamCalls: 0,
  alerts: [] as string[],
  counts: new Map<string, { success: number; fail: number; pending: number }>(),
}));

vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  const query = (text: string, params?: any[]) => {
    if (ctl.failFinalize && text.includes("SET status = 'notified' WHERE id = $1::uuid AND status = 'pending'")) {
      return Promise.reject(new Error('주입: 기록(③) 실패'));
    }
    return real.query(text, params);
  };
  return { ...real, query, withBoundedMysql: async (_ms: number, work: any) => work(async () => []) };
});
vi.mock('../sms-queue', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getAuthSmsTable: async () => 'SMSQ_TEST',
    bulkInsertSmsQueue: async (_t: string[], rows: any[][]) => {
      if (ctl.onEnqueue) await ctl.onEnqueue();
      ctl.enqueue.push(String(rows[0][2]));
      return ctl.enqueueResult;
    },
    getCompanySmsTablesWithLogs: async () => ['SMSQ_TEST'],
    smsCampaignCountsSafe: async (_t: string[], ids: string[]) => new Map(ids.filter((id) => ctl.counts.has(String(id))).map((id) => [String(id), ctl.counts.get(String(id))!])),
  };
});
vi.mock('../journey-pretest-validator', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    runStepSpamTest: async () => {
      ctl.spamCalls++;
      if (ctl.onSpamTest) await ctl.onSpamTest();
      return { verdict: 'pass', ok: true, enqueueOk: true, failedCarriers: [], matchedStopWords: [], score: 100 };
    },
  };
});
vi.mock('../system-alert', () => ({ sendSystemAlert: async (p: any) => { ctl.alerts.push(String(p.dedupKey)); return 1; } }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { scanAndPretest, pretestDoneSql, resetPretestScanMemory } from '../journey-pretest-notifier';
import { notifyJourneyStepResults, resetResultNoticeColumnsCache, RESULT_NOTICE_SCAN_LIMIT } from '../journey-result-notice';
import { updateJourneyStep } from '../journey-builder';
import { applyResumeAdjustments } from '../journey-resume';
import { anchorStepDispatched } from '../journey-anchor-scheduler';

const CO = '00000000-0000-0000-0000-00000000c031';
const OWNER = '00000000-0000-0000-0000-00000000a031';
const CUST = '00000000-0000-0000-0000-00000000d031';
const J = '00000000-0000-0000-0000-00000000e031';
const S1 = '00000000-0000-0000-0000-00000000f031';
const S2 = '00000000-0000-0000-0000-00000000f032';
const SNAP = '00000000-0000-0000-0000-00000000b031';
const EXE = '00000000-0000-0000-0000-000000009031';

const runLedgerBlock = async (id: string) => { await pool.query(ledgerBlockSql(id)); };
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const records = async () => (await pool.query(
  `SELECT id, status, notice_attempts FROM journey_pretest_schedules WHERE journey_id = $1 AND step_id = $2 ORDER BY notify_at DESC, id DESC`, [J, S1],
)).rows;
const gateOpen = async () => (await pool.query(`SELECT ${pretestDoneSql('$1::uuid', '$2::uuid', '$3::date')} AS ok`, [J, S1, kstToday()])).rows[0].ok as boolean;

beforeAll(async () => {
  await runLedgerBlock('C84-DDL-2');
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'user', is_active: true, phone: '010-0000-0031', login_id: 't-1031-owner' });
  await insertMinimalRow(pool, 'customers', { id: CUST, company_id: CO, phone: '01000009999' });
  await insertMinimalRow(pool, 'journeys', { id: J, company_id: CO, created_by: OWNER, name: '시험 여정', status: 'active', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
  await insertMinimalRow(pool, 'journey_steps', { id: S1, journey_id: J, step_order: 1, step_type: 'message', channel: 'lms', message_template: '첫 문안', delay_mode: 'relative', delay_hours: 0, notify_manager_on_pretest: true });
  await insertMinimalRow(pool, 'journey_steps', { id: S2, journey_id: J, step_order: 2, step_type: 'message', channel: 'lms', message_template: '두 번째', delay_mode: 'relative', delay_hours: 168 });
  await insertMinimalRow(pool, 'journey_step_snapshots', { id: SNAP, journey_id: J, step_id: S1, message_body: '첫 문안', confidence_score: 100 });
  await insertMinimalRow(pool, 'journey_executions', { id: EXE, journey_id: J, customer_id: CUST, current_step_order: 0, status: 'active' });
});

beforeEach(async () => {
  await pool.query(`DELETE FROM journey_pretest_schedules WHERE journey_id = $1`, [J]);
  await pool.query(`UPDATE journey_executions SET status = 'active', current_step_order = 0, next_run_at = NOW() + INTERVAL '10 minutes' WHERE id = $1`, [EXE]);
  await pool.query(`UPDATE journeys SET status = 'active' WHERE id = $1`, [J]);
  resetPretestScanMemory(true);
  Object.assign(ctl, { failFinalize: false, enqueue: [], enqueueResult: 1, onEnqueue: null, onSpamTest: null, spamCalls: 0, alerts: [] });
});

describe('2-1 그날 마침 판정 조각', () => {
  it('오늘 notified · cancelled = 참 · paused · pending · 어제 · 다른 칸 · 다른 여정 = 거짓', async () => {
    const put = (status: string, at: string, step = S1, journey = J) => pool.query(
      `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status) VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [CO, journey, step, EXE, at, status]);
    const today = `${kstToday()}T10:00:00+09:00`;
    const yesterday = new Date(new Date(today).getTime() - 86400_000).toISOString();
    for (const st of ['paused', 'pending']) { await put(st, today); expect(await gateOpen()).toBe(false); }
    await put('notified', yesterday); expect(await gateOpen()).toBe(false);
    await put('notified', today, S2); expect(await gateOpen()).toBe(false);
    await put('cancelled', today); expect(await gateOpen()).toBe(true);
    await pool.query(`DELETE FROM journey_pretest_schedules WHERE journey_id = $1`, [J]);
    await put('notified', today); expect(await gateOpen()).toBe(true);
  });
});

describe('2-8 묶음 상태표 · 안내 쓰기 한 꼴', () => {
  it('기록 없음 · 통과 · 적재 성공 = pending → notified · 검사 1 · 적재 1 · 시도 1 · 관문 열림', async () => {
    expect(await gateOpen()).toBe(false);
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
    expect(ctl.enqueue).toHaveLength(1);
    expect(ctl.enqueue[0]).toContain('[발송 전 안내]');
    expect((await records()).map((r) => [r.status, Number(r.notice_attempts)])).toEqual([['notified', 1]]);
    expect(await gateOpen()).toBe(true);
  });
  it('적재 실패 = pending · 관문 닫힘 → 다음 회차 검사 0 · 안내만(시도 2) → 성공', async () => {
    ctl.enqueueResult = 0;
    await scanAndPretest();
    expect((await records()).map((r) => [r.status, Number(r.notice_attempts)])).toEqual([['pending', 1]]);
    expect(await gateOpen()).toBe(false);
    ctl.enqueueResult = 1;
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
    expect(ctl.enqueue).toHaveLength(2);
    expect((await records()).map((r) => [r.status, Number(r.notice_attempts)])).toEqual([['notified', 2]]);
    expect(await gateOpen()).toBe(true);
  });
  it('적재 성공 · 기록(③) 실패를 재시작을 끼워 되풀이 = 적재 총 3 · 넷째 = 적재 0 · notified + 경보', async () => {
    ctl.failFinalize = true;
    await scanAndPretest();
    await scanAndPretest();
    resetPretestScanMemory(true);   // 재시작(메모리 셈 0)
    await scanAndPretest();
    expect(ctl.enqueue).toHaveLength(3);
    expect(await gateOpen()).toBe(false);
    ctl.failFinalize = false;
    await scanAndPretest();
    expect(ctl.enqueue).toHaveLength(3);
    expect((await records()).map((r) => [r.status, Number(r.notice_attempts)])).toEqual([['notified', 3]]);
    expect(ctl.alerts).toContain(`journey-pretest-notice-giveup:${J}`);
    expect(ctl.spamCalls).toBe(1);
  });
  it('기록(③) 실패를 재시작 없이 네 회차 → 복구 = 묶음 멈춤 0 · 적재 3 · notified · 관문 열림(Codex 구현 1R ②)', async () => {
    ctl.failFinalize = true;
    for (let i = 0; i < 4; i++) await scanAndPretest();
    expect(ctl.enqueue).toHaveLength(3);
    expect(await gateOpen()).toBe(false);
    ctl.failFinalize = false;
    await scanAndPretest();
    expect((await records()).map((r) => [r.status, Number(r.notice_attempts)])).toEqual([['notified', 3]]);
    expect(await gateOpen()).toBe(true);
    expect(ctl.spamCalls).toBe(1);
    expect(ctl.alerts).not.toContain(`journey-pretest-bundle-error:${J}`);
  });
  it('유료 검사 뒤 예외는 그대로 센다 = 검사 3 회차 뒤 그날 멈춤 · 경보', async () => {
    ctl.onSpamTest = async () => { throw new Error('주입: 검사 중 예외'); };
    for (let i = 0; i < 4; i++) await scanAndPretest();
    expect(ctl.spamCalls).toBe(3);
    expect(ctl.alerts).toContain(`journey-pretest-bundle-error:${J}`);
  });
  it('적재 중 칸 수정 경로의 DELETE = 기다리지 않음 · 옛 ③ 0행 → 다음 회차 새 행(시도 0 부터)', async () => {
    let oldId = '';
    ctl.onEnqueue = async () => {
      oldId = String((await records())[0].id);
      await pool.query(`DELETE FROM journey_pretest_schedules WHERE journey_id = $1::uuid AND step_id = $2::uuid`, [J, S1]);
    };
    await scanAndPretest();
    expect(await records()).toEqual([]);
    ctl.onEnqueue = null;
    ctl.enqueueResult = 0;
    await scanAndPretest();
    const now = await records();
    expect(now.map((r) => [r.status, Number(r.notice_attempts)])).toEqual([['pending', 1]]);
    const old = await pool.query(`UPDATE journey_pretest_schedules SET status = 'notified' WHERE id = $1::uuid AND status = 'pending' RETURNING id`, [oldId]);
    expect(old.rows).toHaveLength(0);
    expect((await records())[0].status).toBe('pending');
  });
  it('옛 판 결과 버림: 검사 도중 새 스냅숏(수정) = 쓰기 0 → 다음 회차 새 판 검사 · 안내 실패 = 관문 닫힘 → 안내만 다시', async () => {
    const NEWSNAP = '00000000-0000-0000-0000-00000000b032';
    ctl.onSpamTest = async () => {
      ctl.onSpamTest = null;
      await insertMinimalRow(pool, 'journey_step_snapshots', { id: NEWSNAP, journey_id: J, step_id: S1, message_body: '고친 문안', confidence_score: 0 });
    };
    await scanAndPretest();
    expect(await records()).toEqual([]);
    expect(Number((await pool.query(`SELECT confidence_score FROM journey_step_snapshots WHERE id = $1`, [NEWSNAP])).rows[0].confidence_score)).toBe(0);
    ctl.enqueueResult = 0;
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(2);
    expect(Number((await pool.query(`SELECT confidence_score FROM journey_step_snapshots WHERE id = $1`, [NEWSNAP])).rows[0].confidence_score)).toBe(100);
    expect(await gateOpen()).toBe(false);
    ctl.enqueueResult = 1;
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(2);
    expect((await records()).map((r) => [r.status, Number(r.notice_attempts)])).toEqual([['notified', 2]]);
    await pool.query(`DELETE FROM journey_step_snapshots WHERE id = $1`, [NEWSNAP]);
  });
  it('pending 인데 그사이 알림을 끔 = 안내 필요를 다시 판단 · 적재 0 · notified(Codex 설계 2R ②)', async () => {
    ctl.enqueueResult = 0;
    await scanAndPretest();
    expect((await records()).map((r) => r.status)).toEqual(['pending']);
    await pool.query(`UPDATE journey_steps SET notify_manager_on_pretest = false WHERE id = $1`, [S1]);
    ctl.enqueue = [];
    await scanAndPretest();
    expect(ctl.enqueue).toHaveLength(0);
    expect((await records()).map((r) => r.status)).toEqual(['notified']);
    expect(await gateOpen()).toBe(true);
    await pool.query(`UPDATE journey_steps SET notify_manager_on_pretest = true WHERE id = $1`, [S1]);
  });
  it('DDL-2 칸 없음(캐시 거짓) = 안내 시도 0 · notified · 경보', async () => {
    resetPretestScanMemory(false);
    await scanAndPretest();
    expect(ctl.enqueue).toHaveLength(0);
    expect((await records()).map((r) => r.status)).toEqual(['notified']);
    expect(ctl.alerts).toContain('journey-pretest-notice-attempts-ddl');
  });
});

describe('문안 수정 원자성(2-8 · Codex 설계 7R)', () => {
  it('기록 DELETE 가 실패하면 문안 · 스냅숏도 저장되지 않는다 · 성공하면 같은 트랜잭션에서 기록이 지워진다', async () => {
    await pool.query(`INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status) VALUES ($1, $2, $3, $4, NOW(), NOW(), 'notified')`, [CO, J, S1, EXE]);
    await pool.query(`CREATE OR REPLACE FUNCTION t1031_block() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'block'; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER t1031_block BEFORE DELETE ON journey_pretest_schedules FOR EACH ROW EXECUTE FUNCTION t1031_block()`);
    const snapsBefore = Number((await pool.query(`SELECT COUNT(*) FROM journey_step_snapshots WHERE step_id = $1`, [S1])).rows[0].count);
    await expect(updateJourneyStep(CO, J, S1, { messageTemplate: '바뀐 문안', allowActiveMessageEdit: true } as any)).rejects.toThrow();
    expect((await pool.query(`SELECT message_template FROM journey_steps WHERE id = $1`, [S1])).rows[0].message_template).toBe('첫 문안');
    expect(Number((await pool.query(`SELECT COUNT(*) FROM journey_step_snapshots WHERE step_id = $1`, [S1])).rows[0].count)).toBe(snapsBefore);
    await pool.query(`DROP TRIGGER t1031_block ON journey_pretest_schedules`);
    expect(await updateJourneyStep(CO, J, S1, { messageTemplate: '바뀐 문안', allowActiveMessageEdit: true } as any)).toBe(true);
    expect(await records()).toEqual([]);
    const latest = (await pool.query(`SELECT message_body, confidence_score FROM journey_step_snapshots WHERE step_id = $1 ORDER BY created_at DESC LIMIT 1`, [S1])).rows[0];
    expect(Number(latest.confidence_score)).toBe(0);
    await pool.query(`DELETE FROM journey_step_snapshots WHERE step_id = $1 AND id <> $2`, [S1, SNAP]);
    await pool.query(`UPDATE journey_steps SET message_template = '첫 문안' WHERE id = $1`, [S1]);
  });
});

describe('2-3 날짜 기준 · 다시 켜기', () => {
  it('처리함 = 그 여정 · 칸 · 날의 dispatch 행 · 다른 날만 있으면 아님', async () => {
    await pool.query(`INSERT INTO journey_anchor_dispatch (journey_id, step_id, customer_id, send_date) VALUES ($1, $2, $3, '2026-10-30')`, [J, S1, CUST]);
    expect(await anchorStepDispatched(J, S1, '2026-10-30')).toBe(true);
    expect(await anchorStepDispatched(J, S1, '2026-10-31')).toBe(false);
    expect(await anchorStepDispatched(J, S2, '2026-10-30')).toBe(false);
    await pool.query(`DELETE FROM journey_anchor_dispatch WHERE journey_id = $1`, [J]);
  });
  it('날짜 기준 여정 다시 켜기 = 지난 날 실행 ended · 오늘 실행 그대로 · 이벤트 여정은 손대지 않음', async () => {
    const AJ = '00000000-0000-0000-0000-00000000e032';
    const AS = '00000000-0000-0000-0000-00000000f033';
    const OLD = '00000000-0000-0000-0000-000000009032';
    const TODAY = '00000000-0000-0000-0000-000000009033';
    const C2 = '00000000-0000-0000-0000-00000000d032';
    await insertMinimalRow(pool, 'customers', { id: C2, company_id: CO, phone: '01000009998' });
    await insertMinimalRow(pool, 'journeys', { id: AJ, company_id: CO, created_by: OWNER, name: '날짜 여정', status: 'paused', start_kind: 'date_anchor', trigger_event: 'customer.created', callback_number: '0212345678' });
    await insertMinimalRow(pool, 'journey_steps', { id: AS, journey_id: AJ, step_order: 1, step_type: 'message', channel: 'lms', message_template: 'x' });
    await insertMinimalRow(pool, 'journey_executions', { id: OLD, journey_id: AJ, customer_id: CUST, current_step_order: 0, status: 'active' });
    await insertMinimalRow(pool, 'journey_executions', { id: TODAY, journey_id: AJ, customer_id: C2, current_step_order: 0, status: 'active' });
    await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [OLD]);
    await pool.query(`UPDATE journey_executions SET next_run_at = date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' + INTERVAL '23 hours' WHERE id = $1`, [TODAY]);
    const r = await applyResumeAdjustments(pool, AJ, { status: 'paused', pausedRaw: null, startKind: 'date_anchor' }, new Date().toISOString());
    expect(r.staleEnded).toBe(1);
    const st = (await pool.query(`SELECT id, status FROM journey_executions WHERE journey_id = $1 ORDER BY id`, [AJ])).rows.map((x) => [x.id, x.status]);
    expect(st).toEqual([[OLD, 'ended'], [TODAY, 'active']]);
    await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [EXE]);
    const ev = await applyResumeAdjustments(pool, J, { status: 'paused', pausedRaw: null, startKind: 'event' }, new Date().toISOString());
    expect(ev.staleEnded).toBe(0);
    expect((await pool.query(`SELECT status FROM journey_executions WHERE id = $1`, [EXE])).rows[0].status).toBe('active');
  });
});

describe('2-6 결과 안내 = 칸 · 날짜 · DDL-1 기준선', () => {
  const CAMP_OLD = '00000000-0000-0000-0000-00000000c131';
  const CAMP_NEW = '00000000-0000-0000-0000-00000000c132';
  it('칸 없음 = 건너뜀 → DDL-1 기준선 = 있던 행 「이미 알림」 · 새 행 = 첫 안내 1통 · 다시 = 0 · 오늘 더 보냄 = 하루가 닫힐 때까지 기다림', async () => {
    await pool.query(`UPDATE journey_executions SET status = 'completed' WHERE id = $1`, [EXE]);
    resetResultNoticeColumnsCache(false);
    await notifyJourneyStepResults();
    expect(ctl.enqueue).toHaveLength(0);

    await insertMinimalRow(pool, 'campaigns', { id: CAMP_OLD, company_id: CO, message_type: 'LMS', status: 'sending', sent_count: 18 });
    await pool.query(`INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id) VALUES ($1, $2, $3::date, $4)`, [J, S1, kstToday(), CAMP_OLD]);
    await runLedgerBlock('C84-DDL-1');
    const base = (await pool.query(`SELECT result_notice_sent, result_notice_at IS NOT NULL AS at, result_notice_attempts FROM journey_step_campaigns WHERE campaign_id = $1`, [CAMP_OLD])).rows[0];
    expect([Number(base.result_notice_sent), base.at, Number(base.result_notice_attempts)]).toEqual([18, true, 0]);

    await insertMinimalRow(pool, 'campaigns', { id: CAMP_NEW, company_id: CO, message_type: 'LMS', status: 'sending', sent_count: 5 });
    await pool.query(`INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id) VALUES ($1, $2, $3::date, $4)`, [J, S2, kstToday(), CAMP_NEW]);
    await pool.query(`UPDATE journey_steps SET notify_manager_on_pretest = true WHERE id = $1`, [S2]);
    ctl.counts.set(CAMP_NEW, { success: 5, fail: 0, pending: 0 });
    resetResultNoticeColumnsCache(true);
    await notifyJourneyStepResults();
    expect(ctl.enqueue).toHaveLength(1);
    expect(ctl.enqueue[0]).toContain('보낸 수: 5건');
    expect(ctl.enqueue[0]).toContain('step 2 / 2 (최종)');
    const after = (await pool.query(`SELECT result_notice_sent, result_notice_attempts FROM journey_step_campaigns WHERE campaign_id = $1`, [CAMP_NEW])).rows[0];
    expect([Number(after.result_notice_sent), Number(after.result_notice_attempts)]).toEqual([5, 0]);
    await notifyJourneyStepResults();
    expect(ctl.enqueue).toHaveLength(1);
    await pool.query(`UPDATE campaigns SET sent_count = 7 WHERE id = $1`, [CAMP_NEW]);
    await notifyJourneyStepResults();
    expect(ctl.enqueue).toHaveLength(1);
  });
  it('적재 실패를 되풀이 = 시도 3 까지 · 넷째 = 보내지 않고 기록 + 경보', async () => {
    const CAMP = '00000000-0000-0000-0000-00000000c133';
    const S3 = '00000000-0000-0000-0000-00000000f034';
    await insertMinimalRow(pool, 'journey_steps', { id: S3, journey_id: J, step_order: 3, step_type: 'message', channel: 'lms', message_template: 'x', notify_manager_on_pretest: true });
    await insertMinimalRow(pool, 'campaigns', { id: CAMP, company_id: CO, message_type: 'LMS', status: 'sending', sent_count: 2 });
    await pool.query(`INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id) VALUES ($1, $2, $3::date, $4)`, [J, S3, kstToday(), CAMP]);
    ctl.counts.set(CAMP, { success: 2, fail: 0, pending: 0 });
    ctl.enqueueResult = 0;
    for (let i = 0; i < 4; i++) await notifyJourneyStepResults();
    expect(ctl.enqueue).toHaveLength(3);
    const row = (await pool.query(`SELECT result_notice_sent, result_notice_attempts FROM journey_step_campaigns WHERE campaign_id = $1`, [CAMP])).rows[0];
    expect([Number(row.result_notice_sent), Number(row.result_notice_attempts)]).toEqual([2, 0]);
    expect(ctl.alerts).toContain(`journey-result-notice-giveup:${J}`);
  });
});

describe('2-6 결과 안내 후보 = 커서로 끝까지 돈다 · 기다리는 행이 앞자리를 독차지하지 않음(Codex 구현 1R ④ · 2R ①)', () => {
  const J2 = '00000000-0000-0000-0000-00000000e033';
  // 준비된 행이 PK 순 맨 뒤에 오게(같은 날 · 같은 여정 · 칸 id 가 가장 큼)
  const TS = 'ffffffff-ffff-ffff-ffff-fffffffff040';
  const CW = '00000000-0000-0000-0000-00000000c140';
  const CR = '00000000-0000-0000-0000-00000000c141';
  const WAITING = 2 * RESULT_NOTICE_SCAN_LIMIT;
  const readyCount = () => ctl.enqueue.filter((b) => b.includes('보낸 수: 3건')).length;
  beforeAll(async () => {
    await insertMinimalRow(pool, 'journeys', { id: J2, company_id: CO, created_by: OWNER, name: '굶김 시험', status: 'active', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
    await insertMinimalRow(pool, 'journey_steps', { id: TS, journey_id: J2, step_order: 1, step_type: 'message', channel: 'lms', message_template: 'x', notify_manager_on_pretest: true });
    await pool.query(
      `INSERT INTO journey_steps
       SELECT (jsonb_populate_record(NULL::journey_steps, to_jsonb(t) || jsonb_build_object('id', gen_random_uuid(), 'step_order', 1 + g))).*
         FROM journey_steps t, generate_series(1, ${WAITING}) g WHERE t.id = $1`, [TS]);
    await insertMinimalRow(pool, 'campaigns', { id: CW, company_id: CO, message_type: 'LMS', status: 'sending', sent_count: 10 });
    await insertMinimalRow(pool, 'campaigns', { id: CR, company_id: CO, message_type: 'LMS', status: 'sending', sent_count: 3 });
    await pool.query(
      `INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id)
       SELECT $1, s.id, $2::date, $3 FROM journey_steps s WHERE s.journey_id = $1 AND s.id <> $4`, [J2, kstToday(), CW, TS]);
    await pool.query(`INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id) VALUES ($1, $2, $3::date, $4)`, [J2, TS, kstToday(), CR]);
  });
  it(`결과 대기(집계 대기 > 0) 행 ${WAITING} + 준비 1(맨 뒤) = 첫 회차 0 · 셋째 회차까지 1통 · 그 뒤 다시 0`, async () => {
    resetResultNoticeColumnsCache(true);
    ctl.counts.set(CW, { success: 9, fail: 0, pending: 1 });
    ctl.counts.set(CR, { success: 3, fail: 0, pending: 0 });
    await notifyJourneyStepResults();
    expect(readyCount()).toBe(0);
    await notifyJourneyStepResults();
    await notifyJourneyStepResults();
    expect(readyCount()).toBe(1);
    for (let i = 0; i < 3; i++) await notifyJourneyStepResults();
    expect(readyCount()).toBe(1);
    expect(ctl.enqueue).toHaveLength(1);
  });
});
