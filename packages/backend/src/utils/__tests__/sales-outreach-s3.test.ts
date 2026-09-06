/**
 * sales-outreach-s3.test.ts — S3 스튜디오(포스터 3칸 · 타이포 · 알파 PNG · 배너 폴백 · vision 경고 매핑) 순수 함수 (2026-09-06 · 설계서 §5)
 * DB·AI·py 합성은 부르지 않는다. 네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { buildOutreachPosterTexts, posterCategoryLabel, buildPosterTypography, fillOutreachDmMedia } from '../sales-outreach-produce';
import { pngHasAlpha } from '../sales-outreach-media';
import { assessOutreachQuality, VISION_WARNING_OF } from '../sales-outreach-review';
import type { Section } from '../dm/dm-section-registry';

const sec = (type: string, props: Record<string, unknown>, order = 0): Section => ({ id: `s-${type}-${order}`, type, order, visible: true, props } as unknown as Section);

describe('포스터 문구 3칸 buildOutreachPosterTexts', () => {
  const products = [{ name: '17주년 잡티세럼 기획세트(로즈PDRN 잡티세럼 70ml)' }, { name: '장수진 수분크림 튜브형 70ml' }, { name: '비건쿠션 리필' }];
  it('행사명은 첫 구분자 앞 · 숫자 앞까지 · 인용의 부분 문자열 · 숫자·혜택어는 칸에서 거부', () => {
    const t = buildOutreachPosterTexts({ companyName: '아이소이', industry: 'beauty', eventQuote: '추석선물세트 특별 기획전~50%', products, siteTitle: '아이소이 착한성분 공식몰' });
    expect(t.title).toBe('추석선물세트 특별 기획전');
    expect(t.label).toBe('기획전');
    expect(t.subtitle).toBe('비건쿠션 리필'); // 숫자 든 상품명 2개는 건너뛴다
    expect(t.dropped).toEqual([]);
    for (const v of [t.label, t.title, t.subtitle]) expect(String(v)).not.toMatch(/\d|%|할인|쿠폰/);
  });
  it('행사가 없으면 title = 업체명(사실) · label = 업종 라벨 · subtitle = 사이트 제목', () => {
    const t = buildOutreachPosterTexts({ companyName: '아이소이', industry: 'beauty', eventQuote: null, products: [], siteTitle: '아이소이 착한성분 공식몰' });
    expect(t.title).toBe('아이소이');
    expect(typeof t.label).toBe('string');
    expect(t.subtitle).toBe('아이소이 착한성분 공식몰');
  });
  it('인용 첫 구간이 숫자로 시작하면 title 은 업체명으로 · dropped 에 기록 · 40자 초과 구간도 버린다', () => {
    const t = buildOutreachPosterTexts({ companyName: '브랜드', industry: null, eventQuote: '17주년 기념 잡티세럼 기획세트 46% 할인', products: [], siteTitle: null });
    expect(t.title).toBe('브랜드');
    expect(t.dropped).toContain('title');
    const long = buildOutreachPosterTexts({ companyName: '브랜드', industry: null, eventQuote: '아'.repeat(45) + ' 페스티벌', products: [], siteTitle: null });
    expect(long.title).toBe('브랜드');
  });
  it('혜택어가 든 상품명·사이트 제목은 subtitle 로 쓰지 않는다', () => {
    const t = buildOutreachPosterTexts({ companyName: 'X', industry: null, eventQuote: null, products: [{ name: '무료배송 세트' }, { name: '특가 크림' }], siteTitle: '최대 할인 공식몰' });
    expect(t.subtitle).toBeNull();
    expect(t.dropped).toContain('subtitle');
  });
  it('posterCategoryLabel — 인용에 있는 낱말만 · 없으면 업종 라벨 · 그것도 없으면 null', () => {
    expect(posterCategoryLabel('풍성한 한가위 보름달 혜택 기획전', null)).toBe('기획전');
    expect(posterCategoryLabel('멤버십 위크', null)).toBe('멤버십');
    expect(posterCategoryLabel('그냥 문장', 'fashion')).toBeTypeOf('string');
    expect(posterCategoryLabel('그냥 문장', null)).toBeNull();
  });
});

describe('서버 합성 타이포 buildPosterTypography', () => {
  const texts = { label: '기획전', title: '추석선물세트 특별 기획전', subtitle: '비건쿠션 리필', dropped: [] };
  it('3칸 → 3줄 · 크기는 높이 비율(0.01~0.3) · x·y 는 0~1 · 라벨은 브랜드 색 알약', () => {
    const t = buildPosterTypography(texts, { brandColor: '#4f46e5', zone: 'top', fontPath: null }) as any[];
    expect(t.map((x) => x.text)).toEqual(['기획전', '추석선물세트 특별 기획전', '비건쿠션 리필']);
    for (const x of t) {
      expect(x.size).toBeGreaterThanOrEqual(0.01); expect(x.size).toBeLessThanOrEqual(0.3);
      expect(x.x).toBe(0.5); expect(x.y).toBeGreaterThanOrEqual(0); expect(x.y).toBeLessThanOrEqual(1);
    }
    expect(t[0].role).toBe('badge'); expect(t[0].badgeColor).toBe('#4f46e5');
    expect(t[1].y).toBeLessThan(t[2].y);
  });
  it('bottom 구역(16:9 배너)은 y 가 0.6 이상 · 비운 칸은 줄이 없다', () => {
    const t = buildPosterTypography({ label: null, title: '브랜드', subtitle: null, dropped: ['label', 'subtitle'] }, { brandColor: null, zone: 'bottom', fontPath: '/x/font.ttf' }) as any[];
    expect(t.length).toBe(1);
    expect(t[0].y).toBeGreaterThanOrEqual(0.6);
    expect(t[0].fontPath).toBe('/x/font.ttf');
  });
});

describe('pngHasAlpha', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PNG } = require('pngjs') as any;
  const make = (alpha: number) => { const p = new PNG({ width: 4, height: 4 }); p.data.fill(200); for (let i = 3; i < p.data.length; i += 4) p.data[i] = alpha; return PNG.sync.write(p) as Buffer; };
  it('투명 픽셀이 있으면 true · 전부 불투명이면 false · PNG 아니면 false', () => {
    expect(pngHasAlpha(make(0))).toBe(true);
    expect(pngHasAlpha(make(255))).toBe(false);
    expect(pngHasAlpha(Buffer.from('\xff\xd8\xff\xe0 not png', 'binary'))).toBe(false);
    expect(pngHasAlpha(Buffer.alloc(10))).toBe(false);
  });
});

describe('fillOutreachDmMedia 배너 폴백', () => {
  const base = (over: Record<string, unknown>) => ({
    posterUrl: 'https://hanjul.ai/poster.jpg', posterSize: { width: 1792, height: 2400 }, logoUrl: null, gallery: [] as any[], products: [] as any[],
    ctaLinks: {}, homepageUrl: 'https://b.com/', legal: null, companyName: '브랜드', ...over,
  }) as any;
  it('실측 배너 0장 + 생성 배너 있음 → 히어로 = 배너 · 포스터는 그 다음', () => {
    const r = fillOutreachDmMedia([sec('hero', {}, 0), sec('gallery', {}, 1)], base({ bannerUrl: 'https://hanjul.ai/banner.jpg', bannerSize: { width: 1920, height: 1080 } }), 'DM');
    expect((r.sections[0].props as any).image_url).toBe('https://hanjul.ai/banner.jpg');
  });
  it('실측 배너가 있으면 생성 배너는 쓰지 않는다(실물 우선)', () => {
    const r = fillOutreachDmMedia([sec('hero', {}, 0)], base({ gallery: [{ url: 'https://hanjul.ai/real.jpg', width: 1920, height: 600 }], bannerUrl: 'https://hanjul.ai/banner.jpg' }), 'DM');
    expect((r.sections[0].props as any).image_url).toBe('https://hanjul.ai/real.jpg');
  });
  it('배너 없고 갤러리 없으면 옛 동작(포스터 히어로)', () => {
    const r = fillOutreachDmMedia([sec('hero', {}, 0)], base({}), 'DM');
    expect((r.sections[0].props as any).image_url).toBe('https://hanjul.ai/poster.jpg');
  });
});

describe('vision 채점 → 품질 경고 매핑', () => {
  const dm = [sec('header', {}, 0), sec('hero', { headline: 'X' }, 1), sec('cta', { buttons: [{ url: 'https://b.com/plan' }] }, 2), sec('footer', {}, 3), sec('gallery', {}, 4), sec('text_card', {}, 5)];
  const media = { gallery: [{ url: 'a' }, { url: 'b' }], products: [{ image_url: '1' }, { image_url: '2' }, { image_url: '3' }, { image_url: '4' }] };
  it('false 항목만 경고 · true·누락은 경고 없음 · 항목 8개 전부 코드가 있다', () => {
    expect(Object.keys(VISION_WARNING_OF).length).toBe(8);
    const w = assessOutreachQuality({ dmSections: dm, brandSections: null, media, legal: { legal: 'x', csPhone: null }, homepageUrl: 'https://b.com/', dmVision: { items: { hero_image_full: true, gray_box_zero: false, number_leak_zero: false } } });
    const codes = w.warnings.map((x) => x.code);
    expect(codes).toContain('VISION_GRAY_BOX');
    expect(codes).toContain('VISION_NUMBER_LEAK');
    expect(codes).not.toContain('VISION_NO_HERO_IMAGE');
    const none = assessOutreachQuality({ dmSections: dm, brandSections: null, media, legal: { legal: 'x', csPhone: null }, homepageUrl: 'https://b.com/', dmVision: null });
    expect(none.warnings.map((x) => x.code).some((c) => c.startsWith('VISION_'))).toBe(false);
  });
});
