// ★ 2026-09-09(6) v5 표준 조립 재료(standardMaterialsOf) — 톤28 2차 실측(B-0909-3) 정정 2건
//   ① 슬라이스가 있는 행사 = 카드 이미지가 첫 슬라이스(카드 배너 사본과 같은 원본이 두 번 실리던 것 차단)
//   ② 글자 카드(인용문 후보)에 상품명이 들어 있으면 그 상품의 사진·링크(링크는 상세가 없거나 홈일 때만 바꾼다)
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { standardMaterialsOf, matchProductInTitle } from '../sales-outreach-produce';

const HOME = 'https://www.toun28.com';
const st = (name: string, src: string) => ({ url: `https://hanjul.ai/copy/${name}`, width: 960, height: 1200, bytes: 1, srcUrl: src });
const products = [
  { name: '지성두피 다시마 샴푸바 (탈모 완화 기능 인증)', image_url: 'https://hanjul.ai/copy/p1.png', link_url: `${HOME}/renew/product/1001`, price: 9900, discount_price: null },
  { name: '글로우 크림', image_url: 'https://hanjul.ai/copy/p2.png', link_url: `${HOME}/renew/product/1002`, price: null, discount_price: null },
  { name: '세럼', image_url: 'https://hanjul.ai/copy/p3.png', link_url: `${HOME}/renew/product/1003`, price: null, discount_price: null },
];

describe('matchProductInTitle', () => {
  it('공백·괄호·구두점을 뺀 4자 이상 상품명이 제목에 들어 있으면 그 상품(긴 이름 우선) · 짧은 이름(세럼)은 대조하지 않는다', () => {
    expect(matchProductInTitle('오늘핫딜 <3+1> 지성두피 다시마 샴푸바 (탈모 완화 기능 인증)', products)?.link_url).toBe(`${HOME}/renew/product/1001`);
    expect(matchProductInTitle('오늘핫딜 글로우 크림 앤 세럼 50ml 기획팩', products)?.link_url).toBe(`${HOME}/renew/product/1002`);
    expect(matchProductInTitle('세럼 특가', products)).toBeNull();
    expect(matchProductInTitle('9월 가입 한정 혜택', products)).toBeNull();
    expect(matchProductInTitle('', products)).toBeNull();
  });
});

describe('standardMaterialsOf — 행사 블록 이미지', () => {
  const base = {
    companyName: '톤28', industry: 'beauty', homepageUrl: HOME, siteTitle: null, material: '', extraNotes: null,
    benefitLicensed: false, licensedQuote: '', proof: null, posterUrl: null, posterSize: null, bannerUrl: null, bannerSize: null, posterCaption: null,
    media: null, mediaSelection: null, ctaLinks: {}, legal: null, brandColor: null, entry: 'outreach' as const, heroBanners: null,
  };
  const media = { gallery: [st('g1.jpg', `${HOME}/img/a.jpg`)], products, slices: [st('s1.jpg', `${HOME}/img/a.jpg`), st('s2.jpg', `${HOME}/img/b.jpg`), st('s3.jpg', `${HOME}/img/c.jpg`)], imageKinds: null, logo: null, collectedAt: '', stats: {} } as any;

  it('슬라이스가 있는 행사 = 카드 이미지가 첫 슬라이스(카드 배너 사본 g1 = 같은 원본 a.jpg 이어도 두 번 안 실린다)', () => {
    const input = { ...base, eventCards: [{ title: 'Farm to Product', periodRaw: null, endDate: null, bannerUrl: 'https://hanjul.ai/copy/g1.jpg', bannerSize: null, detailUrl: `${HOME}/promotion/product/peptacica`, licensed: true }], eventSlices: { detailUrl: `${HOME}/promotion/product/peptacica`, finalUrl: '', images: [], candidates: 0, at: '' } } as any;
    const std = standardMaterialsOf(input, media)!;
    expect(std.events).toHaveLength(1);
    expect(std.events[0].imageUrl).toBe('https://hanjul.ai/copy/s1.jpg');
    expect(std.events[0].slices.map((s) => s.url)).toEqual(['https://hanjul.ai/copy/s1.jpg', 'https://hanjul.ai/copy/s2.jpg', 'https://hanjul.ai/copy/s3.jpg']);
  });

  it('인용문 글자 카드에 상품명이 있으면 상품 사진 + 상세 링크(출처가 홈이면) · 상세가 따로 있으면 링크는 그대로 · 상품명이 없으면 이미지 0', () => {
    const input = { ...base, eventSlices: null, eventCards: [
      { title: '오늘핫딜 <3+1> 지성두피 다시마 샴푸바 (탈모 완화 기능 인증)', periodRaw: null, endDate: null, bannerUrl: null, bannerSize: null, detailUrl: HOME, licensed: false },
      { title: '오늘핫딜 글로우 크림 앤 세럼 50ml 기획팩', periodRaw: null, endDate: null, bannerUrl: null, bannerSize: null, detailUrl: `${HOME}/promotion/benefit`, licensed: false },
      { title: '9월 가입 한정 혜택', periodRaw: null, endDate: null, bannerUrl: null, bannerSize: null, detailUrl: `${HOME}/promotion/benefit`, licensed: false },
    ] } as any;
    const std = standardMaterialsOf(input, media)!;
    expect(std.events[0]).toMatchObject({ title: '오늘핫딜 지성두피 다시마 샴푸바', imageUrl: 'https://hanjul.ai/copy/p1.png', linkUrl: `${HOME}/renew/product/1001` });
    expect(std.events[1]).toMatchObject({ imageUrl: 'https://hanjul.ai/copy/p2.png', linkUrl: `${HOME}/promotion/benefit` });
    expect(std.events[2]).toMatchObject({ imageUrl: null, linkUrl: `${HOME}/promotion/benefit` });
  });
});
