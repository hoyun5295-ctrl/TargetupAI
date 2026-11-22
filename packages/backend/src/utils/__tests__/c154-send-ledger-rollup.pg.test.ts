// replaces: none
/**
 * C154 발송 원장 굴리기 — 실 PostgreSQL 판(★ 2026-11-22 · 설계서 docs/2026-11-22-c154-send-ledger-rollup-design.md §5)
 *   새 표 다섯 = 배포 원장 C154-DDL-1 블록을 그대로 얹는다. 낱행은 가짜(읽기 함수는 MySQL 이라 여기서 부르지 않는다).
 *   기대값 = 손으로 센 예 · 설계서의 반례(코드가 세는 방식으로 다시 세지 않는다).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { SUCCESS_CODES } from '../sms-result-map';
import { snapshotBenchmarks, readSendSuccess } from '../performance-benchmark';
import {
  newTally, tallyRows, rollCampaign, pickRollCandidates, skipStale, closePass, closeDue, pruneRollup,
  readCarrierSendRates, readGroupPerformance, readCampaignTally, runRollupTick, rollupLiveCompanyIds, clearRollupLiveMemo, failRoll,
  CARRIER_NET_RATES_SQL, CARRIER_WINDOW_DAYS, CARRIER_MIN_SENT, ROLL_PAGE, RollBudgetExceeded,
  type LedgerRow, type RollupCampaign,
} from '../send-ledger-rollup';

const OK = SUCCESS_CODES[0];
const FAILED = 3999;

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C154-DDL-1'));
});

async function company(): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', { id });
  return id;
}

/** 결과가 확정된 문자 캠페인 한 줄 — sentAgo = 발송한 지(시간) */
async function campaign(co: string, o: { success: number; fail: number; sentHoursAgo?: number; sentAt?: string; channel?: string | null; status?: string; final?: boolean }): Promise<RollupCampaign> {
  const id = randomUUID();
  const r = await pool.query(
    o.sentAt ? `SELECT $1::timestamptz AS at` : `SELECT NOW() - ($1::int * INTERVAL '1 hour') AS at`,
    [o.sentAt ?? (o.sentHoursAgo ?? 7)],
  );
  const sentAt: Date = r.rows[0].at;
  await insertMinimalRow(pool, 'campaigns', {
    id, company_id: co, status: o.status ?? 'completed', result_final: o.final ?? true,
    send_channel: o.channel === undefined ? 'sms' : o.channel, message_type: 'LMS',
    sent_at: sentAt, success_count: o.success, fail_count: o.fail,
  });
  return { id, companyId: co, sentAt, messageType: 'LMS', createdBy: null, sendConfig: null, scheduledAt: null, createdAt: null };
}

const rows = (list: Array<[phone: string, ok: boolean, carrier: string | null]>): LedgerRow[] =>
  list.map(([dest_no, ok, mob_company], i) => ({ seqno: i + 1, dest_no, status_code: ok ? OK : FAILED, mob_company }));
const tallyOf = (list: Array<[string, boolean, string | null]>) => { const t = newTally(); tallyRows(t, rows(list)); return t; };

const state = async (id: string) => (await pool.query(`SELECT * FROM campaign_send_rollup WHERE campaign_id = $1::uuid`, [id])).rows[0];
const carriers = async (id: string) => Object.fromEntries((await pool.query(
  `SELECT carrier, success, fail FROM campaign_carrier_results WHERE campaign_id = $1::uuid`, [id])).rows.map((x: any) => [x.carrier, [x.success, x.fail]]));
const setCounts = (id: string, s: number, f: number) => pool.query(`UPDATE campaigns SET success_count = $2, fail_count = $3 WHERE id = $1::uuid`, [id, s, f]);
const picked = async (co: string) => (await pickRollCandidates({ all: false, ids: [co] }, 50)).map((c) => c.id);

describe('PG1 캠페인 하나 굴리기 — 통신사 줄 · 상태 줄(설계서 S1 · S3)', () => {
  it('굴린 합 = PG 합계 → 통신사 줄 · 상태 줄(어긋남 0 · 구매 사실 없는 회사 = 낱행 안 만듦)', async () => {
    const co = await company();
    const c = await campaign(co, { success: 3, fail: 2 });
    const t = tallyOf([['01000000001', true, '11'], ['01000000002', true, 'SKT'], ['01000000003', true, '17'], ['01000000004', false, '11'], ['01000000005', false, '']]);
    expect(await rollCampaign(c, t)).toBe('ok');
    expect(await carriers(c.id)).toEqual({ SKT: [2, 1], KT_MVNO: [1, 0], unknown: [0, 1] });
    const s = await state(c.id);
    expect({ success: s.success, fail: s.fail, unknown_fail: s.unknown_fail, drift: s.drift, tries: s.tries }).toEqual({ success: 3, fail: 2, unknown_fail: 1, drift: 0, tries: 0 });
    expect([s.seen_success, s.seen_fail, s.tried_success, s.tried_fail]).toEqual([3, 2, 3, 2]);
    expect(s.cells_state).toBe('none');
    expect(s.rolled_at).not.toBeNull();
    expect(Number(s.unit_cost)).toBeGreaterThanOrEqual(0);
  });

  it('굴린 합 ≠ PG 합계 → 통신사 줄을 쓰지 않고 어긋남 · 재시도 시각 · 처음이면 pending → 세 번째에 none', async () => {
    const co = await company();
    const c = await campaign(co, { success: 4, fail: 2 });
    const t = tallyOf([['01000000001', true, '11'], ['01000000002', true, '11'], ['01000000003', true, '11'], ['01000000004', false, '11'], ['01000000005', false, '11']]);
    expect(await rollCampaign(c, t)).toBe('drift');
    expect(await carriers(c.id)).toEqual({});
    let s = await state(c.id);
    expect({ drift: s.drift, tries: s.tries, cells: s.cells_state, seen: s.seen_success, tried: [s.tried_success, s.tried_fail] })
      .toEqual({ drift: 1, tries: 1, cells: 'pending', seen: null, tried: [4, 2] });
    const waitMin = (await pool.query(`SELECT EXTRACT(EPOCH FROM (next_try_at - NOW())) / 60 AS m FROM campaign_send_rollup WHERE campaign_id = $1::uuid`, [c.id])).rows[0].m;
    expect(Number(waitMin)).toBeGreaterThan(28);
    expect(Number(waitMin)).toBeLessThan(31);
    expect(await rollCampaign(c, t)).toBe('drift');
    s = await state(c.id);
    expect([s.tries, s.cells_state]).toEqual([2, 'pending']);
    expect(await rollCampaign(c, t)).toBe('drift');
    s = await state(c.id);
    expect([s.tries, s.cells_state]).toEqual([3, 'none']);
  });

  it('재시도 횟수는 「시도하는 순간」의 합계가 저장된 시도 합계와 다르면 0 에서 다시 센다(읽는 사이에 합계가 바뀐 경우)', async () => {
    const co = await company();
    const c = await campaign(co, { success: 90, fail: 0 });
    const t89 = newTally(); t89.success = 89; t89.rows = 89;
    await rollCampaign(c, t89);
    await rollCampaign(c, t89);
    expect((await state(c.id)).tries).toBe(2);
    // 낱행 90 을 읽은 직후 PG 합계가 91 로 바뀜 → 새 합계의 첫 실패 = 1
    const t90 = newTally(); t90.success = 90; t90.rows = 90;
    await setCounts(c.id, 91, 0);
    expect(await rollCampaign(c, t90)).toBe('drift');
    const s = await state(c.id);
    expect([s.tries, s.tried_success, s.cells_state]).toEqual([1, 91, 'pending']);
    // 다음 재시도에서 91 로 맞으면 복구
    const t91 = newTally(); t91.success = 91; t91.rows = 91; t91.carriers.set('SKT', { success: 91, fail: 0 });
    expect(await rollCampaign(c, t91)).toBe('ok');
    const s2 = await state(c.id);
    expect([s2.drift, s2.tries, s2.seen_success]).toEqual([0, 0, 91]);
  });

  it('다시 굴림 = 통신사 줄을 덮어쓴다(늦은 결과로 합계가 바뀐 뒤)', async () => {
    const co = await company();
    const c = await campaign(co, { success: 1, fail: 1 });
    await rollCampaign(c, tallyOf([['01000000001', true, '16'], ['01000000002', false, '16']]));
    expect(await carriers(c.id)).toEqual({ KT: [1, 1] });
    await setCounts(c.id, 2, 0);
    expect(await rollCampaign(c, tallyOf([['01000000001', true, '16'], ['01000000002', true, '16']]))).toBe('ok');
    expect(await carriers(c.id)).toEqual({ KT: [2, 0] });
  });
});

describe('PG2 대상 고르기 — 새 캠페인 · 합계가 바뀜 · 재시도 차례(설계서 S1)', () => {
  it('문자 채널 · 완료 · 확정 · 35일 안만 · 단계가 열린 회사만', async () => {
    const co = await company();
    const other = await company();
    const good = await campaign(co, { success: 1, fail: 0 });
    await campaign(co, { success: 1, fail: 0, channel: 'alimtalk' });
    await campaign(co, { success: 1, fail: 0, channel: 'both' });
    await campaign(co, { success: 1, fail: 0, final: false });
    await campaign(co, { success: 1, fail: 0, status: 'sending' });
    await campaign(co, { success: 1, fail: 0, sentHoursAgo: 24 * 36 });
    const nullChannel = await campaign(co, { success: 1, fail: 0, channel: null });
    await campaign(other, { success: 1, fail: 0 });
    expect((await picked(co)).sort()).toEqual([good.id, nullChannel.id].sort());
    expect(await pickRollCandidates({ all: false, ids: [] }, 50)).toEqual([]);
  });

  it('맞게 굴린 캠페인은 다시 고르지 않는다 · PG 합계가 바뀌면 고른다', async () => {
    const co = await company();
    const c = await campaign(co, { success: 1, fail: 0 });
    await rollCampaign(c, tallyOf([['01000000001', true, '11']]));
    expect(await picked(co)).toEqual([]);
    await setCounts(c.id, 2, 0);
    expect(await picked(co)).toEqual([c.id]);
  });

  it('어긋난 캠페인 = 같은 합계로는 재시도 차례(시각 · 세 번)로만 고른다', async () => {
    const co = await company();
    const c = await campaign(co, { success: 2, fail: 0 });
    const t = tallyOf([['01000000001', true, '11']]);
    await rollCampaign(c, t);
    expect(await picked(co)).toEqual([]);                       // 재시도 시각 전
    await pool.query(`UPDATE campaign_send_rollup SET next_try_at = NOW() - INTERVAL '1 minute' WHERE campaign_id = $1::uuid`, [c.id]);
    expect(await picked(co)).toEqual([c.id]);                   // 재시도 차례
    await rollCampaign(c, t);
    await rollCampaign(c, t);
    await pool.query(`UPDATE campaign_send_rollup SET next_try_at = NOW() - INTERVAL '1 minute' WHERE campaign_id = $1::uuid`, [c.id]);
    expect((await state(c.id)).tries).toBe(3);
    expect(await picked(co)).toEqual([]);                       // 세 번 뒤 = 고르지 않는다
    await setCounts(c.id, 3, 0);
    expect(await picked(co)).toEqual([c.id]);                   // 합계가 또 바뀌면 다시 고른다
  });

  it('차례 = 새 캠페인 → 합계가 바뀐 것 → 재시도 · 같은 갈래 안에서는 발송 순서', async () => {
    const co = await company();
    const retry = await campaign(co, { success: 2, fail: 0, sentHoursAgo: 60 });
    const changed = await campaign(co, { success: 1, fail: 0, sentHoursAgo: 50 });
    const fresh2 = await campaign(co, { success: 1, fail: 0, sentHoursAgo: 8 });
    const fresh1 = await campaign(co, { success: 1, fail: 0, sentHoursAgo: 40 });
    await rollCampaign(retry, tallyOf([['01000000001', true, '11']]));
    await pool.query(`UPDATE campaign_send_rollup SET next_try_at = NOW() - INTERVAL '1 minute' WHERE campaign_id = $1::uuid`, [retry.id]);
    await rollCampaign(changed, tallyOf([['01000000001', true, '11']]));
    await setCounts(changed.id, 5, 0);
    expect(await picked(co)).toEqual([fresh1.id, fresh2.id, changed.id, retry.id]);
  });
});

// ── 받은 고객 · 발송 시점의 칸 ──

/** 이틀 전 낮 12시(KST)에 보낸 캠페인의 시각 · 그 KST 날짜 */
async function sentTwoDaysAgoNoon(): Promise<{ at: string; day: string }> {
  const r = await pool.query(
    `SELECT to_char(((date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') - INTERVAL '2 days' + INTERVAL '12 hours') AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
            to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date - 2, 'YYYY-MM-DD') AS day`);
  return r.rows[0];
}
/** 그 날짜에서 n 일 뒤(음수 = 앞)의 날짜 글 */
const dayPlus = async (day: string, n: number): Promise<string> =>
  (await pool.query(`SELECT to_char($1::date + $2::int, 'YYYY-MM-DD') AS d`, [day, n])).rows[0].d;

async function customer(co: string, phone: string, recent: string | null, count: number | null): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'customers', { id, company_id: co, phone, recent_purchase_date: recent, purchase_count: count });
  return id;
}
/** 매장 원장 구매(날짜만) */
const ledger = (co: string, cust: string, day: string, amount: number) => pool.query(
  `INSERT INTO purchases (company_id, customer_id, customer_phone, purchase_date, total_amount) VALUES ($1::uuid, $2::uuid, '', $3::timestamp, $4)`, [co, cust, day, amount]);
/** 자사몰 결제(시각 · 매출 반영됨) */
const mall = (co: string, cust: string, at: string, amount: number) => insertMinimalRow(pool, 'cdp_events', {
  id: randomUUID(), company_id: co, customer_id: cust, event_name: 'purchase', source: 'test',
  properties: JSON.stringify({ revenue_applied: true, total_amount: amount }), occurred_at: at,
});
const cellsOf = async (campaignId: string) => Object.fromEntries((await pool.query(
  `SELECT customer_id, cell, sends FROM campaign_recipient_cells WHERE campaign_id = $1::uuid`, [campaignId])).rows.map((x: any) => [x.customer_id, [x.cell, x.sends]]));

describe('PG3 받은 고객 — 발송 시점의 칸을 되짚는다(설계서 S4 · D5 · D7)', () => {
  it('기준 날짜 = 발송한 날 · 발송 뒤 구매는 뺀 상태로 · 근거가 없으면 정하지 못함', async () => {
    const co = await company();
    const sent = await sentTwoDaysAgoNoon();
    const c = await campaign(co, { success: 11, fail: 0, sentAt: sent.at });
    const at = (h: number) => new Date(new Date(sent.at).getTime() + h * 3600 * 1000).toISOString();

    // A 발송 뒤 구매 없음 · 마지막 구매 = 발송 30일 전 · 5번 → 발송한 날 기준 30일 = 맨 윗줄(오늘 기준이면 32일 = 둘째 줄) · 네 번 이상 칸
    const a = await customer(co, '01000000001', await dayPlus(sent.day, -30), 5);
    // B 발송 1시간 뒤 몰에서 삼 · 그 앞 구매 = 발송 200일 전(몰) · 지금 요약 = 발송한 날 · 3번 → 발송 시점 = 200일 전 · 2번
    const b = await customer(co, '01000000002', sent.day, 3);
    await mall(co, b, `${await dayPlus(sent.day, -200)}T03:00:00Z`, 10000);
    await mall(co, b, at(1), 20000);
    // C 문자를 받고 처음 삼(발송 다음 날 매장) · 지금 요약 = 1번 → 발송 시점 = 구매 기록 없음
    const cc = await customer(co, '01000000003', await dayPlus(sent.day, 1), 1);
    await ledger(co, cc, await dayPlus(sent.day, 1), 30000);
    // D 발송한 날의 매장 구매(날짜만 있어 발송 앞뒤를 모른다) → 정하지 못함
    const d = await customer(co, '01000000004', sent.day, 2);
    await ledger(co, d, sent.day, 5000);
    // E 요약은 발송 뒤 날짜인데 구매 사실이 없다 → 정하지 못함
    const e = await customer(co, '01000000005', await dayPlus(sent.day, 1), 4);
    // F (설계 2R 반례) 몰 구매 100일 전 · 발송한 날 아침(발송 3시간 전) → 발송 → 다음 날 구매 · 지금 요약 3번
    //   → 앞 구매일 = 발송한 날(100일 전이 아니다) = 맨 윗줄 · 2번 = 둘 ~ 세 번 칸
    const f = await customer(co, '01000000006', await dayPlus(sent.day, 1), 3);
    await mall(co, f, `${await dayPlus(sent.day, -100)}T03:00:00Z`, 10000);
    await mall(co, f, at(-3), 10000);
    await mall(co, f, at(22), 10000);
    // G 발송한 날 아침에 몰에서 사고(발송 전) 그 뒤 구매 없음 · 요약 = 발송한 날 · 1번 → 요약 그대로(맨 윗줄 · 한 번 칸)
    const g = await customer(co, '01000000007', sent.day, 1);
    await mall(co, g, at(-2), 7000);
    // H 구매 기록이 없는 고객
    const h = await customer(co, '01000000008', null, null);
    // I 발송 뒤 구매를 빼면 칸이 달라지는 고객: 앞 구매 = 발송 50일 전(몰) · 발송 2시간 뒤 몰 구매 · 지금 요약 4번
    //   → 발송 시점 = 50일 전(둘째 줄) · 3번(둘 ~ 세 번 칸). 빼지 않으면 4번 = 네 번 이상 칸이 된다
    const i = await customer(co, '01000000010', sent.day, 4);
    await mall(co, i, `${await dayPlus(sent.day, -50)}T03:00:00Z`, 10000);
    await mall(co, i, at(2), 20000);
    // J 발송한 날 아침 몰 구매(발송 전) + 같은 날 매장 구매(시각 모름 · 금액이 달라 다른 구매) → 매장 구매의 앞뒤를 모르니 정하지 못함
    const j = await customer(co, '01000000011', sent.day, 2);
    await mall(co, j, at(-2), 7000);
    await ledger(co, j, sent.day, 3300);

    const t = tallyOf([
      ['01000000001', true, '11'], ['010-0000-0002', true, '11'], ['01000000003', true, '11'], ['01000000004', true, '11'],
      ['01000000005', true, '11'], ['01000000006', true, '11'], ['01000000007', true, '11'], ['01000000008', true, '11'],
      ['01000000010', true, '11'], ['01000000011', true, '11'],
      ['01099999999', true, '11'],   // 고객 원장에 없는 번호
    ]);
    expect(await rollCampaign(c, t)).toBe('ok');
    const got = await cellsOf(c.id);
    expect(got[a]).toEqual(['r0c2', 1]);
    expect(got[b]).toEqual(['r3c1', 1]);
    expect(got[cc]).toEqual(['nobuy', 1]);
    expect(got[d]).toEqual(['unknown', 1]);
    expect(got[e]).toEqual(['unknown', 1]);
    expect(got[f]).toEqual(['r0c1', 1]);
    expect(got[g]).toEqual(['r0c0', 1]);
    expect(got[h]).toEqual(['nobuy', 1]);
    expect(got[i]).toEqual(['r1c1', 1]);
    expect(got[j]).toEqual(['unknown', 1]);
    const s = await state(c.id);
    expect([s.cells_state, s.matched, s.unmatched]).toEqual(['open', 10, 1]);
  });

  it('같은 고객에게 두 건 성공 = 낱행 한 줄 · 성공 건수 2', async () => {
    const co = await company();
    const sent = await sentTwoDaysAgoNoon();
    const c = await campaign(co, { success: 2, fail: 0, sentAt: sent.at });
    const a = await customer(co, '01000000001', await dayPlus(sent.day, -10), 1);
    await ledger(co, a, await dayPlus(sent.day, -10), 1000);
    await rollCampaign(c, tallyOf([['01000000001', true, '11'], ['01000000001', true, '11']]));
    expect((await cellsOf(c.id))[a]).toEqual(['r0c0', 2]);
  });

  it('구매 사실이 없는 회사 · 굴림이 발송 3일을 넘긴 캠페인 = 낱행을 만들지 않는다(끝 상태 none)', async () => {
    const noFacts = await company();
    const c1 = await campaign(noFacts, { success: 1, fail: 0 });
    await customer(noFacts, '01000000001', null, null);
    await rollCampaign(c1, tallyOf([['01000000001', true, '11']]));
    expect((await state(c1.id)).cells_state).toBe('none');
    expect(await cellsOf(c1.id)).toEqual({});

    const co = await company();
    const late = await campaign(co, { success: 1, fail: 0, sentHoursAgo: 24 * 4 });
    const a = await customer(co, '01000000001', null, null);
    await ledger(co, a, '2026-01-01', 1000);
    await rollCampaign(late, tallyOf([['01000000001', true, '11']]));
    expect((await state(late.id)).cells_state).toBe('none');
    expect(await cellsOf(late.id)).toEqual({});
  });

  it('다시 굴림(open) = 늦게 성공한 번호를 더하고 처음 정한 칸은 지킨다 · 끝 상태는 다시 열리지 않는다', async () => {
    const co = await company();
    const sent = await sentTwoDaysAgoNoon();
    const c = await campaign(co, { success: 1, fail: 1, sentAt: sent.at });
    const a = await customer(co, '01000000001', await dayPlus(sent.day, -10), 1);
    const b = await customer(co, '01000000002', await dayPlus(sent.day, -10), 1);
    await ledger(co, a, await dayPlus(sent.day, -10), 1000);
    await rollCampaign(c, tallyOf([['01000000001', true, '11'], ['01000000002', false, '11']]));
    expect(await cellsOf(c.id)).toEqual({ [a]: ['r0c0', 1] });
    // 그 뒤 a 의 요약이 바뀌어도(다른 구매) 처음 칸은 그대로 · b 가 늦게 성공
    await pool.query(`UPDATE customers SET purchase_count = 9 WHERE id = $1::uuid`, [a]);
    await setCounts(c.id, 2, 0);
    await rollCampaign(c, tallyOf([['01000000001', true, '11'], ['01000000002', true, '11']]));
    const got = await cellsOf(c.id);
    expect(got[a]).toEqual(['r0c0', 1]);
    expect(got[b]?.[1]).toBe(1);
    // 닫힌 캠페인 = 받은 고객을 건드리지 않는다
    await pool.query(`DELETE FROM campaign_recipient_cells WHERE campaign_id = $1::uuid`, [c.id]);
    await pool.query(`UPDATE campaign_send_rollup SET cells_state = 'closed' WHERE campaign_id = $1::uuid`, [c.id]);
    await setCounts(c.id, 2, 1);
    await rollCampaign(c, tallyOf([['01000000001', true, '11'], ['01000000002', true, '11'], ['01000000003', false, '11']]));
    expect((await state(c.id)).cells_state).toBe('closed');
    expect(await cellsOf(c.id)).toEqual({});
  });
});

// ── 귀속 닫기 ──

/** n 일 전 KST h 시의 시각 · 그 KST 날짜 */
async function kstAt(daysAgo: number, hour = 12): Promise<{ at: string; day: string }> {
  const r = await pool.query(
    `SELECT to_char(((date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') - ($1::int * INTERVAL '1 day') + ($2::int * INTERVAL '1 hour')) AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
            to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date - $1::int, 'YYYY-MM-DD') AS day`, [daysAgo, hour]);
  return r.rows[0];
}
const plusHours = (at: string, h: number) => new Date(new Date(at).getTime() + h * 3600 * 1000).toISOString();

/**
 * 낱행이 열린(open) 캠페인을 표에 직접 놓는다 — 닫기의 입력 = 굴리기가 남긴 표(굴리기 자체는 PG1 ~ PG3 이 본다).
 *   recipients = [고객, 칸, 성공 건수] · 단가 30원
 */
async function openCampaign(co: string, sentAt: string, recipients: Array<[string, string, number]>): Promise<string> {
  const total = recipients.reduce((a, r) => a + r[2], 0);
  const c = await campaign(co, { success: total, fail: 0, sentAt });
  await pool.query(
    `INSERT INTO campaign_send_rollup (campaign_id, company_id, sent_at, sent_day, message_type, unit_cost, success, cells_state,
                                       seen_success, seen_fail, tried_success, tried_fail, rolled_at, matched)
     VALUES ($1::uuid, $2::uuid, $3::timestamptz, ($3::timestamptz AT TIME ZONE 'Asia/Seoul')::date, 'LMS', 30, $4, 'open', $4, 0, $4, 0, NOW(), $5)`,
    [c.id, co, sentAt, total, recipients.length]);
  for (const [cust, cell, sends] of recipients) {
    await pool.query(
      `INSERT INTO campaign_recipient_cells (campaign_id, company_id, customer_id, cell, sends, sent_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::timestamptz)`,
      [c.id, co, cust, cell, sends, sentAt]);
  }
  return c.id;
}
/** 칸 줄 = { 칸: [받은 고객, 성공 건수, 산 고객, 매출, 비용] } */
const cellResults = async (campaignId: string) => Object.fromEntries((await pool.query(
  `SELECT cell, recipients, sends, buyers, revenue, cost FROM campaign_cell_results WHERE campaign_id = $1::uuid`, [campaignId]))
  .rows.map((x: any) => [x.cell, [x.recipients, x.sends, x.buyers, Number(x.revenue), Number(x.cost)]]));
const buyersOf = async (campaignId: string) => Number((await pool.query(
  `SELECT COALESCE(SUM(buyers), 0)::int AS n FROM campaign_cell_results WHERE campaign_id = $1::uuid`, [campaignId])).rows[0].n);
const recipientRows = async (campaignId: string) => Number((await pool.query(
  `SELECT COUNT(*)::int AS n FROM campaign_recipient_cells WHERE campaign_id = $1::uuid`, [campaignId])).rows[0].n);
const anyone = (co: string, phone: string) => customer(co, phone, null, null);

describe('PG4 귀속 닫기 — 7일 창 · 발송 순서 · 주인 장부(설계서 S5 · D6 ~ D9)', () => {
  it('7일 창(몰 = 시각 · 원장 = 다음 날부터) · 칸 줄 · 비용 = 성공 건수 × 단가 · 낱행 삭제 · closed', async () => {
    const co = await company();
    const sent = await kstAt(12);
    const a = await anyone(co, '01000000001');
    const b = await anyone(co, '01000000002');
    const c = await anyone(co, '01000000003');
    const d = await anyone(co, '01000000004');
    const e = await anyone(co, '01000000005');
    const id = await openCampaign(co, sent.at, [[a, 'r0c0', 1], [b, 'r0c0', 2], [c, 'r1c1', 1], [d, 'nobuy', 1], [e, 'unknown', 1]]);
    await mall(co, a, plusHours(sent.at, 1), 10000);            // 창 안
    await mall(co, a, plusHours(sent.at, 8 * 24), 50000);       // 8일 뒤 = 창 밖
    await ledger(co, b, sent.day, 7000);                        // 발송한 날의 원장 구매 = 세지 않는다
    await ledger(co, b, await dayPlus(sent.day, 7), 20000);     // 7일째 = 창 안
    await ledger(co, b, await dayPlus(sent.day, 8), 90000);     // 8일째 = 창 밖
    await mall(co, c, plusHours(sent.at, -1), 4000);            // 발송 앞
    await mall(co, d, plusHours(sent.at, 7 * 24), 3000);        // 정확히 7일 = 창 안
    await ledger(co, e, await dayPlus(sent.day, 1), 5000);      // 정하지 못한 칸도 줄을 남긴다

    await closePass();
    expect(await cellResults(id)).toEqual({
      r0c0: [2, 3, 2, 30000, 90],
      r1c1: [1, 1, 0, 0, 30],
      nobuy: [1, 1, 1, 3000, 30],
      unknown: [1, 1, 1, 5000, 30],
    });
    expect(await recipientRows(id)).toBe(0);
    expect((await state(id)).cells_state).toBe('closed');
    const claims = (await pool.query(`SELECT customer_id, to_char(kst_day, 'YYYY-MM-DD') AS day FROM campaign_purchase_claims WHERE campaign_id = $1::uuid`, [id])).rows
      .map((x: any) => `${x.customer_id}|${x.day}`).sort();
    expect(claims).toEqual([`${a}|${sent.day}`, `${b}|${await dayPlus(sent.day, 7)}`, `${d}|${await dayPlus(sent.day, 7)}`, `${e}|${await dayPlus(sent.day, 1)}`].sort());
  });

  it('발송 뒤 10일이 지나기 전에는 닫지 않는다', async () => {
    const co = await company();
    const sent = await kstAt(9);
    const a = await anyone(co, '01000000001');
    const id = await openCampaign(co, sent.at, [[a, 'r0c0', 1]]);
    await closeDue();
    expect((await state(id)).cells_state).toBe('open');
    expect(await recipientRows(id)).toBe(1);
  });

  it('더 늦은 발송이 가져가는 구매 — 구매 앞에 받은 가장 늦은 발송 하나에만 센다 · 닫는 차례 = 맨 앞부터', async () => {
    const co = await company();
    const sa = await kstAt(13);
    const sb = await kstAt(12);
    const x = await anyone(co, '01000000001');
    const y = await anyone(co, '01000000002');
    const A = await openCampaign(co, sa.at, [[x, 'r0c0', 1], [y, 'r0c0', 1]]);
    const B = await openCampaign(co, sb.at, [[x, 'r0c0', 1]]);
    await mall(co, x, plusHours(sa.at, 2), 1000);     // A 뒤 · B 앞 → A
    await mall(co, x, plusHours(sb.at, 1), 2000);     // B 뒤(A 의 창 안이기도 하다) → B
    await mall(co, y, plusHours(sb.at, 1), 4000);     // y 는 B 를 받지 않았다 → A
    await closePass();
    expect((await state(A)).cells_state).toBe('closed');
    expect((await state(B)).cells_state).toBe('open');   // 한 바퀴 = 회사마다 맨 앞 하나
    expect(await cellResults(A)).toEqual({ r0c0: [2, 2, 2, 5000, 60] });
    await closePass();
    expect(await cellResults(B)).toEqual({ r0c0: [1, 1, 1, 2000, 30] });
  });

  it('(1R 반례) 정해지지 않은 캠페인이 사이에 있으면 닫지 않는다 → 14일 뒤 굳으면 구매는 뒤 캠페인 한 곳', async () => {
    const co = await company();
    const sa = await kstAt(17);
    const sc = await kstAt(16);
    const sb = await kstAt(15);
    const x = await anyone(co, '01000000001');
    const A = await openCampaign(co, sa.at, [[x, 'r0c0', 1]]);
    const C = await campaign(co, { success: 1, fail: 0, sentAt: sc.at, final: false });   // 확정이 미뤄져 굴려지지 않은 캠페인
    const B = await openCampaign(co, sb.at, [[x, 'r0c0', 1]]);
    await mall(co, x, plusHours(sb.at, 24), 8000);
    // 낱행이 열린 캠페인이 없는 다른 회사의 오래된 캠페인 = 굳히기가 줄을 만들지 않는다
    const other = await company();
    const lone = await campaign(other, { success: 1, fail: 0, sentAt: sc.at, final: false });

    await closePass();
    expect((await state(A)).cells_state).toBe('open');
    await skipStale();
    expect((await state(C.id)).cells_state).toBe('skipped');
    expect(await state(lone.id)).toBeUndefined();
    await closeDue();
    expect([(await state(A)).cells_state, (await state(B)).cells_state]).toEqual(['closed', 'closed']);
    expect([await buyersOf(A), await buyersOf(B)]).toEqual([0, 1]);
    // 굳은 캠페인은 그 뒤에 굴려져도 받은 고객을 만들지 않는다
    await pool.query(`UPDATE campaigns SET result_final = true WHERE id = $1::uuid`, [C.id]);
    await rollCampaign(C, tallyOf([['01000000001', true, '11']]));
    expect((await state(C.id)).cells_state).toBe('skipped');
    expect(await recipientRows(C.id)).toBe(0);
  });

  it('(2R 반례 가) 닫힌 뒤 같은 구매가 원장 → 몰 기록으로 바뀌어도 그 날짜의 주인은 하나', async () => {
    const co = await company();
    const sa = await kstAt(13);
    const sb = await kstAt(11);
    const x = await anyone(co, '01000000001');
    const A = await openCampaign(co, sa.at, [[x, 'r0c0', 1]]);
    const B = await openCampaign(co, sb.at, [[x, 'r0c0', 1]]);
    await ledger(co, x, sb.day, 9000);                 // B 를 보낸 날의 원장 구매(시각 모름) → A 의 것
    await closePass();
    expect([(await state(A)).cells_state, (await state(B)).cells_state]).toEqual(['closed', 'open']);
    expect(await buyersOf(A)).toBe(1);
    await pool.query(`DELETE FROM purchases WHERE company_id = $1::uuid`, [co]);
    await mall(co, x, plusHours(sb.at, 1), 9000);      // 같은 구매가 몰 기록(B 발송 1시간 뒤)으로 바뀜
    await closePass();
    expect((await state(B)).cells_state).toBe('closed');
    expect(await buyersOf(B)).toBe(0);
  });

  it('(2R 반례 나) 발송 시각이 같은 두 캠페인 · 다음 날 구매 = 발송 순서(시각 · 캠페인 id)가 뒤인 한 곳에만', async () => {
    const co = await company();
    const sent = await kstAt(12);
    const x = await anyone(co, '01000000001');
    const one = await openCampaign(co, sent.at, [[x, 'r0c0', 1]]);
    const two = await openCampaign(co, sent.at, [[x, 'r0c0', 1]]);
    await mall(co, x, plusHours(sent.at, 24), 6000);
    await closeDue();
    const [first, last] = [one, two].sort();           // uuid 의 순서 = 16진 글자 순서
    expect([await buyersOf(first), await buyersOf(last)]).toEqual([0, 1]);
  });

  it('보관 정리 — 닫히지 않은 채 30일 넘은 낱행 = 지우고 skipped · 40일 넘은 주인 장부 줄 · 400일 넘은 굴린 줄', async () => {
    const co = await company();
    const x = await anyone(co, '01000000001');
    const stuck = await openCampaign(co, (await kstAt(31)).at, [[x, 'r0c0', 1]]);
    const fresh = await openCampaign(co, (await kstAt(5)).at, [[x, 'r0c0', 1]]);
    await pool.query(
      `INSERT INTO campaign_purchase_claims (company_id, customer_id, kst_day, campaign_id)
       VALUES ($1::uuid, $2::uuid, (NOW() AT TIME ZONE 'Asia/Seoul')::date - 41, $3::uuid), ($1::uuid, $2::uuid, (NOW() AT TIME ZONE 'Asia/Seoul')::date - 39, $3::uuid)`,
      [co, x, stuck]);
    const ancient = randomUUID();
    await pool.query(
      `INSERT INTO campaign_send_rollup (campaign_id, company_id, sent_at, sent_day, cells_state)
       VALUES ($1::uuid, $2::uuid, NOW() - INTERVAL '401 days', (NOW() AT TIME ZONE 'Asia/Seoul')::date - 401, 'none')`, [ancient, co]);
    await pool.query(
      `INSERT INTO campaign_carrier_results (campaign_id, company_id, carrier, success, fail, sent_day)
       VALUES ($1::uuid, $2::uuid, 'SKT', 1, 0, (NOW() AT TIME ZONE 'Asia/Seoul')::date - 401)`, [ancient, co]);
    await pruneRollup();
    expect([(await state(stuck)).cells_state, await recipientRows(stuck)]).toEqual(['skipped', 0]);
    expect([(await state(fresh)).cells_state, await recipientRows(fresh)]).toEqual(['open', 1]);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM campaign_purchase_claims WHERE company_id = $1::uuid`, [co])).rows[0].n).toBe(1);
    expect(await state(ancient)).toBeUndefined();
    expect(await carriers(ancient)).toEqual({});
  });
});

// ── 읽기 · 일꾼 ──

/** 맞게 굴린(닫히지 않은) 캠페인의 상태 줄 + 통신사 줄을 표에 직접 놓는다 */
async function rolledCarriers(co: string, daysAgo: number, lines: Array<[string, number, number]>, drift = 0): Promise<string> {
  const sent = await kstAt(daysAgo);
  const c = await campaign(co, { success: 1, fail: 0, sentAt: sent.at });
  await pool.query(
    `INSERT INTO campaign_send_rollup (campaign_id, company_id, sent_at, sent_day, cells_state, drift) VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4::date, 'none', $5)`,
    [c.id, co, sent.at, sent.day, drift]);
  for (const [carrier, success, fail] of lines) {
    await pool.query(
      `INSERT INTO campaign_carrier_results (campaign_id, company_id, carrier, success, fail, sent_day) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::date)`,
      [c.id, co, carrier, success, fail, sent.day]);
  }
  return c.id;
}
/** 귀속이 닫힌 캠페인의 상태 줄 + 칸 줄을 표에 직접 놓는다 — cells = [칸, 받은 고객, 산 고객, 매출, 비용] */
async function closedCells(co: string, daysAgo: number, cells: Array<[string, number, number, number, number]>, o: { drift?: number; state?: string } = {}): Promise<void> {
  const sent = await kstAt(daysAgo);
  const c = await campaign(co, { success: 1, fail: 0, sentAt: sent.at });
  await pool.query(
    `INSERT INTO campaign_send_rollup (campaign_id, company_id, sent_at, sent_day, cells_state, drift) VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4::date, $5, $6)`,
    [c.id, co, sent.at, sent.day, o.state ?? 'closed', o.drift ?? 0]);
  for (const [cell, recipients, buyers, revenue, cost] of cells) {
    await pool.query(
      `INSERT INTO campaign_cell_results (campaign_id, company_id, cell, sent_day, recipients, sends, buyers, revenue, cost) VALUES ($1::uuid, $2::uuid, $3, $4::date, $5, $5, $6, $7, $8)`,
      [c.id, co, cell, sent.day, recipients, buyers, revenue, cost]);
  }
}

describe('PG5 읽기 — 통신사별 발송 성공률 · 고객 묶음별 성과(설계서 S3 · S6)', () => {
  it('통신사별 성공률 = 알뜰폰을 그 망에 더한다 · 미상 실패는 따로 · 최소 건수 · 30일 창 · 어긋난 캠페인 · 다른 회사는 뺀다', async () => {
    const co = await company();
    const other = await company();
    // SKT 90/10 + SKT 알뜰폰 45/5 → 135 ÷ 150 = 0.9 · KT 99건(최소 100 미만) · LGU 는 두 캠페인 합 100건 → 80 ÷ 100
    await rolledCarriers(co, 3, [['SKT', 90, 10], ['SKT_MVNO', 45, 5], ['KT', 98, 1], ['LGU', 50, 10], ['unknown', 0, 7], ['etc', 3, 2]]);
    await rolledCarriers(co, 10, [['LGU_MVNO', 30, 10], ['unknown', 0, 5]]);
    await rolledCarriers(co, 31, [['KT', 500, 0]]);                 // 창 밖
    await rolledCarriers(co, 2, [['KT', 500, 0]], 1);               // 어긋난 캠페인
    await rolledCarriers(other, 2, [['KT', 500, 0], ['unknown', 0, 99]]);
    expect(await readCarrierSendRates(co)).toEqual({ rates: [{ carrier: 'SKT', rate: 0.9 }, { carrier: 'LGU', rate: 0.8 }], unknownFail: 12 });
    // 업종 평균 스냅숏이 쓰는 SQL = 같은 줄 · 같은 접기 · 같은 최소 건수
    const sql = (await pool.query(CARRIER_NET_RATES_SQL, [CARRIER_WINDOW_DAYS, [co], CARRIER_MIN_SENT])).rows
      .map((x: any) => [x.net, Number(x.rate)]).sort();
    expect(sql).toEqual([['LGU', 0.8], ['SKT', 0.9]]);
  });

  it('묶음별 성과 = 닫힌 캠페인의 칸 합계를 묶음으로 · 1원당 매출 · 최소 받은 고객 · 정하지 못한 분은 따로 · 90일 창', async () => {
    const co = await company();
    const other = await company();
    // 요즘 단골(r0c1 · r1c2) = 받은 고객 20 + 15 = 35 · 산 고객 5 · 매출 300,000 · 비용 1,200 → 1원당 250원
    // 첫 구매 직후(r0c0) = 받은 고객 29(30 미만 = 숫자 없음)
    await closedCells(co, 20, [['r0c1', 20, 3, 200000, 700], ['r0c0', 29, 9, 90000, 870], ['unknown', 4, 1, 1000, 120]]);
    await closedCells(co, 40, [['r1c2', 15, 2, 100000, 500], ['unknown', 2, 0, 0, 60]]);
    await closedCells(co, 91, [['r0c1', 100, 50, 9000000, 3000]]);                       // 창 밖
    await closedCells(co, 5, [['r0c1', 100, 50, 9000000, 3000]], { drift: 2 });          // 어긋난 캠페인
    await closedCells(co, 5, [['r0c1', 100, 50, 9000000, 3000]], { state: 'open' });     // 닫히지 않은 캠페인
    await closedCells(other, 5, [['r0c1', 100, 50, 9000000, 3000]]);
    const out = await readGroupPerformance(co);
    expect(out.unknown).toBe(6);
    expect(out.groups.map((g) => g.group)).toEqual(['leave', 'rest', 'fade', 'next', 'loyal', 'new', 'nobuy']);
    expect(out.groups.find((g) => g.group === 'loyal')).toEqual({ group: 'loyal', name: '요즘 단골', desc: '석 달 안에 사셨고 두 번 이상 산 분', recipients: 35, buyers: 5, revenue: 300000, cost: 1200, perWon: 250 });
    expect(out.groups.find((g) => g.group === 'new')).toEqual({ group: 'new', name: '첫 구매 직후', desc: '한 달 안에 처음 산 분', recipients: 29, buyers: null, revenue: null, cost: null, perWon: null });
    expect(out.groups.find((g) => g.group === 'leave')?.recipients).toBe(0);
  });
});

describe('PG6 일꾼 한 회차 — 닫기는 언제나 · 낱행 읽기는 단계가 열린 회사만(설계서 S7)', () => {
  it('단계가 닫혀 있으면 낱행을 읽지 않는다 · 그래도 닫을 수 있는 귀속은 닫는다', async () => {
    const co = await company();
    const x = await anyone(co, '01000000001');
    const due = await openCampaign(co, (await kstAt(12)).at, [[x, 'r0c0', 1]]);
    const fresh = await campaign(co, { success: 1, fail: 0 });
    let reads = 0;
    const out = await runRollupTick({ liveIds: async () => [], read: async () => { reads++; return newTally(); } });
    expect(reads).toBe(0);
    expect(out.rolled).toBe(0);
    expect((await state(due)).cells_state).toBe('closed');
    expect(await state(fresh.id)).toBeUndefined();
  });

  it('단계가 열린 회사의 캠페인만 굴린다 · 읽기가 던지면 실패 시도로 적고 다음 캠페인으로 간다', async () => {
    const co = await company();
    const other = await company();
    const good = await campaign(co, { success: 1, fail: 0, sentHoursAgo: 9 });
    const broken = await campaign(co, { success: 2, fail: 0, sentHoursAgo: 8 });
    const notMine = await campaign(other, { success: 1, fail: 0 });
    const out = await runRollupTick({
      liveIds: async () => [co],
      read: async (c) => {
        if (c.id === broken.id) throw new Error('시간 초과');
        return tallyOf([['01000000001', true, '11']]);
      },
    });
    expect([out.rolled, out.failed]).toEqual([1, 1]);
    expect((await state(good.id)).drift).toBe(0);
    const b = await state(broken.id);
    expect([b.drift !== 0, b.tries, b.cells_state, b.tried_success]).toEqual([true, 1, 'pending', 2]);
    expect(await carriers(broken.id)).toEqual({});
    expect(await state(notMine.id)).toBeUndefined();
  });

  it('낱행 읽기 = 결과 표는 전 행 · 대기 전용 라이브는 만료 실패만 · 줄 번호를 이어 끝까지', async () => {
    const co = await company();
    const c = await campaign(co, { success: 1, fail: 0 });
    const calls: Array<[string, number, boolean]> = [];
    const page = (n: number, from: number): LedgerRow[] => Array.from({ length: n }, (_, i) => ({ seqno: from + i + 1, dest_no: `0100000${String(from + i).padStart(4, '0')}`, status_code: OK, mob_company: '11' }));
    const t = await readCampaignTally(c, async (table, _id, after, limit, expiredOnly) => {
      calls.push([table, after, expiredOnly]);
      expect(limit).toBe(ROLL_PAGE);
      if (table === 'SMSQ_SEND_1_202611') return after === 0 ? page(ROLL_PAGE, 0) : after === ROLL_PAGE ? page(3, ROLL_PAGE) : [];
      return [{ seqno: 9, dest_no: '01099990000', status_code: FAILED, mob_company: '' }];
    }, async () => ['SMSQ_SEND_1', 'SMSQ_SEND_1_202611', 'SMSQ_SEND_13']);
    // SMSQ_SEND_1 은 이력 짝이 있는 라이브(대기 전용) · SMSQ_SEND_13 은 짝이 없는 라이브(결과 표)
    expect(calls).toEqual([
      ['SMSQ_SEND_1_202611', 0, false], ['SMSQ_SEND_1_202611', ROLL_PAGE, false],
      ['SMSQ_SEND_13', 0, false],
      ['SMSQ_SEND_1', 0, true],
    ]);
    expect([t.success, t.fail, t.carriers.get('unknown')?.fail]).toEqual([ROLL_PAGE + 3, 2, 2]);
  });

  it('굴리기 단계가 열린 회사 = ENV 명단은 후보 · 회사마다 다시 판정 · 명단이 비면 조회도 하지 않는다', async () => {
    clearRollupLiveMemo();
    const a = await company();
    const b = await company();
    await campaign(a, { success: 1, fail: 0 });
    await campaign(b, { success: 1, fail: 0 });
    let asked = 0;
    expect(await rollupLiveCompanyIds({}, async () => { asked++; return true; })).toEqual([]);
    expect(asked).toBe(0);
    const ids = await rollupLiveCompanyIds({ V3_STAGE_ROLLUP: `${a},${b}` }, async (id) => id === a);
    expect(ids).toEqual([a]);
    clearRollupLiveMemo();
  });

  it('읽지 못한 굴림 = 같은 합계로 세 번까지 · 통신사 줄은 그대로', async () => {
    const co = await company();
    const c = await campaign(co, { success: 1, fail: 0 });
    await rollCampaign(c, tallyOf([['01000000001', true, '16']]));
    await setCounts(c.id, 2, 0);
    await failRoll(c);
    await failRoll(c);
    const s2 = await state(c.id);
    expect([s2.tries, s2.cells_state, s2.drift !== 0]).toEqual([2, 'none', true]);
    expect(await carriers(c.id)).toEqual({ KT: [1, 0] });
  });
});

describe('PG8 업종 평균 — 통신사별 발송 성공률 지표(설계서 S3 · S6)', () => {
  beforeAll(async () => {
    await pool.query(ledgerBlockSql('C133-DDL-4'));
  });

  it('스냅숏 = 굴리기 단계가 열린 회사의 통신사 줄만 · 읽기 = 내 값은 굴린 줄 · 평균은 다른 회사가 5곳 이상일 때만', async () => {
    const IND = `c154-${randomUUID().slice(0, 8)}`;
    const mk = async (industry: string) => { const id = randomUUID(); await insertMinimalRow(pool, 'companies', { id, status: 'active', industry_code: industry }); return id; };
    const me = await mk(IND);
    const peers = [await mk(IND), await mk(IND), await mk(IND), await mk(IND), await mk(IND)];
    const closedStage = await mk(IND);
    const lonely = await mk(`${IND}-solo`);
    await rolledCarriers(me, 2, [['SKT', 180, 20], ['KT', 50, 0], ['unknown', 0, 3]]);   // SKT 0.9 · KT 50건 = 최소 건수 미만
    const peerRates = [[80, 20], [84, 16], [88, 12], [92, 8], [96, 4]];                  // 0.80 ~ 0.96 → 산술 평균 0.88
    for (let i = 0; i < peers.length; i++) await rolledCarriers(peers[i], 2, [['SKT', peerRates[i][0], peerRates[i][1]]]);
    await rolledCarriers(closedStage, 2, [['SKT', 100, 0]]);                            // 단계가 닫힌 회사 = 지표 행 없음
    await rolledCarriers(lonely, 2, [['LGU_MVNO', 99, 1]]);

    await snapshotBenchmarks([me, ...peers, lonely]);
    const rows = (await pool.query(
      `SELECT company_id, metric, value FROM benchmark_company_daily WHERE industry_code LIKE $1 AND metric LIKE 'send_success:%'`, [`${IND}%`])).rows;
    expect(rows.map((r: any) => `${r.company_id}|${r.metric}`).sort())
      .toEqual([`${me}|send_success:SKT`, ...peers.map((p) => `${p}|send_success:SKT`), `${lonely}|send_success:LGU`].sort());

    const v = await readSendSuccess(me);
    expect(v?.unknownFail).toBe(3);
    expect(v?.sendSuccess.length).toBe(1);
    const skt: any = v?.sendSuccess[0];
    expect([skt.carrier, skt.available, skt.mine]).toEqual(['SKT', true, 0.9]);
    expect(skt.avg).toBeCloseTo(0.88, 10);
    expect(skt.diff).toBeCloseTo(0.02, 10);
    // 업종에 혼자 = 평균 없이 내 값만(다른 회사 수는 싣지 않는다)
    expect((await readSendSuccess(lonely))?.sendSuccess).toEqual([{ carrier: 'LGU', available: false, reason: 'few_peers', mine: 0.99 }]);
    // 단계가 닫힌 회사는 주소가 이 함수를 부르지 않는다 — 스냅숏 행이 없어 다른 회사의 평균에도 들지 않는다(위 rows)
  });
});

describe('PG9 구현 Codex 1R — 닫기 전 합계 대조 · 읽기 예산', () => {
  it('굴린 뒤 PG 합계가 바뀐 캠페인 = 옛 낱행으로 닫지 않는다 → 다시 굴려 늦은 성공을 더한 뒤에 닫힌다', async () => {
    const co = await company();
    const sent = await kstAt(12);
    const x = await anyone(co, '01000000001');
    const y = await anyone(co, '01000000002');
    const id = await openCampaign(co, sent.at, [[x, 'r0c0', 1]]);
    await mall(co, y, plusHours(sent.at, 2), 5000);            // 늦게 성공한 y 의 구매
    await setCounts(id, 2, 0);                                 // 굴린 뒤 늦은 결과가 들어왔다(맞게 굴린 합계 1 ≠ 지금 2)
    await closeDue();
    expect((await state(id)).cells_state).toBe('open');        // 기다린다
    expect(await cellResults(id)).toEqual({});
    // 다시 굴림 = 늦게 성공한 번호가 낱행에 더해진다(open) → 그 뒤에 닫힌다
    const c: RollupCampaign = { id, companyId: co, sentAt: new Date(sent.at), messageType: 'LMS', createdBy: null, sendConfig: null, scheduledAt: null, createdAt: null };
    expect(await rollCampaign(c, tallyOf([['01000000001', true, '11'], ['01000000002', true, '11']]))).toBe('ok');
    await closeDue();
    expect((await state(id)).cells_state).toBe('closed');
    const r = await pool.query(`SELECT COALESCE(SUM(recipients), 0)::int AS recipients, COALESCE(SUM(buyers), 0)::int AS buyers FROM campaign_cell_results WHERE campaign_id = $1::uuid`, [id]);
    expect([r.rows[0].recipients, r.rows[0].buyers]).toEqual([2, 1]);
  });

  it('14일이 지나도록 합계가 안 맞는 캠페인 = 귀속에서 뺀다(skipped · 낱행 삭제 · 칸 줄 없음) · 뒤 캠페인은 닫힌다', async () => {
    const co = await company();
    const x = await anyone(co, '01000000001');
    const stuck = await openCampaign(co, (await kstAt(15)).at, [[x, 'r0c0', 1]]);
    const next = await openCampaign(co, (await kstAt(12)).at, [[x, 'r0c0', 1]]);
    await setCounts(stuck, 3, 0);
    // 어긋남이 적힌 채 남은 캠페인도 같은 갈래(굴린 합 ≠ PG 합)
    await closeDue();
    expect([(await state(stuck)).cells_state, await recipientRows(stuck)]).toEqual(['skipped', 0]);
    expect(await cellResults(stuck)).toEqual({});
    expect((await state(next)).cells_state).toBe('closed');
  });

  it('어긋남(drift)이 적힌 캠페인은 합계가 같아 보여도 닫지 않는다', async () => {
    const co = await company();
    const x = await anyone(co, '01000000001');
    const id = await openCampaign(co, (await kstAt(11)).at, [[x, 'r0c0', 1]]);
    await pool.query(`UPDATE campaign_send_rollup SET drift = 2 WHERE campaign_id = $1::uuid`, [id]);
    await closeDue();
    expect((await state(id)).cells_state).toBe('open');
  });

  it('읽기 예산: 시각을 넘겼으면 쪽을 읽기 전에 멈춘다 · 쪽 사이에서도 멈춘다(센 값은 버린다)', async () => {
    const co = await company();
    const c = await campaign(co, { success: 1, fail: 0 });
    let calls = 0;
    await expect(readCampaignTally(c, async () => { calls++; return []; }, async () => ['SMSQ_SEND_13'], Date.now() - 1)).rejects.toBeInstanceOf(RollBudgetExceeded);
    expect(calls).toBe(0);
    // 첫 쪽은 읽고(가득 찬 쪽) 둘째 쪽 앞에서 예산이 끝난다
    const full: LedgerRow[] = Array.from({ length: ROLL_PAGE }, (_, i) => ({ seqno: i + 1, dest_no: '01000000001', status_code: OK, mob_company: '11' }));
    const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 60)); return full; };
    await expect(readCampaignTally(c, slow, async () => ['SMSQ_SEND_13'], Date.now() + 20)).rejects.toBeInstanceOf(RollBudgetExceeded);
    expect(calls).toBe(1);
  });

  it('표 목록 조회가 끝나지 않아도 읽기 예산에서 끊긴다(쪽 읽기 0 · 회차가 붙잡히지 않는다)', async () => {
    const co = await company();
    const c = await campaign(co, { success: 1, fail: 0 });
    let calls = 0;
    const t0 = Date.now();
    await expect(readCampaignTally(c, async () => { calls++; return []; }, () => new Promise<string[]>(() => undefined), Date.now() + 40)).rejects.toBeInstanceOf(RollBudgetExceeded);
    expect(calls).toBe(0);
    expect(Date.now() - t0).toBeLessThan(3000);
    // 늦게 거절되는 표 목록 조회 = 처리 안 된 거절을 남기지 않는다
    await expect(readCampaignTally(c, async () => [], () => new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error('late')), 80)), Date.now() + 20)).rejects.toBeInstanceOf(RollBudgetExceeded);
    await new Promise((r) => setTimeout(r, 120));
    // 예산이 넉넉하면 그대로 읽는다
    expect((await readCampaignTally(c, async () => [], async () => ['SMSQ_SEND_13'], Date.now() + 5000)).rows).toBe(0);
  });

  it('회차: 첫 캠페인이 아닌 캠페인의 시간 모자람 = 실패 시도로 적지 않고 회차를 끝낸다 · 첫 캠페인의 시간 모자람 = 실패 시도', async () => {
    const co = await company();
    const first = await campaign(co, { success: 1, fail: 0, sentHoursAgo: 9 });
    const second = await campaign(co, { success: 1, fail: 0, sentHoursAgo: 8 });
    const third = await campaign(co, { success: 1, fail: 0, sentHoursAgo: 7 });
    const seen: string[] = [];
    const out = await runRollupTick({
      liveIds: async () => [co],
      read: async (c) => {
        seen.push(c.id);
        if (c.id === second.id) throw new RollBudgetExceeded();
        return tallyOf([['01000000001', true, '11']]);
      },
    });
    expect(seen).toEqual([first.id, second.id]);              // 셋째는 이번 회차에 시작하지 않는다
    expect([out.rolled, out.failed]).toEqual([1, 0]);
    expect(await state(second.id)).toBeUndefined();            // 시도 횟수를 쓰지 않았다 = 다음 회차에 앞 차례로 온다
    expect(await state(third.id)).toBeUndefined();
    // 다음 회차: 둘째가 첫 캠페인이 된다 · 거기서도 시간이 모자라면 실패 시도로 적는다
    const out2 = await runRollupTick({ liveIds: async () => [co], read: async () => { throw new RollBudgetExceeded(); } });
    expect(out2.failed).toBe(1);
    const s = await state(second.id);
    expect([s.tries, s.drift !== 0]).toEqual([1, true]);
    expect(await state(third.id)).toBeUndefined();
  });
});
