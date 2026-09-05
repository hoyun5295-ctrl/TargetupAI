/**
 * sales-outreach-media.test.ts — 재료 수집 CT 순수 층 행동 테스트 (2026-09-05 · 설계서 A-10·A-10b·A-11)
 * 픽스처 HTML·바이너리를 실제로 함수에 넣고 반환값을 단정한다. 네트워크 0 · DB 0.
 */
import { describe, it, expect } from 'vitest';
import {
  readImageSize, extractProducts, extractImageCandidates, discoverProductLinks, findLinkByText, buildCtaLinkMap, pickStoredImagesDetail,
  extractBrandIconCandidates, dominantColorFromPng, resolveBrandColorGuarded, extractLogoCandidates, pngLooksWhite,
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
  it('상한 24 · width/height 속성이 둘 다 200 미만이거나 경로가 menu·nav·gnb 폴더면 후보에서 뺀다(메뉴 아이콘)', () => {
    const many = Array.from({ length: 40 }, (_, i) => `<img src="https://cdn.brand.com/${i}.jpg">`).join('');
    expect(extractImageCandidates(many, BASE)).toHaveLength(24);
    const tiny = `<img src="https://cdn.brand.com/menu.jpg" width="114" height="114"><img src="https://cdn.brand.com/display/menu/a1.jpg"><img src="https://cdn.brand.com/gnb/b2.png"><img src="https://cdn.brand.com/big.jpg" width="1200" height="800"><img src="https://cdn.brand.com/unknown.jpg">`;
    expect(extractImageCandidates(tiny, BASE)).toEqual(['https://cdn.brand.com/big.jpg', 'https://cdn.brand.com/unknown.jpg']);
  });
});

describe('pickStoredImagesDetail (C3-2 벽시계 예산 · 시도 수)', () => {
  const png = (w: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.from([(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, 0, 0, 0, 100]), Buffer.alloc(2100)]);
  const fetcher = async (u: string) => ({ buffer: png(u.includes('big') ? 900 : 100), mime: 'image/png', ext: 'png' });
  const store = (_b: Buffer, meta: { width: number }) => `https://hanjul.ai/c/${meta.width}.png`;
  it('통과분만 · 시도 수 = 후보 수(상한 n×3) · 예산 0이면 timedOut · 하나도 안 본다', async () => {
    const cands = ['https://x/small1', 'https://x/big1', 'https://x/big2', 'https://x/small2'];
    const r = await pickStoredImagesDetail(cands, 2, 600, fetcher, store, { deadlineMs: 60_000 });
    expect(r.images.map((i) => i.width)).toEqual([900, 900]);
    expect(r.tried).toBe(3);
    expect(r.timedOut).toBe(false);
    const t = await pickStoredImagesDetail(cands, 2, 600, fetcher, store, { deadlineMs: -1 });
    expect(t).toEqual({ images: [], tried: 0, timedOut: true });
    const capped = await pickStoredImagesDetail(cands, 1, 600, fetcher, store, { maxTries: 1 });
    expect(capped.tried).toBe(1);
    expect(capped.images).toEqual([]);
  });
});

describe('★0905(4) 브랜드 색 — 메타 → 아이콘 PNG 지배색(색 1개만 · 로고 픽셀은 안 쓴다)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PNG } = require('pngjs');
  const makePng = (w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]) => {
    const png = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const [r, g, b, a] = paint(x, y); png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a; }
    return PNG.sync.write(png) as Buffer;
  };
  it('theme-color → 없으면 msapplication-TileColor · 3자리 확장 · 그 외 null', () => {
    expect(parseThemeColorFromHtml('<meta name="theme-color" content="#ABC">')).toBe('#aabbcc');
    expect(parseThemeColorFromHtml('<meta name="msapplication-TileColor" content="#12B464">')).toBe('#12b464');
    expect(parseThemeColorFromHtml('<meta name="theme-color" content="rgb(1,2,3)">')).toBeNull();
    expect(parseThemeColorFromHtml('')).toBeNull();
  });
  it('아이콘 후보 = og:image(PNG일 때) · apple-touch-icon · icon(png) · PNG 아닌 것 제외 · 최대 3', () => {
    const html = `<meta property="og:image" content="/img/brand/logo.png"><link rel="icon" type="image/x-icon" href="/favicon.ico">
      <link rel="apple-touch-icon" sizes="180x180" href="/apple.png"><link rel="icon" type="image/png" href="https://cdn.brand.com/i.png"><link rel="icon" type="image/png" href="/d.png">`;
    expect(extractBrandIconCandidates(html, BASE)).toEqual(['https://www.brand.co.kr/img/brand/logo.png', 'https://www.brand.co.kr/apple.png', 'https://cdn.brand.com/i.png']);
    expect(extractBrandIconCandidates('<meta property="og:image" content="/img/hero.jpg">', BASE)).toEqual([]);
  });
  it('지배색 = 채도 있는 최빈 색(흰 글씨·회색·투명 제외) · 무채색 로고·비PNG = null', () => {
    const logo = makePng(60, 60, (x, y) => (x > 10 && x < 50 && y > 25 && y < 35 ? [255, 255, 255, 255] : [18, 180, 100, 255]));
    const c = dominantColorFromPng(logo)!;
    expect(c).toBe('#12b464');
    const gray = makePng(20, 20, () => [120, 120, 120, 255]);
    expect(dominantColorFromPng(gray)).toBeNull();
    const transparent = makePng(20, 20, () => [200, 20, 20, 10]);
    expect(dominantColorFromPng(transparent)).toBeNull();
    expect(dominantColorFromPng(Buffer.from('not png'))).toBeNull();
  });
  it('★0905(5) 로고 후보 = 헤더 img(logo) → apple-touch-icon → og:image(PNG) · 흰·로딩·푸터·SNS 제외 · ≤4 · 흰 로고 판정', () => {
    const html = `<header><a class="logo"><img src="/img/logo_black.svg" alt="브랜드"></a><img src="/web/logo/woman_loading_white_pc_.png"></header>
      <img class="footer-logo" src="/img/footer_logo.png"><img src="/img/partner-logo.png"><img alt="instagram logo" src="/i/ig.png">
      <link rel="apple-touch-icon" href="/apple.png"><meta property="og:image" content="/brand/logo.png"><meta property="og:image" content="/x.jpg">`;
    expect(extractLogoCandidates(html, BASE)).toEqual(['https://www.brand.co.kr/img/logo_black.svg', 'https://www.brand.co.kr/apple.png', 'https://www.brand.co.kr/brand/logo.png']);
    expect(extractLogoCandidates('<img src="/a.png">', BASE)).toEqual([]);
    const white = makePng(40, 40, (x, y) => (x > 5 && x < 35 && y > 15 && y < 25 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    expect(pngLooksWhite(white)).toBe(true);
    const green = makePng(40, 40, () => [18, 180, 100, 255]);
    expect(pngLooksWhite(green)).toBe(false);
    expect(pngLooksWhite(Buffer.from('jpeg'))).toBe(false);
  });
  it('pickStoredImagesDetail — 문서 순서를 유지한다(면적 정렬 0 · 홈 첫 배너가 히어로)', async () => {
    const png = (w: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.from([(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, 0, 0, 0, 100]), Buffer.alloc(2100)]);
    const f = async (u: string) => ({ buffer: png(u.includes('a') ? 700 : 1400), mime: 'image/png', ext: 'png' });
    const st = (_b: Buffer, meta: { width: number }) => `https://hanjul.ai/c/${meta.width}.png`;
    const r = await pickStoredImagesDetail(['https://x/a', 'https://x/b'], 2, 600, f, st, { deadlineMs: 60_000 });
    expect(r.images.map((i) => i.width)).toEqual([700, 1400]);
  });
  it('resolveBrandColorGuarded — 메타가 있으면 fetch 0 · 없으면 후보 순서대로 · 600KB 초과·실패는 건너뛴다', async () => {
    const calls: string[] = [];
    const logo = makePng(30, 30, () => [200, 30, 60, 255]);
    const fetcher = async (u: string) => { calls.push(u); if (u.endsWith('big.png')) return { buffer: Buffer.alloc(700_000, 1), mime: 'image/png', ext: 'png' }; if (u.endsWith('logo.png')) return { buffer: logo, mime: 'image/png', ext: 'png' }; return null; };
    expect(await resolveBrandColorGuarded('<meta name="theme-color" content="#000000">', BASE, fetcher)).toEqual({ color: '#000000', source: 'meta' });
    expect(calls).toEqual([]);
    const html = '<link rel="apple-touch-icon" href="/big.png"><link rel="icon" type="image/png" href="/none.png"><meta property="og:image" content="/logo.png">';
    expect(await resolveBrandColorGuarded(html, BASE, fetcher)).toEqual({ color: '#c81e3c', source: 'icon' });
    expect(calls).toEqual(['https://www.brand.co.kr/logo.png', 'https://www.brand.co.kr/big.png', 'https://www.brand.co.kr/none.png'].slice(0, calls.length));
    expect(await resolveBrandColorGuarded('<meta property="og:image" content="/none.png">', BASE, fetcher)).toEqual({ color: null, source: null });
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
