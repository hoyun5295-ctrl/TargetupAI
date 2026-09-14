/**
 * ai-auto-build-quick.test.ts — AI 자동제작 v1 조립 오케스트레이터(campaign-quick.ts generateFromBuildMaterials · 설계서 §2-9·§2-10·§5·§6-5·§6-6 · T3)
 *  계약 4(채널 독립 · is_ad 전달) · 9(SMTP 미설정 = 400 · 차감 0) · 10(실패 생성 = 초안 0) · 12(같은 attemptToken = 원장 1행 · expectedTotal 불일치 = 409) ·
 *  15(몰 재조회 못 찾음 = 피커 값 + mallUnverified · 품절 = 제외) · 16(차감 실패 = 초안 유지 + [CREDIT][MISS]).
 *  I/O 경계(원장·DB 행·AI·몰·파일)는 deps 로 주입해 순서·키·행 수를 검증한다. DB·AI·네트워크 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) }, default: { connect: vi.fn(), query: vi.fn() } }));

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { generateFromBuildMaterials, quoteBuildMaterials, quoteFromBuildMaterials, buildGenerateResponse, clearBuildVisionCache, type BuildDeps } from '../campaign-quick';
import { AiAutoBuildError, buildIdempotencyKey, buildReadIdempotencyKey, imagesHashOf } from '../ai-auto-build-materials';
import { InsufficientCreditError } from '../ai-credit';

const code = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const TOKEN = '0f3c1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const TOKEN2 = '9f3c1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const dm = (name: string) => `/api/dm/v/images/${COMPANY}/${name}`;
const T40 = '가'.repeat(40);
const HERO = { url: dm('a.jpg'), width: 1600, height: 1200 };
// 멱등키 = 회사 · 채널 · 시도 토큰 · 재료 지문(다른 재료로 같은 토큰 = 다른 키)
const keyOf = (r: any) => buildIdempotencyKey(COMPANY, r.channel, r.attemptToken, r.materialsMeta.billingHash);

const sec = (type: string, props: Record<string, unknown>, order: number) => ({ id: `s-${order}-${type}`, type, order, visible: true, props }) as any;
const SECTIONS = [sec('header', {}, 0), sec('hero', { headline: 'A' }, 1), sec('cta', { buttons: [{ label: '보기', url: 'https://shop.example/' }] }, 2), sec('footer', {}, 3)];
const engineResult = (sections = SECTIONS) => ({
  sections, sectionsBase: sections, pages: [sections], look: { treatments: 0, backgrounds: 0, assigned: [] }, sectionTypes: sections.map((s: any) => s.type),
  benefitStripped: 0, heroFallback: false, proofInserted: false, exemplars: { picked: 0, total: 0 }, removed: [], filled: 0,
  hidden: { applied: 0, missed: [], skipped: false }, generated: true, features: { applied: [], removed: [], skipped: [] },
}) as any;

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1, attemptToken: TOKEN, expectedTotal: 5, channel: 'dm', isAd: true,
    eventCards: [{ id: 'c1', title: '가을 세일', text: T40, licensed: true, images: [HERO], link: 'https://shop.example/event' }],
    products: [], features: null, brandName: null, ...over,
  };
}

function makeDeps(over: Partial<BuildDeps> = {}) {
  const drafts = { dm: [] as any[], email: [] as any[] };
  const ledger: string[] = [];
  const calls: string[] = [];
  const captured: { dm: any[]; email: any[]; lookups: any[] } = { dm: [], email: [], lookups: [] };
  const deps: BuildDeps = {
    enabled: () => true,
    creditEnabled: async () => true,
    checkCredit: async (_c, cost) => { calls.push(`checkCredit:${cost}`); },
    deductOutcome: async (o) => {
      calls.push(`deduct:${o.idempotencyKey}:${o.source}:${o.cost}`);
      if (ledger.includes(String(o.idempotencyKey))) return 'duplicate';
      ledger.push(String(o.idempotencyKey));
      return 'deducted';
    },
    smtpConfigured: async () => { calls.push('smtp'); return true; },
    lookupMall: async (_c, provider, codes) => { captured.lookups.push({ provider, codes }); return { failed: false, byCode: {} }; },
    readImage: (url) => (url.includes('missing') ? { exists: false, buffer: null, width: null, height: null } : { exists: true, buffer: Buffer.from('img'), mediaType: 'image/jpeg', width: 1600, height: 1200 }),
    extractFromImages: async () => { calls.push('vision'); return { eventText: '판독한 행사 내용', events: null }; },
    brandKit: async () => ({ primary_color: '#123456' }),
    basicInfo: async () => ({ brand_name: '브랜드', company_name: '회사', industry_code: 'beauty' }),
    assembleDm: async (m, opts) => { calls.push('assembleDm'); captured.dm.push({ m, opts }); return engineResult(); },
    produceEmail: async (input) => {
      calls.push('produceEmail'); captured.email.push(input);
      return { sections: SECTIONS, subject: '이메일 제목', preheader: '프리헤더', benefitStripped: 0, exemplarCount: 0, exemplarTotal: 0, look: { treatments: 0, backgrounds: 0, assigned: [] }, sliceMode: false, sliceCount: 0, features: { applied: [], removed: [], skipped: [] } } as any;
    },
    createDm: async (_c, _u, data) => { calls.push('createDm'); const id = `dm-${drafts.dm.length + 1}`; drafts.dm.push({ id, ...data }); return { id }; },
    deleteDm: async (id) => { calls.push(`deleteDm:${id}`); drafts.dm = drafts.dm.filter((d) => d.id !== id); return true; },
    createEmail: async (input) => { calls.push('createEmail'); const id = `em-${drafts.email.length + 1}`; drafts.email.push({ id, ...input }); return { id }; },
    deleteEmail: async (_c, id) => { calls.push(`deleteEmail:${id}`); drafts.email = drafts.email.filter((d) => d.id !== id); return true; },
    renderEmail: () => ({ html: '<p>x</p>', text: 'x' }),
    ...over,
  };
  return { deps, drafts, ledger, calls, captured };
}

async function expectBuildError(p: Promise<unknown>, status: number, codeName: string): Promise<AiAutoBuildError> {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(AiAutoBuildError);
    const err = e as AiAutoBuildError;
    expect(err.status).toBe(status);
    expect(err.code).toBe(codeName);
    return err;
  }
  throw new Error('오류가 나야 한다');
}

beforeEach(() => clearBuildVisionCache());

describe('quoteBuildMaterials — 채널 키 그대로 · 판독은 텍스트 0 + 이미지 있을 때만 · 크레딧제 미적용 = 0', () => {
  it('dm 5 · email 3 · 판독 3 분리 표기 · 신규 키 0', () => {
    expect(quoteBuildMaterials({ channel: 'dm', textChars: 40, imageCount: 0 })).toMatchObject({ total: 5, parts: [{ key: 'dm-ai-generate', cost: 5 }] });
    expect(quoteBuildMaterials({ channel: 'email', textChars: 40, imageCount: 2 })).toMatchObject({ total: 3, parts: [{ key: 'email-ai-generate', cost: 3 }] });
    const read = quoteBuildMaterials({ channel: 'dm', textChars: 0, imageCount: 1 });
    expect(read.parts.map((p) => p.key)).toEqual(['event-image-extract', 'dm-ai-generate']);
    expect(read.total).toBe(8);
    expect(quoteBuildMaterials({ channel: 'dm', textChars: 0, imageCount: 0 }).parts.map((p) => p.key)).toEqual(['dm-ai-generate']);
  });
  it('creditEnabled false = 전 부품 0 · 합계 0(원스텝 creditEnabled 규약)', () => {
    const q = quoteBuildMaterials({ channel: 'dm', textChars: 0, imageCount: 1, creditEnabled: false });
    expect(q.total).toBe(0);
    expect(q.parts.every((p) => p.cost === 0)).toBe(true);
    expect(q.parts.map((p) => p.key)).toEqual(['event-image-extract', 'dm-ai-generate']);
  });
});

describe('DM 정상 흐름 — 판정 → checkCredit → 조립 → 초안 → 차감(키 = quick:{company}:dm:{token})', () => {
  it('순서와 키 · 결과 참조 = 초안 id · 차감 결말 deducted', async () => {
    const { deps, drafts, ledger, calls, captured } = makeDeps();
    const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
    expect(r.channel).toBe('dm');
    expect(r.draftId).toBe('dm-1');
    expect(r.attemptToken).toBe(TOKEN);
    expect(r.idempotencyKey).toBe(keyOf(r));
    expect(r.idempotencyKey.startsWith(`quick:${COMPANY}:dm:${TOKEN}:`)).toBe(true);
    expect(r.deductOutcome).toBe('deducted');
    expect(r.readDeductOutcome).toBeNull();
    expect(ledger).toEqual([keyOf(r)]);
    expect(calls).toEqual(['checkCredit:5', 'assembleDm', 'createDm', `deduct:${keyOf(r)}:dm-ai-generate:5`]);
    expect(drafts.dm).toHaveLength(1);
    expect(drafts.dm[0]).toMatchObject({ approval_status: 'draft', layout_mode: 'scroll' });
    expect(String(drafts.dm[0].title)).toContain('브랜드');
    // 엔진 입력 = 고객 입구 · 카드 1 · 갤러리 = 카드 이미지 · 면허 인용 = 카드 문구 · features 그대로
    const { m, opts } = captured.dm[0];
    expect(opts).toMatchObject({ entry: 'customer', channel: 'DM', features: null, presetSections: null });
    expect(m.eventCards).toHaveLength(1);
    expect(m.gallery.map((g: any) => g.url)).toEqual([HERO.url]);
    expect(m.licensedQuote).toContain(T40);
    expect(m.ctaLinks).toEqual({ c1: 'https://shop.example/event' });
    // textChars = 제목 '가을 세일'(5) + 공백 + 본문 40 = 46(제목도 사용자 텍스트)
    expect(r.materialsMeta).toMatchObject({ images: 1, textChars: 46, origin: 'user', licensed: true, reads: 0, products: 0, mallUnverified: [], mallFailed: false, eventCards: 1 });
    expect(r.materialsMeta.imageRoles.map((x) => x.role)).toEqual(['hero']);
    expect(r.quote.total).toBe(5);
  });
  it('features 는 정규화된 목록 그대로 엔진 옵션에 실린다', async () => {
    const { deps, captured } = makeDeps();
    await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ features: ['coupon', 'bogus', 'gallery'] }) }, deps);
    expect(captured.dm[0].opts.features).toEqual(['coupon', 'gallery']);
  });
});

describe('계약 12 — 같은 attemptToken 재시도 = 원장 1행(duplicate) · expectedTotal 불일치 = 409(checkCredit·조립 전)', () => {
  it('두 번 호출해도 ledger 1행 · 두 번째 결말 duplicate · 초안은 하나 더 생길 수 있다(수용 위험 · 차감 0)', async () => {
    const { deps, ledger, drafts } = makeDeps();
    const a = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
    const b = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
    expect(a.deductOutcome).toBe('deducted');
    expect(b.deductOutcome).toBe('duplicate');
    expect(ledger).toHaveLength(1);
    expect(drafts.dm).toHaveLength(2);
    const c = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ attemptToken: TOKEN2 }) }, deps);
    expect(c.deductOutcome).toBe('deducted');
    expect(ledger).toHaveLength(2);
  });
  it('expectedTotal ≠ 서버 견적 = 409 QUOTE_CHANGED + extra.quote · checkCredit·조립·초안·차감 0', async () => {
    const { deps, calls, drafts, ledger } = makeDeps();
    const err = await expectBuildError(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ expectedTotal: 99 }) }, deps), 409, 'QUOTE_CHANGED');
    expect((err.extra as any)?.quote?.total).toBe(5);
    expect(calls).toEqual([]);
    expect(drafts.dm).toEqual([]);
    expect(ledger).toEqual([]);
  });
  it('크레딧제 미적용 회사 = 견적 0 · expectedTotal 0 통과', async () => {
    const { deps } = makeDeps({ creditEnabled: async () => false });
    const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ expectedTotal: 0 }) }, deps);
    expect(r.quote.total).toBe(0);
    expect(r.draftId).toBe('dm-1');
  });
});

describe('판정은 차감 앞(§2-10) — 미개방 403 · 형식 400 · 재료 미달 400 · 전부 checkCredit 0', () => {
  it('기능 미개방 = 403 FEATURE_DISABLED', async () => {
    const { deps, calls } = makeDeps({ enabled: () => false });
    await expectBuildError(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps), 403, 'FEATURE_DISABLED');
    expect(calls).toEqual([]);
  });
  it('재료 형식 오류 = 400 MATERIALS_INVALID(field 동봉)', async () => {
    const { deps, calls } = makeDeps();
    const err = await expectBuildError(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ attemptToken: 'nope' }) }, deps), 400, 'MATERIALS_INVALID');
    expect((err.extra as any)?.field).toBe('attemptToken');
    expect(calls).toEqual([]);
  });
  it('최소 재료 미달 = 400 MATERIAL_THIN + missing · 402 아님', async () => {
    const { deps, calls } = makeDeps();
    const err = await expectBuildError(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ eventCards: [{ id: 'c1', title: '', text: '짧은 글', images: [] }] }) }, deps), 400, 'MATERIAL_THIN');
    expect((err.extra as any)?.missing).toEqual(['text', 'hero']);
    expect(calls).toEqual([]);
  });
});

describe('이미지 — 파일 없는 장은 제외(imagesDropped) · 치수 없으면 서버 실측 · 판독은 텍스트 0 일 때만 · 같은 조합 = 캐시(재차감 0)', () => {
  it('파일 없는 장 제외 · 남은 장으로 판정 · 치수 실측으로 히어로 자격', async () => {
    const { deps, captured } = makeDeps();
    const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ eventCards: [{ id: 'c1', title: '', text: '짧은 글', images: [{ url: dm('missing.jpg'), width: 1600, height: 1200 }, { url: dm('nodims.jpg') }] }] }) }, deps);
    expect(r.materialsMeta).toMatchObject({ images: 1, imagesDropped: 1 });
    expect(r.materialsMeta.imageRoles).toEqual([{ url: dm('nodims.jpg'), role: 'hero', heroEligible: true, estimated: true }]);
    expect(captured.dm[0].m.gallery).toEqual([{ url: dm('nodims.jpg'), width: 1600, height: 1200, group: 'c1' }]);
  });
  it('텍스트 0 + 이미지 = 판독 1회(견적 8) · 판독본은 재료로만(origin empty · 면허 0) · 같은 조합 재시도 = vision 0 · 캐시 표시', async () => {
    const { deps, calls, captured } = makeDeps();
    const input = raw({ expectedTotal: 8, eventCards: [{ id: 'c1', title: '', text: '', images: [HERO] }] });
    const a = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: input }, deps);
    expect(a.materialsMeta).toMatchObject({ reads: 1, origin: 'empty', licensed: false, visionCached: false });
    expect(calls.filter((c) => c === 'vision')).toHaveLength(1);
    expect(calls.indexOf('checkCredit:8')).toBeLessThan(calls.indexOf('vision'));
    expect(captured.dm[0].m.material).toContain('판독한 행사 내용');
    expect(captured.dm[0].m.licensedQuote).toBe('');
    // 캐시 적중이면 견적에서 판독 부품이 빠진다(5) — 8 을 보내면 409 · 5 로 다시
    const b = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: { ...input, attemptToken: TOKEN2, expectedTotal: 5 } }, deps);
    expect(b.materialsMeta.visionCached).toBe(true);
    expect(calls.filter((c) => c === 'vision')).toHaveLength(1);
  });
});

describe('계약 2·15 — 상품: 몰 재조회(상품번호) → 카드 · 못 찾음 = 피커 값 + mallUnverified · 품절 = 제외 + 사유 · 수동 = 글줄', () => {
  const PRODUCTS = [
    { source: 'mall', provider: 'cafe24', code: 'P001', name: '수분크림', price: 38000, salePrice: 26600, discountRate: 30, url: 'https://m.cafe24.com/product/detail.html?product_no=12345', imageUrl: 'https://m.cafe24.com/big/1.jpg' },
    { source: 'mall', provider: 'cafe24', code: '777', name: '토너', price: 9000, imageUrl: 'https://m.cafe24.com/big/7.jpg' },
    { source: 'mall', provider: 'cafe24', code: '888', name: '세럼', price: 45000, imageUrl: 'https://m.cafe24.com/big/8.jpg' },
    { source: 'manual', name: '립밤', price: 12000 },
  ];
  it('재조회는 provider 별 상품번호 목록 1회 · 값 덮기 · 품절 제외 · 수동 글줄 · 계측', async () => {
    const { deps, captured } = makeDeps({
      lookupMall: async (_c, provider, codes) => {
        captured.lookups.push({ provider, codes });
        return { failed: false, byCode: {
          '12345': { status: 'ok', name: '수분크림 50ml', price: 38000, salePrice: 24900, discountRate: 34, imageUrl: 'https://m.cafe24.com/big/fresh.jpg', productUrl: 'https://m.cafe24.com/product/detail.html?product_no=12345' },
          '777': { status: 'unavailable', reason: '품절' },
        } };
      },
    });
    const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ products: PRODUCTS }) }, deps);
    expect(captured.lookups).toEqual([{ provider: 'cafe24', codes: ['12345', '777', '888'] }]);
    const m = captured.dm[0].m;
    expect(m.products.map((p: any) => [p.name, p.price, p.discount_price, p.image_url])).toEqual([
      ['수분크림 50ml', 38000, 24900, 'https://m.cafe24.com/big/fresh.jpg'],
      ['세럼', 45000, null, 'https://m.cafe24.com/big/8.jpg'],
    ]);
    expect(m.material).toContain('- 립밤 12,000원');
    expect(m.licensedQuote).toContain('립밤 12,000원');
    expect(r.materialsMeta).toMatchObject({ products: 2, productsText: 1, mallUnverified: ['888'], mallFailed: false, excluded: [{ code: '777', name: '토너', reason: '품절' }] });
  });
  it('몰 장애 = 생성 계속 · 전 항목 unverified + mallFailed(502 금지)', async () => {
    const { deps } = makeDeps({ lookupMall: async () => { throw new Error('cafe24 down'); } });
    const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ products: PRODUCTS }) }, deps);
    expect(r.draftId).toBe('dm-1');
    expect(r.materialsMeta).toMatchObject({ mallFailed: true, mallUnverified: ['12345', '777', '888'], products: 3 });
  });
  it('면허 카드 본문의 연도 있는 종료일 → eventCards[0].endDate(카운트다운 재료) · 면허 없으면 null', async () => {
    const text = '2099년 12월 31일까지 전 품목 30% 할인 행사를 진행합니다 많은 참여 바랍니다';
    const { deps, captured } = makeDeps();
    await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ eventCards: [{ id: 'c1', title: '연말 세일', text, licensed: true, images: [HERO] }] }) }, deps);
    expect(captured.dm[0].m.eventCards[0].endDate).toBe('2099-12-31');
    await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ attemptToken: TOKEN2, eventCards: [{ id: 'c1', title: '연말 세일', text, licensed: false, images: [HERO] }] }) }, deps);
    expect(captured.dm[1].m.eventCards[0].endDate).toBeNull();
  });
});

describe('계약 4·9 — 이메일: 채널 독립 키·소스 · is_ad 행 저장 · SMTP 미설정 = 400 · 차감 0', () => {
  it('email 키 = quick:{company}:email:{token} · source email-ai-generate 3 · 행 = draft(sections·ai_generated·is_ad) · 결과 참조 = campaignId', async () => {
    const { deps, drafts, ledger, calls, captured } = makeDeps();
    const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ channel: 'email', expectedTotal: 3, isAd: true }) }, deps);
    expect(r.channel).toBe('email');
    expect(r.draftId).toBe('em-1');
    expect(r.idempotencyKey).toBe(keyOf(r));
    expect(r.idempotencyKey.startsWith(`quick:${COMPANY}:email:${TOKEN}:`)).toBe(true);
    expect(ledger).toEqual([keyOf(r)]);
    expect(calls).toEqual(['smtp', 'checkCredit:3', 'produceEmail', 'createEmail', `deduct:${keyOf(r)}:email-ai-generate:3`]);
    expect(drafts.email[0]).toMatchObject({ companyId: COMPANY, createdBy: USER, isAd: true, aiGenerated: true, subject: '이메일 제목', htmlBody: '<p>x</p>', textBody: 'x' });
    expect(Array.isArray(drafts.email[0].sections)).toBe(true);
    expect(captured.email[0]).toMatchObject({ entry: 'customer', features: null, licensedQuote: expect.stringContaining(T40) });
    expect(captured.email[0].eventCards).toHaveLength(1);
    expect(r.subject).toBe('이메일 제목');
    expect(r.preheader).toBe('프리헤더');
    expect(drafts.dm).toEqual([]);
  });
  it('SMTP 미설정 = 400 SMTP_REQUIRED · checkCredit·생성·행·차감 0 · DM 채널은 SMTP 를 보지 않는다', async () => {
    const { deps, calls, drafts, ledger } = makeDeps({ smtpConfigured: async () => { calls.push('smtp'); return false; } });
    await expectBuildError(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ channel: 'email', expectedTotal: 3 }) }, deps), 400, 'SMTP_REQUIRED');
    expect(calls).toEqual(['smtp']);
    expect(drafts.email).toEqual([]);
    expect(ledger).toEqual([]);
    await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
    expect(calls.filter((c) => c === 'smtp')).toHaveLength(1);
  });
});

describe('계약 10·16 — 실패 위치에 따라 초안 행: 차감 전 실패 = 행 0 · 차감 뒤(차감 실패 포함) = 행 유지', () => {
  it('조립 실패 = 초안 0 · 차감 0 · 오류 전파', async () => {
    const { deps, drafts, ledger } = makeDeps({ assembleDm: async () => { throw new Error('모델 실패'); } });
    await expect(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps)).rejects.toThrow('모델 실패');
    expect(drafts.dm).toEqual([]);
    expect(ledger).toEqual([]);
  });
  it('초안 생성 뒤 차감 호출이 던지면 초안 삭제(고아 0) · 오류 전파', async () => {
    const { deps, drafts, calls } = makeDeps({ deductOutcome: async () => { throw new Error('원장 연결 끊김'); } });
    await expect(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps)).rejects.toThrow('원장 연결 끊김');
    expect(calls).toContain('deleteDm:dm-1');
    expect(drafts.dm).toEqual([]);
  });
  it('이메일 렌더 실패 = 행 0(렌더는 행 앞) · 행 생성 뒤 차감 예외 = 행 삭제', async () => {
    const a = makeDeps({ renderEmail: () => { throw new Error('렌더 실패'); } });
    await expect(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ channel: 'email', expectedTotal: 3 }) }, a.deps)).rejects.toThrow('렌더 실패');
    expect(a.drafts.email).toEqual([]);
    const b = makeDeps({ deductOutcome: async () => { throw new Error('원장 연결 끊김'); } });
    await expect(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ channel: 'email', expectedTotal: 3 }) }, b.deps)).rejects.toThrow('원장 연결 끊김');
    expect(b.calls).toContain('deleteEmail:em-1');
    expect(b.drafts.email).toEqual([]);
  });
  it('차감 결말 failed = 행 유지 · 결과 반환 · [CREDIT][MISS] 로그에 멱등키·attemptToken·초안 id', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { deps, drafts } = makeDeps({ deductOutcome: async () => 'failed' });
      const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
      expect(r.deductOutcome).toBe('failed');
      expect(drafts.dm).toHaveLength(1);
      const line = log.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('[CREDIT][MISS]'));
      expect(line).toBeTruthy();
      expect(line).toContain(keyOf(r));
      expect(line).toContain(TOKEN);
      expect(line).toContain('dm-1');
    } finally {
      log.mockRestore();
    }
  });
});

describe('소스 계약 — 카페24 상품번호 재조회 파라미터 · 기본 deps 배선 · v0 경로 무변경', () => {
  it('cafe24-client 에 product_no 질의(미검증 파라미터 · 실측 = T0 ③) · quick 기본 deps 는 원장·SMTP·행 함수 실물', () => {
    const cafe = code('utils/cafe24-client.ts');
    expect(cafe).toContain('product_no: opts.productNo');
    const quick = code('utils/campaign-quick.ts');
    expect(quick).toContain('export function defaultBuildDeps(): BuildDeps');
    expect(quick).toContain('deductOutcome: (o) => deductCreditOutcome(o)');
    expect(quick).toContain('smtpConfigured: (companyId) => isSmtpConfigured(companyId)');
    expect(quick).toContain('createEmail: (input) => createEmailCampaign(input)');
    expect(quick).toContain('deleteDm: (id, companyId) => deleteDm(id, companyId)');
    // v0 경로(quick:{draftId} · createDm 뒤 deductCreditSafe)는 그대로 — 첫 등장 순서가 v0
    expect(quick).toContain('idempotencyKey: `quick:${draftId}`');
    expect(quick.indexOf('await createDm(')).toBeLessThan(quick.indexOf('await deductCreditSafe('));
  });
});

describe('★ T4 — 라우트 채널 고정 · 원장 조회 실패 503 · 견적 함수(차감·AI·초안 0) · 응답 매핑', () => {
  it('라우트가 고정한 채널과 재료 채널이 다르면 400 MATERIALS_INVALID(field channel) · 호출 0', async () => {
    const { deps, calls } = makeDeps();
    const err = await expectBuildError(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ channel: 'email', expectedTotal: 3 }), channel: 'dm' }, deps), 400, 'MATERIALS_INVALID');
    expect((err.extra as any)?.field).toBe('channel');
    expect(calls).toEqual([]);
  });
  it('원장 조회(creditEnabled·checkCredit)가 던지면 503 CREDIT_LOOKUP_UNAVAILABLE(초안 0) · 잔액 부족은 InsufficientCreditError 그대로', async () => {
    const a = makeDeps({ creditEnabled: async () => { throw new Error('pool down'); } });
    await expectBuildError(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, a.deps), 503, 'CREDIT_LOOKUP_UNAVAILABLE');
    expect(a.drafts.dm).toEqual([]);
    const b = makeDeps({ checkCredit: async () => { throw new Error('pool down'); } });
    await expectBuildError(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, b.deps), 503, 'CREDIT_LOOKUP_UNAVAILABLE');
    const c = makeDeps({ checkCredit: async () => { throw new InsufficientCreditError(5, 0); } });
    await expect(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, c.deps)).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(c.drafts.dm).toEqual([]);
  });
  it('quoteFromBuildMaterials — 정규화·이미지 실물·역할·게이트·견적만 · 게이트 미달은 오류가 아니라 결과 · 이메일은 SMTP 상태 동봉', async () => {
    const { deps, calls, drafts, ledger } = makeDeps();
    const q = await quoteFromBuildMaterials({ companyId: COMPANY, materials: raw({ expectedTotal: 0 }) }, deps);
    expect(q).toMatchObject({ channel: 'dm', quote: { total: 5 }, gate: { ok: true }, textChars: 46, images: 1, imagesDropped: 0, creditEnabled: true, smtpConfigured: null });
    expect(q.imageRoles.map((r) => r.role)).toEqual(['hero']);
    expect(q.materialsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toEqual([]);
    expect(drafts.dm).toEqual([]);
    expect(ledger).toEqual([]);
    const thin = await quoteFromBuildMaterials({ companyId: COMPANY, materials: raw({ expectedTotal: 0, eventCards: [{ id: 'c1', title: '', text: '짧은 글', images: [] }] }) }, deps);
    expect(thin.gate).toEqual({ ok: false, missing: ['text', 'hero'] });
    expect(thin.quote.total).toBe(5);
    const email = await quoteFromBuildMaterials({ companyId: COMPANY, materials: raw({ expectedTotal: 0, channel: 'email' }) }, deps);
    expect(email).toMatchObject({ channel: 'email', quote: { total: 3 }, smtpConfigured: true });
    await expectBuildError(quoteFromBuildMaterials({ companyId: COMPANY, materials: raw({ expectedTotal: 0, channel: 'email' }), channel: 'dm' }, deps), 400, 'MATERIALS_INVALID');
    const off = makeDeps({ enabled: () => false });
    await expectBuildError(quoteFromBuildMaterials({ companyId: COMPANY, materials: raw({ expectedTotal: 0 }) }, off.deps), 403, 'FEATURE_DISABLED');
  });
  it('buildGenerateResponse — 편집기 착지 키(draft_id · campaign_id) · 옛 응답 키 유지(spec·scenario·brief·coverage null · subjects 배열) · materials 계측 그대로', async () => {
    const { deps } = makeDeps();
    const dmR = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
    const dmRes = buildGenerateResponse(dmR);
    expect(dmRes).toMatchObject({ channel: 'dm', draft_id: 'dm-1', campaign_id: null, attempt_token: TOKEN, deduct_outcome: 'deducted', spec: null, scenario: null, brief: null, coverage: null, layout_mode: 'scroll', subjects: [], preheader: null });
    expect(dmRes.materials).toBe(dmR.materialsMeta);
    expect(dmRes.quote).toBe(dmR.quote);
    const emR = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ channel: 'email', expectedTotal: 3, attemptToken: TOKEN2 }) }, deps);
    const emRes = buildGenerateResponse(emR);
    expect(emRes).toMatchObject({ channel: 'email', draft_id: 'em-1', campaign_id: 'em-1', subjects: ['이메일 제목'], preheader: '프리헤더' });
    expect(String(emRes.name)).toContain('브랜드');
  });
});


describe('★ Codex 1R(0914) — 돈 단위 결박: 같은 토큰 + 다른 재료 = 다른 키(무료 생성 0) · 판독비 = 초안 뒤 시도 토큰 멱등 · 캐시 적중 = 견적에서 판독 제외', () => {
  it('같은 attemptToken 으로 재료를 바꿔 보내면 원장 2행(무료 생성 없음) · 같은 재료 재시도는 1행', async () => {
    const { deps, ledger } = makeDeps();
    const a = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
    const b = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ eventCards: [{ id: 'c1', title: '겨울 세일', text: T40, licensed: true, images: [HERO], link: 'https://shop.example/event' }] }) }, deps);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(b.deductOutcome).toBe('deducted');
    expect(ledger).toHaveLength(2);
    const c = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
    expect(c.deductOutcome).toBe('duplicate');
    expect(ledger).toHaveLength(2);
  });
  it('판독이 실제로 돌면 초안 뒤에 판독비를 시도 토큰 멱등키로 차감(원장 2행: 생성 + 판독) · 판독은 크레딧 묶음 안(소스 계약)', async () => {
    const { deps, ledger, calls } = makeDeps();
    const input = raw({ expectedTotal: 8, eventCards: [{ id: 'c1', title: '', text: '', images: [HERO] }] });
    const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: input }, deps);
    expect(r.materialsMeta.reads).toBe(1);
    expect(r.readDeductOutcome).toBe('deducted');
    const readKey = buildReadIdempotencyKey(COMPANY, TOKEN, imagesHashOf([HERO.url]));
    expect(ledger).toEqual([keyOf(r), readKey]);
    expect(calls.filter((c) => c.startsWith('deduct:'))).toEqual([`deduct:${keyOf(r)}:dm-ai-generate:5`, `deduct:${readKey}:event-image-extract:3`]);
    expect(calls.indexOf('createDm')).toBeLessThan(calls.indexOf(`deduct:${readKey}:event-image-extract:3`));
    expect(code('utils/campaign-quick.ts')).toContain('await runInCreditBundle(() => deps.extractFromImages(');
  });
  it('같은 이미지 조합이 캐시에 있으면 견적에서 판독이 빠진다(5) · 8 을 보내면 409 · 판독비 차감 0', async () => {
    const { deps, ledger } = makeDeps();
    await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ expectedTotal: 8, eventCards: [{ id: 'c1', title: '', text: '', images: [HERO] }] }) }, deps);
    const q = await quoteFromBuildMaterials({ companyId: COMPANY, materials: raw({ expectedTotal: 0, eventCards: [{ id: 'c1', title: '', text: '', images: [HERO] }] }) }, deps);
    expect(q.quote.total).toBe(5);
    expect(q.quote.parts.map((p) => p.key)).toEqual(['dm-ai-generate']);
    await expectBuildError(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ attemptToken: TOKEN2, expectedTotal: 8, eventCards: [{ id: 'c1', title: '', text: '', images: [HERO] }] }) }, deps), 409, 'QUOTE_CHANGED');
    const r2 = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ attemptToken: TOKEN2, expectedTotal: 5, eventCards: [{ id: 'c1', title: '', text: '', images: [HERO] }] }) }, deps);
    expect(r2.materialsMeta).toMatchObject({ reads: 0, visionCached: true });
    expect(r2.readDeductOutcome).toBeNull();
    expect(ledger.filter((k) => k.startsWith('quick-read:'))).toHaveLength(1);
  });
  it('판독 뒤 조립이 실패하면 판독비 차감 0 · 캐시는 남지만 미정산이라 견적에 판독비가 그대로(8) · 다음 초안 성공 때 처음 시도의 판독 키로 1회 차감 · AI 재호출 0', async () => {
    let fail = true;
    const { deps, ledger, calls } = makeDeps({ assembleDm: async () => { if (fail) throw new Error('모델 실패'); calls.push('assembleDm'); return engineResult(); } });
    const input = raw({ expectedTotal: 8, eventCards: [{ id: 'c1', title: '', text: '', images: [HERO] }] });
    await expect(generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: input }, deps)).rejects.toThrow('모델 실패');
    expect(ledger).toEqual([]);
    expect(calls.filter((c) => c === 'vision')).toHaveLength(1);
    // 미정산 캐시 = 견적에 판독 부품이 남는다(표시 = 차감)
    const q = await quoteFromBuildMaterials({ companyId: COMPANY, materials: { ...input, expectedTotal: 0 } }, deps);
    expect(q.quote.total).toBe(8);
    fail = false;
    const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: { ...input, attemptToken: TOKEN2 } }, deps);
    expect(r.materialsMeta).toMatchObject({ reads: 1, visionCached: true });
    expect(r.readDeductOutcome).toBe('deducted');
    const readKey = buildReadIdempotencyKey(COMPANY, TOKEN, imagesHashOf([HERO.url])); // 처음 읽은 시도(TOKEN)의 키
    expect(ledger).toEqual([keyOf(r), readKey]);
    expect(calls.filter((c) => c === 'vision')).toHaveLength(1);
    // 정산 뒤 = 견적에서 판독이 빠진다
    const q2 = await quoteFromBuildMaterials({ companyId: COMPANY, materials: { ...input, expectedTotal: 0 } }, deps);
    expect(q2.quote.total).toBe(5);
  });
  it('판독비 차감 호출이 던져도 초안은 남는다(생성비 차감 뒤 실패 = 회수 0) · 결말은 failed 로 [CREDIT][MISS]', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      let n = 0;
      const { deps, drafts } = makeDeps({ deductOutcome: async (o) => { n++; if (o.source === 'event-image-extract') throw new Error('원장 연결 끊김'); return 'deducted'; } });
      const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ expectedTotal: 8, eventCards: [{ id: 'c1', title: '', text: '', images: [HERO] }] }) }, deps);
      expect(n).toBe(2);
      expect(drafts.dm).toHaveLength(1);
      expect(r.readDeductOutcome).toBe('failed');
      expect(log.mock.calls.map((c) => c.join(' ')).some((l) => l.includes('[CREDIT][MISS]') && l.includes('quick-read:'))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});

describe('★ Codex 2R(0914) — 과금 지문 = 정규화 입력 전체(이미지 URL 포함) · 견적 지문(uuid 불변)과 분리', () => {
  it('같은 토큰 · 같은 텍스트 · 히어로 이미지만 교체 = 다른 과금 키(원장 2행) · 견적 지문(materialsHash)은 같다', async () => {
    const { deps, ledger } = makeDeps();
    const a = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
    const other = { url: dm('zzzz-other-hero.jpg'), width: 1600, height: 1200 };
    const b = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ eventCards: [{ id: 'c1', title: '가을 세일', text: T40, licensed: true, images: [other], link: 'https://shop.example/event' }] }) }, deps);
    expect(a.materialsMeta.materialsHash).toBe(b.materialsMeta.materialsHash);
    expect(a.materialsMeta.billingHash).not.toBe(b.materialsMeta.billingHash);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(b.deductOutcome).toBe('deducted');
    expect(ledger).toHaveLength(2);
  });
  it('면허 체크·칩·채널 광고 여부가 바뀌어도 다른 과금 키', async () => {
    const { deps } = makeDeps();
    const a = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw() }, deps);
    const b = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ features: ['coupon'] }) }, deps);
    const c = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: raw({ eventCards: [{ id: 'c1', title: '가을 세일', text: T40, licensed: false, images: [HERO], link: 'https://shop.example/event' }] }) }, deps);
    expect(new Set([a.idempotencyKey, b.idempotencyKey, c.idempotencyKey]).size).toBe(3);
  });
});
