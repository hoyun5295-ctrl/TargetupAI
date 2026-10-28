// replaces: none
/**
 * 탈퇴 전파 — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 K5 · M4)
 *
 * 주장이 SQL 에 기댄다: 연결 행에서 고객 찾기(DISTINCT) · 소속 행 ON CONFLICT 갱신 · 동의 시계 비교(늦게 온 옛 YES 가 탈퇴를 못 넘음).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

vi.mock('../unified-customer-profile', () => ({ recomputeProfile: vi.fn(async () => undefined) }));

import { identifyCustomer, withdrawMemberConsent } from '../cdp-identity';
import { upsertStoreConsent } from '../mall-consent';

const CO = '00000000-0000-0000-0000-0000000000c6';
const store = async (customerId: string, code: string): Promise<any> =>
  (await query(`SELECT sms_opt_in, consent_source FROM customer_stores WHERE customer_id = $1::uuid AND store_code = $2`, [customerId, code])).rows[0];
const optIn = async (customerId: string): Promise<boolean | null> =>
  (await query(`SELECT sms_opt_in FROM customers WHERE id = $1::uuid`, [customerId])).rows[0].sms_opt_in;

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
});

describe('K5 탈퇴 = 그 몰 소속 행 명시 NO(분류코드 몰) · 고객 행 NO(분류코드 없는 몰)', () => {
  it('분류코드 몰: 그 매장 소속 행만 NO · 출처 {provider}:deleted · 다른 매장 · 고객 행 불변 · 늦게 온 옛 YES 는 못 되살림', async () => {
    const a = await identifyCustomer(CO, { source: 'woocommerce', externalId: 'w1.example:7', phone: '01000000601', smsOptIn: true, consentAt: '2026-10-01T00:00:00.000Z' });
    const t0 = '2026-10-01T00:00:00.000Z';
    await upsertStoreConsent(CO, a.customerId, 'S1', true, 'woocommerce', t0);
    await upsertStoreConsent(CO, a.customerId, 'S2', true, 'woocommerce', t0);
    const before = await optIn(a.customerId);

    expect(await withdrawMemberConsent(CO, 'woocommerce', 'w1.example:7', '2026-10-20T00:00:00.000Z', 'S1')).toBe(1);
    expect(await store(a.customerId, 'S1')).toEqual({ sms_opt_in: false, consent_source: 'woocommerce:deleted' });
    expect((await store(a.customerId, 'S2')).sms_opt_in).toBe(true);
    expect(await optIn(a.customerId)).toBe(before);

    // 탈퇴보다 앞선 시각의 YES 가 늦게 처리돼도 NO 그대로(시계 비교)
    await upsertStoreConsent(CO, a.customerId, 'S1', true, 'woocommerce', '2026-10-10T00:00:00.000Z');
    expect((await store(a.customerId, 'S1')).sms_opt_in).toBe(false);
  });

  it('분류코드 없는 몰: 고객 행 NO(지금 동작) · 연결 없는 번호 = 0', async () => {
    const b = await identifyCustomer(CO, { source: 'custom', externalId: 'm-9', phone: '01000000602', smsOptIn: true, consentAt: '2026-10-01T00:00:00.000Z' });
    expect(await withdrawMemberConsent(CO, 'custom', 'm-9', '2026-10-20T00:00:00.000Z', null)).toBe(1);
    expect(await optIn(b.customerId)).toBe(false);
    expect(await withdrawMemberConsent(CO, 'custom', 'nobody', '2026-10-20T00:00:00.000Z', 'S1')).toBe(0);
  });
});
