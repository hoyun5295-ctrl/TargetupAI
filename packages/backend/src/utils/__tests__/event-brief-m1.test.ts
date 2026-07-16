/**
 * ★ 2026-07-16 M1 — EventBrief 구조화 계약 테스트 (DM 재개편 설계서 §2-2·§2-4)
 *
 * 골든 1호 = 시세이도 실브리프(Harold 제공 2026-07-16). 검증 대상:
 *  - validateBriefAgainstText: 원문 실존 통과분만 브리프에 실림 (환각 차단)
 *  - copyFactsExistInText: 카피 출구 가드 (원문에 없는 수치 카피 탈락)
 *  - applyBriefToSections / repairBriefCoverage / computeBriefCoverage: 주입→보강→커버리지 게이트
 */

import { describe, it, expect } from 'vitest';
import {
  validateBriefAgainstText, extractLinksFromText, copyFactsExistInText,
  computeBriefCoverage, textContainsNormalized, nameTokensCovered, type EventBrief,
} from '../event-brief';
import { applyBriefToSections, repairBriefCoverage, sectionsFactText } from '../dm/dm-ai';
import { createSection } from '../dm/dm-section-registry';

// 골든 1호 — 시세이도 실브리프 (원문 구조 보존)
const SHISEIDO = `시세이도 리바이탈에센스 스킨 글로우 파운데이션 30ml
85,000원 → 15% 72,250원
https://brand.naver.com/shiseido/products/9090905782

[2+1 증정] 시세이도 NEW 파란자차 세트
134,000원 → 15% 113,900원
https://brand.naver.com/shiseido/products/6858932018

[2+1 증정] 시세이도 톤업 핑크자차 선크림 세트
134,000원 → 15% 113,900원
https://brand.naver.com/shiseido/products/8489922342

시세이도 싱크로 스킨 글로우 쿠션 컴팩트 세트
64,000원 → 15% 54,400원
https://brand.naver.com/shiseido/products/5558104855

시세이도 NEW 파란자차 50ml
67,000원 → 15% 56,950원
https://brand.naver.com/shiseido/products/5600875564

시세이도 얼티뮨 × LISA

얼티뮨 저속노화 세럼 구매 시,
리사의 싸인이 담긴 한정판 하트 거울 키링 + 리사 포토 엽서 증정
포토 엽서는 1매 랜덤 증정
한정 수량 — 조기 소진 가능`;

/** AI 추출 결과를 흉내낸 raw (정상 + 환각 혼합) */
const RAW_EXTRACT = {
  event_name: '시세이도 얼티뮨 × LISA',
  period_raw: null,
  period_end: null,
  place: null,
  brand: '시세이도',
  tone_hint: 'premium',
  benefits: [
    { target: '얼티뮨 저속노화 세럼 구매 시', content: '리사의 싸인이 담긴 한정판 하트 거울 키링 + 리사 포토 엽서 증정' },
    { target: null, content: '전 상품 30% 추가 할인' }, // 환각 — 원문에 없음
  ],
  notices: [
    '포토 엽서는 1매 랜덤 증정',
    '한정 수량 — 조기 소진 가능',
    '전 매장 주차 2시간 무료', // 환각
  ],
  products: [
    { name: '시세이도 리바이탈에센스 스킨 글로우 파운데이션 30ml', price: 85000, discount_price: 72250, discount_rate: 15, link_url: 'https://brand.naver.com/shiseido/products/9090905782' },
    { name: '[2+1 증정] 시세이도 NEW 파란자차 세트', price: 134000, discount_price: 113900, discount_rate: 15, link_url: 'https://brand.naver.com/shiseido/products/6858932018' },
    { name: '[2+1 증정] 시세이도 톤업 핑크자차 선크림 세트', price: 134000, discount_price: 113900, discount_rate: 15, link_url: 'https://brand.naver.com/shiseido/products/8489922342' },
    { name: '시세이도 싱크로 스킨 글로우 쿠션 컴팩트 세트', price: 64000, discount_price: 54400, discount_rate: 15, link_url: 'https://brand.naver.com/shiseido/products/5558104855' },
    { name: '시세이도 NEW 파란자차 50ml', price: 67000, discount_price: 56950, discount_rate: 15, link_url: 'https://brand.naver.com/shiseido/products/5600875564' },
    { name: '시세이도 미래 세럼', price: 99000 }, // 환각 — 가격 미실존
  ],
};

describe('골든 1호 — 시세이도 브리프 검증 (validateBriefAgainstText)', () => {
  const brief = validateBriefAgainstText(RAW_EXTRACT, SHISEIDO);

  it('상품 5종 전원 통과 + 환각 상품 탈락 + 링크 보존', () => {
    expect(brief.products).toHaveLength(5);
    expect(brief.products.every((p) => p.discount_rate === 15)).toBe(true);
    expect(brief.products.every((p) => !!p.link_url)).toBe(true);
    expect(brief.products.some((p) => p.name.includes('미래 세럼'))).toBe(false);
  });

  it('실존 혜택(LISA 증정)만 통과 — 환각 혜택(30% 추가 할인) 탈락', () => {
    expect(brief.benefits).toHaveLength(1);
    expect(brief.benefits[0].content).toContain('하트 거울 키링');
    expect(brief.benefits[0].target).toContain('얼티뮨');
  });

  it('실존 유의사항 2건만 통과 — 환각(주차 무료) 탈락', () => {
    expect(brief.notices).toEqual(['포토 엽서는 1매 랜덤 증정', '한정 수량 — 조기 소진 가능']);
  });

  it('행사명·브랜드 원문 실존 통과, 기간 없음 = null 정직', () => {
    expect(brief.event_name).toBe('시세이도 얼티뮨 × LISA');
    expect(brief.brand).toBe('시세이도');
    expect(brief.period_raw).toBeNull();
    expect(brief.period_end).toBeNull();
  });

  it('링크 5개 결정적 추출 (AI 무관)', () => {
    expect(brief.links).toHaveLength(5);
    expect(extractLinksFromText(SHISEIDO)).toHaveLength(5);
  });
});

describe('copyFactsExistInText — 카피 출구 가드', () => {
  it('원문 실존 수치 인용 = 통과', () => {
    expect(copyFactsExistInText('전 품목 15% 특별 혜택', SHISEIDO)).toBe(true);
    expect(copyFactsExistInText('72,250원에 만나보세요', SHISEIDO)).toBe(true);
    expect(copyFactsExistInText('2+1 증정 세트', SHISEIDO)).toBe(true);
  });
  it('원문에 없는 수치 = 탈락', () => {
    expect(copyFactsExistInText('전 품목 30% 할인', SHISEIDO)).toBe(false);
    expect(copyFactsExistInText('5만원 쿠폰 증정', SHISEIDO)).toBe(false);
  });
  it('수치 없는 분위기 카피 = 통과', () => {
    expect(copyFactsExistInText('당신의 피부를 위한 특별한 순간', SHISEIDO)).toBe(true);
  });
  it('★ Codex 1R — 숫자 경계: 34,000원은 원문 134,000원의 부분 문자열로 통과 불가', () => {
    expect(copyFactsExistInText('34,000원 특가', SHISEIDO)).toBe(false);
    expect(copyFactsExistInText('134,000원 세트', SHISEIDO)).toBe(true);
  });
  it('★ Codex 1R — 지어낸 비수치 혜택(무료배송·사은품·쿠폰) 탈락, 원문 실존(증정)은 통과', () => {
    expect(copyFactsExistInText('전 상품 무료 배송', SHISEIDO)).toBe(false);
    expect(copyFactsExistInText('사은품 가득', SHISEIDO)).toBe(false);
    expect(copyFactsExistInText('구매 시 키링 증정', SHISEIDO)).toBe(true);
  });
});

describe('★ Codex 1R — 조건(target) 소실 차단 + 파생 날짜 가드', () => {
  it('조건이 원문 실존 검증에 실패하면 혜택째 제외 (조건 없는 혜택으로 확대 금지)', () => {
    const brief = validateBriefAgainstText({
      benefits: [{ target: 'VVIP 다이아 회원 한정', content: '리사 포토 엽서 증정' }],
    }, SHISEIDO);
    expect(brief.benefits).toHaveLength(0);
  });
  it('커버리지 — 조건 있는 혜택은 조건까지 반영돼야 covered', () => {
    const brief = validateBriefAgainstText(RAW_EXTRACT, SHISEIDO);
    const contentOnly = JSON.stringify({ body: '리사의 싸인이 담긴 한정판 하트 거울 키링 + 리사 포토 엽서 증정' });
    expect(computeBriefCoverage(brief, contentOnly).missing.some((m) => m.kind === 'benefit')).toBe(true);
    const withTarget = JSON.stringify({ body: '얼티뮨 저속노화 세럼 구매 시 — 리사의 싸인이 담긴 한정판 하트 거울 키링 + 리사 포토 엽서 증정' });
    expect(computeBriefCoverage(brief, withTarget).missing.some((m) => m.kind === 'benefit')).toBe(false);
  });
  it('period_end 상식 가드 — 현재 ±400일 밖 파생 날짜는 폐기', () => {
    const txt = '봄맞이 세일 이번 주말까지 진행';
    const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    expect(validateBriefAgainstText({ period_raw: '이번 주말까지', period_end: soon }, txt).period_end).toBe(soon);
    expect(validateBriefAgainstText({ period_raw: '이번 주말까지', period_end: '2031-01-01' }, txt).period_end).toBeNull();
  });
});

describe('브리프 주입 → 보강 → 커버리지 게이트 (순수 조립)', () => {
  const brief = validateBriefAgainstText(RAW_EXTRACT, SHISEIDO);

  function baseSections() {
    const types = ['header', 'hero', 'product_carousel', 'cta', 'footer'] as const;
    return types.map((t, i) => createSection(t, `id-${t}`, i));
  }

  it('applyBriefToSections — 헤더 브랜드/행사명·빈 히어로 헤드라인 채움', () => {
    const out = applyBriefToSections(baseSections(), brief);
    const header: any = out.find((s) => s.type === 'header')!.props;
    expect(header.brand_name).toBe('시세이도');
    expect(header.event_title).toBe('시세이도 얼티뮨 × LISA');
  });

  it('기간 있는 브리프 — 카운트다운/쿠폰에 종료일 결정적 주입', () => {
    const withPeriod: EventBrief = { ...brief, period_raw: '이번 주말까지', period_end: '2026-07-20' };
    const secs = [createSection('countdown', 'cd', 0), createSection('coupon', 'cp', 1)];
    const out = applyBriefToSections(secs, withPeriod);
    expect((out[0].props as any).end_datetime).toBe('2026-07-20T23:59:59+09:00');
    expect((out[1].props as any).expire_date).toBe('2026-07-20');
  });

  it('전체 파이프라인 — 상품 주입 + 보강 후 커버리지 missing 0 (브로셔 기준)', () => {
    let sections = baseSections();
    // oneShot의 상품 주입 미러
    const carousel: any = sections.find((s) => s.type === 'product_carousel')!.props;
    carousel.products = brief.products.map((p, i) => ({ id: `p${i}`, image_url: '', name: p.name, price: p.price, discount_price: p.discount_price, discount_rate: p.discount_rate, link_url: p.link_url }));
    sections = applyBriefToSections(sections, brief);
    const first = computeBriefCoverage(brief, sectionsFactText(sections));
    // 보강 전 — LISA 혜택은 어느 섹션에도 없어 missing으로 정직 보고
    expect(first.missing.some((m) => m.kind === 'benefit')).toBe(true);
    const repaired = repairBriefCoverage(sections, brief, first.missing);
    const final = computeBriefCoverage(brief, sectionsFactText(repaired));
    expect(final.missing).toEqual([]); // 상품 5·혜택·유의 2·행사명·링크 5 전부 반영
    // 보강이 신설한 텍스트 카드에 혜택이 원문 그대로 인용됐는지
    const card: any = repaired.find((s) => s.type === 'text_card')!.props;
    expect(card.body).toContain('하트 거울 키링');
  });

  it('LISA 이벤트가 상품 카드에 뭉개지지 않는다 — 별도 텍스트 섹션 신설', () => {
    let sections = baseSections();
    const carousel: any = sections.find((s) => s.type === 'product_carousel')!.props;
    carousel.products = brief.products.map((p, i) => ({ id: `p${i}`, name: p.name, price: p.price, link_url: p.link_url }));
    sections = applyBriefToSections(sections, brief);
    const missing = computeBriefCoverage(brief, sectionsFactText(sections)).missing;
    const repaired = repairBriefCoverage(sections, brief, missing);
    expect(repaired.filter((s) => s.type === 'text_card')).toHaveLength(1);
    expect(repaired.filter((s) => s.type === 'product_carousel')).toHaveLength(1);
    // 순서 재부여 확인 (신설 삽입 후 order 연속)
    expect(repaired.map((s) => s.order)).toEqual(repaired.map((_, i) => i));
  });

  it('보강 불가 항목(추출 실패 상품)은 missing으로 남는다 — 조용한 누락 금지', () => {
    const sections = baseSections(); // 상품 미주입
    const missing = computeBriefCoverage(brief, sectionsFactText(sections)).missing;
    const repaired = repairBriefCoverage(sections, brief, missing);
    const final = computeBriefCoverage(brief, sectionsFactText(repaired));
    expect(final.missing.filter((m) => m.kind === 'product')).toHaveLength(5);
    expect(final.missing.filter((m) => m.kind === 'link')).toHaveLength(5);
  });
});

describe('보조 헬퍼', () => {
  it('textContainsNormalized — 공백·대소문자 무시', () => {
    expect(textContainsNormalized('한정 수량 — 조기 소진 가능', '한정수량—조기소진가능')).toBe(true);
  });
  it('nameTokensCovered — 토큰 절반 기준', () => {
    expect(nameTokensCovered('시세이도 NEW 파란자차 50ml', '{"name":"시세이도 NEW 파란자차 50ml"}')).toBe(true);
    expect(nameTokensCovered('다른 브랜드 완전 무관 상품', '{"name":"시세이도"}')).toBe(false);
  });
});
