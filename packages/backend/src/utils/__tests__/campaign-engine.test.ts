/**
 * campaign-engine.test.ts — S5 조립 엔진 골든(AI 뒤 결정 구간) + 재료 입구 순수 함수 (2026-09-06 · 설계서 §7)
 *  골든 = 생성기(AI)를 고정 픽스처로 바꾼 뒤 아웃리치 실제 deps 로 조립 → sectionTypes 순서 · 룩 통계 · CTA 수 · 차단 수 스냅샷.
 *  아웃리치와 고객 입구가 같은 엔진·같은 deps 를 쓰므로 이 골든이 두 입구의 상시 회귀다.
 * DB·AI·네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { assembleDmCampaign, type EngineMaterials } from '../campaign-engine';
import { outreachEngineDeps } from '../sales-outreach-produce';
import { quoteQuickCampaign, quickMaterialsEnabled, normalizeQuickMaterials, materialTextFromEvents } from '../campaign-quick';
import type { Section } from '../dm/dm-section-registry';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const sec = (type: string, props: Record<string, unknown>, order: number): Section => ({ id: `g-${order}-${type}`, type, order, visible: true, props } as unknown as Section);

/** 모델이 낸 것으로 치는 고정 구성(11개 · 헤드라인에 면허 없는 혜택 수치 1곳 · 카운트다운 종료일 없음 · CTA 1개) */
const GEN_FIXTURE: Section[] = [
  sec('header', {}, 0),
  sec('hero', { headline: '가을 신상 컬렉션', sub_copy: '지금 만나보세요' }, 1),
  sec('text_card', { tag: '이벤트', headline: '한가위 기획전', body: '풍성한 한가위를 준비했습니다.' }, 2),
  sec('product_carousel', { title: '추천 상품' }, 3),
  sec('cta', { buttons: [{ label: '기획전 보기', url: '' }] }, 4),
  sec('gallery', { title: '제품 사용 컷' }, 5),
  sec('text_card', { tag: '혜택', headline: '전 상품 30% 할인', body: '오늘만 쿠폰 지급' }, 6),
  sec('countdown', { end_datetime: '' }, 7),
  sec('footer', { notes: '' }, 8),
];

const MATERIALS: EngineMaterials = {
  companyName: '브랜드', industry: 'beauty', homepageUrl: 'https://brand.example/', siteTitle: '브랜드 공식몰',
  material: '한가위 기획전 안내', extraNotes: null,
  products: [
    { name: '수분 크림', price: 32000, discount_price: 25000, image_url: 'https://hanjul.ai/api/cdp/inapp/image/c/p1.jpg', link_url: 'https://brand.example/p/1', width: 800, height: 800 },
    { name: '세럼', price: 45000, discount_price: null, image_url: 'https://hanjul.ai/api/cdp/inapp/image/c/p2.jpg', link_url: 'https://brand.example/p/2', width: 800, height: 800 },
    { name: '토너', price: 21000, discount_price: 18000, image_url: 'https://hanjul.ai/api/cdp/inapp/image/c/p3.jpg', link_url: 'https://brand.example/p/3', width: 800, height: 800 },
  ],
  gallery: [
    { url: 'https://hanjul.ai/api/cdp/inapp/image/c/b1.jpg', width: 1920, height: 800 },
    { url: 'https://hanjul.ai/api/cdp/inapp/image/c/b2.jpg', width: 1920, height: 800 },
    { url: 'https://hanjul.ai/api/cdp/inapp/image/c/b3.jpg', width: 1920, height: 800 },
  ],
  logoUrl: null, posterUrl: 'https://hanjul.ai/api/cdp/inapp/image/c/poster.jpg', posterSize: { width: 1792, height: 2400 },
  bannerUrl: null, bannerSize: null,
  ctaLinks: { 기획전: 'https://brand.example/event', 쿠폰: 'https://brand.example/coupon' },
  legal: { legal: '상호 브랜드 · 대표 홍길동', csPhone: '02-000-0000' },
  licensedQuote: '', proof: { reviewTotal: 1200, rating: 4.8, rankLabel: null, collectedAt: '2026-09-06T00:00:00Z' },
};

function depsWithFixture() {
  const deps = outreachEngineDeps();
  deps.generate = async () => ({ sections: GEN_FIXTURE.map((s) => ({ ...s, props: { ...(s.props as any) } })), exemplars: { picked: 3, total: 12 } });
  return deps;
}

describe('조립 엔진 골든(아웃리치 deps + 고정 생성 픽스처)', () => {
  it('순서·룩·CTA·차단이 고정된다 — 히어로=첫 배너 · 카운트다운(종료일 없음) 제거 · 면허 없는 30%는 차단 · CTA 2개 보장 · 증거 카드 삽입', async () => {
    const r = await assembleDmCampaign(MATERIALS, { entry: 'outreach', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: 'scroll' }, depsWithFixture());
    expect(r.generated).toBe(true);
    expect(r.exemplars).toEqual({ picked: 3, total: 12 });
    // 스냅샷 — 이 배열이 바뀌면 두 입구(아웃리치·고객 재료)가 함께 바뀐 것이다
    // 증거 카드(text_card)가 첫 상품 묶음 뒤 · 모델 CTA 1개 + 코드가 보장한 CTA 1개(첫 상품 묶음 뒤)가 이어진다 · 카운트다운은 종료일이 없어 빠졌다
    // ★ 0906(2) 포스터는 히어로 다음 자기 블록(gallery 1장)
    expect(r.sectionTypes).toEqual(['header', 'hero', 'gallery', 'text_card', 'product_carousel', 'text_card', 'cta', 'cta', 'gallery', 'text_card', 'footer']);
    expect(r.sectionTypes.filter((t) => t === 'cta').length).toBe(2);
    expect(r.sectionTypes).not.toContain('countdown');
    const hero = r.sections.find((s) => s.type === 'hero') as any;
    expect(hero.props.image_url).toBe('https://hanjul.ai/api/cdp/inapp/image/c/b1.jpg');
    const benefitCard = r.sections.filter((s) => s.type === 'text_card').map((s: any) => String(s.props.headline || ''));
    expect(benefitCard.join(' ')).not.toContain('30%');
    expect(r.benefitStripped).toBeGreaterThanOrEqual(1);
    expect(r.proofInserted).toBe(true);
    expect(r.sections.some((s) => s.id === 'so-proof-card')).toBe(true);
    expect((r.look as any).treatments + (r.look as any).backgrounds).toBeGreaterThan(0);
    expect(Array.isArray(r.pages) && r.pages.length).toBe(1);
    expect(r.heroFallback).toBe(false);
  });
  it('면허 인용이 있으면 그 수치는 남는다 · preset 재발행은 생성·채우기를 건너뛴다', async () => {
    const licensed = await assembleDmCampaign({ ...MATERIALS, licensedQuote: '전 상품 30% 할인 · 2026.09.01 ~ 2026.12.31' }, { entry: 'outreach', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: 'scroll' }, depsWithFixture());
    expect(licensed.sections.some((s: any) => String(s.props?.headline || '').includes('30%'))).toBe(true);
    const deps = depsWithFixture();
    deps.generate = async () => { throw new Error('preset 재발행은 생성기를 부르지 않는다'); };
    const preset = await assembleDmCampaign(MATERIALS, { entry: 'outreach', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: licensed.sectionsBase, layoutMode: 'scroll' }, deps);
    expect(preset.generated).toBe(false);
    expect(preset.sectionTypes).toEqual(licensed.sectionTypes);
  });
  it('고객 입구(entry customer) = 같은 순서 · 업로드 이미지 3장 → 히어로 1 + 갤러리 2장 · 상품 카드 0(이미지 없는 상품은 카드 금지)', async () => {
    const m: EngineMaterials = {
      ...MATERIALS, products: [], posterUrl: null, posterSize: null, ctaLinks: {}, homepageUrl: 'https://shop.example/', legal: null, proof: null,
      gallery: [
        { url: '/api/dm/v/images/c/u1.jpg', width: 1080, height: 1350 }, { url: '/api/dm/v/images/c/u2.jpg', width: 1080, height: 1080 }, { url: '/api/dm/v/images/c/u3.jpg', width: 1080, height: 1080 },
      ],
      licensedQuote: '전 상품 30% 할인',
    };
    const r = await assembleDmCampaign(m, { entry: 'customer', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: 'scroll' }, depsWithFixture());
    expect(r.sectionTypes).not.toContain('product_carousel');
    const hero = r.sections.find((s) => s.type === 'hero') as any;
    expect(hero.props.image_url).toBe('/api/dm/v/images/c/u1.jpg');
    const gallery = r.sections.find((s) => s.type === 'gallery') as any;
    expect((gallery.props.images || []).map((x: any) => x.url)).toEqual(['/api/dm/v/images/c/u2.jpg', '/api/dm/v/images/c/u3.jpg']);
    expect(r.sections.some((s: any) => String(s.props?.headline || '').includes('30%'))).toBe(true);
  });
});

describe('재료 입구 순수 함수', () => {
  it('견적 — 텍스트 있으면 생성만 · 텍스트 비고 이미지 있으면 판독 + 생성 · 신규 키 0', () => {
    const a = quoteQuickCampaign({ imageCount: 3, hasText: true });
    expect(a.parts.map((p) => p.key)).toEqual(['dm-ai-generate']);
    const b = quoteQuickCampaign({ imageCount: 2, hasText: false });
    expect(b.parts.map((p) => p.key)).toEqual(['event-image-extract', 'dm-ai-generate']);
    expect(b.total).toBe(b.parts[0].cost + b.parts[1].cost);
    expect(quoteQuickCampaign({ imageCount: 0, hasText: false }).parts.map((p) => p.key)).toEqual(['dm-ai-generate']);
  });
  it('ENV 회사 목록 — 비면 전 회사 · 있으면 목록 회사만', () => {
    expect(quickMaterialsEnabled('c1', '')).toBe(true);
    expect(quickMaterialsEnabled('c1', undefined)).toBe(true);
    expect(quickMaterialsEnabled('c1', 'c1, c2')).toBe(true);
    expect(quickMaterialsEnabled('c3', 'c1,c2')).toBe(false);
    expect(quickMaterialsEnabled(null, 'c1')).toBe(false);
  });
  it('재료 정규화 — 이 회사 서빙 경로만 · 외부·타 회사 URL 거부 · origin 은 서버 판정(비면 empty · extracted 면 vision · 그 외 user) · 링크 http(s)만', () => {
    const m = normalizeQuickMaterials({
      images: [{ url: '/api/dm/v/images/c1/a.jpg', width: 100, height: 200 }, { url: '/api/dm/v/images/c2/b.jpg' }, { url: 'https://evil.example/x.jpg' }, { url: '/api/dm/v/images/c1/../x' }],
      event_text: '  추석 기획전 30% 할인  ', link: 'javascript:alert(1)', brand_name: '브랜드',
    }, 'c1');
    expect(m.images).toEqual([{ url: '/api/dm/v/images/c1/a.jpg', width: 100, height: 200 }]);
    expect(m.event_text).toBe('추석 기획전 30% 할인');
    expect(m.origin).toBe('user'); expect(m.link).toBeNull(); expect(m.brand_name).toBe('브랜드');
    expect(normalizeQuickMaterials({ event_text: 'x', extracted: true }, 'c1').origin).toBe('vision');
    expect(normalizeQuickMaterials({ event_text: '' }, 'c1').origin).toBe('empty');
    expect(normalizeQuickMaterials({ link: 'https://shop.example/event' }, 'c1').link).toBe('https://shop.example/event');
  });
  it('판독 구조 → 재료 글줄(상품은 카드가 아니라 줄 · 중복 제거)', () => {
    const t = materialTextFromEvents([{ brand: 'B', title: '추석 기획전', subtitle: '한가위', benefit: '전 상품 30%', products: [{ name: '수분 크림', price: 32000, sale_price: 25000, discount_rate: 22 }] }], '추석 기획전 · 한가위');
    expect(t).toContain('추석 기획전 · 한가위');
    expect(t).toContain('혜택: 전 상품 30%');
    expect(t).toContain('- 수분 크림 25,000원 (정가 32,000원)');
    expect(t.split('\n').filter((l) => l === '추석 기획전 · 한가위').length).toBe(1);
  });
});

describe('소스 계약 — 엔진 격리 · 라우트 분기', () => {
  it('엔진 파일은 sales-outreach-* 를 import 하지 않는다 · DB·AI·네트워크 0', () => {
    const engine = code('utils/campaign-engine.ts');
    expect(engine).not.toMatch(/sales-outreach-/);
    expect(engine).not.toMatch(/config\/database|await query\(|callAIWithFallback|https?\.request\(|[^a-zA-Z.]fetch\(/);
    expect(engine).toContain('export async function assembleDmCampaign');
  });
  it('one-shot-generate materials 분기 — 몰 상품 자동 첨부 0 · structure 문자열 0 · 402 분기 · 노출 스위치', () => {
    const route = code('routes/dm.ts');
    const start = route.indexOf("if (req.body?.materials && typeof req.body.materials === 'object') {");
    expect(start).toBeGreaterThan(-1);
    const block = route.slice(start, route.indexOf("if (!prompt && !scenario && !eventText) {", start));
    expect(block).toContain('generateDmFromMaterials(');
    expect(block).toContain('quickMaterialsEnabled(companyId)');
    expect(block).not.toContain('attachMallImagesToProductCarousels');
    expect(block).not.toContain('structure:');
    expect(block).toContain("code: 'INSUFFICIENT_CREDIT'");
    expect(block).toContain('draft_id: r.draftId');
  });
  it('재료 입구 라우트 — 요금제 게이트는 dm 라우터 것과 같은 함수 · 텍스트 비었을 때만 판독 · 견적에 plan_locked·enabled', () => {
    const ec = code('routes/event-campaigns.ts');
    expect(ec).toContain("eventCampaignRouter.post('/materials', requirePlanFeature('mobile_dm')");
    expect(ec).toContain('if (!eventText && files.length) {');
    expect(ec).toContain("eventCampaignRouter.get('/materials/quote'");
    expect(ec).toContain('plan_locked: await quickPlanLocked(companyId)');
    expect(ec).toContain('enabled: quickMaterialsEnabled(companyId)');
    const quick = code('utils/campaign-quick.ts');
    // 크레딧 = 기존 키 · 멱등 quick:{draftId} · 초안 행 뒤 차감 · 신규 키 0
    expect(quick).toContain("idempotencyKey: `quick:${draftId}`");
    expect(quick.indexOf('await createDm(')).toBeLessThan(quick.indexOf('await deductCreditSafe('));
    expect(quick).toContain("licensedQuote: m.origin === 'user' ? m.event_text : ''");
    expect(quick).toContain("approval_status: 'draft'");
    expect(quick).not.toMatch(/getCreditCost\('(?!dm-ai-generate'|event-image-extract'|email-ai-generate')/);
  });
  it('★ S6 이메일 합류 — 같은 재료 · 브랜드 이메일 시안 함수 재사용 · 재료 없으면 기존 경로(분기 뒤에 옛 검사가 그대로) · 402 · 몰 첨부 0', () => {
    const quick = code('utils/campaign-quick.ts');
    expect(quick).toContain('export async function generateEmailFromMaterials(');
    expect(quick).toContain('await produceOutreachBrandEmail({');
    expect(quick).toContain("getCreditCost('email-ai-generate')");
    const email = code('routes/email.ts');
    const start = email.indexOf("if (req.body?.materials && typeof req.body.materials === 'object') {");
    expect(start).toBeGreaterThan(-1);
    const end = email.indexOf("if (!prompt && !scenario && !eventText) {", start);
    expect(end).toBeGreaterThan(start);
    const block = email.slice(start, end);
    expect(block).toContain('generateEmailFromMaterials(');
    expect(block).toContain("code: 'INSUFFICIENT_CREDIT'");
    expect(block).not.toContain('attachMallImagesToProductCarousels');
    expect(block).not.toContain('structure:');
    // 무후퇴 — 옛 경로 문자열이 그대로 남아 있다
    expect(email).toContain('const result = await generateEmailSections({ companyId: auth.companyId, userId: auth.userId, prompt, scenario, isAd, eventText });');
  });
});
