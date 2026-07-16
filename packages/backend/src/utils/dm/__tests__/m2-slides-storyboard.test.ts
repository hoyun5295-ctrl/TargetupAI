/**
 * ★ 2026-07-16 M2 — 슬라이드 스토리보드 밀도 규칙 계약 테스트 (설계서 §2-3)
 *
 * 목표: "섹션 1개짜리 헐렁한 장"이 구조적으로 안 나온다.
 *  - 표지 = header+hero(+직후 countdown)
 *  - 리치 섹션(상품·이미지·인터랙션, 콘텐츠 실존)만 단독 장 허용
 *  - 얇은 섹션은 2~3개 묶음, 끝에 홀로 남으면 앞 장에 병합
 *  - footer 단독 장 금지 (마지막 장 병합)
 */

import { describe, it, expect } from 'vitest';
import { splitSectionsIntoPages, decideLayoutMode, isRichSolo } from '../dm-page-split';
import { createSection, type Section, type SectionType } from '../dm-section-registry';

function make(types: SectionType[], enrich?: (s: Section) => void): Section[] {
  return types.map((t, i) => {
    const s = createSection(t, `${t}-${i}`, i);
    enrich?.(s);
    return s;
  });
}

function fillProducts(s: Section, n: number) {
  (s.props as any).products = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `상품${i}`, price: 1000 * (i + 1) }));
}

describe('밀도 규칙 — 헐렁한 장 구조적 차단', () => {
  it('시세이도형 구성(헤더·히어로·상품5·텍스트·CTA·푸터) — 전 장이 알차다', () => {
    const secs = make(['header', 'hero', 'product_carousel', 'text_card', 'cta', 'footer']);
    fillProducts(secs[2], 5);
    const pages = splitSectionsIntoPages(secs, 'slides');
    // 표지(header+hero) / 상품 단독(리치) / text_card+cta+footer 묶음
    expect(pages.map((p) => p.map((s) => s.type))).toEqual([
      ['header', 'hero'],
      ['product_carousel'],
      ['text_card', 'cta', 'footer'],
    ]);
    // 얇은 섹션 단독 장 0 (리치 제외 모든 장 = 2개 이상)
    for (const p of pages) {
      if (p.length === 1) expect(isRichSolo(p[0])).toBe(true);
    }
  });

  it('표지에 직후 countdown 편입 — 기간 긴급감이 표지에', () => {
    const secs = make(['header', 'hero', 'countdown', 'coupon', 'cta', 'footer']);
    const pages = splitSectionsIntoPages(secs, 'slides');
    expect(pages[0].map((s) => s.type)).toEqual(['header', 'hero', 'countdown']);
    expect(pages[1].map((s) => s.type)).toEqual(['coupon', 'cta', 'footer']);
  });

  it('hero 없는 header = 표지 승격 금지(헐렁 차단) — 얇은 흐름 3개 상한 묶음', () => {
    const secs = make(['header', 'text_card', 'coupon', 'promo_code', 'cta', 'footer']);
    const pages = splitSectionsIntoPages(secs, 'slides');
    const shapes = pages.map((p) => p.map((s) => s.type));
    expect(shapes).toEqual([
      ['header', 'text_card', 'coupon'],
      ['promo_code', 'cta', 'footer'],
    ]);
  });

  it('리치 장 뒤 홀로 남은 CTA = 리치 장에 병합 (상품 아래 CTA — 자연 밀도)', () => {
    const secs = make(['header', 'hero', 'product_carousel', 'cta'], (s) => {
      if (s.type === 'product_carousel') fillProducts(s, 3);
    });
    const pages = splitSectionsIntoPages(secs, 'slides');
    expect(pages.map((p) => p.map((s) => s.type))).toEqual([
      ['header', 'hero'],
      ['product_carousel', 'cta'],
    ]);
  });

  it('★ Codex 1R — 리치 직전 홀로 남은 얇은 섹션도 리치 장에 동승 (헐렁한 중간 장 차단)', () => {
    const secs = make(['header', 'hero', 'text_card', 'product_carousel', 'footer'], (s) => {
      if (s.type === 'product_carousel') fillProducts(s, 3);
    });
    const pages = splitSectionsIntoPages(secs, 'slides');
    expect(pages.map((p) => p.map((s) => s.type))).toEqual([
      ['header', 'hero'],
      ['text_card', 'product_carousel', 'footer'],
    ]);
  });

  it('★ Codex 1R — 프론트 미러(dmBuilderStore) 동기 게이트: 리치 목록·묶음 상한 동일', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const { resolve } = require('path') as typeof import('path');
    const feSrc = readFileSync(resolve(__dirname, '../../../../../frontend/src/stores/dmBuilderStore.ts'), 'utf-8');
    // 묶음 상한 동일
    expect(feSrc).toContain('THIN_PAGE_MAX = 3');
    // 리치 타입 목록 동일 (백엔드 소스에서 추출해 프론트에 전부 존재하는지)
    const beSrc = readFileSync(resolve(__dirname, '../dm-page-split.ts'), 'utf-8');
    const beList = beSrc.match(/RICH_SOLO_TYPES[^=]*=\s*\[([\s\S]*?)\]/)![1];
    const types = [...beList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(types.length).toBeGreaterThanOrEqual(10);
    for (const t of types) {
      expect(feSrc.includes(`'${t}'`), `프론트 미러에 리치 타입 누락: ${t}`).toBe(true);
    }
    // 밀도 알고리즘 핵심 함수 존재
    expect(feSrc).toContain('isRichSoloSection');
  });

  it('빈 상품 캐러셀(상품 0)은 리치 아님 — 단독 장 금지, 이웃과 묶임', () => {
    const secs = make(['header', 'hero', 'product_carousel', 'cta', 'footer']);
    // products 미주입 (빈 placeholder)
    const pages = splitSectionsIntoPages(secs, 'slides');
    const shapes = pages.map((p) => p.map((s) => s.type));
    expect(shapes).toEqual([
      ['header', 'hero'],
      ['product_carousel', 'cta', 'footer'],
    ]);
  });

  it('footer 단독 장 금지 — 항상 마지막 장 병합', () => {
    const secs = make(['header', 'hero', 'gallery', 'footer'], (s) => {
      if (s.type === 'gallery') (s.props as any).images = [{ url: '/a.jpg' }];
    });
    const pages = splitSectionsIntoPages(secs, 'slides');
    const last = pages[pages.length - 1].map((s) => s.type);
    expect(last).toContain('footer');
    expect(last.length).toBeGreaterThanOrEqual(2);
  });

  it('scroll 모드 = 한 장 (무변)', () => {
    const secs = make(['header', 'hero', 'cta', 'footer']);
    expect(splitSectionsIntoPages(secs, 'scroll')).toHaveLength(1);
  });

  it('decideLayoutMode — 시각 카드형 있으면 slides (기존 동작 보존)', () => {
    const withCarousel = make(['header', 'product_carousel', 'footer']);
    const plain = make(['header', 'text_card', 'footer']);
    expect(decideLayoutMode(withCarousel)).toBe('slides');
    expect(decideLayoutMode(plain)).toBe('scroll');
  });

  it('전 섹션 순서·개수 보존 (분할은 재배치가 아니다)', () => {
    const secs = make(['header', 'hero', 'countdown', 'product_carousel', 'text_card', 'cta', 'sns', 'footer']);
    fillProducts(secs[3], 3);
    const pages = splitSectionsIntoPages(secs, 'slides');
    const flat = pages.flat().map((s) => s.id);
    expect(flat).toEqual(secs.map((s) => s.id));
  });
});
