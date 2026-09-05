/**
 * sales-outreach-look.test.ts — 룩(구도·배경면·아트디렉션) 결정적 배정 CT 행동 테스트 (2026-09-05(3) · 설계서 §22 C1)
 * 회의론자 R1: "JSON 키 수가 아니라 렌더 HTML 지표로 검증한다" — 두 렌더러를 실제로 돌려 data-treatment= · dm-bgx- · 이메일 밴드 td를 센다.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));

import {
  applyOutreachLook, lookStatsOf, pickTreatment, buildOutreachBrandKit, outreachArtDirection, countLookMarkers, accessiblePrimaryOf,
  OUTREACH_BRAND_KIT_KEYS, OUTREACH_BACKGROUNDS, LANDSCAPE_RATIO, OUTREACH_ART_DIRECTION, OUTREACH_DM_LAYOUT_MODE,
} from '../sales-outreach-look';
import { TREATMENTS } from '../dm/dm-art-direction';
import { EMAIL_TREATMENTS, EMAIL_BACKGROUNDS } from '../email/email-blocks';
import { rebuildDmPages } from '../dm/dm-section-prune';
import { splitSectionsIntoPages, decideLayoutMode } from '../dm/dm-page-split';
import { renderDmViewerHtml } from '../dm/dm-viewer';
import { renderEmailSections } from '../email/email-section-renderer';
import type { Section } from '../dm/dm-section-registry';

const sec = (type: string, props: any, order: number): Section => ({ id: `t-${order}-${type}`, type, order, visible: true, props } as unknown as Section);
const IMG = (n: string) => `https://hanjul.ai/uploads/x/${n}.jpg`;
const dims = { [IMG('land')]: { width: 1600, height: 900 }, [IMG('port')]: { width: 900, height: 1400 }, [IMG('sq')]: { width: 1000, height: 1000 } };

function fixture(heroImage: string): Section[] {
  return [
    sec('header', { brand_name: '브랜드' }, 0),
    sec('hero', { headline: '헤드라인', sub_copy: '부제', image_url: heroImage }, 1),
    sec('text_card', { tag: '소개', headline: '첫 카드', body: '본문 1' }, 2),
    sec('product_carousel', { title: '추천', products: [{ name: 'A', price: 1000, image_url: IMG('sq'), link_url: 'https://b.com/1' }, { name: 'B', price: 2000, image_url: IMG('sq'), link_url: 'https://b.com/2' }] }, 3),
    sec('cta', { buttons: [{ label: '기획전 보기', url: 'https://b.com/event', style: 'primary' }] }, 4),
    sec('gallery', { title: '갤러리', layout: 'grid_2x2', images: [{ url: IMG('land') }, { url: IMG('land') }, { url: IMG('sq') }] }, 5),
    sec('text_card', { tag: '', headline: '둘째 카드', body: '본문 2' }, 6),
    sec('product_carousel', { title: '베스트', products: [{ name: 'C', price: 3000, image_url: IMG('sq'), link_url: 'https://b.com/3' }, { name: 'D', price: 4000, image_url: IMG('sq'), link_url: 'https://b.com/4' }] }, 7),
    sec('coupon', { discount_label: '혜택 한 줄', usage_condition: '' }, 8),
    sec('text_card', { tag: '', headline: '셋째 카드', body: '본문 3' }, 9),
    sec('cta', { buttons: [{ label: '자세히 보기', url: 'https://b.com/', style: 'primary' }] }, 10),
    sec('footer', { notes: '', cs_phone: '1588-0000' }, 11),
  ];
}

describe('applyOutreachLook — 값은 채널 허용표 안 · 섹션 최상위 · props 무변경', () => {
  it('DM: hero split(세로) · text_card lead→framed→soft · carousel focus+soft→list · gallery mosaic(가로 3장) · coupon ticket · cta bar+tint(마지막 제외)', () => {
    const r = applyOutreachLook(fixture(IMG('port')), 'DM', dims);
    const byId = Object.fromEntries(r.sections.map((s) => [s.id, s]));
    expect(byId['t-1-hero'].treatment).toBe('split');
    expect(byId['t-2-text_card'].treatment).toBe('lead');
    expect(byId['t-6-text_card'].background).toBe('soft');
    expect(byId['t-6-text_card'].treatment).toBeUndefined();
    expect(byId['t-9-text_card'].treatment).toBe('framed');
    expect(byId['t-3-product_carousel']).toMatchObject({ treatment: 'focus', background: 'soft' });
    expect(byId['t-7-product_carousel'].treatment).toBe('focus'); // 2~3개는 focus · list(작은 썸네일 행)는 쓰지 않는다
    expect(byId['t-7-product_carousel'].background).toBeUndefined();
    expect(byId['t-5-gallery'].treatment).toBe('mosaic');
    expect(byId['t-8-coupon'].treatment).toBe('ticket');
    expect(byId['t-4-cta']).toMatchObject({ treatment: 'bar', background: 'tint' });
    expect(byId['t-10-cta'].treatment).toBe('bar'); // 마지막 CTA도 브랜드 색 풀폭 바
    expect(byId['t-10-cta'].background).toBeUndefined();
    expect(byId['t-0-header'].treatment).toBeUndefined();
    expect(byId['t-11-footer'].treatment).toBeUndefined();
    // props는 한 글자도 안 바뀐다 · 순서 보존
    const before = fixture(IMG('port'));
    expect(r.sections.map((s) => s.props)).toEqual(before.map((s) => s.props));
    expect(r.sections.map((s) => s.id)).toEqual(before.map((s) => s.id));
    expect(r.stats.treatments).toBeGreaterThanOrEqual(7);
    expect(r.stats.backgrounds).toBe(3);
    // 전 배정값이 DM 허용표 안
    for (const s of r.sections) {
      if (s.treatment) expect(TREATMENTS[s.type], `${s.type}`).toContain(s.treatment);
      if (s.background) expect(OUTREACH_BACKGROUNDS).toContain(s.background);
    }
    expect(lookStatsOf(r.sections)).toEqual(r.stats);
  });
  it('hero: 이미지 없음 = typographic · DM은 이미지가 있으면 비율과 무관하게 split(배너 통째) · EMAIL은 가로형·비율 미상 = classic', () => {
    expect(applyOutreachLook(fixture(IMG('port')), 'DM', dims).sections[1].treatment).toBe('split');
    expect(applyOutreachLook(fixture(''), 'DM', dims).sections[1].treatment).toBe('typographic');
    expect(applyOutreachLook(fixture(IMG('land')), 'DM', dims).sections[1].treatment).toBe('split');
    expect(applyOutreachLook(fixture(IMG('unknown')), 'DM', dims).sections[1].treatment).toBe('split');
    expect(applyOutreachLook(fixture(IMG('land')), 'EMAIL', dims).sections[1].treatment).toBeUndefined();
    expect(applyOutreachLook(fixture(IMG('unknown')), 'EMAIL', dims).sections[1].treatment).toBeUndefined();
    expect(applyOutreachLook(fixture(IMG('port')), 'EMAIL', dims).sections[1].treatment).toBe('split');
    expect(LANDSCAPE_RATIO).toBeGreaterThan(1);
  });
  it('EMAIL: 허용표 밖 섹션(gallery·countdown)은 건드리지 않는다 · coupon spotlight · 배경면은 EMAIL_BACKGROUNDS 안', () => {
    const withCountdown = [...fixture(IMG('port')), sec('countdown', { urgency_text: 'x', end_datetime: '2099-01-01T00:00:00' }, 12)];
    const r = applyOutreachLook(withCountdown, 'EMAIL', dims);
    const byId = Object.fromEntries(r.sections.map((s) => [s.id, s]));
    expect(byId['t-5-gallery'].treatment).toBeUndefined();
    expect(byId['t-12-countdown'].treatment).toBeUndefined();
    expect(byId['t-8-coupon'].treatment).toBe('spotlight');
    expect(byId['t-1-hero'].treatment).toBe('split');
    for (const s of r.sections) {
      if (s.treatment) expect(EMAIL_TREATMENTS[s.type], `${s.type}`).toContain(s.treatment);
      if (s.background) expect(EMAIL_BACKGROUNDS).toContain(s.background);
    }
    // DM 전용 구도(ticket·mosaic·banner)는 EMAIL에서 절대 안 나온다
    expect(r.sections.some((s) => ['ticket', 'mosaic', 'banner'].includes(String(s.treatment)))).toBe(false);
  });
  it('pickTreatment — classic은 명시하지 않는다 · 허용표 밖 값·미등재 섹션 = undefined', () => {
    expect(pickTreatment('DM', 'hero', 'classic')).toBeUndefined();
    expect(pickTreatment('DM', 'hero', 'nope')).toBeUndefined();
    expect(pickTreatment('DM', 'footer', 'bar')).toBeUndefined();
    expect(pickTreatment('EMAIL', 'gallery', 'mosaic')).toBeUndefined();
    expect(pickTreatment('EMAIL', 'cta', 'bar')).toBe('bar');
  });
});

describe('렌더 HTML 지표 — 룩이 실제로 실린다(JSON이 아니라 화면으로)', () => {
  it('DM 뷰어: 룩 전 = data-treatment 0 · dm-bgx 0 → 룩 후 = 둘 다 양수', () => {
    const base = fixture(IMG('port'));
    const before = rebuildDmPages(base);
    const htmlBefore = renderDmViewerHtml({ title: 't', store_name: '브랜드', sections: before.sections, pages: before.pages, layout_mode: before.layoutMode, brand_kit: buildOutreachBrandKit(null, 'fashion') }, '/api/dm/v');
    const mBefore = countLookMarkers(htmlBefore);
    expect(mBefore.treatmentAttrs).toBe(0);
    expect(mBefore.dmBackgrounds).toBe(0);
    const looked = applyOutreachLook(base, 'DM', dims);
    const after = rebuildDmPages(looked.sections);
    const htmlAfter = renderDmViewerHtml({ title: 't', store_name: '브랜드', sections: after.sections, pages: after.pages, layout_mode: after.layoutMode, brand_kit: buildOutreachBrandKit(null, 'fashion') }, '/api/dm/v');
    const mAfter = countLookMarkers(htmlAfter);
    expect(mAfter.treatmentAttrs).toBe(looked.stats.treatments);
    expect(mAfter.dmBackgrounds).toBeGreaterThanOrEqual(looked.stats.backgrounds);
  });
  it('갤러리가 단독 페이지가 되는 배열도 scroll 발행(OUTREACH_DM_LAYOUT_MODE)이라 mosaic 구도와 갤러리 링크가 발행 HTML에 도달한다', () => {
    // slides면 뷰어가 갤러리를 한 장씩 펼치며 treatment·link_url을 버린다(적대 리뷰 high) — 아웃리치는 scroll 한 페이지
    const secs = [
      sec('header', { brand_name: 'b' }, 0), sec('hero', { headline: 'h', image_url: IMG('port') }, 1),
      sec('gallery', { layout: 'grid_2x2', images: [{ url: IMG('land'), link_url: 'https://b.com/plan' }, { url: IMG('land'), link_url: 'https://b.com/plan' }, { url: IMG('sq'), link_url: 'https://b.com/plan' }] }, 2),
      sec('text_card', { headline: 't', body: 'b' }, 3), sec('text_card', { headline: 't2', body: 'b2' }, 4), sec('cta', { buttons: [{ label: 'x', url: 'https://b.com/' }] }, 5), sec('footer', {}, 6),
    ];
    const looked = applyOutreachLook(secs, 'DM', dims);
    expect(looked.sections[2].treatment).toBe('mosaic');
    expect(OUTREACH_DM_LAYOUT_MODE).toBe('scroll');
    const pages = splitSectionsIntoPages(looked.sections, OUTREACH_DM_LAYOUT_MODE);
    expect(pages).toHaveLength(1);
    const html = renderDmViewerHtml({ title: 't', store_name: 'b', sections: looked.sections, pages, layout_mode: OUTREACH_DM_LAYOUT_MODE, brand_kit: buildOutreachBrandKit(null, 'fashion') }, '/api/dm/v');
    expect(html).toContain('data-treatment="mosaic"');
    expect((html.match(/href="https:\/\/b\.com\/plan"/g) || []).length).toBe(3);
    // 대조: 공용 판정은 slides를 고른다(갤러리 있음) — 그 경로를 아웃리치가 타지 않는다는 것이 이 테스트의 요지
    expect(decideLayoutMode(looked.sections)).toBe('slides');
  });
  it('이메일: 룩 전 = 밴드 0 → 룩 후 = 밴드 양수 + split 히어로', () => {
    const base = fixture(IMG('port'));
    const ctx = { design: { art_direction: outreachArtDirection('beauty') }, publicBase: 'https://hanjul.ai' };
    const htmlBefore = renderEmailSections(base, ctx);
    expect(countLookMarkers(htmlBefore).emailBands).toBe(0);
    const looked = applyOutreachLook(base, 'EMAIL', dims);
    const htmlAfter = renderEmailSections(looked.sections, ctx);
    expect(countLookMarkers(htmlAfter).emailBands).toBe(looked.stats.backgrounds);
    expect(htmlAfter.length).toBeGreaterThan(htmlBefore.length);
  });
});

describe('★0905(4) 전문가 느낌 — 캐러셀 구도 · 브랜드 색 보정', () => {
  it('상품 4개 이상 = classic(미설정 · 2열 카드 스와이프) · 2~3개 = focus · 첫 묶음만 soft · list_1xN 갤러리에는 mosaic을 얹지 않는다', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, price: 1000, image_url: IMG('sq'), link_url: `https://b.com/${i}` }));
    const secs = [
      sec('product_carousel', { title: 'a', products: six }, 0),
      sec('product_carousel', { title: 'b', products: six.slice(0, 2) }, 1),
      sec('gallery', { layout: 'list_1xN', images: [{ url: IMG('land') }, { url: IMG('land') }, { url: IMG('land') }] }, 2),
    ];
    const r = applyOutreachLook(secs, 'DM', dims);
    expect(r.sections[0].treatment).toBeUndefined();
    expect(r.sections[0].background).toBe('soft');
    expect(r.sections[1].treatment).toBe('focus');
    expect(r.sections[1].background).toBeUndefined();
    expect(r.sections[2].treatment).toBeUndefined();
    expect(r.sections.some((s) => s.treatment === 'list')).toBe(false);
  });
  it('accessiblePrimaryOf — 대비 4.5 미만이면 명도만 낮춰 통과시키는 첫 색(색상 유지) · 이미 통과면 그대로 · 흰색·무효는 null', () => {
    const green = accessiblePrimaryOf('#12b464'); // 이니스프리 로고 초록(흰 글자 대비 2.6)
    expect(green).toMatch(/^#[0-9a-f]{6}$/);
    expect(green).not.toBe('#12b464');
    const [r, g, b] = [parseInt(green!.slice(1, 3), 16), parseInt(green!.slice(3, 5), 16), parseInt(green!.slice(5, 7), 16)];
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(accessiblePrimaryOf('#1e3a8a')).toBe('#1e3a8a');
    expect(accessiblePrimaryOf('#ffffff')).toBeNull();
    expect(accessiblePrimaryOf('nope')).toBeNull();
    expect(accessiblePrimaryOf(null)).toBeNull();
  });
});

describe('brand_kit · 아트디렉션', () => {
  it('키 화이트리스트(primary_color·art_direction)뿐 · logo_url 0 · 대비 미달이면 색 없이 art_direction만', () => {
    const kit = buildOutreachBrandKit('#123456', 'fashion');
    expect(Object.keys(kit).sort()).toEqual([...OUTREACH_BRAND_KIT_KEYS].sort());
    expect((kit as any).logo_url).toBeUndefined();
    expect(kit.art_direction).toEqual(OUTREACH_ART_DIRECTION.fashion);
    const noColor = buildOutreachBrandKit(null, 'health');
    expect(Object.keys(noColor)).toEqual(['art_direction']);
    expect(noColor.art_direction).toEqual(OUTREACH_ART_DIRECTION.beauty);
    expect(outreachArtDirection(null)).toEqual(OUTREACH_ART_DIRECTION.commerce);
    expect(outreachArtDirection('food')).toEqual(OUTREACH_ART_DIRECTION.commerce);
  });
  it('아트디렉션 값은 DM·이메일 enum 안(typeScale·spacingDensity·accentMotif·sectionDivider)', () => {
    for (const ad of Object.values(OUTREACH_ART_DIRECTION)) {
      expect(['editorial', 'bold', 'minimal']).toContain(ad.typeScale);
      expect(['compact', 'standard', 'airy']).toContain(ad.spacingDensity);
      expect(['none', 'rule', 'index', 'bracket', 'dot']).toContain(ad.accentMotif);
      expect(['none', 'hairline', 'gap', 'rule']).toContain(ad.sectionDivider);
      expect(['sans', 'serif']).toContain(ad.headlineFont);
    }
  });
});
