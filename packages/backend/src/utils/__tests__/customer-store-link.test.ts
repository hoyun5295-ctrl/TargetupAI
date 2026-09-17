/**
 * customer-store-link.test.ts — 고객↔분류코드 기록 CT (설계서 docs/2026-09-18-mall-integration-user-scope-design.md §2-5 · §3-3)
 *
 * 형제 적재 경로(upload.ts · sync.ts · customers.ts)가 쓰는 줄과 같은 SQL 을 한 함수가 소유한다.
 * 자사몰 적재가 이 함수를 부른다. 실패는 던지지 않는다(분류 기록 실패로 주문·회원 적재가 유실되면 안 된다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 1 })) }));

import { query } from '../../config/database';
import { linkCustomerStore } from '../customer-store-link';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '22222222-2222-4222-8222-222222222222';
const q = query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  q.mockReset();
  q.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe('linkCustomerStore', () => {
  it('형제 적재 경로와 같은 줄로 customer_stores 에 1행을 기록한다', async () => {
    const ok = await linkCustomerStore(COMPANY, CUSTOMER, 'IROIRO');
    expect(ok).toBe(true);
    expect(q).toHaveBeenCalledTimes(1);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('INSERT INTO customer_stores (company_id, customer_id, store_code)');
    expect(sql).toContain('ON CONFLICT (customer_id, store_code) DO NOTHING');
    expect(params).toEqual([COMPANY, CUSTOMER, 'IROIRO']);
  });

  it('분류코드 앞뒤 공백을 걷어 낸다', async () => {
    await linkCustomerStore(COMPANY, CUSTOMER, '  IROIRO ');
    expect(q.mock.calls[0][1]).toEqual([COMPANY, CUSTOMER, 'IROIRO']);
  });

  it.each([undefined, null, '', '   '])('분류코드가 비어 있으면(%s) 아무것도 쓰지 않는다', async (code) => {
    const ok = await linkCustomerStore(COMPANY, CUSTOMER, code as any);
    expect(ok).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });

  it('회사·고객 식별자가 없으면 쓰지 않는다', async () => {
    expect(await linkCustomerStore('', CUSTOMER, 'IROIRO')).toBe(false);
    expect(await linkCustomerStore(COMPANY, '', 'IROIRO')).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });

  it('DB 오류는 던지지 않고 false 로 돌려준다(적재를 막지 않는다)', async () => {
    q.mockRejectedValueOnce(new Error('relation "customer_stores" does not exist'));
    await expect(linkCustomerStore(COMPANY, CUSTOMER, 'IROIRO')).resolves.toBe(false);
  });
});
