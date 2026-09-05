/**
 * sales-outreach-review.test.ts — 검수 축 순수 CT(재료 재선택 · 섹션 숨김 override · 품질 경고) 행동 테스트 (2026-09-05(3) · 설계서 §22 C4)
 */
import { describe, it, expect } from 'vitest';
import {
  validateOutreachMediaSelection, applyOutreachMediaSelection, sectionKeysOf, validateSectionOverride, applySectionOverrides,
  assessOutreachQuality, OUTREACH_QUALITY_THRESHOLDS, SECTION_OVERRIDE_PROTECTED, MEDIA_SELECTION_MAX,
} from '../sales-outreach-review';
import type { Section } from '../dm/dm-section-registry';

const sec = (type: string, props: any, order: number): Section => ({ id: `t-${order}-${type}`, type, order, visible: true, props } as unknown as Section);
const media = {
  gallery: [{ url: 'https://hanjul.ai/g1.jpg', width: 1200, height: 800 }, { url: 'https://hanjul.ai/g2.jpg', width: 800, height: 800 }],
  products: [{ name: 'A', image_url: 'https://hanjul.ai/p1.jpg', link_url: 'https://b.com/1' }, { name: 'B', image_url: 'https://hanjul.ai/p2.jpg', link_url: 'https://b.com/2' }],
  stats: { galleryCandidates: 4, galleryPassed: 2, productLinks: 2, productsFound: 2, productsPassed: 2 },
};

describe('재료 재선택 — 화이트리스트 · 순서 · 무효 선택', () => {
  it('통과분 URL만 · 중복 제거 · 순서 보존 · 둘 다 비면 EMPTY · 목록 밖은 UNKNOWN_ITEM · 형식 오류 INVALID · 재료 없음 NO_MEDIA', () => {
    const ok = validateOutreachMediaSelection(media, { products: ['https://hanjul.ai/p2.jpg', 'https://hanjul.ai/p2.jpg'], gallery: ['https://hanjul.ai/g2.jpg', 'https://hanjul.ai/g1.jpg'] });
    expect(ok).toEqual({ ok: true, selection: { products: ['https://hanjul.ai/p2.jpg'], gallery: ['https://hanjul.ai/g2.jpg', 'https://hanjul.ai/g1.jpg'] } });
    expect(validateOutreachMediaSelection(media, { products: [], gallery: [] })).toEqual({ ok: false, reason: 'EMPTY' });
    expect(validateOutreachMediaSelection(media, { products: ['https://evil.com/x.jpg'] })).toEqual({ ok: false, reason: 'UNKNOWN_ITEM' });
    expect(validateOutreachMediaSelection(media, { products: 'x' })).toEqual({ ok: false, reason: 'INVALID' });
    expect(validateOutreachMediaSelection(media, { products: [''] })).toEqual({ ok: false, reason: 'INVALID' });
    expect(validateOutreachMediaSelection(media, { gallery: Array.from({ length: MEDIA_SELECTION_MAX + 1 }, (_, i) => `u${i}`) })).toEqual({ ok: false, reason: 'INVALID' });
    expect(validateOutreachMediaSelection(null, { products: [] })).toEqual({ ok: false, reason: 'NO_MEDIA' });
    expect(validateOutreachMediaSelection(media, null)).toEqual({ ok: false, reason: 'INVALID' });
  });
  it('적용: 선택 순서대로 · 재수집으로 사라진 URL은 건너뛴다 · 선택 없음 = 그대로 · 재료 없음 = null', () => {
    const r = applyOutreachMediaSelection(media, { products: ['https://hanjul.ai/p2.jpg'], gallery: ['https://hanjul.ai/g2.jpg', 'https://hanjul.ai/gone.jpg'] });
    expect(r!.products.map((p) => p.name)).toEqual(['B']);
    expect(r!.gallery.map((g) => g.url)).toEqual(['https://hanjul.ai/g2.jpg']);
    expect(r!.stats).toEqual(media.stats);
    expect(applyOutreachMediaSelection(media, null)).toBe(media);
    expect(applyOutreachMediaSelection(null, { products: [], gallery: [] })).toBeNull();
    // 원본 무변경
    expect(media.products).toHaveLength(2);
  });
});

describe('섹션 숨김 override — type#n 키 · 보호 골격 · 최소 잔존 · 재적용', () => {
  const sections = [
    sec('header', {}, 0), sec('hero', { headline: 'h' }, 1), sec('gallery', { images: [] }, 2), sec('text_card', { body: 'a' }, 3),
    sec('gallery', { images: [] }, 4), sec('cta', { buttons: [] }, 5), sec('footer', {}, 6),
  ];
  it('키는 같은 type 안 1-based 순번', () => {
    expect(sectionKeysOf(sections)).toEqual(['header#1', 'hero#1', 'gallery#1', 'text_card#1', 'gallery#2', 'cta#1', 'footer#1']);
  });
  it('검증: 현재 키만 · header/footer 금지 · 3개 미만 잔존 금지 · 형식', () => {
    expect(validateSectionOverride({ hidden: ['gallery#2', 'gallery#2'] }, sections)).toEqual({ ok: true, override: { hidden: ['gallery#2'] } });
    expect(validateSectionOverride({ hidden: ['gallery#9'] }, sections)).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    expect(validateSectionOverride({ hidden: ['header#1'] }, sections)).toEqual({ ok: false, reason: 'PROTECTED' });
    expect(validateSectionOverride({ hidden: ['hero#1', 'gallery#1', 'text_card#1', 'gallery#2', 'cta#1'] }, sections)).toEqual({ ok: false, reason: 'TOO_FEW_REMAIN' });
    expect(validateSectionOverride({ hidden: ['gallery 2'] }, sections)).toEqual({ ok: false, reason: 'INVALID' });
    expect(validateSectionOverride({ hidden: 'x' }, sections)).toEqual({ ok: false, reason: 'INVALID' });
    expect(validateSectionOverride({}, sections)).toEqual({ ok: true, override: { hidden: [] } });
    expect(SECTION_OVERRIDE_PROTECTED).toEqual(['header', 'footer']);
  });
  it('적용: 순번으로 지운다 · 보호 골격은 키가 있어도 안 지운다 · 없는 순번은 missed · 재생성으로 배열이 바뀌면 같은 순번에 다시 적용', () => {
    const r = applySectionOverrides(sections, { hidden: ['gallery#2', 'text_card#1', 'footer#1', 'coupon#1'] });
    expect(r.sections.map((s) => s.id)).toEqual(['t-0-header', 't-1-hero', 't-2-gallery', 't-5-cta', 't-6-footer']);
    expect(r.applied).toBe(2);
    expect(r.missed).toEqual(['coupon#1']);
    // 재생성본(갤러리 1개뿐) — gallery#2가 없어 missed · 나머지 그대로
    const regenerated = [sec('header', {}, 0), sec('hero', {}, 1), sec('gallery', { images: [] }, 2), sec('cta', {}, 3), sec('footer', {}, 4)];
    const r2 = applySectionOverrides(regenerated, { hidden: ['gallery#2'] });
    expect(r2.sections).toHaveLength(5);
    expect(r2.missed).toEqual(['gallery#2']);
    expect(applySectionOverrides(sections, null).sections).toHaveLength(7);
  });
  it('재적용 바닥: 재생성으로 배열이 줄어 3개 미만이 되거나 cta가 사라지면 전부 건너뛴다(skipped) · 상한은 루프 전에 막는다', () => {
    const short = [sec('header', {}, 0), sec('hero', {}, 1), sec('cta', {}, 2), sec('footer', {}, 3)];
    const r = applySectionOverrides(short, { hidden: ['hero#1', 'cta#1'] });
    expect(r.skipped).toBe(true);
    expect(r.sections).toHaveLength(4);
    expect(r.applied).toBe(0);
    expect(r.missed).toEqual(['hero#1', 'cta#1']);
    const noCta = applySectionOverrides([sec('header', {}, 0), sec('hero', {}, 1), sec('text_card', {}, 2), sec('cta', {}, 3), sec('footer', {}, 4)], { hidden: ['cta#1'] });
    expect(noCta.skipped).toBe(true);
    const ok = applySectionOverrides([sec('header', {}, 0), sec('hero', {}, 1), sec('text_card', {}, 2), sec('cta', {}, 3), sec('footer', {}, 4)], { hidden: ['text_card#1'] });
    expect(ok.skipped).toBeUndefined();
    expect(ok.sections).toHaveLength(4);
    const huge = { hidden: Array.from({ length: 100_000 }, (_, i) => `a#${i % 999}`) };
    const t0 = Date.now();
    expect(validateSectionOverride(huge, sections)).toEqual({ ok: false, reason: 'INVALID' });
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('품질 경고 — 세면 보이는 것 · 잠금 아님', () => {
  const dm = [
    sec('header', {}, 0), sec('hero', {}, 1), sec('text_card', {}, 2),
    sec('cta', { buttons: [{ label: 'a', url: 'https://b.com/' }, { label: 'b', url: 'https://b.com' }] }, 3), sec('footer', {}, 4),
  ];
  it('상품 0 · 갤러리 부족 · CTA 전부 홈 · 법정 표기 없음 · 섹션 부족 · 시안 없음 · 룩 0', () => {
    const r = assessOutreachQuality({ dmSections: dm, brandSections: [], media: { gallery: [], products: [] }, legal: null, homepageUrl: 'https://b.com/', lookAssigned: 0 });
    expect(r.warnings.map((w) => w.code)).toEqual(['NO_PRODUCTS', 'FEW_GALLERY', 'CTA_ALL_HOME', 'FEW_SECTIONS', 'NO_LOOK', 'NO_LEGAL', 'NO_BRAND_EMAIL']);
  });
  it('재료가 충분하고 딥링크가 하나라도 있으면 경고 0 · 옛 asset(look 없음)은 NO_LOOK을 내지 않는다 · FEW_PRODUCTS 값', () => {
    const good = [...dm.slice(0, 3), sec('gallery', {}, 5), sec('product_carousel', {}, 6), sec('cta', { buttons: [{ label: 'a', url: 'https://b.com/event' }] }, 7), sec('footer', {}, 8)];
    const products = Array.from({ length: OUTREACH_QUALITY_THRESHOLDS.products }, (_, i) => ({ image_url: `https://hanjul.ai/p${i}.jpg` }));
    const r = assessOutreachQuality({ dmSections: good, brandSections: [sec('hero', {}, 0)], media: { gallery: media.gallery, products }, legal: { legal: '사업자 1', csPhone: null }, homepageUrl: 'https://b.com/' });
    expect(r.warnings).toEqual([]);
    const few = assessOutreachQuality({ dmSections: good, brandSections: null, media: { gallery: media.gallery, products: products.slice(0, 2) }, legal: { legal: null, csPhone: '1588' }, homepageUrl: 'https://b.com/' });
    expect(few.warnings).toEqual([{ code: 'FEW_PRODUCTS', value: 2 }]);
    // 산출물 전(DM 없음)에는 DM 기준 경고를 내지 않는다
    const none = assessOutreachQuality({ dmSections: null, brandSections: null, media: null, legal: null, homepageUrl: 'https://b.com/' });
    expect(none.warnings.map((w) => w.code)).toEqual(['NO_PRODUCTS', 'FEW_GALLERY', 'NO_LEGAL']);
  });
});
