/**
 * sales-outreach-v3.test.ts — 2026-09-06 v3 브랜드 페이지 재구성 엔진(설계서 docs/2026-09-06-outreach-v3-brand-page-recomposition-design.md §12-3)
 *  재료 층(이벤트 목록 카드 · 카드 후보 · 링크 정렬) · 선택 층(정규화 · 카드→엔진) · 조립 층(gallery 0 · 카드 헤드라인 · 히어로 자격 · 블록 최소 요건 · 계약 2벌)
 *  · 전사 가드 · 자동 재조립 트리거 · 채점 12항목 파리티 · 이미지 text_card 렌더 파리티 · AI 계수 · 회신 문장.
 * DB·AI·네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { extractEventListCards, parseProductAwards, collectProductsFromLinks } from '../sales-outreach-media';
import {
  parseLicensedEndDate, findEventPageLink, eventCandidatesFromCards, normalizeEventSelection, eventCardsOf, buildOutreachRecipe, OUTREACH_EVENT_SELECT_MAX,
} from '../sales-outreach-jobs';
import {
  fillOutreachDmMedia, headlineFromCard, eventCtaLabel, assertBlockMinima, OUTREACH_BLOCK_MINIMA, OUTREACH_SECTION_MAX, insertProofCard,
  licensedLineOf, assertLicensedQuoteSources, autoRetryReasons, productFactKeys, DM_VISION_ITEMS, addOutreachAiCost, newOutreachAiCost, replyLineOf, OUTREACH_REPLY_LINE_MAX,
  buildOutreachMaterialBlock,
} from '../sales-outreach-produce';
import { dmSectionContract, dmAllowedTypes, OUTREACH_DM_TYPES, OUTREACH_DM_TYPES_OUTREACH } from '../sales-outreach-exemplars';
import { heroEligible, OUTREACH_HERO_MIN_RATIO, applyOutreachLook, buildOutreachBrandKit } from '../sales-outreach-look';
import { VISION_WARNING_OF, assessOutreachQuality, OUTREACH_QUALITY_THRESHOLDS, type OutreachQualityCode } from '../sales-outreach-review';
import { getActiveStyleGuide } from '../sales-outreach-style';
import { normalizeEditReason } from '../sales-outreach-jobs';
import { normalizeQuickEventCards, materialsFromEventCards, quoteQuickCampaign, QUICK_EVENT_CARDS_MAX, QUICK_EVENT_CARD_IMAGES } from '../campaign-quick';
import { rebuildDmPages } from '../dm/dm-section-prune';
import { renderDmViewerHtml } from '../dm/dm-viewer';
import type { Section } from '../dm/dm-section-registry';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8');
const sec = (type: string, props: Record<string, unknown>, order = 0): Section => ({ id: `s-${type}-${order}`, type, order, visible: true, props } as unknown as Section);

// ===== 재료 층 =====

const EVENT_LIST_HTML = `
<nav><a href="/">홈</a><a href="/shop/list">전체상품</a><a href="/board/event/list">이벤트</a></nav>
<div class="event-list">
  <ul>
    <li><a href="/board/event/view/101"><img src="/upload/ev101.jpg" alt=""><p class="tit">추석선물세트 특별 기획전~50%</p><p class="date">기간 : 2026.08.31 ~ 2099-09-18 08:59:59</p></a></li>
    <li><a href="/board/event/view/102"><img src="/upload/ev102.jpg"><p class="tit">고함량 50,000ppm 백광기미앰플 출시 이벤트</p><p class="date">2026-09-01 ~ 2099-09-30 13:59:59 까지</p></a></li>
    <li><a href="/board/event/view/103"><img src="/upload/ev103.jpg"><p class="tit">멤버십 위크</p><p class="date">기간 : 2025.01.01 ~ 2025.01.31</p></a></li>
    <li><a href="/board/event/view/104"><img src="/upload/ev104.jpg"><p class="tit">상시 진행 · 리뷰 적립</p></a></li>
    <li><a href="/board/event/view/101"><img src="/upload/ev101.jpg"><p class="tit">중복 링크 카드</p><p class="date">2026.09.01 ~ 2099.12.31</p></a></li>
    <li><a href="https://other.example/event/1"><img src="/upload/x.jpg"><p>타 호스트 2026.09.01 ~ 2099.12.31</p></a></li>
    <li><a href="/member/login"><img src="/upload/l.jpg"><p>로그인 2026.09.01 ~ 2099.12.31</p></a></li>
    <li><a href="/board/event/view/105"><img src="/upload/ev105.jpg"><p class="tit">가을 신상 오픈</p><p class="date">2026년 9월 10일부터 2099년 10월 31일까지</p></a></li>
  </ul>
</div>`;

describe('★ v3 재료 층 — 이벤트 목록 카드(순수 · AI 0)', () => {
  it('카드 = 제목·기간 원문·배너·링크 · 기간 없는 카드 제외 · 같은 링크·타 호스트·로그인 제외 · 순서 유지 · endDate 는 주입 파서', () => {
    const cards = extractEventListCards(EVENT_LIST_HTML, 'https://www.isoi.co.kr/', parseLicensedEndDate);
    expect(cards.map((c) => c.linkUrl)).toEqual([
      'https://www.isoi.co.kr/board/event/view/101', 'https://www.isoi.co.kr/board/event/view/102', 'https://www.isoi.co.kr/board/event/view/103', 'https://www.isoi.co.kr/board/event/view/105',
    ]);
    expect(cards[0]).toMatchObject({ title: '추석선물세트 특별 기획전~50%', startDate: '2026-08-31', endDate: '2099-09-18', imageUrl: 'https://www.isoi.co.kr/upload/ev101.jpg', order: 0 });
    expect(cards[0].periodRaw).toBe('기간 : 2026.08.31 ~ 2099-09-18 08:59:59');
    expect(cards[1]).toMatchObject({ title: '고함량 50,000ppm 백광기미앰플 출시 이벤트', endDate: '2099-09-30' });
    expect(cards[1].periodRaw).toBe('2026-09-01 ~ 2099-09-30 13:59:59 까지');
    expect(cards[2]).toMatchObject({ title: '멤버십 위크', endDate: '2025-01-31' });
    expect(cards[3]).toMatchObject({ title: '가을 신상 오픈', startDate: '2026-09-10', endDate: '2099-10-31' });
    expect(extractEventListCards('<div>없음</div>', 'https://a.com/', parseLicensedEndDate)).toEqual([]);
    expect(extractEventListCards(EVENT_LIST_HTML, 'not a url', parseLicensedEndDate)).toEqual([]);
  });
  it('카드 → 후보(origin card · quote = 제목 원문 · 면허 = 미래 종료일 · 면허 있음이 앞) · findPeriodNear 를 부르지 않는다(카드 자기 기간)', () => {
    const cards = extractEventListCards(EVENT_LIST_HTML, 'https://www.isoi.co.kr/', parseLicensedEndDate);
    const now = new Date('2026-09-06T00:00:00+09:00');
    const c = eventCandidatesFromCards(cards, 'https://www.isoi.co.kr/board/event/list', now);
    expect(c.map((x) => x.benefitLicensed)).toEqual([true, true, true, false]);
    expect(c[3]).toMatchObject({ quote: '멤버십 위크', origin: 'card', endDate: '2025-01-31', benefitLicensed: false });
    expect(c[0]).toMatchObject({ origin: 'card', title: '추석선물세트 특별 기획전~50%', bannerUrl: 'https://www.isoi.co.kr/upload/ev101.jpg', detailUrl: 'https://www.isoi.co.kr/board/event/view/101' });
    expect(c[0].periodRaw).toContain('2026.08.31');
  });
  it('행사 링크 정렬 — nav·header 안 링크 → 텍스트가 정확히 이벤트·기획전·프로모션 → 나머지 첫 매치(옛 동작)', () => {
    expect(findEventPageLink(EVENT_LIST_HTML, 'https://www.isoi.co.kr/')).toBe('https://www.isoi.co.kr/board/event/list');
    const noNav = `<a href="/event/autumn">가을 기획전 배너</a><a href="/promotion">프로모션</a>`;
    expect(findEventPageLink(noNav, 'https://a.com/')).toBe('https://a.com/promotion');
    expect(findEventPageLink('<a href="/event/x">가을 기획전</a>', 'https://a.com/')).toBe('https://a.com/event/x');
  });
  it('어워즈 조각 — 화이트리스트 낱말이 든 40자 조각 · 최대 3 · 중복 0 · 없으면 []', () => {
    const html = '<div>2025 올리브영 어워즈 앰플 부문 1위 수상 · 비건 인증 완료 · 누적 판매 100만개</div><p>어워즈 앰플 부문 1위 수상</p>';
    const a = parseProductAwards(html);
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(a.some((x) => x.includes('어워즈'))).toBe(true);
    expect(a.every((x) => x.length <= 40)).toBe(true);
    expect(parseProductAwards('<p>그냥 상품 설명</p>')).toEqual([]);
  });
  it('상품 상세 1홉 벽시계 — 예산 0 이면 첫 링크 전에 멈추고 timedOut', async () => {
    const r = await collectProductsFromLinks(['https://a.com/p/1'], 'a.com', 6, { deadlineMs: -1 });
    expect(r).toEqual({ products: [], timedOut: true });
  });
  it('상품 사실 키 — 있는 것만 · 범위 밖 할인율 제외 · 목록 값이 상세를 덧입힌다', () => {
    expect(productFactKeys({ badges: ['NEW'], rating: 4.9, review_count: 20389, discount_rate: 46 })).toEqual({ badges: ['NEW'], rating: 4.9, review_count: 20389, discount_rate: 46 });
    expect(productFactKeys({ badges: [], rating: 0, discount_rate: 120 })).toEqual({});
    expect(productFactKeys(null)).toEqual({});
    const detail = { name: '세럼', price: 149000, discount_price: 79000, image_url: 'u', link_url: 'l' };
    const list = { ...detail, discount_rate: 46, badges: ['SALE'] };
    expect({ ...detail, ...productFactKeys(list), ...productFactKeys(detail) }).toMatchObject({ discount_rate: 46, badges: ['SALE'] });
  });
});

// ===== 선택 층 =====

describe('★ v3 선택 층 — 다중 선택 정규화 · 카드 → 엔진', () => {
  it('eventIndexes 우선 · 정수·범위·중복 · 앞 3 · 단수 하위 호환 · 범위 밖은 dropped 로 센다', () => {
    expect(normalizeEventSelection({ eventIndex: null, eventIndexes: [2, 0, 2, 7, -1, 1.5, 1] }, 5)).toEqual({ indexes: [2, 0, 1], dropped: 3 });
    expect(normalizeEventSelection({ eventIndex: 1, eventIndexes: null }, 5)).toEqual({ indexes: [1], dropped: 0 });
    expect(normalizeEventSelection({ eventIndex: 9, eventIndexes: null }, 5)).toEqual({ indexes: [], dropped: 1 });
    expect(normalizeEventSelection({ eventIndex: null, eventIndexes: [0, 1, 2, 3] }, 5).indexes).toHaveLength(OUTREACH_EVENT_SELECT_MAX);
    expect(normalizeEventSelection({ eventIndex: null, eventIndexes: null }, 5)).toEqual({ indexes: [], dropped: 0 });
  });
  it('카드 후보 → 엔진 카드(origin card 만) · 배너 사본은 media.gallery 의 srcUrl 로 되찾는다 · 없으면 글자 카드', () => {
    const list = [
      { quote: 'A', sourceUrl: 'x', startDate: null, endDate: '2099-01-01', benefitLicensed: true, origin: 'card' as const, title: 'A 기획전', periodRaw: '2026.09.01 ~ 2099.01.01', bannerUrl: 'https://isoi.co.kr/ev.jpg', detailUrl: 'https://isoi.co.kr/ev/1' },
      { quote: 'B', sourceUrl: 'x', startDate: null, endDate: null, benefitLicensed: false, origin: 'crawl' as const },
      { quote: 'C', sourceUrl: 'x', startDate: null, endDate: null, benefitLicensed: false, origin: 'card' as const, title: 'C 이벤트', periodRaw: null, bannerUrl: 'https://isoi.co.kr/none.jpg', detailUrl: 'https://isoi.co.kr/ev/3' },
    ];
    const media = { gallery: [{ url: 'https://hanjul.ai/copy/ev.jpg', width: 1920, height: 800, bytes: 1, srcUrl: 'https://isoi.co.kr/ev.jpg' }], products: [], collectedAt: '', stats: {} } as any;
    const cards = eventCardsOf(list, media);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({ title: 'A 기획전', periodRaw: '2026.09.01 ~ 2099.01.01', endDate: '2099-01-01', bannerUrl: 'https://hanjul.ai/copy/ev.jpg', bannerSize: { width: 1920, height: 800 }, detailUrl: 'https://isoi.co.kr/ev/1', licensed: true });
    expect(cards[1]).toMatchObject({ title: 'C 이벤트', bannerUrl: null, bannerSize: null, licensed: false });
    expect(eventCardsOf([], null)).toEqual([]);
  });
});

// ===== 조립 층 =====

describe('★ v3 조립 층 — 계약 2벌 · 헤드라인 · 히어로 자격 · gallery 0 · 최소 요건 · 상한', () => {
  it('계약 · 허용 타입은 입구별(customer = 현행 문자열 · outreach = gallery 줄 0)', () => {
    expect(dmSectionContract('customer')).toContain('각 gallery 바로 앞에 1개씩');
    expect(dmSectionContract(undefined)).toBe(dmSectionContract('customer'));
    expect(dmSectionContract('outreach')).not.toContain('- gallery:');
    expect(dmSectionContract('outreach')).toContain('gallery 타입은 쓰지 마라');
    expect(dmAllowedTypes('outreach')).toEqual(OUTREACH_DM_TYPES_OUTREACH);
    expect(dmAllowedTypes('outreach')).not.toContain('gallery');
    expect(dmAllowedTypes('customer')).toEqual(OUTREACH_DM_TYPES);
    const block = buildOutreachMaterialBlock({ companyName: 'X', industry: null, homepageUrl: 'https://x.com', siteTitle: null, material: 'm', products: [], galleryCount: 3, entry: 'outreach', eventCards: [{ title: '추석 기획전', periodRaw: '2026.09.01 ~ 2099.09.30', endDate: '2099-09-30', bannerUrl: null, detailUrl: null, licensed: true }] }, 'want', 'DM');
    expect(block).toContain('[진행 중 행사 1건');
    expect(block).toContain('1. 추석 기획전 (기간: 2026.09.01 ~ 2099.09.30)');
    expect(block).toContain('gallery)은 넣지 마라');
    expect(block).not.toContain('gallery 최대');
  });
  it('headlineFromCard — 면허 있음 = 원문 18자 · 없음 = 수치·판촉 낱말 제거 · 6자 미만 = 강등 · CTA 라벨 ≤16', () => {
    expect(headlineFromCard({ title: '추석선물세트 특별 기획전~50%' }, true)).toEqual({ headline: '추석선물세트 특별 기획전~50%', demoted: false });
    expect(headlineFromCard({ title: '추석선물세트 특별 기획전~50%' }, false)).toEqual({ headline: '추석선물세트 특별 기획전', demoted: false });
    expect(headlineFromCard({ title: '최대 50% 할인' }, false)).toEqual({ headline: '', demoted: true });
    expect(headlineFromCard({ title: '1+1 특가' }, false).demoted).toBe(true);
    expect(headlineFromCard(null, true).demoted).toBe(true);
    expect(eventCtaLabel({ title: '추석선물세트 특별 기획전~50%' })).toBe('추석선물세트 특별 기획전 보기');
    expect(eventCtaLabel({ title: '고함량 50,000ppm 백광기미앰플 출시 이벤트' }).length).toBeLessThanOrEqual(16);
    expect(eventCtaLabel({ title: '최대 50%' })).toBe('행사 보기');
  });
  it('heroEligible — 비율 0.8 이상 · 미만 강등 · dims 없음 = false(fail-closed)', () => {
    const dims = { land: { width: 1920, height: 800 }, port: { width: 800, height: 1200 }, sq: { width: 1000, height: 1000 } };
    expect(OUTREACH_HERO_MIN_RATIO).toBe(0.8);
    expect(heroEligible('land', dims)).toBe(true);
    expect(heroEligible('sq', dims)).toBe(true);
    expect(heroEligible('port', dims)).toBe(false);
    expect(heroEligible('unknown', dims)).toBe(false);
    expect(heroEligible(null, dims)).toBe(false);
  });
  const media = {
    posterUrl: 'https://hanjul.ai/poster.jpg', posterSize: { width: 1792, height: 2400 }, posterCaption: '추석선물세트 특별 기획전',
    gallery: [
      { url: 'https://hanjul.ai/b1.jpg', width: 1920, height: 600, alt: '풍성한 한가위' },
      { url: 'https://hanjul.ai/b2.jpg', width: 1920, height: 600 },
      { url: 'https://hanjul.ai/b3.jpg', width: 1920, height: 600 },
    ],
    products: [
      { name: '세럼', price: 149000, discount_price: 79000, image_url: 'https://hanjul.ai/p1.jpg', link_url: 'https://b.com/p/1', width: 800, height: 800, awards: ['어워즈 앰플 1위'] },
      { name: '크림', price: 36000, discount_price: null, image_url: 'https://hanjul.ai/p2.jpg', link_url: 'https://b.com/p/2', width: 800, height: 800 },
      { name: '토너', price: 21000, discount_price: null, image_url: 'https://hanjul.ai/p3.jpg', link_url: 'https://b.com/p/3', width: 800, height: 800 },
      { name: '앰플', price: 51000, discount_price: null, image_url: 'https://hanjul.ai/p4.jpg', link_url: 'https://b.com/p/4', width: 800, height: 800 },
      { name: '팩', price: 12000, discount_price: null, image_url: 'https://hanjul.ai/p5.jpg', link_url: 'https://b.com/p/5', width: 800, height: 800 },
      { name: '쿠션', price: 32000, discount_price: null, image_url: 'https://hanjul.ai/p6.jpg', link_url: 'https://b.com/p/6', width: 800, height: 800 },
      { name: '립', price: 15000, discount_price: null, image_url: 'https://hanjul.ai/p7.jpg', link_url: 'https://b.com/p/7', width: 800, height: 800 },
    ] as any[],
    ctaLinks: { 기획전: 'https://b.com/plan' }, homepageUrl: 'https://b.com/', legal: null, companyName: '아이소이', licensedQuote: '149,000원 · 79,000원',
  };
  const modelSecs = [sec('header', {}, 0), sec('hero', { headline: '모델 헤드라인', sub_copy: '모델 부제' }, 1), sec('text_card', { tag: 'BRAND', headline: '착한 성분', body: '식물 유래' }, 2), sec('product_carousel', { title: '베스트' }, 3), sec('gallery', {}, 4), sec('cta', { buttons: [{ label: '전체 보기' }] }, 5), sec('footer', {}, 6)];
  it('fillOutreachDmMedia(…, outreach) — gallery 0 · so-lead 0 · so-poster(gallery) 0 · 포스터는 이미지 위 text_card · 스포트라이트(어워즈) + cta · 2+4 묶음(7개 중 스포트라이트 제외 6) · 카드 없으면 모델 헤드라인 유지', () => {
    const r = fillOutreachDmMedia(modelSecs, media as any, 'DM', 'outreach');
    const types = r.sections.map((s) => s.type);
    expect(types).not.toContain('gallery');
    expect(r.sections.some((s) => String(s.id).startsWith('so-lead-') || String(s.id).startsWith('so-poster-'))).toBe(false);
    const hero: any = r.sections[1];
    expect(hero.props.image_url).toBe('https://hanjul.ai/b1.jpg');
    expect(hero.props.headline).toBe('모델 헤드라인');
    const poster: any = r.sections.find((s) => String(s.id).startsWith('so-v3-poster'));
    expect(poster.type).toBe('text_card');
    expect(poster.props).toMatchObject({ image_url: 'https://hanjul.ai/poster.jpg', image_position: 'top', headline: '추석선물세트 특별 기획전' });
    const spot: any = r.sections.find((s) => String(s.id).startsWith('so-v3-spot-'));
    expect(spot.props).toMatchObject({ tag: '어워즈 앰플 1위', headline: '세럼', body: '79,000원 · 정가 149,000원', image_url: 'https://hanjul.ai/p1.jpg', image_position: 'left' });
    const spotCta: any = r.sections[r.sections.indexOf(spot) + 1];
    expect(spotCta.type).toBe('cta');
    expect(spotCta.props.buttons[0]).toMatchObject({ label: '세럼 보기', url: 'https://b.com/p/1' });
    const carousels = r.sections.filter((s) => s.type === 'product_carousel') as any[];
    expect(carousels.map((c) => c.props.products.length)).toEqual([2, 4]);
    expect(carousels[0].props.products.map((p: any) => p.name)).toEqual(['크림', '토너']);
    expect(carousels.every((c) => c.props.image_fit === 'contain')).toBe(true);
    // 모든 이미지 카드는 글자를 가진다(설명 없는 이미지 0)
    for (const s of r.sections) if (s.type === 'text_card' && (s.props as any).image_url) expect(String((s.props as any).headline || '').length).toBeGreaterThan(0);
    // 마지막 CTA = 코너 링크(기획전) · 첫 CTA 는 스포트라이트
    const ctas = r.sections.filter((s) => s.type === 'cta') as any[];
    expect(ctas[ctas.length - 1].props.buttons[0].url).toBe('https://b.com/plan');
    expect(r.sections.map((s) => s.order)).toEqual(r.sections.map((_, i) => i));
    expect(r.sections.length).toBeLessThanOrEqual(OUTREACH_SECTION_MAX - 1);
  });
  it('옛 3인자 호출(customer 기본) = 현행 채우기(갤러리 통째 · so-poster gallery) 그대로', () => {
    const r = fillOutreachDmMedia(modelSecs, media as any, 'DM');
    expect(r.sections.some((s) => s.type === 'gallery')).toBe(true);
    expect(r.sections.some((s) => String(s.id).startsWith('so-poster-'))).toBe(true);
  });
  it('상한 13 — 카드 3 + 상품 7 + 모델 카드 2 + 쿠폰 + 카운트다운 이면 절단 순서(둘째 묶음 → 둘째 카드 → 모델 카드) · 증거 카드는 상한이면 건너뛴다', () => {
    const cards = [1, 2, 3].map((n) => ({ title: `행사 ${n} 기획전 안내`, periodRaw: '2026.09.01 ~ 2099.09.30', endDate: '2099-09-30', bannerUrl: `https://hanjul.ai/b${n}.jpg`, bannerSize: { width: 1920, height: 600 }, detailUrl: `https://b.com/ev/${n}`, licensed: true }));
    const many = [...modelSecs.slice(0, 3), sec('text_card', { tag: 'T2', headline: '둘째 모델 카드', body: 'b' }, 7), sec('coupon', { discount_label: '첫 구매 혜택', usage_condition: '앱' }, 8), sec('countdown', { urgency_text: '마감 임박' }, 9), ...modelSecs.slice(3)];
    const r = fillOutreachDmMedia(many, { ...media, eventCards: cards } as any, 'DM', 'outreach');
    expect(r.sections.length).toBeLessThanOrEqual(OUTREACH_SECTION_MAX - 1);
    const types = r.sections.map((s) => s.type);
    expect(types.filter((t) => t === 'product_carousel')).toHaveLength(1); // 둘째 묶음이 먼저 빠졌다
    expect(r.sections.some((s) => String(s.id).startsWith('so-v3-event2'))).toBe(false); // 그 다음 둘째 카드
    expect(types).toContain('countdown');
    const cd: any = r.sections.find((s) => s.type === 'countdown');
    expect(cd.props.end_datetime).toBe('2099-09-30T23:59:59');
    // 증거 카드는 상한(13)에 닿으면 넣지 않는다
    const full = Array.from({ length: OUTREACH_SECTION_MAX }, (_, i) => sec(i === 0 ? 'header' : i === 1 ? 'hero' : 'text_card', {}, i));
    expect(insertProofCard(full, { reviewTotal: 1200, rating: 4.8 }, 'X').inserted).toBe(false);
    expect(insertProofCard(full.slice(0, 5), { reviewTotal: 1200, rating: 4.8 }, 'X').inserted).toBe(true);
  });
  it('세로형 카드1 배너는 히어로 자격 미달 → 히어로는 홈 첫 배너 · 카드1 은 이미지 위 text_card 로 강등 · 면허 없는 카드 제목 수치는 코드가 걷는다', () => {
    const cards = [{ title: '겨울 시즌 세일 최대 70%', periodRaw: null, endDate: null, bannerUrl: 'https://hanjul.ai/port.jpg', bannerSize: { width: 800, height: 1200 }, detailUrl: 'https://b.com/ev/9', licensed: false }];
    const r = fillOutreachDmMedia(modelSecs, { ...media, eventCards: cards } as any, 'DM', 'outreach');
    const hero: any = r.sections[1];
    expect(hero.props.image_url).toBe('https://hanjul.ai/b1.jpg');
    expect(hero.props.headline).toBe('겨울 시즌 세일'); // 수치·판촉 낱말 제거(7자 = 강등 아님)
    const demoted: any = r.sections.find((s) => String(s.id).startsWith('so-v3-event1'));
    expect(demoted.props).toMatchObject({ image_url: 'https://hanjul.ai/port.jpg', image_position: 'top', headline: '겨울 시즌 세일', body: '' });
    // 제목이 수치뿐이면(강등) 그 카드는 히어로 헤드라인도 카드도 만들지 않는다(설명 없는 이미지 0 · 모델 헤드라인 유지)
    const bare = fillOutreachDmMedia(modelSecs, { ...media, eventCards: [{ ...cards[0], title: '최대 70%' }] } as any, 'DM', 'outreach');
    expect((bare.sections[1] as any).props.headline).toBe('모델 헤드라인');
    expect(bare.sections.some((s) => String(s.id).startsWith('so-v3-event1'))).toBe(false);
  });
  it('assertBlockMinima — 경고만(삭제 0) · 미달 목록 · 상수 1곳', () => {
    const r = assertBlockMinima([sec('hero', { headline: '짧' }, 0), sec('text_card', { headline: '충분한 제목' }, 1), sec('cta', { buttons: [{ label: '보기' }] }, 2), sec('product_carousel', { products: [{}] }, 3), sec('footer', {}, 4)]);
    expect(r.kept).toBe(4);
    expect(r.short).toEqual([{ type: 'hero', field: 'headline', len: 1 }, { type: 'cta', field: 'label', len: 2 }, { type: 'product_carousel', field: 'products', len: 1 }]);
    expect(Object.keys(OUTREACH_BLOCK_MINIMA)).toEqual(['hero', 'text_card', 'cta', 'product_carousel']);
    const w = assessOutreachQuality({ dmSections: [sec('header', {}, 0), sec('hero', {}, 1), sec('cta', { buttons: [{ url: 'https://b.com/x' }] }, 2), sec('footer', {}, 3)], brandSections: null, media: null, legal: { legal: 'x', csPhone: null }, homepageUrl: 'https://b.com/', blockShort: 2, colorSource: 'neutral' });
    expect(w.warnings.map((x) => x.code)).toContain('BLOCK_MINIMA_SHORT');
    expect(w.warnings.map((x) => x.code)).toContain('BRAND_COLOR_FALLBACK');
    expect(assessOutreachQuality({ dmSections: null, brandSections: null, media: null, legal: null, homepageUrl: 'x', colorSource: 'render' }).warnings.map((x) => x.code)).not.toContain('BRAND_COLOR_FALLBACK');
    expect(OUTREACH_QUALITY_THRESHOLDS.sections).toBe(9);
  });
});

// ===== 룩 파리티 · 채점 파리티 =====

describe('★ v3 파리티 — 이미지 text_card 는 DM 렌더에 <img 가 실제로 나온다 · 채점 12항목 ↔ 경고 코드 ↔ 화면 라벨', () => {
  it('image_url 이 실린 text_card 는 classic 고정(lead·quote 0) · 렌더 HTML 에 img · 글자 카드에만 lead', () => {
    const secs = [
      sec('header', { brand_name: 'b' }, 0),
      sec('text_card', { headline: '배너 카드', body: '기간', image_url: 'https://hanjul.ai/uploads/x/b.jpg', image_position: 'top' }, 1),
      sec('text_card', { headline: '글자 카드', body: '본문' }, 2),
      sec('text_card', { headline: '둘째 이미지 카드', image_url: 'https://hanjul.ai/uploads/x/c.jpg', image_position: 'left' }, 3),
      sec('footer', {}, 4),
    ];
    const looked = applyOutreachLook(secs, 'DM', {});
    expect(looked.sections[1].treatment).toBeUndefined();
    expect(looked.sections[2].treatment).toBe('lead');
    expect(looked.sections[3].treatment).toBeUndefined();
    const built = rebuildDmPages(looked.sections);
    const html = renderDmViewerHtml({ title: 't', store_name: 'b', sections: built.sections, pages: built.pages, layout_mode: built.layoutMode, brand_kit: buildOutreachBrandKit(null, 'beauty') }, '/api/dm/v');
    expect((html.match(/<img[^>]+uploads\/x\/(b|c)\.jpg/g) || []).length).toBe(2);
  });
  it('DM_VISION_ITEMS 12 = VISION_WARNING_OF 키 = 경고 코드 유니온 안 = 프론트 QUALITY_LABEL 키(6개 신규 포함)', () => {
    expect(DM_VISION_ITEMS).toHaveLength(12);
    expect(Object.keys(VISION_WARNING_OF).sort()).toEqual([...DM_VISION_ITEMS].sort());
    const front = read('../../frontend/src/components/admin/SalesOutreachModal.tsx');
    const labelBlock = front.slice(front.indexOf('const QUALITY_LABEL'), front.indexOf('};', front.indexOf('const QUALITY_LABEL')));
    const codes: OutreachQualityCode[] = [...Object.values(VISION_WARNING_OF), 'BRAND_COLOR_FALLBACK', 'BLOCK_MINIMA_SHORT', 'HERO_FALLBACK', 'FEW_SECTIONS'];
    for (const c of codes) expect(labelBlock, c).toContain(`${c}:`);
    // 채점기 프롬프트에 12항목 키가 전부 실린다
    const produce = read('utils/sales-outreach-produce.ts');
    const promptStart = produce.indexOf('async function scoreDmCapture(');
    const prompt = produce.slice(promptStart, produce.indexOf('userMessage:', promptStart));
    for (const k of DM_VISION_ITEMS) expect(prompt, k).toContain(`"${k}"`);
  });
});

// ===== 전사 가드 · 자동 재조립 · 계수 · 회신 =====

describe('★ v3 전사 가드 · 자동 재조립 트리거 · AI 계수 · 회신 문장 · 레시피', () => {
  it('licensedLineOf — 숫자 없는 줄 통과 · 숫자 줄은 원문 재대조 통과분만 · 가드는 전사 수치가 면허 인용에 섞이면 throw', () => {
    const crawl = '고함량 50,000ppm 이상 백광기미앰플 출시! 사용 전 후 비교';
    expect(licensedLineOf('백광기미앰플 출시', crawl)).toBe('백광기미앰플 출시');
    expect(licensedLineOf('50,000ppm 이상', crawl)).toBe('50,000ppm 이상');
    expect(licensedLineOf('200시간 지속', crawl)).toBeNull();
    expect(licensedLineOf('', crawl)).toBeNull();
    // 출처 가드 — 전사 수치가 면허 인용 안에 있는데 출처(선택 후보 인용문·사실 수치)에 없으면 throw · 출처가 있으면 겹침은 정상(리뷰 #1)
    expect(() => assertLicensedQuoteSources('추석 기획전 30% 할인', ['30% 할인'])).toThrow();
    expect(() => assertLicensedQuoteSources('추석 기획전 30% 할인', ['30% 할인'], ['추석 기획전 30% 할인'])).not.toThrow();
    expect(() => assertLicensedQuoteSources('추석 기획전 30% 할인\n149,000원', ['149,000원'], ['추석 기획전 30% 할인', '149,000원'])).not.toThrow();
    expect(() => assertLicensedQuoteSources('추석 기획전 30% 할인', ['백광기미앰플 출시'])).not.toThrow();
    expect(() => assertLicensedQuoteSources('', ['30% 할인'])).not.toThrow();
  });
  it('autoRetryReasons — 트리거 3항목 중 false 인 것만 · 채점 없음 = []', () => {
    expect(autoRetryReasons({ outcome: 'ok', at: 'x', items: { uncaptioned_image_zero: false, hero_image_full: false, text_clipping_zero: true, first_screen_has_headline: false } })).toEqual(['uncaptioned_image_zero', 'first_screen_has_headline']);
    expect(autoRetryReasons({ outcome: 'ok', at: 'x', items: { hero_image_full: false } })).toEqual([]);
    expect(autoRetryReasons(null)).toEqual([]);
    expect(autoRetryReasons({ outcome: 'unavailable', at: 'x', items: null })).toEqual([]);
  });
  it('addOutreachAiCost — 누적 합 · 옛 값 없음 · source 별', () => {
    const m = newOutreachAiCost();
    m.calls = 2; m.bySource = { 'sales-outreach-dm-sections': 1, 'sales-outreach-dm-vision': 1 }; m.ms = 1200;
    expect(addOutreachAiCost(null, m)).toEqual({ calls: 2, bySource: { 'sales-outreach-dm-sections': 1, 'sales-outreach-dm-vision': 1 }, ms: 1200 });
    expect(addOutreachAiCost({ calls: 3, bySource: { 'sales-outreach-dm-vision': 2 }, ms: 100 }, m)).toEqual({ calls: 5, bySource: { 'sales-outreach-dm-sections': 1, 'sales-outreach-dm-vision': 3 }, ms: 1300 });
  });
  it('replyLineOf — 편집분 우선(공백 정리 · 60자) · 비면 기본 문장', () => {
    const c = getActiveStyleGuide().emailCopy;
    expect(replyLineOf({ replyLine: null }, c)).toBe(c.reply);
    expect(replyLineOf({ replyLine: '  회신  주세요 ' }, c)).toBe('회신 주세요');
    expect(replyLineOf({ replyLine: 'x'.repeat(100) }, c)).toHaveLength(OUTREACH_REPLY_LINE_MAX);
    expect(c.reply).not.toMatch(/—|Opus|Sonnet|Claude|GPT/);
  });
  it('사람 수정 사유 — 5값 화이트리스트 · 그 밖 null', () => {
    expect(normalizeEditReason('no_text')).toBe('no_text');
    expect(normalizeEditReason(' tone ')).toBe('tone');
    expect(normalizeEditReason('anything')).toBeNull();
    expect(normalizeEditReason(undefined)).toBeNull();
  });
  it('레시피 — 원문 0(길이·수만) · bindings 가 섹션마다 src·reader 를 단다 · 증거 카드 = proof · 카드 배너 히어로 = card', () => {
    const sections = [
      { id: 'so-v3-header-header', type: 'header', props: {} }, { id: 'g-1-hero', type: 'hero', props: { image_url: 'https://hanjul.ai/copy/ev.jpg', headline: '추석 기획전' } },
      { id: 'so-v3-cta-event1-cta', type: 'cta', props: {} }, { id: 'so-v3-carousel1-product_carousel', type: 'product_carousel', props: { products: [{}, {}] } },
      { id: 'so-proof-card', type: 'text_card', props: {} }, { id: 'g-2-text_card', type: 'text_card', props: { headline: '모델 카드' } },
    ];
    const cards = [{ title: '추석 기획전', periodRaw: null, endDate: '2099-01-01', bannerUrl: 'https://hanjul.ai/copy/ev.jpg', detailUrl: 'x', licensed: true }];
    const r: any = buildOutreachRecipe({ sections, cards, media: null, licensedQuote: '추석 기획전 30%', look: { treatments: 3, backgrounds: 2 }, colorSource: 'render', benefitStripped: 1, heroFallback: false, eventList: 'ok', bannerRead: false, vision: { outcome: 'ok', items: { hero_image_full: true } }, aiCost: null });
    expect(r.materials).toEqual({ products: 0, banners: 0, eventCards: 1, licensed: true, licensedChars: 10 });
    expect(r.bindings.map((b: any) => b.src)).toEqual(['code', 'card', 'card', 'product', 'proof', 'quote']);
    expect(r.bindings[3].ref).toBe('n=2');
    expect(JSON.stringify(r)).not.toContain('추석 기획전');
    expect(r.look).toEqual({ treatments: 3, backgrounds: 2, colorSource: 'render' });
  });
});

// ===== 고객 재료 페이지(행사 카드 3) =====

describe('★ v3 고객 입구 — 행사 카드 정규화 · 재료 조각 · 견적 reads · 카드 채우기(그룹 갤러리)', () => {
  const P = '/api/dm/v/images/c1/';
  it('normalizeQuickEventCards — 카드 ≤3 · 카드당 이미지 ≤3 · 이 회사 서빙 경로만 · 제목 40자 · 링크 http(s) · 빈 카드 제외 · id 정리', () => {
    const cards = normalizeQuickEventCards([
      { id: 'card-A', title: ' 추석  기획전 ', text: '전 상품 30% 할인', licensed: true, link: 'https://shop.example/ev/1', images: [{ url: `${P}a.jpg`, width: 1200, height: 600 }, { url: `${P}b.jpg` }, { url: `${P}c.jpg` }, { url: `${P}d.jpg` }, { url: 'https://evil.example/x.jpg' }] },
      { title: '', text: '', images: [] },
      { id: 'bad id!', title: 'x'.repeat(60), text: 't', licensed: 'yes', link: 'javascript:alert(1)', images: [{ url: '/api/dm/v/images/c2/z.jpg' }] },
      { title: '네번째', text: '', images: [{ url: `${P}e.jpg` }] },
      { title: '다섯', text: '', images: [{ url: `${P}f.jpg` }] },
    ], 'c1');
    expect(cards).toHaveLength(QUICK_EVENT_CARDS_MAX);
    expect(cards[0]).toMatchObject({ id: 'card-A', title: '추석 기획전', text: '전 상품 30% 할인', licensed: true, link: 'https://shop.example/ev/1' });
    expect(cards[0].images).toHaveLength(QUICK_EVENT_CARD_IMAGES);
    expect(cards[0].images[0]).toEqual({ url: `${P}a.jpg`, width: 1200, height: 600 });
    expect(cards[1]).toMatchObject({ id: 'card2', licensed: false, link: null, images: [] });
    expect(cards[1].title).toHaveLength(40);
    expect(cards[2].title).toBe('네번째');
    expect(normalizeQuickEventCards(null, 'c1')).toEqual([]);
  });
  it('materialsFromEventCards — gallery(group) · material [행사 n] · ctaLinks[group] · licensedQuote = 체크한 카드 문구 · eventCards(첫 이미지 = 배너 · group 결속)', () => {
    const cards = normalizeQuickEventCards([
      { id: 'a', title: '추석 기획전', text: '전 상품 30% 할인', licensed: true, link: 'https://shop.example/ev/1', images: [{ url: `${P}a.jpg`, width: 1200, height: 600 }, { url: `${P}b.jpg` }] },
      { id: 'b', title: '가을 신상', text: '최대 50% 세일', licensed: false, link: null, images: [{ url: `${P}c.jpg` }] },
    ], 'c1');
    const m = materialsFromEventCards(cards);
    expect(m.gallery.map((g) => [g.url, g.group])).toEqual([[`${P}a.jpg`, 'a'], [`${P}b.jpg`, 'a'], [`${P}c.jpg`, 'b']]);
    expect(m.material).toContain('[행사 1] 추석 기획전\n전 상품 30% 할인');
    expect(m.material).toContain('[행사 2] 가을 신상');
    expect(m.ctaLinks).toEqual({ a: 'https://shop.example/ev/1' });
    expect(m.licensedQuote).toBe('전 상품 30% 할인 · 추석 기획전');
    expect(m.eventCards[0]).toMatchObject({ title: '추석 기획전', bannerUrl: `${P}a.jpg`, bannerSize: { width: 1200, height: 600 }, detailUrl: 'https://shop.example/ev/1', licensed: true, group: 'a', text: '전 상품 30% 할인' });
    expect(m.eventCards[1]).toMatchObject({ bannerUrl: `${P}c.jpg`, bannerSize: null, detailUrl: null, licensed: false, group: 'b' });
    expect(m.link).toBe('https://shop.example/ev/1');
  });
  it('견적 — reads 는 0·1 만(호출 1회 = 3크레딧 고정 · 곱셈 0) · 옛 호출(hasText/imageCount)은 그대로', () => {
    expect(quoteQuickCampaign({ imageCount: 9, hasText: true, reads: 1 }).parts.map((p) => p.key)).toEqual(['event-image-extract', 'dm-ai-generate']);
    expect(quoteQuickCampaign({ imageCount: 9, hasText: false, reads: 3 }).parts.filter((p) => p.key === 'event-image-extract')).toHaveLength(1);
    expect(quoteQuickCampaign({ imageCount: 9, hasText: false, reads: 0 }).parts.map((p) => p.key)).toEqual(['dm-ai-generate']);
    expect(quoteQuickCampaign({ imageCount: 2, hasText: false }).parts.map((p) => p.key)).toEqual(['event-image-extract', 'dm-ai-generate']);
  });
  it('고객 채우기(3인자 · 카드 있음) — 카드1 배너 = 히어로 · 카드 본문 = 글자 카드 · 카드의 나머지 이미지 = 제목 캡션 갤러리 · 카드2 text_card + 갤러리 + cta · 카드 없으면 옛 경로 그대로', () => {
    const cards = normalizeQuickEventCards([
      { id: 'a', title: '추석 기획전', text: '전 상품 30% 할인', licensed: true, link: 'https://shop.example/ev/1', images: [{ url: `${P}a.jpg`, width: 1200, height: 600 }, { url: `${P}b.jpg`, width: 800, height: 800 }, { url: `${P}c.jpg`, width: 800, height: 800 }] },
      { id: 'b', title: '가을 신상 오픈', text: '', licensed: false, link: 'https://shop.example/ev/2', images: [{ url: `${P}d.jpg`, width: 1200, height: 600 }, { url: `${P}e.jpg`, width: 800, height: 800 }] },
    ], 'c1');
    const m = materialsFromEventCards(cards);
    const media = { posterUrl: null, posterSize: null, logoUrl: null, gallery: m.gallery, products: [], ctaLinks: m.ctaLinks, homepageUrl: 'https://shop.example/', legal: null, companyName: '브랜드', licensedQuote: m.licensedQuote, eventCards: m.eventCards };
    const secs = [sec('header', {}, 0), sec('hero', { headline: '모델', sub_copy: 's' }, 1), sec('text_card', { headline: '모델 카드', body: 'b' }, 2), sec('cta', { buttons: [{ label: '전체 보기' }] }, 3), sec('footer', {}, 4)];
    const r = fillOutreachDmMedia(secs, media as any, 'DM');
    const types = r.sections.map((s) => s.type);
    expect(types).toEqual(['header', 'hero', 'text_card', 'gallery', 'cta', 'text_card', 'text_card', 'gallery', 'cta', 'cta', 'footer']);
    const hero: any = r.sections[1];
    expect(hero.props).toMatchObject({ image_url: `${P}a.jpg`, headline: '추석 기획전' });
    const body1: any = r.sections[2];
    expect(body1.props.image_url).toBeUndefined(); // 히어로가 배너를 가졌으니 카드1 은 글자 카드
    expect(body1.props.body).toContain('전 상품 30% 할인');
    const g1: any = r.sections[3];
    expect(g1.props.images.map((x: any) => x.url)).toEqual([`${P}b.jpg`, `${P}c.jpg`]);
    expect(g1.props.images.every((x: any) => x.caption === '추석 기획전' && x.link_url === 'https://shop.example/ev/1')).toBe(true);
    expect((r.sections[4] as any).props.buttons[0].url).toBe('https://shop.example/ev/1');
    const card2: any = r.sections[6];
    expect(card2.props).toMatchObject({ image_url: `${P}d.jpg`, headline: '가을 신상 오픈' });
    expect((r.sections[7] as any).props.images.map((x: any) => x.url)).toEqual([`${P}e.jpg`]);
    expect((r.sections[8] as any).props.buttons[0].url).toBe('https://shop.example/ev/2');
    // 카드 없는 고객 재료 = 옛 경로 그대로(모델이 gallery 를 안 냈으면 갤러리도 없다 · 히어로 = 첫 장)
    const legacy = fillOutreachDmMedia(secs, { ...media, eventCards: undefined, gallery: m.gallery.map((g) => ({ url: g.url, width: g.width, height: g.height })) } as any, 'DM');
    expect(legacy.sections.map((s) => s.type)).toEqual(['header', 'hero', 'text_card', 'cta', 'footer']);
    expect((legacy.sections[1] as any).props.image_url).toBe(`${P}a.jpg`);
    expect(legacy.sections.some((s) => String(s.id).startsWith('so-v3-'))).toBe(false);
  });
});
