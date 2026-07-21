/**
 * seedBrandContact — DM 생성 시 브랜드킷 연락처를 footer·store_info 빈 필드에 시드(2026-07-21).
 * 편집=발송 유지(생성 시점 시드), 기존 값 미덮어씀.
 */
import { describe, it, expect } from 'vitest';
import { seedBrandContact } from './dm-ai';

const mk = (type: string, props: any) => ({ id: type, type, order: 0, visible: true, props } as any);

describe('seedBrandContact', () => {
  it('footer 빈 cs_phone에 brand_kit 고객센터 시드', () => {
    const out = seedBrandContact([mk('footer', {})], { contact: { cs_phone: '1544-0000' } });
    expect((out[0].props as any).cs_phone).toBe('1544-0000');
  });
  it('이미 값 있으면 덮어쓰지 않음(사용자 입력 보존)', () => {
    const out = seedBrandContact([mk('footer', { cs_phone: '기존번호' })], { contact: { cs_phone: '1544-0000' } });
    expect((out[0].props as any).cs_phone).toBe('기존번호');
  });
  it('store_info — 빈 필드만 시드, 채워진 필드 보존', () => {
    const out = seedBrandContact([mk('store_info', { phone: '기존' })], { contact: { phone: '새', email: 'a@b.co', website: 'https://w', address: '서울' } });
    const p = out[0].props as any;
    expect(p.phone).toBe('기존');
    expect(p.email).toBe('a@b.co');
    expect(p.website).toBe('https://w');
    expect(p.address).toBe('서울');
  });
  it('brand_kit contact 없으면 원본 그대로(참조 동일)', () => {
    const s = [mk('footer', {})];
    expect(seedBrandContact(s, null)).toBe(s);
    expect(seedBrandContact(s, {})).toBe(s);
  });
  it('무관 섹션(hero)은 무변경', () => {
    const out = seedBrandContact([mk('hero', { headline: 'x' })], { contact: { cs_phone: '1', phone: '2' } });
    expect((out[0].props as any).headline).toBe('x');
    expect((out[0].props as any).cs_phone).toBeUndefined();
  });
});
