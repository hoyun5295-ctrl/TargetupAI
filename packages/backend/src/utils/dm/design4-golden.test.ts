/**
 * ★ 디자인 4.0 M0 — DM 골든 스냅샷 (2026-07-14)
 *
 * 목적: design-core 이관(M1~M3) 전 기존 발행물 렌더 출력을 바이트 단위로 동결.
 * 값 무변 이관이 원칙이므로 이 스냅샷은 M2(코어 소비 전환) 후에도 그대로 통과해야 한다.
 * 스냅샷이 깨지면 = 이관이 값을 바꿨다는 뜻 → 즉시 롤백 신호.
 *
 * 시간 종속 섹션(countdown)은 제외 — 스냅샷 결정성 보장.
 */
import { describe, it, expect } from 'vitest';
import { renderSections } from './dm-section-renderer';
import type { Section } from './dm-section-registry';
import { renderDmTokensCss, renderDmBaseCss, renderDmDesign3Css, renderDmDividerSvg } from './dm-tokens';
import { normalizeArtDirection, artDirectionToCssVars, selectTreatment } from './dm-art-direction';

const sec = (type: string, props: Record<string, unknown>, order = 0, extra: Partial<Section> = {}): Section =>
  ({ id: `g-${type}-${order}`, type, order, visible: true, props, ...extra } as unknown as Section);

/** 레거시 대표 발행물 — 디자인 3.0 이전 스타일(구도·배경·아트디렉션 전부 미설정) */
const LEGACY_SECTIONS: Section[] = [
  sec('header', { variant: 'logo', brand_name: '한줄로상회' }, 0),
  sec('hero', { headline: '가을 신상품 안내', sub_copy: '먼저 만나보세요' }, 1),
  sec('text_card', { tag: 'NEW', headline: '이번 시즌 포인트', body: '따뜻한 소재의 신상품이 들어왔어요.' }, 2),
  sec('coupon', { discount_label: '[직접 작성해주세요]', coupon_code: 'GOLDEN' }, 3),
  sec('cta', { buttons: [{ label: '보러가기', url: 'https://shop.example.com', style: 'primary' }] }, 4),
  sec('store_info', { store_name: '본점', address: '서울시 어딘가 1', phone: '02-000-0000' }, 5),
  sec('footer', { notes: '본 메시지는 안내입니다', cs_phone: '1544-0000' }, 6),
];

/** 디자인 3.0 대표 발행물 — 구도/배경/아트디렉션 설정(에디토리얼 테마 상당) */
const THEMED_SECTIONS: Section[] = [
  sec('header', { variant: 'logo', brand_name: '한줄로상회' }, 0),
  sec('hero', { headline: '가을 신상품 안내', sub_copy: '먼저 만나보세요' }, 1, { treatment: 'typographic' } as Partial<Section>),
  sec('text_card', { tag: 'NEW', headline: '이번 시즌 포인트', body: '따뜻한 소재의 신상품이 들어왔어요.' }, 2, { treatment: 'lead' } as Partial<Section>),
  sec('coupon', { discount_label: '[직접 작성해주세요]', coupon_code: 'GOLDEN' }, 3, { treatment: 'spotlight' } as Partial<Section>),
  sec('cta', { buttons: [{ label: '보러가기', url: 'https://shop.example.com', style: 'primary' }] }, 4, { treatment: 'bar' } as Partial<Section>),
  sec('footer', { notes: '본 메시지는 안내입니다', cs_phone: '1544-0000' }, 5),
];

describe('M0 골든 — DM 토큰/베이스/디자인3 CSS', () => {
  it('renderDmTokensCss 기본(브랜드킷 미설정)', () => {
    expect(renderDmTokensCss()).toMatchSnapshot();
  });

  it('renderDmTokensCss 브랜드킷(라이트) 적용', () => {
    expect(
      renderDmTokensCss({ primary_color: '#111827', accent_color: '#b45309', background_color: '#ffffff', font_display: '"Noto Serif KR", serif' }),
    ).toMatchSnapshot();
  });

  it('renderDmTokensCss 다크 배경 = 중립 반전 포함', () => {
    expect(
      renderDmTokensCss({ primary_color: '#b89150', accent_color: '#d4af37', background_color: '#0e1018' }),
    ).toMatchSnapshot();
  });

  it('renderDmBaseCss / renderDmDesign3Css / divider svg', () => {
    expect(renderDmBaseCss()).toMatchSnapshot();
    expect(renderDmDesign3Css()).toMatchSnapshot();
    expect(renderDmDividerSvg('wave')).toMatchSnapshot();
  });
});

describe('M0 골든 — DM 아트디렉션 정규화·CSS 변수', () => {
  it('미설정 = 중립 기본(bold/standard) — 기존 발행물 동작', () => {
    const ad = normalizeArtDirection(null, 'general');
    expect(ad).toMatchSnapshot();
    expect(artDirectionToCssVars(ad)).toMatchSnapshot();
  });

  it('타입스케일 3종 CSS 변수 값 동결', () => {
    for (const ts of ['editorial', 'bold', 'minimal'] as const) {
      const ad = normalizeArtDirection({ typeScale: ts }, 'general');
      expect(artDirectionToCssVars(ad)).toMatchSnapshot(`typeScale-${ts}`);
    }
  });

  it('밀도 3종 CSS 변수 값 동결', () => {
    for (const d of ['compact', 'standard', 'airy'] as const) {
      const ad = normalizeArtDirection({ spacingDensity: d }, 'general');
      expect(artDirectionToCssVars(ad)).toMatchSnapshot(`density-${d}`);
    }
  });

  it('구도 선택 fail-closed 동작 동결', () => {
    expect(selectTreatment('hero', 'typographic', {})).toBe('typographic');
    expect(selectTreatment('hero', 'nope', {})).toBe('classic');
    expect(selectTreatment('unknown_section', 'split', {})).toBe('classic');
  });
});

describe('M0 골든 — DM 발행물 렌더', () => {
  it('레거시 대표(전부 미설정) 렌더 동결', () => {
    expect(renderSections(LEGACY_SECTIONS, {})).toMatchSnapshot();
  });

  it('디자인 3.0 대표(구도+아트디렉션) 렌더 동결', () => {
    const ad = normalizeArtDirection(
      { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'hairline' },
      'general', 'premium',
    );
    expect(
      renderSections(THEMED_SECTIONS, {
        brandKit: { primary_color: '#111827', accent_color: '#b45309', background_color: '#ffffff' },
        artDirection: ad,
      }),
    ).toMatchSnapshot();
  });
});
