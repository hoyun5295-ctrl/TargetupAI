/**
 * sales-outreach-media.test.ts — 재료 수집 CT 순수 층 행동 테스트 (2026-09-05 · 설계서 A-10·A-10b·A-11)
 * 픽스처 HTML·바이너리를 실제로 함수에 넣고 반환값을 단정한다. 네트워크 0 · DB 0.
 */
import { describe, it, expect } from 'vitest';
import {
  readImageSize, extractProducts, extractImageCandidates, discoverProductLinks, findLinkByText, buildCtaLinkMap,
  extractLegal, parseThemeColorFromHtml, parseProductPage, absolutizeAssetUrl, cleanProductName, productKey, decodeHtmlEntities,
} from '../sales-outreach-media';

const BASE = 'https://www.brand.co.kr/kr/ko';

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(32);
  b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47;
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function gif(w: number, h: number): Buffer {
  const b = Buffer.alloc(32);
  b.write('GIF89a', 0);
  b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8);
  return b;
}
function jpeg(w: number, h: number): Buffer {
  // SOI + APP0(len 16) + SOF0(len 17: precision, height, width)
  const b = Buffer.alloc(2 + 18 + 19 + 8);
  b[0] = 0xff; b[1] = 0xd8;
  b[2] = 0xff; b[3] = 0xe0; b.writeUInt16BE(16, 4); // APP0 payload 14 bytes
  const sof = 2 + 18;
  b[sof] = 0xff; b[sof + 1] = 0xc0; b.writeUInt16BE(17, sof + 2); b[sof + 4] = 8;
  b.writeUInt16BE(h, sof + 5); b.writeUInt16BE(w, sof + 7);
  return b;
}
function webpVp8(w: number, h: number): Buffer {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0); b.writeUInt32LE(32, 4); b.write('WEBP', 8); b.write('VP8 ', 12); b.writeUInt32LE(20, 16);
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28);
  return b;
}

describe('readImageSize (헤더만 · 라이브러리 0)', () => {
  it('PNG·GIF·JPEG·WebP 폭·높이를 읽는다', () => {
    expect(readImageSize(png(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(readImageSize(gif(640, 480))).toEqual({ width: 640, height: 480 });
    expect(readImageSize(jpeg(1080, 1350))).toEqual({ width: 1080, height: 1350 });
    expect(readImageSize(webpVp8(900, 600))).toEqual({ width: 900, height: 600 });
  });
  it('모르는 형식·짧은 버퍼는 null', () => {
    expect(readImageSize(Buffer.from('hello'))).toBeNull();
    expect(readImageSize(Buffer.alloc(64))).toBeNull();
  });
});

describe('absolutizeAssetUrl · decodeHtmlEntities', () => {
  it('엔티티(&amp;)를 풀고 상대 경로를 절대화하며 과대 폭 파라미터를 1200으로 낮춘다', () => {
    expect(absolutizeAssetUrl('img/a.jpg', BASE)).toBe('https://www.brand.co.kr/kr/img/a.jpg');
    expect(absolutizeAssetUrl('https://cdn.x.com/p.jpg?width=3840&amp;q=80', BASE)).toBe('https://cdn.x.com/p.jpg?width=1200&q=80');
    expect(absolutizeAssetUrl('data:image/png;base64,xx', BASE)).toBeNull();
    expect(decodeHtmlEntities('a&amp;b &quot;c&quot;')).toBe('a&b "c"');
  });
});

describe('extractProducts (목록 마크업 휴리스틱)', () => {
  const html = `
    <ul class="prdList">
      <li><a href="/product/detail.html?product_no=123"><img src="/web/product/medium/a_120.jpg" ec-data-src="/web/product/big/a.jpg"><span>블랙 코튼 티셔츠</span><span>정가</span><span>29,000원</span><span>할인가</span><span>19,000원</span></a></li>
      <li><a href="/product/detail.html?product_no=123&display_group=2"><img src="/web/product/big/a.jpg"><span>블랙 코튼 티셔츠</span><span>29,000원</span></a></li>
      <li><a href="/product/detail.html?product_no=456"><img src="/web/product/big/b.jpg"><span>화이트 리넨 셔츠</span><span>49,000원</span></a></li>
      <li><a href="/event/1"><img src="/img/banner.jpg"><span>가을 기획전</span></a></li>
      <li><a href="/product/detail.html?product_no=789"><img src="/img/icon_new.png"><span>아이콘만 있는 상품</span><span>9,900원</span></a></li>
    </ul>`;
  it('이미지+가격이 있는 카드만 · 정가/할인가 분리 · 식별자 중복 병합 · 아이콘 이미지 제거', () => {
    const ps = extractProducts(html, BASE);
    expect(ps.map((p) => p.name)).toEqual(['블랙 코튼 티셔츠', '화이트 리넨 셔츠']);
    expect(ps[0]).toMatchObject({ price: 29000, discount_price: 19000 });
    expect(ps[0].image_url).toBe('https://www.brand.co.kr/web/product/big/a.jpg'); // ec-data-src 우선
    expect(ps[0].link_url).toBe('https://www.brand.co.kr/product/detail.html?product_no=123');
    expect(ps[1].discount_price).toBeNull();
  });
  it('cleanProductName · productKey', () => {
    expect(cleanProductName('블랙 티셔츠 판매가')).toBe('블랙 티셔츠');
    expect(productKey({ name: 'x', link_url: 'https://a.com/product/detail.html?product_no=77' })).toBe('77');
    expect(productKey({ name: 'x', link_url: 'https://a.com/product/%EC%8A%A4%ED%8A%B8%EB%9D%BC%EC%9D%B4%ED%94%84/8581/category/1/' })).toBe('8581');
    expect(productKey({ name: '이름으로 대체', link_url: 'https://a.com/' })).toBe('이름으로 대체');
  });
});

describe('extractImageCandidates', () => {
  const html = `
    <meta property="og:image" content="https://cdn.brand.com/og.jpg">
    <img src="img/rel.jpg">
    <img srcset="https://cdn.brand.com/a-400.jpg 400w, https://cdn.brand.com/a-1600.jpg 1600w, https://cdn.brand.com/a-800.jpg 800w">
    <img src="https://cdn.brand.com/p.jpg?width=3840&amp;fit=cover">
    <img src="https://cdn.brand.com/logo_black.png">
    <img src="https://img.brand.com/cf/resize/abcdef">
    <source srcset="https://cdn.brand.com/s-2x.jpg 2x, https://cdn.brand.com/s-1x.jpg 1x">
    <img src="https://ct.pinterest.com/v3/?tid=1">`;
  it('경로 상대 절대화 · srcset 최대 · 엔티티 디코딩 · 확장자 없는 CDN 허용 · 로고·추적 픽셀 배제', () => {
    const out = extractImageCandidates(html, BASE);
    expect(out).toContain('https://cdn.brand.com/og.jpg');
    expect(out).toContain('https://www.brand.co.kr/kr/img/rel.jpg');
    expect(out).toContain('https://cdn.brand.com/a-1600.jpg');
    expect(out).toContain('https://cdn.brand.com/p.jpg?width=1200&fit=cover');
    expect(out).toContain('https://img.brand.com/cf/resize/abcdef');
    expect(out).toContain('https://cdn.brand.com/s-2x.jpg');
    expect(out.some((u) => u.includes('logo_black'))).toBe(false);
    expect(out.some((u) => u.includes('pinterest'))).toBe(false);
  });
  it('상한 12', () => {
    const many = Array.from({ length: 30 }, (_, i) => `<img src="https://cdn.brand.com/${i}.jpg">`).join('');
    expect(extractImageCandidates(many, BASE)).toHaveLength(12);
  });
});

describe('discoverProductLinks · findLinkByText · buildCtaLinkMap', () => {
  const html = `
    <a href="/product/detail.html?product_no=1&utm_source=x">A</a>
    <a href="/product/detail.html?product_no=1">A dup</a>
    <a href="https://other.com/product/99">타 호스트</a>
    <a href="/goods/view?goodsNo=22">B</a>
    <a href="/notice/3">공지</a>
    <a href="/member/login">쿠폰 로그인</a>
    <a href="/event/coupon-zone">쿠폰존 바로가기</a>
    <a href="/lookbook/2026fw">룩북</a>`;
  it('같은 호스트 상품형 링크만 · 식별자 중복 제거', () => {
    const links = discoverProductLinks(html, BASE);
    expect(links).toEqual([
      'https://www.brand.co.kr/product/detail.html?product_no=1&utm_source=x',
      'https://www.brand.co.kr/goods/view?goodsNo=22',
    ]);
  });
  it('앵커 텍스트 키워드 → 딥링크(로그인 경로 제외)', () => {
    expect(findLinkByText(html, BASE, ['쿠폰'])).toBe('https://www.brand.co.kr/event/coupon-zone');
    expect(findLinkByText(html, BASE, ['멤버십'])).toBeNull();
    const map = buildCtaLinkMap(html, BASE);
    expect(map['룩북']).toBe('https://www.brand.co.kr/lookbook/2026fw');
    expect(map['세일']).toBeUndefined();
  });
});

describe('extractLegal · parseThemeColorFromHtml · parseProductPage', () => {
  it('법정 표기 2개 이상이면 legal · 고객센터 번호', () => {
    const t = '상호 (주)브랜드컴퍼니 | 대표 홍길동 | 사업자등록번호 123-45-67890 | 통신판매업신고 2020-서울강남-01234 | 고객센터 1588-1234';
    const r = extractLegal(t);
    expect(r.legal).toContain('사업자등록번호 123-45-67890');
    expect(r.legal).toContain('대표 홍길동');
    expect(r.csPhone).toBe('1588-1234');
    expect(extractLegal('아무 표기 없음').legal).toBeNull();
  });
  it('theme-color 6자리 정규화 · 3자리 확장 · 그 외 null', () => {
    const mk = (v: string) => `<html><head><meta name="theme-color" content="${v}"></head></html>`;
    expect(parseThemeColorFromHtml(mk('#ffffff'))).toBe('#ffffff');
    expect(parseThemeColorFromHtml(mk('#fff'))).toBe('#ffffff');
    expect(parseThemeColorFromHtml(mk('#FFF'))).toBe('#ffffff');
    expect(parseThemeColorFromHtml(mk('#1a2b3c'))).toBe('#1a2b3c');
    expect(parseThemeColorFromHtml(mk('red'))).toBeNull();
    expect(parseThemeColorFromHtml('<html></html>')).toBeNull();
  });
  it('상세 페이지 og/product 메타 → 상품 · 상품 페이지가 아니면 null', () => {
    const html = `<html><head>
      <meta property="og:type" content="product">
      <meta property="og:title" content="블랙티 유스 인핸싱 앰플 30mL | 브랜드 공식몰">
      <meta property="og:image" content="/web/product/big/ampoule.jpg">
      <meta property="product:price:amount" content="45000">
      <meta property="product:original_price:amount" content="52000">
    </head></html>`;
    const p = parseProductPage(html, 'https://www.brand.co.kr/product/1');
    expect(p).toMatchObject({ name: '블랙티 유스 인핸싱 앰플 30mL', price: 52000, discount_price: 45000, image_url: 'https://www.brand.co.kr/web/product/big/ampoule.jpg', link_url: 'https://www.brand.co.kr/product/1' });
    expect(parseProductPage('<html><head><title>회사소개</title></head></html>', 'https://www.brand.co.kr/about')).toBeNull();
  });
});
