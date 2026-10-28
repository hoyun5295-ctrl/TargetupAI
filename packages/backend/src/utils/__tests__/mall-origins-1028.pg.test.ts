// replaces: none
/**
 * 몰 연동 수집 허용 도메인 — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 K12 · M28 · M20)
 *
 * 주장이 SQL 에 기댄다: 같은 문장 안 회사 행 잠금 · 쓰기 CTE · jsonb 배열 합치기 · EXCEPT(남은 몰의 값은 남김).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { registerMallAllowedOrigins, releaseMallAllowedOrigins, mallPlatformOrigins } from '../mall-origins';

const CO = '00000000-0000-0000-0000-0000000000e1';
const list = async (): Promise<string[]> =>
  ((await query(`SELECT cdp_allowed_origins FROM companies WHERE id = $1::uuid`, [CO])).rows[0].cdp_allowed_origins || []).slice().sort();
const row = async (provider: string, mallId: string) => {
  await query(
    `INSERT INTO company_integrations (id, company_id, provider, mall_id, access_token, refresh_token, scope, meta, status, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2, $3, '', '', '', '{}'::jsonb, 'active', NOW(), NOW())`,
    [CO, provider, mallId],
  );
};

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await query(`UPDATE companies SET cdp_allowed_origins = ARRAY['https://shop.example'] WHERE id = $1::uuid`, [CO]);
  await row('woocommerce', 'shop.example');
  await row('cafe24', 'c1');
  await row('woocommerce', 'twin.example');
});

describe('K12 등록 · 해제 = 그 몰이 넣은 값만', () => {
  it('손 등록 값은 몰 값으로 적지 않고 해제가 지우지 않는다 · 다른 몰 값 불변 · 함께 쓰는 값은 남은 몰이 있으면 남는다', async () => {
    await registerMallAllowedOrigins(CO, 'woocommerce', 'shop.example', mallPlatformOrigins('woocommerce', 'shop.example'));
    await registerMallAllowedOrigins(CO, 'cafe24', 'c1', mallPlatformOrigins('cafe24', 'c1'));
    expect(await list()).toEqual(['https://c1.cafe24.com', 'https://m.c1.cafe24.com', 'https://m.shop.example', 'https://shop.example', 'https://www.shop.example']);
    const meta = (await query(`SELECT meta FROM company_integrations WHERE company_id = $1::uuid AND mall_id = 'shop.example'`, [CO])).rows[0].meta;
    expect(meta.auto_origins.slice().sort()).toEqual(['https://m.shop.example', 'https://www.shop.example']);

    // 다른 몰(같은 주소를 증명한 몰)이 같은 값을 함께 쓴다
    await registerMallAllowedOrigins(CO, 'woocommerce', 'twin.example', ['https://www.shop.example']);

    await query(`UPDATE company_integrations SET status = 'revoked' WHERE company_id = $1::uuid AND mall_id = 'shop.example'`, [CO]);
    await releaseMallAllowedOrigins(CO, 'woocommerce', 'shop.example');
    expect(await list()).toEqual(['https://c1.cafe24.com', 'https://m.c1.cafe24.com', 'https://shop.example', 'https://www.shop.example']);

    await query(`UPDATE company_integrations SET status = 'revoked' WHERE company_id = $1::uuid AND mall_id = 'twin.example'`, [CO]);
    await releaseMallAllowedOrigins(CO, 'woocommerce', 'twin.example');
    expect(await list()).toEqual(['https://c1.cafe24.com', 'https://m.c1.cafe24.com', 'https://shop.example']);
  });

  it('해제된 행에는 등록하지 않는다(회사 목록 불변) · 같은 값 다시 등록 = 그대로', async () => {
    const before = await list();
    await registerMallAllowedOrigins(CO, 'woocommerce', 'shop.example', ['https://new.example']);
    expect(await list()).toEqual(before);
    await registerMallAllowedOrigins(CO, 'cafe24', 'c1', mallPlatformOrigins('cafe24', 'c1'));
    expect(await list()).toEqual(before);
  });
});

describe('Codex R1 #8 · 늦은 해제 정리는 다시 연결된 몰을 건드리지 않는다', () => {
  it('해제 뒤 같은 몰이 다시 연결되면(행 active) 해제 정리 = 아무것도 안 함', async () => {
    await registerMallAllowedOrigins(CO, 'cafe24', 'c1', mallPlatformOrigins('cafe24', 'c1'));
    const before = await list();
    await releaseMallAllowedOrigins(CO, 'cafe24', 'c1');   // c1 은 active
    expect(await list()).toEqual(before);
    expect((await query(`SELECT meta ? 'auto_origins' AS has FROM company_integrations WHERE company_id = $1::uuid AND mall_id = 'c1'`, [CO])).rows[0].has).toBe(true);
  });
});
