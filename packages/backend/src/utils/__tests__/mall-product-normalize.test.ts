/**
 * mall-product-normalize.test.ts — 카페24 상품 재조회 분류(★2026-09-14 T3) + 상품번호 추출.
 * 정규화(normalizeCafe24Product)가 품절·미전시를 null 로 버리는 것과 같은 판정을 사유로 드러낸다(AI 자동제작 §6-5 "품절 = 제외 + 사유").
 * DB·네트워크 0.
 */
import { describe, it, expect } from 'vitest';
import { cafe24ProductAvailability, normalizeCafe24Product, extractMallProductNo, normalizeWooStoreProduct, wooStoreProductAvailability } from '../mall-product-normalize';

describe('cafe24ProductAvailability', () => {
  const base = { product_no: 12345, product_code: 'P0000ABC', product_name: '수분크림', price: '26600.00', retail_price: '38000.00', selling: 'T', display: 'T', sold_out: 'F', detail_image: 'https://m/big.jpg' };
  it('판매·전시 중 + 품절 아님 = ok · 정규화도 통과', () => {
    expect(cafe24ProductAvailability(base)).toBe('ok');
    expect(normalizeCafe24Product(base, 'mall')).not.toBeNull();
  });
  it('품절 = sold_out · 판매중지·미전시 = hidden · 정규화는 null · 비객체 = hidden', () => {
    expect(cafe24ProductAvailability({ ...base, sold_out: 'T' })).toBe('sold_out');
    expect(cafe24ProductAvailability({ ...base, display: 'F' })).toBe('hidden');
    expect(cafe24ProductAvailability({ ...base, selling: 'F' })).toBe('hidden');
    expect(normalizeCafe24Product({ ...base, sold_out: 'T' }, 'mall')).toBeNull();
    expect(cafe24ProductAvailability(null)).toBe('hidden');
    expect(cafe24ProductAvailability('x')).toBe('hidden');
  });
});

describe('extractMallProductNo', () => {
  it('카페24 detail · SEO 형 · 네이버 · 없음', () => {
    expect(extractMallProductNo('https://m.cafe24.com/product/detail.html?product_no=12345')).toBe('12345');
    expect(extractMallProductNo('https://m.cafe24.com/product/수분크림/777/')).toBe('777');
    expect(extractMallProductNo('https://smartstore.naver.com/shop/products/987654')).toBe('987654');
    expect(extractMallProductNo('https://brand.example/event')).toBeNull();
    expect(extractMallProductNo(null)).toBeNull();
  });
});

describe('normalizeWooStoreProduct — 우커머스 Store API(공개) 상품 → MallProduct (★0914 W5 · 실측 ilbonimo.com 형태)', () => {
  const MALL = 'ilbonimo.com';
  const raw = (over: Record<string, any> = {}) => ({
    id: 297751, name: '아이엔이 드로어스 실키 클렌즈 클리닉 리필용 350g', permalink: 'https://www.ilbonimo.com/product/xxx/', sku: '4582521685066', on_sale: false,
    prices: { price: '21483', regular_price: '21483', sale_price: '21483', currency_code: 'KRW', currency_minor_unit: 0 },
    images: [{ id: 297568, src: 'https://www.ilbonimo.com/wp-content/uploads/2025/06/4582521685066.jpg', thumbnail: 'https://www.ilbonimo.com/wp-content/uploads/2025/06/4582521685066-247x247.jpg' }],
    is_purchasable: true, is_in_stock: true, ...over,
  });
  it('기본 매핑: provider = woocommerce:{mall} · code = id · 가격 정수 · 대표 이미지 src · permalink', () => {
    expect(normalizeWooStoreProduct(raw(), MALL)).toEqual({
      provider: 'woocommerce:ilbonimo.com', code: '297751', name: '아이엔이 드로어스 실키 클렌즈 클리닉 리필용 350g',
      price: 21483, salePrice: 21483, discountRate: 0,
      imageUrl: 'https://www.ilbonimo.com/wp-content/uploads/2025/06/4582521685066.jpg', productUrl: 'https://www.ilbonimo.com/product/xxx/',
    });
  });
  it('할인: regular_price > price → 정가·판매가·할인율 · minor_unit 2 면 100 으로 나눈다(문자열 금액은 최소 단위)', () => {
    const p = normalizeWooStoreProduct(raw({ prices: { price: '8000', regular_price: '10000', sale_price: '8000', currency_minor_unit: 0 } }), MALL)!;
    expect([p.price, p.salePrice, p.discountRate]).toEqual([10000, 8000, 20]);
    const usd = normalizeWooStoreProduct(raw({ prices: { price: '2135', regular_price: '2500', sale_price: '2135', currency_code: 'USD', currency_minor_unit: 2 } }), MALL)!;
    expect([usd.price, usd.salePrice]).toEqual([25, 21.35].map(Math.round));
  });
  it('품절(is_in_stock false) · 구매 불가(is_purchasable false) · 이름 없음 · 가격 0 · id 없음 → null · 이미지 없으면 imageUrl null', () => {
    expect(normalizeWooStoreProduct(raw({ is_in_stock: false }), MALL)).toBeNull();
    expect(normalizeWooStoreProduct(raw({ is_purchasable: false }), MALL)).toBeNull();
    expect(normalizeWooStoreProduct(raw({ name: '' }), MALL)).toBeNull();
    expect(normalizeWooStoreProduct(raw({ prices: { price: '0', regular_price: '0' } }), MALL)).toBeNull();
    expect(normalizeWooStoreProduct(raw({ id: undefined }), MALL)).toBeNull();
    expect(normalizeWooStoreProduct(raw({ images: [] }), MALL)!.imageUrl).toBeNull();
    expect(normalizeWooStoreProduct(null, MALL)).toBeNull();
  });
  it('wooStoreProductAvailability: 품절 sold_out · 구매불가 hidden · 그 밖 ok(AI 자동제작 재조회 "품절 = 제외 + 사유")', () => {
    expect(wooStoreProductAvailability(raw())).toBe('ok');
    expect(wooStoreProductAvailability(raw({ is_in_stock: false }))).toBe('sold_out');
    expect(wooStoreProductAvailability(raw({ is_purchasable: false }))).toBe('hidden');
  });
});
