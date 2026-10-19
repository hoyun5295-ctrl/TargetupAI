/**
 * email-gallery-full-bleed.test.ts — 갤러리 list_1xN + full_bleed 이음새 계약 (2026-09-09)
 *
 * 경위: AI 영업 기획전 슬라이스 조립 모드. 기획전 페이지의 세로 슬라이스(960px)를 그대로 이어 붙이는데,
 *   이메일 갤러리 셀에 패딩·라운드가 붙어 슬라이스 사이가 벌어지고 모서리가 깎였다. DM 렌더러는 이미
 *   `full_bleed`(2026-07-15 · 패딩·테두리·라운드·간격 0)를 읽는데 이메일 렌더러만 무시하고 있었다(짝 어긋남).
 *
 * 계약: `full_bleed === true` 인 갤러리는 셀 패딩 0 · 라운드 0 · 섹션 패딩 0 · 폭 속성 유지 · 링크 유지.
 *   full_bleed 가 없으면 옛 출력 그대로(회귀 0).
 *   ★ 2026-10-19 B-1014-3⑦ 격자에도 적용(DM 렌더 = 배치 무관) · 옛: 세로 1열 전용이라 격자에서 켠 토글이 눌러도 안 바뀌었다.
 *     자동으로 켜는 곳(완성 이미지 · 슬라이스 · 카탈로그 · 한 줄 템플릿 · AI 영업)은 전부 세로 1열이라 사람이 격자에서 켠 때만 달라진다.
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections } from '../email-section-renderer';
import type { Section } from '../../dm/dm-section-registry';

const gallery = (extra: Record<string, unknown>): Section => ({
  id: 'g1', type: 'gallery', order: 0, visible: true,
  props: { images: [{ url: 'https://ex.com/a.jpg', link_url: 'https://shop.example/event' }, { url: 'https://ex.com/b.jpg', link_url: 'https://shop.example/event' }], layout: 'list_1xN', ...extra } as any,
} as Section);

const cellsOf = (html: string): string[] => html.match(/<td[^>]*>\s*<a href="https:\/\/shop\.example\/event">/gi) || [];

describe('이메일 갤러리 full_bleed(list_1xN) — 슬라이스가 이음새 없이 이어진다', () => {
  it('full_bleed = 셀 패딩 0 · 라운드 0 · 섹션 패딩 0 · 이미지 폭 속성·링크 유지', () => {
    const html = renderEmailSections([gallery({ full_bleed: true })], {});
    const cells = cellsOf(html);
    expect(cells).toHaveLength(2);
    for (const c of cells) expect(c).toMatch(/padding:0(?:;|")/);
    const imgs = html.match(/<img\b[^>]*>/gi) || [];
    expect(imgs).toHaveLength(2);
    for (const t of imgs) {
      expect(t).toMatch(/\swidth="100%"/);
      expect(t).not.toMatch(/border-radius:(?!0)/);
    }
    // 섹션을 감싸는 셀도 패딩 0(위아래 여백이 슬라이스를 띄우지 않게)
    const wrap = html.match(/<tr><td style="padding:[^"]*">\s*<table role="presentation"[^>]*>\s*<tr><td[^>]*><a href="https:\/\/shop\.example\/event">/i);
    expect(wrap).not.toBeNull();
    expect(wrap![0]).toMatch(/^<tr><td style="padding:0"/);
  });

  it('full_bleed 없음 = 옛 출력(셀 패딩·라운드 있음) 그대로', () => {
    const html = renderEmailSections([gallery({})], {});
    const cells = cellsOf(html);
    expect(cells).toHaveLength(2);
    for (const c of cells) expect(c).not.toMatch(/padding:0(?:;|")/);
    const imgs = html.match(/<img\b[^>]*>/gi) || [];
    expect(imgs.some((t) => /border-radius:(?!0)/.test(t))).toBe(true);
  });

  it('grid 배치에도 full_bleed 가 산다(DM 과 같은 뜻 · 장수 상한은 격자 9 그대로)', () => {
    const html = renderEmailSections([gallery({ full_bleed: true, layout: 'grid_2x2' })], {});
    const cells = cellsOf(html);
    expect(cells).toHaveLength(2);
    for (const c of cells) expect(c).toMatch(/padding:0(?:;|")/);
    const off = renderEmailSections([gallery({ layout: 'grid_2x2' })], {});
    for (const c of cellsOf(off)) expect(c).not.toMatch(/padding:0(?:;|")/);
  });
});
