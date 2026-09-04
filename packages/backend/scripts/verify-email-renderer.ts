/**
 * verify-email-renderer.ts — 이메일 렌더러 골든 + 이메일 안전 린트 (ts-node, DB-free).
 * backend는 vitest 없음 → 기존 verify-*.ts 패턴. 실행: npx ts-node scripts/verify-email-renderer.ts
 */
import { renderEmailSections, extractEmailText } from '../src/utils/email/email-section-renderer';
import { normalizeAiBlocksToSections } from '../src/utils/email/email-blocks';
import type { Section } from '../src/utils/dm/dm-section-registry';

let fail = 0;
const ok = (c: boolean, label: string) => { console.log((c ? 'PASS ' : 'FAIL ') + label); if (!c) fail++; };

const sample = [
  { id: 's1', type: 'hero', order: 0, visible: true, props: { headline: '여름 신상 입고', sub_copy: '지금 만나보세요', align: 'center', height: 'md' } },
] as unknown as Section[];

const html = renderEmailSections(sample, { brandKit: null });

// ── 골든: 핵심 구조 ──
ok(html.includes('여름 신상 입고'), 'hero headline 렌더');
ok(html.includes('지금 만나보세요'), 'hero sub_copy 렌더');
ok(/<table[\s\S]*max-width:\s*600px/i.test(html), '600px table 셸');
ok(/role="presentation"/i.test(html), '아웃룩 대비 role=presentation table');

// ── 이메일 안전 린트(허접/깨짐 차단) ──
ok(!/var\(--/.test(html), 'CSS 변수 0건');
ok(!/<style[\s>]/i.test(html), '<style> 태그 0건');
ok(!/<script/i.test(html), '<script> 0건');
ok(!/display\s*:\s*flex/i.test(html), 'flex 0건');
ok(!/display\s*:\s*grid/i.test(html), 'grid 0건');

// ── 화이트리스트 밖 블록 = 렌더 0(보이면 작동 불변식) ──
const withSkip = [
  { id: 'r1', type: 'roulette', order: 0, visible: true, props: {} },
  { id: 'h1', type: 'hero', order: 1, visible: true, props: { headline: '본문', align: 'center', height: 'md' } },
] as unknown as Section[];
const html2 = renderEmailSections(withSkip, { brandKit: null });
ok(html2.includes('본문') && !/roulette/i.test(html2), '비호환 블록(roulette) 렌더 0');

// ── text 추출 ──
const text = extractEmailText(sample);
ok(text.includes('여름 신상 입고'), 'text 추출 — headline');
ok(!/[<>]/.test(text), 'text에 태그 0건');

// ── 핵심 5블록 통합 골든(header→hero→text_card→cta→footer) ──
const full = [
  { id: 'b1', type: 'header', order: 0, visible: true, props: { variant: 'logo', brand_name: '한줄로몰' } },
  { id: 'b2', type: 'hero', order: 1, visible: true, props: { headline: '여름 세일', align: 'center', height: 'md' } },
  { id: 'b3', type: 'text_card', order: 2, visible: true, props: { tag: 'NEW', headline: '신상 안내', body: '본문입니다', align: 'left', image_position: 'top' } },
  { id: 'b4', type: 'cta', order: 3, visible: true, props: { buttons: [{ label: '지금 보기', url: 'https://hanjul.ai/shop', style: 'primary' }], layout: 'stack' } },
  { id: 'b5', type: 'footer', order: 4, visible: true, props: { notes: '한줄로몰', cs_phone: '1588-0000', legal_text: '서울시' } },
] as unknown as Section[];
const fhtml = renderEmailSections(full, { brandKit: null });
ok(fhtml.includes('한줄로몰') && fhtml.includes('여름 세일') && fhtml.includes('신상 안내') && fhtml.includes('지금 보기'), '5블록 전부 렌더');
ok(fhtml.includes('href="https://hanjul.ai/shop"'), 'cta 버튼 링크 렌더');
ok(!/var\(--/.test(fhtml) && !/display\s*:\s*flex/i.test(fhtml) && !/<script/i.test(fhtml), '5블록 통합 이메일 안전 린트');

// 브랜드킷 override — primary_color 반영
const branded = renderEmailSections(full, { brandKit: { primary_color: '#e11d48' } as any });
ok(branded.includes('#e11d48'), '브랜드킷 primary_color 인라인 반영');

// ── 비주얼 e커머스 블록(상품 그리드·갤러리·쿠폰) ──
const visual = [
  { id: 'v1', type: 'product_carousel', order: 0, visible: true, props: { title: '추천 상품', products: [
    { image_url: 'https://cdn.x/a.jpg', name: '여름 원피스', price: 39000, discount_price: 29000, link_url: 'https://hanjul.ai/p/1' },
    { image_url: 'https://cdn.x/b.jpg', name: '린넨 셔츠', price: 25000 },
  ] } },
  { id: 'v2', type: 'gallery', order: 1, visible: true, props: { title: '룩북', images: [{ url: 'https://cdn.x/1.jpg' }, { url: 'https://cdn.x/2.jpg' }], layout: 'grid_2x2' } },
  { id: 'v3', type: 'coupon', order: 2, visible: true, props: { discount_label: '여름 20% 할인', coupon_code: 'SUMMER20', min_purchase: 30000 } },
] as unknown as Section[];
const vhtml = renderEmailSections(visual, { brandKit: null });
ok(vhtml.includes('여름 원피스') && vhtml.includes('29,000원') && vhtml.includes('29,000원'), '상품 그리드 — 이름·할인가 렌더');
ok(vhtml.includes('href="https://hanjul.ai/p/1"'), '상품 링크 렌더');
ok(vhtml.includes('SUMMER20') && vhtml.includes('30,000원 이상'), '쿠폰 — 코드·조건 렌더');
ok((vhtml.match(/<img /g) || []).length >= 4, '갤러리·상품 이미지 렌더');
ok(!/var\(--/.test(vhtml) && !/display\s*:\s*flex/i.test(vhtml) && !/<script/i.test(vhtml), '비주얼 블록 이메일 안전 린트');

// ── 나머지 블록(promo_code·store_info·sns·reviews) + 정적 대체(countdown) ──
const rest = [
  { id: 'p1', type: 'promo_code', order: 0, visible: true, props: { code: 'WELCOME', description: '첫 구매 코드', cta_url: 'https://hanjul.ai/use', cta_label: '쓰기' } },
  { id: 'st1', type: 'store_info', order: 1, visible: true, props: { address: '서울시 강남구', phone: '02-000-0000', business_hours: '10-19시' } },
  { id: 'sn1', type: 'sns', order: 2, visible: true, props: { channels: [{ type: 'instagram', url: 'https://instagram.com/x' }], layout: 'icons' } },
  { id: 'rv1', type: 'reviews', order: 3, visible: true, props: { title: '후기', reviews: [{ rating: 5, author: '김**', body: '정말 좋아요' }] } },
  { id: 'cd1', type: 'countdown', order: 4, visible: true, props: { end_datetime: '2030-12-31T00:00:00Z', urgency_text: '마감 임박', show_days: true, show_hours: true, show_minutes: true, show_seconds: false } },
] as unknown as Section[];
const rhtml = renderEmailSections(rest, { brandKit: null });
ok(rhtml.includes('WELCOME') && rhtml.includes('서울시 강남구') && rhtml.includes('Instagram') && rhtml.includes('정말 좋아요'), '나머지 블록(promo/store/sns/reviews) 렌더');
ok(rhtml.includes('★') && rhtml.includes('마감 임박') && /D-\d+/.test(rhtml), 'reviews 별점 + countdown D-day 정적 대체');
ok(!/var\(--/.test(rhtml) && !/<script/i.test(rhtml) && !/display\s*:\s*flex/i.test(rhtml), '나머지 블록 이메일 안전 린트');

// ── AI 블록 정규화(generateEmailSections 코어) — 화이트리스트 거름 + Section[] 정형 ──
const aiBlocks = [
  { type: 'hero', props: { headline: 'AI 여름 세일', align: 'center', height: 'md' } },
  { type: 'roulette', props: {} },
  { type: 'cta', props: { buttons: [{ label: '보기', url: '', style: 'primary' }], layout: 'stack' } },
];
const norm = normalizeAiBlocksToSections(aiBlocks);
ok(norm.length === 2 && norm.every((s) => !!s.id && typeof s.order === 'number' && s.visible === true), 'AI 정규화 — id/order/visible 부여 + 화이트리스트만');
ok(!norm.some((s) => s.type === 'roulette'), 'AI 정규화 — 비호환(roulette) 제거');
const aiHtml = renderEmailSections(norm, { brandKit: null });
ok(aiHtml.includes('AI 여름 세일') && !/roulette/i.test(aiHtml), 'AI 블록 → 렌더 체인 동작');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
