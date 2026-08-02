import { describe, test, expect } from 'vitest';
import { detectBenefits, buildBenefitEmphasis, stripUnauthorizedBenefits, BENEFIT_PLACEHOLDER } from './copy-benefit-detector';

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

/**
 * ★ 2026-08-02 Codex 1R~4R — AI가 지어낸 구체 혜택 기계 차단.
 *
 * 4R에서 구조를 바꿨다: 근거는 **사람이 쓴 원본 본문 하나**뿐이고, 판정은 "그 자리가 원본에 그대로 있었나"다.
 * 목적 문장·앞 스텝을 근거로 삼던 비교(정규화 키·허용 집합 교차)가 라운드마다 반례를 냈고, 그 비교 자체를 없앴다.
 * 방향은 덜 보내는 쪽 — 애매하면 placeholder(미편집 placeholder는 활성화가 막는다).
 */
describe('stripUnauthorizedBenefits', () => {
  test('생성 모드(원본 없음)에서는 구체 혜택이 전부 placeholder가 된다', () => {
    expect(stripUnauthorizedBenefits('지금 오시면 30% 할인해 드려요')).toContain(BENEFIT_PLACEHOLDER);
    expect(stripUnauthorizedBenefits('지금 오시면 30% 할인해 드려요')).not.toContain('30%');
  });

  test('원본에 있던 혜택은 다듬기 후에도 남는다', () => {
    const out = stripUnauthorizedBenefits('지금 오시면 30% 할인해 드려요', '30% 할인 안내드립니다');
    expect(out).toContain('30%');
    expect(out).not.toContain(BENEFIT_PLACEHOLDER);
  });

  test('목적 문장은 근거가 아니다 — AI에게 숫자를 렌더링할 면허가 아니다', () => {
    expect(stripUnauthorizedBenefits('30% 할인 행사입니다', '')).toContain(BENEFIT_PLACEHOLDER);
  });

  test('혜택이 없으면 문안을 건드리지 않는다', () => {
    const src = '오랜만이에요. 편하게 둘러보세요';
    expect(stripUnauthorizedBenefits(src, '')).toBe(src);
  });

  test('교차 조합을 승인하지 않는다 — 원본의 10% 할인·5% 적립이 5% 할인을 열어주지 않는다', () => {
    const out = stripUnauthorizedBenefits('5% 할인해 드려요', '10% 할인과 5% 적립을 진행합니다');
    expect(out).toContain(BENEFIT_PLACEHOLDER);
  });

  test('복합 금액을 통째로 잡는다 — 1만5천원에서 5천원 조각을 남기지 않는다', () => {
    const out = stripUnauthorizedBenefits('1만5천원 할인', '5천원 할인 행사');
    expect(out).toContain(BENEFIT_PLACEHOLDER);
    expect(out).not.toContain('1만');
  });

  test('붙여 쓴 무료 혜택도 실제로 지워진다', () => {
    const out = stripUnauthorizedBenefits('무료체험을 드려요', '');
    expect(out).toContain(BENEFIT_PLACEHOLDER);
    expect(out).not.toContain('무료체험');
  });

  test("조사가 달라도 원본에 있으면 남는다 — '무료 상담'과 '무료 상담부터'", () => {
    expect(stripUnauthorizedBenefits('무료 상담부터 시작해요', '무료 상담 진행 중')).toContain('무료 상담');
  });

  test("'무료한 일상'은 혜택이 아니다", () => {
    const src = '무료한 일상에 활력을 드려요';
    expect(stripUnauthorizedBenefits(src, '')).toBe(src);
  });

  test('법정 문구는 붙여 쓰든 띄어 쓰든 건드리지 않는다', () => {
    expect(stripUnauthorizedBenefits('안내드립니다\n무료수신거부 0808888888', '')).toContain('무료수신거부');
    expect(stripUnauthorizedBenefits('안내드립니다\n무료 수신 거부 0808888888', '')).toContain('무료 수신 거부');
  });

  test('연달아 걸려도 placeholder가 겹치지 않는다', () => {
    const out = stripUnauthorizedBenefits('쿠폰 증정', '');
    expect(out.match(/\[혜택 안내 — 직접 수정해주세요\]/g)?.length).toBe(1);
  });
});

/** ★ 2026-08-02 Codex 5R — 원본 대조는 자리끼리, 토크나이저 경계. */
describe('stripUnauthorizedBenefits — 5R', () => {
  test('원본의 15% 할인이 5% 할인을 열어주지 않는다 — 부분 매치 금지', () => {
    expect(stripUnauthorizedBenefits('5% 할인해 드려요', '15% 할인 안내')).toContain(BENEFIT_PLACEHOLDER);
  });

  test('줄바꿈으로 쓴 무료배송도 잡는다 — 고정 문자열만 보면 그대로 나간다', () => {
    const out = stripUnauthorizedBenefits('이번 주만\n무료\n배송 해드려요', '');
    expect(out).toContain(BENEFIT_PLACEHOLDER);
    expect(out).not.toMatch(/무료\s*배송/);
  });

  test('줄바꿈 표기와 띄어쓰기 표기는 같은 자리로 본다', () => {
    expect(stripUnauthorizedBenefits('무료\n배송 해드려요', '무료 배송 행사')).toMatch(/무료\s*배송/);
  });

  test("'제1원칙'은 금액이 아니다 — 정상 문구를 지우지 않는다", () => {
    const src = '고객 만족을 제1원칙으로 삼습니다';
    expect(stripUnauthorizedBenefits(src, '')).toBe(src);
  });

  test('금액은 여전히 잡는다 — 경계 보강이 fail-open으로 이어지지 않는다', () => {
    expect(stripUnauthorizedBenefits('5000원 할인', '')).toContain(BENEFIT_PLACEHOLDER);
  });
});
