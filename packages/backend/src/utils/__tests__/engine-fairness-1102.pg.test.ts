// replaces: none
/**
 * 엔진 재설계 E1-3 · E2-3 · E2-4 새 SQL — 실 PostgreSQL 판(★ 2026-11-02 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 * 운영 문장을 글자 그대로 돌린다:
 *   - 사건 · 원장 문 나이 = 도착 기준(소급 적재만 거름 · 우리가 늦게 처리해도 버리지 않음) · 원장 두 칸 = 시간대 없는 칸(한국 벽시계 · 세션 시간대 벽시계)
 *   - 스팸 검사 큐 머리 = (줄 · 회사)마다 가장 오래된 queued 한 건
 *   - 자동마케팅 발송 패스 = 생성 중 운영자의 예약 제안을 LIMIT 앞에서 뺀다
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { selectCdpEventRowsForCursor, selectPurchaseLedgerRowsForCursor } from '../journey-target-extractor';
import { spamQueueHeads } from '../spam-test-queue';
import { dueScheduledProposals } from '../continuous-operator';

const CO = randomUUID();
const CO2 = randomUUID();
const OWNER = randomUUID();
const CUST = randomUUID();
const H = (n: number) => `${n} hours`;

beforeAll(async () => {
  for (const co of [CO, CO2]) await insertMinimalRow(pool, 'companies', { id: co });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1103', login_id: 't-1102-fair' });
  await insertMinimalRow(pool, 'customers', { id: CUST, company_id: CO, phone: '01000007300', is_active: true, sms_opt_in: true });
});

describe('E1-3 나이 = 도착 기준(실 PG)', () => {
  it('사건 문 = 발생이 도착보다 72시간 넘게 앞선 것(소급)만 거른다 · 4일 전에 도착한 4일 전 사건(우리가 밀림)은 받는다', async () => {
    const put = async (occurredAgo: string, createdAgo: string) => {
      const id = randomUUID();
      await insertMinimalRow(pool, 'cdp_events', { id, company_id: CO, customer_id: CUST, event_name: 'purchase', properties: { revenue_applied: true, status: 'paid' } });   // ★ 2026-11-02 진입 커서 = 결제된 구매(CT-J3 · 설계서 3-4 ①)
      await pool.query(`UPDATE cdp_events SET occurred_at = NOW() - $2::interval, created_at = NOW() - $3::interval WHERE id = $1::uuid`, [id, occurredAgo, createdAgo]);
      return id;
    };
    const backfill = await put(H(120), H(0));
    const lateUs = await put(H(96), H(96));
    const fresh = await put(H(0), H(0));
    const rows = await selectCdpEventRowsForCursor(CO, 'purchase', {}, { at: new Date(Date.now() - 10 * 86400_000), eventId: null, axis: 'created_at' }, new Date(Date.now() + 60_000), 72, 1000);
    const ids = rows.map((r) => r.eventId);
    expect(ids).toContain(lateUs);
    expect(ids).toContain(fresh);
    expect(ids).not.toContain(backfill);
  });
  it('원장 문 = 같은 규약(한국 벽시계 구매일 · 세션 시간대 벽시계 도착) · 미래 구매 = 여전히 거름', async () => {
    const put = async (purchaseAgo: string, createdAgo: string) => {
      const id = randomUUID();
      await insertMinimalRow(pool, 'purchases', { id, company_id: CO, customer_id: CUST });
      await pool.query(
        `UPDATE purchases SET purchase_date = ((NOW() - $2::interval) AT TIME ZONE 'Asia/Seoul'),
                              created_at = ((NOW() - $3::interval) AT TIME ZONE current_setting('TimeZone'))
          WHERE id = $1::uuid`, [id, purchaseAgo, createdAgo]);
      return id;
    };
    const backfill = await put(H(120), H(0));
    const lateUs = await put(H(96), H(96));
    const fresh = await put(H(1), H(0));
    const future = await put(H(-5), H(0));
    const rows = await selectPurchaseLedgerRowsForCursor(CO, {}, { at: new Date(Date.now() - 10 * 86400_000) }, new Date(Date.now() + 60_000), 72, 1000);
    const ids = rows.map((r) => r.eventId);
    expect(ids).toContain(lateUs);
    expect(ids).toContain(fresh);
    expect(ids).not.toContain(backfill);
    expect(ids).not.toContain(future);
  });
});

describe('E2-4 스팸 검사 큐 머리(실 PG)', () => {
  it('(줄 · 회사)마다 가장 오래된 queued 한 건 · manual · trial = 사람 줄 · 그 밖 = 자동 줄 · queued 아닌 것 = 뺌', async () => {
    const put = async (co: string, source: string, ago: string, status = 'queued') => {
      const id = randomUUID();
      await insertMinimalRow(pool, 'spam_filter_tests', { id, company_id: co, user_id: OWNER, callback_number: '0212345678', status, source });
      await pool.query(`UPDATE spam_filter_tests SET created_at = NOW() - $2::interval WHERE id = $1::uuid`, [id, ago]);
      return id;
    };
    const aOld = await put(CO, 'auto_ai', H(3));
    await put(CO, 'auto_ai', H(2));
    const aManual = await put(CO, 'manual', H(1));
    const bTrial = await put(CO2, 'trial', H(5));
    await put(CO2, 'trial', H(6), 'completed');
    const bAuto = await put(CO2, 'auto_ai_free', H(1));
    const heads = (await spamQueueHeads()).filter((h) => h.companyId === CO || h.companyId === CO2);
    expect(heads.map((h) => [h.id, h.lane]).sort()).toEqual([[aOld, 1], [aManual, 0], [bTrial, 0], [bAuto, 1]].sort());
    await pool.query(`DELETE FROM spam_filter_tests WHERE company_id = ANY($1::uuid[])`, [[CO, CO2]]);
  });
});

describe('E2-3 자동마케팅 발송 패스 = 생성 중 운영자 제외(실 PG)', () => {
  it('예약 · 때가 된 제안 중 생성 중 운영자 것은 LIMIT 앞에서 빠진다 · 빈 목록 = 전부', async () => {
    const OP1 = randomUUID();
    const OP2 = randomUUID();
    for (const op of [OP1, OP2]) await insertMinimalRow(pool, 'continuous_operators', { id: op, company_id: CO, status: 'active' });
    const prop = async (op: string) => {
      const id = randomUUID();
      await insertMinimalRow(pool, 'operator_proposals', { id, operator_id: op, company_id: CO, status: 'scheduled', proposal_json: {} });
      await pool.query(`UPDATE operator_proposals SET scheduled_send_at = NOW() - INTERVAL '1 minute' WHERE id = $1::uuid`, [id]);
      return id;
    };
    const p1 = await prop(OP1);
    const p2 = await prop(OP2);
    // ★ 2026-11-02 §16 G5 — 회사마다 대표 하나(가장 이른 회차) · 집은 회차를 빼면 같은 회사 다음 회차 · 지금 보내는 회사는 빠진다
    const first = (await dueScheduledProposals(100, [])).rows.map((r) => r.id).filter((id) => id === p1 || id === p2);
    expect(first).toHaveLength(1);
    const second = (await dueScheduledProposals(100, [], first)).rows.map((r) => r.id);
    expect(second).toContain(first[0] === p1 ? p2 : p1);
    expect((await dueScheduledProposals(100, [], [], [CO])).rows.map((r) => r.id)).not.toEqual(expect.arrayContaining([p1]));
    const without = (await dueScheduledProposals(100, [OP1])).rows.map((r) => r.id);
    expect(without).toContain(p2);
    expect(without).not.toContain(p1);
  });

  it('★ §16 G5 작은 회차(받는 분 1만 이하)가 큰 회차보다 먼저 · 회사 사이는 그다음 이른 순', async () => {
    const OP3 = randomUUID();
    await insertMinimalRow(pool, 'continuous_operators', { id: OP3, company_id: CO2, status: 'active' });
    const mk = async (op: string, co: string, rc: number, ago: string) => {
      const id = randomUUID();
      await insertMinimalRow(pool, 'operator_proposals', { id, operator_id: op, company_id: co, status: 'scheduled', proposal_json: {}, recipient_count: rc });
      await pool.query(`UPDATE operator_proposals SET scheduled_send_at = NOW() - $2::interval WHERE id = $1::uuid`, [id, ago]);
      return id;
    };
    await pool.query(`UPDATE operator_proposals SET status = 'sent' WHERE status = 'scheduled'`);
    const OP4 = randomUUID();
    await insertMinimalRow(pool, 'continuous_operators', { id: OP4, company_id: CO, status: 'active' });
    const bigOld = await mk(OP4, CO, 500_000, '30 minutes');
    const smallNew = await mk(OP3, CO2, 300, '1 minute');
    const order = (await dueScheduledProposals(10, [])).rows.map((r) => r.id);
    expect(order.indexOf(smallNew)).toBeLessThan(order.indexOf(bigOld));
  });
});
