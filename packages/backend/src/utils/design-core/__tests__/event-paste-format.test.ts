/**
 * ★ 2026-07-14 Harold 실사용 형식 실측 — "이름 / 가격 → 할인% 할인가 / URL" 붙여넣기 블록.
 * 이 형식은 이메일 편집기 "행사·상품 정보 붙여넣기" 입력의 대표 사용례다.
 * 추출은 AI 몫이고, 결정 부품은 검증기 2개 — 그 계약을 고정한다:
 *   validateProductsAgainstEventText = 원문 실존 가격·할인만 통과(환각 차단)
 *   assignProductLinksFromText       = 상품 구간의 URL을 결정적으로 배정
 */
import { describe, it, expect } from 'vitest';
import { validateProductsAgainstEventText, normalizeEventText } from '../../event-brief';

const SAMPLE = normalizeEventText(`여름 스킨케어 특별전 — 전 품목 15%
글로우 파운데이션 30ml
85,000원 → 15% 72,250원
https://store.example.com/products/9090905782

[2+1 증정] 수분 선크림 세트
134,000원 → 15% 113,900원
https://store.example.com/products/6858932018

싱크로 글로우 쿠션 컴팩트 세트
64,000원 → 15% 54,400원
https://store.example.com/products/5558104855`);

// AI가 붙여넣기 원문에서 뽑았다고 가정한 상품 제안(링크 누락 — 배정기가 채워야 함)
const AI_PRODUCTS = [
  { name: '글로우 파운데이션 30ml', price: 85000, discount_price: 72250, discount_rate: 15 },
  { name: '수분 선크림 세트', price: 134000, discount_price: 113900, discount_rate: 15 },
  { name: '싱크로 글로우 쿠션 컴팩트 세트', price: 64000, discount_price: 54400, discount_rate: 15 },
];

describe('행사·상품 붙여넣기 형식 — 검증·배정 왕복', () => {
  it('3건 전부 통과 + 상품별 URL이 자기 구간 것으로 자동 배정', () => {
    const out = validateProductsAgainstEventText(AI_PRODUCTS, SAMPLE);
    expect(out.length).toBe(3);
    expect(out[0].link_url).toBe('https://store.example.com/products/9090905782');
    expect(out[1].link_url).toBe('https://store.example.com/products/6858932018');
    expect(out[2].link_url).toBe('https://store.example.com/products/5558104855');
    for (const p of out) {
      expect(p.discount_price).toBeDefined();
      expect(p.discount_rate).toBe(15);
    }
  });

  it('환각 차단 — 원문에 없는 가격은 탈락, 없는 할인가·URL은 제거', () => {
    const out = validateProductsAgainstEventText(
      [
        { name: '글로우 파운데이션 30ml', price: 99000 },                                    // 가격 환각 → 탈락
        { name: '수분 선크림 세트', price: 134000, discount_price: 99900 },                  // 할인가 환각 → 할인만 제거
        { name: '싱크로 글로우 쿠션 컴팩트 세트', price: 64000, link_url: 'https://evil.example.com/x' }, // URL 환각 → 제거 후 재배정
      ],
      SAMPLE,
    );
    expect(out.length).toBe(2);
    expect(out[0].name).toContain('수분 선크림');
    expect(out[0].discount_price).toBeUndefined();
    expect(out[1].link_url).toBe('https://store.example.com/products/5558104855');
  });
});
