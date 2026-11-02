// replaces: none
/**
 * 여정 멈춤 안내 · 다시 켜기 · 신규 가입 기준 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-5 · 3-6 · §7)
 *
 * 안내 패스(notifyPausedJourneys) · 다시 켜기 보정(applyResumeAdjustments) · 기준선 심기(reseedOnActivate) · 신규 가입 대상 SQL(buildJourneyTargetQuery)
 * 을 운영 문장 그대로 돌린다(켜기 트랜잭션이 부르는 그 함수들). 바깥(담당자 문자 적재 · 운영 경보)만 시험이 쥔다.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock('../sms-queue', async (orig) => ({
  ...(await orig() as any),
  getAuthSmsTable: async () => 'SMSQ_TEST',
  bulkInsertSmsQueue: async (_t: string[], rows: any[][]) => { ctl.sent.push(JSON.stringify(rows[0])); return rows.length; },
}));
vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  return { ...real, withBoundedMysql: async (_ms: number, work: any) => work(async () => []) };
});
vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1, alertPassFailures: async () => undefined }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { notifyPausedJourneys } from '../journey-pause-notice';
import { MANUAL_PAUSE_REASON } from '../journey-pause-reason';
import { REENTRY_CAP_PAUSE_REASON } from '../journey-reentry-worker';
import { applyResumeAdjustments } from '../journey-resume';
import { reseedOnActivate } from '../journey-entry-ledger';
import { selectJourneyTargetCustomerIds } from '../journey-target-extractor';

const SYSTEM_REASON = REENTRY_CAP_PAUSE_REASON(5, 2);
let seq = 0;
const phone = () => `0100000${String(1500 + seq++).padStart(4, '0')}`;

async function company(): Promise<{ co: string; owner: string }> {
  const co = randomUUID(); const owner = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: co, company_name: '멈춤 · 다시 켜기 시험' });
  await insertMinimalRow(pool, 'users', { id: owner, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: `t-1102-pr-${co.slice(0, 8)}` });
  return { co, owner };
}
async function journey(co: string, owner: string, o: { status: string; reason?: string | null; trigger?: string }): Promise<string> {
  const j = randomUUID();
  await insertMinimalRow(pool, 'journeys', { id: j, company_id: co, created_by: owner, name: '멈춤 시험 여정', status: o.status, start_kind: 'event', trigger_event: o.trigger ?? 'customer.created' });
  if (o.status === 'paused') await pool.query(`UPDATE journeys SET paused_at = NOW() - INTERVAL '1 hour', pause_reason = $2 WHERE id = $1`, [j, o.reason ?? null]);
  return j;
}
const customer = async (co: string, joinedAt: Date | null) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'customers', { id, company_id: co, phone: phone(), is_active: true, sms_opt_in: true });
  if (joinedAt) await pool.query(`UPDATE customers SET joined_at = $2 WHERE id = $1`, [id, joinedAt.toISOString()]);
  return id;
};
/** 켜기 트랜잭션이 하는 순서 그대로(잠근 옛 상태 → 기준선 → active · 다시 켜기 보정) */
async function activate(j: string, co: string): Promise<{ cursorReset: boolean }> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const prev = (await c.query(`SELECT status, paused_at::text AS paused_raw, start_kind, pause_reason, trigger_event FROM journeys WHERE id = $1 FOR UPDATE`, [j])).rows[0];
    await reseedOnActivate((t, p) => c.query(t, p), j, co, prev.trigger_event, { status: String(prev.status), pauseReason: prev.pause_reason ?? null });
    const r = await c.query(`UPDATE journeys SET status = 'active', approved_at = NOW(), paused_at = NULL, pause_reason = NULL WHERE id = $1 RETURNING approved_at`, [j]);
    const adj = await applyResumeAdjustments(c, j, { status: String(prev.status), pausedRaw: prev.paused_raw, startKind: prev.start_kind, pauseReason: prev.pause_reason }, r.rows[0].approved_at);
    await c.query('COMMIT');
    return { cursorReset: adj.cursorReset };
  } finally { c.release(); }
}
const pauseNow = (j: string, reason: string) => pool.query(`UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2 WHERE id = $1`, [j, reason]);
const targets = (co: string, j: string) => selectJourneyTargetCustomerIds(co, 'customer.created', {}, 1000, j);

beforeAll(async () => {
  for (const id of ['C98-DDL-1', 'C98-DDL-2']) await pool.query(ledgerBlockSql(id));
}, 120_000);
beforeEach(() => { ctl.sent = []; });

describe('3-5 ① 시스템 멈춤 안내(실 PG)', () => {
  it('시스템 멈춤 = 담당자 한 통 · 사람 멈춤 = 0 · 다시 돌려도 0 · 새로 멈춤(새 paused_at) = 한 통 더', async () => {
    const { co, owner } = await company();
    const sys = await journey(co, owner, { status: 'paused', reason: SYSTEM_REASON });
    const man = await journey(co, owner, { status: 'paused', reason: MANUAL_PAUSE_REASON });
    await notifyPausedJourneys();
    expect(ctl.sent).toHaveLength(1);
    expect(ctl.sent[0]).toContain('[여정 멈춤 안내]');
    const led = async (id: string) => (await pool.query(`SELECT pause_notice_for = paused_at AS done FROM journeys WHERE id = $1`, [id])).rows[0].done;
    expect(await led(sys)).toBe(true);
    expect(await led(man)).toBe(true);   // 사람 멈춤 = 안내 없이 마감
    await notifyPausedJourneys();
    expect(ctl.sent).toHaveLength(1);
    await pauseNow(sys, SYSTEM_REASON);
    await notifyPausedJourneys();
    expect(ctl.sent).toHaveLength(2);
  });
});

describe('3-5 ① 시도 수 = 지금 멈춤의 것(Codex 구현 1R)', () => {
  it('옛 멈춤에서 시도 상한까지 실패하고 마감 전에 다시 멈춤 = 새 멈춤은 안내한다(옛 시도 수를 물려받지 않는다)', async () => {
    const { co, owner } = await company();
    const j = await journey(co, owner, { status: 'paused', reason: SYSTEM_REASON });
    await pool.query(`UPDATE journeys SET pause_notice_for = paused_at, pause_notice_attempts = 3 WHERE id = $1`, [j]);   // 옛 멈춤 = 3번 실패 · 아직 마감 전
    await pauseNow(j, SYSTEM_REASON);
    const before = ctl.sent.length;
    await notifyPausedJourneys();
    expect(ctl.sent.length - before).toBe(1);
    const r = (await pool.query(`SELECT pause_notice_for = paused_at AS done, pause_notice_attempts AS n FROM journeys WHERE id = $1`, [j])).rows[0];
    expect(r).toMatchObject({ done: true, n: 0 });
  });
});

describe('3-5 ② 다시 켜기 · 3-6 신규 가입 기준(실 PG · 켜기 트랜잭션의 함수 그대로)', () => {
  it('사건 커서 = 사람 멈춤 재개만 다시 켠 시각으로 · 시스템 멈춤 재개 = 그대로(멈춘 동안 도착한 사건 72시간 안을 받는다)', async () => {
    const { co, owner } = await company();
    const at = new Date(Date.now() - 2 * 3600_000);
    for (const [reason, moved] of [[SYSTEM_REASON, false], [MANUAL_PAUSE_REASON, true]] as const) {
      const j = await journey(co, owner, { status: 'paused', reason, trigger: 'cdp.purchase' });
      await pool.query(`UPDATE journeys SET last_event_cursor = $2 WHERE id = $1`, [j, at.toISOString()]);
      expect((await activate(j, co)).cursorReset).toBe(moved);
      const cur = new Date((await pool.query(`SELECT last_event_cursor FROM journeys WHERE id = $1`, [j])).rows[0].last_event_cursor);
      expect(cur.getTime() === at.getTime()).toBe(!moved);
    }
  });

  it('시스템 멈춤 동안 가입(시각 있음) → 다시 켬 = 진입 대상 1', async () => {
    const { co, owner } = await company();
    await customer(co, null);   // 켜기 전 고객(원장)
    const j = await journey(co, owner, { status: 'draft' });
    await activate(j, co);
    await pauseNow(j, SYSTEM_REASON);
    const newbie = await customer(co, new Date());
    await activate(j, co);
    expect(await targets(co, j)).toEqual([newbie]);
  });

  it('사람 멈춤 동안 가입 → 다시 켬 = 0 · 다시 켠 뒤 늦게 적재(가입 시각 = 멈춘 동안) = 0 · 다시 켠 뒤 가입 = 1', async () => {
    const { co, owner } = await company();
    const j = await journey(co, owner, { status: 'draft' });
    await activate(j, co);
    await pauseNow(j, MANUAL_PAUSE_REASON);
    const joinedDuringPause = new Date();
    await customer(co, joinedDuringPause);
    await new Promise((r) => setTimeout(r, 30));
    await activate(j, co);
    expect(await targets(co, j)).toEqual([]);
    await customer(co, joinedDuringPause);   // 같은 날 · 다시 켠 뒤 들어온 행(가입은 멈춘 동안)
    expect(await targets(co, j)).toEqual([]);
    await new Promise((r) => setTimeout(r, 30));
    const after = await customer(co, new Date());
    expect(await targets(co, j)).toEqual([after]);
  });

  it('날짜뿐인 가입일(그날 자정 값) = 켠 날 켠 뒤 가입도 대상(날짜 단위) · 사흘보다 오래된 가입 = 0', async () => {
    const { co, owner } = await company();
    const j = await journey(co, owner, { status: 'draft' });
    await activate(j, co);
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const dateOnly = randomUUID();
    await insertMinimalRow(pool, 'customers', { id: dateOnly, company_id: co, phone: phone(), is_active: true, sms_opt_in: true });
    await pool.query(`UPDATE customers SET joined_at = $2::date WHERE id = $1`, [dateOnly, today]);   // 날짜 칸 그대로(세션 시간대 자정)
    await customer(co, new Date(Date.now() - 5 * 86_400_000));
    expect(await targets(co, j)).toEqual([dateOnly]);
  });
});
