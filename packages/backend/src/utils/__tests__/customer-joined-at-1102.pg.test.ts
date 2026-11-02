// replaces: none
/**
 * 가입 근거 칸(customers.joined_at) 쓰기 길 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-6 표 · §7)
 *
 * 싱크 · 엑셀 · 수동 = 고객 업서트 빌더(createCustomerUpsertBuilder) + 처음 만든 행 받은 시각(stampFirstSeenJoinedAt) · 몰 회원 = identifyCustomer(joinedAt).
 * 다시 쓸 때 = 이른 값(LEAST · 한쪽 NULL = 다른 쪽 · 지우기 0).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { createCustomerUpsertBuilder } from '../customer-upsert';
import { stampFirstSeenJoinedAt, insertedPhonesOf } from '../customer-joined-at';
import { identifyCustomer } from '../cdp-identity';

const CO = randomUUID();
let seq = 0;
const phone = () => `0100000${String(1700 + seq++).padStart(4, '0')}`;
const joinedOf = async (p: string) => {
  const r = (await pool.query(`SELECT joined_at FROM customers WHERE company_id = $1 AND phone = $2`, [CO, p])).rows[0];
  return r?.joined_at ? new Date(r.joined_at) : null;
};
/** 싱크 경로 그대로 — 빌더 한 문장 + incremental 이면 처음 만든 행에 받은 시각 */
async function sync(mode: 'full' | 'incremental', rows: Array<{ phone: string; joined_at?: string | null }>) {
  const b = createCustomerUpsertBuilder({ source: 'sync', includeUploadedBy: false, skipUnchanged: true });
  const { sql, values } = b.buildBatch(CO, rows.map((r) => ({ phone: r.phone, name: '싱크 고객', sms_opt_in: true, joined_at: r.joined_at ?? null })));
  const up = await pool.query(sql, values);
  if (mode === 'incremental') await stampFirstSeenJoinedAt((t, p) => pool.query(t, p), CO, insertedPhonesOf(up.rows));
}

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C98-DDL-2'));
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '가입 근거 시험' });
}, 120_000);

describe('3-6 가입 근거 쓰기 표(실 PG)', () => {
  it('싱크 full 처음 보는 번호 = NULL(기존 고객) · incremental 처음 보는 번호 = 받은 시각 · 원천 가입일 = 그 날', async () => {
    const [a, b, c] = [phone(), phone(), phone()];
    await sync('full', [{ phone: a }]);
    expect(await joinedOf(a)).toBeNull();
    const before = Date.now();
    await sync('incremental', [{ phone: b }, { phone: c, joined_at: '2025-03-01' }]);
    expect((await joinedOf(b))!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect((await joinedOf(c))!.toISOString().slice(0, 10)).toBe('2025-03-01');
  });

  it('이미 있는 번호 = incremental 이어도 받은 시각을 찍지 않는다(처음 보는 번호만) · 다시 쓰기 = 이른 값 · NULL 이 덮지 않는다', async () => {
    const p = phone();
    await sync('full', [{ phone: p }]);
    await sync('incremental', [{ phone: p }]);
    expect(await joinedOf(p)).toBeNull();
    await sync('full', [{ phone: p, joined_at: '2025-06-01' }]);
    expect((await joinedOf(p))!.toISOString().slice(0, 10)).toBe('2025-06-01');
    await sync('full', [{ phone: p, joined_at: '2025-09-01' }]);   // 늦은 값 = 그대로
    expect((await joinedOf(p))!.toISOString().slice(0, 10)).toBe('2025-06-01');
    await sync('full', [{ phone: p, joined_at: '2025-01-15' }]);   // 이른 값 = 바뀜
    expect((await joinedOf(p))!.toISOString().slice(0, 10)).toBe('2025-01-15');
    await sync('full', [{ phone: p, joined_at: null }]);           // 빈 값 = 지우지 않음
    expect((await joinedOf(p))!.toISOString().slice(0, 10)).toBe('2025-01-15');
  });

  it('몰 회원 가입 시각 = 그 시각(시각까지) · 늦은 시각이 다시 와도 이른 값 · 주문(가입 시각 없음) = NULL', async () => {
    const m = phone();
    await identifyCustomer(CO, { source: 'cafe24', externalId: `m:${m}`, phone: m, name: '몰 회원', joinedAt: '2026-10-31T14:20:05+09:00' });
    expect((await joinedOf(m))!.toISOString()).toBe('2026-10-31T05:20:05.000Z');
    await identifyCustomer(CO, { source: 'cafe24', externalId: `m:${m}`, phone: m, name: '몰 회원', joinedAt: '2026-11-01T10:00:00+09:00' });
    expect((await joinedOf(m))!.toISOString()).toBe('2026-10-31T05:20:05.000Z');
    // ★ Codex 구현 1R — 주문이 먼저 고객을 만들고(가입 시각 없음) 회원 가입 사건이 나중에 = 그 회원 가입 시각(이미 있는 고객 갱신 길)
    const late = phone();
    await identifyCustomer(CO, { source: 'cafe24', externalId: `o:${late}`, phone: late, name: '먼저 주문' });
    expect(await joinedOf(late)).toBeNull();
    await identifyCustomer(CO, { source: 'cafe24', externalId: `m:${late}`, phone: late, name: '나중 회원', joinedAt: '2026-11-01T09:30:00+09:00' });
    expect((await joinedOf(late))!.toISOString()).toBe('2026-11-01T00:30:00.000Z');
    const o = phone();
    await identifyCustomer(CO, { source: 'cafe24', externalId: `o:${o}`, phone: o, name: '주문자' });
    expect(await joinedOf(o)).toBeNull();
  });
});
