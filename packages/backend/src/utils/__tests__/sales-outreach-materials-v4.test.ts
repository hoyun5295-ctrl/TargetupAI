import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { findPromoPageLinks, eventCandidatesFromCards } from '../sales-outreach-jobs';
import { extractRenderedProductCards, type OutreachEventCard } from '../sales-outreach-media';
import { shouldEscalateToRender } from '../sales-outreach-render';

/**
 * ★ 2026-09-09 재료 축 v4 — 브랜드가 이미 만든 것을 전부 가져온다(설계서 §19).
 *   ① 홈 내비·배너가 링크한 프로모션·기획 페이지 후보(findPromoPageLinks) ② 렌더 DOM 의 상품 카드(가격 없어도 · extractRenderedProductCards)
 *   ③ 홈 게시 = 진행 중(면허 · eventCandidatesFromCards homeLinked) ④ 렌더는 항상(shouldEscalateToRender 는 사유만).
 */
const HOME = 'https://www.toun28.com/';

describe('findPromoPageLinks — 홈에 걸린 프로모션·기획 페이지 후보', () => {
  const html = `
    <nav><a href="/renew/product">전체상품</a><a href="/promotion/benefit">혜택</a><a href="/renew/mission/main">미션</a></nav>
    <a href="/promotion/product/peptacica"><img src="/x.jpg"></a>
    <a href="/renew/product/1367">히알시카</a>
    <a href="/event/event_list">이벤트 목록</a>
    <a href="https://other.example/event/1">외부</a>
    <a href="mailto:a@b.c">메일</a>
    <a href="/member/login">로그인</a>
    <a href="/promotion/benefit#top">혜택 다시</a>
    <a href="/plan/autumn">가을 기획전</a>
    <a href="/about">회사소개</a>`;
  it('경로·문구가 행사성인 같은 호스트 링크만 · 목록 페이지·상품·로그인·외부·중복 제외 · 문서 순서 · 상한', () => {
    const links = findPromoPageLinks(html, HOME);
    expect(links).toEqual([
      'https://www.toun28.com/promotion/benefit',
      'https://www.toun28.com/promotion/product/peptacica',
      'https://www.toun28.com/plan/autumn',
    ]);
    expect(findPromoPageLinks(html, HOME, ['https://www.toun28.com/promotion/benefit'])).toEqual([
      'https://www.toun28.com/promotion/product/peptacica',
      'https://www.toun28.com/plan/autumn',
    ]);
    expect(findPromoPageLinks(html, HOME, [], 1)).toHaveLength(1);
  });
  it('문구만 행사성이어도 후보다(경로가 일반형) · 홈 자기 링크 제외', () => {
    const h = `<a href="/special/2026">추석 기획전</a><a href="/">홈</a><a href="/collection/x">신상 컬렉션</a>`;
    expect(findPromoPageLinks(h, HOME)).toEqual(['https://www.toun28.com/special/2026', 'https://www.toun28.com/collection/x']);
  });
  it('톤28 홈 실물 HTML — /promotion/benefit · /promotion/product/peptacica 가 후보 · 상품 상세는 제외', () => {
    const html = readFileSync(resolve(__dirname, 'fixtures', 'toun28-home.html'), 'utf-8');
    const links = findPromoPageLinks(html, HOME);
    expect(links).toContain('https://www.toun28.com/promotion/benefit');
    expect(links).toContain('https://www.toun28.com/promotion/product/peptacica');
    expect(links.some((u) => /\/renew\/product\/\d+/.test(u))).toBe(false);
    expect(links.length).toBeLessThanOrEqual(4);
  });
});

describe('extractRenderedProductCards — 렌더 DOM 의 상품 카드(가격이 없어도 · 이름은 alt · 일반 alt 는 앵커 문구 폴백)', () => {
  const html = `
    <ul>
      <li><a href="/renew/product/1367"><img src="https://cdn/1367/hyal.png" alt="히알시카 수분진정 SET : 히알시카 세럼 + 히알시카 크림"></a></li>
      <li><a href="/renew/product/1885"><img src="https://cdn/1885/sun.png" alt="펩타시카 선세럼 + 펩타시카 선BB"><span>36,000원</span><span>40,000원</span></a></li>
      <li><a href="/renew/product/1598"><img src="https://cdn/1598/pepta.png" alt="베스트 셀러 이미지"><div class="name">펩타이드 새벽 시카크림 50g</div></a></li>
      <li><a href="/renew/product/1579"><img src="https://cdn/1579/x.png" alt="베스트 셀러 이미지"></a></li>
      <li><a href="/renew/product/1367"><img src="https://cdn/1367/hyal.png" alt="히알시카 수분진정 SET : 히알시카 세럼 + 히알시카 크림"></a></li>
      <li><a href="/renew/mission/main"><img src="https://cdn/mission.png" alt="톤28 크루"></a></li>
      <li><a href="https://other.example/product/9"><img src="https://cdn/9.png" alt="남의 상품"></a></li>
      <li><a href="/renew/product/2000"><img src="https://cdn/logo.png" alt="로고 상품"></a></li>
    </ul>`;
  it('상품 링크 + img 가 있는 앵커만 · 이름 · 가격(있으면) · 같은 링크 1번 · 같은 호스트 · 로고 이미지 제외', () => {
    const cards = extractRenderedProductCards(html, HOME);
    expect(cards.map((c) => [c.name, c.price, c.discount_price, c.link_url])).toEqual([
      ['히알시카 수분진정 SET : 히알시카 세럼 + 히알시카 크림', null, null, 'https://www.toun28.com/renew/product/1367'],
      ['펩타시카 선세럼 + 펩타시카 선BB', 40000, 36000, 'https://www.toun28.com/renew/product/1885'],
      ['펩타이드 새벽 시카크림 50g', null, null, 'https://www.toun28.com/renew/product/1598'],
    ]);
    expect(cards[0].image_url).toBe('https://cdn/1367/hyal.png');
  });
  it('상한 · 빈 HTML', () => {
    expect(extractRenderedProductCards(html, HOME, 1)).toHaveLength(1);
    expect(extractRenderedProductCards('', HOME)).toEqual([]);
  });
  it('★ v4-2 "원" 없는 몰 — 카드 문구 끝의 천 단위 숫자만 가격 · 이름에서 뗀다 · 리뷰 수 뒤 숫자는 가격이 아니다', () => {
    const h = `
      <a href="/renew/product/1598"><img src="https://cdn/1598.png" alt="베스트 셀러 이미지"><div>펩타시카 새벽크림 2.0 50g 34,200</div></a>
      <a href="/renew/product/1579"><img src="https://cdn/1579.png" alt="베스트 셀러 이미지"><div>펩타시카 크림 인텐시브 50g</div><div>45,000 40,500</div></a>
      <a href="/renew/product/1584"><img src="https://cdn/1584.png" alt="베스트 셀러 이미지"><div>펩타시카 토너 250ml</div><div>리뷰 1,234</div></a>`;
    const cards = extractRenderedProductCards(h, HOME);
    expect(cards.map((c) => [c.name, c.price, c.discount_price])).toEqual([
      ['펩타시카 새벽크림 2.0 50g', 34200, null],
      ['펩타시카 크림 인텐시브 50g', 45000, 40500],
      ['펩타시카 토너 250ml', null, null],
    ]);
  });
});

describe('eventCandidatesFromCards — 홈 게시 = 진행 중(종료일이 없을 때만 · 있으면 종료일이 이긴다)', () => {
  const card = (over: Partial<OutreachEventCard>): OutreachEventCard => ({ title: '펩타시카 이야기', periodRaw: null, startDate: null, endDate: null, imageUrl: 'https://c/s1.jpg', linkUrl: 'https://www.toun28.com/promotion/product/peptacica', order: 0, ...over });
  it('promo_page + homeLinked + 종료일 없음 = 면허 · source 가 후보에 실린다', () => {
    const [c] = eventCandidatesFromCards([card({ source: 'promo_page', homeLinked: true })], HOME);
    expect(c.benefitLicensed).toBe(true);
    expect(c.origin).toBe('card');
    expect(c.source).toBe('promo_page');
    expect(c.detailUrl).toBe('https://www.toun28.com/promotion/product/peptacica');
  });
  it('homeLinked 여도 종료일이 지났으면 후보에서 빠진다 · 종료일 없는 목록 카드(homeLinked 없음)는 면허 없음 그대로', () => {
    expect(eventCandidatesFromCards([card({ source: 'promo_page', homeLinked: true, endDate: '2000-01-01' })], HOME)).toEqual([]);
    const [c] = eventCandidatesFromCards([card({})], HOME);
    expect(c.benefitLicensed).toBe(false);
    expect(c.source).toBeUndefined();
  });
});

describe('shouldEscalateToRender — 사유 판정은 그대로(항상 렌더는 크롤 단계가 소유)', () => {
  it('두꺼운 정적 = 사유 0 · 얇으면 사유', () => {
    expect(shouldEscalateToRender({ products: 10, imageCandidates: 5, textChars: 5000, discountPairs: 3 } as any)).toEqual({ escalate: false, reasons: [] });
    expect(shouldEscalateToRender(null).reasons).toEqual(['static_unavailable']);
  });
});
