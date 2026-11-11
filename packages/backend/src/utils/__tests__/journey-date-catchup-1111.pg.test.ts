// replaces: none
/**
 * C129 D11 날짜형 시작(생일 임박 · 연 단위 포인트 소멸)의 따라잡기 — 실 PostgreSQL
 *   (★ 2026-11-11 · 설계서 docs/2026-11-11-journey-remaining-nine-design.md §10 처방 32 ~ 36 · 시험 T6 ④ ~ ⑪)
 *
 *   훑은 날(journeys.last_state_cursor_on · 원장 C129-DDL-1)을 남기고, 못 훑은 날의 대상을 날짜가 지나기 전까지 따라잡는다.
 *   끝난 회차 = 기록 문장이 1행을 돌려준 회차뿐 · 회차 상한으로 잘린 회차 · 상한 초과로 멈춘 회차 · 그사이 조건이 바뀐 회차는 기록하지 않는다.
 *   회차 상한(JOURNEY_COUNT_CAP)은 이 파일에서만 3 으로 낮춘다(잘림을 네 명으로 만든다).
 *   고객 번호 = 010-0000-xxxx(도달 불가 대역).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1, alertPassFailures: async () => undefined }));
vi.mock('../journey-target-extractor', async (orig) => ({ ...(await orig<any>()), JOURNEY_COUNT_CAP: 3 }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { runJourneyTriggerWatcher, DATE_SCAN_LOCK_SPACE } from '../journey-trigger-watcher';
import { resetStateCursorColumnCache } from '../journey-lineage';

let seq = 9300;
/** KST 오늘 + k 일의 월-일 */
const MD: Record<number, string> = {};
const md = (k: number): string => MD[k];

async function company(): Promise<{ co: string; owner: string }> {
  const co = randomUUID(); const owner = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: co, company_name: `날짜형 따라잡기 ${co.slice(0, 4)}` });
  await insertMinimalRow(pool, 'users', { id: owner, company_id: co, user_type: 'admin', is_active: true, phone: '010-0000-2224', login_id: `t-1111-dc-${co.slice(0, 8)}` });
  return { co, owner };
}
async function customer(co: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'customers', { id, company_id: co, phone: `0100000${String(seq++)}`, is_active: true, sms_opt_in: true, ...over });
  await pool.query(`UPDATE customers SET created_at = NOW() - INTERVAL '900 days' WHERE id = $1`, [id]);   // 이관 유예 밖
  return id;
}
async function journey(c: { co: string; owner: string }, trigger: string, filters: Record<string, unknown>, over: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'journeys', {
    id, company_id: c.co, created_by: c.owner, name: `따라잡기 ${trigger}`, status: 'active', start_kind: 'event', trigger_event: trigger,
    trigger_filters: JSON.stringify(filters), callback_number: '0212345678', ...over,
  });
  await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: id, step_order: 1, step_type: 'message', channel: 'sms', message_template: '안내', delay_mode: 'relative', delay_hours: 0 });
  return id;
}
const entered = async (journeyId: string): Promise<string[]> =>
  (await pool.query(`SELECT customer_id FROM journey_executions WHERE journey_id = $1 ORDER BY customer_id`, [journeyId])).rows.map((r: any) => String(r.customer_id));
const sorted = (ids: string[]) => [...ids].sort();
/** 훑은 날이 오늘에서 며칠 전인가(null = 기록 없음) */
const cursorAge = async (journeyId: string): Promise<number | null> => {
  const r = await pool.query(`SELECT ((NOW() AT TIME ZONE 'Asia/Seoul')::date - last_state_cursor_on) AS age FROM journeys WHERE id = $1`, [journeyId]);
  return r.rows[0].age == null ? null : Number(r.rows[0].age);
};
const setCursorAge = (journeyId: string, days: number) =>
  pool.query(`UPDATE journeys SET last_state_cursor_on = (NOW() AT TIME ZONE 'Asia/Seoul')::date - $2::int WHERE id = $1`, [journeyId, days]);
/** 1시간 쉼을 지운다 = 켜진 목록에서 한 회차 빠지게 했다가 다시 켠다(시험용 훅 없음 · 감시가 스스로 지운다) */
async function forgetThrottle(journeyId: string): Promise<void> {
  await pool.query(`UPDATE journeys SET status = 'paused' WHERE id = $1`, [journeyId]);
  await runJourneyTriggerWatcher();
  await pool.query(`UPDATE journeys SET status = 'active' WHERE id = $1`, [journeyId]);
}

/** 그 여정의 계보 잠금을 다른 연결이 쥔 채 work 를 띄운다 → 기다림 확인 → change(커밋) → 잠금 해제 → work 끝 */
async function interleave<T>(journeyId: string, work: () => Promise<T>, change: (holder: { query: (t: string, p?: any[]) => Promise<any> }) => Promise<void>): Promise<T> {
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query(`SELECT pg_advisory_xact_lock(hashtext('journey-entry'), hashtext((COALESCE(lineage_id, id))::text)) FROM journeys WHERE id = $1::uuid`, [journeyId]);
    const running = work();
    let waiting = 0;
    for (let i = 0; i < 400 && waiting === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const w = await pool.query(
        `SELECT COUNT(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND NOT l.granted AND a.query ILIKE '%journey-entry%' AND a.pid <> $1`, [(holder as any).processID]);
      waiting = Number(w.rows[0].n);
    }
    expect(waiting, 'work 가 계보 잠금에서 기다려야 끼어들기가 성립한다').toBeGreaterThan(0);
    await change(holder);
    await holder.query('COMMIT');
    return await running;
  } catch (e) {
    await holder.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    holder.release();
  }
}

beforeAll(async () => {
  const r = await pool.query(`SELECT g AS k, TO_CHAR((NOW() AT TIME ZONE 'Asia/Seoul')::date + g, 'MM-DD') AS md FROM generate_series(-3, 9) g`);
  for (const row of r.rows) MD[Number(row.k)] = String(row.md);
});

describe('칸이 없을 때(DDL 전) = 종전 동작', () => {
  it('④ 생일 D-7 = 오늘 + 7 고객만 진입 · 하루 전 대상은 넣지 않는다 · 오류 0', async () => {
    resetStateCursorColumnCache();
    const c = await company();
    const j = await journey(c, 'customer.birthday_approaching', { days_before: 7 });
    const c0 = await customer(c.co, { birth_month_day: md(7) });
    await customer(c.co, { birth_month_day: md(6) });
    await runJourneyTriggerWatcher();
    expect(await entered(j)).toEqual([c0]);
  });
});

describe('칸이 있을 때 — 못 훑은 날의 대상을 날짜가 지나기 전까지 따라잡는다', () => {
  beforeAll(async () => {
    await pool.query(ledgerBlockSql('C129-DDL-1'));
    resetStateCursorColumnCache();
  });

  it('⑤ 기록이 이틀 전(하루를 못 훑음) = 오늘 + 7 · + 6 진입 · + 5 는 창 밖 · 기록 = 오늘 · 다시 돌려도 진입 0 / 기록 없음 = 따라잡지 않고 기록만', async () => {
    const c = await company();
    const j = await journey(c, 'customer.birthday_approaching', { days_before: 7 });
    await setCursorAge(j, 2);
    const c0 = await customer(c.co, { birth_month_day: md(7) });
    const c1 = await customer(c.co, { birth_month_day: md(6) });
    await customer(c.co, { birth_month_day: md(5) });
    await runJourneyTriggerWatcher();
    expect(await entered(j)).toEqual(sorted([c0, c1]));
    expect(await cursorAge(j)).toBe(0);
    await forgetThrottle(j);
    await runJourneyTriggerWatcher();
    expect(await entered(j)).toEqual(sorted([c0, c1]));

    // 기록 없음(배포 직후 · 새로 켠 여정) = 오늘 대상만 · 기록 = 오늘
    const fresh = await company();
    const jf = await journey(fresh, 'customer.birthday_approaching', { days_before: 7 });
    const f0 = await customer(fresh.co, { birth_month_day: md(7) });
    await customer(fresh.co, { birth_month_day: md(6) });
    await runJourneyTriggerWatcher();
    expect(await entered(jf)).toEqual([f0]);
    expect(await cursorAge(jf)).toBe(0);
  });

  it('⑥ N = 1 이고 기록이 5일 전 = 따라잡는 날은 하루뿐(오늘이 생일인 고객까지) · 생일이 지난 고객 0', async () => {
    const c = await company();
    const j = await journey(c, 'customer.birthday_approaching', { days_before: 1 });
    await setCursorAge(j, 5);
    const b1 = await customer(c.co, { birth_month_day: md(1) });
    const b0 = await customer(c.co, { birth_month_day: md(0) });
    await customer(c.co, { birth_month_day: md(-1) });
    await customer(c.co, { birth_month_day: md(-2) });
    await runJourneyTriggerWatcher();
    expect(await entered(j)).toEqual(sorted([b1, b0]));
    expect(await cursorAge(j)).toBe(0);
  });

  it('⑦ 따라잡기 대상이 한 번에 보낼 최대 인원을 넘음 = 종전대로 멈춤 · 기록 그대로 → 상한을 올려 켜면 다시 따라잡는다', async () => {
    const c = await company();
    const j = await journey(c, 'customer.birthday_approaching', { days_before: 7 }, { threshold_recipients_per_step: 1 });
    await setCursorAge(j, 2);
    const c0 = await customer(c.co, { birth_month_day: md(7) });
    const c1 = await customer(c.co, { birth_month_day: md(6) });
    await runJourneyTriggerWatcher();
    expect((await pool.query(`SELECT status FROM journeys WHERE id = $1`, [j])).rows[0].status).toBe('paused');
    expect(await entered(j)).toEqual([]);
    expect(await cursorAge(j)).toBe(2);
    await pool.query(`UPDATE journeys SET threshold_recipients_per_step = 10, status = 'active', paused_at = NULL, pause_reason = NULL WHERE id = $1`, [j]);
    await runJourneyTriggerWatcher();
    expect(await entered(j)).toEqual(sorted([c0, c1]));
    expect(await cursorAge(j)).toBe(0);
  });

  it('⑧ 연 단위 포인트 소멸 = 못 훑은 날이 「소멸일 − N」 이었으면 다음 회차에 진입 · 매일 훑은 여정은 그날이 아니면 0', async () => {
    const filters = { expiry_mode: 'annual_date', expiry_month_day: md(6), days_before: 7, points_min: 0 };
    const c = await company();
    const j = await journey(c, 'customer.points_expiring', filters);
    await setCursorAge(j, 2);   // 어제(= 소멸일 − 7)를 못 훑었다
    const p = await customer(c.co, { points: 100 });
    const daily = await company();
    const jd = await journey(daily, 'customer.points_expiring', filters);
    await setCursorAge(jd, 1);  // 어제 훑었다 = 못 훑은 날 0
    await customer(daily.co, { points: 100 });
    await runJourneyTriggerWatcher();
    expect(await entered(j)).toEqual([p]);
    expect(await cursorAge(j)).toBe(0);
    expect(await entered(jd)).toEqual([]);
    expect(await cursorAge(jd)).toBe(0);
  });

  it('⑨ 회차 상한(이 파일 = 3)으로 잘린 회차 = 기록 그대로 · 곧바로 다음 회차가 남은 고객을 넣고 기록 · 창 안에 이미 들어온 고객은 재진입 대기가 지났어도 두 번 넣지 않는다', async () => {
    const c = await company();
    const j = await journey(c, 'customer.birthday_approaching', { days_before: 7 }, { allow_reentry: true, reentry_cooldown_days: 0 });
    await setCursorAge(j, 3);   // 이틀을 못 훑음 = 오늘 + 7 · + 6 · + 5
    const ids = [
      await customer(c.co, { birth_month_day: md(7) }), await customer(c.co, { birth_month_day: md(6) }),
      await customer(c.co, { birth_month_day: md(5) }), await customer(c.co, { birth_month_day: md(5) }),
    ];
    // 창 안(30시간 전)에 이미 들어와 끝난 고객 — 끝난 지 하루가 지나 재진입 규칙으로는 다시 들어올 수 있다
    const done = await customer(c.co, { birth_month_day: md(6) });
    await insertMinimalRow(pool, 'journey_executions', {
      id: randomUUID(), journey_id: j, customer_id: done, current_step_order: 1, status: 'completed',
      entered_at: new Date(Date.now() - 30 * 3_600_000), completed_at: new Date(Date.now() - 30 * 3_600_000),
    });
    await runJourneyTriggerWatcher();
    const first = (await entered(j)).filter((x) => x !== done);
    expect(first).toHaveLength(3);
    expect(await cursorAge(j)).toBe(3);                    // 잘린 회차 = 기록하지 않는다
    await runJourneyTriggerWatcher();                      // 1시간 쉼 없이 다음 회차
    expect((await entered(j)).filter((x) => x !== done)).toEqual(sorted(ids));
    expect((await entered(j)).filter((x) => x === done)).toHaveLength(1);   // 두 번 넣지 않는다
    expect(await cursorAge(j)).toBe(0);
  });

  it('⑫ 그날 이미 끝난 뒤의 회차가 끝나지 않으면(회차 상한으로 잘림 · 상한 초과 멈춤) = 그날은 미완료(회차를 열 때 기록을 어제로 내려 둔다) → 끝나면 다시 오늘', async () => {
    // 잘림: 아침에 끝남(기록 = 오늘) → 뒤에 대상 4명이 생김(이 파일의 회차 상한 = 3)
    const c = await company();
    const j = await journey(c, 'customer.birthday_approaching', { days_before: 7 });
    await setCursorAge(j, 0);
    const ids = [];
    for (let k = 0; k < 4; k++) ids.push(await customer(c.co, { birth_month_day: md(7) }));
    await runJourneyTriggerWatcher();
    expect(await entered(j)).toHaveLength(3);
    expect(await cursorAge(j)).toBe(1);                    // 앞 회차의 기록이 「오늘은 다 봤다」로 남지 않는다(다음 날 창에 오늘이 들어간다)
    await runJourneyTriggerWatcher();                      // 끝나지 않은 회차 = 1시간 쉼 없음
    expect(await entered(j)).toEqual(sorted(ids));
    expect(await cursorAge(j)).toBe(0);

    // 상한 초과 멈춤: 기록 = 오늘이던 여정이 대량 진입으로 멈추면 그날은 미완료
    const p = await company();
    const jp = await journey(p, 'customer.birthday_approaching', { days_before: 7 }, { threshold_recipients_per_step: 1 });
    await setCursorAge(jp, 0);
    await customer(p.co, { birth_month_day: md(7) });
    await customer(p.co, { birth_month_day: md(7) });
    await runJourneyTriggerWatcher();
    expect((await pool.query(`SELECT status FROM journeys WHERE id = $1`, [jp])).rows[0].status).toBe('paused');
    expect(await entered(jp)).toEqual([]);
    expect(await cursorAge(jp)).toBe(1);
  });

  it('⑬ 다른 프로세스가 그 여정의 날짜형 회차를 돌고 있으면(세션 잠금) = 이 회차는 열지도 않고 넘긴다(기록 · 진입 그대로) → 잠금이 풀리면 곧바로 다음 회차가 돈다', async () => {
    const c = await company();
    const j = await journey(c, 'customer.birthday_approaching', { days_before: 7 });
    await setCursorAge(j, 0);                               // 오늘 이미 끝남 = 회차를 열면 어제로 내려간다
    const c0 = await customer(c.co, { birth_month_day: md(7) });
    const other = await pool.connect();                     // 다른 프로세스 구실
    try {
      await other.query(`SELECT pg_advisory_lock(hashtext($1::text), hashtext($2::text))`, [DATE_SCAN_LOCK_SPACE, j]);
      await runJourneyTriggerWatcher();
      expect(await entered(j)).toEqual([]);
      expect(await cursorAge(j)).toBe(0);                  // 열지 않았다 = 내려 두지도 않았다(돌고 있는 쪽의 열기 · 닫기를 건드리지 않는다)
    } finally {
      await other.query(`SELECT pg_advisory_unlock(hashtext($1::text), hashtext($2::text))`, [DATE_SCAN_LOCK_SPACE, j]).catch(() => undefined);
      other.release();
    }
    await runJourneyTriggerWatcher();                      // 넘긴 회차 = 1시간 쉼 없음
    expect(await entered(j)).toEqual([c0]);
    expect(await cursorAge(j)).toBe(0);
  });

  it('⑪ 훑는 사이 여정 조건이 바뀜(세대는 그대로) = 넣기는 그대로 · 기록은 올리지 않는다 → 곧바로 다음 회차가 새 조건으로 창을 다시 보고 기록', async () => {
    const c = await company();
    const j = await journey(c, 'customer.birthday_approaching', { days_before: 7 });
    await setCursorAge(j, 2);
    const c0 = await customer(c.co, { birth_month_day: md(7) });
    const c1 = await customer(c.co, { birth_month_day: md(6) });
    await interleave(j, () => runJourneyTriggerWatcher(), async (h) => {
      await h.query(`UPDATE journeys SET trigger_filters = trigger_filters || '{"memo": "훑는 사이 바뀜"}'::jsonb WHERE id = $1`, [j]);
    });
    expect(await entered(j)).toEqual(sorted([c0, c1]));
    expect(await cursorAge(j)).toBe(2);                    // 옛 조건의 결과로 기록을 올리지 않는다
    await runJourneyTriggerWatcher();                      // 끝나지 않은 회차 = 1시간 쉼 없음
    expect(await entered(j)).toEqual(sorted([c0, c1]));   // 창 안 제외 = 이미 넣은 고객은 다시 안 넣는다
    expect(await cursorAge(j)).toBe(0);
  });
});
