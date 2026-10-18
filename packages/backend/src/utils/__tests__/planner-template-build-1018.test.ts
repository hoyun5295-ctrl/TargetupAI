/**
 * ★ 2026-10-18 플래너 v2-1 템플릿 완성본(설계서 docs/2026-10-18-planner-v2-design.md §3-4 · 회의론자 1~9)
 *
 * 고정하는 것
 *   ① 재료 = 템플릿 · 버튼 주소가 있을 때만 키 · 없는 옛 재료의 지문 바이트 그대로
 *   ② 필수 재료(버튼 주소 · 상품 최소 · 혜택) 없으면 돈이 움직이기 전에 막는다
 *   ③ 견적 = 엔진과 같은 키 · 같은 단가(DM 5 · 메일 3 · 크레딧제 미적용 0) · 화면 금액과 다르면 409
 *   ④ 문구 AI 근거에서 혜택 · 기간 · 페이지 글을 뺀다(factsOnly) · 행사명 = 표지 제목(코드)
 *   ⑤ 저장 = 템플릿 DM 표식 · 메일 제목 = 행사명 · 광고 고정 · 차감 = quick: 키 · 낸 결말만 건넨다 · 원장이 던지면 행을 거둔다
 *   ⑥ 빅세일 긴 혜택(> 30자) = 표지 제목은 행사명 · 혜택은 마무리 장 띠(1017 · AI 영업은 그대로)
 *   ⑦ 완성본 기록은 채널 한 칸만(다른 채널 기록을 지우지 않는다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ pool: { connect: vi.fn() }, query: vi.fn(async () => ({ rows: [] })) }));
const aiCalls: any[] = [];
vi.mock('../../services/ai', async (orig) => {
  const real: any = await orig();
  return { ...real, callAIWithFallback: vi.fn(async (opts: any) => { aiCalls.push(opts); return '{}'; }) };
});
vi.mock('../dm/dm-brand-kit', async (orig) => {
  const real: any = await orig();
  return { ...real, getCompanyBrandKitRaw: vi.fn(async () => null) };
});
vi.mock('../brand-basic-info', async (orig) => {
  const real: any = await orig();
  return { ...real, getBrandBasicInfo: vi.fn(async () => ({ brand_name: '테스트브랜드', company_name: '테스트' })) };
});

import { normalizePlannerMaterials, plannerMaterialsHash } from '../planner-event';
import { buildPlannerTemplateChannel, plannerTemplateMissing, plannerTemplateQuote, plannerTemplateProducts } from '../planner-build';
import { getLineTemplate } from '../design-core/line-templates';
import { lineTemplatePageParts } from '../line-template-compose';
import { lineExampleCopy } from '../line-template-copy';

const CO = '11111111-2222-3333-4444-555555555555';
const SRC = join(__dirname, '..', '..');
const src = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('① 재료 · 지문', () => {
  it('템플릿 · 버튼 주소는 있을 때만 키를 둔다 · 옛 재료 지문은 바이트 그대로', () => {
    const r = normalizePlannerMaterials({ text: '글', products: [] }, CO);
    expect(r.ok).toBe(true);
    const v = (r as any).value;
    expect('template' in v).toBe(false);
    expect('link' in v).toBe(false);
    const oldCanon = { i: [], t: '글', l: false, p: [] };
    expect(plannerMaterialsHash(v)).toBe(createHash('sha256').update(JSON.stringify(oldCanon)).digest('hex').slice(0, 32));
    const withTpl = (normalizePlannerMaterials({ text: '글', template: { id: 'big-sale', layout: 'page' }, link: 'https://shop.test/e' }, CO) as any).value;
    expect(withTpl.template).toEqual({ id: 'big-sale', layout: 'page' });
    expect(withTpl.link).toBe('https://shop.test/e');
    expect(plannerMaterialsHash(withTpl)).not.toBe(plannerMaterialsHash(v));
  });
  it('모르는 템플릿은 버리고 · http(s) 아닌 주소는 막는다', () => {
    expect((normalizePlannerMaterials({ template: { id: 'nope' } }, CO) as any).value.template).toBeUndefined();
    expect(normalizePlannerMaterials({ link: 'javascript:alert(1)' }, CO).ok).toBe(false);
  });
});

describe('② ③ 필수 재료 · 견적', () => {
  const big = getLineTemplate('big-sale')!;
  const launch = getLineTemplate('new-launch')!;
  const base = { images: [], text: '', licensed: false, products: [] } as any;
  it('버튼 주소 · 상품 최소 · 혜택 필수', () => {
    expect(plannerTemplateMissing(big, { benefitText: null }, base)).toEqual(['link', 'benefit']);
    expect(plannerTemplateMissing(launch, { benefitText: null }, { ...base, link: 'https://x.test' })).toEqual(['products']);
    expect(plannerTemplateMissing(big, { benefitText: '20% 할인' }, { ...base, link: 'https://x.test' })).toEqual([]);
  });
  it('엔진과 같은 키 · 단가 · 크레딧제 미적용 0', () => {
    expect(plannerTemplateQuote('dm', true)).toEqual({ total: 5, parts: [{ key: 'dm-ai-generate', label: '모바일 DM 생성', cost: 5 }] });
    expect(plannerTemplateQuote('email', true).total).toBe(3);
    expect(plannerTemplateQuote('dm', false).total).toBe(0);
  });
  it('상품 = 사진 있는 몰 상품은 카드 · 품절 제외 · 그 밖은 글 상품', () => {
    const products: any[] = [
      { source: 'mall', provider: 'cafe24', code: '10', name: '세럼', price: 30000, salePrice: 25000, discountRate: null, url: 'https://m/10', imageUrl: 'https://img/10.jpg' },
      { source: 'mall', provider: 'cafe24', code: '11', name: '토너', price: 20000, salePrice: null, discountRate: null, url: null, imageUrl: 'https://img/11.jpg' },
      { source: 'manual', provider: null, code: null, name: '선물 세트', price: 50000, salePrice: null, discountRate: null, url: null, imageUrl: null },
    ];
    const r = plannerTemplateProducts(products, { cafe24: { failed: false, byCode: { 11: { status: 'unavailable', reason: '품절' } } } as any });
    expect(r.cards.map((c) => c.name)).toEqual(['세럼']);
    expect(r.textProducts).toEqual([{ name: '선물 세트', price: 50000 }]);
  });
});

describe('④ ⑤ 템플릿 완성본 1채널', () => {
  const ev: any = { id: 'ev', companyId: CO, planMonth: '2026-10', title: '가을 세일 페스타', startsOn: '2026-10-20', endsOn: '2026-10-25', benefitText: '전 품목 20% 할인', products: [], status: 'draft', createdBy: 'u', meta: {} };
  const materials: any = { images: [{ url: `/api/dm/v/images/${CO}/a.jpg`, width: 1080, height: 1350 }], text: '', licensed: false, products: [], template: { id: 'big-sale', layout: 'page' }, link: 'https://shop.test/fall' };
  const mkDeps = (over: Record<string, any> = {}) => {
    const calls: Record<string, any[]> = { createDm: [], createEmail: [], deleteDm: [], deleteEmail: [], deduct: [], checkCredit: [] };
    const deps: any = {
      enabled: () => true,
      creditEnabled: async () => true,
      checkCredit: async (...a: any[]) => { calls.checkCredit.push(a); },
      deductOutcome: async (o: any) => { calls.deduct.push(o); return 'deducted'; },
      smtpConfigured: async () => true,
      lookupMall: async () => ({ failed: false, byCode: {} }),
      readImage: () => ({ exists: true, buffer: null, width: 1080, height: 1350 }),
      extractFromImages: async () => ({ eventText: '', events: null }),
      brandKit: async () => ({ primary_color: '#222222' }),
      basicInfo: async () => ({ brand_name: '테스트브랜드' }),
      assembleDm: async () => { throw new Error('엔진을 부르면 안 된다'); },
      produceEmail: async () => { throw new Error('엔진을 부르면 안 된다'); },
      createDm: async (...a: any[]) => { calls.createDm.push(a); return { id: 'dm-1' }; },
      deleteDm: async (...a: any[]) => { calls.deleteDm.push(a); return true; },
      createEmail: async (i: any) => { calls.createEmail.push(i); return { id: 'em-1' }; },
      deleteEmail: async (...a: any[]) => { calls.deleteEmail.push(a); return true; },
      renderEmail: () => ({ html: '<html></html>', text: 't' }),
      ...over,
    };
    return { deps, calls };
  };
  const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  beforeEach(() => { aiCalls.length = 0; });

  it('DM = 엔진을 부르지 않는다 · AI 근거에 혜택 · 기간 없음 · 표지 = 행사명 · 템플릿 표식 · quick: 키', async () => {
    const { deps, calls } = mkDeps();
    const r = await buildPlannerTemplateChannel({ ev, materials, channel: 'dm', token: TOKEN, expectedTotal: 5, userId: 'u' }, deps);
    expect(r).toEqual({ draftId: 'dm-1', deductOutcome: 'deducted' });
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0].userMessage).toContain('[혜택] 없음');
    expect(aiCalls[0].userMessage).not.toContain('전 품목 20% 할인');
    expect(aiCalls[0].userMessage).not.toMatch(/\[기간\]/);
    const [, , data] = calls.createDm[0];
    expect(data.template_id).toBe('line:big-sale');
    const cover = data.sections.find((s: any) => s.type === 'hero');
    expect(cover.props.headline).toBe('전 품목 20% 할인'); // 짧은 혜택(≤ 30자) = 표지 제목
    expect(cover.props.sub_copy).toContain('가을 세일 페스타'); // 행사명(코드)
    const cta = data.sections.find((s: any) => s.type === 'cta');
    expect(cta.props.buttons[0].url).toBe('https://shop.test/fall');
    expect(calls.deduct[0]).toMatchObject({ cost: 5, source: 'dm-ai-generate', throwOnInsufficient: true });
    expect(String(calls.deduct[0].idempotencyKey)).toMatch(new RegExp(`^quick:${CO}:dm:${TOKEN}:`));
  });

  it('메일 = 제목은 행사명 · 광고 고정', async () => {
    const { deps, calls } = mkDeps();
    await buildPlannerTemplateChannel({ ev, materials, channel: 'email', token: TOKEN, expectedTotal: 3, userId: 'u' }, deps);
    expect(calls.createEmail[0]).toMatchObject({ subject: '가을 세일 페스타', isAd: true, aiGenerated: true });
  });

  it('필수 재료가 없으면 · 금액이 다르면 돈이 움직이기 전에 막는다', async () => {
    const { deps, calls } = mkDeps();
    await expect(buildPlannerTemplateChannel({ ev, materials: { ...materials, link: null }, channel: 'dm', token: TOKEN, expectedTotal: 5, userId: 'u' }, deps))
      .rejects.toMatchObject({ status: 400, code: 'MATERIAL_THIN' });
    await expect(buildPlannerTemplateChannel({ ev, materials, channel: 'dm', token: TOKEN, expectedTotal: 3, userId: 'u' }, deps))
      .rejects.toMatchObject({ status: 409, code: 'QUOTE_CHANGED' });
    expect(calls.checkCredit).toHaveLength(0);
    expect(calls.createDm).toHaveLength(0);
    expect(aiCalls).toHaveLength(0);
  });

  it('낸 결말이 아니면 행을 거두고 503 · 원장 호출이 던지면 행을 거두고 그대로 던진다', async () => {
    const a = mkDeps({ deductOutcome: async () => 'failed' });
    await expect(buildPlannerTemplateChannel({ ev, materials, channel: 'dm', token: TOKEN, expectedTotal: 5, userId: 'u' }, a.deps)).rejects.toMatchObject({ status: 503, code: 'CREDIT_STATE_UNKNOWN' });
    expect(a.calls.deleteDm).toHaveLength(1);
    const b = mkDeps({ deductOutcome: async () => { throw new Error('db'); } });
    await expect(buildPlannerTemplateChannel({ ev, materials, channel: 'dm', token: TOKEN, expectedTotal: 5, userId: 'u' }, b.deps)).rejects.toThrow('db');
    expect(b.calls.deleteDm).toHaveLength(1);
    const c = mkDeps({ deductOutcome: async () => 'not_applicable', creditEnabled: async () => false });
    await expect(buildPlannerTemplateChannel({ ev, materials, channel: 'dm', token: TOKEN, expectedTotal: 0, userId: 'u' }, c.deps)).resolves.toMatchObject({ draftId: 'dm-1' });
  });
});

describe('⑥ 빅세일 긴 혜택', () => {
  const t = getLineTemplate('big-sale')!;
  const c = lineExampleCopy(t);
  const m = (benefit: string, coverHeadline?: string) => ({
    brandName: 'B', hero: null, products: [], textProducts: [], benefit, periodEnd: '2026-10-25', periodLabel: '10월 25일까지', link: 'https://x.test', ...(coverHeadline ? { coverHeadline } : {}),
  }) as any;
  const long = '전 품목 20% 할인에 구매 금액별 추가 적립까지 드리는 가을 감사 이벤트';
  it('플래너(행사명 있음) = 표지 제목 행사명 · 혜택은 마무리 장 띠', () => {
    const pages = lineTemplatePageParts(t, m(long, '가을 세일'), c, 'dm');
    expect((pages[0][0].props as any).headline).toBe('가을 세일');
    expect(pages.flat().some((p) => p.type === 'coupon' && (p.props as any).discount_label === long)).toBe(true);
  });
  it('1017 · AI 영업(행사명 없음) = 지금 그대로(혜택 = 표지 제목 · 띠 없음)', () => {
    const pages = lineTemplatePageParts(t, m(long), c, 'dm');
    expect((pages[0][0].props as any).headline).toBe(long);
    expect(pages.flat().some((p) => p.type === 'coupon')).toBe(false);
  });
});

describe('⑦ 완성본 기록 = 채널 한 칸', () => {
  it('patch.build 통째 교체 없음 · buildRecord 로 jsonb_set', () => {
    const b = src('utils/planner-build.ts');
    expect(b).not.toMatch(/patch: \{ build: \{ \.\.\.\(ev\.meta\.build/);
    expect(b).toMatch(/buildRecord: \{ channel: input\.channel, record \}/);
    const e = src('utils/planner-event.ts');
    expect(e).toMatch(/jsonb_set\(\$\{metaExpr\}, '\{build\}', COALESCE\(meta->'build', '\{\}'::jsonb\) \|\| jsonb_build_object/);
  });
  it('스위치 밖에서 템플릿을 고르면 400 · 옛 엔진으로 몰래 바꾸지 않는다', () => {
    const b = src('utils/planner-build.ts');
    expect(b).toMatch(/if \(materials\.template && !plannerTemplatesEnabled\(ev\.companyId\)\)/);
    expect(b).toMatch(/TEMPLATE_DISABLED/);
  });
});
