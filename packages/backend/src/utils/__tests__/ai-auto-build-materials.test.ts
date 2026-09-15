/**
 * ai-auto-build-materials.test.ts — AI 자동제작 재료 순수 코어(설계서 docs/2026-09-14-ai-auto-build-design.md §6-1 · §6-3 · §6-4 · §6-7)
 *  계약 1(가격 정수 원문 보존) · 3(해시가 이미지 URL uuid에 불변) · 5(origin·licensed·source 서버 판정) · 7(타 회사·외부 URL 거부 · 소재 라이브러리 접두어 허용) ·
 *  8(최소 재료 게이트 규칙 · 라우트 순서 "판정 → checkCredit" 소스 계약은 T4 라우트 테스트가 건다).
 * DB·AI·네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));

import { QUICK_EVENT_CARDS_MAX, QUICK_EVENT_CARD_IMAGES } from '../campaign-quick';
import { dmAllowedTypes } from '../sales-outreach-exemplars';
import {
  AI_AUTO_BUILD_FEATURES,
  AI_AUTO_BUILD_MIN_TEXT_CHARS,
  AI_AUTO_BUILD_CARDS_MAX,
  AI_AUTO_BUILD_CARD_IMAGES,
  aiAutoBuildEnabled,
  isBuildMaterialsV1,
  isCompanyImageUrl,
  normalizeBuildMaterials,
  judgeImageRoles,
  buildMaterialsHash,
  checkMinimumMaterials,
  buildIdempotencyKey,
  buildReadIdempotencyKey,
  imagesHashOf,
  buildBillingHash,
  resolveBuildProducts,
  mallProductNoOf,
  AiAutoBuildError,
  aiAutoBuildErrorResponse,
  buildInflightKey,
  type BuildMaterials,
  type BuildProduct,
  type BuildMallLookup,
} from '../ai-auto-build-materials';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = '0f3c1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const dm = (name: string) => `/api/dm/v/images/${COMPANY}/${name}`;
const lib = (name: string) => `/api/cdp/inapp/image/${COMPANY}/${name}`;
const T40 = '가'.repeat(40);
const T39 = '가'.repeat(39);
const SHORT = '가을 세일 안내';

// 히어로 자격 = 현행 heroEligible 하한 0.8(폭/높이) · 3:4 세로 사진(0.75)은 후보가 아니라 가로형으로 둔다
const HERO = { url: dm('a.jpg'), width: 1600, height: 1200 };
const SQUARE = { url: dm('b.jpg'), width: 800, height: 800 };
const LOGO = { url: dm('c.png'), width: 1200, height: 300 };

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    attemptToken: TOKEN,
    expectedTotal: 5,
    channel: 'dm',
    isAd: true,
    eventCards: [{ id: 'c1', title: '가을 세일', text: T40, licensed: true, images: [HERO] }],
    products: [],
    brandName: null,
    ...over,
  };
}

function ok(raw: unknown): BuildMaterials {
  const r = normalizeBuildMaterials(raw, COMPANY);
  if (!r.ok) throw new Error(`정규화 실패: ${r.field} ${r.error}`);
  return r.materials;
}

describe('상한·허용 목록 동치 — campaign-quick 의 QUICK_* 와 같은 값 · 칩 4종은 고객 입구 허용 타입 안', () => {
  it('카드 3 · 카드당 이미지 3 = QUICK_EVENT_CARDS_MAX · QUICK_EVENT_CARD_IMAGES', () => {
    expect(AI_AUTO_BUILD_CARDS_MAX).toBe(QUICK_EVENT_CARDS_MAX);
    expect(AI_AUTO_BUILD_CARD_IMAGES).toBe(QUICK_EVENT_CARD_IMAGES);
  });
  it('기능 칩 4종은 전부 dmAllowedTypes(customer) 에 있다(불변 7 · 못 만드는 칩 0)', () => {
    const allowed = dmAllowedTypes('customer');
    expect(AI_AUTO_BUILD_FEATURES.every((f) => allowed.includes(f))).toBe(true);
  });
});

describe('aiAutoBuildEnabled — §6-7 신규 ENV · 비면 미노출(현행 quickMaterialsEnabled 와 반대 의미)', () => {
  it('ENV 가 비면 false', () => {
    expect(aiAutoBuildEnabled(COMPANY, undefined)).toBe(false);
    expect(aiAutoBuildEnabled(COMPANY, '')).toBe(false);
    expect(aiAutoBuildEnabled(COMPANY, ' , ')).toBe(false);
  });
  it('목록에 있는 회사만 true · 공백 허용', () => {
    expect(aiAutoBuildEnabled(COMPANY, ` ${OTHER} , ${COMPANY} `)).toBe(true);
    expect(aiAutoBuildEnabled(OTHER, COMPANY)).toBe(false);
    expect(aiAutoBuildEnabled(null, COMPANY)).toBe(false);
    expect(aiAutoBuildEnabled(undefined, COMPANY)).toBe(false);
  });
  // ★ 2026-09-15 전 회사 개방(Harold 지시 · 직원 테스트) — 회사를 일일이 적으면 새로 가입한 회사가 빠진다
  it("'*' = 전 회사 true · 회사 없는 요청은 여전히 false · 목록에 섞여도 전체", () => {
    expect(aiAutoBuildEnabled(COMPANY, '*')).toBe(true);
    expect(aiAutoBuildEnabled(OTHER, ' * ')).toBe(true);
    expect(aiAutoBuildEnabled(OTHER, `${COMPANY},*`)).toBe(true);
    expect(aiAutoBuildEnabled(null, '*')).toBe(false);
    expect(aiAutoBuildEnabled(undefined, '*')).toBe(false);
    expect(aiAutoBuildEnabled('', '*')).toBe(false);
  });
});

describe('isBuildMaterialsV1 — 옛 요청(version 없음)은 현행 경로', () => {
  it('version === 1 만 v1', () => {
    expect(isBuildMaterialsV1({ version: 1 })).toBe(true);
    expect(isBuildMaterialsV1({})).toBe(false);
    expect(isBuildMaterialsV1({ version: '1' })).toBe(false);
    expect(isBuildMaterialsV1(null)).toBe(false);
    expect(isBuildMaterialsV1('v1')).toBe(false);
  });
});

describe('normalizeBuildMaterials — 골격(version · attemptToken · channel · expectedTotal)', () => {
  it('version 이 1 이 아니면 거부', () => {
    const r = normalizeBuildMaterials(base({ version: 2 }), COMPANY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('version');
  });
  it('attemptToken 은 uuid 형식만(돈 단위 키)', () => {
    for (const bad of ['', 'abc', undefined, 123, `${TOKEN}x`]) {
      const r = normalizeBuildMaterials(base({ attemptToken: bad }), COMPANY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe('attemptToken');
    }
    expect(ok(base({ attemptToken: TOKEN.toUpperCase() })).attemptToken).toBe(TOKEN);
  });
  it('channel 은 dm · email 만(대소문자·공백 정리)', () => {
    expect(ok(base({ channel: 'dm' })).channel).toBe('dm');
    expect(ok(base({ channel: ' EMAIL ' })).channel).toBe('email');
    const r = normalizeBuildMaterials(base({ channel: 'sms' }), COMPANY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('channel');
  });
  it('expectedTotal 은 0 이상 정수만(견적 결박 · 크레딧제 미적용 회사 = 0)', () => {
    expect(ok(base({ expectedTotal: 0 })).expectedTotal).toBe(0);
    expect(ok(base({ expectedTotal: 8 })).expectedTotal).toBe(8);
    for (const bad of [undefined, -1, 1.5, '5', NaN]) {
      const r = normalizeBuildMaterials(base({ expectedTotal: bad }), COMPANY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe('expectedTotal');
    }
  });
  it('isAd 는 boolean 만 · 없으면 null(회사 기본값은 라우트 몫) · brandName 60자', () => {
    expect(ok(base({ isAd: true })).isAd).toBe(true);
    expect(ok(base({ isAd: false })).isAd).toBe(false);
    expect(ok(base({ isAd: undefined })).isAd).toBeNull();
    expect(ok(base({ isAd: 'true' })).isAd).toBeNull();
    expect(ok(base({ brandName: `  ${'브'.repeat(70)}  ` })).brandName).toBe('브'.repeat(60));
    expect(ok(base({ brandName: '   ' })).brandName).toBeNull();
  });
});

describe('계약 7 — 이미지 URL 은 이 회사의 서빙 경로만(DM 업로드 + 소재 라이브러리) · 타 회사·외부 거부', () => {
  it('isCompanyImageUrl 판정', () => {
    expect(isCompanyImageUrl(dm('a.jpg'), COMPANY)).toBe(true);
    expect(isCompanyImageUrl(lib('b.png'), COMPANY)).toBe(true);
    expect(isCompanyImageUrl(`/api/dm/v/images/${OTHER}/a.jpg`, COMPANY)).toBe(false);
    expect(isCompanyImageUrl(`/api/cdp/inapp/image/${OTHER}/a.jpg`, COMPANY)).toBe(false);
    expect(isCompanyImageUrl(`https://hanjul.ai/api/dm/v/images/${COMPANY}/a.jpg`, COMPANY)).toBe(false);
    expect(isCompanyImageUrl('https://evil.example/a.jpg', COMPANY)).toBe(false);
    expect(isCompanyImageUrl(dm('../secret.jpg'), COMPANY)).toBe(false);
    expect(isCompanyImageUrl(dm('a b.jpg'), COMPANY)).toBe(false);
    expect(isCompanyImageUrl(dm(''), COMPANY)).toBe(false);
  });
  it('카드 이미지에서 거부 URL 은 조용히 빠지고 치수는 양의 정수만', () => {
    const m = ok(base({
      eventCards: [{ id: 'c1', title: '세일', text: SHORT, images: [
        { url: dm('a.jpg'), width: 1200.7, height: 1600 },
        { url: lib('b.png'), width: 0, height: -3 },
        { url: `/api/dm/v/images/${OTHER}/x.jpg`, width: 100, height: 100 },
        { url: 'https://evil.example/a.jpg', width: 100, height: 100 },
      ] }],
    }));
    expect(m.eventCards[0].images).toEqual([
      { url: dm('a.jpg'), width: 1200, height: 1600 },
      { url: lib('b.png'), width: null, height: null },
    ]);
  });
  it('카드 3장 · 카드당 이미지 3장 상한', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ url: dm(`${i}.jpg`), width: 100, height: 100 }));
    const m = ok(base({ eventCards: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: `카드 ${i}`, text: '', images: many })) }));
    expect(m.eventCards).toHaveLength(3);
    expect(m.eventCards.every((c) => c.images.length === 3)).toBe(true);
  });
  it('제목도 이미지도 없고 내용만 있는 카드는 유지(§4-2 필수 = 내용 또는 이미지) · 셋 다 없으면 버린다', () => {
    const m = ok(base({ eventCards: [{ id: 'only-text', text: SHORT, images: [] }, { id: 'empty', title: '  ', text: '', images: [] }] }));
    expect(m.eventCards.map((c) => c.id)).toEqual(['only-text']);
  });
  it('카드 id 는 문자·숫자·-_ 40자만 · 아니면 순번 · 링크는 http(s) 만', () => {
    const m = ok(base({ eventCards: [
      { id: 'bad id!', title: 'A', text: '', images: [], link: 'javascript:alert(1)' },
      { id: 'good-1', title: 'B', text: '', images: [], link: 'https://brand.example/event?x=1' },
    ] }));
    expect(m.eventCards[0].id).toBe('card1');
    expect(m.eventCards[0].link).toBeNull();
    expect(m.eventCards[1].id).toBe('good-1');
    expect(m.eventCards[1].link).toBe('https://brand.example/event?x=1');
  });
});

describe('계약 5 — origin · licensed · source 는 클라이언트 주장이 아니라 서버 판정', () => {
  it('licensed 는 true 이고 문구가 있을 때만(체크만 있고 내용이 비면 면허 없음)', () => {
    const m = ok(base({ eventCards: [
      { id: 'a', title: '', text: T40, licensed: true, images: [] },
      { id: 'b', title: '제목만', text: '', licensed: true, images: [HERO] },
      { id: 'c', title: '', text: T40, licensed: 'true', images: [] },
    ] }));
    expect(m.eventCards.map((c) => c.licensed)).toEqual([true, true, false]);
  });
  it('origin 은 사용자 텍스트가 있으면 user · 전부 비면 empty · 클라이언트의 vision 주장은 무시', () => {
    expect(ok(base({ origin: 'vision', extracted: true })).origin).toBe('user');
    expect(ok(base({ eventCards: [{ id: 'a', title: '', text: '', images: [HERO] }] })).origin).toBe('empty');
  });
  it('source = 허용 몰(cafe24·naver) + 상품번호가 있을 때만 mall · 그 밖은 manual(주장 무시)', () => {
    const m = ok(base({ products: [
      { source: 'manual', provider: 'cafe24', code: '12345', name: '수분크림', price: 38000 },
      { source: 'mall', provider: 'cafe24', code: '', name: '립밤', price: 12000 },
      { source: 'mall', provider: 'godo', code: '777', name: '토너', price: 9000 },
      { source: 'mall', provider: 'naver', code: 987654, name: '앰플', price: 15000 },
    ] }));
    expect(m.products.map((p) => [p.source, p.provider, p.code])).toEqual([
      ['mall', 'cafe24', '12345'],
      ['manual', null, null],
      ['manual', null, null],
      ['mall', 'naver', '987654'],
    ]);
  });
});

describe('계약 1 — 가격·링크는 정수·원문 그대로(AI 미경유 · 계산 0)', () => {
  it('정수 가격 3종이 그대로 남는다 · 몰 이미지·링크는 http(s) 만', () => {
    const m = ok(base({ products: [{
      source: 'mall', provider: 'cafe24', code: '12345', name: '수분크림 50ml', price: 38000, salePrice: 26600, discountRate: 30,
      url: 'https://mall.example/product/detail.html?product_no=12345', imageUrl: 'https://mall.example/big/1.jpg',
    }] }));
    expect(m.products[0]).toMatchObject({ price: 38000, salePrice: 26600, discountRate: 30, url: 'https://mall.example/product/detail.html?product_no=12345', imageUrl: 'https://mall.example/big/1.jpg' });
  });
  it('가격이 없거나 비정상이면 null(0·음수·NaN·문자열) · 할인율은 0~100 밖이면 null', () => {
    const m = ok(base({ products: [
      { name: '립밤', price: 0, salePrice: -1, discountRate: 120 },
      { name: '토너', price: 'NaN', salePrice: null, discountRate: null },
    ] }));
    expect(m.products[0]).toMatchObject({ price: null, salePrice: null, discountRate: null });
    expect(m.products[1]).toMatchObject({ price: null, salePrice: null, discountRate: null });
  });
  it('수동 상품 이미지는 버린다(불변 5 · 상품 이미지 = 몰 이미지만) · javascript: 링크 거부 · 이름 없는 상품 제외 · 12개 상한', () => {
    const m = ok(base({ products: [
      { source: 'manual', name: '립밤', price: 12000, imageUrl: 'https://cdn.example/lip.jpg', url: 'javascript:alert(1)' },
      { source: 'manual', name: '', price: 5000 },
      ...Array.from({ length: 15 }, (_, i) => ({ name: `상품 ${i}`, price: 1000 + i })),
    ] }));
    expect(m.products[0]).toMatchObject({ source: 'manual', imageUrl: null, url: null });
    expect(m.products).toHaveLength(12);
    expect(m.products.some((p) => p.name === '')).toBe(false);
  });
  it('features 는 엔진이 만들 수 있는 4종 교집합 · 없으면 null(AI가 알아서) · 빈 배열은 빈 배열(전부 OFF) · 중복 제거', () => {
    expect(AI_AUTO_BUILD_FEATURES).toEqual(['product_carousel', 'countdown', 'coupon', 'gallery']);
    expect(ok(base({ features: ['countdown', 'bogus', 'product_carousel', 'countdown'] })).features).toEqual(['countdown', 'product_carousel']);
    expect(ok(base({ features: undefined })).features).toBeNull();
    expect(ok(base({ features: 'countdown' })).features).toBeNull();
    expect(ok(base({ features: [] })).features).toEqual([]);
  });
});

describe('§6-3 이미지 역할 판정 — 순서 = 기본 · 서버 자격 검사로 강등 · 다음 자격자 승격', () => {
  it('첫 장이 자격이면 hero · 정사각은 photo · 3:1 이상은 logo 추정', () => {
    const roles = judgeImageRoles([HERO, SQUARE, LOGO]);
    expect(roles.map((r) => r.role)).toEqual(['hero', 'photo', 'logo']);
    expect(roles.map((r) => r.heroEligible)).toEqual([true, true, false]);
    expect(roles.every((r) => r.estimated === true)).toBe(true);
    expect(roles.map((r) => r.url)).toEqual([HERO.url, SQUARE.url, LOGO.url]);
  });
  it('첫 장이 세로형(비율 0.8 미만)이면 강등 · 다음 자격자가 hero', () => {
    const tall = { url: dm('t.jpg'), width: 600, height: 1200 };
    const roles = judgeImageRoles([tall, SQUARE]);
    expect(roles.map((r) => r.role)).toEqual(['photo', 'hero']);
  });
  it('치수를 모르면 unknown · 자격 없음(fail-closed) · 후보 0 이면 hero 없음', () => {
    const roles = judgeImageRoles([{ url: dm('n.jpg'), width: null, height: null }, LOGO]);
    expect(roles.map((r) => r.role)).toEqual(['unknown', 'logo']);
    expect(roles.some((r) => r.role === 'hero')).toBe(false);
  });
  it('경계값 — 비율 0.8 은 자격 · 3.0 은 로고 · 2.99 는 사진', () => {
    expect(judgeImageRoles([{ url: dm('e.jpg'), width: 800, height: 1000 }])[0].role).toBe('hero');
    expect(judgeImageRoles([{ url: dm('l.jpg'), width: 300, height: 100 }])[0].role).toBe('logo');
    expect(judgeImageRoles([{ url: dm('p.jpg'), width: 299, height: 100 }])[0].role).toBe('hero');
    expect(judgeImageRoles([])).toEqual([]);
  });
});

describe('계약 3 — materialsHash 는 정규화 텍스트 + 상품번호 목록 + 이미지 역할·순서 · URL uuid 에 흔들리지 않는다', () => {
  const A = base({ products: [{ provider: 'cafe24', code: '12345', name: '수분크림', price: 38000 }, { provider: 'cafe24', code: '999', name: '립밤', price: 12000 }] });
  const hashOf = (raw: unknown) => { const m = ok(raw); return buildMaterialsHash(m, judgeImageRoles(m.eventCards.flatMap((c) => c.images))); };
  it('sha256 hex 64자', () => {
    expect(hashOf(A)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('같은 재료 · 이미지 파일명(uuid)만 다르면 같은 해시', () => {
    const B = base({ ...A, eventCards: [{ id: 'c1', title: '가을 세일', text: T40, licensed: true, images: [{ url: dm('zzzz-other-uuid.jpg'), width: 1600, height: 1200 }] }] });
    expect(hashOf(B)).toBe(hashOf(A));
  });
  it('상품번호 순서가 바뀌어도 같은 해시 · 텍스트가 바뀌면 다른 해시', () => {
    const swapped = base({ ...A, products: [...(A.products as unknown[])].reverse() });
    expect(hashOf(swapped)).toBe(hashOf(A));
    const edited = base({ ...A, eventCards: [{ id: 'c1', title: '겨울 세일', text: T40, licensed: true, images: [HERO] }] });
    expect(hashOf(edited)).not.toBe(hashOf(A));
  });
  it('이미지 역할·순서가 바뀌면 다른 해시(로고를 앞에 두면 다른 견적 대상)', () => {
    const heroFirst = base({ eventCards: [{ id: 'c1', title: 'A', text: T40, images: [HERO, LOGO] }] });
    const logoFirst = base({ eventCards: [{ id: 'c1', title: 'A', text: T40, images: [LOGO, HERO] }] });
    expect(hashOf(heroFirst)).not.toBe(hashOf(logoFirst));
  });
  it('attemptToken · expectedTotal 은 해시에 들어가지 않는다(키가 아니라 견적 결박)', () => {
    expect(hashOf(base({ ...A, attemptToken: '9f3c1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', expectedTotal: 99 }))).toBe(hashOf(A));
  });
});

describe('§6-4 최소 재료 게이트 — 사용자 텍스트 40자 이상 또는 (이미지 1장 이상 그리고 히어로 후보 1장 이상)', () => {
  const gate = (raw: unknown) => { const m = ok(raw); return checkMinimumMaterials(m, judgeImageRoles(m.eventCards.flatMap((c) => c.images))); };
  it('상수 = 40', () => {
    expect(AI_AUTO_BUILD_MIN_TEXT_CHARS).toBe(40);
  });
  it('텍스트 40자 단독(이미지 0) = 통과 · 39자 = 미달(text·hero 둘 다 부족)', () => {
    expect(gate(base({ eventCards: [{ id: 'a', title: '', text: T40, images: [] }] }))).toEqual({ ok: true });
    expect(gate(base({ eventCards: [{ id: 'a', title: '', text: T39, images: [] }] }))).toEqual({ ok: false, missing: ['text', 'hero'] });
  });
  it('짧은 텍스트 + 히어로 후보 1장 = 통과', () => {
    expect(gate(base({ eventCards: [{ id: 'a', title: '', text: SHORT, images: [HERO] }] }))).toEqual({ ok: true });
  });
  it('짧은 텍스트 + 로고만 · 치수 미상만 = 미달(hero)', () => {
    expect(gate(base({ eventCards: [{ id: 'a', title: '', text: SHORT, images: [LOGO] }] }))).toEqual({ ok: false, missing: ['text', 'hero'] });
    expect(gate(base({ eventCards: [{ id: 'a', title: '', text: SHORT, images: [{ url: dm('n.jpg'), width: null, height: null }] }] }))).toEqual({ ok: false, missing: ['text', 'hero'] });
  });
  it('텍스트 글자 수는 카드 제목+내용을 합쳐 공백을 접은 길이(textChars) · 카드 여러 장 합산', () => {
    const m = ok(base({ eventCards: [
      { id: 'a', title: '가을  세일', text: '  전 품목 \n\n 30% 할인  ', images: [] },
      { id: 'b', title: '', text: '사은품 증정', images: [] },
    ] }));
    expect(m.userText).toBe('가을 세일 전 품목 30% 할인 사은품 증정');
    expect(m.textChars).toBe(m.userText.length);
  });
});

describe('돈 단위 키 · 오류 형식 (§2-9 · §6-5 · T3)', () => {
  it('buildIdempotencyKey = quick:{companyId}:{channel}:{attemptToken}:{재료 지문 16자} · 채널·지문이 다르면 다른 키 · 150자 안', () => {
    const h = 'c'.repeat(64);
    const k = buildIdempotencyKey(COMPANY, 'dm', TOKEN, h);
    expect(k).toBe(`quick:${COMPANY}:dm:${TOKEN}:${'c'.repeat(16)}`);
    expect(buildIdempotencyKey(COMPANY, 'email', TOKEN, h)).toBe(`quick:${COMPANY}:email:${TOKEN}:${'c'.repeat(16)}`);
    expect(buildIdempotencyKey(COMPANY, 'dm', TOKEN, 'd'.repeat(64))).not.toBe(k);
    expect(k.length).toBeLessThanOrEqual(150);
  });
  it('AiAutoBuildError 는 status·code·extra 를 싣는다(라우트가 그대로 응답)', () => {
    const e = new AiAutoBuildError(409, 'QUOTE_CHANGED', '견적이 바뀌었습니다.', { total: 5 });
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(409);
    expect(e.code).toBe('QUOTE_CHANGED');
    expect(e.extra).toEqual({ total: 5 });
    expect(e.message).toBe('견적이 바뀌었습니다.');
  });
});

describe('계약 2·15 — resolveBuildProducts: 상품번호 병합 · 몰 재조회 값 우선 · 못 찾음 = 피커 값 + mallUnverified · 품절 = 제외 + 사유 · 수동 = 글줄', () => {
  const mall = (over: Partial<BuildProduct> = {}): BuildProduct => ({ source: 'mall', provider: 'cafe24', code: 'P001', name: '수분크림', price: 38000, salePrice: 26600, discountRate: 30, url: 'https://m.cafe24.com/product/detail.html?product_no=12345', imageUrl: 'https://m.cafe24.com/big/1.jpg', ...over });
  const manual = (over: Partial<BuildProduct> = {}): BuildProduct => ({ source: 'manual', provider: null, code: null, name: '립밤', price: 12000, salePrice: null, discountRate: null, url: null, imageUrl: null, ...over });
  const none: Record<string, BuildMallLookup> = { cafe24: { failed: false, byCode: {} } };

  it('mallProductNoOf = 링크의 상품번호 → 없으면 숫자 code → 없으면 null · 수동 null', () => {
    expect(mallProductNoOf(mall())).toBe('12345');
    expect(mallProductNoOf(mall({ url: null, code: '777' }))).toBe('777');
    expect(mallProductNoOf(mall({ url: null, code: 'P001' }))).toBeNull();
    expect(mallProductNoOf(manual())).toBeNull();
  });
  it('재조회 성공 = 몰 값이 피커 값을 덮는다(가격 자릿수 그대로 · 링크·이미지 보존)', () => {
    const lookup: Record<string, BuildMallLookup> = { cafe24: { failed: false, byCode: { '12345': { status: 'ok', name: '수분크림 50ml', price: 38000, salePrice: 24900, discountRate: 34, imageUrl: 'https://m.cafe24.com/big/fresh.jpg', productUrl: 'https://m.cafe24.com/product/detail.html?product_no=12345' } } } };
    const r = resolveBuildProducts([mall()], lookup);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0]).toMatchObject({ name: '수분크림 50ml', price: 38000, discount_price: 24900, discount_rate: 34, image_url: 'https://m.cafe24.com/big/fresh.jpg', link_url: 'https://m.cafe24.com/product/detail.html?product_no=12345', verified: true });
    expect(r.mallUnverified).toEqual([]);
    expect(r.excluded).toEqual([]);
    expect(r.mallFailed).toBe(false);
  });
  it('못 찾음 = 피커 값 그대로 + mallUnverified · 몰 장애(failed) = 전 항목 unverified + mallFailed(조용한 소실 0)', () => {
    const miss = resolveBuildProducts([mall()], none);
    expect(miss.cards[0]).toMatchObject({ name: '수분크림', price: 38000, discount_price: 26600, discount_rate: 30, verified: false });
    expect(miss.mallUnverified).toEqual(['12345']);
    expect(miss.mallFailed).toBe(false);
    const down = resolveBuildProducts([mall(), mall({ url: null, code: '777', name: '토너' })], { cafe24: { failed: true, byCode: {} } });
    expect(down.mallFailed).toBe(true);
    expect(down.mallUnverified).toEqual(['12345', '777']);
    expect(down.cards).toHaveLength(2);
  });
  it('품절·미전시 = 카드·글줄에서 제외 + 사유 한 줄', () => {
    const r = resolveBuildProducts([mall()], { cafe24: { failed: false, byCode: { '12345': { status: 'unavailable', reason: '품절' } } } });
    expect(r.cards).toEqual([]);
    expect(r.textLines).toEqual([]);
    expect(r.excluded).toEqual([{ code: '12345', name: '수분크림', reason: '품절' }]);
  });
  it('같은 상품번호 2번 = 1개 · 수동 = 카드 0 + 글줄(이름·가격) · 이미지 없는 몰 상품도 글줄 · 상품번호 없는 몰 상품 = 수동 취급', () => {
    const r = resolveBuildProducts([
      mall(), mall({ name: '수분크림(중복)' }), manual(), manual({ name: '립밤' }),
      mall({ url: null, code: '999', name: '토너', imageUrl: null, price: 9000, salePrice: null, discountRate: null }),
      mall({ url: null, code: 'P777', name: '앰플', price: 15000, salePrice: 12000, discountRate: null }),
    ], none);
    expect(r.cards).toHaveLength(1);
    expect(r.textLines).toEqual(['- 립밤 12,000원', '- 토너 9,000원', '- 앰플 12,000원 (정가 15,000원)']);
    expect(r.mallUnverified).toEqual(['12345', '999']);
  });
  it('정가 없이 판매가만 = 정가 · 할인 없음 · 원문 할인율 없으면 discount_rate 미설정(렌더러가 정가 대비 계산)', () => {
    const r = resolveBuildProducts([mall({ price: null, salePrice: 26600, discountRate: null })], none);
    expect(r.cards[0]).toMatchObject({ price: 26600, discount_price: null });
    expect((r.cards[0] as Record<string, unknown>).discount_rate).toBeUndefined();
    const noPrice = resolveBuildProducts([mall({ price: null, salePrice: null, discountRate: null })], none);
    expect(noPrice.cards[0]).toMatchObject({ price: null, discount_price: null });
  });
});

describe('T4 — 라우트 매핑 순수 함수(오류 응답 · 잠금 키)', () => {
  it('aiAutoBuildErrorResponse = AiAutoBuildError → {status, body(success false · error · code · extra 펼침)} · 그 밖 = null', () => {
    const r = aiAutoBuildErrorResponse(new AiAutoBuildError(409, 'QUOTE_CHANGED', '견적', { quote: { total: 5 } }));
    expect(r).toEqual({ status: 409, body: { success: false, error: '견적', code: 'QUOTE_CHANGED', quote: { total: 5 } } });
    expect(aiAutoBuildErrorResponse(new AiAutoBuildError(403, 'FEATURE_DISABLED', '닫힘'))).toEqual({ status: 403, body: { success: false, error: '닫힘', code: 'FEATURE_DISABLED' } });
    expect(aiAutoBuildErrorResponse(new Error('x'))).toBeNull();
    expect(aiAutoBuildErrorResponse(null)).toBeNull();
  });
  it('buildInflightKey = 회사 단위(동시 생성 409 · §6-5 · 채널 무관)', () => {
    expect(buildInflightKey(COMPANY)).toBe(`ai-auto-build:${COMPANY}`);
    expect(buildInflightKey(OTHER)).not.toBe(buildInflightKey(COMPANY));
  });
});


describe('★ Codex 1R(0914) — 멱등키에 재료 지문 결박 · 판독비 키 · 이미지 조합 지문', () => {
  it('buildReadIdempotencyKey = quick-read:{companyId}:{attemptToken}:{이미지 지문 16자} · imagesHashOf 는 순서·중복 무관', () => {
    const h = imagesHashOf(['/a.jpg', '/b.jpg']);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(imagesHashOf(['/b.jpg', '/a.jpg', '/a.jpg'])).toBe(h);
    expect(imagesHashOf(['/a.jpg'])).not.toBe(h);
    expect(buildReadIdempotencyKey(COMPANY, TOKEN, h)).toBe(`quick-read:${COMPANY}:${TOKEN}:${h.slice(0, 16)}`);
    expect(buildReadIdempotencyKey(COMPANY, TOKEN, h).length).toBeLessThanOrEqual(150);
  });
});

describe('★ Codex 2R(0914) — buildBillingHash: 정규화 입력 전체(이미지 URL·카드·면허·칩·채널·광고) · attemptToken·expectedTotal 제외', () => {
  it('이미지 URL 이 다르면 다르고 · 토큰·견적 합계만 다르면 같다 · 칩·면허·채널·상품이 다르면 다르다', () => {
    const a = ok(base());
    expect(buildBillingHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(buildBillingHash(ok(base({ attemptToken: '9f3c1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', expectedTotal: 99 })))).toBe(buildBillingHash(a));
    expect(buildBillingHash(ok(base({ eventCards: [{ id: 'c1', title: '가을 세일', text: T40, licensed: true, images: [{ url: dm('other.jpg'), width: 1600, height: 1200 }] }] })))).not.toBe(buildBillingHash(a));
    expect(buildBillingHash(ok(base({ features: ['coupon'] })))).not.toBe(buildBillingHash(a));
    expect(buildBillingHash(ok(base({ channel: 'email', expectedTotal: 3 })))).not.toBe(buildBillingHash(a));
    expect(buildBillingHash(ok(base({ products: [{ provider: 'cafe24', code: '12345', name: '수분크림', price: 38000 }] })))).not.toBe(buildBillingHash(a));
    expect(buildBillingHash(ok(base({ eventCards: [{ id: 'c1', title: '가을 세일', text: T40, licensed: false, images: [HERO] }] })))).not.toBe(buildBillingHash(a));
  });
});

describe('★ W5(0914) 우커머스 몰 상품 — provider "woocommerce:{mall}" 을 몰 상품으로 인정한다(다몰 · 상품번호는 몰 안에서만 고유)', () => {
  it('woocommerce:ilbonimo.com + 상품번호 → mall(provider 그대로) · 몰 없는 woocommerce · 빈 호스트 · 이상한 호스트 → manual', () => {
    const m = ok(base({ products: [
      { source: 'mall', provider: 'woocommerce:ilbonimo.com', code: '93', name: '원데이 렌즈', price: 9000, imageUrl: 'https://www.ilbonimo.com/u/93.jpg' },
      { source: 'mall', provider: 'woocommerce', code: '94', name: '케이스', price: 1000 },
      { source: 'mall', provider: 'woocommerce:', code: '95', name: '용액', price: 1000 },
      { source: 'mall', provider: 'woocommerce:10.0.0.1', code: '96', name: '내부망', price: 1000 },
    ] }));
    expect(m.products.map((p) => [p.source, p.provider, p.code, p.imageUrl])).toEqual([
      ['mall', 'woocommerce:ilbonimo.com', '93', 'https://www.ilbonimo.com/u/93.jpg'],
      ['manual', null, null, null],
      ['manual', null, null, null],
      ['manual', null, null, null],
    ]);
  });
  it('같은 상품번호라도 몰이 다르면 다른 상품(병합 키 = provider:번호) · 재조회 결과는 몰 provider 키로 받는다', () => {
    const a: BuildProduct = { source: 'mall', provider: 'woocommerce:ilbonimo.com', code: '93', name: 'A', price: 9000, salePrice: null, discountRate: null, url: null, imageUrl: 'https://a/1.jpg' };
    const b: BuildProduct = { ...a, provider: 'woocommerce:lens007.net', name: 'B', imageUrl: 'https://b/1.jpg' };
    const r = resolveBuildProducts([a, b], {
      'woocommerce:ilbonimo.com': { failed: false, byCode: { '93': { status: 'ok', name: 'A(재조회)', price: 9000, salePrice: 8000, discountRate: 11, imageUrl: 'https://a/1.jpg', productUrl: 'https://www.ilbonimo.com/product/a/' } } },
      'woocommerce:lens007.net': { failed: false, byCode: { '93': { status: 'unavailable', reason: '품절' } } },
    });
    expect(r.cards.map((c) => [c.name, c.discount_price, c.link_url])).toEqual([['A(재조회)', 8000, 'https://www.ilbonimo.com/product/a/']]);
    expect(r.excluded).toEqual([{ code: '93', name: 'B', reason: '품절' }]);
  });
});
