/**
 * 이메일 편집기 파리티 — "편집기에서 고를 수 있는데 발송 HTML엔 반영 안 됨"을 배포 전에 막는다.
 * `dm-editor-parity.test.ts`의 이메일 판. 근거표 = `email-property-contract.ts`.
 *
 * 소스 스캔이 아니라 **행동 테스트**다 — 값을 바꿔 렌더하고 출력이 실제로 달라지는지 밟는다
 * (LESSONS_BACKEND 2026-08-01 · 토큰 존재만 보는 검사는 조건 반전을 못 잡는다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderEmailSections } from '../email-section-renderer';
import { EMAIL_PRODUCT_TREATMENTS, EMAIL_PRODUCT_IMG_HEIGHT, EMAIL_PRODUCT_LIST_THUMB, EMAIL_PRODUCT_CAROUSEL_PROPS, EMAIL_HERO_PROPS, EMAIL_HERO_IMAGE_TREATMENTS, EMAIL_HERO_HEIGHT, EMAIL_DESIGN_PROPS, EMAIL_HEADER_PROPS, EMAIL_CTA_BUTTON_PROPS, EMAIL_CTA_BUTTON_STYLES, EMAIL_COUPON_PROPS, EMAIL_COUPON_TREATMENTS, EMAIL_SECTION_MOTIF_OFF, EMAIL_MOTIF_SECTIONS } from '../email-property-contract';
import type { Section } from '../../dm/dm-section-registry';

const PRODUCTS = [
  { image_url: 'https://x.example.com/a.jpg', name: '상품 A', price: 20000, discount_price: 15000, link_url: 'https://shop.example.com/a' },
  { image_url: 'https://x.example.com/b.jpg', name: '상품 B', price: 30000 },
  { image_url: 'https://x.example.com/c.jpg', name: '상품 C', price: 40000 },
];

const carousel = (props: Record<string, unknown>, treatment?: string): Section =>
  ({ id: 's-pc', type: 'product_carousel', order: 0, visible: true, treatment, props: { products: PRODUCTS, ...props } } as unknown as Section);

const render = (props: Record<string, unknown>, treatment?: string) =>
  renderEmailSections([carousel(props, treatment)], {});

describe('상품 슬라이드 — 편집기 속성이 이메일 발송 HTML에 반영된다', () => {
  for (const t of EMAIL_PRODUCT_TREATMENTS) {
    it(`[${t}] 글씨공간 색(caption_bg_color)이 출력에 실린다`, () => {
      expect(render({ caption_bg_color: '#e74b4b' }, t)).toContain('#e74b4b');
    });

    it(`[${t}] 배경색(background_color)이 출력에 실린다`, () => {
      expect(render({ background_color: '#f06060' }, t)).toContain('#f06060');
    });

    it(`[${t}] 이미지 맞춤(image_fit=contain)이 출력을 바꾼다`, () => {
      expect(render({ image_fit: 'contain' }, t)).toContain('object-fit:contain');
      expect(render({}, t)).not.toContain('object-fit:contain');
    });
  }

  it('[classic] 이미지 높이(image_height)가 출력 높이를 바꾼다 · md = 현행 200', () => {
    expect(render({ image_height: 'sm' })).toContain(`height:${EMAIL_PRODUCT_IMG_HEIGHT.sm}px`);
    expect(render({ image_height: 'lg' })).toContain(`height:${EMAIL_PRODUCT_IMG_HEIGHT.lg}px`);
    expect(render({})).toContain(`height:${EMAIL_PRODUCT_IMG_HEIGHT.md}px`);
  });

  it('[list] 썸네일 높이도 image_height를 따른다 · md = 현행 96', () => {
    expect(render({ image_height: 'sm' }, 'list')).toContain(`height:${EMAIL_PRODUCT_LIST_THUMB.sm}px`);
    expect(render({ image_height: 'lg' }, 'list')).toContain(`height:${EMAIL_PRODUCT_LIST_THUMB.lg}px`);
    expect(render({}, 'list')).toContain(`height:${EMAIL_PRODUCT_LIST_THUMB.md}px`);
  });

  it('이미지 정렬(image_focus)이 채우기일 때 출력을 바꾼다', () => {
    expect(render({ image_focus: 'top' })).toContain('object-position:center top');
    expect(render({ image_focus: 'bottom' })).toContain('object-position:center bottom');
  });
});

describe('상품 슬라이드 — 미지정이면 현행 출력과 한 글자도 다르지 않다 (무회귀)', () => {
  for (const t of EMAIL_PRODUCT_TREATMENTS) {
    it(`[${t}] 5개 속성 미지정 = 색·정렬 지정이 출력에 섞이지 않는다`, () => {
      const html = render({}, t);
      expect(html).not.toContain('object-fit:contain');
      expect(html).not.toContain('object-position:center top');
      expect(html).not.toContain('object-position:center bottom');
    });
  }
});

describe('상품 슬라이드 제목 — 크기·색 (2026-08-26 신설 · 임은지 접수)', () => {
  it('title_color가 제목 색으로 실린다', () => {
    expect(render({ title: '가을 감사제', title_color: '#ff3366' })).toContain('#ff3366');
  });

  it('title_size가 제목 글자 크기를 바꾼다', () => {
    const sm = render({ title: '가을 감사제', title_size: 'sm' });
    const md = render({ title: '가을 감사제' });
    const lg = render({ title: '가을 감사제', title_size: 'lg' });
    expect(sm).not.toBe(md);
    expect(lg).not.toBe(md);
    expect(sm).not.toBe(lg);
  });

  it('제목 크기·색 미지정 = 현행 제목 출력 그대로', () => {
    const before = render({ title: '가을 감사제' });
    expect(before).toContain('가을 감사제');
    expect(before).not.toContain('#ff3366');
  });
});

// ── 원장 구동 검사 — 표에 등재된 속성은 전부 출력을 바꿔야 한다 ──
// 이 블록이 harness다. 편집기에 새 속성을 만들고 원장에만 적으면 여기서 깨진다.
describe('email-property-contract 원장 = 실제 소비 (등재만 하고 안 읽으면 실패)', () => {
  const PROBE: Record<string, unknown> = {
    background_color: '#f06060',
    caption_bg_color: '#e74b4b',
    image_fit: 'contain',
    image_focus: 'top',
    image_height: 'lg',
    title_size: 'lg',
    title_color: '#ff3366',
  };

  it('원장의 모든 속성에 탐침 값이 있다 (새 속성 등재 시 탐침도 함께)', () => {
    for (const { prop } of EMAIL_PRODUCT_CAROUSEL_PROPS) {
      expect(PROBE[prop], `${prop} 탐침 값 없음`).toBeDefined();
    }
  });

  for (const { prop, desc } of EMAIL_PRODUCT_CAROUSEL_PROPS) {
    it(`${prop} (${desc}) — 값을 주면 출력이 실제로 달라진다`, () => {
      const base = render({ title: '가을 감사제' });
      const probed = render({ title: '가을 감사제', [prop]: PROBE[prop] });
      expect(probed, `${prop}가 이메일 렌더러에서 소비되지 않는다`).not.toBe(base);
    });
  }
});

// ── 히어로 (2026-08-27 임은지 접수 cmtb65jft02y5jnot96pjwvjo) ──
describe('히어로 — 편집기 속성이 이미지 구도 전부에서 반영된다', () => {
  const hero = (props: Record<string, unknown>, treatment?: string): Section =>
    ({ id: 's-hero', type: 'hero', order: 0, visible: true, treatment,
       props: { headline: '붉은팥 PDRN 모공탄력 세럼', sub_copy: '열감을 내리고 모공은 쫀쫀하게', align: 'center', height: 'md', image_url: 'https://x.example.com/hero.jpg', ...props } } as unknown as Section);
  const rh = (props: Record<string, unknown>, treatment?: string) => renderEmailSections([hero(props, treatment)], {});

  for (const t of EMAIL_HERO_IMAGE_TREATMENTS) {
    it(`[${t}] 높이 설정이 실제 높이를 바꾼다 (편집기 "높이" 컨트롤이 죽지 않는다)`, () => {
      expect(rh({ height: 'sm' }, t)).toContain(`${EMAIL_HERO_HEIGHT.sm}px`);
      expect(rh({ height: 'lg' }, t)).toContain(`${EMAIL_HERO_HEIGHT.lg}px`);
      expect(rh({ height: 'md' }, t)).toContain(`${EMAIL_HERO_HEIGHT.md}px`);
    });

    it(`[${t}] 이미지 맞춤(contain)이 출력을 바꾼다 — 완성 포스터가 잘리지 않아야 한다`, () => {
      expect(rh({ image_fit: 'contain' }, t)).not.toBe(rh({}, t));
    });

    it(`[${t}] 이미지 초점(focus=top)이 출력을 바꾼다`, () => {
      expect(rh({ focus: 'top' }, t)).not.toBe(rh({}, t));
    });
  }

  // ★ 2026-08-28 남지현 접수 cmtck9xxo0447jnotnjo3n8ff — 작게·보통·크게·전체화면 무엇을 눌러도 안 바뀐다.
  //   인라인 높이는 정상이었다(바로 위 계약이 통과한다). 같은 문서의 발송 셸 CSS가
  //   `@media (max-width:600px){.em-hero{height:auto !important}}`로 그 값을 전부 덮고 있었다.
  //   미리보기 패널은 폭 360px 고정이라 이 분기가 항상 걸린다 = 편집기의 높이 컨트롤이 죽어 있었다.
  //   실제 발송에서도 모바일 메일앱은 같은 규칙을 적용한다. "480px가 문자열에 들어 있다"만 보는 계약은
  //   이 형태를 못 잡으므로, 값을 덮는 쪽까지 함께 고정한다.
  it('셸 CSS가 히어로 높이를 덮지 않는다 (모바일 폭에서도 고른 높이가 살아 있다)', () => {
    const doc = rh({ height: 'lg' });
    const rules = doc.match(/\.em-hero\s*\{[^}]*\}/g) || [];
    expect(rules.length, '.em-hero 규칙이 통째로 사라졌다 — 모바일 여백 축소까지 함께 지운 것은 아닌지 확인').toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule, `셸 CSS가 히어로 높이를 덮는다: ${rule}`).not.toMatch(/height\s*:/);
    }
  });

  // ★ 2026-09-04 남지현 접수 cmtl5wq5v0800jnotk46ozykf — 기본 구도만 사진이 통째로 사라졌다.
  //   사진을 CSS 배경으로 내보내면 그 CSS를 지우는 수신 클라이언트에서 폴백색만 남는다(검정 면).
  //   "이미지 URL이 문자열에 들어 있다"만 보는 계약은 이 형태를 못 잡으므로 **태그 축**으로 고정한다.
  for (const t of EMAIL_HERO_IMAGE_TREATMENTS) {
    it(`[${t}] 사진은 <img>로 나간다 — CSS 배경 이미지로 내보내지 않는다`, () => {
      const doc = rh({}, t);
      expect(doc, '히어로 이미지가 <img>로 나가지 않는다').toContain('<img src="https://x.example.com/hero.jpg"');
      const cssBg = doc.match(/background-image:\s*url\([^)]*\)/g) || [];
      expect(cssBg, `사진을 CSS 배경으로 내보내면 배경을 지우는 클라이언트에서 사라진다: ${cssBg.join(' / ')}`).toEqual([]);
    });
  }

  it('오버레이 토글이 글자 밴드로 이어진다 (끄면 출력이 달라진다)', () => {
    expect(rh({ overlay_gradient: false })).not.toBe(rh({}));
  });

  // 문구가 들어간 완성 포스터를 통짜로 올리는 사용법(편집기 "이미지 맞춤" 안내) — 사진 아래 빈 띠가 남으면 안 된다.
  it('문구가 없으면 글자 밴드를 안 그린다 (완성 포스터 통짜 업로드)', () => {
    const only = rh({ headline: '', sub_copy: '' });
    expect(only, '사진은 그대로 나가야 한다').toContain('<img src="https://x.example.com/hero.jpg"');
    expect(only, '문구가 없는데 빈 밴드가 남았다').not.toContain('#171717');
  });

  it('원장의 히어로 속성은 전부 출력을 바꾼다 (등재만 하고 안 읽으면 실패)', () => {
    const PROBE: Record<string, unknown> = {
      height: 'lg', image_fit: 'contain', focus: 'top', align: 'left',
      headline_color: '#ff3366', headline_size: 33, sub_copy_color: '#3366ff', sub_copy_size: 22,
    };
    for (const { prop, desc } of EMAIL_HERO_PROPS) {
      expect(PROBE[prop], `${prop} 탐침 값 없음`).toBeDefined();
      expect(rh({ [prop]: PROBE[prop] }), `${prop} (${desc})가 이메일 히어로 렌더러에서 소비되지 않는다`).not.toBe(rh({}));
    }
  });
});

// ── 포인트 장식(아트디렉션 모티프) — 전역 축 + 블록별 끄기 (2026-09-04 남지현 접수 cmtl3y8c207z2jnotlgv7nz4c) ──
describe('포인트 장식 — 테마가 붙이고 블록이 끌 수 있다', () => {
  const INDEX_DESIGN = { art_direction: { accentMotif: 'index' as const } };
  const card = (extra: Record<string, unknown> = {}): Section =>
    ({ id: 's-tc', type: 'text_card', order: 0, visible: true,
       props: { headline: '이달의 베스트 상품', body: '9월 가장 사랑받은 아이템을 모았습니다.' }, ...extra } as unknown as Section);

  it('테마가 번호를 지정하면 순번이 붙는다 (접수에서 보인 그 숫자)', () => {
    const withIndex = renderEmailSections([card()], { design: INDEX_DESIGN });
    expect(withIndex, '모티프 index인데 순번이 안 붙는다').toContain('01');
    expect(withIndex).not.toBe(renderEmailSections([card()], {}));
  });

  it(`블록의 motif='${EMAIL_SECTION_MOTIF_OFF}'이면 그 블록만 장식이 사라진다`, () => {
    const on = renderEmailSections([card()], { design: INDEX_DESIGN });
    const off = renderEmailSections([card({ motif: EMAIL_SECTION_MOTIF_OFF })], { design: INDEX_DESIGN });
    expect(off, '블록별 끄기가 렌더러에서 소비되지 않는다').not.toBe(on);
    // 장식 없이 렌더한 것과 같아야 한다 = 그 블록에서 모티프만 정확히 빠졌다
    expect(off).toBe(renderEmailSections([card()], { design: { art_direction: { accentMotif: 'none' } } }));
  });

  it('배경면 다크에서도 블록별 끄기가 유지된다 (브랜드 재해석이 장식을 되살리지 않는다)', () => {
    const off = renderEmailSections([card({ motif: EMAIL_SECTION_MOTIF_OFF, background: 'dark' })], { design: INDEX_DESIGN });
    expect(off).toBe(renderEmailSections([card({ background: 'dark' })], { design: { art_direction: { accentMotif: 'none' } } }));
  });

  it('섹션 강조색 지정에서도 블록별 끄기가 유지된다', () => {
    const off = renderEmailSections([card({ motif: EMAIL_SECTION_MOTIF_OFF, accent_color: '#0f766e' })], { design: INDEX_DESIGN });
    expect(off).toBe(renderEmailSections([card({ accent_color: '#0f766e' })], { design: { art_direction: { accentMotif: 'none' } } }));
  });

  // 편집기가 "포인트 장식" 컨트롤을 노출하는 섹션 = 렌더러가 실제로 모티프를 그리는 섹션과 같아야 한다(죽은 컨트롤 금지).
  for (const type of EMAIL_MOTIF_SECTIONS) {
    it(`[${type}] 모티프를 실제로 그린다 (컨트롤 노출 대상과 렌더 대상이 같다)`, () => {
      const sec = ({ id: `s-${type}`, type, order: 0, visible: true,
                     props: { headline: '제목', body: '본문', sub_copy: '부제' } } as unknown as Section);
      const on = renderEmailSections([sec], { design: INDEX_DESIGN });
      const none = renderEmailSections([sec], { design: { art_direction: { accentMotif: 'none' } } });
      expect(on, `${type}가 모티프를 안 그리는데 편집기에 컨트롤을 노출하면 죽은 컨트롤이다`).not.toBe(none);
    });
  }
});

// ── 캠페인 서체 (2026-08-27 임은지 접수 cmtb6kn6j0369jnotmslux7i2) ──
describe('캠페인 디자인 서체 — 지정하면 발송 HTML에 실린다', () => {
  const body: Section[] = [
    { id: 'h', type: 'hero', order: 0, visible: true, props: { headline: '헤드라인', sub_copy: '서브카피', align: 'center', height: 'md' } } as unknown as Section,
    { id: 't', type: 'text_card', order: 1, visible: true, props: { headline: '소개', body: '본문입니다' } } as unknown as Section,
  ];

  it('서체 미지정 = 현행 출력 (회귀 0)', () => {
    expect(renderEmailSections(body, { design: {} as never })).toBe(renderEmailSections(body, {}));
  });

  for (const { prop, desc, probe } of EMAIL_DESIGN_PROPS) {
    it(`${prop} (${desc}) — 지정 값이 실제 출력을 바꾼다`, () => {
      const base = renderEmailSections(body, {});
      const styled = renderEmailSections(body, { design: { [prop]: probe } as never });
      expect(styled, `${prop}가 이메일 렌더러에서 소비되지 않는다`).not.toBe(base);
      // 카탈로그 서체는 이메일 폴백 스택으로 승격되므로 **서체 이름**이 출력에 남아야 한다
      const face = probe.split(',')[0].replace(/"/g, '').trim();
      expect(styled).toContain(face);
    });
  }

  it('카탈로그 서체는 자가호스팅 fonts.css @import까지 함께 나간다 (수신함에서 실제 그 글꼴로 보인다)', () => {
    const base = renderEmailSections(body, {});
    const styled = renderEmailSections(body, { design: { font_family: '"Noto Serif KR", serif' } as never });
    expect(base).not.toContain('/api/dm/v/fonts.css');
    expect(styled, '자가호스팅 서체 @import가 빠지면 수신함에서 기본 글꼴로 떨어진다').toContain('/api/dm/v/fonts.css');
    expect(styled).toContain('@import url(');
  });
});

// ── 헤더 브랜드명 색 (2026-08-31 임은지 접수 cmtgt4pgm0543jnot7j7j02xu) ──
describe('헤더 — 브랜드명 색이 이메일 발송 HTML에 반영된다', () => {
  const header = (props: Record<string, unknown>): Section =>
    ({ id: 's-hd', type: 'header', order: 0, visible: true,
       props: { variant: 'logo', brand_name: '톤28', show_brand_name: true, ...props } } as unknown as Section);
  const rh = (props: Record<string, unknown>) => renderEmailSections([header(props)], {});

  for (const { prop, desc, probe } of EMAIL_HEADER_PROPS) {
    it(`${prop} (${desc}) — 지정 값이 실제 출력에 실린다`, () => {
      const base = rh({});
      const painted = rh({ [prop]: probe });
      expect(painted, `${prop}가 이메일 렌더러에서 소비되지 않는다`).not.toBe(base);
      expect(painted, '지정한 색 자체가 출력에 있어야 한다').toContain(String(probe));
    });
  }

  it('색 미지정이면 옛 출력 그대로다 (기존 캠페인 회귀 0)', () => {
    expect(rh({ title_color: undefined })).toBe(rh({}));
  });

  it('로고만 쓰는 구도(브랜드명 숨김)에서는 색 지정이 출력을 바꾸지 않는다', () => {
    const noBrand = { show_brand_name: false, brand_name: '' };
    expect(rh({ ...noBrand, title_color: '#c2185b' })).toBe(rh(noBrand));
  });
});

// ── CTA 버튼색 (2026-08-31 임은지 접수 cmtgtxqdj054jjnot99virpq9) ──
describe('CTA — 버튼색이 스타일 3종 전부에서 반영된다', () => {
  const cta = (btn: Record<string, unknown>, treatment?: string): Section =>
    ({ id: 's-cta', type: 'cta', order: 0, visible: true, treatment,
       props: { buttons: [{ label: '자세히 보기', url: 'https://ex.com/a', ...btn }] } } as unknown as Section);
  const rc = (btn: Record<string, unknown>, treatment?: string) => renderEmailSections([cta(btn, treatment)], {});

  for (const style of EMAIL_CTA_BUTTON_STYLES) {
    for (const { prop, desc, probe } of EMAIL_CTA_BUTTON_PROPS) {
      it(`[${style}] ${prop} (${desc}) — 지정 값이 실제 출력에 실린다`, () => {
        const base = rc({ style });
        const painted = rc({ style, [prop]: probe });
        expect(painted, `[${style}]에서 ${prop}가 소비되지 않는다`).not.toBe(base);
        expect(painted, '지정한 색 자체가 출력에 있어야 한다').toContain(String(probe));
      });
    }

    it(`[${style}] 색 미지정이면 옛 출력 그대로다 (회귀 0)`, () => {
      expect(rc({ style, color: undefined })).toBe(rc({ style }));
    });

    it(`[${style}] 아웃룩(VML)에도 같은 색이 실린다 — 일부 수신자만 옛 색이 나가지 않게`, () => {
      const painted = rc({ style, color: '#0f766e' });
      const mso = painted.slice(painted.indexOf('<!--[if mso]>'), painted.indexOf('<![endif]-->'));
      expect(mso, 'VML 구간에 지정색이 없으면 아웃룩에서만 색이 다르다').toContain('#0f766e');
    });
  }

  it('구도 ghost(전 버튼 아웃라인)에서도 지정색이 반영된다', () => {
    expect(rc({ style: 'primary', color: '#0f766e' }, 'ghost')).toContain('#0f766e');
  });

  it('구도 bar(반전 흰 버튼)에서 사람이 고른 색이 자동 반전보다 우선한다', () => {
    const painted = rc({ style: 'primary', color: '#0f766e' }, 'bar');
    expect(painted).toContain('#0f766e');
  });
});

// ────────────────────────────────────────────────────────────
// 쿠폰 — 2026-09-02 남지현 접수(cmtjhsd8a06y9jnotvcc8pqo6)
//   "쿠폰 탭에서 URL을 삽입해도 클릭 되는 부분이 없다. 제목·본문·버튼 모두 클릭 불가."
//   renderCoupon이 cta_url을 한 줄도 안 읽어 <a>가 생성되지 않았고, 대조해 보니 색 4개도 같은 상태였다.
//   DM SSR·편집 캔버스는 5개 전부 소비 중이었다 = 이메일만 죽어 있었다.
// ────────────────────────────────────────────────────────────
const coupon = (props: Record<string, unknown>, treatment?: string): Section =>
  ({ id: 's-cp', type: 'coupon', order: 0, visible: true, treatment,
     props: { discount_label: '30% 할인', coupon_code: 'SPRING30', ...props } } as unknown as Section);

const rcp = (props: Record<string, unknown>, treatment?: string) =>
  renderEmailSections([coupon(props, treatment)], {});

describe('쿠폰 — 편집기 속성이 이메일 발송 HTML에 반영된다 (구도 전부)', () => {
  for (const t of EMAIL_COUPON_TREATMENTS) {
    for (const { prop, desc, probe } of EMAIL_COUPON_PROPS) {
      it(`[${t}] ${prop} (${desc}) — 값을 주면 출력이 실제로 달라진다`, () => {
        const base = rcp({}, t);
        const painted = rcp({ [prop]: probe }, t);
        expect(painted, `[${t}]에서 ${prop}가 소비되지 않는다 (등재만 하고 렌더러가 안 읽음)`).not.toBe(base);
      });
    }

    it(`[${t}] 연결 URL이 실제 <a href>로 나간다 (접수 축 — 클릭 가능해야 한다)`, () => {
      const html = rcp({ cta_url: 'https://shop.example.com/coupon' }, t);
      expect(html, '<a href>가 없으면 화면에서 드래그만 되고 클릭이 안 된다').toContain('href="https://shop.example.com/coupon"');
      expect(html).toContain('쿠폰 사용하기');
    });

    it(`[${t}] 색 지정값이 출력 문자열에 그대로 실린다`, () => {
      const html = rcp({ label_color: '#c2185b', card_bg_color: '#fff7ed', button_color: '#0f766e', code_text_color: '#7c3aed' }, t);
      for (const c of ['#c2185b', '#fff7ed', '#0f766e', '#7c3aed']) {
        expect(html, `${c} 가 출력에 없다`).toContain(c);
      }
    });

    it(`[${t}] 5개 미지정 = 옛 출력 그대로다 (회귀 0)`, () => {
      expect(rcp({ cta_url: undefined, label_color: undefined, card_bg_color: undefined, button_color: undefined, code_text_color: undefined }, t))
        .toBe(rcp({}, t));
    });

    it(`[${t}] 미지정이면 버튼이 생기지 않는다 (옛 캠페인에 없던 요소가 끼어들지 않게)`, () => {
      expect(rcp({}, t)).not.toContain('쿠폰 사용하기');
    });

    it(`[${t}] http(s)가 아닌 URL은 버튼을 만들지 않는다 (renderPromoCode와 같은 가드)`, () => {
      expect(rcp({ cta_url: 'javascript:alert(1)' }, t)).not.toContain('쿠폰 사용하기');
    });
  }
});

/**
 * ★ 2026-09-04 CTA 버튼 배치 — 이메일도 소비한다(임은지 접수 후속).
 *
 * 이메일 편집기는 DM의 공용 `SectionPropsEditor`를 **그대로 차용**한다(EmailVisualEditor.tsx).
 * 그래서 「버튼 배치」 컨트롤이 이메일에도 뜨는데 `renderCta`는 그 값을 읽지 않았다 —
 * 고르는 대로 안 바뀌는 컨트롤이 채널 하나에만 남아 있던 상태다(DM만 고치고 끝냈던 자리).
 * 판정은 DM과 **같은 CT**(`ctaLayoutApplies`)를 쓴다. 이메일 CTA 구도는 classic·bar·ghost뿐이고
 * bar는 전폭 밴드 구조라 늘어놓을 자리가 없어 제외된다.
 */
describe('CTA 버튼 배치 — 이메일 발송 HTML에 반영된다 (2026-09-04)', () => {
  const btn = (label: string) => ({ label, url: 'https://x.example.com', style: 'primary' as const });
  const cta = (props: Record<string, unknown>, treatment?: string): Section =>
    ({ id: 's-cta', type: 'cta', order: 0, visible: true, treatment, props } as unknown as Section);
  const renderCtaSection = (props: Record<string, unknown>, treatment?: string) =>
    renderEmailSections([cta(props, treatment)], {});

  const two = [btn('구매하기'), btn('자세히 보기')];

  for (const t of ['classic', 'ghost']) {
    it(`[${t}] 가로 = 버튼이 한 행에 나란히 놓인다`, () => {
      const html = renderCtaSection({ layout: 'row', buttons: two }, t);
      // 세로는 버튼마다 <tr>, 가로는 한 <tr> 안에 <td> 여러 개다.
      const rows = (html.match(/<tr>/g) || []).length;
      const stackHtml = renderCtaSection({ layout: 'stack', buttons: two }, t);
      const stackRows = (stackHtml.match(/<tr>/g) || []).length;
      expect(rows, '가로인데 세로와 행 수가 같다 = 배치가 반영되지 않았다').toBeLessThan(stackRows);
      expect(html).not.toBe(stackHtml);
    });

    it(`[${t}] 세로 = 종전 출력 그대로 (기존 메일 회귀 0)`, () => {
      const html = renderCtaSection({ layout: 'stack', buttons: two }, t);
      const noLayout = renderCtaSection({ buttons: two }, t);
      expect(html, '미지정과 세로가 다르면 기존 문서 출력이 바뀐 것이다').toBe(noLayout);
    });
  }

  it('[bar] 전폭 밴드는 배치와 무관하다 — 그래서 편집기가 컨트롤을 감춘다', () => {
    const row = renderCtaSection({ layout: 'row', buttons: two }, 'bar');
    const stack = renderCtaSection({ layout: 'stack', buttons: two }, 'bar');
    expect(row).toBe(stack);
  });

  it('버튼 1개면 가로를 골라도 세로와 같다 — 늘어놓을 것이 없다', () => {
    const row = renderCtaSection({ layout: 'row', buttons: [btn('구매하기')] }, 'classic');
    const stack = renderCtaSection({ layout: 'stack', buttons: [btn('구매하기')] }, 'classic');
    expect(row).toBe(stack);
  });

  it('두 채널이 같은 판정 CT를 쓴다 — 한쪽만 고치면 다시 갈린다', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/utils/email/email-section-renderer.ts'), 'utf8');
    expect(src, '이메일 렌더러가 DM과 다른 조건을 쓰면 편집기가 감춘 컨트롤을 소비하거나 그 반대가 된다')
      .toContain('ctaLayoutApplies');
  });
});
