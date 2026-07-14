/**
 * ★ 2026-07-14 — 상품 붙여넣기 파서(FE utils/product-paste — 이메일·DM 공용 편집기 소비) 교차 패키지 고정.
 * 결정적 파서: 붙여넣은 숫자·URL만 그대로(창작 불가). Harold 실사용 형식이 대표 케이스.
 */
import { describe, it, expect } from 'vitest';
import { parsePastedProducts } from '../../../../../frontend/src/utils/product-paste';

const HAROLD_FORMAT = `여름 스킨케어 특별전 — 전 품목 15%
글로우 파운데이션 30ml
85,000원 → 15% 72,250원
https://store.example.com/products/9090905782

[2+1 증정] 수분 선크림 세트
134,000원 → 15% 113,900원
https://store.example.com/products/6858932018

싱크로 글로우 쿠션 컴팩트 세트
64,000원 → 15% 54,400원
https://store.example.com/products/5558104855`;

describe('parsePastedProducts', () => {
  it('대표 형식 — 3상품 이름·정가·할인가·할인율·링크 전부', () => {
    const out = parsePastedProducts(HAROLD_FORMAT);
    expect(out.length).toBe(3);
    expect(out[0]).toEqual({
      name: '글로우 파운데이션 30ml', price: 85000, discount_price: 72250, discount_rate: 15,
      link_url: 'https://store.example.com/products/9090905782',
    });
    expect(out[1].name).toContain('[2+1 증정]');
    expect(out[2].discount_price).toBe(54400);
  });

  it('행사 제목 줄(가격·링크 없음)은 상품으로 세지 않음', () => {
    const out = parsePastedProducts('겨울 감사제\n상품 A\n10,000원\nhttps://a.example.com/1');
    expect(out.length).toBe(1);
    expect(out[0].name).toBe('상품 A');
  });

  it('가격 없이 이름+링크만도 인정 / 링크 없는 상품도 인정', () => {
    const out = parsePastedProducts('상품 A\nhttps://a.example.com/1\n\n상품 B\n5,000원');
    expect(out.length).toBe(2);
    expect(out[0].link_url).toBe('https://a.example.com/1');
    expect(out[0].price).toBeUndefined();
    expect(out[1].price).toBe(5000);
    expect(out[1].link_url).toBeUndefined();
  });

  it('할인가가 정가보다 크면 무시 + 최대 8개 상한 + 빈 입력 = 0개', () => {
    const weird = parsePastedProducts('상품 A\n10,000원 → 20,000원');
    expect(weird[0].price).toBe(10000);
    expect(weird[0].discount_price).toBeUndefined();
    const many = parsePastedProducts(
      Array.from({ length: 12 }, (_, i) => `상품 ${i}\n1,000원`).join('\n\n'),
    );
    expect(many.length).toBe(8);
    expect(parsePastedProducts('')).toEqual([]);
  });
});
