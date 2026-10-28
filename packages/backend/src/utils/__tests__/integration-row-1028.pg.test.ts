// replaces: none
/**
 * 연동 행 몰 접두 고정 — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 K9 · I9 · M38)
 *
 * 주장이 SQL 에 기댄다: ON CONFLICT 의 `EXCLUDED.meta - 'id_prefix'` · jsonb `?` 키 유무 · 옛 행(키 없음)과 빈 접두('')의 구분.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => 0) }));

import { saveCafe24ByoCredentials, saveCafe24Integration } from '../cafe24-client';
import { createIntegrationRow, mallScopedIds } from '../integration-row';
import { integrationRowScopeOf } from '../integration-scope';

const CO = '00000000-0000-0000-0000-0000000000c9';
const run = (sql: string, params?: any[]) => query(sql, params);
const metaOf = async (provider: string, mallId: string) =>
  (await query(`SELECT meta FROM company_integrations WHERE company_id = $1::uuid AND provider = $2 AND mall_id = $3`, [CO, provider, mallId])).rows[0].meta;
const token = () => ({
  access_token: 'at', refresh_token: 'rt', expires_at: new Date(Date.now() + 7200_000).toISOString(),
  refresh_token_expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(), scopes: ['mall.read_order'], user_id: 'u', shop_no: 1, issued_at: new Date().toISOString(),
} as any);

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
});

describe('K9 새 행 = 몰 접두 고정 · 다시 저장은 접두를 못 바꾼다', () => {
  it('카페24: BYO 저장(새 행) = `{몰}:` · 승인 저장(같은 행) 뒤에도 그대로 · 수신 맥락 · 외부 번호에 접두', async () => {
    await saveCafe24ByoCredentials(CO, 'k9-shop', 'cid', 'csecret');
    expect((await metaOf('cafe24', 'k9-shop')).id_prefix).toBe('k9-shop:');
    await saveCafe24Integration(CO, 'k9-shop', token());
    expect((await metaOf('cafe24', 'k9-shop')).id_prefix).toBe('k9-shop:');
    const scope = await integrationRowScopeOf(CO, 'cafe24', 'k9-shop');
    expect(scope.idPrefix).toBe('k9-shop:');
    expect(mallScopedIds({ provider: 'cafe24', mallId: 'k9-shop', idPrefix: scope.idPrefix }, { memberId: 'm1', orderId: 'o1' }))
      .toEqual({ memberExternalId: 'k9-shop:m1', externalId: 'k9-shop:m1', orderId: 'k9-shop:o1' });
  });

  it('옛 행(키 없음) = 다시 저장해도 키가 생기지 않는다 · 외부 번호 = 지금 글자(접두 없음)', async () => {
    await query(
      `INSERT INTO company_integrations (id, company_id, provider, mall_id, access_token, refresh_token, scope, meta, status, connected_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, 'cafe24', 'k9-old', 'a', 'r', '', '{"cafe24_client_id":"x"}'::jsonb, 'active', NOW(), NOW(), NOW())`,
      [CO],
    );
    await saveCafe24Integration(CO, 'k9-old', token());
    const meta = await metaOf('cafe24', 'k9-old');
    expect('id_prefix' in meta).toBe(false);
    expect(meta.cafe24_client_id).toBe('x');
    const scope = await integrationRowScopeOf(CO, 'cafe24', 'k9-old');
    expect(scope.idPrefix).toBeNull();
    expect(mallScopedIds({ provider: 'cafe24', mallId: 'k9-old', idPrefix: scope.idPrefix }, { memberId: 'm1', orderId: 'o1' }).externalId).toBe('m1');
  });

  it('고도몰 · 자체호스팅 = 빈 접두(키는 있음 · 옛 행과 구분) · 들어온 meta 의 접두는 걷는다', async () => {
    for (const [provider, mall] of [['godo', 'godo'], ['custom', 'self']]) {
      await createIntegrationRow(run, { companyId: CO, provider, mallId: mall, status: { sql: "'active'" }, meta: { a: 1 }, onConflict: [] });
      expect(await metaOf(provider, mall), provider).toMatchObject({ a: 1, id_prefix: '' });
      expect((await integrationRowScopeOf(CO, provider, mall)).idPrefix, provider).toBe('');
      // 다시 저장 · 들어온 meta 가 접두를 실어도(어느 호출부든) 행 접두는 그대로
      await createIntegrationRow(run, { companyId: CO, provider, mallId: mall, status: { sql: "'active'" }, meta: { a: 2, id_prefix: 'evil:' }, onConflict: [] });
      expect(await metaOf(provider, mall), provider).toMatchObject({ a: 2, id_prefix: '' });
    }
  });

  it('우커머스 = 키가 없던 옛 행도 `{몰}:`(지금 접두 그대로)', async () => {
    expect(mallScopedIds({ provider: 'woocommerce', mallId: 'w.example', idPrefix: null }, { memberId: 7, orderId: 9 }))
      .toEqual({ memberExternalId: 'w.example:7', externalId: 'w.example:7', orderId: 'w.example:9' });
  });
});
