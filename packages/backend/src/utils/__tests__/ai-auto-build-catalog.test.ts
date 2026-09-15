/**
 * ai-auto-build-catalog.test.ts — ★ 2026-09-15 카탈로그 DM 채널(Harold 지시 · 쪽 이미지 수량 제한 없이)
 *  정규화(채널 허용 · 회사 경로만 · 기술 상한 · 카드/상품/칩 비움) · 게이트(쪽 2장) · 견적 0 · 조립 = createDm 1회만(엔진·판독·checkCredit·차감 0) ·
 *  행 = layout_mode slides + settings.catalog + 장당 갤러리 1장(뷰어 isSwipeImagePage 무대 판정과 같은 모양) · DM 라우트 가족(channel dm 으로 통과 · email 라우트 400).
 *  I/O 경계는 deps 로 주입(DB·AI·네트워크 0).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) }, default: { connect: vi.fn(), query: vi.fn() } }));

import { generateFromBuildMaterials, quoteBuildMaterials, quoteFromBuildMaterials, buildGenerateResponse, type BuildDeps } from '../campaign-quick';
import * as CAT from '../ai-auto-build-materials';
import { isCatalogEnabled } from '../dm/dm-viewer-catalog';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const TOKEN = '0f3c1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const u = (name: string) => `/api/dm/v/images/${COMPANY}/${name}`;

function rawCat(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1, attemptToken: TOKEN, expectedTotal: 10, channel: 'catalog', isAd: null,
    eventCards: [{ id: 'c1', title: '카드', text: '내용', images: [] }], products: [{ name: '상품' }], features: ['coupon'], brandName: null,
    catalogImages: [{ url: u('p1.jpg'), width: 640, height: 920 }, { url: u('p2.jpg'), width: 640, height: 920 }, { url: u('p3.jpg'), width: 640, height: 920 }],
    catalogTitle: '2026 겨울 카탈로그',
    ...over,
  };
}

function makeDeps(over: Partial<BuildDeps> = {}) {
  const drafts: any[] = [];
  const calls: string[] = [];
  const ledger: string[] = [];
  const deps: BuildDeps = {
    enabled: () => true,
    creditEnabled: async () => true,
    checkCredit: async (_c, cost) => { calls.push(`checkCredit:${cost}`); },
    deductOutcome: async (o) => {
      calls.push(`deduct:${o.source}:${o.cost}`);
      if (ledger.includes(String(o.idempotencyKey))) return 'duplicate';
      ledger.push(String(o.idempotencyKey));
      return 'deducted';
    },
    smtpConfigured: async () => { calls.push('smtp'); return true; },
    lookupMall: async () => { calls.push('mall'); return { failed: false, byCode: {} }; },
    readImage: (url) => (url.includes('missing') ? { exists: false, buffer: null, width: null, height: null } : { exists: true, buffer: Buffer.from('img'), mediaType: 'image/jpeg', width: 640, height: 920 }),
    extractFromImages: async () => { calls.push('vision'); return { eventText: '', events: null }; },
    brandKit: async () => ({ primary_color: '#123456' }),
    basicInfo: async () => ({ brand_name: '브랜드', company_name: '회사', industry_code: 'fashion' }),
    assembleDm: async () => { calls.push('assembleDm'); throw new Error('엔진은 카탈로그를 만들지 않는다'); },
    produceEmail: async () => { calls.push('produceEmail'); throw new Error('이메일 아님'); },
    createDm: async (_c, _u, data) => { calls.push('createDm'); const id = `dm-${drafts.length + 1}`; drafts.push({ id, ...data }); return { id }; },
    deleteDm: async (id) => { calls.push(`deleteDm:${id}`); const i = drafts.findIndex((d) => d.id === id); if (i >= 0) drafts.splice(i, 1); return true; },
    createEmail: async () => { throw new Error('이메일 아님'); },
    deleteEmail: async () => true,
    renderEmail: () => ({ html: '', text: '' }),
    ...over,
  };
  return { deps, drafts, calls, ledger };
}

describe('정규화 — 채널 허용 · 쪽 이미지는 회사 경로만 · 기술 상한 · 제목 · 카드/상품/칩 비움', () => {
  it('catalog 채널 허용 · 회사 경로 아닌 쪽은 조용히 빠진다 · 제목 공백 접기 · 카드·상품·칩은 빈 값 · textChars 0', () => {
    const r = CAT.normalizeBuildMaterials(rawCat({ catalogImages: [{ url: u('1.jpg'), width: 640, height: 920 }, { url: 'https://evil.test/x.jpg' }, { url: u('2.jpg') }], catalogTitle: '  겨울   카탈로그 ' }), COMPANY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.materials.channel).toBe('catalog');
    expect(r.materials.catalogImages.map((im) => im.url)).toEqual([u('1.jpg'), u('2.jpg')]);
    expect(r.materials.catalogTitle).toBe('겨울 카탈로그');
    expect(r.materials.eventCards).toEqual([]);
    expect(r.materials.products).toEqual([]);
    expect(r.materials.features).toBeNull();
    expect(r.materials.textChars).toBe(0);
  });

  it('기술 상한(AI_AUTO_BUILD_CATALOG_IMAGES_MAX)까지만 · dm 채널 재료에 catalogImages 가 붙어도 []·null', () => {
    const many = Array.from({ length: CAT.AI_AUTO_BUILD_CATALOG_IMAGES_MAX + 10 }, (_, i) => ({ url: u(`p${i}.jpg`) }));
    const r = CAT.normalizeBuildMaterials(rawCat({ catalogImages: many }), COMPANY);
    expect(r.ok && r.materials.catalogImages.length).toBe(CAT.AI_AUTO_BUILD_CATALOG_IMAGES_MAX);
    const d = CAT.normalizeBuildMaterials(rawCat({ channel: 'dm', expectedTotal: 5 }), COMPANY);
    expect(d.ok && d.materials.catalogImages).toEqual([]);
    expect(d.ok && d.materials.catalogTitle).toBeNull();
  });

  it('checkCatalogMinimum = 2장 이상 · 미달 missing pages · 견적 지문·과금 지문에 쪽 수·URL 이 들어간다', () => {
    const one = [{ url: u('1.jpg'), width: null, height: null }];
    expect(CAT.checkCatalogMinimum(one)).toEqual({ ok: false, missing: ['pages'] });
    expect(CAT.checkCatalogMinimum([...one, { url: u('2.jpg'), width: null, height: null }])).toEqual({ ok: true });
    const a = CAT.normalizeBuildMaterials(rawCat(), COMPANY);
    const b = CAT.normalizeBuildMaterials(rawCat({ catalogImages: [{ url: u('p1.jpg') }, { url: u('p2.jpg') }] }), COMPANY);
    if (!a.ok || !b.ok) throw new Error('normalize');
    expect(CAT.buildMaterialsHash(a.materials, [])).not.toBe(CAT.buildMaterialsHash(b.materials, []));
    expect(CAT.buildBillingHash(a.materials)).not.toBe(CAT.buildBillingHash(b.materials));
  });

  it('채널 오류 문구에 카탈로그 DM 이 들어간다', () => {
    const r = CAT.normalizeBuildMaterials(rawCat({ channel: 'sms' }), COMPANY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe('channel');
    expect(r.error).toContain('카탈로그 DM');
  });
});

describe('견적 · 조립 — 생성 키 catalog-dm-build 10(Harold 확정) · 판독 0 · AI 0 · 장당 1쪽 slides + settings.catalog', () => {
  it('견적 = 10(원장 키 catalog-dm-build) · 부품 1개 라벨 "카탈로그 DM 생성" · 판독 부품 0 · 크레딧제 미적용 = 0', () => {
    const q = quoteBuildMaterials({ channel: 'catalog', textChars: 0, imageCount: 30 });
    expect(q.total).toBe(10);
    expect(q.parts).toEqual([{ key: 'catalog-dm-build', label: '카탈로그 DM 생성', cost: 10 }]);
    expect(quoteBuildMaterials({ channel: 'catalog', textChars: 0, imageCount: 30, creditEnabled: false })).toEqual({ total: 0, parts: [{ key: 'catalog-dm-build', label: '카탈로그 DM 생성', cost: 0 }] });
  });

  it('DM 라우트(channel dm)로 들어온 카탈로그 재료 = checkCredit 10 → createDm → 차감 1회(키 catalog-dm-build 10) · 엔진·판독 0 · 행 = slides + settings.catalog + 쪽 3', async () => {
    const { deps, drafts, calls, ledger } = makeDeps();
    const r = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: rawCat(), channel: 'dm' }, deps);
    expect(calls).toEqual(['checkCredit:10', 'createDm', 'deduct:catalog-dm-build:10']);
    expect(ledger).toEqual([r.idempotencyKey]);
    expect(r.idempotencyKey).toBe(`quick:${COMPANY}:catalog:${TOKEN}:${r.materialsMeta.billingHash.slice(0, 16)}`);
    expect(r.channel).toBe('catalog');
    expect(r.deductOutcome).toBe('deducted');
    expect(r.readDeductOutcome).toBeNull();
    expect(r.quote.total).toBe(10);
    expect(r.layout_mode).toBe('slides');
    expect(drafts).toHaveLength(1);
    const row = drafts[0];
    expect(row.layout_mode).toBe('slides');
    expect(row.settings).toEqual({ catalog: true });
    expect(isCatalogEnabled(row)).toBe(true);
    expect(row.title).toBe('2026 겨울 카탈로그');
    expect(row.pages).toHaveLength(3);
    for (const p of row.pages) {
      expect(p.sections).toHaveLength(1);
      expect(p.sections[0].type).toBe('gallery');
      expect(p.sections[0].visible).toBe(true);
      expect(p.sections[0].props.layout).toBe('list_1xN');
      expect(p.sections[0].props.full_bleed).toBe(true);
      expect(p.sections[0].props.images).toHaveLength(1);
    }
    expect(row.brand_kit.primary_color).toBe('#123456');
    expect(r.materialsMeta.images).toBe(3);
    expect(r.materialsMeta.reads).toBe(0);
    expect(buildGenerateResponse(r).draft_id).toBe('dm-1');
  });

  it('파일 없는 쪽은 제외(imagesDropped) · 남은 쪽이 1장이면 400 MATERIAL_THIN missing pages · createDm 0', async () => {
    const { deps, calls } = makeDeps();
    const err = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: rawCat({ catalogImages: [{ url: u('p1.jpg'), width: null, height: null }, { url: u('missing.jpg'), width: null, height: null }] }), channel: 'dm' }, deps).catch((e) => e);
    expect(err).toBeInstanceOf(CAT.AiAutoBuildError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('MATERIAL_THIN');
    expect((err.extra as any)?.missing).toEqual(['pages']);
    expect(calls).toEqual([]);
  });

  it('같은 attemptToken 재시도 = 원장 1행(duplicate · 무료) · 재료가 다르면 새 키 = 새 차감', async () => {
    const { deps, ledger } = makeDeps();
    const a = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: rawCat(), channel: 'dm' }, deps);
    const b = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: rawCat(), channel: 'dm' }, deps);
    expect(a.deductOutcome).toBe('deducted');
    expect(b.deductOutcome).toBe('duplicate');
    expect(ledger).toHaveLength(1);
    const c = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: rawCat({ catalogTitle: '다른 제목' }), channel: 'dm' }, deps);
    expect(c.deductOutcome).toBe('deducted');
    expect(ledger).toHaveLength(2);
  });

  it('차감 호출이 던지면 만든 행을 거둔다(고아 0) · 오류 전파', async () => {
    const { deps, drafts, calls } = makeDeps({ deductOutcome: async () => { throw new Error('원장 장애'); } });
    const err = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: rawCat(), channel: 'dm' }, deps).catch((e) => e);
    expect(err.message).toBe('원장 장애');
    expect(calls).toEqual(['checkCredit:10', 'createDm', 'deleteDm:dm-1']);
    expect(drafts).toHaveLength(0);
  });

  it('expectedTotal 이 견적(10)과 다르면 409 · checkCredit·행 0 · 이메일 라우트로 들어오면 400 channel', async () => {
    const { deps, calls } = makeDeps();
    const e1 = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: rawCat({ expectedTotal: 0 }), channel: 'dm' }, deps).catch((e) => e);
    expect(e1.status).toBe(409);
    expect(e1.code).toBe('QUOTE_CHANGED');
    expect(calls).toEqual([]);
    const e2 = await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: rawCat(), channel: 'email' }, deps).catch((e) => e);
    expect(e2.status).toBe(400);
    expect((e2.extra as any)?.field).toBe('channel');
  });

  it('견적 경로: 게이트 ok · 역할 0 · SMTP null · 총액 10 · 쪽 3 · 미달이면 gate.missing pages', async () => {
    const { deps } = makeDeps();
    const q = await quoteFromBuildMaterials({ companyId: COMPANY, materials: rawCat() }, deps);
    expect(q.channel).toBe('catalog');
    expect(q.quote.total).toBe(10);
    expect(q.gate).toEqual({ ok: true });
    expect(q.imageRoles).toEqual([]);
    expect(q.smtpConfigured).toBeNull();
    expect(q.images).toBe(3);
    const thin = await quoteFromBuildMaterials({ companyId: COMPANY, materials: rawCat({ catalogImages: [{ url: u('p1.jpg') }] }) }, deps);
    expect(thin.gate).toEqual({ ok: false, missing: ['pages'] });
  });

  it('제목이 없으면 "[카탈로그] 브랜드" · 카드·상품·칩은 비워져 엔진에 닿지 않는다', async () => {
    const { deps, drafts, calls } = makeDeps();
    await generateFromBuildMaterials({ companyId: COMPANY, userId: USER, materials: rawCat({ catalogTitle: '' }), channel: 'dm' }, deps);
    expect(drafts[0].title).toBe('[카탈로그] 브랜드');
    expect(calls).not.toContain('assembleDm');
  });
});
