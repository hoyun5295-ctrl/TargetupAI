/**
 * 사내 회사의 일 = 운영 시스템 경보 문자 0 (★ 2026-10-28 B-1028-3 · Harold 「테스트계정 관련은 시스템경보 안와야하는거아니냐」)
 *
 * 판정 = utils/internal-company.ts 한 곳(시연 회사 is_demo · ENV INTERNAL_TEST_COMPANY_IDS) · 거르는 자리 = sendSystemAlert 입구 한 곳.
 * 회사와 무관한 경보(null) · 판정 조회 실패 = 보낸다 · 보안 감시 경보는 늘 null(거르지 않는다).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const db = vi.hoisted(() => ({ demo: new Set<string>(), demoThrow: false }));
vi.mock('../../config/database', () => {
  const q = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('SELECT is_demo FROM companies')) {
      if (db.demoThrow) throw new Error('db down');
      return { rows: [{ is_demo: db.demo.has(String(params[0])) }] };
    }
    return { rows: [] };
  });
  return { default: { query: q, connect: vi.fn() }, query: q, pool: { query: q, connect: vi.fn() } };
});
const sms = vi.hoisted(() => ({ insert: vi.fn(async () => 1) }));
vi.mock('../sms-queue', () => ({ getAuthSmsTable: vi.fn(async () => 'SMSQ_AUTH'), bulkInsertSmsQueue: sms.insert }));

import { sendSystemAlert } from '../system-alert';
import { isInternalCompany, internalTestCompanyIds, soleCompanyId } from '../internal-company';

const TEST_CO = 'a0990249-3550-4baa-92ca-32e45b185e83';
const send = (companyId: string | null, key: string) => sendSystemAlert({ companyId, dedupKey: key, title: '시험 경보입니다.', phones: ['01000000000'] });

describe('B-1028-3 사내 회사 경보 거름', () => {
  const prev = process.env.INTERNAL_TEST_COMPANY_IDS;
  beforeEach(() => { sms.insert.mockClear(); db.demo.clear(); db.demoThrow = false; process.env.INTERNAL_TEST_COMPANY_IDS = ` ${TEST_CO.toUpperCase()} , not-a-uuid`; });
  afterEach(() => { process.env.INTERNAL_TEST_COMPANY_IDS = prev; });

  it('사내 시험 회사(ENV · 대소문자 · 공백 무관) = 문자 0 · 반환 0', async () => {
    expect(internalTestCompanyIds()).toEqual(new Set([TEST_CO]));
    expect(await send(TEST_CO, 'mall-action:x1:token_rejected')).toBe(0);
    expect(sms.insert).not.toHaveBeenCalled();
  });
  it('시연 회사(is_demo) = 문자 0', async () => {
    const demo = '11111111-1111-4111-8111-111111111111';
    db.demo.add(demo);
    expect(await isInternalCompany(demo)).toBe(true);
    expect(await send(demo, 'mall-action:x2:key_rejected')).toBe(0);
    expect(sms.insert).not.toHaveBeenCalled();
  });
  it('고객사 · 회사와 무관한 경보(null) = 그대로 보낸다', async () => {
    expect(await send('22222222-2222-4222-8222-222222222222', 'mall-action:x3:token_rejected')).toBe(1);
    expect(await send(null, 'queue-abnormal-status-x4')).toBe(1);
    expect(sms.insert).toHaveBeenCalledTimes(2);
  });
  it('판정 조회 실패 = 사내 아님 = 보낸다(경보는 모르면 보낸다)', async () => {
    db.demoThrow = true;
    expect(await send('33333333-3333-4333-8333-333333333333', 'mall-action:x5:token_rejected')).toBe(1);
  });
  it('목록이 비면 시연 회사만(지금 동작)', async () => {
    process.env.INTERNAL_TEST_COMPANY_IDS = '';
    expect(await send(TEST_CO, 'mall-action:x6:token_rejected')).toBe(1);
  });
  it('soleCompanyId = 회사가 하나뿐일 때만 그 회사 · 여럿 · 하나라도 모름 · 빈 목록 = null', () => {
    expect(soleCompanyId([TEST_CO, TEST_CO.toUpperCase(), ` ${TEST_CO}`])).toBe(TEST_CO);
    expect(soleCompanyId([TEST_CO, '22222222-2222-4222-8222-222222222222'])).toBeNull();
    expect(soleCompanyId([TEST_CO, null])).toBeNull();
    expect(soleCompanyId([])).toBeNull();
  });
  it('보안 감시 경보는 회사를 싣지 않는다(늘 보낸다)', () => {
    const src = readFileSync(resolve(__dirname, '..', 'watch-alert.ts'), 'utf8');
    expect(src).toMatch(/sendSystemAlert\(\{\s*companyId: null,/);
  });
});
