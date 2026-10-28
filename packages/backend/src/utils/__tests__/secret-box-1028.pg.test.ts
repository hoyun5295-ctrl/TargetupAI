// replaces: none
/**
 * 몰 연동 자격 암호화 — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 K8 · M34 · DML-2 · DML-2R)
 *
 * 주장이 SQL 에 기댄다: varchar(100) 칸 길이(DDL-2 전 = 웹훅 비밀 평문) · information_schema 판정 · 다시 쓰기의 값 비교 UPDATE(IS NOT DISTINCT FROM · jsonb).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

process.env.CDP_SECRET_BOX_KEY = 'ef'.repeat(32);   // 키는 처음 쓸 때 읽는다(이 줄이 먼저)

import { saveCafe24Integration, getCafe24Integration } from '../cafe24-client';
import { saveGodoCredentials, getGodoCredentials } from '../godo-client';
import { resealIntegrationSecrets } from '../secret-box-reseal';
import { isSealed } from '../secret-box';

const CO = '00000000-0000-0000-0000-0000000000e2';
const raw = async (mallId: string) =>
  (await query(`SELECT access_token, refresh_token, webhook_secret, meta FROM company_integrations WHERE company_id = $1::uuid AND mall_id = $2`, [CO, mallId])).rows[0];

beforeAll(async () => {
  // 사본은 운영 + 닫힌 DDL(C73-DDL-2 = text)이다. 이 파일의 주장은 DDL-2 전(varchar(100)) 갈래라 그 꼴로 되돌린다(이 사본 안에서만 · 판정 캐시는 아직 비어 있다)
  await query(`ALTER TABLE company_integrations ALTER COLUMN webhook_secret TYPE varchar(100)`);
  await insertMinimalRow(pool, 'companies', { id: CO });
});

describe('K8 쓰기 = 암호문 · 읽기 = 두 꼴 모두', () => {
  it('카페24 저장: 토큰 칸 암호문 · webhook_secret = 칸이 짧아(DDL-2 전) 평문 · 읽기 = 평문 토큰', async () => {
    await saveCafe24Integration(CO, 'sb-shop', {
      access_token: 'at-plain', refresh_token: 'rt-plain', expires_at: new Date(Date.now() + 7200_000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(), scopes: ['mall.read_order'], user_id: 'u', shop_no: 1, issued_at: new Date().toISOString(),
    } as any, 'w'.repeat(64));
    const r = await raw('sb-shop');
    expect(isSealed(r.access_token) && isSealed(r.refresh_token)).toBe(true);
    expect(r.webhook_secret).toBe('w'.repeat(64));
    const i = await getCafe24Integration(CO, 'sb-shop');
    expect([i?.accessToken, i?.refreshToken, i?.webhookSecret]).toEqual(['at-plain', 'rt-plain', 'w'.repeat(64)]);
  });

  it('고도몰 키(meta) 암호문 · 읽기 = 평문', async () => {
    await saveGodoCredentials(CO, 'godo-key-plain');
    expect(isSealed((await raw('godo')).meta.godo_key)).toBe(true);
    expect((await getGodoCredentials(CO))?.key).toBe('godo-key-plain');
  });
});

describe('K8 DML-2 다시 쓰기 · DML-2R 되돌림', () => {
  it('옛 평문 행 → 암호문(실패 0) · 다시 돌리면 바꿀 것 0 · 되돌림 = 평문(웹훅 비밀은 DDL-2 전이라 평문 그대로)', async () => {
    await query(
      `INSERT INTO company_integrations (id, company_id, provider, mall_id, access_token, refresh_token, scope, meta, webhook_secret, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, 'woocommerce', 'old.example', '', '', '', '{"woo_consumer_key":"ck_old","woo_consumer_secret":"cs_old","woo_site_url":"https://old.example/"}'::jsonb, $2, 'active', NOW(), NOW())`,
      [CO, 's'.repeat(64)],
    );
    const a = await resealIntegrationSecrets(false);
    expect(a.failed).toEqual([]);
    expect(a.webhookLeftPlain).toBe(true);
    const sealed = await raw('old.example');
    expect(isSealed(sealed.meta.woo_consumer_key) && isSealed(sealed.meta.woo_consumer_secret)).toBe(true);
    expect(sealed.meta.woo_site_url).toBe('https://old.example/');
    expect(sealed.webhook_secret).toBe('s'.repeat(64));
    expect((await resealIntegrationSecrets(false)).changed).toBe(0);

    const back = await resealIntegrationSecrets(true);
    expect(back.failed).toEqual([]);
    const plain = await raw('old.example');
    expect([plain.meta.woo_consumer_key, plain.meta.woo_consumer_secret]).toEqual(['ck_old', 'cs_old']);
    expect((await raw('sb-shop')).access_token).toBe('at-plain');
  });
});
