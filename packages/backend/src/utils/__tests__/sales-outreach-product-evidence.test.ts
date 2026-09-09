import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseProductPage, rejectShellDuplicates, type OutreachProduct } from '../sales-outreach-media';

/**
 * ★ 2026-09-09 상품 상세 파서 = 증거 허용 목록 (B-0909-1 톤28 실측).
 * 경위: toun28.com 상세 페이지의 정적 HTML 은 껍데기다 — og:title = 브랜드명(og:site_name 과 동일) · og:type website ·
 *   og:image = 브랜드 SEO 이미지 · product:price:amount = 0 · 본문의 "원"은 "15,000원 담으면 무료배송"·"40,000원 이상 주문 시 무료 배송" 두 줄뿐.
 *   옛 파서는 "가격 메타 키 존재"를 상품 페이지 증거로 보고, 본문 아무 "N원"을 판매가·정가로 읽어 "톤28 · 15,000원 / 40,000원" 카드 6장을 만들었다.
 * 계약: 상품이라는 증거(og:type product · 0 보다 큰 구조화 가격 · 라벨 붙은 본문 가격) 없이는 상품이 아니다. 이름이 사이트 이름이면 상품명이 아니다.
 *   같은 이름·같은 이미지의 상세 결과가 2개 이상이면 껍데기라 전부 버린다.
 */
const shell = readFileSync(resolve(__dirname, 'fixtures', 'toun28-product-1367.html'), 'utf-8');
const page = (head: string, body = ''): string => `<html><head>${head}</head><body>${body}</body></html>`;
const OG = (title: string, site = '브랜드', type = 'website'): string =>
  `<meta property="og:title" content="${title}"><meta property="og:site_name" content="${site}"><meta property="og:type" content="${type}"><meta property="og:image" content="https://www.brand.co.kr/web/product/big/p1.jpg">`;
const URL1 = 'https://www.brand.co.kr/product/1';

describe('parseProductPage — 상품이라는 증거가 없으면 상품이 아니다', () => {
  it('톤28 실물 껍데기(og:title=브랜드명 · website · 가격 메타 0 · 본문 "원"은 무료배송 문구뿐) = null', () => {
    expect(shell).toContain('15,000원');
    expect(parseProductPage(shell, 'https://www.toun28.com/renew/product/1367')).toBeNull();
  });

  it('라벨 붙은 본문 가격(정가 · 판매가)은 증거다 — og:type website 여도 상품 · 무료배송 문구의 "원"은 섞이지 않는다', () => {
    const p = parseProductPage(page(OG('블랙티 앰플 30mL'), '<p>정가 52,000원</p><p>판매가 45,000원</p><p>40,000원 이상 무료배송</p>'), URL1);
    expect(p).toMatchObject({ name: '블랙티 앰플 30mL', price: 52000, discount_price: 45000, link_url: URL1 });
  });

  it('판매가 라벨만 있으면 그 값이 가격 · 할인 없음', () => {
    const p = parseProductPage(page(OG('수분 크림 70mL'), '<p>판매가 36,000원</p><p>3,000원 적립</p>'), URL1);
    expect(p).toMatchObject({ name: '수분 크림 70mL', price: 36000, discount_price: null });
  });

  it('라벨 없는 "N원"(배송 · 쿠폰 · 적립)은 가격이 아니다 → null', () => {
    expect(parseProductPage(page(OG('블랙티 앰플 30mL'), '<p>15,000원 담으면 무료배송</p><p>40,000원 이상 주문 시 무료 배송</p>'), URL1)).toBeNull();
  });

  it('가격 메타 키가 있어도 값이 0 이면 증거가 아니다', () => {
    expect(parseProductPage(page(OG('블랙티 앰플 30mL') + '<meta property="product:price:amount" content="0">', '<p>3,000원 적립</p>'), URL1)).toBeNull();
  });

  it('이름이 og:site_name 과 같으면 상품명이 아니다 — og:type product · 구조화 가격이 있어도 null', () => {
    expect(parseProductPage(page(OG('브랜드', '브랜드', 'product') + '<meta property="product:price:amount" content="45000">'), URL1)).toBeNull();
  });

  it('itemprop=price 는 구조화 증거다(content 속성 · 텍스트 둘 다)', () => {
    expect(parseProductPage(page(OG('수분 크림 70mL'), '<span itemprop="price" content="36000">36,000원</span>'), URL1)).toMatchObject({ name: '수분 크림 70mL', price: 36000, discount_price: null });
    expect(parseProductPage(page(OG('수분 크림 70mL'), '<span itemprop="price">36,000</span>원'), URL1)).toMatchObject({ price: 36000 });
  });

  it('기존 케이스 — og:type product + 구조화 가격 2개 = 그대로', () => {
    const html = page(OG('블랙티 유스 인핸싱 앰플 30mL', '브랜드', 'product')
      + '<meta property="product:price:amount" content="45000"><meta property="product:original_price:amount" content="52000">');
    expect(parseProductPage(html, URL1)).toMatchObject({ name: '블랙티 유스 인핸싱 앰플 30mL', price: 52000, discount_price: 45000 });
    expect(parseProductPage('<html><head><title>회사소개</title></head></html>', 'https://www.brand.co.kr/about')).toBeNull();
  });
});

describe('rejectShellDuplicates — 같은 이름·같은 이미지의 상세 결과가 2개 이상이면 껍데기(전부 버린다)', () => {
  const mk = (name: string, image: string, link: string): OutreachProduct => ({ name, price: 15000, discount_price: null, image_url: image, link_url: link });
  it('동일 3개 → 0개 · 다른 것은 남는다 · 순서 유지', () => {
    const list = [mk('톤28', 'https://s3/seo.png', '/p/1'), mk('세럼', 'https://s3/a.jpg', '/p/4'), mk('톤28', 'https://s3/seo.png', '/p/2'), mk('톤28', 'https://s3/seo.png', '/p/3'), mk('크림', 'https://s3/b.jpg', '/p/5')];
    expect(rejectShellDuplicates(list).map((p) => p.name)).toEqual(['세럼', '크림']);
  });
  it('이름이 같아도 이미지가 다르면 상품일 수 있다(남긴다) · 전부 다르면 그대로 · 빈 배열 그대로', () => {
    const list = [mk('세럼', 'https://s3/a.jpg', '/p/1'), mk('세럼', 'https://s3/b.jpg', '/p/2')];
    expect(rejectShellDuplicates(list)).toHaveLength(2);
    expect(rejectShellDuplicates([])).toEqual([]);
  });
});
