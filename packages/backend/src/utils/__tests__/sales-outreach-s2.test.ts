/**
 * sales-outreach-s2.test.ts — S2 재료 게이트 · 면허 확장 · 구성 규칙(2026-09-06 · 설계서 §4). 순수 함수만 · DB·AI mock · 네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { assessMaterialSufficiency, factQuoteOf, assessOutreachQuality, OUTREACH_MATERIAL_GATE } from '../sales-outreach-review';
import { computeSendLock, sendLockMaterialOf, parseLicensedEndDate, findPeriodNear, filterQuoteCandidates, isFutureDate } from '../sales-outreach-jobs';
import { insertProofCard, moveCountdownBeforeLastCta, fillOutreachDmMedia, sanitizeDmCopyBenefits } from '../sales-outreach-produce';
import { applyOutreachLook } from '../sales-outreach-look';
import { OUTREACH_DM_SECTION_CONTRACT, OUTREACH_EMAIL_SECTION_CONTRACT, OUTREACH_GENERATION_RULES } from '../sales-outreach-exemplars';
import type { Section } from '../dm/dm-section-registry';

const sec = (type: string, props: Record<string, unknown>, order = 0): Section => ({ id: `s-${type}-${order}`, type, order, visible: true, props } as unknown as Section);

describe('재료 게이트 assessMaterialSufficiency', () => {
  it('셋 중 둘 이상 충족 = enough · 둘 미달 = thin · 계측은 그대로 남는다', () => {
    const now = new Date('2026-09-06T00:00:00Z');
    expect(assessMaterialSufficiency({ products: 12, banners: 9, events: 3 }, now)).toMatchObject({ verdict: 'enough', passed: ['products', 'banners', 'events'], missing: [] });
    expect(assessMaterialSufficiency({ products: 4, banners: 1, events: 1 }, now)).toMatchObject({ verdict: 'enough', missing: ['banners'] });
    expect(assessMaterialSufficiency({ products: 0, banners: 1, events: 0 }, now)).toMatchObject({ verdict: 'thin', passed: [], missing: ['products', 'banners', 'events'], counts: { products: 0, banners: 1, events: 0 } });
    expect(assessMaterialSufficiency({ products: 3, banners: 2, events: 0 }, now)).toMatchObject({ verdict: 'thin', passed: ['banners'] });
    expect(assessMaterialSufficiency({ products: NaN as any, banners: -3, events: undefined as any }, now).counts).toEqual({ products: 0, banners: 0, events: 0 });
    expect(OUTREACH_MATERIAL_GATE.minAxes).toBe(2);
  });
});

describe('발송 잠금 6번째 MATERIAL_THIN', () => {
  const env = { mailerReady: true, unsub: '수신거부' };
  const email = { html: '<p>수신거부</p>', subject: '제목', placeholderCount: 0 };
  it('thin 이면 잠기고 · 해제(material_override)면 풀리고 · 옛 잡(키 없음)은 영향 0', () => {
    expect(computeSendLock(env, email)).toEqual({ locked: false, reasons: [] });
    expect(computeSendLock(env, email, null)).toEqual({ locked: false, reasons: [] });
    expect(computeSendLock(env, email, { verdict: 'thin', overridden: false })).toEqual({ locked: true, reasons: ['MATERIAL_THIN'] });
    expect(computeSendLock(env, email, { verdict: 'thin', overridden: true })).toEqual({ locked: false, reasons: [] });
    expect(computeSendLock(env, email, { verdict: 'enough' })).toEqual({ locked: false, reasons: [] });
  });
  it('stage_results → 재료 요약(material 없으면 null · override 는 boolean)', () => {
    expect(sendLockMaterialOf(null)).toBeNull();
    expect(sendLockMaterialOf({})).toBeNull();
    expect(sendLockMaterialOf({ material: { verdict: 'thin' } })).toEqual({ verdict: 'thin', overridden: false });
    expect(sendLockMaterialOf({ material: { verdict: 'thin' }, material_override: { at: 'x' } })).toEqual({ verdict: 'thin', overridden: true });
  });
  it('다른 잠금과 합쳐진다(재료 축은 NO_EMAIL 앞에 붙는다)', () => {
    expect(computeSendLock(env, null, { verdict: 'thin' }).reasons).toEqual(['MATERIAL_THIN', 'NO_EMAIL']);
  });
});

describe('사실 수치 근거 factQuoteOf', () => {
  it('가격만(정가·할인가) · 할인율·혜택어·평점은 넣지 않는다 · 없으면 빈 문자열', () => {
    const q = factQuoteOf({ products: [
      { name: '세럼', price: 149000, discount_price: 79000, image_url: 'https://x/1.png', link_url: 'https://x/p/1', discount_rate: 46, rating: 4.9, review_count: 20389 },
      { name: '크림', price: 36000, discount_price: null, image_url: 'https://x/2.png', link_url: 'https://x/p/2' },
    ], proof: { reviewTotal: 455083, rating: 4.9, rankLabel: '누적판매 1위' } });
    expect(q.split(' · ')).toEqual(['149,000원', '79,000원', '36,000원']);
    expect(q).not.toMatch(/%|4\.9|455/);
    expect(factQuoteOf(null)).toBe('');
    expect(factQuoteOf({ products: [] })).toBe('');
  });
  it('근거로 붙이면 카피의 가격은 살고 면허 없는 할인율은 여전히 자리가 된다', () => {
    const basis = ['', factQuoteOf({ products: [{ name: '세럼', price: 149000, discount_price: 79000, image_url: 'u', link_url: 'l' }] })].filter(Boolean).join('\n');
    const r = sanitizeDmCopyBenefits([sec('hero', { headline: '잡티세럼 79,000원 46% 할인', sub_copy: '정가 149,000원' })], basis, '아이소이');
    const h = (r.sections[0].props as any);
    expect(h.sub_copy).toBe('정가 149,000원');
    // 가격과 면허 없는 할인율이 붙어 있으면 차단기가 한 덩어리로 보고 자리째 지운다(원본 '10% 할인' 보호 규칙) → 짧은 prop 은 비고 업체명으로 대체 · heroFallback 기록
    expect(h.headline).toBe('아이소이');
    expect(h.headline).not.toContain('46%');
    expect(r.heroFallback).toBe(true);
  });
});

describe('면허 기간 파서 parseLicensedEndDate · findPeriodNear', () => {
  it('좌우 형식 혼합 범위 · 시각 무시 · 년월일 표기 · 연도 없는 표기는 null', () => {
    expect(parseLicensedEndDate('기간 : 2026.08.31 ~ 2026-09-18 08:59:59')).toEqual({ start: '2026-08-31', end: '2026-09-18' });
    expect(parseLicensedEndDate('2026년 9월 1일부터 2026년 9월 30일까지')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(parseLicensedEndDate('2026/09/18 까지')).toEqual({ start: null, end: '2026-09-18' });
    expect(parseLicensedEndDate('2026-09-01부터 시작')).toEqual({ start: '2026-09-01', end: null });
    expect(parseLicensedEndDate('9월 18일까지 · 최대 50%')).toEqual({ start: null, end: null });
    expect(parseLicensedEndDate('2026.13.40')).toEqual({ start: null, end: null });
    expect(parseLicensedEndDate('')).toEqual({ start: null, end: null });
  });
  it('인용문 주변 "기간 :" 줄을 찾는다(앞 200자·뒤 400자) · 인용이 원문에 없으면 null', () => {
    const text = '메뉴 브랜드 쇼핑 이벤트 특가 추석선물세트 특별 기획전~50% 기간 : 2026.08.31 ~ 2026-09-18 08:59:59 나의 실결제금액 현황 0원 집중 탄력 3종 세트 45% 101,700원';
    expect(findPeriodNear(text, '추석선물세트 특별 기획전~50%')).toEqual({ start: '2026-08-31', end: '2026-09-18' });
    expect(findPeriodNear(text, '없는 문장')).toEqual({ start: null, end: null });
  });
  it('재대조: AI 가 날짜를 못 주면 인용 안 → 주변 순으로 종료일을 채우고 미래면 면허', () => {
    const now = new Date('2026-09-06T00:00:00+09:00');
    const home = '추석선물세트 특별 기획전~50% 기간 : 2026.08.31 ~ 2026-09-18 08:59:59 · 지난 이벤트 크림대전 2026.01.01 ~ 2026.01.31';
    const r = filterQuoteCandidates(
      [{ quote: '추석선물세트 특별 기획전~50%', start_date: null, end_date: null }, { quote: '크림대전 2026.01.01 ~ 2026.01.31', start_date: null, end_date: null }],
      { home }, { home: 'https://www.isoi.co.kr/' }, now,
    );
    expect(r.candidates.length).toBe(2);
    expect(r.candidates[0]).toMatchObject({ endDate: '2026-09-18', startDate: '2026-08-31', benefitLicensed: true });
    // 두 번째는 인용 안 날짜가 과거 → 면허 없음(마커 판정은 인용문 기준이라 폐기되지 않는다)
    expect(r.candidates[1]).toMatchObject({ endDate: '2026-01-31', benefitLicensed: false });
    expect(r.meta.markerDropped).toBe(0);
  });
  it('AI 날짜 형식이 YYYY.MM.DD 여도 정규화된다 · 과거 종료일은 면허 없음', () => {
    const now = new Date('2026-09-06T00:00:00+09:00');
    const r = filterQuoteCandidates([{ quote: '가을 신상 오픈 이벤트', start_date: null, end_date: '2026.09.30' }], { home: '가을 신상 오픈 이벤트' }, { home: 'https://a.com' }, now);
    expect(r.candidates[0]).toMatchObject({ endDate: '2026-09-30', benefitLicensed: true });
    const past = filterQuoteCandidates([{ quote: '가을 신상 오픈 이벤트', start_date: null, end_date: '2025-09-30' }], { home: '가을 신상 오픈 이벤트' }, { home: 'https://a.com' }, now);
    expect(past.candidates[0].benefitLicensed).toBe(false);
    expect(isFutureDate('2026-09-18', now)).toBe(true);
  });
});

describe('코드가 채우는 블록 — 사회적 증거 카드 · 카운트다운 위치', () => {
  const base = [sec('header', {}, 0), sec('hero', { headline: 'h' }, 1), sec('product_carousel', { products: [{ name: 'a' }] }, 2), sec('cta', { buttons: [] }, 3), sec('gallery', {}, 4), sec('countdown', { end_datetime: '2026-09-18T00:00:00' }, 5), sec('cta', { buttons: [] }, 6), sec('footer', {}, 7)];
  it('첫 상품 묶음 직후 text_card 1장 · treatment framed 최상위 · 원문 숫자만 · 100건 미만·평점 없음 = 카드 없음 · 중복 삽입 0', () => {
    const r = insertProofCard(base, { reviewTotal: 455083, rating: 4.9, rankLabel: '누적판매 1위', collectedAt: '2026-09-06T05:00:00Z' }, '아이소이');
    expect(r.inserted).toBe(true);
    const card: any = r.sections[3];
    expect(card.type).toBe('text_card');
    expect(card.id).toBe('so-proof-card');
    expect(card.treatment).toBe('framed');
    expect(card.props.tag).toBe('리뷰 455,083건');
    expect(card.props.headline).toBe('평점 4.9');
    expect(card.props.body).toBe('2026-09-06 아이소이 홈페이지 기준');
    expect(r.sections.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(insertProofCard(r.sections, { reviewTotal: 455083, rating: 4.9 }, '아이소이').inserted).toBe(false);
    expect(insertProofCard(base, { reviewTotal: 12, rating: null }, '아이소이').inserted).toBe(false);
    expect(insertProofCard(base, null, '아이소이').sections.length).toBe(base.length);
  });
  it('상품 묶음이 없으면 hero 직후 · 평점만 있으면 tag 는 1위 표기', () => {
    const r = insertProofCard([sec('header', {}, 0), sec('hero', {}, 1), sec('cta', {}, 2)], { reviewTotal: null, rating: 4.8, rankLabel: '12년 누적판매 1위' }, 'X');
    expect(r.sections[2].type).toBe('text_card');
    expect((r.sections[2].props as any).tag).toBe('12년 누적판매 1위');
  });
  it('카운트다운은 마지막 CTA 직전으로 · 이미 그 자리면 무변경 · cta 없으면 무변경', () => {
    const moved = moveCountdownBeforeLastCta([sec('header', {}, 0), sec('countdown', {}, 1), sec('gallery', {}, 2), sec('cta', {}, 3), sec('gallery', {}, 4), sec('cta', {}, 5), sec('footer', {}, 6)]);
    expect(moved.map((s) => s.type)).toEqual(['header', 'gallery', 'cta', 'gallery', 'countdown', 'cta', 'footer']);
    expect(moved.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const same = [sec('header', {}, 0), sec('countdown', {}, 1), sec('cta', {}, 2)];
    expect(moveCountdownBeforeLastCta(same).map((s) => s.type)).toEqual(['header', 'countdown', 'cta']);
    expect(moveCountdownBeforeLastCta([sec('header', {}, 0), sec('countdown', {}, 1)]).map((s) => s.type)).toEqual(['header', 'countdown']);
  });
});

describe('CTA 목적지 이름형 — DM 16자 · look bar 는 13자 이하만', () => {
  const media = { posterUrl: null, posterSize: null, logoUrl: null, gallery: [], products: [], ctaLinks: { 기획전: 'https://b.com/plan' }, homepageUrl: 'https://b.com/', legal: null, companyName: '브랜드' } as any;
  it('DM 라벨 16자까지 그대로(옛 12자 절단 폐기) · EMAIL 은 8자 유지', () => {
    const dm = fillOutreachDmMedia([sec('cta', { buttons: [{ label: '추석 기획전 보러 가기 지금' }] }, 0)], media, 'DM');
    expect((dm.sections[0].props as any).buttons[0].label).toBe('추석 기획전 보러 가기 지금'); // 15자 = 그대로
    const cut = fillOutreachDmMedia([sec('cta', { buttons: [{ label: '추석 기획전 보러 가기 지금 바로 서둘러' }] }, 0)], media, 'DM');
    expect(((cut.sections[0].props as any).buttons[0].label as string).length).toBe(16);
    const em = fillOutreachDmMedia([sec('cta', { buttons: [{ label: '추석 기획전 보러 가기 지금' }] }, 0)], media, 'EMAIL');
    expect(((em.sections[0].props as any).buttons[0].label as string).length).toBe(8);
  });
  it('룩: 라벨 13자 초과 CTA 는 bar 를 받지 않는다(2줄 접힘 방지) · 13자 이하는 bar', () => {
    const long = applyOutreachLook([sec('header', {}, 0), sec('cta', { buttons: [{ label: '추석 기획전 보러 가기 지금' }] }, 1), sec('footer', {}, 2)], 'DM', {});
    expect((long.sections[1] as any).treatment).toBeUndefined();
    const short = applyOutreachLook([sec('header', {}, 0), sec('cta', { buttons: [{ label: '기획전 보러 가기' }] }, 1), sec('footer', {}, 2)], 'DM', {});
    expect((short.sections[1] as any).treatment).toBe('bar');
  });
});

describe('프롬프트 계약 S2', () => {
  it('규칙은 행사 중심 우선 · 이메일 계약은 독립 문자열(text_card 3칸 의무 · countdown 없음) · DM 은 text_card 0~1 · CTA 목적지 이름형', () => {
    expect(OUTREACH_GENERATION_RULES).toContain('행사가 있으면 행사 중심');
    expect(OUTREACH_GENERATION_RULES).not.toMatch(/없이 브랜드 중심 ·/);
    expect(OUTREACH_EMAIL_SECTION_CONTRACT).toContain('상품 묶음 앞에는 반드시 text_card 1개');
    expect(OUTREACH_EMAIL_SECTION_CONTRACT).not.toContain('countdown');
    expect(OUTREACH_DM_SECTION_CONTRACT).toContain('DM에서는 0~1개만');
    expect(OUTREACH_DM_SECTION_CONTRACT).toContain('10~16자');
    expect(OUTREACH_DM_SECTION_CONTRACT).toContain('60자 이내');
    expect(OUTREACH_DM_SECTION_CONTRACT).not.toContain('버튼 글(8자 이내)');
  });
});

describe('품질 경고 HERO_FALLBACK', () => {
  it('dm asset heroFallback=true 면 경고 · undefined(옛 asset)면 없음', () => {
    const dm = [sec('header', {}, 0), sec('hero', { headline: 'X' }, 1), sec('cta', { buttons: [{ url: 'https://b.com/plan' }] }, 2), sec('footer', {}, 3), sec('gallery', {}, 4), sec('text_card', {}, 5)];
    const w1 = assessOutreachQuality({ dmSections: dm, brandSections: null, media: { gallery: [{ url: 'a' }, { url: 'b' }], products: [{ image_url: '1' }, { image_url: '2' }, { image_url: '3' }, { image_url: '4' }] }, legal: { legal: 'x', csPhone: null }, homepageUrl: 'https://b.com/', heroFallback: true });
    expect(w1.warnings.map((w) => w.code)).toContain('HERO_FALLBACK');
    const w0 = assessOutreachQuality({ dmSections: dm, brandSections: null, media: { gallery: [{ url: 'a' }, { url: 'b' }], products: [{ image_url: '1' }, { image_url: '2' }, { image_url: '3' }, { image_url: '4' }] }, legal: { legal: 'x', csPhone: null }, homepageUrl: 'https://b.com/' });
    expect(w0.warnings.map((w) => w.code)).not.toContain('HERO_FALLBACK');
  });
});
