// replaces: none
/**
 * 원격 업데이트 릴리스 = (티어 · 회사) 범위(설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md 3-2 ⑩)
 * 기대값 = 「회사 지정 > 티어 일치 > 전역 · 등록은 같은 범위만 끈다」를 손으로 따라간 값.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { pickSyncRelease, registerSyncRelease } from '../sync-releases';

const A = randomUUID();
const B = randomUUID();
const run = (text: string, params?: any[]) => pool.query(text, params);
const reg = (version: string, tier: string | null, companyId: string | null) =>
  registerSyncRelease(run, { version, downloadUrl: `/api/sync/download/${version}`, checksum: null, releaseNotes: null, forceUpdate: true, tier, companyId });
const pick = async (tier: string | null, co: string) => (await pickSyncRelease(run, tier, co))?.version ?? null;

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C101-DDL-2'));
  await pool.query(`DELETE FROM sync_releases`);   // 시험 DB 복제본 · 이 파일이 고르는 행만 남긴다
  await insertMinimalRow(pool, 'companies', { id: A, company_name: '릴리스 A' });
  await insertMinimalRow(pool, 'companies', { id: B, company_name: '릴리스 B' });
}, 120_000);

describe('릴리스 범위(실 PG)', () => {
  it('회사 지정 릴리스는 그 회사만 받는다 · 같은 티어 다른 회사 = 티어 릴리스 · 다른 티어 = 없음', async () => {
    await reg('1.7.5', 'win-modern', null);
    await reg('1.7.6', 'win-modern', A);
    expect(await pick('win-modern', A)).toBe('1.7.6');
    expect(await pick('win-modern', B)).toBe('1.7.5');
    expect(await pick('win-legacy', A)).toBeNull();
  });

  it('등록은 같은 범위만 끈다 — 회사 릴리스 갱신이 티어 릴리스를 끄지 않고 그 반대도 같다', async () => {
    await reg('1.7.7', 'win-modern', A);
    expect(await pick('win-modern', A)).toBe('1.7.7');
    expect(await pick('win-modern', B)).toBe('1.7.5');
    await reg('1.7.8', 'win-modern', null);
    expect(await pick('win-modern', A)).toBe('1.7.7');
    expect(await pick('win-modern', B)).toBe('1.7.8');
    const active = (await pool.query(`SELECT version FROM sync_releases WHERE is_active ORDER BY version`)).rows.map((r) => r.version);
    expect(active).toEqual(['1.7.7', '1.7.8']);
  });

  it('티어 없는 전역 릴리스 = 티어 일치보다 뒤 · 회사 지정 전역(티어 없음)은 티어 일치보다 앞', async () => {
    await reg('1.8.0', null, null);
    expect(await pick('win-modern', B)).toBe('1.7.8');
    expect(await pick('win-legacy', B)).toBe('1.8.0');
    await reg('1.8.1', null, B);
    expect(await pick('win-modern', B)).toBe('1.8.1');
    expect(await pick('win-modern', A)).toBe('1.7.7');
  });
});
