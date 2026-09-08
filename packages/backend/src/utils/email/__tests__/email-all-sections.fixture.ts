/**
 * email-all-sections.fixture.ts — 이메일 렌더 전 블록 샘플 (계약 테스트 공용 픽스처)
 *
 * 화이트리스트 12종 + 정적 대체 5종 · 구도는 허용표에 있는 것 전부.
 * 계약 테스트가 "새 섹션이 늘어도 자동으로 그 자리를 잡게" 하려면 표본이 한곳에 모여 있어야 한다
 * (원장에 섹션을 골라 넣으면 원장이 아니다 = 2026-08-27 교훈).
 */
import type { Section } from '../../dm/dm-section-registry';

export const sec = (type: string, props: Record<string, unknown>, order = 0, extra: Record<string, unknown> = {}): Section =>
  ({ id: `fx-${type}-${order}`, type, order, visible: true, props, ...extra } as unknown as Section);

export const ALL_SECTIONS: Section[] = [
  sec('header', { variant: 'logo', brand_name: '한줄로상회', logo_url: 'https://ex.com/logo.png' }, 0),
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
  // focus 구도는 "높이 지정" 분기와 "미지정" 분기의 img 스타일이 다르다 → 둘 다 밟는다.
  sec('product_carousel', { image_height: 'lg', products: [
    { image_url: 'https://ex.com/p1.jpg', name: '상품 1', price: 9900 },
  ] }, 17, { treatment: 'focus' }),
  sec('product_carousel', { products: [
    { image_url: 'https://ex.com/p1.jpg', name: '상품 1', price: 9900 },
  ] }, 18, { treatment: 'list' }),
  sec('gallery', { images: [{ image_url: 'https://ex.com/g1.jpg', caption: '컷 1' }, { image_url: 'https://ex.com/g2.jpg' }] }, 19),
  sec('store_info', { address: '서울시 강남구', phone: '02-000-0000', business_hours: '10:00~19:00', website: 'https://ex.com' }, 20),
  sec('sns', { channels: [{ type: 'instagram', url: 'https://instagram.com/x' }] }, 21),
  sec('reviews', { title: '고객 후기', reviews: [{ rating: 5, body: '좋아요', author: '김**' }] }, 22),
  sec('countdown', { headline: '마감 임박', end_at: '2030-01-01T00:00:00.000Z' }, 23),
  sec('video', { thumbnail_url: 'https://ex.com/v.jpg', video_url: 'https://ex.com/v', caption: '영상' }, 24),
  sec('youtube_embed', { video_id: 'abc123', thumbnail_url: 'https://ex.com/y.jpg' }, 25),
  sec('instagram_embed', { post_url: 'https://instagram.com/p/x' }, 26),
  sec('map_store_locator', { stores: [{ name: '강남점', address: '서울시 강남구', phone: '02-000-0000' }] }, 27),
  sec('footer', { notes: '본 메일은 안내입니다', cs_phone: '1544-0000', legal_text: '수신거부 안내' }, 28),
];

/** 배경면 허용값 — 브랜드 재해석 경로(dark)까지 계약이 따라가는지 보는 데 쓴다. */
export const BACKGROUNDS = ['none', 'soft', 'tint', 'dark', 'gradient'] as const;
