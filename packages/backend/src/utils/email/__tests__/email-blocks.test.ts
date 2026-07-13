/**
 * email-blocks.test.ts — 행사 상품 → 이메일 캐러셀 항목 매핑 고정 (2026-07-13)
 *
 * link_url 유실 결함(옛 map이 name/price만 재조립) 회귀 차단 + og:image 자동 채움 규칙.
 * 순수 함수(DB-free) — vitest 단독 실행 가능.
 */
import { describe, it, expect } from 'vitest';
import { buildCarouselProductsFromExtracted } from '../email-blocks';
import type { ExtractedEventProduct } from '../../event-brief';

const P = (over: Partial<ExtractedEventProduct> = {}): ExtractedEventProduct =>
  ({ name: '상품A', price: 10000, ...over });

describe('buildCarouselProductsFromExtracted', () => {
  it('link_url 보존 — 검증 통과 URL이 항목에 그대로 실린다 (유실 결함 회귀 차단)', () => {
    const out = buildCarouselProductsFromExtracted([
      P({ link_url: 'https://shop.example.com/a' }),
      P({ name: '상품B', price: 20000 }),
    ]);
    expect(out[0].link_url).toBe('https://shop.example.com/a');
    expect(out[1]).not.toHaveProperty('link_url');
  });

  it('og:image 자동 채움 — 있으면 image_url, 없으면 빈 문자열(직접 업로드 자리)', () => {
    const out = buildCarouselProductsFromExtracted(
      [P({ link_url: 'https://shop.example.com/a' }), P({ name: '상품B', price: 20000 })],
      ['https://cdn.example.com/og-a.jpg', undefined],
    );
    expect(out[0].image_url).toBe('https://cdn.example.com/og-a.jpg');
    expect(out[1].image_url).toBe('');
  });

  it('할인가·할인율은 있는 값만 동승 + id 형식 p-N 유지 (기존 산출 호환)', () => {
    const out = buildCarouselProductsFromExtracted([
      P({ discount_price: 8000, discount_rate: 20 }),
      P({ name: '상품B', price: 20000 }),
    ]);
    expect(out[0]).toMatchObject({ id: 'p-1', name: '상품A', price: 10000, discount_price: 8000, discount_rate: 20 });
    expect(out[1]).toMatchObject({ id: 'p-2', name: '상품B', price: 20000 });
    expect(out[1]).not.toHaveProperty('discount_price');
    expect(out[1]).not.toHaveProperty('discount_rate');
  });

  it('빈/미정 입력 = 빈 배열 (생성 흐름 무영향)', () => {
    expect(buildCarouselProductsFromExtracted([])).toEqual([]);
    expect(buildCarouselProductsFromExtracted(undefined as unknown as ExtractedEventProduct[])).toEqual([]);
  });
});
