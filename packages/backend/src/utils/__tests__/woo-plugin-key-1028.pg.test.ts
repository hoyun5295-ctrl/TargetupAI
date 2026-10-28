// replaces: none
/**
 * 플러그인 키로 몰 행 찾기 · 새로 발급 — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 K8 · D9)
 *
 * 주장이 SQL 에 기댄다: 판 올리기(jsonb_build_object · NULLIF · ::int) 한 문장 · 해제 행 · 다른 provider 행은 찾지 않음.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { findWooIntegrationByPluginKey, wooPluginKeyFor } from '../woocommerce-client';

const CO = '00000000-0000-0000-0000-0000000000c3';
const SECRET = 'plugin-key-secret-for-pg-tests-0123456789';
let saved: string | undefined;

beforeAll(async () => {
  saved = process.env.CDP_PLUGIN_KEY_SECRET;
  process.env.CDP_PLUGIN_KEY_SECRET = SECRET;
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'company_integrations', { company_id: CO, provider: 'woocommerce', mall_id: 'pk-a.example', status: 'active', meta: {} });
  await insertMinimalRow(pool, 'company_integrations', { company_id: CO, provider: 'woocommerce', mall_id: 'pk-b.example', status: 'revoked', meta: {} });
});
afterAll(() => { if (saved === undefined) delete process.env.CDP_PLUGIN_KEY_SECRET; else process.env.CDP_PLUGIN_KEY_SECRET = saved; });

describe('K8 플러그인 키', () => {
  it('지금 키로 그 몰 행을 찾는다 · 새로 발급하면 판이 오르고 옛 키는 그 순간 못 찾는다', async () => {
    const k1 = await wooPluginKeyFor(CO, 'pk-a.example', false);
    expect((await findWooIntegrationByPluginKey(k1))?.mallId).toBe('pk-a.example');
    const k2 = await wooPluginKeyFor(CO, 'pk-a.example', true);
    expect(k2).not.toBe(k1);
    expect(await findWooIntegrationByPluginKey(k1)).toBeUndefined();
    expect((await findWooIntegrationByPluginKey(k2))?.mallId).toBe('pk-a.example');
    const ver = (await query(`SELECT meta->>'plugin_key_ver' AS v FROM company_integrations WHERE company_id = $1::uuid AND mall_id = 'pk-a.example'`, [CO])).rows[0].v;
    expect(ver).toBe('2');
    const k3 = await wooPluginKeyFor(CO, 'pk-a.example', true);
    expect((await findWooIntegrationByPluginKey(k3))?.mallId).toBe('pk-a.example');
  });

  it('해제된 몰은 키를 주지도 · 찾지도 않는다', async () => {
    expect(await wooPluginKeyFor(CO, 'pk-b.example', false)).toBeUndefined();
    const id = (await query(`SELECT id FROM company_integrations WHERE company_id = $1::uuid AND mall_id = 'pk-a.example'`, [CO])).rows[0].id;
    const k = await wooPluginKeyFor(CO, 'pk-a.example', false);
    await query(`UPDATE company_integrations SET status = 'revoked' WHERE id = $1::uuid`, [id]);
    expect(await findWooIntegrationByPluginKey(k)).toBeUndefined();
    await query(`UPDATE company_integrations SET status = 'active' WHERE id = $1::uuid`, [id]);
  });
});
