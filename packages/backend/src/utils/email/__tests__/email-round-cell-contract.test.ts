/**
 * email-round-cell-contract.test.ts — 둥근 모서리 셀 계약 (2026-09-08)
 *
 * 경위: 남지현 접수 `cmtqtw3m00a07jnotpv8cfrcu` "CTA 버튼 가이드 라인 표시".
 *   문서 전역 `table{border-collapse:collapse}`(아웃룩 셀 간격 방지) 아래에서는
 *   셀(td)의 `border-radius`가 **테두리에 적용되지 않는다**. 배경만 둥글게 남고
 *   테두리는 직각으로 그려져 둥근 버튼 바깥에 사각 선이 하나 더 생긴다.
 *   접수는 CTA 하나로 왔지만 같은 마크업이 상품 카드·리뷰·매장 정보·쿠폰·framed 텍스트에도 있었다.
 *
 * 계약: `border`와 `border-radius`를 함께 쓰는 td의 부모 table은
 *   `border-collapse:separate`(+`border-spacing:0`)를 인라인으로 가져야 한다.
 *   섹션이 늘어도 이 테스트가 자동으로 새 자리를 잡는다(원장에 섹션을 골라 넣지 않는다).
 *
 * ⛔ 전역 규칙(`table{border-collapse:collapse}`)은 건드리지 않는다 — 이 문서 밖의 표
 *   (청구서·정산 메일 등)까지 셀 간격이 함께 바뀐다. 그래서 "덮는 쪽"도 함께 고정한다
 *   (속성 파리티는 싣는 쪽과 덮는 쪽을 같이 봐야 한다 = 2026-08-28 히어로 높이 교훈).
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections } from '../email-section-renderer';
import type { Section } from '../../dm/dm-section-registry';

const sec = (type: string, props: Record<string, unknown>, order = 0, extra: Record<string, unknown> = {}): Section =>
  ({ id: `rc-${type}-${order}`, type, order, visible: true, props, ...extra } as unknown as Section);

/** 실제 border 선언인지(테두리 선을 그리는지) — border-radius·border-spacing·border-collapse는 제외. */
const hasRealBorder = (style: string): boolean =>
  /(^|;)\s*border(-top|-bottom|-left|-right)?\s*:/i.test(style) && !/(^|;)\s*border\s*:\s*(0|none)/i.test(style);

/** border-radius를 가진 td를 태그 스택으로 훑어 부모 table 여는 태그와 짝지어 돌려준다. */
function roundCells(html: string): Array<{ td: string; table: string }> {
  const found: Array<{ td: string; table: string }> = [];
  const stack: string[] = [];
  const re = /<(\/?)(table|td)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'table') {
      if (closing) stack.pop();
      else stack.push(m[0]);
    } else if (tag === 'td' && !closing && /border-radius/i.test(m[3])) {
      found.push({ td: m[0], table: stack[stack.length - 1] || '(부모 table 없음)' });
    }
  }
  return found;
}

/** 편집기가 낼 수 있는 블록 전량 — 화이트리스트 12종 + 정적 대체 5종, 구도는 있는 것 전부. */
const ALL_SECTIONS: Section[] = [
  sec('header', { variant: 'logo', brand_name: '한줄로상회' }, 0),
  sec('hero', { headline: '가을 신상품', sub_copy: '먼저 만나보세요', image_url: 'https://ex.com/h.jpg' }, 1, { treatment: 'classic' }),
  sec('hero', { headline: '가을 신상품', sub_copy: '먼저 만나보세요', image_url: 'https://ex.com/h.jpg' }, 2, { treatment: 'split' }),
  sec('hero', { headline: '가을 신상품', sub_copy: '먼저 만나보세요' }, 3, { treatment: 'typographic' }),
  sec('text_card', { tag: 'NEW', headline: '이번 시즌', body: '따뜻한 소재', image_url: 'https://ex.com/t.jpg' }, 4, { treatment: 'classic' }),
  sec('text_card', { headline: '이번 시즌', body: '따뜻한 소재' }, 5, { treatment: 'lead' }),
  sec('text_card', { headline: '이번 시즌', body: '따뜻한 소재' }, 6, { treatment: 'framed' }),
  sec('text_card', { headline: '이번 시즌', body: '따뜻한 소재' }, 7, { treatment: 'quote' }),
  sec('cta', { buttons: [{ label: '보러가기', url: 'https://ex.com', style: 'primary' }] }, 8, { treatment: 'classic' }),
  sec('cta', { buttons: [{ label: '보러가기', url: 'https://ex.com', style: 'primary' }] }, 9, { treatment: 'bar' }),
  sec('cta', { buttons: [{ label: '보러가기', url: 'https://ex.com', style: 'outline' }] }, 10, { treatment: 'ghost' }),
  sec('cta', { layout: 'row', buttons: [{ label: '보러가기', url: 'https://ex.com' }, { label: '문의', url: 'https://ex.com/q' }] }, 11, { treatment: 'classic' }),
  sec('coupon', { discount_label: '10% 할인', coupon_code: 'AUTUMN10', usage_condition: '온라인 전용', cta_url: 'https://ex.com/c' }, 12, { treatment: 'classic' }),
  sec('coupon', { discount_label: '10% 할인', coupon_code: 'AUTUMN10' }, 13, { treatment: 'spotlight' }),
  sec('promo_code', { code: 'PROMO2026', cta_label: '사용하기', cta_url: 'https://ex.com/p' }, 14),
  sec('product_carousel', { products: [
    { image_url: 'https://ex.com/p1.jpg', name: '상품 1', price: 9900, original_price: 19900, link_url: 'https://ex.com/p1' },
    { image_url: 'https://ex.com/p2.jpg', name: '상품 2', price: 19900 },
  ] }, 15, { treatment: 'classic' }),
  sec('product_carousel', { products: [
    { image_url: 'https://ex.com/p1.jpg', name: '상품 1', price: 9900 },
    { image_url: 'https://ex.com/p2.jpg', name: '상품 2', price: 19900 },
  ] }, 16, { treatment: 'focus' }),
  sec('product_carousel', { products: [
    { image_url: 'https://ex.com/p1.jpg', name: '상품 1', price: 9900 },
  ] }, 17, { treatment: 'list' }),
  sec('gallery', { images: [{ image_url: 'https://ex.com/g1.jpg', caption: '컷 1' }, { image_url: 'https://ex.com/g2.jpg' }] }, 18),
  sec('store_info', { address: '서울시 강남구', phone: '02-000-0000', business_hours: '10:00~19:00', website: 'https://ex.com' }, 19),
  sec('sns', { channels: [{ type: 'instagram', url: 'https://instagram.com/x' }] }, 20),
  sec('reviews', { title: '고객 후기', reviews: [{ rating: 5, body: '좋아요', author: '김**' }] }, 21),
  sec('countdown', { headline: '마감 임박', end_at: '2030-01-01T00:00:00.000Z' }, 22),
  sec('video', { thumbnail_url: 'https://ex.com/v.jpg', video_url: 'https://ex.com/v', caption: '영상' }, 23),
  sec('youtube_embed', { video_id: 'abc123', thumbnail_url: 'https://ex.com/y.jpg' }, 24),
  sec('instagram_embed', { post_url: 'https://instagram.com/p/x' }, 25),
  sec('map_store_locator', { stores: [{ name: '강남점', address: '서울시 강남구', phone: '02-000-0000' }] }, 26),
  sec('footer', { notes: '본 메일은 안내입니다', cs_phone: '1544-0000', legal_text: '수신거부 안내' }, 27),
];

/** 배경면 4종 — 브랜드 재해석 경로(dark)도 같은 계약을 지켜야 한다. */
const BACKGROUNDS = ['none', 'soft', 'tint', 'dark', 'gradient'] as const;

describe('둥근 모서리 셀 — 사각 테두리 계약', () => {
  it('전 블록·전 구도: border + border-radius 셀의 부모 table은 border-collapse:separate', () => {
    const html = renderEmailSections(ALL_SECTIONS, {});
    const cells = roundCells(html);
    expect(cells.length).toBeGreaterThan(0);   // 표본 0이면 계약이 아무것도 안 지킨다
    const violations = cells
      .filter((c) => hasRealBorder(c.td))
      .filter((c) => !/border-collapse\s*:\s*separate/i.test(c.table))
      .map((c) => `td=${c.td.slice(0, 160)}\n  parent=${c.table.slice(0, 160)}`);
    expect(violations).toEqual([]);
  });

  it('배경면 5종에서도 같은 계약', () => {
    for (const bg of BACKGROUNDS) {
      const html = renderEmailSections(ALL_SECTIONS.map((s) => ({ ...s, background: bg }) as Section), {});
      const violations = roundCells(html)
        .filter((c) => hasRealBorder(c.td))
        .filter((c) => !/border-collapse\s*:\s*separate/i.test(c.table))
        .map((c) => `[bg=${bg}] td=${c.td.slice(0, 160)}`);
      expect(violations).toEqual([]);
    }
  });

  it('separate로 바꾼 표는 border-spacing:0을 함께 싣는다 (기본 2px 간격 방지)', () => {
    const html = renderEmailSections(ALL_SECTIONS, {});
    const bad = roundCells(html)
      .filter((c) => /border-collapse\s*:\s*separate/i.test(c.table))
      .filter((c) => !/border-spacing\s*:\s*0/i.test(c.table))
      .map((c) => c.table.slice(0, 160));
    expect(bad).toEqual([]);
  });

  it('덮는 쪽 고정 — 문서 전역 규칙은 여전히 border-collapse:collapse', () => {
    // 이 줄이 사라지면 위 계약의 전제(전역이 셀 radius를 죽인다)가 바뀐다.
    // 전역을 separate로 돌리는 처방은 이 문서 밖 표까지 건드리므로 택하지 않았다.
    const html = renderEmailSections(ALL_SECTIONS, {});
    expect(html).toContain('table{border-collapse:collapse}');
  });
});
