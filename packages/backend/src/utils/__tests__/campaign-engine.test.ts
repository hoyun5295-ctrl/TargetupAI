/**
 * campaign-engine.test.ts — S5 조립 엔진 골든(AI 뒤 결정 구간) + 재료 입구 순수 함수 (2026-09-06 · 설계서 §7)
 *  골든 = 생성기(AI)를 고정 픽스처로 바꾼 뒤 아웃리치 실제 deps 로 조립 → sectionTypes 순서 · 룩 통계 · CTA 수 · 차단 수 스냅샷.
 *  아웃리치와 고객 입구가 같은 엔진·같은 deps 를 쓰므로 이 골든이 두 입구의 상시 회귀다.
 * DB·AI·네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { assembleDmCampaign, type EngineMaterials } from '../campaign-engine';
import { outreachEngineDeps, applyDmFeatures } from '../sales-outreach-produce';
import { quoteQuickCampaign, quickMaterialsEnabled, normalizeQuickMaterials, materialTextFromEvents } from '../campaign-quick';
import type { Section } from '../dm/dm-section-registry';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const sec = (type: string, props: Record<string, unknown>, order: number): Section => ({ id: `g-${order}-${type}`, type, order, visible: true, props } as unknown as Section);

/** 모델이 낸 것으로 치는 고정 구성(11개 · 헤드라인에 면허 없는 혜택 수치 1곳 · 카운트다운 종료일 없음 · CTA 1개) */
const GEN_FIXTURE: Section[] = [
  sec('header', {}, 0),
  sec('hero', { headline: '가을 신상 컬렉션', sub_copy: '지금 만나보세요' }, 1),
  sec('text_card', { tag: '이벤트', headline: '한가위 기획전', body: '풍성한 한가위를 준비했습니다.' }, 2),
  sec('product_carousel', { title: '추천 상품' }, 3),
  sec('cta', { buttons: [{ label: '기획전 보기', url: '' }] }, 4),
  sec('gallery', { title: '제품 사용 컷' }, 5),
  sec('text_card', { tag: '혜택', headline: '전 상품 30% 할인', body: '오늘만 쿠폰 지급' }, 6),
  sec('countdown', { end_datetime: '' }, 7),
  sec('footer', { notes: '' }, 8),
];

const MATERIALS: EngineMaterials = {
  companyName: '브랜드', industry: 'beauty', homepageUrl: 'https://brand.example/', siteTitle: '브랜드 공식몰',
  material: '한가위 기획전 안내', extraNotes: null,
  products: [
    { name: '수분 크림', price: 32000, discount_price: 25000, image_url: 'https://hanjul.ai/api/cdp/inapp/image/c/p1.jpg', link_url: 'https://brand.example/p/1', width: 800, height: 800 },
    { name: '세럼', price: 45000, discount_price: null, image_url: 'https://hanjul.ai/api/cdp/inapp/image/c/p2.jpg', link_url: 'https://brand.example/p/2', width: 800, height: 800 },
    { name: '토너', price: 21000, discount_price: 18000, image_url: 'https://hanjul.ai/api/cdp/inapp/image/c/p3.jpg', link_url: 'https://brand.example/p/3', width: 800, height: 800 },
  ],
  gallery: [
    { url: 'https://hanjul.ai/api/cdp/inapp/image/c/b1.jpg', width: 1920, height: 800 },
    { url: 'https://hanjul.ai/api/cdp/inapp/image/c/b2.jpg', width: 1920, height: 800 },
    { url: 'https://hanjul.ai/api/cdp/inapp/image/c/b3.jpg', width: 1920, height: 800 },
  ],
  logoUrl: null, posterUrl: 'https://hanjul.ai/api/cdp/inapp/image/c/poster.jpg', posterSize: { width: 1792, height: 2400 },
  bannerUrl: null, bannerSize: null,
  ctaLinks: { 기획전: 'https://brand.example/event', 쿠폰: 'https://brand.example/coupon' },
  legal: { legal: '상호 브랜드 · 대표 홍길동', csPhone: '02-000-0000' },
  licensedQuote: '', proof: { reviewTotal: 1200, rating: 4.8, rankLabel: null, collectedAt: '2026-09-06T00:00:00Z' },
};

function depsWithFixture() {
  const deps = outreachEngineDeps();
  deps.generate = async () => ({ sections: GEN_FIXTURE.map((s) => ({ ...s, props: { ...(s.props as any) } })), exemplars: { picked: 3, total: 12 } });
  return deps;
}

describe('조립 엔진 골든(아웃리치 deps + 고정 생성 픽스처)', () => {
  it('★ v3 아웃리치 골든(행사 카드 없음) — gallery 0 · 히어로=첫 배너 · 포스터는 이미지 위 text_card · 카운트다운(종료일 없음) 제거 · 면허 없는 30%는 차단 · CTA 2개 보장 · 증거 카드 삽입', async () => {
    const r = await assembleDmCampaign(MATERIALS, { entry: 'outreach', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: 'scroll' }, depsWithFixture());
    expect(r.generated).toBe(true);
    expect(r.exemplars).toEqual({ picked: 3, total: 12 });
    // 스냅샷(아웃리치 v3) — header · hero(b1) · 포스터 text_card · 모델 text_card#1 · 상품 3개 focus 묶음 · 증거 카드 · 코너 CTA(기획전) · 모델 text_card#2(30% 차단) · 대표 목적지 CTA(쿠폰) · footer
    expect(r.sectionTypes).toEqual(['header', 'hero', 'text_card', 'text_card', 'product_carousel', 'text_card', 'cta', 'text_card', 'cta', 'footer']);
    expect(r.sectionTypes).not.toContain('gallery');
    expect(r.sectionTypes.filter((t) => t === 'cta').length).toBe(2);
    expect(r.sectionTypes).not.toContain('countdown');
    const hero = r.sections.find((s) => s.type === 'hero') as any;
    expect(hero.props.image_url).toBe('https://hanjul.ai/api/cdp/inapp/image/c/b1.jpg');
    const poster = r.sections[2] as any;
    expect(poster.props.image_url).toBe('https://hanjul.ai/api/cdp/inapp/image/c/poster.jpg');
    expect(poster.props.image_position).toBe('top');
    expect(String(poster.props.headline || '').length).toBeGreaterThan(0); // 설명 없는 이미지 0
    expect(poster.treatment).toBeUndefined(); // 이미지 카드 = classic(lead·quote 는 image_url 을 안 그린다)
    const benefitCard = r.sections.filter((s) => s.type === 'text_card').map((s: any) => String(s.props.headline || ''));
    expect(benefitCard.join(' ')).not.toContain('30%');
    expect(r.benefitStripped).toBeGreaterThanOrEqual(1);
    expect(r.proofInserted).toBe(true);
    expect(r.sections.some((s) => s.id === 'so-proof-card')).toBe(true);
    expect((r.look as any).treatments + (r.look as any).backgrounds).toBeGreaterThan(0);
    expect(Array.isArray(r.pages) && r.pages.length).toBe(1);
    expect(r.heroFallback).toBe(false);
    // 모델 CTA 라벨은 목적지가 홈일 때만 살고, 코너 링크가 있으면 코드 라벨 · 두 CTA 의 URL 은 다르다
    const ctas = r.sections.filter((s) => s.type === 'cta').map((s: any) => s.props.buttons[0].url);
    expect(new Set(ctas).size).toBe(2);
  });
  it('★ v3 행사 카드 2건 — 카드1 배너(가로형)가 히어로 · 제목·기간 원문 · 카드2는 이미지 위 text_card + cta · 카운트다운은 면허 종료일 · 대표 목적지 CTA 는 코너 링크', async () => {
    const m: EngineMaterials = {
      ...MATERIALS,
      eventCards: [
        { title: '추석선물세트 특별 기획전', periodRaw: '2026.09.01 ~ 2099.12.31', endDate: '2099-12-31', bannerUrl: 'https://hanjul.ai/api/cdp/inapp/image/c/b2.jpg', bannerSize: { width: 1920, height: 800 }, detailUrl: 'https://brand.example/event/1', licensed: true },
        { title: '가을 신상 오픈 이벤트 최대 50%', periodRaw: null, endDate: null, bannerUrl: 'https://hanjul.ai/api/cdp/inapp/image/c/b3.jpg', bannerSize: { width: 1920, height: 800 }, detailUrl: 'https://brand.example/event/2', licensed: false },
      ],
    };
    const r = await assembleDmCampaign(m, { entry: 'outreach', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: 'scroll' }, depsWithFixture());
    expect(r.sectionTypes).toEqual(['header', 'hero', 'text_card', 'cta', 'text_card', 'product_carousel', 'text_card', 'text_card', 'cta', 'text_card', 'countdown', 'cta', 'footer']);
    expect(r.sectionTypes.length).toBeLessThanOrEqual(13);
    const hero = r.sections[1] as any;
    expect(hero.props.image_url).toBe('https://hanjul.ai/api/cdp/inapp/image/c/b2.jpg');
    expect(hero.props.headline).toBe('추석선물세트 특별 기획전');
    expect(hero.props.sub_copy).toBe('기간 2026.09.01 ~ 2099.12.31');
    expect(r.heroFallback).toBe(false);
    const cta1 = r.sections[3] as any;
    expect(cta1.props.buttons[0]).toMatchObject({ url: 'https://brand.example/event/1', label: '추석선물세트 특별 기획전 보기' });
    // 카드2 — 면허 없는 "최대 50%" 는 코드가 먼저 걷어낸 제목(차단기가 prop 째 비우지 않는다) · 이미지 위 · 기간 없음
    const card2 = r.sections[7] as any;
    expect(card2.props.image_url).toBe('https://hanjul.ai/api/cdp/inapp/image/c/b3.jpg');
    expect(card2.props.headline).toBe('가을 신상 오픈 이벤트');
    expect(card2.props.body).toBe('');
    expect((r.sections[8] as any).props.buttons[0].url).toBe('https://brand.example/event/2');
    const cd = r.sections.find((s) => s.type === 'countdown') as any;
    expect(cd.props.end_datetime).toBe('2099-12-31T23:59:59');
    const last = r.sections[11] as any;
    expect(last.props.buttons[0].url).toBe('https://brand.example/event'); // 3번째 카드 없음 → 코너(기획전)
    expect(r.sectionTypes).not.toContain('gallery');
    expect(r.proofInserted).toBe(true);
  });
  it('면허 인용이 있으면 그 수치는 남는다 · preset 재발행은 생성·채우기를 건너뛴다', async () => {
    const licensed = await assembleDmCampaign({ ...MATERIALS, licensedQuote: '전 상품 30% 할인 · 2026.09.01 ~ 2026.12.31' }, { entry: 'outreach', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: 'scroll' }, depsWithFixture());
    expect(licensed.sections.some((s: any) => String(s.props?.headline || '').includes('30%'))).toBe(true);
    const deps = depsWithFixture();
    deps.generate = async () => { throw new Error('preset 재발행은 생성기를 부르지 않는다'); };
    const preset = await assembleDmCampaign(MATERIALS, { entry: 'outreach', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: licensed.sectionsBase, layoutMode: 'scroll' }, deps);
    expect(preset.generated).toBe(false);
    expect(preset.sectionTypes).toEqual(licensed.sectionTypes);
  });
  it('고객 입구(entry customer) = 현행 채우기 그대로(바이트 동일 계약) · 업로드 이미지 3장 → 히어로 1 + 갤러리 2장 · 상품 카드 0(이미지 없는 상품은 카드 금지)', async () => {
    const m: EngineMaterials = {
      ...MATERIALS, products: [], posterUrl: null, posterSize: null, ctaLinks: {}, homepageUrl: 'https://shop.example/', legal: null, proof: null,
      gallery: [
        { url: '/api/dm/v/images/c/u1.jpg', width: 1080, height: 1350 }, { url: '/api/dm/v/images/c/u2.jpg', width: 1080, height: 1080 }, { url: '/api/dm/v/images/c/u3.jpg', width: 1080, height: 1080 },
      ],
      licensedQuote: '전 상품 30% 할인',
    };
    const r = await assembleDmCampaign(m, { entry: 'customer', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: 'scroll' }, depsWithFixture());
    expect(r.sectionTypes).not.toContain('product_carousel');
    const hero = r.sections.find((s) => s.type === 'hero') as any;
    expect(hero.props.image_url).toBe('/api/dm/v/images/c/u1.jpg');
    const gallery = r.sections.find((s) => s.type === 'gallery') as any;
    expect((gallery.props.images || []).map((x: any) => x.url)).toEqual(['/api/dm/v/images/c/u2.jpg', '/api/dm/v/images/c/u3.jpg']);
    expect(r.sections.some((s: any) => String(s.props?.headline || '').includes('30%'))).toBe(true);
  });
});

describe('재료 입구 순수 함수', () => {
  it('견적 — 텍스트 있으면 생성만 · 텍스트 비고 이미지 있으면 판독 + 생성 · 신규 키 0', () => {
    const a = quoteQuickCampaign({ imageCount: 3, hasText: true });
    expect(a.parts.map((p) => p.key)).toEqual(['dm-ai-generate']);
    const b = quoteQuickCampaign({ imageCount: 2, hasText: false });
    expect(b.parts.map((p) => p.key)).toEqual(['event-image-extract', 'dm-ai-generate']);
    expect(b.total).toBe(b.parts[0].cost + b.parts[1].cost);
    expect(quoteQuickCampaign({ imageCount: 0, hasText: false }).parts.map((p) => p.key)).toEqual(['dm-ai-generate']);
  });
  it('ENV 회사 목록 — 비면 전 회사 · 있으면 목록 회사만', () => {
    expect(quickMaterialsEnabled('c1', '')).toBe(true);
    expect(quickMaterialsEnabled('c1', undefined)).toBe(true);
    expect(quickMaterialsEnabled('c1', 'c1, c2')).toBe(true);
    expect(quickMaterialsEnabled('c3', 'c1,c2')).toBe(false);
    expect(quickMaterialsEnabled(null, 'c1')).toBe(false);
  });
  it('재료 정규화 — 이 회사 서빙 경로만 · 외부·타 회사 URL 거부 · origin 은 서버 판정(비면 empty · extracted 면 vision · 그 외 user) · 링크 http(s)만', () => {
    const m = normalizeQuickMaterials({
      images: [{ url: '/api/dm/v/images/c1/a.jpg', width: 100, height: 200 }, { url: '/api/dm/v/images/c2/b.jpg' }, { url: 'https://evil.example/x.jpg' }, { url: '/api/dm/v/images/c1/../x' }],
      event_text: '  추석 기획전 30% 할인  ', link: 'javascript:alert(1)', brand_name: '브랜드',
    }, 'c1');
    expect(m.images).toEqual([{ url: '/api/dm/v/images/c1/a.jpg', width: 100, height: 200 }]);
    expect(m.event_text).toBe('추석 기획전 30% 할인');
    expect(m.origin).toBe('user'); expect(m.link).toBeNull(); expect(m.brand_name).toBe('브랜드');
    expect(normalizeQuickMaterials({ event_text: 'x', extracted: true }, 'c1').origin).toBe('vision');
    expect(normalizeQuickMaterials({ event_text: '' }, 'c1').origin).toBe('empty');
    expect(normalizeQuickMaterials({ link: 'https://shop.example/event' }, 'c1').link).toBe('https://shop.example/event');
  });
  it('판독 구조 → 재료 글줄(상품은 카드가 아니라 줄 · 중복 제거)', () => {
    const t = materialTextFromEvents([{ brand: 'B', title: '추석 기획전', subtitle: '한가위', benefit: '전 상품 30%', products: [{ name: '수분 크림', price: 32000, sale_price: 25000, discount_rate: 22 }] }], '추석 기획전 · 한가위');
    expect(t).toContain('추석 기획전 · 한가위');
    expect(t).toContain('혜택: 전 상품 30%');
    expect(t).toContain('- 수분 크림 25,000원 (정가 32,000원)');
    expect(t.split('\n').filter((l) => l === '추석 기획전 · 한가위').length).toBe(1);
  });
});

/**
 * ★ 2026-09-14 T2 기능 칩 후처리(EngineOptions.features · EngineDeps.applyFeatures) — 설계서 docs/2026-09-14-ai-auto-build-design.md §6-2 · 계약 6.
 *  고객 입구(행사 카드)에서 채우기가 데이터로 만드는 것(캐러셀·갤러리·카운트다운)은 그대로 두고, 후처리는 OFF 제거 · ON 쿠폰 삽입(면허 문구) · 재료 없는 ON 은 사유만.
 */
describe('★ T2 기능 칩 후처리 — features 없음/null = 현행 · OFF 제거 · ON 쿠폰 삽입 · 재료 없으면 skipped', () => {
  const CARD_MATERIALS: EngineMaterials = {
    ...MATERIALS, proof: null, posterUrl: null, posterSize: null, legal: null, ctaLinks: {}, homepageUrl: 'https://shop.example/',
    products: [
      { name: '수분 크림', price: 32000, discount_price: 25000, image_url: 'https://mall.example/p1.jpg', link_url: 'https://mall.example/p/1', width: 800, height: 800 },
      { name: '세럼', price: 45000, discount_price: null, image_url: 'https://mall.example/p2.jpg', link_url: 'https://mall.example/p/2', width: 800, height: 800 },
    ],
    gallery: [
      { url: '/api/dm/v/images/c/h.jpg', width: 1600, height: 1200, group: 'c1' },
      { url: '/api/dm/v/images/c/g1.jpg', width: 1080, height: 1080, group: 'c1' },
      { url: '/api/dm/v/images/c/g2.jpg', width: 1080, height: 1080, group: 'c1' },
    ],
    licensedQuote: '가을 세일 · 10/1~10/15 전 품목 30% 할인 · 사은품 증정',
    eventCards: [{ title: '가을 세일', periodRaw: null, endDate: null, bannerUrl: '/api/dm/v/images/c/h.jpg', bannerSize: { width: 1600, height: 1200 }, detailUrl: 'https://shop.example/event', licensed: true, group: 'c1', text: '10/1~10/15 전 품목 30% 할인 · 사은품 증정' }],
  };
  const OPTS = { entry: 'customer' as const, channel: 'DM' as const, skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: 'scroll' };

  it('features 없음 · null = 현행 출력과 sections 동등 · features 결과는 빈 값 · 기준선은 채우기가 캐러셀·갤러리를 만든 상태', async () => {
    const a = await assembleDmCampaign(CARD_MATERIALS, OPTS, depsWithFixture());
    const b = await assembleDmCampaign(CARD_MATERIALS, { ...OPTS, features: null }, depsWithFixture());
    expect(b.sections).toEqual(a.sections);
    expect(a.features).toEqual({ applied: [], removed: [], skipped: [] });
    expect(a.sectionTypes).toContain('product_carousel');
    expect(a.sectionTypes).toContain('gallery');
    expect(a.sectionTypes).not.toContain('coupon');
    expect(a.sectionTypes).not.toContain('countdown');
  });
  it('OFF(features: []) = 4종 전부 제거 · removed 에는 실제 있던 타입만 · skipped 0', async () => {
    const r = await assembleDmCampaign(CARD_MATERIALS, { ...OPTS, features: [] }, depsWithFixture());
    for (const t of ['product_carousel', 'gallery', 'countdown', 'coupon']) expect(r.sectionTypes).not.toContain(t);
    expect([...r.features.removed].sort()).toEqual(['gallery', 'product_carousel']);
    expect(r.features.skipped).toEqual([]);
    expect(r.features.applied).toEqual([]);
  });
  it('ON 쿠폰 = 모델이 안 냈어도 면허 문구로 1개 삽입(카피 생성 0) · 마지막 CTA 앞 · 차단기를 지나도 문구 유지', async () => {
    const r = await assembleDmCampaign(CARD_MATERIALS, { ...OPTS, features: ['product_carousel', 'gallery', 'coupon'] }, depsWithFixture());
    const idx = r.sectionTypes.indexOf('coupon');
    expect(idx).toBeGreaterThan(0);
    expect(r.sectionTypes.lastIndexOf('coupon')).toBe(idx);
    expect(idx).toBeLessThan(r.sectionTypes.lastIndexOf('cta'));
    expect((r.sections[idx] as any).props.discount_label).toBe('10/1~10/15 전 품목 30% 할인');
    expect([...r.features.applied].sort()).toEqual(['coupon', 'gallery', 'product_carousel']);
    expect(r.features.removed).toEqual([]);
    expect(r.sectionTypes).not.toContain('countdown');
  });
  it('ON 인데 재료가 없으면 삽입하지 않고 사유만 · 목록 밖 타입은 OFF', async () => {
    const m: EngineMaterials = { ...CARD_MATERIALS, products: [], licensedQuote: '', eventCards: [{ ...CARD_MATERIALS.eventCards![0], licensed: false }] };
    const r = await assembleDmCampaign(m, { ...OPTS, features: ['countdown', 'product_carousel', 'coupon'] }, depsWithFixture());
    for (const t of ['countdown', 'coupon', 'product_carousel', 'gallery']) expect(r.sectionTypes).not.toContain(t);
    expect(r.features.skipped.map((s) => s.type).sort()).toEqual(['countdown', 'coupon', 'product_carousel']);
    expect(r.features.skipped.every((s) => s.reason.trim().length > 0)).toBe(true);
    expect(r.features.removed).toEqual(['gallery']);
  });
  it('허용 밖 타입은 무시(header 는 지워지지 않는다) · preset 재발행은 features 를 적용하지 않는다', async () => {
    const r = await assembleDmCampaign(CARD_MATERIALS, { ...OPTS, features: ['header', 'roulette', 'gallery'] }, depsWithFixture());
    expect(r.sectionTypes[0]).toBe('header');
    expect(r.sectionTypes).toContain('gallery');
    expect(r.sectionTypes).not.toContain('product_carousel');
    const deps = depsWithFixture();
    deps.generate = async () => { throw new Error('preset 재발행은 생성기를 부르지 않는다'); };
    const preset = await assembleDmCampaign(CARD_MATERIALS, { ...OPTS, features: [], presetSections: r.sectionsBase }, deps);
    expect(preset.sectionTypes).toEqual(r.sectionTypes);
    expect(preset.features).toEqual({ applied: [], removed: [], skipped: [] });
  });
  it('소스 계약 — 순서 채우기 → features → 차단 · 구현은 produce 의 applyDmFeatures 를 deps 로 넘긴다', () => {
    const engine = code('utils/campaign-engine.ts');
    expect(engine).toContain('deps.applyFeatures(filledR.sections, opts.features ?? null, m)');
    expect(engine.indexOf('deps.applyFeatures(')).toBeLessThan(engine.indexOf('deps.sanitize('));
    const produce = code('utils/sales-outreach-produce.ts');
    expect(produce).toContain('applyFeatures: (sections, features, m) => applyDmFeatures(sections, features, m)');
  });
});

describe('★ T3 이메일 칩 후처리 — applyDmFeatures EMAIL 채널 · 이메일 생성 경로 배선(소스 계약)', () => {
  it('EMAIL 에서 ON 카운트다운 = 넣지 않고 사유(이메일 미지원) · OFF 제거는 그대로', () => {
    const sections: Section[] = [sec('header', {}, 0), sec('hero', { headline: 'A' }, 1), sec('product_carousel', { products: [{ name: '수분 크림' }] }, 2), sec('cta', { buttons: [] }, 3), sec('footer', {}, 4)];
    const r = applyDmFeatures(sections, ['countdown'], { licensedQuote: '' }, 'EMAIL');
    expect(r.sections.map((s) => String(s.type))).toEqual(['header', 'hero', 'cta', 'footer']);
    expect(r.removed).toEqual(['product_carousel']);
    expect(r.skipped).toEqual([{ type: 'countdown', reason: expect.stringContaining('이메일') }]);
    // DM 은 종료일 사유(현행)
    expect(applyDmFeatures(sections, ['countdown'], { licensedQuote: '' }).skipped[0].reason).not.toContain('이메일');
  });
  it('소스 계약 — 이메일 생성 경로도 채우기 → features → 차단 · 결과에 features 를 싣는다', () => {
    const produce = code('utils/sales-outreach-produce.ts');
    expect(produce).toContain("applyDmFeatures(filled.sections, input.features ?? null, { licensedQuote: input.licensedQuote }, 'EMAIL')");
    expect(produce.indexOf('applyDmFeatures(filled.sections')).toBeLessThan(produce.indexOf('sanitizeDmCopyBenefits(featured.sections'));
    expect(produce).toContain('features: { applied: featured.applied, removed: featured.removed, skipped: featured.skipped }');
  });
});

describe('소스 계약 — 엔진 격리 · 라우트 분기', () => {
  it('엔진 파일은 sales-outreach-* 를 import 하지 않는다 · DB·AI·네트워크 0', () => {
    const engine = code('utils/campaign-engine.ts');
    expect(engine).not.toMatch(/sales-outreach-/);
    expect(engine).not.toMatch(/config\/database|await query\(|callAIWithFallback|https?\.request\(|[^a-zA-Z.]fetch\(/);
    expect(engine).toContain('export async function assembleDmCampaign');
  });
  it('one-shot-generate materials 분기 — 몰 상품 자동 첨부 0 · structure 문자열 0 · 402 분기 · 노출 스위치', () => {
    const route = code('routes/dm.ts');
    const start = route.indexOf("if (req.body?.materials && typeof req.body.materials === 'object') {");
    expect(start).toBeGreaterThan(-1);
    const block = route.slice(start, route.indexOf("if (!prompt && !scenario && !eventText) {", start));
    expect(block).toContain('generateDmFromMaterials(');
    expect(block).toContain('quickMaterialsEnabled(companyId)');
    expect(block).not.toContain('attachMallImagesToProductCarousels');
    expect(block).not.toContain('structure:');
    expect(block).toContain("code: 'INSUFFICIENT_CREDIT'");
    expect(block).toContain('draft_id: r.draftId');
  });
  it('재료 입구 라우트 — 요금제 게이트는 dm 라우터 것과 같은 함수 · 텍스트 비었을 때만 판독 · 견적에 plan_locked·enabled', () => {
    const ec = code('routes/event-campaigns.ts');
    expect(ec).toContain("eventCampaignRouter.post('/materials', requirePlanFeature('mobile_dm')");
    // ★ v3 read=0(업로드 전용)이면 판독하지 않는다 · 기본 1 = 현행
    expect(ec).toContain('if (wantRead && !eventText && files.length) {');
    expect(ec).toContain("const wantRead = String(req.body?.read ?? '1') !== '0';");
    expect(ec).toContain("eventCampaignRouter.get('/materials/quote'");
    expect(ec).toContain('plan_locked: await quickPlanLocked(companyId)');
    expect(ec).toContain('enabled: quickMaterialsEnabled(companyId)');
    const quick = code('utils/campaign-quick.ts');
    // 크레딧 = 기존 키 · 멱등 quick:{draftId} · 초안 행 뒤 차감 · 신규 키 0
    expect(quick).toContain("idempotencyKey: `quick:${draftId}`");
    expect(quick.indexOf('await createDm(')).toBeLessThan(quick.indexOf('await deductCreditSafe('));
    expect(quick).toContain("licensedQuote: m.origin === 'user' ? m.event_text : ''");
    expect(quick).toContain("approval_status: 'draft'");
    // ★ 2026-09-15 예외 1개 = 카탈로그 DM 채널 생성 키 'catalog-dm-build'(Harold 확정 10 · FEATURE-AI-AUTO-BUILD §2-8 예외). 그 밖 신규 키는 여전히 0.
    expect(quick).not.toMatch(/getCreditCost\('(?!dm-ai-generate'|event-image-extract'|email-ai-generate'|catalog-dm-build')/);
    expect(quick).toContain("getCreditCost('catalog-dm-build')");
  });
  it('★ S6 이메일 합류 — 같은 재료 · 브랜드 이메일 시안 함수 재사용 · 재료 없으면 기존 경로(분기 뒤에 옛 검사가 그대로) · 402 · 몰 첨부 0', () => {
    const quick = code('utils/campaign-quick.ts');
    expect(quick).toContain('export async function generateEmailFromMaterials(');
    expect(quick).toContain('await produceOutreachBrandEmail({');
    expect(quick).toContain("getCreditCost('email-ai-generate')");
    const email = code('routes/email.ts');
    const start = email.indexOf("if (req.body?.materials && typeof req.body.materials === 'object') {");
    expect(start).toBeGreaterThan(-1);
    const end = email.indexOf("if (!prompt && !scenario && !eventText) {", start);
    expect(end).toBeGreaterThan(start);
    const block = email.slice(start, end);
    expect(block).toContain('generateEmailFromMaterials(');
    expect(block).toContain("code: 'INSUFFICIENT_CREDIT'");
    expect(block).not.toContain('attachMallImagesToProductCarousels');
    expect(block).not.toContain('structure:');
    // 무후퇴 — 옛 경로 문자열이 그대로 남아 있다
    expect(email).toContain('const result = await generateEmailSections({ companyId: auth.companyId, userId: auth.userId, prompt, scenario, isAd, eventText });');
  });
});
