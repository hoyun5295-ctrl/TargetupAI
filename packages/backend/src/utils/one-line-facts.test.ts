/**
 * 한줄로 시그니처 판정 CT 계약 (설계서 docs/2026-10-05-hanjul-signature-design.md §3)
 *
 * 못 박는 것:
 *   1. 판정은 입력으로 한다 — 같은 한 줄에서 혜택 값을 지우면 gap이 생긴다(지울수록 줄지 않는다 · 원스텝 §0-3 함정).
 *   2. 업종(뷰티 · 의류 · 요식업) 고정 사례 — 이미 적은 혜택은 다시 묻지 않고, 행사가 아닌 한 줄은 묻지 않는다.
 *   3. 문턱 금액 · 가격은 혜택 값이 아니다.
 *   4. 원문에는 한 줄 + 사용자 답만 · 멱등키는 입력이 바뀌면 바뀐다 · 스위치는 비면 꺼진다.
 *   5. AI · DB import 0(묻기는 무과금).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  oneLineGaps, hasConcreteBenefit, hasPromotionIntent, sanitizeLineFacts, buildLineEventText,
  buildOneLineIdempotencyKey, isValidAttemptToken, oneLineFactsEnabled, copyCTestEnabled, pickCopyCVariant,
} from './one-line-facts';

describe('혜택 판정 — 업종 고정 사례', () => {
  const ASK: string[] = [
    '이번 주 쿠션 세일 알림',                 // 뷰티 · 값 없음
    '블프 기획전 안내',                       // 의도 낱말 확장
    '얼리버드 이벤트 오픈',
    '신규 가입 쿠폰 안내',                    // 쿠폰이라고만 했다(무슨 쿠폰인지 없음)
    '원피스 39,000원 오픈 이벤트',             // 가격은 혜택 값이 아니다
    '5만원 이상 구매 시 할인',                 // 문턱 금액은 값이 아니다
    '가을 시즌오프 행사',
    '주말 특가 문자 보내줘',
    '면 100% 티셔츠 할인 행사 안내해줘',     // 소재 함량은 혜택 값이 아니다(Codex 1R)
    '더블 코트 세일 알려줘',                 // 상품명의 더블은 혜택 값이 아니다(Codex 1R)
    '비타민C 20% 세럼 할인 이벤트',          // 성분 농도(뷰티)
  ];
  const NO_ASK: string[] = [
    'VIP 고객에게 이번 주말 수분크림 1+1 문자',
    '가을 신상 니트 3종, 이번 주말까지 첫 구매 10%',
    '적립 2배 이벤트',
    '포인트 더블 적립 이벤트',
    '샘플 증정 이벤트',
    '아메리카노 천원 할인',
    '만원 쿠폰 이벤트',
    '5천원 할인 쿠폰 발급',
    '전 상품 무료배송 이벤트',
    '해피아워 맥주 반값',
    '최대 50% 시즌오프',
    '전 상품 20% 세일',
    '10%OFF 이벤트',
    '2배 적립 이벤트',
    '아울렛 상시 할인 매장 안내',             // 상시 = 행사 아님
    '신상 립 입고 소식',                      // 행사 의도 없음
    '평일 점심 세트 알려줘',
    '',
  ];
  it.each(ASK)('묻는다: %s', (line) => { expect(oneLineGaps(line).benefit).toBe(true); });
  it.each(NO_ASK)('묻지 않는다: %s', (line) => { expect(oneLineGaps(line).benefit).toBe(false); });
});

describe('판정은 입력으로 — 사실을 지울수록 gap이 줄지 않는다', () => {
  const PAIRS: Array<[string, string]> = [
    ['이번 주말 30% 세일', '이번 주말 세일'],
    ['아메리카노 천원 할인 이벤트', '아메리카노 할인 이벤트'],
    ['쿠션 1+1 특가', '쿠션 특가'],
    ['적립 2배 이벤트', '적립 이벤트'],
  ];
  it.each(PAIRS)('%s → %s', (full, stripped) => {
    expect(oneLineGaps(full).benefit).toBe(false);
    expect(oneLineGaps(stripped).benefit).toBe(true);
  });
  it('값 판정과 의도 판정은 따로 본다', () => {
    expect(hasConcreteBenefit('39,000원 오픈')).toBe(false);
    expect(hasConcreteBenefit('쿠폰 5천원')).toBe(true);
    expect(hasConcreteBenefit('1만원 이상 결제 시')).toBe(false);
    expect(hasPromotionIntent('30% OFF')).toBe(true);
    expect(hasPromotionIntent('OFFICE 이전 안내')).toBe(false);
    expect(hasPromotionIntent('무료 수신거부 안내')).toBe(false);
  });
});

describe('사용자 답 · 원문', () => {
  it('facts 검증: 없음 = undefined · null 혜택 = 없음 · 형식 오류 = invalid', () => {
    expect(sanitizeLineFacts(undefined)).toBeUndefined();
    expect(sanitizeLineFacts({ benefit: null })).toEqual({ benefit: null });
    expect(sanitizeLineFacts({ benefit: '  10% 쿠폰 ' })).toEqual({ benefit: '10% 쿠폰' });
    expect(sanitizeLineFacts({ benefit: '' })).toBe('invalid');
    expect(sanitizeLineFacts({ benefit: 'x'.repeat(301) })).toBe('invalid');
    expect(sanitizeLineFacts({})).toBe('invalid');
    expect(sanitizeLineFacts('10%')).toBe('invalid');
    expect(sanitizeLineFacts([])).toBe('invalid');
  });
  it('원문 = 한 줄 + [혜택] 라벨 줄만(답이 없으면 한 줄 그대로)', () => {
    expect(buildLineEventText('주말 세일 안내', { benefit: '전 상품 20%' })).toBe('주말 세일 안내\n[혜택] 전 상품 20%');
    expect(buildLineEventText('주말 세일 안내', { benefit: null })).toBe('주말 세일 안내');
    expect(buildLineEventText('  주말 세일 안내  ')).toBe('주말 세일 안내');
  });
});

describe('멱등 · 스위치', () => {
  const C = '11111111-1111-1111-1111-111111111111';
  it('입력이 바뀌면 키가 바뀌고 같으면 같다 · 길이 150 안', () => {
    const tok = 'a'.repeat(64);
    const k1 = buildOneLineIdempotencyKey(C, 'dm', tok, { line: '주말 세일', facts: { benefit: '10%' } });
    const k2 = buildOneLineIdempotencyKey(C, 'dm', tok, { line: '주말 세일', facts: { benefit: '10%' } });
    const k3 = buildOneLineIdempotencyKey(C, 'dm', tok, { line: '주말 세일', facts: { benefit: '20%' } });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1.length).toBeLessThanOrEqual(150);
    expect(k1.startsWith(`oneline:${C}:dm:`)).toBe(true);
  });
  it('시도 토큰 형식', () => {
    expect(isValidAttemptToken('7f1c2a9e-1b2c-4d5e-8f90-123456789abc')).toBe(true);
    expect(isValidAttemptToken('short')).toBe(false);
    expect(isValidAttemptToken('a:b:c:d:e:f:g:h')).toBe(false);
    expect(isValidAttemptToken(123)).toBe(false);
  });
  it('스위치는 비면 꺼지고 * = 전 회사', () => {
    expect(oneLineFactsEnabled(C, '')).toBe(false);
    expect(oneLineFactsEnabled(C, undefined as unknown as string)).toBe(false);
    expect(oneLineFactsEnabled(C, '*')).toBe(true);
    expect(oneLineFactsEnabled(C, `x, ${C}`)).toBe(true);
    expect(oneLineFactsEnabled(null, '*')).toBe(false);
    expect(copyCTestEnabled(C, '')).toBe(false);
  });
  it('C안 시험: 꺼진 회사 = undefined(현행) · 켜진 회사 = 반반', () => {
    const prev = process.env.COPY_C_TEST_COMPANY_IDS;
    try {
      process.env.COPY_C_TEST_COMPANY_IDS = '';
      expect(pickCopyCVariant(C, () => 0.1)).toBeUndefined();
      process.env.COPY_C_TEST_COMPANY_IDS = C;
      expect(pickCopyCVariant(C, () => 0.1)).toBe('mz');
      expect(pickCopyCVariant(C, () => 0.9)).toBe('punchy');
    } finally {
      process.env.COPY_C_TEST_COMPANY_IDS = prev;
    }
  });
});

describe('무과금 근거 — AI · DB import 0', () => {
  it('import 목록', () => {
    const src = readFileSync(join(__dirname, 'one-line-facts.ts'), 'utf8');
    const imports = Array.from(src.matchAll(/^import .* from '([^']+)';$/gm)).map((m) => m[1]);
    // ★ 2026-10-10 './woocommerce-core' = 몰 식별자 정규화(순수 · DB · AI 0) — 확정 상품 provider 검증
    expect(imports.sort()).toEqual(['./content-interview', './sns-constants', './woocommerce-core', 'crypto']);
  });
});
