import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { catalogPagesOf } from '../dm/dm-catalog-pages';
import { isCatalogDm } from '../dm/dm-viewer-catalog';
import {
  planOutreachCatalog, catalogCaptionOf, catalogTintOf, renderCatalogCardBuffer,
  OUTREACH_CATALOG_PRODUCTS_MAX, OUTREACH_CATALOG_SLICES_MAX, OUTREACH_CATALOG_MIN_PAGES, OUTREACH_CATALOG_CARD,
} from '../sales-outreach-catalog';
import { buildProposalEmailSections, buildOutreachPlainText, assembleProposalEmail, type ProposalEmailInput } from '../sales-outreach-produce';
import { getActiveStyleGuide } from '../sales-outreach-style';

/**
 * ★ 2026-09-15 아웃리치 카탈로그 DM(Harold "AI 영업에 카탈로그 적용") — AI 호출 0 · 크레딧 0 · DDL 0.
 *   크롤 사본(포스터 · 상품 · 행사 슬라이스)으로 장마다 이미지 1장인 slides DM 을 하나 더 발행하고(settings.catalog) 제안 메일 3번째 버튼으로 잇는다.
 */
const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const media = (over: Record<string, unknown> = {}) => ({
  gallery: [], logo: null, collectedAt: 'x', stats: {} as any,
  products: [
    { name: '얼티뮨 세럼', price: 120000, discount_price: null, image_url: 'https://hanjul.ai/api/cdp/inapp/image/c/p1.jpg', link_url: 'https://b.com/p/1', width: 800, height: 800, srcImageUrl: 'https://b.com/i1.jpg' },
    { name: '화이트 루센트', price: null, discount_price: null, image_url: 'https://hanjul.ai/api/cdp/inapp/image/c/p2.jpg', link_url: 'https://b.com/p/2', width: 800, height: 800, srcImageUrl: 'https://b.com/i2.jpg' },
  ],
  slices: [
    { url: 'https://hanjul.ai/api/cdp/inapp/image/c/s1.jpg', width: 960, height: 1400, bytes: 1, srcUrl: 'https://b.com/s1.jpg' },
    { url: 'https://hanjul.ai/api/cdp/inapp/image/c/s2.jpg', width: 960, height: 1400, bytes: 1, srcUrl: 'https://b.com/s2.jpg' },
  ],
  ...over,
}) as any;
const planInput = (over: Record<string, unknown> = {}) => ({
  posterUrl: 'https://hanjul.ai/api/cdp/inapp/image/c/poster.jpg',
  media: media(),
  eventCards: [{ title: '가을 기획전', periodRaw: null, endDate: null, bannerUrl: null, detailUrl: 'https://b.com/event/1', licensed: true }],
  eventSlices: { detailUrl: 'https://b.com/event/1', finalUrl: 'https://b.com/event/1', images: [], candidates: 0, at: 'x' },
  ctaLinks: { '기획전': 'https://b.com/plan' },
  homepageUrl: 'https://b.com/',
  ...over,
});

describe('catalogPagesOf (CT · AI 자동제작 카탈로그와 공용)', () => {
  it('장마다 gallery list_1xN 1장 · id 접두 · link_url 은 있을 때만 · 카탈로그 뷰어 자격 통과', () => {
    const pages = catalogPagesOf([{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg', link_url: 'https://b.com/p/2' }, { url: 'https://x/3.jpg', link_url: null }]);
    expect(pages.map((p) => p.id)).toEqual(['catalog-p1', 'catalog-p2', 'catalog-p3']);
    expect(pages[0].sections).toEqual([{ id: 'catalog-p1-img', type: 'gallery', order: 0, visible: true, props: { images: [{ url: 'https://x/1.jpg' }], layout: 'list_1xN', full_bleed: true } }]);
    expect(pages[1].sections[0].props.images[0]).toEqual({ url: 'https://x/2.jpg', link_url: 'https://b.com/p/2' });
    expect(pages[2].sections[0].props.images[0]).toEqual({ url: 'https://x/3.jpg' });
    expect(isCatalogDm(pages)).toBe(true);
    expect(catalogPagesOf([{ url: 'https://x/1.jpg' }], 'so-cat')[0].id).toBe('so-cat-p1');
    expect(catalogPagesOf([{ url: 'https://x/1.jpg' }], 'so-cat')[0].sections[0].id).toBe('so-cat-p1-img');
  });
  it('AI 자동제작 buildCatalogDm 이 이 CT 를 쓴다(인라인 조립 0)', () => {
    const quick = SRC('campaign-quick.ts');
    expect(quick).toContain("from './dm/dm-catalog-pages'");
    expect(quick).toContain('catalogPagesOf(');
    expect(quick).not.toContain("id: `catalog-p${i + 1}`");
  });
});

describe('catalogCaptionOf · catalogTintOf (순수)', () => {
  it('상품명은 포스터 문구 게이트와 같다(2자 이상 · 숫자 0 · 혜택어 0 · 30자 이내) · 괄호·대괄호 안은 뗀다', () => {
    expect(catalogCaptionOf('얼티뮨 파워라이징 컨센트레이트')).toBe('얼티뮨 파워라이징 컨센트레이트');
    expect(catalogCaptionOf('[기획] 얼티뮨 세럼 (50ml)')).toBe('얼티뮨 세럼');
    expect(catalogCaptionOf('세럼 50ml')).toBeNull();
    expect(catalogCaptionOf('1+1 특가 세럼')).toBeNull();
    expect(catalogCaptionOf('a')).toBeNull();
    expect(catalogCaptionOf('')).toBeNull();
    expect(catalogCaptionOf(null)).toBeNull();
    expect(catalogCaptionOf('가'.repeat(31))).toBeNull();
  });
  it('틴트 = 흰 바탕에 브랜드색 8% · 색이 없거나 형식이 아니면 흰색', () => {
    expect(catalogTintOf(null)).toEqual({ r: 255, g: 255, b: 255 });
    expect(catalogTintOf('blue')).toEqual({ r: 255, g: 255, b: 255 });
    expect(catalogTintOf('#4f46e5')).toEqual({ r: 241, g: 240, b: 253 });
    expect(catalogTintOf('4F46E5')).toEqual({ r: 241, g: 240, b: 253 });
  });
});

describe('planOutreachCatalog (순수 · 장 구성)', () => {
  it('순서 = 포스터 → 상품(≤6) → 행사 슬라이스(≤3) · 링크 = 히어로/상품/행사 · 상품명은 캡션', () => {
    const plan = planOutreachCatalog(planInput());
    expect(plan.skipped).toBeNull();
    expect(plan.pages.map((p) => p.kind)).toEqual(['poster', 'product', 'product', 'slice', 'slice']);
    expect(plan.pages[0]).toMatchObject({ url: 'https://hanjul.ai/api/cdp/inapp/image/c/poster.jpg', linkUrl: 'https://b.com/event/1', caption: null });
    expect(plan.pages[1]).toMatchObject({ url: 'https://hanjul.ai/api/cdp/inapp/image/c/p1.jpg', linkUrl: 'https://b.com/p/1', caption: '얼티뮨 세럼' });
    expect(plan.pages[3]).toMatchObject({ url: 'https://hanjul.ai/api/cdp/inapp/image/c/s1.jpg', linkUrl: 'https://b.com/event/1', caption: null });
  });
  it('포스터가 없으면 히어로 링크는 기획전 딥링크 → 홈 · 카드도 없으면 갤러리 링크', () => {
    const plan = planOutreachCatalog(planInput({ posterUrl: null, eventCards: [] }));
    expect(plan.pages[0].kind).toBe('product');
    const p2 = planOutreachCatalog(planInput({ eventCards: [] }));
    expect(p2.pages[0]).toMatchObject({ kind: 'poster', linkUrl: 'https://b.com/plan' });
  });
  it('상한 · 중복 주소 1번 · 이미지·링크·이름 없는 상품 제외', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `상품${'가'.repeat(i + 1)}`.replace(/\d/g, ''), price: null, discount_price: null, image_url: `https://hanjul.ai/api/cdp/inapp/image/c/m${i}.jpg`, link_url: `https://b.com/p/m${i}`, width: 500, height: 500, srcImageUrl: 'x' }));
    const bad = [{ name: '', image_url: 'https://x/no-name.jpg', link_url: 'https://b.com/x' }, { name: '링크없음', image_url: 'https://x/no-link.jpg', link_url: '' }, { name: '사진없음', image_url: '', link_url: 'https://b.com/y' }];
    const dupSlice = { url: 'https://hanjul.ai/api/cdp/inapp/image/c/m0.jpg', width: 960, height: 1400, bytes: 1, srcUrl: 'x' };
    const plan = planOutreachCatalog(planInput({ posterUrl: null, media: media({ products: [...many, ...bad], slices: [dupSlice, ...media().slices, ...media().slices] }) }));
    const products = plan.pages.filter((p) => p.kind === 'product');
    expect(products).toHaveLength(OUTREACH_CATALOG_PRODUCTS_MAX);
    expect(OUTREACH_CATALOG_PRODUCTS_MAX).toBe(6);
    expect(OUTREACH_CATALOG_SLICES_MAX).toBe(3);
    const urls = plan.pages.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).not.toContain('https://x/no-name.jpg');
    expect(plan.pages.filter((p) => p.kind === 'slice')).toHaveLength(2); // m0 은 상품과 중복이라 빠지고 s1·s2
  });
  it('2쪽 미만이면 만들지 않는다(too_few_images) · 재료 0 도 같다', () => {
    expect(OUTREACH_CATALOG_MIN_PAGES).toBe(2);
    const one = planOutreachCatalog(planInput({ posterUrl: null, media: media({ products: media().products.slice(0, 1), slices: [] }) }));
    expect(one).toEqual({ pages: [], skipped: 'too_few_images' });
    expect(planOutreachCatalog(planInput({ posterUrl: null, media: null }))).toEqual({ pages: [], skipped: 'too_few_images' });
    // 포스터 1 + 상품 1 = 2쪽은 된다
    expect(planOutreachCatalog(planInput({ media: media({ products: media().products.slice(0, 1), slices: [] }) })).pages).toHaveLength(2);
  });
  it('슬라이스 판정(문서)이 있으면 문서는 빠진다(selectEventSlices 그대로)', () => {
    const kinds = { 'https://hanjul.ai/api/cdp/inapp/image/c/s1.jpg': { kind: 'document', text: true }, 'https://hanjul.ai/api/cdp/inapp/image/c/s2.jpg': { kind: 'product', text: false } };
    const plan = planOutreachCatalog(planInput({ media: media({ imageKinds: kinds }) }));
    expect(plan.pages.filter((p) => p.kind === 'slice').map((p) => p.url)).toEqual(['https://hanjul.ai/api/cdp/inapp/image/c/s2.jpg']);
  });
});

describe('renderCatalogCardBuffer (sharp · AI 0)', () => {
  it('3:4 카드(1200×1600) · 모서리는 틴트 · 가운데는 상품 · 알파 PNG 는 틴트 위에 편평화', async () => {
    expect(OUTREACH_CATALOG_CARD).toEqual({ width: 1200, height: 1600 });
    // 200×300 빨간 상품 + 투명 테두리
    const inner = await sharp({ create: { width: 160, height: 260, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
    const product = await sharp({ create: { width: 200, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: inner, top: 20, left: 20 }]).png().toBuffer();
    const out = await renderCatalogCardBuffer(product, { tint: { r: 241, g: 240, b: 253 } });
    expect(out.width).toBe(1200); expect(out.height).toBe(1600);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(1200); expect(meta.height).toBe(1600); expect(meta.format).toBe('jpeg');
    const px = async (x: number, y: number) => Array.from(await sharp(out.buffer).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer());
    const corner = await px(5, 5);
    expect(Math.abs(corner[0] - 241)).toBeLessThanOrEqual(4); expect(Math.abs(corner[2] - 253)).toBeLessThanOrEqual(4);
    const center = await px(600, 640);
    expect(center[0]).toBeGreaterThan(180); expect(center[1]).toBeLessThan(80);
    const bottom = await px(600, 1500); // 캡션 띠 = 틴트(글자는 파이썬 합성기가 뒤에 찍는다)
    expect(Math.abs(bottom[0] - 241)).toBeLessThanOrEqual(4);
  });
  it('작은 사본은 2배까지만 키운다(400px 사본이 흐려지지 않게) · 큰 사본은 안에 맞춘다', async () => {
    const small = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 10, g: 10, b: 200 } } }).png().toBuffer();
    const o1 = await renderCatalogCardBuffer(small, { tint: { r: 255, g: 255, b: 255 } });
    // 2배 = 800px → 가로 200~1000 은 상품, 150 은 여백
    const p = async (x: number, y: number) => Array.from(await sharp(o1.buffer).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer());
    expect((await p(150, 640))[2]).toBeGreaterThan(240);
    expect((await p(600, 640))[2]).toBeGreaterThan(150); expect((await p(600, 640))[0]).toBeLessThan(60);
    const big = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 10, g: 200, b: 10 } } }).png().toBuffer();
    const o2 = await renderCatalogCardBuffer(big, { tint: { r: 255, g: 255, b: 255 } });
    expect((await sharp(o2.buffer).metadata()).width).toBe(1200);
  });
});

describe('제안 메일 3번째 버튼 "카탈로그 보기"', () => {
  const guide = getActiveStyleGuide();
  const base: ProposalEmailInput = {
    companyName: '브랜드', industry: 'beauty', selectedEvent: null,
    copyBody: '(광고) 브랜드 소식\n{{DM_LINK}}', posterUrl: 'https://hanjul.ai/p.jpg',
    dmUrl: 'https://hlj.kr/abc', previewUrl: 'https://hanjul.ai/api/outreach/v/0123456789',
    unsubscribeNotice: '수신거부', brandSections: [], subject: '제목', intro: '서두', now: new Date('2026-09-15T03:00:00Z'),
  };
  it('catalogUrl 이 있으면 버튼 3개(산출물 · 카탈로그 · DM) · 라벨 8자 이내 · 카탈로그는 outline', () => {
    expect(guide.emailCopy.cta.catalog).toBe('카탈로그 보기');
    expect(guide.emailCopy.cta.catalog.length).toBeLessThanOrEqual(8);
    const s = buildProposalEmailSections(guide, { ...base, catalogUrl: 'https://hlj.kr/cat' });
    const cta = s.find((x) => x.type === 'cta') as any;
    expect(cta.props.buttons.map((b: any) => [b.label, b.url, b.style])).toEqual([
      [guide.emailCopy.cta.primary, base.previewUrl, 'primary'],
      [guide.emailCopy.cta.catalog, 'https://hlj.kr/cat', 'outline'],
      [guide.emailCopy.cta.secondary, base.dmUrl, 'outline'],
    ]);
    expect(buildOutreachPlainText(guide, { ...base, catalogUrl: 'https://hlj.kr/cat' })).toContain(`${guide.emailCopy.cta.catalog}: https://hlj.kr/cat`);
    expect(assembleProposalEmail({ ...base, catalogUrl: 'https://hlj.kr/cat' }).html).toContain('href="https://hlj.kr/cat"');
  });
  it('catalogUrl 이 없으면(null · 생략) 현행 2개 · 출력 동일', () => {
    const before = buildProposalEmailSections(guide, base);
    expect(buildProposalEmailSections(guide, { ...base, catalogUrl: null })).toEqual(before);
    const cta = before.find((x) => x.type === 'cta') as any;
    expect(cta.props.buttons.map((b: any) => b.url)).toEqual([base.previewUrl, base.dmUrl]);
    expect(buildOutreachPlainText(guide, { ...base, catalogUrl: null })).toBe(buildOutreachPlainText(guide, base));
    expect(buildOutreachPlainText(guide, base)).not.toContain(guide.emailCopy.cta.catalog);
  });
});

describe('배선 계약(소스)', () => {
  it('producing_dm 이 카탈로그를 만들고 dm 자산에 기록 · producing_email 이 catalogUrl 을 넘긴다 · 옛 카탈로그 DM 도 중지', () => {
    const jobs = SRC('sales-outreach-jobs.ts');
    expect(jobs).toContain("from './sales-outreach-catalog'");
    expect(jobs).toContain('planOutreachCatalog(');
    expect(jobs).toContain('buildOutreachCatalog(');
    for (const k of ['catalogDmId', 'catalogUrl', 'catalogViewerUrl', 'catalogPages', 'catalogImageUrls', 'catalogSkipped']) expect(jobs, k).toContain(`${k}:`);
    expect(jobs).toContain("catalogUrl: dmAsset?.catalogUrl ? String(dmAsset.catalogUrl) : null");
    const stop = jobs.slice(jobs.indexOf('async function stopSupersededDms('), jobs.indexOf('async function runProduction('));
    expect(stop).toContain('catalogDmId');
  });
  it('파기(purge)도 카탈로그 DM 중지 + 합성 카드 파일 삭제', () => {
    const purge = SRC('sales-outreach-purge.ts');
    expect(purge).toContain('catalogDmId');
    expect(purge).toContain('catalogImageUrls');
  });
  it('카탈로그 조립 파일은 AI 를 부르지 않는다(callOutreachAi 0 · generate 0)', () => {
    const cat = SRC('sales-outreach-catalog.ts');
    expect(cat).not.toMatch(/callOutreachAi|generatePoster|generateSections|callGemini|anthropic/i);
    expect(cat).toContain("settings: { catalog: true }");
    expect(cat).toContain("layout_mode: 'slides'");
  });
});
