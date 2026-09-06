/**
 * sales-outreach-media-v2.test.ts — 재료 v2 추출기 행동 테스트 (2026-09-06 · S1)
 * 카드 원문에 문자열로 있는 값만 채운다 · 배너 alt 동반 · 사회적 증거 · 기존 함수는 투영이라 문자 단위 동일. 네트워크 0.
 */
import { describe, it, expect } from 'vitest';
import {
  extractProducts, extractImageCandidates, extractImageCandidatesDetailed, extractProofSignals,
} from '../sales-outreach-media';

const BASE = 'https://www.isoi.co.kr/';

/** 아이소이 세일 카드 형태(렌더 후 DOM 축약) */
const CARD_HTML = `
<ul class="goods-list">
  <li><a href="/product/goods_detail?ct=31&goods_no=6528">
    <img src="https://cfront.isoi.co.kr/img_isoi/product/nuggi/6528.png" alt="17주년 잡티세럼 기획세트">
    <p class="name">17주년 잡티세럼 기획세트(로즈PDRN 잡티세럼 70ml+백광기미크림 30ml)</p>
    <span class="rate">46%</span><span class="price">79,000원</span><del>149,000원</del>
    <span class="review">★ 4.9 (20,389)</span><em>NEW</em><em>SALE</em>
  </a></li>
  <li><a href="/product/goods_detail?ct=31&goods_no=6217">
    <img src="https://cfront.isoi.co.kr/img_isoi/product/nuggi/6217.png" alt="장수진 수분크림 튜브형 70ml">
    <p class="name">장수진 수분크림 튜브형 70ml(단품/더블 선택)</p>
    <span class="price">25,200원</span><del>36,000원</del><span class="review">4.9 (8,679)</span><em>HOT</em><em>GIFT</em>
  </a></li>
  <li><a href="/product/goods_detail?ct=31&goods_no=3309">
    <img src="https://cfront.isoi.co.kr/img_isoi/product/nuggi/3309.png" alt="비건쿠션 리필">
    <p class="name">비건쿠션 리필 15g 본품</p>
    <span class="price">23,000원</span>
  </a></li>
</ul>`;

describe('extractProducts 재료 v2 선택 필드', () => {
  it('평점·리뷰수·할인율·뱃지는 카드 원문에 있을 때만 채워진다', () => {
    const ps = extractProducts(CARD_HTML, BASE);
    expect(ps.length).toBe(3);
    const a = ps[0];
    expect(a.price).toBe(149000);
    expect(a.discount_price).toBe(79000);
    expect(a.discount_rate).toBe(46);
    expect(a.rating).toBe(4.9);
    expect(a.review_count).toBe(20389);
    expect(a.badges).toEqual(['NEW', 'SALE']);
    const b = ps[1];
    expect(b.discount_price).toBe(25200);
    expect(b.discount_rate).toBeUndefined(); // 원문에 % 문자열이 없다 → 계산하지 않는다
    expect(b.rating).toBe(4.9);
    expect(b.review_count).toBe(8679);
    expect(b.badges).toEqual(['HOT', 'GIFT']);
    const c = ps[2];
    expect(c.discount_price).toBeNull();
    expect(c.rating).toBeUndefined();
    expect(c.badges).toBeUndefined();
  });
  it('할인율 문자열이 있어도 가격 쌍이 없으면 채우지 않는다(원문 두 값 없이 % 단독은 잡음)', () => {
    const html = `<a href="/product/1"><img src="/a.jpg"><p>단품 최대 30% 세일 예고</p><span>23,000원</span></a>`;
    const ps = extractProducts(html, BASE);
    expect(ps.length).toBe(1);
    expect(ps[0].discount_rate).toBeUndefined();
  });
});

describe('extractImageCandidatesDetailed · extractImageCandidates 투영', () => {
  const html = `
    <meta property="og:image" content="https://cfront.isoi.co.kr/share.jpg">
    <img src="https://cfront.isoi.co.kr/event/pc_main_banner_chuseok.jpg" alt="풍성한 한가위 보름달 혜택 최대 50%">
    <img src="https://cfront.isoi.co.kr/event/pc_main_banner_cream.jpg" alt="기능성 크림대전">
    <img src="https://cfront.isoi.co.kr/common/ui/logo.png" alt="로고">
    <img width="80" height="80" src="https://cfront.isoi.co.kr/tiny.jpg" alt="작은">
    <img src="https://cfront.isoi.co.kr/event/pc_main_banner_chuseok.jpg" alt="중복">`;
  it('alt 와 문서 순서를 함께 돌려주고 중복은 첫 것이 이긴다', () => {
    const d = extractImageCandidatesDetailed(html, BASE);
    expect(d.map((x) => x.url)).toEqual([
      'https://cfront.isoi.co.kr/share.jpg',
      'https://cfront.isoi.co.kr/event/pc_main_banner_chuseok.jpg',
      'https://cfront.isoi.co.kr/event/pc_main_banner_cream.jpg',
    ]);
    expect(d[1].alt).toBe('풍성한 한가위 보름달 혜택 최대 50%');
    expect(d[0].alt).toBe('');
    expect(d.map((x) => x.order)).toEqual([0, 1, 2]);
  });
  it('기존 함수는 상세 판의 url 투영과 문자 단위로 같다(무후퇴)', () => {
    expect(extractImageCandidates(html, BASE)).toEqual(extractImageCandidatesDetailed(html, BASE).map((x) => x.url));
    expect(extractImageCandidates(html, BASE, 2).length).toBe(2);
  });
});

describe('extractProofSignals', () => {
  it('리뷰 총수 · 평점 · 1위 표기를 원문에서 읽는다', () => {
    const t = '455,083 개의 리얼 리뷰 · 17주년 잡티세럼 4.9 (20,389) · 장수진 4.9 (8,679) · #올리브영_12년간_누적판매_1위 잡티케어';
    const p = extractProofSignals(t);
    expect(p.reviewTotal).toBe(455083);
    expect(p.rating).toBe(4.9);
    expect(p.rankLabel).toMatch(/1\s*위/);
  });
  it('없으면 null · 100 미만 리뷰수는 총수로 보지 않는다 · 단독 평점 1회는 채택하지 않는다', () => {
    const p = extractProofSignals('신상품 안내 · 리뷰 12 · 4.9 (12)');
    expect(p.reviewTotal).toBeNull();
    expect(p.rating).toBeNull();
    expect(p.rankLabel).toBeNull();
    expect(extractProofSignals('')).toEqual({ reviewTotal: null, rating: null, rankLabel: null });
  });
  it('평점 라벨형(평점 4.8)과 어워즈 표기', () => {
    const p = extractProofSignals('평점 4.8 · 2024 OLIVE YOUNG AWARDS WINNER 에센스/세럼');
    expect(p.rating).toBe(4.8);
    expect(p.rankLabel).toMatch(/AWARDS WINNER/);
  });
});
