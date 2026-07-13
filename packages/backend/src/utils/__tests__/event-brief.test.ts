import { describe, it, expect } from 'vitest';
import { buildEventPromptBlock, benefitMatchesEventText, normalizeEventText, EVENT_TEXT_MAX, validateProductsAgainstEventText, assignProductLinksFromText } from '../event-brief';

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

/**
 * ★ 2026-07-08 행사 원문 상품 구조 추출 검증 — DM one-shot + 이메일 generate-sections 공용 게이트.
 * 가격 숫자가 원문에 실존해야 통과. 환각 가격/상품은 자동 탈락.
 */
describe('validateProductsAgainstEventText', () => {
  const EVENT = [
    '시세이도 15% 할인전',
    '',
    '시세이도 리바이탈에센스 스킨 글로우 파운데이션 30ml',
    '85,000원 → 15% 72,250원',
    '',
    '[2+1 증정] 시세이도 NEW 파란자차 세트',
    '134,000원 → 15% 113,900원',
    '',
    '시세이도 싱크로 스킨 글로우 쿠션 컴팩트 세트',
    '64,000원 → 15% 54,400원',
  ].join('\n');

  it('원문 실존 상품 = 정가·할인가·할인율 통과', () => {
    const out = validateProductsAgainstEventText([
      { name: '시세이도 리바이탈에센스 스킨 글로우 파운데이션 30ml', price: 85000, discount_price: 72250, discount_rate: 15 },
      { name: '시세이도 NEW 파란자차 세트', price: 134000, discount_price: 113900 },
    ], EVENT);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ price: 85000, discount_price: 72250, discount_rate: 15 });
    expect(out[1]).toMatchObject({ price: 134000, discount_price: 113900 });
  });

  it('환각 가격 상품 = 탈락, 환각 할인가만 = 할인가만 제거하고 상품 유지', () => {
    const out = validateProductsAgainstEventText([
      { name: '시세이도 쿠션 세트', price: 99000, discount_price: 88000 },      // 원문에 없는 가격 → 탈락
      { name: '시세이도 싱크로 스킨 글로우 쿠션 컴팩트 세트', price: 64000, discount_price: 59000 }, // 할인가만 환각 → 할인가 제거
    ], EVENT);
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe(64000);
    expect(out[0].discount_price).toBeUndefined();
  });

  it('원문에 없는 할인율 = rate만 제거', () => {
    const out = validateProductsAgainstEventText(
      [{ name: '시세이도 NEW 파란자차 세트', price: 134000, discount_price: 113900, discount_rate: 30 }],
      EVENT,
    );
    expect(out).toHaveLength(1);
    expect(out[0].discount_rate).toBeUndefined();
  });

  it('부분 문자열 우회 차단 — 원문 숫자 일부와 겹치는 환각 가격 = 탈락', () => {
    // 134,000 안의 "34000" / 54,400 안의 "4400" — 경계 매치라 탈락해야 한다
    expect(validateProductsAgainstEventText(
      [{ name: '시세이도 NEW 파란자차 세트', price: 34000 }],
      EVENT,
    )).toHaveLength(0);
    const out = validateProductsAgainstEventText(
      [{ name: '시세이도 싱크로 스킨 글로우 쿠션 컴팩트 세트', price: 64000, discount_price: 4400 }],
      EVENT,
    );
    expect(out).toHaveLength(1);
    expect(out[0].discount_price).toBeUndefined();
  });

  it('상품명이 원문과 무관 = 탈락', () => {
    const out = validateProductsAgainstEventText(
      [{ name: '나이키 운동화 에어맥스', price: 85000 }],
      EVENT,
    );
    expect(out).toHaveLength(0);
  });

  it('빈 원문·비배열·가격 0 = 빈 배열', () => {
    expect(validateProductsAgainstEventText([{ name: 'a', price: 1000 }], '')).toHaveLength(0);
    expect(validateProductsAgainstEventText('not-array', EVENT)).toHaveLength(0);
    expect(validateProductsAgainstEventText([{ name: '시세이도 파란자차', price: 0 }], EVENT)).toHaveLength(0);
  });

  it('8개 상한', () => {
    const src = Array.from({ length: 12 }, (_, i) => `상품${i + 1} ${(i + 1) * 1000}원`).join('\n');
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `상품${i + 1}`, price: (i + 1) * 1000 }));
    expect(validateProductsAgainstEventText(many, src)).toHaveLength(8);
  });
});

/**
 * ★ 2026-07-13 — 상품 URL 매핑 (Harold 지시: "텍스트 넣기에 상품 주소까지 매핑").
 * AI link_url = 원문 글자 그대로 실존해야 통과. 누락분 = 상품명 구간에 URL 1개일 때만 결정적 배정.
 */
describe('상품 URL 매핑 (link_url 검증 + 결정적 배정)', () => {
  const EVENT_URL = [
    '시세이도 리바이탈에센스 스킨 글로우 파운데이션 30ml',
    '85,000원 → 15% 72,250원',
    'https://brand.naver.com/shiseido/products/9090905782',
    '',
    '[2+1 증정] 시세이도 NEW 파란자차 세트',
    '134,000원 → 15% 113,900원',
    'https://brand.naver.com/shiseido/products/6858932018',
    '',
    '시세이도 얼티뮨 × LISA',
    '얼티뮨 저속노화 세럼 구매 시, 리사 포토 엽서 증정',
  ].join('\n');

  it('AI가 준 link_url = 원문 실존이면 통과', () => {
    const out = validateProductsAgainstEventText([
      { name: '시세이도 리바이탈에센스 스킨 글로우 파운데이션 30ml', price: 85000, discount_price: 72250, link_url: 'https://brand.naver.com/shiseido/products/9090905782' },
    ], EVENT_URL);
    expect(out).toHaveLength(1);
    expect(out[0].link_url).toBe('https://brand.naver.com/shiseido/products/9090905782');
  });

  it('환각/변형 URL = URL만 제거하고 상품 유지 → 구간 배정으로 원문 URL 복원', () => {
    const out = validateProductsAgainstEventText([
      // AI가 URL을 지어내거나(존재 X) 변형(끝자리 다름)한 경우
      { name: '시세이도 NEW 파란자차 세트', price: 134000, link_url: 'https://brand.naver.com/shiseido/products/9999999999' },
    ], EVENT_URL);
    expect(out).toHaveLength(1);
    // 환각 URL은 탈락하고, 그 상품 구간의 원문 URL이 결정적으로 배정된다
    expect(out[0].link_url).toBe('https://brand.naver.com/shiseido/products/6858932018');
  });

  it('http/https 외 스킴 = 제거', () => {
    const evil = '상품A 1000원\njavascript:alert(1)';
    const out = validateProductsAgainstEventText([{ name: '상품A', price: 1000, link_url: 'javascript:alert(1)' }], evil);
    expect(out).toHaveLength(1);
    expect(out[0].link_url).toBeUndefined();
  });

  it('AI가 URL 누락 = 상품 구간에 URL 1개면 자동 배정', () => {
    const out = validateProductsAgainstEventText([
      { name: '시세이도 리바이탈에센스 스킨 글로우 파운데이션 30ml', price: 85000 },
      { name: '시세이도 NEW 파란자차 세트', price: 134000 },
    ], EVENT_URL);
    expect(out).toHaveLength(2);
    expect(out[0].link_url).toBe('https://brand.naver.com/shiseido/products/9090905782');
    expect(out[1].link_url).toBe('https://brand.naver.com/shiseido/products/6858932018');
  });

  it('구간에 URL 0개(증정 문단 등) = 미배정, 2개 이상(모호) = 미배정', () => {
    const zero = validateProductsAgainstEventText(
      [{ name: '얼티뮨 저속노화 세럼', price: 1000 }],
      '얼티뮨 저속노화 세럼 1,000원\n포토 엽서 증정',
    );
    expect(zero).toHaveLength(1);
    expect(zero[0].link_url).toBeUndefined();

    const ambiguous = validateProductsAgainstEventText(
      [{ name: '상품A', price: 1000 }],
      '상품A 1000원\nhttps://a.example.com/1\nhttps://a.example.com/2',
    );
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0].link_url).toBeUndefined();
  });

  it('AI가 다른 상품 구간의 URL을 붙임(원문 실존이지만 오배치) = 폐기 후 자기 구간 URL로 교정', () => {
    const out = validateProductsAgainstEventText([
      // 상품 1에 상품 2의 URL을 붙인 경우 — verbatim 검증은 통과하지만 구간 검증에서 교정돼야 한다
      { name: '시세이도 리바이탈에센스 스킨 글로우 파운데이션 30ml', price: 85000, link_url: 'https://brand.naver.com/shiseido/products/6858932018' },
      { name: '시세이도 NEW 파란자차 세트', price: 134000 },
    ], EVENT_URL);
    expect(out).toHaveLength(2);
    expect(out[0].link_url).toBe('https://brand.naver.com/shiseido/products/9090905782');
    expect(out[1].link_url).toBe('https://brand.naver.com/shiseido/products/6858932018');
  });

  it('assignProductLinksFromText — 기존 link_url 보존 + URL 없는 원문 무변화', () => {
    const kept = assignProductLinksFromText(
      [{ name: '상품A', price: 1000, link_url: 'https://keep.example.com/x' }],
      '상품A 1000원\nhttps://other.example.com/y',
    );
    expect(kept[0].link_url).toBe('https://keep.example.com/x');
    const noUrl = assignProductLinksFromText([{ name: '상품A', price: 1000 }], '상품A 1000원');
    expect(noUrl[0].link_url).toBeUndefined();
  });
});
