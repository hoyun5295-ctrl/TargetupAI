/**
 * DM 편집기 ↔ 발행 속성 계약 테스트 — 재발 방지책 1 (2026-07-14 신설).
 *
 * "편집기에서 고를 수 있는데 발행물엔 반영 안 되는" 이음새(#2 연결부·#3 줄바꿈·#5 폰트·#6 그라데이션 2색)를
 * 배포 전 자동 차단한다. dm-property-contract.ts(SoT)의 각 속성이 SSR·CSS 출력에서 실제로 소비되는지 밟는다.
 * 스냅샷은 "렌더됨"만 보지만, 이 테스트는 "속성 값이 바뀌면 출력이 실제로 달라지는가"를 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSection } from './dm-section-renderer';
import { renderDmDesign3Css, renderDmBaseCss, renderDmTokensCss, renderDmDividerSvg } from './dm-tokens';
import type { Section } from './dm-section-registry';
import { DM_BACKGROUNDS, DM_DIVIDERS, DM_NEWLINE_FIELDS, DM_IMAGE_FITS, DM_GALLERY_FULL_BLEED } from './dm-property-contract';

const NL = '줄1\n줄2';
const NL_BR = '줄1<br>줄2';

function mk(type: string, props: any, extra: Partial<Section> = {}): Section {
  return { id: 's1', type, order: 0, visible: true, props, ...extra } as Section;
}

describe('DM 편집기↔발행 속성 계약 (재발 방지책 1)', () => {
  // ── #3 개행: 모든 섹션·구도에서 입력 개행이 발행물에 보존 ──
  describe('개행 반영 (#3 — 편집기 2줄 = 발행물 2줄)', () => {
    for (const { type, treatment, field } of DM_NEWLINE_FIELDS) {
      it(`${type}/${treatment ?? 'classic'} — ${field} 개행 반영`, () => {
        const props: any =
          type === 'hero' ? { headline: '제목', sub_copy: '설명' } : { headline: '제목', body: '본문' };
        props[field] = NL;
        const html = renderSection(mk(type, props, treatment ? ({ treatment } as any) : {}), {} as any);
        if (field === 'body') {
          // 본문 = white-space:pre-wrap 로 개행 보존
          expect(html).toContain('white-space:pre-wrap');
          expect(html).toContain('줄1');
          expect(html).toContain('줄2');
        } else {
          // 헤드라인/서브카피 = \n→<br>
          expect(html, `${type}/${treatment}/${field} 이 개행을 <br>로 반영하지 않음`).toContain(NL_BR);
        }
      });
    }
  });

  // ── #2 연결부 착색: 배경면 변형마다 divider 색 규칙 존재 ──
  describe('하단 연결부 착색 (#2 — 색 있는 섹션서 연결부가 보이게)', () => {
    const css = renderDmDesign3Css();
    for (const bg of DM_BACKGROUNDS) {
      it(`배경면 ${bg} — divider 착색 규칙 존재`, () => {
        const hasRule =
          css.includes(`.dm-bgx-${bg} + .dm-divider-svg`) || css.includes(`.dm-bgx-${bg} .dm-divider-svg`);
        expect(hasRule, `.dm-bgx-${bg} 에 divider 착색 규칙이 없으면 연결부가 안 보인다`).toBe(true);
      });
    }
    for (const shape of DM_DIVIDERS) {
      it(`연결부 ${shape} — SSR SVG 방출`, () => {
        const html = renderSection(
          mk('text_card', { headline: 'A', body: 'B' }, { background: 'dark', divider_shape: shape } as any),
          {} as any,
        );
        expect(html).toContain('dm-divider-svg');
        expect(renderDmDividerSvg(shape)).toContain('<path');
      });
    }
  });

  // ── #6 그라데이션 2색: 두 번째 색 사용자 지정 소비 ──
  describe('그라데이션 2색 (#6)', () => {
    it('CSS 그라데이션 두 번째 색 = var(--dm-grad-to) 소비', () => {
      expect(renderDmDesign3Css()).toContain('var(--dm-grad-to');
    });
    it('accent_color_2 지정 시 SSR이 --dm-grad-to 주입', () => {
      const html = renderSection(
        mk('text_card', { headline: 'A', body: 'B' }, { background: 'gradient', accent_color_2: '#abcdef' } as any),
        {} as any,
      );
      expect(html).toContain('--dm-grad-to:#abcdef');
    });
  });

  // ── #1 상품 이미지 맞춤: cover/contain 이 출력에서 실제 달라짐 ──
  describe('상품 이미지 맞춤 (#1)', () => {
    const products = [{ id: 'p1', image_url: 'https://ex.com/a.jpg', name: '상품', price: 1000 }];
    for (const fit of DM_IMAGE_FITS) {
      it(`image_fit=${fit} — object-fit:${fit} 출력`, () => {
        const html = renderSection(mk('product_carousel', { products, image_fit: fit } as any), {} as any);
        expect(html).toContain(`object-fit:${fit}`);
      });
    }
  });

  // ── 갤러리 풀화면(full_bleed): 완성 이미지가 화면 꽉 참 (2026-07-15 서수란 신고) ──
  describe('갤러리 풀화면 (full_bleed — 완성 이미지 꽉 채우기)', () => {
    const img = [{ url: 'https://ex.com/a.jpg' }];
    for (const fb of DM_GALLERY_FULL_BLEED) {
      it(`full_bleed=${fb} — ${fb ? '섹션 패딩·이미지 라운드 0(꽉 참)' : '카드 프레임 유지(회귀 0)'}`, () => {
        const html = renderSection(mk('gallery', { images: img, layout: 'list_1xN', full_bleed: fb }), {} as any);
        if (fb) {
          expect(html, 'full_bleed면 섹션 패딩이 0이어야 화면 꽉 참').toContain('padding:0');
          expect(html, 'full_bleed면 이미지 라운드 제거').not.toContain('border-radius:var(--dm-radius-md)');
        } else {
          expect(html).toContain('var(--dm-sp-6) var(--dm-sp-5)');
          expect(html).toContain('border-radius:var(--dm-radius-md)');
        }
      });
    }
  });

  // ── #5 제작 폰트 = 출력 폰트 ──
  describe('제작 폰트 = 출력 폰트 (#5)', () => {
    it('토큰 --dm-font-primary = Pretendard 우선 스택', () => {
      const css = renderDmTokensCss();
      const line = css.split('\n').find((l) => l.includes('--dm-font-primary')) || '';
      expect(line).toContain('Pretendard');
      if (line.includes('Noto Sans KR')) {
        expect(line.indexOf('Pretendard')).toBeLessThan(line.indexOf('Noto Sans KR'));
      }
    });
    it('base CSS 본문 = var(--dm-font-primary) (하드코딩 폰트 금지)', () => {
      expect(renderDmBaseCss()).toContain('var(--dm-font-primary)');
    });
    it('발행 뷰어가 Pretendard 실로딩 + body Pretendard 스택', () => {
      const src = readFileSync(resolve(process.cwd(), 'src/utils/dm/dm-viewer.ts'), 'utf8');
      expect(src.toLowerCase(), '뷰어가 Pretendard 를 로드하지 않으면 편집기(Pretendard)와 서체가 달라진다').toContain(
        'pretendard',
      );
      const bodyLine = src.split('\n').find((l) => l.includes('body{font-family:')) || '';
      expect(bodyLine, '뷰어 body 폰트가 Pretendard 스택이어야 편집기와 일치').toContain('Pretendard');
    });
  });
});
