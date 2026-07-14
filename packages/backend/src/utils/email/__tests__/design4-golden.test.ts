/**
 * ★ 디자인 4.0 M0 — 이메일 골든 스냅샷 (2026-07-14)
 *
 * design-core 이관(M1~M3) 전 이메일 렌더러 출력을 동결.
 * 값 무변 이관 원칙 — M2(코어 소비 전환) 후에도 이 스냅샷은 그대로 통과해야 한다.
 * 시간 종속 요소(쿠폰 마감 표시 등)는 fixture에서 제외 — 스냅샷 결정성 보장.
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections } from '../email-section-renderer';
import { resolveEmailBrand, normalizeEmailDesign } from '../email-tokens';
import type { Section } from '../../dm/dm-section-registry';

const sec = (type: string, props: Record<string, unknown>, order = 0, extra: Record<string, unknown> = {}): Section =>
  ({ id: `g-${type}-${order}`, type, order, visible: true, props, ...extra } as unknown as Section);

/** 레거시 대표 — design 미설정(기존 캠페인) */
const LEGACY: Section[] = [
  sec('header', { variant: 'logo', brand_name: '한줄로상회' }, 0),
  sec('hero', { headline: '가을 신상품 안내', sub_copy: '먼저 만나보세요' }, 1),
  sec('text_card', { tag: 'NEW', headline: '이번 시즌 포인트', body: '따뜻한 소재의 신상품이 들어왔어요.' }, 2),
  sec('coupon', { discount_label: '[직접 작성해주세요]', coupon_code: 'GOLDEN' }, 3),
  sec('cta', { buttons: [{ label: '보러가기', url: 'https://shop.example.com', style: 'primary' }] }, 4),
  sec('footer', { notes: '본 메일은 안내입니다', cs_phone: '1544-0000' }, 5),
];

/** 디자인 3.0 대표 — 테마(에디토리얼 상당) design + 구도 패치 */
const THEMED: Section[] = [
  sec('header', { variant: 'logo', brand_name: '한줄로상회' }, 0),
  sec('hero', { headline: '가을 신상품 안내', sub_copy: '먼저 만나보세요' }, 1, { treatment: 'typographic' }),
  sec('text_card', { tag: 'NEW', headline: '이번 시즌 포인트', body: '따뜻한 소재의 신상품이 들어왔어요.' }, 2, { treatment: 'lead' }),
  sec('coupon', { discount_label: '[직접 작성해주세요]', coupon_code: 'GOLDEN' }, 3, { treatment: 'spotlight' }),
  sec('cta', { buttons: [{ label: '보러가기', url: 'https://shop.example.com', style: 'primary' }] }, 4, { treatment: 'bar' }),
  sec('footer', { notes: '본 메일은 안내입니다', cs_phone: '1544-0000' }, 5),
];

// FE email-themes.ts editorial 테마와 동일 값(미러) — M3에서 동기 테스트로 기계 고정
const EDITORIAL_DESIGN = {
  theme: 'editorial',
  palette: { primary: '#111827', accent: '#b45309', background: '#ffffff' },
  font_display: '"Noto Serif KR", serif',
  art_direction: { typeScale: 'editorial', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'hairline' },
};

// 다크 발송물(럭셔리 다크 상당) — 다크 셸 중립 반전 경로 동결
const LUXURY_DARK_DESIGN = {
  theme: 'luxury-dark',
  palette: { primary: '#b89150', accent: '#d4af37', background: '#0e1018' },
  font_display: '"Noto Serif KR", serif',
  art_direction: { typeScale: 'editorial', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'rule' },
};

describe('M0 골든 — 이메일 브랜드 해석(resolveEmailBrand)', () => {
  it('미설정 = 기본 브랜드 값 동결', () => {
    expect(resolveEmailBrand(null, null)).toMatchSnapshot();
  });

  it('에디토리얼 design 적용 값 동결', () => {
    expect(resolveEmailBrand(null, normalizeEmailDesign(EDITORIAL_DESIGN))).toMatchSnapshot();
  });

  it('다크 배경 = 중립 반전 값 동결', () => {
    expect(resolveEmailBrand(null, normalizeEmailDesign(LUXURY_DARK_DESIGN))).toMatchSnapshot();
  });
});

describe('M0 골든 — 이메일 발행물 렌더', () => {
  it('레거시 대표(design 미설정) 렌더 동결', () => {
    expect(renderEmailSections(LEGACY, {})).toMatchSnapshot();
  });

  it('에디토리얼 테마 렌더 동결', () => {
    expect(renderEmailSections(THEMED, { design: normalizeEmailDesign(EDITORIAL_DESIGN) })).toMatchSnapshot();
  });

  it('럭셔리 다크(다크 셸) 렌더 동결', () => {
    expect(renderEmailSections(THEMED, { design: normalizeEmailDesign(LUXURY_DARK_DESIGN) })).toMatchSnapshot();
  });
});
