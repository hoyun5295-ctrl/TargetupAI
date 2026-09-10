import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  detectEventSlices, sliceModeCard, composeSliceSections, composeOutreachStandard, sliceHeightAt600, heroBannersOf, promoCardTitleOf, sliceCtaLabel, selectSliceImages, selectEventSlices, parseImageKinds, pickEventBannerImage,
  OUTREACH_SLICE_MIN, OUTREACH_SLICE_HEIGHT_BUDGET_600, OUTREACH_SLICE_GAP_MAX, OUTREACH_SLICE_PROMO_MAX, type RenderImage, type EventSliceMaterial, type ImageKindJudge,
} from '../sales-outreach-slices';

function fixtureImages(name: string): RenderImage[] {
  const j = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8'));
  return (j.items as any[]).filter((i) => i.kind === 'img').map((i) => ({ src: String(i.src), w: Number(i.nw), h: Number(i.nh), rw: Number(i.w), rh: Number(i.h), top: Number(i.top), href: i.href ?? null }));
}

describe('★ 재료 축 v4 — 슬라이스 간격 완화(글 블록 사이 허용) · 홈 상단 배너', () => {
  it('간격 상한은 600px — 톤28 펩타시카 프로모션 페이지(넓은 이미지 6장 · 사이에 글 블록 220~475px) = 슬라이스 6장', () => {
    expect(OUTREACH_SLICE_GAP_MAX).toBe(600);
    const r = detectEventSlices(fixtureImages('toun28-peptacica-images.json'));
    expect(r).not.toBeNull();
    expect(r!.images).toHaveLength(6);
    expect(r!.images[0].url).toContain('img_stn02_pc.jpg');
    expect(r!.images[5].url).toContain('img_stn07_pc.jpg');
  });
  it('heroBannersOf — 톤28 홈 상단 슬라이드: 원본 폭 ≥900 · 가로형 · 위쪽 300px 안 · 같은 주소 1번 · 문서 순서', () => {
    const banners = heroBannersOf(fixtureImages('toun28-home-images.json'));
    expect(banners.length).toBeGreaterThanOrEqual(5);
    expect(banners.length).toBeLessThanOrEqual(8);
    expect(new Set(banners.map((b) => b.url)).size).toBe(banners.length);
    expect(banners.every((b) => b.width >= 900 && b.width / b.height >= 1.2)).toBe(true);
    expect(banners.every((b) => /\/data\/banner\//.test(b.url))).toBe(true);
    expect(banners.map((b) => b.order)).toEqual(banners.map((_, i) => i));
  });
  it('heroBannersOf — 세로형·작은 이미지·아래쪽 이미지는 배너가 아니다 · 앵커 href 를 싣는다', () => {
    const list: RenderImage[] = [
      { src: 'https://a/hero1.jpg', w: 1920, h: 1080, rw: 1280, rh: 720, top: 0, href: 'https://a/event/1' },
      { src: 'https://a/portrait.jpg', w: 1080, h: 1920, rw: 500, rh: 900, top: 0, href: null },
      { src: 'https://a/small.jpg', w: 600, h: 300, rw: 600, rh: 300, top: 10, href: null },
      { src: 'https://a/low.jpg', w: 1920, h: 800, rw: 1280, rh: 533, top: 2400, href: null },
      { src: 'https://a/hero1.jpg', w: 1920, h: 1080, rw: 1280, rh: 720, top: 0, href: 'https://a/event/1' },
    ];
    expect(heroBannersOf(list)).toEqual([{ url: 'https://a/hero1.jpg', width: 1920, height: 1080, href: 'https://a/event/1', order: 0 }]);
    expect(heroBannersOf([])).toEqual([]);
    // ★ 0910 alt 는 있을 때만 키로 실린다(글자 카드 ↔ 배너 대조 원천 · 공백 정리 · 120자)
    expect(heroBannersOf([{ src: 'https://a/hero1.jpg', w: 1920, h: 1080, rw: 1280, rh: 720, top: 0, href: 'https://a/event/1', alt: '  SUPER   NATURAL 9월 11일 출시  ' }])[0]).toMatchObject({ url: 'https://a/hero1.jpg', alt: 'SUPER NATURAL 9월 11일 출시' });
  });
  it('★ 0910 pickEventBannerImage — 행사 페이지의 대표 이미지 = 폭 ≥600 · 비율 ≤4 · 문서 위쪽 1장(로고·아이콘·띠 배너 제외)', () => {
    const imgs = [
      { src: 'https://a/logo.png', w: 800, h: 200, rw: 200, rh: 50, top: 0, href: null },
      { src: 'https://a/strip.jpg', w: 1920, h: 300, rw: 1280, rh: 200, top: 100, href: null },
      { src: 'https://a/body.jpg', w: 960, h: 1200, rw: 960, rh: 1200, top: 900, href: null },
      { src: 'https://a/top.jpg', w: 1200, h: 600, rw: 1200, rh: 600, top: 300, href: null },
      { src: 'https://a/small.jpg', w: 400, h: 400, rw: 400, rh: 400, top: 200, href: null },
    ];
    expect(pickEventBannerImage(imgs)?.src).toBe('https://a/top.jpg');
    expect(pickEventBannerImage([imgs[0], imgs[1], imgs[4]])).toBeNull();
    expect(pickEventBannerImage([])).toBeNull();
  });
});
import type { EngineEventCard } from '../campaign-engine';
import type { StoredImage } from '../sales-outreach-media';

/**
 * ★ 2026-09-09 기획전 슬라이스 조립 모드 — 재료 판정(렌더된 이미지 기하) · 자격 · 구성(AI 0).
 * 픽스처 = 아이소이 추석 기획전 상세(https://www.isoi.co.kr/event/202609/chuseok_event)를 1280폭으로 렌더해 뽑은 img 73장의 실측 기하.
 * 페이지 구조 = 960px 슬라이스 15장(히어로 1 · 혜택 6 · 상품 안내 1 · 상품 카드 7)이 세로로 이어지고, 그 뒤 작은 배너(543×91)·가로 배너(1100×300)가 온다.
 */
function isoiImages(): RenderImage[] {
  const j = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'isoi-chuseok-event-images.json'), 'utf-8'));
  return (j.items as any[]).filter((i) => i.kind === 'img').map((i) => ({ src: String(i.src), w: Number(i.nw), h: Number(i.nh), rw: Number(i.w), rh: Number(i.h), top: Number(i.top) }));
}

const img = (src: string, w: number, h: number, top: number, rw = w, rh = h): RenderImage => ({ src, w, h, rw, rh, top });

describe('detectEventSlices — 렌더된 이미지 기하에서 세로로 이어진 슬라이스 묶음을 찾는다', () => {
  it('아이소이 추석 기획전 실측 = 15장 · 첫 장 cont1 · 마지막 pd_5816 · 작은 배너·가로 배너 제외', () => {
    const r = detectEventSlices(isoiImages());
    expect(r).not.toBeNull();
    expect(r!.images).toHaveLength(15);
    expect(r!.images[0].url).toContain('chuseok_event_cont1.jpg');
    expect(r!.images[14].url).toContain('chuseok_event_cont3_pd_5816.jpg');
    expect(r!.images.every((i) => i.width === 960)).toBe(true);
    expect(r!.images.map((i) => i.order)).toEqual(Array.from({ length: 15 }, (_, i) => i));
    expect(r!.images.some((i) => /event_small_banner|pc_event_banner/.test(i.url))).toBe(false);
  });

  it('3장 미만이면 null', () => {
    expect(detectEventSlices([img('https://a/1.jpg', 960, 800, 0), img('https://a/2.jpg', 960, 800, 800)])).toBeNull();
    expect(detectEventSlices([])).toBeNull();
  });

  it('세로 간격이 벌어지면 다른 묶음 — 가장 긴 묶음 하나만', () => {
    const list = [
      img('https://a/a1.jpg', 960, 500, 0), img('https://a/a2.jpg', 960, 500, 500), img('https://a/a3.jpg', 960, 500, 1000),
      img('https://a/b1.jpg', 960, 500, 3000), img('https://a/b2.jpg', 960, 500, 3500), img('https://a/b3.jpg', 960, 500, 4000), img('https://a/b4.jpg', 960, 500, 4500), img('https://a/b5.jpg', 960, 500, 5000),
    ];
    const r = detectEventSlices(list);
    expect(r!.images.map((i) => i.url)).toEqual(['https://a/b1.jpg', 'https://a/b2.jpg', 'https://a/b3.jpg', 'https://a/b4.jpg', 'https://a/b5.jpg']);
  });

  it('폭이 좁거나(원본 600 미만 · 렌더 480 미만) 가로로 납작한(비율 3.2 초과) 이미지는 후보가 아니다', () => {
    const list = [
      img('https://a/thin.jpg', 1100, 300, 0),
      img('https://a/s1.jpg', 960, 700, 300), img('https://a/s2.jpg', 960, 700, 1000), img('https://a/s3.jpg', 960, 700, 1700),
      img('https://a/small.jpg', 500, 700, 2400),
      img('https://a/tiny-render.jpg', 960, 700, 2400, 300, 220),
    ];
    const r = detectEventSlices(list);
    expect(r!.images.map((i) => i.url)).toEqual(['https://a/s1.jpg', 'https://a/s2.jpg', 'https://a/s3.jpg']);
    expect(r!.candidates).toBe(3);
  });

  it('같은 주소가 이어 붙어 있으면 한 번만 · data: 주소는 버린다', () => {
    const list = [
      img('https://a/s1.jpg', 960, 700, 0), img('https://a/s1.jpg', 960, 700, 700),
      img('data:image/png;base64,xxxx', 960, 700, 1400),
      img('https://a/s2.jpg', 960, 700, 2100), img('https://a/s3.jpg', 960, 700, 2800),
    ];
    // s1 중복 제거 → s1(0~700) 다음이 data(버림) → 간격이 벌어져 s1 단독 · s2·s3 묶음 2장 = 3장 미만 → null
    expect(detectEventSlices(list)).toBeNull();
  });
});

const card = (over: Partial<EngineEventCard> = {}): EngineEventCard => ({
  title: '추석선물세트 특별 기획전', periodRaw: '2026.09.01 ~ 2026.10.05', endDate: '2026-10-05', bannerUrl: null, bannerSize: null,
  detailUrl: 'https://www.isoi.co.kr/event/202609/chuseok_event', licensed: true, ...over,
});
const stored = (src: string, height = 700): StoredImage => ({ url: `https://hanjul.ai/api/cdp/inapp/image/c/${src.split('/').pop()}`, width: 960, height, bytes: 100000, srcUrl: src });
const material = (): EventSliceMaterial => ({
  detailUrl: 'https://www.isoi.co.kr/event/202609/chuseok_event', finalUrl: 'https://www.isoi.co.kr/event/202609/chuseok_event',
  images: [1, 2, 3, 4].map((n) => ({ url: `https://c/s${n}.jpg`, width: 960, height: 700, order: n - 1 })), candidates: 4, at: '2026-09-09T00:00:00.000Z',
});

describe('sliceModeCard — 면허 있는 선택 카드 + 그 상세의 사본 ≥ 3 일 때만', () => {
  it('자격 충족 = 카드와 사본(재료 순서)을 돌려준다', () => {
    const r = sliceModeCard([card()], material(), [stored('https://c/s2.jpg'), stored('https://c/s1.jpg'), stored('https://c/s3.jpg')]);
    expect(r).not.toBeNull();
    expect(r!.card.detailUrl).toBe('https://www.isoi.co.kr/event/202609/chuseok_event');
    expect(r!.slices.map((s) => s.srcUrl)).toEqual(['https://c/s1.jpg', 'https://c/s2.jpg', 'https://c/s3.jpg']);
  });
  it('면허 없는 카드 · 다른 상세 주소 · 재료 없음 · 사본 2장 = null', () => {
    const three = [stored('https://c/s1.jpg'), stored('https://c/s2.jpg'), stored('https://c/s3.jpg')];
    expect(sliceModeCard([card({ licensed: false })], material(), three)).toBeNull();
    expect(sliceModeCard([card({ detailUrl: 'https://www.isoi.co.kr/event/other' })], material(), three)).toBeNull();
    expect(sliceModeCard([card()], null, three)).toBeNull();
    expect(sliceModeCard([card()], material(), three.slice(0, OUTREACH_SLICE_MIN - 1))).toBeNull();
    expect(sliceModeCard([], material(), three)).toBeNull();
  });
  it('상세 주소는 끝 슬래시·해시 차이를 무시한다', () => {
    const r = sliceModeCard([card({ detailUrl: 'https://www.isoi.co.kr/event/202609/chuseok_event/#top' })], material(), [stored('https://c/s1.jpg'), stored('https://c/s2.jpg'), stored('https://c/s3.jpg')]);
    expect(r).not.toBeNull();
  });
});

describe('composeSliceSections — header · gallery(list_1xN · full_bleed) · cta · footer, 문안 0', () => {
  const slices = [stored('https://c/s1.jpg', 1082), stored('https://c/s2.jpg', 523), stored('https://c/s3.jpg', 634), stored('https://c/s4.jpg', 707), stored('https://c/s5.jpg', 1403)];
  const base = { companyName: '아이소이', logoUrl: 'https://hanjul.ai/logo.png', slices, detailUrl: 'https://www.isoi.co.kr/event/202609/chuseok_event', ctaLabel: '추석선물세트 특별 기획전 보기', legal: { legal: '(주)아이소이', csPhone: '02-000-0000' } };

  it('DM = 4블록 순서 고정 · 슬라이스마다 상세 링크 · 안내 문구 0', () => {
    const secs = composeSliceSections({ ...base, channel: 'DM' });
    expect(secs.map((s) => s.type)).toEqual(['header', 'gallery', 'cta', 'footer']);
    expect(secs.map((s) => s.id)).toEqual(['so-slice-header', 'so-slice-gallery', 'so-slice-cta', 'so-slice-footer']);
    const g: any = secs[1].props;
    expect(g.layout).toBe('list_1xN');
    expect(g.full_bleed).toBe(true);
    expect(g.title).toBe('');
    expect(g.images).toHaveLength(5);
    expect(g.images.every((i: any) => i.link_url === base.detailUrl && i.caption === '')).toBe(true);
    const h: any = secs[0].props;
    expect(h.variant).toBe('logo'); expect(h.brand_name).toBe('아이소이'); expect(h.logo_url).toBe(base.logoUrl); expect(h.align).toBe('center');
    const c: any = secs[2].props;
    expect(c.buttons).toEqual([{ label: base.ctaLabel, url: base.detailUrl, style: 'primary' }]);
    const f: any = secs[3].props;
    expect(f.legal_text).toBe('(주)아이소이'); expect(f.cs_phone).toBe('02-000-0000');
    expect(secs.every((s) => s.visible === true)).toBe(true);
    expect(secs.map((s) => s.order)).toEqual([0, 1, 2, 3]);
  });

  it('EMAIL = 헤더 왼쪽 정렬 · 나머지 동일', () => {
    const secs = composeSliceSections({ ...base, channel: 'EMAIL' });
    expect((secs[0].props as any).align).toBe('left');
    expect((secs[1].props as any).full_bleed).toBe(true);
  });

  it('높이 예산(600폭 환산) — 예산 안까지만 · 최소 3장은 지킨다', () => {
    // 600폭 환산 높이 = 676 · 327 · 396 · 442 · 877 → 누적 676 · 1003 · 1399 · 1841 · 2718
    expect(sliceHeightAt600(slices[0])).toBe(676);
    const secs = composeSliceSections({ ...base, channel: 'DM', heightBudget600: 2000 });
    expect((secs[1].props as any).images).toHaveLength(4);
    const tight = composeSliceSections({ ...base, channel: 'DM', heightBudget600: 100 });
    expect((tight[1].props as any).images).toHaveLength(OUTREACH_SLICE_MIN);
    const full = composeSliceSections({ ...base, channel: 'DM' });
    expect((full[1].props as any).images).toHaveLength(5);
    expect(OUTREACH_SLICE_HEIGHT_BUDGET_600).toBeGreaterThan(2718);
  });

  it('로고 없음 = 브랜드명 글자만 · 법정 표기 없음 = 푸터 기본값', () => {
    const secs = composeSliceSections({ ...base, channel: 'DM', logoUrl: null, legal: null });
    expect((secs[0].props as any).logo_url).toBeUndefined();
    expect((secs[0].props as any).brand_name).toBe('아이소이');
    expect((secs[3].props as any).legal_text).toBeUndefined();
  });

  it('★ v4-2 상품이 있으면 슬라이스 뒤에 상품 카드(최대 4 · 링크·이름 필수 · 가격 없으면 0) · 순서 header·gallery·products·cta·footer', () => {
    const products = [1, 2, 3, 4, 5].map((n) => ({ name: `펩타시카 상품 ${n}`, image_url: `https://hanjul.ai/copy/p${n}.png`, link_url: `https://www.toun28.com/renew/product/${n}`, price: n === 2 ? 34200 : null, discount_price: n === 2 ? 30000 : null }));
    const secs = composeSliceSections({ ...base, channel: 'DM', products: [...products, { name: '', image_url: 'x', link_url: 'y', price: null, discount_price: null }] });
    expect(secs.map((s) => s.type)).toEqual(['header', 'gallery', 'product_carousel', 'cta', 'footer']);
    expect(secs.map((s) => s.id)).toEqual(['so-slice-header', 'so-slice-gallery', 'so-slice-products', 'so-slice-cta', 'so-slice-footer']);
    expect(secs.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
    const pc: any = secs[2].props;
    expect(pc.products).toHaveLength(4);
    expect(pc.products[0]).toEqual({ name: '펩타시카 상품 1', image_url: 'https://hanjul.ai/copy/p1.png', link_url: 'https://www.toun28.com/renew/product/1', price: 0 });
    expect(pc.products[1]).toMatchObject({ price: 34200, discount_price: 30000 });
    expect(pc.title).toBe('');
  });

  it('★ v4-2 프로모션·스토리 페이지 슬라이스는 maxSlices(4)까지 · 최소 3 은 지킨다', () => {
    const secs = composeSliceSections({ ...base, channel: 'DM', maxSlices: OUTREACH_SLICE_PROMO_MAX });
    expect((secs[1].props as any).images).toHaveLength(4);
    expect((composeSliceSections({ ...base, channel: 'DM', maxSlices: 1 })[1].props as any).images).toHaveLength(OUTREACH_SLICE_MIN);
  });
});

describe('★ v4-3 이미지 판정 선별 — 모델은 분류만 · 고르기는 코드', () => {
  const st = (name: string, w = 1920, h = 734): StoredImage => ({ url: `https://hanjul.ai/copy/${name}`, width: w, height: h, bytes: 1000, srcUrl: `https://c/${name}` });
  const slices = [st('s1.jpg'), st('s2.jpg'), st('cert.jpg'), st('s4.jpg'), st('s5.jpg'), st('s6.jpg')];
  const heroes = [st('hero-a.jpg', 1920, 1080), st('hero-b.jpg', 1920, 1080), st('hero-c.jpg', 1920, 1080)];
  const kinds: Record<string, ImageKindJudge> = {
    [slices[0].url]: { kind: 'photo', text: false }, [slices[1].url]: { kind: 'photo', text: false }, [slices[2].url]: { kind: 'document', text: true },
    [slices[3].url]: { kind: 'photo', text: false }, [slices[4].url]: { kind: 'banner', text: true }, [slices[5].url]: { kind: 'photo', text: false },
    [heroes[0].url]: { kind: 'banner', text: false }, [heroes[1].url]: { kind: 'banner', text: true }, [heroes[2].url]: { kind: 'photo', text: false },
  };
  it('parseImageKinds — JSON items → n장 · 빠진 칸 other · 잘못된 종류 other · 형식 아님 null', () => {
    expect(parseImageKinds('결과: {"items":[{"i":0,"kind":"banner","text":true},{"i":2,"kind":"weird","text":"true"}]}', 3)).toEqual([
      { kind: 'banner', text: true }, { kind: 'other', text: false }, { kind: 'other', text: true },
    ]);
    expect(parseImageKinds('그냥 글', 2)).toBeNull();
    expect(parseImageKinds('{"foo":1}', 2)).toBeNull();
  });
  it('프로모션 페이지 + 판정 있음 = 글자 있는 홈 배너 먼저(≤2) → 배너·상품 슬라이스 → 분위기 사진 1 · 문서 제외 · 상한 4', () => {
    const picked = selectSliceImages(slices, kinds, { source: 'promo_page', heroBanners: heroes, maxSlices: 4 });
    expect(picked.map((s) => s.url.split('/').pop())).toEqual(['hero-b.jpg', 'hero-a.jpg', 's5.jpg', 's1.jpg']);
  });
  it('프로모션 페이지 + 판정 없음 = 홈 배너 2 + 슬라이스 2 · 홈 배너 없으면 슬라이스 앞 4', () => {
    expect(selectSliceImages(slices, null, { source: 'promo_page', heroBanners: heroes, maxSlices: 4 }).map((s) => s.url.split('/').pop())).toEqual(['hero-a.jpg', 'hero-b.jpg', 's1.jpg', 's2.jpg']);
    expect(selectSliceImages(slices, null, { source: 'promo_page', heroBanners: [], maxSlices: 4 })).toHaveLength(4);
  });
  it('기획전(event_card) = 문서만 빼고 그대로 · 문서를 빼서 3장 미만이면 원래대로', () => {
    expect(selectSliceImages(slices, kinds, { source: 'event_card', heroBanners: heroes, maxSlices: 20 }).map((s) => s.url.split('/').pop())).toEqual(['s1.jpg', 's2.jpg', 's4.jpg', 's5.jpg', 's6.jpg']);
    const few = [st('a.jpg'), st('b.jpg'), st('c.jpg')];
    const k2: Record<string, ImageKindJudge> = { [few[2].url]: { kind: 'document', text: true } };
    expect(selectSliceImages(few, k2, { source: 'event_card', heroBanners: [], maxSlices: 20 })).toHaveLength(3);
    expect(selectSliceImages(few, null, { source: undefined, heroBanners: [], maxSlices: 2 })).toHaveLength(2);
  });
  it('선별 결과가 2장 미만이면 선별 전으로 되돌린다(산출물을 비우지 않는다)', () => {
    const only = [st('d1.jpg'), st('d2.jpg'), st('d3.jpg')];
    const allDocs: Record<string, ImageKindJudge> = Object.fromEntries(only.map((s) => [s.url, { kind: 'document', text: true }]));
    expect(selectSliceImages(only, allDocs, { source: 'promo_page', heroBanners: [], maxSlices: 4 })).toHaveLength(3);
  });
});

describe('★ v5 행사 블록 슬라이스 선별 — 문서 제외 · 배너·상품 → 분위기 ≤2 · 문서만이면 0장', () => {
  const st = (name: string): StoredImage => ({ url: `https://hanjul.ai/copy/${name}`, width: 1920, height: 734, bytes: 1000, srcUrl: `https://c/${name}` });
  const s = [st('p1.jpg'), st('p2.jpg'), st('cert.jpg'), st('p3.jpg'), st('b1.jpg')];
  const kinds: Record<string, ImageKindJudge> = {
    [s[0].url]: { kind: 'photo', text: false }, [s[1].url]: { kind: 'photo', text: false }, [s[2].url]: { kind: 'document', text: true },
    [s[3].url]: { kind: 'photo', text: false }, [s[4].url]: { kind: 'banner', text: true },
  };
  it('판정 있음 = 배너 먼저 · 사진 2 · 인증서 0 · 상한', () => {
    expect(selectEventSlices(s, kinds, 3).map((x) => x.url.split('/').pop())).toEqual(['b1.jpg', 'p1.jpg', 'p2.jpg']);
    expect(selectEventSlices(s, kinds, 10).map((x) => x.url.split('/').pop())).toEqual(['b1.jpg', 'p1.jpg', 'p2.jpg']);
  });
  it('판정 없음 = 순서대로 상한 · 문서만이면 0장', () => {
    expect(selectEventSlices(s, null, 2).map((x) => x.url.split('/').pop())).toEqual(['p1.jpg', 'p2.jpg']);
    const docs: Record<string, ImageKindJudge> = { [s[0].url]: { kind: 'document', text: true }, [s[1].url]: { kind: 'document', text: true } };
    expect(selectEventSlices(s.slice(0, 2), docs, 3)).toEqual([]);
  });
});

describe('★ v5 표준 조립 — 스튜디오 히어로 → 상품 큐레이션 → 행사 나열 → 버튼 (직원 DM 공식 · AI 0)', () => {
  const st = (name: string): StoredImage => ({ url: `https://hanjul.ai/copy/${name}`, width: 1920, height: 734, bytes: 1000, srcUrl: `https://c/${name}` });
  const products = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ name: `상품 ${n}`, image_url: `https://hanjul.ai/copy/p${n}.png`, link_url: `https://shop/p/${n}`, price: n * 1000, discount_price: null }));
  const events = [
    { title: '추석선물세트 특별 기획전', periodLine: '기간 2026.09.01 ~ 2026.10.05', imageUrl: 'https://hanjul.ai/copy/ev1.jpg', linkUrl: 'https://shop/event/1', ctaLabel: '추석선물세트 특별 보기', slices: [st('s1.jpg'), st('s2.jpg'), st('s3.jpg'), st('s4.jpg')] },
    { title: '가을 신상', periodLine: '', imageUrl: null, linkUrl: 'https://shop/event/2', ctaLabel: '가을 신상 보기' },
    { title: '멤버십 혜택', periodLine: '', imageUrl: null, linkUrl: 'https://shop/event/3', ctaLabel: '멤버십 혜택 보기' },
    { title: '넘치는 4번째', periodLine: '', imageUrl: null, linkUrl: 'https://shop/event/4', ctaLabel: 'x' },
  ];
  const base = { companyName: '아이소이', logoUrl: 'https://hanjul.ai/logo.png', legal: { legal: '(주)아이소이', csPhone: null }, ctaLabel: '아이소이 바로가기', ctaUrl: 'https://shop/' };

  it('순서 = header · hero(gallery 1장 풀폭) · products(≤6) · [행사 text_card + slices(≤3) + cta] × ≤3 · 대표 cta · footer · id 접두 so-std-', () => {
    const secs = composeOutreachStandard({ ...base, channel: 'DM', hero: { url: 'https://hanjul.ai/copy/poster.png', kind: 'poster', linkUrl: 'https://shop/event/1' }, products, events });
    expect(secs.map((s) => s.type)).toEqual([
      'header', 'gallery', 'product_carousel',
      'text_card', 'gallery', 'cta',
      'text_card', 'cta',
      'text_card', 'cta',
      'cta', 'footer',
    ]);
    expect(secs.every((s) => String(s.id).startsWith('so-std-'))).toBe(true);
    expect(secs.map((s) => s.order)).toEqual(secs.map((_, i) => i));
    const hero: any = secs[1].props;
    expect(hero.layout).toBe('list_1xN'); expect(hero.full_bleed).toBe(true); expect(hero.images).toEqual([{ url: 'https://hanjul.ai/copy/poster.png', link_url: 'https://shop/event/1', caption: '' }]);
    expect((secs[2].props as any).products).toHaveLength(6);
    const ev1: any = secs[3].props;
    expect(ev1).toMatchObject({ tag: '이벤트', headline: '추석선물세트 특별 기획전', body: '기간 2026.09.01 ~ 2026.10.05', image_url: 'https://hanjul.ai/copy/ev1.jpg', image_position: 'top' });
    expect((secs[4].props as any).images).toHaveLength(3);
    expect((secs[4].props as any).images.every((i: any) => i.link_url === 'https://shop/event/1')).toBe(true);
    expect((secs[5].props as any).buttons).toEqual([{ label: '추석선물세트 특별 보기', url: 'https://shop/event/1', style: 'primary' }]);
    expect((secs[10].props as any).buttons[0]).toEqual({ label: '아이소이 바로가기', url: 'https://shop/', style: 'primary' });
    expect((secs[0].props as any).align).toBe('center');
  });
  it('히어로 없음 · 행사 없음 = 상품 + 대표 버튼 · EMAIL 헤더 왼쪽 · 마지막 행사 버튼과 대표 버튼 목적지가 같으면 대표 버튼 생략', () => {
    const secs = composeOutreachStandard({ ...base, channel: 'EMAIL', hero: null, products: products.slice(0, 2), events: [] });
    expect(secs.map((s) => s.type)).toEqual(['header', 'product_carousel', 'cta', 'footer']);
    expect((secs[0].props as any).align).toBe('left');
    const same = composeOutreachStandard({ ...base, channel: 'DM', hero: null, products: [], events: [events[1]], ctaUrl: 'https://shop/event/2' });
    expect(same.map((s) => s.type)).toEqual(['header', 'text_card', 'cta', 'footer']);
  });
  it('슬라이스가 행사 배너와 같은 주소면 뺀다 · 상품 이름·링크 없는 항목 제외', () => {
    const secs = composeOutreachStandard({ ...base, channel: 'DM', hero: null, products: [{ name: '', image_url: 'x', link_url: 'y', price: null, discount_price: null }], events: [{ ...events[0], imageUrl: 'https://hanjul.ai/copy/s1.jpg', slices: [st('s1.jpg'), st('s2.jpg')] }] });
    expect(secs.map((s) => s.type)).toEqual(['header', 'text_card', 'gallery', 'cta', 'cta', 'footer']);
    expect((secs[2].props as any).images.map((i: any) => i.url)).toEqual(['https://hanjul.ai/copy/s2.jpg']);
  });
});

describe('★ v4-2 코드가 세우는 프로모션 카드 제목 · 버튼 문구', () => {
  const img = (alt: string): RenderImage => ({ src: 'https://c/s.jpg', w: 1920, h: 734, rw: 1280, rh: 490, top: 100, alt });
  it('슬라이스 alt 가 1순위("Farm to Product 사진" → "Farm to Product") · 일반 alt 는 건너뛴다', () => {
    expect(promoCardTitleOf([img('배너'), img('Farm to Product 사진')], 'https://www.toun28.com/promotion/product/peptacica', '톤28 공식몰 - 의식있는 아름다움', '톤28')).toBe('Farm to Product');
  });
  it('alt 없음 → 경로 조각("peptacica") · 경로도 없으면 페이지 title(사이트명·공식몰은 제외) → "기획 페이지"', () => {
    expect(promoCardTitleOf([img('')], 'https://www.toun28.com/promotion/product/peptacica', '톤28 공식몰', '톤28')).toBe('peptacica');
    expect(promoCardTitleOf([], 'https://www.toun28.com/', '추석 기획전 | 브랜드', '브랜드')).toBe('추석 기획전');
    expect(promoCardTitleOf([], 'https://www.toun28.com/', '톤28 공식몰 - 의식있는 아름다움', '톤28')).toBe('기획 페이지');
  });
  it('sliceCtaLabel — 제목이 사이트명·공식몰 류면 "상품 자세히 보기" · 아니면 제목형 라벨', () => {
    expect(sliceCtaLabel('톤28 공식몰', '톤28', '톤28 공식몰 보기')).toBe('상품 자세히 보기');
    expect(sliceCtaLabel('톤28', '톤28', 'x')).toBe('상품 자세히 보기');
    expect(sliceCtaLabel('기획 페이지', '톤28', 'x')).toBe('상품 자세히 보기');
    expect(sliceCtaLabel('Farm to Product', '톤28', 'Farm to Product 보기')).toBe('Farm to Product 보기');
    // 낱말 경계 절단으로 제목이 반 토막 났으면("Farm to 보기") 상품형으로 · 70% 이상 남은 절단("추석선물세트 특별 보기")은 그대로
    expect(sliceCtaLabel('Farm to Product', '톤28', 'Farm to 보기')).toBe('상품 자세히 보기');
    expect(sliceCtaLabel('추석선물세트 특별 기획전', '아이소이', '추석선물세트 특별 보기')).toBe('추석선물세트 특별 보기');
  });
});
