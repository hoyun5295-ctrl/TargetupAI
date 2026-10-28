// replaces: none
/**
 * 웹훅 수신 자격 · 만료 표시 CAS · 유지 대상 · BYO 승인 연결 시각 — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 K6 · I6 · M3 · Codex R4 #2 · R1 #6)
 *
 * 주장이 SQL 에 기댄다: jsonb 글자 꼴 검사 뒤 시각 변환 · 유예 INTERVAL · IS NOT DISTINCT FROM 토큰판 비교 · make_interval · ON CONFLICT 의 COALESCE.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => 0) }));

import { getCafe24IntegrationsByMallId, saveCafe24ByoCredentials, saveCafe24Integration, getCafe24Integration } from '../cafe24-client';
import { getImwebIntegrationsBySiteCode } from '../imweb-client';
import { markTokenRejected, listTokenKeepaliveTargets } from '../integration-token';

const CO = '00000000-0000-0000-0000-0000000000c5';
const row = async (provider: string, mallId: string, o: { status?: string; connected?: boolean; meta?: any; expiresAgo?: string } = {}) => {
  await query(
    `INSERT INTO company_integrations (id, company_id, provider, mall_id, access_token, refresh_token, token_expires_at, scope, meta, status, connected_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'a', 'r', NOW() - $4::interval, '', $5::jsonb, $6, CASE WHEN $7 THEN NOW() END, NOW(), NOW())`,
    [CO, provider, mallId, o.expiresAgo ?? '0 seconds', JSON.stringify(o.meta ?? {}), o.status ?? 'active', o.connected ?? true],
  );
};
const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
});

describe('K6 웹훅 수신 자격', () => {
  it('카페24: 연결된 active · 유예 안의 만료(14일) · 갱신 토큰 만료 시각이 미래면 받는다 · 연결 전 · 해제 · 유예 끝 · 꼴 밖 시각 = 안 받는다', async () => {
    await row('cafe24', 'c-active');
    await row('cafe24', 'c-pending', { status: 'pending_oauth', connected: false });
    await row('cafe24', 'c-revoked', { status: 'revoked' });
    await row('cafe24', 'c-grace', { status: 'token_expired', meta: { token_expired_at: ago(3) } });
    await row('cafe24', 'c-over', { status: 'token_expired', meta: { token_expired_at: ago(20) } });
    await row('cafe24', 'c-refresh', { status: 'token_expired', meta: { token_expired_at: ago(20), refresh_token_expires_at: new Date(Date.now() + 86400_000).toISOString() } });
    await row('cafe24', 'c-bad', { status: 'token_expired', meta: { token_expired_at: 'not-a-time' } });
    await row('cafe24', 'c-old', { status: 'token_expired' });
    const ok: Record<string, number> = {};
    for (const m of ['c-active', 'c-pending', 'c-revoked', 'c-grace', 'c-over', 'c-refresh', 'c-bad', 'c-old']) ok[m] = (await getCafe24IntegrationsByMallId(m)).length;
    expect(ok).toEqual({ 'c-active': 1, 'c-pending': 0, 'c-revoked': 0, 'c-grace': 1, 'c-over': 0, 'c-refresh': 1, 'c-bad': 0, 'c-old': 0 });
  });

  it('아임웹: 유예 90일', async () => {
    await row('imweb', 'i-grace', { status: 'token_expired', meta: { token_expired_at: ago(60) } });
    await row('imweb', 'i-over', { status: 'token_expired', meta: { token_expired_at: ago(95) } });
    expect([(await getImwebIntegrationsBySiteCode('i-grace')).length, (await getImwebIntegrationsBySiteCode('i-over')).length]).toEqual([1, 0]);
  });
});

describe('K6 만료 표시 = 그 요청에 쓴 토큰판일 때만', () => {
  it('옛 토큰판의 늦은 거절은 새 토큰 행을 만료로 덮지 않는다 · 지금 판이면 만료 + 유예 시계', async () => {
    await row('cafe24', 'c-cas');
    const held = (await getCafe24IntegrationsByMallId('c-cas'))[0];
    await query(`UPDATE company_integrations SET token_expires_at = NOW() + INTERVAL '2 hours' WHERE id = $1::uuid`, [held.id]);   // 그 사이 새 승인 · 갱신
    expect(await markTokenRejected(held)).toBe(false);
    expect((await query(`SELECT status FROM company_integrations WHERE id = $1::uuid`, [held.id])).rows[0].status).toBe('active');
    const fresh = (await getCafe24IntegrationsByMallId('c-cas'))[0];
    expect(await markTokenRejected(fresh)).toBe(true);
    const r = (await query(`SELECT status, meta->>'token_expired_at' AS at FROM company_integrations WHERE id = $1::uuid`, [held.id])).rows[0];
    expect(r.status).toBe('token_expired');
    expect(r.at).toBeTruthy();
    expect((await getCafe24IntegrationsByMallId('c-cas')).length).toBe(1);   // 유예 안 = 계속 받는다
  });
});

describe('K6 유지 대상 · BYO 승인', () => {
  it('마지막 갱신에서 6일 지난 active 카페24 행만 유지 대상', async () => {
    await row('cafe24', 'c-keep', { expiresAgo: '7 days' });
    await row('cafe24', 'c-recent', { expiresAgo: '2 days' });
    await row('cafe24', 'c-keep-expired', { status: 'token_expired', expiresAgo: '9 days' });
    const malls = (await listTokenKeepaliveTargets('cafe24', 500)).map((t) => t.mallId);
    expect(malls).toContain('c-keep');
    expect(malls).not.toContain('c-recent');
    expect(malls).not.toContain('c-keep-expired');
  });

  it('BYO(연결 전 자격 저장) → 승인 저장 = connected_at 채움 → 수신 자격 안', async () => {
    await saveCafe24ByoCredentials(CO, 'c-byo', 'cid', 'csecret');
    expect((await getCafe24IntegrationsByMallId('c-byo')).length).toBe(0);
    await saveCafe24Integration(CO, 'c-byo', {
      access_token: 'at', refresh_token: 'rt', expires_at: new Date(Date.now() + 7200_000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(), scopes: ['mall.read_order'], user_id: 'u', shop_no: 1, issued_at: new Date().toISOString(),
    } as any);
    expect((await getCafe24Integration(CO, 'c-byo'))?.status).toBe('active');
    expect((await getCafe24IntegrationsByMallId('c-byo')).length).toBe(1);
  });
});

describe('Codex R1 #2 · 갱신 저장 = 그 토큰판 · 해제 아닌 행일 때만', () => {
  it('도는 사이 해제 = 저장 0(되살리지 않음) · 그 사이 다른 갱신 = 저장 0 · 만료 표시였던 행 = 갱신 성공으로 active', async () => {
    const { saveRefreshedToken } = await import('../integration-token');
    await row('cafe24', 'r-revoked');
    const a = (await getCafe24IntegrationsByMallId('r-revoked'))[0];
    await query(`UPDATE company_integrations SET status = 'revoked' WHERE id = $1::uuid`, [a.id]);
    expect(await saveRefreshedToken({ id: a.id, tokenExpiresAtRaw: a.tokenExpiresAtRaw, accessToken: 'new', tokenExpiresAt: new Date(Date.now() + 3600_000) })).toBe(false);
    expect((await query(`SELECT status, access_token FROM company_integrations WHERE id = $1::uuid`, [a.id])).rows[0]).toMatchObject({ status: 'revoked', access_token: 'a' });

    await row('cafe24', 'r-raced');
    const b = (await getCafe24IntegrationsByMallId('r-raced'))[0];
    await query(`UPDATE company_integrations SET token_expires_at = NOW() + INTERVAL '3 hours' WHERE id = $1::uuid`, [b.id]);
    expect(await saveRefreshedToken({ id: b.id, tokenExpiresAtRaw: b.tokenExpiresAtRaw, accessToken: 'late', tokenExpiresAt: new Date() })).toBe(false);

    await row('cafe24', 'r-expired', { status: 'token_expired', meta: { token_expired_at: new Date().toISOString() } });
    const c = (await getCafe24IntegrationsByMallId('r-expired'))[0];
    expect(await saveRefreshedToken({ id: c.id, tokenExpiresAtRaw: c.tokenExpiresAtRaw, accessToken: 'fresh', refreshToken: 'rt2', tokenExpiresAt: new Date(Date.now() + 7200_000), meta: { issued_at: 'x' } })).toBe(true);
    expect((await query(`SELECT status, access_token, refresh_token, meta->>'issued_at' AS issued FROM company_integrations WHERE id = $1::uuid`, [c.id])).rows[0]).toEqual({ status: 'active', access_token: 'fresh', refresh_token: 'rt2', issued: 'x' });
  });
});
