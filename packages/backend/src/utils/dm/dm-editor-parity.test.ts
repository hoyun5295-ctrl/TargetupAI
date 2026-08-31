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
import { DM_BACKGROUNDS, DM_DIVIDERS, DM_NEWLINE_FIELDS, DM_IMAGE_FITS, DM_GALLERY_FULL_BLEED, DM_GALLERY_CAPTION_VISIBLE, DM_SLIDESHOW_PAUSE, DM_SLIDESHOW_RATIOS, DM_STORE_INFO_NEWLINE_FIELDS, DM_STORE_INFO_LABELS, DM_PRODUCT_CAROUSEL_SWIPE_MIN, DM_PRODUCT_CAROUSEL_PER_PAGE, DM_WIRED_ORPHAN_MARKERS } from './dm-property-contract';
import { parseTabProductList } from './dm-tab-content';
// FE 상품 붙여넣기 파서 원본(SoT) — 백엔드 미러(parseTabProductList)와 결과 일치 교차 고정
import { parsePastedProducts } from '../../../../frontend/src/utils/product-paste';

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
    // ★ 2026-07-21 (#4b 임은지) 커스텀 배경색 섹션 = 연결부도 그 색으로 착색(var(--dm-bg)=흰색 고정이면 색 있는 섹션서 안 보임)
    it('커스텀 background_color 섹션 — 연결부 인라인 착색', () => {
      const html = renderSection(
        mk('product_carousel', { products: [{ image_url: 'https://ex.com/a.jpg', name: 'P', price: 1000 }], background_color: '#c8ff00' }, { divider_shape: 'wave' } as any),
        {} as any,
      );
      expect(html).toMatch(/dm-divider-svg[^>]*style="color:#c8ff00"/);
    });
    it('배경색 미지정 섹션 — 연결부 인라인색 없음(CSS 담당·회귀 0)', () => {
      const html = renderSection(
        mk('product_carousel', { products: [{ image_url: 'https://ex.com/a.jpg', name: 'P', price: 1000 }] }, { divider_shape: 'wave' } as any),
        {} as any,
      );
      expect(html).toContain('dm-divider-svg" aria-hidden="true"><svg');
    });
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
    // ★ 2026-07-30 (임은지 0729 접수) 헤더 countdown/coupon = 자체 그라데이션이 래퍼를 덮으므로 끝 색을 직접 소비해야 한다.
    for (const variant of ['countdown', 'coupon'] as const) {
      it(`헤더 ${variant} — 그라데이션 끝 색 var(--dm-grad-to) 소비 + 주입값 전달`, () => {
        const html = renderSection(
          mk('header', { variant, brand_name: 'B', event_title: 'E', discount_label: 'D' }, { background: 'gradient', accent_color_2: '#abcdef' } as any),
          {} as any,
        );
        expect(html, `${variant} 헤더가 --dm-grad-to를 소비하지 않음`).toContain('var(--dm-grad-to');
        expect(html).toContain('--dm-grad-to:#abcdef');
      });
    }
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

  // ── 상품명 줄바꿈: 제품명 개행이 발행물에 <br>로 반영 (2026-07-22 직원 요청 — DM+이메일 공용) ──
  describe('상품명 줄바꿈 (제품명 \\n → <br>)', () => {
    const nlProducts = [
      { id: 'p1', image_url: 'https://ex.com/a.jpg', name: '줄1\n줄2', price: 1000 },
      { id: 'p2', image_url: 'https://ex.com/b.jpg', name: '다른\n상품', price: 2000 },
    ];
    for (const t of ['classic', 'focus', 'list']) {
      it(`product_carousel/${t} — 상품명 개행이 <br>로 반영`, () => {
        const html = renderSection(mk('product_carousel', { products: nlProducts }, t === 'classic' ? {} : ({ treatment: t } as any)), {} as any);
        expect(html, `${t} 구도가 상품명 개행을 <br>로 반영 안 함`).toContain('줄1<br>줄2');
      });
    }
  });

  // ── 히어로 이미지 맞춤: 완성 포스터를 히어로에 통짜(잘림 X)로 (2026-07-22) ──
  describe('히어로 이미지 맞춤 (완성 포스터 안 잘림)', () => {
    for (const fit of DM_IMAGE_FITS) {
      it(`hero image_fit=${fit} — object-fit:${fit} 출력`, () => {
        const html = renderSection(mk('hero', { headline: '제목', image_url: 'https://ex.com/a.jpg', image_fit: fit } as any), {} as any);
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

  // ── 갤러리 이미지별 캡션: 발행물에 "보이는 텍스트"로 표시 (2026-07-21 임은지 — alt만 쓰여 미표시였음) ──
  describe('갤러리 캡션 표시', () => {
    it('caption 지정 시 보이는 캡션(dm-gal-caption)으로 렌더 — alt 외 별도 표시', () => {
      expect(DM_GALLERY_CAPTION_VISIBLE).toBe(true);
      const html = renderSection(mk('gallery', { images: [{ url: 'https://ex.com/a.jpg', caption: '캡션테스트' }], layout: 'grid_2x2' }), {} as any);
      expect(html).toContain('dm-gal-caption');
      // alt 속성을 제거해도 캡션 텍스트가 남아야 = 화면 표시 노드로 존재(alt에만 있으면 실패)
      const withoutAlt = html.replace(/alt="[^"]*"/g, '');
      expect(withoutAlt, '캡션이 alt에만 있고 화면 표시가 없음').toContain('캡션테스트');
    });
    it('caption 미지정 시 캡션 div 미출력(회귀 0)', () => {
      const html = renderSection(mk('gallery', { images: [{ url: 'https://ex.com/a.jpg' }], layout: 'grid_2x2' }), {} as any);
      expect(html).not.toContain('dm-gal-caption');
    });
  });

  // ── 자동 슬라이드 일시정지 버튼: show_pause = 발행 컨트롤 + 뷰어 배선 (2026-07-21 임은지 — 종전 고아) ──
  describe('자동 슬라이드 일시정지 버튼', () => {
    const twoSlides = [{ image_url: 'https://ex.com/a.jpg' }, { image_url: 'https://ex.com/b.jpg' }];
    it('show_pause 기본(미지정) — 정지 컨트롤 렌더 + 뷰어가 실제 배선', () => {
      expect(DM_SLIDESHOW_PAUSE).toBe(true);
      const html = renderSection(mk('slideshow', { slides: twoSlides, interval_ms: 4000 }), {} as any);
      expect(html).toContain('data-dm-slide-pause');
      const viewer = readFileSync(resolve(process.cwd(), 'src/utils/dm/dm-viewer.ts'), 'utf8');
      expect(viewer, '뷰어가 data-dm-slide-pause 를 배선 안 하면 죽은 컨트롤').toContain('data-dm-slide-pause');
    });
    it('show_pause=false — 정지 컨트롤 미렌더', () => {
      const html = renderSection(mk('slideshow', { slides: twoSlides, show_pause: false }), {} as any);
      expect(html).not.toContain('data-dm-slide-pause');
    });
    it('슬라이드 1장 — 정지 컨트롤 미렌더(전환 없음)', () => {
      const html = renderSection(mk('slideshow', { slides: [{ image_url: 'https://ex.com/a.jpg' }] }), {} as any);
      expect(html).not.toContain('data-dm-slide-pause');
    });
    // ★ 2026-07-30 (남지현 접수) 슬라이드 크기 — slide_ratio가 발행물 출력에서 실제로 달라져야 한다.
    for (const ratio of DM_SLIDESHOW_RATIOS) {
      it(`slide_ratio=${ratio} — 발행물 이미지 스타일 소비`, () => {
        const html = renderSection(mk('slideshow', { slides: twoSlides, slide_ratio: ratio }), {} as any);
        if (ratio === 'original') {
          expect(html, 'original은 aspect-ratio 없이 원본 비율(height:auto)').toContain('width:100%;height:auto');
          expect(html).not.toContain('aspect-ratio');
        } else {
          const css = ratio === '1:1' ? '1/1' : ratio === '3:4' ? '3/4' : '16/9';
          expect(html).toContain(`aspect-ratio:${css};object-fit:cover`);
        }
      });
    }
    it('slide_ratio 미지정 — 기존 16:9 출력 그대로(무회귀)', () => {
      const html = renderSection(mk('slideshow', { slides: twoSlides }), {} as any);
      expect(html).toContain('width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--dm-radius-md)');
    });
  });

  // ── 고아 토글 전수 배선: 편집기 토글이 발행물/뷰어에 실제 소비 (2026-07-21) ──
  describe('고아 토글 배선', () => {
    const viewer = readFileSync(resolve(process.cwd(), 'src/utils/dm/dm-viewer.ts'), 'utf8');
    it('갤러리 확대(enable_zoom 기본 on) — 링크 없는 이미지 data-dm-zoom + 뷰어 라이트박스', () => {
      const html = renderSection(mk('gallery', { images: [{ url: 'https://ex.com/a.jpg' }], layout: 'grid_2x2' }), {} as any);
      expect(html).toContain(DM_WIRED_ORPHAN_MARKERS.gallery_enable_zoom);
      expect(viewer, '뷰어 라이트박스 미배선').toContain(DM_WIRED_ORPHAN_MARKERS.gallery_enable_zoom);
    });
    it('갤러리 링크 있는 이미지 / enable_zoom=false — zoom 미부여', () => {
      const linked = renderSection(mk('gallery', { images: [{ url: 'https://ex.com/a.jpg', link_url: 'https://shop.com' }], layout: 'grid_2x2' }), {} as any);
      expect(linked).not.toContain('data-dm-zoom');
      const off = renderSection(mk('gallery', { images: [{ url: 'https://ex.com/a.jpg' }], layout: 'grid_2x2', enable_zoom: false }), {} as any);
      expect(off).not.toContain('data-dm-zoom');
    });
    it('투표 복수 선택(allow_multiple) — data-dm-poll-multi + 투표하기 + 뷰어 배선', () => {
      const html = renderSection(mk('poll', { question: 'Q', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], allow_multiple: true }), {} as any);
      expect(html).toContain(DM_WIRED_ORPHAN_MARKERS.poll_allow_multiple);
      expect(html).toContain('data-dm-poll-submit');
      expect(viewer).toContain(DM_WIRED_ORPHAN_MARKERS.poll_allow_multiple);
    });
    it('투표 단일(기본) — 복수 마커 미출력(회귀 0)', () => {
      const html = renderSection(mk('poll', { question: 'Q', options: [{ id: 'a', label: 'A' }] }), {} as any);
      expect(html).not.toContain('data-dm-poll-multi');
      expect(html).not.toContain('data-dm-poll-submit');
    });
    it('설문 진행률(show_progress) — data-dm-survey-progress + 뷰어 배선', () => {
      const html = renderSection(mk('survey', { title: 'S', questions: [{ id: 'q1', type: 'text', question: 'Q1' }], show_progress: true }), {} as any);
      expect(html).toContain(DM_WIRED_ORPHAN_MARKERS.survey_show_progress);
      expect(viewer).toContain(DM_WIRED_ORPHAN_MARKERS.survey_show_progress);
    });
    it('설문 진행률 미설정 — 미출력(회귀 0)', () => {
      const html = renderSection(mk('survey', { title: 'S', questions: [{ id: 'q1', type: 'text', question: 'Q1' }] }), {} as any);
      expect(html).not.toContain('data-dm-survey-progress');
    });
    it('이메일 수집 완료 문구(success_text) — 발행 폼 data-success-text + 뷰어 소비(종전 고아)', () => {
      const html = renderSection(mk('email_capture', { headline: 'H', consent_text: 'C', success_text: '구독 감사합니다 특별문구' }), {} as any);
      expect(html, '발행 폼에 완료 문구가 data-success-text로 실려야').toContain(DM_WIRED_ORPHAN_MARKERS.email_success_text);
      expect(html).toContain('구독 감사합니다 특별문구');
      expect(viewer, '뷰어 폼 핸들러가 data-success-text 소비 안 하면 완료 문구가 죽은 옵션').toContain(DM_WIRED_ORPHAN_MARKERS.email_success_text);
    });
    it('이메일 수집 완료 문구 미지정 — data-success-text 미출력(회귀 0)', () => {
      const html = renderSection(mk('email_capture', { headline: 'H', consent_text: 'C' }), {} as any);
      expect(html).not.toContain('data-success-text');
    });
  });

  // ── 상품 슬라이드 가로 스와이프 + 인디케이터 (2026-07-21 임은지 — show_indicator/auto_slide 고아였음) ──
  describe('상품 슬라이드 스와이프 인디케이터', () => {
    const mkProducts = (n: number) => Array.from({ length: n }, (_, i) => ({ image_url: 'https://ex.com/a.jpg', name: 'P' + i, price: 1000 }));
    it(`상품 ${DM_PRODUCT_CAROUSEL_SWIPE_MIN}개 이상 — 가로 스와이프 + 인디케이터 + 뷰어 배선`, () => {
      const html = renderSection(mk('product_carousel', { products: mkProducts(DM_PRODUCT_CAROUSEL_SWIPE_MIN) }), {} as any);
      expect(html).toContain('data-dm-pcarousel');
      expect(html).toContain('data-dm-pc-dots');
      expect(html).toContain('scroll-snap-type:x mandatory');
      const viewer = readFileSync(resolve(process.cwd(), 'src/utils/dm/dm-viewer.ts'), 'utf8');
      expect(viewer, '뷰어가 data-dm-pcarousel 를 배선 안 하면 점이 죽은 컨트롤').toContain('data-dm-pcarousel');
    });
    it('상품 2개 — 기존 그리드(스와이프/점 미적용·회귀 0)', () => {
      const html = renderSection(mk('product_carousel', { products: mkProducts(2) }), {} as any);
      expect(html).not.toContain('data-dm-pcarousel');
      expect(html).not.toContain('data-dm-pc-dots');
    });
    it('show_indicator=false — 스와이프는 유지, 점만 미표시', () => {
      const html = renderSection(mk('product_carousel', { products: mkProducts(4), show_indicator: false }), {} as any);
      expect(html).toContain('data-dm-pcarousel');
      expect(html).not.toContain('data-dm-pc-dots');
    });
    // ★ 2026-07-22 (임은지 재신고) 점 = 페이지 단위(ceil(N/2)). 상품 1개당 1점(아이템 단위) 아님.
    const dotCount = (h: string) => (h.match(/data-dm-pc-dot=/g) || []).length;
    for (const [n, expected] of [[3, 2], [4, 2], [5, 3], [6, 3], [7, 4]] as const) {
      it(`상품 ${n}개 — 점 ${expected}개(ceil(${n}/${DM_PRODUCT_CAROUSEL_PER_PAGE}) 페이지 수)`, () => {
        const html = renderSection(mk('product_carousel', { products: mkProducts(n) }), {} as any);
        expect(dotCount(html), `상품 ${n}개인데 점이 페이지 수(${expected})가 아님 → 유령 페이지`).toBe(expected);
      });
    }
    it('스크롤 컨테이너 자식 = 페이지 래퍼(dm-pc-page)로 묶여 점↔페이지 1:1', () => {
      const html = renderSection(mk('product_carousel', { products: mkProducts(4) }), {} as any);
      const pageCount = (html.match(/dm-pc-page/g) || []).length;
      expect(pageCount, '상품 4개 → 페이지 래퍼 2개').toBe(2);
    });
    it('편집 캔버스(NewSections) 미러 — 페이지 래퍼 + 점=페이지수(편집=단말)', () => {
      const canvas = readFileSync(resolve(process.cwd(), '../frontend/src/components/dm/canvas/NewSections.tsx'), 'utf8');
      expect(canvas, '캔버스가 페이지 래퍼(dm-pc-page)로 안 묶으면 편집≠단말').toContain('dm-pc-page');
      expect(canvas, '캔버스 점이 상품수가 아니라 페이지수(pageCount) 기반이어야').toMatch(/length:\s*pageCount/);
    });
  });

  // ── 편집 캔버스 = 발행 SSR 미러 (2026-07-22 편집≠단말 전수 정정, 임은지) ──
  describe('편집 캔버스 = 발행 SSR 미러 (편집≠단말 전수)', () => {
    const canvasSrc = () => readFileSync(resolve(process.cwd(), '../frontend/src/components/dm/canvas/NewSections.tsx'), 'utf8');
    // 캔버스 컴포넌트 함수 본문만 잘라 대조(다른 섹션 마커 오염 방지)
    const block = (fn: string, next: string) => {
      const src = canvasSrc();
      const a = src.indexOf(`export function ${fn}`);
      const b = src.indexOf(`export function ${next}`);
      return src.slice(a, b === -1 ? undefined : b);
    };

    it('탭 카드 — 발행은 알약(pill) 탭, 캔버스도 알약 미러(밑줄 아님)', () => {
      const ssr = renderSection(mk('tab_cards', { tabs: [{ label: 'A', content: 'x' }, { label: 'B', content: 'y' }] }), {} as any);
      expect(ssr, '발행 탭이 알약(border-radius:999px)이어야').toContain('border-radius:999px');
      const tab = block('TabCardsSection', 'PollSection');
      expect(tab, '캔버스 탭이 알약(borderRadius 999) 미러 안 함 → 편집 밑줄 vs 단말 알약').toMatch(/borderRadius:\s*999/);
      expect(tab, '캔버스 탭에 밑줄(borderBottom) 잔존 = 발행 알약과 불일치').not.toContain('borderBottom');
    });

    it('참여 보상 — 발행은 [참여하기] 버튼, 캔버스도 버튼 미러(편집에 버튼 없던 갭)', () => {
      const ssr = renderSection(mk('click_rewards', { reward_type: 'like', target_count: 10, reward_description: 'R', show_progress: true }), {} as any);
      expect(ssr, '발행에 참여 버튼(data-dm-claim)').toContain('data-dm-claim');
      const cr = block('ClickRewardsSection', 'LuckyDrawSection');
      expect(cr, '캔버스에 [참여하기] 버튼 없음 = 편집엔 버튼 안 보임(단말엔 있음)').toContain('참여하기');
    });

    it('매장 찾기 지도 — 캔버스에 죽은 200px 회색 지도 상자 없음(발행 2026-07-07 제거분 미러)', () => {
      const map = block('MapStoreLocatorSection', 'ReviewsSection');
      expect(map, '캔버스에 죽은 지도 상자(height 200 회색) 잔존 = 편집엔 보이는데 단말엔 없음').not.toMatch(/height:\s*200/);
    });

    it('선착순 한정 — signup_url 있으면 발행은 링크, 캔버스도 링크 미러(항상 버튼 아님)', () => {
      const ssr = renderSection(mk('limited_quantity', { title: 'T', total_quantity: 100, signup_url: 'https://x.com' }), {} as any);
      expect(ssr, 'signup_url 있으면 발행은 링크(a href)').toContain('href=');
      const lq = block('LimitedQuantitySection', 'YoutubeEmbedSection');
      expect(lq, '캔버스가 signup_url을 링크로 미러 안 함(항상 버튼)').toContain('signup_url');
    });

    // ── F8 (임은지) 탭 카드 content_type = 이미지/상품목록 = 죽은 옵션 → 실제 렌더 구현 ──
    it('탭 content_type=image — 발행이 이미지(<img>)로 렌더(텍스트 아님)', () => {
      const html = renderSection(mk('tab_cards', { tabs: [{ label: '이미지', content_type: 'image', content: 'https://ex.com/a.jpg' }] }), {} as any);
      expect(html, 'image 탭이 <img>로 렌더돼야').toContain('<img');
      expect(html).toContain('a.jpg');
    });
    it('탭 content_type=product_list — 발행이 구조화 상품 행(링크 href+가격)으로 렌더(평문 아님)', () => {
      const content = '글로우 파운데이션\n85,000원 → 15% 72,250원\nhttps://ex.com/p/1';
      const html = renderSection(mk('tab_cards', { tabs: [{ label: '상품', content_type: 'product_list', content }] }), {} as any);
      expect(html, 'product_list가 상품명 렌더').toContain('글로우 파운데이션');
      // 평문 패널은 URL을 이스케이프 텍스트로만 두지만, 구조화 렌더는 링크(href)로 만든다 = 평문과 구별
      expect(html, 'product_list URL이 링크(href)로 렌더돼야 = 구조화(평문 아님)').toContain('href="https://ex.com/p/1"');
      expect(html, 'product_list 최종가 렌더').toContain('72,250원');
    });
    it('탭 상품목록 파서 = 상품 붙여넣기 파서(교차 패키지 결과 일치·창작 0)', () => {
      const fmt = '상품A\n10,000원\nhttps://ex.com/a\n\n상품B\n20,000원 → 10% 18,000원\nhttps://ex.com/b';
      expect(parseTabProductList(fmt)).toEqual(parsePastedProducts(fmt));
    });
    it('탭 카드 — 캔버스가 content_type(image/product_list) 분기 미러', () => {
      const tab = block('TabCardsSection', 'PollSection');
      expect(tab, "캔버스가 content_type='image'(이미지) 렌더 미러").toContain("=== 'image'");
      expect(tab, "캔버스가 content_type='product_list'(상품 목록) 렌더 미러").toContain('product_list');
    });

    // ── 2026-08-31 (임은지 cmtgmu3ws0536jnotc8z54i1c) 이미지 탭 링크 + 편집기 유형별 입력칸 ──
    it('탭 content_type=image + link_url — 발행이 이미지를 링크(<a href>)로 감싼다', () => {
      const html = renderSection(mk('tab_cards', {
        tabs: [{ label: '이미지', content_type: 'image', content: 'https://ex.com/a.jpg', link_url: 'https://ex.com/go' }],
      }), {} as any);
      expect(html, 'link_url이 있으면 <a href>로 감싸야 = 눌러서 이동').toContain('href="https://ex.com/go"');
      expect(html, '링크 안에 이미지가 그대로 있어야').toContain('a.jpg');
    });
    it('탭 content_type=image + link_url 미지정 — 옛 그대로 이미지만(회귀 0)', () => {
      const html = renderSection(mk('tab_cards', {
        tabs: [{ label: '이미지', content_type: 'image', content: 'https://ex.com/a.jpg' }],
      }), {} as any);
      expect(html, '주소가 없으면 링크로 감싸지 않는다').not.toContain('<a href');
      expect(html).toContain('<img');
    });
    it('탭 content_type=image + 위험 스킴 link_url — 링크로 나가지 않는다(새로 낸 입구의 방어)', () => {
      const html = renderSection(mk('tab_cards', {
        // eslint-disable-next-line no-script-url
        tabs: [{ label: '이미지', content_type: 'image', content: 'https://ex.com/a.jpg', link_url: 'javascript:alert(1)' }],
      }), {} as any);
      expect(html, 'javascript: 스킴이 href로 나가면 안 된다').not.toContain('javascript:');
      expect(html, '차단된 링크는 # 로 대체(safeUrl 계약)').toContain('href="#"');
    });
    it('탭 카드 — 캔버스가 이미지 링크(link_url) 분기 미러', () => {
      const tab = block('TabCardsSection', 'PollSection');
      expect(tab, '캔버스가 link_url을 읽어야 = 편집에서 링크 유무를 알 수 있다').toContain('link_url');
    });
    it('탭 편집기 — content_type마다 입력칸이 갈린다(셋 다 같은 글상자면 무엇을 넣을지 알 수 없다)', () => {
      const editor = readFileSync(
        resolve(process.cwd(), '../frontend/src/components/dm/panels/editors/TabCardsEditor.tsx'), 'utf8',
      );
      expect(editor, "이미지 유형은 업로더로 받아야(옛: placeholder '내용' 글상자 하나)").toContain('ImageUploader');
      expect(editor, '이미지 유형에 이동 주소 입력칸이 있어야').toContain('link_url');
      expect(editor, '상품 목록은 인식 결과를 그 자리에서 보여야(형식을 맞췄는지 발행 전에 안다)').toContain('parsePastedProducts');
      expect(editor, "유형별 안내가 있어야").toContain('TYPE_HINT');
    });

    // ── 설정한 경품이 단말 어디에도 안 보이던 것 노출 (룰렛 휠엔 라벨 없음 / 추첨 경품 미표시) ──
    it('룰렛 — 당첨 경품(prize_count>0) 라벨이 발행에 노출(휠엔 라벨 없어 경품 안내)', () => {
      const html = renderSection(mk('roulette', { segments: [{ id: '1', label: '1등', probability: 0.1, prize_count: 5, reward_description: '스타벅스 기프티콘' }, { id: '2', label: '꽝', probability: 0.9, prize_count: 0 }], one_spin_per_user: true }), {} as any);
      // reward_description은 data-segments(id·label만)에 없으므로, 이 문자열 노출 = 경품 칩이 실제 렌더됨(평문 data 아님)
      expect(html, '경품(prize_count>0) reward_description이 발행에 노출').toContain('스타벅스 기프티콘');
    });
    it('룰렛 — 경품 0개(전부 꽝) 시 경품 칩 미노출(회귀 0)', () => {
      const html = renderSection(mk('roulette', { segments: [{ id: '1', label: '꽝', probability: 1, prize_count: 0 }], one_spin_per_user: true }), {} as any);
      expect(html).not.toContain('data-dm-prize-chips');
    });
    it('추첨 — 경품 등급(prizes)이 발행에 노출(응모 유도)', () => {
      const html = renderSection(mk('lucky_draw', { title: 'T', form_fields: [{ name: 'phone', required: true }], consent_text: 'C', draw_at: '', prizes: [{ rank: 1, name: '에어팟', count: 2 }] }), {} as any);
      expect(html, '경품명이 발행에 노출').toContain('에어팟');
    });
    it('룰렛/추첨 경품 — 캔버스도 발행과 동일 노출 미러', () => {
      const rl = block('RouletteSection', 'InstantCouponSection');
      expect(rl, '캔버스 룰렛이 prize_count>0 경품 필터 미러').toContain('prize_count');
      const ld = block('LuckyDrawSection', 'RouletteSection');
      expect(ld, '캔버스 추첨이 경품(prizes) 노출 미러').toContain('props.prizes');
    });
  });

  // ── 매장/고객센터 편집=발송 파리티: 개행 보존 + 구도별 라벨 (2026-07-21 남지현) ──
  describe('매장/고객센터 파리티', () => {
    const base = { phone: '1661-6656', website: 'https://ex.com/', email: 'a@b.co', address: '서울시\n2층', business_hours: '월~금 10~17\n주말 휴무' };
    it('개행 보존 — business_hours·address white-space:pre-line (card·classic 양 구도)', () => {
      expect(DM_STORE_INFO_NEWLINE_FIELDS).toContain('business_hours');
      expect(DM_STORE_INFO_NEWLINE_FIELDS).toContain('address');
      for (const t of ['card', 'classic']) {
        const html = renderSection(mk('store_info', base, t === 'card' ? ({ treatment: 'card' } as any) : {}), {} as any);
        expect(html, `${t} 구도가 개행 보존(white-space:pre-line) 안 함 → 편집창 다줄, 단말 1줄`).toContain('white-space:pre-line');
        expect(html).toContain('주말 휴무');
      }
    });
    it('card 구도 — 라벨 웹/메일/영업 (캔버스 StoreInfoSection 미러 기준)', () => {
      const html = renderSection(mk('store_info', base, { treatment: 'card' } as any), {} as any);
      expect(html).toContain(DM_STORE_INFO_LABELS.card.website);       // 웹
      expect(html).not.toContain('홈페이지');
      expect(html).not.toContain('이메일');
      expect(html).not.toContain('영업시간');
    });
    it('classic 구도 — 라벨 홈페이지/이메일/영업시간', () => {
      const html = renderSection(mk('store_info', base, {}), {} as any);
      expect(html).toContain(DM_STORE_INFO_LABELS.classic.website);    // 홈페이지
      expect(html).toContain(DM_STORE_INFO_LABELS.classic.email);      // 이메일
      expect(html).toContain(DM_STORE_INFO_LABELS.classic.business_hours); // 영업시간
    });
  });

  // ── 2026-07-15 색·표시 옵션(남지현·임은지·서수란) — 편집기 값이 발행 SSR에 실제 소비 ──
  describe('색·표시 옵션 소비 (2026-07-15 신고 묶음)', () => {
    it('B1 헤더 제목색 — title_color가 출력에 반영', () => {
      const html = renderSection(mk('header', { variant: 'logo', brand_name: 'ACME', title_color: '#ff3366' }), { storeName: 'S' } as any);
      expect(html).toContain('#ff3366');
    });
    it('D1 헤더 브랜드명 표시 — show_brand_name=false면 브랜드 미출력', () => {
      const shown = renderSection(mk('header', { variant: 'logo', brand_name: 'ACME브랜드' }), { storeName: 'S' } as any);
      const hidden = renderSection(mk('header', { variant: 'logo', brand_name: 'ACME브랜드', show_brand_name: false }), { storeName: 'S' } as any);
      expect(shown).toContain('ACME브랜드');
      expect(hidden).not.toContain('ACME브랜드');
    });
    it('A3 CTA 버튼색 — buttons[].color가 출력에 반영(채움/외곽선)', () => {
      const fill = renderSection(mk('cta', { layout: 'stack', buttons: [{ label: '구매', url: 'https://x.com', style: 'primary', color: '#00aa88' }] }), {} as any);
      expect(fill).toContain('#00aa88');
      const outline = renderSection(mk('cta', { layout: 'stack', buttons: [{ label: '구매', url: 'https://x.com', style: 'outline', color: '#00aa88' }] }), {} as any);
      expect(outline).toContain('border-color:#00aa88');
    });
    it('A3 쿠폰 버튼색(2026-07-23 재정의) — button_color가 쿠폰코드 알약 배경에 반영', () => {
      const html = renderSection(mk('coupon', { discount_label: '20%', discount_type: 'percent', coupon_code: 'SAVE20', button_color: '#123abc' }), {} as any);
      expect(html).toContain('#123abc');
    });
    it('B2 상품 배경색·글씨공간색 — 출력에 반영', () => {
      const html = renderSection(mk('product_carousel', { products: [{ image_url: 'https://x.com/a.jpg', name: 'P', price: 1000 }], background_color: '#eef', caption_bg_color: '#fed' }), {} as any);
      expect(html).toContain('#eef');
      expect(html).toContain('#fed');
    });
    it('C1 상품 이미지 높이 — image_height가 출력 높이를 바꿈(sm 120 / lg 220)', () => {
      const sm = renderSection(mk('product_carousel', { products: [{ image_url: 'https://x.com/a.jpg', name: 'P', price: 1000 }], image_height: 'sm' }), {} as any);
      const lg = renderSection(mk('product_carousel', { products: [{ image_url: 'https://x.com/a.jpg', name: 'P', price: 1000 }], image_height: 'lg' }), {} as any);
      expect(sm).toContain('height:120px');
      expect(lg).toContain('height:220px');
    });
  });

  // ── 쿠폰/탭/즉시쿠폰 색·크기 분리 (2026-07-23 임은지) ──
  describe('쿠폰/탭/즉시쿠폰 색·크기 분리 (2026-07-23 임은지)', () => {
    it('쿠폰코드 알약 배경(button_color) — 반영', () => {
      const html = renderSection(mk('coupon', { discount_label: '20%', discount_type: 'percent', coupon_code: 'SAVE20', button_color: '#0a0b0c' }), {} as any);
      expect(html).toContain('background:#0a0b0c');
    });
    it('쿠폰코드 글씨색(code_text_color) — 반영', () => {
      const html = renderSection(mk('coupon', { discount_label: '20%', discount_type: 'percent', coupon_code: 'SAVE20', code_text_color: '#ff00aa' }), {} as any);
      expect(html).toContain('color:#ff00aa');
    });
    it('할인 라벨 글씨색(label_color) — 반영', () => {
      const html = renderSection(mk('coupon', { discount_label: '20%', discount_type: 'percent', label_color: '#abccba' }), {} as any);
      expect(html).toContain('color:#abccba');
    });
    it('쿠폰 카드 배경색(card_bg_color) — 반영', () => {
      const html = renderSection(mk('coupon', { discount_label: '20%', discount_type: 'percent', card_bg_color: '#123456' }), {} as any);
      expect(html).toContain('background:#123456');
    });
    it('쿠폰 색 미지정 — 기본값 유지(회귀 0: 코드 알약 #171717·카드 var(--dm-bg))', () => {
      const html = renderSection(mk('coupon', { discount_label: '20%', discount_type: 'percent', coupon_code: 'X' }), {} as any);
      expect(html).toContain('background:#171717');
      expect(html).toContain('background:var(--dm-bg)');
    });
    it('활성 탭 버튼 배경/글씨(tab_active_bg·tab_active_text_color) — 반영(미지정=#171717/#fff)', () => {
      const withColor = renderSection(mk('tab_cards', { tabs: [{ label: 'A', content: 'x' }], tab_active_bg: '#101112', tab_active_text_color: '#eeddcc' }), {} as any);
      expect(withColor).toContain('background:#101112');
      expect(withColor).toContain('color:#eeddcc');
      const plain = renderSection(mk('tab_cards', { tabs: [{ label: 'A', content: 'x' }] }), {} as any);
      expect(plain).toContain('#171717');
    });
    it('탭 버튼 글씨 크기 = 섹션 제목 크기(title_size→--dm-fs-tab), 본문 크기엔 영향 없음(--dm-fs-small 미참조)', () => {
      const titled = renderSection(mk('tab_cards', { tabs: [{ label: 'A', content: 'x' }] }, { title_size: 24 } as any), {} as any);
      expect(titled).toContain('--dm-fs-tab:24px');
      const btnPart = titled.slice(titled.indexOf('data-dm-tab='), titled.indexOf('data-dm-tab-panel='));
      expect(btnPart, '탭 버튼이 --dm-fs-tab(13px 폴백)만 참조해야 본문 크기와 분리').toContain('var(--dm-fs-tab, 13px)');
      expect(btnPart, '탭 버튼이 --dm-fs-small 참조 시 본문 크기가 버튼까지 바꿈(옛 버그)').not.toContain('--dm-fs-small');
    });
    it('즉시쿠폰 버튼 배경/글씨(button_bg_color·button_text_color) — 반영', () => {
      const html = renderSection(mk('instant_coupon', { coupon_label: 'L', discount_description: 'D', button_bg_color: '#334455', button_text_color: '#ccbbaa' }), {} as any);
      expect(html).toContain('background:#334455');
      expect(html).toContain('color:#ccbbaa');
    });
    it('즉시쿠폰 색 미지정 — 버튼 인라인 style 없음(회귀 0)', () => {
      const html = renderSection(mk('instant_coupon', { coupon_label: 'L', discount_description: 'D' }), {} as any);
      expect(html).toContain('class="dm-cta dm-cta-primary">쿠폰 받기');
    });
    it('캔버스 미러 — 쿠폰/탭/즉시쿠폰이 신규 색·크기 prop 소비(편집=발송)', () => {
      const coupon = readFileSync(resolve(process.cwd(), '../frontend/src/components/dm/canvas/CouponSection.tsx'), 'utf8');
      expect(coupon).toContain('card_bg_color');
      expect(coupon).toContain('code_text_color');
      expect(coupon).toContain('label_color');
      const ns = readFileSync(resolve(process.cwd(), '../frontend/src/components/dm/canvas/NewSections.tsx'), 'utf8');
      expect(ns).toContain('tab_active_bg');
      expect(ns).toContain('var(--dm-fs-tab, 13px)');
      expect(ns).toContain('button_bg_color');
    });
  });

  // ── A1 그라데이션 연결부 = 끝색(--dm-grad-to) 착색 (임은지) ──
  it('A1 그라데이션 하단 연결부 — --dm-grad-to 로 착색(시작색 아님)', () => {
    const css = renderDmDesign3Css();
    const rule = css.split('\n').find((l) => l.includes('.dm-bgx-gradient') && l.includes('.dm-divider-svg')) || '';
    expect(rule, '그라데이션 연결부가 --dm-grad-to 로 착색돼야 배경 끝색과 이어짐').toContain('--dm-grad-to');
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

// ── 상품 슬라이드 제목 크기·색 (2026-08-26 임은지 접수 — 이메일과 함께 신설) ──
describe('상품 슬라이드 제목 크기·색 — 세 구도 전부 소비', () => {
  const P = [{ image_url: 'https://x.com/a.jpg', name: 'P', price: 1000 }];
  const render = (props: any, treatment?: string) =>
    renderSection(mk('product_carousel', { products: P, ...props }, treatment ? ({ treatment } as any) : {}), {} as any);

  for (const t of [undefined, 'list', 'focus']) {
    const label = t || 'classic';
    it(`[${label}] title_color가 제목 색으로 실린다`, () => {
      expect(render({ title: '가을 감사제', title_color: '#ff3366' }, t)).toContain('#ff3366');
    });
    it(`[${label}] title_size가 제목 크기를 바꾼다`, () => {
      const sm = render({ title: '가을 감사제', title_size: 'sm' }, t);
      const md = render({ title: '가을 감사제' }, t);
      const lg = render({ title: '가을 감사제', title_size: 'lg' }, t);
      expect(sm).not.toBe(md);
      expect(lg).not.toBe(md);
      expect(sm).not.toBe(lg);
    });
    it(`[${label}] 미지정이면 제목 출력이 현행 그대로(무회귀)`, () => {
      const html = render({ title: '가을 감사제' }, t);
      expect(html).toContain('class="dm-text-h2"');
      expect(html).toContain('color:var(--dm-neutral-900);margin-bottom:var(--dm-sp-4)"');
    });
  }
});
