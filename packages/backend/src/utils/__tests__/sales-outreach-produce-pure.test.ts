/**
 * sales-outreach-produce-pure.test.ts — 제작 CT 순수 함수 행동 테스트 (2026-09-05 · 설계서 A-2·A-4·A-8·A-10b·D-1)
 * DB·AI는 mock. 렌더러(renderEmailSections)는 순수라 실제로 돌린다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
const aiMock = vi.fn(async () => '');
vi.mock('../../services/ai', () => ({ callAIWithFallback: (...args: any[]) => aiMock(...args) }));

import {
  TEMPLATE_POOLS, INDUSTRY_TEMPLATE_MAP, pickTemplate, sanitizeDmCopyBenefits, fillOutreachDmMedia, sectionsFromAiJson,
  buildProposalEmailSections, buildOutreachPlainText, assembleProposalEmail, generateSubjectIntro, buildEmailIntroPrompt,
  buildOutreachMaterialBlock, buildDmSectionsPrompt, buildEmailSectionsPrompt, countBenefitPlaceholders, type ProposalEmailInput,
} from '../sales-outreach-produce';
import { getActiveStyleGuide } from '../sales-outreach-style';
import { INDUSTRY_CODES } from '../industry-codes';
import { BENEFIT_PLACEHOLDER } from '../copy-benefit-detector';
import type { Section } from '../dm/dm-section-registry';

const sec = (type: string, props: any, order = 0): Section => ({ id: `t-${order}-${type}`, type, order, visible: true, props } as unknown as Section);

describe('A-4 템플릿 풀·선택', () => {
  it('15 업종 × {product, event} 풀이 전부 1개 이상', () => {
    for (const code of INDUSTRY_CODES) {
      expect(TEMPLATE_POOLS[code].product.length, `${code} product`).toBeGreaterThan(0);
      expect(TEMPLATE_POOLS[code].event.length, `${code} event`).toBeGreaterThan(0);
      expect(INDUSTRY_TEMPLATE_MAP[code]).toBeTruthy();
    }
  });
  it('같은 (jobId, seq) = 같은 결과 · seq를 바꾸면 풀 안에서 달라질 수 있다 · 미지 업종 = etc', () => {
    const a = pickTemplate('food', 'job:0', true);
    expect(pickTemplate('food', 'job:0', true).id).toBe(a.id);
    expect(TEMPLATE_POOLS.food.product.some((t) => t.id === a.id)).toBe(true);
    const ids = new Set(Array.from({ length: 12 }, (_, i) => pickTemplate('beauty', `job:${i}`, true).id));
    expect(ids.size).toBeGreaterThan(1);
    expect(TEMPLATE_POOLS.etc.event.some((t) => t.id === pickTemplate(null, 'x:0', false).id)).toBe(true);
    expect(pickTemplate('fashion', 'x:0', false).kind).toBe('event');
  });
});

describe('A-8 sanitizeDmCopyBenefits', () => {
  it('미면허: 긴 prop은 문장째 · 짧은 prop은 prop째 · hero 헤드라인은 업체명 · 가격 필드 무변경', () => {
    const sections = [
      sec('hero', { headline: '가을 할인 소식', sub_copy: '편안한 데일리 룩' }, 0),
      sec('text_card', { tag: '신상', headline: '가을 신상 입고', body: '가을 신상 30% 할인. 9월 한정.' }, 1),
      sec('product_carousel', { title: '추천 상품', products: [{ name: 'A', price: 19000, discount_price: 15000 }] }, 2),
      sec('cta', { buttons: [{ label: '20% 쿠폰 받기', url: 'x' }, { label: '보러가기', url: 'y' }] }, 3),
    ];
    const r = sanitizeDmCopyBenefits(sections, '', '브랜드');
    expect(r.stripped).toBeGreaterThanOrEqual(3);
    expect((r.sections[0].props as any).headline).toBe('브랜드');
    expect((r.sections[0].props as any).sub_copy).toBe('편안한 데일리 룩');
    expect((r.sections[1].props as any).body).toBe('9월 한정.');
    expect((r.sections[2].props as any).products[0]).toEqual({ name: 'A', price: 19000, discount_price: 15000 });
    expect((r.sections[3].props as any).buttons[0].label).toBe('자세히 보기');
    expect((r.sections[3].props as any).buttons[1].label).toBe('보러가기');
    for (const s of r.sections) expect(JSON.stringify(s.props)).not.toContain(BENEFIT_PLACEHOLDER);
  });
  it('면허 인용 안의 수치는 유지 · text_card 전부 공백이면 섹션 제거 · 종결부호 없는 긴 body는 전체 제거', () => {
    const sections = [
      sec('text_card', { tag: '', headline: '', body: '전 품목 30% 할인' }, 0),
      sec('text_card', { tag: '행사', headline: '가을 감사제', body: '전 품목 30% 할인. 9월 30일까지.' }, 1),
      sec('text_card', { tag: '', headline: '', body: '오늘만 50% 세일 진행' }, 2),
    ];
    const r = sanitizeDmCopyBenefits(sections, '전 품목 30% 할인', '브랜드');
    expect(r.removed).toEqual(['text_card']);
    expect(r.sections).toHaveLength(2);
    expect((r.sections[0].props as any).body).toBe('전 품목 30% 할인');
    expect((r.sections[1].props as any).body).toContain('30% 할인');
  });
});

describe('A-10b fillOutreachDmMedia (재료 채우기 · 묶음마다 다른 재료)', () => {
  const media = {
    posterUrl: 'https://hanjul.ai/p.jpg',
    gallery: ['https://hanjul.ai/g1.jpg', 'https://hanjul.ai/g2.jpg', 'https://hanjul.ai/g3.jpg', 'https://hanjul.ai/g4.jpg', 'https://hanjul.ai/g5.jpg'],
    products: Array.from({ length: 4 }, (_, i) => ({ name: `상품${i}`, price: 10000 + i, discount_price: null, image_url: `https://hanjul.ai/pr${i}.jpg`, link_url: `https://b.com/p/${i}` })),
    ctaLinks: { '쿠폰': 'https://b.com/coupon' },
    homepageUrl: 'https://b.com/',
    legal: { legal: '사업자등록번호 123-45-67890 | 대표 홍길동', csPhone: '1588-1234' },
    companyName: '브랜드',
  };
  const sections = [
    sec('header', {}, 0), sec('hero', { headline: 'h' }, 1), sec('gallery', { title: 'g1' }, 2), sec('product_carousel', { title: 'p1' }, 3),
    sec('gallery', { title: 'g2' }, 4), sec('product_carousel', { title: 'p2' }, 5), sec('cta', { buttons: [{ label: '쿠폰 받기' }, { label: '더 보기' }] }, 6),
    sec('countdown', { urgency_text: 'x', end_datetime: '9월 30일' }, 7), sec('footer', {}, 8),
  ];
  it('DM: hero=홈 첫 배너 · 포스터는 히어로 다음 자기 블록(★0906(2)) · 헤더 워드마크 lg(로고 없으면 글자만) · 갤러리 2장씩 통째(list_1xN · 제목 0) · 상품은 첫 묶음에 최대 6개 · CTA 1개면 첫 상품 묶음 뒤에 1개 삽입 · 마감일 없는 countdown 제거 · footer 법정 표기', () => {
    const r = fillOutreachDmMedia(sections, media, 'DM');
    const p = (i: number) => r.sections[i].props as any;
    expect(r.sections.map((s) => s.type)).toEqual(['header', 'hero', 'gallery', 'gallery', 'product_carousel', 'cta', 'gallery', 'product_carousel', 'cta', 'footer']);
    expect(r.sections.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p(0)).toMatchObject({ brand_name: '브랜드', brand_size: 'lg', align: 'center' });
    expect(p(0).logo_url).toBeUndefined();
    expect(p(1)).toMatchObject({ image_url: media.gallery[0] }); // 홈 첫 배너(문서 순서)
    expect(p(1).image_fit).toBeUndefined();
    expect(p(1).height).toBeUndefined();
    // ★ 0906(2) 포스터(3:4) = 히어로 다음 자기 블록 1장 · 배너 갤러리에 섞지 않는다 · 캡션 없으면 alt = 업체명
    expect(r.sections[2].id).toMatch(/^so-poster-\d+-gallery$/);
    expect(p(2).images.map((x: any) => x.url)).toEqual([media.posterUrl]);
    expect(p(2).images[0].alt).toBe('브랜드');
    expect(p(2).images[0].caption).toBeUndefined();
    expect(p(3).images.map((x: any) => x.url)).toEqual([media.gallery[1], media.gallery[2]]);
    expect(p(3).layout).toBe('list_1xN');
    expect(p(3).title).toBe('');
    expect(p(3).images[0].alt).toBe('브랜드 이미지');
    expect(p(3).images.every((x: any) => x.link_url === 'https://b.com/')).toBe(true); // 코너 딥링크 없음 → 홈(C2-1)
    expect(p(6).images.map((x: any) => x.url)).toEqual(media.gallery.slice(3, 5));
    expect(p(4).products).toHaveLength(4);
    expect(p(4).image_fit).toBe('contain'); // 상품 사진은 잘리지 않는다(0905(3) 잘림 정정)
    expect(p(4).products[0]).toMatchObject({ name: '상품0', link_url: 'https://b.com/p/0' });
    expect(p(7).products).toEqual([]);
    // 삽입 CTA: 쿠폰 딥링크는 원래 CTA가 쓴다 → 홈 · 라벨은 코드 기본
    expect(p(5).buttons).toEqual([{ label: '전체 상품 보기', url: 'https://b.com/', style: 'primary' }]);
    expect(r.sections[5].id).toMatch(/^so-auto-\d+-cta$/);
    expect(p(8).buttons[0]).toMatchObject({ label: '쿠폰 받기', url: 'https://b.com/coupon' });
    expect(p(8).buttons[1].url).toBe('https://b.com/');
    expect(p(9)).toMatchObject({ legal_text: media.legal.legal, cs_phone: '1588-1234', show_unsubscribe_link: true });
    // 모델이 notes에 옮겨 적은 법정 표기는 비운다(legal_text와 3중 표기 방지) · 안내 문장은 남는다
    const dup = fillOutreachDmMedia([sec('footer', { notes: '대표 홍길동 | 사업자등록번호 123-45-67890' }, 0), sec('footer', { notes: '본 안내는 예시입니다' }, 1)], media, 'DM');
    expect((dup.sections[0].props as any).notes).toBe('');
    expect((dup.sections[1].props as any).notes).toBe('본 안내는 예시입니다');
  });
  it('캐러셀 제목 꼬리 문장부호 제거 · 상품 8개면 두 묶음(6+2) · CTA가 이미 2개면 삽입 0', () => {
    const many = { ...media, products: Array.from({ length: 8 }, (_, i) => ({ name: `상품${i}`, price: 1000 + i, discount_price: null, image_url: `https://hanjul.ai/q${i}.jpg`, link_url: `https://b.com/q/${i}` })) };
    const r = fillOutreachDmMedia([sec('product_carousel', { title: '블랙티 앰플 라인.' }, 0), sec('cta', { buttons: [{ label: '보기' }] }, 1), sec('product_carousel', { title: '클렌징 & 마스크!' }, 2), sec('cta', { buttons: [{ label: '더 보기' }] }, 3)], many, 'DM');
    expect(r.sections.map((s) => s.type)).toEqual(['product_carousel', 'cta', 'product_carousel', 'cta']);
    expect((r.sections[0].props as any).title).toBe('블랙티 앰플 라인');
    expect((r.sections[0].props as any).products).toHaveLength(6);
    expect((r.sections[2].props as any).title).toBe('클렌징 & 마스크');
    expect((r.sections[2].props as any).products).toHaveLength(2);
  });
  it('countdown은 실재하는 미래 종료일이 있을 때만 남는다', () => {
    const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10) + 'T23:59:00';
    const r = fillOutreachDmMedia([sec('countdown', { urgency_text: '마감 임박', end_datetime: future }, 0), sec('countdown', { urgency_text: 'x', end_datetime: '2020-01-01T00:00:00' }, 1)], media, 'DM');
    expect(r.sections.map((s) => (s.props as any).end_datetime)).toEqual([future]);
  });
  it('EMAIL: hero=갤러리 첫 장(contain · lg) · 포스터 = 히어로 다음 자기 블록 · 갤러리 2장씩 · 헤더 좌측+로고 · 라벨 8자 · 수신거부 링크 off · 삽입 CTA도 8자', () => {
    const r = fillOutreachDmMedia(sections, { ...media, logoUrl: 'https://hanjul.ai/logo.png' }, 'EMAIL');
    const p = (i: number) => r.sections[i].props as any;
    expect(r.sections.map((s) => s.type)).toEqual(['header', 'hero', 'gallery', 'gallery', 'product_carousel', 'cta', 'gallery', 'product_carousel', 'cta', 'footer']);
    expect(p(0)).toMatchObject({ variant: 'logo', align: 'left', logo_url: 'https://hanjul.ai/logo.png', logo_size: 'md' });
    expect(p(0).brand_size).toBeUndefined();
    expect(p(1)).toMatchObject({ image_url: media.gallery[0], image_fit: 'contain', height: 'lg' });
    expect(p(2).images.map((x: any) => x.url)).toEqual([media.posterUrl]);
    expect(p(3).images.map((x: any) => x.url)).toEqual([media.gallery[1], media.gallery[2]]);
    expect(p(6).images.map((x: any) => x.url)).toEqual(media.gallery.slice(3, 5));
    expect(p(5).buttons[0].label.length).toBeLessThanOrEqual(8);
    expect(p(8).buttons[0].label.length).toBeLessThanOrEqual(8);
    expect(p(9).show_unsubscribe_link).toBe(false);
  });
  it('갤러리 = 문서 순서 그대로(홈 첫 배너 = 히어로 · 포스터 = 두 번째) · 가로형 EMAIL 히어로 = md 박스 · 갤러리 링크 = 기획전 딥링크', () => {
    const gal = [
      { url: 'https://hanjul.ai/sq1.jpg', width: 800, height: 800 }, { url: 'https://hanjul.ai/land1.jpg', width: 1600, height: 900 },
      { url: 'https://hanjul.ai/land2.jpg', width: 1500, height: 1000 }, { url: 'https://hanjul.ai/sq2.jpg', width: 900, height: 900 },
      { url: 'https://hanjul.ai/port1.jpg', width: 800, height: 1400 }, { url: 'https://hanjul.ai/land3.jpg', width: 1400, height: 900 },
    ];
    const m = { ...media, posterUrl: null, gallery: gal, ctaLinks: { '기획전': 'https://b.com/plan', '쿠폰': 'https://b.com/coupon' } };
    const secs = [sec('hero', { headline: 'h' }, 0), sec('gallery', {}, 1), sec('gallery', {}, 2), sec('gallery', {}, 3)];
    const r = fillOutreachDmMedia(secs, m, 'EMAIL');
    const p = (i: number) => r.sections[i].props as any;
    // CTA가 0개 → 첫 갤러리 뒤에 코드가 1개 끼운다(기획전 딥링크)
    expect(r.sections.map((s) => s.type)).toEqual(['hero', 'gallery', 'cta', 'gallery', 'gallery']);
    expect(p(2).buttons[0]).toMatchObject({ label: '기획전 보기', url: 'https://b.com/plan' });
    expect(p(0)).toMatchObject({ image_url: 'https://hanjul.ai/sq1.jpg', image_fit: 'contain', height: 'lg' }); // 문서 첫 장(정사각 → lg 박스)
    expect(p(1).images.map((x: any) => x.url)).toEqual(['https://hanjul.ai/land1.jpg', 'https://hanjul.ai/land2.jpg']);
    expect(p(3).images.map((x: any) => x.url)).toEqual(['https://hanjul.ai/sq2.jpg', 'https://hanjul.ai/port1.jpg']);
    expect(p(4).images).toEqual([]);                                                                                // 남은 1장 = 2장 미만 → 비움
    expect(p(1).images[0].link_url).toBe('https://b.com/plan');
    // 가로형이 첫 장이면 EMAIL 히어로는 낮은 박스(md)
    const wide = fillOutreachDmMedia([sec('hero', { headline: 'h' }, 0)], { ...m, gallery: [gal[1]] }, 'EMAIL');
    expect((wide.sections[0].props as any)).toMatchObject({ image_fit: 'contain', height: 'md' });
    const dm = fillOutreachDmMedia(secs, { ...m, posterUrl: 'https://hanjul.ai/poster.jpg', posterSize: { width: 1792, height: 2400 }, posterCaption: '풍성한 한가위 보름달 혜택' }, 'DM');
    expect((dm.sections[0].props as any).image_url).toBe('https://hanjul.ai/sq1.jpg'); // 배너가 있으면 히어로는 배너
    // ★ 0906(2) 포스터 = 히어로 다음 자기 블록(캡션 = 포스터 title) · 배너 갤러리는 16:9 만
    expect((dm.sections[1].props as any).images.map((x: any) => x.url)).toEqual(['https://hanjul.ai/poster.jpg']);
    expect((dm.sections[1].props as any).images[0].caption).toBe('풍성한 한가위 보름달 혜택');
    expect((dm.sections[2].props as any).images.map((x: any) => x.url)).toEqual(['https://hanjul.ai/land1.jpg', 'https://hanjul.ai/land2.jpg']);
  });
  it('이미지 잘림 정정: DM 세로형 사진 히어로 = contain · 정사각 = 미지정 · EMAIL은 항상 contain · 포스터는 맞춤 없음(split)', () => {
    const port = [{ url: 'https://hanjul.ai/port.jpg', width: 800, height: 1200 }, { url: 'https://hanjul.ai/sq.jpg', width: 900, height: 900 }];
    const r = fillOutreachDmMedia([sec('hero', { headline: 'h' }, 0)], { ...media, posterUrl: null, gallery: port }, 'DM');
    expect((r.sections[0].props as any)).toMatchObject({ image_url: 'https://hanjul.ai/port.jpg', image_fit: 'contain' }); // DM 세로형 사진 = contain
    const sq = fillOutreachDmMedia([sec('hero', { headline: 'h' }, 0)], { ...media, posterUrl: null, gallery: [port[1]] }, 'DM');
    expect((sq.sections[0].props as any).image_fit).toBeUndefined(); // DM 정사각 = 미지정
    const em = fillOutreachDmMedia([sec('hero', { headline: 'h' }, 0)], { ...media, posterUrl: null, gallery: [port[1]] }, 'EMAIL');
    expect((em.sections[0].props as any).image_fit).toBe('contain'); // EMAIL은 고정 박스라 항상 contain
    const poster = fillOutreachDmMedia([sec('hero', { headline: 'h' }, 0)], { ...media, posterUrl: 'https://hanjul.ai/poster.jpg', posterSize: { width: 1792, height: 2400 }, gallery: [] }, 'DM');
    expect((poster.sections[0].props as any)).toMatchObject({ image_url: 'https://hanjul.ai/poster.jpg' }); // 배너가 없을 때만 포스터가 히어로 · 룩이 split → 맞춤 불필요
    expect((poster.sections[0].props as any).image_fit).toBeUndefined();
  });
  it('C2-2 CTA 같은 URL 재바인딩: 앞 CTA와 겹치면 남은 딥링크 → 홈 → 버튼 제거(첫 버튼은 유지)', () => {
    const m = { ...media, ctaLinks: { '쿠폰': 'https://b.com/coupon', '이벤트': 'https://b.com/event' } };
    const secs = [
      sec('cta', { buttons: [{ label: '쿠폰 받기' }, { label: '더 보기' }] }, 0),     // coupon · home
      sec('cta', { buttons: [{ label: '쿠폰 받기' }, { label: '자세히 보기' }] }, 1),  // coupon 중복 → event · home 중복 → 제거
      sec('cta', { buttons: [{ label: '보기' }] }, 2),                              // home 중복 · 첫 버튼이라 유지
    ];
    const r = fillOutreachDmMedia(secs, m, 'DM');
    const b = (i: number) => (r.sections[i].props as any).buttons;
    expect(b(0).map((x: any) => x.url)).toEqual(['https://b.com/coupon', 'https://b.com/']);
    expect(b(1).map((x: any) => x.url)).toEqual(['https://b.com/event']);
    expect(b(1)[0].label).toBe('이벤트 보기');
    expect(b(2)).toHaveLength(1);
    expect(b(2)[0].url).toBe('https://b.com/');
  });
  it('sectionsFromAiJson — 허용 타입만 · 기본 props 병합', () => {
    const out = sectionsFromAiJson({ sections: [{ type: 'hero', props: { headline: 'x' } }, { type: 'roulette', props: {} }, { type: 'gallery' }] }, ['hero', 'gallery'], 'so');
    expect(out.map((s) => s.type)).toEqual(['hero', 'gallery']);
    expect((out[1].props as any).layout).toBe('grid_2x2');
    expect(sectionsFromAiJson(null, ['hero'], 'so')).toEqual([]);
  });
});

describe('프롬프트 조립(순수)', () => {
  const gen = {
    companyName: '브랜드', industry: 'beauty', homepageUrl: 'https://b.com/', siteTitle: '브랜드 공식몰',
    material: '제주 자연 스킨케어. 블랙티 앰플 30mL.', extraNotes: '담당자 요청: 세일 언급 금지',
    products: [{ name: '블랙티 앰플', price: 45000, discount_price: 40000 }, { name: '클렌징 밤', price: 22000, discount_price: null }],
    galleryCount: 5,
  };
  it('재료 용량·상품 목록·추가 정보·참고 구성 순서가 실린다', () => {
    const u = buildOutreachMaterialBlock({ ...gen, skeletonTypes: ['header', 'hero', 'cta'] }, '설계하라.', 'DM');
    expect(u).toContain('gallery 최대 2개');
    expect(u).toContain('product_carousel 최대 1개');
    expect(u).toContain('[수집한 상품 2개');
    expect(u).toContain('[담당자 추가 정보]');
    expect(u).toContain('[참고 구성 순서] header → hero → cta');
    expect(u).toContain('상품에 혜택가가 있다');
    const p = buildDmSectionsPrompt(gen);
    expect(p.system).toContain('[예시]');
    expect(p.system).toContain('[절대 규칙]');
    expect(p.system).not.toMatch(/sonnet|opus|haiku|claude|gpt-/i);
    expect(p.exemplars.picked).toBeGreaterThan(0);
    expect(p.exemplars.picked).toBeLessThanOrEqual(5);
  });
  it('원천(source)을 주면 그 예시가 [예시] 블록에 실리고 picked·total은 실린 수·원천 전량이다(DB 학습 배선 계약)', () => {
    const source = { 'DM:beauty': ['[예시 · DM · beauty]\n  1. header\n  2. hero\n    headline: 원천주입표식AAA'], 'EMAIL:beauty': ['[예시 · EMAIL · beauty] 제목: 원천주입표식BBB\n  1. header'] };
    const p = buildDmSectionsPrompt(gen, source);
    expect(p.system).toContain('원천주입표식AAA');
    expect(p.exemplars).toEqual({ picked: 1, total: 1 });
    const e = buildEmailSectionsPrompt(gen, source);
    expect(e.system).toContain('원천주입표식BBB');
    expect(e.system).not.toContain('원천주입표식AAA');
    expect(e.exemplars).toEqual({ picked: 1, total: 1 });
  });
  it('상품 0 · 이미지 0이면 넣지 말라는 문구', () => {
    const u = buildOutreachMaterialBlock({ ...gen, products: [], galleryCount: 0 }, 'x', 'EMAIL');
    expect(u).toContain('[수집한 상품] 없음');
    expect(u).toContain('gallery 최대 0개');
  });
});

describe('A-2 제안 메일 조립', () => {
  const guide = getActiveStyleGuide();
  const base: ProposalEmailInput = {
    companyName: '브랜드', industry: 'beauty', selectedEvent: null,
    copyBody: '(광고) 브랜드 소식\n{{DM_LINK}}', posterUrl: 'https://hanjul.ai/p.jpg',
    dmUrl: 'https://hlj.kr/abc', previewUrl: 'https://hanjul.ai/api/outreach/v/0123456789',
    unsubscribeNotice: '수신거부는 회신으로 알려주세요',
    brandSections: [sec('header', { brand_name: '브랜드' }, 0), sec('hero', { headline: '제주의 힘' }, 1)],
    subject: '브랜드 맞춤 마케팅 시안이 도착했습니다', intro: '홈페이지에서 블랙티 앰플을 보았습니다.',
    now: new Date('2026-09-05T03:00:00Z'),
  };
  it('buildProposalEmailSections 본문에 한글 문자열 리터럴이 없다(문구는 emailCopy)', () => {
    const src = readFileSync(resolve(__dirname, '../sales-outreach-produce.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    const start = src.indexOf('export function buildProposalEmailSections(');
    const end = src.indexOf('\nexport function ', start + 10);
    const body = src.slice(start, end);
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toMatch(/['"`][^'"`\n]*[가-힣][^'"`\n]*['"`]/);
  });
  it('emailCopy 함수형 문구는 업체명 직후에 조사를 붙이지 않는다', () => {
    const c = guide.emailCopy;
    for (const f of [c.subjectDefault, c.preheader, c.introDefault, c.hero.headlineNoImage, c.sample.headline]) {
      for (const name of ['한줄로', '인비토']) {
        const s = f(name);
        const after = s.slice(s.indexOf(name) + name.length, s.indexOf(name) + name.length + 1);
        expect(['을', '를', '이', '가', '은', '는', '과', '와'], `${s}`).not.toContain(after);
      }
    }
  });
  it('히어로 분할 구도 + contain · 흰 글자색 고정 없음 · 브랜드 시안·CTA·푸터 순서', () => {
    const s = buildProposalEmailSections(guide, base);
    const hero = s[1] as any;
    expect(hero.type).toBe('hero');
    expect(hero.treatment).toBe('split');
    expect(hero.props.image_fit).toBe('contain');
    expect(hero.props.headline_color).toBeUndefined();
    expect(hero.props.headline).toBe(guide.emailCopy.hero.headline);
    const types = s.map((x) => x.type);
    expect(types.slice(0, 4)).toEqual(['header', 'hero', 'text_card', 'text_card']);
    expect(types).toContain('cta');
    expect(types[types.length - 1]).toBe('footer');
    expect(s.every((x, i) => (x as any).order === i)).toBe(true);
    const cta = s.find((x) => x.type === 'cta') as any;
    expect(cta.props.buttons.map((b: any) => b.url)).toEqual([base.previewUrl, base.dmUrl]);
    const footer = s[s.length - 1] as any;
    expect(footer.props.notes).toContain('2026-09-05');
    expect(footer.props.notes).toContain(base.unsubscribeNotice);
    const noImg = buildProposalEmailSections(guide, { ...base, posterUrl: null })[1] as any;
    expect(noImg.props.headline).toBe(guide.emailCopy.hero.headlineNoImage('브랜드'));
  });
  it('assembleProposalEmail — html·평문에 링크·수신거부 문구 · placeholder 합산(제목 포함)', () => {
    const r = assembleProposalEmail(base);
    expect(r.html).toContain(base.previewUrl);
    expect(r.html).toContain(base.dmUrl);
    expect(r.html).toContain('수신거부는 회신으로');
    expect(r.html).not.toContain('/api/sales-outreach');
    expect(r.text).toContain(base.previewUrl);
    expect(r.placeholderCount).toBe(0);
    // ★ 0906(3) 문안의 자리표시자 문장은 메일·공개 페이지에서 빼고 조립한다(노출 0) → html 에는 남지 않고 제목의 것만 센다(제목은 사람이 고친다 · 잠금 유지)
    const r2 = assembleProposalEmail({ ...base, subject: `${BENEFIT_PLACEHOLDER} 시안`, copyBody: `${BENEFIT_PLACEHOLDER} 문안 {{DM_LINK}}` });
    expect(r2.placeholderCount).toBe(1);
    expect(r2.html).not.toContain(BENEFIT_PLACEHOLDER);
    expect(countBenefitPlaceholders(`${BENEFIT_PLACEHOLDER}a${BENEFIT_PLACEHOLDER}`)).toBe(2);
    expect(buildOutreachPlainText(guide, base)).toContain(base.subject);
  });
});

describe('generateSubjectIntro 40자 규칙', () => {
  const guide = getActiveStyleGuide();
  const input = { companyName: '브랜드', industry: 'beauty', selectedEvent: null, promptMaterial: '재료' };
  it('41자 제목 → 기본 제목(절단 금지) · 서두는 채택', async () => {
    aiMock.mockResolvedValueOnce(JSON.stringify({ subject: '가'.repeat(41), intro: '홈페이지에서 본 것을 적었습니다.' }));
    const r = await generateSubjectIntro(guide, input);
    expect(r.subject).toBe(guide.emailCopy.subjectDefault('브랜드'));
    expect(r.intro).toBe('홈페이지에서 본 것을 적었습니다.');
    expect(r.generated).toBe(true);
  });
  it('미면허 수치가 든 제목 → 기본 제목 · 서두 수치는 placeholder로 세어진다', async () => {
    aiMock.mockResolvedValueOnce(JSON.stringify({ subject: '전 품목 30% 할인 시안', intro: '지금 20% 세일 중이라 만들었습니다.' }));
    const r = await generateSubjectIntro(guide, input);
    expect(r.subject).toBe(guide.emailCopy.subjectDefault('브랜드'));
    expect(r.subjectPlaceholders).toBe(0);
    expect(r.introPlaceholders).toBe(1);
  });
  it('AI 실패 → 기본 제목·기본 서두', async () => {
    aiMock.mockRejectedValueOnce(new Error('down'));
    const r = await generateSubjectIntro(guide, input);
    expect(r.subject).toBe(guide.emailCopy.subjectDefault('브랜드'));
    expect(r.intro).toBe(guide.emailCopy.introDefault('브랜드'));
    expect(r.generated).toBe(false);
  });
  it('프롬프트에 재료 블록이 실린다', () => {
    const p = buildEmailIntroPrompt(guide, { ...input, promptMaterial: '블랙티 앰플 라인업' });
    expect(p.user).toContain('[홈페이지에서 읽은 내용]');
    expect(p.user).toContain('블랙티 앰플 라인업');
  });
});
