// replaces: none
/**
 * C112 키트 로고 = 비어 있을 때만 채운다 · 실 PG 시험(★ 2026-11-07 설계서 docs/2026-11-07-c112-studio-brand-logo-design.md D11 · §5 실 PG 줄)
 *   덮어쓰기 0 · 다른 키(색 · 서체) 보존 · 옛 문자열 저장 = 합친 객체(updateCompanyBrandKit 과 같은 꼴).
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { setBrandKitLogoIfEmpty } from '../dm/dm-brand-kit';

const newCompany = async (kit: unknown, asText = false): Promise<string> => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'companies', { id });
  if (kit !== undefined) await query(`UPDATE companies SET brand_kit = ${asText ? 'to_jsonb($1::text)' : '$1::jsonb'} WHERE id = $2`, [asText ? JSON.stringify(kit) : JSON.stringify(kit), id]);
  return id;
};
const kitOf = async (id: string) => (await query(`SELECT brand_kit FROM companies WHERE id = $1`, [id])).rows[0]?.brand_kit;

describe('C112 setBrandKitLogoIfEmpty — 빈 칸만 · 덮어쓰기 0', () => {
  it('덤프 표에 companies.brand_kit(jsonb)이 있다(새 칸 0 · 운영 사용 중 칸)', async () => {
    const r = await query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'brand_kit'`);
    expect(r.rows[0]?.data_type).toBe('jsonb');
  });

  it('빈 키트(NULL · {} · logo_url 빈 글) = 채움', async () => {
    for (const kit of [undefined, {}, { logo_url: '  ' }]) {
      const co = await newCompany(kit);
      expect(await setBrandKitLogoIfEmpty(co, '/api/cdp/inapp/image/x/logo.png')).toBe(true);
      expect((await kitOf(co)).logo_url).toBe('/api/cdp/inapp/image/x/logo.png');
    }
  });

  it('이미 차 있음 = 그대로 + false', async () => {
    const co = await newCompany({ logo_url: 'https://brand.example.com/logo.png', primary_color: '#112233' });
    expect(await setBrandKitLogoIfEmpty(co, '/api/cdp/inapp/image/x/new.png')).toBe(false);
    expect(await kitOf(co)).toEqual({ logo_url: 'https://brand.example.com/logo.png', primary_color: '#112233' });
  });

  it('다른 키(색 · 서체 · 연락처) 보존', async () => {
    const co = await newCompany({ primary_color: '#123456', font_ko: 'Pretendard', contact: { website: 'https://shop.example.com' } });
    expect(await setBrandKitLogoIfEmpty(co, '/api/cdp/inapp/image/x/l.png')).toBe(true);
    expect(await kitOf(co)).toEqual({ primary_color: '#123456', font_ko: 'Pretendard', contact: { website: 'https://shop.example.com' }, logo_url: '/api/cdp/inapp/image/x/l.png' });
  });

  it('옛 문자열 저장 = DB 안에서 풀어 합친 객체로', async () => {
    const co = await newCompany({ primary_color: '#abcdef' }, true);
    expect(await setBrandKitLogoIfEmpty(co, '/api/cdp/inapp/image/x/s.png')).toBe(true);
    expect(await kitOf(co)).toEqual({ primary_color: '#abcdef', logo_url: '/api/cdp/inapp/image/x/s.png' });
  });

  it('옛 문자열 저장에 로고가 이미 있음 = 그대로(문자열 그대로) + false', async () => {
    const co = await newCompany({ logo_url: 'https://brand.example.com/old.png', primary_color: '#010203' }, true);
    const before = await kitOf(co);
    expect(typeof before).toBe('string');
    expect(await setBrandKitLogoIfEmpty(co, '/api/cdp/inapp/image/x/n.png')).toBe(false);
    expect(await kitOf(co)).toEqual(before);
  });

  it('풀 수 없는 옛 문자열 = 오류 · 쓰기 0(빈 키트로 보고 덮어쓰지 않는다)', async () => {
    const co = await newCompany(undefined);
    await query(`UPDATE companies SET brand_kit = to_jsonb($1::text) WHERE id = $2`, ['not json {', co]);
    await expect(setBrandKitLogoIfEmpty(co, '/api/cdp/inapp/image/x/e.png')).rejects.toThrow();
    expect(await kitOf(co)).toBe('not json {');
  });
});
