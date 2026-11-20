// replaces: none
/**
 * 그룹웨어 오류접수 넷 + AI 한줄로 접수 — 실 PostgreSQL(★ 2026-11-20 설계서 docs/2026-11-20-staff-tickets-four-design.md §4 실 PG)
 *
 *   R100 days_passed(「N일 이상 지남」) · 회사 날짜 칸 days_within · days_passed = 실제 SQL 이 맞는 고객만 고른다
 *        경계 = 오늘(KST) − N 그날 포함 · 칸이 빈 고객(NULL · 회사 칸 없음) = 빠짐 · 두 입력 형식(mixed = 자동마케팅 · AI 한줄로 / structured = 직접 타겟 · 세그먼트)
 *   R101 표 밖 기준 = AND FALSE 가 실 PG 에서 돌고 0명(옛 = 그 조건이 빠진 회사 전체) · mixed 나이 gte = 옮김
 *        세그먼트 저장 = 깨진 조건이면 400 · 행 0
 *   자동발송(auto-campaigns) 저장 · 워커 = 2026-05-21 신규 410 · 2026-06-11 워커 봉인(AUTO_CAMPAIGN_RETIRED) → 판정은 소스 계약 시험(staff-tickets-1120.test.ts)만.
 * 고객 번호 = 0100001120x(도달 불가 대역).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { buildCustomerFilter, buildFilterWhereClauseCompat } from '../customer-filter';
import { saveSegment } from '../saved-segments';

const CO = randomUUID();
const OWNER = randomUUID();
const C = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID(), e: randomUUID() };

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '1120 접수 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1120', login_id: 't-1120-staff' });
  // 오늘(KST) = 2026-11-20 기준 · −90 = 2026-08-22
  const rows: Array<[string, string, string | null, string | null, number]> = [
    [C.a, '01000011201', '2026-08-01', '2026-08-01', 25],   // 111일 전 = 지남
    [C.b, '01000011202', '2026-08-22', '20260822', 35],      // 딱 90일 전 = 지남(그날 포함) · 90일 안(그날 포함)
    [C.c, '01000011203', '2026-08-23', '2026.08.23', 45],    // 89일 전 = 90일 안
    [C.d, '01000011204', null, null, 55],                    // 칸 빔 = 둘 다 빠짐
    [C.e, '01000011205', '2026-11-19', '2026/11/19', 65],    // 어제 = 90일 안
  ];
  for (const [id, phone, rp, cf, age] of rows) {
    await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone, is_active: true, sms_opt_in: true, age });
    await pool.query(`UPDATE customers SET recent_purchase_date = $2::date, custom_fields = CASE WHEN $3::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('custom_3', $3::text) END WHERE id = $1`, [id, rp, cf]);
  }
}, 120_000);

// 회차 시각 고정(JS Date 만 · pg 타이머는 그대로) — 2026-11-19 15:30Z = KST 11-20 00:30
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-19T15:30:00Z') }); });
afterAll(() => { vi.useRealTimers(); });

const NAME: Record<string, string> = Object.fromEntries(Object.entries(C).map(([k, v]) => [v, k]));
async function pick(conv: 'mixed' | 'structured', filter: Record<string, unknown>): Promise<string[]> {
  const f = conv === 'mixed'
    ? buildFilterWhereClauseCompat(filter, 2)
    : buildCustomerFilter(filter, { tableAlias: '', startParamIndex: 2, storeCodeMode: 'subquery', companyIdParamRef: '$1', inputFormat: 'structured' });
  const r = await pool.query(`SELECT id FROM customers WHERE company_id = $1 AND is_active = true ${f.sql}`, [CO, ...f.params]);
  return r.rows.map((x: any) => NAME[x.id]).sort();
}

describe('R100 상대 날짜 기준 = 실 PG 에서 맞는 고객만', () => {
  for (const conv of ['mixed', 'structured'] as const) {
    it(`${conv} 표준 칸 · 90일 이상 지남 = a · b(그날 포함) · 빈 칸 빠짐`, async () => {
      expect(await pick(conv, { recent_purchase_date: { operator: 'days_passed', value: 90 } })).toEqual(['a', 'b']);
    });
    it(`${conv} 표준 칸 · 최근 90일 안 = b · c · e`, async () => {
      expect(await pick(conv, { recent_purchase_date: { operator: 'days_within', value: 90 } })).toEqual(['b', 'c', 'e']);
    });
    const ck = conv === 'mixed' ? 'custom_fields.custom_3' : 'custom_3';
    it(`${conv} 회사 날짜 칸(글자 꼴 셋) · 90일 이상 지남 = a · b · 칸 없음 빠짐`, async () => {
      expect(await pick(conv, { [ck]: { operator: 'days_passed', value: 90 } })).toEqual(['a', 'b']);
    });
    it(`${conv} 회사 날짜 칸 · 최근 90일 안 = b · c · e`, async () => {
      expect(await pick(conv, { [ck]: { operator: 'days_within', value: 90 } })).toEqual(['b', 'c', 'e']);
    });
  }
  it('VIP 등급 + 90일 이상 구매 없음(접수 T3 모양) = 두 조건 AND', async () => {
    await pool.query(`UPDATE customers SET grade = CASE WHEN id = ANY($2::uuid[]) THEN 'VIP' ELSE '일반' END WHERE company_id = $1`, [CO, [C.a, C.c]]);
    expect(await pick('mixed', { grade: { operator: 'eq', value: 'VIP' }, recent_purchase_date: { operator: 'days_passed', value: 90 } })).toEqual(['a']);
  });
});

describe('R101 표 밖 기준 = 0명(조건이 빠진 회사 전체가 아니다)', () => {
  it('전체 = 5명(기준선)', async () => {
    expect(await pick('mixed', {})).toHaveLength(5);
  });
  for (const conv of ['mixed', 'structured'] as const) {
    it(`${conv} 숫자 · 날짜 · 나이 · 회사 칸의 표 밖 기준 = SQL 이 돌고 0명`, async () => {
      const ck = conv === 'mixed' ? 'custom_fields.custom_3' : 'custom_3';
      expect(await pick(conv, { points: { operator: 'contains', value: '3' } })).toEqual([]);
      expect(await pick(conv, { recent_purchase_date: { operator: 'contains', value: '3' } })).toEqual([]);
      expect(await pick(conv, { age: { operator: 'contains', value: '3' } })).toEqual([]);
      expect(await pick(conv, { [ck]: { operator: 'regex', value: 'x' } })).toEqual([]);
    });
  }
  it('mixed 나이 gte · lte · eq = 옮김(옛 = 말없이 빠져 전체)', async () => {
    expect(await pick('mixed', { age: { operator: 'gte', value: 45 } })).toEqual(['c', 'd', 'e']);
    expect(await pick('mixed', { age: { operator: 'lte', value: 35 } })).toEqual(['a', 'b']);
    expect(await pick('mixed', { age: { operator: 'eq', value: 55 } })).toEqual(['d']);
  });
  it('세그먼트 저장 = 깨진 조건이면 400 · 행 0 · 정상 조건은 저장', async () => {
    const count = async () => Number((await pool.query(`SELECT count(*) FROM saved_segments WHERE company_id = $1`, [CO])).rows[0].count);
    await expect(saveSegment(CO, OWNER, { name: '깨진 조건', segmentType: 'custom', filter: { recent_purchase_date: { operator: 'contains', value: '3' } } } as any))
      .rejects.toMatchObject({ status: 400, code: 'TARGET_CONDITION_INVALID' });
    expect(await count()).toBe(0);
    await saveSegment(CO, OWNER, { name: '90일 이상 지남', segmentType: 'custom', filter: { recent_purchase_date: { operator: 'days_passed', value: 90 } } } as any);
    expect(await count()).toBe(1);
  });
});
