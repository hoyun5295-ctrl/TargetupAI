import { describe, it, expect } from 'vitest';
import { buildEventPromptBlock, benefitMatchesEventText, normalizeEventText, EVENT_TEXT_MAX } from '../event-brief';

/**
 * 행사 캠페인 브리프 CT (2026-07-07(4)) — 혜택 실존 검증은 AI 임의 혜택 금지 영구 룰의 기계 게이트.
 * 행사 원문에 사용자가 직접 적은 혜택만 통과, AI 환각 혜택은 원문에 없어 탈락해야 한다.
 */
describe('event-brief', () => {
  const EVENT = '여름맞이 신상품 출시전\n7/10~7/20\n전 품목 20% 할인\n구매 고객 사은품 증정';

  it('buildEventPromptBlock — 원문 포함 + 사용 규칙 포함, 빈 원문 = 빈 문자열', () => {
    const block = buildEventPromptBlock(EVENT);
    expect(block).toContain('여름맞이 신상품 출시전');
    expect(block).toContain('행사 내용 사용 규칙');
    expect(buildEventPromptBlock('')).toBe('');
    expect(buildEventPromptBlock('   ')).toBe('');
  });

  it('normalizeEventText — 길이 상한', () => {
    expect(normalizeEventText('a'.repeat(EVENT_TEXT_MAX + 500)).length).toBe(EVENT_TEXT_MAX);
    expect(normalizeEventText(null)).toBe('');
  });

  it('원문 기재 혜택 = 통과 (공백·표현 차이 허용 — 핵심 토큰 실존)', () => {
    expect(benefitMatchesEventText('전 품목 20% 할인', EVENT)).toBe(true);
    expect(benefitMatchesEventText('20 % 할인 + 사은품', EVENT)).toBe(true);
    expect(benefitMatchesEventText('구매 고객 사은품 증정', EVENT)).toBe(true);
  });

  it('원문에 없는 혜택(환각) = 탈락', () => {
    expect(benefitMatchesEventText('30% 할인', EVENT)).toBe(false);
    expect(benefitMatchesEventText('5만원 쿠폰 증정', EVENT)).toBe(false);
    expect(benefitMatchesEventText('무료배송', EVENT)).toBe(false);
    expect(benefitMatchesEventText('1+1 이벤트', EVENT)).toBe(false);
  });

  it('빈 값·원문 없음 = 탈락 (placeholder 강제 경로)', () => {
    expect(benefitMatchesEventText('', EVENT)).toBe(false);
    expect(benefitMatchesEventText('20% 할인', '')).toBe(false);
    expect(benefitMatchesEventText(null, EVENT)).toBe(false);
  });
});
