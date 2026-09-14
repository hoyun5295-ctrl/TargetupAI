/**
 * mall-product-normalize.test.ts — 카페24 상품 재조회 분류(★2026-09-14 T3) + 상품번호 추출.
 * 정규화(normalizeCafe24Product)가 품절·미전시를 null 로 버리는 것과 같은 판정을 사유로 드러낸다(AI 자동제작 §6-5 "품절 = 제외 + 사유").
 * DB·네트워크 0.
 */
import { describe, it, expect } from 'vitest';
import { cafe24ProductAvailability, normalizeCafe24Product, extractMallProductNo } from '../mall-product-normalize';

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
