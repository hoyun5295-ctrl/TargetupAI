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
import { DM_BACKGROUNDS, DM_DIVIDERS, DM_NEWLINE_FIELDS, DM_IMAGE_FITS, DM_GALLERY_FULL_BLEED, DM_GALLERY_CAPTION_VISIBLE, DM_SLIDESHOW_PAUSE, DM_STORE_INFO_NEWLINE_FIELDS, DM_STORE_INFO_LABELS, DM_PRODUCT_CAROUSEL_SWIPE_MIN, DM_WIRED_ORPHAN_MARKERS } from './dm-property-contract';

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
    it('A3 쿠폰 버튼색 — button_color가 출력에 반영', () => {
      const html = renderSection(mk('coupon', { discount_label: '20%', discount_type: 'percent', cta_url: 'https://x.com', button_color: '#123abc' }), {} as any);
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
