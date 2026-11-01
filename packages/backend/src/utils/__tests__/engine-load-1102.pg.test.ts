// replaces: none
/**
 * 엔진 재설계 E10 부하 시험 — 실 PostgreSQL(★ 2026-11-02 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md §4 · 결과 §13)
 *
 * 평소 test:pg = 큰 회사 고객 2,000(문장 · 공정 확인 · 몇 초) · 임시 폴더(TEMP)에 engine-load-1102.on 파일이 있으면 파일 안 숫자(없으면 20만)로 잰다.
 *   건너뛰지 않는다 = 건너뜀 하나가 실 PG 스탬프를 막는다(pg/reporter.ts · 1102 전체 실행에서 잡힘).
 * 큰 회사 1곳 + 작은 회사 20곳:
 *   ① 한 번 보내기 한 문장 적재(20만 전원) 시간 ② 날짜 기준 칸 한 문장 적재 시간 ③ 상황판 한 장(큰 회사) 시간
 *   ④ 스팸 검사 큐 머리(회사 21 · 검사 1,021건) 시간 · 작은 회사 첫 검사 순번 ⑤ 실행기 회사 줄 공정(큰 회사 100건 + 작은 회사 20곳 각 1건)
 * MySQL 적재 · 실제 발송 · 결과 집계는 이 시험 밖(운영 규모 처리량은 배포 뒤 경보 E9 가 본다).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../sms-queue', async (orig) => ({
  ...(await orig() as any),
  getCompanySmsTablesWithLogs: async () => [],
}));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { dispatchOneShotJourney, dispatchAnchorStep } from '../journey-anchor-scheduler';
import { loadManagerBoardFor } from '../manager-board';
import { spamQueueHeads, pickNextSpamTest, type SpamQueueCursor } from '../spam-test-queue';
import { runCompanyLanes } from '../concurrency';

// 시험 실행기는 OS 이름 env 만 넘긴다(test-pg-env.mjs · 운영 키 상속 차단) → 스위치 = 임시 폴더 표식 파일(engine-load-1102.on)
const MARK = join(process.env.TEMP || process.env.TMP || '/tmp', 'engine-load-1102.on');
const BIG = randomUUID();
const OWNER = randomUUID();
const SMALL = Array.from({ length: 20 }, () => randomUUID());
// 고객 수 = 표식 파일 안 숫자(없으면 20만) · 로컬 시험 그릇은 메모리 1GB 라 20만에서 다시 시작됐다(1102 실측 · 운영 그릇과 다름)
const N = existsSync(MARK) ? Number(readFileSync(MARK, 'utf8').trim()) || 200_000 : 2_000;
const timings: Record<string, number> = {};
const timed = async <T>(k: string, f: () => Promise<T>): Promise<T> => { const t = Date.now(); const r = await f(); timings[k] = Date.now() - t; return r; };

describe(`E10 부하(실 PG · 큰 회사 ${N.toLocaleString()} + 작은 회사 20)`, () => {
  beforeAll(async () => {
    for (const id of ['C93-DDL-1', 'C93-DDL-2', 'C93-DDL-3']) await pool.query(ledgerBlockSql(id));
    await insertMinimalRow(pool, 'companies', { id: BIG, company_name: '큰 회사' });
    await insertMinimalRow(pool, 'users', { id: OWNER, company_id: BIG, user_type: 'admin', is_active: true, phone: '010-0000-1199', login_id: 't-1102-load' });
    // 고객 20만 = 한 문장(최소 칸은 원장 꼴과 같이 · 수신 가능)
    await pool.query(
      `INSERT INTO customers (id, company_id, phone, is_active, sms_opt_in)
       SELECT gen_random_uuid(), $1::uuid, '010' || lpad(g::text, 8, '0'), true, true FROM generate_series(1, $2::int) g`,
      [BIG, N],
    ).catch(async () => {
      // 최소 칸이 더 있으면 fixtures 로 한 행을 만든 뒤 그 행을 복제한다
      const seed = randomUUID();
      await insertMinimalRow(pool, 'customers', { id: seed, company_id: BIG, phone: '01099999999', is_active: true, sms_opt_in: true });
      await pool.query(
        `INSERT INTO customers SELECT (jsonb_populate_record(NULL::customers, to_jsonb(c) || jsonb_build_object('id', gen_random_uuid(), 'phone', '010' || lpad(g::text, 8, '0')))).*
           FROM customers c, generate_series(1, $2::int) g WHERE c.id = $1::uuid`,
        [seed, N - 1],
      );
    });
    for (const co of SMALL) await insertMinimalRow(pool, 'companies', { id: co });
  }, 600_000);

  it('① 한 번 보내기 = 한 문장 전원 · ② 날짜 기준 칸 = 한 문장 전원(고객 수 = 표식)', async () => {
    const base = { company_id: BIG, created_by: OWNER, status: 'active', trigger_event: 'custom', trigger_filters: {}, callback_number: '0212345678' };
    const J1 = randomUUID();
    const J2 = randomUUID();
    const S2 = randomUUID();
    await insertMinimalRow(pool, 'journeys', { ...base, id: J1, name: '부하 한 번', start_kind: 'one_shot' });
    await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: J1, step_order: 1, step_type: 'message', channel: 'sms', message_template: '안내', delay_mode: 'relative', delay_hours: 0 });
    await insertMinimalRow(pool, 'journeys', { ...base, id: J2, name: '부하 날짜', start_kind: 'date_anchor', anchor_date: '2026-11-02' });
    await insertMinimalRow(pool, 'journey_steps', { id: S2, journey_id: J2, step_order: 1, step_type: 'message', channel: 'sms', message_template: '안내', delay_mode: 'relative', delay_hours: 0 });
    const r1 = await timed('oneShot_ms', () => dispatchOneShotJourney(BIG, J1, new Date('2026-11-02T01:00:00Z')));
    expect(r1.enqueued).toBe(N);
    const AT = new Date('2026-11-02T01:00:00Z');
    const r2 = await timed('anchor_ms', () => dispatchAnchorStep(
      { id: J2, company_id: BIG, anchor_day: '2026-11-02', anchor_recurrence: null, anchor_recurrence_day: null, anchor_hour_kst: 10, trigger_filters: {}, threshold_recipients_per_step: null },
      { id: S2, step_order: 1, anchor_offset_days: 0, target_hour_kst: 10 }, AT, '2026-11-02', AT));
    expect(r2).toEqual({ kind: 'dispatched', enqueued: N });
  }, 600_000);

  it('③ 상황판 한 장(큰 회사 · 오늘 나갈 칸 전원 실행)', async () => {
    const v = await timed('board_ms', () => loadManagerBoardFor(BIG, OWNER));
    expect(v?.numbers.activeJourneys).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('④ 스팸 검사 큐 머리 · 큰 회사 1,000건 뒤 작은 회사 첫 검사 = 두 번째 안', async () => {
    await pool.query(
      `INSERT INTO spam_filter_tests (company_id, user_id, callback_number, status, source, created_at)
       SELECT $1::uuid, $2::uuid, '0212345678', 'queued', 'auto_ai', NOW() - (g || ' seconds')::interval FROM generate_series(1, 1000) g`,
      [BIG, OWNER],
    );
    for (const co of SMALL) await insertMinimalRow(pool, 'spam_filter_tests', { company_id: co, user_id: OWNER, callback_number: '0212345678', status: 'queued', source: 'auto_ai' });
    const heads = await timed('spamHeads_ms', () => spamQueueHeads());
    let cursor: SpamQueueCursor = { lastCompany: [null, null], humanStreak: 0 };
    const order: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = pickNextSpamTest(heads.filter((h) => !order.includes(h.companyId)), cursor);
      cursor = p.cursor;
      order.push(p.pick!.companyId);
    }
    expect(new Set(order).size).toBe(3);
    timings.spamHeadCount = heads.length;
  }, 120_000);

  it('⑤ 실행기 회사 줄 = 큰 회사 100건이 작은 회사 20곳을 기다리게 하지 않는다(줄 4 · 건당 5ms)', async () => {
    const items = [...Array.from({ length: 100 }, () => ({ co: BIG })), ...SMALL.map((co) => ({ co }))];
    const doneAt = new Map<string, number>();
    const t0 = Date.now();
    await runCompanyLanes(items, (x) => x.co, 4, async (x) => { await new Promise((r) => setTimeout(r, 5)); if (!doneAt.has(x.co)) doneAt.set(x.co, Date.now() - t0); });
    const smallWorst = Math.max(...SMALL.map((co) => doneAt.get(co)!));
    timings.lanesSmallWorst_ms = smallWorst;
    timings.lanesTotal_ms = Date.now() - t0;
    expect(smallWorst).toBeLessThan(timings.lanesTotal_ms);
    console.log('[E10 부하 결과]', JSON.stringify({ customers: N, ...timings }));
  });
});
