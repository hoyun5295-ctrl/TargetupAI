import { describe, it, expect } from 'vitest';
import { sanitizeInAppDesign, normalizeTheme, INAPP_THEME_KEYS, INAPP_DESIGN_TREATMENTS } from './inapp-message';

/**
 * ★ 2026-07-14 인앱 디자인 3.0 고정 테스트 (backend)
 * - sanitizeInAppDesign: 화이트리스트 fail-closed (미지 키·무효 값 탈락, 유효 0개 = null)
 * - INAPP_THEME_KEYS: 시그니처 7종 등재 + normalizeTheme 왕복 (SDK VALID_KEYS와 1:1 동기 전제)
 */

describe('sanitizeInAppDesign (design jsonb 정규화)', () => {
  it('유효 키만 보존 — 미지 키·무효 값 탈락', () => {
    const out = sanitizeInAppDesign({
      font_display: '"Noto Serif KR", serif',
      treatment: 'framed',
      motion: 'rich',
      backdrop: { dim: 'deep', blur: false, evil: 'x' },
      __proto__injected: true,
      random_key: 'drop-me',
    });
    expect(out).toEqual({
      font_display: '"Noto Serif KR", serif',
      treatment: 'framed',
      motion: 'rich',
      backdrop: { dim: 'deep', blur: false },
    });
  });

  it('무효 enum 값 = 해당 키 탈락 (fail-closed)', () => {
    expect(sanitizeInAppDesign({ treatment: 'evil', motion: 'party', backdrop: { dim: 'pitch-black' } })).toBeNull();
    expect(sanitizeInAppDesign({ treatment: 'spotlight', motion: 'nope' })).toEqual({ treatment: 'spotlight' });
  });

  it('font_display 무해화 — style 탈출 문자 제거 + 120자 상한', () => {
    const out = sanitizeInAppDesign({ font_display: '</style><script>alert(1)</script>"Noto Serif KR"' });
    expect(out?.font_display).not.toContain('<');
    expect(out?.font_display).not.toContain('>');
    const long = sanitizeInAppDesign({ font_display: 'a'.repeat(500) });
    expect(String(long?.font_display).length).toBeLessThanOrEqual(120);
  });

  it('비객체·배열·빈 객체 = null', () => {
    expect(sanitizeInAppDesign(null)).toBeNull();
    expect(sanitizeInAppDesign('rich')).toBeNull();
    expect(sanitizeInAppDesign([1, 2])).toBeNull();
    expect(sanitizeInAppDesign({})).toBeNull();
    expect(sanitizeInAppDesign({ unknown: 1 })).toBeNull();
  });
});

describe('테마 키 3.0 (시그니처 7종)', () => {
  it('INAPP_THEME_KEYS = 기본 6 + 시그니처 7', () => {
    expect(INAPP_THEME_KEYS).toHaveLength(13);
    for (const k of ['editorial', 'luxury-dark', 'bold-sale', 'soft-pastel', 'paper', 'city-night', 'festive']) {
      expect(INAPP_THEME_KEYS as readonly string[]).toContain(k);
    }
  });

  it('normalizeTheme — 시그니처 키 통과, 미지 키 = auto', () => {
    expect(normalizeTheme('luxury-dark')).toBe('luxury-dark');
    expect(normalizeTheme('festive')).toBe('festive');
    expect(normalizeTheme('neon-explosion')).toBe('auto');
    expect(normalizeTheme(null)).toBe('auto');
  });

  it('구도 화이트리스트 4종 (SDK INAPP_TREATMENTS 값 집합과 동기)', () => {
    expect([...INAPP_DESIGN_TREATMENTS]).toEqual(['classic', 'framed', 'typographic', 'spotlight']);
  });
});
