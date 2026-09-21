/**
 * unsubscribe-isolation.test.ts — 수신거부 입구의 계정 격리 (설계서 docs/2026-09-22-mall-consent-isolation-design.md §3 · §4-3)
 *
 * H2: 한 몰(계정)의 거부·삭제가 다른 몰에 영향을 주지 않는다.
 * 0922 실측: 격리 스위치(companies.user_isolation_enabled)를 보는 입구는 등록(registerUnsubscribe) 하나뿐이었다.
 *   - 삭제는 격리 ON 이어도 회사 전 계정 행을 지우고 customers.sms_opt_in 을 true 로 되살렸다(과발송 방향).
 *   - 080 콜백·수동 등록은 끝에 그 번호의 customers.sms_opt_in 을 회사 전체에서 내렸다.
 * 규약: 분기는 **격리 ON 회사에서만** 탄다. 격리 OFF 회사(기본 · 현 고객사 대부분)는 SQL 이 종전 그대로다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import { isUserIsolationEnabled, deleteIsolatedUnsubscribes, deleteUserUnsubscribes, process080Callback } from '../unsubscribe-helper';

const COMPANY = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49';
const USER = '22222222-2222-4222-8222-222222222222';
const PHONE = '01000000000'; // 형식만 유효한 도달 불가 번호
const q = query as unknown as ReturnType<typeof vi.fn>;
const sqls = () => q.mock.calls.map(([s]: [string]) => String(s).replace(/\s+/g, ' ').trim());

function db(o: { iso: boolean; match080?: boolean }) {
  q.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes('user_isolation_enabled')) return { rows: [{ iso: o.iso }] };
    if (s.includes('SELECT company_id FROM users')) return { rows: [{ company_id: COMPANY }] };
    if (s.includes('opt_out_080_number') && s.includes('FROM users')) return { rows: o.match080 ? [{ user_id: USER, company_id: COMPANY, company_name: '테스트' }] : [] };
    if (s.startsWith('DELETE') || s.includes('DELETE FROM unsubscribes')) return { rows: [{ phone: PHONE }], rowCount: 1 };
    if (s.includes('INSERT INTO unsubscribes')) return { rows: [{ id: 'u1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}
beforeEach(() => { q.mockReset(); });

describe('isUserIsolationEnabled', () => {
  it('회사 설정을 읽는다(없음·NULL = false)', async () => {
    db({ iso: true });
    expect(await isUserIsolationEnabled(COMPANY)).toBe(true);
    db({ iso: false });
    expect(await isUserIsolationEnabled(COMPANY)).toBe(false);
  });
});

describe('deleteIsolatedUnsubscribes — 격리 회사의 삭제는 본인 행만', () => {
  it('본인(user_id) 행만 지운다 · 관리자 사본은 그 번호에 다른 사용자 행이 하나도 안 남을 때만 · 고객 행 동의를 되살리지 않는다', async () => {
    db({ iso: true });
    const phones = await deleteIsolatedUnsubscribes(COMPANY, USER, [PHONE]);
    expect(phones).toEqual([PHONE]);
    const all = sqls();
    expect(all[0]).toMatch(/DELETE FROM unsubscribes WHERE company_id = \$1::uuid AND user_id = \$2::uuid AND phone = ANY\(\$3::varchar\[\]\)/);
    expect(all[1]).toMatch(/user_type = 'admin'/);
    expect(all[1]).toMatch(/NOT EXISTS/);
    expect(all.some((s) => /UPDATE customers SET sms_opt_in/.test(s))).toBe(false);
  });
});

describe('deleteUserUnsubscribes(슈퍼관리자) — 격리 여부로 갈린다', () => {
  it('격리 OFF = 종전 그대로: 회사 전 계정 행 삭제 + 고객 행 동의 복구', async () => {
    db({ iso: false });
    await deleteUserUnsubscribes(USER, [PHONE]);
    const all = sqls();
    expect(all.some((s) => /DELETE FROM unsubscribes WHERE company_id = \$1::uuid AND phone = ANY/.test(s))).toBe(true);
    expect(all.some((s) => /UPDATE customers SET sms_opt_in = \$1/.test(s))).toBe(true);
  });
  it('격리 ON = 그 사용자 행만 · 복구 없음(다른 몰의 거부를 풀지 않는다)', async () => {
    db({ iso: true });
    await deleteUserUnsubscribes(USER, [PHONE]);
    const all = sqls();
    expect(all.some((s) => /AND user_id = \$2::uuid/.test(s))).toBe(true);
    expect(all.some((s) => /DELETE FROM unsubscribes WHERE company_id = \$1::uuid AND phone = ANY/.test(s))).toBe(false);
    expect(all.some((s) => /UPDATE customers SET sms_opt_in/.test(s))).toBe(false);
  });
});

describe('process080Callback — 격리 회사는 고객 행 동의를 회사 전체에서 내리지 않는다', () => {
  it('격리 OFF = 종전 그대로(고객 행 동의 내림)', async () => {
    db({ iso: false, match080: true });
    await process080Callback(PHONE, '0800000000');
    expect(sqls().some((s) => /UPDATE customers SET sms_opt_in = \$1/.test(s))).toBe(true);
  });
  it('격리 ON = 계정 행 등록은 그대로 · 고객 행 동의 내림 없음', async () => {
    db({ iso: true, match080: true });
    const r = await process080Callback(PHONE, '0800000000');
    expect(r.success).toBe(true);
    const all = sqls();
    expect(all.some((s) => /INSERT INTO unsubscribes/.test(s))).toBe(true);
    expect(all.some((s) => /UPDATE customers SET sms_opt_in/.test(s))).toBe(false);
  });
});

describe('소스 계약 — routes/unsubscribes.ts', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', 'routes', 'unsubscribes.ts'), 'utf-8');
  it('라우트의 고객 행 동의 동기화 사본 2벌이 격리 회사에서는 돌지 않는다', () => {
    const one = src.slice(src.indexOf('async function syncCustomerOptIn('), src.indexOf('async function syncCustomerOptInBulk('));
    const bulk = src.slice(src.indexOf('async function syncCustomerOptInBulk('), src.indexOf('async function syncCustomerOptInBulk(') + 600);
    for (const body of [one, bulk]) {
      expect(body).toContain('isUserIsolationEnabled(companyId)');
      expect(body.indexOf('isUserIsolationEnabled(companyId)')).toBeLessThan(body.indexOf('UPDATE customers SET sms_opt_in'));
    }
  });
  it('삭제 라우트: 격리 회사는 deleteIsolatedUnsubscribes(본인 행만) · 회사 전체 DELETE 와 동의 복구는 격리 OFF 갈래에만', () => {
    const block = src.slice(src.indexOf("router.delete('/:id'"));
    expect(block).toContain('deleteIsolatedUnsubscribes(companyId, userId, [targetPhone])');
    const isoAt = block.indexOf('deleteIsolatedUnsubscribes(');
    const legacyAt = block.indexOf('DELETE FROM unsubscribes WHERE company_id = $1::uuid AND phone = $2::varchar');
    expect(isoAt).toBeGreaterThan(-1);
    expect(legacyAt).toBeGreaterThan(isoAt);
    const restoreAt = block.indexOf('syncCustomerOptIn(companyId, targetPhone, true)');
    expect(restoreAt).toBeGreaterThan(legacyAt);
  });
});
