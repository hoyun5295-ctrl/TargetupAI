// replaces: none
/**
 * 진입 구매 취소 · 환불 = 그 실행 끝 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-4 ②)
 *
 * 판정 문장(ENTRY_PURCHASE_VOIDED_SQL) = 진입 표식(__entry.src = 'trigger' · key = 사건 id)의 구매가 지금 결제된 구매(netPurchaseSql)가 아니면 고른다.
 * 넘겨받은 진입 · 표식 없음 · 깨진 key = 고르지 않는다(형 변환 오류 0).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ENTRY_PURCHASE_VOIDED_SQL } from '../journey-goal-purchase';

const CO = randomUUID();
const OWNER = randomUUID();
const J = randomUUID();
const EV_PAID = randomUUID();
const EV_CANCEL = randomUUID();
const X = { paid: randomUUID(), cancelled: randomUUID(), after: randomUUID(), bare: randomUUID(), badKey: randomUUID() };

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '진입 구매 취소 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: 't-1102-voided' });
  await insertMinimalRow(pool, 'journeys', { id: J, company_id: CO, created_by: OWNER, name: '구매 감사', status: 'active', start_kind: 'event', trigger_event: 'cdp.purchase' });
  const cust: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    cust.push(id);
    await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000110${i}`, is_active: true });
  }
  const paidProps = { revenue_applied: true, status: 'paid' };
  await insertMinimalRow(pool, 'cdp_events', { id: EV_PAID, company_id: CO, customer_id: cust[0], event_name: 'purchase', source: 'test', properties: paidProps });
  await insertMinimalRow(pool, 'cdp_events', { id: EV_CANCEL, company_id: CO, customer_id: cust[1], event_name: 'purchase', source: 'test', properties: paidProps });
  const entry = (src: string, key: string | null) => JSON.stringify({ __entry: { src, key } });
  const rows: Array<[string, string, string]> = [
    [X.paid, cust[0], entry('trigger', EV_PAID)],
    [X.cancelled, cust[1], entry('trigger', EV_CANCEL)],
    [X.after, cust[2], entry('after', EV_CANCEL)],
    [X.bare, cust[3], '{}'],
    [X.badKey, cust[4], entry('trigger', 'not-a-uuid')],
  ];
  for (const [id, c, props] of rows) {
    await insertMinimalRow(pool, 'journey_executions', { id, journey_id: J, customer_id: c, current_step_order: 0, status: 'active', entry_event_properties: props });
  }
  // 들어온 뒤 취소(주문 CT 의 차감 표식 = 같은 사건 행)
  await pool.query(`UPDATE cdp_events SET properties = properties || '{"revenue_reversed": true, "status": "cancelled"}'::jsonb WHERE id = $1`, [EV_CANCEL]);
});

describe('3-4 ② 진입 구매 취소 판정', () => {
  it('취소된 진입 구매만 고른다(결제 그대로 · 넘겨받은 진입 · 표식 없음 · 깨진 key = 0)', async () => {
    const r = await pool.query(ENTRY_PURCHASE_VOIDED_SQL, [Object.values(X), CO]);
    expect(r.rows.map((x) => String(x.id))).toEqual([X.cancelled]);
  });

  it('다른 회사 사건 = 고르지 않는다 · 끝난 실행 = 고르지 않는다', async () => {
    expect((await pool.query(ENTRY_PURCHASE_VOIDED_SQL, [Object.values(X), randomUUID()])).rows).toEqual([]);
    await pool.query(`UPDATE journey_executions SET status = 'ended' WHERE id = $1`, [X.cancelled]);
    expect((await pool.query(ENTRY_PURCHASE_VOIDED_SQL, [Object.values(X), CO])).rows).toEqual([]);
  });
});
