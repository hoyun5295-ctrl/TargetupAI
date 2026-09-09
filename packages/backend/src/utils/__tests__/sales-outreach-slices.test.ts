import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  detectEventSlices, sliceModeCard, composeSliceSections, sliceHeightAt600, heroBannersOf,
  OUTREACH_SLICE_MIN, OUTREACH_SLICE_HEIGHT_BUDGET_600, OUTREACH_SLICE_GAP_MAX, type RenderImage, type EventSliceMaterial,
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
});
