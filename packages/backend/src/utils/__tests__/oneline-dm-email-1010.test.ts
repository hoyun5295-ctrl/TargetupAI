/**
 * 한 줄 → 묻기 → 완성 DM·이메일 (2026-10-10 · 설계서 docs/2026-10-10-oneline-dm-email-design.md)
 *
 * 못 박는 것:
 *   1. 판정 확장(순수) — 검색어 = 혜택 · 의도 · 기간 낱말과 숫자를 뺀 명사구 · 최대 3 · 혜택 % 값 · 가격 금액.
 *   2. 확정 상품 입력 — provider(카페24 · 우커머스) + 숫자 상품번호만 · 상한 · 중복 제거 · 형식 오류 = invalid.
 *   3. 확정 카드 — 재조회 ok 만 카드(품절 · 못 찾음 · 장애 · 사진 없음 · 범위 밖 = 사유) · 카드에 discount_rate 0.
 *   4. 배치(순수) — 첫 상품 슬라이드 통째 교체 · 없으면 히어로 뒤 · 다른 상품 슬라이드 제거 · 순서 재매김.
 *   5. 가격 안내(순수) — % 다름 · 몰 할인 0 · 금액 다름 · 같으면 0줄.
 *   6. 브랜드 킷 · 이메일 design(순수) — 회사 저장 art_direction 이 이긴다 · 저장 주색 없으면 primary 없음.
 */
import { describe, it, expect } from 'vitest';
import {
  lineProductTerms, lineBenefitPercents, lineMoneyAmounts, sanitizeLineProducts, lineProductsKey,
} from '../one-line-facts';
import {
  resolveLineMallCards, placeLineMallCards, linePriceNotes, mergeLineBrandKit, lineEmailDesign, linePinnedPrimary,
  type LineMallCard,
} from '../line-mall-cards';
import { mallProductNoFrom } from '../mall-product-normalize';
import type { Section } from '../dm/dm-section-registry';

describe('1. 판정 확장', () => {
  it('검색어 = 상품 명사구만', () => {
    expect(lineProductTerms('가을 니트 3종 이번 주말 20% 할인')).toEqual(['니트']);
    expect(lineProductTerms('쿠션 파운데이션 30% 할인')).toEqual(['쿠션 파운데이션']);
    expect(lineProductTerms('히알루론 수분크림 1+1 이벤트 진행해줘')).toEqual(['히알루론 수분크림']);
    expect(lineProductTerms('신상 원피스 입고 소식')).toEqual(['원피스']);
  });
  it('이음 조사 · 쉼표는 다른 상품으로 나눈다 · 최대 3', () => {
    expect(lineProductTerms('선크림이랑 토너 같이 20% 할인')).toEqual(['선크림', '토너']);
    expect(lineProductTerms('세럼, 앰플, 크림, 토너 할인')).toEqual(['세럼', '앰플', '크림']);
  });
  it('상품이 없는 한 줄 = 빈 목록', () => {
    expect(lineProductTerms('블랙프라이데이 전 상품 최대 50% 세일')).toEqual([]);
    expect(lineProductTerms('VIP 고객 감사 쿠폰 발송')).toEqual([]);
    expect(lineProductTerms('매장 오픈 안내')).toEqual([]);
    expect(lineProductTerms('')).toEqual([]);
  });
  it('주소 · 숫자 · 단위는 검색어가 아니다', () => {
    expect(lineProductTerms('https://shop.example.com/p/1 반팔티 2만원')).toEqual(['반팔티']);
  });
  it('혜택 % 값 · 가격 금액', () => {
    expect(lineBenefitPercents('니트 20% 할인')).toEqual([20]);
    expect(lineBenefitPercents('면 100% 니트 신상')).toEqual([]);
    expect(lineMoneyAmounts('니트 39,000원 오픈')).toEqual([39000]);
    expect(lineMoneyAmounts('1만5천원 반팔티')).toEqual([15000]);
    expect(lineMoneyAmounts('5만원 이상 구매 시 쿠폰')).toEqual([]);
    expect(lineMoneyAmounts('3천원 할인 쿠폰')).toEqual([]);
  });
});

describe('2. 확정 상품 입력', () => {
  it('없음 = undefined · 빈 배열 = 빈 배열(후보를 보여 줬다)', () => {
    expect(sanitizeLineProducts(undefined)).toBeUndefined();
    expect(sanitizeLineProducts(null)).toBeUndefined();
    expect(sanitizeLineProducts([])).toEqual([]);
  });
  it('카페24 · 우커머스 + 숫자 번호만 · 중복 제거', () => {
    expect(sanitizeLineProducts([{ provider: 'cafe24', no: '12' }, { provider: 'cafe24', no: '12' }, { provider: 'woocommerce:shop.example.com', no: '7' }]))
      .toEqual([{ provider: 'cafe24', no: '12' }, { provider: 'woocommerce:shop.example.com', no: '7' }]);
  });
  it('네이버 · 상품코드 문자 · 이름 · 상한 초과 = invalid', () => {
    expect(sanitizeLineProducts([{ provider: 'naver', no: '1' }])).toBe('invalid');
    expect(sanitizeLineProducts([{ provider: 'cafe24', no: 'P0000BKA' }])).toBe('invalid');
    expect(sanitizeLineProducts({ provider: 'cafe24', no: '1' })).toBe('invalid');
    expect(sanitizeLineProducts(Array.from({ length: 13 }, (_, i) => ({ provider: 'cafe24', no: String(i + 1) })))).toBe('invalid');
  });
  it('멱등 지문 조각은 순서와 무관', () => {
    expect(lineProductsKey([{ provider: 'cafe24', no: '2' }, { provider: 'cafe24', no: '1' }]))
      .toEqual(lineProductsKey([{ provider: 'cafe24', no: '1' }, { provider: 'cafe24', no: '2' }]));
  });
  it('/search 재조회 번호 = 카페24 상품 링크의 번호 · 우커머스 id · 네이버 없음', () => {
    expect(mallProductNoFrom({ provider: 'cafe24', code: 'P0000BKA', productUrl: 'https://m.cafe24.com/product/detail.html?product_no=31' } as any)).toBe('31');
    expect(mallProductNoFrom({ provider: 'woocommerce:shop.example.com', code: '88', productUrl: null } as any)).toBe('88');
    expect(mallProductNoFrom({ provider: 'naver', code: '5', productUrl: null } as any)).toBeNull();
  });
});

describe('3. 확정 카드', () => {
  const hit = (over: Record<string, unknown> = {}) => ({ status: 'ok' as const, name: '니트', price: 50000, salePrice: 40000, discountRate: 20, imageUrl: 'https://img/1.jpg', productUrl: 'https://shop/1', ...over });
  it('ok 만 카드 · 사유 · discount_rate 없음', async () => {
    const r = await resolveLineMallCards('c1', { kind: 'admin', companyId: 'c1' } as any, [
      { provider: 'cafe24', no: '1' }, { provider: 'cafe24', no: '2' }, { provider: 'cafe24', no: '3' }, { provider: 'cafe24', no: '4' },
    ], {
      lookupMall: async () => ({ failed: false, byCode: { '1': hit(), '2': { status: 'unavailable', reason: '품절' }, '4': hit({ imageUrl: null }) } }),
      wooScope: async () => true,
    });
    expect(r.cards).toEqual([{ name: '니트', price: 50000, discount_price: 40000, image_url: 'https://img/1.jpg', link_url: 'https://shop/1' }]);
    expect(r.cards[0]).not.toHaveProperty('discount_rate');
    expect(r.excluded.map((e) => e.reason)).toEqual(['품절', '몰에서 찾지 못했어요', '상품 사진이 없어요']);
  });
  it('몰 장애 · 조회 예외 = 전부 사유', async () => {
    const failed = await resolveLineMallCards('c1', { kind: 'admin', companyId: 'c1' } as any, [{ provider: 'cafe24', no: '1' }], {
      lookupMall: async () => ({ failed: true, byCode: {} }), wooScope: async () => true,
    });
    expect(failed.cards).toEqual([]);
    expect(failed.excluded[0].reason).toBe('몰 응답을 받지 못했어요');
    const thrown = await resolveLineMallCards('c1', { kind: 'admin', companyId: 'c1' } as any, [{ provider: 'cafe24', no: '1' }], {
      lookupMall: async () => { throw new Error('x'); }, wooScope: async () => true,
    });
    expect(thrown.excluded[0].reason).toBe('몰 응답을 받지 못했어요');
  });
  it('범위 밖 우커머스 = 재조회 0', async () => {
    let called = 0;
    const r = await resolveLineMallCards('c1', { kind: 'user', storeCodes: ['A'] } as any, [{ provider: 'woocommerce:other.example.com', no: '9' }], {
      lookupMall: async () => { called++; return { failed: false, byCode: { '9': hit() } }; },
      wooScope: async () => false,
    });
    expect(called).toBe(0);
    expect(r.cards).toEqual([]);
    expect(r.excluded[0].reason).toBe('담당 범위가 아닌 몰이에요');
  });
  it('판매가 = 정가면 할인가 없음', async () => {
    const r = await resolveLineMallCards('c1', { kind: 'admin', companyId: 'c1' } as any, [{ provider: 'cafe24', no: '1' }], {
      lookupMall: async () => ({ failed: false, byCode: { '1': hit({ salePrice: 50000, discountRate: 0 }) } }), wooScope: async () => true,
    });
    expect(r.cards[0]).toEqual({ name: '니트', price: 50000, image_url: 'https://img/1.jpg', link_url: 'https://shop/1' });
  });
});

const sec = (type: string, id: string, props: Record<string, unknown> = {}): Section => ({ id, type, order: 0, visible: true, props } as unknown as Section);
const CARDS: LineMallCard[] = [{ name: '니트', price: 50000, discount_price: 40000, image_url: 'https://img/1.jpg', link_url: 'https://shop/1' }];
let n = 0;
const opts = { newId: () => `id${++n}`, makeCarousel: (order: number) => sec('product_carousel', `new${order}`, { products: [] }) };

describe('4. 배치', () => {
  it('첫 상품 슬라이드 통째 교체 · 다른 상품 슬라이드 제거 · 순서 재매김', () => {
    const out = placeLineMallCards([
      sec('header', 'h'), sec('hero', 'r'),
      sec('product_carousel', 'p1', { title: '추천', products: [{ name: 'AI가 쓴 상품', price: 1 }] }),
      sec('product_carousel', 'p2', { products: [{ name: '또', price: 2 }] }), sec('footer', 'f'),
    ], CARDS, opts);
    expect(out.map((s) => s.id)).toEqual(['h', 'r', 'p1', 'f']);
    expect((out[2].props as any).title).toBe('추천');
    expect((out[2].props as any).products).toEqual([{ id: expect.any(String), ...CARDS[0] }]);
    expect(out.map((s) => s.order)).toEqual([0, 1, 2, 3]);
  });
  it('상품 슬라이드가 없으면 히어로 뒤 · 히어로도 없으면 머리 뒤', () => {
    const a = placeLineMallCards([sec('header', 'h'), sec('hero', 'r'), sec('cta', 'c')], CARDS, opts);
    expect(a.map((s) => s.type)).toEqual(['header', 'hero', 'product_carousel', 'cta']);
    const b = placeLineMallCards([sec('header', 'h'), sec('cta', 'c')], CARDS, opts);
    expect(b.map((s) => s.type)).toEqual(['header', 'product_carousel', 'cta']);
  });
  it('카드 0 = 그대로(같은 배열 내용)', () => {
    const src = [sec('hero', 'r')];
    expect(placeLineMallCards(src, [], opts)).toEqual(src);
  });
  it('입력을 바꾸지 않는다', () => {
    const src = [sec('product_carousel', 'p', { products: [{ name: 'x', price: 1 }] })];
    placeLineMallCards(src, CARDS, opts);
    expect((src[0].props as any).products).toEqual([{ name: 'x', price: 1 }]);
  });
});

describe('5. 가격 안내', () => {
  it('% 다름', () => {
    expect(linePriceNotes('니트 30% 할인', CARDS)).toEqual(['적어 주신 할인율(30%)과 몰 할인율(20%)이 달라요. 상품 가격은 몰 판매가 그대로 실었어요']);
  });
  it('몰 할인 0', () => {
    expect(linePriceNotes('니트 20% 할인', [{ name: '니트', price: 50000, image_url: 'x' }]))
      .toEqual(['몰 판매가에는 적어 주신 할인(20%)이 반영돼 있지 않아요. 쿠폰이나 추가 할인이면 그대로 두셔도 돼요']);
  });
  it('금액 다름', () => {
    expect(linePriceNotes('니트 39,000원 오픈', CARDS)).toEqual(['한 줄의 가격(39,000원)과 몰 가격이 달라요. 상품 카드는 몰 가격으로 실었어요']);
  });
  it('같으면 0줄 · 카드 0 = 0줄', () => {
    expect(linePriceNotes('니트 20% 할인 40,000원', CARDS)).toEqual([]);
    expect(linePriceNotes('니트 30% 할인', [])).toEqual([]);
  });
});

describe('6. 브랜드 킷 · 이메일 design', () => {
  it('저장 주색이 읽히면 고정 · 흰색 · 없음 = null', () => {
    expect(linePinnedPrimary({ primary_color: '#1d4ed8' })).toBe('#1d4ed8');
    expect(linePinnedPrimary({ primary_color: '#ffffff' })).toBeNull();
    expect(linePinnedPrimary(null)).toBeNull();
    expect(linePinnedPrimary({})).toBeNull();
  });
  it('회사 저장 art_direction 이 AI 값을 이긴다 · 주색은 고정값', () => {
    const kit = mergeLineBrandKit(
      { primary_color: '#ffffff', logo_url: '/l.png', art_direction: { typeScale: 'bold' } },
      { tone: 'friendly', art_direction: { typeScale: 'editorial', spacingDensity: 'airy' } },
      null,
    );
    expect(kit).toEqual({ logo_url: '/l.png', tone: 'friendly', art_direction: { typeScale: 'bold', spacingDensity: 'airy' } });
    expect(mergeLineBrandKit({ primary_color: '#1d4ed8' }, { tone: 'friendly', art_direction: {} }, '#1d4ed8').primary_color).toBe('#1d4ed8');
  });
  it('회사 킷 없음 = AI 킷 그대로', () => {
    const ai = { tone: 'friendly', art_direction: { typeScale: 'bold' } };
    expect(mergeLineBrandKit(null, ai, null)).toEqual(ai);
  });
  it('이메일 design = 고정 주색 + 회사(없으면 업종) 아트디렉션 + 프리헤더', () => {
    const d = lineEmailDesign({ pinned: '#1d4ed8', companyArtDirection: { typeScale: 'bold' }, industry: null, preheader: '가을 니트' });
    expect(d?.palette?.primary).toBe('#1d4ed8');
    expect(d?.art_direction?.typeScale).toBe('bold');
    expect(d?.preheader).toBe('가을 니트');
    const e = lineEmailDesign({ pinned: null, companyArtDirection: null, industry: 'beauty', preheader: null });
    expect(e?.palette?.primary).toBeUndefined();
    expect(e?.art_direction).toBeTruthy();
  });
});

// ─────────────── 6-1. 착지 초안 기억(Codex 1R · 2R) ───────────────
import { rememberLineDraft, recallLineDraft, forgetLineDraft, deleteLineDraftWithRetry } from '../line-draft-memo';
import { sanitizeLineReads, maskReadNumbers, applyLineReads } from '../one-line-facts';

describe('6-1. 착지 초안 ↔ 멱등키 기억', () => {
  it('paid = 30분 뒤 잊음 · orphan = 회수될 때까지 잊지 않음 · 회수하면 잊음', () => {
    rememberLineDraft('k1', 'd1', 'paid', 1000);
    expect(recallLineDraft('k1', 1000 + 60_000)).toEqual({ draftId: 'd1', state: 'paid' });
    expect(recallLineDraft('k1', 1000 + 30 * 60_000)).toBeNull();
    rememberLineDraft('k3', 'd3', 'orphan', 1000);
    rememberLineDraft('k4', 'd4', 'paid', 1000 + 999 * 60_000);
    expect(recallLineDraft('k3', 1000 + 999 * 60_000)).toEqual({ draftId: 'd3', state: 'orphan' });
    rememberLineDraft('k2', 'd2', 'paid', 5000);
    forgetLineDraft('k2');
    expect(recallLineDraft('k2', 5001)).toBeNull();
    forgetLineDraft('k3');
    forgetLineDraft('k4');
  });
  it('회수 = 다시 시도 · 끝내 실패하면 false(기억을 남긴다)', async () => {
    let n = 0;
    const ok = await deleteLineDraftWithRetry(async () => { n++; if (n < 2) throw new Error('x'); }, 't', { sleep: async () => {} });
    expect(ok).toBe(true);
    expect(n).toBe(2);
    const fail = await deleteLineDraftWithRetry(async () => { throw new Error('y'); }, 't', { attempts: 2, sleep: async () => {} });
    expect(fail).toBe(false);
  });
});

// ─────────────── 6-2. 사진에서 읽은 글(Harold 결정 H3) ───────────────
describe('6-2. 사진에서 읽은 글 = 면허 아님(체크가 없으면 숫자 값을 지운다)', () => {
  it('입력 검증', () => {
    expect(sanitizeLineReads(undefined)).toBeUndefined();
    expect(sanitizeLineReads(['  전 상품 30% 할인  ', '', '전 상품 30% 할인'])).toEqual(['전 상품 30% 할인']);
    expect(sanitizeLineReads('x')).toBe('invalid');
    expect(sanitizeLineReads([1])).toBe('invalid');
    expect(sanitizeLineReads(Array.from({ length: 6 }, (_, i) => String(i)))).toBe('invalid');
  });
  it('숫자 값만 지우고 낱말은 남긴다', () => {
    expect(maskReadNumbers('가을 니트 전 상품 30% 할인 · 1+1 · 2만원 쿠폰 · 적립 2배')).toBe('가을 니트 전 상품 할인 · · 쿠폰 · 적립');
  });
  it('Codex 3R high — 지운 뒤에는 혜택 판정기가 값을 찾지 못한다(같은 규칙 한 벌)', async () => {
    const { hasConcreteBenefit } = await import('../one-line-facts');
    const samples = [
      '이벤트 두 배 적립', '이벤트 1+1 증정', '더블 적립 이벤트', '무료배송 반값 세일', '5천원 할인 쿠폰', '오천원 쿠폰 증정',
      '첫 구매 10% 할인', '최대 50% OFF', '2만원 상품권 증정', '사은품 증정 이벤트', '적립 3배', '1 + 1 행사',
    ];
    for (const x of samples) {
      expect(hasConcreteBenefit(x)).toBe(true);
      expect(hasConcreteBenefit(maskReadNumbers(x))).toBe(false);
    }
    // ★ Codex 4R — 지운 뒤 붙어 생기는 자리도 더 바뀌지 않을 때까지
    expect(hasConcreteBenefit(maskReadNumbers('할인 무무무무료료료료'))).toBe(false);
    expect(applyLineReads('30% 할인 ', ['30% 할인'], false)).toBe('할인');
    expect(maskReadNumbers('이벤트 두 배 적립')).toBe('이벤트 적립');
    expect(maskReadNumbers('이벤트 1+1 증정')).toBe('이벤트');
  });
  it('Codex 3R medium — 위치는 원문에서 한 번에 · 겹친 조각 · 고친 값 안의 같은 글자는 건드리지 않는다', () => {
    expect(applyLineReads('30% 할인 5천원 쿠폰', ['30% 할인', '30% 할인 5천원 쿠폰'], false)).toBe('할인 쿠폰');
    expect(applyLineReads('30% 할인 5천원 쿠폰', ['30% 할인 5천원 쿠폰', '30% 할인'], false)).toBe('할인 쿠폰');
    expect(applyLineReads('가을 세일 · 15% 할인', ['5% 할인'], false)).toBe('가을 세일 · 15% 할인');
    expect(applyLineReads('5% 할인 · 니트 · 5% 할인', ['5% 할인'], false)).toBe('할인 · 니트 · 할인');
    expect(applyLineReads('전 상품 30% 할인입니다', ['전 상품 30% 할인'], false)).toBe('전 상품 30% 할인입니다');
  });
  it('화면 = 칸에 붙는 모양과 기억하는 조각이 같다 · 고친 조각은 보내지 않는다', async () => {
    const { appendToOneLine, readPartOf, readsInLine } = await import('../../../../frontend/src/utils/one-line');
    const read = '전 상품 30% 할인\n10/15까지';
    const line = appendToOneLine('가을 세일', read);
    expect(line.endsWith(readPartOf(read))).toBe(true);
    expect(readsInLine(line, [readPartOf(read)])).toEqual([readPartOf(read)]);
    expect(readsInLine(line.replace('30%', '20%'), [readPartOf(read)])).toEqual([]);
  });
  it('한 줄 안에 그대로 남은 조각만 · 체크하면 그대로 · 고친 조각은 직접 친 글', () => {
    expect(applyLineReads('가을 세일 · 전 상품 30% 할인', ['전 상품 30% 할인'], false)).toBe('가을 세일 · 전 상품 할인');
    expect(applyLineReads('가을 세일 · 전 상품 30% 할인', ['전 상품 30% 할인'], true)).toBe('가을 세일 · 전 상품 30% 할인');
    expect(applyLineReads('가을 세일 · 전 상품 20% 할인', ['전 상품 30% 할인'], false)).toBe('가을 세일 · 전 상품 20% 할인');
    expect(applyLineReads('가을 세일', undefined, false)).toBe('가을 세일');
  });
});

// ─────────────── 7. 배선 계약(소스) ───────────────
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BACK = (...p: string[]) => readFileSync(resolve(process.cwd(), 'src', ...p), 'utf8');
const FRONT = (...p: string[]) => readFileSync(resolve(process.cwd(), '..', 'frontend', 'src', ...p), 'utf8');
const between = (src: string, a: string, b: string) => { const i = src.indexOf(a); const j = src.indexOf(b, i + 1); return src.slice(i, j > i ? j : undefined); };

describe('7. 배선 계약', () => {
  const dmRoute = between(BACK('routes', 'dm.ts'), "dmRouter.post('/ai/one-shot-generate'", "dmRouter.post('/products/image-candidates'");
  it('DM 한 줄 = 재조회 · 상품 없음 409 가 잔액 확인 앞', () => {
    expect(dmRoute.indexOf('resolveLineMallCards(')).toBeGreaterThan(0);
    expect(dmRoute.indexOf('resolveLineMallCards(')).toBeLessThan(dmRoute.indexOf('await checkCredit(companyId, genCost)'));
    expect(dmRoute.indexOf("'MALL_PRODUCTS_UNAVAILABLE'")).toBeLessThan(dmRoute.indexOf('await checkCredit(companyId, genCost)'));
  });
  it('DM 착지 = 초안 행 → 잔액 부족이면 던지는 차감 → 실패 시 행 회수', () => {
    const c = dmRoute.indexOf('await createDm(');
    const d = dmRoute.indexOf('outcome = await deductCreditOutcome(');
    expect(c).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(c);
    expect(dmRoute.slice(d, d + 260)).toContain('throwOnInsufficient: true');
    expect(dmRoute.indexOf('deleteDm(draftToRemove, companyId)')).toBeGreaterThan(d);
    expect(dmRoute).toContain('pages: pagesFromSectionGroups(r.pages)');
    // 후보를 못 보여 준 착지 요청은 지금처럼 이름 첨부를 저장 전에(회귀 0)
    const landAttach = dmRoute.indexOf('try { await attachMallImagesToProductCarousels(companyId, r.sections); }');
    expect(landAttach).toBeGreaterThan(0);
    expect(landAttach).toBeLessThan(c);
  });
  it('Codex 1R · 2R — 미과금 초안은 건네지 않는다 · 같은 시도 재요청 = 낸 초안 재사용 · 못 거둔 초안은 다시 거둔다 · 가격 안내 = 한 줄 + 혜택 답', () => {
    const prior = dmRoute.indexOf('const prior = lineLand && idemKey ? recallLineDraft(idemKey) : null;');
    expect(prior).toBeGreaterThan(0);
    expect(prior).toBeLessThan(dmRoute.indexOf('await oneShotGenerate({'));
    expect(prior).toBeLessThan(dmRoute.indexOf('await checkCredit(companyId, genCost)'));
    const priorBlock = between(dmRoute, 'const prior = lineLand && idemKey', 'if (idemKey) {');
    expect(priorBlock).not.toContain('deductCreditOutcome(');
    expect(priorBlock).toContain("if (prior.state === 'paid') {");
    expect(priorBlock).toContain("code: 'LINE_DRAFT_PENDING'");
    const ded = dmRoute.indexOf('outcome = await deductCreditOutcome(');
    const paid = dmRoute.indexOf("if (idemKey) rememberLineDraft(idemKey, lineDraftId, 'paid');");
    expect(paid).toBeGreaterThan(ded);
    expect(dmRoute.slice(ded, paid)).toContain("if (outcome === 'deducted' || outcome === 'duplicate' || outcome === 'not_applicable') {");
    expect(dmRoute.indexOf("rememberLineDraft(idemKey, draftToRemove, 'orphan')")).toBeGreaterThan(paid);
    expect(dmRoute).toContain('lineChargeFailed = true;');
    expect(dmRoute.indexOf('if (lineChargeFailed) {')).toBeLessThan(dmRoute.indexOf('sections: result.sections,'));
    expect(dmRoute).toContain('linePriceNotes(buildLineEventText(typedLine, lineFacts), lineCards)');
    expect(BACK('routes', 'email.ts')).toContain('linePriceNotes(genPrompt, lineCards)');
  });
  it('H3 — 사진에서 읽은 글: 두 라우트 · 판정 모두 숫자를 지운 글로', () => {
    expect(dmRoute).toContain("if (lineOn) prompt = applyLineReads(prompt, lineReads, req.body?.read_licensed === true);");
    expect(dmRoute.indexOf('applyLineReads(')).toBeLessThan(dmRoute.indexOf('const typedLine = prompt;'));
    const em = BACK('routes', 'email.ts');
    expect(em).toContain("const linePrompt = lineOn ? applyLineReads(prompt, lineReads, req.body?.read_licensed === true) : prompt;");
    expect(em).toContain('gaps: oneLineGaps(linePrompt)');
    const ai = BACK('routes', 'ai.ts');
    expect(ai).toContain('gaps: enabled ? oneLineGaps(judged) : { benefit: false }');
  });
  it('후보를 보여 준 요청은 이름 자동 첨부 0 · 스위치 밖 상품 = 400 · 지문에 상품', () => {
    expect(dmRoute).toContain('if (lineProducts === undefined && !lineDraftId) {');
    expect(dmRoute).toContain('(lineFacts !== undefined || lineProducts !== undefined || lineReads !== undefined) && !lineOn');
    expect(dmRoute).toContain('products: lineProductsKey(lineProducts)');
  });
  it('이메일 한 줄 = 같은 순서 · 이름 첨부 조건 · 회사 design', () => {
    const em = between(BACK('routes', 'email.ts'), "router.post('/ai/generate-sections'", "router.post('/render-preview'");
    expect(em.indexOf('resolveLineMallCards(')).toBeLessThan(em.indexOf('await checkCredit(auth.companyId, cost)'));
    expect(em).toContain('if (lineProducts === undefined) {');
    expect(em).toContain('placeLineMallCards(');
    expect(em).toContain('lineEmailDesign(');
    expect(em).toContain('(lineFacts !== undefined || lineProducts !== undefined || lineReads !== undefined) && !lineOn');
  });
  it('생성기 = 확정 카드는 검산 · 장 나누기 앞 · 주색 고정은 비주얼 적용 앞 · 원스텝은 새 인자를 넘기지 않는다', () => {
    const ai = BACK('utils', 'dm', 'dm-ai.ts');
    const fn = ai.slice(ai.indexOf('export async function oneShotGenerate('));
    expect(fn.indexOf('placeLineMallCards(')).toBeLessThan(fn.indexOf('computeBriefCoverage(factBrief'));
    expect(fn.indexOf('placeLineMallCards(')).toBeLessThan(fn.indexOf('decideLayoutMode(seeded)'));
    expect(fn.indexOf('opts.pinPrimary')).toBeLessThan(fn.indexOf('applyVisualDirection(assembled'));
    expect(fn).toContain('if (!confirmed && carouselIdx >= 0 && productSource)');
    const ci = BACK('routes', 'content-interview.ts');
    expect(ci).not.toContain('confirmedCards');
    expect(ci).not.toContain('pinPrimary');
  });
  it('몰 검색 응답 = 세 몰 모두 재조회 번호 · 정확 일치 · 상품 바꾸기 = 범위 확인', () => {
    const mp = BACK('routes', 'mall-products.ts');
    expect((mp.match(/products: withLineFields\(products, q\)/g) || []).length).toBe(3);
    const cards = between(mp, "mallProductsRouter.post('/cards'", "mallProductsRouter.get('/match'");
    expect(cards).toContain('resolveIntegrationActor(req.user)');
  });
  it('다듬기 = 회사당 동시 1건 · 풀기는 finally', () => {
    const imp = between(BACK('routes', 'dm.ts'), "dmRouter.post('/ai/improve'", '// ====');
    expect(imp).toContain('tryAcquireInflight(improveLock)');
    expect(imp.indexOf('releaseInflight(improveLock)')).toBeGreaterThan(imp.indexOf('finally'));
  });
  it('화면 = 한 줄만 착지 요청 · 착지 경로에 저장 0 · 결과 화면은 결박된 재료만', () => {
    const ol = FRONT('utils', 'one-line.ts');
    expect(ol).toContain("land: 'result'");
    const dm = FRONT('pages', 'DmBuilderPage.tsx');
    const landed = between(dm, 'if (landed) {', 'createNew({ title: titleHint });');
    expect(landed).toContain('navigate(makeResultPath(');
    expect(landed).not.toContain('save(');
    const rp = FRONT('pages', 'QuickCampaignResultPage.tsx');
    expect(rp).toContain('const draftOwned = draftBelongsTo(draft, draftId, pairId);');
    expect(rp).toContain('const draftFits = draftOwned && ');
    expect(rp).toContain('const readLink = draftOwned ?');
    expect(rp).toContain('onlySectionId={selectedId}');
    expect(FRONT('pages', 'QuickCampaignPage.tsx')).toContain('bindBuildDraftResult(draftId);');
  });
  it('공용 창 기본값 = 지금 그대로(허브 문자 창 · 확인 창)', () => {
    const lf = FRONT('components', 'zone', 'LineFacts.tsx');
    expect(lf).toContain("askBenefit = true, mall, onSubmitAll");
    expect(lf).toContain("const title = onSubmitAll ? lineAskTitle(askBenefit, !!mall, !!readCheck) : '만들기 전에 하나만 여쭐게요';");
    const hub = FRONT('pages', 'AiOperatorPage.tsx');
    const hubModal = between(hub, '<LineFactsAskModal', '/>');
    expect(hubModal).not.toContain('onSubmitAll');
    const cc = FRONT('components', 'credit', 'CreditConfirmModal.tsx');
    expect(cc).toContain("{title || '크레딧 차감 확인'}");
  });
  it('새 화면 문구 = 줄표 · 모델명 0', () => {
    const files = [
      FRONT('components', 'zone', 'LineFacts.tsx'), FRONT('utils', 'one-line.ts'), FRONT('pages', 'QuickCampaignResultPage.tsx'),
      BACK('utils', 'line-mall-cards.ts'),
    ];
    const userStrings = (src: string) => (src.match(/'[^'\n]*[가-힣][^'\n]*'|`[^`\n]*[가-힣][^`\n]*`|>[^<>{}\n]*[가-힣][^<>{}\n]*</g) || []);
    for (const f of files) {
      for (const t of userStrings(f)) {
        expect(t).not.toMatch(/—/);
        expect(t).not.toMatch(/Claude|GPT|Opus|Sonnet|Haiku|Anthropic/i);
      }
    }
  });
});
