// replaces: none
/**
 * 여정 칸 관문 · 담당자 안내 — 실 PostgreSQL 판(★ 2026-10-31 · 설계서 docs/2026-10-31-journey-step-gate-notice-design.md §5-2)
 *
 * 운영 문장을 글자 그대로 돌린다. 바깥(스팸 검사 · MySQL 적재 · 결과 집계 · 운영 경보)만 시험이 쥔다.
 * 새 칸(원장 C84-DDL-1 · C93-DDL-3)은 이 파일의 사본에 원장 블록을 그대로 실행해 만든다(원장 SQL 도 함께 검증).
 * ★ 2026-11-02 엔진 재설계 E3(docs/2026-11-01-journey-automarketing-engine-design.md) — 옛 「그날 검사 기록 관문 · 통과 안내 · 안내 시도」를 뒤집었다:
 *   관문 = 지금 판의 가장 최근 결정이 보류일 때만(stepHeldSql) · 스캔 = ① 고친 글 ② 통과한 글 7일 재검사 ③ 7일 지난 보류 재검사(4번) · 오늘 시도 6번 상한.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const ctl = vi.hoisted(() => ({
  verdict: 'pass' as 'pass' | 'blocked' | 'error',
  enqueue: [] as string[],
  enqueueResult: 1 as number,
  onSpamTest: null as null | (() => Promise<void>),
  spamCalls: 0,
  alerts: [] as string[],
  counts: new Map<string, { success: number; fail: number; pending: number }>(),
  spam: new Map<string, number>(),
  spamThrow: false,
  /** 다음 적재 한 번에 끼우는 일(앞 안내를 보내는 사이 바뀌는 상태 · Codex 구현 2R) */
  onEnqueue: null as null | (() => Promise<void>),
}));

vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  return { ...real, withBoundedMysql: async (_ms: number, work: any) => work(async () => []) };
});
vi.mock('../sms-queue', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getAuthSmsTable: async () => 'SMSQ_TEST',
    bulkInsertSmsQueue: async (_t: string[], rows: any[][]) => {
      ctl.enqueue.push(String(rows[0][2]));
      const f = ctl.onEnqueue;
      ctl.onEnqueue = null;
      if (f) await f();
      return ctl.enqueueResult;
    },
    getCompanySmsTablesWithLogs: async () => ['SMSQ_TEST'],
    smsCampaignCountsSafe: async (_t: string[], ids: string[]) => new Map(ids.filter((id) => ctl.counts.has(String(id))).map((id) => [String(id), ctl.counts.get(String(id))!])),
    smsCampaignSpamCountsSafe: async (_t: string[], ids: string[]) => {
      if (ctl.spamThrow) throw new Error('주입: 스팸 수 읽기 실패');
      return new Map(ids.map((id) => [String(id), ctl.spam.get(String(id)) ?? 0]));
    },
  };
});
vi.mock('../journey-pretest-validator', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    runStepSpamTest: async () => {
      ctl.spamCalls++;
      if (ctl.onSpamTest) await ctl.onSpamTest();
      const v = ctl.verdict;
      return { verdict: v, ok: v === 'pass', enqueueOk: true, failedCarriers: [], matchedStopWords: [], score: v === 'pass' ? 100 : 0, error: v === 'error' ? '주입: 검사 장애' : undefined };
    },
  };
});
vi.mock('../system-alert', () => ({
  sendSystemAlert: async (p: any) => { ctl.alerts.push(String(p.dedupKey)); return 1; },
  // ★ 1102 설계서 docs/2026-11-01-credit-control-tower-design.md §17-4 C1 — 묶음 예외 상한 = 경보 CT 모아 보내기 · 항목 = 묶음 키(여정:칸:날짜)
  alertPassFailures: async (o: any) => { for (const f of o.failures) ctl.alerts.push(`${o.pass}:${f.key}`); return 1; },
}));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import {
  scanAndPretest, stepHeldSql, resetPretestScanMemory,
  PRETEST_ERROR_DAILY_MAX, PRETEST_HELD_RECHECK_MAX,
} from '../journey-pretest-notifier';
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
const NEWSNAP = '00000000-0000-0000-0000-00000000b032';
const OLDSNAP = '00000000-0000-0000-0000-00000000b033';
const EXE = '00000000-0000-0000-0000-000000009031';

const runLedgerBlock = async (id: string) => { await pool.query(ledgerBlockSql(id)); };
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const records = async () => (await pool.query(
  `SELECT id, status, snapshot_id FROM journey_pretest_schedules WHERE journey_id = $1 AND step_id = $2 AND status <> 'seen' ORDER BY notify_at DESC, id DESC`, [J, S1],
)).rows;
const statuses = async () => (await records()).map((r) => String(r.status));
/** 결정 · 시도 기록 하나(ago = 얼마 전) */
const put = (status: string, snapshotId: string | null, ago: string, step = S1) => pool.query(
  `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status, snapshot_id, notice_sent_at)
   VALUES ($1, $2, $3, $4, NOW(), NOW() - $5::interval, $6, $7, NOW())`,   // 지난 기록 = 안내는 이미 보냄(안내 원장 마감)
  [CO, J, step, EXE, ago, status, snapshotId]);
const held = async (step = S1) => (await pool.query(`SELECT ${stepHeldSql('$1::uuid', '$2::uuid')} AS h`, [J, step])).rows[0].h as boolean;
const confidence = async (id = SNAP) => Number((await pool.query(`SELECT confidence_score FROM journey_step_snapshots WHERE id = $1`, [id])).rows[0].confidence_score);
const setConfidence = (n: number, id = SNAP) => pool.query(`UPDATE journey_step_snapshots SET confidence_score = $2 WHERE id = $1`, [id, n]);
const ageRecords = (by: string) => pool.query(`UPDATE journey_pretest_schedules SET notify_at = notify_at - $2::interval WHERE journey_id = $1`, [J, by]);
/** 지연 기다림의 시작(seen)을 앞당긴다 */
const ageSeen = (by: string) => pool.query(`UPDATE journey_pretest_schedules SET notify_at = notify_at - $2::interval WHERE journey_id = $1 AND status = 'seen'`, [J, by]);

beforeAll(async () => {
  await runLedgerBlock('C93-DDL-3');
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
  await pool.query(`DELETE FROM journey_step_snapshots WHERE step_id = $1 AND id <> $2`, [S1, SNAP]);
  await pool.query(`DELETE FROM journey_step_snapshots WHERE step_id = $1`, [S2]);
  await pool.query(`UPDATE journey_step_snapshots SET confidence_score = 100, created_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [SNAP]);
  await pool.query(`DELETE FROM spam_filter_tests WHERE company_id = $1`, [CO]);
  await pool.query(`UPDATE journey_executions SET status = 'active', current_step_order = 0, next_run_at = NOW() + INTERVAL '10 minutes' WHERE id = $1`, [EXE]);
  await pool.query(`UPDATE journeys SET status = 'active' WHERE id = $1`, [J]);
  resetPretestScanMemory(true);
  Object.assign(ctl, { verdict: 'pass', enqueue: [], enqueueResult: 1, onSpamTest: null, spamCalls: 0, alerts: [], spamThrow: false, onEnqueue: null });
});

describe('E3-1 보류 판정 조각 = 지금 판의 가장 최근 결정(stepHeldSql)', () => {
  it('보류 = 참 · 시도 기록(error · late)은 결정이 아님 · 다른 칸 · 그 뒤 통과 · 옛 판 보류 · 옛 paused = 거짓', async () => {
    expect(await held()).toBe(false);
    await put('held', SNAP, '3 hours');
    expect(await held()).toBe(true);
    await put('error', SNAP, '2 hours');
    await put('late', SNAP, '1 hour');
    expect(await held()).toBe(true);
    expect(await held(S2)).toBe(false);
    await put('notified', SNAP, '50 minutes');
    expect(await held()).toBe(false);
    await put('held', OLDSNAP, '40 minutes');
    expect(await held()).toBe(false);
    await put('held', SNAP, '30 minutes');
    expect(await held()).toBe(true);
    await put('paused', SNAP, '20 minutes');
    expect(await held()).toBe(false);
  });
});

describe('E3-2 스캔 고르기 · E3-3 결과표(실 PG · 운영 문장 그대로)', () => {
  // ★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-9 — 통과한 글의 7일 정기 재검사 갈래를 지웠다(주간 회사 묶음 검사가 켜진 문자 칸 판 전부를 본다 · 검사 두 벌 0)
  it('통과한 글 · 결정 없음 = 보내기 전 스캔 검사 0(주간 묶음 검사 몫) · 고친 글 = 검사 1 · 통과 = notified(판 id) · 담당자 문자 0 · 다시 = 0', async () => {
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(0);
    await setConfidence(0);
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
    expect(ctl.enqueue).toHaveLength(0);
    expect((await records()).map((r) => [r.status, r.snapshot_id])).toEqual([['notified', SNAP]]);
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
  });
  it('통과한 글 = 마지막 결정이 8일 전이어도 보내기 전 스캔 검사 0(7일 정기 재검사 없앰 · 3-9)', async () => {
    await put('notified', SNAP, '8 days');
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(0);
  });
  it('검사 큐 5건 이상 = 통과한 글 정기 재검사 0 · 고친 글(표식 < 100)은 그대로 검사 → 통과 = 표식 100', async () => {
    for (let i = 0; i < 5; i++) {
      await insertMinimalRow(pool, 'spam_filter_tests', { company_id: CO, user_id: OWNER, callback_number: '0212345678', status: 'queued' });
    }
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(0);
    await setConfidence(0);
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
    expect(await statuses()).toEqual(['notified']);
    expect(await confidence()).toBe(100);
  });
  it(`고친 글 막힘 = 그 판 보류 + 안내 1 · 여정 멈춤 0 · 다음 회차 0 · 7일 지난 보류 = 재검사 · 또 막힘 = 보류 기록만 · ${PRETEST_HELD_RECHECK_MAX}번 뒤 재검사 0`, async () => {
    await setConfidence(0);
    ctl.verdict = 'blocked';
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
    expect(await statuses()).toEqual(['held']);
    expect(ctl.enqueue).toHaveLength(1);
    expect(ctl.enqueue[0]).toContain('[발송 보류 안내]');
    expect(await held()).toBe(true);
    expect((await pool.query(`SELECT status FROM journeys WHERE id = $1`, [J])).rows[0].status).toBe('active');
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
    for (let i = 0; i < PRETEST_HELD_RECHECK_MAX + 1; i++) {
      await ageRecords('8 days');
      await scanAndPretest();
    }
    expect(ctl.spamCalls).toBe(PRETEST_HELD_RECHECK_MAX);
    expect(await statuses()).toEqual(Array(PRETEST_HELD_RECHECK_MAX).fill('held'));
    expect(ctl.enqueue).toHaveLength(1);
    expect(await held()).toBe(true);
  });
  it('보류 재검사 통과 = notified · 표식 100 · 관문 열림 · 안내 0', async () => {
    await setConfidence(0);
    await put('held', SNAP, '8 days');
    expect(await held()).toBe(true);
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
    expect((await statuses())[0]).toBe('notified');
    expect(await confidence()).toBe(100);
    expect(await held()).toBe(false);
    expect(ctl.enqueue).toHaveLength(0);
  });
  it('판이 바뀌면 옛 판 보류는 관문을 막지 않는다 · 새 판 = 검사 → 통과', async () => {
    await put('held', SNAP, '1 hour');
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: NEWSNAP, journey_id: J, step_id: S1, message_body: '고친 문안', confidence_score: 0 });
    expect(await held()).toBe(false);
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
    expect((await records())[0]).toMatchObject({ status: 'notified', snapshot_id: NEWSNAP });
    expect(await confidence(NEWSNAP)).toBe(100);
  });
  it('검사 도중 새 판(수정) = 옛 판 결과 버림(쓰기 0) → 다음 회차 새 판 검사', async () => {
    await setConfidence(0);   // 고친 글(검사 대상 · 통과한 글은 이 스캔이 고르지 않는다)
    ctl.onSpamTest = async () => {
      ctl.onSpamTest = null;
      await insertMinimalRow(pool, 'journey_step_snapshots', { id: NEWSNAP, journey_id: J, step_id: S1, message_body: '고친 문안', confidence_score: 0 });
    };
    await scanAndPretest();
    expect(await records()).toEqual([]);
    expect(await confidence(NEWSNAP)).toBe(0);
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(2);
    expect((await records())[0]).toMatchObject({ status: 'notified', snapshot_id: NEWSNAP });
    expect(await confidence(NEWSNAP)).toBe(100);
  });
  it(`고친 글 검사 장애 = 시도 기록(판) · 보류 아님 · 오늘 ${PRETEST_ERROR_DAILY_MAX}번이면 스캔이 뺀다 · 2시간 넘은 판 = 지연 안내 한 번`, async () => {
    await pool.query(`UPDATE journey_step_snapshots SET confidence_score = 0, created_at = NOW() - INTERVAL '3 hours' WHERE id = $1`, [SNAP]);
    ctl.verdict = 'error';
    await scanAndPretest();
    expect(ctl.enqueue).toHaveLength(0);   // 처음 본 지금부터 잰다(판 생성 3시간 전 = 지연 아님)
    await ageSeen('3 hours');
    for (let i = 0; i < PRETEST_ERROR_DAILY_MAX + 1; i++) await scanAndPretest();
    expect(ctl.spamCalls).toBe(PRETEST_ERROR_DAILY_MAX);
    const st = await statuses();
    expect(st.filter((s) => s === 'error')).toHaveLength(PRETEST_ERROR_DAILY_MAX);
    expect(st.filter((s) => s === 'late')).toHaveLength(1);
    expect(ctl.enqueue).toHaveLength(1);
    expect(ctl.enqueue[0]).toContain('[검사 지연 안내]');
    expect(ctl.alerts).toContain('journey-pretest-new-copy-late');
    expect(await held()).toBe(false);
    expect(await confidence()).toBe(0);
  });
  it('옛 「통과 · 안내 전」(pending) = 문자 없이 notified · 7일 안이라 검사 0', async () => {
    await put('pending', null, '1 hour');
    await scanAndPretest();
    expect(await statuses()).toEqual(['notified']);
    expect(ctl.enqueue).toHaveLength(0);
    expect(ctl.spamCalls).toBe(0);
  });
  it('★ Codex 구현 1R(R14) 보류 안내 적재 실패 = 원장에 남아 다음 회차에 다시(보류 기록은 한 번) · 3번 다 실패 = 운영 경보', async () => {
    await setConfidence(0);
    ctl.verdict = 'blocked';
    ctl.enqueueResult = 0;
    await scanAndPretest();
    expect(await statuses()).toEqual(['held']);
    const att = async () => (await pool.query(`SELECT notice_attempts, notice_sent_at IS NOT NULL AS sent FROM journey_pretest_schedules WHERE journey_id = $1 AND status = 'held'`, [J])).rows[0];
    expect(await att()).toMatchObject({ notice_attempts: 1, sent: false });
    ctl.enqueueResult = 1;
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
    expect(await att()).toMatchObject({ notice_attempts: 2, sent: true });
    expect(ctl.enqueue.filter((b) => b.includes('[발송 보류 안내]'))).toHaveLength(2);   // 첫 시도(적재 0 · 큐에 안 들어감 · 가짜가 본문만 받음) + 둘째 성공
    await scanAndPretest();
    expect(ctl.enqueue.filter((b) => b.includes('[발송 보류 안내]'))).toHaveLength(2);
    // 3번 다 실패
    await pool.query(`DELETE FROM journey_pretest_schedules WHERE journey_id = $1`, [J]);
    ctl.enqueueResult = 0;
    for (let i = 0; i < 4; i++) await scanAndPretest();
    expect(await att()).toMatchObject({ notice_attempts: 3, sent: false });
    expect(ctl.alerts).toContain(`journey-pretest-notice-giveup:${J}`);
  });
  it('★ Codex 구현 1R(R14) 검사 시도 상한(하루 6번)에 먼저 닿아도 2시간 넘은 새 글 = 지연 안내 한 번(검사 0 회 더)', async () => {
    await pool.query(`UPDATE journey_step_snapshots SET confidence_score = 0, created_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [SNAP]);
    ctl.verdict = 'error';
    for (let i = 0; i < PRETEST_ERROR_DAILY_MAX + 1; i++) await scanAndPretest();
    expect(ctl.spamCalls).toBe(PRETEST_ERROR_DAILY_MAX);
    expect(ctl.enqueue).toHaveLength(0);
    await ageSeen('3 hours');
    await scanAndPretest();
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(PRETEST_ERROR_DAILY_MAX);
    expect(ctl.enqueue.filter((b) => b.startsWith('[검사 지연 안내]'))).toHaveLength(1);
    expect((await statuses()).filter((s) => s === 'late')).toHaveLength(1);
  });
  it('★ Codex 구현 2R(R12) 앞 칸 안내를 보내는 사이 뒤 칸의 판이 바뀜 = 뒤 칸은 보내지 않고 마감(시도 0 · 옛 글 안내 0)', async () => {
    const SNAP2 = '00000000-0000-0000-0000-00000000b034';
    const SNAP2B = '00000000-0000-0000-0000-00000000b035';
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: SNAP2, journey_id: J, step_id: S2, message_body: '두 번째 옛 글', confidence_score: 0 });
    const heldPending = (step: string, snap: string, ago: string) => pool.query(
      `INSERT INTO journey_pretest_schedules (company_id, journey_id, step_id, execution_id, scheduled_send_at, notify_at, status, snapshot_id)
       VALUES ($1, $2, $3, $4, NOW(), NOW() - $5::interval, 'held', $6)`, [CO, J, step, EXE, ago, snap]);
    await heldPending(S1, SNAP, '2 minutes');
    await heldPending(S2, SNAP2, '1 minute');
    ctl.onEnqueue = async () => {
      await insertMinimalRow(pool, 'journey_step_snapshots', { id: SNAP2B, journey_id: J, step_id: S2, message_body: '두 번째 새 글', confidence_score: 100 });
    };
    await scanAndPretest();
    expect(ctl.enqueue.filter((b) => b.includes('[발송 보류 안내]'))).toHaveLength(1);
    expect(ctl.enqueue.some((b) => b.includes('두 번째 옛 글'))).toBe(false);
    const r2 = (await pool.query(
      `SELECT notice_attempts, notice_sent_at IS NOT NULL AS closed FROM journey_pretest_schedules WHERE step_id = $1 AND status = 'held'`, [S2])).rows[0];
    expect(r2).toMatchObject({ notice_attempts: 0, closed: true });
  });
  it('유료 검사 뒤 예외는 그대로 센다 = 검사 3 회차 뒤 그날 멈춤 · 경보', async () => {
    await setConfidence(0);
    ctl.onSpamTest = async () => { throw new Error('주입: 검사 중 예외'); };
    for (let i = 0; i < 4; i++) await scanAndPretest();
    expect(ctl.spamCalls).toBe(3);
    expect(ctl.alerts.filter((k) => k.startsWith(`journey-pretest-bundle-error:${J}:`)).length).toBeGreaterThan(0);   // 항목 = 그 묶음(옛 단언 toContain 과 같은 세기)
  });
  it('DDL-3 칸 없음 = 스캔을 열지 않음(검사 0) · 운영 경보 · 칸이 생기면 다시 돈다', async () => {
    await setConfidence(0);
    await pool.query(`ALTER TABLE journey_pretest_schedules DROP COLUMN snapshot_id`);
    try {
      resetPretestScanMemory(true, false);
      await scanAndPretest();
      expect(ctl.spamCalls).toBe(0);
      expect(ctl.alerts).toContain('journey-pretest-snapshot-ddl');
    } finally {
      await runLedgerBlock('C93-DDL-3');
    }
    await scanAndPretest();
    expect(ctl.spamCalls).toBe(1);
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

describe('E3-5 실발송 스팸 차단 몰림(★ 1102 엔진 재설계)', () => {
  it('알림 끈 칸 · 몰림(20건 · 30% 이상) = 첫 단계 한 번 [여정 스팸 차단 안내] · 다시 = 0 · 몰림 아님 = 기록만', async () => {
    const S5 = '00000000-0000-0000-0000-00000000f035';
    const S6 = '00000000-0000-0000-0000-00000000f036';
    const C5 = '00000000-0000-0000-0000-00000000c135';
    const C6 = '00000000-0000-0000-0000-00000000c136';
    await pool.query(`UPDATE journey_executions SET status = 'completed' WHERE id = $1`, [EXE]);
    await insertMinimalRow(pool, 'journey_steps', { id: S5, journey_id: J, step_order: 5, step_type: 'message', channel: 'lms', message_template: 'x', notify_manager_on_pretest: false });
    await insertMinimalRow(pool, 'journey_steps', { id: S6, journey_id: J, step_order: 6, step_type: 'message', channel: 'lms', message_template: 'x', notify_manager_on_pretest: false });
    await insertMinimalRow(pool, 'campaigns', { id: C5, company_id: CO, message_type: 'LMS', status: 'sending', sent_count: 70 });
    await insertMinimalRow(pool, 'campaigns', { id: C6, company_id: CO, message_type: 'LMS', status: 'sending', sent_count: 70 });
    await pool.query(`INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id) VALUES ($1, $2, $3::date, $4), ($1, $5, $3::date, $6)`, [J, S5, kstToday(), C5, S6, C6]);
    ctl.counts.set(C5, { success: 40, fail: 30, pending: 0 });
    ctl.spam.set(C5, 25);
    ctl.counts.set(C6, { success: 60, fail: 10, pending: 0 });
    ctl.spam.set(C6, 5);
    resetResultNoticeColumnsCache(true);
    await notifyJourneyStepResults();
    await notifyJourneyStepResults();
    const surge = ctl.enqueue.filter((b) => b.startsWith('[여정 스팸 차단 안내]'));
    expect(surge).toHaveLength(1);
    expect(surge[0]).toContain('25건(36%)');
    const rec = (await pool.query(`SELECT campaign_id, result_notice_sent FROM journey_step_campaigns WHERE campaign_id = ANY($1::uuid[]) ORDER BY campaign_id`, [[C5, C6]])).rows;
    expect(rec.map((r) => Number(r.result_notice_sent))).toEqual([70, 70]);
  });
  it('★ Codex 구현 1R(R14) 알림 끈 칸 · 결과 대기가 날을 넘겨도 마감 0 → 결과가 다 들어와 몰림이면 그때 한 번', async () => {
    const S7 = '00000000-0000-0000-0000-00000000f037';
    const C7 = '00000000-0000-0000-0000-00000000c137';
    await pool.query(`UPDATE journey_executions SET status = 'completed' WHERE id = $1`, [EXE]);
    await insertMinimalRow(pool, 'journey_steps', { id: S7, journey_id: J, step_order: 7, step_type: 'message', channel: 'lms', message_template: 'x', notify_manager_on_pretest: false });
    await insertMinimalRow(pool, 'campaigns', { id: C7, company_id: CO, message_type: 'LMS', status: 'sending', sent_count: 100 });
    await pool.query(`INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id) VALUES ($1, $2, (NOW() AT TIME ZONE 'Asia/Seoul')::date - 1, $3)`, [J, S7, C7]);
    ctl.counts.set(C7, { success: 30, fail: 10, pending: 60 });
    ctl.spam.set(C7, 5);
    resetResultNoticeColumnsCache(true);
    await notifyJourneyStepResults();
    const sent = async () => (await pool.query(`SELECT result_notice_sent FROM journey_step_campaigns WHERE campaign_id = $1`, [C7])).rows[0].result_notice_sent;
    expect(await sent()).toBeNull();
    ctl.counts.set(C7, { success: 50, fail: 50, pending: 0 });
    ctl.spam.set(C7, 40);
    await notifyJourneyStepResults();
    expect(ctl.enqueue.filter((b) => b.startsWith('[여정 스팸 차단 안내]') && b.includes('40건'))).toHaveLength(1);
    expect(Number(await sent())).toBe(100);
  });
});

describe('★ Codex 구현 2R(R7) 스팸 수를 못 읽음 ≠ 0', () => {
  it('알림 끈 칸 · 결과는 다 들어왔지만 스팸 수를 못 읽음 = 마감 0 → 다음에 읽어 몰림이면 그때 한 번', async () => {
    const S8 = '00000000-0000-0000-0000-00000000f038';
    const C8 = '00000000-0000-0000-0000-00000000c138';
    await pool.query(`UPDATE journey_executions SET status = 'completed' WHERE id = $1`, [EXE]);
    await insertMinimalRow(pool, 'journey_steps', { id: S8, journey_id: J, step_order: 8, step_type: 'message', channel: 'lms', message_template: 'x', notify_manager_on_pretest: false });
    await insertMinimalRow(pool, 'campaigns', { id: C8, company_id: CO, message_type: 'LMS', status: 'completed', sent_count: 100 });
    await pool.query(`INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id) VALUES ($1, $2, (NOW() AT TIME ZONE 'Asia/Seoul')::date - 1, $3)`, [J, S8, C8]);
    ctl.counts.set(C8, { success: 50, fail: 50, pending: 0 });
    ctl.spam.set(C8, 45);
    ctl.spamThrow = true;
    resetResultNoticeColumnsCache(true);
    await notifyJourneyStepResults();
    const sent = async () => (await pool.query(`SELECT result_notice_sent FROM journey_step_campaigns WHERE campaign_id = $1`, [C8])).rows[0].result_notice_sent;
    expect(await sent()).toBeNull();
    ctl.spamThrow = false;
    await notifyJourneyStepResults();
    expect(ctl.enqueue.filter((b) => b.startsWith('[여정 스팸 차단 안내]') && b.includes('45건'))).toHaveLength(1);
    expect(Number(await sent())).toBe(100);
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
