// replaces: none
/**
 * 1031 접수 A(cmvujgxpe · R16) — 추천 타겟 리스트 조건 칸 조각을 실 PostgreSQL · 실제 드라이버로 돌린다(설계서 docs/2026-10-31-target-date-addressbook-append-design.md §4).
 *   시험 자리 = resolveConditionColumns 조각 + 드라이버(결함이 사는 곳) · 화면으로 가는 값 = JSON 한 번 거친 값.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { resolveConditionColumns } from '../operator-recipients';
import { FIELD_MAP } from '../standard-field-map';

const CO = '00000000-0000-0000-0000-00000000c085';
const CUST = '00000000-0000-0000-0000-00000000d085';

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'customers', { id: CUST, company_id: CO, phone: '01000002657', birth_date: '2003-11-06', recent_purchase_date: '2026-10-06' });
});

describe('A 날짜 칸 = DB 그대로의 글자', () => {
  it('생일 · 최근구매일 조건 칸 = YYYY-MM-DD(시각 꼬리 · 하루 당김 0)', async () => {
    const cols = resolveConditionColumns({ birth_date: { operator: 'birth_month', value: 11 }, recent_purchase_date: { operator: 'gte', value: '2026-10-01' } }, FIELD_MAP);
    const r = await pool.query(`SELECT ${cols.map((c) => c.select).join(', ')} FROM customers c WHERE c.id = $1`, [CUST]);
    const sent = JSON.parse(JSON.stringify(r.rows[0]));
    expect(sent).toEqual({ birth_date: '2003-11-06', recent_purchase_date: '2026-10-06' });
  });
  it('여정 대상 최근구매일 조각 = 같은 글자', async () => {
    const r = await pool.query(`SELECT recent_purchase_date::text AS recent_purchase_date FROM customers WHERE id = $1`, [CUST]);
    expect(JSON.parse(JSON.stringify(r.rows[0]))).toEqual({ recent_purchase_date: '2026-10-06' });
  });
});
