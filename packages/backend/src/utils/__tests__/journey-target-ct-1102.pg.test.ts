// replaces: none
/**
 * 여정 대상 컨트롤타워 = 트리거별 SQL 한 벌 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-01-journey-automarketing-engine-design.md §16 G2)
 *
 * 목록(selectJourneyTargetCustomerIds) · 전원 집계(countJourneyTargets · averageTargetScores) · 켜기 매장번호 확인(storeCallbackExposure)이
 * 같은 대상 SQL 을 돌린다 = 집계에 상한 0 · 매장번호 판정 = 실행기와 같은 함수(isCallbackRegistered · 여정 만든 계정).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import {
  selectJourneyTargetCustomerIds, buildJourneyTargetQuery, countJourneyTargets, averageTargetScores, storeCallbackExposure, countJourneyTargetCustomers,
} from '../journey-target-extractor';
import { isCallbackRegistered } from '../callback-filter';

const CO = randomUUID();
const OWNER = randomUUID();
const N = 1205;
const REG = '0211112222';
const UNREG1 = '0233334444';
const UNREG2 = '0255556666';

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '대상 CT 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: 't-1102-target-ct' });
  const seed = randomUUID();
  await insertMinimalRow(pool, 'customers', { id: seed, company_id: CO, phone: '01077770000', is_active: true, sms_opt_in: true });
  await pool.query(
    `INSERT INTO customers SELECT (jsonb_populate_record(NULL::customers, to_jsonb(c) || jsonb_build_object('id', gen_random_uuid(), 'phone', '0107' || lpad(g::text, 7, '0')))).*
       FROM customers c, generate_series(1, $2::int) g WHERE c.id = $1::uuid`,
    [seed, N - 1],
  );
  // 이관 유예(방금 들어온 고객 = 상시 대상에서 뺀다) 밖으로 = 60일 전에 들어온 고객
  await pool.query(`UPDATE customers SET created_at = NOW() - INTERVAL '60 days' WHERE company_id = $1`, [CO]);
  // 등급 · 휴면 · 매장번호 분포(같은 고객 집합 안)
  await pool.query(`UPDATE customers SET grade = CASE WHEN right(phone, 1) IN ('1', '2') THEN 'VIP' ELSE NULL END WHERE company_id = $1`, [CO]);
  await pool.query(`UPDATE customers SET recent_purchase_date = (NOW() AT TIME ZONE 'Asia/Seoul')::date - 40 WHERE company_id = $1 AND right(phone, 1) IN ('3', '4', '5')`, [CO]);
  await pool.query(`UPDATE customers SET store_phone = CASE right(phone, 1) WHEN '6' THEN $2 WHEN '7' THEN $3 WHEN '8' THEN $4 ELSE NULL END WHERE company_id = $1`, [CO, REG, UNREG1, UNREG2]);
  await insertMinimalRow(pool, 'sender_numbers', { id: randomUUID(), company_id: CO, phone_number: REG, is_active: true });
});

describe('§16 G2 대상 SQL 한 벌', () => {
  it('목록 상한 = 그 수 · 전원(LIMIT NULL) = 집계 수 · 미리보기 수 = 전원(capped 거짓)', async () => {
    const few = await selectJourneyTargetCustomerIds(CO, 'custom', {}, 100);
    expect(few).toHaveLength(100);
    const q = await buildJourneyTargetQuery(CO, 'custom', {}, null);
    expect(q).not.toBeNull();
    expect(q!.params[q!.params.length - 1]).toBeNull();   // LIMIT 값 = null = 전원
    const all = (await pool.query(q!.sql, q!.params)).rows.map((r) => String(r.customer_id));
    expect(all).toHaveLength(N);
    const cnt = await countJourneyTargets(CO, 'custom', {});
    expect(cnt.total).toBe(N);
    expect(cnt.segments.reduce((n, s: any) => n + Number(s.count ?? s.cnt ?? 0), 0) || cnt.total).toBe(N);
    const legacy = await countJourneyTargetCustomers(CO, 'custom', {});
    expect(legacy).toMatchObject({ total: N, capped: false });
  });

  it('휴면 갈래 = 목록과 집계가 같은 사람(같은 SQL)', async () => {
    const f = { dormant_days: 30, include_existing: true };
    const ids = await selectJourneyTargetCustomerIds(CO, 'customer.dormant', f, 1_000_000);
    const cnt = await countJourneyTargets(CO, 'customer.dormant', f);
    expect(ids.length).toBeGreaterThan(0);
    expect(cnt.total).toBe(ids.length);
    const avg = await averageTargetScores(CO, 'customer.dormant', f);
    expect(avg).toHaveProperty('avgOrderValue');
  });

  it('바로 0명 갈래 = null(목록 0 · 집계 0)', async () => {
    expect(await buildJourneyTargetQuery(CO, 'customer.grade_changed', {}, 10)).toBeNull();   // journeyId 없음
    expect(await buildJourneyTargetQuery(CO, 'no.such.trigger', {}, 10)).toBeNull();
    expect((await countJourneyTargets(CO, 'no.such.trigger', {})).total).toBe(0);
  });

  it('켜기 매장번호 확인 = 대상 전원 · 실행기와 같은 판정(번호마다 isCallbackRegistered)', async () => {
    const r = await storeCallbackExposure(CO, 'custom', {}, OWNER);
    const per = await pool.query(
      `SELECT btrim(store_phone) AS p, COUNT(*)::int AS n FROM customers WHERE company_id = $1 AND COALESCE(btrim(store_phone), '') <> '' GROUP BY 1`, [CO]);
    let expected = 0;
    for (const row of per.rows) if (!(await isCallbackRegistered(CO, String(row.p), OWNER))) expected += Number(row.n);
    expect(r.callbackUnregisteredCount).toBe(expected);
    expect(r.callbackUnregisteredCount).toBeGreaterThan(0);
    expect(r.unregisteredDetails.map((d) => d.phone).sort()).toEqual([UNREG1, UNREG2].sort());
    expect(r.unregisteredDetails.find((d) => d.phone === REG)).toBeUndefined();
    expect(r.unregisteredDetails[0].excludedCount).toBeGreaterThanOrEqual(r.unregisteredDetails[1].excludedCount);
  });
});
