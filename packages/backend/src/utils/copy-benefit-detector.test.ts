import { describe, test, expect } from 'vitest';
import { detectBenefits, buildBenefitEmphasis } from './copy-benefit-detector';

describe('detectBenefits — 구체 혜택 토큰 감지', () => {
  test('퍼센트 할인 감지', () => {
    const r = detectBenefits('이번 주 전 품목 30% 할인');
    expect(r.hasBenefit).toBe(true);
    expect(r.tokens).toContain('30%');
  });
  test('원 단위 금액 감지', () => {
    expect(detectBenefits('5000원 적립 이벤트').hasBenefit).toBe(true);
  });
  test('N+N 증정 감지', () => {
    expect(detectBenefits('1+1 행사').hasBenefit).toBe(true);
  });
  test('키워드 혜택 감지 (반값·무료배송·사은품·쿠폰)', () => {
    expect(detectBenefits('전 상품 반값 세일').hasBenefit).toBe(true);
    expect(detectBenefits('오늘만 무료배송').hasBenefit).toBe(true);
    expect(detectBenefits('구매 시 사은품 증정').hasBenefit).toBe(true);
    expect(detectBenefits('할인 쿠폰 드려요').hasBenefit).toBe(true);
  });
  test('혜택 없는 안내문은 false', () => {
    const r = detectBenefits('신상품이 입고되었습니다. 매장에서 만나보세요.');
    expect(r.hasBenefit).toBe(false);
    expect(r.tokens).toEqual([]);
  });
  test('연도/시각 숫자는 혜택 오탐 X', () => {
    expect(detectBenefits('2026년 봄 신상 출시').hasBenefit).toBe(false);
    expect(detectBenefits('오후 3시 오픈').hasBenefit).toBe(false);
  });
});

describe('buildBenefitEmphasis — 채널별 강조 지시', () => {
  test('혜택 있음 + SMS = 텍스트 강조 지시(이모지 금지)', () => {
    const s = buildBenefitEmphasis(['30%', '무료배송'], 'SMS');
    expect(s).toContain('30%');
    expect(s).toContain('무료배송');
    expect(s).toMatch(/후크|첫 줄|강조/);
    expect(s).not.toMatch(/😀|🔥|✨/);
  });
  test('혜택 있음 + LMS = 텍스트 강조', () => {
    const s = buildBenefitEmphasis(['반값'], 'LMS');
    expect(s).toContain('반값');
  });
  test('혜택 없음 = 시의성 풍성 지시(혜택 날조 금지)', () => {
    const s = buildBenefitEmphasis([], 'SMS');
    expect(s).toMatch(/계절|시즌|시의성/);
    expect(s).toMatch(/날조|지어내지/);
  });
});
