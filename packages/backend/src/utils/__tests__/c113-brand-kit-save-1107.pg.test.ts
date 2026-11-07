// replaces: none
/**
 * C113 K20 · D20 — 브랜드 키트 저장(updateCompanyBrandKit) · 실 PG(★ 2026-11-07 설계서 docs/2026-11-07-c113-structure-fix-design.md §2-N)
 *   옛 문자열 저장본 갈래만 DB 안에서 풀어 키 병합(앱 쪽 읽기 결과로 통째 덮기 0) · 객체 · 빈 키트 문장 = 그대로(§0-0 미가입 변화 0).
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { updateCompanyBrandKit, DEFAULT_BRAND_KIT } from '../dm/dm-brand-kit';

const newCompany = async (kit: unknown, asText = false): Promise<string> => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', { id });
  if (kit !== undefined) await query(`UPDATE companies SET brand_kit = ${asText ? 'to_jsonb($1::text)' : '$1::jsonb'} WHERE id = $2`, [JSON.stringify(kit), id]);
  return id;
};
const kitOf = async (id: string) => (await query(`SELECT brand_kit FROM companies WHERE id = $1`, [id])).rows[0]?.brand_kit;

describe('C113 K20 — 브랜드 키트 저장 · 옛 문자열 갈래', () => {
  it('옛 문자열 저장 + 패치 = 저장된 키 그대로 + 패치 키(기본값 끼워 넣기 · 잃음 0)', async () => {
    const co = await newCompany({ primary_color: '#abcdef', contact: { website: 'https://shop.example.com' } }, true);
    expect(typeof (await kitOf(co))).toBe('string');
    await updateCompanyBrandKit(co, { font_ko: 'Pretendard' } as any);
    expect(await kitOf(co)).toEqual({ primary_color: '#abcdef', contact: { website: 'https://shop.example.com' }, font_ko: 'Pretendard' });
  });

  it('풀 수 없는 옛 문자열 = 오류 · 쓰기 0', async () => {
    const id = randomUUID();
    await insertMinimalRow(pool, 'companies', { id });
    await query(`UPDATE companies SET brand_kit = to_jsonb('not json {'::text) WHERE id = $1`, [id]);
    const before = await kitOf(id);
    await expect(updateCompanyBrandKit(id, { font_ko: 'X' } as any)).rejects.toThrow();
    expect(await kitOf(id)).toEqual(before);
  });

  it('객체 키트 = 키 병합(지금 그대로)', async () => {
    const co = await newCompany({ primary_color: '#123456', tone: 'warm' });
    await updateCompanyBrandKit(co, { font_ko: 'Gothic' } as any);
    expect(await kitOf(co)).toEqual({ primary_color: '#123456', tone: 'warm', font_ko: 'Gothic' });
  });

  it('빈 키트(NULL) = 기본값 + 패치 전체(지금 그대로 · 미가입 변화 0)', async () => {
    const co = await newCompany(undefined);
    await updateCompanyBrandKit(co, { font_ko: 'Gothic' } as any);
    expect(await kitOf(co)).toEqual({ ...DEFAULT_BRAND_KIT, font_ko: 'Gothic' });
  });
});
